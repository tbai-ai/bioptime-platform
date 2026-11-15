/* Coaching plans with versions, tasks the member completes, and progress entries with units, timestamps and sources.

   Daily totals (steps, water: DAILY_TOTAL_METRICS) are counted over an India day. Each source keeps one entry per day,
   keyed in progress_daily_totals (0039_progress_daily.sql), written by putDailyTotal and updated in place: a phone sends
   its step count as often as it likes and the day still has one value from it. A day's value is the largest across its sources, never their sum (a
   phone and the member counting the same walk would double it), and every point names the sources it came from. */
import type { Ctx } from '../context.js';
import { DAILY_TOTAL_MAX_DAYS_BACK, DAILY_TOTAL_METRICS, PROGRESS_METRICS, PROGRESS_PROVIDER_LABELS, PROGRESS_SOURCE_LABELS, type DailyTotalMetric, type ProgressProvider, type ProgressSource } from '@bioptime/domain';
import { ids } from '../lib/ids.js';
import { errors } from '../lib/errors.js';
import { addDays, dateInZone, zonedToIso } from '../lib/time.js';
import { j } from '../db/db.js';
import { audit, emit } from './audit.js';
import { notify } from './notifications.js';

export type PlanStructure = { weeks: Array<{ week: number; focus?: string; tasks: Array<{ title: string; kind?: string; day?: number; note?: string }> }>; reviewSchedule?: string; progressIndicators?: string[] };

const METRIC_UNITS: Record<string, string> = { weight_kg: 'kg', waist_cm: 'cm', resting_hr_bpm: 'bpm', sleep_hours: 'h', steps: 'steps', energy_1_5: '/5', wellbeing_1_5: '/5', habit_adherence_pct: '%', workout_minutes: 'min', water_ml: 'ml' };

type PlanRow = { id: string; member_id: string; coach_id: string; programme_id: string | null; title: string; goals: string; status: string; current_version: number; created_at: string; updated_at: string; archived_at: string | null; coach_name: string; member_name: string };

export function presentPlan(ctx: Ctx, planId: string, opts: { includeDraft?: boolean } = {}) {
  const p = ctx.db.get<PlanRow>('SELECT p.*, c.name AS coach_name, m.name AS member_name FROM coaching_plans p JOIN users c ON c.id = p.coach_id JOIN users m ON m.id = p.member_id WHERE p.id = ?', [planId]);
  if (!p) throw errors.notFound('Plan');
  type VersionRow = { id: string; plan_id: string; version: number; summary: string; structure: string; status: string; created_by: string; created_at: string; published_at: string | null };
  const versions = ctx.db.all<VersionRow>(`SELECT * FROM coaching_plan_versions WHERE plan_id = ? ${opts.includeDraft ? '' : "AND status = 'published'"} ORDER BY version DESC`, [planId]).map((v) => ({ ...v, structure: j.out<PlanStructure>(v.structure, { weeks: [] }) }));
  const current = versions[0];
  const tasks = current ? ctx.db.all('SELECT * FROM plan_tasks WHERE plan_version_id = ? ORDER BY week, day, sort', [current.id]) : [];
  return { ...p, goals: j.out<string[]>(p.goals, []), currentVersion: current ?? null, versions: versions.map((v) => ({ id: v.id, version: v.version, status: v.status, summary: v.summary, createdAt: v.created_at, publishedAt: v.published_at })), tasks };
}

export function createPlan(ctx: Ctx, input: { coachId: string; memberId: string; programmeId?: string | null; title: string; goals: string[]; summary?: string; structure: PlanStructure }) {
  const now = ctx.now();
  const id = ids.plan();
  ctx.db.tx(() => {
    ctx.db.insert('coaching_plans', { id, member_id: input.memberId, coach_id: input.coachId, programme_id: input.programmeId ?? null, title: input.title, goals: j.in(input.goals), status: 'draft', current_version: 1, created_at: now, updated_at: now });
    ctx.db.insert('coaching_plan_versions', { id: ids.planVersion(), plan_id: id, version: 1, summary: input.summary ?? '', structure: j.in(input.structure), status: 'draft', created_by: input.coachId, created_at: now });
    audit(ctx, 'plan.create', { type: 'coaching_plan', id }, null, { memberId: input.memberId });
  });
  return presentPlan(ctx, id, { includeDraft: true });
}

