"""Do-it-yourself baseline for the vault replay: what the same 30 days, the same two 15-day halves and the same markout and cost model
keep for a person who adds the liquidity to Uniswap by hand instead of holding vault shares.

Every variant runs through replay.run_pair (engine.simulate, mixed share for `edge_apr_pct`, path share for `edge_apr_pct_upper`) at the
capital of the pool it sits in; only the plan differs from the vault's rp.FeasibleStatic (a band around Chainlink, recentred 02:00 UTC after each NYSE session).
  hold            the stock token held with no position: its price move at the vault's pool, annualised. Total return with inventory drift included, no fees, no cost; reported beside the variants (not one of VARIANTS)
  set_and_forget  the vault's pool and the token's chosen band width, one range centred on the pool price at the start of the window, never moved
  manual_lp       the widest-volume pool without a hook (v3 or v4), a +-10% range centred on the pool price at the start of the window, never moved
  full_range_v3   the widest-volume v3 pool, one full-range position, never moved
Every range bound of the vault and of the set-once positions is snapped outward to the pool's tick spacing (replay.snap_range). Full-range v3 holds the pool's whole price range.
`edge_apr_pct` (fees less markout less cost) leaves the position's own inventory drift out; `total_return_apr_pct` is what the depositor of the stock token ends with against the deposit, drift included, so it is the figure that sits beside hold.
The position opens once, at the start of the 30-day window, and is never moved: the test half meets the range the position already holds (the vault's halves recentre daily, so they start fresh).
Entry swaps are free for the vault and for every variant (engine entry_free), so no variant is charged for getting into the pair.
Run: python3 replay/diy_baseline.py [SYMBOL...]    (defaults to every token in data/replay.json; needs numpy; run replay/pull.py first)
Output: data/diy-baseline.json and its copy web/lib/diy-baseline.json (DIY_OUT overrides the first); prints the table.
"""
import sys, os, json, datetime as dt
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import replay as rp
from engine import simulate  # noqa: F401  (engine is on the path after replay import)
from strategies import Full, rng

MANUAL_RANGE = 0.10
REOPEN_PER_HALF = bool(os.environ.get("DIY_REOPEN_PER_HALF"))   # sensitivity only: open a fresh range at the start of each half instead of holding the window-start range
VARIANTS = ("set_and_forget", "manual_lp", "full_range_v3")
LABELS = {"set_and_forget": "Set and forget (vault pool, vault width)", "manual_lp": "Manual LP (widest pool, +-10%)", "full_range_v3": "Full-range v3 (widest v3 pool)"}
REPLAY_PATH = os.path.join(rp.KEEPER, "data", "replay.json")
OUT_PATH = os.environ.get("DIY_OUT") or os.path.join(rp.KEEPER, "data", "diy-baseline.json")
WEB_COPY = os.path.normpath(os.path.join(rp.KEEPER, "..", "web", "lib", "diy-baseline.json"))


class FixedRange:
    """One price range, set when the position opens and never moved: no recentre slots, no out-of-range trigger."""
    def __init__(self, a, b, t_start):
        self.range, self.checkpoints = (a, b), [t_start]
    def __call__(self, t):
        return ("range", self.range[0], self.range[1], False)
    def recenter(self, t):
        return None


def fixed_plan(pl, width, t_open, t_start, spacing, stock_is0):
    """The position opened at `t_open`: +-width around the pool price then, each bound snapped outward to the pool's tick spacing. A half that starts later (`t_start`) meets the same range, still in place."""
    a, b = rp.snap_range(*rng(pl.price_at(t_open), width), spacing, stock_is0)
    return FixedRange(a, b, t_start)


def full_range_plan(pl, t_start):
    return Full(pl, t_start)


def in_range_share(pl, t_a, t_b, seg_t, seg_lo, seg_hi):
    """Share of [t_a, t_b) the pool price sits inside the position's range, sampled every 60 s. The range in force from seg_t[i] is [seg_lo[i], seg_hi[i]]."""
    g = np.arange(t_a, t_b, 60.0)
    p = pl.P[np.clip(np.searchsorted(pl.t, g, side="right") - 1, 0, pl.n - 1)]
    k = np.clip(np.searchsorted(seg_t, g, side="right") - 1, 0, len(seg_t) - 1)
    return float(np.mean((p >= seg_lo[k]) & (p <= seg_hi[k])))


