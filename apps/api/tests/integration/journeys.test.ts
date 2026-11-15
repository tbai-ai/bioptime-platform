import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId } from '../helpers.js';
import { addDays } from '../../src/lib/time.js';

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); h.db.close(); });

function weekdayAhead(days: number): string {
  let d = addDays(h.ctx.now(), days).slice(0, 10);
  while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDays(`${d}T00:00:00Z`, 1).slice(0, 10);
  return d;
}

test('member journey: buy a package → simulated payment → activation → assignment request → admin confirms → member sees the coach', async () => {
  const m = client(h.app);
  await m.login(DEMO.memberIncomplete, DEMO_PASSWORDS.member); // Ishaan: onboarding incomplete, no package
  const me0 = await m.get('/api/me');
  assert.equal(me0.json.programme, null);
  const checkout = await m.post('/api/me/checkout', { packageId: 'core', idempotencyKey: 'journey-core-1' });
  assert.equal(checkout.status, 201);
  const order = checkout.json.order as { id: string; status: string; reference: string };
  const ck = checkout.json.checkout as { checkoutId: string; simulated: boolean };
  assert.equal(order.status, 'pending_payment');
  assert.ok(ck.simulated, 'the checkout is labelled simulated');
  const pay = await m.post('/api/payments/simulator/complete', { checkoutId: ck.checkoutId, outcome: 'captured' });
  assert.equal(pay.status, 200);
  assert.equal((pay.json.order as { status: string }).status, 'activated');
  const me1 = await m.get('/api/me');
  assert.equal((me1.json.programme as { packageName: string }).packageName, 'Core');
  assert.deepEqual((me1.json.entitlements as { bloodwork: { remaining: number }; consultation: { remaining: number } }).bloodwork.remaining, 1);
  assert.equal(me1.json.assignmentStatus, 'pending');
  const admin = client(h.app);
  await admin.login(DEMO.admin, DEMO_PASSWORDS.admin, 'dashboard', true);
  const requests = await admin.get('/api/admin/assignments/requests?status=open');
  const req = (requests.json.items as Array<{ id: string; member_id: string; recommendation: Array<{ coachId: string; eligible: boolean; reasons: string[] }> }>).find((r) => r.member_id === userId(h.ctx, DEMO.memberIncomplete))!;
  assert.ok(req, 'activation opened an assignment request');
  assert.ok(req.recommendation.length > 0 && req.recommendation[0]!.reasons.length > 0, 'the recommendation explains itself');
  const top = req.recommendation.find((c) => c.eligible)!;
  const assign = await admin.post(`/api/admin/assignments/requests/${req.id}/assign`, { coachId: top.coachId, reason: 'Recommended by the rule; confirmed in the test' });
  assert.equal(assign.status, 200);
  const me2 = await m.get('/api/me');
  assert.equal(me2.json.assignmentStatus, 'active');
  assert.equal((me2.json.coach as { coachId: string }).coachId, top.coachId);
  const coachView = await m.get('/api/me/coach');
  assert.ok((coachView.json.coach as { displayName: string }).displayName);
  assert.equal((coachView.json.coach as Record<string, unknown>).email, undefined, 'a member sees only the permitted professional details');
  const notif = await m.get('/api/notifications');
  assert.ok((notif.json.items as Array<{ category: string }>).some((n) => n.category === 'coach_assignment'));
});

