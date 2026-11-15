/* Growth: discovery calls for prospects, the newsletter (double opt-in), corporate enquiries and the team's handling of
   them. The package finder, the health calculators and the webinars page keep nothing here (see api/modules/growth.ts).

   - Nobody who writes in gets an account: a prospect, a subscriber or a company contact is a row with an email address,
     never a user, so nothing here can create an account or a staff role.
   - Every answer to a public form is the same ({ received: true }), whether the row is new, a repeat or caught by the
     honeypot, so nobody can learn from the answer whether an address has written in before. What happened goes to the
     address itself, as an email recorded in the outbox (EMAIL_PROVIDER is the outbox until a provider is set up).
   - The confirmation never promises a time: the team gets in touch, and nothing is booked until they have.
   - The team sees phone numbers only with members.view_restricted (the routes strip them otherwise). A coach a call is
     assigned to sees the name, the stated goals and the preferred times, never the email address or the phone number.
   - Every change is audited; audit rows carry references and counts, never an email address, a phone number or a note. */
import type { Ctx } from '../context.js';
import { randomId } from '../lib/ids.js';
import { AppError, errors } from '../lib/errors.js';
import { j } from '../db/db.js';
import { hmacHex, randomToken, safeEqual, sha256 } from '../lib/crypto.js';
import { addMinutes } from '../lib/time.js';
import { audit } from './audit.js';
import { notify } from './notifications.js';
import { permissionsFor } from '../auth/permissions.js';

/* ---------- vocabulary ---------- */

export const PERMISSION = 'growth.manage' as const;
export const DISCOVERY_STATUSES = ['new', 'contacted', 'booked', 'closed'] as const;
export type DiscoveryStatus = (typeof DISCOVERY_STATUSES)[number];
export const CORPORATE_STATUSES = ['new', 'contacted', 'in_discussion', 'closed'] as const;
export type CorporateStatus = (typeof CORPORATE_STATUSES)[number];
export const NEWSLETTER_STATUSES = ['pending', 'confirmed', 'unsubscribed'] as const;
export type NewsletterStatus = (typeof NEWSLETTER_STATUSES)[number];
export const TEAM_SIZES = ['1-10', '11-50', '51-200', '201-1000', '1000+'] as const;
/** What a company may ask about: only things Bioptime runs today (coaching, blood tests, live sessions, courses). */
export const CORPORATE_INTERESTS = ['coaching', 'blood_tests', 'live_sessions', 'courses', 'other'] as const;
export const CORPORATE_INTEREST_LABELS: Record<(typeof CORPORATE_INTERESTS)[number], string> = {
  coaching: 'Coaching for team members', blood_tests: 'Blood tests for team members', live_sessions: 'Group sessions and webinars', courses: 'Courses in the app', other: 'Something else',
};
/** Where a discovery call request came from (the website page that sent it). */
export const DISCOVERY_SOURCES = ['website', 'package_finder', 'calculators', 'webinars', 'corporate'] as const;

/** The wording a visitor agreed to, by version. The website sends the version it showed; the server refuses any other.
 *  Earlier versions stay listed so a record keeps the exact words its person agreed to. */
export const CONTACT_CONSENT_VERSION = 'contact-2026-10-24b';
export const NEWSLETTER_CONSENT_VERSION = 'newsletter-2026-10-24';
export const CONSENT_TEXTS: Record<string, string> = {
  // the first wording pointed at the privacy policy, which did not yet describe these requests (replaced the same day)
  'contact-2026-10-24': 'Bioptime may contact me by email (and by phone, if I gave a number) about this request. My details are used only for this and kept as the privacy policy describes.',
  [CONTACT_CONSENT_VERSION]: 'Bioptime may contact me by email (and by phone, if I gave a number) about this request. My details are used only for this and are deleted 180 days after the request is closed.',
  [NEWSLETTER_CONSENT_VERSION]: 'Email me the Bioptime newsletter. I will confirm by email first, and every email has a link to unsubscribe.',
};

/** How long a newsletter confirmation link works. */
export const CONFIRM_HOURS = 72;
/** A repeat sign-up within this many minutes sends no second confirmation email (so a form cannot flood an inbox). */
export const RESEND_AFTER_MINUTES = 10;
/** A second discovery call request from the same address while one is open within this window adds nothing. */
export const DUPLICATE_WINDOW_HOURS = 24;
/** Retention, applied by the module's daily privacy_retention job (it keeps running while the module is off):
 *  - pending sign-ups whose confirmation link expired PENDING_RETENTION_DAYS ago never agreed twice, so they go;
 *  - an address that left the newsletter goes UNSUBSCRIBED_RETENTION_DAYS after it unsubscribed;
 *  - a closed discovery call or corporate enquiry goes CLOSED_RETENTION_DAYS after it was closed (the period the privacy
 *    policy already gives appointment requests from people who never became members), and one nobody has changed for
 *    IDLE_RETENTION_DAYS goes even if it was never closed.
 *  Each goes with its team notes and the emails recorded to that address about it; the audit row holds counts only. */
export const PENDING_RETENTION_DAYS = 30;
export const UNSUBSCRIBED_RETENTION_DAYS = 30;
export const CLOSED_RETENTION_DAYS = 180;
export const IDLE_RETENTION_DAYS = 365;
/** Publicly offered slots start at least this far ahead, so nobody picks a time that is about to pass. */
export const SLOT_LEAD_MINUTES = 120;

/* ---------- small helpers ---------- */

const now = (ctx: Ctx) => ctx.now();

