/* Round 7 (core): the data export's import order and its files and data-request notes, the team's note on
   /admin/data-exports, meeting links made safe where raw appointment rows are read (GET /me, the coach home), coach
   follow-ups that name a habit the member no longer shares, the coach routes' field-policy safety net (coachSafe), the
   coach's consultation reminder title, and the integrations registry's usedBy lists. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId } from '../helpers.js';
import { buildArchive } from '../../src/domain/dataExport.js';
import { ATTACHMENT_FILE_KIND } from '../../src/domain/attachments.js';
import { PHOTO_FILE_KIND } from '../../src/domain/progress.js';
import { HABIT_REF } from '../../src/domain/habits.js';
import { openTask } from '../../src/domain/support.js';
import { sendReminders } from '../../src/domain/appointments.js';
import { setSetting } from '../../src/domain/settings.js';
import { setRestrictedFieldReporter } from '../../src/auth/fieldPolicy.js';
import { randomId } from '../../src/lib/ids.js';

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); h.db.close(); });

const signedIn = async (email: string, password: string) => {
  const c = client(h.app);
  const privileged = password === DEMO_PASSWORDS.admin || password === DEMO_PASSWORDS.owner;
  await c.login(email, password, password === DEMO_PASSWORDS.member ? 'member' : 'dashboard', privileged);
  return c;
};
const now = () => new Date().toISOString();
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

/* ---------- b. the data export ---------- */

