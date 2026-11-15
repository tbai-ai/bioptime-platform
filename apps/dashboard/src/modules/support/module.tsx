/* M4 Support requests, help centre, data export, imports and coach onboarding: what the module adds to the portal.
   - Member portal: /client/help (help articles, my requests and their threads, my data export), linked after Profile.
   - Coach workspace: /coach/help (articles for coaches, my requests, the onboarding checklist), linked after Settings;
     the onboarding checklist card on Today. No client-record tab: coaches never see members' support requests.
   - Admin workspace, under a Support heading: /admin/support (the queue, operations.manage; data exports,
     members.manage), /admin/help-articles (content.manage), /admin/imports (imports.manage); a Support tab on the
     client record (operations.manage).
   Each part also follows its own switch (support_requests, help_centre, imports) beside the module flag. */
import React, { Suspense } from 'react';
import { Skeleton } from '../../ui';
import type { PortalModule } from '../types';

const HelpCentre = React.lazy(() => import('./HelpCentre'));
const AdminSupport = React.lazy(() => import('./AdminSupport'));
const AdminHelpArticles = React.lazy(() => import('./AdminHelpArticles'));
const AdminImports = React.lazy(() => import('./AdminImports'));
const ClientSupportTab = React.lazy(() => import('./ClientSupportTab'));
const CoachOnboarding = React.lazy(() => import('./CoachOnboarding'));

/** A tab or card loads its chunk in place, without blanking the page around it. */
const Lazy = ({ children, rows = 4 }: { children: React.ReactNode; rows?: number }) => <Suspense fallback={<Skeleton rows={rows} />}>{children}</Suspense>;

const SUPPORT_PAGE = ['operations.manage', 'members.manage'];

export const support: PortalModule = {
  key: 'support',
  title: 'Support',
  routes: [
    { workspace: 'client', path: 'help', element: <HelpCentre /> },
    { workspace: 'client', path: 'help/articles/:slug', feature: 'help_centre', element: <HelpCentre /> },
    { workspace: 'client', path: 'help/requests/:id', feature: 'support_requests', element: <HelpCentre /> },
    { workspace: 'coach', path: 'help', element: <HelpCentre /> },
    { workspace: 'coach', path: 'help/articles/:slug', feature: 'help_centre', element: <HelpCentre /> },
    { workspace: 'coach', path: 'help/requests/:id', feature: 'support_requests', element: <HelpCentre /> },
    { workspace: 'admin', path: 'support', permission: SUPPORT_PAGE, any: true, element: <AdminSupport /> },
    { workspace: 'admin', path: 'support/:id', permission: 'operations.manage', feature: 'support_requests', element: <AdminSupport /> },
    { workspace: 'admin', path: 'help-articles', permission: 'content.manage', feature: 'help_centre', element: <AdminHelpArticles /> },
    { workspace: 'admin', path: 'imports', permission: 'imports.manage', feature: 'imports', element: <AdminImports /> },
    { workspace: 'admin', path: 'imports/:id', permission: 'imports.manage', feature: 'imports', element: <AdminImports /> },
  ],
  nav: [
    { workspace: 'client', to: '/help', label: 'Help and support' },
    { workspace: 'coach', to: '/help', label: 'Help' },
    { workspace: 'admin', to: '/support', label: 'Support requests', group: 'Support', permission: SUPPORT_PAGE, any: true },
    { workspace: 'admin', to: '/help-articles', label: 'Help articles', group: 'Support', permission: 'content.manage', feature: 'help_centre' },
    { workspace: 'admin', to: '/imports', label: 'Imports', group: 'Support', permission: 'imports.manage', feature: 'imports' },
  ],
  clientTabs: [
    { id: 'support', label: 'Support', workspaces: ['admin'], permission: 'operations.manage', feature: 'support_requests', render: ({ memberId }) => <Lazy><ClientSupportTab memberId={memberId} /></Lazy> },
  ],
  cards: [
    { id: 'support-coach-onboarding', placement: 'coachToday', span: 6, render: () => <Lazy rows={3}><CoachOnboarding compact /></Lazy> },
  ],
};
