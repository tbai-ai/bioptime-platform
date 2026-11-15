/* Integration, core (round 6): module permissions on Users and permissions, the module route guard at start-up,
   reminders gated by their module's switch (skipped with a reason, never sent later), the writer for server-generated
   private files and its download headers, the integrations registry's notes, the environment template, the migration
   list in the module registry, and the test harness's temporary storage folders. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId, removeScratchDirs } from '../helpers.js';
import type { Ctx } from '../../src/context.js';
import { API_ROOT, PLATFORM_ROOT, loadConfig } from '../../src/config.js';
import { MIGRATIONS_DIR } from '../../src/db/db.js';
import { def } from '../../src/http/route.js';
import { routes as registeredRoutes } from '../../src/http/openapi.js';
import { MODULES, featureOf } from '../../src/modules/index.js';
import type { ApiModule, ModuleKey } from '../../src/modules/types.js';
import { MODULE_PERMISSIONS, ALL_PERMISSIONS, PERMISSION_LABELS } from '../../src/auth/permissions.js';
import * as reminders from '../../src/domain/reminders.js';
import * as files from '../../src/domain/files.js';
import { HABIT_REF } from '../../src/domain/habits.js';
import { PREPARATION_REF } from '../../src/domain/labFollowups.js';
import { EXPORT_KIND } from '../../src/domain/dataExport.js';

const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const PARTNER_KEY_VALUE = 'lsk-integration-core-partner-0001';

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp({ env: { LABSTACK_PARTNER_KEY: PARTNER_KEY_VALUE } }); });
after(async () => { await h.app.close(); h.db.close(); });

const as = (email: string): Ctx => { const u = h.db.get<{ id: string; role: 'member' | 'coach' | 'admin' | 'owner'; name: string }>('SELECT id, role, name FROM users WHERE email = ?', [email])!; return { ...h.ctx, actor: { id: u.id, role: u.role, email, name: u.name } }; };
const at = (iso: string): Ctx => ({ ...h.ctx, now: () => iso });
const signedIn = async (email: string, password: string, workspace: 'member' | 'dashboard', mfa = false) => { const c = client(h.app); await c.login(email, password, workspace, mfa); return c; };

/* ---------- c. module permissions ---------- */

test('Users and permissions lists every module permission with a heading; an owner grants and revokes one; a non-owner is refused', async () => {
  const owner = await signedIn(DEMO.owner, DEMO_PASSWORDS.owner, 'dashboard', true);
  const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin, 'dashboard', true);
  const coach = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach, 'dashboard');
  const adminId = userId(h.ctx, DEMO.admin);
  const list = await owner.get('/api/admin/users');
  assert.equal(list.status, 200, JSON.stringify(list.json));
  const perms = list.json.permissions as Array<{ key: string; label: string; module: boolean; heading?: string }>;
  assert.deepEqual(perms.map((p) => p.key), [...ALL_PERMISSIONS]);
  for (const key of MODULE_PERMISSIONS) {
    const p = perms.find((x) => x.key === key)!;
    assert.equal(p.module, true, key);
    assert.equal(p.label, PERMISSION_LABELS[key], 'the full wording from the permission list');
    assert.ok(p.heading && p.heading.length <= 16 && !p.heading.includes('.'), `${key} has a short readable heading, not its key`);
  }
  assert.ok(perms.filter((p) => !p.module).every((p) => p.heading === undefined));
  assert.ok(!((list.json.items as Array<{ id: string; permissions: string[] }>).find((u) => u.id === adminId)!.permissions.includes('modules.manage')), 'not an administrator default');

  // the administrator cannot open the module switches until an owner grants modules.manage
  assert.equal((await admin.get('/api/admin/modules')).json.error?.code, 'PERMISSION_DENIED');
  const grant = await owner.post(`/api/admin/users/${adminId}/permissions`, { permission: 'modules.manage', granted: true, reason: 'test: runs the module switches this week' });
  assert.equal(grant.status, 200, JSON.stringify(grant.json));
  assert.ok((grant.json.permissions as string[]).includes('modules.manage'));
  assert.equal((await admin.get('/api/admin/modules')).status, 200, 'takes effect on the next request');
  const audited = h.db.get<{ reason: string; data: string }>("SELECT reason, data FROM audit_events WHERE action = 'permission.change' AND target_id = ? ORDER BY at DESC, rowid DESC LIMIT 1", [adminId])!;
  assert.equal(audited.reason, 'test: runs the module switches this week');
  assert.deepEqual(JSON.parse(audited.data), { permission: 'modules.manage', granted: true });

  // a default module permission can be revoked, and the grant above can be taken back
  const revokeDefault = await owner.post(`/api/admin/users/${adminId}/permissions`, { permission: 'library.manage', granted: false, reason: 'test: libraries are someone else’s' });
  assert.equal(revokeDefault.status, 200, JSON.stringify(revokeDefault.json));
  assert.ok(!(revokeDefault.json.permissions as string[]).includes('library.manage'));
  const revoke = await owner.post(`/api/admin/users/${adminId}/permissions`, { permission: 'modules.manage', granted: false, reason: 'test: the week is over' });
  assert.ok(!(revoke.json.permissions as string[]).includes('modules.manage'));
  assert.equal((await admin.get('/api/admin/modules')).json.error?.code, 'PERMISSION_DENIED');

  // refusals: an administrator without permissions.manage (not an owner), a coach, an unknown permission
  const before = h.db.get<{ n: number }>('SELECT COUNT(*) n FROM user_permissions')!.n;
  const self = await admin.post(`/api/admin/users/${adminId}/permissions`, { permission: 'ai.manage', granted: true, reason: 'test: granting myself Coach AI usage' });
  assert.equal(self.status, 403);
  assert.equal(self.json.error?.code, 'PERMISSION_DENIED');
  assert.equal((await admin.get('/api/admin/users')).json.error?.code, 'PERMISSION_DENIED', 'nor can they read the list');
  assert.equal((await coach.post(`/api/admin/users/${adminId}/permissions`, { permission: 'ai.manage', granted: true, reason: 'test: coach' })).status, 403);
  assert.equal((await owner.post(`/api/admin/users/${adminId}/permissions`, { permission: 'nonsense.manage', granted: true, reason: 'test: unknown' })).status, 400);
  assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM user_permissions')!.n, before, 'nothing was written by the refused calls');
  await owner.post(`/api/admin/users/${adminId}/permissions`, { permission: 'library.manage', granted: true, reason: 'test: restore the default' });
});

