/* Growth: what the module adds to the portal. Pages load lazily; the server enforces everything again (feature
   'growth', roles, growth.manage, and members.view_restricted for phone numbers).
   - Admin workspace (growth.manage), under the Growth heading: /admin/growth/discovery-calls (requests and the times
     offered on the website; one request at /admin/growth/discovery-calls/:id), /admin/growth/corporate (and :id) and
     /admin/growth/newsletter (subscribers, CSV export); an Overview card.
   - Coach workspace: /coach/discovery-calls, the calls the team assigned to the coach (name, goals, times, status;
     never contact details).
   The website pages (discovery-call, package-finder, calculators, corporate, webinars and the footer's newsletter
   sign-up) are in the website folder; no member page. */
import React, { Suspense } from 'react';
import { Skeleton } from '../../ui';
import type { PortalModule } from '../types';

const AdminDiscoveryCalls = React.lazy(() => import('./AdminDiscoveryCalls'));
const AdminCorporate = React.lazy(() => import('./AdminCorporate'));
const AdminNewsletter = React.lazy(() => import('./AdminNewsletter'));
const CoachDiscoveryCalls = React.lazy(() => import('./CoachDiscoveryCalls'));
const AdminGrowthCard = React.lazy(() => import('./Cards').then((m) => ({ default: m.AdminGrowthCard })));

const PERMISSION = 'growth.manage';
/** Cards render outside the Shell's page Suspense, so they bring their own. */
const held = (node: React.ReactNode) => <Suspense fallback={<Skeleton rows={3} />}>{node}</Suspense>;

export const growth: PortalModule = {
  key: 'growth',
  title: 'Growth',
  routes: [
    { workspace: 'admin', path: 'growth/discovery-calls', permission: PERMISSION, element: <AdminDiscoveryCalls /> },
    { workspace: 'admin', path: 'growth/discovery-calls/:id', permission: PERMISSION, element: <AdminDiscoveryCalls /> },
    { workspace: 'admin', path: 'growth/corporate', permission: PERMISSION, element: <AdminCorporate /> },
    { workspace: 'admin', path: 'growth/corporate/:id', permission: PERMISSION, element: <AdminCorporate /> },
    { workspace: 'admin', path: 'growth/newsletter', permission: PERMISSION, element: <AdminNewsletter /> },
    { workspace: 'coach', path: 'discovery-calls', element: <CoachDiscoveryCalls /> },
  ],
  nav: [
    { workspace: 'admin', to: '/growth/discovery-calls', label: 'Discovery calls', permission: PERMISSION, group: 'Growth' },
    { workspace: 'admin', to: '/growth/corporate', label: 'Corporate enquiries', permission: PERMISSION, group: 'Growth' },
    { workspace: 'admin', to: '/growth/newsletter', label: 'Newsletter', permission: PERMISSION, group: 'Growth' },
    { workspace: 'coach', to: '/discovery-calls', label: 'Discovery calls', group: 'Growth' },
  ],
  cards: [
    { id: 'growth-website', placement: 'adminOverview', span: 6, permission: PERMISSION, render: () => held(<AdminGrowthCard />) },
  ],
};
