"""Replay of the vault strategy on the Fables dynamic-fee pools (hook-set fee per swap), beside the pool the vault would use today.
Pools: data/fables-pools.json (scripts/build-fables-pools.ts: the dynamic-fee USDG pools whose hook is a Fables contract by ABI probe and Sourcify source).
Same strategy, window, halves, markout and cost model as replay.py (it is imported, not copied): band from data/params.json, recentred at 02:00 UTC after each NYSE session,
first 15 days calibrate, last 15 days test. The one change: a Fables pool books LP income at the fee each Swap event actually carried (the v4 Swap event's `fee` field,
engine.Pool.from_v4 `fee_override`), and the vault's own rebalance swaps pay the median of those fees (engine `fee0`). replay.py skips these pools because the engine
cannot replay a hook-set fee from the pool key; the event field is what makes it replayable.
Each token runs at two sizes: `cap_usd` (the size of its chosen pool's replay, same capital on both sides) and `feasible_cap_usd` (what the Fables pool's own +-5% depth carries at
the 20% share rule, replay.vault_cap_usd). The chosen pool is the venue's pool from data/replay.json, re-run here under the same code so both sides come from one run.
FABLES_FEE_MODE=static replaces every swap's fee with the chosen pool's fee tier (the must-fail: results must change when the event fee is not read).
Run: python3 replay/fables.py [SYMBOL...]   Output: data/fables-replay.json (FABLES_OUT overrides)   python3 replay/fables.py --table prints the markdown tables of the output"""
import sys, os, json, datetime as dt
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import replay as rp
from replay import Ref, U

FABLES_POOLS = os.path.join(rp.KEEPER, "data", "fables-pools.json")
OUT = os.environ.get("FABLES_OUT") or os.path.join(rp.KEEPER, "data", "fables-replay.json")
FEE_MODE = os.environ.get("FABLES_FEE_MODE", "event")  # "event" or "static"
assert FEE_MODE in ("event", "static"), FEE_MODE

def load_fables_pools(path=FABLES_POOLS):
    """symbol -> pool rows. Missing file is an error: run bun scripts/build-fables-pools.ts."""
    d = json.load(open(path)); out = {}
    for p in d["pools"]:
        assert p["protocolFee"] == 0, f"{p['symbol']} {p['poolId']}: PoolManager protocol fee {p['protocolFee']} is set; the event fee would include it, add the inversion before replaying"
        out.setdefault(p["symbol"], []).append(p)
    return out

def set_fee(pl, fee_rate):
    """Replace the per-swap fee (fraction) the pool books LP income at and the fee the vault pays on its own swaps."""
    pl.fee_rate = np.full(len(pl.t), float(fee_rate)) if np.isscalar(fee_rate) else np.asarray(fee_rate, float)
    pl.fee_usd = pl.vol * pl.fee_rate; pl.fee0 = float(np.median(pl.fee_rate))

def fee_stats(pl, m):
    """What the hook charged inside the window: volume-weighted and median fee in pips, and the distinct fee levels that carried volume."""
    f, v = pl.fee_rate[m] * 1e6, pl.vol[m]
    levels = sorted(set(np.round(f).astype(int).tolist()))
    return dict(vw_fee_pips=float((f * v).sum() / v.sum()), median_fee_pips=float(np.median(f)), min_fee_pips=float(f.min()), max_fee_pips=float(f.max()), distinct_fee_levels=len(levels))

