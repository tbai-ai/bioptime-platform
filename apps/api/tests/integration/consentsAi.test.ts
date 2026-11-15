/* Round 7, consents and Coach AI (group consentsAi).
   - "Shown while off" (whileOff): a module page or link stays reachable while its flag is off when its check says yes.
     The rules (apps/dashboard/src/modules/whileOff.ts, the same code in apps/mobile/src/lib/whileOff.ts) are loaded as
     they are, through computed specifiers that keep them out of the API's typecheck; the registries' use of them, and
     the Coach AI member page and link that carry aiConsentOnRecord, are checked in the source.
   - The Coach AI consent named in Privacy and sharing (portal and app) while one is on record, and the server answers
     that keep the consent page reachable and withdrawable with the module off.
   - The coach_sharing wording, checked against what a coach's routes actually return with sharing off.
   - The deletion request copy, checked against what POST /me/data-requests does (a team task, no email). */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId } from '../helpers.js';
import type { Ctx } from '../../src/context.js';
import { setFlag, listFlags } from '../../src/domain/features.js';
import * as aiDomain from '../../src/domain/ai.js';

const PLATFORM = fileURLToPath(new URL('../../../../', import.meta.url));
const source = (rel: string) => fs.readFileSync(path.join(PLATFORM, rel), 'utf8');
const load = (spec: string): Promise<any> => import(spec);
const dashboard = (rel: string): Promise<any> => load(pathToFileURL(path.join(PLATFORM, 'apps/dashboard/src', rel)).href);
const mobile = (rel: string): Promise<any> => load(pathToFileURL(path.join(PLATFORM, 'apps/mobile/src', rel)).href);

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); h.db.close(); });

const as = (email: string): Ctx => { const u = h.db.get<{ id: string; role: 'member' | 'coach' | 'admin' | 'owner'; name: string }>('SELECT id, role, name FROM users WHERE email = ?', [email])!; return { ...h.ctx, actor: { id: u.id, role: u.role, email, name: u.name } }; };
const signedIn = async (email: string, password: string) => { const c = client(h.app); await c.login(email, password, password === DEMO_PASSWORDS.member ? 'member' : 'dashboard'); return c; };
const code = (r: { json: { error?: { code: string } } }) => r.json.error?.code;
/** Consents are read latest-first by their time: keep two writes apart. */
const tick = () => new Promise((r) => setTimeout(r, 5));

/* ---------- the whileOff rules ---------- */

for (const [where, rules] of [['portal', () => dashboard('modules/whileOff.ts')], ['app', () => mobile('lib/whileOff.ts')]] as const) {
  test(`whileOff (${where}): asked once per person and minute, again for a new person, a new flag set or after clear; only a resolved true is yes`, async () => {
    const { createWhileOffCache } = await rules();
    let t = 0;
    const cache = createWhileOffCache(60_000, () => t);
    let asked = 0;
    const yes = async () => { asked++; return true; };
    assert.equal(await cache.load('usr_a', yes), true);
    assert.equal(await cache.load('usr_a', yes), true);
    assert.equal(asked, 1, 'once a minute for one person');
    await cache.load('usr_b', yes);
    assert.equal(asked, 2, 'a new person asks again');
    t = 59_999; await cache.load('usr_b', yes);
    assert.equal(asked, 2);
    t = 60_000; await cache.load('usr_b', yes);
    assert.equal(asked, 3, 'after a minute');
    const flags = new Set(['habits']), refreshed = new Set(['habits']);
    await cache.load('usr_b', yes, flags);
    await cache.load('usr_b', yes, flags);
    assert.equal(asked, 4, 'once per flag set');
    await cache.load('usr_b', yes, refreshed);
    assert.equal(asked, 5, 'a refreshed flag set asks again (the app: refreshFeatures)');
    cache.clear();
    await cache.load('usr_b', yes, refreshed);
    assert.equal(asked, 6, 'clear asks again (the portal: refreshFeatures)');

    const noes: Array<[string, () => unknown]> = [['false', async () => false], ['a truthy value', async () => 'yes'], ['undefined', async () => undefined], ['a rejection', async () => { throw new Error('offline'); }], ['a thrown error', () => { throw new Error('not a member'); }]];
    for (const [label, fn] of noes) assert.equal(await cache.load('usr_c', fn), false, `${label} is no`);

    let a = 0, b = 0;
    const fa = async () => { a++; return true; };
    const fb = async () => { b++; return false; };
    const answers = await cache.loadAll('usr_d', [fa, fb, fa]);
    assert.deepEqual([answers.get(fa), answers.get(fb), a, b], [true, false, 1, 1], 'each check asked once, answers by check');
  });
}

