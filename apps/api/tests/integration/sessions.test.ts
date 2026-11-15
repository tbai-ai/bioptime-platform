/* M8 Live sessions, webinars and consultation follow-through: the labelled sample sessions and no invented join links;
   permissions (a member acts on their own registrations, a coach only on the sessions they host and their own
   consultations with assigned clients, administrators with sessions.manage, a member's record with members.manage);
   capacity and the waitlist; eligibility by package; cancelling a session tells everyone; .ics times in IST; the
   placeholder link is never returned; public registration is rate-limited and has a honeypot; a coach cannot read
   another host's registrations; attendance; the consultation summary and follow-ups; reminders; validation; audit; the
   member's data export (their own registrations and attendance, never other registrants, join links or private notes). */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId } from '../helpers.js';
import type { Ctx } from '../../src/context.js';
import { sessions as sessionsModule } from '../../src/modules/sessions.js';
import { setUserPermission } from '../../src/auth/permissions.js';
import { findRestrictedFields, restrictedKeys } from '../../src/auth/fieldPolicy.js';
import { dispatchDue } from '../../src/domain/reminders.js';
import * as domain from '../../src/domain/sessions.js';
import { foldLine, icsCalendar, icsEscape } from '../../src/lib/ics.js';
import { zonedToIso } from '../../src/lib/time.js';
import { buildArchive } from '../../src/domain/dataExport.js';

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); h.db.close(); });

const PRIYA = 'priya.nair@demo.bioptime.test';
const SAMEER = 'sameer.khan@demo.bioptime.test';
const signedIn = async (email: string, password: string, workspace: 'member' | 'dashboard', mfa = false) => { const c = client(h.app); await c.login(email, password, workspace, mfa); return c; };
const member = (email: string) => signedIn(email, DEMO_PASSWORDS.member, 'member');
const coach = (email: string) => signedIn(email, DEMO_PASSWORDS.coach, 'dashboard');
const admin = () => signedIn(DEMO.admin, DEMO_PASSWORDS.admin, 'dashboard', true);
const as = (email: string): Ctx => { const u = h.db.get<{ id: string; role: 'member' | 'coach' | 'admin' | 'owner'; name: string }>('SELECT id, role, name FROM users WHERE email = ?', [email])!; return { ...h.ctx, actor: { id: u.id, role: u.role, email, name: u.name } }; };
const code = (r: { json: { error?: { code: string } } }) => r.json.error?.code;
/** An INVALID_STATE error names its reason in details.code. */
const stateCode = (r: { json: { error?: { code: string; details?: unknown } } }) => (r.json.error?.details as { code?: string } | undefined)?.code;
const istDay = (offsetDays: number) => new Date(Date.now() + 330 * 60_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
/** A slot `days` ahead at a minute of the day in India. */
const slot = (days: number, minute: number, length = 45) => ({ startAt: zonedToIso(istDay(days), minute), endAt: zonedToIso(istDay(days), minute + length) });
const auditRows = (action: string, targetId?: string) => h.db.all<{ actor_id: string | null; actor_role: string; reason: string | null; data: string; target_id: string }>(`SELECT actor_id, actor_role, reason, data, target_id FROM audit_events WHERE action = ? ${targetId ? 'AND target_id = ?' : ''} ORDER BY at`, targetId ? [action, targetId] : [action]);
const notes = (email: string, category: string) => h.db.all<{ title: string; body: string; data: string }>('SELECT title, body, data FROM notifications WHERE user_id = ? AND category = ? ORDER BY created_at', [userId(h.ctx, email), category]);
/** The sessions the demo seed writes, in plain words (the owner removed the demo and sample labels on 24 October 2026). */
const SEEDED_TITLES = ['Morning mobility class', 'Evening wind-down workshop', 'Strength basics for Core members', 'Posture check-in class', 'Getting started with Bioptime', 'Lunchtime stretch'];
const regStatus = (sessionId: string, email: string) => h.db.get<{ status: string }>('SELECT status FROM session_registrations WHERE session_id = ? AND user_id = ?', [sessionId, userId(h.ctx, email)])?.status;

/** A published session hosted by a coach, through the API. */
async function hostedSession(hostEmail: string, body: Record<string, unknown>) {
  const c = await coach(hostEmail);
  const r = await c.post('/api/coach/sessions', { kind: 'group_class', title: 'Test class', audience: 'members', ...slot(4, 18 * 60), ...body });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const id = r.json.id as string;
  const p = await c.post(`/api/coach/sessions/${id}/publish`);
  assert.equal(p.status, 200, JSON.stringify(p.json));
  return { c, id };
}

test('the demo seed ships a few sessions in plain words (no demo or sample label), creates no join links, and the meeting seams stay pending configuration', async () => {
  const a = await admin();
  const r = await a.get('/api/admin/sessions');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const items = r.json.items as Array<{ title: string; description: string; sample: boolean; joinUrl: string | null; status: string; audience: string; meetingProvider: string }>;
  assert.ok(items.length >= 5 && items.length <= 10, 'a few seeded sessions');
  assert.deepEqual(items.map((s) => s.title).sort(), [...SEEDED_TITLES].sort());
  for (const s of items) {
    assert.doesNotMatch(`${s.title} ${s.description}`, /\bdemo\b|\bsample\b/i, 'the owner removed the demo and sample labels');
    assert.ok(s.description.length > 10, 'each says what the session is');
    assert.doesNotMatch(s.description, /link|recording|certif/i, 'no description promises a link, a recording or a credential');
    assert.equal(s.sample, false, 'not flagged sample, so no screen shows a Sample badge');
    assert.equal(s.joinUrl, null, 'no join link is invented');
    assert.equal(s.meetingProvider, 'none');
  }
  assert.deepEqual(new Set(items.map((s) => s.status)), new Set(['published', 'draft', 'completed', 'cancelled']));
  assert.ok(items.some((s) => s.audience === 'public'));
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM appointments WHERE meeting_link IS NOT NULL")!.n, 0, 'no consultation carries a link nobody typed');
  const integ = await a.get('/api/admin/integrations');
  assert.equal(integ.status, 200);
  const rows = integ.json.items as Array<{ key: string; status: string; missing: string[] }>;
  for (const key of ['meetings', 'calendar', 'video']) {
    const row = rows.find((i) => i.key === key)!;
    assert.equal(row.status, 'pending_configuration', key);
    assert.ok(row.missing.some((m) => /_PROVIDER accepts only "none"/.test(m)), `${key}: the missing requirement is named`);
  }
  assert.ok(sessionsModule.jobs?.some((j) => j.name === 'session_reminders'), 'the reminders job is registered through the module');
  assert.ok(sessionsModule.events?.ProgrammeEnded?.length, 'the ProgrammeEnded handler is registered through the module');
});

test('permissions: roles, sessions.manage, members.manage, signed-out callers and the feature flag', async () => {
  const anon = client(h.app);
  assert.equal((await anon.get('/api/me/sessions')).status, 401);
  assert.equal((await anon.get('/api/coach/sessions')).status, 401);
  const m = await member(DEMO.member);
  assert.equal((await m.get('/api/coach/sessions')).status, 403);
  assert.equal((await m.get('/api/admin/sessions')).status, 403);
  assert.equal((await m.post('/api/coach/sessions', { kind: 'group_class', title: 'Nope', audience: 'members', ...slot(3, 600) })).status, 403);
  const c = await coach(DEMO.coach);
  assert.equal((await c.get('/api/admin/sessions')).status, 403);
  assert.equal((await c.get('/api/me/sessions')).status, 403, 'a coach has no member registrations');

  const a = await admin();
  const adminId = userId(h.ctx, DEMO.admin);
  const ownerCtx = as(DEMO.owner);
  setUserPermission(ownerCtx, adminId, 'sessions.manage', false, 'test: revoke');
  try {
    const refused = await a.get('/api/admin/sessions');
    assert.equal(refused.status, 403);
    assert.equal(code(refused), 'PERMISSION_DENIED');
    assert.equal(code(await a.post('/api/admin/sessions', { kind: 'webinar', title: 'Refused', audience: 'public', ...slot(5, 600) })), 'PERMISSION_DENIED');
  } finally { setUserPermission(ownerCtx, adminId, 'sessions.manage', true, 'test: restore'); }
  assert.equal((await a.get('/api/admin/sessions')).status, 200);
  setUserPermission(ownerCtx, adminId, 'members.manage', false, 'test: revoke');
  try { assert.equal(code(await a.get(`/api/admin/members/${userId(h.ctx, DEMO.member)}/sessions`)), 'PERMISSION_DENIED'); }
  finally { setUserPermission(ownerCtx, adminId, 'members.manage', true, 'test: restore'); }
  assert.equal((await a.get(`/api/admin/members/${userId(h.ctx, DEMO.member)}/sessions`)).status, 200);
  assert.equal((await a.get(`/api/admin/members/${userId(h.ctx, DEMO.coach)}/sessions`)).status, 404, 'a coach id is not a member record');

  h.db.run("UPDATE feature_flags SET enabled = 0 WHERE key = 'sessions'");
  try {
    assert.equal(code(await m.get('/api/me/sessions')), 'FEATURE_DISABLED');
    assert.equal(code(await c.get('/api/coach/sessions')), 'FEATURE_DISABLED');
    assert.equal(code(await a.get('/api/admin/sessions')), 'FEATURE_DISABLED');
    assert.equal(code(await anon.get('/api/public/webinars')), 'FEATURE_DISABLED');
    assert.ok(!((await m.get('/api/public/config')).json.features as string[]).includes('sessions'));
  } finally { h.db.run("UPDATE feature_flags SET enabled = 1 WHERE key = 'sessions'"); }
  assert.ok(((await m.get('/api/public/config')).json.features as string[]).includes('sessions'));
});

test('capacity and the waitlist: a full session waitlists, a cancellation promotes the person who waited longest', async () => {
  const { c, id } = await hostedSession(DEMO.coach, { title: 'Test · Capacity one', capacity: 1 });
  const ananya = await member(DEMO.member), priya = await member(PRIYA), vikram = await member(DEMO.member2);
  const first = await ananya.post(`/api/me/sessions/${id}/register`);
  assert.equal(first.status, 201, JSON.stringify(first.json));
  assert.equal((first.json.myRegistration as { status: string }).status, 'registered');
  const second = await priya.post(`/api/me/sessions/${id}/register`);
  assert.deepEqual([(second.json.myRegistration as { status: string }).status, (second.json.myRegistration as { waitlistPosition: number }).waitlistPosition], ['waitlisted', 1]);
  assert.equal(second.json.full, true);
  assert.equal(second.json.joinUrl, null, 'no join link while waiting');
  const third = await vikram.post(`/api/me/sessions/${id}/register`);
  assert.equal((third.json.myRegistration as { waitlistPosition: number }).waitlistPosition, 2);
  const again = await priya.post(`/api/me/sessions/${id}/register`);
  assert.equal((again.json.myRegistration as { waitlistPosition: number }).waitlistPosition, 1, 'registering again keeps the place in the queue');
  assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM session_registrations WHERE session_id = ?', [id])!.n, 3);
  assert.ok(notes(PRIYA, 'session').some((n) => n.title === 'You are on the waitlist'));

  const cancelled = await ananya.post(`/api/me/sessions/${id}/cancel`, { reason: 'test: something came up' });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.json));
  assert.equal(cancelled.json.myRegistration, null);
  assert.equal(regStatus(id, PRIYA), 'registered', 'the first on the waitlist is promoted');
  assert.equal(regStatus(id, DEMO.member2), 'waitlisted');
  assert.ok(notes(PRIYA, 'session').some((n) => n.title === 'A place opened up'));
  assert.equal(((await vikram.get(`/api/me/sessions/${id}`)).json.myRegistration as { waitlistPosition: number }).waitlistPosition, 1);
  assert.equal(code(await ananya.post(`/api/me/sessions/${id}/cancel`, {})), 'NOT_FOUND', 'nothing left to cancel');

  // more capacity promotes the next person
  const more = await c.patch(`/api/coach/sessions/${id}`, { capacity: 3, reason: 'test: bigger room' });
  assert.equal(more.status, 200, JSON.stringify(more.json));
  assert.equal(regStatus(id, DEMO.member2), 'registered');
  // and the capacity cannot drop below the places held
  assert.equal(stateCode(await c.patch(`/api/coach/sessions/${id}`, { capacity: 1 })), 'CAPACITY_BELOW_REGISTERED');

  const reg = auditRows('session.register', id);
  assert.equal(reg.length, 3);
  for (const r of reg) assert.equal(r.actor_role, 'member');
  const cancel = auditRows('session.cancel', id);
  assert.equal(cancel.length, 1);
  assert.equal(cancel[0]!.actor_id, userId(h.ctx, DEMO.member));
  assert.equal(cancel[0]!.reason, 'test: something came up');
  assert.equal((JSON.parse(cancel[0]!.data) as { promoted: string[] }).promoted.length, 1);
  assert.equal(auditRows('live_session.create', id)[0]!.actor_id, userId(h.ctx, DEMO.coach));
  assert.equal(auditRows('live_session.publish', id).length, 1);
  assert.equal(auditRows('live_session.update', id)[0]!.reason, 'test: bigger room');
});

