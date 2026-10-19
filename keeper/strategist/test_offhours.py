"""Tests for offhours.py. Run: python3 test_offhours.py"""
import datetime as dt
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import offhours as oh

NY = oh.NY
UTC = dt.timezone.utc


def ts(y, m, d, H, M):
    return dt.datetime(y, m, d, H, M, tzinfo=NY).timestamp()


def test_nyse_classifier():
    assert oh.nyse_open(ts(2026, 10, 5, 10, 0)), "Monday 10:00 ET must be open"
    assert not oh.nyse_open(ts(2026, 10, 5, 9, 29)), "Monday 09:29 ET must be closed"
    assert not oh.nyse_open(ts(2026, 10, 10, 12, 0)), "Saturday must be closed"
    assert oh.in_pool(ts(2026, 10, 10, 12, 0)), "Saturday must be in pool"

    holiday = dt.date(2026, 7, 3)
    if oh.engine_knows_date(holiday):
        assert oh.is_us_market_holiday(holiday), "2026-07-03 must be a known exchange holiday"
        assert not oh.nyse_open(ts(2026, 7, 3, 10, 0)), "Independence Day observed must be closed"
    else:
        print("note: engine calendar does not cover 2026-07-03, holiday case skipped")

    assert oh.nyse_open(ts(2026, 11, 2, 9, 30)), "Monday 09:30 ET must be open after DST ends"
    assert not oh.nyse_open(ts(2026, 11, 2, 9, 29)), "Monday 09:29 ET must be closed after DST ends"
    before = dt.datetime.fromtimestamp(ts(2026, 10, 5, 9, 30), UTC)
    after = dt.datetime.fromtimestamp(ts(2026, 11, 2, 9, 30), UTC)
    assert before.hour == 13, "09:30 ET in EDT is 13:30 UTC"
    assert after.hour == 14, "09:30 ET in EST is 14:30 UTC"


def test_plan_actions():
    ref = oh.Ref("NVDA")
    t0 = ts(2026, 10, 5, 8, 0)
    t1 = t0 + 3 * 86400
    plan = oh.OffHoursPlan(ref, 0.05, t0, t1)
    assert plan(t0)[0] == "range", "Monday 08:00 ET must deploy"
    assert plan(ts(2026, 10, 5, 10, 0))[0] == "out", "Monday 10:00 ET must withdraw"
    assert plan(ts(2026, 10, 5, 17, 0))[0] == "range", "Monday 17:00 ET must redeploy"
    assert any(abs(c - ts(2026, 10, 5, 9, 30)) < 1 for c in plan.checkpoints), "open boundary missing"
    assert any(abs(c - ts(2026, 10, 5, 16, 0)) < 1 for c in plan.checkpoints), "close boundary missing"


def test_nvda_real_run():
    res = oh.evaluate_token("NVDA")
    for half in oh.HALVES:
        for name in oh.STRATEGIES:
            v = res["halves"][half][name]["kept_apr_pct"]
            assert np.isfinite(v), f"{half} {name} kept APR is not finite: {v}"
    print("NVDA held-out kept APR:",
          {name: round(res["halves"]["held_out"][name]["kept_apr_pct"], 2) for name in oh.STRATEGIES})


if __name__ == "__main__":
    test_nyse_classifier()
    test_plan_actions()
    test_nvda_real_run()
    print("offhours tests passed")
