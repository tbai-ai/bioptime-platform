/* Growth: discovery calls for prospects (offered times, the request, the team's queue, a coach's view), corporate
   enquiries, the newsletter with double opt-in (confirmation link, expiry, signed unsubscribe link, CSV export), the
   module's switch and permission, rate limits and honeypots, audit, and the seed. Then the website pages that use these
   routes are read from the website folder (../../drive from the repository root, outside this repository): the consent
   wording and versions they show are the ones the server records, and they call only the routes that exist. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId } from '../helpers.js';
import { setUserPermission, permissionsFor } from '../../src/auth/permissions.js';
import { findRestrictedFields, restrictedKeys } from '../../src/auth/fieldPolicy.js';
import { growth as growthModule } from '../../src/modules/growth.js';
import * as g from '../../src/domain/growth.js';
import { sha256 } from '../../src/lib/crypto.js';
import { addMinutes, zonedToIso } from '../../src/lib/time.js';
import { moduleJobs } from '../../src/jobs.js';
import type { Ctx } from '../../src/context.js';
import { DEMO_OWNERS } from '../../src/seed/seed.js';

const PLATFORM = fileURLToPath(new URL('../../../../', import.meta.url));
const SITE = path.join(PLATFORM, '../../drive');

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); h.db.close(); });

const signedIn = async (email: string, password: string, workspace: 'member' | 'dashboard', mfa = false) => { const c = client(h.app); await c.login(email, password, workspace, mfa); return c; };
const owner = () => signedIn(DEMO.owner, DEMO_PASSWORDS.owner, 'dashboard', true);
const admin = () => signedIn(DEMO.admin, DEMO_PASSWORDS.admin, 'dashboard', true);
const coach = (email = DEMO.coach) => signedIn(email, DEMO_PASSWORDS.coach, 'dashboard');
const member = () => signedIn(DEMO.member, DEMO_PASSWORDS.member, 'member');
const code = (r: { json: { error?: { code: string } } }) => r.json.error?.code;
const stateCode = (r: { json: { error?: { details?: unknown } } }) => (r.json.error?.details as { code?: string } | undefined)?.code;
const auditRows = (action: string) => h.db.all<{ actor_id: string | null; actor_role: string; reason: string | null; data: string; target_id: string | null }>('SELECT actor_id, actor_role, reason, data, target_id FROM audit_events WHERE action = ? ORDER BY at', [action]);
const outbox = (to: string) => h.db.all<{ subject: string; body: string; channel: string; status: string }>('SELECT subject, body, channel, status FROM outbox_messages WHERE to_address = ? ORDER BY created_at, rowid', [to]);
const istDay = (offsetDays: number) => new Date(Date.now() + 330 * 60_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
const asOwner = (): Ctx => { const u = h.db.get<{ id: string; name: string }>('SELECT id, name FROM users WHERE email = ?', [DEMO.owner])!; return { ...h.ctx, actor: { id: u.id, role: 'owner', email: DEMO.owner, name: u.name } }; };
const usersCount = () => h.db.get<{ n: number }>('SELECT COUNT(*) n FROM users')!.n;

const discovery = (over: Record<string, unknown> = {}) => ({ name: 'Test Prospect', email: 'test.prospect@example.org', goals: 'Get stronger and sleep better.', slotIds: [], windows: 'Weekday evenings', consent: true, consentVersion: g.CONTACT_CONSENT_VERSION, ...over });
const corporate = (over: Record<string, unknown> = {}) => ({ company: 'Test Company', name: 'Test Contact', email: 'contact@company.example.org', teamSize: '11-50', interests: ['coaching'], consent: true, consentVersion: g.CONTACT_CONSENT_VERSION, ...over });
const signup = (over: Record<string, unknown> = {}) => ({ email: 'reader@example.org', consent: true, consentVersion: g.NEWSLETTER_CONSENT_VERSION, ...over });

/* ---------- the module ---------- */

test('the module: its routes behind the growth switch, unsubscribing ungated, one privacy clean-up job that keeps running while the module is off, no member export', () => {
  assert.equal(growthModule.key, 'growth');
  assert.equal(growthModule.feature, 'growth');
  assert.deepEqual(growthModule.ungated, ['POST /public/newsletter/unsubscribe']);
  // what the registry reads while it loads comes from a file that imports nothing (so any growth file can load first)
  assert.ok(!/^import(?! type)/m.test(fs.readFileSync(path.join(PLATFORM, 'apps/api/src/domain/growthConstants.ts'), 'utf8')), 'growthConstants.ts has no runtime import');
  assert.deepEqual((growthModule.jobs ?? []).map((j) => [j.name, !!j.runWhenDisabled]), [['privacy_retention', true]]);
  assert.equal(growthModule.exportSections, undefined, 'the people here have no account and no archive');
  // owners hold growth.manage; administrators hold it by default; coaches and members hold none
  assert.ok(permissionsFor(h.ctx, { id: userId(h.ctx, DEMO.owner), role: 'owner' }).includes('growth.manage'));
  assert.ok(permissionsFor(h.ctx, { id: userId(h.ctx, DEMO.admin), role: 'admin' }).includes('growth.manage'), 'an administrator default, like operations.manage');
  assert.ok(!permissionsFor(h.ctx, { id: userId(h.ctx, DEMO.coach), role: 'coach' }).includes('growth.manage'));
});

test('the seed: offered times, requests, an enquiry and sign-ups from fictional people, with no demo or sample label in what the team reads', async () => {
  const o = await owner();
  const calls = await o.get('/api/admin/growth/discovery-calls?status=all');
  assert.equal(calls.status, 200, JSON.stringify(calls.json));
  const items = calls.json.items as Array<Record<string, unknown>>;
  assert.ok(items.length >= 2);
  const slots = await o.get('/api/admin/growth/slots');
  assert.ok((slots.json.items as unknown[]).length >= 5);
  const corp = await o.get('/api/admin/growth/corporate?status=all');
  assert.ok((corp.json.items as unknown[]).length >= 1);
  const subs = await o.get('/api/admin/growth/newsletter?status=all');
  assert.deepEqual(subs.json.counts, { confirmed: 1, pending: 1, unsubscribed: 1 });
  for (const text of [calls.text, slots.text, corp.text, subs.text]) {
    assert.ok(!/\bdemo\b/i.test(text), 'no "demo" in what the Growth pages show');
    assert.ok(!/\bsample\b/i.test(text), 'no "sample" either');
  }
  for (const e of h.db.all<{ email: string }>('SELECT email FROM growth_discovery_calls UNION ALL SELECT email FROM growth_corporate_enquiries UNION ALL SELECT email FROM growth_newsletter_subscribers')) assert.match(e.email, /@example\.test$/, 'every seeded address is on the reserved .test domain');
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM users WHERE email LIKE '%@example.test'")!.n, 0, 'nobody who wrote in has an account');
});