function nextRef(ctx: Ctx, prefix: 'DC' | 'CE'): string {
  return ctx.db.tx(() => {
    ctx.db.run('UPDATE sequences SET value = value + 1 WHERE name = ?', [prefix]);
    const row = ctx.db.get<{ value: number }>('SELECT value FROM sequences WHERE name = ?', [prefix]);
    if (!row) throw new Error(`sequence ${prefix} missing`);
    return `${prefix}-${row.value}`;
  });
}

/** An email to someone without an account, recorded in the outbox like every other email (nothing is delivered while
 *  EMAIL_PROVIDER is the outbox). */
function logEmail(ctx: Ctx, to: string, subject: string, body: string): void {
  ctx.db.insert('outbox_messages', { id: randomId('obx'), channel: 'email', to_address: to, subject, body, notification_id: null, status: 'logged', created_at: now(ctx) });
}

/** In-app note to the people who handle growth (active owners and administrators holding growth.manage). Only the
 *  reference: never the person's name, email or words, which stay behind the permission. */
function notifyTeam(ctx: Ctx, title: string, body: string, data: Record<string, unknown>): void {
  const staff = ctx.db.all<{ id: string; role: string }>("SELECT id, role FROM users WHERE role IN ('admin','owner') AND state = 'active'");
  for (const u of staff) if (permissionsFor(ctx, u).includes(PERMISSION)) notify(ctx, { userId: u.id, category: 'operations', title, body, data, channels: ['in_app'] });
}

const IST = 330 * 60_000;
/** "Mon 27 Oct, 18:30 IST" */
export function istLabel(iso: string): string {
  const d = new Date(new Date(iso).getTime() + IST);
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `${day} ${d.getUTCDate()} ${month}, ${d.toISOString().slice(11, 16)} IST`;
}
function slotLabel(s: { start_at: string; end_at: string }): string { return `${istLabel(s.start_at)} to ${new Date(new Date(s.end_at).getTime() + IST).toISOString().slice(11, 16)}`; }
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
/** The subjects of the emails recorded to people here: the retention clean-up finds a request's emails by them. */
const callSubject = (reference: string) => `We have your request for a call (${reference})`;
const corporateSubject = (reference: string) => `Your enquiry about Bioptime for teams (${reference})`;
const NEWSLETTER_SUBJECTS = ['Confirm your Bioptime newsletter sign-up', 'You are subscribed to the Bioptime newsletter'] as const;
const origin = (ctx: Ctx) => ctx.config.PUBLIC_ORIGIN.replace(/\/+$/, '');

type UserLite = { id: string; name: string; role: string };
function userLite(ctx: Ctx, id: string | null): UserLite | null {
  if (!id) return null;
  return ctx.db.get<UserLite>('SELECT id, name, role FROM users WHERE id = ?', [id]) ?? null;
}

/** Who a request can be assigned to: active owners and administrators holding growth.manage, and active coaches. */
export function assignees(ctx: Ctx): UserLite[] {
  const rows = ctx.db.all<UserLite>("SELECT id, name, role FROM users WHERE role IN ('owner','admin','coach') AND state = 'active' ORDER BY CASE role WHEN 'coach' THEN 1 ELSE 0 END, name");
  return rows.filter((u) => u.role === 'coach' || permissionsFor(ctx, u).includes(PERMISSION));
}
function requireAssignee(ctx: Ctx, id: string): UserLite {
  const u = assignees(ctx).find((x) => x.id === id);
  if (!u) throw errors.badRequest('Assign to an active coach or a team member who handles growth', 'ASSIGNEE_INVALID');
  return u;
}

/* ---------- call slots ---------- */

type SlotRow = { id: string; start_at: string; end_at: string; status: 'published' | 'withdrawn'; created_by: string | null; created_at: string; updated_at: string; withdrawn_at: string | null };
const presentSlot = (s: SlotRow) => ({ id: s.id, startAt: s.start_at, endAt: s.end_at, label: slotLabel(s) });

/** What the website offers: published slots starting at least SLOT_LEAD_MINUTES from now, the next 30. */
export function publicSlots(ctx: Ctx) {
  return ctx.db.all<SlotRow>("SELECT * FROM growth_call_slots WHERE status = 'published' AND start_at > ? ORDER BY start_at LIMIT 30", [addMinutes(now(ctx), SLOT_LEAD_MINUTES)]).map(presentSlot);
}

/** The team's list: upcoming slots (published or withdrawn) and those of the last 14 days, with how many requests named each. */
export function adminSlots(ctx: Ctx) {
  const rows = ctx.db.all<SlotRow>('SELECT * FROM growth_call_slots WHERE start_at > ? ORDER BY start_at LIMIT 200', [addMinutes(now(ctx), -14 * 1440)]);
  const chosen = new Map<string, number>();
  for (const r of ctx.db.all<{ preferred_slot_ids: string }>("SELECT preferred_slot_ids FROM growth_discovery_calls WHERE status != 'closed'")) for (const id of j.out<string[]>(r.preferred_slot_ids, [])) chosen.set(id, (chosen.get(id) ?? 0) + 1);
  return rows.map((s) => ({ ...presentSlot(s), status: s.status, past: s.start_at <= now(ctx), requests: chosen.get(s.id) ?? 0 }));
}

