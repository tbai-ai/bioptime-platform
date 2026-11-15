/* M1 Habits and reminders: the shared vocabulary and the pure rules (no I/O), imported as
   '@bioptime/domain/modules/habits' by the API and its unit tests.

   Dates here are the member's local calendar dates (YYYY-MM-DD); the API turns instants into local dates with the
   member's timezone before calling these. Weekdays follow ISO 8601: 1 = Monday … 7 = Sunday.

   Schedules:
   - daily: due every day;
   - weekdays: due on the chosen weekdays;
   - times_per_week: no fixed days. Any day of an ISO week (Monday to Sunday) counts towards the week's target.

   Nothing here sets a default reminder time or a follow-up threshold (the coach, the member or the owner chooses them),
   and nothing turns completion into a health claim: adherence and streaks describe check-ins, nothing more. */
import { z } from 'zod';

/* ---------- vocabulary ---------- */

/** The plan editor's task kinds (portal/pages/PlanEditor.tsx). */
export const HABIT_KINDS = ['training', 'movement', 'nutrition', 'sleep', 'habit', 'recovery', 'reflection'] as const;
export type HabitKind = (typeof HABIT_KINDS)[number];
export const HABIT_STATUSES = ['active', 'paused', 'archived'] as const;
export type HabitStatus = (typeof HABIT_STATUSES)[number];
export const HABIT_CHECKIN_STATUSES = ['done', 'skipped'] as const;
export type HabitCheckinStatus = (typeof HABIT_CHECKIN_STATUSES)[number];
export const HABIT_SCHEDULE_TYPES = ['daily', 'weekdays', 'times_per_week'] as const;

/** At most this many reminder times per habit (a validation limit, not a suggestion). */
export const MAX_REMINDER_TIMES = 4;
/** A check-in may be recorded for today or up to this many days back. */
export const CHECKIN_BACKFILL_DAYS = 7;
/** At most this many habits that are not archived, per member. */
export const MAX_OPEN_HABITS = 20;

export const WEEKDAY_SHORT: Record<number, string> = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun' };

export type HabitSchedule =
  | { type: 'daily' }
  | { type: 'weekdays'; weekdays: number[] }
  | { type: 'times_per_week'; timesPerWeek: number };