def replay_fables_pool(u, fp, band_bps, static_pips=None):
    sym = u["symbol"]; cap = float(u["cap_usd"])
    end = dt.datetime(2026, 10, 17, tzinfo=U); start = end - dt.timedelta(days=rp.DAYS)
    t0, t1 = start.timestamp(), end.timestamp(); tm = t0 + (t1 - t0) / 2
    ref = Ref(sym)
    checkpoints, _ = rp.recentre_slots(ref, t0, t1)
    plan = rp.FeasibleStatic(ref, band_bps / 10000.0, checkpoints)
    pl, n = rp.v4_pool(f"{sym}-fables", fp["poolId"], fp["usdgIsCurrency0"], rp.DYNAMIC_FEE, fp["tickSpacing"], fp["hook"], t0 - 7200, t1 + 7200)
    m = (pl.t >= t0) & (pl.t < t1)
    if static_pips is not None: set_fee(pl, static_pips / 1e6)
    row = dict(poolId=fp["poolId"], hook=fp["hook"], hookName=fp["hookName"], swaps=int(m.sum()), volume_usd=float(pl.vol[m].sum()), pool_fees_usd=float(pl.fee_usd[m].sum()),
               **fee_stats(pl, m))
    if not m.any() or row["volume_usd"] < rp.MIN_TABLE_VOLUME_USD:
        return dict(row, excluded=f"30-day volume ${row['volume_usd']:,.0f} is below the ${rp.MIN_TABLE_VOLUME_USD:,} the replay needs to mean anything"), None
    if float(np.median(pl.vol[m])) > rp.MAX_MEDIAN_SWAP_USD:
        return dict(row, excluded="median swap above the mis-scaled-amount bound"), None
    idx = np.flatnonzero(m)[:: max(1, int(m.sum()) // 2000)]
    gap = float(np.median(np.abs(np.log(pl.P[idx] / np.array([ref.at(t) for t in pl.t[idx]])))))
    if not np.isfinite(gap) or gap > rp.MAX_PRICE_GAP:
        return dict(row, excluded=f"median price {gap:.2f} log-gap from Chainlink, not the same market"), None
    depth = fp["depthUsd5pct"]; feasible = rp.vault_cap_usd(depth, cap)
    sizes = {"same_cap": cap}
    if feasible > 0: sizes["feasible_cap"] = float(min(feasible, cap))
    res = {}
    for name, c in sizes.items():
        r = dict(cap_usd=c, full=rp.run_pair(pl, ref, t0, t1, plan, c), calibration=rp.run_pair(pl, ref, t0, tm, plan, c), test=rp.run_pair(pl, ref, tm, t1, plan, c))
        edges = [r[h]["edge_apr_pct"] for h in ("full", "calibration", "test")] + [r["full"]["fee_apr_pct"]]
        if not all(np.isfinite(e) and abs(e) <= rp.MAX_SANE_EDGE for e in edges):
            r["excluded"] = f"non-finite or beyond {rp.MAX_SANE_EDGE:.0f}% a year"
        r["worst_half"] = min(r["calibration"]["edge_apr_pct"], r["test"]["edge_apr_pct"])
        res[name] = r
    row.update(depth_usd_5pct=depth, feasible_cap_usd=feasible, sizes=res)
    row["sessions"] = rp.session_split(pl, ref, t0, t1, plan, sizes.get("feasible_cap", cap))
    return row, (t0, tm, t1)

def chosen_row(u, band_bps, allow, depths):
    """The pool this token deploys on, re-run under replay.py's code: its venue's chosen pool, at the token's cap."""
    t0, tm, t1, ref, rows, slots, plan, cap, spacing = rp.replay_token(u, band_bps, allow, depths)
    v3 = [r for r in rows if r["kind"] == "v3" and r["volume_usd"] >= rp.MIN_CHOICE_VOLUME_USD]
    v4 = [r for r in rows if r["kind"] == "v4" and r["vault_capable"]]
    c3 = max(v3, key=lambda r: r["calibration"]["edge_apr_pct"]) if v3 else None
    c4 = max(v4, key=lambda r: r["calibration"]["edge_apr_pct"]) if v4 else None
    w = lambda r: min(r["calibration"]["edge_apr_pct"], r["test"]["edge_apr_pct"])
    venue = rp.venue_for(w(c3) if c3 else None, w(c4) if c4 else None)
    c = c4 if venue == "v4" and c4 else c3
    if c is None: return None
    keep = lambda k: {kk: c[k][kk] for kk in ("fee_apr_pct", "markout_apr_pct", "cost_apr_pct", "edge_apr_pct")}
    return dict(kind=c["kind"], id=c["id"], fee_tier_pips=c["fee_tier"], hooks=c["hooks"], venue=venue, cap_usd=c.get("cap_usd", cap), volume_usd=c["volume_usd"],
                full=keep("full"), calibration=keep("calibration"), test=keep("test"), worst_half=w(c))

def compare(fab, ch):
    """Fables minus chosen, per half, in percentage points of edge APR on the same capital."""
    out = {}
    for size, r in fab["sizes"].items():
        if "excluded" in r: continue
        out[size] = {h: r[h]["edge_apr_pct"] - ch[h]["edge_apr_pct"] for h in ("calibration", "test", "full")}
        out[size]["worst_half"] = r["worst_half"] - ch["worst_half"]
        out[size]["wins_both_halves"] = bool(out[size]["calibration"] > 0 and out[size]["test"] > 0)
        out[size]["wins_worst_half"] = bool(out[size]["worst_half"] > 0)
    return out

def main(symbols):
    u = json.load(open(os.path.join(rp.KEEPER, "data", "universe.json")))
    params = json.load(open(rp.PARAMS_PATH)); allow, depths = rp.load_hook_allowlist(), rp.load_v4_depths()
    fp_all = load_fables_pools()
    syms = symbols or sorted(fp_all)
    assert syms, "no Fables pools to replay"
    res = dict(generated_at=dt.datetime.now(U).isoformat(), fee_mode=FEE_MODE, engine="spikes/stock-vaults/scripts/engine.py via replay/replay.py", pools_source="data/fables-pools.json",
               strategy="replay.py strategy: band per token, recentre 02:00 UTC after each NYSE session; Fables income at the Swap event's fee field", tokens={})
    for sym in syms:
        tok = next(x for x in u["tokens"] if x["symbol"] == sym); band = rp.band_bps_for(sym, params)
        ch = chosen_row(tok, band, allow, depths)
        pools = []
        for fp in fp_all.get(sym, []):
            static = ch["fee_tier_pips"] if FEE_MODE == "static" else None
            row, _ = replay_fables_pool(tok, fp, band, static)
            row["vs_chosen"] = compare(row, ch) if ch and "sizes" in row else {}
            pools.append(row)
            sz = row.get("sizes", {}).get("feasible_cap") or row.get("sizes", {}).get("same_cap")
            ok = sz and ch and "excluded" not in sz
            print(f"{sym:5} fables hook={fp['hook'][:10]} vol=${row['volume_usd']/1e6:8.2f}M vwFee={row['vw_fee_pips']:7.0f} levels={row['distinct_fee_levels']:3} "
                  + (f"edge cal={sz['calibration']['edge_apr_pct']:7.1f} test={sz['test']['edge_apr_pct']:7.1f}  chosen cal={ch['calibration']['edge_apr_pct']:7.1f} test={ch['test']['edge_apr_pct']:7.1f}" if ok else row.get("excluded") or (sz or {}).get("excluded", "no chosen pool")), flush=True)
        res["tokens"][sym] = dict(symbol=sym, band_bps=band, cap_usd=float(tok["cap_usd"]), chosen=ch, fables=pools)
    res["window"] = dict(start="2026-09-17T00:00:00+00:00", end="2026-10-17T00:00:00+00:00", days=rp.DAYS, calibration_end="2026-10-02T00:00:00+00:00")
    json.dump(rp.finite(res), open(OUT, "w"), indent=1, allow_nan=False)

def markdown_table(res, size):
    """One row per replayed Fables pool: edge APR (percent a year, weaker/first/second half) on the Fables pool at `size` ("same_cap" or "feasible_cap") beside the chosen pool."""
    f = lambda x: f"{x:+.1f}"
    rows = ["| token | Fables vol 30d | Fables fee (vw pips) | Fables size | Fables cal | Fables test | chosen pool | chosen cal | chosen test | cal diff | test diff | verdict |", "| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |"]
    for sym, t in res["tokens"].items():
        ch = t["chosen"]
        for p in t["fables"]:
            r = p.get("sizes", {}).get(size)
            if r is None or "excluded" in r:
                why = p.get("excluded") or (r or {}).get("excluded") or "no Fables vault size fits the pool depth"
                rows.append(f"| {sym} | {p['volume_usd']/1e6:.2f}M | {p['vw_fee_pips']:.0f} | n/a | n/a | n/a | {ch['kind']} {ch['fee_tier_pips']} | {f(ch['calibration']['edge_apr_pct'])} | {f(ch['test']['edge_apr_pct'])} | n/a | n/a | not replayed: {why} |")
                continue
            c = p["vs_chosen"][size]
            verdict = "Fables wins both halves" if c["wins_both_halves"] else "Fables wins weaker half only" if c["wins_worst_half"] else "chosen pool keeps more"
            rows.append(f"| {sym} | {p['volume_usd']/1e6:.2f}M | {p['vw_fee_pips']:.0f} | ${r['cap_usd']:,.0f} | {f(r['calibration']['edge_apr_pct'])} | {f(r['test']['edge_apr_pct'])} | {ch['kind']} {ch['fee_tier_pips']} | {f(ch['calibration']['edge_apr_pct'])} | {f(ch['test']['edge_apr_pct'])} | {f(c['calibration'])} | {f(c['test'])} | {verdict} |")
    return "\n".join(rows)

if __name__ == "__main__":
    if sys.argv[1:2] == ["--table"]:
        r = json.load(open(OUT))
        for size in ("feasible_cap", "same_cap"): print(f"\n{size}\n{markdown_table(r, size)}")
    else:
        main(sys.argv[1:])
