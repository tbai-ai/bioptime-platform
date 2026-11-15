/* M9 Announcements (CAPABILITY_MAP.md 4.8; migration 0017_messaging.sql; feature flag 'messaging').

   Announcements go to members only:
   - From the team (announcements.manage): written as a draft, edited, then published now or scheduled. The audience is
     every member, or narrowed to members with an active or paused programme of chosen packages, and/or to the members of
     one coach.
   - From a coach: to their own assigned clients only (the audience always carries the coach's own id), published at
     once or scheduled. A coach withdraws only their own.
   - Who sees one is decided when they read it, so a withdrawn announcement disappears at once and a member who leaves a
     coach stops seeing that coach's announcements. Withdrawing also blanks the text of the in-app notifications it sent.
   - Bodies are plain text: tags and control characters are removed on save, and every client renders them as text.
   - Publishing emits AnnouncementPublished; the module's handler notifies each member in the audience once (in-app and
     push, kept off lock screens). Scheduled ones are published by the announcements_publish job.
   - Every change is audited: announcement.create, .update, .schedule, .publish, .withdraw (with its reason), and a
     member's first read as announcement.read.
   - Nothing clinical: announcements carry service news, never medical advice or results (the forms say so). */
import type { Ctx } from '../context.js';
import type { DemoSeedContext } from '../modules/types.js';
import type { Role } from '@bioptime/domain';
import { j } from '../db/db.js';
import { randomId } from '../lib/ids.js';
import { errors } from '../lib/errors.js';
import { addDays } from '../lib/time.js';
import { audit, emit } from './audit.js';
import { notify } from './notifications.js';

/* ---------- vocabulary ---------- */

export const ANNOUNCEMENT_STATUSES = ['draft', 'scheduled', 'published', 'withdrawn'] as const;
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];
export type Audience = { roles: ['member']; packageIds?: string[]; coachId?: string };
export const TITLE_MAX = 120;
export const BODY_MAX = 4000;
/** How far ahead an announcement can be scheduled. */
export const MAX_SCHEDULE_DAYS = 365;
export const PUBLISHED_EVENT = 'AnnouncementPublished';

type Row = {
  id: string; title: string; body: string; audience: string; origin: 'team' | 'coach'; status: AnnouncementStatus; publish_at: string | null;
  created_by: string; published_by: string | null; published_at: string | null; withdrawn_by: string | null; withdrawn_at: string | null;
  withdraw_reason: string | null; created_at: string; updated_at: string;
};

const newId = () => randomId('ann');
const system = (ctx: Ctx): Ctx => ({ ...ctx, actor: null });

/* ---------- text ---------- */

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const TAGS = /<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>/g;

