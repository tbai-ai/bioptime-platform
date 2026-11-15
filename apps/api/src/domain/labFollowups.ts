/* M7 Lab follow-ups and preparation reminders.

   Follow-ups: structured next steps written after a laboratory report has been reviewed and released.
   - kinds: a consultation, a retest, a plan change or a note, each with the writer's own words, an optional due date
     and an optional link to the record that carries it out (the consultation's appointment, the retest's booking, the
     changed coaching plan);
   - a coach writes them for an assigned client, and only while the client shares health information with the coach
     (coach_sharing, checked by requireHealthAccess); a coach changes the ones a coach wrote, but the words and due
     date only of their own: the member reads them under the writing coach's name, so after a reassignment the new
     coach may mark the previous coach's step done, cancel, reopen or relink it, never reword it (OTHER_COACH_FOLLOW_UP);
   - a coach may also add next steps to a report the team released, while assigned and while the client shares health
     information (the rule is "once the report is released", whoever released it);
   - the Bioptime team writes them on a report it released itself (no coach could review it), always with a reason. On a
     next step a coach wrote, the team may mark it done, cancel or reopen it and change its link, never the coach's
     words or due date (the member reads those as the coach's): COACH_FOLLOW_UP;
   - members read the follow-ups on their released reports; nothing is shown for a report before it is released.
   Nothing here suggests a retest interval, a diagnosis or an interpretation: the due date and the words are the
   writer's, and stay empty unless they choose them.

   Preparation reminders: one reminder in the foundation's queue (api/domain/reminders.ts, ref_type 'lab_preparation')
   per upcoming home collection, worded only from the laboratory's own preparation text and fasting hours. It follows
   the booking: queued when it is made, moved when the slot moves, cancelled when the booking is cancelled or the
   collection is done. The BookingCreated and BookingUpdated handlers react as soon as the event is processed (a
   reschedule sends BookingUpdated with { from, to, rescheduled: true }); the preparation_sync job is the safety net for
   an event that never arrives and for bookings made while the module was off.

   Data export: exportNextSteps and exportPreparationReminders give the member's own next steps and preparation
   reminders as their own screens show them (ApiModule.exportSections in api/modules/labFollowups.ts). */
import type { Ctx } from '../context.js';
import { randomId } from '../lib/ids.js';
import { errors } from '../lib/errors.js';
import { addDays, addHours, dateInZone, IST_OFFSET_MINUTES } from '../lib/time.js';
import { coachHasMember, requireHealthAccess } from '../auth/permissions.js';
import { audit } from './audit.js';
import { notify } from './notifications.js';
import * as reminders from './reminders.js';

/** SQL: the member's latest coach_sharing consent is an explicit grant (no row is no consent), as bloodwork.ts reads it. */
const SHARED_WITH_COACH = (alias: string) => `EXISTS (SELECT 1 FROM member_consents c WHERE c.user_id = ${alias}.member_id AND c.kind = 'coach_sharing' AND c.granted = 1 AND c.at = (SELECT MAX(at) FROM member_consents WHERE user_id = c.user_id AND kind = 'coach_sharing'))`;

export const FOLLOW_UP_KINDS = ['consultation', 'retest', 'plan_change', 'note'] as const;
export type FollowUpKind = (typeof FOLLOW_UP_KINDS)[number];
export const FOLLOW_UP_STATUSES = ['open', 'done', 'cancelled'] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];
export const KIND_LABELS: Record<FollowUpKind, string> = { consultation: 'Consultation', retest: 'Retest', plan_change: 'Plan change', note: 'Note' };

export const FOLLOW_UP_CATEGORY = 'lab_followup';
export const PREPARATION_REF = 'lab_preparation';
export const PREPARATION_CATEGORY = 'lab_preparation';
/** How far ahead a due date may be set: a bound on input, not a suggested interval. */
export const MAX_DUE_DAYS = 730;
const followUpId = () => randomId('lfu');

export type Writer = 'coach' | 'team';
export type LinkInput = { appointmentId?: string | null; bookingId?: string | null; planId?: string | null };
export type FollowUpInput = LinkInput & { kind: FollowUpKind; note: string; dueDate?: string | null };
export type FollowUpPatch = LinkInput & { note?: string; dueDate?: string | null; status?: FollowUpStatus };

export type FollowUpRow = {
  id: string; report_id: string; member_id: string; coach_id: string | null; kind: FollowUpKind; note: string; due_date: string | null; status: FollowUpStatus;
  appointment_id: string | null; booking_id: string | null; plan_id: string | null; created_by: string; created_by_role: 'coach' | 'admin' | 'owner';
  created_at: string; updated_at: string; completed_at: string | null; cancelled_reason: string | null;
};
type ReportLite = { id: string; member_id: string; booking_id: string; released_at: string | null; reviewed_at: string | null; reviewer_role: string | null; reference: string; slot_at: string; test_name: string | null };

