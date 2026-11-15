/* M7 Lab follow-ups and preparation reminders: next steps only after a report is reviewed or released; members read
   their own released reports' next steps only; coaches reach assigned clients only and only while the client shares
   health information (coach_sharing); the team writes on its own releases with a reason (integrations.manage) and reads
   with reports.view; validation answers field by field; every write is audited; one preparation reminder per booking,
   worded from the laboratory's text, moved as soon as a reschedule's BookingUpdated is processed (the job is the safety
   net) and cancelled on cancel; neither the team nor a reassigned coach rewrites a coach's words; overdue filtered in
   the query; the data
   export section; the feature flag; the labelled demo rows. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId } from '../helpers.js';
import type { Ctx } from '../../src/context.js';
import { findRestrictedFields, restrictedKeys } from '../../src/auth/fieldPolicy.js';
import { setUserPermission } from '../../src/auth/permissions.js';
import { moduleJobs } from '../../src/jobs.js';
import { processPending } from '../../src/domain/events.js';
import { emit } from '../../src/domain/audit.js';
import { buildArchive } from '../../src/domain/dataExport.js';
import { labFollowups as labModule } from '../../src/modules/labFollowups.js';
import * as lab from '../../src/domain/labFollowups.js';
import * as bloodwork from '../../src/domain/bloodwork.js';
import * as reminders from '../../src/domain/reminders.js';
import { addDays, addHours, addMinutes, zonedToIso } from '../../src/lib/time.js';
import { SHOWCASE_MEMBER } from '../../src/seed/showcase.js';

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); h.db.close(); });

const as = (email: string, now?: string): Ctx => {
  const u = h.db.get<{ id: string; role: 'member' | 'coach' | 'admin' | 'owner'; name: string }>('SELECT id, role, name FROM users WHERE email = ?', [email])!;
  return { ...h.ctx, actor: { id: u.id, role: u.role, email, name: u.name }, ...(now ? { now: () => now } : {}) };
};
const at = (iso: string): Ctx => ({ ...h.ctx, now: () => iso });
const signedIn = async (email: string, password: string, mfa = false) => { const c = client(h.app); await c.login(email, password, password === DEMO_PASSWORDS.member ? 'member' : 'dashboard', mfa); return c; };
/** The error code, or the state error's own code (errors.state answers INVALID_STATE with details.code). */
const code = (r: { json: { error?: { code: string; details?: unknown } } }) => (r.json.error?.details as { code?: string } | undefined)?.code ?? r.json.error?.code;
const auditRows = (action: string, targetId: string) => h.db.all<{ actor_id: string | null; actor_role: string; reason: string | null; data: string }>('SELECT actor_id, actor_role, reason, data FROM audit_events WHERE action = ? AND target_id = ? ORDER BY at', [action, targetId]);
const releasedReportOf = (email: string) => h.db.get<{ id: string; booking_id: string }>('SELECT id, booking_id FROM report_metadata WHERE member_id = ? AND released_at IS NOT NULL ORDER BY released_at LIMIT 1', [userId(h.ctx, email)]);
const anyReportOf = (email: string) => h.db.get<{ id: string; booking_id: string; released_at: string | null }>('SELECT id, booking_id, released_at FROM report_metadata WHERE member_id = ? ORDER BY delivered_at LIMIT 1', [userId(h.ctx, email)])!;
const prepRows = (bookingId: string) => h.db.all<{ id: string; user_id: string; due_at: string; status: string; category: string; title: string; body: string; channels: string }>("SELECT * FROM reminders WHERE ref_type = 'lab_preparation' AND ref_id = ? ORDER BY created_at, due_at", [bookingId]);
const queuedPrep = (bookingId: string) => prepRows(bookingId).filter((r) => r.status === 'queued');
const istToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const dateAhead = (days: number) => addDays(`${istToday()}T00:00:00.000Z`, days).slice(0, 10);
function weekdayAhead(days: number): string {
  let d = dateAhead(days);
  while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDays(`${d}T00:00:00Z`, 1).slice(0, 10);
  return d;
}
const job = () => moduleJobs().find((j) => j.name === 'labFollowups.preparation_sync')!;
/** The next steps the demo seed writes on Ananya's reviewed report. */
const SEEDED_NEXT_STEPS = ['Go through this report together at the next appointment.', 'Add the two short outdoor sessions a week from the review note to the plan.', 'Agree with your doctor whether and when to test again. No date is set.'];

test('the demo seed writes three next steps in plain words with no invented dates; the module registers its job and handlers', async () => {
  // the preview member's three come from api/seed/showcase.ts (her coach's next steps on her second report), the same way
  const priya = userId(h.ctx, SHOWCASE_MEMBER);
  const showcase = h.db.all<{ note: string; due_date: string | null; kind: string; created_by_role: string }>('SELECT * FROM lab_followups WHERE member_id = ?', [priya]);
  assert.deepEqual(showcase.map((r) => r.kind).sort(), ['consultation', 'plan_change', 'retest']);
  for (const r of showcase) assert.deepEqual([/\bdemo\b|\bsample\b/i.test(r.note), r.due_date, r.created_by_role], [false, null, 'coach']);
  const rows = h.db.all<{ note: string; due_date: string | null; status: string; kind: string; created_by_role: string; member_id: string }>('SELECT * FROM lab_followups WHERE member_id != ?', [priya]);
  assert.equal(rows.length, 3);
  for (const r of rows) {
    assert.ok(SEEDED_NEXT_STEPS.includes(r.note), r.note);
    assert.doesNotMatch(r.note, /\bdemo\b|\bsample\b/i, 'the owner removed the demo and sample labels');
    assert.equal(r.due_date, null, 'no retest interval or due date is invented for the demo');
    assert.equal(r.created_by_role, 'coach');
    assert.equal(r.member_id, userId(h.ctx, DEMO.member));
  }
  assert.deepEqual(rows.map((r) => r.kind).sort(), ['consultation', 'plan_change', 'retest']);
  assert.equal(rows.filter((r) => r.status === 'done').length, 1);
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM audit_events WHERE action = 'lab_followup.create'")!.n, 6, 'the seed writes through the audited path');
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM notifications WHERE category = 'lab_followup'")!.n, 0, 'the seed sends no notification');
  assert.ok(job(), 'the preparation_sync job is registered');
  assert.equal(job().everyMs, 10 * 60_000);
  assert.ok(labModule.events?.BookingCreated?.length && labModule.events?.BookingUpdated?.length, 'the booking handlers are registered');
  assert.equal(labModule.fileAccess, undefined, 'no private files');
  const owner = await signedIn(DEMO.owner, DEMO_PASSWORDS.owner, true);
  const mods = await owner.get('/api/admin/modules');
  const m = (mods.json.modules as Array<{ key: string; jobs: string[]; events: string[]; demoSeed: boolean; fileKinds: string[] }>).find((x) => x.key === 'labFollowups')!;
  assert.deepEqual(m.jobs, ['preparation_sync']);
  assert.deepEqual(m.events.sort(), ['BookingCreated', 'BookingUpdated']);
  assert.ok(m.demoSeed);
  assert.deepEqual(m.fileKinds, []);
});

