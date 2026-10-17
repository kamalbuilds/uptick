"""Swap and Chainlink history pulls for the replay. Public RPC only, bounded pages, cached per page.
Usage: python3 replay/pull.py SYMBOL...      (reads data/universe.json; writes data/swaps/ and data/engine/)
Layout (all gitignored):
  data/engine/v3/<pool>/<a>-<b>.json   rows [block, logIndex, sqrtPriceX96, liquidity, tick, amount0, amount1]  (engine.Pool format)
  data/engine/cl-<SYMBOL>.json         rows [block, answer(1e8), updatedAt]                                      (engine Ref format)
  data/swaps/v4/<poolId>/<a>-<b>.json  rows [block, logIndex, tx, sender, amount0, amount1, sqrtP, L, tick, fee]  (engine.Pool.from_v4 format)
  data/swaps/v4-pools.json             v4 USDG pools per token with hook flags
"""
import sys, os, json, concurrent.futures as cf
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
KEEPER = os.path.normpath(os.path.join(HERE, ".."))
SPIKE = os.path.normpath(os.path.join(KEEPER, "..", "..", "spikes", "stock-vaults"))
sys.path.insert(0, os.path.join(SPIKE, "scripts"))
from rpc import logs, call, s  # public-RPC helpers with bisection on range or 10,000-log pages

ENGINE_DIR = os.path.join(KEEPER, "data", "engine")
SWAPS_DIR = os.path.join(KEEPER, "data", "swaps")
USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168"
PM = "0x8366a39CC670B4001A1121B8F6A443A643e40951"
V3_SWAP = "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67"
V4_SWAP = "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f"
V4_INIT = "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438"
AU = "0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f"
PAGE = int(os.environ.get("PAGE", "400000"))
THREADS = int(os.environ.get("THREADS", "4"))
TAKE_MASK = 0b1111  # beforeSwapReturnsDelta, afterSwapReturnsDelta, afterAddLiquidityReturnsDelta, afterRemoveLiquidityReturnsDelta

def grid():
    g = json.load(open(os.path.join(ENGINE_DIR, "grid.json"))); k = sorted((int(a), b) for a, b in g.items())
    return np.array([a for a, _ in k], float), np.array([b for _, b in k], float)

def time_to_block(t):
    gb, gt = grid(); return int(np.interp(t, gt, gb))

def pad(a): return "0x" + "0" * 24 + a.lower().replace("0x", "")

def pull_v3(pool, a0, a1):
    d = os.path.join(ENGINE_DIR, "v3", pool.lower()); os.makedirs(d, exist_ok=True)
    def parse(l):
        w = [int(l["data"][2:][i * 64:(i + 1) * 64], 16) for i in range(5)]
        return [int(l["blockNumber"], 16), int(l["logIndex"], 16), w[2], w[3], s(w[4], 24), s(w[0], 256), s(w[1], 256)]
    def job(a):
        b = min(a + PAGE - 1, a1); f = f"{d}/{a}-{b}.json"
        if os.path.exists(f): return len(json.load(open(f)))
        rows = sorted(parse(l) for l in logs(a, b, pool, [V3_SWAP]))
        json.dump(rows, open(f + ".tmp", "w")); os.rename(f + ".tmp", f); return len(rows)
    with cf.ThreadPoolExecutor(THREADS) as ex: return sum(ex.map(job, range(a0, a1 + 1, PAGE)))

def pull_v4(pids, a0, a1):
    """Swap logs of several v4 pools at once (topic OR-list), cached per pool per page."""
    def s128(x): x &= (1 << 128) - 1; return x - (1 << 128) if x >> 127 else x
    def parse(l):
        w = [int(l["data"][2:][i * 64:(i + 1) * 64], 16) for i in range(6)]
        return [int(l["blockNumber"], 16), int(l["logIndex"], 16), l["transactionHash"], "0x" + l["topics"][2][-40:],
                s128(w[0]), s128(w[1]), w[2], w[3], s(w[4] & 0xffffff, 24), w[5]]
    for pid in pids: os.makedirs(os.path.join(SWAPS_DIR, "v4", pid.lower()), exist_ok=True)
    def job(a):
        b = min(a + PAGE - 1, a1)
        files = {pid: os.path.join(SWAPS_DIR, "v4", pid.lower(), f"{a}-{b}.json") for pid in pids}
        if all(os.path.exists(f) for f in files.values()): return 0
        by = {pid.lower(): [] for pid in pids}
        for l in logs(a, b, PM, [V4_SWAP, [p.lower() for p in pids]]): by[l["topics"][1].lower()].append(parse(l))
        for pid, f in files.items():
            json.dump(sorted(by[pid.lower()]), open(f + ".tmp", "w")); os.rename(f + ".tmp", f)
        return sum(len(v) for v in by.values())
    with cf.ThreadPoolExecutor(THREADS) as ex: return sum(ex.map(job, range(a0, a1 + 1, PAGE)))

