/* M2 Progress, the "Goals and check-ins" tab of the client record in the admin workspace (members.manage): the member's
   goals, the status of their check-ins and their weekly schedule. Never the check-in answers, and never a photo:
   administrators see photo counts only. */
import React from 'react';
import { api } from '../../lib/api';
import { fmtDate, label } from '../../lib/format';
import type { ClientRecordTabContext } from '../types';
import { Alert, Card, CardHead, Empty, Readout, Skeleton, Table, useApi } from '../../ui';
import { CheckinPill, GoalPill, ScheduleLine, type Checkin, type Goal, type Schedule } from './shared';

type Overview = {
  goals: { byStatus: Record<string, number>; items: Goal[] };
  checkins: { byStatus: Record<string, number>; items: Checkin[] };
  schedules: Schedule[];
  photos: { total: number; shared: number; consentGranted: boolean; note: string };
};

export function AdminProgressTab({ ctx }: { ctx: ClientRecordTabContext }) {
  const o = useApi<Overview>(() => api.get(`/admin/members/${ctx.memberId}/progress`), [ctx.memberId]);
  if (o.error) return <Alert kind="error">{o.error}</Alert>;
  if (!o.data) return <Skeleton rows={6} />;
  const d = o.data;
  const active = d.schedules.find((s) => s.active);
  return <div className="grid">
    <div className="span3"><Card dense><Readout eyebrow="Open goals" value={(d.goals.byStatus.active ?? 0) + (d.goals.byStatus.paused ?? 0)} sub={`${d.goals.byStatus.achieved ?? 0} achieved`} /></Card></div>
    <div className="span3"><Card dense><Readout eyebrow="Check-ins waiting" value={d.checkins.byStatus.requested ?? 0} sub={`${d.checkins.byStatus.submitted ?? 0} to review · ${d.checkins.byStatus.missed ?? 0} missed`} /></Card></div>
    <div className="span3"><Card dense><Readout eyebrow="Progress photos" value={d.photos.total} sub={`${d.photos.shared} shared with the coach · consent ${d.photos.consentGranted ? 'given' : 'not given'}`} /></Card></div>
    <div className="span3"><Card dense><Readout eyebrow="Weekly check-in" value={active ? active.weekdayLabel : 'None'} sub={active ? active.templateTitle : 'Not scheduled'} /></Card></div>
    <div className="span6"><Card><CardHead eyebrow="Goals" title="Set by the member or their coach" />
      {d.goals.items.length ? <Table dense label="Goals" head={<><th>Goal</th><th>Measured by</th><th>Status</th><th>Set</th></>}>{d.goals.items.map((g) => <tr key={g.id}><td>{g.title}</td><td>{g.metricLabel ?? '—'}{g.targetValue !== null && g.targetValue !== undefined ? ` · target ${g.targetValue}${g.unit ? ` ${g.unit}` : ''}` : ''}</td><td><GoalPill status={g.status} /></td><td>{label(g.createdByRole)} · {fmtDate(g.createdAt)}</td></tr>)}</Table> : <Empty title="No goals" />}
    </Card></div>
    <div className="span6"><Card><CardHead eyebrow="Check-ins" title="Statuses (answers stay between the member and their coach)" />
      {active && <p style={{ marginBottom: 8 }}><ScheduleLine s={active} /></p>}
      {d.checkins.items.length ? <Table dense label="Check-ins" head={<><th>Due</th><th>Template</th><th>Status</th></>}>{d.checkins.items.map((c) => <tr key={c.id}><td>{fmtDate(`${c.dueDate}T06:30:00Z`)}</td><td>{c.title}</td><td><CheckinPill status={c.status} /></td></tr>)}</Table> : <Empty title="No check-ins" />}
    </Card></div>
    <div className="span12"><p className="muted">{d.photos.note}</p></div>
  </div>;
}
