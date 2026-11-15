import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isoDateSchema, isoDateTimeSchema, progressEntrySchema } from '@bioptime/domain';
import { parse, pageParams } from '../../lib/validate.js';
import { errors } from '../../lib/errors.js';
import { def, param, query } from '../route.js';
import { requireMemberAccess, requireHealthAccess, coachHasMember } from '../../auth/permissions.js';
import { coachFieldPolicy, coachMemberView, coachSafe } from '../../auth/fieldPolicy.js';
import { randomId } from '../../lib/ids.js';
import { audit } from '../../domain/audit.js';
import { notify } from '../../domain/notifications.js';
import * as coaches from '../../domain/coaches.js';
import * as members from '../../domain/members.js';
import { milestonesFor } from '../../domain/milestones.js';
import * as appointments from '../../domain/appointments.js';
import * as plans from '../../domain/plans.js';
import * as bloodwork from '../../domain/bloodwork.js';
import * as entitlements from '../../domain/entitlements.js';
import { openTask, listTasks, updateTask } from '../../domain/support.js';

const planStructure = z.object({ weeks: z.array(z.object({ week: z.number().int().min(1), focus: z.string().optional(), tasks: z.array(z.object({ title: z.string().min(1).max(200), kind: z.string().optional(), day: z.number().int().min(1).max(7).optional(), note: z.string().max(500).optional() })) })), reviewSchedule: z.string().optional(), progressIndicators: z.array(z.string()).optional() });

/** Bookings as a coach reads them: the booking presenter's collection address (street, city, state, PIN code) stays out,
    so coachSafe never has to strip it. */
function coachBookings<T extends { address?: unknown }>(items: T[]): Array<Omit<T, 'address'>> { return items.map(({ address: _address, ...b }) => b); }

/** Onboarding answers a coach may read: the goals and preference steps; the profile step holds contact details and stays out. */
function stripOnboarding(data: Record<string, unknown>): Record<string, unknown> { const { profile: _p, ...rest } = data; return rest; }

