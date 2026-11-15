/* API support for the rebuilt coach dashboard and the admin pages (30 October 2026, phase 2):
   1. GET /admin/members/:id/workout-templates: the templates an administrator may use in a member's workout programme,
      behind members.manage alone (no library.manage), by the coach's template visibility rule.
   2. Reactivating a coach (PATCH /admin/coaches/:id/state to active) resumes exactly the assignments the account state
      paused (coach_assignments.pause_cause, migration 0038), audited, and the members are told their coach is back;
      assignments an administrator paused, or that the coach's away mark paused, stay as they are. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId } from '../helpers.js';
import { processPending } from '../../src/domain/events.js';

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); h.db.close(); });

const PRIYA = 'priya.nair@demo.bioptime.test'; // coach Asha (DEMO.coach)
const ARJUN = 'arjun.patel@demo.bioptime.test'; // no coach
const DEV = 'dev.kapoor@demo.bioptime.test'; // coach of Sameer and Lakshmi
const SAMEER = 'sameer.khan@demo.bioptime.test';
const LAKSHMI = 'lakshmi.venkat@demo.bioptime.test';
const SUNITA = 'sunita.bhat@demo.bioptime.test'; // with Deepa, coached by Meera (DEMO.coach3)
const signedIn = async (email: string, password: string, workspace: 'member' | 'dashboard', mfa = false) => { const c = client(h.app); await c.login(email, password, workspace, mfa); return c; };
const owner = () => signedIn(DEMO.owner, DEMO_PASSWORDS.owner, 'dashboard', true);
const admin = () => signedIn(DEMO.admin, DEMO_PASSWORDS.admin, 'dashboard', true);
const coach = (email: string) => signedIn(email, DEMO_PASSWORDS.coach, 'dashboard');
const member = (email: string) => signedIn(email, DEMO_PASSWORDS.member, 'member');
const templateId = (title: string) => h.db.get<{ id: string }>('SELECT id FROM workout_templates WHERE title = ?', [title])!.id;
type Tpl = { id: string; title: string; source: string; status: string; createdBy: string | null; itemCount: number; usable: boolean };
type TplList = { items: Tpl[]; coachId: string | null; coachName: string | null; programId: string | null };

/* ---------- 1. the templates an administrator may use for a member ---------- */

test('templates for a member: members.manage alone is enough (library.manage is not needed); coaches, members and admins without members.manage are refused; member ids only', async () => {
  const priya = userId(h.ctx, PRIYA);
  const url = `/api/admin/members/${priya}/workout-templates`;
  for (const x of [await coach(DEMO.coach), await member(PRIYA)]) assert.equal((await x.get(url)).status, 403);
  const o = await owner();
  const a = await admin();
  const adminId = userId(h.ctx, DEMO.admin);
  assert.equal((await o.post(`/api/admin/users/${adminId}/permissions`, { permission: 'library.manage', granted: false, reason: 'test: an administrator without the library' })).status, 200);
  try {
    assert.equal((await a.get('/api/admin/workout-templates')).json.error?.code, 'PERMISSION_DENIED', 'the library list still needs library.manage');
    const r = await a.get(url);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok((r.json as unknown as TplList).items.length > 0);
  } finally {
    await o.post(`/api/admin/users/${adminId}/permissions`, { permission: 'library.manage', granted: true, reason: 'test: restored' });
  }
  assert.equal((await o.post(`/api/admin/users/${adminId}/permissions`, { permission: 'members.manage', granted: false, reason: 'test: without members.manage' })).status, 200);
  try {
    const denied = await a.get(url);
    assert.deepEqual([denied.status, denied.json.error?.code], [403, 'PERMISSION_DENIED']);
  } finally {
    await o.post(`/api/admin/users/${adminId}/permissions`, { permission: 'members.manage', granted: true, reason: 'test: restored' });
  }
  assert.equal((await o.get(`/api/admin/members/${userId(h.ctx, DEMO.coach)}/workout-templates`)).status, 404, 'a coach id is not a member');
  assert.equal((await o.get('/api/admin/members/usr_nothinghere1/workout-templates')).status, 404);
});

