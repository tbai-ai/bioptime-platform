/* M8 routes: live sessions, webinars and consultation follow-through. Registered by the module descriptor
   (api/modules/sessions.ts) inside /api. Every route goes through def() with its role, the feature flag 'sessions' and,
   for administrators, a permission (sessions.manage; members.manage for a member's record). The public webinar routes
   also need the 'public_webinars' switch. Every coach response passes the field policy guard: a coach never receives a
   phone number, an email address, an address, a PIN code or a date of birth. */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isoDateTimeSchema, emailSchema } from '@bioptime/domain';
import type { Ctx } from '../../context.js';
import { parse } from '../../lib/validate.js';
import { errors } from '../../lib/errors.js';
import { def, param, query } from '../route.js';
import { coachHasMember } from '../../auth/permissions.js';
import { coachSafe as policyCoachSafe } from '../../auth/fieldPolicy.js';
import { requireFeature } from '../../domain/features.js';
import * as appointments from '../../domain/appointments.js';
import * as s from '../../domain/sessions.js';

const FEATURE = 'sessions';
export const PUBLIC_FLAG = 'public_webinars';
const TAG = 'sessions';
const WRITE_LIMIT = { max: 60, timeWindow: '10 minutes' };

/** Every coach response passes the field policy's safety net (coachSafe in auth/fieldPolicy.ts): it looks at the
 *  payload as built, reports any restricted key a presenter produced (paths only, never values) and sends the payload
 *  without it. */
function coachSafe<T>(ctx: Ctx, payload: T): T {
  return policyCoachSafe(ctx, payload, 'sessions coach route');
}

const me = (req: FastifyRequest) => req.ctx.actor!.id;
const text = (min: number, max: number) => z.string().trim().min(min).max(max);

/* ---------- payloads ----------
   Built when the routes are registered, never when this file loads. api/domain/sessions.ts reaches this file
   through the module registry (domain/sessions -> modules/index -> modules/sessions -> here), so reading its
   constants at load time would fail whenever api/domain/sessions.ts is the first module a process imports. */
function payloads() {
  const sessionFields = {
    kind: z.enum(s.SESSION_KINDS),
    title: text(3, 160),
    description: z.string().max(4000).optional(),
    startAt: isoDateTimeSchema,
    endAt: isoDateTimeSchema,
    capacity: z.number().int().min(1).max(s.MAX_CAPACITY).nullable().optional(),
    audience: z.enum(s.SESSION_AUDIENCES),
    packageIds: z.array(z.string().min(1).max(64)).max(20).optional(),
    joinUrl: z.string().trim().max(500).nullable().optional(),
  };
  const coachCreate = z.object({ ...sessionFields, audience: z.enum(['members', 'packages']).default('members') });
  const adminCreate = z.object({ ...sessionFields, audience: sessionFields.audience.default('members'), hostId: z.string().min(1).max(64).optional() });
  const patchFields = {
    kind: sessionFields.kind.optional(), title: sessionFields.title.optional(), description: sessionFields.description, startAt: isoDateTimeSchema.optional(), endAt: isoDateTimeSchema.optional(),
    capacity: sessionFields.capacity, packageIds: sessionFields.packageIds, joinUrl: sessionFields.joinUrl, reason: z.string().trim().max(300).optional(),
  };
  const coachPatch = z.object({ ...patchFields, audience: z.enum(['members', 'packages']).optional() });
  const adminPatch = z.object({ ...patchFields, audience: sessionFields.audience.optional() });
  const reasonBody = z.object({ reason: text(3, 300) });
  const optionalReason = z.object({ reason: z.string().trim().max(300).optional() });
  const attendanceBody = z.object({ marks: z.array(z.object({ registrationId: z.string().min(1).max(64), status: z.enum(['attended', 'no_show', 'registered']) })).min(1).max(s.MAX_CAPACITY) });
  const rangeQuery = z.object({ range: z.enum(['upcoming', 'past', 'all']).optional() });
  const adminQuery = z.object({ range: z.enum(['upcoming', 'past', 'all']).optional(), status: z.enum(s.SESSION_STATUSES).optional(), hostId: z.string().max(64).optional(), audience: z.enum(s.SESSION_AUDIENCES).optional() });
  const meetingBody = z.object({ joinUrl: z.string().trim().min(1).max(500).nullable() });
  const summaryBody = z.object({
    forMember: text(10, 4000),
    privateNote: z.string().trim().max(4000).optional(),
    followUps: z.array(z.object({ title: text(2, 200), detail: z.string().trim().max(1000).optional() })).max(10).default([]),
  });
  const publicRegister = z.object({ name: text(2, 120), email: emailSchema, website: z.string().max(200).optional() });
  return { coachCreate, adminCreate, coachPatch, adminPatch, reasonBody, optionalReason, attendanceBody, rangeQuery, adminQuery, meetingBody, summaryBody, publicRegister };
}

