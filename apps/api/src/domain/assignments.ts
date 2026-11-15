/* The hybrid coach assignment engine: an activation opens a request, the rule recommends with reasons, the policy
   (auto or manual) decides whether the system assigns or an administrator confirms. Every change is recorded. */
import type { Ctx } from '../context.js';
import { ids } from '../lib/ids.js';
import { errors } from '../lib/errors.js';
import { j } from '../db/db.js';
import { audit, emit } from './audit.js';
import { notify } from './notifications.js';
import { openTask, updateTask } from './support.js';
import { getSetting } from './settings.js';

export type CoachCandidate = { coachId: string; name: string; score: number; eligible: boolean; reasons: string[]; caseload: number; caseloadLimit: number; available: boolean };

type CoachRow = { user_id: string; display_name: string; expertise: string; languages: string; city: string | null; caseload_limit: number; available: number; unavailable_until: string | null; scope: string; state: string };

export function recommend(ctx: Ctx, memberId: string, programmeId: string | null): CoachCandidate[] {
  const member = ctx.db.get<{ id: string; city: string | null; goals: string; preferences: string }>('SELECT u.id, p.city, p.goals, p.preferences FROM users u LEFT JOIN member_profiles p ON p.user_id = u.id WHERE u.id = ?', [memberId]);
  if (!member) throw errors.notFound('Member');
  const goals = j.out<string[]>(member.goals, []).join(' ').toLowerCase();
  const prefs = j.out<{ language?: string }>(member.preferences, {});
  const version = programmeId ? ctx.db.get<{ bloodwork_entitlements: number; coaching: string; package_slug: string; kind: string }>('SELECT v.bloodwork_entitlements, v.coaching, p.slug AS package_slug, p.kind FROM programmes g JOIN package_versions v ON v.id = g.package_version_id JOIN packages p ON p.id = v.package_id WHERE g.id = ?', [programmeId]) : undefined;
  const custom = programmeId ? !!ctx.db.get('SELECT 1 FROM programmes WHERE id = ? AND custom_plan_id IS NOT NULL', [programmeId]) : false;
  const previous = ctx.db.get<{ coach_id: string }>("SELECT coach_id FROM coach_assignments WHERE member_id = ? AND coach_id IS NOT NULL AND status = 'ended' ORDER BY ended_at DESC LIMIT 1", [memberId]);
  const coaches = ctx.db.all<CoachRow>("SELECT c.*, u.state FROM coach_profiles c JOIN users u ON u.id = c.user_id WHERE u.role = 'coach'");
  const loads = new Map<string, number>();
  for (const r of ctx.db.all<{ coach_id: string; n: number }>("SELECT coach_id, COUNT(*) n FROM coach_assignments WHERE status = 'active' GROUP BY coach_id")) loads.set(r.coach_id, r.n);
  const now = ctx.now();
  return coaches.map((c) => {
    const reasons: string[] = [];
    let score = 0, eligible = true;
    const load = loads.get(c.user_id) ?? 0;
    const expertise = j.out<string[]>(c.expertise, []);
    const languages = j.out<string[]>(c.languages, []);
    if (c.state !== 'active') { reasons.push(`account ${c.state}`); score -= 1000; eligible = false; }
    const away = !c.available || (c.unavailable_until && c.unavailable_until > now);
    if (away) { reasons.push('unavailable' + (c.unavailable_until ? ' until ' + c.unavailable_until.slice(0, 10) : '')); score -= 100; eligible = false; }
    else { reasons.push('available'); score += 20; }
    if (c.caseload_limit > 0) {
      const room = c.caseload_limit - load;
      if (room <= 0) { reasons.push(`caseload full (${load}/${c.caseload_limit})`); score -= 50; eligible = false; }
      else { reasons.push(`caseload ${load}/${c.caseload_limit}`); score += Math.round(30 * room / c.caseload_limit); }
    }
    const hits = expertise.filter((e) => goals.includes(e.toLowerCase()));
    if (version && version.bloodwork_entitlements > 0 && expertise.includes('bloodwork')) hits.push('bloodwork');
    if ((version?.package_slug === 'advanced' || custom) && expertise.includes('longevity')) hits.push('longevity');
    if (hits.length) { reasons.push('expertise: ' + [...new Set(hits)].join(', ')); score += 15 * new Set(hits).size; }
    if (member.city && c.city === member.city) { reasons.push('same city'); score += 5; }
    if (prefs.language && languages.map((l) => l.toLowerCase()).includes(prefs.language.toLowerCase())) { reasons.push(`speaks ${prefs.language}`); score += 10; }
    if (previous && previous.coach_id === c.user_id) { reasons.push('continuity: coached this member before'); score += 25; }
    return { coachId: c.user_id, name: c.display_name, score, eligible, reasons, caseload: load, caseloadLimit: c.caseload_limit, available: !away };
  }).sort((a, b) => b.score - a.score);
}

