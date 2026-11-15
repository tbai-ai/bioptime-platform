/* M1 Habits and reminders (feature flag 'habits', migration 0009_habits.sql).
   Routes: api/http/routes/habits.ts (member, coach and administrator, each through def() with feature: 'habits').
   Jobs (the first two run only while the flag is on):
   - habits.habit_reminders: queues each active habit's reminders for the next 24 hours in the member's timezone into the
     foundation's reminders queue (ref_type 'habit'); the foundation's reminders job sends them through notify(),
     honouring the reminders preference and quiet hours. Category habit_reminder, in-app and push, never email.
   - habits.habit_followups: opens a coach_follow_up for the assigned coach when a habit has gone the owner's
     habit_followup_missed_days due days without a check-in. That setting starts empty (null): no follow-ups until the
     owner chooses a number on /admin/modules. A habit the member wrote themselves gets one only while the member
     shares health information.
   - habits.habit_followup_privacy (every 5 minutes, runWhenDisabled): an open follow-up on a habit the member wrote
     themselves is dismissed (audited) once the member stops sharing health information. Its title names the habit,
     and the coach's Today and follow-up lists are not gated by the habits flag, so this privacy clean-up also runs
     while the module is off.
   Events: CoachAssigned moves open habit follow-ups to the newly assigned coach.
   Adherence: due days checked in as done, per member and date range (GET /me/adherence, M2).
   Data export: the member's habits and check-ins, as their own Habits page shows them (moduleSections.habits). */
import type { ApiModule } from './types.js';
import { habitRoutes } from '../http/routes/habits.js';
import * as domain from '../domain/habits.js';

export const habits: ApiModule = {
  key: 'habits',
  feature: 'habits',
  routes: (app) => habitRoutes(app),
  jobs: [
    { name: 'habit_reminders', everyMs: 30 * 60_000, run: (ctx) => domain.runReminderJob(ctx), idle: (r) => !(r as { queued?: number } | undefined)?.queued },
    { name: 'habit_followups', everyMs: 60 * 60_000, run: (ctx) => domain.runFollowUpJob(ctx), idle: (r) => { const x = r as { opened?: number; closed?: number } | undefined; return !x?.opened && !x?.closed; } },
    { name: 'habit_followup_privacy', everyMs: 5 * 60_000, runWhenDisabled: true, run: (ctx) => domain.runFollowUpPrivacySweep(ctx), idle: (r) => !(r as { closed?: number } | undefined)?.closed },
  ],
  events: {
    CoachAssigned: [(ctx, _event, payload) => { domain.onCoachAssigned(ctx, payload); }],
  },
  adherence: { key: 'habits', label: 'Habits', compute: (ctx, memberId, range) => domain.adherenceFor(ctx, memberId, range) },
  seedDemo: (demo) => { domain.seedDemoHabits(demo.system, { coachIds: demo.coachIds, memberIds: demo.memberIds }); },
  exportSections: [
    { key: 'habits', label: 'Your habits and check-ins (check-in dates are your local calendar days)', build: (ctx, memberId) => domain.exportForMember(ctx, memberId) },
  ],
};