/* ---------- d. module route guard ---------- */

const probeModule = (routesFn: ApiModule['routes'], extra: Partial<ApiModule> = {}): ApiModule => ({ key: 'integrationProbe' as ModuleKey, feature: 'habits', routes: routesFn, ...extra });

test('start-up refuses a module route that def() did not create, however it is registered; def() routes start, nested or not', async () => {
  const cases: Array<[string, ApiModule['routes']]> = [
    ['app.get', (app) => { app.get('/integration-probe/raw', async () => ({ ok: true })); }],
    ['app.route', (app) => { app.route({ method: 'POST', url: '/integration-probe/raw-route', handler: async () => ({ ok: true }) }); }],
    ['a plugin of its own', (app) => { void app.register(async (inner) => { inner.delete('/integration-probe/raw-nested', async () => ({ ok: true })); }); }],
    ['next to a def() route', (app) => {
      def(app, { method: 'GET', path: '/integration-probe/fine', summary: 'Probe (test only)', tag: 'test', auth: 'any', feature: 'habits' }, async () => ({ ok: true }));
      app.get('/integration-probe/sneaky', async () => ({ ok: true }));
    }],
  ];
  for (const [how, routesFn] of cases) {
    await assert.rejects(() => makeApp({ seed: false, modules: [...MODULES, probeModule(routesFn)] }), /module integrationProbe: (GET|POST|DELETE) \/api\/integration-probe\/\S+ was registered without def\(\)/, how);
  }
  // def() inside a plugin of the module's own is fine, and still guarded by its flag
  const nested = await makeApp({ modules: [...MODULES, probeModule((app) => { void app.register(async (inner) => { def(inner, { method: 'GET', path: '/integration-probe/nested-def', summary: 'Probe (test only)', tag: 'test', auth: 'any', feature: 'habits' }, async () => ({ ok: true })); }); })] });
  try {
    const m = client(nested.app);
    await m.login(DEMO.member, DEMO_PASSWORDS.member);
    assert.equal((await m.get('/api/integration-probe/nested-def')).status, 200);
    nested.db.run("UPDATE feature_flags SET enabled = 0 WHERE key = 'habits'");
    assert.equal((await m.get('/api/integration-probe/nested-def')).json.error?.code, 'FEATURE_DISABLED', 'the flag still applies inside the plugin');
    assert.equal((await client(nested.app).get('/api/integration-probe/nested-def')).status, 401, 'and so does sign-in');
    assert.equal((await m.get('/api/no-such-route')).json.error?.code, 'NOT_FOUND', 'the API 404 is unchanged');
  } finally { await nested.app.close(); nested.db.close(); }
  // a def() route in a nested plugin without a flag is still caught by the feature check
  await assert.rejects(() => makeApp({ seed: false, modules: [...MODULES, probeModule((app) => { void app.register(async (inner) => { def(inner, { method: 'GET', path: '/integration-probe/nested-ungated', summary: 'Probe (test only)', tag: 'test', auth: 'any' }, async () => ({ ok: true })); }); }, { feature: undefined })] }), /module integrationProbe: GET \/integration-probe\/nested-ungated declares no feature flag/);
});

