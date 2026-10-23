"""The moment and one real swap, both from keeper/data/replay.json and the swap caches the replay reads.
Run: /usr/bin/python3 keeper/scripts/moment.py            (needs numpy; reads data/swaps and data/engine, written by replay/pull.py)
Prints, per window:
  1. share of swaps, LP fees and clock time outside NYSE regular hours, over the pool each vault is gated on;
  2. fee earned per $1 lost to informed traders (1 hour markout) by session, pooled over those pools: the vault replay (replay.json
     sessions) and the pool as a whole (engine arrays, same markout);
  3. the PLTR v4 swap that cost its LPs the most while moving the pool toward a Chainlink price already published,
     and writes it to web/lib/real-swap.json for the vault page and the deck appendix.
Markout is the engine's: LPs' inventory change valued at the pool price one hour later (engine.Pool.M1h)."""
import sys, os, json, glob, urllib.request, datetime as dt
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
KEEPER = os.path.normpath(os.path.join(HERE, ".."))
sys.path.insert(0, os.path.join(KEEPER, "replay"))
import replay as R                     # binds the engine to data/engine and exposes the pool loaders
import engine
from engine import Pool, TOK, simulate, pos_xy
from strategies import Ref, label_slots, trading_days, HALF, REG, NIGHT, WE

U = dt.timezone.utc
SESS = {REG: "nyse_hours", NIGHT: "weeknight", WE: "weekend"}
WEB = os.path.normpath(os.path.join(KEEPER, "..", "web", "lib"))
SWAP_POOL = "0xee430ee1003e1985e1828a01b9a20dad67ad4302994fe2abb4a173de4ac54623"   # PLTR / USDG v4, 1% fee
SWAP_SYMBOL = "PLTR"
RPC_URL = "https://rpc.mainnet.chain.robinhood.com"

class Spy(Pool):
    """A Pool that also keeps which source rows survived its filters, so a swap maps back to its transaction."""
    def _set(self, t, P, L, dq, du, lo=None, hi=None):
        super()._set(t, P, L, dq, du, lo=lo, hi=hi)
        keep, k = [], 0
        for i in range(len(t)):
            if k < self.n and t[i] == self.t[k] and P[i] == self.P[k] and dq[i] == self.dq[k] and du[i] == self.du[k]:
                keep.append(i); k += 1
        assert k == self.n, "row mapping lost a swap"
        self.keep = np.array(keep)

def gate_pool(tok):
    """The pool replay.json's `sessions` block for `tok` describes: the chosen v4 pool when the token deploys on v4 and has sessions_v4, else the chosen v3 pool."""
    return ("v4", tok["chosen_v4"]) if tok.get("venue") == "v4" and tok.get("sessions_v4") else ("v3", tok["chosen"])

def pool_loss(pl):
    """1 hour markout loss of the pool's whole in-range liquidity on each swap: engine.simulate's per-event formula (inventory change of the curve, valued at M1h)
    with Lv = the liquidity active in the swap. Fees are not in it; the engine books them apart."""
    lv = 0.5 * (pl.L + pl.Lp); lo, hi = 1e-9, 1e12
    xa, ya = pos_xy(pl.P, lo, hi, lv); xb, yb = pos_xy(pl.Pp, lo, hi, lv)
    return -((xa - xb) * pl.M1h + (ya - yb))