/** A title: one line of plain text. */
export function cleanTitle(input: string): string {
  return input.replace(TAGS, '').replace(/[\r\n\t]+/g, ' ').replace(CONTROL, '').replace(/\s{2,}/g, ' ').trim();
}
/** A body: plain text with its line breaks; tags, comments and control characters removed. */
export function cleanBody(input: string): string {
  return input.replace(/\r\n?/g, '\n').replace(TAGS, '').replace(CONTROL, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function checkText(title: string, body: string): void {
  if (title.length < 3 || title.length > TITLE_MAX) throw errors.badRequest(`title: 3 to ${TITLE_MAX} characters of plain text`, 'TITLE_INVALID');
  if (!body.length || body.length > BODY_MAX) throw errors.badRequest(`body: 1 to ${BODY_MAX} characters of plain text`, 'BODY_INVALID');
}

/* ---------- audience ---------- */

function cleanAudience(ctx: Ctx, input: { packageIds?: string[] | null; coachId?: string | null }): Audience {
  const packageIds = [...new Set(input.packageIds ?? [])];
  if (packageIds.length > 20) throw errors.badRequest('At most 20 packages', 'AUDIENCE_INVALID');
  if (packageIds.length) {
    const known = new Set(ctx.db.all<{ id: string }>(`SELECT id FROM packages WHERE id IN (${packageIds.map(() => '?').join(', ')})`, packageIds).map((p) => p.id));
    const unknown = packageIds.filter((p) => !known.has(p));
    if (unknown.length) throw errors.badRequest(`Unknown package ${unknown.join(', ')}`, 'AUDIENCE_INVALID');
  }
  const coachId = input.coachId ?? null;
  if (coachId && !ctx.db.get("SELECT 1 FROM users WHERE id = ? AND role = 'coach'", [coachId])) throw errors.badRequest('Unknown coach', 'AUDIENCE_INVALID');
  return { roles: ['member'], ...(packageIds.length ? { packageIds } : {}), ...(coachId ? { coachId } : {}) };
}

function audienceOf(r: Row): Audience {
  const a = j.out<Partial<Audience>>(r.audience, {});
  return { roles: ['member'], ...(a.packageIds?.length ? { packageIds: a.packageIds } : {}), ...(a.coachId ? { coachId: a.coachId } : {}) };
}

/** The SQL that picks the active members an audience reaches. */
function audienceWhere(a: Audience): { sql: string; params: string[] } {
  const parts = ["u.role = 'member'", "u.state = 'active'"];
  const params: string[] = [];
  if (a.coachId) { parts.push("EXISTS (SELECT 1 FROM coach_assignments x WHERE x.member_id = u.id AND x.coach_id = ? AND x.status IN ('active','paused'))"); params.push(a.coachId); }
  if (a.packageIds?.length) { parts.push(`EXISTS (SELECT 1 FROM programmes g JOIN package_versions v ON v.id = g.package_version_id WHERE g.member_id = u.id AND g.status IN ('active','paused') AND v.package_id IN (${a.packageIds.map(() => '?').join(', ')}))`); params.push(...a.packageIds); }
  return { sql: parts.join(' AND '), params };
}

/** The members an audience reaches now. */
export function recipientIds(ctx: Ctx, a: Audience): string[] {
  const w = audienceWhere(a);
  return ctx.db.all<{ id: string }>(`SELECT u.id FROM users u WHERE ${w.sql}`, w.params).map((r) => r.id);
}
function audienceSize(ctx: Ctx, a: Audience): number {
  const w = audienceWhere(a);
  return ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM users u WHERE ${w.sql}`, w.params)!.n;
}

/** What a member belongs to, for matching audiences without a query per announcement. */
function memberScope(ctx: Ctx, memberId: string) {
  const coaches = new Set(ctx.db.all<{ coach_id: string }>("SELECT coach_id FROM coach_assignments WHERE member_id = ? AND status IN ('active','paused') AND coach_id IS NOT NULL", [memberId]).map((r) => r.coach_id));
  const packages = new Set(ctx.db.all<{ package_id: string }>("SELECT v.package_id FROM programmes g JOIN package_versions v ON v.id = g.package_version_id WHERE g.member_id = ? AND g.status IN ('active','paused')", [memberId]).map((r) => r.package_id));
  return { coaches, packages };
}
function reaches(a: Audience, scope: ReturnType<typeof memberScope>): boolean {
  if (a.coachId && !scope.coaches.has(a.coachId)) return false;
  if (a.packageIds?.length && !a.packageIds.some((p) => scope.packages.has(p))) return false;
  return true;
}

/* ---------- presentation ---------- */

function names(ctx: Ctx, idsList: Array<string | null | undefined>): Map<string, string> {
  const wanted = [...new Set(idsList.filter((x): x is string => !!x))];
  if (!wanted.length) return new Map();
  return new Map(ctx.db.all<{ id: string; name: string }>(`SELECT id, name FROM users WHERE id IN (${wanted.map(() => '?').join(', ')})`, wanted).map((u) => [u.id, u.name]));
}
function packageNames(ctx: Ctx, idsList: string[]): Map<string, string> {
  if (!idsList.length) return new Map();
  return new Map(ctx.db.all<{ id: string; name: string }>(`SELECT id, name FROM packages WHERE id IN (${idsList.map(() => '?').join(', ')})`, idsList).map((p) => [p.id, p.name]));
}

/** The team's and the coach's view: the text, the audience (names, never contact details) and how far it reached. */
function presentManaged(ctx: Ctx, rows: Row[]) {
  const people = names(ctx, rows.flatMap((r) => [r.created_by, r.published_by, r.withdrawn_by, audienceOf(r).coachId]));
  const pkgs = packageNames(ctx, [...new Set(rows.flatMap((r) => audienceOf(r).packageIds ?? []))]);
  return rows.map((r) => {
    const a = audienceOf(r);
    const reads = ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM announcement_reads WHERE announcement_id = ?', [r.id])!.n;
    return {
      id: r.id, title: r.title, body: r.body, origin: r.origin, status: r.status,
      audience: { roles: a.roles, packageIds: a.packageIds ?? [], packages: (a.packageIds ?? []).map((p) => ({ id: p, name: pkgs.get(p) ?? p })), coachId: a.coachId ?? null, coachName: a.coachId ? people.get(a.coachId) ?? null : null },
      reach: { members: r.status === 'withdrawn' ? null : audienceSize(ctx, a), reads },
      publishAt: r.publish_at, publishedAt: r.published_at, withdrawnAt: r.withdrawn_at, withdrawReason: r.withdraw_reason,
      createdBy: { id: r.created_by, name: people.get(r.created_by) ?? null }, publishedBy: r.published_by ? { id: r.published_by, name: people.get(r.published_by) ?? null } : null,
      withdrawnBy: r.withdrawn_by ? { id: r.withdrawn_by, name: people.get(r.withdrawn_by) ?? null } : null,
      createdAt: r.created_at, updatedAt: r.updated_at,
    };
  });
}
export type ManagedAnnouncement = ReturnType<typeof presentManaged>[number];

function getRow(ctx: Ctx, id: string): Row | undefined {
  if (!/^ann_[a-z0-9]{6,40}$/.test(id)) return undefined;
  return ctx.db.get<Row>('SELECT * FROM announcements WHERE id = ?', [id]);
}
function one(ctx: Ctx, id: string): ManagedAnnouncement { return presentManaged(ctx, [getRow(ctx, id)!])[0]!; }

/* =====================================================================================================================
   Member
   ===================================================================================================================== */

/** The published announcements that reach this member now, newest first, with their read state. */
export function listForMember(ctx: Ctx, memberId: string, limit = 50) {
  const scope = memberScope(ctx, memberId);
  const rows = ctx.db.all<Row & { read_at: string | null }>(`SELECT a.*, r.read_at FROM announcements a LEFT JOIN announcement_reads r ON r.announcement_id = a.id AND r.user_id = ?
    WHERE a.status = 'published' ORDER BY a.published_at DESC, a.id DESC LIMIT 500`, [memberId]).filter((r) => reaches(audienceOf(r), scope));
  const coachNames = names(ctx, rows.map((r) => (r.origin === 'coach' ? audienceOf(r).coachId : null)));
  const items = rows.slice(0, limit).map((r) => ({
    id: r.id, title: r.title, body: r.body, origin: r.origin,
    from: r.origin === 'coach' ? (coachNames.get(audienceOf(r).coachId ?? '') ?? 'Your coach') : 'The Bioptime team',
    publishedAt: r.published_at, read: !!r.read_at, readAt: r.read_at,
  }));
  return { items, unread: rows.filter((r) => !r.read_at).length };
}

/** A member marks one read (the first read is recorded and audited; later ones change nothing). */
export function markRead(ctx: Ctx, memberId: string, id: string) {
  const r = getRow(ctx, id);
  if (!r || r.status !== 'published' || !reaches(audienceOf(r), memberScope(ctx, memberId))) throw errors.notFound('Announcement');
  const now = ctx.now();
  const inserted = ctx.db.run('INSERT OR IGNORE INTO announcement_reads (announcement_id, user_id, read_at) VALUES (?, ?, ?)', [r.id, memberId, now]).changes;
  if (inserted) audit(ctx, 'announcement.read', { type: 'announcement', id: r.id }, null, { memberId });
  const readAt = ctx.db.get<{ read_at: string }>('SELECT read_at FROM announcement_reads WHERE announcement_id = ? AND user_id = ?', [r.id, memberId])!.read_at;
  return { id: r.id, read: true, readAt };
}

/** The member's data export (ApiModule.exportSections in api/modules/messaging.ts, read by api/domain/dataExport.ts
 *  buildArchive): every announcement this member opened, oldest first, as their Announcements page shows it. One their
 *  page still shows (published and still meant for them) carries what they read there: the title, the text, who it is
 *  from and when it was published. One withdrawn since, or no longer meant for them (they left that coach, or their
 *  programme changed), is gone from their page, so only the time they opened it is kept, with the reason; its text is
 *  left out, as it is from their notifications. The note does not say who withdrew it: a coach withdraws their own,
 *  and the team can withdraw any (a coach's included), so "its sender" would not always be true. Never the audience,
 *  the reach or read counts, drafts or scheduled ones, who on the team wrote, published or withdrew it, or why it was
 *  withdrawn. */
export function exportReadsForMember(ctx: Ctx, memberId: string) {
  const scope = memberScope(ctx, memberId);
  const rows = ctx.db.all<Row & { read_at: string }>('SELECT a.*, r.read_at FROM announcement_reads r JOIN announcements a ON a.id = r.announcement_id WHERE r.user_id = ? ORDER BY r.read_at, a.id', [memberId]);
  const shown = (r: Row) => r.status === 'published' && reaches(audienceOf(r), scope);
  const coachNames = names(ctx, rows.map((r) => (shown(r) && r.origin === 'coach' ? audienceOf(r).coachId : null)));
  return rows.map((r) => shown(r)
    ? { openedAt: r.read_at, title: r.title, body: r.body, from: r.origin === 'coach' ? (coachNames.get(audienceOf(r).coachId ?? '') ?? 'Your coach') : 'The Bioptime team', publishedAt: r.published_at, note: null }
    : { openedAt: r.read_at, title: null, body: null, from: null, publishedAt: null, note: r.status === 'withdrawn' ? 'Withdrawn after you opened it, so its text is no longer shown to you.' : 'No longer shown to you, so its text is left out.' });
}

/* =====================================================================================================================
   Team (announcements.manage; the routes check the permission)
   ===================================================================================================================== */

export function listAll(ctx: Ctx, opts: { status?: AnnouncementStatus; origin?: 'team' | 'coach' } = {}) {
  const where: string[] = [];
  const params: string[] = [];
  if (opts.status) { where.push('status = ?'); params.push(opts.status); }
  if (opts.origin) { where.push('origin = ?'); params.push(opts.origin); }
  const rows = ctx.db.all<Row>(`SELECT * FROM announcements ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY CASE status WHEN 'draft' THEN 0 WHEN 'scheduled' THEN 1 WHEN 'published' THEN 2 ELSE 3 END, COALESCE(published_at, publish_at, updated_at) DESC LIMIT 200`, params);
  return { items: presentManaged(ctx, rows) };
}

/** The choices for a team audience: packages and coaches by name (no contact details). */
export function audienceOptions(ctx: Ctx) {
  return {
    packages: ctx.db.all<{ id: string; name: string; kind: string; active: number }>('SELECT id, name, kind, active FROM packages ORDER BY sort, name').map((p) => ({ id: p.id, name: p.name, kind: p.kind, active: !!p.active })),
    coaches: ctx.db.all<{ id: string; name: string }>("SELECT id, name FROM users WHERE role = 'coach' AND state = 'active' ORDER BY name"),
    allMembers: audienceSize(ctx, { roles: ['member'] }),
  };
}

export function create(ctx: Ctx, input: { title: string; body: string; audience?: { packageIds?: string[] | null; coachId?: string | null } }) {
  const actor = ctx.actor;
  if (!actor) throw errors.unauthorised();
  const title = cleanTitle(input.title), body = cleanBody(input.body);
  checkText(title, body);
  const audience = cleanAudience(ctx, input.audience ?? {});
  const id = newId();
  const now = ctx.now();
  ctx.db.insert('announcements', { id, title, body, audience: j.in(audience), origin: 'team', status: 'draft', publish_at: null, created_by: actor.id, created_at: now, updated_at: now });
  audit(ctx, 'announcement.create', { type: 'announcement', id }, null, { origin: 'team', audience, title });
  return one(ctx, id);
}

function teamRow(ctx: Ctx, id: string): Row {
  const r = getRow(ctx, id);
  if (!r) throw errors.notFound('Announcement');
  return r;
}

export function update(ctx: Ctx, id: string, patch: { title?: string; body?: string; audience?: { packageIds?: string[] | null; coachId?: string | null } }) {
  const r = teamRow(ctx, id);
  if (r.origin !== 'team') throw errors.state('A coach’s announcement is changed by that coach; the team can withdraw it', { code: 'COACH_ANNOUNCEMENT' });
  if (r.status !== 'draft' && r.status !== 'scheduled') throw errors.state('Only a draft or a scheduled announcement can be changed; withdraw a published one and write a new one', { code: 'NOT_EDITABLE' });
  const title = patch.title !== undefined ? cleanTitle(patch.title) : r.title;
  const body = patch.body !== undefined ? cleanBody(patch.body) : r.body;
  checkText(title, body);
  const audience = patch.audience !== undefined ? cleanAudience(ctx, patch.audience) : audienceOf(r);
  ctx.db.update('announcements', r.id, { title, body, audience: j.in(audience), updated_at: ctx.now() });
  audit(ctx, 'announcement.update', { type: 'announcement', id: r.id }, null, { fields: Object.keys(patch), audience });
  return one(ctx, r.id);
}

/** Publish now, or schedule for later (publishAt in the future). Publishing emits AnnouncementPublished. */
function publishRow(ctx: Ctx, r: Row, publishAt?: string | null) {
  const actor = ctx.actor;
  if (!actor) throw errors.unauthorised();
  if (r.status !== 'draft' && r.status !== 'scheduled') throw errors.state(r.status === 'published' ? 'This announcement is already published' : 'A withdrawn announcement cannot be published again; write a new one', { code: 'NOT_PUBLISHABLE' });
  const now = ctx.now();
  let at = publishAt ? Date.parse(publishAt) : NaN;
  if (publishAt && Number.isNaN(at)) throw errors.badRequest('publishAt: a date and time such as 2026-11-01T09:00:00+05:30', 'PUBLISH_AT_INVALID');
  if (publishAt && at > Date.parse(addDays(now, MAX_SCHEDULE_DAYS))) throw errors.badRequest(`An announcement can be scheduled at most ${MAX_SCHEDULE_DAYS} days ahead`, 'PUBLISH_AT_INVALID');
  if (!publishAt || at <= Date.parse(now) + 60_000) at = NaN; // now, or within the minute: publish at once
  if (!Number.isNaN(at)) {
    const iso = new Date(at).toISOString();
    ctx.db.update('announcements', r.id, { status: 'scheduled', publish_at: iso, published_by: actor.id, updated_at: now });
    audit(ctx, 'announcement.schedule', { type: 'announcement', id: r.id }, null, { publishAt: iso, origin: r.origin });
    return;
  }
  ctx.db.tx(() => {
    ctx.db.update('announcements', r.id, { status: 'published', publish_at: now, published_at: now, published_by: actor.id, updated_at: now });
    audit(ctx, 'announcement.publish', { type: 'announcement', id: r.id }, null, { origin: r.origin, audience: audienceOf(r), members: audienceSize(ctx, audienceOf(r)) });
    emit(ctx, PUBLISHED_EVENT, { type: 'announcement', id: r.id }, { announcementId: r.id });
  });
}

export function publish(ctx: Ctx, id: string, publishAt?: string | null) {
  const r = teamRow(ctx, id);
  if (r.origin !== 'team') throw errors.state('A coach’s announcement is published by that coach', { code: 'COACH_ANNOUNCEMENT' });
  publishRow(ctx, r, publishAt);
  return one(ctx, r.id);
}

function withdrawRow(ctx: Ctx, r: Row, reason: string) {
  const actor = ctx.actor;
  if (!actor) throw errors.unauthorised();
  const why = (reason ?? '').trim();
  if (why.length < 3) throw errors.badRequest('Say why: the reason is recorded in the audit log', 'REASON_REQUIRED');
  if (r.status === 'withdrawn') throw errors.state('This announcement is already withdrawn', { code: 'ALREADY_WITHDRAWN' });
  const now = ctx.now();
  ctx.db.tx(() => {
    ctx.db.update('announcements', r.id, { status: 'withdrawn', withdrawn_at: now, withdrawn_by: actor.id, withdraw_reason: why, updated_at: now });
    // the in-app notifications it sent lose its text, so the withdrawn wording disappears from every bell
    ctx.db.run("UPDATE notifications SET title = 'An announcement was withdrawn', body = '', read_at = COALESCE(read_at, ?) WHERE category = 'announcement' AND json_extract(data, '$.announcementId') = ?", [now, r.id]);
    audit(ctx, 'announcement.withdraw', { type: 'announcement', id: r.id }, why, { origin: r.origin, previousStatus: r.status });
  });
}

export function withdraw(ctx: Ctx, id: string, reason: string) {
  const r = teamRow(ctx, id);
  withdrawRow(ctx, r, reason);
  return one(ctx, r.id);
}

/* =====================================================================================================================
   Coach: to their own assigned clients only
   ===================================================================================================================== */

/** How many clients a coach's announcement reaches now. */
export function coachClientCount(ctx: Ctx, coachId: string): number { return audienceSize(ctx, { roles: ['member'], coachId }); }

export function listForCoach(ctx: Ctx, coachId: string) {
  const rows = ctx.db.all<Row>("SELECT * FROM announcements WHERE origin = 'coach' AND created_by = ? ORDER BY COALESCE(published_at, publish_at, created_at) DESC LIMIT 200", [coachId]);
  return { items: presentManaged(ctx, rows), clients: coachClientCount(ctx, coachId) };
}

export function createForCoach(ctx: Ctx, coachId: string, input: { title: string; body: string; publishAt?: string | null }) {
  const title = cleanTitle(input.title), body = cleanBody(input.body);
  checkText(title, body);
  if (!coachClientCount(ctx, coachId)) throw errors.state('You have no assigned clients to send this to', { code: 'NO_RECIPIENTS' });
  const audience: Audience = { roles: ['member'], coachId };
  const id = newId();
  const now = ctx.now();
  ctx.db.tx(() => {
    ctx.db.insert('announcements', { id, title, body, audience: j.in(audience), origin: 'coach', status: 'draft', publish_at: null, created_by: coachId, created_at: now, updated_at: now });
    audit(ctx, 'announcement.create', { type: 'announcement', id }, null, { origin: 'coach', audience, title });
    publishRow(ctx, getRow(ctx, id)!, input.publishAt ?? null);
  });
  return one(ctx, id);
}

export function withdrawForCoach(ctx: Ctx, coachId: string, id: string, reason: string) {
  const r = getRow(ctx, id);
  if (!r || r.origin !== 'coach' || r.created_by !== coachId) throw errors.notFound('Announcement');
  withdrawRow(ctx, r, reason);
  return one(ctx, r.id);
}

/* =====================================================================================================================
   Delivery and scheduling
   ===================================================================================================================== */

/** The AnnouncementPublished handler: notifies each member the announcement reaches who was not notified yet (safe to
 *  run again after a failure). In-app and push; sensitive, so a lock screen shows no detail. */
export function deliver(ctx: Ctx, announcementId: string): { notified: number } {
  const r = getRow(ctx, announcementId);
  if (!r || r.status !== 'published') return { notified: 0 };
  const a = audienceOf(r);
  const done = new Set(ctx.db.all<{ user_id: string }>("SELECT user_id FROM notifications WHERE category = 'announcement' AND json_extract(data, '$.announcementId') = ?", [r.id]).map((n) => n.user_id));
  const from = r.origin === 'coach' && a.coachId ? (ctx.db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', [a.coachId])?.name ?? 'your coach') : 'Bioptime';
  let notified = 0;
  for (const userId of recipientIds(ctx, a)) {
    if (done.has(userId)) continue;
    notify(system(ctx), { userId, category: 'announcement', title: `New announcement from ${from}`, body: r.title.slice(0, 80), data: { announcementId: r.id }, channels: ['in_app', 'push'], sensitive: true });
    notified++;
  }
  return { notified };
}

/** The announcements_publish job: scheduled announcements whose time has come are published (audited by the system,
 *  naming who scheduled them). */
export function publishDue(ctx: Ctx): { published: number } {
  const now = ctx.now();
  const due = ctx.db.all<Row>("SELECT * FROM announcements WHERE status = 'scheduled' AND publish_at <= ? ORDER BY publish_at LIMIT 100", [now]);
  const sys = system(ctx);
  for (const r of due) {
    ctx.db.tx(() => {
      ctx.db.update('announcements', r.id, { status: 'published', published_at: now, updated_at: now });
      audit(sys, 'announcement.publish', { type: 'announcement', id: r.id }, 'scheduled time reached', { origin: r.origin, scheduledBy: r.published_by, publishAt: r.publish_at, members: audienceSize(ctx, audienceOf(r)) });
      emit(sys, PUBLISHED_EVENT, { type: 'announcement', id: r.id }, { announcementId: r.id });
    });
  }
  return { published: due.length };
}

/* =====================================================================================================================
   Demo rows (demo mode only), in plain words: no Demo or Sample (owner decision of 24 October 2026). Service news
   only: no clinical claims, no results, no invented community or member counts, no invented change to the service.
   ===================================================================================================================== */

export function seedDemo(demo: DemoSeedContext): void {
  const { owner, coachIds } = demo;
  const db = owner.db;
  const as = (id: string | undefined): Ctx | null => {
    if (!id) return null;
    const u = db.get<{ id: string; role: Role; email: string; name: string }>('SELECT id, role, email, name FROM users WHERE id = ?', [id]);
    return u ? { ...owner, actor: { id: u.id, role: u.role, email: u.email, name: u.name } } : null;
  };
  const welcome = create(owner, {
    title: 'Welcome to Bioptime',
    body: 'The Bioptime team posts service news here, such as a change to booking hours or a new part of the app.\n\nAnnouncements never carry medical advice or results.',
  });
  publish(owner, welcome.id);

  const core = db.get<{ id: string }>("SELECT id FROM packages WHERE slug = 'core'");
  create(owner, {
    title: 'For members on the Core package',
    body: 'A draft addressed to members with a Core programme. Drafts stay with the team until someone publishes them.',
    audience: core ? { packageIds: [core.id] } : {},
  });

  const later = create(owner, {
    title: 'A scheduled announcement',
    body: 'This announcement is scheduled for later. It is published at its time, and members are notified then.',
  });
  publish(owner, later.id, addDays(owner.now(), 3));

  const coach = as(coachIds[0]);
  if (coach && coachClientCount(owner, coach.actor!.id)) {
    createForCoach(coach, coach.actor!.id, {
      title: 'A note from your coach',
      body: 'Your coach sends notes like this to their own clients only, for things like a change to their working hours.',
    });
  }
}