test('a member reads the next steps on their own released reports only; other roles’ routes are closed to them', async () => {
  const ananya = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const list = await ananya.get('/api/me/lab-follow-ups');
  assert.equal(list.status, 200, JSON.stringify(list.json));
  const items = list.json.items as Array<Record<string, unknown> & { kind: string; status: string; report: { reference: string; testName: string }; setBy: { role: string }; plan: { title: string } | null; appointment: { startAt: string } | null }>;
  assert.equal(items.length, 3);
  assert.equal(items[0]!.status, 'open', 'open next steps first');
  assert.ok(items.every((i) => i.report?.reference && i.setBy.role === 'coach'));
  assert.ok(items.every((i) => !('cancelledReason' in i) && !('memberName' in i)), 'members get their own view');
  assert.ok(items.find((i) => i.kind === 'plan_change')?.plan?.title, 'a plan change shows its plan');
  assert.ok(items.find((i) => i.kind === 'consultation')?.appointment?.startAt, 'a consultation shows its appointment');
  const report = releasedReportOf(DEMO.member)!;
  assert.equal(((await ananya.get(`/api/me/lab-follow-ups?reportId=${report.id}`)).json.items as unknown[]).length, 3);

  const vikram = await signedIn(DEMO.member2, DEMO_PASSWORDS.member);
  assert.deepEqual((await vikram.get('/api/me/lab-follow-ups')).json.items, [], 'another member sees none of them');
  assert.deepEqual((await vikram.get(`/api/me/lab-follow-ups?reportId=${report.id}`)).json.items, [], 'not even by naming the report');
  // defence in depth: a row on a report that is not released never reaches the member
  const pending = anyReportOf(DEMO.member2);
  assert.equal(pending.released_at, null);
  const now = new Date().toISOString();
  h.db.insert('lab_followups', { id: 'lfu_test_unreleased', report_id: pending.id, member_id: userId(h.ctx, DEMO.member2), coach_id: null, kind: 'note', note: 'Probe on an unreleased report', due_date: null, status: 'open', created_by: userId(h.ctx, DEMO.admin), created_by_role: 'admin', created_at: now, updated_at: now });
  try { assert.deepEqual((await vikram.get('/api/me/lab-follow-ups')).json.items, []); }
  finally { h.db.run("DELETE FROM lab_followups WHERE id = 'lfu_test_unreleased'"); }

  for (const r of [await ananya.get('/api/coach/lab-follow-ups'), await ananya.get(`/api/coach/clients/${userId(h.ctx, DEMO.member)}/lab-follow-ups`), await ananya.post(`/api/coach/reports/${report.id}/follow-ups`, { kind: 'note', note: 'Not mine to write' }), await ananya.get('/api/admin/lab-follow-ups'), await ananya.post(`/api/admin/reports/${report.id}/follow-ups`, { kind: 'note', note: 'Nope', reason: 'test' })]) {
    assert.equal(r.status, 403, JSON.stringify(r.json));
  }
  const prep = await ananya.get('/api/me/lab-preparation');
  assert.equal(prep.status, 200);
  assert.match(String(prep.json.timing), /laboratory’s own preparation text/);
});

test('a coach adds next steps only once the report is reviewed and released, for an assigned client; the member is told without detail; every write is audited', async () => {
  const rahul = await signedIn(DEMO.coach2, DEMO_PASSWORDS.coach);
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const vikramId = userId(h.ctx, DEMO.member2);
  const report = anyReportOf(DEMO.member2);
  const early = await rahul.post(`/api/coach/reports/${report.id}/follow-ups`, { kind: 'consultation', note: 'Talk through the results' });
  assert.equal(early.status, 409);
  assert.equal(code(early), 'NOT_RELEASED');
  const view = await rahul.get(`/api/coach/clients/${vikramId}/lab-follow-ups?reportId=${report.id}`);
  assert.equal(view.status, 200, JSON.stringify(view.json));
  assert.equal(view.json.canAdd, false);
  assert.equal((await rahul.post(`/api/coach/reports/${report.id}/review`, { coachNote: 'Reviewed for the test: in range except the flags the laboratory marked.' })).status, 200);

  const created = await rahul.post(`/api/coach/reports/${report.id}/follow-ups`, { kind: 'consultation', note: 'Talk through the results together', dueDate: dateAhead(7) });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const f = created.json as { id: string; status: string; kind: string; dueDate: string; memberName: string; setBy: { role: string; name: string } };
  assert.equal(f.status, 'open');
  assert.equal(f.dueDate, dateAhead(7));
  assert.equal(f.memberName, 'Vikram Shetty');
  assert.deepEqual(findRestrictedFields(created.json, restrictedKeys()), [], 'the coach payload passes the field policy');
  const createdAudit = auditRows('lab_followup.create', f.id);
  assert.equal(createdAudit.length, 1);
  assert.equal(createdAudit[0]!.actor_id, userId(h.ctx, DEMO.coach2));
  assert.equal(createdAudit[0]!.actor_role, 'coach');
  assert.equal(JSON.parse(createdAudit[0]!.data).reportId, report.id);

  const n = h.db.get<{ id: string; title: string; body: string; data: string }>("SELECT * FROM notifications WHERE user_id = ? AND category = 'lab_followup' ORDER BY created_at DESC LIMIT 1", [vikramId])!;
  assert.equal(n.title, 'A next step from your report');
  assert.equal(JSON.parse(n.data).followUpId, f.id);
  const email = h.db.get<{ subject: string; body: string }>("SELECT subject, body FROM outbox_messages WHERE notification_id = ? AND channel = 'email'", [n.id]);
  assert.ok(email, 'the email is logged');
  assert.doesNotMatch(email!.body, /Talk through/, 'the next step itself never leaves in an email');
  assert.match(email!.body, /Open the Bioptime app/);

  // an unassigned coach reaches nothing of this client
  for (const r of [await asha.post(`/api/coach/reports/${report.id}/follow-ups`, { kind: 'note', note: 'Not my client' }), await asha.get(`/api/coach/clients/${vikramId}/lab-follow-ups`), await asha.patch(`/api/coach/lab-follow-ups/${f.id}`, { status: 'done' })]) {
    assert.equal(r.status, 403, JSON.stringify(r.json));
    assert.equal(code(r), 'NO_ACCESS');
  }
  // another member's report named on this client's list is not found
  assert.equal((await rahul.get(`/api/coach/clients/${vikramId}/lab-follow-ups?reportId=${releasedReportOf(DEMO.member)!.id}`)).status, 404);

  const client = await rahul.get(`/api/coach/clients/${vikramId}/lab-follow-ups?reportId=${report.id}`);
  assert.equal(client.json.canAdd, true);
  assert.ok((client.json.items as Array<{ id: string }>).some((i) => i.id === f.id));
  const options = client.json.options as { appointments: Array<{ id: string }>; bookings: Array<{ id: string }>; plans: Array<{ id: string }> };
  assert.ok(options.appointments.length >= 1 && options.plans.length >= 1, JSON.stringify(options));
  assert.ok(!options.bookings.some((b) => b.id === report.booking_id), 'the report’s own booking is not offered as its retest');
  assert.deepEqual(findRestrictedFields(client.json, restrictedKeys()), []);
  assert.ok(h.db.get("SELECT 1 FROM audit_events WHERE action = 'health.viewed' AND target_id = ? AND data LIKE '%lab-follow-ups%'", [vikramId]), 'the coach’s read is audited');
  const mine = await rahul.get('/api/coach/lab-follow-ups');
  assert.ok((mine.json.items as Array<{ id: string }>).some((i) => i.id === f.id));
  assert.ok(!(mine.json.items as Array<{ memberId: string }>).some((i) => i.memberId === userId(h.ctx, DEMO.member)), 'only the coach’s own clients');

  // a consultation links to the client's appointment
  const apt = options.appointments[0]!.id;
  const linked = await rahul.patch(`/api/coach/lab-follow-ups/${f.id}`, { appointmentId: apt });
  assert.equal(linked.status, 200, JSON.stringify(linked.json));
  assert.equal((linked.json as { appointment: { id: string } }).appointment.id, apt);
  assert.deepEqual(JSON.parse(auditRows('lab_followup.update', f.id)[0]!.data).fields, ['appointmentId']);
  const seen = await (await signedIn(DEMO.member2, DEMO_PASSWORDS.member)).get('/api/me/lab-follow-ups');
  assert.ok((seen.json.items as Array<{ id: string }>).some((i) => i.id === f.id), 'the member sees it once the report is released');
});

