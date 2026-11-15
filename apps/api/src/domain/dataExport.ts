/* Data export (M4): fulfils a member's export request (POST /me/data-requests, kind export). Once an administrator
   marks the request in progress (PATCH /admin/data-requests/:id, or Generate on /admin/support), the data_exports job
   writes a JSON archive of the member's records to the private file store, sets data_requests.file_id and completes
   the request. Only the member opens it, through a 5-minute token (the data_export file kind's access resolver);
   administrators see that it exists, never its contents.

   The archive lists every section it includes and every kind of record it leaves out, with the reason. Columns are
   chosen one by one: no password hash, MFA secret, session token, provider payload or internal approval note, and
   nothing the member's own screens withhold (a bespoke proposal only once it was sent, and only its member-facing
   terms). The member's own note on each data request is theirs and is included; the team's note on it
   (data_request_admin_notes, kept apart since migration 0021) never is. Private files the member owns are listed by
   name, type, size and date only (no ids or storage details); the member opens each one in the app. Production
   refuses local disk for private files, so generation waits for production storage there.

   Modules add their own records under moduleSections (ApiModule.exportSections, see ExportSectionDef). NOT_YET_EXPORTED
   names, by module, the kinds of record a module keeps; while a module contributes no section, each of its kinds that
   the member has rows of is named under notIncluded with the member's count. */
// first, so that the file kind exists before the module registry reads it (see dataExportKind.ts)
export { EXPORT_KIND, canOpenExport } from './dataExportKind.js';
import { EXPORT_KIND } from './dataExportKind.js';
import type { Ctx } from '../context.js';
import { errors } from '../lib/errors.js';
import { j } from '../db/db.js';
import { audit } from './audit.js';
import { notify } from './notifications.js';
import { updateTask } from './support.js';
import { fileToken, saveGeneratedPrivateFile, storageRequirement } from './files.js';
import { ATTACHMENT_FILE_KIND as MESSAGE_ATTACHMENT_KIND } from './attachments.js';
import { requirePermission, requireRole } from '../auth/permissions.js';
import { dateInZone } from '../lib/time.js';
import { MODULES } from '../modules/index.js';
import type { ApiModule, ModuleKey } from '../modules/types.js';
import type { Proposal } from './customPlans.js';

export const EXPORT_FORMAT_VERSION = 1;

type RequestRow = { id: string; user_id: string; kind: 'export' | 'deletion'; status: 'requested' | 'in_progress' | 'completed' | 'cancelled'; note: string | null; file_id: string | null; created_at: string; completed_at: string | null };

/* ---------- the archive ---------- */

const json = (v: unknown) => j.out<unknown>(v, v);
function parsed<T extends Record<string, unknown>>(rows: T[], keys: string[]): T[] {
  return rows.map((r) => { const o: Record<string, unknown> = { ...r }; for (const k of keys) if (k in o) o[k] = json(o[k]); return o as T; });
}

/** The proposal terms a member sees once a proposal was sent (customPlans.memberView): never the internal notes, the
 *  coach chosen internally, or draft terms still being scoped or awaiting approval. */
const MEMBER_PROPOSAL_TERMS = ['durationMonths', 'durationLabel', 'consultations', 'bloodworkEntitlements', 'priceInr', 'services', 'deliverables', 'conditions', 'reviewSchedule'] as const satisfies ReadonlyArray<keyof Proposal>;

type BespokeRow = { reference: string; status: string; goals: string; duration: string | null; budget_paise: number | null; notes: string | null; proposal: string; proposal_sent_at: string | null; expires_at: string | null; decided_at: string | null; created_at: string };
function bespokeForMember(r: BespokeRow) {
  const p = j.out<Proposal>(r.proposal, {});
  const terms = r.proposal_sent_at ? Object.fromEntries(MEMBER_PROPOSAL_TERMS.map((k) => [k, p[k] ?? null])) : null;
  return { reference: r.reference, status: r.status, goals: r.goals, duration: r.duration, budget_paise: r.budget_paise, yourNotes: r.notes, proposal: terms, proposal_sent_at: r.proposal_sent_at, expires_at: r.expires_at, decided_at: r.decided_at, created_at: r.created_at };
}