test('eligibility by package: only members of the chosen packages see and join; members-only sessions need a live programme', async () => {
  const a = await admin();
  const created = await a.post('/api/admin/sessions', { kind: 'workshop', title: 'Test · Core members only', audience: 'packages', packageIds: ['core'], hostId: userId(h.ctx, DEMO.coach), ...slot(6, 17 * 60) });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const id = created.json.id as string;
  assert.equal(created.json.hostId, userId(h.ctx, DEMO.coach));
  const ananya = await member(DEMO.member), vikram = await member(DEMO.member2);
  assert.equal((await ananya.get(`/api/me/sessions/${id}`)).status, 404, 'a draft is invisible to members');
  assert.equal((await ananya.post(`/api/me/sessions/${id}/register`)).status, 404);
  assert.equal((await a.post(`/api/admin/sessions/${id}/publish`)).status, 200);

  const list = await ananya.get('/api/me/sessions');
  assert.ok((list.json.items as Array<{ id: string }>).some((s) => s.id === id), 'a Core member sees it');
  assert.ok(!((await vikram.get('/api/me/sessions')).json.items as Array<{ id: string }>).some((s) => s.id === id), 'an Advanced member does not');
  assert.equal((await vikram.get(`/api/me/sessions/${id}`)).status, 404);
  const refused = await vikram.post(`/api/me/sessions/${id}/register`);
  assert.equal(refused.status, 403);
  assert.equal(code(refused), 'NOT_ELIGIBLE');
  assert.equal((await ananya.post(`/api/me/sessions/${id}/register`)).status, 201);

  // members-only: someone without a live programme cannot join
  const { id: open } = await hostedSession(DEMO.coach, { title: 'Test · Members with a programme' });
  const ishaan = await member(DEMO.memberIncomplete).catch(() => null);
  if (ishaan) assert.equal(code(await ishaan.post(`/api/me/sessions/${open}/register`)), 'NOT_ELIGIBLE');
  else assert.equal(domain.eligible(h.ctx, { audience: 'members', package_ids: '[]' }, userId(h.ctx, DEMO.memberIncomplete)), false);
  assert.equal(domain.eligible(h.ctx, { audience: 'members', package_ids: '[]' }, userId(h.ctx, DEMO.member)), true);
});

