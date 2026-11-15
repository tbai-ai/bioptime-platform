/* The open preview (owner decision, 30 October 2026: "remove the login for now from the app and the website"), a
   reversible demo-only mode (api/auth/openPreview.ts): with BIOPTIME_MODE=demo and OPEN_PREVIEW=1,
   POST /auth/open-preview opens the fixed account of each workspace without a password, answering exactly as
   /auth/login does, audited; the administrative actions that could lock the owner out or outlast the preview answer
   403 OPEN_PREVIEW_RESTRICTED and everything else works. With OPEN_PREVIEW unset nothing of it exists; any other mode
   with OPEN_PREVIEW=1 refuses to start. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId, type Client } from '../helpers.js';
import { buildApp } from '../../src/http/app.js';
import { loadConfig, API_ROOT } from '../../src/config.js';
import { OPEN_PREVIEW_ACCOUNTS, OPEN_PREVIEW_RESTRICTED } from '../../src/auth/openPreview.js';
import { todayIst } from '../../src/domain/workouts.js';

type App = Awaited<ReturnType<typeof makeApp>>;
let off: App;
let on: App | undefined;
before(async () => { off = await makeApp(); });
after(async () => { for (const h of [off, on]) { if (h) { await h.app.close(); h.db.close(); } } });
const onApp = async () => (on ??= await makeApp({ env: { OPEN_PREVIEW: '1' } }));

const WORKSPACES = ['member', 'coach', 'admin'] as const;
const PRIYA = OPEN_PREVIEW_ACCOUNTS.member, ASHA = OPEN_PREVIEW_ACCOUNTS.coach, ROHAN = OPEN_PREVIEW_ACCOUNTS.admin;
const AVINASH = 'avinash@demo.bioptime.test', ANANYA = DEMO.member, RAHUL = DEMO.coach2;
const keys = (o: unknown) => Object.keys((o ?? {}) as object).sort();
const restricted = (r: { status: number; json: { error?: { code: string; message: string } } }, label: string) => {
  assert.equal(r.status, 403, `${label}: ${JSON.stringify(r.json)}`);
  assert.equal(r.json.error?.code, 'OPEN_PREVIEW_RESTRICTED', label);
  assert.ok((r.json.error?.message ?? '').length > 20, `${label}: a plain message`);
  assert.doesNotMatch(r.json.error!.message, /\bdemo\b|\bsample\b/i, `${label}: no demo label in the message`);
};
/** A client signed in through the open preview (web cookie). */
const opened = async (h: App, workspace: (typeof WORKSPACES)[number]) => {
  const c = client(h.app);
  const r = await c.post('/api/auth/open-preview', { workspace });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return c;
};

/* ---------------- mode off: exactly as today ---------------- */

test('off (OPEN_PREVIEW unset): the route answers 404 NOT_FOUND, /public/config has no openPreview, the API reference names neither', async () => {
  assert.equal(off.config.openPreview, false);
  const c = client(off.app);
  for (const headers of [{}, { 'x-bioptime-client': 'mobile' }] as Array<Record<string, string>>) {
    const r = await c.post('/api/auth/open-preview', { workspace: 'member' }, headers);
    assert.deepEqual([r.status, r.json.error?.code], [404, 'NOT_FOUND']);
    assert.equal(r.headers['set-cookie'], undefined, 'no cookie');
  }
  const cfg = await c.get('/api/public/config');
  assert.equal(cfg.status, 200);
  assert.ok(!('openPreview' in cfg.json), 'openPreview is absent, not false');
  // the reference is read before any app with the preview on is built (the route registry is per process)
  const spec = (await c.get('/api/openapi.json')).json as { paths: Record<string, Record<string, { responses: Record<string, { description: string }> }>> };
  assert.equal(spec.paths['/auth/open-preview'], undefined);
  assert.doesNotMatch(JSON.stringify(spec), /OPEN_PREVIEW/);
  assert.equal(c.cookie, '', 'nothing signed in');
});

