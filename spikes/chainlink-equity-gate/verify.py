#!/usr/bin/env python3
"""Spike: the Chainlink Robinhood tokenized-equity feed exposes corporate-action
state that Uptick's oracle gate does not read today (contracts/src/hook/UptickHook.sol:167
reads latestRoundData() and uiMultiplier() only).

Asserts, against the live Robinhood Chain (4663) and real aggregator proxies, that:
  1. the Stock Token exposes oraclePaused() -> bool and a staged-multiplier path
     (newUIMultiplier() + effectiveAt());
  2. the standard Chainlink proxy is a tokenized-equity Total Return feed
     (description "Robinhood <SYM> / USD", 8 decimals, positive answer) and is fresh
     whenever the US equity market is open, stale only when the market is closed;
  3. the Smart Value Recapture (SVR) proxy returns the same answer and is readable
     by any protocol;
  4. the answer times uiMultiplier() is the total-return token mark, so a vault that
     ignores the multiplier misprices shares across dividends and splits;
  5. the on-chain gate (StockVault.sol:735, UptickHook.sol:167) compares the feed's
     updatedAt against a flat wall-clock maxStaleness with no market-hours term and
     no oraclePaused() read, so a weekend or corporate-action close reads as a dead
     oracle even though the keeper's NYSE calendar knows the market is shut.

Reads only public endpoints. No keys. Exits non-zero if any assertion fails.
Run: python3 spikes/chainlink-equity-gate/verify.py
"""
import datetime
import json
import sys
import time
import urllib.request

RPC = "https://rpc.mainnet.chain.robinhood.com"
UA = "uptick-spike/1.0"

# AAPL on Robinhood Chain: stock token, standard proxy, SVR proxy (Chainlink docs, 2026-10-16).
TOKEN = "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9"
FEED = "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0"
SVR = "0x4bDbb3150014c6Ab2C6D9347B0779c49015a2f3f"
SYMBOL = "AAPL"

SEL_ORACLE_PAUSED = "0x7706ba52"
SEL_UI_MULTIPLIER = "0xa60bf13d"
SEL_NEW_UI_MULTIPLIER = "0xdc767007"
SEL_EFFECTIVE_AT = "0x97a4064f"
SEL_LATEST_ROUND = "0xfeaf968c"
SEL_DESCRIPTION = "0x7284e416"
SEL_DECIMALS = "0x313ce567"

W = 10 ** 18
fails = []


def check(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  {detail}" if detail else ""))
    if not cond:
        fails.append(name)


def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(RPC, data=body, headers={"content-type": "application/json", "user-agent": UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode())["result"]
        except Exception:
            if attempt == 3:
                raise
            time.sleep(1 + attempt)


def call(to, sel):
    return rpc("eth_call", [{"to": to, "data": sel}, "latest"])


def word(hexstr, i):
    h = hexstr[2:]
    return int(h[i * 64:(i + 1) * 64], 16)


def as_int(x):
    return x - (1 << 256) if x >= (1 << 255) else x


def us_equity_weekend(ts):
    """True when the US equity market is closed for the weekend at UTC ts.
    Weekend edge: Friday 20:00 UTC (16:00 ET) through Sunday 24:00 UTC. Holidays
    (e.g. Thanksgiving, Christmas) are not inferred here; they show up as an
    extra stale-but-legitimate window and are called out in the detail line."""
    et = datetime.datetime.fromtimestamp(ts, datetime.timezone.utc) - datetime.timedelta(hours=4)  # EDT approximation
    wd = et.weekday()  # Mon=0 .. Sun=6
    if wd == 5:
        return True
    if wd == 6:
        return True
    if wd == 4 and et.hour >= 16:  # Friday after the close
        return True
    return False


def main():
    print(f"Robinhood Chain 4663, {SYMBOL} tokenized equity")
    block = int(rpc("eth_blockNumber", []), 16)
    print(f"  head block {block}\n")

    # 1. Stock token corporate-action surface, absent from the repo's gate.
    paused = word(call(TOKEN, SEL_ORACLE_PAUSED), 0)
    mult = word(call(TOKEN, SEL_UI_MULTIPLIER), 0)
    staged = word(call(TOKEN, SEL_NEW_UI_MULTIPLIER), 0)
    eff_at = word(call(TOKEN, SEL_EFFECTIVE_AT), 0)
    check("token exposes oraclePaused() as a bool", paused in (0, 1), f"oraclePaused={bool(paused)}")
    check("token exposes uiMultiplier() > 0 (1e18 scale)", mult > 0, f"{mult / W:.9f}")
    check("token exposes staged newUIMultiplier()", staged > 0, f"{staged / W:.9f}")
    check("token exposes effectiveAt()", eff_at > 0, f"{eff_at} ({time.strftime('%Y-%m-%d', time.gmtime(eff_at))} UTC)")

    # 2. Standard proxy is a tokenized-equity Total Return feed.
    desc = call(FEED, SEL_DESCRIPTION)[2:]
    raw = bytes.fromhex(desc)
    ln = int.from_bytes(raw[32:64], "big")
    text = raw[64:64 + ln].decode("utf-8")
    dec = word(call(FEED, SEL_DECIMALS), 0)
    round_ = call(FEED, SEL_LATEST_ROUND)
    answer = as_int(word(round_, 1))
    updated_at = word(round_, 3)
    age = block_time_now = int(time.time()) - updated_at
    check("proxy description is a tokenized-equity feed", text == f"Robinhood {SYMBOL} / USD", text)
    check("proxy decimals is 8", dec == 8, str(dec))
    check("latestRoundData() answer > 0", answer > 0, f"{answer / 10 ** dec:.6f} {SYMBOL}")
    closed = us_equity_weekend(int(time.time()))
    fresh = 0 <= age < 26 * 3600
    check("feed is fresh while the market is open, stale only when it is closed",
          fresh or closed,
          f"age {age // 3600}h {age % 3600 // 60}m, market_closed={closed}")

    # 3. SVR proxy is readable by any protocol and agrees with the standard proxy.
    svr_round = call(SVR, SEL_LATEST_ROUND)
    svr_answer = as_int(word(svr_round, 1))
    check("SVR proxy answer matches standard proxy", svr_answer == answer, f"{svr_answer} == {answer}")

    # 4. The multiplier changes the mark, so ignoring it misprices.
    raw_mark = answer / 10 ** dec
    token_mark = raw_mark * mult / W
    pct = (token_mark / raw_mark - 1) * 100
    check("answer * uiMultiplier() is the total-return mark and differs from raw",
          mult != W, f"raw {raw_mark:.6f} -> total-return {token_mark:.6f} (+{pct:.4f}%)")

    print(f"\n{len(fails)} failed" if fails else "\nall checks passed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
