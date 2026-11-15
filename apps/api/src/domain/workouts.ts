/* M6 Workouts: the exercise library, workout templates, coach-authored programmes with versions, the sessions a
   published version generates, the member's set logs and effort ratings, coach feedback, history and adherence.

   Who sees what
   - The library: administrators holding library.manage see and edit everything; a coach sees published entries and
     their own drafts, and proposes exercises as drafts that an administrator publishes.
   - A programme belongs to a member; the coach currently assigned to that member writes and publishes it. Publishing
     generates the member's sessions once (one per programme, week and day); a revision regenerates the sessions still
     scheduled and keeps every session the member completed, completed in part or skipped. A session belongs to its week
     and day, so a revision keeps every week the member logged in (WEEK_HAS_LOGS) and every logged day in its week and
     day with the template it came from (DAY_HAS_LOGS): weeks are never renumbered and days never moved around what the
     member did. A revision's title and start date wait on the draft version until it is published (0026).
   - The member's week, its summary, adherence and the data export count the same sessions: every session of a live
     programme, and of a closed one only those the member logged or skipped (SHOWN_TO_MEMBER).
   - The schedule and each session's status are visible to the assigned coach, as plan tasks are. Set logs, the effort
     rating (RPE), the duration and the member's notes are health detail: a coach sees them only while the member's
     coach_sharing consent is current (requireHealthAccess), and a coach's feedback needs the same consent.
   - Only the member completes or skips their own session.
   - Administrators holding members.manage write a member's programmes too (30 October 2026: admins create and modify
     workouts), through the same validation, versions and publishing as the coach: the programme belongs to the
     member's assigned coach (or, with no coach yet, to the administrator who wrote it, until a coach is assigned), the
     coach sees it on the client record and the member's app shows it exactly as a coach's. Audited with by: 'admin'.

   - Members read the published library (memberExercises) and their personal records (memberRecords: from their own
     logged sets only). A session item carries the frozen text of its exercise (0040) and the exercise's current clip.
   - Demonstration clips are served by the API itself (api/domain/exerciseMedia.ts, EXERCISE_MEDIA): an administrator
     maps an exercise to a clip of the media manifest (media_ref, checked against it); while the media are switched off
     or incomplete every exercise is text only and says so (mediaStatus).

   Nothing is invented: no calories, no injury or rehabilitation claims, no periodisation a coach did not write, no
   duration a coach did not prescribe, no record the member did not log. Every mutation is audited. */
import type { Ctx } from '../context.js';
import { randomId } from '../lib/ids.js';
import { AppError, errors } from '../lib/errors.js';
import { addDays, dateInZone } from '../lib/time.js';
import { j } from '../db/db.js';
import { audit, emit } from './audit.js';
import { notify } from './notifications.js';
import { coachHasMember, requireHealthAccess, requireMemberAccess, requirePermission, requireRole } from '../auth/permissions.js';
import type { ProgramStructure } from '@bioptime/domain/modules/workouts';
import * as exerciseMedia from './exerciseMedia.js';
import { listForMember as listHabits } from './habits.js';
import { isEnabledFor } from './features.js';

export type { ProgramStructure };

const newId = {
  exercise: () => randomId('exr'),
  template: () => randomId('wkt'),
  templateItem: () => randomId('wti'),
  program: () => randomId('wpg'),
  version: () => randomId('wpv'),
  session: () => randomId('wks'),
  sessionItem: () => randomId('wsi'),
  setLog: () => randomId('wsl'),
};

/** Whether exercise clips are served, and if not exactly what is missing (api/domain/exerciseMedia.ts). */
export function mediaStatus(ctx: Ctx) {
  return exerciseMedia.status(ctx);
}

/* ---------- dates (IST, YYYY-MM-DD) ---------- */
export function todayIst(ctx: Ctx): string { return dateInZone(ctx.now()); }
function plusDays(date: string, n: number): string { return addDays(`${date}T00:00:00.000Z`, n).slice(0, 10); }
function weekOf(date: string): { from: string; to: string } {
  const wd = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  const from = plusDays(date, -((wd + 6) % 7)); // weeks start on Monday
  return { from, to: plusDays(from, 6) };
}
function daysBetween(a: string, b: string): number { return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000); }

/* ---------- access ---------- */

/** May the caller see this member's workout health detail (set logs, RPE, duration, notes)? The member and
 *  administrators always; the assigned coach while coach_sharing is granted. Anyone else is refused outright. */
export function healthShared(ctx: Ctx, memberId: string): boolean {
  try { requireHealthAccess(ctx, memberId); return true; }
  catch (e) { if (e instanceof AppError && e.code === 'NOT_SHARED') return false; throw e; }
}

function requireCoach(ctx: Ctx) { return requireRole(ctx, 'coach'); }

/* ---------- exercises ---------- */

type ExerciseRow = { id: string; name: string; description: string; instructions: string; category: string; equipment: string; muscle_groups: string; safety_notes: string; media_asset_id: string | null; media_ref: string | null; source: 'team' | 'coach'; status: 'draft' | 'published' | 'archived'; sample: number; created_by: string | null; created_at: string; updated_at: string; author_name?: string | null };
/** mediaRef: a key of the exercise media manifest, or null for text only (administrators only: a coach's proposal
 *  never carries one). */
export type ExerciseInput = { name: string; description?: string; instructions?: string; category: string; equipment?: string[]; muscleGroups?: string[]; safetyNotes?: string; mediaRef?: string | null };

/** An exercise as the coaching team sees it: its clip (media) while the clips are served, and the manifest key it maps
 *  to (mediaRef) whether or not they are. */
function presentExercise(ctx: Ctx, r: ExerciseRow) {
  return {
    id: r.id, name: r.name, description: r.description, instructions: r.instructions, category: r.category,
    equipment: j.out<string[]>(r.equipment, []), muscleGroups: j.out<string[]>(r.muscle_groups, []), safetyNotes: r.safety_notes ?? '',
    source: r.source, status: r.status, sample: !!r.sample, createdBy: r.created_by, authorName: r.author_name ?? null,
    createdAt: r.created_at, updatedAt: r.updated_at,
    mediaRef: r.media_ref, media: exerciseMedia.mediaFor(ctx, r.media_ref),
  };
}

/** A media_ref an administrator sets: a key the exercise media manifest lists, or null (text only). */
function checkMediaRef(ctx: Ctx, ref: string | null | undefined): void {
  if (ref && !exerciseMedia.has(ctx, ref)) throw errors.badRequest(`${ref} is not a clip of the exercise media manifest (${exerciseMedia.status(ctx).missing[0] ?? 'import the clip first'})`, 'MEDIA_UNKNOWN');
}
export type Exercise = ReturnType<typeof presentExercise>;

function exerciseRow(ctx: Ctx, id: string): ExerciseRow | undefined {
  return ctx.db.get<ExerciseRow>('SELECT e.*, u.name AS author_name FROM exercises e LEFT JOIN users u ON u.id = e.created_by WHERE e.id = ?', [id]);
}

export function getExercise(ctx: Ctx, id: string) {
  const r = exerciseRow(ctx, id);
  if (!r) throw errors.notFound('Exercise');
  const actor = ctx.actor;
  if (actor?.role === 'coach' && r.status !== 'published' && !(r.source === 'coach' && r.created_by === actor.id)) throw errors.notFound('Exercise');
  if (actor?.role === 'member') throw errors.notFound('Exercise');
  return presentExercise(ctx, r);
}

/** The library as the caller may see it: administrators everything (filterable); a coach the published entries and
 *  their own drafts. */
export function listExercises(ctx: Ctx, opts: { q?: string; category?: string; status?: string; source?: string } = {}) {
  const actor = ctx.actor;
  const where: string[] = [];
  const params: string[] = [];
  if (actor?.role === 'coach') { where.push("(e.status = 'published' OR (e.source = 'coach' AND e.created_by = ? AND e.status = 'draft'))"); params.push(actor.id); }
  else requirePermission(ctx, 'library.manage');
  if (opts.status) { where.push('e.status = ?'); params.push(opts.status); }
  if (opts.source) { where.push('e.source = ?'); params.push(opts.source); }
  if (opts.category) { where.push('e.category = ?'); params.push(opts.category); }
  if (opts.q) { where.push('(e.name LIKE ? OR e.description LIKE ?)'); params.push(`%${opts.q}%`, `%${opts.q}%`); }
  const rows = ctx.db.all<ExerciseRow>(`SELECT e.*, u.name AS author_name FROM exercises e LEFT JOIN users u ON u.id = e.created_by ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY CASE e.status WHEN 'draft' THEN 0 WHEN 'published' THEN 1 ELSE 2 END, e.name LIMIT 500`, params);
  return rows.map((r) => presentExercise(ctx, r));
}

/** A coach proposes an exercise: always a draft, visible to its author and to administrators until one publishes it. */
export function proposeExercise(ctx: Ctx, input: ExerciseInput) {
  const actor = requireCoach(ctx);
  return insertExercise(ctx, { ...input, mediaRef: undefined }, { source: 'coach', status: 'draft', createdBy: actor.id });
}

/** An administrator (library.manage) adds a team exercise, as a draft or published. */
export function createTeamExercise(ctx: Ctx, input: ExerciseInput & { status?: 'draft' | 'published' }, opts: { sample?: boolean } = {}) {
  const actor = requirePermission(ctx, 'library.manage');
  return insertExercise(ctx, input, { source: 'team', status: input.status ?? 'draft', createdBy: actor.id, sample: opts.sample });
}

function insertExercise(ctx: Ctx, input: ExerciseInput, meta: { source: 'team' | 'coach'; status: 'draft' | 'published'; createdBy: string; sample?: boolean }) {
  checkMediaRef(ctx, input.mediaRef);
  const id = newId.exercise();
  const now = ctx.now();
  ctx.db.insert('exercises', { id, name: input.name.trim(), description: input.description ?? '', instructions: input.instructions ?? '', category: input.category, equipment: j.in(input.equipment ?? []), muscle_groups: j.in(input.muscleGroups ?? []), safety_notes: input.safetyNotes ?? '', media_ref: input.mediaRef ?? null, source: meta.source, status: meta.status, sample: meta.sample ? 1 : 0, created_by: meta.createdBy, created_at: now, updated_at: now });
  audit(ctx, 'exercise.create', { type: 'exercise', id }, null, { source: meta.source, status: meta.status, name: input.name.trim(), mediaRef: input.mediaRef ?? null });
  return presentExercise(ctx, exerciseRow(ctx, id)!);
}

/** An administrator edits an exercise's text, or maps it to a clip (mediaRef; null makes it text only again). Sessions
 *  already given to members keep the text they were given; a clip change shows at once wherever the exercise is used. */
