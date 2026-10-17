"""Write the Uptick X kit SVG sources. Every number below comes from a file in this repo:

  sessions  spikes/stock-vaults/FINDINGS.md, "Why" table (fee per $1 of 1h markout, static ±2% vault)
  sessions  spikes/stock-vaults/scripts/strategies.py true_label(): NYSE 13:30-20:00 UTC, weekend Fri 20:00 to Mon 00:00 UTC
  hooks     docs/research/founder-house/OUTREACH-fomo-gmgn.md sections 4 and Evidence; README.md (0x: 80% of 84K)
  cap       spikes/capped-hooks/FINDINGS.md, Claim 2 and Claim 1
  app       web/screens/vault-nvda-1440.png (real capture of the running app)

Run: python3 build.py   (writes *.svg next to this file)
"""
import math
from pathlib import Path
from xml.sax.saxutils import escape

HERE = Path(__file__).parent

C = dict(  # web/DESIGN.md tokens
    canvas="#e8ebe6", card="#ffffff", ink="#0e0f0c", ink_deep="#163300", body="#454745", mute="#868685",
    lime="#9fe870", lime_pale="#e2f6d5", lime_neutral="#c5edab", neg="#d03238", rule="#cfd4cb",
    rule_dark="#33352f", mute_dark="#9a9c97",
)

STYLE = f"""<style>
@font-face {{ font-family: Archivo; src: url("../fonts/archivo.woff2") format("woff2"); font-weight: 100 900; font-stretch: 62% 125%; }}
@font-face {{ font-family: Figtree; src: url("../fonts/figtree.woff2") format("woff2"); font-weight: 300 900; }}
@font-face {{ font-family: "Geist Mono"; src: url("../fonts/geist-mono.woff2") format("woff2"); font-weight: 100 900; }}
.d {{ font-family: Archivo, sans-serif; font-weight: 900; font-stretch: 86%; letter-spacing: -0.03em; }}
.t {{ font-family: Figtree, sans-serif; }}
.m {{ font-family: "Geist Mono", monospace; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }}
</style>"""


def doc(w, h, body, bg):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
            f'width="{w}" height="{h}" viewBox="0 0 {w} {h}">\n{STYLE}\n'
            f'<rect width="{w}" height="{h}" fill="{bg}"/>\n{body}\n</svg>\n')


def t(x, y, s, size, cls="t", fill=C["ink"], anchor="start", weight=None, extra=""):
    w = f' font-weight="{weight}"' if weight else ""
    return (f'<text x="{x:.1f}" y="{y:.1f}" class="{cls}" font-size="{size}" fill="{fill}" '
            f'text-anchor="{anchor}"{w} {extra}>{escape(s)}</text>')


def mark(x, y, size, bg=True):
    k = size / 400
    back = f'<rect width="400" height="400" fill="{C["ink"]}"/>' if bg else ""
    return (f'<g transform="translate({x},{y}) scale({k:.5f})">{back}'
            f'<path d="M70 186 H200 V104 H330 V214 H200 V296 H70 Z" fill="{C["lime"]}" stroke="{C["lime"]}" stroke-width="24" stroke-linejoin="round"/>'
            f'<polyline points="20,268 84,256 124,272 170,234 206,244 244,178 274,188 302,152" fill="none" stroke="{C["ink"]}" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<circle cx="302" cy="152" r="19" fill="{C["lime"]}" stroke="{C["ink"]}" stroke-width="10"/></g>')


SESS = {  # fee per $1 lost, min and max across NVDA, SPCX, TSLA
    "reg": (0.78, 1.21), "night": (1.23, 3.02), "weekend": (3.83, 19.53),
}
POOLS = [  # (pool, fee tier, NYSE hours, weeknights, weekends)
    ("NVDA", "0.05% pool", 1.21, 1.23, 3.83),
    ("SPCX", "0.05% pool", 0.78, 3.02, 7.07),
    ("TSLA", "0.3% pool", 0.80, 2.07, 19.53),
]