export function updateDraft(ctx: Ctx, planId: string, patch: { title?: string; goals?: string[]; summary?: string; structure?: PlanStructure }) {
  const p = ctx.db.get<{ id: string; status: string; current_version: number }>('SELECT * FROM coaching_plans WHERE id = ?', [planId]);
  if (!p) throw errors.notFound('Plan');
  const now = ctx.now();
  ctx.db.tx(() => {
    let draft = ctx.db.get<{ id: string; version: number }>("SELECT id, version FROM coaching_plan_versions WHERE plan_id = ? AND status = 'draft' ORDER BY version DESC LIMIT 1", [planId]);
    if (!draft) {
      // a published plan gets a new draft version; the published one stays live until the draft is published
      const last = ctx.db.get<{ version: number; summary: string; structure: string }>('SELECT version, summary, structure FROM coaching_plan_versions WHERE plan_id = ? ORDER BY version DESC LIMIT 1', [planId])!;
      const vid = ids.planVersion();
      ctx.db.insert('coaching_plan_versions', { id: vid, plan_id: planId, version: last.version + 1, summary: last.summary, structure: last.structure, status: 'draft', created_by: ctx.actor?.id ?? 'system', created_at: now });
      draft = { id: vid, version: last.version + 1 };
    }
    ctx.db.update('coaching_plan_versions', draft.id, { summary: patch.summary, structure: patch.structure ? j.in(patch.structure) : undefined });
    ctx.db.update('coaching_plans', planId, { title: patch.title, goals: patch.goals ? j.in(patch.goals) : undefined, updated_at: now });
    audit(ctx, 'plan.update_draft', { type: 'coaching_plan', id: planId }, null, { version: draft.version });
  });
  return presentPlan(ctx, planId, { includeDraft: true });
}

/** Publishing freezes the version, generates the member's tasks with due dates, and tells the member. */
export function publish(ctx: Ctx, planId: string, startDate?: string) {
  return ctx.db.tx(() => {
    const p = ctx.db.get<{ id: string; member_id: string; coach_id: string; title: string }>('SELECT * FROM coaching_plans WHERE id = ?', [planId]);
    if (!p) throw errors.notFound('Plan');
    const draft = ctx.db.get<{ id: string; version: number; structure: string }>("SELECT * FROM coaching_plan_versions WHERE plan_id = ? AND status = 'draft' ORDER BY version DESC LIMIT 1", [planId]);
    if (!draft) throw errors.state('Nothing to publish: there is no draft version');
    const now = ctx.now();
    const start = startDate ? `${startDate}T00:00:00.000Z` : now;
    const structure = j.out<PlanStructure>(draft.structure, { weeks: [] });
    if (!structure.weeks?.length) throw errors.badRequest('Add at least one week with tasks before publishing');
    ctx.db.run("UPDATE coaching_plan_versions SET status = 'published' WHERE plan_id = ? AND status = 'published' AND id != ?", [planId, draft.id]); // keep history; only the newest is served
    ctx.db.update('coaching_plan_versions', draft.id, { status: 'published', published_at: now });
    ctx.db.update('coaching_plans', planId, { status: 'published', current_version: draft.version, updated_at: now });
    // carry completion of identical tasks from the previous version so publishing a revision does not reset the member
    const previousDone = new Set(ctx.db.all<{ title: string; week: number | null; day: number | null }>("SELECT t.title, t.week, t.day FROM plan_tasks t JOIN coaching_plan_versions v ON v.id = t.plan_version_id WHERE v.plan_id = ? AND t.status = 'done'", [planId]).map((t) => `${t.week}|${t.day}|${t.title}`));
    let sort = 0;
    for (const w of structure.weeks) for (const t of w.tasks) {
      const dayOffset = (w.week - 1) * 7 + ((t.day ?? 1) - 1);
      const key = `${w.week}|${t.day ?? null}|${t.title}`;
      ctx.db.insert('plan_tasks', { id: ids.task(), plan_version_id: draft.id, member_id: p.member_id, title: t.title, kind: t.kind ?? 'habit', week: w.week, day: t.day ?? null, due_at: addDays(start, dayOffset), status: previousDone.has(key) ? 'done' : 'pending', completed_at: previousDone.has(key) ? now : null, sort: sort++, created_at: now });
    }
    notify(ctx, { userId: p.member_id, category: 'programme', title: draft.version === 1 ? 'Your coaching plan is ready' : 'Your plan was updated', body: `${p.title}: this week’s actions are ready to see.`, data: { planId, version: draft.version } });
    emit(ctx, 'PlanPublished', { type: 'coaching_plan', id: planId }, { memberId: p.member_id, version: draft.version });
    audit(ctx, 'plan.publish', { type: 'coaching_plan', id: planId }, null, { version: draft.version, tasks: sort });
    return presentPlan(ctx, planId, { includeDraft: true });
  });
}

