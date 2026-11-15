/* Demo seed: synthetic people and coherent records, created through the same services the products use, so every
   programme, entitlement, assignment, booking and notification is consistent with the rules. Every person is fictional
   and every email ends in @demo.bioptime.test (a reserved domain). Never run against production.

   Wording (owner decision, 24 October 2026): nothing a viewer reads says "demo" or "sample" any more: names, titles,
   descriptions, notes, audit reasons and notification text are plain and true. Logins keep their @demo.bioptime.test
   emails and passwords; payments stay simulated and the laboratory a practice stand-in, which the payment and lab
   screens say in one small note. Audit reasons written here start with "initial data".

   In demo mode the seed ends with the open-preview member's showcase (api/seed/showcase.ts, 30 October 2026): Priya
   Nair's programme, history and records, so every screen of the client app has something true to show. */
import type { Ctx } from '../context.js';
import type { Services } from '../services.js';
import { ids } from '../lib/ids.js';
import { addDays, addMinutes, zonedToIso } from '../lib/time.js';
import { hashPassword } from '../lib/crypto.js';
import { j } from '../db/db.js';
import * as packages from '../domain/packages.js';
import * as orders from '../domain/orders.js';
import * as assignments from '../domain/assignments.js';
import * as members from '../domain/members.js';
import * as coaches from '../domain/coaches.js';
import * as appointments from '../domain/appointments.js';
import * as plans from '../domain/plans.js';
import * as bloodwork from '../domain/bloodwork.js';
import * as messaging from '../domain/messaging.js';
import * as customPlans from '../domain/customPlans.js';
import * as enquiries from '../domain/enquiries.js';
import { openTask } from '../domain/support.js';
import { processPending } from '../domain/events.js';
import { setSetting } from '../domain/settings.js';
import * as coupons from '../domain/coupons.js';
import { enableModulesForDemo } from '../domain/features.js';
import { MODULES } from '../modules/index.js';
import { seedShowcase } from './showcase.js';

export const DEMO_PASSWORDS = { member: 'Demo-Member-2026!', coach: 'Demo-Coach-2026!', admin: 'Demo-Admin-2026!', owner: 'Demo-Owner-2026!', rohan: 'Demo-Rohan-2026!', avinash: 'Demo-Avinash-2026!' };
export const DEMO_MFA_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'; // a fixed, synthetic TOTP secret for the seeded owner and admin, documented in the README

/** The admin dashboard is for the two owners, Rohan and Avinash (owner decision, 30 October 2026): two separate owner
 *  accounts with full master access and mandatory two-factor authentication. Until their real emails are given, the
 *  demo carries placeholder accounts on the reserved .test domain, seeded in demo mode only, with MFA enrolled on the
 *  synthetic demo secret exactly as owner@ is (so the demo's preview code works). Real accounts are made with
 *  `create-owner` (api/cli.ts), which takes no password on the command line. */
export const DEMO_OWNERS = [
  { email: 'rohan@demo.bioptime.test', name: 'Rohan (placeholder)', password: DEMO_PASSWORDS.rohan },
  { email: 'avinash@demo.bioptime.test', name: 'Avinash (placeholder)', password: DEMO_PASSWORDS.avinash },
] as const;

const COACHES = [
  { email: 'asha.menon@demo.bioptime.test', name: 'Asha Menon', expertise: ['strength', 'nutrition', 'fat loss'], languages: ['English', 'Malayalam', 'Hindi'], city: 'Bengaluru', limit: 25, bio: 'Strength and nutrition coach; ten years in studio and online coaching.' },
  { email: 'rahul.verma@demo.bioptime.test', name: 'Rahul Verma', expertise: ['recovery', 'mobility', 'sleep', 'energy'], languages: ['English', 'Hindi'], city: 'Bengaluru', limit: 20, bio: 'Recovery, mobility and sleep routines for busy people.' },
  { email: 'meera.iyer@demo.bioptime.test', name: 'Meera Iyer', expertise: ['bloodwork', 'longevity', 'nutrition', 'metabolic'], languages: ['English', 'Tamil'], city: 'Chennai', limit: 15, bio: 'Metabolic health and healthy ageing; reads every report with the member.' },
  { email: 'dev.kapoor@demo.bioptime.test', name: 'Dev Kapoor', expertise: ['strength', 'consistency', 'habits'], languages: ['English', 'Hindi', 'Punjabi'], city: 'Pune', limit: 20, bio: 'Habit-first strength coaching for people getting back into training.' },
];

