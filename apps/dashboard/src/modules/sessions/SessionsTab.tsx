/* M8 Live sessions, client record (coach and admin workspaces): the client's live sessions, the summaries their
   coaches wrote after consultations, and the follow-ups (a coach sees their own; administrators see every coach's).
   Nothing here is health data: sessions are sign-ups, summaries are what the coach wrote for the member. */
import React from 'react';
import { Link } from '../../lib/nav';
import { api } from '../../lib/api';
import { fmtDate, label } from '../../lib/format';
import { Alert, Card, CardHead, Empty, Pill, Skeleton, Table, useApi } from '../../ui';
import type { ClientRecordTabContext } from '../types';
import { RegistrationPill, SessionStatusPill } from './shared';

export function SessionsTab({ memberId, isPrivileged }: ClientRecordTabContext) {
  const data = useApi(() => api.get(isPrivileged ? `/admin/members/${memberId}/sessions` : `/coach/clients/${memberId}/sessions`), [memberId, isPrivileged]);
  const d = data.data as any;
  if (data.error) return <Alert kind="error">{data.error}</Alert>;
  if (!d) return <Skeleton rows={6} />;
  const regs = (d.registrations ?? []) as any[];
  const summaries = (d.summaries ?? []) as any[];
  const followUps = (d.followUps ?? []) as any[];
  return <div className="stack">
    <Card><CardHead eyebrow="Consultations" title="Summaries for the client" />
      {summaries.length ? <ul className="taskList">{summaries.map((s) => <li key={s.id}><div><b style={{ color: 'var(--bp-color-text-primary)' }}>{label(s.kind)} · {fmtDate(s.startAt)}</b><span className="small">{s.body}</span><span className="muted small">by {s.coachName}, sent {fmtDate(s.createdAt)}</span></div></li>)}</ul>
        : <Empty title="No summaries yet" body={isPrivileged ? 'The coach writes one after each completed consultation.' : 'Write one from Appointments after a consultation is completed.'} />}
    </Card>
    <Card><CardHead eyebrow="Follow-ups" title={isPrivileged ? 'Coaches’ follow-ups from consultations' : 'Your follow-ups from consultations'} />
      {followUps.length ? <Table label="Follow-ups" head={<><th>Follow-up</th><th>Status</th><th>Opened</th></>}>
        {followUps.map((t) => <tr key={t.id}><td>{t.title}{t.detail ? <div className="small">{t.detail}</div> : null}{t.resolution ? <div className="small muted">{t.resolution}</div> : null}</td><td><Pill status={t.status} /></td><td className="small">{fmtDate(t.createdAt)}</td></tr>)}
      </Table> : <Empty title="No follow-ups" />}
    </Card>
    <Card><CardHead eyebrow="Live sessions" title="Group classes, webinars and workshops" />
      {regs.length ? <Table label="Live sessions" head={<><th>When</th><th>Session</th><th>Host</th><th>Place</th><th>Session status</th></>}>
        {regs.map((r) => <tr key={r.sessionId}><td className="small">{fmtDate(r.startAt)}</td><td>{r.hostedByMe ? <Link to={`/sessions/${r.sessionId}`}>{r.title}</Link> : r.title}<div className="small">{r.kindLabel}</div></td><td className="small">{r.hostName}</td><td><RegistrationPill status={r.status} /></td><td><SessionStatusPill status={r.sessionStatus} /></td></tr>)}
      </Table> : <Empty title="No live sessions" body="Sessions the client registers for appear here." />}
    </Card>
  </div>;
}

export default SessionsTab;
