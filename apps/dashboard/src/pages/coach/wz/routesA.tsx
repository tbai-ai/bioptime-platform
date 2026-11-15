import React from 'react';
import { CoachDashboard } from './dashboard/CoachDashboard';
import { ClientsList } from './clients/ClientsList';
import { ClientProfile } from './clients/ClientProfile';

/** Coach workspace pages, filled by group "dash" (index dashboard, clients, clients/:id).
    Paths are relative to /coach ('' is the index). App.tsx mounts these before the existing coach routes, so a path
    registered here replaces the old page for that path while every other coach page keeps working. */
export const coachRoutes: Array<{ path: string; element: React.ReactElement }> = [
  { path: '', element: <CoachDashboard /> },
  { path: 'clients', element: <ClientsList /> },
  { path: 'clients/:id', element: <ClientProfile /> },
];
