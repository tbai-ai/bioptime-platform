/* LabStack operations (module labstackOps): GET /admin/integrations/labstack/operations.
   - Only administrators holding labstack.manage reach it (an administrator without it, coaches, members and visitors
     are refused; the route answers FEATURE_DISABLED while the module's flag is off).
   - The metrics are computed from the records: bookings by order type and status, breaching now (oldest first, slots
     stored with an offset compared as instants), open laboratory escalations and failed calls of the last 24 hours,
     orders today, recent activity, catalogue, webhook and safety-net health.
   - A booking moved through the member route gets its expected report time recomputed from the new slot (the helper
     the order uses, bloodwork.ts expectedBy) and emits BookingUpdated { rescheduled: true }; breaching is measured
     against the new slot, and rows whose stored report time predates a move are still read correctly.
   - One incident is counted once: a failure that opened or joined a task is counted under it while it is open and no
     longer counts once it is closed; the total is split by source.
   - No secret leaves the server: the partner key is reported as configured or not, never its value, and a secret that
     reached a stored message is redacted. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { LAB_STATUSES } from '@bioptime/domain';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId } from '../helpers.js';
import { addDays, addHours, addMinutes, dateInZone, toIstOffsetString } from '../../src/lib/time.js';
import { setIntegration, turnaroundHours, expectedBy, syncCatalogue, placeWithVendor, type BookingRow, type LabFailure } from '../../src/domain/bloodwork.js';
import { VendorError, type LabVendor } from '../../src/adapters/labstack/types.js';
import { operations } from '../../src/modules/labstackOps.js';
import { j } from '../../src/db/db.js';

const PATH = '/api/admin/integrations/labstack/operations';

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); h.db.close(); });

const signIn = async (app: typeof h.app, email: string, password: string, mfa = false) => { const c = client(app); await c.login(email, password, password === DEMO_PASSWORDS.member ? 'member' : 'dashboard', mfa); return c; };

type Ops = {
  counters: { breachingNow: number; escalationsOpen: number; labOrdersToday: number; collectionsToday: number; openLabOrders: number };
  streams: Array<{ key: string; used: boolean; open: number | null; types: Array<{ key: string; used: boolean; total: number | null; open: number | null; today: number | null; byStatus: Record<string, number> | null }> }>;
  breaching: { total: number; byStream: Record<string, number>; items: Array<{ bookingId: string; reference: string; kind: string; dueAt: string; status: string; stream: string; orderType: string }> };
  escalations: { total: number; byStream: Record<string, number>; items: Array<{ id: string; source: string; kind: string; stream: string; reference: string | null; count: number; openedAt: string }>; bySource: { tasks: number; failedCalls: number; failedCallFailures: number }; coveredFailedCalls: Record<string, number>; closedFailedCalls: Record<string, number> };
  activity: { total: number; items: Array<{ at: string; reference: string; note: string | null }> };
  catalogue: { enabled: number; hidden: number; priced: number; unpriced: number; enabledTests: number; enabledPackages: number; lastSync: string | null; syncEveryHours: number };
  health: { webhook: { state: string; received24h: { total: number } }; safetyNet: { state: string; everyMinutes: number }; failedCalls24h: number; failedCallsByCall: Record<string, number> };
  partnerKey: { variable: string; configured: boolean; widget: { state: string; tokenMinting: string; missing: string[] } };
};

test('only administrators holding labstack.manage reach the operations metrics; coaches, members and visitors are refused; the flag gates it', async () => {
  const owner = await signIn(h.app, DEMO.owner, DEMO_PASSWORDS.owner, true);
  const admin = await signIn(h.app, DEMO.admin, DEMO_PASSWORDS.admin, true);
  const coach = await signIn(h.app, DEMO.coach, DEMO_PASSWORDS.coach);
  const member = await signIn(h.app, DEMO.member, DEMO_PASSWORDS.member);
  const anon = client(h.app);

  const denied = await admin.get(PATH);
  assert.equal(denied.status, 403);
  assert.equal(denied.json.error?.code, 'PERMISSION_DENIED', 'administrators do not hold labstack.manage by default');
  assert.equal(denied.json.counters, undefined);
  for (const [who, c] of [['coach', coach], ['member', member]] as const) {
    const r = await c.get(PATH);
    assert.equal(r.status, 403, `${who} → ${r.status}`);
    assert.equal(r.json.counters, undefined, `${who} receives no figures`);
  }
  assert.equal((await anon.get(PATH)).status, 401);

  const ok = await owner.get(PATH);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.ok(ok.json.counters && ok.json.streams && ok.json.partnerKey);

  const adminId = userId(h.ctx, DEMO.admin);
  assert.equal((await owner.post(`/api/admin/users/${adminId}/permissions`, { permission: 'labstack.manage', granted: true, reason: 'test: lab duty' })).status, 200);
  assert.equal((await admin.get(PATH)).status, 200, 'granted: the administrator reads the figures');
  assert.equal((await owner.post(`/api/admin/users/${adminId}/permissions`, { permission: 'labstack.manage', granted: false, reason: 'test: done' })).status, 200);
  assert.equal((await admin.get(PATH)).json.error?.code, 'PERMISSION_DENIED', 'revoked again');

  h.db.run("UPDATE feature_flags SET enabled = 0 WHERE key = 'labstackOps'");
  try {
    const off = await owner.get(PATH);
    assert.equal(off.status, 403);
    assert.equal(off.json.error?.code, 'FEATURE_DISABLED');
    assert.equal((await owner.get('/api/admin/integrations/labstack/status')).status, 200, 'the existing status card does not depend on the module');
  } finally {
    h.db.run("UPDATE feature_flags SET enabled = 1 WHERE key = 'labstackOps'");
  }
});

test('the metrics are computed from the records: streams, breaching now (oldest first), escalations, today, activity, catalogue and health', async () => {
  const owner = await signIn(h.app, DEMO.owner, DEMO_PASSWORDS.owner, true);
  const now = new Date().toISOString();
  const memberId = userId(h.ctx, DEMO.member);
  const testRow = h.db.get<{ id: string; turnaround: string }>('SELECT id, turnaround FROM bloodwork_tests WHERE active = 1 ORDER BY id LIMIT 1')!;
  const testId = testRow.id;
  const tat = turnaroundHours(testRow.turnaround);
  assert.ok(tat !== null, `the test's turnaround is in hours, days or weeks (${testRow.turnaround})`);
  const reportWindow = tat + 4; // hours from the slot to the report deadline, as bloodwork.ts expectedBy computes it

  // the seeded open bookings get deadlines in the future, so the only breaches are the ones made below
  for (const b of h.db.all<{ id: string }>("SELECT id FROM bloodwork_bookings WHERE status NOT IN ('completed','cancelled')")) h.db.update('bloodwork_bookings', b.id, { slot_at: addDays(now, 3), expected_report_by: addDays(now, 5) });

  let seq = 0;
  const book = (status: string, slotAt: string, expectedBy: string | null, createdAt = now) => {
    const id = `bkg_opstest${++seq}`;
    h.db.insert('bloodwork_bookings', { id, reference: `BIO-OPS-TEST-${seq}`, member_id: memberId, test_id: testId, status, slot_at: slotAt, vendor: 'labstack', vendor_order_id: `ORD-OPS-${seq}`, vendor_pending: 0, patient: '{}', pincode: '560001', address: 'Sample Street (test)', city: 'Bengaluru', state: 'Karnataka', expected_report_by: expectedBy, created_at: createdAt, updated_at: createdAt });
    return { id, reference: `BIO-OPS-TEST-${seq}` };
  };
  // collection overdue, slot stored with the +05:30 offset (compared as an instant)
  const a = book('scheduled', toIstOffsetString(addHours(now, -3)), addDays(now, 2));
  // report overdue: collected and processing, the report deadline (slot + turnaround + 4 h) passed an hour ago
  const b = book('processing', addHours(now, -(reportWindow + 1)), addHours(now, -1));
  // both deadlines passed: listed once, as collection overdue, under the earlier deadline
  const f = book('confirmed', addHours(now, -5), addHours(now, -2));
  // not breaching: collected with the report not yet due; completed and results-ready ones; a cancelled one; a future slot
  book('sample_collected', addHours(now, 6 - reportWindow), addHours(now, 6));
  // not breaching: stored report times that predate a move (earlier than the slot) are not deadlines
  book('confirmed', addDays(now, 2), addHours(now, -3)); // awaiting collection two days out: only the slot counts
  book('processing', addHours(now, -2), addHours(now, -26)); // collected two hours ago: due slot + turnaround + 4 h
  book('completed', addDays(now, -4), addDays(now, -3));
  book('results_ready', addDays(now, -2), addHours(now, -3));
  book('cancelled', addHours(now, -8), addHours(now, -4));
  book('confirmed', addDays(now, 1), addDays(now, 3), addDays(now, -2)); // created two days ago: not an order today

  // escalations: laboratory tasks count, other kinds and closed tasks do not
  const task = (kind: string, status: string, refType: string | null, refId: string | null, createdAt: string) => { const id = `stk_opstest${++seq}`; h.db.insert('support_tasks', { id, kind, status, title: `Test ${kind}`, detail: 'Test task', ref_type: refType, ref_id: refId, owner_id: null, created_by: 'system', created_at: createdAt, updated_at: createdAt }); return id; };
  const rebook = task('collection_rebook', 'open', 'booking', a.id, addHours(now, -2));
  const silence = task('integration_error', 'in_progress', 'integration', 'webhook_silence', addHours(now, -4));
  const otherIntegration = task('integration_error', 'open', 'integration', 'payments', addHours(now, -4));
  const resolved = task('failed_booking', 'resolved', 'booking', b.id, addHours(now, -6));
  // failed laboratory calls: two in the last day, one older
  const prior = j.out<{ failures?: Array<{ at: string; call: string; message: string }> }>(h.db.get<{ status: string }>("SELECT status FROM integration_status WHERE integration = 'labstack'")?.status, {});
  setIntegration(h.ctx, { failures: [...(prior.failures ?? []), { at: addHours(now, -30), call: 'placeOrder', message: 'timeout (test)' }, { at: addHours(now, -3), call: 'getOrders', message: 'HTTP 502 (test)' }, { at: addHours(now, -1), call: 'getOrders', message: 'HTTP 503 (test)' }] });

  // activity: one event inside the last day, one outside
  h.db.insert('booking_events', { id: `bev_opstest${++seq}`, booking_id: b.id, at: addHours(now, -1), from_status: 'sample_collected', to_status: 'processing', vendor_status: 'SAMPLE_PROCESSED', source: 'vendor', note: 'Test: inside the window' });
  h.db.insert('booking_events', { id: `bev_opstest${++seq}`, booking_id: b.id, at: addHours(now, -30), from_status: 'scheduled', to_status: 'sample_collected', vendor_status: 'SAMPLE_COLLECTED', source: 'vendor', note: 'Test: outside the window' });

  // health: a webhook seven hours ago while orders are open is silence; the safety net ran ten minutes ago
  setIntegration(h.ctx, { lastWebhook: addHours(now, -7), lastSafetyNet: addMinutes(now, -10) });

  const r = await owner.get(PATH);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const o = r.json as unknown as Ops;
  const at = Date.parse(now);

  /* streams: only HOME_SAMPLE carries figures */
  const all = h.db.all<{ status: string; created_at: string; slot_at: string }>('SELECT status, created_at, slot_at FROM bloodwork_bookings');
  const openCount = all.filter((x) => x.status !== 'completed' && x.status !== 'cancelled').length;
  const lab = o.streams.find((s) => s.key === 'lab_orders')!;
  const home = lab.types.find((t) => t.key === 'HOME_SAMPLE')!;
  assert.equal(home.used, true);
  assert.equal(home.total, all.length);
  assert.equal(home.open, openCount);
  assert.equal(o.counters.openLabOrders, openCount);
  const expectedByStatus = Object.fromEntries(LAB_STATUSES.map((s) => [s, all.filter((x) => x.status === s).length]));
  assert.deepEqual(home.byStatus, expectedByStatus);
  for (const s of o.streams) for (const t of s.types) if (!(s.key === 'lab_orders' && t.key === 'HOME_SAMPLE')) { assert.equal(t.used, false, `${s.key}/${t.key} is not booked through Bioptime`); assert.equal(t.total, null); assert.equal(t.byStatus, null); }
  assert.deepEqual(o.streams.map((s) => s.key), ['lab_orders', 'appointments', 'pharma_orders']);
  assert.deepEqual(lab.types.map((t) => t.key), ['HOME_SAMPLE', 'CENTER_VISIT', 'SAMPLE_DROP_OFF', 'KIT_BASED', 'CAMP']);
  assert.equal(o.streams.find((s) => s.key === 'appointments')!.used, false);
  assert.equal(o.streams.find((s) => s.key === 'appointments')!.open, null);

  /* today (India time) */
  const today = dateInZone(now);
  assert.equal(o.counters.labOrdersToday, all.filter((x) => dateInZone(x.created_at) === today).length);
  assert.ok(o.counters.labOrdersToday < all.length, 'the booking created two days ago is not counted');
  assert.equal(o.counters.collectionsToday, all.filter((x) => x.status !== 'cancelled' && dateInZone(new Date(Date.parse(x.slot_at)).toISOString()) === today).length);

  /* breaching now: exactly the three, oldest deadline first */
  assert.deepEqual(o.breaching.items.map((x) => x.reference), [f.reference, a.reference, b.reference]);
  assert.deepEqual(o.breaching.items.map((x) => x.kind), ['collection_overdue', 'collection_overdue', 'report_overdue']);
  assert.equal(o.breaching.items[0]!.dueAt, addHours(now, -5), 'the earlier deadline (the slot) is the one listed');
  assert.ok(Math.abs(Date.parse(o.breaching.items[1]!.dueAt) - Date.parse(addHours(now, -3))) < 1000, 'the +05:30 slot (whole seconds) is compared as an instant');
  assert.equal(o.counters.breachingNow, 3);
  assert.equal(o.breaching.byStream.lab_orders, 3);
  assert.equal(o.breaching.byStream.appointments, 0);
  assert.ok(o.breaching.items.every((x) => x.stream === 'lab_orders' && x.orderType === 'HOME_SAMPLE'));

  /* escalations: open laboratory tasks plus failed calls of the last day */
  const labKinds = ['failed_booking', 'collection_rebook', 'missing_report_notification', 'report_values_failed', 'unknown_webhook', 'vendor_sync_failure'];
  const expectedTasks = h.db.all<{ id: string }>(`SELECT id FROM support_tasks WHERE status IN ('open','in_progress') AND (kind IN (${labKinds.map(() => '?').join(',')}) OR (kind = 'integration_error' AND ref_type = 'integration' AND ref_id IN ('labstack','webhook_silence')))`, labKinds).map((x) => x.id);
  const taskIds = o.escalations.items.filter((x) => x.source === 'task').map((x) => x.id);
  assert.deepEqual([...taskIds].sort(), [...expectedTasks].sort());
  assert.ok(taskIds.includes(rebook) && taskIds.includes(silence));
  assert.ok(!taskIds.includes(otherIntegration), 'another integration’s error is not a laboratory escalation');
  assert.ok(!taskIds.includes(resolved), 'resolved tasks are not open');
  assert.ok(!o.escalations.items.some((x) => x.kind === 'capacity_issue'), 'coach capacity is not a laboratory escalation');
  const calls = o.escalations.items.filter((x) => x.source === 'vendor_call');
  assert.equal(calls.length, 1, 'one entry per failing call in the last day');
  assert.equal(calls[0]!.kind, 'failed_vendor_call');
  assert.equal(calls[0]!.count, 2);
  assert.equal(o.health.failedCalls24h, 2);
  assert.deepEqual(o.health.failedCallsByCall, { getOrders: 2 });
  assert.deepEqual(o.escalations.coveredFailedCalls, {}, 'no failing call here opened a task');
  assert.equal(o.counters.escalationsOpen, expectedTasks.length + 1);
  assert.deepEqual(o.escalations.bySource, { tasks: expectedTasks.length, failedCalls: 1, failedCallFailures: 2 }, 'the total split by source');
  const rebookItem = o.escalations.items.find((x) => x.id === rebook)!;
  assert.equal(rebookItem.stream, 'lab_orders');
  assert.equal(rebookItem.reference, a.reference);
  assert.equal(o.escalations.items.find((x) => x.id === silence)!.stream, 'integration');
  assert.equal(o.escalations.byStream.integration, o.escalations.items.filter((x) => x.stream === 'integration').length);
  const opened = o.escalations.items.map((x) => x.openedAt);
  assert.deepEqual(opened, [...opened].sort(), 'oldest first');

  /* recent activity: the last 24 hours, newest first */
  const expectedActivity = h.db.get<{ n: number }>('SELECT COUNT(*) n FROM booking_events WHERE at >= ?', [addHours(now, -24)])!.n;
  assert.equal(o.activity.total, expectedActivity);
  assert.ok(o.activity.items.some((x) => x.note === 'Test: inside the window'));
  assert.ok(!o.activity.items.some((x) => x.note === 'Test: outside the window'));
  assert.ok(o.activity.items.every((x) => Date.parse(x.at) >= at - 24 * 3_600_000 - 60_000));
  const times = o.activity.items.map((x) => x.at);
  assert.deepEqual(times, [...times].sort().reverse(), 'newest first');

  /* catalogue */
  const cat = (sql: string) => h.db.get<{ n: number }>(`SELECT COUNT(*) n FROM bloodwork_tests WHERE ${sql}`)!.n;
  assert.equal(o.catalogue.enabled, cat('active = 1 AND hidden = 0 AND price_paise IS NOT NULL'));
  assert.equal(o.catalogue.hidden, cat('active = 1 AND hidden = 1'));
  assert.equal(o.catalogue.priced, cat('active = 1 AND price_paise IS NOT NULL'));
  assert.equal(o.catalogue.unpriced, cat('active = 1 AND price_paise IS NULL'));
  assert.equal(o.catalogue.enabledTests + o.catalogue.enabledPackages, o.catalogue.enabled);
  assert.ok(o.catalogue.lastSync, 'the demo seed synced the catalogue');
  assert.equal(o.catalogue.syncEveryHours, h.config.LABSTACK_CATALOGUE_SYNC_HOURS);
  const visible = h.db.get<{ id: string }>('SELECT id FROM bloodwork_tests WHERE active = 1 AND hidden = 0 AND price_paise IS NOT NULL LIMIT 1')!;
  h.db.update('bloodwork_tests', visible.id, { hidden: 1 });
  const hiddenOne = (await owner.get(PATH)).json as unknown as Ops;
  assert.equal(hiddenOne.catalogue.enabled, o.catalogue.enabled - 1);
  assert.equal(hiddenOne.catalogue.hidden, o.catalogue.hidden + 1);
  h.db.update('bloodwork_tests', visible.id, { hidden: 0 });

  /* health */
  assert.equal(o.health.webhook.received24h.total, h.db.get<{ n: number }>("SELECT COUNT(*) n FROM vendor_events WHERE vendor = 'labstack' AND kind = 'order_webhook' AND received_at >= ?", [addHours(now, -24)])!.n);
  assert.equal(o.health.webhook.state, 'silent', 'open orders and no webhook for over six hours');
  assert.equal(o.health.safetyNet.state, 'ok');
  setIntegration(h.ctx, { lastWebhook: addMinutes(now, -5), lastSafetyNet: addMinutes(now, -3 * h.config.LABSTACK_SAFETY_NET_MINUTES) });
  const later = (await owner.get(PATH)).json as unknown as Ops;
  assert.equal(later.health.webhook.state, 'ok');
  assert.equal(later.health.safetyNet.state, 'late', 'two whole intervals without a run');

  /* partner key: not configured here, and token minting is not implemented */
  assert.equal(o.partnerKey.variable, 'LABSTACK_PARTNER_KEY');
  assert.equal(o.partnerKey.configured, false);
  assert.equal(o.partnerKey.widget.state, 'pending_configuration');
  assert.equal(o.partnerKey.widget.tokenMinting, 'not_implemented');
  assert.ok(o.partnerKey.widget.missing.some((m) => m.includes('LABSTACK_PARTNER_KEY')));
  assert.ok(o.partnerKey.widget.missing.some((m) => m.includes('token API documentation')));
});