test('validation answers field by field; links must be the member’s own and fit the kind', async () => {
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const report = releasedReportOf(DEMO.member)!;
  const vikramPlan = h.db.get<{ id: string }>('SELECT id FROM coaching_plans WHERE member_id = ?', [userId(h.ctx, DEMO.member2)])!.id;
  const vikramApt = h.db.get<{ id: string }>("SELECT id FROM appointments WHERE member_id = ? AND status != 'cancelled'", [userId(h.ctx, DEMO.member2)])!.id;
  const before = h.db.get<{ n: number }>('SELECT COUNT(*) n FROM lab_followups')!.n;
  const bad = async (body: unknown, path: string) => {
    const r = await asha.post(`/api/coach/reports/${report.id}/follow-ups`, body);
    assert.equal(r.status, 400, `${JSON.stringify(body)} → ${JSON.stringify(r.json)}`);
    assert.equal(r.json.error?.code, 'VALIDATION_FAILED');
    const details = r.json.error?.details as Array<{ path: string }>;
    assert.ok(details.some((d) => d.path.startsWith(path)), `${path} named in ${JSON.stringify(details)}`);
  };
  await bad({ note: 'Missing the kind' }, 'kind');
  await bad({ kind: 'diagnosis', note: 'Not a kind' }, 'kind');
  await bad({ kind: 'note', note: 'ok' }, 'note');
  await bad({ kind: 'note', note: 'x'.repeat(2001) }, 'note');
  await bad({ kind: 'retest', note: 'Retest', dueDate: '2026-02-30' }, 'dueDate');
  await bad({ kind: 'retest', note: 'Retest', dueDate: 'next month' }, 'dueDate');
  await bad({ kind: 'retest', note: 'Retest', dueDate: dateAhead(-1) }, 'dueDate');
  await bad({ kind: 'retest', note: 'Retest', dueDate: dateAhead(800) }, 'dueDate');
  await bad({ kind: 'note', note: 'Unknown field', priority: 'high' }, '');
  await bad({ kind: 'note', note: 'A note with an appointment', appointmentId: vikramApt }, 'appointmentId');
  await bad({ kind: 'consultation', note: 'Someone else’s appointment', appointmentId: vikramApt }, 'appointmentId');
  await bad({ kind: 'retest', note: 'The report’s own booking', bookingId: report.booking_id }, 'bookingId');
  await bad({ kind: 'plan_change', note: 'Someone else’s plan', planId: vikramPlan }, 'planId');
  await bad({ kind: 'note', note: 'A plan on a note', planId: vikramPlan }, 'planId');
  assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM lab_followups')!.n, before, 'nothing was written');
  const empty = await asha.patch(`/api/coach/lab-follow-ups/${h.db.get<{ id: string }>("SELECT id FROM lab_followups WHERE kind = 'retest' AND member_id = ?", [userId(h.ctx, DEMO.member)])!.id}`, { reason: 'nothing else' });
  assert.equal(empty.status, 400);
  assert.equal(empty.json.error?.code, 'VALIDATION_FAILED');
  const ok = await asha.post(`/api/coach/reports/${report.id}/follow-ups`, { kind: 'retest', note: 'Retest when your doctor agrees', dueDate: dateAhead(0) });
  assert.equal(ok.status, 201, 'today is a valid due date');
});

test('complete, cancel, reopen and edit: the transitions, the reasons and the audit trail', async () => {
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const report = releasedReportOf(DEMO.member)!;
  const f = (await asha.post(`/api/coach/reports/${report.id}/follow-ups`, { kind: 'note', note: 'Read the review note together' })).json as { id: string };
  const done = await asha.patch(`/api/coach/lab-follow-ups/${f.id}`, { status: 'done' });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal((done.json as { status: string; completedAt: string }).status, 'done');
  assert.ok((done.json as { completedAt: string }).completedAt);
  assert.equal(auditRows('lab_followup.complete', f.id).length, 1);
  const edit = await asha.patch(`/api/coach/lab-follow-ups/${f.id}`, { note: 'Changed after it was done' });
  assert.equal(code(edit), 'NOT_OPEN');
  const cancelDone = await asha.patch(`/api/coach/lab-follow-ups/${f.id}`, { status: 'cancelled', reason: 'test' });
  assert.equal(code(cancelDone), 'INVALID_TRANSITION');
  const reopenNoReason = await asha.patch(`/api/coach/lab-follow-ups/${f.id}`, { status: 'open' });
  assert.equal(code(reopenNoReason), 'REASON_REQUIRED');
  const reopened = await asha.patch(`/api/coach/lab-follow-ups/${f.id}`, { status: 'open', reason: 'Marked done by mistake' });
  assert.equal((reopened.json as { status: string; completedAt: string | null }).status, 'open');
  assert.equal((reopened.json as { completedAt: string | null }).completedAt, null);
  const cancelNoReason = await asha.patch(`/api/coach/lab-follow-ups/${f.id}`, { status: 'cancelled' });
  assert.equal(code(cancelNoReason), 'REASON_REQUIRED');
  const cancelled = await asha.patch(`/api/coach/lab-follow-ups/${f.id}`, { status: 'cancelled', reason: 'Covered in the consultation instead' });
  assert.equal((cancelled.json as { status: string; cancelledReason: string }).cancelledReason, 'Covered in the consultation instead');
  const updates = auditRows('lab_followup.update', f.id);
  assert.deepEqual(updates.map((u) => [u.reason, JSON.parse(u.data).status.to]), [['Marked done by mistake', 'open'], ['Covered in the consultation instead', 'cancelled']], 'each change is audited with its reason');
  assert.ok(updates.every((u) => u.actor_id === userId(h.ctx, DEMO.coach)));
  const same = await asha.patch(`/api/coach/lab-follow-ups/${f.id}`, { status: 'cancelled', reason: 'again' });
  assert.equal(same.status, 200);
  assert.equal(auditRows('lab_followup.update', f.id).length, 2, 'a request that changes nothing writes no audit row');
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  assert.ok(!((await member.get('/api/me/lab-follow-ups')).json.items as Array<{ id: string }>).some((i) => i.id === f.id), 'a cancelled next step is withdrawn from the member’s list');
  assert.equal((await asha.patch('/api/coach/lab-follow-ups/lfu_nonexistent', { status: 'done' })).status, 404);
});

test('coach sharing: without it the coach reads and writes nothing; the team writes on its own release, with a reason', async () => {
  const deepa = as(DEMO.memberNoShare);
  const deepaId = deepa.actor!.id;
  const lipid = h.db.get<{ id: string }>("SELECT id FROM bloodwork_tests WHERE vendor_test_id = 'LS-LIPID'")!.id;
  const b = await bloodwork.book(deepa, h.services.vendor, { memberId: deepaId, testId: lipid, slotAt: zonedToIso(weekdayAhead(3), 7 * 60 + 30), pincode: '600028', address: '3 Demo Street', city: 'Chennai', state: 'Tamil Nadu' });
  await processPending(h.ctx);
  for (let i = 0; i < 5; i++) await h.services.standin!.step(b.vendorOrderId!);
  await processPending(h.ctx);
  const report = h.db.get<{ id: string }>('SELECT id FROM report_metadata WHERE booking_id = ?', [b.id])!;
  assert.ok(report, 'the stand-in delivered a report');

  const meera = await signedIn(DEMO.coach3, DEMO_PASSWORDS.coach);
  const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin, true);
  assert.equal((await admin.post(`/api/admin/reports/${report.id}/release`, { note: 'Released by the team for the test: values as the laboratory reported them.', reason: 'Member keeps coach sharing off' })).status, 200);
  for (const r of [await meera.get(`/api/coach/clients/${deepaId}/lab-follow-ups`), await meera.post(`/api/coach/reports/${report.id}/follow-ups`, { kind: 'note', note: 'Without consent' })]) {
    assert.equal(r.status, 403);
    assert.equal(code(r), 'NOT_SHARED');
  }

  const noReason = await admin.post(`/api/admin/reports/${report.id}/follow-ups`, { kind: 'retest', note: 'Agree a retest with your doctor' });
  assert.equal(noReason.status, 400);
  assert.ok((noReason.json.error?.details as Array<{ path: string }>).some((d) => d.path === 'reason'));
  const team = await admin.post(`/api/admin/reports/${report.id}/follow-ups`, { kind: 'retest', note: 'Agree a retest with your doctor', reason: 'Team release; the member has no coach review' });
  assert.equal(team.status, 201, JSON.stringify(team.json));
  const tf = team.json as { id: string; setBy: { role: string } };
  assert.equal(tf.setBy.role, 'team');
  assert.equal(h.db.get<{ coach_id: string | null; created_by_role: string }>('SELECT coach_id, created_by_role FROM lab_followups WHERE id = ?', [tf.id])!.created_by_role, 'admin');
  assert.equal(auditRows('lab_followup.create', tf.id)[0]!.reason, 'Team release; the member has no coach review');
  const coachReviewed = await admin.post(`/api/admin/reports/${releasedReportOf(DEMO.member)!.id}/follow-ups`, { kind: 'note', note: 'Not the team’s to set', reason: 'test' });
  assert.equal(coachReviewed.status, 409);
  assert.equal(code(coachReviewed), 'COACH_RELEASED');

  // the member shares with the coach: the coach reads the team's next step, cannot change it, and may add their own
  const deepaClient = await signedIn(DEMO.memberNoShare, DEMO_PASSWORDS.member);
  assert.equal((await deepaClient.post('/api/me/consents', { kind: 'coach_sharing', version: '2026-10-17', granted: true })).status, 200);
  const shared = await meera.get(`/api/coach/clients/${deepaId}/lab-follow-ups`);
  assert.equal(shared.status, 200, JSON.stringify(shared.json));
  assert.ok((shared.json.items as Array<{ id: string }>).some((i) => i.id === tf.id));
  const teamEdit = await meera.patch(`/api/coach/lab-follow-ups/${tf.id}`, { status: 'done' });
  assert.equal(code(teamEdit), 'TEAM_FOLLOW_UP');
  const own = await meera.post(`/api/coach/reports/${report.id}/follow-ups`, { kind: 'consultation', note: 'Book a consultation to go through it' });
  assert.equal(own.status, 201, JSON.stringify(own.json));
  assert.ok(((await meera.get('/api/coach/lab-follow-ups')).json.items as Array<{ memberId: string }>).some((i) => i.memberId === deepaId));
  // and withdraws it again: nothing of hers reaches the coach
  assert.equal((await deepaClient.post('/api/me/consents', { kind: 'coach_sharing', version: '2026-10-17', granted: false })).status, 200);
  assert.ok(!((await meera.get('/api/coach/lab-follow-ups')).json.items as Array<{ memberId: string }>).some((i) => i.memberId === deepaId));
  assert.equal(code(await meera.patch(`/api/coach/lab-follow-ups/${(own.json as { id: string }).id}`, { status: 'done' })), 'NOT_SHARED');

  // the team changes a next step only with a reason
  const noWhy = await admin.patch(`/api/admin/lab-follow-ups/${tf.id}`, { status: 'done' });
  assert.equal(noWhy.status, 400);
  const doneByTeam = await admin.patch(`/api/admin/lab-follow-ups/${tf.id}`, { status: 'done', reason: 'Member confirmed the retest with their doctor' });
  assert.equal(doneByTeam.status, 200, JSON.stringify(doneByTeam.json));
  const completed = auditRows('lab_followup.complete', tf.id);
  assert.equal(completed.length, 1);
  assert.equal(completed[0]!.reason, 'Member confirmed the retest with their doctor');
  assert.equal(completed[0]!.actor_role, 'admin');
  const mine = await deepaClient.get('/api/me/lab-follow-ups');
  assert.ok((mine.json.items as Array<{ id: string; setBy: { role: string } }>).some((i) => i.id === tf.id && i.setBy.role === 'team'), 'the member sees the team’s next step');
});

