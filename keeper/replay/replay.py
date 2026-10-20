"""Replay of the vault strategy on every USDG pool of each eligible Stock Token, with an out-of-sample pool choice.
Strategy (the vault's): the token's own vault size `cap_usd` from data/universe.json (at most USD 100,000, smaller where the pool is thin), a band around Chainlink chosen per token (`range_bps` in data/params.json, default
500 = +-5%), recentred at 02:00 UTC on the day after each NYSE session. A slot whose Chainlink feed is older than the vault's 25 h `maxStaleness` is skipped. Engine: spikes/stock-vaults/scripts/engine.py, unchanged; its data directory is pointed at data/engine/ (swap pulls from replay/pull.py).
Window: last 30 days to 2026-10-17 00:00 UTC. First 15 days calibrate, last 15 days test.
Choice: among v3 pools (the only kind StockVault can hold) the pool with the best calibration-half edge; its test-half result is the out-of-sample figure.
Run: python3 replay/pull.py SYMBOL... && python3 replay/replay.py SYMBOL...   (needs numpy)
Output: data/replay.json (REPLAY_OUT overrides, e.g. for threshold calibration)
"""
import sys, os, json, gzip, datetime as dt
from zoneinfo import ZoneInfo
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
KEEPER = os.path.normpath(os.path.join(HERE, ".."))
SPIKE = os.path.normpath(os.path.join(KEEPER, "..", "..", "spikes", "stock-vaults"))
ENGINE_DIR = os.path.join(KEEPER, "data", "engine")
sys.path.insert(0, os.path.join(SPIKE, "scripts"))
import engine, strategies
engine.DATA = strategies.DATA = ENGINE_DIR   # both modules bound DATA at import
engine.GB = None
from engine import Pool, simulate, apr, TOK
from strategies import Ref, label_slots, rng, trading_days, HALF, REG, NIGHT, WE
sys.path.insert(0, HERE)
import pull

U = dt.timezone.utc
NY = ZoneInfo("America/New_York")  # walk NYSE session dates in the exchange timezone
CAP = 100_000.0  # ceiling on a vault; each token replays at its own universe.json cap_usd, never above this
DAYS = 30
DEFAULT_BAND_BPS = 500              # the band of a token with no entry in data/params.json
RANGE_BPS_MIN, RANGE_BPS_MAX = 50, 2000   # StockVault._checkParams bounds
PARAMS_PATH = os.environ.get("REPLAY_PARAMS") or os.path.join(KEEPER, "data", "params.json")
RECENTRE_UTC_HOUR = 2
MAX_STALENESS_S = 90_000.0
MIN_TABLE_VOLUME_USD = 250_000      # below this a pool's 30-day flow is too thin for its replay to mean anything
MAX_PRICE_GAP = 0.10                # a pool whose median price sits further than 10% from Chainlink is not the same market
DYNAMIC_FEE = 0x800000              # v4 fee flag: the hook sets the fee per swap, which the engine cannot replay
MAX_SANE_EDGE = 1000.0              # an edge beyond +-1000% a year is a model breakdown on thin data, not a measurement
MAX_MEDIAN_SWAP_USD = 1_000_000     # a median swap above this means the amounts are mis-scaled (wrong decimals)
MIN_CHOICE_VOLUME_USD = 1_000_000   # a pool must also carry this much to be the vault's target
USDG = pull.USDG
SESSION = {REG: "nyse_hours", NIGHT: "weeknight", WE: "weekend"}

def band_bps_for(sym, params):
    """The band the vault of `sym` runs, in bps: its params.json entry, else DEFAULT_BAND_BPS. The replay and the deployed vault read the same number."""
    e = params.get(sym)
    if e is None: return DEFAULT_BAND_BPS
    bps = e["range_bps"]
    assert isinstance(bps, int) and RANGE_BPS_MIN <= bps <= RANGE_BPS_MAX, f"{sym}: range_bps {bps!r} outside [{RANGE_BPS_MIN}, {RANGE_BPS_MAX}]"
    assert e.get("interval_h", 24) == 24, f"{sym}: the keeper recentres once a day, interval_h must be 24"
    return bps

