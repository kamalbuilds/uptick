#!/usr/bin/env python3
"""Runs the proposal in an agent_instruction through lighter-agent-kit's paper engine and prints a log.
Usage: agent-kit-paper-run.py <plan.json> <kit_dir> <home_dir> <py312_bin_dir>
No key, no live order: paper.py is a local simulation against live Lighter RH order books. HOME points at a scratch dir so nothing lands in the real home."""
import datetime, json, os, subprocess, sys, urllib.request

plan_path, kit, home, pybin = sys.argv[1:5]
plan = json.load(open(plan_path))
x = plan["execution_proposal"]
instruction = plan["agent_instruction"]
env = dict(os.environ, PATH=pybin + ":" + os.environ["PATH"], HOME=home, LIGHTER_HOST=x["api_host"])
env.pop("LIGHTER_API_PRIVATE_KEY", None)


def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def run(cmd, label=None):
    print(f"\n[{now()}] $ {cmd}" + (f"    # {label}" if label else ""))
    r = subprocess.run(cmd, shell=True, cwd=kit, env=env, capture_output=True, text=True)
    try:
        parsed = json.loads(r.stdout)
    except Exception:
        parsed = None
    print(json.dumps(parsed) if parsed is not None else (r.stdout.strip() or "(no stdout)"))
    if r.stderr.strip():
        print("stderr:", r.stderr.strip()[:400])
    return parsed


def get(path):
    with urllib.request.urlopen(x["api_host"] + path, timeout=20) as f:
        return f.status, json.load(f)


def base_walk(levels, base):
    rem, quote = base, 0.0
    for p, s in levels:
        t = min(rem, s)
        quote += t * p
        rem -= t
        if rem <= 1e-12:
            break
    return (quote / (base - rem) if base - rem > 0 else None), rem


print("# kit")
print(subprocess.run("git -C . describe --tags --always; git rev-parse HEAD; git log -1 --format=%ad --date=iso", shell=True, cwd=kit, capture_output=True, text=True).stdout.strip())
print(open(os.path.join(kit, ".vendor/py3.12/lighter_sdk-1.1.2.dist-info/direct_url.json")).read())
print(subprocess.run("python3 --version", shell=True, cwd=kit, env=env, capture_output=True, text=True).stdout.strip())

print("\n# the proposal under test (from plan_weekend_hedge, market_data_at %s, valid_until %s)" % (x["market_data_at"], x["valid_until"]))
print(instruction)

print("\n# reads: symbol form and the geo gate")
st, ob = get("/api/v1/orderBooks")
print(f"GET /api/v1/orderBooks -> HTTP {st}, code {ob.get('code')} (a geo block would be code 20558)")
run("python3 scripts/query.py market list --search NVDA")

paper_cmds = [l.split("    #")[0] for l in instruction.splitlines() if l.startswith("python3 scripts/paper.py")]
init, ioc, positions, close = paper_cmds

# the book the paper engine will see: its 100-level snapshot, fetched right before the open
st, b = get(f"/api/v1/orderBookOrders?market_id={x['market']['market_id']}&limit=100")
bids = sorted(((float(o["price"]), float(o["remaining_base_amount"])) for o in b["bids"]), key=lambda t: -t[0])
asks = sorted(((float(o["price"]), float(o["remaining_base_amount"])) for o in b["asks"]), key=lambda t: t[0])
size = float(x["size"]["base"])
avg_base, left = base_walk(bids, size)
print(f"\n# book snapshot at {now()} (limit=100 a side, what paper.py sees): best bid {bids[0][0]}, best ask {asks[0][0]}, mid {(bids[0][0]+asks[0][0])/2}, bid depth {sum(s for _, s in bids):.2f} NVDA over {len(bids)} levels")
print(f"our walk of this book for {size} NVDA sold by base size: average {avg_base:.4f}, unfilled {left}")

print("\n# A. the proposal's own paper commands, verbatim")
run("python3 scripts/paper.py reset --collateral 1 --tier standard", "scratch HOME: clears any earlier run so init below starts clean")
os.remove(os.path.join(home, ".lighter/lighter-agent-kit/paper-state.json"))
run(init)
o = run(ioc)
run(positions)
run("python3 scripts/paper.py liquidation_price NVDA")
run("python3 scripts/paper.py health")
c = run(close)
run("python3 scripts/paper.py trades --symbol NVDA --limit 3")
run("python3 scripts/paper.py positions")
run("python3 scripts/paper.py status")
print("\n# A. numbers")
if o:
    print(f"proposal expected_avg_fill_price {x['order']['expected_avg_fill_price']} (USD walk of 250 levels at {x['market_data_at']}), limit_price {x['order']['limit_price']}")
    print(f"our base walk of the 100-level book just before: {avg_base:.4f}")
    print(f"paper open avg_price {o['avg_price']:.4f}, filled {o['filled_size']}, unfilled {o['unfilled']}, fee {o['total_fee']}, fills {o['fills_count']}")
    print(f"paper vs proposal expected: {(o['avg_price']-float(x['order']['expected_avg_fill_price']))/float(x['order']['expected_avg_fill_price'])*1e4:+.2f} bp; paper vs our base walk: {(o['avg_price']-avg_base)/avg_base*1e4:+.2f} bp")
    print(f"paper open fill vs proposal limit: {o['avg_price']:.4f} >= {x['order']['limit_price']}: {o['avg_price'] >= float(x['order']['limit_price'])}")
