/* M9 Message attachments and announcements: what the module adds to the portal (flag 'messaging'). Pages load lazily,
   so the module's code arrives only when one of them opens; the server enforces everything again (feature
   'messaging', roles, announcements.manage, members.manage for an administrator opening a file).
   - Member portal: /client/announcements (a nav item before Profile, as in the coach workspace) and an
     "Announcements" card on Home. Files on messages live in the core Messages page (src/pages/Messages.tsx), shown
     while this flag is on.
   - Coach workspace: /coach/announcements (to their own assigned clients only).
   - Admin workspace: /admin/announcements (announcements.manage). */
import React, { Suspense } from 'react';
import { Skeleton } from '../../ui';
import type { PortalModule } from '../types';

const lazyPage = <T extends Record<string, React.ComponentType<any>>, K extends keyof T>(load: () => Promise<T>, key: K) => React.lazy(() => load().then((m) => ({ default: m[key] as React.ComponentType<any> })));
const ClientAnnouncements = lazyPage(() => import('./ClientAnnouncements'), 'ClientAnnouncements');
const AnnouncementsHomeCard = lazyPage(() => import('./ClientAnnouncements'), 'AnnouncementsHomeCard');
const CoachAnnouncements = lazyPage(() => import('./CoachAnnouncements'), 'CoachAnnouncements');
const AdminAnnouncements = lazyPage(() => import('./AdminAnnouncements'), 'AdminAnnouncements');

/** Cards render outside the Shell's page Suspense, so they bring their own. */
const held = (node: React.ReactNode, rows = 3) => <Suspense fallback={<Skeleton rows={rows} />}>{node}</Suspense>;

export const messaging: PortalModule = {
  key: 'messaging',
  title: 'Attachments and announcements',
  routes: [
    { workspace: 'client', path: 'announcements', element: <ClientAnnouncements /> },
    { workspace: 'coach', path: 'announcements', element: <CoachAnnouncements /> },
    { workspace: 'admin', path: 'announcements', permission: 'announcements.manage', element: <AdminAnnouncements /> },
  ],
  nav: [
    { workspace: 'client', to: '/announcements', label: 'Announcements', before: '/profile' },
    { workspace: 'coach', to: '/announcements', label: 'Announcements', before: '/profile' },
    { workspace: 'admin', to: '/announcements', label: 'Announcements', permission: 'announcements.manage', before: '/content' },
  ],
  cards: [
    { id: 'announcements-home', placement: 'clientHome', span: 6, render: () => held(<AnnouncementsHomeCard />) },
  ],
};
