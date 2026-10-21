"""Plain-assert test: replay.py books a static-fee v4 pool's LP income net of the PoolManager protocol fee.
Uses the cached swap rows of two live pools (data/swaps/v4/<poolId>). Run: /opt/homebrew/bin/python3.14 replay/test_replay_protocol_fee.py

Measured at the pools: every Swap event of the PLTR pool carries fee 10990 (key fee 10000), every one of the TSLA pool 3499 (key fee 3000).
StateView.getSlot0 protocolFee is 4097000 (1000 pips each way) for PLTR and 2048500 (500 pips each way) for TSLA.
"""
import datetime as dt
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import replay as rp

POOLS = {  # symbol: (pool id, key fee in pips, protocol fee in pips per direction)
    "PLTR": ("0xee430ee1003e1985e1828a01b9a20dad67ad4302994fe2abb4a173de4ac54623", 10000, 1000),
    "TSLA": ("0x8517f8071ae5b831b738052f12125e8e3d6c158b78728aa44ce3b25e5104d32e", 3000, 500),
}


def window_pool(sym, pid, fee):
    live = next(p for p in json.load(open(os.path.join(rp.KEEPER, "data", "swaps", f"v4-live-{sym}.json"))) if p["id"] == pid)
    assert live["fee"] == fee
    end = dt.datetime(2026, 10, 17, tzinfo=rp.U); t0 = (end - dt.timedelta(days=rp.DAYS)).timestamp(); t1 = end.timestamp()
    pl, n = rp.v4_pool("t", pid, live["usdg_is_currency0"], fee, live["tick_spacing"], live["hooks"], t0 - 7200, t1 + 7200)
    m = (pl.t >= t0) & (pl.t < t1)
    assert n > 10_000 and m.sum() > 10_000, (n, m.sum())  # a real window, not an empty one
    assert 1e6 < pl.vol[m].sum() < 1e9, "volume in a sane USD range: right currency order"
    return pl, m


def test_lp_fee_rate():
    assert abs(float(rp.lp_fee_rate(0.01099, 10000)) - 0.01 * (1 - 0.001)) < 1e-12
    assert abs(float(rp.lp_fee_rate(0.0034985, 3000)) - 0.003 * (1 - 0.0005)) < 1e-12
    assert float(rp.lp_fee_rate(0.01, 10000)) == 0.01, "no protocol fee: LPs earn the whole key fee"
    assert float(rp.lp_fee_rate(0.009, 10000)) == 0.01, "an event fee under the key fee clips p at 0, never a bonus"


def test_v4_lp_income_is_net_of_protocol_fee():
    for sym, (pid, fee, p) in POOLS.items():
        pl, m = window_pool(sym, pid, fee)
        vol = float(pl.vol[m].sum())
        income = float(pl.fee_usd[m].sum())
        want = vol * (fee / 1e6) * (1 - p / 1e6)
        old = vol * pl.fee0  # what the engine booked before: volume * the total event fee
        assert abs(income / want - 1) < 1e-3, (sym, income, want)
        assert income < old, (sym, income, old)
        assert pl.fee0 > fee / 1e6, "fee0 stays the total fee: the vault pays the protocol fee on its own swaps"
        print(f"{sym}: vol ${vol/1e6:.1f}M LP income ${income:,.0f} (old ${old:,.0f}, overstated {old/income-1:.1%}), fee0 {pl.fee0*1e6:.0f} pips")


if __name__ == "__main__":
    test_lp_fee_rate(); test_v4_lp_income_is_net_of_protocol_fee()
    print("2 tests passed")
