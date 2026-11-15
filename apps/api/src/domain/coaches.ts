/* Coaches: profiles, availability and capacity, the coach home queues, and operational metrics that never rank people. */
import type { Ctx } from '../context.js';
import { ids } from '../lib/ids.js';
import { errors } from '../lib/errors.js';
import { j } from '../db/db.js';
import { audit } from './audit.js';
import { SHARED_WITH_COACH } from './bloodwork.js';
import { getUser, publicUser } from '../auth/service.js';
import { onCoachAvailabilityChanged } from './assignments.js';
import { maskPhone, safeAppointmentRow } from './members.js';
import { coachFieldPolicy } from '../auth/fieldPolicy.js';

export function getCoach(ctx: Ctx, coachId: string, opts: { forMember?: boolean } = {}) {
  const u = getUser(ctx, coachId);
  if (!u || u.role !== 'coach') throw errors.notFound('Coach');
  const c = ctx.db.get<Record<string, unknown>>('SELECT * FROM coach_profiles WHERE user_id = ?', [coachId]);
  if (!c) throw errors.notFound('Coach profile');
  const load = ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM coach_assignments WHERE coach_id = ? AND status = 'active'", [coachId])?.n ?? 0;
  const base = {
    id: u.id, coachCode: (c.coach_code as string | null) ?? null, designation: (c.designation as string | null) ?? null, displayName: c.display_name, bio: c.bio ?? null, expertise: j.out<string[]>(c.expertise, []), languages: j.out<string[]>(c.languages, []), city: c.city ?? null, timezone: c.timezone ?? 'Asia/Kolkata',
    qualifications: j.out<string[]>(c.qualifications, []), scope: j.out<string[]>(c.scope, []),
  };
  if (opts.forMember) return base; // what a member may see of their coach: the permitted professional details only
  const profileComplete = !!(c.bio && j.out<string[]>(c.expertise, []).length && c.city);
  return { ...base, ...publicUser(u), phone: maskPhone(u.phone), caseloadLimit: c.caseload_limit, caseload: load, available: !!c.available, unavailableUntil: c.unavailable_until ?? null, activatedAt: c.activated_at ?? null, profileStatus: profileComplete ? 'complete' : 'incomplete' };
}

export function listCoaches(ctx: Ctx) {
  return ctx.db.all<{ user_id: string }>("SELECT c.user_id FROM coach_profiles c JOIN users u ON u.id = c.user_id WHERE u.role = 'coach' ORDER BY c.display_name").map((r) => getCoach(ctx, r.user_id));
}

export function updateCoach(ctx: Ctx, coachId: string, patch: { displayName?: string; bio?: string; expertise?: string[]; languages?: string[]; qualifications?: string[]; scope?: string[]; city?: string; timezone?: string; caseloadLimit?: number; designation?: string | null }, reason?: string) {
  getCoach(ctx, coachId);
  const now = ctx.now();
  ctx.db.update('coach_profiles', coachId, {
    display_name: patch.displayName, bio: patch.bio, designation: patch.designation, expertise: patch.expertise ? j.in(patch.expertise) : undefined, languages: patch.languages ? j.in(patch.languages) : undefined,
    qualifications: patch.qualifications ? j.in(patch.qualifications) : undefined, scope: patch.scope ? j.in(patch.scope) : undefined, city: patch.city, timezone: patch.timezone, caseload_limit: patch.caseloadLimit, updated_at: now,
  }, 'user_id');
  if (patch.displayName) ctx.db.update('users', coachId, { name: patch.displayName, updated_at: now });
  audit(ctx, 'coach.profile_update', { type: 'user', id: coachId }, reason ?? null, { fields: Object.keys(patch) });
  return getCoach(ctx, coachId);
}

