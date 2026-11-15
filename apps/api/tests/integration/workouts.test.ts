/* M6 Workouts: the labelled sample library without media; a member sees and logs only their own sessions; a coach
   reaches only assigned clients, and the set logs, effort and notes only while the member shares health data
   (feedback needs the same consent); administrators manage the library with library.manage; publishing generates
   sessions once and a revision keeps what the member did (weeks keep their numbers; a draft's title waits for
   publishing); the week summary and adherence count sessions logged ahead of their date; the history follows the
   planned dates; the coach Today list says who does not share; the member's data export; validation; audit;
   adherence; reassignment; the flag. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId } from '../helpers.js';
import type { Ctx } from '../../src/context.js';
import { workouts } from '../../src/modules/workouts.js';
import { setUserPermission } from '../../src/auth/permissions.js';
import { findRestrictedFields, restrictedKeys } from '../../src/auth/fieldPolicy.js';
import { processPending } from '../../src/domain/events.js';
import { todayIst, weekSummary } from '../../src/domain/workouts.js';
import * as exerciseMedia from '../../src/domain/exerciseMedia.js';
import { buildArchive } from '../../src/domain/dataExport.js';

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); h.db.close(); });

const PRIYA = 'priya.nair@demo.bioptime.test';
const DEV = 'dev.kapoor@demo.bioptime.test';
const signedIn = async (email: string, password: string, mfa = false) => { const c = client(h.app); await c.login(email, password, password === DEMO_PASSWORDS.member ? 'member' : 'dashboard', mfa); return c; };
const member = (email: string) => signedIn(email, DEMO_PASSWORDS.member);
const coach = (email: string) => signedIn(email, DEMO_PASSWORDS.coach);
const admin = () => signedIn(DEMO.admin, DEMO_PASSWORDS.admin, true);
const owner = () => signedIn(DEMO.owner, DEMO_PASSWORDS.owner, true);
const as = (email: string): Ctx => { const u = h.db.get<{ id: string; role: 'member' | 'coach' | 'admin' | 'owner'; name: string }>('SELECT id, role, name FROM users WHERE email = ?', [email])!; return { ...h.ctx, actor: { id: u.id, role: u.role, email, name: u.name } }; };
const day = (offset: number) => new Date(Date.parse(`${todayIst(h.ctx)}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
// the member's seeded programme: the seed writes it before any test adds one
const programOf = (memberEmail: string) => h.db.get<{ id: string }>('SELECT id FROM workout_programs WHERE member_id = ? ORDER BY created_at, rowid LIMIT 1', [userId(h.ctx, memberEmail)])!.id;
/** Deepa's own note on her seeded session, which her coach never receives while she does not share health records. */
const DEEPA_NOTE = 'an easy walk today';
/** The owner removed every "demo" and "sample" label from the screens (24 October 2026). */
const LABEL_WORDS = /\bdemo\b|\bsample\b/i;
const sessionOf = (programId: string, week: number, d: number) => h.db.get<{ id: string }>('SELECT id FROM workout_sessions WHERE program_id = ? AND week = ? AND day = ?', [programId, week, d])?.id;
const auditRows = (action: string, targetId?: string) => h.db.all<{ actor_id: string | null; actor_role: string; reason: string | null; data: string; target_id: string }>(`SELECT actor_id, actor_role, reason, data, target_id FROM audit_events WHERE action = ? ${targetId ? 'AND target_id = ?' : ''} ORDER BY at`, targetId ? [action, targetId] : [action]);
const templateId = (title: string) => h.db.get<{ id: string }>('SELECT id FROM workout_templates WHERE title = ?', [title])!.id;

test('the demo seed ships the module’s few text-only exercises and the preview member’s library (a clip only where the review kept one), templates and programmes in plain words (no demo or sample label)', async () => {
  const a = await admin();
  const r = await a.get('/api/admin/exercises');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const items = r.json.items as Array<{ name: string; description?: string; sample: boolean; media: unknown; mediaRef: string | null; source: string; status: string; safetyNotes: string }>;
  // the module's own seed: a few exercises that say they carry no media
  const MODULE = ['Bodyweight Squat', 'Brisk Walk', 'Cat-Cow', 'Front Plank', 'Glute Bridge', 'Incline Push-Up', 'Step-Up'];
  const own = items.filter((e) => MODULE.includes(e.name));
  assert.deepEqual(own.map((e) => e.name).sort(), MODULE);
  for (const e of own) {
    assert.match(e.description ?? '', /^Described in text: no demonstration video for this exercise yet\./, 'each says it carries no media yet');
    assert.equal(e.media, null);
  }
  assert.ok(items.some((e) => e.source === 'coach' && e.status === 'draft'), 'a coach proposal waits for review');
  // the preview member's library (api/seed/showcase.ts, 30 October 2026): named for what each clip shows; a clip only
  // where the manifest lists one, and Kettlebell Swings text only
  const library = items.filter((e) => !MODULE.includes(e.name));
  assert.equal(library.length, 29);
  assert.ok(library.every((e) => e.status === 'published' && e.source === 'team' && e.safetyNotes.length > 0));
  assert.equal(library.find((e) => e.name === 'Kettlebell Swings')!.mediaRef, null, 'Kettlebell Swings has no clip of its own');
  for (const e of library) if (e.mediaRef) assert.ok(exerciseMedia.has(h.ctx, e.mediaRef), `${e.name}: a clip the manifest lists`);
  for (const e of items) {
    assert.doesNotMatch(`${e.name} ${e.description ?? ''} ${e.safetyNotes}`, LABEL_WORDS);
    assert.doesNotMatch(`${e.name} ${e.description ?? ''} ${e.safetyNotes}`, /fitterify|calorie|fat[- ]burn|hormon/i, 'no earlier-app name and no calorie, fat-burn or hormone claim');
    assert.equal(e.sample, false, 'not flagged sample, so no screen shows a Sample badge');
  }
  // the clips are served when the manifest is complete; otherwise every exercise is text only and the missing piece is named
  const media = r.json.media as { status: string; missing: string[]; note: string };
  if (media.status === 'available') assert.deepEqual(media.missing, []);
  else { assert.equal(media.status, 'pending_configuration'); assert.ok(media.missing.length > 0, 'the missing requirement is named'); assert.equal(media.note, 'Exercises are text only for now: no images or video.'); }
  assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM exercises WHERE media_asset_id IS NOT NULL')!.n, 0);
  for (const t of h.db.all<{ title: string; description: string; sample: number }>('SELECT title, description, sample FROM workout_templates')) { assert.doesNotMatch(`${t.title} ${t.description}`, LABEL_WORDS); assert.equal(t.sample, 0); }
  assert.deepEqual(h.db.all<{ title: string }>('SELECT title FROM workout_templates ORDER BY title').map((t) => t.title), ['Conditioning and core', 'Full body A', 'Full body B', 'Full body and core', 'Lower body', 'Lower body A', 'Mobility and recovery', 'Upper body A', 'Walk and mobility']);
  for (const p of h.db.all<{ title: string; summary: string; structure: string }>('SELECT p.title, v.summary, v.structure FROM workout_programs p JOIN workout_program_versions v ON v.program_id = p.id')) assert.doesNotMatch(`${p.title} ${p.summary} ${p.structure}`, LABEL_WORDS);
  for (const n of h.db.all<{ title: string; member_note: string | null; skip_reason: string | null }>('SELECT title, member_note, skip_reason FROM workout_sessions')) assert.doesNotMatch(`${n.title} ${n.member_note ?? ''} ${n.skip_reason ?? ''}`, LABEL_WORDS);

  const ananya = await member(DEMO.member);
  const week = await ananya.get(`/api/me/workouts?from=${day(-14)}&to=${day(14)}`);
  assert.equal(week.status, 200, JSON.stringify(week.json));
  const sessions = week.json.items as Array<{ status: string; feedbackCount: number; rpe?: number | null }>;
  assert.ok(sessions.length >= 4);
  assert.ok(sessions.some((s) => s.status === 'completed' && s.feedbackCount === 1 && s.rpe === 6));
  assert.ok(sessions.some((s) => s.status === 'partial'));
  assert.ok(sessions.some((s) => s.status === 'skipped'));
  const hist = await ananya.get('/api/me/workouts/history');
  assert.equal(hist.status, 200);
  assert.deepEqual(hist.json.totals, { completed: 1, partial: 1, skipped: 1 });
});