test('every real module still starts behind the guard, and each registers its routes through def()', async () => {
  const byModule = new Map<string, ReturnType<typeof registeredRoutes>>();
  const counted = MODULES.map((m): ApiModule => ({ ...m, routes: (app) => { const before = registeredRoutes().length; m.routes(app); byModule.set(m.key, registeredRoutes().slice(before)); } }));
  const built = await makeApp({ seed: false, modules: counted });
  try {
    const anon = client(built.app);
    for (const m of MODULES) {
      const own = byModule.get(m.key) ?? [];
      assert.ok(own.length > 0, `${m.key} registered its routes`);
      // one of its signed-in routes, called signed out: def()'s guard answers, the handler never runs
      const r = own.find((x) => x.auth !== 'none' && x.auth !== 'webhook')!;
      const url = '/api' + r.path.replace(/:\w+/g, 'probe');
      const res = await built.app.inject({ method: r.method, url, headers: { 'content-type': 'application/json', 'x-bioptime-client': 'web' }, payload: r.method === 'GET' || r.method === 'DELETE' ? undefined : '{}' });
      assert.equal(res.statusCode, 401, `${m.key}: ${r.method} ${url}`);
    }
    assert.equal((await anon.get('/api/admin/modules')).status, 401);
  } finally { await built.app.close(); built.db.close(); }
});

/* ---------- e. reminders and the module switch ---------- */

