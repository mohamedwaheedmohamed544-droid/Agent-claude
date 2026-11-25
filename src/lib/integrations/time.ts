/** Date helpers for calendar tools: turn ISO local times + IANA zones into exact instants. */

const OFFSET_RE = /(Z|[+-]\d{2}:?\d{2})$/i;
const LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

function tzOffsetMs(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Resolves an ISO 8601 date-time to an exact instant. Values with an offset are absolute; values without
 * one are interpreted as wall-clock time in `timeZone` (default UTC). Date-only values mean 00:00.
 */
export function toInstant(value: string, timeZone?: string): Date {
  const v = value.trim();
  if (OFFSET_RE.test(v) && /T/.test(v)) {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) throw new Error(`Invalid date-time "${value}"`);
    return d;
  }
  const local = DATE_RE.test(v) ? `${v}T00:00:00` : v;
  if (!LOCAL_RE.test(local)) throw new Error(`Invalid date-time "${value}" (use ISO 8601, e.g. 2026-03-01T10:00:00+03:00)`);
  const tz = timeZone ?? "UTC";
  if (!isValidTimeZone(tz)) throw new Error(`Unknown time zone "${tz}"`);
  const naiveUtc = new Date(`${local}Z`);
  // Two passes handle DST transitions correctly.
  let guess = new Date(naiveUtc.getTime() - tzOffsetMs(naiveUtc, tz));
  guess = new Date(naiveUtc.getTime() - tzOffsetMs(guess, tz));
  return guess;
}

/** "2026-03-01T07:00:00.000Z" → "2026-03-01T07:00:00" (Graph wants dateTime without offset + timeZone). */
export function utcWallClock(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "");
}