test('whileOff decisions: flags on show as before; flags off show only after a yes; a page waits for the answer; LabStack and items without whileOff are unchanged', async () => {
  for (const { shownWith, checksKey } of [await dashboard('modules/whileOff.ts'), await mobile('lib/whileOff.ts')]) {
    const check = async () => true, other = async () => true;
    const none = new Map(), yes = new Map([[check, true]]), no = new Map([[check, false]]);
    assert.equal(shownWith(true, undefined, none), true);
    assert.equal(shownWith(true, check, no), true, 'flags on: shown whatever the check says');
    assert.equal(shownWith(false, undefined, yes), false, 'no whileOff: hidden while off, as before');
    assert.equal(shownWith(false, check, none), false, 'not answered yet');
    assert.equal(shownWith(false, check, no), false);
    assert.equal(shownWith(false, check, yes), true);
    assert.equal(shownWith(false, other, yes), false, 'another item’s answer is not this one’s');
    assert.equal(checksKey([]), '', 'no checks: nothing is asked');
    assert.equal(checksKey([check, other]), checksKey([check, other]));
    assert.notEqual(checksKey([check]), checksKey([other]));
  }
  const { pageState } = await dashboard('modules/whileOff.ts');
  const check = async () => true;
  const state = (p: Record<string, unknown>) => pageState({ flagsLoaded: true, on: false, allowed: true, answers: new Map(), ...p });
  assert.equal(state({ flagsLoaded: false, on: true }), 'loading', 'flags still loading');
  assert.equal(state({ on: true }), 'show');
  assert.equal(state({ on: true, allowed: false }), 'none', 'LabStack rule first');
  assert.equal(state({ allowed: false, whileOff: check, answers: new Map([[check, true]]) }), 'none', 'whileOff never overrides LabStack');
  assert.equal(state({}), 'none', 'no whileOff: "no such page" while off, as before');
  assert.equal(state({ whileOff: check }), 'loading', 'a skeleton while the check is asked');
  assert.equal(state({ whileOff: check, answers: new Map([[check, true]]) }), 'show');
  assert.equal(state({ whileOff: check, answers: new Map([[check, false]]) }), 'none');
});

test('the portal and app copies of the whileOff rules are the same code', () => {
  const code = (rel: string) => source(rel).replace(/^\/\*[\s\S]*?\*\/\n/, '');
  assert.equal(code('apps/dashboard/src/modules/whileOff.ts'), code('apps/mobile/src/lib/whileOff.ts'));
});

