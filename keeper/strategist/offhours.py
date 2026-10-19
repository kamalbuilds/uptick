"""Off-hours liquidity replay for StockVault pools.

Compares, per token and per half (calibration, held-out):
  always_500: rangeBps 500, recentre every 24h, in pool around the clock.
  offhours_500: in pool only outside NYSE regular hours (Mon-Fri 09:30-16:00 America/New_York,
      exchange holidays closed), rangeBps 500, redeployed at each close centred on Chainlink.
  offhours_tuned: offhours_500 with rangeBps chosen on calibration from {250, 500, 1000},
      then tested on held-out.

The cost model is engine.simulate unchanged. An idle period is plan(t)=('out',): the engine
charges GAS_PULL_M*GAS_USD_PER_M (0.30M gas, decreaseLiquidity+collect), holds the withdrawn
token and USDG idle (no fees, beta exposure remains), and at the next redeploy charges
GAS_REBAL_M*GAS_USD_PER_M (0.75M gas) plus swap_cost((x_new-x)*P, pool liquidity, P, fee tier),
the swap needed to rebalance inventory into the new band. One continuous simulate per half, so
the round trip is not double counted.

Run: python3 offhours.py [--tokens NVDA GOOGL] [--out OFFHOURS.md]
"""
import argparse
import datetime as dt
import sys
from functools import lru_cache
from zoneinfo import ZoneInfo

import numpy as np

import strategist as st
from engine import Pool, TOK, simulate, apr, GAS_PULL_M, GAS_USD_PER_M
from strategies import Ref, rng, trading_days
from pull import USDG

NY = ZoneInfo("America/New_York")
OPEN = dt.time(9, 30)
CLOSE = dt.time(16, 0)
OPEN_S = OPEN.hour * 3600 + OPEN.minute * 60
CLOSE_S = CLOSE.hour * 3600 + CLOSE.minute * 60
BENCHMARK_APR = 7.0
RANGE_SET = (250, 500, 1000)
FIXED_RANGE = 500
ALWAYS_INTERVAL_S = 24 * 3600
HALVES = ("calibration", "held_out")
STRATEGIES = ("always_500", "offhours_500", "offhours_tuned")


@lru_cache(maxsize=1)
def us_calendar():
    days = frozenset(trading_days())
    return days, (min(days), max(days))


def engine_knows_date(d):
    _days, (lo, hi) = us_calendar()
    return lo <= d <= hi


def is_us_market_holiday(d):
    if d.weekday() >= 5:
        return False
    days, (lo, hi) = us_calendar()
    return lo <= d <= hi and d not in days


def is_trading_day(d):
    if d.weekday() >= 5:
        return False
    return not is_us_market_holiday(d)


def nyse_open(t):
    lt = dt.datetime.fromtimestamp(t, NY)
    if not is_trading_day(lt.date()):
        return False
    secs = lt.hour * 3600 + lt.minute * 60 + lt.second
    return OPEN_S <= secs < CLOSE_S


def in_pool(t):
    return not nyse_open(t)


def boundaries(t0, t1):
    d = dt.datetime.fromtimestamp(t0, NY).date() - dt.timedelta(days=1)
    end = dt.datetime.fromtimestamp(t1, NY).date() + dt.timedelta(days=1)
    out = []
    while d <= end:
        if is_trading_day(d):
            for clock in (OPEN, CLOSE):
                b = dt.datetime.combine(d, clock, tzinfo=NY).timestamp()
                if t0 < b < t1:
                    out.append(b)
        d += dt.timedelta(days=1)
    return sorted(set(out))


class OffHoursPlan:
    def __init__(self, ref, w, t0, t1):
        self.ref = ref
        self.w = w
        self.checkpoints = [t0] + boundaries(t0, t1)

    def __call__(self, t):
        if nyse_open(t):
            return ("out",)
        a, b = rng(self.ref.at(t), self.w)
        return ("range", a, b, False)

    def recenter(self, t):
        return None


