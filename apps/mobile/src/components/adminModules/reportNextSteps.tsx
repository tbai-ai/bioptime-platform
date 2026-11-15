/* The "Next steps" section of the administrator's report screen (the web's modules/labFollowups/ReportNextSteps.tsx in
   team mode, hosted by pages/Report.tsx:29; registered in lib/admin/b1/reportSections, shown while the labFollowups
   flag is on and the administrator holds reports.view). GET /admin/lab-follow-ups?reportId → { items, options, canAdd };
   the team may change any step with integrations.manage and a reason, and adds one only on a report it released
   itself (canAdd), with a reason. The report screen's pull to refresh reloads the section too (a new report payload),
   and the stale banner says when it shows the copy saved on the device. */
import React from 'react';
import { View } from 'react-native';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useLoad } from '@/lib/useLoad';
import type { ReportSectionContext } from '@/lib/admin/b1/reportSections';
import { useToast } from '@/components/adminA/toast';
import { Card, Eyebrow, H2, Loading, Notice, P, StaleBanner } from '@/components/ui';
import { useRecordTick } from '@/components/coachModules/shared';
import { FollowUpLine, TeamActions, TeamFollowUpForm, TeamLinkEditor, type FollowUp, type LinkOptions } from './labFollowups';
import { space } from '@/theme';

type View_ = { items: FollowUp[]; options?: LinkOptions; canAdd?: boolean | null };

export function ReportNextStepsSection({ ctx }: { ctx: ReportSectionContext }) {
  const { report } = ctx;
  const { can } = useAuth();
  const toast = useToast();
  const canWrite = can('integrations.manage');
  const tick = useRecordTick(report); // the report screen's pull to refresh reloads the next steps too
  const view = useLoad<View_>(`admin-report-next-steps-${report.id}`, () => get(`/admin/lab-follow-ups?reportId=${encodeURIComponent(report.id)}`), [report.id, report.released, tick]);
  const d = view.data;
  const items = d?.items ?? [];
  const mayAdd = canWrite && report.released && d?.canAdd === true;
  return <Card>
    <Eyebrow>Follow-up</Eyebrow><H2>Next steps</H2>
    {toast.node}
    <StaleBanner at={view.stale} />
    {view.error ? <Notice kind="error">{view.error.message}</Notice> : !d ? <Loading /> : <View style={{ gap: space.sm }}>
      {items.length ? <View>{items.map((f) => <FollowUpLine key={f.id} f={f}>{canWrite ? <><TeamLinkEditor f={f} options={d.options ?? null} onChanged={view.reload} show={toast.show} /><TeamActions f={f} onChanged={view.reload} show={toast.show} /></> : null}</FollowUpLine>)}</View>
        : <P small>{report.released ? 'No next steps on this report yet.' : 'Next steps are added once the report is reviewed and released.'}</P>}
      {mayAdd ? <TeamFollowUpForm reportId={report.id} options={d.options ?? null} onAdded={view.reload} show={toast.show} />
        : report.released && d.canAdd === false ? <P muted small>{`The member’s coach reviewed this report, so adding next steps and wording them is the coach’s job. ${canWrite ? 'The team can still mark one done, cancel or reopen it, or change its link, each with a reason.' : 'Changing them needs the “integrations.manage” permission.'}`}</P>
          : report.released && !canWrite ? <P muted small>Adding a next step on a team release needs the “integrations.manage” permission.</P> : null}
      <P muted small>The member sees open and done next steps with the report. When one is added they are notified: the notice says only that a next step was added, and any email or push copy carries just its title. They read the step itself when they sign in.</P>
    </View>}
  </Card>;
}