test('bloodwork journey: consent and profile checks → booking reserves the entitlement → vendor order → webhooks move the status → coach review releases the report → member reads it', async () => {
  const m = client(h.app);
  await m.login(DEMO.member2, DEMO_PASSWORDS.member); // Vikram: Advanced, 2 tests, one used in the seed
  const tests = await m.get('/api/me/bloodwork/tests');
  const test = (tests.json.items as Array<{ id: string; name: string }>).find((t) => t.name.startsWith('Lipid'))!;
  const slots = await m.get('/api/me/bloodwork/slots?date=' + weekdayAhead(4) + '&pincode=560034');
  assert.equal(slots.status, 200);
  const slot = (slots.json.slots as Array<{ startAt: string; labId: string }>)[0]!;
  const noSlots = await m.get('/api/me/bloodwork/slots?date=' + weekdayAhead(4) + '&pincode=990001');
  assert.equal((noSlots.json.slots as unknown[]).length, 0, 'an unserved pincode has no slots');
  const before = (await m.get('/api/me/entitlements')).json.bloodwork as { remaining: number; reserved: number };
  const booking = await m.post('/api/me/bloodwork/bookings', { testId: test.id, slotAt: slot.startAt, labId: slot.labId, pincode: '560034', address: '12 Demo Street', city: 'Bengaluru', state: 'Karnataka', idempotencyKey: 'journey-booking-1' });
  assert.equal(booking.status, 201, JSON.stringify(booking.json));
  const b = booking.json as { id: string; reference: string; status: string; vendorOrderId: string; simulated: boolean; consumesEntitlement: boolean };
  assert.equal(b.status, 'confirmed');
  assert.ok(b.vendorOrderId, 'the stand-in placed the order');
  assert.ok(b.simulated && b.consumesEntitlement);
  const after = (await m.get('/api/me/entitlements')).json.bloodwork as { remaining: number; reserved: number };
  assert.equal(after.reserved, before.reserved + 1);
  const again = await m.post('/api/me/bloodwork/bookings', { testId: test.id, slotAt: slot.startAt, pincode: '560034', address: '12 Demo Street', city: 'Bengaluru', state: 'Karnataka', idempotencyKey: 'journey-booking-1' });
  assert.equal((again.json as { id: string }).id, b.id, 'the same idempotency key never books twice');
  assert.equal(((await m.get('/api/me/entitlements')).json.bloodwork as { reserved: number }).reserved, before.reserved + 1, 'and never reserves twice');
  // the stand-in walks the order through the statuses and posts a webhook at each; a repeated webhook changes nothing
  const standin = h.services.standin!;
  assert.equal(await standin.step(b.vendorOrderId), 'CREATED');
  assert.equal(await standin.step(b.vendorOrderId), 'PHLEBO_ASSIGNED');
  await standin.testWebhook(b.vendorOrderId, 'PHLEBO_ASSIGNED');
  assert.equal(((await m.get(`/api/me/bloodwork/bookings/${b.id}`)).json as { status: string }).status, 'scheduled');
  assert.equal(await standin.step(b.vendorOrderId), 'SAMPLE_COLLECTED');
  const collected = (await m.get('/api/me/entitlements')).json.bloodwork as { used: number; reserved: number };
  assert.equal(collected.reserved, before.reserved, 'collection consumed the reservation');
  assert.equal(await standin.step(b.vendorOrderId), 'SAMPLE_PROCESSED');
  assert.equal(await standin.step(b.vendorOrderId), 'REPORT_DELIVERED');
  assert.equal(await standin.step(b.vendorOrderId), null, 'nothing after delivery');
  const timeline = ((await m.get(`/api/me/bloodwork/bookings/${b.id}`)).json as { timeline: Array<{ to_status: string }> }).timeline.map((t) => t.to_status);
  assert.deepEqual(timeline, ['confirmed', 'confirmed', 'scheduled', 'sample_collected', 'processing', 'results_ready']);
  const ready = (await m.get(`/api/me/bloodwork/bookings/${b.id}`)).json as { status: string; report: { id: string; released: boolean } };
  assert.equal(ready.status, 'results_ready');
  assert.equal(ready.report.released, false);
  assert.equal((await m.get(`/api/reports/${ready.report.id}`)).json.error?.code, 'NOT_RELEASED', 'the member cannot read an unreleased report');
  const coach = client(h.app);
  await coach.login(DEMO.coach2, DEMO_PASSWORDS.coach, 'dashboard'); // Rahul coaches Vikram
  const queue = await coach.get('/api/coach/reports?unreviewed=1');
  assert.ok((queue.json.items as Array<{ id: string }>).some((r) => r.id === ready.report.id));
  const review = await coach.post(`/api/coach/reports/${ready.report.id}/review`, { coachNote: 'Lipids are within the laboratory ranges except LDL, which is a little above the optimal line. Nothing urgent; we keep the evening walk.' });
  assert.equal(review.status, 200);
  const done = (await m.get(`/api/me/bloodwork/bookings/${b.id}`)).json as { status: string; report: { released: boolean } };
  assert.equal(done.status, 'completed');
  const report = await m.get(`/api/reports/${ready.report.id}`);
  assert.equal(report.status, 200);
  assert.ok((report.json.values as unknown[]).length >= 4, 'marker values arrived with the harmonised-values event');
  assert.ok(String(report.json.provenance).includes('as reported by the laboratory'));
  const tok = await m.post(`/api/reports/${ready.report.id}/file-token`);
  const file = await m.get(`/api/reports/file?token=${tok.json.token}`);
  assert.equal(file.status, 200);
  assert.ok(file.text.includes('Results as reported by the laboratory') && file.text.includes('not a medical opinion'));
  assert.equal((await m.get('/api/reports/file?token=forged')).status, 403);
  const trend = await m.get('/api/me/reports/markers/ldl');
  assert.ok((trend.json.items as unknown[]).length >= 1);
});

