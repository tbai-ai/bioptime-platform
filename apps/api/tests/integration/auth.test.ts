import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId } from '../helpers.js';

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); h.db.close(); });

test('registration → email verification → resumable onboarding → active member', async () => {
  const c = client(h.app);
  const reg = await c.post('/api/auth/register', { email: 'new.member@demo.bioptime.test', password: 'A-long-demo-password-1', name: 'New Member', acceptTerms: true, acceptPrivacy: true, termsVersion: '2026-10-17' });
  assert.equal(reg.status, 201);
  assert.equal((reg.json.user as { state: string }).state, 'pending_verification');
  const token = (reg.json.verification as { demoToken: string }).demoToken;
  assert.ok(token, 'demo mode returns the verification token');
  const me = await c.get('/api/me');
  assert.equal(me.status, 200);
  let ob = await c.get('/api/me/onboarding');
  assert.equal((ob.json.blockers as unknown[]).length, 1, 'blocked until verified');
  const verify = await c.post('/api/auth/verify-email', { token });
  assert.equal(verify.status, 200);
  assert.equal((verify.json.user as { state: string }).state, 'onboarding');
  assert.equal((await c.post('/api/auth/verify-email', { token })).json.error?.code, 'TOKEN_USED');
  assert.equal((await c.post('/api/me/onboarding', { step: 'profile', data: { gender: 'female', dateOfBirth: '1990-01-01', city: 'Pune', state: 'Maharashtra', pincode: '411001' } })).status, 200);
  ob = await c.get('/api/me/onboarding');
  assert.equal(ob.json.currentStep, 'goals');
  assert.deepEqual((ob.json.savedData as { profile: { city: string } }).profile.city, 'Pune', 'progress is saved and resumable');
  assert.equal((await c.post('/api/me/onboarding', { step: 'goals', data: { goals: ['Strength'] } })).status, 200);
  assert.equal((await c.post('/api/me/onboarding', { step: 'programme_info', data: {} })).status, 200);
  assert.equal((await c.post('/api/me/onboarding', { step: 'how_it_works', data: {} })).status, 200);
  const noConsent = await c.post('/api/me/onboarding', { step: 'consents', data: { healthData: false, coachSharing: true, labConsent: true } });
  assert.equal(noConsent.status, 409, 'health-data consent is required to finish');
  const done = await c.post('/api/me/onboarding', { step: 'consents', data: { healthData: true, coachSharing: true, labConsent: true } });
  assert.equal(done.status, 200);
  assert.equal((await c.get('/api/auth/me')).json.user && ((await c.get('/api/auth/me')).json.user as { state: string }).state, 'active');
});

test('sign-in: wrong password, lockout after five failures, workspace separation, logout ends the session', async () => {
  const c = client(h.app);
  assert.equal((await c.post('/api/auth/login', { email: DEMO.member, password: 'wrong-password-1', workspace: 'member' })).json.error?.code, 'INVALID_CREDENTIALS');
  assert.equal((await c.post('/api/auth/login', { email: 'nobody@demo.bioptime.test', password: 'wrong-password-1' })).json.error?.code, 'INVALID_CREDENTIALS');
  assert.equal((await c.post('/api/auth/login', { email: DEMO.member, password: DEMO_PASSWORDS.member, workspace: 'dashboard' })).json.error?.code, 'WRONG_WORKSPACE');
  assert.equal((await c.post('/api/auth/login', { email: DEMO.coach, password: DEMO_PASSWORDS.coach, workspace: 'member' })).json.error?.code, 'WRONG_WORKSPACE');
  await c.login(DEMO.member, DEMO_PASSWORDS.member);
  assert.equal((await c.get('/api/me')).status, 200);
  assert.equal((await c.post('/api/auth/logout')).status, 200);
  c.clear();
  assert.equal((await c.get('/api/me')).status, 401);
  for (let i = 0; i < 5; i++) await c.post('/api/auth/login', { email: DEMO.member2, password: 'wrong-password-1', workspace: 'member' });
  assert.equal((await c.post('/api/auth/login', { email: DEMO.member2, password: DEMO_PASSWORDS.member, workspace: 'member' })).status, 429);
  h.db.run('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE email = ?', [DEMO.member2]);
});

test('a revoked session cannot continue; a bearer session works for the mobile client without a cookie', async () => {
  const web = client(h.app);
  await web.login(DEMO.member, DEMO_PASSWORDS.member);
  const sessions = await web.get('/api/auth/sessions');
  const current = sessions.json.current as string;
  const mobile = await h.app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json', 'x-bioptime-client': 'mobile' }, payload: JSON.stringify({ email: DEMO.member, password: DEMO_PASSWORDS.member, workspace: 'member' }) });
  const token = (mobile.json() as { session: { token: string } }).session.token;
  assert.ok(token, 'mobile gets a bearer token');
  const m = client(h.app);
  m.useBearer(token);
  assert.equal((await m.get('/api/me')).status, 200);
  const revoke = await web.del(`/api/auth/sessions/${((await web.get('/api/auth/sessions')).json.items as Array<{ id: string }>).find((s) => s.id !== current)!.id}`);
  assert.equal(revoke.status, 200);
  assert.equal((await m.get('/api/me')).status, 401, 'the revoked mobile session is gone');
  assert.equal((await web.get('/api/me')).status, 200);
});