def finite(x):
    """Strict JSON has no NaN or Infinity; a pool the vault would swamp can make the engine produce them. They become null."""
    if isinstance(x, float): return x if np.isfinite(x) else None
    if isinstance(x, dict): return {k: finite(v) for k, v in x.items()}
    if isinstance(x, list): return [finite(v) for v in x]
    return x

def run_metrics(pl, ref, t0, t1, plan, cap):
    r = simulate(pl, cap, t0, t1, plan, record=False)
    d = r["days"]; a = lambda v: apr(v, cap, d)
    return dict(fee_apr_pct=a(r["F"]), markout_apr_pct=-a(r["mk"]), cost_apr_pct=a(r["C"]), edge_apr_pct=a(r["F"] + r["mk"] - r["C"]), rebalances=r["nreb"])

def run_pair(pl, ref, t0, t1, plan, cap):
    """The conservative (legacy ``mixed``) share keeps the existing field names; ``path`` is the current engine default."""
    engine.SHARE = "mixed"
    out = run_metrics(pl, ref, t0, t1, plan, cap)
    engine.SHARE = "path"
    out["edge_apr_pct_upper"] = run_metrics(pl, ref, t0, t1, plan, cap)["edge_apr_pct"]
    engine.SHARE = "mixed"
    return out

class FeasibleStatic:
    """+ -w around Chainlink at the initial deploy and at each fresh 02:00 UTC after-session slot.

    A slot whose feed is older than ``MAX_STALENESS_S`` is dropped and the previous band is held, which is what the
    vault would do: the recentre transaction would revert on the bound, so no gas is spent and no new band is set.
    """
    def __init__(self, ref, w, checkpoints):
        self.ref, self.w, self.checkpoints = ref, w, list(checkpoints)
    def __call__(self, t):
        a, b = rng(self.ref.at(t), self.w); return ("range", a, b, False)
    def recenter(self, t):
        return None

def recentre_slots(ref, t0, t1):
    """Initial deploy plus 02:00 UTC on the UTC day after each NYSE trading day, strictly inside (t0, t1).

    Returns (checkpoints, requested): ``checkpoints`` is the initial deploy plus the fresh slots, ``requested`` is
    every after-session slot in the window.
    """
    kept, requested = [], []
    days = trading_days()
    d = dt.datetime.fromtimestamp(t0, NY).date()
    stop = dt.datetime.fromtimestamp(t1, NY).date()
    while d <= stop:
        if d.weekday() < 5 and d in days:
            x = dt.datetime.combine(d + dt.timedelta(days=1), dt.time(RECENTRE_UTC_HOUR)).replace(tzinfo=U).timestamp()
            if t0 < x < t1:
                requested.append(x)
                if ref.age(x) <= MAX_STALENESS_S:
                    kept.append(x)
        d += dt.timedelta(days=1)
    return [t0] + kept, requested

def v4_pool(name, pid, usdg0, fee, spacing, hooks, t_lo, t_hi):
    """Engine Pool.from_v4 reads its swaps and pool key from files; write the two it expects."""
    rows = pull.v4_rows(pid)
    gz = os.path.join(ENGINE_DIR, "tmp-v4.json.gz"); sel = os.path.join(ENGINE_DIR, "tmp-v4-sel.json")
    with gzip.open(gz, "wt") as f: json.dump({"swaps": {pid: rows}}, f)
    c0, c1 = (USDG, "0x0") if usdg0 else ("0x0", USDG)
    json.dump({pid: [name, c0, c1, fee, spacing, hooks]}, open(sel, "w"))
    return Pool.from_v4(name, pid, gz=gz, sel=sel, t_lo=t_lo, t_hi=t_hi), len(rows)

