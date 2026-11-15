/* Workouts for the member app (30 October 2026): safety notes and clips on library exercises (only an administrator
   maps a clip, checked against the exercise media manifest); a session's frozen copy of each exercise's description,
   muscle groups, equipment and safety notes (a later library edit never changes it; the clip follows the exercise);
   each session's categories and planned minutes (only when every exercise has a prescribed duration); the published
   library for members (GET /me/exercises); personal records from the member's own logged sets (GET
   /me/workouts/records); the media status in the player; the flag; and 0040's copy for sessions published before it. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId } from '../helpers.js';
import { sourceFolder, tempDir } from '../exerciseMediaFixture.js';
import { Db, MIGRATIONS_DIR } from '../../src/db/db.js';
import { importExercises } from '../../src/domain/exerciseMedia.js';
import { listForMember as listHabits } from '../../src/domain/habits.js';
import { findRestrictedFields, restrictedKeys } from '../../src/auth/fieldPolicy.js';
import { todayIst } from '../../src/domain/workouts.js';

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => {
  const mediaDir = tempDir('workouts');
  h = await makeApp({ env: { EXERCISE_MEDIA_DIR: mediaDir } });
  importExercises(h.config, sourceFolder(['squats', 'plank', 'push-ups']).dir);
});
after(async () => { await h.app.close(); h.db.close(); });

const signedIn = async (email: string, password: string, workspace: 'member' | 'dashboard', mfa = false) => { const c = client(h.app); await c.login(email, password, workspace, mfa); return c; };
const member = (email: string) => signedIn(email, DEMO_PASSWORDS.member, 'member');
const coachOf = (email: string) => signedIn(h.db.get<{ email: string }>("SELECT u.email FROM coach_assignments a JOIN users u ON u.id = a.coach_id WHERE a.member_id = ? AND a.status = 'active'", [userId(h.ctx, email)])!.email, DEMO_PASSWORDS.coach, 'dashboard');
const admin = () => signedIn(DEMO.admin, DEMO_PASSWORDS.admin, 'dashboard', true);
const owner = () => signedIn(DEMO.owner, DEMO_PASSWORDS.owner, 'dashboard', true);
const day = (offset: number) => new Date(Date.parse(`${todayIst(h.ctx)}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
/** Members with an active coach and no workout programme yet (never the open preview account, whose showcase is seeded). */
const freshMembers = () => h.db.all<{ email: string }>("SELECT u.email FROM users u WHERE u.role = 'member' AND u.email != 'priya.nair@demo.bioptime.test' AND EXISTS (SELECT 1 FROM coach_assignments a WHERE a.member_id = u.id AND a.status = 'active') AND NOT EXISTS (SELECT 1 FROM workout_programs p WHERE p.member_id = u.id) ORDER BY u.email").map((r) => r.email);

type Item = { id: string; exerciseId: string; exerciseName: string; exerciseCategory: string; description: string; muscleGroups: string[]; equipment: string[]; safetyNotes: string; media: { videoUrl: string; posterUrl: string; width: number; height: number; durationSeconds: number } | null };
let squatId = '', plankId = '', draftId = '';
let strengthTpl = '', timedTpl = '';
let programMember = '', otherMember = '';

