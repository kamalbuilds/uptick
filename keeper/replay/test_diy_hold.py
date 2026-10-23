"""The hold column and the total-return column of the do-it-yourself baseline, and the tick-spacing snap of its set-once positions.
Run: python3 -m pytest replay/test_diy_hold.py   (STOCK_VAULTS_SPIKE=<spikes/stock-vaults> when the engine is not at ../../spikes)"""
import json
import math
import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import diy_baseline as db
import replay as rp

COMMITTED = json.load(open(os.path.join(rp.KEEPER, "data", "diy-baseline.json")))
HALVES = ("full", "calibration", "test")
DAYS = {"full": 30, "calibration": 15, "test": 15}
HAVE_ENGINE_DATA = os.path.exists(os.path.join(rp.ENGINE_DIR, "cl-AAPL.json")) and os.path.isdir(os.path.join(rp.KEEPER, "data", "swaps"))


def test_hold_is_the_annualised_price_move_and_every_column_carries_a_weaker_half():
    assert len(COMMITTED["tokens"]) >= 17
    for sym, t in COMMITTED["tokens"].items():
        hold = t["hold"]
        for h in HALVES:
            assert hold[h]["return_apr_pct"] == pytest.approx(hold[h]["price_move_pct"] * 365.0 / DAYS[h], abs=1e-6), f"{sym} {h}"
        assert hold["weaker_half_return_apr_pct"] == min(hold["calibration"]["return_apr_pct"], hold["test"]["return_apr_pct"])
        for v in ("vault", *db.VARIANTS):
            assert t[v]["weaker_half_total_return_apr_pct"] == min(t[v]["calibration"]["total_return_apr_pct"], t[v]["test"]["total_return_apr_pct"]), f"{sym} {v}"
        assert hold["vs_vault_weaker_half_total_return_pts"] == pytest.approx(t["vault"]["weaker_half_total_return_apr_pct"] - hold["weaker_half_return_apr_pct"], abs=1e-9)
        # a position that is not the token cannot reproduce holding it: the vault's total return differs from hold in some window
        assert any(t["vault"][h]["total_return_apr_pct"] != hold[h]["return_apr_pct"] for h in HALVES), sym


def test_total_return_is_not_the_edge():
    # the edge leaves inventory drift out; total return puts it back, so the two differ wherever the price moved
    differs = sum(t["vault"]["full"]["total_return_apr_pct"] != t["vault"]["full"]["edge_apr_pct"] for t in COMMITTED["tokens"].values())
    assert differs == len(COMMITTED["tokens"])


@pytest.mark.skipif(not HAVE_ENGINE_DATA, reason="needs keeper/data/engine and keeper/data/swaps from replay/pull.py")
@pytest.mark.parametrize("sym", ["AAPL", "PLTR"])
def test_set_once_bounds_sit_on_the_pool_spacing_and_hold_matches_the_pool_price(sym):
    u = json.load(open(os.path.join(rp.KEEPER, "data", "universe.json")))
    params = json.load(open(rp.PARAMS_PATH))
    tok = next(x for x in u["tokens"] if x["symbol"] == sym)
    w = rp.band_bps_for(sym, params) / 1e4
    t0, _tm, t1, _ref, rows, _slots, _cap = rp.replay_token(tok, rp.band_bps_for(sym, params), rp.load_hook_allowlist(), rp.load_v4_depths())
    r = next(x for x in rows if x["id"] == COMMITTED["tokens"][sym]["vault"]["pool"])
    is0 = r["_plan"].stock_is0
    plan = db.fixed_plan(r["_pl"], w, t0, t0, r["tick_spacing"], is0)
    for price in plan.range:
        raw = price / rp.STOCK_SCALE_PER_USDG if is0 else rp.STOCK_SCALE_PER_USDG / price
        assert round(math.log(raw) / math.log(1.0001)) % r["tick_spacing"] == 0
    centre = r["_pl"].price_at(t0)
    assert plan.range[0] < centre * (1 - w) and plan.range[1] > centre * (1 + w), "snapped outward"
    p1 = float(r["_pl"].P[r["_pl"].idx_at(t1)])
    expect = (p1 / centre - 1) * 365 / 30 * 100
    assert db.hold_apr(r["_pl"], t0, t1) == pytest.approx(expect, abs=1e-9)
    assert COMMITTED["tokens"][sym]["hold"]["full"]["return_apr_pct"] == pytest.approx(expect, abs=1e-9), "committed file is stale"