/* ---------- dates ---------- */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar date in YYYY-MM-DD (2026-02-30 is not). */
export function isRealDate(s: unknown): s is string {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Today's date where the member lives (member_profiles.timezone, India when unknown). */
export function memberToday(ctx: Ctx, memberId: string): string {
  return todayInZone(ctx, reminders.timezoneOf(ctx, memberId));
}
/** Today's date in a named timezone (India when the zone is empty or unknown). */
function todayInZone(ctx: Ctx, tz: string | null): string {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ctx.now())); }
  catch { return dateInZone(ctx.now(), IST_OFFSET_MINUTES); }
}
/** SQL: the timezone timezoneOf() reads for the member of alias f ('' when none is set). */
const MEMBER_TZ_SQL = "COALESCE((SELECT timezone FROM member_profiles WHERE user_id = f.member_id), (SELECT timezone FROM coach_profiles WHERE user_id = f.member_id), '')";

function fieldError(path: string, message: string): never {
  throw errors.validation([{ path, message }], `${path}: ${message}`);
}

function checkDueDate(ctx: Ctx, memberId: string, due: string | null | undefined): string | null {
  if (due === null || due === undefined) return null;
  if (!isRealDate(due)) fieldError('dueDate', 'Use a real date, YYYY-MM-DD');
  const today = memberToday(ctx, memberId);
  if (due < today) fieldError('dueDate', 'Pick today or a later date');
  if (due > addDays(`${today}T00:00:00.000Z`, MAX_DUE_DAYS).slice(0, 10)) fieldError('dueDate', 'Pick a date within two years');
  return due;
}

/* ---------- reading ---------- */

function reportLite(ctx: Ctx, reportId: string): ReportLite | undefined {
  return ctx.db.get<ReportLite>('SELECT r.id, r.member_id, r.booking_id, r.released_at, r.reviewed_at, u.role AS reviewer_role, b.reference, b.slot_at, t.name AS test_name FROM report_metadata r JOIN bloodwork_bookings b ON b.id = r.booking_id LEFT JOIN bloodwork_tests t ON t.id = b.test_id LEFT JOIN users u ON u.id = r.reviewed_by WHERE r.id = ?', [reportId]);
}

export function getRow(ctx: Ctx, id: string): FollowUpRow | undefined {
  return ctx.db.get<FollowUpRow>('SELECT * FROM lab_followups WHERE id = ?', [id]);
}

export type Audience = 'member' | 'coach' | 'team';

/** One follow-up as each audience sees it. The linked booking never carries the collection address; members do not
 *  see a cancellation reason (a withdrawn step is simply not listed for them). */
export function present(ctx: Ctx, row: FollowUpRow, audience: Audience) {
  const r = reportLite(ctx, row.report_id);
  const member = audience === 'member' ? null : ctx.db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', [row.member_id]);
  const writer = ctx.db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', [row.created_by]);
  const apt = row.appointment_id ? ctx.db.get<{ id: string; kind: string; start_at: string; status: string }>('SELECT id, kind, start_at, status FROM appointments WHERE id = ?', [row.appointment_id]) : undefined;
  const bkg = row.booking_id ? ctx.db.get<{ id: string; reference: string; slot_at: string; status: string; test_name: string | null; report_id: string | null; released_at: string | null }>('SELECT b.id, b.reference, b.slot_at, b.status, t.name AS test_name, r.id AS report_id, r.released_at FROM bloodwork_bookings b LEFT JOIN bloodwork_tests t ON t.id = b.test_id LEFT JOIN report_metadata r ON r.booking_id = b.id WHERE b.id = ?', [row.booking_id]) : undefined;
  const plan = row.plan_id ? ctx.db.get<{ id: string; title: string; status: string }>('SELECT id, title, status FROM coaching_plans WHERE id = ?', [row.plan_id]) : undefined;
  const today = memberToday(ctx, row.member_id);
  return {
    id: row.id, reportId: row.report_id, memberId: row.member_id, ...(member ? { memberName: member.name } : {}),
    kind: row.kind, kindLabel: KIND_LABELS[row.kind], note: row.note, dueDate: row.due_date, status: row.status,
    overdue: row.status === 'open' && !!row.due_date && row.due_date < today,
    report: r ? { id: r.id, bookingId: r.booking_id, reference: r.reference, testName: r.test_name, collectedAt: r.slot_at, releasedAt: r.released_at } : null,
    appointment: apt ? { id: apt.id, kind: apt.kind, startAt: apt.start_at, status: apt.status } : null,
    // the retest: its booking, and its report once the member can read it (members only after release)
    booking: bkg ? { id: bkg.id, reference: bkg.reference, testName: bkg.test_name, slotAt: bkg.slot_at, status: bkg.status, reportId: bkg.report_id && (audience !== 'member' || bkg.released_at) ? bkg.report_id : null } : null,
    // the member reads a linked plan only while it is published, as their Plan screen does (never a draft's title)
    plan: plan && (audience !== 'member' || plan.status === 'published') ? { id: plan.id, title: plan.title, status: plan.status } : null,
    setBy: { role: row.created_by_role === 'coach' ? 'coach' as const : 'team' as const, name: writer?.name ?? null },
    createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at,
    ...(audience === 'member' ? {} : { cancelledReason: row.cancelled_reason }),
  };
}
export type FollowUpView = ReturnType<typeof present>;