export function createSlot(ctx: Ctx, input: { startAt: string; endAt: string }) {
  const start = new Date(input.startAt).toISOString(), end = new Date(input.endAt).toISOString();
  const minutes = (Date.parse(end) - Date.parse(start)) / 60_000;
  if (minutes < 10 || minutes > 180) throw errors.badRequest('A slot lasts between 10 minutes and 3 hours', 'SLOT_LENGTH');
  if (start <= now(ctx)) throw errors.badRequest('Choose a time in the future', 'SLOT_PAST');
  if (Date.parse(start) - Date.parse(now(ctx)) > 180 * 86_400_000) throw errors.badRequest('Slots can be offered up to 180 days ahead', 'SLOT_TOO_FAR');
  if (ctx.db.get("SELECT 1 FROM growth_call_slots WHERE status = 'published' AND start_at < ? AND end_at > ?", [end, start])) throw errors.conflict('This overlaps a slot already offered', 'SLOT_OVERLAP');
  const id = randomId('gcs');
  ctx.db.insert('growth_call_slots', { id, start_at: start, end_at: end, status: 'published', created_by: ctx.actor?.id ?? null, created_at: now(ctx), updated_at: now(ctx), withdrawn_at: null });
  audit(ctx, 'growth.slot.create', { type: 'growth_call_slot', id }, null, { startAt: start, endAt: end });
  return presentSlot(ctx.db.get<SlotRow>('SELECT * FROM growth_call_slots WHERE id = ?', [id])!);
}

/** Withdraw an offered slot: the website stops offering it; requests that named it keep the name of the time. */
export function withdrawSlot(ctx: Ctx, id: string, reason?: string) {
  const s = ctx.db.get<SlotRow>('SELECT * FROM growth_call_slots WHERE id = ?', [id]);
  if (!s) throw errors.notFound('Slot');
  if (s.status === 'withdrawn') return presentSlot(s);
  ctx.db.update('growth_call_slots', id, { status: 'withdrawn', withdrawn_at: now(ctx), updated_at: now(ctx) });
  audit(ctx, 'growth.slot.withdraw', { type: 'growth_call_slot', id }, reason ?? null, {});
  return presentSlot(ctx.db.get<SlotRow>('SELECT * FROM growth_call_slots WHERE id = ?', [id])!);
}

/* ---------- discovery calls ---------- */

type CallRow = {
  id: string; reference: string; name: string; email: string; phone: string | null; goals: string; preferred_slot_ids: string; preferred_windows: string | null; interests: string; source: string;
  consent_version: string; consent_at: string; status: DiscoveryStatus; assigned_to: string | null; booked_at: string | null; created_at: string; updated_at: string; closed_at: string | null;
};

export type DiscoveryInput = { name: string; email: string; phone?: string; goals: string; slotIds: string[]; windows?: string; interests: string[]; source: (typeof DISCOVERY_SOURCES)[number]; consentVersion: string };

function slotsByIds(ctx: Ctx, ids: string[]): SlotRow[] {
  if (!ids.length) return [];
  return ctx.db.all<SlotRow>(`SELECT * FROM growth_call_slots WHERE id IN (${ids.map(() => '?').join(', ')}) ORDER BY start_at`, ids);
}

/** A visitor asks for a short call. Records the request (no account), emails them a confirmation that promises no time,
 *  and tells the team. A second request from the same address while one is open (within DUPLICATE_WINDOW_HOURS) adds
 *  nothing and sends nothing; the answer is the same either way. */
export function requestDiscoveryCall(ctx: Ctx, input: DiscoveryInput): { received: true } {
  const email = input.email.trim().toLowerCase();
  const slotIds = [...new Set(input.slotIds)];
  if (!slotIds.length && !input.windows?.trim()) throw errors.validation([{ path: 'windows', message: 'Choose a time we offer or tell us when suits you' }], 'Choose a time we offer or tell us when suits you');
  const slots = slotsByIds(ctx, slotIds);
  const offered = new Set(publicSlots(ctx).map((s) => s.id));
  if (slots.length !== slotIds.length || slots.some((s) => !offered.has(s.id))) throw errors.state('One of the times you chose is no longer offered. Please choose again.', { code: 'SLOT_UNAVAILABLE' });
  return ctx.db.tx(() => {
    const open = ctx.db.get("SELECT 1 FROM growth_discovery_calls WHERE email = ? AND status IN ('new','contacted') AND created_at > ?", [email, addMinutes(now(ctx), -DUPLICATE_WINDOW_HOURS * 60)]);
    if (open) return { received: true as const };
    const id = randomId('gdc');
    const reference = nextRef(ctx, 'DC');
    ctx.db.insert('growth_discovery_calls', {
      id, reference, name: input.name.trim(), email, phone: input.phone ?? null, goals: input.goals.trim(), preferred_slot_ids: j.in(slotIds), preferred_windows: input.windows?.trim() || null,
      interests: j.in(input.interests), source: input.source, consent_version: input.consentVersion, consent_at: now(ctx), status: 'new', assigned_to: null, booked_at: null,
      created_at: now(ctx), updated_at: now(ctx), closed_at: null,
    });
    const times = [...slots.map((s) => slotLabel(s)), ...(input.windows?.trim() ? [`“${input.windows.trim()}”`] : [])];
    logEmail(ctx, email, callSubject(reference), [
      `Hello ${firstName(input.name)},`,
      `Thank you for asking for a short call with Bioptime. Your reference is ${reference}.`,
      `Someone from the team will be in touch by email${input.phone ? ' or phone' : ''} to agree a time. Nothing is booked until we have spoken with you.`,
      `The times you mentioned: ${times.join('; ')}.`,
      'If you did not ask for this, you can ignore this email. We use your details only to reply to this request.',
    ].join('\n\n'));
    notifyTeam(ctx, 'New discovery call request', `${reference} is waiting under Growth › Discovery calls.`, { discoveryCallId: id, reference });
    audit(ctx, 'growth.discovery_call.create', { type: 'discovery_call', id }, null, { reference, slots: slotIds.length, windows: !!input.windows?.trim(), source: input.source, phone: !!input.phone });
    return { received: true as const };
  });
}

