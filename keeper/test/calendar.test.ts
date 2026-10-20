import { describe, expect, test } from "bun:test";
import { isEarlyClose, isTradingDay, nextRecentreMs, RECENTRE_JITTER_MIN, recentreDue, recentreOffsetMs, sessionAt, sessionFor } from "../src/calendar.ts";

const utc = (s: string) => Date.parse(s);

describe("NYSE calendar", () => {
  test("weekend is not a trading day", () => {
    expect(isTradingDay(2026, 10, 17)).toBe(false); // Saturday
    expect(isTradingDay(2026, 10, 18)).toBe(false); // Sunday
    expect(isTradingDay(2026, 10, 19)).toBe(true); // Monday
  });
  test("holidays 2026", () => {
    expect(isTradingDay(2026, 1, 1)).toBe(false);
    expect(isTradingDay(2026, 1, 19)).toBe(false); // MLK
    expect(isTradingDay(2026, 2, 16)).toBe(false); // Presidents
    expect(isTradingDay(2026, 4, 3)).toBe(false); // Good Friday
    expect(isTradingDay(2026, 5, 25)).toBe(false); // Memorial
    expect(isTradingDay(2026, 6, 19)).toBe(false); // Juneteenth (Friday)
    expect(isTradingDay(2026, 7, 3)).toBe(false); // Jul 4 is Saturday, observed Friday
    expect(isTradingDay(2026, 9, 7)).toBe(false); // Labor
    expect(isTradingDay(2026, 11, 26)).toBe(false); // Thanksgiving
    expect(isTradingDay(2026, 12, 25)).toBe(false);
  });
  test("observed shifts and the Saturday New Year rule", () => {
    expect(isTradingDay(2027, 12, 31)).toBe(true); // Jan 1 2028 is Saturday: no Friday closure
    expect(isTradingDay(2027, 12, 24)).toBe(false); // Dec 25 2027 Saturday -> Friday
    expect(isTradingDay(2027, 7, 5)).toBe(false); // Jul 4 2027 Sunday -> Monday
  });
  test("early close", () => {
    expect(isEarlyClose(2026, 11, 27)).toBe(true);
    expect(isEarlyClose(2026, 12, 24)).toBe(true);
    expect(isEarlyClose(2026, 10, 19)).toBe(false);
  });
  test("recentre slot is 02:00 UTC on the evening after each trading session", () => {
    expect(sessionFor(2026, 10, 19)!.recentreMs).toBe(utc("2026-10-20T02:00:00Z")); // Monday session, 22:00 ET
    expect(sessionFor(2026, 12, 1)!.recentreMs).toBe(utc("2026-12-02T02:00:00Z")); // EST: 21:00 ET
    expect(sessionFor(2026, 11, 27)!.closeMs).toBe(utc("2026-11-27T18:00:00Z"));
  });
  test("recentreDue in the slot window, once, never for a non-trading day", () => {
    const slot = utc("2026-10-20T02:00:00Z");
    expect(recentreDue(slot - 1, 0)).toBe(false);
    expect(recentreDue(slot, 0)).toBe(true);
    expect(recentreDue(slot + 5 * 3_600_000, 0)).toBe(true); // still inside the 6 h window after ET midnight
    expect(recentreDue(slot + 3_600_000, slot + 5_000)).toBe(false); // already sent
    expect(recentreDue(slot + 7 * 3_600_000, 0)).toBe(false); // window over
    expect(recentreDue(utc("2026-10-17T02:00:00Z"), 0)).toBe(true); // Friday 16 Oct session, Saturday 02:00 UTC
    expect(recentreDue(utc("2026-10-18T02:00:00Z"), 0)).toBe(false); // Saturday: no session
    expect(recentreDue(utc("2026-10-19T02:00:00Z"), 0)).toBe(false); // Sunday: no session
    expect(recentreDue(utc("2026-11-27T02:00:00Z"), 0)).toBe(false); // Thanksgiving: no session
    expect(sessionAt(utc("2026-10-17T13:40:00Z"))).toBeNull();
  });
  test("next slot from Saturday is Tuesday 02:00 UTC; from Thanksgiving eve it is that evening, then Saturday", () => {
    expect(nextRecentreMs(utc("2026-10-17T04:00:00Z"))).toBe(utc("2026-10-20T02:00:00Z"));
    expect(nextRecentreMs(utc("2026-11-25T20:00:00Z"))).toBe(utc("2026-11-26T02:00:00Z"));
    expect(nextRecentreMs(utc("2026-11-26T03:00:00Z"))).toBe(utc("2026-11-28T02:00:00Z"));
  });
});

describe("recentre jitter", () => {
  const salt = "test-salt-a";
  const days = Array.from({ length: 120 }, (_, i) => new Date(Date.UTC(2026, 9, 19 + i)));
  const sessions = days.map((d) => sessionFor(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), salt)).filter((s) => s !== null);
  const offsetMin = (s: { recentreMs: number }) => (s.recentreMs % 86_400_000) / 60_000 - 120;

  test("the jittered slot stays inside the 02:00 to 08:00 UTC window on every trading day, and inside its first 300 minutes", () => {
    expect(sessions.length).toBeGreaterThan(70);
    for (const s of sessions) {
      const dayStart = Math.floor(s.recentreMs / 86_400_000) * 86_400_000;
      expect(s.recentreMs).toBeGreaterThanOrEqual(dayStart + 2 * 3_600_000);
      expect(s.recentreMs).toBeLessThan(dayStart + 7 * 3_600_000);
      expect(s.windowEndMs).toBe(dayStart + 8 * 3_600_000);
      expect(offsetMin(s)).toBeLessThan(RECENTRE_JITTER_MIN);
    }
  });
  test("the minute differs across days and spreads over the window", () => {
    const minutes = sessions.map(offsetMin);
    expect(new Set(minutes).size).toBeGreaterThan(minutes.length * 0.8);
    expect(Math.min(...minutes)).toBeLessThan(60);
    expect(Math.max(...minutes)).toBeGreaterThan(240);
  });
  test("deterministic per day for one salt, different for another salt, plain 02:00 with no salt", () => {
    const day = Date.UTC(2026, 9, 21);
    expect(recentreOffsetMs(day, salt)).toBe(recentreOffsetMs(day + 3_600_000, salt)); // same UTC day
    const other = days.slice(0, 40).filter((d) => recentreOffsetMs(d.getTime(), salt) !== recentreOffsetMs(d.getTime(), "test-salt-b"));
    expect(other.length).toBeGreaterThan(30);
    expect(sessionFor(2026, 10, 19)!.recentreMs).toBe(utc("2026-10-20T02:00:00Z"));
  });
  test("recentreDue opens at the jittered minute, not at 02:00, and closes at 08:00 whatever the minute", () => {
    const s = sessionFor(2026, 10, 19, salt)!;
    const base = utc("2026-10-20T02:00:00Z");
    expect(s.recentreMs).toBeGreaterThan(base); // this salt and day draw a later minute
    expect(recentreDue(base, 0, salt)).toBe(false);
    expect(recentreDue(s.recentreMs - 1, 0, salt)).toBe(false);
    expect(recentreDue(s.recentreMs, 0, salt)).toBe(true);
    expect(recentreDue(s.recentreMs, s.recentreMs + 1, salt)).toBe(false); // already sent
    expect(recentreDue(utc("2026-10-20T07:59:59Z"), 0, salt)).toBe(true);
    expect(recentreDue(utc("2026-10-20T08:00:00Z"), 0, salt)).toBe(false);
    expect(nextRecentreMs(base - 1, salt)).toBe(s.recentreMs);
  });
});

