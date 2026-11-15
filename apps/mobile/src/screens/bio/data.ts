/* Bio's data: what the progress summary, the series, goals, check-ins, adherence and the coach's notes carry, and the
   small honest calculations the screen makes from them (never an estimate of its own):
   - a metric ring fills to the progress towards an active goal for that metric (start → target, or value / target
     when the goal has no start), or along the metric's own scale for the 1–5 self-ratings and habit adherence;
     every other metric shows its value with an empty ring and the words "No goal";
   - a trend arrow compares the last two values (up, down or level), never a judgement;
   - stats (average, highest, lowest, up/down since the first value) come from the values shown.
   Source wording is the API's ("Self-reported", "From this phone", "Entered by your coach"). */
import { get, qs } from '@/lib/api';
import { dtf, fmtDate, istDate } from '@/lib/format';
import type { AdherenceLine, Checkin, Goal } from '@/lib/modules/progress';
import { formatCount, type IconName } from '@/fx';

export type Source = 'member' | 'coach' | 'device' | 'import';
export type SeriesPoint = { at: string; value: number; source: Source | string; sourceLabel?: string; day?: string; provider?: string | null };
export type SummaryMetric = {
  metric: string; label: string; unit: string; enabled: boolean; min: number | null; max: number | null; daily?: boolean;
  latest: SeriesPoint | null; series: SeriesPoint[];
};
export type Summary = { metrics: SummaryMetric[]; note?: string; programmeCompletion?: number | null; tasks?: { total: number; done: number; skipped: number } };
export type SeriesResponse = { metric: string; label: string; unit: string; from: string; to: string; points: SeriesPoint[]; truncated: boolean; note: string; daily?: boolean };
export type Note = { id: string; kind: string; body: string; created_at: string; coach_name: string | null };
export type Adherence = { from: string; to: string; items: AdherenceLine[]; note: string };
export type { AdherenceLine, Checkin, Goal };

/** The API's own words for each source (GET /me/progress/series `sources`). */
export const SOURCE_LABEL: Record<string, string> = { member: 'Self-reported', coach: 'Entered by your coach', device: 'From a connected device', import: 'Imported' };
/** The API says "From this phone" for steps a phone counted, which is true only on that phone: the app names the source
 *  instead, the same on every device (the web included). */
export const PHONE_APP = 'From the phone app';
export const phoneLabel = (l: string): string => (l === 'From this phone' ? PHONE_APP : l);
export const sourceOf = (p: SeriesPoint): string => phoneLabel(p.sourceLabel ?? SOURCE_LABEL[p.source] ?? 'Logged');

/** Metrics the API keeps one value a day for (PUT /me/progress/daily). */
export const DAILY = new Set(['steps', 'water_ml']);
/** Self-ratings and percentages that carry their own scale. */
const SCALE: Record<string, number> = { energy_1_5: 5, wellbeing_1_5: 5, habit_adherence_pct: 100 };

const ICONS: Record<string, IconName> = {
  weight_kg: 'scale', waist_cm: 'ruler', resting_hr_bpm: 'heart-pulse', sleep_hours: 'moon', steps: 'footprints',
  energy_1_5: 'zap', wellbeing_1_5: 'sun', habit_adherence_pct: 'list-checks', workout_minutes: 'timer', water_ml: 'droplets',
};
export const iconOf = (metric: string): IconName => ICONS[metric] ?? 'activity';

/** A short name for small places (the earlier app's "Resting HR"): "Energy (1–5)" → "Energy". */
const SHORT: Record<string, string> = { 'Resting heart rate': 'Resting HR', 'Workout minutes': 'Workout time', 'Habit adherence': 'Habits done' };
export const shortLabel = (label: string) => { const s = label.replace(/\s*\(.*\)\s*$/, ''); return SHORT[s] ?? s; };

/** The unit as it sits next to a number ("/5" stays tight, "steps" is dropped where the label says it). */
export const unitText = (unit: string) => (unit === 'steps' ? 'steps' : unit);

/** Places to show: the value's own (63.3 → 1, 7999 → 0), at most 2. */
export function decimalsOf(v: number): number {
  if (Number.isInteger(v)) return 0;
  const s = String(v);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : Math.min(2, s.length - dot - 1);
}
export const fmtValue = (v: number) => formatCount(v, decimalsOf(v));

