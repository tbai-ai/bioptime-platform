/* M8 Live sessions, webinars and consultation follow-through (feature flag 'sessions'; the public part also needs
   'public_webinars'). Migration 0016_sessions.sql.

   Live sessions
   - A group class, webinar or workshop has a host (a coach, or an administrator holding sessions.manage), a time in
     India, an optional capacity and an audience: every member with a live programme ('members'), members of chosen
     packages ('packages'), or anyone, signed-in or not ('public', administrators only).
   - Drafts are invisible to members. Published sessions take registrations until they start; when the capacity is
     reached new sign-ups join the waitlist, and a cancellation (or more capacity) promotes whoever has waited longest.
   - Cancelling a session tells everyone registered or waiting. Completing it opens attendance marking to the host.
   - A coach sees only the sessions they host and, for those, registrants' names (never an email address or a phone
     number); an administrator with sessions.manage sees every session and public registrants' emails.

   Meeting details
   - MEETING_PROVIDER is "none": nothing creates a meeting (api/adapters/meetings.ts). A join link is whatever the host
     typed, https only, shown to registered people only; otherwise members read that their coach will share how to join.
     Recordings, speaker credentials, attendance figures and prices are never invented.

   Consultation follow-through
   - After a consultation is completed, its coach writes a summary for the member (a client-visible coach note with
     ref_type 'appointment'), an optional private note, and follow-ups (support_tasks of kind coach_follow_up pointing at
     the appointment, owned by the coach).

   Every change is audited (live_session.*, session.*, appointment.summary); notifications use the categories 'session'
   and 'session_reminder' ('appointment' for the summary). */
import type { Ctx } from '../context.js';
import { ids, randomId } from '../lib/ids.js';
import { errors } from '../lib/errors.js';
import { j } from '../db/db.js';
import { addMinutes, minutesBetween, istWhen, istDayLabel } from '../lib/time.js';
import { icsCalendar, icsFilename } from '../lib/ics.js';
import { audit } from './audit.js';
import { notify } from './notifications.js';
import { getSetting } from './settings.js';
import { openTask } from './support.js';
import * as reminders from './reminders.js';
import * as appointments from './appointments.js';
import { coachHasMember } from '../auth/permissions.js';
import { checkJoinUrl, linkHost, meetingProvider, shownLink } from '../adapters/meetings.js';

export const SESSION_KINDS = ['group_class', 'webinar', 'workshop'] as const;
export const SESSION_AUDIENCES = ['members', 'packages', 'public'] as const;
export const SESSION_STATUSES = ['draft', 'published', 'cancelled', 'completed'] as const;
export const REGISTRATION_STATUSES = ['registered', 'waitlisted', 'cancelled', 'attended', 'no_show'] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];
export type SessionAudience = (typeof SESSION_AUDIENCES)[number];
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const MAX_CAPACITY = 1000;
export const MIN_MINUTES = 15;
export const MAX_MINUTES = 8 * 60;
const REF = 'live_session';
const ZONE = 'Asia/Kolkata';
/** What members read while no join link exists (the wording the portal and the app already use). */
export const COACH_WILL_SHARE = 'Your coach will share how to join.';
export const TEAM_WILL_SHARE = 'The Bioptime team will share how to join.';

type SessionRow = {
  id: string; kind: SessionKind; title: string; description: string; host_id: string; start_at: string; end_at: string; timezone: string;
  capacity: number | null; audience: SessionAudience; package_ids: string; status: SessionStatus; join_url: string | null; meeting_provider: string;
  meeting_ref: string | null; cancelled_reason: string | null; sample: number; created_by: string | null; created_at: string; updated_at: string;
  published_at: string | null; cancelled_at: string | null; completed_at: string | null;
};
type RegRow = {
  id: string; session_id: string; user_id: string | null; name: string; email: string | null; status: RegistrationStatus; registered_at: string;
  cancelled_at: string | null; promoted_at: string | null; attendance_at: string | null; reminder_sent_at: string | null; updated_at: string;
};

/** A place is taken by everyone registered, and by those whose attendance is already recorded. */
const TAKING_PLACE: RegistrationStatus[] = ['registered', 'attended', 'no_show'];
const ACTIVE: RegistrationStatus[] = ['registered', 'waitlisted', 'attended', 'no_show'];

/* ---------- small helpers ---------- */

const KIND_LABEL: Record<SessionKind, string> = { group_class: 'Group class', webinar: 'Webinar', workshop: 'Workshop' };
export function kindLabel(kind: string): string { return KIND_LABEL[kind as SessionKind] ?? 'Session'; }
/** "Fri 30 Oct 2026 at 19:00 IST", the way the portal and the app write a session's time (lib/time.ts). */
export { istWhen };

