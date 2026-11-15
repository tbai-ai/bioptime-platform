/* Round 7 privacy: the field policy's one safety net (coachSafe in api/auth/fieldPolicy.ts), every coach-facing GET
   route, the Coach AI context and the ai import cycle.

   - coachSafe looks at a payload as the presenter built it, reports the restricted key paths it finds (never their
     values) through a replaceable reporter, and returns the payload without them: nothing leaks and nothing answers 500.
   - Every coach-facing GET route each module registers (enumerated from the routes the modules register, not a list
     kept here) is called as the demo coaches, for clients who share health information and clients who do not, with
     the real ids of their clients and records: no presenter builds a restricted key (the reporter is never called), and
     no answer carries a restricted key or a member's real phone, email, address, PIN code or date of birth from the
     seed. The core coach routes are called too: nothing reported, and none of the members' values. Every route
     answers 200 at least once for each coach, so every presenter really runs; the records the seed lacks (a Coach AI
     draft, a coach training course, a shared photo, a support request, a hosted class, a lab report for each client
     on a booking that carries the member's real address and patient details) are made first.
   - The Coach AI context goes to an external provider, so its check fails closed: a restricted key in the context as
     built refuses the draft (500 AI_CONTEXT_RESTRICTED, audited as a refusal) and the provider hears nothing.
   - api/domain/ai.ts imports cleanly as the first module of a fresh process, and so do the domains whose route files
     now build their payloads when the routes are registered rather than when the file loads. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ZodTypeAny } from 'zod';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId, type Client } from '../helpers.js';
import type { Ctx } from '../../src/context.js';
import { MODULES } from '../../src/modules/index.js';
import type { ApiModule } from '../../src/modules/types.js';
import { routes as registeredRoutes, type RouteMeta } from '../../src/http/openapi.js';
import { coachSafe, findRestrictedFields, restrictedKeys, setRestrictedFieldReporter, stripRestricted } from '../../src/auth/fieldPolicy.js';
import { coachSafe as habitsCoachSafe } from '../../src/http/routes/habits.js';
import { setSetting } from '../../src/domain/settings.js';
import { AppError } from '../../src/lib/errors.js';
import * as aiDomain from '../../src/domain/ai.js';
import * as learning from '../../src/domain/learning.js';
import * as progress from '../../src/domain/progress.js';
import { setFlag } from '../../src/domain/features.js';
import { overrideAiProviderForTests, type AiDraftRequest, type AiProvider } from '../../src/adapters/ai.js';
import { zonedToIso } from '../../src/lib/time.js';

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MEERA = DEMO.coach3; // Sunita shares health information with her, Deepa does not
const PRIYA = 'priya.nair@demo.bioptime.test'; // Asha's second client; withdraws sharing below, so Asha has one of each
const SUNITA = 'sunita.bhat@demo.bioptime.test';

type Report = { where: string; paths: string[] };
const reports: Report[] = [];
let restoreReporter: ((where: string, paths: string[]) => void) | null = null;
const byModule = new Map<string, RouteMeta[]>();
let coreRoutes: RouteMeta[] = [];
let h: Awaited<ReturnType<typeof makeApp>>;

before(async () => {
  restoreReporter = setRestrictedFieldReporter((where, paths) => { reports.push({ where, paths: [...paths] }); });
  // each module's routes, as the module registers them (the way integration-core counts them)
  const counted = MODULES.map((m): ApiModule => ({ ...m, routes: (app) => { const start = registeredRoutes().length; m.routes(app); byModule.set(m.key, registeredRoutes().slice(start)); } }));
  const start = registeredRoutes().length;
  h = await makeApp({ modules: counted });
  const moduleRoutes = new Set([...byModule.values()].flat());
  coreRoutes = registeredRoutes().slice(start).filter((r) => !moduleRoutes.has(r));
});
after(async () => {
  overrideAiProviderForTests(h.ctx, null);
  if (restoreReporter) setRestrictedFieldReporter(restoreReporter);
  await h.app.close();
  h.db.close();
});

const as = (email: string): Ctx => {
  const u = h.db.get<{ id: string; role: 'member' | 'coach' | 'admin' | 'owner'; name: string }>('SELECT id, role, name FROM users WHERE email = ?', [email])!;
  return { ...h.ctx, actor: { id: u.id, role: u.role, email, name: u.name } };
};
const signedIn = async (email: string, password: string, workspace: 'member' | 'dashboard') => { const c = client(h.app); await c.login(email, password, workspace); return c; };
const coachGets = (rs: RouteMeta[]) => rs.filter((r) => r.method === 'GET' && (r.auth === 'coach' || r.auth === 'any'));

/** A provider that records what it receives. Registered against this test's in-memory database only. */
class RecordingProvider implements AiProvider {
  readonly name = 'test-recorder';
  readonly model = 'test-model';
  readonly configured = true;
  calls: AiDraftRequest[] = [];
  async draft(r: AiDraftRequest) { this.calls.push(JSON.parse(JSON.stringify(r)) as AiDraftRequest); return { text: 'Test draft text (tests only).', model: 'test-model' }; }
}