test('templates for a member follow the coach’s rule: published team templates and the assigned coach’s own; never drafts, archived ones or another coach’s; the team’s only without a coach', async () => {
  const priya = userId(h.ctx, PRIYA);
  const asha = userId(h.ctx, DEMO.coach);
  const exerciseId = h.db.get<{ id: string }>("SELECT id FROM exercises WHERE status = 'published' LIMIT 1")!.id;
  // a template of another coach, an empty one of Asha's and an archived one of Asha's
  const rahul = await coach(DEMO.coach2);
  const other = await rahul.post('/api/coach/workout-templates', { title: 'Rahul’s circuit', items: [{ exerciseId, sets: 3, reps: '10' }] });
  assert.equal(other.status, 201, JSON.stringify(other.json));
  const ashaC = await coach(DEMO.coach);
  const empty = await ashaC.post('/api/coach/workout-templates', { title: 'Asha’s empty day', items: [] });
  assert.equal(empty.status, 201, JSON.stringify(empty.json));
  const old = await ashaC.post('/api/coach/workout-templates', { title: 'Asha’s old day', items: [{ exerciseId, sets: 2, reps: '8' }] });
  assert.equal((await ashaC.patch(`/api/coach/workout-templates/${old.json.id}`, { status: 'archived' })).status, 200);

  const o = await owner();
  const r = await o.get(`/api/admin/members/${priya}/workout-templates`);
  assert.equal(r.status, 200);
  const list = r.json as unknown as TplList;
  assert.deepEqual([list.coachId, list.coachName, list.programId], [asha, 'Asha Menon', null]);
  const titles = list.items.map((t) => t.title).sort();
  // the team's published templates include the five of the preview member's programme (api/seed/showcase.ts)
  assert.deepEqual(titles, ['Asha’s empty day', 'Conditioning and core', 'Full body A', 'Full body and core', 'Lower body', 'Lower body A', 'Mobility and recovery', 'Upper body A', 'Walk and mobility'].sort(), 'team published + Asha’s own; not Full body B (a draft), not the archived one, not Rahul’s');
  assert.equal(list.items.find((t) => t.title === 'Asha’s empty day')!.usable, false, 'an empty template is listed as not usable yet');
  assert.ok(list.items.filter((t) => t.title !== 'Asha’s empty day').every((t) => t.usable && t.itemCount > 0));

  // the same rule as the coach's own list (GET /coach/workout-templates), so the admin and the coach see the same choice
  const coachList = ((await ashaC.get('/api/coach/workout-templates')).json.items as Tpl[]).map((t) => t.id).sort();
  assert.deepEqual(list.items.map((t) => t.id).sort(), coachList);

  // every usable template listed is accepted when the administrator creates the programme; another coach's is refused
  for (const t of list.items.filter((x) => x.usable)) {
    const c = await o.post(`/api/admin/members/${priya}/workout-programs`, { title: `From ${t.title}`, templateId: t.id, weeks: 1, days: [2] });
    assert.equal(c.status, 201, `${t.title}: ${JSON.stringify(c.json)}`);
  }
  const refused = await o.post(`/api/admin/members/${priya}/workout-programs`, { title: 'Not allowed', templateId: other.json.id, weeks: 1, days: [2] });
  assert.equal(refused.json.error?.code, 'TEMPLATE_UNAVAILABLE');

  // a member without a coach: the team's published templates only
  const none = (await o.get(`/api/admin/members/${userId(h.ctx, ARJUN)}/workout-templates`)).json as unknown as TplList;
  assert.deepEqual([none.coachId, none.coachName], [null, null]);
  assert.deepEqual(none.items.map((t) => t.title).sort(), ['Conditioning and core', 'Full body A', 'Full body and core', 'Lower body A', 'Mobility and recovery', 'Upper body A', 'Walk and mobility']);
  assert.ok(none.items.every((t) => t.source === 'team' && t.status === 'published'));
});

test('templates for an existing programme: that programme’s coach’s rule plus the templates its published version already uses; a programme of another member is not found', async () => {
  const o = await owner();
  const ananya = userId(h.ctx, DEMO.member);
  const program = h.db.get<{ id: string }>("SELECT id FROM workout_programs WHERE member_id = ? AND status = 'published'", [ananya])!;
  const used = new Set<string>();
  const v = h.db.get<{ structure: string }>("SELECT structure FROM workout_program_versions WHERE program_id = ? AND status = 'published'", [program.id])!;
  for (const w of JSON.parse(v.structure).weeks) for (const d of w.days) used.add(d.templateId);
  assert.ok(used.has(templateId('Lower body')), 'the seeded programme uses Asha’s own template');

  // Ananya moves to Dev: Dev takes the programme over; Asha's template stays usable in it, not in a new programme
  const dev = userId(h.ctx, DEV);
  assert.equal((await o.post('/api/admin/assignments', { memberId: ananya, coachId: dev, reason: 'test: Ananya to Dev' })).status, 201);
  await processPending(h.ctx);
  const forNew = (await o.get(`/api/admin/members/${ananya}/workout-templates`)).json as unknown as TplList;
  assert.equal(forNew.coachId, dev);
  assert.ok(!forNew.items.some((t) => t.title === 'Lower body'), 'a new programme for Ananya cannot use Asha’s own template');
  const forProgram = (await o.get(`/api/admin/members/${ananya}/workout-templates?programId=${program.id}`)).json as unknown as TplList;
  assert.deepEqual([forProgram.coachId, forProgram.programId], [dev, program.id]);
  assert.ok(forProgram.items.some((t) => t.title === 'Lower body'), 'the programme keeps the templates it already uses');
  for (const id of used) assert.ok(forProgram.items.some((t) => t.id === id), id);

  const other = h.db.get<{ id: string }>('SELECT id FROM workout_programs WHERE member_id != ? LIMIT 1', [ananya])!;
  assert.equal((await o.get(`/api/admin/members/${ananya}/workout-templates?programId=${other.id}`)).status, 404);
  assert.equal((await o.get(`/api/admin/members/${ananya}/workout-templates?programId=wpg_nothinghere1`)).status, 404);

  // Ananya goes back to Asha (the tests below count Dev's assignments)
  assert.equal((await o.post('/api/admin/assignments', { memberId: ananya, coachId: userId(h.ctx, DEMO.coach), reason: 'test: Ananya back to Asha' })).status, 201);
  await processPending(h.ctx);
});