test('registries: Gated declares whileOff; the portal honours it for links and pages only, the app for entries; the Coach AI member page, link and entry carry aiConsentOnRecord', () => {
  assert.match(source('apps/dashboard/src/modules/types.ts'), /type Gated = \{[\s\S]*?whileOff\?: \(\) => Promise<boolean>;\n\};/);

  const runtime = source('apps/dashboard/src/modules/runtime.tsx');
  const part = (from: string, to: string) => runtime.slice(runtime.indexOf(from), runtime.indexOf(to));
  const nav = part('export function useModuleNav', '/* ---------- routes');
  assert.ok(nav.includes('labstackAllowed(m, workspace, can) && permitted(can, n.permission, n.any)'), 'LabStack and permission rules first');
  assert.ok(nav.includes('n.whileOff && !flagsOn(features, m, n.feature)'), 'a check is asked only with the flags off');
  assert.ok(nav.includes('shownWith(flagsOn(features, m, n.feature), features ? n.whileOff : undefined, answers)'));
  const gate = part('export function ModuleRouteGate', '/* ---------- client-record tabs');
  assert.ok(gate.includes('pageState({ flagsLoaded: !!features, on, allowed, whileOff: entry.whileOff, answers })'));
  assert.ok(gate.includes("if (state === 'loading') return <Skeleton rows={6} />;"));
  assert.ok(gate.includes('<RequirePermission permission={entry.permission} any={entry.any}>'), 'the page permission still applies');
  assert.ok(runtime.includes('createWhileOffCache(FRESH_MS)'), 'cached for a minute, like the flags');
  assert.ok(runtime.includes('export function refreshFeatures(): void { cached = null; whileOffCache.clear(); }'));
  for (const f of ['export function useModuleTabs', 'export function useModuleCards']) {
    const body = runtime.slice(runtime.indexOf(f), runtime.indexOf('\n}\n', runtime.indexOf(f)));
    assert.ok(!body.includes('whileOff') && !body.includes('useWhileOff'), `${f}: unchanged, a tab or card never shows while off`);
  }

  const aiModule = source('apps/dashboard/src/modules/ai/module.tsx');
  assert.ok(!/type WhileOff/.test(aiModule), 'the local WhileOff type is gone');
  assert.ok(aiModule.includes("{ workspace: 'client', path: 'coach-ai', element: <ClientAiConsent />, whileOff: aiConsentOnRecord }"));
  assert.ok(aiModule.includes("{ workspace: 'client', to: '/coach-ai', label: 'Coach AI', group: 'Privacy', whileOff: aiConsentOnRecord }"));
  assert.equal(aiModule.match(/, whileOff: aiConsentOnRecord \}/g)?.length, 2, 'only the member page and its link');

  const appRegistry = source('apps/mobile/src/lib/modules.ts');
  assert.ok(appRegistry.includes('placement: Placement; whileOff?: WhileOff };'));
  assert.ok(appRegistry.includes("candidates.filter((e) => e.whileOff && !on(e))"), 'a check is asked only with the flag off');
  assert.ok(appRegistry.includes('shownWith(on(e), e.whileOff, answers)'));
  assert.ok(appRegistry.includes('whileOffCache.loadAll(who, checks, features)'), 'asked per member under the flag set, so refreshFeatures asks again');
  const appAi = source('apps/mobile/src/lib/modules/ai.ts');
  assert.ok(!/type WhileOff/.test(appAi));
  assert.ok(appAi.includes("route: '/coach-ai'") && appAi.includes("placement: 'me', whileOff: aiConsentOnRecord"));

  // both checks read GET /me/ai/consent and count any failure (a coach, no network) as no
  for (const s of [aiModule, appAi]) assert.ok(s.includes("('/me/ai/consent').then((s) => !!s?.granted, () => false)"));
});

/* ---------- the Coach AI consent while the module is off ---------- */

