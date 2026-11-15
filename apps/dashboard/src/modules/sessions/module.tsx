/* M8 Live sessions, webinars and consultation follow-through: what the module adds to the portal. Pages load lazily;
   the server enforces everything again (feature 'sessions', roles, sessions.manage, members.manage, the host check).
   - Member portal: /client/sessions (sessions open to the member, their places and waitlist positions, how to join,
     calendar files); a Home card. Join details, calendar files and summaries on /client/appointments.
   - Coach workspace: /coach/sessions and /coach/sessions/:id (the sessions they host, registrants by name only,
     attendance); a Sessions tab on the client record; the "summaries to write" card on Today. Meeting details and
     the summary dialog on the Appointments page.
   - Admin workspace (sessions.manage): /admin/sessions and /admin/sessions/:id (every session, public webinars,
     public registrants' emails); the Sessions tab on the client record (members.manage); an Overview card.
   No website page: the public listing is an API (GET /public/webinars) behind the public_webinars switch. */
import React, { Suspense } from 'react';
import { Skeleton } from '../../ui';
import type { PortalModule } from '../types';

const lazyPage = <T extends Record<string, React.ComponentType<any>>, K extends keyof T>(load: () => Promise<T>, key: K) => React.lazy(() => load().then((m) => ({ default: m[key] as React.ComponentType<any> })));
const ClientSessions = lazyPage(() => import('./ClientSessions'), 'ClientSessions');
const HostSessions = lazyPage(() => import('./HostSessions'), 'HostSessions');
const SessionDetail = lazyPage(() => import('./SessionDetail'), 'SessionDetail');
const SessionsTab = lazyPage(() => import('./SessionsTab'), 'SessionsTab');
const ClientSessionsCard = lazyPage(() => import('./Cards'), 'ClientSessionsCard');
const CoachFollowThroughCard = lazyPage(() => import('./Cards'), 'CoachFollowThroughCard');
const AdminSessionsCard = lazyPage(() => import('./Cards'), 'AdminSessionsCard');

/** Cards and tabs render outside the Shell's page Suspense, so they bring their own. */
const held = (node: React.ReactNode, rows = 3) => <Suspense fallback={<Skeleton rows={rows} />}>{node}</Suspense>;

export const sessions: PortalModule = {
  key: 'sessions',
  title: 'Live sessions',
  routes: [
    { workspace: 'client', path: 'sessions', element: <ClientSessions /> },
    { workspace: 'coach', path: 'sessions', element: <HostSessions mode="coach" /> },
    { workspace: 'coach', path: 'sessions/:id', element: <SessionDetail mode="coach" /> },
    { workspace: 'admin', path: 'sessions', permission: 'sessions.manage', element: <HostSessions mode="admin" /> },
    { workspace: 'admin', path: 'sessions/:id', permission: 'sessions.manage', element: <SessionDetail mode="admin" /> },
  ],
  nav: [
    { workspace: 'client', to: '/sessions', label: 'Live sessions', before: '/bloodwork' },
    { workspace: 'coach', to: '/sessions', label: 'Live sessions', before: '/bloodwork' },
    { workspace: 'admin', to: '/sessions', label: 'Live sessions', permission: 'sessions.manage', before: '/messages' },
  ],
  clientTabs: [
    { id: 'sessions', label: 'Sessions', workspaces: ['coach'], render: (ctx) => held(<SessionsTab {...ctx} />, 6) },
    { id: 'sessions', label: 'Sessions', workspaces: ['admin'], permission: 'members.manage', render: (ctx) => held(<SessionsTab {...ctx} />, 6) },
  ],
  cards: [
    { id: 'sessions-next', placement: 'clientHome', span: 6, render: () => held(<ClientSessionsCard />) },
    { id: 'sessions-follow-through', placement: 'coachToday', span: 6, render: () => held(<CoachFollowThroughCard />) },
    { id: 'sessions-coming-up', placement: 'adminOverview', span: 6, permission: 'sessions.manage', render: () => held(<AdminSessionsCard />) },
  ],
};
