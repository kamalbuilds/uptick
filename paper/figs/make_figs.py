# Builds the two paper figures from the re-derived logs in docs/paper/rederive/ (no numbers typed by hand).
# Run: uv run --with matplotlib python3 docs/paper/figs/make_figs.py   (from /Users/kamal/Desktop/arbitrium)
import os, re
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

HERE = os.path.dirname(os.path.abspath(__file__))
RD = os.path.join(HERE, "..", "rederive")
NM = os.path.join(HERE, "..", "..", "research", "founder-house", "nightmarket", "raw")
BLUE, ORANGE, AQUA, GRAY, INK, MUTED = "#2a78d6", "#eb6834", "#1baf7a", "#52514e", "#0b0b0b", "#8a8984"
plt.rcParams.update({"font.family": "serif", "font.size": 9, "axes.edgecolor": MUTED, "axes.labelcolor": INK,
                     "xtick.color": INK, "ytick.color": INK, "axes.spines.top": False, "axes.spines.right": False})


LG = os.path.join(HERE, "..", "revision", "logs")


def session_ratios():
    """Fee per $ of 1h markout with 90% intervals: v3 week-block bootstrap (path accounting), v4 day-block bootstrap."""
    out, pool = {}, None
    sess = {"NYSE": "REG", "weeknight": "NIGHT", "weekend": "WEEKEND"}
    for line in open(os.path.join(LG, "sessions_path.txt")):
        m = re.match(r"== (\w+) B2 horizon 1h", line)
        if m: pool = m.group(1); continue
        if line.startswith("== POOLED B2 horizon 1h"): pool = "POOLED"; continue
        if line.startswith("== "): pool = None; continue
        if pool and pool != "POOLED":
            m = re.match(r"\s+(NYSE|weeknight|weekend)\s+vol .*F/M\s+([\d.]+) week90 \[([\d.]+), ([\d.]+|nan)\]", line)
            if m: out.setdefault(pool, {})[sess[m.group(1)]] = (float(m.group(2)), float(m.group(3)), float("inf") if m.group(4) == "nan" else float(m.group(4)))
        if pool == "POOLED":
            m = re.match(r"\s+dollar-weighted NYSE ([\d.]+) \[([\d.]+), ([\d.]+)\] \| weeknight ([\d.]+) \[([\d.]+), ([\d.]+)\] \| weekend ([\d.]+) \[([\d.]+), ([\d.]+)\]", line)
            if m:
                g = [float(x) for x in m.groups()]
                out["POOLED"] = {"REG": tuple(g[0:3]), "NIGHT": tuple(g[3:6]), "WEEKEND": tuple(g[6:9])}
    v4, on = {}, False
    for line in open(os.path.join(LG, "v4_sessions.txt")):
        if line.startswith("all pools, dollar-weighted"): on = True; continue
        if line.startswith("all pools, fixed"): on = False
        m = re.match(r"  1h\s+NYSE ([\d.]+) \[([\d.]+), ([\d.]+)\] \| weekday-off ([\d.]+) \[([\d.]+), ([\d.]+)\] \| weekend ([\d.]+) \[([\d.]+), ([\d.]+)\]", line)
        if m and on:
            g = [float(x) for x in m.groups()]
            v4 = {"REG": tuple(g[0:3]), "NIGHT": tuple(g[3:6]), "WEEKEND": tuple(g[6:9])}
    out["V4"] = v4
    assert all(len(out[k]) == 3 for k in ["NVDA", "SPCX", "TSLA3", "POOLED", "V4"]), out
    return out


def fig_sessions():
    r = session_ratios()
    sess = ["REG", "NIGHT", "WEEKEND"]; lab = ["NYSE hours", "Weeknight", "Weekend"]
    series = [("NVDA", "NVDA 0.05%", BLUE), ("SPCX", "SPCX 0.05%", ORANGE), ("TSLA3", "TSLA 0.30%", AQUA), ("POOLED", "Pooled, 3 v3 pools", GRAY)]
    fig, ax = plt.subplots(figsize=(6.2, 3.6), dpi=300)
    w = 0.16; top = 80
    for j, (k, name, c) in enumerate(series):
        xs = [i + (j - 2) * (w + 0.015) for i in range(3)]
        ys = [r[k][s][0] for s in sess]
        lo = [r[k][s][0] - r[k][s][1] for s in sess]; hi = [min(r[k][s][2], top) - r[k][s][0] for s in sess]
        ax.bar(xs, ys, width=w, color=c, label=name, zorder=2)
        ax.errorbar(xs, ys, yerr=[lo, hi], fmt="none", ecolor=INK, elinewidth=0.8, capsize=1.5, zorder=4)
        if k == "POOLED":
            for x, y, s in zip(xs, ys, sess): ax.text(x + 0.012, y * 1.12, f"{y:.2f}", ha="left", va="bottom", fontsize=6.5, color=INK)
    xs = [i + 2 * (w + 0.015) + 0.115 for i in range(3)]
    ys = [r["V4"][s][0] for s in sess]
    ax.errorbar(xs, ys, yerr=[[r["V4"][s][0] - r["V4"][s][1] for s in sess], [r["V4"][s][2] - r["V4"][s][0] for s in sess]], fmt="D", ms=5, mfc="white", mec=INK, mew=1.2,
                ecolor=INK, elinewidth=0.8, capsize=1.5, label="15 v4 pools, pool fee / 1h adverse", zorder=5)
    ax.axhline(1.0, color=INK, lw=0.8, ls=(0, (3, 2)), zorder=1, label="Break-even, fee = markout")
    ax.set_yscale("log"); ax.set_ylim(0.5, top)
    ax.set_yticks([0.5, 1, 2, 5, 10, 20, 50]); ax.set_yticklabels(["0.5", "1", "2", "5", "10", "20", "50"])
    ax.set_xticks(range(3)); ax.set_xticklabels(lab)
    ax.set_ylabel("LP fee per \\$1 of 1h markout (log)")
    ax.grid(axis="y", color="#e6e5e0", lw=0.6, zorder=0)
    ax.legend(frameon=False, fontsize=6.5, ncol=3, loc="upper center", bbox_to_anchor=(0.5, -0.1))
    fig.tight_layout(); fig.savefig(os.path.join(HERE, "fig_sessions.png")); plt.close(fig)
    return r


