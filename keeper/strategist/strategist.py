"""Uptick range strategist: propose a (rangeBps, minRebalanceInterval) setting for a StockVault pool.

An agent proposes, the replay decides, the contract bounds. Nothing here signs or sends a transaction.

Usage:
  python3 strategist.py --token NVDA [--current-range-bps 500] [--current-interval-h 24] [--interval-h 24] [--out proposal.json] [--explain]
  python3 strategist.py --batch --interval-h 24 [--tokens A,B] [--params-out data/params.json] [--out-dir DIR]

--interval-h restricts the grid to that one interval. --batch decides every eligible token of data/universe.json (or --tokens) and
merges {SYM: {range_bps, interval_h, decided_by, calibration_apr, heldout_apr, margin}} into data/params.json, the per-token band
replay/replay.py reads. The keeper recentres once a day, so batch mode requires --interval-h 24.

Scoring mirrors replay/replay.py: window is the last 30 days to 2026-10-17 00:00 UTC, the first 15 days
calibrate and the last 15 are held out; the metric is the out-of-sample edge APR = fee APR + markout APR
- cost APR on USD 100,000, from the unchanged engine at spikes/stock-vaults/scripts/engine.py on data/engine/.
"""
import argparse
import json
import os
import subprocess
import sys
import datetime as dt
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
KEEPER = os.path.normpath(os.path.join(HERE, ".."))
SPIKE = os.path.normpath(os.path.join(KEEPER, "..", "..", "spikes", "stock-vaults"))
ENGINE_DIR = os.path.join(KEEPER, "data", "engine")
sys.path.insert(0, os.path.join(SPIKE, "scripts"))
import engine
import strategies
engine.DATA = strategies.DATA = ENGINE_DIR
engine.GB = None
from engine import Pool, simulate, apr, TOK
from strategies import Ref, rng
sys.path.insert(0, os.path.join(KEEPER, "replay"))
import pull
from pull import USDG

U = dt.timezone.utc
CAP = 100_000.0
DAYS = 30
END = "2026-10-17"
MARGIN_APR = 2.0
MIN_CHOICE_VOLUME_USD = 1_000_000.0

# StockVault._checkParams bounds (contracts/src/StockVault.sol)
RANGE_BPS_MIN, RANGE_BPS_MAX = 50, 2000
INTERVAL_S_MIN, INTERVAL_S_MAX = 3600, 86400

# Candicate grid. Every point must sit inside the contract bounds and is asserted so before use.
RANGE_BPS = (150, 250, 350, 500, 750, 1000, 1500, 2000)
INTERVAL_H = (6, 12, 24)


class Interval:
    """Chainlink-centred band of half-width w, recentred every interval_s seconds anchored at t0.

    Rebalances only at its checkpoints, like replay.py's daily Static: the interval is the sole knob that
    sets how often the pool is re-minted, and there is no out-of-range trigger.
    """

    def __init__(self, ref, w, t0, t1, interval_s):
        self.ref = ref
        self.w = w
        cps = [t0]
        x = t0
        while x + interval_s < t1:
            x += interval_s
            cps.append(x)
        self.checkpoints = cps

    def __call__(self, t):
        a, b = rng(self.ref.at(t), self.w)
        return ("range", a, b, False)

    def recenter(self, t):
        return None


def grid_candidates(interval_h=None):
    return [{"range_bps": r, "interval_h": h} for r in RANGE_BPS for h in INTERVAL_H if interval_h in (None, h)]


def assert_candidate_in_bounds(c):
    r = c["range_bps"]
    iv = int(round(c["interval_h"] * 3600))
    if not RANGE_BPS_MIN <= r <= RANGE_BPS_MAX:
        raise AssertionError(f"rangeBps {r} outside [{RANGE_BPS_MIN}, {RANGE_BPS_MAX}]")
    if not INTERVAL_S_MIN <= iv <= INTERVAL_S_MAX:
        raise AssertionError(f"minRebalanceInterval {iv}s outside [{INTERVAL_S_MIN}, {INTERVAL_S_MAX}]")
    return True


