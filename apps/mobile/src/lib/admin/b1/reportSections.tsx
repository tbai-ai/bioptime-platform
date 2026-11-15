/* The sections modules add to the administrator's report page (src/app/admin/reports/[id].tsx), under the review card,
   as the web's pages/Report.tsx:29 hosts the lab follow-ups module's "Next steps" (modules/labFollowups/ReportNextSteps).
   The page renders each entry only while its module flag is on (lib/features), its `feature` sub-flag when named, and
   the administrator holds `permission` (lib/auth can). Module builders push into REPORT_SECTIONS; the page never knows
   which modules exist. */
import React from 'react';
import type { ModuleKey } from '@/lib/modules';
import type { Report } from './types';
import { ReportNextStepsSection } from '@/components/adminModules/reportNextSteps';

export type ReportSectionContext = {
  /** The report the page loaded (GET /reports/:id). */
  report: Report;
  /** Ask the page to reload the report (after a section changes something it shows). */
  reload: () => void;
};

export type ReportSection = {
  /** Stable id, the web's module key ('lab-follow-ups'). */
  id: string;
  module: ModuleKey;
  feature?: string;
  permission?: string;
  render: (ctx: ReportSectionContext) => React.ReactElement;
};

/** Filled by the module builders (src/lib/admin/modules/*), in the web's order: the lab follow-ups' "Next steps"
 *  (shown on the web for an administrator with reports.view while the labFollowups flag is on). */
export const REPORT_SECTIONS: ReportSection[] = [
  { id: 'lab-follow-ups', module: 'labFollowups', permission: 'reports.view', render: (ctx) => <ReportNextStepsSection ctx={ctx} /> },
];