export function updateExercise(ctx: Ctx, id: string, patch: Partial<ExerciseInput>) {
  requirePermission(ctx, 'library.manage');
  const r = exerciseRow(ctx, id);
  if (!r) throw errors.notFound('Exercise');
  if (patch.mediaRef !== undefined) checkMediaRef(ctx, patch.mediaRef);
  const changes = { name: patch.name?.trim(), description: patch.description, instructions: patch.instructions, category: patch.category, equipment: patch.equipment ? j.in(patch.equipment) : undefined, muscle_groups: patch.muscleGroups ? j.in(patch.muscleGroups) : undefined, safety_notes: patch.safetyNotes };
  const changed = Object.entries(changes).filter(([, v]) => v !== undefined).map(([k]) => k);
  const mediaChanged = patch.mediaRef !== undefined && (patch.mediaRef ?? null) !== r.media_ref;
  if (!changed.length && !mediaChanged) return presentExercise(ctx, r);
  ctx.db.tx(() => {
    ctx.db.update('exercises', id, { ...changes, updated_at: ctx.now() });
    if (mediaChanged) ctx.db.run('UPDATE exercises SET media_ref = ? WHERE id = ?', [patch.mediaRef ?? null, id]);
    audit(ctx, 'exercise.update', { type: 'exercise', id }, null, { fields: mediaChanged ? [...changed, 'media_ref'] : changed, ...(mediaChanged ? { mediaRef: { from: r.media_ref, to: patch.mediaRef ?? null } } : {}) });
  });
  return presentExercise(ctx, exerciseRow(ctx, id)!);
}

/** Publish, return to draft or archive an exercise: library.manage, with a reason. Templates that use an archived
 *  exercise keep it; new templates cannot add it. */
export function setExerciseStatus(ctx: Ctx, id: string, status: 'draft' | 'published' | 'archived', reason: string) {
  requirePermission(ctx, 'library.manage');
  if (!reason || reason.trim().length < 3) throw errors.badRequest('Say why: the reason is recorded in the audit log', 'REASON_REQUIRED');
  const r = exerciseRow(ctx, id);
  if (!r) throw errors.notFound('Exercise');
  if (r.status === status) return presentExercise(ctx, r);
  ctx.db.update('exercises', id, { status, updated_at: ctx.now() });
  audit(ctx, 'exercise.status', { type: 'exercise', id }, reason.trim(), { from: r.status, to: status });
  if (status === 'published' && r.source === 'coach' && r.created_by) notify(ctx, { userId: r.created_by, category: 'workout', title: 'Your exercise is in the library', body: `${r.name} was published to the Bioptime exercise library.`, data: { exerciseId: id }, channels: ['in_app'] });
  return presentExercise(ctx, exerciseRow(ctx, id)!);
}

/** May this exercise go into a template? Published entries for everyone; a coach's own draft only in that coach's
 *  templates (team templates use published exercises only). */
function usableExercise(ctx: Ctx, exerciseId: string, coachId: string | null): ExerciseRow {
  const e = exerciseRow(ctx, exerciseId);
  if (!e || e.status === 'archived') throw errors.badRequest(`Exercise ${exerciseId} is not available in the library`, 'EXERCISE_UNAVAILABLE');
  if (e.status === 'published') return e;
  if (coachId && e.source === 'coach' && e.created_by === coachId) return e;
  throw errors.badRequest(`${e.name} is still a draft: an administrator publishes it before it can be used here`, 'EXERCISE_UNAVAILABLE');
}

/* ---------- templates ---------- */

type TemplateRow = { id: string; title: string; description: string; level: string | null; est_minutes: number | null; source: 'team' | 'coach'; status: 'draft' | 'published' | 'archived'; sample: number; created_by: string | null; created_at: string; updated_at: string; author_name?: string | null; item_count?: number; tags_categories?: string | null; tags_muscles?: string | null; tags_equipment?: string | null };
type TemplateItemRow = { id: string; template_id: string; exercise_id: string; block: string; sort: number; sets: number; reps: string | null; duration_seconds: number | null; rest_seconds: number | null; load_note: string; note: string; exercise_name: string; exercise_category: string; exercise_status: string; exercise_instructions: string };
export type TemplateItemInput = { exerciseId: string; block?: string; sets: number; reps?: string | null; durationSeconds?: number | null; restSeconds?: number | null; loadNote?: string; note?: string };
export type TemplateInput = { title: string; description?: string; level?: string | null; estMinutes?: number | null; items?: TemplateItemInput[] };

/** A template row with its author, its number of exercises and, as JSON arrays, the distinct library categories,
 *  muscle groups and equipment of those exercises. */
const TEMPLATE_SELECT = `SELECT t.*, u.name AS author_name, (SELECT COUNT(*) FROM workout_template_items i WHERE i.template_id = t.id) AS item_count,
  (SELECT json_group_array(DISTINCT e.category) FROM workout_template_items i JOIN exercises e ON e.id = i.exercise_id WHERE i.template_id = t.id) AS tags_categories,
  (SELECT json_group_array(DISTINCT g.value) FROM workout_template_items i JOIN exercises e ON e.id = i.exercise_id, json_each(e.muscle_groups) g WHERE i.template_id = t.id) AS tags_muscles,
  (SELECT json_group_array(DISTINCT q.value) FROM workout_template_items i JOIN exercises e ON e.id = i.exercise_id, json_each(e.equipment) q WHERE i.template_id = t.id) AS tags_equipment
  FROM workout_templates t LEFT JOIN users u ON u.id = t.created_by`;
function templateRow(ctx: Ctx, id: string): TemplateRow | undefined {
  return ctx.db.get<TemplateRow>(`${TEMPLATE_SELECT} WHERE t.id = ?`, [id]);
}
function presentTemplate(r: TemplateRow) {
  const tags = (v: string | null | undefined) => j.out<Array<string | null>>(v, []).filter((x): x is string => typeof x === 'string' && x.length > 0).sort();
  return { id: r.id, title: r.title, description: r.description, level: r.level, estMinutes: r.est_minutes, source: r.source, status: r.status, sample: !!r.sample, createdBy: r.created_by, authorName: r.author_name ?? null, itemCount: r.item_count ?? 0,
    // what the template's exercises are (their library category, muscle groups and equipment), for the plan cards' chips
    categories: tags(r.tags_categories), muscleGroups: tags(r.tags_muscles), equipment: tags(r.tags_equipment),
    createdAt: r.created_at, updatedAt: r.updated_at };
}
function templateItems(ctx: Ctx, templateId: string) {
  return ctx.db.all<TemplateItemRow>('SELECT i.*, e.name AS exercise_name, e.category AS exercise_category, e.status AS exercise_status, e.instructions AS exercise_instructions FROM workout_template_items i JOIN exercises e ON e.id = i.exercise_id WHERE i.template_id = ? ORDER BY i.sort', [templateId])
    .map((i) => ({ id: i.id, exerciseId: i.exercise_id, exerciseName: i.exercise_name, exerciseCategory: i.exercise_category, exerciseStatus: i.exercise_status, block: i.block, sort: i.sort, sets: i.sets, reps: i.reps, durationSeconds: i.duration_seconds, restSeconds: i.rest_seconds, loadNote: i.load_note, note: i.note }));
}

/** Can the caller read this template? Administrators with library.manage: any. A coach: published team templates and
 *  their own; `alsoAllowed` lets a coach read templates a programme they now coach already uses. */
function visibleTemplate(ctx: Ctx, r: TemplateRow, alsoAllowed: Set<string> = new Set()): boolean {
  const actor = ctx.actor;
  if (!actor) return false;
  if (actor.role === 'coach') return (r.source === 'team' && r.status === 'published') || (r.source === 'coach' && r.created_by === actor.id) || alsoAllowed.has(r.id);
  if (actor.role === 'admin' || actor.role === 'owner') return true; // the routes ask for library.manage or members.manage
  return false;
}

export function getTemplate(ctx: Ctx, id: string) {
  const r = templateRow(ctx, id);
  if (!r || !visibleTemplate(ctx, r, coachProgrammeTemplates(ctx))) throw errors.notFound('Workout template');
  return { ...presentTemplate(r), items: templateItems(ctx, id) };
}

/** Templates used by programmes of the members the calling coach is currently assigned to (a new coach takes over a
 *  programme with the templates it already uses). */
function coachProgrammeTemplates(ctx: Ctx): Set<string> {
  const actor = ctx.actor;
  if (actor?.role !== 'coach') return new Set();
  const rows = ctx.db.all<{ template_id: string | null }>("SELECT DISTINCT s.template_id FROM workout_sessions s JOIN coach_assignments a ON a.member_id = s.member_id AND a.coach_id = ? AND a.status IN ('active','paused') WHERE s.template_id IS NOT NULL", [actor.id]);
  return new Set(rows.map((r) => r.template_id!));
}

/** The coach's template visibility rule as SQL over workout_templates t: published team templates and the coach's own
 *  (none when coachId is null). One rule for the coach's list and for the templates an administrator may use in a
 *  member's programme (adminTemplatesForMember), as checkStructure accepts them. */
function coachTemplateRule(coachId: string | null): { sql: string; params: string[] } {
  return coachId ? { sql: "((t.source = 'team' AND t.status = 'published') OR (t.source = 'coach' AND t.created_by = ?))", params: [coachId] } : { sql: "(t.source = 'team' AND t.status = 'published')", params: [] };
}

export function listTemplates(ctx: Ctx, opts: { status?: string; source?: string; includeArchived?: boolean } = {}) {
  const actor = ctx.actor;
  const where: string[] = [];
  const params: string[] = [];
  if (actor?.role === 'coach') {
    const rule = coachTemplateRule(actor.id);
    where.push(rule.sql);
    params.push(...rule.params);
    if (!opts.includeArchived) where.push("t.status != 'archived'");
  } else requirePermission(ctx, 'library.manage');
  if (opts.status) { where.push('t.status = ?'); params.push(opts.status); }
  if (opts.source) { where.push('t.source = ?'); params.push(opts.source); }
  return ctx.db.all<TemplateRow>(`${TEMPLATE_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.source DESC, t.title LIMIT 500`, params).map(presentTemplate);
}

/** The templates an administrator (members.manage, no library.manage needed) may put in a member's workout programme:
 *  exactly those checkStructure accepts. For a new programme, the coach's rule for the member's assigned coach
 *  (published team templates and that coach's own; the team's only while the member has no coach). With programId (a
 *  programme of this member), the rule for that programme's coach plus the templates its published version already
 *  uses. Archived templates are never offered. Each item says whether it can be used now (`usable`: it has exercises;
 *  an empty one is refused as TEMPLATE_EMPTY). */
