/* M7 Lab follow-ups and preparation reminders: the routes. Every one goes through def() with its role,
   `feature: 'labFollowups'` (403 FEATURE_DISABLED while the flag is off) and, for administrators, a permission:
   reports.view to read, integrations.manage to write (the permission that releases a report the team reviews).
   Records are checked again in api/domain/labFollowups.ts: a member reaches only their own released reports' next
   steps; a coach only an assigned client's, and only while that client shares health information (requireHealthAccess,
   NOT_SHARED otherwise); the team changes a coach's next step's status and link, never its words or due date
   (COACH_FOLLOW_UP), and so does a coach on a step another coach wrote (OTHER_COACH_FOLLOW_UP). Coach payloads pass
   the field policy guard; every write is audited. */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { parse } from '../../lib/validate.js';
import { errors } from '../../lib/errors.js';
import { def, param, query } from '../route.js';
import { coachHasMember, hasPermission, requireHealthAccess } from '../../auth/permissions.js';
import { adminRestrictedKeys, coachSafe, stripRestricted } from '../../auth/fieldPolicy.js';
import { audit } from '../../domain/audit.js';
import * as lab from '../../domain/labFollowups.js';

const FEATURE = 'labFollowups';
const TAG = 'labFollowups';

/* ---------- payloads ----------
   Built when the routes are registered, never when this file loads. api/domain/labFollowups.ts reaches this file
   through the module registry (domain/labFollowups -> modules/index -> modules/labFollowups -> here), so reading its
   constants at load time would fail whenever api/domain/labFollowups.ts is the first module a process imports. */
function payloads() {
  const dueDate = z.string().refine((s) => lab.isRealDate(s), 'Use a real date, YYYY-MM-DD');
  const recordId = z.string().trim().min(3).max(64);
  const links = { appointmentId: recordId.nullable().optional(), bookingId: recordId.nullable().optional(), planId: recordId.nullable().optional() };
  const reason = z.string().trim().min(3).max(300);
  const followUpCreateSchema = z.object({ kind: z.enum(lab.FOLLOW_UP_KINDS), note: z.string().trim().min(3).max(2000), dueDate: dueDate.nullable().optional(), ...links }).strict();
  const teamFollowUpCreateSchema = z.object({ kind: z.enum(lab.FOLLOW_UP_KINDS), note: z.string().trim().min(3).max(2000), dueDate: dueDate.nullable().optional(), ...links, reason }).strict();
  const somethingToChange = (b: Record<string, unknown>) => Object.keys(b).some((k) => k !== 'reason' && b[k] !== undefined);
  const followUpUpdateSchema = z.object({ note: z.string().trim().min(3).max(2000).optional(), dueDate: dueDate.nullable().optional(), status: z.enum(lab.FOLLOW_UP_STATUSES).optional(), ...links, reason: reason.optional() }).strict()
    .refine(somethingToChange, { message: 'Say what changes: note, dueDate, status or a link' });
  const teamFollowUpUpdateSchema = z.object({ note: z.string().trim().min(3).max(2000).optional(), dueDate: dueDate.nullable().optional(), status: z.enum(lab.FOLLOW_UP_STATUSES).optional(), ...links, reason }).strict()
    .refine(somethingToChange, { message: 'Say what changes: note, dueDate, status or a link' });
  const reportQuery = z.object({ reportId: recordId.optional() });
  const statusOrAll = z.enum(['open', 'done', 'cancelled', 'all']);
  const coachListQuery = z.object({ status: statusOrAll.optional() });
  const teamListQuery = z.object({
    status: statusOrAll.optional(), kind: z.enum(lab.FOLLOW_UP_KINDS).optional(),
    memberId: recordId.optional(), reportId: recordId.optional(), overdue: z.enum(['1', '0', 'true', 'false']).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  });
  return { reason, followUpCreateSchema, teamFollowUpCreateSchema, followUpUpdateSchema, teamFollowUpUpdateSchema, reportQuery, coachListQuery, teamListQuery };
}

