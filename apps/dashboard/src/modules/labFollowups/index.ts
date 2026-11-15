/* M7 Lab follow-ups and preparation reminders in the portal (flag 'labFollowups'):
   - client: "Next steps" and a marker trend on the report page (pages/client/ClientReport.tsx, which this module alone
     edits), and a Home card with the open next steps and the next collection's preparation and reminder;
   - coach: "Next steps" on the report page (pages/Report.tsx, which this module alone edits), a "Lab next steps" tab on
     the client record and a card on Today;
   - admin: /admin/lab-follow-ups (reports.view) in the navigation after Bloodwork, the same client-record tab and a card
     on the Overview; changes need integrations.manage and a reason.
   LabStack administration is not part of this module and is never linked from it. Pages load lazily so the module's
   code arrives only when one of them opens. */
import React from 'react';
import { Skeleton } from '../../ui';
import type { ClientRecordTabContext, PortalModule } from '../types';

const h = React.createElement;
const AdminLabFollowups = React.lazy(() => import('./AdminLabFollowups').then((m) => ({ default: m.AdminLabFollowups })));
const AdminOverviewCard = React.lazy(() => import('./AdminLabFollowups').then((m) => ({ default: m.AdminOverviewCard })));
const ClientRecordTab = React.lazy(() => import('./ClientRecordTab').then((m) => ({ default: m.ClientRecordTab })));
const CoachTodayCard = React.lazy(() => import('./CoachTodayCard').then((m) => ({ default: m.CoachTodayCard })));
const ClientHomeCard = React.lazy(() => import('./ClientHomeCard').then((m) => ({ default: m.ClientHomeCard })));
const LazyReportNextSteps = React.lazy(() => import('./ReportNextSteps').then((m) => ({ default: m.ReportNextSteps })));
const LazyClientReportNextSteps = React.lazy(() => import('./ClientReportSections').then((m) => ({ default: m.ClientReportNextSteps })));
const LazyClientMarkerTrends = React.lazy(() => import('./ClientReportSections').then((m) => ({ default: m.ClientMarkerTrends })));

const wait = (rows: number, child: React.ReactNode) => h(React.Suspense, { fallback: h(Skeleton, { rows }) }, child);
const quiet = (child: React.ReactNode) => h(React.Suspense, { fallback: null }, child);
const tab = (ctx: ClientRecordTabContext) => wait(5, h(ClientRecordTab, { ctx }));

/** The report page's "Next steps" section (coach and admin workspaces); renders nothing while the flag is off. */
export function ReportNextSteps(props: { report: { id: string; memberId: string; released: boolean; reviewerKind: 'coach' | 'team' } }) { return quiet(h(LazyReportNextSteps, props)); }
/** The member's report page: "Next steps" on this report; nothing while the flag is off. */
export function ClientReportNextSteps(props: { reportId: string }) { return quiet(h(LazyClientReportNextSteps, props)); }
/** The member's report page: one marker across their released reports; nothing while the flag is off. */
export function ClientMarkerTrends(props: { values: Array<{ marker_key: string | null; label: string; value: string; units: string | null; range_low: number | null; range_high: number | null; flag: string | null }> | undefined }) { return quiet(h(LazyClientMarkerTrends, props)); }

export const labFollowups: PortalModule = {
  key: 'labFollowups',
  title: 'Lab follow-ups',
  routes: [{ workspace: 'admin', path: 'lab-follow-ups', permission: 'reports.view', element: wait(6, h(AdminLabFollowups)) }],
  nav: [{ workspace: 'admin', to: '/lab-follow-ups', label: 'Lab follow-ups', permission: 'reports.view', before: '/orders' }],
  clientTabs: [
    { id: 'lab-follow-ups', label: 'Lab next steps', workspaces: ['coach'], render: tab },
    { id: 'lab-follow-ups', label: 'Lab next steps', workspaces: ['admin'], permission: 'reports.view', render: tab },
  ],
  cards: [
    { id: 'lab-next-steps', placement: 'clientHome', span: 6, render: () => wait(3, h(ClientHomeCard)) },
    { id: 'lab-next-steps', placement: 'coachToday', span: 6, render: () => wait(3, h(CoachTodayCard)) },
    { id: 'lab-next-steps', placement: 'adminOverview', span: 4, permission: 'reports.view', render: () => wait(3, h(AdminOverviewCard)) },
  ],
};
