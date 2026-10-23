"""Plain-assert test: which v4 pools a vault may target, and which backend a token deploys on. Run: /opt/homebrew/bin/python3.14 replay/test_replay_venue.py"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import replay as rp

HOOK = "0x" + "ab" * 18 + "0000"          # permission bits all clear
BEFORE_REMOVE = "0x" + "ab" * 18 + "0200"  # 1 << 9
RETURNS_DELTA = "0x" + "ab" * 18 + "0008"   # BEFORE_SWAP_RETURNS_DELTA 1 << 3
BEFORE_SWAP = "0x" + "ab" * 18 + "0080"     # 1 << 7: can sandwich the vault's own swap
BEFORE_INIT = "0x" + "ab" * 18 + "2000"     # 1 << 13: moves no vault funds, allowed


def test_v4_key_ok():
    allow = {HOOK, BEFORE_REMOVE, RETURNS_DELTA, BEFORE_SWAP, BEFORE_INIT}
    assert rp.v4_key_ok(3000, None, set())
    assert not rp.v4_key_ok(rp.DYNAMIC_FEE, None, set()), "dynamic fee"
    assert not rp.v4_key_ok(3000, HOOK, set()), "hook not on the allow-list"
    assert rp.v4_key_ok(3000, HOOK, allow)
    assert rp.v4_key_ok(3000, BEFORE_INIT, allow)
    assert not rp.v4_key_ok(3000, BEFORE_SWAP, allow), "allow-listed but runs inside the vault's own swap"
    assert not rp.v4_key_ok(3000, BEFORE_REMOVE, allow), "allow-listed but can block a withdrawal"
    assert not rp.v4_key_ok(3000, RETURNS_DELTA, allow), "allow-listed but takes a delta"
    assert not rp.v4_key_ok(rp.DYNAMIC_FEE | 3000, HOOK, allow)
    for bit in (11, 10, 9, 8, 7, 6, 3, 2, 1, 0):
        assert rp.V4_HOOK_FLAGS & (1 << bit)
    assert bin(rp.V4_HOOK_FLAGS).count("1") == 10


def test_venue_for():
    f = rp.KEEP_FLOOR_APR
    assert rp.venue_for(f, None) == "v3", "v3 alone at the floor"
    assert rp.venue_for(f + 5, f + 50) == "v4", "v4 keeps more in its weaker half"
    assert rp.venue_for(f + 50, f + 5) == "v3", "v3 keeps more"
    assert rp.venue_for(f + 5, f + 5) == "v3", "tie stays on v3"
    # PLTR after tick snapping (replay 2026-10-23): v3 weaker half -18.9 clears the floor, v4 keeps +7.9. The old rule picked v3.
    assert rp.venue_for(-18.9, 7.9) == "v4", "a v3 pool that merely clears the floor never beats a v4 pool that keeps more"
    assert rp.venue_for(f - 0.1, f) == "v4"
    assert rp.venue_for(None, f + 3) == "v4", "no v3 pool, v4 keeps the floor"
    assert rp.venue_for(f - 0.1, f - 0.1) == "v3" and rp.venue_for(f - 0.1, None) == "v3" and rp.venue_for(None, None) == "v3"


def test_venue_cases_shared_with_keeper():
    """keeper/test/deploy-list.test.ts runs the same table through its TS copy of the rule: neither side can drift alone."""
    t = json.load(open(os.path.join(HERE, "..", "test", "fixtures", "venue-cases.json")))
    assert t["floor_apr"] == rp.KEEP_FLOOR_APR and len(t["cases"]) >= 10
    for c in t["cases"]:
        assert rp.venue_for(c["v3"], c["v4"]) == c["venue"], c
    assert {c["venue"] for c in t["cases"]} == {"v3", "v4"}


def test_vault_cap_usd():
    assert rp.vault_cap_usd(0, 100_000) == 0 and rp.vault_cap_usd(float("nan"), 100_000) == 0
    assert rp.vault_cap_usd(96_476, 100_000) == 24_119  # floor(96476 * 0.2 / 0.8), keeper/src/universe.ts vaultCapUsd
    assert rp.vault_cap_usd(1e9, 24_118) == 24_118


def test_allowlist_file():
    rp.load_hook_allowlist()  # asserts lowercase 0x + 40 hex


if __name__ == "__main__":
    test_v4_key_ok(); test_venue_for(); test_venue_cases_shared_with_keeper(); test_vault_cap_usd(); test_allowlist_file()
    print("5 tests passed")
