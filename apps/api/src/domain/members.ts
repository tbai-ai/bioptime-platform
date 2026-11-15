/* Members: profiles, resumable onboarding, consents, the home overview every client shows, and the admin directory. */
import type { Ctx } from '../context.js';
import { ids } from '../lib/ids.js';
import { ACCOUNT_TRANSITIONS } from '@bioptime/domain';
import { errors } from '../lib/errors.js';
import { j } from '../db/db.js';
import { audit, emit } from './audit.js';
import { notify } from './notifications.js';
import { openTask } from './support.js';
import { getUser, publicUser, setAccountState } from '../auth/service.js';
import { activeCoachFor } from './assignments.js';
import * as entitlements from './entitlements.js';
import { ageFromDob, dateInZone, IST_OFFSET_MINUTES } from '../lib/time.js';
import { unreadCount } from './notifications.js';
import { coachFieldPolicy } from '../auth/fieldPolicy.js';
import { shownLink } from '../adapters/meetings.js';
import { todayTotals } from './plans.js';

export const ONBOARDING_STEPS = ['profile', 'goals', 'programme_info', 'how_it_works', 'consents', 'done'] as const;

/** The next human-readable code of a family (BPC-0007, BPM-00042); taken inside the creating transaction. */
export function nextCode(ctx: Ctx, family: 'coach' | 'member'): string {
  const row = ctx.db.get<{ next: number }>('UPDATE id_sequences SET next = next + 1 WHERE name = ? RETURNING next - 1 AS next', [family]);
  if (!row) throw errors.internal('Code sequence missing');
  return family === 'coach' ? `BPC-${String(row.next).padStart(4, '0')}` : `BPM-${String(row.next).padStart(5, '0')}`;
}

export function getProfile(ctx: Ctx, userId: string) {
  const u = getUser(ctx, userId);
  if (!u || u.role !== 'member') throw errors.notFound('Member');
  const p = ctx.db.get<Record<string, unknown>>('SELECT * FROM member_profiles WHERE user_id = ?', [userId]) ?? {};
  const consents = latestConsents(ctx, userId);
  return {
    ...publicUser(u),
    profile: {
      memberCode: (p.member_code as string | null) ?? null, gender: p.gender ?? null, dateOfBirth: p.date_of_birth ?? null, city: p.city ?? null, state: p.state ?? null, pincode: p.pincode ?? null, address: p.address ?? null,
      goals: j.out<string[]>(p.goals, []), preferences: j.out<Record<string, unknown>>(p.preferences, {}), timezone: p.timezone ?? 'Asia/Kolkata',
      onboardingStep: p.onboarding_step ?? 'profile', onboardingCompletedAt: p.onboarding_completed_at ?? null,
      // 'sample' is the column's old default (0001_init.sql): shown as 'estimate', what every score is (owner decision of
      // 24 October 2026: no screen says sample)
      wellnessScore: p.wellness_score ?? null, wellnessScoreLabel: !p.wellness_score_label || p.wellness_score_label === 'sample' ? 'estimate' : p.wellness_score_label,
    },
    consents,
  };
}

export function latestConsents(ctx: Ctx, userId: string): Record<string, { granted: boolean; version: string; at: string }> {
  const out: Record<string, { granted: boolean; version: string; at: string }> = {};
  for (const r of ctx.db.all<{ kind: string; granted: number; version: string; at: string }>('SELECT kind, granted, version, at FROM member_consents WHERE user_id = ? ORDER BY at ASC', [userId])) out[r.kind] = { granted: !!r.granted, version: r.version, at: r.at };
  return out;
}

