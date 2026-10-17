"""Write the Uptick X kit SVG sources. Every number below comes from a file in /Users/kamal/Desktop/arbitrium:

  sessions  spikes/stock-vaults/FINDINGS.md, "Why" table (fee per $1 of 1h markout, static ±2% position)
  sessions  spikes/stock-vaults/scripts/strategies.py true_label(): NYSE 13:30-20:00 UTC, weekend Fri 20:00 to Mon 00:00 UTC
  hooks     docs/research/founder-house/OUTREACH-fomo-gmgn.md section 4 and Evidence
  cap       spikes/capped-hooks/evidence/claim2-enforce.txt; revert arguments from
            `forge test --mt test_cap250_reverts_on_every_swap -vvvv` (src/evidence/cap250-trace-summary.txt)
  app       src/app-band-card.png, captured from the running app by capture_app.py

Run: python3 build.py   (writes *.svg next to this file), then render.py per file.
Type floor for phone reading (a 1600px post shows at about 0.19x): claim text >= 36px, labels >= 24px, sources >= 20px.
"""
import math
from pathlib import Path
from xml.sax.saxutils import escape

HERE = Path(__file__).parent

C = dict(  # web/DESIGN.md tokens
    canvas="#e8ebe6", card="#ffffff", ink="#0e0f0c", ink_deep="#163300", body="#454745", mute="#868685",
    lime="#9fe870", neg="#d03238", positive="#2ead4b", rule="#cfd4cb", rule_dark="#33352f", mute_dark="#9a9c97",
)

STYLE = f"""<style>
@font-face {{ font-family: Archivo; src: url("../fonts/archivo.woff2") format("woff2"); font-weight: 100 900; font-stretch: 62% 125%; }}
@font-face {{ font-family: Figtree; src: url("../fonts/figtree.woff2") format("woff2"); font-weight: 300 900; }}
@font-face {{ font-family: "Geist Mono"; src: url("../fonts/geist-mono.woff2") format("woff2"); font-weight: 100 900; }}
.d {{ font-family: Archivo, sans-serif; font-weight: 900; font-stretch: 86%; letter-spacing: -0.03em; }}
.t {{ font-family: Figtree, sans-serif; }}
.m {{ font-family: "Geist Mono", monospace; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }}
</style>"""

DASH = ' stroke-dasharray="6 5"'
HEAD_STEP = 58  # 64px display lines, DESIGN.md display-xl line height 0.9


def doc(w, h, body, bg):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
            f'width="{w}" height="{h}" viewBox="0 0 {w} {h}">\n{STYLE}\n'
            f'<rect width="{w}" height="{h}" fill="{bg}"/>\n{body}\n</svg>\n')


def t(x, y, s, size, cls="t", fill=C["ink"], anchor="start", weight=None, extra=""):
    w = f' font-weight="{weight}"' if weight else ""
    return (f'<text x="{x:.1f}" y="{y:.1f}" class="{cls}" font-size="{size}" fill="{fill}" '
            f'text-anchor="{anchor}"{w} {extra}>{escape(s)}</text>')


def wordmark(fill=C["ink"]):
    """Same place on every 1600x900 post: bottom-right, 30px, baseline 852."""
    return t(1520, 852, "Uptick", 30, "d", fill, "end")


def mark(x, y, size, bg=True):
    """The step: the stepped band from the vault chart. Outer corners sit about 10px inside X's circle crop at 400."""
    k = size / 400
    back = f'<rect width="400" height="400" fill="{C["ink"]}"/>' if bg else ""
    return (f'<g transform="translate({x},{y}) scale({k:.5f})">{back}'
            f'<path d="M68 180 H200 V80 H332 V220 H200 V320 H68 Z" fill="{C["lime"]}" stroke="{C["lime"]}" '
            f'stroke-width="24" stroke-linejoin="round"/></g>')


