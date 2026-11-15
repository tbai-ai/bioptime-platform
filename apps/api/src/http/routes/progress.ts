/* M2 Progress routes: goals and milestones, check-ins (templates, schedules, submit and review), series over a chosen
   range, adherence and progress photos. Registered through the module descriptor (api/modules/progress.ts), so no shared
   route file changes.

   Every route goes through def() with its role and `feature: 'progress'`; administrative routes add a permission
   (library.manage for the check-in library, members.manage for the member overview). Coaches act only on assigned
   clients; values, answers, series, adherence and photos also need the member's current coach_sharing consent
   (requireHealthAccess), and coach payloads pass the field policy guard. A coach response that carries goal values,
   check-in answers, a series or adherence is audited as health.viewed; the administrator overview is audited as
   member.record_viewed, like GET /admin/members/:id. Photo upload and sharing also need the
   progressPhotos switch; deleting a photo and withdrawing the photo consent stay reachable while the module is off. */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isoDateSchema, isoDateTimeSchema } from '@bioptime/domain';
import type { Ctx } from '../../context.js';
import { parse } from '../../lib/validate.js';
import { errors } from '../../lib/errors.js';
import { def, param, query } from '../route.js';
import { coachHasMember, requireHealthAccess } from '../../auth/permissions.js';
import { coachSafe } from '../../auth/fieldPolicy.js';
import { audit } from '../../domain/audit.js';
import { isEnabledFor, requireFeature } from '../../domain/features.js';
import * as progress from '../../domain/progress.js';

/* ---------- payloads ----------
   Built when the routes are registered, never when this file loads. api/domain/progress.ts reaches this file
   through the module registry (domain/progress -> modules/index -> modules/progress -> here), so reading its
   constants at load time would fail whenever api/domain/progress.ts is the first module a process imports. */
function payloads() {
  const F = progress.MODULE_FLAG;

  const value = z.number().finite();
  const goalCreate = z.object({
    title: z.string().trim().min(2).max(160),
    metric: z.string().min(1).max(40).nullable().optional(),
    baselineValue: value.nullable().optional(),
    targetValue: value.nullable().optional(),
    unit: z.string().trim().max(16).nullable().optional(),
    targetDate: isoDateSchema.nullable().optional(),
  }).strict();
  const goalPatch = z.object({
    title: z.string().trim().min(2).max(160).optional(),
    status: z.enum(progress.GOAL_STATUSES).optional(),
    baselineValue: value.nullable().optional(),
    targetValue: value.nullable().optional(),
    unit: z.string().trim().max(16).nullable().optional(),
    targetDate: isoDateSchema.nullable().optional(),
  }).strict();
  const milestoneCreate = z.object({ title: z.string().trim().min(2).max(160), targetValue: value.nullable().optional(), dueDate: isoDateSchema.nullable().optional() }).strict();
  const milestonePatch = z.object({ achieved: z.boolean() }).strict();
  const question = z.object({
    key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, 'A key is 2 to 40 lower-case letters, digits or underscores, starting with a letter'),
    label: z.string().trim().min(3).max(200),
    type: z.enum(progress.QUESTION_TYPES),
    metric: z.string().min(1).max(40).optional(),
  }).strict();
  const templateCreate = z.object({ title: z.string().trim().min(2).max(120), description: z.string().trim().max(1000).optional(), questions: z.array(question).min(1).max(20) }).strict();
  const templatePatch = z.object({ title: z.string().trim().min(2).max(120).optional(), description: z.string().trim().max(1000).optional(), questions: z.array(question).min(1).max(20).optional(), status: z.literal('archived').optional(), reason: z.string().trim().max(300).optional() }).strict();
  const reasonBody = z.object({ reason: z.string().trim().min(3).max(300) });
  const templateQuery = z.object({ scope: z.enum(['library', 'coach', 'all']).optional() });
  const scheduleCreate = z.object({ templateId: z.string().min(1).max(64), weekday: z.number().int().min(0).max(6) }).strict();
  const checkinRequest = z.object({ templateId: z.string().min(1).max(64), dueDate: isoDateSchema.optional() }).strict();
  const submitBody = z.object({ answers: z.record(z.union([z.number(), z.string().max(2000), z.boolean(), z.null()])) }).strict();
  const reviewBody = z.object({ response: z.string().trim().max(2000).optional(), privateNote: z.string().trim().max(4000).optional() }).strict();
  const seriesQuery = z.object({ metric: z.string().min(1).max(40), from: isoDateSchema.optional(), to: isoDateSchema.optional() });
  const rangeQuery = z.object({ from: isoDateSchema.optional(), to: isoDateSchema.optional() });
  const coachCheckinsQuery = z.object({ status: z.enum(progress.CHECKIN_STATUSES).optional() });
  const photoUpload = z.object({
    dataBase64: z.string().min(8).max(Math.ceil(progress.PHOTO_MAX_BYTES * 1.4)),
    filename: z.string().max(200).optional(),
    pose: z.enum(progress.POSES),
    takenAt: isoDateTimeSchema.optional(),
    shareWithCoach: z.boolean().optional(),
  }).strict();
  const photoPatch = z.object({ shareWithCoach: z.boolean() }).strict();
  const consentBody = z.object({ granted: z.boolean(), version: z.string().max(40).optional() }).strict();
  return { F, goalCreate, goalPatch, milestoneCreate, milestonePatch, templateCreate, templatePatch, reasonBody, templateQuery, scheduleCreate, checkinRequest, submitBody, reviewBody, seriesQuery, rangeQuery, coachCheckinsQuery, photoUpload, photoPatch, consentBody };
}

