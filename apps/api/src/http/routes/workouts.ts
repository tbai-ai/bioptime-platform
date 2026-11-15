/* M6 Workouts routes, registered by the module descriptor (api/modules/workouts.ts) inside /api. Every route declares
   auth, the feature flag 'workouts' and, for administrators, a permission; every coach response passes the field policy
   guard; health detail (set logs, effort, duration, notes) reaches a coach only while the member shares it. Members read
   the published library and their own records; only administrators map an exercise to a clip (mediaRef). */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  EXERCISE_CATEGORIES, LIBRARY_SOURCES, LIBRARY_STATUSES,
  adminExerciseCreateSchema, adminExercisePatchSchema, adminProgramCreateSchema, adminTemplateCreateSchema, coachTemplatePatchSchema, exerciseInputSchema,
  libraryStatusSchema, memberExerciseQuerySchema, programArchiveSchema, programCreateSchema, programPatchSchema, programPublishSchema,
  sessionCompleteSchema, sessionFeedbackSchema, sessionSkipSchema, templateInputSchema, templatePatchSchema, workoutRangeQuerySchema,
} from '@bioptime/domain/modules/workouts';
import type { Ctx } from '../../context.js';
import { parse } from '../../lib/validate.js';
import { errors } from '../../lib/errors.js';
import { def, param, query } from '../route.js';
import { coachHasMember } from '../../auth/permissions.js';
import { coachSafe as policyCoachSafe } from '../../auth/fieldPolicy.js';
import * as w from '../../domain/workouts.js';

const FEATURE = 'workouts';
const TAG = 'workouts';
const WRITE_LIMIT = { max: 60, timeWindow: '10 minutes' };

/** Every coach response passes the field policy's safety net (coachSafe in auth/fieldPolicy.ts): it looks at the
 *  payload as built, reports any restricted key a presenter produced (paths only, never values) and sends the payload
 *  without it. */
function coachSafe<T>(ctx: Ctx, payload: T): T {
  return policyCoachSafe(ctx, payload, 'workouts coach route');
}

const me = (req: FastifyRequest) => req.ctx.actor!.id;
const exerciseQuery = z.object({ q: z.string().max(80).optional(), category: z.enum(EXERCISE_CATEGORIES).optional(), status: z.enum(LIBRARY_STATUSES).optional(), source: z.enum(LIBRARY_SOURCES).optional() });
const templateQuery = z.object({ status: z.enum(LIBRARY_STATUSES).optional(), source: z.enum(LIBRARY_SOURCES).optional(), includeArchived: z.enum(['0', '1']).optional() });
const historyQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).optional(), before: z.string().max(40).optional() });
const programListQuery = z.object({ memberId: z.string().max(64).optional() });
const recentQuery = z.object({ days: z.coerce.number().int().min(1).max(31).optional() });
const memberTemplatesQuery = z.object({ programId: z.string().min(1).max(64).optional() });
/** A status in an administrator's template edit is refused with a pointer to the status route (which records a reason). */
const adminTemplatePatchSchema = templatePatchSchema.extend({ status: z.enum(LIBRARY_STATUSES).optional() });