/** A module's contribution to the archive (ApiModule.exportSections): buildArchive merges each one under
 *  moduleSections.<module key>.<key>, and that module's kinds leave the notIncluded list. */
export type ExportSectionDef = { key: string; label: string; build: (ctx: Ctx, memberId: string) => unknown };
const contributedSections = (m: ApiModule): ExportSectionDef[] => m.exportSections ?? [];

/** Member records kept by the modules, by module, with the tables (and the column naming the member) that hold them. A
 *  module's kinds are in the archive once it contributes exportSections (today every module listed here does); while a
 *  module contributes none, each of its kinds is named under notIncluded if its table exists and the member has rows in
 *  it. Exported for the tests, which check the list against the registry and the database. */
export const NOT_YET_EXPORTED: ReadonlyArray<{ module: ModuleKey; what: string; tables: Array<[table: string, memberColumn: string]> }> = [
  { module: 'habits', what: 'Habits and habit check-ins', tables: [['habits', 'member_id'], ['habit_checkins', 'member_id']] },
  { module: 'progress', what: 'Goals, check-ins, check-in schedules and progress photo details', tables: [['goals', 'member_id'], ['checkins', 'member_id'], ['checkin_schedules', 'member_id'], ['progress_photos', 'member_id']] },
  { module: 'billing', what: 'Invoices, credit notes and other billing documents, and refund requests', tables: [['billing_documents', 'member_id'], ['refund_requests', 'member_id']] },
  { module: 'nutrition', what: 'Nutrition profile, meal plans, meal logs and saved dishes', tables: [['nutrition_profiles', 'member_id'], ['meal_plans', 'member_id'], ['meal_logs', 'member_id'], ['nutrition_favourites', 'member_id']] },
  { module: 'workouts', what: 'Workout programmes and logged workout sessions', tables: [['workout_programs', 'member_id'], ['workout_sessions', 'member_id']] },
  { module: 'labFollowups', what: 'Follow-ups on your blood test reports', tables: [['lab_followups', 'member_id']] },
  { module: 'sessions', what: 'Live session registrations', tables: [['session_registrations', 'user_id']] },
  { module: 'messaging', what: 'Which announcements you have opened', tables: [['announcement_reads', 'user_id']] },
  { module: 'learning', what: 'Course enrolments and lesson progress', tables: [['course_enrollments', 'member_id']] },
];
export const NOT_YET_WHY = 'Not part of this file yet. Ask for a copy through Help and support.';

/** The member's own note on a data request, for their archive. Before migration 0021 an administrator's PATCH
 *  /admin/data-requests/:id wrote the team's note over data_requests.note, so the note of a request an administrator
 *  updated before that migration was applied is left out: it may be the team's words, not the member's. */
const ADMIN_NOTES_MIGRATION = '0021_integration_admin.sql';
function memberOwnNote(ctx: Ctx, requestId: string, note: string | null): string | null {
  if (!note) return null;
  const since = ctx.db.get<{ applied_at: string }>('SELECT applied_at FROM schema_migrations WHERE version = ?', [ADMIN_NOTES_MIGRATION])?.applied_at;
  if (!since) return null;
  const overwrittenBefore = ctx.db.get("SELECT 1 FROM audit_events WHERE action = 'data_request.update' AND target_id = ? AND at < ? LIMIT 1", [requestId, since]);
  return overwrittenBefore ? null : note;
}

