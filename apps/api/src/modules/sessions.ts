/* M8 Live sessions, webinars and consultation follow-through (feature flag 'sessions'; the public listing and sign-up
   also need 'public_webinars'). Migration 0016_sessions.sql.

   - routes: api/http/routes/sessions.ts, each through def() with feature 'sessions' (administrators also need
     sessions.manage, or members.manage for a member's record).
   - jobs: session_reminders (every 15 minutes) queues the reminder for registered members reminder_hours_before the
     start (the foundation's reminders job sends it, honouring preferences and quiet hours), logs one for a visitor, and
     reminds the host in-app.
   - events: ProgrammeEnded gives back places in members-only sessions the member is no longer in the audience for.
   - seedDemo: a few sessions in plain words (published, full with a waitlist, a draft, a past one with attendance, a
     public webinar, a cancelled one) and nothing else. No meeting links, recordings, speaker credentials or prices.
   - exportSections: the member's own registrations and attendance for their data export, including places given back
     or cancelled (with how each ended, in the words the member was told); never other registrants, counts, join links
     or drafts. (Consultation summaries the member reads are in
     the core archive's coachRecommendations; coaches' private notes and follow-ups are never exported.)
   Meeting provider, calendar sync and video stay "pending configuration" (MEETING_PROVIDER, CALENDAR_PROVIDER and
   VIDEO_PROVIDER accept only "none"); no join link is ever created by the platform. */
import type { ApiModule, DemoSeedContext } from './types.js';
import type { Ctx } from '../context.js';
import { sessionRoutes, PUBLIC_FLAG } from '../http/routes/sessions.js';
import * as domain from '../domain/sessions.js';
import { audit } from '../domain/audit.js';
import { addDays, addMinutes, zonedToIso } from '../lib/time.js';

export const sessions: ApiModule = {
  key: 'sessions',
  feature: 'sessions',
  routes: (app) => sessionRoutes(app),
  jobs: [
    { name: 'session_reminders', everyMs: 15 * 60_000, run: (ctx) => domain.runReminderJob(ctx), idle: (r) => { const x = r as { queued?: number; logged?: number } | undefined; return !!x && !x.queued && !x.logged; } },
  ],
  events: {
    ProgrammeEnded: [(ctx, _event, payload) => { if (payload.memberId) domain.onProgrammeEnded(ctx, String(payload.memberId)); }],
  },
  seedDemo: (demo) => seedSessionsDemo(demo),
  exportSections: [
    { key: 'registrations', label: 'Live sessions you signed up for, with your place and attendance, including places you gave back or that were cancelled (your Live sessions page no longer lists those)', build: (ctx, memberId) => domain.exportRegistrationsForMember(ctx, memberId) },
  ],
};

/** The seeded sessions, in plain words (no Demo or Sample, owner decision of 24 October 2026). Descriptions promise no
 *  link, recording or outcome. Times are relative to now, in India. */
