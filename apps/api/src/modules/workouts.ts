/* M6 Workouts: the exercise library, workout templates, coach-authored programmes with versions, sessions with set
   logs and effort ratings, coach feedback, history and adherence. Migrations 0014_workouts.sql and
   0026_workouts_fixes.sql (a revision's title and start date wait on the draft version until it is published).

   - routes: api/http/routes/workouts.ts, each through def() with feature 'workouts' (administrative routes also need
     library.manage or members.manage).
   - events: when a member is assigned to another coach, the new coach takes over the member's open programmes.
   - adherence: sessions due and done in a range, for GET /me/adherence (M2).
   - seedDemo: a few exercises (text only, no media), templates and programmes for the fictional members, in plain
     words, so every workspace has something to show. Each exercise says the coaching team writes the full library.
   - exportSections: the member's published programmes and their sessions with their own logs and the coach's feedback,
     for the data export (api/domain/dataExport.ts); never drafts, private notes or ids.
   - jobs: none. Sessions are dated when a version is published; nothing needs a timer. */
import type { ApiModule, DemoSeedContext } from './types.js';
import type { Ctx } from '../context.js';
import { workoutRoutes } from '../http/routes/workouts.js';
import * as w from '../domain/workouts.js';
import { zonedToIso } from '../lib/time.js';

export const workouts: ApiModule = {
  key: 'workouts',
  feature: 'workouts',
  routes: (app) => workoutRoutes(app),
  jobs: [],
  events: {
    CoachAssigned: [(ctx, _event, payload) => { if (payload.memberId && payload.coachId) w.onCoachAssigned(ctx, String(payload.memberId), String(payload.coachId)); }],
  },
  adherence: { key: 'workouts', label: 'Workouts', compute: (ctx, memberId, range) => w.adherence(ctx, memberId, range) },
  seedDemo: (demo) => seedWorkoutsDemo(demo),
  exportSections: [
    { key: 'programmes', label: 'Your workout programmes, as your coach published them to you', build: (ctx, memberId) => w.exportProgramsForMember(ctx, memberId) },
    { key: 'sessions', label: 'Your workout sessions: the exercises as prescribed, what you logged or skipped, and your coach’s feedback (plannedFor is a date in India Standard Time)', build: (ctx, memberId) => w.exportSessionsForMember(ctx, memberId) },
  ],
};

const TEXT_ONLY = 'Described in text: no demonstration video for this exercise yet.';

/** The seeded library, templates and programmes, in plain words (no Demo or Sample, owner decision of 24 October
 *  2026). The set logs and effort ratings are entries of the fictional members, made through the same services a
 *  member uses; their notes describe only what was logged. */