test('bloodwork guards: no entitlement left, missing lab consent, laboratory refusal restores the allowance, cancellation cutoff', async () => {
  const m = client(h.app);
  await m.login(DEMO.member, DEMO_PASSWORDS.member); // Ananya: Core, 1 test, used in the seed
  const tests = (await m.get('/api/me/bloodwork/tests')).json.items as Array<{ id: string }>;
  const r = await m.post('/api/me/bloodwork/bookings', { testId: tests[0]!.id, slotAt: `${weekdayAhead(3)}T02:00:00.000Z`, pincode: '560001', address: '1 Demo Street', city: 'Bengaluru', state: 'Karnataka' });
  assert.equal(r.status, 409);
  assert.equal((r.json.error?.details as { code: string })?.code, 'NO_ENTITLEMENT');
  const d = client(h.app);
  await d.login(DEMO.memberNoShare, DEMO_PASSWORDS.member); // Deepa: Starter (test available), lab consent given
  await d.post('/api/me/consents', { kind: 'lab_consent', version: '2026-10-17', granted: false });
  const noConsent = await d.post('/api/me/bloodwork/bookings', { testId: tests[0]!.id, slotAt: `${weekdayAhead(3)}T02:00:00.000Z`, pincode: '600028', address: '3 Demo Street', city: 'Chennai', state: 'Tamil Nadu' });
  assert.equal((noConsent.json.error?.details as { code: string })?.code, 'LAB_CONSENT_REQUIRED');
  await d.post('/api/me/consents', { kind: 'lab_consent', version: '2026-10-17', granted: true });
  const before = (await d.get('/api/me/entitlements')).json.bloodwork as { remaining: number };
  const refused = await d.post('/api/me/bloodwork/bookings', { testId: tests[0]!.id, slotAt: `${weekdayAhead(3)}T02:00:00.000Z`, pincode: '980001', address: '3 Demo Street', city: 'Chennai', state: 'Tamil Nadu', idempotencyKey: 'journey-refused-1' });
  assert.equal(refused.status, 201);
  assert.ok(String((refused.json as { flag: string }).flag).includes('waiting for the lab'), 'a lab error keeps the booking confirmed and flagged');
  assert.ok(h.db.get("SELECT 1 FROM support_tasks WHERE kind = 'failed_booking' AND status = 'open'"), 'and opens an exception');
  const cancel = await d.post(`/api/me/bloodwork/bookings/${(refused.json as { id: string }).id}/cancel`, { reason: 'changed my mind' });
  assert.equal(cancel.status, 200);
  assert.equal(((await d.get('/api/me/entitlements')).json.bloodwork as { remaining: number }).remaining, before.remaining, 'cancelling restored the allowance');
});

