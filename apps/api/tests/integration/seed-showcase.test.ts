/* The preview member's showcase (api/seed/showcase.ts, 30 October 2026): after the demo seed, Priya Nair (the open-preview
   client) has a released programme with this week's coach-assigned sessions across categories, a clip only where the
   clip review kept one, history and records, sixty days of her own measurements with the phone's steps, goals with
   milestones reached by what she logged, habits with a streak, check-ins, a published meal plan whose values carry
   their honest source, two released reports whose markers trend, her coach's notes, messages and a consultation with
   its summary, and a package with balances. Everything is in plain words; nothing names the earlier app. Outside demo
   mode the showcase is not written. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, DEMO_PASSWORDS, userId } from '../helpers.js';
import { OPEN_PREVIEW_ACCOUNTS } from '../../src/auth/openPreview.js';
import * as exerciseMedia from '../../src/domain/exerciseMedia.js';
import { PREPARED_SOURCE, PREPARED_WELLNESS_LABEL, PREPARED_WELLNESS_SCORE, SHOWCASE_MEMBER } from '../../src/seed/showcase.js';

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); h.db.close(); });

const priya = async () => { const c = client(h.app); await c.login(SHOWCASE_MEMBER, DEMO_PASSWORDS.member, 'member'); return c; };
const LABEL_WORDS = /\bdemo\b|\bsamples?\b/i;

test('the open-preview client is the showcase member, with her package, coach, prepared score and balances', async () => {
  assert.equal(OPEN_PREVIEW_ACCOUNTS.member, SHOWCASE_MEMBER);
  const me = (await (await priya()).get('/api/me')).json as { member: { wellnessScore: number; wellnessScoreLabel: string }; programme: { packageName: string; startAt: string }; coach: { name?: string; coachName?: string }; entitlements: Record<string, { total: number; used: number; reserved: number; remaining: number }>; today: { steps: number | null; waterMl: number | null }; unread: { messages: number } };
  assert.deepEqual([me.member.wellnessScore, me.member.wellnessScoreLabel], [PREPARED_WELLNESS_SCORE, 'preview'], 'prepared, and labelled as prepared data (nothing calculates a score)');
  assert.equal(PREPARED_WELLNESS_LABEL, 'preview');
  assert.equal(me.programme.packageName, 'Advanced');
  assert.ok(Date.parse(me.programme.startAt) < Date.now() - 90 * 86_400_000, 'she joined before her first blood test');
  assert.deepEqual(me.entitlements.bloodwork, { ...me.entitlements.bloodwork, total: 4, used: 2, reserved: 1, remaining: 1 });
  assert.deepEqual(me.entitlements.consultation, { ...me.entitlements.consultation, total: 6, used: 1, reserved: 1, remaining: 4 });
  assert.equal(me.unread.messages, 1, 'her coach’s latest message waits for her');
});

test('this week’s sessions from her coach across categories, the frozen guide text, a clip only where the review kept one', async () => {
  const m = await priya();
  const week = (await m.get('/api/me/workouts')).json as { items: Array<{ id: string; title: string; day: number; status: string; categories: string[]; programTitle: string; version: number }>; programs: Array<{ title: string; version: number }> };
  assert.deepEqual(week.programs.map((p) => [p.title, p.version]), [['Six-week training block', 2]]);
  assert.deepEqual(week.items.map((s) => [s.day, s.title]), [[1, 'Lower body A'], [3, 'Upper body A'], [5, 'Full body and core'], [7, 'Mobility and recovery']]);
  assert.deepEqual([...new Set(week.items.flatMap((s) => s.categories))].sort(), ['conditioning', 'core', 'mobility', 'strength']);
  const friday = (await m.get(`/api/me/workouts/${week.items.find((s) => s.day === 5)!.id}`)).json as { items: Array<{ exerciseName: string; description: string; safetyNotes: string; media: unknown }> };
  const library = new Map(h.db.all<{ name: string; media_ref: string | null }>("SELECT name, media_ref FROM exercises WHERE source = 'team'").map((e) => [e.name, e.media_ref]));
  for (const i of friday.items) {
    assert.ok(i.description && i.safetyNotes, `${i.exerciseName}: the guide text`);
    const ref = library.get(i.exerciseName);
    assert.equal(!!i.media, !!ref && exerciseMedia.status(h.ctx).status === 'available', `${i.exerciseName}: a clip exactly when one is mapped`);
  }
  assert.equal(friday.items.find((i) => i.exerciseName === 'Kettlebell Swings'), undefined, 'her programme uses only exercises with a clip');
  assert.equal(library.get('Kettlebell Swings'), null, 'Kettlebell Swings stays in the library, text only');
  for (const [name, ref] of library) if (ref) assert.ok(exerciseMedia.has(h.ctx, ref), `${name}: ${ref} is in the manifest`);
});

test('history, records and her own measurements: logged, skipped and partly done sessions, loads that rise, the phone’s steps', async () => {
  const m = await priya();
  const hist = (await m.get('/api/me/workouts/history')).json as { totals: { completed: number; partial: number; skipped: number } };
  assert.ok(hist.totals.completed >= 10 && hist.totals.partial === 1 && hist.totals.skipped === 1, JSON.stringify(hist.totals));
  const rec = (await m.get('/api/me/workouts/records')).json as { exercises: Array<{ name: string; bestLoadKg: { value: number } | null }>; mostSessionsInAWeek: { count: number } };
  assert.ok(rec.exercises.find((e) => e.name === 'Barbell Back Squat')!.bestLoadKg!.value >= 45, 'the squat rose 2.5 kg a week');
  assert.equal(rec.mostSessionsInAWeek.count, 4);

  const id = userId(h.ctx, SHOWCASE_MEMBER);
  const steps = h.db.all<{ provider: string; source: string }>("SELECT d.provider, d.source FROM progress_daily_totals d WHERE d.member_id = ? AND d.metric = 'steps'", [id]);
  assert.ok(steps.length >= 60 && steps.every((s) => s.source === 'device' && s.provider === 'phone'), 'sixty days of steps from this phone');
  const summary = (await m.get('/api/me/progress/summary')).json as { metrics: Array<{ metric: string; latest: { sourceLabel?: string } | null; series: unknown[] }> };
  assert.equal(summary.metrics.find((x) => x.metric === 'steps')!.latest!.sourceLabel, 'From this phone');
  for (const metric of ['sleep_hours', 'weight_kg', 'water_ml', 'resting_hr_bpm', 'workout_minutes']) assert.ok(summary.metrics.find((x) => x.metric === metric)!.series.length > 3, `${metric} has a series`);

  const goals = (await m.get('/api/me/goals')).json as { items: Array<{ title: string; status: string; milestones: Array<{ reached: boolean }> }> };
  assert.equal(goals.items.filter((g) => g.status === 'active').length, 4);
  assert.equal(goals.items.flatMap((g) => g.milestones).filter((x) => x.reached).length, 2, 'two milestones reached by what she logged');
  const habits = (await m.get('/api/me/habits')).json as { items: Array<{ title: string; streak: { count: number } }> };
  assert.equal(habits.items.find((x) => x.title === 'Lights out by 22:30')!.streak.count, 9);
});

test('a published meal plan whose values carry the honest source, and today’s breakfast counted', async () => {
  const n = (await (await priya()).get('/api/me/nutrition')).json as { plan: { title: string; version: { targets: Record<string, number>; slots: unknown[] } }; todayTotals: { counted: { kcal: number }; sources: string[] } };
  assert.equal(n.plan.title, 'Vegetarian weekdays, fish at the weekend');
  assert.equal(n.plan.version.slots.length, 28, 'four meals a day on seven days');
  assert.ok(n.todayTotals.counted.kcal > 0);
  assert.deepEqual(n.todayTotals.sources, [PREPARED_SOURCE]);
  assert.doesNotMatch(PREPARED_SOURCE, /fitterify/i);
});

test('two released reports reviewed by her coach, markers that trend, next steps, and a lipid retest to come', async () => {
  const m = await priya();
  const reports = ((await m.get('/api/me/reports')).json as { items: Array<{ released: boolean; reviewerKind: string; values: unknown[]; simulated: boolean; collectedAt: string }> }).items;
  assert.equal(reports.length, 2);
  assert.ok(reports.every((r) => r.released && r.reviewerKind === 'coach' && r.values.length > 0 && r.simulated), 'reviewed, with values, and still the practice laboratory');
  const trend = ((await m.get('/api/me/reports/markers/vitamin_d')).json as { items: Array<{ value: string }> }).items.map((x) => x.value);
  assert.deepEqual(trend, ['18', '24']);
  const id = userId(h.ctx, SHOWCASE_MEMBER);
  assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM lab_followups WHERE member_id = ?', [id])!.n, 3);
  const next = h.db.get<{ status: string; slot_at: string; flag: string | null }>("SELECT b.status, b.slot_at, b.flag FROM bloodwork_bookings b JOIN bloodwork_tests t ON t.id = b.test_id WHERE b.member_id = ? AND t.vendor_test_id = 'LS-LIPID'", [id])!;
  assert.ok(next.status === 'scheduled' && Date.parse(next.slot_at) > Date.now() && next.flag === null, 'rebooked after the missed visit');
});

test('everything she reads is in plain words and never names the earlier app', () => {
  const id = userId(h.ctx, SHOWCASE_MEMBER);
  const texts = [
    ...h.db.all<{ t: string }>("SELECT name || ' ' || description || ' ' || instructions || ' ' || safety_notes AS t FROM exercises"),
    ...h.db.all<{ t: string }>("SELECT title || ' ' || description AS t FROM workout_templates"),
    ...h.db.all<{ t: string }>("SELECT COALESCE(member_note, '') || ' ' || COALESCE(skip_reason, '') AS t FROM workout_sessions WHERE member_id = ?", [id]),
    ...h.db.all<{ t: string }>("SELECT name || ' ' || serving_label || ' ' || COALESCE(source_ref, '') || ' ' || tags AS t FROM foods"),
    ...h.db.all<{ t: string }>("SELECT title || ' ' || summary || ' ' || method AS t FROM recipes"),
    ...h.db.all<{ t: string }>('SELECT description || COALESCE(note, \'\') AS t FROM meal_logs WHERE member_id = ?', [id]),
    ...h.db.all<{ t: string }>('SELECT body AS t FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.member_id = ?', [id]),
    ...h.db.all<{ t: string }>('SELECT body AS t FROM coach_notes WHERE member_id = ?', [id]),
    // the laboratory's own notices say "sample" in the blood-sample sense, which the copy rule allows
    ...h.db.all<{ t: string }>("SELECT title || ' ' || body AS t FROM notifications WHERE user_id = ? AND category != 'bloodwork'", [id]),
    ...h.db.all<{ t: string }>("SELECT title || ' ' || detail AS t FROM habits WHERE member_id = ?", [id]),
    ...h.db.all<{ t: string }>("SELECT COALESCE(answers, '') || ' ' || COALESCE(response, '') AS t FROM checkins WHERE member_id = ?", [id]),
    ...h.db.all<{ t: string }>('SELECT note AS t FROM lab_followups WHERE member_id = ?', [id]),
    ...h.db.all<{ t: string }>("SELECT COALESCE(coach_note, '') || ' ' || flagged AS t FROM report_metadata WHERE member_id = ?", [id]),
    ...h.db.all<{ t: string }>('SELECT title AS t FROM goals WHERE member_id = ?', [id]),
  ].map((r) => r.t);
  assert.ok(texts.length > 100);
  for (const t of texts) {
    assert.doesNotMatch(t, LABEL_WORDS, t.slice(0, 120));
    assert.doesNotMatch(t, /fitterify/i, t.slice(0, 120));
  }
  assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM progress_photos WHERE member_id = ?', [id])!.n, 0, 'no stock imagery as her progress photos');
});

test('outside demo mode the showcase is not written', async () => {
  const dev = await makeApp({ env: { BIOPTIME_MODE: 'development' } });
  try {
    const id = userId(dev.ctx, SHOWCASE_MEMBER);
    assert.equal(dev.db.get<{ n: number }>('SELECT COUNT(*) n FROM workout_programs WHERE member_id = ?', [id])!.n, 0);
    assert.equal(dev.db.get<{ n: number }>("SELECT COUNT(*) n FROM foods WHERE source_ref IS NOT NULL")!.n, 0);
    assert.equal(dev.db.get<{ s: number | null }>('SELECT wellness_score s FROM member_profiles WHERE user_id = ?', [id])!.s, null);
  } finally { await dev.app.close(); dev.db.close(); }
});
