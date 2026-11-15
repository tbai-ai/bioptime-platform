/* The module tabs of the administrator's member record (the web's ClientDetail tab strip in admin mode:
   apps/dashboard/src/modules/<key>/index.ts `tabs` with workspace 'admin', each behind a permission). The record screen
   (src/app/admin/clients/[id].tsx) shows the core tabs and then these, each only while its module flag is on
   (lib/features), its `feature` sub-flag when named, and the administrator holds `permission` (lib/auth can). The
   module builders fill MODULE_RECORD_TABS; the record screen never knows which modules exist. */
import React from 'react';
import type { ModuleKey } from '@/lib/modules';
import { AdminHabitsTab } from './modules/habits';
import { AdminProgressTab } from './modules/progress';
import { ClientRecordBilling } from './modules/billing';
import { ClientSupportTab } from './modules/support';
import { AdminWorkoutsTab } from './modules/workouts';
import { AdminLabFollowupsTab } from './modules/labFollowups';
import { AdminSessionsTab } from './modules/sessions';
import { AdminLearningTab } from './modules/learning';

export type RecordTabContext = {
  /** The member's user id (GET /admin/members/:id). */
  memberId: string;
  /** The record payload the screen already loaded (GET /admin/members/:id), for tabs that read from it. */
  record: unknown;
  /** Ask the record screen to reload its payload (after a tab changes something it shows). */
  reload: () => void;
};

export type RecordTab = {
  /** Stable id, the web's tab id ('habits', 'goals', 'nutrition', 'workouts', 'lab-follow-ups', 'sessions', 'learning', 'ai', 'billing', 'support'). */
  id: string;
  label: string;
  module: ModuleKey;
  feature?: string;
  permission?: string;
  render: (ctx: RecordTabContext) => React.ReactElement;
};

/** Filled by the module builders (src/lib/admin/modules/*), in the web's registry order (apps/dashboard/src/modules/index.ts:21)
 *  with each tab's admin declaration (`workspaces: ['admin']`): habits → progress → billing → support → workouts →
 *  labFollowups → sessions → learning. Nutrition and Coach AI add no admin tab ("drafts belong to the coach who asked for
 *  them"; the nutrition tab is the coach's alone). */
export const MODULE_RECORD_TABS: RecordTab[] = [
  { id: 'habits', label: 'Habits', module: 'habits', permission: 'members.manage', render: (ctx) => <AdminHabitsTab ctx={ctx} /> },
  { id: 'goals', label: 'Goals and check-ins', module: 'progress', permission: 'members.manage', render: (ctx) => <AdminProgressTab ctx={ctx} /> },
  { id: 'billing', label: 'Billing', module: 'billing', permission: 'orders.manage', render: (ctx) => <ClientRecordBilling ctx={ctx} /> },
  { id: 'support', label: 'Support', module: 'support', feature: 'support_requests', permission: 'operations.manage', render: (ctx) => <ClientSupportTab ctx={ctx} /> },
  { id: 'workouts', label: 'Workouts', module: 'workouts', permission: 'members.manage', render: (ctx) => <AdminWorkoutsTab ctx={ctx} /> },
  { id: 'lab-follow-ups', label: 'Lab next steps', module: 'labFollowups', permission: 'reports.view', render: (ctx) => <AdminLabFollowupsTab ctx={ctx} /> },
  { id: 'sessions', label: 'Sessions', module: 'sessions', permission: 'members.manage', render: (ctx) => <AdminSessionsTab ctx={ctx} /> },
  { id: 'learning', label: 'Learning', module: 'learning', permission: 'members.manage', render: (ctx) => <AdminLearningTab ctx={ctx} /> },
];
