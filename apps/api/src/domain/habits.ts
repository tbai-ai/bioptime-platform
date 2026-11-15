/* M1 Habits and reminders: recurring habits with schedules, one check-in per local day, reminders through the
   foundation's queue, and a coach follow-up when a habit slips (only once the owner has chosen a threshold).

   Who may do what (the routes check the role first; these functions check the record):
   - a member: their own habits in full; on a habit a coach set, only its reminder times and the reminder switch; check
     in and undo on any of their habits that is active;
   - a coach: for an assigned client, write habits, change the ones a coach set, pause, resume and archive them; see
     the habits a coach set and their completion (as plan tasks are visible); see the habits the member wrote
     themselves, and read check-in notes, only while the member shares health information (coach_sharing);
   - an administrator holding members.manage: read a member's habits.

   Dates are the member's local dates (member_profiles.timezone, India when unknown); the pure rules (due days,
   adherence, streaks, missed days) live in @bioptime/domain/modules/habits. Nothing here sets a default reminder time
   or threshold, and nothing turns completion into a health claim. */
import type { Ctx } from '../context.js';
import { j } from '../db/db.js';
import { randomId } from '../lib/ids.js';
import { errors } from '../lib/errors.js';
import { IST_OFFSET_MINUTES, dateInZone } from '../lib/time.js';
import { coachHasMember } from '../auth/permissions.js';
import { audit } from './audit.js';
import { notify } from './notifications.js';
import { getSetting } from './settings.js';
import { openTask, updateTask } from './support.js';
import { activeCoachFor } from './assignments.js';
import * as reminders from './reminders.js';
import {
  CHECKIN_BACKFILL_DAYS, MAX_OPEN_HABITS, REMINDER_FIELDS,
  addDaysToDate, adherence, closePause, datesBetween, hasFixedDays, isActiveOn, isDueOn, missedDueDays, recentDays,
  scheduleLabel, streak, weekProgress, weekStart,
  type CheckinLite, type HabitCheckinStatus, type HabitKind, type HabitSchedule, type HabitSpan, type HabitStatus,
} from '@bioptime/domain/modules/habits';

export const HABIT_REF = 'habit';
export const HABIT_REMINDER_CATEGORY = 'habit_reminder';
const habitId = () => randomId('hab');
const checkinId = () => randomId('hck');

type HabitRow = {
  id: string; member_id: string; coach_id: string | null; plan_id: string | null; title: string; detail: string; kind: HabitKind;
  schedule: string; target_label: string | null; reminder_times: string; reminders_on: number; status: HabitStatus;
  start_date: string; end_date: string | null; paused_since: string | null; pause_log: string; archived_on: string | null; archived_at: string | null;
  created_by: string; created_by_role: 'member' | 'coach'; created_at: string; updated_at: string;
};
type CheckinRow = { id: string; habit_id: string; member_id: string; date: string; status: HabitCheckinStatus; note: string | null; created_at: string; updated_at: string };

/* ---------- time in the member's zone ---------- */

export function memberTimezone(ctx: Ctx, memberId: string): string { return reminders.timezoneOf(ctx, memberId); }

/** The local calendar date of an instant in a named zone (India when the zone is unknown). */
export function localDate(iso: string, timeZone: string): string {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)); }
  catch { return dateInZone(iso, IST_OFFSET_MINUTES); }
}

/** Minutes the zone is ahead of UTC at an instant. */
function zoneOffsetMinutes(iso: string, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
    const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const wall = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
    const at = Math.floor(Date.parse(iso) / 1000) * 1000;
    if (Number.isFinite(wall)) return Math.round((wall - at) / 60_000);
  } catch { /* unknown zone */ }
  return IST_OFFSET_MINUTES;
}

/** The instant of a local date and "HH:MM" in a named zone (the first such instant across a clock change). */
export function localTimeToIso(date: string, hhmm: string, timeZone: string): string {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const wall = Date.parse(`${date}T00:00:00Z`) + (h * 60 + m) * 60_000;
  let guess = wall - zoneOffsetMinutes(new Date(wall).toISOString(), timeZone) * 60_000;
  guess = wall - zoneOffsetMinutes(new Date(guess).toISOString(), timeZone) * 60_000; // settle across an offset change
  return new Date(guess).toISOString();
}

export function todayFor(ctx: Ctx, memberId: string): string { return localDate(ctx.now(), memberTimezone(ctx, memberId)); }

/* ---------- reading ---------- */

function schedOf(h: HabitRow): HabitSchedule { return j.out<HabitSchedule>(h.schedule, { type: 'daily' }); }
function timesOf(h: HabitRow): string[] { return j.out<string[]>(h.reminder_times, []); }
function spanOf(h: HabitRow): HabitSpan {
  return { startDate: h.start_date, endDate: h.end_date, pausedRanges: j.out<Array<{ from: string; to: string }>>(h.pause_log, []), pausedSince: h.paused_since, archivedOn: h.archived_on };
}

export function getHabitRow(ctx: Ctx, id: string): HabitRow | undefined {
  return ctx.db.get<HabitRow>('SELECT * FROM habits WHERE id = ?', [id]);
}

/** Does the member currently share health information with their coach? The latest coach_sharing record decides; no
 *  record is no consent (the same rule as requireHealthAccess). */
export function healthShared(ctx: Ctx, memberId: string): boolean {
  const consent = ctx.db.get<{ granted: number }>("SELECT granted FROM member_consents WHERE user_id = ? AND kind = 'coach_sharing' ORDER BY at DESC LIMIT 1", [memberId]);
  return !!consent?.granted;
}