/** Opens a request after activation; auto policy assigns when one eligible coach leads clearly, otherwise it waits for an administrator. */
export function createRequest(ctx: Ctx, input: { memberId: string; programmeId: string | null; orderId: string | null }): { requestId: string; status: string; assignmentId?: string } {
  return ctx.db.tx(() => {
    if (input.programmeId) {
      const existing = ctx.db.get<{ id: string; status: string }>("SELECT id, status FROM assignment_requests WHERE programme_id = ? AND status IN ('open','assigned','exception')", [input.programmeId]);
      if (existing) return { requestId: existing.id, status: existing.status };
    }
    const policy = String(getSetting(ctx, 'assignment_policy'));
    const candidates = recommend(ctx, input.memberId, input.programmeId);
    const id = ids.assignmentRequest();
    const now = ctx.now();
    const eligible = candidates.filter((c) => c.eligible);
    ctx.db.insert('assignment_requests', { id, member_id: input.memberId, programme_id: input.programmeId, order_id: input.orderId, status: 'open', policy, recommendation: j.in(candidates.slice(0, 8)), reason: null, created_at: now });
    emit(ctx, 'AssignmentRequested', { type: 'assignment_request', id }, { memberId: input.memberId, policy, eligible: eligible.length });
    audit(ctx, 'assignment.requested', { type: 'assignment_request', id }, null, { policy, top: candidates[0]?.coachId ?? null });
    if (!eligible.length) {
      ctx.db.update('assignment_requests', id, { status: 'exception', reason: 'No eligible coach: ' + (candidates[0]?.reasons.join(', ') ?? 'no coaches') });
      openTask(ctx, { kind: 'unassigned_member', title: 'No eligible coach for a new member', detail: `Request ${id}: ${candidates.length ? candidates.map((c) => `${c.name}: ${c.reasons.join(', ')}`).join(' · ') : 'no coaches exist'}`, refType: 'assignment_request', refId: id });
      return { requestId: id, status: 'exception' };
    }
    const top = eligible[0]!;
    const second = eligible[1];
    if (policy === 'auto' && (!second || top.score - second.score >= 10)) {
      const a = assign(ctx, { requestId: id, coachId: top.coachId, method: 'rule', reason: `Rule: ${top.reasons.join(', ')}` });
      return { requestId: id, status: 'assigned', assignmentId: String(a.id) };
    }
    openTask(ctx, { kind: 'unassigned_member', title: policy === 'auto' ? 'Two coaches scored closely: confirm the assignment' : 'Confirm a coach for a new member', detail: `Recommended: ${top.name} (${top.reasons.join(', ')})`, refType: 'assignment_request', refId: id });
    return { requestId: id, status: 'open' };
  });
}

