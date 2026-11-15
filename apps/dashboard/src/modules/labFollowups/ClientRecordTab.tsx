/* The "Lab next steps" tab on the client record. Coach (/coach/clients/:id?tab=lab-follow-ups): the client's next steps
   from their reports, with complete, cancel, reopen and link; nothing is requested while the client does not share
   health information (the server answers NOT_SHARED). New next steps are added on the report itself. Administrator
   (/admin/clients/:id?tab=lab-follow-ups, reports.view): the same list; changes need integrations.manage and a reason. */
import React from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Link } from '../../lib/nav';
import { fmtDate } from '../../lib/format';
import { Alert, Card, CardHead, Empty, Skeleton, useApi } from '../../ui';
import type { ClientRecordTabContext } from '../types';
import { FollowUpActions, FollowUpLine, LinkEditor, type FollowUp, type LinkOptions } from './shared';

type View = { items: FollowUp[]; options?: LinkOptions };
type ReportRow = { id: string; reference: string; released: boolean; test?: { name: string } | null; releasedAt?: string | null };

export function ClientRecordTab({ ctx }: { ctx: ClientRecordTabContext }) {
  if (!ctx.isPrivileged && !ctx.healthShared) return <Alert kind="info" title="Not shared">Next steps come from the client’s reports, which stay private until they share health information with you.</Alert>;
  return <Tab ctx={ctx} />;
}

function Tab({ ctx }: { ctx: ClientRecordTabContext }) {
  const { memberId, isPrivileged, detail } = ctx;
  const { can } = useAuth();
  const view = useApi(() => api.get<View>(isPrivileged ? `/admin/lab-follow-ups?memberId=${encodeURIComponent(memberId)}` : `/coach/clients/${memberId}/lab-follow-ups`), [memberId, isPrivileged]);
  const canWrite = !isPrivileged || can('integrations.manage');
  const reports = (((detail as { reports?: ReportRow[] } | null)?.reports) ?? []).filter((r) => r.released);
  const d = view.data;
  if (view.error) return <Alert kind="error">{view.error}</Alert>;
  if (!d) return <Skeleton rows={5} />;
  const open = d.items.filter((f) => f.status === 'open');
  const closed = d.items.filter((f) => f.status !== 'open');
  const actions = (f: FollowUp) => (canWrite && (isPrivileged || f.setBy.role === 'coach') ? <><LinkEditor f={f} options={d.options ?? null} team={isPrivileged} onChanged={view.reload} /><FollowUpActions f={f} team={isPrivileged} onChanged={view.reload} /></> : undefined);
  return <div className="grid">
    <div className="span8"><div className="stack">
      <Card><CardHead eyebrow="Lab next steps" title={open.length ? `${open.length} open` : 'Nothing open'} />
        {open.length ? <ul className="taskList">{open.map((f) => <FollowUpLine key={f.id} f={f} showReport actions={actions(f)} />)}</ul>
          : <Empty title="No open next steps" body={reports.length ? 'Add one from a released report.' : 'Next steps are added to a report once it is reviewed and released.'} />}
      </Card>
      {closed.length ? <Card><CardHead eyebrow="History" title="Done and cancelled" /><ul className="taskList">{closed.map((f) => <FollowUpLine key={f.id} f={f} showReport actions={actions(f)} />)}</ul></Card> : null}
    </div></div>
    <div className="span4"><Card><CardHead eyebrow="Reports" title="Add a next step" />
      {reports.length ? <ul className="taskList">{reports.map((r) => <li key={r.id}><div><Link to={`/reports/${r.id}`}>{r.test?.name ?? 'Report'}</Link><span className="muted">{r.reference}{r.releasedAt ? ` · released ${fmtDate(r.releasedAt)}` : ''}</span></div></li>)}</ul>
        : <p className="small">No released report yet.</p>}
      <p className="muted small" style={{ marginTop: 8 }}>{isPrivileged ? 'The team adds next steps only on a report it released itself; the assigned coach adds them once a report is released. On a step a coach wrote, the team can mark it done, cancel or reopen it, or change its link, each with a reason; its words and due date stay the coach’s.' : 'Open a report to add a next step to it. The client sees open and done next steps with the report.'}</p>
    </Card></div>
  </div>;
}