test('administrators: reports.view to read, integrations.manage to write; coaches never reach the team routes', async () => {
  const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin, true);
  const adminId = userId(h.ctx, DEMO.admin);
  const ananyaId = userId(h.ctx, DEMO.member);
  const all = await admin.get('/api/admin/lab-follow-ups');
  assert.equal(all.status, 200, JSON.stringify(all.json));
  const summary = all.json.summary as { open: number; done: number; cancelled: number; overdue: number };
  assert.ok(summary.open >= 1 && summary.done >= 1 && summary.cancelled >= 1, JSON.stringify(summary));
  const forMember = await admin.get(`/api/admin/lab-follow-ups?memberId=${ananyaId}`);
  assert.ok((forMember.json.items as Array<{ memberId: string }>).every((i) => i.memberId === ananyaId));
  assert.ok(forMember.json.options, 'link options for a member');
  assert.ok(h.db.get("SELECT 1 FROM audit_events WHERE action = 'member.record_viewed' AND target_id = ? AND data LIKE '%lab-follow-ups%'", [ananyaId]), 'reading a member’s next steps is audited');
  const report = releasedReportOf(DEMO.member)!;
  const forReport = await admin.get(`/api/admin/lab-follow-ups?reportId=${report.id}`);
  assert.equal(forReport.json.canAdd, false, 'a coach-reviewed report takes no team next steps');
  assert.equal((await admin.get('/api/admin/lab-follow-ups?status=maybe')).status, 400);
  // overdue: a due date that has passed (set straight in the database, as time passing would)
  const open = h.db.get<{ id: string }>("SELECT id FROM lab_followups WHERE status = 'open' AND member_id = ? LIMIT 1", [ananyaId])!;
  h.db.run('UPDATE lab_followups SET due_date = ? WHERE id = ?', [dateAhead(-3), open.id]);
  const overdue = await admin.get('/api/admin/lab-follow-ups?overdue=1');
  assert.deepEqual((overdue.json.items as Array<{ id: string; overdue: boolean }>).map((i) => [i.id, i.overdue]), [[open.id, true]]);
  assert.equal((overdue.json.summary as { overdue: number }).overdue, 1);
  h.db.run('UPDATE lab_followups SET due_date = NULL WHERE id = ?', [open.id]);

  setUserPermission(as(DEMO.owner), adminId, 'reports.view', false, 'test: no reports');
  try {
    const refused = await admin.get('/api/admin/lab-follow-ups');
    assert.equal(refused.status, 403);
    assert.equal(refused.json.error?.code, 'PERMISSION_DENIED');
  } finally { setUserPermission(as(DEMO.owner), adminId, 'reports.view', true, 'test: restore'); }
  const someone = h.db.get<{ id: string }>("SELECT id FROM lab_followups WHERE created_by_role = 'admin' LIMIT 1")!;
  setUserPermission(as(DEMO.owner), adminId, 'integrations.manage', false, 'test: no integrations');
  try {
    for (const r of [await admin.post(`/api/admin/reports/${report.id}/follow-ups`, { kind: 'note', note: 'Without the permission', reason: 'test' }), await admin.patch(`/api/admin/lab-follow-ups/${someone.id}`, { status: 'open', reason: 'test' })]) {
      assert.equal(r.status, 403);
      assert.equal(r.json.error?.code, 'PERMISSION_DENIED');
    }
  } finally { setUserPermission(as(DEMO.owner), adminId, 'integrations.manage', true, 'test: restore'); }
  const coach = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  for (const r of [await coach.get('/api/admin/lab-follow-ups'), await coach.post(`/api/admin/reports/${report.id}/follow-ups`, { kind: 'note', note: 'A coach on the team route', reason: 'test' }), await coach.get('/api/me/lab-follow-ups')]) assert.equal(r.status, 403);
});