export function workoutRoutes(app: FastifyInstance): void {
  /* ---------- member ---------- */
  def(app, { method: 'GET', path: '/me/workouts', summary: 'My workout sessions in a date range (default this week, IST), my live programmes and the next session', tag: TAG, auth: 'member', feature: FEATURE, query: workoutRangeQuerySchema }, async (req) => w.memberWeek(req.ctx, me(req), parse(workoutRangeQuerySchema, query(req))));
  def(app, { method: 'GET', path: '/me/workouts/records', summary: 'My personal records from the sets I marked done (heaviest load with its reps, most reps, longest timed set per exercise), my busiest week and, with habits on, my longest current habit streak; nothing estimated', tag: TAG, auth: 'member', feature: FEATURE }, async (req) => w.memberRecords(req.ctx, me(req)));
  def(app, { method: 'GET', path: '/me/exercises', summary: 'The published exercise library: text, safety notes and the clip when exercise media are served; by category or words, a page at a time (cursor)', tag: TAG, auth: 'member', feature: FEATURE, query: memberExerciseQuerySchema }, async (req) => w.memberExercises(req.ctx, parse(memberExerciseQuerySchema, query(req))));
  def(app, { method: 'GET', path: '/me/exercises/:id', summary: 'One published exercise with its clip (when exercise media are served)', tag: TAG, auth: 'member', feature: FEATURE }, async (req) => w.memberExercise(req.ctx, param(req, 'id')));
  def(app, { method: 'GET', path: '/me/workouts/history', summary: 'Sessions I completed, completed in part or skipped, newest first', tag: TAG, auth: 'member', feature: FEATURE, query: historyQuery }, async (req) => w.history(req.ctx, me(req), parse(historyQuery, query(req))));
  def(app, { method: 'GET', path: '/me/workouts/:id', summary: 'One of my sessions: exercises, my set logs, effort and notes, my coach’s feedback', tag: TAG, auth: 'member', feature: FEATURE }, async (req) => w.sessionDetail(req.ctx, param(req, 'id')));
  def(app, { method: 'POST', path: '/me/workouts/:id/complete', summary: 'Log a session: sets done, effort (RPE 1 to 10), duration and a note; logging again replaces the earlier log', tag: TAG, auth: 'member', feature: FEATURE, rateLimit: { max: 120, timeWindow: '10 minutes' }, body: sessionCompleteSchema }, async (req) => w.completeSession(req.ctx, me(req), param(req, 'id'), parse(sessionCompleteSchema, req.body)));
  def(app, { method: 'POST', path: '/me/workouts/:id/skip', summary: 'Skip a scheduled session, with an optional reason', tag: TAG, auth: 'member', feature: FEATURE, rateLimit: { max: 120, timeWindow: '10 minutes' }, body: sessionSkipSchema }, async (req) => w.skipSession(req.ctx, me(req), param(req, 'id'), parse(sessionSkipSchema, req.body).reason));

  /* ---------- coach: library and templates ---------- */
  def(app, { method: 'GET', path: '/coach/exercise-library', summary: 'The exercise library: published exercises and my own drafts, with each clip and the exercise media status', tag: TAG, auth: 'coach', feature: FEATURE, query: exerciseQuery }, async (req) => {
    const q = parse(exerciseQuery, query(req));
    return coachSafe(req.ctx, { items: w.listExercises(req.ctx, { q: q.q, category: q.category }), media: w.mediaStatus(req.ctx) });
  });
  def(app, { method: 'POST', path: '/coach/exercises', summary: 'Propose an exercise: a draft until an administrator publishes it', tag: TAG, auth: 'coach', feature: FEATURE, rateLimit: WRITE_LIMIT, body: exerciseInputSchema }, async (req, reply) => { const out = w.proposeExercise(req.ctx, parse(exerciseInputSchema, req.body)); reply.code(201); return coachSafe(req.ctx, out); });
  def(app, { method: 'GET', path: '/coach/workout-templates', summary: 'Published team templates and my own', tag: TAG, auth: 'coach', feature: FEATURE, query: templateQuery }, async (req) => { const q = parse(templateQuery, query(req)); return coachSafe(req.ctx, { items: w.listTemplates(req.ctx, { includeArchived: q.includeArchived === '1' }) }); });
  def(app, { method: 'POST', path: '/coach/workout-templates', summary: 'Create my own workout template', tag: TAG, auth: 'coach', feature: FEATURE, rateLimit: WRITE_LIMIT, body: templateInputSchema }, async (req, reply) => { const out = w.createCoachTemplate(req.ctx, parse(templateInputSchema, req.body)); reply.code(201); return coachSafe(req.ctx, out); });
  def(app, { method: 'GET', path: '/coach/workout-templates/:id', summary: 'One template with its exercises', tag: TAG, auth: 'coach', feature: FEATURE }, async (req) => coachSafe(req.ctx, w.getTemplate(req.ctx, param(req, 'id'))));
  def(app, { method: 'PATCH', path: '/coach/workout-templates/:id', summary: 'Edit, archive or restore my own template', tag: TAG, auth: 'coach', feature: FEATURE, rateLimit: WRITE_LIMIT, body: coachTemplatePatchSchema }, async (req) => coachSafe(req.ctx, w.updateTemplate(req.ctx, param(req, 'id'), parse(coachTemplatePatchSchema, req.body))));

  /* ---------- coach: programmes ---------- */
  def(app, { method: 'GET', path: '/coach/workout-programs', summary: 'Workout programmes of my assigned clients (drafts included)', tag: TAG, auth: 'coach', feature: FEATURE, query: programListQuery }, async (req) => coachSafe(req.ctx, { items: w.listCoachPrograms(req.ctx, parse(programListQuery, query(req))) }));
  def(app, { method: 'POST', path: '/coach/workout-programs', summary: 'Create a draft workout programme for an assigned client', tag: TAG, auth: 'coach', feature: FEATURE, rateLimit: WRITE_LIMIT, body: programCreateSchema }, async (req, reply) => { const out = w.createProgram(req.ctx, parse(programCreateSchema, req.body)); reply.code(201); return coachSafe(req.ctx, out); });
  def(app, { method: 'GET', path: '/coach/workout-programs/:id', summary: 'One programme: versions, the draft, session counts', tag: TAG, auth: 'coach', feature: FEATURE }, async (req) => coachSafe(req.ctx, w.getProgramForCoach(req.ctx, param(req, 'id'))));
  def(app, { method: 'PATCH', path: '/coach/workout-programs/:id', summary: 'Edit the draft version (a published programme gets a new draft)', tag: TAG, auth: 'coach', feature: FEATURE, rateLimit: WRITE_LIMIT, body: programPatchSchema }, async (req) => coachSafe(req.ctx, w.updateProgramDraft(req.ctx, param(req, 'id'), parse(programPatchSchema, req.body))));
  def(app, { method: 'POST', path: '/coach/workout-programs/:id/publish', summary: 'Publish the draft: generates the member’s sessions once, keeps sessions already done, notifies the member', tag: TAG, auth: 'coach', feature: FEATURE, rateLimit: WRITE_LIMIT, body: programPublishSchema }, async (req) => coachSafe(req.ctx, w.publishProgram(req.ctx, param(req, 'id'), parse(programPublishSchema, req.body ?? {}).startDate)));
  def(app, { method: 'POST', path: '/coach/workout-programs/:id/archive', summary: 'Archive a programme, with a reason', tag: TAG, auth: 'coach', feature: FEATURE, rateLimit: WRITE_LIMIT, body: programArchiveSchema }, async (req) => coachSafe(req.ctx, w.archiveProgram(req.ctx, param(req, 'id'), parse(programArchiveSchema, req.body).reason)));

  /* ---------- coach: a client's sessions and feedback ---------- */
  def(app, { method: 'GET', path: '/coach/clients/:id/workouts', summary: 'A client’s programmes and sessions; set logs, effort, duration and notes only while the client shares health data', tag: TAG, auth: 'coach', feature: FEATURE }, async (req) => {
    const id = param(req, 'id');
    if (!coachHasMember(req.ctx, me(req), id)) throw errors.forbidden('Not your client', 'NO_ACCESS');
    return coachSafe(req.ctx, w.clientWorkouts(req.ctx, id));
  });
  def(app, { method: 'GET', path: '/coach/workouts/recent', summary: 'Sessions my clients logged recently that have no feedback yet (status only)', tag: TAG, auth: 'coach', feature: FEATURE, query: recentQuery }, async (req) => coachSafe(req.ctx, w.coachRecent(req.ctx, parse(recentQuery, query(req)).days ?? 7)));
  def(app, { method: 'GET', path: '/coach/workouts/:id', summary: 'One session of an assigned client; set logs, effort and notes only while the client shares health data', tag: TAG, auth: 'coach', feature: FEATURE }, async (req) => coachSafe(req.ctx, w.sessionDetail(req.ctx, param(req, 'id'), { audit: true })));
  def(app, { method: 'POST', path: '/coach/workouts/:id/feedback', summary: 'Feedback on a logged or skipped session (needs the client’s sharing consent); the client is notified', tag: TAG, auth: 'coach', feature: FEATURE, rateLimit: WRITE_LIMIT, body: sessionFeedbackSchema }, async (req, reply) => { const out = w.giveFeedback(req.ctx, param(req, 'id'), parse(sessionFeedbackSchema, req.body).body); reply.code(201); return coachSafe(req.ctx, out); });

  /* ---------- administrators: the library (library.manage) ---------- */
  def(app, { method: 'GET', path: '/admin/exercises', summary: 'The whole exercise library, coach drafts included', tag: TAG, auth: 'admin', permission: 'library.manage', feature: FEATURE, query: exerciseQuery }, async (req) => ({ items: w.listExercises(req.ctx, parse(exerciseQuery, query(req))), media: w.mediaStatus(req.ctx) }));
  def(app, { method: 'POST', path: '/admin/exercises', summary: 'Add a team exercise (draft or published)', tag: TAG, auth: 'admin', permission: 'library.manage', feature: FEATURE, rateLimit: WRITE_LIMIT, body: adminExerciseCreateSchema }, async (req, reply) => { const out = w.createTeamExercise(req.ctx, parse(adminExerciseCreateSchema, req.body)); reply.code(201); return out; });
  def(app, { method: 'PATCH', path: '/admin/exercises/:id', summary: 'Edit an exercise’s text (sessions already given keep their copy) or map it to a clip of the exercise media manifest (mediaRef; null for text only)', tag: TAG, auth: 'admin', permission: 'library.manage', feature: FEATURE, rateLimit: WRITE_LIMIT, body: adminExercisePatchSchema }, async (req) => w.updateExercise(req.ctx, param(req, 'id'), parse(adminExercisePatchSchema, req.body)));
  def(app, { method: 'POST', path: '/admin/exercises/:id/status', summary: 'Publish, return to draft or archive an exercise, with a reason', tag: TAG, auth: 'admin', permission: 'library.manage', feature: FEATURE, rateLimit: WRITE_LIMIT, body: libraryStatusSchema }, async (req) => { const i = parse(libraryStatusSchema, req.body); return w.setExerciseStatus(req.ctx, param(req, 'id'), i.status, i.reason); });
  def(app, { method: 'GET', path: '/admin/workout-templates', summary: 'Workout templates: team templates and coaches’ own', tag: TAG, auth: 'admin', permission: 'library.manage', feature: FEATURE, query: templateQuery }, async (req) => { const q = parse(templateQuery, query(req)); return { items: w.listTemplates(req.ctx, { status: q.status, source: q.source }) }; });
  def(app, { method: 'POST', path: '/admin/workout-templates', summary: 'Create a team template (draft or published; published exercises only)', tag: TAG, auth: 'admin', permission: 'library.manage', feature: FEATURE, rateLimit: WRITE_LIMIT, body: adminTemplateCreateSchema }, async (req, reply) => { const out = w.createTeamTemplate(req.ctx, parse(adminTemplateCreateSchema, req.body)); reply.code(201); return out; });
  def(app, { method: 'GET', path: '/admin/workout-templates/:id', summary: 'One template with its exercises', tag: TAG, auth: 'admin', permission: 'library.manage', feature: FEATURE }, async (req) => w.getTemplate(req.ctx, param(req, 'id')));
  def(app, { method: 'PATCH', path: '/admin/workout-templates/:id', summary: 'Edit a team template', tag: TAG, auth: 'admin', permission: 'library.manage', feature: FEATURE, rateLimit: WRITE_LIMIT, body: adminTemplatePatchSchema }, async (req) => w.updateTemplate(req.ctx, param(req, 'id'), parse(adminTemplatePatchSchema, req.body)));
  def(app, { method: 'POST', path: '/admin/workout-templates/:id/status', summary: 'Publish, return to draft or archive a team template, with a reason', tag: TAG, auth: 'admin', permission: 'library.manage', feature: FEATURE, rateLimit: WRITE_LIMIT, body: libraryStatusSchema }, async (req) => { const i = parse(libraryStatusSchema, req.body); return w.setTemplateStatus(req.ctx, param(req, 'id'), i.status, i.reason); });

  /* ---------- administrators: a member's workouts (members.manage) ---------- */
  def(app, { method: 'GET', path: '/admin/members/:id/workouts', summary: 'A member’s workout programmes and sessions, with their logs', tag: TAG, auth: 'admin', permission: 'members.manage', feature: FEATURE }, async (req) => w.clientWorkouts(req.ctx, param(req, 'id')));
  def(app, { method: 'GET', path: '/admin/workouts/:id', summary: 'One workout session with its logs', tag: TAG, auth: 'admin', permission: 'members.manage', feature: FEATURE }, async (req) => w.sessionDetail(req.ctx, param(req, 'id'), { audit: true }));

  /* ---------- administrators: a member's workout programmes (members.manage), mirroring the coach's ----------
     The same validation, versions and publishing as the coach routes (api/domain/workouts.ts): a published programme
     reaches the member's app exactly as a coach's does, and the assigned coach sees it on the client record. Every
     change is audited with by: 'admin'. */
  def(app, { method: 'GET', path: '/admin/members/:id/workout-templates', summary: 'The workout templates an administrator may use in this member’s programme (no library.manage needed): published team templates and the assigned coach’s own, or with programId that programme’s coach’s and the templates its published version uses; never archived ones; usable false while a template has no exercises', tag: TAG, auth: 'admin', permission: 'members.manage', feature: FEATURE, query: memberTemplatesQuery }, async (req) => w.adminTemplatesForMember(req.ctx, param(req, 'id'), { programId: parse(memberTemplatesQuery, query(req)).programId }));
  def(app, { method: 'GET', path: '/admin/members/:id/workout-programs', summary: 'A member’s workout programmes (drafts and closed ones included), newest first', tag: TAG, auth: 'admin', permission: 'members.manage', feature: FEATURE }, async (req) => ({ items: w.adminListMemberPrograms(req.ctx, param(req, 'id')) }));
  def(app, { method: 'POST', path: '/admin/members/:id/workout-programs', summary: 'Create a draft workout programme for a member: from scratch (structure, or none yet) or from a template (templateId, weeks, days)', tag: TAG, auth: 'admin', permission: 'members.manage', feature: FEATURE, rateLimit: WRITE_LIMIT, body: adminProgramCreateSchema }, async (req, reply) => { const out = w.adminCreateProgram(req.ctx, param(req, 'id'), parse(adminProgramCreateSchema, req.body)); reply.code(201); return out; });
  def(app, { method: 'GET', path: '/admin/workout-programs/:id', summary: 'One programme: versions, the draft, session counts', tag: TAG, auth: 'admin', permission: 'members.manage', feature: FEATURE }, async (req) => w.adminGetProgram(req.ctx, param(req, 'id')));
  def(app, { method: 'PATCH', path: '/admin/workout-programs/:id', summary: 'Edit the draft version (a published programme gets a new draft)', tag: TAG, auth: 'admin', permission: 'members.manage', feature: FEATURE, rateLimit: WRITE_LIMIT, body: programPatchSchema }, async (req) => w.adminUpdateProgramDraft(req.ctx, param(req, 'id'), parse(programPatchSchema, req.body)));
  def(app, { method: 'POST', path: '/admin/workout-programs/:id/publish', summary: 'Publish the draft: generates the member’s sessions once, keeps sessions already done, notifies the member', tag: TAG, auth: 'admin', permission: 'members.manage', feature: FEATURE, rateLimit: WRITE_LIMIT, body: programPublishSchema }, async (req) => w.adminPublishProgram(req.ctx, param(req, 'id'), parse(programPublishSchema, req.body ?? {}).startDate));
  def(app, { method: 'POST', path: '/admin/workout-programs/:id/archive', summary: 'Archive a programme, with a reason', tag: TAG, auth: 'admin', permission: 'members.manage', feature: FEATURE, rateLimit: WRITE_LIMIT, body: programArchiveSchema }, async (req) => w.adminArchiveProgram(req.ctx, param(req, 'id'), parse(programArchiveSchema, req.body).reason));
}
