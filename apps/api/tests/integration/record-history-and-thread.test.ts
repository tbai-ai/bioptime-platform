/* Regression tests for the admin member record and the demo thread (bug ids in each title): the record's History list
   is not crowded out by record views while the audit log keeps every one (staff-6); the record's member object carries
   the member code (staff-13); the seeded conversation reads in order, the member's message before the coach's reply
   (staff-11). Also covers the image-delete refusal for an exercise picture (cr-6) and the India-day wording of the
   bloodwork and live-session notices (portal-13). */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId } from '../helpers.js';
import { audit } from '../../src/domain/audit.js';
import * as assets from '../../src/domain/assets.js';
import * as bloodwork from '../../src/domain/bloodwork.js';
import { istDayLabel, istWhen, zonedToIso } from '../../src/lib/time.js';
import type { Ctx } from '../../src/context.js';

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); h.db.close(); });

const VIEW = /[._]viewed$/;
const ISO_DATE = /\d{4}-\d\d-\d\d/;
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const as = (email: string, role: 'admin' | 'owner' | 'coach' | 'member'): Ctx => ({ ...h.ctx, actor: { id: userId(h.ctx, email), role, email, name: email } });

test('the admin member record lists changes, not record views: views never crowd out the history, and the audit log keeps every view (staff-6)', async () => {
  const admin = client(h.app), owner = client(h.app);
  await admin.login(DEMO.admin, DEMO_PASSWORDS.admin, 'dashboard', true);
  await owner.login(DEMO.owner, DEMO_PASSWORDS.owner, 'dashboard', true);
  // a member whose history fits the record's 100-row window (the preview member's seeded history is longer than that)
  const priya = userId(h.ctx, 'sameer.khan@demo.bioptime.test');
  const changesBefore = h.db.get<{ n: number }>("SELECT COUNT(*) n FROM audit_events WHERE target_type = 'user' AND target_id = ? AND substr(action, -7) NOT IN ('.viewed', '_viewed')", [priya])!.n;
  assert.ok(changesBefore > 0, 'the demo member has real history (registration, consents, account state)');

  // three real openings, then more views than the record's 100-row window: the record opened by staff over months
  for (let i = 0; i < 3; i++) assert.equal((await admin.get(`/api/admin/members/${priya}`)).status, 200);
  const adminCtx = as(DEMO.admin, 'admin'), coachCtx = as(DEMO.coach, 'coach');
  for (let i = 0; i < 110; i++) audit(adminCtx, 'member.record_viewed', { type: 'user', id: priya }, null, { by: 'admin' });
  for (let i = 0; i < 12; i++) audit(coachCtx, 'health.viewed', { type: 'user', id: priya }, null, { by: 'coach', what: 'test' });
  // an action that merely ends in "viewed" without a separator is a change, not a view, and stays listed
  audit(adminCtx, 'test.reviewed', { type: 'user', id: priya }, 'test: a reviewed change');

  const rec = await admin.get(`/api/admin/members/${priya}`);
  assert.equal(rec.status, 200);
  const rows = rec.json.audit as Array<{ action: string; at: string }>;
  assert.equal(rows.filter((a) => VIEW.test(a.action)).length, 0, 'no record views in the record’s history list');
  assert.equal(rows.length, changesBefore + 1, 'every change is listed (the window is no longer filled with views)');
  assert.equal(rows[0]!.action, 'test.reviewed', 'newest first, and "reviewed" is not mistaken for a view');
  for (const a of ['member.register', 'consent.set']) assert.ok(rows.some((r) => r.action === a), `${a} is visible`);
  assert.deepEqual(rows.map((r) => r.at), [...rows.map((r) => r.at)].sort().reverse(), 'still newest first');

  // the audit log itself is complete: every view is still recorded and readable there
  const views = h.db.get<{ n: number }>("SELECT COUNT(*) n FROM audit_events WHERE action = 'member.record_viewed' AND target_id = ?", [priya])!.n;
  assert.ok(views >= 114, `every opening is recorded (${views})`);
  const log = await owner.get(`/api/admin/audit?targetType=user&targetId=${priya}&limit=1000`);
  assert.equal(log.status, 200);
  const logged = log.json.items as Array<{ action: string }>;
  assert.equal(logged.filter((a) => a.action === 'member.record_viewed').length, views, 'the audit log lists every record view');
  assert.ok(logged.filter((a) => a.action === 'health.viewed').length >= 12, 'and every health read');
});