export function updateProfile(ctx: Ctx, userId: string, patch: { name?: string; phone?: string; gender?: string; dateOfBirth?: string; city?: string; state?: string; pincode?: string; address?: string; goals?: string[]; preferences?: Record<string, unknown>; timezone?: string }) {
  const u = getUser(ctx, userId);
  if (!u) throw errors.notFound('Member');
  const now = ctx.now();
  ctx.db.tx(() => {
    if (patch.name !== undefined || patch.phone !== undefined) ctx.db.update('users', userId, { name: patch.name, phone: patch.phone, phone_verified_at: patch.phone !== undefined && patch.phone !== u.phone ? null : undefined, updated_at: now });
    ctx.db.update('member_profiles', userId, {
      gender: patch.gender, date_of_birth: patch.dateOfBirth, city: patch.city, state: patch.state, pincode: patch.pincode, address: patch.address,
      goals: patch.goals ? j.in(patch.goals) : undefined, preferences: patch.preferences ? j.in(patch.preferences) : undefined, timezone: patch.timezone, updated_at: now,
    }, 'user_id');
    audit(ctx, 'member.profile_update', { type: 'user', id: userId }, null, { fields: Object.keys(patch) });
  });
  return getProfile(ctx, userId);
}

export function setConsent(ctx: Ctx, userId: string, input: { kind: string; version: string; granted: boolean }) {
  ctx.db.insert('member_consents', { id: ids.consent(), user_id: userId, kind: input.kind, version: input.version, granted: input.granted ? 1 : 0, ip: ctx.ip ?? null, at: ctx.now() });
  audit(ctx, 'consent.set', { type: 'user', id: userId }, null, input);
  return latestConsents(ctx, userId);
}

/* ---------- onboarding, resumable ---------- */
export function getOnboarding(ctx: Ctx, userId: string) {
  const p = ctx.db.get<{ onboarding_step: string; onboarding_completed_at: string | null }>('SELECT onboarding_step, onboarding_completed_at FROM member_profiles WHERE user_id = ?', [userId]);
  const progress = ctx.db.get<{ step: string; data: string; updated_at: string }>('SELECT * FROM onboarding_progress WHERE user_id = ?', [userId]);
  const user = getUser(ctx, userId)!;
  const programme = activeProgramme(ctx, userId);
  return {
    steps: ONBOARDING_STEPS,
    currentStep: p?.onboarding_step ?? 'profile',
    completedAt: p?.onboarding_completed_at ?? null,
    savedData: j.out<Record<string, unknown>>(progress?.data, {}),
    updatedAt: progress?.updated_at ?? null,
    blockers: [
      ...(user.email_verified_at ? [] : [{ code: 'EMAIL_UNVERIFIED', message: 'Verify your email to continue. We sent you a link.' }]),
      ...(user.state === 'suspended' ? [{ code: 'ACCOUNT_SUSPENDED', message: 'This account is suspended. Contact support.' }] : []),
    ],
    purchasedPackage: programme ? { programmeId: programme.id, name: programme.packageName, endAt: programme.endAt } : null,
  };
}