test('Coach AI consent on record: Privacy and sharing names it with a link; with the module off the check behind whileOff still says yes and withdrawing works; withdrawn, the line goes', async () => {
  const member = await signedIn(DEMO.member2, DEMO_PASSWORDS.member);
  assert.equal((await member.get('/api/me/consents')).json.ai_processing, undefined, 'nothing on record: no line');
  const given = await member.post('/api/me/ai/consent', { granted: true, version: aiDomain.AI_CONSENT.version });
  assert.equal(given.status, 200, JSON.stringify(given.json));
  const listed = (await member.get('/api/me/consents')).json.ai_processing as { granted: boolean; version: string; at: string };
  assert.equal(listed.granted, true);
  assert.equal(listed.version, aiDomain.AI_CONSENT.version, 'the line names the version');
  assert.ok(!Number.isNaN(Date.parse(listed.at)), 'and the date');

  setFlag(as(DEMO.owner), 'ai', { enabled: false }, 'test: Coach AI off');
  try {
    assert.ok(!((await member.get('/api/public/config')).json.features as string[]).includes('ai'), 'the portal and the app see the module off');
    const mine = await member.get('/api/me/ai/consent');
    assert.equal(mine.status, 200);
    assert.equal(mine.json.granted, true, 'aiConsentOnRecord says yes: the page, its link and the app entry stay');
    assert.equal(((await member.get('/api/me/consents')).json.ai_processing as { granted: boolean }).granted, true, 'the line stays');
    await tick();
    assert.equal((await member.post('/api/me/ai/consent', { granted: false })).status, 200, 'withdrawing works while off');
    assert.equal((await member.get('/api/me/ai/consent')).json.granted, false, 'nothing granted on record: the page and its link go once the check is asked again');
    assert.equal(((await member.get('/api/me/consents')).json.ai_processing as { granted: boolean }).granted, false, 'the line shows only while granted');
  } finally { setFlag(as(DEMO.owner), 'ai', { enabled: true }, 'test: Coach AI on again'); }

  const portal = source('apps/dashboard/src/pages/client/Profile.tsx'), app = source('apps/mobile/src/app/settings/consents.tsx');
  assert.ok(portal.includes('{ai?.granted && <p className="small" style={{ margin: 0 }}>Coach AI drafts: given {fmtDate(ai.at)} (version {ai.version}). Review or withdraw it on <Link to="/coach-ai">Coach AI and your data</Link>.</p>}'));
  assert.ok(app.includes('{ai?.granted ? ') && app.includes('`Coach AI drafts: given ${fmtDate(ai.at)}, under ${wordingOf(ai.version)}. Review or withdraw it on Coach AI and your data.`'));
  assert.ok(app.includes("onPress={() => router.push('/coach-ai')}"));
  for (const s of [portal, app]) {
    assert.ok(s.includes('ai_processing as { granted: boolean; version: string; at: string } | undefined'));
    assert.ok(!s.includes("kind: 'ai_processing'"), 'no switch here: it is given on the Coach AI page, with the current wording');
  }
  // where the link goes: the portal's module page and the app's file route, both titled as the line names them
  assert.ok(source('apps/dashboard/src/modules/ai/ClientAiConsent.tsx').includes('<h1>Coach AI and your data</h1>'));
  assert.ok(source('apps/mobile/src/lib/modules/ai.ts').includes("title: 'Coach AI and your data'"));
  assert.ok(fs.existsSync(path.join(PLATFORM, 'apps/mobile/src/app/coach-ai.tsx')));
});

/* ---------- coach_sharing: the wording against the coach's routes ---------- */

const SHARING_PHRASES = [
  'your coach still sees your name, member ID, age, gender, goals, programme and plan (and city and state unless Bioptime switches those off)',
  'the tasks a coach set for you and whether you did them (such as any habits, workouts, check-ins or courses a coach assigned)',
  'any live sessions you sign up for',
  'what you send them in Messages, including any files',
  'Private while it is off: your measurements, progress log, wellness score and blood tests, and, if you use them, your progress photos, goal values, check-in answers, next steps from blood tests, diet profile, meal logs and photos, workout logs, the habits you add yourself, habit notes, and courses a coach did not assign.',
  'A coach never sees your phone number, email, address, PIN code or date of birth.',
];