POOLS = [  # (pool, fee tier, NYSE hours, weeknights, weekends)
    ("NVDA", "0.05% pool", 1.29, 1.30, 3.94),
    ("SPCX", "0.05% pool", 1.03, 3.90, 7.78),
    ("TSLA", "0.3% pool", 1.35, 3.70, 33.27),
]
SESS = {k: (min(p[i] for p in POOLS), max(p[i] for p in POOLS)) for i, k in [(2, "reg"), (3, "night"), (4, "weekend")]}


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
    """Desktop profile: the avatar covers x 35..401 from y 311 down (1500x500 terms), so the left column ends by y 280."""
    W, H = 1500, 500
    x0, x1, yt, yb = 708, 1436, 40, 396
    lo, hi = math.log10(0.6), math.log10(40)
    Y = lambda v: yb - (math.log10(v) - lo) / (hi - lo) * (yb - yt)
    X = lambda hr: x0 + hr / 168 * (x1 - x0)
    fill = {"reg": C["ink"], "night": C["card"], "weekend": C["lime"]}
    b = ['<g data-within="56 30 660 280">']
    for i, line in enumerate(["Stock Token yield,", "chosen by", "the chain’s own data."]):
        b.append(t(62, 104 + i * 58, line, 60, "d"))  # 0.97: "yield," and "by" descend into the next line
    b.append(t(64, 264, "5.1M swaps · 54 days · Robinhood Chain", 22, "m", C["body"]))
    b.append("</g>")
    b.append('<g data-within="680 30 1470 482">')
    for s, e, k in week_blocks():
        lo_v, hi_v = SESS[k]
        stroke = f' stroke="{C["ink"]}" stroke-width="1.5"' if k == "night" else ""
        b.append(f'<rect x="{X(s) + 1:.1f}" y="{Y(hi_v):.1f}" width="{X(e) - X(s) - 2:.1f}" height="{Y(lo_v) - Y(hi_v):.1f}" rx="3" fill="{fill[k]}"{stroke}/>')
    b.append(f'<line x1="{x0}" x2="{x1}" y1="{Y(1):.1f}" y2="{Y(1):.1f}" stroke="{C["ink"]}" stroke-width="2" stroke-dasharray="6 5"/>')
    b.append(t(x1, Y(1) - 12, "$1 = break-even", 22, "m", C["ink"], "end"))
    b.append(f'<line x1="{x0}" x2="{x1}" y1="{yb + 8}" y2="{yb + 8}" stroke="{C["ink"]}" stroke-width="1.5"/>')
    for d, name in enumerate(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]):
        b.append(f'<line x1="{X(24 * d):.1f}" x2="{X(24 * d):.1f}" y1="{yb + 8}" y2="{yb + 16}" stroke="{C["ink"]}" stroke-width="1.5"/>')
        b.append(t(X(24 * d + 12), yb + 40, name, 20, "m", C["body"], "middle"))
    # NYSE hours callout over Tuesday, leader to Tuesday's NYSE block
    mx = X(24 + 16.75)
    b.append(f'<line x1="{mx:.1f}" x2="{mx:.1f}" y1="{Y(1.35) - 4:.1f}" y2="{Y(3.90) - 34:.1f}" stroke="{C["ink"]}" stroke-width="1.5"/>')
    b.append(t(mx - 4, 116, "NYSE hours", 26, "t", C["ink"], weight=600))
    b.append(t(mx - 6, 160, "$1.03 to $1.35", 38, "d"))
    # weekend figure inside the lime block
    wx = X(116) + 14
    b.append(t(wx, Y(33.27) + 36, "Weekends", 26, "t", C["ink"], weight=600))
    b.append(t(wx - 2, Y(33.27) + 82, "$3.94 to", 42, "d"))
    b.append(t(wx - 2, Y(33.27) + 126, "$33.27", 42, "d"))
    return doc(W, H, "\n".join(b) + "\n</g>", C["canvas"])