test('templates for a member answer FEATURE_DISABLED while the workouts module is off', async () => {
  const o = await owner();
  assert.equal((await o.patch('/api/admin/modules', { key: 'workouts', enabled: false, reason: 'test: switch workouts off' })).status, 200);
  try {
    const r = await o.get(`/api/admin/members/${userId(h.ctx, PRIYA)}/workout-templates`);
    assert.deepEqual([r.status, r.json.error?.code], [403, 'FEATURE_DISABLED']);
  } finally {
    assert.equal((await o.patch('/api/admin/modules', { key: 'workouts', enabled: true, reason: 'test: switch workouts back on' })).status, 200);
  }
});

/* ---------- 2. reactivating a coach resumes what the account state paused ---------- */

const assignmentOf = (memberEmail: string) => h.db.get<{ id: string; status: string; pause_cause: string | null; coach_id: string }>("SELECT id, status, pause_cause, coach_id FROM coach_assignments WHERE member_id = ? AND status IN ('active','paused') ORDER BY created_at DESC LIMIT 1", [userId(h.ctx, memberEmail)])!;
const notes = (memberEmail: string, title: string) => h.db.get<{ n: number }>('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND title = ?', [userId(h.ctx, memberEmail), title])!.n;
type Changed = { paused: number; resumed: number; waitingForReturn: number };
const changed = (r: { json: Record<string, unknown> }) => r.json.assignments as Changed;
const lastAudit = (action: string, targetId: string) => h.db.get<{ actor_id: string | null; reason: string | null; data: string }>('SELECT actor_id, reason, data FROM audit_events WHERE action = ? AND target_id = ? ORDER BY at DESC, rowid DESC LIMIT 1', [action, targetId]);

test('deactivate then reactivate a coach: the assignments the deactivation paused resume, members are told, it is audited; an assignment an administrator paused stays paused', async () => {
  const o = await owner();
  const dev = userId(h.ctx, DEV);
  const sameer = assignmentOf(SAMEER), lakshmi = assignmentOf(LAKSHMI);
  assert.deepEqual([sameer.status, lakshmi.status], ['active', 'active']);
  // an administrator pauses Lakshmi's assignment for a reason of their own
  assert.equal((await o.post(`/api/admin/assignments/${lakshmi.id}/pause`, { reason: 'test: Lakshmi asked for a break' })).status, 200);
  assert.equal(assignmentOf(LAKSHMI).pause_cause, 'manual');
  const backBefore = { sameer: notes(SAMEER, 'Your coach is back'), lakshmi: notes(LAKSHMI, 'Your coach is back') };

  const off = await o.patch(`/api/admin/coaches/${dev}/state`, { state: 'deactivated', reason: 'test: on a long break' });
  assert.equal(off.status, 200, JSON.stringify(off.json));
  assert.deepEqual([off.json.state, changed(off)], ['deactivated', { paused: 1, resumed: 0, waitingForReturn: 0 }]);
  assert.deepEqual([assignmentOf(SAMEER).status, assignmentOf(SAMEER).pause_cause], ['paused', 'coach_account']);
  assert.deepEqual([assignmentOf(LAKSHMI).status, assignmentOf(LAKSHMI).pause_cause], ['paused', 'manual'], 'the administrator’s pause keeps its own cause');
  assert.equal(notes(SAMEER, 'Your coach is away') >= 1, true);
  const pausedAudit = lastAudit('coach.assignments_paused', dev)!;
  assert.deepEqual(JSON.parse(pausedAudit.data).assignmentIds, [sameer.id]);
  assert.equal(JSON.parse(lastAudit('assignment.paused', sameer.id)!.data).cause, 'coach_account');

  const on = await o.patch(`/api/admin/coaches/${dev}/state`, { state: 'active', reason: 'test: back with Bioptime' });
  assert.equal(on.status, 200, JSON.stringify(on.json));
  assert.deepEqual([on.json.state, changed(on)], ['active', { paused: 0, resumed: 1, waitingForReturn: 0 }]);
  assert.deepEqual([assignmentOf(SAMEER).status, assignmentOf(SAMEER).pause_cause], ['active', null], 'Sameer’s assignment resumed');
  assert.deepEqual([assignmentOf(LAKSHMI).status, assignmentOf(LAKSHMI).pause_cause], ['paused', 'manual'], 'Lakshmi’s stays paused');
  assert.equal(notes(SAMEER, 'Your coach is back'), backBefore.sameer + 1, 'Sameer is told the coach is back');
  assert.equal(notes(LAKSHMI, 'Your coach is back'), backBefore.lakshmi, 'Lakshmi is not');
  const resumed = lastAudit('coach.assignments_resumed', dev)!;
  assert.deepEqual([resumed.actor_id, resumed.reason, JSON.parse(resumed.data).assignmentIds, JSON.parse(resumed.data).from], [userId(h.ctx, DEMO.owner), 'test: back with Bioptime', [sameer.id], 'deactivated']);
  const one = lastAudit('assignment.active', sameer.id)!;
  assert.deepEqual([one.reason, JSON.parse(one.data).pausedFor], ['account reactivated: test: back with Bioptime', 'coach_account']);

  // the coach's clients are back on the coach's list and the member's app names the coach as active
  const devC = await coach(DEV);
  const clients = (await devC.get('/api/coach/clients?status=active')).json.items as Array<{ id: string }>;
  assert.ok(clients.some((c) => c.id === userId(h.ctx, SAMEER)));
  const me = await member(SAMEER);
  const mine = (await me.get('/api/me/coach')).json as { assignment: { coachId: string; status: string } | null };
  assert.deepEqual([mine.assignment?.coachId, mine.assignment?.status], [dev, 'active']);

  // and the same from suspended
  assert.equal(changed(await o.patch(`/api/admin/coaches/${dev}/state`, { state: 'suspended', reason: 'test: suspended briefly' })).paused, 1);
  assert.equal(changed(await o.patch(`/api/admin/coaches/${dev}/state`, { state: 'active', reason: 'test: suspension lifted' })).resumed, 1);
  assert.equal(assignmentOf(SAMEER).status, 'active');
  assert.equal(assignmentOf(LAKSHMI).status, 'paused');
  assert.equal((await o.post(`/api/admin/assignments/${lakshmi.id}/resume`, { reason: 'test: Lakshmi is back' })).status, 200);
  assert.deepEqual([assignmentOf(LAKSHMI).status, assignmentOf(LAKSHMI).pause_cause], ['active', null]);
});