test('coach_sharing wording: the same in the portal and the app, and with sharing off a coach’s routes return what it says they still see and nothing it calls private', async () => {
  const bodyOf = (rel: string) => /kind: 'coach_sharing', title: 'My coach may see my health information', body: '([^']*)'/.exec(source(rel))?.[1];
  const portalBody = bodyOf('apps/dashboard/src/pages/client/Profile.tsx'), appBody = bodyOf('apps/mobile/src/app/settings/consents.tsx');
  assert.ok(portalBody);
  assert.equal(appBody, portalBody, 'one wording');
  for (const p of SHARING_PHRASES) assert.ok(portalBody.includes(p), p);
  // Every module flag can be off (in production they all start off): what only a module adds is named after "if you use
  // them" (or with "any"), never in the plain lists of what a coach sees and what stays private.
  const [, privateHalf] = portalBody.split('Private while it is off: ');
  const [plainPrivate, hedgedPrivate] = privateHalf.split(', and, if you use them, ');
  assert.equal(plainPrivate, 'your measurements, progress log, wellness score and blood tests', 'only core records, unhedged');
  for (const moduleOnly of ['progress photos', 'goal values', 'check-in answers', 'next steps from blood tests', 'diet profile', 'meal logs', 'workout logs', 'the habits you add yourself', 'habit notes', 'courses a coach did not assign']) {
    assert.ok(hedgedPrivate.includes(moduleOnly), `${moduleOnly}: in the "if you use them" part`);
  }
  {
    // with every module flag off, the plain part still exists and each thing in the hedged part is gone with its module
    const owner = as(DEMO.owner);
    const modules = ['progress', 'habits', 'nutrition', 'workouts', 'labFollowups', 'learning'];
    const was = new Map(listFlags(owner).filter((f) => modules.includes(f.key)).map((f) => [f.key, f.enabled]));
    assert.equal(was.size, modules.length, 'every module behind the wording has a flag');
    const m = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
    for (const key of modules) setFlag(owner, key, { enabled: false }, 'test: every module off');
    try {
      for (const core of ['/api/me/progress', '/api/me/progress/summary', '/api/me/reports', '/api/me/bloodwork/bookings']) assert.equal((await m.get(core)).status, 200, `${core}: there with every module off`);
      for (const gated of ['/api/me/progress/photos', '/api/me/goals', '/api/me/checkins', '/api/me/lab-follow-ups', '/api/me/nutrition', '/api/me/workouts', '/api/me/habits', '/api/me/courses']) assert.equal(code(await m.get(gated)), 'FEATURE_DISABLED', `${gated}: only with its module`);
    } finally { for (const [key, enabled] of was) setFlag(owner, key, { enabled }, 'test: modules as they were'); }
  }

  const memberId = userId(h.ctx, DEMO.member);
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const coach = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const own = await member.post('/api/me/habits', { title: 'Consents probe: a habit I wrote', schedule: { type: 'daily' } });
  assert.equal(own.status, 201, JSON.stringify(own.json));
  const share = async (granted: boolean) => { await tick(); assert.equal((await member.post('/api/me/consents', { kind: 'coach_sharing', version: '2026-10-17', granted })).status, 200); await tick(); };
  const get = (p: string) => coach.get(`/api/coach/clients/${memberId}${p}`);
  type Json = Record<string, any>;

  // sharing on: the member's own records are there to be withheld
  await share(true);
  assert.ok(((await get('/habits')).json.habits as Json[]).some((x) => x.setBy === 'member'), 'her own habit, while she shares');
  assert.ok(((await get('/learning')).json.items as Json[]).some((x) => x.source !== 'coach_assigned'), 'a course she chose, while she shares');
  assert.equal((await get('/lab-follow-ups')).status, 200);

  await share(false);
  try {
    const rec = await get('');
    assert.equal(rec.status, 200);
    const r = rec.json as Json;
    // what the coach still sees
    assert.equal(r.healthShared, false);
    assert.equal(r.member.name, 'Ananya Rao');
    assert.ok(r.member.memberCode && typeof r.member.age === 'number', 'member ID and age');
    assert.equal(r.profile.profile.gender, 'female');
    assert.deepEqual(r.profile.profile.goals, ['Energy and sleep']);
    assert.ok(r.programme && Array.isArray(r.plans) && r.plans.length > 0, 'programme and plan');
    assert.ok('programmeCompletion' in r.progress, 'whether plan tasks were done');
    assert.equal(r.profile.profile.city, 'Bengaluru', 'city and state while Bioptime leaves them on');
    // nothing the wording calls private, and never contact details
    assert.equal(r.member.wellnessScore, null, 'wellness score');
    assert.deepEqual([r.recentProgress, r.reports, r.bookings], [[], [], []], 'progress log, blood tests');
    assert.equal(r.progress.withheld, true, 'measurements');
    const text = JSON.stringify(r);
    for (const secret of ['+919700000011', DEMO.member, '560001', '1992-03-14', 'Lake View Road']) assert.ok(!text.includes(secret), `no ${secret}`);

    const habits = (await get('/habits')).json.habits as Json[];
    assert.ok(habits.length > 0 && habits.every((x) => x.setBy === 'coach'), 'the habits a coach set, and not the ones she wrote');
    assert.ok(habits.every((x) => typeof x.week?.done === 'number'), 'with whether she did them');
    assert.ok(!JSON.stringify(habits).includes('"note"'), 'no habit notes');

    const goals = (await get('/goals')).json as Json;
    assert.equal(goals.healthShared, false);
    assert.ok((goals.items as Json[]).length > 0 && (goals.items as Json[]).every((g) => !('baselineValue' in g) && !('targetValue' in g) && !('latest' in g)), 'goals without their values');
    const checkins = (await get('/checkins')).json as Json;
    assert.ok((checkins.items as Json[]).length > 0, 'the check-ins and whether she sent them');
    assert.ok((checkins.items as Json[]).every((c) => c.answers == null), 'no check-in answers');
    for (const p of ['/progress/series?metric=weight_kg', '/adherence']) assert.equal(code(await get(p)), 'NOT_SHARED', p);
    assert.notEqual((await get('/progress/photos')).status, 200, 'no progress photos');

    const nutrition = (await get('/nutrition')).json as Json;
    assert.ok((nutrition.plans as Json[]).length > 0, 'the meal plan the coach wrote');
    assert.deepEqual([nutrition.profile, nutrition.logs, nutrition.adherence], [null, [], null], 'no diet profile, meal logs or adherence');

    const workouts = (await get('/workouts')).json as Json;
    assert.ok((workouts.programs as Json[]).length > 0 && (workouts.sessions as Json[]).length > 0, 'the programme and its sessions');
    assert.ok((workouts.sessions as Json[]).every((s) => typeof s.status === 'string' && !('rpe' in s) && !('durationMinutes' in s) && !('memberNote' in s) && !('setsDone' in s)), 'whether she did each, not her logs');

    const learning = (await get('/learning')).json as Json;
    assert.ok((learning.items as Json[]).every((x) => x.source === 'coach_assigned'), 'only courses a coach assigned');

    assert.equal(code(await get('/lab-follow-ups')), 'NOT_SHARED', 'no next steps from blood tests');
    assert.equal(code(await get('/bloodwork')), 'NOT_SHARED');

    const sessions = await get('/sessions');
    assert.equal(sessions.status, 200);
    assert.ok((sessions.json.registrations as Json[]).length > 0, 'the live sessions she signed up for');
  } finally { await share(true); }

  // files sent in Messages follow the conversation, not coach_sharing (messaging.test.ts opens them as the coach)
  const attachments = source('apps/api/src/domain/attachments.ts');
  assert.ok(!attachments.includes('requireHealthAccess') && attachments.includes('a file follows the conversation\'s own rule (participants and assignment), like the message text'));
});

