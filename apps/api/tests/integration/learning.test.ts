/* M10 Learning: the labelled sample course; members see published lessons of published courses their audience admits
   (every member, a package they hold, or a coach's assignment) and only their own progress; a coach assigns courses to
   assigned clients only and sees a client's own course choices only while the client shares with them; administrators
   author with learning.manage (draft and published, the video rule, reasons); validation; audit; the PackageActivated
   handler; coach training; the member's data export; the flag. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId } from '../helpers.js';
import type { Ctx } from '../../src/context.js';
import { learning } from '../../src/modules/learning.js';
import { setUserPermission } from '../../src/auth/permissions.js';
import { findRestrictedFields, restrictedKeys } from '../../src/auth/fieldPolicy.js';
import { coachTrainingSummary } from '../../src/domain/learning.js';
import { buildArchive } from '../../src/domain/dataExport.js';

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); h.db.close(); });

const PRIYA = 'priya.nair@demo.bioptime.test';
const signedIn = async (email: string, password: string, mfa = false) => { const c = client(h.app); await c.login(email, password, password === DEMO_PASSWORDS.member ? 'member' : 'dashboard', mfa); return c; };
const member = (email: string) => signedIn(email, DEMO_PASSWORDS.member);
const coach = (email: string) => signedIn(email, DEMO_PASSWORDS.coach);
const admin = () => signedIn(DEMO.admin, DEMO_PASSWORDS.admin, true);
const owner = () => signedIn(DEMO.owner, DEMO_PASSWORDS.owner, true);
const as = (email: string): Ctx => { const u = h.db.get<{ id: string; role: 'member' | 'coach' | 'admin' | 'owner'; name: string }>('SELECT id, role, name FROM users WHERE email = ?', [email])!; return { ...h.ctx, actor: { id: u.id, role: u.role, email, name: u.name } }; };
const sampleId = () => h.db.get<{ id: string }>("SELECT id FROM courses WHERE slug = 'getting-started-with-learn'")!.id;
const lessonId = (title: string) => h.db.get<{ id: string }>('SELECT id FROM lessons WHERE title = ?', [title])!.id;
const packageId = (slug: string) => h.db.get<{ id: string }>('SELECT id FROM packages WHERE slug = ?', [slug])!.id;
const auditRows = (action: string, targetId?: string) => h.db.all<{ actor_id: string | null; actor_role: string; reason: string | null; data: string; target_id: string }>(`SELECT actor_id, actor_role, reason, data, target_id FROM audit_events WHERE action = ? ${targetId ? 'AND target_id = ?' : ''} ORDER BY at`, targetId ? [action, targetId] : [action]);
const L1 = 'Reading a lesson', L2 = 'A checklist lesson', L3 = 'Where your progress shows';
const VIDEO = 'A video lesson (draft)', DRAFT = 'A draft lesson';
/** The owner removed every "demo" and "sample" label from the screens (24 October 2026). */
const LABEL_WORDS = /\bdemo\b|\bsample\b|placeholder/i;

type CourseOut = { id: string; title: string; audience: string; sample: boolean; lessons: number; access: string | null; enrollment: null | { source: string; status: string; progress: { completed: number; total: number; pct: number | null } }; modules?: Array<{ lessons: Array<{ id: string; title: string; progress: string | null }> }> };

/** An administrator's published course with one published written lesson. */
async function publishedCourse(a: Awaited<ReturnType<typeof admin>>, input: Record<string, unknown>, lessonTitle = 'Test lesson') {
  const c = await a.post('/api/admin/courses', input);
  assert.equal(c.status, 201, JSON.stringify(c.json));
  const withModule = await a.post(`/api/admin/courses/${c.json.id}/modules`, { title: 'Test module' });
  assert.equal(withModule.status, 201, JSON.stringify(withModule.json));
  const moduleId = (withModule.json.modules as Array<{ id: string }>)[0]!.id;
  const l = await a.post(`/api/admin/course-modules/${moduleId}/lessons`, { title: lessonTitle, kind: 'written', body: '<p>Test text written for this test.</p>' });
  assert.equal(l.status, 201, JSON.stringify(l.json));
  assert.equal((await a.post(`/api/admin/lessons/${l.json.id}/publish`, {})).status, 200);
  const pub = await a.post(`/api/admin/courses/${c.json.id}/publish`, { reason: 'test: ready for learners' });
  assert.equal(pub.status, 200, JSON.stringify(pub.json));
  return { courseId: c.json.id as string, moduleId, lessonId: l.json.id as string };
}

test('the demo seed ships one course that explains how Learn works and says it is not health advice, with no demo or sample label', async () => {
  const courses = h.db.all<{ title: string; summary: string; sample: number; status: string; audience: string }>('SELECT * FROM courses');
  assert.equal(courses.length, 1, 'one seeded course');
  const c = courses[0]!;
  assert.equal(c.title, 'Getting started with courses');
  assert.match(c.summary, /introduction to how Learn works/);
  assert.match(c.summary, /not health advice/);
  assert.doesNotMatch(`${c.title} ${c.summary}`, LABEL_WORDS);
  assert.equal(c.sample, 0, 'not flagged sample, so no screen shows a Sample badge');
  assert.equal(c.status, 'published');
  for (const m of h.db.all<{ title: string }>('SELECT title FROM course_modules')) assert.doesNotMatch(m.title, LABEL_WORDS);
  for (const l of h.db.all<{ title: string; body: string; duration_minutes: number | null; video_ref: string | null }>('SELECT * FROM lessons')) {
    assert.doesNotMatch(l.title, LABEL_WORDS);
    assert.match(l.body, /<strong>About this course\.<\/strong> It explains how Learn works in the portal and the app\. It is not health advice\./);
    assert.doesNotMatch(l.body, LABEL_WORDS);
    assert.equal(l.duration_minutes, null, 'no invented durations');
    assert.equal(l.video_ref, null);
  }
  assert.equal(h.db.get<{ status: string }>('SELECT status FROM lessons WHERE title = ?', [VIDEO])!.status, 'draft', 'the video lesson waits for a video host');
  const a = await admin();
  const list = await a.get('/api/admin/courses');
  assert.equal(list.status, 200, JSON.stringify(list.json));
  const item = (list.json.items as Array<{ lessonCounts: { published: number; draft: number }; enrolments: { active: number; completed: number } }>)[0]!;
  assert.deepEqual(item.lessonCounts, { published: 3, draft: 2 });
  assert.deepEqual(item.enrolments, { active: 2, completed: 1 });
  const video = list.json.video as { status: string; missing: string[] };
  assert.equal(video.status, 'pending_configuration');
  assert.ok(video.missing.some((m) => m.includes('VIDEO_PROVIDER')), 'the missing requirement is named');
});