function checkinsFor(ctx: Ctx, habitIds: string[], from: string): Map<string, CheckinRow[]> {
  const out = new Map<string, CheckinRow[]>(habitIds.map((id) => [id, []]));
  if (!habitIds.length) return out;
  const rows = ctx.db.all<CheckinRow>(`SELECT * FROM habit_checkins WHERE habit_id IN (${habitIds.map(() => '?').join(', ')}) AND date >= ? ORDER BY date DESC`, [...habitIds, from]);
  for (const r of rows) out.get(r.habit_id)?.push(r);
  return out;
}

/** How far back check-ins are read for streaks and missed days. */
const HISTORY_DAYS = 400;

type PresentOpts = { today: string; notes: boolean; days?: number };

/** One habit as every surface shows it. Notes appear only when `notes` is true (the member, an administrator, or a
 *  coach while coach_sharing is granted). */
function present(h: HabitRow, checkins: CheckinRow[], o: PresentOpts) {
  const schedule = schedOf(h), span = spanOf(h);
  const lite: CheckinLite[] = checkins.map((c) => ({ date: c.date, status: c.status }));
  const todays = checkins.find((c) => c.date === o.today);
  return {
    id: h.id, memberId: h.member_id, coachId: h.coach_id, planId: h.plan_id,
    title: h.title, detail: h.detail, kind: h.kind, schedule, scheduleLabel: scheduleLabel(schedule), targetLabel: h.target_label,
    reminderTimes: timesOf(h), remindersOn: !!h.reminders_on, status: h.status,
    startDate: h.start_date, endDate: h.end_date, pausedSince: h.paused_since, archivedAt: h.archived_at,
    setBy: h.created_by_role, createdAt: h.created_at, updatedAt: h.updated_at,
    today: {
      date: o.today,
      // fixed days: due today; times per week: open every active day until the week's target is met
      due: h.status === 'active' && isActiveOn(span, o.today) && isDueOn(schedule, o.today),
      checkin: todays ? { status: todays.status, ...(o.notes ? { note: todays.note } : {}), at: todays.updated_at } : null,
    },
    week: weekProgress(schedule, span, lite, o.today),
    streak: streak(schedule, span, lite, o.today),
    recent: recentDays(schedule, span, lite, o.today, o.days ?? 7),
  };
}

function presentCheckin(c: CheckinRow, notes: boolean) {
  return { id: c.id, habitId: c.habit_id, date: c.date, status: c.status, ...(notes ? { note: c.note } : {}), createdAt: c.created_at, updatedAt: c.updated_at };
}

/** The member's habits (archived ones only when asked), with today's check-in, this week, the streak and the last days. */
export function listForMember(ctx: Ctx, memberId: string, opts: { includeArchived?: boolean } = {}) {
  const tz = memberTimezone(ctx, memberId);
  const today = localDate(ctx.now(), tz);
  const rows = ctx.db.all<HabitRow>(`SELECT * FROM habits WHERE member_id = ? ${opts.includeArchived ? '' : "AND status != 'archived'"} ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, created_at`, [memberId]);
  const byHabit = checkinsFor(ctx, rows.map((r) => r.id), addDaysToDate(today, -HISTORY_DAYS));
  const items = rows.map((h) => present(h, byHabit.get(h.id) ?? [], { today, notes: true }));
  return {
    today, timezone: tz, items,
    dueToday: items.filter((i) => i.today.due && !i.today.checkin).length,
    note: 'Check-ins are what you record. Streaks and weekly counts describe them; they are not a health measure.',
    delivery: { push: 'logged', detail: 'Reminders appear in your Bioptime notifications.' },
    demo: ctx.config.isDemo,
  };
}

/** One habit as its member sees it (after a write). */
export function habitView(ctx: Ctx, h: HabitRow, notes: boolean) {
  const today = todayFor(ctx, h.member_id);
  return present(h, checkinsFor(ctx, [h.id], addDaysToDate(today, -HISTORY_DAYS)).get(h.id) ?? [], { today, notes });
}

/** Weekly adherence for the last `weeks` ISO weeks and the current one, per habit and across them. */
function weekly(h: HabitRow, lite: CheckinLite[], today: string, weeks: number) {
  const schedule = schedOf(h), span = spanOf(h);
  const out: Array<{ weekStart: string; due: number; done: number; pct: number | null; current: boolean }> = [];
  const thisWeek = weekStart(today);
  for (let i = weeks; i >= 0; i--) {
    const from = addDaysToDate(thisWeek, -7 * i);
    const a = adherence(schedule, span, lite, from, addDaysToDate(from, 6), today);
    out.push({ weekStart: from, ...a, current: i === 0 });
  }
  return out;
}

/** What a coach (or an administrator) sees of a member's habits: definitions, completion, weekly adherence, the open
 *  follow-up per habit, and the last four weeks of check-ins. The habits a coach set are always listed (as plan tasks
 *  are); the habits the member wrote themselves only when `memberWritten` is true, and check-in notes only when
 *  `notes` is true. For a coach both follow coach_sharing; an administrator holding members.manage sees both. The
 *  weekly sums cover only the habits listed. */