test('administrators add safety notes and map clips of the manifest; an unknown clip is refused; a coach never maps one', async () => {
  const a = await admin();
  const make = async (body: Record<string, unknown>) => { const r = await a.post('/api/admin/exercises', { status: 'published', ...body }); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json as { id: string; mediaRef: string | null; safetyNotes: string; media: unknown }; };
  const squat = await make({ name: 'Goblet squat', category: 'strength', description: 'A squat holding one weight at the chest.', instructions: 'Feet shoulder width.\nSit back and down.', equipment: ['dumbbell'], muscleGroups: ['legs', 'glutes'], safetyNotes: 'Keep your heels down and your back long.', mediaRef: 'squats' });
  squatId = squat.id;
  assert.equal(squat.mediaRef, 'squats');
  assert.equal(squat.safetyNotes, 'Keep your heels down and your back long.');
  assert.ok(squat.media, 'the clip is served');
  plankId = (await make({ name: 'Forearm plank', category: 'core', description: 'Hold a straight line on the forearms.', muscleGroups: ['trunk'], safetyNotes: 'Stop if your lower back aches.' })).id;
  const unknown = await a.post('/api/admin/exercises', { name: 'Kettlebell swings', category: 'conditioning', status: 'published', mediaRef: 'kettlebell-swings' });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.json.error?.code, 'MEDIA_UNKNOWN');
  const patched = await a.patch(`/api/admin/exercises/${plankId}`, { mediaRef: 'plank' });
  assert.equal(patched.status, 200, JSON.stringify(patched.json));
  const audit = h.db.get<{ data: string }>("SELECT data FROM audit_events WHERE action = 'exercise.update' AND target_id = ? ORDER BY at DESC, rowid DESC LIMIT 1", [plankId])!;
  assert.deepEqual(JSON.parse(audit.data), { fields: ['media_ref'], mediaRef: { from: null, to: 'plank' } });
  assert.equal((await a.patch(`/api/admin/exercises/${plankId}`, { mediaRef: 'no-such-clip' })).json.error?.code, 'MEDIA_UNKNOWN');

  const coach = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach, 'dashboard');
  const proposal = await coach.post('/api/coach/exercises', { name: 'Wall sit', category: 'strength', safetyNotes: 'Knees over ankles.', mediaRef: 'squats' });
  assert.equal(proposal.status, 201);
  draftId = (proposal.json as { id: string }).id;
  assert.equal(h.db.get<{ media_ref: string | null }>('SELECT media_ref FROM exercises WHERE id = ?', [draftId])!.media_ref, null, 'a coach’s proposal never carries a clip');
  assert.equal((proposal.json as { safetyNotes: string }).safetyNotes, 'Knees over ankles.');
  const lib = await coach.get('/api/coach/exercise-library');
  assert.equal((lib.json.media as { status: string }).status, 'available');
  assert.ok((lib.json.items as Array<{ id: string; media: unknown }>).find((e) => e.id === squatId)!.media, 'coaches see the clip too');

  // two published team templates: one with a load and reps, one timed throughout
  const tpl = async (title: string, items: unknown[]) => { const r = await a.post('/api/admin/workout-templates', { title, status: 'published', items }); assert.equal(r.status, 201, JSON.stringify(r.json)); return (r.json as { id: string }).id; };
  strengthTpl = await tpl('Squat and plank', [{ exerciseId: squatId, sets: 3, reps: '8', restSeconds: 90, loadNote: 'moderate' }, { exerciseId: plankId, sets: 2, durationSeconds: 40, restSeconds: 30 }]);
  timedTpl = await tpl('Plank and squat holds', [{ exerciseId: plankId, sets: 3, durationSeconds: 30, restSeconds: 30 }, { exerciseId: squatId, sets: 2, durationSeconds: 45, restSeconds: 15 }]);
});