test('the team never rewrites a coach’s next step: it may complete, cancel, reopen or relink it, with a reason, but not change its words or due date', async () => {
  const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin, true);
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const ananyaId = userId(h.ctx, DEMO.member);
  type Row = { id: string; note: string; due_date: string | null; status: string; appointment_id: string | null; created_by: string };
  const read = (id: string) => h.db.get<Row>('SELECT id, note, due_date, status, appointment_id, created_by FROM lab_followups WHERE id = ?', [id])!;
  const step = h.db.get<Row>("SELECT id, note, due_date, status, appointment_id, created_by FROM lab_followups WHERE member_id = ? AND created_by_role = 'coach' AND kind = 'consultation' AND status = 'open' AND appointment_id IS NOT NULL ORDER BY created_at LIMIT 1", [ananyaId])!;
  assert.ok(step, 'the seeded consultation, written by the coach');
  assert.equal(step.created_by, userId(h.ctx, DEMO.coach));
  const audits = () => h.db.get<{ n: number }>('SELECT COUNT(*) n FROM audit_events WHERE target_id = ?', [step.id])!.n;
  const auditsBefore = audits();
  const path = `/api/admin/lab-follow-ups/${step.id}`;
  for (const body of [
    { note: 'The team’s own words instead', reason: 'probe: rewrite the coach’s words' },
    { dueDate: dateAhead(10), reason: 'probe: set a date the coach did not set' },
    { note: 'Done, in the team’s words', status: 'done', reason: 'probe: rewrite while completing' },
  ]) {
    const r = await admin.patch(path, body);
    assert.equal(r.status, 403, `${JSON.stringify(body)} → ${JSON.stringify(r.json)}`);
    assert.equal(r.json.error?.code, 'COACH_FOLLOW_UP');
    assert.match(String(r.json.error?.message), /not its words or due date/, 'the error says what the team may and may not do');
  }
  assert.deepEqual(read(step.id), step, 'nothing was written');
  assert.equal(audits(), auditsBefore, 'and nothing was audited');
  const seen = ((await member.get('/api/me/lab-follow-ups')).json.items as Array<{ id: string; note: string; setBy: { role: string } }>).find((i) => i.id === step.id)!;
  assert.deepEqual([seen.note, seen.setBy.role], [step.note, 'coach'], 'the member still reads the coach’s own words');

  // status and links stay the team's to change, each with a reason (sending the coach's words back unchanged is fine)
  const done = await admin.patch(path, { status: 'done', note: step.note, reason: 'The member confirmed the consultation took place' });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal((done.json as { status: string }).status, 'done');
  assert.equal(auditRows('lab_followup.complete', step.id).at(-1)!.actor_role, 'admin');
  assert.equal((await admin.patch(path, { status: 'open', reason: 'Marked done too early' })).status, 200);
  const unlinked = await admin.patch(path, { appointmentId: null, reason: 'The appointment is being rebooked' });
  assert.equal(unlinked.status, 200, JSON.stringify(unlinked.json));
  assert.equal((unlinked.json as { appointment: unknown }).appointment, null);
  assert.deepEqual(JSON.parse(auditRows('lab_followup.update', step.id).at(-1)!.data).fields, ['appointmentId']);
  assert.equal((await admin.patch(path, { appointmentId: step.appointment_id, reason: 'Rebooked: link it again' })).status, 200);
  assert.deepEqual(read(step.id), step, 'back where it was, words untouched');

  // the coach still changes their own words; the team changes the words of its own next steps
  const reworded = await asha.patch(`/api/coach/lab-follow-ups/${step.id}`, { note: `${step.note} Bring your questions.` });
  assert.equal(reworded.status, 200, JSON.stringify(reworded.json));
  assert.equal(read(step.id).note, `${step.note} Bring your questions.`);
  const teamStep = h.db.get<{ id: string }>("SELECT id FROM lab_followups WHERE created_by_role IN ('admin','owner') AND status = 'done' LIMIT 1")!;
  const teamEdit = await admin.patch(`/api/admin/lab-follow-ups/${teamStep.id}`, { status: 'open', note: 'Agree a retest with your doctor, then book it in the app', reason: 'Reopened to add how to book it' });
  assert.equal(teamEdit.status, 200, JSON.stringify(teamEdit.json));
  assert.deepEqual(JSON.parse(auditRows('lab_followup.update', teamStep.id).at(-1)!.data).fields, ['note']);
});

test('a reassigned coach never rewrites the previous coach’s next step: status and link yes, words and due date no', async () => {
  const ananyaId = userId(h.ctx, DEMO.member);
  const ashaId = userId(h.ctx, DEMO.coach);
  const rahulId = userId(h.ctx, DEMO.coach2);
  type Row = { id: string; note: string; due_date: string | null; status: string; appointment_id: string | null; created_by: string };
  const read = (id: string) => h.db.get<Row>('SELECT id, note, due_date, status, appointment_id, created_by FROM lab_followups WHERE id = ?', [id])!;
  const step = h.db.get<Row>("SELECT id, note, due_date, status, appointment_id, created_by FROM lab_followups WHERE member_id = ? AND created_by = ? AND kind = 'consultation' AND status = 'open' AND appointment_id IS NOT NULL ORDER BY created_at LIMIT 1", [ananyaId, ashaId])!;
  assert.ok(step, 'Asha’s consultation step for Ananya');
  // Ananya moves from Asha to Rahul (set straight in the database and restored afterwards, so later tests see the seed)
  const saved = h.db.all<{ id: string; status: string; ended_at: string | null }>("SELECT id, status, ended_at FROM coach_assignments WHERE member_id = ? AND status IN ('active','paused','pending')", [ananyaId]);
  assert.ok(saved.length >= 1, 'Ananya has a current coach assignment');
  const now = new Date().toISOString();
  h.db.run("UPDATE coach_assignments SET status = 'ended', ended_at = ? WHERE member_id = ? AND status IN ('active','paused','pending')", [now, ananyaId]);
  h.db.insert('coach_assignments', { id: 'asg_probe_reassigned', member_id: ananyaId, coach_id: rahulId, programme_id: null, request_id: null, status: 'active', method: 'override', reason: 'test: reassigned to Rahul', effective_at: now, created_by: 'system', created_at: now });
  let ownId = '';
  try {
    const rahul = await signedIn(DEMO.coach2, DEMO_PASSWORDS.coach);
    const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
    const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
    const audits = () => h.db.get<{ n: number }>('SELECT COUNT(*) n FROM audit_events WHERE target_id = ?', [step.id])!.n;
    const auditsBefore = audits();
    const path = `/api/coach/lab-follow-ups/${step.id}`;
    const seenItems = await rahul.get(`/api/coach/clients/${ananyaId}/lab-follow-ups`);
    assert.equal(seenItems.status, 200, JSON.stringify(seenItems.json));
    assert.ok((seenItems.json.items as Array<{ id: string; setBy: { role: string; name: string | null } }>).some((i) => i.id === step.id && i.setBy.role === 'coach' && i.setBy.name === 'Asha Menon'), 'the new coach reads the step as Asha’s');
    for (const body of [
      { note: 'Rahul rewrote this step' },
      { dueDate: dateAhead(10) },
      { note: 'Done, in Rahul’s words', status: 'done' },
    ]) {
      const r = await rahul.patch(path, body);
      assert.equal(r.status, 403, `${JSON.stringify(body)} → ${JSON.stringify(r.json)}`);
      assert.equal(r.json.error?.code, 'OTHER_COACH_FOLLOW_UP');
      assert.match(String(r.json.error?.message), /Another coach wrote this next step/, 'the error says why');
      assert.match(String(r.json.error?.message), /not its words or due date/, 'and what the coach may still do');
    }
    assert.deepEqual(read(step.id), step, 'nothing was written');
    assert.equal(audits(), auditsBefore, 'and nothing was audited');
    const mine = ((await member.get('/api/me/lab-follow-ups')).json.items as Array<{ id: string; note: string; dueDate: string | null; setBy: { role: string; name: string | null } }>).find((i) => i.id === step.id)!;
    assert.deepEqual([mine.note, mine.dueDate, mine.setBy], [step.note, step.due_date, { role: 'coach', name: 'Asha Menon' }], 'the member still reads Asha’s own words under her name');
    // Asha, no longer assigned, reaches nothing of Ananya's
    const former = await asha.patch(path, { note: `${step.note} (edited after the reassignment)` });
    assert.equal(former.status, 403);
    assert.equal(code(former), 'NO_ACCESS');

    // status and links stay the assigned coach's to change (sending Asha's words back unchanged is fine)
    const done = await rahul.patch(path, { status: 'done', note: step.note });
    assert.equal(done.status, 200, JSON.stringify(done.json));
    assert.equal((done.json as { status: string }).status, 'done');
    assert.equal(auditRows('lab_followup.complete', step.id).at(-1)!.actor_id, rahulId, 'audited as Rahul');
    assert.equal((await rahul.patch(path, { status: 'open', reason: 'Not done yet: the consultation is still to come' })).status, 200);
    const unlinked = await rahul.patch(path, { appointmentId: null });
    assert.equal(unlinked.status, 200, JSON.stringify(unlinked.json));
    assert.deepEqual(JSON.parse(auditRows('lab_followup.update', step.id).at(-1)!.data).fields, ['appointmentId']);
    assert.equal((await rahul.patch(path, { appointmentId: step.appointment_id })).status, 200);
    assert.deepEqual(read(step.id), step, 'back where it was, Asha’s words and date untouched');

    // Rahul writes and rewords a next step of his own on the released report
    const own = await rahul.post(`/api/coach/reports/${releasedReportOf(DEMO.member)!.id}/follow-ups`, { kind: 'note', note: 'Bring the questions you noted to our first call' });
    assert.equal(own.status, 201, JSON.stringify(own.json));
    ownId = (own.json as { id: string }).id;
    const reworded = await rahul.patch(`/api/coach/lab-follow-ups/${ownId}`, { note: 'Bring the questions you noted to our first call, in Messages or in person', dueDate: dateAhead(7) });
    assert.equal(reworded.status, 200, JSON.stringify(reworded.json));
    assert.deepEqual(JSON.parse(auditRows('lab_followup.update', ownId).at(-1)!.data).fields, ['note', 'dueDate']);
  } finally {
    if (ownId) h.db.run('DELETE FROM lab_followups WHERE id = ?', [ownId]);
    h.db.run("DELETE FROM coach_assignments WHERE id = 'asg_probe_reassigned'");
    for (const a of saved) h.db.run('UPDATE coach_assignments SET status = ?, ended_at = ? WHERE id = ?', [a.status, a.ended_at, a.id]);
  }
  assert.ok(h.db.get("SELECT 1 FROM coach_assignments WHERE member_id = ? AND coach_id = ? AND status = 'active'", [ananyaId, ashaId]), 'Asha is Ananya’s coach again');
});