/* ---------- dates ---------- */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date in YYYY-MM-DD form (2026-02-30 is not). */
export function isRealDate(s: unknown): s is string {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** The date n days after (or before, n < 0) a date. */
export function addDaysToDate(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Days from a to b (b − a), whole days. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** The Monday of the ISO week a date falls in. */
export function weekStart(date: string): string {
  return addDaysToDate(date, 1 - isoWeekday(date));
}

/** Every date from `from` to `to`, both included; empty when from is after to. Capped at ten years of days. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  if (!isRealDate(from) || !isRealDate(to) || from > to) return out;
  for (let d = from, i = 0; d <= to && i < 3660; d = addDaysToDate(d, 1), i++) out.push(d);
  return out;
}

/* ---------- schedules ---------- */

/** Does the schedule name fixed days (daily, weekdays)? A times-per-week habit has none. */
export function hasFixedDays(schedule: HabitSchedule): boolean {
  return schedule.type !== 'times_per_week';
}

/** Is a fixed-day habit due on this date? A times-per-week habit is open on every day (it counts towards the week). */
export function isDueOn(schedule: HabitSchedule, date: string): boolean {
  if (schedule.type === 'daily' || schedule.type === 'times_per_week') return true;
  return schedule.weekdays.includes(isoWeekday(date));
}

/** The dates in [from, to] on which a habit with this schedule is due. A times-per-week habit has no fixed days, so
 *  this is empty for it; its target is per ISO week (see adherence and weekProgress). */
export function dueDates(schedule: HabitSchedule, from: string, to: string): string[] {
  if (!hasFixedDays(schedule)) return [];
  return datesBetween(from, to).filter((d) => isDueOn(schedule, d));
}

/** Sorted, de-duplicated weekdays; the canonical form stored. */
export function normaliseSchedule(s: HabitSchedule): HabitSchedule {
  if (s.type === 'weekdays') return { type: 'weekdays', weekdays: [...new Set(s.weekdays)].sort((a, b) => a - b) };
  if (s.type === 'times_per_week') return { type: 'times_per_week', timesPerWeek: s.timesPerWeek };
  return { type: 'daily' };
}

/** How a schedule reads: "Every day", "Mon, Wed, Fri", "3 times a week". */
export function scheduleLabel(s: HabitSchedule): string {
  if (s.type === 'daily') return 'Every day';
  if (s.type === 'weekdays') return s.weekdays.length === 7 ? 'Every day' : s.weekdays.map((w) => WEEKDAY_SHORT[w]).join(', ');
  return s.timesPerWeek === 1 ? 'Once a week' : `${s.timesPerWeek} times a week`;
}

/* ---------- the habit's active span ---------- */

/** When a habit counts: from its start to its end (if any), without paused days or the days after it was archived. */
export type HabitSpan = {
  startDate: string;
  endDate: string | null;
  /** closed pauses, both ends included */
  pausedRanges: Array<{ from: string; to: string }>;
  /** an open pause: every date from here on is paused */
  pausedSince: string | null;
  /** archived on this date: it and later dates no longer count */
  archivedOn: string | null;
};

export function isActiveOn(span: HabitSpan, date: string): boolean {
  if (date < span.startDate) return false;
  if (span.endDate && date > span.endDate) return false;
  if (span.archivedOn && date >= span.archivedOn) return false;
  if (span.pausedSince && date >= span.pausedSince) return false;
  return !span.pausedRanges.some((r) => date >= r.from && date <= r.to);
}

/** The closed pause a resume records, or null when the pause began today (nothing to record). */
export function closePause(pausedSince: string, resumedOn: string): { from: string; to: string } | null {
  const to = addDaysToDate(resumedOn, -1);
  return to >= pausedSince ? { from: pausedSince, to } : null;
}

/* ---------- check-ins, adherence, streaks ---------- */

export type CheckinLite = { date: string; status: HabitCheckinStatus };

function byDate(checkins: CheckinLite[]): Map<string, HabitCheckinStatus> {
  return new Map(checkins.map((c) => [c.date, c.status]));
}

export type Adherence = { due: number; done: number; pct: number | null };

/** Due and done between two dates, counting only what is settled by `today`:
 *  - fixed days: each due, active day up to yesterday counts; today counts once it has a check-in. Done means a
 *    check-in with status done on a due day (a check-in on any other day is not counted).
 *  - times per week: each ISO week contributes min(target, its active days in the range). A finished week counts as it
 *    stands; the current week counts only once its target is met. Done is capped at what the week asked for.
 *  pct is null when nothing was due. */
export function adherence(schedule: HabitSchedule, span: HabitSpan, checkins: CheckinLite[], from: string, to: string, today: string): Adherence {
  const status = byDate(checkins);
  const end = to < today ? to : today;
  let due = 0, done = 0;
  if (hasFixedDays(schedule)) {
    for (const d of dueDates(schedule, from, end)) {
      if (!isActiveOn(span, d)) continue;
      if (d === today && !status.has(d)) continue; // today is not over
      due++;
      if (status.get(d) === 'done') done++;
    }
  } else {
    const target = (schedule as { timesPerWeek: number }).timesPerWeek;
    const weeks = new Map<string, { active: number; done: number }>();
    for (const d of datesBetween(from, end)) {
      if (!isActiveOn(span, d)) continue;
      const w = weekStart(d);
      const cur = weeks.get(w) ?? { active: 0, done: 0 };
      cur.active++;
      if (status.get(d) === 'done') cur.done++;
      weeks.set(w, cur);
    }
    const thisWeek = weekStart(today);
    for (const [w, x] of weeks) {
      const asked = Math.min(target, x.active);
      if (w === thisWeek && x.done < target) continue; // the current week is not settled until its target is met
      due += asked;
      done += Math.min(x.done, asked);
    }
  }
  return { due, done, pct: due ? Math.round((done / due) * 100) : null };
}

/** Progress in today's ISO week: fixed days count done due days against the due days of the week; times per week
 *  counts done days against the target. */
export function weekProgress(schedule: HabitSchedule, span: HabitSpan, checkins: CheckinLite[], today: string): { done: number; target: number } {
  const from = weekStart(today), to = addDaysToDate(from, 6);
  const status = byDate(checkins);
  if (hasFixedDays(schedule)) {
    const days = dueDates(schedule, from, to).filter((d) => isActiveOn(span, d));
    return { done: days.filter((d) => status.get(d) === 'done').length, target: days.length };
  }
  const active = datesBetween(from, to).filter((d) => isActiveOn(span, d));
  return { done: active.filter((d) => status.get(d) === 'done').length, target: Math.min((schedule as { timesPerWeek: number }).timesPerWeek, active.length) };
}

/** Due days without any check-in (done or skipped), counted back from yesterday until the last check-in; a check-in
 *  today means the member is back (0). Paused days and days outside the span are passed over.
 *  For a times-per-week habit the slots of each finished ISO week with no check-in at all are counted (min(target,
 *  the week's active days)), back to the last week that had a check-in; a check-in this week means 0.
 *  This feeds the coach follow-up (the owner's habit_followup_missed_days); it is a count, not a judgement. */
export function missedDueDays(schedule: HabitSchedule, span: HabitSpan, checkins: CheckinLite[], today: string, limitDays = 400): number {
  const status = byDate(checkins);
  if (hasFixedDays(schedule)) {
    if (status.has(today)) return 0;
    let missed = 0;
    for (let i = 1, d = addDaysToDate(today, -1); i <= limitDays && d >= span.startDate; i++, d = addDaysToDate(d, -1)) {
      if (!isDueOn(schedule, d) || !isActiveOn(span, d)) continue;
      if (status.has(d)) break;
      missed++;
    }
    return missed;
  }
  const target = (schedule as { timesPerWeek: number }).timesPerWeek;
  const thisWeek = weekStart(today);
  if (datesBetween(thisWeek, today).some((d) => status.has(d))) return 0;
  let missed = 0;
  for (let w = addDaysToDate(thisWeek, -7), i = 0; i * 7 <= limitDays && addDaysToDate(w, 6) >= span.startDate; w = addDaysToDate(w, -7), i++) {
    const days = datesBetween(w, addDaysToDate(w, 6));
    if (days.some((d) => status.has(d))) break;
    const active = days.filter((d) => isActiveOn(span, d)).length;
    missed += Math.min(target, active);
  }
  return missed;
}

/** A descriptive streak: due days in a row checked in as done (fixed days; today joins once done, a skipped day ends
 *  it, paused days are passed over), or ISO weeks in a row that met their target (times per week; this week joins once
 *  met). It describes the record; it promises nothing. */
export function streak(schedule: HabitSchedule, span: HabitSpan, checkins: CheckinLite[], today: string, limitDays = 400): { count: number; unit: 'days' | 'weeks' } {
  const status = byDate(checkins);
  if (hasFixedDays(schedule)) {
    let count = 0;
    for (let i = 0, d = today; i <= limitDays && d >= span.startDate; i++, d = addDaysToDate(d, -1)) {
      if (!isDueOn(schedule, d) || !isActiveOn(span, d)) continue;
      const s = status.get(d);
      if (d === today && !s) continue; // today is not over
      if (s !== 'done') break;
      count++;
    }
    return { count, unit: 'days' };
  }
  const target = (schedule as { timesPerWeek: number }).timesPerWeek;
  let count = 0;
  const thisWeek = weekStart(today);
  for (let w = thisWeek, i = 0; i * 7 <= limitDays && addDaysToDate(w, 6) >= span.startDate; w = addDaysToDate(w, -7), i++) {
    const days = datesBetween(w, w === thisWeek ? today : addDaysToDate(w, 6));
    const active = days.filter((d) => isActiveOn(span, d)).length;
    const doneDays = days.filter((d) => status.get(d) === 'done').length;
    if (w === thisWeek) { if (doneDays >= target) count++; continue; }
    if (!active) continue; // a fully paused week neither counts nor breaks
    if (doneDays >= Math.min(target, active)) count++;
    else break;
  }
  return { count, unit: 'weeks' };
}

export type DayCell = { date: string; weekday: number; due: boolean; status: HabitCheckinStatus | 'missed' | 'open' | 'off' };

/** The last n days ending today, for the small history strip: done, skipped, missed (a past due day without a
 *  check-in), open (today, not checked in yet) or off (not due, paused or outside the span). For a times-per-week habit
 *  no single day is missed; a day without a check-in reads off. */
export function recentDays(schedule: HabitSchedule, span: HabitSpan, checkins: CheckinLite[], today: string, n = 7): DayCell[] {
  const status = byDate(checkins);
  const out: DayCell[] = [];
  for (const d of datesBetween(addDaysToDate(today, -(n - 1)), today)) {
    const active = isActiveOn(span, d);
    const due = active && hasFixedDays(schedule) && isDueOn(schedule, d);
    const s = status.get(d);
    out.push({ date: d, weekday: isoWeekday(d), due, status: s ?? (!due ? 'off' : d === today ? 'open' : 'missed') });
  }
  return out;
}

/* ---------- payload schemas ----------
   Strict: a field the caller may not send (a coach sending reminder times, a member sending a plan) is refused by
   name instead of being dropped silently. */

const dateSchema = z.string().refine(isRealDate, 'Use a real date, YYYY-MM-DD');
export const reminderTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time, HH:MM');
export const reminderTimesSchema = z.array(reminderTimeSchema).max(MAX_REMINDER_TIMES, `At most ${MAX_REMINDER_TIMES} reminder times`).transform((a) => [...new Set(a)].sort());

export const habitScheduleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('daily') }).strict(),
  z.object({ type: z.literal('weekdays'), weekdays: z.array(z.number().int().min(1).max(7)).min(1, 'Choose at least one day').max(7) }).strict(),
  z.object({ type: z.literal('times_per_week'), timesPerWeek: z.number().int().min(1).max(7) }).strict(),
]).transform((s) => normaliseSchedule(s as HabitSchedule));