test('publishing freezes the exercise text into the session; the clip follows the exercise; categories and planned minutes in the week', async () => {
  [programMember, otherMember] = freshMembers();
  assert.ok(programMember && otherMember, 'two members without a programme');
  const coach = await coachOf(programMember);
  const created = await coach.post('/api/coach/workout-programs', { memberId: userId(h.ctx, programMember), title: 'Strength basics', startDate: day(0), structure: { weeks: [{ week: 1, days: [{ day: 1, templateId: strengthTpl }, { day: 2, templateId: timedTpl }, { day: 3, templateId: strengthTpl }, { day: 4, templateId: strengthTpl }] }] } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const pid = (created.json as { id: string }).id;
  assert.equal((await coach.post(`/api/coach/workout-programs/${pid}/publish`, { startDate: day(0) })).status, 200);

  const m = await member(programMember);
  const week = await m.get(`/api/me/workouts?from=${day(0)}&to=${day(6)}`);
  assert.equal(week.status, 200, JSON.stringify(week.json));
  const sessions = week.json.items as Array<{ id: string; title: string; categories: string[]; durationMinutesPlanned: number | null; week: number; day: number }>;
  const strength = sessions.find((s) => s.day === 1)!, timed = sessions.find((s) => s.day === 2)!;
  assert.deepEqual(strength.categories, ['strength', 'core'], 'in the order they first appear');
  assert.equal(strength.durationMinutesPlanned, null, 'an exercise prescribed by reps has no duration: nothing is estimated');
  assert.deepEqual(timed.categories, ['core', 'strength']);
  // plank 3 × 30 s with 2 × 30 s rest = 150 s; squat hold 2 × 45 s with 1 × 15 s rest = 105 s; 255 s → 5 minutes
  assert.equal(timed.durationMinutesPlanned, 5);
  assert.deepEqual((week.json.next as { categories: string[] }).categories, ['strength', 'core'], 'the next session too');

  const detail = await m.get(`/api/me/workouts/${strength.id}`);
  assert.equal(detail.status, 200);
  const items = detail.json.items as Item[];
  const squat = items.find((i) => i.exerciseId === squatId)!;
  assert.equal(squat.description, 'A squat holding one weight at the chest.');
  assert.deepEqual(squat.muscleGroups, ['legs', 'glutes']);
  assert.deepEqual(squat.equipment, ['dumbbell']);
  assert.equal(squat.safetyNotes, 'Keep your heels down and your back long.');
  assert.deepEqual(Object.keys(squat.media!).sort(), ['durationSeconds', 'height', 'posterUrl', 'videoUrl', 'width']);
  assert.match(squat.media!.videoUrl, /^\/api\/public\/media\/exercises\/squats\.[0-9a-f]{8}\.mp4$/);
  assert.equal((await h.app.inject({ method: 'GET', url: squat.media!.posterUrl })).statusCode, 200, 'the poster URL is served');
  assert.equal((detail.json.media as { status: string }).status, 'available');
  // the week names the picture each session opens on: its first exercise's clip poster, or none
  const cover = (sessions.find((s) => s.id === strength.id) as { coverPosterUrl?: string | null }).coverPosterUrl;
  assert.equal(cover, items[0]!.media ? items[0]!.media.posterUrl : null);
  for (const s of sessions as Array<{ id: string; coverPosterUrl?: unknown }>) assert.ok(s.coverPosterUrl === null || (typeof s.coverPosterUrl === 'string' && s.coverPosterUrl.startsWith('/api/public/media/')), 'a served poster or none');

  // a library edit after publishing: the text the member was given stays; the clip is the exercise's own, so it follows
  const a = await admin();
  assert.equal((await a.patch(`/api/admin/exercises/${squatId}`, { description: 'Changed later.', safetyNotes: 'Changed later.', muscleGroups: ['changed'], mediaRef: null })).status, 200);
  const after1 = (await m.get(`/api/me/workouts/${strength.id}`)).json.items as Item[];
  const frozen = after1.find((i) => i.exerciseId === squatId)!;
  assert.equal(frozen.description, 'A squat holding one weight at the chest.');
  assert.equal(frozen.safetyNotes, 'Keep your heels down and your back long.');
  assert.deepEqual(frozen.muscleGroups, ['legs', 'glutes']);
  assert.equal(frozen.media, null, 'a clip withdrawn from the exercise leaves the session at once');
  assert.ok(after1.find((i) => i.exerciseId === plankId)!.media, 'the plank keeps its clip');
  assert.equal((await a.patch(`/api/admin/exercises/${squatId}`, { mediaRef: 'squats' })).status, 200);

  // the coach's view of the session carries the same item fields and nothing restricted
  const cv = await coach.get(`/api/coach/workouts/${strength.id}`);
  assert.equal(cv.status, 200);
  assert.equal((cv.json.items as Item[]).find((i) => i.exerciseId === squatId)!.safetyNotes, 'Keep your heels down and your back long.');
  assert.deepEqual(findRestrictedFields(cv.json, restrictedKeys()), []);
});

test('the member library: published exercises only, by category and words, a page at a time, with the clip', async () => {
  const m = await member(programMember);
  const all = await m.get('/api/me/exercises?limit=100');
  assert.equal(all.status, 200, JSON.stringify(all.json));
  const items = all.json.items as Array<Record<string, unknown> & { id: string; name: string }>;
  const published = h.db.all<{ id: string }>("SELECT id FROM exercises WHERE status = 'published' ORDER BY name, id").map((r) => r.id);
  assert.deepEqual(items.map((i) => i.id), published, 'every published exercise, in name order');
  assert.ok(!items.some((i) => i.id === draftId), 'a coach’s draft is not in it');
  assert.deepEqual(Object.keys(items.find((i) => i.id === squatId)!).sort(), ['category', 'description', 'equipment', 'id', 'instructions', 'media', 'muscleGroups', 'name', 'safetyNotes']);
  assert.equal((all.json.media as { status: string }).status, 'available');
  assert.equal(all.json.nextCursor, null);

  const core = (await m.get('/api/me/exercises?category=core')).json.items as Array<{ category: string }>;
  assert.ok(core.length >= 1 && core.every((i) => i.category === 'core'));
  const found = (await m.get('/api/me/exercises?q=dumbbell')).json.items as Array<{ id: string; name: string; description: string; muscleGroups: string[]; equipment: string[] }>;
  assert.ok(found.some((i) => i.id === squatId), 'words in the equipment count');
  assert.ok(found.every((i) => /dumbbell/i.test(`${i.name} ${i.description} ${i.muscleGroups.join(' ')} ${i.equipment.join(' ')}`)), 'and only matching exercises are found (the seeded library has dumbbell exercises of its own)');

  const seen: string[] = [];
  let cursor: string | null = null;
  do {
    const page: { json: { items: Array<{ id: string }>; nextCursor: string | null } } = await m.get(`/api/me/exercises?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`) as never;
    assert.ok(page.json.items.length <= 2);
    seen.push(...page.json.items.map((i) => i.id));
    cursor = page.json.nextCursor;
  } while (cursor);
  assert.deepEqual(seen, published, 'pages cover the library once, in order');
  assert.equal((await m.get('/api/me/exercises?cursor=not-a-cursor')).json.error?.code, 'CURSOR_INVALID');

  const one = await m.get(`/api/me/exercises/${squatId}`);
  assert.equal(one.status, 200);
  assert.equal((one.json as { safetyNotes: string }).safetyNotes, 'Changed later.', 'the library shows its current text (sessions keep the copy they were given)');
  assert.ok((one.json as { media: unknown }).media);
  assert.equal((await m.get(`/api/me/exercises/${draftId}`)).status, 404, 'a draft is not found');
  const coach = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach, 'dashboard');
  assert.equal((await coach.get('/api/me/exercises')).status, 403, 'the member library is for members');
});

test('records come only from the member’s own logged sets: heaviest load with its reps, most reps, longest hold, the busiest week; skipped sessions count for nothing', async () => {
  const m = await member(programMember);
  const week = (await m.get(`/api/me/workouts?from=${day(0)}&to=${day(6)}`)).json.items as Array<{ id: string; day: number }>;
  const sid = (d: number) => week.find((s) => s.day === d)!.id;
  const itemsOf = async (id: string) => (await m.get(`/api/me/workouts/${id}`)).json.items as Item[];
  const s1 = await itemsOf(sid(1));
  const sq1 = s1.find((i) => i.exerciseId === squatId)!.id, pl1 = s1.find((i) => i.exerciseId === plankId)!.id;
  const done1 = await m.post(`/api/me/workouts/${sid(1)}/complete`, { rpe: 7, durationMinutes: 40, sets: [
    { itemId: sq1, setNumber: 1, repsDone: 8, loadKg: 20 }, { itemId: sq1, setNumber: 2, repsDone: 8, loadKg: 22.5 }, { itemId: sq1, setNumber: 3, repsDone: 6, loadKg: 22.5 },
    { itemId: pl1, setNumber: 1, durationSeconds: 40 }, { itemId: pl1, setNumber: 2, durationSeconds: 55 },
  ] });
  assert.equal(done1.status, 200, JSON.stringify(done1.json));
  // a partial session counts for what was done; a set not marked done does not
  const s3 = await itemsOf(sid(3));
  const sq3 = s3.find((i) => i.exerciseId === squatId)!.id;
  assert.equal((await m.post(`/api/me/workouts/${sid(3)}/complete`, { sets: [{ itemId: sq3, setNumber: 1, repsDone: 10, loadKg: 22.5 }, { itemId: sq3, setNumber: 2, repsDone: 12, loadKg: 30, completed: false }] })).status, 200);
  // a skipped session: even a set log on it (none can be written through the app) counts for nothing
  assert.equal((await m.post(`/api/me/workouts/${sid(4)}/skip`, { reason: 'Travelling' })).status, 200);
  const sq4 = (await itemsOf(sid(4))).find((i) => i.exerciseId === squatId)!.id;
  h.db.insert('workout_set_logs', { id: 'wsl_skippedtest01', session_id: sid(4), item_id: sq4, set_number: 1, reps_done: 5, load_kg: 200, completed: 1, created_at: h.ctx.now() });
  // a bodyweight set (no load) and the timed session
  const s2 = await itemsOf(sid(2));
  const pl2 = s2.find((i) => i.exerciseId === plankId)!.id, sq2 = s2.find((i) => i.exerciseId === squatId)!.id;
  assert.equal((await m.post(`/api/me/workouts/${sid(2)}/complete`, { sets: [{ itemId: pl2, setNumber: 1, durationSeconds: 50 }, { itemId: sq2, setNumber: 1, repsDone: 15, durationSeconds: 45 }] })).status, 200);

  // another member lifts more on the same exercise: never counted here
  const oc = await coachOf(otherMember);
  const op = await oc.post('/api/coach/workout-programs', { memberId: userId(h.ctx, otherMember), title: 'Other', startDate: day(0), structure: { weeks: [{ week: 1, days: [{ day: 1, templateId: strengthTpl }] }] } });
  await oc.post(`/api/coach/workout-programs/${(op.json as { id: string }).id}/publish`, { startDate: day(0) });
  const om = await member(otherMember);
  const osid = ((await om.get(`/api/me/workouts?from=${day(0)}&to=${day(0)}`)).json.items as Array<{ id: string }>)[0]!.id;
  const oitem = ((await om.get(`/api/me/workouts/${osid}`)).json.items as Item[]).find((i) => i.exerciseId === squatId)!.id;
  assert.equal((await om.post(`/api/me/workouts/${osid}/complete`, { sets: [{ itemId: oitem, setNumber: 1, repsDone: 3, loadKg: 100 }] })).status, 200);

  const r = await m.get('/api/me/workouts/records');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const ex = r.json.exercises as Array<{ exerciseId: string; name: string; category: string; bestLoadKg: { value: number; reps: number | null; date: string } | null; bestReps: { value: number; date: string } | null; longestDurationSeconds: { value: number; date: string } | null }>;
  const squat = ex.find((e) => e.exerciseId === squatId)!;
  assert.deepEqual(squat.bestLoadKg, { value: 22.5, reps: 10, date: day(0) }, 'the heaviest load, more reps winning a tie; the 30 kg set was not done, the 200 kg log was on a skipped session, the 100 kg is someone else’s');
  assert.deepEqual(squat.bestReps, { value: 15, date: day(0) }, 'most reps without a load');
  assert.deepEqual(squat.longestDurationSeconds, { value: 45, date: day(0) });
  const plank = ex.find((e) => e.exerciseId === plankId)!;
  assert.equal(plank.bestLoadKg, null);
  assert.deepEqual(plank.longestDurationSeconds, { value: 55, date: day(0) });
  assert.equal(plank.name, 'Forearm plank');
  assert.equal(plank.category, 'core');
  assert.equal(r.json.sessionsDone, 3, 'completed and partial; the skipped one is not');
  const weekStart = (() => { const d = new Date(`${day(0)}T00:00:00Z`); return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10); })();
  assert.deepEqual(r.json.mostSessionsInAWeek, { count: 3, weekOf: weekStart });
  assert.doesNotMatch(JSON.stringify(r.json), /kcal|calorie|1RM|one-rep/i, 'nothing estimated');

  // the habit streak is read through the habits domain, as GET /me/habits shows it
  const memberCtx = { ...h.ctx, actor: { id: userId(h.ctx, programMember), role: 'member' as const, email: programMember, name: 'm' } };
  const best = Math.max(0, ...listHabits(memberCtx, userId(h.ctx, programMember)).items.map((x) => x.streak.count));
  assert.equal((r.json.bestHabitStreak as { count: number } | null)?.count ?? 0, best);
  const o = await owner();
  assert.equal((await o.patch('/api/admin/modules', { key: 'habits', enabled: false, reason: 'test: habits off' })).status, 200);
  try { assert.equal((await m.get('/api/me/workouts/records')).json.bestHabitStreak, null, 'no habit streak while habits are off'); }
  finally { await o.patch('/api/admin/modules', { key: 'habits', enabled: true, reason: 'test: habits back on' }); }

  const fresh = await member(freshMembers()[0]!);
  const none = await fresh.get('/api/me/workouts/records');
  assert.deepEqual([none.json.exercises, none.json.mostSessionsInAWeek, none.json.sessionsDone], [[], null, 0], 'nothing logged, no records');
});