export function teamView(ctx: Ctx, memberId: string, opts: { notes: boolean; memberWritten: boolean; viewerCoachId?: string }) {
  const tz = memberTimezone(ctx, memberId);
  const today = localDate(ctx.now(), tz);
  const rows = ctx.db.all<HabitRow>(`SELECT * FROM habits WHERE member_id = ? ${opts.memberWritten ? '' : "AND created_by_role = 'coach'"} ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, created_at`, [memberId]);
  const byHabit = checkinsFor(ctx, rows.map((r) => r.id), addDaysToDate(today, -HISTORY_DAYS));
  const since = addDaysToDate(today, -27);
  const followUps = rows.length ? ctx.db.all<{ id: string; ref_id: string; status: string; owner_id: string | null; created_at: string }>(`SELECT id, ref_id, status, owner_id, created_at FROM support_tasks WHERE kind = 'coach_follow_up' AND ref_type = ? AND ref_id IN (${rows.map(() => '?').join(', ')}) AND status IN ('open','in_progress') ORDER BY created_at DESC`, [HABIT_REF, ...rows.map((r) => r.id)]) : [];
  const habits = rows.map((h) => {
    const list = byHabit.get(h.id) ?? [];
    const lite = list.map((c) => ({ date: c.date, status: c.status }));
    const fu = followUps.find((f) => f.ref_id === h.id && (!opts.viewerCoachId || f.owner_id === opts.viewerCoachId));
    return {
      ...present(h, list, { today, notes: opts.notes, days: 14 }),
      weekly: weekly(h, lite, today, 4),
      missedDueDays: h.status === 'active' ? missedDueDays(schedOf(h), spanOf(h), lite, today) : 0,
      followUp: fu ? { id: fu.id, status: fu.status, createdAt: fu.created_at } : null,
      checkins: list.filter((c) => c.date >= since).map((c) => presentCheckin(c, opts.notes)),
    };
  });
  // across habits: the sums of the per-habit weeks (no composite score)
  const overall = habits.length ? habits[0]!.weekly.map((w, i) => {
    const due = habits.reduce((s, x) => s + x.weekly[i]!.due, 0), done = habits.reduce((s, x) => s + x.weekly[i]!.done, 0);
    return { weekStart: w.weekStart, due, done, pct: due ? Math.round((done / due) * 100) : null, current: w.current };
  }) : [];
  return {
    today, timezone: tz, habits, weekly: overall, notesShared: opts.notes, memberHabitsShared: opts.memberWritten,
    followUpThreshold: getSetting<number | null>(ctx, 'habit_followup_missed_days'),
    note: 'Completion is what the member recorded. Habits the member added themselves, and their check-in notes, follow their health-sharing choice.',
    demo: ctx.config.isDemo,
  };
}

/* ---------- writing ---------- */

type Who = { role: 'member' | 'coach'; id: string };

export type HabitInput = {
  title: string; detail?: string; kind?: HabitKind; schedule: HabitSchedule; targetLabel?: string | null;
  reminderTimes?: string[]; remindersOn?: boolean; startDate?: string; endDate?: string | null; planId?: string | null;
};

function checkDates(today: string, startDate: string, endDate: string | null, opts: { seed?: boolean }) {
  if (!opts.seed) {
    if (startDate < addDaysToDate(today, -CHECKIN_BACKFILL_DAYS)) throw errors.validation([{ path: 'startDate', message: `Start today or within the last ${CHECKIN_BACKFILL_DAYS} days` }], `startDate: start today or within the last ${CHECKIN_BACKFILL_DAYS} days`);
    if (startDate > addDaysToDate(today, 366)) throw errors.validation([{ path: 'startDate', message: 'Start within the next year' }], 'startDate: start within the next year');
  }
  if (endDate && endDate < startDate) throw errors.validation([{ path: 'endDate', message: 'The end date comes after the start date' }], 'endDate: the end date comes after the start date');
}

function checkPlan(ctx: Ctx, memberId: string, planId: string | null | undefined): string | null {
  if (!planId) return null;
  const p = ctx.db.get<{ member_id: string }>('SELECT member_id FROM coaching_plans WHERE id = ?', [planId]);
  if (!p || p.member_id !== memberId) throw errors.validation([{ path: 'planId', message: 'Choose one of this client’s plans' }], 'planId: choose one of this client’s plans');
  return planId;
}

/** Create a habit: a member's own (by member) or one a coach sets for an assigned client (by coach). Audited
 *  habit.create; reminders are queued at once when switched on. */
export function createHabit(ctx: Ctx, memberId: string, by: Who, input: HabitInput, opts: { seed?: boolean } = {}) {
  if (by.role === 'member' && by.id !== memberId) throw errors.forbidden('You can only add habits to your own account', 'NO_ACCESS');
  if (by.role === 'coach' && !coachHasMember(ctx, by.id, memberId)) throw errors.forbidden('Not your client', 'NO_ACCESS');
  const member = ctx.db.get<{ role: string; state: string }>('SELECT role, state FROM users WHERE id = ?', [memberId]);
  if (!member || member.role !== 'member') throw errors.notFound('Member');
  const open = ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM habits WHERE member_id = ? AND status != 'archived'", [memberId])!.n;
  if (open >= MAX_OPEN_HABITS) throw errors.state(`A member can have up to ${MAX_OPEN_HABITS} habits at a time. Archive one first.`, { code: 'HABIT_LIMIT' });
  const today = todayFor(ctx, memberId);
  const startDate = input.startDate ?? today;
  const endDate = input.endDate ?? null;
  checkDates(today, startDate, endDate, opts);
  const times = input.reminderTimes ?? [];
  if (input.remindersOn && !times.length) throw errors.validation([{ path: 'reminderTimes', message: 'Choose at least one reminder time' }], 'reminderTimes: choose at least one reminder time');
  const id = habitId();
  const now = ctx.now();
  ctx.db.tx(() => {
    ctx.db.insert('habits', {
      id, member_id: memberId, coach_id: by.role === 'coach' ? by.id : null, plan_id: by.role === 'coach' ? checkPlan(ctx, memberId, input.planId) : null,
      title: input.title.trim(), detail: (input.detail ?? '').trim(), kind: input.kind ?? 'habit', schedule: j.in(input.schedule), target_label: input.targetLabel?.trim() || null,
      reminder_times: j.in(times), reminders_on: input.remindersOn && times.length ? 1 : 0, status: 'active',
      start_date: startDate, end_date: endDate, paused_since: null, pause_log: '[]', archived_on: null, archived_at: null,
      created_by: by.id, created_by_role: by.role, created_at: now, updated_at: now,
    });
    audit(ctx, 'habit.create', { type: 'habit', id }, null, { memberId, by: by.role, kind: input.kind ?? 'habit', schedule: input.schedule, reminders: times.length ? times : null, ...(opts.seed ? { seed: true } : {}) });
  });
  const row = getHabitRow(ctx, id)!;
  if (by.role === 'coach' && !opts.seed) notify(ctx, { userId: memberId, category: 'programme', title: 'Your coach added a habit', body: `${row.title}: see it under Habits.`, channels: ['in_app'], data: { habitId: id } });
  syncReminders(ctx, row);
  return row;
}