/* ---------- deletion request ---------- */

test('deletion request: a task in the team’s queue and the account marked (purchases refused), which /auth/me reports for the app’s Profile tab; no email, nothing removed, no member route reads the request; the copy says exactly that', async () => {
  const email = DEMO.memberNoCoach;
  const memberId = userId(h.ctx, email);
  const member = await signedIn(email, DEMO_PASSWORDS.member);
  const stateOf = () => h.db.get<{ state: string }>('SELECT state FROM users WHERE id = ?', [memberId])!.state;
  assert.equal(stateOf(), 'active');
  const asked = new Date(Date.now() - 1).toISOString();
  const r = await member.post('/api/me/data-requests', { kind: 'deletion', note: 'test: please close my account' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.status, 'requested');
  const task = h.db.get<{ title: string; status: string }>("SELECT title, status FROM support_tasks WHERE kind = 'data_request' AND ref_type = 'data_request' AND ref_id = ?", [String(r.json.id)]);
  assert.deepEqual({ ...task }, { title: 'Account deletion requested', status: 'open' }, 'the team’s queue');
  assert.equal(stateOf(), 'deletion_requested');
  const me = await member.get('/api/auth/me');
  assert.equal((me.json.user as { state: string }).state, 'deletion_requested', 'the account state the app shows on Profile (label: Deletion requested)');
  assert.equal(code(await member.post('/api/me/checkout', { packageId: 'core', idempotencyKey: 'consentsai-deletion-1' })), 'ACCOUNT_STATE', 'no purchases while it is open');
  assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM outbox_messages WHERE to_address = ? AND created_at >= ?', [email, asked])!.n, 0, 'no email is sent about it');
  assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND created_at >= ?', [memberId, asked])!.n, 0, 'nor a notification');
  const profile = await member.get('/api/me/profile');
  assert.equal(profile.status, 200, 'still signed in');
  assert.equal(profile.json.name, 'Karthik Reddy', 'nothing removed');
  assert.ok(!h.app.hasRoute({ method: 'GET', url: '/api/me/data-requests' }) && !h.app.hasRoute({ method: 'GET', url: '/api/me/data-requests/:id' }), 'no member route reads a request');
  assert.ok(!((await member.get('/api/me/data-exports')).json.items as Array<{ id: string }>).some((e) => e.id === r.json.id), 'the export list leaves it out');

  for (const [rel, where] of [['apps/dashboard/src/pages/client/Profile.tsx', 'portal'], ['apps/mobile/src/app/settings/data.tsx', 'app']] as const) {
    const s = source(rel);
    assert.ok(!/confirms? by email|by email before/.test(s), `${rel}: no email is sent`);
    assert.ok(s.includes('Request recorded. It is in the Bioptime team’s queue.'), rel);
    assert.ok(s.includes(where === 'app'
      ? 'Asking puts your request in the Bioptime team’s queue. Nothing is removed until the team acts on it. While it is open, Profile shows your account as Deletion requested; the app shows nothing more about its progress: questions to privacy@bioptime.com.'
      : 'Asking puts your request in the Bioptime team’s queue. Nothing is removed until the team acts on it, and the portal does not show its progress: questions to privacy@bioptime.com.'), rel);
    assert.ok(!/no member\s+(\*\s+)?screen/.test(s), `${rel}: no comment says no member screen shows it`);
    assert.ok(/[Nn]othing is removed until the team acts on it\. You cannot make purchases while it is open\.|You cannot make purchases while the request is open\. It goes to the Bioptime team’s queue, and nothing is removed until the team acts on it\./.test(s), `${rel}: the confirmation`);
  }
  // what the app's Profile tab (the old Me tab's account line moved there; /(tabs)/me only redirects to it) renders under
  // the name, and the label it gives the state
  const profileTab = source('apps/mobile/src/app/(tabs)/profile.tsx');
  assert.ok(profileTab.includes('{user?.email} · {label(user?.state)}'), 'Profile shows the account state');
  assert.match(source('apps/mobile/src/app/(tabs)/me.tsx'), /<Redirect href="\/\(tabs\)\/profile" \/>/, 'the old Me tab leads there');
  const { label } = await mobile('lib/format.ts');
  assert.equal(label('deletion_requested'), 'Deletion requested');
  // the portal shows the signed-in account's state nowhere: its only use is the onboarding redirect in the Shell
  const portalFiles = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? portalFiles(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []);
  const uses = portalFiles(path.join(PLATFORM, 'apps/dashboard/src')).flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(/user\??\.state\b(.{0,4})/g)].map((x) => `${path.relative(PLATFORM, f)}: ${x[0]}`));
  assert.ok(uses.length > 0 && uses.every((u) => u.startsWith('apps/dashboard/src/shell/Shell.tsx: ') && u.endsWith(' ===')), uses.join('; '));
});