export function adminTemplatesForMember(ctx: Ctx, memberId: string, opts: { programId?: string } = {}) {
  requireMembersManage(ctx);
  const member = ctx.db.get<{ role: string }>('SELECT role FROM users WHERE id = ?', [memberId]);
  if (!member || member.role !== 'member') throw errors.notFound('Member');
  let coachId: string | null;
  const inherited: string[] = [];
  if (opts.programId) {
    const p = programRow(ctx, opts.programId);
    if (!p || p.member_id !== memberId) throw errors.notFound('Workout programme');
    coachId = p.coach_id;
    const pub = ctx.db.get<{ structure: string }>("SELECT structure FROM workout_program_versions WHERE program_id = ? AND status = 'published'", [p.id]);
    for (const w of j.out<ProgramStructure>(pub?.structure, { weeks: [] }).weeks) for (const d of w.days) if (!inherited.includes(d.templateId)) inherited.push(d.templateId);
  } else coachId = assignedCoach(ctx, memberId);
  const rule = coachTemplateRule(coachId);
  const also = inherited.length ? ` OR t.id IN (${inherited.map(() => '?').join(', ')})` : '';
  const items = ctx.db.all<TemplateRow>(`${TEMPLATE_SELECT} WHERE t.status != 'archived' AND (${rule.sql}${also}) ORDER BY t.source DESC, t.title LIMIT 500`, [...rule.params, ...inherited])
    .map((r) => ({ ...presentTemplate(r), usable: (r.item_count ?? 0) > 0 }));
  const coach = coachId ? ctx.db.get<{ name: string; role: string }>('SELECT name, role FROM users WHERE id = ?', [coachId]) : undefined;
  return { items, coachId: coach?.role === 'coach' ? coachId : null, coachName: coach?.role === 'coach' ? coach.name : null, programId: opts.programId ?? null };
}

function writeItems(ctx: Ctx, templateId: string, items: TemplateItemInput[], coachId: string | null) {
  ctx.db.run('DELETE FROM workout_template_items WHERE template_id = ?', [templateId]);
  items.forEach((it, sort) => {
    usableExercise(ctx, it.exerciseId, coachId);
    if (!it.reps && !it.durationSeconds) throw errors.badRequest('Give the reps or a duration for each exercise', 'ITEM_INCOMPLETE');
    ctx.db.insert('workout_template_items', { id: newId.templateItem(), template_id: templateId, exercise_id: it.exerciseId, block: it.block ?? '', sort, sets: it.sets, reps: it.reps ?? null, duration_seconds: it.durationSeconds ?? null, rest_seconds: it.restSeconds ?? null, load_note: it.loadNote ?? '', note: it.note ?? '' });
  });
}

/** A coach's own template: usable in their programmes from the start (status published); they can archive it. */
export function createCoachTemplate(ctx: Ctx, input: TemplateInput) {
  const actor = requireCoach(ctx);
  return insertTemplate(ctx, input, { source: 'coach', status: 'published', createdBy: actor.id, coachId: actor.id });
}

/** A team template (library.manage): a draft until an administrator publishes it; team templates use published
 *  exercises only. */
export function createTeamTemplate(ctx: Ctx, input: TemplateInput & { status?: 'draft' | 'published' }, opts: { sample?: boolean } = {}) {
  const actor = requirePermission(ctx, 'library.manage');
  return insertTemplate(ctx, input, { source: 'team', status: input.status ?? 'draft', createdBy: actor.id, coachId: null, sample: opts.sample });
}

function insertTemplate(ctx: Ctx, input: TemplateInput, meta: { source: 'team' | 'coach'; status: 'draft' | 'published'; createdBy: string; coachId: string | null; sample?: boolean }) {
  const id = newId.template();
  const now = ctx.now();
  ctx.db.tx(() => {
    ctx.db.insert('workout_templates', { id, title: input.title.trim(), description: input.description ?? '', level: input.level ?? null, est_minutes: input.estMinutes ?? null, source: meta.source, status: meta.status, sample: meta.sample ? 1 : 0, created_by: meta.createdBy, created_at: now, updated_at: now });
    writeItems(ctx, id, input.items ?? [], meta.coachId);
    audit(ctx, 'workout_template.create', { type: 'workout_template', id }, null, { source: meta.source, status: meta.status, items: (input.items ?? []).length });
  });
  return getTemplate(ctx, id);
}

/** Edit a template: a coach their own (and archive or restore it); an administrator any team template. Sessions already
 *  generated keep the copy they were given. */
export function updateTemplate(ctx: Ctx, id: string, patch: Partial<TemplateInput> & { status?: 'draft' | 'published' | 'archived' }) {
  const r = templateRow(ctx, id);
  if (!r) throw errors.notFound('Workout template');
  const actor = ctx.actor;
  let coachId: string | null = null;
  if (actor?.role === 'coach') {
    if (r.source !== 'coach' || r.created_by !== actor.id) throw errors.notFound('Workout template');
    if (patch.status === 'draft') throw errors.badRequest('Your own templates are usable or archived', 'STATUS_INVALID');
    coachId = actor.id;
  } else {
    requirePermission(ctx, 'library.manage');
    if (r.source !== 'team') throw errors.forbidden('A coach’s own template is edited by that coach', 'NOT_TEAM_TEMPLATE');
    if (patch.status !== undefined) throw errors.badRequest('Change a team template’s status with a reason (POST …/status)', 'USE_STATUS_ROUTE');
  }
  const fields = ['title', 'description', 'level', 'estMinutes', 'items', 'status'].filter((k) => (patch as Record<string, unknown>)[k] !== undefined);
  if (!fields.length) return getTemplate(ctx, id);
  ctx.db.tx(() => {
    ctx.db.update('workout_templates', id, { title: patch.title?.trim(), description: patch.description, level: patch.level === undefined ? undefined : patch.level, est_minutes: patch.estMinutes === undefined ? undefined : patch.estMinutes, status: patch.status, updated_at: ctx.now() });
    if (patch.items) writeItems(ctx, id, patch.items, coachId);
    audit(ctx, 'workout_template.update', { type: 'workout_template', id }, null, { fields, ...(patch.status ? { from: r.status, to: patch.status } : {}) });
  });
  return getTemplate(ctx, id);
}

/** Publish, return to draft or archive a team template: library.manage, with a reason. */
export function setTemplateStatus(ctx: Ctx, id: string, status: 'draft' | 'published' | 'archived', reason: string) {
  requirePermission(ctx, 'library.manage');
  if (!reason || reason.trim().length < 3) throw errors.badRequest('Say why: the reason is recorded in the audit log', 'REASON_REQUIRED');
  const r = templateRow(ctx, id);
  if (!r) throw errors.notFound('Workout template');
  if (r.source !== 'team') throw errors.forbidden('A coach’s own template is managed by that coach', 'NOT_TEAM_TEMPLATE');
  if (status === 'published' && !r.item_count) throw errors.badRequest('Add at least one exercise before publishing', 'TEMPLATE_EMPTY');
  if (r.status !== status) {
    ctx.db.update('workout_templates', id, { status, updated_at: ctx.now() });
    audit(ctx, 'workout_template.status', { type: 'workout_template', id }, reason.trim(), { from: r.status, to: status });
  }
  return getTemplate(ctx, id);
}

/* ---------- programmes ---------- */

type ProgramRow = { id: string; member_id: string; coach_id: string; programme_id: string | null; title: string; status: 'draft' | 'published' | 'archived'; current_version: number; start_date: string | null; created_at: string; updated_at: string; archived_at: string | null; member_name: string; coach_name: string };
/** `title` and `start_date` (0026) hold a revision's own title and start date until it is published; NULL: unchanged. */
type VersionRow = { id: string; program_id: string; version: number; summary: string; structure: string; status: 'draft' | 'published' | 'superseded'; created_by: string; created_at: string; published_at: string | null; title: string | null; start_date: string | null };

function programRow(ctx: Ctx, id: string): ProgramRow | undefined {
  return ctx.db.get<ProgramRow>('SELECT p.*, m.name AS member_name, c.name AS coach_name FROM workout_programs p JOIN users m ON m.id = p.member_id JOIN users c ON c.id = p.coach_id WHERE p.id = ?', [id]);
}

/** Weeks of the programme in which the member logged or skipped at least one session. They stay in every revision, so
 *  later content never lands under sessions already done. */
function loggedWeeks(ctx: Ctx, programId: string): number[] {
  return ctx.db.all<{ week: number }>("SELECT DISTINCT week FROM workout_sessions WHERE program_id = ? AND status != 'scheduled' ORDER BY week", [programId]).map((r) => r.week);
}

/** The sessions of the programme the member logged or skipped: the week and day each belongs to and the template it was
 *  generated from. Every revision keeps each of them where it is (checkStructure). */
function loggedSessions(ctx: Ctx, programId: string): Array<{ week: number; day: number; template_id: string | null; title: string }> {
  return ctx.db.all<{ week: number; day: number; template_id: string | null; title: string }>("SELECT week, day, template_id, title FROM workout_sessions WHERE program_id = ? AND status != 'scheduled' ORDER BY week, day", [programId]);
}

/** What the member's own Workouts screens show of a session (alias s, its programme p): every session of a live
 *  programme, and of a closed one only the sessions they logged or skipped. memberWeek (and its week summary), the
 *  data export and adherence all count by this rule. */
const SHOWN_TO_MEMBER = "(p.status = 'published' OR s.status != 'scheduled')";

/** The programme, as its coach (or an administrator) sees it: versions, the draft being edited (with its own title and
 *  start date while they wait for publishing), session counts, the weeks the member already logged in and the titles of
 *  the templates its structure names. No health detail. */
export function presentProgram(ctx: Ctx, id: string) {
  const p = programRow(ctx, id);
  if (!p) throw errors.notFound('Workout programme');
  const versions = ctx.db.all<VersionRow>('SELECT * FROM workout_program_versions WHERE program_id = ? ORDER BY version DESC', [id]);
  const shape = (v: VersionRow | undefined) => (v ? { id: v.id, version: v.version, status: v.status, title: v.title, startDate: v.start_date, summary: v.summary, structure: j.out<ProgramStructure>(v.structure, { weeks: [] }), createdAt: v.created_at, publishedAt: v.published_at } : null);
  const draft = versions.find((v) => v.status === 'draft');
  const published = versions.find((v) => v.status === 'published');
  const counts = ctx.db.get<{ total: number; scheduled: number; completed: number; partial: number; skipped: number }>("SELECT COUNT(*) total, SUM(status = 'scheduled') scheduled, SUM(status = 'completed') completed, SUM(status = 'partial') partial, SUM(status = 'skipped') skipped FROM workout_sessions WHERE program_id = ?", [id])!;
  const templateIds = new Set<string>();
  for (const v of [draft, published]) for (const w of shape(v)?.structure.weeks ?? []) for (const d of w.days) templateIds.add(d.templateId);
  const templates = templateIds.size ? ctx.db.all<{ id: string; title: string; status: string; source: string }>(`SELECT id, title, status, source FROM workout_templates WHERE id IN (${[...templateIds].map(() => '?').join(', ')})`, [...templateIds]) : [];
  return {
    id: p.id, memberId: p.member_id, memberName: p.member_name, coachId: p.coach_id, coachName: p.coach_name, programmeId: p.programme_id,
    title: p.title, status: p.status, currentVersion: p.current_version, startDate: p.start_date, createdAt: p.created_at, updatedAt: p.updated_at, archivedAt: p.archived_at,
    draft: shape(draft), published: shape(published),
    versions: versions.map((v) => ({ id: v.id, version: v.version, status: v.status, summary: v.summary, createdAt: v.created_at, publishedAt: v.published_at })),
    sessions: { total: counts.total ?? 0, scheduled: counts.scheduled ?? 0, completed: counts.completed ?? 0, partial: counts.partial ?? 0, skipped: counts.skipped ?? 0 },
    loggedWeeks: loggedWeeks(ctx, id),
    // the days the member logged or skipped, which every revision keeps as they are (week, day and template)
    loggedDays: loggedSessions(ctx, id).map((s) => ({ week: s.week, day: s.day, templateId: s.template_id })),
    templates: Object.fromEntries(templates.map((t) => [t.id, { title: t.title, status: t.status, source: t.source }])),
  };
}

