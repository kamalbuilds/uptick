import { describe, expect, test } from "bun:test";
import { isEarlyClose, isTradingDay, nextRecentreMs, recentreDue, sessionAt, sessionFor } from "../src/calendar.ts";

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