test('dataExport.ts loads first in a fresh process: the file kind exists before the module registry reads it', () => {
  const script = [
    "const d = await import('./src/domain/dataExport.ts');",
    "const { MODULES } = await import('./src/modules/index.ts');",
    "const support = MODULES.find((m) => m.key === 'support');",
    "if (d.EXPORT_KIND !== 'data_export') throw new Error('EXPORT_KIND is ' + d.EXPORT_KIND);",
    "if (support.fileAccess[d.EXPORT_KIND] !== d.canOpenExport) throw new Error('the support module does not resolve data_export files');",
    "console.log('loaded');",
  ].join('\n');
  const r = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { cwd: apiDir, encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`);
  assert.match(r.stdout, /loaded/);
  assert.doesNotMatch(r.stderr, /before initialization/);
});

test('data export: files are listed by name, type, size and date only; exports and message attachments are left out', () => {
  const memberId = userId(h.ctx, DEMO.member2);
  const insert = (kind: string, name: string, mime: string, deleted = false) => {
    const id = randomId('fil');
    h.db.insert('file_metadata', { id, owner_id: memberId, kind, name, mime, size: 1234, storage_path: `r7/${id}`, sha256: 'r7-sample-checksum', ref_type: 'r7_sample', ref_id: 'r7_ref_sample', created_at: now(), deleted_at: deleted ? now() : null });
    return id;
  };
  const photo = insert(PHOTO_FILE_KIND, 'r7-sample-progress-photo.jpg', 'image/jpeg');
  const meal = insert('meal_photo', 'r7-sample-meal-photo.webp', 'image/webp');
  const unsent = insert(ATTACHMENT_FILE_KIND, 'r7-sample-unsent-attachment.pdf', 'application/pdf');
  const oldExport = insert('data_export', 'r7-sample-old-export.json', 'application/json');
  const removed = insert(PHOTO_FILE_KIND, 'r7-sample-removed-photo.jpg', 'image/jpeg', true);

  const archive = buildArchive(h.ctx, memberId, 'drq_r7filestest');
  const files = archive.sections.files as Array<Record<string, unknown>>;
  const names = files.map((f) => f.name);
  assert.ok(names.includes('r7-sample-progress-photo.jpg') && names.includes('r7-sample-meal-photo.webp'), 'progress and meal photos are listed');
  assert.ok(!names.includes('r7-sample-unsent-attachment.pdf'), 'message attachments are not listed here (messaging lists the sent ones)');
  assert.ok(!names.includes('r7-sample-old-export.json'), 'earlier exports are not listed');
  assert.ok(!names.includes('r7-sample-removed-photo.jpg'), 'removed files are not listed');
  for (const f of files) assert.deepEqual(Object.keys(f).sort(), ['created_at', 'name', 'size', 'type'], 'name, type, size and date only');
  const listed = files.find((f) => f.name === 'r7-sample-meal-photo.webp')!;
  assert.deepEqual({ type: listed.type, size: listed.size }, { type: 'image/webp', size: 1234 });
  const text = JSON.stringify(archive.sections.files);
  for (const id of [photo, meal, unsent, oldExport, removed]) assert.ok(!text.includes(id), 'no file ids');
  assert.ok(!text.includes('r7_ref_sample') && !text.includes('r7-sample-checksum') && !text.includes('r7/'), 'no references, checksums or storage paths');
  assert.ok(archive.notIncluded.some((n) => /added to a message but have not sent/.test(n.what)), 'unsent message files are named under notIncluded');
});

test('data export: the member’s own data-request note is in their archive, the team’s note never; a note an administrator may have overwritten before migration 0021 is left out', async () => {
  const member = await signedIn(DEMO.member2, DEMO_PASSWORDS.member);
  const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin);
  const memberId = userId(h.ctx, DEMO.member2);
  const MEMBER_NOTE = 'R7 sample: please include my appointment history (member wording)';
  const TEAM_NOTE = 'R7 sample: identity confirmed (team wording)';

  const created = await member.post('/api/me/data-requests', { kind: 'export', note: MEMBER_NOTE });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.deepEqual(Object.keys(created.json).sort(), ['completed_at', 'created_at', 'file_id', 'id', 'kind', 'note', 'status', 'user_id'], 'POST /me/data-requests answers with the request’s own columns only');
  const id = created.json.id as string;
  const again = await member.post('/api/me/data-requests', { kind: 'export' });
  assert.equal(again.json.id, id);
  assert.deepEqual(Object.keys(again.json).sort(), Object.keys(created.json).sort(), 'the open request, the same columns');

  const patched = await admin.patch(`/api/admin/data-requests/${id}`, { status: 'in_progress', note: TEAM_NOTE });
  assert.equal(patched.status, 200, JSON.stringify(patched.json));

  const archive = buildArchive(h.ctx, memberId, 'drq_r7notetest');
  const body = JSON.stringify(archive);
  assert.ok(!body.includes(TEAM_NOTE), 'never the team’s note');
  const mine = (archive.sections.dataRequests as Array<{ kind: string; status: string; yourNote: string | null }>);
  assert.ok(mine.some((r) => r.yourNote === MEMBER_NOTE && r.status === 'in_progress'), 'the member’s own words are theirs to take');
  for (const r of mine) assert.deepEqual(Object.keys(r).sort(), ['completed_at', 'created_at', 'kind', 'status', 'yourNote']);

  // a request an administrator updated before migration 0021 was applied (when the team's note was written over the
  // member's): its note may be the team's words, so it stays out
  const legacy = randomId('drq');
  h.db.insert('data_requests', { id: legacy, user_id: memberId, kind: 'export', status: 'cancelled', note: 'R7 sample: legacy note possibly overwritten', file_id: null, created_at: '2000-01-01T00:00:00.000Z', completed_at: null });
  h.db.insert('audit_events', { id: randomId('aud'), actor_id: null, actor_role: 'admin', action: 'data_request.update', target_type: 'data_request', target_id: legacy, reason: 'R7 sample: legacy note possibly overwritten', ip: null, data: '{}', at: '2000-01-01T00:00:01.000Z' });
  const withLegacy = buildArchive(h.ctx, memberId, 'drq_r7legacytest');
  assert.ok(!JSON.stringify(withLegacy).includes('legacy note possibly overwritten'), 'a possibly overwritten note is left out');
  assert.ok((withLegacy.sections.dataRequests as Array<{ yourNote: string | null }>).some((r) => r.yourNote === MEMBER_NOTE), 'the current request keeps the member’s note');

  // administrators see the team's note on /admin/data-exports; members never
  const list = await admin.get('/api/admin/data-exports');
  assert.equal(list.status, 200, JSON.stringify(list.json));
  const row = (list.json.items as Array<Record<string, unknown>>).find((x) => x.id === id)!;
  assert.equal(row.note, MEMBER_NOTE);
  assert.equal(row.adminNote, TEAM_NOTE);
  const own = await member.get('/api/me/data-exports');
  assert.equal(own.status, 200);
  assert.ok(!own.text.includes(TEAM_NOTE) && !own.text.includes('adminNote'), 'members never receive the team’s note');
});

/* ---------- c. meeting links made safe at the source ---------- */

function insertAppointment(memberId: string, coachId: string, startAt: string, status: 'requested' | 'scheduled', link: string | null): string {
  const id = randomId('apt');
  h.db.insert('appointments', { id, member_id: memberId, coach_id: coachId, programme_id: null, kind: 'consultation', status, start_at: startAt, end_at: new Date(Date.parse(startAt) + 30 * 60_000).toISOString(), timezone: 'Asia/Kolkata', meeting_link: link, note: null, member_note: null, entitlement_tx_id: null, cancelled_reason: null, reminder_sent_at: null, idempotency_key: null, created_by: coachId, created_at: now(), updated_at: now() });
  return id;
}

const LINK_CASES: Array<{ status: 'requested' | 'scheduled'; link: string | null; shown: string | null; why: string }> = [
  { status: 'scheduled', link: 'https://meet.bioptime.example/r7-sample', shown: null, why: 'the old placeholder is never shown' },
  { status: 'scheduled', link: 'https://video.example.org/r7\u0001sample', shown: null, why: 'a control character' },
  { status: 'scheduled', link: 'https://video.example.org/r7 sample', shown: null, why: 'whitespace' },
  { status: 'scheduled', link: 'http://video.example.org/r7-sample', shown: null, why: 'not https' },
  { status: 'requested', link: 'https://video.example.org/r7-sample', shown: null, why: 'only a scheduled appointment carries a link' },
  { status: 'scheduled', link: 'https://video.example.org/r7-sample', shown: 'https://video.example.org/r7-sample', why: 'a safe link of a scheduled appointment' },
];

test('GET /me: the next appointment’s meeting link follows the same rule as the appointments presenter', async () => {
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const memberId = userId(h.ctx, DEMO.member), coachId = userId(h.ctx, DEMO.coach);
  const coach = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const id = insertAppointment(memberId, coachId, inMinutes(3), 'scheduled', null);
  try {
    for (const c of LINK_CASES) {
      h.db.run('UPDATE appointments SET status = ?, meeting_link = ? WHERE id = ?', [c.status, c.link, id]);
      const r = await member.get('/api/me');
      assert.equal(r.status, 200);
      const next = r.json.nextAppointment as { id: string; meeting_link: string | null };
      assert.equal(next.id, id, 'the inserted appointment is the next one');
      assert.equal(next.meeting_link, c.shown, c.why);
      if (c.link && !c.shown) assert.ok(!r.text.includes(JSON.stringify(c.link).slice(1, -1)), `${c.why}: the raw link is not sent`);
      // the coach's view of the client is built on the same overview
      const record = await coach.get(`/api/coach/clients/${memberId}`);
      assert.equal(record.status, 200, JSON.stringify(record.json));
      assert.equal((record.json.nextAppointment as { meeting_link: string | null }).meeting_link, c.shown, `coach view: ${c.why}`);
    }
  } finally { h.db.run("UPDATE appointments SET status = 'cancelled', cancelled_reason = 'r7 test done' WHERE id = ?", [id]); }
});

test('GET /coach/home: today’s, upcoming and requested appointments carry only a safe link of a scheduled appointment', async () => {
  const coach = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const memberId = userId(h.ctx, DEMO.member), coachId = userId(h.ctx, DEMO.coach);
  const ids = LINK_CASES.map((c, i) => insertAppointment(memberId, coachId, inMinutes(2 + i), c.status, c.link));
  try {
    const r = await coach.get('/api/coach/home');
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const rows = ['todaysAppointments', 'upcomingAppointments', 'requestedAppointments'].flatMap((k) => r.json[k] as Array<{ id: string; status: string; meeting_link: string | null }>);
    for (const [i, c] of LINK_CASES.entries()) {
      const seen = rows.filter((a) => a.id === ids[i]);
      assert.ok(seen.length >= 1, `appointment ${i} is listed`);
      for (const a of seen) assert.equal(a.meeting_link, c.shown, c.why);
    }
    for (const c of LINK_CASES) if (c.link && !c.shown && !LINK_CASES.some((o) => o.shown === c.link)) assert.ok(!r.text.includes(JSON.stringify(c.link).slice(1, -1)), `${c.why}: never sent`);
  } finally { for (const id of ids) h.db.run("UPDATE appointments SET status = 'cancelled', cancelled_reason = 'r7 test done' WHERE id = ?", [id]); }
});

/* ---------- d. habit follow-ups and the coach routes' safety net ---------- */

test('coach follow-ups naming a habit the member wrote are left out while the member does not share, and cannot be reopened', async () => {
  const coach = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const memberId = userId(h.ctx, DEMO.member), coachId = userId(h.ctx, DEMO.coach);
  const MEMBER_HABIT = 'R7 sample: evening walk the member wrote';
  const COACH_HABIT = 'R7 sample: protein at breakfast the coach set';
  const habit = (title: string, role: 'member' | 'coach') => {
    const id = randomId('hab');
    h.db.insert('habits', { id, member_id: memberId, coach_id: role === 'coach' ? coachId : null, title, schedule: '{"type":"daily"}', start_date: now().slice(0, 10), created_by: role === 'member' ? memberId : coachId, created_by_role: role, created_at: now(), updated_at: now() });
    return id;
  };
  const followUp = (habitId: string, title: string) => openTask({ ...h.ctx, actor: null }, { kind: 'coach_follow_up', refType: HABIT_REF, refId: habitId, ownerId: coachId, notify: false, title: `Habit slipping: Ananya, “${title}”`, detail: '3 due days without a check-in (sample).' });
  const share = async (granted: boolean) => { const r = await member.post('/api/me/consents', { kind: 'coach_sharing', version: 'r7-test', granted }); assert.equal(r.status, 200, JSON.stringify(r.json)); };
  const listed = async () => {
    const home = await coach.get('/api/coach/home');
    const list = await coach.get('/api/coach/follow-ups');
    assert.equal(home.status, 200); assert.equal(list.status, 200);
    return { home, list, homeIds: (home.json.followUps as Array<{ id: string }>).map((t) => t.id), listIds: (list.json.items as Array<{ id: string }>).map((t) => t.id) };
  };
  assert.equal(HABIT_REF, 'habit', 'the ref_type coaches.WITHHELD_HABIT_FOLLOW_UP names');
  const memberHabit = habit(MEMBER_HABIT, 'member'), coachHabit = habit(COACH_HABIT, 'coach');
  const t1 = followUp(memberHabit, MEMBER_HABIT), t2 = followUp(coachHabit, COACH_HABIT);
  try {
    // while the member shares, both are listed
    let seen = await listed();
    for (const t of [t1, t2]) { assert.ok(seen.homeIds.includes(t), 'on Today'); assert.ok(seen.listIds.includes(t), 'on the follow-ups list'); }

    // the member withdraws coach_sharing: the follow-up naming their own habit leaves both lists at once (before the
    // habits module's privacy job runs); the coach-set habit's stays
    await share(false);
    seen = await listed();
    assert.ok(!seen.homeIds.includes(t1) && !seen.listIds.includes(t1), 'left out of Today and the follow-ups list');
    assert.ok(!seen.home.text.includes(MEMBER_HABIT) && !seen.list.text.includes(MEMBER_HABIT), 'the habit’s title is not sent');
    assert.ok(seen.homeIds.includes(t2) && seen.listIds.includes(t2), 'a habit the coach set stays visible, as plan tasks do');
    const metrics = seen.home.json.metrics as { outstandingTasks: number };
    assert.equal(metrics.outstandingTasks, (seen.home.json.followUps as unknown[]).length + (seen.home.json.reportsToReview as unknown[]).length + (seen.home.json.draftPlans as unknown[]).length, 'the count matches what is listed');

    // it cannot be reopened or set in progress, and the refusal does not carry its title
    for (const status of ['open', 'in_progress'] as const) {
      const r = await coach.patch(`/api/coach/follow-ups/${t1}`, { status });
      assert.equal(r.status, 403, JSON.stringify(r.json));
      assert.equal(r.json.error?.code, 'NOT_SHARED');
      assert.ok(!r.text.includes(MEMBER_HABIT));
    }
    assert.equal(h.db.get<{ status: string }>('SELECT status FROM support_tasks WHERE id = ?', [t1])!.status, 'open', 'nothing changed');
    // a dismissed follow-up closed by the privacy rule cannot be reopened either
    const t3 = followUp(memberHabit, MEMBER_HABIT);
    h.db.run("UPDATE support_tasks SET status = 'dismissed', resolution = 'Closed: the member no longer shares health information with their coach' WHERE id = ?", [t3]);
    assert.equal((await coach.patch(`/api/coach/follow-ups/${t3}`, { status: 'open' })).status, 403, 'a privacy-dismissed follow-up is not reopened');
    assert.equal(h.db.get<{ status: string }>('SELECT status FROM support_tasks WHERE id = ?', [t3])!.status, 'dismissed');
    // closing it is allowed, and the answer leaves out its title and detail
    const closed = await coach.patch(`/api/coach/follow-ups/${t1}`, { status: 'dismissed', resolution: 'R7 sample: closing it' });
    assert.equal(closed.status, 200, JSON.stringify(closed.json));
    assert.equal(closed.json.status, 'dismissed');
    assert.equal(closed.json.withheld, true);
    assert.ok(!('title' in closed.json) && !('detail' in closed.json) && !closed.text.includes(MEMBER_HABIT), 'no title or detail');
    // the coach-set habit's follow-up is updated as before, title included
    const progressed = await coach.patch(`/api/coach/follow-ups/${t2}`, { status: 'in_progress' });
    assert.equal(progressed.status, 200, JSON.stringify(progressed.json));
    assert.match(String(progressed.json.title), /protein at breakfast/);

    // once the member shares again, an open follow-up on their habit is listed again and can be progressed
    const t4 = followUp(memberHabit, MEMBER_HABIT);
    assert.ok(!(await listed()).listIds.includes(t4), 'hidden while not shared');
    await share(true);
    seen = await listed();
    assert.ok(seen.homeIds.includes(t4) && seen.listIds.includes(t4), 'listed again once shared');
    const reopened = await coach.patch(`/api/coach/follow-ups/${t4}`, { status: 'in_progress' });
    assert.equal(reopened.status, 200, JSON.stringify(reopened.json));
    assert.match(String(reopened.json.title), /evening walk/);
    // another coach's follow-up stays "not found"
    const other = await signedIn(DEMO.coach2, DEMO_PASSWORDS.coach);
    assert.equal((await other.patch(`/api/coach/follow-ups/${t4}`, { status: 'resolved', resolution: 'not mine' })).status, 404);
  } finally {
    await share(true);
    h.db.run("UPDATE support_tasks SET status = 'dismissed', resolution = 'r7 test done' WHERE ref_id IN (?, ?) AND status IN ('open','in_progress')", [memberHabit, coachHabit]);
    h.db.run("UPDATE habits SET status = 'archived', archived_at = ? WHERE id IN (?, ?)", [now(), memberHabit, coachHabit]);
  }
});

test('coach routes pass coachSafe: a restricted key in a payload is stripped before it is sent and reported; clean payloads report nothing', async () => {
  const coach = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const memberId = userId(h.ctx, DEMO.member);
  const reports: Array<{ where: string; paths: string[] }> = [];
  const previous = setRestrictedFieldReporter((where, paths) => { reports.push({ where, paths }); });
  const saved = h.db.get<{ data: string }>('SELECT data FROM onboarding_progress WHERE user_id = ?', [memberId]);
  try {
    for (const p of ['/api/coach/home', '/api/coach/follow-ups', `/api/coach/clients/${memberId}`, `/api/coach/clients/${memberId}/bloodwork`, `/api/coach/clients/${memberId}/assignments`, '/api/coach/clients', '/api/coach/bookings', '/api/coach/reports', '/api/coach/plans', '/api/coach/appointments?range=all']) assert.equal((await coach.get(p)).status, 200, p);
    assert.equal(reports.length, 0, `the presenters hand coachSafe nothing restricted: ${JSON.stringify(reports)}`);
    const bookings = await coach.get(`/api/coach/clients/${memberId}/bloodwork`);
    assert.ok((bookings.json.bookings as unknown[]).length > 0, 'the demo member has bookings');
    for (const b of bookings.json.bookings as Array<Record<string, unknown>>) assert.ok(!('address' in b), 'no collection address');

    // a free-form onboarding answer carrying a phone number (the profile step is already left out by the route)
    const data = { ...(saved ? JSON.parse(saved.data) as Record<string, unknown> : {}), goals: { goals: ['Energy and sleep'], phone: '+91 97000 00099' } };
    h.db.run('INSERT INTO onboarding_progress (user_id, step, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data', [memberId, 'done', JSON.stringify(data), now()]);
    const r = await coach.get(`/api/coach/clients/${memberId}`);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(!r.text.includes('97000 00099'), 'the phone number is never sent');
    assert.deepEqual((r.json.onboardingResponses as { goals: Record<string, unknown> }).goals, { goals: ['Energy and sleep'] });
    const report = reports.find((x) => x.paths.some((p) => p.endsWith('.onboardingResponses.goals.phone')));
    assert.ok(report, `reported: ${JSON.stringify(reports)}`);
    assert.equal(report.where, 'GET /api/coach/clients/:id');
    assert.ok(!JSON.stringify(reports).includes('97000'), 'reports carry paths, never values');
  } finally {
    setRestrictedFieldReporter(previous);
    if (saved) h.db.run('UPDATE onboarding_progress SET data = ? WHERE user_id = ?', [saved.data, memberId]);
  }
});

/* ---------- e. the consultation reminder ---------- */

test('consultation reminders: the coach’s title follows the same rule as the member’s (tomorrow only about a day ahead)', () => {
  const memberId = userId(h.ctx, DEMO.member), coachId = userId(h.ctx, DEMO.coach);
  const titleFor = (userIdValue: string, appointmentId: string) => h.db.get<{ title: string }>("SELECT title FROM notifications WHERE user_id = ? AND category = 'appointment_reminder' AND json_extract(data, '$.appointmentId') = ?", [userIdValue, appointmentId])?.title;
  const previous = h.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'reminder_hours_before'");
  const ids: string[] = [];
  try {
    for (const [hours, expected] of [[48, 'Consultation coming up'], [24, 'Consultation tomorrow'], [6, 'Consultation coming up']] as const) {
      setSetting(h.ctx, 'reminder_hours_before', hours, 'r7 test');
      const id = insertAppointment(memberId, coachId, inMinutes(hours * 60 + 10), 'scheduled', null);
      ids.push(id);
      sendReminders(h.ctx);
      assert.equal(titleFor(memberId, id), expected, `member, ${hours} hours ahead`);
      assert.equal(titleFor(coachId, id), expected, `coach, ${hours} hours ahead`);
    }
  } finally {
    if (previous) h.db.run("UPDATE settings SET value = ? WHERE key = 'reminder_hours_before'", [previous.value]);
    else h.db.run("DELETE FROM settings WHERE key = 'reminder_hours_before'");
    for (const id of ids) h.db.run("UPDATE appointments SET status = 'cancelled', cancelled_reason = 'r7 test done' WHERE id = ?", [id]);
  }
});

/* ---------- f. the integrations registry ---------- */

test('integrations registry: email, SMS and push name the modules whose code sends on them; no module sends SMS', async () => {
  const owner = await signedIn(DEMO.owner, DEMO_PASSWORDS.owner);
  const r = await owner.get('/api/admin/integrations');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const usedBy = (key: string) => (r.json.items as Array<{ key: string; usedBy?: string[] }>).find((i) => i.key === key)!.usedBy!;
  assert.deepEqual(usedBy('sms'), [], 'habit reminders are in-app and push; session reminders in-app, email and push');
  assert.deepEqual(usedBy('email'), ['progress', 'billing', 'support', 'nutrition', 'workouts', 'labFollowups', 'sessions', 'learning']);
  assert.deepEqual(usedBy('push'), ['habits', 'progress', 'billing', 'support', 'nutrition', 'workouts', 'labFollowups', 'sessions', 'messaging', 'learning']);

  // what the code queued and sent agrees: no SMS attempt anywhere, habit reminders never by email or SMS, session
  // reminders never by SMS
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM delivery_attempts WHERE channel = 'sms'")!.n, 0);
  for (const row of h.db.all<{ ref_type: string; channels: string }>('SELECT ref_type, channels FROM reminders')) {
    const channels = JSON.parse(row.channels) as string[];
    assert.ok(!channels.includes('sms'), `${row.ref_type} reminder without SMS`);
    if (row.ref_type === HABIT_REF) assert.ok(!channels.includes('email'), 'habit reminders: in-app and push');
  }
  // and the source: no channels list passed to notify() or the reminders queue names SMS
  const roots = ['src/domain', 'src/http/routes', 'src/modules', 'src/auth'].map((d) => path.join(apiDir, d));
  for (const dir of roots) for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(text, /channels:\s*\[[^\]]*'sms'/, `${path.relative(apiDir, path.join(dir, f))} sends SMS: add its module to sms.usedBy in adapters/registry.ts`);
  }
});