test('cancelling a session notifies everyone registered or waiting, withdraws their reminders, and needs a reason', async () => {
  const { c, id } = await hostedSession(DEMO.coach, { title: 'Test · To be cancelled', capacity: 1 });
  const ananya = await member(DEMO.member), priya = await member(PRIYA);
  await ananya.post(`/api/me/sessions/${id}/register`);
  await priya.post(`/api/me/sessions/${id}/register`);
  domain.runReminderJob({ ...h.ctx, now: () => new Date(Date.parse(h.db.get<{ start_at: string }>('SELECT start_at FROM live_sessions WHERE id = ?', [id])!.start_at) - 20 * 3_600_000).toISOString() });
  assert.ok(h.db.get("SELECT 1 FROM reminders WHERE ref_type = 'live_session' AND ref_id = ? AND status = 'queued'", [id]), 'a reminder was queued');

  assert.equal(code(await c.post(`/api/coach/sessions/${id}/cancel`, {})), 'VALIDATION_FAILED', 'a reason is required');
  const before = { ananya: notes(DEMO.member, 'session').length, priya: notes(PRIYA, 'session').length };
  const r = await c.post(`/api/coach/sessions/${id}/cancel`, { reason: 'Test: the room is unavailable' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.status, 'cancelled');
  const a1 = notes(DEMO.member, 'session'), p1 = notes(PRIYA, 'session');
  assert.equal(a1.length, before.ananya + 1);
  assert.equal(p1.length, before.priya + 1, 'the person waiting is told too');
  assert.match(a1.at(-1)!.body, /was cancelled\. Test: the room is unavailable/);
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM reminders WHERE ref_type = 'live_session' AND ref_id = ? AND status = 'queued'", [id])!.n, 0, 'queued reminders are withdrawn');
  const row = auditRows('live_session.cancel', id)[0]!;
  assert.equal(row.reason, 'Test: the room is unavailable');
  assert.equal((JSON.parse(row.data) as { notified: number }).notified, 2);
  assert.equal(code(await ananya.post(`/api/me/sessions/${id}/register`)), 'INVALID_STATE');
  assert.equal(code(await c.post(`/api/coach/sessions/${id}/publish`)), 'INVALID_STATE');
  const mine = await ananya.get('/api/me/sessions');
  assert.ok((mine.json.history as Array<{ id: string; status: string; cancelledReason: string }>).some((s) => s.id === id && s.status === 'cancelled' && s.cancelledReason === 'Test: the room is unavailable'));
});

test('.ics files: times in IST, CRLF lines, only for the person, and no link nobody typed', async () => {
  const when = slot(5, 18 * 60 + 30, 45);
  const { id } = await hostedSession(DEMO.coach, { title: 'Test · Calendar, with commas; and a semicolon', capacity: 1, ...when });
  const ananya = await member(DEMO.member), priya = await member(PRIYA);
  await ananya.post(`/api/me/sessions/${id}/register`);
  await priya.post(`/api/me/sessions/${id}/register`); // waitlisted
  const r = await ananya.get(`/api/me/sessions/${id}/ics`);
  assert.equal(r.status, 200);
  assert.match(String(r.headers['content-type']), /^text\/calendar/);
  assert.match(String(r.headers['content-disposition']), /^attachment; filename="bioptime-group-class-\d{4}-\d{2}-\d{2}\.ics"$/);
  assert.equal(r.headers['cache-control'], 'no-store');
  const ymd = istDay(5).replace(/-/g, '');
  assert.ok(r.text.includes(`DTSTART;TZID=Asia/Kolkata:${ymd}T183000\r\n`), r.text);
  assert.ok(r.text.includes(`DTEND;TZID=Asia/Kolkata:${ymd}T191500\r\n`));
  assert.ok(r.text.includes('TZOFFSETTO:+0530'));
  assert.ok(r.text.includes('SUMMARY:Group class: Test · Calendar\\, with commas\\; and a semicolon'));
  assert.ok(r.text.includes('Your coach will share how to join.'));
  assert.ok(!/^URL:/m.test(r.text), 'no join link is invented');
  assert.ok(r.text.split('\r\n').every((l) => Buffer.byteLength(l) <= 75), 'lines are folded at 75 octets');
  assert.ok(!r.text.includes('@demo.bioptime.test'), 'no email address');
  assert.equal(code(await priya.get(`/api/me/sessions/${id}/ics`)), 'INVALID_STATE', 'the waitlist gets no calendar file');

  // a consultation's file, in IST, for its own member only
  const apt = h.db.get<{ id: string; start_at: string }>("SELECT id, start_at FROM appointments WHERE member_id = ? AND status = 'scheduled' ORDER BY start_at LIMIT 1", [userId(h.ctx, DEMO.member)])!;
  const f = await ananya.get(`/api/me/appointments/${apt.id}/ics`);
  assert.equal(f.status, 200);
  const local = new Date(Date.parse(apt.start_at) + 330 * 60_000).toISOString().replace(/[-:]/g, '').slice(0, 15);
  assert.ok(f.text.includes(`DTSTART;TZID=Asia/Kolkata:${local}\r\n`), f.text);
  assert.ok(f.text.includes('Your coach will share how to join.'));
  assert.equal((await priya.get(`/api/me/appointments/${apt.id}/ics`)).status, 404, 'another member’s consultation');
  assert.equal((await (await coach(DEMO.coach2)).get(`/api/coach/appointments/${apt.id}/ics`)).status, 404, 'another coach’s consultation');
  assert.equal((await (await coach(DEMO.coach)).get(`/api/coach/appointments/${apt.id}/ics`)).status, 200);

  // the helpers
  assert.equal(icsEscape('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
  const folded = foldLine(`DESCRIPTION:${'ह'.repeat(60)}`);
  for (const l of folded.split('\r\n')) assert.ok(Buffer.byteLength(l) <= 75);
  assert.equal(folded.split('\r\n ').join(''), `DESCRIPTION:${'ह'.repeat(60)}`, 'folding never splits a character');
});

test('consultations: the placeholder link is never returned; the coach types an https link and the member sees it', async () => {
  const memberId = userId(h.ctx, DEMO.member);
  const apt = h.db.get<{ id: string }>("SELECT id FROM appointments WHERE member_id = ? AND status = 'scheduled' ORDER BY start_at LIMIT 1", [memberId])!;
  // an old row with the placeholder (written before migration 0016) is never shown
  h.db.run('UPDATE appointments SET meeting_link = ? WHERE id = ?', [`https://meet.bioptime.example/${apt.id}`, apt.id]);
  const ananya = await member(DEMO.member);
  const shown = (await ananya.get('/api/me/appointments?range=upcoming')).json.items as Array<{ id: string; meetingLink: string | null; meetingProvider: string }>;
  assert.equal(shown.find((a) => a.id === apt.id)!.meetingLink, null);
  assert.ok(!JSON.stringify(shown).includes('meet.bioptime.example'));

  const c = await coach(DEMO.coach);
  assert.equal(code(await c.patch(`/api/coach/appointments/${apt.id}/meeting`, { joinUrl: 'http://meet.example.org/abc' })), 'JOIN_URL_INVALID');
  assert.equal(code(await c.patch(`/api/coach/appointments/${apt.id}/meeting`, { joinUrl: 'javascript:alert(1)' })), 'JOIN_URL_INVALID');
  assert.equal(code(await c.patch(`/api/coach/appointments/${apt.id}/meeting`, { joinUrl: 'https://user:pw@meet.example.org/abc' })), 'JOIN_URL_INVALID');
  assert.equal(code(await c.patch(`/api/coach/appointments/${apt.id}/meeting`, { joinUrl: `https://meet.bioptime.example/${apt.id}` })), 'JOIN_URL_INVALID');
  assert.equal(code(await c.patch(`/api/coach/appointments/${apt.id}/meeting`, {})), 'VALIDATION_FAILED');
  assert.equal((await (await coach(DEMO.coach2)).patch(`/api/coach/appointments/${apt.id}/meeting`, { joinUrl: 'https://meet.example.org/x' })).status, 404, 'another coach’s consultation');
  const set = await c.patch(`/api/coach/appointments/${apt.id}/meeting`, { joinUrl: 'https://meet.example.org/abc-defg?pwd=secret' });
  assert.equal(set.status, 200, JSON.stringify(set.json));
  assert.equal(set.json.meetingLink, 'https://meet.example.org/abc-defg?pwd=secret');
  const seen = ((await ananya.get('/api/me/appointments?range=upcoming')).json.items as Array<{ id: string; meetingLink: string | null }>).find((a) => a.id === apt.id)!;
  assert.equal(seen.meetingLink, 'https://meet.example.org/abc-defg?pwd=secret');
  assert.ok(notes(DEMO.member, 'appointment').some((n) => n.title === 'How to join your consultation'));
  const row = auditRows('appointment.meeting_set', apt.id).at(-1)!;
  assert.equal(row.actor_id, userId(h.ctx, DEMO.coach));
  assert.ok(!row.data.includes('secret') && !row.data.includes('abc-defg'), 'the link itself (it can carry a passcode) is not in the audit log');
  assert.equal(JSON.parse(row.data).host, 'meet.example.org');
  const cleared = await c.patch(`/api/coach/appointments/${apt.id}/meeting`, { joinUrl: null });
  assert.equal(cleared.json.meetingLink, null);

  // booking and confirming through the provider seam ("none") creates no link
  const vikramId = userId(h.ctx, DEMO.member2);
  const rahul = await coach(DEMO.coach2);
  const req = h.db.get<{ id: string }>("SELECT id FROM appointments WHERE member_id = ? AND status = 'scheduled' LIMIT 1", [vikramId]);
  if (req) {
    h.db.run("UPDATE appointments SET status = 'requested', meeting_link = NULL WHERE id = ?", [req.id]);
    const confirmed = await rahul.post(`/api/coach/appointments/${req.id}/confirm`);
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
    assert.equal(confirmed.json.meetingLink, null);
    assert.equal(confirmed.json.meetingProvider, 'none');
    assert.match(notes(DEMO.member2, 'appointment').at(-1)!.body, /Your coach will share how to join\./);
  }
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM appointments WHERE meeting_link LIKE '%meet.bioptime.example%' AND id != ?", [apt.id])!.n, 0);
});

test('join links with a line break, a tab, a space or a control character are refused, and a calendar file never carries an injected line', async () => {
  const INJECTED = 'https://meet.example.org/abc\r\nATTACH:https://evil.example/x\r\nX-INJECTED:1';
  const bad = [INJECTED, 'https://meet.example.org/abc\nX-INJECTED:1', 'https://meet.example.org/abc\rX-INJECTED:1', 'https://meet.example.org/a\tb', 'https://meet.example.org/a b', 'https://meet.example.org/a\u2028X-INJECTED:1', 'https://meet.example.org/a\u0000b', 'https://meet.example.org/a\u0085b'];
  const c = await coach(DEMO.coach);
  const when = slot(6, 17 * 60);
  for (const joinUrl of bad) assert.equal(code(await c.post('/api/coach/sessions', { kind: 'group_class', title: 'Test · Link check', audience: 'members', ...when, joinUrl })), 'JOIN_URL_INVALID', JSON.stringify(joinUrl));
  const { id } = await hostedSession(DEMO.coach, { title: 'Test · Link check', ...when });
  for (const joinUrl of bad) assert.equal(code(await c.patch(`/api/coach/sessions/${id}`, { joinUrl })), 'JOIN_URL_INVALID', JSON.stringify(joinUrl));
  const a = await admin();
  assert.equal(code(await a.patch(`/api/admin/sessions/${id}`, { joinUrl: INJECTED })), 'JOIN_URL_INVALID');
  assert.equal(code(await a.post('/api/admin/sessions', { kind: 'webinar', title: 'Test · Link check', audience: 'public', ...slot(6, 19 * 60), joinUrl: INJECTED })), 'JOIN_URL_INVALID');
  const apt = h.db.get<{ id: string }>("SELECT id FROM appointments WHERE member_id = ? AND coach_id = ? AND status = 'scheduled' ORDER BY start_at LIMIT 1", [userId(h.ctx, DEMO.member), userId(h.ctx, DEMO.coach)])!;
  for (const joinUrl of bad) assert.equal(code(await c.patch(`/api/coach/appointments/${apt.id}/meeting`, { joinUrl })), 'JOIN_URL_INVALID', JSON.stringify(joinUrl));
  assert.equal(h.db.get<{ join_url: string | null }>('SELECT join_url FROM live_sessions WHERE id = ?', [id])!.join_url, null, 'nothing was stored');
  assert.equal(h.db.get<{ meeting_link: string | null }>('SELECT meeting_link FROM appointments WHERE id = ?', [apt.id])!.meeting_link, null, 'nothing was stored');
  // an accepted link is stored in its normal form
  const set = await c.patch(`/api/coach/sessions/${id}`, { joinUrl: 'https://Meet.Example.org' });
  assert.equal(set.status, 200, JSON.stringify(set.json));
  assert.equal(set.json.joinUrl, 'https://meet.example.org/');

  // a value with a line break that reached the database some other way is never shown and never written into a file
  const ananya = await member(DEMO.member);
  assert.equal((await ananya.post(`/api/me/sessions/${id}/register`)).status, 201);
  h.db.run('UPDATE live_sessions SET join_url = ? WHERE id = ?', [INJECTED, id]);
  h.db.run('UPDATE appointments SET meeting_link = ? WHERE id = ?', [INJECTED, apt.id]);
  try {
    assert.equal((await ananya.get(`/api/me/sessions/${id}`)).json.joinUrl, null);
    assert.equal((await c.get(`/api/coach/sessions/${id}`)).json.joinUrl, null);
    const appts = (await ananya.get('/api/me/appointments?range=upcoming')).json.items as Array<{ id: string; meetingLink: string | null }>;
    assert.equal(appts.find((x) => x.id === apt.id)!.meetingLink, null);
    const files = [await ananya.get(`/api/me/sessions/${id}/ics`), await ananya.get(`/api/me/appointments/${apt.id}/ics`), await c.get(`/api/coach/sessions/${id}/ics`), await c.get(`/api/coach/appointments/${apt.id}/ics`)];
    for (const f of files) {
      assert.equal(f.status, 200);
      assert.ok(!f.text.includes('X-INJECTED') && !f.text.includes('ATTACH') && !f.text.includes('evil.example'), f.text);
      assert.ok(!/^URL:/m.test(f.text), 'no URL line');
      assert.ok(f.text.split('\r\n').slice(0, -1).every((l) => /^([A-Z-]+[;:]| )/.test(l)), 'every line is a property or a folded continuation');
    }
  } finally {
    h.db.run('UPDATE live_sessions SET join_url = NULL WHERE id = ?', [id]);
    h.db.run('UPDATE appointments SET meeting_link = NULL WHERE id = ?', [apt.id]);
  }
  // the calendar helper leaves such a value out by itself, and writes a clean one
  const ev = { uid: 'test@bioptime', title: 'Test', startAt: when.startAt, endAt: when.endAt };
  const dirty = icsCalendar([{ ...ev, url: INJECTED }], new Date().toISOString());
  assert.ok(!dirty.includes('X-INJECTED') && !/^URL:/m.test(dirty));
  assert.ok(icsCalendar([{ ...ev, url: 'https://meet.example.org/ok' }], new Date().toISOString()).includes('\r\nURL:https://meet.example.org/ok\r\n'));
});

test('a coach cannot read or change another host’s session, and sees registrants’ names only', async () => {
  const { c: asha, id } = await hostedSession(DEMO.coach, { title: 'Test · Asha hosts' });
  const ananya = await member(DEMO.member), vikram = await member(DEMO.member2);
  await ananya.post(`/api/me/sessions/${id}/register`);
  await vikram.post(`/api/me/sessions/${id}/register`);
  assert.equal((await ananya.get(`/api/me/sessions/${id}`)).json.howToJoin, 'Your coach will share how to join.', 'the host is her coach');
  assert.equal((await vikram.get(`/api/me/sessions/${id}`)).json.howToJoin, 'Asha Menon will share how to join.', 'the host is not his coach: named, never "your coach"');
  const rahul = await coach(DEMO.coach2);
  assert.equal((await rahul.get(`/api/coach/sessions/${id}/registrations`)).status, 404);
  assert.equal((await rahul.get(`/api/coach/sessions/${id}`)).status, 404);
  assert.equal((await rahul.patch(`/api/coach/sessions/${id}`, { title: 'Taken over' })).status, 404);
  assert.equal((await rahul.post(`/api/coach/sessions/${id}/cancel`, { reason: 'not mine' })).status, 404);
  assert.equal((await rahul.post(`/api/coach/sessions/${id}/attendance`, { marks: [{ registrationId: 'lsr_x', status: 'attended' }] })).status, 404);
  assert.equal((await rahul.get(`/api/coach/sessions/${id}/ics`)).status, 404);
  assert.ok(!((await rahul.get('/api/coach/sessions')).json.items as Array<{ id: string }>).some((s) => s.id === id));

  const regs = await asha.get(`/api/coach/sessions/${id}/registrations`);
  assert.equal(regs.status, 200);
  const items = regs.json.items as Array<{ name: string; clientId: string | null; source: string }>;
  assert.equal(items.length, 2);
  assert.deepEqual(findRestrictedFields(regs.json, restrictedKeys()), []);
  assert.ok(!regs.text.includes('@'), 'no email address');
  assert.equal(items.find((r) => r.name === 'Ananya Rao')!.clientId, userId(h.ctx, DEMO.member), 'her own client can be opened');
  assert.equal(items.find((r) => r.name === 'Vikram Shetty')!.clientId, null, 'someone else’s client stays a name');

  // the public webinar the team hosts: a coach is not its host, the administrators see the visitor's email
  const webinar = h.db.get<{ id: string }>("SELECT id FROM live_sessions WHERE audience = 'public' AND title = 'Getting started with Bioptime'")!.id;
  assert.equal((await asha.get(`/api/coach/sessions/${webinar}/registrations`)).status, 404);
  const a = await admin();
  const adminView = await a.get(`/api/admin/sessions/${webinar}`);
  assert.equal(adminView.status, 200);
  assert.ok((adminView.json.registrations as Array<{ email: string | null; source: string }>).some((r) => r.source === 'public' && r.email === 'kavya.nambiar@demo.bioptime.test'));
  // a coach cannot set up a public webinar
  assert.equal(code(await asha.post('/api/coach/sessions', { kind: 'webinar', title: 'Test · Public by a coach', audience: 'public', ...slot(8, 600) })), 'VALIDATION_FAILED');
  const draft = await asha.post('/api/coach/sessions', { kind: 'webinar', title: 'Test · Members webinar', audience: 'members', ...slot(8, 600) });
  assert.equal(code(await asha.patch(`/api/coach/sessions/${draft.json.id}`, { audience: 'public' })), 'VALIDATION_FAILED');
  assert.equal((await asha.post('/api/coach/sessions', { kind: 'group_class', title: 'Test · Hosted for someone else', audience: 'members', hostId: userId(h.ctx, DEMO.coach2), ...slot(8, 700) })).status, 201);
  assert.equal(h.db.get<{ host_id: string }>("SELECT host_id FROM live_sessions WHERE title = 'Test · Hosted for someone else'")!.host_id, userId(h.ctx, DEMO.coach), 'a coach always hosts their own sessions');
});

test('validation: times, capacity, audience, packages, join links and closed sessions', async () => {
  const c = await coach(DEMO.coach);
  const base = { kind: 'group_class', title: 'Test · Validation', audience: 'members' };
  const past = { startAt: new Date(Date.now() - 3_600_000).toISOString(), endAt: new Date(Date.now() - 600_000).toISOString() };
  assert.equal(code(await c.post('/api/coach/sessions', { ...base, ...past })), 'SESSION_IN_PAST');
  const s = slot(4, 600);
  assert.equal(code(await c.post('/api/coach/sessions', { ...base, startAt: s.endAt, endAt: s.startAt })), 'SESSION_TIME_INVALID');
  assert.equal(code(await c.post('/api/coach/sessions', { ...base, ...slot(4, 600, 9 * 60) })), 'SESSION_TIME_INVALID');
  assert.equal(code(await c.post('/api/coach/sessions', { ...base, ...s, capacity: 0 })), 'VALIDATION_FAILED');
  assert.equal(code(await c.post('/api/coach/sessions', { ...base, ...s, title: 'x' })), 'VALIDATION_FAILED');
  assert.equal(code(await c.post('/api/coach/sessions', { ...base, ...s, kind: 'seminar' })), 'VALIDATION_FAILED');
  assert.equal(code(await c.post('/api/coach/sessions', { ...base, ...s, startAt: 'tomorrow' })), 'VALIDATION_FAILED');
  assert.equal(code(await c.post('/api/coach/sessions', { ...base, ...s, audience: 'packages' })), 'AUDIENCE_INVALID');
  assert.equal(code(await c.post('/api/coach/sessions', { ...base, ...s, audience: 'packages', packageIds: ['no-such-package'] })), 'AUDIENCE_INVALID');
  assert.equal(code(await c.post('/api/coach/sessions', { ...base, ...s, packageIds: ['core'] })), 'AUDIENCE_INVALID', 'packages only with the packages audience');
  assert.equal(code(await c.post('/api/coach/sessions', { ...base, ...s, joinUrl: 'http://example.org/room' })), 'JOIN_URL_INVALID');
  const ok = await c.post('/api/coach/sessions', { ...base, ...s, joinUrl: 'https://meet.example.org/room-1' });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.equal(ok.json.joinUrl, 'https://meet.example.org/room-1');
  const createRow = auditRows('live_session.create', ok.json.id as string)[0]!;
  assert.ok(!createRow.data.includes('room-1'), 'the join link is not in the audit log');
  const id = ok.json.id as string;
  await c.post(`/api/coach/sessions/${id}/publish`);
  assert.equal(code(await c.post(`/api/coach/sessions/${id}/publish`)), 'INVALID_STATE');
  assert.equal(stateCode(await c.patch(`/api/coach/sessions/${id}`, { audience: 'packages', packageIds: ['core'] })), 'AUDIENCE_LOCKED', 'who can join is fixed once published');
  assert.equal(stateCode(await c.post(`/api/coach/sessions/${id}/complete`)), 'SESSION_NOT_STARTED');
  assert.equal(code(await c.post(`/api/coach/sessions/${id}/attendance`, { marks: [] })), 'VALIDATION_FAILED');

  // moving a published session tells registrants and re-times their reminders
  const ananya = await member(DEMO.member);
  await ananya.post(`/api/me/sessions/${id}/register`);
  const regView = await ananya.get(`/api/me/sessions/${id}`);
  assert.equal(regView.json.joinUrl, 'https://meet.example.org/room-1', 'a registered member sees the link the host typed');
  const moved = await c.patch(`/api/coach/sessions/${id}`, { ...slot(5, 660), reason: 'test: room moved' });
  assert.equal(moved.status, 200, JSON.stringify(moved.json));
  assert.ok(notes(DEMO.member, 'session').some((n) => n.title === 'Group class moved'));
  assert.deepEqual(JSON.parse(auditRows('live_session.update', id).at(-1)!.data).changed, ['time']);
});

test('attendance once the session has started, then completion', async () => {
  const { c, id } = await hostedSession(DEMO.coach, { title: 'Test · Attendance', capacity: 2 });
  const ananya = await member(DEMO.member), priya = await member(PRIYA), sameer = await member(SAMEER);
  await ananya.post(`/api/me/sessions/${id}/register`);
  await priya.post(`/api/me/sessions/${id}/register`);
  await sameer.post(`/api/me/sessions/${id}/register`); // waitlisted
  const regs = (await c.get(`/api/coach/sessions/${id}/registrations`)).json.items as Array<{ id: string; name: string; status: string }>;
  const rid = (name: string) => regs.find((r) => r.name === name)!.id;
  assert.equal(code(await c.post(`/api/coach/sessions/${id}/attendance`, { marks: [{ registrationId: rid('Ananya Rao'), status: 'attended' }] })), 'INVALID_STATE', 'not before it starts');
  h.db.run('UPDATE live_sessions SET start_at = ?, end_at = ? WHERE id = ?', [new Date(Date.now() - 3_600_000).toISOString(), new Date(Date.now() - 900_000).toISOString(), id]);
  assert.equal(code(await ananya.post(`/api/me/sessions/${id}/cancel`, {})), 'INVALID_STATE', 'no cancelling once it has started');
  assert.equal(code(await c.post(`/api/coach/sessions/${id}/attendance`, { marks: [{ registrationId: rid('Sameer Khan'), status: 'attended' }] })), 'INVALID_STATE', 'the waitlist did not hold a place');
  assert.equal(code(await c.post(`/api/coach/sessions/${id}/attendance`, { marks: [{ registrationId: 'lsr_nope', status: 'attended' }] })), 'NOT_FOUND');
  const marked = await c.post(`/api/coach/sessions/${id}/attendance`, { marks: [{ registrationId: rid('Ananya Rao'), status: 'attended' }, { registrationId: rid('Priya Nair'), status: 'no_show' }] });
  assert.equal(marked.status, 200, JSON.stringify(marked.json));
  assert.deepEqual([regStatus(id, DEMO.member), regStatus(id, PRIYA), regStatus(id, SAMEER)], ['attended', 'no_show', 'waitlisted']);
  assert.deepEqual(findRestrictedFields(marked.json, restrictedKeys()), []);
  const row = auditRows('session.attendance', id)[0]!;
  assert.equal(row.actor_id, userId(h.ctx, DEMO.coach));
  assert.deepEqual({ attended: JSON.parse(row.data).attended, noShow: JSON.parse(row.data).noShow }, { attended: 1, noShow: 1 });
  const done = await c.post(`/api/coach/sessions/${id}/complete`);
  assert.equal(done.status, 200);
  assert.equal(done.json.status, 'completed');
  assert.equal(auditRows('live_session.complete', id).length, 1);
  const hist = (await ananya.get('/api/me/sessions')).json.history as Array<{ id: string; myRegistration: { status: string } }>;
  assert.equal(hist.find((s) => s.id === id)!.myRegistration.status, 'attended');
});

test('consultation follow-through: a summary for the member, a private note and follow-ups, after completion, once', async () => {
  const memberId = userId(h.ctx, DEMO.member);
  const apt = h.db.get<{ id: string; start_at: string }>("SELECT id, start_at FROM appointments WHERE member_id = ? AND coach_id = ? AND status = 'scheduled' ORDER BY start_at LIMIT 1", [memberId, userId(h.ctx, DEMO.coach)])!;
  const asha = await coach(DEMO.coach);
  const body = { forMember: 'Test summary: we agreed on two evening walks a week and an earlier bedtime.', privateNote: 'Test private note: ask about travel next time.', followUps: [{ title: 'Test follow-up: check the walks', detail: 'after a week' }, { title: 'Test follow-up: send the sleep article' }] };
  assert.equal(code(await asha.post(`/api/coach/appointments/${apt.id}/summary`, body)), 'INVALID_STATE', 'only after the consultation is completed');
  assert.equal((await asha.post(`/api/coach/appointments/${apt.id}/complete`, { note: 'test' })).status, 200);
  assert.equal(code(await asha.post(`/api/coach/appointments/${apt.id}/summary`, { ...body, forMember: 'short' })), 'VALIDATION_FAILED');
  assert.equal(code(await asha.post(`/api/coach/appointments/${apt.id}/summary`, { ...body, followUps: Array.from({ length: 11 }, (_, i) => ({ title: `Follow-up ${i}` })) })), 'VALIDATION_FAILED');
  assert.equal((await (await coach(DEMO.coach2)).post(`/api/coach/appointments/${apt.id}/summary`, body)).status, 404, 'another coach’s consultation');
  assert.equal((await (await member(DEMO.member)).post(`/api/coach/appointments/${apt.id}/summary`, body)).status, 403);

  const r = await asha.post(`/api/coach/appointments/${apt.id}/summary`, body);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.deepEqual(findRestrictedFields(r.json, restrictedKeys()), []);
  assert.equal((r.json.summary as { body: string }).body, body.forMember);
  assert.equal((r.json.privateNotes as unknown[]).length, 1);
  assert.equal((r.json.followUps as Array<{ status: string }>).length, 2);
  const tasks = h.db.all<{ kind: string; owner_id: string; ref_type: string; status: string }>("SELECT kind, owner_id, ref_type, status FROM support_tasks WHERE ref_type = 'appointment' AND ref_id = ?", [apt.id]);
  assert.equal(tasks.length, 2);
  for (const t of tasks) assert.deepEqual({ ...t }, { kind: 'coach_follow_up', owner_id: userId(h.ctx, DEMO.coach), ref_type: 'appointment', status: 'open' });
  assert.equal(code(await asha.post(`/api/coach/appointments/${apt.id}/summary`, body)), 'SUMMARY_EXISTS');
  const audit = auditRows('appointment.summary', apt.id);
  assert.equal(audit.length, 1);
  assert.equal(audit[0]!.actor_id, userId(h.ctx, DEMO.coach));
  assert.ok(!audit[0]!.data.includes('walks'), 'the summary text is not copied into the audit log');

  // the member reads the summary, never the private note; the notification carries no detail off the app
  const ananya = await member(DEMO.member);
  const mine = (await ananya.get('/api/me/consultation-summaries')).json.items as Array<{ appointmentId: string; body: string }>;
  assert.equal(mine.find((s) => s.appointmentId === apt.id)!.body, body.forMember);
  assert.ok(!JSON.stringify((await ananya.get('/api/me/notes')).json).includes('Test private note'));
  assert.ok(notes(DEMO.member, 'appointment').some((n) => /summary/.test(n.title)));
  const mail = h.db.get<{ body: string }>("SELECT o.body FROM outbox_messages o JOIN notifications n ON n.id = o.notification_id WHERE n.user_id = ? AND n.category = 'appointment' AND o.channel = 'email' ORDER BY o.created_at DESC LIMIT 1", [memberId])!;
  assert.ok(!mail.body.includes('walks'), 'the email does not carry the summary');

  // the coach's follow-through list and the client record
  const ft = (await asha.get('/api/coach/consultation-follow-through')).json.items as Array<{ appointmentId: string; hasSummary: boolean; openFollowUps: number }>;
  assert.deepEqual((({ hasSummary, openFollowUps }) => ({ hasSummary, openFollowUps }))(ft.find((x) => x.appointmentId === apt.id)!), { hasSummary: true, openFollowUps: 2 });
  const rec = await asha.get(`/api/coach/clients/${memberId}/sessions`);
  assert.equal(rec.status, 200);
  assert.equal((rec.json.followUps as unknown[]).length >= 2, true);
  assert.deepEqual(findRestrictedFields(rec.json, restrictedKeys()), []);
  assert.equal((await asha.get(`/api/coach/clients/${userId(h.ctx, DEMO.member2)}/sessions`)).status, 403, 'not her client');
  const a = await admin();
  const adminRec = await a.get(`/api/admin/members/${memberId}/sessions`);
  assert.ok((adminRec.json.summaries as Array<{ appointmentId: string }>).some((s) => s.appointmentId === apt.id));
});

test('reminders: queued for registered members reminder_hours_before the start, sent through the reminders queue; visitors get a logged email', async () => {
  const { id } = await hostedSession(DEMO.coach, { title: 'Test · Reminder', capacity: 1 });
  const ananya = await member(DEMO.member), priya = await member(PRIYA);
  await ananya.post(`/api/me/sessions/${id}/register`);
  await priya.post(`/api/me/sessions/${id}/register`); // waitlisted: no reminder
  const start = h.db.get<{ start_at: string }>('SELECT start_at FROM live_sessions WHERE id = ?', [id])!.start_at;
  const early = { ...h.ctx, now: () => new Date(Date.parse(start) - 48 * 3_600_000).toISOString() };
  domain.runReminderJob(early);
  assert.equal(h.db.get("SELECT 1 FROM reminders WHERE ref_type = 'live_session' AND ref_id = ?", [id]), undefined, 'not 48 hours ahead');
  const inWindow = { ...h.ctx, now: () => new Date(Date.parse(start) - 23.9 * 3_600_000).toISOString() };
  domain.runReminderJob(inWindow);
  const rows = h.db.all<{ user_id: string; category: string; channels: string; due_at: string }>("SELECT user_id, category, channels, due_at FROM reminders WHERE ref_type = 'live_session' AND ref_id = ?", [id]);
  assert.deepEqual(rows.map((r) => r.user_id).sort(), [userId(h.ctx, DEMO.member), userId(h.ctx, DEMO.coach)].sort(), 'the registered member and the host, not the waitlist');
  assert.equal(rows.find((r) => r.user_id === userId(h.ctx, DEMO.member))!.due_at, new Date(Date.parse(start) - 24 * 3_600_000).toISOString());
  domain.runReminderJob(inWindow);
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM reminders WHERE ref_type = 'live_session' AND ref_id = ?", [id])!.n, 2, 'running again queues nothing twice');
  dispatchDue({ ...h.ctx, now: () => new Date(Date.parse(start) - 23.5 * 3_600_000).toISOString() });
  const sent = notes(DEMO.member, 'session_reminder');
  assert.ok(sent.some((n) => n.title === 'Group class coming up' && /Your coach will share how to join\./.test(n.body)), JSON.stringify(sent));

  // a visitor of a public webinar: one logged email when it is due
  const webinar = h.db.get<{ id: string; start_at: string }>("SELECT id, start_at FROM live_sessions WHERE audience = 'public' AND title = 'Getting started with Bioptime'")!;
  const due = { ...h.ctx, now: () => new Date(Date.parse(webinar.start_at) - 23 * 3_600_000).toISOString() };
  const out = domain.runReminderJob(due);
  assert.ok(out.logged >= 1);
  assert.ok(h.db.get("SELECT 1 FROM outbox_messages WHERE to_address = 'kavya.nambiar@demo.bioptime.test' AND subject = 'Webinar coming up'"));
  assert.equal(domain.runReminderJob(due).logged, 0, 'once');
});

test('public webinars: listed without join links or registrants; registration has a honeypot, keeps one row per email and is rate-limited', async () => {
  const p = await makeApp({ env: { RATE_LIMITS: 'on' } });
  try {
    const anon = client(p.app);
    const list = await anon.get('/api/public/webinars');
    assert.equal(list.status, 200, JSON.stringify(list.json));
    const items = list.json.items as Array<Record<string, unknown>>;
    assert.equal(items.length, 1);
    const w = items[0]!;
    assert.deepEqual(Object.keys(w).sort(), ['description', 'endAt', 'full', 'hostName', 'id', 'kind', 'kindLabel', 'sample', 'startAt', 'timezone', 'title'].sort());
    assert.equal(w.hostName, 'The Bioptime team', 'an administrator host is shown as the team');
    assert.ok(!list.text.includes('@'), 'no registrant detail');
    const before = p.db.get<{ n: number }>('SELECT COUNT(*) n FROM session_registrations')!.n;
    const trap = await anon.post(`/api/public/webinars/${w.id}/register`, { name: 'Bot', email: 'bot@example.org', website: 'http://spam.example' });
    assert.equal(trap.status, 202);
    assert.deepEqual(trap.json, { received: true });
    assert.equal(p.db.get<{ n: number }>('SELECT COUNT(*) n FROM session_registrations')!.n, before, 'the honeypot records nothing');
    const ok = await anon.post(`/api/public/webinars/${w.id}/register`, { name: 'Test Visitor', email: 'Test.Visitor@Example.org' });
    assert.equal(ok.status, 202, JSON.stringify(ok.json));
    assert.deepEqual(ok.json, { received: true }, 'the same answer as the honeypot: the details go by email');
    assert.equal(p.db.get<{ status: string }>("SELECT status FROM session_registrations WHERE email = 'test.visitor@example.org'")!.status, 'registered');
    const again = await anon.post(`/api/public/webinars/${w.id}/register`, { name: 'Test Visitor', email: 'test.visitor@example.org' });
    assert.equal(again.status, 202);
    assert.deepEqual(again.json, { received: true }, 'a repeat gets the same answer');
    assert.equal(p.db.get<{ n: number }>("SELECT COUNT(*) n FROM session_registrations WHERE email = 'test.visitor@example.org'")!.n, 1);
    assert.ok(p.db.get("SELECT 1 FROM outbox_messages WHERE to_address = 'test.visitor@example.org' AND channel = 'email'"), 'the confirmation is logged in the outbox');
    const audit = p.db.get<{ data: string; actor_role: string }>("SELECT data, actor_role FROM audit_events WHERE action = 'session.register' ORDER BY at DESC LIMIT 1")!;
    assert.equal(audit.actor_role, 'system');
    assert.ok(!audit.data.includes('example.org'), 'the email is not copied into the audit log');
    assert.equal(code(await anon.post(`/api/public/webinars/${w.id}/register`, { name: 'X', email: 'not-an-email' })), 'VALIDATION_FAILED');
    assert.equal((await anon.post(`/api/public/webinars/${w.id}/register`, { name: 'Fifth Try', email: 'fifth@example.org' })).status, 202);
    const limited = await anon.post(`/api/public/webinars/${w.id}/register`, { name: 'Sixth Try', email: 'sixth@example.org' });
    assert.equal(limited.status, 429, 'five a window per address');
    assert.equal(code(limited), 'RATE_LIMITED');

    // a members-only session is not a public webinar; the public part has its own switch
    const fresh = client(p.app);
    p.db.run("UPDATE feature_flags SET enabled = 0 WHERE key = 'public_webinars'");
    try { assert.equal(code(await fresh.get('/api/public/webinars')), 'FEATURE_DISABLED'); }
    finally { p.db.run("UPDATE feature_flags SET enabled = 1 WHERE key = 'public_webinars'"); }
  } finally { await p.app.close(); p.db.close(); }

  // without the rate limit (the shared app): a members-only id is not found, and an administrator can remove a visitor
  const anon = client(h.app);
  const membersOnly = h.db.get<{ id: string }>("SELECT id FROM live_sessions WHERE audience = 'members' AND status = 'published' LIMIT 1")!.id;
  assert.equal((await anon.post(`/api/public/webinars/${membersOnly}/register`, { name: 'Visitor', email: 'v@example.org' })).status, 404);
  const webinar = h.db.get<{ id: string }>("SELECT id FROM live_sessions WHERE audience = 'public' AND title = 'Getting started with Bioptime'")!.id;

  // on a full webinar, a new email (waitlisted) and an email that already holds a place get the same answer, so the
  // answer never tells whether someone registered; each learns their own status by email
  const held = await anon.post(`/api/public/webinars/${webinar}/register`, { name: 'Holds A Place', email: 'holds.place@example.org' });
  assert.equal(held.status, 202);
  const capacityBefore = h.db.get<{ capacity: number | null }>('SELECT capacity FROM live_sessions WHERE id = ?', [webinar])!.capacity;
  h.db.run("UPDATE live_sessions SET capacity = (SELECT COUNT(*) FROM session_registrations WHERE session_id = ? AND status IN ('registered','attended','no_show')) WHERE id = ?", [webinar, webinar]);
  try {
    const fresh = await anon.post(`/api/public/webinars/${webinar}/register`, { name: 'New Visitor', email: 'new.visitor@example.org' });
    const repeat = await anon.post(`/api/public/webinars/${webinar}/register`, { name: 'Holds A Place', email: 'holds.place@example.org' });
    assert.deepEqual([fresh.status, fresh.json], [202, { received: true }]);
    assert.deepEqual([repeat.status, repeat.json], [fresh.status, fresh.json], 'the same answer either way');
    assert.equal(h.db.get<{ status: string }>("SELECT status FROM session_registrations WHERE session_id = ? AND email = 'new.visitor@example.org'", [webinar])!.status, 'waitlisted');
    assert.equal(h.db.get<{ status: string }>("SELECT status FROM session_registrations WHERE session_id = ? AND email = 'holds.place@example.org'", [webinar])!.status, 'registered', 'a repeat keeps its place');
    assert.ok(h.db.get("SELECT 1 FROM outbox_messages WHERE to_address = 'new.visitor@example.org' AND subject LIKE 'Waitlist:%'"), 'the waitlist is told by email');
    assert.ok(h.db.get("SELECT 1 FROM outbox_messages WHERE to_address = 'holds.place@example.org' AND subject LIKE 'Already registered:%'"), 'a repeat is told its status by email');
  } finally {
    h.db.run('UPDATE live_sessions SET capacity = ? WHERE id = ?', [capacityBefore, webinar]);
    h.db.run("DELETE FROM session_registrations WHERE session_id = ? AND email IN ('new.visitor@example.org','holds.place@example.org')", [webinar]);
  }
  await anon.post(`/api/public/webinars/${webinar}/register`, { name: 'To Remove', email: 'remove.me@example.org' });
  const a = await admin();
  const reg = ((await a.get(`/api/admin/sessions/${webinar}/registrations`)).json.items as Array<{ id: string; email: string | null }>).find((r) => r.email === 'remove.me@example.org')!;
  assert.equal(code(await a.post(`/api/admin/sessions/${webinar}/registrations/${reg.id}/cancel`, {})), 'VALIDATION_FAILED', 'a reason is required');
  const removed = await a.post(`/api/admin/sessions/${webinar}/registrations/${reg.id}/cancel`, { reason: 'Test: asked to be removed' });
  assert.equal(removed.status, 200, JSON.stringify(removed.json));
  assert.equal((removed.json.items as Array<{ id: string; status: string }>).find((r) => r.id === reg.id)!.status, 'cancelled');
  assert.equal(auditRows('session.cancel', webinar).at(-1)!.reason, 'Test: asked to be removed');
});

test('a programme that ends gives back places in members-only sessions and promotes the waitlist', async () => {
  const { id } = await hostedSession(DEMO.coach, { title: 'Test · Programme end', capacity: 1 });
  const vikram = await member(DEMO.member2), ananya = await member(DEMO.member);
  await vikram.post(`/api/me/sessions/${id}/register`);
  await ananya.post(`/api/me/sessions/${id}/register`); // waitlisted
  const vikramId = userId(h.ctx, DEMO.member2);
  const live = h.db.all<{ id: string; status: string }>("SELECT id, status FROM programmes WHERE member_id = ? AND status IN ('active','paused')", [vikramId]);
  h.db.run("UPDATE programmes SET status = 'ended' WHERE member_id = ? AND status IN ('active','paused')", [vikramId]);
  try {
    await sessionsModule.events!.ProgrammeEnded![0]!(h.ctx, { id: 'evt_test', type: 'ProgrammeEnded', aggregate_type: 'programme', aggregate_id: live[0]?.id ?? 'x', payload: '{}', attempts: 0 }, { memberId: vikramId });
    assert.equal(regStatus(id, DEMO.member2), 'cancelled');
    assert.equal(regStatus(id, DEMO.member), 'registered', 'the waitlist moves up');
    assert.ok(notes(DEMO.member2, 'session').some((n) => n.title === 'Registration released'));
    assert.equal(auditRows('session.cancel', id).at(-1)!.reason, 'programme ended');
  } finally { for (const p of live) h.db.run('UPDATE programmes SET status = ? WHERE id = ?', [p.status, p.id]); }
});

test('data export: the member’s own registrations and attendance, with cancelled places and how each ended in the words she was told; never other registrants, counts, join links, drafts or a coach’s private notes', async () => {
  const ananyaId = userId(h.ctx, DEMO.member);
  const ananya = await member(DEMO.member), vikram = await member(DEMO.member2);
  const LINK = 'https://meet.example.org/export-check-passcode-123';
  // a full class with a join link: Vikram holds the only place and Ananya waits
  const { id: full } = await hostedSession(DEMO.coach, { title: 'Test · Export full class', capacity: 1, joinUrl: LINK, ...slot(9, 8 * 60) });
  assert.equal((await vikram.post(`/api/me/sessions/${full}/register`)).status, 201);
  assert.equal((await ananya.post(`/api/me/sessions/${full}/register`)).status, 201);
  assert.equal(regStatus(full, DEMO.member), 'waitlisted');
  // a place she gives back
  const { id: given } = await hostedSession(DEMO.coach, { title: 'Test · Export given back', ...slot(9, 10 * 60) });
  assert.equal((await ananya.post(`/api/me/sessions/${given}/register`)).status, 201);
  assert.equal((await ananya.post(`/api/me/sessions/${given}/cancel`, {})).status, 200);
  // a waitlist she leaves (Priya holds the only place)
  const priya = await member(PRIYA);
  const { id: left } = await hostedSession(DEMO.coach, { title: 'Test · Export left the waitlist', capacity: 1, ...slot(9, 11 * 60) });
  assert.equal((await priya.post(`/api/me/sessions/${left}/register`)).status, 201);
  assert.equal((await ananya.post(`/api/me/sessions/${left}/register`)).status, 201);
  assert.equal(regStatus(left, DEMO.member), 'waitlisted');
  assert.equal((await ananya.post(`/api/me/sessions/${left}/cancel`, {})).status, 200);
  // a place the team cancels: she never gave it back, and she is told it "was cancelled by the Bioptime team"
  const { id: pulled } = await hostedSession(DEMO.coach, { title: 'Test · Export cancelled by the team', ...slot(9, 12 * 60) });
  assert.equal((await ananya.post(`/api/me/sessions/${pulled}/register`)).status, 201);
  const pulledReg = h.db.get<{ id: string }>('SELECT id FROM session_registrations WHERE session_id = ? AND user_id = ?', [pulled, ananyaId])!.id;
  const teamCancel = await (await admin()).post(`/api/admin/sessions/${pulled}/registrations/${pulledReg}/cancel`, { reason: 'EXPORT-CHECK-TEAM-REASON' });
  assert.equal(teamCancel.status, 200, JSON.stringify(teamCancel.json));
  assert.ok(notes(DEMO.member, 'session').some((n) => n.title === 'Registration cancelled' && /cancelled by the Bioptime team/.test(n.body)));
  // the team's public webinar: its host reads as "The Bioptime team", never an administrator's own name
  const webinar = h.db.get<{ id: string; title: string }>("SELECT id, title FROM live_sessions WHERE audience = 'public' AND title = 'Getting started with Bioptime'")!;
  assert.equal((await ananya.post(`/api/me/sessions/${webinar.id}/register`)).status, 201);
  // a registration on a draft (written directly: nobody can sign up for one) stays out
  const draft = h.db.get<{ id: string; title: string }>("SELECT id, title FROM live_sessions WHERE status = 'draft' AND title = 'Strength basics for Core members'")!;
  const draftReg = domain.insertSampleRegistration(h.ctx, { sessionId: draft.id, userId: ananyaId, name: 'Ananya Rao', status: 'registered', registeredAt: new Date().toISOString() });
  try {
    const archive = buildArchive(h.ctx, ananyaId, 'drq_test_sessions_export');
    const body = JSON.stringify(archive);
    type Rec = { title: string; kind: string; host: string; sessionStatus: string; cancelledReason: string | null; yourPlace: { status: string; registeredAt: string; waitlistPosition: number | null; cancelledAt: string | null; cancelNote: string | null } };
    const section = (archive.moduleSections as Record<string, Record<string, { label: string; records: Rec[] }>> | undefined)?.sessions?.registrations;
    assert.ok(section, 'moduleSections.sessions.registrations is present');
    assert.match(section.label, /Live sessions you signed up for/);
    assert.match(section.label, /gave back or that were cancelled/, 'the label says the file holds places her page no longer lists');
    assert.doesNotMatch(section.label, /as your Live sessions page shows them/);
    assert.equal(archive.notIncluded.find((n) => /Live session registrations/.test(n.what)), undefined, 'the module leaves notIncluded once it contributes');
    const records = section.records;
    const sectionText = JSON.stringify(section);
    assert.equal(records.length, h.db.get<{ n: number }>("SELECT COUNT(*) n FROM session_registrations r JOIN live_sessions s ON s.id = r.session_id WHERE r.user_id = ? AND s.status != 'draft'", [ananyaId])!.n, 'every registration of hers outside drafts');
    for (const r of records) {
      assert.deepEqual(Object.keys(r).sort(), ['cancelledReason', 'endAt', 'host', 'kind', 'sample', 'sessionStatus', 'startAt', 'timezone', 'title', 'yourPlace'], 'no counts, capacity, join link, meeting details or ids');
      assert.deepEqual(Object.keys(r.yourPlace).sort(), ['cancelNote', 'cancelledAt', 'registeredAt', 'status', 'waitlistPosition']);
      if (r.yourPlace.status !== 'cancelled') assert.deepEqual([r.yourPlace.cancelledAt, r.yourPlace.cancelNote], [null, null], 'only a cancelled place has a cancellation');
    }
    const byTitle = (t: string) => records.find((r) => r.title === t)!;
    assert.deepEqual({ ...byTitle('Test · Export full class').yourPlace, registeredAt: undefined }, { status: 'waitlisted', waitlistPosition: 1, cancelledAt: null, cancelNote: null, registeredAt: undefined });
    assert.equal(byTitle('Test · Export full class').host, 'Asha Menon');
    const back = byTitle('Test · Export given back').yourPlace;
    assert.equal(back.status, 'cancelled');
    assert.ok(back.cancelledAt, 'when she gave it back');
    assert.equal(back.cancelNote, 'You gave your place back.');
    const leftWaitlist = byTitle('Test · Export left the waitlist').yourPlace;
    assert.deepEqual([leftWaitlist.status, leftWaitlist.waitlistPosition, leftWaitlist.cancelNote], ['cancelled', null, 'You left the waitlist.']);
    assert.ok(leftWaitlist.cancelledAt);
    // the team's cancellation reads as the team's, never as hers, and never with the team's reason
    const byTeam = byTitle('Test · Export cancelled by the team').yourPlace;
    assert.equal(byTeam.status, 'cancelled');
    assert.equal(byTeam.cancelNote, 'Cancelled by the Bioptime team.');
    assert.equal(byTeam.cancelledAt, h.db.get<{ cancelled_at: string }>('SELECT cancelled_at FROM session_registrations WHERE id = ?', [pulledReg])!.cancelled_at);
    assert.ok(!body.includes('EXPORT-CHECK-TEAM-REASON'), 'never the team’s reason for cancelling her place');
    assert.ok(!sectionText.includes('Priya'), 'never the person holding the place');
    const past = byTitle('Posture check-in class');
    assert.deepEqual([past.sessionStatus, past.yourPlace.status], ['completed', 'attended'], 'her attendance as the host recorded it');
    assert.equal(byTitle(webinar.title).host, 'The Bioptime team');
    assert.ok(!records.some((r) => r.title === draft.title), 'nothing from a draft');

    const adminName = h.db.get<{ name: string }>('SELECT name FROM users WHERE email = ?', [DEMO.admin])!.name;
    assert.ok(!sectionText.includes(adminName), 'never the administrator’s own name');
    assert.ok(!sectionText.includes('Vikram'), 'never another registrant');
    assert.ok(!sectionText.includes('@'), 'no email address of anyone');
    assert.ok(!body.includes(LINK) && !body.includes('export-check-passcode'), 'no join link anywhere in the file');
    assert.ok(!body.includes('kavya.nambiar@demo.bioptime.test'), 'never a visitor’s email');
  } finally {
    h.db.run('DELETE FROM session_registrations WHERE id = ?', [draftReg]);
  }

  // a place released when the programme ended reads as that, not as given back (Vikram's; run after Ananya's archive,
  // because it also releases his place in the full class and so promotes her)
  const vikramId = userId(h.ctx, DEMO.member2);
  const { id: ended } = await hostedSession(DEMO.coach, { title: 'Test · Export programme ended', ...slot(9, 13 * 60) });
  assert.equal((await vikram.post(`/api/me/sessions/${ended}/register`)).status, 201);
  const live = h.db.all<{ id: string; status: string }>("SELECT id, status FROM programmes WHERE member_id = ? AND status IN ('active','paused')", [vikramId]);
  h.db.run("UPDATE programmes SET status = 'ended' WHERE member_id = ? AND status IN ('active','paused')", [vikramId]);
  try { assert.ok(domain.onProgrammeEnded(h.ctx, vikramId) >= 1); } finally { for (const p of live) h.db.run('UPDATE programmes SET status = ? WHERE id = ?', [p.status, p.id]); }
  assert.equal(regStatus(ended, DEMO.member2), 'cancelled');
  const vikramRecs = (buildArchive(h.ctx, vikramId, 'drq_test_sessions_export_3').moduleSections as Record<string, Record<string, { records: Array<{ title: string; yourPlace: { status: string; cancelledAt: string | null; cancelNote: string | null } }> }>>).sessions!.registrations!.records;
  const endedPlace = vikramRecs.find((r) => r.title === 'Test · Export programme ended')!.yourPlace;
  assert.equal(endedPlace.status, 'cancelled');
  assert.ok(endedPlace.cancelledAt);
  assert.equal(endedPlace.cancelNote, 'Released because your programme ended.');

  // consultation follow-through: the summary the member reads is in the core archive; the coach's private note and
  // follow-ups never are (Sunita's seeded consultation with Meera has all three)
  const sunitaId = userId(h.ctx, 'sunita.bhat@demo.bioptime.test');
  const privateNote = h.db.get<{ body: string }>("SELECT body FROM coach_notes WHERE member_id = ? AND ref_type = 'appointment' AND visibility = 'private' LIMIT 1", [sunitaId]);
  const followUp = h.db.get<{ title: string }>("SELECT t.title FROM support_tasks t JOIN appointments a ON a.id = t.ref_id WHERE t.kind = 'coach_follow_up' AND t.ref_type = 'appointment' AND a.member_id = ? LIMIT 1", [sunitaId]);
  assert.ok(privateNote && followUp, 'the demo seed wrote a private note and a follow-up for Sunita');
  const sunita = buildArchive(h.ctx, sunitaId, 'drq_test_sessions_export_2');
  const sunitaBody = JSON.stringify(sunita);
  assert.ok(sunitaBody.includes('We went through your goals and the first weeks of your plan.'), 'the summary she reads');
  assert.ok(!sunitaBody.includes(privateNote.body), 'never the coach’s private note');
  assert.ok(!sunitaBody.includes(followUp.title), 'never the coach’s follow-ups');
  const hers = (sunita.moduleSections as Record<string, Record<string, { records: Array<{ title: string; yourPlace: { status: string } }> }>>).sessions!.registrations!.records;
  assert.ok(hers.some((r) => r.title === 'Evening wind-down workshop'), 'her own seeded registration');
});