def choose_pool(sym, t0, tm, t1):
    tok = st.load_token(sym)
    ref = Ref(sym)
    stock = tok["token"].lower()
    stock_is0 = int(stock, 16) < int(USDG, 16)
    candidates = []
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
        if vol < st.MIN_CHOICE_VOLUME_USD:
            continue
        candidates.append(dict(id=p["address"], fee_tier=p["fee_tier"], volume_usd=vol, _pl=pl))
    if not candidates:
        raise SystemExit(f"no v3 pool for {sym} carries ${st.MIN_CHOICE_VOLUME_USD:,.0f} in the window")

    def cal_key(p):
        e, _ = st.score(p["_pl"], ref, t0, tm, FIXED_RANGE, ALWAYS_INTERVAL_S // 3600)
        return e if np.isfinite(e) else -np.inf

    return max(candidates, key=cal_key), ref


def run_metrics(pl, ref, t0, t1, range_bps, plan):
    r = simulate(pl, st.CAP, t0, t1, plan, record=False)
    days = r["days"]
    fees = float(r["F"])
    mk = float(r["mk"])
    cost = float(r["C"])
    pull_gas = r["npull"] * GAS_PULL_M * GAS_USD_PER_M
    return dict(
        fees_usd=fees,
        markout_loss_usd=-mk,
        cost_usd=cost,
        pull_gas_usd=pull_gas,
        redeploy_cost_usd=cost - pull_gas,
        kept_apr_pct=apr(fees + mk - cost, st.CAP, days),
        fee_apr_pct=apr(fees, st.CAP, days),
        markout_apr_pct=-apr(mk, st.CAP, days),
        cost_apr_pct=apr(cost, st.CAP, days),
        withdrawals=int(r["npull"]),
        redeploys=int(r["nreb"]),
        round_trips=int(min(r["npull"], r["nreb"])),
    )


def always_plan(ref, t0, t1, range_bps):
    return st.Interval(ref, range_bps / 10000.0, t0, t1, ALWAYS_INTERVAL_S)


def off_plan(ref, t0, t1, range_bps):
    return OffHoursPlan(ref, range_bps / 10000.0, t0, t1)


def _best_calibration(cand):
    finite = [r for r in RANGE_SET if np.isfinite(cand[r]["kept_apr_pct"])]
    if not finite:
        raise SystemExit("no finite off-hours calibration result")
    return max(finite, key=lambda r: cand[r]["kept_apr_pct"])


def evaluate_token(sym):
    t0, t1 = st.window()
    tm = t0 + (t1 - t0) / 2
    pool, ref = choose_pool(sym, t0, tm, t1)
    pl = pool["_pl"]

    cand_cal = {r: run_metrics(pl, ref, t0, tm, r, off_plan(ref, t0, tm, r)) for r in RANGE_SET}
    best_range = _best_calibration(cand_cal)

    halves = {}
    halves["calibration"] = dict(
        always_500=run_metrics(pl, ref, t0, tm, FIXED_RANGE, always_plan(ref, t0, tm, FIXED_RANGE)),
        offhours_500=run_metrics(pl, ref, t0, tm, FIXED_RANGE, off_plan(ref, t0, tm, FIXED_RANGE)),
        offhours_tuned=dict(cand_cal[best_range], range_bps=best_range),
    )
    halves["held_out"] = dict(
        always_500=run_metrics(pl, ref, tm, t1, FIXED_RANGE, always_plan(ref, tm, t1, FIXED_RANGE)),
        offhours_500=run_metrics(pl, ref, tm, t1, FIXED_RANGE, off_plan(ref, tm, t1, FIXED_RANGE)),
        offhours_tuned=dict(run_metrics(pl, ref, tm, t1, best_range, off_plan(ref, tm, t1, best_range)), range_bps=best_range),
    )
    return dict(
        symbol=sym,
        pool=pool["id"],
        fee_tier=pool["fee_tier"],
        volume_usd=pool["volume_usd"],
        t0=t0,
        tm=tm,
        t1=t1,
        best_range_bps=best_range,
        calibration_by_range={r: cand_cal[r]["kept_apr_pct"] for r in RANGE_SET},
        halves=halves,
    )


def verdict(res):
    held = res["halves"]["held_out"]
    always = held["always_500"]["kept_apr_pct"]
    off500 = held["offhours_500"]["kept_apr_pct"]
    tuned = held["offhours_tuned"]["kept_apr_pct"]
    return dict(
        off500_beats=off500 > always,
        off500_delta=off500 - always,
        off500_clears=off500 > BENCHMARK_APR,
        tuned_beats=tuned > always,
        tuned_delta=tuned - always,
        tuned_clears=tuned > BENCHMARK_APR,
        always_held=always,
        off500_held=off500,
        tuned_held=tuned,
    )


def _money(x):
    return f"{x:,.2f}"


def _pct(x):
    return f"{x:.2f}"


def _iso(t):
    return dt.datetime.fromtimestamp(t, dt.timezone.utc).isoformat()


def _yes(v):
    return "yes" if v else "no"


def render(results):
    lines = []
    lines.append("# Off-hours liquidity on StockVault pools")
    lines.append("")
    lines.append("## Question")
    lines.append("")
    lines.append("Does providing liquidity only outside NYSE regular hours keep more than the always-on setting "
                 "and clear a 7.0% APR benchmark, for NVDA and GOOGL?")
    lines.append("")
    lines.append("NYSE regular hours are Mon-Fri 09:30 to 16:00 America/New_York, with exchange holidays closed. "
                 "The pool is in during nights, weekends and holidays, out during regular hours.")
    lines.append("")
    lines.append("## What is measured")
    lines.append("")
    lines.append("- Window: 30 days ending 2026-10-17 00:00 UTC. First 15 days calibrate, last 15 are held out.")
    lines.append("- Capital: USD 100,000 per run. Engine: spikes/stock-vaults/scripts/engine.py, unchanged, "
                 "data in keeper/data/engine/.")
    lines.append("- `always_500`: rangeBps 500, recentre every 24h, in pool around the clock.")
    lines.append("- `offhours_500`: rangeBps 500, in pool only outside NYSE regular hours, redeployed at each close "
                 "centred on Chainlink.")
    lines.append("- `offhours_tuned`: same as `offhours_500` with rangeBps chosen on the calibration half from "
                 "{250, 500, 1000} by kept APR, then tested once on the held-out half.")
    lines.append("- Kept APR is fee APR + markout APR - cost APR. Markout loss is the negative of the engine markout. "
                 "The held-out numbers decide.")
    lines.append("")
    lines.append("## Cost model for the round trip")
    lines.append("")
    lines.append("The engine represents an idle period directly with `plan(t) = ('out',)`. At a withdrawal it charges "
                 "`GAS_PULL_M * GAS_USD_PER_M` (0.30M gas, decreaseLiquidity plus collect) and holds the withdrawn "
                 "token and USDG idle: no fees are earned, and the token leg keeps its price exposure. At the next "
                 "redeploy it charges `GAS_REBAL_M * GAS_USD_PER_M` (0.75M gas) plus "
                 "`swap_cost((x_new - x) * P, pool liquidity, P, fee tier)`, the swap needed to rebalance inventory "
                 "into the new band. Each half is one continuous `simulate` call, so the withdrawal and redeploy are "
                 "not double counted. The first entry is free in both the always-on and off-hours runs, matching the "
                 "engine convention.")
    lines.append("")

    for sym in results:
        r = results[sym]
        v = verdict(r)
        lines.append(f"## {sym}")
        lines.append("")
        lines.append(f"Pool `{r['pool']}` at fee {r['fee_tier']} ppm, window volume ${r['volume_usd']:,.0f}. "
                     f"Calibration {_iso(r['t0'])} to {_iso(r['tm'])}. Held-out {_iso(r['tm'])} to {_iso(r['t1'])}.")
        lines.append("")
        lines.append(f"Winning range chosen on calibration only: {r['best_range_bps']} bps. "
                     f"Candidate calibration kept APR: "
                     + ", ".join(f"{b} bps {_pct(r['calibration_by_range'][b])}%" for b in RANGE_SET) + ".")
        lines.append("")
        lines.append("| Strategy | Half | Fees USD | Markout loss USD | Rebalance / round-trip cost USD | Kept APR % | Round trips | Rebalances |")
        lines.append("|---|---|---:|---:|---:|---:|---:|---:|")
        for half in HALVES:
            for name in STRATEGIES:
                x = r["halves"][half][name]
                lines.append(f"| {name} | {half} | {_money(x['fees_usd'])} | {_money(x['markout_loss_usd'])} | "
                             f"{_money(x['cost_usd'])} | {_pct(x['kept_apr_pct'])} | {x['round_trips']} | {x['redeploys']} |")
        lines.append("")
        lines.append("Verdict on held-out:")
        lines.append("")
        lines.append(f"- `offhours_500` vs `always_500`: {_yes(v['off500_beats'])} "
                     f"({v['off500_delta']:+.2f} APR points). Clears 7.0%: {_yes(v['off500_clears'])} "
                     f"({_pct(v['off500_held'])}%).")
        lines.append(f"- `offhours_tuned` vs `always_500`: {_yes(v['tuned_beats'])} "
                     f"({v['tuned_delta']:+.2f} APR points). Clears 7.0%: {_yes(v['tuned_clears'])} "
                     f"({_pct(v['tuned_held'])}%).")
        lines.append(f"- Held-out kept APR: always-on {_pct(v['always_held'])}%, off-hours 500 {_pct(v['off500_held'])}%, "
                     f"off-hours tuned {_pct(v['tuned_held'])}%.")
        lines.append("")

    lines.append("## Reading the result")
    lines.append("")
    lines.append("- The held-out half is the verdict. Calibration is shown only to explain the range choice.")
    lines.append("- The off-hours run still carries the token leg while idle. It earns no pool fees in NYSE hours, "
                 "but it does not escape price exposure.")
    lines.append("- The engine marks out LP inventory against the pool price path. It is a replay estimate, not a "
                 "live execution record.")
    lines.append("- The holiday calendar comes from the exchange day sets in the Nasdaq files under "
                 "keeper/data/engine/. Within their date coverage, a missing weekday is treated as a holiday.")
    lines.append("")
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Replay off-hours-only liquidity against always-on liquidity.")
    ap.add_argument("--tokens", nargs="+", default=["NVDA", "GOOGL"])
    ap.add_argument("--out", default="OFFHOURS.md")
    a = ap.parse_args(argv)

    results = {}
    for sym in a.tokens:
        print(f"running {sym}", flush=True)
        results[sym] = evaluate_token(sym.upper())
    text = render(results)
    with open(a.out, "w") as f:
        f.write(text)
    print(text)
    print(f"wrote {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