test('a reopened closed coach gets back what the account state paused; a refused transition changes nothing', async () => {
  const o = await owner();
  const rahul = userId(h.ctx, DEMO.coach2);
  const vikram = assignmentOf(DEMO.member2);
  assert.equal(vikram.status, 'active');
  assert.equal((await o.patch(`/api/admin/coaches/${rahul}/state`, { state: 'deactivated', reason: 'test: leaving' })).status, 200);
  assert.equal(changed(await o.patch(`/api/admin/coaches/${rahul}/state`, { state: 'closed', reason: 'test: closed' })).paused, 0, 'nothing active is left to pause');
  assert.equal(assignmentOf(DEMO.member2).pause_cause, 'coach_account');
  // a refused transition (closed to suspended) leaves the assignments as they are
  const bad = await o.patch(`/api/admin/coaches/${rahul}/state`, { state: 'suspended', reason: 'test: not allowed' });
  assert.equal(bad.status, 409, JSON.stringify(bad.json));
  assert.equal(assignmentOf(DEMO.member2).status, 'paused');
  const reopen = await o.patch(`/api/admin/coaches/${rahul}/state`, { state: 'active', reason: 'test: reopened' });
  assert.equal(reopen.status, 200, JSON.stringify(reopen.json));
  assert.equal(changed(reopen).resumed, 1);
  assert.equal(assignmentOf(DEMO.member2).status, 'active');
});

test('away and account state together: each cause resumes only what it paused, and a coach still away keeps the account’s assignments paused until they return', async () => {
  const o = await owner();
  const meera = userId(h.ctx, DEMO.coach3);
  const deepa = () => assignmentOf(DEMO.memberNoShare), sunita = () => assignmentOf(SUNITA);
  assert.deepEqual([deepa().status, sunita().status], ['active', 'active']);

  // (a) away first, then deactivated and reactivated: the away mark's pauses wait for the coach's return
  assert.equal((await o.post(`/api/admin/coaches/${meera}/availability`, { available: false, reason: 'test: on leave' })).status, 200);
  assert.deepEqual([deepa().pause_cause, sunita().pause_cause], ['coach_away', 'coach_away']);
  assert.deepEqual(changed(await o.patch(`/api/admin/coaches/${meera}/state`, { state: 'deactivated', reason: 'test: off' })), { paused: 0, resumed: 0, waitingForReturn: 0 });
  assert.deepEqual(changed(await o.patch(`/api/admin/coaches/${meera}/state`, { state: 'active', reason: 'test: on' })), { paused: 0, resumed: 0, waitingForReturn: 0 });
  assert.deepEqual([deepa().status, sunita().status], ['paused', 'paused'], 'still away: nothing resumes on reactivation');
  assert.equal((await o.post(`/api/admin/coaches/${meera}/availability`, { available: true, reason: 'test: back from leave' })).status, 200);
  assert.deepEqual([deepa().status, sunita().status], ['active', 'active'], 'the return resumes them');

  // (b) deactivated first, marked away while deactivated, reactivated while away: they wait for the return
  assert.equal(changed(await o.patch(`/api/admin/coaches/${meera}/state`, { state: 'deactivated', reason: 'test: off again' })).paused, 2);
  assert.equal((await o.post(`/api/admin/coaches/${meera}/availability`, { available: false, reason: 'test: leave while off' })).status, 200);
  const held = await o.patch(`/api/admin/coaches/${meera}/state`, { state: 'active', reason: 'test: on while away' });
  assert.deepEqual(changed(held), { paused: 0, resumed: 0, waitingForReturn: 2 });
  assert.deepEqual([deepa().status, deepa().pause_cause], ['paused', 'coach_away']);
  const heldAudit = JSON.parse(lastAudit('coach.assignments_held', meera)!.data);
  assert.deepEqual([heldAudit.from, heldAudit.to, heldAudit.assignmentIds.length], ['coach_account', 'coach_away', 2]);
  assert.equal((await o.post(`/api/admin/coaches/${meera}/availability`, { available: true, reason: 'test: back' })).status, 200);
  assert.deepEqual([deepa().status, sunita().status], ['active', 'active']);

  // (c) away, then deactivated, then the away period ends while the account is off: they wait for the reactivation
  assert.equal((await o.post(`/api/admin/coaches/${meera}/availability`, { available: false, reason: 'test: leave' })).status, 200);
  assert.equal((await o.patch(`/api/admin/coaches/${meera}/state`, { state: 'deactivated', reason: 'test: off during leave' })).status, 200);
  assert.equal((await o.post(`/api/admin/coaches/${meera}/availability`, { available: true, reason: 'test: leave over, account still off' })).status, 200);
  assert.deepEqual([deepa().status, deepa().pause_cause], ['paused', 'coach_account'], 'the return resumes nothing while the account is off');
  assert.deepEqual(changed(await o.patch(`/api/admin/coaches/${meera}/state`, { state: 'active', reason: 'test: on' })), { paused: 0, resumed: 2, waitingForReturn: 0 });
  assert.deepEqual([deepa().status, sunita().status], ['active', 'active']);
});