export function archive(ctx: Ctx, planId: string, reason: string) {
  ctx.db.update('coaching_plans', planId, { status: 'archived', archived_at: ctx.now(), updated_at: ctx.now() });
  audit(ctx, 'plan.archive', { type: 'coaching_plan', id: planId }, reason);
}

export function memberPlan(ctx: Ctx, memberId: string) {
  const p = ctx.db.get<{ id: string }>("SELECT id FROM coaching_plans WHERE member_id = ? AND status = 'published' ORDER BY updated_at DESC LIMIT 1", [memberId]);
  return p ? presentPlan(ctx, p.id) : null;
}

export function listPlans(ctx: Ctx, opts: { coachId?: string; memberId?: string; includeDraft?: boolean }) {
  const where: string[] = [];
  const params: string[] = [];
  if (opts.coachId) { where.push('coach_id = ?'); params.push(opts.coachId); }
  if (opts.memberId) { where.push('member_id = ?'); params.push(opts.memberId); }
  if (!opts.includeDraft) where.push("status = 'published'");
  return ctx.db.all<{ id: string }>(`SELECT id FROM coaching_plans ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY updated_at DESC`, params).map((r) => presentPlan(ctx, r.id, { includeDraft: !!opts.includeDraft }));
}

/* ---------- tasks ---------- */
export function listTasks(ctx: Ctx, memberId: string, opts: { from?: string; to?: string; status?: string } = {}) {
  const where = ['t.member_id = ?', "v.status = 'published'"];
  const params: string[] = [memberId];
  if (opts.from) { where.push('substr(t.due_at, 1, 10) >= ?'); params.push(opts.from); }
  if (opts.to) { where.push('substr(t.due_at, 1, 10) <= ?'); params.push(opts.to); }
  if (opts.status) { where.push('t.status = ?'); params.push(opts.status); }
  return ctx.db.all(`SELECT t.* FROM plan_tasks t JOIN coaching_plan_versions v ON v.id = t.plan_version_id JOIN coaching_plans p ON p.id = v.plan_id WHERE ${where.join(' AND ')} AND p.status = 'published' AND v.version = p.current_version ORDER BY t.due_at, t.sort`, params);
}

export function setTaskStatus(ctx: Ctx, memberId: string, taskId: string, status: 'pending' | 'done' | 'skipped') {
  const t = ctx.db.get<{ id: string; member_id: string; status: string }>('SELECT * FROM plan_tasks WHERE id = ?', [taskId]);
  if (!t || t.member_id !== memberId) throw errors.notFound('Task');
  if (t.status === status) return t;
  ctx.db.update('plan_tasks', taskId, { status, completed_at: status === 'done' ? ctx.now() : null });
  audit(ctx, 'task.status', { type: 'plan_task', id: taskId }, null, { from: t.status, to: status });
  return ctx.db.get('SELECT * FROM plan_tasks WHERE id = ?', [taskId]);
}

/* ---------- progress ---------- */
export function metricConfig(ctx: Ctx) {
  const rows = ctx.db.all<{ metric: string; label: string; unit: string; enabled: number; min_value: number | null; max_value: number | null; sort: number }>('SELECT * FROM metric_config ORDER BY sort');
  if (rows.length) return rows.map((r) => ({ metric: r.metric, label: r.label, unit: r.unit, enabled: !!r.enabled, min: r.min_value, max: r.max_value }));
  return PROGRESS_METRICS.map((m, i) => ({ metric: m, label: m.replace(/_/g, ' '), unit: METRIC_UNITS[m] ?? '', enabled: true, min: null, max: null, sort: i }));
}