test('overdue is filtered inside the query, in each member’s own timezone, so the limit counts overdue next steps only', async () => {
  const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin, true);
  const ananyaId = userId(h.ctx, DEMO.member);
  const vikramId = userId(h.ctx, DEMO.member2);
  const tzOf = (id: string) => h.db.get<{ timezone: string }>('SELECT timezone FROM member_profiles WHERE user_id = ?', [id])!.timezone;
  const saved: Array<[string, string]> = [[ananyaId, tzOf(ananyaId)], [vikramId, tzOf(vikramId)]];
  // Honolulu (UTC−10) and Kiritimati (UTC+14) keep no daylight saving and are always one calendar day apart: a step due
  // on Honolulu's today is not overdue for a member in Honolulu, and a day overdue for a member in Kiritimati
  const honoluluToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Honolulu' }).format(new Date());
  const probe = (id: string, reportId: string, memberId: string, createdAt: string) => ({ id, report_id: reportId, member_id: memberId, coach_id: null, kind: 'note', note: 'Overdue probe', due_date: honoluluToday, status: 'open', created_by: userId(h.ctx, DEMO.admin), created_by_role: 'admin', created_at: createdAt, updated_at: createdAt });
  h.db.run('UPDATE member_profiles SET timezone = ? WHERE user_id = ?', ['Pacific/Honolulu', ananyaId]);
  h.db.run('UPDATE member_profiles SET timezone = ? WHERE user_id = ?', ['Pacific/Kiritimati', vikramId]);
  // same due date: the Honolulu step sorts first (newer), so a limit applied before the overdue test would drop the other
  h.db.insert('lab_followups', probe('lfu_probe_honolulu', releasedReportOf(DEMO.member)!.id, ananyaId, '2999-01-02T00:00:00.000Z'));
  h.db.insert('lab_followups', probe('lfu_probe_kiritimati', releasedReportOf(DEMO.member2)!.id, vikramId, '2999-01-01T00:00:00.000Z'));
  try {
    assert.deepEqual(lab.listForTeam(h.ctx, { overdue: true, limit: 1 }).items.map((i) => [i.id, i.overdue]), [['lfu_probe_kiritimati', true]]);
    const all = lab.listForTeam(h.ctx, { overdue: true });
    assert.ok(all.items.length >= 1 && all.items.every((i) => i.overdue && i.status === 'open'), JSON.stringify(all.items.map((i) => i.id)));
    assert.ok(!all.items.some((i) => i.id === 'lfu_probe_honolulu'), 'due today where that member lives is not overdue');
    assert.equal(all.items.length, all.summary.overdue, 'the list and the overview count agree');
    const r = await admin.get('/api/admin/lab-follow-ups?overdue=1&limit=1');
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual((r.json.items as Array<{ id: string }>).map((i) => i.id), ['lfu_probe_kiritimati']);
    const withKind = lab.listForTeam(h.ctx, { overdue: true, kind: 'retest' });
    assert.ok(!withKind.items.some((i) => i.id === 'lfu_probe_kiritimati'), 'the other filters still apply');
  } finally {
    h.db.run("DELETE FROM lab_followups WHERE id IN ('lfu_probe_honolulu', 'lfu_probe_kiritimati')");
    for (const [id, tz] of saved) h.db.run('UPDATE member_profiles SET timezone = ? WHERE user_id = ?', [tz, id]);
  }
  assert.deepEqual(lab.listForTeam(h.ctx, { overdue: true }).items, [], 'nothing else is overdue');
});

test('preparation reminders: one per booking from the laboratory’s own text; moved on reschedule, cancelled on cancel, never twice', async () => {
  // the demo bookings were made before the seed switched the module on: the first run of the job catches them up
  const first = await job().run(h.ctx) as { queued: number };
  assert.ok(first.queued >= 1, JSON.stringify(first));
  assert.deepEqual(await job().run(h.ctx), { queued: 0, moved: 0, cancelled: 0 });
  const vikram = await signedIn(DEMO.member2, DEMO_PASSWORDS.member);
  const vikramId = userId(h.ctx, DEMO.member2);
  const lipid = ((await vikram.get('/api/me/bloodwork/tests')).json.items as Array<{ id: string; name: string; fastingHours: number; preparation: string }>).find((t) => t.name.startsWith('Lipid'))!;
  assert.equal(lipid.fastingHours, 12);
  const date1 = weekdayAhead(4);
  const slot1 = ((await vikram.get(`/api/me/bloodwork/slots?date=${date1}&pincode=560034`)).json.slots as Array<{ startAt: string; labId: string }>)[2]!;
  const booked = await vikram.post('/api/me/bloodwork/bookings', { testId: lipid.id, slotAt: slot1.startAt, labId: slot1.labId, pincode: '560034', address: '12 Demo Street', city: 'Bengaluru', state: 'Karnataka' });
  assert.equal(booked.status, 201, JSON.stringify(booked.json));
  const b = booked.json as { id: string; reference: string; createdAt: string };
  let rows = queuedPrep(b.id);
  assert.equal(rows.length, 1, 'one preparation reminder for the booking');
  const r1 = rows[0]!;
  assert.equal(r1.user_id, vikramId);
  assert.equal(r1.category, 'lab_preparation');
  assert.equal(r1.due_at, addHours(slot1.startAt, -14), 'two hours before the twelve-hour fast begins');
  assert.match(r1.body, /^Lipid Profile: home collection /);
  assert.match(r1.body, /The laboratory’s preparation: Fast for 12 hours\.$/, 'the laboratory’s own words, nothing added');
  assert.deepEqual(JSON.parse(r1.channels), ['in_app', 'push']);
  await processPending(h.ctx);
  assert.equal(queuedPrep(b.id).length, 1, 'processing again queues nothing more');
  const prep = await vikram.get('/api/me/lab-preparation');
  const item = (prep.json.items as Array<{ bookingId: string; reminder: { dueAt: string; status: string } | null; preparation: string; fastingHours: number }>).find((i) => i.bookingId === b.id)!;
  assert.deepEqual(item.reminder, { dueAt: r1.due_at, status: 'queued' });
  assert.equal(item.preparation, 'Fast for 12 hours.');

  // a retest next step on the released report can point at this booking: retest tracking
  const rahul = await signedIn(DEMO.coach2, DEMO_PASSWORDS.coach);
  const report = releasedReportOf(DEMO.member2)!;
  const retest = await rahul.post(`/api/coach/reports/${report.id}/follow-ups`, { kind: 'retest', note: 'The lipid retest you booked', bookingId: b.id });
  assert.equal(retest.status, 201, JSON.stringify(retest.json));
  assert.deepEqual((({ id, reference, status }) => ({ id, reference, status }))((retest.json as { booking: { id: string; reference: string; status: string } }).booking), { id: b.id, reference: b.reference, status: 'confirmed' });
  assert.deepEqual(findRestrictedFields(retest.json, restrictedKeys()), [], 'the linked booking carries no address');

  // a reschedule sends BookingUpdated { rescheduled: true }: the reminder moves as soon as the event is processed, and
  // the preparation_sync job (the safety net) then has nothing left to do
  const date2 = weekdayAhead(6);
  const slot2 = ((await vikram.get(`/api/me/bloodwork/slots?date=${date2}&pincode=560034`)).json.slots as Array<{ startAt: string; labId: string }>)[4]!;
  assert.equal((await vikram.patch(`/api/me/bloodwork/bookings/${b.id}`, { slotAt: slot2.startAt, labId: slot2.labId })).status, 200);
  await processPending(h.ctx);
  rows = prepRows(b.id);
  assert.deepEqual(rows.map((r) => [r.due_at, r.status]), [[r1.due_at, 'cancelled'], [addHours(slot2.startAt, -14), 'queued']], 'the reminder moved with the slot');
  assert.deepEqual(await job().run(h.ctx), { queued: 0, moved: 0, cancelled: 0 }, 'the job finds nothing left to move');

  // cancelling the booking cancels its reminder (BookingUpdated)
  assert.equal((await vikram.post(`/api/me/bloodwork/bookings/${b.id}/cancel`, { reason: 'test: cancel' })).status, 200);
  await processPending(h.ctx);
  assert.equal(queuedPrep(b.id).length, 0);
  assert.ok(prepRows(b.id).every((r) => r.status === 'cancelled'));

  // a second booking: the reminder is sent once at its time, and never queued again for that slot
  const slot3 = ((await vikram.get(`/api/me/bloodwork/slots?date=${date1}&pincode=560034`)).json.slots as Array<{ startAt: string; labId: string }>)[3]!;
  const b2 = (await vikram.post('/api/me/bloodwork/bookings', { testId: lipid.id, slotAt: slot3.startAt, labId: slot3.labId, pincode: '560034', address: '12 Demo Street', city: 'Bengaluru', state: 'Karnataka' })).json as { id: string };
  const due = queuedPrep(b2.id)[0]!.due_at;
  // once the slot has passed the reminder is withdrawn, and a later sync before the slot brings it back
  assert.equal(lab.syncPreparation(at(addMinutes(slot3.startAt, 1)), b2.id), 'cancelled');
  assert.equal(lab.syncPreparation(h.ctx, b2.id), 'queued');
  const sent = reminders.dispatchDue(at(due));
  assert.ok(sent.sent + sent.inAppOnly >= 1, JSON.stringify(sent));
  assert.equal(prepRows(b2.id).find((r) => r.due_at === due)!.status, 'sent');
  const n = h.db.get<{ title: string; body: string }>("SELECT title, body FROM notifications WHERE user_id = ? AND category = 'lab_preparation' ORDER BY created_at DESC LIMIT 1", [vikramId])!;
  assert.equal(n.title, 'Preparing for your blood test');
  assert.equal(lab.syncPreparation(h.ctx, b2.id), 'unchanged', 'a sent reminder is not queued again');
  await processPending(h.ctx);
  assert.equal(queuedPrep(b2.id).length, 0);
  assert.equal(prepRows(b2.id).filter((r) => r.status === 'sent').length, 1);
});