function noteCount(ctx: Ctx, refType: string, id: string): number {
  return ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM growth_notes WHERE ref_type = ? AND ref_id = ?', [refType, id])!.n;
}
function notesFor(ctx: Ctx, refType: string, id: string) {
  return ctx.db.all<{ id: string; body: string; author_id: string | null; created_at: string }>('SELECT * FROM growth_notes WHERE ref_type = ? AND ref_id = ? ORDER BY created_at', [refType, id])
    .map((n) => ({ id: n.id, body: n.body, author: userLite(ctx, n.author_id), createdAt: n.created_at }));
}

function presentCall(ctx: Ctx, r: CallRow) {
  const slotIds = j.out<string[]>(r.preferred_slot_ids, []);
  return {
    id: r.id, reference: r.reference, name: r.name, email: r.email, phone: r.phone, goals: r.goals,
    preferredSlots: slotsByIds(ctx, slotIds).map((s) => ({ ...presentSlot(s), withdrawn: s.status === 'withdrawn' })), preferredWindows: r.preferred_windows,
    interests: j.out<string[]>(r.interests, []), source: r.source, consentVersion: r.consent_version, consentText: CONSENT_TEXTS[r.consent_version] ?? null, consentAt: r.consent_at,
    status: r.status, assignedTo: userLite(ctx, r.assigned_to), bookedAt: r.booked_at, createdAt: r.created_at, updatedAt: r.updated_at, closedAt: r.closed_at, noteCount: noteCount(ctx, 'discovery_call', r.id),
  };
}

function callRow(ctx: Ctx, id: string): CallRow {
  const r = ctx.db.get<CallRow>('SELECT * FROM growth_discovery_calls WHERE id = ?', [id]);
  if (!r) throw errors.notFound('Discovery call');
  return r;
}

export function listDiscoveryCalls(ctx: Ctx, f: { status?: DiscoveryStatus | 'open' | 'all'; assigned?: string }) {
  const where: string[] = [];
  const params: string[] = [];
  const status = f.status ?? 'open';
  if (status === 'open') where.push("status IN ('new','contacted','booked')");
  else if (status !== 'all') { where.push('status = ?'); params.push(status); }
  if (f.assigned === 'none') where.push('assigned_to IS NULL');
  else if (f.assigned === 'me') { where.push('assigned_to = ?'); params.push(ctx.actor?.id ?? ''); }
  else if (f.assigned) { where.push('assigned_to = ?'); params.push(f.assigned); }
  const rows = ctx.db.all<CallRow>(`SELECT * FROM growth_discovery_calls ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT 500`, params);
  const counts = Object.fromEntries(ctx.db.all<{ status: string; n: number }>('SELECT status, COUNT(*) n FROM growth_discovery_calls GROUP BY status').map((c) => [c.status, c.n]));
  return { items: rows.map((r) => presentCall(ctx, r)), counts };
}

export function getDiscoveryCall(ctx: Ctx, id: string) {
  return { ...presentCall(ctx, callRow(ctx, id)), notes: notesFor(ctx, 'discovery_call', id) };
}

export type CallPatch = { status?: DiscoveryStatus; assignedTo?: string | null; bookedAt?: string | null; note?: string };

/** Progress a request: status (contacted, booked, closed or back to new), the person handling it, the agreed time once
 *  booked, and a note. Each change is audited (the note's text stays in growth_notes, never in the audit row). Assigning
 *  someone tells them in-app with the reference only. Nothing is sent to the prospect: the team writes to them itself. */
export function updateDiscoveryCall(ctx: Ctx, id: string, patch: CallPatch) {
  return ctx.db.tx(() => {
    const r = callRow(ctx, id);
    const changes: Record<string, unknown> = {};
    const set: Record<string, string | null | undefined> = { updated_at: now(ctx) };
    if (patch.status && patch.status !== r.status) {
      set.status = patch.status;
      set.closed_at = patch.status === 'closed' ? now(ctx) : null;
      changes.status = { from: r.status, to: patch.status };
      if (patch.status !== 'booked' && patch.bookedAt === undefined && r.booked_at) set.booked_at = null;
    }
    const nextStatus = (set.status as DiscoveryStatus | undefined) ?? r.status;
    if (patch.bookedAt !== undefined) {
      if (patch.bookedAt && nextStatus !== 'booked') throw errors.badRequest('Only a booked call has an agreed time', 'NOT_BOOKED');
      const at = patch.bookedAt ? new Date(patch.bookedAt).toISOString() : null;
      if (at !== r.booked_at) { set.booked_at = at; changes.bookedAt = !!at; }
    }
    if (patch.assignedTo !== undefined && patch.assignedTo !== r.assigned_to) {
      const u = patch.assignedTo ? requireAssignee(ctx, patch.assignedTo) : null;
      set.assigned_to = u?.id ?? null;
      changes.assignedTo = { from: r.assigned_to, to: u?.id ?? null, role: u?.role ?? null };
      if (u && u.id !== ctx.actor?.id) {
        notify(ctx, { userId: u.id, category: 'operations', title: 'A discovery call is assigned to you', body: u.role === 'coach' ? `${r.reference}: the team arranges the time and shares how to join. The name, goals and preferred times are under Discovery calls.` : `${r.reference} is yours under Growth › Discovery calls.`, data: { discoveryCallId: id, reference: r.reference }, channels: ['in_app'] });
      }
    }
    const note = patch.note?.trim();
    if (!Object.keys(changes).length && !note) return getDiscoveryCall(ctx, id);
    ctx.db.update('growth_discovery_calls', id, set);
    if (note) addNoteRow(ctx, 'discovery_call', id, note);
    audit(ctx, 'growth.discovery_call.update', { type: 'discovery_call', id }, null, { reference: r.reference, ...changes, note: !!note });
    return getDiscoveryCall(ctx, id);
  });
}