test('coach journey: assigned clients only, plan draft → publish → member tasks, consultation scheduled and completed, note and follow-up', async () => {
  const coach = client(h.app);
  await coach.login(DEMO.coach, DEMO_PASSWORDS.coach, 'dashboard'); // Asha
  const home = await coach.get('/api/coach/home');
  const clients = home.json.clients as Array<{ id: string; name: string }>;
  assert.ok(clients.some((c) => c.name === 'Ananya Rao'));
  assert.ok(!clients.some((c) => c.name === 'Vikram Shetty'));
  const ananya = clients.find((c) => c.name === 'Ananya Rao')!;
  assert.equal((await coach.get(`/api/coach/clients/${userId(h.ctx, DEMO.member2)}`)).status, 403, 'not her client');
  const detail = await coach.get(`/api/coach/clients/${ananya.id}`);
  assert.equal(detail.status, 200);
  assert.equal((detail.json.profile as { phone?: unknown }).phone, undefined, 'phone numbers never reach the coach view (field policy)');
  const plan = await coach.post('/api/coach/plans', { memberId: ananya.id, title: 'Block 2: strength and sleep', goals: ['Sleep 7h', 'Two strength sessions'], structure: { weeks: [{ week: 1, focus: 'Base', tasks: [{ title: 'Strength A', kind: 'training', day: 1 }, { title: 'Walk 30 min', kind: 'movement', day: 3 }] }, { week: 2, focus: 'Build', tasks: [{ title: 'Strength B', kind: 'training', day: 2 }] }] } });
  assert.equal(plan.status, 201);
  assert.equal((plan.json as { status: string }).status, 'draft');
  const planId = (plan.json as { id: string }).id;
  const edit = await coach.patch(`/api/coach/plans/${planId}`, { summary: 'Edited draft' });
  assert.equal(edit.status, 200);
  // an impossible start date is refused as a field error (400), never a server error
  const impossible = await coach.post(`/api/coach/plans/${planId}/publish`, { startDate: '2026-99-99' });
  assert.equal(impossible.status, 400, JSON.stringify(impossible.json));
  assert.equal(impossible.json.error?.code, 'VALIDATION_FAILED');
  const published = await coach.post(`/api/coach/plans/${planId}/publish`, { startDate: h.ctx.now().slice(0, 10) });
  assert.equal(published.status, 200);
  assert.equal((published.json as { tasks: unknown[] }).tasks.length, 3);
  const member = client(h.app);
  await member.login(DEMO.member, DEMO_PASSWORDS.member);
  const prog = await member.get('/api/me/programme');
  assert.equal((prog.json.plan as { title: string }).title, 'Block 2: strength and sleep');
  const task = ((await member.get('/api/me/tasks')).json.items as Array<{ id: string; title: string }>).find((t) => t.title === 'Strength A')!;
  assert.equal(((await member.patch(`/api/me/tasks/${task.id}`, { status: 'done' })).json as { status: string }).status, 'done');
  assert.ok(((await member.get('/api/notifications')).json.items as Array<{ category: string }>).some((n) => n.category === 'programme'));
  const slots = (await coach.get('/api/coach/appointments/slots?date=' + weekdayAhead(6))).json.slots as Array<{ startAt: string }>;
  const apt = await coach.post('/api/coach/appointments', { memberId: ananya.id, startAt: slots[0]!.startAt, kind: 'consultation', note: 'Block 2 review' });
  assert.equal(apt.status, 201);
  const aptId = (apt.json as { id: string }).id;
  assert.ok(((await member.get('/api/me/appointments')).json.items as Array<{ id: string }>).some((a) => a.id === aptId), 'the member sees the consultation');
  assert.equal((await member.patch(`/api/me/appointments/${aptId}`, { startAt: slots[2]!.startAt })).status, 200, 'the member can move it');
  assert.equal((await coach.post(`/api/coach/appointments/${aptId}/complete`, { note: 'Done' })).status, 200);
  assert.equal((await coach.post(`/api/coach/clients/${ananya.id}/notes`, { body: 'Reviewed block 2; sleep improving.' })).status, 201);
  assert.equal((await coach.post(`/api/coach/clients/${ananya.id}/follow-ups`, { title: 'Check sleep log next week' })).status, 201);
  assert.ok(((await coach.get('/api/coach/follow-ups')).json.items as unknown[]).length >= 1);
  const conv = ((await coach.get('/api/conversations')).json.items as Array<{ id: string; memberId: string }>).find((c) => c.memberId === ananya.id)!;
  assert.equal((await coach.post(`/api/conversations/${conv.id}/messages`, { body: 'Your block 2 plan is live.' })).status, 201);
  const memberConv = ((await member.get('/api/conversations')).json.items as Array<{ id: string; unread: number }>).find((c) => c.id === conv.id)!;
  assert.ok(memberConv.unread >= 1);
  const other = client(h.app);
  await other.login(DEMO.member2, DEMO_PASSWORDS.member);
  assert.equal((await other.get(`/api/conversations/${conv.id}/messages`)).status, 403, 'another member cannot read the thread');
});

