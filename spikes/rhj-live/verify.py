#!/usr/bin/env python3
"""Spike: does the live Robinhood Stock Token REST API give uptick signals the
repo's static universe snapshot cannot? Cross-checks one field against the chain.

Reads only public endpoints. No keys. Exits non-zero if any assertion fails.
Run: python3 spikes/rhj-live/verify.py
"""
import json
import sys
import urllib.request

ASSETS = "https://api.robinhood.com/rhj/assets"
PRICES = "https://api.robinhood.com/rhj/prices/{sym}"
CORP = "https://api.robinhood.com/rhj/corporate-actions"
RPC = "https://rpc.mainnet.chain.robinhood.com"
SEL_UI_MULTIPLIER = "0xa60bf13d"  # uiMultiplier()  (keccak first 4 bytes)
UA = "uptick-spike/1.0"

fails = []


def check(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  {detail}" if detail else ""))
    if not cond:
        fails.append(name)


def get(url, timeout=30):
    req = urllib.request.Request(url, headers={"accept": "application/json", "user-agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, json.loads(r.read().decode())


def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(RPC, data=body, headers={"content-type": "application/json", "user-agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


print("== 1. live registry ==")
status, assets = get(ASSETS)
alist = assets.get("assets", assets if isinstance(assets, list) else [])
check("assets HTTP 200", status == 200, f"status={status}")
check("registry is non-trivial", len(alist) >= 100, f"{len(alist)} assets")

nvda = next((a for a in alist if a.get("tokenSymbol", "").upper() == "NVDA"), None)
check("NVDA present with an onchain deployment", bool(nvda and nvda.get("deployments")), "")
if not nvda:
    print("cannot continue without NVDA"); print("RESULT FAIL", fails); sys.exit(1)

dep = nvda["deployments"][0]
addr = dep["contractAddress"]
off = nvda.get("currentMultiplier")
check("NVDA on chain 4663", dep.get("chainId") == 4663, f"chainId={dep.get('chainId')}")
check("currentMultiplier is 18dp", off and len(str(off).split(".")[-1]) == 18, f"off={off}")
print(f"  NVDA {addr}  currentMultiplier={off}  status={nvda.get('status')}")

print("== 2. cross-source: REST multiplier vs on-chain uiMultiplier() ==")
res = rpc("eth_call", [{"to": addr, "data": SEL_UI_MULTIPLIER}, "latest"])
onchain = int(res["result"], 16)
if isinstance(off, str):
    whole, _, frac = off.partition(".")
    expected = int(whole) * 10**18 + int((frac + "0" * 18)[:18])  # exact, no float
else:
    expected = int(off)
check("on-chain uiMultiplier() matches REST currentMultiplier", onchain == expected,
      f"chain={onchain} rest={expected}")

print("== 3. live price fields the docs do not list ==")
st, px = get(PRICES.format(sym="NVDA"))
q = (px.get("quotes") or [{}])[0]
check("prices HTTP 200", st == 200, f"status={st}")
check("isTradingHalt exposed", isinstance(q.get("isTradingHalt"), bool),
      f"isTradingHalt={q.get('isTradingHalt')}")
check("multiplier-adjusted tokenBid/tokenAsk exposed",
      "tokenBid" in q and "tokenAsk" in q, f"tokenBid={q.get('tokenBid')} tokenAsk={q.get('tokenAsk')}")
check("generatedAt present", bool(q.get("generatedAt")), f"generatedAt={q.get('generatedAt')}")

print("== 4. corporate actions (split/dividend pre-announcement) ==")
st, ca = get(CORP)
actions = ca.get("corpActions", [])
pending = [a for a in actions if "PENDING" in a.get("status", "") or "IN_PROGRESS" in a.get("status", "")]
check("corporate-actions HTTP 200", st == 200, f"status={st}")
check("corporate actions endpoint returns rows", len(actions) > 0, f"{len(actions)} rows")
if pending:
    p = pending[0]
    print(f"  pending: {p.get('type')} {p.get('tokenSymbol')} processDate={p.get('processDate')}")

print("== 5. negative control (the checks above must be able to fail) ==")
try:
    st2, px2 = get(PRICES.format(sym="NOTAREALSYMBOL"))
    empty = not (px2.get("quotes") or [])
    check("bogus symbol yields no quotes", empty or st2 != 200, f"status={st2} quotes={px2.get('quotes')}")
except urllib.error.HTTPError as e:
    check("bogus symbol rejected by status", e.code >= 400, f"HTTP {e.code}")

print()
if fails:
    print("RESULT FAIL:", ", ".join(fails)); sys.exit(1)
print("RESULT PASS: live RHJ registry, on-chain multiplier agreement, halt + corp-action fields")
