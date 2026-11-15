/* M10 Learning routes, registered by the module descriptor (api/modules/learning.ts) inside /api. Every route declares
   auth and the feature flag 'learning'; administrative routes need learning.manage (courses) or members.manage (a
   member's learning); every coach response passes the field policy guard; a coach reaches only assigned clients, and a
   client's own course choices only while the client shares with their coach. */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { parse } from '../../lib/validate.js';
import { errors } from '../../lib/errors.js';
import { def, param, query } from '../route.js';
import { coachHasMember } from '../../auth/permissions.js';
import { coachSafe as policyCoachSafe } from '../../auth/fieldPolicy.js';
import * as learning from '../../domain/learning.js';

const FEATURE = 'learning';
const TAG = 'learning';
const WRITE_LIMIT = { max: 60, timeWindow: '10 minutes' };
const LEARNER_LIMIT = { max: 240, timeWindow: '10 minutes' };

/** Every coach response passes the field policy's safety net (coachSafe in auth/fieldPolicy.ts): it looks at the
 *  payload as built, reports any restricted key a presenter produced (paths only, never values) and sends the payload
 *  without it. */
function coachSafe<T>(ctx: Ctx, payload: T): T {
  return policyCoachSafe(ctx, payload, 'learning coach route');
}

/* ---------- validation ---------- */

const title = z.string().trim().min(2).max(160);
const slug = z.string().trim().min(2).max(60).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lower-case letters, digits and single hyphens');
const id = z.string().min(3).max(64);
const reason = z.object({ reason: z.string().trim().min(3, 'Say why, in a few words').max(500) });

export const courseCreateSchema = z.object({
  title, slug: slug.optional(), summary: z.string().max(600).optional(),
  audience: z.enum(learning.AUDIENCES), packageIds: z.array(id).max(20).optional(), coverAssetId: id.nullable().optional(),
}).strict();
export const coursePatchSchema = z.object({
  title: title.optional(), slug: slug.optional(), summary: z.string().max(600).optional(),
  audience: z.enum(learning.AUDIENCES).optional(), packageIds: z.array(id).max(20).optional(), coverAssetId: id.nullable().optional(),
}).strict();
const moduleSchema = z.object({ title }).strict();
const minutes = z.number().int().min(1).max(600).nullable();
export const lessonCreateSchema = z.object({ title, kind: z.enum(learning.LESSON_KINDS), body: z.string().max(20000).optional(), durationMinutes: minutes.optional() }).strict();
export const lessonPatchSchema = z.object({ title: title.optional(), kind: z.enum(learning.LESSON_KINDS).optional(), body: z.string().max(20000).optional(), durationMinutes: minutes.optional(), moduleId: id.optional() }).strict();
const reorderSchema = z.object({ modules: z.array(z.object({ id, lessonIds: z.array(id).max(500) }).strict()).max(100) }).strict();
export const assignSchema = z.object({ courseId: id, note: z.string().max(500).nullable().optional() }).strict();
const adminListQuery = z.object({ status: z.enum(['draft', 'published', 'archived']).optional(), audience: z.enum(learning.AUDIENCES).optional() });

const me = (req: FastifyRequest) => req.ctx.actor!.id;