function seedWorkoutsDemo(demo: DemoSeedContext): void {
  const { owner, coachIds, memberIds } = demo;
  const as = (id: string): Ctx => {
    const u = owner.db.get<{ id: string; role: 'member' | 'coach' | 'admin' | 'owner'; email: string; name: string }>('SELECT id, role, email, name FROM users WHERE id = ?', [id]);
    if (!u) throw new Error(`seed: no user ${id}`);
    return { ...owner, actor: { id: u.id, role: u.role, email: u.email, name: u.name } };
  };
  const [asha, rahul, meera] = [coachIds[0], coachIds[1], coachIds[2]];
  const [ananya, vikram, deepa] = [memberIds[0], memberIds[1], memberIds[2]];
  if (!asha || !rahul || !meera || !ananya || !vikram || !deepa) return;

  // the library: team exercises (published) and one coach proposal still in draft. Names are in title case, as in the
  // preview member's library (api/seed/showcase.ts), so the member's list reads in one casing (T5-25)
  const ex = (name: string, category: string, equipment: string[], muscleGroups: string[]) => w.createTeamExercise(owner, { name, description: TEXT_ONLY, instructions: '', category, equipment, muscleGroups, status: 'published' }).id;
  const squat = ex('Bodyweight Squat', 'strength', [], ['legs']);
  const pushup = ex('Incline Push-Up', 'strength', ['bench or sturdy table'], ['chest', 'arms']);
  const bridge = ex('Glute Bridge', 'strength', [], ['hips']);
  const plank = ex('Front Plank', 'core', [], ['trunk']);
  const walk = ex('Brisk Walk', 'conditioning', [], []);
  const catcow = ex('Cat-Cow', 'mobility', [], ['back']);
  const ashaCtx = as(asha);
  const stepUp = w.proposeExercise(ashaCtx, { name: 'Step-Up', description: `${TEXT_ONLY} Proposed by a coach, waiting for review.`, instructions: '', category: 'strength', equipment: ['step or low box'], muscleGroups: ['legs'] }).id;

  // templates: two published team templates, one team draft, and one of Asha's own
  const fullBody = w.createTeamTemplate(owner, { title: 'Full body A', description: 'A beginner full-body session: squats, push-ups, bridges and a plank.', level: 'beginner', estMinutes: null, status: 'published', items: [
    { exerciseId: squat, block: 'Main', sets: 3, reps: '10', restSeconds: 60 },
    { exerciseId: pushup, block: 'Main', sets: 3, reps: '8-10', restSeconds: 60 },
    { exerciseId: bridge, block: 'Main', sets: 3, reps: '12', restSeconds: 60 },
    { exerciseId: plank, block: 'Finish', sets: 2, durationSeconds: 30, restSeconds: 45 },
  ] }).id;
  const walkMobility = w.createTeamTemplate(owner, { title: 'Walk and mobility', description: 'A brisk walk, then a few minutes of mobility.', level: 'all_levels', estMinutes: null, status: 'published', items: [
    { exerciseId: walk, block: 'Walk', sets: 1, durationSeconds: 1200 },
    { exerciseId: catcow, block: 'Mobility', sets: 2, reps: '8' },
  ] }).id;
  w.createTeamTemplate(owner, { title: 'Full body B', description: 'A second full-body session, not yet published.', level: 'beginner', status: 'draft', items: [
    { exerciseId: squat, block: 'Main', sets: 3, reps: '12' },
    { exerciseId: bridge, block: 'Main', sets: 3, reps: '12' },
  ] });
  const lower = w.createCoachTemplate(ashaCtx, { title: 'Lower body', description: 'A lower-body session from Asha’s own templates.', level: 'beginner', items: [
    { exerciseId: squat, block: 'Main', sets: 3, reps: '10' },
    { exerciseId: stepUp, block: 'Main', sets: 3, reps: '8 each side' },
    { exerciseId: bridge, block: 'Main', sets: 2, reps: '12' },
  ] }).id;

  const today = w.todayIst(owner);
  const minus = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
  const logAt = (sessionId: string) => { const s = owner.db.get<{ scheduled_date: string }>('SELECT scheduled_date FROM workout_sessions WHERE id = ?', [sessionId])!; owner.db.run('UPDATE workout_sessions SET completed_at = ? WHERE id = ?', [zonedToIso(s.scheduled_date, 18 * 60), sessionId]); };
  const session = (programId: string, week: number, day: number) => owner.db.get<{ id: string }>('SELECT id FROM workout_sessions WHERE program_id = ? AND week = ? AND day = ?', [programId, week, day])!.id;
  const itemsOf = (sessionId: string) => owner.db.all<{ id: string; sets: number; reps: string | null; duration_seconds: number | null }>('SELECT id, sets, reps, duration_seconds FROM workout_session_items WHERE session_id = ? ORDER BY sort', [sessionId]);
  const allSets = (sessionId: string, upTo?: number) => itemsOf(sessionId).flatMap((i) => Array.from({ length: Math.min(i.sets, upTo ?? i.sets) }, (_, k) => ({ itemId: i.id, setNumber: k + 1, repsDone: i.reps ? Number.parseInt(i.reps, 10) || null : null, durationSeconds: i.duration_seconds ?? null, completed: true })));

  // Ananya (coach Asha, sharing on): a published programme with sessions logged, skipped and reviewed
  const p1 = w.createProgram(ashaCtx, { memberId: ananya, title: 'Three-week full body', summary: 'Two sessions a week for three weeks: a strength session and a walk with mobility.', structure: { weeks: [
    { week: 1, focus: 'Getting started', days: [{ day: 2, templateId: fullBody }, { day: 5, templateId: walkMobility }] },
    { week: 2, focus: 'Building up', days: [{ day: 2, templateId: fullBody }, { day: 5, templateId: walkMobility }] },
    { week: 3, focus: 'Lower body', days: [{ day: 2, templateId: lower }, { day: 5, templateId: walkMobility }] },
  ] } });
  w.publishProgram(ashaCtx, p1.id, minus(10));
  const ananyaCtx = as(ananya);
  const s11 = session(p1.id, 1, 2);
  w.completeSession(ananyaCtx, ananya, s11, { sets: allSets(s11), rpe: 6, durationMinutes: null, note: 'All sets done; the push-ups felt easier by the last set.' });
  logAt(s11);
  w.skipSession(ananyaCtx, ananya, session(p1.id, 1, 5), 'Travelling that day.');
  const s21 = session(p1.id, 2, 2);
  w.completeSession(ananyaCtx, ananya, s21, { sets: allSets(s21, 2), rpe: 7, note: 'Two sets each today; short on time.' });
  logAt(s21);
  w.giveFeedback(ashaCtx, s11, 'A steady first session. Keep the same reps next week.');

  // Deepa (coach Meera, sharing off): the coach sees the schedule and the status, never the log
  const meeraCtx = as(meera);
  const p2 = w.createProgram(meeraCtx, { memberId: deepa, title: 'Walk and mobility, two days a week', summary: 'A walk with mobility on two days a week, for two weeks.', structure: { weeks: [
    { week: 1, days: [{ day: 1, templateId: walkMobility }, { day: 4, templateId: walkMobility }] },
    { week: 2, days: [{ day: 1, templateId: walkMobility }, { day: 4, templateId: walkMobility }] },
  ] } });
  w.publishProgram(meeraCtx, p2.id, minus(6));
  const s2 = session(p2.id, 1, 1);
  w.completeSession(as(deepa), deepa, s2, { sets: allSets(s2), rpe: 4, note: 'All sets done; an easy walk today.' });
  logAt(s2);

  // Vikram (coach Rahul): a draft not yet published
  w.createProgram(as(rahul), { memberId: vikram, title: 'Upper and lower', summary: 'Two sessions a week, not yet published.', structure: { weeks: [{ week: 1, days: [{ day: 1, templateId: fullBody }, { day: 4, templateId: walkMobility }] }] } });
}
