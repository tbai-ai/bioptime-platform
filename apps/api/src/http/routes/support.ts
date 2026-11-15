/* M4 routes: support requests, the help centre, data exports, imports and the coach onboarding checklist. Registered
   by the support module (api/modules/support.ts) inside /api; every route goes through def() with its role, its
   permission where administrative, and the module flag (support). The parts also answer to their own switches:
   support_requests, help_centre and imports (rows in feature_flags, managed on /admin/modules). */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../../lib/validate.js';
import { def, param, query } from '../route.js';
import { requireFeature } from '../../domain/features.js';
import { hasPermission } from '../../auth/permissions.js';
import { adminRestrictedKeys, stripRestricted } from '../../auth/fieldPolicy.js';
import * as requests from '../../domain/support_requests.js';
import * as help from '../../domain/help.js';
import * as imports from '../../domain/imports.js';
import * as exportsDomain from '../../domain/dataExport.js';
import type { Ctx } from '../../context.js';

/** The sub-switches of the support module; each also needs the module flag (def checks that one). */
export const SUPPORT_SUBFLAGS = ['support_requests', 'help_centre', 'imports'] as const;

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const createBody = z.object({ category: z.enum(requests.SUPPORT_CATEGORIES), subject: text(3, 160), body: text(5, 5000) });
const replyBody = z.object({ body: text(1, 5000) });
const queueQuery = z.object({ status: z.enum([...requests.SUPPORT_STATUSES, 'active']).optional(), category: z.enum(requests.SUPPORT_CATEGORIES).optional(), assigned: z.enum(['me', 'none']).optional(), requesterId: z.string().max(64).optional(), q: z.string().trim().max(120).optional() });
const teamPatch = z.object({ status: z.enum(requests.SUPPORT_STATUSES).optional(), assignedTo: z.string().max(64).nullable().optional(), reason: z.string().trim().max(300).optional() });
const teamReply = z.object({ body: text(1, 5000), internal: z.boolean().default(false), status: z.enum(requests.SUPPORT_STATUSES).optional() });
const audienceQuery = z.object({ audience: z.enum(help.HELP_AUDIENCES).optional() });
const slugSchema = z.string().trim().min(2).max(80).regex(help.SLUG_RE, 'lower-case letters, digits and single hyphens');
const articleBody = z.object({ slug: slugSchema.optional(), title: text(3, 160), body: z.string().max(20000), audience: z.enum(help.HELP_AUDIENCES), category: z.string().trim().max(60).optional(), sort: z.number().int().min(0).max(10000).optional() });
const articlePatch = articleBody.partial().extend({ reason: z.string().trim().max(300).optional() });
const reasonBody = z.object({ reason: text(3, 300) });
const importBody = z.object({ kind: z.enum(imports.IMPORT_KINDS), fileName: text(1, 200), csv: z.string().min(1).max(imports.MAX_IMPORT_BYTES * 2), dryRun: z.boolean().optional() });

/** What an administrator without members.view_restricted never receives (phone numbers and other contact fields). */
const RESTRICTED = adminRestrictedKeys();
const contactView = <T>(ctx: Ctx, payload: T): T => (hasPermission(ctx, 'members.view_restricted') ? payload : stripRestricted(payload, RESTRICTED));

