/* M7 Lab follow-ups and preparation reminders (feature flag 'labFollowups', migration 0015_labFollowups.sql).
   Routes: api/http/routes/labFollowups.ts (member, coach and administrator, each through def() with
   feature: 'labFollowups'); the rules live in api/domain/labFollowups.ts.
   Events (run only while the flag is on): BookingCreated and BookingUpdated keep one preparation reminder per upcoming
   home collection in the foundation's reminders queue (ref_type 'lab_preparation'), worded only from the laboratory's
   preparation text and fasting hours: queued when a booking is made, moved as soon as a reschedule's BookingUpdated
   ({ from, to, rescheduled: true }) is processed, cancelled when the booking is cancelled or collected. The handler
   re-reads the booking, so it never trusts the payload's slot.
   Jobs (run only while the flag is on):
   - labFollowups.preparation_sync (every 10 minutes): the safety net. It moves a reminder whose event never arrived and
     catches bookings made while the module was off.
   Data export (exportSections): the member's next steps and preparation reminders as their own screens show them.
   Demo: three next steps on the first coach-reviewed report, in plain words, with no invented dates.
   No private files (no fileAccess) and no adherence provider. */
import type { ApiModule } from './types.js';
import { labFollowUpRoutes } from '../http/routes/labFollowups.js';
import * as domain from '../domain/labFollowups.js';

export const labFollowups: ApiModule = {
  key: 'labFollowups',
  feature: 'labFollowups',
  routes: (app) => labFollowUpRoutes(app),
  jobs: [
    { name: 'preparation_sync', everyMs: 10 * 60_000, run: (ctx) => domain.syncAllPreparation(ctx), idle: (r) => { const x = r as { queued?: number; moved?: number; cancelled?: number } | undefined; return !!x && !x.queued && !x.moved && !x.cancelled; } },
  ],
  events: {
    BookingCreated: [(ctx, event) => { domain.syncPreparation(ctx, event.aggregate_id); }],
    BookingUpdated: [(ctx, event) => { domain.syncPreparation(ctx, event.aggregate_id); }],
  },
  seedDemo: (demo) => { domain.seedDemoFollowUps(demo.system, demo.memberIds); },
  exportSections: [
    { key: 'nextSteps', label: 'Next steps on your released blood test reports, as you see them (withdrawn ones are left out)', build: (ctx, memberId) => domain.exportNextSteps(ctx, memberId) },
    { key: 'preparationReminders', label: 'Reminders to prepare for a home collection, worded from the laboratory’s own preparation text', build: (ctx, memberId) => domain.exportPreparationReminders(ctx, memberId) },
  ],
};
