"""Replay of the vault strategy on every USDG pool of each eligible Stock Token, with an out-of-sample pool choice.
Strategy (the vault's): USD 100,000, +-5% around Chainlink, recentred daily at NYSE open + 5 min. Engine: spikes/stock-vaults/scripts/engine.py,
unchanged; its data directory is pointed at data/engine/ (swap pulls from replay/pull.py).
Window: last 30 days to 2026-10-17 00:00 UTC. First 15 days calibrate, last 15 days test.
Choice: among v3 pools (the only kind StockVault can hold) the pool with the best calibration-half edge; its test-half result is the out-of-sample figure.
Run: python3 replay/pull.py SYMBOL... && python3 replay/replay.py SYMBOL...   (needs numpy)
Output: data/replay.json (REPLAY_OUT overrides, e.g. for threshold calibration)
"""
import sys, os, json, gzip, datetime as dt
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
from strategies import Ref, Static, label_slots, trading_days, HALF, REG, NIGHT, WE
sys.path.insert(0, HERE)
import pull

U = dt.timezone.utc
CAP = 100_000.0
DAYS = 30
BAND = 0.05
MIN_TABLE_VOLUME_USD = 250_000      # below this a pool's 30-day flow is too thin for its replay to mean anything
MIN_CHOICE_VOLUME_USD = 1_000_000   # a pool must also carry this much to be the vault's target
USDG = pull.USDG
SESSION = {REG: "nyse_hours", NIGHT: "weeknight", WE: "weekend"}

def finite(x):
    """Strict JSON has no NaN or Infinity; a pool the vault would swamp can make the engine produce them. They become null."""
    if isinstance(x, float): return x if np.isfinite(x) else None
    if isinstance(x, dict): return {k: finite(v) for k, v in x.items()}
    if isinstance(x, list): return [finite(v) for v in x]
    return x

def run_metrics(pl, ref, t0, t1):
    r = simulate(pl, CAP, t0, t1, Static(ref, BAND, t0, t1), record=False)
    d = r["days"]; a = lambda v: apr(v, CAP, d)
    return dict(fee_apr_pct=a(r["F"]), markout_apr_pct=-a(r["mk"]), cost_apr_pct=a(r["C"]), edge_apr_pct=a(r["F"] + r["mk"] - r["C"]), rebalances=r["nreb"])

def v4_pool(name, pid, usdg0, fee, spacing, hooks, t_lo, t_hi):
    """Engine Pool.from_v4 reads its swaps and pool key from files; write the two it expects."""
    rows = pull.v4_rows(pid)
    gz = os.path.join(ENGINE_DIR, "tmp-v4.json.gz"); sel = os.path.join(ENGINE_DIR, "tmp-v4-sel.json")
    with gzip.open(gz, "wt") as f: json.dump({"swaps": {pid: rows}}, f)
    c0, c1 = (USDG, "0x0") if usdg0 else ("0x0", USDG)
    json.dump({pid: [name, c0, c1, fee, spacing, hooks]}, open(sel, "w"))
    return Pool.from_v4(name, pid, gz=gz, sel=sel, t_lo=t_lo, t_hi=t_hi), len(rows)

