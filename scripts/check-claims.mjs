#!/usr/bin/env node
/** Claim checks that need more than grep, run by scripts/check-facts.sh over the same public files: node scripts/check-claims.mjs <file>...
 *  Every figure is compared with docs/facts.json (written by scripts/facts.mjs from web/lib/moment.json and the spike constants).
 *  1. data-fact: an element carrying data-fact="a.b.c" must show exactly docs/facts.json a.b.c, so a headline figure whose label sits in another element is still bound to its fact.
 *  2. Fee per $1 lost: every non-range figure in a sentence about weekends or NYSE hours must belong to ONE sample (the fixed-range spike, the 30-day vault replay or the 30-day whole-pool replay).
 *  3. Off-hours share: "N% of swaps" or "N% of fees" in a sentence about off-hours must equal web/lib/moment.json offHours, rounded to the precision quoted.
 *  4. Sample labels: a spike figure needs the pools, the fixed range and the start date in its own block (slide, paragraph, list item or table row); a replay figure needs its label in its block.
 *  Each check must read something: finding no instance of a claim is a failure. */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const facts = JSON.parse(readFileSync(resolve(root, "docs/facts.json"), "utf8"));
const files = process.argv.slice(2);
if (files.length === 0) { console.error("check-claims: no files given"); process.exit(2); }
let bad = 0;
const fail = (f, msg, ctx) => { console.log(`${f}: ${msg}${ctx ? `\n  ${ctx.replace(/\s+/g, " ").slice(0, 200)}` : ""}`); bad = 1; };
const seen = { dataFact: 0, ratio: 0, share: 0, spike: 0, replay: 0 };

const fp = facts.fee_per_dollar_lost, mo = facts.moment;
const samples = {
  "fixed-range spike": [fp.spike.weekend, fp.spike.weeknight, fp.spike.nyse],
  "30-day vault replay": Object.values(fp.replay_30d).map((s) => s.vault),
  "30-day pool replay": Object.values(fp.replay_30d).map((s) => s.pool),
};
const num = (x) => Number(x);
/** A fee-per-dollar-lost sentence. A sentence scoped to one band (B1, B2, "the 2% band") is a per-token, per-band measurement, a fourth sample that the pooled figures do not cover. */
const PER_DOLLAR = /\$1\b|per dollar|dollars? lost|lost to informed/i;
const BANDED = /\bbands?\b|<DataTable/i;
const inSample = (n, set) => set.some((v) => num(v) === n);

/** Blocks a label must share with its figure: a slide, a paragraph, a list item, a table row, a JSX paragraph. */
const blocks = (t) => t.split(/\n[ \t]*\n|(?=<section)|<\/section>|\n(?=\s*[-*|] )|<\/?P>/);
const sentences = (t) => t.split(/(?<=[.!?;:])\s+(?=[A-Z$<0-9])/);

for (const f of files) {
  const text = readFileSync(resolve(root, f), "utf8");

  // 1. data-fact
  for (const m of text.matchAll(/data-fact="([a-z0-9_.]+)"[^>]*>\s*([^<]*?)\s*</gi)) {
    seen.dataFact++;
    const want = m[1].split(".").reduce((o, k) => o?.[k], facts);
    if (want === undefined || String(want) !== m[2].replace(/,/g, "")) fail(f, `data-fact="${m[1]}" shows "${m[2]}", docs/facts.json says ${want}`);
  }

  // 2. one sample per sentence
  for (const b of blocks(text)) for (const s of sentences(b)) {
    if (!/\b(weekends?|NYSE)\b/i.test(s) || !PER_DOLLAR.test(s) || BANDED.test(s)) continue;
    const ns = [...s.matchAll(/(?<![\d.])(\d+\.\d\d)(?![\d.%])/g)].filter((m) => {
      const before = s.slice(0, m.index), after = s.slice(m.index + m[1].length);
      return !/\bto\s+\$?$/i.test(before) && !/^\s+to\s+\$?\d/i.test(after);
    }).map((m) => num(m[1]));
    if (ns.length === 0) continue;
    seen.ratio++;
    const home = Object.entries(samples).find(([, set]) => ns.every((n) => inSample(n, set)));
    if (!home) fail(f, `fee per $1 lost figures ${ns.join(", ")} are not all from one sample (${Object.entries(samples).map(([k, v]) => `${k}: ${v.join("/")}`).join("; ")})`, s);
  }

  // 3. off-hours share
  for (const b of blocks(text)) for (const s of sentences(b)) {
    if (!/off[- ]hours|outside (of )?(NYSE|regular|market)/i.test(s)) continue;
    for (const m of s.matchAll(/(\d+(?:\.\d+)?)% of (?:their |the |its |all )?(swaps|fees)\b/gi)) {
      seen.share++;
      const want = mo.off_hours[`${m[2].toLowerCase()}_pct`], dp = (m[1].split(".")[1] ?? "").length;
      if (num(m[1]) !== Number(want.toFixed(dp))) fail(f, `states ${m[1]}% of ${m[2]} off hours, docs/facts.json moment.off_hours.${m[2].toLowerCase()}_pct is ${want}`, s);
    }
  }

  // 4. sample labels
  const spikeRe = new RegExp(`(?<![\\d.])(${[fp.spike.weekend, fp.spike.nyse].map((v) => String(v).replace(".", "\\.")).join("|")})(?![\\d])`, "g");
  const replayVals = Object.values(fp.replay_30d).flatMap((s) => [s.vault, s.pool]);
  const replayRe = new RegExp(`(?<![\\d.])(${[...new Set(replayVals)].map((v) => String(v).replace(".", "\\.")).join("|")})(?![\\d])`, "g");
  const spikeNeeds = [["NVDA", /NVDA/], ["SPCX", /SPCX/], ["TSLA", /TSLA/], ["fixed", /(fixed|static)/i], ["24 August", /(24 August|2026-08-24)/]];
  for (const b of blocks(text)) {
    for (const m of b.matchAll(spikeRe)) {
      seen.spike++;
      for (const [name, re] of spikeNeeds) if (!re.test(b)) fail(f, `spike figure ${m[1]} without "${name}" in its block`, b.slice(Math.max(0, m.index - 80), m.index + 60));
    }
    for (const m of b.matchAll(replayRe)) {
      // A replay value is also an ordinary decimal elsewhere in a page; only a fee-per-dollar-lost sentence is held to the label.
      const s = sentences(b).find((x) => x.includes(m[1]));
      if (!s || !/\b(weekends?|weeknights?|NYSE)\b/i.test(b) || !PER_DOLLAR.test(b)) continue;
      seen.replay++;
      if (!/(30-day replay|vault replay|whole-pool|pool replay)/i.test(b)) fail(f, `30-day replay figure ${m[1]} without its label in its block`, b.slice(Math.max(0, m.index - 80), m.index + 60));
    }
  }
}

for (const [k, n] of Object.entries(seen)) if (n === 0) { console.log(`check-claims: no ${k} instance found in any file, the check read nothing`); bad = 1; }
if (!bad) console.log(`check-claims: ${files.length} files; ${seen.dataFact} data-fact, ${seen.ratio} fee-per-dollar sentences, ${seen.share} off-hours shares, ${seen.spike} spike and ${seen.replay} replay figures all match docs/facts.json`);
process.exit(bad);
