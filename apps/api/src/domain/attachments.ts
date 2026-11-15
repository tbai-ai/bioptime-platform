/* M9 Message attachments (CAPABILITY_MAP.md 4.8; migration 0017_messaging.sql; feature flag 'messaging').

   A file added to a member and coach conversation is a private file (api/domain/files.ts, kind 'message_attachment'):
   - Only the two participants add files: the member and the coach currently assigned to them. Administrators read
     conversations for support (members.manage) and never add a file.
   - The type is read from the magic bytes (PNG, JPEG, WebP or PDF), never from the name; the size is capped at 5 MB.
     No malware-scanning service is configured yet (pending configuration), so nothing else is checked.
   - An uploaded file waits in the sender's composer (message_id NULL) until the message is sent; only its sender sees it
     then, and an unsent file is discarded after 24 hours by the attachments_cleanup job.
   - Files open only through 5-minute tokens. The access resolver (fileAccess) runs when the token is issued and again
     when it is redeemed: a sent file opens for the member, for the coach while still assigned, and for an
     administrator holding members.manage (read only). Every opening is audited as attachment.open, once per person and
     file within a token's lifetime.
   - Coach messages are not health records the member shares through coach_sharing: the member chose to send the file
     to that coach, so a file follows the conversation's own rule (participants and assignment), like the message text. */
import type { Ctx } from '../context.js';
import { randomId } from '../lib/ids.js';
import { errors } from '../lib/errors.js';
import type { SniffedMime } from '../lib/sniff.js';
import { coachHasMember, hasPermission } from '../auth/permissions.js';
import { audit } from './audit.js';
import * as files from './files.js';
import type { FileRow } from './files.js';
import { isEnabled } from './features.js';

/* ---------- vocabulary ---------- */

export const MODULE_FLAG = 'messaging';
export const ATTACHMENT_FILE_KIND = 'message_attachment';
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const ATTACHMENT_MIMES: readonly SniffedMime[] = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
/** At most this many files on one message (messageCreateSchema says the same). */
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
/** At most this many unsent files per sender and conversation. */
export const MAX_PENDING = 10;
/** An unsent file is discarded after this many hours. */
export const PENDING_TTL_HOURS = 24;
/** What is not checked yet, said wherever files are added. */
export const SCANNING = {
  status: 'pending_configuration' as const,
  missing: 'A malware-scanning service: none is configured, so files are checked by type (read from the content) and size only',
};

type Conversation = { id: string; member_id: string; coach_id: string };
export type AttachmentRow = {
  id: string; message_id: string | null; conversation_id: string; file_id: string; name: string; mime: string; bytes: number;
  sha256: string; uploaded_by: string; created_at: string; deleted_at: string | null;
};

const newId = () => randomId('mat');
const system = (ctx: Ctx): Ctx => ({ ...ctx, actor: null });

/* ---------- presentation ---------- */

export function present(a: AttachmentRow, viewerId: string | null | undefined) {
  return {
    id: a.id, messageId: a.message_id, conversationId: a.conversation_id, name: a.name, mime: a.mime, bytes: a.bytes,
    kind: a.mime === 'application/pdf' ? 'pdf' as const : 'image' as const, sent: !!a.message_id, mine: !!viewerId && a.uploaded_by === viewerId,
    uploadedBy: a.uploaded_by, createdAt: a.created_at,
  };
}
export type Attachment = ReturnType<typeof present>;

/** The limits and checks the composers show. */
export function limits() {
  return { maxBytes: ATTACHMENT_MAX_BYTES, maxPerMessage: MAX_ATTACHMENTS_PER_MESSAGE, types: ['PNG', 'JPEG', 'WebP', 'PDF'], pendingHours: PENDING_TTL_HOURS, scanning: SCANNING };
}

/* ---------- who may do what ---------- */

function conversation(ctx: Ctx, id: string): Conversation {
  const c = ctx.db.get<Conversation>('SELECT id, member_id, coach_id FROM conversations WHERE id = ?', [id]);
  if (!c) throw errors.notFound('Conversation');
  return c;
}