/** The programme, when the calling coach is currently assigned to its member (404 otherwise, so ids reveal nothing). */
function programForCoach(ctx: Ctx, id: string): ProgramRow {
  const actor = requireCoach(ctx);
  const p = programRow(ctx, id);
  if (!p || !coachHasMember(ctx, actor.id, p.member_id)) throw errors.notFound('Workout programme');
  return p;
}

/** Templates a coach may put in this programme: published team templates, their own, and any the programme's
 *  published version already uses (a coach who takes over a programme keeps its templates). */
function checkStructure(ctx: Ctx, coachId: string, structure: ProgramStructure, programId: string | null): void {
  const inherited = new Set<string>();
  if (programId) {
    const pub = ctx.db.get<{ structure: string }>("SELECT structure FROM workout_program_versions WHERE program_id = ? AND status = 'published'", [programId]);
    for (const w of j.out<ProgramStructure>(pub?.structure, { weeks: [] }).weeks) for (const d of w.days) inherited.add(d.templateId);
  }
  const weeks = new Set<number>();
  for (const w of structure.weeks) {
    if (weeks.has(w.week)) throw errors.badRequest(`Week ${w.week} appears twice`, 'STRUCTURE_INVALID');
    weeks.add(w.week);
  }
  // a session the member logged or skipped belongs to its week and day: every revision keeps that week, that day and
  // the template it came from. Removing or renumbering a week, moving a day or giving it another template would put
  // other content where the member already logged, so each is refused (WEEK_HAS_LOGS for a whole week, DAY_HAS_LOGS
  // for a day). The days still to come change freely.
  const kept = new Set<string>();
  if (programId) {
    const logged = loggedSessions(ctx, programId);
    const gone = [...new Set(logged.map((s) => s.week))].filter((n) => !weeks.has(n));
    if (gone.length) throw errors.badRequest(`Week ${gone[0]} has sessions your client already logged or skipped, so it stays in the programme with the same number. Remove the days in it that are still to come instead.`, 'WEEK_HAS_LOGS');
    for (const s of logged) {
      const day = structure.weeks.find((w) => w.week === s.week)!.days.find((d) => d.day === s.day);
      if (!day || (s.template_id !== null && day.templateId !== s.template_id)) throw errors.badRequest(`Week ${s.week}, day ${s.day} (${s.title}) was already logged or skipped by your client, so every revision keeps it in that week and day with the same template. Change the days still to come instead.`, 'DAY_HAS_LOGS');
      if (s.template_id !== null) kept.add(`${s.week}|${s.day}`);
    }
  }
  for (const w of structure.weeks) {
    const days = new Set<number>();
    for (const d of w.days) {
      if (days.has(d.day)) throw errors.badRequest(`Week ${w.week} has day ${d.day} twice`, 'STRUCTURE_INVALID');
      days.add(d.day);
      // a day the member already logged keeps its session as it was (publishing never regenerates it), so the template
      // it came from stays usable here even if it was archived or emptied since
      if (kept.has(`${w.week}|${d.day}`)) continue;
      const t = templateRow(ctx, d.templateId);
      const ok = !!t && t.status !== 'archived' && ((t.source === 'team' && t.status === 'published') || (t.source === 'coach' && t.created_by === coachId) || inherited.has(t.id));
      if (!ok) throw errors.badRequest(`Week ${w.week}, day ${d.day}: that template is not available to you`, 'TEMPLATE_UNAVAILABLE');
      if (!t!.item_count) throw errors.badRequest(`Week ${w.week}, day ${d.day}: ${t!.title} has no exercises yet`, 'TEMPLATE_EMPTY');
    }
  }
}

/** Who edits a programme: the acting account (a version's author), the coach whose templates the structure may use
 *  besides the team's (checkStructure), and whether this is the coach or an administrator. */
type Editor = { actorId: string; templateCoachId: string; by: 'coach' | 'admin' };
const adminMeta = (e: Editor) => (e.by === 'admin' ? { by: 'admin' } : {});

/** A draft programme for an assigned client. Nothing reaches the member until it is published. */
export function createProgram(ctx: Ctx, input: { memberId: string; title: string; summary?: string; startDate?: string; structure: ProgramStructure }) {
  const actor = requireCoach(ctx);
  if (!coachHasMember(ctx, actor.id, input.memberId)) throw errors.forbidden('Not your client', 'NO_ACCESS');
  return insertProgram(ctx, input, actor.id, { actorId: actor.id, templateCoachId: actor.id, by: 'coach' });
}

function insertProgram(ctx: Ctx, input: { memberId: string; title: string; summary?: string; startDate?: string; structure: ProgramStructure }, coachId: string, editor: Editor) {
  checkStructure(ctx, editor.templateCoachId, input.structure, null);
  const programme = ctx.db.get<{ id: string }>("SELECT id FROM programmes WHERE member_id = ? AND status = 'active' ORDER BY start_at DESC LIMIT 1", [input.memberId]);
  const id = newId.program();
  const now = ctx.now();
  ctx.db.tx(() => {
    ctx.db.insert('workout_programs', { id, member_id: input.memberId, coach_id: coachId, programme_id: programme?.id ?? null, title: input.title.trim(), status: 'draft', current_version: 1, start_date: input.startDate ?? null, created_at: now, updated_at: now });
    ctx.db.insert('workout_program_versions', { id: newId.version(), program_id: id, version: 1, summary: input.summary ?? '', structure: j.in(input.structure), status: 'draft', created_by: editor.actorId, created_at: now });
    audit(ctx, 'workout_program.create', { type: 'workout_program', id }, null, { memberId: input.memberId, weeks: input.structure.weeks.length, ...adminMeta(editor) });
  });
  return presentProgram(ctx, id);
}

/** Edit the draft. A published programme gets a new draft version; the published one stays live until it is published,
 *  and so do its title and start date: a revision's own title and start date wait on the draft version (the member's
 *  pages show the programme's). */
export function updateProgramDraft(ctx: Ctx, id: string, patch: { title?: string; summary?: string; startDate?: string; structure?: ProgramStructure }) {
  const actor = requireCoach(ctx);
  const p = programForCoach(ctx, id);
  return updateDraft(ctx, p, patch, { actorId: actor.id, templateCoachId: actor.id, by: 'coach' });
}

function updateDraft(ctx: Ctx, p: ProgramRow, patch: { title?: string; summary?: string; startDate?: string; structure?: ProgramStructure }, editor: Editor) {
  const id = p.id;
  if (p.status === 'archived') throw errors.state('This programme is archived; start a new one');
  if (patch.structure) checkStructure(ctx, editor.templateCoachId, patch.structure, id);
  const live = p.status === 'published';
  const title = patch.title?.trim();
  const now = ctx.now();
  ctx.db.tx(() => {
    let draft = ctx.db.get<{ id: string; version: number }>("SELECT id, version FROM workout_program_versions WHERE program_id = ? AND status = 'draft'", [id]);
    if (!draft) {
      const last = ctx.db.get<{ version: number; summary: string; structure: string }>('SELECT version, summary, structure FROM workout_program_versions WHERE program_id = ? ORDER BY version DESC LIMIT 1', [id])!;
      const vid = newId.version();
      ctx.db.insert('workout_program_versions', { id: vid, program_id: id, version: last.version + 1, summary: last.summary, structure: last.structure, status: 'draft', created_by: editor.actorId, created_at: now });
      draft = { id: vid, version: last.version + 1 };
    }
    ctx.db.update('workout_program_versions', draft.id, { summary: patch.summary, structure: patch.structure ? j.in(patch.structure) : undefined, ...(live ? { title, start_date: patch.startDate } : {}) });
    ctx.db.update('workout_programs', id, { ...(live ? {} : { title, start_date: patch.startDate }), updated_at: now });
    audit(ctx, 'workout_program.update_draft', { type: 'workout_program', id }, null, { version: draft.version, fields: Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined), ...adminMeta(editor) });
  });
  return presentProgram(ctx, id);
}

/** Publish the draft: it becomes the live version, the member's sessions are generated (once per week and day), and
 *  the member is told. A revision regenerates the sessions still scheduled and keeps every session already completed,
 *  completed in part or skipped. */
export function publishProgram(ctx: Ctx, id: string, startDate?: string) {
  const actor = requireCoach(ctx);
  return ctx.db.tx(() => publishDraft(ctx, programForCoach(ctx, id), startDate, { actorId: actor.id, templateCoachId: actor.id, by: 'coach' }));
}