test('the switch: with growth off, the public forms and the team pages answer FEATURE_DISABLED; leaving the newsletter still works', async () => {
  const anon = client(h.app);
  const o = await owner();
  const left = h.db.get<{ id: string }>("SELECT id FROM growth_newsletter_subscribers WHERE email = 'farah.khan@example.test'")!;
  h.db.run("UPDATE feature_flags SET enabled = 0 WHERE key = 'growth'");
  try {
    assert.equal(code(await anon.get('/api/public/discovery-calls/slots')), 'FEATURE_DISABLED');
    assert.equal(code(await anon.post('/api/public/discovery-calls', discovery())), 'FEATURE_DISABLED');
    assert.equal(code(await anon.post('/api/public/corporate-enquiries', corporate())), 'FEATURE_DISABLED');
    assert.equal(code(await anon.post('/api/public/newsletter', signup())), 'FEATURE_DISABLED');
    assert.equal(code(await anon.post('/api/public/newsletter/confirm', { token: 'x'.repeat(40) })), 'FEATURE_DISABLED');
    assert.equal(code(await o.get('/api/admin/growth/discovery-calls')), 'FEATURE_DISABLED');
    assert.equal(code(await (await coach()).get('/api/coach/growth/discovery-calls')), 'FEATURE_DISABLED');
    const out = await anon.post('/api/public/newsletter/unsubscribe', { id: left.id, token: g.unsubscribeToken(h.ctx, left.id) });
    assert.equal(out.status, 200, 'unsubscribing is ungated');
    assert.deepEqual(out.json, { unsubscribed: true });
  } finally { h.db.run("UPDATE feature_flags SET enabled = 1 WHERE key = 'growth'"); }
});

test('the team routes need growth.manage: signed out 401, a member or a coach 403, an administrator without it PERMISSION_DENIED', async () => {
  const anon = client(h.app);
  const routes: Array<['GET' | 'POST' | 'PATCH', string]> = [['GET', '/api/admin/growth/summary'], ['GET', '/api/admin/growth/discovery-calls'], ['GET', '/api/admin/growth/slots'], ['POST', '/api/admin/growth/slots'], ['GET', '/api/admin/growth/corporate'], ['GET', '/api/admin/growth/newsletter'], ['GET', '/api/admin/growth/newsletter/export.csv'], ['GET', '/api/admin/growth/assignees']];
  const m = await member();
  const c = await coach();
  for (const [method, url] of routes) {
    const call = (x: ReturnType<typeof client>) => (method === 'GET' ? x.get(url) : method === 'POST' ? x.post(url, {}) : x.patch(url, {}));
    assert.equal((await call(anon)).status, 401, `${method} ${url} signed out`);
    assert.equal((await call(m)).status, 403, `${method} ${url} as a member`);
    assert.equal((await call(c)).status, 403, `${method} ${url} as a coach`);
  }
  const adminId = userId(h.ctx, DEMO.admin);
  setUserPermission(asOwner(), adminId, 'growth.manage', false, 'test: not handling growth');
  try {
    const a = await admin();
    const r = await a.get('/api/admin/growth/discovery-calls');
    assert.equal(r.status, 403);
    assert.equal(code(r), 'PERMISSION_DENIED');
    assert.equal(code(await a.get('/api/admin/growth/newsletter/export.csv')), 'PERMISSION_DENIED', 'the export too');
  } finally { setUserPermission(asOwner(), adminId, 'growth.manage', true, 'test: back to the default'); }
});

/* ---------- discovery calls ---------- */

test('discovery calls: offered times, validation, the honeypot, the request (no account), the confirmation email that promises no time, the team told by reference only, audit, duplicates', async () => {
  const anon = client(h.app);
  const slots = await anon.get('/api/public/discovery-calls/slots');
  assert.equal(slots.status, 200);
  const offered = slots.json.items as Array<{ id: string; startAt: string; endAt: string; label: string }>;
  assert.ok(offered.length >= 5);
  assert.deepEqual(Object.keys(offered[0]!).sort(), ['endAt', 'id', 'label', 'startAt']);
  assert.match(offered[0]!.label, /IST/);

  // validation, field by field
  const bad: Array<[Record<string, unknown>, string]> = [
    [{ email: 'not-an-email' }, 'email'], [{ name: 'X' }, 'name'], [{ goals: 'hi' }, 'goals'], [{ consent: false }, 'consent'], [{ consent: undefined }, 'consent'],
    [{ consentVersion: 'contact-2020-01-01' }, 'consentVersion'], [{ phone: '12345' }, 'phone'], [{ slotIds: ['a', 'b', 'c', 'd'] }, 'slotIds'], [{ source: 'elsewhere' }, 'source'], [{ interests: ['NOT A SLUG'] }, 'interests.0'],
  ];
  for (const [over, field] of bad) {
    const r = await anon.post('/api/public/discovery-calls', discovery(over));
    assert.equal(r.status, 400, JSON.stringify(over));
    assert.equal(code(r), 'VALIDATION_FAILED');
    assert.ok((r.json.error!.details as Array<{ path: string }>).some((d) => d.path === field), `${field}: ${JSON.stringify(r.json.error)}`);
  }
  const noTime = await anon.post('/api/public/discovery-calls', discovery({ windows: '' }));
  assert.equal(code(noTime), 'VALIDATION_FAILED', 'a time we offer or the visitor’s own words');
  const gone = await anon.post('/api/public/discovery-calls', discovery({ slotIds: ['gcs_doesnotexist'] }));
  assert.equal(gone.status, 409);
  assert.equal(stateCode(gone), 'SLOT_UNAVAILABLE');

  // the honeypot: the same answer, nothing stored or sent
  const before = { calls: h.db.get<{ n: number }>('SELECT COUNT(*) n FROM growth_discovery_calls')!.n, users: usersCount() };
  const trap = await anon.post('/api/public/discovery-calls', discovery({ email: 'bot@example.org', website: 'http://spam.example' }));
  assert.equal(trap.status, 202);
  assert.deepEqual(trap.json, { received: true });
  assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM growth_discovery_calls')!.n, before.calls);
  assert.equal(outbox('bot@example.org').length, 0);

  // the request: phone typed with spaces, two offered times and the visitor's own words
  const ok = await anon.post('/api/public/discovery-calls', discovery({ email: 'Priya.Prospect@Example.org', name: 'Priya Prospect', phone: '+91 98450 12345', slotIds: [offered[0]!.id, offered[1]!.id], windows: 'or Saturday morning', interests: ['core'], source: 'package_finder' }));
  assert.equal(ok.status, 202, JSON.stringify(ok.json));
  assert.deepEqual(ok.json, trap.json, 'the same answer as the honeypot');
  assert.equal(usersCount(), before.users, 'no account is created');
  const row = h.db.get<{ id: string; reference: string; email: string; phone: string; status: string; preferred_slot_ids: string; interests: string; source: string; consent_version: string }>("SELECT * FROM growth_discovery_calls WHERE email = 'priya.prospect@example.org'")!;
  assert.match(row.reference, /^DC-\d{4,}$/);
  assert.equal(row.phone, '+919845012345');
  assert.equal(row.status, 'new');
  assert.deepEqual(JSON.parse(row.preferred_slot_ids), [offered[0]!.id, offered[1]!.id]);
  assert.deepEqual(JSON.parse(row.interests), ['core']);
  assert.equal(row.source, 'package_finder');
  assert.equal(row.consent_version, g.CONTACT_CONSENT_VERSION);
  const mail = outbox('priya.prospect@example.org');
  assert.equal(mail.length, 1);
  assert.equal(mail[0]!.status, 'logged', 'recorded in the outbox, not delivered');
  assert.ok(mail[0]!.subject.includes(row.reference) && mail[0]!.body.includes(row.reference));
  assert.match(mail[0]!.body, /will be in touch/);
  assert.match(mail[0]!.body, /Nothing is booked until we have spoken with you/);
  assert.ok(mail[0]!.body.includes(offered[0]!.label.slice(0, 10)) && mail[0]!.body.includes('Saturday morning'), 'the times they mentioned, as preferences');
  // the team: an in-app note with the reference, for the people holding growth.manage, never the person's details
  const notes = h.db.all<{ user_id: string; title: string; body: string }>("SELECT user_id, title, body FROM notifications WHERE title = 'New discovery call request' AND body LIKE ?", [`${row.reference} %`]);
  assert.deepEqual(notes.map((n) => n.user_id).sort(), [userId(h.ctx, DEMO.admin), userId(h.ctx, DEMO.owner), ...DEMO_OWNERS.map((o) => userId(h.ctx, o.email))].sort(), 'the administrators and every owner (Rohan and Avinash included)');
  for (const n of notes) assert.ok(!n.body.includes('Priya') && !n.body.includes('@'), 'no name or address in the note');
  const a = auditRows('growth.discovery_call.create').find((x) => x.target_id === row.id)!;
  assert.equal(a.actor_role, 'system');
  assert.ok(!a.data.includes('example.org') && !a.data.includes('9845'), 'the audit row carries no email or phone');
  assert.deepEqual(JSON.parse(a.data), { reference: row.reference, slots: 2, windows: true, source: 'package_finder', phone: true });

  // the same address again while the first is open: the same answer, nothing new, no second email
  const again = await anon.post('/api/public/discovery-calls', discovery({ email: 'priya.prospect@example.org' }));
  assert.deepEqual([again.status, again.json], [202, { received: true }]);
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM growth_discovery_calls WHERE email = 'priya.prospect@example.org'")!.n, 1);
  assert.equal(outbox('priya.prospect@example.org').length, 1);
});

