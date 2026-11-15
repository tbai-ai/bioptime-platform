/* Bulk imports (M4), for moving existing clients onto Bioptime: members (invited accounts) and their historical
   progress. Administrators only, behind imports.manage (an owner grants it; administrators do not hold it by
   default), plus members.view_restricted for a members file, which carries contact fields.

   1. Upload: the CSV is parsed and every row validated in a dry run. Only the job and its rows are stored; no account,
      progress entry, notification or invitation is written. dryRun: true stores nothing at all and returns the report.
   2. Apply: the valid rows become records, once. A second apply changes nothing. Members are created in the invited
      state without a password and without any message.
   3. Send invitations (members only): each created account gets the standard activation link (inviteMember, 72 hours).
      Nothing is sent before an administrator presses it.

   Provenance: every imported progress entry has source 'import' and a note naming the file, the job and the row; every
   imported account has a member.import audit row naming the same. Nothing is inferred or filled in. */
import { createHash } from 'node:crypto';
import type { Ctx } from '../context.js';
import { emailSchema } from '@bioptime/domain';
import { ids, randomId } from '../lib/ids.js';
import { errors } from '../lib/errors.js';
import { j } from '../db/db.js';
import { audit } from './audit.js';
import { hasPermission, requirePermission } from '../auth/permissions.js';
import { nextCode } from './members.js';
import { metricConfig } from './plans.js';
import { getUserByEmail, inviteMember } from '../auth/service.js';

export const IMPORT_KINDS = ['members', 'progress_history'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 1024 * 1024;

/** The columns each kind accepts (header names, any case); the starred ones are required. */
export const IMPORT_COLUMNS: Record<ImportKind, { required: string[]; optional: string[]; example: string }> = {
  members: { required: ['email', 'name'], optional: ['phone', 'note'], example: 'email,name,phone,note' },
  progress_history: { required: ['member', 'metric', 'value', 'unit', 'at'], optional: ['note'], example: 'member,metric,value,unit,at,note' },
};

type JobRow = {
  id: string; kind: ImportKind; status: 'uploaded' | 'validated' | 'applied' | 'failed' | 'cancelled'; file_id: string | null; file_name: string; file_sha256: string;
  row_count: number; valid_count: number; applied_count: number; invited_count: number; errors: string; created_by: string; applied_by: string | null; invited_by: string | null;
  created_at: string; updated_at: string; validated_at: string | null; applied_at: string | null; invited_at: string | null;
};
type RowRow = { id: string; job_id: string; row_no: number; data: string; errors: string; outcome: 'pending' | 'valid' | 'invalid' | 'created' | 'skipped' | 'invited'; created_record_id: string | null };

type MemberData = { email: string; name: string; phone?: string; note?: string };
type ProgressData = { member: string; memberId: string; metric: string; value: number; unit: string; at: string; note?: string };
type Checked = { rowNo: number; raw: Record<string, string>; data: MemberData | ProgressData | null; errors: string[] };
type FileProblem = { code: string; message: string };

/* ---------- CSV ---------- */

/** RFC 4180 CSV: commas, double-quoted fields with "" for a quote, CRLF or LF line ends, a leading byte-order mark
 *  ignored, blank lines skipped. Returns the records as arrays of strings. */
export function parseCsv(text: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const out: string[][] = [];
  let rec: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const endRecord = () => { rec.push(field); field = ''; if (rec.length > 1 || rec[0]!.trim() !== '') out.push(rec); rec = []; };
  while (i < s.length) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i += 2; continue; } quoted = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"' && field === '') { quoted = true; i++; continue; }
    if (c === ',') { rec.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { endRecord(); i++; continue; }
    field += c; i++;
  }
  if (quoted) throw errors.badRequest('The file ends inside a quoted field: check the quotes', 'CSV_INVALID');
  if (field !== '' || rec.length) endRecord();
  return out;
}

/* ---------- validation ---------- */