export function setMetricEnabled(ctx: Ctx, metric: string, enabled: boolean, reason?: string) {
  if (!ctx.db.get('SELECT 1 FROM metric_config WHERE metric = ?', [metric])) throw errors.notFound('Metric');
  ctx.db.run('UPDATE metric_config SET enabled = ? WHERE metric = ?', [enabled ? 1 : 0, metric]);
  audit(ctx, 'metric.config', { type: 'metric', id: metric }, reason ?? null, { enabled });
  return metricConfig(ctx);
}

export function addProgress(ctx: Ctx, input: { memberId: string; metric: string; value: number; at?: string; note?: string; source: 'member' | 'coach' | 'device' }) {
  const cfg = metricConfig(ctx).find((m) => m.metric === input.metric);
  if (!cfg || !cfg.enabled) throw errors.badRequest('That metric is not enabled', 'METRIC_DISABLED');
  if (cfg.min !== null && input.value < cfg.min) throw errors.badRequest(`${cfg.label} cannot be below ${cfg.min}`);
  if (cfg.max !== null && input.value > cfg.max) throw errors.badRequest(`${cfg.label} cannot be above ${cfg.max}`);
  const id = ids.progress();
  ctx.db.insert('progress_entries', { id, member_id: input.memberId, metric: input.metric, value: input.value, unit: cfg.unit, at: input.at ?? ctx.now(), source: input.source, note: input.note ?? null, created_by: ctx.actor?.id ?? null, created_at: ctx.now() });
  return ctx.db.get('SELECT * FROM progress_entries WHERE id = ?', [id]);
}

export function listProgress(ctx: Ctx, memberId: string, opts: { metric?: string; from?: string; limit: number }) {
  const where = ['e.member_id = ?'];
  const params: (string | number)[] = [memberId];
  if (opts.metric) { where.push('e.metric = ?'); params.push(opts.metric); }
  if (opts.from) { where.push('e.at >= ?'); params.push(opts.from); }
  // a daily total names its day and provider (null on every other entry)
  return ctx.db.all(`SELECT e.*, d.day, NULLIF(d.provider, '') AS provider FROM progress_entries e LEFT JOIN progress_daily_totals d ON d.entry_id = e.id WHERE ${where.join(' AND ')} ORDER BY e.at DESC LIMIT ?`, [...params, opts.limit]);
}

export function progressSummary(ctx: Ctx, memberId: string) {
  const metrics = metricConfig(ctx).filter((m) => m.enabled);
  const taskStats = ctx.db.get<{ total: number; done: number; skipped: number }>("SELECT COUNT(*) total, SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) done, SUM(CASE WHEN t.status = 'skipped' THEN 1 ELSE 0 END) skipped FROM plan_tasks t JOIN coaching_plan_versions v ON v.id = t.plan_version_id JOIN coaching_plans p ON p.id = v.plan_id WHERE t.member_id = ? AND p.status = 'published' AND v.version = p.current_version AND t.due_at <= ?", [memberId, ctx.now()]);
  return {
    programmeCompletion: taskStats && taskStats.total ? Math.round((100 * (taskStats.done ?? 0)) / taskStats.total) : null,
    tasks: taskStats ?? { total: 0, done: 0, skipped: 0 },
    metrics: metrics.map((m) => {
      if (isDailyTotal(m.metric)) {
        // one point per day (the last twelve days with a value), each naming its sources
        const days = dailyPoints(ctx.db.all<DailyRow>(`${DAILY_ROWS} WHERE e.member_id = ? AND e.metric = ? ORDER BY e.at DESC LIMIT 1000`, [memberId, m.metric])).slice(-12);
        return { ...m, daily: true, latest: days[days.length - 1] ?? null, series: days };
      }
      const rows = ctx.db.all<{ value: number; at: string; source: string }>('SELECT value, at, source FROM progress_entries WHERE member_id = ? AND metric = ? ORDER BY at DESC LIMIT 12', [memberId, m.metric]);
      return { ...m, latest: rows[0] ?? null, series: rows.slice().reverse() };
    }),
    note: 'Member-entered values are self-reported; device values come from connected apps; none are laboratory measurements.',
  };
}