/* ---------- the seed's contact and identity values, read from the database ---------- */

type Secret = { label: string; test: (body: string) => boolean };
function seededSecrets(): Secret[] {
  const rows = h.db.all<{ email: string; phone: string | null; date_of_birth: string | null; pincode: string | null; address: string | null }>(
    "SELECT u.email, u.phone, p.date_of_birth, p.pincode, p.address FROM users u LEFT JOIN member_profiles p ON p.user_id = u.id WHERE u.role = 'member'");
  const out: Secret[] = [];
  const has = (v: string) => (b: string) => b.includes(v);
  const digits = (v: string) => { const re = new RegExp(`(?<![0-9])${v.replace(/[^0-9]/g, '')}(?![0-9])`); return (b: string) => re.test(b); };
  for (const r of rows) {
    out.push({ label: `email ${r.email}`, test: has(r.email) });
    if (r.phone) { out.push({ label: `phone ${r.phone}`, test: has(r.phone) }); out.push({ label: `phone digits ${r.phone}`, test: digits(r.phone.slice(-10)) }); }
    if (r.date_of_birth) out.push({ label: `date of birth ${r.date_of_birth}`, test: has(r.date_of_birth) });
    if (r.pincode) out.push({ label: `PIN code ${r.pincode}`, test: digits(r.pincode) });
    if (r.address) out.push({ label: `address ${r.address}`, test: has(r.address) });
  }
  out.push({ label: 'any seeded street address', test: has('Lake View Road') });
  assert.ok(out.length > 40, 'the seed has members with contact details to look for');
  return out;
}

/* ---------- real ids for the routes' path parameters ---------- */

type Who = { coachId: string; clientIds: string[] };
const inList = (ids: string[]) => ids.map(() => '?').join(', ');
const ids = (sql: string, params: unknown[]) => h.db.all<{ id: string }>(sql, params as string[]).map((r) => r.id);
/** One entry per path pattern a coach-facing GET route uses; a route with a parameter and no entry fails the test, so a
 *  new route is never skipped quietly. */
