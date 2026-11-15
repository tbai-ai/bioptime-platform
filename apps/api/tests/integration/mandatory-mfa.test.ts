/* Mandatory two-factor authentication for administrators and owners (30 October 2026): a password alone opens nothing;
   it starts enrolment with a one-time, short-lived, hashed enrolment token that is good only for /auth/mfa/enrol/start
   and /auth/mfa/enrol/confirm; an existing session of a privileged account without an authenticator reaches no route
   but sign-out; nobody switches their own MFA off; another owner resets a lost authenticator, which forces enrolment
   at the next sign-in. Also: the placeholder owner accounts for Rohan and Avinash, and create-owner (invited owner,
   single-use activation link, never a password on the command line). */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeApp, client, DEMO, DEMO_PASSWORDS, DEMO_MFA_SECRET, userId } from '../helpers.js';
import { totpCode, sha256 } from '../../src/lib/crypto.js';
import { createSession } from '../../src/auth/sessions.js';
import { inviteOwner } from '../../src/auth/service.js';
import { DEMO_OWNERS } from '../../src/seed/seed.js';
import { ALL_PERMISSIONS, requireActor } from '../../src/auth/permissions.js';
import type { Actor } from '../../src/context.js';

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); h.db.close(); });

const PASSWORD = 'A-long-admin-password-1';
const owner = async () => { const c = client(h.app); await c.login(DEMO.owner, DEMO_PASSWORDS.owner, 'dashboard', true); return c; };
let made = 0;
/** A new privileged account without an authenticator, provisioned by the owner (POST /admin/admins). */
const provision = async (role: 'admin' | 'owner' = 'admin') => {
  const email = `fresh.${role}.${++made}@demo.bioptime.test`;
  const r = await (await owner()).post('/api/admin/admins', { email, name: `Fresh ${role} ${made}`, password: PASSWORD, role });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return { email, id: (r.json as { id: string }).id };
};
type EnrolmentAnswer = { status: number; json: { error?: { code: string; message: string; details?: unknown } } & Record<string, unknown> };
const enrolmentToken = (r: EnrolmentAnswer) => (r.json.error?.details as { enrolmentToken: string }).enrolmentToken;
/** The code of an answer: INVALID_STATE carries its own code in details. */
const code = (r: EnrolmentAnswer) => (r.json.error?.code === 'INVALID_STATE' ? (r.json.error.details as { code?: string } | undefined)?.code : r.json.error?.code);
const auditCount = (action: string, id: string) => h.db.get<{ n: number }>('SELECT COUNT(*) n FROM audit_events WHERE action = ? AND target_id = ?', [action, id])!.n;