export function saveOnboardingStep(ctx: Ctx, userId: string, step: string, data: Record<string, unknown>) {
  const user = getUser(ctx, userId);
  if (!user) throw errors.notFound('Member');
  if (!user.email_verified_at && !ctx.config.isDemo) throw errors.forbidden('Verify your email before continuing onboarding', 'EMAIL_UNVERIFIED');
  if (!ONBOARDING_STEPS.includes(step as (typeof ONBOARDING_STEPS)[number])) throw errors.badRequest('Unknown onboarding step');
  const now = ctx.now();
  return ctx.db.tx(() => {
    const prev = ctx.db.get<{ data: string }>('SELECT data FROM onboarding_progress WHERE user_id = ?', [userId]);
    const merged = { ...j.out<Record<string, unknown>>(prev?.data, {}), [step]: data };
    ctx.db.run('INSERT INTO onboarding_progress (user_id, step, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET step = excluded.step, data = excluded.data, updated_at = excluded.updated_at', [userId, step, j.in(merged), now]);
    if (step === 'profile') {
      const d = data as { name?: string; phone?: string; gender?: string; dateOfBirth?: string; city?: string; state?: string; pincode?: string; address?: string; timezone?: string };
      updateProfile(ctx, userId, { name: d.name, phone: d.phone, gender: d.gender, dateOfBirth: d.dateOfBirth, city: d.city, state: d.state, pincode: d.pincode, address: d.address, timezone: d.timezone });
    }
    if (step === 'goals') {
      const d = data as { goals?: string[]; preferences?: Record<string, unknown> };
      updateProfile(ctx, userId, { goals: d.goals, preferences: d.preferences });
    }
    if (step === 'consents') {
      const d = data as { healthData?: boolean; coachSharing?: boolean; labConsent?: boolean; marketing?: boolean; version?: string };
      const version = d.version ?? 'onboarding-2026-10';
      if (d.healthData !== undefined) setConsent(ctx, userId, { kind: 'health_data', version, granted: !!d.healthData });
      if (d.coachSharing !== undefined) setConsent(ctx, userId, { kind: 'coach_sharing', version, granted: !!d.coachSharing });
      if (d.labConsent !== undefined) setConsent(ctx, userId, { kind: 'lab_consent', version, granted: !!d.labConsent });
      if (d.marketing !== undefined) setConsent(ctx, userId, { kind: 'marketing', version, granted: !!d.marketing });
    }
    const idx = ONBOARDING_STEPS.indexOf(step as (typeof ONBOARDING_STEPS)[number]);
    const next = step === 'done' ? 'done' : ONBOARDING_STEPS[idx + 1]!;
    ctx.db.update('member_profiles', userId, { onboarding_step: next, updated_at: now }, 'user_id');
    if (step === 'done' || next === 'done') completeOnboarding(ctx, userId);
    return getOnboarding(ctx, userId);
  });
}

export function completeOnboarding(ctx: Ctx, userId: string): void {
  const p = ctx.db.get<{ onboarding_completed_at: string | null }>('SELECT onboarding_completed_at FROM member_profiles WHERE user_id = ?', [userId]);
  if (p?.onboarding_completed_at) return;
  const consents = latestConsents(ctx, userId);
  if (!consents.health_data?.granted) throw errors.state('Onboarding needs your consent to process health information; everything else is optional.', { code: 'HEALTH_CONSENT_REQUIRED' });
  const now = ctx.now();
  ctx.db.update('member_profiles', userId, { onboarding_step: 'done', onboarding_completed_at: now, updated_at: now }, 'user_id');
  const user = getUser(ctx, userId)!;
  if (user.state === 'onboarding' || (user.state === 'pending_verification' && ctx.config.isDemo)) setAccountState({ ...ctx, actor: ctx.actor ?? { id: userId, role: 'member', email: user.email, name: user.name } }, userId, 'active', 'onboarding completed');
  emit(ctx, 'OnboardingCompleted', { type: 'user', id: userId });
  notify(ctx, { userId, category: 'welcome', title: 'You are all set', body: 'Your home screen shows what to do next. Your coach will write once assigned.', data: {} });
}

/* ---------- the overview every client shows ---------- */
/** The member's programme: of two that overlap (the next package bought in the current one's last week, or two bought
 *  before checkout refused that), the one that runs longest, so a shorter one never hides a longer one. */
export function activeProgramme(ctx: Ctx, memberId: string) {
  const p = ctx.db.get<{ id: string; status: string; start_at: string; end_at: string | null; package_version_id: string | null; custom_plan_id: string | null; order_id: string | null; name: string | null; slug: string | null; duration_label: string | null; consultations: number | null; bloodwork_entitlements: number | null; coaching: string | null }>(
    "SELECT g.*, p.name, p.slug, v.duration_label, v.consultations, v.bloodwork_entitlements, v.coaching FROM programmes g LEFT JOIN package_versions v ON v.id = g.package_version_id LEFT JOIN packages p ON p.id = v.package_id WHERE g.member_id = ? AND g.status IN ('active','paused') ORDER BY g.end_at IS NULL DESC, g.end_at DESC, g.start_at DESC LIMIT 1", [memberId]);
  if (!p) return null;
  return { id: p.id, status: p.status, startAt: p.start_at, endAt: p.end_at, orderId: p.order_id, packageName: p.name ?? 'Bespoke plan', packageSlug: p.slug ?? 'bespoke', durationLabel: p.duration_label, consultations: p.consultations, bloodworkEntitlements: p.bloodwork_entitlements, coaching: p.coaching ?? 'as_agreed', customPlanId: p.custom_plan_id };
}