test('reminders: the ref_type map covers every reminder a module queues in the source and names the modules’ own constants', () => {
  const srcRoot = path.join(API_ROOT, 'src');
  const tsFiles = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tsFiles(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []));
  const found: Array<{ file: string; refType: string }> = [];
  for (const file of tsFiles(srcRoot)) {
    if (file.endsWith(path.join('domain', 'reminders.ts'))) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/reminders\.(schedule|replace)\(([\s\S]{0,400}?)refType:\s*([A-Za-z_'"][\w'"]*)/g)) {
      const raw = m[3]!;
      let refType = /^['"]/.test(raw) ? raw.replace(/['"]/g, '') : '';
      if (!refType) {
        const decl = new RegExp(`(?:export\\s+)?const\\s+${raw}\\s*=\\s*['"]([\\w-]+)['"]`).exec(text);
        assert.ok(decl, `${path.relative(srcRoot, file)}: the refType ${raw} resolves to a string constant`);
        refType = decl![1]!;
      }
      found.push({ file: path.relative(srcRoot, file), refType });
    }
  }
  assert.ok(found.length >= 5, `the scan finds the modules' schedule and replace calls (${found.length})`);
  for (const f of found) assert.ok(reminders.moduleForReminder(f.refType), `${f.file}: ref_type ${f.refType} is mapped to its module`);
  assert.deepEqual([...new Set(found.map((f) => f.refType))].sort(), Object.keys(reminders.REMINDER_REF_MODULES).sort(), 'and the map names nothing else');
  assert.equal(reminders.moduleForReminder(HABIT_REF), 'habits');
  assert.equal(reminders.moduleForReminder(PREPARATION_REF), 'labFollowups');
  for (const key of Object.values(reminders.REMINDER_REF_MODULES)) assert.ok(MODULES.some((m) => m.key === key), `${key} is a registered module`);
  assert.equal(reminders.moduleForReminder('foundation_probe'), null, 'anything else is core');
  assert.equal(reminders.moduleForReminder('constructor'), null, 'only the map’s own keys');
});

test('reminders: due while their module is off they are skipped with a reason and never sent later; core reminders always go', async () => {
  h.db.run("UPDATE reminders SET status = 'cancelled' WHERE status = 'queued'"); // this file's own database: start from an empty queue
  const memberId = userId(h.ctx, DEMO.member2);
  const due = '2032-01-14T05:00:00.000Z', later = '2032-01-14T06:00:00.000Z'; // 10:30 and 11:30 in India
  const base = { userId: memberId, category: 'habit_reminder', title: 'Probe reminder', body: 'Integration probe.' };
  const row = (id: string) => h.db.get<{ status: string; skip_reason: string | null; notification_id: string | null }>('SELECT status, skip_reason, notification_id FROM reminders WHERE id = ?', [id])!;
  const notified = (id: string) => h.db.get<{ n: number }>("SELECT COUNT(*) n FROM notifications WHERE json_extract(data, '$.reminderId') = ?", [id])!.n;
  const flags = new Map(MODULES.map((m) => [featureOf(m), !!h.db.get<{ enabled: number }>('SELECT enabled FROM feature_flags WHERE key = ?', [featureOf(m)])?.enabled]));
  const setFlag = (key: string, on: boolean) => h.db.run('UPDATE feature_flags SET enabled = ? WHERE key = ?', [on ? 1 : 0, key]);
  try {
    for (const [refType, moduleKey] of Object.entries(reminders.REMINDER_REF_MODULES)) {
      const feature = featureOf(MODULES.find((m) => m.key === moduleKey)!);
      const off = reminders.schedule(h.ctx, { ...base, refType, refId: `ic-${refType}-off`, dueAt: due });
      const on = reminders.schedule(h.ctx, { ...base, refType, refId: `ic-${refType}-on`, dueAt: later });
      setFlag(feature, false);
      const first = reminders.dispatchDue(at(due));
      assert.deepEqual(first, { sent: 0, inAppOnly: 0, skipped: 1 }, `${refType}: skipped while ${moduleKey} is off`);
      assert.deepEqual({ ...row(off) }, { status: 'skipped', skip_reason: 'module_off', notification_id: null });
      assert.equal(notified(off), 0, 'nothing was written for the person');
      setFlag(feature, true);
      const second = reminders.dispatchDue(at(later));
      assert.deepEqual(second, { sent: 1, inAppOnly: 0, skipped: 0 }, `${refType}: switched back on, only the reminder due now is sent`);
      assert.equal(row(off).status, 'skipped', 'the one skipped earlier stays skipped: no burst');
      assert.equal(notified(off), 0);
      assert.equal(row(on).status, 'sent', 'queued while off, due once the module is back on: sent');
      assert.equal(row(on).skip_reason, null);
      assert.equal(notified(on), 1);
    }
    // a core reminder (a ref_type no module claims) goes out with every module switched off
    for (const k of flags.keys()) setFlag(k, false);
    const core = reminders.schedule(h.ctx, { ...base, refType: 'integration_core_probe', refId: 'ic-core', dueAt: due });
    assert.deepEqual(reminders.dispatchDue(at(later)), { sent: 1, inAppOnly: 0, skipped: 0 });
    assert.equal(row(core).status, 'sent');
    for (const k of flags.keys()) setFlag(k, true);

    // the other reasons are recorded too
    const c = await signedIn(DEMO.member2, DEMO_PASSWORDS.member, 'member');
    await c.put('/api/notification-preferences/quiet-hours', { startMinute: 600, endMinute: 660 }); // 10:00 to 11:00 in India
    const quiet = reminders.schedule(h.ctx, { ...base, refType: 'habit', refId: 'ic-quiet', dueAt: due, channels: ['push'] });
    reminders.dispatchDue(at(due));
    assert.deepEqual({ status: row(quiet).status, reason: row(quiet).skip_reason }, { status: 'skipped', reason: 'quiet_hours' });
    await c.put('/api/notification-preferences/quiet-hours', { startMinute: null, endMinute: null });
    await c.patch('/api/notification-preferences', { reminders: false });
    const prefOff = reminders.schedule(h.ctx, { ...base, refType: 'habit', refId: 'ic-pref', dueAt: due });
    reminders.dispatchDue(at(due));
    assert.equal(row(prefOff).skip_reason, 'reminders_off');
    await c.patch('/api/notification-preferences', { reminders: true });
    const state = h.db.get<{ state: string }>('SELECT state FROM users WHERE id = ?', [memberId])!.state;
    h.db.run("UPDATE users SET state = 'suspended' WHERE id = ?", [memberId]);
    const closed = reminders.schedule(h.ctx, { ...base, refType: 'habit', refId: 'ic-closed', dueAt: due });
    reminders.dispatchDue(at(due));
    h.db.run('UPDATE users SET state = ? WHERE id = ?', [state, memberId]);
    assert.equal(row(closed).skip_reason, 'account_inactive');
    // a skipped reminder is not re-queued by scheduling it again
    assert.equal(reminders.schedule(h.ctx, { ...base, refType: 'habit', refId: 'ic-closed', dueAt: due }), closed);
    assert.equal(row(closed).status, 'skipped');
  } finally {
    for (const [k, on] of flags) setFlag(k, on);
  }
});

/* ---------- i. server-generated private files and downloads ---------- */

test('generated private files follow the private-file rules; JSON downloads as an attachment, images and PDF stay inline', async () => {
  const memberId = userId(h.ctx, DEMO.member);
  const mctx = as(DEMO.member);
  const content = JSON.stringify({ probe: true, note: 'integration core' }, null, 2);
  const saved = files.saveGeneratedPrivateFile(mctx, { ownerId: memberId, kind: 'integration_probe', content, mime: 'application/json', name: 'my export?', ref: { type: 'user', id: memberId } });
  assert.equal(saved.mime, 'application/json');
  assert.equal(saved.name, 'my-export-.json', 'a safe name that ends in .json');
  assert.equal(saved.sha256, createHash('sha256').update(content).digest('hex'));
  const row = h.db.get<{ storage_path: string; owner_id: string; size: number; ref_type: string }>('SELECT storage_path, owner_id, size, ref_type FROM file_metadata WHERE id = ?', [saved.id])!;
  assert.match(row.storage_path, /^integration_probe\/fil_[a-z0-9]+\.json$/, 'a relative storage path');
  const abs = path.join(h.config.privateFilesDir, row.storage_path);
  assert.equal(fs.statSync(abs).mode & 0o777, 0o600, 'readable by the server only');
  assert.equal(fs.readFileSync(abs, 'utf8'), content);
  assert.equal(row.size, Buffer.byteLength(content));
  assert.ok(h.db.get("SELECT 1 FROM audit_events WHERE action = 'file.save' AND target_id = ? AND json_extract(data, '$.mime') = 'application/json'", [saved.id]), 'audited as file.save');
  assert.throws(() => files.saveGeneratedPrivateFile(mctx, { ownerId: memberId, kind: 'integration_probe', content: '{not json', mime: 'application/json', name: 'x' }), /not valid JSON/);
  assert.throws(() => files.saveGeneratedPrivateFile(mctx, { ownerId: memberId, kind: 'integration_probe', content: '<svg/>', mime: 'image/svg+xml' as 'application/json', name: 'x' }), /not a generated file type/);
  assert.throws(() => files.saveGeneratedPrivateFile(mctx, { ownerId: memberId, kind: 'integration_probe', content: '', mime: 'application/json', name: 'x' }), (e: { code?: string }) => e.code === 'FILE_EMPTY');
  const prod = { ...mctx, config: { ...mctx.config, isProduction: true } } as Ctx;
  assert.throws(() => files.saveGeneratedPrivateFile(prod, { ownerId: memberId, kind: 'integration_probe', content, mime: 'application/json', name: 'x' }), (e: { code?: string }) => e.code === 'STORAGE_NOT_CONFIGURED');

  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member, 'member');
  const t = await member.post(`/api/files/${saved.id}/token`);
  assert.equal(t.status, 200, JSON.stringify(t.json));
  const dl = await h.app.inject({ method: 'GET', url: t.json.url as string });
  assert.equal(dl.statusCode, 200);
  assert.equal(dl.headers['content-disposition'], 'attachment; filename="my-export-.json"');
  assert.match(String(dl.headers['content-type']), /^application\/json/);
  assert.match(String(dl.headers['cache-control']), /no-store/);
  assert.equal(dl.body, content);

  const png = files.savePrivateFile(mctx, { ownerId: memberId, kind: 'integration_probe', buffer: PNG_1x1, allowedMimes: ['image/png'], maxBytes: 4096, name: 'a photo.png' });
  const pt = await member.post(`/api/files/${png.id}/token`);
  const pdl = await h.app.inject({ method: 'GET', url: pt.json.url as string });
  assert.equal(pdl.headers['content-disposition'], 'inline; filename="a-photo.png"', 'images open in the browser as before');
  assert.equal(files.downloadDisposition({ name: 'report.pdf', mime: 'application/pdf', kind: 'report' }), 'inline; filename="report.pdf"');
  assert.equal(files.downloadDisposition({ name: '...', mime: 'application/json', kind: 'data_export' }), 'attachment; filename="data-export.json"', 'nothing usable left: named after its kind');
  assert.equal(files.downloadDisposition({ name: 'export"; filename=evil.html', mime: 'application/json', kind: 'data_export' }), 'attachment; filename="export-filename-evil.html.json"', 'quotes and separators never reach the header');
});

test('the upload type error names the accepted types in plain words', () => {
  const mctx = as(DEMO.member);
  const message = (allowed: Parameters<typeof files.savePrivateFile>[1]['allowedMimes']) => { try { files.savePrivateFile(mctx, { ownerId: mctx.actor!.id, kind: 'integration_probe', buffer: SVG, allowedMimes: allowed, maxBytes: 4096 }); } catch (e) { return { code: (e as { code?: string }).code, message: (e as Error).message }; } return null; };
  assert.deepEqual(message(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']), { code: 'FILE_TYPE', message: 'Only PNG, JPEG, WebP or PDF files are accepted' });
  assert.deepEqual(message(['image/jpeg', 'image/png', 'image/webp']), { code: 'FILE_TYPE', message: 'Only PNG, JPEG or WebP files are accepted' });
  assert.deepEqual(message(['image/png']), { code: 'FILE_TYPE', message: 'Only PNG files are accepted' });
});

test('a member’s data export is written by the generated-file writer and downloads as an attachment', async () => {
  const member = await signedIn(DEMO.member2, DEMO_PASSWORDS.member, 'member');
  const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin, 'dashboard', true);
  const req = await member.post('/api/me/data-requests', { kind: 'export' });
  assert.ok(req.status === 201 || req.status === 200, JSON.stringify(req.json));
  const requestId = req.json.id as string;
  const gen = await admin.post(`/api/admin/data-exports/${requestId}/generate`, { reason: 'test: the member asked for a copy' });
  assert.equal(gen.status, 200, JSON.stringify(gen.json));
  const fileId = h.db.get<{ file_id: string }>('SELECT file_id FROM data_requests WHERE id = ?', [requestId])!.file_id;
  const f = h.db.get<{ kind: string; mime: string; name: string; storage_path: string; sha256: string; owner_id: string; ref_type: string; ref_id: string }>('SELECT kind, mime, name, storage_path, sha256, owner_id, ref_type, ref_id FROM file_metadata WHERE id = ?', [fileId])!;
  assert.equal(f.kind, EXPORT_KIND);
  assert.equal(f.mime, 'application/json');
  assert.match(f.name, /^bioptime-data-export-\d{4}-\d{2}-\d{2}\.json$/);
  assert.equal(f.storage_path, `${EXPORT_KIND}/${fileId}.json`);
  assert.deepEqual([f.owner_id, f.ref_type, f.ref_id], [userId(h.ctx, DEMO.member2), 'data_request', requestId]);
  const abs = path.join(h.config.privateFilesDir, f.storage_path);
  assert.equal(fs.statSync(abs).mode & 0o777, 0o600);
  assert.equal(createHash('sha256').update(fs.readFileSync(abs)).digest('hex'), f.sha256);
  assert.ok(h.db.get("SELECT 1 FROM audit_events WHERE action = 'file.save' AND target_id = ? AND json_extract(data, '$.kind') = ?", [fileId, EXPORT_KIND]));
  const t = await member.post(`/api/me/data-requests/${requestId}/file-token`);
  assert.equal(t.status, 200, JSON.stringify(t.json));
  const dl = await h.app.inject({ method: 'GET', url: t.json.url as string });
  assert.equal(dl.statusCode, 200);
  assert.equal(dl.headers['content-disposition'], `attachment; filename="${f.name}"`);
  assert.ok(JSON.parse(dl.body), 'the archive itself');
});

/* ---------- f. the integrations registry ---------- */

test('the integrations registry says only what is true today and names the optional partner key without its value', async () => {
  const owner = await signedIn(DEMO.owner, DEMO_PASSWORDS.owner, 'dashboard', true);
  const r = await owner.get('/api/admin/integrations');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const items = r.json.items as Array<{ key: string; note: string; usedBy: string[]; variables: string[]; optionalVariables?: string[]; missing: string[] }>;
  const item = (k: string) => items.find((i) => i.key === k)!;
  assert.match(item('meetings').note, /link is one the coach or host types \(https only, checked when saved\), or nothing\./);
  assert.doesNotMatch(item('meetings').note, /whatever the coach types/);
  assert.match(item('calendar').note, /no subscribable calendar feed/);
  assert.match(item('calendar').note, /one-off calendar file \(\.ics\)/);
  assert.deepEqual(item('video').usedBy, ['learning', 'workouts']);
  const lab = item('lab');
  assert.ok(lab.variables.includes('LABSTACK_PARTNER_KEY'));
  assert.deepEqual(lab.optionalVariables, ['LABSTACK_PARTNER_KEY']);
  assert.ok(!lab.missing.some((m) => m.includes('PARTNER')), 'optional: never listed as missing');
  assert.ok(!JSON.stringify(r.json).includes(PARTNER_KEY_VALUE), 'the value is never shown');
  const ai = item('ai').missing;
  assert.equal(ai.length, 5);
  assert.match(ai[0]!, /An AI provider and model.*AI_PROVIDER accepts only "none"/);
  assert.match(ai[1]!, /API key, set in the server environment/);
  assert.match(ai[2]!, /data-processing agreement/);
  assert.match(ai[3]!, /how long drafts are kept/);
  assert.match(ai[4]!, /Counsel-approved wording for the ai_processing consent/);
  const coachAi = await import('../../src/domain/ai.js');
  assert.equal(ai[4], coachAi.AI_CONSENT.missing, 'the same words the Coach AI pages use');
  // the coach's Coach AI page names the same provider, key, agreement and retention requirements (the demo accepts the
  // labelled draft consent wording, so that one is named there only outside the demo)
  const coachView = await (await signedIn(DEMO.coach, DEMO_PASSWORDS.coach, 'dashboard')).get('/api/coach/ai/status');
  assert.equal(coachView.status, 200, JSON.stringify(coachView.json));
  const labels = JSON.stringify(coachView.json);
  for (const m of ai.slice(0, 4)) assert.ok(labels.includes(JSON.stringify(m).slice(1, -1)), `Coach AI names it too: ${m}`);
  assert.deepEqual(item('storage').usedBy, MODULES.filter((m) => Object.keys(m.fileAccess ?? {}).length > 0).map((m) => m.key));
  assert.ok(!item('storage').usedBy.includes('billing'), 'billing renders its documents and stores no private files');
  // once the owner decides the retention period, it is no longer missing
  const set = await owner.patch('/api/admin/module-settings', { key: 'ai_draft_retention_days', value: 30, reason: 'test: thirty days' });
  assert.equal(set.status, 200, JSON.stringify(set.json));
  try {
    const after = ((await owner.get('/api/admin/integrations')).json.items as typeof items).find((i) => i.key === 'ai')!.missing;
    assert.equal(after.length, 4);
    assert.ok(!after.some((m) => /how long drafts are kept/.test(m)));
  } finally {
    await owner.patch('/api/admin/module-settings', { key: 'ai_draft_retention_days', value: null, reason: 'test: back to undecided' });
  }
});

/* ---------- g, h. the environment template and the migration list ---------- */

test('the environment template documents every variable config.ts reads, with safe values and the optional partner key', () => {
  const configSource = fs.readFileSync(path.join(API_ROOT, 'src', 'config.ts'), 'utf8');
  const schemaBlock = configSource.slice(configSource.indexOf('const schema = z.object({'), configSource.indexOf('});', configSource.indexOf('const schema = z.object({')));
  const keys = [...schemaBlock.matchAll(/^\s+([A-Z][A-Z0-9_]+):\s*z\./gm)].map((m) => m[1]!);
  assert.ok(keys.length >= 40, `config.ts keys found (${keys.length})`);
  const lines = fs.readFileSync(path.join(PLATFORM_ROOT, '.env.example'), 'utf8').split('\n');
  const entries = new Map<string, string>();
  lines.forEach((l) => { const m = /^([A-Z][A-Z0-9_]+)=(.*)$/.exec(l); if (m) entries.set(m[1]!, m[2]!); });
  for (const k of keys) assert.ok(entries.has(k), `.env.example documents ${k}`);
  for (const k of entries.keys()) assert.ok(keys.includes(k), `${k} in .env.example is read by config.ts`);
  for (const [k, v] of entries) if (/SECRET|_KEY|TOKEN|PASSWORD|_VALUE$/.test(k)) assert.ok(v === '' || v.includes('change-me'), `${k} carries no secret`);
  assert.equal(entries.get('LABSTACK_PARTNER_KEY'), '', 'the partner key is empty');
  const pk = lines.findIndex((l) => l.startsWith('LABSTACK_PARTNER_KEY='));
  assert.ok(pk > lines.findIndex((l) => l.startsWith('LABSTACK_CATALOGUE_SYNC_HOURS=')), 'after LABSTACK_CATALOGUE_SYNC_HOURS');
  const comment = lines.slice(0, pk).reverse().filter((_, i, arr) => arr.slice(0, i + 1).every((x) => x.startsWith('#'))).reverse().join(' ');
  for (const phrase of [/Optional/, /LabStack console/, /Widget configs > Access/, /shown there once/, /never sent to a browser/, /No widget token is minted yet/]) assert.match(comment, phrase);
  const asEnv = Object.fromEntries([...entries].filter(([, v]) => v !== '')) as Record<string, string>;
  assert.doesNotThrow(() => loadConfig(asEnv), 'the template’s values are a valid configuration');
});

test('the module registry’s migration list names exactly the module and integration migrations that exist', () => {
  const text = fs.readFileSync(path.join(API_ROOT, 'src', 'modules', 'index.ts'), 'utf8');
  const comment = text.slice(0, text.indexOf('*/'));
  const named = new Set([...comment.matchAll(/\b(\d{4}_[A-Za-z_]+\.sql)\b/g)].map((m) => m[1]!));
  const existing = fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}_.+\.sql$/.test(f));
  for (const f of named) assert.ok(fs.existsSync(path.join(MIGRATIONS_DIR, f)), `${f} exists`);
  // the module files (0009 to 0019) and the two integration files are named one by one; later fixes by rule
  for (const f of existing.filter((x) => x >= '0009' && x < '0022')) assert.ok(named.has(f), `${f} is listed`);
  assert.equal(existing.filter((x) => x >= '0009' && x < '0022').length, 13, 'eleven module files and two integration files');
  assert.match(comment, /labstackOps\s+\(none\)/, 'LabStack operations has no migration of its own');
  // the later additive fixes are listed one by one too, so the list stays complete
  for (const f of existing.filter((x) => x >= '0022')) assert.ok(named.has(f), `${f} is listed`);
  assert.match(comment, /A new change takes the next free number/);
});

