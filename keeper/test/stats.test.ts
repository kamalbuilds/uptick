import { describe, expect, test } from "bun:test";
import { bandSegments } from "../src/stats.ts";

const utc = (s: string) => Date.parse(s) / 1000;

describe("strategy band", () => {
  // Wed 2026-10-14 is EDT: open 13:30Z, recentre 13:35Z.
  const cl: [number, number][] = [
    [utc("2026-10-13T13:00:00Z"), 100], [utc("2026-10-14T13:00:00Z"), 110], [utc("2026-10-14T13:40:00Z"), 120],
    [utc("2026-10-16T13:00:00Z"), 130],
  ];
  const segs = bandSegments(cl, utc("2026-10-14T00:00:00Z"), utc("2026-10-19T12:00:00Z"), 5);

  test("centres on the Chainlink round at or before open + 5 min, +-5%", () => {
    const wed = segs.find((s) => s.from === utc("2026-10-14T13:35:00Z"))!;
    expect(wed.center).toBe(110);
    expect(wed.lower).toBeCloseTo(104.5, 9);
    expect(wed.upper).toBeCloseTo(115.5, 9);
  });
  test("Friday band carries over the weekend until Monday's recentre", () => {
    const fri = segs.find((s) => s.from === utc("2026-10-16T13:35:00Z"))!;
    expect(fri.center).toBe(130);
    expect(fri.to).toBe(utc("2026-10-19T12:00:00Z")); // Monday 13:35Z recentre is after the window end
    expect(segs.map((s) => s.from)).toEqual([13, 14, 15, 16].map((d) => utc(`2026-10-${d}T13:35:00Z`)));
  });
  test("holiday gets no recentre (Labor Day 2026-09-07)", () => {
    const h = bandSegments([[utc("2026-09-01T00:00:00Z"), 50]], utc("2026-09-04T00:00:00Z"), utc("2026-09-09T00:00:00Z"), 5);
    expect(h.map((s) => new Date(s.from * 1000).toISOString().slice(0, 10))).toEqual(["2026-09-03", "2026-09-04", "2026-09-08"]);
  });
  test("EST after the clock change recentres at 14:35Z", () => {
    const e = bandSegments([[utc("2026-11-02T00:00:00Z"), 80]], utc("2026-11-03T00:00:00Z"), utc("2026-11-04T00:00:00Z"), 5);
    expect(e.map((s) => s.from)).toContain(utc("2026-11-03T14:35:00Z"));
  });
});
