/* Removing a coach or client (owner decision, 30 October 2026) is deactivating or closing the account through the
   existing PATCH /admin/coaches/:id/state and PATCH /admin/members/:id/state: sign-in is blocked (email, Coach ID),
   existing sessions end, every record is kept, a reason is required and audited, and reactivating restores access.
   A closed account is reopened only when no deletion request is on record and it had been set up. Never a hard delete. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId } from '../helpers.js';

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); h.db.close(); });

const owner = async () => { const c = client(h.app); await c.login(DEMO.owner, DEMO_PASSWORDS.owner, 'dashboard', true); return c; };
const code = (r: { json: { error?: { code: string; details?: unknown } } }) => (r.json.error?.code === 'INVALID_STATE' ? (r.json.error.details as { code?: string } | undefined)?.code ?? 'INVALID_STATE' : r.json.error?.code);
const counts = (id: string) => ({
  assignments: h.db.get<{ n: number }>('SELECT COUNT(*) n FROM coach_assignments WHERE member_id = ? OR coach_id = ?', [id, id])!.n,
  appointments: h.db.get<{ n: number }>('SELECT COUNT(*) n FROM appointments WHERE member_id = ? OR coach_id = ?', [id, id])!.n,
  plans: h.db.get<{ n: number }>('SELECT COUNT(*) n FROM coaching_plans WHERE member_id = ? OR coach_id = ?', [id, id])!.n,
  orders: h.db.get<{ n: number }>('SELECT COUNT(*) n FROM orders WHERE member_id = ?', [id])!.n,
  user: h.db.get<{ n: number }>('SELECT COUNT(*) n FROM users WHERE id = ?', [id])!.n,
});
const lastStateAudit = (id: string) => h.db.get<{ actor_id: string; reason: string; data: string }>("SELECT actor_id, reason, data FROM audit_events WHERE action = 'account.state' AND target_id = ? ORDER BY at DESC, rowid DESC LIMIT 1", [id])!;

test('deactivating a coach blocks email and Coach ID sign-in, ends their sessions, keeps every record, needs a reason; reactivating restores access', async () => {
  const email = DEMO.coach2;
  const id = userId(h.ctx, email);
  const coachId = h.db.get<{ coach_code: string }>('SELECT coach_code FROM coach_profiles WHERE user_id = ?', [id])!.coach_code;
  const web = client(h.app), mobile = client(h.app);
  assert.equal((await web.post('/api/auth/login', { coachId, password: DEMO_PASSWORDS.coach, workspace: 'coach' })).status, 200);
  const m = await mobile.post('/api/auth/login', { email, password: DEMO_PASSWORDS.coach, workspace: 'coach' }, { 'x-bioptime-client': 'mobile' });
  mobile.useBearer((m.json.session as { token: string }).token);
  assert.equal((await web.get('/api/coach/clients')).status, 200);
  const before = counts(id);

  const o = await owner();
  assert.equal((await o.patch(`/api/admin/coaches/${id}/state`, { state: 'deactivated' })).json.error?.code, 'VALIDATION_FAILED', 'a reason is required');
  assert.equal((await o.patch(`/api/admin/coaches/${id}/state`, { state: 'deactivated', reason: 'x' })).json.error?.code, 'VALIDATION_FAILED', 'a real reason');
  const off = await o.patch(`/api/admin/coaches/${id}/state`, { state: 'deactivated', reason: 'Left Bioptime' });
  assert.equal(off.status, 200, JSON.stringify(off.json));
  assert.equal((off.json as { state: string }).state, 'deactivated');
  const row = lastStateAudit(id);
  assert.deepEqual([row.actor_id, row.reason, JSON.parse(row.data).to], [userId(h.ctx, DEMO.owner), 'Left Bioptime', 'deactivated']);

  assert.equal((await web.get('/api/coach/clients')).status, 401, 'the web session ended');
  assert.equal((await mobile.get('/api/auth/me')).status, 401, 'and the mobile one');
  for (const body of [{ email, password: DEMO_PASSWORDS.coach, workspace: 'coach' }, { coachId, password: DEMO_PASSWORDS.coach, workspace: 'coach' }]) {
    const r = await client(h.app).post('/api/auth/login', body);
    assert.deepEqual([r.status, r.json.error?.code], [403, 'ACCOUNT_CLOSED'], JSON.stringify(body));
  }
  const after = counts(id);
  assert.deepEqual({ ...after }, { ...before }, 'nothing was deleted');
  assert.equal((await o.get(`/api/admin/coaches/${id}`)).status, 200, 'the record stays readable for administrators');
  assert.equal(((await o.get('/api/admin/coaches')).json.items as Array<{ id?: string; userId?: string; state?: string }>).some((c) => (c.id ?? c.userId) === id), true, 'and listed');

  const on = await o.patch(`/api/admin/coaches/${id}/state`, { state: 'active', reason: 'Back with Bioptime' });
  assert.equal(on.status, 200, JSON.stringify(on.json));
  const back = client(h.app);
  assert.equal((await back.post('/api/auth/login', { coachId, password: DEMO_PASSWORDS.coach, workspace: 'coach' })).status, 200, 'reactivated: the Coach ID signs in again');
  assert.equal((await back.get('/api/coach/clients')).status, 200);
});

test('a client: deactivate, close (records kept, sessions ended, sign-in blocked) and reactivate', async () => {
  const email = 'sunita.bhat@demo.bioptime.test';
  const id = userId(h.ctx, email);
  const m = client(h.app);
  await m.login(email, DEMO_PASSWORDS.member, 'member');
  assert.equal((await m.get('/api/me')).status, 200);
  const before = counts(id);
  const o = await owner();
  assert.equal(code(await o.patch(`/api/admin/members/${id}/state`, { state: 'closed', reason: 'Asked to leave' })), 'INVALID_STATE', 'an active account is deactivated first, as before');
  assert.equal((await o.patch(`/api/admin/members/${id}/state`, { state: 'deactivated', reason: 'Asked to leave' })).status, 200);
  assert.equal((await m.get('/api/me')).status, 401, 'the session ended');
  assert.equal((await o.patch(`/api/admin/members/${id}/state`, { state: 'closed', reason: 'Asked to close the account' })).status, 200);
  const r = await client(h.app).post('/api/auth/login', { email, password: DEMO_PASSWORDS.member, workspace: 'client' });
  assert.deepEqual([r.status, r.json.error?.code], [403, 'ACCOUNT_CLOSED']);
  assert.deepEqual({ ...counts(id) }, { ...before }, 'records kept');
  assert.equal((await o.get(`/api/admin/members/${id}`)).status, 200);
  const reopen = await o.patch(`/api/admin/members/${id}/state`, { state: 'active', reason: 'Came back' });
  assert.equal(reopen.status, 200, JSON.stringify(reopen.json));
  assert.equal(JSON.parse(lastStateAudit(id).data).reopened, true, 'the reopening is audited as such');
  const again = client(h.app);
  await again.login(email, DEMO_PASSWORDS.member, 'member');
  assert.equal((await again.get('/api/me')).status, 200, 'reactivated: the client signs in again');
});

test('an account still onboarding can be deactivated and reactivated too', async () => {
  const id = userId(h.ctx, DEMO.memberIncomplete);
  assert.equal(h.db.get<{ state: string }>('SELECT state FROM users WHERE id = ?', [id])!.state, 'onboarding');
  const o = await owner();
  assert.equal((await o.patch(`/api/admin/members/${id}/state`, { state: 'deactivated', reason: 'Duplicate sign-up' })).status, 200);
  assert.equal((await client(h.app).post('/api/auth/login', { email: DEMO.memberIncomplete, password: DEMO_PASSWORDS.member, workspace: 'member' })).json.error?.code, 'ACCOUNT_CLOSED');
  assert.equal((await o.patch(`/api/admin/members/${id}/state`, { state: 'active', reason: 'Not a duplicate after all' })).status, 200);
  assert.equal((await client(h.app).post('/api/auth/login', { email: DEMO.memberIncomplete, password: DEMO_PASSWORDS.member, workspace: 'member' })).status, 200);
});

test('a closed account is not reopened after a deletion request, nor when it was never set up', async () => {
  const email = 'lakshmi.venkat@demo.bioptime.test';
  const id = userId(h.ctx, email);
  const m = client(h.app);
  await m.login(email, DEMO_PASSWORDS.member, 'member');
  assert.equal((await m.post('/api/me/data-requests', { kind: 'deletion' })).status, 201);
  const o = await owner();
  assert.equal((await o.patch(`/api/admin/members/${id}/state`, { state: 'closed', reason: 'Deletion completed' })).status, 200);
  assert.equal(code(await o.patch(`/api/admin/members/${id}/state`, { state: 'active', reason: 'Try to reopen' })), 'DELETION_REQUESTED');
  assert.equal(h.db.get<{ state: string }>('SELECT state FROM users WHERE id = ?', [id])!.state, 'closed');

  const inv = await o.post('/api/admin/members/invite', { email: 'never.set.up@demo.bioptime.test', name: 'Never Set Up', reason: 'test' });
  const invitedId = (inv.json.user as { id: string }).id;
  assert.equal((await o.patch(`/api/admin/members/${invitedId}/state`, { state: 'closed', reason: 'Invitation withdrawn' })).status, 200);
  assert.equal(code(await o.patch(`/api/admin/members/${invitedId}/state`, { state: 'active', reason: 'Try to reopen' })), 'NEVER_ACTIVATED');
  // only to active: a closed account does not move to any other state
  assert.equal(code(await o.patch(`/api/admin/members/${id}/state`, { state: 'suspended', reason: 'Try another state' })), 'INVALID_STATE');
});

test('administrators without members.manage or coaches.manage cannot remove anyone; coaches and members never', async () => {
  const memberId = userId(h.ctx, DEMO.member2);
  const coachId = userId(h.ctx, DEMO.coach3);
  const c = client(h.app);
  await c.login(DEMO.coach, DEMO_PASSWORDS.coach, 'dashboard');
  assert.equal((await c.patch(`/api/admin/members/${memberId}/state`, { state: 'deactivated', reason: 'not allowed' })).status, 403);
  const mem = client(h.app);
  await mem.login(DEMO.member, DEMO_PASSWORDS.member, 'member');
  assert.equal((await mem.patch(`/api/admin/coaches/${coachId}/state`, { state: 'deactivated', reason: 'not allowed' })).status, 403);
  const o = await owner();
  const adminId = userId(h.ctx, DEMO.admin);
  await o.post(`/api/admin/users/${adminId}/permissions`, { permission: 'coaches.manage', granted: false, reason: 'test: without coaches.manage' });
  try {
    const a = client(h.app);
    await a.login(DEMO.admin, DEMO_PASSWORDS.admin, 'dashboard', true);
    assert.equal((await a.patch(`/api/admin/coaches/${coachId}/state`, { state: 'deactivated', reason: 'not allowed' })).json.error?.code, 'PERMISSION_DENIED');
  } finally {
    await o.post(`/api/admin/users/${adminId}/permissions`, { permission: 'coaches.manage', granted: true, reason: 'test: restored' });
  }
  assert.equal(h.db.get<{ state: string }>('SELECT state FROM users WHERE id = ?', [coachId])!.state, 'active');
  assert.equal(h.db.get<{ state: string }>('SELECT state FROM users WHERE id = ?', [memberId])!.state, 'active');
});
