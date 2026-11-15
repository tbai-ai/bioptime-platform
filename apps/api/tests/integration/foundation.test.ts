/* The foundation (M0): feature flags enforced on the server and reflected in /public/config, the module registry
   (routes, the feature-flag check at start-up, jobs, event handlers), private files behind short-lived tokens and their
   access resolvers, the reminder queue with preferences and quiet hours, push devices, the integrations registry,
   module settings and permissions, and the 0008 rebuilds of member_consents and progress_entries. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId } from '../helpers.js';
import { Db, MIGRATIONS_DIR } from '../../src/db/db.js';
import type { Ctx } from '../../src/context.js';
import { def } from '../../src/http/route.js';
import { buildOpenApi } from '../../src/http/openapi.js';
import { habits } from '../../src/modules/habits.js';
import { MODULES, featureOf } from '../../src/modules/index.js';
import { requireHealthAccess, permissionsFor, PERMISSIONS, MODULE_PERMISSIONS, ALL_PERMISSIONS } from '../../src/auth/permissions.js';
import * as files from '../../src/domain/files.js';
import * as reminders from '../../src/domain/reminders.js';
import { isEnabled, isEnabledFor, setFlag } from '../../src/domain/features.js';
import { emit } from '../../src/domain/audit.js';
import { processPending } from '../../src/domain/events.js';
import { JobRunner, jobDefinitions, moduleJobs } from '../../src/jobs.js';
import { nextReference } from '../../src/db/seq.js';
import { signToken } from '../../src/lib/crypto.js';
import { CONSENT_KINDS, RESERVED_CONSENT_KINDS, PROGRESS_SOURCES, PROGRESS_SOURCE_LABELS, NOTIFICATION_CATEGORIES, SUPPORT_TASK_KINDS, MODULE_KEYS, consentSchema } from '@bioptime/domain';

const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

let h: Awaited<ReturnType<typeof makeApp>>;
let privateDir = '';
const originalRoutes = habits.routes;
const originalUngated = habits.ungated;

// a probe route registered through the habits stub, exactly as a module builder would, plus one listed as ungated
function probeRoutes(app: Parameters<typeof habits.routes>[0]) {
  def(app, { method: 'GET', path: '/foundation-probe/habits', summary: 'Probe (test only)', tag: 'test', auth: 'any', feature: 'habits' }, async () => ({ ok: true }));
  def(app, { method: 'DELETE', path: '/foundation-probe/habits/mine', summary: 'Probe: reachable while the module is off (test only)', tag: 'test', auth: 'any' }, async () => ({ deleted: true }));
}

before(async () => {
  privateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bioptime-private-'));
  habits.routes = probeRoutes;
  habits.ungated = ['DELETE /foundation-probe/habits/mine'];
  h = await makeApp({ env: { PRIVATE_FILES_DIR: privateDir } });
});
after(async () => {
  habits.routes = originalRoutes;
  habits.ungated = originalUngated;
  await h.app.close();
  h.db.close();
  fs.rmSync(privateDir, { recursive: true, force: true });
});

const as = (email: string): Ctx => { const u = h.db.get<{ id: string; role: 'member' | 'coach' | 'admin' | 'owner'; name: string }>('SELECT id, role, name FROM users WHERE email = ?', [email])!; return { ...h.ctx, actor: { id: u.id, role: u.role, email, name: u.name } }; };
const at = (iso: string): Ctx => ({ ...h.ctx, now: () => iso });
const signedIn = async (email: string, password: string, mfa = false) => { const c = client(h.app); await c.login(email, password, password === DEMO_PASSWORDS.member ? 'member' : 'dashboard', mfa); return c; };
const stateOf = (id: string) => h.db.get<{ state: string }>('SELECT state FROM users WHERE id = ?', [id])!.state;

test('the demo seed switches every module flag on; the legacy switches keep their values; the registry lists every module and its jobs', async () => {
  const owner = await signedIn(DEMO.owner, DEMO_PASSWORDS.owner, true);
  const r = await owner.get('/api/admin/modules');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const flags = r.json.flags as Array<{ key: string; enabled: boolean; module: string | null; stored: boolean }>;
  for (const key of MODULE_KEYS) {
    const f = flags.find((x) => x.key === key);
    assert.ok(f, `flag ${key} is stored`);
    assert.equal(f!.enabled, true, `demo mode switches ${key} on`);
    assert.equal(f!.module, key);
  }
  assert.deepEqual((r.json.modules as Array<{ key: string }>).map((m) => m.key), [...MODULE_KEYS], 'every module is registered, in order');
  assert.equal(flags.find((f) => f.key === 'bespoke')?.enabled, true);
  assert.equal(flags.find((f) => f.key === 'selfBooking')?.enabled, true);
  assert.equal(flags.find((f) => f.key === 'progressPhotos')?.enabled, false);
  // every module job runs under its registered module's key: '<key>.<job>', one runner job per declared job, no clash
  const declared = MODULES.flatMap((m) => (m.jobs ?? []).map(() => m.key));
  const jobs = moduleJobs();
  assert.equal(jobs.length, declared.length, 'one runner job per job a module declares');
  jobs.forEach((job, i) => {
    assert.ok((MODULE_KEYS as readonly string[]).includes(declared[i]!), `${declared[i]} is a registered module`);
    assert.ok(job.name.startsWith(`${declared[i]}.`) && job.name.length > declared[i]!.length + 1, `${job.name} starts with its module key ${declared[i]} and a dot`);
  });
  assert.equal(new Set(jobs.map((x) => x.name)).size, jobs.length, 'job names are unique');
  const auditRow = h.db.get<{ reason: string; data: string }>("SELECT reason, data FROM audit_events WHERE action = 'feature_flag.update' AND target_id = 'modules'");
  assert.ok(auditRow, 'the demo switch-on is audited once');
  assert.equal((JSON.parse(auditRow!.data) as { keys: string[] }).keys.length, MODULE_KEYS.length);
});

test('a route with its flag off answers FEATURE_DISABLED and the client config omits the flag; switching is audited and needs modules.manage', async () => {
  const owner = await signedIn(DEMO.owner, DEMO_PASSWORDS.owner, true);
  const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin, true);
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const anon = client(h.app);
  assert.equal((await member.get('/api/foundation-probe/habits')).status, 200, 'on in the demo');
  assert.ok(((await member.get('/api/public/config')).json.features as string[]).includes('habits'));

  assert.equal((await admin.patch('/api/admin/modules', { key: 'habits', enabled: false, reason: 'test: off' })).json.error?.code, 'PERMISSION_DENIED', 'administrators do not hold modules.manage by default');
  assert.equal((await owner.patch('/api/admin/modules', { key: 'habits', enabled: false })).status, 400, 'a reason is required');
  assert.equal((await owner.patch('/api/admin/modules', { key: 'nonsense', enabled: true, reason: 'test: unknown' })).json.error?.code, 'FLAG_UNKNOWN');
  const off = await owner.patch('/api/admin/modules', { key: 'habits', enabled: false, reason: 'test: switch habits off' });
  assert.equal(off.status, 200, JSON.stringify(off.json));
  assert.equal(off.json.enabled, false);

  const refused = await member.get('/api/foundation-probe/habits');
  assert.equal(refused.status, 403);
  assert.equal(refused.json.error?.code, 'FEATURE_DISABLED');
  assert.deepEqual(refused.json.error?.details, { feature: 'habits' });
  assert.equal((await anon.get('/api/foundation-probe/habits')).status, 401, 'signed-out callers are asked to sign in first');
  assert.equal((await member.del('/api/foundation-probe/habits/mine')).status, 200, 'a route the module lists as ungated stays reachable');
  for (const c of [member, anon]) {
    const features = (await c.get('/api/public/config')).json.features as string[];
    assert.ok(!features.includes('habits'), 'the client config omits a flag that is off');
    assert.ok(features.includes('progress'));
  }
  const row = h.db.get<{ actor_id: string; reason: string; data: string }>("SELECT actor_id, reason, data FROM audit_events WHERE action = 'feature_flag.update' AND target_id = 'habits' ORDER BY at DESC LIMIT 1")!;
  assert.equal(row.reason, 'test: switch habits off');
  assert.equal(row.actor_id, userId(h.ctx, DEMO.owner));
  assert.equal((JSON.parse(row.data) as { previous: { enabled: boolean } }).previous.enabled, true);

  // audience: on, but for coaches only; then for members of one package
  await owner.patch('/api/admin/modules', { key: 'habits', enabled: true, audience: { roles: ['coach'] }, reason: 'test: coaches first' });
  const coach = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  assert.equal((await member.get('/api/foundation-probe/habits')).json.error?.code, 'FEATURE_DISABLED', 'outside the audience');
  assert.equal((await coach.get('/api/foundation-probe/habits')).status, 200);
  assert.ok(!((await member.get('/api/public/config')).json.features as string[]).includes('habits'));
  assert.ok(((await coach.get('/api/public/config')).json.features as string[]).includes('habits'));
  assert.ok(!((await anon.get('/api/public/config')).json.features as string[]).includes('habits'), 'a visitor never sees an audience-limited flag');
  assert.equal((await owner.patch('/api/admin/modules', { key: 'habits', audience: { packageIds: ['pkg_missing'] }, reason: 'test' })).json.error?.code, 'AUDIENCE_INVALID');
  const memberPkg = h.db.get<{ package_id: string }>("SELECT v.package_id FROM programmes g JOIN package_versions v ON v.id = g.package_version_id WHERE g.member_id = ? AND g.status = 'active'", [userId(h.ctx, DEMO.member)])!.package_id;
  const otherPkg = h.db.get<{ id: string }>('SELECT id FROM packages WHERE id != ? LIMIT 1', [memberPkg])!.id;
  await owner.patch('/api/admin/modules', { key: 'habits', audience: { packageIds: [otherPkg] }, reason: 'test: another package' });
  assert.equal((await member.get('/api/foundation-probe/habits')).json.error?.code, 'FEATURE_DISABLED');
  assert.equal((await coach.get('/api/foundation-probe/habits')).status, 200, 'coaches are not narrowed by packages');
  await owner.patch('/api/admin/modules', { key: 'habits', audience: { packageIds: [memberPkg] }, reason: 'test: the member\'s package' });
  assert.equal((await member.get('/api/foundation-probe/habits')).status, 200);
  assert.equal(isEnabled(h.ctx, 'habits'), true);
  assert.equal(isEnabledFor(h.ctx, 'habits', null), false, 'a package audience excludes signed-out callers');
  await owner.patch('/api/admin/modules', { key: 'habits', enabled: true, audience: {}, reason: 'test: everyone again' });
  assert.equal((await member.get('/api/foundation-probe/habits')).status, 200);

  const spec = buildOpenApi('http://localhost:3000', 'test') as { paths: Record<string, Record<string, { 'x-feature'?: string }>> };
  assert.equal(spec.paths['/foundation-probe/habits']!.get!['x-feature'], 'habits', 'the OpenAPI entry names the flag');
});

test('a module route that declares no feature flag stops the app from starting', async () => {
  habits.routes = (app) => { def(app, { method: 'GET', path: '/foundation-probe/ungated', summary: 'Probe (test only)', tag: 'test', auth: 'any' }, async () => ({ ok: true })); };
  try {
    await assert.rejects(() => makeApp({ seed: false, env: { PRIVATE_FILES_DIR: privateDir } }), /module habits: GET \/foundation-probe\/ungated declares no feature flag/);
  } finally {
    habits.routes = probeRoutes;
  }
});

test('private files: types by content, size caps, tokens that expire, the access resolver at issue and at download', async () => {
  const memberId = userId(h.ctx, DEMO.member);
  // a kind with a resolver like a module's: the member, or their assigned coach while health sharing is on
  files.registerCoreFileAccess('foundation_probe', (ctx, f) => {
    if (!ctx.actor || !f.owner_id) return false;
    if (ctx.actor.id === f.owner_id) return true;
    if (ctx.actor.role !== 'coach') return false;
    requireHealthAccess(ctx, f.owner_id);
    return true;
  });
  const mctx = as(DEMO.member);
  const save = (buffer: Buffer, allowed: Array<'image/png' | 'application/pdf'> = ['image/png'], maxBytes = 4096) => files.savePrivateFile(mctx, { ownerId: memberId, kind: 'foundation_probe', buffer, allowedMimes: allowed, maxBytes, ref: { type: 'user', id: memberId }, name: 'my photo?.png' });
  assert.throws(() => save(Buffer.alloc(0)), (e: { code?: string }) => e.code === 'FILE_EMPTY');
  assert.throws(() => save(PNG_1x1, ['image/png'], 10), (e: { code?: string }) => e.code === 'FILE_TOO_LARGE');
  assert.throws(() => save(SVG), (e: { code?: string }) => e.code === 'FILE_TYPE', 'SVG is refused: it can carry scripts');
  assert.throws(() => save(Buffer.from('just text, named .png')), (e: { code?: string }) => e.code === 'FILE_TYPE');
  assert.throws(() => save(PDF), (e: { code?: string }) => e.code === 'FILE_TYPE', 'a PDF where only images are allowed');
  assert.equal(save(PDF, ['application/pdf']).mime, 'application/pdf');
  const saved = save(PNG_1x1);
  assert.equal(saved.mime, 'image/png');
  assert.equal(saved.name, 'my-photo-.png');
  assert.match(saved.sha256 ?? '', /^[0-9a-f]{64}$/);
  const row = h.db.get<{ storage_path: string; ref_type: string; ref_id: string }>('SELECT storage_path, ref_type, ref_id FROM file_metadata WHERE id = ?', [saved.id])!;
  assert.equal(row.ref_type, 'user');
  assert.ok(fs.existsSync(path.join(privateDir, row.storage_path)), 'stored under PRIVATE_FILES_DIR');
  assert.ok(!path.isAbsolute(row.storage_path), 'the database keeps a relative path, never a public URL');

  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const other = await signedIn(DEMO.member2, DEMO_PASSWORDS.member);
  const coach = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const coach2 = await signedIn(DEMO.coach2, DEMO_PASSWORDS.coach);
  const anon = client(h.app);
  assert.equal((await anon.post(`/api/files/${saved.id}/token`)).status, 401);
  assert.equal((await other.post(`/api/files/${saved.id}/token`)).status, 404, 'another member cannot even confirm the file exists');
  assert.equal((await coach2.post(`/api/files/${saved.id}/token`)).status, 403, 'a coach who is not assigned');
  const t = await member.post(`/api/files/${saved.id}/token`);
  assert.equal(t.status, 200, JSON.stringify(t.json));
  assert.equal(t.json.expiresInSeconds, 300);
  const dl = await h.app.inject({ method: 'GET', url: t.json.url as string });
  assert.equal(dl.statusCode, 200);
  assert.equal(dl.headers['content-type'], 'image/png');
  assert.match(String(dl.headers['cache-control']), /no-store/);
  assert.equal(dl.headers['x-content-type-options'], 'nosniff');
  assert.deepEqual(dl.rawPayload, PNG_1x1, 'the stored bytes, unchanged');
  assert.ok(h.db.get("SELECT 1 FROM audit_events WHERE action = 'file.token' AND target_id = ?", [saved.id]), 'every token is audited');

  // the coach, while the member shares; the member withdraws between issue and download: the download is refused
  const ct = await coach.post(`/api/files/${saved.id}/token`);
  assert.equal(ct.status, 200);
  assert.equal((await member.post('/api/me/consents', { kind: 'coach_sharing', version: '2026-10-17', granted: false })).status, 200);
  const late = await anon.get(ct.json.url as string);
  assert.equal(late.status, 403);
  assert.equal(late.json.error?.code, 'NOT_SHARED', 'the resolver runs again when the token is redeemed');
  assert.equal((await coach.post(`/api/files/${saved.id}/token`)).json.error?.code, 'NOT_SHARED');
  await member.post('/api/me/consents', { kind: 'coach_sharing', version: '2026-10-17', granted: true });

  // expiry, tampering, and the two token families never cross
  const token = (t.json.token as string);
  assert.equal(files.resolveFileToken(h.ctx, token).file.id, saved.id);
  const in4 = new Date(Date.now() + 4 * 60_000).toISOString(), in6 = new Date(Date.now() + 6 * 60_000).toISOString();
  assert.equal(files.resolveFileToken(at(in4), token).file.id, saved.id, 'still valid inside five minutes');
  assert.throws(() => files.resolveFileToken(at(in6), token), (e: { code?: string }) => e.code === 'LINK_EXPIRED', 'expired after five minutes');
  const [body, sig] = [token.slice(0, token.lastIndexOf('.')), token.slice(token.lastIndexOf('.') + 1)];
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), exp: 9_999_999_999 })).toString('base64url') + '.' + sig;
  assert.equal((await anon.get(`/api/files/download?token=${encodeURIComponent(forged)}`)).json.error?.code, 'LINK_EXPIRED', 'a changed body breaks the signature');
  const reportStyle = signToken(h.config.TOKEN_SECRET, { r: saved.id, u: memberId }, 300);
  assert.equal((await anon.get(`/api/files/download?token=${encodeURIComponent(reportStyle)}`)).json.error?.code, 'LINK_EXPIRED', 'a report token never opens a file');
  assert.equal((await anon.get(`/api/reports/file?token=${encodeURIComponent(token)}`)).json.error?.code, 'LINK_EXPIRED', 'a file token never opens a report');

  // a suspended holder's token stops working; a removed file is gone with its bytes
  const t2 = await member.post(`/api/files/${saved.id}/token`);
  const state = stateOf(memberId);
  h.db.run("UPDATE users SET state = 'suspended' WHERE id = ?", [memberId]);
  assert.equal((await anon.get(t2.json.url as string)).json.error?.code, 'LINK_EXPIRED');
  h.db.run('UPDATE users SET state = ? WHERE id = ?', [state, memberId]);
  files.removePrivateFile(mctx, saved.id, 'test: the member deleted it');
  assert.ok(!fs.existsSync(path.join(privateDir, row.storage_path)), 'the bytes are removed');
  assert.equal((await anon.get(t2.json.url as string)).status, 404);
  assert.equal((await member.post(`/api/files/${saved.id}/token`)).status, 404);

  // a kind no module declared opens for its owner only
  const plain = files.savePrivateFile(mctx, { ownerId: memberId, kind: 'foundation_unclaimed', buffer: PNG_1x1, allowedMimes: ['image/png'], maxBytes: 4096 });
  assert.equal((await member.post(`/api/files/${plain.id}/token`)).status, 200);
  assert.equal((await coach.post(`/api/files/${plain.id}/token`)).status, 404);
  const owner = await signedIn(DEMO.owner, DEMO_PASSWORDS.owner, true);
  assert.equal((await owner.post(`/api/files/${plain.id}/token`)).status, 404, 'administrators are not admitted unless the kind says so');
});

test('production refuses local storage for private files and for enabling a module that stores them', async () => {
  const prodCtx = { ...h.ctx, config: { ...h.ctx.config, isProduction: true } } as Ctx;
  assert.match(files.storageRequirement(prodCtx) ?? '', /STORAGE_PROVIDER/);
  assert.throws(() => files.savePrivateFile(prodCtx, { ownerId: null, kind: 'foundation_probe', buffer: PNG_1x1, allowedMimes: ['image/png'], maxBytes: 4096 }), (e: { code?: string }) => e.code === 'STORAGE_NOT_CONFIGURED');
  assert.equal(files.storageRequirement(h.ctx), null, 'demo mode stores on local disk');
  // the modules that declare a file kind (fileAccess) store private files: with them on, production refuses to start
  // and names every one of them; with their flags off it starts
  const storing = MODULES.filter((m) => Object.keys(m.fileAccess ?? {}).length > 0);
  assert.ok(storing.length > 0, 'some module stores private files');
  for (const m of storing) assert.equal(files.storesPrivateFiles(featureOf(m)), true, m.key);
  assert.throws(() => files.assertStorageReady(prodCtx), (e: Error) => /^production refuses local storage for private files while .+ (is|are) enabled\. Missing: .*STORAGE_PROVIDER/.test(e.message) && storing.every((m) => new RegExp(`while (\\w+, )*${m.key}(, \\w+)* (is|are) enabled`).test(e.message)), 'names every enabled module that stores private files');
  const storingFlags = storing.map(featureOf);
  const flagState = new Map(storingFlags.map((k) => [k, isEnabled(h.ctx, k)]));
  try {
    for (const k of storingFlags) h.db.run('UPDATE feature_flags SET enabled = 0 WHERE key = ?', [k]);
    assert.doesNotThrow(() => files.assertStorageReady(prodCtx), 'with every module that stores private files switched off, production starts on local disk');
  } finally {
    for (const [k, on] of flagState) h.db.run('UPDATE feature_flags SET enabled = ? WHERE key = ?', [on ? 1 : 0, k]);
  }
  // once a module declares a file kind, production refuses to start with it enabled, and refuses to enable it
  const original = habits.fileAccess;
  habits.fileAccess = { foundation_probe_photo: () => false };
  try {
    assert.equal(files.storesPrivateFiles('habits'), true);
    assert.throws(() => files.assertStorageReady(prodCtx), /production refuses local storage for private files while (\w+, )*habits(, \w+)* (is|are) enabled/);
    const ownerProd = { ...as(DEMO.owner), config: prodCtx.config } as Ctx;
    setFlag(ownerProd, 'habits', { enabled: false }, 'test: off in production');
    assert.throws(() => setFlag(ownerProd, 'habits', { enabled: true }, 'test: try to enable'), (e: { details?: { code?: string; missing?: string } }) => e.details?.code === 'STORAGE_NOT_CONFIGURED' && /STORAGE_PROVIDER/.test(e.details.missing ?? ''));
    assert.equal(isEnabled(h.ctx, 'habits'), false);
    setFlag(as(DEMO.owner), 'habits', { enabled: true }, 'test: on again in demo');
  } finally {
    habits.fileAccess = original;
  }
});

test('reminders: sent through notify, idempotent, skipped when reminders are off, in-app only inside quiet hours', async () => {
  const memberId = userId(h.ctx, DEMO.member2);
  const c = await signedIn(DEMO.member2, DEMO_PASSWORDS.member);
  // 2026-11-02 17:00 UTC is 22:30 in India; 03:00 UTC the next day is 08:30
  const evening = '2026-11-02T17:00:00.000Z', morning = '2026-11-03T03:00:00.000Z';
  const base = { userId: memberId, refType: 'foundation_probe', category: 'habit_reminder', title: 'Evening walk', body: 'Ten minutes outside.' };
  const id = reminders.schedule(h.ctx, { ...base, refId: 'r1', dueAt: evening });
  assert.equal(reminders.schedule(h.ctx, { ...base, refId: 'r1', dueAt: evening, title: 'Evening walk (moved wording)' }), id, 'one row per person, record and time');
  assert.deepEqual(reminders.dispatchDue(at('2026-11-02T16:59:00.000Z')), { sent: 0, inAppOnly: 0, skipped: 0 }, 'nothing before it is due');

  let out = reminders.dispatchDue(at(evening));
  assert.equal(out.sent, 1);
  const r1 = h.db.get<{ status: string; notification_id: string }>('SELECT status, notification_id FROM reminders WHERE id = ?', [id])!;
  assert.equal(r1.status, 'sent');
  const n = h.db.get<{ title: string; category: string }>('SELECT title, category FROM notifications WHERE id = ?', [r1.notification_id])!;
  assert.deepEqual({ ...n }, { title: 'Evening walk (moved wording)', category: 'habit_reminder' });
  const channels = h.db.all<{ channel: string; status: string }>('SELECT channel, status FROM delivery_attempts WHERE notification_id = ? ORDER BY channel', [r1.notification_id]).map((x) => ({ ...x }));
  assert.deepEqual(channels, [{ channel: 'in_app', status: 'sent' }, { channel: 'push', status: 'logged' }], 'in-app and push (logged, never claimed delivered), never email by default');
  const push = h.db.get<{ body: string }>("SELECT body FROM outbox_messages WHERE notification_id = ? AND channel = 'push'", [r1.notification_id])!;
  assert.equal(push.body, 'Open the app for the detail.', 'lock-screen detail is off by default');
  assert.equal(reminders.schedule(h.ctx, { ...base, refId: 'r1', dueAt: evening }), id);
  assert.equal(reminders.dispatchDue(at(evening)).sent, 0, 'a sent reminder is never sent again');

  // quiet hours 22:00 to 07:00 (crossing midnight)
  assert.equal((await c.put('/api/notification-preferences/quiet-hours', { startMinute: 1320, endMinute: null })).status, 400, 'a start needs an end');
  const q = await c.put('/api/notification-preferences/quiet-hours', { startMinute: 1320, endMinute: 420 });
  assert.equal(q.status, 200, JSON.stringify(q.json));
  assert.equal(q.json.quiet_start_minute, 1320);
  assert.equal(reminders.inQuietHours(h.ctx, memberId, evening), true);
  assert.equal(reminders.inQuietHours(h.ctx, memberId, morning), false);
  const quietId = reminders.schedule(h.ctx, { ...base, refId: 'r2', dueAt: evening });
  out = reminders.dispatchDue(at(evening));
  assert.deepEqual(out, { sent: 0, inAppOnly: 1, skipped: 0 });
  const quietRow = h.db.get<{ notification_id: string }>('SELECT notification_id FROM reminders WHERE id = ?', [quietId])!;
  assert.deepEqual(h.db.all<{ channel: string }>('SELECT channel FROM delivery_attempts WHERE notification_id = ?', [quietRow.notification_id]).map((x) => x.channel), ['in_app'], 'nothing that buzzes inside quiet hours');
  const pushOnly = reminders.schedule(h.ctx, { ...base, refId: 'r3', dueAt: evening, channels: ['push'] });
  assert.deepEqual(reminders.dispatchDue(at(evening)), { sent: 0, inAppOnly: 0, skipped: 1 }, 'a push-only reminder inside quiet hours is skipped');
  assert.equal(h.db.get<{ status: string }>('SELECT status FROM reminders WHERE id = ?', [pushOnly])!.status, 'skipped');
  reminders.schedule(h.ctx, { ...base, refId: 'r4', dueAt: morning });
  assert.equal(reminders.dispatchDue(at(morning)).sent, 1, 'after quiet hours end, push again');

  // the reminders preference off: skipped, nothing written
  await c.patch('/api/notification-preferences', { reminders: false });
  const before = h.db.get<{ n: number }>('SELECT COUNT(*) n FROM notifications WHERE user_id = ?', [memberId])!.n;
  const offId = reminders.schedule(h.ctx, { ...base, refId: 'r5', dueAt: morning });
  assert.deepEqual(reminders.dispatchDue(at(morning)), { sent: 0, inAppOnly: 0, skipped: 1 });
  assert.equal(h.db.get<{ status: string }>('SELECT status FROM reminders WHERE id = ?', [offId])!.status, 'skipped');
  assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM notifications WHERE user_id = ?', [memberId])!.n, before);
  await c.patch('/api/notification-preferences', { reminders: true });
  await c.put('/api/notification-preferences/quiet-hours', { startMinute: null, endMinute: null });

  // cancel and replace: one reminder per record
  const later = '2026-11-04T03:00:00.000Z', moved = '2026-11-05T03:00:00.000Z';
  reminders.schedule(h.ctx, { ...base, refId: 'b1', dueAt: later });
  reminders.replace(h.ctx, { ...base, refId: 'b1', dueAt: moved });
  assert.deepEqual(reminders.listForRef(h.ctx, 'foundation_probe', 'b1').map((r) => [r.due_at, r.status]), [[later, 'cancelled'], [moved, 'queued']]);
  assert.equal(reminders.cancel(h.ctx, { refType: 'foundation_probe', refId: 'b1' }), 1);
  assert.equal(reminders.dispatchDue(at(moved)).sent, 0, 'a cancelled reminder is not sent');

  // a suspended account gets nothing
  reminders.schedule(h.ctx, { ...base, refId: 'r6', dueAt: moved });
  const state = stateOf(memberId);
  h.db.run("UPDATE users SET state = 'suspended' WHERE id = ?", [memberId]);
  assert.deepEqual(reminders.dispatchDue(at(moved)), { sent: 0, inAppOnly: 0, skipped: 1 });
  h.db.run('UPDATE users SET state = ? WHERE id = ?', [state, memberId]);

  // the quiet window arithmetic
  assert.equal(reminders.withinQuiet(1350, 1320, 420), true);
  assert.equal(reminders.withinQuiet(300, 1320, 420), true);
  assert.equal(reminders.withinQuiet(420, 1320, 420), false, 'the end minute is outside');
  assert.equal(reminders.withinQuiet(600, 540, 1020), true);
  assert.equal(reminders.withinQuiet(600, 600, 600), false, 'equal ends mean none');
  assert.equal(reminders.withinQuiet(600, null, null), false);
  assert.equal(reminders.localMinute('2026-11-02T17:00:00.000Z', 'Asia/Kolkata'), 22 * 60 + 30);
  assert.equal(reminders.localMinute('2026-11-02T17:00:00.000Z', 'Not/AZone'), 22 * 60 + 30, 'an unknown zone falls back to India');
});

test('the reminders job leaves no jobs_log row for runs with nothing due; module jobs run only while their flag is on', async () => {
  const defs = jobDefinitions(h.services.vendor, { safetyNetMinutes: 30, catalogueHours: 6 });
  const job = defs.find((d) => d.name === 'reminders');
  assert.ok(job);
  assert.equal(job!.everyMs, 60_000);
  const runner = new JobRunner(h.ctx, [job!]);
  const count = () => h.db.get<{ n: number }>("SELECT COUNT(*) n FROM jobs_log WHERE job = 'reminders'")!.n;
  const before = count();
  await runner.runOne(job!);
  assert.equal(count(), before, 'an idle run is not logged');
  reminders.schedule(h.ctx, { userId: userId(h.ctx, DEMO.member2), refType: 'foundation_probe', refId: 'job1', dueAt: new Date(Date.now() - 60_000).toISOString(), category: 'habit_reminder', title: 'Due now', body: 'Probe.' });
  await runner.runOne(job!);
  assert.equal(count(), before + 1, 'a run that sent something is logged');

  const originalJobs = habits.jobs;
  let ran = 0;
  habits.jobs = [{ name: 'probe', everyMs: 60_000, run: () => { ran++; return { done: 1 }; } }];
  try {
    const [mj] = moduleJobs();
    assert.equal(mj!.name, 'habits.probe');
    const r = new JobRunner(h.ctx, [mj!]);
    await r.runOne(mj!);
    assert.equal(ran, 1);
    h.db.run("UPDATE feature_flags SET enabled = 0 WHERE key = 'habits'");
    const logged = h.db.get<{ n: number }>("SELECT COUNT(*) n FROM jobs_log WHERE job = 'habits.probe'")!.n;
    await r.runOne(mj!);
    assert.equal(ran, 1, 'skipped while the flag is off');
    assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM jobs_log WHERE job = 'habits.probe'")!.n, logged, 'and the skipped run is not logged');
  } finally {
    habits.jobs = originalJobs;
    h.db.run("UPDATE feature_flags SET enabled = 1 WHERE key = 'habits'");
  }
});

test('module event handlers join the outbox and run only while the module is on', async () => {
  const seen: string[] = [];
  const original = habits.events;
  habits.events = { FoundationProbe: [(_ctx, e) => { seen.push(e.aggregate_id); }] };
  try {
    emit(h.ctx, 'FoundationProbe', { type: 'probe', id: 'on' });
    await processPending(h.ctx);
    assert.deepEqual(seen, ['on']);
    h.db.run("UPDATE feature_flags SET enabled = 0 WHERE key = 'habits'");
    emit(h.ctx, 'FoundationProbe', { type: 'probe', id: 'off' });
    await processPending(h.ctx);
    assert.deepEqual(seen, ['on'], 'not called while the flag is off');
    assert.ok(h.db.get("SELECT processed_at FROM domain_events WHERE type = 'FoundationProbe' AND aggregate_id = 'off' AND processed_at IS NOT NULL"), 'the event is still processed');
  } finally {
    habits.events = original;
    h.db.run("UPDATE feature_flags SET enabled = 1 WHERE key = 'habits'");
  }
});

test('push devices: stored for their owner, the token never comes back, one owner per token', async () => {
  const a = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const b = await signedIn(DEMO.member2, DEMO_PASSWORDS.member);
  const token = 'ExponentPushToken[foundation-probe-0001]';
  assert.equal((await a.post('/api/me/devices', { platform: 'ios', token: 'short' })).status, 400);
  assert.equal((await a.post('/api/me/devices', { platform: 'windows', token })).status, 400);
  const reg = await a.post('/api/me/devices', { platform: 'ios', token, appVersion: '0.1.0' });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  assert.equal(reg.json.delivery, 'logged');
  assert.ok(!JSON.stringify(reg.json).includes(token), 'the token is not echoed');
  assert.equal((await a.post('/api/me/devices', { platform: 'ios', token })).json.id, reg.json.id, 'registering again refreshes the same device');
  assert.equal((await b.del(`/api/me/devices/${reg.json.id}`)).status, 404, 'only its owner removes a device');
  const moved = await b.post('/api/me/devices', { platform: 'android', token });
  assert.equal(moved.json.id, reg.json.id, 'a token another account held moves to the one that registers it');
  assert.equal(h.db.get<{ user_id: string }>('SELECT user_id FROM push_devices WHERE id = ?', [reg.json.id as string])!.user_id, userId(h.ctx, DEMO.member2));
  assert.equal((await a.del(`/api/me/devices/${reg.json.id}`)).status, 404);
  const gone = await b.del(`/api/me/devices/${reg.json.id}`);
  assert.equal(gone.json.revoked, true);
  assert.ok(h.db.get("SELECT 1 FROM audit_events WHERE action = 'push_device.revoke' AND target_id = ?", [reg.json.id as string]));
});

test('the integrations registry names what is missing and never shows a value; LabStack detail needs labstack.manage', async () => {
  const owner = await signedIn(DEMO.owner, DEMO_PASSWORDS.owner, true);
  const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin, true);
  const coach = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  assert.equal((await coach.get('/api/admin/integrations')).status, 403);
  const r = await admin.get('/api/admin/integrations');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const items = r.json.items as Array<{ key: string; status?: string; missing?: string[]; restricted?: boolean; variables?: string[] }>;
  assert.deepEqual(items.map((i) => i.key), ['payments', 'lab', 'email', 'sms', 'push', 'meetings', 'calendar', 'video', 'ai', 'storage', 'identity']);
  for (const k of ['meetings', 'calendar', 'video', 'ai']) {
    const i = items.find((x) => x.key === k)!;
    assert.equal(i.status, 'pending_configuration', k);
    assert.ok(i.missing!.length && i.missing![0]!.includes('accepts only "none"'), `${k} names the missing requirement`);
  }
  assert.equal(items.find((x) => x.key === 'payments')!.status, 'simulated');
  assert.equal(items.find((x) => x.key === 'storage')!.status, 'local');
  assert.deepEqual(items.find((x) => x.key === 'lab'), { key: 'lab', label: 'Laboratory (LabStack)', restricted: true, managedUnder: '/admin/integrations/labstack', permission: 'labstack.manage' }, 'administrators without labstack.manage are pointed at the LabStack page');
  const full = await owner.get('/api/admin/integrations');
  const lab = (full.json.items as Array<{ key: string; variables?: string[]; restricted?: boolean }>).find((x) => x.key === 'lab')!;
  assert.ok(!lab.restricted && lab.variables!.includes('LABSTACK_API_KEY'));
  const text = JSON.stringify(full.json);
  for (const secret of [h.config.SESSION_SECRET, h.config.TOKEN_SECRET, h.config.PAYMENT_WEBHOOK_SECRET, h.config.LABSTACK_WEBHOOK_VALUE]) assert.ok(!text.includes(secret), 'no secret value is ever shown');
});

test('module settings: declared, validated, settings.manage with a reason, audited; module permissions and their defaults', async () => {
  const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin, true);
  const coach = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  assert.equal((await coach.get('/api/admin/module-settings')).status, 403);
  const list = await admin.get('/api/admin/module-settings');
  assert.equal(list.status, 200);
  const values = Object.fromEntries((list.json.items as Array<{ key: string; value: unknown }>).map((i) => [i.key, i.value]));
  assert.deepEqual(values, { habit_followup_missed_days: null, progress_photo_retention_days: null, billing_entity: null, gst_rate_bp: 1800, ai_draft_retention_days: null }, 'nothing is decided for the owner');
  assert.equal((await admin.patch('/api/admin/module-settings', { key: 'habit_followup_missed_days', value: 3 })).status, 400, 'a reason is required');
  assert.equal((await admin.patch('/api/admin/module-settings', { key: 'habit_followup_missed_days', value: 0, reason: 'test' })).json.error?.code, 'SETTING_INVALID');
  assert.equal((await admin.patch('/api/admin/module-settings', { key: 'gst_rate_bp', value: null, reason: 'test' })).json.error?.code, 'SETTING_INVALID', 'the GST rate cannot be emptied');
  assert.equal((await admin.patch('/api/admin/module-settings', { key: 'billing_entity', value: { gstin: '29ABCDE1234F1Z5' }, reason: 'test' })).json.error?.code, 'SETTING_INVALID', 'the legal name is required');
  assert.equal((await admin.patch('/api/admin/module-settings', { key: 'billing_entity', value: { legalName: 'Sample Entity (test)', gstin: 'not-a-gstin' }, reason: 'test' })).json.error?.code, 'SETTING_INVALID');
  assert.equal((await admin.patch('/api/admin/module-settings', { key: 'review_sla_hours', value: 1, reason: 'test' })).status, 400, 'only module settings here');
  const ok = await admin.patch('/api/admin/module-settings', { key: 'habit_followup_missed_days', value: 3, reason: 'test: three missed days' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.value, 3);
  assert.ok(h.db.get("SELECT 1 FROM audit_events WHERE action = 'settings.update' AND target_id = 'habit_followup_missed_days' AND reason = 'test: three missed days'"));
  assert.equal((await admin.patch('/api/admin/module-settings', { key: 'habit_followup_missed_days', value: null, reason: 'test: back to undecided' })).json.value, null);

  const perms = (await admin.get('/api/auth/me')).json.permissions as string[];
  for (const p of ['library.manage', 'learning.manage', 'sessions.manage', 'announcements.manage']) assert.ok(perms.includes(p), `administrators hold ${p} by default`);
  for (const p of ['imports.manage', 'ai.manage', 'modules.manage', 'labstack.manage']) assert.ok(!perms.includes(p), `${p} is not an administrator default`);
  assert.deepEqual([...permissionsFor(h.ctx, { id: userId(h.ctx, DEMO.owner), role: 'owner' })].sort(), [...PERMISSIONS, ...MODULE_PERMISSIONS].sort(), 'owners hold every permission');
  const owner = await signedIn(DEMO.owner, DEMO_PASSWORDS.owner, true);
  const users = await owner.get('/api/admin/users');
  assert.deepEqual((users.json.permissions as Array<{ key: string }>).map((p) => p.key), [...ALL_PERMISSIONS], 'the Users and permissions page lists every permission, the module ones included');
  assert.deepEqual((users.json.permissions as Array<{ key: string; module: boolean }>).filter((p) => p.module).map((p) => p.key), [...MODULE_PERMISSIONS], 'and marks the module ones');
});

test('shared vocabulary: consent kinds (reserved ones refused), progress sources, categories, task kinds, module keys, reference sequences', async () => {
  assert.deepEqual([...RESERVED_CONSENT_KINDS], ['progress_photos', 'ai_processing', 'community']);
  for (const k of RESERVED_CONSENT_KINDS) assert.ok((CONSENT_KINDS as readonly string[]).includes(k));
  assert.equal(consentSchema.safeParse({ kind: 'ai_processing', version: 'v', granted: true }).success, false, 'no screen records a reserved consent before counsel approves its wording');
  const m = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  assert.equal((await m.post('/api/me/consents', { kind: 'progress_photos', version: '2026-10-17', granted: true })).status, 400);
  assert.ok((PROGRESS_SOURCES as readonly string[]).includes('import'));
  assert.equal(PROGRESS_SOURCE_LABELS.import, 'Imported');
  for (const c of ['habit_reminder', 'nutrition', 'workout', 'checkin', 'goal', 'session', 'session_reminder', 'refund', 'announcement', 'support', 'lab_followup', 'lab_preparation', 'learning']) assert.ok((NOTIFICATION_CATEGORIES as readonly string[]).includes(c), c);
  assert.ok((SUPPORT_TASK_KINDS as readonly string[]).includes('coach_follow_up'));
  assert.deepEqual(MODULES.map((x) => x.key), [...MODULE_KEYS]);
  assert.equal(nextReference(h.db, 'SUP'), 'SUP-1001');
  assert.equal(nextReference(h.db, 'CRN'), 'CRN-1001');
});

test('0008 rebuilds member_consents and progress_entries keeping every row, and seeds the legacy switches from settings.features', () => {
  const db = new Db(':memory:');
  try {
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    const older = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql') && f < '0008').sort();
    assert.equal(older.length, 7);
    for (const f of older) { db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')); db.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [f, 'test']); }
    const now = '2026-10-22T10:00:00.000Z';
    for (const [id, email] of [['usr_a', 'a@demo.bioptime.test'], ['usr_b', 'b@demo.bioptime.test']] as const) db.insert('users', { id, email, role: 'member', state: 'active', name: id, created_at: now, updated_at: now });
    const kinds = ['terms', 'privacy', 'health_data', 'coach_sharing', 'lab_consent', 'marketing', 'push'];
    kinds.forEach((kind, i) => { db.insert('member_consents', { id: `cns_${i}a`, user_id: 'usr_a', kind, version: '2026-10-17', granted: i % 2, ip: i % 3 ? '127.0.0.1' : null, at: `2026-10-0${1 + (i % 9)}T00:00:00.000Z` }); db.insert('member_consents', { id: `cns_${i}b`, user_id: 'usr_b', kind, version: 'web-2026-10-17', granted: 1, ip: null, at: now }); });
    ['member', 'coach', 'device'].forEach((source, i) => db.insert('progress_entries', { id: `prg_${i}`, member_id: 'usr_a', metric: 'weight_kg', value: 70.5 + i, unit: 'kg', at: now, source, note: i ? `note ${i}` : null, created_by: i ? 'usr_b' : null, created_at: now }));
    db.insert('settings', { key: 'features', value: JSON.stringify({ messaging: true, bespoke: false, progressPhotos: true }), updated_at: now });
    const consentsBefore = db.all('SELECT * FROM member_consents ORDER BY id');
    const progressBefore = db.all('SELECT * FROM progress_entries ORDER BY id');

    const applied = db.migrate();
    assert.equal(applied[0], '0008_foundation.sql');
    assert.deepEqual(db.all('SELECT * FROM member_consents ORDER BY id'), consentsBefore, 'every consent row, unchanged');
    assert.deepEqual(db.all('SELECT * FROM progress_entries ORDER BY id'), progressBefore, 'every progress row, unchanged');
    assert.ok(db.all<{ name: string }>("PRAGMA index_list('member_consents')").some((i) => i.name === 'member_consents_user'));
    assert.ok(db.all<{ name: string }>("PRAGMA index_list('progress_entries')").some((i) => i.name === 'progress_member_metric'));
    db.insert('member_consents', { id: 'cns_new', user_id: 'usr_a', kind: 'progress_photos', version: 'v', granted: 1, at: now });
    db.insert('progress_entries', { id: 'prg_imp', member_id: 'usr_a', metric: 'weight_kg', value: 70, unit: 'kg', at: now, source: 'import', created_at: now });
    assert.throws(() => db.insert('member_consents', { id: 'cns_bad', user_id: 'usr_a', kind: 'bogus', version: 'v', granted: 1, at: now }), /CHECK/);
    assert.throws(() => db.insert('progress_entries', { id: 'prg_bad', member_id: 'usr_a', metric: 'weight_kg', value: 70, unit: 'kg', at: now, source: 'guess', created_at: now }), /CHECK/);
    assert.deepEqual(db.all('PRAGMA foreign_key_check'), []);
    const flags = Object.fromEntries(db.all<{ key: string; enabled: number }>('SELECT key, enabled FROM feature_flags').map((f) => [f.key, f.enabled]));
    assert.equal(flags.bespoke, 0, 'a stored switch keeps its value');
    assert.equal(flags.progressPhotos, 1);
    assert.equal(flags.selfBooking, 1, 'an absent switch takes its default');
    assert.equal(flags.messaging, 0, 'messaging is the M9 module flag: off, like every module');
    for (const k of MODULE_KEYS) assert.equal(flags[k], 0, `${k} starts off`);
    assert.deepEqual(db.all<{ name: string; value: number }>("SELECT name, value FROM sequences WHERE name IN ('SUP','CRN') ORDER BY name").map((x) => ({ ...x })), [{ name: 'CRN', value: 1000 }, { name: 'SUP', value: 1000 }]);
    const cols = (t: string) => db.all<{ name: string }>(`PRAGMA table_info('${t}')`).map((c) => c.name);
    assert.ok(['quiet_start_minute', 'quiet_end_minute'].every((c) => cols('notification_preferences').includes(c)));
    assert.ok(['sha256', 'ref_type', 'ref_id'].every((c) => cols('file_metadata').includes(c)));
    assert.ok(cols('reminders').includes('notification_id') && cols('push_devices').includes('last_seen_at'));
  } finally {
    db.close();
  }
});