export function learningRoutes(app: FastifyInstance): void {
  /* ---------- members ---------- */
  def(app, { method: 'GET', path: '/me/courses', summary: 'My courses with progress, and the published courses I may start (by audience: every member, my package, or my coach’s assignment)', tag: TAG, auth: 'member', feature: FEATURE }, async (req) => learning.myCourses(req.ctx));
  def(app, { method: 'GET', path: '/me/courses/:id', summary: 'One course: its published lessons and my progress', tag: TAG, auth: 'member', feature: FEATURE }, async (req) => learning.myCourse(req.ctx, param(req, 'id')));
  def(app, { method: 'POST', path: '/me/courses/:id/enroll', summary: 'Enrol in a published course my audience admits (a package course needs the package)', tag: TAG, auth: 'member', feature: FEATURE, rateLimit: WRITE_LIMIT }, async (req) => learning.enroll(req.ctx, param(req, 'id')));
  def(app, { method: 'POST', path: '/me/courses/:id/leave', summary: 'Leave a course; my progress is kept and enrolling again picks it up', tag: TAG, auth: 'member', feature: FEATURE, rateLimit: WRITE_LIMIT }, async (req) => learning.leave(req.ctx, param(req, 'id')));
  def(app, { method: 'GET', path: '/me/lessons/:id', summary: 'One published lesson of a course I may take, with my progress', tag: TAG, auth: 'member', feature: FEATURE }, async (req) => learning.myLesson(req.ctx, param(req, 'id')));
  def(app, { method: 'POST', path: '/me/lessons/:id/start', summary: 'Note that I opened a lesson (recorded once, only while enrolled)', tag: TAG, auth: 'member', feature: FEATURE, rateLimit: LEARNER_LIMIT }, async (req) => learning.startLesson(req.ctx, param(req, 'id')));
  def(app, { method: 'POST', path: '/me/lessons/:id/complete', summary: 'Mark a lesson complete (enrols me first if needed); the course completes with its last published lesson', tag: TAG, auth: 'member', feature: FEATURE, rateLimit: LEARNER_LIMIT }, async (req) => learning.completeLesson(req.ctx, param(req, 'id')));

  /* ---------- coaches: member courses and their clients ---------- */
  def(app, { method: 'GET', path: '/coach/courses', summary: 'Published member courses I may assign, with their outlines and the packages they need', tag: TAG, auth: 'coach', feature: FEATURE }, async (req) => coachSafe(req.ctx, { items: learning.coachCatalogue(req.ctx), video: learning.videoStatus(req.ctx) }));
  def(app, { method: 'GET', path: '/coach/courses/:id', summary: 'One published member course, to read before assigning it', tag: TAG, auth: 'coach', feature: FEATURE }, async (req) => coachSafe(req.ctx, learning.coachCourse(req.ctx, param(req, 'id'))));
  def(app, { method: 'GET', path: '/coach/lessons/:id', summary: 'A lesson: one of my training lessons with my progress, or a published member-course lesson to read (no progress)', tag: TAG, auth: 'coach', feature: FEATURE }, async (req) => coachSafe(req.ctx, learning.coachLesson(req.ctx, param(req, 'id'))));
  def(app, { method: 'POST', path: '/coach/clients/:id/courses', summary: 'Assign a published course to an assigned client, with an optional note; the client is notified', tag: TAG, auth: 'coach', feature: FEATURE, rateLimit: WRITE_LIMIT, body: assignSchema }, async (req, reply) => {
    const memberId = param(req, 'id');
    if (!coachHasMember(req.ctx, me(req), memberId)) throw errors.forbidden('Not your client', 'NO_ACCESS');
    const out = learning.assignCourse(req.ctx, memberId, parse(assignSchema, req.body));
    reply.code(201);
    return coachSafe(req.ctx, out);
  });
  def(app, { method: 'GET', path: '/coach/clients/:id/learning', summary: 'An assigned client’s courses and progress: the courses coaches assigned always, the client’s own choices only while they share with their coach', tag: TAG, auth: 'coach', feature: FEATURE }, async (req) => {
    const memberId = param(req, 'id');
    if (!coachHasMember(req.ctx, me(req), memberId)) throw errors.forbidden('Not your client', 'NO_ACCESS');
    return coachSafe(req.ctx, learning.clientLearning(req.ctx, memberId, { sharing: learning.sharesWithCoach(req.ctx, memberId) }));
  });

  /* ---------- coaches: their own training (courses with the audience 'coaches') ---------- */
  def(app, { method: 'GET', path: '/coach/training', summary: 'Training courses for coaches: mine with progress, and the ones I may start', tag: TAG, auth: 'coach', feature: FEATURE }, async (req) => coachSafe(req.ctx, learning.myCourses(req.ctx)));
  def(app, { method: 'GET', path: '/coach/training/:id', summary: 'One training course with my progress', tag: TAG, auth: 'coach', feature: FEATURE }, async (req) => coachSafe(req.ctx, learning.myCourse(req.ctx, param(req, 'id'))));
  def(app, { method: 'POST', path: '/coach/training/:id/enroll', summary: 'Start a training course', tag: TAG, auth: 'coach', feature: FEATURE, rateLimit: WRITE_LIMIT }, async (req) => coachSafe(req.ctx, learning.enroll(req.ctx, param(req, 'id'))));
  def(app, { method: 'POST', path: '/coach/lessons/:id/start', summary: 'Note that I opened a training lesson (recorded once, only while enrolled)', tag: TAG, auth: 'coach', feature: FEATURE, rateLimit: LEARNER_LIMIT }, async (req) => coachSafe(req.ctx, learning.startLesson(req.ctx, param(req, 'id'))));
  def(app, { method: 'POST', path: '/coach/lessons/:id/complete', summary: 'Mark a training lesson complete (member-course lessons are the members’ to complete)', tag: TAG, auth: 'coach', feature: FEATURE, rateLimit: LEARNER_LIMIT }, async (req) => coachSafe(req.ctx, learning.completeLesson(req.ctx, param(req, 'id'))));

  /* ---------- administrators: courses, modules and lessons (learning.manage) ---------- */
  const admin = { tag: TAG, auth: 'admin' as const, permission: 'learning.manage' as const, feature: FEATURE };
  def(app, { method: 'GET', path: '/admin/learning/options', summary: 'What the course editor offers: audiences, packages, website images and the video hosting status', ...admin }, async (req) => learning.adminOptions(req.ctx));
  def(app, { method: 'GET', path: '/admin/courses', summary: 'Every course with its lesson and enrolment counts', ...admin, query: adminListQuery }, async (req) => learning.adminCourses(req.ctx, parse(adminListQuery, query(req))));
  def(app, { method: 'POST', path: '/admin/courses', summary: 'Create a course (a draft)', ...admin, rateLimit: WRITE_LIMIT, body: courseCreateSchema }, async (req, reply) => { const out = learning.createCourse(req.ctx, parse(courseCreateSchema, req.body)); reply.code(201); return out; });
  def(app, { method: 'GET', path: '/admin/courses/:id', summary: 'One course for its editor: every module and lesson, drafts included', ...admin }, async (req) => learning.adminCourse(req.ctx, param(req, 'id')));
  def(app, { method: 'PATCH', path: '/admin/courses/:id', summary: 'Edit a course’s details and audience', ...admin, rateLimit: WRITE_LIMIT, body: coursePatchSchema }, async (req) => learning.updateCourse(req.ctx, param(req, 'id'), parse(coursePatchSchema, req.body)));
  def(app, { method: 'POST', path: '/admin/courses/:id/publish', summary: 'Publish a draft course (needs a published lesson), with a reason', ...admin, rateLimit: WRITE_LIMIT, body: reason }, async (req) => learning.setCourseStatus(req.ctx, param(req, 'id'), 'publish', parse(reason, req.body).reason));
  def(app, { method: 'POST', path: '/admin/courses/:id/unpublish', summary: 'Return a course to draft (also restores an archived one), with a reason', ...admin, rateLimit: WRITE_LIMIT, body: reason }, async (req) => learning.setCourseStatus(req.ctx, param(req, 'id'), 'unpublish', parse(reason, req.body).reason));
  def(app, { method: 'POST', path: '/admin/courses/:id/archive', summary: 'Archive a course: no new learners; enrolled learners keep reading it', ...admin, rateLimit: WRITE_LIMIT, body: reason }, async (req) => learning.setCourseStatus(req.ctx, param(req, 'id'), 'archive', parse(reason, req.body).reason));
  def(app, { method: 'POST', path: '/admin/courses/:id/reorder', summary: 'Put the course’s modules and lessons in a new order', ...admin, rateLimit: WRITE_LIMIT, body: reorderSchema }, async (req) => learning.reorderCourse(req.ctx, param(req, 'id'), parse(reorderSchema, req.body)));
  def(app, { method: 'POST', path: '/admin/courses/:id/modules', summary: 'Add a module to a course', ...admin, rateLimit: WRITE_LIMIT, body: moduleSchema }, async (req, reply) => { const out = learning.createModule(req.ctx, param(req, 'id'), parse(moduleSchema, req.body)); reply.code(201); return out; });
  def(app, { method: 'PATCH', path: '/admin/course-modules/:id', summary: 'Rename a module', ...admin, rateLimit: WRITE_LIMIT, body: moduleSchema }, async (req) => learning.updateModule(req.ctx, param(req, 'id'), parse(moduleSchema, req.body)));
  def(app, { method: 'DELETE', path: '/admin/course-modules/:id', summary: 'Remove an empty module', ...admin, rateLimit: WRITE_LIMIT }, async (req) => learning.deleteModule(req.ctx, param(req, 'id')));
  def(app, { method: 'POST', path: '/admin/course-modules/:id/lessons', summary: 'Add a lesson (a draft) to a module; the body keeps only the CMS formatting tags', ...admin, rateLimit: WRITE_LIMIT, body: lessonCreateSchema }, async (req, reply) => { const out = learning.createLesson(req.ctx, param(req, 'id'), parse(lessonCreateSchema, req.body)); reply.code(201); return out; });
  def(app, { method: 'GET', path: '/admin/lessons/:id', summary: 'One lesson for its editor', ...admin }, async (req) => learning.adminLessonDetail(req.ctx, param(req, 'id')));
  def(app, { method: 'PATCH', path: '/admin/lessons/:id', summary: 'Edit a lesson (or move it to another module of its course)', ...admin, rateLimit: WRITE_LIMIT, body: lessonPatchSchema }, async (req) => learning.updateLesson(req.ctx, param(req, 'id'), parse(lessonPatchSchema, req.body)));
  def(app, { method: 'POST', path: '/admin/lessons/:id/publish', summary: 'Publish a lesson (a video lesson needs a video host: pending configuration)', ...admin, rateLimit: WRITE_LIMIT }, async (req) => learning.setLessonStatus(req.ctx, param(req, 'id'), 'published'));
  def(app, { method: 'POST', path: '/admin/lessons/:id/unpublish', summary: 'Return a lesson to draft (hidden from learners; their progress is kept)', ...admin, rateLimit: WRITE_LIMIT }, async (req) => learning.setLessonStatus(req.ctx, param(req, 'id'), 'draft'));
  def(app, { method: 'DELETE', path: '/admin/lessons/:id', summary: 'Delete a draft lesson nobody has opened', ...admin, rateLimit: WRITE_LIMIT }, async (req) => learning.deleteLesson(req.ctx, param(req, 'id')));

  /* ---------- administrators: a member's learning (members.manage) ---------- */
  def(app, { method: 'GET', path: '/admin/members/:id/learning', summary: 'A member’s courses and progress', tag: TAG, auth: 'admin', permission: 'members.manage', feature: FEATURE }, async (req) => learning.clientLearning(req.ctx, param(req, 'id'), { sharing: true }));
}