# ---------------------------------------------------------------- OG 1200x630 (link previews only)
def og():
    """X puts the domain label bottom-left on link cards, so x < 260, y > 530 stays empty."""
    W, H = 1200, 630
    b = ['<g data-within="40 30 1160 600">']
    b.append(mark(64, 50, 56, bg=False))
    b.append(t(132, 90, "Uptick", 34, "d", C["canvas"]))
    b.append(t(62, 206, "Stock Token yield,", 74, "d", C["canvas"]))
    b.append(t(62, 277, "chosen by the chain’s own data.", 74, "d", C["canvas"]))
    b.append(f'<line x1="64" x2="1136" y1="318" y2="318" stroke="{C["rule_dark"]}" stroke-width="1.5"/>')
    for x, label, fig, col in [(64, "NYSE hours", "$1.03 to $1.35", C["canvas"]), (620, "Weekends", "$3.94 to $33.27", C["lime"])]:
        b.append(t(x, 374, label, 30, "t", C["canvas"], weight=600))
        b.append(t(x - 2, 442, fig, 60, "d", col))
        b.append(t(x, 484, "fees per $1 lost to informed traders", 28, "t", C["mute_dark"]))
    b.append(t(1136, 572, "5.1M swaps replayed · NVDA, SPCX, TSLA · 54 days", 22, "m", C["mute_dark"], "end"))
    b.append("</g>")
    return doc(W, H, "\n".join(b), C["ink"])


# ---------------------------------------------------------------- post 1: sessions 1600x900
def dot(x, y, session, r=11):
    f = {0: C["ink"], 1: C["card"], 2: C["lime"]}[session]
    return f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="{f}" stroke="{C["ink"]}" stroke-width="2.5"/>'


def post_sessions():
    W, H = 1600, 900
    x0, x1 = 470, 1180
    lo, hi = math.log10(0.5), math.log10(40)
    X = lambda v: x0 + (math.log10(v) - lo) / (hi - lo) * (x1 - x0)
    b = ['<g data-within="60 40 1560 870">']
    b.append(t(78, 112, "Weekends pay LPs most", 64, "d"))
    b.append(t(78, 112 + HEAD_STEP + 8, "per dollar lost", 64, "d"))
    b.append(t(80, 222, "Fees per $1 lost to informed traders (1h markout), static ±2% position.", 30, "t", C["body"]))
    lx = 92
    for i, name in enumerate(["NYSE hours", "Weeknights", "Weekends"]):
        b.append(dot(lx, 268, i))
        b.append(t(lx + 22, 278, name, 28, "t", C["ink"], weight=600))
        lx += 210
    top, gap, lane = 390, 136, 36
    ax = top + 2 * gap + 2 * lane + 34
    for v in [0.5, 1, 2, 5, 10, 20]:
        lab = f"${v:g}" if v >= 1 else "$0.50"
        one = v == 1
        b.append(f'<line x1="{X(v):.1f}" x2="{X(v):.1f}" y1="{top - 40}" y2="{ax}" stroke="{C["ink"] if one else C["rule"]}" '
                 f'stroke-width="{2 if one else 1}"{DASH if one else ""}/>')
        b.append(t(X(v), ax + 28, lab, 20, "m", C["body"], "middle"))
    b.append(t(X(1) + 12, top - 50, "$1 earned per $1 lost", 24, "m", C["ink"]))
    b.append(t(X(1) - 12, top - 50, "LPs lose", 24, "m", C["neg"], "end"))
    b.append(t(1520, top - 50, "weekend vs NYSE", 28, "t", C["body"], "end", weight=600))
    for g, (pool, tier, *vals) in enumerate(POOLS):
        cy = top + g * gap + lane
        b.append(t(80, cy + 6, pool, 46, "d"))
        b.append(t(82, cy + 40, tier, 24, "t", C["body"]))
        for i, v in enumerate(vals):
            y = cy + (i - 1) * lane
            b.append(f'<line x1="{X(1):.1f}" x2="{X(v):.1f}" y1="{y}" y2="{y}" stroke="{C["ink"]}" stroke-width="2"/>')
            b.append(dot(X(v), y, i))
            if i == 1:
                continue
            if v >= 1:
                b.append(t(X(v) + 22, y + 10, f"${v:.2f}", 28, "m", C["ink"]))
            else:
                b.append(t(X(v) - 22, y + 10, f"${v:.2f}", 28, "m", C["neg"], "end"))
        b.append(t(1520, cy + 20, f"{vals[2] / vals[0]:.1f}×", 54, "d", anchor="end"))
    b.append(f'<line x1="80" x2="1520" y1="808" y2="808" stroke="{C["rule"]}" stroke-width="1"/>')
    b.append(t(80, 850, "5.1M swaps replayed · Robinhood Chain · Aug 24 to Oct 17, 2026", 20, "m", C["body"]))
    b.append(wordmark())
    b.append("</g>")
    return doc(W, H, "\n".join(b), C["canvas"])