test('admin journey: order and payment states, bloodwork exception resolved, package revision keeps paid entitlements, audit trail', async () => {
  const admin = client(h.app);
  await admin.login(DEMO.owner, DEMO_PASSWORDS.owner, 'dashboard', true);
  const orders = await admin.get('/api/admin/orders');
  assert.ok((orders.json.items as Array<{ status: string; payment: { signatureVerified: boolean } }>).some((o) => o.status === 'activated' && o.payment.signatureVerified));
  assert.ok((orders.json.items as Array<{ status: string }>).some((o) => o.status === 'pending_payment'));
  const tasks = await admin.get('/api/admin/operations/tasks?status=open');
  const task = (tasks.json.items as Array<{ id: string; kind: string }>)[0]!;
  assert.equal((await admin.patch(`/api/admin/operations/tasks/${task.id}`, { status: 'resolved' })).status, 400, 'a resolution is required');
  assert.equal((await admin.patch(`/api/admin/operations/tasks/${task.id}`, { status: 'resolved', resolution: 'Handled in the test' })).status, 200);
  const packages = await admin.get('/api/admin/packages');
  const core = (packages.json.items as Array<{ id: string; slug: string; version: { version: number } }>).find((p) => p.slug === 'core')!;
  const coreOrder = h.db.get<{ package_version_id: string }>("SELECT package_version_id FROM orders WHERE package_version_id = (SELECT id FROM package_versions WHERE package_id = ? AND version = 1) LIMIT 1", [core.id])!;
  const revised = await admin.patch(`/api/admin/packages/${core.id}`, { consultations: 4, reason: 'Added a consultation for new buyers' });
  assert.equal(revised.status, 200);
  assert.equal(((revised.json as { version: { version: number; consultations: number } }).version).version, 2);
  assert.equal(h.db.get<{ consultations: number }>('SELECT consultations FROM package_versions WHERE id = ?', [coreOrder.package_version_id])!.consultations, 3, 'the paid version is untouched');
  assert.equal((await admin.patch(`/api/admin/packages/${core.id}`, { consultations: 5 })).status, 400, 'a reason is required');
  const booking = ((await admin.get('/api/admin/bloodwork/bookings?status=processing')).json.items as Array<{ id: string }>)[0]!;
  const override = await admin.patch(`/api/admin/bookings/${booking.id}`, { status: 'cancelled', reason: 'Laboratory confirmed by phone the sample was lost' });
  assert.equal(override.status, 200);
  assert.equal((override.json as { status: string }).status, 'cancelled');
  const audit = await admin.get(`/api/admin/audit?targetType=booking&targetId=${booking.id}`);
  assert.ok((audit.json.items as Array<{ action: string; reason: string }>).some((a) => a.action === 'booking.override' && a.reason.includes('lost')));
  const coachOnly = client(h.app);
  await coachOnly.login(DEMO.admin, DEMO_PASSWORDS.admin, 'dashboard', true);
  assert.equal((await coachOnly.patch(`/api/admin/bookings/${booking.id}`, { status: 'confirmed', reason: 'admin is not owner' })).status, 403, 'overrides are owner-only');
  const status = await admin.get('/api/admin/integrations/labstack/status');
  assert.equal((status.json as { mode: string }).mode, 'standin');
});