/** A writing participant: the conversation's member, or its coach while still assigned to that member. */
export function isParticipant(ctx: Ctx, c: Conversation): boolean {
  const a = ctx.actor;
  if (!a) return false;
  if (a.role === 'member') return a.id === c.member_id;
  if (a.role === 'coach') return a.id === c.coach_id && coachHasMember(ctx, a.id, c.member_id);
  return false;
}

/** An administrator reading conversations for support: members.manage (owners hold every permission). */
function adminReader(ctx: Ctx): boolean {
  const a = ctx.actor;
  return !!a && (a.role === 'admin' || a.role === 'owner') && hasPermission(ctx, 'members.manage');
}

/** The conversation, when the caller may write in it; otherwise a refusal that says why. */
function writable(ctx: Ctx, conversationId: string): Conversation {
  const c = conversation(ctx, conversationId);
  if (isParticipant(ctx, c)) return c;
  const role = ctx.actor?.role;
  if (role === 'admin' || role === 'owner') throw errors.forbidden('Administrators read conversations for support; only the member and their coach add files', 'READ_ONLY');
  throw errors.forbidden('Not your conversation', 'NO_ACCESS');
}

/** The conversation, when the caller may read it (participants; administrators with members.manage, audited). */
function readable(ctx: Ctx, conversationId: string): Conversation {
  const c = conversation(ctx, conversationId);
  if (isParticipant(ctx, c)) return c;
  if (adminReader(ctx)) { audit(ctx, 'messages.admin_read', { type: 'conversation', id: c.id }, null, { what: 'attachments' }); return c; }
  throw errors.forbidden('Not your conversation', 'NO_ACCESS');
}

/* ---------- upload, discard, list ---------- */

function decodeBase64(data: string): Buffer {
  const body = data.replace(/^data:[\w/+.-]+;base64,/, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) throw errors.badRequest('The file must be sent as base64', 'FILE_ENCODING');
  return Buffer.from(body, 'base64');
}

/** Store a file for the caller's next message in this conversation: participants only, type by content, 5 MB. */
export function upload(ctx: Ctx, conversationId: string, input: { dataBase64: string; filename?: string }) {
  const c = writable(ctx, conversationId);
  const actor = ctx.actor!;
  const pending = ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM message_attachments WHERE conversation_id = ? AND uploaded_by = ? AND message_id IS NULL AND deleted_at IS NULL', [c.id, actor.id])!.n;
  if (pending >= MAX_PENDING) throw errors.conflict(`At most ${MAX_PENDING} files can wait unsent; send or remove some first`, 'TOO_MANY_PENDING');
  const id = newId();
  const saved = files.savePrivateFile(ctx, { ownerId: actor.id, kind: ATTACHMENT_FILE_KIND, buffer: decodeBase64(input.dataBase64), allowedMimes: ATTACHMENT_MIMES, maxBytes: ATTACHMENT_MAX_BYTES, ref: { type: 'message_attachment', id }, name: input.filename });
  try {
    ctx.db.insert('message_attachments', { id, message_id: null, conversation_id: c.id, file_id: saved.id, name: saved.name, mime: saved.mime, bytes: saved.size, sha256: saved.sha256 ?? '', uploaded_by: actor.id, created_at: ctx.now(), deleted_at: null });
  } catch (e) {
    files.removePrivateFile(ctx, saved.id, 'message attachment row could not be written');
    throw e;
  }
  audit(ctx, 'message.attachment_upload', { type: 'message_attachment', id }, null, { conversationId: c.id, memberId: c.member_id, fileId: saved.id, mime: saved.mime, bytes: saved.size, byRole: actor.role });
  return present(row(ctx, id)!, actor.id);
}

function row(ctx: Ctx, id: string): AttachmentRow | undefined {
  if (!/^mat_[a-z0-9]{6,40}$/.test(id)) return undefined;
  return ctx.db.get<AttachmentRow>('SELECT * FROM message_attachments WHERE id = ? AND deleted_at IS NULL', [id]);
}

