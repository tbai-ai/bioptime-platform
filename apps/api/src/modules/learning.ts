/* M10 Learning: courses, modules and lessons written by administrators (learning.manage) as drafts and published;
   enrolment by audience (every member, members holding a package, members a coach assigned, or coaches for training);
   progress per learner; courses a coach assigns to their own clients. Migration 0018_learning.sql.

   - routes: api/http/routes/learning.ts, each through def() with feature 'learning' (administrative routes also need
     learning.manage or members.manage).
   - events: PackageActivated enrols the member in the published courses that come with that package (source 'package').
   - jobs: none. Nothing in learning runs on a timer.
   - exportSections: the member's courses for their data export, as their Learn page shows them (how each came to them,
     the coach's name and note, status, and progress on published lessons); no course text, drafts or team-only counts.
   - seedDemo: one short course that explains how Learn works (its lessons say so, and that they are not health
     advice), plus a few enrolments, so every workspace has something to show. Nothing here is health content, and
     nothing makes a health claim. */
import type { ApiModule, DemoSeedContext } from './types.js';
import type { Ctx } from '../context.js';
import { learningRoutes } from '../http/routes/learning.js';
import * as courses from '../domain/learning.js';

export const learning: ApiModule = {
  key: 'learning',
  feature: 'learning',
  routes: (app) => learningRoutes(app),
  jobs: [],
  events: {
    PackageActivated: [(ctx, event, payload) => { if (payload.memberId) courses.onPackageActivated(ctx, String(payload.memberId), event.aggregate_id); }],
  },
  seedDemo: (demo) => seedLearningDemo(demo),
  exportSections: [
    { key: 'courses', label: 'Your courses, ones you left included: how each came to you, your coach’s name and note when a coach assigned it, its status and your progress on its published lessons, as your Learn page shows them (course text is not included)', build: (ctx, memberId) => courses.exportForMember(ctx, memberId) },
  ],
};

const INTRO = '<p><strong>About this course.</strong> It explains how Learn works in the portal and the app. It is not health advice. Courses on health topics are added by the Bioptime team.</p>';

/** The introduction to Learn: its summary and every lesson say it explains the Learn page and is not health advice.
 *  Its title names what it teaches (courses), not the page, so a member does not read it as a stand-in (T6-38); the slug
 *  stays as first published, since links and records use it.
 *  Durations are left empty rather than guessed. Enrolments go through the same functions members and coaches use. */
function seedLearningDemo(demo: DemoSeedContext): void {
  const { owner, coachIds, memberIds } = demo;
  if (!owner.config.isDemo) return;
  const as = (id: string): Ctx => {
    const u = owner.db.get<{ id: string; role: 'member' | 'coach' | 'admin' | 'owner'; email: string; name: string }>('SELECT id, role, email, name FROM users WHERE id = ?', [id]);
    if (!u) throw new Error(`seed: no user ${id}`);
    return { ...owner, actor: { id: u.id, role: u.role, email: u.email, name: u.name } };
  };

  const course = courses.createCourse(owner, {
    title: 'Getting started with courses', slug: 'getting-started-with-learn', audience: 'all_members',
    summary: 'A short introduction to how Learn works: courses, modules, lessons and your progress. It explains the Learn page only and is not health advice. Courses on health topics are added by the Bioptime team.',
  });
  const withModule = (title: string) => courses.createModule(owner, course.id, { title }).modules.at(-1)!.id;
  const m1 = withModule('How a course works');
  const m2 = withModule('Your progress');
  const lesson = (moduleId: string, title: string, kind: courses.LessonKind, body: string, publish: boolean) => {
    const l = courses.createLesson(owner, moduleId, { title, kind, body });
    if (publish) courses.setLessonStatus(owner, l.id, 'published');
    return l.id;
  };
  const l1 = lesson(m1, 'Reading a lesson', 'written', `${INTRO}<p>A lesson is a short piece of reading. When you have read it, choose <strong>Mark as complete</strong>; your progress is saved in the portal and the app alike.</p>`, true);
  const l2 = lesson(m1, 'A checklist lesson', 'checklist', `${INTRO}<p>A checklist lesson lists a few steps. These steps show the format:</p><ul><li>Open the lesson</li><li>Read it through</li><li>Mark it complete</li></ul>`, true);
  const l3 = lesson(m2, 'Where your progress shows', 'written', `${INTRO}<p>Your progress shows on the Learn page as the number of lessons you have completed. If your coach assigned you a course, they see your progress in that course.</p>`, true);
  lesson(m2, 'A video lesson (draft)', 'video', `${INTRO}<p>Video lessons stay in draft until a video hosting provider is configured.</p>`, false);
  lesson(m2, 'A draft lesson', 'written', `${INTRO}<p>Draft lessons are not shown to members.</p>`, false);
  courses.setCourseStatus(owner, course.id, 'publish', 'initial data: the introduction to Learn');

  // enrolments: Ananya (coach Asha, sharing on) started on her own; Priya was assigned the course by Asha;
  // Deepa (coach Meera, sharing off) finished it on her own, which Meera does not see
  const [asha] = coachIds;
  const ananya = memberIds[0], deepa = memberIds[2], priya = memberIds[8];
  if (ananya) { const c = as(ananya); courses.enroll(c, course.id); courses.completeLesson(c, l1); courses.startLesson(c, l2); }
  if (asha && priya) courses.assignCourse(as(asha), priya, { courseId: course.id, note: 'A short course to get to know the Learn page.' });
  if (deepa) { const c = as(deepa); for (const l of [l1, l2, l3]) courses.completeLesson(c, l); }
}