test('preparation timing and wording come only from the slot and the laboratory', () => {
  const slot = '2026-11-10T02:00:00.000Z'; // 07:30 in India
  assert.equal(lab.preparationDueAt(slot, '2026-11-01T00:00:00.000Z', 12), '2026-11-09T12:00:00.000Z', 'fasting: two hours before the fast begins');
  assert.equal(lab.preparationDueAt(slot, '2026-11-01T00:00:00.000Z', 0), '2026-11-09T14:00:00.000Z', 'no fasting: 12 hours before the slot');
  assert.equal(lab.preparationDueAt(slot, '2026-11-09T22:00:00.000Z', 12), '2026-11-09T22:00:00.000Z', 'a late booking is reminded at once');
  const none = lab.preparationText({ name: 'Vitamin D (25-OH)', fasting_hours: 0, preparation: '' }, slot, 'Asia/Kolkata');
  assert.match(none.body, /The laboratory lists no preparation for this test\.$/);
  const hours = lab.preparationText({ name: 'Probe', fasting_hours: 10, preparation: '' }, slot, 'Asia/Kolkata');
  assert.match(hours.body, /The laboratory asks for 10 hours of fasting before collection\.$/);
  assert.match(hours.body, /07:30 IST\. /);
});

test('the labFollowups flag: off, every route answers FEATURE_DISABLED and the job and handlers stand still; on again, the job catches up', async () => {
  const owner = await signedIn(DEMO.owner, DEMO_PASSWORDS.owner, true);
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const coach = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin, true);
  const priya = await signedIn('priya.nair@demo.bioptime.test', DEMO_PASSWORDS.member);
  const ananyaId = userId(h.ctx, DEMO.member);
  const report = releasedReportOf(DEMO.member)!;
  const anyId = h.db.get<{ id: string }>('SELECT id FROM lab_followups LIMIT 1')!.id;
  assert.equal((await owner.patch('/api/admin/modules', { key: 'labFollowups', enabled: false, reason: 'test: lab follow-ups off' })).status, 200);
  let bookingId = '';
  try {
    for (const r of [
      await member.get('/api/me/lab-follow-ups'), await member.get('/api/me/lab-preparation'),
      await coach.get('/api/coach/lab-follow-ups'), await coach.get(`/api/coach/clients/${ananyaId}/lab-follow-ups`), await coach.post(`/api/coach/reports/${report.id}/follow-ups`, { kind: 'note', note: 'While off' }), await coach.patch(`/api/coach/lab-follow-ups/${anyId}`, { status: 'done' }),
      await admin.get('/api/admin/lab-follow-ups'), await admin.post(`/api/admin/reports/${report.id}/follow-ups`, { kind: 'note', note: 'While off', reason: 'test' }), await admin.patch(`/api/admin/lab-follow-ups/${anyId}`, { status: 'done', reason: 'test' }),
    ]) {
      assert.equal(r.status, 403, JSON.stringify(r.json));
      assert.equal(r.json.error?.code, 'FEATURE_DISABLED');
    }
    assert.deepEqual(await job().run(h.ctx), { featureOff: 'labFollowups' });
    // a booking made while the module is off gets no reminder
    const tests = (await priya.get('/api/me/bloodwork/tests')).json.items as Array<{ id: string; name: string }>;
    const cbc = tests.find((t) => t.name.startsWith('Complete Blood Count'))!;
    const slot = ((await priya.get(`/api/me/bloodwork/slots?date=${weekdayAhead(5)}&pincode=682001`)).json.slots as Array<{ startAt: string; labId: string }>)[1]!;
    const booked = await priya.post('/api/me/bloodwork/bookings', { testId: cbc.id, slotAt: slot.startAt, labId: slot.labId, pincode: '682001', address: '20 Demo Street', city: 'Kochi', state: 'Kerala' });
    assert.equal(booked.status, 201, JSON.stringify(booked.json));
    bookingId = (booked.json as { id: string }).id;
    assert.equal(prepRows(bookingId).length, 0);
  } finally { await owner.patch('/api/admin/modules', { key: 'labFollowups', enabled: true, reason: 'test: lab follow-ups on' }); }
  assert.equal((await member.get('/api/me/lab-follow-ups')).status, 200);
  const caught = await job().run(h.ctx) as { queued: number };
  assert.ok(caught.queued >= 1, JSON.stringify(caught));
  const q = queuedPrep(bookingId);
  assert.equal(q.length, 1, 'the job queued the reminder the module missed while off');
  assert.match(q[0]!.body, /The laboratory lists no preparation for this test\.$/, 'a test without fasting or preparation text says so, and nothing more');
});