const hasValues = (i: { baselineValue?: unknown; targetValue?: unknown; metric?: unknown }) => (i.metric !== undefined && i.metric !== null) || (i.baselineValue !== undefined && i.baselineValue !== null) || (i.targetValue !== undefined && i.targetValue !== null);

export function progressRoutes(app: FastifyInstance): void {
  const { F, goalCreate, goalPatch, milestoneCreate, milestonePatch, templateCreate, templatePatch, reasonBody, templateQuery, scheduleCreate, checkinRequest, submitBody, reviewBody, seriesQuery, rangeQuery, coachCheckinsQuery, photoUpload, photoPatch, consentBody } = payloads();
  const me = (req: FastifyRequest) => req.ctx.actor!.id;

  /* ================================= member ================================= */

  def(app, { method: 'GET', path: '/me/goals', summary: 'My goals with their milestones (a measurable goal is marked achieved when a logged value reaches its target)', tag: 'member', auth: 'member', feature: F }, async (req) => ({ items: progress.listGoals(req.ctx, me(req), { values: true }) }));
  def(app, { method: 'POST', path: '/me/goals', summary: 'Set a goal (optionally measurable: a metric, a starting value, a target and a date)', tag: 'member', auth: 'member', feature: F, body: goalCreate, rateLimit: { max: 30, timeWindow: '10 minutes' } }, async (req, reply) => {
    const i = parse(goalCreate, req.body);
    reply.code(201);
    return progress.createGoal(req.ctx, me(req), i, 'member');
  });
  def(app, { method: 'PATCH', path: '/me/goals/:id', summary: 'Change a goal (a goal your coach set: its status only)', tag: 'member', auth: 'member', feature: F, body: goalPatch }, async (req) => progress.updateGoal(req.ctx, me(req), param(req, 'id'), parse(goalPatch, req.body), 'member'));
  def(app, { method: 'POST', path: '/me/goals/:id/milestones', summary: 'Add a milestone to a goal I set (a goal my coach set: ask my coach)', tag: 'member', auth: 'member', feature: F, body: milestoneCreate, rateLimit: { max: 60, timeWindow: '10 minutes' } }, async (req, reply) => {
    const i = parse(milestoneCreate, req.body);
    reply.code(201);
    return progress.addMilestone(req.ctx, me(req), param(req, 'id'), i, 'member');
  });
  def(app, { method: 'PATCH', path: '/me/goals/:id/milestones/:milestoneId', summary: 'Mark a milestone reached, or not (a status change: also on a goal my coach set)', tag: 'member', auth: 'member', feature: F, body: milestonePatch }, async (req) => progress.setMilestoneAchieved(req.ctx, me(req), param(req, 'id'), param(req, 'milestoneId'), parse(milestonePatch, req.body).achieved, 'member'));

  def(app, { method: 'GET', path: '/me/checkins', summary: 'My check-ins (waiting ones first) and my weekly schedule', tag: 'member', auth: 'member', feature: F }, async (req) => ({ items: progress.listMemberCheckins(req.ctx, me(req), { answers: true }), schedules: progress.listSchedules(req.ctx, me(req)).filter((s) => s.active) }));
  def(app, { method: 'GET', path: '/me/checkins/:id', summary: 'One of my check-ins with its questions, my answers and my coach’s reply', tag: 'member', auth: 'member', feature: F }, async (req) => progress.memberCheckin(req.ctx, me(req), param(req, 'id')));
  def(app, { method: 'POST', path: '/me/checkins/:id/submit', summary: 'Answer a check-in (answers tied to a metric are logged as self-reported values)', tag: 'member', auth: 'member', feature: F, body: submitBody, rateLimit: { max: 30, timeWindow: '10 minutes' } }, async (req) => progress.submitCheckin(req.ctx, me(req), param(req, 'id'), parse(submitBody, req.body).answers));

  def(app, { method: 'GET', path: '/me/progress/series', summary: 'One metric over a chosen range; every point carries its source label', tag: 'member', auth: 'member', feature: F, query: seriesQuery }, async (req) => {
    const q = parse(seriesQuery, query(req));
    return progress.series(req.ctx, me(req), q.metric, q.from, q.to);
  });
  def(app, { method: 'GET', path: '/me/adherence', summary: 'What was due and done in a range, one line per registered provider (no combined score)', tag: 'member', auth: 'member', feature: F, query: rangeQuery }, async (req) => {
    const q = parse(rangeQuery, query(req));
    return progress.adherence(req.ctx, me(req), q.from, q.to);
  });

  def(app, { method: 'GET', path: '/me/progress/photos', summary: 'My progress photos (private), the photo consent and its wording', tag: 'member', auth: 'member', feature: F }, async (req) => ({ ...progress.listPhotos(req.ctx, me(req)), photosEnabled: isEnabledFor(req.ctx, progress.PHOTOS_FLAG) }));
  def(app, { method: 'POST', path: '/me/progress/photos', summary: 'Add a progress photo (JPEG, PNG or WebP, 5 MB, checked by content; needs the photo consent)', tag: 'member', auth: 'member', feature: F, body: photoUpload, bodyLimit: Math.ceil(progress.PHOTO_MAX_BYTES * 1.5), rateLimit: { max: 30, timeWindow: '10 minutes' } }, async (req, reply) => {
    requireFeature(req.ctx, progress.PHOTOS_FLAG);
    const i = parse(photoUpload, req.body);
    reply.code(201);
    return progress.uploadPhoto(req.ctx, me(req), i);
  });
  def(app, { method: 'PATCH', path: '/me/progress/photos/:id', summary: 'Share a photo with my coach, or stop sharing it', tag: 'member', auth: 'member', feature: F, body: photoPatch }, async (req) => {
    const i = parse(photoPatch, req.body);
    if (i.shareWithCoach) requireFeature(req.ctx, progress.PHOTOS_FLAG); // stopping sharing is always possible
    return progress.setPhotoShared(req.ctx, me(req), param(req, 'id'), i.shareWithCoach);
  });
  // reachable while the module is off: a member can always delete their own photo and withdraw the photo consent
  def(app, { method: 'DELETE', path: '/me/progress/photos/:id', summary: 'Delete one of my photos (removed from storage at once; works while the module is off)', tag: 'member', auth: 'member' }, async (req) => progress.deletePhoto(req.ctx, me(req), param(req, 'id')));
  def(app, { method: 'POST', path: '/me/progress/photos/consent', summary: 'Grant or withdraw the progress photo consent (withdrawing works while the module is off and stops sharing every photo)', tag: 'member', auth: 'member', body: consentBody, rateLimit: { max: 20, timeWindow: '10 minutes' } }, async (req) => {
    const i = parse(consentBody, req.body);
    if (i.granted) { requireFeature(req.ctx, F); requireFeature(req.ctx, progress.PHOTOS_FLAG); }
    return progress.setPhotoConsent(req.ctx, me(req), i.granted, i.version);
  });

  /* ================================= coach ================================= */

  const clientId = (req: FastifyRequest) => { const id = param(req, 'id'); if (!coachHasMember(req.ctx, me(req), id)) throw errors.forbidden('Not your client', 'NO_ACCESS'); return id; };
  /* every coach response passes the field policy's safety net (coachSafe): it looks at the payload as built, reports any
     restricted key a presenter produced (paths only) and sends the payload without it */
  const guard = <T,>(ctx: Ctx, payload: T): T => coachSafe(ctx, payload, 'progress coach route');
  const viewed = (ctx: Ctx, memberId: string, what: string) => audit(ctx, 'health.viewed', { type: 'user', id: memberId }, null, { by: 'coach', what });
  /* goals carry health values (starting, target, latest logged and milestone values) only while the member shares; a
     coach response that carries any of them is audited as a health read, like the other coach health reads */
  type PresentedGoal = ReturnType<typeof progress.presentGoal>;
  const carriesValues = (g: PresentedGoal) => g.baselineValue != null || g.targetValue != null || !!g.latest || g.milestones.some((m) => m.targetValue != null);
  function goalRead<T extends PresentedGoal | PresentedGoal[]>(ctx: Ctx, memberId: string, goals: T): T {
    if ((Array.isArray(goals) ? goals : [goals]).some(carriesValues)) viewed(ctx, memberId, 'goal-values');
    return goals;
  }

  def(app, { method: 'GET', path: '/coach/clients/:id/goals', summary: 'A client’s goals; starting, target and latest values only while they share health records (a read of values is audited)', tag: 'coach', auth: 'coach', feature: F }, async (req) => {
    const id = clientId(req);
    const shared = progress.healthShared(req.ctx, id);
    return guard(req.ctx, { items: goalRead(req.ctx, id, progress.listGoals(req.ctx, id, { values: shared })), healthShared: shared, metrics: progress.enabledMetrics(req.ctx) });
  });
  def(app, { method: 'POST', path: '/coach/clients/:id/goals', summary: 'Set a goal for a client (a measurable one needs their health sharing)', tag: 'coach', auth: 'coach', feature: F, body: goalCreate, rateLimit: { max: 30, timeWindow: '10 minutes' } }, async (req, reply) => {
    const id = clientId(req);
    const i = parse(goalCreate, req.body);
    if (hasValues(i)) requireHealthAccess(req.ctx, id);
    const g = progress.createGoal(req.ctx, id, i, 'coach');
    reply.code(201);
    return guard(req.ctx, goalRead(req.ctx, id, progress.getGoal(req.ctx, id, g.id, { values: progress.healthShared(req.ctx, id) })));
  });
  def(app, { method: 'PATCH', path: '/coach/clients/:id/goals/:goalId', summary: 'Change a client’s goal (a goal the member set: its status only; values need health sharing)', tag: 'coach', auth: 'coach', feature: F, body: goalPatch }, async (req) => {
    const id = clientId(req);
    const i = parse(goalPatch, req.body);
    if (i.baselineValue !== undefined || i.targetValue !== undefined || i.unit !== undefined) requireHealthAccess(req.ctx, id);
    progress.updateGoal(req.ctx, id, param(req, 'goalId'), i, 'coach');
    return guard(req.ctx, goalRead(req.ctx, id, progress.getGoal(req.ctx, id, param(req, 'goalId'), { values: progress.healthShared(req.ctx, id) })));
  });
  def(app, { method: 'POST', path: '/coach/clients/:id/goals/:goalId/milestones', summary: 'Add a milestone to a goal I set for a client (a goal the member set: not mine to change; a milestone value needs health sharing)', tag: 'coach', auth: 'coach', feature: F, body: milestoneCreate, rateLimit: { max: 60, timeWindow: '10 minutes' } }, async (req, reply) => {
    const id = clientId(req);
    const i = parse(milestoneCreate, req.body);
    if (i.targetValue !== undefined && i.targetValue !== null) requireHealthAccess(req.ctx, id);
    progress.addMilestone(req.ctx, id, param(req, 'goalId'), i, 'coach');
    reply.code(201);
    return guard(req.ctx, goalRead(req.ctx, id, progress.getGoal(req.ctx, id, param(req, 'goalId'), { values: progress.healthShared(req.ctx, id) })));
  });

  def(app, { method: 'GET', path: '/coach/clients/:id/checkins', summary: 'A client’s check-ins and schedule; answers and team notes only while they share health records', tag: 'coach', auth: 'coach', feature: F }, async (req) => {
    const id = clientId(req);
    const shared = progress.healthShared(req.ctx, id);
    if (shared) viewed(req.ctx, id, 'checkin-answers');
    return guard(req.ctx, { items: progress.listMemberCheckins(req.ctx, id, { answers: shared, notes: shared }), schedules: progress.listSchedules(req.ctx, id), healthShared: shared });
  });
  def(app, { method: 'POST', path: '/coach/clients/:id/checkins', summary: 'Ask a client for one check-in now', tag: 'coach', auth: 'coach', feature: F, body: checkinRequest, rateLimit: { max: 30, timeWindow: '10 minutes' } }, async (req, reply) => {
    const id = clientId(req);
    const i = parse(checkinRequest, req.body);
    reply.code(201);
    return guard(req.ctx, progress.requestCheckin(req.ctx, me(req), id, i));
  });
  def(app, { method: 'GET', path: '/coach/clients/:id/checkin-schedules', summary: 'A client’s weekly check-in schedules', tag: 'coach', auth: 'coach', feature: F }, async (req) => guard(req.ctx, { items: progress.listSchedules(req.ctx, clientId(req)) }));
  def(app, { method: 'POST', path: '/coach/clients/:id/checkin-schedules', summary: 'Set a weekly check-in for a client (replaces their active schedule)', tag: 'coach', auth: 'coach', feature: F, body: scheduleCreate, rateLimit: { max: 30, timeWindow: '10 minutes' } }, async (req, reply) => {
    const id = clientId(req);
    const i = parse(scheduleCreate, req.body);
    reply.code(201);
    return guard(req.ctx, progress.createSchedule(req.ctx, me(req), id, i));
  });
  def(app, { method: 'DELETE', path: '/coach/clients/:id/checkin-schedules/:scheduleId', summary: 'Stop a client’s weekly check-in', tag: 'coach', auth: 'coach', feature: F }, async (req) => guard(req.ctx, progress.endSchedule(req.ctx, clientId(req), param(req, 'scheduleId'), 'stopped by the coach')));
  def(app, { method: 'GET', path: '/coach/checkins', summary: 'Check-ins across my clients by status (default: sent and waiting for my review); never the answers', tag: 'coach', auth: 'coach', feature: F, query: coachCheckinsQuery }, async (req) => {
    const q = parse(coachCheckinsQuery, query(req));
    return guard(req.ctx, { items: progress.listCoachCheckins(req.ctx, me(req), q.status ?? 'submitted') });
  });
  def(app, { method: 'POST', path: '/coach/checkins/:id/review', summary: 'Reply to a client’s check-in (shown to them) and optionally add a private team note; needs their health sharing', tag: 'coach', auth: 'coach', feature: F, body: reviewBody, rateLimit: { max: 60, timeWindow: '10 minutes' } }, async (req) => {
    const memberId = progress.checkinMemberForCoach(req.ctx, me(req), param(req, 'id'));
    requireHealthAccess(req.ctx, memberId);
    return guard(req.ctx, progress.reviewCheckin(req.ctx, me(req), param(req, 'id'), parse(reviewBody, req.body)));
  });

  def(app, { method: 'GET', path: '/coach/clients/:id/progress/series', summary: 'One metric of a client over a chosen range (needs their health sharing)', tag: 'coach', auth: 'coach', feature: F, query: seriesQuery }, async (req) => {
    const id = clientId(req);
    requireHealthAccess(req.ctx, id);
    const q = parse(seriesQuery, query(req));
    const out = progress.series(req.ctx, id, q.metric, q.from, q.to);
    viewed(req.ctx, id, `progress-series:${q.metric}`);
    return guard(req.ctx, out);
  });
  def(app, { method: 'GET', path: '/coach/clients/:id/adherence', summary: 'What a client had due and did in a range, per provider (needs their health sharing; audited)', tag: 'coach', auth: 'coach', feature: F, query: rangeQuery }, async (req) => {
    const id = clientId(req);
    requireHealthAccess(req.ctx, id);
    const q = parse(rangeQuery, query(req));
    const out = progress.adherence(req.ctx, id, q.from, q.to);
    viewed(req.ctx, id, 'adherence');
    return guard(req.ctx, out);
  });
  def(app, { method: 'GET', path: '/coach/clients/:id/progress/photos', summary: 'The photos a client shares with me (needs their photo consent and health sharing; each opening is audited)', tag: 'coach', auth: 'coach', feature: F }, async (req) => {
    const id = clientId(req);
    requireFeature(req.ctx, progress.PHOTOS_FLAG);
    requireHealthAccess(req.ctx, id);
    return guard(req.ctx, progress.coachPhotos(req.ctx, id));
  });

  def(app, { method: 'GET', path: '/coach/checkin-templates', summary: 'Check-in templates I can use: the published library and my own', tag: 'coach', auth: 'coach', feature: F }, async (req) => guard(req.ctx, { items: progress.listCoachTemplates(req.ctx, me(req)), metrics: progress.enabledMetrics(req.ctx), questionTypes: progress.QUESTION_TYPES }));
  def(app, { method: 'POST', path: '/coach/checkin-templates', summary: 'Write my own check-in template (usable by me at once)', tag: 'coach', auth: 'coach', feature: F, body: templateCreate, rateLimit: { max: 20, timeWindow: '10 minutes' } }, async (req, reply) => {
    const i = parse(templateCreate, req.body);
    reply.code(201);
    return guard(req.ctx, progress.createTemplate(req.ctx, i, 'coach'));
  });

  /* ================================= admin ================================= */

  def(app, { method: 'GET', path: '/admin/checkin-templates', summary: 'The check-in library (and coaches’ own templates with scope=coach or all)', tag: 'admin', auth: 'admin', permission: 'library.manage', feature: F, query: templateQuery }, async (req) => ({ items: progress.listAllTemplates(req.ctx, parse(templateQuery, query(req)).scope ?? 'library'), metrics: progress.enabledMetrics(req.ctx), questionTypes: progress.QUESTION_TYPES }));
  def(app, { method: 'POST', path: '/admin/checkin-templates', summary: 'Write a library check-in template (a draft until published)', tag: 'admin', auth: 'admin', permission: 'library.manage', feature: F, body: templateCreate }, async (req, reply) => {
    const i = parse(templateCreate, req.body);
    reply.code(201);
    return progress.createTemplate(req.ctx, i, 'library');
  });
  def(app, { method: 'PATCH', path: '/admin/checkin-templates/:id', summary: 'Edit a draft library template, or archive one (reason required)', tag: 'admin', auth: 'admin', permission: 'library.manage', feature: F, body: templatePatch }, async (req) => {
    const { reason, ...patch } = parse(templatePatch, req.body);
    return progress.updateTemplate(req.ctx, param(req, 'id'), patch, reason);
  });
  def(app, { method: 'POST', path: '/admin/checkin-templates/:id/publish', summary: 'Publish a draft library template to every coach (reason required, audited)', tag: 'admin', auth: 'admin', permission: 'library.manage', feature: F, body: reasonBody }, async (req) => progress.publishTemplate(req.ctx, param(req, 'id'), parse(reasonBody, req.body).reason));
  def(app, { method: 'GET', path: '/admin/members/:id/progress', summary: 'A member’s goals, check-in statuses, schedules and photo counts (never answers or photos; audited as a record view)', tag: 'admin', auth: 'admin', permission: 'members.manage', feature: F }, async (req) => {
    const id = param(req, 'id');
    audit(req.ctx, 'member.record_viewed', { type: 'user', id }, null, { by: req.ctx.actor!.role, sections: ['progress'] });
    return progress.memberOverview(req.ctx, id);
  });
}
