// NYSE calendar. Rule-based (no data file): weekends, the ten full-day holidays with observed-day shifts, early closes.
const ET = "America/New_York";
const pad = (n: number) => String(n).padStart(2, "0");
const key = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const dow = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sun

function nthWeekday(y: number, m: number, wd: number, n: number): number {
  const first = dow(y, m, 1);
  return 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
}
function lastWeekday(y: number, m: number, wd: number): number {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return last - ((dow(y, m, last) - wd + 7) % 7);
}
function easter(y: number): [number, number] { // anonymous Gregorian algorithm
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}
function shift(y: number, m: number, d: number, delta: number): [number, number, number] {
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
}
/** Saturday holiday -> Friday, Sunday -> Monday */
function observed(y: number, m: number, d: number): string {
  const w = dow(y, m, d);
  const [yy, mm, dd] = w === 6 ? shift(y, m, d, -1) : w === 0 ? shift(y, m, d, 1) : [y, m, d];
  return key(yy, mm, dd);
}

const cache = new Map<number, Set<string>>();
export function holidays(y: number): Set<string> {
  let s = cache.get(y);
  if (s) return s;
  s = new Set<string>();
  if (dow(y, 1, 1) !== 6) s.add(observed(y, 1, 1)); // NYSE does not close the prior Friday for a Saturday Jan 1
  s.add(key(y, 1, nthWeekday(y, 1, 1, 3))); // MLK
  s.add(key(y, 2, nthWeekday(y, 2, 1, 3))); // Presidents
  const [em, ed] = easter(y);
  const [gy, gm, gd] = shift(y, em, ed, -2);
  s.add(key(gy, gm, gd)); // Good Friday
  s.add(key(y, 5, lastWeekday(y, 5, 1))); // Memorial
  if (y >= 2022) s.add(observed(y, 6, 19)); // Juneteenth
  s.add(observed(y, 7, 4));
  s.add(key(y, 9, nthWeekday(y, 9, 1, 1))); // Labor
  s.add(key(y, 11, nthWeekday(y, 11, 4, 4))); // Thanksgiving
  s.add(observed(y, 12, 25));
  cache.set(y, s);
  return s;
}

/** wall-clock date in New York for an instant */
export function etDate(ms: number): { y: number; m: number; d: number; wd: number } {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: ET, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date(ms));
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return { y: g("year"), m: g("month"), d: g("day"), wd: dow(g("year"), g("month"), g("day")) };
}

export function isTradingDay(y: number, m: number, d: number): boolean {
  const w = dow(y, m, d);
  return w !== 0 && w !== 6 && !holidays(y).has(key(y, m, d));
}

/** 13:00 ET close: day after Thanksgiving, Dec 24 (Mon-Thu), Jul 3 when Jul 4 is Tue-Fri */
export function isEarlyClose(y: number, m: number, d: number): boolean {
  if (!isTradingDay(y, m, d)) return false;
  if (m === 11 && d === nthWeekday(y, 11, 4, 4) + 1) return true;
  if (m === 12 && d === 24) return true;
  if (m === 7 && d === 3) { const w4 = dow(y, 7, 4); return w4 >= 2 && w4 <= 5; }
  return false;
}

/** UTC ms of a New York wall-clock time (DST aware) */
export function etToUtcMs(y: number, m: number, d: number, hh: number, mm: number): number {
  for (const off of [4, 5]) { // EDT then EST
    const ms = Date.UTC(y, m - 1, d, hh + off, mm);
    const p = new Intl.DateTimeFormat("en-US", { timeZone: ET, hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date(ms));
    const h = Number(p.find((x) => x.type === "hour")!.value) % 24, mi = Number(p.find((x) => x.type === "minute")!.value);
    if (h === hh && mi === mm) return ms;
  }
  throw new Error("unresolvable ET time");
}

export interface Session { openMs: number; closeMs: number; recentreMs: number }
/** Regular session of an ET trading day. Recentre slot is open + 5 min = 13:35 UTC during EDT. */
export function sessionFor(y: number, m: number, d: number): Session | null {
  if (!isTradingDay(y, m, d)) return null;
  const openMs = etToUtcMs(y, m, d, 9, 30);
  return { openMs, closeMs: etToUtcMs(y, m, d, isEarlyClose(y, m, d) ? 13 : 16, 0), recentreMs: openMs + 5 * 60_000 };
}

export function sessionAt(nowMs: number): Session | null {
  const { y, m, d } = etDate(nowMs);
  return sessionFor(y, m, d);
}

/** Is the scheduled recentre due: trading day, past open+5min, before close, and nothing sent since the slot. */
export function recentreDue(nowMs: number, lastRebalanceMs: number): boolean {
  const s = sessionAt(nowMs);
  return !!s && nowMs >= s.recentreMs && nowMs < s.closeMs && lastRebalanceMs < s.recentreMs;
}

/** Next recentre slot strictly after nowMs (for logging) */
export function nextRecentreMs(nowMs: number): number {
  const { y, m, d } = etDate(nowMs);
  for (let i = 0; i < 12; i++) {
    const [yy, mm, dd] = shift(y, m, d, i);
    const s = sessionFor(yy, mm, dd);
    if (s && s.recentreMs > nowMs) return s.recentreMs;
  }
  throw new Error("no trading day in 12 days");
}