def fixed_share(pl, plan, spans):
    return {h: in_range_share(pl, a, b, [a], np.array([plan.range[0]]), np.array([plan.range[1]])) for h, (a, b) in spans.items()}


def windows(t0, tm, t1):
    return dict(full=(t0, t1), calibration=(t0, tm), test=(tm, t1))


def total_return_apr(pl, t_a, t_b, plan, cap):
    """What the depositor ends with against what they put in, annualised: the position's fees plus its mark at the end (net of rebalance costs) less the deposit.
    The deposit is the stock token, so the position's inventory drift is in this number; `edge_apr_pct` leaves it out."""
    rp.engine.SHARE = "mixed"
    r = rp.simulate(pl, cap, t_a, t_b, plan, record=False)
    return rp.apr(r["F"] + r["Vend"] - cap, cap, r["days"])


def hold_apr(pl, t_a, t_b):
    """Total return of holding the stock token over [t_a, t_b) with no position at all, annualised: its price move at the pool, no fees, no cost."""
    p0, p1 = pl.price_at(t_a), float(pl.P[pl.idx_at(t_b)])
    return (p1 / p0 - 1) * 365.0 / ((t_b - t_a) / 86400.0) * 100.0


def run_variant(pl, ref, spans, cap, make_plan):
    """Metrics for the full window and both halves; `make_plan(t_start)` builds the position that opens at that half's start."""
    out = {}
    for h, (a, b) in spans.items():
        plan = make_plan(a)
        out[h] = rp.run_pair(pl, ref, a, b, plan, cap)
        out[h]["total_return_apr_pct"] = total_return_apr(pl, a, b, plan, cap)
        if isinstance(plan, FixedRange): out[h]["in_range_share"] = fixed_share(pl, plan, {h: (a, b)})[h]
    return out


def weaker_half(res):
    return min(res["calibration"]["edge_apr_pct"], res["test"]["edge_apr_pct"])


def weaker_total(res):
    return min(res["calibration"]["total_return_apr_pct"], res["test"]["total_return_apr_pct"])


def widest(rows, pred):
    c = [r for r in rows if pred(r)]
    return max(c, key=lambda r: r["volume_usd"]) if c else None


def entry(row, res, **extra):
    return dict(pool=row["id"], kind=row["kind"], fee_tier=row["fee_tier"], hooks=row["hooks"], volume_usd=row["volume_usd"],
                **extra, **res, weaker_half_edge_apr_pct=weaker_half(res), weaker_half_total_return_apr_pct=weaker_total(res))


def vault_row(rep_tok, rows):
    """The pool the vault is gated on: chosen_v4 when the token deploys on v4, else chosen (replay.json is the source of the choice)."""
    c = rep_tok["chosen_v4"] if rep_tok.get("venue") == "v4" and rep_tok.get("chosen_v4") else rep_tok["chosen"]
    return next(r for r in rows if r["id"] == c["id"]), ("v4" if c is rep_tok.get("chosen_v4") else "v3")


def assert_independent(vault, variant, what):
    """The baseline must not be the vault's own result. Raised when a variant's three windows all match the vault's to the last digit."""
    same = all(vault[h]["edge_apr_pct"] == variant[h]["edge_apr_pct"] and vault[h]["rebalances"] == variant[h]["rebalances"] for h in ("full", "calibration", "test"))
    if same:
        raise AssertionError(f"{what}: identical to the vault result in every window, the baseline ran the vault's code path")


