import { at, type Grid } from "../../kit/time";

/** A silent film still needs a grid: 120 BPM, 4/4, so a beat is 0.5 s and a bar is 2 s. Ten bars, 20 s. */
export const grid: Grid = { bpm: 120, firstBeat: 0, pickupBeats: 0, beatsPerBar: 4 };
export const b = (bar: number, beat = 1, fraction = 0) => at(grid, bar, beat, fraction);

export const DURATION = 20;

/** The beat sheet as data. Scene code reads these names and never a literal time. */
export const cue = {
  /** Scene 1, bars 1-2: the question lands one line group per beat on the page's own heading, then the "?" becomes the comma. */
  heading: { groups: [b(1, 1), b(1, 2), b(1, 3)], swap: b(2, 1), and: b(2, 1), how: b(2, 1, 0.5), keep: b(2, 2) },
  /** Scene 2, bars 2-4: the camera pulls back and the three doors build in, rows every eighth note. */
  home: {
    pullBack: b(2, 2),
    intro: b(2, 3),
    header: b(2, 3),
    open: b(2, 3),
    rows: { aapl: b(2, 3, 0.5), nvda: b(2, 4) },
    reduced: b(3, 1),
    reducedRows: [b(3, 1, 0.5), b(3, 2), b(3, 2, 0.5), b(3, 3), b(3, 3, 0.5)],
    closed: b(3, 4),
  },
  /** Scene 3, bar 4: the camera pushes into NVDA, the rest steps back; the ticker travels into the vault page title. */
  zoom: { start: b(4, 1), swap: b(4, 3) },
  /** Scene 4, bars 5-6: the fee bar fills, then each part takes its colour. */
  leak: {
    fill: b(5, 1),
    paint: [b(5, 3), b(5, 3, 0.5), b(5, 4)],
    label: [b(5, 4), b(5, 4, 0.5), b(6, 1)],
    legend: [b(5, 3), b(5, 3, 0.5), b(5, 4)],
  },
  /** Scene 5, bar 6-7: back up to the verdict, word by word. */
  verdict: { camera: b(6, 2), words: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => b(6, 3) + i * 0.3) },
  /** Scene 6, bars 8-9: the gate scale. */
  gate: { camera: b(8, 1), band: b(8, 2), worst: b(8, 3), other: b(8, 4), reason: b(9, 1) },
  /** Scene 7, bars 9-10: end card. */
  end: { start: b(9, 2), wordmark: b(9, 2, 0.5), url: b(9, 3, 0.5) },
} as const;