const ORDER = "ORDER BY CASE f.status WHEN 'open' THEN 0 WHEN 'done' THEN 1 ELSE 2 END, COALESCE(f.due_date, '9999-12-31'), f.created_at DESC";

/** A member's follow-ups, on released reports only (open and done; cancelled ones are withdrawn). */
export function listForMember(ctx: Ctx, memberId: string, opts: { reportId?: string } = {}) {
  const where = ['f.member_id = ?', 'r.released_at IS NOT NULL', "f.status != 'cancelled'"];
  const params: string[] = [memberId];
  if (opts.reportId) { where.push('f.report_id = ?'); params.push(opts.reportId); }
  return ctx.db.all<FollowUpRow>(`SELECT f.* FROM lab_followups f JOIN report_metadata r ON r.id = f.report_id WHERE ${where.join(' AND ')} ${ORDER}`, params).map((row) => present(ctx, row, 'member'));
}

/** One client's follow-ups for their coach or the team (every status), optionally for one report. */
export function listForClient(ctx: Ctx, memberId: string, audience: 'coach' | 'team', opts: { reportId?: string } = {}) {
  const where = ['f.member_id = ?'];
  const params: string[] = [memberId];
  if (opts.reportId) { where.push('f.report_id = ?'); params.push(opts.reportId); }
  return ctx.db.all<FollowUpRow>(`SELECT f.* FROM lab_followups f WHERE ${where.join(' AND ')} ${ORDER}`, params).map((row) => present(ctx, row, audience));
}

/** The follow-ups across a coach's assigned clients who share health information (open ones unless asked). */
export function listForCoach(ctx: Ctx, coachId: string, opts: { status?: FollowUpStatus | 'all'; limit?: number } = {}) {
  const where = ["f.member_id IN (SELECT member_id FROM coach_assignments WHERE coach_id = ? AND status IN ('active','paused'))", SHARED_WITH_COACH('f')];
  const params: Array<string | number> = [coachId];
  const status = opts.status ?? 'open';
  if (status !== 'all') { where.push('f.status = ?'); params.push(status); }
  return ctx.db.all<FollowUpRow>(`SELECT f.* FROM lab_followups f WHERE ${where.join(' AND ')} ${ORDER} LIMIT ?`, [...params, opts.limit ?? 100]).map((row) => present(ctx, row, 'coach'));
}

/** Every follow-up, for the team, with filters and counts. */
export function listForTeam(ctx: Ctx, opts: { status?: FollowUpStatus | 'all'; kind?: FollowUpKind; memberId?: string; reportId?: string; overdue?: boolean; limit?: number } = {}) {
  const where: string[] = [];
  const params: Array<string | number> = [];
  const status = opts.overdue ? 'open' : (opts.status ?? 'all');
  if (status !== 'all') { where.push('f.status = ?'); params.push(status); }
  if (opts.kind) { where.push('f.kind = ?'); params.push(opts.kind); }
  if (opts.memberId) { where.push('f.member_id = ?'); params.push(opts.memberId); }
  if (opts.reportId) { where.push('f.report_id = ?'); params.push(opts.reportId); }
  let withToday = '';
  if (opts.overdue) {
    // overdue is judged in each member's own timezone, inside the query, so the LIMIT counts overdue rows only: today's
    // date for every timezone among the open dated rows, then due_date < that member's today
    const zones = ctx.db.all<{ tz: string }>(`SELECT DISTINCT ${MEMBER_TZ_SQL} AS tz FROM lab_followups f WHERE f.status = 'open' AND f.due_date IS NOT NULL`).map((z) => z.tz);
    if (!zones.length) return { items: [], summary: summary(ctx) };
    withToday = `WITH zone_today(tz, today) AS (VALUES ${zones.map(() => '(?, ?)').join(', ')}) `;
    params.unshift(...zones.flatMap((tz) => [tz, todayInZone(ctx, tz)]));
    where.push('f.due_date IS NOT NULL', `f.due_date < (SELECT today FROM zone_today WHERE tz = ${MEMBER_TZ_SQL})`);
  }
  const rows = ctx.db.all<FollowUpRow>(`${withToday}SELECT f.* FROM lab_followups f ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ${ORDER} LIMIT ?`, [...params, opts.limit ?? 200]);
  return { items: rows.map((row) => present(ctx, row, 'team')), summary: summary(ctx) };
}

/** Counts for the team's overview. Overdue is judged in each member's own timezone. */
export function summary(ctx: Ctx) {
  const counts = Object.fromEntries(ctx.db.all<{ status: string; n: number }>('SELECT status, COUNT(*) n FROM lab_followups GROUP BY status').map((r) => [r.status, r.n]));
  const dated = ctx.db.all<{ member_id: string; due_date: string }>("SELECT member_id, due_date FROM lab_followups WHERE status = 'open' AND due_date IS NOT NULL");
  const overdue = dated.filter((d) => d.due_date < memberToday(ctx, d.member_id)).length;
  return { open: counts.open ?? 0, done: counts.done ?? 0, cancelled: counts.cancelled ?? 0, overdue };
}

