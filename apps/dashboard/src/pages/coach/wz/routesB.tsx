import React, { Suspense } from 'react';
import { Skeleton } from '../../../ui';

/** Coach workspace pages, filled by group "plans" (workouts, workouts/sessions, meals, appointments overview).
    Paths are relative to /coach ('' is the index). App.tsx mounts these before the existing coach routes, so a path
    registered here replaces the old page for that path while every other coach page keeps working. */

/* Each page arrives in its own chunk the first time a coach opens it, and waits in place meanwhile. The module pages
   check their module's flag themselves (FeatureGate), as the module route gate does. The old Appointments page stays
   at /coach/calendar. */
const lazy = (load: () => Promise<{ default: React.ComponentType }>) => { const C = React.lazy(load); return <Suspense fallback={<Skeleton rows={6} />}><C /></Suspense>; };

export const coachRoutes: Array<{ path: string; element: React.ReactElement }> = [
  { path: 'workouts', element: lazy(() => import('./plans/WorkoutsPage').then((m) => ({ default: m.WorkoutsPage }))) },
  { path: 'workouts/sessions', element: lazy(() => import('./plans/SessionsPage').then((m) => ({ default: m.SessionsPage }))) },
  { path: 'meals', element: lazy(() => import('./plans/MealPlansPage').then((m) => ({ default: m.MealPlansPage }))) },
  { path: 'appointments', element: lazy(() => import('./plans/AppointmentsOverview').then((m) => ({ default: m.AppointmentsOverview }))) },
];