def week_blocks():
    """(start_h, end_h, session) from Mon 00:00 UTC, matching strategies.true_label (EDT window)."""
    out, h = [], 0.0
    for d in range(5):
        o, c = 24 * d + 13.5, 24 * d + 20
        out.append((h, o, "night"))
        out.append((o, c, "reg"))
        h = c
        if d == 4:
            out.append((c, 168, "weekend"))
    return out


# ---------------------------------------------------------------- avatar
def avatar():
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">'
            f'{mark(0, 0, 400)}</svg>\n')


# ---------------------------------------------------------------- banner 1500x500
def banner():
    W, H = 1500, 500
    x0, x1, yt, yb = 708, 1436, 104, 396
    lo, hi = math.log10(0.6), math.log10(25)
    Y = lambda v: yb - (math.log10(v) - lo) / (hi - lo) * (yb - yt)
    X = lambda hr: x0 + hr / 168 * (x1 - x0)
    fill = {"reg": C["ink"], "night": C["lime_neutral"], "weekend": C["lime"]}
    b = []
    # left column, kept above y 330 so the avatar owns the lower-left
    b.append(f'<g data-within="56 36 640 330">')
    b.append(t(64, 92, "Uptick", 34, "d"))
    for i, line in enumerate(["Stock Token yield,", "chosen by the", "chain’s own data."]):
        b.append(t(62, 170 + i * 56, line, 58, "d"))
    b.append(t(64, 318, "Robinhood Chain · 5.1M swaps · 54 days", 17, "m", C["body"]))
    b.append("</g>")
    # chart
    b.append(f'<g data-within="660 36 1470 482">')
    b.append(t(x0, 66, "Fees LPs earn per $1 lost to informed traders, across a trading week", 18, "t", C["ink"], weight=600))
    for v, lab in [(20, "$20"), (5, "$5")]:
        b.append(f'<line x1="{x0}" x2="{x1}" y1="{Y(v):.1f}" y2="{Y(v):.1f}" stroke="{C["rule"]}" stroke-width="1"/>')
        b.append(t(x0 - 10, Y(v) + 5, lab, 14, "m", C["mute"], "end"))
    for s, e, k in week_blocks():
        lo_v, hi_v = SESS[k]
        b.append(f'<rect x="{X(s) + 1:.1f}" y="{Y(hi_v):.1f}" width="{X(e) - X(s) - 2:.1f}" height="{Y(lo_v) - Y(hi_v):.1f}" rx="3" fill="{fill[k]}"/>')
    b.append(f'<line x1="{x0}" x2="{x1}" y1="{Y(1):.1f}" y2="{Y(1):.1f}" stroke="{C["ink"]}" stroke-width="1.5" stroke-dasharray="5 4"/>')
    b.append(t(x0 - 10, Y(1) + 5, "$1", 14, "m", C["ink"], "end"))
    b.append(t(X(116) + 8, Y(1) + 5, "fees = losses", 13, "m", C["body"]))
    b.append(f'<line x1="{x0}" x2="{x1}" y1="{yb + 8}" y2="{yb + 8}" stroke="{C["ink"]}" stroke-width="1"/>')
    for d, name in enumerate(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]):
        b.append(f'<line x1="{X(24 * d):.1f}" x2="{X(24 * d):.1f}" y1="{yb + 8}" y2="{yb + 14}" stroke="{C["ink"]}" stroke-width="1"/>')
        b.append(t(X(24 * d + 12), yb + 32, name, 13, "m", C["body"], "middle"))
    # session labels
    mx = X(13.5) + (X(20) - X(13.5)) / 2
    b.append(f'<line x1="{mx:.1f}" x2="{mx:.1f}" y1="{Y(1.21) - 6:.1f}" y2="{214}" stroke="{C["ink"]}" stroke-width="1"/>')
    b.append(t(mx - 4, 156, "NYSE open", 16, "t", C["ink"], weight=600))
    b.append(t(mx - 6, 198, "$0.78 to $1.21", 38, "d"))
    b.append(t(X(116) - 14, 150, "Weekend", 16, "t", C["ink"], "end", weight=600))
    b.append(t(X(116) - 14, 192, "$3.83 to $19.53", 38, "d", anchor="end"))
    nx = X(68) + (X(85.5) - X(68)) / 2
    b.append(t(nx, Y(3.02) - 10, "weeknights $1.23 to $3.02", 13, "m", C["body"], "middle"))
    b.append(t(x1, 476, "range across NVDA, SPCX, TSLA pools · Aug 24 to Oct 17, 2026 · UTC", 12, "m", C["mute"], "end"))
    b.append("</g>")
    return doc(W, H, "\n".join(b), C["canvas"])