/** What a follow-up on this member's report may link to: their appointments, their bookings after the report's
 *  collection (a retest comes later; the report's own booking is never offered) and their plans. */
export function linkOptions(ctx: Ctx, memberId: string, report?: { bookingId: string; collectedAt: string } | null) {
  return {
    appointments: ctx.db.all<{ id: string; kind: string; start_at: string; status: string }>("SELECT id, kind, start_at, status FROM appointments WHERE member_id = ? AND status IN ('requested','scheduled','completed') ORDER BY start_at DESC LIMIT 20", [memberId]).map((a) => ({ id: a.id, kind: a.kind, startAt: a.start_at, status: a.status })),
    bookings: ctx.db.all<{ id: string; reference: string; slot_at: string; status: string; test_name: string | null }>("SELECT b.id, b.reference, b.slot_at, b.status, t.name AS test_name FROM bloodwork_bookings b LEFT JOIN bloodwork_tests t ON t.id = b.test_id WHERE b.member_id = ? AND b.status != 'cancelled' AND b.id != ? AND b.slot_at > ? ORDER BY b.slot_at DESC LIMIT 20", [memberId, report?.bookingId ?? '', report?.collectedAt ?? '']).map((b) => ({ id: b.id, reference: b.reference, testName: b.test_name, slotAt: b.slot_at, status: b.status })),
    plans: ctx.db.all<{ id: string; title: string; status: string }>("SELECT id, title, status FROM coaching_plans WHERE member_id = ? AND status != 'archived' ORDER BY updated_at DESC LIMIT 20", [memberId]).map((p) => ({ id: p.id, title: p.title, status: p.status })),
  };
}

/** The member and booking behind a report, for the routes' checks and the link options. */
export function reportMember(ctx: Ctx, reportId: string): { memberId: string; bookingId: string; collectedAt: string; released: boolean; reviewerRole: string | null } {
  const r = reportLite(ctx, reportId);
  if (!r) throw errors.notFound('Report');
  return { memberId: r.member_id, bookingId: r.booking_id, collectedAt: r.slot_at, released: !!r.released_at, reviewerRole: r.reviewer_role };
}

/* ---------- writing ---------- */

type Links = { appointment_id: string | null; booking_id: string | null; plan_id: string | null };

/** Each link must be the member's own record and belong to the kind that uses it. */
function checkLinks(ctx: Ctx, memberId: string, report: { booking_id: string; slot_at: string }, kind: FollowUpKind, links: LinkInput): Partial<Links> {
  const out: Partial<Links> = {};
  if (links.appointmentId !== undefined) {
    if (links.appointmentId !== null) {
      if (kind !== 'consultation') fieldError('appointmentId', 'Only a consultation links to an appointment');
      const a = ctx.db.get<{ status: string }>('SELECT status FROM appointments WHERE id = ? AND member_id = ?', [links.appointmentId, memberId]);
      if (!a || a.status === 'cancelled' || a.status === 'no_show') fieldError('appointmentId', 'Pick one of this member’s current appointments');
    }
    out.appointment_id = links.appointmentId;
  }
  if (links.bookingId !== undefined) {
    if (links.bookingId !== null) {
      if (kind !== 'retest') fieldError('bookingId', 'Only a retest links to a booking');
      const b = ctx.db.get<{ status: string; slot_at: string }>('SELECT status, slot_at FROM bloodwork_bookings WHERE id = ? AND member_id = ?', [links.bookingId, memberId]);
      if (!b || b.status === 'cancelled' || links.bookingId === report.booking_id || b.slot_at <= report.slot_at) fieldError('bookingId', 'Pick a later booking of this member’s (not the one this report came from)');
    }
    out.booking_id = links.bookingId;
  }
  if (links.planId !== undefined) {
    if (links.planId !== null) {
      if (kind !== 'plan_change') fieldError('planId', 'Only a plan change links to a plan');
      const p = ctx.db.get<{ status: string }>('SELECT status FROM coaching_plans WHERE id = ? AND member_id = ?', [links.planId, memberId]);
      if (!p || p.status === 'archived') fieldError('planId', 'Pick one of this member’s current plans');
    }
    out.plan_id = links.planId;
  }
  return out;
}

/** May this person write as a coach for this member? Assigned, and the member shares health information. */
function assertCoachFor(ctx: Ctx, memberId: string): void {
  const actor = ctx.actor;
  if (!actor || actor.role !== 'coach') throw errors.forbidden();
  if (!coachHasMember(ctx, actor.id, memberId)) throw errors.forbidden('Not your client', 'NO_ACCESS');
  requireHealthAccess(ctx, memberId); // NOT_SHARED while coach_sharing is not granted
}
function assertTeam(ctx: Ctx): void {
  if (!ctx.actor || (ctx.actor.role !== 'admin' && ctx.actor.role !== 'owner')) throw errors.forbidden();
}

/** Add a follow-up to a released report. A coach: an assigned client who shares health information. The team: only
 *  on a report the team released itself, with a reason. The member is told (sensitive: no detail on a lock screen). */