test('a member sees published lessons only, with their own progress', async () => {
  const ananya = await member(DEMO.member);
  const mine = await ananya.get('/api/me/courses');
  assert.equal(mine.status, 200, JSON.stringify(mine.json));
  const enrolled = mine.json.enrolled as CourseOut[];
  assert.equal(enrolled.length, 1);
  assert.equal(enrolled[0]!.enrollment!.source, 'self');
  assert.deepEqual(enrolled[0]!.enrollment!.progress, { ...enrolled[0]!.enrollment!.progress, completed: 1, total: 3, pct: 33 });
  assert.equal((mine.json.available as unknown[]).length, 0);

  const course = await ananya.get(`/api/me/courses/${sampleId()}`);
  assert.equal(course.status, 200);
  const lessons = (course.json.modules as CourseOut['modules'])!.flatMap((m) => m.lessons);
  assert.deepEqual(lessons.map((l) => l.title), [L1, L2, L3], 'drafts are invisible');
  assert.deepEqual(lessons.map((l) => l.progress), ['completed', 'started', null]);
  assert.equal(course.json.nextLessonId, lessonId(L2));
  for (const t of [VIDEO, DRAFT]) assert.equal((await ananya.get(`/api/me/lessons/${lessonId(t)}`)).status, 404, `${t} is not found`);
  for (const t of [VIDEO, DRAFT]) assert.equal((await ananya.post(`/api/me/lessons/${lessonId(t)}/complete`)).status, 404);
  const lesson = await ananya.get(`/api/me/lessons/${lessonId(L1)}`);
  assert.equal(lesson.status, 200);
  assert.match(lesson.json.bodyText as string, /^About this course\. It explains how Learn works/);
  assert.equal(lesson.json.nextLessonId, lessonId(L2));
  assert.deepEqual(lesson.json.position, { index: 1, of: 3 });

  // another member's enrolment is theirs: Vikram sees the course as available, with no progress
  const vikram = await member(DEMO.member2);
  const his = await vikram.get('/api/me/courses');
  assert.equal((his.json.enrolled as unknown[]).length, 0);
  assert.equal((his.json.available as CourseOut[])[0]!.enrollment, null);
  const outline = await vikram.get(`/api/me/courses/${sampleId()}`);
  assert.ok((outline.json.modules as CourseOut['modules'])!.flatMap((m) => m.lessons).every((l) => l.progress === null));
  assert.equal(outline.json.enrollment, null);

  // the wrong role or no session
  const asha = await coach(DEMO.coach);
  assert.equal((await asha.get('/api/me/courses')).status, 403);
  assert.equal((await asha.post(`/api/me/lessons/${lessonId(L1)}/complete`)).status, 403);
  assert.equal((await client(h.app).get('/api/me/courses')).status, 401);
});

test('completing every published lesson completes the course; leaving keeps progress; drafts and archives behave', async () => {
  const vikram = await member(DEMO.member2);
  const first = await vikram.post(`/api/me/lessons/${lessonId(L1)}/complete`);
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(first.json.enrolled, true, 'completing a lesson enrols');
  assert.equal(auditRows('course.enroll').filter((r) => r.actor_id === userId(h.ctx, DEMO.member2)).length, 1);
  assert.equal((await vikram.post(`/api/me/lessons/${lessonId(L1)}/complete`)).status, 200, 'completing again is harmless');
  assert.equal(auditRows('lesson.complete').filter((r) => r.actor_id === userId(h.ctx, DEMO.member2)).length, 1);
  const left = await vikram.post(`/api/me/courses/${sampleId()}/leave`);
  assert.equal(left.json.status, 'withdrawn');
  assert.equal(((await vikram.get('/api/me/courses')).json.available as CourseOut[]).length, 1, 'a course I left is offered again');
  const back = await vikram.post(`/api/me/courses/${sampleId()}/enroll`);
  assert.equal(back.status, 200);
  assert.equal((back.json.enrollment as { progress: { completed: number } }).progress.completed, 1, 'progress kept');
  await vikram.post(`/api/me/lessons/${lessonId(L2)}/complete`);
  const last = await vikram.post(`/api/me/lessons/${lessonId(L3)}/complete`);
  assert.equal(last.json.enrollmentStatus, 'completed');
  assert.deepEqual((last.json.courseProgress as { completed: number; total: number; pct: number }).pct, 100);
  assert.equal(auditRows('course.complete').filter((r) => r.actor_id === userId(h.ctx, DEMO.member2)).length, 1);

  // a draft course is invisible; an archived one stays readable to its learners and takes nobody new
  const a = await admin();
  const draft = await a.post('/api/admin/courses', { title: 'Test draft course', audience: 'all_members' });
  assert.equal((await vikram.get(`/api/me/courses/${draft.json.id}`)).status, 404);
  assert.equal((await vikram.post(`/api/me/courses/${draft.json.id}/enroll`)).status, 404);
  const archivable = await publishedCourse(a, { title: 'Test archivable course', audience: 'all_members' });
  await vikram.post(`/api/me/courses/${archivable.courseId}/enroll`);
  assert.equal((await a.post(`/api/admin/courses/${archivable.courseId}/archive`, { reason: 'test: retire it' })).status, 200);
  assert.equal((await vikram.get(`/api/me/lessons/${archivable.lessonId}`)).status, 200, 'an enrolled learner keeps reading');
  const deepa = await member(DEMO.memberNoShare);
  assert.equal((await deepa.get(`/api/me/courses/${archivable.courseId}`)).status, 404);
  assert.ok(!((await deepa.get('/api/me/courses')).json.available as CourseOut[]).some((c) => c.id === archivable.courseId));
  assert.equal((await a.post(`/api/admin/courses/${archivable.courseId}/unpublish`, { reason: 'test: back to draft' })).status, 200);
  assert.equal((await vikram.get(`/api/me/courses/${archivable.courseId}`)).status, 404, 'a draft again: hidden');
});

