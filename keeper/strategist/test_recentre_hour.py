"""Tests for recentre_hour.py. Run: python3 test_recentre_hour.py"""
import datetime as dt
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import recentre_hour as rh


def ts(y, m, d, H=0, M=0):
    return dt.datetime(y, m, d, H, M, tzinfo=dt.timezone.utc).timestamp()


def test_hour_checkpoints_cadence():
    t0 = ts(2026, 9, 17)
    t1 = ts(2026, 10, 17)
    for h in (0, 3, 13, 23):
        cps = rh.hour_checkpoints(t0, t1, h)
        assert cps[0] == t0, f"hour {h}: first checkpoint must be the window start"
        rest = cps[1:]
        want = 29 if h == 0 else 30
        assert len(rest) == want, f"hour {h}: expected {want} daily re-mints, got {len(rest)}"
        for x in rest:
            d = dt.datetime.fromtimestamp(x, dt.timezone.utc)
            assert d.hour == h and d.minute == 0 and d.second == 0, f"hour {h}: {d} not on the requested hour"
            assert t0 < x < t1, f"hour {h}: checkpoint {d} outside the window"
        for a, b in zip(rest, rest[1:]):
            assert abs((b - a) - 86400.0) < 1e-6, f"hour {h}: checkpoints not 24h apart"
    assert rh.hour_checkpoints(t0, t1, 0) == rh.hour_checkpoints(t0, t1, 0, 0)


def test_nyse_anchor_dst():
    summer = rh.nyse_open_plus5_checkpoints(ts(2026, 7, 6, 5), ts(2026, 7, 13, 5))
    assert len(summer) >= 7, "summer week must carry a re-mint per day"
    first = dt.datetime.fromtimestamp(summer[1], dt.timezone.utc)
    assert (first.hour, first.minute) == (13, 35), f"EDT 09:35 ET must be 13:35 UTC, got {first}"
    for x in summer[1:]:
        d = dt.datetime.fromtimestamp(x, dt.timezone.utc)
        assert (d.hour, d.minute) == (13, 35), f"EDT week checkpoint off the 13:35 UTC mark: {d}"

    winter = rh.nyse_open_plus5_checkpoints(ts(2026, 12, 7, 5), ts(2026, 12, 14, 5))
    assert len(winter) >= 7, "winter week must carry a re-mint per day"
    first = dt.datetime.fromtimestamp(winter[1], dt.timezone.utc)
    assert (first.hour, first.minute) == (14, 35), f"EST 09:35 ET must be 14:35 UTC, got {first}"
    for x in winter[1:]:
        d = dt.datetime.fromtimestamp(x, dt.timezone.utc)
        assert (d.hour, d.minute) == (14, 35), f"EST week checkpoint off the 14:35 UTC mark: {d}"


def test_real_run_is_finite():
    t0, t1 = rh.window()
    tm = t0 + (t1 - t0) / 2
    ref = rh.Ref("NVDA")
    choice = rh.choose_pool("NVDA", ref, t0, t1, tm)
    pl = choice["_pl"]
    anchors = {
        "00:00 UTC": lambda a, b: rh.hour_checkpoints(a, b, 0),
        "NYSE open": rh.nyse_open_plus5_checkpoints,
    }
    for name, fn in anchors.items():
        r = rh.anchor(pl, ref, t0, t1, tm, fn)
        for half in ("cal", "held"):
            v = r[half]
            assert np.isfinite(v), f"{name} {half} kept APR is not finite: {v}"
        print(f"NVDA {name}: calibration {r['cal']:.2f}%, held out {r['held']:.2f}%")


if __name__ == "__main__":
    test_hour_checkpoints_cadence()
    test_nyse_anchor_dst()
    test_real_run_is_finite()
    print("recentre_hour tests passed")
