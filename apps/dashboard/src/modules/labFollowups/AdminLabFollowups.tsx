/* /admin/lab-follow-ups (reports.view): every next step set after a report review, with counts and filters. Changes
   (done, cancel, reopen, link) need integrations.manage and a reason; new team next steps are added on a report the
   team released (the report page). LabStack administration is not here: it stays under /admin/integrations/labstack. */
import React, { useState } from 'react';
import { api, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Link } from '../../lib/nav';
import { fmtDate } from '../../lib/format';
import { Alert, Card, CardHead, Empty, Readout, Select, Skeleton, Table, useApi } from '../../ui';
import { FollowUpActions, KINDS, LinkLines, StatusPill, day, type FollowUp } from './shared';

type Summary = { open: number; done: number; cancelled: number; overdue: number };

export function AdminLabFollowups() {
  const { can } = useAuth();
  const [status, setStatus] = useState<'open' | 'done' | 'cancelled' | 'all' | 'overdue'>('open');
  const [kind, setKind] = useState('');
  const list = useApi(() => api.get<{ items: FollowUp[]; summary: Summary }>(`/admin/lab-follow-ups${qs(status === 'overdue' ? { overdue: 1, kind } : { status, kind })}`), [status, kind]);
  const canWrite = can('integrations.manage');
  const s = list.data?.summary;
  const items = list.data?.items ?? [];
  return <div className="stack">
    <div className="pageHead"><div><h1>Lab follow-ups</h1><p className="sub">Next steps set after a report review: consultations, retests, plan changes and notes. The assigned coach sets them once a report is released, while the client shares health information; the team sets them on reports it released itself. On a coach’s step the team can mark it done, cancel or reopen it, or change its link, but not its words. Due dates are the writer’s own; nothing here suggests one.</p></div></div>
    {s ? <div className="grid">
      <div className="span3"><Card dense><Readout eyebrow="Open" value={s.open} /></Card></div>
      <div className="span3"><Card dense><Readout eyebrow="Past due" value={s.overdue} hot={s.overdue > 0} /></Card></div>
      <div className="span3"><Card dense><Readout eyebrow="Done" value={s.done} /></Card></div>
      <div className="span3"><Card dense><Readout eyebrow="Cancelled" value={s.cancelled} /></Card></div>
    </div> : null}
    <div className="grid">
      <div className="span3"><Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="open">Open</option><option value="overdue">Past due</option><option value="done">Done</option><option value="cancelled">Cancelled</option><option value="all">Any status</option></Select></div>
      <div className="span3"><Select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Any kind</option>{KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</Select></div>
    </div>
    {list.error ? <Alert kind="error" title="Next steps could not be loaded">{list.error}</Alert> : !list.data ? <Skeleton rows={5} />
      : items.length ? <Card dense><Table label="Lab follow-ups" head={<><th>Member</th><th>Next step</th><th>Report</th><th>Due</th><th>Set by</th><th>Status</th>{canWrite && <th></th>}</>}>
        {items.map((f) => <tr key={f.id}>
          <td><Link to={`/clients/${f.memberId}?tab=lab-follow-ups`}>{f.memberName ?? f.memberId}</Link></td>
          <td><b>{f.kindLabel}</b><div className="small">{f.note}</div><div className="stack" style={{ gap: 2 }}><LinkLines f={f} /></div>{f.status === 'cancelled' && f.cancelledReason ? <div className="muted small">Cancelled: {f.cancelledReason}</div> : null}</td>
          <td>{f.report ? <Link to={`/reports/${f.report.id}`}>{f.report.testName ?? 'Report'}</Link> : '—'}<div className="muted">{f.report?.reference}</div></td>
          <td>{f.dueDate ? day(f.dueDate) : <span className="muted">None</span>}</td>
          <td className="small">{f.setBy.role === 'coach' ? `Coach ${f.setBy.name ?? ''}` : `Team · ${f.setBy.name ?? ''}`}<div className="muted">{fmtDate(f.createdAt)}</div></td>
          <td><StatusPill f={f} /></td>
          {canWrite && <td className="pillRow"><FollowUpActions f={f} team onChanged={list.reload} /></td>}
        </tr>)}
      </Table></Card> : <Card><Empty title="No next steps here" body={status === 'open' ? 'Nothing is open. Next steps appear once a coach or the team adds them to a released report.' : 'Nothing matches these filters.'} /></Card>}
    {!canWrite && <p className="muted small">Changing a next step needs the “integrations.manage” permission.</p>}
  </div>;
}

/** The admin Overview card: open, past-due and done next steps (reports.view), in the style of the Bloodwork card. */
export function AdminOverviewCard() {
  const list = useApi(() => api.get<{ summary: Summary }>('/admin/lab-follow-ups?status=open&limit=1'), []);
  const s = list.data?.summary;
  return <Card><CardHead eyebrow="Reports" title="Lab next steps" right={<Link className="bp-btn bp-btn-tertiary bp-btn-sm" to="/lab-follow-ups">Open</Link>} />
    {list.error ? <Alert kind="error">{list.error}</Alert> : !s ? <Skeleton rows={3} /> : <dl className="kv"><dt>Open</dt><dd className="num">{s.open}</dd><dt>Past due</dt><dd className="num">{s.overdue}</dd><dt>Done</dt><dd className="num">{s.done}</dd><dt>Cancelled</dt><dd className="num">{s.cancelled}</dd></dl>}
  </Card>;
}