# ---------------------------------------------------------------- post 2: hook take 1600x900
def post_hooks():
    W, H = 1600, 900
    b = ['<g data-within="60 40 1560 870">']
    b.append(t(80, 100, "Uniswap v4 hooks on Robinhood Chain, Oct 14 to 16, 2026", 30, "t", C["mute_dark"], weight=600))
    b.append(t(70, 318, "~$1.2M", 230, "d", C["canvas"]))
    b.append(t(80, 390, "left traders in 49 hours through hooks on pools quoting 0 to 1%.", 40, "t", C["canvas"]))
    b.append(t(80, 442, "Single swaps lost 5 to 11%.", 40, "t", C["canvas"]))
    x0, x1 = 560, 1500
    X = lambda p: x0 + p / 12 * (x1 - x0)
    y1, y2, ya = 560, 680, 760
    for p in range(0, 13, 2):
        b.append(f'<line x1="{X(p):.1f}" x2="{X(p):.1f}" y1="{y1 - 52}" y2="{ya - 28}" stroke="{C["rule_dark"]}" stroke-width="1"/>')
        b.append(t(X(p), ya, f"{p}%", 20, "m", C["mute_dark"], "middle"))
    b.append(t(80, y1 + 12, "Fee the pool quotes", 36, "t", C["canvas"], weight=600))
    b.append(f'<rect x="{X(0):.1f}" y="{y1 - 32}" width="{X(1) - X(0):.1f}" height="64" rx="6" fill="{C["mute_dark"]}"/>')
    b.append(t(X(1) + 20, y1 + 12, "0 to 1%", 36, "m", C["canvas"]))
    b.append(t(80, y2 + 12, "Hook take, one swap", 36, "t", C["canvas"], weight=600))
    b.append(f'<rect x="{X(5):.1f}" y="{y2 - 32}" width="{X(11) - X(5):.1f}" height="64" rx="6" fill="{C["neg"]}"/>')
    b.append(t(X(5) - 20, y2 + 12, "5 to 11%", 36, "m", C["canvas"], "end"))
    b.append(f'<line x1="80" x2="1520" y1="808" y2="808" stroke="{C["rule_dark"]}" stroke-width="1"/>')
    b.append(t(80, 850, "3,183,184 swaps read across 19,775 pools · blocks 88,480,052 to 90,230,052", 20, "m", C["mute_dark"]))
    b.append(wordmark(C["canvas"]))
    b.append("</g>")
    return doc(W, H, "\n".join(b), C["ink"])


# ---------------------------------------------------------------- post 3: cap 1600x900
def cap_card(px, py, pw, ph, cap_bps, take_bps, title, outcome):
    """Literal outcome of the fork test: one take, one cap, the result. A take-vs-cap bar underneath."""
    reverts = take_bps > cap_bps
    b = [f'<g data-within="{px} {py} {px + pw} {py + ph}">',
         f'<rect x="{px}" y="{py}" width="{pw}" height="{ph}" rx="24" fill="{C["card"]}"/>',
         t(px + 40, py + 72, title, 44, "d")]
    rows = [("take", f"{take_bps} bps"), ("cap", f"{cap_bps} bps")]
    for i, (k, v) in enumerate(rows):
        y = py + 148 + i * 52
        b.append(t(px + 42, y, k, 36, "m", C["body"]))
        b.append(t(px + 170, y, v, 36, "m", C["ink"]))
    y = py + 148 + 2 * 52 + 12
    if reverts:
        b.append(t(px + 42, y, "revert", 36, "m", C["neg"]))
        b.append(t(px + 42, y + 50, outcome, 36, "m", C["neg"]))
    else:
        b.append(f'<circle cx="{px + 56}" cy="{y - 12}" r="13" fill="{C["positive"]}"/>')
        b.append(t(px + 84, y, outcome, 36, "m", C["ink"]))
    # bar: 0..350 bps
    l, r, by = px + 42, px + pw - 42, py + ph - 92
    X = lambda bps: l + bps / 350 * (r - l)
    b.append(f'<rect x="{l}" y="{by}" width="{r - l}" height="28" rx="4" fill="{C["canvas"]}"/>')
    b.append(f'<rect x="{l}" y="{by}" width="{X(take_bps) - l:.1f}" height="28" rx="4" fill="{C["neg"] if reverts else C["ink"]}"/>')
    b.append(f'<rect x="{X(cap_bps) - 2.5:.1f}" y="{by - 14}" width="5" height="56" fill="{C["ink"]}"/>')
    for bps in (0, 100, 200, 300):
        b.append(t(X(bps), by + 66, f"{bps // 100}%", 20, "m", C["body"], "middle"))
    b.append("</g>")
    return b


