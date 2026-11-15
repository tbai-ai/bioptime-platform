/* Life's data: released reports and their markers exactly as the laboratory reported them (value, units, range, flag),
   the trend of one marker across reports, and habits. The only things computed here are counts and positions:
   how many markers with a laboratory range are inside it, where a value sits within its range (for the ring and the
   range bar), and how many days have passed since collection. No biological age, score or projection is made up: a
   biological-age value would only ever be a marker a released report carries. */
import type { IconName } from '@/fx';
import { fx } from '@/fx';

export type ReportValue = { marker_key: string | null; label: string; value: string; units: string | null; range_low: number | null; range_high: number | null; matched_range?: string | null; flag: string | null };
export type Report = {
  id: string; reference: string; test: { name: string } | null; collectedAt: string; deliveredAt: string | null; released: boolean; releasedAt: string | null;
  reviewed: boolean; reviewedAt: string | null; reviewerName: string | null; reviewerKind: 'coach' | 'team' | null; coachNote: string | null;
  flagged: string[] | null; markers: number | null; valuesStatus: 'ready' | 'pending' | 'failed' | string; values: ReportValue[] | null;
  hasFile: boolean; provenance: string | null; simulated: boolean;
};
export type TrendPoint = { value: string; units: string | null; range_low: number | null; range_high: number | null; flag: string | null; at: string; report_id: string };

export type Status = 'in_range' | 'low' | 'high' | 'none';
export function statusOf(v: ReportValue | TrendPoint): Status {
  if (v.flag === 'low') return 'low';
  if (v.flag) return 'high';
  return v.range_low == null && v.range_high == null ? 'none' : 'in_range';
}
export const STATUS_WORD: Record<Status, string> = { in_range: 'In range', low: 'Below range', high: 'Above range', none: 'No range' };
export const statusColor = (s: Status): string => (s === 'in_range' ? fx.map.marker.in_range : s === 'low' ? fx.map.marker.low : s === 'high' ? fx.map.marker.high : fx.ink.a50);

export const num = (v: { value: string }): number | null => { const n = Number(String(v.value).replace(',', '.')); return Number.isFinite(n) ? n : null; };

/** The laboratory range in words: "30–100", "≤ 200", "≥ 40" (or the laboratory's matched range text). */
export function rangeText(v: { range_low: number | null; range_high: number | null; matched_range?: string | null }): string {
  if (v.matched_range) return v.matched_range;
  if (v.range_low != null && v.range_high != null) return `${v.range_low}–${v.range_high}`;
  if (v.range_low != null) return `≥ ${v.range_low}`;
  if (v.range_high != null) return `≤ ${v.range_high}`;
  return '—';
}
export function rangeWords(v: ReportValue | TrendPoint): string {
  if (v.range_low != null && v.range_high != null) return `the laboratory range ${v.range_low} to ${v.range_high}`;
  if (v.range_low != null) return `the laboratory range, at least ${v.range_low}`;
  if (v.range_high != null) return `the laboratory range, up to ${v.range_high}`;
  return 'no laboratory range';
}
/** "Vitamin D, 24 ng/mL, below the laboratory range 30 to 100". */
export function spoken(v: ReportValue): string {
  const s = statusOf(v);
  const where = s === 'in_range' ? 'inside' : s === 'low' ? 'below' : s === 'high' ? 'above' : 'with';
  return `${v.label}, ${v.value} ${v.units ?? ''}, ${where} ${rangeWords(v)}`;
}

/** Where a value sits in its range, 0..1, for the ring (two-sided: low → 0, high → 1; an upper limit only: value / limit;
 *  a lower limit only: the limit at the middle). Null when the value is not a number or there is no range. */
export function ringPosition(v: ReportValue): number | null {
  const n = num(v);
  if (n == null) return null;
  const lo = v.range_low, hi = v.range_high;
  // a value below its range keeps a sliver of arc, so the status colour shows
  const clamp = (x: number) => Math.max(0.04, Math.min(1, x));
  if (lo != null && hi != null && hi > lo) return clamp((n - lo) / (hi - lo));
  if (hi != null && hi > 0) return clamp(n / hi);
  if (lo != null && lo > 0) return clamp(n / (lo * 2));
  return null;
}

/** The dot on the kit's RangeBar, whose green band runs from 15 % to 85 %: the range's ends sit on the band's ends. */
export function barPosition(v: ReportValue | TrendPoint): number | null {
  const n = num(v);
  if (n == null) return null;
  const lo = v.range_low, hi = v.range_high;
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  if (lo != null && hi != null && hi > lo) return clamp(0.15 + 0.7 * ((n - lo) / (hi - lo)));
  if (hi != null && hi > 0) return clamp(0.15 + 0.7 * (n / hi));
  if (lo != null && lo > 0) return clamp(0.15 + 0.7 * ((n - lo) / lo));
  return null;
}