def diy_token(sym, tok, rep_tok, params, allow, depths):
    band_bps = rp.band_bps_for(sym, params)
    t0, tm, t1, ref, rows, _slots, cap = rp.replay_token(tok, band_bps, allow, depths)
    spans = windows(t0, tm, t1)
    t_open = (lambda a: a) if REOPEN_PER_HALF else (lambda a: t0)   # one position opened at the window start, held through both halves
    vrow, venue = vault_row(rep_tok, rows)
    pl = vrow["_pl"]; vcap = vrow.get("cap_usd", cap)
    vault = {h: dict(vrow[h]) for h in spans}
    plan = vrow["_plan"]
    seg_t = np.array(plan.checkpoints); seg_b = np.array([plan.bounds(c) for c in seg_t])
    for h, (a, b) in spans.items():
        vault[h]["in_range_share"] = in_range_share(pl, a, b, seg_t, seg_b[:, 0], seg_b[:, 1])
        vault[h]["total_return_apr_pct"] = total_return_apr(pl, a, b, plan, vrow.get("cap_usd", cap))
    for h in spans:  # the vault numbers re-derived here must be the published ones
        for k, v in next(p for p in rep_tok["pools"] if p["id"] == vrow["id"])[h].items():
            assert abs(vault[h][k] - v) < 1e-9, f"{sym} vault {h}.{k}: re-derived {vault[h][k]} != replay.json {v}"
    px = pl.P[(pl.t >= t0) & (pl.t < t1)]
    out = dict(symbol=sym, band_bps=band_bps, venue=venue, pool_price_move_pct=float((px[-1] / px[0] - 1) * 100), pool_price_excursion_pct=float(max(px.max() / px[0] - 1, 1 - px.min() / px[0]) * 100), vault=dict(pool=vrow["id"], kind=vrow["kind"], fee_tier=vrow["fee_tier"], capital_usd=vcap, **vault,
                                                                      weaker_half_edge_apr_pct=weaker_half(vault), weaker_half_total_return_apr_pct=weaker_total(vault)))
    hold = {h: dict(return_apr_pct=hold_apr(pl, a, b), price_move_pct=float((pl.P[pl.idx_at(b)] / pl.price_at(a) - 1) * 100)) for h, (a, b) in spans.items()}
    out["hold"] = dict(pool=vrow["id"], **hold, weaker_half_return_apr_pct=min(hold["calibration"]["return_apr_pct"], hold["test"]["return_apr_pct"]),
                       rule="the stock token held with no position: its price move at the vault's pool over each window, annualised; no fees, no cost, inventory drift included")
    out["set_and_forget"] = entry(vrow, run_variant(pl, ref, spans, vcap, lambda a: fixed_plan(pl, band_bps / 1e4, t_open(a), a, vrow["tick_spacing"], vrow["_plan"].stock_is0)), capital_usd=vcap,
                                  width_pct=band_bps / 100.0, rule="vault pool, vault width, one range centred on the pool price at the window start, bounds snapped outward to the pool's tick spacing")
    mrow = widest(rows, lambda r: r["hooks"] is None)
    mcap = mrow.get("cap_usd", cap)
    out["manual_lp"] = entry(mrow, run_variant(mrow["_pl"], ref, spans, mcap, lambda a: fixed_plan(mrow["_pl"], MANUAL_RANGE, t_open(a), a, mrow["tick_spacing"], mrow["_plan"].stock_is0)), capital_usd=mcap,
                             width_pct=MANUAL_RANGE * 100, rule="widest 30-day volume among hookless pools, +-10% centred on the pool price at the window start, bounds snapped outward to the pool's tick spacing")
    frow = widest(rows, lambda r: r["kind"] == "v3")
    fcap = frow.get("cap_usd", cap)
    out["full_range_v3"] = entry(frow, run_variant(frow["_pl"], ref, spans, fcap, lambda a: full_range_plan(frow["_pl"], a)), capital_usd=fcap,
                                 width_pct=None, rule="widest 30-day volume among v3 pools, full range from the window start")
    for v in VARIANTS:
        assert_independent(vault, out[v], f"{sym} {v}")
        out[v]["vs_vault_weaker_half_pts"] = out["vault"]["weaker_half_edge_apr_pct"] - out[v]["weaker_half_edge_apr_pct"]
        out[v]["vs_vault_weaker_half_total_return_pts"] = out["vault"]["weaker_half_total_return_apr_pct"] - out[v]["weaker_half_total_return_apr_pct"]
    out["hold"]["vs_vault_weaker_half_total_return_pts"] = out["vault"]["weaker_half_total_return_apr_pct"] - out["hold"]["weaker_half_return_apr_pct"]
    return out


