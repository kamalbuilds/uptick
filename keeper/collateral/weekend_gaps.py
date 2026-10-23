"""Weekend gap risk of each Uptick vault's Chainlink feed on Robinhood Chain (4663), and the LLTV it allows.

Reads every round each feed proxy serves (getRoundData over every phase, batched JSON-RPC on the public keyless RPC,
bounded paging, backoff on 429), finds every market-closed silence (consecutive prints more than GAP_S apart) and the
price move across it, and writes keeper/data/weekend-gaps.json.

  max LLTV = 1 - worst adverse close-to-open move - BUFFER

The oracle prices a share at the last print through the silence, so a borrower at the limit carries the whole gap
unhedged until the first print after it. Usage: python3 keeper/collateral/weekend_gaps.py [--offline]
(--offline re-derives from the cached rounds in keeper/data/feed-rounds.json without touching the RPC).
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

RPC = "https://rpc.mainnet.chain.robinhood.com"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
UNIVERSE = os.path.join(ROOT, "api", "data", "vault-universe.json")
CACHE = os.path.join(ROOT, "keeper", "data", "feed-rounds.json")
OUT = os.path.join(ROOT, "keeper", "data", "weekend-gaps.json")

GAP_S = 12 * 3600  # a silence this long only happens when the market is shut; weekday prints are minutes apart
BUFFER = 0.05
MAX_FEED_AGE = 349_200  # UptickShareOracle.MAX_FEED_AGE (97 h)
SHARE_ELASTICITY = 0.379 / 0.40  # ShareCollateral: a -40% feed print moved the share -37.9%
BATCH = 50
MORPHO = "0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010"


def post(payload, tries=10):
    req = urllib.request.Request(
        RPC, json.dumps(payload).encode(), {"Content-Type": "application/json", "User-Agent": "uptick-weekend-gaps"}
    )
    delay = 1.0
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ConnectionError):
            if i == tries - 1:
                raise
            time.sleep(delay)
            delay = min(delay * 2, 30)


def call_data(selector, *args):
    return selector + "".join(hex(a)[2:].rjust(64, "0") for a in args)


def words(h):
    h = h[2:]
    return [int(h[i:i + 64], 16) for i in range(0, len(h), 64)]


def eth_call(to, data):
    out = post({"jsonrpc": "2.0", "id": 1, "method": "eth_call", "params": [{"to": to, "data": data}, "latest"]})
    return out.get("result"), out.get("error")


def signed(x):
    return x - (1 << 256) if x >> 255 else x


def fetch_rounds(feed):
    """Every (roundId, answer, updatedAt) the proxy serves, all phases. Paging stops at the latest round."""
    latest, _ = eth_call(feed, "0xfeaf968c")
    latest_id = words(latest)[0]
    dec = words(eth_call(feed, "0x313ce567")[0])[0]
    last_phase = latest_id >> 64
    rounds = []
    for phase in range(1, last_phase + 1):
        top = latest_id & ((1 << 64) - 1) if phase == last_phase else None
        agg = 1
        while True:
            hi = agg + BATCH - 1 if top is None else min(agg + BATCH - 1, top)
            ids = list(range(agg, hi + 1))
            if not ids:
                break
            reqs = [
                {"jsonrpc": "2.0", "id": i, "method": "eth_call",
                 "params": [{"to": feed, "data": call_data("0x9a6fc8f5", (phase << 64) | a)}, "latest"]}
                for i, a in enumerate(ids)
            ]
            res = sorted(post(reqs), key=lambda x: x["id"])
            stop = False
            for a, r in zip(ids, res):
                if "result" not in r or len(r["result"]) < 2 + 64 * 5:
                    stop = True  # past the end of a finished phase
                    break
                w = words(r["result"])
                if w[3] == 0:
                    stop = True
                    break
                rounds.append([(phase << 64) | a, signed(w[1]), w[3]])
            if stop or (top is not None and hi >= top):
                break
            agg = hi + 1
            time.sleep(0.25)
    return dec, rounds


def iso(t):
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def clean(rounds):
    """Positive answers in time order, on one scale. Every feed answered 1e8 too large (price * 1e16 against
    decimals() = 8) from its first round until a switch on 2026-06-23 around 13:51 UTC; those rounds are divided by
    1e8 and listed, so the switch is not read as a 99.999999% move."""
    rs = sorted((list(r) for r in rounds if r[1] > 0), key=lambda r: (r[2], r[0]))
    ref = rs[-1][1]
    rescaled = []
    for r in rs:
        if r[1] > ref * 10**5:
            rescaled.append(r[0])
            r[1] //= 10**8
    return rs, rescaled


def gaps(rs, dec):
    out = []
    for a, b in zip(rs, rs[1:]):
        dt = b[2] - a[2]
        if dt >= GAP_S:
            out.append({
                "close": iso(a[2]), "open": iso(b[2]), "hours": round(dt / 3600, 2),
                "close_price": a[1] / 10 ** dec, "open_price": b[1] / 10 ** dec,
                "move": b[1] / a[1] - 1, "close_round": str(a[0]), "open_round": str(b[0]),
                "weekend": datetime.fromtimestamp(a[2], timezone.utc).weekday() >= 4,
            })
    return out


def lltv_for(worst_fall):
    return 1 - worst_fall - BUFFER


def bad_debt_lltv(share_fall):
    """LLTV above which a borrower at the limit leaves bad debt after a share fall: Morpho pays the liquidator
    LIF = 1 / (1 - 0.3 * (1 - LLTV)), so a position seized whole repays collateral / LIF, short of the debt once
    LLTV * LIF > 1 - share_fall. Solved for LLTV."""
    k = 1 - share_fall
    return 0.7 * k / (1 - 0.3 * k)


def summarise(sym, dec, rs, rescaled, launching):
    g = gaps(rs, dec)
    falls = [x for x in g if x["move"] < 0]
    worst_down = min(falls, key=lambda x: x["move"]) if falls else None
    worst_abs = max(g, key=lambda x: abs(x["move"])) if g else None
    longest = max(g, key=lambda x: x["hours"]) if g else None
    wf = -worst_down["move"] if worst_down else 0.0
    lltv = lltv_for(wf)
    return {
        "symbol": sym, "launching": launching, "decimals": dec, "rounds": len(rs),
        "rescaled_rounds": {"count": len(rescaled), "first": str(rescaled[0]) if rescaled else None,
                            "last": str(rescaled[-1]) if rescaled else None},
        "first_print": iso(rs[0][2]), "last_print": iso(rs[-1][2]),
        "days": round((rs[-1][2] - rs[0][2]) / 86400, 1),
        "closed_gaps": len(g), "weekend_gaps": sum(x["weekend"] for x in g),
        "worst_gap_fall": worst_down, "worst_gap_abs": worst_abs, "longest_gap": longest,
        "longest_gap_h": longest["hours"] if longest else 0,
        "longest_gap_vs_97h": round((MAX_FEED_AGE / 3600) - (longest["hours"] if longest else 0), 2),
        "worst_fall_pct": round(100 * wf, 2),
        "share_fall_pct": round(100 * wf * SHARE_ELASTICITY, 2),
        "max_lltv_pct": round(100 * lltv, 2),
        "bad_debt_above_lltv_pct": round(100 * bad_debt_lltv(wf * SHARE_ELASTICITY), 2),
        "gaps": g,
    }


def enabled_lltvs():
    cands = [0.385, 0.5, 0.625, 0.77, 0.8, 0.86, 0.9, 0.915, 0.945, 0.965, 0.98]
    out = []
    for c in cands:
        res, _ = eth_call(MORPHO, call_data("0xb485f3b8", int(round(c * 1e18))))
        out.append({"lltv_pct": round(100 * c, 2), "enabled": bool(res and int(res, 16))})
    return out


DIRECTORY = "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json"
CONTROL_DIRECTORY = "https://reference-data-directory.vercel.app/feeds-ethereum-mainnet-arbitrum-1.json"
# Every L2 Sequencer Uptime Feed proxy listed on https://docs.chain.link/data-feeds/l2-sequencer-feeds (2026-10-23)
UPTIME_FEEDS = {
    "Arbitrum": "0xFdB631F5EE196F0ed6FAa767959853A9F217697D", "Base": "0xBCF85224fc0756B9Fa45aA7892530B47e10b6433",
    "Celo": "0x4CD491Dc27C8B0BbD10D516A502856B786939d18", "Mantle/Soneium": "0xaDE1b9AbB98c6A542E4B49db2588a3Ec4bF7Cdf0",
    "MegaETH": "0x78B2195A21B8BBe82acaB43F90F9180E9513FD0C", "Metis": "0x58218ea7422255EBE94e56b504035a784b7AA204",
    "OP": "0x371EAD81c9102C9BF4874A9075FFFf170F2Ee389", "Scroll/X Layer": "0x45c2b8C204568A03Dc7A2E32B71D67Fe97F908A9",
    "zkSync": "0x0E6AC8B967393dcD3D36677c126976157F993940",
}


def sequencer_check(nvda_feed):
    def uptime_names(url):
        req = urllib.request.Request(url, headers={"User-Agent": "uptick-weekend-gaps"})
        feeds = json.load(urllib.request.urlopen(req, timeout=60))
        hits = [f["name"] for f in feeds if any(w in json.dumps(f).lower() for w in ("uptime", "sequencer"))]
        return len(feeds), hits

    n, hits = uptime_names(DIRECTORY)
    cn, chits = uptime_names(CONTROL_DIRECTORY)
    code = {}
    for name, a in list(UPTIME_FEEDS.items()) + [("control: NVDA / USD proxy", nvda_feed)]:
        out = post({"jsonrpc": "2.0", "id": 1, "method": "eth_getCode", "params": [a, "latest"]})
        code[name] = {"address": a, "code_bytes": (len(out["result"]) - 2) // 2}
    return {
        "directory": DIRECTORY, "feeds_listed": n, "uptime_or_sequencer_feeds": hits,
        "control_directory": CONTROL_DIRECTORY, "control_feeds_listed": cn, "control_hits": chits,
        "eth_getCode_on_4663": code,
        "found": bool(hits) or any(v["code_bytes"] for k, v in code.items() if not k.startswith("control")),
    }


def selftest():
    h = 3600
    fri, mon = 1_789_000_000, 1_789_000_000 + 52 * h
    raw = [[1, 200 * 10**16, fri - 2 * h], [2, 201 * 10**8, fri - h],  # bring-up round at 1e8 scale
           [3, 200 * 10**8, fri], [4, 180 * 10**8, mon], [5, 181 * 10**8, mon + 60]]
    rs, rescaled = clean(raw)
    assert rescaled == [1] and rs[0][1] == 200 * 10**8, (rescaled, rs[0])
    row = summarise("T", 8, rs, rescaled, True)
    assert row["closed_gaps"] == 1, row["closed_gaps"]  # the 1 h step after the bring-up round is not a gap
    assert abs(row["worst_fall_pct"] - 10.0) < 1e-9, row["worst_fall_pct"]
    assert abs(row["max_lltv_pct"] - 85.0) < 1e-9, row["max_lltv_pct"]
    assert row["longest_gap_h"] == 52.0
    # at 62.5% LLTV the incentive is 1/0.8875, so bad debt starts once the share falls past 1 - 0.625/0.8875
    assert abs(bad_debt_lltv(1 - 0.625 / 0.8875) - 0.625) < 1e-12
    print("selftest ok")


def main():
    if "--selftest" in sys.argv:
        return selftest()
    uni = json.load(open(UNIVERSE))
    vaults = [(v["symbol"], v["feed"], v["gate"]["state"] in ("open", "reduced")) for v in uni["vaults"]]
    if "--offline" in sys.argv:
        cache = json.load(open(CACHE))
    else:
        cache = {"rpc": RPC, "read_at": iso(int(time.time())), "feeds": {}}
        for sym, feed, _ in vaults:
            dec, rounds = fetch_rounds(feed)
            cache["feeds"][sym] = {"feed": feed, "decimals": dec, "rounds": [[str(a), str(b), c] for a, b, c in rounds]}
            print(f"{sym}: {len(rounds)} rounds", file=sys.stderr)
        json.dump(cache, open(CACHE, "w"))
    rows = []
    for sym, feed, launching in vaults:
        f = cache["feeds"][sym]
        rs, rescaled = clean([[int(a), int(b), c] for a, b, c in f["rounds"]])
        row = summarise(sym, f["decimals"], rs, rescaled, launching)
        row["feed"] = feed
        rows.append(row)
    if "--offline" in sys.argv:
        prev = json.load(open(OUT))
        lltvs, seq = prev["morpho_enabled_lltvs"], prev.get("sequencer_uptime_feed")
    else:
        lltvs = enabled_lltvs()
        seq = sequencer_check(next(f for s_, f, _ in vaults if s_ == "NVDA"))
    launching = [r for r in rows if r["launching"]]
    worst = max(launching, key=lambda r: r["worst_fall_pct"])
    out = {
        "chain_id": 4663, "rpc": RPC, "rounds_read_at": cache["read_at"],
        "method": {
            "gap": f"consecutive Chainlink prints at least {GAP_S // 3600} h apart (the feed prints minutes apart while the market trades)",
            "move": "open print / close print - 1, the step the oracle takes at the first print after the silence",
            "max_lltv": f"1 - worst adverse gap - {int(BUFFER * 100)} pt buffer",
            "share_elasticity": SHARE_ELASTICITY,
            "share_elasticity_source": "contracts/test/ShareCollateral.t.sol test_aChainlinkFallLiquidatesAndTheLiquidatorCanExitInKind: -40% feed, -37.9% share",
            "max_feed_age_s": MAX_FEED_AGE,
        },
        "morpho_enabled_lltvs": lltvs,
        "sequencer_uptime_feed": seq,
        "launching_worst": {"symbol": worst["symbol"], "worst_fall_pct": worst["worst_fall_pct"], "max_lltv_pct": worst["max_lltv_pct"]},
        "tokens": rows,
    }
    json.dump(out, open(OUT, "w"), indent=1)
    for r in rows:
        w = r["worst_gap_fall"]
        print(f"{r['symbol']:6} {'L' if r['launching'] else ' '} rounds={r['rounds']:5} days={r['days']:6} gaps={r['closed_gaps']:3} "
              f"worst={r['worst_fall_pct']:6.2f}% ({w['close'] if w else '-'} -> {w['open'] if w else '-'}) "
              f"longest={r['longest_gap_h']:6.2f}h maxLLTV={r['max_lltv_pct']:6.2f}%")


if __name__ == "__main__":
    main()