function addNoteRow(ctx: Ctx, refType: 'discovery_call' | 'corporate_enquiry', refId: string, body: string): string {
  const id = randomId('gnt');
  ctx.db.insert('growth_notes', { id, ref_type: refType, ref_id: refId, author_id: ctx.actor?.id ?? null, body, created_at: now(ctx) });
  return id;
}

export function addNote(ctx: Ctx, refType: 'discovery_call' | 'corporate_enquiry', refId: string, body: string) {
  if (refType === 'discovery_call') callRow(ctx, refId); else corporateRow(ctx, refId);
  const id = addNoteRow(ctx, refType, refId, body.trim());
  // a note is activity: the request is not idle (see IDLE_RETENTION_DAYS)
  ctx.db.update(refType === 'discovery_call' ? 'growth_discovery_calls' : 'growth_corporate_enquiries', refId, { updated_at: now(ctx) });
  audit(ctx, 'growth.note.create', { type: refType, id: refId }, null, { noteId: id, length: body.trim().length });
  return notesFor(ctx, refType, refId);
}

/** A coach's own assigned calls: the name, goals, preferred times and status, never the email or phone number. */
export function callsForCoach(ctx: Ctx, coachId: string) {
  return ctx.db.all<CallRow>("SELECT * FROM growth_discovery_calls WHERE assigned_to = ? AND status != 'closed' ORDER BY created_at DESC LIMIT 100", [coachId]).map((r) => ({
    id: r.id, reference: r.reference, name: r.name, goals: r.goals,
    preferredSlots: slotsByIds(ctx, j.out<string[]>(r.preferred_slot_ids, [])).map(presentSlot), preferredWindows: r.preferred_windows,
    interests: j.out<string[]>(r.interests, []), status: r.status, bookedAt: r.booked_at, createdAt: r.created_at,
  }));
}

/* ---------- corporate enquiries ---------- */

type CorpRow = {
  id: string; reference: string; company: string; contact_name: string; email: string; phone: string | null; team_size: string; interests: string; message: string | null;
  consent_version: string; consent_at: string; status: CorporateStatus; assigned_to: string | null; created_at: string; updated_at: string; closed_at: string | null;
};
export type CorporateInput = { company: string; name: string; email: string; phone?: string; teamSize: (typeof TEAM_SIZES)[number]; interests: Array<(typeof CORPORATE_INTERESTS)[number]>; message?: string; consentVersion: string };

export function createCorporateEnquiry(ctx: Ctx, input: CorporateInput): { received: true } {
  const email = input.email.trim().toLowerCase();
  return ctx.db.tx(() => {
    const open = ctx.db.get("SELECT 1 FROM growth_corporate_enquiries WHERE email = ? AND status IN ('new','contacted') AND created_at > ?", [email, addMinutes(now(ctx), -DUPLICATE_WINDOW_HOURS * 60)]);
    if (open) return { received: true as const };
    const id = randomId('gce');
    const reference = nextRef(ctx, 'CE');
    ctx.db.insert('growth_corporate_enquiries', {
      id, reference, company: input.company.trim(), contact_name: input.name.trim(), email, phone: input.phone ?? null, team_size: input.teamSize, interests: j.in([...new Set(input.interests)]),
      message: input.message?.trim() || null, consent_version: input.consentVersion, consent_at: now(ctx), status: 'new', assigned_to: null, created_at: now(ctx), updated_at: now(ctx), closed_at: null,
    });
    logEmail(ctx, email, corporateSubject(reference), [
      `Hello ${firstName(input.name)},`,
      `Thank you for asking about Bioptime for ${input.company.trim()}. Your reference is ${reference}.`,
      'Someone from the team will reply by email. We will say plainly what we can offer your team today; nothing is agreed or priced until we have talked.',
      'If you did not send this enquiry, you can ignore this email. We use your details only to reply to it.',
    ].join('\n\n'));
    notifyTeam(ctx, 'New corporate enquiry', `${reference} is waiting under Growth › Corporate enquiries.`, { corporateEnquiryId: id, reference });
    audit(ctx, 'growth.corporate_enquiry.create', { type: 'corporate_enquiry', id }, null, { reference, teamSize: input.teamSize, interests: input.interests.length, phone: !!input.phone });
    return { received: true as const };
  });
}

function corporateRow(ctx: Ctx, id: string): CorpRow {
  const r = ctx.db.get<CorpRow>('SELECT * FROM growth_corporate_enquiries WHERE id = ?', [id]);
  if (!r) throw errors.notFound('Corporate enquiry');
  return r;
}
function presentCorporate(ctx: Ctx, r: CorpRow) {
  return {
    id: r.id, reference: r.reference, company: r.company, contactName: r.contact_name, email: r.email, phone: r.phone, teamSize: r.team_size,
    interests: j.out<string[]>(r.interests, []), message: r.message, consentVersion: r.consent_version, consentText: CONSENT_TEXTS[r.consent_version] ?? null, consentAt: r.consent_at,
    status: r.status, assignedTo: userLite(ctx, r.assigned_to), createdAt: r.created_at, updatedAt: r.updated_at, closedAt: r.closed_at, noteCount: noteCount(ctx, 'corporate_enquiry', r.id),
  };
}