const MEMBER_EDITABLE = ['title', 'detail', 'kind', 'schedule', 'targetLabel', 'reminderTimes', 'remindersOn', 'endDate', 'status'] as const;
type HabitPatch = Partial<{ title: string; detail: string; kind: HabitKind; schedule: HabitSchedule; targetLabel: string | null; reminderTimes: string[]; remindersOn: boolean; endDate: string | null; status: HabitStatus; planId: string | null }>;

/** Load a habit the caller may act on, or refuse without saying whether it exists. A coach reaches a habit the member
 *  wrote themselves only while the member shares health information (otherwise it is not found, as in their view). */
export function habitFor(ctx: Ctx, id: string, who: Who): HabitRow {
  const h = getHabitRow(ctx, id);
  if (!h) throw errors.notFound('Habit');
  if (who.role === 'member' && h.member_id !== who.id) throw errors.notFound('Habit');
  if (who.role === 'coach' && !coachHasMember(ctx, who.id, h.member_id)) throw errors.notFound('Habit');
  if (who.role === 'coach' && h.created_by_role === 'member' && !healthShared(ctx, h.member_id)) throw errors.notFound('Habit');
  return h;
}

/** Change a habit. A member: anything on their own habit, only the reminder fields on one a coach set. A coach: the
 *  definition and pause/resume of a coach-set habit of an assigned client (archiving has its own call). Audited
 *  habit.update (habit.archive when a member archives their own). */
export function updateHabit(ctx: Ctx, id: string, who: Who, patch: HabitPatch, reason?: string | null) {
  const h = habitFor(ctx, id, who);
  const keys = (Object.keys(patch) as Array<keyof HabitPatch>).filter((k) => patch[k] !== undefined);
  if (!keys.length) throw errors.badRequest('Nothing to change', 'NOTHING_TO_CHANGE');
  if (h.status === 'archived') throw errors.state('This habit is archived; add a new one instead', { code: 'HABIT_ARCHIVED' });
  if (who.role === 'member') {
    if (keys.some((k) => !(MEMBER_EDITABLE as readonly string[]).includes(k))) throw errors.badRequest('That field cannot be changed here', 'FIELD_NOT_EDITABLE');
    if (h.created_by_role === 'coach' && keys.some((k) => !(REMINDER_FIELDS as readonly string[]).includes(k))) throw errors.forbidden('Your coach set this habit. You can change its reminders; ask your coach to change the rest.', 'HABIT_SET_BY_COACH');
  } else {
    if (h.created_by_role !== 'coach') throw errors.forbidden('The member wrote this habit; only they can change it', 'HABIT_SET_BY_MEMBER');
    if (keys.some((k) => (REMINDER_FIELDS as readonly string[]).includes(k))) throw errors.badRequest('Reminders are the member’s choice once the habit exists', 'FIELD_NOT_EDITABLE');
    if (patch.status === 'archived') throw errors.badRequest('Archive with the archive action, with a reason', 'FIELD_NOT_EDITABLE');
  }
  const tz = memberTimezone(ctx, h.member_id);
  const today = localDate(ctx.now(), tz);
  const next: Record<string, string | number | null | undefined> = { updated_at: ctx.now() };
  if (patch.title !== undefined) next.title = patch.title.trim();
  if (patch.detail !== undefined) next.detail = patch.detail.trim();
  if (patch.kind !== undefined) next.kind = patch.kind;
  if (patch.schedule !== undefined) next.schedule = j.in(patch.schedule);
  if (patch.targetLabel !== undefined) next.target_label = patch.targetLabel?.trim() || null;
  if (patch.planId !== undefined) next.plan_id = checkPlan(ctx, h.member_id, patch.planId);
  if (patch.endDate !== undefined) {
    if (patch.endDate && patch.endDate < h.start_date) throw errors.validation([{ path: 'endDate', message: 'The end date comes after the start date' }], 'endDate: the end date comes after the start date');
    next.end_date = patch.endDate;
  }
  const times = patch.reminderTimes ?? timesOf(h);
  if (patch.reminderTimes !== undefined) next.reminder_times = j.in(patch.reminderTimes);
  const remindersOn = patch.remindersOn ?? !!h.reminders_on;
  if (remindersOn && !times.length) throw errors.validation([{ path: 'reminderTimes', message: 'Choose at least one reminder time' }], 'reminderTimes: choose at least one reminder time');
  if (patch.remindersOn !== undefined || patch.reminderTimes !== undefined) next.reminders_on = remindersOn && times.length ? 1 : 0;
  let action = 'habit.update';
  if (patch.status !== undefined && patch.status !== h.status) {
    if (patch.status === 'paused') next.paused_since = today;
    if (patch.status === 'active' && h.paused_since) {
      const closed = closePause(h.paused_since, today);
      next.pause_log = j.in(closed ? [...j.out<Array<{ from: string; to: string }>>(h.pause_log, []), closed] : j.out(h.pause_log, []));
      next.paused_since = null;
    }
    if (patch.status === 'archived') { next.archived_on = today; next.archived_at = ctx.now(); action = 'habit.archive'; }
    next.status = patch.status;
  }
  ctx.db.tx(() => {
    ctx.db.update('habits', id, next);
    audit(ctx, action, { type: 'habit', id }, reason ?? null, { memberId: h.member_id, by: who.role, changed: keys, ...(patch.status ? { status: patch.status, previous: h.status } : {}) });
  });
  const row = getHabitRow(ctx, id)!;
  syncReminders(ctx, row);
  return row;
}