const habitFields = {
  title: z.string().trim().min(2, 'Give the habit a short name').max(120),
  detail: z.string().trim().max(1000),
  kind: z.enum(HABIT_KINDS),
  schedule: habitScheduleSchema,
  targetLabel: z.string().trim().max(80).nullable(),
  reminderTimes: reminderTimesSchema,
  remindersOn: z.boolean(),
  startDate: dateSchema,
  endDate: dateSchema.nullable(),
};

const datesInOrder = (v: { startDate?: string; endDate?: string | null }) => !v.startDate || !v.endDate || v.endDate >= v.startDate;

/** A member's own habit. */
export const memberHabitCreateSchema = z.object({
  title: habitFields.title,
  detail: habitFields.detail.optional(),
  kind: habitFields.kind.default('habit'),
  schedule: habitFields.schedule,
  targetLabel: habitFields.targetLabel.optional(),
  reminderTimes: habitFields.reminderTimes.optional(),
  remindersOn: habitFields.remindersOn.optional(),
  startDate: habitFields.startDate.optional(),
  endDate: habitFields.endDate.optional(),
}).strict().refine(datesInOrder, { message: 'The end date comes after the start date', path: ['endDate'] });

/** A coach's habit for an assigned client; it may point at one of the client's plans. */
export const coachHabitCreateSchema = z.object({
  title: habitFields.title,
  detail: habitFields.detail.optional(),
  kind: habitFields.kind.default('habit'),
  schedule: habitFields.schedule,
  targetLabel: habitFields.targetLabel.optional(),
  reminderTimes: habitFields.reminderTimes.optional(),
  remindersOn: habitFields.remindersOn.optional(),
  startDate: habitFields.startDate.optional(),
  endDate: habitFields.endDate.optional(),
  planId: z.string().trim().min(1).max(40).nullable().optional(),
}).strict().refine(datesInOrder, { message: 'The end date comes after the start date', path: ['endDate'] });