const PHONE_RE = /^\+?[1-9][0-9]{9,14}$/;
const MEMBER_CODE_RE = /^BPM-\d{5}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A date alone is stored at 12:00 India time (06:30 UTC), so it shows on the same day wherever the portal renders it. */
function parseWhen(v: string): string | null {
  const t = v.trim();
  const iso = DATE_RE.test(t) ? `${t}T06:30:00.000Z` : t;
  if (!DATE_RE.test(t) && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(t)) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  if (DATE_RE.test(t) && d.toISOString().slice(0, 10) !== t) return null; // 2026-02-30 and friends
  return d.toISOString();
}

function checkMembers(ctx: Ctx, rows: Array<{ rowNo: number; raw: Record<string, string> }>): Checked[] {
  const seen = new Map<string, number>();
  return rows.map(({ rowNo, raw }) => {
    const errs: string[] = [];
    const email = emailSchema.safeParse(raw.email ?? '');
    const name = (raw.name ?? '').trim();
    const phone = (raw.phone ?? '').replace(/[\s()-]/g, '');
    const note = (raw.note ?? '').trim();
    if (!email.success) errs.push('email: not a valid email address');
    if (name.length < 2 || name.length > 120) errs.push('name: 2 to 120 characters');
    if (phone && !PHONE_RE.test(phone)) errs.push('phone: digits with the country code, for example +919800000000');
    if (note.length > 500) errs.push('note: at most 500 characters');
    if (email.success) {
      const prior = seen.get(email.data);
      if (prior) errs.push(`email: the same address is on row ${prior}`);
      else seen.set(email.data, rowNo);
      if (getUserByEmail(ctx, email.data)) errs.push('email: an account with this address already exists');
    }
    const data: MemberData | null = errs.length ? null : { email: email.success ? email.data : '', name, ...(phone ? { phone } : {}), ...(note ? { note } : {}) };
    return { rowNo, raw, data, errors: errs };
  });
}

function findMember(ctx: Ctx, ref: string): { id: string } | undefined {
  const r = ref.trim();
  if (MEMBER_CODE_RE.test(r)) return ctx.db.get<{ id: string }>("SELECT u.id FROM users u JOIN member_profiles p ON p.user_id = u.id WHERE p.member_code = ? AND u.role = 'member'", [r.toUpperCase()]);
  const e = emailSchema.safeParse(r);
  return e.success ? ctx.db.get<{ id: string }>("SELECT id FROM users WHERE email = ? AND role = 'member'", [e.data]) : undefined;
}

function duplicateProgress(ctx: Ctx, d: { memberId: string; metric: string; at: string; value: number }): boolean {
  return !!ctx.db.get('SELECT 1 FROM progress_entries WHERE member_id = ? AND metric = ? AND at = ? AND value = ?', [d.memberId, d.metric, d.at, d.value]);
}

function checkProgress(ctx: Ctx, rows: Array<{ rowNo: number; raw: Record<string, string> }>): Checked[] {
  const metrics = metricConfig(ctx).filter((m) => m.enabled);
  const seen = new Map<string, number>();
  const now = Date.parse(ctx.now());
  return rows.map(({ rowNo, raw }) => {
    const errs: string[] = [];
    const memberRef = (raw.member ?? '').trim();
    const member = memberRef ? findMember(ctx, memberRef) : undefined;
    if (!member) errs.push('member: no member with this email address or member ID (BPM-00000)');
    const cfg = metrics.find((m) => m.metric === (raw.metric ?? '').trim());
    if (!cfg) errs.push(`metric: one of ${metrics.map((m) => m.metric).join(', ')}`);
    const valueText = (raw.value ?? '').trim();
    const value = valueText === '' ? NaN : Number(valueText);
    if (!Number.isFinite(value)) errs.push('value: a number');
    else if (cfg && cfg.min !== null && value < cfg.min) errs.push(`value: ${cfg.label} cannot be below ${cfg.min}`);
    else if (cfg && cfg.max !== null && value > cfg.max) errs.push(`value: ${cfg.label} cannot be above ${cfg.max}`);
    const unit = (raw.unit ?? '').trim();
    if (cfg && unit.toLowerCase() !== cfg.unit.toLowerCase()) errs.push(`unit: ${cfg.label} is recorded in ${cfg.unit}`);
    const at = parseWhen(raw.at ?? '');
    if (!at) errs.push('at: a date (2026-03-14) or a date and time with its offset (2026-03-14T07:30:00+05:30)');
    else if (Date.parse(at) > now) errs.push('at: in the future');
    else if (at < '1990-01-01') errs.push('at: before 1990');
    const note = (raw.note ?? '').trim();
    if (note.length > 300) errs.push('note: at most 300 characters');
    let data: ProgressData | null = null;
    if (!errs.length && member && cfg && at) {
      data = { member: memberRef, memberId: member.id, metric: cfg.metric, value, unit: cfg.unit, at, ...(note ? { note } : {}) };
      const key = `${member.id}|${cfg.metric}|${at}|${value}`;
      const prior = seen.get(key);
      if (prior) errs.push(`the same value is on row ${prior}`);
      else seen.set(key, rowNo);
      if (duplicateProgress(ctx, data)) errs.push('already recorded: the same member, metric, time and value');
      if (errs.length) data = null;
    }
    return { rowNo, raw, data, errors: errs };
  });
}