test('with exercise media switched off every exercise is text only and the player says why', async () => {
  const off = await makeApp({ env: { EXERCISE_MEDIA: 'none', EXERCISE_MEDIA_DIR: h.config.exerciseMediaDir } });
  try {
    const a = client(off.app);
    await a.login(DEMO.admin, DEMO_PASSWORDS.admin, 'dashboard', true);
    const ex = await a.post('/api/admin/exercises', { name: 'Push-up', category: 'strength', status: 'published', mediaRef: 'push-ups' });
    assert.equal(ex.status, 201, 'a listed clip can be mapped while the media are off');
    assert.equal((ex.json as { media: unknown }).media, null);
    const m = client(off.app);
    await m.login(DEMO.member, DEMO_PASSWORDS.member, 'member');
    const lib = await m.get('/api/me/exercises');
    assert.deepEqual(lib.json.media, { status: 'pending_configuration', missing: ['Exercise media is switched off (EXERCISE_MEDIA=none)'], note: 'Exercises are text only for now: no images or video.' });
    assert.ok((lib.json.items as Array<{ media: unknown }>).every((i) => i.media === null));
    const sid = off.db.get<{ id: string }>('SELECT id FROM workout_sessions WHERE member_id = ? LIMIT 1', [userId(off.ctx, DEMO.member)])!.id;
    const d = await m.get(`/api/me/workouts/${sid}`);
    assert.equal((d.json.media as { status: string }).status, 'pending_configuration');
    assert.ok((d.json.items as Item[]).every((i) => i.media === null));
  } finally { await off.app.close(); off.db.close(); }
});