function sendIcs(reply: FastifyReply, file: { filename: string; body: string }) {
  reply.type('text/calendar; charset=utf-8');
  reply.header('content-disposition', `attachment; filename="${file.filename}"`);
  reply.header('cache-control', 'no-store');
  return file.body;
}

/** The coach's own consultation with a client still assigned to them; anything else is not found or refused. */
function ownAppointment(req: FastifyRequest): string {
  const id = param(req, 'id');
  const a = req.ctx.db.get<{ coach_id: string | null; member_id: string }>('SELECT coach_id, member_id FROM appointments WHERE id = ?', [id]);
  if (!a || a.coach_id !== me(req)) throw errors.notFound('Appointment');
  if (!coachHasMember(req.ctx, me(req), a.member_id)) throw errors.forbidden('This member is no longer assigned to you', 'NO_ACCESS');
  return id;
}

export function sessionRoutes(app: FastifyInstance): void {
  const { coachCreate, adminCreate, coachPatch, adminPatch, reasonBody, optionalReason, attendanceBody, rangeQuery, adminQuery, meetingBody, summaryBody, publicRegister } = payloads();
  /* ---------- member ---------- */
  def(app, { method: 'GET', path: '/me/sessions', summary: 'Live sessions I can join (published, in my audience) and the ones I joined', tag: TAG, auth: 'member', feature: FEATURE }, async (req) => s.listForMember(req.ctx, me(req)));
  def(app, { method: 'GET', path: '/me/sessions/:id', summary: 'One live session: my place or waitlist position, and how to join once I hold a place', tag: TAG, auth: 'member', feature: FEATURE }, async (req) => s.getForMember(req.ctx, param(req, 'id'), me(req)));
  def(app, { method: 'POST', path: '/me/sessions/:id/register', summary: 'Register for a session; joins the waitlist when it is full', tag: TAG, auth: 'member', feature: FEATURE, rateLimit: { max: 30, timeWindow: '10 minutes' } }, async (req, reply) => { const out = s.register(req.ctx, param(req, 'id'), me(req)); reply.code(201); return out; });
  def(app, { method: 'POST', path: '/me/sessions/:id/cancel', summary: 'Give my place back (or leave the waitlist); the next person waiting is promoted', tag: TAG, auth: 'member', feature: FEATURE, rateLimit: { max: 30, timeWindow: '10 minutes' }, body: optionalReason }, async (req) => s.cancelRegistration(req.ctx, param(req, 'id'), me(req), parse(optionalReason, req.body ?? {}).reason));
  def(app, { method: 'GET', path: '/me/sessions/:id/ics', summary: 'A calendar file (.ics, times in IST) for a session I hold a place in', tag: TAG, auth: 'member', feature: FEATURE }, async (req, reply) => sendIcs(reply, s.sessionIcsForMember(req.ctx, param(req, 'id'), me(req))));
  def(app, { method: 'GET', path: '/me/appointments/:id/ics', summary: 'A calendar file (.ics, times in IST) for one of my consultations', tag: TAG, auth: 'member', feature: FEATURE }, async (req, reply) => {
    const id = param(req, 'id');
    const a = req.ctx.db.get<{ member_id: string }>('SELECT member_id FROM appointments WHERE id = ?', [id]);
    if (!a || a.member_id !== me(req)) throw errors.notFound('Appointment');
    return sendIcs(reply, s.appointmentIcs(req.ctx, id, 'member'));
  });
  def(app, { method: 'GET', path: '/me/consultation-summaries', summary: 'Summaries my coach wrote after my consultations', tag: TAG, auth: 'member', feature: FEATURE }, async (req) => ({ items: s.summariesForMember(req.ctx, me(req)) }));

  /* ---------- coach: the sessions they host ---------- */
  def(app, { method: 'GET', path: '/coach/sessions', summary: 'The live sessions I host (range upcoming|past|all)', tag: TAG, auth: 'coach', feature: FEATURE, query: rangeQuery }, async (req) => coachSafe(req.ctx, { items: s.listForHost(req.ctx, me(req), parse(rangeQuery, query(req))) }));
  def(app, { method: 'POST', path: '/coach/sessions', summary: 'Create a draft group class, webinar or workshop for members (public webinars are the Bioptime team’s)', tag: TAG, auth: 'coach', feature: FEATURE, rateLimit: WRITE_LIMIT, body: coachCreate }, async (req, reply) => { const out = s.createSession(req.ctx, parse(coachCreate, req.body)); reply.code(201); return coachSafe(req.ctx, out); });
  def(app, { method: 'GET', path: '/coach/sessions/:id', summary: 'One of my sessions with its counts', tag: TAG, auth: 'coach', feature: FEATURE }, async (req) => coachSafe(req.ctx, s.getForStaff(req.ctx, param(req, 'id'))));
  def(app, { method: 'PATCH', path: '/coach/sessions/:id', summary: 'Edit one of my sessions (registrants are told when the time or the join link changes)', tag: TAG, auth: 'coach', feature: FEATURE, rateLimit: WRITE_LIMIT, body: coachPatch }, async (req) => coachSafe(req.ctx, s.updateSession(req.ctx, param(req, 'id'), parse(coachPatch, req.body))));
  def(app, { method: 'POST', path: '/coach/sessions/:id/publish', summary: 'Publish a draft: members in its audience can register', tag: TAG, auth: 'coach', feature: FEATURE, rateLimit: WRITE_LIMIT }, async (req) => coachSafe(req.ctx, s.publishSession(req.ctx, param(req, 'id'))));
  def(app, { method: 'POST', path: '/coach/sessions/:id/cancel', summary: 'Cancel one of my sessions, with a reason; everyone registered or waiting is told', tag: TAG, auth: 'coach', feature: FEATURE, rateLimit: WRITE_LIMIT, body: reasonBody }, async (req) => coachSafe(req.ctx, s.cancelSession(req.ctx, param(req, 'id'), parse(reasonBody, req.body).reason)));
  def(app, { method: 'POST', path: '/coach/sessions/:id/complete', summary: 'Mark one of my sessions completed once it has started', tag: TAG, auth: 'coach', feature: FEATURE, rateLimit: WRITE_LIMIT }, async (req) => coachSafe(req.ctx, s.completeSession(req.ctx, param(req, 'id'))));
  def(app, { method: 'GET', path: '/coach/sessions/:id/registrations', summary: 'Who registered for one of my sessions: names, statuses and waitlist places only', tag: TAG, auth: 'coach', feature: FEATURE }, async (req) => coachSafe(req.ctx, { items: s.registrationsForHost(req.ctx, param(req, 'id')) }));
  def(app, { method: 'POST', path: '/coach/sessions/:id/attendance', summary: 'Record attendance for one of my sessions once it has started', tag: TAG, auth: 'coach', feature: FEATURE, rateLimit: WRITE_LIMIT, body: attendanceBody }, async (req) => coachSafe(req.ctx, s.markAttendance(req.ctx, param(req, 'id'), parse(attendanceBody, req.body).marks)));
  def(app, { method: 'GET', path: '/coach/sessions/:id/ics', summary: 'A calendar file (.ics, times in IST) for one of my sessions', tag: TAG, auth: 'coach', feature: FEATURE }, async (req, reply) => sendIcs(reply, s.sessionIcsForStaff(req.ctx, param(req, 'id'))));

  /* ---------- coach: consultation follow-through ---------- */
  def(app, { method: 'PATCH', path: '/coach/appointments/:id/meeting', summary: 'Set or clear how to join one of my consultations (an https link I typed; no provider creates meetings yet)', tag: TAG, auth: 'coach', feature: FEATURE, rateLimit: WRITE_LIMIT, body: meetingBody }, async (req) => { const id = ownAppointment(req); return coachSafe(req.ctx, appointments.setMeetingLink(req.ctx, id, parse(meetingBody, req.body).joinUrl)); });
  def(app, { method: 'GET', path: '/coach/appointments/:id/summary', summary: 'The summary, private notes and follow-ups of one of my consultations', tag: TAG, auth: 'coach', feature: FEATURE }, async (req) => coachSafe(req.ctx, s.summaryForCoach(req.ctx, ownAppointment(req))));
  def(app, { method: 'POST', path: '/coach/appointments/:id/summary', summary: 'After a completed consultation: a summary for the member, an optional private note and my follow-ups', tag: TAG, auth: 'coach', feature: FEATURE, rateLimit: WRITE_LIMIT, body: summaryBody }, async (req, reply) => { const id = ownAppointment(req); const out = s.writeSummary(req.ctx, id, parse(summaryBody, req.body)); reply.code(201); return coachSafe(req.ctx, out); });
  def(app, { method: 'GET', path: '/coach/appointments/:id/ics', summary: 'A calendar file (.ics, times in IST) for one of my consultations', tag: TAG, auth: 'coach', feature: FEATURE }, async (req, reply) => sendIcs(reply, s.appointmentIcs(req.ctx, ownAppointment(req), 'coach')));
  def(app, { method: 'GET', path: '/coach/consultation-follow-through', summary: 'My completed consultations of the last 90 days: summary written or not, open follow-ups', tag: TAG, auth: 'coach', feature: FEATURE }, async (req) => coachSafe(req.ctx, { items: s.followThroughForCoach(req.ctx, me(req)) }));
  def(app, { method: 'GET', path: '/coach/clients/:id/sessions', summary: 'An assigned client’s live sessions, consultation summaries and my follow-ups', tag: TAG, auth: 'coach', feature: FEATURE }, async (req) => {
    const id = param(req, 'id');
    if (!coachHasMember(req.ctx, me(req), id)) throw errors.forbidden('Not your client', 'NO_ACCESS');
    return coachSafe(req.ctx, s.clientRecord(req.ctx, id, { coachId: me(req) }));
  });

  /* ---------- administrators (sessions.manage) ---------- */
  const admin = { auth: 'admin' as const, permission: 'sessions.manage' as const, feature: FEATURE, tag: TAG };
  def(app, { ...admin, method: 'GET', path: '/admin/sessions', summary: 'Every live session (range, status, host, audience)', query: adminQuery }, async (req) => ({ items: s.listAll(req.ctx, parse(adminQuery, query(req))) }));
  def(app, { ...admin, method: 'GET', path: '/admin/sessions/hosts', summary: 'Who can host: active coaches and the Bioptime team (names only)' }, async (req) => ({ items: s.hostChoices(req.ctx) }));
  def(app, { ...admin, method: 'POST', path: '/admin/sessions', summary: 'Create a draft session for any host, including public webinars', rateLimit: WRITE_LIMIT, body: adminCreate }, async (req, reply) => { const out = s.createSession(req.ctx, parse(adminCreate, req.body)); reply.code(201); return out; });
  def(app, { ...admin, method: 'GET', path: '/admin/sessions/:id', summary: 'One session with its registrations, public registrants’ emails included' }, async (req) => ({ session: s.getForStaff(req.ctx, param(req, 'id')), registrations: s.registrationsForAdmin(req.ctx, param(req, 'id')) }));
  def(app, { ...admin, method: 'PATCH', path: '/admin/sessions/:id', summary: 'Edit a session', rateLimit: WRITE_LIMIT, body: adminPatch }, async (req) => s.updateSession(req.ctx, param(req, 'id'), parse(adminPatch, req.body)));
  def(app, { ...admin, method: 'POST', path: '/admin/sessions/:id/publish', summary: 'Publish a draft session', rateLimit: WRITE_LIMIT }, async (req) => s.publishSession(req.ctx, param(req, 'id')));
  def(app, { ...admin, method: 'POST', path: '/admin/sessions/:id/cancel', summary: 'Cancel a session, with a reason; everyone registered or waiting is told', rateLimit: WRITE_LIMIT, body: reasonBody }, async (req) => s.cancelSession(req.ctx, param(req, 'id'), parse(reasonBody, req.body).reason));
  def(app, { ...admin, method: 'POST', path: '/admin/sessions/:id/complete', summary: 'Mark a session completed once it has started', rateLimit: WRITE_LIMIT }, async (req) => s.completeSession(req.ctx, param(req, 'id')));
  def(app, { ...admin, method: 'GET', path: '/admin/sessions/:id/registrations', summary: 'A session’s registrations, public registrants’ emails included' }, async (req) => ({ items: s.registrationsForAdmin(req.ctx, param(req, 'id')) }));
  def(app, { ...admin, method: 'POST', path: '/admin/sessions/:id/attendance', summary: 'Record attendance once the session has started', rateLimit: WRITE_LIMIT, body: attendanceBody }, async (req) => { const out = s.markAttendance(req.ctx, param(req, 'id'), parse(attendanceBody, req.body).marks); return { session: out.session, items: s.registrationsForAdmin(req.ctx, param(req, 'id')) }; });
  def(app, { ...admin, method: 'POST', path: '/admin/sessions/:id/registrations/:registrationId/cancel', summary: 'Cancel one registration (a member’s or a visitor’s), with a reason; the person is told', rateLimit: WRITE_LIMIT, body: reasonBody }, async (req) => ({ items: s.adminCancelRegistration(req.ctx, param(req, 'id'), param(req, 'registrationId'), parse(reasonBody, req.body).reason) }));
  def(app, { ...admin, method: 'GET', path: '/admin/sessions/:id/ics', summary: 'A calendar file (.ics, times in IST) for a session' }, async (req, reply) => sendIcs(reply, s.sessionIcsForStaff(req.ctx, param(req, 'id'))));
  def(app, { method: 'GET', path: '/admin/members/:id/sessions', summary: 'A member’s live sessions, consultation summaries and every coach’s follow-ups', tag: TAG, auth: 'admin', permission: 'members.manage', feature: FEATURE }, async (req) => s.clientRecord(req.ctx, param(req, 'id'), { coachId: null }));

  /* ---------- public webinars (also need the public_webinars switch) ---------- */
  def(app, { method: 'GET', path: '/public/webinars', summary: 'Upcoming public webinars (no join links, no registrant detail)', tag: TAG, auth: 'none', feature: FEATURE }, async (req, reply) => { requireFeature(req.ctx, PUBLIC_FLAG); reply.header('cache-control', 'no-cache'); return { items: s.listPublic(req.ctx) }; });
  /* One answer for every accepted sign-up (202, { received: true }): new, repeat, placed or waitlisted, and the honeypot
     too. Whether a place was given is sent to the email address, never in the response. */
  def(app, { method: 'POST', path: '/public/webinars/:id/register', summary: 'Register for a public webinar with a name and an email; the details are sent to that email (rate-limited; a honeypot field catches bots)', tag: TAG, auth: 'none', feature: FEATURE, rateLimit: { max: 5, timeWindow: '10 minutes' }, body: publicRegister }, async (req, reply) => {
    requireFeature(req.ctx, PUBLIC_FLAG);
    const input = parse(publicRegister, req.body);
    if (input.website) { reply.code(202); return { received: true }; } // honeypot: answer as if received, record nothing
    const out = s.registerPublic(req.ctx, param(req, 'id'), { name: input.name, email: input.email });
    reply.code(202);
    return out;
  });
}