/** A coach archives a habit they set for an assigned client, with a reason. Audited habit.archive. */
export function archiveHabit(ctx: Ctx, id: string, who: Who, reason: string) {
  const h = habitFor(ctx, id, who);
  if (who.role === 'coach' && h.created_by_role !== 'coach') throw errors.forbidden('The member wrote this habit; only they can archive it', 'HABIT_SET_BY_MEMBER');
  if (h.status === 'archived') return h;
  const today = todayFor(ctx, h.member_id);
  ctx.db.tx(() => {
    ctx.db.update('habits', id, { status: 'archived', archived_on: today, archived_at: ctx.now(), updated_at: ctx.now() });
    audit(ctx, 'habit.archive', { type: 'habit', id }, reason, { memberId: h.member_id, by: who.role, previous: h.status });
  });
  const row = getHabitRow(ctx, id)!;
  syncReminders(ctx, row);
  return row;
}

/** Record today's (or a recent day's) check-in. One per habit and day: a second call for the same day changes its
 *  status or note, and repeating the same call changes nothing (created: false, changed: false). Audited habit.checkin
 *  (the note is never copied into the audit log). Queued reminders for that day are cancelled. */
export function checkIn(ctx: Ctx, memberId: string, id: string, input: { date?: string; status: HabitCheckinStatus; note?: string }) {
  const h = habitFor(ctx, id, { role: 'member', id: memberId });
  if (h.status !== 'active') throw errors.state(h.status === 'paused' ? 'This habit is paused; resume it to check in' : 'This habit is archived', { code: h.status === 'paused' ? 'HABIT_PAUSED' : 'HABIT_ARCHIVED' });
  const tz = memberTimezone(ctx, memberId);
  const today = localDate(ctx.now(), tz);
  const date = input.date ?? today;
  if (date > today) throw errors.validation([{ path: 'date', message: 'You can check in for today or an earlier day' }], 'date: you can check in for today or an earlier day');
  if (date < addDaysToDate(today, -CHECKIN_BACKFILL_DAYS)) throw errors.validation([{ path: 'date', message: `Check-ins go back at most ${CHECKIN_BACKFILL_DAYS} days` }], `date: check-ins go back at most ${CHECKIN_BACKFILL_DAYS} days`);
  const span = spanOf(h), schedule = schedOf(h);
  if (!isActiveOn(span, date)) throw errors.state('The habit was not running on that day', { code: 'HABIT_NOT_RUNNING' });
  if (!isDueOn(schedule, date)) throw errors.state(`This habit is not due on that day (${scheduleLabel(schedule)})`, { code: 'HABIT_NOT_DUE' });
  const note = input.note?.trim() ? input.note.trim() : null;
  const existing = ctx.db.get<CheckinRow>('SELECT * FROM habit_checkins WHERE habit_id = ? AND date = ?', [id, date]);
  const now = ctx.now();
  let created = false, changed = false, rowId: string;
  if (existing) {
    rowId = existing.id;
    // the note stays unless a new one is given; an explicit empty note clears it
    const nextNote = input.note === undefined ? existing.note : note;
    changed = existing.status !== input.status || existing.note !== nextNote;
    if (changed) ctx.db.tx(() => {
      ctx.db.update('habit_checkins', existing.id, { status: input.status, note: nextNote, updated_at: now });
      audit(ctx, 'habit.checkin', { type: 'habit', id }, null, { date, status: input.status, previous: existing.status, noteChanged: existing.note !== nextNote });
    });
  } else {
    rowId = checkinId();
    created = changed = true;
    ctx.db.tx(() => {
      ctx.db.insert('habit_checkins', { id: rowId, habit_id: id, member_id: memberId, date, status: input.status, note, created_at: now, updated_at: now });
      audit(ctx, 'habit.checkin', { type: 'habit', id }, null, { date, status: input.status, withNote: !!note });
    });
  }
  cancelRemindersOn(ctx, h, date, tz);
  return { checkin: presentCheckin(ctx.db.get<CheckinRow>('SELECT * FROM habit_checkins WHERE id = ?', [rowId])!, true), created, changed };
}

