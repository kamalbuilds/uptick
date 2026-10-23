"""The do-it-yourself baseline must be a different computation from the vault's, never a copy of it.
Run: python3 -m pytest replay/test_diy_baseline.py   (STOCK_VAULTS_SPIKE=<spikes/stock-vaults> when the engine is not at ../../spikes)
"""
import json
import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import diy_baseline as db
import replay as rp

COMMITTED = json.load(open(os.path.join(rp.KEEPER, "data", "diy-baseline.json")))
REPLAY = json.load(open(db.REPLAY_PATH))
HALVES = ("full", "calibration", "test")
HAVE_ENGINE_DATA = os.path.exists(os.path.join(rp.ENGINE_DIR, "cl-AAPL.json")) and os.path.isdir(os.path.join(rp.KEEPER, "data", "swaps"))


def window(edge, rebalances=0):
    return dict(edge_apr_pct=edge, rebalances=rebalances)


def test_assert_independent_fires_on_a_copy_and_passes_on_a_difference():
    vault = {h: window(1.5, 22) for h in HALVES}
    with pytest.raises(AssertionError):
        db.assert_independent(vault, {h: window(1.5, 22) for h in HALVES}, "copy")
    db.assert_independent(vault, {**{h: window(1.5, 22) for h in HALVES}, "test": window(1.5000001, 22)}, "one window differs")
    db.assert_independent(vault, {h: window(1.5, 0) for h in HALVES}, "same edge, no recentres")


def test_committed_baseline_covers_every_replayed_token():
    assert len(COMMITTED["tokens"]) >= 17 and set(COMMITTED["tokens"]) == set(REPLAY["tokens"])


def test_committed_vault_column_is_the_replay_result():
    for sym, t in COMMITTED["tokens"].items():
        rt = REPLAY["tokens"][sym]
        c = rt["chosen_v4"] if rt.get("venue") == "v4" else rt["chosen"]
        row = next(p for p in rt["pools"] if p["id"] == c["id"])
        assert t["vault"]["pool"] == c["id"], sym
        for h in HALVES:
            assert t["vault"][h]["edge_apr_pct"] == pytest.approx(row[h]["edge_apr_pct"], abs=1e-9) and t["vault"][h]["rebalances"] == row[h]["rebalances"], f"{sym} {h}"


def test_baseline_is_not_the_vault_result():
    n = len(COMMITTED["tokens"])
    assert n >= 17
    for v in db.VARIANTS:
        differs = 0
        for sym, t in COMMITTED["tokens"].items():
            db.assert_independent(t["vault"], t[v], f"{sym} {v}")
            differs += any(t[v][h]["edge_apr_pct"] != t["vault"][h]["edge_apr_pct"] for h in HALVES)
        assert differs == n, f"{v}: equal to the vault on {n - differs} tokens"
    # the vault recentres daily, a position set once never does
    assert all(t["vault"]["full"]["rebalances"] > 0 for t in COMMITTED["tokens"].values())
    assert all(t[v][h]["rebalances"] == 0 for t in COMMITTED["tokens"].values() for v in db.VARIANTS for h in HALVES)


@pytest.mark.skipif(not HAVE_ENGINE_DATA, reason="needs keeper/data/engine and keeper/data/swaps from replay/pull.py")
@pytest.mark.parametrize("sym", ["AAPL", "PLTR", "NVDA"])
def test_recomputed_baseline_matches_committed_and_is_not_the_vault(sym):
    """Runs the real engine for one token: a baseline wired to the vault's plan raises in diy_token (assert_independent)."""
    u = json.load(open(os.path.join(rp.KEEPER, "data", "universe.json")))
    params = json.load(open(rp.PARAMS_PATH))
    t = db.diy_token(sym, next(x for x in u["tokens"] if x["symbol"] == sym), REPLAY["tokens"][sym], params, rp.load_hook_allowlist(), rp.load_v4_depths())
    for v in db.VARIANTS:
        for h in HALVES:
            assert t[v][h]["edge_apr_pct"] == pytest.approx(COMMITTED["tokens"][sym][v][h]["edge_apr_pct"], abs=1e-9), f"{sym} {v} {h}: committed file is stale"
            assert t[v][h]["rebalances"] == 0
            assert t["vault"][h]["rebalances"] > 0 or h != "full"
