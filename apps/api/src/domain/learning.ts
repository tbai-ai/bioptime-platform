/* M10 Learning: courses, their modules and lessons, enrolment, progress per learner, and courses a coach assigns.

   Who may do what (the routes check the role, the permission and the flag first; these functions check the record):
   - Administrators holding learning.manage write courses, modules and lessons. A course is a draft until published,
     can return to draft (unpublish) and can be archived; publishing needs at least one published lesson. A lesson is a
     draft or published; a video lesson is never published while no video hosting provider is configured
     (VIDEO_PROVIDER accepts only "none"), so video_provider and video_ref stay empty and the reason is named.
   - A member sees published lessons of published courses whose audience admits them: every member, members with an
     active (or paused) programme of one of the course's packages (access by package entitlement), or members a coach
     assigned the course to. Draft courses and draft lessons are invisible to members. Archived courses stay readable to
     those already enrolled; nobody new enrols.
   - Coaches are learners too, for courses with the audience 'coaches' (coach training).
   - The assigned coach assigns published member courses to their own clients (a package course only to clients who
     hold the package) and sees each client's learning. The courses the coach (or another coach) assigned are always
     visible to the client's coach, as plan tasks are; the courses the member chose or got with their package are what
     the member chose to learn, shown to the coach only while the member shares with their coach (coach_sharing).
   - Without that sharing, nothing a coach can see or do tells them about the member's own courses: the client record
     lists only coach-assigned courses (no hint that others exist), and assigning a course the member already has (in
     progress, finished or left) is accepted and answered exactly as a fresh assignment is. The enrolment becomes the
     coach's assignment from that moment (assigned_at, migration 0029): the member keeps their progress, and the coach
     sees only what happens from then on: the lessons finished since, and the course as completed once the member
     finishes it after the assignment. The same applies once a member stops sharing after a coach took over one of
     their courses. While the member shares, the coach sees the whole enrolment (and a finished course is named as such).
     The member is told truthfully: a new course is added to their Learn page, one already there is now followed by the
     coach, one they left comes back.
   - Administrators holding members.manage read a member's learning.
   - The member's data export (ApiModule.exportSections): their own enrolments as their Learn page shows them.

   Progress counts published lessons only: { completed, total, pct }, pct null when a course has no published lesson.
   Nothing is invented: course and lesson text is what administrators write in the course editor (the seeded course
   explains how Learn works and says it is not health advice). No accreditation, certificates or CPD. Every mutation
   is audited. */
import type { Ctx } from '../context.js';
import { j } from '../db/db.js';
import { randomId } from '../lib/ids.js';
import { AppError, errors } from '../lib/errors.js';
import { coachHasMember, requireHealthAccess, requirePermission, requireRole } from '../auth/permissions.js';
import { audit } from './audit.js';
import { notify } from './notifications.js';
import { sanitizeRichText } from './content.js';
import { liveAsset } from './assets.js';

export const AUDIENCES = ['all_members', 'packages', 'assigned_only', 'coaches'] as const;
export const LESSON_KINDS = ['written', 'video', 'checklist'] as const;
export type Audience = (typeof AUDIENCES)[number];
export type LessonKind = (typeof LESSON_KINDS)[number];
export type Access = 'all_members' | 'package' | 'coach_assigned' | 'coaches';

const newId = {
  course: () => randomId('crs'),
  module: () => randomId('cmd'),
  lesson: () => randomId('lsn'),
  enrollment: () => randomId('cen'),
};

/* ---------- rows ---------- */

type CourseRow = { id: string; slug: string; title: string; summary: string; cover_asset_id: string | null; audience: Audience; package_ids: string; status: 'draft' | 'published' | 'archived'; sample: number; created_by: string | null; created_at: string; updated_at: string; published_at: string | null; archived_at: string | null };
type ModuleRow = { id: string; course_id: string; title: string; sort: number; created_at: string; updated_at: string };
type LessonRow = { id: string; module_id: string; title: string; kind: LessonKind; body: string; video_provider: string | null; video_ref: string | null; duration_minutes: number | null; sort: number; status: 'draft' | 'published'; created_at: string; updated_at: string };
/** assigned_at: when a coach's assignment began (equal to enrolled_at when the assignment created the enrolment; later
 *  when it took over one the member made). Null for the member's own enrolments. */
type EnrollmentRow = { id: string; course_id: string; member_id: string; source: 'self' | 'coach_assigned' | 'package'; assigned_by: string | null; assigned_note: string | null; status: 'active' | 'completed' | 'withdrawn'; enrolled_at: string; completed_at: string | null; updated_at: string; assigned_at: string | null };
type ProgressRow = { enrollment_id: string; lesson_id: string; status: 'started' | 'completed'; started_at: string; completed_at: string | null };
type Learner = { id: string; role: 'member' | 'coach' };

/* ---------- video hosting (pending configuration) ---------- */

/** Video lessons need a video host; none is configured (VIDEO_PROVIDER accepts only "none"). */
export function videoConfigured(ctx: Ctx): boolean { return (ctx.config.VIDEO_PROVIDER as string) !== 'none'; }
export function videoStatus(ctx: Ctx) {
  const configured = videoConfigured(ctx);
  return {
    status: configured ? ('live' as const) : ('pending_configuration' as const),
    provider: ctx.config.VIDEO_PROVIDER,
    missing: configured ? [] : [`A video hosting provider: VIDEO_PROVIDER accepts only "none" (currently "${ctx.config.VIDEO_PROVIDER}")`],
    note: 'Video lessons stay in draft until a video host is configured. Written and checklist lessons work today.',
  };
}

/* ---------- small helpers ---------- */

export function slugify(title: string): string {
  const s = title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return s || 'course';
}

/** Rich text to plain text for the app: block ends become line breaks, list items get a bullet, entities are decoded. */
export function toPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<\/(p|li|h3|ul|ol)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function plain(value: string): string { return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/<\/?[a-zA-Z][^>]*>|<!--[\s\S]*?-->/g, '').trim(); }