/** Undo a check-in (a mistaken tap). Audited habit.checkin with undone: true; the day's remaining reminders return. */
export function undoCheckIn(ctx: Ctx, memberId: string, id: string, date: string) {
  const h = habitFor(ctx, id, { role: 'member', id: memberId });
  if (h.status === 'archived') throw errors.state('This habit is archived', { code: 'HABIT_ARCHIVED' });
  const existing = ctx.db.get<CheckinRow>('SELECT * FROM habit_checkins WHERE habit_id = ? AND date = ?', [id, date]);
  if (!existing) throw errors.notFound('Check-in');
  const today = todayFor(ctx, memberId);
  if (date < addDaysToDate(today, -CHECKIN_BACKFILL_DAYS)) throw errors.state(`Check-ins older than ${CHECKIN_BACKFILL_DAYS} days stay as recorded`, { code: 'CHECKIN_LOCKED' });
  ctx.db.tx(() => {
    ctx.db.run('DELETE FROM habit_checkins WHERE id = ?', [existing.id]);
    audit(ctx, 'habit.checkin', { type: 'habit', id }, null, { date, undone: true, previous: existing.status });
  });
  syncReminders(ctx, getHabitRow(ctx, id) ?? h);
  return { undone: true, date };
}

/* ---------- reminders (the foundation's queue, ref_type 'habit') ---------- */

function reminderBody(h: HabitRow): string {
  return `${h.title}${h.target_label ? ` (${h.target_label})` : ''}. Check in on Bioptime when it is done.`;
}

/** Is a reminder still wanted for this local date? Active, switched on, running and due that day, no check-in yet, and
 *  for a times-per-week habit the week's target not met yet. */
function wantsReminder(ctx: Ctx, h: HabitRow, date: string): boolean {
  if (h.status !== 'active' || !h.reminders_on) return false;
  const schedule = schedOf(h);
  if (!isActiveOn(spanOf(h), date) || !isDueOn(schedule, date)) return false;
  if (ctx.db.get('SELECT 1 FROM habit_checkins WHERE habit_id = ? AND date = ?', [h.id, date])) return false;
  if (!hasFixedDays(schedule)) {
    const from = weekStart(date);
    const done = ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM habit_checkins WHERE habit_id = ? AND status = 'done' AND date BETWEEN ? AND ?", [h.id, from, addDaysToDate(from, 6)])!.n;
    if (done >= (schedule as { timesPerWeek: number }).timesPerWeek) return false;
  }
  return true;
}

/** Queue this habit's reminders for the next 24 hours, in the member's timezone; cancel queued ones that are no longer
 *  wanted (paused, archived, switched off, times changed, already checked in). Returns how many are queued. */
export function syncReminders(ctx: Ctx, h: HabitRow, now: string = ctx.now()): number {
  const tz = memberTimezone(ctx, h.member_id);
  const horizon = new Date(Date.parse(now) + 24 * 3_600_000).toISOString();
  const wanted = new Set<string>();
  if (h.status === 'active' && h.reminders_on) {
    for (const date of datesBetween(localDate(now, tz), localDate(horizon, tz))) {
      if (!wantsReminder(ctx, h, date)) continue;
      for (const t of timesOf(h)) {
        const dueAt = localTimeToIso(date, t, tz);
        if (dueAt > now && dueAt <= horizon) wanted.add(dueAt);
      }
    }
  }
  // a queued reminder stays while its day still wants one at that time; one already due but not yet sent by the
  // dispatcher is kept on the same terms (never cancelled merely for being in the past)
  const times = timesOf(h);
  const stillWanted = (dueAt: string) => {
    if (wanted.has(dueAt)) return true;
    const date = localDate(dueAt, tz);
    return wantsReminder(ctx, h, date) && times.some((t) => localTimeToIso(date, t, tz) === dueAt);
  };
  for (const r of ctx.db.all<{ due_at: string }>("SELECT due_at FROM reminders WHERE ref_type = ? AND ref_id = ? AND status = 'queued'", [HABIT_REF, h.id])) {
    if (!stillWanted(r.due_at)) reminders.cancel(ctx, { refType: HABIT_REF, refId: h.id, dueAt: r.due_at });
  }
  for (const dueAt of wanted) reminders.schedule(ctx, { userId: h.member_id, refType: HABIT_REF, refId: h.id, dueAt, category: HABIT_REMINDER_CATEGORY, title: 'Habit reminder', body: reminderBody(h), channels: ['in_app', 'push'] });
  return wanted.size;
}

function cancelRemindersOn(ctx: Ctx, h: HabitRow, date: string, tz: string): void {
  const from = localTimeToIso(date, '00:00', tz), to = localTimeToIso(addDaysToDate(date, 1), '00:00', tz);
  for (const r of ctx.db.all<{ due_at: string }>("SELECT due_at FROM reminders WHERE ref_type = ? AND ref_id = ? AND status = 'queued' AND due_at >= ? AND due_at < ?", [HABIT_REF, h.id, from, to])) {
    reminders.cancel(ctx, { refType: HABIT_REF, refId: h.id, dueAt: r.due_at });
  }
}

/** The habit_reminders job: queue the next 24 hours for every active habit with reminders on, for members whose
 *  account is in use. The reminders job (foundation) sends them, honouring the reminders preference and quiet hours. */
export function runReminderJob(ctx: Ctx): { habits: number; queued: number } {
  const rows = ctx.db.all<HabitRow>("SELECT h.* FROM habits h JOIN users u ON u.id = h.member_id WHERE h.status = 'active' AND h.reminders_on = 1 AND u.state IN ('active','onboarding','pending_verification')");
  let queued = 0;
  for (const h of rows) queued += syncReminders(ctx, h);
  return { habits: rows.length, queued };
}

/* ---------- coach follow-up ---------- */

/** The habit_followups job. First, open follow-ups on habits the member wrote themselves close if the member has
 *  stopped sharing health information (habit_followup_privacy does the same every few minutes, flag on or off). While the owner's habit_followup_missed_days is null nothing opens. Otherwise each active
 *  habit that has gone that many due days without a check-in opens one coach_follow_up task for the assigned coach
 *  (notify off: it is the coach's own to-do), once per slip: not again while one is open, nor after one was opened
 *  since the last check-in. The task names the habit, so a habit the member wrote themselves gets one only while the
 *  member shares health information (the coach could not see that habit otherwise); the task carries no check-in note. */