/** Every package the member holds now (active or paused), longest-running first, each with its own dates: a package
 *  bought while another runs runs beside it, and each keeps its own end (GET /me programmes; programme is the first). */
export function activeProgrammes(ctx: Ctx, memberId: string) {
  return ctx.db.all<{ id: string; status: string; start_at: string; end_at: string | null; name: string | null; slug: string | null; duration_label: string | null }>(
    "SELECT g.id, g.status, g.start_at, g.end_at, p.name, p.slug, v.duration_label FROM programmes g LEFT JOIN package_versions v ON v.id = g.package_version_id LEFT JOIN packages p ON p.id = v.package_id WHERE g.member_id = ? AND g.status IN ('active','paused') ORDER BY g.end_at IS NULL DESC, g.end_at DESC, g.start_at DESC", [memberId])
    .map((p) => ({ id: p.id, status: p.status, packageName: p.name ?? 'Bespoke plan', packageSlug: p.slug ?? 'bespoke', durationLabel: p.duration_label, startAt: p.start_at, endAt: p.end_at }));
}

/** A raw appointments row (SELECT a.*) made fit to send: its meeting link goes through the same rule as
 *  appointments.present (shownLink): only a scheduled appointment carries one, and an old placeholder link or a link
 *  with whitespace or a control character is null. Used here for GET /me (and the coach and admin views built on
 *  memberOverview) and by coachHome's appointment lists. */
export function safeAppointmentRow<T extends Record<string, unknown> | null | undefined>(a: T): T {
  return (a ? { ...a, meeting_link: a.status === 'scheduled' ? shownLink(a.meeting_link as string | null | undefined) : null } : a) as T;
}

/** today: the member's own steps and water today (GET /me only). The coach and administrator views are built on this
 *  overview and leave it out: health values reach a coach only through the routes that check the sharing consent. */