export function coachRoutes(app: FastifyInstance): void {
  const me = (req: { ctx: { actor: { id: string } | null } }) => req.ctx.actor!.id;
  const clientId = (req: Parameters<typeof param>[0]) => { const id = param(req, 'id'); if (!coachHasMember(req.ctx, me(req), id)) throw errors.forbidden('Not your client', 'NO_ACCESS'); return id; };

  def(app, { method: 'GET', path: '/coach/home', summary: 'Coach home: clients, today, upcoming, reviews, drafts, follow-ups, unread, activity', tag: 'coach', auth: 'coach' }, async (req) => { const { coach, ...clients } = coaches.coachHome(req.ctx, me(req)); return { coach, ...guard(req, clients) }; });
  def(app, { method: 'GET', path: '/coach/profile', summary: 'My coach profile', tag: 'coach', auth: 'coach' }, async (req) => coaches.getCoach(req.ctx, me(req)));
  def(app, { method: 'PATCH', path: '/coach/profile', summary: 'Update my profile (within my scope)', tag: 'coach', auth: 'coach', body: z.object({ displayName: z.string().min(2).max(120).optional(), bio: z.string().max(2000).optional(), expertise: z.array(z.string()).optional(), languages: z.array(z.string()).optional(), city: z.string().optional(), timezone: z.string().optional() }) }, async (req) => coaches.updateCoach(req.ctx, me(req), parse(z.object({ displayName: z.string().min(2).max(120).optional(), bio: z.string().max(2000).optional(), expertise: z.array(z.string()).optional(), languages: z.array(z.string()).optional(), city: z.string().optional(), timezone: z.string().optional() }), req.body)));
  def(app, { method: 'GET', path: '/coach/availability', summary: 'Working hours, blocks and status', tag: 'coach', auth: 'coach' }, async (req) => ({ rules: coaches.getAvailabilityRules(req.ctx, me(req)), blocks: coaches.listBlocks(req.ctx, me(req)), coach: coaches.getCoach(req.ctx, me(req)) }));
  const rulesSchema = z.object({ rules: z.array(z.object({ weekday: z.number().int().min(0).max(6), startMinute: z.number().int().min(0).max(1439), endMinute: z.number().int().min(1).max(1440), slotMinutes: z.number().int().min(15).max(120).optional() })) });
  def(app, { method: 'PUT', path: '/coach/availability', summary: 'Replace my working hours', tag: 'coach', auth: 'coach', body: rulesSchema }, async (req) => ({ rules: coaches.setAvailabilityRules(req.ctx, me(req), parse(rulesSchema, req.body).rules) }));
  def(app, { method: 'POST', path: '/coach/availability/blocks', summary: 'Block a period (leave, no appointments)', tag: 'coach', auth: 'coach', body: z.object({ startAt: isoDateTimeSchema, endAt: isoDateTimeSchema, reason: z.string().max(200).optional() }) }, async (req, reply) => { reply.code(201); return coaches.addBlock(req.ctx, me(req), parse(z.object({ startAt: isoDateTimeSchema, endAt: isoDateTimeSchema, reason: z.string().max(200).optional() }), req.body)); });
  def(app, { method: 'DELETE', path: '/coach/availability/blocks/:id', summary: 'Remove a block', tag: 'coach', auth: 'coach' }, async (req) => { coaches.removeBlock(req.ctx, me(req), param(req, 'id')); return { ok: true }; });
  def(app, { method: 'POST', path: '/coach/availability/status', summary: 'Mark myself available or away (pauses or resumes my assignments)', tag: 'coach', auth: 'coach', body: z.object({ available: z.boolean(), unavailableUntil: isoDateSchema.optional(), reason: z.string().min(2).max(300) }) }, async (req) => { const i = parse(z.object({ available: z.boolean(), unavailableUntil: isoDateSchema.optional(), reason: z.string().min(2).max(300) }), req.body); return coaches.setAvailability(req.ctx, me(req), { available: i.available, unavailableUntil: i.unavailableUntil ? `${i.unavailableUntil}T23:59:59.000Z` : null, reason: i.reason }); });

  /* every coach response passes the field policy (coachSafe): the payload is checked as the presenter built it, a
     restricted key is never sent (it is stripped) and any key that had to be stripped is reported */
  const guard = <T,>(req: { ctx: import('../../context.js').Ctx; method: string; routeOptions: { url?: string } }, payload: T): T => coachSafe(req.ctx, payload, `${req.method} ${req.routeOptions.url ?? 'coach route'}`);
  const listQuery = z.object({ q: z.string().max(80).optional(), status: z.enum(['active', 'paused', 'ended', 'all']).optional(), sort: z.enum(['name', 'recent', 'ends', 'next', 'progress']).optional(), page: z.coerce.number().int().min(1).optional(), limit: z.coerce.number().int().min(1).max(100).optional() });
  def(app, { method: 'GET', path: '/coach/clients', summary: 'My assigned clients: search, filter by assignment status, sort, paginate; never restricted fields', tag: 'coach', auth: 'coach', query: listQuery }, async (req) => guard(req, members.listClientsForCoach(req.ctx, me(req), parse(listQuery, query(req)))));
  def(app, { method: 'GET', path: '/coach/clients/:id/assignments', summary: 'My assignment history with this client', tag: 'coach', auth: 'coach' }, async (req) => { const id = clientId(req); return guard(req, { items: req.ctx.db.all('SELECT id, status, method, reason, effective_at, ended_at, created_at FROM coach_assignments WHERE member_id = ? AND coach_id = ? ORDER BY created_at DESC', [id, me(req)]) }); });
  def(app, { method: 'GET', path: '/coach/clients/:id', summary: 'A client: overview, consents, entitlements, assignment, plan; health detail only when shared', tag: 'coach', auth: 'coach' }, async (req) => {
    const id = clientId(req);
    requireMemberAccess(req.ctx, id);
    const overview = members.memberOverview(req.ctx, id);
    const profile = members.getProfile(req.ctx, id);
    const shared = profile.consents.coach_sharing?.granted === true; // no recorded consent is no consent
    const notes = req.ctx.db.all('SELECT n.*, u.name AS coach_name FROM coach_notes n JOIN users u ON u.id = n.coach_id WHERE n.member_id = ? ORDER BY n.created_at DESC LIMIT 100', [id]);
    const onboarding = req.ctx.db.get<{ data: string }>('SELECT data FROM onboarding_progress WHERE user_id = ?', [id]);
    const assignmentHistory = req.ctx.db.all('SELECT id, status, method, reason, effective_at, ended_at, created_at FROM coach_assignments WHERE member_id = ? AND coach_id = ? ORDER BY created_at DESC', [id, me(req)]);
    const { member: _member, bloodwork: _latestBooking, ...rest } = overview as Record<string, unknown> & { member: unknown; bloodwork?: unknown };
    audit(req.ctx, 'member.record_viewed', { type: 'user', id }, null, { by: 'coach', sections: ['overview', 'profile', 'plans', 'appointments', shared ? 'bloodwork' : 'no-bloodwork'] });
    // measurements, the progress log and the wellness score are health information: they follow the sharing consent, as
    // bookings and reports do (the coach keeps plan and task completion, which the coach authored)
    const fullView = coachMemberView(req.ctx, profile);
    const view = shared ? fullView : { ...fullView, profile: { ...fullView.profile, wellnessScore: null } };
    const summary = plans.progressSummary(req.ctx, id);
    return guard(req, { ...rest, recentProgress: shared ? (rest as { recentProgress?: unknown }).recentProgress ?? [] : [], member: { id: view.id, name: view.name, state: view.state, memberCode: view.memberCode, age: view.profile.age, wellnessScore: view.profile.wellnessScore, wellnessScoreLabel: view.profile.wellnessScoreLabel, onboardingCompleted: !!view.profile.onboardingCompletedAt }, profile: view, onboardingResponses: onboarding ? stripOnboarding(JSON.parse(onboarding.data) as Record<string, unknown>) : null, assignmentHistory, healthShared: shared, entitlements: entitlements.listForMember(req.ctx, id), notes, plans: plans.listPlans(req.ctx, { memberId: id, includeDraft: true }), appointments: appointments.list(req.ctx, { memberId: id, range: 'all', limit: 50 }), bookings: shared ? coachBookings(bloodwork.listBookings(req.ctx, { memberId: id, limit: 50 })) : [], reports: shared ? bloodwork.listReports(req.ctx, { memberId: id, limit: 50 }) : [], progress: shared ? summary : { ...summary, metrics: [], withheld: true }, milestones: milestonesFor(req.ctx, id).filter((ms) => shared || !['collection', 'report'].includes(ms.key)), bloodwork: shared ? (overview as { bloodwork?: unknown }).bloodwork ?? null : null, fieldPolicyVisible: Object.entries(coachFieldPolicy(req.ctx)).filter(([, v]) => v).map(([k]) => k) });
  });
  def(app, { method: 'GET', path: '/coach/clients/:id/bloodwork', summary: 'A client’s bookings and reports (requires sharing consent); collection addresses are never included', tag: 'coach', auth: 'coach' }, async (req) => { const id = clientId(req); requireHealthAccess(req.ctx, id); audit(req.ctx, 'health.viewed', { type: 'user', id }, null, { by: 'coach', what: 'bookings-and-reports' }); return guard(req, { bookings: coachBookings(bloodwork.listBookings(req.ctx, { memberId: id, limit: 50 })), reports: bloodwork.listReports(req.ctx, { memberId: id, limit: 50 }) }); });
  const noteBody = z.object({ body: z.string().min(1).max(4000), kind: z.enum(['note', 'review', 'consultation']).optional(), visibility: z.enum(['private', 'client']).optional(), refType: z.string().optional(), refId: z.string().optional() });
  def(app, { method: 'POST', path: '/coach/clients/:id/notes', summary: 'Add a note about a client: private (coaching team and administrators) or client-visible (shown to the member as a recommendation)', tag: 'coach', auth: 'coach', rateLimit: { max: 60, timeWindow: '10 minutes' }, body: noteBody }, async (req, reply) => {
    const id = clientId(req);
    const i = parse(noteBody, req.body);
    const noteId = randomId('cnt');
    req.ctx.db.insert('coach_notes', { id: noteId, coach_id: me(req), member_id: id, kind: i.kind ?? 'note', visibility: i.visibility ?? 'private', author_role: 'coach', body: i.body, ref_type: i.refType ?? null, ref_id: i.refId ?? null, created_at: req.ctx.now() });
    audit(req.ctx, 'coach.note', { type: 'user', id }, null, { noteId, kind: i.kind ?? 'note', visibility: i.visibility ?? 'private' });
    if (i.visibility === 'client') notify(req.ctx, { userId: id, category: 'message', title: 'A note from your coach', body: 'Your coach left you a recommendation. Read it under Recommendations.', data: { noteId } });
    reply.code(201);
    return req.ctx.db.get('SELECT * FROM coach_notes WHERE id = ?', [noteId]);
  });
  def(app, { method: 'POST', path: '/coach/clients/:id/follow-ups', summary: 'Create a follow-up task for myself about a client', tag: 'coach', auth: 'coach', body: z.object({ title: z.string().min(2).max(200), detail: z.string().max(1000).optional() }) }, async (req, reply) => { const id = clientId(req); const i = parse(z.object({ title: z.string().min(2).max(200), detail: z.string().max(1000).optional() }), req.body); const taskId = openTask(req.ctx, { kind: 'coach_follow_up', title: i.title, detail: i.detail, refType: 'user', refId: id, dedupe: false, ownerId: me(req), notify: false }); reply.code(201); return req.ctx.db.get('SELECT * FROM support_tasks WHERE id = ?', [taskId]); });
  def(app, { method: 'GET', path: '/coach/follow-ups', summary: 'My follow-up tasks', tag: 'coach', auth: 'coach' }, async (req) => guard(req, { items: coaches.openFollowUpsFor(req.ctx, me(req), { newestFirst: true, limit: 200 }) }));
  const followUpPatch = z.object({ status: z.enum(['open', 'in_progress', 'resolved', 'dismissed']), resolution: z.string().max(500).optional() });
  def(app, { method: 'PATCH', path: '/coach/follow-ups/:id', summary: 'Update one of my follow-ups (one on a habit the member wrote, while they do not share health information, can only be closed, and its title is not returned)', tag: 'coach', auth: 'coach', body: followUpPatch }, async (req) => {
    const id = param(req, 'id');
    const t = req.ctx.db.get<{ owner_id: string | null }>('SELECT owner_id FROM support_tasks WHERE id = ?', [id]);
    if (!t || t.owner_id !== me(req)) throw errors.notFound('Follow-up');
    const i = parse(followUpPatch, req.body);
    // a follow-up naming a habit the member no longer shares (coaches.WITHHELD_HABIT_FOLLOW_UP) stays closed
    const withheld = coaches.followUpWithheld(req.ctx, id);
    if (withheld && (i.status === 'open' || i.status === 'in_progress')) throw errors.forbidden('This member no longer shares their health information with you, so this follow-up cannot be reopened', 'NOT_SHARED');
    const updated = updateTask(req.ctx, id, i, i.resolution) as Record<string, unknown>;
    if (!withheld) return guard(req, updated);
    const { title: _title, detail: _detail, ...rest } = updated;
    return guard(req, { ...rest, withheld: true });
  });
  def(app, { method: 'POST', path: '/coach/clients/:id/progress', summary: 'Record a coach-entered progress value for a client', tag: 'coach', auth: 'coach', rateLimit: { max: 60, timeWindow: '10 minutes' }, body: progressEntrySchema }, async (req, reply) => { const id = clientId(req); reply.code(201); return plans.addProgress(req.ctx, { memberId: id, ...parse(progressEntrySchema, req.body), source: 'coach' }); });

  def(app, { method: 'GET', path: '/coach/plans', summary: 'My coaching plans (drafts included)', tag: 'coach', auth: 'coach' }, async (req) => guard(req, ({ items: plans.listPlans(req.ctx, { coachId: me(req), includeDraft: true }) })));
  const planCreate = z.object({ memberId: z.string(), title: z.string().min(2).max(160), goals: z.array(z.string()).default([]), summary: z.string().max(2000).optional(), structure: planStructure });
  def(app, { method: 'POST', path: '/coach/plans', summary: 'Create a draft plan for a client', tag: 'coach', auth: 'coach', rateLimit: { max: 60, timeWindow: '10 minutes' }, body: planCreate }, async (req, reply) => { const i = parse(planCreate, req.body); if (!coachHasMember(req.ctx, me(req), i.memberId)) throw errors.forbidden('Not your client', 'NO_ACCESS'); reply.code(201); const programme = req.ctx.db.get<{ id: string }>("SELECT id FROM programmes WHERE member_id = ? AND status = 'active' ORDER BY start_at DESC LIMIT 1", [i.memberId]); return plans.createPlan(req.ctx, { coachId: me(req), memberId: i.memberId, programmeId: programme?.id ?? null, title: i.title, goals: i.goals, summary: i.summary, structure: i.structure }); });
  def(app, { method: 'GET', path: '/coach/plans/:id', summary: 'One plan with versions and tasks', tag: 'coach', auth: 'coach' }, async (req) => { ownPlan(req, me(req)); return guard(req, plans.presentPlan(req.ctx, param(req, 'id'), { includeDraft: true })); });
  def(app, { method: 'PATCH', path: '/coach/plans/:id', summary: 'Edit the draft version', tag: 'coach', auth: 'coach', body: planCreate.partial().omit({ memberId: true }) }, async (req) => { ownPlan(req, me(req)); return plans.updateDraft(req.ctx, param(req, 'id'), parse(planCreate.partial().omit({ memberId: true }), req.body)); });
  def(app, { method: 'POST', path: '/coach/plans/:id/publish', summary: 'Publish the draft: generates tasks and notifies the member', tag: 'coach', auth: 'coach', body: z.object({ startDate: isoDateSchema.optional() }) }, async (req) => { ownPlan(req, me(req)); return plans.publish(req.ctx, param(req, 'id'), parse(z.object({ startDate: isoDateSchema.optional() }), req.body).startDate); });
  def(app, { method: 'POST', path: '/coach/plans/:id/archive', summary: 'Archive a plan', tag: 'coach', auth: 'coach', body: z.object({ reason: z.string().min(2).max(300) }) }, async (req) => { ownPlan(req, me(req)); plans.archive(req.ctx, param(req, 'id'), parse(z.object({ reason: z.string().min(2).max(300) }), req.body).reason); return { ok: true }; });

  def(app, { method: 'GET', path: '/coach/appointments', summary: 'My appointments (range upcoming|past|all)', tag: 'coach', auth: 'coach', query: z.object({ range: z.enum(['upcoming', 'past', 'all']).optional() }) }, async (req) => guard(req, ({ items: appointments.list(req.ctx, { coachId: me(req), range: (query(req).range as 'upcoming' | 'past' | 'all') ?? 'upcoming', limit: 200 }) })));
  def(app, { method: 'GET', path: '/coach/appointments/slots', summary: 'My free slots on a date', tag: 'coach', auth: 'coach', query: z.object({ date: isoDateSchema }) }, async (req) => { const date = parse(isoDateSchema, query(req).date); return { date, slots: appointments.slotsFor(req.ctx, me(req), date) }; });
  def(app, { method: 'POST', path: '/coach/appointments', summary: 'Schedule a consultation for a client', tag: 'coach', auth: 'coach', rateLimit: { max: 60, timeWindow: '10 minutes' }, body: z.object({ memberId: z.string(), startAt: isoDateTimeSchema, kind: z.enum(['consultation', 'check_in', 'review']).default('consultation'), note: z.string().max(500).optional() }) }, async (req, reply) => { const i = parse(z.object({ memberId: z.string(), startAt: isoDateTimeSchema, kind: z.enum(['consultation', 'check_in', 'review']).default('consultation'), note: z.string().max(500).optional() }), req.body); if (!coachHasMember(req.ctx, me(req), i.memberId)) throw errors.forbidden('Not your client', 'NO_ACCESS'); reply.code(201); return appointments.book(req.ctx, { memberId: i.memberId, coachId: me(req), startAt: i.startAt, kind: i.kind, note: i.note, byCoach: true }); });
  def(app, { method: 'POST', path: '/coach/appointments/:id/confirm', summary: 'Confirm a requested appointment', tag: 'coach', auth: 'coach' }, async (req) => { ownAppointment(req, me(req)); return appointments.confirm(req.ctx, param(req, 'id')); });
  def(app, { method: 'PATCH', path: '/coach/appointments/:id', summary: 'Move an appointment', tag: 'coach', auth: 'coach', body: z.object({ startAt: isoDateTimeSchema, reason: z.string().max(300).optional() }) }, async (req) => { ownAppointment(req, me(req)); const i = parse(z.object({ startAt: isoDateTimeSchema, reason: z.string().max(300).optional() }), req.body); return appointments.reschedule(req.ctx, param(req, 'id'), i.startAt, i.reason); });
  def(app, { method: 'POST', path: '/coach/appointments/:id/complete', summary: 'Mark completed (consumes the consultation entitlement)', tag: 'coach', auth: 'coach', body: z.object({ note: z.string().max(2000).optional() }) }, async (req) => { ownAppointment(req, me(req)); return appointments.complete(req.ctx, param(req, 'id'), parse(z.object({ note: z.string().max(2000).optional() }), req.body).note); });
  def(app, { method: 'POST', path: '/coach/appointments/:id/cancel', summary: 'Cancel (releases the entitlement)', tag: 'coach', auth: 'coach', body: z.object({ reason: z.string().min(2).max(300) }) }, async (req) => { ownAppointment(req, me(req)); return appointments.cancel(req.ctx, param(req, 'id'), parse(z.object({ reason: z.string().min(2).max(300) }), req.body).reason); });
  def(app, { method: 'POST', path: '/coach/appointments/:id/no-show', summary: 'Mark a no-show', tag: 'coach', auth: 'coach', body: z.object({ note: z.string().max(300).optional() }) }, async (req) => { ownAppointment(req, me(req)); return appointments.noShow(req.ctx, param(req, 'id'), parse(z.object({ note: z.string().max(300).optional() }), req.body).note); });

  def(app, { method: 'GET', path: '/coach/reports', summary: 'Reports for my clients (unreviewed=1 for the queue)', tag: 'coach', auth: 'coach', query: z.object({ unreviewed: z.string().optional() }) }, async (req) => {
    const items = bloodwork.listReports(req.ctx, { coachId: me(req), unreviewed: query(req).unreviewed === '1', limit: 100 });
    // the queue carries marker values, so a read is audited per client exactly as the client record's bloodwork section is
    for (const memberId of new Set(items.map((r) => r.memberId as string))) audit(req.ctx, 'health.viewed', { type: 'user', id: memberId }, null, { by: 'coach', what: 'reports-queue', reports: items.filter((r) => r.memberId === memberId).map((r) => r.id) });
    return guard(req, { items });
  });
  def(app, { method: 'POST', path: '/coach/reports/:id/review', summary: 'Review a report: note for the member, flags; releases it and completes the booking', tag: 'coach', auth: 'coach', body: z.object({ coachNote: z.string().min(5).max(4000), flagged: z.array(z.string()).optional() }) }, async (req) => { const { memberId } = bloodwork.assertReportAccess(req.ctx, param(req, 'id')); if (!bloodwork.coachCanReview(req.ctx, memberId)) throw errors.forbidden('While you are away, or the member keeps sharing off, the Bioptime team reviews this report', 'COACH_CANNOT_REVIEW'); return bloodwork.reviewReport(req.ctx, param(req, 'id'), parse(z.object({ coachNote: z.string().min(5).max(4000), flagged: z.array(z.string()).optional() }), req.body)); });
  def(app, { method: 'GET', path: '/coach/bookings', summary: 'Bookings across my clients (no collection addresses)', tag: 'coach', auth: 'coach' }, async (req) => guard(req, { items: coachBookings(bloodwork.listBookings(req.ctx, { coachId: me(req), ...pageParams(query(req), 100) })) }));
}

function ownPlan(req: Parameters<typeof param>[0], coachId: string): void {
  const p = req.ctx.db.get<{ coach_id: string; member_id: string }>('SELECT coach_id, member_id FROM coaching_plans WHERE id = ?', [param(req, 'id')]);
  if (!p || p.coach_id !== coachId) throw errors.notFound('Plan');
  if (!coachHasMember(req.ctx, coachId, p.member_id)) throw errors.forbidden('This member is no longer assigned to you', 'NO_ACCESS');
}
function ownAppointment(req: Parameters<typeof param>[0], coachId: string): void {
  const a = req.ctx.db.get<{ coach_id: string | null; member_id: string }>('SELECT coach_id, member_id FROM appointments WHERE id = ?', [param(req, 'id')]);
  if (!a || a.coach_id !== coachId) throw errors.notFound('Appointment');
  if (!coachHasMember(req.ctx, coachId, a.member_id)) throw errors.forbidden('This member is no longer assigned to you', 'NO_ACCESS');
}
