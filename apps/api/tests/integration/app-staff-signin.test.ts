/* The app's second and third doors: coaches and the Bioptime team signing in from the app (X-Bioptime-Client: mobile)
   with the same rules as the web portal: workspace separation (WRONG_WORKSPACE), MFA for administrators and owners
   (MFA_REQUIRED, MFA_INVALID), the demo-only TOTP helper for the seeded admin@ and owner@ accounts, the same session
   lifetimes as the web (coach SESSION_DAYS, admin and owner ADMIN_SESSION_HOURS), and /auth/me carrying permissions
   for the bearer session. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, DEMO, DEMO_PASSWORDS } from '../helpers.js';
import { ALL_PERMISSIONS } from '../../src/auth/permissions.js';

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); h.db.close(); });

const MOBILE = { 'x-bioptime-client': 'mobile' };
const login = (body: Record<string, unknown>) => client(h.app).post('/api/auth/login', body, MOBILE);
const totp = async (email: string) => { const r = await client(h.app).get(`/api/auth/demo/totp?email=${encodeURIComponent(email)}`); assert.equal(r.status, 200, JSON.stringify(r.json)); return String(r.json.code); };
const bearer = (token: string) => { const c = client(h.app); c.useBearer(token); return c; };
const hoursFromNow = (iso: string) => (Date.parse(iso) - Date.now()) / 3600_000;

test('a coach signs in from the app with workspace coach: a 30-day bearer session, /auth/me with (no) permissions, the coach workspace open', async () => {
  const r = await login({ email: DEMO.coach, password: DEMO_PASSWORDS.coach, workspace: 'coach' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const s = r.json.session as { token?: string; expiresAt: string; kind: string };
  assert.ok(s.token, 'the app gets its bearer token');
  assert.equal(s.kind, 'mobile');
  assert.ok(Math.abs(hoursFromNow(s.expiresAt) - h.config.SESSION_DAYS * 24) < 1, `coach sessions last SESSION_DAYS (${h.config.SESSION_DAYS}) days on the app as on the web: ${s.expiresAt}`);
  assert.equal((r.json.user as { role: string }).role, 'coach');
  assert.deepEqual(r.json.permissions, [], 'coaches hold no administrator permissions');
  const c = bearer(s.token!);
  const me = await c.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal((me.json.user as { role: string }).role, 'coach');
  assert.deepEqual(me.json.permissions, []);
  assert.equal((await c.get('/api/coach/home')).status, 200, 'the coach workspace answers the bearer session');
  assert.equal((await c.get('/api/admin/integrations')).status, 403, 'and the administrative portal does not');
  assert.equal(h.db.get<{ kind: string }>('SELECT kind FROM sessions WHERE token_hash = (SELECT token_hash FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = ?) ORDER BY created_at DESC LIMIT 1)', [DEMO.coach])!.kind, 'mobile');
});

test('the team signs in from the app with workspace admin and the authenticator code: 12-hour sessions, permissions in the answer and on /auth/me; the demo TOTP helper serves admin@ and owner@', async () => {
  const noCode = await login({ email: DEMO.admin, password: DEMO_PASSWORDS.admin, workspace: 'admin' });
  assert.equal(noCode.status, 401);
  assert.equal(noCode.json.error?.code, 'MFA_REQUIRED');
  const wrong = await login({ email: DEMO.admin, password: DEMO_PASSWORDS.admin, workspace: 'admin', mfaCode: '000000' });
  assert.equal(wrong.json.error?.code, 'MFA_INVALID');
  h.db.run('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE email = ?', [DEMO.admin]);

  for (const [email, password, role] of [[DEMO.admin, DEMO_PASSWORDS.admin, 'admin'], [DEMO.owner, DEMO_PASSWORDS.owner, 'owner']] as const) {
    const code = await totp(email);
    assert.match(code, /^\d{6}$/);
    const r = await login({ email, password, workspace: 'admin', mfaCode: code });
    assert.equal(r.status, 200, `${email}: ${JSON.stringify(r.json)}`);
    const s = r.json.session as { token?: string; expiresAt: string; kind: string };
    assert.ok(s.token);
    assert.equal(s.kind, 'mobile');
    assert.ok(Math.abs(hoursFromNow(s.expiresAt) - h.config.ADMIN_SESSION_HOURS) < 0.1, `${role} sessions last ADMIN_SESSION_HOURS (${h.config.ADMIN_SESSION_HOURS}) on the app as on the web: ${s.expiresAt}`);
    assert.equal((r.json.user as { role: string }).role, role);
    const perms = r.json.permissions as string[];
    const c = bearer(s.token!);
    const me = await c.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.deepEqual(me.json.permissions, perms, '/auth/me carries the same permissions for the bearer session');
    assert.ok(perms.includes('members.manage'));
    if (role === 'owner') assert.equal(perms.length, ALL_PERMISSIONS.length, 'owners hold every permission');
    else assert.ok(!perms.includes('permissions.manage') && !perms.includes('labstack.manage'), 'administrators start without the non-default permissions');
    assert.equal((await c.get('/api/admin/integrations')).status, 200, 'the administrative portal answers the bearer session');
    assert.equal((await c.get('/api/coach/home')).status, 403);
  }
  const notSeeded = await client(h.app).get('/api/auth/demo/totp?email=someone@example.test');
  assert.equal(notSeeded.status, 403, 'only seeded demo accounts');
  const notMfa = await client(h.app).get(`/api/auth/demo/totp?email=${encodeURIComponent(DEMO.member)}`);
  assert.equal(notMfa.status, 404, 'a seeded account without MFA has no code');
});

test('the three doors stay separate on the app: each workspace admits only its own kind of account', async () => {
  const code = await totp(DEMO.admin);
  const cases: Array<[string, string, 'member' | 'coach' | 'admin', string | undefined]> = [
    [DEMO.member, DEMO_PASSWORDS.member, 'coach', undefined], [DEMO.member, DEMO_PASSWORDS.member, 'admin', undefined],
    [DEMO.coach, DEMO_PASSWORDS.coach, 'member', undefined], [DEMO.coach, DEMO_PASSWORDS.coach, 'admin', undefined],
    [DEMO.admin, DEMO_PASSWORDS.admin, 'member', code], [DEMO.admin, DEMO_PASSWORDS.admin, 'coach', code],
  ];
  for (const [email, password, workspace, mfaCode] of cases) {
    const r = await login({ email, password, workspace, ...(mfaCode ? { mfaCode } : {}) });
    assert.equal(r.status, 403, `${email} at ${workspace}`);
    assert.equal(r.json.error?.code, 'WRONG_WORKSPACE');
    assert.equal((r.json.session as unknown) ?? undefined, undefined, 'no session');
  }
  assert.equal((await login({ email: DEMO.member, password: DEMO_PASSWORDS.member, workspace: 'member' })).status, 200);
});