export function createFollowUp(ctx: Ctx, reportId: string, input: FollowUpInput, opts: { as: Writer; reason?: string | null; notifyMember?: boolean; seed?: boolean }): FollowUpRow {
  const r = reportLite(ctx, reportId);
  if (!r) throw errors.notFound('Report');
  if (opts.as === 'coach') assertCoachFor(ctx, r.member_id); else assertTeam(ctx);
  if (!r.released_at) throw errors.state('Next steps are added once the report has been reviewed and released', { code: 'NOT_RELEASED' });
  if (opts.as === 'team' && r.reviewer_role === 'coach') throw errors.state('The member’s coach reviewed this report; its next steps are the coach’s to set', { code: 'COACH_RELEASED' });
  const reason = opts.reason?.trim() || null;
  if (opts.as === 'team' && (!reason || reason.length < 3)) throw errors.badRequest('Say why: the reason is recorded in the audit log', 'REASON_REQUIRED');
  const note = input.note.trim();
  if (note.length < 3 || note.length > 2000) fieldError('note', 'Write the next step in 3 to 2000 characters');
  if (!(FOLLOW_UP_KINDS as readonly string[]).includes(input.kind)) fieldError('kind', 'Choose consultation, retest, plan change or note');
  const links = checkLinks(ctx, r.member_id, r, input.kind, input);
  const due = opts.seed ? (input.dueDate ?? null) : checkDueDate(ctx, r.member_id, input.dueDate);
  const actor = ctx.actor!;
  const now = ctx.now();
  const id = followUpId();
  return ctx.db.tx(() => {
    ctx.db.insert('lab_followups', {
      id, report_id: r.id, member_id: r.member_id, coach_id: opts.as === 'coach' ? actor.id : null, kind: input.kind, note, due_date: due, status: 'open',
      appointment_id: links.appointment_id ?? null, booking_id: links.booking_id ?? null, plan_id: links.plan_id ?? null,
      created_by: actor.id, created_by_role: actor.role as FollowUpRow['created_by_role'], created_at: now, updated_at: now, completed_at: null, cancelled_reason: null,
    });
    audit(ctx, 'lab_followup.create', { type: 'lab_followup', id }, reason, { reportId: r.id, memberId: r.member_id, kind: input.kind, dueDate: due, by: opts.as, links: { appointmentId: links.appointment_id ?? null, bookingId: links.booking_id ?? null, planId: links.plan_id ?? null } });
    if (opts.notifyMember !== false) {
      notify(ctx, { userId: r.member_id, category: FOLLOW_UP_CATEGORY, title: 'A next step from your report', body: opts.as === 'coach' ? 'Your coach added a next step to your blood test report.' : 'The Bioptime team added a next step to your blood test report.', data: { reportId: r.id, followUpId: id }, sensitive: true });
    }
    return getRow(ctx, id)!;
  });
}

const TRANSITIONS: Record<FollowUpStatus, FollowUpStatus[]> = { open: ['done', 'cancelled'], done: ['open'], cancelled: ['open'] };

/** Change a follow-up: its words, due date or link while it is open; mark it done; cancel it or reopen it (a reason
 *  is required for both). A coach changes the follow-ups a coach wrote, for an assigned client who shares health
 *  information, but the words and due date only of their own (OTHER_COACH_FOLLOW_UP: after a reassignment the new
 *  coach may mark the previous coach's step done, cancel, reopen or relink it). The team changes any of them, always
 *  with a reason, except the words and due date of one a coach wrote (COACH_FOLLOW_UP): there it may only mark done,
 *  cancel, reopen or change the link. */
