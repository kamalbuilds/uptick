"""Checks the schedule helpers of recentre_feasible.py without running the engine."""
import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import recentre_feasible as rf  # noqa: E402


class Ref:
    """A feed whose newest round is at a fixed time."""

    def __init__(self, last):
        self.last = last

    def age(self, t):
        return t - self.last


def ts(s):
    return dt.datetime.fromisoformat(s).replace(tzinfo=dt.timezone.utc).timestamp()


def test_staleness_bound():
    slot = ts("2026-10-17T02:00:00")
    assert rf.is_fresh(Ref(slot - 3600), slot), "1 h old round is fresh"
    assert not rf.is_fresh(Ref(slot - 30 * 3600), slot), "30 h old round is stale"
    kept, skipped = rf.feasible_slots(Ref(slot - 3600), [slot, slot + 40 * 3600])
    assert kept == [slot] and skipped == [slot + 40 * 3600], (kept, skipped)


def test_nyse_open_slots():
    week = rf.nyse_open_slots(ts("2026-10-12T00:00:00"), ts("2026-10-19T00:00:00"))
    assert ts("2026-10-12T13:35:00") in week, "summer weekday at 13:35 UTC"
    assert ts("2026-10-17T13:35:00") not in week and ts("2026-10-18T13:35:00") not in week, "no weekend slot"
    assert len(week) == 5, week
    winter = rf.nyse_open_slots(ts("2026-12-01T00:00:00"), ts("2026-12-02T00:00:00"))
    assert winter == [ts("2026-12-01T14:35:00")], winter


if __name__ == "__main__":
    test_staleness_bound()
    test_nyse_open_slots()
    print("ok recentre_feasible helpers")