/** The fields a member may change on a habit a coach set. */
export const REMINDER_FIELDS = ['reminderTimes', 'remindersOn'] as const;

/** A member changing a habit: anything on their own; only the reminder fields on one a coach set (the API enforces it). */
export const memberHabitUpdateSchema = z.object({
  title: habitFields.title.optional(),
  detail: habitFields.detail.optional(),
  kind: habitFields.kind.optional(),
  schedule: habitFields.schedule.optional(),
  targetLabel: habitFields.targetLabel.optional(),
  reminderTimes: habitFields.reminderTimes.optional(),
  remindersOn: habitFields.remindersOn.optional(),
  endDate: habitFields.endDate.optional(),
  status: z.enum(HABIT_STATUSES).optional(),
}).strict();

/** A coach changing a habit they (or another coach) set for an assigned client; archiving has its own route. */
export const coachHabitUpdateSchema = z.object({
  title: habitFields.title.optional(),
  detail: habitFields.detail.optional(),
  kind: habitFields.kind.optional(),
  schedule: habitFields.schedule.optional(),
  targetLabel: habitFields.targetLabel.optional(),
  endDate: habitFields.endDate.optional(),
  planId: z.string().trim().min(1).max(40).nullable().optional(),
  status: z.enum(['active', 'paused']).optional(),
  reason: z.string().trim().max(500).optional(),
}).strict();

export const habitCheckinSchema = z.object({
  date: dateSchema.optional(),
  status: z.enum(HABIT_CHECKIN_STATUSES),
  note: z.string().trim().max(500).optional(),
}).strict();

export const habitArchiveSchema = z.object({ reason: z.string().trim().min(3, 'Say why, in a few words').max(500) });