export function assign(ctx: Ctx, input: { requestId?: string; memberId?: string; programmeId?: string | null; coachId: string; method: 'rule' | 'manual' | 'override'; reason: string }) {
  return ctx.db.tx(() => {
    const req = input.requestId ? ctx.db.get<{ id: string; member_id: string; programme_id: string | null; status: string }>('SELECT * FROM assignment_requests WHERE id = ?', [input.requestId]) : undefined;
    if (input.requestId && !req) throw errors.notFound('Assignment request');
    const memberId = req?.member_id ?? input.memberId;
    const programmeId = req?.programme_id ?? input.programmeId ?? null;
    if (!memberId) throw errors.badRequest('memberId is required');
    const client = ctx.db.get<{ role: string }>('SELECT role FROM users WHERE id = ?', [memberId]);
    if (!client || client.role !== 'member') throw errors.notFound('Member'); // owners, administrators and coaches are never a coach's client
    const coach = ctx.db.get<{ user_id: string; display_name: string; available: number; caseload_limit: number; state: string }>("SELECT c.user_id, c.display_name, c.available, c.caseload_limit, u.state FROM coach_profiles c JOIN users u ON u.id = c.user_id WHERE c.user_id = ? AND u.role = 'coach'", [input.coachId]);
    if (!coach) throw errors.notFound('Coach');
    if (coach.state !== 'active') throw errors.state(`That coach's account is ${coach.state}`);
    if (input.method !== 'override') {
      const load = ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM coach_assignments WHERE coach_id = ? AND status = 'active'", [input.coachId])?.n ?? 0;
      if (!coach.available) throw errors.state('That coach is unavailable; use an override with a reason if you must', { code: 'COACH_UNAVAILABLE' });
      if (coach.caseload_limit > 0 && load >= coach.caseload_limit) throw errors.state('That coach is at capacity; use an override with a reason if you must', { code: 'COACH_FULL' });
    }
    if (!input.reason) throw errors.badRequest('A reason is required', 'REASON_REQUIRED');
    const now = ctx.now();
    const previous = ctx.db.all<{ id: string; coach_id: string | null }>("SELECT id, coach_id FROM coach_assignments WHERE member_id = ? AND (programme_id = ? OR (? IS NULL AND programme_id IS NULL)) AND status IN ('active','paused','pending')", [memberId, programmeId, programmeId]);
    for (const p of previous) ctx.db.update('coach_assignments', p.id, { status: 'ended', ended_at: now, pause_cause: null });
    const id = ids.assignment();
    ctx.db.insert('coach_assignments', { id, member_id: memberId, coach_id: input.coachId, programme_id: programmeId, request_id: req?.id ?? null, status: 'active', method: input.method, reason: input.reason, effective_at: now, created_by: ctx.actor?.id ?? 'system', created_at: now });
    if (req) ctx.db.update('assignment_requests', req.id, { status: 'assigned', resolved_at: now, resolved_by: ctx.actor?.id ?? 'system', reason: input.reason });
    const open = ctx.db.get<{ id: string }>("SELECT id FROM support_tasks WHERE kind = 'unassigned_member' AND ref_type = 'assignment_request' AND ref_id = ? AND status IN ('open','in_progress')", [req?.id ?? '']);
    if (open) updateTask({ ...ctx }, open.id, { status: 'resolved', resolution: `Assigned to ${coach.display_name}` });
    ensureConversation(ctx, memberId, input.coachId);
    const member = ctx.db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', [memberId]);
    notify(ctx, { userId: input.coachId, category: 'coach_assignment', title: 'New client assigned', body: `${member?.name ?? 'A member'} is now on your caseload. ${previous.length ? 'This replaces a previous assignment.' : ''}`.trim(), data: { memberId, assignmentId: id } });
    notify(ctx, { userId: memberId, category: 'coach_assignment', title: 'Meet your coach', body: `${coach.display_name} is your Bioptime coach. Say hello in Messages and book your first consultation.`, data: { coachId: input.coachId, assignmentId: id } });
    emit(ctx, 'CoachAssigned', { type: 'coach_assignment', id }, { memberId, coachId: input.coachId, method: input.method });
    audit(ctx, previous.length ? 'assignment.reassigned' : 'assignment.confirmed', { type: 'coach_assignment', id }, input.reason, { memberId, coachId: input.coachId, method: input.method, endedPrevious: previous.map((p) => p.id) });
    return getAssignment(ctx, id);
  });
}

export function ensureConversation(ctx: Ctx, memberId: string, coachId: string): string {
  const existing = ctx.db.get<{ id: string }>('SELECT id FROM conversations WHERE member_id = ? AND coach_id = ?', [memberId, coachId]);
  if (existing) return existing.id;
  const id = ids.conversation();
  ctx.db.insert('conversations', { id, member_id: memberId, coach_id: coachId, created_at: ctx.now() });
  return id;
}

/** Why an assignment is paused (coach_assignments.pause_cause, migration 0038): the coach's account state, the coach
 *  being away, or an administrator's pause. Only the cause that paused an assignment resumes it by itself. */
export type PauseCause = 'coach_account' | 'coach_away' | 'manual';

export function pauseAssignment(ctx: Ctx, id: string, reason: string) { return setAssignmentStatus(ctx, id, 'paused', reason, 'manual'); }
export function resumeAssignment(ctx: Ctx, id: string, reason: string) { return setAssignmentStatus(ctx, id, 'active', reason); }
export function endAssignment(ctx: Ctx, id: string, reason: string) { return setAssignmentStatus(ctx, id, 'ended', reason); }