export function setAvailability(ctx: Ctx, coachId: string, input: { available: boolean; unavailableUntil?: string | null; reason: string }) {
  getCoach(ctx, coachId);
  if (!input.reason) throw errors.badRequest('A reason is required', 'REASON_REQUIRED');
  const before = ctx.db.get<{ available: number }>('SELECT available FROM coach_profiles WHERE user_id = ?', [coachId]);
  ctx.db.update('coach_profiles', coachId, { available: input.available ? 1 : 0, unavailable_until: input.available ? null : (input.unavailableUntil ?? null), updated_at: ctx.now() }, 'user_id');
  const changed = !!before?.available !== input.available ? onCoachAvailabilityChanged(ctx, coachId, input.available, input.reason) : 0;
  audit(ctx, 'coach.availability', { type: 'user', id: coachId }, input.reason, { available: input.available, unavailableUntil: input.unavailableUntil ?? null, assignmentsChanged: changed });
  return getCoach(ctx, coachId);
}

/* ---------- availability rules and blocks ---------- */
export function getAvailabilityRules(ctx: Ctx, coachId: string) {
  return ctx.db.all('SELECT * FROM availability_rules WHERE coach_id = ? AND active = 1 ORDER BY weekday, start_minute', [coachId]);
}

export function setAvailabilityRules(ctx: Ctx, coachId: string, rules: Array<{ weekday: number; startMinute: number; endMinute: number; slotMinutes?: number }>) {
  for (const r of rules) if (r.endMinute <= r.startMinute || r.startMinute < 0 || r.endMinute > 1440) throw errors.badRequest('Each working window needs a start before its end, inside one day');
  ctx.db.tx(() => {
    ctx.db.run('DELETE FROM availability_rules WHERE coach_id = ?', [coachId]);
    for (const r of rules) ctx.db.insert('availability_rules', { id: ids.availabilityRule(), coach_id: coachId, weekday: r.weekday, start_minute: r.startMinute, end_minute: r.endMinute, slot_minutes: r.slotMinutes ?? 30, timezone: 'Asia/Kolkata', active: 1 });
    audit(ctx, 'coach.availability_rules', { type: 'user', id: coachId }, null, { count: rules.length });
  });
  return getAvailabilityRules(ctx, coachId);
}

export function listBlocks(ctx: Ctx, coachId: string, from?: string) {
  return ctx.db.all('SELECT * FROM availability_blocks WHERE coach_id = ? AND end_at >= ? ORDER BY start_at', [coachId, from ?? ctx.now()]);
}

export function addBlock(ctx: Ctx, coachId: string, input: { startAt: string; endAt: string; reason?: string }) {
  if (input.endAt <= input.startAt) throw errors.badRequest('The block needs an end after its start');
  const id = ids.availabilityBlock();
  ctx.db.insert('availability_blocks', { id, coach_id: coachId, start_at: input.startAt, end_at: input.endAt, reason: input.reason ?? null, created_at: ctx.now() });
  audit(ctx, 'coach.block_added', { type: 'user', id: coachId }, input.reason ?? null, { blockId: id });
  return ctx.db.get('SELECT * FROM availability_blocks WHERE id = ?', [id]);
}

export function removeBlock(ctx: Ctx, coachId: string, blockId: string) {
  const n = ctx.db.run('DELETE FROM availability_blocks WHERE id = ? AND coach_id = ?', [blockId, coachId]).changes;
  if (!n) throw errors.notFound('Block');
  audit(ctx, 'coach.block_removed', { type: 'user', id: coachId }, null, { blockId });
}

/* ---------- the coach's follow-ups ---------- */

/** A coach follow-up the coach may not see now (SQL over support_tasks t): one on a habit the member wrote themselves
 *  (habits.created_by_role 'member') while the member does not share health information with their coach (the latest
 *  coach_sharing record decides; none is no consent, as requireHealthAccess). Its title names that habit, which the
 *  coach may then no longer see. The habits module's habit_followup_privacy job dismisses such a follow-up within
 *  minutes, flag on or off; until it runs, the coach's lists leave it out and it cannot be reopened. */