function publishDraft(ctx: Ctx, p: ProgramRow, startDate: string | undefined, editor: Editor) {
  const id = p.id;
  if (p.status === 'archived') throw errors.state('This programme is archived; start a new one');
  const draft = ctx.db.get<VersionRow>("SELECT * FROM workout_program_versions WHERE program_id = ? AND status = 'draft'", [id]);
  if (!draft) throw errors.state('Nothing to publish: there is no draft version');
  const structure = j.out<ProgramStructure>(draft.structure, { weeks: [] });
  if (!structure.weeks.some((w) => w.days.length)) throw errors.badRequest('Add at least one training day before publishing', 'STRUCTURE_EMPTY');
  checkStructure(ctx, editor.templateCoachId, structure, id);
  const now = ctx.now();
  const start = startDate ?? draft.start_date ?? p.start_date ?? todayIst(ctx);
  const title = draft.title?.trim() || p.title;
  ctx.db.run("UPDATE workout_program_versions SET status = 'superseded' WHERE program_id = ? AND status = 'published'", [id]);
  ctx.db.update('workout_program_versions', draft.id, { status: 'published', published_at: now });
  ctx.db.update('workout_programs', id, { status: 'published', current_version: draft.version, title, start_date: start, updated_at: now });

  // what the member has done stays; what is still only scheduled is regenerated from this version
  const kept = new Set(ctx.db.all<{ week: number; day: number }>("SELECT week, day FROM workout_sessions WHERE program_id = ? AND status != 'scheduled'", [id]).map((s) => `${s.week}|${s.day}`));
  const replaced = ctx.db.run("DELETE FROM workout_sessions WHERE program_id = ? AND status = 'scheduled'", [id]).changes;
  let created = 0;
  for (const w of structure.weeks) for (const d of [...w.days].sort((a, b) => a.day - b.day)) {
    if (kept.has(`${w.week}|${d.day}`)) continue;
    const t = templateRow(ctx, d.templateId)!;
    const sessionId = newId.session();
    ctx.db.insert('workout_sessions', { id: sessionId, program_id: id, program_version_id: draft.id, member_id: p.member_id, template_id: t.id, title: t.title, week: w.week, day: d.day, scheduled_date: plusDays(start, (w.week - 1) * 7 + (d.day - 1)), status: 'scheduled', created_at: now, updated_at: now });
    // the exercise's text as it is now is the session's copy (0014, 0040): later library edits never reach it
    const items = ctx.db.all<TemplateItemRow & { exercise_description: string; exercise_muscles: string; exercise_equipment: string; exercise_safety: string }>('SELECT i.*, e.name AS exercise_name, e.category AS exercise_category, e.instructions AS exercise_instructions, e.description AS exercise_description, e.muscle_groups AS exercise_muscles, e.equipment AS exercise_equipment, e.safety_notes AS exercise_safety FROM workout_template_items i JOIN exercises e ON e.id = i.exercise_id WHERE i.template_id = ? ORDER BY i.sort', [t.id]);
    for (const it of items) ctx.db.insert('workout_session_items', { id: newId.sessionItem(), session_id: sessionId, exercise_id: it.exercise_id, exercise_name: it.exercise_name, exercise_category: it.exercise_category, exercise_instructions: it.exercise_instructions, exercise_description: it.exercise_description, exercise_muscles: it.exercise_muscles, exercise_equipment: it.exercise_equipment, exercise_safety: it.exercise_safety, block: it.block, sort: it.sort, sets: it.sets, reps: it.reps, duration_seconds: it.duration_seconds, rest_seconds: it.rest_seconds, load_note: it.load_note, note: it.note });
    created++;
  }
  notify(ctx, { userId: p.member_id, category: 'workout', title: draft.version === 1 ? 'Your workout programme is ready' : 'Your workout programme was updated', body: `${title}: this week’s sessions are ready to open.`, data: { programId: id, version: draft.version } });
  emit(ctx, 'WorkoutProgramPublished', { type: 'workout_program', id }, { memberId: p.member_id, version: draft.version, sessions: created });
  audit(ctx, 'workout_program.publish', { type: 'workout_program', id }, null, { version: draft.version, sessionsCreated: created, sessionsKept: kept.size, scheduledReplaced: replaced, startDate: start, ...adminMeta(editor) });
  return presentProgram(ctx, id);
}

/** Archive a programme, with a reason. Sessions the member has done stay in their history; sessions dated today or
 *  later that were never started are removed. */
export function archiveProgram(ctx: Ctx, id: string, reason: string) {
  const actor = requireCoach(ctx);
  if (!reason || reason.trim().length < 3) throw errors.badRequest('Say why: the reason is recorded in the audit log', 'REASON_REQUIRED');
  return ctx.db.tx(() => archive(ctx, programForCoach(ctx, id), reason, { actorId: actor.id, templateCoachId: actor.id, by: 'coach' }));
}

function archive(ctx: Ctx, p: ProgramRow, reason: string, editor: Editor) {
  const id = p.id;
  if (p.status === 'archived') return presentProgram(ctx, id);
  const now = ctx.now();
  const removed = ctx.db.run("DELETE FROM workout_sessions WHERE program_id = ? AND status = 'scheduled' AND scheduled_date >= ?", [id, todayIst(ctx)]).changes;
  ctx.db.update('workout_programs', id, { status: 'archived', archived_at: now, updated_at: now });
  audit(ctx, 'workout_program.archive', { type: 'workout_program', id }, reason.trim(), { removedScheduled: removed, ...adminMeta(editor) });
  if (p.status === 'published' && removed) notify(ctx, { userId: p.member_id, category: 'workout', title: 'A workout programme was closed', body: `${p.title} was closed by ${editor.by === 'admin' ? 'the Bioptime team' : 'your coach'}. Sessions you already logged stay in your history.`, data: { programId: id }, channels: ['in_app'] });
  return presentProgram(ctx, id);
}

/* ---------- administrators: a member's programmes (members.manage; api/http/routes/workouts.ts) ---------- */

/** The coach a member's programme belongs to: the assigned coach (active or paused), or null when there is none. */
function assignedCoach(ctx: Ctx, memberId: string): string | null {
  return ctx.db.get<{ coach_id: string }>("SELECT coach_id FROM coach_assignments WHERE member_id = ? AND coach_id IS NOT NULL AND status IN ('active','paused') ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, created_at DESC LIMIT 1", [memberId])?.coach_id ?? null;
}

function requireMembersManage(ctx: Ctx) { return requirePermission(ctx, 'members.manage'); }

function programForAdmin(ctx: Ctx, id: string): { p: ProgramRow; editor: Editor } {
  const actor = requireMembersManage(ctx);
  const p = programRow(ctx, id);
  if (!p) throw errors.notFound('Workout programme');
  return { p, editor: { actorId: actor.id, templateCoachId: p.coach_id, by: 'admin' } };
}

/** Every programme of a member (drafts and closed ones included), newest first. */
export function adminListMemberPrograms(ctx: Ctx, memberId: string) {
  requireMembersManage(ctx);
  return ctx.db.all<{ id: string }>("SELECT id FROM workout_programs WHERE member_id = ? ORDER BY CASE status WHEN 'published' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, updated_at DESC LIMIT 200", [memberId]).map((r) => presentProgram(ctx, r.id));
}

export function adminGetProgram(ctx: Ctx, id: string) { return presentProgram(ctx, programForAdmin(ctx, id).p.id); }

/** An administrator's draft programme for a member: a structure given in full, an empty draft (from scratch, filled in
 *  before publishing), or one template repeated on the chosen days for a number of weeks. The templates allowed are
 *  the coach's: published team templates and the assigned coach's own. */
export function adminCreateProgram(ctx: Ctx, memberId: string, input: { title: string; summary?: string; startDate?: string; structure?: ProgramStructure; templateId?: string; weeks?: number; days?: number[] }) {
  const actor = requireMembersManage(ctx);
  const member = ctx.db.get<{ role: string }>('SELECT role FROM users WHERE id = ?', [memberId]);
  if (!member || member.role !== 'member') throw errors.notFound('Member');
  const coachId = assignedCoach(ctx, memberId) ?? actor.id;
  let structure: ProgramStructure = input.structure ?? { weeks: [] };
  if (input.templateId) {
    const weeks = input.weeks ?? 4;
    const days = [...(input.days ?? [1, 3, 5])].sort((a, b) => a - b);
    structure = { weeks: Array.from({ length: weeks }, (_, i) => ({ week: i + 1, days: days.map((day) => ({ day, templateId: input.templateId! })) })) };
  }
  return insertProgram(ctx, { memberId, title: input.title, summary: input.summary, startDate: input.startDate, structure }, coachId, { actorId: actor.id, templateCoachId: coachId, by: 'admin' });
}

export function adminUpdateProgramDraft(ctx: Ctx, id: string, patch: { title?: string; summary?: string; startDate?: string; structure?: ProgramStructure }) {
  const { p, editor } = programForAdmin(ctx, id);
  return updateDraft(ctx, p, patch, editor);
}

export function adminPublishProgram(ctx: Ctx, id: string, startDate?: string) {
  return ctx.db.tx(() => { const { p, editor } = programForAdmin(ctx, id); return publishDraft(ctx, p, startDate, editor); });
}

export function adminArchiveProgram(ctx: Ctx, id: string, reason: string) {
  requireMembersManage(ctx);
  if (!reason || reason.trim().length < 3) throw errors.badRequest('Say why: the reason is recorded in the audit log', 'REASON_REQUIRED');
  return ctx.db.tx(() => { const { p, editor } = programForAdmin(ctx, id); return archive(ctx, p, reason, editor); });
}

/** The programmes of the members the calling coach is assigned to (optionally one member), newest first. */
export function listCoachPrograms(ctx: Ctx, opts: { memberId?: string } = {}) {
  const actor = requireCoach(ctx);
  const params: string[] = [actor.id];
  let extra = '';
  if (opts.memberId) { extra = 'AND p.member_id = ?'; params.push(opts.memberId); }
  return ctx.db.all<{ id: string }>(`SELECT p.id FROM workout_programs p JOIN coach_assignments a ON a.member_id = p.member_id AND a.coach_id = ? AND a.status IN ('active','paused') ${extra} GROUP BY p.id ORDER BY p.updated_at DESC LIMIT 200`, params).map((r) => presentProgram(ctx, r.id));
}

export function getProgramForCoach(ctx: Ctx, id: string) { programForCoach(ctx, id); return presentProgram(ctx, id); }

/* ---------- sessions ---------- */

type SessionRow = { id: string; program_id: string; program_version_id: string; member_id: string; template_id: string | null; title: string; week: number; day: number; scheduled_date: string; status: 'scheduled' | 'completed' | 'partial' | 'skipped'; completed_at: string | null; duration_minutes: number | null; rpe: number | null; member_note: string | null; skip_reason: string | null; created_at: string; updated_at: string; program_title: string; program_status: string; version: number; coach_name: string; item_count?: number; sets_prescribed?: number; sets_done?: number; feedback_count?: number };
type SessionItemRow = { id: string; session_id: string; exercise_id: string | null; exercise_name: string; exercise_category: string; exercise_instructions: string; exercise_description: string; exercise_muscles: string; exercise_equipment: string; exercise_safety: string; block: string; sort: number; sets: number; reps: string | null; duration_seconds: number | null; rest_seconds: number | null; load_note: string; note: string };
type SetLogRow = { id: string; session_id: string; item_id: string; set_number: number; reps_done: number | null; duration_seconds: number | null; load_kg: number | null; completed: number; created_at: string };

const SESSION_SELECT = `SELECT s.*, p.title AS program_title, p.status AS program_status, v.version AS version, c.name AS coach_name,
  (SELECT COUNT(*) FROM workout_session_items i WHERE i.session_id = s.id) AS item_count,
  (SELECT COALESCE(SUM(i.sets), 0) FROM workout_session_items i WHERE i.session_id = s.id) AS sets_prescribed,
  (SELECT COUNT(*) FROM workout_set_logs l WHERE l.session_id = s.id AND l.completed = 1) AS sets_done,
  (SELECT COUNT(*) FROM coach_notes n WHERE n.ref_type = 'workout_session' AND n.ref_id = s.id AND n.visibility = 'client') AS feedback_count
  FROM workout_sessions s JOIN workout_programs p ON p.id = s.program_id JOIN workout_program_versions v ON v.id = s.program_version_id JOIN users c ON c.id = p.coach_id`;

/** One session for a list. `health` false leaves out the health detail (sets done, effort, duration, notes). */
function presentSession(r: SessionRow, health: boolean) {
  return {
    id: r.id, programId: r.program_id, programTitle: r.program_title, programStatus: r.program_status, version: r.version, coachName: r.coach_name,
    templateId: r.template_id, title: r.title, week: r.week, day: r.day, scheduledDate: r.scheduled_date, status: r.status, completedAt: r.completed_at,
    itemCount: r.item_count ?? 0, feedbackCount: r.feedback_count ?? 0,
    ...(health ? { setsPrescribed: r.sets_prescribed ?? 0, setsDone: r.sets_done ?? 0, durationMinutes: r.duration_minutes, rpe: r.rpe, memberNote: r.member_note, skipReason: r.skip_reason } : {}),
    healthWithheld: !health,
  };
}
export type SessionView = ReturnType<typeof presentSession>;

