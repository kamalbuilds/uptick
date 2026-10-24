"""Net cost of an NVDA weekend short at $10k, per weekend, from the tracked JSON in this folder and web/lib/__fixtures__.
net cost = round-trip book slippage + fees - funding earned + margin interest      (positive: the weekend costs, negative: it earns)
Run: python3 weekend_cost.py
Check: python3 weekend_cost.py --check FILE... fails when a file states a different "N bp at $10k" than the one printed here, or when the first file states none."""
import json, math, os, re, statistics as st, sys
H = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(H, "..", "..", "..", "web", "lib", "__fixtures__")
NOTIONAL, LEVERAGE, HOURS, SYM = 10_000, 5, 65, "NVDA"   # 5x is the planner default, 65 h is Friday 16:00 to Monday 09:00 New York

book = json.load(open(os.path.join(H, "book.json")))[SYM]
slip = [r["open10000"] + r["close10000"] for r in book]           # sell into the bids, buy back from the asks, bp of notional
rt = st.median(slip)

det = next(m for m in json.load(open(os.path.join(FIX, "lighter-orderbookdetails.json")))["order_book_details"] if m["symbol"] == SYM)
fee_bp = (float(det["taker_fee"]) + float(det["maker_fee"])) * 1e2  # fee fields are percent of notional per side; a round trip takes twice

fund = [r[1] for r in json.load(open(os.path.join(H, "funding_weekends.json")))[SYM] if r[3] == HOURS]   # a short's weekend funding in bp, complete weekends only

mk = json.load(open(os.path.join(FIX, "morpho-nvda-usdg-borrow.json")))["data"]["markets"]["items"]
deep = max(mk, key=lambda m: m["state"]["supplyAssetsUsd"])         # the deepest market, as lib/hedge-view.ts parseBorrowApr picks it
apr = math.log1p(deep["state"]["borrowApy"]) * 100
carry_usd = NOTIONAL / LEVERAGE * apr / 100 * HOURS / 8760
carry_bp = carry_usd / NOTIONAL * 1e4

print(f"{SYM} weekend short, ${NOTIONAL:,} notional, {LEVERAGE}x, {HOURS} h held")
print(f"  round-trip slippage  {rt:5.2f} bp   median of {len(slip)} book snapshots in book.json (range {min(slip):.2f} to {max(slip):.2f})")
print(f"  fees                 {fee_bp:5.2f} bp   taker {det['taker_fee']}% maker {det['maker_fee']}% (lighter-orderbookdetails.json)")
print(f"  margin interest      {carry_bp:5.2f} bp   ${carry_usd:.2f} on ${NOTIONAL / LEVERAGE:,.0f} borrowed at {apr:.1f}% a year (morpho-nvda-usdg-borrow.json, market {deep['marketId'][:10]})")
print(f"  funding earned       {st.mean(fund):5.2f} bp   mean of {len(fund)} complete weekends in funding_weekends.json (range {min(fund):.2f} to {max(fund):.2f})")
net = [rt + fee_bp + carry_bp - f for f in fund]
print(f"  per-weekend net cost (positive costs, negative earns), bp:")
print("   " + " ".join(f"{n:.1f}" for n in net))
print(f"NET COST {st.mean(net):.1f} bp = ${st.mean(net) / 1e4 * NOTIONAL:.2f} on ${NOTIONAL:,} (mean of {len(net)} weekends; costs in {sum(n > 0 for n in net)}, earns in {sum(n <= 0 for n in net)})")

if sys.argv[1:2] == ["--check"]:
    want = f"{st.mean(net):.1f}"
    root = os.path.join(H, "..", "..", "..")
    bad = 0
    for i, f in enumerate(sys.argv[2:]):
        said = re.findall(r"([\d.]+) bp at \$10k", open(os.path.join(root, f)).read())
        if (i == 0 and not said) or any(x != want for x in said):
            print(f"{f}: states {said or 'no figure'} bp at $10k, weekend_cost.py prints {want}")
            bad = 1
    print(f"weekend cost check: {'FAILED' if bad else 'ok'} ({want} bp)")
    sys.exit(bad)
