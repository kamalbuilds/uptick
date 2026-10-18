"""Plain-assert tests for the range strategist. Run: python3 test_strategist.py"""
import json
import math
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import strategist as st


def test_grid_in_bounds():
    grid = st.grid_candidates()
    assert grid, "candidate grid is empty"
    for c in grid:
        assert st.assert_candidate_in_bounds(c)
        assert st.RANGE_BPS_MIN <= c["range_bps"] <= st.RANGE_BPS_MAX
        assert st.INTERVAL_S_MIN <= int(c["interval_h"] * 3600) <= st.INTERVAL_S_MAX
    for bad in ({"range_bps": 49, "interval_h": 24}, {"range_bps": 2001, "interval_h": 24},
                {"range_bps": 500, "interval_h": 0}, {"range_bps": 500, "interval_h": 25}):
        try:
            st.assert_candidate_in_bounds(bad)
        except AssertionError:
            pass
        else:
            raise AssertionError("out-of-contract candidate was accepted: %r" % bad)


def test_decision():
    current_cal, current_held = 5.0, 1.0

    # The calibration winner (cal 9.0) is tested; it beats current by only 1.5 on held-out, so keep.
    no_clear = [dict(range_bps=150, interval_h=24, calibration_apr=9.0, heldout_apr=2.5),
                dict(range_bps=250, interval_h=24, calibration_apr=8.0, heldout_apr=2.9)]
    d, chosen, margin = st.decide(current_cal, current_held, no_clear)
    assert d == "keep" and chosen is None, (d, chosen)
    assert abs(margin - 1.5) < 1e-9, margin

    # The calibration winner clears the bar on held-out: change to it.
    clears = [dict(range_bps=150, interval_h=24, calibration_apr=9.0, heldout_apr=5.0),
              dict(range_bps=350, interval_h=12, calibration_apr=7.0, heldout_apr=6.0)]
    d, chosen, margin = st.decide(current_cal, current_held, clears)
    assert d == "change" and chosen["range_bps"] == 150, (d, chosen)
    assert abs(margin - 4.0) < 1e-9, margin

    # Selection never uses held-out: a better held-out score on a lower calibration rank is not picked.
    tempting = [dict(range_bps=150, interval_h=24, calibration_apr=9.0, heldout_apr=1.2),
                dict(range_bps=750, interval_h=24, calibration_apr=6.0, heldout_apr=9.0)]
    d, chosen, _ = st.decide(current_cal, current_held, tempting)
    assert d == "keep" and chosen is None, (d, chosen)

    worse_cal = [dict(range_bps=150, interval_h=24, calibration_apr=3.0, heldout_apr=9.0)]
    d, chosen, _ = st.decide(current_cal, current_held, worse_cal)
    assert d == "keep" and chosen is None, (d, chosen)


def test_real_nvda():
    out = os.path.join(tempfile.mkdtemp(prefix="strategist-test-"), "proposal.json")
    subprocess.run([sys.executable, os.path.join(HERE, "strategist.py"), "--token", "NVDA", "--out", out],
                   check=True, timeout=540)
    r = json.load(open(out))
    assert r["token"] == "NVDA"
    assert r["decision"] in ("keep", "change")
    assert isinstance(r["current"]["heldout_apr"], float) and math.isfinite(r["current"]["heldout_apr"])
    assert len(r["candidates"]) == 3, len(r["candidates"])
    for c in r["candidates"]:
        assert math.isfinite(c["calibration_apr"]) and math.isfinite(c["heldout_apr"]), c
        st.assert_candidate_in_bounds({"range_bps": c["range_bps"], "interval_h": c["interval_h"]})
    assert r["rationale_facts"], "no rationale facts"
    if r["decision"] == "change":
        assert r["proposed"] and r["calldata_hint"], r
        st.assert_candidate_in_bounds({"range_bps": r["proposed"]["range_bps"], "interval_h": r["proposed"]["interval_h"]})
    else:
        assert r["proposed"] is None and r["calldata_hint"] is None, r


if __name__ == "__main__":
    for fn in (test_grid_in_bounds, test_decision, test_real_nvda):
        fn()
        print("ok", fn.__name__)
    print("3 tests passed")