test('the history lists sessions by the date they were planned for, newest first, page by page', async () => {
  const ananya = await member(DEMO.member);
  const all = (await ananya.get('/api/me/workouts/history')).json.items as Array<{ id: string; scheduledDate: string; status: string }>;
  assert.equal(all.length, 3);
  const dates = all.map((s) => s.scheduledDate);
  assert.deepEqual(dates, [...dates].sort().reverse(), 'newest planned date first, although the skipped session was recorded last');
  assert.equal(all[1]!.status, 'skipped', 'the skipped session sits at its own date');
  const seen: string[] = [];
  let before: string | null = null;
  for (let pages = 0; pages < 5; pages++) {
    const page = await ananya.get(`/api/me/workouts/history?limit=1${before ? `&before=${encodeURIComponent(before)}` : ''}`);
    assert.equal(page.status, 200, JSON.stringify(page.json));
    seen.push(...(page.json.items as Array<{ id: string }>).map((s) => s.id));
    before = page.json.nextCursor as string | null;
    if (!before) break;
  }
  assert.deepEqual(seen, all.map((s) => s.id), 'the cursor walks the same order without gaps or repeats');
  assert.equal((await ananya.get('/api/me/workouts/history?before=2026-10-01T00:00:00.000Z')).json.error?.code, 'CURSOR_INVALID');
});

test('adherence counts the sessions due so far and the ones done (a partial session counts, a skipped one does not)', () => {
  const memberId = userId(h.ctx, DEMO.member);
  const out = workouts.adherence!.compute(h.ctx, memberId, { from: day(-14), to: day(14) });
  assert.equal(out.key, 'workouts');
  assert.equal(out.due, 3, 'three sessions were due before today');
  assert.equal(out.done, 2);
  assert.equal(out.pct, 67);
  assert.equal(workouts.adherence!.compute(h.ctx, memberId, { from: day(30), to: day(40) }).pct, null, 'nothing due: no percentage');
});

test('a member sees and logs only their own sessions', async () => {
  const ananya = await member(DEMO.member);
  const deepaSession = sessionOf(programOf(DEMO.memberNoShare), 1, 4)!;
  assert.equal((await ananya.get(`/api/me/workouts/${deepaSession}`)).status, 404);
  assert.equal((await ananya.post(`/api/me/workouts/${deepaSession}/complete`, { sets: [] })).status, 404);
  assert.equal((await ananya.post(`/api/me/workouts/${deepaSession}/skip`, {})).status, 404);
  assert.equal(h.db.get<{ status: string }>('SELECT status FROM workout_sessions WHERE id = ?', [deepaSession])!.status, 'scheduled', 'nothing changed');
  const asha = await coach(DEMO.coach);
  const own = sessionOf(programOf(DEMO.member), 3, 2)!;
  assert.equal((await asha.post(`/api/me/workouts/${own}/complete`, { sets: [] })).status, 403, 'a coach cannot log a member’s session');
  assert.equal((await client(h.app).get('/api/me/workouts')).status, 401);
  const detail = await ananya.get(`/api/me/workouts/${sessionOf(programOf(DEMO.member), 1, 2)}`);
  assert.equal(detail.status, 200);
  const items = detail.json.items as Array<{ logs: unknown[]; exerciseName: string }>;
  assert.ok(items.length && items.every((i) => Array.isArray(i.logs) && i.logs.length > 0), 'my own logs come back');
  assert.equal((detail.json.feedback as unknown[]).length, 1, 'my coach’s feedback');
  assert.ok(items.every((i) => !LABEL_WORDS.test(i.exerciseName)));
});

test('a coach reaches only assigned clients, their own drafts and published library entries', async () => {
  const asha = await coach(DEMO.coach);
  const rahul = await coach(DEMO.coach2);
  const vikramId = userId(h.ctx, DEMO.member2);
  const vikramProgram = h.db.get<{ id: string }>('SELECT id FROM workout_programs WHERE member_id = ?', [vikramId])!.id;
  assert.equal((await asha.get(`/api/coach/clients/${vikramId}/workouts`)).json.error?.code, 'NO_ACCESS');
  assert.equal((await asha.get(`/api/coach/workout-programs/${vikramProgram}`)).status, 404);
  assert.equal((await asha.patch(`/api/coach/workout-programs/${vikramProgram}`, { title: 'Taken over' })).status, 404);
  assert.equal((await asha.post(`/api/coach/workout-programs/${vikramProgram}/publish`, {})).status, 404);
  assert.equal((await asha.post('/api/coach/workout-programs', { memberId: vikramId, title: 'Not mine', structure: { weeks: [] } })).json.error?.code, 'NO_ACCESS');
  assert.equal((await asha.get(`/api/coach/workouts/${sessionOf(programOf(DEMO.memberNoShare), 1, 1)}`)).status, 404, 'another coach’s client’s session');
  const mine = (await asha.get('/api/coach/workout-programs')).json.items as Array<{ memberId: string }>;
  const assigned = new Set(h.db.all<{ member_id: string }>("SELECT member_id FROM coach_assignments WHERE coach_id = ? AND status IN ('active','paused')", [userId(h.ctx, DEMO.coach)]).map((r) => r.member_id));
  assert.ok(mine.length >= 1 && mine.every((p) => assigned.has(p.memberId)));

  const draftName = 'Step-Up';
  assert.ok(((await asha.get('/api/coach/exercise-library')).json.items as Array<{ name: string }>).some((e) => e.name === draftName), 'the author sees their draft');
  assert.ok(!((await rahul.get('/api/coach/exercise-library')).json.items as Array<{ name: string }>).some((e) => e.name === draftName), 'another coach does not');
  assert.equal((await rahul.get(`/api/coach/workout-templates/${templateId('Lower body')}`)).status, 404, 'a coach’s own template is theirs');
  assert.ok(!((await rahul.get('/api/coach/workout-templates')).json.items as Array<{ title: string }>).some((t) => t.title === 'Full body B'), 'team drafts stay with the team');

  const ananya = await member(DEMO.member);
  assert.equal((await ananya.get('/api/coach/exercise-library')).status, 403);
  assert.equal((await asha.get('/api/admin/exercises')).status, 403);
  assert.equal((await asha.post('/api/admin/exercises', { name: 'Coach via admin', category: 'strength' })).status, 403);
});