const ID_SOURCES: Array<{ pattern: RegExp; ids: (w: Who) => string[] }> = [
  { pattern: /^\/coach\/clients\/:id(\/|$)/, ids: (w) => w.clientIds },
  { pattern: /^\/coach\/meal-plans\/:id$/, ids: (w) => ids(`SELECT id FROM meal_plans WHERE coach_id = ? AND member_id IN (${inList(w.clientIds)})`, [w.coachId, ...w.clientIds]) },
  { pattern: /^\/coach\/workout-templates\/:id$/, ids: (w) => ids("SELECT id FROM workout_templates WHERE status = 'published' OR created_by = ? ORDER BY created_at LIMIT 4", [w.coachId]) },
  { pattern: /^\/coach\/workout-programs\/:id$/, ids: (w) => ids(`SELECT id FROM workout_programs WHERE member_id IN (${inList(w.clientIds)})`, w.clientIds) },
  { pattern: /^\/coach\/workouts\/:id$/, ids: (w) => w.clientIds.flatMap((m) => ids("SELECT id FROM workout_sessions WHERE member_id = ? ORDER BY CASE status WHEN 'scheduled' THEN 1 ELSE 0 END, scheduled_date DESC LIMIT 3", [m])) },
  { pattern: /^\/coach\/sessions\/:id(\/|$)/, ids: (w) => ids('SELECT id FROM live_sessions WHERE host_id = ?', [w.coachId]) },
  { pattern: /^\/coach\/appointments\/:id\//, ids: (w) => ids(`SELECT id FROM appointments WHERE coach_id = ? AND member_id IN (${inList(w.clientIds)})`, [w.coachId, ...w.clientIds]) },
  { pattern: /^\/conversations\/:id\//, ids: (w) => ids('SELECT id FROM conversations WHERE coach_id = ?', [w.coachId]) },
  { pattern: /^\/coach\/courses\/:id$/, ids: () => ids("SELECT id FROM courses WHERE status = 'published' AND audience != 'coaches'", []) },
  { pattern: /^\/coach\/training\/:id$/, ids: () => ids("SELECT id FROM courses WHERE status = 'published' AND audience = 'coaches'", []) },
  { pattern: /^\/coach\/lessons\/:id$/, ids: () => ids("SELECT l.id FROM lessons l JOIN course_modules m ON m.id = l.module_id JOIN courses c ON c.id = m.course_id WHERE c.status = 'published' AND l.status = 'published' ORDER BY c.audience, l.sort LIMIT 6", []) },
  { pattern: /^\/coach\/ai\/drafts\/:id$/, ids: (w) => ids('SELECT id FROM ai_drafts WHERE coach_id = ?', [w.coachId]) },
  { pattern: /^\/support-requests\/:id$/, ids: (w) => ids('SELECT id FROM support_requests WHERE requester_id = ?', [w.coachId]) },
  { pattern: /^\/help\/articles\/:slug$/, ids: () => h.db.all<{ slug: string }>("SELECT slug FROM help_articles WHERE status = 'published' LIMIT 4").map((r) => r.slug) },
  { pattern: /^\/coach\/plans\/:id$/, ids: (w) => ids('SELECT id FROM coaching_plans WHERE coach_id = ?', [w.coachId]) },
  { pattern: /^\/reports\/:id$/, ids: (w) => ids(`SELECT id FROM report_metadata WHERE member_id IN (${inList(w.clientIds)})`, w.clientIds) },
];

/** A calendar date `days` from today in India (YYYY-MM-DD). */
const istDate = (days: number) => new Date(Date.now() + 330 * 60_000 + days * 86_400_000).toISOString().slice(0, 10);

/** Query variants: one per client for a memberId filter, a metric for a series, and dates for a required date. */
function queryVariants(r: RouteMeta, w: Who): string[] {
  const shape = ((r.query as (ZodTypeAny & { shape?: Record<string, unknown> }) | undefined)?.shape) ?? {};
  const out = [''];
  if ('memberId' in shape) out.push(...w.clientIds.map((m) => `memberId=${m}`));
  if ('metric' in shape) return ['metric=sleep_hours', 'metric=weight_kg', 'metric=steps'];
  if ('date' in shape) return [`date=${istDate(1)}`, `date=${istDate(7)}`];
  if ('range' in shape) out.push('range=all');
  return out;
}

/** Every URL to call for a route: each id from its source for each parameter, then the query variants. */
function urlsFor(r: RouteMeta, w: Who): { urls: string[]; missingSource: boolean } {
  const params = [...r.path.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1]!);
  let paths = [r.path];
  if (params.length) {
    const source = ID_SOURCES.find((s) => s.pattern.test(r.path));
    if (!source) return { urls: [], missingSource: true };
    const values = source.ids(w);
    paths = values.map((v) => r.path.replace(/:[A-Za-z]+/, encodeURIComponent(v)));
    if (params.length > 1) throw new Error(`${r.path}: more than one parameter; add a source for it`);
  }
  const qs = queryVariants(r, w);
  return { urls: paths.flatMap((p) => qs.map((q) => `/api${p}${q ? `?${q}` : ''}`)), missingSource: false };
}

type Call = { route: string; url: string; status: number; body: string; json: unknown; reports: Report[] };
async function sweep(c: Client, w: Who, routes: RouteMeta[]): Promise<{ calls: Call[]; noSource: string[]; noIds: string[] }> {
  const calls: Call[] = [];
  const noSource: string[] = [];
  const noIds: string[] = [];
  for (const r of routes) {
    const { urls, missingSource } = urlsFor(r, w);
    if (missingSource) { noSource.push(r.path); continue; }
    if (!urls.length) { noIds.push(r.path); continue; }
    for (const url of urls) {
      const start = reports.length;
      const res = await c.get(url);
      calls.push({ route: r.path, url, status: res.status, body: res.text, json: res.json, reports: reports.slice(start) });
    }
  }
  return { calls, noSource, noIds };
}

/* ---------- coachSafe ---------- */

test('coachSafe checks the payload as built, reports the paths (never the values) and returns it without the restricted keys', () => {
  const local: Report[] = [];
  const prev = setRestrictedFieldReporter((where, paths) => { local.push({ where, paths }); });
  try {
    // a clean payload goes out as built, the same object, and nothing is reported
    const clean = { items: [{ name: 'Ananya Rao', profile: { age: 34, city: 'Bengaluru', state: 'Karnataka', goals: ['Energy and sleep'] } }], at: new Date('2026-10-01T00:00:00Z') };
    assert.equal(coachSafe(h.ctx, clean, 'unit'), clean);
    assert.equal(local.length, 0);

    // restricted keys anywhere, however deep, however spelt: stripped, and reported once with every path
    const leak = {
      client: { name: 'Test Member', phone: '+919711111111', Email: 'leak@example.test', profile: { Date_Of_Birth: '1990-01-01', pin_code: '999001', city: 'Kochi' } },
      rows: [[{ title: 'x', addressLine1: '1 Leak Road' }], { contact_phone: '+919722222222', ok: true }],
      account: { passwordHash: 'h', mfa_secret: 's', tokenHash: 't', aadhaar: '0000', card: '4111' },
      when: new Date('2026-10-02T00:00:00Z'),
    };
    const snapshot = JSON.stringify(leak);
    const out = coachSafe(h.ctx, leak, 'unit leak');
    assert.equal(JSON.stringify(leak), snapshot, 'the presenter’s object is not changed');
    assert.deepEqual(findRestrictedFields(out, restrictedKeys()), [], 'nothing restricted goes out');
    assert.equal(out.client.name, 'Test Member');
    assert.equal(out.client.profile.city, 'Kochi', 'city is not a restricted key');
    assert.equal((out.rows[1] as { ok?: boolean }).ok, true);
    assert.ok(out.when instanceof Date, 'dates pass through untouched');
    assert.equal(local.length, 1, 'one report per payload');
    assert.equal(local[0]!.where, 'unit leak');
    assert.deepEqual([...local[0]!.paths].sort(), [
      '.account.aadhaar', '.account.card', '.account.mfa_secret', '.account.passwordHash', '.account.tokenHash',
      '.client.Email', '.client.phone', '.client.profile.Date_Of_Birth', '.client.profile.pin_code',
      '.rows[0][0].addressLine1', '.rows[1].contact_phone',
    ].sort());
    const reported = JSON.stringify(local);
    for (const v of ['+919711111111', 'leak@example.test', '1990-01-01', '999001', '1 Leak Road', '+919722222222', '4111']) assert.ok(!reported.includes(v), `the report never carries a value (${v})`);
    assert.deepEqual(out, stripRestricted(leak, restrictedKeys()), 'the same as stripping, so nothing answers 500');

    // the habits routes' exported helper is the same safety net (it no longer refuses with a 500)
    local.length = 0;
    const habitsOut = habitsCoachSafe(h.ctx, { habits: [{ title: 'Evening walk', member: { phone: '+919700000013' } }] });
    assert.deepEqual(habitsOut, { habits: [{ title: 'Evening walk', member: {} }] });
    assert.deepEqual(local, [{ where: 'habits coach route', paths: ['.habits[0].member.phone'] }]);
    assert.doesNotThrow(() => habitsCoachSafe(h.ctx, { email: 'someone@example.test' }));
  } finally { setRestrictedFieldReporter(prev); }
});

/* ---------- every coach-facing GET route ---------- */

test('every coach-facing GET route the modules register: no presenter builds a restricted key, and no answer carries one or a member’s contact values', async () => {
  // the enumeration is real: every module with coach-facing reads is in it
  const moduleGets = [...byModule].flatMap(([key, rs]) => coachGets(rs).map((r) => ({ key, r })));
  for (const key of ['habits', 'progress', 'nutrition', 'workouts', 'labFollowups', 'sessions', 'messaging', 'learning', 'ai', 'support']) assert.ok(moduleGets.some((m) => m.key === key), `module ${key} registers coach-facing reads`);
  assert.ok(moduleGets.length >= 40, `found ${moduleGets.length} module routes`);

  // a Coach AI draft exists, so GET /coach/ai/drafts/:id is called with a real id (a recording provider, tests only)
  const provider = new RecordingProvider();
  overrideAiProviderForTests(h.ctx, provider);
  setSetting(as(DEMO.owner), 'ai_draft_retention_days', 30, 'test: thirty days');
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach, 'dashboard');
  const ananya = userId(h.ctx, DEMO.member);
  const drafted = await asha.post('/api/coach/ai/drafts', { purpose: 'plan_outline', memberId: ananya });
  assert.equal(drafted.status, 201, JSON.stringify(drafted.json));
  // a published coach training course (the seed has none), so GET /coach/training/:id is called with a real id
  const owner = as(DEMO.owner);
  const course = learning.createCourse(owner, { title: 'Test coach training (tests only)', summary: 'Tests only.', audience: 'coaches' }) as { id: string };
  learning.createModule(owner, course.id, { title: 'Test module' });
  const moduleId = h.db.get<{ id: string }>('SELECT id FROM course_modules WHERE course_id = ?', [course.id])!.id;
  const lesson = learning.createLesson(owner, moduleId, { title: 'Test lesson', kind: 'written', body: 'Tests only.' });
  learning.setLessonStatus(owner, lesson.id, 'published');
  learning.setCourseStatus(owner, course.id, 'publish', 'test: a coach training course');
  assert.equal((await asha.post(`/api/coach/training/${course.id}/enroll`)).status, 200);
  // the photo switch on and one photo Ananya shares, so the coach's photo list has a photo to present
  setFlag(owner, progress.PHOTOS_FLAG, { enabled: true }, 'test: progress photos on');
  const ananyaApp = await signedIn(DEMO.member, DEMO_PASSWORDS.member, 'member');
  assert.equal((await ananyaApp.post('/api/me/progress/photos/consent', { granted: true, version: progress.PHOTO_CONSENT.version })).status, 200);
  const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const photo = await ananyaApp.post('/api/me/progress/photos', { dataBase64: PNG_1x1, pose: 'front', filename: 'front.png' });
  assert.equal(photo.status, 201, JSON.stringify(photo.json));
  assert.equal((await ananyaApp.patch(`/api/me/progress/photos/${String(photo.json.id)}`, { shareWithCoach: true })).json.sharedWithCoach, true);
  // a support request of Asha's own, so GET /support-requests/:id is called with a real id
  assert.equal((await asha.post('/api/support-requests', { category: 'app', subject: 'Test request (tests only)', body: 'Tests only: a request to read back.' })).status, 201);

  // Priya withdraws health sharing: Asha has a client who shares (Ananya) and one who does not (Priya); Meera has
  // Sunita (shares) and Deepa (never shared, in the seed)
  const priya = await signedIn(PRIYA, DEMO_PASSWORDS.member, 'member');
  assert.equal((await priya.post('/api/me/consents', { kind: 'coach_sharing', version: '2026-10-17', granted: false })).status, 200);
  const meera = await signedIn(MEERA, DEMO_PASSWORDS.coach, 'dashboard');
  const coaches = [
    { label: 'Asha', c: asha, w: { coachId: userId(h.ctx, DEMO.coach), clientIds: [ananya, userId(h.ctx, PRIYA)] }, sharer: ananya, nonSharer: userId(h.ctx, PRIYA) },
    { label: 'Meera', c: meera, w: { coachId: userId(h.ctx, MEERA), clientIds: [userId(h.ctx, SUNITA), userId(h.ctx, DEMO.memberNoShare)] }, sharer: userId(h.ctx, SUNITA), nonSharer: userId(h.ctx, DEMO.memberNoShare) },
  ];
  const sharing = (m: string) => h.db.get<{ granted: number }>("SELECT granted FROM member_consents WHERE user_id = ? AND kind = 'coach_sharing' ORDER BY at DESC, rowid DESC LIMIT 1", [m])?.granted === 1;
  for (const k of coaches) {
    assert.deepEqual(k.w.clientIds.slice().sort(), h.db.all<{ member_id: string }>("SELECT member_id FROM coach_assignments WHERE coach_id = ? AND status = 'active'", [k.w.coachId]).map((r) => r.member_id).sort(), `${k.label}'s clients are the seeded ones`);
    assert.ok(sharing(k.sharer) && !sharing(k.nonSharer), `${k.label} has a client who shares and one who does not`);
  }
  // Meera's own records too (the seed gives her none), so every parameterised route is called with a real id for both
  // coaches: a Coach AI draft for Sunita, a support request, and a published group class she hosts
  const sunitaApp = await signedIn(SUNITA, DEMO_PASSWORDS.member, 'member');
  assert.equal((await sunitaApp.post('/api/me/ai/consent', { granted: true, version: aiDomain.AI_CONSENT.version })).status, 200, 'Sunita agrees to Coach AI');
  const meeraDraft = await meera.post('/api/coach/ai/drafts', { purpose: 'plan_outline', memberId: coaches[1]!.sharer });
  assert.equal(meeraDraft.status, 201, JSON.stringify(meeraDraft.json));
  assert.equal((await meera.post('/api/support-requests', { category: 'app', subject: 'Test request (tests only)', body: 'Tests only: a request to read back.' })).status, 201);
  const cls = await meera.post('/api/coach/sessions', { kind: 'group_class', title: 'Test class (tests only)', audience: 'members', startAt: zonedToIso(istDate(5), 18 * 60), endAt: zonedToIso(istDate(5), 18 * 60 + 45) });
  assert.equal(cls.status, 201, JSON.stringify(cls.json));
  assert.equal((await meera.post(`/api/coach/sessions/${String(cls.json.id)}/publish`)).status, 200);
  // a delivered lab report for every client the seed gives none (Priya, Sunita, Deepa), on a booking that carries the
  // member's real collection address, PIN code and patient details the way a booking does: GET /reports/:id is then
  // called for a client who shares and one who does not, for both coaches, and the booking's copies are looked for too
  const testId = h.db.get<{ id: string }>('SELECT id FROM bloodwork_tests LIMIT 1')!.id;
  for (const m of coaches.flatMap((k) => k.w.clientIds)) {
    if (h.db.get('SELECT 1 FROM report_metadata WHERE member_id = ?', [m])) continue;
    const p = h.db.get<{ name: string; email: string; phone: string | null; gender: string | null; date_of_birth: string | null; pincode: string | null; address: string | null; city: string | null; state: string | null }>(
      'SELECT u.name, u.email, u.phone, p.gender, p.date_of_birth, p.pincode, p.address, p.city, p.state FROM users u JOIN member_profiles p ON p.user_id = u.id WHERE u.id = ?', [m])!;
    assert.ok(p.address && p.pincode && p.phone && p.date_of_birth, 'the seed gives the member contact details to look for');
    const now = new Date().toISOString(), bookingId = `bkg_r7_privacy_${m}`;
    h.db.insert('bloodwork_bookings', { id: bookingId, reference: `LAB-R7P-${m.slice(-8)}`, member_id: m, test_id: testId, status: 'results_ready', slot_at: now, patient: JSON.stringify({ name: p.name, email: p.email, mobile: p.phone, gender: p.gender, dateOfBirth: p.date_of_birth }), pincode: p.pincode, address: p.address, city: p.city ?? 'Test city', state: p.state ?? 'Test state', created_at: now, updated_at: now });
    h.db.insert('report_metadata', { id: `rpt_r7_privacy_${m}`, booking_id: bookingId, member_id: m, vendor_link: 'standin://report', storage_path: null, delivered_at: now, released_at: null, reviewed_at: null, reviewed_by: null, coach_note: null, flagged: '[]', markers: null, values_status: 'pending', created_at: now });
  }
  for (const k of coaches) for (const m of k.w.clientIds) assert.ok(h.db.get('SELECT 1 FROM report_metadata WHERE member_id = ?', [m]), `${k.label}: a report for each client`);

  const secrets = seededSecrets();
  const keys = restrictedKeys();
  reports.length = 0;
  const all: Array<Call & { coach: string; module: boolean }> = [];
  const noIds: string[] = []; // 'coach route' for a parameterised route a coach had no record for
  for (const k of coaches) {
    const mod = await sweep(k.c, k.w, moduleGets.map((m) => m.r));
    assert.deepEqual(mod.noSource, [], 'every parameterised module route has an id source here');
    const core = await sweep(k.c, k.w, coachGets(coreRoutes));
    assert.deepEqual(core.noSource, [], 'every parameterised core route has an id source here');
    all.push(...mod.calls.map((x) => ({ ...x, coach: k.label, module: true })), ...core.calls.map((x) => ({ ...x, coach: k.label, module: false })));
    noIds.push(...[...mod.noIds, ...core.noIds].map((p) => `${k.label} ${p}`));
  }
  assert.deepEqual(noIds, [], 'every parameterised route was called with a real id, for each coach');

  // (1) no presenter built a restricted key: the safety net never had to strip anything, for a module read or for a
  // core coach read (api/http/routes/coach.ts uses coachSafe too)
  assert.deepEqual(all.filter((x) => x.reports.length).map((x) => `${x.coach} ${x.url}: ${JSON.stringify(x.reports)}`), [], 'coachSafe reported nothing');
  assert.deepEqual(reports, [], 'the reporter was never called');

  // nothing broke, and the reads really ran (not refused before the presenter): every route, module and core, answered
  // 200 at least once for each coach
  const failed = all.filter((x) => x.status >= 500);
  assert.deepEqual(failed.map((x) => `${x.coach} ${x.url} ${x.status}`), []);
  const ok = all.filter((x) => x.status === 200);
  const everyRoute = [...new Set([...moduleGets.map((m) => m.r.path), ...coachGets(coreRoutes).map((r) => r.path)])];
  for (const k of coaches) {
    const okRoutes = new Set(ok.filter((x) => x.coach === k.label).map((x) => x.route));
    assert.deepEqual(everyRoute.filter((p) => !okRoutes.has(p)), [], `${k.label}: every coach-facing route answered 200 at least once`);
  }
  // health detail of a client who does not share is refused, and of one who shares is answered
  for (const k of coaches) {
    const goals = (m: string) => all.find((x) => x.coach === k.label && x.url === `/api/coach/clients/${m}/checkins`)!;
    assert.equal(goals(k.sharer).status, 200, `${k.label}: a sharing client's check-ins`);
    const nonSharer = goals(k.nonSharer);
    assert.equal(nonSharer.status, 200, `${k.label}: a non-sharing client's check-ins, without answers`);
    assert.equal((nonSharer.json as { healthShared?: boolean }).healthShared, false);
    // a lab report: a sharing client's opens, a non-sharing client's is refused
    const reportCalls = (m: string) => { const rids = ids('SELECT id FROM report_metadata WHERE member_id = ?', [m]); return all.filter((x) => x.coach === k.label && rids.some((r) => x.url === `/api/reports/${encodeURIComponent(r)}`)); };
    const shared = reportCalls(k.sharer), notShared = reportCalls(k.nonSharer);
    assert.ok(shared.length > 0 && shared.every((x) => x.status === 200), `${k.label}: a sharing client's reports open: ${JSON.stringify(shared.map((x) => x.status))}`);
    assert.ok(notShared.length > 0 && notShared.every((x) => x.status === 403 && (x.json as { error?: { code?: string } }).error?.code === 'NOT_SHARED'), `${k.label}: a non-sharing client's report is refused: ${JSON.stringify(notShared.map((x) => x.status))}`);
  }

  // (2) no answer carries a restricted key (module routes) or a member's real contact or identity value (every route)
  for (const x of all) {
    if (x.module) assert.deepEqual(findRestrictedFields(x.json, keys), [], `${x.coach} ${x.url}: no restricted key`);
    for (const s of secrets) assert.ok(!s.test(x.body), `${x.coach} ${x.url}: carries ${s.label}`);
  }
  // (the core coach routes are checked for the members' values only: several carry the coach's own email and phone,
  // which are theirs, under keys the field policy restricts for a client)
  assert.ok(all.length > 150, `${all.length} calls`);

  assert.equal((await priya.post('/api/me/consents', { kind: 'coach_sharing', version: '2026-10-17', granted: true })).status, 200);
  overrideAiProviderForTests(h.ctx, null);
});