test('no secret in any response: the partner key is reported as configured, never shown; a secret in a stored message is redacted', async () => {
  const PARTNER = 'lspk_test_4f9a1c2e7b3d5a6c';
  const API_KEY = 'lsak_test_9d8c7b6a5f4e3d2c';
  const g = await makeApp({ env: { LABSTACK_PARTNER_KEY: PARTNER, LABSTACK_API_KEY: API_KEY } });
  try {
    const owner = await signIn(g.app, DEMO.owner, DEMO_PASSWORDS.owner, true);
    // a failure message and a task detail that (wrongly) carry secret values
    setIntegration(g.ctx, { failures: [{ at: new Date().toISOString(), call: 'getOrders', message: `rejected key ${API_KEY}` }] });
    g.db.insert('support_tasks', { id: 'stk_opstest_secret', kind: 'vendor_sync_failure', status: 'open', title: 'Test sync failure', detail: `partner ${PARTNER} and webhook ${g.config.LABSTACK_WEBHOOK_VALUE}`, ref_type: 'integration', ref_id: 'labstack', owner_id: null, created_by: 'system', created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    const r = await owner.get(PATH);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const o = r.json as unknown as Ops;
    assert.equal(o.partnerKey.configured, true);
    assert.equal(o.partnerKey.widget.state, 'pending_configuration', 'a key alone opens nothing: token minting is not implemented');
    assert.ok(!o.partnerKey.widget.missing.some((m) => m.startsWith('LABSTACK_PARTNER_KEY')), 'the key is no longer missing');
    for (const secret of [PARTNER, API_KEY, g.config.LABSTACK_WEBHOOK_VALUE, g.config.TOKEN_SECRET, g.config.SESSION_SECRET, g.config.PAYMENT_WEBHOOK_SECRET]) {
      assert.ok(!r.text.includes(secret), `the response carries no secret value (${secret.slice(0, 4)}…)`);
    }
    assert.ok(r.text.includes('[redacted]'), 'the stored secrets were replaced');
    assert.ok(!/"(apiKey|partnerKey|secret|token)"\s*:\s*"/i.test(r.text), 'no field carries a key value');
    // the main instance (no key) answers the same way
    const plain = await (await signIn(h.app, DEMO.owner, DEMO_PASSWORDS.owner, true)).get(PATH);
    for (const secret of [h.config.LABSTACK_WEBHOOK_VALUE, h.config.TOKEN_SECRET, h.config.SESSION_SECRET, h.config.PAYMENT_WEBHOOK_SECRET]) assert.ok(!plain.text.includes(secret));
  } finally {
    await g.app.close();
    g.db.close();
  }
});

test('a booking the member moves is measured against its new slot, not the report time stored for the old one', async () => {
  const g = await makeApp();
  try {
    // a seeded booking placed with the (stand-in) laboratory and still awaiting collection
    const row = g.db.get<{ id: string; reference: string; member_id: string; status: string; slot_at: string; expected_report_by: string; turnaround: string }>(
      "SELECT b.id, b.reference, b.member_id, b.status, b.slot_at, b.expected_report_by, t.turnaround FROM bloodwork_bookings b JOIN bloodwork_tests t ON t.id = b.test_id WHERE b.status IN ('confirmed','scheduled') AND b.vendor_order_id IS NOT NULL AND b.expected_report_by IS NOT NULL ORDER BY b.slot_at, b.id LIMIT 1");
    assert.ok(row, 'the demo seed holds a placed booking awaiting collection');
    const email = g.db.get<{ email: string }>('SELECT email FROM users WHERE id = ?', [row.member_id])!.email;
    const member = await signIn(g.app, email, DEMO_PASSWORDS.member);
    const staleReportBy = row.expected_report_by;
    const newSlot = addDays(row.slot_at, 10);

    // the member moves it ten days later through the real route
    const eventsBefore = g.db.get<{ n: number }>("SELECT COUNT(*) n FROM domain_events WHERE type = 'BookingUpdated' AND aggregate_id = ?", [row.id])!.n;
    const moved = await member.patch(`/api/me/bloodwork/bookings/${row.id}`, { slotAt: newSlot });
    assert.equal(moved.status, 200, JSON.stringify(moved.json));
    const now = g.db.get<{ slot_at: string; status: string; expected_report_by: string | null }>('SELECT slot_at, status, expected_report_by FROM bloodwork_bookings WHERE id = ?', [row.id])!;
    assert.equal(Date.parse(now.slot_at), Date.parse(newSlot));
    assert.ok(now.status === 'confirmed' || now.status === 'scheduled');

    // the expected report time moves with the slot, by the formula the order used (slot + turnaround + 4 h)
    assert.equal(now.expected_report_by, expectedBy(newSlot, row.turnaround));
    assert.equal(Date.parse(now.expected_report_by!), Date.parse(addHours(newSlot, turnaroundHours(row.turnaround)! + 4)));
    assert.equal((moved.json as { expectedReportBy?: string }).expectedReportBy, now.expected_report_by, 'the member sees the new time');

    // BookingUpdated is emitted at once, the status unchanged and the move marked, so slot-bound handlers follow it
    const events = g.db.all<{ payload: string }>("SELECT payload FROM domain_events WHERE type = 'BookingUpdated' AND aggregate_id = ? ORDER BY created_at, rowid", [row.id]);
    assert.equal(events.length, eventsBefore + 1);
    const payload = JSON.parse(events[events.length - 1]!.payload) as Record<string, unknown>;
    assert.equal(payload.rescheduled, true);
    assert.equal(payload.from, row.status);
    assert.equal(payload.to, row.status);
    assert.equal(Date.parse(String(payload.slotTo)), Date.parse(newSlot));

    const vendor = { mode: 'standin' as const, name: 'LabStack (test)' };
    const at = (iso: string) => operations({ ...g.ctx, now: () => iso }, vendor).breaching.items.find((x) => x.bookingId === row.id);

    // two hours after the report time computed for the OLD slot, days before the new one: not breaching
    assert.ok(Date.parse(addHours(staleReportBy, 2)) < Date.parse(newSlot));
    assert.equal(at(addHours(staleReportBy, 2)), undefined, 'a moved booking is not reported late before its new slot');
    assert.equal(at(addHours(newSlot, -1)), undefined);

    // an hour after the new slot without a collection: collection overdue, due at the new slot
    const late = at(addHours(newSlot, 1));
    assert.equal(late?.kind, 'collection_overdue');
    assert.equal(Date.parse(late!.dueAt), Date.parse(newSlot));

    // once collected, the report deadline follows the new slot: slot + turnaround + 4 h, the stored expected time
    g.db.update('bloodwork_bookings', row.id, { status: 'processing' });
    const due = addHours(newSlot, turnaroundHours(row.turnaround)! + 4);
    assert.equal(Date.parse(due), Date.parse(now.expected_report_by!));
    assert.equal(at(addHours(due, -1)), undefined, 'not due yet');
    assert.equal(at(addHours(staleReportBy, 2)), undefined, 'collected, but nowhere near the deadline of the new slot');
    const overdue = at(addHours(due, 1));
    assert.equal(overdue?.kind, 'report_overdue');
    assert.equal(Date.parse(overdue!.dueAt), Date.parse(due));
  } finally {
    await g.app.close();
    g.db.close();
  }
});

test('one failure is counted once: a failed catalogue sync or order placement is listed as its open task, not again as a call', async () => {
  const g = await makeApp();
  try {
    const owner = await signIn(g.app, DEMO.owner, DEMO_PASSWORDS.owner, true);
    const now = new Date().toISOString();
    const booking = g.db.get<{ id: string }>("SELECT id FROM bloodwork_bookings WHERE status NOT IN ('completed','cancelled') ORDER BY id LIMIT 1")!;
    // what api/domain/bloodwork.ts records when a catalogue sync and an order placement fail: a failed call and a task each
    const task = (id: string, kind: string, refType: string, refId: string, createdAt: string) => g.db.insert('support_tasks', { id, kind, status: 'open', title: `Test ${kind}`, detail: 'Test task', ref_type: refType, ref_id: refId, owner_id: null, created_by: 'system', created_at: createdAt, updated_at: createdAt });
    task('stk_opstest_sync', 'vendor_sync_failure', 'integration', 'labstack', addHours(now, -3));
    task('stk_opstest_place', 'failed_booking', 'booking', booking.id, addHours(now, -2));
    setIntegration(g.ctx, { failures: [
      { at: addHours(now, -3), call: 'catalogue_sync', message: 'HTTP 500 (test)' },
      { at: addHours(now, -2), call: 'placeOrder', message: 'timeout (test)' },
      { at: addHours(now, -1), call: 'placeOrder', message: 'timeout (test)' },
      { at: addHours(now, -1), call: 'getSlots', message: 'HTTP 502 (test)' },
    ] });

    const o = (await owner.get(PATH)).json as unknown as Ops;
    const calls = o.escalations.items.filter((x) => x.source === 'vendor_call');
    assert.deepEqual(calls.map((x) => x.id), ['vendor_call:getSlots'], 'only the call that opened no task is listed as a call');
    assert.deepEqual(o.escalations.coveredFailedCalls, { catalogue_sync: 1, placeOrder: 2 });
    const ids = o.escalations.items.map((x) => x.id);
    assert.ok(ids.includes('stk_opstest_sync') && ids.includes('stk_opstest_place'), 'the tasks stand for those failures');
    assert.equal(o.counters.escalationsOpen, o.escalations.items.filter((x) => x.source === 'task').length + 1);
    assert.equal(o.health.failedCalls24h, 4, 'health still counts every failed call');

    assert.deepEqual(o.escalations.bySource, { tasks: o.escalations.items.filter((x) => x.source === 'task').length, failedCalls: 1, failedCallFailures: 1 });
    assert.deepEqual(o.escalations.closedFailedCalls, {});

    // the sync task resolved: the incident is over, so its failure is not an open escalation in any form (not listed as
    // a call again); health still counts it
    g.db.update('support_tasks', 'stk_opstest_sync', { status: 'resolved', resolved_at: addHours(now, -1), updated_at: addHours(now, -1) });
    const o2 = (await owner.get(PATH)).json as unknown as Ops;
    assert.deepEqual(o2.escalations.items.filter((x) => x.source === 'vendor_call').map((x) => x.id), ['vendor_call:getSlots']);
    assert.ok(!o2.escalations.items.some((x) => x.id === 'stk_opstest_sync'));
    assert.deepEqual(o2.escalations.coveredFailedCalls, { placeOrder: 2 });
    assert.deepEqual(o2.escalations.closedFailedCalls, { catalogue_sync: 1 });
    assert.equal(o2.counters.escalationsOpen, o.counters.escalationsOpen - 1, 'resolving the task takes the incident off the counter');
    assert.equal(o2.health.failedCalls24h, 4);

    // a task opened after a failure is not that failure's task: a placeOrder failure from before the failed_booking task
    // was opened (a refusal, which opens none) is still listed as a call
    setIntegration(g.ctx, { failures: [{ at: addHours(now, -5), call: 'placeOrder', message: 'refused (test)' }] });
    const o3 = (await owner.get(PATH)).json as unknown as Ops;
    assert.deepEqual(o3.escalations.items.filter((x) => x.source === 'vendor_call').map((x) => x.id), ['vendor_call:placeOrder']);
    assert.deepEqual(o3.escalations.coveredFailedCalls, {});
  } finally {
    await g.app.close();
    g.db.close();
  }
});

test('real failures name their task: a failed catalogue sync and a failed order placement count once, under the task, and not after it closes', async () => {
  const g = await makeApp();
  try {
    const owner = await signIn(g.app, DEMO.owner, DEMO_PASSWORDS.owner, true);
    // start from no recorded failures and no open laboratory task of these kinds
    setIntegration(g.ctx, { failures: [] });
    g.db.run("UPDATE support_tasks SET status = 'resolved', resolved_at = ? WHERE kind IN ('vendor_sync_failure','failed_booking') AND status IN ('open','in_progress')", [new Date().toISOString()]);
    const before = (await owner.get(PATH)).json as unknown as Ops;

    // the stand-in laboratory, failing: the catalogue is unavailable and an order times out (no earlier order exists)
    const base = g.services.vendor as LabVendor;
    const failing = Object.assign(Object.create(base) as LabVendor, {
      getCatalogue: async () => { throw new VendorError('HTTP 500 (test)', 'unavailable', 500); },
      getOrderDetails: async () => null,
      placeOrder: async () => { throw new VendorError('timeout (test)', 'timeout'); },
    });
    await assert.rejects(syncCatalogue(g.ctx, failing));
    await assert.rejects(syncCatalogue(g.ctx, failing)); // a second failure joins the same open task
    const memberId = userId(g.ctx, DEMO.member);
    const testId = g.db.get<{ id: string }>('SELECT id FROM bloodwork_tests WHERE active = 1 ORDER BY id LIMIT 1')!.id;
    const t0 = new Date().toISOString();
    g.db.insert('bloodwork_bookings', { id: 'bkg_opstest_fail', reference: 'BIO-OPS-FAIL-1', member_id: memberId, test_id: testId, status: 'confirmed', slot_at: addDays(t0, 3), vendor: 'labstack', vendor_order_id: null, vendor_pending: 1, patient: '{}', pincode: '560001', address: 'Sample Street (test)', city: 'Bengaluru', state: 'Karnataka', created_at: t0, updated_at: t0 });
    await placeWithVendor(g.ctx, failing, g.db.get<BookingRow>("SELECT * FROM bloodwork_bookings WHERE id = 'bkg_opstest_fail'")!);

    // each failure record names the task it opened or joined
    const failures = j.out<{ failures?: LabFailure[] }>(g.db.get<{ status: string }>("SELECT status FROM integration_status WHERE integration = 'labstack'")?.status, {}).failures ?? [];
    const syncTask = g.db.get<{ id: string }>("SELECT id FROM support_tasks WHERE kind = 'vendor_sync_failure' AND status = 'open'")!;
    const placeTask = g.db.get<{ id: string }>("SELECT id FROM support_tasks WHERE kind = 'failed_booking' AND ref_id = 'bkg_opstest_fail' AND status = 'open'")!;
    assert.deepEqual(failures.filter((f) => f.call === 'catalogue_sync').map((f) => f.taskId), [syncTask.id, syncTask.id]);
    assert.deepEqual(failures.filter((f) => f.call === 'placeOrder').map((f) => [f.taskId, f.bookingId]), [[placeTask.id, 'bkg_opstest_fail']]);

    // counted once: two tasks, no failed-call entry, the three failures under their tasks
    const o = (await owner.get(PATH)).json as unknown as Ops;
    assert.equal(o.escalations.items.filter((x) => x.source === 'vendor_call').length, 0);
    assert.ok(o.escalations.items.some((x) => x.id === syncTask.id) && o.escalations.items.some((x) => x.id === placeTask.id));
    assert.deepEqual(o.escalations.coveredFailedCalls, { catalogue_sync: 2, placeOrder: 1 });
    assert.equal(o.counters.escalationsOpen, before.counters.escalationsOpen + 2, 'two incidents, two escalations');
    assert.equal(o.escalations.bySource.tasks, before.escalations.bySource.tasks + 2);
    assert.equal(o.escalations.bySource.failedCalls, 0);
    assert.equal(o.health.failedCalls24h, 3, 'health counts every failed call');

    // the team resolves the sync task: that incident leaves the counter entirely
    g.db.update('support_tasks', syncTask.id, { status: 'resolved', resolution: 'test: retried', resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    const o2 = (await owner.get(PATH)).json as unknown as Ops;
    assert.equal(o2.counters.escalationsOpen, before.counters.escalationsOpen + 1);
    assert.equal(o2.escalations.items.filter((x) => x.source === 'vendor_call').length, 0, 'not listed again as a call');
    assert.deepEqual(o2.escalations.closedFailedCalls, { catalogue_sync: 2 });
    assert.deepEqual(o2.escalations.coveredFailedCalls, { placeOrder: 1 });

    // a refusal cancels the booking and opens no task: it is listed as a failed call
    const refusing = Object.assign(Object.create(base) as LabVendor, { getOrderDetails: async () => null, placeOrder: async () => { throw new VendorError('slot refused (test)', 'rejected', 422); } });
    g.db.insert('bloodwork_bookings', { id: 'bkg_opstest_refused', reference: 'BIO-OPS-FAIL-2', member_id: memberId, test_id: testId, status: 'confirmed', slot_at: addDays(t0, 4), vendor: 'labstack', vendor_order_id: null, vendor_pending: 1, patient: '{}', pincode: '560001', address: 'Sample Street (test)', city: 'Bengaluru', state: 'Karnataka', created_at: t0, updated_at: t0 });
    await placeWithVendor(g.ctx, refusing, g.db.get<BookingRow>("SELECT * FROM bloodwork_bookings WHERE id = 'bkg_opstest_refused'")!);
    assert.equal(g.db.get<{ status: string }>("SELECT status FROM bloodwork_bookings WHERE id = 'bkg_opstest_refused'")!.status, 'cancelled');
    const o3 = (await owner.get(PATH)).json as unknown as Ops;
    const call = o3.escalations.items.find((x) => x.id === 'vendor_call:placeOrder');
    assert.equal(call?.count, 1, 'the refusal is its own entry; the timeout stays under its task');
    assert.deepEqual(o3.escalations.coveredFailedCalls, { placeOrder: 1 });
    assert.equal(o3.counters.escalationsOpen, before.counters.escalationsOpen + 2);
  } finally {
    await g.app.close();
    g.db.close();
  }
});