test('the coach Today list marks clients who do not share health data and carries no health detail', async () => {
  const meera = await coach(DEMO.coach3);
  const deepaId = userId(h.ctx, DEMO.memberNoShare);
  const logged = sessionOf(programOf(DEMO.memberNoShare), 1, 1)!;
  const r = await meera.get('/api/coach/workouts/recent');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const row = (r.json.items as Array<Record<string, unknown>>).find((x) => x.id === logged);
  assert.ok(row, 'the logged session is listed by its status');
  assert.equal(row.memberId, deepaId);
  assert.equal(row.healthShared, false, 'marked not shared, so the portal offers Open instead of Review');
  for (const k of ['rpe', 'durationMinutes', 'memberNote', 'setsDone', 'skipReason', 'logs']) assert.ok(!(k in row), `${k} is withheld`);
  assert.ok(!JSON.stringify(r.json).includes(DEEPA_NOTE), 'the member’s note never leaves the server');
  const mine = (await (await coach(DEMO.coach)).get('/api/coach/workouts/recent')).json.items as Array<{ memberId: string; healthShared: boolean }>;
  assert.ok(mine.some((x) => x.memberId === userId(h.ctx, DEMO.member) && x.healthShared === true), 'a client who shares is marked shared');
  assert.ok(mine.every((x) => x.memberId !== deepaId), 'only the coach’s own clients');
  assert.equal(auditRows('health.viewed', deepaId).length, 0, 'the list reads no health detail');
});

test('set logs, effort and notes reach a coach only while the member shares health data; feedback needs the consent', async () => {
  const meera = await coach(DEMO.coach3);
  const deepaId = userId(h.ctx, DEMO.memberNoShare);
  const logged = sessionOf(programOf(DEMO.memberNoShare), 1, 1)!;
  const view = await meera.get(`/api/coach/clients/${deepaId}/workouts`);
  assert.equal(view.status, 200, JSON.stringify(view.json));
  assert.equal(view.json.healthShared, false);
  const s = (view.json.sessions as Array<Record<string, unknown>>).find((x) => x.id === logged)!;
  assert.equal(s.status, 'completed', 'the coach sees the schedule and the status');
  for (const k of ['rpe', 'durationMinutes', 'memberNote', 'setsDone', 'skipReason']) assert.ok(!(k in s), `${k} is withheld`);
  const detail = await meera.get(`/api/coach/workouts/${logged}`);
  assert.equal(detail.status, 200);
  assert.ok(!('rpe' in detail.json) && (detail.json.items as Array<Record<string, unknown>>).every((i) => !('logs' in i)), 'no set logs without the consent');
  assert.ok(!JSON.stringify(view.json).includes(DEEPA_NOTE), 'the member’s note never leaves the server');
  const refused = await meera.post(`/api/coach/workouts/${logged}/feedback`, { body: 'Well done.' });
  assert.equal(refused.json.error?.code, 'NOT_SHARED');
  assert.equal(auditRows('health.viewed', deepaId).length, 0);

  const deepa = await member(DEMO.memberNoShare);
  assert.equal((await deepa.post('/api/me/consents', { kind: 'coach_sharing', version: '2026-10-17', granted: true })).status, 200);
  const shared = await meera.get(`/api/coach/clients/${deepaId}/workouts`);
  assert.equal(shared.json.healthShared, true);
  assert.equal((shared.json.sessions as Array<Record<string, unknown>>).find((x) => x.id === logged)!.rpe, 4);
  assert.ok(((await meera.get(`/api/coach/workouts/${logged}`)).json.items as Array<{ logs?: unknown[] }>).every((i) => (i.logs ?? []).length > 0));
  const fb = await meera.post(`/api/coach/workouts/${logged}/feedback`, { body: 'Test feedback: good pace.' });
  assert.equal(fb.status, 201, JSON.stringify(fb.json));
  assert.ok(auditRows('health.viewed', deepaId).length >= 1, 'reading the logs is audited');
  assert.ok(h.db.get("SELECT 1 FROM notifications WHERE user_id = ? AND category = 'workout' AND title = 'Feedback on your workout'", [deepaId]));
  assert.equal(h.db.get<{ kind: string; visibility: string; ref_type: string }>("SELECT kind, visibility, ref_type FROM coach_notes WHERE ref_id = ?", [logged])!.ref_type, 'workout_session');
  // the coach payload carries no contact or identity field
  const email = DEMO.memberNoShare;
  assert.deepEqual(findRestrictedFields(shared.json, restrictedKeys()), []);
  assert.ok(!JSON.stringify(shared.json).includes(email) && !JSON.stringify(shared.json).includes('+9197'));

  assert.equal((await deepa.post('/api/me/consents', { kind: 'coach_sharing', version: '2026-10-17', granted: false })).status, 200);
  const withdrawn = await meera.get(`/api/coach/clients/${deepaId}/workouts`);
  assert.equal(withdrawn.json.healthShared, false);
  assert.ok(!('rpe' in (withdrawn.json.sessions as Array<Record<string, unknown>>).find((x) => x.id === logged)!));
});