test('discovery calls: the team reads, assigns, books and closes with notes (audited); phone numbers only with members.view_restricted; a coach sees their own without contact details', async () => {
  const anon = client(h.app);
  await anon.post('/api/public/discovery-calls', discovery({ email: 'queue.case@example.org', name: 'Queue Case', phone: '+919811112222' }));
  const id = h.db.get<{ id: string }>("SELECT id FROM growth_discovery_calls WHERE email = 'queue.case@example.org'")!.id;
  const o = await owner();
  const list = await o.get('/api/admin/growth/discovery-calls');
  const item = (list.json.items as Array<{ id: string; phone?: string; email: string; status: string }>).find((x) => x.id === id)!;
  assert.equal(item.phone, '+919811112222', 'the owner holds members.view_restricted');
  assert.equal(item.email, 'queue.case@example.org');
  assert.ok((list.json.counts as Record<string, number>).new >= 1);

  // an administrator without members.view_restricted: no phone anywhere in the payload
  const adminId = userId(h.ctx, DEMO.admin);
  setUserPermission(asOwner(), adminId, 'members.view_restricted', false, 'test: no restricted fields');
  try {
    const a = await admin();
    const r = await a.get(`/api/admin/growth/discovery-calls/${id}`);
    assert.equal(r.status, 200);
    assert.ok(!('phone' in r.json), 'stripped');
    assert.ok(!r.text.includes('9811112222'));
    assert.ok(!(await a.get('/api/admin/growth/discovery-calls')).text.includes('9811112222'));
  } finally { setUserPermission(asOwner(), adminId, 'members.view_restricted', true, 'test: back to the default'); }

  // assignees: team members with growth.manage and active coaches, names and roles only
  const people = (await o.get('/api/admin/growth/assignees')).json.items as Array<{ id: string; name: string; role: string }>;
  assert.ok(people.some((p) => p.role === 'coach') && people.some((p) => p.role === 'owner'));
  assert.ok(people.every((p) => Object.keys(p).sort().join() === 'id,name,role'));
  assert.equal(code(await o.patch(`/api/admin/growth/discovery-calls/${id}`, { assignedTo: userId(h.ctx, DEMO.member) })), 'ASSIGNEE_INVALID', 'never a member');

  // assign to a coach: the coach is told in-app, by reference only
  const coachId = userId(h.ctx, DEMO.coach2);
  const assigned = await o.patch(`/api/admin/growth/discovery-calls/${id}`, { assignedTo: coachId, status: 'contacted', note: 'Emailed two options.' });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.json));
  assert.equal((assigned.json.assignedTo as { id: string }).id, coachId);
  assert.equal(assigned.json.status, 'contacted');
  assert.equal((assigned.json.notes as Array<{ body: string }>).at(-1)!.body, 'Emailed two options.');
  const told = h.db.get<{ body: string }>("SELECT body FROM notifications WHERE user_id = ? AND title = 'A discovery call is assigned to you' ORDER BY created_at DESC LIMIT 1", [coachId])!;
  assert.ok(!told.body.includes('@') && !told.body.includes('9811'));

  // the coach's own view: name, goals, times and status; never the email or the phone number
  const c2 = await coach(DEMO.coach2);
  const mine = await c2.get('/api/coach/growth/discovery-calls');
  assert.equal(mine.status, 200);
  const cItems = mine.json.items as Array<Record<string, unknown>>;
  assert.ok(cItems.some((x) => x.id === id));
  assert.deepEqual(findRestrictedFields(mine.json, restrictedKeys()), [], 'no restricted key in a coach payload');
  assert.ok(!mine.text.includes('queue.case@example.org') && !mine.text.includes('9811112222'));
  const other = await (await coach(DEMO.coach3)).get('/api/coach/growth/discovery-calls');
  assert.ok(!(other.json.items as Array<{ id: string }>).some((x) => x.id === id), 'another coach does not see it');
  assert.equal((await c2.get(`/api/admin/growth/discovery-calls/${id}`)).status, 403, 'and a coach cannot open the team’s record');

  // booking: an agreed time only on a booked call
  const at = zonedToIso(istDay(3), 19 * 60);
  assert.equal(code(await o.patch(`/api/admin/growth/discovery-calls/${id}`, { bookedAt: at })), 'NOT_BOOKED');
  const booked = await o.patch(`/api/admin/growth/discovery-calls/${id}`, { status: 'booked', bookedAt: at });
  assert.equal(booked.json.status, 'booked');
  assert.equal(booked.json.bookedAt, new Date(at).toISOString());
  const closed = await o.patch(`/api/admin/growth/discovery-calls/${id}`, { status: 'closed', note: 'Call held; they will think about Core.' });
  assert.equal(closed.json.status, 'closed');
  assert.ok(closed.json.closedAt);
  assert.equal(closed.json.bookedAt, null, 'leaving booked clears the agreed time');
  assert.ok(!((await c2.get('/api/coach/growth/discovery-calls')).json.items as Array<{ id: string }>).some((x) => x.id === id), 'a closed call leaves the coach’s list');

  // notes route; every change audited without the note's words or contact details
  const n = await o.post(`/api/admin/growth/discovery-calls/${id}/notes`, { body: 'Follow up in a month.' });
  assert.equal(n.status, 201);
  assert.equal((n.json.items as unknown[]).length, 3);
  assert.equal(code(await o.post(`/api/admin/growth/discovery-calls/${id}/notes`, { body: '' })), 'VALIDATION_FAILED');
  const updates = auditRows('growth.discovery_call.update').filter((x) => x.target_id === id);
  assert.equal(updates.length, 3);
  assert.deepEqual(JSON.parse(updates[0]!.data).status, { from: 'new', to: 'contacted' });
  assert.equal(JSON.parse(updates[0]!.data).assignedTo.to, coachId);
  for (const u of [...updates, ...auditRows('growth.note.create').filter((x) => x.target_id === id)]) {
    assert.equal(u.actor_id, userId(h.ctx, DEMO.owner));
    assert.ok(!u.data.includes('Emailed') && !u.data.includes('Follow up') && !u.data.includes('@'), 'no note text or address in the audit');
  }
  assert.equal((await o.get('/api/admin/growth/discovery-calls/gdc_nope')).status, 404);
  assert.equal(code(await o.patch(`/api/admin/growth/discovery-calls/${id}`, { status: 'lost' })), 'VALIDATION_FAILED');
});

