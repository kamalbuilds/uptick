"""Precompute the 30 day replay fee APR for the vault strategy (daily recentre at the NYSE open + 5 min,
static band around Chainlink) with the spike engine. Writes data/replay.json for the stats API.
Run: python3 replay/build_replay.py   (needs numpy and the cached swap pulls in spikes/stock-vaults/data/v3)"""
import sys, os, json, datetime as dt
HERE = os.path.dirname(os.path.abspath(__file__))
SPIKE = os.path.normpath(os.path.join(HERE, "..", "..", "..", "spikes", "stock-vaults"))
os.chdir(SPIKE); sys.path.insert(0, os.path.join(SPIKE, "scripts"))
import engine
from engine import simulate, apr
from run import setup, strategies, row, U

POOLS = {  # ticker: (spike pool key, pool address, fee tier)
    "NVDA": ("NVDA", "0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3", 500),
    "TSLA": ("TSLA3", "0xf4ACdAEEB7022862A763C9B1B885e11191c889E3", 3000),
    "SPCX": ("SPCX", "0xc61284332117c3FB23A2A56cceFFD07F7aF60029", 500),
}
CAP = 100_000.0
DAYS = 30
HEAD_BLOCK = int(open("data/head.txt").read().strip())
END = dt.datetime(2026, 10, 17, tzinfo=U)
START = END - dt.timedelta(days=DAYS)
BANDS = {"B2": 0.02, "B5": 0.05, "B10": 0.10}
HEADLINE = "B5"

out = {"generated_at": dt.datetime.now(U).isoformat(), "engine": "spikes/stock-vaults/scripts/engine.py",
       "head_block_of_pull": HEAD_BLOCK, "window": {"start": START.isoformat(), "end": END.isoformat(), "days": DAYS},
       "capital_usd": CAP, "headline_strategy": HEADLINE, "cost_model": "pool price impact + fee tier + gas, engine.IMPACT=1",
       "pools": {}}
for tk, (key, addr, fee) in POOLS.items():
    S = setup(key, START, END)
    pl = S["pl"]
    m = (pl.t >= S["t0"]) & (pl.t < S["t1"])
    plans = strategies(S)
    runs = {}
    for k in BANDS:
        r = simulate(pl, CAP, S["t0"], S["t1"], plans[k], record=True)
        d = row(S, r, CAP, True)
        runs[k] = {"band_pct": BANDS[k] * 100, "fee_apr_pct": d["fee_apr"], "markout_apr_pct": d["mk_apr"], "cost_apr_pct": d["cost_apr"],
                   "edge_apr_pct": d["edge_apr"], "net_vs_hold_apr_pct": d["net_apr"], "rebalances": d["nreb"],
                   "gas_usd": d["gas_usd"], "fee_capture_pct": r["F"] / float(pl.fee_usd[m].sum()) * 100}
    out["pools"][tk] = {"pool": addr, "fee_tier": fee, "swaps_in_window": int(m.sum()),
                        "pool_volume_usd": float(pl.vol[m].sum()), "pool_fees_usd": float(pl.fee_usd[m].sum()),
                        "hold_return_pct": d["hold_ret_pct"], "runs": runs}
    print(tk, {k: round(v["fee_apr_pct"], 2) for k, v in runs.items()}, flush=True)
json.dump(out, open(os.path.join(HERE, "..", "data", "replay.json"), "w"), indent=1)