/* ---------- the Coach AI context fails closed ---------- */

test('a restricted key in the Coach AI context as built refuses the draft (500 AI_CONTEXT_RESTRICTED); nothing reaches the provider and nothing stripped is sent', async () => {
  // the check itself
  const local: Report[] = [];
  const prev = setRestrictedFieldReporter((where, paths) => { local.push({ where, paths }); });
  try {
    assert.doesNotThrow(() => aiDomain.assertProviderContextClean({ purpose: 'plan_outline', client: { firstName: 'Ananya', age: 34, preferences: { language: 'English' } } }));
    assert.equal(local.length, 0);
    assert.throws(() => aiDomain.assertProviderContextClean({ client: { firstName: 'Ananya', preferences: { Contact_Phone: '+919700000011' } } }), (e: unknown) => {
      assert.ok(e instanceof AppError);
      assert.equal(e.code, aiDomain.AI_CONTEXT_RESTRICTED);
      assert.equal(e.code, 'AI_CONTEXT_RESTRICTED');
      assert.equal(e.status, 500);
      assert.ok(!JSON.stringify(e.toJSON()).includes('+919700000011'), 'the refusal carries no value');
      return true;
    });
    assert.deepEqual(local, [{ where: 'Coach AI context', paths: ['.client.preferences.Contact_Phone'] }], 'reported with the path, never the value');
  } finally { setRestrictedFieldReporter(prev); }

  // through the route, with a restricted key injected where a member's profile reaches the context (preferences)
  const provider = new RecordingProvider();
  overrideAiProviderForTests(h.ctx, provider);
  setSetting(as(DEMO.owner), 'ai_draft_retention_days', 30, 'test: thirty days');
  const ananya = userId(h.ctx, DEMO.member), ashaId = userId(h.ctx, DEMO.coach);
  const original = h.db.get<{ preferences: string }>('SELECT preferences FROM member_profiles WHERE user_id = ?', [ananya])!.preferences;
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach, 'dashboard');
  local.length = 0;
  const prev2 = setRestrictedFieldReporter((where, paths) => { local.push({ where, paths }); });
  try {
    h.db.run('UPDATE member_profiles SET preferences = ? WHERE user_id = ?', [JSON.stringify({ ...JSON.parse(original), contactPhone: '+919700000011' }), ananya]);
    // buildContext refuses rather than strips
    assert.throws(() => aiDomain.buildContext(as(DEMO.coach), ashaId, { purpose: 'plan_outline', memberId: ananya }, { id: ananya, name: 'Ananya Rao' }), (e: unknown) => e instanceof AppError && e.code === 'AI_CONTEXT_RESTRICTED');
    const draftsBefore = h.db.get<{ n: number }>('SELECT COUNT(*) n FROM ai_drafts')!.n;
    const callsBefore = provider.calls.length;
    for (const purpose of ['plan_outline', 'message_reply'] as const) {
      const r = await asha.post('/api/coach/ai/drafts', { purpose, memberId: ananya });
      assert.equal(r.status, 500, JSON.stringify(r.json));
      assert.equal(r.json.error?.code, 'AI_CONTEXT_RESTRICTED');
      assert.ok(!r.text.includes('+919700000011'));
    }
    assert.equal(provider.calls.length, callsBefore, 'the provider hears nothing: no stripped context is sent in its place');
    assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM ai_drafts')!.n, draftsBefore, 'no draft is stored');
    const refusal = h.db.get<{ data: string }>("SELECT data FROM audit_events WHERE action = 'ai.draft_request' AND actor_id = ? AND json_extract(data, '$.code') = 'AI_CONTEXT_RESTRICTED' ORDER BY at DESC LIMIT 1", [ashaId]);
    assert.ok(refusal, 'audited as a refusal');
    assert.equal(JSON.parse(refusal!.data).outcome, 'refused');
    assert.ok(!refusal!.data.includes('+919700000011'));
    assert.ok(local.length >= 2 && local.every((x) => x.where === 'Coach AI context' && x.paths.includes('.client.preferences.contactPhone')), JSON.stringify(local));
  } finally {
    setRestrictedFieldReporter(prev2);
    h.db.run('UPDATE member_profiles SET preferences = ? WHERE user_id = ?', [original, ananya]);
  }
  // without the injected key the same request is drafted, and the provider's context is clean
  const ok = await asha.post('/api/coach/ai/drafts', { purpose: 'plan_outline', memberId: ananya });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.equal(provider.calls.length, 1);
  assert.deepEqual(findRestrictedFields(provider.calls[0], restrictedKeys()), []);
  overrideAiProviderForTests(h.ctx, null);
});