function discardRow(ctx: Ctx, a: AttachmentRow, reason: string): void {
  ctx.db.update('message_attachments', a.id, { deleted_at: ctx.now() });
  files.removePrivateFile(ctx, a.file_id, reason);
  audit(ctx, 'message.attachment_discard', { type: 'message_attachment', id: a.id }, reason, { conversationId: a.conversation_id, fileId: a.file_id });
}

/** The sender removes a file they have not sent yet: the bytes are deleted at once. A sent file stays with its message. */
export function discard(ctx: Ctx, conversationId: string, attachmentId: string) {
  const actor = ctx.actor;
  const a = row(ctx, attachmentId);
  if (!actor || !a || a.conversation_id !== conversationId || a.uploaded_by !== actor.id) throw errors.notFound('Attachment');
  if (a.message_id) throw errors.state('A sent file stays with its message', { code: 'ATTACHMENT_SENT' });
  discardRow(ctx, a, 'removed by the sender before sending');
  return { discarded: true, id: a.id };
}

/** The files of a conversation (newest first) and the caller's unsent ones. Participants; administrators read only. */
export function listForConversation(ctx: Ctx, conversationId: string, limit = 100) {
  const c = readable(ctx, conversationId);
  const viewer = ctx.actor?.id;
  const sent = ctx.db.all<AttachmentRow>('SELECT * FROM message_attachments WHERE conversation_id = ? AND message_id IS NOT NULL AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?', [c.id, limit]);
  const pending = isParticipant(ctx, c) ? ctx.db.all<AttachmentRow>('SELECT * FROM message_attachments WHERE conversation_id = ? AND uploaded_by = ? AND message_id IS NULL AND deleted_at IS NULL ORDER BY created_at', [c.id, viewer ?? '']) : [];
  return { items: sent.map((a) => present(a, viewer)), pending: pending.map((a) => present(a, viewer)), canAdd: isParticipant(ctx, c), ...limits() };
}

/** The files on these messages, by message id (for the conversation thread). */
export function forMessages(ctx: Ctx, messageIds: string[]): Map<string, Attachment[]> {
  const out = new Map<string, Attachment[]>();
  if (!messageIds.length) return out;
  const viewer = ctx.actor?.id;
  for (let i = 0; i < messageIds.length; i += 400) {
    const chunk = messageIds.slice(i, i + 400);
    const rows = ctx.db.all<AttachmentRow>(`SELECT * FROM message_attachments WHERE message_id IN (${chunk.map(() => '?').join(', ')}) AND deleted_at IS NULL ORDER BY created_at`, chunk);
    for (const a of rows) { const list = out.get(a.message_id!) ?? []; list.push(present(a, viewer)); out.set(a.message_id!, list); }
  }
  return out;
}

/** Inside send(): ties the sender's unsent files of this conversation to the new message. Any id that is not the
 *  sender's own unsent file in this conversation refuses the whole message. */
export function claimForMessage(ctx: Ctx, conversationId: string, messageId: string, attachmentIds: string[]): AttachmentRow[] {
  const unique = [...new Set(attachmentIds)];
  if (unique.length > MAX_ATTACHMENTS_PER_MESSAGE) throw errors.badRequest(`At most ${MAX_ATTACHMENTS_PER_MESSAGE} files on one message`, 'TOO_MANY_ATTACHMENTS');
  const actor = ctx.actor!;
  const rows: AttachmentRow[] = [];
  for (const id of unique) {
    const a = row(ctx, id);
    if (!a || a.conversation_id !== conversationId || a.uploaded_by !== actor.id) throw errors.badRequest('A file on this message does not belong to this conversation', 'ATTACHMENT_INVALID');
    if (a.message_id) throw errors.badRequest('A file on this message was already sent', 'ATTACHMENT_INVALID');
    rows.push(a);
  }
  for (const a of rows) ctx.db.update('message_attachments', a.id, { message_id: messageId });
  return rows.map((a) => ({ ...a, message_id: messageId }));
}

/* ---------- opening ---------- */

/** A 5-minute token for one file, after the access resolver admits the caller (audited as attachment.open and file.token). */
export function openToken(ctx: Ctx, attachmentId: string) {
  const a = row(ctx, attachmentId);
  if (!a) throw errors.notFound('Attachment');
  const t = files.fileToken(ctx, a.file_id); // runs fileAccess below; refuses with NOT_FOUND
  return { ...t, name: a.name, mime: a.mime, bytes: a.bytes };
}