const MEMBERS = [
  { email: 'ananya.rao@demo.bioptime.test', name: 'Ananya Rao', phone: '+919700000011', city: 'Bengaluru', state: 'Karnataka', pincode: '560001', gender: 'female', dob: '1992-03-14', goals: ['Energy and sleep'], pkg: 'core', coach: 0 },
  { email: 'vikram.shetty@demo.bioptime.test', name: 'Vikram Shetty', phone: '+919700000012', city: 'Bengaluru', state: 'Karnataka', pincode: '560034', gender: 'male', dob: '1985-07-02', goals: ['Strength and fat loss'], pkg: 'advanced', coach: 1 },
  { email: 'deepa.krishnan@demo.bioptime.test', name: 'Deepa Krishnan', phone: '+919700000013', city: 'Chennai', state: 'Tamil Nadu', pincode: '600028', gender: 'female', dob: '1974-11-21', goals: ['Healthy ageing'], pkg: 'starter', coach: 2 },
  { email: 'arjun.patel@demo.bioptime.test', name: 'Arjun Patel', phone: '+919700000014', city: 'Bengaluru', state: 'Karnataka', pincode: '560066', gender: 'male', dob: '1997-01-09', goals: ['Get back into training'], pkg: 'ignite', coach: null },
  { email: 'sunita.bhat@demo.bioptime.test', name: 'Sunita Bhat', phone: '+919700000015', city: 'Mysuru', state: 'Karnataka', pincode: '570001', gender: 'female', dob: '1980-05-30', goals: ['Metabolic health'], pkg: 'core', coach: 2 },
  { email: 'karthik.reddy@demo.bioptime.test', name: 'Karthik Reddy', phone: '+919700000016', city: 'Hyderabad', state: 'Telangana', pincode: '500034', gender: 'male', dob: '1988-09-17', goals: ['Recovery and mobility'], pkg: 'advanced', coach: 'pending' },
  { email: 'neha.joshi@demo.bioptime.test', name: 'Neha Joshi', phone: '+919700000017', city: 'Pune', state: 'Maharashtra', pincode: '411001', gender: 'female', dob: '1995-12-05', goals: ['Consistency'], pkg: 'starter', coach: 'pending' },
  { email: 'rohan.das@demo.bioptime.test', name: 'Rohan Das', phone: '+919700000018', city: 'Bengaluru', state: 'Karnataka', pincode: '560103', gender: 'male', dob: '1999-04-22', goals: ['Strength'], pkg: 'core', coach: null, unpaid: true },
  { email: 'priya.nair@demo.bioptime.test', name: 'Priya Nair', phone: '+919700000019', city: 'Kochi', state: 'Kerala', pincode: '682001', gender: 'female', dob: '1983-08-11', goals: ['Energy and sleep', 'Strength'], pkg: 'advanced', coach: 0 },
  { email: 'sameer.khan@demo.bioptime.test', name: 'Sameer Khan', phone: '+919700000020', city: 'Mumbai', state: 'Maharashtra', pincode: '400050', gender: 'male', dob: '1979-02-28', goals: ['Metabolic health', 'Healthy ageing'], pkg: 'core', coach: 3 },
  { email: 'lakshmi.venkat@demo.bioptime.test', name: 'Lakshmi Venkat', phone: '+919700000021', city: 'Chennai', state: 'Tamil Nadu', pincode: '600041', gender: 'female', dob: '1968-10-03', goals: ['Healthy ageing', 'Mobility'], pkg: 'starter', coach: 3 },
  { email: 'ishaan.mehta@demo.bioptime.test', name: 'Ishaan Mehta', phone: '+919700000022', city: 'Ahmedabad', state: 'Gujarat', pincode: '380015', gender: 'male', dob: '2001-06-18', goals: ['Strength'], pkg: null, coach: null, onboardingIncomplete: true },
  { email: 'farah.ali@demo.bioptime.test', name: 'Farah Ali', phone: '+919700000023', city: 'Bengaluru', state: 'Karnataka', pincode: '560008', gender: 'female', dob: '1990-01-25', goals: ['Energy and sleep'], pkg: null, coach: null, failedPayment: true },
];