def load(sym, tok, ut, t0, t1, cls=Pool):
    kind, c = gate_pool(tok)
    if kind == "v4":
        live = next(p for p in json.load(open(os.path.join(KEEPER, "data", "swaps", f"v4-live-{sym}.json"))) if p["id"] == c["id"])
        import gzip
        rows = R.pull.v4_rows(c["id"])
        gz = os.path.join(R.ENGINE_DIR, f"tmp-moment-{os.getpid()}.json.gz"); sel = gz + ".sel"
        json.dump({"swaps": {c["id"]: rows}}, gzip.open(gz, "wt"))
        c0, c1 = (R.USDG, "0x0") if live["usdg_is_currency0"] else ("0x0", R.USDG)
        json.dump({c["id"]: [f"{sym}-v4", c0, c1, live["fee"], live["tick_spacing"], live["hooks"]]}, open(sel, "w"))
        try: pl = cls.from_v4(f"{sym}-v4", c["id"], gz=gz, sel=sel, t_lo=t0 - 7200, t_hi=t1 + 7200)
        finally: os.remove(gz); os.remove(sel)
        pl.fee_rate = R.lp_fee_rate(pl.fee_rate, live["fee"]); pl.fee_usd = pl.vol * pl.fee_rate   # LP income, as replay.v4_pool books it
        return kind, c, pl, rows, float(c["cap_usd"])
    stock_is0 = int(ut["token"].lower(), 16) < int(R.USDG, 16)
    key = f"{sym}-v3-{c['fee_tier']}"
    TOK[key] = dict(dir=c["id"].lower(), tok0=stock_is0, fee=c["fee_tier"] / 1e6)
    return kind, c, cls(key, t_lo=t0 - 7200, t_hi=t1 + 7200), None, float(ut["cap_usd"])