# ---------------------------------------------------------------- OG 1200x630
def og():
    W, H = 1200, 630
    b = [f'<g data-within="40 30 1160 600">']
    b.append(mark(64, 52, 56, bg=False))
    b.append(t(132, 92, "Uptick", 34, "d", C["canvas"]))
    b.append(t(1136, 90, "Robinhood Chain", 18, "m", C["mute_dark"], "end"))
    b.append(t(62, 214, "Stock Token yield, chosen", 80, "d", C["lime"]))
    b.append(t(62, 292, "by the chain’s own data.", 80, "d", C["lime"]))
    b.append(f'<line x1="64" x2="1136" y1="352" y2="352" stroke="{C["rule_dark"]}" stroke-width="1"/>')
    b.append(t(64, 398, "NYSE hours", 22, "t", C["mute_dark"], weight=600))
    b.append(t(62, 466, "$0.78 to $1.21", 60, "d", C["canvas"]))
    b.append(t(620, 398, "Weekends", 22, "t", C["mute_dark"], weight=600))
    b.append(t(618, 466, "$3.83 to $19.53", 60, "d", C["lime"]))
    b.append(t(64, 528, "Fees liquidity providers earn per $1 lost to informed traders.", 24, "t", C["canvas"]))
    b.append(t(64, 562, "5.1M swaps on the chain’s NVDA, SPCX and TSLA pools over 54 days.", 24, "t", C["mute_dark"]))
    b.append("</g>")
    return doc(W, H, "\n".join(b), C["ink"])


# ---------------------------------------------------------------- post 1: sessions 1600x900
def post_sessions():
    W, H = 1600, 900
    x0, x1 = 470, 1280
    lo, hi = math.log10(0.5), math.log10(25)
    X = lambda v: x0 + (math.log10(v) - lo) / (hi - lo) * (x1 - x0)
    b = [f'<g data-within="60 40 1560 870">']
    b.append(t(78, 118, "NYSE hours are the worst time", 64, "d"))
    b.append(t(78, 184, "to be a Stock Token LP", 64, "d"))
    b.append(t(80, 236, "Fees earned per $1 lost to informed traders (1 hour markout), static ±2% position, by session.", 22, "t", C["body"]))
    top, gap, lane = 330, 150, 38
    ax = top + 2 * gap + 2 * lane + 40
    for v in [0.5, 1, 2, 5, 10, 20]:
        lab = f"${v:g}" if v >= 1 else "$0.50"
        dash = 'stroke-dasharray="6 5"' if v == 1 else ""
        b.append(f'<line x1="{X(v):.1f}" x2="{X(v):.1f}" y1="{top - 44}" y2="{ax}" stroke="{C["rule"] if v != 1 else C["ink"]}" stroke-width="{1 if v != 1 else 2}" {dash}/>')
        b.append(t(X(v), ax + 28, lab, 16, "m", C["body"], "middle"))
    b.append(t(X(1) + 10, top - 50, "$1 earned per $1 lost", 15, "m", C["ink"]))
    b.append(t(X(1) - 10, top - 50, "LPs lose", 15, "m", C["neg"], "end"))
    style = {0: (C["ink"], C["ink"]), 1: (C["lime_neutral"], C["ink"]), 2: (C["lime"], C["ink"])}
    names = ["NYSE hours", "Weeknights", "Weekends"]
    b.append(t(1520, top - 50, "weekend vs NYSE", 15, "m", C["body"], "end"))
    for g, (pool, tier, *vals) in enumerate(POOLS):
        cy = top + g * gap + lane
        b.append(t(80, cy + 4, pool, 46, "d"))
        b.append(t(82, cy + 32, tier, 17, "t", C["body"]))
        for i, v in enumerate(vals):
            y = cy + (i - 1) * lane
            b.append(t(x0 - 34, y + 5, names[i], 16, "t", C["body"], "end"))
            b.append(f'<line x1="{X(1):.1f}" x2="{X(v):.1f}" y1="{y}" y2="{y}" stroke="{C["ink"]}" stroke-width="2"/>')
            f, s = style[i]
            b.append(f'<circle cx="{X(v):.1f}" cy="{y}" r="10" fill="{f}" stroke="{s}" stroke-width="2.5"/>')
            if v >= 1:
                b.append(t(X(v) + 20, y + 6, f"${v:.2f}", 18, "m", C["ink"]))
            else:
                b.append(t(X(v) - 20, y + 6, f"${v:.2f}", 18, "m", C["neg"], "end"))
        ratio = vals[2] / vals[0]
        b.append(t(1520, cy + 18, f"{ratio:.1f}×", 54, "d", anchor="end"))
    b.append(f'<line x1="80" x2="1520" y1="812" y2="812" stroke="{C["rule"]}" stroke-width="1"/>')
    b.append(t(80, 852, "Uptick", 30, "d"))
    b.append(t(1520, 850, "5.1M swaps replayed · Robinhood Chain 4663 · Aug 24 to Oct 17, 2026", 16, "m", C["body"], "end"))
    b.append("</g>")
    return doc(W, H, "\n".join(b), C["canvas"])