test('call slots: offered by the team (validated, no overlap), withdrawn (audited) and then no longer offered or accepted', async () => {
  const o = await owner();
  const start = zonedToIso(istDay(9), 11 * 60);
  const made = await o.post('/api/admin/growth/slots', { startAt: start, endAt: addMinutes(start, 30) });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const id = made.json.id as string;
  assert.equal(code(await o.post('/api/admin/growth/slots', { startAt: addMinutes(start, 10), endAt: addMinutes(start, 40) })), 'SLOT_OVERLAP');
  assert.equal(code(await o.post('/api/admin/growth/slots', { startAt: addMinutes(new Date().toISOString(), -60), endAt: new Date().toISOString() })), 'SLOT_PAST');
  assert.equal(code(await o.post('/api/admin/growth/slots', { startAt: start, endAt: addMinutes(start, 600) })), 'SLOT_LENGTH');
  assert.equal(code(await o.post('/api/admin/growth/slots', { startAt: 'tomorrow', endAt: start })), 'VALIDATION_FAILED');
  assert.ok(auditRows('growth.slot.create').some((a) => a.target_id === id));
  const anon = client(h.app);
  assert.ok(((await anon.get('/api/public/discovery-calls/slots')).json.items as Array<{ id: string }>).some((s) => s.id === id));
  const w = await o.post(`/api/admin/growth/slots/${id}/withdraw`, { reason: 'test: away that day' });
  assert.equal(w.status, 200);
  assert.equal(auditRows('growth.slot.withdraw').find((a) => a.target_id === id)!.reason, 'test: away that day');
  assert.ok(!((await anon.get('/api/public/discovery-calls/slots')).json.items as Array<{ id: string }>).some((s) => s.id === id), 'no longer offered');
  assert.equal(stateCode(await anon.post('/api/public/discovery-calls', discovery({ email: 'late@example.org', slotIds: [id] }))), 'SLOT_UNAVAILABLE');
  const listed = (await o.get('/api/admin/growth/slots')).json.items as Array<{ id: string; status: string; requests: number }>;
  assert.equal(listed.find((s) => s.id === id)!.status, 'withdrawn');
  // a slot inside the lead time is not offered publicly
  h.db.insert('growth_call_slots', { id: 'gcs_soon', start_at: addMinutes(new Date().toISOString(), 30), end_at: addMinutes(new Date().toISOString(), 50), status: 'published', created_by: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), withdrawn_at: null });
  assert.ok(!((await anon.get('/api/public/discovery-calls/slots')).json.items as Array<{ id: string }>).some((s) => s.id === 'gcs_soon'));
});

/* ---------- corporate enquiries ---------- */

