#!/usr/bin/env python3
"""Writes img/system.svg: the "How Uptick works under the hood" diagram as one self-contained file.
Marks and the Hanken Grotesk face are embedded as data URIs, so the SVG renders the same as an <img>, inside the deck, on the docs page and in the short deck.
Run from anywhere: python3 deck/build-system-svg.py"""
import base64, pathlib

HERE = pathlib.Path(__file__).resolve().parent
IMG = HERE / "img"
W, H = 1696, 772
PAD = 2
C = dict(canvas="#0a0b0c", panel="#16181a", raised="#1f2124", border="#42494d", hair="#2a2e31", text="#f4f5f5",
         mute="#919fa6", soft="#c3cbd0", kept="#1fd16b")


def b64(p):
    return base64.b64encode((IMG / p).read_bytes()).decode()


MARKS = {k: "data:image/png;base64," + b64(v) for k, v in dict(
    robinhood="robinhood.png", uniswap="uniswap.png", chainlink="chainlink.png", morpho="morpho.png", lighter="lighter.png").items()}
FONT = "data:font/woff2;base64," + b64("fonts/hanken-grotesk-latin.woff2")

out = []
add = out.append
_clip = [0]


def node(x, y, w, h, dashed=False, hot=False):
    stroke = C["kept"] if hot else C["border"]
    dash = ' stroke-dasharray="9 8"' if dashed else ""
    add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{C["panel"]}" stroke="{stroke}" stroke-width="1.5"{dash}/>')