export function runFollowUpJob(ctx: Ctx): { threshold: number | null; checked: number; opened: number; closed: number } {
  const system: Ctx = { ...ctx, actor: null };
  const closed = closeUnsharedFollowUps(system);
  const threshold = getSetting<number | null>(ctx, 'habit_followup_missed_days');
  if (threshold === null || threshold === undefined || !Number.isInteger(threshold) || threshold < 1) return { threshold: null, checked: 0, opened: 0, closed };
  const rows = ctx.db.all<HabitRow & { member_name: string }>("SELECT h.*, u.name AS member_name FROM habits h JOIN users u ON u.id = h.member_id WHERE h.status = 'active' AND u.state = 'active'");
  let opened = 0;
  for (const h of rows) {
    const coach = activeCoachFor(ctx, h.member_id);
    if (!coach) continue;
    if (h.created_by_role === 'member' && !healthShared(ctx, h.member_id)) continue;
    const tz = memberTimezone(ctx, h.member_id);
    const today = localDate(ctx.now(), tz);
    const list = ctx.db.all<CheckinRow>('SELECT * FROM habit_checkins WHERE habit_id = ? AND date >= ? ORDER BY date DESC', [h.id, addDaysToDate(today, -HISTORY_DAYS)]);
    const missed = missedDueDays(schedOf(h), spanOf(h), list.map((c) => ({ date: c.date, status: c.status })), today);
    if (missed < threshold) continue;
    const lastCheckin = ctx.db.get<{ at: string }>('SELECT MAX(updated_at) at FROM habit_checkins WHERE habit_id = ?', [h.id])?.at ?? h.created_at;
    const already = ctx.db.get("SELECT 1 FROM support_tasks WHERE kind = 'coach_follow_up' AND ref_type = ? AND ref_id = ? AND (status IN ('open','in_progress') OR created_at >= ?)", [HABIT_REF, h.id, lastCheckin]);
    if (already) continue;
    openTask(system, {
      kind: 'coach_follow_up', refType: HABIT_REF, refId: h.id, ownerId: coach.coachId, notify: false,
      title: `Habit slipping: ${h.member_name}, “${h.title}”`,
      detail: `${missed} due day${missed === 1 ? '' : 's'} without a check-in (the follow-up threshold is ${threshold}). See the client's Habits tab.`,
    });
    opened++;
  }
  return { threshold, checked: rows.length, opened, closed };
}

/** The habit_followup_privacy job (every few minutes, and also while the habits flag is off): open follow-ups on habits
 *  the member wrote themselves close once the member no longer shares health information. The coach's Today list and
 *  follow-up list are not gated by the habits flag, so this clean-up cannot wait for habit_followups, which runs
 *  hourly and only while the flag is on. */
export function runFollowUpPrivacySweep(ctx: Ctx): { closed: number } {
  return { closed: closeUnsharedFollowUps({ ...ctx, actor: null }) };
}

/** An open follow-up on a habit the member wrote themselves is dismissed once the member no longer shares health
 *  information: its title names the habit, which the coach may then no longer see. Audited support_task.update. */
function closeUnsharedFollowUps(system: Ctx): number {
  const open = system.db.all<{ id: string; member_id: string }>("SELECT t.id, h.member_id FROM support_tasks t JOIN habits h ON h.id = t.ref_id WHERE t.kind = 'coach_follow_up' AND t.ref_type = ? AND h.created_by_role = 'member' AND t.status IN ('open','in_progress')", [HABIT_REF]);
  let closed = 0;
  for (const t of open) {
    if (healthShared(system, t.member_id)) continue;
    updateTask(system, t.id, { status: 'dismissed', resolution: 'Closed: the member no longer shares health information with their coach' });
    closed++;
  }
  return closed;
}

/** CoachAssigned: open habit follow-ups for this member move to the newly assigned coach (the previous coach can no
 *  longer open the client). */
export function onCoachAssigned(ctx: Ctx, payload: Record<string, unknown>): number {
  const memberId = String(payload.memberId ?? ''), coachId = String(payload.coachId ?? '');
  if (!memberId || !coachId) return 0;
  const tasks = ctx.db.all<{ id: string }>("SELECT t.id FROM support_tasks t JOIN habits h ON h.id = t.ref_id WHERE t.kind = 'coach_follow_up' AND t.ref_type = ? AND h.member_id = ? AND t.status IN ('open','in_progress') AND (t.owner_id IS NULL OR t.owner_id != ?)", [HABIT_REF, memberId, coachId]);
  for (const t of tasks) updateTask({ ...ctx, actor: null }, t.id, { ownerId: coachId }, 'Coach reassigned: the habit follow-up moves to the assigned coach');
  return tasks.length;
}

/* ---------- data export (ApiModule.exportSections, read by api/domain/dataExport.ts) ---------- */

/** The member's habits and check-ins for their data export, with the fields their own Habits page shows: every habit
 *  (archived ones too), who set it ("you" or "your coach", never a coach or plan id), its schedule, target, reminder
 *  times and dates, and every check-in with the member's own note. Never the coach follow-ups, the reminder queue or
 *  the audit trail. Check-in dates are the member's local calendar days. */
