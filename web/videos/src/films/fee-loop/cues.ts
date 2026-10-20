import { at, type Grid } from "../../kit/time";

/** 120 BPM, four bars, 8 s. The last frame is the first frame: both are the empty state. */
export const grid: Grid = { bpm: 120, firstBeat: 0, pickupBeats: 0, beatsPerBar: 4 };
export const b = (bar: number, beat = 1, fraction = 0) => at(grid, bar, beat, fraction);

export const DURATION = 8;

export const cue = {
  /** The fee total fills the bar and the figure counts up. */
  fill: b(1, 2),
  /** Then each part takes its colour, left to right. */
  paint: [b(1, 4), b(1, 4, 0.5), b(2, 1)],
  label: [b(1, 4, 0.5), b(2, 1), b(2, 1, 0.5)],
  legend: [b(2, 1), b(2, 1, 0.5), b(2, 2)],
  /** Reading pass, twice: each part in turn for one beat while the others step back. */
  passes: [b(2, 4), b(3, 1), b(3, 2), b(3, 3), b(3, 4), b(4, 1)],
  /** Everything that moved leaves; the heading and the label stay, so frame 0 and the last frame match. */
  out: b(4, 1, 1),
  outLength: 0.5,
} as const;