export function labFollowUpRoutes(app: FastifyInstance): void {
  const { reason, followUpCreateSchema, teamFollowUpCreateSchema, followUpUpdateSchema, teamFollowUpUpdateSchema, reportQuery, coachListQuery, teamListQuery } = payloads();
  const me = (req: FastifyRequest) => req.ctx.actor!.id;
  /** The assigned coach only; anyone else is refused before the record is read. */
  const clientId = (req: FastifyRequest) => { const id = param(req, 'id'); if (!coachHasMember(req.ctx, me(req), id)) throw errors.forbidden('Not your client', 'NO_ACCESS'); return id; };
  /** The field policy's safety net over the whole coach payload (no phone, email, address, PIN or date of birth): coachSafe
   *  looks at the payload as built, reports any restricted key a presenter produced (paths only) and sends it without. */
  const guard = <T,>(ctx: Ctx, payload: T): T => coachSafe(ctx, payload, 'labFollowups coach route');
  /** Administrators without members.view_restricted never receive restricted keys. */
  const teamView = <T,>(ctx: Ctx, payload: T): T => (hasPermission(ctx, 'members.view_restricted') ? payload : stripRestricted(payload, adminRestrictedKeys()));
  const truthy = (v: unknown) => v === '1' || v === 'true';

  /* ---------- member ---------- */

  def(app, { method: 'GET', path: '/me/lab-follow-ups', summary: 'The next steps on my released reports (?reportId= for one report)', tag: TAG, auth: 'member', feature: FEATURE, query: reportQuery }, async (req) => {
    const q = parse(reportQuery, query(req));
    return { items: lab.listForMember(req.ctx, me(req), { reportId: q.reportId }) };
  });

  def(app, { method: 'GET', path: '/me/lab-preparation', summary: 'My upcoming home collections: the laboratory’s preparation and the reminder Bioptime sends', tag: TAG, auth: 'member', feature: FEATURE }, async (req) => ({
    items: lab.preparationForMember(req.ctx, me(req)), timing: lab.PREPARATION_TIMING,
  }));

  /* ---------- coach ---------- */

  def(app, { method: 'GET', path: '/coach/lab-follow-ups', summary: 'Next steps across my clients who share health information (open ones unless ?status=)', tag: TAG, auth: 'coach', feature: FEATURE, query: coachListQuery }, async (req) => {
    const q = parse(coachListQuery, query(req));
    const items = lab.listForCoach(req.ctx, me(req), { status: q.status ?? 'open' });
    for (const memberId of new Set(items.map((f) => f.memberId))) audit(req.ctx, 'health.viewed', { type: 'user', id: memberId }, null, { by: 'coach', what: 'lab-follow-ups' });
    return guard(req.ctx, { items });
  });

  def(app, { method: 'GET', path: '/coach/clients/:id/lab-follow-ups', summary: 'A client’s next steps from their reports, and what a next step may link to (requires sharing consent)', tag: TAG, auth: 'coach', feature: FEATURE, query: reportQuery }, async (req) => {
    const id = clientId(req);
    requireHealthAccess(req.ctx, id);
    const q = parse(reportQuery, query(req));
    const report = q.reportId ? lab.reportMember(req.ctx, q.reportId) : null;
    if (report && report.memberId !== id) throw errors.notFound('Report');
    audit(req.ctx, 'health.viewed', { type: 'user', id }, null, { by: 'coach', what: 'lab-follow-ups', ...(q.reportId ? { reportId: q.reportId } : {}) });
    return guard(req.ctx, { items: lab.listForClient(req.ctx, id, 'coach', { reportId: q.reportId }), options: lab.linkOptions(req.ctx, id, report), canAdd: report ? report.released : null });
  });

  def(app, { method: 'POST', path: '/coach/reports/:id/follow-ups', summary: 'Add a next step to a reviewed and released report of an assigned client who shares health information', tag: TAG, auth: 'coach', feature: FEATURE, body: followUpCreateSchema, rateLimit: { max: 60, timeWindow: '10 minutes' } }, async (req, reply) => {
    const i = parse(followUpCreateSchema, req.body);
    const row = lab.createFollowUp(req.ctx, param(req, 'id'), i, { as: 'coach' });
    reply.code(201);
    return guard(req.ctx, lab.present(req.ctx, row, 'coach'));
  });

  def(app, { method: 'PATCH', path: '/coach/lab-follow-ups/:id', summary: 'Complete, cancel, reopen or relink a next step a coach set (cancel and reopen need a reason); change the words or due date only of my own (another coach’s stay theirs: OTHER_COACH_FOLLOW_UP)', tag: TAG, auth: 'coach', feature: FEATURE, body: followUpUpdateSchema }, async (req) => {
    const { reason: why, ...patch } = parse(followUpUpdateSchema, req.body);
    const row = lab.updateFollowUp(req.ctx, param(req, 'id'), patch, { as: 'coach', reason: why ?? null });
    return guard(req.ctx, lab.present(req.ctx, row, 'coach'));
  });

  /* ---------- administrator ---------- */

  def(app, { method: 'GET', path: '/admin/lab-follow-ups', summary: 'Every next step from reports, with counts; filter by status, kind, member, report or overdue', tag: TAG, auth: 'admin', permission: 'reports.view', feature: FEATURE, query: teamListQuery }, async (req) => {
    const q = parse(teamListQuery, query(req));
    const report = q.reportId ? lab.reportMember(req.ctx, q.reportId) : null;
    const memberId = q.memberId ?? report?.memberId;
    if (q.memberId) audit(req.ctx, 'member.record_viewed', { type: 'user', id: q.memberId }, null, { by: req.ctx.actor!.role, sections: ['lab-follow-ups'] });
    const out = lab.listForTeam(req.ctx, { status: q.status, kind: q.kind, memberId: q.memberId, reportId: q.reportId, overdue: truthy(q.overdue), limit: q.limit });
    return teamView(req.ctx, { ...out, ...(memberId ? { options: lab.linkOptions(req.ctx, memberId, report) } : {}), ...(report ? { canAdd: report.released && report.reviewerRole !== 'coach' } : {}) });
  });

  def(app, { method: 'POST', path: '/admin/reports/:id/follow-ups', summary: 'Add a next step to a report the Bioptime team released (reason required, audited)', tag: TAG, auth: 'admin', permission: 'integrations.manage', feature: FEATURE, body: teamFollowUpCreateSchema, rateLimit: { max: 60, timeWindow: '10 minutes' } }, async (req, reply) => {
    const { reason: why, ...i } = parse(teamFollowUpCreateSchema, req.body);
    const row = lab.createFollowUp(req.ctx, param(req, 'id'), i, { as: 'team', reason: why });
    reply.code(201);
    return teamView(req.ctx, lab.present(req.ctx, row, 'team'));
  });

  def(app, { method: 'PATCH', path: '/admin/lab-follow-ups/:id', summary: 'Complete, cancel, reopen or relink any next step; change the words or due date only of the team’s own (a coach’s stay the coach’s: COACH_FOLLOW_UP). Reason required, audited', tag: TAG, auth: 'admin', permission: 'integrations.manage', feature: FEATURE, body: teamFollowUpUpdateSchema }, async (req) => {
    const { reason: why, ...patch } = parse(teamFollowUpUpdateSchema, req.body);
    const row = lab.updateFollowUp(req.ctx, param(req, 'id'), patch, { as: 'team', reason: why });
    return teamView(req.ctx, lab.present(req.ctx, row, 'team'));
  });
}