function setAssignmentStatus(ctx: Ctx, id: string, to: 'paused' | 'active' | 'ended', reason: string, cause: PauseCause = 'manual') {
  const a = ctx.db.get<{ id: string; status: string; member_id: string; coach_id: string | null; pause_cause: string | null }>('SELECT * FROM coach_assignments WHERE id = ?', [id]);
  if (!a) throw errors.notFound('Assignment');
  if (!reason) throw errors.badRequest('A reason is required', 'REASON_REQUIRED');
  const allowed: Record<string, string[]> = { pending: ['ended'], active: ['paused', 'ended'], paused: ['active', 'ended'], ended: [] };
  if (!allowed[a.status]?.includes(to)) throw errors.state(`An assignment that is ${a.status} cannot become ${to}`);
  ctx.db.update('coach_assignments', id, { status: to, ended_at: to === 'ended' ? ctx.now() : null, reason, pause_cause: to === 'paused' ? cause : null });
  audit(ctx, `assignment.${to}`, { type: 'coach_assignment', id }, reason, to === 'paused' ? { cause } : a.status === 'paused' ? { pausedFor: a.pause_cause ?? 'manual' } : {});
  if (to === 'paused') notify(ctx, { userId: a.member_id, category: 'coach_assignment', title: 'Your coach is away', body: 'Your plan and bookings stay as they are. Messages wait for your coach, and Bioptime can reassign you if needed.', data: { assignmentId: id } });
  if (to === 'active') notify(ctx, { userId: a.member_id, category: 'coach_assignment', title: 'Your coach is back', body: 'Coaching continues as before.', data: { assignmentId: id } });
  return getAssignment(ctx, id);
}

export function getAssignment(ctx: Ctx, id: string) {
  const a = ctx.db.get<Record<string, unknown>>('SELECT a.*, m.name AS member_name, c.name AS coach_name FROM coach_assignments a JOIN users m ON m.id = a.member_id LEFT JOIN users c ON c.id = a.coach_id WHERE a.id = ?', [id]);
  if (!a) throw errors.notFound('Assignment');
  return a;
}

export function listRequests(ctx: Ctx, status?: string) {
  const rows = ctx.db.all<Record<string, unknown> & { recommendation: string }>(`SELECT r.*, m.name AS member_name, m.email AS member_email FROM assignment_requests r JOIN users m ON m.id = r.member_id ${status ? 'WHERE r.status = ?' : ''} ORDER BY r.created_at DESC LIMIT 200`, status ? [status] : []);
  return rows.map((r) => ({ ...r, recommendation: j.out(r.recommendation, []) }));
}

export function listAssignments(ctx: Ctx, opts: { coachId?: string; memberId?: string; status?: string }) {
  const where: string[] = [];
  const params: string[] = [];
  if (opts.coachId) { where.push('a.coach_id = ?'); params.push(opts.coachId); }
  if (opts.memberId) { where.push('a.member_id = ?'); params.push(opts.memberId); }
  if (opts.status) { where.push('a.status = ?'); params.push(opts.status); }
  return ctx.db.all('SELECT a.*, m.name AS member_name, c.name AS coach_name FROM coach_assignments a JOIN users m ON m.id = a.member_id LEFT JOIN users c ON c.id = a.coach_id ' + (where.length ? 'WHERE ' + where.join(' AND ') : '') + ' ORDER BY a.created_at DESC LIMIT 500', params);
}

export function activeCoachFor(ctx: Ctx, memberId: string): { coachId: string; assignmentId: string; status: string; displayName: string; name: string; expertise: string[]; bio: string | null; city: string | null } | null {
  const a = ctx.db.get<{ id: string; coach_id: string; status: string; display_name: string; name: string; expertise: string; bio: string | null; city: string | null }>("SELECT a.id, a.coach_id, a.status, c.display_name, u.name, c.expertise, c.bio, c.city FROM coach_assignments a JOIN coach_profiles c ON c.user_id = a.coach_id JOIN users u ON u.id = a.coach_id WHERE a.member_id = ? AND a.status IN ('active','paused') ORDER BY a.created_at DESC LIMIT 1", [memberId]);
  return a ? { coachId: a.coach_id, assignmentId: a.id, status: a.status, displayName: a.display_name, name: a.name, expertise: j.out(a.expertise, []), bio: a.bio, city: a.city } : null;
}

/** Is the coach away now (marked away, or inside an away period)? */
function coachAway(ctx: Ctx, coachId: string): boolean {
  const c = ctx.db.get<{ available: number; unavailable_until: string | null }>('SELECT available, unavailable_until FROM coach_profiles WHERE user_id = ?', [coachId]);
  return !!c && (!c.available || (!!c.unavailable_until && c.unavailable_until > ctx.now()));
}

