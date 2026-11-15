/* M2 Progress: measurable goals and milestones, structured check-ins (templates, weekly schedules, submit and review),
   progress photos (private files with their own consent), progress series over a chosen range, and adherence.

   Rules this file keeps (CAPABILITY_MAP.md 4.4):
   - A goal is marked achieved automatically only when it has a metric, a starting value and a target, and a value
     logged after the goal was set reaches the target in the direction from start to target. Otherwise only a person
     marks it. Nothing here recommends a target, predicts an outcome or scores anyone.
   - Whoever set a goal (member or coach) may change all of it, adding milestones included; the other side may change
     its status and mark its milestones reached or not, nothing else (NOT_YOUR_GOAL).
   - While a member does not share health records, their coach sees that a measurable goal or milestone is achieved,
     never how or when (presentGoal), since a logged value may have got it there.
   - Check-in answers tied to a metric become progress entries with source member (self-reported). Laboratory values
     stay in reports and never enter these series.
   - Photos are private files (api/domain/files.ts), opened only through 5-minute tokens. Uploading needs the
     progressPhotos switch and a current progress_photos consent. A coach opens a photo only while it is shared, the
     member's progress_photos and coach_sharing consents are both current and the coach is assigned; every opening is
     audited as progress_photo.view. Administrators see counts only.
   - Adherence lists each registered provider on its own line (plan actions here; habits, meals and workouts when those
     modules are present and on). There is no composite score.

   Entries are written through plans.ts (addProgress, putDailyTotal), which checks each metric's range. Daily totals
   (steps, water) read as one value per India day, the largest across their sources (plans.ts dailyPoints). */
import type { Ctx } from '../context.js';
// first, so that the file kind exists before the module descriptor reads it (see progressConstants.ts)
export { PHOTO_FILE_KIND } from './progressConstants.js';
import { PHOTO_FILE_KIND } from './progressConstants.js';
import { PROGRESS_SOURCE_LABELS, type ProgressSource } from '@bioptime/domain';
import { j } from '../db/db.js';
import { randomId } from '../lib/ids.js';
import { AppError, errors } from '../lib/errors.js';
import { addDays, dateInZone, weekdayInZone, zonedToIso } from '../lib/time.js';
import { coachHasMember } from '../auth/permissions.js';
import { audit, emit } from './audit.js';
import { notify } from './notifications.js';
import { addProgress, DAILY_ROWS, dailyPoints, isDailyTotal, metricConfig, type DailyRow } from './plans.js';
import { setConsent } from './members.js';
import * as files from './files.js';
import type { FileRow } from './files.js';
import * as reminders from './reminders.js';
import { isEnabled } from './features.js';
import { getSetting } from './settings.js';
import { MODULES, featureOf } from '../modules/index.js';
import type { AdherenceSummary } from '../modules/types.js';

/* ---------- vocabulary ---------- */

export const MODULE_FLAG = 'progress';
/** The photo switch: the stored switch the foundation seeded from settings.features (off until an owner turns it on). */
export const PHOTOS_FLAG = 'progressPhotos';
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const POSES = ['front', 'side', 'back', 'other'] as const;
export const GOAL_STATUSES = ['active', 'achieved', 'paused', 'dropped'] as const;
export const QUESTION_TYPES = ['scale_1_5', 'number', 'text', 'yes_no'] as const;
export const CHECKIN_STATUSES = ['requested', 'submitted', 'reviewed', 'missed'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];
export type QuestionType = (typeof QUESTION_TYPES)[number];
export type Pose = (typeof POSES)[number];
export type Question = { key: string; label: string; type: QuestionType; metric?: string };

const MAX_OPEN_GOALS = 30;
const MAX_MILESTONES = 20;
const MAX_PHOTOS = 300;
const SERIES_POINT_LIMIT = 2000;
/** The local hour a scheduled check-in's reminder goes out on its due day (India; quiet hours still apply). */
const CHECKIN_REMINDER_MINUTE = 9 * 60;

const ids = {
  goal: () => randomId('gol'),
  milestone: () => randomId('gms'),
  template: () => randomId('ckt'),
  schedule: () => randomId('cks'),
  checkin: () => randomId('chk'),
  photo: () => randomId('pph'),
  note: () => randomId('cnt'),
};

/** System work (jobs, automatic achievement) is recorded without a person. */
const system = (ctx: Ctx): Ctx => ({ ...ctx, actor: null });

/* ---------- small helpers ---------- */