test('a privileged account without an authenticator gets no session from its password: 403 MFA_ENROLMENT_REQUIRED with a 15-minute enrolment token, stored hashed', async () => {
  const a = await provision('admin');
  for (const workspace of ['admin', 'dashboard', undefined]) {
    const c = client(h.app);
    const r = await c.post('/api/auth/login', { email: a.email, password: PASSWORD, ...(workspace ? { workspace } : {}) });
    assert.equal(r.status, 403, `${workspace}: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.error?.code, 'MFA_ENROLMENT_REQUIRED');
    const d = r.json.error?.details as { enrolmentToken: string; expiresInMinutes: number };
    assert.equal(typeof d.enrolmentToken, 'string');
    assert.ok(d.enrolmentToken.length >= 32);
    assert.equal(d.expiresInMinutes, 15);
    assert.equal(c.cookie, '', 'no session cookie');
    const row = h.db.get<{ token_hash: string; expires_at: string; created_at: string }>('SELECT token_hash, expires_at, created_at FROM mfa_enrolments WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', [a.id])!;
    assert.equal(row.token_hash, sha256(d.enrolmentToken), 'the server keeps only the hash');
    assert.ok(!JSON.stringify(h.db.all('SELECT * FROM mfa_enrolments')).includes(d.enrolmentToken), 'never the token itself');
    assert.equal(Math.round((Date.parse(row.expires_at) - Date.parse(row.created_at)) / 60000), 15);
  }
  assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM sessions WHERE user_id = ?', [a.id])!.n, 0, 'no session was created');
  assert.equal(auditCount('auth.mfa_enrolment_required', a.id), 3, 'each enrolment requirement is audited');
  // a wrong password still gets the generic answer, never an enrolment token
  const wrong = await client(h.app).post('/api/auth/login', { email: a.email, password: 'Not-the-password-1', workspace: 'admin' });
  assert.deepEqual([wrong.status, wrong.json.error?.code, wrong.json.error?.details], [401, 'INVALID_CREDENTIALS', undefined]);
  // the coach and client workspaces keep their WRONG_WORKSPACE answer (no token handed out there)
  const coachWs = await client(h.app).post('/api/auth/login', { email: a.email, password: PASSWORD, workspace: 'coach' });
  assert.equal(coachWs.json.error?.code, 'WRONG_WORKSPACE');
});

test('the enrolment token is good only for enrolment: not a session, not a reset link; start gives a secret, a wrong code is refused, the right code enables MFA and signs in once', async () => {
  const a = await provision('owner');
  const c = client(h.app);
  const first = await c.post('/api/auth/login', { email: a.email, password: PASSWORD, workspace: 'admin' });
  const token = enrolmentToken(first);
  // not a session
  const bearer = client(h.app);
  bearer.useBearer(token);
  assert.equal((await bearer.get('/api/auth/me')).status, 401);
  assert.equal((await bearer.get('/api/admin/overview')).status, 401);
  // not a password reset link
  assert.equal((await client(h.app).post('/api/auth/password/reset', { token, password: 'Another-long-password-2' })).json.error?.code, 'TOKEN_INVALID');
  // confirm before start
  assert.equal(code(await c.post('/api/auth/mfa/enrol/confirm', { enrolmentToken: token, code: '123456' })), 'MFA_ENROLMENT_NOT_STARTED');
  const start = await c.post('/api/auth/mfa/enrol/start', { enrolmentToken: token });
  assert.equal(start.status, 200, JSON.stringify(start.json));
  const { secret, otpauthUri } = start.json as { secret: string; otpauthUri: string };
  assert.match(secret, /^[A-Z2-7]{16,}$/);
  assert.match(otpauthUri, /^otpauth:\/\/totp\//);
  assert.ok(otpauthUri.includes(`secret=${secret}`));
  assert.equal(start.headers['cache-control'], 'no-store');
  // a wrong code: refused, counted, the token still works
  const wrongCode = String((Number(totpCode(secret)) + 500000) % 1000000).padStart(6, '0');
  const bad = await c.post('/api/auth/mfa/enrol/confirm', { enrolmentToken: token, code: wrongCode });
  assert.deepEqual([bad.status, bad.json.error?.code, (bad.json.error?.details as { attemptsLeft: number }).attemptsLeft], [400, 'MFA_INVALID', 4]);
  assert.equal((await c.post('/api/auth/mfa/enrol/confirm', { enrolmentToken: token, code: 'abc' })).json.error?.code, 'VALIDATION_FAILED');
  assert.equal(h.db.get<{ mfa_enabled: number }>('SELECT mfa_enabled FROM users WHERE id = ?', [a.id])!.mfa_enabled, 0, 'nothing is enabled by a wrong code');
  // the right code
  const ok = await c.post('/api/auth/mfa/enrol/confirm', { enrolmentToken: token, code: totpCode(secret) });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal((ok.json.user as { mfaEnabled: boolean }).mfaEnabled, true);
  assert.deepEqual([...(ok.json.permissions as string[])].sort(), [...ALL_PERMISSIONS].sort(), 'the normal sign-in answer: an owner holds every permission');
  assert.equal((ok.json.session as { kind: string; token?: string }).kind, 'web');
  assert.equal((ok.json.session as { token?: string }).token, undefined);
  assert.ok(c.cookie.startsWith('bp_session='), 'the web session cookie is set');
  assert.equal((await c.get('/api/admin/overview')).status, 200, 'the admin workspace opens');
  // single use
  assert.equal((await client(h.app).post('/api/auth/mfa/enrol/confirm', { enrolmentToken: token, code: totpCode(secret) })).json.error?.code, 'TOKEN_USED');
  assert.equal((await client(h.app).post('/api/auth/mfa/enrol/start', { enrolmentToken: token })).json.error?.code, 'TOKEN_USED');
  // audited: required, started, enabled, and the sign-in
  for (const action of ['auth.mfa_enrolment_required', 'auth.mfa_enrol_started', 'auth.mfa_enrol_failed', 'auth.mfa_enabled', 'auth.login']) assert.ok(auditCount(action, a.id) >= 1, action);
  // from now on the code is needed at every sign-in
  const again = await client(h.app).post('/api/auth/login', { email: a.email, password: PASSWORD, workspace: 'admin' });
  assert.equal(again.json.error?.code, 'MFA_REQUIRED');
  assert.equal((await client(h.app).post('/api/auth/login', { email: a.email, password: PASSWORD, workspace: 'admin', mfaCode: totpCode(secret) })).status, 200);
});

test('the mobile client gets its bearer token from the enrolment confirmation', async () => {
  const a = await provision('admin');
  const mobile = { 'x-bioptime-client': 'mobile' };
  const token = enrolmentToken(await client(h.app).post('/api/auth/login', { email: a.email, password: PASSWORD, workspace: 'admin' }, mobile));
  const { secret } = (await client(h.app).post('/api/auth/mfa/enrol/start', { enrolmentToken: token }, mobile)).json as { secret: string };
  const ok = await client(h.app).post('/api/auth/mfa/enrol/confirm', { enrolmentToken: token, code: totpCode(secret) }, mobile);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const s = ok.json.session as { token: string; kind: string };
  assert.equal(s.kind, 'mobile');
  const b = client(h.app);
  b.useBearer(s.token);
  assert.equal((await b.get('/api/admin/overview')).status, 200);
});

test('enrolment tokens expire, die when a newer one is issued, and wear out after five wrong codes', async () => {
  const a = await provision('admin');
  const login = () => client(h.app).post('/api/auth/login', { email: a.email, password: PASSWORD, workspace: 'admin' });
  // expiry (15 minutes): moved into the past here
  const t1 = enrolmentToken(await login());
  h.db.run('UPDATE mfa_enrolments SET expires_at = ? WHERE token_hash = ?', [new Date(Date.now() - 1000).toISOString(), sha256(t1)]);
  assert.equal((await client(h.app).post('/api/auth/mfa/enrol/start', { enrolmentToken: t1 })).json.error?.code, 'TOKEN_EXPIRED');
  assert.equal((await client(h.app).post('/api/auth/mfa/enrol/confirm', { enrolmentToken: t1, code: '000000' })).json.error?.code, 'TOKEN_EXPIRED');
  // a newer sign-in replaces the older token
  const t2 = enrolmentToken(await login());
  const t3 = enrolmentToken(await login());
  assert.equal((await client(h.app).post('/api/auth/mfa/enrol/start', { enrolmentToken: t2 })).json.error?.code, 'TOKEN_USED');
  // five wrong codes use the token up
  const { secret } = (await client(h.app).post('/api/auth/mfa/enrol/start', { enrolmentToken: t3 })).json as { secret: string };
  const wrong = String((Number(totpCode(secret)) + 500000) % 1000000).padStart(6, '0');
  const answers: Array<string | undefined> = [];
  for (let i = 0; i < 5; i++) answers.push((await client(h.app).post('/api/auth/mfa/enrol/confirm', { enrolmentToken: t3, code: wrong })).json.error?.code);
  assert.deepEqual(answers, ['MFA_INVALID', 'MFA_INVALID', 'MFA_INVALID', 'MFA_INVALID', 'MFA_INVALID']);
  assert.equal((await client(h.app).post('/api/auth/mfa/enrol/confirm', { enrolmentToken: t3, code: totpCode(secret) })).json.error?.code, 'TOKEN_USED', 'even the right code is refused once the token is worn out');
  assert.equal(h.db.get<{ mfa_enabled: number }>('SELECT mfa_enabled FROM users WHERE id = ?', [a.id])!.mfa_enabled, 0);
  // an unknown token
  assert.equal((await client(h.app).post('/api/auth/mfa/enrol/start', { enrolmentToken: 'x'.repeat(43) })).json.error?.code, 'TOKEN_INVALID');
  // a suspended account cannot finish enrolling with a token issued before
  const t4 = enrolmentToken(await login());
  h.db.run("UPDATE users SET state = 'suspended' WHERE id = ?", [a.id]);
  assert.equal((await client(h.app).post('/api/auth/mfa/enrol/start', { enrolmentToken: t4 })).json.error?.code, 'TOKEN_INVALID');
  h.db.run("UPDATE users SET state = 'active' WHERE id = ?", [a.id]);
});

test('a password-only session of a privileged account (one opened before the rule) reaches no admin route; sign-out still works', async () => {
  const a = await provision('admin');
  const user = h.db.get<{ id: string; role: 'admin' }>('SELECT id, role FROM users WHERE id = ?', [a.id])!;
  const s = createSession(h.ctx, user, 'mobile'); // as if signed in with the password alone before mandatory 2FA
  const c = client(h.app);
  c.useBearer(s.token);
  for (const url of ['/api/admin/overview', '/api/admin/members', '/api/admin/coaches', `/api/admin/members/${userId(h.ctx, DEMO.member)}`, '/api/auth/me', '/api/auth/sessions']) {
    const r = await c.get(url);
    assert.deepEqual([r.status, r.json.error?.code], [403, 'MFA_ENROLMENT_REQUIRED'], url);
    assert.equal(r.json.error?.details, undefined, 'no enrolment token on a session refusal: the person signs in again');
  }
  for (const [url, body] of [['/api/auth/mfa/setup', {}], ['/api/admin/coaches/invite', { email: 'x.y@demo.bioptime.test', displayName: 'X Y' }], ['/api/auth/password/change', { currentPassword: PASSWORD, newPassword: 'Another-long-password-3' }]] as const) {
    const r = await c.post(url, body);
    assert.deepEqual([r.status, r.json.error?.code], [403, 'MFA_ENROLMENT_REQUIRED'], url);
  }
  const patch = await c.patch(`/api/admin/members/${userId(h.ctx, DEMO.member)}/state`, { state: 'suspended', reason: 'must not happen' });
  assert.deepEqual([patch.status, patch.json.error?.code], [403, 'MFA_ENROLMENT_REQUIRED']);
  assert.notEqual(h.db.get<{ state: string }>('SELECT state FROM users WHERE email = ?', [DEMO.member])!.state, 'suspended');
  assert.equal((await c.post('/api/auth/logout')).status, 200, 'sign-out works');
  assert.ok(h.db.get<{ revoked_at: string | null }>('SELECT revoked_at FROM sessions WHERE id = ?', [s.sessionId])!.revoked_at, 'and ends the session');
  // an enrolled administrator's session is untouched
  const ok = client(h.app);
  await ok.login(DEMO.admin, DEMO_PASSWORDS.admin, 'dashboard', true);
  assert.equal((await ok.get('/api/admin/overview')).status, 200);
  assert.equal((await ok.get('/api/auth/me')).status, 200);
});

test('nobody switches their own MFA off (MFA_REQUIRED_FOR_ROLE); another owner resets it with a reason, which signs the account out and forces enrolment', async () => {
  const o = await owner();
  const off = await o.post('/api/auth/mfa/disable', { code: totpCode(DEMO_MFA_SECRET) });
  assert.deepEqual([off.status, off.json.error?.code], [403, 'MFA_REQUIRED_FOR_ROLE']);
  assert.equal(h.db.get<{ mfa_enabled: number }>('SELECT mfa_enabled FROM users WHERE email = ?', [DEMO.owner])!.mfa_enabled, 1);
  const ad = client(h.app);
  await ad.login(DEMO.admin, DEMO_PASSWORDS.admin, 'dashboard', true);
  assert.equal((await ad.post('/api/auth/mfa/disable', { code: totpCode(DEMO_MFA_SECRET) })).json.error?.code, 'MFA_REQUIRED_FOR_ROLE');

  // the placeholder owner Rohan, signed in on two devices
  const rohan = DEMO_OWNERS[0];
  const rohanId = userId(h.ctx, rohan.email);
  const r1 = client(h.app), r2 = client(h.app);
  await r1.login(rohan.email, rohan.password, 'dashboard', true);
  await r2.login(rohan.email, rohan.password, 'dashboard', true);
  // only an owner, never for themselves, always with a reason, only for administrators and owners
  assert.equal((await ad.post(`/api/admin/users/${rohanId}/mfa/reset`, { reason: 'lost phone' })).status, 403, 'an administrator cannot');
  assert.equal(code(await r1.post(`/api/admin/users/${rohanId}/mfa/reset`, { reason: 'lost phone' })), 'SELF_MFA_RESET');
  assert.equal((await o.post(`/api/admin/users/${rohanId}/mfa/reset`, {})).json.error?.code, 'VALIDATION_FAILED');
  assert.equal((await o.post(`/api/admin/users/${userId(h.ctx, DEMO.coach)}/mfa/reset`, { reason: 'not an administrator' })).status, 404);
  const reset = await o.post(`/api/admin/users/${rohanId}/mfa/reset`, { reason: 'Rohan lost his phone' });
  assert.equal(reset.status, 200, JSON.stringify(reset.json));
  assert.equal((reset.json as { mfaEnabled: boolean }).mfaEnabled, false);
  assert.deepEqual({ ...h.db.get<object>('SELECT mfa_enabled, mfa_secret FROM users WHERE id = ?', [rohanId]) }, { mfa_enabled: 0, mfa_secret: null });
  const row = h.db.get<{ actor_id: string; reason: string }>("SELECT actor_id, reason FROM audit_events WHERE action = 'auth.mfa_reset' AND target_id = ?", [rohanId])!;
  assert.deepEqual([row.actor_id, row.reason], [userId(h.ctx, DEMO.owner), 'Rohan lost his phone']);
  assert.equal((await r1.get('/api/auth/me')).status, 401, 'signed out everywhere');
  assert.equal((await r2.get('/api/admin/overview')).status, 401);
  assert.ok(h.db.get("SELECT 1 FROM notifications WHERE user_id = ? AND title = 'Your two-factor authentication was reset'", [rohanId]), 'Rohan is told');
  const told = h.db.get<{ body: string }>("SELECT body FROM notifications WHERE user_id = ? AND title = 'Your two-factor authentication was reset'", [rohanId])!.body;
  assert.match(told, /contact a Bioptime owner\.$/, 'the message assumes no number of owners (the demo has three), nor that the person is an owner');
  // the old code no longer opens anything: the next sign-in is enrolment
  const next = await client(h.app).post('/api/auth/login', { email: rohan.email, password: rohan.password, workspace: 'admin', mfaCode: totpCode(DEMO_MFA_SECRET) });
  assert.equal(next.json.error?.code, 'MFA_ENROLMENT_REQUIRED');
  const c = client(h.app);
  const { secret } = (await c.post('/api/auth/mfa/enrol/start', { enrolmentToken: enrolmentToken(next) })).json as { secret: string };
  assert.equal((await c.post('/api/auth/mfa/enrol/confirm', { enrolmentToken: enrolmentToken(next), code: totpCode(secret) })).status, 200);
  assert.equal((await c.get('/api/admin/overview')).status, 200);
  // back to the demo secret, so the demo's preview code keeps working for Rohan in later tests
  h.db.run('UPDATE users SET mfa_secret = ? WHERE id = ?', [DEMO_MFA_SECRET, rohanId]);
});

test('Rohan and Avinash: two separate placeholder owner accounts with full access, MFA enrolled on the demo secret; owner@ and admin@ stay', async () => {
  const rows = DEMO_OWNERS.map((o) => h.db.get<{ id: string; name: string; role: string; state: string; mfa_enabled: number; mfa_secret: string }>('SELECT id, name, role, state, mfa_enabled, mfa_secret FROM users WHERE email = ?', [o.email])!);
  assert.deepEqual(rows.map((r) => r.name), ['Rohan (placeholder)', 'Avinash (placeholder)']);
  assert.notEqual(rows[0]!.id, rows[1]!.id, 'two separate accounts');
  for (const r of rows) assert.deepEqual([r.role, r.state, r.mfa_enabled, r.mfa_secret], ['owner', 'active', 1, DEMO_MFA_SECRET]);
  assert.deepEqual([DEMO_PASSWORDS.rohan, DEMO_PASSWORDS.avinash], ['Demo-Rohan-2026!', 'Demo-Avinash-2026!']);
  for (const o of DEMO_OWNERS) {
    const pw = await client(h.app).post('/api/auth/login', { email: o.email, password: o.password, workspace: 'admin' });
    assert.equal(pw.json.error?.code, 'MFA_REQUIRED', 'the password alone is not enough');
    assert.equal((pw.json.error?.details as { previewCodePath?: string }).previewCodePath, '/auth/demo/totp');
    const preview = await client(h.app).get(`/api/auth/demo/totp?email=${encodeURIComponent(o.email)}`);
    assert.equal(preview.status, 200, 'the demo preview code works for them');
    const c = client(h.app);
    const r = await c.post('/api/auth/login', { email: o.email, password: o.password, workspace: 'admin', mfaCode: (preview.json as { code: string }).code });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal((r.json.user as { role: string }).role, 'owner');
    assert.deepEqual([...(r.json.permissions as string[])].sort(), [...ALL_PERMISSIONS].sort(), 'full master access');
    assert.equal((await c.get('/api/admin/users')).status, 200, 'including users and permissions');
  }
  for (const email of [DEMO.owner, DEMO.admin]) assert.equal(h.db.get<{ mfa_enabled: number }>('SELECT mfa_enabled FROM users WHERE email = ?', [email])!.mfa_enabled, 1, `${email} stays`);
});

test('an invited owner (create-owner) activates through the single-use link, then must enrol before any access', async () => {
  const r = inviteOwner(h.ctx, { email: 'Real.Owner@demo.bioptime.test', name: 'Real Owner' });
  assert.deepEqual([r.user.role, r.user.state, r.user.email, r.user.password_hash], ['owner', 'invited', 'real.owner@demo.bioptime.test', null]);
  assert.ok(r.activateUrl.startsWith(`${h.config.PUBLIC_ORIGIN}/reset-password?token=`));
  assert.ok(h.db.get("SELECT 1 FROM notifications WHERE user_id = ? AND category = 'welcome'", [r.user.id]), 'the link goes by email (the outbox here)');
  // nothing opens before activation, and the forgotten-password link does not apply to an account never set up
  assert.equal((await client(h.app).post('/api/auth/login', { email: r.user.email, password: 'Anything-long-1', workspace: 'admin' })).json.error?.code, 'INVALID_CREDENTIALS');
  assert.equal(((await client(h.app).post('/api/auth/password/forgot', { email: r.user.email })).json as { demoToken?: string }).demoToken, undefined);
  // asking again sends a new link; the old one stops working
  const again = inviteOwner(h.ctx, { email: r.user.email, name: 'Real Owner' });
  assert.equal(again.user.id, r.user.id);
  assert.equal((await client(h.app).post('/api/auth/password/reset', { token: r.token, password: 'Owner-chosen-password-1' })).json.error?.code, 'TOKEN_USED');
  // activation sets the password and nothing else: no session, no MFA yet
  const act = await client(h.app).post('/api/auth/password/reset', { token: again.token, password: 'Owner-chosen-password-1' });
  assert.equal(act.status, 200, JSON.stringify(act.json));
  assert.deepEqual([(act.json.user as { state: string }).state, (act.json.user as { mfaEnabled: boolean }).mfaEnabled], ['active', false]);
  assert.equal((await client(h.app).post('/api/auth/password/reset', { token: again.token, password: 'Owner-chosen-password-2' })).json.error?.code, 'TOKEN_USED', 'the link works once');
  const login = await client(h.app).post('/api/auth/login', { email: r.user.email, password: 'Owner-chosen-password-1', workspace: 'admin' });
  assert.equal(login.json.error?.code, 'MFA_ENROLMENT_REQUIRED', 'enrolment before any access');
  const c = client(h.app);
  const { secret } = (await c.post('/api/auth/mfa/enrol/start', { enrolmentToken: enrolmentToken(login) })).json as { secret: string };
  assert.equal((await c.post('/api/auth/mfa/enrol/confirm', { enrolmentToken: enrolmentToken(login), code: totpCode(secret) })).status, 200);
  assert.equal((await c.get('/api/admin/overview')).status, 200);
  // an email already in use (any other account) is refused
  assert.throws(() => inviteOwner(h.ctx, { email: DEMO.coach, name: 'Someone' }), /already has an account/);
  assert.throws(() => inviteOwner(h.ctx, { email: r.user.email, name: 'Real Owner' }), /already has an account/, 'an activated owner is not invited again');
});

test('the create-owner command never takes a password and prints the link only outside production', () => {
  const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bioptime-create-owner-'));
  try {
    const run = (args: string[], env: Record<string, string> = {}) => spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'create-owner', ...args], { cwd: apiDir, encoding: 'utf8', env: { ...process.env, BIOPTIME_MODE: 'development', DATABASE_PATH: path.join(dir, 'db.sqlite'), PUBLIC_ORIGIN: 'http://127.0.0.1:4999', ADMIN_PASSWORD: '', ...env } });
    const refused = run(['--email', 'cli.owner@example.org', '--name', 'CLI Owner', '--password', 'Some-long-password-1']);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /never takes a password/);
    const usage = run(['--email', 'cli.owner@example.org']);
    assert.notEqual(usage.status, 0);
    assert.match(usage.stderr, /usage: create-owner --email/);
    const ok = run(['--email', 'cli.owner@example.org', '--name', 'CLI Owner']);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /invited owner cli\.owner@example\.org/);
    assert.match(ok.stdout, /http:\/\/127\.0\.0\.1:4999\/reset-password\?token=[A-Za-z0-9_-]{20,}/, 'outside production the link is printed');
    assert.match(ok.stdout, /\/login\/admin/);
    const dup = run(['--email', 'cli.owner@example.org', '--name', 'CLI Owner']);
    assert.equal(dup.status, 0, 'an owner still invited gets a new link');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the MFA gate fails closed for actors opened from a session: an administrator or owner passes only with mfaEnrolled: true', () => {
  const base = { id: userId(h.ctx, DEMO.admin), role: 'admin' as const, email: DEMO.admin, name: 'Bioptime admin' };
  const gate = (actor: Actor) => requireActor({ ...h.ctx, actor });
  const refused = (actor: Actor, why: string) => assert.throws(() => gate(actor), (e: { code?: string; status?: number }) => e.code === 'MFA_ENROLMENT_REQUIRED' && e.status === 403, why);
  refused({ ...base, sessionId: 'ses_probe' }, 'a session actor whose flag was forgotten is refused, not let through');
  refused({ ...base, role: 'owner', sessionId: 'ses_probe' }, 'an owner too');
  refused({ ...base, sessionId: 'ses_probe', mfaEnrolled: false }, 'a session actor without an authenticator');
  refused({ ...base, mfaEnrolled: false }, 'any actor that says it has no authenticator');
  assert.equal(gate({ ...base, sessionId: 'ses_probe', mfaEnrolled: true })?.id, base.id, 'enrolled: through');
  assert.equal(gate(base)?.id, base.id, 'an actor built in code with no session (the seed, module sample data, jobs) is unaffected');
  assert.equal(gate({ id: userId(h.ctx, DEMO.coach), role: 'coach', email: DEMO.coach, name: 'Coach', sessionId: 'ses_probe' })?.role, 'coach', 'coaches and members never need the flag');
});
