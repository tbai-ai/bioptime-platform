const IST = 'Asia/Kolkata';

/* Formatters made once per option set: toLocaleDateString(locale, options) builds a new Intl.DateTimeFormat on every
   call, and screens format dozens of dates per render (a tab switch's profile showed it). Same output, same locale. */
const dateFormats = new Map<string, Intl.DateTimeFormat>();
const numberFormats = new Map<string, Intl.NumberFormat>();
/** An en-IN date formatter for these options (cached). */
export function dtf(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  let f = dateFormats.get(key);
  if (!f) { f = new Intl.DateTimeFormat('en-IN', options); dateFormats.set(key, f); }
  return f;
}
/** An en-IN number formatter for these options (cached). */
export function nf(options: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  const key = JSON.stringify(options);
  let f = numberFormats.get(key);
  if (!f) { f = new Intl.NumberFormat('en-IN', options); numberFormats.set(key, f); }
  return f;
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  try { return dtf({ day: 'numeric', month: 'short', year: 'numeric', timeZone: IST }).format(new Date(iso)); } catch { return String(iso).slice(0, 10); }
}
export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  try { return `${dtf({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: IST }).format(new Date(iso))} IST`; } catch { return String(iso); }
}
export function fmtTime(iso?: string | null): string {
  if (!iso) return '—';
  try { return dtf({ hour: '2-digit', minute: '2-digit', hour12: false, timeZone: IST }).format(new Date(iso)); } catch { return String(iso); }
}
export function inr(n?: number | null): string {
  if (n === null || n === undefined) return 'On request';
  return `₹${nf().format(Math.round(n))}`;
}
export function label(s?: string | null): string {
  if (!s) return '';
  const t = String(s).replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
export function relative(iso?: string | null): string {
  if (!iso) return '';
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  if (d < 7 * 86400) return `${Math.floor(d / 86400)} d ago`;
  return fmtDate(iso);
}
/** today's date in IST as YYYY-MM-DD, plus an offset in days */
export function istDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000 + 330 * 60000);
  return d.toISOString().slice(0, 10);
}

/** A laboratory range and its unit for a caption, each kept whole by the line breaker: a word joiner after each slash
 *  of the unit ('≤ 200 mg/' then 'dL' on Android, SWA-09) and after a range's dash, and a no-break space inside the
 *  range ('≤ 200'); a line may still break between the range and its unit, so the unit moves to the next line whole.
 *  No unit: the range alone. */
export function rangeWithUnit(range: string, units?: string | null): string {
  const r = range.replace(/ /g, '\u00a0').replace(/\u2013/g, '\u2013\u2060');
  return units ? `${r} ${units.replace(/\//g, '/\u2060')}` : r;
}
