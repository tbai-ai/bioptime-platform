/* Time: stored as ISO 8601 UTC strings; the interfaces convert. India (Asia/Kolkata, +05:30) is the default zone for people. */
export const IST_OFFSET_MINUTES = 330;

export function nowIso(): string { return new Date().toISOString(); }
export function toIso(d: Date): string { return d.toISOString(); }
export function parseIso(s: string): Date {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid date: ${s}`);
  return d;
}
export function addMinutes(iso: string, minutes: number): string { return new Date(parseIso(iso).getTime() + minutes * 60_000).toISOString(); }
export function addHours(iso: string, hours: number): string { return addMinutes(iso, hours * 60); }
export function addDays(iso: string, days: number): string { return addMinutes(iso, days * 1440); }
export function addMonths(iso: string, months: number): string {
  const d = parseIso(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString();
}
export function isPast(iso: string, now = nowIso()): boolean { return parseIso(iso).getTime() < parseIso(now).getTime(); }
export function minutesBetween(a: string, b: string): number { return (parseIso(b).getTime() - parseIso(a).getTime()) / 60_000; }
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return parseIso(aStart).getTime() < parseIso(bEnd).getTime() && parseIso(bStart).getTime() < parseIso(aEnd).getTime();
}
/** YYYY-MM-DD of an instant in a fixed-offset zone (minutes east of UTC). */
export function dateInZone(iso: string, offsetMinutes = IST_OFFSET_MINUTES): string {
  return new Date(parseIso(iso).getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10);
}
/** Minutes since midnight of an instant in a fixed-offset zone. */
export function minuteOfDayInZone(iso: string, offsetMinutes = IST_OFFSET_MINUTES): number {
  const shifted = new Date(parseIso(iso).getTime() + offsetMinutes * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}
/** Weekday (0 = Sunday) of an instant in a fixed-offset zone. */
export function weekdayInZone(iso: string, offsetMinutes = IST_OFFSET_MINUTES): number {
  return new Date(parseIso(iso).getTime() + offsetMinutes * 60_000).getUTCDay();
}
/** The instant for a local date and minute of day in a fixed-offset zone. */
export function zonedToIso(date: string, minuteOfDay: number, offsetMinutes = IST_OFFSET_MINUTES): string {
  const base = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  return new Date(base + (minuteOfDay - offsetMinutes) * 60_000).toISOString();
}
/* People read dates in India time and in words, as the portal and the app write them (portal-13, portal-m2, app-11). */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function inIst(iso: string): Date { return new Date(parseIso(iso).getTime() + IST_OFFSET_MINUTES * 60_000); }
/** "Fri 30 Oct 2026": the day of an instant in India. */
export function istDayLabel(iso: string): string { const d = inIst(iso); return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!.slice(0, 3)} ${d.getUTCFullYear()}`; }
/** "19:00": the clock time of an instant in India (24-hour). */
export function istClock(iso: string): string { return inIst(iso).toISOString().slice(11, 16); }
/** "Fri 30 Oct 2026 at 19:00 IST". */
export function istWhen(iso: string): string { return `${istDayLabel(iso)} at ${istClock(iso)} IST`; }
/** "30 October 2026": the date of an instant in India, as on documents. */
export function istLongDate(iso: string): string { const d = inIst(iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }
/** "30 October 2026, 19:00 IST". */
export function istLongDateTime(iso: string): string { return `${istLongDate(iso)}, ${istClock(iso)} IST`; }

/** ISO with the +05:30 offset, the form LabStack expects for appointments. */
export function toIstOffsetString(iso: string): string {
  const shifted = new Date(parseIso(iso).getTime() + IST_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().replace('Z', '').slice(0, 19) + '+05:30';
}
export function ageFromDob(dob: string, now = nowIso()): number {
  const d = parseIso(dob + 'T00:00:00Z');
  const n = parseIso(now);
  let age = n.getUTCFullYear() - d.getUTCFullYear();
  if (n.getUTCMonth() < d.getUTCMonth() || (n.getUTCMonth() === d.getUTCMonth() && n.getUTCDate() < d.getUTCDate())) age--;
  return age;
}