export function listCorporate(ctx: Ctx, f: { status?: CorporateStatus | 'open' | 'all' }) {
  const status = f.status ?? 'open';
  const rows = status === 'all' ? ctx.db.all<CorpRow>('SELECT * FROM growth_corporate_enquiries ORDER BY created_at DESC LIMIT 500')
    : status === 'open' ? ctx.db.all<CorpRow>("SELECT * FROM growth_corporate_enquiries WHERE status != 'closed' ORDER BY created_at DESC LIMIT 500")
      : ctx.db.all<CorpRow>('SELECT * FROM growth_corporate_enquiries WHERE status = ? ORDER BY created_at DESC LIMIT 500', [status]);
  const counts = Object.fromEntries(ctx.db.all<{ status: string; n: number }>('SELECT status, COUNT(*) n FROM growth_corporate_enquiries GROUP BY status').map((c) => [c.status, c.n]));
  return { items: rows.map((r) => presentCorporate(ctx, r)), counts };
}

export function getCorporate(ctx: Ctx, id: string) {
  return { ...presentCorporate(ctx, corporateRow(ctx, id)), notes: notesFor(ctx, 'corporate_enquiry', id) };
}

export function updateCorporate(ctx: Ctx, id: string, patch: { status?: CorporateStatus; assignedTo?: string | null; note?: string }) {
  return ctx.db.tx(() => {
    const r = corporateRow(ctx, id);
    const changes: Record<string, unknown> = {};
    const set: Record<string, string | null> = { updated_at: now(ctx) };
    if (patch.status && patch.status !== r.status) { set.status = patch.status; set.closed_at = patch.status === 'closed' ? now(ctx) : null; changes.status = { from: r.status, to: patch.status }; }
    if (patch.assignedTo !== undefined && patch.assignedTo !== r.assigned_to) {
      // a corporate enquiry carries the contact's email and phone: only a team member holding growth.manage takes it
      const u = patch.assignedTo ? assignees(ctx).find((x) => x.id === patch.assignedTo && x.role !== 'coach') : null;
      if (patch.assignedTo && !u) throw errors.badRequest('Assign to a team member who handles growth', 'ASSIGNEE_INVALID');
      set.assigned_to = u?.id ?? null;
      changes.assignedTo = { from: r.assigned_to, to: u?.id ?? null };
      if (u && u.id !== ctx.actor?.id) notify(ctx, { userId: u.id, category: 'operations', title: 'A corporate enquiry is assigned to you', body: `${r.reference} is yours under Growth › Corporate enquiries.`, data: { corporateEnquiryId: id, reference: r.reference }, channels: ['in_app'] });
    }
    const note = patch.note?.trim();
    if (!Object.keys(changes).length && !note) return getCorporate(ctx, id);
    ctx.db.update('growth_corporate_enquiries', id, set);
    if (note) addNoteRow(ctx, 'corporate_enquiry', id, note);
    audit(ctx, 'growth.corporate_enquiry.update', { type: 'corporate_enquiry', id }, null, { reference: r.reference, ...changes, note: !!note });
    return getCorporate(ctx, id);
  });
}

/* ---------- newsletter ---------- */

type SubRow = { id: string; email: string; status: NewsletterStatus; consent_version: string; source: string; confirm_token_hash: string | null; confirm_expires_at: string | null; requested_at: string; confirmed_at: string | null; unsubscribed_at: string | null; created_at: string; updated_at: string };

/** The signed unsubscribe token of a subscriber: stable, so every email can carry the link, and checked without a column. */
export function unsubscribeToken(ctx: Ctx, subscriberId: string): string { return hmacHex(ctx.config.TOKEN_SECRET, `growth-newsletter-unsubscribe:${subscriberId}`).slice(0, 40); }
export function unsubscribeUrl(ctx: Ctx, subscriberId: string): string { return `${origin(ctx)}/?newsletter=unsubscribe&id=${encodeURIComponent(subscriberId)}&token=${unsubscribeToken(ctx, subscriberId)}#newsletter`; }
function confirmUrl(ctx: Ctx, token: string): string { return `${origin(ctx)}/?newsletter=confirm&token=${encodeURIComponent(token)}#newsletter`; }

function sendConfirmation(ctx: Ctx, sub: { id: string; email: string }): void {
  const token = randomToken(32);
  ctx.db.update('growth_newsletter_subscribers', sub.id, { confirm_token_hash: sha256(token), confirm_expires_at: addMinutes(now(ctx), CONFIRM_HOURS * 60), requested_at: now(ctx), updated_at: now(ctx) });
  logEmail(ctx, sub.email, NEWSLETTER_SUBJECTS[0], [
    'Hello,',
    `Someone, hopefully you, asked to receive the Bioptime newsletter at this address. To confirm, open this link within ${CONFIRM_HOURS} hours:`,
    confirmUrl(ctx, token),
    'If you did not ask for this, ignore this email: nothing is sent to you unless you confirm.',
    `You can also stop it now: ${unsubscribeUrl(ctx, sub.id)}`,
  ].join('\n\n'));
}

/** Sign-up (double opt-in). New or previously unsubscribed: pending, with a fresh confirmation link by email. Pending:
 *  a new link, unless one went out in the last RESEND_AFTER_MINUTES. Confirmed: nothing changes and nothing is sent.
 *  The answer is the same in every case. */