/** The day a value belongs to, as "30 Oct" (the API's India day for daily totals). */
export function dayOf(p: SeriesPoint): string {
  if (p.day) return dtf({ day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(`${p.day}T06:30:00Z`));
  return dtf({ day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(p.at));
}
export const isToday = (p: SeriesPoint) => (p.day ?? istDayOf(p.at)) === istDate(0);
export function istDayOf(iso: string): string {
  return new Date(new Date(iso).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
}
export const weekdayOf = (p: SeriesPoint) => dtf({ weekday: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(p.day ? `${p.day}T06:30:00Z` : p.at));

/** Goals a value the member just logged has reached (LogValue): the first card that shows one plays its done moment
 *  once (takeJustReached), wherever it is next seen (Bio's goals, /goals). Memory only. */
const justReached = new Set<string>();
export function noteJustReached(ids: string[]): void { for (const id of ids) justReached.add(id); }
export function takeJustReached(id: string): boolean { return justReached.delete(id); }

/** The member's active goal for a metric (the first, as the API orders them). */
export function goalFor(goals: Goal[] | null | undefined, metric: string): Goal | null {
  return goals?.find((g) => g.status === 'active' && g.metric === metric && g.targetValue != null) ?? null;
}

/** 0..1 towards the goal's target from its start (or from 0 when it has none). */
export function goalProgress(g: Goal, latest: number): number {
  const target = g.targetValue as number;
  const base = g.baselineValue;
  const raw = base != null && base !== target ? (latest - base) / (target - base) : target > 0 ? latest / target : 0;
  return Math.max(0, Math.min(1, raw));
}

export type Ring = { fill: number | null; max: number; kind: 'goal' | 'scale' | 'none'; reached: boolean; goal: Goal | null };

/** What a metric's ring shows (see the header). */
export function ringFor(m: SummaryMetric, goals: Goal[] | null | undefined): Ring {
  const v = m.latest?.value;
  const goal = goalFor(goals, m.metric);
  if (v == null) return { fill: null, max: 1, kind: goal ? 'goal' : 'none', reached: false, goal };
  if (goal) { const p = goalProgress(goal, v); return { fill: p, max: 1, kind: 'goal', reached: p >= 1, goal }; }
  const scale = SCALE[m.metric];
  if (scale) return { fill: Math.max(0, Math.min(1, v / scale)), max: 1, kind: 'scale', reached: false, goal: null };
  return { fill: null, max: 1, kind: 'none', reached: false, goal: null };
}

export type Direction = 'up' | 'down' | 'level';
/** The last value against the one before it. */
export function lastMove(series: SeriesPoint[]): Direction | null {
  if (series.length < 2) return null;
  const a = series[series.length - 2].value, b = series[series.length - 1].value;
  return b > a ? 'up' : b < a ? 'down' : 'level';
}
export const moveIcon = (d: Direction): IconName => (d === 'up' ? 'trending-up' : d === 'down' ? 'trending-down' : 'minus');

export type Stats = { n: number; average: number; highest: number; lowest: number; first: SeriesPoint; last: SeriesPoint; change: number };
export function statsOf(points: SeriesPoint[]): Stats | null {
  if (!points.length) return null;
  const values = points.map((p) => p.value);
  const sum = values.reduce((a, b) => a + b, 0);
  const round = (x: number) => Math.round(x * 10) / 10;
  return {
    n: points.length, average: round(sum / values.length), highest: Math.max(...values), lowest: Math.min(...values),
    first: points[0], last: points[points.length - 1], change: round(points[points.length - 1].value - points[0].value),
  };
}

/** "Down 1.4 kg since 5 Sep" / "Level since 5 Sep": a fact about the values, never "improving". */
export function changeText(s: Stats, unit: string): string {
  if (s.n < 2) return `One value, ${dayOf(s.first)}`;
  if (s.change === 0) return `Level since ${dayOf(s.first)}`;
  return `${s.change > 0 ? 'Up' : 'Down'} ${fmtValue(Math.abs(s.change))} ${unitText(unit)} since ${dayOf(s.first)}`;
}

export const RANGES = [{ value: '7', label: '7d', days: 7 }, { value: '30', label: '30d', days: 30 }, { value: '90', label: '90d', days: 90 }, { value: '365', label: '1y', days: 365 }] as const;
export type RangeKey = (typeof RANGES)[number]['value'];

export function loadSeries(metric: string, days: number): Promise<SeriesResponse> {
  return get(`/me/progress/series${qs({ metric, from: istDate(-(days - 1)), to: istDate(0) })}`);
}

/** The coach's latest words for Bio's insight card: a reviewed check-in's reply or a client-visible note, the newer. */
export type Insight = { text: string; who: string | null; at: string; open: { kind: 'checkin'; id: string } | { kind: 'notes' } };
export function latestInsight(checkins: Checkin[] | null | undefined, notes: Note[] | null | undefined): Insight | null {
  const replies = (checkins ?? []).filter((c) => c.status === 'reviewed' && c.response && c.reviewedAt)
    .map((c): Insight => ({ text: c.response as string, who: c.reviewedByName ?? c.coachName, at: c.reviewedAt as string, open: { kind: 'checkin', id: c.id } }));
  const fromNotes = (notes ?? []).filter((n) => n.body?.trim())
    .map((n): Insight => ({ text: n.body, who: n.coach_name, at: n.created_at, open: { kind: 'notes' } }));
  return [...replies, ...fromNotes].sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
}

/** The newest values across the metrics, for "Latest entries" (what Home's "Logged recently" showed). The same value of
 *  the same metric on the same day shows once (a check-in's answer is also logged as a value). */
export function latestEntries(metrics: SummaryMetric[], n = 4): Array<{ m: SummaryMetric; p: SeriesPoint }> {
  const seen = new Set<string>();
  return metrics.flatMap((m) => m.series.map((p) => ({ m, p }))).sort((a, b) => b.p.at.localeCompare(a.p.at)).filter(({ m, p }) => {
    const k = `${m.metric}|${p.day ?? istDayOf(p.at)}|${p.value}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, n);
}

export const whenText = (p: SeriesPoint) => (isToday(p) ? 'Today' : dayOf(p));
export { fmtDate };