test('off: the actions the preview restricts work as before (password change, a preview account state change, staff provisioning)', async () => {
  const p = client(off.app);
  await p.login(PRIYA, DEMO_PASSWORDS.member);
  const ch = await p.post('/api/auth/password/change', { currentPassword: DEMO_PASSWORDS.member, newPassword: DEMO_PASSWORDS.member });
  assert.equal(ch.status, 200, JSON.stringify(ch.json));
  const o = client(off.app);
  await o.login(DEMO.owner, DEMO_PASSWORDS.owner, 'dashboard', true);
  const priya = userId(off.ctx, PRIYA);
  assert.equal((await o.patch(`/api/admin/members/${priya}/state`, { state: 'suspended', reason: 'test: off mode' })).status, 200);
  assert.equal((await o.patch(`/api/admin/members/${priya}/state`, { state: 'active', reason: 'test: off mode' })).status, 200);
  const made = await o.post('/api/admin/admins', { email: 'ops2@demo.bioptime.test', name: 'Ops Two', password: 'A-strong-pass-2026!', role: 'admin' });
  assert.equal(made.status, 201, JSON.stringify(made.json));
});

/* ---------------- configuration ---------------- */

test('config: OPEN_PREVIEW=1 is effective in demo mode only; production and development refuse to start; unknown values refuse', () => {
  const base = { DATABASE_PATH: ':memory:' };
  assert.equal(loadConfig({ ...base, BIOPTIME_MODE: 'demo', OPEN_PREVIEW: '1' }).openPreview, true);
  for (const v of ['', '0']) assert.equal(loadConfig({ ...base, BIOPTIME_MODE: 'demo', OPEN_PREVIEW: v }).openPreview, false, `OPEN_PREVIEW=${JSON.stringify(v)} is off`);
  assert.equal(loadConfig({ ...base, BIOPTIME_MODE: 'demo' }).openPreview, false);
  for (const mode of ['production', 'development'] as const) {
    assert.throws(() => loadConfig({ ...base, BIOPTIME_MODE: mode, OPEN_PREVIEW: '1' }), (e: Error) => /OPEN_PREVIEW=1/.test(e.message) && e.message.includes(`BIOPTIME_MODE=${mode}`) && /demo mode only/.test(e.message), mode);
  }
  assert.equal(loadConfig({ ...base, BIOPTIME_MODE: 'development' }).openPreview, false, 'development without OPEN_PREVIEW starts as today');
  assert.throws(() => loadConfig({ ...base, BIOPTIME_MODE: 'demo', OPEN_PREVIEW: 'true' }), /OPEN_PREVIEW=true is not understood/);
  assert.throws(() => loadConfig({ ...base, BIOPTIME_MODE: 'demo', OPEN_PREVIEW: '1', LABSTACK_MODE: 'live', LABSTACK_API_KEY: 'k', LABSTACK_WEBHOOK_VALUE: 'agreed-value' }), /refuses LABSTACK_MODE=live/);
});

test('OPEN_PREVIEW=1 with the production configuration: the server process refuses to start and never listens', async () => {
  const port = 4791;
  const env: Record<string, string> = { ...process.env as Record<string, string>, BIOPTIME_MODE: 'production', OPEN_PREVIEW: '1', PORT: String(port), HOST: '127.0.0.1', DATABASE_PATH: ':memory:', JOBS_ENABLED: 'false', PUBLIC_ORIGIN: 'https://bioptime.example' };
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], { cwd: API_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += String(d); });
  child.stderr.on('data', (d) => { out += String(d); });
  const timer = setTimeout(() => child.kill('SIGKILL'), 30_000); // only the process this test started
  const code = await new Promise<number | null>((resolve) => child.on('exit', (c) => resolve(c)));
  clearTimeout(timer);
  assert.equal(code, 1, out);
  assert.match(out, /OPEN_PREVIEW=1 opens every workspace without signing in and is for demo mode only, but BIOPTIME_MODE=production/);
  assert.doesNotMatch(out, /website http/, 'it never reached listen');
  const listening = await new Promise<boolean>((resolve) => { const s = net.connect(port, '127.0.0.1'); s.on('connect', () => { s.destroy(); resolve(true); }); s.on('error', () => resolve(false)); });
  assert.equal(listening, false, 'nothing listens on the port');
});