def finite(x):
    """Strict JSON has no NaN or Infinity; the engine can emit them on settings the vault would swamp. They become null."""
    if isinstance(x, float):
        return x if np.isfinite(x) else None
    if isinstance(x, dict):
        return {k: finite(v) for k, v in x.items()}
    if isinstance(x, list):
        return [finite(v) for v in x]
    return x


def window(days=DAYS, end=END):
    t1 = dt.datetime.fromisoformat(end).replace(tzinfo=U).timestamp()
    return t1 - days * 86400.0, t1


def score(pl, ref, t0, t1, range_bps, interval_h):
    """Held-out-style edge APR of one setting over [t0, t1): fee APR + markout APR - cost APR."""
    plan = Interval(ref, range_bps / 10000.0, t0, t1, interval_h * 3600.0)
    r = simulate(pl, CAP, t0, t1, plan, record=False)
    return apr(r["F"] + r["mk"] - r["C"], CAP, r["days"]), r["nreb"]


def decide(current_cal, current_held, candidates, margin=MARGIN_APR):
    """Pick ONE candidate by calibration alone, then test only it on held-out.

    Choosing among candidates by their held-out score would use the held-out half for selection and turn the test
    into a second calibration; the top-3 list is kept for display only.
    """
    scored = [c for c in candidates if c["calibration_apr"] is not None and c["heldout_apr"] is not None]
    if not scored:
        return "keep", None, 0.0
    pick = max(scored, key=lambda c: c["calibration_apr"])
    edge = pick["heldout_apr"] - current_held
    if edge >= margin and pick["calibration_apr"] >= current_cal:
        return "change", pick, edge
    return "keep", None, edge


def _fmt(x):
    return f"{x:.2f}" if isinstance(x, (int, float)) and np.isfinite(x) else "n/a"


def _iso(t):
    return dt.datetime.fromtimestamp(t, U).isoformat()


def load_token(sym):
    u = json.load(open(os.path.join(KEEPER, "data", "universe.json")))
    tok = next((x for x in u["tokens"] if x["symbol"] == sym), None)
    if tok is None:
        raise SystemExit(f"token {sym} not in universe.json")
    return tok


