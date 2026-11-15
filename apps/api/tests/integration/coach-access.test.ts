/* The coach workspace through direct API calls: identity, the enriched client list, the field-level policy that keeps
   phone, address, PIN code, email and date of birth out of every coach response, unassigned clients refused by id,
   note visibility, the LabStack administration refused to coaches and members, and codes that never change. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId } from '../helpers.js';
import { findRestrictedFields, restrictedKeys } from '../../src/auth/fieldPolicy.js';

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); h.db.close(); });

const RESTRICTED = restrictedKeys();

test('coach identity: a stable coach code, designation, statuses and workload come with the profile and the home', async () => {
  const c = client(h.app);
  await c.login(DEMO.coach, DEMO_PASSWORDS.coach, 'dashboard');
  const p = await c.get('/api/coach/profile');
  assert.equal(p.status, 200);
  assert.match(String(p.json.coachCode), /^BPC-\d{4}$/, 'every coach carries a BPC code');
  assert.ok(['complete', 'incomplete'].includes(String(p.json.profileStatus)));
  assert.equal(typeof p.json.caseload, 'number');
  const home = await c.get('/api/coach/home');
  assert.equal((home.json.coach as { coachCode: string }).coachCode, p.json.coachCode);
  const { coach: _self, ...clientsSide } = home.json as Record<string, unknown>; // the coach's own contact details are theirs to see
  assert.ok(!findRestrictedFields(clientsSide, RESTRICTED).length, `the coach home carries no restricted client field: ${findRestrictedFields(clientsSide, RESTRICTED).join(', ')}`);
  // the code is not editable through the profile route
  const edit = await c.patch('/api/coach/profile', { displayName: 'Asha M.', coachCode: 'BPC-9999' });
  assert.equal(edit.status, 200);
  assert.equal((await c.get('/api/coach/profile')).json.coachCode, p.json.coachCode);
});

test('client list: assigned clients only, with package, progress, next appointment, last check-in and bloodwork status; search, sort and pagination; no restricted field', async () => {
  const c = client(h.app);
  await c.login(DEMO.coach, DEMO_PASSWORDS.coach, 'dashboard');
  const list = await c.get('/api/coach/clients?limit=2&page=1&sort=name');
  assert.equal(list.status, 200);
  const items = list.json.items as Array<Record<string, unknown>>;
  assert.equal(items.length, 2, 'paginated');
  assert.ok(Number(list.json.total) >= 2);
  for (const it of items) {
    assert.match(String(it.memberCode), /^BPM-\d{5}$/);
    assert.ok('programme' in it && 'progress' in it && 'nextAppointmentAt' in it && 'lastCheckInAt' in it && 'bloodworkStatus' in it && 'engagement' in it && 'assignment' in it);
    assert.equal(it.email, undefined); assert.equal(it.phone, undefined);
  }
  assert.ok(!findRestrictedFields(list.json, RESTRICTED).length);
  const all = await c.get('/api/coach/clients?limit=100');
  const total = (all.json.items as unknown[]).length;
  const byCode = await c.get(`/api/coach/clients?q=${encodeURIComponent(String(items[0]!.memberCode))}`);
  assert.equal((byCode.json.items as unknown[]).length, 1, 'search by member code');
  const ended = await c.get('/api/coach/clients?status=ended');
  assert.equal(ended.status, 200);
  const memberId = userId(h.ctx, DEMO.member);
  assert.ok((all.json.items as Array<{ id: string }>).some((i) => i.id === memberId), 'the assigned demo member is listed');
  assert.ok(total >= 1);
});

test('client record: the coaching view carries age, goals, consents, onboarding answers and assignment history, never phone, address, PIN, email or date of birth; the id of another coach’s client is refused', async () => {
  const c = client(h.app);
  await c.login(DEMO.coach, DEMO_PASSWORDS.coach, 'dashboard');
  const memberId = userId(h.ctx, DEMO.member);
  const d = await c.get(`/api/coach/clients/${memberId}`);
  assert.equal(d.status, 200);
  const found = findRestrictedFields(d.json, RESTRICTED);
  assert.deepEqual(found, [], `restricted fields in the coach view: ${found.join(', ')}`);
  const view = d.json.profile as { profile: { age: number | null; goals: string[]; city: string | null }; consents: Record<string, unknown>; memberCode: string };
  assert.match(view.memberCode, /^BPM-\d{5}$/);
  assert.ok(typeof view.profile.age === 'number' || view.profile.age === null);
  assert.ok(Array.isArray(view.profile.goals) && view.consents);
  assert.ok(Array.isArray(d.json.assignmentHistory));
  assert.ok(d.json.onboardingResponses === null || !('profile' in (d.json.onboardingResponses as object)), 'the onboarding profile step (contact details) stays out');
  const raw = JSON.stringify(d.json);
  const member = h.db.get<{ phone: string | null; email: string }>('SELECT phone, email FROM users WHERE id = ?', [memberId])!;
  if (member.phone) assert.ok(!raw.includes(member.phone) && !raw.includes(member.phone.slice(-4) + '"'), 'not even a masked phone');
  assert.ok(!raw.includes(member.email), 'the email never appears');
  // a client assigned to a different coach
  const other = h.db.get<{ member_id: string }>("SELECT member_id FROM coach_assignments WHERE status = 'active' AND coach_id != ? LIMIT 1", [userId(h.ctx, DEMO.coach)]);
  assert.ok(other, 'the seed has clients of other coaches');
  assert.equal((await c.get(`/api/coach/clients/${other!.member_id}`)).json.error?.code, 'NO_ACCESS');
  assert.equal((await c.get(`/api/coach/clients/${other!.member_id}/bloodwork`)).json.error?.code, 'NO_ACCESS');
  assert.equal((await c.get(`/api/coach/clients/${other!.member_id}/assignments`)).json.error?.code, 'NO_ACCESS');
  assert.equal((await c.post(`/api/coach/clients/${other!.member_id}/notes`, { body: 'x' })).json.error?.code, 'NO_ACCESS');
  // bookings across clients carry no collection address
  const bookings = await c.get('/api/coach/bookings');
  assert.equal(bookings.status, 200);
  assert.deepEqual(findRestrictedFields(bookings.json, RESTRICTED), []);
});

test('field policy: no setting opens a contact or identity field to coaches; only city and state can be switched', async () => {
  const owner = client(h.app), coach = client(h.app);
  await owner.login(DEMO.owner, DEMO_PASSWORDS.owner, 'dashboard', true);
  await coach.login(DEMO.coach, DEMO_PASSWORDS.coach, 'dashboard');
  const memberId = userId(h.ctx, DEMO.member);
  for (const k of ['email', 'phone', 'address', 'pincode', 'dateOfBirth']) {
    const r = await owner.patch('/api/admin/settings', { key: 'coach_field_policy', value: { [k]: true }, reason: 'test: must be refused' });
    assert.equal(r.json.error?.code, 'POLICY_SHAPE', `${k} cannot be opened, even by the owner`);
  }
  // a value stored before this rule (or written directly) is ignored for the contact fields
  h.db.run("INSERT INTO settings (key, value, updated_at) VALUES ('coach_field_policy', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify({ email: true, phone: true, address: true, pincode: true, dateOfBirth: true, city: true, state: true }), new Date().toISOString()]);
  const leaked = await coach.get(`/api/coach/clients/${memberId}`);
  assert.equal(leaked.status, 200);
  assert.deepEqual(findRestrictedFields(leaked.json, RESTRICTED), [], 'a stored opening is ignored');
  assert.equal((await owner.patch('/api/admin/settings', { key: 'coach_field_policy', value: { city: false }, reason: 'test: close city' })).status, 200);
  const d = await coach.get(`/api/coach/clients/${memberId}`);
  assert.equal('city' in (d.json.profile as { profile: Record<string, unknown> }).profile, false, 'city closed');
  assert.ok('state' in (d.json.profile as { profile: Record<string, unknown> }).profile, 'state still open');
  assert.equal((await owner.patch('/api/admin/settings', { key: 'coach_field_policy', value: { city: true, state: true }, reason: 'test: restore' })).status, 200);
});

test('notes: private notes stay with the team, client-visible notes reach the member, administrative notes come from the admin and never reach the member', async () => {
  const coach = client(h.app), member = client(h.app), admin = client(h.app);
  await coach.login(DEMO.coach, DEMO_PASSWORDS.coach, 'dashboard');
  await member.login(DEMO.member, DEMO_PASSWORDS.member);
  await admin.login(DEMO.admin, DEMO_PASSWORDS.admin, 'dashboard', true);
  const memberId = userId(h.ctx, DEMO.member);
  assert.equal((await coach.post(`/api/coach/clients/${memberId}/notes`, { body: 'private: watch the sleep log', visibility: 'private' })).status, 201);
  assert.equal((await coach.post(`/api/coach/clients/${memberId}/notes`, { body: 'For you: add a 20 minute walk after dinner this week.', visibility: 'client' })).status, 201);
  assert.equal((await coach.post(`/api/coach/clients/${memberId}/notes`, { body: 'x', visibility: 'admin' })).status, 400, 'a coach cannot write administrative notes');
  assert.equal((await admin.post(`/api/admin/members/${memberId}/notes`, { body: 'admin: refund query open', reason: 'test' })).status, 201);
  const mine = await member.get('/api/me/notes');
  const bodies = (mine.json.items as Array<{ body: string }>).map((n) => n.body);
  assert.ok(bodies.some((b) => b.startsWith('For you')) && !bodies.some((b) => b.startsWith('private')) && !bodies.some((b) => b.startsWith('admin')), 'the member sees only client-visible notes');
  const view = await coach.get(`/api/coach/clients/${memberId}`);
  const kinds = (view.json.notes as Array<{ visibility: string }>).map((n) => n.visibility);
  assert.ok(kinds.includes('private') && kinds.includes('client') && kinds.includes('admin'), 'the assigned coach reads all three categories');
});

test('LabStack administration is refused to coaches and members at the API, whatever the URL', async () => {
  const coach = client(h.app), member = client(h.app), anon = client(h.app);
  await coach.login(DEMO.coach, DEMO_PASSWORDS.coach, 'dashboard');
  await member.login(DEMO.member, DEMO_PASSWORDS.member);
  for (const [who, c] of [['coach', coach], ['member', member], ['anonymous', anon]] as const) {
    for (const path of ['/api/admin/integrations/labstack/status', '/api/admin/integrations/labstack/sync', '/api/admin/settings']) {
      const r = path.endsWith('/sync') ? await c.post(path) : await c.get(path);
      assert.ok(r.status === 401 || r.status === 403, `${who} ${path} → ${r.status}`);
    }
  }
});

test('codes are assigned at creation and survive edits', async () => {
  const c = client(h.app);
  const reg = await c.post('/api/auth/register', { email: 'coded@demo.bioptime.test', password: 'A-long-demo-password-1', name: 'Coded Member', acceptTerms: true, acceptPrivacy: true, termsVersion: '2026-10-17' });
  assert.equal(reg.status, 201);
  const row = h.db.get<{ member_code: string }>('SELECT member_code FROM member_profiles WHERE user_id = ?', [(reg.json.user as { id: string }).id])!;
  assert.match(row.member_code, /^BPM-\d{5}$/);
  const dup = h.db.get<{ n: number }>('SELECT COUNT(*) n FROM member_profiles WHERE member_code = ?', [row.member_code])!.n;
  assert.equal(dup, 1);
});

test('review fixes: an ended assignment ends the coach’s access to the conversation, plan and appointments; unshared laboratory flags stay off the coach home; the activity feed carries no administrator reasons; sort and policy inputs are safe', async () => {
  const owner = client(h.app), coach = client(h.app), coach2 = client(h.app);
  await owner.login(DEMO.owner, DEMO_PASSWORDS.owner, 'dashboard', true);
  await coach.login(DEMO.coach, DEMO_PASSWORDS.coach, 'dashboard');
  await coach2.login(DEMO.coach2, DEMO_PASSWORDS.coach, 'dashboard');
  const coachId = userId(h.ctx, DEMO.coach), coach2Id = userId(h.ctx, DEMO.coach2);
  // a member the coach currently has, with a conversation and a plan
  const memberId = userId(h.ctx, DEMO.member);
  const convs = await coach.get('/api/conversations');
  const conv = (convs.json.items as Array<{ id: string; memberId: string }>).find((c) => c.memberId === memberId);
  assert.ok(conv, 'the demo coach has a conversation with the demo member');
  const plans = await coach.get('/api/coach/plans');
  const plan = (plans.json.items as Array<{ id: string; member_id: string }>).find((p) => p.member_id === memberId);
  const appts = await coach.get('/api/coach/appointments?range=all');
  const appt = (appts.json.items as Array<{ id: string; memberId: string; status: string }>).find((a) => a.memberId === memberId && ['requested', 'scheduled'].includes(a.status));
  // the activity feed before: audit reasons written by administrators never reach the coach
  assert.equal((await owner.post(`/api/admin/members/${memberId}/entitlements/adjust`, { serviceType: 'consultation', delta: 1, reason: 'PROBE-REASON chargeback on card ending 4242', idempotencyKey: 'feed-probe-1' })).status, 200);
  const home = await coach.get('/api/coach/home');
  assert.ok(!JSON.stringify(home.json).includes('PROBE-REASON'), 'administrator reasons are not in the coach activity feed');
  assert.ok(!(home.json.recentActivity as Array<{ action: string }>).some((a) => a.action.startsWith('auth.') || a.action.startsWith('entitlement.')), 'the feed lists coaching actions only');
  // reassign to another coach
  const re = await owner.post('/api/admin/assignments', { memberId, coachId: coach2Id, reason: 'test: reassign for access check' });
  assert.ok([200, 201].includes(re.status), JSON.stringify(re.json));
  assert.equal((await coach.get(`/api/conversations/${conv!.id}/messages`)).json.error?.code, 'NO_ACCESS', 'the former coach cannot read the thread');
  assert.equal((await coach.post(`/api/conversations/${conv!.id}/messages`, { body: 'still here?' })).json.error?.code, 'NO_ACCESS');
  assert.ok(!((await coach.get('/api/conversations')).json.items as Array<{ memberId: string }>).some((c) => c.memberId === memberId), 'the thread leaves the former coach’s list');
  if (plan) { assert.equal((await coach.get(`/api/coach/plans/${plan.id}`)).json.error?.code, 'NO_ACCESS'); assert.equal((await coach.patch(`/api/coach/plans/${plan.id}`, { title: 'x' })).json.error?.code, 'NO_ACCESS'); }
  if (appt) assert.equal((await coach.post(`/api/coach/appointments/${appt.id}/complete`, {})).json.error?.code, 'NO_ACCESS');
  assert.equal((await coach.get(`/api/coach/clients/${memberId}`)).json.error?.code, 'NO_ACCESS');
  // the new coach has it all
  assert.equal((await coach2.get(`/api/coach/clients/${memberId}`)).status, 200);
  // unshared laboratory flags: a non-sharing member's unreviewed report never appears on the home queue
  const noShare = userId(h.ctx, DEMO.memberNoShare);
  const whose = h.db.get<{ coach_id: string }>("SELECT coach_id FROM coach_assignments WHERE member_id = ? AND status IN ('active','paused')", [noShare]);
  if (whose) {
    const c = whose.coach_id === coachId ? coach : whose.coach_id === coach2Id ? coach2 : null;
    if (c) {
      const hm = await c.get('/api/coach/home');
      assert.ok(!(hm.json.reportsToReview as Array<{ member_id: string }>).some((r) => r.member_id === noShare), 'no flags from a member who has not shared');
      const list = await c.get('/api/coach/clients?limit=100');
      const row = (list.json.items as Array<{ id: string; bloodworkStatus: unknown; reportsToReview: number }>).find((r) => r.id === noShare);
      if (row) { assert.equal(row.bloodworkStatus, null); assert.equal(row.reportsToReview, 0); }
    }
  }
  // inputs that must not leak into SQL or open fields
  assert.equal((await coach2.get('/api/coach/clients?sort=constructor')).status, 400);
  assert.equal((await owner.patch('/api/admin/settings', { key: 'coach_field_policy', value: { email: 'false', phone: 0 }, reason: 'test: wrong shape' })).json.error?.code, 'POLICY_SHAPE');
  // field-policy helpers normalise key spellings
  const { findRestrictedFields: find, restrictedKeys: keys } = await import('../../src/auth/fieldPolicy.js');
  assert.deepEqual(find({ Email: 'x', phone_number: 'y', nested: [[{ DOB: 'z' }]], when: new Date() }, keys()).sort(), ['.Email', '.nested[0][0].DOB', '.phone_number']);
});