/** Parse and validate a file without writing anything. */
function check(ctx: Ctx, kind: ImportKind, csv: string): { problems: FileProblem[]; rows: Checked[]; headers: string[] } {
  if (Buffer.byteLength(csv, 'utf8') > MAX_IMPORT_BYTES) return { problems: [{ code: 'FILE_TOO_LARGE', message: `Files are limited to ${MAX_IMPORT_BYTES / 1024} KB; split it into smaller files` }], rows: [], headers: [] };
  let records: string[][];
  try { records = parseCsv(csv); } catch (e) { return { problems: [{ code: 'CSV_INVALID', message: (e as Error).message }], rows: [], headers: [] }; }
  if (!records.length) return { problems: [{ code: 'EMPTY', message: 'The file is empty' }], rows: [], headers: [] };
  const headers = records[0]!.map((h) => h.trim().toLowerCase());
  const cols = IMPORT_COLUMNS[kind];
  const problems: FileProblem[] = [];
  for (const r of cols.required) if (!headers.includes(r)) problems.push({ code: 'MISSING_COLUMN', message: `The header row has no "${r}" column (expected: ${cols.example})` });
  const unknown = headers.filter((h) => h && !cols.required.includes(h) && !cols.optional.includes(h));
  if (unknown.length) problems.push({ code: 'UNKNOWN_COLUMN', message: `Columns not used by a ${kind === 'members' ? 'members' : 'progress history'} import: ${unknown.join(', ')} (remove them so nothing is imported by mistake)` });
  const dupes = headers.filter((h, i) => h && headers.indexOf(h) !== i);
  if (dupes.length) problems.push({ code: 'DUPLICATE_COLUMN', message: `Columns named twice: ${[...new Set(dupes)].join(', ')}` });
  const body = records.slice(1);
  if (!body.length) problems.push({ code: 'NO_ROWS', message: 'The file has a header row but no data rows' });
  if (body.length > MAX_IMPORT_ROWS) problems.push({ code: 'TOO_MANY_ROWS', message: `At most ${MAX_IMPORT_ROWS} rows per file; this one has ${body.length}` });
  if (problems.length) return { problems, rows: [], headers };
  const rows = body.map((cells, i) => {
    const raw: Record<string, string> = {};
    headers.forEach((h, k) => { if (h) raw[h] = (cells[k] ?? '').trim(); });
    return { rowNo: i + 2, raw, extra: cells.length > headers.length };
  });
  const checked = kind === 'members' ? checkMembers(ctx, rows) : checkProgress(ctx, rows);
  rows.forEach((r, i) => { if (r.extra) { checked[i]!.errors.push('more cells than columns (an unquoted comma?)'); checked[i]!.data = null; } });
  return { problems, rows: checked, headers };
}

function report(rows: Checked[], problems: FileProblem[]) {
  return {
    rowCount: rows.length, validCount: rows.filter((r) => !r.errors.length).length, invalidCount: rows.filter((r) => r.errors.length).length,
    fileErrors: problems, errors: rows.filter((r) => r.errors.length).map((r) => ({ row: r.rowNo, errors: r.errors })),
  };
}