test('corporate enquiries: validation, the honeypot, the enquiry and its email, the team’s list, status and notes (audited); coaches cannot take one', async () => {
  const anon = client(h.app);
  for (const [over, field] of [[{ teamSize: '12' }, 'teamSize'], [{ interests: [] }, 'interests'], [{ interests: ['yoga-retreats'] }, 'interests.0'], [{ company: '' }, 'company'], [{ consent: false }, 'consent'], [{ message: 'x'.repeat(2001) }, 'message']] as Array<[Record<string, unknown>, string]>) {
    const r = await anon.post('/api/public/corporate-enquiries', corporate(over));
    assert.equal(code(r), 'VALIDATION_FAILED', JSON.stringify(over));
    assert.ok((r.json.error!.details as Array<{ path: string }>).some((d) => d.path === field), field);
  }
  const before = h.db.get<{ n: number }>('SELECT COUNT(*) n FROM growth_corporate_enquiries')!.n;
  const trap = await anon.post('/api/public/corporate-enquiries', corporate({ website: 'x' }));
  assert.deepEqual([trap.status, trap.json], [202, { received: true }]);
  assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM growth_corporate_enquiries')!.n, before);
  const ok = await anon.post('/api/public/corporate-enquiries', corporate({ interests: ['coaching', 'live_sessions', 'coaching'], message: 'About forty people.', phone: '+91-80-4000-1234' }));
  assert.deepEqual([ok.status, ok.json], [202, { received: true }]);
  const row = h.db.get<{ id: string; reference: string; interests: string; phone: string }>("SELECT * FROM growth_corporate_enquiries WHERE email = 'contact@company.example.org'")!;
  assert.match(row.reference, /^CE-\d{4,}$/);
  assert.deepEqual(JSON.parse(row.interests), ['coaching', 'live_sessions']);
  assert.equal(row.phone, '+918040001234');
  const mail = outbox('contact@company.example.org');
  assert.equal(mail.length, 1);
  assert.ok(mail[0]!.body.includes(row.reference) && /nothing is agreed or priced until we have talked/.test(mail[0]!.body));
  assert.ok(!auditRows('growth.corporate_enquiry.create').find((a) => a.target_id === row.id)!.data.includes('@'));

  const o = await owner();
  const list = await o.get('/api/admin/growth/corporate');
  assert.ok((list.json.items as Array<{ id: string }>).some((x) => x.id === row.id));
  assert.equal(code(await o.patch(`/api/admin/growth/corporate/${row.id}`, { assignedTo: userId(h.ctx, DEMO.coach) })), 'ASSIGNEE_INVALID', 'a corporate contact’s details stay with the team');
  const upd = await o.patch(`/api/admin/growth/corporate/${row.id}`, { status: 'in_discussion', assignedTo: userId(h.ctx, DEMO.admin), note: 'Call set up with their people team.' });
  assert.equal(upd.status, 200, JSON.stringify(upd.json));
  assert.equal(upd.json.status, 'in_discussion');
  assert.equal((upd.json.assignedTo as { id: string }).id, userId(h.ctx, DEMO.admin));
  assert.equal((upd.json.notes as unknown[]).length, 1);
  assert.ok(h.db.get("SELECT 1 FROM notifications WHERE user_id = ? AND title = 'A corporate enquiry is assigned to you'", [userId(h.ctx, DEMO.admin)]));
  const n = await o.post(`/api/admin/growth/corporate/${row.id}/notes`, { body: 'Sent a summary of what we run today.' });
  assert.equal(n.status, 201);
  const a = auditRows('growth.corporate_enquiry.update').filter((x) => x.target_id === row.id);
  assert.equal(a.length, 1);
  assert.deepEqual(JSON.parse(a[0]!.data).status, { from: 'new', to: 'in_discussion' });
  assert.ok(auditRows('growth.note.create').some((x) => x.target_id === row.id));
  const detail = await o.get(`/api/admin/growth/corporate/${row.id}`);
  assert.equal((detail.json.notes as unknown[]).length, 2);
  assert.equal(detail.json.consentText, g.CONSENT_TEXTS[g.CONTACT_CONSENT_VERSION]);
});

/* ---------- newsletter ---------- */

test('newsletter: double opt-in by an emailed link (hash stored, works once, expires), repeats send nothing new, the signed unsubscribe link, plain form posts', async () => {
  const anon = client(h.app);
  for (const [over, field] of [[{ email: 'nope' }, 'email'], [{ consent: false }, 'consent'], [{ consentVersion: 'newsletter-2019' }, 'consentVersion']] as Array<[Record<string, unknown>, string]>) {
    const r = await anon.post('/api/public/newsletter', signup(over));
    assert.equal(code(r), 'VALIDATION_FAILED');
    assert.ok((r.json.error!.details as Array<{ path: string }>).some((d) => d.path === field), field);
  }
  const trap = await anon.post('/api/public/newsletter', signup({ email: 'bot.reader@example.org', website: 'x' }));
  assert.deepEqual([trap.status, trap.json], [202, { received: true }]);
  assert.ok(!h.db.get("SELECT 1 FROM growth_newsletter_subscribers WHERE email = 'bot.reader@example.org'"));

  const ok = await anon.post('/api/public/newsletter', signup({ email: 'Reader@Example.org' }));
  assert.deepEqual([ok.status, ok.json], [202, { received: true }]);
  const sub = h.db.get<{ id: string; status: string; confirm_token_hash: string; confirm_expires_at: string; consent_version: string }>("SELECT * FROM growth_newsletter_subscribers WHERE email = 'reader@example.org'")!;
  assert.equal(sub.status, 'pending');
  assert.equal(sub.consent_version, g.NEWSLETTER_CONSENT_VERSION);
  const mail = outbox('reader@example.org');
  assert.equal(mail.length, 1);
  const link = /\/\?newsletter=confirm&token=([A-Za-z0-9_-]+)#newsletter/.exec(mail[0]!.body);
  assert.ok(link, mail[0]!.body);
  const token = link![1]!;
  assert.ok(mail[0]!.body.startsWith('Hello') && mail[0]!.body.includes('http://localhost:3000/?newsletter=confirm&token='), 'the link points at the website’s newsletter block');
  assert.equal(sub.confirm_token_hash, sha256(token), 'only the hash is stored');
  assert.ok(!JSON.stringify(h.db.all('SELECT * FROM growth_newsletter_subscribers')).includes(token));
  const hours = (Date.parse(sub.confirm_expires_at) - Date.now()) / 3_600_000;
  assert.ok(hours > 71 && hours <= 72, 'the link works for 72 hours');
  assert.ok(mail[0]!.body.includes('?newsletter=unsubscribe&id='), 'every email can stop it');

  // a repeat within ten minutes: the same answer, no second email
  await anon.post('/api/public/newsletter', signup({ email: 'reader@example.org' }));
  assert.equal(outbox('reader@example.org').length, 1);

  // confirm once
  const conf = await anon.post('/api/public/newsletter/confirm', { token });
  assert.equal(conf.status, 200, JSON.stringify(conf.json));
  assert.deepEqual(conf.json, { confirmed: true });
  const after1 = h.db.get<{ status: string; confirmed_at: string; confirm_token_hash: string | null }>("SELECT * FROM growth_newsletter_subscribers WHERE email = 'reader@example.org'")!;
  assert.equal(after1.status, 'confirmed');
  assert.ok(after1.confirmed_at);
  assert.equal(after1.confirm_token_hash, null);
  assert.equal(code(await anon.post('/api/public/newsletter/confirm', { token })), 'TOKEN_INVALID', 'the link works once');
  const welcome = outbox('reader@example.org').at(-1)!;
  assert.equal(welcome.subject, 'You are subscribed to the Bioptime newsletter');
  assert.ok(auditRows('growth.newsletter.confirm').some((a) => a.target_id === sub.id));

  // confirmed already: signing up again sends nothing and answers the same
  const again = await anon.post('/api/public/newsletter', signup({ email: 'reader@example.org' }));
  assert.deepEqual([again.status, again.json], [202, { received: true }]);
  assert.equal(outbox('reader@example.org').length, 2);

  // the unsubscribe link from the welcome email
  const un = /\?newsletter=unsubscribe&id=([^&]+)&token=([0-9a-f]+)#newsletter/.exec(welcome.body)!;
  assert.equal(decodeURIComponent(un[1]!), sub.id);
  assert.equal(code(await anon.post('/api/public/newsletter/unsubscribe', { id: sub.id, token: 'f'.repeat(40) })), 'TOKEN_INVALID');
  assert.equal(code(await anon.post('/api/public/newsletter/unsubscribe', { id: 'gns_other', token: un[2] })), 'TOKEN_INVALID', 'a token is bound to its subscriber');
  const out = await anon.post('/api/public/newsletter/unsubscribe', { id: sub.id, token: un[2] });
  assert.deepEqual([out.status, out.json], [200, { unsubscribed: true }]);
  assert.equal(h.db.get<{ status: string }>('SELECT status FROM growth_newsletter_subscribers WHERE id = ?', [sub.id])!.status, 'unsubscribed');
  assert.deepEqual((await anon.post('/api/public/newsletter/unsubscribe', { id: sub.id, token: un[2] })).json, { unsubscribed: true }, 'again: still fine');
  assert.equal(JSON.parse(auditRows('growth.newsletter.unsubscribe').filter((a) => a.target_id === sub.id).at(-1)!.data).by, 'link');

  // signing up again after leaving: pending, with a new link
  await anon.post('/api/public/newsletter', signup({ email: 'reader@example.org' }));
  assert.equal(h.db.get<{ status: string }>('SELECT status FROM growth_newsletter_subscribers WHERE id = ?', [sub.id])!.status, 'pending');
  assert.equal(outbox('reader@example.org').length, 3);

  // an expired link
  await anon.post('/api/public/newsletter', signup({ email: 'slow.reader@example.org' }));
  const slowToken = /token=([A-Za-z0-9_-]+)#/.exec(outbox('slow.reader@example.org')[0]!.body)![1]!;
  h.db.run("UPDATE growth_newsletter_subscribers SET confirm_expires_at = ? WHERE email = 'slow.reader@example.org'", [addMinutes(new Date().toISOString(), -1)]);
  const expired = await anon.post('/api/public/newsletter/confirm', { token: slowToken });
  assert.equal(expired.status, 410);
  assert.equal(code(expired), 'TOKEN_EXPIRED');

  // the footer's plain form post (no JavaScript): back to the home page's newsletter block
  const res = await h.app.inject({ method: 'POST', url: '/api/public/newsletter', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams({ email: 'form.reader@example.org', consent: 'yes', consentVersion: g.NEWSLETTER_CONSENT_VERSION, website: '' }).toString() });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/?newsletter=sent#newsletter');
  assert.equal(h.db.get<{ status: string }>("SELECT status FROM growth_newsletter_subscribers WHERE email = 'form.reader@example.org'")!.status, 'pending');
  const badForm = await h.app.inject({ method: 'POST', url: '/api/public/newsletter', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams({ email: 'form.reader2@example.org', consentVersion: g.NEWSLETTER_CONSENT_VERSION }).toString() });
  assert.equal(badForm.headers.location, '/?newsletter=error#newsletter', 'no consent ticked');
  assert.ok(!h.db.get("SELECT 1 FROM growth_newsletter_subscribers WHERE email = 'form.reader2@example.org'"));
  const trapForm = await h.app.inject({ method: 'POST', url: '/api/public/newsletter', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams({ email: 'form.bot@example.org', consent: 'yes', consentVersion: g.NEWSLETTER_CONSENT_VERSION, website: 'spam' }).toString() });
  assert.equal(trapForm.headers.location, '/?newsletter=sent#newsletter');
  assert.ok(!h.db.get("SELECT 1 FROM growth_newsletter_subscribers WHERE email = 'form.bot@example.org'"));
});

