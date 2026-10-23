"""Every range bound the replay holds sits on a multiple of its pool's tick spacing, snapped outward. Run: python3 -m pytest replay/test_replay_snap.py
(STOCK_VAULTS_SPIKE=<spikes/stock-vaults> when the engine is not at ../../spikes)"""
import json
import math
import os
import random
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import replay as rp

REPLAY = json.load(open(os.path.join(rp.KEEPER, "data", "replay.json")))
HAVE_ENGINE_DATA = os.path.exists(os.path.join(rp.ENGINE_DIR, "cl-AAPL.json")) and os.path.isdir(os.path.join(rp.KEEPER, "data", "swaps"))
SPACINGS = (1, 10, 60, 200, 25, 111, 1800)


def tick_of(price, stock_is0):
    """The tick a snapped bound sits on: rounded, because the price came back from tick_to_price."""
    raw = price / rp.STOCK_SCALE_PER_USDG if stock_is0 else rp.STOCK_SCALE_PER_USDG / price
    return round(math.log(raw) / math.log(1.0001))


@pytest.mark.parametrize("stock_is0", [True, False])
@pytest.mark.parametrize("spacing", SPACINGS)
def test_bounds_are_multiples_of_spacing_and_outward(spacing, stock_is0):
    rnd = random.Random(7)
    moved = 0
    for _ in range(400):
        c = rnd.uniform(5, 900); w = rnd.uniform(0.005, 0.2)
        a, b = c * (1 - w), c * (1 + w)
        sa, sb = rp.snap_range(a, b, spacing, stock_is0)
        assert tick_of(sa, stock_is0) % spacing == 0 and tick_of(sb, stock_is0) % spacing == 0, (c, w)
        assert sa <= a * (1 + 1e-12) and sb >= b * (1 - 1e-12), "snapped outward, never inward"
        assert sa < sb
        step = 1.0001 ** spacing   # at most one spacing of extra width per side
        assert sa >= a / step and sb <= b * step, "snapped by less than a spacing per side"
        moved += sa != a or sb != b
    assert moved == 400, "random prices essentially never sit on a spacing multiple, so every range must have moved"


def test_known_range_matches_the_contract_rule():
    # stock is token0 at 100 USD +-5%: raw price 1e-10 * (0.95..1.05), ticks about -230270 +- 513, spacing 200
    a, b = 95.0, 105.0
    ta, tb = rp.price_to_tick(a, True), rp.price_to_tick(b, True)
    assert round(ta) == -230783 and round(tb) == -229782, (ta, tb)
    assert rp.snap_ticks(a, b, 200, True) == (-230800, -229600)
    assert rp.snap_ticks(a, b, 1, True) == (-230783, -229782)


def test_orientation_is_mirrored():
    a, b = 380.0, 420.0
    for spacing in (10, 60, 200):
        t0 = rp.snap_ticks(a, b, spacing, True); t1 = rp.snap_ticks(a, b, spacing, False)
        assert all(t % spacing == 0 for t in (*t0, *t1))
        # token1 prices are the reciprocal, so the tick interval is the negated one, widened by at most a spacing
        assert t1[0] <= -t0[1] + spacing and t1[1] >= -t0[0] - spacing


def test_replay_json_records_a_spacing_for_every_pool():
    n = 0
    for sym, t in REPLAY["tokens"].items():
        for p in t["pools"]:
            assert p["tick_spacing"] > 0, (sym, p["id"])
            if p["kind"] == "v3":
                assert p["tick_spacing"] == rp.V3_TICK_SPACING[p["fee_tier"]], (sym, p["id"])
            n += 1
        if t.get("chosen_v4"):
            assert next(p for p in t["pools"] if p["id"] == t["chosen_v4"]["id"])["tick_spacing"] == t["chosen_v4"]["tick_spacing"]
    assert n >= 40


@pytest.mark.skipif(not HAVE_ENGINE_DATA, reason="needs keeper/data/engine and keeper/data/swaps from replay/pull.py")
@pytest.mark.parametrize("sym", ["PLTR", "AAPL", "AMD"])
def test_every_bound_the_replay_places_is_on_the_pool_spacing(sym):
    u = json.load(open(os.path.join(rp.KEEPER, "data", "universe.json")))
    params = json.load(open(rp.PARAMS_PATH))
    tok = next(x for x in u["tokens"] if x["symbol"] == sym)
    _, _, _, ref, rows, _, _ = rp.replay_token(tok, rp.band_bps_for(sym, params), rp.load_hook_allowlist(), rp.load_v4_depths())
    checked = 0
    for r in rows:
        plan = r["_plan"]
        assert len(plan.checkpoints) > 10
        for t in plan.checkpoints:
            _, a, b, _ = plan(t)
            assert tick_of(a, plan.stock_is0) % r["tick_spacing"] == 0 and tick_of(b, plan.stock_is0) % r["tick_spacing"] == 0, (sym, r["id"], t)
            checked += 2
    assert checked > 50
    assert any(r["tick_spacing"] == 200 for r in rows) == (sym in ("PLTR", "AMD"))