test('with the workouts flag off the member library and records answer FEATURE_DISABLED', async () => {
  const o = await owner();
  const m = await member(programMember);
  assert.equal((await o.patch('/api/admin/modules', { key: 'workouts', enabled: false, reason: 'test: workouts off' })).status, 200);
  try {
    for (const url of ['/api/me/exercises', `/api/me/exercises/${squatId}`, '/api/me/workouts/records']) {
      const r = await m.get(url);
      assert.equal(r.status, 403, url);
      assert.equal(r.json.error?.code, 'FEATURE_DISABLED', url);
    }
  } finally { await o.patch('/api/admin/modules', { key: 'workouts', enabled: true, reason: 'test: workouts back on' }); }
});

test('0040 copies the library text into sessions published before it, once', () => {
  const db = new Db(':memory:');
  try {
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    for (const f of fs.readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql') && x < '0040').sort()) { db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')); db.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [f, 'test']); }
    db.exec('PRAGMA foreign_keys = OFF'); // the rows below stand alone: only the copy is under test
    const now = '2026-10-01T00:00:00.000Z';
    db.insert('exercises', { id: 'exr_a', name: 'Squat', description: 'Down and up.', instructions: '', category: 'strength', equipment: '["band"]', muscle_groups: '["legs"]', source: 'team', status: 'published', created_at: now, updated_at: now });
    db.insert('workout_session_items', { id: 'wsi_a', session_id: 'wks_a', exercise_id: 'exr_a', exercise_name: 'Squat', exercise_category: 'strength', sets: 3 });
    db.insert('workout_session_items', { id: 'wsi_b', session_id: 'wks_a', exercise_id: null, exercise_name: 'Gone', exercise_category: 'other', sets: 1 });
    db.migrate();
    assert.deepEqual({ ...db.get('SELECT exercise_description, exercise_muscles, exercise_equipment, exercise_safety FROM workout_session_items WHERE id = ?', ['wsi_a'])! }, { exercise_description: 'Down and up.', exercise_muscles: '["legs"]', exercise_equipment: '["band"]', exercise_safety: '' });
    assert.deepEqual({ ...db.get('SELECT exercise_description, exercise_muscles, exercise_equipment FROM workout_session_items WHERE id = ?', ['wsi_b'])! }, { exercise_description: '', exercise_muscles: '[]', exercise_equipment: '[]' }, 'an item without an exercise keeps the empty defaults');
    assert.equal(db.get<{ safety_notes: string }>('SELECT safety_notes FROM exercises WHERE id = ?', ['exr_a'])!.safety_notes, '');
  } finally { db.close(); }
});