export function subscribe(ctx: Ctx, input: { email: string; consentVersion: string; source?: string }): { received: true } {
  const email = input.email.trim().toLowerCase();
  return ctx.db.tx(() => {
    const existing = ctx.db.get<SubRow>('SELECT * FROM growth_newsletter_subscribers WHERE email = ?', [email]);
    if (existing?.status === 'confirmed') return { received: true as const };
    if (existing?.status === 'pending' && existing.requested_at > addMinutes(now(ctx), -RESEND_AFTER_MINUTES)) return { received: true as const };
    let id: string;
    if (existing) {
      id = existing.id;
      ctx.db.update('growth_newsletter_subscribers', id, { status: 'pending', consent_version: input.consentVersion, source: input.source ?? existing.source, unsubscribed_at: existing.status === 'unsubscribed' ? existing.unsubscribed_at : null, updated_at: now(ctx) });
    } else {
      id = randomId('gns');
      ctx.db.insert('growth_newsletter_subscribers', { id, email, status: 'pending', consent_version: input.consentVersion, source: input.source ?? 'website', confirm_token_hash: null, confirm_expires_at: null, requested_at: now(ctx), confirmed_at: null, unsubscribed_at: null, created_at: now(ctx), updated_at: now(ctx) });
    }
    sendConfirmation(ctx, { id, email });
    audit(ctx, 'growth.newsletter.subscribe', { type: 'newsletter_subscriber', id }, null, { consentVersion: input.consentVersion, again: !!existing, previous: existing?.status ?? null });
    return { received: true as const };
  });
}

/** The confirmation link: a pending sign-up becomes confirmed; the token works once. */
export function confirm(ctx: Ctx, token: string): { confirmed: true } {
  return ctx.db.tx(() => {
    const sub = ctx.db.get<SubRow>("SELECT * FROM growth_newsletter_subscribers WHERE confirm_token_hash = ? AND status = 'pending'", [sha256(token)]);
    if (!sub) throw errors.badRequest('This confirmation link is not valid. It may have been used already.', 'TOKEN_INVALID');
    if (!sub.confirm_expires_at || sub.confirm_expires_at <= now(ctx)) throw new AppError('TOKEN_EXPIRED', 410, 'This confirmation link has expired. Sign up again and we will send a new one.');
    ctx.db.update('growth_newsletter_subscribers', sub.id, { status: 'confirmed', confirmed_at: now(ctx), confirm_token_hash: null, confirm_expires_at: null, updated_at: now(ctx) });
    logEmail(ctx, sub.email, NEWSLETTER_SUBJECTS[1], [
      'Hello,',
      'Thank you for confirming. You will receive the Bioptime newsletter at this address.',
      `To stop it at any time, open this link: ${unsubscribeUrl(ctx, sub.id)}`,
    ].join('\n\n'));
    audit(ctx, 'growth.newsletter.confirm', { type: 'newsletter_subscriber', id: sub.id }, null, { consentVersion: sub.consent_version });
    return { confirmed: true as const };
  });
}

/** The unsubscribe link (signed). Works for pending and confirmed sign-ups, and again for one already unsubscribed or
 *  already deleted by the retention clean-up (the signature is checked without the row, so an old link still answers
 *  that the address is off the list). */
export function unsubscribe(ctx: Ctx, input: { id: string; token: string }): { unsubscribed: true } {
  if (!safeEqual(unsubscribeToken(ctx, input.id), input.token)) throw errors.badRequest('This unsubscribe link is not valid. Email the team and we will remove you.', 'TOKEN_INVALID');
  const sub = ctx.db.get<SubRow>('SELECT * FROM growth_newsletter_subscribers WHERE id = ?', [input.id]);
  if (!sub || sub.status === 'unsubscribed') return { unsubscribed: true };
  ctx.db.update('growth_newsletter_subscribers', sub.id, { status: 'unsubscribed', unsubscribed_at: now(ctx), confirm_token_hash: null, confirm_expires_at: null, updated_at: now(ctx) });
  audit(ctx, 'growth.newsletter.unsubscribe', { type: 'newsletter_subscriber', id: sub.id }, null, { by: 'link', previous: sub.status });
  return { unsubscribed: true };
}

/** The team removes someone from the list (for example on request by email), with a reason. */
export function adminUnsubscribe(ctx: Ctx, id: string, reason: string) {
  const sub = ctx.db.get<SubRow>('SELECT * FROM growth_newsletter_subscribers WHERE id = ?', [id]);
  if (!sub) throw errors.notFound('Subscriber');
  if (sub.status !== 'unsubscribed') {
    ctx.db.update('growth_newsletter_subscribers', id, { status: 'unsubscribed', unsubscribed_at: now(ctx), confirm_token_hash: null, confirm_expires_at: null, updated_at: now(ctx) });
    audit(ctx, 'growth.newsletter.unsubscribe', { type: 'newsletter_subscriber', id }, reason, { by: 'team', previous: sub.status });
  }
  return presentSub(ctx.db.get<SubRow>('SELECT * FROM growth_newsletter_subscribers WHERE id = ?', [id])!);
}

const presentSub = (s: SubRow) => ({
  id: s.id, email: s.email, status: s.status, consentVersion: s.consent_version, consentText: CONSENT_TEXTS[s.consent_version] ?? null, source: s.source,
  requestedAt: s.requested_at, confirmedAt: s.confirmed_at, unsubscribedAt: s.unsubscribed_at, confirmExpiresAt: s.status === 'pending' ? s.confirm_expires_at : null,
});

export function listSubscribers(ctx: Ctx, f: { status?: NewsletterStatus | 'all'; q?: string }) {
  const where: string[] = [];
  const params: string[] = [];
  if (f.status && f.status !== 'all') { where.push('status = ?'); params.push(f.status); }
  if (f.q) { where.push('email LIKE ?'); params.push(`%${f.q.toLowerCase().replace(/[%_]/g, '')}%`); }
  const rows = ctx.db.all<SubRow>(`SELECT * FROM growth_newsletter_subscribers ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY requested_at DESC LIMIT 1000`, params);
  const counts = Object.fromEntries(ctx.db.all<{ status: string; n: number }>('SELECT status, COUNT(*) n FROM growth_newsletter_subscribers GROUP BY status').map((c) => [c.status, c.n]));
  return { items: rows.map(presentSub), counts };
}

