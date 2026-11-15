import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { messageCreateSchema } from '@bioptime/domain';
import { parse, pageParams } from '../../lib/validate.js';
import { errors } from '../../lib/errors.js';
import { def, param, query } from '../route.js';
import * as notifications from '../../domain/notifications.js';
import * as messaging from '../../domain/messaging.js';
import * as bloodwork from '../../domain/bloodwork.js';
import { reportDocument } from '../report-document.js';
import type { Ctx } from '../../context.js';
import { coachSafe as policyCoachSafe } from '../../auth/fieldPolicy.js';
import { requirePermission } from '../../auth/permissions.js';

/* Payloads for a coach pass the field policy's safety net (coachSafe in auth/fieldPolicy.ts): it looks at the payload
   as built, reports any restricted key a presenter produced (paths only, never values) and sends the payload without
   it. Members and administrators get the payload as it is. */
function coachSafe<T>(ctx: Ctx, payload: T, where = 'shared conversation route'): T {
  if (ctx.actor?.role !== 'coach') return payload;
  return policyCoachSafe(ctx, payload, where);
}

/* Reading members' threads. Members and coaches stay participant-only (messaging.assertParticipant: a coach must be the
   member's assigned coach). An administrator reads a thread, its preview in the list and its file names only with
   members.manage, the permission every other member record needs (the M9 attachment routes ask the same); without it
   the answer is PERMISSION_DENIED and nothing of the thread is sent. Owners hold every permission. */
function requireThreadReader(ctx: Ctx): void {
  const role = ctx.actor?.role;
  if (role === 'admin' || role === 'owner') requirePermission(ctx, 'members.manage');
}

export function sharedRoutes(app: FastifyInstance): void {
  def(app, { method: 'GET', path: '/notifications', summary: 'My notifications (unread=1)', tag: 'shared', auth: 'any', query: z.object({ unread: z.string().optional(), limit: z.string().optional() }) }, async (req) => ({ items: notifications.listNotifications(req.ctx, req.ctx.actor!.id, pageParams(query(req), 50).limit, query(req).unread === '1'), unread: notifications.unreadCount(req.ctx, req.ctx.actor!.id) }));
  def(app, { method: 'POST', path: '/notifications/read', summary: 'Mark notifications read (ids or all)', tag: 'shared', auth: 'any', body: z.object({ ids: z.array(z.string()).optional(), all: z.boolean().optional() }) }, async (req) => { const i = parse(z.object({ ids: z.array(z.string()).optional(), all: z.boolean().optional() }), req.body); return { updated: notifications.markRead(req.ctx, req.ctx.actor!.id, i.all ? 'all' : (i.ids ?? [])) }; });
  def(app, { method: 'GET', path: '/notification-preferences', summary: 'My notification preferences', tag: 'shared', auth: 'any' }, async (req) => notifications.getPreferences(req.ctx, req.ctx.actor!.id));
  def(app, { method: 'PATCH', path: '/notification-preferences', summary: 'Update preferences (transactional security messages cannot be turned off)', tag: 'shared', auth: 'any', body: z.object({ email: z.boolean().optional(), sms: z.boolean().optional(), push: z.boolean().optional(), reminders: z.boolean().optional(), marketing: z.boolean().optional(), lock_screen_detail: z.boolean().optional() }) }, async (req) => notifications.setPreferences(req.ctx, req.ctx.actor!.id, parse(z.object({ email: z.boolean().optional(), sms: z.boolean().optional(), push: z.boolean().optional(), reminders: z.boolean().optional(), marketing: z.boolean().optional(), lock_screen_detail: z.boolean().optional() }), req.body)));

  // conversations (core, outside any flag); files on messages are M9 (flag 'messaging'): uploads and file tokens are the
  // module's routes (api/http/routes/announcements.ts), and sending a message with attachmentIds needs the flag
  def(app, { method: 'GET', path: '/conversations', summary: 'My conversations with unread counts (administrators: every thread, with members.manage)', tag: 'shared', auth: 'any' }, async (req) => { requireThreadReader(req.ctx); return coachSafe(req.ctx, { items: messaging.conversationsFor(req.ctx, req.ctx.actor!.id) }); });
  def(app, { method: 'GET', path: '/conversations/:id/messages', summary: 'Messages in a conversation (before cursor), each with its files (names, types and sizes; files open through 5-minute tokens). Participants only; administrators read with members.manage', tag: 'shared', auth: 'any', query: z.object({ before: z.string().optional(), limit: z.string().optional() }) }, async (req) => { requireThreadReader(req.ctx); return coachSafe(req.ctx, messaging.listMessages(req.ctx, param(req, 'id'), { before: query(req).before as string | undefined, limit: pageParams(query(req), 50).limit })); });
  def(app, { method: 'POST', path: '/conversations/:id/messages', summary: 'Send a message: text, files uploaded to this conversation first (attachmentIds; needs the messaging flag), or both', tag: 'shared', auth: 'any', body: messageCreateSchema, rateLimit: { max: 60, timeWindow: '1 minute' } }, async (req, reply) => {
    const i = parse(messageCreateSchema, req.body);
    const out = messaging.send(req.ctx, param(req, 'id'), i.body, i.attachmentIds ?? []);
    reply.code(201);
    return coachSafe(req.ctx, out);
  });
  def(app, { method: 'POST', path: '/conversations/:id/read', summary: 'Mark a conversation read', tag: 'shared', auth: 'any' }, async (req) => ({ updated: messaging.markRead(req.ctx, param(req, 'id')) }));

  def(app, { method: 'GET', path: '/reports/:id', summary: 'A report (member once released; assigned coach with consent; admins)', tag: 'shared', auth: 'any' }, async (req) => { bloodwork.assertReportAccess(req.ctx, param(req, 'id')); return coachSafe(req.ctx, bloodwork.getReport(req.ctx, param(req, 'id')), 'shared report route'); });
  def(app, { method: 'POST', path: '/reports/:id/file-token', summary: 'A 5-minute token to open the report document', tag: 'shared', auth: 'any' }, async (req) => bloodwork.reportFileToken(req.ctx, param(req, 'id')));
  def(app, { method: 'GET', path: '/reports/file', summary: 'The report document for a file token (no public URL ever points at a report)', tag: 'shared', auth: 'none', query: z.object({ token: z.string() }) }, async (req, reply) => {
    const token = String(query(req).token ?? '');
    const reportId = bloodwork.verifyReportFileToken(req.ctx, token);
    if (!reportId) throw errors.forbidden('This link has expired. Open the report again to get a new one.', 'LINK_EXPIRED');
    const report = bloodwork.getReport(req.ctx, reportId);
    reply.header('cache-control', 'no-store').header('content-disposition', `inline; filename="bioptime-report-${report.reference}.html"`).type('text/html; charset=utf-8');
    return reportDocument(req.ctx, report);
  });
}