test('a coach’s return from away no longer resumes an assignment an administrator paused', async () => {
  const o = await owner();
  const meera = userId(h.ctx, DEMO.coach3);
  const sunita = assignmentOf(SUNITA);
  assert.equal((await o.post(`/api/admin/assignments/${sunita.id}/pause`, { reason: 'test: paused by the team' })).status, 200);
  const m = await coach(DEMO.coach3);
  assert.equal((await m.post('/api/coach/availability/status', { available: false, reason: 'test: a day off' })).status, 200);
  assert.equal(assignmentOf(DEMO.memberNoShare).pause_cause, 'coach_away');
  assert.equal((await m.post('/api/coach/availability/status', { available: true, reason: 'test: back' })).status, 200);
  assert.equal(assignmentOf(DEMO.memberNoShare).status, 'active');
  assert.deepEqual([assignmentOf(SUNITA).status, assignmentOf(SUNITA).pause_cause], ['paused', 'manual']);
  assert.equal((await o.post(`/api/admin/assignments/${sunita.id}/resume`, { reason: 'test: resumed by the team' })).status, 200);
  assert.ok(meera);
});

test('migration 0038 tags assignments paused before it existed: by the account state (coach still not active), by the away mark (coach away now), otherwise manual', async () => {
  const sql = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/db/migrations/0038_assignment_pause_cause.sql'), 'utf8');
  const backfill = sql.slice(sql.indexOf('UPDATE coach_assignments'));
  const now = new Date().toISOString();
  const coachA = userId(h.ctx, DEV), coachB = userId(h.ctx, DEMO.coach2), coachC = userId(h.ctx, DEMO.coach);
  const memberId = userId(h.ctx, ARJUN);
  const rows = [
    { id: 'asg_backfill_acct', coach: coachA, reason: 'account deactivated: left' },
    { id: 'asg_backfill_acct_active', coach: coachC, reason: 'account suspended: lifted before 0038' },
    { id: 'asg_backfill_away', coach: coachB, reason: 'On leave' },
    { id: 'asg_backfill_manual', coach: coachC, reason: 'Member asked for a break' },
  ];
  h.db.tx(() => {
    for (const r of rows) h.db.insert('coach_assignments', { id: r.id, member_id: memberId, coach_id: r.coach, programme_id: null, request_id: null, status: 'paused', method: 'manual', reason: r.reason, effective_at: now, created_by: 'system', created_at: now });
    h.db.run("UPDATE users SET state = 'deactivated' WHERE id = ?", [coachA]);
    h.db.run('UPDATE coach_profiles SET available = 0 WHERE user_id = ?', [coachB]);
    h.db.exec(backfill);
    const got = Object.fromEntries(h.db.all<{ id: string; pause_cause: string | null }>(`SELECT id, pause_cause FROM coach_assignments WHERE id LIKE 'asg_backfill_%'`).map((r) => [r.id, r.pause_cause]));
    assert.deepEqual(got, { asg_backfill_acct: 'coach_account', asg_backfill_acct_active: 'manual', asg_backfill_away: 'coach_away', asg_backfill_manual: 'manual' });
    // undo (this test leaves the shared database as it found it)
    h.db.run("DELETE FROM coach_assignments WHERE id LIKE 'asg_backfill_%'");
    h.db.run("UPDATE users SET state = 'active' WHERE id = ?", [coachA]);
    h.db.run('UPDATE coach_profiles SET available = 1 WHERE user_id = ?', [coachB]);
  });
  assert.throws(() => h.db.run("UPDATE coach_assignments SET pause_cause = 'whatever' WHERE id = (SELECT id FROM coach_assignments LIMIT 1)"), /CHECK/);
});

