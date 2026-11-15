/* M9 Message attachments and announcements: the migration and module registration, files on messages (participants
   only, type read from the content, the 5 MB cap, private storage, 5-minute tokens, an administrator's read-only and
   audited opening, removal of unsent files and the clean-up job) and announcements (the team's drafts, audiences,
   publishing, scheduling and withdrawal; a coach's announcements reaching only their own clients; members' read state),
   a file never moving to another conversation, and the member's data export (opened announcements; file names, types
   and sizes, never contents).

   Permissions throughout: a member's own conversation and announcements; coaches only for clients currently assigned to
   them, with every payload passing the field policy; administrators by permission (members.manage to open files,
   announcements.manage for announcements). Every mutation is audited. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId } from '../helpers.js';
import type { Ctx } from '../../src/context.js';
import { MODULES } from '../../src/modules/index.js';
import { messaging as messagingModule } from '../../src/modules/messaging.js';
import * as files from '../../src/domain/files.js';
import * as attachments from '../../src/domain/attachments.js';
import * as announcements from '../../src/domain/announcements.js';
import { processPending } from '../../src/domain/events.js';
import { buildArchive } from '../../src/domain/dataExport.js';
import { setUserPermission } from '../../src/auth/permissions.js';
import { coachFieldPolicy, findRestrictedFields, restrictedKeys } from '../../src/auth/fieldPolicy.js';
import { addDays, addMinutes } from '../../src/lib/time.js';
import { moduleJobs } from '../../src/jobs.js';
import { messageCreateSchema } from '@bioptime/domain';

const PRIYA = 'priya.nair@demo.bioptime.test'; // Asha's client, like Ananya
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML_AS_PNG = Buffer.from('<!doctype html><html><body>not an image</body></html>');

let h: Awaited<ReturnType<typeof makeApp>>;
let privateDir = '';

before(async () => {
  privateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bioptime-messaging-'));
  h = await makeApp({ env: { PRIVATE_FILES_DIR: privateDir } });
  owner = await signedIn(DEMO.owner, DEMO_PASSWORDS.owner, true);
  admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin, true);
});
after(async () => {
  await h.app.close();
  h.db.close();
  fs.rmSync(privateDir, { recursive: true, force: true });
});

type C = ReturnType<typeof client>;
const as = (email: string): Ctx => { const u = h.db.get<{ id: string; role: 'member' | 'coach' | 'admin' | 'owner'; name: string }>('SELECT id, role, name FROM users WHERE email = ?', [email])!; return { ...h.ctx, actor: { id: u.id, role: u.role, email, name: u.name } }; };
const at = (iso: string, base: Ctx = h.ctx): Ctx => ({ ...base, now: () => iso });
const signedIn = async (email: string, password: string, mfa = false) => { const c = client(h.app); await c.login(email, password, password === DEMO_PASSWORDS.member ? 'member' : 'dashboard', mfa); return c; };
const auditCount = (action: string, targetId?: string) => h.db.get<{ n: number }>(`SELECT COUNT(*) n FROM audit_events WHERE action = ? ${targetId ? 'AND target_id = ?' : ''}`, targetId ? [action, targetId] : [action])!.n;
const lastAudit = (action: string, targetId?: string) => h.db.get<{ actor_id: string | null; actor_role: string; reason: string | null; target_id: string; data: string }>(`SELECT * FROM audit_events WHERE action = ? ${targetId ? 'AND target_id = ?' : ''} ORDER BY at DESC, rowid DESC LIMIT 1`, targetId ? [action, targetId] : [action]);
const noRestricted = (payload: unknown) => assert.deepEqual(findRestrictedFields(payload, restrictedKeys(coachFieldPolicy(h.ctx))), [], 'no phone, email, address, PIN or date of birth in a coach payload');
const b64 = (b: Buffer) => b.toString('base64');
const conversationOf = (memberEmail: string) => h.db.get<{ id: string; coach_id: string }>("SELECT c.id, c.coach_id FROM conversations c JOIN coach_assignments a ON a.member_id = c.member_id AND a.coach_id = c.coach_id AND a.status IN ('active','paused') WHERE c.member_id = ?", [userId(h.ctx, memberEmail)])!;
const download = (url: string) => h.app.inject({ method: 'GET', url });
/** The specific refusal inside an INVALID_STATE answer (errors.state carries it in details.code). */
const stateCode = (r: { json: { error?: { code: string; details?: unknown } } }) => (r.json.error?.code === 'INVALID_STATE' ? (r.json.error.details as { code?: string } | undefined)?.code : r.json.error?.code);

let owner: C, admin: C;
const setFlag = async (enabled: boolean) => {
  const r = await owner.patch('/api/admin/modules', { key: 'messaging', enabled, reason: `test: messaging ${enabled ? 'on' : 'off'}` });
  assert.equal(r.status, 200, JSON.stringify(r.json));
};

/* ================================================== registration ================================================== */