/* ---------------- mode on ---------------- */

test('on: /public/config says openPreview: true; every restricted entry names a registered route', async () => {
  const h = await onApp();
  assert.equal(h.config.openPreview, true);
  const cfg = await client(h.app).get('/api/public/config');
  assert.equal(cfg.json.openPreview, true);
  for (const k of Object.keys(OPEN_PREVIEW_RESTRICTED)) {
    const [method, p] = k.split(' ') as ['POST', string];
    assert.ok(h.app.hasRoute({ method, url: `/api${p}` }), k);
  }
});

test('on, web: each workspace opens its own account with the /auth/login answer (session cookie, no token) and an audit row', async () => {
  const h = await onApp();
  // the /auth/login answer to compare with, per workspace
  const login = async (email: string, password: string, workspace: string, mfa = false) => {
    const c = client(h.app);
    const { totpCode } = await import('../../src/lib/crypto.js');
    const { DEMO_MFA_SECRET } = await import('../helpers.js');
    const r = await c.post('/api/auth/login', { email, password, workspace, ...(mfa ? { mfaCode: totpCode(DEMO_MFA_SECRET) } : {}) });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json;
  };
  const expected = {
    member: { email: PRIYA, role: 'member', login: await login(PRIYA, DEMO_PASSWORDS.member, 'member'), probe: '/api/me' },
    coach: { email: ASHA, role: 'coach', login: await login(ASHA, DEMO_PASSWORDS.coach, 'coach'), probe: '/api/coach/clients' },
    admin: { email: ROHAN, role: 'owner', login: await login(ROHAN, DEMO_PASSWORDS.rohan, 'admin', true), probe: '/api/admin/members' },
  };
  for (const ws of WORKSPACES) {
    const e = expected[ws];
    const c = client(h.app);
    const r = await c.post('/api/auth/open-preview', { workspace: ws });
    assert.equal(r.status, 200, `${ws}: ${JSON.stringify(r.json)}`);
    // exactly the login shape: same keys at every level, no token for the web
    assert.deepEqual(keys(r.json), keys(e.login), ws);
    assert.deepEqual(keys(r.json.user), keys(e.login.user), ws);
    assert.deepEqual(keys(r.json.session), keys(e.login.session), ws);
    assert.deepEqual(keys(r.json.session), ['expiresAt', 'kind']);
    const session = r.json.session as { kind: string; token?: string; expiresAt: string };
    assert.equal(session.kind, 'web');
    assert.equal(session.token, undefined);
    assert.deepEqual(r.json.permissions, e.login.permissions, `${ws}: the same permissions`);
    const user = r.json.user as { email: string; role: string; id: string };
    assert.deepEqual([user.email, user.role], [e.email, e.role]);
    const cookies = ([] as string[]).concat(r.headers['set-cookie'] ?? []);
    assert.ok(cookies.some((x) => x.startsWith('bp_session=') && /HttpOnly/i.test(x)), `${ws}: the session cookie`);
    assert.ok(cookies.some((x) => x.startsWith('bp_signed_in=1')), `${ws}: the signed-in hint`);
    // the cookie opens the workspace
    const me = await c.get('/api/auth/me');
    assert.equal((me.json.user as { email: string }).email, e.email);
    assert.equal((await c.get(e.probe)).status, 200, `${ws}: ${e.probe}`);
    // audited as auth.open_preview { workspace }
    const a = h.db.get<{ actor_id: string; actor_role: string; data: string; ip: string | null }>("SELECT actor_id, actor_role, data, ip FROM audit_events WHERE action = 'auth.open_preview' AND target_id = ? ORDER BY at DESC, rowid DESC LIMIT 1", [user.id]);
    assert.ok(a, `${ws}: audit row`);
    assert.equal(a.actor_id, user.id);
    assert.equal(a.actor_role, e.role);
    const data = JSON.parse(a.data) as { workspace: string; kind: string; sessionId: string };
    assert.deepEqual([data.workspace, data.kind], [ws, 'web']);
    assert.equal(h.db.get<{ user_id: string }>('SELECT user_id FROM sessions WHERE id = ?', [data.sessionId])?.user_id, user.id, 'the session id it opened (never the token)');
    assert.doesNotMatch(a.data, /token/i);
  }
});