def text(x, y, s, size=24, weight=400, fill=None, anchor="start"):
    add(f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{fill or C["soft"]}" text-anchor="{anchor}">{s}</text>')


def lines(x, y, ls, size=24, weight=400, fill=None, lh=31):
    for i, s in enumerate(ls):
        text(x, y + i * lh, s, size, weight, fill)
    return y + len(ls) * lh


def mark(key, x, y, s=44, r=None):
    _clip[0] += 1
    cid = f"c{_clip[0]}"
    rr = s / 2 if r is None else r
    add(f'<clipPath id="{cid}"><rect x="{x}" y="{y}" width="{s}" height="{s}" rx="{rr}"/></clipPath>')
    add(f'<image href="{MARKS[key]}" x="{x}" y="{y}" width="{s}" height="{s}" clip-path="url(#{cid})" preserveAspectRatio="xMidYMid slice"/>')


def uptick(x, y, s=44):
    k = s / 400
    add(f'<g transform="translate({x},{y}) scale({k})"><rect width="400" height="400" rx="90" fill="#0e0f0c"/>'
        f'<path d="M68 180 H200 V80 H332 V220 H200 V320 H68 Z" fill="{C["kept"]}" stroke="{C["kept"]}" stroke-width="24" stroke-linejoin="round"/></g>')


def arrow(d, kept=False, dashed=False):
    col = C["kept"] if kept else C["mute"]
    dash = ' stroke-dasharray="10 9"' if dashed else ""
    add(f'<path d="{d}" fill="none" stroke="{col}" stroke-width="3"{dash} marker-end="url(#{"ag" if kept else "ah"})"/>')


add(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W + 2 * PAD}" height="{H + 2 * PAD}" viewBox="0 0 {W + 2 * PAD} {H + 2 * PAD}" role="img" aria-label="How Uptick works under the hood">')
add(f'<defs><style>@font-face{{font-family:"Hanken Grotesk";font-weight:400 600;src:url({FONT}) format("woff2")}}'
    f'text{{font-family:"Hanken Grotesk",system-ui,sans-serif;letter-spacing:-.005em}}</style>'
    f'<marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M1 1 L9 5 L1 9" fill="none" stroke="{C["mute"]}" stroke-width="1.8"/></marker>'
    f'<marker id="ag" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M1 1 L9 5 L1 9" fill="none" stroke="{C["kept"]}" stroke-width="1.8"/></marker></defs>')

add(f'<g transform="translate({PAD},{PAD})">')
GAP = 52
AX, AW = 0, 290
BX, BW = AX + AW + GAP, 480
CX, CW = BX + BW + GAP, 430
DX, DW = CX + CW + GAP, W - (CX + CW + GAP)

# A  Robinhood Chain swaps
node(AX, 0, AW, 236)
mark("robinhood", AX + 24, 24, 56)
text(AX + 24, 126, "Robinhood Chain", 30, 600, C["text"])
text(AX + 24, 164, "swaps", 30, 600, C["text"])
lines(AX + 24, 204, ["Every Stock Token pool"], 24, 400, C["mute"])
arrow(f"M{AX + AW + 2} 66 H{BX - 4}")

# B  Evidence engine
node(BX, 0, BW, 404)
uptick(BX + 24, 24, 48)
text(BX + 88, 58, "Evidence engine", 32, 600, C["text"])
y = 118
y = lines(BX + 24, y, ["Replays 30 days of swaps in every pool,", "3,059,881 swaps in all."]) + 10
y = lines(BX + 24, y, ["Picks the price range on the first 15 days", "and tests it on the last 15."]) + 10
y = lines(BX + 24, y, ["Assigns the door: open, reduced", "or closed."]) + 10
lines(BX + 24, y, ["Sizes each vault to at most 20% of the", "pool's in-range liquidity."])
arrow(f"M{BX + BW + 2} 66 H{CX - 4}")

# C  Vault factory, then the two vaults
node(CX, 0, CW, 150)
uptick(CX + 24, 24, 48)
text(CX + 88, 58, "Vault factory", 32, 600, C["text"])
lines(CX + 24, 112, ["Creates only the two reviewed", "vault builds."])
arrow(f"M{CX + CW // 2} 152 V{190 - 4}")
node(CX, 190, CW, 340)
mark("uniswap", CX + 24, 212, 48, 12)
text(CX + 88, 244, "StockVault", 30, 600, C["text"])
text(CX + CW - 24, 244, "Uniswap v3", 24, 400, C["mute"], "end")
mark("uniswap", CX + 24, 274, 48, 12)
text(CX + 88, 306, "StockVaultV4", 30, 600, C["text"])
text(CX + CW - 24, 306, "Uniswap v4", 24, 400, C["mute"], "end")
add(f'<line x1="{CX + 24}" y1="338" x2="{CX + CW - 24}" y2="338" stroke="{C["hair"]}" stroke-width="1.5"/>')
y = lines(CX + 24, 374, ["One position each, in a band", "around the Chainlink price,", "chosen per token."]) + 8
lines(CX + 24, y, ["Fees accrue to the share price.", "Exit in kind is always open."])

# D  Vault share, oracle, Morpho
node(DX, 0, DW, 100, hot=True)
uptick(DX + 24, 26, 48)
text(DX + 88, 56, "Vault share", 32, 600, C["text"])
text(DX + 88, 86, "An ERC-20 token", 24, 400, C["mute"])
arrow(f"M{CX + CW + 2} 232 H{CX + CW + GAP // 2} V50 H{DX - 4}", kept=True)
arrow(f"M{DX + DW // 2} 102 V{140 - 4}")
node(DX, 140, DW, 150)
text(DX + 24, 184, "UptickShareOracle", 28, 600, C["text"])
mark("chainlink", DX + DW - 24 - 44, 158, 44, 10)
lines(DX + 24, 228, ["Prices the share from", "Chainlink, not the pool."], 24, 400, C["soft"])
arrow(f"M{DX + DW // 2} 292 V{330 - 4}")
node(DX, 330, DW, 200)
mark("morpho", DX + 24, 350, 48)
text(DX + 88, 384, "Morpho market", 32, 600, C["text"])
lines(DX + 24, 438, ["Post the share, borrow", "USDG at 62.5%. The AAPL", "share market is live."])

# bottom: API and keeper, underneath
APIW = 560
node(0, 578, APIW, 194, dashed=True)
uptick(24, 600, 48)
text(88, 634, "Evidence API, ten MCP tools", 30, 600, C["text"])
lines(24, 690, ["The app and agents read the same", "evidence. The weekend hedge planner", "hands off to Lighter."])
mark("lighter", APIW - 24 - 44, 722, 44, 10)
arrow(f"M{BX + 120} 576 V{404 + 4}", dashed=True)

KX = APIW + GAP
node(KX, 578, W - KX, 194, dashed=True)
uptick(KX + 24, 600, 48)
text(KX + 88, 634, "Keeper", 30, 600, C["text"])
lines(KX + 24, 690, ["Recentres each vault once a day, in a window starting at 02:00 UTC after the NYSE session,",
                     "and again when the price leaves the band for 30 minutes. It simulates every rebalance",
                     "before sending it, and anyone can rebalance a vault after 26 hours."])
arrow(f"M{CX + CW // 2} 576 V{530 + 4}", dashed=True)

add("</g></svg>")
(IMG / "system.svg").write_text("\n".join(out), encoding="utf-8")
print("wrote", IMG / "system.svg", len("\n".join(out)), "bytes")