export const WITHHELD_HABIT_FOLLOW_UP = `(t.kind = 'coach_follow_up' AND t.ref_type = 'habit' AND EXISTS (SELECT 1 FROM habits h WHERE h.id = t.ref_id AND h.created_by_role = 'member' AND COALESCE((SELECT mc.granted FROM member_consents mc WHERE mc.user_id = h.member_id AND mc.kind = 'coach_sharing' ORDER BY mc.at DESC, mc.rowid DESC LIMIT 1), 0) = 0))`;

/** The coach's open follow-ups (open or in progress), without the withheld ones: the Today list (coachHome, oldest
 *  first) and GET /coach/follow-ups (newest first, at most 200). */
export function openFollowUpsFor(ctx: Ctx, coachId: string, opts: { newestFirst?: boolean; limit?: number } = {}) {
  return ctx.db.all<Record<string, unknown>>(`SELECT t.* FROM support_tasks t WHERE t.owner_id = ? AND t.status IN ('open','in_progress') AND NOT ${WITHHELD_HABIT_FOLLOW_UP} ORDER BY t.created_at ${opts.newestFirst ? 'DESC' : 'ASC'}${opts.limit ? ' LIMIT ?' : ''}`, opts.limit ? [coachId, opts.limit] : [coachId]);
}

/** Is this support task a follow-up the coach may not see now (WITHHELD_HABIT_FOLLOW_UP)? */
export function followUpWithheld(ctx: Ctx, taskId: string): boolean {
  return !!ctx.db.get(`SELECT 1 FROM support_tasks t WHERE t.id = ? AND ${WITHHELD_HABIT_FOLLOW_UP}`, [taskId]);
}

