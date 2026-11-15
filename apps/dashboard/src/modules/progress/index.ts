/* M2 Progress in the portal (flag 'progress'; photos also need the stored switch 'progressPhotos'):
   - client: /client/progress (pages/client/Progress.tsx, which this module alone edits) gains Trends, Goals, Check-ins
     and Photos tabs while the module is on; the Overview tab is the page as it was;
   - coach: a "Goals and check-ins" tab on the client record, a "Check-ins to review" card on Today, and the check-in
     templates page under Libraries;
   - admin: the check-in library (/admin/checkin-templates, library.manage, under Libraries), the same client-record tab
     read only with counts (members.manage; never answers or photos), and the photo retention setting on /admin/modules.
   Pages load lazily so the module's code arrives only when one of them opens. */
import React from 'react';
import { Skeleton } from '../../ui';
import type { ClientRecordTabContext, PortalModule } from '../types';

const CoachGoalsTab = React.lazy(() => import('./CoachGoalsTab').then((m) => ({ default: m.CoachGoalsTab })));
const AdminProgressTab = React.lazy(() => import('./AdminProgressTab').then((m) => ({ default: m.AdminProgressTab })));
const CheckinReviewCard = React.lazy(() => import('./CheckinReview').then((m) => ({ default: m.CheckinReviewCard })));
const CheckinTemplatesAdmin = React.lazy(() => import('./CheckinTemplates').then((m) => ({ default: m.CheckinTemplatesAdmin })));
const CheckinTemplatesCoach = React.lazy(() => import('./CheckinTemplates').then((m) => ({ default: m.CheckinTemplatesCoach })));

const h = React.createElement;
const wait = (rows: number, child: React.ReactNode) => h(React.Suspense, { fallback: h(Skeleton, { rows }) }, child);

export const progress: PortalModule = {
  key: 'progress',
  title: 'Progress',
  routes: [
    { workspace: 'coach', path: 'checkin-templates', element: wait(6, h(CheckinTemplatesCoach)) },
    { workspace: 'admin', path: 'checkin-templates', permission: 'library.manage', element: wait(6, h(CheckinTemplatesAdmin)) },
  ],
  nav: [
    { workspace: 'coach', to: '/checkin-templates', label: 'Check-in templates', group: 'Libraries' },
    { workspace: 'admin', to: '/checkin-templates', label: 'Check-in templates', permission: 'library.manage', group: 'Libraries' },
  ],
  clientTabs: [
    { id: 'goals', label: 'Goals and check-ins', workspaces: ['coach'], render: (ctx: ClientRecordTabContext) => wait(6, h(CoachGoalsTab, { ctx })) },
    { id: 'goals', label: 'Goals and check-ins', workspaces: ['admin'], permission: 'members.manage', render: (ctx: ClientRecordTabContext) => wait(6, h(AdminProgressTab, { ctx })) },
  ],
  cards: [{ id: 'checkins-to-review', placement: 'coachToday', span: 6, render: () => wait(3, h(CheckinReviewCard)) }],
  settings: [{ key: 'progress_photo_retention_days', label: 'Progress photo retention (days)', hint: 'How long progress photos are kept after they are added. Empty: until the member deletes them. An owner decision; nothing is assumed.' }],
};