function hasColumn(ctx: Ctx, table: string, column: string): boolean {
  if (!ctx.db.get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", [table])) return false;
  return ctx.db.all<{ name: string }>(`SELECT name FROM pragma_table_info(?)`, [table]).some((c) => c.name === column);
}

/** The kinds of record named under notIncluded because no module exports them yet, with this member's count. */
function notYetExported(ctx: Ctx, memberId: string, covered: Set<string>) {
  const out: Array<{ what: string; why: string; records: number }> = [];
  for (const k of NOT_YET_EXPORTED) {
    if (covered.has(k.module)) continue;
    let records = 0;
    for (const [table, column] of k.tables) {
      if (hasColumn(ctx, table, column)) records += ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM ${table} WHERE ${column} = ?`, [memberId])?.n ?? 0;
    }
    if (records > 0) out.push({ what: k.what, why: NOT_YET_WHY, records });
  }
  return out;
}

/** Everything Bioptime holds about the member that is theirs to take, section by section; what it leaves out is named. */
export function buildArchive(ctx: Ctx, memberId: string, requestId: string) {
  const db = ctx.db;
  const all = <T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: (string | number)[] = [memberId]) => db.all<T>(sql, params);
  const account = db.get('SELECT id, email, phone, name, role, state, email_verified_at, phone_verified_at, mfa_enabled, last_login_at, created_at, updated_at FROM users WHERE id = ?', [memberId]);
  const profile = db.get<Record<string, unknown>>('SELECT * FROM member_profiles WHERE user_id = ?', [memberId]);
  const conversations = all<{ id: string; coach_id: string; coach_name: string; created_at: string }>('SELECT c.id, c.coach_id, u.name AS coach_name, c.created_at FROM conversations c JOIN users u ON u.id = c.coach_id WHERE c.member_id = ? ORDER BY c.created_at');
  const supportRequests = all<{ id: string }>('SELECT id, reference, category, subject, status, created_at, updated_at, resolved_at FROM support_requests WHERE requester_id = ? ORDER BY created_at');
  // private files the member owns (progress photos, meal photos and any other kind a module stores), by name, type, size
  // and date only. Left out: earlier exports, and message attachments (messaging's own section lists the sent ones; an
  // unsent one waits in the member's composer and is named under notIncluded)
  const otherFiles = all('SELECT name, mime AS type, size, created_at FROM file_metadata WHERE owner_id = ? AND deleted_at IS NULL AND kind NOT IN (?, ?) ORDER BY created_at, id', [memberId, EXPORT_KIND, MESSAGE_ATTACHMENT_KIND]);
  const dataRequests = all<{ id: string; kind: string; status: string; note: string | null; created_at: string; completed_at: string | null }>('SELECT id, kind, status, note, created_at, completed_at FROM data_requests WHERE user_id = ? ORDER BY created_at')
    .map((r) => ({ kind: r.kind, status: r.status, yourNote: memberOwnNote(ctx, r.id, r.note), created_at: r.created_at, completed_at: r.completed_at }));
  const moduleSections: Record<string, Record<string, unknown>> = {};
  for (const m of MODULES) {
    const defs = contributedSections(m);
    if (!defs.length) continue;
    moduleSections[m.key] = Object.fromEntries(defs.map((d) => [d.key, { label: d.label, records: d.build(ctx, memberId) }]));
  }
  const pending = notYetExported(ctx, memberId, new Set(Object.keys(moduleSections)));
  return {
    format: 'bioptime-data-export',
    version: EXPORT_FORMAT_VERSION,
    generatedAt: ctx.now(),
    requestId,
    memberId,
    about: 'A copy of the records listed under "sections" (and "moduleSections", when present), as of the time above. Anything Bioptime holds about you that is not in this file is named under "notIncluded", with the reason. Times are UTC (ISO 8601); amounts are in paise (1 rupee = 100 paise).',
    sections: {
      account,
      // the wellness score label reads 'estimate' where the column still holds its old default 'sample' (as the profile
      // screens show it; owner decision of 24 October 2026: no screen or file says sample)
      profile: profile ? parsed([{ ...profile, wellness_score_label: !profile.wellness_score_label || profile.wellness_score_label === 'sample' ? 'estimate' : profile.wellness_score_label }], ['goals', 'preferences'])[0] : null,
      onboarding: db.get('SELECT step, data, updated_at FROM onboarding_progress WHERE user_id = ?', [memberId]) ?? null,
      consents: all('SELECT kind, version, granted, ip, at FROM member_consents WHERE user_id = ? ORDER BY at'),
      notificationPreferences: db.get('SELECT email, sms, push, reminders, marketing, lock_screen_detail, quiet_start_minute, quiet_end_minute, updated_at FROM notification_preferences WHERE user_id = ?', [memberId]) ?? null,
      programmes: all('SELECT g.id, p.name AS package_name, v.duration_label, g.status, g.start_at, g.end_at, g.ended_at, g.created_at FROM programmes g LEFT JOIN package_versions v ON v.id = g.package_version_id LEFT JOIN packages p ON p.id = v.package_id WHERE g.member_id = ? ORDER BY g.created_at'),
      orders: parsed(all('SELECT o.reference, p.name AS package_name, o.status, o.amount_paise, o.gst_paise, o.total_paise, o.currency, o.metadata, o.failure_reason, o.paid_at, o.activated_at, o.cancelled_at, o.created_at FROM orders o LEFT JOIN package_versions v ON v.id = o.package_version_id LEFT JOIN packages p ON p.id = v.package_id WHERE o.member_id = ? ORDER BY o.created_at'), ['metadata']),
      payments: all('SELECT o.reference AS order_reference, y.provider, y.status, y.amount_paise, y.currency, y.created_at, y.updated_at FROM payments y JOIN orders o ON o.id = y.order_id WHERE o.member_id = ? ORDER BY y.created_at'),
      refunds: all('SELECT o.reference AS order_reference, r.amount_paise, r.status, r.reason, r.created_at FROM refunds r JOIN orders o ON o.id = r.order_id WHERE o.member_id = ? ORDER BY r.created_at'),
      entitlements: all('SELECT service_type, unit, quantity, used_qty, reserved_qty, status, expires_at, created_at FROM entitlements WHERE member_id = ? ORDER BY created_at'),
      coachAssignments: all('SELECT u.name AS coach_name, a.status, a.effective_at, a.ended_at, a.created_at FROM coach_assignments a LEFT JOIN users u ON u.id = a.coach_id WHERE a.member_id = ? ORDER BY a.created_at'),
      appointments: all('SELECT a.kind, a.status, a.start_at, a.end_at, a.timezone, u.name AS coach_name, a.member_note, a.cancelled_reason, a.created_at FROM appointments a LEFT JOIN users u ON u.id = a.coach_id WHERE a.member_id = ? ORDER BY a.start_at'),
      plans: parsed(all("SELECT p.title, p.goals, p.status, v.version, v.summary, v.structure, v.published_at FROM coaching_plans p JOIN coaching_plan_versions v ON v.plan_id = p.id WHERE p.member_id = ? AND v.status = 'published' ORDER BY v.published_at"), ['goals', 'structure']),
      planTasks: all('SELECT title, kind, week, day, due_at, status, completed_at FROM plan_tasks WHERE member_id = ? ORDER BY due_at, sort'),
      progressEntries: all('SELECT metric, value, unit, at, source, note, created_at FROM progress_entries WHERE member_id = ? ORDER BY at'),
      coachRecommendations: all("SELECT n.kind, n.body, u.name AS coach_name, n.created_at FROM coach_notes n LEFT JOIN users u ON u.id = n.coach_id WHERE n.member_id = ? AND n.visibility = 'client' ORDER BY n.created_at"),
      bloodworkBookings: parsed(all('SELECT b.reference, t.name AS test_name, b.status, b.slot_at, b.patient, b.address, b.city, b.state, b.pincode, b.expected_report_by, b.cancelled_reason, b.created_at FROM bloodwork_bookings b LEFT JOIN bloodwork_tests t ON t.id = b.test_id WHERE b.member_id = ? ORDER BY b.created_at'), ['patient']),
      bloodworkTimeline: all('SELECT b.reference, e.at, e.from_status, e.to_status, e.source, e.note FROM booking_events e JOIN bloodwork_bookings b ON b.id = e.booking_id WHERE b.member_id = ? ORDER BY e.at'),
      reports: all('SELECT r.id, b.reference AS booking_reference, r.delivered_at, r.released_at, r.reviewed_at, r.coach_note, r.flagged FROM report_metadata r JOIN bloodwork_bookings b ON b.id = r.booking_id WHERE r.member_id = ? AND r.released_at IS NOT NULL ORDER BY r.delivered_at').map((r) => ({ ...r, flagged: json(r.flagged) })),
      reportValues: all('SELECT v.report_id, v.label, v.value, v.units, v.range_low, v.range_high, v.matched_range, v.flag FROM report_values v JOIN report_metadata r ON r.id = v.report_id WHERE r.member_id = ? AND r.released_at IS NOT NULL ORDER BY v.report_id, v.label'),
      messages: conversations.map((c) => ({ coach: c.coach_name, startedAt: c.created_at, messages: db.all<{ sender_id: string; body: string; created_at: string; read_at: string | null }>('SELECT sender_id, body, created_at, read_at FROM messages WHERE conversation_id = ? ORDER BY created_at', [c.id]).map((m) => ({ from: m.sender_id === memberId ? 'you' : c.coach_name, body: m.body, at: m.created_at, readAt: m.read_at })) })),
      notifications: all('SELECT category, title, body, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY created_at'),
      bespokeRequests: all<BespokeRow>('SELECT reference, status, goals, duration, budget_paise, notes, proposal, proposal_sent_at, expires_at, decided_at, created_at FROM custom_plan_requests WHERE member_id = ? ORDER BY created_at').map(bespokeForMember),
      // the member's own note on each request (their words); the team's note (data_request_admin_notes) never
      dataRequests,
      supportRequests: supportRequests.map((r) => ({ ...r, messages: db.all<{ author_id: string; body: string; created_at: string }>('SELECT author_id, body, created_at FROM support_messages WHERE request_id = ? AND internal = 0 ORDER BY created_at', [r.id]).map((m) => ({ from: m.author_id === memberId ? 'you' : 'Bioptime team', body: m.body, at: m.created_at })) })),
      files: otherFiles,
    },
    ...(Object.keys(moduleSections).length ? { moduleSections } : {}),
    notIncluded: [
      { what: 'Your password, sign-in codes and session tokens', why: 'Stored only as one-way hashes or secrets that protect your account.' },
      { what: 'Notes your coach or the Bioptime team keep for themselves, internal notes on support requests and on your data requests, and bespoke proposals still being prepared', why: 'Working notes of the team; ask through Help and support if you want to know what they say about you. A bespoke proposal is included once it has been sent to you.' },
      { what: 'Payment provider payloads and internal approval records', why: 'Operational records of the provider and the team; your orders, payments and refunds are included.' },
      { what: 'Report documents (PDF), photos, message attachments and other files themselves', why: 'Each is listed under "files", "reports" or the section it belongs to; open each one in the app, where it is served through a short-lived link.' },
      { what: 'Files you added to a message but have not sent', why: 'They wait in your message composer, where only you see them, and are removed if not sent within 24 hours.' },
      ...pending,
    ],
  };
}

/* ---------- writing the file ---------- */

/** Writes the archive to the private store as a data_export file owned by the member, through the private store's
 *  writer for server-generated files (api/domain/files.ts saveGeneratedPrivateFile): storage readiness, mode 600
 *  outside every static mount, a file_metadata row with its SHA-256, and a file.save audit. It downloads as an
 *  attachment. */
function writeExportFile(ctx: Ctx, memberId: string, requestId: string, content: string): { id: string; size: number } {
  const f = saveGeneratedPrivateFile(ctx, { ownerId: memberId, kind: EXPORT_KIND, content, mime: 'application/json', name: `bioptime-data-export-${dateInZone(ctx.now())}.json`, ref: { type: 'data_request', id: requestId } });
  return { id: f.id, size: f.size };
}

function requestRow(ctx: Ctx, id: string): RequestRow | undefined {
  return /^drq_[a-z0-9]{6,40}$/.test(id) ? ctx.db.get<RequestRow>('SELECT * FROM data_requests WHERE id = ?', [id]) : undefined;
}

/** Generate the export for one request that is in progress and has no file yet, complete the request, close its
 *  operations task and tell the member. */
export function generateForRequest(ctx: Ctx, requestId: string): { fileId: string; size: number } {
  const r = requestRow(ctx, requestId);
  if (!r || r.kind !== 'export') throw errors.notFound('Export request');
  if (r.file_id) throw errors.state('This export has already been generated', { code: 'ALREADY_GENERATED' });
  if (r.status !== 'in_progress') throw errors.state(`The request is ${r.status}; an export is generated once it is in progress`, { code: 'REQUEST_STATE', status: r.status });
  const member = ctx.db.get<{ id: string; role: string }>('SELECT id, role FROM users WHERE id = ?', [r.user_id]);
  if (!member || member.role !== 'member') throw errors.state('Exports are generated for member accounts', { code: 'NOT_A_MEMBER' });
  const archive = buildArchive(ctx, r.user_id, r.id);
  const file = writeExportFile(ctx, r.user_id, r.id, JSON.stringify(archive, null, 2));
  const now = ctx.now();
  ctx.db.run("UPDATE data_requests SET file_id = ?, status = 'completed', completed_at = ? WHERE id = ? AND file_id IS NULL", [file.id, now, r.id]);
  audit(ctx, 'data_export.generate', { type: 'data_request', id: r.id }, null, { memberId: r.user_id, fileId: file.id, bytes: file.size, format: EXPORT_FORMAT_VERSION });
  for (const t of ctx.db.all<{ id: string }>("SELECT id FROM support_tasks WHERE kind = 'data_request' AND ref_type = 'data_request' AND ref_id = ? AND status IN ('open','in_progress')", [r.id])) {
    updateTask(ctx, t.id, { status: 'resolved', resolution: 'Export file generated; the member downloads it in the portal or the app' });
  }
  notify(ctx, { userId: r.user_id, category: 'support', title: 'Your data export is ready', body: 'Sign in to Bioptime and open Help and support to download it. The download link works for five minutes each time you open it.', data: { dataRequestId: r.id } });
  return { fileId: file.id, size: file.size };
}

/** The data_exports job: every export request in progress without a file. A failure stays on the request (it is
 *  tried again next run) and is listed as an operations exception. */
export function generatePending(ctx: Ctx, limit = 20): { generated: number; failed: number; waiting?: string } {
  const pending = ctx.db.all<{ id: string }>("SELECT id FROM data_requests WHERE kind = 'export' AND status = 'in_progress' AND file_id IS NULL ORDER BY created_at LIMIT ?", [limit]);
  if (!pending.length) return { generated: 0, failed: 0 };
  const missing = storageRequirement(ctx);
  if (missing) return { generated: 0, failed: 0, waiting: `pending configuration: ${missing}` };
  let generated = 0, failed = 0;
  for (const p of pending) {
    try { generateForRequest(ctx, p.id); generated++; }
    catch (e) {
      failed++;
      audit(ctx, 'data_export.failed', { type: 'data_request', id: p.id }, null, { error: String((e as Error).message).slice(0, 300) });
    }
  }
  return { generated, failed };
}

/* ---------- the member ---------- */

function presentForMember(ctx: Ctx, r: RequestRow) {
  const f = r.file_id ? ctx.db.get<{ id: string; name: string; size: number; created_at: string; deleted_at: string | null }>('SELECT id, name, size, created_at, deleted_at FROM file_metadata WHERE id = ?', [r.file_id]) : undefined;
  return { id: r.id, status: r.status, requestedAt: r.created_at, completedAt: r.completed_at, file: f && !f.deleted_at ? { name: f.name, size: f.size, createdAt: f.created_at } : null };
}

/** My export requests and whether each file is ready. */
export function listMine(ctx: Ctx) {
  const actor = requireRole(ctx, 'member');
  return ctx.db.all<RequestRow>("SELECT * FROM data_requests WHERE user_id = ? AND kind = 'export' ORDER BY created_at DESC LIMIT 50", [actor.id]).map((r) => presentForMember(ctx, r));
}

/** A 5-minute token for my export file (the file access resolver runs again on download). */
export function tokenForMine(ctx: Ctx, requestId: string) {
  const actor = requireRole(ctx, 'member');
  const r = requestRow(ctx, requestId);
  if (!r || r.user_id !== actor.id || r.kind !== 'export') throw errors.notFound('Export');
  if (!r.file_id) throw errors.state('The export is not ready yet', { code: 'EXPORT_NOT_READY', status: r.status });
  const t = fileToken(ctx, r.file_id);
  audit(ctx, 'data_export.download', { type: 'data_request', id: r.id }, null, { fileId: r.file_id });
  return t;
}

/* ---------- administrators (members.manage) ---------- */

/** Export requests with their state and whether a file exists; never the file. note is the member's own words;
 *  adminNote is the team's note (data_request_admin_notes), for administrators only: no member route reads it. */
export function adminList(ctx: Ctx) {
  requirePermission(ctx, 'members.manage');
  return ctx.db.all<RequestRow & { name: string; member_code: string | null; admin_note: string | null }>("SELECT d.id, d.user_id, d.kind, d.status, d.note, d.file_id, d.created_at, d.completed_at, u.name, p.member_code, n.admin_note FROM data_requests d JOIN users u ON u.id = d.user_id LEFT JOIN member_profiles p ON p.user_id = d.user_id LEFT JOIN data_request_admin_notes n ON n.request_id = d.id WHERE d.kind = 'export' ORDER BY CASE d.status WHEN 'requested' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, d.created_at DESC LIMIT 200")
    .map((r) => ({ ...presentForMember(ctx, r), memberId: r.user_id, memberName: r.name, memberCode: r.member_code, note: r.note, adminNote: r.admin_note ?? null }));
}

/** Generate now: a request still marked requested moves to in progress (the administrator's decision, with a reason)
 *  and the file is written at once instead of on the next job run. */
export function adminGenerate(ctx: Ctx, requestId: string, reason: string) {
  requirePermission(ctx, 'members.manage');
  if (!reason || reason.trim().length < 3) throw errors.badRequest('Say why: the reason is recorded in the audit log', 'REASON_REQUIRED');
  const r = requestRow(ctx, requestId);
  if (!r || r.kind !== 'export') throw errors.notFound('Export request');
  if (r.file_id) throw errors.state('This export has already been generated', { code: 'ALREADY_GENERATED' });
  if (r.status === 'cancelled' || r.status === 'completed') throw errors.state(`The request is ${r.status}`, { code: 'REQUEST_STATE', status: r.status });
  if (r.status === 'requested') {
    ctx.db.run("UPDATE data_requests SET status = 'in_progress' WHERE id = ?", [r.id]);
    audit(ctx, 'data_request.update', { type: 'data_request', id: r.id }, reason.trim(), { status: 'in_progress' });
  }
  const out = generateForRequest(ctx, r.id);
  return { id: r.id, status: 'completed', fileSize: out.size };
}