test('audience and package eligibility: all members, a package, a coach’s assignment, coaches', async () => {
  const a = await admin();
  const pkg = await publishedCourse(a, { title: 'Test core course', audience: 'packages', packageIds: [packageId('core')] }, 'Core lesson');
  const assigned = await publishedCourse(a, { title: 'Test assigned-only course', audience: 'assigned_only' }, 'Assigned lesson');
  const training = await publishedCourse(a, { title: 'Test coach training', audience: 'coaches' }, 'Training lesson');

  const ananya = await member(DEMO.member); // holds Core
  const vikram = await member(DEMO.member2); // holds Advanced
  const avail = (await ananya.get('/api/me/courses')).json.available as CourseOut[];
  assert.ok(avail.some((c) => c.id === pkg.courseId && c.access === 'package'), 'a Core member is offered the Core course');
  assert.ok(!avail.some((c) => c.id === assigned.courseId), 'assigned-only courses are not offered');
  assert.ok(!avail.some((c) => c.id === training.courseId), 'coach training is not for members');
  const joined = await ananya.post(`/api/me/courses/${pkg.courseId}/enroll`);
  assert.equal(joined.status, 200, JSON.stringify(joined.json));
  assert.equal((joined.json.enrollment as { source: string }).source, 'package');

  assert.ok(!((await vikram.get('/api/me/courses')).json.available as CourseOut[]).some((c) => c.id === pkg.courseId));
  const refused = await vikram.post(`/api/me/courses/${pkg.courseId}/enroll`);
  assert.equal(refused.status, 403);
  assert.equal(refused.json.error?.code, 'PACKAGE_REQUIRED');
  assert.equal((await vikram.get(`/api/me/lessons/${pkg.lessonId}`)).status, 404);
  assert.equal((await vikram.post(`/api/me/lessons/${pkg.lessonId}/complete`)).status, 404);
  assert.equal((await ananya.get(`/api/me/courses/${assigned.courseId}`)).status, 404);
  assert.equal((await ananya.post(`/api/me/courses/${assigned.courseId}/enroll`)).status, 404);
  assert.equal((await ananya.get(`/api/me/courses/${training.courseId}`)).status, 404);

  // the coach's assignment opens an assigned-only course for that client
  const asha = await coach(DEMO.coach);
  const ananyaId = userId(h.ctx, DEMO.member);
  const r = await asha.post(`/api/coach/clients/${ananyaId}/courses`, { courseId: assigned.courseId, note: 'Read this one first.' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.source, 'coach_assigned');
  const opened = await ananya.get(`/api/me/courses/${assigned.courseId}`);
  assert.equal(opened.status, 200);
  assert.equal(opened.json.access, 'coach_assigned');
  assert.equal((opened.json.enrollment as { assignedNote: string; assignedByName: string }).assignedNote, 'Read this one first.');

  // a package that ends closes the course; the progress stays
  await ananya.post(`/api/me/lessons/${pkg.lessonId}/complete`);
  h.db.run("UPDATE programmes SET status = 'ended' WHERE member_id = ?", [ananyaId]);
  const ended = await ananya.get(`/api/me/courses/${pkg.courseId}`);
  assert.equal(ended.status, 403);
  assert.equal(ended.json.error?.code, 'COURSE_ACCESS_ENDED');
  const listed = ((await ananya.get('/api/me/courses')).json.enrolled as Array<CourseOut & { locked: boolean }>).find((c) => c.id === pkg.courseId)!;
  assert.equal(listed.locked, true);
  assert.equal(listed.enrollment!.progress.completed, 1);
  h.db.run("UPDATE programmes SET status = 'active' WHERE member_id = ?", [ananyaId]);
  assert.equal((await ananya.get(`/api/me/courses/${pkg.courseId}`)).status, 200);

  // coach training: coaches only
  const training1 = await asha.get('/api/coach/training');
  assert.equal(training1.status, 200);
  assert.ok((training1.json.available as CourseOut[]).some((c) => c.id === training.courseId));
  assert.ok(!(training1.json.available as CourseOut[]).some((c) => c.id === sampleId()), 'member courses are not training');
  const done = await asha.post(`/api/coach/lessons/${training.lessonId}/complete`);
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(done.json.enrollmentStatus, 'completed');
  assert.deepEqual(coachTrainingSummary(h.ctx, userId(h.ctx, DEMO.coach)), { available: true, total: 1, completed: 1 });
  assert.equal((await asha.post(`/api/coach/lessons/${lessonId(L1)}/complete`)).status, 404, 'a member course lesson is not the coach’s to complete');
  const preview = await asha.get(`/api/coach/lessons/${lessonId(L1)}`);
  assert.equal(preview.status, 200);
  assert.equal(preview.json.preview, true);
  assert.equal(preview.json.progress, null);
  assert.equal((await asha.get(`/api/coach/lessons/${lessonId(DRAFT)}`)).status, 404);
});

test('a coach assigns courses to assigned clients only, sees their own choices only while shared, and the payload passes the field policy', async () => {
  const asha = await coach(DEMO.coach);
  const meera = await coach(DEMO.coach3);
  const vikramId = userId(h.ctx, DEMO.member2), deepaId = userId(h.ctx, DEMO.memberNoShare), priyaId = userId(h.ctx, PRIYA), ananyaId = userId(h.ctx, DEMO.member);

  // not their client
  const notMine = await asha.post(`/api/coach/clients/${vikramId}/courses`, { courseId: sampleId() });
  assert.equal(notMine.status, 403);
  assert.equal(notMine.json.error?.code, 'NO_ACCESS');
  assert.equal((await asha.get(`/api/coach/clients/${vikramId}/learning`)).json.error?.code, 'NO_ACCESS');
  assert.equal(h.db.get<{ source: string }>('SELECT source FROM course_enrollments WHERE member_id = ? AND course_id = ?', [vikramId, sampleId()])!.source, 'self', 'nothing changed');

  // the catalogue: published member courses only
  const catalogue = await asha.get('/api/coach/courses');
  assert.equal(catalogue.status, 200);
  const items = catalogue.json.items as Array<{ id: string; audience: string; title: string }>;
  assert.ok(items.some((c) => c.id === sampleId()));
  assert.ok(items.every((c) => c.audience !== 'coaches' && !/draft/i.test(c.title)));

  // sharing on (Ananya): her own choices show; Priya: the sample course Asha assigned shows, with the note
  const ananya = await asha.get(`/api/coach/clients/${ananyaId}/learning`);
  assert.equal(ananya.status, 200);
  assert.equal(ananya.json.sharing, true);
  assert.ok((ananya.json.items as Array<{ courseId: string; source: string }>).some((e) => e.courseId === sampleId() && e.source === 'self'));
  const priya = await asha.get(`/api/coach/clients/${priyaId}/learning`);
  const assigned = (priya.json.items as Array<{ courseId: string; source: string; assignedByMe: boolean; assignedNote: string }>).find((e) => e.courseId === sampleId())!;
  assert.equal(assigned.source, 'coach_assigned');
  assert.equal(assigned.assignedByMe, true);
  assert.equal(assigned.assignedNote, 'A short course to get to know the Learn page.');
  const again = await asha.post(`/api/coach/clients/${priyaId}/courses`, { courseId: sampleId() });
  assert.equal(again.status, 409);
  assert.equal(again.json.error?.code, 'ALREADY_ASSIGNED');
  for (const payload of [catalogue.json, ananya.json, priya.json]) assert.deepEqual(findRestrictedFields(payload, restrictedKeys()), []);
  assert.ok(!JSON.stringify(priya.json).includes('@demo.bioptime.test'), 'no email address reaches the coach');

  // sharing off (Deepa, coach Meera): her own finished course stays hidden, with no hint that she has one
  const hidden = await meera.get(`/api/coach/clients/${deepaId}/learning`);
  assert.equal(hidden.status, 200);
  assert.equal(hidden.json.sharing, false);
  assert.deepEqual(Object.keys(hidden.json).sort(), ['items', 'memberId', 'sharing'], 'nothing says whether other courses exist');
  assert.deepEqual(hidden.json.items, []);
  const a = await admin();
  const another = await publishedCourse(a, { title: 'Test course for Deepa', audience: 'all_members' }, 'Deepa lesson');
  const given = await meera.post(`/api/coach/clients/${deepaId}/courses`, { courseId: another.courseId, note: 'Assigned in a test.' });
  assert.equal(given.status, 201, JSON.stringify(given.json));
  const shown = await meera.get(`/api/coach/clients/${deepaId}/learning`);
  assert.deepEqual((shown.json.items as Array<{ courseId: string }>).map((e) => e.courseId), [another.courseId], 'only what a coach assigned');
  // the member is told, without the note in the notification body
  const n = h.db.get<{ title: string; body: string; data: string }>("SELECT title, body, data FROM notifications WHERE user_id = ? AND category = 'learning' ORDER BY created_at DESC LIMIT 1", [deepaId])!;
  assert.equal(n.title, 'A course from your coach');
  assert.ok(n.body.includes('Test course for Deepa') && !n.body.includes('Assigned in a test'));
  // a course the member chose themselves (here finished) is accepted and answered exactly as a fresh assignment is
  const fresh = given.json as Record<string, unknown> & { progress: Record<string, unknown> };
  assert.deepEqual({ status: fresh.status, completedAt: fresh.completedAt, progress: fresh.progress }, { status: 'active', completedAt: null, progress: { completed: 0, total: 1, pct: 0, lastActivityAt: null } });
  const beforeOwn = new Date().toISOString();
  const own = await meera.post(`/api/coach/clients/${deepaId}/courses`, { courseId: sampleId(), note: 'Assigned in a test.' });
  assert.equal(own.status, 201, JSON.stringify(own.json));
  assert.deepEqual(Object.keys(own.json).sort(), Object.keys(fresh).sort());
  const { id: _i, courseId: _c, courseTitle: _t, sample: _s, enrolledAt: ownStart, progress: ownProgress, ...ownRest } = own.json as Record<string, unknown>;
  const { id: _fi, courseId: _fc, courseTitle: _ft, sample: _fs, enrolledAt: _fe, progress: _fp, ...freshRest } = fresh;
  assert.deepEqual(ownRest, freshRest, 'same source, status, note, assigner and no completion date as a fresh assignment');
  assert.deepEqual(ownProgress, { completed: 0, total: 3, pct: 0, lastActivityAt: null }, 'nothing of the progress she made on her own');
  assert.ok(String(ownStart) >= beforeOwn, 'it starts now, not when she enrolled');
  const deepaRow = h.db.get<{ source: string; status: string; enrolled_at: string }>('SELECT source, status, enrolled_at FROM course_enrollments WHERE member_id = ? AND course_id = ?', [deepaId, sampleId()])!;
  assert.deepEqual({ source: deepaRow.source, status: deepaRow.status }, { source: 'coach_assigned', status: 'completed' }, 'the member’s own record keeps its status');
  assert.ok(deepaRow.enrolled_at < beforeOwn);
  const deepaOwnView = ((await (await member(DEMO.memberNoShare)).get('/api/me/courses')).json.enrolled as CourseOut[]).find((c) => c.id === sampleId())!;
  assert.deepEqual({ status: deepaOwnView.enrollment!.status, completed: deepaOwnView.enrollment!.progress.completed, access: deepaOwnView.access }, { status: 'completed', completed: 3, access: 'coach_assigned' }, 'she keeps her progress');
  const afterOwn = (((await meera.get(`/api/coach/clients/${deepaId}/learning`)).json.items) as Array<{ courseId: string; status: string; enrolledAt: string; completedAt: string | null; progress: { completed: number; lastActivityAt: string | null } }>).find((e) => e.courseId === sampleId())!;
  assert.deepEqual({ status: afterOwn.status, completedAt: afterOwn.completedAt, completed: afterOwn.progress.completed, last: afterOwn.progress.lastActivityAt }, { status: 'active', completedAt: null, completed: 0, last: null }, 'the record shows only what follows the assignment');
  assert.ok(afterOwn.enrolledAt >= beforeOwn);
  const twice = await meera.post(`/api/coach/clients/${deepaId}/courses`, { courseId: sampleId() });
  assert.equal(twice.json.error?.code, 'ALREADY_ASSIGNED', 'the same answer a fresh assignment gets');
  assert.ok(!/complet/i.test(twice.json.error?.message ?? ''));
  // ... and so is one she left: it is back on her Learn page, from her coach, with her progress kept
  const leftCourse = await publishedCourse(a, { title: 'Test course Deepa left', audience: 'all_members' }, 'Left lesson');
  const deepa = await member(DEMO.memberNoShare);
  assert.equal((await deepa.post(`/api/me/courses/${leftCourse.courseId}/enroll`)).status, 200);
  assert.equal((await deepa.post(`/api/me/lessons/${leftCourse.lessonId}/start`)).json.recorded, true);
  assert.equal((await deepa.post(`/api/me/courses/${leftCourse.courseId}/leave`)).status, 200);
  const beforeLeft = new Date().toISOString();
  const left = await meera.post(`/api/coach/clients/${deepaId}/courses`, { courseId: leftCourse.courseId });
  assert.equal(left.status, 201, JSON.stringify(left.json));
  assert.deepEqual({ status: left.json.status, completedAt: left.json.completedAt, progress: left.json.progress }, { status: 'active', completedAt: null, progress: { completed: 0, total: 1, pct: 0, lastActivityAt: null } });
  assert.ok(String(left.json.enrolledAt) >= beforeLeft);
  const rejoined = ((await deepa.get('/api/me/courses')).json.enrolled as CourseOut[]).find((c) => c.id === leftCourse.courseId)!;
  assert.equal(rejoined.enrollment!.status, 'active');
  assert.equal(rejoined.access, 'coach_assigned');
  const leftOutline = (await deepa.get(`/api/me/courses/${leftCourse.courseId}`)).json.modules as NonNullable<CourseOut['modules']>;
  assert.equal(leftOutline[0]!.lessons[0]!.progress, 'started', 'her progress is kept');
  const backNote = h.db.get<{ title: string; body: string }>("SELECT title, body FROM notifications WHERE user_id = ? AND category = 'learning' ORDER BY created_at DESC, rowid DESC LIMIT 1", [deepaId])!;
  assert.equal(backNote.body, `${as(DEMO.coach3).actor!.name} added “Test course Deepa left” back to your Learn page. Your progress on it is kept.`, 'a course she left comes back, and she is told so');
  for (const r of [own, left, twice]) assert.ok(!JSON.stringify(r.json).includes('ALREADY_HAS_COURSE'));
  // while the member shares: a finished course is named as such, and an active one of their own is taken over
  const rahulFirst = await (await coach(DEMO.coach2)).post(`/api/coach/clients/${vikramId}/courses`, { courseId: sampleId() });
  assert.equal(rahulFirst.json.error?.code, 'ALREADY_COMPLETED');
  const takeOver = await asha.post(`/api/coach/clients/${ananyaId}/courses`, { courseId: sampleId(), note: 'Keep going with this one.' });
  assert.equal(takeOver.status, 201, JSON.stringify(takeOver.json));
  assert.equal(takeOver.json.source, 'coach_assigned');
  assert.equal((takeOver.json.progress as { completed: number }).completed, 1, 'progress kept');
  assert.equal(takeOver.json.enrolledAt, h.db.get<{ enrolled_at: string }>('SELECT enrolled_at FROM course_enrollments WHERE member_id = ? AND course_id = ?', [ananyaId, sampleId()])!.enrolled_at, 'while she shares, the whole enrolment');
  const followNote = { ...h.db.get<{ title: string; body: string }>("SELECT title, body FROM notifications WHERE user_id = ? AND category = 'learning' ORDER BY created_at DESC, rowid DESC LIMIT 1", [ananyaId])! };
  assert.deepEqual(followNote, { title: 'Your coach is following your course', body: `${as(DEMO.coach).actor!.name} is now following your course “${h.db.get<{ title: string }>('SELECT title FROM courses WHERE id = ?', [sampleId()])!.title}”. Your progress on it is kept.` }, 'the course was already on her Learn page: nothing is said to be added');

  // once she stops sharing, the course Asha took over shows only what followed the takeover, and her package course
  // (a choice of her own) is gone from the record without a trace
  type RecordItem = { courseId: string; source: string; status: string; enrolledAt: string; completedAt: string | null; progress: { completed: number; lastActivityAt: string | null } };
  const ananyaSelf = await member(DEMO.member);
  const sharedItems = (await asha.get(`/api/coach/clients/${ananyaId}/learning`)).json.items as RecordItem[];
  assert.ok(sharedItems.some((e) => e.source === 'package'), 'her package course shows while she shares');
  assert.equal((await ananyaSelf.post('/api/me/consents', { kind: 'coach_sharing', version: '2026-10-17', granted: false })).status, 200);
  try {
    const off = await asha.get(`/api/coach/clients/${ananyaId}/learning`);
    assert.equal(off.json.sharing, false);
    assert.deepEqual(Object.keys(off.json).sort(), ['items', 'memberId', 'sharing']);
    const items = off.json.items as RecordItem[];
    assert.ok(items.every((e) => e.source === 'coach_assigned'), 'only courses a coach assigned');
    const taken = items.find((e) => e.courseId === sampleId())!;
    const assignedAt = h.db.get<{ assigned_at: string }>('SELECT assigned_at FROM course_enrollments WHERE member_id = ? AND course_id = ?', [ananyaId, sampleId()])!.assigned_at;
    assert.deepEqual({ completed: taken.progress.completed, last: taken.progress.lastActivityAt, enrolledAt: taken.enrolledAt, status: taken.status }, { completed: 0, last: null, enrolledAt: assignedAt, status: 'active' }, 'the lesson she finished before the takeover is not shown');
    // what she does after the takeover shows, as it does for any course a coach assigned
    assert.equal((await ananyaSelf.post(`/api/me/lessons/${lessonId(L2)}/complete`)).status, 200);
    const later = ((await asha.get(`/api/coach/clients/${ananyaId}/learning`)).json.items as RecordItem[]).find((e) => e.courseId === sampleId())!;
    assert.equal(later.progress.completed, 1);
    assert.ok(later.progress.lastActivityAt && later.progress.lastActivityAt >= assignedAt);
  } finally {
    assert.equal((await ananyaSelf.post('/api/me/consents', { kind: 'coach_sharing', version: '2026-10-17', granted: true })).status, 200);
  }
  const back = ((await asha.get(`/api/coach/clients/${ananyaId}/learning`)).json.items as RecordItem[]).find((e) => e.courseId === sampleId())!;
  assert.equal(back.progress.completed, 2, 'sharing again shows the whole enrolment');

  // a package course only for a client who holds the package (Vikram holds Advanced; Rahul is his coach)
  const rahul = await coach(DEMO.coach2);
  const core = h.db.get<{ id: string }>("SELECT id FROM courses WHERE title = 'Test core course'")!.id;
  const noPkg = await rahul.post(`/api/coach/clients/${vikramId}/courses`, { courseId: core });
  assert.equal(noPkg.status, 409);
  assert.equal(noPkg.json.error?.code, 'PACKAGE_REQUIRED');
  const training = h.db.get<{ id: string }>("SELECT id FROM courses WHERE audience = 'coaches'")!.id;
  assert.equal((await rahul.post(`/api/coach/clients/${vikramId}/courses`, { courseId: training })).status, 404, 'training is not assignable');
  const draft = h.db.get<{ id: string }>("SELECT id FROM courses WHERE status = 'draft' LIMIT 1")!.id;
  assert.equal((await rahul.post(`/api/coach/clients/${vikramId}/courses`, { courseId: draft })).status, 404, 'drafts are not assignable');

  // members cannot use coach routes
  const m = await member(DEMO.member);
  assert.equal((await m.get('/api/coach/courses')).status, 403);
  assert.equal((await m.post(`/api/coach/clients/${ananyaId}/courses`, { courseId: sampleId() })).status, 403);
});

test('without sharing, a course a coach takes over shows the activity from the assignment on, and reads as completed once the member finishes it after the assignment', async () => {
  const tick = () => new Promise((r) => setTimeout(r, 10)); // keep what happens before and after the assignment apart in time
  const a = await admin();
  const meera = await coach(DEMO.coach3); // Deepa's coach; Deepa does not share
  const deepa = await member(DEMO.memberNoShare);
  const deepaId = userId(h.ctx, DEMO.memberNoShare);
  const meeraName = as(DEMO.coach3).actor!.name;
  const lastNote = () => ({ ...h.db.get<{ title: string; body: string }>("SELECT title, body FROM notifications WHERE user_id = ? AND category = 'learning' ORDER BY created_at DESC, rowid DESC LIMIT 1", [deepaId])! }); // a plain object, for deepEqual
  type RecordItem = { courseId: string; status: string; enrolledAt: string; completedAt: string | null; progress: { completed: number; total: number; pct: number | null; lastActivityAt: string | null } };
  const recordOf = async (courseId: string) => ((await meera.get(`/api/coach/clients/${deepaId}/learning`)).json.items as RecordItem[]).find((e) => e.courseId === courseId)!;

  // a course of three lessons Deepa chose herself and is two lessons into
  const course = await publishedCourse(a, { title: 'Test course in three lessons', audience: 'all_members' }, 'Three-lesson course, lesson 1');
  const lessons = [course.lessonId];
  for (const n of [2, 3]) {
    const l = await a.post(`/api/admin/course-modules/${course.moduleId}/lessons`, { title: `Three-lesson course, lesson ${n}`, kind: 'written', body: '<p>Test text written for this test.</p>' });
    assert.equal(l.status, 201, JSON.stringify(l.json));
    assert.equal((await a.post(`/api/admin/lessons/${l.json.id}/publish`, {})).status, 200);
    lessons.push(l.json.id as string);
  }
  assert.equal((await deepa.post(`/api/me/courses/${course.courseId}/enroll`)).status, 200);
  for (const id of lessons.slice(0, 2)) assert.equal((await deepa.post(`/api/me/lessons/${id}/complete`)).status, 200);
  await tick();

  // Meera assigns it: answered as a fresh assignment, and Deepa is told her coach now follows the course she has
  const given = await meera.post(`/api/coach/clients/${deepaId}/courses`, { courseId: course.courseId });
  assert.equal(given.status, 201, JSON.stringify(given.json));
  assert.deepEqual({ status: given.json.status, completedAt: given.json.completedAt, progress: given.json.progress }, { status: 'active', completedAt: null, progress: { completed: 0, total: 3, pct: 0, lastActivityAt: null } });
  assert.deepEqual(lastNote(), { title: 'Your coach is following your course', body: `${meeraName} is now following your course “Test course in three lessons”. Your progress on it is kept.` }, 'not "added": it was already on her Learn page');
  const assignedAt = given.json.enrolledAt as string;
  await tick();

  // she finishes the last lesson: the course is complete for her, and from the assignment on it reads as completed,
  // with the one lesson she finished since counted and the two from before left out
  const last = await deepa.post(`/api/me/lessons/${lessons[2]}/complete`);
  assert.equal(last.status, 200, JSON.stringify(last.json));
  assert.equal(last.json.enrollmentStatus, 'completed');
  const done = await recordOf(course.courseId);
  assert.equal(done.status, 'completed', 'completed is reachable from the assignment on');
  assert.ok(done.completedAt && done.completedAt >= assignedAt, 'dated after the assignment');
  assert.equal(done.enrolledAt, assignedAt, 'it still starts at the assignment');
  assert.deepEqual([done.progress.completed, done.progress.total], [1, 3], 'only the lesson finished since the assignment is counted');
  assert.ok(done.progress.lastActivityAt && done.progress.lastActivityAt >= assignedAt);
  const again = await meera.post(`/api/coach/clients/${deepaId}/courses`, { courseId: course.courseId });
  assert.equal(again.json.error?.code, 'ALREADY_COMPLETED', 'assigning it again is answered as the record reads');

  // a course she had already finished before the assignment: nothing happened since, so nothing shows
  const finished = await publishedCourse(a, { title: 'Test course finished before', audience: 'all_members' }, 'Finished-before lesson');
  assert.equal((await deepa.post(`/api/me/lessons/${finished.lessonId}/complete`)).json.enrollmentStatus, 'completed');
  await tick();
  assert.equal((await meera.post(`/api/coach/clients/${deepaId}/courses`, { courseId: finished.courseId })).status, 201);
  assert.equal(lastNote().title, 'Your coach is following your course');
  const quiet = await recordOf(finished.courseId);
  assert.deepEqual({ status: quiet.status, completedAt: quiet.completedAt, completed: quiet.progress.completed, last: quiet.progress.lastActivityAt }, { status: 'active', completedAt: null, completed: 0, last: null });

  // a course she finished and then left: the assignment brings it back (complete, for her) but that is no activity of hers
  const leftDone = await publishedCourse(a, { title: 'Test course finished and left', audience: 'all_members' }, 'Finished-and-left lesson');
  assert.equal((await deepa.post(`/api/me/lessons/${leftDone.lessonId}/complete`)).json.enrollmentStatus, 'completed');
  assert.equal((await deepa.post(`/api/me/courses/${leftDone.courseId}/leave`)).status, 200);
  await tick();
  const back = await meera.post(`/api/coach/clients/${deepaId}/courses`, { courseId: leftDone.courseId });
  assert.equal(back.status, 201, JSON.stringify(back.json));
  assert.deepEqual({ status: back.json.status, completedAt: back.json.completedAt, completed: (back.json.progress as { completed: number }).completed }, { status: 'active', completedAt: null, completed: 0 }, 'nothing tells the coach she had finished it');
  assert.equal(lastNote().body, `${meeraName} added “Test course finished and left” back to your Learn page. Your progress on it is kept.`);
  const hers = ((await deepa.get('/api/me/courses')).json.enrolled as CourseOut[]).find((c) => c.id === leftDone.courseId)!;
  assert.equal(hers.enrollment!.status, 'completed', 'for her the course is complete, as it was');
  assert.equal((await recordOf(leftDone.courseId)).status, 'active');
});

test('authoring needs learning.manage; a member’s learning needs members.manage', async () => {
  const a = await admin();
  const adminId = userId(h.ctx, DEMO.admin);
  const asha = await coach(DEMO.coach);
  const ananya = await member(DEMO.member);
  for (const c of [asha, ananya]) {
    assert.equal((await c.get('/api/admin/courses')).status, 403);
    assert.equal((await c.post('/api/admin/courses', { title: 'Not allowed', audience: 'all_members' })).status, 403);
  }
  const ownerCtx = as(DEMO.owner);
  setUserPermission(ownerCtx, adminId, 'learning.manage', false, 'test: revoke');
  for (const r of [await a.get('/api/admin/courses'), await a.post('/api/admin/courses', { title: 'Refused', audience: 'all_members' }), await a.post(`/api/admin/courses/${sampleId()}/archive`, { reason: 'test: refused' }), await a.get('/api/admin/learning/options')]) {
    assert.equal(r.status, 403);
    assert.equal(r.json.error?.code, 'PERMISSION_DENIED');
  }
  assert.equal(h.db.get<{ status: string }>('SELECT status FROM courses WHERE id = ?', [sampleId()])!.status, 'published', 'nothing changed');
  setUserPermission(ownerCtx, adminId, 'learning.manage', true, 'test: restore');
  assert.equal((await a.get('/api/admin/courses')).status, 200);

  const record = await a.get(`/api/admin/members/${userId(h.ctx, DEMO.memberNoShare)}/learning`);
  assert.equal(record.status, 200, JSON.stringify(record.json));
  assert.ok((record.json.items as Array<{ courseId: string; status: string }>).some((e) => e.courseId === sampleId() && e.status === 'completed'), 'administrators see everything');
  assert.equal((await a.get(`/api/admin/members/${userId(h.ctx, DEMO.coach)}/learning`)).status, 404, 'member accounts only');
  setUserPermission(ownerCtx, adminId, 'members.manage', false, 'test: revoke');
  assert.equal((await a.get(`/api/admin/members/${userId(h.ctx, DEMO.member)}/learning`)).json.error?.code, 'PERMISSION_DENIED');
  setUserPermission(ownerCtx, adminId, 'members.manage', true, 'test: restore');
});

test('validation and the authoring rules: audiences, slugs, sanitised bodies, the video rule, publishing and deleting', async () => {
  const a = await admin();
  const bad = async (r: Promise<{ status: number; json: { error?: { code: string } } }>, status: number, code?: string) => { const x = await r; assert.equal(x.status, status, JSON.stringify(x.json)); if (code) assert.equal(x.json.error?.code, code); };
  await bad(a.post('/api/admin/courses', { title: 'X', audience: 'all_members' }), 400, 'VALIDATION_FAILED');
  await bad(a.post('/api/admin/courses', { title: 'Bad audience', audience: 'everyone' }), 400, 'VALIDATION_FAILED');
  await bad(a.post('/api/admin/courses', { title: 'Extra key', audience: 'all_members', status: 'published' }), 400, 'VALIDATION_FAILED');
  await bad(a.post('/api/admin/courses', { title: 'Bad slug', slug: 'Not A Slug', audience: 'all_members' }), 400, 'VALIDATION_FAILED');
  await bad(a.post('/api/admin/courses', { title: 'No packages', audience: 'packages' }), 400, 'AUDIENCE_INVALID');
  await bad(a.post('/api/admin/courses', { title: 'Unknown package', audience: 'packages', packageIds: ['pkg_nope'] }), 400, 'AUDIENCE_INVALID');
  await bad(a.post('/api/admin/courses', { title: 'Packages for everyone', audience: 'all_members', packageIds: [packageId('core')] }), 400, 'AUDIENCE_INVALID');
  await bad(a.post('/api/admin/courses', { title: 'Taken slug', slug: 'getting-started-with-learn', audience: 'all_members' }), 409, 'SLUG_IN_USE');
  await bad(a.post('/api/admin/courses', { title: 'Bad cover', audience: 'all_members', coverAssetId: 'ast_nope' }), 400, 'COVER_INVALID');

  const created = await a.post('/api/admin/courses', { title: 'Rules course', audience: 'all_members', summary: 'Plain <b>summary</b>' });
  assert.equal(created.status, 201);
  assert.equal(created.json.slug, 'rules-course');
  assert.equal(created.json.summary, 'Plain summary');
  assert.equal(created.json.status, 'draft');
  const courseId = created.json.id as string;
  assert.equal((await a.post('/api/admin/courses', { title: 'Rules course', audience: 'all_members' })).json.slug, 'rules-course-2', 'a generated slug never collides');
  await bad(a.post(`/api/admin/courses/${courseId}/publish`, { reason: 'test: too early' }), 409, 'COURSE_NEEDS_LESSON');
  await bad(a.post(`/api/admin/courses/${courseId}/publish`, {}), 400, 'VALIDATION_FAILED');
  const withModules = await a.post(`/api/admin/courses/${courseId}/modules`, { title: 'Module one' });
  await a.post(`/api/admin/courses/${courseId}/modules`, { title: 'Module two' });
  const [m1, m2] = ((await a.get(`/api/admin/courses/${courseId}`)).json.modules as Array<{ id: string }>).map((m) => m.id);
  assert.equal(withModules.status, 201);
  await bad(a.post(`/api/admin/course-modules/${m1}/lessons`, { title: 'Bad kind', kind: 'podcast' }), 400, 'VALIDATION_FAILED');
  await bad(a.post(`/api/admin/course-modules/${m1}/lessons`, { title: 'Too long', kind: 'written', body: 'x'.repeat(20001) }), 400, 'VALIDATION_FAILED');
  await bad(a.post(`/api/admin/course-modules/${m1}/lessons`, { title: 'Bad minutes', kind: 'written', durationMinutes: 0 }), 400, 'VALIDATION_FAILED');
  const lesson = await a.post(`/api/admin/course-modules/${m1}/lessons`, { title: 'Sanitised', kind: 'written', body: '<p onclick="x()">Hello <script>alert(1)</script><a href="javascript:alert(1)">link</a></p>' });
  assert.equal(lesson.status, 201);
  assert.equal(lesson.json.body, '<p>Hello alert(1)link</p>', 'only the CMS allowlist survives');
  const empty = await a.post(`/api/admin/course-modules/${m1}/lessons`, { title: 'Empty', kind: 'written' });
  await bad(a.post(`/api/admin/lessons/${empty.json.id}/publish`, {}), 409, 'LESSON_EMPTY');
  const video = await a.post(`/api/admin/course-modules/${m2}/lessons`, { title: 'A video', kind: 'video', body: '<p>About the video.</p>' });
  const refused = await a.post(`/api/admin/lessons/${video.json.id}/publish`, {});
  assert.equal(refused.status, 409);
  assert.equal(refused.json.error?.code, 'VIDEO_PROVIDER_NOT_CONFIGURED');
  assert.ok(((refused.json.error?.details as { missing: string[] }).missing).some((m) => m.includes('VIDEO_PROVIDER')));
  assert.equal((await a.post(`/api/admin/lessons/${lesson.json.id}/publish`, {})).status, 200);
  await bad(a.patch(`/api/admin/lessons/${lesson.json.id}`, { kind: 'video' }), 409, 'VIDEO_PROVIDER_NOT_CONFIGURED');
  await bad(a.patch(`/api/admin/lessons/${lesson.json.id}`, { moduleId: h.db.get<{ id: string }>('SELECT id FROM course_modules WHERE course_id = ?', [sampleId()])!.id }), 400, 'MODULE_INVALID');
  const pub = await a.post(`/api/admin/courses/${courseId}/publish`, { reason: 'test: first lesson ready' });
  assert.equal(pub.json.status, 'published');
  await bad(a.post(`/api/admin/lessons/${lesson.json.id}/unpublish`, {}), 409, 'COURSE_NEEDS_LESSON');
  await bad(a.del(`/api/admin/lessons/${lesson.json.id}`), 409, 'LESSON_PUBLISHED');
  await bad(a.del(`/api/admin/course-modules/${m1}`), 409, 'MODULE_NOT_EMPTY');

  // reorder: every module and lesson once
  await bad(a.post(`/api/admin/courses/${courseId}/reorder`, { modules: [{ id: m1, lessonIds: [lesson.json.id] }] }), 400, 'ORDER_INVALID');
  const reordered = await a.post(`/api/admin/courses/${courseId}/reorder`, { modules: [{ id: m2, lessonIds: [video.json.id, lesson.json.id] }, { id: m1, lessonIds: [empty.json.id] }] });
  assert.equal(reordered.status, 200, JSON.stringify(reordered.json));
  assert.deepEqual((reordered.json.modules as Array<{ id: string; lessons: Array<{ id: string }> }>).map((m) => [m.id, m.lessons.map((l) => l.id)]), [[m2, [video.json.id, lesson.json.id]], [m1, [empty.json.id]]]);

  // a learner's progress protects a lesson from deletion; an unopened draft can go
  const vikram = await member(DEMO.member2);
  assert.equal((await vikram.post(`/api/me/lessons/${lesson.json.id}/complete`)).status, 200);
  assert.equal((await a.post(`/api/admin/lessons/${video.json.id}/unpublish`, {})).status, 200, 'already a draft: harmless');
  const gone = await a.del(`/api/admin/lessons/${empty.json.id}`);
  assert.equal(gone.status, 200);
  assert.equal((await a.del(`/api/admin/course-modules/${m1}`)).status, 200, 'an empty module can go');
  h.db.run("UPDATE lessons SET status = 'draft' WHERE id = ?", [lesson.json.id as string]);
  await bad(a.del(`/api/admin/lessons/${lesson.json.id}`), 409, 'LESSON_HAS_PROGRESS');
  h.db.run("UPDATE lessons SET status = 'published' WHERE id = ?", [lesson.json.id as string]);

  // audience changes are validated; archived courses are not edited
  await bad(a.patch(`/api/admin/courses/${courseId}`, { audience: 'packages' }), 400, 'AUDIENCE_INVALID');
  const toPkg = await a.patch(`/api/admin/courses/${courseId}`, { audience: 'packages', packageIds: [packageId('advanced')] });
  assert.equal(toPkg.status, 200);
  assert.deepEqual(toPkg.json.packageIds, [packageId('advanced')]);
  assert.equal((await a.post(`/api/admin/courses/${courseId}/archive`, { reason: 'test: archive' })).status, 200);
  await bad(a.patch(`/api/admin/courses/${courseId}`, { title: 'Edited after archiving' }), 409, 'COURSE_ARCHIVED');
  await bad(a.post(`/api/admin/courses/${courseId}/archive`, { reason: 'test: again' }), 409, 'COURSE_STATUS');

  // member-side validation: an unknown course or lesson is simply not found
  assert.equal((await vikram.post('/api/me/courses/crs_nope/enroll')).status, 404);
  assert.equal((await vikram.post('/api/me/lessons/lsn_nope/complete')).status, 404);
  const asha = await coach(DEMO.coach);
  await bad(asha.post(`/api/coach/clients/${userId(h.ctx, DEMO.member)}/courses`, {}), 400, 'VALIDATION_FAILED');
  await bad(asha.post(`/api/coach/clients/${userId(h.ctx, DEMO.member)}/courses`, { courseId: sampleId(), note: 'x'.repeat(501) }), 400, 'VALIDATION_FAILED');
});

test('the member’s data export carries their courses as their Learn page shows them, and nothing the team keeps', async () => {
  type Enrolment = { course: string; sample: boolean; retired: boolean; howItCameToYou: string; assignedBy: string | null; coachNote: string | null; status: string; accessEnded: boolean; enrolledAt: string; completedAt: string | null; progress: { completed: number; total: number; pct: number | null }; lessons: Array<{ module: string; lesson: string; status: string; openedAt: string; completedAt: string | null }> };
  type Section = { label: string; records: { enrolments: Enrolment[]; leftOut: Array<{ what: string; why: string; records: number }> } };
  type Archive = { moduleSections?: Record<string, Record<string, Section>>; notIncluded: Array<{ what: string }> };
  const deepaId = userId(h.ctx, DEMO.memberNoShare);
  const a = await admin();
  // one of the sample lessons she finished goes back to draft, and so does a course she was assigned
  const l3 = lessonId(L3);
  assert.equal((await a.post(`/api/admin/lessons/${l3}/unpublish`, {})).status, 200);
  const deepaCourse = h.db.get<{ id: string }>("SELECT id FROM courses WHERE title = 'Test course for Deepa'")!.id;
  assert.equal((await a.post(`/api/admin/courses/${deepaCourse}/unpublish`, { reason: 'test: back to draft for the export' })).status, 200);
  try {
    const archive = buildArchive(h.ctx, deepaId, 'drq_test_learning_export') as Archive;
    const section = archive.moduleSections?.learning?.courses;
    assert.ok(section, 'moduleSections.learning.courses is present');
    assert.match(section.label, /^Your courses/);
    assert.ok(!archive.notIncluded.some((n) => /Course enrolments/.test(n.what)), 'learning leaves notIncluded once it exports');
    const { enrolments, leftOut } = section.records;
    const sample = enrolments.find((e) => e.course === h.db.get<{ title: string }>('SELECT title FROM courses WHERE id = ?', [sampleId()])!.title)!;
    assert.ok(sample, 'the seeded course she finished');
    assert.deepEqual({ sample: sample.sample, how: sample.howItCameToYou, by: sample.assignedBy, note: sample.coachNote, status: sample.status, ended: sample.accessEnded }, { sample: false, how: 'Your coach assigned it', by: h.db.get<{ name: string }>('SELECT name FROM users WHERE email = ?', [DEMO.coach3])!.name, note: 'Assigned in a test.', status: 'Completed', ended: false });
    assert.equal(sample.enrolledAt, h.db.get<{ enrolled_at: string }>('SELECT enrolled_at FROM course_enrollments WHERE member_id = ? AND course_id = ?', [deepaId, sampleId()])!.enrolled_at, 'her own enrolment date');
    assert.deepEqual(sample.lessons.map((l) => [l.lesson, l.status]), [[L1, 'Completed'], [L2, 'Completed']], 'published lessons only');
    assert.deepEqual(sample.progress, { completed: 2, total: 2, pct: 100 });
    const left = enrolments.find((e) => e.course === 'Test course Deepa left')!;
    assert.equal(left.status, 'In progress');
    assert.deepEqual(left.lessons.map((l) => [l.lesson, l.status, l.completedAt]), [['Left lesson', 'Opened', null]]);
    assert.deepEqual(leftOut.map((x) => [x.what, x.records]), [['Courses the Bioptime team has taken back to draft', 1], ['Your progress on lessons the Bioptime team has taken back to draft', 1]]);

    // withheld: draft titles, course and lesson text, other people's details, internal ids and team-only counts
    const text = JSON.stringify(section);
    for (const hiddenText of ['Test course for Deepa', L3, VIDEO, DRAFT, 'About this course', 'It explains how Learn works', '@demo.bioptime.test', userId(h.ctx, DEMO.coach3), 'crs_', 'cen_', 'lsn_']) assert.ok(!text.includes(hiddenText), `${hiddenText} stays out`);
    for (const key of ['created_by', 'createdBy', 'assigned_at', 'assignedAt', 'enrolments_count', 'completedBy', 'body', 'summary', 'package_ids', 'email', 'phone']) assert.ok(!text.includes(`"${key}"`), `no ${key}`);

    // a member with no courses gets an empty section, not an error
    const karthik = buildArchive(h.ctx, userId(h.ctx, DEMO.memberNoCoach), 'drq_test_learning_export_2') as Archive;
    assert.deepEqual(karthik.moduleSections?.learning?.courses?.records, { enrolments: [], leftOut: [] });
  } finally {
    assert.equal((await a.post(`/api/admin/lessons/${l3}/publish`, {})).status, 200);
    assert.equal((await a.post(`/api/admin/courses/${deepaCourse}/publish`, { reason: 'test: published again' })).status, 200);
  }
});

test('every mutation is audited with its actor, and status changes carry the reason', () => {
  const owner = userId(h.ctx, DEMO.owner), adminId = userId(h.ctx, DEMO.admin), asha = userId(h.ctx, DEMO.coach), ananya = userId(h.ctx, DEMO.member), vikram = userId(h.ctx, DEMO.member2);
  const expect: Array<[string, string]> = [
    ['course.create', owner], ['course.create', adminId], ['course.update', adminId], ['course.publish', owner], ['course.publish', adminId], ['course.archive', adminId], ['course.unpublish', adminId], ['course.reorder', adminId],
    ['course.module_create', adminId], ['course.module_delete', adminId], ['lesson.create', adminId], ['lesson.publish', adminId], ['lesson.delete', adminId],
    ['course.enroll', ananya], ['course.enroll', vikram], ['course.leave', vikram], ['course.complete', vikram], ['lesson.start', ananya], ['lesson.complete', ananya], ['course.assign', asha], ['lesson.complete', asha],
  ];
  for (const [action, actor] of expect) assert.ok(auditRows(action).some((r) => r.actor_id === actor), `${action} by ${actor}`);
  const pub = auditRows('course.publish', sampleId())[0]!;
  assert.equal(pub.reason, 'initial data: the introduction to Learn');
  assert.deepEqual(JSON.parse(pub.data), { from: 'draft', to: 'published' });
  assert.ok(auditRows('course.archive').every((r) => (r.reason ?? '').length >= 3));
  for (const r of auditRows('course.assign')) assert.ok(!JSON.stringify(r).includes('Read this one first'), 'the coach’s note stays out of the audit');
});

test('PackageActivated enrols the member in the published courses that come with that package', async () => {
  const a = await admin();
  const c = await publishedCourse(a, { title: 'Test advanced course', audience: 'packages', packageIds: [packageId('advanced')] }, 'Advanced lesson');
  const priyaId = userId(h.ctx, PRIYA); // holds Advanced
  const programmeId = h.db.get<{ id: string }>('SELECT id FROM programmes WHERE member_id = ?', [priyaId])!.id;
  const handler = learning.events!.PackageActivated![0]!;
  await handler(h.ctx, { id: 'evt_test', type: 'PackageActivated', aggregate_type: 'programme', aggregate_id: programmeId, payload: '{}', attempts: 0 }, { memberId: priyaId });
  const e = h.db.get<{ source: string; status: string; id: string }>('SELECT id, source, status FROM course_enrollments WHERE course_id = ? AND member_id = ?', [c.courseId, priyaId])!;
  assert.deepEqual({ source: e.source, status: e.status }, { source: 'package', status: 'active' });
  const row = auditRows('course.enroll', e.id)[0]!;
  assert.equal(row.actor_role, 'system');
  await handler(h.ctx, { id: 'evt_test2', type: 'PackageActivated', aggregate_type: 'programme', aggregate_id: programmeId, payload: '{}', attempts: 0 }, { memberId: priyaId });
  assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM course_enrollments WHERE course_id = ? AND member_id = ?', [c.courseId, priyaId])!.n, 1, 'once');
  const p = await member(PRIYA);
  assert.ok(((await p.get('/api/me/courses')).json.enrolled as CourseOut[]).some((x) => x.id === c.courseId && x.enrollment!.source === 'package'));
});

test('with the learning flag off, every learning route answers FEATURE_DISABLED and the client config omits it', async () => {
  const o = await owner();
  const ananya = await member(DEMO.member);
  const asha = await coach(DEMO.coach);
  const a = await admin();
  assert.equal((await o.patch('/api/admin/modules', { key: 'learning', enabled: false, reason: 'test: switch learning off' })).status, 200);
  for (const [c, url] of [[ananya, '/api/me/courses'], [ananya, `/api/me/lessons/${lessonId(L1)}`], [asha, '/api/coach/courses'], [asha, '/api/coach/training'], [asha, `/api/coach/clients/${userId(h.ctx, DEMO.member)}/learning`], [a, '/api/admin/courses'], [a, `/api/admin/members/${userId(h.ctx, DEMO.member)}/learning`]] as const) {
    const r = await c.get(url);
    assert.equal(r.status, 403, url);
    assert.equal(r.json.error?.code, 'FEATURE_DISABLED', url);
  }
  assert.equal((await ananya.post(`/api/me/lessons/${lessonId(L2)}/complete`)).json.error?.code, 'FEATURE_DISABLED');
  assert.ok(!((await ananya.get('/api/public/config')).json.features as string[]).includes('learning'));
  assert.equal((await o.patch('/api/admin/modules', { key: 'learning', enabled: true, reason: 'test: switch learning back on' })).status, 200);
  assert.equal((await ananya.get('/api/me/courses')).status, 200);
});