export async function seedDemo(ctx: Ctx, services: Services): Promise<Record<string, unknown>> {
  const db = ctx.db;
  if (db.get("SELECT 1 FROM users WHERE email LIKE '%@demo.bioptime.test' LIMIT 1")) return { seeded: false, note: 'demo data already present; run reset-demo to start over' };
  const now = ctx.now();
  const sys = { ...ctx, actor: null } as Ctx;

  // privileged accounts
  const ownerId = ids.user(), adminId = ids.user();
  for (const [id, email, name, role, pw] of [[ownerId, 'owner@demo.bioptime.test', 'Bioptime owner', 'owner', DEMO_PASSWORDS.owner], [adminId, 'admin@demo.bioptime.test', 'Operations admin', 'admin', DEMO_PASSWORDS.admin]] as const) {
    db.insert('users', { id, email, password_hash: hashPassword(pw), role, state: 'active', name, email_verified_at: now, mfa_secret: DEMO_MFA_SECRET, mfa_enabled: 1, created_at: now, updated_at: now });
    db.insert('notification_preferences', { user_id: id, updated_at: now });
  }
  if (ctx.config.isDemo) {
    for (const o of DEMO_OWNERS) {
      const id = ids.user();
      db.insert('users', { id, email: o.email, password_hash: hashPassword(o.password), role: 'owner', state: 'active', name: o.name, email_verified_at: now, mfa_secret: DEMO_MFA_SECRET, mfa_enabled: 1, created_at: now, updated_at: now });
      db.insert('notification_preferences', { user_id: id, updated_at: now });
    }
  }
  const owner: Ctx = { ...ctx, actor: { id: ownerId, role: 'owner', email: 'owner@demo.bioptime.test', name: 'Bioptime owner' } };

  // settings: manual assignment (the demo_banner setting keeps its default; no screen reads it)
  setSetting(owner, 'assignment_policy', 'manual', 'initial data');
  // one coupon so the checkout can show a code; its note says it is not a commercial decision
  coupons.createCoupon(owner, { code: 'WELCOME10', kind: 'percent', value: 10, maxUses: 100, note: 'Welcome code showing how codes work at checkout; not a commercial decision' }, 'initial data');

  // catalogue: the four packages (placeholder prices, not a commercial decision: the checkout says payments are
  // simulated) and the three app programmes (prices from the app catalogue)
  const pkg = (slug: string, name: string, kind: 'package' | 'programme' | 'bespoke', v: packages.VersionInput, description: string, sort: number) => packages.createPackage(owner, { slug, name, kind, description, sort, ...v }, 'initial data');
  pkg('starter', 'Starter', 'package', { durationMonths: 1, durationLabel: '1 month', consultations: 1, bloodworkEntitlements: 1, priceInr: 4999, coaching: 'standard', includes: ['1 blood test with home collection', '1 coach consultation', 'Messaging with your coach', 'The studio library'], forSale: true }, 'One month to start: a baseline test, a consultation and a plan that fits your week.', 1);
  pkg('core', 'Core', 'package', { durationMonths: 3, durationLabel: '3 months', consultations: 3, bloodworkEntitlements: 1, priceInr: 12999, coaching: 'standard', includes: ['1 blood test with home collection', '3 coach consultations', 'Messaging with your coach', 'The studio library'], forSale: true }, 'Three months of coaching with a test and a consultation each month.', 2);
  pkg('advanced', 'Advanced', 'package', { durationMonths: 6, durationLabel: '6 months', consultations: 6, bloodworkEntitlements: 2, priceInr: 22999, coaching: 'standard', includes: ['2 blood tests with home collection', '6 coach consultations', 'Messaging with your coach', 'The studio library'], forSale: true }, 'Six months, two tests, a consultation a month: the long view.', 3);
  pkg('bespoke', 'Bespoke', 'bespoke', { durationMonths: null, durationLabel: 'Custom', consultations: 0, bloodworkEntitlements: 0, priceInr: null, coaching: 'as_agreed', includes: ['Duration, tests and consultations agreed per proposal'], forSale: false }, 'A plan scoped with you and priced per proposal.', 4);
  pkg('ignite', 'Ignite', 'programme', { durationMonths: 2, durationLabel: '8 weeks', consultations: 0, bloodworkEntitlements: 0, priceInr: 2999, coaching: 'none', level: 'Beginner', includes: ['48 structured workouts', 'Personalised nutrition plan', 'Weekly progress check-ins', 'Progress tracking dashboard'], forSale: true }, 'An 8-week programme for anyone ready to build real, lasting fitness.', 10);
  pkg('evolve', 'Evolve', 'programme', { durationMonths: 3, durationLabel: '12 weeks', consultations: 0, bloodworkEntitlements: 0, priceInr: 4499, coaching: 'none', level: 'Intermediate', includes: ['Periodised training blocks', 'Nutrition targets', 'Weekly check-ins'], forSale: true }, 'Twelve weeks of periodised blocks for people who have plateaued.', 11);
  pkg('reset', 'Reset', 'programme', { durationMonths: 1, durationLabel: '4 weeks', consultations: 0, bloodworkEntitlements: 0, priceInr: 1499, coaching: 'none', level: 'All levels', includes: ['Mobility and recovery sessions', 'Sleep routine', 'Daily habits'], forSale: true }, 'Four weeks to recover, move well and sleep better.', 12);

  // bloodwork catalogue from the stand-in, then prices (the catalogue sync hides new tests until priced)
  await bloodwork.syncCatalogue(owner, services.vendor);
  for (const t of db.all<{ id: string; vendor_test_id: string }>('SELECT id, vendor_test_id FROM bloodwork_tests')) {
    const price = ({ 'LS-FBE': 1999, 'LS-FBA': 3499, 'LS-CBC': 399, 'LS-LIPID': 599, 'LS-HSCRP': 699, 'LS-HBA1C': 549, 'LS-THY': 549, 'LS-VITD': 1199, 'LS-B12': 999 } as Record<string, number>)[t.vendor_test_id];
    if (price) bloodwork.setTestPrice(owner, t.id, price, false, 'initial data: catalogue prices as in the app');
  }
  for (const m of ['weight_kg|Weight|kg|30|300', 'waist_cm|Waist|cm|40|200', 'resting_hr_bpm|Resting heart rate|bpm|30|200', 'sleep_hours|Sleep|h|0|16', 'steps|Steps|steps|0|100000', 'energy_1_5|Energy (1–5)|/5|1|5', 'wellbeing_1_5|Wellbeing (1–5)|/5|1|5', 'habit_adherence_pct|Habit adherence|%|0|100', 'workout_minutes|Workout minutes|min|0|600', 'water_ml|Water|ml|0|10000']) {
    const [metric, label, unit, min, max] = m.split('|') as [string, string, string, string, string];
    db.insert('metric_config', { metric, label, unit, enabled: 1, min_value: Number(min), max_value: Number(max), sort: 0 });
  }

  // coaches (invited and activated through the real flow, with availability)
  const coachIds: string[] = [];
  for (const c of COACHES) {
    const inv = (await import('../auth/service.js')).inviteCoach(owner, { email: c.email, displayName: c.name, expertise: c.expertise, languages: c.languages, city: c.city, caseloadLimit: c.limit, scope: ['coaching', 'nutrition', 'report review'] });
    const r = (await import('../auth/service.js')).acceptInvitation(sys, { token: inv.token, password: DEMO_PASSWORDS.coach, acceptPolicies: true, policiesVersion: '2026-10-17', profile: { displayName: c.name, bio: c.bio, expertise: c.expertise, languages: c.languages, city: c.city, timezone: 'Asia/Kolkata', scope: ['coaching', 'nutrition', 'report review'] }, availability: [1, 2, 3, 4, 5].map((wd) => ({ weekday: wd, startMinute: 7 * 60, endMinute: 12 * 60, slotMinutes: 30 })).concat([1, 2, 3, 4, 5].map((wd) => ({ weekday: wd, startMinute: 17 * 60, endMinute: 20 * 60, slotMinutes: 30 }))), kind: 'web' });
    coachIds.push(r.user.id);
  }
  coaches.setAvailability(owner, coachIds[2]!, { available: false, unavailableUntil: addDays(now, 12).slice(0, 10) + 'T23:59:59.000Z', reason: 'On leave' });
  coaches.setAvailability(owner, coachIds[2]!, { available: true, reason: 'Back from leave' });

  // members through registration, verification and onboarding
  const memberIds: string[] = [];
  const auth = await import('../auth/service.js');
  for (const m of MEMBERS) {
    const { user, verificationToken } = auth.registerMember(sys, { email: m.email, password: DEMO_PASSWORDS.member, name: m.name, phone: m.phone, termsVersion: '2026-10-17', marketingConsent: false });
    auth.verifyEmail(sys, verificationToken);
    const mctx: Ctx = { ...ctx, actor: { id: user.id, role: 'member', email: m.email, name: m.name } };
    members.saveOnboardingStep(mctx, user.id, 'profile', { gender: m.gender, dateOfBirth: m.dob, city: m.city, state: m.state, pincode: m.pincode, address: `${12 + memberIds.length} Lake View Road`, timezone: 'Asia/Kolkata' });
    members.saveOnboardingStep(mctx, user.id, 'goals', { goals: m.goals, preferences: { language: 'English', trainingDays: 3 } });
    if (!m.onboardingIncomplete) {
      members.saveOnboardingStep(mctx, user.id, 'programme_info', { seen: true });
      members.saveOnboardingStep(mctx, user.id, 'how_it_works', { seen: true });
      members.saveOnboardingStep(mctx, user.id, 'consents', { healthData: true, coachSharing: m.email !== 'deepa.krishnan@demo.bioptime.test', labConsent: true, marketing: false, version: '2026-10-17' });
    }
    memberIds.push(user.id);
  }
  // the wellness score label: 'estimate' (what every score is), not the column's old default 'sample'
  db.run("UPDATE member_profiles SET wellness_score_label = 'estimate' WHERE wellness_score_label = 'sample'");

  // orders: paid and activated through the simulator webhook (the real path), one unpaid, one failed
  const programmeIds: Record<string, string> = {};
  for (let i = 0; i < MEMBERS.length; i++) {
    const m = MEMBERS[i]!;
    const memberId = memberIds[i]!;
    const mctx: Ctx = { ...ctx, actor: { id: memberId, role: 'member', email: m.email, name: m.name } };
    if (m.pkg) {
      const checkout = orders.createCheckout(mctx, services.payments, { memberId, packageId: m.pkg });
      if (!m.unpaid) {
        const ev = services.payments.simulateEvent!(checkout.checkout!.checkoutId, checkout.order.reference, Math.round(checkout.order.totalInr * 100), 'captured');
        orders.handlePaymentWebhook(sys, services.payments, ev.body, ev.signature);
        await processPending(sys);
        programmeIds[memberId] = db.get<{ id: string }>('SELECT id FROM programmes WHERE member_id = ?', [memberId])!.id;
      }
    }
    if (m.failedPayment) {
      const checkout = orders.createCheckout(mctx, services.payments, { memberId, packageId: 'starter' });
      const ev = services.payments.simulateEvent!(checkout.checkout!.checkoutId, checkout.order.reference, Math.round(checkout.order.totalInr * 100), 'failed');
      orders.handlePaymentWebhook(sys, services.payments, ev.body, ev.signature);
    }
  }

  // assignments: confirm the requests for members with a coach index; leave two pending; Deepa's coach went on leave later
  for (let i = 0; i < MEMBERS.length; i++) {
    const m = MEMBERS[i]!;
    if (typeof m.coach !== 'number') continue;
    const req = db.get<{ id: string }>("SELECT id FROM assignment_requests WHERE member_id = ? AND status IN ('open','exception')", [memberIds[i]!]);
    if (req) assignments.assign(owner, { requestId: req.id, coachId: coachIds[m.coach]!, method: 'manual', reason: 'Confirmed from the recommendation' });
  }
  await processPending(sys);

  // plans for the assigned members
  const planFor = (coachIdx: number, memberIdx: number, title: string, weeks: plans.PlanStructure['weeks']) => {
    const cctx: Ctx = { ...ctx, actor: { id: coachIds[coachIdx]!, role: 'coach', email: COACHES[coachIdx]!.email, name: COACHES[coachIdx]!.name } };
    const p = plans.createPlan(cctx, { coachId: coachIds[coachIdx]!, memberId: memberIds[memberIdx]!, programmeId: programmeIds[memberIds[memberIdx]!] ?? null, title, goals: MEMBERS[memberIdx]!.goals, summary: 'Four weeks, reviewed every fortnight.', structure: { weeks, reviewSchedule: 'fortnightly', progressIndicators: ['sleep_hours', 'habit_adherence_pct'] } });
    plans.publish(cctx, p.id as string, addDays(now, -10).slice(0, 10));
    return p.id as string;
  };
  const stdWeeks = (focus: string[]) => focus.map((f, i) => ({ week: i + 1, focus: f, tasks: [{ title: 'Evening walk · 25 min', kind: 'movement', day: 1 }, { title: 'Full body session · 40 min', kind: 'training', day: 2 }, { title: 'Protein at breakfast', kind: 'nutrition', day: 3 }, { title: 'Lights out by 23:00', kind: 'sleep', day: 4 }, { title: 'Mobility · 20 min', kind: 'movement', day: 6 }] }));
  planFor(0, 0, 'Energy and sleep: three good weeks', stdWeeks(['Foundation', 'Build', 'Consolidate', 'Review']));
  planFor(1, 1, 'Upper and lower split, four days', stdWeeks(['Base', 'Load', 'Push', 'Deload']));
  planFor(2, 4, 'Metabolic health basics', stdWeeks(['Routine', 'Food quality', 'Movement breaks', 'Review']));
  planFor(0, 8, 'Strength and sleep', stdWeeks(['Foundation', 'Build', 'Push', 'Recover']));
  planFor(3, 9, 'Healthy ageing, week by week', stdWeeks(['Walks', 'Strength', 'Balance', 'Review']));
  // member progress and task completion
  for (const [idx, metricRows] of [[0, [['sleep_hours', 6.5], ['sleep_hours', 7.2], ['sleep_hours', 7.7], ['energy_1_5', 3], ['energy_1_5', 4]]], [1, [['weight_kg', 84.2], ['weight_kg', 83.4], ['weight_kg', 82.9], ['resting_hr_bpm', 64], ['resting_hr_bpm', 61]]], [4, [['steps', 5200], ['steps', 6800], ['steps', 7400]]]] as Array<[number, Array<[string, number]>]>) {
    const memberId = memberIds[idx]!;
    const mctx: Ctx = { ...ctx, actor: { id: memberId, role: 'member', email: MEMBERS[idx]!.email, name: MEMBERS[idx]!.name } };
    metricRows.forEach(([metric, value], k) => plans.addProgress(mctx, { memberId, metric, value, at: addDays(now, -(metricRows.length - k) * 3), source: 'member' }));
    const tasks = plans.listTasks(mctx, memberId, { to: now.slice(0, 10) }) as Array<{ id: string }>;
    tasks.slice(0, Math.ceil(tasks.length * 0.7)).forEach((t) => plans.setTaskStatus(mctx, memberId, t.id, 'done'));
  }

  // appointments: scheduled, completed, requested, cancelled
  const nextWeekday = (daysAhead: number, minute: number) => { let d = addDays(now, daysAhead); while ([0, 6].includes(new Date(d).getUTCDay())) d = addDays(d, 1); return zonedToIso(d.slice(0, 10), minute); };
  const apt = (memberIdx: number, coachIdx: number, startAt: string, kind: 'consultation' | 'check_in' | 'review' = 'consultation') => appointments.book({ ...ctx, actor: { id: coachIds[coachIdx]!, role: 'coach', email: COACHES[coachIdx]!.email, name: COACHES[coachIdx]!.name } }, { memberId: memberIds[memberIdx]!, coachId: coachIds[coachIdx]!, startAt, kind, byCoach: true, note: 'Booked by your coach' });
  const a1 = apt(1, 1, nextWeekday(2, 18 * 60));
  const a2 = apt(0, 0, nextWeekday(3, 7 * 60 + 30), 'check_in');
  const a3 = apt(8, 0, nextWeekday(5, 17 * 60));
  const past = apt(4, 2, nextWeekday(7, 18 * 60));
  db.update('appointments', past.id, { start_at: addDays(now, -6), end_at: addMinutes(addDays(now, -6), 30) });
  appointments.complete({ ...ctx, actor: { id: coachIds[2]!, role: 'coach', email: COACHES[2]!.email, name: COACHES[2]!.name } }, past.id, 'Reviewed goals and the first plan.');
  const cancelled = apt(9, 3, nextWeekday(4, 19 * 60));
  appointments.cancel({ ...ctx, actor: { id: memberIds[9]!, role: 'member', email: MEMBERS[9]!.email, name: MEMBERS[9]!.name } }, cancelled.id, 'Travelling that week');
  void a1; void a2; void a3;

  // bloodwork: bookings through the stand-in at manual speed, then deterministic status progress via the webhook path
  const tests = db.all<{ id: string; vendor_test_id: string }>('SELECT id, vendor_test_id FROM bloodwork_tests WHERE hidden = 0');
  const testId = (v: string) => tests.find((t) => t.vendor_test_id === v)!.id;
  const bookFor = async (memberIdx: number, vendorTest: string, daysAhead: number) => {
    const m = MEMBERS[memberIdx]!;
    const mctx: Ctx = { ...ctx, actor: { id: memberIds[memberIdx]!, role: 'member', email: m.email, name: m.name } };
    const b = await bloodwork.book(mctx, services.vendor, { memberId: memberIds[memberIdx]!, testId: testId(vendorTest), slotAt: zonedToIso(addDays(now, daysAhead).slice(0, 10), 7 * 60 + 30), pincode: m.pincode, address: `${12 + memberIdx} Lake View Road`, city: m.city, state: m.state });
    await processPending(sys);
    return b;
  };
  const FORWARD = ['CREATED', 'PHLEBO_ASSIGNED', 'SAMPLE_COLLECTED', 'SAMPLE_PROCESSED', 'REPORT_DELIVERED'];
  const advance = async (bookingId: string, statuses: string[]) => {
    const b = bloodwork.getBooking(sys, bookingId);
    for (const s of statuses) { if (FORWARD.includes(s)) await services.standin!.step(b.vendorOrderId!); else await services.standin!.testWebhook(b.vendorOrderId!, s); }
    await processPending(sys);
  };
  const b1 = await bookFor(0, 'LS-FBA', 3); await advance(b1.id, ['CREATED', 'PHLEBO_ASSIGNED', 'SAMPLE_COLLECTED', 'SAMPLE_PROCESSED', 'REPORT_DELIVERED']);
  db.update('bloodwork_bookings', b1.id, { slot_at: addDays(now, -20) });
  const r1 = db.get<{ id: string }>('SELECT id FROM report_metadata WHERE booking_id = ?', [b1.id])!;
  bloodwork.reviewReport({ ...ctx, actor: { id: coachIds[0]!, role: 'coach', email: COACHES[0]!.email, name: COACHES[0]!.name } }, r1.id, { coachNote: 'Vitamin D is below the laboratory’s range; common, and worth raising with your doctor. Everything else is in range. We keep the evening walk and add two short outdoor sessions a week. Nothing here is urgent.', flagged: ['Vitamin D (25-OH) 24 ng/mL (low)', 'LDL cholesterol 112 mg/dL (high)'] });
  const b2 = await bookFor(1, 'LS-FBE', 4); await advance(b2.id, ['CREATED', 'PHLEBO_ASSIGNED', 'SAMPLE_COLLECTED', 'SAMPLE_PROCESSED', 'REPORT_DELIVERED']);
  db.update('bloodwork_bookings', b2.id, { slot_at: addDays(now, -3) });
  const b3 = await bookFor(4, 'LS-FBA', 5); await advance(b3.id, ['CREATED', 'PHLEBO_ASSIGNED', 'SAMPLE_COLLECTED', 'SAMPLE_PROCESSED']);
  const b4 = await bookFor(5, 'LS-FBE', 2); await advance(b4.id, ['CREATED', 'PHLEBO_ASSIGNED']);
  const b5 = await bookFor(6, 'LS-FBE', 4); await advance(b5.id, ['CREATED']);
  const b6 = await bookFor(8, 'LS-LIPID', 6); await advance(b6.id, ['CREATED', 'PHLEBO_ASSIGNED', 'PHLEBO_NO_SHOW']);
  void b3; void b4; void b5; void b6;

  // messages
  const say = (fromIdx: number, memberIdx: number, body: string, byCoach: boolean) => {
    const conv = messaging.conversationForMember(sys, memberIds[memberIdx]!);
    if (!conv) return;
    const actor = byCoach ? { id: coachIds[fromIdx]!, role: 'coach' as const, email: COACHES[fromIdx]!.email, name: COACHES[fromIdx]!.name } : { id: memberIds[memberIdx]!, role: 'member' as const, email: MEMBERS[memberIdx]!.email, name: MEMBERS[memberIdx]!.name };
    messaging.send({ ...ctx, actor }, conv.id, body);
  };
  // the member writes, then the coach replies: a thread lists messages in the order they were sent (staff-11)
  say(0, 0, 'Slept 7 hours for the third night running. The earlier dinner is working.', false);
  say(0, 0, 'Lovely. Keep the walk after dinner and we’ll look at the next block on Thursday.', true);
  say(1, 1, 'Got the report. The LDL line is in red, should I be worried?', false);
  say(2, 4, 'When will my coach be back? I have the results and no note yet.', false);

  // bespoke: one enquiry under review, one proposal sent
  const cp1 = customPlans.createRequest(sys, { memberId: memberIds[2]!, contactName: MEMBERS[2]!.name, contactEmail: MEMBERS[2]!.email, goals: 'A healthy-ageing plan after the Starter month: mobility, strength and two tests over six months.', duration: '6 months', budgetInr: 30000 });
  customPlans.transition(owner, cp1.id as string, 'under_review', { ownerId: adminId });
  customPlans.transition(owner, cp1.id as string, 'scoping', { scope: { services: ['coaching', 'bloodwork', 'mobility'] } });
  customPlans.transition(owner, cp1.id as string, 'awaiting_internal_approval', { proposal: { durationMonths: 6, durationLabel: '6 months', consultations: 8, bloodworkEntitlements: 2, priceInr: 27999, services: ['fortnightly coaching', 'two blood tests', 'mobility programme'], deliverables: ['Plan v1 in week 1', 'Review every 4 weeks'], reviewSchedule: 'every 4 weeks', coachId: coachIds[2]! } });
  customPlans.transition(owner, cp1.id as string, 'proposal_sent', { approval: 'Approved by the owner', note: 'Proposal sent to the member' });
  customPlans.createRequest(sys, { memberId: null, contactName: 'Meena Rajan', contactEmail: 'meena.rajan@demo.bioptime.test', contactPhone: '+919700000099', goals: 'Corporate wellness pilot for a team of twelve.', notes: 'Website enquiry' });
  enquiries.create(sys, { name: 'Nikhil Sharma', email: 'nikhil.sharma@demo.bioptime.test', purpose: 'general', message: 'Do your packages include a nutrition plan?' });

  // an operations exception that is not system-generated
  openTask(owner, { kind: 'capacity_issue', title: 'Meera Iyer is near capacity', detail: '2 pending members prefer Chennai; consider a new coach.', refType: 'user', refId: coachIds[2]! });

  // modules: every module flag on in demo mode so the demo shows every module (production keeps them off until an
  // administrator enables them at /admin/modules), then each module's own rows, in plain words (no Demo or Sample)
  if (ctx.config.isDemo) enableModulesForDemo(owner, 'initial data: every module switched on');
  for (const m of MODULES) if (m.seedDemo) await m.seedDemo({ owner, system: sys, services, ownerId, adminId, coachIds, memberIds });
  await processPending(sys);
  // the open-preview member's records (demo mode only), built on everything above
  const showcase = ctx.config.isDemo ? await seedShowcase(sys, services) : null;

  return {
    seeded: true, mode: ctx.config.BIOPTIME_MODE,
    accounts: { owner: 'owner@demo.bioptime.test', admin: 'admin@demo.bioptime.test', ...(ctx.config.isDemo ? { owners: DEMO_OWNERS.map((o) => o.email) } : {}), coaches: COACHES.map((c) => c.email), members: MEMBERS.map((m) => m.email) },
    passwords: DEMO_PASSWORDS, mfaSecret: DEMO_MFA_SECRET, showcase,
    counts: Object.fromEntries(['users', 'orders', 'programmes', 'entitlements', 'coach_assignments', 'appointments', 'coaching_plans', 'plan_tasks', 'bloodwork_bookings', 'report_metadata', 'messages', 'notifications', 'custom_plan_requests', 'support_tasks', 'audit_events', 'outbox_messages'].map((t) => [t, db.get<{ n: number }>(`SELECT COUNT(*) n FROM ${t}`)?.n ?? 0])),
    note: j.out('"Every person is fictional; every email is on the reserved .test domain; payments are simulated; the laboratory is a stand-in."', ''),
  };
}
