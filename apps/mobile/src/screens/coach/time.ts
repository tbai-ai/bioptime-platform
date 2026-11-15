/* Dates for the Coach tab, all in IST (Asia/Kolkata), as the rest of the app shows them: the day separators in the
   thread ("Today", "Yesterday", "Wed 21 Oct"), the booking date chips (weekday / day / month) and the consultation
   lines ("Wed 4 Nov · 17:00 IST"). */
const IST = 'Asia/Kolkata';
const MS_DAY = 86_400_000;

/** The IST calendar day (YYYY-MM-DD) of an instant. */
export function istDay(iso: string): string {
  return new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/** Today in IST plus `offset` days (YYYY-MM-DD). */
export function istToday(offset = 0): string {
  return new Date(Date.now() + offset * MS_DAY + 330 * 60_000).toISOString().slice(0, 10);
}

function at(day: string): Date { return new Date(`${day}T12:00:00+05:30`); }
function part(day: string, opts: Intl.DateTimeFormatOptions): string {
  try { return at(day).toLocaleDateString('en-GB', { ...opts, timeZone: IST }); } catch { return day; }
}

/** The thread's day separator. */
export function dayLabel(day: string): string {
  if (day === istToday()) return 'Today';
  if (day === istToday(-1)) return 'Yesterday';
  const sameYear = day.slice(0, 4) === istToday().slice(0, 4);
  return part(day, sameYear ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

/** A date chip's three lines and its spoken label. */
export function chipParts(day: string): { weekday: string; day: string; month: string; label: string } {
  return {
    weekday: part(day, { weekday: 'short' }).toUpperCase(),
    day: String(Number(day.slice(8, 10))),
    month: part(day, { month: 'short' }),
    label: part(day, { weekday: 'long', day: 'numeric', month: 'long' }),
  };
}

/** 24-hour IST time ("17:00"). */
export function istTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: IST }); } catch { return iso; }
}

/** "Wed 4 Nov" (with the year when it is not this year). */
export function istDateShort(iso: string): string {
  return dayLabel(istDay(iso));
}

/** "Wed 4 Nov · 17:00 IST", "Today · 09:30 IST". */
export function whenLine(iso: string): string {
  return `${istDateShort(iso)} · ${istTime(iso)} IST`;
}

/** A long spoken form: "Wednesday 4 November at 17:00 IST". */
export function whenSpoken(iso: string): string {
  return `${part(istDay(iso), { weekday: 'long', day: 'numeric', month: 'long' })} at ${istTime(iso)} IST`;
}