# ---------------------------------------------------------------- post 2: hook skim 1600x900
def post_hooks():
    W, H = 1600, 900
    b = [f'<g data-within="60 40 1560 870">']
    b.append(t(80, 104, "Uniswap v4 hooks on Robinhood Chain, Oct 14 to 16, 2026", 24, "t", C["mute_dark"], weight=600))
    b.append(t(82, 196, "about", 34, "t", C["canvas"], weight=600))
    b.append(t(70, 330, "$1.2M", 230, "d", C["canvas"]))
    b.append(t(80, 392, "left traders in 49 hours, through hooks that keep 5 to 11% of a swap", 32, "t", C["canvas"]))
    b.append(t(80, 434, "while the pool quotes a fee of 0 to 1%.", 32, "t", C["canvas"]))
    # range bars on one % axis
    x0, x1 = 470, 1500
    X = lambda p: x0 + p / 12 * (x1 - x0)
    y1, y2, ya = 520, 600, 650
    for p in range(0, 13, 2):
        b.append(f'<line x1="{X(p):.1f}" x2="{X(p):.1f}" y1="{y1 - 34}" y2="{ya - 12}" stroke="{C["rule_dark"]}" stroke-width="1"/>')
        b.append(t(X(p), ya + 12, f"{p}%", 16, "m", C["mute_dark"], "middle"))
    b.append(t(80, y1 + 8, "Fee the pool quotes", 24, "t", C["canvas"], weight=600))
    b.append(f'<rect x="{X(0):.1f}" y="{y1 - 16}" width="{X(1) - X(0):.1f}" height="32" rx="4" fill="{C["mute_dark"]}"/>')
    b.append(t(X(1) + 16, y1 + 8, "0 to 1%", 22, "m", C["canvas"]))
    b.append(t(80, y2 + 8, "Share the hook keeps", 24, "t", C["canvas"], weight=600))
    b.append(f'<rect x="{X(5):.1f}" y="{y2 - 16}" width="{X(11) - X(5):.1f}" height="32" rx="4" fill="{C["neg"]}"/>')
    b.append(t(X(5) - 16, y2 + 8, "5 to 11%", 22, "m", C["canvas"], "end"))
    b.append(f'<line x1="80" x2="1520" y1="712" y2="712" stroke="{C["rule_dark"]}" stroke-width="1"/>')
    b.append(t(78, 800, "80%", 84, "d", C["canvas"]))
    b.append(t(272, 772, "of 84,000 Uniswap v4 hooks", 24, "t", C["canvas"]))
    b.append(t(272, 804, "labelled malicious by 0x", 24, "t", C["mute_dark"]))
    b.append(t(1520, 772, "Uptick deposits only into pools without fee-taking", 24, "t", C["lime"], "end", weight=600))
    b.append(t(1520, 804, "hooks, or with a cap declared on chain.", 24, "t", C["lime"], "end", weight=600))
    b.append(t(80, 862, "3,183,184 swaps read across 19,775 pools · blocks 88,480,052 to 90,230,052 · chain 4663", 16, "m", C["mute_dark"]))
    b.append(t(1520, 862, "Uptick", 26, "d", C["canvas"], "end"))
    b.append("</g>")
    return doc(W, H, "\n".join(b), C["ink"])