function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function nextDate(s: string): string { return new Date(Date.parse(`${s}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10); }
function daysBetween(a: string, b: string): number { return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000); }
export function todayIn(ctx: Ctx): string { return dateInZone(ctx.now()); }

function nameOf(ctx: Ctx, userId: string): string { return ctx.db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', [userId])?.name ?? 'A member'; }

/** The latest consent of a kind, ties broken by insertion order. No recorded consent is no consent. */
export function latestConsent(ctx: Ctx, memberId: string, kind: string): { granted: boolean; version: string; at: string } | null {
  const r = ctx.db.get<{ granted: number; version: string; at: string }>('SELECT granted, version, at FROM member_consents WHERE user_id = ? AND kind = ? ORDER BY at DESC, rowid DESC LIMIT 1', [memberId, kind]);
  return r ? { granted: !!r.granted, version: r.version, at: r.at } : null;
}
export function consentCurrent(ctx: Ctx, memberId: string, kind: string): boolean { return latestConsent(ctx, memberId, kind)?.granted === true; }
/** Does the member currently share health records with their coach (coach_sharing)? */
export function healthShared(ctx: Ctx, memberId: string): boolean { return consentCurrent(ctx, memberId, 'coach_sharing'); }

/** A date range in India: from and to are inclusive local dates; the instants bound the query. */
export function dateRange(ctx: Ctx, from: string | undefined, to: string | undefined, defaultDays: number, maxDays = 1096) {
  const t = to ?? todayIn(ctx);
  if (!isRealDate(t)) throw errors.badRequest('to: use a real date as YYYY-MM-DD', 'RANGE_INVALID');
  const f = from ?? dateInZone(addDays(zonedToIso(t, 12 * 60), -(defaultDays - 1)));
  if (!isRealDate(f)) throw errors.badRequest('from: use a real date as YYYY-MM-DD', 'RANGE_INVALID');
  if (f > t) throw errors.badRequest('from must be on or before to', 'RANGE_INVALID');
  if (daysBetween(f, t) + 1 > maxDays) throw errors.badRequest(`A range covers at most ${maxDays} days`, 'RANGE_TOO_LONG');
  return { from: f, to: t, fromIso: zonedToIso(f, 0), toIso: zonedToIso(nextDate(t), 0) };
}

function metricFor(ctx: Ctx, metric: string, opts: { enabledOnly: boolean }) {
  const cfg = metricConfig(ctx).find((m) => m.metric === metric);
  if (!cfg || (opts.enabledOnly && !cfg.enabled)) throw errors.badRequest(`Unknown or switched-off metric ${metric}`, 'METRIC_UNKNOWN');
  return cfg;
}
function checkInRange(cfg: { label: string; min: number | null; max: number | null }, value: number, what: string): void {
  if (!Number.isFinite(value)) throw errors.badRequest(`${what} must be a number`, 'VALUE_INVALID');
  if (cfg.min !== null && value < cfg.min) throw errors.badRequest(`${what}: ${cfg.label} cannot be below ${cfg.min}`, 'VALUE_OUT_OF_RANGE');
  if (cfg.max !== null && value > cfg.max) throw errors.badRequest(`${what}: ${cfg.label} cannot be above ${cfg.max}`, 'VALUE_OUT_OF_RANGE');
}

/** The metrics people may log (label, unit and allowed range), for forms: names and units only, never anyone's values. */
export function enabledMetrics(ctx: Ctx) { return metricConfig(ctx).filter((m) => m.enabled).map((m) => ({ metric: m.metric, label: m.label, unit: m.unit, min: m.min, max: m.max })); }

function sourceLabel(source: string): string { return PROGRESS_SOURCE_LABELS[source as ProgressSource] ?? source; }

function latestEntry(ctx: Ctx, memberId: string, metric: string) {
  if (isDailyTotal(metric)) {
    // the latest day's value (the largest across its sources), not whichever source wrote last
    const last = ctx.db.get<{ at: string }>('SELECT at FROM progress_entries WHERE member_id = ? AND metric = ? ORDER BY at DESC LIMIT 1', [memberId, metric]);
    if (!last) return null;
    const day = dateInZone(last.at);
    const p = dailyPoints(ctx.db.all<DailyRow>(`${DAILY_ROWS} WHERE e.member_id = ? AND e.metric = ? AND e.at >= ? AND e.at < ?`, [memberId, metric, zonedToIso(day, 0), zonedToIso(nextDate(day), 0)]))[0];
    return p ? { value: p.value, at: p.at, source: p.source, sourceLabel: p.sourceLabel } : null;
  }
  const r = ctx.db.get<{ value: number; at: string; source: string }>('SELECT value, at, source FROM progress_entries WHERE member_id = ? AND metric = ? ORDER BY at DESC, created_at DESC LIMIT 1', [memberId, metric]);
  return r ? { value: r.value, at: r.at, source: r.source, sourceLabel: sourceLabel(r.source) } : null;
}

/* =====================================================================================================================
   Goals and milestones
   ===================================================================================================================== */

type GoalRow = {
  id: string; member_id: string; title: string; metric: string | null; baseline_value: number | null; target_value: number | null; unit: string | null; target_date: string | null;
  status: GoalStatus; created_by: string; created_by_role: 'member' | 'coach'; achieved_at: string | null; achieved_how: 'target_reached' | 'marked' | null; created_at: string; updated_at: string;
};
type MilestoneRow = { id: string; goal_id: string; title: string; target_value: number | null; due_date: string | null; achieved_at: string | null; sort: number; created_by: string | null; created_at: string };

/** up when the target is above the start, down when below; null when the goal cannot be achieved automatically. */
function directionOf(g: Pick<GoalRow, 'metric' | 'baseline_value' | 'target_value'>): 'up' | 'down' | null {
  if (!g.metric || g.target_value === null || g.baseline_value === null || g.target_value === g.baseline_value) return null;
  return g.target_value > g.baseline_value ? 'up' : 'down';
}
const reaches = (dir: 'up' | 'down', value: number, target: number) => (dir === 'up' ? value >= target : value <= target);

function goalRow(ctx: Ctx, memberId: string, goalId: string): GoalRow {
  const g = ctx.db.get<GoalRow>('SELECT * FROM goals WHERE id = ? AND member_id = ?', [goalId, memberId]);
  if (!g) throw errors.notFound('Goal');
  return g;
}

/** A goal as people see it. Without `values` (a coach while the member does not share health records) the starting,
 *  target and latest values are left out and valuesWithheld says so.
 *
 *  Achievement follows the same line. A value the member logged can reach the target of a measurable goal or a
 *  milestone with a value, so without `values` such a goal or milestone shows only that it is achieved (status
 *  'achieved', milestone `reached`), never how or when: achievedHow and achievedAt are null, achievementWithheld says
 *  so, and the goal's updatedAt (set by the automatic achievement) is left out as well. Withholding it for marked
 *  achievements too keeps 'how' from being read off the gaps. A goal or milestone without values can only be marked by
 *  a person, so it keeps its date and how. */
export function presentGoal(ctx: Ctx, g: GoalRow, opts: { values: boolean }) {
  const milestones = ctx.db.all<MilestoneRow>('SELECT * FROM goal_milestones WHERE goal_id = ? ORDER BY sort, created_at', [g.id]);
  const cfg = g.metric ? metricConfig(ctx).find((m) => m.metric === g.metric) : undefined;
  const measurable = g.metric !== null || g.target_value !== null || g.baseline_value !== null;
  const valuesWithheld = !opts.values && measurable;
  const achievementWithheld = valuesWithheld && g.status === 'achieved';
  return {
    id: g.id, memberId: g.member_id, title: g.title, metric: g.metric, metricLabel: cfg?.label ?? null, unit: g.unit,
    ...(opts.values ? { baselineValue: g.baseline_value, targetValue: g.target_value, latest: g.metric ? latestEntry(ctx, g.member_id, g.metric) : null } : {}),
    valuesWithheld,
    targetDate: g.target_date, status: g.status, createdByRole: g.created_by_role,
    achievedAt: valuesWithheld ? null : g.achieved_at, achievedHow: valuesWithheld ? null : g.achieved_how, achievementWithheld,
    autoAchieve: directionOf(g) !== null,
    milestones: milestones.map((m) => {
      const hidden = valuesWithheld || (!opts.values && m.target_value !== null);
      return { id: m.id, title: m.title, ...(opts.values ? { targetValue: m.target_value } : {}), dueDate: m.due_date, reached: m.achieved_at !== null, achievedAt: hidden ? null : m.achieved_at, sort: m.sort };
    }),
    createdAt: g.created_at, updatedAt: achievementWithheld ? null : g.updated_at,
  };
}

export function getGoal(ctx: Ctx, memberId: string, goalId: string, opts: { values: boolean }) { return presentGoal(ctx, goalRow(ctx, memberId, goalId), opts); }

export function listGoals(ctx: Ctx, memberId: string, opts: { values: boolean }) {
  evaluateGoals(ctx, memberId); // a value logged since the last look may have reached a target
  const rows = ctx.db.all<GoalRow>("SELECT * FROM goals WHERE member_id = ? ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'achieved' THEN 2 ELSE 3 END, created_at DESC", [memberId]);
  return rows.map((g) => presentGoal(ctx, g, opts));
}

export type GoalInput = { title: string; metric?: string | null; baselineValue?: number | null; targetValue?: number | null; unit?: string | null; targetDate?: string | null };

function cleanGoalValues(ctx: Ctx, input: { metric: string | null; baselineValue: number | null; targetValue: number | null; unit: string | null }) {
  let unit = input.unit?.trim() || null;
  if (input.metric) {
    const cfg = metricFor(ctx, input.metric, { enabledOnly: true });
    if (input.baselineValue !== null) checkInRange(cfg, input.baselineValue, 'Starting value');
    if (input.targetValue !== null) checkInRange(cfg, input.targetValue, 'Target');
    unit = cfg.unit;
  } else {
    for (const [v, what] of [[input.baselineValue, 'Starting value'], [input.targetValue, 'Target']] as const) if (v !== null && (!Number.isFinite(v) || Math.abs(v) > 1e9)) throw errors.badRequest(`${what} must be a number`, 'VALUE_INVALID');
    if (unit && unit.length > 16) throw errors.badRequest('A unit is at most 16 characters', 'VALUE_INVALID');
  }
  if (input.metric && input.baselineValue !== null && input.targetValue !== null && input.baselineValue === input.targetValue) throw errors.badRequest('The target must differ from the starting value', 'TARGET_EQUALS_START');
  return { unit };
}

/** A member sets a goal for themselves, or an assigned coach sets one for a client (the route checks access). */
export function createGoal(ctx: Ctx, memberId: string, input: GoalInput, by: 'member' | 'coach') {
  const actor = ctx.actor;
  if (!actor) throw errors.unauthorised();
  const open = ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM goals WHERE member_id = ? AND status IN ('active', 'paused')", [memberId])!.n;
  if (open >= MAX_OPEN_GOALS) throw errors.conflict(`At most ${MAX_OPEN_GOALS} open goals; mark some achieved or dropped first`, 'TOO_MANY_GOALS');
  const metric = input.metric || null;
  let baseline = input.baselineValue ?? null;
  const target = input.targetValue ?? null;
  if (input.targetDate) {
    if (!isRealDate(input.targetDate)) throw errors.badRequest('Target date: use a real date as YYYY-MM-DD', 'VALUE_INVALID');
    if (input.targetDate < todayIn(ctx)) throw errors.badRequest('The target date is in the past', 'TARGET_DATE_PAST');
  }
  const { unit } = cleanGoalValues(ctx, { metric, baselineValue: baseline, targetValue: target, unit: input.unit ?? null });
  // with a metric and a target but no starting value, the start is the member's latest logged value (if any), so the
  // direction is known; the response says where the start came from
  let baselineFromLatest = false;
  if (metric && target !== null && baseline === null) {
    const latest = latestEntry(ctx, memberId, metric);
    if (latest && latest.value !== target) { baseline = latest.value; baselineFromLatest = true; }
  }
  const now = ctx.now();
  const id = ids.goal();
  ctx.db.tx(() => {
    ctx.db.insert('goals', { id, member_id: memberId, title: input.title.trim(), metric, baseline_value: baseline, target_value: target, unit, target_date: input.targetDate ?? null, status: 'active', created_by: actor.id, created_by_role: by, achieved_at: null, achieved_how: null, created_at: now, updated_at: now });
    audit(ctx, 'goal.create', { type: 'goal', id }, null, { memberId, byRole: by, metric, measurable: directionOf({ metric, baseline_value: baseline, target_value: target }) !== null, baselineFromLatest });
    if (by === 'coach') notify(ctx, { userId: memberId, category: 'goal', title: 'Your coach added a goal', body: `${input.title.trim()}: see it under Goals.`, data: { goalId: id }, sensitive: true });
  });
  return { ...presentGoal(ctx, goalRow(ctx, memberId, id), { values: true }), baselineFromLatest };
}

export type GoalPatch = { title?: string; status?: GoalStatus; baselineValue?: number | null; targetValue?: number | null; unit?: string | null; targetDate?: string | null };

/** Whoever set a goal may change everything on it, adding milestones included; the other party (member or coach) may
 *  change its status only, and a milestone's status (reached or not) counts as status. */
const notYourGoal = (by: 'member' | 'coach') => errors.forbidden(by === 'member' ? 'Your coach set this goal: you can change its status, and ask your coach to change the rest' : 'The member set this goal: you can change its status only', 'NOT_YOUR_GOAL');

export function updateGoal(ctx: Ctx, memberId: string, goalId: string, patch: GoalPatch, by: 'member' | 'coach') {
  const g = goalRow(ctx, memberId, goalId);
  const fields = Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined);
  if (!fields.length) throw errors.badRequest('Nothing to change', 'NOTHING_TO_CHANGE');
  if (g.created_by_role !== by && fields.some((f) => f !== 'status')) throw notYourGoal(by);
  if (patch.targetDate && !isRealDate(patch.targetDate)) throw errors.badRequest('Target date: use a real date as YYYY-MM-DD', 'VALUE_INVALID');
  const baseline = patch.baselineValue !== undefined ? patch.baselineValue : g.baseline_value;
  const target = patch.targetValue !== undefined ? patch.targetValue : g.target_value;
  // values are checked only when they change, so a status change never fails on a metric switched off since
  const valuesChange = patch.baselineValue !== undefined || patch.targetValue !== undefined || patch.unit !== undefined;
  const { unit } = valuesChange ? cleanGoalValues(ctx, { metric: g.metric, baselineValue: baseline, targetValue: target, unit: patch.unit !== undefined ? patch.unit : g.unit }) : { unit: g.unit };
  const now = ctx.now();
  const status = patch.status ?? g.status;
  const achieved = status === 'achieved' ? (g.status === 'achieved' ? { at: g.achieved_at, how: g.achieved_how } : { at: now, how: 'marked' as const }) : { at: null, how: null };
  ctx.db.tx(() => {
    ctx.db.update('goals', g.id, { title: patch.title?.trim(), baseline_value: baseline, target_value: target, unit, target_date: patch.targetDate !== undefined ? patch.targetDate : g.target_date, status, achieved_at: achieved.at, achieved_how: achieved.how, updated_at: now });
    audit(ctx, 'goal.update', { type: 'goal', id: g.id }, null, { memberId, byRole: by, fields, ...(patch.status && patch.status !== g.status ? { from: g.status, to: patch.status } : {}) });
  });
  evaluateGoals(ctx, memberId);
  return presentGoal(ctx, goalRow(ctx, memberId, g.id), { values: true });
}

/** Adding a milestone changes what the goal is, so only whoever set the goal may do it (NOT_YOUR_GOAL otherwise). */
export function addMilestone(ctx: Ctx, memberId: string, goalId: string, input: { title: string; targetValue?: number | null; dueDate?: string | null }, by: 'member' | 'coach') {
  const g = goalRow(ctx, memberId, goalId);
  if (g.created_by_role !== by) throw notYourGoal(by);
  if (g.status === 'dropped') throw errors.state('This goal was dropped; set it active again before adding milestones', { code: 'GOAL_DROPPED' });
  const count = ctx.db.get<{ n: number; s: number | null }>('SELECT COUNT(*) n, MAX(sort) s FROM goal_milestones WHERE goal_id = ?', [g.id])!;
  if (count.n >= MAX_MILESTONES) throw errors.conflict(`A goal has at most ${MAX_MILESTONES} milestones`, 'TOO_MANY_MILESTONES');
  const target = input.targetValue ?? null;
  if (target !== null) {
    if (g.metric) checkInRange(metricFor(ctx, g.metric, { enabledOnly: false }), target, 'Milestone value');
    else if (!g.unit) throw errors.badRequest('A milestone value needs a goal with a metric or a unit', 'VALUE_INVALID');
    else if (!Number.isFinite(target)) throw errors.badRequest('Milestone value must be a number', 'VALUE_INVALID');
  }
  if (input.dueDate && !isRealDate(input.dueDate)) throw errors.badRequest('Due date: use a real date as YYYY-MM-DD', 'VALUE_INVALID');
  const id = ids.milestone();
  ctx.db.insert('goal_milestones', { id, goal_id: g.id, title: input.title.trim(), target_value: target, due_date: input.dueDate ?? null, achieved_at: null, sort: (count.s ?? -1) + 1, created_by: ctx.actor?.id ?? null, created_at: ctx.now() });
  audit(ctx, 'goal.milestone_add', { type: 'goal', id: g.id }, null, { memberId, milestoneId: id, measurable: target !== null, byRole: by });
  evaluateGoals(ctx, memberId);
  return presentGoal(ctx, goalRow(ctx, memberId, g.id), { values: true });
}

/** Marking a milestone reached (or not) is a status change: either side may do it, like the goal's own status. */
export function setMilestoneAchieved(ctx: Ctx, memberId: string, goalId: string, milestoneId: string, achieved: boolean, by: 'member' | 'coach') {
  const g = goalRow(ctx, memberId, goalId);
  const m = ctx.db.get<MilestoneRow>('SELECT * FROM goal_milestones WHERE id = ? AND goal_id = ?', [milestoneId, g.id]);
  if (!m) throw errors.notFound('Milestone');
  if (!!m.achieved_at === achieved) return presentGoal(ctx, g, { values: true });
  ctx.db.update('goal_milestones', m.id, { achieved_at: achieved ? ctx.now() : null });
  audit(ctx, 'goal.milestone_update', { type: 'goal', id: g.id }, null, { memberId, milestoneId: m.id, achieved, byRole: by });
  return presentGoal(ctx, goalRow(ctx, memberId, g.id), { values: true });
}

/** Marks milestones and goals whose target a value logged after the goal was set has reached. Idempotent; recorded as
 *  system work, with an in-app notification to the member. Returns how many things changed. */
export function evaluateGoals(ctx: Ctx, memberId?: string): { milestones: number; goals: number } {
  const sys = system(ctx);
  const goals = ctx.db.all<GoalRow>(`SELECT * FROM goals WHERE status = 'active' AND metric IS NOT NULL AND baseline_value IS NOT NULL ${memberId ? 'AND member_id = ?' : ''}`, memberId ? [memberId] : []);
  let milestones = 0, achieved = 0;
  for (const g of goals) {
    const dir = directionOf(g);
    if (!dir) continue;
    const best = ctx.db.get<{ v: number | null }>(`SELECT ${dir === 'up' ? 'MAX' : 'MIN'}(value) v FROM progress_entries WHERE member_id = ? AND metric = ? AND at >= ?`, [g.member_id, g.metric, g.created_at])?.v;
    if (best === null || best === undefined) continue;
    const now = ctx.now();
    for (const m of ctx.db.all<MilestoneRow>('SELECT * FROM goal_milestones WHERE goal_id = ? AND achieved_at IS NULL AND target_value IS NOT NULL', [g.id])) {
      if (!reaches(dir, best, m.target_value!)) continue;
      ctx.db.update('goal_milestones', m.id, { achieved_at: now });
      audit(sys, 'goal.milestone_reached', { type: 'goal', id: g.id }, null, { memberId: g.member_id, milestoneId: m.id });
      notify(sys, { userId: g.member_id, category: 'goal', title: 'Milestone reached', body: 'A value you logged reached a milestone. See it under Goals.', data: { goalId: g.id, milestoneId: m.id }, channels: ['in_app', 'push'], sensitive: true });
      milestones++;
    }
    if (g.target_value !== null && reaches(dir, best, g.target_value)) {
      ctx.db.update('goals', g.id, { status: 'achieved', achieved_at: now, achieved_how: 'target_reached', updated_at: now });
      audit(sys, 'goal.achieved', { type: 'goal', id: g.id }, null, { memberId: g.member_id, how: 'target_reached' });
      notify(sys, { userId: g.member_id, category: 'goal', title: 'Goal reached', body: 'A value you logged reached the target of one of your goals. See it under Goals.', data: { goalId: g.id }, channels: ['in_app', 'push'], sensitive: true });
      emit(sys, 'GoalAchieved', { type: 'goal', id: g.id }, { memberId: g.member_id, how: 'target_reached' });
      achieved++;
    }
  }
  return { milestones, goals: achieved };
}

/* =====================================================================================================================
   Check-in templates
   ===================================================================================================================== */

type TemplateRow = { id: string; title: string; description: string; questions: string; scope: 'library' | 'coach'; status: 'draft' | 'published' | 'archived'; created_by: string; created_at: string; updated_at: string; published_at: string | null };

/** Question keys are unique; a metric is allowed on number questions (any enabled metric) and on 1–5 questions (a 1–5
 *  metric only), and its answers are then logged as self-reported progress entries. */
export function checkQuestions(ctx: Ctx, questions: Question[]): Question[] {
  if (!questions.length) throw errors.badRequest('Add at least one question', 'QUESTIONS_INVALID');
  const seen = new Set<string>();
  return questions.map((q, i) => {
    if (seen.has(q.key)) throw errors.badRequest(`Question ${i + 1}: the key ${q.key} is used twice`, 'QUESTIONS_INVALID');
    seen.add(q.key);
    if (q.metric) {
      if (q.type !== 'number' && q.type !== 'scale_1_5') throw errors.badRequest(`Question ${i + 1}: only number and 1–5 questions can log a metric`, 'QUESTIONS_INVALID');
      const cfg = metricFor(ctx, q.metric, { enabledOnly: true });
      if (q.type === 'scale_1_5' && !(cfg.metric.endsWith('_1_5') || (cfg.min !== null && cfg.max !== null && cfg.min >= 1 && cfg.max <= 5))) throw errors.badRequest(`Question ${i + 1}: a 1–5 question can log only a 1–5 metric`, 'QUESTIONS_INVALID');
    }
    return { key: q.key, label: q.label.trim(), type: q.type, ...(q.metric ? { metric: q.metric } : {}) };
  });
}

export function presentTemplate(ctx: Ctx, t: TemplateRow) {
  return { id: t.id, title: t.title, description: t.description, questions: j.out<Question[]>(t.questions, []), scope: t.scope, status: t.status, createdBy: t.created_by, createdByName: nameOf(ctx, t.created_by), createdAt: t.created_at, updatedAt: t.updated_at, publishedAt: t.published_at };
}

function templateRow(ctx: Ctx, id: string): TemplateRow {
  const t = ctx.db.get<TemplateRow>('SELECT * FROM checkin_templates WHERE id = ?', [id]);
  if (!t) throw errors.notFound('Check-in template');
  return t;
}

/** Library templates are drafts until an administrator publishes them; a coach's own template is usable at once by that coach. */
export function createTemplate(ctx: Ctx, input: { title: string; description?: string; questions: Question[] }, scope: 'library' | 'coach') {
  const actor = ctx.actor;
  if (!actor) throw errors.unauthorised();
  const questions = checkQuestions(ctx, input.questions);
  const now = ctx.now();
  const id = ids.template();
  const status = scope === 'coach' ? 'published' : 'draft';
  ctx.db.insert('checkin_templates', { id, title: input.title.trim(), description: (input.description ?? '').trim(), questions: j.in(questions), scope, status, created_by: actor.id, created_at: now, updated_at: now, published_at: status === 'published' ? now : null });
  audit(ctx, 'checkin_template.create', { type: 'checkin_template', id }, null, { scope, questions: questions.length });
  return presentTemplate(ctx, templateRow(ctx, id));
}

/** Library templates (administrators): text and questions change while a draft; archiving retires one (a reason is recorded). */
export function updateTemplate(ctx: Ctx, id: string, patch: { title?: string; description?: string; questions?: Question[]; status?: 'archived' }, reason?: string) {
  const t = templateRow(ctx, id);
  if (t.scope !== 'library') throw errors.notFound('Check-in template');
  const editing = patch.title !== undefined || patch.description !== undefined || patch.questions !== undefined;
  if (editing && t.status !== 'draft') throw errors.state('Only a draft can be edited; archive this template and write a new one', { code: 'TEMPLATE_NOT_DRAFT' });
  if (patch.status === 'archived' && (!reason || reason.trim().length < 3)) throw errors.badRequest('Say why: the reason is recorded in the audit log', 'REASON_REQUIRED');
  if (patch.status === 'archived' && t.status === 'archived') throw errors.state('Already archived', { code: 'TEMPLATE_ARCHIVED' });
  const questions = patch.questions ? checkQuestions(ctx, patch.questions) : undefined;
  ctx.db.update('checkin_templates', t.id, { title: patch.title?.trim(), description: patch.description?.trim(), questions: questions ? j.in(questions) : undefined, status: patch.status, updated_at: ctx.now() });
  audit(ctx, patch.status === 'archived' ? 'checkin_template.archive' : 'checkin_template.update', { type: 'checkin_template', id: t.id }, reason?.trim() || null, { fields: Object.keys(patch) });
  return presentTemplate(ctx, templateRow(ctx, t.id));
}

export function publishTemplate(ctx: Ctx, id: string, reason: string) {
  const t = templateRow(ctx, id);
  if (t.scope !== 'library') throw errors.notFound('Check-in template');
  if (t.status !== 'draft') throw errors.state('Only a draft can be published', { code: 'TEMPLATE_NOT_DRAFT' });
  if (!reason || reason.trim().length < 3) throw errors.badRequest('Say why: the reason is recorded in the audit log', 'REASON_REQUIRED');
  const now = ctx.now();
  ctx.db.update('checkin_templates', t.id, { status: 'published', published_at: now, updated_at: now });
  audit(ctx, 'checkin_template.publish', { type: 'checkin_template', id: t.id }, reason.trim(), { questions: j.out<Question[]>(t.questions, []).length });
  return presentTemplate(ctx, templateRow(ctx, t.id));
}

/** Administrators: every library template, and coaches' own templates for oversight. */
export function listAllTemplates(ctx: Ctx, scope: 'library' | 'coach' | 'all' = 'library') {
  const rows = ctx.db.all<TemplateRow>(`SELECT * FROM checkin_templates ${scope === 'all' ? '' : 'WHERE scope = ?'} ORDER BY CASE status WHEN 'draft' THEN 0 WHEN 'published' THEN 1 ELSE 2 END, updated_at DESC`, scope === 'all' ? [] : [scope]);
  return rows.map((t) => presentTemplate(ctx, t));
}

/** A coach: published library templates and their own. */
export function listCoachTemplates(ctx: Ctx, coachId: string) {
  return ctx.db.all<TemplateRow>("SELECT * FROM checkin_templates WHERE status = 'published' AND (scope = 'library' OR (scope = 'coach' AND created_by = ?)) ORDER BY scope DESC, title", [coachId]).map((t) => presentTemplate(ctx, t));
}

function usableTemplate(ctx: Ctx, coachId: string, templateId: string): TemplateRow {
  const t = ctx.db.get<TemplateRow>("SELECT * FROM checkin_templates WHERE id = ? AND status = 'published' AND (scope = 'library' OR created_by = ?)", [templateId, coachId]);
  if (!t) throw errors.notFound('Check-in template');
  return t;
}

/* =====================================================================================================================
   Check-ins: schedule, materialise, submit, review
   ===================================================================================================================== */

type ScheduleRow = { id: string; member_id: string; coach_id: string; template_id: string; weekday: number; active: number; created_at: string; ended_at: string | null };
type CheckinRow = {
  id: string; member_id: string; coach_id: string; template_id: string; schedule_id: string | null; title: string; questions: string; due_date: string; status: (typeof CHECKIN_STATUSES)[number];
  answers: string | null; submitted_at: string | null; reviewed_at: string | null; reviewed_by: string | null; response: string | null; created_by: string | null; created_at: string;
};
export type AnswerValue = number | string | boolean;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function presentSchedule(ctx: Ctx, s: ScheduleRow) {
  const t = ctx.db.get<{ title: string }>('SELECT title FROM checkin_templates WHERE id = ?', [s.template_id]);
  return { id: s.id, memberId: s.member_id, coachId: s.coach_id, coachName: nameOf(ctx, s.coach_id), templateId: s.template_id, templateTitle: t?.title ?? '', weekday: s.weekday, weekdayLabel: WEEKDAYS[s.weekday], active: !!s.active, createdAt: s.created_at, endedAt: s.ended_at };
}

/** A check-in. `answers` false (a coach without health sharing) leaves the answers out and says they are withheld;
 *  `notes` adds the coaching team's private notes on it. */
export function presentCheckin(ctx: Ctx, c: CheckinRow, opts: { answers: boolean; notes?: boolean }) {
  const notes = opts.notes ? ctx.db.all<{ id: string; body: string; coach_id: string; created_at: string }>("SELECT id, body, coach_id, created_at FROM coach_notes WHERE ref_type = 'checkin' AND ref_id = ? ORDER BY created_at", [c.id]).map((n) => ({ id: n.id, body: n.body, authorName: nameOf(ctx, n.coach_id), createdAt: n.created_at })) : undefined;
  return {
    id: c.id, memberId: c.member_id, coachId: c.coach_id, coachName: nameOf(ctx, c.coach_id), templateId: c.template_id, scheduleId: c.schedule_id,
    title: c.title, questions: j.out<Question[]>(c.questions, []), dueDate: c.due_date, status: c.status,
    ...(opts.answers ? { answers: j.out<Record<string, AnswerValue> | null>(c.answers, null) } : {}),
    answersWithheld: !opts.answers && c.answers !== null,
    submittedAt: c.submitted_at, reviewedAt: c.reviewed_at, reviewedByName: c.reviewed_by ? nameOf(ctx, c.reviewed_by) : null, response: c.response, createdAt: c.created_at,
    ...(notes ? { notes } : {}),
  };
}

function checkinRow(ctx: Ctx, id: string): CheckinRow | undefined { return ctx.db.get<CheckinRow>('SELECT * FROM checkins WHERE id = ?', [id]); }

/** The member a check-in belongs to, when this coach is assigned to them; otherwise not found (nothing is revealed). */
export function checkinMemberForCoach(ctx: Ctx, coachId: string, id: string): string {
  const c = checkinRow(ctx, id);
  if (!c || !coachHasMember(ctx, coachId, c.member_id)) throw errors.notFound('Check-in');
  return c.member_id;
}

export function listMemberCheckins(ctx: Ctx, memberId: string, opts: { answers: boolean; notes?: boolean; limit?: number }) {
  return ctx.db.all<CheckinRow>("SELECT * FROM checkins WHERE member_id = ? ORDER BY CASE status WHEN 'requested' THEN 0 ELSE 1 END, due_date DESC, created_at DESC LIMIT ?", [memberId, opts.limit ?? 100]).map((c) => presentCheckin(ctx, c, opts));
}

export function memberCheckin(ctx: Ctx, memberId: string, id: string) {
  const c = checkinRow(ctx, id);
  if (!c || c.member_id !== memberId) throw errors.notFound('Check-in');
  return presentCheckin(ctx, c, { answers: true });
}

/** A coach's check-ins across assigned clients (the Today card): answers are never listed here. */
export function listCoachCheckins(ctx: Ctx, coachId: string, status: (typeof CHECKIN_STATUSES)[number]) {
  const rows = ctx.db.all<CheckinRow & { member_name: string }>("SELECT c.*, u.name AS member_name FROM checkins c JOIN users u ON u.id = c.member_id WHERE c.status = ? AND c.member_id IN (SELECT member_id FROM coach_assignments WHERE coach_id = ? AND status IN ('active','paused')) ORDER BY COALESCE(c.submitted_at, c.due_date) LIMIT 100", [status, coachId]);
  return rows.map((c) => ({ id: c.id, memberId: c.member_id, memberName: c.member_name, title: c.title, dueDate: c.due_date, status: c.status, submittedAt: c.submitted_at, healthShared: healthShared(ctx, c.member_id) }));
}

function insertCheckin(ctx: Ctx, input: { memberId: string; coachId: string; template: TemplateRow; dueDate: string; scheduleId: string | null }): CheckinRow {
  const id = ids.checkin();
  ctx.db.insert('checkins', { id, member_id: input.memberId, coach_id: input.coachId, template_id: input.template.id, schedule_id: input.scheduleId, title: input.template.title, questions: input.template.questions, due_date: input.dueDate, status: 'requested', answers: null, submitted_at: null, reviewed_at: null, reviewed_by: null, response: null, created_by: ctx.actor?.id ?? null, created_at: ctx.now() });
  audit(ctx, 'checkin.request', { type: 'checkin', id }, null, { memberId: input.memberId, coachId: input.coachId, templateId: input.template.id, scheduleId: input.scheduleId, dueDate: input.dueDate });
  return checkinRow(ctx, id)!;
}

/** A coach asks for one check-in now (outside any schedule). The member is told at once. */
export function requestCheckin(ctx: Ctx, coachId: string, memberId: string, input: { templateId: string; dueDate?: string }) {
  const t = usableTemplate(ctx, coachId, input.templateId);
  const due = input.dueDate ?? todayIn(ctx);
  if (!isRealDate(due)) throw errors.badRequest('Due date: use a real date as YYYY-MM-DD', 'VALUE_INVALID');
  if (due < todayIn(ctx)) throw errors.badRequest('The due date is in the past', 'DUE_DATE_PAST');
  const open = ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM checkins WHERE member_id = ? AND status = 'requested'", [memberId])!.n;
  if (open >= 5) throw errors.conflict('This member already has five check-ins waiting; let them catch up first', 'TOO_MANY_OPEN_CHECKINS');
  return ctx.db.tx(() => {
    const c = insertCheckin(ctx, { memberId, coachId, template: t, dueDate: due, scheduleId: null });
    notify(ctx, { userId: memberId, category: 'checkin', title: 'Your coach asked for a check-in', body: `${t.title}: a few short questions. Answer them under Check-ins.`, data: { checkinId: c.id } });
    return presentCheckin(ctx, c, { answers: true });
  });
}

export function listSchedules(ctx: Ctx, memberId: string) {
  return ctx.db.all<ScheduleRow>('SELECT * FROM checkin_schedules WHERE member_id = ? ORDER BY active DESC, created_at DESC LIMIT 20', [memberId]).map((s) => presentSchedule(ctx, s));
}

function endScheduleRow(ctx: Ctx, s: ScheduleRow, reason: string): void {
  ctx.db.update('checkin_schedules', s.id, { active: 0, ended_at: ctx.now() });
  audit(ctx, 'checkin.schedule_end', { type: 'checkin_schedule', id: s.id }, reason, { memberId: s.member_id, coachId: s.coach_id });
}

/** A weekly check-in for a client: replaces the member's active schedule, and requests this week's at once when today
 *  is the day. */
export function createSchedule(ctx: Ctx, coachId: string, memberId: string, input: { templateId: string; weekday: number }) {
  const t = usableTemplate(ctx, coachId, input.templateId);
  if (!Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6) throw errors.badRequest('weekday is 0 (Sunday) to 6 (Saturday)', 'VALUE_INVALID');
  const id = ids.schedule();
  ctx.db.tx(() => {
    for (const s of ctx.db.all<ScheduleRow>('SELECT * FROM checkin_schedules WHERE member_id = ? AND active = 1', [memberId])) endScheduleRow(ctx, s, 'replaced by a new weekly schedule');
    ctx.db.insert('checkin_schedules', { id, member_id: memberId, coach_id: coachId, template_id: t.id, weekday: input.weekday, active: 1, created_at: ctx.now(), ended_at: null });
    audit(ctx, 'checkin.schedule', { type: 'checkin_schedule', id }, null, { memberId, coachId, templateId: t.id, weekday: input.weekday });
  });
  const s = ctx.db.get<ScheduleRow>('SELECT * FROM checkin_schedules WHERE id = ?', [id])!;
  materialiseSchedule(ctx, s);
  notify(ctx, { userId: memberId, category: 'checkin', title: 'Weekly check-ins are set up', body: `Your coach will ask "${t.title}" every ${WEEKDAYS[input.weekday]}.`, data: { scheduleId: id } });
  return presentSchedule(ctx, s);
}

export function endSchedule(ctx: Ctx, memberId: string, scheduleId: string, reason: string) {
  const s = ctx.db.get<ScheduleRow>('SELECT * FROM checkin_schedules WHERE id = ? AND member_id = ?', [scheduleId, memberId]);
  if (!s) throw errors.notFound('Schedule');
  if (!s.active) throw errors.state('This schedule has already ended', { code: 'SCHEDULE_ENDED' });
  endScheduleRow(ctx, s, reason);
  return presentSchedule(ctx, ctx.db.get<ScheduleRow>('SELECT * FROM checkin_schedules WHERE id = ?', [s.id])!);
}

/** The latest due date of a schedule on or before today; creates that check-in if missing (earlier requested ones of
 *  the schedule become missed) and queues the member's reminder for the due day. Returns what changed. */
export function materialiseSchedule(ctx: Ctx, s: ScheduleRow): { created: number; missed: number } {
  const now = ctx.now();
  const back = (weekdayInZone(now) - s.weekday + 7) % 7;
  const due = dateInZone(addDays(now, -back));
  if (due < dateInZone(s.created_at)) return { created: 0, missed: 0 };
  if (ctx.db.get('SELECT 1 FROM checkins WHERE schedule_id = ? AND due_date = ?', [s.id, due])) return { created: 0, missed: 0 };
  // one check-in a day is enough: a check-in already waiting for that day (a one-off, or a replaced schedule's) stands
  if (ctx.db.get("SELECT 1 FROM checkins WHERE member_id = ? AND due_date = ? AND status = 'requested'", [s.member_id, due])) return { created: 0, missed: 0 };
  const template = ctx.db.get<TemplateRow>('SELECT * FROM checkin_templates WHERE id = ?', [s.template_id]);
  if (!template) return { created: 0, missed: 0 };
  const sys = system(ctx);
  return ctx.db.tx(() => {
    // the next one falling due closes every earlier check-in the member left unanswered
    const previous = ctx.db.all<{ id: string }>("SELECT id FROM checkins WHERE member_id = ? AND status = 'requested' AND due_date < ?", [s.member_id, due]);
    for (const p of previous) {
      ctx.db.update('checkins', p.id, { status: 'missed' });
      reminders.cancel(ctx, { refType: 'checkin', refId: p.id });
      audit(sys, 'checkin.missed', { type: 'checkin', id: p.id }, 'the next check-in fell due', { memberId: s.member_id });
    }
    const c = insertCheckin(sys, { memberId: s.member_id, coachId: s.coach_id, template, dueDate: due, scheduleId: s.id });
    const remindAt = zonedToIso(due, CHECKIN_REMINDER_MINUTE);
    reminders.schedule(ctx, { userId: s.member_id, refType: 'checkin', refId: c.id, dueAt: remindAt > now ? remindAt : now, category: 'checkin', title: 'Your weekly check-in is ready', body: `${template.title}: a few short questions for your coach.` });
    return { created: 1, missed: previous.length };
  });
}

/** The daily work (run hourly, idempotent): one check-in per active schedule and due date; a schedule whose coach is no
 *  longer assigned ends. */
export function materialiseAll(ctx: Ctx): { created: number; missed: number; ended: number } {
  const out = { created: 0, missed: 0, ended: 0 };
  const sys = system(ctx);
  for (const s of ctx.db.all<ScheduleRow>('SELECT * FROM checkin_schedules WHERE active = 1')) {
    if (!coachHasMember(ctx, s.coach_id, s.member_id)) { endScheduleRow(sys, s, 'the coach is no longer assigned'); out.ended++; continue; }
    const r = materialiseSchedule(ctx, s);
    out.created += r.created; out.missed += r.missed;
  }
  return out;
}

/** When a member gets a new coach, the previous coach's weekly schedule ends. */
export function onCoachAssigned(ctx: Ctx, payload: Record<string, unknown>): number {
  const memberId = String(payload.memberId ?? ''), coachId = String(payload.coachId ?? '');
  if (!memberId || !coachId) return 0;
  const stale = ctx.db.all<ScheduleRow>('SELECT * FROM checkin_schedules WHERE member_id = ? AND coach_id != ? AND active = 1', [memberId, coachId]);
  for (const s of stale) endScheduleRow(system(ctx), s, 'the member was assigned another coach');
  return stale.length;
}

function cleanAnswers(ctx: Ctx, questions: Question[], answers: Record<string, unknown>): Record<string, AnswerValue> {
  const out: Record<string, AnswerValue> = {};
  const fieldErrors: Array<{ path: string; message: string }> = [];
  for (const k of Object.keys(answers)) if (!questions.some((q) => q.key === k)) fieldErrors.push({ path: `answers.${k}`, message: 'Not a question of this check-in' });
  for (const q of questions) {
    const v = answers[q.key];
    const path = `answers.${q.key}`;
    if (v === undefined || v === null || v === '') { if (q.type !== 'text') fieldErrors.push({ path, message: 'Answer this question' }); continue; }
    if (q.type === 'scale_1_5') { if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 5) fieldErrors.push({ path, message: 'Choose 1 to 5' }); else out[q.key] = v; }
    else if (q.type === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) { fieldErrors.push({ path, message: 'Enter a number' }); continue; }
      if (q.metric) { const cfg = metricConfig(ctx).find((m) => m.metric === q.metric); if (cfg && ((cfg.min !== null && v < cfg.min) || (cfg.max !== null && v > cfg.max))) { fieldErrors.push({ path, message: `Between ${cfg.min} and ${cfg.max}` }); continue; } }
      out[q.key] = v;
    } else if (q.type === 'yes_no') { if (typeof v !== 'boolean') fieldErrors.push({ path, message: 'Answer yes or no' }); else out[q.key] = v; }
    else { if (typeof v !== 'string' || v.length > 2000) fieldErrors.push({ path, message: 'At most 2000 characters' }); else if (v.trim()) out[q.key] = v.trim(); }
  }
  if (fieldErrors.length) throw errors.validation(fieldErrors, `${fieldErrors[0]!.path}: ${fieldErrors[0]!.message}`);
  return out;
}

/** The member answers a requested check-in. Answers tied to an enabled metric are logged as self-reported entries. */
export function submitCheckin(ctx: Ctx, memberId: string, id: string, answers: Record<string, unknown>) {
  const c = checkinRow(ctx, id);
  if (!c || c.member_id !== memberId) throw errors.notFound('Check-in');
  if (c.status !== 'requested') throw errors.state(c.status === 'missed' ? 'This check-in closed when the next one fell due' : 'This check-in was already sent', { code: 'CHECKIN_CLOSED' });
  const questions = j.out<Question[]>(c.questions, []);
  const clean = cleanAnswers(ctx, questions, answers);
  const enabled = new Set(metricConfig(ctx).filter((m) => m.enabled).map((m) => m.metric));
  const now = ctx.now();
  const entries: string[] = [];
  ctx.db.tx(() => {
    for (const q of questions) {
      const v = clean[q.key];
      if (!q.metric || typeof v !== 'number' || !enabled.has(q.metric)) continue;
      const e = addProgress(ctx, { memberId, metric: q.metric, value: v, at: now, note: `Check-in: ${c.title}`, source: 'member' }) as { id: string } | undefined;
      if (e) entries.push(e.id);
    }
    ctx.db.update('checkins', c.id, { status: 'submitted', answers: j.in(clean), submitted_at: now });
    reminders.cancel(ctx, { refType: 'checkin', refId: c.id });
    audit(ctx, 'checkin.submit', { type: 'checkin', id: c.id }, null, { memberId, answered: Object.keys(clean).length, entries: entries.length });
    // the coach assigned now hears about it (a coach who has since been replaced does not)
    const coach = ctx.db.get<{ coach_id: string }>("SELECT coach_id FROM coach_assignments WHERE member_id = ? AND status IN ('active','paused') AND coach_id IS NOT NULL ORDER BY created_at DESC LIMIT 1", [memberId]);
    if (coach) notify(ctx, { userId: coach.coach_id, category: 'checkin', title: `${nameOf(ctx, memberId)} sent a check-in`, body: 'Open their record, then Goals and check-ins, to read it and reply.', data: { checkinId: c.id, memberId }, sensitive: true });
    emit(ctx, 'CheckinSubmitted', { type: 'checkin', id: c.id }, { memberId, coachId: c.coach_id });
  });
  evaluateGoals(ctx, memberId);
  return { ...presentCheckin(ctx, checkinRow(ctx, c.id)!, { answers: true }), entries };
}

/** An assigned coach with health access replies (shown to the member) and may add a private note for the coaching team. */
export function reviewCheckin(ctx: Ctx, coachId: string, id: string, input: { response?: string; privateNote?: string }) {
  const c = checkinRow(ctx, id);
  if (!c || !coachHasMember(ctx, coachId, c.member_id)) throw errors.notFound('Check-in');
  if (c.status !== 'submitted') throw errors.state(c.status === 'reviewed' ? 'This check-in was already reviewed' : 'Only a check-in the member has sent can be reviewed', { code: 'CHECKIN_NOT_SUBMITTED' });
  const now = ctx.now();
  const response = input.response?.trim() || null;
  ctx.db.tx(() => {
    ctx.db.update('checkins', c.id, { status: 'reviewed', reviewed_at: now, reviewed_by: coachId, response });
    if (input.privateNote?.trim()) ctx.db.insert('coach_notes', { id: ids.note(), coach_id: coachId, member_id: c.member_id, kind: 'review', visibility: 'private', author_role: 'coach', body: input.privateNote.trim(), ref_type: 'checkin', ref_id: c.id, created_at: now });
    audit(ctx, 'checkin.review', { type: 'checkin', id: c.id }, null, { memberId: c.member_id, replied: !!response, privateNote: !!input.privateNote?.trim() });
    notify(ctx, { userId: c.member_id, category: 'checkin', title: response ? 'Your coach replied to your check-in' : 'Your coach read your check-in', body: response ? 'Read the reply under Check-ins.' : 'See your answers under Check-ins.', data: { checkinId: c.id }, sensitive: true });
  });
  return presentCheckin(ctx, checkinRow(ctx, c.id)!, { answers: true, notes: true });
}

/* =====================================================================================================================
   Series over a range, and adherence
   ===================================================================================================================== */

/** One metric over a chosen range; every point carries its source and the source's label. A daily total (steps,
 *  water) has one point per India day: the largest of its sources' totals, with every source named (sources). */
export function series(ctx: Ctx, memberId: string, metric: string, from?: string, to?: string) {
  const cfg = metricFor(ctx, metric, { enabledOnly: false });
  const range = dateRange(ctx, from, to, 90);
  if (isDailyTotal(metric)) {
    const rows = ctx.db.all<DailyRow>(`${DAILY_ROWS} WHERE e.member_id = ? AND e.metric = ? AND e.at >= ? AND e.at < ? ORDER BY e.at, e.created_at LIMIT ?`, [memberId, metric, range.fromIso, range.toIso, SERIES_POINT_LIMIT * 4 + 1]);
    const points = dailyPoints(rows.slice(0, SERIES_POINT_LIMIT * 4));
    return {
      metric: cfg.metric, label: cfg.label, unit: cfg.unit, min: cfg.min, max: cfg.max, enabled: cfg.enabled, from: range.from, to: range.to,
      daily: true, points, truncated: rows.length > SERIES_POINT_LIMIT * 4, sources: PROGRESS_SOURCE_LABELS,
      note: 'One value a day: the largest of the totals its sources recorded (they are never added together). Laboratory results stay in your reports and are never mixed into these charts.',
    };
  }
  const rows = ctx.db.all<{ value: number; at: string; source: string }>('SELECT value, at, source FROM progress_entries WHERE member_id = ? AND metric = ? AND at >= ? AND at < ? ORDER BY at, created_at LIMIT ?', [memberId, metric, range.fromIso, range.toIso, SERIES_POINT_LIMIT + 1]);
  const truncated = rows.length > SERIES_POINT_LIMIT;
  const points = rows.slice(0, SERIES_POINT_LIMIT).map((r) => ({ at: r.at, value: r.value, source: r.source, sourceLabel: sourceLabel(r.source) }));
  return {
    metric: cfg.metric, label: cfg.label, unit: cfg.unit, min: cfg.min, max: cfg.max, enabled: cfg.enabled, from: range.from, to: range.to,
    points, truncated, sources: PROGRESS_SOURCE_LABELS,
    note: 'Each value shows where it came from. Laboratory results stay in your reports and are never mixed into these charts.',
  };
}

/** Plan actions due in the range (published plan, current version) and how many were done. */
export function planTasksAdherence(ctx: Ctx, memberId: string, range: { from: string; to: string }): AdherenceSummary {
  const fromIso = zonedToIso(range.from, 0);
  const endIso = zonedToIso(nextDate(range.to), 0);
  const until = endIso < ctx.now() ? endIso : ctx.now();
  const r = ctx.db.get<{ due: number; done: number | null; skipped: number | null }>("SELECT COUNT(*) due, SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) done, SUM(CASE WHEN t.status = 'skipped' THEN 1 ELSE 0 END) skipped FROM plan_tasks t JOIN coaching_plan_versions v ON v.id = t.plan_version_id JOIN coaching_plans p ON p.id = v.plan_id WHERE t.member_id = ? AND p.status = 'published' AND v.version = p.current_version AND t.due_at >= ? AND t.due_at <= ?", [memberId, fromIso, until]);
  const due = r?.due ?? 0, done = r?.done ?? 0, skipped = r?.skipped ?? 0;
  // the rule, like every other line of "How these are counted"; the skipped count is its own field (and said after the rule)
  return { key: 'plan_tasks', label: 'Plan actions', due, done, skipped, pct: due ? Math.round((100 * done) / due) : null, note: `Actions from the published coaching plan that were due so far in the range: one marked done counts, one marked skipped does not.${skipped ? ` ${skipped === 1 ? 'One was' : `${skipped} were`} marked skipped.` : ''}` };
}

/** Each registered adherence provider whose module is on, one line each; a provider that fails says so instead of
 *  breaking the others, and a module that is absent or off simply has no line. */
export function adherence(ctx: Ctx, memberId: string, from?: string, to?: string) {
  const range = dateRange(ctx, from, to, 28, 366);
  const items: AdherenceSummary[] = [];
  for (const m of MODULES) {
    const provider = m.adherence;
    if (!provider || !isEnabled(ctx, featureOf(m))) continue;
    try { items.push(provider.compute(ctx, memberId, { from: range.from, to: range.to })); }
    catch { items.push({ key: provider.key, label: provider.label, due: 0, done: 0, pct: null, note: 'Not available just now' }); }
  }
  return { from: range.from, to: range.to, items, note: 'Each line counts what was due in the range and how much was done. The lines are not combined into a score.' };
}

/* =====================================================================================================================
   Progress photos
   ===================================================================================================================== */

/** The progress_photos consent wording. Counsel has not approved wording yet (an owner decision), so the demo shows this
 *  draft, labelled as such, and every other mode refuses to record the consent and names what is missing. */
export const PHOTO_CONSENT = {
  // shown to members next to their consent, so it carries no "demo" (renamed from demo-draft-2026-10 on 24 October
  // 2026; the wording itself did not change)
  version: 'draft-2026-10',
  status: 'pending_counsel' as const,
  label: 'Draft wording, pending review by counsel',
  text: 'I agree that Bioptime stores the progress photos I add, privately, as part of my own progress record. Each photo stays hidden from my coach unless I share that photo, and my coach can open a shared photo only while I also share my health records with my coach. I can withdraw this consent at any time: my coach then loses access to every photo at once. I can delete any photo myself.',
  missing: 'Counsel-approved wording for the progress_photos consent, and the matching privacy notice update (owner decision)',
};

type PhotoRow = { id: string; member_id: string; file_id: string; pose: Pose; taken_at: string; share_with_coach: number; consent_version: string; created_at: string; deleted_at: string | null };

function presentPhoto(p: PhotoRow) {
  return { id: p.id, fileId: p.file_id, pose: p.pose, takenAt: p.taken_at, sharedWithCoach: !!p.share_with_coach, createdAt: p.created_at };
}

export function photoConsentState(ctx: Ctx, memberId: string) {
  const c = latestConsent(ctx, memberId, 'progress_photos');
  return { granted: c?.granted === true, version: c?.version ?? null, at: c?.at ?? null, wording: { version: PHOTO_CONSENT.version, status: PHOTO_CONSENT.status, label: PHOTO_CONSENT.label, text: PHOTO_CONSENT.text }, canGrant: ctx.config.isDemo, missing: ctx.config.isDemo ? null : PHOTO_CONSENT.missing };
}

/** Grant or withdraw the progress_photos consent. Withdrawing also stops sharing every photo, so granting again never
 *  re-shares one silently. */
export function setPhotoConsent(ctx: Ctx, memberId: string, granted: boolean, version?: string) {
  if (granted) {
    if (!ctx.config.isDemo) throw new AppError('CONSENT_WORDING_PENDING', 409, 'Progress photo consent cannot be recorded yet: its wording is pending', { missing: PHOTO_CONSENT.missing });
    if (version !== PHOTO_CONSENT.version) throw errors.badRequest('Agree to the current wording (its version changed); reload and read it again', 'CONSENT_VERSION');
  }
  ctx.db.tx(() => {
    setConsent(ctx, memberId, { kind: 'progress_photos', version: granted ? PHOTO_CONSENT.version : (latestConsent(ctx, memberId, 'progress_photos')?.version ?? PHOTO_CONSENT.version), granted });
    if (!granted) {
      const shared = ctx.db.all<{ id: string }>('SELECT id FROM progress_photos WHERE member_id = ? AND share_with_coach = 1 AND deleted_at IS NULL', [memberId]);
      for (const p of shared) {
        ctx.db.update('progress_photos', p.id, { share_with_coach: 0 });
        audit(ctx, 'progress_photo.unshare', { type: 'progress_photo', id: p.id }, 'progress photo consent withdrawn', { memberId });
      }
    }
  });
  return photoConsentState(ctx, memberId);
}

export function listPhotos(ctx: Ctx, memberId: string) {
  const rows = ctx.db.all<PhotoRow>('SELECT * FROM progress_photos WHERE member_id = ? AND deleted_at IS NULL ORDER BY taken_at DESC, created_at DESC', [memberId]);
  return { items: rows.map(presentPhoto), consent: photoConsentState(ctx, memberId), healthShared: healthShared(ctx, memberId), retentionDays: getSetting<number | null>(ctx, 'progress_photo_retention_days') ?? null, maxBytes: PHOTO_MAX_BYTES, types: ['JPEG', 'PNG', 'WebP'] };
}

function decodeBase64(data: string): Buffer {
  const body = data.replace(/^data:[\w/+.-]+;base64,/, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) throw errors.badRequest('The file must be sent as base64', 'FILE_ENCODING');
  return Buffer.from(body, 'base64');
}

/** Store one photo: the switch must be on, the consent current; type by content, size capped, private store. */
export function uploadPhoto(ctx: Ctx, memberId: string, input: { dataBase64: string; filename?: string; pose: Pose; takenAt?: string; shareWithCoach?: boolean }) {
  if (!consentCurrent(ctx, memberId, 'progress_photos')) throw errors.forbidden('Agree to the progress photo consent before adding photos', 'PHOTO_CONSENT_REQUIRED');
  const count = ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM progress_photos WHERE member_id = ? AND deleted_at IS NULL', [memberId])!.n;
  if (count >= MAX_PHOTOS) throw errors.conflict(`At most ${MAX_PHOTOS} photos; delete some first`, 'TOO_MANY_PHOTOS');
  const now = ctx.now();
  const takenAt = input.takenAt ? new Date(input.takenAt).toISOString() : now;
  if (Date.parse(takenAt) > Date.parse(now) + 5 * 60_000) throw errors.badRequest('A photo cannot be taken in the future', 'TAKEN_AT_FUTURE');
  const id = ids.photo();
  const saved = files.savePrivateFile(ctx, { ownerId: memberId, kind: PHOTO_FILE_KIND, buffer: decodeBase64(input.dataBase64), allowedMimes: PHOTO_MIMES, maxBytes: PHOTO_MAX_BYTES, ref: { type: 'progress_photo', id }, name: input.filename });
  try {
    ctx.db.insert('progress_photos', { id, member_id: memberId, file_id: saved.id, pose: input.pose, taken_at: takenAt, share_with_coach: input.shareWithCoach ? 1 : 0, consent_version: latestConsent(ctx, memberId, 'progress_photos')!.version, created_at: now, deleted_at: null });
  } catch (e) {
    files.removePrivateFile(ctx, saved.id, 'progress photo row could not be written');
    throw e;
  }
  audit(ctx, 'progress_photo.upload', { type: 'progress_photo', id }, null, { memberId, fileId: saved.id, pose: input.pose, shared: !!input.shareWithCoach, bytes: saved.size, mime: saved.mime });
  return presentPhoto(ctx.db.get<PhotoRow>('SELECT * FROM progress_photos WHERE id = ?', [id])!);
}

function photoRow(ctx: Ctx, memberId: string, id: string): PhotoRow {
  const p = ctx.db.get<PhotoRow>('SELECT * FROM progress_photos WHERE id = ? AND member_id = ? AND deleted_at IS NULL', [id, memberId]);
  if (!p) throw errors.notFound('Photo');
  return p;
}

export function setPhotoShared(ctx: Ctx, memberId: string, id: string, share: boolean) {
  const p = photoRow(ctx, memberId, id);
  if (share && !consentCurrent(ctx, memberId, 'progress_photos')) throw errors.forbidden('Agree to the progress photo consent before sharing a photo', 'PHOTO_CONSENT_REQUIRED');
  if (!!p.share_with_coach !== share) {
    ctx.db.update('progress_photos', p.id, { share_with_coach: share ? 1 : 0 });
    audit(ctx, share ? 'progress_photo.share' : 'progress_photo.unshare', { type: 'progress_photo', id: p.id }, null, { memberId });
  }
  return presentPhoto(photoRow(ctx, memberId, id));
}

function deletePhotoRow(ctx: Ctx, p: PhotoRow, reason: string): void {
  ctx.db.update('progress_photos', p.id, { deleted_at: ctx.now(), share_with_coach: 0 });
  if (files.getFile(ctx, p.file_id)) files.removePrivateFile(ctx, p.file_id, reason);
  audit(ctx, 'progress_photo.delete', { type: 'progress_photo', id: p.id }, reason, { memberId: p.member_id, fileId: p.file_id });
}

/** The member deletes a photo: the row is marked deleted and the bytes are removed from disk at once. */
export function deletePhoto(ctx: Ctx, memberId: string, id: string) {
  deletePhotoRow(ctx, photoRow(ctx, memberId, id), 'deleted by the member');
  return { deleted: true };
}

/** A coach: the shared photos of an assigned client whose photo consent is current (the route checks assignment and
 *  health sharing first). */
export function coachPhotos(ctx: Ctx, memberId: string) {
  if (!consentCurrent(ctx, memberId, 'progress_photos')) return { items: [], withheld: 'photo_consent' as const };
  const rows = ctx.db.all<PhotoRow>('SELECT * FROM progress_photos WHERE member_id = ? AND share_with_coach = 1 AND deleted_at IS NULL ORDER BY taken_at DESC', [memberId]);
  return { items: rows.map((p) => ({ id: p.id, fileId: p.file_id, pose: p.pose, takenAt: p.taken_at })), withheld: null };
}

/** Who may open a progress photo file: its member; an assigned coach while the photo is shared, both consents are
 *  current and the photo switches are on (each opening audited once per token lifetime as progress_photo.view);
 *  nobody else (administrators see counts only). Runs at token issue and again at download. */
export function photoFileAccess(ctx: Ctx, file: FileRow): boolean {
  const actor = ctx.actor;
  if (!actor) return false;
  const p = ctx.db.get<PhotoRow>('SELECT * FROM progress_photos WHERE file_id = ? AND deleted_at IS NULL', [file.id]);
  if (!p) return false;
  if (actor.role === 'member') return actor.id === p.member_id && file.owner_id === p.member_id;
  if (actor.role !== 'coach') return false;
  const allowed = isEnabled(ctx, MODULE_FLAG) && isEnabled(ctx, PHOTOS_FLAG) && !!p.share_with_coach && coachHasMember(ctx, actor.id, p.member_id) && consentCurrent(ctx, p.member_id, 'progress_photos') && consentCurrent(ctx, p.member_id, 'coach_sharing');
  if (!allowed) return false;
  const since = new Date(Date.parse(ctx.now()) - files.FILE_TOKEN_SECONDS * 1000).toISOString();
  const recent = ctx.db.get("SELECT 1 FROM audit_events WHERE action = 'progress_photo.view' AND target_id = ? AND actor_id = ? AND at >= ? LIMIT 1", [p.id, actor.id, since]);
  if (!recent) audit(ctx, 'progress_photo.view', { type: 'progress_photo', id: p.id }, null, { memberId: p.member_id, fileId: file.id });
  return true;
}

/** Retention (an owner decision): with progress_photo_retention_days set, photos stored longer are deleted; null keeps
 *  them until the member deletes them. Runs even while the module is off, since it is privacy clean-up. */
export function applyPhotoRetention(ctx: Ctx): { deleted: number; retentionDays: number | null } {
  const days = getSetting<number | null>(ctx, 'progress_photo_retention_days') ?? null;
  if (!days) return { deleted: 0, retentionDays: null };
  const cutoff = addDays(ctx.now(), -days);
  const old = ctx.db.all<PhotoRow>('SELECT * FROM progress_photos WHERE deleted_at IS NULL AND created_at < ? LIMIT 500', [cutoff]);
  for (const p of old) deletePhotoRow(system(ctx), p, `retention: stored longer than ${days} days`);
  return { deleted: old.length, retentionDays: days };
}

/* =====================================================================================================================
   Administrator overview of one member (counts; no answers, no photos)
   ===================================================================================================================== */

export function memberOverview(ctx: Ctx, memberId: string) {
  const count = (sql: string) => Object.fromEntries(ctx.db.all<{ k: string; n: number }>(sql, [memberId]).map((r) => [r.k, r.n]));
  const photos = ctx.db.get<{ total: number; shared: number | null }>('SELECT COUNT(*) total, SUM(share_with_coach) shared FROM progress_photos WHERE member_id = ? AND deleted_at IS NULL', [memberId])!;
  const consent = latestConsent(ctx, memberId, 'progress_photos');
  return {
    goals: { byStatus: count('SELECT status k, COUNT(*) n FROM goals WHERE member_id = ? GROUP BY status'), items: listGoals(ctx, memberId, { values: true }) },
    checkins: { byStatus: count('SELECT status k, COUNT(*) n FROM checkins WHERE member_id = ? GROUP BY status'), items: listMemberCheckins(ctx, memberId, { answers: false, limit: 20 }) },
    schedules: listSchedules(ctx, memberId),
    photos: { total: photos.total, shared: photos.shared ?? 0, consentGranted: consent?.granted === true, note: 'Administrators see counts only; photos open for the member and, when shared, their assigned coach.' },
  };
}

/* =====================================================================================================================
   The member's data export (ApiModule.exportSections, api/domain/dataExport.ts)
   Only what the member's own screens show, read straight from the tables (no automatic evaluation runs, so exporting
   changes nothing): never the coaching team's private notes on a check-in, never another person's contact details
   (people are named, nothing more), never a file's bytes or storage details. Photos are listed by name, type and date.
   ===================================================================================================================== */

/** Goals and their milestones, with the values the member sees on their own goals. */
export function exportGoals(ctx: Ctx, memberId: string) {
  const goals = ctx.db.all<GoalRow>('SELECT * FROM goals WHERE member_id = ? ORDER BY created_at', [memberId]);
  return goals.map((g) => {
    const cfg = g.metric ? metricConfig(ctx).find((m) => m.metric === g.metric) : undefined;
    const milestones = ctx.db.all<MilestoneRow>('SELECT * FROM goal_milestones WHERE goal_id = ? ORDER BY sort, created_at', [g.id]);
    return {
      title: g.title, setBy: g.created_by_role === 'coach' ? 'your coach' : 'you', metric: g.metric, metricLabel: cfg?.label ?? null, unit: g.unit,
      startingValue: g.baseline_value, targetValue: g.target_value, targetDate: g.target_date, status: g.status, achievedAt: g.achieved_at, achievedHow: g.achieved_how,
      setAt: g.created_at, updatedAt: g.updated_at,
      milestones: milestones.map((m) => ({ title: m.title, targetValue: m.target_value, dueDate: m.due_date, reachedAt: m.achieved_at })),
    };
  });
}

/** Check-ins: the questions, the member's answers and the coach's reply (never the team's private note). */
export function exportCheckins(ctx: Ctx, memberId: string) {
  return ctx.db.all<CheckinRow>('SELECT * FROM checkins WHERE member_id = ? ORDER BY due_date, created_at', [memberId]).map((c) => ({
    title: c.title, coach: nameOf(ctx, c.coach_id), dueDate: c.due_date, status: c.status,
    questions: j.out<Question[]>(c.questions, []).map((q) => ({ key: q.key, label: q.label, type: q.type })),
    yourAnswers: j.out<Record<string, AnswerValue> | null>(c.answers, null), sentAt: c.submitted_at,
    coachReply: c.response, repliedBy: c.reviewed_by ? nameOf(ctx, c.reviewed_by) : null, reviewedAt: c.reviewed_at, askedAt: c.created_at,
  }));
}

/** Weekly check-in schedules: which check-in, on which day, from which coach, and when it ran. */
export function exportSchedules(ctx: Ctx, memberId: string) {
  return ctx.db.all<ScheduleRow>('SELECT * FROM checkin_schedules WHERE member_id = ? ORDER BY created_at', [memberId]).map((s) => {
    const t = ctx.db.get<{ title: string }>('SELECT title FROM checkin_templates WHERE id = ?', [s.template_id]);
    return { checkin: t?.title ?? '', weekday: WEEKDAYS[s.weekday], coach: nameOf(ctx, s.coach_id), active: !!s.active, startedAt: s.created_at, endedAt: s.ended_at };
  });
}

/** Progress photos the member still has: name, type and the date taken only; each one opens in the app. */
export function exportPhotos(ctx: Ctx, memberId: string) {
  return ctx.db.all<{ name: string | null; mime: string | null; taken_at: string }>('SELECT f.name, f.mime, p.taken_at FROM progress_photos p LEFT JOIN file_metadata f ON f.id = p.file_id WHERE p.member_id = ? AND p.deleted_at IS NULL ORDER BY p.taken_at', [memberId])
    .map((p) => ({ name: p.name, type: p.mime, takenAt: p.taken_at }));
}