function coachAccountActive(ctx: Ctx, coachId: string): boolean {
  return ctx.db.get<{ state: string }>('SELECT state FROM users WHERE id = ?', [coachId])?.state === 'active';
}

/** Paused assignments of a coach held by one cause (oldest first). */
function pausedFor(ctx: Ctx, coachId: string, cause: PauseCause): string[] {
  return ctx.db.all<{ id: string }>("SELECT id FROM coach_assignments WHERE coach_id = ? AND status = 'paused' AND pause_cause = ? ORDER BY created_at", [coachId, cause]).map((r) => r.id);
}

/** When a coach goes away, their active assignments pause (cause coach_away); when they return, the assignments the
 *  away mark paused resume and their members are told the coach is back. Assignments an administrator paused, or that
 *  the coach's account state paused, stay as they are. A coach who returns while their account is not active resumes
 *  nothing: those assignments now wait for the account's reactivation (their cause becomes coach_account). Returns how
 *  many assignments paused or resumed. */
export function onCoachAvailabilityChanged(ctx: Ctx, coachId: string, available: boolean, reason: string): number {
  if (!available) {
    const rows = ctx.db.all<{ id: string }>("SELECT id FROM coach_assignments WHERE coach_id = ? AND status = 'active'", [coachId]);
    for (const r of rows) setAssignmentStatus(ctx, r.id, 'paused', reason, 'coach_away');
    return rows.length;
  }
  const held = pausedFor(ctx, coachId, 'coach_away');
  if (!coachAccountActive(ctx, coachId)) {
    for (const id of held) ctx.db.update('coach_assignments', id, { pause_cause: 'coach_account' });
    if (held.length) audit(ctx, 'coach.assignments_held', { type: 'user', id: coachId }, reason, { assignmentIds: held, from: 'coach_away', to: 'coach_account' });
    return 0;
  }
  for (const id of held) setAssignmentStatus(ctx, id, 'active', reason);
  return held.length;
}

/** A coach's account state changed (PATCH /admin/coaches/:id/state, after setAccountState). Leaving active (suspended,
 *  deactivated, closed, deletion requested) pauses the coach's active assignments with cause coach_account, and the
 *  members are told their coach is away, as before. Becoming active again from any other state resumes exactly the
 *  assignments the account state paused, and tells each member their coach is back (as when a coach returns from
 *  away); assignments an administrator paused, or that the coach's away mark paused, stay as they are. If the coach is
 *  away at that moment, the account's assignments stay paused and wait for the coach's return instead (their cause
 *  becomes coach_away). Audited per assignment (assignment.paused / assignment.active) and once for the coach
 *  (coach.assignments_paused / coach.assignments_resumed / coach.assignments_held). */
export function onCoachAccountStateChanged(ctx: Ctx, coachId: string, from: string, to: string, reason: string): { paused: string[]; resumed: string[]; heldForAway: string[] } {
  const out = { paused: [] as string[], resumed: [] as string[], heldForAway: [] as string[] };
  if (from === to) return out;
  if (to !== 'active') {
    const rows = ctx.db.all<{ id: string }>("SELECT id FROM coach_assignments WHERE coach_id = ? AND status = 'active' ORDER BY created_at", [coachId]);
    for (const r of rows) setAssignmentStatus(ctx, r.id, 'paused', `account ${to}: ${reason}`, 'coach_account');
    out.paused = rows.map((r) => r.id);
    if (out.paused.length) audit(ctx, 'coach.assignments_paused', { type: 'user', id: coachId }, reason, { cause: 'coach_account', from, to, assignmentIds: out.paused });
    return out;
  }
  const held = pausedFor(ctx, coachId, 'coach_account');
  if (!held.length) return out;
  if (coachAway(ctx, coachId)) {
    for (const id of held) ctx.db.update('coach_assignments', id, { pause_cause: 'coach_away' });
    out.heldForAway = held;
    audit(ctx, 'coach.assignments_held', { type: 'user', id: coachId }, reason, { assignmentIds: held, from: 'coach_account', to: 'coach_away' });
    return out;
  }
  for (const id of held) setAssignmentStatus(ctx, id, 'active', `account reactivated: ${reason}`);
  out.resumed = held;
  audit(ctx, 'coach.assignments_resumed', { type: 'user', id: coachId }, reason, { cause: 'coach_account', from, to, assignmentIds: held });
  return out;
}
