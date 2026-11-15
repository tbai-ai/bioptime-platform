/* Administration of the website content, the theme, administrator accounts and permissions, reports, coupons and
   notification templates. Every route carries a granular permission on top of the administrator role. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../../lib/validate.js';
import { errors } from '../../lib/errors.js';
import { def, param, query } from '../route.js';
import { audit, listAudit } from '../../domain/audit.js';
import * as content from '../../domain/content.js';
import * as theme from '../../domain/theme.js';
import * as coupons from '../../domain/coupons.js';
import * as reports from '../../domain/reports.js';
import { getSetting, setSetting } from '../../domain/settings.js';
import { ALL_PERMISSIONS, MODULE_PERMISSIONS, PERMISSION_LABELS, permissionsFor, setUserPermission } from '../../auth/permissions.js';
import { publicUser, resetMfaByOwner } from '../../auth/service.js';
import type { UserRow } from '../../auth/service.js';

const reasonBody = z.object({ reason: z.string().min(3).max(300) });
/** Short column headings for the module permissions on Users and permissions (the full wording is PERMISSION_LABELS). */
type ModulePermission = (typeof MODULE_PERMISSIONS)[number];
const MODULE_PERMISSION_HEADINGS: Record<ModulePermission, string> = {
  'library.manage': 'Libraries', 'learning.manage': 'Courses', 'sessions.manage': 'Live sessions', 'announcements.manage': 'Announcements',
  'imports.manage': 'Bulk imports', 'ai.manage': 'Coach AI usage', 'modules.manage': 'Module switches',
};
/** A validity bound: an ISO date-time, or a plain date meaning the start of that day (UTC); stored normalised. */
const isoMoment = z.string().refine((v) => /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v)), { message: 'Use an ISO date or date-time' }).transform((v) => new Date(v).toISOString());

