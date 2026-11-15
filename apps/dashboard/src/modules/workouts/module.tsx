/* M6 Workouts: what the module adds to the portal. Pages load lazily, so the module's code arrives only when one of
   them opens; the server enforces everything again (feature 'workouts', roles, library.manage, members.manage, the
   client's sharing consent).
   - Member portal: /client/workouts (this week, history) and /client/workouts/:id (the session runner); a Home card.
   - Coach workspace: the Workouts tab on the client record, /coach/workout-programs/:id, /coach/exercise-library and
     /coach/workout-templates/:id; a Today card.
   - Admin workspace: /admin/exercise-library and /admin/workout-templates/:id (library.manage), the Workouts tab on the
     client record and /admin/workout-programs/:id, where an administrator writes, publishes and archives a member's
     programme with the coach's editor (members.manage as on the server), an Overview card. */
import React, { Suspense } from 'react';
import { Skeleton } from '../../ui';
import type { PortalModule } from '../types';

const lazyPage = <T extends Record<string, React.ComponentType<any>>, K extends keyof T>(load: () => Promise<T>, key: K) => React.lazy(() => load().then((m) => ({ default: m[key] as React.ComponentType<any> })));
const ClientWorkouts = lazyPage(() => import('./ClientWorkouts'), 'ClientWorkouts');
const SessionRunner = lazyPage(() => import('./SessionRunner'), 'SessionRunner');
const ProgramEditor = lazyPage(() => import('./ProgramEditor'), 'ProgramEditor');
const ExerciseLibrary = lazyPage(() => import('./ExerciseLibrary'), 'ExerciseLibrary');
const TemplateEditor = lazyPage(() => import('./TemplateEditor'), 'TemplateEditor');
const WorkoutsTab = lazyPage(() => import('./WorkoutsTab'), 'WorkoutsTab');
const ClientWeekCard = lazyPage(() => import('./Cards'), 'ClientWeekCard');
const CoachReviewCard = lazyPage(() => import('./Cards'), 'CoachReviewCard');
const AdminLibraryCard = lazyPage(() => import('./Cards'), 'AdminLibraryCard');

/** Cards and tabs render outside the Shell's page Suspense, so they bring their own. */
const held = (node: React.ReactNode, rows = 3) => <Suspense fallback={<Skeleton rows={rows} />}>{node}</Suspense>;

export const workouts: PortalModule = {
  key: 'workouts',
  title: 'Workouts',
  routes: [
    { workspace: 'client', path: 'workouts', element: <ClientWorkouts /> },
    { workspace: 'client', path: 'workouts/:id', element: <SessionRunner /> },
    { workspace: 'coach', path: 'exercise-library', element: <ExerciseLibrary mode="coach" /> },
    { workspace: 'coach', path: 'workout-templates/:id', element: <TemplateEditor mode="coach" /> },
    { workspace: 'coach', path: 'workout-programs/:id', element: <ProgramEditor /> },
    { workspace: 'admin', path: 'exercise-library', permission: 'library.manage', element: <ExerciseLibrary mode="admin" /> },
    { workspace: 'admin', path: 'workout-templates/:id', permission: 'library.manage', element: <TemplateEditor mode="admin" /> },
    { workspace: 'admin', path: 'workout-programs/:id', permission: 'members.manage', element: <ProgramEditor mode="admin" /> },
  ],
  nav: [
    { workspace: 'client', to: '/workouts', label: 'Workouts', before: '/progress' },
    { workspace: 'coach', to: '/exercise-library', label: 'Exercise library', group: 'Libraries' },
    { workspace: 'admin', to: '/exercise-library', label: 'Exercise library', permission: 'library.manage', group: 'Libraries' },
  ],
  clientTabs: [
    { id: 'workouts', label: 'Workouts', workspaces: ['coach'], render: (ctx) => held(<WorkoutsTab {...ctx} />, 6) },
    { id: 'workouts', label: 'Workouts', workspaces: ['admin'], permission: 'members.manage', render: (ctx) => held(<WorkoutsTab {...ctx} />, 6) },
  ],
  cards: [
    { id: 'workouts-week', placement: 'clientHome', span: 6, render: () => held(<ClientWeekCard />) },
    { id: 'workouts-review', placement: 'coachToday', span: 6, render: () => held(<CoachReviewCard />) },
    { id: 'workouts-library', placement: 'adminOverview', span: 6, permission: 'library.manage', render: () => held(<AdminLibraryCard />) },
  ],
};
