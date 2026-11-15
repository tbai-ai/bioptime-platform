/* Support requests (M4): a two-way thread between a person who asks (a member or a coach, the requester) and the
   Bioptime team. Requesters see only their own requests and never the team's internal notes; the team works the queue
   under operations.manage. Every change is audited (support_request.create, .update, .reply); a requester is notified
   when the team replies (category support), and administrators when a request arrives (category operations, in-app).

   Nothing here promises a response time: no service level is set until the owner decides one. */
import type { Ctx } from '../context.js';
import type { Role } from '@bioptime/domain';
import { randomId } from '../lib/ids.js';
import { errors } from '../lib/errors.js';
import { nextReference } from '../db/seq.js';
import { audit } from './audit.js';
import { notify, notifyPrivileged } from './notifications.js';
import { permissionsFor, requireActor, requirePermission } from '../auth/permissions.js';

export const SUPPORT_CATEGORIES = ['account', 'billing', 'bloodwork', 'app', 'coaching', 'privacy', 'other'] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];
export const SUPPORT_STATUSES = ['open', 'waiting_on_requester', 'resolved', 'closed'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export const CATEGORY_LABELS: Record<SupportCategory, string> = { account: 'Account and sign-in', billing: 'Payments and orders', bloodwork: 'Blood tests and reports', app: 'The app or portal', coaching: 'Coaching', privacy: 'Privacy and your data', other: 'Something else' };

export type RequestRow = {
  id: string; reference: string; requester_id: string; requester_role: Role; category: SupportCategory; subject: string; status: SupportStatus;
  assigned_to: string | null; created_at: string; updated_at: string; last_message_at: string | null; resolved_at: string | null;
};
type MessageRow = { id: string; request_id: string; author_id: string; body: string; internal: number; file_id: string | null; created_at: string; author_name: string | null; author_role: Role | null };

const newRequestId = () => randomId('sup');
const newMessageId = () => randomId('spm');

function row(ctx: Ctx, id: string): RequestRow | undefined {
  if (!/^sup_[a-z0-9]{6,40}$/.test(id)) return undefined;
  return ctx.db.get<RequestRow>('SELECT * FROM support_requests WHERE id = ?', [id]);
}

function messages(ctx: Ctx, requestId: string, includeInternal: boolean): MessageRow[] {
  return ctx.db.all<MessageRow>(`SELECT m.*, u.name AS author_name, u.role AS author_role FROM support_messages m LEFT JOIN users u ON u.id = m.author_id WHERE m.request_id = ? ${includeInternal ? '' : 'AND m.internal = 0'} ORDER BY m.created_at, m.id`, [requestId]);
}

/** What the requester sees: their request and the public thread. The team's names are shown as "Bioptime team". */
function requesterView(ctx: Ctx, r: RequestRow, withThread: boolean) {
  const me = ctx.actor?.id;
  return {
    id: r.id, reference: r.reference, category: r.category, categoryLabel: CATEGORY_LABELS[r.category], subject: r.subject, status: r.status,
    createdAt: r.created_at, updatedAt: r.updated_at, lastMessageAt: r.last_message_at, resolvedAt: r.resolved_at,
    ...(withThread ? {
      messages: messages(ctx, r.id, false).map((m) => ({ id: m.id, body: m.body, createdAt: m.created_at, mine: m.author_id === me, fromTeam: m.author_id !== r.requester_id, authorName: m.author_id === r.requester_id ? (m.author_id === me ? 'You' : m.author_name ?? '') : 'Bioptime team' })),
    } : {}),
  };
}

/** What the team sees: who asked (name, role, email; never a phone number), who owns it, and every message with its
 *  internal flag. Administrators may read the email, the account identifier they manage. */
function staffView(ctx: Ctx, r: RequestRow, withThread: boolean) {
  const requester = ctx.db.get<{ id: string; name: string; email: string; role: Role; state: string }>('SELECT id, name, email, role, state FROM users WHERE id = ?', [r.requester_id]);
  const assignee = r.assigned_to ? ctx.db.get<{ id: string; name: string }>('SELECT id, name FROM users WHERE id = ?', [r.assigned_to]) : undefined;
  const counts = ctx.db.get<{ total: number; internal: number }>('SELECT COUNT(*) total, COALESCE(SUM(internal), 0) internal FROM support_messages WHERE request_id = ?', [r.id]);
  return {
    id: r.id, reference: r.reference, category: r.category, categoryLabel: CATEGORY_LABELS[r.category], subject: r.subject, status: r.status,
    requester: requester ? { id: requester.id, name: requester.name, email: requester.email, role: requester.role, state: requester.state } : null,
    requesterRole: r.requester_role,
    assignedTo: assignee ? { id: assignee.id, name: assignee.name } : null,
    createdAt: r.created_at, updatedAt: r.updated_at, lastMessageAt: r.last_message_at, resolvedAt: r.resolved_at,
    messageCount: counts?.total ?? 0, internalCount: counts?.internal ?? 0,
    ...(withThread ? {
      messages: messages(ctx, r.id, true).map((m) => ({ id: m.id, body: m.body, internal: !!m.internal, createdAt: m.created_at, fromRequester: m.author_id === r.requester_id, author: { id: m.author_id, name: m.author_name ?? '', role: m.author_role } })),
    } : {}),
  };
}

/* ---------- the requester ---------- */

/** Open a request: the first message is the description. Any signed-in person may ask. */
export function createRequest(ctx: Ctx, input: { category: SupportCategory; subject: string; body: string }) {
  const actor = requireActor(ctx);
  const now = ctx.now();
  const id = newRequestId();
  const reference = ctx.db.tx(() => {
    const ref = nextReference(ctx.db, 'SUP');
    ctx.db.insert('support_requests', { id, reference: ref, requester_id: actor.id, requester_role: actor.role, category: input.category, subject: input.subject, status: 'open', assigned_to: null, created_at: now, updated_at: now, last_message_at: now, resolved_at: null });
    ctx.db.insert('support_messages', { id: newMessageId(), request_id: id, author_id: actor.id, body: input.body, internal: 0, file_id: null, created_at: now });
    audit(ctx, 'support_request.create', { type: 'support_request', id }, null, { reference: ref, category: input.category, requesterRole: actor.role });
    return ref;
  });
  // the alert names the category only: what the person wrote may carry health detail, so it stays in the portal
  notifyPrivileged(ctx, { category: 'operations', title: `New support request ${reference}`, body: `${CATEGORY_LABELS[input.category]}, from a ${actor.role}. Open Support to read it.`, data: { supportRequestId: id, reference }, sensitive: true });
  return requesterView(ctx, row(ctx, id)!, true);
}

/** My requests, newest activity first. */
export function listMine(ctx: Ctx) {
  const actor = requireActor(ctx);
  return ctx.db.all<RequestRow>('SELECT * FROM support_requests WHERE requester_id = ? ORDER BY updated_at DESC, id LIMIT 200', [actor.id]).map((r) => requesterView(ctx, r, false));
}

/** One of my requests with the public thread. Someone else's request is "not found", whoever asks. */
export function getMine(ctx: Ctx, id: string) {
  const actor = requireActor(ctx);
  const r = row(ctx, id);
  if (!r || r.requester_id !== actor.id) throw errors.notFound('Support request');
  return requesterView(ctx, r, true);
}

/** The requester adds to the thread. A reply reopens a request that was waiting on them or marked resolved; a closed
 *  request takes no more messages (open a new one). */
export function replyAsRequester(ctx: Ctx, id: string, body: string) {
  const actor = requireActor(ctx);
  const r = row(ctx, id);
  if (!r || r.requester_id !== actor.id) throw errors.notFound('Support request');
  if (r.status === 'closed') throw errors.state('This request is closed. Open a new request and mention its reference.', { code: 'REQUEST_CLOSED', reference: r.reference });
  const now = ctx.now();
  ctx.db.tx(() => {
    ctx.db.insert('support_messages', { id: newMessageId(), request_id: id, author_id: actor.id, body, internal: 0, file_id: null, created_at: now });
    ctx.db.update('support_requests', id, { status: 'open', updated_at: now, last_message_at: now, resolved_at: r.status === 'resolved' ? null : undefined });
    audit(ctx, 'support_request.reply', { type: 'support_request', id }, null, { reference: r.reference, by: 'requester', internal: false, reopened: r.status !== 'open' });
  });
  const alert = { category: 'operations', title: `New reply on ${r.reference}`, body: 'The requester replied. Open Support to read it.', data: { supportRequestId: id, reference: r.reference }, sensitive: true } as const;
  if (r.assigned_to) notify(ctx, { ...alert, userId: r.assigned_to, channels: ['in_app'] });
  else notifyPrivileged(ctx, alert);
  return requesterView(ctx, row(ctx, id)!, true);
}

/* ---------- the team (operations.manage) ---------- */

export type QueueFilter = { status?: SupportStatus | 'active'; category?: SupportCategory; assigned?: 'me' | 'none'; requesterId?: string; q?: string };

/** The queue: filters by status (active = open or waiting), category, owner, requester and reference or subject. */
export function listQueue(ctx: Ctx, f: QueueFilter) {
  const actor = requirePermission(ctx, 'operations.manage');
  const where: string[] = [];
  const params: string[] = [];
  if (f.status === 'active') where.push("r.status IN ('open','waiting_on_requester')");
  else if (f.status) { where.push('r.status = ?'); params.push(f.status); }
  if (f.category) { where.push('r.category = ?'); params.push(f.category); }
  if (f.assigned === 'me') { where.push('r.assigned_to = ?'); params.push(actor.id); }
  if (f.assigned === 'none') where.push('r.assigned_to IS NULL');
  if (f.requesterId) { where.push('r.requester_id = ?'); params.push(f.requesterId); }
  if (f.q) { where.push('(r.reference LIKE ? OR r.subject LIKE ?)'); params.push(`%${f.q}%`, `%${f.q}%`); }
  const rows = ctx.db.all<RequestRow>(`SELECT r.* FROM support_requests r ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY CASE r.status WHEN 'open' THEN 0 WHEN 'waiting_on_requester' THEN 1 WHEN 'resolved' THEN 2 ELSE 3 END, r.updated_at DESC LIMIT 500`, params);
  const summary = ctx.db.all<{ status: SupportStatus; n: number }>('SELECT status, COUNT(*) n FROM support_requests GROUP BY status');
  return { items: rows.map((r) => staffView(ctx, r, false)), counts: Object.fromEntries(SUPPORT_STATUSES.map((s) => [s, summary.find((x) => x.status === s)?.n ?? 0])) as Record<SupportStatus, number> };
}

export function getForTeam(ctx: Ctx, id: string) {
  requirePermission(ctx, 'operations.manage');
  const r = row(ctx, id);
  if (!r) throw errors.notFound('Support request');
  return staffView(ctx, r, true);
}

function checkAssignee(ctx: Ctx, userId: string): void {
  const u = ctx.db.get<{ id: string; role: Role; state: string }>('SELECT id, role, state FROM users WHERE id = ?', [userId]);
  if (!u || (u.role !== 'admin' && u.role !== 'owner') || u.state !== 'active') throw errors.badRequest('Requests are owned by an active administrator', 'ASSIGNEE_INVALID');
  if (!permissionsFor(ctx, u).includes('operations.manage')) throw errors.badRequest('That administrator does not hold the operations permission', 'ASSIGNEE_INVALID');
}

/** Assign, take or change the status. The reason is recorded with the change. */
export function updateRequest(ctx: Ctx, id: string, patch: { status?: SupportStatus; assignedTo?: string | null }, reason?: string) {
  requirePermission(ctx, 'operations.manage');
  const r = row(ctx, id);
  if (!r) throw errors.notFound('Support request');
  if (patch.status === undefined && patch.assignedTo === undefined) throw errors.badRequest('Nothing to change', 'NOTHING_TO_CHANGE');
  if (patch.assignedTo) checkAssignee(ctx, patch.assignedTo);
  const now = ctx.now();
  const status = patch.status ?? r.status;
  const resolvedNow = (status === 'resolved' || status === 'closed') && r.status !== 'resolved' && r.status !== 'closed';
  ctx.db.update('support_requests', id, {
    status: patch.status, assigned_to: patch.assignedTo === undefined ? undefined : patch.assignedTo, updated_at: now,
    resolved_at: resolvedNow ? now : status === 'open' || status === 'waiting_on_requester' ? null : undefined,
  });
  audit(ctx, 'support_request.update', { type: 'support_request', id }, reason?.trim() || null, { reference: r.reference, ...(patch.status !== undefined ? { status: patch.status, previousStatus: r.status } : {}), ...(patch.assignedTo !== undefined ? { assignedTo: patch.assignedTo, previousAssignee: r.assigned_to } : {}) });
  return staffView(ctx, row(ctx, id)!, true);
}

/** The team replies to the requester (notified) or writes an internal note (never shown to the requester, nobody
 *  notified). A reply waits on the requester unless another status is chosen; an unowned request is taken by whoever
 *  answers it. */
export function replyAsTeam(ctx: Ctx, id: string, input: { body: string; internal: boolean; status?: SupportStatus }) {
  const actor = requirePermission(ctx, 'operations.manage');
  const r = row(ctx, id);
  if (!r) throw errors.notFound('Support request');
  if (r.requester_id === actor.id) throw errors.state('Someone else on the team answers your own request', { code: 'OWN_REQUEST' });
  if (r.status === 'closed' && !input.internal && input.status !== 'open' && input.status !== 'waiting_on_requester') throw errors.state('This request is closed. Reopen it to reply.', { code: 'REQUEST_CLOSED' });
  const now = ctx.now();
  const status: SupportStatus = input.status ?? (input.internal ? r.status : 'waiting_on_requester');
  const resolvedNow = (status === 'resolved' || status === 'closed') && r.status !== 'resolved' && r.status !== 'closed';
  ctx.db.tx(() => {
    ctx.db.insert('support_messages', { id: newMessageId(), request_id: id, author_id: actor.id, body: input.body, internal: input.internal ? 1 : 0, file_id: null, created_at: now });
    ctx.db.update('support_requests', id, {
      status, assigned_to: r.assigned_to ?? actor.id, updated_at: now, last_message_at: input.internal ? undefined : now,
      resolved_at: resolvedNow ? now : status === 'open' || status === 'waiting_on_requester' ? null : undefined,
    });
    audit(ctx, 'support_request.reply', { type: 'support_request', id }, null, { reference: r.reference, by: 'team', internal: input.internal, status, previousStatus: r.status });
  });
  if (!input.internal) {
    // the reply itself stays in the portal and the app; the notification only says one arrived
    notify(ctx, { userId: r.requester_id, category: 'support', title: `Reply to ${r.reference}`, body: 'The Bioptime team replied to your support request. Open Help and support to read it.', data: { supportRequestId: id, reference: r.reference }, sensitive: true });
  }
  return staffView(ctx, row(ctx, id)!, true);
}