def main():
    rp = json.load(open(os.path.join(KEEPER, "data", "replay.json")))
    uni = {x["symbol"]: x for x in json.load(open(os.path.join(KEEPER, "data", "universe.json")))["tokens"]}
    vaults = {v["symbol"] for v in json.load(open(os.path.join(WEB, "vault-universe.json")))["vaults"]}
    w = rp["window"]; t0 = dt.datetime.fromisoformat(w["start"]).timestamp(); t1 = dt.datetime.fromisoformat(w["end"]).timestamp()
    slots = label_slots(t0, t1, trading_days())
    clock = {L: float((slots == L).sum()) / len(slots) for L in SESS}
    print(f"window {w['start']} to {w['end']} ({w['days']} days); vault tokens: {len(vaults)}")
    print("clock share  " + "  ".join(f"{SESS[L]} {100 * clock[L]:.1f}%" for L in SESS))
    acc = {nm: dict(swaps=0, fee=0.0, vol=0.0, loss=0.0, vfee=0.0, vloss=0.0) for nm in SESS.values()}
    swap_pick = None
    for sym, tok in rp["tokens"].items():
        if sym not in vaults or "sessions" not in tok: continue
        kind, c, pl, rows, cap = load(sym, tok, uni[sym], t0, t1, cls=Spy if sym == SWAP_SYMBOL else Pool)
        m = (pl.t >= t0) & (pl.t < t1)
        k = np.minimum(((pl.t - t0) // HALF).astype(int), len(slots) - 1); lab = slots[k]
        loss = pool_loss(pl)
        ses = tok["sessions_v4"] if kind == "v4" else tok["sessions"]
        for L, nm in SESS.items():
            s = m & (lab == L)
            a = acc[nm]; a["swaps"] += int(s.sum()); a["fee"] += float(pl.fee_usd[s].sum()); a["vol"] += float(pl.vol[s].sum()); a["loss"] += float(loss[s].sum())
            a["vfee"] += ses[nm]["vault_fee_usd"]; a["vloss"] += ses[nm]["markout_loss_usd"]
            assert abs(float(pl.vol[s].sum()) - ses[nm]["pool_volume_usd"]) < 1e-6 * max(1, ses[nm]["pool_volume_usd"]), f"{sym} {nm}: pool volume differs from replay.json"
        if sym == SWAP_SYMBOL:
            assert c["id"] == SWAP_POOL, f"{sym} gate pool is {c['id']}"
            swap_pick = pick_swap(sym, tok, kind, c, pl, rows, cap, t0, t1, slots, lab, m, loss)
    tot = {k: sum(a[k] for a in acc.values()) for k in ("swaps", "fee", "vol")}
    print(f"\n{'session':10s} {'swaps':>9s} {'swap%':>6s} {'LP fees $':>10s} {'fee%':>6s} {'volume $M':>10s} | pool fee/$lost | vault fee $ / loss $ = per $1 lost")
    for nm, a in acc.items():
        print(f"{nm:10s} {a['swaps']:9d} {100 * a['swaps'] / tot['swaps']:6.1f} {a['fee']:10.0f} {100 * a['fee'] / tot['fee']:6.1f} {a['vol'] / 1e6:10.2f} | {a['fee'] / a['loss']:14.2f} | {a['vfee']:9.0f} / {a['vloss']:7.0f} = {a['vfee'] / a['vloss']:.2f}")
    off = [acc["weeknight"], acc["weekend"]]
    sh = lambda k: 100 * sum(a[k] for a in off) / tot[k]
    print(f"outside NYSE regular hours: {sh('swaps'):.1f}% of swaps, {sh('fee'):.1f}% of LP fees, {sh('vol'):.1f}% of volume, {100 * (1 - clock[REG]):.1f}% of the clock")
    r1 = lambda x: round(float(x), 1)
    moment = dict(
        window=dict(start=w["start"], end=w["end"], days=w["days"]), vaults=len(vaults), swaps=tot["swaps"],
        offHours=dict(swapsPct=r1(sh("swaps")), feesPct=r1(sh("fee")), volumePct=r1(sh("vol")), clockPct=r1(100 * (1 - clock[REG]))),
        sessions={nm: dict(swapsPct=r1(100 * a["swaps"] / tot["swaps"]), feesPct=r1(100 * a["fee"] / tot["fee"]), clockPct=r1(100 * clock[L]),
                           feePerDollarLost=round(a["vfee"] / a["vloss"], 2), poolFeePerDollarLost=round(a["fee"] / a["loss"], 2))
                  for (L, nm), a in zip(SESS.items(), acc.values())},
        source="keeper/scripts/moment.py over keeper/data/replay.json: the gate pool of each vault in web/lib/vault-universe.json; feePerDollarLost is the vault replay (sessions block) summed over tokens, poolFeePerDollarLost the whole pool by the same markout")
    for name, doc in (("moment.json", moment), ("real-swap.json", swap_pick)):
        with open(os.path.join(WEB, name), "w") as f: f.write(json.dumps(doc, indent=2) + "\n")
    print("\nwrote web/lib/moment.json and web/lib/real-swap.json"); print(json.dumps(moment, indent=2)); print(json.dumps(swap_pick, indent=2))

def on_chain(row, pool):
    """Read the swap back from the public RPC: the receipt succeeded, the PoolManager Swap log at the row's logIndex is this pool's with this row's amounts.
    Returns the block timestamp and how many PoolManager swaps the transaction made (a routed trade carries several)."""
    def rpc(m, p):
        req = urllib.request.Request(RPC_URL, json.dumps(dict(jsonrpc="2.0", id=1, method=m, params=p)).encode(), {"content-type": "application/json", "user-agent": "uptick-moment"})
        return json.load(urllib.request.urlopen(req, timeout=30))["result"]
    rc = rpc("eth_getTransactionReceipt", [row[2]])
    assert rc["status"] == "0x1" and int(rc["blockNumber"], 16) == row[0], "receipt does not match the replay row"
    swaps = [l for l in rc["logs"] if l["address"].lower() == R.pull.PM.lower() and l["topics"][0] == R.pull.V4_SWAP]
    mine = next(l for l in swaps if int(l["logIndex"], 16) == row[1])
    s256 = lambda x: x - (1 << 256) if x >> 255 else x
    w = [s256(int(mine["data"][2 + i * 64:2 + (i + 1) * 64], 16)) for i in range(2)]
    assert mine["topics"][1].lower() == pool.lower() and w == [row[4], row[5]], "Swap log differs from the replay row"
    return int(rpc("eth_getBlockByNumber", [hex(row[0]), False])["timestamp"], 16), len(swaps)

def pick_swap(sym, tok, kind, c, pl, rows, cap, t0, t1, slots, lab, m, loss):
    """Largest 1 hour LP loss among swaps that moved the pool toward the Chainlink answer already on chain: pool price before the swap was off it by 0.5% or more,
    the swap moved it the right way, and left it closer. Sized to the pool: the loss is the whole pool's LPs, the vault's own share is in `vault`."""
    ref = Ref(sym)
    r = np.array([ref.at(t) for t in pl.t]); age = np.array([ref.age(t) for t in pl.t])
    gap_before = np.log(pl.Pp / r); gap_after = np.log(pl.P / r)
    toward = (np.abs(gap_before) >= 0.005) & (np.abs(gap_after) < np.abs(gap_before)) & (np.sign(pl.P - pl.Pp) == -np.sign(gap_before)) & m
    cand = np.flatnonzero(toward)
    print(f"\n{sym}: {int(m.sum())} swaps in window, {len(cand)} moved the pool toward Chainlink from 0.5% or more away")
    order = cand[np.argsort(-loss[cand])]
    for i in order[:5]:
        print(f"  idx {i} tx {rows[pl.keep[i]][2]} t {dt.datetime.fromtimestamp(pl.t[i], U):%Y-%m-%d %H:%M} {SESS[int(lab[i])]} vol ${pl.vol[i]:,.0f} fee ${pl.fee_usd[i]:,.2f} loss ${loss[i]:,.2f} gap {1e4 * gap_before[i]:.0f} -> {1e4 * gap_after[i]:.0f} bps")
    i = int(order[0])
    row = rows[pl.keep[i]]
    # the vault's own take of this swap, from the replay path (same simulate call as replay.session_split)
    params = json.load(open(R.PARAMS_PATH)); bps = R.band_bps_for(sym, params)
    chk, _ = R.recentre_slots(ref, t0, t1)
    plan = R.FeasibleStatic(ref, bps / 10000.0, chk)
    engine.SHARE = "mixed"
    rec = simulate(pl, cap, t0, t1, plan, record=True)["arr"]
    ss = R.session_split(pl, ref, t0, t1, plan, cap)
    for nm in SESS.values():
        assert abs(ss[nm]["vault_fee_usd"] - tok["sessions_v4"][nm]["vault_fee_usd"]) < 1e-6, "session_split no longer reproduces replay.json"
    block_ts, legs = on_chain(row, c["id"])
    assert abs(block_ts - float(pl.t[i])) < 60, "grid time and block time disagree"
    return dict(
        symbol=sym, pool=c["id"], poolFeePips=c["fee_tier"], venue="v4", tx=row[2], block=int(row[0]), logIndex=int(row[1]),
        time=dt.datetime.fromtimestamp(block_ts, U).isoformat(timespec="seconds"), routedSwaps=legs, session=SESS[int(lab[i])],
        side="sold PLTR for USDG" if pl.dq[i] > 0 else "bought PLTR with USDG",
        amountToken=round(float(abs(pl.dq[i])), 4), sizeUsd=round(float(pl.vol[i]), 2), poolFeeUsd=round(float(pl.fee_usd[i]), 2),
        markoutLossUsd=round(float(loss[i]), 2),
        priceBefore=round(float(pl.Pp[i]), 4), priceAfter=round(float(pl.P[i]), 4), priceHourLater=round(float(pl.M1h[i]), 4),
        chainlink=round(float(r[i]), 4), chainlinkAgeS=round(float(age[i])), gapBeforeBps=round(1e4 * float(abs(gap_before[i])), 1), gapAfterBps=round(1e4 * float(abs(gap_after[i])), 1),
        vault=dict(capUsd=cap, feeUsd=round(float(rec["FE"][i]), 4), markoutLossUsd=round(float(-rec["MK"][i]), 4)),
        source="keeper/scripts/moment.py: keeper/data/replay.json window, PoolManager Swap logs, Chainlink answer at the swap block; markout is engine.Pool.M1h",
        window=dict(start=dt.datetime.fromtimestamp(t0, U).isoformat(), end=dt.datetime.fromtimestamp(t1, U).isoformat()),
    )

if __name__ == "__main__":
    main()
