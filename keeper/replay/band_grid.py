"""Band grid: the replay of each token's chosen v3 pool at every band width from 150 to 2000 bps, with the tick-spacing snap on.
Each cell is the kept APR (edge_apr_pct, conservative accounting) of the calibration half and of the held-out half, plus the 30 day fee APR.
The band a vault runs is its range_bps in data/params.json; selection.json carries that band's cells (they equal the token's row in data/replay.json, which this script asserts)
and best_calibration_bps, the band with the best calibration cell in this grid.
Run: python3 replay/band_grid.py [SYMBOL...]   (needs the data of replay/pull.py; STOCK_VAULTS_SPIKE when the engine is not at ../../spikes)
Output: data/band-grid/grid-summary.json (symbol -> bps -> calibration, heldout, fee_apr) and data/band-grid/selection.json (the pick per token and its door)."""
import sys, os, json
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import replay as rp

BANDS = (150, 250, 350, 500, 750, 1000, 1500, 2000)
OUT_DIR = os.environ.get("BAND_GRID_DIR") or os.path.join(rp.KEEPER, "data", "band-grid")


def gate(worst):
    return "open" if worst >= 0 else "reduced" if worst >= rp.KEEP_FLOOR_APR else "closed"


def grid_token(sym, tok, chosen_id, allow, depths):
    cells = {}
    for bps in BANDS:
        _, _, _, _, rows, _, _ = rp.replay_token(tok, bps, allow, depths)
        r = next(x for x in rows if x["id"] == chosen_id)
        cells[str(bps)] = dict(calibration=r["calibration"]["edge_apr_pct"], heldout=r["test"]["edge_apr_pct"], fee_apr=r["full"]["fee_apr_pct"])
    return cells


def main(symbols):
    rep = json.load(open(os.path.join(rp.KEEPER, "data", "replay.json")))
    params = json.load(open(rp.PARAMS_PATH))
    uni = {x["symbol"]: x for x in json.load(open(os.path.join(rp.KEEPER, "data", "universe.json")))["tokens"]}
    allow, depths = rp.load_hook_allowlist(), rp.load_v4_depths()
    grid, sel = {}, {}
    for sym in symbols or list(rep["tokens"]):
        print(sym, flush=True)
        grid[sym] = grid_token(sym, uni[sym], rep["tokens"][sym]["chosen"]["id"], allow, depths)
        best = max(grid[sym], key=lambda b: grid[sym][b]["calibration"])
        used = str(rp.band_bps_for(sym, params))
        c = grid[sym][used]; worst = min(c["calibration"], c["heldout"])
        row = next(p for p in rep["tokens"][sym]["pools"] if p["id"] == rep["tokens"][sym]["chosen"]["id"])
        assert abs(c["calibration"] - row["calibration"]["edge_apr_pct"]) < 1e-9 and abs(c["heldout"] - row["test"]["edge_apr_pct"]) < 1e-9, f"{sym}: the grid cell at {used} bps differs from replay.json"
        sel[sym] = dict(range_bps=int(used), best_calibration_bps=int(best), calibration=round(c["calibration"], 2), heldout=round(c["heldout"], 2), worst=round(worst, 2), gate=gate(worst))
    os.makedirs(OUT_DIR, exist_ok=True)
    json.dump(rp.finite(grid), open(os.path.join(OUT_DIR, "grid-summary.json"), "w"), indent=1, allow_nan=False)
    json.dump(sel, open(os.path.join(OUT_DIR, "selection.json"), "w"), indent=1, allow_nan=False)
    for sym, s in sel.items():
        print(f"{sym:6} band {s['range_bps']:>5} (best calibration {s['best_calibration_bps']:>5}) cal {s['calibration']:8.2f} heldout {s['heldout']:8.2f} {s['gate']}")


if __name__ == "__main__":
    main(sys.argv[1:])