test('on, mobile (X-Bioptime-Client: mobile): a bearer token as /auth/login gives, no cookie; the token opens the workspace', async () => {
  const h = await onApp();
  for (const [ws, probe] of [['member', '/api/me'], ['coach', '/api/coach/clients'], ['admin', '/api/admin/members']] as const) {
    const c = client(h.app);
    const r = await c.post('/api/auth/open-preview', { workspace: ws }, { 'x-bioptime-client': 'mobile' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const s = r.json.session as { token?: string; kind: string };
    assert.equal(s.kind, 'mobile');
    assert.equal(typeof s.token, 'string');
    assert.ok(s.token!.length >= 32);
    assert.deepEqual(keys(r.json.session), ['expiresAt', 'kind', 'token']);
    assert.equal(r.headers['set-cookie'], undefined, `${ws}: no cookie for the app`);
    c.useBearer(s.token!);
    assert.equal((await c.get(probe)).status, 200, `${ws}: ${probe}`);
    const a = h.db.get<{ data: string }>("SELECT data FROM audit_events WHERE action = 'auth.open_preview' AND target_id = ? ORDER BY at DESC, rowid DESC LIMIT 1", [(r.json.user as { id: string }).id])!;
    const data = JSON.parse(a.data) as { workspace: string; kind: string; sessionId: string };
    assert.deepEqual([data.workspace, data.kind], [ws, 'mobile']);
    assert.ok(!a.data.includes(s.token!), 'the token is never audited');
  }
});

test('on: no password or code is taken; an unknown workspace is a validation error; a session is the only thing handed out', async () => {
  const h = await onApp();
  const c = client(h.app);
  for (const body of [{}, { workspace: 'owner' }, { workspace: 'client' }, { workspace: 'dashboard' }]) {
    const r = await c.post('/api/auth/open-preview', body);
    assert.deepEqual([r.status, r.json.error?.code], [400, 'VALIDATION_FAILED'], JSON.stringify(body));
  }
  const r = await c.post('/api/auth/open-preview', { workspace: 'member' });
  assert.doesNotMatch(r.text, /Demo-|password|mfaCode|JBSWY3DP/i, 'no credential in the answer');
  // password sign-in keeps working beside it
  const p = client(h.app);
  assert.equal((await p.login(ANANYA, DEMO_PASSWORDS.member)).user.role, 'member');
});

test('on: the account must exist and be active (and admin must have its authenticator); otherwise 409 with a plain message', async () => {
  const h = await onApp();
  const c = client(h.app);
  const priya = userId(h.ctx, PRIYA), asha = userId(h.ctx, ASHA), rohan = userId(h.ctx, ROHAN);
  const unavailable = async (ws: string, pattern: RegExp) => {
    const r = await c.post('/api/auth/open-preview', { workspace: ws });
    assert.deepEqual([r.status, r.json.error?.code], [409, 'OPEN_PREVIEW_UNAVAILABLE'], JSON.stringify(r.json));
    assert.match(r.json.error!.message, pattern);
    assert.equal(r.headers['set-cookie'], undefined);
  };
  h.db.run("UPDATE users SET state = 'suspended' WHERE id = ?", [priya]);
  try { await unavailable('member', /client workspace cannot open on its own.*suspended, not active/); } finally { h.db.run("UPDATE users SET state = 'active' WHERE id = ?", [priya]); }
  h.db.run("UPDATE users SET email = 'asha.away@demo.bioptime.test' WHERE id = ?", [asha]);
  try { await unavailable('coach', /coach workspace cannot open on its own.*asha\.menon@demo\.bioptime\.test\) is not on this server/); } finally { h.db.run('UPDATE users SET email = ? WHERE id = ?', [ASHA, asha]); }
  h.db.run('UPDATE users SET mfa_enabled = 0 WHERE id = ?', [rohan]);
  try { await unavailable('admin', /admin workspace cannot open on its own.*no authenticator app set up/); } finally { h.db.run('UPDATE users SET mfa_enabled = 1 WHERE id = ?', [rohan]); }
  for (const ws of WORKSPACES) assert.equal((await c.post('/api/auth/open-preview', { workspace: ws })).status, 200, `${ws} opens again`);
});

test('on: restricted administrative actions answer 403 OPEN_PREVIEW_RESTRICTED and change nothing', async () => {
  const h = await onApp();
  const rohan = await opened(h, 'admin');
  const priya = userId(h.ctx, PRIYA), asha = userId(h.ctx, ASHA), avinash = userId(h.ctx, AVINASH), admin = userId(h.ctx, DEMO.admin);
  const before = (id: string) => h.db.get<{ role: string; state: string; mfa_enabled: number; password_hash: string }>('SELECT role, state, mfa_enabled, password_hash FROM users WHERE id = ?', [id])!;
  const everyone = [priya, asha, avinash, admin, userId(h.ctx, ROHAN), userId(h.ctx, DEMO.owner)];
  const snapshot = everyone.map(before);

  restricted(await rohan.post('/api/admin/admins', { email: 'new.owner@demo.bioptime.test', name: 'New Owner', password: 'A-strong-pass-2026!', role: 'owner' }), 'provision an owner');
  restricted(await rohan.post('/api/admin/admins', { email: 'new.admin@demo.bioptime.test', name: 'New Admin', password: 'A-strong-pass-2026!' }), 'provision an administrator');
  assert.equal(h.db.get("SELECT 1 FROM users WHERE email IN ('new.owner@demo.bioptime.test','new.admin@demo.bioptime.test')"), undefined, 'no account was made');
  restricted(await rohan.post(`/api/admin/users/${avinash}/role`, { role: 'admin', reason: 'test: demote the other owner' }), 'demote an owner');
  restricted(await rohan.post(`/api/admin/users/${admin}/role`, { role: 'owner', reason: 'test: promote' }), 'promote an administrator');
  restricted(await rohan.post(`/api/admin/users/${avinash}/mfa/reset`, { reason: 'test: reset the other owner' }), 'reset another owner’s 2FA');
  restricted(await rohan.patch(`/api/admin/members/${priya}/state`, { state: 'closed', reason: 'test: close the preview client' }), 'close the preview client');
  restricted(await rohan.patch(`/api/admin/members/${priya}/state`, { state: 'suspended', reason: 'test: suspend the preview client' }), 'suspend the preview client');
  restricted(await rohan.patch(`/api/admin/coaches/${asha}/state`, { state: 'deactivated', reason: 'test: remove the preview coach' }), 'deactivate the preview coach');
  restricted(await rohan.post(`/api/admin/members/${priya}/password-reset`), 'reset the preview client’s password');
  restricted(await rohan.post('/api/auth/mfa/setup'), 'the preview owner’s own 2FA set-up');
  restricted(await rohan.post('/api/auth/mfa/disable', { code: '123456' }), 'the preview owner’s own 2FA switch-off');
  restricted(await rohan.post('/api/auth/password/change', { currentPassword: DEMO_PASSWORDS.rohan, newPassword: 'Another-pass-2026!' }), 'the preview owner’s password');

  const p = await opened(h, 'member');
  restricted(await p.post('/api/auth/password/change', { currentPassword: DEMO_PASSWORDS.member, newPassword: 'Another-pass-2026!' }), 'the preview client’s password');
  restricted(await p.post('/api/me/data-requests', { kind: 'deletion', note: 'test' }), 'the preview client asks for deletion');
  const exp = await p.post('/api/me/data-requests', { kind: 'export' });
  assert.equal(exp.status, 201, 'an export still works');
  const a = await opened(h, 'coach');
  restricted(await a.post('/api/auth/password/change', { currentPassword: DEMO_PASSWORDS.coach, newPassword: 'Another-pass-2026!' }), 'the preview coach’s password');

  // a reset link for a preview account, an administrator or an owner cannot be used (and is not used up)
  const anon = client(h.app);
  for (const email of [PRIYA, ASHA, ROHAN, AVINASH, DEMO.owner, DEMO.admin]) {
    const forgot = await anon.post('/api/auth/password/forgot', { email });
    const token = forgot.json.demoToken as string;
    assert.ok(token, email);
    restricted(await anon.post('/api/auth/password/reset', { token, password: 'Another-pass-2026!' }), `reset ${email} by link`);
    assert.equal(h.db.get<{ used_at: string | null }>("SELECT used_at FROM auth_tokens WHERE user_id = ? AND kind = 'password_reset' ORDER BY created_at DESC LIMIT 1", [userId(h.ctx, email)])!.used_at, null, `${email}: the link is not used up`);
  }
  // an owner signed in with the password (not through the preview) cannot change their password or 2FA either
  const owner = client(h.app);
  await owner.login(DEMO.owner, DEMO_PASSWORDS.owner, 'dashboard', true);
  restricted(await owner.post('/api/auth/password/change', { currentPassword: DEMO_PASSWORDS.owner, newPassword: 'Another-pass-2026!' }), 'another owner’s password');
  restricted(await owner.post('/api/auth/mfa/setup'), 'another owner’s 2FA');

  assert.deepEqual(everyone.map(before), snapshot, 'no role, state, authenticator or password changed');
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM data_requests WHERE user_id = ? AND kind = 'deletion'", [priya])!.n, 0);
  for (const ws of WORKSPACES) assert.equal((await client(h.app).post('/api/auth/open-preview', { workspace: ws })).status, 200, `${ws} still opens`);
});

test('on: the role, permission and sign-in checks come first (a member or a visitor gets the usual answer, not the preview one)', async () => {
  const h = await onApp();
  const p = await opened(h, 'member');
  const r = await p.post('/api/admin/admins', { email: 'x@demo.bioptime.test', name: 'X Y', password: 'A-strong-pass-2026!' });
  assert.deepEqual([r.status, r.json.error?.code], [403, 'FORBIDDEN']);
  const anon = client(h.app);
  assert.equal((await anon.post(`/api/admin/users/${userId(h.ctx, AVINASH)}/role`, { role: 'admin', reason: 'test' })).status, 401);
  assert.equal((await anon.post('/api/auth/password/change', { currentPassword: 'x', newPassword: 'Another-pass-2026!' })).status, 401);
});

test('on: everything else in the admin dashboard works (members, other accounts, a workout programme published, settings, invitations, permissions)', async () => {
  const h = await onApp();
  const rohan = await opened(h, 'admin');
  const list = await rohan.get('/api/admin/members');
  assert.equal(list.status, 200);
  assert.ok((list.json.items as Array<{ email: string }>).some((m) => m.email === PRIYA));
  assert.equal((await rohan.get(`/api/admin/members/${userId(h.ctx, PRIYA)}`)).status, 200);

  // publish a workout programme for the preview client
  const priya = userId(h.ctx, PRIYA);
  const templateId = h.db.get<{ id: string }>("SELECT id FROM workout_templates WHERE title = 'Walk and mobility'")!.id;
  const created = await rohan.post(`/api/admin/members/${priya}/workout-programs`, { title: 'A week of walks', templateId, weeks: 1 });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const startDate = new Date(Date.parse(`${todayIst(h.ctx)}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const pub = await rohan.post(`/api/admin/workout-programs/${(created.json as { id: string }).id}/publish`, { startDate });
  assert.equal(pub.status, 200, JSON.stringify(pub.json));
  assert.equal((pub.json as { status: string }).status, 'published');

  // the same routes the preview restricts still act on every other account
  const ananya = userId(h.ctx, ANANYA), rahul = userId(h.ctx, RAHUL);
  assert.equal((await rohan.patch(`/api/admin/members/${ananya}/state`, { state: 'suspended', reason: 'test: another member' })).status, 200);
  assert.equal((await rohan.patch(`/api/admin/members/${ananya}/state`, { state: 'active', reason: 'test: another member' })).status, 200);
  assert.equal((await rohan.patch(`/api/admin/coaches/${rahul}/state`, { state: 'suspended', reason: 'test: another coach' })).status, 200);
  assert.equal((await rohan.patch(`/api/admin/coaches/${rahul}/state`, { state: 'active', reason: 'test: another coach' })).status, 200);
  assert.equal((await rohan.post(`/api/admin/members/${ananya}/password-reset`)).status, 200);
  const anon = client(h.app);
  const t = (await anon.post('/api/auth/password/forgot', { email: ANANYA })).json.demoToken as string;
  assert.equal((await anon.post('/api/auth/password/reset', { token: t, password: DEMO_PASSWORDS.member })).status, 200, 'another member resets by link');
  const rahulClient = client(h.app);
  await rahulClient.login(RAHUL, DEMO_PASSWORDS.coach, 'dashboard');
  assert.equal((await rahulClient.post('/api/auth/password/change', { currentPassword: DEMO_PASSWORDS.coach, newPassword: DEMO_PASSWORDS.coach })).status, 200, 'another coach changes their own password');

  // settings, an invitation, a permission, a module setting, an import dry run
  assert.equal((await rohan.patch('/api/admin/settings', { key: 'support_email', value: 'help@bioptime.com', reason: 'test: allowed in the preview' })).status, 200);
  assert.equal((await rohan.post('/api/admin/coaches/invite', { email: 'new.coach@demo.bioptime.test', displayName: 'New Coach' })).status, 201);
  assert.equal((await rohan.post(`/api/admin/users/${userId(h.ctx, DEMO.admin)}/permissions`, { permission: 'imports.manage', granted: true, reason: 'test: allowed in the preview' })).status, 200);
  assert.equal((await rohan.patch('/api/admin/module-settings', { key: 'gst_rate_bp', value: 1800, reason: 'test: allowed in the preview' })).status, 200);
  const dry = await rohan.post('/api/admin/imports', { kind: 'members', fileName: 'people.csv', csv: 'email,name\nnew.person@demo.bioptime.test,New Person\n', dryRun: true });
  assert.equal(dry.status, 200, JSON.stringify(dry.json));

  // the coach and the client work too
  const coach = await opened(h, 'coach');
  assert.equal((await coach.get('/api/coach/clients')).status, 200);
  const client2 = await opened(h, 'member');
  assert.equal((await client2.get('/api/me')).status, 200);
  assert.equal((await client2.patch('/api/me/profile', { city: 'Kochi' })).status, 200);
});

test('on: sign-out ends only that session; opening again gives a new one', async () => {
  const h = await onApp();
  const c = await opened(h, 'member');
  assert.equal((await c.post('/api/auth/logout')).status, 200);
  assert.equal((await c.get('/api/auth/me')).status, 401);
  const again = await c.post('/api/auth/open-preview', { workspace: 'member' });
  assert.equal(again.status, 200);
  assert.equal((await c.get('/api/auth/me')).status, 200);
});

test('on: the API reference documents the route and the restriction notes', async () => {
  const h = await onApp();
  const spec = (await client(h.app).get('/api/openapi.json')).json as { paths: Record<string, Record<string, { responses: Record<string, { description: string }>; tags: string[]; 'x-role': string }>> };
  const op = spec.paths['/auth/open-preview']?.post;
  assert.ok(op, 'documented');
  assert.equal(op['x-role'], 'none');
  assert.match(op.responses['409']!.description, /OPEN_PREVIEW_UNAVAILABLE/);
  assert.match(spec.paths['/admin/admins']!.post!.responses['403']!.description, /OPEN_PREVIEW_RESTRICTED while the open preview is on/);
  assert.match(spec.paths['/auth/password/change']!.post!.responses['403']!.description, /preview accounts \(or, for passwords, an administrator or owner\)/);
  assert.doesNotMatch(spec.paths['/admin/members']!.get!.responses['403']!.description, /OPEN_PREVIEW/);
});

test('on, with rate limits: /auth/open-preview allows 120 per 10 minutes per address (switching workspaces in one browser), then 429', async () => {
  const h = await makeApp({ env: { OPEN_PREVIEW: '1', RATE_LIMITS: 'on' } });
  try {
    const c: Client = client(h.app);
    const statuses: number[] = [];
    for (let i = 0; i < 121; i += 1) statuses.push((await c.post('/api/auth/open-preview', { workspace: 'member' })).status);
    assert.deepEqual(statuses.slice(0, 120), Array(120).fill(200));
    statuses.splice(20, 100); // keep the shape of the original check: the 121st call is the first refused
    const last = await c.post('/api/auth/open-preview', { workspace: 'member' });
    assert.deepEqual([statuses[20], last.status, last.json.error?.code], [429, 429, 'RATE_LIMITED']);
  } finally { await h.app.close(); h.db.close(); }
});

test('turning the preview off (a restart without OPEN_PREVIEW) signs out every session it opened; password sessions stay', async () => {
  const h = await makeApp({ env: { OPEN_PREVIEW: '1' } });
  const restarted: Array<Awaited<ReturnType<typeof buildApp>>> = [];
  try {
    const web = await opened(h, 'member');
    const mob = client(h.app);
    const token = ((await mob.post('/api/auth/open-preview', { workspace: 'coach' }, { 'x-bioptime-client': 'mobile' })).json.session as { token: string }).token;
    const pw = client(h.app);
    await pw.login(ANANYA, DEMO_PASSWORDS.member);
    const offConfig = { ...h.config, OPEN_PREVIEW: '', openPreview: false };
    // the restart: the same database, the preview off
    const app2 = await buildApp({ config: offConfig, db: h.db, services: h.services });
    restarted.push(app2);
    await app2.ready();
    const me = (headers: Record<string, string>) => app2.inject({ method: 'GET', url: '/api/auth/me', headers });
    assert.equal((await me({ cookie: web.cookie })).statusCode, 401, 'the web preview session is signed out');
    assert.equal((await me({ authorization: `Bearer ${token}` })).statusCode, 401, 'the app preview session is signed out');
    assert.equal((await me({ cookie: pw.cookie })).statusCode, 200, 'a password session stays');
    const ended = h.db.all<{ data: string; reason: string }>("SELECT data, reason FROM audit_events WHERE action = 'auth.open_preview_ended'");
    assert.equal(ended.length, 1);
    assert.equal(JSON.parse(ended[0]!.data).sessionsRevoked, 2);
    assert.equal((await app2.inject({ method: 'POST', url: '/api/auth/open-preview', headers: { 'content-type': 'application/json', 'x-bioptime-client': 'web' }, payload: '{"workspace":"member"}' })).statusCode, 404, 'and the route is gone');
    // a second start finds nothing more to sign out
    const app3 = await buildApp({ config: offConfig, db: h.db, services: h.services });
    restarted.push(app3);
    assert.equal(h.db.all("SELECT 1 FROM audit_events WHERE action = 'auth.open_preview_ended'").length, 1);
  } finally { for (const a of restarted) await a.close(); await h.app.close(); h.db.close(); }
});

test('on: visitors sharing a preview account see and end only their own session, and no visitor address is stored on it', async () => {
  const h = await onApp();
  const a = await opened(h, 'member');
  const b = await opened(h, 'member');
  const listA = await a.get('/api/auth/sessions');
  const listB = await b.get('/api/auth/sessions');
  assert.equal(listA.status, 200);
  assert.deepEqual((listA.json.items as Array<{ id: string }>).map((x) => x.id), [listA.json.current], 'visitor A sees only their own session');
  assert.deepEqual((listB.json.items as Array<{ id: string }>).map((x) => x.id), [listB.json.current], 'visitor B sees only their own session');
  assert.notEqual(listA.json.current, listB.json.current);
  for (const it of [...(listA.json.items as unknown[]), ...(listB.json.items as unknown[])] as Array<{ ip?: string | null; user_agent?: string | null }>) {
    assert.ok(!it.ip, 'no address on a shared preview session');
    assert.ok(!it.user_agent, 'no browser on a shared preview session');
  }
  const other = await a.del(`/api/auth/sessions/${listB.json.current}`);
  assert.equal(other.status, 404, "visitor A cannot sign visitor B out");
  assert.equal((await b.get('/api/auth/me')).status, 200, 'visitor B is still signed in');
  const own = await a.del(`/api/auth/sessions/${listA.json.current}`);
  assert.equal(own.status, 200, 'visitor A can end their own session');
});
