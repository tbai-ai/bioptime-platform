/* M2 Progress: goals, check-ins, photos, range charts and adherence (CAPABILITY_MAP.md 4.4).
   Migration 0010_progress.sql. Domain: api/domain/progress.ts. Routes: api/http/routes/progress.ts, each through def()
   with feature 'progress'; photo upload and sharing also need the stored switch progressPhotos (off until an owner
   turns it on, since the photo consent wording is pending counsel).

   Everything below is referenced lazily (arrow functions), so the import cycle registry → module → domain → registry
   never reads a binding before it exists; the one value read while this file loads, the photo file kind, comes from
   api/domain/progressConstants.ts, which imports nothing. */
import type { Role } from '@bioptime/domain';
import type { Ctx } from '../context.js';
import type { ApiModule, DemoSeedContext, ModuleJob } from './types.js';
import { progressRoutes } from '../http/routes/progress.js';
import * as domain from '../domain/progress.js';
import { PHOTO_FILE_KIND } from '../domain/progressConstants.js';
import { addDays, dateInZone, weekdayInZone } from '../lib/time.js';
import { j } from '../db/db.js';
import { randomId } from '../lib/ids.js';

const HOUR = 3_600_000;

const jobs: ModuleJob[] = [
  // the daily check-in work, run hourly so a restart never skips a due day; idempotent per schedule and due date
  { name: 'checkins_materialise', everyMs: HOUR, run: (ctx: Ctx) => domain.materialiseAll(ctx), idle: (r: unknown) => { const x = r as { created?: number; missed?: number; ended?: number } | undefined; return !!x && !x.created && !x.missed && !x.ended; } },
  // goals whose target a newly logged value reached (also checked whenever goals are read)
  { name: 'goals_evaluate', everyMs: HOUR, run: (ctx: Ctx) => domain.evaluateGoals(ctx), idle: (r: unknown) => { const x = r as { milestones?: number; goals?: number } | undefined; return !!x && !x.milestones && !x.goals; } },
  // privacy clean-up: photo retention (an owner decision; nothing is deleted while it is not set); runs while the module is off
  { name: 'photo_retention', everyMs: 6 * HOUR, runWhenDisabled: true, run: (ctx: Ctx) => domain.applyPhotoRetention(ctx), idle: (r: unknown) => { const x = r as { deleted?: number } | undefined; return !!x && !x.deleted; } },
];

export const progress: ApiModule = {
  key: 'progress',
  feature: 'progress',
  routes: (app) => progressRoutes(app),
  // a member can always delete their own photo and withdraw the photo consent, even while the module is off
  ungated: ['DELETE /me/progress/photos/:id', 'POST /me/progress/photos/consent'],
  jobs,
  events: {
    // a member moved to another coach: the previous coach's weekly check-in ends
    CoachAssigned: [(ctx, _event, payload) => { domain.onCoachAssigned(ctx, payload); }],
  },
  fileAccess: { [PHOTO_FILE_KIND]: (ctx, file) => domain.photoFileAccess(ctx, file) },
  adherence: { key: 'plan_tasks', label: 'Plan actions', compute: (ctx, memberId, range) => domain.planTasksAdherence(ctx, memberId, range) },
  // the member's data export: only what their own screens show (never the team's private notes; photos by name, type and date)
  exportSections: [
    { key: 'goals', label: 'Goals and milestones', build: (ctx, memberId) => domain.exportGoals(ctx, memberId) },
    { key: 'checkins', label: 'Check-ins: the questions, your answers and your coach’s replies', build: (ctx, memberId) => domain.exportCheckins(ctx, memberId) },
    { key: 'checkinSchedules', label: 'Weekly check-in schedules', build: (ctx, memberId) => domain.exportSchedules(ctx, memberId) },
    { key: 'progressPhotos', label: 'Progress photos, by name, type and date taken (open each one in the app)', build: (ctx, memberId) => domain.exportPhotos(ctx, memberId) },
  ],
  seedDemo: (demo) => seedDemo(demo),
};

/* ---------- demo rows (demo mode only), in plain words: no Demo or Sample (owner decision of 24 October 2026) ----------
   Goals and check-ins for two of the fictional members, built from values those members already logged in the core
   seed; no new readings are made up. No photos are seeded. The template is plain coaching questions, not a clinical
   questionnaire or a screening tool, and says so. */
