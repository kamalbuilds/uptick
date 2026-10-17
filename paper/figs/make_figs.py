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


def session_ratios():
    out, pool = {}, None
    for line in open(os.path.join(RD, "session_split_rerun.txt")):
        m = re.match(r"== (\w+)", line)
        if m: pool = m.group(1); continue
        m = re.match(r"\s+B2 (REG|NIGHT|WEEKEND)\s.*fee/markout ([\d.]+)", line)
        if m: out.setdefault(pool, {})[m.group(1)] = float(m.group(2))
    for line in open(os.path.join(RD, "pooled_sessions.txt")):
        m = re.match(r"B2 (REG|NIGHT|WEEKEND)\s+pooled .*fee/markout ([\d.]+)", line)
        if m: out.setdefault("POOLED", {})[m.group(1)] = float(m.group(2))
    v4 = {}
    for line in open(os.path.join(RD, "markouts_rerun.txt")):
        m = re.match(r"ALL\s+(regular|weekday-off|weekend)\s.*fee=\$\s*([\d.]+)K.*adv3600s=\$\s*([\d.]+)K", line)
        if m: v4[{"regular": "REG", "weekday-off": "NIGHT", "weekend": "WEEKEND"}[m.group(1)]] = float(m.group(2)) / float(m.group(3))
    out["V4"] = v4
    assert all(len(out[k]) == 3 for k in ["NVDA", "SPCX", "TSLA3", "POOLED", "V4"]), out
    return out


def fig_sessions():
    r = session_ratios()
    sess = ["REG", "NIGHT", "WEEKEND"]; lab = ["NYSE hours", "Weeknight", "Weekend"]
    series = [("NVDA", "NVDA 0.05%", BLUE), ("SPCX", "SPCX 0.05%", ORANGE), ("TSLA3", "TSLA 0.30%", AQUA), ("POOLED", "Pooled, 3 v3 pools", GRAY)]
    fig, ax = plt.subplots(figsize=(6.0, 3.1), dpi=300)
    w = 0.16
    for j, (k, name, c) in enumerate(series):
        xs = [i + (j - 2) * (w + 0.015) for i in range(3)]
        ys = [r[k][s] for s in sess]
        ax.bar(xs, ys, width=w, color=c, label=name, zorder=2)
        if k == "POOLED":
            for x, y in zip(xs, ys): ax.text(x, y * 1.08, f"{y:.2f}", ha="center", va="bottom", fontsize=7, color=INK)
    ax.plot([i + 2 * (w + 0.015) for i in range(3)], [r["V4"][s] for s in sess], ls="none", marker="D", ms=5, mfc="white", mec=INK, mew=1.2,
            label="15 v4 pools, pool fee / 1h adverse", zorder=3)
    ax.axhline(1.0, color=INK, lw=0.8, ls=(0, (3, 2)), zorder=1, label="Break-even, fee = markout")
    ax.set_yscale("log"); ax.set_ylim(0.5, 30)
    ax.set_yticks([0.5, 1, 2, 5, 10, 20]); ax.set_yticklabels(["0.5", "1", "2", "5", "10", "20"])
    ax.set_xticks(range(3)); ax.set_xticklabels(lab)
    ax.set_ylabel("LP fee per \\$1 of 1h markout (log)")
    ax.grid(axis="y", color="#e6e5e0", lw=0.6, zorder=0)
    ax.legend(frameon=False, fontsize=7, ncol=2, loc="upper left")
    fig.tight_layout(); fig.savefig(os.path.join(HERE, "fig_sessions.png")); plt.close(fig)
    return r


def monday_series():
    prof = []
    for line in open(os.path.join(RD, "monday_profile_rerun.txt")):
        m = re.match(r"\s*(\d+) (\w{3} \d\d:\d\d)\s+(\d+)\s+\S+\s+\S+\s+[\d.]+\s+[\d.]+\s+(-?[\d.]+)", line)
        if m: prof.append((int(m.group(1)), m.group(2), float(m.group(4))))
    cv = {}
    for line in open(os.path.join(RD, "monday_shrunk_rerun.txt")):
        if line.startswith("ALL"):
            vals = re.findall(r"(-?[\d.]+)% \(n(\d+)\)", line)
            cv = dict(zip([20, 44, 52, 60, 65], [float(v) for v, _ in vals]))
    ctl = {}
    for line in open(os.path.join(RD, "monday_shuffle_control.txt")):
        m = re.match(r"(Sun16|Mon13): real ([\d.]+)%.*mean (-?[\d.]+)% median (-?[\d.]+)% max (-?[\d.]+)%", line)
        if m: ctl[{"Sun16": 44, "Mon13": 65}[m.group(1)]] = (float(m.group(3)), float(m.group(5)))
    assert len(prof) == 21 and len(cv) == 5 and len(ctl) == 2, (prof, cv, ctl)
    return prof, cv, ctl


def fig_monday():
    prof, cv, ctl = monday_series()
    fig, ax = plt.subplots(figsize=(6.0, 3.0), dpi=300)
    ax.axvspan(52, 60, color="#eef3fb", zorder=0); ax.axvspan(60, 65.5, color="#dbe7f8", zorder=0)
    ax.text(56, 58, "overnight\nsession", ha="center", va="top", fontsize=7, color=GRAY)
    ax.text(62.75, 22, "pre-\nmarket", ha="center", va="top", fontsize=7, color=GRAY)
    ax.plot([p[0] for p in prof], [p[2] for p in prof], color=BLUE, lw=1.6, marker="o", ms=3, label="In sample, single beta", zorder=3)
    ax.plot(list(cv), list(cv.values()), ls="none", marker="s", ms=6, mfc=ORANGE, mec="white", mew=0.8,
            label="Leave one weekend out (n = 168)", zorder=4)
    for h, (mean, mx) in ctl.items():
        ax.plot([h, h], [mean, mx], color=GRAY, lw=1.2, zorder=3); ax.plot(h, mean, marker="_", ms=8, color=GRAY, zorder=3)
    ax.plot([], [], color=GRAY, lw=1.2, label="Mismatched weekends, mean to max of 23")
    ax.axhline(0, color=INK, lw=0.7)
    for h in cv:
        ax.annotate(f"{cv[h]:.1f}%", (h, cv[h]), textcoords="offset points", xytext=(-16, 2) if h == 65 else (0, 7), ha="center", fontsize=7, color=INK)
    tk = [(0, "Fri\n20:00"), (12, "Sat\n08:00"), (24, "Sat\n20:00"), (36, "Sun\n08:00"), (44, "Sun\n16:00"), (52, "Mon\n00:00"), (60, "Mon\n08:00"), (65, "Mon\n13:00")]
    ax.set_xticks([t for t, _ in tk]); ax.set_xticklabels([l for _, l in tk], fontsize=7)
    ax.set_xlim(-1, 66.5); ax.set_ylim(-10, 80)
    ax.set_xlabel("Perp read time (UTC), hours after the Friday close")
    ax.set_ylabel("Cut in Monday-open error vs\nstale Friday close (%)")
    ax.grid(axis="y", color="#e6e5e0", lw=0.6, zorder=0)
    ax.legend(frameon=False, fontsize=7, loc="upper left")
    fig.tight_layout(); fig.savefig(os.path.join(HERE, "fig_monday.png")); plt.close(fig)
    return prof, cv, ctl


if __name__ == "__main__":
    r = fig_sessions(); print("sessions", r)
    print("monday", fig_monday())