/* ---------- 3. what the rebuilt coach pages read ---------- */

type PlanItem = { id: string; memberId: string; memberName: string; title: string; status: string; hasDraft: boolean; summary: string; meals: number; days: number; frequency: string; publishedAt: string | null };
type PlanList = { items: PlanItem[]; counts: { total: number; draft: number; published: number; archived: number; withOpenDraft: number } };
const RESTRICTED = /"(email|phone|address|pincode|pinCode|dateOfBirth|date_of_birth|dob|governmentId|pan|aadhaar)"\s*:/i;

test('GET /coach/meal-plans: the meal plans of my assigned clients only, summarised, with counts and filters; no health view is recorded; never a restricted field', async () => {
  const asha = await coach(DEMO.coach);
  const healthViews = () => h.db.get<{ n: number }>("SELECT COUNT(*) n FROM audit_events WHERE action = 'health.viewed'")!.n;
  const views = healthViews();
  const r = await asha.get('/api/coach/meal-plans');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.doesNotMatch(r.text, RESTRICTED);
  const list = r.json as unknown as PlanList;
  const ashaClients = new Set(h.db.all<{ member_id: string }>("SELECT member_id FROM coach_assignments WHERE coach_id = ? AND status IN ('active','paused')", [userId(h.ctx, DEMO.coach)]).map((x) => x.member_id));
  const expected = h.db.all<{ id: string; member_id: string }>('SELECT id, member_id FROM meal_plans').filter((p) => ashaClients.has(p.member_id)).map((p) => p.id).sort();
  assert.deepEqual(list.items.map((p) => p.id).sort(), expected, 'exactly the plans of Asha’s clients');
  assert.ok(expected.length >= 2);
  assert.ok(!list.items.some((p) => p.memberId === userId(h.ctx, DEMO.memberNoShare)), 'not Meera’s client’s plan');
  assert.equal(healthViews(), views, 'a list of plans reads no health record');
  assert.deepEqual(list.counts, { total: expected.length, draft: list.items.filter((p) => p.status === 'draft').length, published: list.items.filter((p) => p.status === 'published').length, archived: list.items.filter((p) => p.status === 'archived').length, withOpenDraft: list.items.filter((p) => p.hasDraft).length });
  const published = list.items.find((p) => p.status === 'published' && !p.hasDraft)!;
  const slots = h.db.get<{ meals: number; days: number }>("SELECT COUNT(*) meals, COUNT(DISTINCT s.day) days FROM meal_plan_slots s JOIN meal_plan_versions v ON v.id = s.plan_version_id JOIN meal_plans p ON p.id = v.plan_id WHERE p.id = ? AND v.status = 'published' AND v.version = p.current_version", [published.id])!;
  assert.deepEqual([published.meals, published.days], [slots.meals, slots.days]);
  assert.ok(published.publishedAt);
  // frequency: 'daily' only when all seven days hold the same meals; the seeded week varies, so 'weekly'
  const perDay = new Map<number, string>();
  for (const x of h.db.all<{ day: number; slot: string; title: string }>("SELECT s.day, s.slot, s.title FROM meal_plan_slots s JOIN meal_plan_versions v ON v.id = s.plan_version_id JOIN meal_plans p ON p.id = v.plan_id WHERE p.id = ? AND v.status = 'published' AND v.version = p.current_version ORDER BY s.day, s.sort", [published.id])) perDay.set(x.day, `${perDay.get(x.day) ?? ''}|${x.slot}:${x.title.trim().toLowerCase()}`);
  assert.equal(published.frequency, perDay.size === 7 && new Set(perDay.values()).size === 1 ? 'daily' : 'weekly');
  assert.ok(list.items.every((p) => ['daily', 'weekly', 'empty'].includes(p.frequency) && (p.frequency === 'empty') === (p.meals === 0)));

  // filters
  const drafts = (await asha.get('/api/coach/meal-plans?status=draft')).json as unknown as PlanList;
  assert.ok(drafts.items.length >= 1 && drafts.items.every((p) => p.status === 'draft'));
  assert.equal(drafts.counts.total, list.counts.total, 'counts are before the filters');
  const byName = (await asha.get(`/api/coach/meal-plans?q=${encodeURIComponent('Priya')}`)).json as unknown as PlanList;
  assert.ok(byName.items.length >= 1 && byName.items.every((p) => p.memberName === 'Priya Nair'));
  const byTitle = (await asha.get(`/api/coach/meal-plans?q=${encodeURIComponent(published.title.slice(0, 6))}`)).json as unknown as PlanList;
  assert.ok(byTitle.items.some((p) => p.id === published.id));
  assert.deepEqual(((await asha.get('/api/coach/meal-plans?q=%25')).json as unknown as PlanList).items, [], 'a % is matched literally');
  const one = (await asha.get(`/api/coach/meal-plans?memberId=${published.memberId}`)).json as unknown as PlanList;
  assert.ok(one.items.length >= 1 && one.items.every((p) => p.memberId === published.memberId));
  const notMine = await asha.get(`/api/coach/meal-plans?memberId=${userId(h.ctx, DEMO.memberNoShare)}`);
  assert.deepEqual([notMine.status, notMine.json.error?.code], [403, 'NO_ACCESS']);
  assert.equal((await asha.get('/api/coach/meal-plans?status=nonsense')).json.error?.code, 'VALIDATION_FAILED');

  // an open revision of a published plan: still published, hasDraft, and the draft's title and summary
  assert.equal((await asha.patch(`/api/coach/meal-plans/${published.id}`, { title: 'Regular meals, revised', summary: 'Revised timing.' })).status, 200);
  const after = ((await asha.get('/api/coach/meal-plans')).json as unknown as PlanList).items.find((p) => p.id === published.id)!;
  assert.deepEqual([after.status, after.hasDraft, after.title, after.summary], ['published', true, 'Regular meals, revised', 'Revised timing.']);
  const sameEveryDay = [1, 2, 3, 4, 5, 6, 7].flatMap((day) => [{ day, slot: 'breakfast', title: 'Poha' }, { day, slot: 'dinner', title: 'Dal and rice' }]);
  assert.equal((await asha.patch(`/api/coach/meal-plans/${published.id}`, { slots: sameEveryDay })).status, 200);
  const daily = ((await asha.get('/api/coach/meal-plans')).json as unknown as PlanList).items.find((p) => p.id === published.id)!;
  assert.deepEqual([daily.frequency, daily.meals, daily.days], ['daily', 14, 7], 'the open revision decides: the same two meals every day');
  assert.equal((await asha.patch(`/api/coach/meal-plans/${published.id}`, { slots: sameEveryDay.filter((x) => x.day !== 7) })).status, 200);
  assert.equal(((await asha.get('/api/coach/meal-plans')).json as unknown as PlanList).items.find((p) => p.id === published.id)!.frequency, 'weekly', 'a day without meals makes it weekly');

  // a client who does not share health records: their plan is listed for their coach (as on the client's Nutrition tab)
  const meera = await coach(DEMO.coach3);
  const meeras = (await meera.get('/api/coach/meal-plans')).json as unknown as PlanList;
  assert.ok(meeras.items.some((p) => p.memberId === userId(h.ctx, DEMO.memberNoShare)));
  assert.doesNotMatch(JSON.stringify(meeras), RESTRICTED);

  // members and administrators are refused; the nutrition flag switches it off
  assert.equal((await (await member(DEMO.member)).get('/api/coach/meal-plans')).status, 403);
  const o = await owner();
  assert.equal((await o.get('/api/coach/meal-plans')).status, 403);
  assert.equal((await o.patch('/api/admin/modules', { key: 'nutrition', enabled: false, reason: 'test: switch nutrition off' })).status, 200);
  try {
    assert.equal((await asha.get('/api/coach/meal-plans')).json.error?.code, 'FEATURE_DISABLED');
  } finally {
    assert.equal((await o.patch('/api/admin/modules', { key: 'nutrition', enabled: true, reason: 'test: switch nutrition back on' })).status, 200);
  }
});

