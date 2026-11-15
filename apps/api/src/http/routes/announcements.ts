/* M9 routes: message attachments and announcements. Registered through the module descriptor (api/modules/messaging.ts),
   so no shared route file changes; the core conversation routes stay in api/http/routes/shared.ts.

   Every route goes through def() with its role and feature 'messaging'; administrative routes add a permission
   (announcements.manage). Removing a file one has not sent yet stays reachable while the module is off (privacy).
   - Participants (the member and the coach currently assigned to them) add files to their conversation and open them
     through 5-minute tokens; administrators holding members.manage open sent files read only, audited.
   - Members read the announcements that reach them; coaches announce to their own assigned clients only;
     the team (announcements.manage) drafts, edits, publishes, schedules and withdraws.
   - Every coach payload passes the field policy's safety net (coachSafe: restricted keys are reported and stripped). */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isoDateTimeSchema } from '@bioptime/domain';
import type { Ctx } from '../../context.js';
import { parse } from '../../lib/validate.js';
import { def, param, query } from '../route.js';
import { coachSafe as policyCoachSafe } from '../../auth/fieldPolicy.js';
import * as attachments from '../../domain/attachments.js';
import * as announcements from '../../domain/announcements.js';

/* ---------- payloads ----------
   Built when the routes are registered, never when this file loads. api/domain/attachments.ts reaches this file
   through the module registry (domain/attachments -> modules/index -> modules/messaging -> here), so reading its
   constants at load time would fail whenever api/domain/attachments.ts is the first module a process imports. */
function payloads() {
  const F = attachments.MODULE_FLAG;

  const uploadBody = z.object({
    dataBase64: z.string().min(8).max(Math.ceil(attachments.ATTACHMENT_MAX_BYTES * 1.4)),
    filename: z.string().max(200).optional(),
  }).strict();
  const title = z.string().trim().min(3).max(announcements.TITLE_MAX);
  const body = z.string().trim().min(1).max(announcements.BODY_MAX);
  const audience = z.object({ packageIds: z.array(z.string().min(1).max(64)).max(20).nullable().optional(), coachId: z.string().min(1).max(64).nullable().optional() }).strict();
  const teamCreate = z.object({ title, body, audience: audience.optional() }).strict();
  const teamPatch = z.object({ title: title.optional(), body: body.optional(), audience: audience.optional() }).strict();
  const publishBody = z.object({ publishAt: isoDateTimeSchema.nullable().optional() }).strict();
  const coachCreate = z.object({ title, body, publishAt: isoDateTimeSchema.nullable().optional() }).strict();
  const reasonBody = z.object({ reason: z.string().trim().min(3).max(300) }).strict();
  const adminListQuery = z.object({ status: z.enum(announcements.ANNOUNCEMENT_STATUSES).optional(), origin: z.enum(['team', 'coach']).optional() });
  return { F, uploadBody, teamCreate, teamPatch, publishBody, coachCreate, reasonBody, adminListQuery };
}

/* Payloads for a coach pass the field policy's safety net (coachSafe in auth/fieldPolicy.ts): it looks at the payload
   as built, reports any restricted key a presenter produced (paths only, never values) and sends the payload without
   it. Members and administrators get the payload as it is. */
function coachSafe<T>(ctx: Ctx, payload: T): T {
  if (ctx.actor?.role !== 'coach') return payload;
  return policyCoachSafe(ctx, payload, 'messaging coach route');
}

