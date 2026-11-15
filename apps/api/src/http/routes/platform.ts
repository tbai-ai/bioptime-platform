/* The foundation's routes: the module switches and settings (/admin/modules), the integrations registry, private-file
   tokens and downloads, push devices and quiet hours. */
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ROLES } from '@bioptime/domain';
import { parse } from '../../lib/validate.js';
import { def, param, query } from '../route.js';
import * as features from '../../domain/features.js';
import * as files from '../../domain/files.js';
import * as reminders from '../../domain/reminders.js';
import { integrations } from '../../adapters/registry.js';
import { MODULES, featureOf } from '../../modules/index.js';

const audienceSchema = z.object({ roles: z.array(z.enum(ROLES)).max(4).optional(), packageIds: z.array(z.string().min(1).max(64)).max(50).optional() });
const flagPatch = z.object({ key: z.string().min(1).max(64), enabled: z.boolean().optional(), audience: audienceSchema.optional(), reason: z.string().trim().min(3).max(300) });
const settingPatch = z.object({ key: z.enum(features.MODULE_SETTINGS.map((s) => s.key) as [string, ...string[]]), value: z.unknown(), reason: z.string().trim().min(3).max(300) });
const deviceBody = z.object({ platform: z.enum(['ios', 'android']), token: z.string().trim().min(8).max(512).regex(/^\S+$/, 'A device token has no spaces'), appVersion: z.string().trim().max(40).optional() });
const quietBody = z.object({ startMinute: z.number().int().min(0).max(1439).nullable(), endMinute: z.number().int().min(0).max(1439).nullable() });

export function platformRoutes(app: FastifyInstance): void {
  // module switches: modules.manage (an owner grants it; administrators do not hold it by default)
  def(app, { method: 'GET', path: '/admin/modules', summary: 'Feature flags and the registered modules (what each contributes)', tag: 'admin', auth: 'admin', permission: 'modules.manage' }, async (req) => ({
    flags: features.listFlags(req.ctx),
    modules: MODULES.map((m) => ({ key: m.key, feature: featureOf(m), jobs: (m.jobs ?? []).map((j) => j.name), events: Object.keys(m.events ?? {}), fileKinds: Object.keys(m.fileAccess ?? {}), adherence: !!m.adherence, demoSeed: !!m.seedDemo, ungated: m.ungated ?? [] })),
    demo: app.config.isDemo,
  }));
  def(app, { method: 'PATCH', path: '/admin/modules', summary: 'Switch a feature flag or change its audience (reason required, audited)', tag: 'admin', auth: 'admin', permission: 'modules.manage', body: flagPatch }, async (req) => {
    const i = parse(flagPatch, req.body);
    return features.setFlag(req.ctx, i.key, { enabled: i.enabled, audience: i.audience }, i.reason);
  });
  // module settings: settings.manage, like every other runtime setting
  def(app, { method: 'GET', path: '/admin/module-settings', summary: 'The settings the modules read (null: not decided yet)', tag: 'admin', auth: 'admin', permission: 'settings.manage' }, async (req) => ({ items: features.moduleSettings(req.ctx) }));
  def(app, { method: 'PATCH', path: '/admin/module-settings', summary: 'Change a module setting (reason required, audited)', tag: 'admin', auth: 'admin', permission: 'settings.manage', body: settingPatch }, async (req) => {
    const i = parse(settingPatch, req.body);
    return features.setModuleSetting(req.ctx, i.key, i.value, i.reason);
  });

  // integrations: mode, state and missing requirements, never a value
  def(app, { method: 'GET', path: '/admin/integrations', summary: 'Every integration: mode, configured state, variable names and what is missing (no values)', tag: 'admin', auth: 'admin', permission: 'settings.manage' }, async (req) => ({ items: integrations(req.ctx, app.services), mode: app.config.BIOPTIME_MODE, demo: app.config.isDemo }));

  // private files: a 5-minute token after the kind's access resolver admits the caller; the download re-checks
  def(app, { method: 'POST', path: '/files/:id/token', summary: 'A 5-minute token to open a private file (access checked by its kind, audited)', tag: 'shared', auth: 'any', rateLimit: { max: 120, timeWindow: '1 minute' } }, async (req) => files.fileToken(req.ctx, param(req, 'id')));
  def(app, { method: 'GET', path: '/files/download', summary: 'A private file for a file token (no public URL ever points at one)', tag: 'shared', auth: 'none', query: z.object({ token: z.string() }) }, async (req, reply) => {
    const { file, absPath } = files.resolveFileToken(req.ctx, String(query(req).token ?? ''));
    // images and PDF open inline; a generated file (the JSON data export) is always saved as an attachment
    reply.header('cache-control', 'no-store, private').header('x-content-type-options', 'nosniff').header('content-disposition', files.downloadDisposition(file)).type(file.mime);
    // the app's web build runs on another origin than the API, where helmet's same-site default blocks the <img> (a meal
    // photo showed an empty frame): an image may be embedded cross-origin. The five-minute token is what authorises it.
    if (file.mime.startsWith('image/')) reply.header('cross-origin-resource-policy', 'cross-origin');
    return fs.createReadStream(absPath); // returned, not reply.send(): Fastify sends it once and handles a client that leaves early
  });

  // push devices: tokens are stored; delivery stays logged in the outbox until a push provider exists
  def(app, { method: 'POST', path: '/me/devices', summary: 'Register this device for push (stored; delivery is logged until a push provider is configured)', tag: 'shared', auth: 'any', body: deviceBody, rateLimit: { max: 30, timeWindow: '10 minutes' } }, async (req, reply) => {
    const i = parse(deviceBody, req.body);
    reply.code(201);
    return reminders.registerDevice(req.ctx, req.ctx.actor!.id, i);
  });
  def(app, { method: 'DELETE', path: '/me/devices/:id', summary: 'Stop using a registered device', tag: 'shared', auth: 'any' }, async (req) => reminders.revokeDevice(req.ctx, req.ctx.actor!.id, param(req, 'id')));

  // quiet hours: reminders inside them write the in-app notification only
  def(app, { method: 'PUT', path: '/notification-preferences/quiet-hours', summary: 'Set or clear my quiet hours (minutes after local midnight; both null clears)', tag: 'shared', auth: 'any', body: quietBody }, async (req) => {
    const i = parse(quietBody, req.body);
    return reminders.setQuietHours(req.ctx, req.ctx.actor!.id, i.startMinute, i.endMinute);
  });
}