def build_proposal(sym, current_range_bps, current_interval_h, interval_h=None):
    grid = grid_candidates(interval_h)
    if not grid:
        raise SystemExit(f"--interval-h {interval_h} is not on the grid {INTERVAL_H}")
    for c in grid:
        assert_candidate_in_bounds(c)
    assert_candidate_in_bounds({"range_bps": current_range_bps, "interval_h": current_interval_h})

    tok = load_token(sym)
    t0, t1 = window()
    tm = t0 + (t1 - t0) / 2
    ref = Ref(sym)
    stock = tok["token"].lower()
    stock_is0 = int(stock, 16) < int(USDG, 16)

    pools = []
    v3 = ([tok["pool"]] if tok["pool"] else []) + [p for p in (tok["other_pools"] or []) if (p.get("volume_7d_usd") or 0) > 0]
    for p in v3:
        key = f"{sym}-v3-{p['fee_tier']}-{p['address'][2:8]}"
        TOK[key] = dict(dir=p["address"].lower(), tok0=stock_is0, fee=p["fee_tier"] / 1e6)
        try:
            pl = Pool(key, t_lo=t0 - 7200, t_hi=t1 + 7200)
        except (FileNotFoundError, ValueError):
            continue
        m = (pl.t >= t0) & (pl.t < t1)
        vol = float(pl.vol[m].sum())
        if vol < MIN_CHOICE_VOLUME_USD:
            continue
        pools.append(dict(id=p["address"], fee_tier=p["fee_tier"], volume_usd=vol, _pl=pl))
    if not pools:
        raise SystemExit(f"no v3 pool for {sym} carries ${MIN_CHOICE_VOLUME_USD:,.0f} in the window")

    def cal_key(p):
        e = score(p["_pl"], ref, t0, tm, current_range_bps, current_interval_h)[0]
        return e if np.isfinite(e) else -np.inf

    choice = max(pools, key=cal_key)
    pl = choice["_pl"]

    cur_cal, _ = score(pl, ref, t0, tm, current_range_bps, current_interval_h)
    cur_held, _ = score(pl, ref, tm, t1, current_range_bps, current_interval_h)

    scored = []
    for c in grid:
        e, n = score(pl, ref, t0, tm, c["range_bps"], c["interval_h"])
        scored.append(dict(range_bps=c["range_bps"], interval_h=c["interval_h"], calibration_apr=e, rebalances=n))
    scored.sort(key=lambda c: c["calibration_apr"] if np.isfinite(c["calibration_apr"]) else -np.inf, reverse=True)
    top = scored[:3]
    for c in top:
        h, _ = score(pl, ref, tm, t1, c["range_bps"], c["interval_h"])
        c["heldout_apr"] = h

    decision, chosen, margin = decide(cur_cal, cur_held, top)
    proposed = ({"range_bps": chosen["range_bps"], "interval_h": chosen["interval_h"]} if chosen else None)
    hint = (f"setParams with rangeBps={proposed['range_bps']}, minRebalanceInterval={proposed['interval_h'] * 3600} seconds; owner signs"
            if proposed else None)

    half = (t1 - t0) / 2 / 86400.0
    facts = [
        f"Window {DAYS:.0f} days ending {_iso(t1)}, capital ${CAP:,.0f}, pool {choice['id']} at fee {choice['fee_tier']} ppm.",
        f"Calibration is the first {half:.0f} days, held-out the second {half:.0f} days.",
        f"Current setting rangeBps={current_range_bps}, interval={current_interval_h}h scores {_fmt(cur_cal)} APR on calibration and {_fmt(cur_held)} APR on held-out.",
        f"Out of {len(grid)} grid settings the top three by calibration are: "
        + "; ".join(f"rangeBps={c['range_bps']}, interval={c['interval_h']}h: calibration {_fmt(c['calibration_apr'])}, held-out {_fmt(c['heldout_apr'])}"
                    for c in top) + ".",
    ]
    if decision == "change":
        facts.append(f"Best candidate rangeBps={chosen['range_bps']}, interval={chosen['interval_h']}h beats current on held-out by {_fmt(margin)} APR points "
                     f"(>= {MARGIN_APR:.2f}) and is not worse on calibration ({_fmt(chosen['calibration_apr'])} >= {_fmt(cur_cal)}), so the proposal is to change.")
    else:
        facts.append(f"No candidate beats current on held-out by {MARGIN_APR:.2f} APR points while not being worse on calibration "
                     f"(best held-out margin {_fmt(margin)}), so the proposal is to keep the current setting.")

    candidates = [{"range_bps": c["range_bps"], "interval_h": c["interval_h"],
                   "calibration_apr": c["calibration_apr"], "heldout_apr": c["heldout_apr"]} for c in top]
    return dict(
        token=sym,
        window=dict(start=_iso(t0), end=_iso(t1), calibration_end=_iso(tm), days=DAYS,
                    pool=choice["id"], fee_tier=choice["fee_tier"], volume_usd=choice["volume_usd"]),
        current=dict(range_bps=current_range_bps, interval_h=current_interval_h,
                     calibration_apr=cur_cal, heldout_apr=cur_held),
        candidates=candidates,
        decision=decision,
        proposed=proposed,
        margin_apr=margin,
        rationale_facts=facts,
        calldata_hint=hint,
    )


def explain(facts):
    """Optional narration through the local chatgpt CLI. Any failure returns None and never affects the decision."""
    text = ("Explain this StockVault range and rebalance-interval proposal in plain language for the vault owner, "
            "then name the single biggest risk. Use only these facts, invent no numbers.\n\n" + "\n".join(facts))
    try:
        p = subprocess.run(["chatgpt", "ask", text], capture_output=True, text=True, timeout=300)
        out = (p.stdout or "").strip()
        return out or None
    except Exception:
        return None