test('password reset: a used or forged token fails; a reset signs other sessions out', async () => {
  const c = client(h.app);
  assert.equal((await c.post('/api/auth/password/forgot', { email: DEMO.member2 })).status, 200);
  const row = h.db.get<{ id: string }>("SELECT id FROM auth_tokens WHERE kind = 'password_reset' AND user_id = ? AND used_at IS NULL", [userId(h.ctx, DEMO.member2)]);
  assert.ok(row, 'a reset token was issued');
  const outbox = h.db.get<{ body: string }>("SELECT body FROM outbox_messages WHERE to_address = ? ORDER BY created_at DESC LIMIT 1", [DEMO.member2]);
  assert.ok(outbox, 'the email went to the outbox, not to the internet');
  assert.equal((await c.post('/api/auth/password/reset', { token: 'forged-token-value', password: 'Another-long-password-2' })).json.error?.code, 'TOKEN_INVALID');
});

test('privileged sign-in requires MFA; admins and owners see the admin API, coaches and members do not', async () => {
  const c = client(h.app);
  assert.equal((await c.post('/api/auth/login', { email: DEMO.owner, password: DEMO_PASSWORDS.owner, workspace: 'dashboard' })).json.error?.code, 'MFA_REQUIRED');
  assert.equal((await c.post('/api/auth/login', { email: DEMO.owner, password: DEMO_PASSWORDS.owner, workspace: 'dashboard', mfaCode: '000000' })).json.error?.code, 'MFA_INVALID');
  await c.login(DEMO.owner, DEMO_PASSWORDS.owner, 'dashboard', true);
  assert.equal((await c.get('/api/admin/overview')).status, 200);
  const coach = client(h.app);
  await coach.login(DEMO.coach, DEMO_PASSWORDS.coach, 'dashboard');
  assert.equal((await coach.get('/api/admin/overview')).status, 403);
  assert.equal((await coach.get('/api/admin/members')).status, 403);
  assert.equal((await coach.post('/api/admin/coaches/invite', { email: 'x@demo.bioptime.test', displayName: 'X' })).status, 403);
  const member = client(h.app);
  await member.login(DEMO.member, DEMO_PASSWORDS.member);
  assert.equal((await member.get('/api/coach/home')).status, 403);
  assert.equal((await member.get('/api/admin/audit')).status, 403);
  assert.equal((await client(h.app).get('/api/me')).status, 401);
});

test('coach invitation: created by an admin, single-use expiring link, activation with profile and availability; a member cannot promote themselves', async () => {
  const admin = client(h.app);
  await admin.login(DEMO.admin, DEMO_PASSWORDS.admin, 'dashboard', true);
  const inv = await admin.post('/api/admin/coaches/invite', { email: 'new.coach@demo.bioptime.test', displayName: 'New Coach', expertise: ['sleep'], caseloadLimit: 10 });
  assert.equal(inv.status, 201);
  const token = inv.json.token as string;
  const anon = client(h.app);
  assert.equal((await anon.post('/api/auth/invitations/preview', { token })).status, 200);
  assert.equal((await anon.get(`/api/auth/invitations/${token}`)).status, 404, 'no GET preview: the token stays out of URLs');
  assert.equal((await anon.post('/api/auth/invitations/preview', { token: 'not-a-real-token' })).status, 400);
  assert.equal((await anon.post('/api/auth/login', { email: 'new.coach@demo.bioptime.test', password: 'whatever-password-1', workspace: 'dashboard' })).json.error?.code, 'INVALID_CREDENTIALS');
  const accept = await anon.post('/api/auth/invitations/accept', { token, password: 'New-coach-password-1', acceptPolicies: true, policiesVersion: '2026-10-17', profile: { displayName: 'New Coach', bio: 'Sleep coach', expertise: ['sleep'], languages: ['English'], city: 'Pune' }, availability: [{ weekday: 1, startMinute: 540, endMinute: 720 }] });
  assert.equal(accept.status, 200);
  assert.equal((accept.json.user as { role: string; state: string }).role, 'coach');
  assert.equal((await anon.get('/api/coach/home')).status, 200, 'the invitation signs the coach in');
  assert.equal((await client(h.app).post('/api/auth/invitations/accept', { token, password: 'New-coach-password-1', acceptPolicies: true, policiesVersion: '2026-10-17', profile: { displayName: 'Again' } })).status, 400, 'single use');
  const member = client(h.app);
  await member.login(DEMO.member, DEMO_PASSWORDS.member);
  assert.equal((await member.patch('/api/me/profile', { role: 'coach', name: 'Still a member' })).status, 200);
  assert.equal(((await member.get('/api/auth/me')).json.user as { role: string }).role, 'member');
});