/* ---------- permissions ---------- */

function requireImportAccess(ctx: Ctx, kind: ImportKind) {
  const actor = requirePermission(ctx, 'imports.manage');
  if (kind === 'members') requirePermission(ctx, 'members.view_restricted'); // a members file carries email and phone numbers
  return actor;
}

/* ---------- jobs ---------- */

function jobRow(ctx: Ctx, id: string): JobRow {
  const r = /^imp_[a-z0-9]{6,40}$/.test(id) ? ctx.db.get<JobRow>('SELECT * FROM import_jobs WHERE id = ?', [id]) : undefined;
  if (!r) throw errors.notFound('Import');
  return r;
}

export function presentJob(ctx: Ctx, job: JobRow, withRows = true) {
  const people = ctx.db.all<{ id: string; name: string }>('SELECT id, name FROM users WHERE id IN (?, ?, ?)', [job.created_by, job.applied_by ?? '', job.invited_by ?? '']);
  const name = (id: string | null) => (id ? people.find((p) => p.id === id)?.name ?? null : null);
  const rows = withRows ? ctx.db.all<RowRow>('SELECT * FROM import_rows WHERE job_id = ? ORDER BY row_no', [job.id]) : [];
  const outcomes = ctx.db.all<{ outcome: string; n: number }>('SELECT outcome, COUNT(*) n FROM import_rows WHERE job_id = ? GROUP BY outcome', [job.id]);
  return {
    id: job.id, kind: job.kind, status: job.status, fileName: job.file_name, fileSha256: job.file_sha256, fileId: job.file_id,
    rowCount: job.row_count, validCount: job.valid_count, invalidCount: job.row_count - job.valid_count, appliedCount: job.applied_count, invitedCount: job.invited_count,
    outcomes: Object.fromEntries(outcomes.map((o) => [o.outcome, o.n])),
    fileErrors: j.out<FileProblem[]>(job.errors, []),
    createdAt: job.created_at, createdBy: name(job.created_by), validatedAt: job.validated_at, appliedAt: job.applied_at, appliedBy: name(job.applied_by), invitedAt: job.invited_at, invitedBy: name(job.invited_by),
    columns: IMPORT_COLUMNS[job.kind],
    ...(withRows ? { rows: rows.map((r) => ({ row: r.row_no, outcome: r.outcome, data: j.out<Record<string, unknown>>(r.data, {}), errors: j.out<string[]>(r.errors, []), recordId: r.created_record_id })) } : {}),
  };
}

export function listJobs(ctx: Ctx) {
  requirePermission(ctx, 'imports.manage');
  return ctx.db.all<JobRow>('SELECT * FROM import_jobs ORDER BY created_at DESC LIMIT 200').map((jb) => presentJob(ctx, jb, false));
}

export function getJob(ctx: Ctx, id: string) {
  requirePermission(ctx, 'imports.manage');
  return presentJob(ctx, jobRow(ctx, id));
}

function cleanFileName(name: string): string {
  return name.replace(/[^\w.-]+/g, '-').replace(/^[-.]+/, '').slice(0, 120) || 'import.csv';
}

/** Upload and validate (the dry run). With dryRun nothing is stored, not even the job; otherwise the job and its rows
 *  are kept for review and nothing else is written. */