STATE_VIEW = "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b"
def v4_liquidity(pid):
    return int(call("eth_call", [{"to": STATE_VIEW, "data": "0xfa6793d5" + pid[2:].lower()}, "latest"]), 16)

def v4_rows(pid):
    import glob
    rows = []
    for f in sorted(glob.glob(os.path.join(SWAPS_DIR, "v4", pid.lower(), "*.json")), key=lambda p: int(os.path.basename(p).split("-")[0])): rows += json.load(open(f))
    rows.sort(key=lambda r: (r[0], r[1])); return rows

def discover_v4(stock, head):
    """Initialize logs for (USDG, stock) in both currency orders, from block 1 in 2M-block pages (sparse topic, so cheap)."""
    out = []
    for c0, c1 in ((USDG, stock.lower()), (stock.lower(), USDG)):
        if int(c0, 16) > int(c1, 16): continue  # v4 orders currencies by address: only the ascending pair can exist
        for a in range(1, head + 1, 2_000_000):
            for l in logs(a, min(a + 1_999_999, head), PM, [V4_INIT, None, pad(c0), pad(c1)]):
                w = [int(l["data"][2:][i * 64:(i + 1) * 64], 16) for i in range(5)]
                hook = "0x" + format(w[2], "040x")
                out.append(dict(id=l["topics"][1], currency0=c0, currency1=c1, fee=w[0], tick_spacing=s(w[1] & 0xffffff, 24), hooks=hook,
                                init_block=int(l["blockNumber"], 16), take_capable=bool(int(hook, 16) & TAKE_MASK), usdg_is_currency0=(c0 == USDG)))
    return out

def pull_cl(symbol, aggregator, a0, a1):
    out = []
    for x in range(a0, a1 + 1, 2_000_000):
        for l in logs(x, min(x + 1_999_999, a1), aggregator, [AU]):
            out.append([int(l["blockNumber"], 16), s(int(l["topics"][1], 16), 256), int(l["data"], 16)])
    out.sort(); json.dump(out, open(os.path.join(ENGINE_DIR, f"cl-{symbol}.json"), "w")); return len(out)

def window(days=30, end="2026-10-17"):
    import datetime as dt
    U = dt.timezone.utc; t1 = dt.datetime.fromisoformat(end).replace(tzinfo=U).timestamp(); return t1 - days * 86400, t1

if __name__ == "__main__":
    u = json.load(open(os.path.join(KEEPER, "data", "universe.json")))
    t0, t1 = window(); b0, b1 = time_to_block(t0 - 7200), time_to_block(t1 + 7200)
    head = int(call("eth_blockNumber", []), 16)
    cl_from = time_to_block(t0 - 10 * 86400)
    v4all = json.load(open(os.path.join(SWAPS_DIR, "v4-pools.json"))) if os.path.exists(os.path.join(SWAPS_DIR, "v4-pools.json")) else {}
    os.makedirs(SWAPS_DIR, exist_ok=True)
    for sym in sys.argv[1:]:
        t = next(x for x in u["tokens"] if x["symbol"] == sym)
        print(sym, "window blocks", b0, b1, flush=True)
        n = pull_cl(sym, t["feed"]["aggregator"], cl_from, b1); print(sym, "chainlink rounds", n, flush=True)
        pools = ([t["pool"]] if t["pool"] else []) + (t["other_pools"] or [])
        for p in pools:
            if p.get("volume_7d_usd") in (None, 0) and p is not t["pool"]: continue
            n = pull_v3(p["address"], b0, b1); print(sym, "v3", p["fee_tier"], p["address"], n, "swaps", flush=True)
        if os.environ.get("V3_ONLY"): continue  # threshold calibration: the deepest v3 pool is enough
        if sym not in v4all or os.environ.get("REDISCOVER"):
            v4all[sym] = discover_v4(t["token"], head); json.dump(v4all, open(os.path.join(SWAPS_DIR, "v4-pools.json"), "w"), indent=1)
        cand = [p for p in v4all[sym] if not p["take_capable"] and (p["fee"] <= 100_000 or p["fee"] == 0x800000)]
        with cf.ThreadPoolExecutor(8) as ex: live = [p for p, L in zip(cand, ex.map(lambda p: v4_liquidity(p["id"]), cand)) if L > 0]
        print(sym, "v4 pools", len(v4all[sym]), "hook-free or non-take", len(cand), "with liquidity", len(live), flush=True)
        for p in v4all[sym]:
            if p["take_capable"] and v4_liquidity(p["id"]) > 0: print(sym, "v4 skipped (take-capable hook with liquidity)", p["hooks"], p["id"][:12])
        pull_v4([p["id"] for p in live], b0, b1)
        json.dump(live, open(os.path.join(SWAPS_DIR, f"v4-live-{sym}.json"), "w"), indent=1)
        print(sym, "v4 pulled", [(p["fee"], p["id"][:10]) for p in live], flush=True)
