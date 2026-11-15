/* M8 Live sessions: the cards on the member Home, the coach Today page and the admin Overview. */
import React from 'react';
import { Link } from '../../lib/nav';
import { api } from '../../lib/api';
import { fmtDate, label } from '../../lib/format';
import { Alert, Card, CardHead, Empty, Skeleton, useApi } from '../../ui';
import { RegistrationPill, fmtSpan, placesText } from './shared';

/** Member Home: the next session they joined, or how many are open to them. */
export function ClientSessionsCard() {
  const data = useApi(() => api.get('/me/sessions'), []);
  const items = (((data.data as any)?.items ?? []) as any[]);
  const next = items.find((s) => s.myRegistration);
  const open = items.filter((s) => !s.myRegistration && !s.started).length;
  return <Card><CardHead eyebrow="Live sessions" title={next ? 'Your next session' : 'Group classes and webinars'} right={<Link className="bp-btn bp-btn-secondary bp-btn-sm" to="/sessions">Open</Link>} />
    {data.error ? <Alert kind="error">{data.error}</Alert> : !data.data ? <Skeleton rows={2} /> : next ? <div className="stack">
      <div className="row between"><b style={{ color: 'var(--bp-color-text-primary)' }}>{next.title}</b><RegistrationPill status={next.myRegistration.status} position={next.myRegistration.waitlistPosition} /></div>
      <span className="small">{fmtSpan(next.startAt, next.endAt)} · {next.hostName}</span>
      {open > 0 && <span className="small muted">{open} more open to you.</span>}
    </div> : <p className="small">{open ? `${open} session${open === 1 ? '' : 's'} open to you. Register while places are free.` : 'Nothing open right now. New sessions appear here when they are published.'}</p>}
  </Card>;
}

/** Coach Today: completed consultations still waiting for their summary. */
export function CoachFollowThroughCard() {
  const data = useApi(() => api.get('/coach/consultation-follow-through'), []);
  const items = (((data.data as any)?.items ?? []) as any[]);
  const waiting = items.filter((a) => !a.hasSummary);
  const open = items.reduce((n, a) => n + (a.openFollowUps ?? 0), 0);
  return <Card><CardHead eyebrow="Consultations" title="Summaries to write" right={<Link className="bp-btn bp-btn-secondary bp-btn-sm" to="/appointments">Appointments</Link>} />
    {data.error ? <Alert kind="error">{data.error}</Alert> : !data.data ? <Skeleton rows={2} /> : waiting.length ? <ul className="timeline">{waiting.slice(0, 5).map((a) => <li key={a.appointmentId}><b>{a.memberName}</b> · {label(a.kind)} on {fmtDate(a.startAt)}</li>)}</ul> : <Empty title="All written" body="Completed consultations in the last 90 days all have their summary." />}
    {data.data && open > 0 && <p className="small muted" style={{ marginTop: 8 }}>{open} follow-up{open === 1 ? '' : 's'} from consultations still open.</p>}
  </Card>;
}

/** Admin Overview (sessions.manage): what is coming up. */
export function AdminSessionsCard() {
  const data = useApi(() => api.get('/admin/sessions?range=upcoming&status=published'), []);
  const items = (((data.data as any)?.items ?? []) as any[]);
  return <Card><CardHead eyebrow="Live sessions" title="Coming up" right={<Link className="bp-btn bp-btn-secondary bp-btn-sm" to="/sessions">Open</Link>} />
    {data.error ? <Alert kind="error">{data.error}</Alert> : !data.data ? <Skeleton rows={2} /> : items.length ? <ul className="timeline">{items.slice(0, 4).map((s) => <li key={s.id}><b>{s.title}</b> · {fmtSpan(s.startAt, s.endAt)}<div className="small muted">{s.hostName} · {placesText(s)}</div></li>)}</ul> : <Empty title="Nothing published" />}
  </Card>;
}