function seedSessionsDemo(demo: DemoSeedContext): void {
  const { owner, coachIds, memberIds, adminId } = demo;
  if (!owner.config.isDemo) return;
  const db = owner.db;
  const now = owner.now();
  const [asha, rahul] = [coachIds[0], coachIds[1]];
  const ananya = memberIds[0], vikram = memberIds[1], deepa = memberIds[2], sunita = memberIds[4], priya = memberIds[8], sameer = memberIds[9];
  if (!asha || !rahul || !ananya || !vikram || !deepa || !sunita || !priya || !sameer) return;

  // the public part's switch follows the module flag in the demo, so every part can be shown
  db.run('UPDATE feature_flags SET enabled = 1, updated_at = ?, updated_by = ? WHERE key = ?', [now, owner.actor?.id ?? null, PUBLIC_FLAG]);
  audit(owner, 'feature_flag.update', { type: 'feature_flag', id: PUBLIC_FLAG }, 'initial data: the public webinar listing switched on', { enabled: true, keys: [PUBLIC_FLAG] });

  const day = (n: number) => addDays(now, n).slice(0, 10);
  const at = (n: number, minute: number) => zonedToIso(day(n), minute);
  const name = (id: string) => db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', [id])!.name;
  const as = (id: string): Ctx => { const u = db.get<{ id: string; role: 'member' | 'coach' | 'admin' | 'owner'; email: string; name: string }>('SELECT id, role, email, name FROM users WHERE id = ?', [id])!; return { ...owner, actor: { id: u.id, role: u.role, email: u.email, name: u.name } }; };

  // Asha: a published group class for every member with a live programme, with two people registered
  const mobility = domain.insertSampleSession(owner, { hostId: asha, kind: 'group_class', title: 'Morning mobility class', description: 'A 45-minute group class on mobility to start the day. Places are limited: sign up to keep yours.', startAt: at(3, 7 * 60), endAt: at(3, 7 * 60 + 45), capacity: 12, audience: 'members', status: 'published' });
  domain.register(as(ananya), mobility, ananya);
  domain.register(as(priya), mobility, priya);

  // Rahul: a small workshop that is full, with someone on the waitlist (capacity 2)
  const sleep = domain.insertSampleSession(owner, { hostId: rahul, kind: 'workshop', title: 'Evening wind-down workshop', description: 'A small evening workshop on a calmer routine before bed. It has two places; when it is full, you can join the waitlist.', startAt: at(5, 19 * 60), endAt: at(5, 20 * 60), capacity: 2, audience: 'members', status: 'published' });
  domain.register(as(vikram), sleep, vikram);
  domain.register(as(sunita), sleep, sunita);
  domain.register(as(ananya), sleep, ananya); // full: waitlisted

  // Asha: a draft for members of the Core package, not visible to members yet
  domain.insertSampleSession(owner, { hostId: asha, kind: 'group_class', title: 'Strength basics for Core members', description: 'A group class on strength basics for members on the Core package.', startAt: at(9, 18 * 60), endAt: at(9, 18 * 60 + 45), capacity: 10, audience: 'packages', packageIds: ['core'], status: 'draft' });

  // Asha: a past class, completed, with attendance recorded by the host (two marks, not an attendance figure)
  const past = domain.insertSampleSession(owner, { hostId: asha, kind: 'group_class', title: 'Posture check-in class', description: 'A group class on posture and short movement breaks during the working day.', startAt: at(-4, 7 * 60), endAt: at(-4, 7 * 60 + 45), capacity: null, audience: 'members', status: 'completed' });
  domain.insertSampleRegistration(owner, { sessionId: past, userId: ananya, name: name(ananya), status: 'attended', registeredAt: addMinutes(at(-4, 7 * 60), -3 * 1440) });
  domain.insertSampleRegistration(owner, { sessionId: past, userId: priya, name: name(priya), status: 'no_show', registeredAt: addMinutes(at(-4, 7 * 60), -2 * 1440) });

  // the Bioptime team: a public webinar with one visitor registered (an address on the reserved .test domain, which
  // receives nothing)
  const webinar = domain.insertSampleSession(owner, { hostId: adminId, kind: 'webinar', title: 'Getting started with Bioptime', description: 'A webinar from the Bioptime team on how coaching, blood tests and the app fit together. Open to everyone: sign up to keep a place.', startAt: at(7, 18 * 60 + 30), endAt: at(7, 19 * 60 + 30), capacity: 100, audience: 'public', status: 'published' });
  domain.insertSampleRegistration(owner, { sessionId: webinar, userId: null, name: 'Kavya Nambiar', email: 'kavya.nambiar@demo.bioptime.test', status: 'registered', registeredAt: addMinutes(now, -90) });
  domain.register(as(sameer), webinar, sameer);

  // Rahul: a cancelled class, so the member list shows what a cancellation looks like
  const cancelled = domain.insertSampleSession(owner, { hostId: rahul, kind: 'group_class', title: 'Lunchtime stretch', description: 'A 30-minute stretch class over lunch.', startAt: at(2, 13 * 60), endAt: at(2, 13 * 60 + 30), capacity: 15, audience: 'members', status: 'published' });
  domain.register(as(vikram), cancelled, vikram);
  domain.cancelSession(as(rahul), cancelled, 'The host is travelling that day.');
  void deepa;

  // consultation follow-through: the seed's completed consultation (Meera with Sunita) gets a summary and one
  // follow-up, written through the same service a coach uses
  const meera = coachIds[2];
  const done = meera ? db.get<{ id: string }>("SELECT id FROM appointments WHERE coach_id = ? AND member_id = ? AND status = 'completed' ORDER BY start_at DESC LIMIT 1", [meera, sunita]) : undefined;
  if (meera && done && db.get("SELECT 1 FROM coach_assignments WHERE coach_id = ? AND member_id = ? AND status IN ('active','paused')", [meera, sunita])) {
    domain.writeSummary(as(meera), done.id, {
      forMember: 'We went through your goals and the first weeks of your plan. We check in again after week two.',
      privateNote: 'Goals agreed. Ask about sleep and energy at the week-two check-in.',
      followUps: [{ title: 'Check in after week two' }],
    });
  }
}