export function upload(ctx: Ctx, input: { kind: ImportKind; fileName: string; csv: string; dryRun?: boolean }) {
  const actor = requireImportAccess(ctx, input.kind);
  const { problems, rows } = check(ctx, input.kind, input.csv);
  const rep = report(rows, problems);
  const fileName = cleanFileName(input.fileName);
  const sha = createHash('sha256').update(input.csv, 'utf8').digest('hex');
  if (input.dryRun) return { dryRun: true, kind: input.kind, fileName, fileSha256: sha, ...rep, stored: false };
  const id = randomId('imp');
  const now = ctx.now();
  ctx.db.tx(() => {
    ctx.db.insert('import_jobs', { id, kind: input.kind, status: 'uploaded', file_id: null, file_name: fileName, file_sha256: sha, row_count: rows.length, valid_count: rep.validCount, errors: j.in(problems), created_by: actor.id, created_at: now, updated_at: now });
    audit(ctx, 'import.upload', { type: 'import_job', id }, null, { kind: input.kind, fileName, sha256: sha, rows: rows.length });
    for (const r of rows) ctx.db.insert('import_rows', { id: randomId('imr'), job_id: id, row_no: r.rowNo, data: j.in(r.data ?? r.raw), errors: j.in(r.errors), outcome: r.errors.length ? 'invalid' : 'valid', created_record_id: null });
    const status = problems.length || !rep.validCount ? 'failed' : 'validated';
    ctx.db.update('import_jobs', id, { status, validated_at: now, updated_at: now });
    audit(ctx, 'import.validate', { type: 'import_job', id }, null, { status, valid: rep.validCount, invalid: rep.invalidCount, fileErrors: problems.map((p) => p.code) });
  });
  return { ...presentJob(ctx, jobRow(ctx, id)), report: rep };
}

/** Create the records for the valid rows, once. Members are created in the invited state with no password and no
 *  message; progress entries carry source 'import' and a note naming the file, job and row. A row whose situation
 *  changed since the dry run (the email registered meanwhile, the value recorded meanwhile) is skipped with the reason. */
export function apply(ctx: Ctx, id: string, reason: string) {
  const job0 = jobRow(ctx, id);
  const actor = requireImportAccess(ctx, job0.kind);
  if (!reason || reason.trim().length < 3) throw errors.badRequest('Say why: the reason is recorded in the audit log', 'REASON_REQUIRED');
  if (job0.status === 'applied') return { ...presentJob(ctx, job0), alreadyApplied: true }; // idempotent: nothing is created twice
  if (job0.status !== 'validated') throw errors.state(`This import is ${job0.status}; only a validated import can be applied`, { code: 'IMPORT_STATE', status: job0.status });
  const now = ctx.now();
  ctx.db.tx(() => {
    const job = jobRow(ctx, id); // re-read inside the transaction: two administrators pressing Apply at once apply it once
    if (job.status !== 'validated') return;
    const rows = ctx.db.all<RowRow>("SELECT * FROM import_rows WHERE job_id = ? AND outcome = 'valid' ORDER BY row_no", [id]);
    let created = 0;
    for (const r of rows) {
      const skip = (why: string) => ctx.db.run("UPDATE import_rows SET outcome = 'skipped', errors = ? WHERE id = ?", [j.in([why]), r.id]);
      if (job.kind === 'members') {
        const d = j.out<MemberData>(r.data, { email: '', name: '' });
        if (getUserByEmail(ctx, d.email)) { skip('email: an account with this address was created after the file was checked'); continue; }
        const userId = ids.user();
        ctx.db.insert('users', { id: userId, email: d.email, phone: d.phone ?? null, password_hash: null, role: 'member', state: 'invited', name: d.name, created_at: now, updated_at: now });
        ctx.db.insert('member_profiles', { user_id: userId, member_code: nextCode(ctx, 'member'), created_at: now, updated_at: now });
        ctx.db.insert('notification_preferences', { user_id: userId, updated_at: now });
        audit(ctx, 'member.import', { type: 'user', id: userId }, reason.trim(), { importJobId: id, fileName: job.file_name, row: r.row_no, invitationSent: false });
        ctx.db.run("UPDATE import_rows SET outcome = 'created', created_record_id = ? WHERE id = ?", [userId, r.id]);
      } else {
        const d = j.out<ProgressData>(r.data, { member: '', memberId: '', metric: '', value: NaN, unit: '', at: '' });
        if (!ctx.db.get("SELECT 1 FROM users WHERE id = ? AND role = 'member'", [d.memberId])) { skip('member: the account no longer exists'); continue; }
        if (duplicateProgress(ctx, d)) { skip('already recorded: the same member, metric, time and value'); continue; }
        const entryId = ids.progress();
        const note = `Imported from ${job.file_name} (import ${id}, row ${r.row_no})${d.note ? ` · ${d.note}` : ''}`;
        ctx.db.insert('progress_entries', { id: entryId, member_id: d.memberId, metric: d.metric, value: d.value, unit: d.unit, at: d.at, source: 'import', note, created_by: actor.id, created_at: now });
        ctx.db.run("UPDATE import_rows SET outcome = 'created', created_record_id = ? WHERE id = ?", [entryId, r.id]);
      }
      created++;
    }
    ctx.db.update('import_jobs', id, { status: 'applied', applied_count: created, applied_by: actor.id, applied_at: now, updated_at: now });
    audit(ctx, 'import.apply', { type: 'import_job', id }, reason.trim(), { kind: job.kind, created, skipped: rows.length - created, fileName: job.file_name });
  });
  return presentJob(ctx, jobRow(ctx, id));
}

