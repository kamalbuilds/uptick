import { cue as launch } from "../src/films/launch/cues";
import { cue as feeLoop } from "../src/films/fee-loop/cues";

/** Prints each film's beat sheet from its cues.ts: `bun scripts/beat-sheet.ts`. The cues are the only timeline; this is the table the product owner reads. */
const flatten = (value: unknown, path: string, rows: [string, number][]) => {
  if (typeof value === "number") { if (!path.endsWith("Length")) rows.push([path, value]); }
  else if (Array.isArray(value)) value.forEach((v, i) => flatten(v, `${path}[${i}]`, rows));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) flatten(v, path ? `${path}.${k}` : k, rows);
};
for (const [title, cue] of [["Launch 20 s, 120 BPM", launch], ["FeeLoop 8 s, 120 BPM", feeLoop]] as const) {
  const rows: [string, number][] = [];
  flatten(cue, "", rows);
  rows.sort((a, b) => a[1] - b[1]);
  console.log(`\n${title}\n  t (s)   bar.beat   cue`);
  for (const [path, seconds] of rows) {
    const beat = seconds / 0.5;
    console.log(`  ${seconds.toFixed(2).padStart(5)}   ${String(Math.floor(beat / 4) + 1)}.${(beat % 4 + 1).toFixed(2)}     ${path}`);
  }
}