export function cmsRoutes(app: FastifyInstance): void {
  /* ---------- website content ---------- */
  def(app, { method: 'GET', path: '/admin/content', summary: 'Every editable website block with its default, published and draft values', tag: 'cms', auth: 'admin', permission: 'content.manage' }, async (req) => ({ items: content.listContent(req.ctx), previewUrl: '/?cms=draft' }));
  const draftBody = z.object({ value: z.unknown(), reason: z.string().max(300).optional() });
  def(app, { method: 'PUT', path: '/admin/content/:key', summary: 'Save a draft value for a block (validated and sanitised)', tag: 'cms', auth: 'admin', permission: 'content.manage', body: draftBody }, async (req) => { const i = parse(draftBody, req.body); return content.saveDraft(req.ctx, param(req, 'key'), i.value, i.reason); });
  def(app, { method: 'DELETE', path: '/admin/content/:key/draft', summary: 'Discard a draft', tag: 'cms', auth: 'admin', permission: 'content.manage' }, async (req) => { content.discardDraft(req.ctx, param(req, 'key')); return { ok: true }; });
  const publishBody = z.object({ keys: z.array(z.string()).optional(), reason: z.string().min(3).max(300) });
  def(app, { method: 'POST', path: '/admin/content/publish', summary: 'Publish drafts (all, or the given keys); the website shows them at once', tag: 'cms', auth: 'admin', permission: 'content.publish', body: publishBody }, async (req) => { const i = parse(publishBody, req.body); return { published: content.publish(req.ctx, i.keys?.length ? i.keys : 'all', i.reason) }; });
  def(app, { method: 'POST', path: '/admin/content/:key/reset', summary: 'Return a block to its built-in default', tag: 'cms', auth: 'admin', permission: 'content.manage', body: reasonBody }, async (req) => { content.resetToDefault(req.ctx, param(req, 'key'), parse(reasonBody, req.body).reason); return { ok: true }; });

  /* ---------- theme ---------- */
  def(app, { method: 'GET', path: '/admin/theme', summary: 'The theme tokens: defaults, published, draft, approved fonts and contrast warnings', tag: 'cms', auth: 'admin', permission: 'theme.manage' }, async (req) => theme.getTheme(req.ctx));
  const themeBody = z.object({ tokens: z.unknown(), reason: z.string().max(300).optional() });
  def(app, { method: 'PUT', path: '/admin/theme', summary: 'Save a theme draft', tag: 'cms', auth: 'admin', permission: 'theme.manage', body: themeBody }, async (req) => { const i = parse(themeBody, req.body); return theme.saveThemeDraft(req.ctx, i.tokens, i.reason); });
  def(app, { method: 'POST', path: '/admin/theme/publish', summary: 'Publish the theme draft (refused below WCAG AA contrast)', tag: 'cms', auth: 'admin', permission: 'theme.manage', body: reasonBody }, async (req) => theme.publishTheme(req.ctx, parse(reasonBody, req.body).reason));
  def(app, { method: 'POST', path: '/admin/theme/reset', summary: 'Back to the brand defaults', tag: 'cms', auth: 'admin', permission: 'theme.manage', body: reasonBody }, async (req) => theme.resetTheme(req.ctx, parse(reasonBody, req.body).reason));
  def(app, { method: 'POST', path: '/admin/theme/rollback', summary: 'Republish the theme that was live before the last publish', tag: 'cms', auth: 'admin', permission: 'theme.manage', body: reasonBody }, async (req) => theme.rollbackTheme(req.ctx, parse(reasonBody, req.body).reason));
  def(app, { method: 'GET', path: '/admin/theme/preview.css', summary: 'The draft theme as CSS, for the live preview', tag: 'cms', auth: 'admin', permission: 'theme.manage' }, async (req, reply) => { reply.type('text/css; charset=utf-8'); return theme.draftThemeCss(req.ctx); });

  /* ---------- administrators, roles and permissions ---------- */
  // every permission, the module ones included (module: true, with a short column heading), so an owner can grant and
  // revoke each one here
  def(app, { method: 'GET', path: '/admin/users', summary: 'Administrators and owners with their effective permissions (every permission, module permissions marked)', tag: 'cms', auth: 'admin', permission: 'permissions.manage' }, async (req) => {
    const rows = req.ctx.db.all<UserRow>("SELECT * FROM users WHERE role IN ('admin','owner') ORDER BY role DESC, name");
    return { permissions: ALL_PERMISSIONS.map((p) => ({ key: p, label: PERMISSION_LABELS[p], ...(p in MODULE_PERMISSION_HEADINGS ? { module: true, heading: MODULE_PERMISSION_HEADINGS[p as ModulePermission] } : { module: false }) })), items: rows.map((u) => ({ ...publicUser(u), permissions: permissionsFor(req.ctx, u), overrides: req.ctx.db.all('SELECT permission, granted, reason, updated_at FROM user_permissions WHERE user_id = ?', [u.id]) })) };
  });
  const permBody = z.object({ permission: z.enum(ALL_PERMISSIONS), granted: z.boolean(), reason: z.string().min(3).max(300) });
  def(app, { method: 'POST', path: '/admin/users/:id/permissions', summary: 'Grant or revoke one permission for an administrator', tag: 'cms', auth: 'admin', permission: 'permissions.manage', body: permBody }, async (req) => {
    const i = parse(permBody, req.body);
    const permissions = setUserPermission(req.ctx, param(req, 'id'), i.permission, i.granted, i.reason);
    audit(req.ctx, 'permission.change', { type: 'user', id: param(req, 'id') }, i.reason, { permission: i.permission, granted: i.granted });
    return { permissions };
  });
  const roleBody = z.object({ role: z.enum(['admin', 'owner']), reason: z.string().min(3).max(300) });
  def(app, { method: 'POST', path: '/admin/users/:id/role', summary: 'Owner only: make an administrator an owner, or an owner an administrator (never the last owner, never yourself)', tag: 'cms', auth: 'owner', permission: 'admins.manage', body: roleBody }, async (req) => {
    const i = parse(roleBody, req.body);
    const id = param(req, 'id');
    const target = req.ctx.db.get<UserRow>('SELECT * FROM users WHERE id = ?', [id]);
    if (!target || (target.role !== 'admin' && target.role !== 'owner')) throw errors.notFound('Administrator');
    if (target.id === req.ctx.actor!.id) throw errors.state('Change your own role from another owner account', { code: 'SELF_ROLE' });
    if (target.role === 'owner' && i.role === 'admin') {
      const owners = req.ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM users WHERE role = 'owner' AND state = 'active'")!.n;
      if (owners <= 1) throw errors.state('The platform needs at least one owner', { code: 'LAST_OWNER' });
    }
    req.ctx.db.update('users', id, { role: i.role, updated_at: req.ctx.now() });
    audit(req.ctx, 'user.role_change', { type: 'user', id }, i.reason, { from: target.role, to: i.role });
    return publicUser(req.ctx.db.get<UserRow>('SELECT * FROM users WHERE id = ?', [id])!);
  });

  // two-factor authentication is mandatory for administrators and owners and is never switched off by its holder; when
  // an authenticator is lost, another owner resets it here (with a reason): the account is signed out everywhere and
  // enrols again at its next sign-in (MFA_ENROLMENT_REQUIRED)
  def(app, { method: 'POST', path: '/admin/users/:id/mfa/reset', summary: 'Owner only: reset another administrator’s or owner’s two-factor authentication (reason required); they are signed out and enrol again at their next sign-in', tag: 'cms', auth: 'owner', permission: 'permissions.manage', body: reasonBody, rateLimit: { max: 30, timeWindow: '10 minutes' } }, async (req) => {
    const i = parse(reasonBody, req.body);
    return publicUser(resetMfaByOwner(req.ctx, param(req, 'id'), i.reason));
  });

  /* ---------- reports ---------- */
  def(app, { method: 'GET', path: '/admin/analytics', summary: 'The analytics reports available', tag: 'cms', auth: 'admin', permission: 'reports.view' }, async () => ({ items: reports.REPORT_NAMES }));
  def(app, { method: 'GET', path: '/admin/analytics/:name', summary: 'Run an analytics report (from, to as YYYY-MM-DD; format=csv for a download)', tag: 'cms', auth: 'admin', permission: 'reports.view', query: z.object({ from: z.string().optional(), to: z.string().optional(), format: z.enum(['json', 'csv']).optional() }) }, async (req, reply) => {
    const q = query(req) as { from?: string; to?: string; format?: string };
    const name = param(req, 'name').replace(/\.csv$/, '');
    const r = reports.runReport(req.ctx, name, q.from, q.to);
    audit(req.ctx, 'report.run', { type: 'report', id: name }, null, { from: r.from, to: r.to, rows: r.rows.length, format: q.format ?? 'json' });
    if (q.format === 'csv' || param(req, 'name').endsWith('.csv')) { reply.type('text/csv; charset=utf-8'); reply.header('content-disposition', `attachment; filename="bioptime-${name}-${r.from}-${r.to}.csv"`); return reports.toCsv(r); }
    return r;
  });

  /* ---------- coupons ---------- */
  def(app, { method: 'GET', path: '/admin/coupons', summary: 'Promotional codes', tag: 'cms', auth: 'admin', permission: 'packages.manage' }, async (req) => ({ items: coupons.listCoupons(req.ctx) }));
  const couponBody = z.object({ code: z.string().min(3).max(24), kind: z.enum(['percent', 'amount']), value: z.number().positive(), maxUses: z.number().int().positive().nullable().optional(), validFrom: isoMoment.nullable().optional(), validTo: isoMoment.nullable().optional(), note: z.string().max(200).optional(), reason: z.string().max(300).optional() });
  def(app, { method: 'POST', path: '/admin/coupons', summary: 'Create a promotional code', tag: 'cms', auth: 'admin', permission: 'packages.manage', body: couponBody }, async (req, reply) => { const { reason, ...i } = parse(couponBody, req.body); reply.code(201); return coupons.createCoupon(req.ctx, i, reason); });
  const couponPatch = z.object({ active: z.boolean().optional(), maxUses: z.number().int().positive().nullable().optional(), validTo: isoMoment.nullable().optional(), note: z.string().max(200).optional(), reason: z.string().min(3).max(300) });
  def(app, { method: 'PATCH', path: '/admin/coupons/:id', summary: 'Deactivate, extend or cap a code', tag: 'cms', auth: 'admin', permission: 'packages.manage', body: couponPatch }, async (req) => { const { reason, ...i } = parse(couponPatch, req.body); return coupons.updateCoupon(req.ctx, param(req, 'id'), i, reason); });

  /* ---------- notification templates ---------- */
  const CATEGORIES = ['welcome', 'verification', 'coach_assignment', 'appointment', 'appointment_reminder', 'bloodwork', 'report', 'programme', 'custom_plan', 'payment', 'package_expiry', 'message', 'security'] as const;
  def(app, { method: 'GET', path: '/admin/notification-templates', summary: 'Email wording per notification category (placeholders {{title}}, {{body}}, {{name}})', tag: 'cms', auth: 'admin', permission: 'settings.manage' }, async (req) => ({ categories: CATEGORIES, templates: getSetting(req.ctx, 'notification_templates') ?? {} }));
  const tplBody = z.object({ category: z.enum(CATEGORIES), subject: z.string().max(120).optional(), body: z.string().max(2000).optional(), reason: z.string().min(3).max(300) });
  def(app, { method: 'PUT', path: '/admin/notification-templates', summary: 'Set (or clear, with empty strings) the email wording for a category', tag: 'cms', auth: 'admin', permission: 'settings.manage', body: tplBody }, async (req) => {
    const i = parse(tplBody, req.body);
    const forbidden = /<script|javascript:/i;
    if ((i.subject && forbidden.test(i.subject)) || (i.body && forbidden.test(i.body))) throw errors.badRequest('Templates are plain text', 'TEMPLATE_TEXT');
    const all = { ...(getSetting<Record<string, { subject?: string; body?: string }>>(req.ctx, 'notification_templates') ?? {}) };
    if (!i.subject && !i.body) delete all[i.category]; else all[i.category] = { ...(i.subject ? { subject: i.subject } : {}), ...(i.body ? { body: i.body } : {}) };
    setSetting(req.ctx, 'notification_templates', all, i.reason);
    return { templates: all };
  });

  /* ---------- audit log with filters ---------- */
  def(app, { method: 'GET', path: '/admin/audit/search', summary: 'The audit log filtered by action prefix, actor, target and time', tag: 'cms', auth: 'admin', permission: 'audit.view', query: z.object({ action: z.string().optional(), actorId: z.string().optional(), targetType: z.string().optional(), targetId: z.string().optional(), since: z.string().optional(), until: z.string().optional(), limit: z.string().optional() }) }, async (req) => {
    const q = query(req) as Record<string, string | undefined>;
    return { items: listAudit(req.ctx, { action: q.action, actorId: q.actorId, targetType: q.targetType, targetId: q.targetId, since: q.since, until: q.until, limit: Math.min(500, Math.max(1, Math.floor(Number(q.limit ?? 200)) || 200)) }), appendOnly: true };
  });
}