export function supportRoutes(app: FastifyInstance): void {
  const sub = (req: { ctx: Ctx }, flag: (typeof SUPPORT_SUBFLAGS)[number]) => requireFeature(req.ctx, flag);
  const me = (req: { ctx: Ctx }) => req.ctx.actor!.id;

  /* ---------- support requests: anyone signed in, about their own requests ---------- */
  def(app, { method: 'GET', path: '/support-requests', summary: 'My support requests (newest activity first)', tag: 'support', auth: 'any', feature: 'support' }, async (req) => { sub(req, 'support_requests'); return { items: requests.listMine(req.ctx), categories: requests.CATEGORY_LABELS }; });
  def(app, { method: 'POST', path: '/support-requests', summary: 'Ask the Bioptime team for help: a category, a subject and the first message', tag: 'support', auth: 'any', feature: 'support', body: createBody, rateLimit: { max: 10, timeWindow: '10 minutes' } }, async (req, reply) => { sub(req, 'support_requests'); const i = parse(createBody, req.body); reply.code(201); return requests.createRequest(req.ctx, i); });
  def(app, { method: 'GET', path: '/support-requests/:id', summary: 'One of my requests with its thread (the team’s internal notes are never included)', tag: 'support', auth: 'any', feature: 'support' }, async (req) => { sub(req, 'support_requests'); return requests.getMine(req.ctx, param(req, 'id')); });
  def(app, { method: 'POST', path: '/support-requests/:id/messages', summary: 'Reply on one of my requests (reopens it unless it is closed)', tag: 'support', auth: 'any', feature: 'support', body: replyBody, rateLimit: { max: 30, timeWindow: '10 minutes' } }, async (req, reply) => { sub(req, 'support_requests'); const i = parse(replyBody, req.body); reply.code(201); return requests.replyAsRequester(req.ctx, param(req, 'id'), i.body); });

  /* ---------- help centre: published articles for the caller's audience ---------- */
  def(app, { method: 'GET', path: '/help/articles', summary: 'Published help articles for my audience (members: member and all; coaches: coach and all)', tag: 'support', auth: 'any', feature: 'support', query: audienceQuery }, async (req) => { sub(req, 'help_centre'); const q = parse(audienceQuery, query(req)); return { items: help.listPublished(req.ctx, q.audience) }; });
  def(app, { method: 'GET', path: '/help/articles/:slug', summary: 'One published help article (sanitised rich text and a plain-text copy)', tag: 'support', auth: 'any', feature: 'support' }, async (req) => { sub(req, 'help_centre'); return help.getPublished(req.ctx, param(req, 'slug')); });

  /* ---------- data export: the member ---------- */
  def(app, { method: 'GET', path: '/me/data-exports', summary: 'My data export requests and whether each file is ready', tag: 'support', auth: 'member', feature: 'support' }, async (req) => ({ items: exportsDomain.listMine(req.ctx) }));
  // reachable while the module is off: a member keeps access to an export already made for them
  def(app, { method: 'POST', path: '/me/data-requests/:id/file-token', summary: 'A 5-minute token to download my data export (only the member can open it; audited)', tag: 'support', auth: 'member', rateLimit: { max: 30, timeWindow: '10 minutes' } }, async (req) => exportsDomain.tokenForMine(req.ctx, param(req, 'id')));

  /* ---------- coach onboarding (computed) ---------- */
  def(app, { method: 'GET', path: '/coach/onboarding', summary: 'My onboarding checklist: profile, working hours, policies (training once the Learning module provides it)', tag: 'support', auth: 'coach', feature: 'support' }, async (req) => help.coachOnboarding(req.ctx, me(req)));

  /* ---------- administrators: the support queue (operations.manage) ---------- */
  def(app, { method: 'GET', path: '/admin/support-requests', summary: 'The support queue (status, category, owner, requester, search)', tag: 'support', auth: 'admin', permission: 'operations.manage', feature: 'support', query: queueQuery }, async (req) => { sub(req, 'support_requests'); return contactView(req.ctx, requests.listQueue(req.ctx, parse(queueQuery, query(req)))); });
  def(app, { method: 'GET', path: '/admin/support-requests/:id', summary: 'One request with the whole thread, internal notes included', tag: 'support', auth: 'admin', permission: 'operations.manage', feature: 'support' }, async (req) => { sub(req, 'support_requests'); return contactView(req.ctx, requests.getForTeam(req.ctx, param(req, 'id'))); });
  def(app, { method: 'PATCH', path: '/admin/support-requests/:id', summary: 'Assign or change the status of a request (audited with the reason)', tag: 'support', auth: 'admin', permission: 'operations.manage', feature: 'support', body: teamPatch }, async (req) => { sub(req, 'support_requests'); const i = parse(teamPatch, req.body); return contactView(req.ctx, requests.updateRequest(req.ctx, param(req, 'id'), { status: i.status, assignedTo: i.assignedTo }, i.reason)); });
  def(app, { method: 'POST', path: '/admin/support-requests/:id/messages', summary: 'Reply to the requester (notified) or add an internal note (never shown to the requester)', tag: 'support', auth: 'admin', permission: 'operations.manage', feature: 'support', body: teamReply, rateLimit: { max: 60, timeWindow: '10 minutes' } }, async (req, reply) => { sub(req, 'support_requests'); const i = parse(teamReply, req.body); reply.code(201); return contactView(req.ctx, requests.replyAsTeam(req.ctx, param(req, 'id'), i)); });

  /* ---------- administrators: help articles (content.manage) ---------- */
  def(app, { method: 'GET', path: '/admin/help-articles', summary: 'Every help article, drafts included', tag: 'support', auth: 'admin', permission: 'content.manage', feature: 'support' }, async (req) => { sub(req, 'help_centre'); return { items: help.adminList(req.ctx) }; });
  def(app, { method: 'POST', path: '/admin/help-articles', summary: 'Write a help article (saved as a draft; the body is sanitised to the CMS allowlist)', tag: 'support', auth: 'admin', permission: 'content.manage', feature: 'support', body: articleBody }, async (req, reply) => { sub(req, 'help_centre'); const i = parse(articleBody, req.body); reply.code(201); return help.createArticle(req.ctx, i); });
  def(app, { method: 'GET', path: '/admin/help-articles/:id', summary: 'One help article for editing', tag: 'support', auth: 'admin', permission: 'content.manage', feature: 'support' }, async (req) => { sub(req, 'help_centre'); return help.adminGet(req.ctx, param(req, 'id')); });
  def(app, { method: 'PATCH', path: '/admin/help-articles/:id', summary: 'Edit a help article (a published one needs a reason)', tag: 'support', auth: 'admin', permission: 'content.manage', feature: 'support', body: articlePatch }, async (req) => { sub(req, 'help_centre'); const { reason, ...patch } = parse(articlePatch, req.body); return help.updateArticle(req.ctx, param(req, 'id'), patch, reason); });
  def(app, { method: 'POST', path: '/admin/help-articles/:id/publish', summary: 'Publish a help article (reason required, audited)', tag: 'support', auth: 'admin', permission: 'content.manage', feature: 'support', body: reasonBody }, async (req) => { sub(req, 'help_centre'); return help.setPublished(req.ctx, param(req, 'id'), true, parse(reasonBody, req.body).reason); });
  def(app, { method: 'POST', path: '/admin/help-articles/:id/unpublish', summary: 'Withdraw a help article back to draft (reason required, audited)', tag: 'support', auth: 'admin', permission: 'content.manage', feature: 'support', body: reasonBody }, async (req) => { sub(req, 'help_centre'); return help.setPublished(req.ctx, param(req, 'id'), false, parse(reasonBody, req.body).reason); });

  /* ---------- administrators: imports (imports.manage; a members file also needs members.view_restricted) ---------- */
  def(app, { method: 'GET', path: '/admin/imports', summary: 'Imports, newest first', tag: 'support', auth: 'admin', permission: 'imports.manage', feature: 'support' }, async (req) => { sub(req, 'imports'); return { items: imports.listJobs(req.ctx), columns: imports.IMPORT_COLUMNS, maxRows: imports.MAX_IMPORT_ROWS }; });
  def(app, { method: 'POST', path: '/admin/imports', summary: 'Upload a CSV and validate it in a dry run (dryRun: true stores nothing; otherwise the job is kept for review and nothing else is written)', tag: 'support', auth: 'admin', permission: 'imports.manage', feature: 'support', body: importBody, bodyLimit: imports.MAX_IMPORT_BYTES * 3, rateLimit: { max: 30, timeWindow: '10 minutes' } }, async (req, reply) => { sub(req, 'imports'); const i = parse(importBody, req.body); const out = imports.upload(req.ctx, i); reply.code(i.dryRun ? 200 : 201); return contactView(req.ctx, out); });
  def(app, { method: 'GET', path: '/admin/imports/:id', summary: 'One import with its rows and the error report', tag: 'support', auth: 'admin', permission: 'imports.manage', feature: 'support' }, async (req) => { sub(req, 'imports'); return contactView(req.ctx, imports.getJob(req.ctx, param(req, 'id'))); });
  def(app, { method: 'POST', path: '/admin/imports/:id/apply', summary: 'Create the records for the valid rows, once (members are invited accounts; no message is sent)', tag: 'support', auth: 'admin', permission: 'imports.manage', feature: 'support', body: reasonBody }, async (req) => { sub(req, 'imports'); return contactView(req.ctx, imports.apply(req.ctx, param(req, 'id'), parse(reasonBody, req.body).reason)); });
  def(app, { method: 'POST', path: '/admin/imports/:id/send-invitations', summary: 'Send the activation links for a members import (nothing is sent before this; rows already invited are skipped)', tag: 'support', auth: 'admin', permission: 'imports.manage', feature: 'support', body: reasonBody, rateLimit: { max: 10, timeWindow: '10 minutes' } }, async (req) => { sub(req, 'imports'); return contactView(req.ctx, imports.sendInvitations(req.ctx, param(req, 'id'), parse(reasonBody, req.body).reason)); });
  def(app, { method: 'POST', path: '/admin/imports/:id/cancel', summary: 'Withdraw an import that was not applied (reason required)', tag: 'support', auth: 'admin', permission: 'imports.manage', feature: 'support', body: reasonBody }, async (req) => { sub(req, 'imports'); return contactView(req.ctx, imports.cancel(req.ctx, param(req, 'id'), parse(reasonBody, req.body).reason)); });

  /* ---------- administrators: data exports (members.manage; the file itself is for the member only) ---------- */
  def(app, { method: 'GET', path: '/admin/data-exports', summary: 'Export requests and whether each file exists (never the file)', tag: 'support', auth: 'admin', permission: 'members.manage', feature: 'support' }, async (req) => ({ items: exportsDomain.adminList(req.ctx) }));
  def(app, { method: 'POST', path: '/admin/data-exports/:id/generate', summary: 'Generate an export now (a requested one moves to in progress; reason required)', tag: 'support', auth: 'admin', permission: 'members.manage', feature: 'support', body: reasonBody, rateLimit: { max: 20, timeWindow: '10 minutes' } }, async (req) => exportsDomain.adminGenerate(req.ctx, param(req, 'id'), parse(reasonBody, req.body).reason));
}