export function updateFollowUp(ctx: Ctx, id: string, patch: FollowUpPatch, opts: { as: Writer; reason?: string | null }): FollowUpRow {
  const row = getRow(ctx, id);
  if (!row) throw errors.notFound('Follow-up');
  if (opts.as === 'coach') {
    assertCoachFor(ctx, row.member_id);
    if (row.created_by_role !== 'coach') throw errors.forbidden('The Bioptime team set this next step; the team changes it', 'TEAM_FOLLOW_UP');
  } else assertTeam(ctx);
  const reason = opts.reason?.trim() || null;
  if (opts.as === 'team' && (!reason || reason.length < 3)) throw errors.badRequest('Say why: the reason is recorded in the audit log', 'REASON_REQUIRED');
  const r = reportLite(ctx, row.report_id)!;
  const next = patch.status ?? row.status;
  const statusChange = next !== row.status;
  if (statusChange && !TRANSITIONS[row.status].includes(next)) throw errors.state(next === 'cancelled' ? 'Reopen this next step before cancelling it' : `A next step that is ${row.status} cannot become ${next}`, { code: 'INVALID_TRANSITION' });
  if (statusChange && (next === 'cancelled' || next === 'open') && (!reason || reason.length < 3)) throw errors.badRequest(next === 'cancelled' ? 'Say why it is cancelled: the reason is recorded' : 'Say why it is reopened: the reason is recorded', 'REASON_REQUIRED');

  // the member reads a coach's next step as that coach's words, under that coach's name: the team, or another coach
  // (after a reassignment), may complete, cancel, reopen or link it, but never rewrite what the coach wrote or the date
  // the coach set
  const noteChanges = patch.note !== undefined && patch.note.trim() !== row.note;
  const dueChanges = patch.dueDate !== undefined && patch.dueDate !== row.due_date;
  if (opts.as === 'team' && row.created_by_role === 'coach' && (noteChanges || dueChanges)) {
    throw errors.forbidden('A coach wrote this next step, and the member reads it as their coach’s words. The team can mark it done, cancel or reopen it, or change its link, but not its words or due date. Ask the coach to change those.', 'COACH_FOLLOW_UP');
  }
  if (opts.as === 'coach' && row.created_by !== ctx.actor!.id && (noteChanges || dueChanges)) {
    throw errors.forbidden('Another coach wrote this next step, and the member reads it under that coach’s name. You can mark it done, cancel or reopen it, or change its link, but not its words or due date. Add a next step of your own instead.', 'OTHER_COACH_FOLLOW_UP');
  }

  const changes: Record<string, string | null> = {};
  const fields: string[] = [];
  if (noteChanges && patch.note !== undefined) {
    const note = patch.note.trim();
    if (note.length < 3 || note.length > 2000) fieldError('note', 'Write the next step in 3 to 2000 characters');
    changes.note = note; fields.push('note');
  }
  if (dueChanges) { changes.due_date = checkDueDate(ctx, row.member_id, patch.dueDate); fields.push('dueDate'); }
  const linkPatch: LinkInput = {};
  if (patch.appointmentId !== undefined && patch.appointmentId !== row.appointment_id) linkPatch.appointmentId = patch.appointmentId;
  if (patch.bookingId !== undefined && patch.bookingId !== row.booking_id) linkPatch.bookingId = patch.bookingId;
  if (patch.planId !== undefined && patch.planId !== row.plan_id) linkPatch.planId = patch.planId;
  const links = checkLinks(ctx, row.member_id, r, row.kind, linkPatch);
  for (const [k, v] of Object.entries(links)) { changes[k] = v ?? null; fields.push(k === 'appointment_id' ? 'appointmentId' : k === 'booking_id' ? 'bookingId' : 'planId'); }
  if (fields.length && next !== 'open') throw errors.state('Reopen this next step to change it', { code: 'NOT_OPEN' });
  if (!fields.length && !statusChange) return row; // nothing differs: no write, no audit row

  const now = ctx.now();
  return ctx.db.tx(() => {
    ctx.db.update('lab_followups', id, {
      ...changes, status: next, updated_at: now,
      completed_at: next === 'done' ? (row.status === 'done' ? row.completed_at : now) : null,
      cancelled_reason: next === 'cancelled' ? (statusChange ? reason : row.cancelled_reason) : null,
    });
    const data = { reportId: row.report_id, memberId: row.member_id, kind: row.kind, by: opts.as, ...(fields.length ? { fields } : {}), ...(statusChange ? { status: { from: row.status, to: next } } : {}) };
    audit(ctx, statusChange && next === 'done' ? 'lab_followup.complete' : 'lab_followup.update', { type: 'lab_followup', id }, reason, data);
    return getRow(ctx, id)!;
  });
}

/* ---------- preparation reminders ---------- */

const PREPARING = new Set(['confirmed', 'scheduled']);

/** Bioptime's timing, not a preparation instruction: the reminder arrives two hours before the laboratory's fasting
 *  window opens, or 12 hours before the slot when the laboratory lists no fasting. */
export function preparationLeadHours(fastingHours: number): number { return fastingHours > 0 ? fastingHours + 2 : 12; }

/** When the reminder for a slot is due; never before the booking existed (a late booking is reminded at once). */
export function preparationDueAt(slotAt: string, bookedAt: string, fastingHours: number): string {
  const due = Date.parse(addHours(slotAt, -preparationLeadHours(fastingHours)));
  return new Date(Math.max(due, Date.parse(bookedAt))).toISOString();
}

/** "Sun, 8 Nov, 07:30 IST": India time is named IST, as everywhere else in the app and the portal; another zone by its
 *  short name ("GMT+1"), or its id when it has none. An unknown zone falls back to India time. */
function whenText(iso: string, timeZone: string): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false };
  const india = () => `${new Intl.DateTimeFormat('en-IN', { ...opts, timeZone: 'Asia/Kolkata' }).format(new Date(iso))} IST`;
  if (timeZone === 'Asia/Kolkata' || timeZone === 'Asia/Calcutta') return india();
  try {
    const when = new Intl.DateTimeFormat('en-IN', { ...opts, timeZone }).format(new Date(iso));
    const short = new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'short' }).formatToParts(new Date(iso)).find((p) => p.type === 'timeZoneName')?.value;
    return `${when} ${short || timeZone}`;
  } catch { return india(); }
}

/** The reminder's words: the test, the slot, and the laboratory's own preparation text or fasting hours, nothing more. */
export function preparationText(test: { name: string | null; fasting_hours: number | null; preparation: string | null }, slotAt: string, timeZone: string): { title: string; body: string } {
  const prep = (test.preparation ?? '').trim();
  const fasting = test.fasting_hours ?? 0;
  const lab = prep ? `The laboratory’s preparation: ${prep}` : fasting > 0 ? `The laboratory asks for ${fasting} hours of fasting before collection.` : 'The laboratory lists no preparation for this test.';
  return { title: 'Preparing for your blood test', body: `${test.name ?? 'Your blood test'}: home collection ${whenText(slotAt, timeZone)}. ${lab}` };
}

