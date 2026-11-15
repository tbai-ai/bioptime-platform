/* Administrators write a member's workout programmes (30 October 2026), mirroring the coach routes: members.manage,
   audited with by: 'admin', the same validation (the domain functions are shared), and the result reaches the member's
   app exactly as a coach's programme does; the assigned coach sees it on the client record and can keep editing it. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId } from '../helpers.js';
import { todayIst, exportProgramsForMember } from '../../src/domain/workouts.js';

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); h.db.close(); });

const PRIYA = 'priya.nair@demo.bioptime.test'; // coach: Asha (DEMO.coach); no workout programme in the seed
const ARJUN = 'arjun.patel@demo.bioptime.test'; // no coach
const signedIn = async (email: string, password: string, workspace: 'member' | 'dashboard', mfa = false) => { const c = client(h.app); await c.login(email, password, workspace, mfa); return c; };
const owner = () => signedIn(DEMO.owner, DEMO_PASSWORDS.owner, 'dashboard', true);
const admin = () => signedIn(DEMO.admin, DEMO_PASSWORDS.admin, 'dashboard', true);
const coach = (email: string) => signedIn(email, DEMO_PASSWORDS.coach, 'dashboard');
const member = (email: string) => signedIn(email, DEMO_PASSWORDS.member, 'member');
const templateId = (title: string) => h.db.get<{ id: string }>('SELECT id FROM workout_templates WHERE title = ?', [title])!.id;
const day = (offset: number) => new Date(Date.parse(`${todayIst(h.ctx)}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
const auditRow = (action: string, id: string) => h.db.get<{ actor_id: string; actor_role: string; reason: string | null; data: string }>('SELECT actor_id, actor_role, reason, data FROM audit_events WHERE action = ? AND target_id = ? ORDER BY at DESC, rowid DESC LIMIT 1', [action, id]);
type Program = { id: string; memberId: string; coachId: string; coachName: string; title: string; status: string; currentVersion: number; draft: { version: number; structure: { weeks: Array<{ week: number; days: Array<{ day: number; templateId: string }> }> } } | null; published: { version: number } | null; sessions: { total: number } };

test('permission: members.manage on top of the administrator role; coaches and members are refused; the path takes member ids only', async () => {
  const priya = userId(h.ctx, PRIYA);
  const c = await coach(DEMO.coach);
  const m = await member(PRIYA);
  for (const x of [c, m]) {
    assert.equal((await x.get(`/api/admin/members/${priya}/workout-programs`)).status, 403);
    assert.equal((await x.post(`/api/admin/members/${priya}/workout-programs`, { title: 'Not allowed' })).status, 403);
  }
  const a = await admin();
  assert.equal((await a.get(`/api/admin/members/${priya}/workout-programs`)).status, 200, 'administrators hold members.manage by default');
  const o = await owner();
  const adminId = userId(h.ctx, DEMO.admin);
  assert.equal((await o.post(`/api/admin/users/${adminId}/permissions`, { permission: 'members.manage', granted: false, reason: 'test: without members.manage' })).status, 200);
  try {
    const denied = await a.get(`/api/admin/members/${priya}/workout-programs`);
    assert.deepEqual([denied.status, denied.json.error?.code], [403, 'PERMISSION_DENIED']);
    assert.equal((await a.post(`/api/admin/members/${priya}/workout-programs`, { title: 'Not allowed' })).json.error?.code, 'PERMISSION_DENIED');
  } finally {
    await o.post(`/api/admin/users/${adminId}/permissions`, { permission: 'members.manage', granted: true, reason: 'test: restored' });
  }
  assert.equal((await o.get(`/api/admin/members/${userId(h.ctx, DEMO.coach)}/workout-programs`)).status, 404, 'a coach id is not a member');
  assert.equal((await o.get('/api/admin/workout-programs/wpg_nothinghere1')).status, 404);
});

test('an administrator creates a programme from a template, publishes it; the member sees it in the app exactly as a coach’s, and the assigned coach sees it on the client record', async () => {
  const priya = userId(h.ctx, PRIYA);
  const asha = userId(h.ctx, DEMO.coach);
  const o = await owner();
  const create = await o.post(`/api/admin/members/${priya}/workout-programs`, { title: 'Two weeks of full body', summary: 'Written by the Bioptime team.', templateId: templateId('Full body A'), weeks: 2, days: [4, 1] });
  assert.equal(create.status, 201, JSON.stringify(create.json));
  const p = create.json as unknown as Program;
  assert.deepEqual([p.memberId, p.coachId, p.status, p.currentVersion], [priya, asha, 'draft', 1], 'the programme belongs to the member’s coach');
  assert.deepEqual(p.draft!.structure.weeks.map((w) => [w.week, w.days.map((d) => d.day)]), [[1, [1, 4]], [2, [1, 4]]]);
  const created = auditRow('workout_program.create', p.id)!;
  assert.deepEqual([created.actor_id, created.actor_role, JSON.parse(created.data).by, JSON.parse(created.data).memberId], [userId(h.ctx, DEMO.owner), 'owner', 'admin', priya]);

  // a draft reaches no one but staff
  const m = await member(PRIYA);
  const before = await m.get(`/api/me/workouts?from=${day(0)}&to=${day(13)}`);
  assert.ok(!(before.json.programs as Array<{ id: string }>).some((x) => x.id === p.id), 'the member does not see a draft');
  const a = await coach(DEMO.coach);
  assert.ok(((await a.get(`/api/coach/clients/${priya}/workouts`)).json.programs as Array<{ id: string }>).some((x) => x.id === p.id), 'the coach sees the draft on the client record');

  const pub = await o.post(`/api/admin/workout-programs/${p.id}/publish`, { startDate: day(0) });
  assert.equal(pub.status, 200, JSON.stringify(pub.json));
  assert.deepEqual([(pub.json as unknown as Program).status, (pub.json as unknown as Program).sessions.total], ['published', 4]);
  assert.equal(JSON.parse(auditRow('workout_program.publish', p.id)!.data).by, 'admin');

  // the member's app (GET /me/workouts), as for a coach-published programme
  const week = await m.get(`/api/me/workouts?from=${day(0)}&to=${day(13)}`);
  assert.equal(week.status, 200);
  const prog = (week.json.programs as Array<{ id: string; title: string; coachName: string; version: number; summary: string }>).find((x) => x.id === p.id)!;
  assert.deepEqual([prog.title, prog.version, prog.summary, prog.coachName], ['Two weeks of full body', 1, 'Written by the Bioptime team.', 'Asha Menon']);
  const sessions = (week.json.items as Array<{ programId: string; title: string; status: string }>).filter((s) => s.programId === p.id);
  assert.equal(sessions.length, 4);
  assert.ok(sessions.every((s) => s.title === 'Full body A' && s.status === 'scheduled'));
  assert.ok(h.db.get("SELECT 1 FROM notifications WHERE user_id = ? AND title = 'Your workout programme is ready'", [priya]), 'the member is told, as when a coach publishes');
  const one = await m.get(`/api/me/workouts/${(week.json.items as Array<{ id: string; programId: string }>).find((s) => s.programId === p.id)!.id}`);
  assert.equal(one.status, 200);
  assert.ok((one.json.items as unknown[]).length >= 1, 'the session carries its exercises');

  // the assigned coach sees it on the client record and in the programme list; another coach does not
  const rec = await a.get(`/api/coach/clients/${priya}/workouts`);
  assert.equal((rec.json.programs as Array<{ id: string; status: string }>).find((x) => x.id === p.id)!.status, 'published');
  assert.ok(((await a.get(`/api/coach/workout-programs?memberId=${priya}`)).json.items as Array<{ id: string }>).some((x) => x.id === p.id));
  const other = await coach(DEMO.coach2);
  assert.equal((await other.get(`/api/coach/clients/${priya}/workouts`)).status, 403);
  assert.equal((await other.get(`/api/coach/workout-programs/${p.id}`)).status, 404);

  // the coach keeps working on it: a revision by the coach, published by the coach
  const rev = await a.patch(`/api/coach/workout-programs/${p.id}`, { title: 'Two weeks of full body, revised by Asha' });
  assert.equal(rev.status, 200, JSON.stringify(rev.json));
  assert.equal((await a.post(`/api/coach/workout-programs/${p.id}/publish`, {})).status, 200);
  const after = await m.get(`/api/me/workouts?from=${day(0)}&to=${day(13)}`);
  assert.equal((after.json.programs as Array<{ id: string; title: string }>).find((x) => x.id === p.id)!.title, 'Two weeks of full body, revised by Asha');
});

test('an administrator revises a published programme: a new draft that the member sees only once published; then archives it with a reason', async () => {
  const priya = userId(h.ctx, PRIYA);
  const o = await owner();
  const m = await member(PRIYA);
  const p = (await o.post(`/api/admin/members/${priya}/workout-programs`, { title: 'Walks for a week', templateId: templateId('Walk and mobility'), weeks: 1 })).json as unknown as Program;
  assert.deepEqual(p.draft!.structure.weeks[0]!.days.map((d) => d.day), [1, 3, 5], 'days default to Monday, Wednesday and Friday');
  assert.equal((await o.post(`/api/admin/workout-programs/${p.id}/publish`, { startDate: day(1) })).status, 200);
  const patch = await o.patch(`/api/admin/workout-programs/${p.id}`, { title: 'Walks for two weeks', structure: { weeks: [1, 2].map((week) => ({ week, days: [{ day: 2, templateId: templateId('Walk and mobility') }] })) } });
  assert.equal(patch.status, 200, JSON.stringify(patch.json));
  const revised = patch.json as unknown as Program;
  assert.deepEqual([revised.status, revised.currentVersion, revised.draft!.version, revised.published!.version], ['published', 1, 2, 1]);
  assert.equal(JSON.parse(auditRow('workout_program.update_draft', p.id)!.data).by, 'admin');
  const titleSeen = async () => ((await m.get(`/api/me/workouts?from=${day(0)}&to=${day(20)}`)).json.programs as Array<{ id: string; title: string }>).find((x) => x.id === p.id)?.title;
  assert.equal(await titleSeen(), 'Walks for a week', 'the member keeps the published version until the revision is published');
  assert.equal((await o.post(`/api/admin/workout-programs/${p.id}/publish`, {})).status, 200);
  assert.equal(await titleSeen(), 'Walks for two weeks');
  const got = await o.get(`/api/admin/workout-programs/${p.id}`);
  assert.deepEqual([(got.json as unknown as Program).currentVersion, (got.json as unknown as Program).sessions.total], [2, 2]);

  assert.equal((await o.post(`/api/admin/workout-programs/${p.id}/archive`, {})).json.error?.code, 'VALIDATION_FAILED', 'a reason is required');
  const arch = await o.post(`/api/admin/workout-programs/${p.id}/archive`, { reason: 'Replaced by the coach’s plan' });
  assert.equal(arch.status, 200, JSON.stringify(arch.json));
  assert.equal((arch.json as unknown as Program).status, 'archived');
  const row = auditRow('workout_program.archive', p.id)!;
  assert.deepEqual([row.reason, JSON.parse(row.data).by], ['Replaced by the coach’s plan', 'admin']);
  assert.equal(await titleSeen(), undefined, 'a closed programme leaves the member’s live list');
  assert.ok(h.db.get("SELECT 1 FROM notifications WHERE user_id = ? AND body LIKE 'Walks for two weeks was closed by the Bioptime team.%'", [priya]), 'the member is told who closed it');
  const exported = exportProgramsForMember(h.ctx, priya).filter((x) => x.title === 'Walks for two weeks');
  assert.deepEqual(exported.map((x) => x.state), ['closed by the Bioptime team'], 'her data export says who closed it, as the notification did (a coach-closed one: workouts.test.ts)');
  assert.equal((await o.patch(`/api/admin/workout-programs/${p.id}`, { title: 'Again' })).json.error?.code, 'INVALID_STATE');
  const list = await o.get(`/api/admin/members/${priya}/workout-programs`);
  assert.ok((list.json.items as Array<{ id: string; status: string }>).some((x) => x.id === p.id && x.status === 'archived'), 'closed programmes stay listed');
});

test('from scratch, and the coach’s validation: an empty draft cannot be published; draft and missing templates, and another coach’s own, are refused; structure or template, not both', async () => {
  const priya = userId(h.ctx, PRIYA);
  const o = await owner();
  const scratch = await o.post(`/api/admin/members/${priya}/workout-programs`, { title: 'Built by hand' });
  assert.equal(scratch.status, 201, JSON.stringify(scratch.json));
  const p = scratch.json as unknown as Program;
  assert.deepEqual(p.draft!.structure.weeks, []);
  assert.equal((await o.post(`/api/admin/workout-programs/${p.id}/publish`, {})).json.error?.code, 'STRUCTURE_EMPTY');
  const bad = [
    [{ title: 'Draft template', templateId: templateId('Full body B') }, 'TEMPLATE_UNAVAILABLE'],
    [{ title: 'Missing template', templateId: 'wkt_doesnotexist1' }, 'TEMPLATE_UNAVAILABLE'],
    [{ title: 'Both', templateId: templateId('Full body A'), structure: { weeks: [] } }, 'VALIDATION_FAILED'],
    [{ title: 'Weeks alone', weeks: 2 }, 'VALIDATION_FAILED'],
    [{ title: 'Twice', templateId: templateId('Full body A'), days: [1, 1] }, 'VALIDATION_FAILED'],
    [{ title: 'Too long', templateId: templateId('Full body A'), weeks: 53 }, 'VALIDATION_FAILED'],
    [{ title: 'X' }, 'VALIDATION_FAILED'],
    [{ title: 'Duplicate week', structure: { weeks: [{ week: 1, days: [] }, { week: 1, days: [] }] } }, 'VALIDATION_FAILED'],
  ] as const;
  for (const [body, code] of bad) {
    const r = await o.post(`/api/admin/members/${priya}/workout-programs`, body);
    assert.equal(r.json.error?.code, code, JSON.stringify(body));
  }
  // Asha's own template: allowed for her client (the programme is hers), not for a client of another coach
  const lower = templateId('Lower body');
  const ok = await o.patch(`/api/admin/workout-programs/${p.id}`, { structure: { weeks: [{ week: 1, days: [{ day: 1, templateId: lower }] }] } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const vikram = userId(h.ctx, DEMO.member2); // coach: Rahul
  assert.equal((await o.post(`/api/admin/members/${vikram}/workout-programs`, { title: 'Not Rahul’s template', structure: { weeks: [{ week: 1, days: [{ day: 1, templateId: lower }] }] } })).json.error?.code, 'TEMPLATE_UNAVAILABLE');
  assert.equal((await o.post(`/api/admin/workout-programs/${p.id}/publish`, { startDate: day(2) })).status, 200);
});

test('a member without a coach: the administrator who wrote the programme holds it until a coach is assigned, who then takes it over', async () => {
  const arjun = userId(h.ctx, ARJUN);
  const a = await admin();
  const r = await a.post(`/api/admin/members/${arjun}/workout-programs`, { title: 'While we find your coach', templateId: templateId('Walk and mobility'), weeks: 1, days: [2] });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const p = r.json as unknown as Program;
  assert.deepEqual([p.coachId, p.coachName], [userId(h.ctx, DEMO.admin), 'Operations admin']);
  assert.equal((await a.post(`/api/admin/workout-programs/${p.id}/publish`, { startDate: day(0) })).status, 200);
  const m = await member(ARJUN);
  assert.ok(((await m.get(`/api/me/workouts?from=${day(0)}&to=${day(6)}`)).json.programs as Array<{ id: string }>).some((x) => x.id === p.id));
  const o = await owner();
  const assign = await o.post('/api/admin/assignments', { memberId: arjun, coachId: userId(h.ctx, DEMO.coach3), reason: 'test: a coach for Arjun' });
  assert.equal(assign.status, 201, JSON.stringify(assign.json));
  const { processPending } = await import('../../src/domain/events.js');
  await processPending(h.ctx);
  const now = await a.get(`/api/admin/workout-programs/${p.id}`);
  assert.equal((now.json as unknown as Program).coachId, userId(h.ctx, DEMO.coach3), 'the assigned coach takes the programme over');
  const meera = await coach(DEMO.coach3);
  assert.ok(((await meera.get(`/api/coach/clients/${arjun}/workouts`)).json.programs as Array<{ id: string }>).some((x) => x.id === p.id));
});