test('a BookingUpdated with { rescheduled: true } moves the preparation reminder as soon as it is processed; the job is only the safety net', async () => {
  // its own booking and reminder, so the test stands alone and in any order: BookingCreated queues the preparation
  // reminder once processed. It never runs the whole job (which would also catch up the seed's and other tests'
  // bookings and change what they see); the job's step for this booking, syncPreparation, stands in for it
  const deepa = as(DEMO.memberNoShare);
  const lipidId = h.db.get<{ id: string }>("SELECT id FROM bloodwork_tests WHERE vendor_test_id = 'LS-LIPID'")!.id;
  const made = await bloodwork.book(deepa, h.services.vendor, { memberId: deepa.actor!.id, testId: lipidId, slotAt: zonedToIso(weekdayAhead(9), 7 * 60 + 30), pincode: '600028', address: '3 Demo Street', city: 'Chennai', state: 'Tamil Nadu', overrideEntitlement: true });
  await processPending(h.ctx);
  const b = h.db.get<{ id: string; status: string; slot_at: string; created_at: string; fasting_hours: number | null }>(
    'SELECT b.id, b.status, b.slot_at, b.created_at, t.fasting_hours FROM bloodwork_bookings b LEFT JOIN bloodwork_tests t ON t.id = b.test_id WHERE b.id = ?',
    [made.id],
  )!;
  assert.ok(['confirmed', 'scheduled'].includes(b.status), JSON.stringify(b));
  assert.equal(queuedPrep(b.id).length, 1, 'an upcoming booking with its preparation reminder queued');
  const fasting = b.fasting_hours ?? 0;
  const before = queuedPrep(b.id);
  assert.deepEqual(before.map((r) => r.due_at), [lab.preparationDueAt(b.slot_at, b.created_at, fasting)]);
  // the slot moves as bloodwork.reschedule moves it, and the event says so (emitted here directly)
  const moved = addDays(b.slot_at, 3);
  const reschedule = (slotAt: string, from: string) => {
    h.db.run('UPDATE bloodwork_bookings SET slot_at = ? WHERE id = ?', [slotAt, b.id]);
    emit(h.ctx, 'BookingUpdated', { type: 'booking', id: b.id }, { from: b.status, to: b.status, rescheduled: true, slotFrom: from, slotTo: slotAt });
  };
  reschedule(moved, b.slot_at);
  assert.deepEqual(queuedPrep(b.id).map((r) => r.due_at), [before[0]!.due_at], 'nothing moves before the event is processed');
  await processPending(h.ctx);
  const after = queuedPrep(b.id);
  assert.deepEqual(after.map((r) => r.due_at), [lab.preparationDueAt(moved, b.created_at, fasting)], 'one reminder, at the new slot’s time, as soon as the event is processed');
  assert.notEqual(after[0]!.body, before[0]!.body, 'its wording names the new slot');
  assert.equal(prepRows(b.id).find((r) => r.id === before[0]!.id)!.status, 'cancelled', 'the old one is withdrawn');
  assert.ok(h.db.get("SELECT 1 FROM domain_events WHERE type = 'BookingUpdated' AND aggregate_id = ? AND processed_at IS NOT NULL AND last_error IS NULL", [b.id]), 'the handler ran without error');
  const syncedIds = () => h.db.all<{ id: string }>("SELECT id FROM bloodwork_bookings WHERE status IN ('confirmed','scheduled') AND slot_at > ?", [new Date().toISOString()]).map((r) => r.id);
  assert.ok(syncedIds().includes(b.id), 'the preparation_sync job visits this booking');
  assert.equal(lab.syncPreparation(h.ctx, b.id), 'unchanged', 'the preparation_sync job finds nothing left to move for it');
  assert.equal(queuedPrep(b.id).length, 1);

  // moved back: the reminder follows again, and still only one is queued
  reschedule(b.slot_at, moved);
  await processPending(h.ctx);
  assert.deepEqual(queuedPrep(b.id).map((r) => r.due_at), [before[0]!.due_at]);
  assert.equal(lab.syncPreparation(h.ctx, b.id), 'unchanged');

  // without the event, the job's step is the safety net: a slot moved silently is caught up by it
  h.db.run('UPDATE bloodwork_bookings SET slot_at = ? WHERE id = ?', [moved, b.id]);
  assert.equal(lab.syncPreparation(h.ctx, b.id), 'moved');
  assert.deepEqual(queuedPrep(b.id).map((r) => r.due_at), [lab.preparationDueAt(moved, b.created_at, fasting)]);
  // the test's booking is cancelled at the end, so it leaves no queued reminder behind for other tests
  h.db.run("UPDATE bloodwork_bookings SET status = 'cancelled' WHERE id = ?", [b.id]);
  assert.equal(lab.syncPreparation(h.ctx, b.id), 'cancelled');
  assert.equal(queuedPrep(b.id).length, 0);
});

test('data export: the member’s own next steps and preparation reminders, as their screens show them, and nothing withheld', async () => {
  const ananyaId = userId(h.ctx, DEMO.member);
  const vikramId = userId(h.ctx, DEMO.member2);
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const report = releasedReportOf(DEMO.member)!;
  // a next step linked to a plan the member cannot see yet (a draft)
  const now = new Date().toISOString();
  h.db.insert('coaching_plans', { id: 'plan_probe_draft', member_id: ananyaId, coach_id: userId(h.ctx, DEMO.coach), title: 'Draft plan probe', goals: '[]', status: 'draft', current_version: 1, created_at: now, updated_at: now });
  const linked = await asha.post(`/api/coach/reports/${report.id}/follow-ups`, { kind: 'plan_change', note: 'A plan change still being drafted', planId: 'plan_probe_draft' });
  assert.equal(linked.status, 201, JSON.stringify(linked.json));
  const linkedStep = linked.json as { id: string; plan: { title: string } | null };
  assert.equal(linkedStep.plan?.title, 'Draft plan probe', 'the coach sees the draft they linked');
  type Section = { label: string; records: Array<Record<string, unknown>> };
  const sectionOf = (archive: ReturnType<typeof buildArchive>) => (archive.moduleSections as Record<string, Record<string, Section>> | undefined)?.labFollowups;
  try {
    const screen = (await member.get('/api/me/lab-follow-ups')).json.items as Array<{ id: string; note: string; status: string; plan: unknown }>;
    assert.equal(screen.find((i) => i.id === linkedStep.id)!.plan, null, 'the member’s screen never shows a draft plan');

    const archive = buildArchive(h.ctx, ananyaId, 'drq_labfollowups_export');
    const section = sectionOf(archive);
    assert.ok(section?.nextSteps && section.preparationReminders, 'both sections are in moduleSections.labFollowups');
    assert.match(section.nextSteps.label, /Next steps/);
    const steps = section.nextSteps.records;
    assert.equal(steps.length, screen.length, 'exactly the next steps the member’s own screen lists');
    assert.deepEqual(steps.map((s) => s.nextStep).sort(), screen.map((s) => s.note).sort());
    assert.ok(steps.every((s) => s.status === 'open' || s.status === 'done'), 'no cancelled step');
    for (const s of steps) {
      for (const k of ['id', 'memberId', 'memberName', 'cancelledReason', 'cancelled_reason', 'coach_id', 'created_by', 'created_by_role']) assert.ok(!(k in s), `${k} is not exported`);
    }
    assert.equal(steps.find((s) => s.nextStep === 'A plan change still being drafted')!.plan, null, 'a draft plan stays out');
    const text = JSON.stringify(section);
    assert.doesNotMatch(text, /Draft plan probe/);
    assert.doesNotMatch(text, /Read the review note together|Covered in the consultation instead/, 'a withdrawn step and its cancellation reason stay out');
    assert.doesNotMatch(text, /Talk through the results together|Agree a retest with your doctor|Book a consultation to go through it|Overdue probe/, 'no other member’s next steps');
    assert.deepEqual(findRestrictedFields(section, restrictedKeys()), [], 'no phone, email, address, PIN code or date of birth');
    assert.ok(!archive.notIncluded.some((n) => /Follow-ups on your blood test reports/.test(n.what)), 'the module leaves notIncluded once it contributes');
    assert.ok(section.preparationReminders.records.every((r) => ['queued', 'sent', 'skipped'].includes(String(r.status))));

    // preparation reminders: the member's own, queued, sent or skipped (never the withdrawn ones), without an address
    const vSection = sectionOf(buildArchive(h.ctx, vikramId, 'drq_labfollowups_export_2'))!;
    const reminders = vSection.preparationReminders.records;
    assert.ok(reminders.some((r) => r.status === 'sent' && r.title === 'Preparing for your blood test' && /^Lipid Profile: home collection /.test(String(r.body))), JSON.stringify(reminders));
    assert.ok(reminders.every((r) => r.status !== 'cancelled'), 'withdrawn reminders stay out');
    assert.deepEqual(findRestrictedFields(vSection, restrictedKeys()), []);
    assert.doesNotMatch(JSON.stringify(vSection), /12 Demo Street|560034/, 'no collection address or PIN code');
    assert.ok(!(vSection.nextSteps.records as Array<{ nextStep: string }>).some((s) => SEEDED_NEXT_STEPS.includes(s.nextStep)), 'not Ananya’s next steps');
  } finally {
    h.db.run('DELETE FROM lab_followups WHERE id = ?', [linkedStep.id]);
    h.db.run("DELETE FROM coaching_plans WHERE id = 'plan_probe_draft'");
  }
});