export function memberOverview(ctx: Ctx, memberId: string, opts: { today?: boolean } = {}) {
  const profile = getProfile(ctx, memberId);
  const programme = activeProgramme(ctx, memberId);
  const coach = activeCoachFor(ctx, memberId);
  const pendingRequest = ctx.db.get<{ status: string }>("SELECT status FROM assignment_requests WHERE member_id = ? AND status IN ('open','exception') ORDER BY created_at DESC LIMIT 1", [memberId]);
  const nextAppointment = safeAppointmentRow(ctx.db.get<Record<string, unknown>>("SELECT a.*, c.name AS coach_name FROM appointments a LEFT JOIN users c ON c.id = a.coach_id WHERE a.member_id = ? AND a.status IN ('requested','scheduled') AND a.start_at >= ? ORDER BY a.start_at LIMIT 1", [memberId, ctx.now()]));
  const latestBooking = ctx.db.get<Record<string, unknown>>('SELECT b.id, b.reference, b.status, b.slot_at, b.flag, t.name AS test_name FROM bloodwork_bookings b JOIN bloodwork_tests t ON t.id = b.test_id WHERE b.member_id = ? ORDER BY b.created_at DESC LIMIT 1', [memberId]);
  // the Today card (app-8, portal-m1): days are India days (Asia/Kolkata). Tasks due today come first, then overdue
  // pending tasks, newest first, six at most; each says whether it is overdue, and todaysActionsTotal counts every
  // pending task due today or earlier, so the card never shows the six oldest overdue tasks as "today" or undercounts
  const today = dateInZone(ctx.now());
  const dueDay = `date(t.due_at, '+${IST_OFFSET_MINUTES} minutes')`;
  const dueByToday = `t.member_id = ? AND v.status = 'published' AND t.status = 'pending' AND (t.due_at IS NULL OR ${dueDay} <= ?)`;
  const tasks = ctx.db.all<Record<string, unknown> & { overdue: number }>(`SELECT t.id, t.title, t.kind, t.status, t.due_at, t.week, t.day, CASE WHEN t.due_at IS NOT NULL AND ${dueDay} < ? THEN 1 ELSE 0 END AS overdue FROM plan_tasks t JOIN coaching_plan_versions v ON v.id = t.plan_version_id WHERE ${dueByToday} ORDER BY overdue, CASE WHEN overdue = 1 THEN t.due_at END DESC, t.due_at IS NULL, t.due_at, t.sort LIMIT 6`, [today, memberId, today])
    .map((t) => ({ ...t, overdue: t.overdue === 1 }));
  const todaysActionsTotal = ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM plan_tasks t JOIN coaching_plan_versions v ON v.id = t.plan_version_id WHERE ${dueByToday}`, [memberId, today])?.n ?? 0;
  const upcomingTasks = ctx.db.all<Record<string, unknown>>(`SELECT t.id, t.title, t.kind, t.status, t.due_at FROM plan_tasks t JOIN coaching_plan_versions v ON v.id = t.plan_version_id WHERE t.member_id = ? AND v.status = 'published' AND ${dueDay} > ? AND t.status = 'pending' ORDER BY t.due_at, t.sort LIMIT 6`, [memberId, today]);
  const progress = ctx.db.all<Record<string, unknown>>('SELECT metric, value, unit, at, source FROM progress_entries WHERE member_id = ? ORDER BY at DESC LIMIT 8', [memberId]);
  const plan = ctx.db.get<{ id: string; title: string; current_version: number; updated_at: string }>("SELECT id, title, current_version, updated_at FROM coaching_plans WHERE member_id = ? AND status = 'published' ORDER BY updated_at DESC LIMIT 1", [memberId]);
  const taskStats = ctx.db.get<{ total: number; done: number }>("SELECT COUNT(*) total, SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) done FROM plan_tasks t JOIN coaching_plan_versions v ON v.id = t.plan_version_id WHERE t.member_id = ? AND v.status = 'published'", [memberId]);
  const unreadMessages = ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.member_id = ? AND m.sender_id != ? AND m.read_at IS NULL', [memberId, memberId])?.n ?? 0;
  return {
    member: { id: profile.id, name: profile.name, email: profile.email, state: profile.state, memberCode: profile.profile.memberCode ?? null, onboardingCompleted: !!profile.profile.onboardingCompletedAt, wellnessScore: profile.profile.wellnessScore, wellnessScoreLabel: profile.profile.wellnessScoreLabel },
    programme,
    programmes: activeProgrammes(ctx, memberId),
    entitlements: programme ? { bloodwork: entitlements.balanceByExpiry(ctx, memberId, 'bloodwork'), consultation: entitlements.balanceByExpiry(ctx, memberId, 'consultation') } : null,
    coach,
    assignmentStatus: coach ? coach.status : pendingRequest ? (pendingRequest.status === 'exception' ? 'needs_attention' : 'pending') : (programme && programme.coaching !== 'none' ? 'pending' : 'none'),
    nextAppointment,
    bloodwork: latestBooking,
    plan: plan ? { ...plan, tasksTotal: taskStats?.total ?? 0, tasksDone: taskStats?.done ?? 0 } : null,
    todaysActions: tasks,
    todaysActionsTotal,
    upcomingTasks,
    recentProgress: progress,
    unread: { notifications: unreadCount(ctx, memberId), messages: unreadMessages },
    ...(opts.today ? { today: todayTotals(ctx, memberId) } : {}),
    demo: ctx.config.isDemo,
  };
}

/* ---------- admin directory ---------- */
export function listMembers(ctx: Ctx, opts: { q?: string; state?: string; packageSlug?: string; coachId?: string; limit: number; includePhone?: boolean }) {
  const where: string[] = ["u.role = 'member'"];
  const params: (string | number)[] = [];
  // the phone is searched only for callers who may see it: otherwise which rows come back would spell the number out
  if (opts.q) { const like = `%${opts.q}%`; if (opts.includePhone) { where.push('(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)'); params.push(like, like, like); } else { where.push('(u.name LIKE ? OR u.email LIKE ?)'); params.push(like, like); } }
  if (opts.state) { where.push('u.state = ?'); params.push(opts.state); }
  if (opts.coachId) { where.push("u.id IN (SELECT member_id FROM coach_assignments WHERE coach_id = ? AND status IN ('active','paused'))"); params.push(opts.coachId); }
  if (opts.packageSlug) { where.push("u.id IN (SELECT g.member_id FROM programmes g JOIN package_versions v ON v.id = g.package_version_id JOIN packages p ON p.id = v.package_id WHERE p.slug = ? AND g.status = 'active')"); params.push(opts.packageSlug); }
  const rows = ctx.db.all<Record<string, unknown>>(`SELECT u.id, u.name, u.email, u.phone, u.state, u.created_at, u.last_login_at, p.city, p.goals, p.onboarding_completed_at,
      (SELECT pk.name FROM programmes g JOIN package_versions v ON v.id = g.package_version_id JOIN packages pk ON pk.id = v.package_id WHERE g.member_id = u.id AND g.status = 'active' ORDER BY g.start_at DESC LIMIT 1) AS package_name,
      (SELECT g.end_at FROM programmes g WHERE g.member_id = u.id AND g.status = 'active' ORDER BY g.start_at DESC LIMIT 1) AS programme_end_at,
      (SELECT c.name FROM coach_assignments a JOIN users c ON c.id = a.coach_id WHERE a.member_id = u.id AND a.status IN ('active','paused') ORDER BY a.created_at DESC LIMIT 1) AS coach_name,
      (SELECT a.coach_id FROM coach_assignments a WHERE a.member_id = u.id AND a.status IN ('active','paused') ORDER BY a.created_at DESC LIMIT 1) AS coach_id,
      (SELECT a.status FROM coach_assignments a WHERE a.member_id = u.id AND a.status IN ('active','paused') ORDER BY a.created_at DESC LIMIT 1) AS assignment_status
    FROM users u LEFT JOIN member_profiles p ON p.user_id = u.id WHERE ${where.join(' AND ')} ORDER BY u.created_at DESC LIMIT ?`, [...params, opts.limit]);
  return rows.map((r) => ({ ...r, goals: j.out(r.goals, []), phone: maskPhone(r.phone as string | null) }));
}

/** The coach's client list: one row per assigned member with what coaching needs and nothing restricted (no email, phone, address). */
export function listClientsForCoach(ctx: Ctx, coachId: string, opts: { q?: string; status?: string; sort?: string; page?: number; limit?: number }) {
  const showCity = coachFieldPolicy(ctx).city; // the administrator's switch applies to the list as to the record
  const where: string[] = ["u.role = 'member'", "a.coach_id = ?", "a.status IN ('active','paused','ended')"];
  const params: (string | number)[] = [coachId];
  if (opts.q) { where.push('(u.name LIKE ? OR p.member_code LIKE ?)'); const like = `%${opts.q}%`; params.push(like, like); }
  if (opts.status && opts.status !== 'all') { where.push('a.status = ?'); params.push(opts.status); } else if (!opts.status) { where.push("a.status IN ('active','paused')"); }
  const orders: Record<string, string> = Object.assign(Object.create(null), { name: 'u.name', recent: 'last_check_in DESC NULLS LAST', ends: 'programme_end_at ASC NULLS LAST', next: 'next_appointment_at ASC NULLS LAST', progress: 'tasks_done DESC' });
  const order = Object.hasOwn(orders, opts.sort ?? 'name') ? orders[opts.sort ?? 'name']! : 'u.name';
  const limit = Math.min(100, Math.max(1, opts.limit ?? 25)); const page = Math.max(1, opts.page ?? 1);
  const now = ctx.now();
  const sql = `SELECT u.id, u.name, u.state AS account_state, p.member_code, p.city, p.goals, p.gender, p.date_of_birth, p.onboarding_completed_at,
      a.id AS assignment_id, a.status AS assignment_status, a.effective_at AS assigned_at,
      g.id AS programme_id, g.status AS programme_status, g.start_at AS programme_start_at, g.end_at AS programme_end_at, pk.name AS package_name,
      (SELECT MIN(ap.start_at) FROM appointments ap WHERE ap.member_id = u.id AND ap.status IN ('requested','scheduled') AND ap.start_at >= ?) AS next_appointment_at,
      (SELECT COUNT(*) FROM plan_tasks t WHERE t.member_id = u.id AND t.status = 'pending' AND t.due_at < ?) AS tasks_overdue,
      (SELECT COUNT(*) FROM plan_tasks t WHERE t.member_id = u.id AND t.status = 'pending') AS tasks_pending,
      (SELECT COUNT(*) FROM plan_tasks t WHERE t.member_id = u.id AND t.status = 'done') AS tasks_done,
      (SELECT COUNT(*) FROM plan_tasks t WHERE t.member_id = u.id AND t.due_at < ?) AS tasks_due,
      (SELECT MAX(x.at) FROM (SELECT pe.at FROM progress_entries pe WHERE pe.member_id = u.id AND EXISTS (SELECT 1 FROM member_consents mc WHERE mc.user_id = u.id AND mc.kind = 'coach_sharing' AND mc.granted = 1 AND mc.at = (SELECT MAX(at) FROM member_consents m2 WHERE m2.user_id = u.id AND m2.kind = 'coach_sharing')) UNION ALL SELECT ms.created_at AS at FROM messages ms WHERE ms.sender_id = u.id UNION ALL SELECT t.completed_at AS at FROM plan_tasks t WHERE t.member_id = u.id AND t.completed_at IS NOT NULL) x) AS last_check_in,
      (SELECT b.status FROM bloodwork_bookings b WHERE b.member_id = u.id ORDER BY b.created_at DESC LIMIT 1) AS bloodwork_status,
      (SELECT COUNT(*) FROM report_metadata r WHERE r.member_id = u.id AND r.reviewed_at IS NULL) AS reports_to_review,
      EXISTS (SELECT 1 FROM member_consents mc WHERE mc.user_id = u.id AND mc.kind = 'coach_sharing' AND mc.granted = 1 AND mc.at = (SELECT MAX(at) FROM member_consents m2 WHERE m2.user_id = u.id AND m2.kind = 'coach_sharing')) AS health_shared,
      (SELECT COUNT(*) FROM coaching_plans cp WHERE cp.member_id = u.id AND cp.status = 'published') AS published_plans
    FROM coach_assignments a JOIN users u ON u.id = a.member_id LEFT JOIN member_profiles p ON p.user_id = u.id
    LEFT JOIN programmes g ON g.id = (SELECT g2.id FROM programmes g2 WHERE g2.member_id = u.id AND g2.status IN ('active','paused') ORDER BY g2.start_at DESC LIMIT 1)
    LEFT JOIN package_versions v ON v.id = g.package_version_id LEFT JOIN packages pk ON pk.id = v.package_id
    WHERE ${where.join(' AND ')}`;
  const total = ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM (${sql})`, [now, now, now, ...params])?.n ?? 0;
  const rows = ctx.db.all<Record<string, unknown>>(`${sql} ORDER BY ${order}, u.name LIMIT ? OFFSET ?`, [now, now, now, ...params, limit, (page - 1) * limit]);
  const weekAgo = new Date(Date.parse(now) - 7 * 86400000).toISOString();
  return {
    items: rows.map((r) => {
      const dob = r.date_of_birth as string | null;
      const due = Number(r.tasks_due ?? 0), done = Number(r.tasks_done ?? 0);
      const last = r.last_check_in as string | null;
      return {
        id: r.id, name: r.name, memberCode: r.member_code ?? null, accountState: r.account_state, age: dob ? ageFromDob(dob, now) : null, gender: r.gender ?? null, ...(showCity ? { city: r.city ?? null } : {}), goals: j.out(r.goals, []),
        onboardingCompleted: !!r.onboarding_completed_at,
        assignment: { id: r.assignment_id, status: r.assignment_status, since: r.assigned_at },
        programme: r.programme_id ? { id: r.programme_id, status: r.programme_status, packageName: r.package_name, startAt: r.programme_start_at, endAt: r.programme_end_at } : null,
        progress: { tasksDue: due, tasksDone: done, completionPct: due ? Math.round((100 * Math.min(done, due)) / due) : null, tasksPending: Number(r.tasks_pending ?? 0), tasksOverdue: Number(r.tasks_overdue ?? 0), hasPlan: Number(r.published_plans ?? 0) > 0 },
        nextAppointmentAt: r.next_appointment_at ?? null, lastCheckInAt: last, healthShared: !!r.health_shared, bloodworkStatus: r.health_shared ? r.bloodwork_status ?? null : null, reportsToReview: r.health_shared ? Number(r.reports_to_review ?? 0) : 0,
        engagement: last && last >= weekAgo ? 'active' : last ? 'quiet' : 'new',
      };
    }),
    page, limit, total,
  };
}

