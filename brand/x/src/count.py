"""Count every ```text block in copy.md the way X does and fail on any block over its limit or any banned character.

Usage: python3 count.py [copy.md]. Bio limit 160, posts 280. X weighs code points 0-4351 and a few punctuation
ranges as 1, everything else (emoji, CJK) as 2. Banned: em dash, en dash, curly quotes, "--".
"""
import re, sys
from pathlib import Path

src = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent.parent / "copy.md").read_text()
ONE = [(0, 4351), (8192, 8205), (8208, 8223), (8242, 8247)]
weight = lambda s: sum(1 if any(a <= ord(c) <= b for a, b in ONE) else 2 for c in s)
bad, n = [], 0
head = ""
for line_block in re.split(r"(```text\n.*?\n```)", src, flags=re.S):
    if line_block.startswith("```text"):
        body = line_block[8:-4]
        n += 1
        limit = 160 if head.splitlines()[-1:] and head.splitlines()[-1].startswith("Bio") else 280
        w = weight(body)
        print(f"{w:4d}/{limit}  {body[:60]!r}")
        if w > limit:
            bad.append(f"over {limit}: {body[:50]!r} ({w})")
        for ch, name in [("—", "em dash"), ("–", "en dash"), ("‘", "curly quote"), ("’", "curly quote"), ("“", "curly quote"), ("”", "curly quote"), ("--", "double hyphen")]:
            if ch in body:
                bad.append(f"{name} in {body[:50]!r}")
    else:
        head = line_block.strip()
if not n:
    bad.append("no text blocks found")
for ch in ["—", " -- "]:
    if ch in src:
        bad.append(f"{ch!r} in copy.md outside blocks")
print({"blocks": n, "bad": bad})
sys.exit(1 if bad else 0)