def monday_series():
    prof = []
    for line in open(os.path.join(RD, "monday_profile_rerun.txt")):
        m = re.match(r"\s*(\d+) (\w{3} \d\d:\d\d)\s+(\d+)\s+\S+\s+\S+\s+[\d.]+\s+[\d.]+\s+(-?[\d.]+)", line)
        if m: prof.append((int(m.group(1)), m.group(2), float(m.group(4))))
    cv, on = {}, False
    for line in open(os.path.join(LG, "monday_boot.txt")):
        if line.startswith("### plain"): on = True; continue
        if line.startswith("### holiday"): on = False
        m = re.match(r"\s+open-\s*([\d.]+)h .* n 168: MAE red\s+(-?[\d.]+)% 90% \[\s*(-?[\d.]+),\s*(-?[\d.]+)\]", line)
        if m and on and float(m.group(1)) in (0.5, 5.5, 13.5, 21.5, 45.5, 17.5, 29.5, 37.5):
            cv[65.5 - float(m.group(1))] = (float(m.group(2)), float(m.group(3)), float(m.group(4)))
    ctl = {}
    for line in open(os.path.join(RD, "monday_shuffle_control.txt")):
        m = re.match(r"(Sun16|Mon13): real ([\d.]+)%.*mean (-?[\d.]+)% median (-?[\d.]+)% max (-?[\d.]+)%", line)
        if m: ctl[{"Sun16": 44, "Mon13": 65}[m.group(1)]] = (float(m.group(3)), float(m.group(5)))
    assert len(prof) == 21 and len(cv) == 8 and len(ctl) == 2, (len(prof), cv, ctl)
    return prof, cv, ctl


def fig_monday():
    prof, cv, ctl = monday_series()
    fig, ax = plt.subplots(figsize=(6.2, 3.2), dpi=300)
    ax.axvspan(52, 60, color="#eef3fb", zorder=0); ax.axvspan(60, 65.5, color="#dbe7f8", zorder=0)
    ax.text(56, 98, "overnight\nsession", ha="center", va="top", fontsize=7, color=GRAY)
    ax.text(62.75, 98, "pre-\nmarket", ha="center", va="top", fontsize=7, color=GRAY)
    ax.plot([p[0] for p in prof], [p[2] for p in prof], color=BLUE, lw=1.4, marker="o", ms=2.5, label="In sample, single beta", zorder=3)
    xs = sorted(cv)
    ax.errorbar(xs, [cv[x][0] for x in xs], yerr=[[cv[x][0] - cv[x][1] for x in xs], [cv[x][2] - cv[x][0] for x in xs]], fmt="s", ms=5, mfc=ORANGE, mec="white", mew=0.8,
                ecolor=ORANGE, elinewidth=1.0, capsize=2, label="Leave one weekend out, weekend-block 90% interval (n = 168)", zorder=4)
    for h, (mean, mx) in ctl.items():
        ax.plot([h + 0.6, h + 0.6], [mean, mx], color=GRAY, lw=1.6, zorder=3); ax.plot(h + 0.6, mean, marker="_", ms=8, color=GRAY, zorder=3)
    ax.plot([], [], color=GRAY, lw=1.6, label="Mismatched weekends, mean to max of 23")
    ax.axhline(0, color=INK, lw=0.7)
    for h in (44.0, 65.0):
        ax.annotate(f"{cv[h][0]:.1f}%", (h, cv[h][0]), textcoords="offset points", xytext=(-17, -3), ha="center", fontsize=7, color=INK)
    tk = [(0, "Fri\n20:00"), (12, "Sat\n08:00"), (24, "Sat\n20:00"), (36, "Sun\n08:00"), (44, "Sun\n16:00"), (52, "Mon\n00:00"), (60, "Mon\n08:00"), (65, "Mon\n13:00")]
    ax.set_xticks([t for t, _ in tk]); ax.set_xticklabels([l for _, l in tk], fontsize=7)
    ax.set_xlim(-1, 66.5); ax.set_ylim(-25, 100)
    ax.set_xlabel("Perp read time (UTC), hours after the Friday close")
    ax.set_ylabel("Cut in Monday-open error vs\nstale Friday close (%)")
    ax.grid(axis="y", color="#e6e5e0", lw=0.6, zorder=0)
    ax.legend(frameon=False, fontsize=6.5, loc="upper left", bbox_to_anchor=(0.0, 0.88))
    fig.tight_layout(); fig.savefig(os.path.join(HERE, "fig_monday.png")); plt.close(fig)
    return prof, cv, ctl


if __name__ == "__main__":
    r = fig_sessions(); print("sessions", r)
    print("monday", fig_monday())
