/* The cards registered modules add to the administrator's Overview (the web's useModuleCards('adminOverview'),
   apps/dashboard/src/modules/runtime.tsx: Billing, Coach proposals to review, Lab next steps, Coming up, Courses, From
   the website), in registry order, each only while its module flag is on (lib/features), its `feature` sub-flag when
   named, and the administrator holds `permission`. The Overview screen (src/app/(admin)/index.tsx) renders whatever is
   here after its own cards; the module builders fill MODULE_OVERVIEW_CARDS, the screen never knows which modules exist. */
import React from 'react';
import type { ModuleKey } from '@/lib/modules';
import { BillingOverviewCard, CoursesOverviewCard, GrowthOverviewCard, LabFollowupsOverviewCard, SessionsOverviewCard, WorkoutsLibraryOverviewCard } from '@/components/adminModules/overviewCards';

export type OverviewCardContext = {
  /** GET /admin/overview as the screen loaded it. */
  overview: unknown;
  /** The Overview's pull to refresh fired (a card may reload what it fetched itself). */
  refreshTick: number;
};

export type OverviewCard = {
  /** Stable id, the module's own ('billing', 'workouts', 'lab-follow-ups', 'sessions', 'learning', 'growth'). */
  id: string;
  module: ModuleKey;
  feature?: string;
  permission?: string;
  render: (ctx: OverviewCardContext) => React.ReactElement;
};

/** Filled by the module builders, in the web's registry order (apps/dashboard/src/modules/index.ts:21): billing →
 *  workouts → labFollowups → sessions → learning → growth (the cards and permissions of section 17 of the inventory;
 *  each card is drawn by src/components/adminModules/overviewCards.tsx). */
export const MODULE_OVERVIEW_CARDS: OverviewCard[] = [
  { id: 'billing', module: 'billing', permission: 'orders.manage', render: (ctx) => <BillingOverviewCard ctx={ctx} /> },
  { id: 'workouts', module: 'workouts', permission: 'library.manage', render: (ctx) => <WorkoutsLibraryOverviewCard ctx={ctx} /> },
  { id: 'lab-follow-ups', module: 'labFollowups', permission: 'reports.view', render: (ctx) => <LabFollowupsOverviewCard ctx={ctx} /> },
  { id: 'sessions', module: 'sessions', permission: 'sessions.manage', render: (ctx) => <SessionsOverviewCard ctx={ctx} /> },
  { id: 'learning', module: 'learning', permission: 'learning.manage', render: (ctx) => <CoursesOverviewCard ctx={ctx} /> },
  { id: 'growth', module: 'growth', permission: 'growth.manage', render: (ctx) => <GrowthOverviewCard ctx={ctx} /> },
];