test('workout templates carry the distinct categories, muscle groups and equipment of their exercises (for the plan cards), in the coach and admin lists', async () => {
  const expectTags = (id: string) => {
    const rows = h.db.all<{ category: string; muscle_groups: string; equipment: string }>('SELECT e.category, e.muscle_groups, e.equipment FROM workout_template_items i JOIN exercises e ON e.id = i.exercise_id WHERE i.template_id = ?', [id]);
    const uniq = (xs: string[]) => [...new Set(xs)].sort();
    return { categories: uniq(rows.map((r) => r.category)), muscleGroups: uniq(rows.flatMap((r) => JSON.parse(r.muscle_groups) as string[])), equipment: uniq(rows.flatMap((r) => JSON.parse(r.equipment) as string[])) };
  };
  const asha = await coach(DEMO.coach);
  type Tagged = Tpl & { categories: string[]; muscleGroups: string[]; equipment: string[] };
  const items = (await asha.get('/api/coach/workout-templates')).json.items as Tagged[];
  assert.ok(items.length >= 3);
  for (const t of items) assert.deepEqual({ categories: t.categories, muscleGroups: t.muscleGroups, equipment: t.equipment }, expectTags(t.id), t.title);
  const full = items.find((t) => t.title === 'Full body A')!;
  assert.ok(full.categories.length >= 1);
  const one = (await asha.get(`/api/coach/workout-templates/${full.id}`)).json as unknown as Tagged;
  assert.deepEqual(one.categories, full.categories);
  const empty = items.find((t) => t.itemCount === 0);
  if (empty) assert.deepEqual([empty.categories, empty.muscleGroups, empty.equipment], [[], [], []]);
  const o = await owner();
  const adminItems = (await o.get('/api/admin/workout-templates')).json.items as Tagged[];
  assert.deepEqual(adminItems.find((t) => t.id === full.id)!.categories, full.categories);
  const forMember = (await o.get(`/api/admin/members/${userId(h.ctx, PRIYA)}/workout-templates`)).json.items as Tagged[];
  assert.deepEqual(forMember.find((t) => t.id === full.id)!.muscleGroups, full.muscleGroups);
});