function sessionRow(ctx: Ctx, id: string): SessionRow | undefined { return ctx.db.get<SessionRow>(`${SESSION_SELECT} WHERE s.id = ?`, [id]); }

/** One session in full: the prescription (items), and the set logs, effort and notes when the caller may see health
 *  detail; the coach's feedback. Members see only their own sessions; a coach their assigned clients'. */
export function sessionDetail(ctx: Ctx, id: string, opts: { audit?: boolean } = {}) {
  const r = sessionRow(ctx, id);
  if (!r) throw errors.notFound('Workout session');
  const actor = ctx.actor;
  if (!actor) throw errors.unauthorised();
  if (actor.role === 'member' && actor.id !== r.member_id) throw errors.notFound('Workout session');
  if (actor.role === 'coach' && !coachHasMember(ctx, actor.id, r.member_id)) throw errors.notFound('Workout session');
  requireMemberAccess(ctx, r.member_id);
  const health = healthShared(ctx, r.member_id);
  // the item's frozen text, and its exercise's current clip (a clip withdrawn after review leaves every session at once)
  const items = ctx.db.all<SessionItemRow & { media_ref: string | null }>('SELECT i.*, e.media_ref FROM workout_session_items i LEFT JOIN exercises e ON e.id = i.exercise_id WHERE i.session_id = ? ORDER BY i.sort', [id]);
  const logs = health ? ctx.db.all<SetLogRow>('SELECT * FROM workout_set_logs WHERE session_id = ? ORDER BY set_number', [id]) : [];
  const feedback = ctx.db.all<{ id: string; body: string; created_at: string; coach_name: string }>("SELECT n.id, n.body, n.created_at, u.name AS coach_name FROM coach_notes n JOIN users u ON u.id = n.coach_id WHERE n.ref_type = 'workout_session' AND n.ref_id = ? AND n.member_id = ? AND n.visibility = 'client' ORDER BY n.created_at", [id, r.member_id]);
  if (opts.audit && health && actor.role !== 'member') audit(ctx, 'health.viewed', { type: 'user', id: r.member_id }, null, { by: actor.role, what: 'workout-session', sessionId: id });
  return {
    ...presentSession(r, health),
    memberId: r.member_id,
    items: items.map((i) => ({
      id: i.id, exerciseId: i.exercise_id, exerciseName: i.exercise_name, exerciseCategory: i.exercise_category, instructions: i.exercise_instructions,
      description: i.exercise_description, muscleGroups: j.out<string[]>(i.exercise_muscles, []), equipment: j.out<string[]>(i.exercise_equipment, []), safetyNotes: i.exercise_safety,
      media: exerciseMedia.mediaFor(ctx, i.media_ref),
      block: i.block, sort: i.sort, sets: i.sets, reps: i.reps, durationSeconds: i.duration_seconds, restSeconds: i.rest_seconds, loadNote: i.load_note, note: i.note,
      ...(health ? { logs: logs.filter((l) => l.item_id === i.id).map((l) => ({ setNumber: l.set_number, repsDone: l.reps_done, durationSeconds: l.duration_seconds, loadKg: l.load_kg, completed: !!l.completed })) } : {}),
    })),
    feedback: feedback.map((f) => ({ id: f.id, body: f.body, createdAt: f.created_at, coachName: f.coach_name })),
    media: mediaStatus(ctx),
    today: todayIst(ctx), // a session still scheduled before this date reads "Not logged"
  };
}

export type SetLogInput = { itemId: string; setNumber: number; repsDone?: number | null; durationSeconds?: number | null; loadKg?: number | null; completed?: boolean };

/** The member's own session only (others: not found), on a programme that is still live. */
function ownSession(ctx: Ctx, memberId: string, id: string): SessionRow {
  const r = sessionRow(ctx, id);
  if (!r || r.member_id !== memberId || ctx.actor?.role !== 'member' || ctx.actor.id !== memberId) throw errors.notFound('Workout session');
  if (r.program_status !== 'published') throw errors.state('This programme was closed, so the session can no longer be changed', { code: 'PROGRAM_CLOSED' });
  return r;
}

/** Log a session: the sets done (optional), the effort rating, the duration and a note. Every prescribed set done (or
 *  nothing logged set by set) is completed; some sets is partial. Logging again replaces the earlier log. */
export function completeSession(ctx: Ctx, memberId: string, id: string, input: { sets?: SetLogInput[]; rpe?: number | null; durationMinutes?: number | null; note?: string }) {
  return ctx.db.tx(() => {
    const r = ownSession(ctx, memberId, id);
    const items = ctx.db.all<SessionItemRow>('SELECT * FROM workout_session_items WHERE session_id = ?', [id]);
    const byId = new Map(items.map((i) => [i.id, i]));
    const sets = input.sets ?? [];
    const seen = new Set<string>();
    for (const s of sets) {
      const item = byId.get(s.itemId);
      if (!item) throw errors.validation([{ path: 'sets', message: `Set ${s.setNumber}: that exercise is not part of this session` }], 'A set refers to an exercise that is not part of this session');
      const key = `${s.itemId}|${s.setNumber}`;
      if (seen.has(key)) throw errors.validation([{ path: 'sets', message: `${item.exercise_name}: set ${s.setNumber} appears twice` }], `${item.exercise_name}: set ${s.setNumber} appears twice`);
      seen.add(key);
    }
    const done = new Set(sets.filter((s) => s.completed !== false).map((s) => `${s.itemId}|${s.setNumber}`));
    const prescribed = items.flatMap((i) => Array.from({ length: i.sets }, (_, k) => `${i.id}|${k + 1}`));
    const status: 'completed' | 'partial' = sets.length === 0 || prescribed.every((k) => done.has(k)) ? 'completed' : 'partial';
    if (sets.length && done.size === 0) throw errors.badRequest('No set is marked done: skip the session instead, or mark the sets you did', 'NOTHING_DONE');
    const now = ctx.now();
    const edited = r.status !== 'scheduled';
    ctx.db.run('DELETE FROM workout_set_logs WHERE session_id = ?', [id]);
    for (const s of sets) ctx.db.insert('workout_set_logs', { id: newId.setLog(), session_id: id, item_id: s.itemId, set_number: s.setNumber, reps_done: s.repsDone ?? null, duration_seconds: s.durationSeconds ?? null, load_kg: s.loadKg ?? null, completed: s.completed === false ? 0 : 1, created_at: now });
    ctx.db.update('workout_sessions', id, { status, completed_at: r.status === 'completed' || r.status === 'partial' ? r.completed_at ?? now : now, duration_minutes: input.durationMinutes ?? null, rpe: input.rpe ?? null, member_note: input.note?.trim() || null, skip_reason: null, updated_at: now });
    // the audit row records what happened, not the health detail itself
    audit(ctx, 'workout_session.complete', { type: 'workout_session', id }, null, { status, setsLogged: sets.length, edited, previous: r.status });
    emit(ctx, 'WorkoutSessionCompleted', { type: 'workout_session', id }, { memberId, status });
    return sessionDetail(ctx, id);
  });
}

/** Skip a scheduled session, with an optional reason (health detail: only a sharing coach sees it). */
export function skipSession(ctx: Ctx, memberId: string, id: string, reason?: string) {
  return ctx.db.tx(() => {
    const r = ownSession(ctx, memberId, id);
    if (r.status !== 'scheduled') throw errors.state(`This session is already ${r.status}`, { code: 'SESSION_NOT_SCHEDULED' });
    const now = ctx.now();
    ctx.db.update('workout_sessions', id, { status: 'skipped', skip_reason: reason?.trim() || null, updated_at: now });
    audit(ctx, 'workout_session.skip', { type: 'workout_session', id }, null, { withReason: !!reason?.trim() });
    return sessionDetail(ctx, id);
  });
}

/** The member's sessions in a date range (default: this week, Monday to Sunday, IST), the live programmes and the
 *  next scheduled session. Sessions of a closed programme show only once they were done. */
export function memberWeek(ctx: Ctx, memberId: string, range: { from?: string; to?: string } = {}) {
  const today = todayIst(ctx);
  const wk = weekOf(today);
  const from = range.from ?? wk.from;
  const to = range.to ?? (range.from ? plusDays(range.from, 6) : wk.to);
  if (to < from) throw errors.badRequest('The range ends before it starts', 'RANGE_INVALID');
  if (daysBetween(from, to) > 92) throw errors.badRequest('Ask for at most 93 days at a time', 'RANGE_TOO_LONG');
  const health = healthShared(ctx, memberId);
  const items = withShape(ctx, ctx.db.all<SessionRow>(`${SESSION_SELECT} WHERE s.member_id = ? AND s.scheduled_date >= ? AND s.scheduled_date <= ? AND ${SHOWN_TO_MEMBER} ORDER BY s.scheduled_date, s.week, s.day`, [memberId, from, to]).map((r) => presentSession(r, health)));
  const next = ctx.db.get<SessionRow>(`${SESSION_SELECT} WHERE s.member_id = ? AND s.status = 'scheduled' AND p.status = 'published' AND s.scheduled_date >= ? ORDER BY s.scheduled_date, s.week, s.day LIMIT 1`, [memberId, today]);
  // "updated" is when the member last got a version (a coach editing a draft revision changes nothing they see)
  const programs = ctx.db.all<{ id: string; title: string; current_version: number; start_date: string | null; coach_name: string; summary: string | null; updated_at: string; published_at: string | null }>("SELECT p.id, p.title, p.current_version, p.start_date, p.updated_at, v.published_at, c.name AS coach_name, v.summary FROM workout_programs p JOIN users c ON c.id = p.coach_id LEFT JOIN workout_program_versions v ON v.program_id = p.id AND v.status = 'published' WHERE p.member_id = ? AND p.status = 'published' ORDER BY COALESCE(v.published_at, p.updated_at) DESC", [memberId])
    .map((p) => ({ id: p.id, title: p.title, version: p.current_version, startDate: p.start_date, coachName: p.coach_name, summary: p.summary ?? '', updatedAt: p.published_at ?? p.updated_at }));
  return { from, to, today, items, programs, next: next ? withShape(ctx, [presentSession(next, health)])[0]! : null, summary: weekSummary(items, today) };
}

/** What a member's session list adds to each session, from its prescription: the library categories of its exercises
 *  in the order they first appear, and the planned minutes only when every exercise has a prescribed duration (sets ×
 *  duration, with the prescribed rest between sets), never an estimate; and the poster of the first exercise's clip
 *  (`coverPosterUrl`, null when it has none), so the app can show the picture the session opens on. */