/** Send the activation links for the accounts a members import created (the standard invitation: single use, 72
 *  hours, through the notification outbox). Rows already invited are left alone, so pressing it twice sends nothing new. */
export function sendInvitations(ctx: Ctx, id: string, reason: string) {
  const job = jobRow(ctx, id);
  const actor = requireImportAccess(ctx, job.kind);
  if (!reason || reason.trim().length < 3) throw errors.badRequest('Say why: the reason is recorded in the audit log', 'REASON_REQUIRED');
  if (job.kind !== 'members') throw errors.state('Only a members import sends invitations', { code: 'IMPORT_KIND' });
  if (job.status !== 'applied') throw errors.state('Apply the import before sending invitations', { code: 'IMPORT_STATE', status: job.status });
  const rows = ctx.db.all<RowRow>("SELECT * FROM import_rows WHERE job_id = ? AND outcome = 'created' ORDER BY row_no", [id]);
  let sent = 0, skipped = 0;
  for (const r of rows) {
    const d = j.out<MemberData>(r.data, { email: '', name: '' });
    const u = r.created_record_id ? ctx.db.get<{ id: string; email: string; name: string; phone: string | null; state: string; role: string }>('SELECT id, email, name, phone, state, role FROM users WHERE id = ?', [r.created_record_id]) : undefined;
    if (!u || u.role !== 'member' || u.state !== 'invited') { ctx.db.run("UPDATE import_rows SET outcome = 'skipped', errors = ? WHERE id = ?", [j.in(['the account is no longer waiting for an invitation']), r.id]); skipped++; continue; }
    inviteMember(ctx, { email: u.email, name: u.name || d.name, phone: u.phone ?? undefined }, `${reason.trim()} (import ${id}, row ${r.row_no})`);
    ctx.db.run("UPDATE import_rows SET outcome = 'invited' WHERE id = ?", [r.id]);
    sent++;
  }
  const now = ctx.now();
  ctx.db.update('import_jobs', id, { invited_count: job.invited_count + sent, invited_by: sent ? actor.id : job.invited_by ?? undefined, invited_at: sent ? now : job.invited_at ?? undefined, updated_at: now });
  audit(ctx, 'import.invite', { type: 'import_job', id }, reason.trim(), { sent, skipped });
  return { ...presentJob(ctx, jobRow(ctx, id)), sent, skipped };
}

/** Withdraw an import that was not applied. */
export function cancel(ctx: Ctx, id: string, reason: string) {
  const job = jobRow(ctx, id);
  requireImportAccess(ctx, job.kind);
  if (!reason || reason.trim().length < 3) throw errors.badRequest('Say why: the reason is recorded in the audit log', 'REASON_REQUIRED');
  if (job.status === 'applied' || job.status === 'cancelled') throw errors.state(`This import is ${job.status}`, { code: 'IMPORT_STATE', status: job.status });
  ctx.db.update('import_jobs', id, { status: 'cancelled', updated_at: ctx.now() });
  audit(ctx, 'import.cancel', { type: 'import_job', id }, reason.trim(), { previous: job.status });
  return presentJob(ctx, jobRow(ctx, id));
}

/** Contact fields in an import's rows are shown only to administrators holding members.view_restricted. */
export function canSeeContactFields(ctx: Ctx): boolean { return hasPermission(ctx, 'members.view_restricted'); }