const pct = (done: number, total: number): number | null => (total > 0 ? Math.round((done / total) * 100) : null);
const nameOf = (ctx: Ctx, id: string | null): string | null => (id ? ctx.db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', [id])?.name ?? null : null);

function courseRow(ctx: Ctx, id: string): CourseRow | undefined { return ctx.db.get<CourseRow>('SELECT * FROM courses WHERE id = ?', [id]); }
function moduleRow(ctx: Ctx, id: string): ModuleRow | undefined { return ctx.db.get<ModuleRow>('SELECT * FROM course_modules WHERE id = ?', [id]); }
function lessonRow(ctx: Ctx, id: string): (LessonRow & { course_id: string; module_title: string }) | undefined {
  return ctx.db.get<LessonRow & { course_id: string; module_title: string }>('SELECT l.*, m.course_id AS course_id, m.title AS module_title FROM lessons l JOIN course_modules m ON m.id = l.module_id WHERE l.id = ?', [id]);
}
function enrollmentOf(ctx: Ctx, courseId: string, learnerId: string): EnrollmentRow | undefined {
  return ctx.db.get<EnrollmentRow>('SELECT * FROM course_enrollments WHERE course_id = ? AND member_id = ?', [courseId, learnerId]);
}
function modulesOf(ctx: Ctx, courseId: string): ModuleRow[] {
  return ctx.db.all<ModuleRow>('SELECT * FROM course_modules WHERE course_id = ? ORDER BY sort, created_at', [courseId]);
}
/** The course's lessons in reading order (module order, then lesson order). */
function lessonsOf(ctx: Ctx, courseId: string, publishedOnly: boolean): Array<LessonRow & { module_title: string }> {
  return ctx.db.all<LessonRow & { module_title: string }>(`SELECT l.*, m.title AS module_title FROM lessons l JOIN course_modules m ON m.id = l.module_id WHERE m.course_id = ? ${publishedOnly ? "AND l.status = 'published'" : ''} ORDER BY m.sort, m.created_at, l.sort, l.created_at`, [courseId]);
}
function progressOf(ctx: Ctx, enrollmentId: string): Map<string, ProgressRow> {
  return new Map(ctx.db.all<ProgressRow>('SELECT * FROM lesson_progress WHERE enrollment_id = ?', [enrollmentId]).map((p) => [p.lesson_id, p]));
}

/** The packages a member holds through an active or paused programme. */
export function memberPackageIds(ctx: Ctx, memberId: string): string[] {
  return ctx.db.all<{ package_id: string }>("SELECT DISTINCT v.package_id FROM programmes g JOIN package_versions v ON v.id = g.package_version_id WHERE g.member_id = ? AND g.status IN ('active','paused')", [memberId]).map((r) => r.package_id);
}

/** Why this learner may take this course, or null. A coach's assignment admits a member to any member course; the
 *  audience 'coaches' admits coaches only. */
function accessOf(ctx: Ctx, c: CourseRow, learner: Learner, enrollment: EnrollmentRow | undefined): Access | null {
  if (learner.role === 'coach') return c.audience === 'coaches' ? 'coaches' : null;
  if (c.audience === 'coaches') return null;
  if (enrollment?.source === 'coach_assigned') return 'coach_assigned';
  if (c.audience === 'all_members') return 'all_members';
  if (c.audience === 'packages') {
    const held = new Set(memberPackageIds(ctx, learner.id));
    return j.out<string[]>(c.package_ids, []).some((p) => held.has(p)) ? 'package' : null;
  }
  return null; // assigned_only without an assignment
}

function learnerOf(ctx: Ctx): Learner {
  const actor = requireRole(ctx, 'member', 'coach');
  return { id: actor.id, role: actor.role as 'member' | 'coach' };
}

/* ---------- presenting ---------- */

/** The cover while its image is in the library (with its size, so a page can reserve the box: cr-9); a cover whose
 *  image was deleted reads as no cover rather than a broken image (cr-6). */
function cover(ctx: Ctx, c: CourseRow) {
  const a = liveAsset(ctx, c.cover_asset_id);
  return a ? { assetId: a.assetId, url: a.url, width: a.width, height: a.height } : null;
}

function courseBase(ctx: Ctx, c: CourseRow) {
  return { id: c.id, slug: c.slug, title: c.title, summary: c.summary, audience: c.audience, status: c.status, sample: !!c.sample, cover: cover(ctx, c), publishedAt: c.published_at, updatedAt: c.updated_at };
}

function counts(ctx: Ctx, courseId: string) {
  const published = lessonsOf(ctx, courseId, true);
  return { modules: new Set(published.map((l) => l.module_id)).size, lessons: published.length, minutes: published.some((l) => l.duration_minutes) ? published.reduce((s, l) => s + (l.duration_minutes ?? 0), 0) : null };
}

function progressSummary(ctx: Ctx, enrollmentId: string, courseId: string) {
  const published = lessonsOf(ctx, courseId, true);
  const p = progressOf(ctx, enrollmentId);
  const completed = published.filter((l) => p.get(l.id)?.status === 'completed').length;
  const lastActivityAt = [...p.values()].map((r) => r.completed_at ?? r.started_at).sort().at(-1) ?? null;
  return { completed, total: published.length, pct: pct(completed, published.length), lastActivityAt };
}

function presentEnrollment(ctx: Ctx, e: EnrollmentRow) {
  return {
    id: e.id, source: e.source, status: e.status, enrolledAt: e.enrolled_at, completedAt: e.completed_at,
    assignedByName: nameOf(ctx, e.assigned_by), assignedNote: e.assigned_note, progress: progressSummary(ctx, e.id, e.course_id),
  };
}

/** The outline a learner reads: modules with their published lessons (a module without one is left out). */
function outline(ctx: Ctx, courseId: string, enrollment: EnrollmentRow | undefined) {
  const lessons = lessonsOf(ctx, courseId, true);
  const p = enrollment ? progressOf(ctx, enrollment.id) : new Map<string, ProgressRow>();
  return modulesOf(ctx, courseId).map((m) => ({
    id: m.id, title: m.title,
    lessons: lessons.filter((l) => l.module_id === m.id).map((l) => ({ id: l.id, title: l.title, kind: l.kind, durationMinutes: l.duration_minutes, progress: p.get(l.id)?.status ?? null })),
  })).filter((m) => m.lessons.length > 0);
}

function nextLessonId(ctx: Ctx, courseId: string, enrollment: EnrollmentRow | undefined): string | null {
  const lessons = lessonsOf(ctx, courseId, true);
  if (!enrollment) return lessons[0]?.id ?? null;
  const p = progressOf(ctx, enrollment.id);
  return lessons.find((l) => p.get(l.id)?.status !== 'completed')?.id ?? null;
}

/* ---------- learners (members, and coaches for coach training) ---------- */

/** A course this learner may read: published (or archived and already enrolled), and an audience that admits them.
 *  Not found when they may not know of it; COURSE_ACCESS_ENDED when they were enrolled but no longer qualify (a
 *  package course after the package ended). */
function readableCourse(ctx: Ctx, learner: Learner, courseId: string) {
  const c = courseRow(ctx, courseId);
  if (!c || c.status === 'draft') throw errors.notFound('Course');
  if ((learner.role === 'coach') !== (c.audience === 'coaches')) throw errors.notFound('Course');
  const e = enrollmentOf(ctx, c.id, learner.id);
  const enrolled = !!e && e.status !== 'withdrawn';
  if (c.status === 'archived' && !enrolled) throw errors.notFound('Course');
  const access = accessOf(ctx, c, learner, e);
  if (!access) {
    if (enrolled) throw errors.forbidden('Your access to this course has ended: it comes with a package you no longer hold. Your progress is kept.', 'COURSE_ACCESS_ENDED');
    throw errors.notFound('Course');
  }
  return { c, e, access };
}

/** My learning: the courses I am enrolled in (with progress) and the published ones I may start. */
export function myCourses(ctx: Ctx) {
  const learner = learnerOf(ctx);
  const audienceSql = learner.role === 'coach' ? "c.audience = 'coaches'" : "c.audience <> 'coaches'";
  const enrolledRows = ctx.db.all<CourseRow & { e_id: string }>(`SELECT c.*, e.id AS e_id FROM course_enrollments e JOIN courses c ON c.id = e.course_id WHERE e.member_id = ? AND e.status <> 'withdrawn' AND c.status IN ('published','archived') AND ${audienceSql} ORDER BY e.updated_at DESC`, [learner.id]);
  const enrolled = enrolledRows.map((c) => {
    const e = ctx.db.get<EnrollmentRow>('SELECT * FROM course_enrollments WHERE id = ?', [c.e_id])!;
    const access = accessOf(ctx, c, learner, e);
    return { ...courseBase(ctx, c), ...counts(ctx, c.id), access, locked: !access, enrollment: presentEnrollment(ctx, e), nextLessonId: access ? nextLessonId(ctx, c.id, e) : null };
  });
  const enrolledIds = new Set(enrolled.map((c) => c.id));
  const available = ctx.db.all<CourseRow>(`SELECT c.* FROM courses c WHERE c.status = 'published' AND ${audienceSql} ORDER BY c.published_at DESC, c.title`)
    .filter((c) => !enrolledIds.has(c.id))
    .map((c) => ({ c, access: accessOf(ctx, c, learner, enrollmentOf(ctx, c.id, learner.id)) }))
    .filter((x) => x.access)
    .map(({ c, access }) => ({ ...courseBase(ctx, c), ...counts(ctx, c.id), access, enrollment: null, nextLessonId: nextLessonId(ctx, c.id, undefined) }))
    .filter((c) => c.lessons > 0);
  return { enrolled, available, video: videoStatus(ctx) };
}

/** One course as a learner sees it: the outline of published lessons with my progress. */
export function myCourse(ctx: Ctx, courseId: string) {
  const learner = learnerOf(ctx);
  const { c, e, access } = readableCourse(ctx, learner, courseId);
  const enrollment = e && e.status !== 'withdrawn' ? e : undefined;
  return {
    ...courseBase(ctx, c), ...counts(ctx, c.id), access, archived: c.status === 'archived',
    enrollment: enrollment ? presentEnrollment(ctx, enrollment) : null,
    modules: outline(ctx, c.id, enrollment), nextLessonId: nextLessonId(ctx, c.id, enrollment), video: videoStatus(ctx),
  };
}

function insertEnrollment(ctx: Ctx, courseId: string, learnerId: string, source: EnrollmentRow['source'], meta: { assignedBy?: string | null; note?: string | null } = {}): EnrollmentRow {
  const id = newId.enrollment();
  const now = ctx.now();
  ctx.db.insert('course_enrollments', { id, course_id: courseId, member_id: learnerId, source, assigned_by: meta.assignedBy ?? null, assigned_note: meta.note ?? null, status: 'active', enrolled_at: now, completed_at: null, updated_at: now, assigned_at: source === 'coach_assigned' ? now : null });
  return ctx.db.get<EnrollmentRow>('SELECT * FROM course_enrollments WHERE id = ?', [id])!;
}

/** Enrol in a published course the audience admits me to (audited as course.enroll). Enrolling again is harmless;
 *  rejoining a course I left keeps my progress. */
export function enroll(ctx: Ctx, courseId: string) {
  const learner = learnerOf(ctx);
  const c = courseRow(ctx, courseId);
  if (!c || c.status === 'draft' || (learner.role === 'coach') !== (c.audience === 'coaches')) throw errors.notFound('Course');
  const e = enrollmentOf(ctx, c.id, learner.id);
  if (c.status === 'archived') {
    if (e && e.status !== 'withdrawn') return myCourse(ctx, c.id);
    throw errors.conflict('This course has been retired and takes no new learners', 'COURSE_ARCHIVED');
  }
  const access = accessOf(ctx, c, learner, e);
  if (!access) {
    if (c.audience === 'packages') throw errors.forbidden('This course comes with a package you do not hold', 'PACKAGE_REQUIRED');
    throw errors.notFound('Course');
  }
  if (!lessonsOf(ctx, c.id, true).length) throw errors.conflict('This course has no lessons yet', 'COURSE_EMPTY');
  ctx.db.tx(() => {
    if (e && e.status !== 'withdrawn') return;
    if (e) {
      ctx.db.update('course_enrollments', e.id, { status: 'active', completed_at: null, updated_at: ctx.now() });
      audit(ctx, 'course.enroll', { type: 'course_enrollment', id: e.id }, null, { courseId: c.id, source: e.source, rejoined: true });
      refreshCompletion(ctx, e.id, c.id);
      return;
    }
    const made = insertEnrollment(ctx, c.id, learner.id, access === 'package' ? 'package' : 'self');
    audit(ctx, 'course.enroll', { type: 'course_enrollment', id: made.id }, null, { courseId: c.id, source: made.source });
  });
  return myCourse(ctx, c.id);
}

/** Leave a course (status withdrawn, audited as course.leave). Progress is kept; enrolling again picks it up. */
export function leave(ctx: Ctx, courseId: string) {
  const learner = learnerOf(ctx);
  const c = courseRow(ctx, courseId);
  const e = c ? enrollmentOf(ctx, c.id, learner.id) : undefined;
  if (!c || !e || e.status === 'withdrawn' || (learner.role === 'coach') !== (c.audience === 'coaches')) throw errors.notFound('Enrolment');
  ctx.db.update('course_enrollments', e.id, { status: 'withdrawn', updated_at: ctx.now() });
  audit(ctx, 'course.leave', { type: 'course_enrollment', id: e.id }, null, { courseId: c.id, source: e.source, from: e.status });
  return { ok: true, courseId: c.id, status: 'withdrawn' as const };
}

/** One lesson as a learner reads it: the text, where it sits, my progress and the lessons either side. Draft lessons
 *  and lessons of courses I may not take are not found. */
export function myLesson(ctx: Ctx, lessonId: string) {
  const learner = learnerOf(ctx);
  const l = lessonRow(ctx, lessonId);
  if (!l || l.status !== 'published') throw errors.notFound('Lesson');
  const { c, e } = readableCourse(ctx, learner, l.course_id);
  const enrollment = e && e.status !== 'withdrawn' ? e : undefined;
  return presentLesson(ctx, c, l, enrollment);
}

function presentLesson(ctx: Ctx, c: CourseRow, l: LessonRow & { module_title: string; module_id: string }, enrollment: EnrollmentRow | undefined) {
  const order = lessonsOf(ctx, c.id, true);
  const i = order.findIndex((x) => x.id === l.id);
  const p = enrollment ? progressOf(ctx, enrollment.id).get(l.id) : undefined;
  return {
    id: l.id, title: l.title, kind: l.kind, body: l.body, bodyText: toPlainText(l.body), durationMinutes: l.duration_minutes,
    video: l.kind === 'video' ? { ...videoStatus(ctx), ref: null } : null,
    course: { id: c.id, title: c.title, sample: !!c.sample, status: c.status }, module: { id: l.module_id, title: l.module_title },
    position: { index: i + 1, of: order.length }, prevLessonId: i > 0 ? order[i - 1]!.id : null, nextLessonId: i >= 0 && i < order.length - 1 ? order[i + 1]!.id : null,
    enrolled: !!enrollment, progress: p ? { status: p.status, startedAt: p.started_at, completedAt: p.completed_at } : null,
    courseProgress: enrollment ? progressSummary(ctx, enrollment.id, c.id) : null, enrollmentStatus: enrollment?.status ?? null,
  };
}

/** Note that I opened a lesson (once; audited as lesson.start). Only while enrolled; otherwise nothing is recorded. */
export function startLesson(ctx: Ctx, lessonId: string) {
  const learner = learnerOf(ctx);
  const l = lessonRow(ctx, lessonId);
  if (!l || l.status !== 'published') throw errors.notFound('Lesson');
  const { c, e } = readableCourse(ctx, learner, l.course_id);
  if (!e || e.status === 'withdrawn') return { recorded: false, enrolled: false };
  const have = ctx.db.get<ProgressRow>('SELECT * FROM lesson_progress WHERE enrollment_id = ? AND lesson_id = ?', [e.id, l.id]);
  if (have) return { recorded: false, enrolled: true, status: have.status };
  ctx.db.insert('lesson_progress', { enrollment_id: e.id, lesson_id: l.id, status: 'started', started_at: ctx.now(), completed_at: null });
  audit(ctx, 'lesson.start', { type: 'lesson', id: l.id }, null, { courseId: c.id, enrollmentId: e.id });
  return { recorded: true, enrolled: true, status: 'started' as const };
}

/** Mark a lesson complete (audited as lesson.complete). Enrols me first if I was not (or rejoins a course I left);
 *  the course is complete once every published lesson is (audited as course.complete). */
export function completeLesson(ctx: Ctx, lessonId: string) {
  const learner = learnerOf(ctx);
  const l = lessonRow(ctx, lessonId);
  if (!l || l.status !== 'published') throw errors.notFound('Lesson');
  const { c, e, access } = readableCourse(ctx, learner, l.course_id);
  const now = ctx.now();
  const enrollment = ctx.db.tx(() => {
    let en = e;
    if (!en) {
      en = insertEnrollment(ctx, c.id, learner.id, access === 'package' ? 'package' : 'self');
      audit(ctx, 'course.enroll', { type: 'course_enrollment', id: en.id }, null, { courseId: c.id, source: en.source, via: 'lesson' });
    } else if (en.status === 'withdrawn') {
      if (c.status === 'archived') throw errors.conflict('This course has been retired and takes no new learners', 'COURSE_ARCHIVED');
      ctx.db.update('course_enrollments', en.id, { status: 'active', updated_at: now });
      audit(ctx, 'course.enroll', { type: 'course_enrollment', id: en.id }, null, { courseId: c.id, source: en.source, rejoined: true, via: 'lesson' });
    }
    const have = ctx.db.get<ProgressRow>('SELECT * FROM lesson_progress WHERE enrollment_id = ? AND lesson_id = ?', [en.id, l.id]);
    if (have?.status !== 'completed') {
      if (have) ctx.db.run("UPDATE lesson_progress SET status = 'completed', completed_at = ? WHERE enrollment_id = ? AND lesson_id = ?", [now, en.id, l.id]);
      else ctx.db.insert('lesson_progress', { enrollment_id: en.id, lesson_id: l.id, status: 'completed', started_at: now, completed_at: now });
      ctx.db.update('course_enrollments', en.id, { updated_at: now });
      audit(ctx, 'lesson.complete', { type: 'lesson', id: l.id }, null, { courseId: c.id, enrollmentId: en.id });
    }
    refreshCompletion(ctx, en.id, c.id);
    return ctx.db.get<EnrollmentRow>('SELECT * FROM course_enrollments WHERE id = ?', [en.id])!;
  });
  return presentLesson(ctx, c, l, enrollment);
}

/** An active enrolment whose published lessons are all complete becomes completed (audited as course.complete). */
function refreshCompletion(ctx: Ctx, enrollmentId: string, courseId: string): void {
  const e = ctx.db.get<EnrollmentRow>('SELECT * FROM course_enrollments WHERE id = ?', [enrollmentId]);
  if (!e || e.status !== 'active') return;
  const s = progressSummary(ctx, enrollmentId, courseId);
  if (s.total > 0 && s.completed === s.total) {
    const now = ctx.now();
    ctx.db.update('course_enrollments', e.id, { status: 'completed', completed_at: now, updated_at: now });
    audit(ctx, 'course.complete', { type: 'course_enrollment', id: e.id }, null, { courseId, lessons: s.total });
  }
}

/* ---------- coaches: the member courses they may assign, and their clients' learning ---------- */

function packageNames(ctx: Ctx, ids: string[]): Array<{ id: string; name: string }> {
  if (!ids.length) return [];
  return ctx.db.all<{ id: string; name: string }>(`SELECT id, name FROM packages WHERE id IN (${ids.map(() => '?').join(', ')}) ORDER BY sort, name`, ids);
}

/** Published member courses a coach may assign, each with its outline (lesson titles) and the packages it needs. */
export function coachCatalogue(ctx: Ctx) {
  requireRole(ctx, 'coach');
  return ctx.db.all<CourseRow>("SELECT * FROM courses WHERE status = 'published' AND audience <> 'coaches' ORDER BY title")
    .map((c) => ({ ...courseBase(ctx, c), ...counts(ctx, c.id), packages: c.audience === 'packages' ? packageNames(ctx, j.out<string[]>(c.package_ids, [])) : [], modules: outline(ctx, c.id, undefined) }))
    .filter((c) => c.lessons > 0);
}

/** One published member course, for a coach to read before assigning it. */
export function coachCourse(ctx: Ctx, courseId: string) {
  requireRole(ctx, 'coach');
  const c = courseRow(ctx, courseId);
  if (!c || c.status !== 'published' || c.audience === 'coaches') throw errors.notFound('Course');
  return { ...courseBase(ctx, c), ...counts(ctx, c.id), packages: c.audience === 'packages' ? packageNames(ctx, j.out<string[]>(c.package_ids, [])) : [], modules: outline(ctx, c.id, undefined), nextLessonId: nextLessonId(ctx, c.id, undefined), video: videoStatus(ctx) };
}

/** A lesson for a coach: a coach-training lesson with the coach's own progress, or a published lesson of a published
 *  member course to read before assigning it (no progress). */
export function coachLesson(ctx: Ctx, lessonId: string) {
  requireRole(ctx, 'coach');
  const l = lessonRow(ctx, lessonId);
  if (!l || l.status !== 'published') throw errors.notFound('Lesson');
  const c = courseRow(ctx, l.course_id);
  if (!c) throw errors.notFound('Lesson');
  if (c.audience === 'coaches') return { ...myLesson(ctx, lessonId), preview: false };
  if (c.status !== 'published') throw errors.notFound('Lesson');
  return { ...presentLesson(ctx, c, l, undefined), preview: true };
}

/** The assigned coach assigns a published member course to a client, with an optional note; the member is notified
 *  (category learning). A package course only for a client who holds one of its packages. Audited as course.assign. */
export function assignCourse(ctx: Ctx, memberId: string, input: { courseId: string; note?: string | null }) {
  const actor = requireRole(ctx, 'coach');
  if (!coachHasMember(ctx, actor.id, memberId)) throw errors.forbidden('Not your client', 'NO_ACCESS');
  const c = courseRow(ctx, input.courseId);
  if (!c || c.status !== 'published' || c.audience === 'coaches') throw errors.notFound('Course');
  if (!lessonsOf(ctx, c.id, true).length) throw errors.conflict('This course has no lessons yet', 'COURSE_EMPTY');
  if (c.audience === 'packages') {
    const held = new Set(memberPackageIds(ctx, memberId));
    if (!j.out<string[]>(c.package_ids, []).some((p) => held.has(p))) throw errors.conflict('This course comes with a package your client does not hold', 'PACKAGE_REQUIRED');
  }
  const note = input.note?.trim() ? plain(input.note).slice(0, 500) : null;
  const e = enrollmentOf(ctx, c.id, memberId);
  const sharing = e ? sharesWithCoach(ctx, memberId) : false;
  // the refusals describe only what this coach may already see of the enrolment. Without the member's sharing, an
  // enrolment the member made themselves (in progress, finished or left) is treated exactly as no enrolment: it is
  // taken over below and answered as a fresh assignment is, so the answer says nothing about it
  const seen = e ? coachViewOf(e, sharing) : null;
  if (e && seen) {
    const shown = presentEnrollmentForRecord(ctx, e, actor.id, seen);
    if (shown.status === 'completed') throw errors.conflict('Your client has already completed this course', 'ALREADY_COMPLETED');
    if (shown.status === 'active' && e.source === 'coach_assigned') throw errors.conflict('This course is already assigned to your client', 'ALREADY_ASSIGNED');
  }
  const now = ctx.now();
  const enrollmentId = ctx.db.tx(() => {
    let id: string;
    if (e) {
      // the member keeps their status and progress (a course they left is open again); the assignment starts now, and
      // a coach without the member's sharing sees only what happens from then on
      const assignedAt = e.source === 'coach_assigned' ? e.assigned_at ?? e.enrolled_at : takeoverTime(ctx, e, now);
      ctx.db.update('course_enrollments', e.id, { source: 'coach_assigned', assigned_by: actor.id, assigned_note: note, status: e.status === 'withdrawn' ? 'active' : e.status, assigned_at: assignedAt, updated_at: now });
      if (e.status === 'withdrawn') refreshCompletion(ctx, e.id, c.id); // as rejoining does: a course already finished reads as completed to the member
      id = e.id;
    } else id = insertEnrollment(ctx, c.id, memberId, 'coach_assigned', { assignedBy: actor.id, note }).id;
    audit(ctx, 'course.assign', { type: 'course_enrollment', id }, null, { courseId: c.id, memberId, previous: e ? { source: e.source, status: e.status } : null, withNote: !!note });
    notify(ctx, { userId: memberId, category: 'learning', ...assignMessage(actor.name, c.title, e), data: { courseId: c.id, enrollmentId: id } });
    return id;
  });
  const row = ctx.db.get<EnrollmentRow>('SELECT * FROM course_enrollments WHERE id = ?', [enrollmentId])!;
  return presentEnrollmentForRecord(ctx, row, actor.id, sharing ? 'full' : 'since_assignment');
}

/** What the member is told about an assignment, true to their Learn page: a new course is added to it; a course already
 *  on it (in progress or finished) stays where it is and the coach now follows it; a course they left comes back to it.
 *  Their progress is kept in both of the last two cases. */
function assignMessage(coachName: string, courseTitle: string, e: EnrollmentRow | undefined): { title: string; body: string } {
  if (!e) return { title: 'A course from your coach', body: `${coachName} added “${courseTitle}” to your Learn page.` };
  if (e.status === 'withdrawn') return { title: 'A course from your coach', body: `${coachName} added “${courseTitle}” back to your Learn page. Your progress on it is kept.` };
  return { title: 'Your coach is following your course', body: `${coachName} is now following your course “${courseTitle}”. Your progress on it is kept.` };
}

/** When a coach's assignment takes over an enrolment the member made: now, or just after the member's last recorded
 *  activity on it if the clock says otherwise, so nothing the member did before counts as after the assignment. */
function takeoverTime(ctx: Ctx, e: EnrollmentRow, now: string): string {
  const p = ctx.db.get<{ s: string | null; c: string | null }>('SELECT MAX(started_at) s, MAX(completed_at) c FROM lesson_progress WHERE enrollment_id = ?', [e.id]);
  const latest = [e.enrolled_at, e.updated_at, e.completed_at, p?.s ?? null, p?.c ?? null].filter((t): t is string => !!t).sort().at(-1)!;
  return now > latest ? now : new Date(Date.parse(latest) + 1).toISOString();
}

/** How much of an enrolment a coach sees: everything while the member shares with their coach ('full'); without that,
 *  a coach-assigned course from its assignment on ('since_assignment'), and nothing of the member's own (null). */
type CoachView = 'full' | 'since_assignment';
function coachViewOf(e: EnrollmentRow, sharing: boolean): CoachView | null {
  if (sharing) return 'full';
  return e.source === 'coach_assigned' ? 'since_assignment' : null;
}

/** The moment before which a 'since_assignment' view hides the enrolment: the assignment, when it took over an
 *  enrolment the member made earlier; null when the assignment created the enrolment (nothing predates it). */
function hiddenBefore(e: EnrollmentRow): string | null {
  return e.source === 'coach_assigned' && e.assigned_at && e.assigned_at > e.enrolled_at ? e.assigned_at : null;
}

/** Progress counting only the lessons completed (and the activity) at or after `from`. */
function progressSince(ctx: Ctx, enrollmentId: string, courseId: string, from: string) {
  const published = lessonsOf(ctx, courseId, true);
  const p = progressOf(ctx, enrollmentId);
  const completed = published.filter((l) => { const r = p.get(l.id); return r?.status === 'completed' && !!r.completed_at && r.completed_at >= from; }).length;
  const lastActivityAt = [...p.values()].flatMap((r) => [r.started_at, r.completed_at]).filter((t): t is string => !!t && t >= from).sort().at(-1) ?? null;
  return { completed, total: published.length, pct: pct(completed, published.length), lastActivityAt };
}

/** An enrolment for the client record. 'full' is the whole enrolment. 'since_assignment' (a coach without the member's
 *  sharing) shows the activity from the assignment on, and only that: it begins at the assignment, counts the lessons
 *  finished since, and reads as completed (with its date) once the member finished the course after the assignment by
 *  finishing a lesson then. Lessons finished before the assignment stay out of the count, so a course the member was
 *  part way through can read as completed with fewer lessons counted than it has, and a course they had already
 *  finished before the assignment shows no activity, since nothing happened after it. */
function presentEnrollmentForRecord(ctx: Ctx, e: EnrollmentRow, viewerId: string | null, view: CoachView = 'full') {
  const c = courseRow(ctx, e.course_id)!;
  const from = view === 'since_assignment' ? hiddenBefore(e) : null;
  const progress = from ? progressSince(ctx, e.id, c.id, from) : progressSummary(ctx, e.id, c.id);
  // a completion only counts from the assignment on when a lesson finished since then brought it about (the takeover of
  // a course the member had left and finished re-completes it at once, which is no activity of theirs)
  const completedShown = e.status === 'completed' && (!from || (!!e.completed_at && e.completed_at >= from && progress.completed > 0));
  const status = e.status === 'completed' && !completedShown ? 'active' : e.status;
  return {
    id: e.id, courseId: c.id, courseTitle: c.title, courseStatus: c.status, audience: c.audience, sample: !!c.sample,
    source: e.source, status, assignedByName: nameOf(ctx, e.assigned_by), assignedByMe: !!viewerId && e.assigned_by === viewerId, assignedNote: e.assigned_note,
    enrolledAt: from ?? e.enrolled_at, completedAt: from ? (completedShown ? e.completed_at : null) : e.completed_at, progress,
  };
}

/** Does the member share with their coach (coach_sharing, checked by requireHealthAccess)? The member and
 *  administrators always pass; a coach who is not assigned is refused outright. */
export function sharesWithCoach(ctx: Ctx, memberId: string): boolean {
  try { requireHealthAccess(ctx, memberId); return true; }
  catch (e) { if (e instanceof AppError && e.code === 'NOT_SHARED') return false; throw e; }
}

/** A member's learning for the client record. The assigned coach (checked by the route) always sees the courses a coach
 *  assigned, and the member's own choices and package courses only while the member shares with their coach; without
 *  that sharing, a coach-assigned course shows only what happened from its assignment on, and nothing in the answer
 *  says whether the member has courses of their own. An administrator (members.manage, checked by the route) sees
 *  everything. */
export function clientLearning(ctx: Ctx, memberId: string, opts: { sharing: boolean }) {
  const viewer = ctx.actor;
  const limited = viewer?.role === 'coach' && !opts.sharing;
  const rows = ctx.db.all<EnrollmentRow>("SELECT e.* FROM course_enrollments e JOIN courses c ON c.id = e.course_id WHERE e.member_id = ? AND c.audience <> 'coaches' ORDER BY e.updated_at DESC", [memberId]);
  const visible = limited ? rows.filter((e) => e.source === 'coach_assigned') : rows;
  return {
    memberId, sharing: opts.sharing,
    items: visible.map((e) => presentEnrollmentForRecord(ctx, e, viewer?.id ?? null, limited ? 'since_assignment' : 'full')),
  };
}

/** For the coach onboarding checklist (M4): whether training courses exist, and how many the coach has completed. */
export function coachTrainingSummary(ctx: Ctx, coachId: string) {
  const total = ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM courses WHERE status = 'published' AND audience = 'coaches'")!.n;
  const completed = ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM course_enrollments e JOIN courses c ON c.id = e.course_id WHERE e.member_id = ? AND e.status = 'completed' AND c.status = 'published' AND c.audience = 'coaches'", [coachId])!.n;
  return { available: total > 0, total, completed };
}

/* ---------- the member's data export (ApiModule.exportSections) ---------- */

const EXPORT_SOURCE = { self: 'You chose it', package: 'It came with your package', coach_assigned: 'Your coach assigned it' } as const;
const EXPORT_STATUS = { active: 'In progress', completed: 'Completed', withdrawn: 'Left (your progress is kept)' } as const;

/** The member's courses for their data export, as their Learn page shows them: every course they enrolled in (one they
 *  left included, since its progress is kept), how it came to them, the coach's name and note when a coach assigned it,
 *  its status, and their progress on its published lessons, lesson by lesson. Course and lesson text, lessons they have
 *  not opened, and what only the team sees (authors, enrolment counts, drafts) stay out: a course the team has taken
 *  back to draft, and progress on lessons now in draft, are only counted under leftOut, without their titles. */
export function exportForMember(ctx: Ctx, memberId: string) {
  const learner: Learner = { id: memberId, role: 'member' };
  const rows = ctx.db.all<CourseRow & { e_id: string }>("SELECT c.*, e.id AS e_id FROM course_enrollments e JOIN courses c ON c.id = e.course_id WHERE e.member_id = ? AND c.audience <> 'coaches' ORDER BY e.enrolled_at, e.id", [memberId]);
  const draftCourses = rows.filter((c) => c.status === 'draft').length;
  let draftLessons = 0;
  const enrolments = rows.filter((c) => c.status !== 'draft').map((c) => {
    const e = ctx.db.get<EnrollmentRow>('SELECT * FROM course_enrollments WHERE id = ?', [c.e_id])!;
    const published = lessonsOf(ctx, c.id, true);
    const p = progressOf(ctx, e.id);
    const shown = new Set(published.map((l) => l.id));
    draftLessons += [...p.keys()].filter((id) => !shown.has(id)).length;
    const s = progressSummary(ctx, e.id, c.id);
    return {
      course: c.title, sample: !!c.sample, retired: c.status === 'archived',
      howItCameToYou: EXPORT_SOURCE[e.source], assignedBy: nameOf(ctx, e.assigned_by), coachNote: e.assigned_note,
      status: EXPORT_STATUS[e.status], accessEnded: !accessOf(ctx, c, learner, e),
      enrolledAt: e.enrolled_at, completedAt: e.completed_at,
      progress: { completed: s.completed, total: s.total, pct: s.pct },
      lessons: published.filter((l) => p.has(l.id)).map((l) => { const r = p.get(l.id)!; return { module: l.module_title, lesson: l.title, status: r.status === 'completed' ? 'Completed' : 'Opened', openedAt: r.started_at, completedAt: r.completed_at }; }),
    };
  });
  const leftOut = [
    ...(draftCourses ? [{ what: 'Courses the Bioptime team has taken back to draft', why: 'They are not on your Learn page while in draft; your progress is kept and shows again when the course is published.', records: draftCourses }] : []),
    ...(draftLessons ? [{ what: 'Your progress on lessons the Bioptime team has taken back to draft', why: 'Those lessons are not on your Learn page while in draft; your progress is kept.', records: draftLessons }] : []),
  ];
  return { enrolments, leftOut };
}

/* ---------- administrators (learning.manage): courses ---------- */

export type CourseInput = { title: string; slug?: string; summary?: string; audience: Audience; packageIds?: string[]; coverAssetId?: string | null };
export type CoursePatch = Partial<CourseInput>;

function checkAudience(ctx: Ctx, audience: Audience, packageIds: string[] | undefined): string[] {
  const ids = [...new Set(packageIds ?? [])];
  if (audience !== 'packages') {
    if (ids.length) throw errors.badRequest('Packages apply only to the audience "packages"', 'AUDIENCE_INVALID');
    return [];
  }
  if (!ids.length) throw errors.badRequest('Choose at least one package for a package course', 'AUDIENCE_INVALID');
  const known = new Set(packageNames(ctx, ids).map((p) => p.id));
  const unknown = ids.filter((p) => !known.has(p));
  if (unknown.length) throw errors.badRequest(`Unknown package ${unknown.join(', ')}`, 'AUDIENCE_INVALID');
  return ids;
}

function checkCover(ctx: Ctx, assetId: string | null | undefined): string | null {
  if (!assetId) return null;
  if (!ctx.db.get('SELECT 1 FROM assets WHERE id = ? AND deleted_at IS NULL', [assetId])) throw errors.badRequest('That image is not in the image library', 'COVER_INVALID');
  return assetId;
}

function slugTaken(ctx: Ctx, slug: string, exceptId?: string): boolean {
  return !!ctx.db.get('SELECT 1 FROM courses WHERE slug = ? AND id <> ?', [slug, exceptId ?? '']);
}

function editable(c: CourseRow | undefined): CourseRow {
  if (!c) throw errors.notFound('Course');
  if (c.status === 'archived') throw errors.conflict('This course is archived: return it to draft before editing', 'COURSE_ARCHIVED');
  return c;
}

/** Create a course (a draft). The slug is made from the title unless given; a slug in use is refused. */
export function createCourse(ctx: Ctx, input: CourseInput, opts: { sample?: boolean } = {}) {
  const actor = requirePermission(ctx, 'learning.manage');
  const packageIds = checkAudience(ctx, input.audience, input.packageIds);
  const coverAssetId = checkCover(ctx, input.coverAssetId);
  const title = plain(input.title);
  if (title.length < 2) throw errors.badRequest('Give the course a title', 'TITLE_REQUIRED');
  let slug = input.slug ? input.slug : slugify(title);
  if (slugTaken(ctx, slug)) {
    if (input.slug) throw errors.conflict('A course with that slug exists', 'SLUG_IN_USE');
    let n = 2;
    while (slugTaken(ctx, `${slug}-${n}`)) n++;
    slug = `${slug}-${n}`;
  }
  const id = newId.course();
  const now = ctx.now();
  ctx.db.insert('courses', { id, slug, title, summary: plain(input.summary ?? ''), cover_asset_id: coverAssetId, audience: input.audience, package_ids: j.in(packageIds), status: 'draft', sample: opts.sample ? 1 : 0, created_by: actor.id, created_at: now, updated_at: now, published_at: null, archived_at: null });
  audit(ctx, 'course.create', { type: 'course', id }, null, { title, slug, audience: input.audience, packageIds });
  return adminCourse(ctx, id);
}

/** Edit a course's details. Audience changes apply at once: a learner who no longer qualifies keeps their progress
 *  but cannot open the course. */
export function updateCourse(ctx: Ctx, id: string, patch: CoursePatch) {
  requirePermission(ctx, 'learning.manage');
  const c = editable(courseRow(ctx, id));
  const audience = patch.audience ?? c.audience;
  const packageIds = patch.audience !== undefined || patch.packageIds !== undefined ? checkAudience(ctx, audience, patch.packageIds ?? (audience === 'packages' ? j.out<string[]>(c.package_ids, []) : [])) : undefined;
  const fields: Record<string, string | null | undefined> = {
    title: patch.title !== undefined ? plain(patch.title) : undefined,
    summary: patch.summary !== undefined ? plain(patch.summary) : undefined,
    audience: patch.audience,
    package_ids: packageIds !== undefined ? j.in(packageIds) : undefined,
    cover_asset_id: patch.coverAssetId !== undefined ? checkCover(ctx, patch.coverAssetId) : undefined,
    slug: patch.slug,
  };
  if (fields.title !== undefined && (fields.title ?? '').length < 2) throw errors.badRequest('Give the course a title', 'TITLE_REQUIRED');
  if (patch.slug !== undefined && slugTaken(ctx, patch.slug, c.id)) throw errors.conflict('A course with that slug exists', 'SLUG_IN_USE');
  const changed = Object.entries(fields).filter(([k, v]) => v !== undefined && v !== (c as Record<string, unknown>)[k]).map(([k]) => k);
  if (!changed.length) return adminCourse(ctx, c.id);
  ctx.db.update('courses', c.id, { ...Object.fromEntries(changed.map((k) => [k, fields[k] ?? null])), updated_at: ctx.now() });
  audit(ctx, 'course.update', { type: 'course', id: c.id }, null, { fields: changed.map((k) => ({ package_ids: 'packageIds', cover_asset_id: 'coverAssetId' } as Record<string, string>)[k] ?? k), ...(patch.audience !== undefined && patch.audience !== c.audience ? { audience: { from: c.audience, to: patch.audience } } : {}) });
  return adminCourse(ctx, c.id);
}

/** Publish, unpublish (back to draft, also how an archived course is restored) or archive a course, with a reason.
 *  Publishing needs at least one published lesson. */
export function setCourseStatus(ctx: Ctx, id: string, action: 'publish' | 'unpublish' | 'archive', reason: string) {
  requirePermission(ctx, 'learning.manage');
  if (!reason || reason.trim().length < 3) throw errors.badRequest('Say why: the reason is recorded in the audit log', 'REASON_REQUIRED');
  const c = courseRow(ctx, id);
  if (!c) throw errors.notFound('Course');
  const now = ctx.now();
  const to = action === 'publish' ? 'published' : action === 'unpublish' ? 'draft' : 'archived';
  if (action === 'publish') {
    if (c.status !== 'draft') throw errors.conflict(c.status === 'published' ? 'This course is already published' : 'Return the course to draft before publishing it again', 'COURSE_STATUS');
    if (!lessonsOf(ctx, c.id, true).length) throw errors.conflict('Publish at least one lesson before publishing the course', 'COURSE_NEEDS_LESSON');
    if (c.audience === 'packages' && !j.out<string[]>(c.package_ids, []).length) throw errors.conflict('Choose at least one package for a package course', 'AUDIENCE_INVALID');
    ctx.db.update('courses', c.id, { status: 'published', published_at: now, archived_at: null, updated_at: now });
  } else if (action === 'unpublish') {
    if (c.status === 'draft') throw errors.conflict('This course is already a draft', 'COURSE_STATUS');
    ctx.db.update('courses', c.id, { status: 'draft', archived_at: null, updated_at: now });
  } else {
    if (c.status === 'archived') throw errors.conflict('This course is already archived', 'COURSE_STATUS');
    ctx.db.update('courses', c.id, { status: 'archived', archived_at: now, updated_at: now });
  }
  audit(ctx, `course.${action}`, { type: 'course', id: c.id }, reason.trim(), { from: c.status, to });
  return adminCourse(ctx, c.id);
}

function adminLesson(ctx: Ctx, l: LessonRow) {
  const learners = ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM lesson_progress WHERE lesson_id = ? AND status = 'completed'", [l.id])!.n;
  return {
    id: l.id, moduleId: l.module_id, title: l.title, kind: l.kind, body: l.body, durationMinutes: l.duration_minutes, sort: l.sort, status: l.status,
    video: l.kind === 'video' ? { ...videoStatus(ctx), ref: null } : null, completedBy: learners, createdAt: l.created_at, updatedAt: l.updated_at,
  };
}

/** One course for its editor: every module and lesson (drafts included), with enrolment counts. */
export function adminCourse(ctx: Ctx, id: string) {
  requirePermission(ctx, 'learning.manage');
  const c = courseRow(ctx, id);
  if (!c) throw errors.notFound('Course');
  const lessons = lessonsOf(ctx, c.id, false);
  const enrolments = ctx.db.get<{ active: number; completed: number; withdrawn: number }>("SELECT SUM(status = 'active') active, SUM(status = 'completed') completed, SUM(status = 'withdrawn') withdrawn FROM course_enrollments WHERE course_id = ?", [c.id])!;
  const packageIds = j.out<string[]>(c.package_ids, []);
  return {
    ...courseBase(ctx, c), packageIds, packages: packageNames(ctx, packageIds), coverAssetId: liveAsset(ctx, c.cover_asset_id)?.assetId ?? null,
    createdBy: c.created_by, createdByName: nameOf(ctx, c.created_by), createdAt: c.created_at, archivedAt: c.archived_at,
    enrolments: { active: enrolments.active ?? 0, completed: enrolments.completed ?? 0, withdrawn: enrolments.withdrawn ?? 0 },
    lessonCounts: { published: lessons.filter((l) => l.status === 'published').length, draft: lessons.filter((l) => l.status === 'draft').length },
    modules: modulesOf(ctx, c.id).map((m) => ({ id: m.id, title: m.title, sort: m.sort, lessons: lessons.filter((l) => l.module_id === m.id).map((l) => adminLesson(ctx, l)) })),
    video: videoStatus(ctx),
  };
}

/** Every course, newest first, with its lesson and enrolment counts. */
export function adminCourses(ctx: Ctx, opts: { status?: 'draft' | 'published' | 'archived'; audience?: Audience } = {}) {
  requirePermission(ctx, 'learning.manage');
  const where: string[] = [];
  const params: string[] = [];
  if (opts.status) { where.push('c.status = ?'); params.push(opts.status); }
  if (opts.audience) { where.push('c.audience = ?'); params.push(opts.audience); }
  const rows = ctx.db.all<CourseRow & { published_lessons: number; draft_lessons: number; active: number; completed: number }>(`SELECT c.*,
      (SELECT COUNT(*) FROM lessons l JOIN course_modules m ON m.id = l.module_id WHERE m.course_id = c.id AND l.status = 'published') published_lessons,
      (SELECT COUNT(*) FROM lessons l JOIN course_modules m ON m.id = l.module_id WHERE m.course_id = c.id AND l.status = 'draft') draft_lessons,
      (SELECT COUNT(*) FROM course_enrollments e WHERE e.course_id = c.id AND e.status = 'active') active,
      (SELECT COUNT(*) FROM course_enrollments e WHERE e.course_id = c.id AND e.status = 'completed') completed
    FROM courses c ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY CASE c.status WHEN 'draft' THEN 0 WHEN 'published' THEN 1 ELSE 2 END, c.updated_at DESC LIMIT 500`, params);
  return {
    items: rows.map((r) => ({ ...courseBase(ctx, r), packages: packageNames(ctx, j.out<string[]>(r.package_ids, [])), lessonCounts: { published: r.published_lessons, draft: r.draft_lessons }, enrolments: { active: r.active, completed: r.completed } })),
    video: videoStatus(ctx),
  };
}

/** What the editor offers: the audiences, the packages a course can be tied to, website images for a cover, and the
 *  video hosting status. */
export function adminOptions(ctx: Ctx) {
  requirePermission(ctx, 'learning.manage');
  return {
    audiences: AUDIENCES, lessonKinds: LESSON_KINDS,
    packages: ctx.db.all<{ id: string; slug: string; name: string; kind: string; active: number; archived_at: string | null }>('SELECT id, slug, name, kind, active, archived_at FROM packages ORDER BY sort, name').map((p) => ({ id: p.id, slug: p.slug, name: p.name, kind: p.kind, active: !!p.active && !p.archived_at })),
    images: ctx.db.all<{ id: string; filename: string; alt: string }>('SELECT id, filename, alt FROM assets WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 200').map((a) => ({ id: a.id, filename: a.filename, alt: a.alt, url: `/api/public/assets/${a.id}` })),
    video: videoStatus(ctx),
  };
}

/* ---------- administrators: modules ---------- */

export function createModule(ctx: Ctx, courseId: string, input: { title: string }) {
  requirePermission(ctx, 'learning.manage');
  const c = editable(courseRow(ctx, courseId));
  const title = plain(input.title);
  if (title.length < 2) throw errors.badRequest('Give the module a title', 'TITLE_REQUIRED');
  const sort = (ctx.db.get<{ s: number | null }>('SELECT MAX(sort) s FROM course_modules WHERE course_id = ?', [c.id])!.s ?? 0) + 1;
  const id = newId.module();
  const now = ctx.now();
  ctx.db.insert('course_modules', { id, course_id: c.id, title, sort, created_at: now, updated_at: now });
  ctx.db.update('courses', c.id, { updated_at: now });
  audit(ctx, 'course.module_create', { type: 'course_module', id }, null, { courseId: c.id, title });
  return adminCourse(ctx, c.id);
}

export function updateModule(ctx: Ctx, moduleId: string, input: { title: string }) {
  requirePermission(ctx, 'learning.manage');
  const m = moduleRow(ctx, moduleId);
  if (!m) throw errors.notFound('Module');
  const c = editable(courseRow(ctx, m.course_id));
  const title = plain(input.title);
  if (title.length < 2) throw errors.badRequest('Give the module a title', 'TITLE_REQUIRED');
  const now = ctx.now();
  ctx.db.update('course_modules', m.id, { title, updated_at: now });
  ctx.db.update('courses', c.id, { updated_at: now });
  audit(ctx, 'course.module_update', { type: 'course_module', id: m.id }, null, { courseId: c.id, fields: ['title'] });
  return adminCourse(ctx, c.id);
}

/** Remove an empty module; a module with lessons is refused (move or delete its lessons first). */
export function deleteModule(ctx: Ctx, moduleId: string) {
  requirePermission(ctx, 'learning.manage');
  const m = moduleRow(ctx, moduleId);
  if (!m) throw errors.notFound('Module');
  const c = editable(courseRow(ctx, m.course_id));
  if (ctx.db.get('SELECT 1 FROM lessons WHERE module_id = ?', [m.id])) throw errors.conflict('Move or delete the module’s lessons first', 'MODULE_NOT_EMPTY');
  ctx.db.run('DELETE FROM course_modules WHERE id = ?', [m.id]);
  ctx.db.update('courses', c.id, { updated_at: ctx.now() });
  audit(ctx, 'course.module_delete', { type: 'course_module', id: m.id }, null, { courseId: c.id, title: m.title });
  return adminCourse(ctx, c.id);
}

/** Put a course's modules and lessons in a new order (lessons may move between the course's modules). The lists must
 *  name every module and every lesson of the course exactly once. */
export function reorderCourse(ctx: Ctx, courseId: string, order: { modules: Array<{ id: string; lessonIds: string[] }> }) {
  requirePermission(ctx, 'learning.manage');
  const c = editable(courseRow(ctx, courseId));
  const modules = modulesOf(ctx, c.id);
  const lessons = lessonsOf(ctx, c.id, false);
  const givenModules = order.modules.map((m) => m.id);
  const givenLessons = order.modules.flatMap((m) => m.lessonIds);
  const same = (a: string[], b: string[]) => a.length === b.length && new Set(a).size === a.length && a.every((x) => b.includes(x));
  if (!same(givenModules, modules.map((m) => m.id)) || !same(givenLessons, lessons.map((l) => l.id))) throw errors.badRequest('The order must list every module and lesson of this course once', 'ORDER_INVALID');
  const now = ctx.now();
  ctx.db.tx(() => {
    order.modules.forEach((m, i) => {
      ctx.db.update('course_modules', m.id, { sort: i + 1, updated_at: now });
      m.lessonIds.forEach((lid, k) => ctx.db.run('UPDATE lessons SET module_id = ?, sort = ?, updated_at = ? WHERE id = ?', [m.id, k + 1, now, lid]));
    });
    ctx.db.update('courses', c.id, { updated_at: now });
    audit(ctx, 'course.reorder', { type: 'course', id: c.id }, null, { modules: givenModules.length, lessons: givenLessons.length });
  });
  return adminCourse(ctx, c.id);
}

/* ---------- administrators: lessons ---------- */

export type LessonInput = { title: string; kind: LessonKind; body?: string; durationMinutes?: number | null };
export type LessonPatch = Partial<LessonInput> & { moduleId?: string };

const BODY_MAX = 20000;

function cleanBody(body: string | undefined): string {
  const b = body ?? '';
  if (b.length > BODY_MAX) throw errors.badRequest(`A lesson is limited to ${BODY_MAX} characters`, 'BODY_TOO_LONG');
  return sanitizeRichText(b);
}

function videoRefused(ctx: Ctx): AppError {
  const v = videoStatus(ctx);
  return new AppError('VIDEO_PROVIDER_NOT_CONFIGURED', 409, `A video lesson cannot be published yet. Missing: ${v.missing.join('; ')}`, { missing: v.missing });
}

function checkPublishable(ctx: Ctx, l: { kind: LessonKind; body: string }) {
  if (l.kind === 'video' && !videoConfigured(ctx)) throw videoRefused(ctx);
  if (l.kind !== 'video' && !toPlainText(l.body)) throw errors.conflict('Write the lesson before publishing it', 'LESSON_EMPTY');
}

/** Add a lesson to a module, as a draft. Bodies are kept to the CMS allowlist (sanitizeRichText). */
export function createLesson(ctx: Ctx, moduleId: string, input: LessonInput) {
  requirePermission(ctx, 'learning.manage');
  const m = moduleRow(ctx, moduleId);
  if (!m) throw errors.notFound('Module');
  const c = editable(courseRow(ctx, m.course_id));
  const title = plain(input.title);
  if (title.length < 2) throw errors.badRequest('Give the lesson a title', 'TITLE_REQUIRED');
  const sort = (ctx.db.get<{ s: number | null }>('SELECT MAX(sort) s FROM lessons WHERE module_id = ?', [m.id])!.s ?? 0) + 1;
  const id = newId.lesson();
  const now = ctx.now();
  ctx.db.insert('lessons', { id, module_id: m.id, title, kind: input.kind, body: cleanBody(input.body), video_provider: null, video_ref: null, duration_minutes: input.durationMinutes ?? null, sort, status: 'draft', created_at: now, updated_at: now });
  ctx.db.update('courses', c.id, { updated_at: now });
  audit(ctx, 'lesson.create', { type: 'lesson', id }, null, { courseId: c.id, moduleId: m.id, kind: input.kind, title });
  return adminLessonDetail(ctx, id);
}

export function adminLessonDetail(ctx: Ctx, lessonId: string) {
  requirePermission(ctx, 'learning.manage');
  const l = lessonRow(ctx, lessonId);
  if (!l) throw errors.notFound('Lesson');
  const c = courseRow(ctx, l.course_id)!;
  return { ...adminLesson(ctx, l), bodyText: toPlainText(l.body), module: { id: l.module_id, title: l.module_title }, course: { id: c.id, title: c.title, status: c.status, sample: !!c.sample } };
}

/** Edit a lesson. A published lesson cannot become a video lesson while no video host is configured; moving a lesson
 *  is only within its course. */
export function updateLesson(ctx: Ctx, lessonId: string, patch: LessonPatch) {
  requirePermission(ctx, 'learning.manage');
  const l = lessonRow(ctx, lessonId);
  if (!l) throw errors.notFound('Lesson');
  const c = editable(courseRow(ctx, l.course_id));
  if (patch.moduleId !== undefined && patch.moduleId !== l.module_id) {
    const target = moduleRow(ctx, patch.moduleId);
    if (!target || target.course_id !== c.id) throw errors.badRequest('A lesson moves only between modules of its own course', 'MODULE_INVALID');
  }
  const fields: Record<string, string | number | null | undefined> = {
    title: patch.title !== undefined ? plain(patch.title) : undefined,
    kind: patch.kind,
    body: patch.body !== undefined ? cleanBody(patch.body) : undefined,
    duration_minutes: patch.durationMinutes !== undefined ? patch.durationMinutes : undefined,
    module_id: patch.moduleId,
  };
  if (fields.title !== undefined && String(fields.title).length < 2) throw errors.badRequest('Give the lesson a title', 'TITLE_REQUIRED');
  const changed = Object.entries(fields).filter(([k, v]) => v !== undefined && v !== (l as Record<string, unknown>)[k]).map(([k]) => k);
  if (!changed.length) return adminLessonDetail(ctx, l.id);
  if (l.status === 'published') checkPublishable(ctx, { kind: (fields.kind as LessonKind | undefined) ?? l.kind, body: (fields.body as string | undefined) ?? l.body });
  const now = ctx.now();
  const sort = fields.module_id !== undefined ? (ctx.db.get<{ s: number | null }>('SELECT MAX(sort) s FROM lessons WHERE module_id = ?', [fields.module_id])!.s ?? 0) + 1 : undefined;
  ctx.db.update('lessons', l.id, { ...Object.fromEntries(changed.map((k) => [k, fields[k] ?? null])), ...(sort !== undefined ? { sort } : {}), updated_at: now });
  ctx.db.update('courses', c.id, { updated_at: now });
  audit(ctx, 'lesson.update', { type: 'lesson', id: l.id }, null, { courseId: c.id, fields: changed.map((k) => ({ duration_minutes: 'durationMinutes', module_id: 'moduleId' } as Record<string, string>)[k] ?? k) });
  return adminLessonDetail(ctx, l.id);
}

/** Publish or unpublish a lesson. A video lesson needs a video host; the last published lesson of a published course
 *  cannot be unpublished (unpublish the course first). */
export function setLessonStatus(ctx: Ctx, lessonId: string, status: 'published' | 'draft') {
  requirePermission(ctx, 'learning.manage');
  const l = lessonRow(ctx, lessonId);
  if (!l) throw errors.notFound('Lesson');
  const c = editable(courseRow(ctx, l.course_id));
  if (l.status === status) return adminLessonDetail(ctx, l.id);
  if (status === 'published') checkPublishable(ctx, l);
  else if (c.status === 'published' && lessonsOf(ctx, c.id, true).length <= 1) throw errors.conflict('This is the course’s only published lesson: unpublish the course first', 'COURSE_NEEDS_LESSON');
  const now = ctx.now();
  ctx.db.update('lessons', l.id, { status, updated_at: now });
  ctx.db.update('courses', c.id, { updated_at: now });
  audit(ctx, status === 'published' ? 'lesson.publish' : 'lesson.unpublish', { type: 'lesson', id: l.id }, null, { courseId: c.id, from: l.status, to: status });
  return adminLessonDetail(ctx, l.id);
}

/** Delete a draft lesson nobody has opened; a published lesson or one with learner progress is refused (return it to
 *  draft instead, which hides it and keeps the progress). */
export function deleteLesson(ctx: Ctx, lessonId: string) {
  requirePermission(ctx, 'learning.manage');
  const l = lessonRow(ctx, lessonId);
  if (!l) throw errors.notFound('Lesson');
  const c = editable(courseRow(ctx, l.course_id));
  if (l.status === 'published') throw errors.conflict('Return the lesson to draft before deleting it', 'LESSON_PUBLISHED');
  if (ctx.db.get('SELECT 1 FROM lesson_progress WHERE lesson_id = ?', [l.id])) throw errors.conflict('Learners have opened this lesson: keep it as a draft instead, which hides it and keeps their progress', 'LESSON_HAS_PROGRESS');
  ctx.db.run('DELETE FROM lessons WHERE id = ?', [l.id]);
  ctx.db.update('courses', c.id, { updated_at: ctx.now() });
  audit(ctx, 'lesson.delete', { type: 'lesson', id: l.id }, null, { courseId: c.id, title: l.title });
  return adminCourse(ctx, c.id);
}

/* ---------- events ---------- */

/** PackageActivated: enrol the member in the published courses that come with the package (source 'package'),
 *  audited as course.enroll by the system. Nothing is sent; the courses appear on the member's Learn page. */
export function onPackageActivated(ctx: Ctx, memberId: string, programmeId: string): number {
  const pkg = ctx.db.get<{ package_id: string }>('SELECT v.package_id FROM programmes g JOIN package_versions v ON v.id = g.package_version_id WHERE g.id = ? AND g.member_id = ?', [programmeId, memberId]);
  if (!pkg) return 0;
  let n = 0;
  for (const c of ctx.db.all<CourseRow>("SELECT * FROM courses WHERE status = 'published' AND audience = 'packages'")) {
    if (!j.out<string[]>(c.package_ids, []).includes(pkg.package_id)) continue;
    if (enrollmentOf(ctx, c.id, memberId) || !lessonsOf(ctx, c.id, true).length) continue;
    const e = insertEnrollment(ctx, c.id, memberId, 'package');
    audit(ctx, 'course.enroll', { type: 'course_enrollment', id: e.id }, null, { courseId: c.id, source: 'package', programmeId });
    n++;
  }
  return n;
}