# ---------------------------------------------------------------- post 3: cap 1600x900
def cap_panel(px, py, pw, ph, cap, settle):
    """One panel: take % axis 0..3.5, a ceiling at `cap`, a 3% hook's take rising into it."""
    b = [f'<rect x="{px}" y="{py}" width="{pw}" height="{ph}" rx="24" fill="{C["card"]}"/>']
    l, r, top, bot = px + 96, px + pw - 40, py + 110, py + ph - 70
    Y = lambda p: bot - p / 3.5 * (bot - top)
    for p in range(0, 4):
        b.append(f'<line x1="{l}" x2="{r}" y1="{Y(p):.1f}" y2="{Y(p):.1f}" stroke="{C["rule"]}" stroke-width="1"/>')
        b.append(t(l - 14, Y(p) + 5, f"{p}%", 15, "m", C["body"], "end"))
    cy = Y(cap)
    b.append(f'<rect x="{l}" y="{cy - 12:.1f}" width="{r - l}" height="12" fill="{C["ink"]}"/>')
    b.append(t(r, cy - 22, f"declared max {cap:.2f}%", 16, "m", C["ink"], "end"))
    sx, sy = l + 24, Y(0)
    if settle:
        hx = l + 250
        b.append(f'<path d="M{sx} {sy:.1f} C {sx + 120} {sy:.1f}, {hx - 90} {cy:.1f}, {hx} {cy:.1f} L {r - 30} {cy:.1f}" fill="none" stroke="{C["ink"]}" stroke-width="5" stroke-linecap="round"/>')
        b.append(f'<circle cx="{r - 30}" cy="{cy:.1f}" r="13" fill="{C["lime"]}" stroke="{C["ink"]}" stroke-width="4"/>')
        b.append(t(r - 30, cy + 44, "swap settles, 3.00% taken", 17, "m", C["ink"], "end"))
    else:
        hx = l + 230
        b.append(f'<path d="M{hx} {cy:.1f} L {hx + 34} {Y(3.0):.1f}" stroke="{C["mute"]}" stroke-width="3" stroke-dasharray="4 5" fill="none"/>')
        b.append(t(hx + 42, Y(3.0) - 2, "3% wanted", 15, "m", C["mute"]))
        b.append(f'<path d="M{sx} {sy:.1f} Q {hx - 70} {sy - 40:.1f}, {hx} {cy:.1f}" fill="none" stroke="{C["ink"]}" stroke-width="5" stroke-linecap="round"/>')
        lx = hx + 210
        b.append(f'<path d="M{hx} {cy:.1f} Q {hx + 80} {cy + 30:.1f}, {lx} {sy:.1f}" fill="none" stroke="{C["neg"]}" stroke-width="5" stroke-linecap="round" stroke-dasharray="1 0"/>')
        for dx, dy in [(-22, 16), (0, 22), (22, 16)]:
            b.append(f'<line x1="{hx + dx * 0.4:.1f}" y1="{cy + dy * 0.4:.1f}" x2="{hx + dx:.1f}" y2="{cy + dy:.1f}" stroke="{C["neg"]}" stroke-width="3" stroke-linecap="round"/>')
        b.append(f'<circle cx="{lx}" cy="{sy:.1f}" r="13" fill="{C["card"]}" stroke="{C["neg"]}" stroke-width="4"/>')
        b.append(t(lx + 24, sy - 34, "reverts: TakeExceedsCap", 17, "m", C["neg"]))
        b.append(t(lx + 24, sy - 12, "the trader keeps everything", 15, "m", C["body"]))
    return b


