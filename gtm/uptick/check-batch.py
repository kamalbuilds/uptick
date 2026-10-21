#!/usr/bin/env python3
"""Fail if any outreach message breaks the batch rules. Usage: python3 check-batch.py [OUTREACH-BATCH-2026-10-21.md]

Rules: message at most 400 characters, no em or en dash, no double hyphen, one http(s) URL naming the target's own post or
product, only numbers from the product facts, no banned phrases, handle present in the row.
"""
import re
import sys

PATH = sys.argv[1] if len(sys.argv) > 1 else "OUTREACH-BATCH-2026-10-21.md"
MAX = 400
# 17 tokens ranked, 11 pass, 9 reduced, 2,705,097 swaps, 0.35% entry fee; asks use 5 questions, 3 minutes, 15 minutes.
FACT_NUMBERS = {"17", "11", "9", "2,705,097", "0.35%", "5", "3", "15", "8"}  # 8 = 11 launch vaults minus the 3 named (AAPL, NVDA, GOOGL)
BANNED = [
    "revolution", "game-chang", "seamless", "excited to", "hope this finds", "synerg", "leverage", "unlock", "cutting-edge",
    "this week", "mainnet is live", "now live", "launched on mainnet", "guaranteed", "risk-free", "10x", "moon",
]

rows = []
for line in open(PATH, encoding="utf-8"):
    cells = [c.strip() for c in line.strip().strip("|").split("|")]
    if len(cells) >= 7 and cells[0].isdigit():
        rows.append(cells)

problems = []
if not rows:
    problems.append("no table rows found (a check that reads nothing proves nothing)")

for cells in rows:
    n, target, handle, source, channel, message, ask = cells[0], cells[1], cells[2], cells[3], cells[4], cells[5], cells[6]
    tag = f"row {n} {target}"
    if len(message) > MAX:
        problems.append(f"{tag}: {len(message)} chars > {MAX}")
    if re.search(r"[–—]|--", message):
        problems.append(f"{tag}: dash")
    urls = re.findall(r"https?://\S+", message)
    if not urls:
        problems.append(f"{tag}: no URL in message")
    bare = re.sub(r"https?://\S+|ERC-4626|\bv\d+\b", "", message)
    for num in re.findall(r"\d[\d,]*(?:\.\d+)?%?", bare):
        if num.rstrip(",.") not in FACT_NUMBERS:
            problems.append(f"{tag}: number {num!r} is not a product fact")
    low = message.lower()
    for phrase in BANNED:
        if phrase in low:
            problems.append(f"{tag}: banned phrase {phrase!r}")
    if not re.match(r"^https?://", source):
        problems.append(f"{tag}: source URL missing")
    if not (handle.startswith("@") or handle.startswith("u/") or handle == "-" or "@" in handle or handle.startswith("t.me/")):
        problems.append(f"{tag}: handle {handle!r} unrecognised")
    if not ask:
        problems.append(f"{tag}: empty ask")

print(f"{len(rows)} rows checked, longest message {max((len(r[5]) for r in rows), default=0)} chars")
if problems:
    print("\n".join(problems))
    sys.exit(1)
print("OK")
