import { describe, expect, test } from "bun:test";
import { bandSegments } from "../src/stats.ts";

const utc = (s: string) => Date.parse(s) / 1000;

describe("strategy band", () => {
  // Each ET trading session recentres at 02:00 UTC that evening (22:00 ET in EDT, 21:00 ET in EST).
  const cl: [number, number][] = [
    [utc("2026-10-13T13:00:00Z"), 100], [utc("2026-10-14T13:00:00Z"), 110], [utc("2026-10-14T13:40:00Z"), 120],
    [utc("2026-10-16T13:00:00Z"), 130],
  ];
  const segs = bandSegments(cl, utc("2026-10-14T00:00:00Z"), utc("2026-10-19T12:00:00Z"), 5);

  test("centres on the Chainlink round at or before the 02:00 UTC slot, +-5%", () => {
    const wed = segs.find((s) => s.from === utc("2026-10-15T02:00:00Z"))!; // Wednesday's session slot
    expect(wed.center).toBe(120);
    expect(wed.lower).toBeCloseTo(114, 9);
    expect(wed.upper).toBeCloseTo(126, 9);
  });
  test("Friday band carries over the weekend until Monday's slot", () => {
    const fri = segs.find((s) => s.from === utc("2026-10-17T02:00:00Z"))!;
    expect(fri.center).toBe(130);
    expect(fri.to).toBe(utc("2026-10-19T12:00:00Z")); // Monday's slot (Tue 02:00Z) is after the window end
    expect(segs.map((s) => s.from)).toEqual([14, 15, 16, 17].map((d) => utc(`2026-10-${d}T02:00:00Z`)));
  });
  test("holiday gets no recentre (Labor Day 2026-09-07)", () => {
    const h = bandSegments([[utc("2026-09-01T00:00:00Z"), 50]], utc("2026-09-04T00:00:00Z"), utc("2026-09-09T12:00:00Z"), 5);
    expect(h.map((s) => new Date(s.from * 1000).toISOString().slice(0, 10))).toEqual(["2026-09-03", "2026-09-04", "2026-09-05", "2026-09-09"]);
  });
  test("EST after the clock change still recentres at 02:00Z", () => {
    const e = bandSegments([[utc("2026-11-02T00:00:00Z"), 80]], utc("2026-11-03T00:00:00Z"), utc("2026-11-05T00:00:00Z"), 5);
    expect(e.map((s) => s.from)).toContain(utc("2026-11-04T02:00:00Z"));
  });
});