test('the module registers its migration, routes, jobs, event handler, file resolver and seeded announcements in plain words', async () => {
  for (const t of ['message_attachments', 'announcements', 'announcement_reads']) assert.ok(h.db.get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", [t]), `${t} exists`);
  assert.ok(h.db.get("SELECT 1 FROM schema_migrations WHERE version = '0017_messaging.sql'"));
  const m = MODULES.find((x) => x.key === 'messaging')!;
  assert.equal(m, messagingModule);
  assert.equal(m.feature, 'messaging');
  assert.deepEqual(Object.keys(m.fileAccess ?? {}), [attachments.ATTACHMENT_FILE_KIND]);
  assert.ok(m.events?.AnnouncementPublished?.length);
  assert.deepEqual(m.ungated, ['DELETE /conversations/:id/attachments/:attachmentId']);
  assert.deepEqual(moduleJobs().filter((j) => j.name.startsWith('messaging.')).map((j) => j.name), ['messaging.announcements_publish', 'messaging.attachments_cleanup']);
  assert.ok(files.storesPrivateFiles('messaging'), 'production refuses local storage while the module is on');

  // demo rows: plain service news (the owner removed the demo and sample labels on 24 October 2026); no files are seeded
  const rows = h.db.all<{ title: string; body: string; status: string; origin: string }>('SELECT title, body, status, origin FROM announcements');
  assert.deepEqual(rows.map((r) => r.status).sort(), ['draft', 'published', 'published', 'scheduled']);
  assert.ok(rows.some((r) => r.origin === 'coach'));
  assert.deepEqual(rows.map((r) => r.title).sort(), ['A note from your coach', 'A scheduled announcement', 'For members on the Core package', 'Welcome to Bioptime']);
  for (const r of rows) assert.doesNotMatch(`${r.title} ${r.body}`, /\bdemo\b|\bsample\b/i);
  assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM message_attachments')!.n, 0);
  // the seeded announcements were delivered: Ananya (Asha's client) has the team's and her coach's
  const ananya = userId(h.ctx, DEMO.member);
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND category = 'announcement'", [ananya])!.n, 2);

  // the shared schema: text or files
  assert.equal(messageCreateSchema.safeParse({ body: '' }).success, false);
  assert.equal(messageCreateSchema.safeParse({ body: '', attachmentIds: ['mat_x'] }).success, true);
  assert.equal(messageCreateSchema.safeParse({ body: 'hi', attachmentIds: ['1', '2', '3', '4', '5', '6'] }).success, false);
});

/* ================================================== attachments ================================================== */

test('participants add files checked by content and capped at 5 MB; everyone else is refused', async () => {
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const conv = conversationOf(DEMO.member);

  const png = await member.post(`/api/conversations/${conv.id}/attachments`, { dataBase64: b64(PNG_1x1), filename: '../../etc/passwd scan.png' });
  assert.equal(png.status, 201, JSON.stringify(png.json));
  assert.equal(png.json.mime, 'image/png');
  assert.equal(png.json.kind, 'image');
  assert.equal(png.json.sent, false);
  assert.equal(png.json.mine, true);
  assert.doesNotMatch(String(png.json.name), /\.\.|\//, 'the stored name keeps no path');
  const row = h.db.get<{ file_id: string; uploaded_by: string; message_id: string | null }>('SELECT * FROM message_attachments WHERE id = ?', [png.json.id as string])!;
  assert.equal(row.message_id, null);
  const file = files.getFile(h.ctx, row.file_id)!;
  assert.equal(file.kind, 'message_attachment');
  assert.ok(fs.existsSync(path.join(privateDir, file.storage_path)), 'stored under the private directory');
  assert.equal(lastAudit('message.attachment_upload', png.json.id as string)?.actor_id, userId(h.ctx, DEMO.member));

  // the type is read from the bytes, never the name; the size is capped
  const svg = await member.post(`/api/conversations/${conv.id}/attachments`, { dataBase64: b64(SVG), filename: 'picture.png' });
  assert.equal(svg.status, 400);
  assert.equal(svg.json.error?.code, 'FILE_TYPE');
  assert.equal((await member.post(`/api/conversations/${conv.id}/attachments`, { dataBase64: b64(HTML_AS_PNG), filename: 'x.png' })).json.error?.code, 'FILE_TYPE');
  const big = Buffer.concat([PDF, Buffer.alloc(attachments.ATTACHMENT_MAX_BYTES, 0x20)]);
  const tooBig = await member.post(`/api/conversations/${conv.id}/attachments`, { dataBase64: b64(big), filename: 'big.pdf' });
  assert.equal(tooBig.status, 400);
  assert.equal(tooBig.json.error?.code, 'FILE_TOO_LARGE');
  assert.equal((await member.post(`/api/conversations/${conv.id}/attachments`, { dataBase64: '@@@@not-base64@@@@' })).json.error?.code, 'FILE_ENCODING');
  assert.equal((await member.post(`/api/conversations/${conv.id}/attachments`, { dataBase64: b64(PNG_1x1), extra: 1 })).json.error?.code, 'VALIDATION_FAILED');

  // another member, another coach and an administrator cannot add a file to this conversation
  const vikram = await signedIn(DEMO.member2, DEMO_PASSWORDS.member);
  assert.equal((await vikram.post(`/api/conversations/${conv.id}/attachments`, { dataBase64: b64(PNG_1x1) })).json.error?.code, 'NO_ACCESS');
  const rahul = await signedIn(DEMO.coach2, DEMO_PASSWORDS.coach);
  assert.equal((await rahul.post(`/api/conversations/${conv.id}/attachments`, { dataBase64: b64(PNG_1x1) })).json.error?.code, 'NO_ACCESS');
  const adminUpload = await admin.post(`/api/conversations/${conv.id}/attachments`, { dataBase64: b64(PNG_1x1) });
  assert.equal(adminUpload.status, 403);
  assert.equal(adminUpload.json.error?.code, 'READ_ONLY');
  assert.equal((await vikram.get(`/api/conversations/${conv.id}/attachments`)).json.error?.code, 'NO_ACCESS');

  // the assigned coach adds files too; the payload passes the field policy
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const pdf = await asha.post(`/api/conversations/${conv.id}/attachments`, { dataBase64: b64(PDF), filename: 'weekly-plan.pdf' });
  assert.equal(pdf.status, 201);
  assert.equal(pdf.json.kind, 'pdf');
  noRestricted(pdf.json);
  // each sender sees only their own unsent files
  const mine = await member.get(`/api/conversations/${conv.id}/attachments`);
  assert.deepEqual((mine.json.pending as Array<{ id: string }>).map((a) => a.id), [png.json.id]);
  assert.equal(mine.json.maxBytes, attachments.ATTACHMENT_MAX_BYTES);
  assert.match(String((mine.json.scanning as { missing: string }).missing), /malware-scanning/);
  const coachView = await asha.get(`/api/conversations/${conv.id}/attachments`);
  assert.deepEqual((coachView.json.pending as Array<{ id: string }>).map((a) => a.id), [pdf.json.id]);
  noRestricted(coachView.json);
});

test('a message carries the sender’s own unsent files; the text may be empty only then', async () => {
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const conv = conversationOf(DEMO.member);
  const up = await member.post(`/api/conversations/${conv.id}/attachments`, { dataBase64: b64(PDF), filename: 'lab-letter.pdf' });
  assert.equal(up.status, 201);
  const coachFile = (await asha.post(`/api/conversations/${conv.id}/attachments`, { dataBase64: b64(PNG_1x1) })).json.id as string;

  // empty text and no file: refused; a file of someone else: refused; an unknown id: refused
  assert.equal((await member.post(`/api/conversations/${conv.id}/messages`, { body: '   ' })).json.error?.code, 'VALIDATION_FAILED');
  assert.equal((await member.post(`/api/conversations/${conv.id}/messages`, { body: '', attachmentIds: [coachFile] })).json.error?.code, 'ATTACHMENT_INVALID');
  assert.equal((await member.post(`/api/conversations/${conv.id}/messages`, { body: 'x', attachmentIds: ['mat_doesnotexist0'] })).json.error?.code, 'ATTACHMENT_INVALID');
  assert.equal(h.db.get<{ message_id: string | null }>('SELECT message_id FROM message_attachments WHERE id = ?', [coachFile])!.message_id, null, 'a refused message ties nothing');

  const sent = await member.post(`/api/conversations/${conv.id}/messages`, { body: '', attachmentIds: [up.json.id] });
  assert.equal(sent.status, 201, JSON.stringify(sent.json));
  assert.equal(sent.json.body, '');
  assert.deepEqual((sent.json.attachments as Array<{ id: string; sent: boolean }>).map((a) => [a.id, a.sent]), [[up.json.id, true]]);
  assert.equal(lastAudit('message.attachments_sent', sent.json.id as string)?.actor_id, userId(h.ctx, DEMO.member));
  // the same file cannot go on a second message
  assert.equal((await member.post(`/api/conversations/${conv.id}/messages`, { body: 'again', attachmentIds: [up.json.id] })).json.error?.code, 'ATTACHMENT_INVALID');

  // the coach's thread shows the file (name, type, size); the conversation list says a file was sent; the notification keeps detail off
  const thread = await asha.get(`/api/conversations/${conv.id}/messages?limit=100`);
  const msg = (thread.json.items as Array<{ id: string; attachments: Array<{ id: string; name: string; mime: string; bytes: number; mine: boolean }> }>).find((m) => m.id === sent.json.id)!;
  assert.equal(msg.attachments[0]!.name, 'lab-letter.pdf');
  assert.equal(msg.attachments[0]!.mime, 'application/pdf');
  assert.equal(msg.attachments[0]!.bytes, PDF.length);
  assert.equal(msg.attachments[0]!.mine, false);
  noRestricted(thread.json);
  const list = await asha.get('/api/conversations');
  assert.equal((list.json.items as Array<{ id: string; lastBody: string }>).find((c) => c.id === conv.id)!.lastBody, 'Sent a file');
  noRestricted(list.json);
  const n = h.db.get<{ body: string; data: string }>("SELECT body, data FROM notifications WHERE user_id = ? AND category = 'message' ORDER BY created_at DESC, rowid DESC LIMIT 1", [conv.coach_id])!;
  assert.equal(n.body, 'Sent a file');

  // text and files together, the coach's own file
  const both = await asha.post(`/api/conversations/${conv.id}/messages`, { body: 'Here is the plan as a picture.', attachmentIds: [coachFile] });
  assert.equal(both.status, 201);
  assert.equal((both.json.attachments as unknown[]).length, 1);
  noRestricted(both.json);
});

test('a file added in one conversation cannot go on a message in another, even by the same sender', async () => {
  // Asha coaches both Ananya and Priya, so she may write in both conversations and the file is her own and unsent:
  // the only thing wrong with the second message is that the file belongs to the first conversation
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const ananyaConv = conversationOf(DEMO.member);
  const priyaConv = conversationOf(PRIYA);
  assert.equal(priyaConv.coach_id, ananyaConv.coach_id, 'the same coach on both conversations');
  assert.notEqual(priyaConv.id, ananyaConv.id);
  const up = await asha.post(`/api/conversations/${ananyaConv.id}/attachments`, { dataBase64: b64(PDF), filename: 'for-ananya-only.pdf' });
  assert.equal(up.status, 201, JSON.stringify(up.json));
  const fileId = up.json.id as string;
  const messagesIn = (convId: string) => h.db.get<{ n: number }>('SELECT COUNT(*) n FROM messages WHERE conversation_id = ?', [convId])!.n;
  const priyaBefore = messagesIn(priyaConv.id);

  // through the API: refused, nothing written to Priya's thread, the file still waits unsent in Ananya's
  const moved = await asha.post(`/api/conversations/${priyaConv.id}/messages`, { body: 'Here is your plan.', attachmentIds: [fileId] });
  assert.equal(moved.status, 400, JSON.stringify(moved.json));
  assert.equal(moved.json.error?.code, 'ATTACHMENT_INVALID');
  assert.match(String(moved.json.error?.message), /does not belong to this conversation/, 'refused by the conversation check, not the sender or sent checks');
  assert.equal(messagesIn(priyaConv.id), priyaBefore, 'the refused message was not written');
  const row = h.db.get<{ message_id: string | null; conversation_id: string; uploaded_by: string; deleted_at: string | null }>('SELECT message_id, conversation_id, uploaded_by, deleted_at FROM message_attachments WHERE id = ?', [fileId])!;
  assert.deepEqual({ ...row }, { message_id: null, conversation_id: ananyaConv.id, uploaded_by: ananyaConv.coach_id, deleted_at: null });
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM audit_events WHERE action = 'message.attachments_sent' AND data LIKE ?", [`%${fileId}%`])!.n, 0, 'no send was recorded');

  // at the claim itself: the same sender, the same unsent file; only the conversation differs
  const ashaCtx = as(DEMO.coach);
  assert.throws(() => attachments.claimForMessage(ashaCtx, priyaConv.id, 'msg_not_written', [fileId]), (e: { code?: string; message?: string }) => e.code === 'ATTACHMENT_INVALID' && /does not belong to this conversation/.test(String(e.message)));
  assert.equal(h.db.get<{ message_id: string | null }>('SELECT message_id FROM message_attachments WHERE id = ?', [fileId])!.message_id, null);

  // Priya cannot open it; in its own conversation it goes out as usual
  const priya = await signedIn(PRIYA, DEMO_PASSWORDS.member);
  assert.equal((await priya.post(`/api/attachments/${fileId}/file-token`)).status, 404);
  const sent = await asha.post(`/api/conversations/${ananyaConv.id}/messages`, { body: 'Here is your plan.', attachmentIds: [fileId] });
  assert.equal(sent.status, 201, JSON.stringify(sent.json));
  assert.deepEqual((sent.json.attachments as Array<{ id: string }>).map((a) => a.id), [fileId]);
  assert.equal((await priya.post(`/api/attachments/${fileId}/file-token`)).status, 404, 'still not hers once sent');
});

test('files open through 5-minute tokens: participants, the assigned coach, administrators read only and audited; nobody else', async () => {
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const conv = conversationOf(DEMO.member);
  const up = await member.post(`/api/conversations/${conv.id}/attachments`, { dataBase64: b64(PNG_1x1), filename: 'meal.png' });
  const id = up.json.id as string;

  // unsent: only its sender opens it
  const own = await member.post(`/api/attachments/${id}/file-token`);
  assert.equal(own.status, 200, JSON.stringify(own.json));
  assert.equal((await asha.post(`/api/attachments/${id}/file-token`)).status, 404, 'the coach cannot open a file that was not sent');
  assert.equal((await admin.post(`/api/attachments/${id}/file-token`)).status, 404, 'nor can an administrator');

  assert.equal((await member.post(`/api/conversations/${conv.id}/messages`, { body: 'Dinner yesterday', attachmentIds: [id] })).status, 201);

  // the member and the assigned coach open it; the download is the stored bytes, private and not sniffed
  const t = await asha.post(`/api/attachments/${id}/file-token`);
  assert.equal(t.status, 200);
  assert.equal(t.json.expiresInSeconds, files.FILE_TOKEN_SECONDS);
  assert.match(String(t.json.url), /^\/api\/files\/download\?token=/);
  const before = auditCount('attachment.open', id);
  const res = await download(String(t.json.url));
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'image/png');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.match(String(res.headers['cache-control']), /no-store/);
  assert.deepEqual(res.rawPayload, PNG_1x1);
  assert.equal(auditCount('attachment.open', id), before, 'one audited opening per person and file within a token’s lifetime');
  assert.equal(lastAudit('attachment.open', id)?.actor_id, userId(h.ctx, DEMO.coach));

  // a token expires after five minutes
  const token = decodeURIComponent(String(t.json.url).split('token=')[1]!);
  assert.throws(() => files.resolveFileToken(at(addMinutes(new Date().toISOString(), 6)), token), (e: { code?: string }) => e.code === 'LINK_EXPIRED');

  // another member and another coach: nothing, through either route
  const vikram = await signedIn(DEMO.member2, DEMO_PASSWORDS.member);
  const rahul = await signedIn(DEMO.coach2, DEMO_PASSWORDS.coach);
  assert.equal((await vikram.post(`/api/attachments/${id}/file-token`)).status, 404);
  assert.equal((await rahul.post(`/api/attachments/${id}/file-token`)).status, 404);
  const fileId = h.db.get<{ file_id: string }>('SELECT file_id FROM message_attachments WHERE id = ?', [id])!.file_id;
  assert.equal((await rahul.post(`/api/files/${fileId}/token`)).status, 404, 'the generic file route runs the same resolver');

  // an administrator with members.manage opens it read only; the opening is audited with the role and a reason
  const adminToken = await admin.post(`/api/attachments/${id}/file-token`);
  assert.equal(adminToken.status, 200);
  const a = lastAudit('attachment.open', id)!;
  assert.equal(a.actor_id, userId(h.ctx, DEMO.admin));
  assert.equal(a.actor_role, 'admin');
  assert.match(a.reason ?? '', /read only/);
  assert.equal(JSON.parse(a.data).admin, true);
  assert.equal((await download(String(adminToken.json.url))).statusCode, 200);
  assert.equal((await admin.post(`/api/conversations/${conv.id}/messages`, { body: 'admin note' })).json.error?.code, 'NO_ACCESS', 'administrators never write');
  const adminList = await admin.get(`/api/conversations/${conv.id}/attachments`);
  assert.equal(adminList.status, 200);
  assert.equal(adminList.json.canAdd, false);
  assert.deepEqual(adminList.json.pending, []);
  assert.ok(auditCount('messages.admin_read', conv.id) >= 1);

  // without members.manage the administrator cannot open it, and an issued token stops working at once
  const adminId = userId(h.ctx, DEMO.admin);
  setUserPermission(as(DEMO.owner), adminId, 'members.manage', false, 'test: no member management');
  try {
    assert.equal((await admin.post(`/api/attachments/${id}/file-token`)).status, 404);
    assert.equal((await download(String(adminToken.json.url))).statusCode, 404);
    assert.equal((await admin.get(`/api/conversations/${conv.id}/attachments`)).json.error?.code, 'NO_ACCESS');
  } finally {
    setUserPermission(as(DEMO.owner), adminId, 'members.manage', true, 'test: member management back');
  }

  // a coach who is no longer assigned loses the file at once, even with a token in hand
  const ashaToken = await asha.post(`/api/attachments/${id}/file-token`);
  const assignment = h.db.get<{ id: string }>("SELECT id FROM coach_assignments WHERE member_id = ? AND coach_id = ? AND status = 'active'", [userId(h.ctx, DEMO.member), conv.coach_id])!;
  h.db.update('coach_assignments', assignment.id, { status: 'ended' });
  try {
    assert.equal((await download(String(ashaToken.json.url))).statusCode, 404);
    assert.equal((await asha.post(`/api/attachments/${id}/file-token`)).status, 404);
    assert.equal((await asha.post(`/api/conversations/${conv.id}/attachments`, { dataBase64: b64(PNG_1x1) })).json.error?.code, 'NO_ACCESS');
    assert.equal((await member.post(`/api/attachments/${id}/file-token`)).status, 200, 'the member keeps their own file');
  } finally {
    h.db.update('coach_assignments', assignment.id, { status: 'active' });
  }
});

test('the sender removes an unsent file; unsent files are cleaned up after 24 hours, also while the module is off', async () => {
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const conv = conversationOf(DEMO.member);
  const up = await member.post(`/api/conversations/${conv.id}/attachments`, { dataBase64: b64(PNG_1x1) });
  const fileRow = files.getFile(h.ctx, h.db.get<{ file_id: string }>('SELECT file_id FROM message_attachments WHERE id = ?', [up.json.id as string])!.file_id)!;
  const abs = path.join(privateDir, fileRow.storage_path);
  assert.ok(fs.existsSync(abs));
  assert.equal((await asha.del(`/api/conversations/${conv.id}/attachments/${up.json.id}`)).status, 404, 'only the sender removes it');
  const del = await member.del(`/api/conversations/${conv.id}/attachments/${up.json.id}`);
  assert.equal(del.status, 200);
  assert.ok(!fs.existsSync(abs), 'the bytes are gone at once');
  assert.ok(files.getFile(h.ctx, fileRow.id) === null);
  assert.equal(lastAudit('message.attachment_discard', up.json.id as string)?.actor_id, userId(h.ctx, DEMO.member));

  // a sent file stays with its message
  const sentUp = await member.post(`/api/conversations/${conv.id}/attachments`, { dataBase64: b64(PNG_1x1) });
  await member.post(`/api/conversations/${conv.id}/messages`, { body: 'kept', attachmentIds: [sentUp.json.id] });
  assert.equal(stateCode(await member.del(`/api/conversations/${conv.id}/attachments/${sentUp.json.id}`)), 'ATTACHMENT_SENT');

  // the clean-up: a file left unsent for more than a day is deleted, by the system, while the module is off
  const stale = await member.post(`/api/conversations/${conv.id}/attachments`, { dataBase64: b64(PDF) });
  const fresh = await member.post(`/api/conversations/${conv.id}/attachments`, { dataBase64: b64(PDF) });
  h.db.update('message_attachments', stale.json.id as string, { created_at: addDays(new Date().toISOString(), -2) });
  await setFlag(false);
  try {
    // with the module off: no uploads, no tokens, no files on messages; plain messages and removal still work
    assert.equal((await member.post(`/api/conversations/${conv.id}/attachments`, { dataBase64: b64(PNG_1x1) })).json.error?.code, 'FEATURE_DISABLED');
    assert.equal((await member.post(`/api/attachments/${sentUp.json.id}/file-token`)).json.error?.code, 'FEATURE_DISABLED');
    const fid = h.db.get<{ file_id: string }>('SELECT file_id FROM message_attachments WHERE id = ?', [sentUp.json.id as string])!.file_id;
    assert.equal((await member.post(`/api/files/${fid}/token`)).status, 404, 'the generic file route is closed too');
    assert.equal((await member.post(`/api/conversations/${conv.id}/messages`, { body: '', attachmentIds: [fresh.json.id] })).json.error?.code, 'FEATURE_DISABLED');
    assert.equal((await member.post(`/api/conversations/${conv.id}/messages`, { body: 'plain text still works' })).status, 201);
    assert.equal((await member.get('/api/me/announcements')).json.error?.code, 'FEATURE_DISABLED');

    const job = moduleJobs().find((j) => j.name === 'messaging.attachments_cleanup')!;
    const out = await job.run(h.ctx) as { discarded: number };
    assert.equal(out.discarded, 1);
    assert.ok(h.db.get('SELECT deleted_at FROM message_attachments WHERE id = ? AND deleted_at IS NOT NULL', [stale.json.id as string]));
    assert.ok(h.db.get('SELECT 1 FROM message_attachments WHERE id = ? AND deleted_at IS NULL', [fresh.json.id as string]), 'a recent unsent file stays');
    const a = lastAudit('message.attachment_discard', stale.json.id as string)!;
    assert.equal(a.actor_role, 'system');
    assert.match(a.reason ?? '', /24 hours/);
    const publishJob = moduleJobs().find((j) => j.name === 'messaging.announcements_publish')!;
    assert.deepEqual(await publishJob.run(h.ctx), { featureOff: 'messaging' }, 'the publish job waits while the module is off');

    assert.equal((await member.del(`/api/conversations/${conv.id}/attachments/${fresh.json.id}`)).status, 200, 'removal is ungated');
  } finally {
    await setFlag(true);
  }
});

/* ================================================== announcements ================================================== */

test('announcement routes need their role and permission', async () => {
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  assert.equal((await member.get('/api/coach/announcements')).status, 403);
  assert.equal((await member.get('/api/admin/announcements')).status, 403);
  assert.equal((await asha.get('/api/admin/announcements')).status, 403);
  assert.equal((await asha.get('/api/me/announcements')).status, 403);
  assert.equal((await admin.get('/api/me/announcements')).status, 403);
  const adminId = userId(h.ctx, DEMO.admin);
  setUserPermission(as(DEMO.owner), adminId, 'announcements.manage', false, 'test: no announcements');
  try {
    const r = await admin.get('/api/admin/announcements');
    assert.equal(r.status, 403);
    assert.equal(r.json.error?.code, 'PERMISSION_DENIED');
    assert.equal((await admin.post('/api/admin/announcements', { title: 'Hello there', body: 'x' })).json.error?.code, 'PERMISSION_DENIED');
  } finally {
    setUserPermission(as(DEMO.owner), adminId, 'announcements.manage', true, 'test: announcements back');
  }
  assert.equal((await admin.get('/api/admin/announcements')).status, 200);
  const opts = await admin.get('/api/admin/announcements/options');
  assert.ok((opts.json.packages as Array<{ name: string }>).some((p) => p.name === 'Core'));
  assert.ok((opts.json.coaches as unknown[]).length >= 4);
  assert.deepEqual(findRestrictedFields(opts.json, restrictedKeys()), [], 'names only, no contact details');
});

test('the team drafts, narrows, publishes and withdraws; members see only what reaches them, and a withdrawn one disappears', async () => {
  const ananya = await signedIn(DEMO.member, DEMO_PASSWORDS.member); // Core, coached by Asha
  const vikram = await signedIn(DEMO.member2, DEMO_PASSWORDS.member); // Advanced, coached by Rahul
  const core = h.db.get<{ id: string }>("SELECT id FROM packages WHERE slug = 'core'")!.id;

  // validation: plain text only (tags are removed), a real package, the lengths
  assert.equal((await admin.post('/api/admin/announcements', { title: 'Hi', body: 'x' })).json.error?.code, 'VALIDATION_FAILED');
  assert.equal((await admin.post('/api/admin/announcements', { title: 'Opening hours', body: 'x', audience: { packageIds: ['pkg_nope'] } })).json.error?.code, 'AUDIENCE_INVALID');
  assert.equal((await admin.post('/api/admin/announcements', { title: 'Opening hours', body: 'x', audience: { coachId: userId(h.ctx, DEMO.member) } })).json.error?.code, 'AUDIENCE_INVALID');
  assert.equal((await admin.post('/api/admin/announcements', { title: '<b></b><i></i>', body: 'x' })).json.error?.code, 'TITLE_INVALID');
  const draft = await admin.post('/api/admin/announcements', { title: 'Test: <b>new</b> booking hours', body: 'Bookings open from <script>alert(1)</script>7 am.\r\n\r\n\r\n\r\nThanks.', audience: { packageIds: [core] } });
  assert.equal(draft.status, 201, JSON.stringify(draft.json));
  assert.equal(draft.json.title, 'Test: new booking hours');
  assert.equal(draft.json.body, 'Bookings open from alert(1)7 am.\n\nThanks.');
  assert.equal(draft.json.status, 'draft');
  const id = draft.json.id as string;
  assert.equal(lastAudit('announcement.create', id)?.actor_id, userId(h.ctx, DEMO.admin));

  // a draft reaches nobody
  const seen = async (c: C) => ((await c.get('/api/me/announcements')).json.items as Array<{ id: string; read: boolean; from: string }>);
  assert.ok(!(await seen(ananya)).some((a) => a.id === id));
  assert.equal((await ananya.post(`/api/me/announcements/${id}/read`)).status, 404);

  // edit, then publish: Core members see it and are notified; Advanced members do not
  const edited = await admin.patch(`/api/admin/announcements/${id}`, { body: 'Bookings open from 7 am on weekdays.' });
  assert.equal(edited.status, 200);
  assert.equal(lastAudit('announcement.update', id)?.actor_id, userId(h.ctx, DEMO.admin));
  const pub = await admin.post(`/api/admin/announcements/${id}/publish`, {});
  assert.equal(pub.status, 200, JSON.stringify(pub.json));
  assert.equal(pub.json.status, 'published');
  assert.ok((pub.json.reach as { members: number }).members >= 1);
  assert.equal(lastAudit('announcement.publish', id)?.actor_id, userId(h.ctx, DEMO.admin));
  await processPending(h.ctx);
  const mine = await seen(ananya);
  const item = mine.find((a) => a.id === id)!;
  assert.equal(item.from, 'The Bioptime team');
  assert.equal(item.read, false);
  assert.ok(!(await seen(vikram)).some((a) => a.id === id), 'the package audience leaves Vikram out');
  const ananyaId = userId(h.ctx, DEMO.member);
  const notes = h.db.all<{ id: string; title: string }>("SELECT id, title FROM notifications WHERE user_id = ? AND category = 'announcement' AND json_extract(data, '$.announcementId') = ?", [ananyaId, id]);
  assert.equal(notes.length, 1);
  const push = h.db.get<{ body: string }>("SELECT body FROM outbox_messages WHERE notification_id = ? AND channel = 'push'", [notes[0]!.id]);
  assert.equal(push?.body, 'Open the app for the detail.', 'nothing on the lock screen');
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM notifications WHERE category = 'announcement' AND json_extract(data, '$.announcementId') = ? AND user_id = ?", [id, userId(h.ctx, DEMO.member2)])!.n, 0);
  // delivery is safe to repeat
  assert.deepEqual(announcements.deliver(h.ctx, id), { notified: 0 });

  // reading: the first read is recorded and audited, a second changes nothing
  const unreadBefore = (await ananya.get('/api/me/announcements')).json.unread as number;
  const r1 = await ananya.post(`/api/me/announcements/${id}/read`);
  assert.equal(r1.status, 200);
  assert.equal(((await ananya.get('/api/me/announcements')).json.unread as number), unreadBefore - 1);
  await ananya.post(`/api/me/announcements/${id}/read`);
  assert.equal(auditCount('announcement.read', id), 1);
  assert.equal((await vikram.post(`/api/me/announcements/${id}/read`)).status, 404, 'outside the audience');

  // a published one cannot be edited; withdrawing needs a reason, and then it disappears with its notification text
  assert.equal(stateCode(await admin.patch(`/api/admin/announcements/${id}`, { title: 'Changed after the fact' })), 'NOT_EDITABLE');
  assert.equal((await admin.post(`/api/admin/announcements/${id}/withdraw`, {})).json.error?.code, 'VALIDATION_FAILED');
  const w = await admin.post(`/api/admin/announcements/${id}/withdraw`, { reason: 'Hours changed again' });
  assert.equal(w.status, 200);
  assert.equal(w.json.status, 'withdrawn');
  const wa = lastAudit('announcement.withdraw', id)!;
  assert.equal(wa.reason, 'Hours changed again');
  assert.equal(wa.actor_id, userId(h.ctx, DEMO.admin));
  assert.ok(!(await seen(ananya)).some((a) => a.id === id), 'a withdrawn announcement disappears');
  assert.equal((await ananya.post(`/api/me/announcements/${id}/read`)).status, 404);
  assert.equal(h.db.get<{ title: string; body: string }>('SELECT title, body FROM notifications WHERE id = ?', [notes[0]!.id])!.title, 'An announcement was withdrawn');
  assert.equal(stateCode(await admin.post(`/api/admin/announcements/${id}/publish`, {})), 'NOT_PUBLISHABLE');
  assert.equal(stateCode(await admin.post(`/api/admin/announcements/${id}/withdraw`, { reason: 'twice' })), 'ALREADY_WITHDRAWN');
});

test('scheduled announcements are published by the job at their time', async () => {
  const ananya = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const created = await admin.post('/api/admin/announcements', { title: 'Test: scheduled note', body: 'Goes out later.' });
  const id = created.json.id as string;
  const when = addDays(new Date().toISOString(), 2);
  const s = await admin.post(`/api/admin/announcements/${id}/publish`, { publishAt: when });
  assert.equal(s.status, 200);
  assert.equal(s.json.status, 'scheduled');
  assert.equal(lastAudit('announcement.schedule', id)?.actor_id, userId(h.ctx, DEMO.admin));
  assert.equal((await admin.post(`/api/admin/announcements/${id}/publish`, { publishAt: addDays(new Date().toISOString(), 400) })).json.error?.code, 'PUBLISH_AT_INVALID');
  assert.ok(!((await ananya.get('/api/me/announcements')).json.items as Array<{ id: string }>).some((a) => a.id === id));
  // still editable while scheduled
  assert.equal((await admin.patch(`/api/admin/announcements/${id}`, { title: 'Test: scheduled note, edited' })).status, 200);

  assert.deepEqual(announcements.publishDue(h.ctx), { published: 0 }, 'not yet');
  const later = at(addMinutes(when, 1));
  const out = announcements.publishDue(later);
  assert.ok(out.published >= 1);
  const row = h.db.get<{ status: string; published_by: string }>('SELECT status, published_by FROM announcements WHERE id = ?', [id])!;
  assert.equal(row.status, 'published');
  assert.equal(row.published_by, userId(h.ctx, DEMO.admin), 'who scheduled it is kept');
  const a = lastAudit('announcement.publish', id)!;
  assert.equal(a.actor_role, 'system');
  assert.equal(JSON.parse(a.data).scheduledBy, userId(h.ctx, DEMO.admin));
  await processPending(later);
  assert.ok(((await ananya.get('/api/me/announcements')).json.items as Array<{ id: string }>).some((x) => x.id === id));
  assert.ok(h.db.get("SELECT 1 FROM notifications WHERE category = 'announcement' AND json_extract(data, '$.announcementId') = ? AND user_id = ?", [id, userId(h.ctx, DEMO.member)]));
});

test('a coach’s announcement reaches only their own clients; coaches withdraw only their own', async () => {
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach); // Ananya and Priya
  const rahul = await signedIn(DEMO.coach2, DEMO_PASSWORDS.coach); // Vikram
  const ananya = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const vikram = await signedIn(DEMO.member2, DEMO_PASSWORDS.member);

  // a coach cannot choose an audience: it is always their own clients
  assert.equal((await asha.post('/api/coach/announcements', { title: 'To everyone', body: 'x', audience: { packageIds: [] } })).json.error?.code, 'VALIDATION_FAILED');
  const r = await asha.post('/api/coach/announcements', { title: 'Test: away on Friday', body: 'Messages wait until Monday.' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  noRestricted(r.json);
  assert.equal(r.json.status, 'published');
  assert.equal(r.json.origin, 'coach');
  const ashaId = userId(h.ctx, DEMO.coach);
  assert.equal((r.json.audience as { coachId: string }).coachId, ashaId);
  const clients = h.db.get<{ n: number }>("SELECT COUNT(*) n FROM coach_assignments a JOIN users u ON u.id = a.member_id WHERE a.coach_id = ? AND a.status IN ('active','paused') AND u.state = 'active'", [ashaId])!.n;
  assert.equal((r.json.reach as { members: number }).members, clients);
  const id = r.json.id as string;
  assert.equal(lastAudit('announcement.create', id)?.actor_id, ashaId);
  assert.equal(lastAudit('announcement.publish', id)?.actor_id, ashaId);
  await processPending(h.ctx);

  const ananyaSees = ((await ananya.get('/api/me/announcements')).json.items as Array<{ id: string; from: string }>).find((a) => a.id === id);
  assert.equal(ananyaSees?.from, 'Asha Menon');
  assert.ok(!((await vikram.get('/api/me/announcements')).json.items as Array<{ id: string }>).some((a) => a.id === id), 'another coach’s client never sees it');
  const recipients = h.db.all<{ user_id: string }>("SELECT user_id FROM notifications WHERE category = 'announcement' AND json_extract(data, '$.announcementId') = ?", [id]).map((n) => n.user_id).sort();
  const assigned = h.db.all<{ member_id: string }>("SELECT a.member_id FROM coach_assignments a JOIN users u ON u.id = a.member_id WHERE a.coach_id = ? AND a.status IN ('active','paused') AND u.state = 'active'", [ashaId]).map((x) => x.member_id).sort();
  assert.deepEqual(recipients, assigned, 'notified: exactly the coach’s own clients');

  // the coach's list: own announcements with reach and reads, never a contact detail; another coach sees none of them
  const list = await asha.get('/api/coach/announcements');
  assert.equal(list.status, 200);
  assert.ok((list.json.items as Array<{ id: string }>).some((a) => a.id === id));
  assert.equal(list.json.clients, clients);
  noRestricted(list.json);
  assert.ok(!((await rahul.get('/api/coach/announcements')).json.items as Array<{ id: string }>).some((a) => a.id === id));
  assert.equal((await rahul.post(`/api/coach/announcements/${id}/withdraw`, { reason: 'not mine' })).status, 404);

  // a member who leaves the coach stops seeing it
  const assignment = h.db.get<{ id: string }>("SELECT id FROM coach_assignments WHERE member_id = ? AND coach_id = ? AND status = 'active'", [userId(h.ctx, DEMO.member), ashaId])!;
  h.db.update('coach_assignments', assignment.id, { status: 'ended' });
  try {
    assert.ok(!((await ananya.get('/api/me/announcements')).json.items as Array<{ id: string }>).some((a) => a.id === id));
  } finally {
    h.db.update('coach_assignments', assignment.id, { status: 'active' });
  }

  // a coach without clients has nobody to announce to
  const rahulAssignments = h.db.all<{ id: string }>("SELECT id FROM coach_assignments WHERE coach_id = ? AND status IN ('active','paused')", [userId(h.ctx, DEMO.coach2)]);
  for (const x of rahulAssignments) h.db.update('coach_assignments', x.id, { status: 'ended' });
  try {
    assert.equal(stateCode(await rahul.post('/api/coach/announcements', { title: 'Test: hello', body: 'x' })), 'NO_RECIPIENTS');
    assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM announcements WHERE created_by = ?", [userId(h.ctx, DEMO.coach2)])!.n, 0);
  } finally {
    for (const x of rahulAssignments) h.db.update('coach_assignments', x.id, { status: 'active' });
  }

  // the coach withdraws their own (reason required); the team can withdraw a coach's too, but not edit it
  assert.equal(stateCode(await admin.patch(`/api/admin/announcements/${id}`, { title: 'Edited by the team' })), 'COACH_ANNOUNCEMENT');
  const w = await asha.post(`/api/coach/announcements/${id}/withdraw`, { reason: 'Plans changed' });
  assert.equal(w.status, 200);
  noRestricted(w.json);
  assert.equal(lastAudit('announcement.withdraw', id)?.actor_id, ashaId);
  assert.ok(!((await ananya.get('/api/me/announcements')).json.items as Array<{ id: string }>).some((a) => a.id === id));
  const all = await admin.get('/api/admin/announcements?origin=coach');
  assert.ok((all.json.items as Array<{ id: string; status: string }>).some((a) => a.id === id && a.status === 'withdrawn'));
});

/* ================================================== data export ================================================== */

test('data export: the announcements the member opened and the names, types and sizes of files in her own conversations; never a file’s contents, drafts or withdrawn text', async () => {
  const ananya = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const ananyaId = userId(h.ctx, DEMO.member);
  const conv = conversationOf(DEMO.member);
  const priyaConv = conversationOf(PRIYA);

  // files: one she sent, one her coach sent her, one still unsent in her composer, one her coach sent another member
  const upload = async (c: C, convId: string, buf: Buffer, filename: string) => { const r = await c.post(`/api/conversations/${convId}/attachments`, { dataBase64: b64(buf), filename }); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json.id as string; };
  const hers = await upload(ananya, conv.id, PDF, 'export-check-letter.pdf');
  assert.equal((await ananya.post(`/api/conversations/${conv.id}/messages`, { body: '', attachmentIds: [hers] })).status, 201);
  const fromCoach = await upload(asha, conv.id, PNG_1x1, 'export-check-plan.png');
  assert.equal((await asha.post(`/api/conversations/${conv.id}/messages`, { body: 'Plan attached.', attachmentIds: [fromCoach] })).status, 201);
  await upload(ananya, conv.id, PNG_1x1, 'export-check-unsent.png');
  const forPriya = await upload(asha, priyaConv.id, PNG_1x1, 'export-check-for-priya.png');
  assert.equal((await asha.post(`/api/conversations/${priyaConv.id}/messages`, { body: '', attachmentIds: [forPriya] })).status, 201);

  // announcements: the team's one she opens, her coach's one she opens and the coach then withdraws, one she leaves
  // unopened, and a draft that never reached her
  const publishTeam = async (title: string, body: string) => { const c = await admin.post('/api/admin/announcements', { title, body }); assert.equal(c.status, 201, JSON.stringify(c.json)); assert.equal((await admin.post(`/api/admin/announcements/${c.json.id}/publish`, {})).status, 200); return c.json.id as string; };
  const teamId = await publishTeam('Export check: team news', 'Export check: the team body.');
  const unopenedId = await publishTeam('Export check: left unopened', 'Export check: never opened.');
  const coachAnn = await asha.post('/api/coach/announcements', { title: 'Export check: coach news', body: 'Export check: the coach body, withdrawn later.' });
  assert.equal(coachAnn.status, 201, JSON.stringify(coachAnn.json));
  assert.equal((await admin.post('/api/admin/announcements', { title: 'Export check: still a draft', body: 'EXPORT-CHECK-DRAFT-BODY' })).status, 201);
  await processPending(h.ctx);
  assert.equal((await ananya.post(`/api/me/announcements/${teamId}/read`)).status, 200);
  assert.equal((await ananya.post(`/api/me/announcements/${coachAnn.json.id}/read`)).status, 200);
  assert.equal((await asha.post(`/api/coach/announcements/${coachAnn.json.id}/withdraw`, { reason: 'EXPORT-CHECK-WITHDRAW-REASON' })).status, 200);
  // and a coach's one the team withdraws (the team may withdraw any announcement): the note must not say "its sender"
  const teamPulled = await asha.post('/api/coach/announcements', { title: 'Export check: pulled by the team', body: 'Export check: a coach body the team withdrew.' });
  assert.equal(teamPulled.status, 201, JSON.stringify(teamPulled.json));
  await processPending(h.ctx);
  assert.equal((await ananya.post(`/api/me/announcements/${teamPulled.json.id}/read`)).status, 200);
  assert.equal((await admin.post(`/api/admin/announcements/${teamPulled.json.id}/withdraw`, { reason: 'EXPORT-CHECK-TEAM-WITHDRAW-REASON' })).status, 200);
  const pulledRow = h.db.get<{ created_by: string; withdrawn_by: string }>('SELECT created_by, withdrawn_by FROM announcements WHERE id = ?', [teamPulled.json.id as string])!;
  assert.deepEqual({ ...pulledRow }, { created_by: userId(h.ctx, DEMO.coach), withdrawn_by: userId(h.ctx, DEMO.admin) }, 'written by the coach, withdrawn by the team');

  const archive = buildArchive(h.ctx, ananyaId, 'drq_test_messaging_export');
  const body = JSON.stringify(archive);
  type Section = { label: string; records: Array<Record<string, unknown>> };
  const sections = (archive.moduleSections as Record<string, Record<string, Section>> | undefined)?.messaging;
  assert.ok(sections?.announcementReads && sections.messageFiles, 'moduleSections.messaging.announcementReads and .messageFiles are present');
  assert.match(sections.messageFiles.label, /name, type and size only/);
  assert.equal(archive.notIncluded.find((n) => /announcements you have opened/i.test(n.what)), undefined, 'the module leaves notIncluded once it contributes');
  const sectionText = JSON.stringify(sections);
  assert.ok(!sectionText.includes('@'), 'no email address of anyone');

  // announcements: one record for every opening the database holds, in the shape her page shows
  const reads = sections.announcementReads.records;
  assert.equal(reads.length, h.db.get<{ n: number }>('SELECT COUNT(*) n FROM announcement_reads WHERE user_id = ?', [ananyaId])!.n);
  for (const r of reads) assert.deepEqual(Object.keys(r).sort(), ['body', 'from', 'note', 'openedAt', 'publishedAt', 'title'], 'no audience, reach, read counts, ids or who on the team wrote it');
  const team = reads.find((r) => r.title === 'Export check: team news')!;
  assert.deepEqual({ body: team.body, from: team.from, note: team.note }, { body: 'Export check: the team body.', from: 'The Bioptime team', note: null });
  assert.equal(team.openedAt, h.db.get<{ read_at: string }>('SELECT read_at FROM announcement_reads WHERE announcement_id = ? AND user_id = ?', [teamId, ananyaId])!.read_at);
  assert.ok(team.publishedAt);
  const gone = reads.filter((r) => r.title === null);
  assert.ok(gone.length >= 1 && gone.every((r) => r.body === null && r.from === null && r.openedAt), 'a withdrawn one keeps only when she opened it');
  // both withdrawn ones she opened (the coach's own withdrawal and the team's of a coach's one) carry the same note,
  // which says what happened without claiming who did it
  const withdrawnIds = [coachAnn.json.id as string, teamPulled.json.id as string];
  const openedAtOf = (id: string) => h.db.get<{ read_at: string }>('SELECT read_at FROM announcement_reads WHERE announcement_id = ? AND user_id = ?', [id, ananyaId])!.read_at;
  for (const id of withdrawnIds) {
    const rec = gone.find((r) => r.openedAt === openedAtOf(id));
    assert.ok(rec, `a record for the withdrawn announcement ${id}`);
    assert.equal(rec.note, 'Withdrawn after you opened it, so its text is no longer shown to you.');
  }
  assert.ok(gone.every((r) => !/sender|coach|team|administrator|Asha/i.test(String(r.note))), 'no note names who withdrew it');
  assert.ok(!body.includes('Export check: coach news') && !body.includes('withdrawn later'), 'its text is left out of the whole file, as from her notifications');
  assert.ok(!body.includes('Export check: pulled by the team') && !body.includes('a coach body the team withdrew'), 'the same for one the team withdrew');
  assert.ok(!body.includes('EXPORT-CHECK-WITHDRAW-REASON') && !body.includes('EXPORT-CHECK-TEAM-WITHDRAW-REASON'), 'never why it was withdrawn');
  assert.ok(!reads.some((r) => r.title === 'Export check: left unopened'), 'only the ones she opened');
  assert.ok(h.db.get('SELECT 1 FROM announcements WHERE id = ?', [unopenedId]));
  for (const a of h.db.all<{ title: string; body: string }>("SELECT title, body FROM announcements WHERE status IN ('draft','scheduled')")) {
    assert.ok(!body.includes(a.title) && !body.includes(a.body), `no draft or scheduled announcement: ${a.title}`);
  }

  // files: everything sent in her own conversations, by name, type and size; nothing unsent, nothing of another member's
  const sentFiles = sections.messageFiles.records;
  assert.equal(sentFiles.length, h.db.get<{ n: number }>('SELECT COUNT(*) n FROM message_attachments a JOIN conversations c ON c.id = a.conversation_id WHERE c.member_id = ? AND a.message_id IS NOT NULL AND a.deleted_at IS NULL', [ananyaId])!.n);
  for (const f of sentFiles) assert.deepEqual(Object.keys(f).sort(), ['bytes', 'conversationWith', 'from', 'kind', 'name', 'sentAt', 'type'], 'no file id, storage location, checksum or uploader id');
  const letter = sentFiles.find((f) => f.name === 'export-check-letter.pdf')!;
  assert.deepEqual({ type: letter.type, kind: letter.kind, bytes: letter.bytes, from: letter.from, conversationWith: letter.conversationWith }, { type: 'application/pdf', kind: 'pdf', bytes: PDF.length, from: 'you', conversationWith: 'Asha Menon' });
  const plan = sentFiles.find((f) => f.name === 'export-check-plan.png')!;
  assert.deepEqual({ type: plan.type, kind: plan.kind, bytes: plan.bytes, from: plan.from }, { type: 'image/png', kind: 'image', bytes: PNG_1x1.length, from: 'Asha Menon' });
  assert.ok(!sentFiles.some((f) => f.name === 'export-check-unsent.png'), 'a file still waiting in her composer was never sent');
  assert.ok(!body.includes('export-check-for-priya.png'), 'another member’s file is not in her file at all');
  // never a file's contents or where it is kept
  for (const id of [hers, fromCoach]) {
    const a = h.db.get<{ file_id: string; sha256: string }>('SELECT file_id, sha256 FROM message_attachments WHERE id = ?', [id])!;
    const stored = files.getFile(h.ctx, a.file_id)!;
    assert.ok(!body.includes(a.sha256), 'no checksum');
    assert.ok(!body.includes(stored.storage_path), 'no storage location');
  }
  assert.ok(!body.includes(b64(PDF)) && !body.includes(b64(PNG_1x1)) && !body.includes('%PDF'), 'no file contents');
});
