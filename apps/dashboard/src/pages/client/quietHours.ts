/* Quiet hours as the API keeps them (PUT /notification-preferences/quiet-hours; api/domain/reminders.ts): minutes after
   local midnight (0 to 1439) in the person's time zone, a start and an end or neither. A window may cross midnight
   (22:00 to 07:00); equal ends would mean no quiet hours at all, so the form refuses them. */

/** "HH:MM" on a 24-hour clock. */
export const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "22:30" → 1350; anything else → null. */
export function clockToMinute(s: string): number | null {
  const m = CLOCK_RE.exec(s.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 1350 → "22:30"; a missing or out-of-range value → "". */
export function minuteToClock(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isInteger(n) || n < 0 || n > 1439) return '';
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

/** The saved window from GET /notification-preferences, or null when none is set (a person without a preferences row
 *  has no quiet-hour fields at all). */
export function savedQuietHours(p: { quiet_start_minute?: number | null; quiet_end_minute?: number | null } | null | undefined): { start: number; end: number } | null {
  const start = p?.quiet_start_minute, end = p?.quiet_end_minute;
  return typeof start === 'number' && typeof end === 'number' && start !== end ? { start, end } : null;
}

/** The body for PUT /notification-preferences/quiet-hours from two clock fields, or null while they are not a usable pair. */
export function quietHoursBody(start: string, end: string): { startMinute: number; endMinute: number } | null {
  const s = clockToMinute(start), e = clockToMinute(end);
  return s !== null && e !== null && s !== e ? { startMinute: s, endMinute: e } : null;
}

/** The time zone the server reads the window in: the profile's, India unless it says otherwise. */
export function zoneName(tz: string | null | undefined): string {
  return !tz || tz === 'Asia/Kolkata' ? 'India Standard Time' : tz;
}
