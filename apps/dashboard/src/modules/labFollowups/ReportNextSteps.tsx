/* "Next steps" on the report page (pages/Report.tsx) in the coach and admin workspaces, shown while the labFollowups
   flag is on. Coach: the next steps on this report and the form that adds one once the report is released (the server
   checks the assignment and the client's health sharing again). Administrator: the list with reports.view; the form
   only on a report the team released itself, with integrations.manage and a reason. */
import React from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Alert, Card, CardHead, Skeleton, useApi } from '../../ui';
import { FollowUpActions, FollowUpForm, FollowUpLine, LinkEditor, useLabFlag, type FollowUp, type LinkOptions } from './shared';

type Report = { id: string; memberId: string; released: boolean; reviewerKind: 'coach' | 'team' };
type View = { items: FollowUp[]; options?: LinkOptions; canAdd?: boolean | null };

export function ReportNextSteps({ report }: { report: Report }) {
  const on = useLabFlag();
  const { isCoach, isPrivileged, can } = useAuth();
  if (!on || (!isCoach && !(isPrivileged && can('reports.view')))) return null;
  return <Steps report={report} team={!isCoach} canWrite={isCoach || can('integrations.manage')} />;
}

function Steps({ report, team, canWrite }: { report: Report; team: boolean; canWrite: boolean }) {
  const view = useApi(() => api.get<View>(team ? `/admin/lab-follow-ups?reportId=${encodeURIComponent(report.id)}` : `/coach/clients/${report.memberId}/lab-follow-ups?reportId=${encodeURIComponent(report.id)}`), [report.id, report.memberId, team, report.released]);
  const d = view.data;
  const items = d?.items ?? [];
  const mayAdd = canWrite && report.released && (team ? d?.canAdd === true : true);
  return <Card style={{ marginTop: 14 }}>
    <CardHead eyebrow="Follow-up" title="Next steps" />
    {view.error ? <Alert kind="error">{view.error}</Alert> : !d ? <Skeleton rows={3} /> : <div className="stack">
      {items.length ? <ul className="taskList">{items.map((f) => <FollowUpLine key={f.id} f={f} actions={canWrite && (team || f.setBy.role === 'coach') ? <><LinkEditor f={f} options={d.options ?? null} team={team} onChanged={view.reload} /><FollowUpActions f={f} team={team} onChanged={view.reload} /></> : undefined} />)}</ul>
        : <p className="small">{report.released ? 'No next steps on this report yet.' : 'Next steps are added once the report is reviewed and released.'}</p>}
      {mayAdd ? <FollowUpForm reportId={report.id} options={d.options ?? null} team={team} onAdded={view.reload} />
        : report.released && team && d.canAdd === false ? <p className="muted small">The member’s coach reviewed this report, so adding next steps and wording them is the coach’s job. {canWrite ? 'The team can still mark one done, cancel or reopen it, or change its link, each with a reason.' : 'Changing them needs the “integrations.manage” permission.'}</p>
          : report.released && team && !canWrite ? <p className="muted small">Adding a next step on a team release needs the “integrations.manage” permission.</p> : null}
      <p className="muted small">The member sees open and done next steps with the report. When one is added they are notified: the notice says only that a next step was added, and any email or push copy carries just its title. They read the step itself when they sign in.</p>
    </div>}
  </Card>;
}