/* ---------- the coach home ---------- */
export function coachHome(ctx: Ctx, coachId: string) {
  const now = ctx.now();
  const today = now.slice(0, 10);
  type ClientRow = { assignment_id: string; assignment_status: string; effective_at: string | null; id: string; name: string; email: string; goals: string; city: string | null; package_name: string | null; programme_end_at: string | null };
  const clients = ctx.db.all<ClientRow>("SELECT a.id AS assignment_id, a.status AS assignment_status, a.effective_at, u.id, u.name, u.email, p.goals, p.city, (SELECT pk.name FROM programmes g JOIN package_versions v ON v.id = g.package_version_id JOIN packages pk ON pk.id = v.package_id WHERE g.id = a.programme_id) AS package_name, (SELECT g.end_at FROM programmes g WHERE g.id = a.programme_id) AS programme_end_at FROM coach_assignments a JOIN users u ON u.id = a.member_id LEFT JOIN member_profiles p ON p.user_id = u.id WHERE a.coach_id = ? AND a.status IN ('active','paused') ORDER BY u.name", [coachId]).map((r) => ({ ...r, goals: j.out<string[]>(r.goals, []) }));
  // raw appointments rows: each link goes through safeAppointmentRow (only a scheduled appointment carries one, and never
  // an old placeholder or a link with whitespace or a control character)
  const todays = ctx.db.all<Record<string, unknown>>("SELECT a.*, m.name AS member_name FROM appointments a JOIN users m ON m.id = a.member_id WHERE a.coach_id = ? AND substr(a.start_at, 1, 10) = ? AND a.status IN ('requested','scheduled') ORDER BY a.start_at", [coachId, today]).map(safeAppointmentRow);
  const upcoming = ctx.db.all<Record<string, unknown>>("SELECT a.*, m.name AS member_name FROM appointments a JOIN users m ON m.id = a.member_id WHERE a.coach_id = ? AND a.start_at > ? AND substr(a.start_at, 1, 10) > ? AND a.status IN ('requested','scheduled') ORDER BY a.start_at LIMIT 10", [coachId, now, today]).map(safeAppointmentRow);
  const requested = ctx.db.all<Record<string, unknown>>("SELECT a.*, m.name AS member_name FROM appointments a JOIN users m ON m.id = a.member_id WHERE a.coach_id = ? AND a.status = 'requested' ORDER BY a.start_at LIMIT 10", [coachId]).map(safeAppointmentRow);
  const reviews = ctx.db.all<Record<string, unknown>>(`SELECT r.id, r.booking_id, r.delivered_at, r.flagged, r.markers, m.id AS member_id, m.name AS member_name, b.reference, t.name AS test_name FROM report_metadata r JOIN users m ON m.id = r.member_id JOIN bloodwork_bookings b ON b.id = r.booking_id JOIN bloodwork_tests t ON t.id = b.test_id WHERE ${SHARED_WITH_COACH('r')} AND r.reviewed_at IS NULL AND r.member_id IN (SELECT member_id FROM coach_assignments WHERE coach_id = ? AND status = 'active') ORDER BY r.delivered_at`, [coachId]).map((r) => ({ ...r, flagged: j.out(r.flagged, []) }));
  const drafts = ctx.db.all<Record<string, unknown>>("SELECT p.id, p.title, p.member_id, m.name AS member_name, p.updated_at FROM coaching_plans p JOIN users m ON m.id = p.member_id WHERE p.coach_id = ? AND p.status = 'draft' ORDER BY p.updated_at DESC", [coachId]);
  const followUps = openFollowUpsFor(ctx, coachId); // without a habit follow-up the member no longer shares
  const unread = ctx.db.all<Record<string, unknown>>('SELECT c.id AS conversation_id, c.member_id, m.name AS member_name, COUNT(*) AS unread, MAX(ms.created_at) AS last_at FROM messages ms JOIN conversations c ON c.id = ms.conversation_id JOIN users m ON m.id = c.member_id WHERE c.coach_id = ? AND ms.sender_id != ? AND ms.read_at IS NULL GROUP BY c.id ORDER BY last_at DESC', [coachId, coachId]);
  const activity = ctx.db.all<Record<string, unknown>>(`SELECT a.at, a.action, a.target_type, a.target_id, CASE WHEN a.actor_id = ? THEN a.reason ELSE NULL END AS reason, u.name AS actor_name FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id WHERE a.action IN ('coach.note','plan.create','plan.publish','plan.archive','appointment.book','appointment.confirm','appointment.complete','appointment.cancel','appointment.reschedule','appointment.no_show','task.status','report.review','assignment.create','assignment.pause','assignment.resume','assignment.end','progress.add','consent.set') AND (a.target_id IN (SELECT member_id FROM coach_assignments WHERE coach_id = ? AND status IN ('active','paused')) OR a.actor_id = ?) ORDER BY a.at DESC LIMIT 15`, [coachId, coachId, coachId]);
  // clients with no plan at all; a client whose plan is still a draft is counted under drafts, not here
  const showCity = coachFieldPolicy(ctx).city;
  const noPlan = clients.filter((c) => !ctx.db.get("SELECT 1 FROM coaching_plans WHERE member_id = ? AND coach_id = ? AND status IN ('draft', 'published')", [c.id, coachId]));
  return {
    coach: getCoach(ctx, coachId),
    clients: clients.map(({ email: _email, city, ...c }) => (showCity ? { ...c, city } : c)), activeClients: clients.filter((c) => c.assignment_status === 'active').length,
    todaysAppointments: todays, upcomingAppointments: upcoming, requestedAppointments: requested,
    reportsToReview: reviews, draftPlans: drafts, clientsWithoutPlan: noPlan.map((c) => ({ id: c.id, name: c.name })),
    followUps, unreadConversations: unread, recentActivity: activity,
    metrics: {
      activeCaseload: clients.filter((c) => c.assignment_status === 'active').length,
      upcomingConsultations: upcoming.length + todays.length,
      outstandingTasks: followUps.length + reviews.length + drafts.length,
      reviewsDone30d: ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM report_metadata WHERE reviewed_by = ? AND reviewed_at >= datetime('now', '-30 days')", [coachId])?.n ?? 0,
      note: 'Operational counts only; these are not performance rankings.',
    },
    demo: ctx.config.isDemo,
  };
}