/** Markers of a report with a key, flagged first. */
export const keyed = (r: Report | null | undefined) => (r?.values ?? []).filter((v) => v.marker_key);

export type InRange = { inRange: number; total: number; flagged: number; withoutRange: number };
export function countInRange(r: Report): InRange {
  const values = r.values ?? [];
  const ranged = values.filter((v) => v.range_low != null || v.range_high != null || v.matched_range);
  const flagged = ranged.filter((v) => v.flag).length;
  return { inRange: ranged.length - flagged, total: ranged.length, flagged, withoutRange: values.length - ranged.length };
}

export const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86400_000));

const ICONS: Array<[RegExp, IconName]> = [
  [/chol|ldl|hdl|trig|lipid/, 'heart'], [/glucose|hba1c|insulin/, 'droplet'], [/vitamin_d|vit_d/, 'sun'], [/b12|folate|iron|ferritin/, 'pill'],
  [/haemo|hemo|rbc|hb$/, 'droplets'], [/wbc|platelet|neutro|lymph/, 'microscope'], [/tsh|t3|t4|thyro/, 'activity'], [/crp|esr|inflam/, 'flame'],
  [/creat|urea|egfr|kidney/, 'test-tube'], [/alt|ast|liver|bilirubin/, 'flask-conical'],
];
export function markerIcon(key: string | null): IconName {
  const k = (key ?? '').toLowerCase();
  return ICONS.find(([re]) => re.test(k))?.[1] ?? 'flask-conical';
}

/** Panels for the "All markers" sheet, by marker key (a way of grouping, not a reading). */
const PANELS: Array<[string, RegExp]> = [
  ['Lipid profile', /chol|ldl|hdl|trig|lipid/], ['Metabolic', /glucose|hba1c|insulin/], ['Blood count', /haemo|hemo|rbc|wbc|platelet|neutro|lymph|^hb$/],
  ['Thyroid', /tsh|t3|t4|thyro/], ['Vitamins and minerals', /vitamin|b12|folate|iron|ferritin|calcium/], ['Inflammation', /crp|esr|inflam/],
];
export function panelsOf(values: ReportValue[]): Array<{ title: string; items: ReportValue[] }> {
  const out = new Map<string, ReportValue[]>();
  for (const v of values) {
    const k = (v.marker_key ?? v.label).toLowerCase();
    const title = PANELS.find(([, re]) => re.test(k))?.[0] ?? 'Other markers';
    out.set(title, [...(out.get(title) ?? []), v]);
  }
  const order = [...PANELS.map(([t]) => t), 'Other markers'];
  return [...out.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([title, items]) => ({ title, items }));
}

export const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

/* ---------- habits ---------- */
export type Schedule = { type: 'daily' } | { type: 'weekdays'; weekdays: number[] } | { type: 'times_per_week'; timesPerWeek: number };
export type DayCell = { date: string; weekday: number; due: boolean; status: 'done' | 'skipped' | 'missed' | 'open' | 'off' };
export type Habit = {
  id: string; title: string; detail: string; schedule: Schedule; scheduleLabel: string; targetLabel: string | null; reminderTimes: string[]; remindersOn: boolean;
  status: 'active' | 'paused' | 'archived'; setBy: 'member' | 'coach';
  today: { date: string; due: boolean; checkin: { status: 'done' | 'skipped'; note?: string | null } | null };
  week: { done: number; target: number }; streak: { count: number; unit: 'days' | 'weeks' }; recent: DayCell[];
};
export type HabitList = { today: string; timezone: string; items: Habit[]; dueToday: number; note: string; delivery: { detail: string } };
export const LETTER: Record<number, string> = { 1: 'M', 2: 'T', 3: 'W', 4: 'T', 5: 'F', 6: 'S', 7: 'S' };
/** "12 check-ins in a row" (a habit on set days counts the days it was due, so a weekday habit's streak skips the
 *  weekend: they are not calendar days in a row) or "3 weeks in a row" (a habit of so many times a week). */
export const streakUnit = (count: number, unit: string) => (unit === 'weeks' ? (count === 1 ? 'week' : 'weeks') : (count === 1 ? 'check-in' : 'check-ins'));
export const streakText = (h: Habit) => (h.streak.count > 0 ? `${h.streak.count} ${streakUnit(h.streak.count, h.streak.unit)} in a row` : 'No streak yet');