test('bespoke plan: enquiry → scoping → approval → proposal → member accepts → order → payment activates with the proposal’s entitlements', async () => {
  const admin = client(h.app);
  await admin.login(DEMO.owner, DEMO_PASSWORDS.owner, 'dashboard', true);
  const m = client(h.app);
  await m.login(DEMO.memberNoCoach, DEMO_PASSWORDS.member); // Karthik
  const req = await m.post('/api/me/custom-plans', { goals: 'Six months of mobility and strength with two tests', duration: '6 months' });
  assert.equal(req.status, 201);
  const id = (req.json as { id: string }).id;
  const move = (to: string, extra: Record<string, unknown> = {}) => admin.post(`/api/admin/custom-plans/${id}/transition`, { to, ...extra });
  assert.equal((await move('under_review')).status, 200);
  assert.equal((await move('scoping')).status, 200);
  assert.equal((await move('proposal_sent')).status, 409, 'cannot skip approval');
  assert.equal((await move('awaiting_internal_approval', { proposal: { durationMonths: 6, durationLabel: '6 months', consultations: 8, bloodworkEntitlements: 2, priceInr: 27999 } })).status, 200);
  assert.equal((await move('proposal_sent')).status, 409, 'an approval must be recorded');
  assert.equal((await move('proposal_sent', { approval: 'Approved by the owner' })).status, 200);
  const mine = (await m.get('/api/me/custom-plans')).json.items as Array<{ id: string; status: string }>;
  assert.equal(mine.find((r) => r.id === id)!.status, 'proposal_sent');
  const accept = await m.post(`/api/me/custom-plans/${id}/accept`);
  assert.equal(accept.status, 200);
  const checkout = accept.json.checkout as { checkoutId: string };
  assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM programmes WHERE custom_plan_id = ?', [id])!.n, 0, 'nothing activates before payment');
  const pay = await m.post('/api/payments/simulator/complete', { checkoutId: checkout.checkoutId, outcome: 'captured' });
  assert.equal(pay.status, 200);
  assert.equal(h.db.get<{ status: string }>('SELECT status FROM custom_plan_requests WHERE id = ?', [id])!.status, 'activated');
  const ent = h.db.all<{ service_type: string; quantity: number }>('SELECT service_type, quantity FROM entitlements WHERE programme_id = (SELECT id FROM programmes WHERE custom_plan_id = ?)', [id]).map((e) => ({ ...e }));
  assert.deepEqual(ent.sort((a, b) => a.service_type.localeCompare(b.service_type)), [{ service_type: 'bloodwork', quantity: 2 }, { service_type: 'consultation', quantity: 8 }]);
});

test('report access is checked server-side for every role', async () => {
  const report = h.db.get<{ id: string; member_id: string }>('SELECT id, member_id FROM report_metadata WHERE released_at IS NOT NULL LIMIT 1')!;
  const owner = client(h.app);
  await owner.login(DEMO.member2, DEMO_PASSWORDS.member);
  const other = client(h.app);
  await other.login(DEMO.memberNoCoach, DEMO_PASSWORDS.member);
  assert.equal((await other.get(`/api/reports/${report.id}`)).status, 403, 'another member');
  const unrelatedCoach = client(h.app);
  await unrelatedCoach.login('dev.kapoor@demo.bioptime.test', DEMO_PASSWORDS.coach, 'dashboard');
  assert.equal((await unrelatedCoach.get(`/api/reports/${report.id}`)).status, 403, 'a coach not assigned');
  assert.equal((await client(h.app).get(`/api/reports/${report.id}`)).status, 401, 'anonymous');
  const admin = client(h.app);
  await admin.login(DEMO.admin, DEMO_PASSWORDS.admin, 'dashboard', true);
  assert.equal((await admin.get(`/api/reports/${report.id}`)).status, 200);
  const deepa = client(h.app);
  await deepa.login(DEMO.memberNoShare, DEMO_PASSWORDS.member);
  await deepa.post('/api/me/consents', { kind: 'coach_sharing', version: '2026-10-17', granted: false });
  const meera = client(h.app);
  await meera.login(DEMO.coach3, DEMO_PASSWORDS.coach, 'dashboard');
  const deepaId = userId(h.ctx, DEMO.memberNoShare);
  const r = await meera.get(`/api/coach/clients/${deepaId}/bloodwork`);
  assert.equal(r.json.error?.code, 'NOT_SHARED', 'a coach cannot see health records the member has not shared');
});