test('newsletter: the team’s list, the CSV export (confirmed by default, formula cells defused, audited) and taking someone off with a reason', async () => {
  const o = await owner();
  // a confirmed subscriber whose address a spreadsheet would read as a formula
  h.db.insert('growth_newsletter_subscribers', { id: 'gns_formula', email: '=cmd@example.org', status: 'confirmed', consent_version: g.NEWSLETTER_CONSENT_VERSION, source: 'website', confirm_token_hash: null, confirm_expires_at: null, requested_at: new Date().toISOString(), confirmed_at: new Date().toISOString(), unsubscribed_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  const list = await o.get('/api/admin/growth/newsletter?status=confirmed');
  assert.equal(list.status, 200);
  assert.ok((list.json.items as Array<{ status: string }>).every((s) => s.status === 'confirmed'));
  assert.equal(((await o.get('/api/admin/growth/newsletter?q=rohan')).json.items as unknown[]).length, 1);
  const csv = await o.get('/api/admin/growth/newsletter/export.csv');
  assert.equal(csv.status, 200);
  assert.match(String(csv.headers['content-type']), /^text\/csv/);
  assert.match(String(csv.headers['content-disposition']), /attachment; filename="bioptime-newsletter-confirmed-\d{4}-\d{2}-\d{2}\.csv"/);
  const lines = csv.text.trim().split('\n');
  assert.equal(lines[0], 'email,status,consent_version,source,requested_at,confirmed_at,unsubscribed_at');
  assert.ok(lines.slice(1).every((l) => l.includes(',confirmed,')), 'confirmed only by default');
  assert.ok(lines.some((l) => l.startsWith("'=cmd@example.org,")), 'a formula cell is defused');
  assert.ok(!csv.text.includes('isha.nair@example.test'), 'pending sign-ups stay out');
  const exp = auditRows('growth.newsletter.export').at(-1)!;
  assert.deepEqual(JSON.parse(exp.data), { status: 'confirmed', count: lines.length - 1 });
  assert.ok((await o.get('/api/admin/growth/newsletter/export.csv?status=all')).text.includes('isha.nair@example.test'));
  assert.equal(code(await o.get('/api/admin/growth/newsletter/export.csv?status=everyone')), 'VALIDATION_FAILED');

  assert.equal(code(await o.post('/api/admin/growth/newsletter/gns_formula/unsubscribe', {})), 'VALIDATION_FAILED', 'a reason is required');
  const off = await o.post('/api/admin/growth/newsletter/gns_formula/unsubscribe', { reason: 'test: asked by email' });
  assert.equal(off.json.status, 'unsubscribed');
  const a = auditRows('growth.newsletter.unsubscribe').filter((x) => x.target_id === 'gns_formula');
  assert.equal(a.length, 1);
  assert.equal(a[0]!.reason, 'test: asked by email');
  assert.equal(JSON.parse(a[0]!.data).by, 'team');
});

test('retention: the daily privacy job deletes closed requests after 180 days and idle ones after a year (with notes and emails), stale and departed sign-ups after 30 days, keeps the rest, audits counts only, and runs while the module is off', async () => {
  const at = (days: number) => addMinutes(new Date().toISOString(), -days * 1440);
  const call = (id: string, email: string, status: string, updatedDaysAgo: number, closedDaysAgo: number | null) => {
    h.db.insert('growth_discovery_calls', { id, reference: `DC-R${id.slice(-3)}`, name: 'Retention Case', email, phone: '+919800000001', goals: 'Retention test goals.', preferred_slot_ids: '[]', preferred_windows: 'Evenings', interests: '[]', source: 'website', consent_version: g.CONTACT_CONSENT_VERSION, consent_at: at(400), status, assigned_to: null, booked_at: null, created_at: at(400), updated_at: at(updatedDaysAgo), closed_at: closedDaysAgo === null ? null : at(closedDaysAgo) });
    h.db.insert('growth_notes', { id: `gnt_${id}`, ref_type: 'discovery_call', ref_id: id, author_id: null, body: 'A team note.', created_at: at(updatedDaysAgo) });
    h.db.insert('outbox_messages', { id: `obx_${id}`, channel: 'email', to_address: email, subject: `We have your request for a call (DC-R${id.slice(-3)})`, body: 'Hello Retention, your reference…', notification_id: null, status: 'logged', created_at: at(400) });
  };
  call('gdc_ret_old', 'ret.closed.old@example.org', 'closed', 181, 181);
  call('gdc_ret_new', 'ret.closed.new@example.org', 'closed', 179, 179);
  call('gdc_ret_idl', 'ret.idle@example.org', 'contacted', 366, null);
  call('gdc_ret_act', 'ret.active@example.org', 'contacted', 10, null);
  call('gdc_ret_not', 'ret.noted@example.org', 'new', 366, null);
  // another email to the same address, about something else, is kept
  h.db.insert('outbox_messages', { id: 'obx_ret_other', channel: 'email', to_address: 'ret.closed.old@example.org', subject: 'Something else', body: 'Unrelated.', notification_id: null, status: 'logged', created_at: at(400) });
  // a note added today is activity: that request is no longer idle
  g.addNote(asOwner(), 'discovery_call', 'gdc_ret_not', 'Still talking to them.');
  const corp = (id: string, email: string, status: string, closedDaysAgo: number | null) => {
    h.db.insert('growth_corporate_enquiries', { id, reference: `CE-R${id.slice(-3)}`, company: 'Retention Co', contact_name: 'Retention Contact', email, phone: null, team_size: '11-50', interests: '["coaching"]', message: null, consent_version: g.CONTACT_CONSENT_VERSION, consent_at: at(400), status, assigned_to: null, created_at: at(400), updated_at: at(closedDaysAgo ?? 5), closed_at: closedDaysAgo === null ? null : at(closedDaysAgo) });
    h.db.insert('growth_notes', { id: `gnt_${id}`, ref_type: 'corporate_enquiry', ref_id: id, author_id: null, body: 'A team note.', created_at: at(200) });
    h.db.insert('outbox_messages', { id: `obx_${id}`, channel: 'email', to_address: email, subject: `Your enquiry about Bioptime for teams (CE-R${id.slice(-3)})`, body: 'Hello Retention…', notification_id: null, status: 'logged', created_at: at(400) });
  };
  corp('gce_ret_old', 'ret.corp.old@example.org', 'closed', 200);
  corp('gce_ret_opn', 'ret.corp.open@example.org', 'in_discussion', null);
  const sub = (id: string, email: string, status: string, expiresDaysAgo: number | null, leftDaysAgo: number | null) => {
    h.db.insert('growth_newsletter_subscribers', { id, email, status, consent_version: g.NEWSLETTER_CONSENT_VERSION, source: 'website', confirm_token_hash: null, confirm_expires_at: expiresDaysAgo === null ? null : at(expiresDaysAgo), requested_at: at(40), confirmed_at: status === 'confirmed' ? at(39) : null, unsubscribed_at: leftDaysAgo === null ? null : at(leftDaysAgo), created_at: at(400), updated_at: at(40) });
    h.db.insert('outbox_messages', { id: `obx_${id}`, channel: 'email', to_address: email, subject: 'Confirm your Bioptime newsletter sign-up', body: 'Confirm…', notification_id: null, status: 'logged', created_at: at(40) });
  };
  sub('gns_ret_stale', 'ret.stale@example.org', 'pending', 31, null);
  sub('gns_ret_fresh', 'ret.fresh@example.org', 'pending', 2, null);
  sub('gns_ret_gone', 'ret.gone@example.org', 'unsubscribed', null, 31);
  sub('gns_ret_left', 'ret.left@example.org', 'unsubscribed', null, 2);
  sub('gns_ret_keep', 'ret.keep@example.org', 'confirmed', null, null);

  // the job as the runner wraps it, with the module switched off: it still runs (retention is a privacy duty)
  const job = moduleJobs().find((j) => j.name === 'growth.privacy_retention')!;
  assert.ok(job, 'registered as growth.privacy_retention');
  assert.equal(job.everyMs, 24 * 3_600_000, 'daily');
  h.db.run("UPDATE feature_flags SET enabled = 0 WHERE key = 'growth'");
  let r: g.RetentionResult;
  try { r = (await job.run(h.ctx)) as g.RetentionResult; } finally { h.db.run("UPDATE feature_flags SET enabled = 1 WHERE key = 'growth'"); }
  assert.deepEqual(r, { discoveryCalls: 2, corporateEnquiries: 1, notes: 3, emails: 5, pendingSignups: 1, unsubscribed: 1 });
  const has = (table: string, id: string) => !!h.db.get(`SELECT 1 FROM ${table} WHERE id = ?`, [id]);
  assert.ok(!has('growth_discovery_calls', 'gdc_ret_old'), 'closed 181 days ago: deleted');
  assert.ok(has('growth_discovery_calls', 'gdc_ret_new'), 'closed 179 days ago: kept');
  assert.ok(!has('growth_discovery_calls', 'gdc_ret_idl'), 'open but untouched for a year: deleted');
  assert.ok(has('growth_discovery_calls', 'gdc_ret_act') && has('growth_discovery_calls', 'gdc_ret_not'), 'open and active (a note counts): kept');
  assert.ok(!has('growth_notes', 'gnt_gdc_ret_old') && !has('growth_notes', 'gnt_gdc_ret_idl') && !has('growth_notes', 'gnt_gce_ret_old'), 'their notes went with them');
  assert.ok(has('growth_notes', 'gnt_gdc_ret_new'));
  assert.ok(!has('outbox_messages', 'obx_gdc_ret_old') && !has('outbox_messages', 'obx_gdc_ret_idl') && !has('outbox_messages', 'obx_gce_ret_old'), 'and the confirmation emails recorded to them');
  assert.ok(has('outbox_messages', 'obx_ret_other') && has('outbox_messages', 'obx_gdc_ret_new'), 'other emails stay');
  assert.ok(!has('growth_corporate_enquiries', 'gce_ret_old') && has('growth_corporate_enquiries', 'gce_ret_opn'));
  assert.ok(!has('growth_newsletter_subscribers', 'gns_ret_stale') && !has('outbox_messages', 'obx_gns_ret_stale'), 'a sign-up never confirmed, 31 days after its link expired');
  assert.ok(!has('growth_newsletter_subscribers', 'gns_ret_gone') && !has('outbox_messages', 'obx_gns_ret_gone'), 'an address that left 31 days ago');
  for (const id of ['gns_ret_fresh', 'gns_ret_left', 'gns_ret_keep']) assert.ok(has('growth_newsletter_subscribers', id), `${id} kept`);
  const a = auditRows('growth.retention').at(-1)!;
  assert.equal(a.actor_role, 'system');
  assert.deepEqual(JSON.parse(a.data), { discoveryCalls: 2, corporateEnquiries: 1, notes: 3, emails: 5, pendingSignups: 1, unsubscribed: 1, closedDays: 180, idleDays: 365, pendingDays: 30, unsubscribedDays: 30 });
  assert.ok(!/@|DC-R|CE-R|Retention/.test(a.data), 'counts only: no address, reference or name');
  // nothing left to do: nothing deleted and no second audit row
  const auditsBefore = auditRows('growth.retention').length;
  assert.deepEqual(g.applyRetention(h.ctx), { discoveryCalls: 0, corporateEnquiries: 0, notes: 0, emails: 0, pendingSignups: 0, unsubscribed: 0 });
  assert.equal(auditRows('growth.retention').length, auditsBefore);
  assert.ok(job.idle!({ discoveryCalls: 0, corporateEnquiries: 0, notes: 0, emails: 0, pendingSignups: 0, unsubscribed: 0 }), 'an empty run leaves no jobs_log row');
  // the unsubscribe link of an address already deleted still answers that it is off the list; a forged one does not
  const anon = client(h.app);
  assert.deepEqual((await anon.post('/api/public/newsletter/unsubscribe', { id: 'gns_ret_gone', token: g.unsubscribeToken(h.ctx, 'gns_ret_gone') })).json, { unsubscribed: true });
  assert.equal(code(await anon.post('/api/public/newsletter/unsubscribe', { id: 'gns_ret_gone', token: 'a'.repeat(40) })), 'TOKEN_INVALID');
  // what the visitor agreed to says exactly this, and the earlier wording stays readable on older records
  assert.match(g.CONSENT_TEXTS[g.CONTACT_CONSENT_VERSION]!, /deleted 180 days after the request is closed\.$/);
  assert.equal(g.CLOSED_RETENTION_DAYS, 180);
  assert.ok(g.CONSENT_TEXTS['contact-2026-10-24'], 'the first wording is kept for records made under it');
});

/* ---------- rate limits ---------- */

test('rate limits: five public form posts per address in ten minutes, then 429 RATE_LIMITED', async () => {
  const p = await makeApp({ env: { RATE_LIMITS: 'on' } });
  try {
    const anon = client(p.app);
    for (const [url, body] of [['/api/public/discovery-calls', (i: number) => discovery({ email: `rl${i}@example.org` })], ['/api/public/corporate-enquiries', (i: number) => corporate({ email: `rl${i}@company.example.org` })], ['/api/public/newsletter', (i: number) => signup({ email: `rl${i}@example.org` })]] as Array<[string, (i: number) => Record<string, unknown>]>) {
      for (let i = 0; i < 5; i++) assert.equal((await anon.post(url, body(i))).status, 202, `${url} #${i + 1}`);
      const limited = await anon.post(url, body(6));
      assert.equal(limited.status, 429, url);
      assert.equal(code(limited), 'RATE_LIMITED');
    }
  } finally { await p.app.close(); p.db.close(); }
});

/* ---------- the website pages ---------- */

const site = (rel: string) => fs.readFileSync(path.join(SITE, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(SITE, rel));

test('website: the pages exist, show the consent wording the server records, call only routes that exist and send nothing from the calculators', { skip: !exists('discovery-call.html') && 'the website folder is not next to the platform' }, () => {
  const pages = ['discovery-call.html', 'package-finder.html', 'calculators.html', 'corporate.html', 'webinars.html'];
  for (const p of pages) {
    const html = site(p);
    assert.match(html, /<!-- @page \{/, `${p} is a built page`);
    assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1, `${p}: one h1`);
    assert.ok(!/\bdemo\b/i.test(html.replace(/<!--[\s\S]*?-->/g, '').replace(/demo\.bioptime\.test/g, '')), `${p}: no "demo" a visitor can read`);
  }
  // consent: the exact wording and version the server records
  for (const p of ['discovery-call.html', 'corporate.html']) {
    const html = site(p).replace(/\s+/g, ' ');
    assert.ok(html.replace(/<[^>]+>/g, '').includes(g.CONSENT_TEXTS[g.CONTACT_CONSENT_VERSION]!), `${p} shows the contact consent text`);
    assert.ok(html.includes(`value="${g.CONTACT_CONSENT_VERSION}"`), `${p} sends its version`);
  }
  const footer = site('partials/footer.html').replace(/\s+/g, ' ');
  assert.ok(footer.replace(/<[^>]+>/g, '').includes(g.CONSENT_TEXTS[g.NEWSLETTER_CONSENT_VERSION]!), 'the footer shows the newsletter consent text');
  assert.ok(footer.includes(`value="${g.NEWSLETTER_CONSENT_VERSION}"`));
  assert.ok(footer.includes('id="newsletter"'), 'the emailed links land on the newsletter block');
  assert.ok(footer.includes('action="{{root}}api/public/newsletter"') && footer.includes('method="post"'), 'it works without JavaScript too');
  // each page's script calls only routes this API has
  const js = (n: string) => site(`js/${n}`);
  assert.ok(js('growth-discovery.js').includes("'/public/discovery-calls/slots'") && js('growth-discovery.js').includes("'/public/discovery-calls'"));
  assert.ok(js('growth-corporate.js').includes("'/public/corporate-enquiries'"));
  assert.ok(js('growth-newsletter.js').includes("'/public/newsletter'") && js('growth-newsletter.js').includes("'/public/newsletter/confirm'") && js('growth-newsletter.js').includes("'/public/newsletter/unsubscribe'"));
  assert.ok(js('growth-webinars.js').includes("'/public/webinars'") && js('growth-webinars.js').includes('/register'));
  assert.ok(js('growth-finder.js').includes("'/packages'") && js('growth-finder.js').includes('checkout.html?package='));
  assert.ok(!/\.pricesNote\b/.test(js('growth-finder.js')), 'the finder never shows the API’s note for developers ("null" means pricing on request)');
  assert.ok(js('growth-newsletter.js').includes("c.features.indexOf('growth')"), 'the footer block says so when the module is switched off');
  for (const n of ['growth-discovery.js', 'growth-corporate.js']) assert.ok(js(n).includes('in the last day, a confirmation with your reference is on its way'), `${n}: true even for a repeat request, which sends no second email`);
  assert.match(site('package-finder.html').replace(/\s+/g, ' '), /<p class="priceNote" id="pfPriceNote">Package prices in rupees include GST\./, 'a plain sentence instead');
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon/.test(js('growth-calculators.js')), 'the calculators send nothing anywhere');
  for (const formula of ['Mifflin-St Jeor', '220 − age', 'Karvonen', 'weight (kg) ÷ height (m)²']) assert.ok(site('calculators.html').includes(formula), `the calculators page names ${formula}`);
  assert.ok(site('calculators.html').includes('general information, not a diagnosis or medical advice'));
});