PARAMS_PATH = os.path.join(KEEPER, "data", "params.json")
DECIDED_BY = "strategist calibration pick"


def params_entry(res):
    """One params.json row. On change it carries the picked candidate's scores, on keep the current setting's own; margin is the held-out edge the rule tested."""
    if res["proposed"]:
        scores = next(c for c in res["candidates"] if (c["range_bps"], c["interval_h"]) == (res["proposed"]["range_bps"], res["proposed"]["interval_h"]))
        setting = res["proposed"]
    else:
        scores = setting = res["current"]
    return dict(range_bps=setting["range_bps"], interval_h=setting["interval_h"], decided_by=DECIDED_BY, decision=res["decision"],
                calibration_apr=scores["calibration_apr"], heldout_apr=scores["heldout_apr"], margin=res["margin_apr"])


def batch(interval_h, tokens, params_out, out_dir, current_range_bps, current_interval_h):
    if interval_h != 24:
        raise SystemExit("--batch requires --interval-h 24: the keeper recentres once a day")
    if not tokens:
        tokens = [t["symbol"] for t in json.load(open(os.path.join(KEEPER, "data", "universe.json")))["tokens"] if t.get("eligible")]
    if not tokens:
        raise SystemExit("no eligible token in universe.json")
    params = json.load(open(params_out)) if os.path.exists(params_out) else {}
    failed = []
    for sym in tokens:
        try:
            res = build_proposal(sym, current_range_bps, current_interval_h, interval_h)
        except BaseException as e:  # a token with no pool raises SystemExit; that fails the token, not the batch
            failed.append(sym)
            print(f"{sym}: FAILED {type(e).__name__}: {e}", flush=True)
            continue
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)
            json.dump(finite(res), open(os.path.join(out_dir, f"strat24-{sym}.json"), "w"), indent=1, allow_nan=False)
        params[sym] = params_entry(res)
        json.dump(finite(dict(sorted(params.items()))), open(params_out, "w"), indent=1, allow_nan=False)
        e = params[sym]
        print(f"{sym}: {res['decision']} range_bps={e['range_bps']} cal={_fmt(e['calibration_apr'])} held={_fmt(e['heldout_apr'])} margin={_fmt(e['margin'])}", flush=True)
    if failed:
        print(f"FAILED tokens: {','.join(failed)}", flush=True)
        return 1
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="Propose a rangeBps and minRebalanceInterval for a StockVault pool.")
    ap.add_argument("--token")
    ap.add_argument("--interval-h", type=int, default=None, help="restrict the grid to this interval")
    ap.add_argument("--batch", action="store_true", help="decide every eligible token and write --params-out")
    ap.add_argument("--tokens", default="", help="comma list for --batch; default every eligible token")
    ap.add_argument("--params-out", default=PARAMS_PATH)
    ap.add_argument("--out-dir", default=None, help="--batch: also write each token's full proposal here")
    ap.add_argument("--current-range-bps", type=int, default=500)
    ap.add_argument("--current-interval-h", type=int, default=24)
    ap.add_argument("--out", default="proposal.json")
    ap.add_argument("--explain", action="store_true")
    a = ap.parse_args(argv)
    if a.batch:
        return batch(a.interval_h, [x.strip().upper() for x in a.tokens.split(",") if x.strip()], a.params_out, a.out_dir, a.current_range_bps, a.current_interval_h)
    if not a.token:
        ap.error("--token is required unless --batch")

    res = build_proposal(a.token.upper(), a.current_range_bps, a.current_interval_h, a.interval_h)
    if a.explain:
        res["explanation"] = explain(res["rationale_facts"])
    json.dump(finite(res), open(a.out, "w"), indent=1, allow_nan=False)
    print(f"{res['token']}: decision={res['decision']} current held-out {_fmt(res['current']['heldout_apr'])} APR, margin {_fmt(res['margin_apr'])} APR -> {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