/* ---------- daily totals ---------- */

export function isDailyTotal(metric: string): metric is DailyTotalMetric { return (DAILY_TOTAL_METRICS as readonly string[]).includes(metric); }

/** The label of an entry's origin: the provider's when it has one ("From this phone"), else the source's. */
export function entryLabel(source: string, provider: string | null | undefined): string {
  if (provider && provider in PROGRESS_PROVIDER_LABELS) return PROGRESS_PROVIDER_LABELS[provider as ProgressProvider];
  return PROGRESS_SOURCE_LABELS[source as ProgressSource] ?? source;
}

export type DailyRow = { value: number; at: string; source: string; provider: string | null; day: string | null };
/** Progress entries (alias e) with the day and provider of the daily totals among them (null on every other entry). */
export const DAILY_ROWS = "SELECT e.value, e.at, e.source, NULLIF(d.provider, '') AS provider, d.day FROM progress_entries e LEFT JOIN progress_daily_totals d ON d.entry_id = e.id";
export type DailySource = { source: string; provider: string | null; label: string; value: number };
/** One India day of a daily-total metric: the largest of its sources' totals, where it came from, and every source. */
export type DailyPoint = { day: string; at: string; value: number; source: string; provider: string | null; sourceLabel: string; sources: DailySource[] };

/** When values are equal, the order sources are named in (a counted value before a typed one). */
const SOURCE_ORDER = ['device', 'member', 'coach', 'import'];

/** Rows of one daily-total metric as one point per India day, oldest first. A row written by PUT /me/progress/daily is
 *  its source's total for its day; an older row (POST /me/progress, no day) counts in the India day of its time, and
 *  several of one source on one day count as the largest of them. */
export function dailyPoints(rows: DailyRow[]): DailyPoint[] {
  const byDay = new Map<string, Map<string, { source: string; provider: string | null; value: number; at: string }>>();
  for (const r of rows) {
    const day = r.day ?? dateInZone(r.at);
    const sources = byDay.get(day) ?? new Map();
    byDay.set(day, sources);
    const key = `${r.source}|${r.provider ?? ''}`;
    const prev = sources.get(key);
    if (!prev || r.value > prev.value || (r.value === prev.value && r.at > prev.at)) sources.set(key, { source: r.source, provider: r.provider, value: r.value, at: r.at });
  }
  return [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([day, sources]) => {
    const list = [...sources.values()].sort((a, b) => b.value - a.value || SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source));
    const top = list[0]!;
    return { day, at: top.at, value: top.value, source: top.source, provider: top.provider, sourceLabel: entryLabel(top.source, top.provider), sources: list.map((x) => ({ source: x.source, provider: x.provider, label: entryLabel(x.source, x.provider), value: x.value })) };
  });
}

/** The value of one India day for a daily-total metric (null when nothing was logged that day). */
export function dailyValue(ctx: Ctx, memberId: string, metric: DailyTotalMetric, date: string): DailyPoint | null {
  const next = dateInZone(addDays(zonedToIso(date, 12 * 60), 1));
  const rows = ctx.db.all<DailyRow>(`${DAILY_ROWS} WHERE e.member_id = ? AND e.metric = ? AND e.at >= ? AND e.at < ?`, [memberId, metric, zonedToIso(date, 0), zonedToIso(next, 0)]);
  return dailyPoints(rows)[0] ?? null;
}

/** Today's steps and water (India date) for the home screen, for the daily metrics that are switched on; null where
 *  nothing was logged today. */
export function todayTotals(ctx: Ctx, memberId: string) {
  const date = dateInZone(ctx.now());
  const on = new Set(metricConfig(ctx).filter((m) => m.enabled).map((m) => m.metric));
  const value = (m: DailyTotalMetric) => (on.has(m) ? dailyValue(ctx, memberId, m, date)?.value ?? null : null);
  return { date, steps: value('steps'), waterMl: value('water_ml'), metrics: DAILY_TOTAL_METRICS.filter((m) => on.has(m)) };
}