function withShape<T extends { id: string }>(ctx: Ctx, sessions: T[]): Array<T & { categories: string[]; durationMinutesPlanned: number | null; coverPosterUrl: string | null }> {
  if (!sessions.length) return [];
  const rows = ctx.db.all<{ session_id: string; exercise_category: string; sets: number; duration_seconds: number | null; rest_seconds: number | null; media_ref: string | null }>(`SELECT i.session_id, i.exercise_category, i.sets, i.duration_seconds, i.rest_seconds, e.media_ref FROM workout_session_items i LEFT JOIN exercises e ON e.id = i.exercise_id WHERE i.session_id IN (${sessions.map(() => '?').join(', ')}) ORDER BY i.session_id, i.sort`, sessions.map((x) => x.id));
  const by = new Map<string, typeof rows>();
  for (const r of rows) { const l = by.get(r.session_id) ?? []; l.push(r); by.set(r.session_id, l); }
  return sessions.map((x) => {
    const its = by.get(x.id) ?? [];
    const categories = [...new Set(its.map((i) => i.exercise_category).filter(Boolean))];
    const timed = its.length > 0 && its.every((i) => i.duration_seconds !== null && i.duration_seconds > 0);
    const seconds = timed ? its.reduce((n, i) => n + i.sets * i.duration_seconds! + Math.max(0, i.sets - 1) * (i.rest_seconds ?? 0), 0) : 0;
    return { ...x, categories, durationMinutesPlanned: timed ? Math.ceil(seconds / 60) : null, coverPosterUrl: its[0] ? exerciseMedia.mediaFor(ctx, its[0].media_ref)?.posterUrl ?? null : null };
  });
}

/** Every session in the range is either due so far or still to come: due so far are the sessions dated today or earlier
 *  and any the member already logged or skipped ahead of their date; still to come are the later ones not yet logged. */
export function weekSummary(items: Array<{ scheduledDate: string; status: string }>, today: string) {
  const due = items.filter((s) => s.scheduledDate <= today || s.status !== 'scheduled');
  return {
    due: due.length,
    done: due.filter((s) => s.status === 'completed' || s.status === 'partial').length,
    skipped: due.filter((s) => s.status === 'skipped').length,
    upcoming: items.length - due.length,
  };
}

/** The history's page cursor: the scheduled date and id of the last session on the page ("2026-10-12~wks_…"). */
const HISTORY_CURSOR = /^(\d{4}-\d{2}-\d{2})~([a-z]{3}_[A-Za-z0-9]{6,40})$/;

/** Sessions done, done in part or skipped, by the date they were planned for (the date the history shows), newest
 *  first. A session logged late or early stays at its planned date. */
export function history(ctx: Ctx, memberId: string, opts: { limit?: number; before?: string } = {}) {
  const health = healthShared(ctx, memberId);
  const limit = Math.max(1, Math.min(200, opts.limit ?? 50));
  const params: (string | number)[] = [memberId];
  let extra = '';
  if (opts.before) {
    const m = HISTORY_CURSOR.exec(opts.before);
    if (!m) throw errors.badRequest('before: pass the nextCursor of the previous page', 'CURSOR_INVALID');
    extra = 'AND (s.scheduled_date < ? OR (s.scheduled_date = ? AND s.id < ?))';
    params.push(m[1]!, m[1]!, m[2]!);
  }
  const rows = ctx.db.all<SessionRow>(`${SESSION_SELECT} WHERE s.member_id = ? AND s.status != 'scheduled' ${extra} ORDER BY s.scheduled_date DESC, s.id DESC LIMIT ?`, [...params, limit + 1]);
  const items = withShape(ctx, rows.slice(0, limit).map((r) => presentSession(r, health)));
  const last = rows.length > limit ? rows[limit - 1] : null;
  const totals = ctx.db.get<{ completed: number; partial: number; skipped: number }>("SELECT SUM(status = 'completed') completed, SUM(status = 'partial') partial, SUM(status = 'skipped') skipped FROM workout_sessions WHERE member_id = ?", [memberId])!;
  return { items, nextCursor: last ? `${last.scheduled_date}~${last.id}` : null, totals: { completed: totals.completed ?? 0, partial: totals.partial ?? 0, skipped: totals.skipped ?? 0 } };
}

/** A client's workouts as the assigned coach (or an administrator) sees them: programmes (drafts included), the
 *  schedule and statuses; set logs, effort, duration and notes only while health data is shared. */
export function clientWorkouts(ctx: Ctx, memberId: string) {
  const actor = requireMemberAccess(ctx, memberId);
  if (actor.role === 'member') throw errors.forbidden();
  const health = healthShared(ctx, memberId);
  const programs = ctx.db.all<{ id: string }>('SELECT id FROM workout_programs WHERE member_id = ? ORDER BY CASE status WHEN \'published\' THEN 0 WHEN \'draft\' THEN 1 ELSE 2 END, updated_at DESC', [memberId]).map((r) => presentProgram(ctx, r.id));
  const sessions = ctx.db.all<SessionRow>(`${SESSION_SELECT} WHERE s.member_id = ? ORDER BY s.scheduled_date DESC, s.week DESC, s.day DESC LIMIT 300`, [memberId]).map((r) => presentSession(r, health));
  if (health && sessions.some((s) => s.status !== 'scheduled')) audit(ctx, 'health.viewed', { type: 'user', id: memberId }, null, { by: actor.role, what: 'workout-logs' });
  return { memberId, healthShared: health, programs, sessions, today: todayIst(ctx) };
}

/** Coach feedback on a session the member logged or skipped: a client-visible review note on the session. Needs the
 *  member's coach_sharing consent, because feedback answers the health detail. */
export function giveFeedback(ctx: Ctx, sessionId: string, body: string) {
  const actor = requireCoach(ctx);
  const r = sessionRow(ctx, sessionId);
  if (!r || !coachHasMember(ctx, actor.id, r.member_id)) throw errors.notFound('Workout session');
  requireHealthAccess(ctx, r.member_id);
  if (r.status === 'scheduled') throw errors.state('Feedback follows a logged or skipped session; this one is still scheduled', { code: 'SESSION_NOT_LOGGED' });
  const noteId = randomId('cnt');
  ctx.db.insert('coach_notes', { id: noteId, coach_id: actor.id, member_id: r.member_id, kind: 'review', visibility: 'client', author_role: 'coach', body: body.trim(), ref_type: 'workout_session', ref_id: sessionId, created_at: ctx.now() });
  audit(ctx, 'workout_session.feedback', { type: 'workout_session', id: sessionId }, null, { noteId, memberId: r.member_id });
  notify(ctx, { userId: r.member_id, category: 'workout', title: 'Feedback on your workout', body: `Your coach replied to ${r.title}. Read it with the session.`, data: { sessionId, noteId }, sensitive: true });
  return sessionDetail(ctx, sessionId);
}

/** Sessions the coach's clients logged in the last days that have no feedback yet (status only, no health detail).
 *  Each row says whether that client shares health data: feedback needs it, so the portal offers Review only then and
 *  otherwise says the records are not shared, as the other coach cards do. */
export function coachRecent(ctx: Ctx, days = 7) {
  const actor = requireCoach(ctx);
  const since = addDays(ctx.now(), -days);
  const rows = ctx.db.all<{ id: string; title: string; status: string; scheduled_date: string; completed_at: string | null; member_id: string; member_name: string }>(`SELECT s.id, s.title, s.status, s.scheduled_date, s.completed_at, s.member_id, u.name AS member_name FROM workout_sessions s JOIN users u ON u.id = s.member_id
    WHERE s.status IN ('completed','partial') AND s.completed_at >= ?
      AND EXISTS (SELECT 1 FROM coach_assignments a WHERE a.member_id = s.member_id AND a.coach_id = ? AND a.status IN ('active','paused'))
      AND NOT EXISTS (SELECT 1 FROM coach_notes n WHERE n.ref_type = 'workout_session' AND n.ref_id = s.id)
    ORDER BY s.completed_at DESC LIMIT 50`, [since, actor.id]);
  const shared = new Map<string, boolean>();
  const sharing = (memberId: string) => { if (!shared.has(memberId)) shared.set(memberId, healthShared(ctx, memberId)); return shared.get(memberId)!; };
  return { days, items: rows.map((r) => ({ id: r.id, title: r.title, status: r.status, scheduledDate: r.scheduled_date, completedAt: r.completed_at, memberId: r.member_id, memberName: r.member_name, healthShared: sharing(r.member_id) })) };
}

/* ---------- adherence and reassignment ---------- */

/** Sessions due in the range, counted as the member's week counts them (weekSummary over memberWeek's sessions): the
 *  sessions the member's screens show (SHOWN_TO_MEMBER: of a closed programme only the ones logged or skipped) that are
 *  dated on or before today or were already logged or skipped ahead of their date, and how many were done or done in
 *  part. */
export function adherence(ctx: Ctx, memberId: string, range: { from: string; to: string }) {
  const today = todayIst(ctx);
  const from = range.from.slice(0, 10);
  const to = range.to.slice(0, 10);
  const row = ctx.db.get<{ due: number; done: number }>(`SELECT COUNT(*) due, COALESCE(SUM(s.status IN ('completed','partial')), 0) done FROM workout_sessions s JOIN workout_programs p ON p.id = s.program_id WHERE s.member_id = ? AND s.scheduled_date >= ? AND s.scheduled_date <= ? AND (s.scheduled_date <= ? OR s.status != 'scheduled') AND ${SHOWN_TO_MEMBER}`, [memberId, from, to, today]);
  const due = row?.due ?? 0, done = row?.done ?? 0;
  return { key: 'workouts', label: 'Workouts', due, done, pct: due ? Math.round((100 * done) / due) : null, note: 'Sessions due so far in the range, and any logged or skipped ahead of their date; a session done in part counts as done, a skipped one does not. Once a coach closes a programme, only the sessions logged or skipped in it count.' };
}

/* ---------- the member's data export (ApiModule.exportSections, read by api/domain/dataExport.ts buildArchive) ---------- */

/** The workout programmes the member was given, as their Workouts page shows them: the version their coach published
 *  (title, summary, start date, the coach's name), whether it is still live, when it was published and when it closed,
 *  and who closed it, worded as the notification at closing was (archive above): the role on the programme's archive
 *  audit row, so a programme an administrator closed reads "closed by the Bioptime team", one its coach closed "closed by
 *  your coach". Never a draft revision, a programme that was never published, the weekly structure the coach works from,
 *  or ids. */
export function exportProgramsForMember(ctx: Ctx, memberId: string) {
  return ctx.db.all<{ title: string; status: string; current_version: number; start_date: string | null; archived_at: string | null; coach_name: string; summary: string; published_at: string | null; closed_by_role: string | null }>(
    "SELECT p.title, p.status, p.current_version, p.start_date, p.archived_at, c.name AS coach_name, v.summary, v.published_at, (SELECT a.actor_role FROM audit_events a WHERE a.target_type = 'workout_program' AND a.target_id = p.id AND a.action = 'workout_program.archive' ORDER BY a.at DESC, a.rowid DESC LIMIT 1) AS closed_by_role FROM workout_programs p JOIN users c ON c.id = p.coach_id JOIN workout_program_versions v ON v.program_id = p.id AND v.status = 'published' WHERE p.member_id = ? ORDER BY v.published_at, p.created_at",
    [memberId],
  ).map((p) => ({ title: p.title, state: p.status === 'published' ? 'live' : p.closed_by_role === 'admin' || p.closed_by_role === 'owner' ? 'closed by the Bioptime team' : 'closed by your coach', version: p.current_version, coachName: p.coach_name, summary: p.summary, startDate: p.start_date, publishedAt: p.published_at, closedAt: p.status === 'archived' ? p.archived_at : null }));
}