def post_cap():
    W, H = 1600, 900
    b = [f'<g data-within="60 40 1560 870">']
    b.append(t(78, 118, "Declare a maximum take.", 64, "d"))
    b.append(t(78, 184, "Any swap above it reverts.", 64, "d"))
    b.append(t(80, 236, "Uptick’s cap standard checks the hook’s take inside the swap. Same 3% hook, two declared caps, on a fork of Robinhood Chain:", 22, "t", C["body"]))
    pw, ph, py = 700, 470, 280
    b += cap_panel(80, py, pw, ph, 2.5, settle=False)
    b.append(t(120, py + 54, "200 of 200 revert", 40, "d"))
    b += cap_panel(820, py, pw, ph, 3.0, settle=True)
    b.append(t(860, py + 54, "200 of 200 settle", 40, "d"))
    b.append(t(80, 806, "At the edge, under a 3.00% cap: a 3.01% take reverts 60 of 60 times, 2.99% passes 60 of 60.", 22, "t", C["ink"]))
    b.append(t(80, 852, "CappedTakeHook + CapRegistry · Uniswap v4 PoolManager 0x8366…0951 · about 25k gas per swap", 16, "m", C["body"]))
    b.append(t(1520, 852, "Uptick", 30, "d", anchor="end"))
    b.append("</g>")
    return doc(W, H, "\n".join(b), C["canvas"])


# ---------------------------------------------------------------- post 4: app 1600x900
def post_app():
    W, H = 1600, 900
    cx, cy, cw, ch = 205, 955, 645, 800          # crop of web/screens/vault-nvda-1440.png (1440x2400)
    k = 770 / ch
    fw, fh = cw * k, ch * k
    fx, fy = 1520 - fw, (H - fh) / 2
    b = [f'<g data-within="60 40 {fx - 40:.0f} 870">']
    b.append(t(80, 112, "Uptick", 30, "d"))
    b.append(t(78, 258, "Deposit NVDA.", 72, "d"))
    b.append(t(78, 334, "The band follows", 72, "d"))
    b.append(t(78, 410, "the price.", 72, "d"))
    for i, line in enumerate([
        "The vault provides liquidity in the NVDA/USDG",
        "0.05% pool, inside a band 5% around the",
        "Chainlink price, re-centred at each NYSE open.",
        "Swap fees accrue while the pool price is inside.",
    ]):
        b.append(t(80, 480 + i * 36, line, 25, "t", C["ink_deep"]))
    b.append(t(78, 722, "$49,968.98", 56, "m", C["ink"], weight=500))
    b.append(t(80, 760, "in the NVDA vault, running on a Robinhood Chain mainnet fork", 19, "t", C["ink_deep"]))
    b.append(t(80, 852, "The NVDA vault page, captured from the running app", 15, "m", C["ink_deep"]))
    b.append("</g>")
    b.append(f'<defs><clipPath id="shot"><rect x="{fx:.1f}" y="{fy:.1f}" width="{fw:.1f}" height="{fh:.1f}" rx="16"/></clipPath></defs>')
    b.append(f'<g clip-path="url(#shot)"><svg x="{fx:.1f}" y="{fy:.1f}" width="{fw:.1f}" height="{fh:.1f}" viewBox="{cx} {cy} {cw} {ch}">'
             f'<image href="../../../web/screens/vault-nvda-1440.png" width="1440" height="2400"/></svg></g>')
    b.append(f'<rect x="{fx:.1f}" y="{fy:.1f}" width="{fw:.1f}" height="{fh:.1f}" rx="16" fill="none" stroke="{C["ink"]}" stroke-width="1.5" data-box="screenshot frame"/>')
    return doc(W, H, "\n".join(b), C["lime"])


OUT = {
    "avatar.svg": avatar(), "banner.svg": banner(), "og.svg": og(),
    "post-1-sessions.svg": post_sessions(), "post-2-hooks.svg": post_hooks(),
    "post-3-cap.svg": post_cap(), "post-4-app.svg": post_app(),
}
for name, svg in OUT.items():
    (HERE / name).write_text(svg)
    print("wrote", name)