/* ---------- the ai import cycle ---------- */

test('api/domain/ai.ts, the ai route file, the domains whose route files build their payloads lazily, and the progress, billing and help domains import cleanly as the first module of a fresh process', () => {
  // the ai cycle: domain/ai -> modules/index -> modules/ai -> routes/ai, which reads only api/domain/aiConstants.ts at
  // load; and the route files that build their payloads when the routes are registered (progress, messaging, lab
  // follow-ups, sessions), so the attachments, announcements, lab follow-up and sessions domains can come first too;
  // and (round 8) the domains whose values a module descriptor or route file reads while it loads, which now come from
  // files that import nothing: api/domain/progressConstants.ts (PHOTO_FILE_KIND, read by api/modules/progress.ts),
  // billingConstants.ts (BILLING_FEATURE for the billing route file, DOCUMENT_FILE_ROUTE for api/modules/billing.ts)
  // and helpConstants.ts (HELP_AUDIENCES and SLUG_RE for the support route file)
  for (const rel of [
    'src/domain/ai.ts', 'src/http/routes/ai.ts',
    'src/domain/attachments.ts', 'src/domain/announcements.ts', 'src/domain/labFollowups.ts', 'src/domain/sessions.ts',
    'src/http/routes/progress.ts', 'src/http/routes/announcements.ts', 'src/http/routes/labFollowups.ts', 'src/http/routes/sessions.ts',
    'src/domain/progress.ts', 'src/domain/billing.ts', 'src/domain/help.ts', 'src/http/routes/billing.ts', 'src/http/routes/support.ts',
  ]) {
    const url = pathToFileURL(path.join(API_DIR, rel)).href;
    const r = spawnSync(process.execPath, ['--import', 'tsx', '-e', `const m = await import(${JSON.stringify(url)}); console.log('imported', Object.keys(m).length);`], { cwd: API_DIR, encoding: 'utf8', timeout: 60_000 });
    assert.equal(r.status, 0, `${rel}: ${r.stderr}`);
    assert.match(r.stdout, /imported \d+/, rel);
    assert.ok(!/before initialization/.test(r.stderr), r.stderr);
  }
  // the constants still come from api/domain/ai.ts for its importers
  assert.equal(aiDomain.MODULE_FLAG, 'ai');
  assert.deepEqual([...aiDomain.DRAFT_STATUSES], ['requested', 'ready', 'failed', 'accepted', 'discarded']);
  assert.equal(aiDomain.INSTRUCTIONS_MAX, 2000);
  assert.equal(aiDomain.FINAL_TEXT_MAX, 10000);
});