type PrepBooking = { id: string; member_id: string; status: string; slot_at: string; flag: string | null; created_at: string; name: string | null; fasting_hours: number | null; preparation: string | null };

/** Keep one preparation reminder for a booking: queued for an upcoming collection, moved with the slot, cancelled when
 *  the booking is cancelled, collected, past or waiting for the team to arrange a new visit. Idempotent. */
export function syncPreparation(ctx: Ctx, bookingId: string): 'queued' | 'moved' | 'cancelled' | 'unchanged' {
  const b = ctx.db.get<PrepBooking>('SELECT b.id, b.member_id, b.status, b.slot_at, b.flag, b.created_at, t.name, t.fasting_hours, t.preparation FROM bloodwork_bookings b LEFT JOIN bloodwork_tests t ON t.id = b.test_id WHERE b.id = ?', [bookingId]);
  const queued = ctx.db.all<{ id: string; due_at: string; title: string; body: string }>("SELECT id, due_at, title, body FROM reminders WHERE ref_type = ? AND ref_id = ? AND status = 'queued'", [PREPARATION_REF, bookingId]);
  const upcoming = !!b && PREPARING.has(b.status) && !(b.flag ?? '').startsWith('rebook') && Date.parse(b.slot_at) > Date.parse(ctx.now());
  if (!b || !upcoming) {
    if (!queued.length) return 'unchanged';
    reminders.cancel(ctx, { refType: PREPARATION_REF, refId: bookingId });
    return 'cancelled';
  }
  const dueAt = preparationDueAt(b.slot_at, b.created_at, b.fasting_hours ?? 0);
  const { title, body } = preparationText(b, b.slot_at, reminders.timezoneOf(ctx, b.member_id));
  if (queued.length === 1 && queued[0]!.due_at === dueAt && queued[0]!.title === title && queued[0]!.body === body) return 'unchanged';
  const handled = ctx.db.get<{ status: string }>("SELECT status FROM reminders WHERE user_id = ? AND ref_type = ? AND ref_id = ? AND due_at = ? AND status IN ('sent','skipped')", [b.member_id, PREPARATION_REF, bookingId, dueAt]);
  if (handled) { // this slot's reminder already went out (or was skipped when it fell due): nothing more to queue
    if (!queued.length) return 'unchanged';
    reminders.cancel(ctx, { refType: PREPARATION_REF, refId: bookingId });
    return 'cancelled';
  }
  reminders.replace(ctx, { userId: b.member_id, refType: PREPARATION_REF, refId: bookingId, dueAt, category: PREPARATION_CATEGORY, title, body, channels: ['in_app', 'push'] });
  return queued.length ? (queued.some((q) => q.due_at !== dueAt) ? 'moved' : 'unchanged') : 'queued';
}

/** The preparation_sync job: every upcoming booking, and every booking that still has a queued reminder. */
export function syncAllPreparation(ctx: Ctx): { queued: number; moved: number; cancelled: number } {
  const ids = new Set<string>([
    ...ctx.db.all<{ id: string }>("SELECT id FROM bloodwork_bookings WHERE status IN ('confirmed','scheduled') AND slot_at > ?", [ctx.now()]).map((r) => r.id),
    ...ctx.db.all<{ ref_id: string }>("SELECT DISTINCT ref_id FROM reminders WHERE ref_type = ? AND status = 'queued'", [PREPARATION_REF]).map((r) => r.ref_id),
  ]);
  const out = { queued: 0, moved: 0, cancelled: 0 };
  for (const id of ids) {
    const r = syncPreparation(ctx, id);
    if (r !== 'unchanged') out[r]++;
  }
  return out;
}

/** A member's upcoming collections with the laboratory's preparation and the reminder Bioptime will send. */
export function preparationForMember(ctx: Ctx, memberId: string) {
  const rows = ctx.db.all<PrepBooking & { reference: string }>("SELECT b.id, b.reference, b.member_id, b.status, b.slot_at, b.flag, b.created_at, t.name, t.fasting_hours, t.preparation FROM bloodwork_bookings b LEFT JOIN bloodwork_tests t ON t.id = b.test_id WHERE b.member_id = ? AND b.status IN ('confirmed','scheduled') AND b.slot_at > ? ORDER BY b.slot_at", [memberId, ctx.now()]);
  return rows.map((b) => {
    const rem = ctx.db.get<{ due_at: string; status: string }>("SELECT due_at, status FROM reminders WHERE ref_type = ? AND ref_id = ? AND user_id = ? AND status IN ('queued','sent','skipped') ORDER BY CASE status WHEN 'queued' THEN 0 ELSE 1 END, due_at DESC LIMIT 1", [PREPARATION_REF, b.id, memberId]);
    return {
      bookingId: b.id, reference: b.reference, testName: b.name, slotAt: b.slot_at, fastingHours: b.fasting_hours ?? 0, preparation: (b.preparation ?? '').trim() || null,
      rebookPending: (b.flag ?? '').startsWith('rebook'),
      reminder: rem ? { dueAt: rem.due_at, status: rem.status } : null,
    };
  });
}