test('publishing generates the sessions once; a revision keeps what the member did and regenerates the rest', async () => {
  const asha = await coach(DEMO.coach);
  const priya = await member(PRIYA);
  const priyaId = userId(h.ctx, PRIYA);
  const fullBody = templateId('Full body A'), walk = templateId('Walk and mobility');
  const created = await asha.post('/api/coach/workout-programs', { memberId: priyaId, title: 'Test programme', summary: 'Test', structure: { weeks: [{ week: 1, days: [{ day: 1, templateId: fullBody }, { day: 4, templateId: walk }] }, { week: 2, days: [{ day: 1, templateId: fullBody }, { day: 4, templateId: walk }] }] } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const pid = created.json.id as string;
  assert.equal(created.json.status, 'draft');
  const count = () => h.db.get<{ n: number }>('SELECT COUNT(*) n FROM workout_sessions WHERE program_id = ?', [pid])!.n;
  assert.equal(count(), 0, 'a draft gives the member nothing');

  const pub = await asha.post(`/api/coach/workout-programs/${pid}/publish`, { startDate: day(0) });
  assert.equal(pub.status, 200, JSON.stringify(pub.json));
  assert.equal(count(), 4);
  assert.equal((await asha.post(`/api/coach/workout-programs/${pid}/publish`, {})).json.error?.code, 'INVALID_STATE', 'nothing to publish twice');
  assert.equal(count(), 4, 'publishing again generates nothing');
  assert.ok(h.db.get("SELECT 1 FROM notifications WHERE user_id = ? AND category = 'workout' AND title = 'Your workout programme is ready'", [priyaId]));
  assert.equal(sessionOf(pid, 1, 4) && h.db.get<{ d: string }>('SELECT scheduled_date d FROM workout_sessions WHERE id = ?', [sessionOf(pid, 1, 4)!])!.d, day(3), 'dated from the start date');

  const s11 = sessionOf(pid, 1, 1)!, s14 = sessionOf(pid, 1, 4)!;
  const items = ((await priya.get(`/api/me/workouts/${s11}`)).json.items as Array<{ id: string; sets: number }>);
  const sets = items.flatMap((i) => Array.from({ length: i.sets }, (_, k) => ({ itemId: i.id, setNumber: k + 1, repsDone: 8 })));
  const done = await priya.post(`/api/me/workouts/${s11}/complete`, { sets, rpe: 7, durationMinutes: 40, note: 'Test log' });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(done.json.status, 'completed');
  const firstItem = ((await priya.get(`/api/me/workouts/${s14}`)).json.items as Array<{ id: string }>)[0]!;
  const part = await priya.post(`/api/me/workouts/${s14}/complete`, { sets: [{ itemId: firstItem.id, setNumber: 1, durationSeconds: 600 }] });
  assert.equal(part.json.status, 'partial', 'some prescribed sets: partial');
  // day 4 is three days ahead: logged early, it counts as due so far and done instead of dropping out of the week
  const early = (await priya.get(`/api/me/workouts?from=${day(0)}&to=${day(6)}`)).json as { summary: Record<string, number>; items: Array<{ programId: string; scheduledDate: string; status: string }>; today: string };
  // Priya's seeded programme (the preview showcase) has sessions in these days too: this programme's two count alike
  const mine = early.items.filter((s) => s.programId === pid);
  assert.equal(mine.length, 2);
  assert.deepEqual(weekSummary(mine, early.today), { due: 2, done: 2, skipped: 0, upcoming: 0 });
  assert.deepEqual(early.summary, weekSummary(early.items, early.today), 'the week summary counts every programme the same way');
  const adh = workouts.adherence!.compute(h.ctx, priyaId, { from: day(0), to: day(6) });
  assert.deepEqual([adh.due, adh.done], [early.summary.due, early.summary.done], 'adherence counts it the same way');
  assert.equal(part.json.today, todayIst(h.ctx), 'a session carries today’s date, so a past one still scheduled reads Not logged');
  const logsBefore = h.db.get<{ n: number }>('SELECT COUNT(*) n FROM workout_set_logs WHERE session_id = ?', [s11])!.n;
  const oldScheduled = sessionOf(pid, 2, 1)!;

  // a revision keeps every day the member logged where it is, with the template it came from. Through the API (as any
  // caller), another template on a logged day, a logged day dropped or moved, and weeks renumbered around the logged
  // week are all refused, and nothing is saved
  const week2 = { week: 2, days: [{ day: 1, templateId: fullBody }, { day: 4, templateId: walk }] };
  const refuse = async (weeks: unknown[], code: string, what: string) => {
    const r = await asha.patch(`/api/coach/workout-programs/${pid}`, { structure: { weeks } });
    assert.equal(r.status, 400, `${what}: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.error?.code, code, what);
    return r.json.error?.message as string;
  };
  const otherTemplate = await refuse([{ week: 1, days: [{ day: 1, templateId: walk }, { day: 4, templateId: walk }] }, week2], 'DAY_HAS_LOGS', 'another template on the completed day');
  assert.match(otherTemplate, /^Week 1, day 1 \(Full body A\) was already logged or skipped by your client/, 'the message names the day and what was logged there');
  await refuse([{ week: 1, days: [{ day: 1, templateId: fullBody }] }, week2], 'DAY_HAS_LOGS', 'the partly done day dropped');
  await refuse([{ week: 1, days: [{ day: 2, templateId: fullBody }, { day: 4, templateId: walk }] }, week2], 'DAY_HAS_LOGS', 'the completed day moved to another day');
  await refuse([{ week: 1, days: [{ day: 3, templateId: walk }] }, { week: 2, days: [{ day: 1, templateId: fullBody }, { day: 4, templateId: walk }] }, { week: 3, days: week2.days }], 'DAY_HAS_LOGS', 'a new week 1 in front, the logged week renumbered to 2');
  await refuse([{ week: 2, days: [{ day: 1, templateId: fullBody }, { day: 4, templateId: walk }] }, { week: 3, days: week2.days }], 'WEEK_HAS_LOGS', 'every week renumbered one up');
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM workout_program_versions WHERE program_id = ? AND status = 'draft'", [pid])!.n, 0, 'nothing was saved');

  // the revision adds a day to week 1 and a third week; the days the member logged stay as they were
  const rev = await asha.patch(`/api/coach/workout-programs/${pid}`, { summary: 'Revised', structure: { weeks: [{ week: 1, days: [{ day: 1, templateId: fullBody }, { day: 3, templateId: fullBody }, { day: 4, templateId: walk }] }, week2, { week: 3, days: [{ day: 1, templateId: walk }] }] } });
  assert.equal(rev.status, 200, JSON.stringify(rev.json));
  assert.equal((rev.json.draft as { version: number }).version, 2);
  assert.equal(count(), 4, 'the published version stays live until the draft is published');
  const pub2 = await asha.post(`/api/coach/workout-programs/${pid}/publish`, {});
  assert.equal(pub2.status, 200, JSON.stringify(pub2.json));
  assert.equal(pub2.json.currentVersion, 2);
  assert.equal(sessionOf(pid, 1, 1), s11, 'the completed session is kept');
  assert.equal(h.db.get<{ t: string }>('SELECT template_id t FROM workout_sessions WHERE id = ?', [s11])!.t, fullBody, 'as it was done');
  assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM workout_set_logs WHERE session_id = ?', [s11])!.n, logsBefore, 'with its set logs');
  assert.equal(sessionOf(pid, 1, 4), s14, 'the partial session is kept');
  assert.notEqual(sessionOf(pid, 2, 1), oldScheduled, 'a session still scheduled is regenerated from the revision');
  assert.ok(sessionOf(pid, 1, 3) && sessionOf(pid, 3, 1));
  assert.equal(count(), 6, '2 kept + 4 generated');
  assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM (SELECT week, day FROM workout_sessions WHERE program_id = ? GROUP BY week, day HAVING COUNT(*) > 1)', [pid])!.n, 0, 'one session per week and day');
  const pubAudit = auditRows('workout_program.publish', pid);
  assert.equal(pubAudit.length, 2);
  assert.deepEqual({ ...JSON.parse(pubAudit[1]!.data), startDate: undefined }, { version: 2, sessionsCreated: 4, sessionsKept: 2, scheduledReplaced: 2, startDate: undefined });
  assert.ok(h.db.get("SELECT 1 FROM notifications WHERE user_id = ? AND category = 'workout' AND title = 'Your workout programme was updated'", [priyaId]));

  // weeks keep their numbers: a week the member logged in cannot be removed (renumbering the weeks after it would move
  // their content under sessions already done); a week without logs can, and the others keep their number and date
  const live = (await asha.get(`/api/coach/workout-programs/${pid}`)).json as { loggedWeeks: number[]; loggedDays: Array<{ week: number; day: number; templateId: string }>; published: { structure: { weeks: Array<{ week: number; days: Array<{ day: number; templateId: string }> }> } } };
  assert.deepEqual(live.loggedWeeks, [1]);
  assert.deepEqual(live.loggedDays, [{ week: 1, day: 1, templateId: fullBody }, { week: 1, day: 4, templateId: walk }], 'the days a revision keeps as they are');
  const weeksNow = live.published.structure.weeks;
  const refused = await asha.patch(`/api/coach/workout-programs/${pid}`, { structure: { weeks: weeksNow.filter((w) => w.week !== 1) } });
  assert.equal(refused.status, 400);
  assert.equal(refused.json.error?.code, 'WEEK_HAS_LOGS');
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM workout_program_versions WHERE program_id = ? AND status = 'draft'", [pid])!.n, 0, 'nothing was saved');
  // a draft revision's title and start date wait for publishing: the member keeps seeing the published ones
  const revised = await asha.patch(`/api/coach/workout-programs/${pid}`, { title: 'Test programme, revised', startDate: day(1), structure: { weeks: weeksNow.filter((w) => w.week !== 2) } });
  assert.equal(revised.status, 200, JSON.stringify(revised.json));
  assert.equal(revised.json.title, 'Test programme');
  assert.deepEqual([(revised.json.draft as { title: string }).title, (revised.json.draft as { startDate: string }).startDate], ['Test programme, revised', day(1)]);
  const memberSees = async () => ((await priya.get('/api/me/workouts')).json.programs as Array<{ id: string; title: string; startDate: string }>).find((x) => x.id === pid)!;
  assert.deepEqual([(await memberSees()).title, (await memberSees()).startDate], ['Test programme', day(0)], 'not the draft’s title or start date');
  const pub3 = await asha.post(`/api/coach/workout-programs/${pid}/publish`, {});
  assert.equal(pub3.status, 200, JSON.stringify(pub3.json));
  assert.deepEqual([(await memberSees()).title, (await memberSees()).startDate], ['Test programme, revised', day(1)], 'published with the revision');
  assert.equal(sessionOf(pid, 1, 1), s11, 'week 1 keeps its logged sessions');
  assert.equal(sessionOf(pid, 1, 4), s14);
  assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM workout_sessions WHERE program_id = ? AND week = 2', [pid])!.n, 0, 'the removed week is gone');
  assert.equal(h.db.get<{ d: string }>('SELECT scheduled_date d FROM workout_sessions WHERE id = ?', [sessionOf(pid, 3, 1)!])!.d, day(15), 'week 3 is still week 3, dated from the new start');
  assert.equal(h.db.get<{ d: string }>('SELECT scheduled_date d FROM workout_sessions WHERE id = ?', [s11])!.d, day(0), 'a logged session keeps its date');

  // logging again replaces the earlier log
  const again = await priya.post(`/api/me/workouts/${s14}/complete`, { sets: [], rpe: 5 });
  assert.equal(again.json.status, 'completed');
  assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM workout_set_logs WHERE session_id = ?', [s14])!.n, 0);

  // archiving needs a reason; what was done stays in the history, what was still to come goes
  assert.equal((await asha.post(`/api/coach/workout-programs/${pid}/archive`, {})).status, 400);
  const arch = await asha.post(`/api/coach/workout-programs/${pid}/archive`, { reason: 'Test: programme finished' });
  assert.equal(arch.status, 200, JSON.stringify(arch.json));
  assert.equal(arch.json.status, 'archived');
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM workout_sessions WHERE program_id = ? AND status = 'scheduled'", [pid])!.n, 0);
  assert.equal(count(), 2);
  const closed = await priya.post(`/api/me/workouts/${s11}/complete`, { sets: [] });
  assert.equal(closed.status, 409);
  assert.deepEqual(closed.json.error?.details, { code: 'PROGRAM_CLOSED' });
  const hist = (await priya.get('/api/me/workouts/history')).json.items as Array<{ id: string }>;
  assert.ok(hist.some((x) => x.id === s11) && hist.some((x) => x.id === s14));
  assert.equal(auditRows('workout_program.archive', pid)[0]!.reason, 'Test: programme finished');
});

test('publishing checks the draft again: a day the member logged after the draft was saved keeps its place', async () => {
  const asha = await coach(DEMO.coach);
  const priya = await member(PRIYA);
  const priyaId = userId(h.ctx, PRIYA);
  const fullBody = templateId('Full body A'), walk = templateId('Walk and mobility');
  const created = await asha.post('/api/coach/workout-programs', { memberId: priyaId, title: 'Draft check programme', startDate: day(0), structure: { weeks: [{ week: 1, days: [{ day: 1, templateId: fullBody }] }, { week: 2, days: [{ day: 1, templateId: fullBody }] }] } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const pid = created.json.id as string;
  assert.equal((await asha.post(`/api/coach/workout-programs/${pid}/publish`, {})).status, 200);
  // the coach saves a draft that gives week 2's day another template, while nothing in week 2 is logged yet
  const draft = await asha.patch(`/api/coach/workout-programs/${pid}`, { structure: { weeks: [{ week: 1, days: [{ day: 1, templateId: fullBody }] }, { week: 2, days: [{ day: 1, templateId: walk }] }] } });
  assert.equal(draft.status, 200, JSON.stringify(draft.json));
  // then the member logs week 2's session ahead of its date
  assert.equal((await priya.post(`/api/me/workouts/${sessionOf(pid, 2, 1)}/complete`, { sets: [] })).status, 200);
  const pub = await asha.post(`/api/coach/workout-programs/${pid}/publish`, {});
  assert.equal(pub.status, 400, JSON.stringify(pub.json));
  assert.equal(pub.json.error?.code, 'DAY_HAS_LOGS');
  assert.equal(h.db.get<{ v: number }>('SELECT current_version v FROM workout_programs WHERE id = ?', [pid])!.v, 1, 'the published version stays live');
  assert.equal(h.db.get<{ t: string }>('SELECT template_id t FROM workout_sessions WHERE id = ?', [sessionOf(pid, 2, 1)!])!.t, fullBody);
  // putting the logged day back as it was lets the revision through
  assert.equal((await asha.patch(`/api/coach/workout-programs/${pid}`, { structure: { weeks: [{ week: 1, days: [{ day: 1, templateId: walk }] }, { week: 2, days: [{ day: 1, templateId: fullBody }] }] } })).status, 200);
  const ok = await asha.post(`/api/coach/workout-programs/${pid}/publish`, {});
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(h.db.get<{ t: string }>('SELECT template_id t FROM workout_sessions WHERE id = ?', [sessionOf(pid, 1, 1)!])!.t, walk, 'a day still to come takes the new template');
  assert.equal((await asha.post(`/api/coach/workout-programs/${pid}/archive`, { reason: 'Test: draft check done' })).status, 200);
});

test('a closed programme counts only its logged or skipped sessions, on the member’s week and in adherence alike', async () => {
  const asha = await coach(DEMO.coach);
  const priya = await member(PRIYA);
  const priyaId = userId(h.ctx, PRIYA);
  const fullBody = templateId('Full body A'), walk = templateId('Walk and mobility');
  // started three days ago: sessions three, two and one day ago, and one the day after tomorrow
  const created = await asha.post('/api/coach/workout-programs', { memberId: priyaId, title: 'Closing test programme', structure: { weeks: [{ week: 1, days: [{ day: 1, templateId: fullBody }, { day: 2, templateId: walk }, { day: 3, templateId: fullBody }, { day: 6, templateId: walk }] }] } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const pid = created.json.id as string;
  assert.equal((await asha.post(`/api/coach/workout-programs/${pid}/publish`, { startDate: day(-3) })).status, 200);
  const [d1, d2, d3, d6] = [1, 2, 3, 6].map((d) => sessionOf(pid, 1, d)!);
  assert.equal((await priya.post(`/api/me/workouts/${d1}/complete`, { sets: [] })).status, 200);
  assert.equal((await priya.post(`/api/me/workouts/${d2}/skip`, {})).status, 200);
  // d3 (yesterday) is never logged
  const range = { from: day(-3), to: day(3) };
  const counts = async () => {
    const wk = (await priya.get(`/api/me/workouts?from=${range.from}&to=${range.to}`)).json as { summary: { due: number; done: number }; items: Array<{ id: string }> };
    const adh = workouts.adherence!.compute(h.ctx, priyaId, range);
    return { week: [wk.summary.due, wk.summary.done], adherence: [adh.due, adh.done], shown: wk.items.map((s) => s.id) };
  };
  const live = await counts();
  assert.deepEqual(live.adherence, live.week, 'while live, the member’s week and adherence agree');
  assert.ok([d1, d2, d3, d6].every((id) => live.shown.includes(id)));

  // the coach closes it: the session still to come goes, the one she never logged no longer shows on her screens, and
  // adherence stops counting it as due, as her week does
  assert.equal((await asha.post(`/api/coach/workout-programs/${pid}/archive`, { reason: 'Test: close early' })).status, 200);
  const closed = await counts();
  assert.ok(!closed.shown.includes(d3) && !closed.shown.includes(d6), 'her week no longer shows the unlogged sessions');
  assert.ok(closed.shown.includes(d1) && closed.shown.includes(d2), 'what she logged or skipped stays');
  assert.deepEqual(closed.adherence, closed.week, 'once closed, the member’s week and adherence still agree');
  assert.deepEqual(closed.adherence, [live.adherence[0]! - 1, live.adherence[1]], 'the past session she never logged no longer counts as due; what she did still counts');
  const exported = (buildArchive(h.ctx, priyaId, 'drq_test_workouts_closing').moduleSections?.workouts as { sessions: { records: Array<{ programme: string; plannedFor: string }> } } | undefined)?.sessions.records.filter((s) => s.programme === 'Closing test programme') ?? [];
  assert.deepEqual(exported.map((s) => s.plannedFor).sort(), [day(-3), day(-2)], 'the export carries the same two sessions');
});

test('data export: the member’s own programmes and sessions as their Workouts pages show them; no drafts, private notes, ids or other people', async () => {
  const ananyaId = userId(h.ctx, DEMO.member);
  const pid = programOf(DEMO.member);
  // a draft revision and a coach's private note on one of her sessions: neither belongs in her export
  const draft = await (await coach(DEMO.coach)).patch(`/api/coach/workout-programs/${pid}`, { title: 'Draft-only revision title', summary: 'Draft-only revision summary' });
  assert.equal(draft.status, 200, JSON.stringify(draft.json));
  const reviewed = sessionOf(pid, 1, 2)!;
  h.db.insert('coach_notes', { id: 'cnt_workouts_export_probe', coach_id: userId(h.ctx, DEMO.coach), member_id: ananyaId, kind: 'note', visibility: 'private', author_role: 'coach', body: 'Private coach note probe', ref_type: 'workout_session', ref_id: reviewed, created_at: new Date().toISOString() });

  type Archive = { moduleSections?: Record<string, Record<string, { label: string; records: unknown }>>; notIncluded: Array<{ what: string }> };
  const archive = buildArchive(h.ctx, ananyaId, 'drq_test_workouts_export') as Archive;
  const sections = archive.moduleSections?.workouts;
  assert.ok(sections?.programmes && sections.sessions, 'moduleSections.workouts.programmes and .sessions are present');
  assert.ok(!archive.notIncluded.some((x) => /^Workout programmes/.test(x.what)), 'workouts leave the notIncluded list');
  const programmes = sections.programmes.records as Array<Record<string, unknown>>;
  assert.equal(programmes.length, 1);
  assert.deepEqual([programmes[0]!.title, programmes[0]!.summary, programmes[0]!.state], ['Three-week full body', 'Two sessions a week for three weeks: a strength session and a walk with mobility.', 'live'], 'the published version, not the draft');
  const sessions = sections.sessions.records as Array<{ week: number; day: number; status: string; effort: number | null; yourNote: string | null; skipReason: string | null; exercises: Array<{ yourSets: unknown[] }>; feedbackFromYourCoach: Array<{ body: string }> }>;
  const page = (await (await member(DEMO.member)).get(`/api/me/workouts?from=${day(-30)}&to=${day(30)}`)).json.items as unknown[];
  assert.equal(sessions.length, page.length, 'the sessions her Workouts page shows');
  const done = sessions.find((s) => s.week === 1 && s.day === 2)!;
  assert.deepEqual([done.status, done.effort, done.yourNote], ['completed', 6, 'All sets done; the push-ups felt easier by the last set.'], 'her own log, effort and note');
  assert.ok(done.exercises.length && done.exercises.every((e) => e.yourSets.length > 0), 'her own set logs');
  assert.deepEqual(done.feedbackFromYourCoach.map((f) => f.body), ['A steady first session. Keep the same reps next week.'], 'the feedback sent to her, not the private note');
  assert.equal(sessions.find((s) => s.status === 'skipped')!.skipReason, 'Travelling that day.');
  const text = JSON.stringify(sections);
  for (const s of ['Draft-only revision', 'Private coach note probe', 'Walk and mobility, two days a week', 'Upper and lower', 'wks_', 'wpg_', 'wpv_', 'wsi_', 'wsl_', 'wkt_', 'exr_', 'cnt_']) assert.ok(!text.includes(s), `no ${s}`);
  for (const k of ['id', 'memberId', 'member_id', 'coachId', 'coach_id', 'programId', 'templateId', 'exerciseId', 'structure', 'created_by']) assert.ok(!text.includes(`"${k}"`), `no ${k}`);
  assert.deepEqual(findRestrictedFields(sections, restrictedKeys()), [], 'no contact or account fields');

  // a closed programme keeps what she logged; a programme never published gives nothing
  const priya = buildArchive(h.ctx, userId(h.ctx, PRIYA), 'drq_test_workouts_export_closed') as Archive;
  const closed = (priya.moduleSections!.workouts!.programmes!.records as Array<Record<string, unknown>>).filter((p) => p.title === 'Test programme, revised');
  assert.deepEqual([closed.length, closed[0]!.title, closed[0]!.state, !!closed[0]!.closedAt], [1, 'Test programme, revised', 'closed by your coach', true]);
  assert.ok((priya.moduleSections!.workouts!.sessions!.records as Array<{ status: string; programme: string }>).filter((s) => s.programme === 'Test programme, revised').every((s) => s.status !== 'scheduled'), 'only what she logged of a closed programme');
  const vikram = buildArchive(h.ctx, userId(h.ctx, DEMO.member2), 'drq_test_workouts_export_draft') as Archive;
  assert.deepEqual(vikram.moduleSections?.workouts?.programmes?.records, [], 'a draft programme is not hers yet');
  assert.deepEqual(vikram.moduleSections?.workouts?.sessions?.records, []);

  h.db.run('DELETE FROM coach_notes WHERE id = ?', ['cnt_workouts_export_probe']);
  h.db.run("DELETE FROM workout_program_versions WHERE program_id = ? AND status = 'draft'", [pid]);
});

test('validation: logs, structures, templates, library statuses and ranges', async () => {
  const ananya = await member(DEMO.member);
  const asha = await coach(DEMO.coach);
  const rahul = await coach(DEMO.coach2);
  const a = await admin();
  const pid = programOf(DEMO.member);
  const future = sessionOf(pid, 3, 2)!;
  const item = ((await ananya.get(`/api/me/workouts/${future}`)).json.items as Array<{ id: string }>)[0]!;
  assert.equal((await ananya.post(`/api/me/workouts/${future}/complete`, { sets: [{ itemId: 'wsi_unknown', setNumber: 1 }] })).json.error?.code, 'VALIDATION_FAILED');
  assert.equal((await ananya.post(`/api/me/workouts/${future}/complete`, { sets: [], rpe: 11 })).json.error?.code, 'VALIDATION_FAILED');
  assert.equal((await ananya.post(`/api/me/workouts/${future}/complete`, { sets: [], durationMinutes: 0 })).json.error?.code, 'VALIDATION_FAILED');
  assert.equal((await ananya.post(`/api/me/workouts/${future}/complete`, { sets: [{ itemId: item.id, setNumber: 1 }, { itemId: item.id, setNumber: 1 }] })).json.error?.code, 'VALIDATION_FAILED', 'a set twice');
  assert.equal((await ananya.post(`/api/me/workouts/${future}/complete`, { sets: [{ itemId: item.id, setNumber: 1, completed: false }] })).json.error?.code, 'NOTHING_DONE');
  assert.equal((await ananya.post(`/api/me/workouts/${future}/complete`, { sets: [{ itemId: item.id, setNumber: 1, loadKg: -5 }] })).status, 400);
  assert.equal(h.db.get<{ status: string }>('SELECT status FROM workout_sessions WHERE id = ?', [future])!.status, 'scheduled', 'nothing was saved');
  assert.deepEqual((await ananya.post(`/api/me/workouts/${sessionOf(pid, 1, 2)}/skip`, {})).json.error?.details, { code: 'SESSION_NOT_SCHEDULED' }, 'a logged session cannot be skipped');
  assert.equal((await ananya.get(`/api/me/workouts?from=${day(5)}&to=${day(1)}`)).json.error?.code, 'RANGE_INVALID');
  assert.equal((await ananya.get(`/api/me/workouts?from=${day(0)}&to=${day(120)}`)).json.error?.code, 'RANGE_TOO_LONG');
  assert.equal((await ananya.get('/api/me/workouts?from=yesterday')).status, 400);

  const ananyaId = userId(h.ctx, DEMO.member);
  const fullBody = templateId('Full body A');
  assert.equal((await asha.post('/api/coach/workout-programs', { memberId: ananyaId, title: 'Twice', structure: { weeks: [{ week: 1, days: [{ day: 1, templateId: fullBody }, { day: 1, templateId: fullBody }] }] } })).status, 400, 'a day twice');
  assert.equal((await asha.post('/api/coach/workout-programs', { memberId: ananyaId, title: 'Draft template', structure: { weeks: [{ week: 1, days: [{ day: 1, templateId: templateId('Full body B') }] }] } })).json.error?.code, 'TEMPLATE_UNAVAILABLE', 'team drafts cannot be used');
  const vikramId = userId(h.ctx, DEMO.member2);
  assert.equal((await rahul.post('/api/coach/workout-programs', { memberId: vikramId, title: 'Another coach’s template', structure: { weeks: [{ week: 1, days: [{ day: 1, templateId: templateId('Lower body') }] }] } })).json.error?.code, 'TEMPLATE_UNAVAILABLE');
  const stepUp = h.db.get<{ id: string }>("SELECT id FROM exercises WHERE name = 'Step-Up'")!.id;
  assert.equal((await rahul.post('/api/coach/workout-templates', { title: 'Uses a draft', items: [{ exerciseId: stepUp, sets: 3, reps: '8' }] })).json.error?.code, 'EXERCISE_UNAVAILABLE');
  assert.equal((await a.post('/api/admin/workout-templates', { title: 'Team uses a coach draft', items: [{ exerciseId: stepUp, sets: 3, reps: '8' }] })).json.error?.code, 'EXERCISE_UNAVAILABLE');
  const squat = h.db.get<{ id: string }>("SELECT id FROM exercises WHERE name = 'Bodyweight Squat'")!.id;
  assert.equal((await asha.post('/api/coach/workout-templates', { title: 'No reps', items: [{ exerciseId: squat, sets: 3 }] })).status, 400, 'reps or a duration');
  assert.equal((await asha.post('/api/coach/workout-templates', { title: 'Too many sets', items: [{ exerciseId: squat, sets: 99, reps: '5' }] })).status, 400);
  assert.equal((await asha.post('/api/coach/exercises', { name: 'X', category: 'strength' })).status, 400, 'a name of two characters at least');
  assert.equal((await asha.post('/api/coach/exercises', { name: 'Made-up category', category: 'cardio-magic' })).status, 400);
  assert.equal((await a.post(`/api/admin/exercises/${squat}/status`, { status: 'archived' })).status, 400, 'a status change needs a reason');
  assert.equal((await a.post(`/api/admin/exercises/${squat}/status`, { status: 'gone', reason: 'test' })).status, 400);
  const empty = await a.post('/api/admin/workout-templates', { title: 'Empty team template' });
  assert.equal(empty.status, 201);
  assert.equal((await a.post(`/api/admin/workout-templates/${empty.json.id}/status`, { status: 'published', reason: 'test: publish empty' })).json.error?.code, 'TEMPLATE_EMPTY');
  assert.equal((await a.patch(`/api/admin/workout-templates/${templateId('Lower body')}`, { title: 'Admin edits a coach template' })).json.error?.code, 'NOT_TEAM_TEMPLATE');
});

test('administrators manage the library with library.manage; publishing a coach draft notifies the coach', async () => {
  const a = await admin();
  const adminId = userId(h.ctx, DEMO.admin);
  const ashaId = userId(h.ctx, DEMO.coach);
  const proposed = await (await coach(DEMO.coach)).post('/api/coach/exercises', { name: 'Test · Wall sit (coach proposal)', category: 'strength', equipment: ['wall'] });
  assert.equal(proposed.status, 201, JSON.stringify(proposed.json));
  assert.equal(proposed.json.status, 'draft');
  assert.equal(proposed.json.source, 'coach');
  const exId = proposed.json.id as string;
  assert.ok(((await a.get('/api/admin/exercises?status=draft')).json.items as Array<{ id: string }>).some((e) => e.id === exId), 'administrators see coach drafts');
  const pub = await a.post(`/api/admin/exercises/${exId}/status`, { status: 'published', reason: 'Reviewed by the coaching lead (test)' });
  assert.equal(pub.status, 200, JSON.stringify(pub.json));
  assert.equal(pub.json.status, 'published');
  assert.ok(((await (await coach(DEMO.coach2)).get('/api/coach/exercise-library')).json.items as Array<{ id: string }>).some((e) => e.id === exId), 'every coach sees it once published');
  assert.ok(h.db.get("SELECT 1 FROM notifications WHERE user_id = ? AND category = 'workout' AND data LIKE ?", [ashaId, `%${exId}%`]));
  const st = auditRows('exercise.status', exId)[0]!;
  assert.equal(st.actor_id, adminId);
  assert.equal(st.reason, 'Reviewed by the coaching lead (test)');
  assert.deepEqual(JSON.parse(st.data), { from: 'draft', to: 'published' });

  const team = await a.post('/api/admin/exercises', { name: 'Test · Team exercise', category: 'mobility', status: 'draft' });
  assert.equal(team.status, 201);
  assert.equal(team.json.source, 'team');
  const edited = await a.patch(`/api/admin/exercises/${team.json.id}`, { description: 'Edited in a test.' });
  assert.equal(edited.json.description, 'Edited in a test.');
  assert.deepEqual(JSON.parse(auditRows('exercise.update', team.json.id as string)[0]!.data), { fields: ['description'] });
  const squat = h.db.get<{ id: string }>("SELECT id FROM exercises WHERE name = 'Bodyweight Squat'")!.id;
  const tpl = await a.post('/api/admin/workout-templates', { title: 'Test · Team template', items: [{ exerciseId: squat, sets: 2, reps: '10' }] });
  assert.equal(tpl.status, 201, JSON.stringify(tpl.json));
  assert.equal(tpl.json.status, 'draft');
  assert.equal((await a.patch(`/api/admin/workout-templates/${tpl.json.id}`, { status: 'published' })).status, 400, 'status changes go through the status route');
  const tplPub = await a.post(`/api/admin/workout-templates/${tpl.json.id}/status`, { status: 'published', reason: 'Test: ready for coaches' });
  assert.equal(tplPub.json.status, 'published');
  assert.equal(auditRows('workout_template.status', tpl.json.id as string)[0]!.reason, 'Test: ready for coaches');

  const record = await a.get(`/api/admin/members/${userId(h.ctx, DEMO.member)}/workouts`);
  assert.equal(record.status, 200, JSON.stringify(record.json));
  assert.ok((record.json.sessions as Array<Record<string, unknown>>).some((s) => s.rpe === 6), 'administrators see the logs');
  assert.equal((await a.get(`/api/admin/members/${ashaId}/workouts`)).status, 404, 'only member accounts');

  // without library.manage the library is refused, with the permission named
  const ownerCtx = as(DEMO.owner);
  setUserPermission(ownerCtx, adminId, 'library.manage', false, 'test: revoke');
  const refused = await a.get('/api/admin/exercises');
  assert.equal(refused.status, 403);
  assert.equal(refused.json.error?.code, 'PERMISSION_DENIED');
  assert.equal((await a.post('/api/admin/exercises', { name: 'Refused', category: 'other' })).json.error?.code, 'PERMISSION_DENIED');
  setUserPermission(ownerCtx, adminId, 'library.manage', true, 'test: restore');
  assert.equal((await a.get('/api/admin/exercises')).status, 200);
  setUserPermission(ownerCtx, adminId, 'members.manage', false, 'test: revoke');
  assert.equal((await a.get(`/api/admin/members/${userId(h.ctx, DEMO.member)}/workouts`)).json.error?.code, 'PERMISSION_DENIED');
  setUserPermission(ownerCtx, adminId, 'members.manage', true, 'test: restore');
});

test('every workout mutation is audited with its actor, and the audit never copies the health detail', () => {
  const asha = userId(h.ctx, DEMO.coach), ananya = userId(h.ctx, DEMO.member), owner = userId(h.ctx, DEMO.owner), priya = userId(h.ctx, PRIYA);
  const expect: Array<[string, string]> = [['exercise.create', owner], ['exercise.create', asha], ['workout_template.create', owner], ['workout_template.create', asha], ['workout_program.create', asha], ['workout_program.publish', asha], ['workout_program.update_draft', asha], ['workout_program.archive', asha], ['workout_session.complete', ananya], ['workout_session.complete', priya], ['workout_session.skip', ananya], ['workout_session.feedback', asha]];
  for (const [action, actor] of expect) assert.ok(auditRows(action).some((r) => r.actor_id === actor), `${action} by ${actor}`);
  for (const r of auditRows('workout_session.complete')) { const d = JSON.parse(r.data) as Record<string, unknown>; assert.ok(!('rpe' in d) && !('note' in d) && !('sets' in d), 'counts only'); }
  for (const r of auditRows('workout_session.skip')) assert.ok(!JSON.stringify(r).includes('travelling'), 'the skip reason stays out of the audit');
});

test('a coach takes over the open programmes of a member reassigned to them', async () => {
  const o = await owner();
  const ananyaId = userId(h.ctx, DEMO.member), devId = userId(h.ctx, DEV);
  const pid = programOf(DEMO.member);
  const re = await o.post('/api/admin/assignments', { memberId: ananyaId, coachId: devId, reason: 'test: reassign for workouts' });
  assert.equal(re.status, 201, JSON.stringify(re.json));
  await processPending(h.ctx);
  assert.equal(h.db.get<{ coach_id: string }>('SELECT coach_id FROM workout_programs WHERE id = ?', [pid])!.coach_id, devId);
  const reassigned = auditRows('workout_program.reassign', pid);
  assert.equal(reassigned.length, 1);
  assert.equal(reassigned[0]!.actor_role, 'system');
  const dev = await coach(DEV);
  const got = await dev.get(`/api/coach/workout-programs/${pid}`);
  assert.equal(got.status, 200, JSON.stringify(got.json));
  assert.equal(got.json.coachId, devId);
  // the new coach can revise it with the templates it already uses (one is the previous coach's own)
  const structure = (got.json.published as { structure: unknown }).structure;
  assert.equal((await dev.patch(`/api/coach/workout-programs/${pid}`, { structure })).status, 200);
  assert.equal((await (await coach(DEMO.coach)).get(`/api/coach/workout-programs/${pid}`)).status, 404, 'the previous coach no longer reaches it');
});

test('with the workouts flag off, every workout route answers FEATURE_DISABLED and the client config omits it', async () => {
  const o = await owner();
  const ananya = await member(DEMO.member);
  const meera = await coach(DEMO.coach3);
  const a = await admin();
  assert.equal((await o.patch('/api/admin/modules', { key: 'workouts', enabled: false, reason: 'test: switch workouts off' })).status, 200);
  for (const [c, url] of [[ananya, '/api/me/workouts'], [ananya, '/api/me/workouts/history'], [meera, '/api/coach/exercise-library'], [meera, '/api/coach/workout-programs'], [a, '/api/admin/exercises']] as const) {
    const r = await c.get(url);
    assert.equal(r.status, 403, url);
    assert.equal(r.json.error?.code, 'FEATURE_DISABLED', url);
  }
  assert.equal((await ananya.post(`/api/me/workouts/${sessionOf(programOf(DEMO.member), 3, 2)}/skip`, {})).json.error?.code, 'FEATURE_DISABLED');
  assert.ok(!((await ananya.get('/api/public/config')).json.features as string[]).includes('workouts'));
  assert.equal((await o.patch('/api/admin/modules', { key: 'workouts', enabled: true, reason: 'test: switch workouts back on' })).status, 200);
  assert.equal((await ananya.get('/api/me/workouts')).status, 200);
});
