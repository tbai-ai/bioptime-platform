/* Member ↔ coach messaging. Participants only; admins may read for support (audited) but never write as someone else.
   Files on messages (M9, flag 'messaging'): send() takes the ids of files the sender uploaded to this conversation
   (api/domain/attachments.ts) and ties them to the new message; the text may then be empty. The thread lists each
   message's files (names, types and sizes); a file itself opens only through a 5-minute token. */
import type { Ctx } from '../context.js';
import { ids } from '../lib/ids.js';
import { errors } from '../lib/errors.js';
import { coachHasMember } from '../auth/permissions.js';
import { audit } from './audit.js';
import { notify } from './notifications.js';
import { requireFeature } from './features.js';
import * as attachments from './attachments.js';

type Conversation = { id: string; member_id: string; coach_id: string; created_at: string; last_message_at: string | null };

export function conversationsFor(ctx: Ctx, userId: string) {
  const role = ctx.actor?.role;
  const rows = ctx.db.all<Conversation & { member_name: string; coach_name: string; unread: number; last_body: string | null }>(`SELECT c.*, m.name AS member_name, k.name AS coach_name,
      (SELECT COUNT(*) FROM messages x WHERE x.conversation_id = c.id AND x.sender_id != ? AND x.read_at IS NULL) AS unread,
      (SELECT body FROM messages x WHERE x.conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_body
    FROM conversations c JOIN users m ON m.id = c.member_id JOIN users k ON k.id = c.coach_id
    WHERE ${role === 'member' ? 'c.member_id = ?' : role === 'coach' ? "c.coach_id = ? AND c.member_id IN (SELECT member_id FROM coach_assignments WHERE coach_id = c.coach_id AND status IN ('active','paused'))" : '1 = 1 AND ? = ?'} ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`, role === 'admin' || role === 'owner' ? [userId, userId, userId] : [userId, userId]);
  // a message with files and no text has an empty body
  return rows.map((c) => ({ id: c.id, memberId: c.member_id, memberName: c.member_name, coachId: c.coach_id, coachName: c.coach_name, lastMessageAt: c.last_message_at, lastBody: c.last_body ? c.last_body.slice(0, 120) : c.last_body === '' ? 'Sent a file' : null, unread: c.unread }));
}

function assertParticipant(ctx: Ctx, conversationId: string, write: boolean): Conversation {
  const c = ctx.db.get<Conversation>('SELECT * FROM conversations WHERE id = ?', [conversationId]);
  if (!c) throw errors.notFound('Conversation');
  const a = ctx.actor;
  if (!a) throw errors.unauthorised();
  if (a.id === c.member_id) return c;
  if (a.id === c.coach_id && a.role === 'coach' && coachHasMember(ctx, a.id, c.member_id)) return c;
  if ((a.role === 'admin' || a.role === 'owner') && !write) { audit(ctx, 'messages.admin_read', { type: 'conversation', id: conversationId }); return c; }
  throw errors.forbidden('Not your conversation', 'NO_ACCESS');
}

export function listMessages(ctx: Ctx, conversationId: string, opts: { before?: string | null; limit: number }) {
  const c = assertParticipant(ctx, conversationId, false);
  const rows = ctx.db.all<{ id: string; sender_id: string; body: string; created_at: string; delivered_at: string | null; read_at: string | null }>(`SELECT * FROM messages WHERE conversation_id = ? ${opts.before ? 'AND created_at < ?' : ''} ORDER BY created_at DESC LIMIT ?`, opts.before ? [conversationId, opts.before, opts.limit] : [conversationId, opts.limit]);
  const files = attachments.forMessages(ctx, rows.map((m) => m.id));
  return { conversation: { id: c.id, memberId: c.member_id, coachId: c.coach_id }, items: rows.reverse().map((m) => ({ id: m.id, senderId: m.sender_id, mine: m.sender_id === ctx.actor?.id, body: m.body, createdAt: m.created_at, deliveredAt: m.delivered_at, readAt: m.read_at, attachments: files.get(m.id) ?? [] })), nextCursor: rows.length === opts.limit ? rows[rows.length - 1]!.created_at : null };
}

/** Send a message: text, files the sender uploaded to this conversation, or both. Files need the 'messaging' flag. */
export function send(ctx: Ctx, conversationId: string, body: string, attachmentIds: string[] = []) {
  const c = assertParticipant(ctx, conversationId, true);
  const text = body.trim();
  if (!text && !attachmentIds.length) throw errors.badRequest('Write a message or add a file', 'MESSAGE_EMPTY');
  if (attachmentIds.length) requireFeature(ctx, attachments.MODULE_FLAG);
  const now = ctx.now();
  const id = ids.message();
  const files = ctx.db.tx(() => {
    ctx.db.insert('messages', { id, conversation_id: conversationId, sender_id: ctx.actor!.id, body: text, created_at: now, delivered_at: now, read_at: null });
    const claimed = attachmentIds.length ? attachments.claimForMessage(ctx, conversationId, id, attachmentIds) : [];
    ctx.db.update('conversations', conversationId, { last_message_at: now });
    if (claimed.length) audit(ctx, 'message.attachments_sent', { type: 'message', id }, null, { conversationId, attachmentIds: claimed.map((a) => a.id) });
    return claimed;
  });
  const recipient = ctx.actor!.id === c.member_id ? c.coach_id : c.member_id;
  const preview = text ? previewOf(text) : files.length === 1 ? 'Sent a file' : `Sent ${files.length} files`;
  notify(ctx, { userId: recipient, category: 'message', title: `New message from ${ctx.actor!.name}`, body: preview, data: { conversationId, messageId: id }, channels: ['in_app', 'push'], sensitive: true });
  const row = ctx.db.get<Record<string, unknown>>('SELECT * FROM messages WHERE id = ?', [id])!;
  return { ...row, attachments: files.map((a) => attachments.present(a, ctx.actor?.id)) };
}

/** A message's first 80 characters for its notification: cut at the last whole word, with an ellipsis, never mid-word
 *  ("See you at the consu" read as a typo). */
export function previewOf(text: string, max = 80): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.\u2013\u2014-]+$/, '')}…`;
}

export function markRead(ctx: Ctx, conversationId: string): number {
  assertParticipant(ctx, conversationId, true);
  return ctx.db.run('UPDATE messages SET read_at = ? WHERE conversation_id = ? AND sender_id != ? AND read_at IS NULL', [ctx.now(), conversationId, ctx.actor!.id]).changes;
}

export function conversationForMember(ctx: Ctx, memberId: string): Conversation | undefined {
  return ctx.db.get<Conversation>("SELECT c.* FROM conversations c JOIN coach_assignments a ON a.member_id = c.member_id AND a.coach_id = c.coach_id WHERE c.member_id = ? AND a.status IN ('active','paused') ORDER BY a.created_at DESC LIMIT 1", [memberId]);
}