/* ---------- j. the harness keeps test files out of apps/api/data (keep this test last: it removes the folders) ---------- */

test('tests write uploads, reports and private files to temporary folders that are removed afterwards', async () => {
  const dataDir = path.join(API_ROOT, 'data');
  for (const dir of [h.config.assetsDir, h.config.reportsDir, h.config.privateFilesDir]) {
    assert.ok(dir.startsWith(path.join(os.tmpdir(), 'bioptime-test-')), `${dir} is a temporary folder`);
    assert.ok(path.relative(dataDir, dir).startsWith('..'), 'never under apps/api/data');
  }
  assert.deepEqual(Object.values(h.dirs), [h.config.assetsDir, h.config.reportsDir, h.config.privateFilesDir].map((d) => d));
  const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin, 'dashboard', true);
  const up = await admin.post('/api/admin/assets', { filename: 'dot.png', dataBase64: PNG_1x1.toString('base64'), alt: 'A single dot' });
  assert.equal(up.status, 201, JSON.stringify(up.json));
  const id = up.json.id as string;
  assert.ok(fs.readdirSync(h.config.assetsDir).some((f) => f.startsWith(id)), 'the upload lands in the temporary assets folder');
  assert.ok(!fs.existsSync(path.join(dataDir, 'assets')) || !fs.readdirSync(path.join(dataDir, 'assets')).some((f) => f.startsWith(id)), 'and not in apps/api/data/assets');
  // a test's own PRIVATE_FILES_DIR still wins
  const own = fs.mkdtempSync(path.join(os.tmpdir(), 'bioptime-own-'));
  try {
    const other = await makeApp({ seed: false, env: { PRIVATE_FILES_DIR: own } });
    assert.equal(other.config.privateFilesDir, own);
    assert.notEqual(other.config.assetsDir, h.config.assetsDir, 'each app gets its own folders');
    await other.app.close(); other.db.close();
  } finally { fs.rmSync(own, { recursive: true, force: true }); }
  const roots = [h.dirs.ASSETS_DIR, h.dirs.PRIVATE_FILES_DIR].map((d) => path.dirname(d));
  removeScratchDirs();
  for (const r of roots) assert.equal(fs.existsSync(r), false, 'removed');
});