test('the admin member record names the member code in its member object, as the coach record does (staff-13)', async () => {
  const admin = client(h.app), coach = client(h.app), member = client(h.app);
  await admin.login(DEMO.admin, DEMO_PASSWORDS.admin, 'dashboard', true);
  await coach.login(DEMO.coach, DEMO_PASSWORDS.coach, 'dashboard');
  await member.login(DEMO.member, DEMO_PASSWORDS.member);
  const ananya = userId(h.ctx, DEMO.member);
  const code = h.db.get<{ member_code: string }>('SELECT member_code FROM member_profiles WHERE user_id = ?', [ananya])!.member_code;
  assert.match(code, /^BPM-\d+$/);
  const rec = await admin.get(`/api/admin/members/${ananya}`);
  assert.equal(rec.status, 200);
  assert.equal((rec.json.member as { memberCode: string }).memberCode, code, 'the admin h1 has the code to show');
  assert.equal((rec.json.profile as { profile: { memberCode: string } }).profile.memberCode, code, 'the same code as the profile');
  assert.equal(((await coach.get(`/api/coach/clients/${ananya}`)).json.member as { memberCode: string }).memberCode, code, 'the coach record is unchanged');
  assert.equal(((await member.get('/api/me')).json.member as { memberCode: string }).memberCode, code, 'the member home names the member’s own code');
});

test('the demo thread reads in order: the member’s message comes before the coach’s reply (staff-11)', async () => {
  const coach = client(h.app);
  await coach.login(DEMO.coach, DEMO_PASSWORDS.coach, 'dashboard');
  const ananya = userId(h.ctx, DEMO.member), asha = userId(h.ctx, DEMO.coach);
  const conv = h.db.get<{ id: string }>('SELECT id FROM conversations WHERE member_id = ? AND coach_id = ?', [ananya, asha])!;
  const seeded = h.db.all<{ sender_id: string; body: string; created_at: string }>('SELECT sender_id, body, created_at FROM messages WHERE conversation_id = ? ORDER BY rowid', [conv.id]);
  assert.equal(seeded.length, 2);
  assert.equal(seeded[0]!.sender_id, ananya, 'the member wrote first');
  assert.match(seeded[0]!.body, /^Slept 7 hours/);
  assert.equal(seeded[1]!.sender_id, asha, 'the coach replied');
  assert.match(seeded[1]!.body, /^Lovely\. Keep the walk after dinner/);
  assert.ok(seeded[0]!.created_at <= seeded[1]!.created_at, 'the reply is not older than the message it answers');
  const thread = await coach.get(`/api/conversations/${conv.id}/messages`);
  assert.equal(thread.status, 200);
  const items = thread.json.items as Array<{ senderId: string; body: string; mine: boolean }>;
  assert.deepEqual(items.map((m) => [m.senderId, m.mine]), [[ananya, false], [asha, true]], 'the thread shows the member’s message, then the reply');
  // the reply leaves the member's message unread for the coach, as before (sending never marks a thread read)
  const list = (await coach.get('/api/conversations')).json.items as Array<{ id: string; unread: number }>;
  assert.equal(list.find((c) => c.id === conv.id)!.unread, 1);
});

test('an image shown as an exercise picture cannot be deleted either (cr-6)', async () => {
  const owner = as(DEMO.owner, 'owner');
  const up = assets.uploadAsset(owner, { filename: 'exercise.png', dataBase64: Buffer.concat([PNG_1x1, Buffer.from(`exercise-${Date.now()}`)]).toString('base64'), alt: 'A squat' });
  const ex = h.db.get<{ id: string; name: string }>('SELECT id, name FROM exercises ORDER BY name LIMIT 1')!;
  assert.ok(ex, 'the demo has an exercise');
  h.db.run('UPDATE exercises SET media_asset_id = ? WHERE id = ?', [up.id, ex.id]);
  assert.throws(() => assets.deleteAsset(owner, up.id, 'test: remove'), (e: Error & { details?: { code?: string; exercises?: Array<{ id: string }> } }) => {
    assert.match(e.message, new RegExp(`the exercise “${ex.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}”`));
    assert.equal(e.details?.code, 'ASSET_IN_USE');
    assert.deepEqual(e.details?.exercises?.map((x) => x.id), [ex.id]);
    return true;
  });
  assert.ok(assets.getAsset(owner, up.id), 'still in the library');
  h.db.run('UPDATE exercises SET media_asset_id = NULL WHERE id = ?', [ex.id]);
  assets.deleteAsset(owner, up.id, 'test: remove');
  assert.equal(assets.getAsset(owner, up.id), null);
});