export const PREPARATION_TIMING = 'Bioptime sends one reminder before each home collection: two hours before the laboratory’s fasting time begins, or 12 hours before the slot when the laboratory lists no fasting. It uses only the laboratory’s own preparation text.';

/* ---------- data export ---------- */

/** The member's next steps for their data export: exactly the list their own screens show (listForMember: released
 *  reports only, cancelled steps withdrawn, no cancellation reason, no other person's name beyond who set it, a linked
 *  plan only while it is published). */
export function exportNextSteps(ctx: Ctx, memberId: string) {
  return listForMember(ctx, memberId).map((f) => ({
    kind: f.kindLabel, nextStep: f.note, dueDate: f.dueDate, status: f.status, setBy: f.setBy.role === 'coach' ? `Your coach${f.setBy.name ? `, ${f.setBy.name}` : ''}` : 'The Bioptime team',
    report: f.report ? { reference: f.report.reference, testName: f.report.testName, collectedAt: f.report.collectedAt, releasedAt: f.report.releasedAt } : null,
    appointment: f.appointment ? { kind: f.appointment.kind, startAt: f.appointment.startAt, status: f.appointment.status } : null,
    retestBooking: f.booking ? { reference: f.booking.reference, testName: f.booking.testName, slotAt: f.booking.slotAt, status: f.booking.status } : null,
    plan: f.plan ? { title: f.plan.title } : null,
    createdAt: f.createdAt, updatedAt: f.updatedAt, completedAt: f.completedAt,
  }));
}

/** The member's preparation reminders for their data export: the ones queued for an upcoming collection, sent, or
 *  skipped (not delivered: module off, account inactive, reminders turned off or quiet hours); a withdrawn one,
 *  replaced when a slot moved or cancelled with the booking, is not theirs to see. With the
 *  wording they get, which comes only from the laboratory's preparation text. No collection address. */
export function exportPreparationReminders(ctx: Ctx, memberId: string) {
  return ctx.db.all<{ reference: string | null; test_name: string | null; due_at: string; status: string; title: string; body: string; sent_at: string | null }>(
    "SELECT b.reference, t.name AS test_name, m.due_at, m.status, m.title, m.body, m.sent_at FROM reminders m LEFT JOIN bloodwork_bookings b ON b.id = m.ref_id AND b.member_id = m.user_id LEFT JOIN bloodwork_tests t ON t.id = b.test_id WHERE m.user_id = ? AND m.ref_type = ? AND m.status IN ('queued','sent','skipped') ORDER BY m.due_at",
    [memberId, PREPARATION_REF],
  ).map((r) => ({ bookingReference: r.reference, testName: r.test_name, remindAt: r.due_at, status: r.status, title: r.title, body: r.body, sentAt: r.sent_at }));
}

/* ---------- demo ---------- */

/** Demo rows: three next steps on the first coach-reviewed report, written through the real path by the coach who
 *  reviewed it (no notification), in plain words (owner decision of 24 October 2026). No due date is invented. */
export function seedDemoFollowUps(system: Ctx, memberIds: string[]): number {
  const memberId = memberIds[0];
  if (!memberId) return 0;
  const r = system.db.get<{ id: string; reviewed_by: string }>("SELECT r.id, r.reviewed_by FROM report_metadata r JOIN users u ON u.id = r.reviewed_by WHERE r.member_id = ? AND r.released_at IS NOT NULL AND u.role = 'coach' ORDER BY r.released_at LIMIT 1", [memberId]);
  if (!r) return 0;
  const coach = system.db.get<{ id: string; email: string; name: string }>('SELECT id, email, name FROM users WHERE id = ?', [r.reviewed_by])!;
  if (!coachHasMember(system, coach.id, memberId)) return 0;
  const cctx: Ctx = { ...system, actor: { id: coach.id, role: 'coach', email: coach.email, name: coach.name } };
  const apt = system.db.get<{ id: string }>("SELECT id FROM appointments WHERE member_id = ? AND status IN ('requested','scheduled') ORDER BY start_at LIMIT 1", [memberId]);
  const plan = system.db.get<{ id: string }>("SELECT id FROM coaching_plans WHERE member_id = ? AND status = 'published' ORDER BY updated_at DESC LIMIT 1", [memberId]);
  const opts = { as: 'coach' as const, notifyMember: false, seed: true };
  createFollowUp(cctx, r.id, { kind: 'consultation', note: 'Go through this report together at the next appointment.', appointmentId: apt?.id ?? null }, opts);
  const change = createFollowUp(cctx, r.id, { kind: 'plan_change', note: 'Add the two short outdoor sessions a week from the review note to the plan.', planId: plan?.id ?? null }, opts);
  updateFollowUp(cctx, change.id, { status: 'done' }, { as: 'coach' });
  createFollowUp(cctx, r.id, { kind: 'retest', note: 'Agree with your doctor whether and when to test again. No date is set.' }, opts);
  return 3;
}