if c:
    print(f"paper close avg_price {c['avg_price']:.4f}, fee {c['total_fee']}")
if o and c:
    rt = (c["avg_price"] - o["avg_price"]) / o["avg_price"] * 1e4
    print(f"paper round trip (buy back avg {c['avg_price']:.4f} vs sell avg {o['avg_price']:.4f}) cost {rt:.2f} bp of notional = {(c['avg_price']-o['avg_price'])*size:.2f} USD; proposal estimated_costs.slippage_bp {x['estimated_costs']['slippage_bp']} bp = {x['estimated_costs']['slippage_usd']} USD (slippage is measured against mid, so the spread is in both)")

print("\n# A2. the same open on the kit's default tier (premium, 2.8 bp taker) against Lighter RH's 0 fee")
run("python3 scripts/paper.py reset --collateral %s --tier premium" % x["margin_usdg"])
pr = run(ioc)
run(close)
if pr:
    print(f"premium tier fee on the open: {pr['total_fee']:.2f} USD ({pr['total_fee']/pr['quote_amount']*1e4:.2f} bp); the standard-tier run above charged {o['total_fee'] if o else 'n/a'}; Lighter RH NVDA taker_fee in the proposal: fees_bp {x['estimated_costs']['fees_bp']}")

print("\n# B. orders that should be rejected or refused")
run("python3 scripts/paper.py reset --collateral %s --tier standard" % x["margin_usdg"])
run("python3 scripts/paper.py order market NVDA --side short --amount 0.01", "below Lighter's minimum of 0.0400 NVDA (min_quote 10 USD): does paper refuse it?")
run("python3 scripts/paper.py positions --symbol NVDA")
run("python3 scripts/paper.py order market NVDA --side long --amount 0.01", "close it")
run("python3 scripts/paper.py order market NVDA --side short --amount 1.23456", "five size decimals, NVDA takes four")
run("python3 scripts/paper.py order market NVDA --side short --amount 0", "zero")
run("python3 scripts/paper.py order ioc NVDA --side short --amount 1.0 --price 250.00", "sell IOC priced above every bid: not marketable")
run("python3 scripts/paper.py order ioc NVDA --side short --amount 1.0 --price 210.123", "three price decimals, NVDA takes two")
run("python3 scripts/paper.py order market NVDA2 --side short --amount 1", "unknown symbol")
run("python3 scripts/paper.py order market NVDA/USDG --side short --amount 1", "the spot pair form")
run("python3 scripts/paper.py positions")

print("\n# C. partial fills")
run("python3 scripts/paper.py reset --collateral 5000000 --tier standard")
st, b = get(f"/api/v1/orderBookOrders?market_id={x['market']['market_id']}&limit=100")
bids = sorted(((float(o["price"]), float(o["remaining_base_amount"])) for o in b["bids"]), key=lambda t: -t[0])
top3 = sum(s for _, s in bids[:3])
lim = bids[2][0]
amt = round(top3 + 400, 4)
print(f"\n# book at {now()}: top 3 bid levels hold {top3:.4f} NVDA down to {lim}; sell {amt} IOC at {lim:.2f} should fill about {top3:.4f} and leave about 400 unfilled")
p = run(f"python3 scripts/paper.py order ioc NVDA --side short --amount {amt} --price {lim:.2f}", "partial fill by limit price")
if p:
    print(f"partial: filled {p['filled_size']}, unfilled {p['unfilled']}, avg {p['avg_price']:.4f}, fills {p['fills_count']}; partial={p['unfilled'] > 1 and p['filled_size'] > 0}")
run("python3 scripts/paper.py positions --symbol NVDA")
depth = sum(s for _, s in bids)
big = round(depth * 1.2, 4)
print(f"\n# depth exhaustion: paper reads 100 levels a side holding {depth:.2f} NVDA; sell {big} at market")
q = run(f"python3 scripts/paper.py order market NVDA --side short --amount {big}", "partial fill by depth")
if q:
    print(f"depth partial: filled {q['filled_size']}, unfilled {q['unfilled']}, fills {q['fills_count']}")
run("python3 scripts/paper.py positions --symbol NVDA")
run("python3 scripts/paper.py status")
pos = run("python3 scripts/paper.py positions")
if pos and pos["positions"]:
    tot = pos["positions"][0]["size"]
    run(f"python3 scripts/paper.py order market NVDA --side long --amount {round(tot + 0.00005, 4)}", "close what is open")
run("python3 scripts/paper.py positions")
run("python3 scripts/paper.py status")

print("\n# D. a position on thin collateral: the engine reports its liquidation price")
run("python3 scripts/paper.py reset --collateral 1000 --tier standard")
r = run("python3 scripts/paper.py order market NVDA --side short --amount 100", "about 21,000 USD notional on 1,000 USD collateral")
run("python3 scripts/paper.py positions")
print("\n# paper state removed")
os.remove(os.path.join(home, ".lighter/lighter-agent-kit/paper-state.json"))