/** Who may open a message attachment file: while the module is on, its sender while unsent; once sent, the member, the
 *  coach while still assigned, and administrators holding members.manage (read only). Runs at token issue and again at
 *  download; each opening is audited once per person and file within a token's lifetime. */
export function fileAccess(ctx: Ctx, file: FileRow): boolean {
  const actor = ctx.actor;
  if (!actor) return false;
  const a = ctx.db.get<AttachmentRow>('SELECT * FROM message_attachments WHERE file_id = ? AND deleted_at IS NULL', [file.id]);
  if (!a || !isEnabled(ctx, MODULE_FLAG)) return false;
  const c = ctx.db.get<Conversation>('SELECT id, member_id, coach_id FROM conversations WHERE id = ?', [a.conversation_id]);
  if (!c) return false;
  const participant = isParticipant(ctx, c);
  const admin = !participant && adminReader(ctx);
  const allowed = a.message_id ? participant || admin : participant && a.uploaded_by === actor.id;
  if (!allowed) return false;
  const since = new Date(Date.parse(ctx.now()) - files.FILE_TOKEN_SECONDS * 1000).toISOString();
  const recent = ctx.db.get("SELECT 1 FROM audit_events WHERE action = 'attachment.open' AND target_id = ? AND actor_id = ? AND at >= ? LIMIT 1", [a.id, actor.id, since]);
  if (!recent) audit(ctx, 'attachment.open', { type: 'message_attachment', id: a.id }, admin ? 'administrator support read (read only)' : null, { conversationId: c.id, memberId: c.member_id, fileId: a.file_id, byRole: actor.role, admin, sent: !!a.message_id });
  return true;
}

/* ---------- the member's data export ---------- */

/** The member's data export (ApiModule.exportSections in api/modules/messaging.ts, read by api/domain/dataExport.ts
 *  buildArchive): the files on messages in this member's own conversations, sent by them or by their coach, as their
 *  Messages page lists them: the name, the type and the size, who sent it, to or from which coach, and when. Never the
 *  file itself (the member opens each one in Messages through a short-lived link), its storage location, checksum or
 *  ids, and nothing still waiting unsent in a composer or removed before sending. */
export function exportFilesForMember(ctx: Ctx, memberId: string) {
  return ctx.db.all<{ name: string; mime: string; bytes: number; uploaded_by: string; sent_at: string; coach_name: string | null }>(`SELECT a.name, a.mime, a.bytes, a.uploaded_by, m.created_at AS sent_at, u.name AS coach_name
      FROM message_attachments a JOIN messages m ON m.id = a.message_id JOIN conversations c ON c.id = a.conversation_id LEFT JOIN users u ON u.id = c.coach_id
      WHERE c.member_id = ? AND a.message_id IS NOT NULL AND a.deleted_at IS NULL ORDER BY m.created_at, a.created_at, a.id`, [memberId])
    .map((f) => {
      const coach = f.coach_name ?? 'Your coach';
      return { name: f.name, type: f.mime, kind: f.mime === 'application/pdf' ? 'pdf' : 'image', bytes: f.bytes, from: f.uploaded_by === memberId ? 'you' : coach, conversationWith: coach, sentAt: f.sent_at };
    });
}

/* ---------- clean-up ---------- */

/** Unsent files older than PENDING_TTL_HOURS are deleted from storage. Privacy clean-up: runs while the module is off. */
export function discardStale(ctx: Ctx): { discarded: number } {
  const cutoff = new Date(Date.parse(ctx.now()) - PENDING_TTL_HOURS * 3_600_000).toISOString();
  const stale = ctx.db.all<AttachmentRow>('SELECT * FROM message_attachments WHERE message_id IS NULL AND deleted_at IS NULL AND created_at < ? LIMIT 500', [cutoff]);
  for (const a of stale) discardRow(system(ctx), a, `not sent within ${PENDING_TTL_HOURS} hours`);
  return { discarded: stale.length };
}