test('POST /coach/meal-plans/:id/copy: one of my plans becomes a new draft for another of my clients (same meals and targets, my library only); nothing reaches that client until published', async () => {
  const asha = await coach(DEMO.coach);
  const ananya = userId(h.ctx, DEMO.member), priya = userId(h.ctx, PRIYA), deepa = userId(h.ctx, DEMO.memberNoShare);
  const src = h.db.get<{ id: string; title: string }>("SELECT id, title FROM meal_plans WHERE member_id = ? AND status = 'published'", [ananya])!;
  // the source's open revision (opened by the meal plan list test above) is what the editor shows, so it is what is copied
  const srcVersion = h.db.get<{ id: string; title: string | null; summary: string; targets: string }>("SELECT id, title, summary, targets FROM meal_plan_versions WHERE plan_id = ? ORDER BY CASE status WHEN 'draft' THEN 0 ELSE 1 END, version DESC LIMIT 1", [src.id])!;
  const srcSlots = h.db.all<{ day: number; slot: string; title: string; food_id: string | null; recipe_id: string | null }>('SELECT day, slot, title, food_id, recipe_id FROM meal_plan_slots WHERE plan_version_id = ? ORDER BY day, sort', [srcVersion.id]);
  assert.ok(srcSlots.length > 0);
  const auditsBefore = h.db.get<{ n: number }>("SELECT COUNT(*) n FROM audit_events WHERE action = 'health.viewed'")!.n;

  const r = await asha.post(`/api/coach/meal-plans/${src.id}/copy`, { memberId: priya });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.doesNotMatch(r.text, RESTRICTED);
  const copy = r.json as { id: string; memberId: string; status: string; title: string; hasDraft: boolean; version: { status: string; summary: string; targets: Record<string, unknown>; slots: Array<{ day: number; slot: string; title: string; food: { id: string } | null; recipe: { id: string } | null }> } };
  assert.deepEqual([copy.memberId, copy.status, copy.hasDraft, copy.version.status], [priya, 'draft', true, 'draft']);
  assert.equal(copy.title, srcVersion.title || src.title);
  assert.equal(copy.version.summary, srcVersion.summary);
  assert.deepEqual(copy.version.targets, JSON.parse(srcVersion.targets));
  assert.deepEqual(copy.version.slots.map((s) => [s.day, s.slot, s.title, s.food?.id ?? null, s.recipe?.id ?? null]), srcSlots.map((s) => [s.day, s.slot, s.title, s.food_id, s.recipe_id]));
  const copied = h.db.get<{ data: string; actor_id: string }>("SELECT data, actor_id FROM audit_events WHERE action = 'meal_plan.copy' AND target_id = ?", [copy.id])!;
  assert.deepEqual([JSON.parse(copied.data).from, copied.actor_id], [src.id, userId(h.ctx, DEMO.coach)]);
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM audit_events WHERE action = 'health.viewed'")!.n, auditsBefore);
  // Priya does not see a draft
  const m = await member(PRIYA);
  const mine = (await m.get('/api/me/meal-plan')).json as { plan: { id: string } | null };
  assert.notEqual(mine.plan?.id, copy.id);
  // a title of the coach's own choosing
  const named = await asha.post(`/api/coach/meal-plans/${src.id}/copy`, { memberId: priya, title: 'Regular meals for Priya' });
  assert.equal((named.json as { title: string }).title, 'Regular meals for Priya');
  // and it is listed for the coach as a draft
  assert.ok(((await asha.get(`/api/coach/meal-plans?memberId=${priya}&status=draft`)).json as unknown as PlanList).items.some((p) => p.id === copy.id));

  // not to another coach's client, not from another coach's client's plan
  assert.equal((await asha.post(`/api/coach/meal-plans/${src.id}/copy`, { memberId: deepa })).json.error?.code, 'NO_ACCESS');
  const meeraPlan = h.db.get<{ id: string }>('SELECT id FROM meal_plans WHERE member_id = ?', [deepa])!;
  assert.equal((await asha.post(`/api/coach/meal-plans/${meeraPlan.id}/copy`, { memberId: priya })).status, 403);
  assert.equal((await asha.post('/api/coach/meal-plans/mpl_nothinghere1/copy', { memberId: priya })).status, 404);
  assert.equal((await asha.post(`/api/coach/meal-plans/${src.id}/copy`, {})).json.error?.code, 'VALIDATION_FAILED');

  // an item outside the coach's own library (another coach's draft food) is refused, not spread to another client
  const rahul = await coach(DEMO.coach2);
  const food = await rahul.post('/api/coach/foods', { name: 'Rahul’s draft dal' });
  assert.equal(food.status, 201, JSON.stringify(food.json));
  h.db.insert('meal_plan_slots', { id: 'mps_copytest0001', plan_version_id: srcVersion.id, day: 7, slot: 'other', time_hint: null, recipe_id: null, food_id: (food.json as { id: string }).id, title: 'Rahul’s draft dal', portion_note: '', sort: 99 });
  try {
    assert.equal((await asha.post(`/api/coach/meal-plans/${src.id}/copy`, { memberId: priya })).json.error?.code, 'FOOD_UNAVAILABLE');
  } finally {
    h.db.run("DELETE FROM meal_plan_slots WHERE id = 'mps_copytest0001'");
  }
});
