/* M10 Learning: what the module adds to the portal. Pages load lazily, so the module's code arrives only when one of
   them opens; the server enforces everything again (feature 'learning', roles, learning.manage, members.manage, the
   client's sharing consent).
   - Member portal: /client/learn (my courses and the ones I may start), /client/learn/:courseId (the outline) and
     /client/learn/:courseId/:lessonId (a lesson); a Home card.
   - Coach workspace: the Learning tab on the client record (progress, assign a course), /coach/courses (the courses a
     coach may assign, to read first) and /coach/training (training for coaches), each with its course and lesson pages.
   - Admin workspace: /admin/learning and /admin/learning/:id, the course editor (learning.manage); the Learning tab on
     the client record (read-only, members.manage); an Overview card. */
import React, { Suspense } from 'react';
import { Skeleton } from '../../ui';
import type { PortalModule } from '../types';

const lazyPage = <T extends Record<string, React.ComponentType<any>>, K extends keyof T>(load: () => Promise<T>, key: K) => React.lazy(() => load().then((m) => ({ default: m[key] as React.ComponentType<any> })));
const LearnHome = lazyPage(() => import('./LearnHome'), 'LearnHome');
const CourseView = lazyPage(() => import('./CourseView'), 'CourseView');
const LessonView = lazyPage(() => import('./LessonView'), 'LessonView');
const CoachCourses = lazyPage(() => import('./CoachCourses'), 'CoachCourses');
const LearningTab = lazyPage(() => import('./LearningTab'), 'LearningTab');
const AdminCourses = lazyPage(() => import('./AdminCourses'), 'AdminCourses');
const CourseEditor = lazyPage(() => import('./CourseEditor'), 'CourseEditor');
const ClientLearnCard = lazyPage(() => import('./Cards'), 'ClientLearnCard');
const AdminCoursesCard = lazyPage(() => import('./Cards'), 'AdminCoursesCard');

/** Cards and tabs render outside the Shell's page Suspense, so they bring their own. */
const held = (node: React.ReactNode, rows = 3) => <Suspense fallback={<Skeleton rows={rows} />}>{node}</Suspense>;

export const learning: PortalModule = {
  key: 'learning',
  title: 'Learning',
  routes: [
    { workspace: 'client', path: 'learn', element: <LearnHome mode="client" /> },
    { workspace: 'client', path: 'learn/:courseId', element: <CourseView mode="client" /> },
    { workspace: 'client', path: 'learn/:courseId/:lessonId', element: <LessonView mode="client" /> },
    { workspace: 'coach', path: 'training', element: <LearnHome mode="training" /> },
    { workspace: 'coach', path: 'training/:courseId', element: <CourseView mode="training" /> },
    { workspace: 'coach', path: 'training/:courseId/:lessonId', element: <LessonView mode="training" /> },
    { workspace: 'coach', path: 'courses', element: <CoachCourses /> },
    { workspace: 'coach', path: 'courses/:courseId', element: <CourseView mode="preview" /> },
    { workspace: 'coach', path: 'courses/:courseId/:lessonId', element: <LessonView mode="preview" /> },
    { workspace: 'admin', path: 'learning', permission: 'learning.manage', element: <AdminCourses /> },
    { workspace: 'admin', path: 'learning/:id', permission: 'learning.manage', element: <CourseEditor /> },
  ],
  nav: [
    { workspace: 'client', to: '/learn', label: 'Learn', before: '/messages' },
    { workspace: 'coach', to: '/courses', label: 'Courses', group: 'Learning' },
    { workspace: 'coach', to: '/training', label: 'Training', group: 'Learning' },
    { workspace: 'admin', to: '/learning', label: 'Courses', permission: 'learning.manage', group: 'Learning' },
  ],
  clientTabs: [
    { id: 'learning', label: 'Learning', workspaces: ['coach'], render: (ctx) => held(<LearningTab {...ctx} />, 5) },
    { id: 'learning', label: 'Learning', workspaces: ['admin'], permission: 'members.manage', render: (ctx) => held(<LearningTab {...ctx} />, 5) },
  ],
  cards: [
    { id: 'learning-continue', placement: 'clientHome', span: 6, render: () => held(<ClientLearnCard />) },
    { id: 'learning-courses', placement: 'adminOverview', span: 4, permission: 'learning.manage', render: () => held(<AdminCoursesCard />) },
  ],
};