test('bloodwork and live-session notices name India days in words, never a date cut from UTC (portal-13)', async () => {
  const all = h.db.all<{ title: string; body: string; data: string }>("SELECT title, body, data FROM notifications WHERE category IN ('bloodwork', 'session', 'appointment')");
  assert.ok(all.length > 0);
  for (const n of all) assert.doesNotMatch(n.body, ISO_DATE, `${n.title}: ${n.body}`);
  // each seeded "Collection scheduled" notice names its booking's slot as an India day in words
  const slotOf = (data: string) => h.db.get<{ slot_at: string }>('SELECT slot_at FROM bloodwork_bookings WHERE id = ?', [JSON.parse(data).bookingId as string])!.slot_at;
  const DAY = '(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \\d{1,2} [A-Z][a-z]{2} \\d{4}';
  const scheduled = all.filter((n) => n.title === 'Collection scheduled');
  assert.ok(scheduled.length, 'the demo has "Collection scheduled" notices');
  for (const n of scheduled) assert.match(n.body, new RegExp(`^A phlebotomist will visit on ${DAY}\\.$`), n.body);
  assert.ok(scheduled.some((n) => n.body === `A phlebotomist will visit on ${istDayLabel(slotOf(n.data))}.`), 'it names the slot’s India day');
  // "Booking confirmed" for a slot at 04:30 India time names the India day, not the UTC date before it
  const booking = h.db.get<{ id: string; member_id: string }>("SELECT id, member_id FROM bloodwork_bookings WHERE status = 'scheduled' ORDER BY created_at LIMIT 1")!;
  assert.ok(booking, 'the demo has a scheduled booking');
  const slotAt = zonedToIso(new Date(Date.now() + 330 * 60_000 + 6 * 86_400_000).toISOString().slice(0, 10), 4 * 60 + 30);
  assert.notEqual(istDayLabel(slotAt).split(' ')[1], String(Number(slotAt.slice(8, 10))), 'the India day and the UTC date differ, so the check can fail');
  h.db.run('UPDATE bloodwork_bookings SET slot_at = ? WHERE id = ?', [slotAt, booking.id]);
  bloodwork.override(as(DEMO.owner, 'owner'), booking.id, 'confirmed', 'test: back to confirmed');
  const confirmed = h.db.get<{ body: string }>("SELECT body FROM notifications WHERE user_id = ? AND title = 'Booking confirmed' ORDER BY created_at DESC LIMIT 1", [booking.member_id])!;
  assert.equal(confirmed.body, `Home collection on ${istDayLabel(slotAt)}.`);
  assert.doesNotMatch(confirmed.body, ISO_DATE);

  // a live session moved to 05:00 India time: the notice names the India day, which is not the UTC date
  const host = client(h.app), member = client(h.app);
  await host.login(DEMO.coach, DEMO_PASSWORDS.coach, 'dashboard');
  await member.login(DEMO.member, DEMO_PASSWORDS.member);
  const day = (offset: number) => new Date(Date.now() + 330 * 60_000 + offset * 86_400_000).toISOString().slice(0, 10);
  const created = await host.post('/api/coach/sessions', { kind: 'group_class', title: 'Test early class', audience: 'members', startAt: zonedToIso(day(4), 18 * 60), endAt: zonedToIso(day(4), 18 * 60 + 45) });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const id = created.json.id as string;
  assert.equal((await host.post(`/api/coach/sessions/${id}/publish`)).status, 200);
  const reg = await member.post(`/api/me/sessions/${id}/register`);
  assert.ok([200, 201].includes(reg.status), JSON.stringify(reg.json));
  const startAt = zonedToIso(day(5), 5 * 60);
  assert.notEqual(istDayLabel(startAt).split(' ')[1], String(Number(startAt.slice(8, 10))), 'the India day and the UTC date differ, so the check can fail');
  const moved = await host.patch(`/api/coach/sessions/${id}`, { startAt, endAt: zonedToIso(day(5), 5 * 60 + 45), reason: 'test: earlier start' });
  assert.equal(moved.status, 200, JSON.stringify(moved.json));
  const note = h.db.get<{ body: string }>("SELECT body FROM notifications WHERE user_id = ? AND category = 'session' AND title = 'Group class moved' ORDER BY created_at DESC LIMIT 1", [userId(h.ctx, DEMO.member)])!;
  assert.equal(note.body, `Test early class is now ${istWhen(startAt)}.`);
  assert.match(note.body, new RegExp(`is now ${DAY} at 05:00 IST\\.$`));
});