def summary(tokens):
    """Counts and medians over `tokens`, and the same over the tokens whose vault weaker half clears the floor (the vaults that launch; the others take no deposits)."""
    def block(ts):
        n = len(ts)
        med = lambda d: None if not d else sorted(d)[n // 2] if n % 2 else (sorted(d)[n // 2 - 1] + sorted(d)[n // 2]) / 2
        out = dict(tokens=n, vault=dict(keeps_positive=int(sum(t["vault"]["weaker_half_edge_apr_pct"] >= 0 for t in ts))))
        for v in VARIANTS:
            d = [t[v]["vs_vault_weaker_half_pts"] for t in ts]
            out[v] = dict(vault_ahead=int(sum(x > 0 for x in d)), median_vault_minus_diy_pts=med(d), diy_keeps_positive=int(sum(t[v]["weaker_half_edge_apr_pct"] >= 0 for t in ts)),
                          median_in_range_share=med([t[v]["full"]["in_range_share"] for t in ts]) if v != "full_range_v3" else 1.0)
        out["vault"]["median_in_range_share"] = med([t["vault"]["full"]["in_range_share"] for t in ts])
        wk = dict(hold=[t["hold"]["weaker_half_return_apr_pct"] for t in ts], set_and_forget=[t["set_and_forget"]["weaker_half_total_return_apr_pct"] for t in ts], vault=[t["vault"]["weaker_half_total_return_apr_pct"] for t in ts])
        out["total_return"] = dict(
            note="weaker-half total return on the deposit, annualised: the stock token deposited, fees plus the position's mark less the deposit, inventory drift included; hold is the token's price move with no position",
            **{k: dict(keeps_positive=int(sum(x >= 0 for x in d)), median_weaker_half_apr_pct=med(d)) for k, d in wk.items()},
            vault_ahead_of_hold=int(sum(a > b for a, b in zip(wk["vault"], wk["hold"]))), vault_ahead_of_set_and_forget=int(sum(a > b for a, b in zip(wk["vault"], wk["set_and_forget"]))),
            vault_matches_set_and_forget_within_1pt=int(sum(abs(a - b) <= 1.0 for a, b in zip(wk["vault"], wk["set_and_forget"]))))
        return out
    launching = {k: t for k, t in tokens.items() if t["vault"]["weaker_half_edge_apr_pct"] >= rp.KEEP_FLOOR_APR}
    return dict(all_tokens=block(list(tokens.values())), launching=dict(block(list(launching.values())), symbols=list(launching)))


def table(tokens):
    f = lambda x: f"{x:+8.1f}"
    lines = [f"{'Token':<6}{'width':>6}  {'vault':>8}  {'S&F':>8}  {'manual':>8}  {'fullrng':>8}   {'manual pool':<22}| weaker-half total return: {'hold':>8}  {'S&F':>8}  {'vault':>8}"]
    for sym, t in tokens.items():
        m = t["manual_lp"]
        lines.append(f"{sym:<6}{t['band_bps'] / 100:>5.1f}%  {f(t['vault']['weaker_half_edge_apr_pct'])}  {f(t['set_and_forget']['weaker_half_edge_apr_pct'])}  "
                     f"{f(m['weaker_half_edge_apr_pct'])}  {f(t['full_range_v3']['weaker_half_edge_apr_pct'])}   {m['kind'] + ' fee=' + str(m['fee_tier']):<22}| {' ' * 25}{f(t['hold']['weaker_half_return_apr_pct'])}  {f(t['set_and_forget']['weaker_half_total_return_apr_pct'])}  {f(t['vault']['weaker_half_total_return_apr_pct'])}")
    return "\n".join(lines)


def main(symbols):
    rep = json.load(open(REPLAY_PATH))
    u = json.load(open(os.path.join(rp.KEEPER, "data", "universe.json")))
    params = json.load(open(rp.PARAMS_PATH))
    allow, depths = rp.load_hook_allowlist(), rp.load_v4_depths()
    symbols = symbols or list(rep["tokens"])
    tokens = {}
    for sym in symbols:
        print(sym, flush=True)
        tokens[sym] = diy_token(sym, next(x for x in u["tokens"] if x["symbol"] == sym), rep["tokens"][sym], params, allow, depths)
    res = dict(generated_at=dt.datetime.now(rp.U).isoformat(), source="keeper/replay/diy_baseline.py over keeper/data/replay.json", window=rep["window"],
               metric="edge_apr_pct per window (fees less markout less cost, annualised, % of the pool's capital); weaker half = lower of the two 15-day halves",
               cost_model=rep["cost_model"], share_mode="mixed (legacy conservative), same as the gate", manual_range_pct=MANUAL_RANGE * 100,
               labels=LABELS, summary=summary(tokens), tokens=tokens)
    for p in (OUT_PATH, WEB_COPY) if OUT_PATH == os.path.join(rp.KEEPER, "data", "diy-baseline.json") else (OUT_PATH,):
        json.dump(rp.finite(res), open(p, "w"), indent=1, allow_nan=False); open(p, "a").write("\n")
    print(table(tokens)); print(json.dumps(res["summary"], indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