/** CSV of subscribers (confirmed by default: only they agreed twice). Cells that a spreadsheet would read as a formula
 *  are prefixed with an apostrophe. The export itself is audited with its count. */
export function exportSubscribersCsv(ctx: Ctx, status: NewsletterStatus | 'all' = 'confirmed'): { csv: string; count: number } {
  const rows = ctx.db.all<SubRow>(`SELECT * FROM growth_newsletter_subscribers ${status === 'all' ? '' : 'WHERE status = ?'} ORDER BY email`, status === 'all' ? [] : [status]);
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['email', 'status', 'consent_version', 'source', 'requested_at', 'confirmed_at', 'unsubscribed_at'];
  const lines = [head.join(','), ...rows.map((r) => [r.email, r.status, r.consent_version, r.source, r.requested_at, r.confirmed_at, r.unsubscribed_at].map(cell).join(','))];
  audit(ctx, 'growth.newsletter.export', null, null, { status, count: rows.length });
  return { csv: `${lines.join('\n')}\n`, count: rows.length };
}

export type RetentionResult = { discoveryCalls: number; corporateEnquiries: number; notes: number; emails: number; pendingSignups: number; unsubscribed: number };

/** The module's privacy clean-up (job privacy_retention, daily, also while the module is off). Deletes what the
 *  retention constants above say, with the team's notes on it and the emails recorded to that address about it. The
 *  audit row says how many of each, never who. */
export function applyRetention(ctx: Ctx): RetentionResult {
  const at = now(ctx);
  const before = (days: number) => addMinutes(at, -days * 1440);
  return ctx.db.tx(() => {
    const out: RetentionResult = { discoveryCalls: 0, corporateEnquiries: 0, notes: 0, emails: 0, pendingSignups: 0, unsubscribed: 0 };
    const requests = [
      { table: 'growth_discovery_calls', refType: 'discovery_call', subject: callSubject, key: 'discoveryCalls' },
      { table: 'growth_corporate_enquiries', refType: 'corporate_enquiry', subject: corporateSubject, key: 'corporateEnquiries' },
    ] as const;
    for (const r of requests) {
      const due = ctx.db.all<{ id: string; reference: string; email: string }>(
        `SELECT id, reference, email FROM ${r.table} WHERE (status = 'closed' AND closed_at IS NOT NULL AND closed_at < ?) OR (status != 'closed' AND updated_at < ?)`,
        [before(CLOSED_RETENTION_DAYS), before(IDLE_RETENTION_DAYS)],
      );
      for (const row of due) {
        out.notes += ctx.db.run('DELETE FROM growth_notes WHERE ref_type = ? AND ref_id = ?', [r.refType, row.id]).changes;
        out.emails += ctx.db.run("DELETE FROM outbox_messages WHERE channel = 'email' AND to_address = ? AND subject = ?", [row.email, r.subject(row.reference)]).changes;
        out[r.key] += ctx.db.run(`DELETE FROM ${r.table} WHERE id = ?`, [row.id]).changes;
      }
    }
    const subs = ctx.db.all<{ id: string; email: string; status: NewsletterStatus }>(
      "SELECT id, email, status FROM growth_newsletter_subscribers WHERE (status = 'pending' AND confirm_expires_at IS NOT NULL AND confirm_expires_at < ?) OR (status = 'unsubscribed' AND unsubscribed_at IS NOT NULL AND unsubscribed_at < ?)",
      [before(PENDING_RETENTION_DAYS), before(UNSUBSCRIBED_RETENTION_DAYS)],
    );
    for (const sub of subs) {
      out.emails += ctx.db.run(`DELETE FROM outbox_messages WHERE channel = 'email' AND to_address = ? AND subject IN (${NEWSLETTER_SUBJECTS.map(() => '?').join(', ')})`, [sub.email, ...NEWSLETTER_SUBJECTS]).changes;
      ctx.db.run('DELETE FROM growth_newsletter_subscribers WHERE id = ?', [sub.id]);
      if (sub.status === 'pending') out.pendingSignups += 1; else out.unsubscribed += 1;
    }
    if (out.discoveryCalls || out.corporateEnquiries || out.pendingSignups || out.unsubscribed) {
      audit(ctx, 'growth.retention', null, null, { ...out, closedDays: CLOSED_RETENTION_DAYS, idleDays: IDLE_RETENTION_DAYS, pendingDays: PENDING_RETENTION_DAYS, unsubscribedDays: UNSUBSCRIBED_RETENTION_DAYS });
    }
    return out;
  });
}

/* ---------- overview ---------- */

export function summary(ctx: Ctx) {
  const n = (sql: string, params: string[] = []) => ctx.db.get<{ n: number }>(sql, params)!.n;
  return {
    discoveryNew: n("SELECT COUNT(*) n FROM growth_discovery_calls WHERE status = 'new'"),
    discoveryOpen: n("SELECT COUNT(*) n FROM growth_discovery_calls WHERE status IN ('new','contacted','booked')"),
    corporateNew: n("SELECT COUNT(*) n FROM growth_corporate_enquiries WHERE status = 'new'"),
    corporateOpen: n("SELECT COUNT(*) n FROM growth_corporate_enquiries WHERE status != 'closed'"),
    subscribersConfirmed: n("SELECT COUNT(*) n FROM growth_newsletter_subscribers WHERE status = 'confirmed'"),
    subscribersPending: n("SELECT COUNT(*) n FROM growth_newsletter_subscribers WHERE status = 'pending'"),
    slotsOffered: publicSlots(ctx).length,
  };
}

