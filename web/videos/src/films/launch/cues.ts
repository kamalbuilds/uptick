import { at, type Grid } from "../../kit/time";

/** A silent film still needs a grid: 120 BPM, 4/4, so a beat is 0.5 s and a bar is 2 s. Ten bars, 20 s. */
export const grid: Grid = { bpm: 120, firstBeat: 0, pickupBeats: 0, beatsPerBar: 4 };
export const b = (bar: number, beat = 1, fraction = 0) => at(grid, bar, beat, fraction);

export const DURATION = 20;

/** Nine reduced rows, one every 0.3 s from `first`. */
const reducedRows = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => b(2, 4) + i * 0.3);

/** The beat sheet as data. Scene code reads these names and never a literal time. */
export const cue = {
  /** Scene 1, bars 1-2: the question lands one line group per beat on the page's own heading, then the "?" becomes the comma. */
  heading: { groups: [b(1, 1), b(1, 2), b(1, 3)], swap: b(1, 4), and: b(1, 4), how: b(1, 4, 0.5), keep: b(2, 1) },
  /** Scene 2, bars 2-4: the camera pulls back and the three doors build in; the camera follows the build down the list. */
  home: {
    pullBack: b(2, 1),
    intro: b(2, 2),
    header: b(2, 2),
    open: b(2, 2),
    rows: { aapl: b(2, 2, 0.5), googl: b(2, 3) },
    reduced: b(2, 3, 0.5),
    reducedRows,
    closed: b(3, 4) + 0.2,
    /** Camera stops while the list builds, then the heading steps back. */
    pan: [b(3, 1), b(3, 3)],
    headingOut: b(2, 4) + 0.2,
  },
  /** Scene 3, bar 4-5: the camera returns and pushes into AAPL, the rest steps back; the ticker travels into the vault page title. */
  zoom: { start: b(4, 3), swap: b(5, 1) },
  /** Scene 4, bars 5-6: the fee bar fills, then each part takes its colour. */
  leak: {
    fill: b(5, 2),
    paint: [b(5, 4), b(5, 4, 0.5), b(6, 1)],
    label: [b(6, 1), b(6, 1, 0.5), b(6, 2)],
    legend: [b(5, 4), b(5, 4, 0.5), b(6, 1)],
  },
  /** Scene 5, bars 6-7: back up to the verdict, word by word, door sentence included. */
  verdict: { camera: b(6, 2), words: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => b(6, 3) + i * 0.2) },
  /** Scene 6, bar 8: the gate scale. */
  gate: { camera: b(8, 1), band: b(8, 1, 0.5), worst: b(8, 2, 0.5), other: b(8, 3, 0.5), reason: b(8, 4) },
  /** Scene 7, bars 9-10: end card. */
  end: { start: b(9, 1), line: b(9, 1, 0.5), wordmark: b(9, 2), url: b(9, 3) },
} as const;