export function messagingRoutes(app: FastifyInstance): void {
  const { F, uploadBody, teamCreate, teamPatch, publishBody, coachCreate, reasonBody, adminListQuery } = payloads();
  const me = (req: FastifyRequest) => req.ctx.actor!.id;

  /* ============================== attachments (participants) ============================== */

  def(app, { method: 'GET', path: '/conversations/:id/attachments', summary: 'The files of a conversation and my unsent ones, with the limits (participants; administrators with members.manage read only, audited)', tag: 'messaging', auth: 'any', feature: F }, async (req) => coachSafe(req.ctx, attachments.listForConversation(req.ctx, param(req, 'id'))));
  def(app, { method: 'POST', path: '/conversations/:id/attachments', summary: 'Add a file for my next message (PNG, JPEG, WebP or PDF, 5 MB, checked by content; stored privately; participants only)', tag: 'messaging', auth: 'any', feature: F, body: uploadBody, bodyLimit: Math.ceil(attachments.ATTACHMENT_MAX_BYTES * 1.5), rateLimit: { max: 30, timeWindow: '10 minutes' } }, async (req, reply) => {
    const i = parse(uploadBody, req.body);
    const out = attachments.upload(req.ctx, param(req, 'id'), i);
    reply.code(201);
    return coachSafe(req.ctx, out);
  });
  // reachable while the module is off: the sender can always remove a file they have not sent
  def(app, { method: 'DELETE', path: '/conversations/:id/attachments/:attachmentId', summary: 'Remove a file I added but have not sent (deleted from storage at once; works while the module is off)', tag: 'messaging', auth: 'any' }, async (req) => attachments.discard(req.ctx, param(req, 'id'), param(req, 'attachmentId')));
  def(app, { method: 'POST', path: '/attachments/:id/file-token', summary: 'A 5-minute token to open a file on a message (participants; administrators with members.manage read only; every opening audited)', tag: 'messaging', auth: 'any', feature: F, rateLimit: { max: 120, timeWindow: '1 minute' } }, async (req) => attachments.openToken(req.ctx, param(req, 'id')));

  /* ============================== announcements: member ============================== */

  def(app, { method: 'GET', path: '/me/announcements', summary: 'Announcements that reach me (from the team or my coach), newest first, with my read state', tag: 'messaging', auth: 'member', feature: F }, async (req) => announcements.listForMember(req.ctx, me(req)));
  def(app, { method: 'POST', path: '/me/announcements/:id/read', summary: 'Mark an announcement read', tag: 'messaging', auth: 'member', feature: F, rateLimit: { max: 120, timeWindow: '1 minute' } }, async (req) => announcements.markRead(req.ctx, me(req), param(req, 'id')));

  /* ============================== announcements: coach ============================== */

  def(app, { method: 'GET', path: '/coach/announcements', summary: 'My announcements to my clients, with how many clients each reaches and how many read it', tag: 'coach', auth: 'coach', feature: F }, async (req) => coachSafe(req.ctx, announcements.listForCoach(req.ctx, me(req))));
  def(app, { method: 'POST', path: '/coach/announcements', summary: 'Announce to my own assigned clients (published at once, or at publishAt)', tag: 'coach', auth: 'coach', feature: F, body: coachCreate, rateLimit: { max: 20, timeWindow: '10 minutes' } }, async (req, reply) => {
    const i = parse(coachCreate, req.body);
    const out = announcements.createForCoach(req.ctx, me(req), i);
    reply.code(201);
    return coachSafe(req.ctx, out);
  });
  def(app, { method: 'POST', path: '/coach/announcements/:id/withdraw', summary: 'Withdraw one of my announcements (reason required, audited); it disappears for my clients at once', tag: 'coach', auth: 'coach', feature: F, body: reasonBody }, async (req) => coachSafe(req.ctx, announcements.withdrawForCoach(req.ctx, me(req), param(req, 'id'), parse(reasonBody, req.body).reason)));

  /* ============================== announcements: team ============================== */

  def(app, { method: 'GET', path: '/admin/announcements', summary: 'Every announcement (team and coach) with its audience and reach', tag: 'admin', auth: 'admin', permission: 'announcements.manage', feature: F, query: adminListQuery }, async (req) => announcements.listAll(req.ctx, parse(adminListQuery, query(req))));
  def(app, { method: 'GET', path: '/admin/announcements/options', summary: 'Audience choices: packages and coaches by name, and how many members there are', tag: 'admin', auth: 'admin', permission: 'announcements.manage', feature: F }, async (req) => announcements.audienceOptions(req.ctx));
  def(app, { method: 'POST', path: '/admin/announcements', summary: 'Write an announcement to members (saved as a draft; plain text)', tag: 'admin', auth: 'admin', permission: 'announcements.manage', feature: F, body: teamCreate, rateLimit: { max: 60, timeWindow: '10 minutes' } }, async (req, reply) => {
    const i = parse(teamCreate, req.body);
    reply.code(201);
    return announcements.create(req.ctx, i);
  });
  def(app, { method: 'PATCH', path: '/admin/announcements/:id', summary: 'Change a draft or scheduled team announcement', tag: 'admin', auth: 'admin', permission: 'announcements.manage', feature: F, body: teamPatch }, async (req) => announcements.update(req.ctx, param(req, 'id'), parse(teamPatch, req.body)));
  def(app, { method: 'POST', path: '/admin/announcements/:id/publish', summary: 'Publish a team announcement now, or schedule it (publishAt); members in its audience are notified when it goes out', tag: 'admin', auth: 'admin', permission: 'announcements.manage', feature: F, body: publishBody }, async (req) => announcements.publish(req.ctx, param(req, 'id'), parse(publishBody, req.body).publishAt ?? null));
  def(app, { method: 'POST', path: '/admin/announcements/:id/withdraw', summary: 'Withdraw any announcement (reason required, audited); it disappears for members at once', tag: 'admin', auth: 'admin', permission: 'announcements.manage', feature: F, body: reasonBody }, async (req) => announcements.withdraw(req.ctx, param(req, 'id'), parse(reasonBody, req.body).reason));
}