function row(ctx: Ctx, id: string): SessionRow {
  const s = ctx.db.get<SessionRow>('SELECT * FROM live_sessions WHERE id = ?', [id]);
  if (!s) throw errors.notFound('Session');
  return s;
}
function regsOf(ctx: Ctx, sessionId: string): RegRow[] {
  return ctx.db.all<RegRow>('SELECT * FROM session_registrations WHERE session_id = ? ORDER BY registered_at, id', [sessionId]);
}
function regOf(ctx: Ctx, sessionId: string, userId: string): RegRow | undefined {
  return ctx.db.get<RegRow>('SELECT * FROM session_registrations WHERE session_id = ? AND user_id = ?', [sessionId, userId]);
}
function counts(ctx: Ctx, sessionId: string) {
  const out = { registered: 0, waitlisted: 0, attended: 0, noShow: 0, cancelled: 0 };
  for (const r of ctx.db.all<{ status: RegistrationStatus; n: number }>('SELECT status, COUNT(*) n FROM session_registrations WHERE session_id = ? GROUP BY status', [sessionId])) {
    if (r.status === 'no_show') out.noShow = r.n; else out[r.status] = r.n;
  }
  return out;
}
function taken(ctx: Ctx, sessionId: string): number {
  return ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM session_registrations WHERE session_id = ? AND status IN (${TAKING_PLACE.map(() => '?').join(', ')})`, [sessionId, ...TAKING_PLACE])!.n;
}
function hasPlace(ctx: Ctx, s: SessionRow): boolean { return s.capacity === null || taken(ctx, s.id) < s.capacity; }
function spotsLeft(ctx: Ctx, s: SessionRow): number | null { return s.capacity === null ? null : Math.max(0, s.capacity - taken(ctx, s.id)); }
function waitlistPosition(ctx: Ctx, r: RegRow): number | null {
  if (r.status !== 'waitlisted') return null;
  return ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM session_registrations WHERE session_id = ? AND status = 'waitlisted' AND (registered_at < ? OR (registered_at = ? AND id <= ?))", [r.session_id, r.registered_at, r.registered_at, r.id])!.n;
}

type Host = { id: string; role: string; name: string };
function hostOf(ctx: Ctx, hostId: string): Host | undefined {
  return ctx.db.get<Host>('SELECT u.id, u.role, COALESCE(c.display_name, u.name) AS name FROM users u LEFT JOIN coach_profiles c ON c.user_id = u.id WHERE u.id = ?', [hostId]);
}
/** What members and visitors read as the host: a coach's display name; an administrator is "The Bioptime team". */
function publicHostName(ctx: Ctx, hostId: string): string {
  const h = hostOf(ctx, hostId);
  return h?.role === 'coach' ? h.name : 'The Bioptime team';
}
/** Who will share how to join, as this member reads it: their own coach, another coach by name, or the team. */
function howToJoin(ctx: Ctx, s: SessionRow, memberId: string | null): string {
  const host = hostOf(ctx, s.host_id);
  if (host?.role !== 'coach') return TEAM_WILL_SHARE;
  return memberId && coachHasMember(ctx, host.id, memberId) ? COACH_WILL_SHARE : `${host.name} will share how to join.`;
}

function userName(ctx: Ctx, userId: string): string {
  return ctx.db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', [userId])?.name ?? 'Member';
}

/** An email to a visitor who registered for a public webinar without an account: recorded in the outbox like every
 *  other email (EMAIL_PROVIDER is the outbox, so nothing is delivered). */
function logEmail(ctx: Ctx, to: string, subject: string, body: string): void {
  ctx.db.insert('outbox_messages', { id: ids.outbox(), channel: 'email', to_address: to, subject, body, notification_id: null, status: 'logged', created_at: ctx.now() });
}
/** Tell a registrant: a member through notify(), a visitor by a logged email. */
function tell(ctx: Ctx, r: RegRow, msg: { category: 'session' | 'session_reminder'; title: string; body: string; sessionId: string }): void {
  if (r.user_id) notify(ctx, { userId: r.user_id, category: msg.category, title: msg.title, body: msg.body, data: { sessionId: msg.sessionId, registrationId: r.id } });
  else if (r.email) logEmail(ctx, r.email, msg.title, msg.body);
}

/* ---------- who may see and manage ---------- */

/** The host manages their own session; an administrator (the routes require sessions.manage) manages every one. A
 *  coach asking about someone else's session learns nothing: not found. */
function assertManage(ctx: Ctx, s: SessionRow): void {
  const actor = ctx.actor;
  if (!actor) throw errors.unauthorised();
  if (actor.role === 'admin' || actor.role === 'owner') return;
  if (actor.role === 'coach' && s.host_id === actor.id) return;
  throw errors.notFound('Session');
}

/** Is this member in the session's audience? 'members': a live (active or paused) programme; 'packages': a live
 *  programme of one of the chosen packages; 'public': everyone. */
export function eligible(ctx: Ctx, s: Pick<SessionRow, 'audience' | 'package_ids'>, memberId: string): boolean {
  if (s.audience === 'public') return true;
  if (s.audience === 'members') return !!ctx.db.get("SELECT 1 FROM programmes WHERE member_id = ? AND status IN ('active','paused') LIMIT 1", [memberId]);
  const packageIds = j.out<string[]>(s.package_ids, []);
  if (!packageIds.length) return false;
  return !!ctx.db.get(`SELECT 1 FROM programmes g JOIN package_versions v ON v.id = g.package_version_id WHERE g.member_id = ? AND g.status IN ('active','paused') AND v.package_id IN (${packageIds.map(() => '?').join(', ')}) LIMIT 1`, [memberId, ...packageIds]);
}

/* ---------- presenters ---------- */

function packageNames(ctx: Ctx, packageIds: string[]): Array<{ id: string; name: string }> {
  if (!packageIds.length) return [];
  return ctx.db.all<{ id: string; name: string }>(`SELECT id, name FROM packages WHERE id IN (${packageIds.map(() => '?').join(', ')}) ORDER BY name`, packageIds);
}

/** The host's and the administrators' view. */
export function presentStaff(ctx: Ctx, s: SessionRow) {
  const packageIds = j.out<string[]>(s.package_ids, []);
  const host = hostOf(ctx, s.host_id);
  return {
    id: s.id, kind: s.kind, kindLabel: kindLabel(s.kind), title: s.title, description: s.description, hostId: s.host_id, hostName: host?.name ?? null, hostRole: host?.role ?? null,
    startAt: s.start_at, endAt: s.end_at, timezone: s.timezone, capacity: s.capacity, audience: s.audience, packageIds, packages: packageNames(ctx, packageIds),
    status: s.status, joinUrl: shownLink(s.join_url), meetingProvider: s.meeting_provider, cancelledReason: s.cancelled_reason, sample: !!s.sample,
    counts: counts(ctx, s.id), spotsLeft: spotsLeft(ctx, s), createdAt: s.created_at, updatedAt: s.updated_at, publishedAt: s.published_at, cancelledAt: s.cancelled_at, completedAt: s.completed_at,
  };
}

/** A member's view: no other registrant, no counts beyond the places left, and the join link only once registered. */
export function presentMember(ctx: Ctx, s: SessionRow, memberId: string) {
  const r = regOf(ctx, s.id, memberId);
  const mine = r && r.status !== 'cancelled' ? r : null;
  const placed = !!mine && (mine.status === 'registered' || mine.status === 'attended');
  const link = placed && s.status === 'published' ? shownLink(s.join_url) : null;
  const left = spotsLeft(ctx, s);
  return {
    id: s.id, kind: s.kind, kindLabel: kindLabel(s.kind), title: s.title, description: s.description, hostName: publicHostName(ctx, s.host_id),
    startAt: s.start_at, endAt: s.end_at, timezone: s.timezone, status: s.status, cancelledReason: s.status === 'cancelled' ? s.cancelled_reason : null, sample: !!s.sample,
    capacity: s.capacity, spotsLeft: left, full: left === 0, started: s.start_at <= ctx.now(), eligible: eligible(ctx, s, memberId),
    myRegistration: mine ? { id: mine.id, status: mine.status, registeredAt: mine.registered_at, waitlistPosition: waitlistPosition(ctx, mine) } : null,
    joinUrl: link, howToJoin: placed && s.status === 'published' && !link ? howToJoin(ctx, s, memberId) : null,
  };
}

/** What a signed-out visitor reads of a public webinar. */
function presentPublic(ctx: Ctx, s: SessionRow) {
  const left = spotsLeft(ctx, s);
  return { id: s.id, kind: s.kind, kindLabel: kindLabel(s.kind), title: s.title, description: s.description, hostName: publicHostName(ctx, s.host_id), startAt: s.start_at, endAt: s.end_at, timezone: s.timezone, full: left === 0, sample: !!s.sample };
}

/* ---------- input checks ---------- */

export type SessionInput = {
  kind: SessionKind; title: string; description?: string; startAt: string; endAt: string; capacity?: number | null;
  audience: SessionAudience; packageIds?: string[]; joinUrl?: string | null; hostId?: string;
};

function checkTimes(ctx: Ctx, startAt: string, endAt: string): void {
  if (Number.isNaN(Date.parse(startAt)) || Number.isNaN(Date.parse(endAt))) throw errors.badRequest('Give a start and an end time', 'SESSION_TIME_INVALID');
  if (startAt <= ctx.now()) throw errors.badRequest('Pick a start time in the future', 'SESSION_IN_PAST');
  const minutes = minutesBetween(startAt, endAt);
  if (minutes < MIN_MINUTES) throw errors.badRequest(`A session runs at least ${MIN_MINUTES} minutes and ends after it starts`, 'SESSION_TIME_INVALID');
  if (minutes > MAX_MINUTES) throw errors.badRequest(`A session runs at most ${MAX_MINUTES / 60} hours`, 'SESSION_TIME_INVALID');
}

/** Package ids from ids or slugs ('core'); unknown ones fail with AUDIENCE_INVALID. */
export function resolvePackages(ctx: Ctx, values: string[]): string[] {
  const unique = [...new Set(values)];
  if (!unique.length) return [];
  const marks = unique.map(() => '?').join(', ');
  const rows = ctx.db.all<{ id: string; slug: string }>(`SELECT id, slug FROM packages WHERE id IN (${marks}) OR slug IN (${marks})`, [...unique, ...unique]);
  const unknown = unique.filter((v) => !rows.some((r) => r.id === v || r.slug === v));
  if (unknown.length) throw errors.badRequest(`Unknown package ${unknown.join(', ')}`, 'AUDIENCE_INVALID');
  return [...new Set(unique.map((v) => rows.find((r) => r.id === v || r.slug === v)!.id))].sort();
}

function checkAudience(ctx: Ctx, audience: SessionAudience, packageIds: string[]): string[] {
  if (audience === 'public' && ctx.actor?.role === 'coach') throw errors.forbidden('Public webinars are set up by the Bioptime team', 'PUBLIC_NEEDS_ADMIN');
  if (audience !== 'packages') {
    if (packageIds.length) throw errors.badRequest('Packages apply only when the audience is "members of chosen packages"', 'AUDIENCE_INVALID');
    return [];
  }
  if (!packageIds.length) throw errors.badRequest('Choose at least one package', 'AUDIENCE_INVALID');
  return resolvePackages(ctx, packageIds);
}

function checkHost(ctx: Ctx, hostId: string): Host {
  const h = ctx.db.get<{ id: string; role: string; state: string; name: string }>('SELECT id, role, state, name FROM users WHERE id = ?', [hostId]);
  if (!h || !['coach', 'admin', 'owner'].includes(h.role)) throw errors.badRequest('The host is a coach or a member of the Bioptime team', 'HOST_INVALID');
  if (h.state !== 'active') throw errors.badRequest('The host’s account is not active', 'HOST_INVALID');
  return hostOf(ctx, hostId)!;
}

/* ---------- hosts and administrators: sessions ---------- */

export function createSession(ctx: Ctx, input: SessionInput, opts: { sample?: boolean } = {}) {
  const actor = ctx.actor;
  if (!actor) throw errors.unauthorised();
  const hostId = actor.role === 'coach' ? actor.id : input.hostId ?? actor.id; // a coach hosts their own sessions
  checkHost(ctx, hostId);
  const startAt = new Date(input.startAt).toISOString(), endAt = new Date(input.endAt).toISOString();
  checkTimes(ctx, startAt, endAt);
  const packageIds = checkAudience(ctx, input.audience, input.packageIds ?? []);
  const joinUrl = input.joinUrl ? checkJoinUrl(input.joinUrl) : null;
  const id = randomId('lvs');
  const now = ctx.now();
  ctx.db.insert('live_sessions', {
    id, kind: input.kind, title: input.title.trim(), description: (input.description ?? '').trim(), host_id: hostId, start_at: startAt, end_at: endAt, timezone: ZONE,
    capacity: input.capacity ?? null, audience: input.audience, package_ids: j.in(packageIds), status: 'draft', join_url: joinUrl, meeting_provider: 'none', meeting_ref: null,
    cancelled_reason: null, sample: opts.sample ? 1 : 0, created_by: actor.id, created_at: now, updated_at: now, published_at: null, cancelled_at: null, completed_at: null,
  });
  audit(ctx, 'live_session.create', { type: REF, id }, null, { kind: input.kind, audience: input.audience, packageIds, hostId, capacity: input.capacity ?? null, hasJoinLink: !!joinUrl, joinHost: linkHost(joinUrl) });
  return presentStaff(ctx, row(ctx, id));
}

export type SessionPatch = Partial<Omit<SessionInput, 'hostId'>> & { reason?: string };

export function updateSession(ctx: Ctx, id: string, patch: SessionPatch) {
  return ctx.db.tx(() => {
    const s = row(ctx, id);
    assertManage(ctx, s);
    if (s.status === 'cancelled' || s.status === 'completed') throw errors.state(`A session that is ${s.status} cannot change`, { code: 'SESSION_CLOSED' });
    const startAt = patch.startAt !== undefined ? new Date(patch.startAt).toISOString() : s.start_at;
    const endAt = patch.endAt !== undefined ? new Date(patch.endAt).toISOString() : s.end_at;
    const timeChanged = startAt !== s.start_at || endAt !== s.end_at;
    if (timeChanged) checkTimes(ctx, startAt, endAt);
    const audienceTouched = patch.audience !== undefined || patch.packageIds !== undefined;
    let audience = s.audience, packageIds = j.out<string[]>(s.package_ids, []);
    if (audienceTouched) {
      const nextAudience = patch.audience ?? s.audience;
      const nextPackages = checkAudience(ctx, nextAudience, patch.packageIds ?? (nextAudience === 'packages' ? packageIds : []));
      const same = nextAudience === s.audience && JSON.stringify(nextPackages) === JSON.stringify([...packageIds].sort());
      if (!same && s.status !== 'draft') throw errors.state('Who can join is fixed once a session is published. Cancel it and create another one instead.', { code: 'AUDIENCE_LOCKED' });
      packageIds = nextPackages;
      audience = nextAudience;
    }
    let capacity = s.capacity;
    if (patch.capacity !== undefined) {
      capacity = patch.capacity;
      if (capacity !== null && capacity < taken(ctx, s.id)) throw errors.state(`${taken(ctx, s.id)} people already hold a place; the capacity cannot go below that`, { code: 'CAPACITY_BELOW_REGISTERED' });
    }
    let joinUrl = s.join_url;
    if (patch.joinUrl !== undefined) joinUrl = patch.joinUrl ? checkJoinUrl(patch.joinUrl) : null;
    const title = patch.title !== undefined ? patch.title.trim() : s.title;
    const description = patch.description !== undefined ? patch.description.trim() : s.description;
    const kind = patch.kind ?? s.kind;
    const changed = [
      ...(kind !== s.kind ? ['kind'] : []), ...(title !== s.title ? ['title'] : []), ...(description !== s.description ? ['description'] : []),
      ...(timeChanged ? ['time'] : []), ...(capacity !== s.capacity ? ['capacity'] : []), ...(audience !== s.audience || JSON.stringify(packageIds) !== s.package_ids ? ['audience'] : []),
      ...(joinUrl !== s.join_url ? ['joinLink'] : []),
    ];
    if (!changed.length) return presentStaff(ctx, s);
    ctx.db.update('live_sessions', id, { kind, title, description, start_at: startAt, end_at: endAt, capacity, audience, package_ids: j.in(packageIds), join_url: joinUrl, updated_at: ctx.now() });
    const next = row(ctx, id);
    if (next.status === 'published') {
      const people = regsOf(ctx, id).filter((r) => r.status === 'registered' || r.status === 'waitlisted');
      if (timeChanged) {
        // the reminders follow the new time: queued ones are withdrawn and the job queues them again
        reminders.cancel(ctx, { refType: REF, refId: id });
        ctx.db.run("UPDATE session_registrations SET reminder_sent_at = NULL WHERE session_id = ? AND status IN ('registered','waitlisted')", [id]);
        for (const r of people) tell(ctx, r, { category: 'session', title: `${kindLabel(next.kind)} moved`, body: `${next.title} is now ${istWhen(next.start_at)}.`, sessionId: id });
      }
      if (joinUrl && joinUrl !== s.join_url) for (const r of people.filter((p) => p.status === 'registered')) tell(ctx, r, { category: 'session', title: 'How to join', body: `${next.title}, ${istWhen(next.start_at)}: the host shared how to join. Open Live sessions.`, sessionId: id });
      if (capacity === null || (s.capacity !== null && capacity > s.capacity)) promoteWaiting(ctx, next);
    }
    audit(ctx, 'live_session.update', { type: REF, id }, patch.reason?.trim() || null, { changed, ...(timeChanged ? { from: s.start_at, to: startAt } : {}), ...(changed.includes('joinLink') ? { hasJoinLink: !!joinUrl, joinHost: linkHost(joinUrl) } : {}) });
    return presentStaff(ctx, row(ctx, id));
  });
}

export function publishSession(ctx: Ctx, id: string) {
  return ctx.db.tx(() => {
    const s = row(ctx, id);
    assertManage(ctx, s);
    if (s.status !== 'draft') throw errors.state(`A session that is ${s.status} cannot be published`, { code: 'SESSION_NOT_DRAFT' });
    if (s.start_at <= ctx.now()) throw errors.state('This session’s start time has passed. Move it before publishing.', { code: 'SESSION_IN_PAST' });
    if (s.audience === 'public' && ctx.actor?.role === 'coach') throw errors.forbidden('Public webinars are set up by the Bioptime team', 'PUBLIC_NEEDS_ADMIN');
    const meeting = meetingProvider(ctx.config).createMeeting({ kind: 'live_session', refId: id, title: s.title, startAt: s.start_at, endAt: s.end_at, timezone: s.timezone, hostId: s.host_id });
    const now = ctx.now();
    ctx.db.update('live_sessions', id, { status: 'published', published_at: now, join_url: meeting.joinUrl ?? s.join_url, meeting_provider: meeting.provider, meeting_ref: meeting.meetingRef ?? s.meeting_ref, updated_at: now });
    audit(ctx, 'live_session.publish', { type: REF, id }, null, { audience: s.audience, provider: meeting.provider, hasJoinLink: !!(meeting.joinUrl ?? s.join_url) });
    return presentStaff(ctx, row(ctx, id));
  });
}

export function cancelSession(ctx: Ctx, id: string, reason: string) {
  return ctx.db.tx(() => {
    const s = row(ctx, id);
    assertManage(ctx, s);
    if (s.status !== 'draft' && s.status !== 'published') throw errors.state(`A session that is ${s.status} cannot be cancelled`, { code: 'SESSION_CLOSED' });
    const now = ctx.now();
    ctx.db.update('live_sessions', id, { status: 'cancelled', cancelled_reason: reason.trim(), cancelled_at: now, updated_at: now });
    if (s.meeting_ref) meetingProvider(ctx.config).cancelMeeting({ provider: s.meeting_provider, meetingRef: s.meeting_ref });
    reminders.cancel(ctx, { refType: REF, refId: id });
    const people = regsOf(ctx, id).filter((r) => r.status === 'registered' || r.status === 'waitlisted');
    for (const r of people) tell(ctx, r, { category: 'session', title: `${kindLabel(s.kind)} cancelled`, body: `${s.title}, ${istWhen(s.start_at)}, was cancelled. ${reason.trim()}`.trim(), sessionId: id });
    audit(ctx, 'live_session.cancel', { type: REF, id }, reason.trim(), { was: s.status, notified: people.length });
    return presentStaff(ctx, row(ctx, id));
  });
}

export function completeSession(ctx: Ctx, id: string) {
  return ctx.db.tx(() => {
    const s = row(ctx, id);
    assertManage(ctx, s);
    if (s.status !== 'published') throw errors.state(`A session that is ${s.status} cannot be completed`, { code: 'SESSION_NOT_PUBLISHED' });
    if (s.start_at > ctx.now()) throw errors.state('A session can be completed once it has started', { code: 'SESSION_NOT_STARTED' });
    const now = ctx.now();
    ctx.db.update('live_sessions', id, { status: 'completed', completed_at: now, updated_at: now });
    reminders.cancel(ctx, { refType: REF, refId: id });
    audit(ctx, 'live_session.complete', { type: REF, id }, null, { counts: counts(ctx, id) });
    return presentStaff(ctx, row(ctx, id));
  });
}

/** Attendance, as the host records it, once the session has started: attended, no-show, or back to registered. */
export function markAttendance(ctx: Ctx, id: string, marks: Array<{ registrationId: string; status: 'attended' | 'no_show' | 'registered' }>) {
  return ctx.db.tx(() => {
    const s = row(ctx, id);
    assertManage(ctx, s);
    if (s.status !== 'published' && s.status !== 'completed') throw errors.state(`Attendance is recorded for a published or completed session, not one that is ${s.status}`, { code: 'SESSION_NOT_PUBLISHED' });
    if (s.start_at > ctx.now()) throw errors.state('Attendance can be recorded once the session has started', { code: 'SESSION_NOT_STARTED' });
    const tally = { attended: 0, no_show: 0, registered: 0 };
    const now = ctx.now();
    for (const m of marks) {
      const r = ctx.db.get<RegRow>('SELECT * FROM session_registrations WHERE id = ? AND session_id = ?', [m.registrationId, id]);
      if (!r) throw errors.notFound('Registration');
      if (!TAKING_PLACE.includes(r.status)) throw errors.state(`${r.name} is ${r.status === 'waitlisted' ? 'on the waitlist' : 'no longer registered'}; attendance is for people who held a place`, { code: 'NOT_REGISTERED' });
      ctx.db.update('session_registrations', r.id, { status: m.status, attendance_at: m.status === 'registered' ? null : now, updated_at: now });
      tally[m.status]++;
    }
    audit(ctx, 'session.attendance', { type: REF, id }, null, { attended: tally.attended, noShow: tally.no_show, reset: tally.registered });
    return { session: presentStaff(ctx, row(ctx, id)), items: registrationsForHost(ctx, id) };
  });
}

export function listForHost(ctx: Ctx, hostId: string, opts: { range?: 'upcoming' | 'past' | 'all' } = {}) {
  const now = ctx.now();
  const where = ['host_id = ?'];
  const params: string[] = [hostId];
  if (opts.range === 'upcoming') { where.push("end_at >= ? AND status IN ('draft','published')"); params.push(now); }
  if (opts.range === 'past') { where.push("(end_at < ? OR status IN ('cancelled','completed'))"); params.push(now); }
  return ctx.db.all<SessionRow>(`SELECT * FROM live_sessions WHERE ${where.join(' AND ')} ORDER BY start_at ${opts.range === 'past' ? 'DESC' : 'ASC'} LIMIT 200`, params).map((s) => presentStaff(ctx, s));
}

export function listAll(ctx: Ctx, opts: { range?: 'upcoming' | 'past' | 'all'; status?: SessionStatus; hostId?: string; audience?: SessionAudience } = {}) {
  const now = ctx.now();
  const where: string[] = [];
  const params: string[] = [];
  if (opts.status) { where.push('status = ?'); params.push(opts.status); }
  if (opts.hostId) { where.push('host_id = ?'); params.push(opts.hostId); }
  if (opts.audience) { where.push('audience = ?'); params.push(opts.audience); }
  if (opts.range === 'upcoming') { where.push("end_at >= ? AND status IN ('draft','published')"); params.push(now); }
  if (opts.range === 'past') { where.push("(end_at < ? OR status IN ('cancelled','completed'))"); params.push(now); }
  return ctx.db.all<SessionRow>(`SELECT * FROM live_sessions ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY start_at ${opts.range === 'past' ? 'DESC' : 'ASC'} LIMIT 300`, params).map((s) => presentStaff(ctx, s));
}

export function getForStaff(ctx: Ctx, id: string) {
  const s = row(ctx, id);
  assertManage(ctx, s);
  return presentStaff(ctx, s);
}

/** The people who host may see: names, statuses and waitlist places. Never an email address or a phone number. A
 *  registrant who is one of the host coach's own clients carries their member id, so the coach can open the record. */
export function registrationsForHost(ctx: Ctx, id: string) {
  const s = row(ctx, id);
  assertManage(ctx, s);
  const coachId = ctx.actor?.role === 'coach' ? ctx.actor.id : null;
  return orderRegs(regsOf(ctx, id)).map((r) => ({
    id: r.id, name: r.name, status: r.status, registeredAt: r.registered_at, waitlistPosition: waitlistPosition(ctx, r), attendanceAt: r.attendance_at,
    source: r.user_id ? ('member' as const) : ('public' as const), clientId: coachId && r.user_id && coachHasMember(ctx, coachId, r.user_id) ? r.user_id : null,
  }));
}

/** The administrators' list (sessions.manage): members by id and name, visitors by name and email. */
export function registrationsForAdmin(ctx: Ctx, id: string) {
  row(ctx, id);
  return orderRegs(regsOf(ctx, id)).map((r) => ({
    id: r.id, name: r.name, status: r.status, registeredAt: r.registered_at, waitlistPosition: waitlistPosition(ctx, r), attendanceAt: r.attendance_at, cancelledAt: r.cancelled_at, promotedAt: r.promoted_at,
    source: r.user_id ? ('member' as const) : ('public' as const), memberId: r.user_id, email: r.user_id ? null : r.email,
  }));
}

const STATUS_ORDER: Record<RegistrationStatus, number> = { attended: 0, registered: 1, no_show: 2, waitlisted: 3, cancelled: 4 };
function orderRegs(rows: RegRow[]): RegRow[] { return [...rows].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.registered_at.localeCompare(b.registered_at) || a.id.localeCompare(b.id)); }

/** Hosts an administrator may choose: active coaches and the Bioptime team (names only). */
export function hostChoices(ctx: Ctx) {
  return ctx.db.all<{ id: string; name: string; role: string }>("SELECT u.id, COALESCE(c.display_name, u.name) AS name, u.role FROM users u LEFT JOIN coach_profiles c ON c.user_id = u.id WHERE u.role IN ('coach','admin','owner') AND u.state = 'active' ORDER BY CASE u.role WHEN 'coach' THEN 0 ELSE 1 END, name");
}

/* ---------- registrations ---------- */

/** Promote the people who waited longest while places are free. Returns the promoted registrations. */
function promoteWaiting(ctx: Ctx, s: SessionRow): RegRow[] {
  const out: RegRow[] = [];
  if (s.status !== 'published' || s.start_at <= ctx.now()) return out;
  while (hasPlace(ctx, s)) {
    const next = ctx.db.get<RegRow>("SELECT * FROM session_registrations WHERE session_id = ? AND status = 'waitlisted' ORDER BY registered_at, id LIMIT 1", [s.id]);
    if (!next) break;
    const now = ctx.now();
    ctx.db.update('session_registrations', next.id, { status: 'registered', promoted_at: now, reminder_sent_at: null, updated_at: now });
    tell(ctx, next, { category: 'session', title: 'A place opened up', body: `You are now registered for ${s.title}, ${istWhen(s.start_at)}.`, sessionId: s.id });
    out.push({ ...next, status: 'registered', promoted_at: now });
  }
  return out;
}

/** A member signs up: registered while places are free, else on the waitlist. Signing up again is harmless. */
export function register(ctx: Ctx, sessionId: string, memberId: string) {
  return ctx.db.tx(() => {
    const s = ctx.db.get<SessionRow>('SELECT * FROM live_sessions WHERE id = ?', [sessionId]);
    if (!s || s.status === 'draft') throw errors.notFound('Session');
    if (s.status !== 'published') throw errors.state(`This session is ${s.status}`, { code: 'SESSION_NOT_OPEN' });
    if (s.start_at <= ctx.now()) throw errors.state('This session has already started', { code: 'SESSION_STARTED' });
    const existing = regOf(ctx, sessionId, memberId);
    if (existing && ACTIVE.includes(existing.status)) return presentMember(ctx, s, memberId);
    if (!eligible(ctx, s, memberId)) throw errors.forbidden(s.audience === 'packages' ? 'This session is for members of other programmes' : 'This session is for members with a live programme', 'NOT_ELIGIBLE');
    const status: RegistrationStatus = hasPlace(ctx, s) ? 'registered' : 'waitlisted';
    const now = ctx.now();
    let regId: string;
    if (existing) {
      regId = existing.id;
      ctx.db.update('session_registrations', regId, { status, name: userName(ctx, memberId), registered_at: now, cancelled_at: null, promoted_at: null, attendance_at: null, reminder_sent_at: null, updated_at: now });
    } else {
      regId = randomId('lsr');
      ctx.db.insert('session_registrations', { id: regId, session_id: sessionId, user_id: memberId, name: userName(ctx, memberId), email: null, status, registered_at: now, cancelled_at: null, promoted_at: null, attendance_at: null, reminder_sent_at: null, updated_at: now });
    }
    const reg = ctx.db.get<RegRow>('SELECT * FROM session_registrations WHERE id = ?', [regId])!;
    tell(ctx, reg, status === 'registered'
      ? { category: 'session', title: 'You are registered', body: `${s.title}, ${istWhen(s.start_at)}. ${shownLink(s.join_url) ? 'Open Live sessions to join.' : howToJoin(ctx, s, memberId)}`, sessionId }
      : { category: 'session', title: 'You are on the waitlist', body: `${s.title}, ${istWhen(s.start_at)} is full. You are number ${waitlistPosition(ctx, reg)} on the waitlist; we tell you if a place opens up.`, sessionId });
    audit(ctx, 'session.register', { type: REF, id: sessionId }, null, { registrationId: regId, status, by: 'member' });
    return presentMember(ctx, s, memberId);
  });
}

function releasePlace(ctx: Ctx, s: SessionRow, r: RegRow, reason: string | null, by: string): RegRow[] {
  const now = ctx.now();
  ctx.db.update('session_registrations', r.id, { status: 'cancelled', cancelled_at: now, reminder_sent_at: null, updated_at: now });
  if (r.user_id) reminders.cancel(ctx, { refType: REF, refId: s.id, userId: r.user_id });
  const promoted = r.status === 'registered' ? promoteWaiting(ctx, s) : [];
  audit(ctx, 'session.cancel', { type: REF, id: s.id }, reason, { registrationId: r.id, was: r.status, by, promoted: promoted.map((p) => p.id) });
  return promoted;
}

/** A member gives their place back (or leaves the waitlist) before the session starts; the next person waiting is promoted. */
export function cancelRegistration(ctx: Ctx, sessionId: string, memberId: string, reason?: string) {
  return ctx.db.tx(() => {
    const s = ctx.db.get<SessionRow>('SELECT * FROM live_sessions WHERE id = ?', [sessionId]);
    const r = s ? regOf(ctx, sessionId, memberId) : undefined;
    if (!s || !r || r.status === 'cancelled') throw errors.notFound('Registration');
    if (r.status === 'attended' || r.status === 'no_show') throw errors.state('Attendance is already recorded for this session', { code: 'ATTENDANCE_RECORDED' });
    if (s.status === 'published' && s.start_at <= ctx.now()) throw errors.state('This session has already started', { code: 'SESSION_STARTED' });
    releasePlace(ctx, s, r, reason?.trim() || null, 'member');
    return presentMember(ctx, row(ctx, sessionId), memberId);
  });
}

/** An administrator removes a registration (a member's or a visitor's), with a reason; the person is told. */
export function adminCancelRegistration(ctx: Ctx, sessionId: string, registrationId: string, reason: string) {
  return ctx.db.tx(() => {
    const s = row(ctx, sessionId);
    const r = ctx.db.get<RegRow>('SELECT * FROM session_registrations WHERE id = ? AND session_id = ?', [registrationId, sessionId]);
    if (!r || r.status === 'cancelled') throw errors.notFound('Registration');
    if (r.status === 'attended' || r.status === 'no_show') throw errors.state('Attendance is already recorded for this person', { code: 'ATTENDANCE_RECORDED' });
    releasePlace(ctx, s, r, reason.trim(), 'admin');
    if (s.status === 'published') tell(ctx, r, { category: 'session', title: 'Registration cancelled', body: `Your place for ${s.title}, ${istWhen(s.start_at)}, was cancelled by the Bioptime team.`, sessionId });
    return registrationsForAdmin(ctx, sessionId);
  });
}

/** Sessions a member may join (published, not yet over, in their audience or already joined) and the ones they joined. */
export function listForMember(ctx: Ctx, memberId: string) {
  const now = ctx.now();
  const joined = (s: SessionRow) => { const r = regOf(ctx, s.id, memberId); return !!r && r.status !== 'cancelled'; };
  const open = ctx.db.all<SessionRow>("SELECT * FROM live_sessions WHERE status = 'published' AND end_at >= ? ORDER BY start_at LIMIT 200", [now]).filter((s) => joined(s) || eligible(ctx, s, memberId));
  const history = ctx.db.all<SessionRow>("SELECT s.* FROM live_sessions s JOIN session_registrations r ON r.session_id = s.id WHERE r.user_id = ? AND r.status != 'cancelled' AND s.status != 'draft' AND (s.end_at < ? OR s.status IN ('cancelled','completed')) ORDER BY s.start_at DESC LIMIT 50", [memberId, now]);
  return { items: open.map((s) => presentMember(ctx, s, memberId)), history: history.map((s) => presentMember(ctx, s, memberId)) };
}

export function getForMember(ctx: Ctx, id: string, memberId: string) {
  const s = ctx.db.get<SessionRow>('SELECT * FROM live_sessions WHERE id = ?', [id]);
  const r = s ? regOf(ctx, id, memberId) : undefined;
  if (!s || s.status === 'draft' || (!eligible(ctx, s, memberId) && (!r || r.status === 'cancelled'))) throw errors.notFound('Session');
  return presentMember(ctx, s, memberId);
}

/** The member's data export (ApiModule.exportSections in api/modules/sessions.ts, read by api/domain/dataExport.ts
 *  buildArchive): every live session this member signed up for, earliest first, in the words of their Live sessions page.
 *  The session as they read it (title, kind, the host by display name or "The Bioptime team", times in India, whether
 *  it went ahead or was cancelled and the reason they were given) and their own place: registered, waitlisted (with
 *  their position while it waits), attended, no-show, or cancelled. A cancelled place is in the file although their
 *  Live sessions page no longer lists it: it carries when it was cancelled and how, in the words they were told
 *  (cancelNote, from placeEndedNote). Never another registrant, how many signed up, the capacity, the join link or
 *  meeting details, the host's own contact details, the team's reason for cancelling a place, and nothing from a
 *  session still in draft. */
export function exportRegistrationsForMember(ctx: Ctx, memberId: string) {
  const rows = ctx.db.all<SessionRow & { reg_id: string; reg_status: RegistrationStatus; registered_at: string; reg_cancelled_at: string | null }>(`SELECT s.*, r.id AS reg_id, r.status AS reg_status, r.registered_at, r.cancelled_at AS reg_cancelled_at
      FROM session_registrations r JOIN live_sessions s ON s.id = r.session_id WHERE r.user_id = ? AND s.status != 'draft' ORDER BY s.start_at, r.registered_at, r.id`, [memberId]);
  return rows.map((s) => {
    const position = s.reg_status === 'waitlisted' ? waitlistPosition(ctx, { id: s.reg_id, session_id: s.id, status: s.reg_status, registered_at: s.registered_at } as RegRow) : null;
    return {
      title: s.title, kind: kindLabel(s.kind), host: publicHostName(ctx, s.host_id), startAt: s.start_at, endAt: s.end_at, timezone: s.timezone, sample: !!s.sample,
      sessionStatus: s.status, cancelledReason: s.status === 'cancelled' ? s.cancelled_reason : null,
      yourPlace: {
        status: s.reg_status, registeredAt: s.registered_at, waitlistPosition: position,
        cancelledAt: s.reg_status === 'cancelled' ? s.reg_cancelled_at : null,
        cancelNote: s.reg_status === 'cancelled' ? placeEndedNote(ctx, s.id, s.reg_id) : null,
      },
    };
  });
}

/** How a cancelled place ended, in the words its holder was told, read from the latest session.cancel audit for that
 *  registration (releasePlace writes one each time, with who released it): they gave it back or left the waitlist
 *  themselves, the Bioptime team cancelled it (adminCancelRegistration), or it was released when their programme ended
 *  (onProgrammeEnded). Null when no such audit exists (a row written directly, such as demo data), rather than a guess.
 *  Never the team's reason or who on the team did it. */
function placeEndedNote(ctx: Ctx, sessionId: string, registrationId: string): string | null {
  const a = ctx.db.get<{ reason: string | null; data: string }>("SELECT reason, data FROM audit_events WHERE action = 'session.cancel' AND target_type = ? AND target_id = ? AND json_extract(data, '$.registrationId') = ? ORDER BY at DESC, rowid DESC LIMIT 1", [REF, sessionId, registrationId]);
  if (!a) return null;
  const d = j.out<{ by?: string; was?: string }>(a.data, {});
  if (d.by === 'member') return d.was === 'waitlisted' ? 'You left the waitlist.' : 'You gave your place back.';
  if (d.by === 'admin') return 'Cancelled by the Bioptime team.';
  if (d.by === 'system' && a.reason === 'programme ended') return 'Released because your programme ended.';
  return null;
}

/** A member's registrations change when their programme ends: places in sessions they are no longer in the audience
 *  for are given back (the next person waiting is promoted), and the member is told. Public sessions are unaffected. */
export function onProgrammeEnded(ctx: Ctx, memberId: string): number {
  const rows = ctx.db.all<SessionRow & { reg_id: string }>("SELECT s.*, r.id AS reg_id FROM live_sessions s JOIN session_registrations r ON r.session_id = s.id WHERE r.user_id = ? AND r.status IN ('registered','waitlisted') AND s.status = 'published' AND s.start_at > ? AND s.audience != 'public'", [memberId, ctx.now()]);
  let released = 0;
  for (const s of rows) {
    if (eligible(ctx, s, memberId)) continue;
    ctx.db.tx(() => {
      const r = ctx.db.get<RegRow>('SELECT * FROM session_registrations WHERE id = ?', [s.reg_id])!;
      releasePlace(ctx, s, r, 'programme ended', 'system');
      tell(ctx, r, { category: 'session', title: 'Registration released', body: `Your place for ${s.title}, ${istWhen(s.start_at)}, was released because your programme ended.`, sessionId: s.id });
    });
    released++;
  }
  return released;
}

/* ---------- public webinars ---------- */

export function listPublic(ctx: Ctx) {
  return ctx.db.all<SessionRow>("SELECT * FROM live_sessions WHERE status = 'published' AND audience = 'public' AND start_at > ? ORDER BY start_at LIMIT 50", [ctx.now()]).map((s) => presentPublic(ctx, s));
}

/** A visitor registers with a name and an email. The answer is always the same ({ received: true }): it never says
 *  whether that email has an account, had registered before, holds a place or waits, so nobody can learn another
 *  person's registration by trying their email. The details go to the email address itself (a logged email), and a
 *  repeat registration keeps its place and is told its status again. */
export function registerPublic(ctx: Ctx, sessionId: string, input: { name: string; email: string }) {
  return ctx.db.tx(() => {
    const s = ctx.db.get<SessionRow>('SELECT * FROM live_sessions WHERE id = ?', [sessionId]);
    if (!s || s.audience !== 'public' || s.status === 'draft') throw errors.notFound('Webinar');
    if (s.status !== 'published') throw errors.state(`This webinar is ${s.status}`, { code: 'SESSION_NOT_OPEN' });
    if (s.start_at <= ctx.now()) throw errors.state('This webinar has already started', { code: 'SESSION_STARTED' });
    const email = input.email.trim().toLowerCase();
    const name = input.name.trim();
    const existing = ctx.db.get<RegRow>('SELECT * FROM session_registrations WHERE session_id = ? AND email = ?', [sessionId, email]);
    if (existing && ACTIVE.includes(existing.status)) {
      const position = existing.status === 'waitlisted' ? waitlistPosition(ctx, existing) : null;
      logEmail(ctx, email, existing.status === 'waitlisted' ? `Still on the waitlist: ${s.title}` : `Already registered: ${s.title}`,
        `${s.title}, ${istWhen(s.start_at)}. ${existing.status === 'waitlisted' ? `You are already on the waitlist${position ? ` (number ${position})` : ''}; we tell you if a place opens up.` : `You are already registered. ${TEAM_WILL_SHARE}`}`);
      return { received: true as const };
    }
    const status: RegistrationStatus = hasPlace(ctx, s) ? 'registered' : 'waitlisted';
    const now = ctx.now();
    let regId: string;
    if (existing) {
      regId = existing.id;
      ctx.db.update('session_registrations', regId, { status, name, registered_at: now, cancelled_at: null, promoted_at: null, attendance_at: null, reminder_sent_at: null, updated_at: now });
    } else {
      regId = randomId('lsr');
      ctx.db.insert('session_registrations', { id: regId, session_id: sessionId, user_id: null, name, email, status, registered_at: now, cancelled_at: null, promoted_at: null, attendance_at: null, reminder_sent_at: null, updated_at: now });
    }
    logEmail(ctx, email, status === 'registered' ? `Registered: ${s.title}` : `Waitlist: ${s.title}`,
      `${s.title}, ${istWhen(s.start_at)}. ${status === 'registered' ? `You are registered. ${TEAM_WILL_SHARE}` : 'The webinar is full; you are on the waitlist and we tell you if a place opens up.'}`);
    audit(ctx, 'session.register', { type: REF, id: sessionId }, null, { registrationId: regId, status, by: 'public' });
    return { received: true as const };
  });
}

/* ---------- reminders ---------- */

/** The session_reminders job: for registered people whose session starts within the administrator's
 *  reminder_hours_before (default 24), queue a reminder in the foundation's queue (members: in-app, email and push,
 *  honouring their preferences and quiet hours), log one email to a visitor, and give the host an in-app reminder. */
export function runReminderJob(ctx: Ctx): { queued: number; logged: number } {
  const hours = Math.max(1, Number(getSetting(ctx, 'reminder_hours_before')) || 24);
  const now = ctx.now();
  const sessions = ctx.db.all<SessionRow>("SELECT * FROM live_sessions WHERE status = 'published' AND start_at > ? AND start_at <= ?", [now, addMinutes(now, hours * 60 + 15)]);
  let queued = 0, logged = 0;
  for (const s of sessions) {
    const dueAt = addMinutes(s.start_at, -hours * 60);
    const people = ctx.db.all<RegRow>("SELECT * FROM session_registrations WHERE session_id = ? AND status = 'registered' AND reminder_sent_at IS NULL", [s.id]);
    const link = shownLink(s.join_url);
    const title = `${kindLabel(s.kind)} coming up`;
    for (const r of people) {
      if (r.user_id) {
        const body = `${s.title}, ${istWhen(s.start_at)}. ${link ? 'Open Live sessions to join.' : howToJoin(ctx, s, r.user_id)}`;
        reminders.schedule(ctx, { userId: r.user_id, refType: REF, refId: s.id, dueAt, category: 'session_reminder', title, body, channels: ['in_app', 'email', 'push'] });
        ctx.db.update('session_registrations', r.id, { reminder_sent_at: now });
        queued++;
      } else if (r.email && dueAt <= now) {
        logEmail(ctx, r.email, title, `${s.title}, ${istWhen(s.start_at)}. ${TEAM_WILL_SHARE}`);
        ctx.db.update('session_registrations', r.id, { reminder_sent_at: now });
        logged++;
      }
    }
    if (people.length || ctx.db.get("SELECT 1 FROM session_registrations WHERE session_id = ? AND status = 'registered' LIMIT 1", [s.id])) {
      reminders.schedule(ctx, { userId: s.host_id, refType: REF, refId: s.id, dueAt, category: 'session_reminder', title: `You host: ${s.title}`, body: `${istWhen(s.start_at)}. ${taken(ctx, s.id)} registered.`, channels: ['in_app'] });
    }
  }
  return { queued, logged };
}

/* ---------- calendar files ---------- */

function sequenceOf(updatedAt: string): number { return Math.floor(Date.parse(updatedAt) / 1000) % 2_000_000_000; }

/** A member's calendar file for a session they hold a place in. */
export function sessionIcsForMember(ctx: Ctx, id: string, memberId: string) {
  const s = ctx.db.get<SessionRow>('SELECT * FROM live_sessions WHERE id = ?', [id]);
  const r = s ? regOf(ctx, id, memberId) : undefined;
  if (!s || s.status === 'draft' || !r || r.status === 'cancelled') throw errors.notFound('Session');
  if (r.status === 'waitlisted') throw errors.state('You are on the waitlist; the calendar file is ready once you hold a place', { code: 'NOT_REGISTERED' });
  return sessionIcs(ctx, s, { memberId });
}

/** The host's calendar file for their own session (or an administrator's for any). */
export function sessionIcsForStaff(ctx: Ctx, id: string) {
  const s = row(ctx, id);
  assertManage(ctx, s);
  return sessionIcs(ctx, s, { memberId: null });
}

function sessionIcs(ctx: Ctx, s: SessionRow, opts: { memberId: string | null }) {
  const link = s.status === 'published' ? shownLink(s.join_url) : null;
  const description = [s.description, link ? `Join: ${link}` : s.status === 'cancelled' ? `Cancelled. ${s.cancelled_reason ?? ''}`.trim() : opts.memberId ? howToJoin(ctx, s, opts.memberId) : 'No join link yet.'].filter(Boolean).join('\n\n');
  const body = icsCalendar([{ uid: `${s.id}@bioptime`, title: `${kindLabel(s.kind)}: ${s.title}`, description, startAt: s.start_at, endAt: s.end_at, timezone: s.timezone, url: link, status: s.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED', sequence: sequenceOf(s.updated_at) }], ctx.now());
  return { filename: icsFilename(kindLabel(s.kind), s.start_at), body };
}

/** A consultation's calendar file, for its member or its coach. */
export function appointmentIcs(ctx: Ctx, appointmentId: string, viewer: 'member' | 'coach') {
  const a = appointments.getAppointment(ctx, appointmentId);
  const p = appointments.present(ctx, a);
  const label = a.kind === 'consultation' ? 'Consultation' : a.kind === 'check_in' ? 'Check-in' : 'Review';
  const other = viewer === 'member' ? (p.coachName ? `with ${p.coachName}` : '') : (p.memberName ? `with ${p.memberName}` : '');
  const link = p.meetingLink;
  const description = a.status === 'cancelled' ? `Cancelled. ${a.cancelled_reason ?? ''}`.trim() : link ? `Join: ${link}` : viewer === 'member' ? COACH_WILL_SHARE : 'No join link yet. Add one under Appointments.';
  const status = a.status === 'cancelled' || a.status === 'no_show' ? 'CANCELLED' : a.status === 'requested' ? 'TENTATIVE' : 'CONFIRMED';
  const body = icsCalendar([{ uid: `${a.id}@bioptime`, title: `Bioptime ${label.toLowerCase()} ${other}`.trim(), description, startAt: a.start_at, endAt: a.end_at, timezone: a.timezone, url: link, status, sequence: sequenceOf(a.updated_at) }], ctx.now());
  return { filename: icsFilename(label, a.start_at), body };
}

/* ---------- consultation follow-through ---------- */

type NoteRow = { id: string; coach_id: string; member_id: string; kind: string; visibility: string; body: string; ref_type: string | null; ref_id: string | null; created_at: string; coach_name?: string };
type TaskRow = { id: string; title: string; detail: string; status: string; owner_id: string | null; ref_id: string | null; created_at: string; resolved_at: string | null; resolution: string | null };

function presentTask(t: TaskRow) { return { id: t.id, title: t.title, detail: t.detail, status: t.status, appointmentId: t.ref_id, createdAt: t.created_at, resolvedAt: t.resolved_at, resolution: t.resolution }; }

/** The summary for the member, the coach's private note and follow-ups of one consultation (the coach's view). */
export function summaryForCoach(ctx: Ctx, appointmentId: string) {
  const a = appointments.getAppointment(ctx, appointmentId);
  const notes = ctx.db.all<NoteRow>("SELECT n.*, u.name AS coach_name FROM coach_notes n JOIN users u ON u.id = n.coach_id WHERE n.ref_type = 'appointment' AND n.ref_id = ? ORDER BY n.created_at", [appointmentId]);
  const summary = notes.find((n) => n.visibility === 'client');
  const followUps = ctx.db.all<TaskRow>("SELECT * FROM support_tasks WHERE kind = 'coach_follow_up' AND ref_type = 'appointment' AND ref_id = ? ORDER BY created_at", [appointmentId]);
  return {
    appointment: appointments.present(ctx, a),
    summary: summary ? { id: summary.id, body: summary.body, createdAt: summary.created_at, coachName: summary.coach_name ?? null } : null,
    privateNotes: notes.filter((n) => n.visibility === 'private').map((n) => ({ id: n.id, body: n.body, createdAt: n.created_at, coachName: n.coach_name ?? null })),
    followUps: followUps.map(presentTask),
  };
}

/** The coach writes the consultation's follow-through once it is completed: a summary the member reads, an optional
 *  private note, and follow-ups for themselves. One summary per consultation. */
export function writeSummary(ctx: Ctx, appointmentId: string, input: { forMember: string; privateNote?: string; followUps?: Array<{ title: string; detail?: string }> }) {
  return ctx.db.tx(() => {
    const actor = ctx.actor;
    if (!actor || actor.role !== 'coach') throw errors.forbidden();
    const a = appointments.getAppointment(ctx, appointmentId);
    if (a.coach_id !== actor.id) throw errors.notFound('Appointment');
    if (!coachHasMember(ctx, actor.id, a.member_id)) throw errors.forbidden('This member is no longer assigned to you', 'NO_ACCESS');
    if (a.status !== 'completed') throw errors.state('Mark the consultation completed before writing its summary', { code: 'APPOINTMENT_NOT_COMPLETED' });
    if (ctx.db.get("SELECT 1 FROM coach_notes WHERE ref_type = 'appointment' AND ref_id = ? AND visibility = 'client'", [appointmentId])) throw errors.conflict('This consultation already has a summary', 'SUMMARY_EXISTS');
    const now = ctx.now();
    const noteId = randomId('cnt');
    ctx.db.insert('coach_notes', { id: noteId, coach_id: actor.id, member_id: a.member_id, kind: 'consultation', visibility: 'client', author_role: 'coach', body: input.forMember.trim(), ref_type: 'appointment', ref_id: appointmentId, created_at: now });
    let privateId: string | null = null;
    if (input.privateNote?.trim()) {
      privateId = randomId('cnt');
      ctx.db.insert('coach_notes', { id: privateId, coach_id: actor.id, member_id: a.member_id, kind: 'consultation', visibility: 'private', author_role: 'coach', body: input.privateNote.trim(), ref_type: 'appointment', ref_id: appointmentId, created_at: now });
    }
    const taskIds = (input.followUps ?? []).map((f) => openTask(ctx, { kind: 'coach_follow_up', title: f.title.trim(), detail: f.detail?.trim() || undefined, refType: 'appointment', refId: appointmentId, dedupe: false, ownerId: actor.id, notify: false }));
    const label = a.kind === 'consultation' ? 'consultation' : a.kind === 'check_in' ? 'check-in' : 'review';
    notify(ctx, { userId: a.member_id, category: 'appointment', title: `Your ${label} summary`, body: `Your coach wrote a summary of your ${label} on ${istDayLabel(a.start_at)}. Open Appointments to read it.`, data: { appointmentId }, sensitive: true });
    audit(ctx, 'appointment.summary', { type: 'appointment', id: appointmentId }, null, { noteId, privateNoteId: privateId, followUps: taskIds });
    return summaryForCoach(ctx, appointmentId);
  });
}

/** The coach's completed consultations of the last 90 days, with whether each has its summary and how many of its
 *  follow-ups are open (the Appointments page reads this beside the list). */
export function followThroughForCoach(ctx: Ctx, coachId: string) {
  const since = addMinutes(ctx.now(), -90 * 1440);
  return ctx.db.all<{ id: string; member_id: string; member_name: string; kind: string; start_at: string; has_summary: number; open_follow_ups: number }>(`SELECT a.id, a.member_id, u.name AS member_name, a.kind, a.start_at,
      EXISTS (SELECT 1 FROM coach_notes n WHERE n.ref_type = 'appointment' AND n.ref_id = a.id AND n.visibility = 'client') AS has_summary,
      (SELECT COUNT(*) FROM support_tasks t WHERE t.kind = 'coach_follow_up' AND t.ref_type = 'appointment' AND t.ref_id = a.id AND t.status IN ('open','in_progress')) AS open_follow_ups
    FROM appointments a JOIN users u ON u.id = a.member_id WHERE a.coach_id = ? AND a.status = 'completed' AND a.start_at >= ? ORDER BY a.start_at DESC LIMIT 200`, [coachId, since])
    .filter((r) => coachHasMember(ctx, coachId, r.member_id))
    .map((r) => ({ appointmentId: r.id, memberId: r.member_id, memberName: r.member_name, kind: r.kind, startAt: r.start_at, hasSummary: !!r.has_summary, openFollowUps: r.open_follow_ups }));
}

/** The member's consultation summaries (client-visible notes only). */
export function summariesForMember(ctx: Ctx, memberId: string) {
  return ctx.db.all<{ id: string; body: string; created_at: string; coach_name: string; appointment_id: string; kind: string; start_at: string }>(`SELECT n.id, n.body, n.created_at, COALESCE(c.display_name, u.name) AS coach_name, a.id AS appointment_id, a.kind, a.start_at
    FROM coach_notes n JOIN appointments a ON a.id = n.ref_id JOIN users u ON u.id = n.coach_id LEFT JOIN coach_profiles c ON c.user_id = n.coach_id
    WHERE n.member_id = ? AND a.member_id = ? AND n.ref_type = 'appointment' AND n.visibility = 'client' ORDER BY a.start_at DESC LIMIT 100`, [memberId, memberId])
    .map((r) => ({ id: r.id, appointmentId: r.appointment_id, kind: r.kind, startAt: r.start_at, coachName: r.coach_name, body: r.body, createdAt: r.created_at }));
}

/** One member's sessions and consultation follow-through, for the client record (the assigned coach, or an
 *  administrator). A coach sees their own follow-ups; an administrator sees every coach's. */
export function clientRecord(ctx: Ctx, memberId: string, viewer: { coachId: string | null }) {
  const registrations = ctx.db.all<SessionRow & { reg_status: RegistrationStatus; registered_at: string }>("SELECT s.*, r.status AS reg_status, r.registered_at FROM session_registrations r JOIN live_sessions s ON s.id = r.session_id WHERE r.user_id = ? ORDER BY s.start_at DESC LIMIT 100", [memberId])
    .map((s) => ({ sessionId: s.id, title: s.title, kind: s.kind, kindLabel: kindLabel(s.kind), startAt: s.start_at, sessionStatus: s.status, status: s.reg_status, registeredAt: s.registered_at, hostName: publicHostName(ctx, s.host_id), hostedByMe: !!viewer.coachId && s.host_id === viewer.coachId }));
  const summaries = summariesForMember(ctx, memberId);
  const followUps = ctx.db.all<TaskRow>(`SELECT t.* FROM support_tasks t JOIN appointments a ON a.id = t.ref_id WHERE t.kind = 'coach_follow_up' AND t.ref_type = 'appointment' AND a.member_id = ? ${viewer.coachId ? 'AND t.owner_id = ?' : ''} ORDER BY t.created_at DESC LIMIT 100`, viewer.coachId ? [memberId, viewer.coachId] : [memberId]).map(presentTask);
  return { registrations, summaries, followUps };
}

/* ---------- demo rows ---------- */

/** Demo mode only: insert a session as given (the seed places some in the past). Not flagged as sample: since the
 *  owner's decision of 24 October 2026 no screen labels seeded rows Sample. */
export function insertSampleSession(ctx: Ctx, input: SessionInput & { hostId: string; status: SessionStatus; cancelledReason?: string }): string {
  const id = randomId('lvs');
  const now = ctx.now();
  ctx.db.insert('live_sessions', {
    id, kind: input.kind, title: input.title, description: input.description ?? '', host_id: input.hostId, start_at: input.startAt, end_at: input.endAt, timezone: ZONE, capacity: input.capacity ?? null,
    audience: input.audience, package_ids: j.in(resolvePackages(ctx, input.packageIds ?? [])), status: input.status, join_url: null, meeting_provider: 'none', meeting_ref: null, cancelled_reason: input.cancelledReason ?? null, sample: 0,
    created_by: input.hostId, created_at: now, updated_at: now, published_at: input.status === 'draft' ? null : now, cancelled_at: input.status === 'cancelled' ? now : null, completed_at: input.status === 'completed' ? now : null,
  });
  audit(ctx, 'live_session.create', { type: REF, id }, 'initial data: a session', { kind: input.kind, audience: input.audience, hostId: input.hostId, status: input.status });
  return id;
}

/** Demo mode only: a registration written as given (attendance on a past session, a visitor's place). */
export function insertSampleRegistration(ctx: Ctx, input: { sessionId: string; userId?: string | null; name: string; email?: string | null; status: RegistrationStatus; registeredAt: string }): string {
  const id = randomId('lsr');
  ctx.db.insert('session_registrations', { id, session_id: input.sessionId, user_id: input.userId ?? null, name: input.name, email: input.email ?? null, status: input.status, registered_at: input.registeredAt, cancelled_at: null, promoted_at: null, attendance_at: input.status === 'attended' || input.status === 'no_show' ? input.registeredAt : null, reminder_sent_at: null, updated_at: input.registeredAt });
  audit(ctx, 'session.register', { type: REF, id: input.sessionId }, 'initial data: a registration', { registrationId: id, status: input.status, by: input.userId ? 'member' : 'public' });
  return id;
}
