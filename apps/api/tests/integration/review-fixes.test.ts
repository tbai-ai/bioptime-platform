/* Regression tests for the defects found by the adversarial review of 22 October 2026. Each test names the rule it guards. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId } from '../helpers.js';

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); h.db.close(); });

test('MFA: a live admin session cannot switch an enabled second factor off through /auth/mfa/setup', async () => {
  const c = client(h.app);
  await c.login(DEMO.owner, DEMO_PASSWORDS.owner, 'dashboard', true);
  const setup = await c.post('/api/auth/mfa/setup');
  assert.equal(setup.status, 409, 'setup is refused while MFA is enabled');
  assert.equal(setup.json.error?.details && (setup.json.error.details as { code: string }).code, 'MFA_ALREADY_ENABLED');
  const d = client(h.app);
  const pw = await d.post('/api/auth/login', { email: DEMO.owner, password: DEMO_PASSWORDS.owner, workspace: 'dashboard' });
  assert.equal(pw.json.error?.code, 'MFA_REQUIRED', 'the password alone still does not sign in');
});

test('MFA: wrong codes count toward the lockout like wrong passwords', async () => {
  const c = client(h.app);
  let last = 0;
  for (let i = 0; i < 6; i++) { const r = await c.post('/api/auth/login', { email: DEMO.admin, password: DEMO_PASSWORDS.admin, workspace: 'dashboard', mfaCode: '000000' }); last = r.status; }
  assert.equal(last, 429, 'the sixth attempt is locked out');
  h.db.run('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE email = ?', [DEMO.admin]); // leave the account usable for other tests
});

test('consent: no recorded coach_sharing consent means the coach sees no health records', async () => {
  const m = client(h.app);
  const reg = await m.post('/api/auth/register', { email: 'quiet.member@demo.bioptime.test', password: 'A-long-demo-password-2', name: 'Quiet Member', acceptTerms: true, acceptPrivacy: true, termsVersion: '2026-10-17' });
  assert.equal(reg.status, 201);
  await m.post('/api/auth/verify-email', { token: (reg.json.verification as { demoToken: string }).demoToken });
  for (const step of ['profile', 'goals', 'programme_info', 'how_it_works']) assert.equal((await m.post('/api/me/onboarding', { step, data: {} })).status, 200);
  assert.equal((await m.post('/api/me/onboarding', { step: 'consents', data: { healthData: true, labConsent: true } })).status, 200, 'coachSharing omitted entirely');
  const memberId = userId(h.ctx, 'quiet.member@demo.bioptime.test');
  const o = client(h.app);
  await o.login(DEMO.owner, DEMO_PASSWORDS.owner, 'dashboard', true);
  const assign = await o.post('/api/admin/assignments', { memberId, coachId: userId(h.ctx, DEMO.coach), reason: 'review regression test', method: 'override' });
  assert.equal(assign.status, 201, JSON.stringify(assign.json));
  const coach = client(h.app);
  await coach.login(DEMO.coach, DEMO_PASSWORDS.coach, 'dashboard');
  const detail = await coach.get(`/api/coach/clients/${memberId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.json.healthShared, false, 'no consent row is reported as not shared');
  const blood = await coach.get(`/api/coach/clients/${memberId}/bloodwork`);
  assert.equal(blood.status, 403);
  assert.equal(blood.json.error?.code, 'NOT_SHARED');
  const bookings = await coach.get('/api/coach/bookings');
  assert.ok(!(bookings.json.items as Array<{ memberId: string }>).some((b) => b.memberId === memberId), 'coach listings exclude unshared members');
});

test('CSRF: a percent-encoded /api path is still an API path', async () => {
  const c = client(h.app);
  await c.login(DEMO.member, DEMO_PASSWORDS.member, 'member');
  const res = await h.app.inject({ method: 'POST', url: '/%61pi/me/consents', headers: { 'content-type': 'application/json', cookie: c.cookie }, payload: JSON.stringify({ kind: 'marketing', version: 'x', granted: true }) });
  assert.equal(res.statusCode, 403, 'cookie session without the client header is refused even when the prefix is encoded');
});

test('idempotency: another member reusing my key gets their own order, never mine', async () => {
  const pkg = (await client(h.app).get('/api/packages')).json.items as Array<{ id: string; slug: string }>;
  const core = pkg.find((p) => p.slug === 'core')!;
  const a = client(h.app); await a.login(DEMO.member, DEMO_PASSWORDS.member, 'member');
  const b = client(h.app); await b.login(DEMO.member2, DEMO_PASSWORDS.member, 'member');
  const first = await a.post('/api/me/checkout', { packageId: core.id, idempotencyKey: 'shared-key-0001' });
  assert.equal(first.status, 201, JSON.stringify(first.json));
  const second = await b.post('/api/me/checkout', { packageId: core.id, idempotencyKey: 'shared-key-0001' });
  assert.equal(second.status, 201, JSON.stringify(second.json));
  assert.notEqual((second.json.order as { id: string }).id, (first.json.order as { id: string }).id);
  const again = await a.post('/api/me/checkout', { packageId: core.id, idempotencyKey: 'shared-key-0001' });
  assert.equal((again.json.order as { id: string }).id, (first.json.order as { id: string }).id, 'the same member and key returns the same order');
});

test('payments: a coach cannot settle a member checkout; a capture for a cancelled order is recorded, not thrown', async () => {
  const pkg = (await client(h.app).get('/api/packages')).json.items as Array<{ id: string; slug: string }>;
  const starter = pkg.find((p) => p.slug === 'starter')!;
  const m = client(h.app); await m.login(DEMO.memberNoCoach, DEMO_PASSWORDS.member, 'member');
  const co = await m.post('/api/me/checkout', { packageId: starter.id, idempotencyKey: 'cancel-then-capture-1' });
  assert.equal(co.status, 201, JSON.stringify(co.json));
  const checkoutId = (co.json.checkout as { checkoutId: string }).checkoutId;
  const orderId = (co.json.order as { id: string }).id;
  const coach = client(h.app); await coach.login(DEMO.coach, DEMO_PASSWORDS.coach, 'dashboard');
  assert.equal((await coach.post('/api/payments/simulator/complete', { checkoutId, outcome: 'captured' })).status, 403);
  assert.equal((await m.post(`/api/me/orders/${orderId}/cancel`, { reason: 'changed my mind' })).status, 200);
  const late = await m.post('/api/payments/simulator/complete', { checkoutId, outcome: 'captured' });
  assert.equal(late.status, 200, JSON.stringify(late.json));
  assert.equal(late.json.outcome, 'captured_unexpected');
  assert.equal((late.json.order as { status: string }).status, 'cancelled', 'the order is not activated');
  const o = client(h.app); await o.login(DEMO.owner, DEMO_PASSWORDS.owner, 'dashboard', true);
  const tasks = (await o.get('/api/admin/operations/tasks?kind=payment_mismatch')).json.items as Array<{ ref_id: string }>;
  assert.ok(tasks.some((t) => t.ref_id === orderId), 'a support task raises the unexpected capture');
});

test('custom plans: activation can never be set by hand', async () => {
  const o = client(h.app); await o.login(DEMO.owner, DEMO_PASSWORDS.owner, 'dashboard', true);
  const list = (await o.get('/api/admin/custom-plans')).json.items as Array<{ id: string; allowedNext: string[] }>;
  assert.ok(list.length > 0);
  assert.ok(list.every((r) => !r.allowedNext.includes('activated')), 'activated is never offered as a next state');
  const r = await o.post(`/api/admin/custom-plans/${list[0]!.id}/transition`, { to: 'activated' });
  assert.equal(r.status, 400);
});

test('contact form: unknown topics are normalised and never reach the stored message', async () => {
  const anon = client(h.app);
  const r = await anon.post('/api/contact', { name: 'Topic Tester', email: 'topic@example.com', topic: '__proto__', message: 'A message long enough to be accepted by the form.' });
  assert.equal(r.status, 200);
  const o = client(h.app); await o.login(DEMO.owner, DEMO_PASSWORDS.owner, 'dashboard', true);
  const items = (await o.get('/api/admin/enquiries')).json.items as Array<{ email: string; message: string }>;
  const mine = items.find((e) => e.email === 'topic@example.com');
  assert.ok(mine && mine.message.startsWith('[General question]'), 'the topic falls back to the general label');
});

test('refund: scheduled consultations and open bookings of the refunded order are cancelled', async () => {
  const o = client(h.app); await o.login(DEMO.owner, DEMO_PASSWORDS.owner, 'dashboard', true);
  const memberId = userId(h.ctx, DEMO.member);
  const orders = (await o.get(`/api/admin/orders?memberId=${memberId}`)).json.items as Array<{ id: string; status: string }>;
  const active = orders.find((x) => x.status === 'activated');
  assert.ok(active, 'the seeded member has an activated order');
  const before = (await o.get(`/api/admin/appointments?range=all`)).json.items as Array<{ memberId: string; status: string }>;
  assert.ok(before.some((a) => a.memberId === memberId && (a.status === 'scheduled' || a.status === 'requested')), 'there is an open consultation to cancel');
  const r = await o.post(`/api/admin/orders/${active!.id}/refund`, { reason: 'review regression test' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const after = (await o.get(`/api/admin/appointments?range=all`)).json.items as Array<{ memberId: string; status: string }>;
  assert.ok(!after.some((a) => a.memberId === memberId && (a.status === 'scheduled' || a.status === 'requested')), 'no open consultation remains');
  const bookings = (await o.get(`/api/admin/bloodwork/bookings`)).json.items as Array<{ memberId: string; status: string }>;
  assert.ok(!bookings.some((b) => b.memberId === memberId && (b.status === 'confirmed' || b.status === 'scheduled')), 'no open booking remains');
});