function daysBetween(a: string, b: string): number { return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000); }

/** One source's total for one India day (PUT /me/progress/daily): created, or updated in place, so sending the same
 *  total again changes nothing. Needs the member's current health_data consent; the metric must be on and the value in
 *  its range; the date is today or up to DAILY_TOTAL_MAX_DAYS_BACK days before. A row's time is now for today and the
 *  day's last minute for an earlier day, so it always falls inside its day. Audited without the value. opts.seed (the
 *  demo seed's history, never a route) lifts only the 30-day window; every other check stays. */
export function putDailyTotal(ctx: Ctx, input: { memberId: string; metric: DailyTotalMetric; date: string; value: number; source: 'device' | 'member'; provider?: ProgressProvider | null }, opts: { seed?: boolean } = {}) {
  const cfg = metricConfig(ctx).find((m) => m.metric === input.metric);
  if (!cfg || !cfg.enabled) throw errors.badRequest('That metric is not enabled', 'METRIC_DISABLED');
  const consent = ctx.db.get<{ granted: number }>("SELECT granted FROM member_consents WHERE user_id = ? AND kind = 'health_data' ORDER BY at DESC, rowid DESC LIMIT 1", [input.memberId]);
  if (!consent?.granted) throw errors.forbidden('Agree to the processing of your health information (Privacy and sharing) before logging it', 'CONSENT_REQUIRED');
  if (cfg.min !== null && input.value < cfg.min) throw errors.badRequest(`${cfg.label} cannot be below ${cfg.min}`, 'VALUE_OUT_OF_RANGE');
  if (cfg.max !== null && input.value > cfg.max) throw errors.badRequest(`${cfg.label} cannot be above ${cfg.max}`, 'VALUE_OUT_OF_RANGE');
  const today = dateInZone(ctx.now());
  if (input.date > today) throw errors.badRequest('That date has not happened yet', 'DATE_IN_FUTURE');
  if (daysBetween(input.date, today) > DAILY_TOTAL_MAX_DAYS_BACK && !opts.seed) throw errors.badRequest(`A day total can be logged for the last ${DAILY_TOTAL_MAX_DAYS_BACK} days only`, 'DATE_TOO_OLD');
  const provider = input.source === 'device' ? input.provider ?? '' : '';
  const at = input.date === today ? ctx.now() : zonedToIso(input.date, 24 * 60 - 1);
  const now = ctx.now();
  return ctx.db.tx(() => {
    const existing = ctx.db.get<{ id: string; value: number }>('SELECT e.id, e.value FROM progress_daily_totals d JOIN progress_entries e ON e.id = d.entry_id WHERE d.member_id = ? AND d.metric = ? AND d.day = ? AND d.source = ? AND d.provider = ?', [input.memberId, input.metric, input.date, input.source, provider]);
    let id = existing?.id;
    if (!existing) {
      id = ids.progress();
      ctx.db.insert('progress_entries', { id, member_id: input.memberId, metric: input.metric, value: input.value, unit: cfg.unit, at, source: input.source, note: null, created_by: ctx.actor?.id ?? null, created_at: now });
      ctx.db.insert('progress_daily_totals', { member_id: input.memberId, metric: input.metric, day: input.date, source: input.source, provider, entry_id: id, updated_at: now });
    } else if (existing.value !== input.value) {
      ctx.db.update('progress_entries', existing.id, { value: input.value, unit: cfg.unit, at });
      ctx.db.run('UPDATE progress_daily_totals SET updated_at = ? WHERE entry_id = ?', [now, existing.id]);
    }
    if (!existing || existing.value !== input.value) audit(ctx, 'progress.daily', { type: 'user', id: input.memberId }, null, { metric: input.metric, date: input.date, source: input.source, provider: provider || null, created: !existing });
    return { entry: { ...ctx.db.get<Record<string, unknown>>('SELECT * FROM progress_entries WHERE id = ?', [id!]), day: input.date, provider: provider || null }, day: dailyValue(ctx, input.memberId, input.metric, input.date) };
  });
}