function seedDemo(demo: DemoSeedContext): void {
  const { owner, coachIds, memberIds } = demo;
  const db = owner.db;
  const as = (id: string | undefined): Ctx | null => {
    if (!id) return null;
    const u = db.get<{ id: string; role: Role; email: string; name: string }>('SELECT id, role, email, name FROM users WHERE id = ?', [id]);
    return u ? { ...owner, actor: { id: u.id, role: u.role, email: u.email, name: u.name } } : null;
  };
  const metricOn = (m: string) => !!db.get('SELECT 1 FROM metric_config WHERE metric = ? AND enabled = 1', [m]);
  if (!metricOn('energy_1_5') || !metricOn('sleep_hours') || !metricOn('weight_kg')) return;

  const template = domain.createTemplate(owner, {
    title: 'Weekly check-in',
    description: 'Four short coaching questions. Not a clinical questionnaire or a screening tool.',
    questions: [
      { key: 'energy', label: 'How was your energy this week, from 1 (low) to 5 (high)?', type: 'scale_1_5', metric: 'energy_1_5' },
      { key: 'sleep', label: 'About how many hours did you sleep on a usual night?', type: 'number', metric: 'sleep_hours' },
      { key: 'plan', label: 'Did you follow your plan on most days?', type: 'yes_no' },
      { key: 'notes', label: 'Anything your coach should know?', type: 'text' },
    ],
  }, 'library');
  domain.publishTemplate(owner, template.id, 'initial data: the weekly check-in template');

  const now = owner.now();
  const backdate = (goalId: string, days: number) => db.run('UPDATE goals SET created_at = ?, updated_at = ? WHERE id = ?', [addDays(now, -days), addDays(now, -days), goalId]);

  // Ananya (first member, coached by the first coach): one measurable goal from her own sleep log, one habit goal
  const ananya = as(memberIds[0]);
  const asha = as(coachIds[0]);
  if (ananya && asha) {
    const sleep = domain.createGoal(ananya, ananya.actor!.id, { title: 'Sleep 8 hours on most nights', metric: 'sleep_hours', baselineValue: 6.5, targetValue: 8 }, 'member');
    domain.addMilestone(ananya, ananya.actor!.id, sleep.id, { title: 'Seven and a half hours', targetValue: 7.5 }, 'member');
    backdate(sleep.id, 14); // set two weeks ago, so the values she logged since count towards it
    const walk = domain.createGoal(ananya, ananya.actor!.id, { title: 'Walk after dinner on weekdays' }, 'member');
    const first = domain.addMilestone(ananya, ananya.actor!.id, walk.id, { title: 'First full week' }, 'member');
    domain.addMilestone(ananya, ananya.actor!.id, walk.id, { title: 'Four weeks in a row' }, 'member');
    const firstMilestone = first.milestones[0];
    if (firstMilestone) domain.setMilestoneAchieved(ananya, ananya.actor!.id, walk.id, firstMilestone.id, true, 'member');

    // two earlier check-ins with answers taken from the values she already logged, then her weekly schedule
    const latest = (metric: string) => db.get<{ value: number }>('SELECT value FROM progress_entries WHERE member_id = ? AND metric = ? ORDER BY at DESC LIMIT 1', [ananya.actor!.id, metric])?.value ?? null;
    const energy = latest('energy_1_5'), sleepHours = latest('sleep_hours');
    const questions = j.in(template.questions);
    const answers = (note: string) => j.in({ ...(energy !== null ? { energy } : {}), ...(sleepHours !== null ? { sleep: sleepHours } : {}), plan: true, notes: note });
    const past = (days: number) => addDays(now, -days);
    const pastDate = (days: number) => dateInZone(past(days)); // the India date, like every other due date
    db.insert('checkins', { id: randomId('chk'), member_id: ananya.actor!.id, coach_id: asha.actor!.id, template_id: template.id, schedule_id: null, title: template.title, questions, due_date: pastDate(9), status: 'reviewed', answers: answers('Sleeping better since moving dinner earlier.'), submitted_at: past(9), reviewed_at: past(8), reviewed_by: asha.actor!.id, response: 'A good week. We keep the evening walk and the earlier dinner.', created_by: asha.actor!.id, created_at: past(10) });
    db.insert('checkins', { id: randomId('chk'), member_id: ananya.actor!.id, coach_id: asha.actor!.id, template_id: template.id, schedule_id: null, title: template.title, questions, due_date: pastDate(2), status: 'submitted', answers: answers('One late night at work, otherwise on track.'), submitted_at: past(2), reviewed_at: null, reviewed_by: null, response: null, created_by: asha.actor!.id, created_at: past(3) });
    // her weekly schedule starts tomorrow (the job requests each one on its day); today's check-in is a one-off from her coach
    domain.createSchedule(asha, asha.actor!.id, ananya.actor!.id, { templateId: template.id, weekday: (weekdayInZone(now) + 1) % 7 });
    domain.requestCheckin(asha, asha.actor!.id, ananya.actor!.id, { templateId: template.id });
  }

  // Vikram (second member): a measurable goal from his own weight log
  const vikram = as(memberIds[1]);
  if (vikram) {
    const weight = domain.createGoal(vikram, vikram.actor!.id, { title: 'Weight to 80 kg', metric: 'weight_kg', baselineValue: 84.2, targetValue: 80 }, 'member');
    domain.addMilestone(vikram, vikram.actor!.id, weight.id, { title: '83 kg', targetValue: 83 }, 'member');
    backdate(weight.id, 14);
  }
}