export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  return phone.length > 4 ? phone.slice(0, 3) + '•'.repeat(Math.max(2, phone.length - 7)) + phone.slice(-4) : phone;
}

/** What POST /me/data-requests answers the member: their request as stored, column by column (never SELECT *, so a
 *  column added later, or the team's note kept in data_request_admin_notes, cannot reach them). */
const DATA_REQUEST_FOR_MEMBER = 'SELECT id, user_id, kind, status, note, file_id, created_at, completed_at FROM data_requests WHERE id = ?';

/** One open request per kind. All of it happens in one transaction, so a refused step leaves no half-made request.
 *  A deletion request moves the account to deletion_requested where that state change is allowed (an active or
 *  deactivated account); an account still being set up keeps its state, and the team still gets the task. */
export function requestData(ctx: Ctx, userId: string, kind: 'export' | 'deletion', note?: string) {
  return ctx.db.tx(() => {
    const taskTitle = kind === 'export' ? 'Data export requested' : 'Account deletion requested';
    const open = ctx.db.get<{ id: string }>("SELECT id FROM data_requests WHERE user_id = ? AND kind = ? AND status IN ('requested','in_progress')", [userId, kind]);
    if (open) {
      // an open request always has a team task (one may be missing if it was made before this rule)
      const task = ctx.db.get("SELECT 1 FROM support_tasks WHERE ref_type = 'data_request' AND ref_id = ?", [open.id]);
      if (!task) openTask(ctx, { kind: 'data_request', title: taskTitle, detail: `Member ${userId}.`, refType: 'data_request', refId: open.id });
      return ctx.db.get(DATA_REQUEST_FOR_MEMBER, [open.id]);
    }
    const id = ids.dataRequest();
    ctx.db.insert('data_requests', { id, user_id: userId, kind, status: 'requested', note: note ?? null, created_at: ctx.now() });
    if (kind === 'deletion') {
      const user = getUser(ctx, userId);
      if (user && ACCOUNT_TRANSITIONS[user.state].includes('deletion_requested')) setAccountState(ctx, userId, 'deletion_requested', 'member requested deletion');
    }
    openTask(ctx, { kind: 'data_request', title: taskTitle, detail: `Member ${userId}. ${note ?? ''}`, refType: 'data_request', refId: id });
    audit(ctx, `data_request.${kind}`, { type: 'user', id: userId }, note ?? null);
    return ctx.db.get(DATA_REQUEST_FOR_MEMBER, [id]);
  });
}
