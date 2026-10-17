/** Mirror of UptickHook.sessionAt (contracts/src/hook/UptickHook.sol). Same rules, same holiday table. */
export type Session = "Regular" | "OffHours" | "Weekend";

/** Fee schedule the hook is deployed with, in pips (1 bp = 100 pips). */
export const FEES = { Regular: 2500, OffHours: 1000, Weekend: 500, max: 10_000 } as const;
export const SESSION_LABEL: Record<Session, string> = { Regular: "NYSE open", OffHours: "Weeknight", Weekend: "Weekend" };
export const feeBps = (s: Session) => FEES[s] / 100;
export const MAX_FEE_BPS = FEES.max / 100;

const DAY = 86400;
const OPEN_EDT = 13 * 3600 + 1800;
const CLOSE_EDT = 20 * 3600;

const HOLIDAYS = new Set([
  20260101, 20260119, 20260216, 20260403, 20260525, 20260619, 20260703, 20260907, 20261126, 20261225,
  20270101, 20270118, 20270215, 20270326, 20270531, 20270618, 20270705, 20270906, 20271125, 20271224,
]);

const dowOfDay = (day: number) => (day + 4) % 7; // 0 = Sunday
const dayOf = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 1000 / DAY;

function isDst(ts: number, year: number): boolean {
  const mar1 = dayOf(year, 3, 1);
  const nov1 = dayOf(year, 11, 1);
  const start = (mar1 + ((7 - dowOfDay(mar1)) % 7) + 7) * DAY + 7 * 3600;
  const end = (nov1 + ((7 - dowOfDay(nov1)) % 7)) * DAY + 6 * 3600;
  return ts >= start && ts < end;
}

/** NYSE session at a UTC unix timestamp in seconds. */
export function sessionAt(ts: number): Session {
  const day = Math.floor(ts / DAY);
  const sod = ts - day * DAY;
  const dow = dowOfDay(day);
  const dt = new Date(day * DAY * 1000);
  const shift = isDst(ts, dt.getUTCFullYear()) ? 0 : 3600;
  const open = OPEN_EDT + shift;
  const close = CLOSE_EDT + shift;
  if (dow === 6 || dow === 0 || (dow === 5 && sod >= close)) return "Weekend";
  const key = dt.getUTCFullYear() * 10_000 + (dt.getUTCMonth() + 1) * 100 + dt.getUTCDate();
  if (HOLIDAYS.has(key)) return "OffHours";
  return sod >= open && sod < close ? "Regular" : "OffHours";
}

/** First timestamp after ts where the session differs. Every boundary is a multiple of 30 minutes. */
export function nextChange(ts: number): { at: number; to: Session } {
  const now = sessionAt(ts);
  for (let t = (Math.floor(ts / 1800) + 1) * 1800, end = ts + 14 * DAY; t <= end; t += 1800) {
    const s = sessionAt(t);
    if (s !== now) return { at: t, to: s };
  }
  throw new Error("no session change within 14 days");
}
