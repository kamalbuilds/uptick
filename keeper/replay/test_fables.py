"""Plain-assert test for replay/fables.py: the Swap event's fee field is what the Fables replay books. Run: STOCK_VAULTS_SPIKE=<spikes/stock-vaults> /opt/homebrew/bin/python3.14 replay/test_fables.py
Needs data/swaps, data/engine and data/fables-pools.json (replay/pull.py, scripts/build-fables-pools.ts)."""
import os, sys, json, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fables as fb
import replay as rp

STATIC_PIPS = 500  # the NVDA v3 tier the chosen pool charges; the Fables NVDA pool charges 986 distinct levels around 1035 pips volume-weighted

def nvda():
    u = next(x for x in json.load(open(os.path.join(rp.KEEPER, "data", "universe.json")))["tokens"] if x["symbol"] == "NVDA")
    fp = fb.load_fables_pools()["NVDA"][0]
    return u, fp, rp.band_bps_for("NVDA", json.load(open(rp.PARAMS_PATH)))

def full_fee_apr(row, size="feasible_cap"):
    return row["sizes"][size]["full"]["fee_apr_pct"]

def test_protocol_fee_guard():
    fp = fb.load_fables_pools()["NVDA"][0]
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump({"pools": [dict(fp, protocolFee=4097000)]}, f)
    try:
        fb.load_fables_pools(f.name)
    except AssertionError as e:
        assert "protocol fee" in str(e)
    else:
        raise SystemExit("a pool with a PoolManager protocol fee must be refused")
    finally:
        os.remove(f.name)

def test_event_fee_is_used():
    u, fp, band = nvda()
    ev, _ = fb.replay_fables_pool(u, fp, band)
    st, _ = fb.replay_fables_pool(u, fp, band, static_pips=STATIC_PIPS)
    assert ev["distinct_fee_levels"] > 100 and abs(ev["vw_fee_pips"] - STATIC_PIPS) > 100, ev   # the hook really moved the fee
    assert st["distinct_fee_levels"] == 1 and abs(st["vw_fee_pips"] - STATIC_PIPS) < 1e-6, st
    d = abs(full_fee_apr(ev) - full_fee_apr(st))
    assert d > 5, f"forcing the fee to the static tier moved fee APR by only {d:.2f} pp: the event fee is not what the replay books"
    assert abs(ev["pool_fees_usd"] - st["pool_fees_usd"]) / st["pool_fees_usd"] > 0.2
    # the event rows are the source: rewriting their fee column to the static tier must reproduce the static run exactly
    real = rp.pull.v4_rows
    rp.pull.v4_rows = lambda pid: [r[:9] + [STATIC_PIPS] for r in real(pid)]
    try:
        rw, _ = fb.replay_fables_pool(u, fp, band)
    finally:
        rp.pull.v4_rows = real
    for h in ("full", "calibration", "test"):
        assert rw["sizes"]["feasible_cap"][h] == st["sizes"]["feasible_cap"][h], h
    print(f"event fee APR {full_fee_apr(ev):.1f}% vs forced {STATIC_PIPS} pips {full_fee_apr(st):.1f}%; rewritten rows reproduce the forced run")

if __name__ == "__main__":
    test_protocol_fee_guard(); test_event_fee_is_used()
    print("2 tests passed")