/** The member's sessions, as their Workouts pages show them: every session of a live programme and every one they
 *  logged or skipped (also of a closed programme), with the exercises as prescribed, their own set logs, effort,
 *  duration, note or skip reason, and the feedback their coach sent them. Never a coach's private notes, other people's
 *  records, the audit trail or ids. */
export function exportSessionsForMember(ctx: Ctx, memberId: string) {
  const rows = ctx.db.all<SessionRow>(`${SESSION_SELECT} WHERE s.member_id = ? AND ${SHOWN_TO_MEMBER} ORDER BY s.scheduled_date, s.week, s.day, s.id`, [memberId]);
  return rows.map((r) => {
    const items = ctx.db.all<SessionItemRow>('SELECT * FROM workout_session_items WHERE session_id = ? ORDER BY sort', [r.id]);
    const logs = ctx.db.all<SetLogRow>('SELECT * FROM workout_set_logs WHERE session_id = ? ORDER BY set_number', [r.id]);
    const feedback = ctx.db.all<{ body: string; created_at: string; coach_name: string }>("SELECT n.body, n.created_at, u.name AS coach_name FROM coach_notes n JOIN users u ON u.id = n.coach_id WHERE n.ref_type = 'workout_session' AND n.ref_id = ? AND n.member_id = ? AND n.visibility = 'client' ORDER BY n.created_at", [r.id, memberId]);
    return {
      programme: r.program_title, version: r.version, title: r.title, week: r.week, day: r.day, plannedFor: r.scheduled_date,
      status: r.status, loggedAt: r.completed_at, durationMinutes: r.duration_minutes, effort: r.rpe, yourNote: r.member_note, skipReason: r.skip_reason,
      exercises: items.map((i) => ({
        exercise: i.exercise_name, category: i.exercise_category, instructions: i.exercise_instructions, block: i.block,
        sets: i.sets, reps: i.reps, durationSeconds: i.duration_seconds, restSeconds: i.rest_seconds, loadNote: i.load_note, note: i.note,
        yourSets: logs.filter((l) => l.item_id === i.id).map((l) => ({ set: l.set_number, repsDone: l.reps_done, durationSeconds: l.duration_seconds, loadKg: l.load_kg, done: !!l.completed })),
      })),
      feedbackFromYourCoach: feedback.map((f) => ({ from: f.coach_name, body: f.body, at: f.created_at })),
    };
  });
}

/** When a member is assigned to another coach, the new coach takes over the member's open programmes. */
export function onCoachAssigned(ctx: Ctx, memberId: string, coachId: string) {
  const open = ctx.db.all<{ id: string; coach_id: string }>("SELECT id, coach_id FROM workout_programs WHERE member_id = ? AND status IN ('draft','published') AND coach_id != ?", [memberId, coachId]);
  for (const p of open) {
    ctx.db.update('workout_programs', p.id, { coach_id: coachId, updated_at: ctx.now() });
    audit(ctx, 'workout_program.reassign', { type: 'workout_program', id: p.id }, 'The member was assigned to another coach', { from: p.coach_id, to: coachId });
  }
  return open.length;
}

/* ---------- members: the published library and personal records ---------- */

/** An exercise as a member reads it: the published text and its clip, nothing about who wrote it. */
function presentForMember(ctx: Ctx, r: ExerciseRow) {
  return {
    id: r.id, name: r.name, category: r.category, description: r.description, instructions: r.instructions,
    muscleGroups: j.out<string[]>(r.muscle_groups, []), equipment: j.out<string[]>(r.equipment, []), safetyNotes: r.safety_notes ?? '',
    media: exerciseMedia.mediaFor(ctx, r.media_ref),
  };
}

/** The library page cursor: the name and id of the last exercise on the page, opaque to the caller. */
function libraryCursor(r: { name: string; id: string }): string { return Buffer.from(JSON.stringify([r.name, r.id])).toString('base64url'); }
function readLibraryCursor(cursor: string): [string, string] {
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'string') return [v[0], v[1]];
  } catch { /* refused below */ }
  throw errors.badRequest('cursor: pass the nextCursor of the previous page', 'CURSOR_INVALID');
}

/** The exercise library as members see it (GET /me/exercises): published exercises only (a coach's proposal joins it
 *  once an administrator publishes it), by category or words in the name, description, muscle groups or equipment, a
 *  page at a time in name order, with the media status. */
export function memberExercises(ctx: Ctx, opts: { category?: string; q?: string; cursor?: string; limit?: number } = {}) {
  requireRole(ctx, 'member');
  const limit = Math.max(1, Math.min(100, opts.limit ?? 50));
  const where = ["e.status = 'published'"];
  const params: string[] = [];
  if (opts.category) { where.push('e.category = ?'); params.push(opts.category); }
  if (opts.q) { const like = `%${opts.q}%`; where.push('(e.name LIKE ? OR e.description LIKE ? OR e.muscle_groups LIKE ? OR e.equipment LIKE ?)'); params.push(like, like, like, like); }
  if (opts.cursor) { const [name, id] = readLibraryCursor(opts.cursor); where.push('(e.name > ? OR (e.name = ? AND e.id > ?))'); params.push(name, name, id); }
  const rows = ctx.db.all<ExerciseRow>(`SELECT e.* FROM exercises e WHERE ${where.join(' AND ')} ORDER BY e.name, e.id LIMIT ?`, [...params, limit + 1]);
  const page = rows.slice(0, limit);
  return { items: page.map((r) => presentForMember(ctx, r)), nextCursor: rows.length > limit ? libraryCursor(page[page.length - 1]!) : null, media: exerciseMedia.status(ctx) };
}

/** One published exercise for a member (GET /me/exercises/:id); drafts and archived ones are not found. */
export function memberExercise(ctx: Ctx, id: string) {
  requireRole(ctx, 'member');
  const r = ctx.db.get<ExerciseRow>("SELECT * FROM exercises WHERE id = ? AND status = 'published'", [id]);
  if (!r) throw errors.notFound('Exercise');
  return { ...presentForMember(ctx, r), mediaStatus: exerciseMedia.status(ctx) };
}

type RecordLog = { exercise_id: string | null; exercise_name: string; exercise_category: string; load_kg: number | null; reps_done: number | null; duration_seconds: number | null; completed_at: string | null; scheduled_date: string };

/** The member's personal records (GET /me/workouts/records), from the sets they marked done in sessions they completed
 *  or completed in part (a skipped session counts for nothing, and only their own logs are read): per exercise the
 *  heaviest load with its reps, the most reps without a load and the longest timed set, each with the day it was first
 *  reached (India date); the week with most sessions done; and, while habits are on for them, their longest current
 *  habit streak as GET /me/habits shows it. Nothing is estimated (no one-rep maximum, no calories). */
export function memberRecords(ctx: Ctx, memberId: string) {
  const logs = ctx.db.all<RecordLog>(`SELECT i.exercise_id, i.exercise_name, i.exercise_category, l.load_kg, l.reps_done, l.duration_seconds, s.completed_at, s.scheduled_date
    FROM workout_set_logs l JOIN workout_session_items i ON i.id = l.item_id JOIN workout_sessions s ON s.id = l.session_id
    WHERE s.member_id = ? AND s.status IN ('completed', 'partial') AND l.completed = 1
    ORDER BY COALESCE(s.completed_at, s.scheduled_date), l.set_number`, [memberId]);
  type Rec = { exerciseId: string | null; name: string; category: string; bestLoadKg: { value: number; reps: number | null; date: string } | null; bestReps: { value: number; date: string } | null; longestDurationSeconds: { value: number; date: string } | null };
  const byExercise = new Map<string, Rec>();
  for (const l of logs) {
    const key = l.exercise_id ?? `name:${l.exercise_name}`;
    const rec = byExercise.get(key) ?? { exerciseId: l.exercise_id, name: l.exercise_name, category: l.exercise_category, bestLoadKg: null, bestReps: null, longestDurationSeconds: null };
    rec.name = l.exercise_name; // the latest name it was given under
    const date = l.completed_at ? dateInZone(l.completed_at) : l.scheduled_date;
    // logs come oldest first, so a record is replaced only when beaten: each keeps the day it was first reached
    if (l.load_kg !== null && l.load_kg > 0) {
      const b = rec.bestLoadKg;
      if (!b || l.load_kg > b.value || (l.load_kg === b.value && (l.reps_done ?? 0) > (b.reps ?? 0))) rec.bestLoadKg = { value: l.load_kg, reps: l.reps_done, date };
    } else if (l.reps_done !== null && l.reps_done > 0 && (!rec.bestReps || l.reps_done > rec.bestReps.value)) rec.bestReps = { value: l.reps_done, date };
    if (l.duration_seconds !== null && l.duration_seconds > 0 && (!rec.longestDurationSeconds || l.duration_seconds > rec.longestDurationSeconds.value)) rec.longestDurationSeconds = { value: l.duration_seconds, date };
    byExercise.set(key, rec);
  }
  const exercises = [...byExercise.values()].filter((r) => r.bestLoadKg || r.bestReps || r.longestDurationSeconds).sort((a, b) => a.name.localeCompare(b.name));

  // sessions done (in full or in part) by the India week they were done in, Monday first; the first such week wins a tie
  const done = ctx.db.all<{ completed_at: string | null; scheduled_date: string }>("SELECT completed_at, scheduled_date FROM workout_sessions WHERE member_id = ? AND status IN ('completed', 'partial') ORDER BY COALESCE(completed_at, scheduled_date)", [memberId]);
  const weeks = new Map<string, number>();
  for (const s of done) { const w = weekOf(s.completed_at ? dateInZone(s.completed_at) : s.scheduled_date).from; weeks.set(w, (weeks.get(w) ?? 0) + 1); }
  let most: { count: number; weekOf: string } | null = null;
  for (const [w, n] of [...weeks.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) if (!most || n > most.count) most = { count: n, weekOf: w };

  let bestHabitStreak: { count: number; unit: 'days' | 'weeks'; habitId: string; title: string } | null = null;
  if (isEnabledFor(ctx, 'habits')) {
    for (const h of listHabits(ctx, memberId).items) {
      if (h.streak.count > 0 && (!bestHabitStreak || h.streak.count > bestHabitStreak.count)) bestHabitStreak = { count: h.streak.count, unit: h.streak.unit, habitId: h.id, title: h.title };
    }
  }
  return {
    exercises, mostSessionsInAWeek: most, sessionsDone: done.length, bestHabitStreak,
    note: 'From the sets you marked done in sessions you logged. Skipped sessions do not count, and nothing is estimated. A habit streak is your longest current one.',
  };
}