def session_split(pl, ref, t0, t1):
    plan = Static(ref, BAND, t0, t1)
    r = simulate(pl, CAP, t0, t1, plan, record=True); a = r["arr"]
    slots = label_slots(t0, t1, trading_days())
    k = np.minimum(((pl.t - t0) // HALF).astype(int), len(slots) - 1); lab = slots[k]
    inwin = (pl.t >= t0) & (pl.t < t1)
    out = {}
    for L, nm in SESSION.items():
        m = (lab == L) & inwin
        F = float(a["FE"][m].sum()); M = float(-a["MK"][m].sum())
        out[nm] = dict(vault_fee_usd=F, markout_loss_usd=M, pool_volume_usd=float(pl.vol[m].sum()), fee_per_dollar_lost=(F / M if M > 0 else None))
    return out

def replay_token(u):
    sym = u["symbol"]
    end = dt.datetime(2026, 10, 17, tzinfo=U); start = end - dt.timedelta(days=DAYS)
    t0, t1 = start.timestamp(), end.timestamp(); tm = t0 + (t1 - t0) / 2
    ref = Ref(sym)
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
        swaps = int(m.sum())
        if float(pl.vol[m].sum()) < MIN_TABLE_VOLUME_USD: continue
        row = dict(p, swaps=swaps, volume_usd=float(pl.vol[m].sum()), pool_fees_usd=float(pl.fee_usd[m].sum()),
                   full=run_metrics(pl, ref, t0, t1), calibration=run_metrics(pl, ref, t0, tm), test=run_metrics(pl, ref, tm, t1))
        row["_pl"] = pl
        out.append(row)
        print(f"  {sym} {row['kind']} fee={row['fee_tier']:>7} hook={str(row['hooks'])[:10]:>10} swaps={swaps:>7} vol=${row['volume_usd']/1e6:8.2f}M "
              f"feeAPR={row['full']['fee_apr_pct']:7.1f} edge cal={row['calibration']['edge_apr_pct']:7.1f} test={row['test']['edge_apr_pct']:7.1f}", flush=True)
    return t0, tm, t1, ref, out

def main(symbols):
    u = json.load(open(os.path.join(KEEPER, "data", "universe.json")))
    res = {"generated_at": dt.datetime.now(U).isoformat(), "engine": "spikes/stock-vaults/scripts/engine.py", "capital_usd": CAP,
           "band_pct": BAND * 100, "strategy": f"daily recentre at the NYSE open + 5 min, +-{BAND * 100:.0f}% around Chainlink", "cost_model": "pool price impact + fee tier + gas, engine.IMPACT=1", "tokens": {}}
    for sym in symbols:
        tok = next(x for x in u["tokens"] if x["symbol"] == sym)
        print(sym, flush=True)
        t0, tm, t1, ref, rows = replay_token(tok)
        res["window"] = dict(start=dt.datetime.fromtimestamp(t0, U).isoformat(), end=dt.datetime.fromtimestamp(t1, U).isoformat(), days=DAYS,
                             calibration_end=dt.datetime.fromtimestamp(tm, U).isoformat())
        v3 = [r for r in rows if r["vault_capable"] and r["volume_usd"] >= MIN_CHOICE_VOLUME_USD]
        chosen = max(v3, key=lambda r: r["calibration"]["edge_apr_pct"]) if v3 else None
        best_test = max(v3, key=lambda r: r["test"]["edge_apr_pct"]) if v3 else None
        ent = dict(symbol=sym, pools=[{k: v for k, v in r.items() if k != "_pl"} for r in rows])
        if chosen:
            ent["chosen"] = dict(kind=chosen["kind"], id=chosen["id"], fee_tier=chosen["fee_tier"], confirmed_in_test=(best_test["id"] == chosen["id"]),
                                 rule="best calibration-half edge among v3 pools; test half is the out-of-sample figure")
            ent["sessions"] = session_split(chosen["_pl"], ref, t0, t1)
            ent["swaps_replayed"] = sum(r["swaps"] for r in rows)
        res["tokens"][sym] = ent
    path = os.environ.get("REPLAY_OUT") or os.path.join(KEEPER, "data", "replay.json")
    if os.path.exists(path):  # incremental: keep the tokens of earlier runs
        old = json.load(open(path)); old.get("tokens", {}).update(res["tokens"]); res["tokens"] = old.get("tokens", res["tokens"])
    res["tokens"] = dict(sorted(res["tokens"].items()))
    json.dump(finite(res), open(path, "w"), indent=1, allow_nan=False)

if __name__ == "__main__":
    main(sys.argv[1:])