export function exportForMember(ctx: Ctx, memberId: string) {
  const rows = ctx.db.all<HabitRow>('SELECT * FROM habits WHERE member_id = ? ORDER BY created_at, id', [memberId]);
  return rows.map((h) => {
    const schedule = schedOf(h);
    const checkins = ctx.db.all<CheckinRow>('SELECT * FROM habit_checkins WHERE habit_id = ? AND member_id = ? ORDER BY date', [h.id, memberId]);
    return {
      title: h.title, detail: h.detail, kind: h.kind, schedule, scheduleLabel: scheduleLabel(schedule), targetLabel: h.target_label,
      setBy: h.created_by_role === 'coach' ? 'your coach' : 'you',
      status: h.status, startDate: h.start_date, endDate: h.end_date, pausedSince: h.paused_since, archivedAt: h.archived_at,
      reminderTimes: timesOf(h), remindersOn: !!h.reminders_on, createdAt: h.created_at, updatedAt: h.updated_at,
      checkins: checkins.map((c) => ({ date: c.date, status: c.status, note: c.note, recordedAt: c.created_at, updatedAt: c.updated_at })),
    };
  });
}

/* ---------- adherence provider (GET /me/adherence, M2) ---------- */

/** Due and done across the member's habits in a date range (local dates). No composite score; pct is null when
 *  nothing was due. */
export function adherenceFor(ctx: Ctx, memberId: string, range: { from: string; to: string }) {
  const today = todayFor(ctx, memberId);
  const rows = ctx.db.all<HabitRow>('SELECT * FROM habits WHERE member_id = ?', [memberId]);
  const byHabit = checkinsFor(ctx, rows.map((r) => r.id), range.from);
  let due = 0, done = 0;
  for (const h of rows) {
    const a = adherence(schedOf(h), spanOf(h), (byHabit.get(h.id) ?? []).map((c) => ({ date: c.date, status: c.status })), range.from, range.to, today);
    due += a.due; done += a.done;
  }
  return { key: 'habits', label: 'Habits', due, done, pct: due ? Math.round((done / due) * 100) : null, note: 'Due days checked in as done, from what the member recorded. Paused days are not counted.' };
}

/* ---------- demo seed ---------- */

/** Habits and check-ins for the fictional members (demo mode only), in plain words (no Demo or Sample, owner decision
 *  of 24 October 2026); reminders stay off; check-in history is a fixed pattern, not a measurement. */
export function seedDemoHabits(ctx: Ctx, people: { coachIds: string[]; memberIds: string[] }): number {
  const member = (i: number) => people.memberIds[i];
  const coach = (i: number) => people.coachIds[i];
  const planOf = (memberId: string) => ctx.db.get<{ id: string }>("SELECT id FROM coaching_plans WHERE member_id = ? AND status = 'published' ORDER BY created_at LIMIT 1", [memberId])?.id ?? null;
  let n = 0;
  const add = (memberIdx: number, coachIdx: number | null, input: HabitInput, pattern: Array<HabitCheckinStatus | null>, notes: Record<number, string> = {}) => {
    const memberId = member(memberIdx);
    if (!memberId) return;
    const coachId = coachIdx === null ? null : coach(coachIdx);
    if (coachIdx !== null && (!coachId || !coachHasMember(ctx, coachId, memberId))) return;
    const today = todayFor(ctx, memberId);
    const actor = coachId ? { id: coachId, role: 'coach' as const } : { id: memberId, role: 'member' as const };
    const actorCtx: Ctx = { ...ctx, actor: { ...actor, email: '', name: '' } };
    const h = createHabit(actorCtx, memberId, actor, { ...input, startDate: addDaysToDate(today, -pattern.length), planId: coachId ? planOf(memberId) : null }, { seed: true });
    const schedule = schedOf(h);
    // pattern[0] is the oldest day; null leaves the day without a check-in
    pattern.forEach((status, k) => {
      const date = addDaysToDate(today, -(pattern.length - k));
      if (!status || !isDueOn(schedule, date)) return;
      const at = `${date}T14:00:00.000Z`;
      ctx.db.insert('habit_checkins', { id: checkinId(), habit_id: h.id, member_id: memberId, date, status, note: notes[k] ?? null, created_at: at, updated_at: at });
    });
    n++;
  };
  add(0, 0, { title: 'Evening walk', detail: 'An easy walk after dinner.', kind: 'movement', schedule: { type: 'daily' }, targetLabel: '25 minutes' },
    ['done', 'done', null, 'done', 'done', 'skipped', 'done', 'done', 'done', null, 'done', 'done'], { 4: 'Walked after dinner with a friend.', 10: 'Shorter loop, it rained.' });
  add(0, null, { title: 'Lights out by 23:00', detail: 'Screens off and lights out by 23:00 on weeknights.', kind: 'sleep', schedule: { type: 'weekdays', weekdays: [1, 2, 3, 4, 5] } },
    ['done', null, 'done', 'done', null, null, 'done', 'done', null, 'done', 'done', 'done']);
  add(1, 1, { title: 'Mobility routine', detail: 'The mobility routine from your plan.', kind: 'recovery', schedule: { type: 'times_per_week', timesPerWeek: 3 }, targetLabel: '10 minutes' },
    ['done', null, 'done', null, null, 'done', null, 'done', null, 'done', null, null, 'done', null]);
  add(2, 2, { title: 'Protein at breakfast', detail: 'Include a source of protein with breakfast.', kind: 'nutrition', schedule: { type: 'daily' } },
    ['done', 'done', 'skipped', 'done', null, 'done', 'done'], { 2: 'Travelling, hotel breakfast.' });
  add(8, null, { title: 'Ten minutes of reading before bed', detail: 'A book, not a screen.', kind: 'reflection', schedule: { type: 'daily' } },
    ['done', 'done', 'done', null, 'done']);
  return n;
}