def post_cap():
    W, H = 1600, 900
    b = ['<g data-within="60 40 1560 870">']
    b.append(t(78, 112, "Declare a maximum take.", 64, "d"))
    b.append(t(78, 112 + HEAD_STEP, "Any swap above it reverts.", 64, "d"))
    b.append(t(80, 226, "CappedTakeHook measures each hook’s take inside the swap. One 3% hook, two caps,", 30, "t", C["body"]))
    b.append(t(80, 264, "200 swaps each, on a Robinhood Chain mainnet fork.", 30, "t", C["body"]))
    pw, ph, py = 700, 480, 306
    b += cap_card(80, py, pw, ph, 250, 300, "Cap 2.50%: 200 of 200 revert", "TakeExceedsCap(300, 250)")
    b += cap_card(820, py, pw, ph, 300, 300, "Cap 3.00%: 200 of 200 settle", "settled")
    b.append(t(80, 850, "Claim2Enforce.t.sol · Uniswap v4 PoolManager 0x8366…0951", 20, "m", C["body"]))
    b.append(wordmark())
    b.append("</g>")
    return doc(W, H, "\n".join(b), C["canvas"])


# ---------------------------------------------------------------- post 4: app 1600x900
def post_app():
    W, H = 1600, 900
    iw, ih = 1217, 1029                    # src/app-band-card.png, the band card at 1.8x
    k = 770 / ih                           # figures render at 18 * 1.8 * k = 24.2px
    fw, fh = iw * k, ih * k
    fx, fy = 1520 - fw, 46
    b = [f'<g data-within="60 40 {fx - 24:.0f} 870">']
    b.append(t(78, 150, "Deposit NVDA.", 64, "d", C["canvas"]))
    b.append(t(78, 150 + 62, "The band follows", 64, "d", C["canvas"]))  # "Deposit" descends
    b.append(t(78, 150 + 62 + HEAD_STEP, "the price.", 64, "d", C["canvas"]))
    b.append(t(80, 728, "NVDA vault, Robinhood Chain", 28, "t", C["canvas"], weight=600))
    b.append(t(80, 764, "mainnet fork", 28, "t", C["canvas"], weight=600))
    b.append(t(80, 806, "captured from the running app", 20, "m", C["mute_dark"]))
    b.append("</g>")
    b.append(f'<defs><clipPath id="shot"><rect x="{fx:.1f}" y="{fy:.1f}" width="{fw:.1f}" height="{fh:.1f}" rx="30"/></clipPath></defs>')
    b.append(f'<image href="app-band-card.png" x="{fx:.1f}" y="{fy:.1f}" width="{fw:.1f}" height="{fh:.1f}" clip-path="url(#shot)" data-box="screenshot"/>')
    b.append(wordmark(C["canvas"]))
    return doc(W, H, "\n".join(b), C["ink"])


OUT = {
    "avatar.svg": avatar(), "banner.svg": banner(), "og.svg": og(),
    "post-1-sessions.svg": post_sessions(), "post-2-hooks.svg": post_hooks(),
    "post-3-cap.svg": post_cap(), "post-4-app.svg": post_app(),
}
if __name__ == "__main__":
    for name, svg in OUT.items():
        (HERE / name).write_text(svg)
        print("wrote", name)
