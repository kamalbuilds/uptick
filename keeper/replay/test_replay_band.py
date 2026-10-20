"""Plain-assert test: replay.py takes each token's band from params.json. Run: python3 replay/test_replay_band.py"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import replay as rp


def test_band_bps_for():
    p = {"NVDA": {"range_bps": 150, "interval_h": 24}, "INTC": {"range_bps": 2000, "interval_h": 24}}
    assert rp.band_bps_for("NVDA", p) == 150
    assert rp.band_bps_for("INTC", p) == 2000
    assert rp.band_bps_for("SPY", p) == 500, "a token without an entry runs the default band"
    for bad in ({"range_bps": 49}, {"range_bps": 2001}, {"range_bps": 5.5}, {"range_bps": 500, "interval_h": 12}):
        try:
            rp.band_bps_for("X", {"X": bad})
        except AssertionError:
            continue
        raise AssertionError(f"accepted {bad}")


def test_params_file_matches_contract_bounds():
    import json
    params = json.load(open(os.path.join(rp.KEEPER, "data", "params.json")))
    assert len(params) >= 17, len(params)
    for sym in params:
        assert rp.band_bps_for(sym, params) == params[sym]["range_bps"]


if __name__ == "__main__":
    test_band_bps_for(); test_params_file_matches_contract_bounds()
    print("2 tests passed")
