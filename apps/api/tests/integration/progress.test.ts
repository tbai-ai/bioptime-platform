/* M2 Progress: goals and milestones, check-ins (templates, schedules, submit, review, the materialise job), series over
   a range with source labels, adherence per provider, and progress photos (their switch, their own consent, private
   storage, tokens, coach access only while shared and consented, audit of every opening, retention).

   Permissions throughout: the member's own data; coaches only for assigned clients, and values, answers, series,
   adherence and photos only while the member shares health records with the coach; administrators by permission
   (library.manage, members.manage), and never a photo. Every mutation is audited. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId } from '../helpers.js';
import type { Ctx } from '../../src/context.js';
import { MODULES } from '../../src/modules/index.js';
import { progress as progressModule } from '../../src/modules/progress.js';
import { labstackOps } from '../../src/modules/labstackOps.js';
import * as progress from '../../src/domain/progress.js';
import * as files from '../../src/domain/files.js';
import { processPending } from '../../src/domain/events.js';
import { setUserPermission } from '../../src/auth/permissions.js';
import { setModuleSetting } from '../../src/domain/features.js';
import { coachFieldPolicy, findRestrictedFields, restrictedKeys } from '../../src/auth/fieldPolicy.js';
import { addDays, dateInZone, weekdayInZone } from '../../src/lib/time.js';
import { buildArchive } from '../../src/domain/dataExport.js';
import type { DemoSeedContext } from '../../src/modules/types.js';
import { moduleJobs } from '../../src/jobs.js';
import { PROGRESS_SOURCE_LABELS } from '@bioptime/domain';
import { SHOWCASE_MEMBER } from '../../src/seed/showcase.js';

const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const JPEG_HEAD = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');

let h: Awaited<ReturnType<typeof makeApp>>;
let privateDir = '';

before(async () => {
  privateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bioptime-progress-'));
  h = await makeApp({ env: { PRIVATE_FILES_DIR: privateDir } });
});
after(async () => {
  await h.app.close();
  h.db.close();
  fs.rmSync(privateDir, { recursive: true, force: true });
});

const tick = () => new Promise((r) => setTimeout(r, 5)); // consents are ordered by time: keep successive changes apart
const as = (email: string): Ctx => { const u = h.db.get<{ id: string; role: 'member' | 'coach' | 'admin' | 'owner'; name: string }>('SELECT id, role, name FROM users WHERE email = ?', [email])!; return { ...h.ctx, actor: { id: u.id, role: u.role, email, name: u.name } }; };
const at = (iso: string, base: Ctx = h.ctx): Ctx => ({ ...base, now: () => iso });
const signedIn = async (email: string, password: string, mfa = false) => { const c = client(h.app); await c.login(email, password, password === DEMO_PASSWORDS.member ? 'member' : 'dashboard', mfa); return c; };
const auditCount = (action: string, targetId?: string) => h.db.get<{ n: number }>(`SELECT COUNT(*) n FROM audit_events WHERE action = ? ${targetId ? 'AND target_id = ?' : ''}`, targetId ? [action, targetId] : [action])!.n;
const lastAudit = (action: string) => h.db.get<{ actor_id: string | null; actor_role: string; reason: string | null; target_id: string; data: string }>('SELECT * FROM audit_events WHERE action = ? ORDER BY at DESC, rowid DESC LIMIT 1', [action]);
const noRestricted = (payload: unknown) => assert.deepEqual(findRestrictedFields(payload, restrictedKeys(coachFieldPolicy(h.ctx))), [], 'no phone, email, address, PIN or date of birth in a coach payload');
const setShare = async (c: Awaited<ReturnType<typeof signedIn>>, granted: boolean) => { await tick(); const r = await c.post('/api/me/consents', { kind: 'coach_sharing', version: '2026-10-17', granted }); assert.equal(r.status, 200); await tick(); };
const setFlagOn = async (key: string, enabled: boolean) => {
  const owner = await signedIn(DEMO.owner, DEMO_PASSWORDS.owner, true);
  const r = await owner.patch('/api/admin/modules', { key, enabled, reason: `test: ${key} ${enabled ? 'on' : 'off'}` });
  assert.equal(r.status, 200, JSON.stringify(r.json));
};

test('the module registers its migration, routes, jobs, event handler, photo resolver, adherence provider and labelled demo rows', async () => {
  for (const t of ['goals', 'goal_milestones', 'checkin_templates', 'checkin_schedules', 'checkins', 'progress_photos']) assert.ok(h.db.get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", [t]), `${t} exists`);
  assert.ok(h.db.get("SELECT 1 FROM schema_migrations WHERE version = '0010_progress.sql'"));
  const m = MODULES.find((x) => x.key === 'progress')!;
  assert.equal(m, progressModule);
  assert.deepEqual(Object.keys(m.fileAccess ?? {}), ['progress_photo']);
  assert.equal(m.adherence?.key, 'plan_tasks');
  assert.ok(m.events?.CoachAssigned?.length);
  assert.deepEqual(moduleJobs().filter((j) => j.name.startsWith('progress.')).map((j) => j.name), ['progress.checkins_materialise', 'progress.goals_evaluate', 'progress.photo_retention']);
  assert.ok(files.storesPrivateFiles('progress'), 'production refuses local storage for this module');

  // demo rows are in plain words (the owner removed the demo and sample labels on 24 October 2026); no photo is seeded;
  // the photo switch keeps its stored value (off)
  const labelWords = /\bdemo\b|\bsample\b/i;
  const templates = h.db.all<{ title: string; description: string; status: string; scope: string }>('SELECT * FROM checkin_templates');
  assert.equal(templates.length, 1);
  assert.equal(templates[0]!.title, 'Weekly check-in');
  assert.match(templates[0]!.description, /not a clinical questionnaire/i);
  assert.doesNotMatch(templates[0]!.description, labelWords);
  assert.equal(templates[0]!.status, 'published');
  // the module's own rows; the preview member's goals and check-ins come from api/seed/showcase.ts (checked below)
  const priya = userId(h.ctx, SHOWCASE_MEMBER);
  assert.deepEqual(h.db.all<{ title: string }>('SELECT title FROM goals WHERE member_id != ? ORDER BY title', [priya]).map((g) => g.title), ['Sleep 8 hours on most nights', 'Walk after dinner on weekdays', 'Weight to 80 kg']);
  for (const ms of h.db.all<{ title: string }>('SELECT title FROM goal_milestones')) assert.doesNotMatch(ms.title, labelWords);
  for (const c of h.db.all<{ title: string; answers: string | null; response: string | null }>('SELECT title, answers, response FROM checkins WHERE answers IS NOT NULL AND member_id != ?', [priya])) {
    assert.ok(['Sleeping better since moving dinner earlier.', 'One late night at work, otherwise on track.'].includes(JSON.parse(c.answers!).notes));
    assert.doesNotMatch(c.title, labelWords);
    if (c.response) assert.equal(c.response, 'A good week. We keep the evening walk and the earlier dinner.');
  }
  const showcase = h.db.all<{ title: string; status: string; metric: string | null }>('SELECT title, status, metric FROM goals WHERE member_id = ? ORDER BY title', [priya]);
  assert.deepEqual(showcase.map((g) => [g.title, g.status]), [['Drink 2 litres of water a day', 'active'], ['Sleep 7.5 hours on most nights', 'active'], ['Walk 9,000 steps a day', 'active'], ['Weight to 62 kg', 'active']]);
  assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM goal_milestones m JOIN goals g ON g.id = m.goal_id WHERE g.member_id = ? AND m.achieved_at IS NOT NULL', [priya])!.n, 2, 'two milestones reached by values she logged');
  for (const c of h.db.all<{ title: string; status: string; answers: string | null; response: string | null }>('SELECT title, status, answers, response FROM checkins WHERE member_id = ?', [priya])) {
    assert.doesNotMatch(`${c.title} ${c.answers ?? ''} ${c.response ?? ''}`, labelWords);
    assert.ok(c.status === 'requested' || (c.status === 'reviewed' && c.response), 'answered and replied to, or waiting this week');
  }
  assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM progress_photos')!.n, 0);
  assert.equal(h.db.get<{ enabled: number }>("SELECT enabled FROM feature_flags WHERE key = 'progressPhotos'")!.enabled, 0);
  // the seeded check-in answers repeat values the member already logged; nothing new was invented
  const ananya = userId(h.ctx, DEMO.member);
  const sleepValues = new Set(h.db.all<{ value: number }>("SELECT value FROM progress_entries WHERE member_id = ? AND metric = 'sleep_hours'", [ananya]).map((r) => r.value));
  for (const c of h.db.all<{ answers: string }>('SELECT answers FROM checkins WHERE member_id = ? AND answers IS NOT NULL', [ananya])) assert.ok(sleepValues.has(JSON.parse(c.answers).sleep));
  // seeded due dates are India dates, like every other due date (the late-evening case is checked at the end of this file)
  for (const c of h.db.all<{ due_date: string; submitted_at: string }>('SELECT due_date, submitted_at FROM checkins WHERE submitted_at IS NOT NULL')) assert.equal(c.due_date, dateInZone(c.submitted_at));
});

test('while the module is off its routes answer FEATURE_DISABLED; deleting a photo and withdrawing the photo consent still work', async () => {
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const coach = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  await setFlagOn('progress', false);
  try {
    assert.equal((await member.get('/api/me/goals')).json.error?.code, 'FEATURE_DISABLED');
    assert.equal((await member.get('/api/me/progress/series?metric=sleep_hours')).json.error?.code, 'FEATURE_DISABLED');
    assert.equal((await coach.get(`/api/coach/clients/${userId(h.ctx, DEMO.member)}/goals`)).json.error?.code, 'FEATURE_DISABLED');
    assert.ok(!((await member.get('/api/public/config')).json.features as string[]).includes('progress'));
    assert.equal((await member.del('/api/me/progress/photos/pph_doesnotexist')).status, 404, 'reachable (and honest) while off');
    assert.equal((await member.post('/api/me/progress/photos/consent', { granted: false })).status, 200, 'withdrawing is always possible');
    assert.equal((await member.post('/api/me/progress/photos/consent', { granted: true, version: progress.PHOTO_CONSENT.version })).json.error?.code, 'FEATURE_DISABLED', 'granting is not');
    assert.equal((await member.get('/api/me/progress/summary')).status, 200, 'the core progress pages are untouched');
  } finally {
    await setFlagOn('progress', true);
  }
});

test('goals: validation, the starting value, automatic achievement in the right direction, milestones, who may change what, audit', async () => {
  const member = await signedIn(DEMO.member2, DEMO_PASSWORDS.member); // Vikram: weight logged in the demo
  const memberId = userId(h.ctx, DEMO.member2);
  const bad = async (body: unknown, code: string) => { const r = await member.post('/api/me/goals', body); assert.equal(r.status, 400, JSON.stringify(r.json)); assert.equal(r.json.error?.code, code, JSON.stringify(r.json)); };
  await bad({ title: 'x' }, 'VALIDATION_FAILED');
  await bad({ title: 'Too many keys', colour: 'red' }, 'VALIDATION_FAILED');
  await bad({ title: 'Unknown metric', metric: 'iq_points', targetValue: 3 }, 'METRIC_UNKNOWN');
  await bad({ title: 'Out of range', metric: 'weight_kg', targetValue: 900 }, 'VALUE_OUT_OF_RANGE');
  await bad({ title: 'Same as start', metric: 'weight_kg', baselineValue: 82, targetValue: 82 }, 'TARGET_EQUALS_START');
  await bad({ title: 'In the past', targetDate: '2020-01-01' }, 'TARGET_DATE_PAST');
  await bad({ title: 'Not a date', targetDate: '2026-02-30' }, 'VALIDATION_FAILED'); // the shared date schema refuses an impossible day first

  // no starting value given: the latest logged weight becomes the start, so the direction (down) is known
  const created = await member.post('/api/me/goals', { title: 'Weight to 82 kg', metric: 'weight_kg', targetValue: 82 });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const goal = created.json as any;
  assert.equal(goal.baselineFromLatest, true);
  assert.equal(goal.baselineValue, 82.9);
  assert.equal(goal.unit, 'kg');
  assert.equal(goal.autoAchieve, true);
  assert.equal(goal.status, 'active');
  assert.equal(lastAudit('goal.create')!.target_id, goal.id);

  const ms = await member.post(`/api/me/goals/${goal.id}/milestones`, { title: 'Halfway', targetValue: 82.5 });
  assert.equal(ms.status, 201);
  assert.equal((await member.post(`/api/me/goals/${goal.id}/milestones`, { title: 'Off the scale', targetValue: 5 })).json.error?.code, 'VALUE_OUT_OF_RANGE');
  // a value above the target does not count (the goal is going down); one at or below it does
  await member.post('/api/me/progress', { metric: 'weight_kg', value: 83.5 });
  let listed = (await member.get('/api/me/goals')).json.items as any[];
  assert.equal(listed.find((g) => g.id === goal.id).status, 'active');
  await member.post('/api/me/progress', { metric: 'weight_kg', value: 82.4 });
  listed = (await member.get('/api/me/goals')).json.items as any[];
  let g = listed.find((x) => x.id === goal.id);
  assert.ok(g.milestones[0].achievedAt, 'the milestone was reached');
  assert.equal(g.status, 'active', 'the goal itself not yet');
  await member.post('/api/me/progress', { metric: 'weight_kg', value: 81.9 });
  g = ((await member.get('/api/me/goals')).json.items as any[]).find((x) => x.id === goal.id);
  assert.equal(g.status, 'achieved');
  assert.equal(g.achievedHow, 'target_reached');
  assert.equal(g.latest.value, 81.9);
  assert.equal(g.latest.sourceLabel, 'Self-reported');
  const achievedAudit = lastAudit('goal.achieved')!;
  assert.equal(achievedAudit.target_id, goal.id);
  assert.equal(achievedAudit.actor_role, 'system');
  assert.ok(h.db.get("SELECT 1 FROM notifications WHERE user_id = ? AND category = 'goal' AND title = 'Goal reached'", [memberId]));
  const before = auditCount('goal.achieved');
  await member.get('/api/me/goals');
  assert.equal(auditCount('goal.achieved'), before, 'evaluation is idempotent');

  // a goal without a starting value or a metric is only ever marked by a person
  const text = (await member.post('/api/me/goals', { title: 'Cook at home five nights a week' })).json as any;
  assert.equal(text.autoAchieve, false);
  const marked = await member.patch(`/api/me/goals/${text.id}`, { status: 'achieved' });
  assert.equal(marked.json.status, 'achieved');
  assert.equal(marked.json.achievedHow, 'marked');
  const reopened = await member.patch(`/api/me/goals/${text.id}`, { status: 'active' });
  assert.equal(reopened.json.achievedAt, null);
  assert.equal((await member.patch(`/api/me/goals/${text.id}`, { metric: 'weight_kg' })).status, 400, 'the metric is fixed once set');
  assert.equal((await member.patch(`/api/me/goals/${text.id}`, {})).json.error?.code, 'NOTHING_TO_CHANGE');
  const toggled = await member.patch(`/api/me/goals/${text.id}/milestones/gms_missing`, { achieved: true });
  assert.equal(toggled.status, 404);

  // another member's goal does not exist for this member
  const other = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  assert.equal((await other.patch(`/api/me/goals/${text.id}`, { status: 'dropped' })).status, 404);
  assert.equal((await other.post(`/api/me/goals/${text.id}/milestones`, { title: 'Sneaky' })).status, 404);
  assert.ok(auditCount('goal.update', text.id) >= 2);
  assert.ok(auditCount('goal.milestone_add') >= 1);
  assert.ok(auditCount('goal.milestone_reached') >= 1);
});

test('coaches: assigned clients only; goal values only while the member shares health records; the member keeps their own goal', async () => {
  const ananya = userId(h.ctx, DEMO.member), deepa = userId(h.ctx, DEMO.memberNoShare);
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);   // Ananya's coach
  const rahul = await signedIn(DEMO.coach2, DEMO_PASSWORDS.coach); // not Ananya's coach
  const meera = await signedIn(DEMO.coach3, DEMO_PASSWORDS.coach); // Deepa's coach; Deepa does not share
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);

  const mine = await asha.get(`/api/coach/clients/${ananya}/goals`);
  assert.equal(mine.status, 200, JSON.stringify(mine.json));
  assert.equal(mine.json.healthShared, true);
  const sleepGoal = (mine.json.items as any[]).find((x) => x.metric === 'sleep_hours');
  assert.equal(sleepGoal.targetValue, 8);
  assert.ok(sleepGoal.milestones[0].achievedAt, 'the seeded milestone is reached by values logged since the goal was set');
  noRestricted(mine.json);
  assert.equal((await rahul.get(`/api/coach/clients/${ananya}/goals`)).json.error?.code, 'NO_ACCESS');
  assert.equal((await rahul.post(`/api/coach/clients/${ananya}/goals`, { title: 'Not my client' })).json.error?.code, 'NO_ACCESS');
  assert.equal((await member.get(`/api/coach/clients/${ananya}/goals`)).status, 403, 'members never reach coach routes');

  // a client who does not share: titles, no values; a measurable goal is refused, a plain one is fine
  const deepaGoals = await meera.get(`/api/coach/clients/${deepa}/goals`);
  assert.equal(deepaGoals.json.healthShared, false);
  assert.equal((await meera.post(`/api/coach/clients/${deepa}/goals`, { title: 'Weight goal', metric: 'weight_kg', targetValue: 60 })).json.error?.code, 'NOT_SHARED');
  const plain = await meera.post(`/api/coach/clients/${deepa}/goals`, { title: 'Mobility routine three times a week' });
  assert.equal(plain.status, 201, JSON.stringify(plain.json));
  assert.equal(plain.json.createdByRole, 'coach');
  assert.ok(!('targetValue' in plain.json), 'no values in the response while not shared');
  assert.ok(h.db.get("SELECT 1 FROM notifications WHERE user_id = ? AND category = 'goal' AND title = 'Your coach added a goal'", [deepa]));
  assert.equal((await meera.post(`/api/coach/clients/${deepa}/goals/${plain.json.id}/milestones`, { title: 'Valued', targetValue: 3 })).json.error?.code, 'NOT_SHARED');
  assert.equal((await meera.post(`/api/coach/clients/${deepa}/goals/${plain.json.id}/milestones`, { title: 'First week done' })).status, 201);

  // the coach set it: the member may change its status only; the coach may not rename the member's own goal
  const deepaClient = await signedIn(DEMO.memberNoShare, DEMO_PASSWORDS.member);
  assert.equal((await deepaClient.patch(`/api/me/goals/${plain.json.id}`, { title: 'Renamed' })).json.error?.code, 'NOT_YOUR_GOAL');
  assert.equal((await deepaClient.patch(`/api/me/goals/${plain.json.id}`, { status: 'paused' })).json.status, 'paused');
  const own = (await member.post('/api/me/goals', { title: 'Stretch every morning' })).json as any;
  assert.equal((await asha.patch(`/api/coach/clients/${ananya}/goals/${own.id}`, { title: 'Coach rename' })).json.error?.code, 'NOT_YOUR_GOAL');
  const status = await asha.patch(`/api/coach/clients/${ananya}/goals/${own.id}`, { status: 'paused' });
  assert.equal(status.json.status, 'paused');
  assert.equal(JSON.parse(lastAudit('goal.update')!.data).byRole, 'coach');
});

test('without health sharing a coach sees that a measurable goal or milestone is achieved, never how or when; with sharing, both', async () => {
  const deepa = userId(h.ctx, DEMO.memberNoShare);
  const meera = await signedIn(DEMO.coach3, DEMO_PASSWORDS.coach); // Deepa's coach; Deepa does not share
  const deepaClient = await signedIn(DEMO.memberNoShare, DEMO_PASSWORDS.member);
  assert.equal(progress.healthShared(h.ctx, deepa), false, 'the demo starts with Deepa not sharing');

  // Deepa's own measurable goal, reached by values she logs, with a milestone a value reaches and one she marks
  const goal = (await deepaClient.post('/api/me/goals', { title: 'Weight to 68 kg (test)', metric: 'weight_kg', baselineValue: 70, targetValue: 68 })).json as any;
  assert.equal(goal.autoAchieve, true);
  await deepaClient.post(`/api/me/goals/${goal.id}/milestones`, { title: '69 kg (test)', targetValue: 69 });
  const withPlain = (await deepaClient.post(`/api/me/goals/${goal.id}/milestones`, { title: 'A week of evening walks (test)' })).json as any;
  const plainMs = (withPlain.milestones as any[]).find((m) => m.title.startsWith('A week'));
  assert.equal((await deepaClient.patch(`/api/me/goals/${goal.id}/milestones/${plainMs.id}`, { achieved: true })).status, 200);
  assert.equal((await deepaClient.post('/api/me/progress', { metric: 'weight_kg', value: 68.6 })).status, 201);
  assert.equal((await deepaClient.post('/api/me/progress', { metric: 'weight_kg', value: 67.8 })).status, 201);
  const mine = ((await deepaClient.get('/api/me/goals')).json.items as any[]).find((g) => g.id === goal.id);
  assert.deepEqual([mine.status, mine.achievedHow, !!mine.achievedAt, mine.achievementWithheld], ['achieved', 'target_reached', true, false], 'the member sees how her goal was reached');
  assert.ok((mine.milestones as any[]).every((m) => m.reached && m.achievedAt));
  // and a goal without values, which only a person can mark achieved
  const plainGoal = (await deepaClient.post('/api/me/goals', { title: 'Cook at home four nights a week (test)' })).json as any;
  assert.equal((await deepaClient.patch(`/api/me/goals/${plainGoal.id}`, { status: 'achieved' })).json.achievedHow, 'marked');

  try {
    // not shared: achieved, without how or when; the milestones read as reached, without dates or values
    const off = await meera.get(`/api/coach/clients/${deepa}/goals`);
    assert.equal(off.status, 200, JSON.stringify(off.json));
    assert.equal(off.json.healthShared, false);
    const g = (off.json.items as any[]).find((x) => x.id === goal.id);
    assert.deepEqual({ status: g.status, achievedHow: g.achievedHow, achievedAt: g.achievedAt, achievementWithheld: g.achievementWithheld, valuesWithheld: g.valuesWithheld, updatedAt: g.updatedAt }, { status: 'achieved', achievedHow: null, achievedAt: null, achievementWithheld: true, valuesWithheld: true, updatedAt: null });
    assert.ok(!('targetValue' in g) && !('baselineValue' in g) && !('latest' in g));
    assert.deepEqual((g.milestones as any[]).map((m) => [m.reached, m.achievedAt, 'targetValue' in m]), [[true, null, false], [true, null, false]], 'reached, with no date to tell a logged value from a person');
    assert.ok(!JSON.stringify(off.json).includes('target_reached'), 'nothing says a logged value reached a target');
    const p = (off.json.items as any[]).find((x) => x.id === plainGoal.id);
    assert.deepEqual([p.status, p.achievedHow, !!p.achievedAt, p.achievementWithheld], ['achieved', 'marked', true, false], 'a goal without values can only have been marked, so it keeps its date');
    noRestricted(off.json);
    // the coach's own status change on it answers the same way while the member does not share
    const touched = await meera.patch(`/api/coach/clients/${deepa}/goals/${goal.id}`, { status: 'achieved' });
    assert.equal(touched.status, 200, JSON.stringify(touched.json));
    assert.deepEqual([touched.json.status, touched.json.achievedHow, touched.json.achievedAt, touched.json.achievementWithheld], ['achieved', null, null, true]);

    // shared: how and when, as the member sees them
    await setShare(deepaClient, true);
    const on = await meera.get(`/api/coach/clients/${deepa}/goals`);
    assert.equal(on.json.healthShared, true);
    const s = (on.json.items as any[]).find((x) => x.id === goal.id);
    assert.deepEqual([s.status, s.achievedHow, s.achievedAt, s.achievementWithheld, !!s.updatedAt, s.targetValue], ['achieved', 'target_reached', mine.achievedAt, false, true, 68]);
    assert.deepEqual((s.milestones as any[]).map((m) => [m.reached, !!m.achievedAt, m.targetValue]), [[true, true, 69], [true, true, null]]);
  } finally {
    await setShare(deepaClient, false);
  }
  const hiddenAgain = ((await meera.get(`/api/coach/clients/${deepa}/goals`)).json.items as any[]).find((x) => x.id === goal.id);
  assert.deepEqual([hiddenAgain.status, hiddenAgain.achievedHow, hiddenAgain.achievedAt], ['achieved', null, null], 'withheld again once she stops sharing');
});

test('milestones follow the goal rule both ways: only whoever set a goal adds milestones; either side marks one reached (a status change)', async () => {
  const ananya = userId(h.ctx, DEMO.member);
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const milestonesOf = (goalId: string) => h.db.get<{ n: number }>('SELECT COUNT(*) n FROM goal_milestones WHERE goal_id = ?', [goalId])!.n;

  // a goal the member set: the coach cannot add a milestone (route and domain), the member can
  const memberGoal = (await member.post('/api/me/goals', { title: 'Ten minutes of mobility every day' })).json as any;
  const coachAdd = await asha.post(`/api/coach/clients/${ananya}/goals/${memberGoal.id}/milestones`, { title: 'First week' });
  assert.equal(coachAdd.status, 403, JSON.stringify(coachAdd.json));
  assert.equal(coachAdd.json.error?.code, 'NOT_YOUR_GOAL');
  assert.throws(() => progress.addMilestone(as(DEMO.coach), ananya, memberGoal.id, { title: 'Through the domain' }, 'coach'), (e: { code?: string }) => e.code === 'NOT_YOUR_GOAL');
  assert.equal(milestonesOf(memberGoal.id), 0, 'the refused attempts added nothing');
  const own = await member.post(`/api/me/goals/${memberGoal.id}/milestones`, { title: 'First week' });
  assert.equal(own.status, 201, JSON.stringify(own.json));
  assert.equal(JSON.parse(lastAudit('goal.milestone_add')!.data).byRole, 'member');
  // marking it reached is a status change, which the other side may make (the coach has no route for it; the domain allows it)
  const byCoach = progress.setMilestoneAchieved(as(DEMO.coach), ananya, memberGoal.id, (own.json as any).milestones[0].id, true, 'coach');
  assert.ok(byCoach.milestones[0]!.achievedAt);
  assert.equal(JSON.parse(lastAudit('goal.milestone_update')!.data).byRole, 'coach');

  // a goal the coach set: the member cannot add a milestone, but marks the coach's milestone reached and back
  const coachGoal = (await asha.post(`/api/coach/clients/${ananya}/goals`, { title: 'Walk after lunch on workdays' })).json as any;
  const coachMs = await asha.post(`/api/coach/clients/${ananya}/goals/${coachGoal.id}/milestones`, { title: 'Two weeks in' });
  assert.equal(coachMs.status, 201, JSON.stringify(coachMs.json));
  assert.equal(JSON.parse(lastAudit('goal.milestone_add')!.data).byRole, 'coach');
  const memberAdd = await member.post(`/api/me/goals/${coachGoal.id}/milestones`, { title: 'A step of my own' });
  assert.equal(memberAdd.status, 403, JSON.stringify(memberAdd.json));
  assert.equal(memberAdd.json.error?.code, 'NOT_YOUR_GOAL');
  assert.match(memberAdd.json.error?.message as string, /ask your coach/);
  assert.equal(milestonesOf(coachGoal.id), 1);
  const msId = (coachMs.json as any).milestones[0].id as string;
  const reached = await member.patch(`/api/me/goals/${coachGoal.id}/milestones/${msId}`, { achieved: true });
  assert.equal(reached.status, 200, JSON.stringify(reached.json));
  assert.ok((reached.json as any).milestones[0].achievedAt);
  assert.equal(JSON.parse(lastAudit('goal.milestone_update')!.data).byRole, 'member');
  assert.equal(((await member.patch(`/api/me/goals/${coachGoal.id}/milestones/${msId}`, { achieved: false })).json as any).milestones[0].achievedAt, null);
  // the rest of the coach's goal stays the coach's
  assert.equal((await member.patch(`/api/me/goals/${coachGoal.id}`, { title: 'Renamed by the member' })).json.error?.code, 'NOT_YOUR_GOAL');
});

test('coach health reads of goal values and adherence are audited; the admin overview is audited as a record view', async () => {
  const ananya = userId(h.ctx, DEMO.member), deepa = userId(h.ctx, DEMO.memberNoShare);
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const meera = await signedIn(DEMO.coach3, DEMO_PASSWORDS.coach);
  const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin, true);
  const healthViews = (memberId: string, what: string) => h.db.get<{ n: number }>("SELECT COUNT(*) n FROM audit_events WHERE action = 'health.viewed' AND target_id = ? AND json_extract(data, '$.what') = ?", [memberId, what])!.n;

  // shared: the goals carry values, and the read is audited once, as the coach
  const before = healthViews(ananya, 'goal-values');
  const goals = await asha.get(`/api/coach/clients/${ananya}/goals`);
  assert.equal(goals.status, 200, JSON.stringify(goals.json));
  assert.ok((goals.json.items as any[]).some((g) => g.targetValue !== undefined && g.targetValue !== null), 'values are in the response');
  assert.equal(healthViews(ananya, 'goal-values'), before + 1);
  const row = lastAudit('health.viewed')!;
  assert.equal(row.actor_id, userId(h.ctx, DEMO.coach));
  assert.equal(JSON.parse(row.data).by, 'coach');
  // a coach's change that answers with a goal's values is a read of them too
  const set = await asha.post(`/api/coach/clients/${ananya}/goals`, { title: 'Sleep seven and three-quarter hours', metric: 'sleep_hours', baselineValue: 6.8, targetValue: 7.75 });
  assert.equal(set.status, 201, JSON.stringify(set.json));
  assert.equal(set.json.targetValue, 7.75);
  assert.equal(healthViews(ananya, 'goal-values'), before + 2);
  const plain = await asha.post(`/api/coach/clients/${ananya}/goals`, { title: 'Stretch before bed' });
  assert.equal(plain.status, 201, JSON.stringify(plain.json));
  assert.equal(healthViews(ananya, 'goal-values'), before + 2, 'a goal without values reads none');

  // not shared: no values, so nothing was read
  const deepaBefore = healthViews(deepa, 'goal-values');
  const hidden = await meera.get(`/api/coach/clients/${deepa}/goals`);
  assert.equal(hidden.json.healthShared, false);
  assert.ok((hidden.json.items as any[]).every((g) => !('targetValue' in g) && !('latest' in g)));
  assert.equal(healthViews(deepa, 'goal-values'), deepaBefore);

  // adherence: audited when read; a refused read is not a read
  const adBefore = healthViews(ananya, 'adherence');
  assert.equal((await asha.get(`/api/coach/clients/${ananya}/adherence`)).status, 200);
  assert.equal(healthViews(ananya, 'adherence'), adBefore + 1);
  assert.equal((await meera.get(`/api/coach/clients/${deepa}/adherence`)).json.error?.code, 'NOT_SHARED');
  assert.equal(healthViews(deepa, 'adherence'), 0);

  // the administrator's overview is a record view, audited like GET /admin/members/:id; a refused request writes nothing
  const recordViews = () => h.db.get<{ n: number }>("SELECT COUNT(*) n FROM audit_events WHERE action = 'member.record_viewed' AND target_id = ?", [ananya])!.n;
  const views = recordViews();
  const ov = await admin.get(`/api/admin/members/${ananya}/progress`);
  assert.equal(ov.status, 200, JSON.stringify(ov.json));
  assert.equal(recordViews(), views + 1);
  const viewed = lastAudit('member.record_viewed')!;
  assert.equal(viewed.actor_id, userId(h.ctx, DEMO.admin));
  assert.deepEqual(JSON.parse(viewed.data), { by: 'admin', sections: ['progress'] });
  assert.equal((await asha.get(`/api/admin/members/${ananya}/progress`)).status, 403);
  assert.equal(recordViews(), views + 1);
});

test('check-in templates: coaches write their own, administrators run the library with library.manage; questions are validated', async () => {
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const rahul = await signedIn(DEMO.coach2, DEMO_PASSWORDS.coach);
  const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin, true);
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const q = (over: Record<string, unknown> = {}) => ({ key: 'energy', label: 'Energy this week, 1 to 5', type: 'scale_1_5', metric: 'energy_1_5', ...over });
  const refuse = async (questions: unknown[], code: string) => { const r = await asha.post('/api/coach/checkin-templates', { title: 'Bad', questions }); assert.equal(r.status, 400, JSON.stringify(r.json)); assert.equal(r.json.error?.code, code, JSON.stringify(r.json)); };
  await refuse([], 'VALIDATION_FAILED');
  await refuse([q(), q()], 'QUESTIONS_INVALID');
  await refuse([q({ metric: 'weight_kg' })], 'QUESTIONS_INVALID');
  await refuse([q({ type: 'text' })], 'QUESTIONS_INVALID');
  await refuse([q({ metric: 'made_up' })], 'METRIC_UNKNOWN');
  await refuse([q({ key: 'Bad Key' })], 'VALIDATION_FAILED');

  const mine = await asha.post('/api/coach/checkin-templates', { title: 'Asha’s quick check-in', questions: [q(), { key: 'win', label: 'One win this week', type: 'text' }] });
  assert.equal(mine.status, 201, JSON.stringify(mine.json));
  assert.equal(mine.json.scope, 'coach');
  assert.equal(mine.json.status, 'published');
  assert.ok(((await asha.get('/api/coach/checkin-templates')).json.items as any[]).some((t) => t.id === mine.json.id));
  assert.ok(!((await rahul.get('/api/coach/checkin-templates')).json.items as any[]).some((t) => t.id === mine.json.id), 'a coach’s own template is theirs alone');

  // the library: drafts are invisible to coaches until published (with a reason); a published one cannot be edited
  const draft = await admin.post('/api/admin/checkin-templates', { title: 'Library check-in', questions: [q()] });
  assert.equal(draft.status, 201, JSON.stringify(draft.json));
  assert.equal(draft.json.status, 'draft');
  assert.ok(!((await rahul.get('/api/coach/checkin-templates')).json.items as any[]).some((t) => t.id === draft.json.id));
  assert.equal((await admin.patch(`/api/admin/checkin-templates/${draft.json.id}`, { title: 'Library check-in, revised' })).json.title, 'Library check-in, revised');
  assert.equal((await admin.post(`/api/admin/checkin-templates/${draft.json.id}/publish`, {})).status, 400, 'a reason is required');
  const pub = await admin.post(`/api/admin/checkin-templates/${draft.json.id}/publish`, { reason: 'test: ready for coaches' });
  assert.equal(pub.json.status, 'published');
  assert.equal(lastAudit('checkin_template.publish')!.reason, 'test: ready for coaches');
  assert.ok(((await rahul.get('/api/coach/checkin-templates')).json.items as any[]).some((t) => t.id === draft.json.id));
  assert.equal((await admin.patch(`/api/admin/checkin-templates/${draft.json.id}`, { title: 'Edit live' })).json.error?.code, 'INVALID_STATE');
  assert.equal((await admin.patch(`/api/admin/checkin-templates/${draft.json.id}`, { status: 'archived' })).json.error?.code, 'REASON_REQUIRED');
  assert.equal((await admin.patch(`/api/admin/checkin-templates/${draft.json.id}`, { status: 'archived', reason: 'test: retired' })).json.status, 'archived');
  assert.ok(!((await rahul.get('/api/coach/checkin-templates')).json.items as any[]).some((t) => t.id === draft.json.id), 'archived ones leave the coaches’ list');
  assert.ok(((await admin.get('/api/admin/checkin-templates?scope=all')).json.items as any[]).some((t) => t.id === mine.json.id), 'administrators can see coaches’ templates for oversight');

  // permissions: members and coaches never reach the library routes; an administrator without library.manage neither
  assert.equal((await member.get('/api/admin/checkin-templates')).status, 403);
  assert.equal((await asha.post('/api/admin/checkin-templates', { title: 'Coach in admin', questions: [q()] })).status, 403);
  const adminId = userId(h.ctx, DEMO.admin);
  setUserPermission(as(DEMO.owner), adminId, 'library.manage', false, 'test: no library');
  try {
    assert.equal((await admin.get('/api/admin/checkin-templates')).json.error?.code, 'PERMISSION_DENIED');
  } finally {
    setUserPermission(as(DEMO.owner), adminId, 'library.manage', true, 'test: library back');
  }
  assert.ok(auditCount('checkin_template.create') >= 3);
  assert.ok(auditCount('checkin_template.update') >= 1);
  assert.ok(auditCount('checkin_template.archive') >= 1);
});

test('check-ins: schedule, submit with validation, answers logged as self-reported values, review by the assigned coach with health access', async () => {
  const ananya = userId(h.ctx, DEMO.member), deepa = userId(h.ctx, DEMO.memberNoShare);
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const rahul = await signedIn(DEMO.coach2, DEMO_PASSWORDS.coach);
  const meera = await signedIn(DEMO.coach3, DEMO_PASSWORDS.coach);
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const deepaClient = await signedIn(DEMO.memberNoShare, DEMO_PASSWORDS.member);
  const template = ((await asha.get('/api/coach/checkin-templates')).json.items as any[]).find((t) => t.scope === 'library');

  // a weekly schedule on today's weekday requests today's check-in at once and queues the member's reminder
  const sched = await asha.post(`/api/coach/clients/${ananya}/checkin-schedules`, { templateId: template.id, weekday: weekdayInZone(new Date().toISOString()) });
  assert.equal(sched.status, 201, JSON.stringify(sched.json));
  assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM checkin_schedules WHERE member_id = ? AND active = 1', [ananya])!.n, 1, 'the new schedule replaced the seeded one');
  assert.ok(lastAudit('checkin.schedule_end'));
  assert.equal((await rahul.post(`/api/coach/clients/${ananya}/checkin-schedules`, { templateId: template.id, weekday: 1 })).json.error?.code, 'NO_ACCESS');
  assert.equal((await asha.post(`/api/coach/clients/${ananya}/checkin-schedules`, { templateId: template.id, weekday: 9 })).status, 400);
  assert.equal((await asha.post(`/api/coach/clients/${ananya}/checkin-schedules`, { templateId: 'ckt_missing', weekday: 1 })).status, 404);

  const mine = await member.get('/api/me/checkins');
  assert.equal(mine.status, 200);
  const today = progress.todayIn(h.ctx);
  const waiting = (mine.json.items as any[]).filter((c) => c.status === 'requested' && c.dueDate === today);
  assert.equal(waiting.length, 1, 'one check-in waits for today (the replaced schedule’s stands; no duplicate)');
  const due = waiting[0];
  assert.equal((mine.json.schedules as any[])[0].id, sched.json.id);

  // validation of answers against the questions it was asked
  const refuse = async (answers: Record<string, unknown>) => { const r = await member.post(`/api/me/checkins/${due.id}/submit`, { answers }); assert.equal(r.status, 400, JSON.stringify(r.json)); return r.json.error?.details as Array<{ path: string }>; };
  assert.ok((await refuse({ energy: 7, sleep: 7, plan: true })).some((d) => d.path === 'answers.energy'));
  assert.ok((await refuse({ energy: 4, plan: true })).some((d) => d.path === 'answers.sleep'), 'required');
  assert.ok((await refuse({ energy: 4, sleep: 40, plan: true })).some((d) => d.path === 'answers.sleep'), 'inside the metric range');
  assert.ok((await refuse({ energy: 4, sleep: 7, plan: 'yes' })).some((d) => d.path === 'answers.plan'));
  assert.ok((await refuse({ energy: 4, sleep: 7, plan: true, extra: 1 })).some((d) => d.path === 'answers.extra'));
  assert.equal((await (await signedIn(DEMO.member2, DEMO_PASSWORDS.member)).post(`/api/me/checkins/${due.id}/submit`, { answers: { energy: 4, sleep: 7, plan: true } })).status, 404, 'another member’s check-in');

  const entriesBefore = h.db.get<{ n: number }>('SELECT COUNT(*) n FROM progress_entries WHERE member_id = ?', [ananya])!.n;
  const sent = await member.post(`/api/me/checkins/${due.id}/submit`, { answers: { energy: 4, sleep: 7.4, plan: true, notes: 'Busy week' } });
  assert.equal(sent.status, 200, JSON.stringify(sent.json));
  assert.equal(sent.json.status, 'submitted');
  assert.equal((sent.json.entries as string[]).length, 2);
  const written = h.db.all<{ metric: string; value: number; source: string; note: string }>('SELECT metric, value, source, note FROM progress_entries WHERE id IN (?, ?)', sent.json.entries as string[]);
  assert.deepEqual(written.map((e) => e.source), ['member', 'member'], 'answers are self-reported entries');
  assert.ok(written.every((e) => e.note.startsWith('Check-in: ')));
  assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM progress_entries WHERE member_id = ?', [ananya])!.n, entriesBefore + 2);
  assert.equal((await member.post(`/api/me/checkins/${due.id}/submit`, { answers: { energy: 4, sleep: 7, plan: true } })).json.error?.code, 'INVALID_STATE');
  assert.ok(h.db.get("SELECT 1 FROM notifications WHERE user_id = ? AND category = 'checkin' AND data LIKE ?", [userId(h.ctx, DEMO.coach), `%${due.id}%`]), 'the assigned coach hears about it');

  // the coach's queue lists it without answers; the client record shows answers while shared
  const queue = await asha.get('/api/coach/checkins');
  const item = (queue.json.items as any[]).find((c) => c.id === due.id);
  assert.ok(item);
  assert.ok(!('answers' in item));
  noRestricted(queue.json);
  const record = await asha.get(`/api/coach/clients/${ananya}/checkins`);
  assert.equal((record.json.items as any[]).find((c) => c.id === due.id).answers.sleep, 7.4);
  assert.ok(lastAudit('health.viewed'));
  noRestricted(record.json);

  // review: the assigned coach only; a reply for the member, a private note for the team
  assert.equal((await rahul.post(`/api/coach/checkins/${due.id}/review`, { response: 'Not mine' })).status, 404);
  const reviewed = await asha.post(`/api/coach/checkins/${due.id}/review`, { response: 'Nice consistency. Same plan next week.', privateNote: 'Watch the late nights.' });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.json));
  assert.equal(reviewed.json.status, 'reviewed');
  assert.equal((reviewed.json.notes as any[])[0].body, 'Watch the late nights.');
  assert.ok(h.db.get("SELECT 1 FROM coach_notes WHERE ref_type = 'checkin' AND ref_id = ? AND visibility = 'private'", [due.id]));
  const seen = await member.get(`/api/me/checkins/${due.id}`);
  assert.equal(seen.json.response, 'Nice consistency. Same plan next week.');
  assert.ok(!('notes' in seen.json), 'the member never sees the team’s private note');
  assert.equal((await asha.post(`/api/coach/checkins/${due.id}/review`, { response: 'Again' })).json.error?.code, 'INVALID_STATE');

  // a client who does not share health records: the coach may ask, but sees no answers and cannot review
  const ask = await meera.post(`/api/coach/clients/${deepa}/checkins`, { templateId: template.id });
  assert.equal(ask.status, 201, JSON.stringify(ask.json));
  assert.ok(h.db.get("SELECT 1 FROM notifications WHERE user_id = ? AND category = 'checkin' AND title = 'Your coach asked for a check-in'", [deepa]));
  assert.equal((await deepaClient.post(`/api/me/checkins/${ask.json.id}/submit`, { answers: { energy: 3, sleep: 6.5, plan: false } })).status, 200);
  const hidden = await meera.get(`/api/coach/clients/${deepa}/checkins`);
  const hiddenItem = (hidden.json.items as any[]).find((c) => c.id === ask.json.id);
  assert.equal(hidden.json.healthShared, false);
  assert.equal(hiddenItem.answersWithheld, true);
  assert.ok(!('answers' in hiddenItem));
  assert.equal((await meera.post(`/api/coach/checkins/${ask.json.id}/review`, { response: 'Hi' })).json.error?.code, 'NOT_SHARED');
  assert.equal((await meera.post(`/api/coach/clients/${deepa}/checkins`, { templateId: template.id, dueDate: '2020-01-01' })).json.error?.code, 'DUE_DATE_PAST');

  // stopping the schedule is audited and only for assigned coaches
  assert.equal((await rahul.del(`/api/coach/clients/${ananya}/checkin-schedules/${sched.json.id}`)).json.error?.code, 'NO_ACCESS');
  const stopped = await asha.del(`/api/coach/clients/${ananya}/checkin-schedules/${sched.json.id}`);
  assert.equal(stopped.json.active, false);
  assert.equal(lastAudit('checkin.schedule_end')!.reason, 'stopped by the coach');
  for (const a of ['checkin.schedule', 'checkin.request', 'checkin.submit', 'checkin.review']) assert.ok(auditCount(a) >= 1, a);
});

test('the materialise job: one check-in per due date, the previous one missed, idempotent; reassignment ends the old coach’s schedule', async () => {
  const ananya = userId(h.ctx, DEMO.member);
  const ashaCtx = as(DEMO.coach);
  const template = progress.listCoachTemplates(ashaCtx, ashaCtx.actor!.id).find((t) => t.scope === 'library')!;
  const now = new Date().toISOString();
  const schedule = progress.createSchedule(ashaCtx, ashaCtx.actor!.id, ananya, { templateId: template.id, weekday: weekdayInZone(now) });
  const first = h.db.get<{ id: string; status: string }>('SELECT id, status FROM checkins WHERE schedule_id = ? ORDER BY due_date DESC', [schedule.id])!;
  assert.equal(first.status, 'requested');
  const reminder = h.db.get<{ status: string; due_at: string; category: string }>("SELECT status, due_at, category FROM reminders WHERE ref_type = 'checkin' AND ref_id = ?", [first.id])!;
  assert.equal(reminder.status, 'queued', 'the member’s reminder is queued (preferences and quiet hours apply when it is sent)');
  assert.equal(reminder.category, 'checkin');
  assert.deepEqual(progress.materialiseAll(h.ctx), { created: 0, missed: 0, ended: 0 }, 'nothing new the same day');

  const week = at(addDays(now, 7));
  const r = progress.materialiseAll(week);
  assert.equal(r.created, 1);
  assert.equal(r.missed, 1);
  assert.equal(h.db.get<{ status: string }>('SELECT status FROM checkins WHERE id = ?', [first.id])!.status, 'missed');
  assert.equal(h.db.get<{ status: string }>("SELECT status FROM reminders WHERE ref_type = 'checkin' AND ref_id = ?", [first.id])!.status, 'cancelled', 'a missed check-in takes its reminder with it');
  assert.equal(lastAudit('checkin.missed')!.target_id, first.id);
  assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM checkins WHERE schedule_id = ?', [schedule.id])!.n, 2);
  assert.deepEqual(progress.materialiseAll(week), { created: 0, missed: 0, ended: 0 }, 'idempotent');
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  assert.equal((await member.post(`/api/me/checkins/${first.id}/submit`, { answers: { energy: 3, sleep: 7, plan: true } })).json.error?.code, 'INVALID_STATE', 'a missed check-in is closed');

  // the CoachAssigned handler: the member moves to another coach, the old schedule ends
  const rahulId = userId(h.ctx, DEMO.coach2);
  h.db.insert('domain_events', { id: 'evt_progress_test1', type: 'CoachAssigned', aggregate_type: 'coach_assignment', aggregate_id: 'asg_test', payload: JSON.stringify({ memberId: ananya, coachId: rahulId }), created_at: now, attempts: 0, next_attempt_at: now });
  await processPending(h.ctx);
  assert.equal(h.db.get<{ active: number }>('SELECT active FROM checkin_schedules WHERE id = ?', [schedule.id])!.active, 0);
  assert.equal(lastAudit('checkin.schedule_end')!.reason, 'the member was assigned another coach');
});

test('series over a range: every point carries its source label; ranges are validated; coaches need health sharing', async () => {
  const ananya = userId(h.ctx, DEMO.member), deepa = userId(h.ctx, DEMO.memberNoShare);
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const meera = await signedIn(DEMO.coach3, DEMO_PASSWORDS.coach);
  assert.equal((await asha.post(`/api/coach/clients/${ananya}/progress`, { metric: 'sleep_hours', value: 7.1 })).status, 201);
  const now = new Date().toISOString();
  h.db.insert('progress_entries', { id: 'prg_import_test', member_id: ananya, metric: 'sleep_hours', value: 6.9, unit: 'h', at: addDays(now, -2), source: 'import', note: null, created_by: null, created_at: now });

  const s = await member.get('/api/me/progress/series?metric=sleep_hours');
  assert.equal(s.status, 200, JSON.stringify(s.json));
  const points = s.json.points as Array<{ source: string; sourceLabel: string; value: number; at: string }>;
  assert.ok(points.length >= 4);
  for (const p of points) assert.equal(p.sourceLabel, PROGRESS_SOURCE_LABELS[p.source as keyof typeof PROGRESS_SOURCE_LABELS], 'every point is labelled');
  assert.ok(points.some((p) => p.sourceLabel === 'Entered by your coach'));
  assert.ok(points.some((p) => p.sourceLabel === 'Imported'));
  assert.ok(points.every((p, i) => i === 0 || points[i - 1]!.at <= p.at), 'in time order');
  assert.equal(s.json.unit, 'h');
  assert.match(s.json.note as string, /Laboratory results stay in your reports/);
  const narrow = await member.get(`/api/me/progress/series?metric=sleep_hours&from=${addDays(now, -1).slice(0, 10)}&to=${addDays(now, 1).slice(0, 10)}`);
  assert.ok((narrow.json.points as unknown[]).length < points.length, 'the range narrows the points');

  assert.equal((await member.get('/api/me/progress/series?metric=sleep_hours&from=2026-05-01&to=2026-04-01')).json.error?.code, 'RANGE_INVALID');
  assert.equal((await member.get('/api/me/progress/series?metric=sleep_hours&from=2020-01-01&to=2026-01-01')).json.error?.code, 'RANGE_TOO_LONG');
  assert.equal((await member.get('/api/me/progress/series?metric=sleep_hours&from=2026-13-01')).status, 400);
  assert.equal((await member.get('/api/me/progress/series?metric=hba1c')).json.error?.code, 'METRIC_UNKNOWN', 'laboratory markers are not progress series');
  assert.equal((await member.get('/api/me/progress/series')).status, 400);

  const coachView = await asha.get(`/api/coach/clients/${ananya}/progress/series?metric=sleep_hours`);
  assert.equal(coachView.status, 200);
  noRestricted(coachView.json);
  assert.equal(JSON.parse(lastAudit('health.viewed')!.data).what, 'progress-series:sleep_hours');
  assert.equal((await meera.get(`/api/coach/clients/${deepa}/progress/series?metric=sleep_hours`)).json.error?.code, 'NOT_SHARED');
  assert.equal((await meera.get(`/api/coach/clients/${ananya}/progress/series?metric=sleep_hours`)).json.error?.code, 'NO_ACCESS');
});

test('adherence: one line per provider and no composite score; a failing provider or a module that is off does not break it', async () => {
  const ananya = userId(h.ctx, DEMO.member), deepa = userId(h.ctx, DEMO.memberNoShare);
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const meera = await signedIn(DEMO.coach3, DEMO_PASSWORDS.coach);
  const r = await member.get('/api/me/adherence');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const plan = (r.json.items as any[]).find((i) => i.key === 'plan_tasks');
  assert.ok(plan.due > 0, 'the demo plan has actions due');
  assert.ok(plan.done > 0 && plan.done <= plan.due);
  assert.equal(plan.pct, Math.round((100 * plan.done) / plan.due));
  assert.ok(!('score' in r.json) && !('total' in r.json), 'no combined score');
  assert.match(r.json.note as string, /not combined into a score/);
  assert.equal((await member.get('/api/me/adherence?from=2026-01-01&to=2027-06-01')).json.error?.code, 'RANGE_TOO_LONG');

  // a provider registered by another module that fails, then that module switched off
  const original = labstackOps.adherence;
  labstackOps.adherence = { key: 'probe', label: 'Probe provider', compute: () => { throw new Error('boom'); } };
  try {
    const broken = await member.get('/api/me/adherence');
    assert.equal(broken.status, 200);
    assert.equal((broken.json.items as any[]).find((i) => i.key === 'probe').note, 'Not available just now');
    assert.ok((broken.json.items as any[]).some((i) => i.key === 'plan_tasks'));
    h.db.run("UPDATE feature_flags SET enabled = 0 WHERE key = 'labstackOps'");
    const off = await member.get('/api/me/adherence');
    assert.ok(!(off.json.items as any[]).some((i) => i.key === 'probe'), 'a module that is off has no line');
  } finally {
    labstackOps.adherence = original;
    h.db.run("UPDATE feature_flags SET enabled = 1 WHERE key = 'labstackOps'");
  }

  assert.equal((await asha.get(`/api/coach/clients/${ananya}/adherence`)).status, 200);
  assert.equal((await meera.get(`/api/coach/clients/${deepa}/adherence`)).json.error?.code, 'NOT_SHARED');
});

test('photos: the switch and the consent gate uploads; types by content; private storage; coaches only while shared and consented; every opening audited; administrators see counts', async () => {
  const ananya = userId(h.ctx, DEMO.member);
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const rahul = await signedIn(DEMO.coach2, DEMO_PASSWORDS.coach);
  const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin, true);
  const anon = client(h.app);
  const upload = (buf: Buffer, extra: Record<string, unknown> = {}) => member.post('/api/me/progress/photos', { dataBase64: buf.toString('base64'), pose: 'front', filename: 'front.jpg', ...extra });

  // the photo switch is off (its stored value): uploads and consent are refused, the list still answers
  assert.equal((await upload(PNG_1x1)).json.error?.code, 'FEATURE_DISABLED');
  assert.equal((await member.post('/api/me/progress/photos/consent', { granted: true, version: progress.PHOTO_CONSENT.version })).json.error?.code, 'FEATURE_DISABLED');
  const listOff = await member.get('/api/me/progress/photos');
  assert.equal(listOff.json.photosEnabled, false);
  assert.equal((listOff.json as any).consent.wording.status, 'pending_counsel');
  await setFlagOn('progressPhotos', true);
  try {
    // the consent first: the current wording's version, recorded and audited
    assert.equal((await upload(PNG_1x1)).json.error?.code, 'PHOTO_CONSENT_REQUIRED');
    assert.equal((await member.post('/api/me/progress/photos/consent', { granted: true, version: 'old' })).json.error?.code, 'CONSENT_VERSION');
    const granted = await member.post('/api/me/progress/photos/consent', { granted: true, version: progress.PHOTO_CONSENT.version });
    assert.equal(granted.status, 200, JSON.stringify(granted.json));
    assert.equal(granted.json.granted, true);
    assert.ok(h.db.get("SELECT 1 FROM member_consents WHERE user_id = ? AND kind = 'progress_photos' AND granted = 1", [ananya]));
    // outside the demo the wording is pending counsel: the consent cannot be recorded, and the missing piece is named
    const prod = { ...as(DEMO.member), config: { ...h.ctx.config, isDemo: false } } as Ctx;
    assert.throws(() => progress.setPhotoConsent(prod, ananya, true, progress.PHOTO_CONSENT.version), (e: { code?: string; details?: { missing?: string } }) => e.code === 'CONSENT_WORDING_PENDING' && /counsel/i.test(e.details?.missing ?? ''));

    // types are read from the bytes, never the name; sizes are capped
    assert.equal((await upload(SVG)).json.error?.code, 'FILE_TYPE');
    assert.equal((await upload(PDF)).json.error?.code, 'FILE_TYPE', 'documents are not photos');
    assert.equal((await member.post('/api/me/progress/photos', { dataBase64: '!!not base64!!', pose: 'front' })).json.error?.code, 'FILE_ENCODING');
    assert.equal((await upload(PNG_1x1, { pose: 'upside_down' })).status, 400);
    assert.equal((await upload(PNG_1x1, { takenAt: addDays(new Date().toISOString(), 3) })).json.error?.code, 'TAKEN_AT_FUTURE');
    assert.throws(() => progress.uploadPhoto(as(DEMO.member), ananya, { dataBase64: Buffer.concat([JPEG_HEAD, Buffer.alloc(progress.PHOTO_MAX_BYTES)]).toString('base64'), pose: 'side' }), (e: { code?: string }) => e.code === 'FILE_TOO_LARGE');
    const up = await upload(PNG_1x1);
    assert.equal(up.status, 201, JSON.stringify(up.json));
    assert.equal(up.json.sharedWithCoach, false, 'private by default');
    const photo = up.json as { id: string; fileId: string };
    const file = h.db.get<{ mime: string; kind: string; storage_path: string; owner_id: string; ref_type: string; ref_id: string }>('SELECT * FROM file_metadata WHERE id = ?', [photo.fileId])!;
    assert.equal(file.mime, 'image/png', 'named .jpg, stored as what it is');
    assert.equal(file.kind, 'progress_photo');
    assert.equal(file.ref_id, photo.id);
    assert.ok(fs.existsSync(path.join(privateDir, file.storage_path)), 'stored under PRIVATE_FILES_DIR');
    assert.equal(lastAudit('progress_photo.upload')!.target_id, photo.id);
    assert.equal((await upload(JPEG_HEAD, { pose: 'back' })).json.pose, 'back');

    // the member opens it with a 5-minute token; the token expires
    const t = await member.post(`/api/files/${photo.fileId}/token`);
    assert.equal(t.status, 200);
    const dl = await anon.get(t.json.url as string);
    assert.equal(dl.status, 200);
    assert.equal(dl.headers['content-type'], 'image/png');
    assert.throws(() => files.resolveFileToken(at(new Date(Date.now() + 6 * 60_000).toISOString()), t.json.token as string), (e: { code?: string }) => e.code === 'LINK_EXPIRED');

    // not shared yet: the coach sees nothing and cannot open it; others never
    assert.deepEqual((await asha.get(`/api/coach/clients/${ananya}/progress/photos`)).json.items, []);
    assert.equal((await asha.post(`/api/files/${photo.fileId}/token`)).status, 404);
    assert.equal((await rahul.get(`/api/coach/clients/${ananya}/progress/photos`)).json.error?.code, 'NO_ACCESS');
    assert.equal((await admin.post(`/api/files/${photo.fileId}/token`)).status, 404, 'administrators never open a photo');

    // shared: the assigned coach lists and opens it; the opening is audited once per token window
    const shared = await member.patch(`/api/me/progress/photos/${photo.id}`, { shareWithCoach: true });
    assert.equal(shared.json.sharedWithCoach, true);
    assert.equal(lastAudit('progress_photo.share')!.target_id, photo.id);
    const list = await asha.get(`/api/coach/clients/${ananya}/progress/photos`);
    assert.deepEqual((list.json.items as any[]).map((p) => p.id), [photo.id]);
    noRestricted(list.json);
    const views = auditCount('progress_photo.view', photo.id);
    const ct = await asha.post(`/api/files/${photo.fileId}/token`);
    assert.equal(ct.status, 200, JSON.stringify(ct.json));
    assert.equal((await anon.get(ct.json.url as string)).status, 200);
    assert.equal(auditCount('progress_photo.view', photo.id), views + 1, 'one opening, one audit row');
    assert.equal(lastAudit('progress_photo.view')!.actor_id, userId(h.ctx, DEMO.coach));
    assert.equal((await rahul.post(`/api/files/${photo.fileId}/token`)).status, 404, 'a coach who is not assigned');

    // health sharing withdrawn: the coach loses access at once (even with a token in hand)
    const ct2 = await asha.post(`/api/files/${photo.fileId}/token`);
    await setShare(member, false);
    assert.equal((await anon.get(ct2.json.url as string)).status, 404, 'the resolver runs again at download');
    assert.equal((await asha.get(`/api/coach/clients/${ananya}/progress/photos`)).json.error?.code, 'NOT_SHARED');
    await setShare(member, true);
    assert.equal((await asha.post(`/api/files/${photo.fileId}/token`)).status, 200);

    // the photo consent withdrawn: hidden from the coach at once, and every photo stops being shared
    await tick();
    const withdrawn = await member.post('/api/me/progress/photos/consent', { granted: false });
    assert.equal(withdrawn.json.granted, false);
    assert.equal((await asha.post(`/api/files/${photo.fileId}/token`)).status, 404);
    assert.deepEqual((await asha.get(`/api/coach/clients/${ananya}/progress/photos`)).json.items, []);
    assert.equal(h.db.get<{ s: number }>('SELECT share_with_coach s FROM progress_photos WHERE id = ?', [photo.id])!.s, 0);
    assert.equal(lastAudit('progress_photo.unshare')!.reason, 'progress photo consent withdrawn');
    assert.equal((await member.patch(`/api/me/progress/photos/${photo.id}`, { shareWithCoach: true })).json.error?.code, 'PHOTO_CONSENT_REQUIRED');
    assert.equal((await member.post(`/api/files/${photo.fileId}/token`)).status, 200, 'the member still opens their own photo');
    await tick();
    await member.post('/api/me/progress/photos/consent', { granted: true, version: progress.PHOTO_CONSENT.version });

    // administrators: counts only, by permission
    const ov = await admin.get(`/api/admin/members/${ananya}/progress`);
    assert.equal(ov.status, 200, JSON.stringify(ov.json));
    assert.equal((ov.json as any).photos.total, 2);
    assert.ok(!JSON.stringify(ov.json).includes(photo.fileId), 'no file reference reaches an administrator');
    assert.ok(!JSON.stringify(ov.json.checkins).includes('"answers"'), 'no check-in answers either');
    assert.equal((await asha.get(`/api/admin/members/${ananya}/progress`)).status, 403);
    const adminId = userId(h.ctx, DEMO.admin);
    setUserPermission(as(DEMO.owner), adminId, 'members.manage', false, 'test: no member access');
    try { assert.equal((await admin.get(`/api/admin/members/${ananya}/progress`)).json.error?.code, 'PERMISSION_DENIED'); }
    finally { setUserPermission(as(DEMO.owner), adminId, 'members.manage', true, 'test: member access back'); }

    // delete: works while the module is off; the bytes are removed at once
    await setFlagOn('progress', false);
    try {
      const del = await member.del(`/api/me/progress/photos/${photo.id}`);
      assert.equal(del.status, 200, JSON.stringify(del.json));
    } finally { await setFlagOn('progress', true); }
    assert.ok(!fs.existsSync(path.join(privateDir, file.storage_path)));
    assert.equal(lastAudit('progress_photo.delete')!.reason, 'deleted by the member');
    assert.equal((await member.post(`/api/files/${photo.fileId}/token`)).status, 404);
    assert.equal((await member.del(`/api/me/progress/photos/${photo.id}`)).status, 404);
    assert.equal((await (await signedIn(DEMO.member2, DEMO_PASSWORDS.member)).del(`/api/me/progress/photos/${((await member.get('/api/me/progress/photos')).json as any).items[0].id}`)).status, 404, 'another member cannot delete it');

    // retention, an owner decision: nothing is deleted while it is not set; once set, older photos go
    assert.deepEqual(progress.applyPhotoRetention(h.ctx), { deleted: 0, retentionDays: null });
    setModuleSetting(as(DEMO.owner), 'progress_photo_retention_days', 30, 'test: thirty days');
    try {
      assert.equal(progress.applyPhotoRetention(h.ctx).deleted, 0, 'nothing is that old yet');
      const later = progress.applyPhotoRetention(at(addDays(new Date().toISOString(), 31)));
      assert.equal(later.deleted, 1);
      assert.match(lastAudit('progress_photo.delete')!.reason ?? '', /^retention/);
      assert.equal(lastAudit('progress_photo.delete')!.actor_role, 'system');
    } finally {
      setModuleSetting(as(DEMO.owner), 'progress_photo_retention_days', null, 'test: back to undecided');
    }
  } finally {
    await setFlagOn('progressPhotos', false);
  }
});

test('data export: goals, check-ins, schedules and photos join the archive as the member sees them; the team’s notes, file details and other people’s records stay out', () => {
  const ananya = userId(h.ctx, DEMO.member), vikram = userId(h.ctx, DEMO.member2);
  const memberCtx = as(DEMO.member), ashaCtx = as(DEMO.coach);
  // a reviewed check-in: a reply for the member and a private note for the coaching team
  const template = progress.listCoachTemplates(ashaCtx, ashaCtx.actor!.id).find((t) => t.scope === 'library')!;
  const asked = progress.requestCheckin(ashaCtx, ashaCtx.actor!.id, ananya, { templateId: template.id });
  progress.submitCheckin(memberCtx, ananya, asked.id, { energy: 4, sleep: 7, plan: true, notes: 'Sample answer for the export test' });
  progress.reviewCheckin(ashaCtx, ashaCtx.actor!.id, asked.id, { response: 'Sample reply for the export test', privateNote: 'Sample private team note for the export test' });
  // a photo in the private store, and a library draft that was never published
  progress.setPhotoConsent(memberCtx, ananya, true, progress.PHOTO_CONSENT.version);
  const photo = progress.uploadPhoto(memberCtx, ananya, { dataBase64: PNG_1x1.toString('base64'), filename: 'export-front.png', pose: 'front' });
  const file = h.db.get<{ storage_path: string; sha256: string }>('SELECT storage_path, sha256 FROM file_metadata WHERE id = ?', [photo.fileId])!;
  progress.createTemplate(as(DEMO.admin), { title: 'Unpublished library draft (export test)', questions: [{ key: 'energy', label: 'Energy this week, 1 to 5', type: 'scale_1_5' }] }, 'library');

  const goalAudits = () => h.db.get<{ n: number }>("SELECT COUNT(*) n FROM audit_events WHERE action LIKE 'goal.%'")!.n;
  const auditsBefore = goalAudits();
  const archive = buildArchive(h.ctx, ananya, 'drq_progress_export_test');
  assert.equal(goalAudits(), auditsBefore, 'building the export changes nothing (no goal evaluation runs)');
  const sections = (archive as { moduleSections?: Record<string, Record<string, { label: string; records: any[] }>> }).moduleSections?.progress;
  assert.ok(sections, 'the progress module contributes its sections');
  assert.deepEqual(Object.keys(sections), ['goals', 'checkins', 'checkinSchedules', 'progressPhotos']);
  for (const s of Object.values(sections)) { assert.ok(s.label.length > 3); assert.ok(Array.isArray(s.records)); }
  assert.equal(archive.notIncluded.find((n) => /^Goals, check-ins/.test(n.what)), undefined, 'progress records leave notIncluded once exported');

  // goals: every goal of the member's, with the values and milestones their own screens show
  assert.equal(sections.goals!.records.length, h.db.get<{ n: number }>('SELECT COUNT(*) n FROM goals WHERE member_id = ?', [ananya])!.n);
  const sleep = sections.goals!.records.find((g) => g.title === 'Sleep 8 hours on most nights');
  assert.equal(sleep.targetValue, 8);
  assert.equal(sleep.startingValue, 6.5);
  assert.equal(sleep.setBy, 'you');
  assert.ok(sleep.milestones.length >= 1 && 'reachedAt' in sleep.milestones[0]);
  assert.ok(sections.goals!.records.some((g) => g.setBy === 'your coach'));

  // check-ins: the questions, the member's answers and the coach's reply; never the team's private note
  const c = sections.checkins!.records.find((x) => x.coachReply === 'Sample reply for the export test');
  assert.ok(c);
  assert.equal(c.yourAnswers.notes, 'Sample answer for the export test');
  assert.equal(c.coach, ashaCtx.actor!.name);
  assert.ok(c.questions.length > 0);
  assert.ok(!('notes' in c) && !('privateNote' in c));
  assert.equal(sections.checkins!.records.length, h.db.get<{ n: number }>('SELECT COUNT(*) n FROM checkins WHERE member_id = ?', [ananya])!.n);
  assert.ok(sections.checkinSchedules!.records.length >= 1);
  assert.deepEqual(Object.keys(sections.checkinSchedules!.records[0]).sort(), ['active', 'checkin', 'coach', 'endedAt', 'startedAt', 'weekday']);

  // photos: name, type and date taken only; a deleted photo is gone
  const p = sections.progressPhotos!.records.find((x) => x.name === 'export-front.png');
  assert.ok(p);
  assert.deepEqual(Object.keys(p).sort(), ['name', 'takenAt', 'type']);
  assert.equal(p.type, 'image/png');
  assert.equal(sections.progressPhotos!.records.length, h.db.get<{ n: number }>('SELECT COUNT(*) n FROM progress_photos WHERE member_id = ? AND deleted_at IS NULL', [ananya])!.n);

  // what is withheld stays out
  assert.ok(!JSON.stringify(archive).includes('Sample private team note for the export test'), 'never the team’s private note, anywhere in the file');
  const mine = JSON.stringify(sections);
  for (const hidden of [photo.id, photo.fileId, file.storage_path, file.sha256, 'Unpublished library draft (export test)', DEMO.coach, DEMO.member, 'Weight to 80 kg', vikram, ananya]) assert.ok(!mine.includes(hidden), `${hidden} stays out of the progress sections`);
  assert.doesNotMatch(mine, /"(storage_path|sha256|file_id|fileId|consent_version|share_with_coach|sharedWithCoach|pose|member_id|memberId|created_by|answersWithheld|valuesWithheld|privateNote)":/, 'no storage, sharing or internal field names');
});

test('the demo seed dates check-ins by the India date, also late in the India evening (after 18:30 UTC)', async () => {
  const late = '2026-10-22T20:00:00.000Z'; // 01:30 on 23 October in India
  const ananya = userId(h.ctx, DEMO.member);
  const demo: DemoSeedContext = { owner: at(late, as(DEMO.owner)), system: at(late), services: h.services, ownerId: userId(h.ctx, DEMO.owner), adminId: userId(h.ctx, DEMO.admin), coachIds: [userId(h.ctx, DEMO.coach)], memberIds: [ananya, userId(h.ctx, DEMO.member2)] };
  await progressModule.seedDemo!(demo);
  const due = (submittedAt: string) => h.db.get<{ due_date: string }>('SELECT due_date FROM checkins WHERE member_id = ? AND submitted_at = ?', [ananya, submittedAt])?.due_date;
  assert.equal(due(addDays(late, -9)), '2026-10-14', 'sent 9 days before 23 October in India: due 14 October, not the UTC date 13 October');
  assert.equal(due(addDays(late, -2)), '2026-10-21');
  assert.equal(h.db.get<{ due_date: string }>("SELECT due_date FROM checkins WHERE member_id = ? AND status = 'requested' AND created_at = ?", [ananya, late])?.due_date, '2026-10-23', 'today’s one-off is due on the India date as well');
});
