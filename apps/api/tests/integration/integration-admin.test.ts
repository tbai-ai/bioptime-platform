/* Round 6, integration (admin and coach routes):
   - Data requests: an administrator's note never overwrites the member's own words. The team's note is kept apart
     (data_request_admin_notes, migration 0021) and returned to administrators only, as adminNote; members never receive
     it (POST /me/data-requests, GET /me/data-exports, the data export archive).
   - Meeting links on GET /coach/clients/:id, GET /admin/members/:id and GET /coach/home go through the sessions presenter
     (shownLink): a placeholder link or a link with whitespace or control characters never reaches a page.
   - Moving a booking that the laboratory has not accepted yet keeps it waiting for placement; the safety net then places
     it at the new slot with the report time computed from that slot; the move emits BookingUpdated { rescheduled }.
   - A bespoke order works out GST at the configured rate (gst_rate_bp) and records the rate on the order.
   - GET /conversations and GET /conversations/:id/messages: administrators need members.manage; coaches and members
     stay participant-only. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId } from '../helpers.js';
import { addDays, addMinutes } from '../../src/lib/time.js';
import { buildArchive } from '../../src/domain/dataExport.js';
import { expectedBy, safetyNet } from '../../src/domain/bloodwork.js';
import { gstIncluded } from '../../src/domain/orders.js';
import { processPending } from '../../src/domain/events.js';

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); h.db.close(); });

const signIn = async (email: string, password: string, mfa = false) => { const c = client(h.app); await c.login(email, password, password === DEMO_PASSWORDS.member ? 'member' : 'dashboard', mfa); return c; };
const setPermission = async (owner: Awaited<ReturnType<typeof signIn>>, email: string, permission: string, granted: boolean) => {
  const r = await owner.post(`/api/admin/users/${userId(h.ctx, email)}/permissions`, { permission, granted, reason: `integration test: ${granted ? 'grant' : 'revoke'} ${permission}` });
  assert.equal(r.status, 200, JSON.stringify(r.json));
};

test('data requests: the member’s note stays their own; the team’s note is kept apart and reaches administrators only', async () => {
  const member = await signIn(DEMO.member2, DEMO_PASSWORDS.member);
  const admin = await signIn(DEMO.admin, DEMO_PASSWORDS.admin, true);
  const owner = await signIn(DEMO.owner, DEMO_PASSWORDS.owner, true);
  const coach = await signIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const memberId = userId(h.ctx, DEMO.member2);
  const MEMBER_NOTE = 'Please include my blood test history (member wording)';
  const TEAM_NOTE = 'Identity confirmed by phone call (team wording)';

  const created = await member.post('/api/me/data-requests', { kind: 'export', note: MEMBER_NOTE });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const id = created.json.id as string;
  assert.equal(created.json.note, MEMBER_NOTE);

  // coaches and members cannot progress it
  assert.equal((await coach.patch(`/api/admin/data-requests/${id}`, { status: 'in_progress', note: 'x' })).status, 403);
  assert.equal((await member.patch(`/api/admin/data-requests/${id}`, { status: 'in_progress', note: 'x' })).status, 403);

  // the administrator progresses it with a note of their own
  const patched = await admin.patch(`/api/admin/data-requests/${id}`, { status: 'in_progress', note: `  ${TEAM_NOTE}  ` });
  assert.equal(patched.status, 200, JSON.stringify(patched.json));
  assert.equal(patched.json.note, MEMBER_NOTE, 'the member’s words are not overwritten');
  assert.equal(patched.json.adminNote, TEAM_NOTE);
  assert.equal(patched.json.status, 'in_progress');
  assert.equal(h.db.get<{ note: string }>('SELECT note FROM data_requests WHERE id = ?', [id])!.note, MEMBER_NOTE);
  assert.equal(h.db.get<{ admin_note: string }>('SELECT admin_note FROM data_request_admin_notes WHERE request_id = ?', [id])!.admin_note, TEAM_NOTE);
  const audited = h.db.get<{ reason: string; actor_role: string }>("SELECT reason, actor_role FROM audit_events WHERE action = 'data_request.update' AND target_id = ? ORDER BY at DESC, rowid DESC LIMIT 1", [id])!;
  assert.equal(audited.reason, TEAM_NOTE, 'the change is audited with the team’s note');
  assert.equal(audited.actor_role, 'admin');

  // a change of status without a note keeps both notes
  const kept = await admin.patch(`/api/admin/data-requests/${id}`, { status: 'in_progress' });
  assert.equal(kept.json.note, MEMBER_NOTE);
  assert.equal(kept.json.adminNote, TEAM_NOTE);

  // administrators see both, separately: the list and the member record
  const list = await admin.get('/api/admin/data-requests');
  const row = (list.json.items as Array<Record<string, unknown>>).find((x) => x.id === id)!;
  assert.equal(row.note, MEMBER_NOTE);
  assert.equal(row.adminNote, TEAM_NOTE);
  const record = await admin.get(`/api/admin/members/${memberId}`);
  assert.equal(record.status, 200);
  const inRecord = (record.json.dataRequests as Array<Record<string, unknown>>).find((x) => x.id === id)!;
  assert.equal(inRecord.note, MEMBER_NOTE);
  assert.equal(inRecord.adminNote, TEAM_NOTE);

  // an administrator without members.manage gets neither
  await setPermission(owner, DEMO.admin, 'members.manage', false);
  try {
    assert.equal((await admin.get('/api/admin/data-requests')).status, 403);
    assert.equal((await admin.patch(`/api/admin/data-requests/${id}`, { status: 'in_progress', note: 'x' })).status, 403);
  } finally {
    await setPermission(owner, DEMO.admin, 'members.manage', true);
  }

  // members never receive the team's note: asking again returns the open request as stored, without it
  const again = await member.post('/api/me/data-requests', { kind: 'export', note: 'asking again' });
  assert.equal(again.json.id, id, 'the open request is returned');
  assert.equal(again.json.note, MEMBER_NOTE);
  assert.ok(!again.text.includes(TEAM_NOTE), 'POST /me/data-requests carries no team note');
  assert.ok(!('adminNote' in again.json) && !('admin_note' in again.json));
  const mine = await member.get('/api/me/data-exports');
  if (mine.status === 200) assert.ok(!mine.text.includes(TEAM_NOTE), 'GET /me/data-exports carries no team note');
  for (const path of ['/api/me', '/api/me/profile']) assert.ok(!(await member.get(path)).text.includes(TEAM_NOTE), `${path} carries no team note`);
  // nor does the data export archive
  assert.ok(!JSON.stringify(buildArchive(h.ctx, memberId, id)).includes(TEAM_NOTE), 'the export archive carries no team note');
  // nor a coach (the member record a coach reads has no data requests)
  const assigned = h.db.get<{ email: string }>("SELECT u.email FROM coach_assignments a JOIN users u ON u.id = a.coach_id WHERE a.member_id = ? AND a.status = 'active'", [memberId]);
  if (assigned) {
    const theirCoach = await signIn(assigned.email, DEMO_PASSWORDS.coach);
    assert.ok(!(await theirCoach.get(`/api/coach/clients/${memberId}`)).text.includes(TEAM_NOTE));
  }

  // an empty note clears the team's note; the member's note stays
  const cleared = await admin.patch(`/api/admin/data-requests/${id}`, { status: 'completed', note: '' });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.json.note, MEMBER_NOTE);
  assert.equal(cleared.json.adminNote, null);
  assert.ok(cleared.json.completed_at, 'completing still stamps the time');
  assert.equal(h.db.get('SELECT 1 AS x FROM data_request_admin_notes WHERE request_id = ?', [id]), undefined);
  assert.equal((await admin.patch('/api/admin/data-requests/drq_doesnotexist', { status: 'completed', note: 'x' })).status, 404);
  assert.equal(h.db.get('SELECT 1 AS x FROM data_request_admin_notes WHERE request_id = ?', ['drq_doesnotexist']), undefined, 'nothing is written for an unknown request');
});

test('meeting links on the coach and admin member records pass the presenter: placeholders and links with whitespace or control characters never reach a page', async () => {
  const memberId = userId(h.ctx, DEMO.member);
  const coachId = h.db.get<{ coach_id: string }>("SELECT coach_id FROM coach_assignments WHERE member_id = ? AND status = 'active'", [memberId])!.coach_id;
  const coachEmail = h.db.get<{ email: string }>('SELECT email FROM users WHERE id = ?', [coachId])!.email;
  const coach = await signIn(coachEmail, DEMO_PASSWORDS.coach);
  const admin = await signIn(DEMO.admin, DEMO_PASSWORDS.admin, true);

  // an appointment ahead of the member's other upcoming ones, so it is their next appointment
  const now = new Date().toISOString();
  const earliest = h.db.get<{ s: string | null }>("SELECT MIN(start_at) s FROM appointments WHERE member_id = ? AND status IN ('requested','scheduled') AND start_at >= ?", [memberId, now])!.s;
  const startAt = earliest && Date.parse(earliest) - 60_000 < Date.parse(addMinutes(now, 30)) ? new Date(Date.parse(earliest) - 60_000).toISOString() : addMinutes(now, 30);
  assert.ok(Date.parse(startAt) > Date.now() + 5_000, 'the test appointment is still ahead');
  const apptId = 'apt_r6_badlink';
  h.db.insert('appointments', { id: apptId, member_id: memberId, coach_id: coachId, programme_id: null, kind: 'check_in', status: 'scheduled', start_at: startAt, end_at: addMinutes(startAt, 30), timezone: 'Asia/Kolkata', meeting_link: null, created_at: now, updated_at: now });

  const read = async () => {
    const c = await coach.get(`/api/coach/clients/${memberId}`);
    const a = await admin.get(`/api/admin/members/${memberId}`);
    const home = await coach.get('/api/coach/home');
    assert.equal(c.status, 200, JSON.stringify(c.json));
    assert.equal(a.status, 200, JSON.stringify(a.json));
    assert.equal(home.status, 200, JSON.stringify(home.json));
    const cNext = c.json.nextAppointment as Record<string, unknown>;
    const aNext = a.json.nextAppointment as Record<string, unknown>;
    assert.equal(cNext?.id, apptId, 'the test appointment is the next one (coach)');
    assert.equal(aNext?.id, apptId, 'the test appointment is the next one (admin)');
    const homeRows = ['todaysAppointments', 'upcomingAppointments', 'requestedAppointments'].flatMap((k) => (home.json[k] as Array<Record<string, unknown>>) ?? []);
    return { coachLink: cNext.meeting_link, adminLink: aNext.meeting_link, homeLink: homeRows.find((r) => r.id === apptId)?.meeting_link, texts: [c.text, a.text, home.text] };
  };

  const BAD = [
    'https://meet.example.org/abc\r\nATTACH:https://evil.example/x\r\nX-INJECTED:1', // line breaks: calendar injection
    'https://meet.example.org/a b', // a space
    'https://meet.example.org/tab\there', // a tab
    'https://meet.example.org/nul\u0000x', // a control character
    'https://meet.bioptime.example/placeholder-r6', // the old placeholder
    'http://meet.example.org/plain-http', // not https
  ];
  for (const link of BAD) {
    h.db.update('appointments', apptId, { meeting_link: link });
    const r = await read();
    assert.equal(r.coachLink, null, `coach: ${JSON.stringify(link)} is not shown`);
    assert.equal(r.adminLink, null, `admin: ${JSON.stringify(link)} is not shown`);
    assert.ok(r.homeLink === undefined || r.homeLink === null, `coach home: ${JSON.stringify(link)} is not shown`);
    for (const t of r.texts) {
      assert.ok(!t.includes('X-INJECTED') && !t.includes('evil.example'), 'no injected text in any response');
      assert.ok(!t.includes('meet.bioptime.example'), 'no placeholder in any response');
      assert.ok(!t.includes('plain-http') && !t.includes('meet.example.org/a b') && !t.includes('nul\\u0000x'), 'no unsafe link in any response');
    }
  }

  // a sound link on a scheduled appointment is shown as it is; on one still requested it is not shown yet
  const GOOD = 'https://meet.example.org/room-r6';
  h.db.update('appointments', apptId, { meeting_link: GOOD });
  const ok = await read();
  assert.equal(ok.coachLink, GOOD);
  assert.equal(ok.adminLink, GOOD);
  h.db.update('appointments', apptId, { status: 'requested' });
  const requested = await read();
  assert.equal(requested.coachLink, null, 'only a scheduled appointment carries its link, as appointments.present does');
  assert.equal(requested.adminLink, null);
  h.db.update('appointments', apptId, { status: 'cancelled' });
});

test('moving a booking the laboratory has not accepted keeps it waiting; the safety net places it at the new slot; the move emits BookingUpdated', async () => {
  const member = await signIn(DEMO.member, DEMO_PASSWORDS.member);
  const memberId = userId(h.ctx, DEMO.member);
  const test = h.db.get<{ id: string; turnaround: string }>('SELECT id, turnaround FROM bloodwork_tests WHERE active = 1 AND hidden = 0 ORDER BY id LIMIT 1')!;
  const now = new Date().toISOString();
  const id = 'bkg_r6_unplaced';
  h.db.insert('bloodwork_bookings', { id, reference: 'BIO-R6-UNPLACED', member_id: memberId, test_id: test.id, status: 'confirmed', slot_at: addDays(now, 3), vendor: 'labstack', vendor_order_id: null, vendor_pending: 1, patient: JSON.stringify({ name: 'Test member', email: 'test@demo.bioptime.test', mobile: '9876543210', gender: 'female', dateOfBirth: '1990-01-01', age: 36 }), pincode: '560001', address: 'Sample Street (test)', city: 'Bengaluru', state: 'Karnataka', flag: 'waiting for the lab', created_at: now, updated_at: now });

  const newSlot = addDays(now, 6);
  const moved = await member.patch(`/api/me/bloodwork/bookings/${id}`, { slotAt: newSlot });
  assert.equal(moved.status, 200, JSON.stringify(moved.json));
  const row = h.db.get<{ slot_at: string; vendor_pending: number; expected_report_by: string | null; flag: string | null }>('SELECT slot_at, vendor_pending, expected_report_by, flag FROM bloodwork_bookings WHERE id = ?', [id])!;
  assert.equal(Date.parse(row.slot_at), Date.parse(newSlot));
  assert.equal(row.vendor_pending, 1, 'still waiting to be placed with the laboratory');
  assert.equal(row.expected_report_by, null, 'no expected report time before the laboratory has the order');

  const event = h.db.get<{ id: string; payload: string }>("SELECT id, payload FROM domain_events WHERE type = 'BookingUpdated' AND aggregate_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1", [id]);
  assert.ok(event, 'BookingUpdated is emitted for the move');
  const payload = JSON.parse(event!.payload) as Record<string, unknown>;
  assert.deepEqual([payload.from, payload.to, payload.rescheduled], ['confirmed', 'confirmed', true]);
  await processPending(h.ctx);
  const processed = h.db.get<{ processed_at: string | null; last_error: string | null }>('SELECT processed_at, last_error FROM domain_events WHERE id = ?', [event!.id])!;
  assert.ok(processed.processed_at, `the event is handled without error (${processed.last_error ?? ''})`);

  await safetyNet(h.ctx, h.services.vendor);
  const placed = h.db.get<{ vendor_order_id: string | null; vendor_pending: number; expected_report_by: string | null }>('SELECT vendor_order_id, vendor_pending, expected_report_by FROM bloodwork_bookings WHERE id = ?', [id])!;
  assert.ok(placed.vendor_order_id, 'the safety net placed it');
  assert.equal(placed.vendor_pending, 0);
  assert.equal(placed.expected_report_by, expectedBy(newSlot, test.turnaround), 'its report time follows the new slot');
});

test('a bespoke order works out GST at the configured rate and records the rate on the order', async () => {
  const owner = await signIn(DEMO.owner, DEMO_PASSWORDS.owner, true);
  const member = await signIn(DEMO.memberNoCoach, DEMO_PASSWORDS.member);
  const orderFor = async (priceInr: number) => {
    const created = await member.post('/api/me/custom-plans', { goals: 'Sample bespoke goals for the GST rate test', duration: '3 months' });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const id = created.json.id as string;
    const move = async (to: string, extra: Record<string, unknown> = {}) => { const r = await owner.post(`/api/admin/custom-plans/${id}/transition`, { to, ...extra }); assert.equal(r.status, 200, JSON.stringify(r.json)); };
    await move('under_review');
    await move('scoping');
    await move('awaiting_internal_approval', { proposal: { durationMonths: 3, durationLabel: 'Sample 3 months', consultations: 2, bloodworkEntitlements: 1, priceInr } });
    await move('proposal_sent', { approval: 'Sample approval (GST test)' });
    const accepted = await member.post(`/api/me/custom-plans/${id}/accept`);
    assert.equal(accepted.status, 200, JSON.stringify(accepted.json));
    const order = h.db.get<{ id: string; amount_paise: number; gst_paise: number; total_paise: number; metadata: string }>('SELECT id, amount_paise, gst_paise, total_paise, metadata FROM orders WHERE custom_plan_id = ?', [id])!;
    return { ...order, gstRateBp: (JSON.parse(order.metadata) as { gstRateBp?: unknown }).gstRateBp };
  };

  // at the default rate (1800): the same figures the old 1.18 constant gave, and the rate is recorded
  const atDefault = await orderFor(12345);
  assert.equal(atDefault.total_paise, 1234500);
  assert.equal(atDefault.gstRateBp, 1800);
  assert.equal(atDefault.gst_paise, gstIncluded(1234500, 1800));
  assert.equal(atDefault.gst_paise, Math.round(1234500 - 1234500 / 1.18));
  assert.equal(atDefault.amount_paise + atDefault.gst_paise, atDefault.total_paise);

  // at a configured rate (5%): the order follows the setting
  assert.equal((await owner.patch('/api/admin/module-settings', { key: 'gst_rate_bp', value: 500, reason: 'integration test: bespoke GST rate' })).status, 200);
  try {
    const atFive = await orderFor(10000);
    assert.equal(atFive.gstRateBp, 500);
    assert.equal(atFive.gst_paise, gstIncluded(1000000, 500));
    assert.equal(atFive.gst_paise, Math.round(1000000 - 1000000 / 1.05));
    assert.equal(atFive.amount_paise, atFive.total_paise - atFive.gst_paise);
  } finally {
    assert.equal((await owner.patch('/api/admin/module-settings', { key: 'gst_rate_bp', value: 1800, reason: 'integration test: back to the default' })).status, 200);
  }
});

test('threads: administrators read them only with members.manage; coaches and members stay participant-only', async () => {
  const owner = await signIn(DEMO.owner, DEMO_PASSWORDS.owner, true);
  const admin = await signIn(DEMO.admin, DEMO_PASSWORDS.admin, true);
  const member = await signIn(DEMO.member, DEMO_PASSWORDS.member);
  const otherMember = await signIn(DEMO.member2, DEMO_PASSWORDS.member);
  const memberId = userId(h.ctx, DEMO.member);
  const conv = h.db.get<{ id: string; coach_id: string }>('SELECT id, coach_id FROM conversations WHERE member_id = ? ORDER BY created_at LIMIT 1', [memberId])!;
  assert.ok(conv, 'the demo member has a thread with their coach');
  const coachEmail = h.db.get<{ email: string }>('SELECT email FROM users WHERE id = ?', [conv.coach_id])!.email;
  const theirCoach = await signIn(coachEmail, DEMO_PASSWORDS.coach);
  const otherCoachEmail = [DEMO.coach, DEMO.coach2, DEMO.coach3].find((e) => e !== coachEmail)!;
  const otherCoach = await signIn(otherCoachEmail, DEMO_PASSWORDS.coach);
  const THREAD = `/api/conversations/${conv.id}/messages`;
  const reads = () => h.db.get<{ n: number }>("SELECT COUNT(*) n FROM audit_events WHERE action = 'messages.admin_read' AND target_id = ?", [conv.id])!.n;

  // participants read it
  assert.equal((await member.get(THREAD)).status, 200);
  assert.equal((await theirCoach.get(THREAD)).status, 200);
  // others do not
  assert.equal((await otherMember.get(THREAD)).json.error?.code, 'NO_ACCESS');
  assert.equal((await otherCoach.get(THREAD)).json.error?.code, 'NO_ACCESS', 'a coach who is not assigned');

  // an administrator with members.manage reads it (audited); the owner too
  const before = reads();
  const allowed = await admin.get(THREAD);
  assert.equal(allowed.status, 200, JSON.stringify(allowed.json));
  assert.ok(Array.isArray(allowed.json.items));
  assert.equal(reads(), before + 1, 'the read is audited');
  assert.equal((await owner.get(THREAD)).status, 200);
  assert.equal((await admin.get('/api/conversations')).status, 200);
  const readsBeforeRevoke = reads();

  // without members.manage: refused, and nothing of the thread is sent
  await setPermission(owner, DEMO.admin, 'members.manage', false);
  try {
    const refused = await admin.get(THREAD);
    assert.equal(refused.status, 403);
    assert.equal(refused.json.error?.code, 'PERMISSION_DENIED');
    assert.equal(refused.json.items, undefined);
    const list = await admin.get('/api/conversations');
    assert.equal(list.status, 403, 'the list carries message previews, so it needs the permission too');
    assert.equal(list.json.items, undefined);
    assert.equal(reads(), readsBeforeRevoke, 'a refused read is not a read');
    // an unknown thread answers the same way (no hint that it exists or not)
    assert.equal((await admin.get('/api/conversations/cnv_doesnotexist/messages')).json.error?.code, 'PERMISSION_DENIED');
  } finally {
    await setPermission(owner, DEMO.admin, 'members.manage', true);
  }
  assert.equal((await admin.get(THREAD)).status, 200, 'granted again');
  // writing stays with the participants
  assert.equal((await admin.post(THREAD, { body: 'admin note' })).json.error?.code, 'NO_ACCESS');
});