def session_split(pl, ref, t0, t1, plan, cap):
    engine.SHARE = "mixed"
    r = simulate(pl, cap, t0, t1, plan, record=True); a = r["arr"]
    slots = label_slots(t0, t1, trading_days())
    k = np.minimum(((pl.t - t0) // HALF).astype(int), len(slots) - 1); lab = slots[k]
    inwin = (pl.t >= t0) & (pl.t < t1)
    out = {}
    for L, nm in SESSION.items():
        m = (lab == L) & inwin
        F = float(a["FE"][m].sum()); M = float(-a["MK"][m].sum())
        out[nm] = dict(vault_fee_usd=F, markout_loss_usd=M, pool_volume_usd=float(pl.vol[m].sum()), fee_per_dollar_lost=(F / M if M > 0 else None))
    return out

def replay_token(u, band_bps):
    sym = u["symbol"]
    cap = float(u["cap_usd"])
    assert 0 < cap <= CAP, f"{sym}: cap_usd {cap} outside (0, {CAP}]"
    end = dt.datetime(2026, 10, 17, tzinfo=U); start = end - dt.timedelta(days=DAYS)
    t0, t1 = start.timestamp(), end.timestamp(); tm = t0 + (t1 - t0) / 2
    ref = Ref(sym)
    checkpoints, requested = recentre_slots(ref, t0, t1)
    plan = FeasibleStatic(ref, band_bps / 10000.0, checkpoints)
    stock = u["token"].lower(); stock_is0 = int(stock, 16) < int(USDG, 16)
    pools = []
    v3 = ([u["pool"]] if u["pool"] else []) + [p for p in (u["other_pools"] or []) if (p.get("volume_7d_usd") or 0) > 0]
    for p in v3:
        key = f"{sym}-v3-{p['fee_tier']}"
        TOK[key] = dict(dir=p["address"].lower(), tok0=stock_is0, fee=p["fee_tier"] / 1e6)
        pl = Pool(key, t_lo=t0 - 7200, t_hi=t1 + 7200)
        pools.append(dict(kind="v3", id=p["address"], fee_tier=p["fee_tier"], hooks=None, vault_capable=True, _pl=pl))
    v4file = os.path.join(KEEPER, "data", "swaps", f"v4-live-{sym}.json")
    live4 = json.load(open(v4file)) if os.path.exists(v4file) else []
    for p in live4:
        try: pl, n = v4_pool(f"{sym}-v4", p["id"], p["usdg_is_currency0"], p["fee"], p["tick_spacing"], p["hooks"], t0 - 7200, t1 + 7200)
        except (IndexError, ValueError): continue  # no swaps in the window
        pools.append(dict(kind="v4", id=p["id"], fee_tier=p["fee"], hooks=None if int(p["hooks"], 16) == 0 else p["hooks"], vault_capable=False, _pl=pl))
    out = []
    for p in pools:
        pl = p.pop("_pl"); m = (pl.t >= t0) & (pl.t < t1)
        if p["kind"] == "v4" and p["fee_tier"] & DYNAMIC_FEE:
            print(f"  {sym} v4 fee={p['fee_tier']} excluded: hook-set dynamic fee", flush=True); continue
        if m.any() and float(np.median(pl.vol[m])) > MAX_MEDIAN_SWAP_USD:
            print(f"  {sym} {p['kind']} fee={p['fee_tier']} excluded: median swap {float(np.median(pl.vol[m])):.3g} USD, amounts mis-scaled", flush=True); continue
        swaps = int(m.sum())
        if float(pl.vol[m].sum()) < MIN_TABLE_VOLUME_USD: continue
        idx = np.flatnonzero(m)[:: max(1, int(m.sum()) // 2000)]
        gap = float(np.median(np.abs(np.log(pl.P[idx] / np.array([ref.at(t) for t in pl.t[idx]])))))
        if not np.isfinite(gap) or gap > MAX_PRICE_GAP:
            print(f"  {sym} {p['kind']} fee={p['fee_tier']} excluded: median price {gap:.2f} log-gap from Chainlink", flush=True); continue
        row = dict(p, swaps=swaps, volume_usd=float(pl.vol[m].sum()), pool_fees_usd=float(pl.fee_usd[m].sum()),
                   full=run_pair(pl, ref, t0, t1, plan, cap), calibration=run_pair(pl, ref, t0, tm, plan, cap), test=run_pair(pl, ref, tm, t1, plan, cap))
        edges = [row[h]["edge_apr_pct"] for h in ("full", "calibration", "test")] + [row["full"]["fee_apr_pct"]]
        if not all(np.isfinite(e) and abs(e) <= MAX_SANE_EDGE for e in edges):
            print(f"  {sym} {p['kind']} fee={p['fee_tier']} excluded: non-finite or beyond {MAX_SANE_EDGE:.0f}% a year", flush=True); continue
        row["_pl"] = pl
        out.append(row)
        print(f"  {sym} {row['kind']} fee={row['fee_tier']:>7} hook={str(row['hooks'])[:10]:>10} swaps={swaps:>7} vol=${row['volume_usd']/1e6:8.2f}M "
              f"feeAPR={row['full']['fee_apr_pct']:7.1f} edge cal={row['calibration']['edge_apr_pct']:7.1f} test={row['test']['edge_apr_pct']:7.1f}", flush=True)
    slots = dict(requested=len(requested), kept=len(checkpoints) - 1)
    slots["stale"] = slots["requested"] - slots["kept"]
    return t0, tm, t1, ref, out, slots, plan, cap

def main(symbols):
    u = json.load(open(os.path.join(KEEPER, "data", "universe.json")))
    res = {"generated_at": dt.datetime.now(U).isoformat(), "engine": "spikes/stock-vaults/scripts/engine.py", "capital_usd": CAP,
           "default_band_bps": DEFAULT_BAND_BPS, "strategy": "recentre at 02:00 UTC after each NYSE session, a band chosen per token (band_bps) around Chainlink, slots older than 25 h skipped", "share_modes": dict(edge_apr_pct="mixed (legacy conservative)", edge_apr_pct_upper="path (current engine default)"), "recentre_schedule": dict(utc_hour=RECENTRE_UTC_HOUR, session_days_only=True, max_staleness_s=MAX_STALENESS_S), "cost_model": "pool price impact + fee tier + gas, engine.IMPACT=1", "tokens": {}}
    params = json.load(open(PARAMS_PATH)) if os.path.exists(PARAMS_PATH) else {}
    for sym in symbols:
        tok = next(x for x in u["tokens"] if x["symbol"] == sym)
        band_bps = band_bps_for(sym, params)
        print(sym, f"band_bps={band_bps}", flush=True)
        t0, tm, t1, ref, rows, slots, plan, cap = replay_token(tok, band_bps)
        res["window"] = dict(start=dt.datetime.fromtimestamp(t0, U).isoformat(), end=dt.datetime.fromtimestamp(t1, U).isoformat(), days=DAYS,
                             calibration_end=dt.datetime.fromtimestamp(tm, U).isoformat())
        v3 = [r for r in rows if r["vault_capable"] and r["volume_usd"] >= MIN_CHOICE_VOLUME_USD]
        chosen = max(v3, key=lambda r: r["calibration"]["edge_apr_pct"]) if v3 else None
        best_test = max(v3, key=lambda r: r["test"]["edge_apr_pct"]) if v3 else None
        ent = dict(symbol=sym, band_bps=band_bps, capital_usd=cap, pools=[{k: v for k, v in r.items() if k != "_pl"} for r in rows])
        if chosen:
            ent["chosen"] = dict(kind=chosen["kind"], id=chosen["id"], fee_tier=chosen["fee_tier"], confirmed_in_test=(best_test["id"] == chosen["id"]),
                                 rule="best calibration-half edge among v3 pools; test half is the out-of-sample figure")
            ent["sessions"] = session_split(chosen["_pl"], ref, t0, t1, plan, cap)
            ent["swaps_replayed"] = sum(r["swaps"] for r in rows)
        ent["recentre"] = slots
        res["tokens"][sym] = ent
    path = os.environ.get("REPLAY_OUT") or os.path.join(KEEPER, "data", "replay.json")
    if os.path.exists(path):  # incremental: keep the tokens of earlier runs
        old = json.load(open(path)); old.get("tokens", {}).update(res["tokens"]); res["tokens"] = old.get("tokens", res["tokens"])
    res["tokens"] = dict(sorted(res["tokens"].items()))
    json.dump(finite(res), open(path, "w"), indent=1, allow_nan=False)

if __name__ == "__main__":
    main(sys.argv[1:])
