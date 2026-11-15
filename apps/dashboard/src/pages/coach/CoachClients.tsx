/* The coach's clients: one row per assigned member with what coaching needs (package, status, dates, progress, next
   appointment, pending tasks, last check-in, bloodwork, engagement), search by name or member code, status filter,
   sort, pagination and honest empty states. Contact details never arrive from the server. */
import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Link, useNavigate } from '../../lib/nav';
import { api, qs } from '../../lib/api';
import { fmtDate, fmtDateTime, relative } from '../../lib/format';
import { Alert, Button, Card, Empty, Input, Pill, Select, Skeleton, Table, useApi } from '../../ui';

export function CoachClients() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('name');
  const [page, setPage] = useState(1);
  const nav = useNavigate();
  const list = useApi(() => api.get(`/coach/clients${qs({ q, status, sort, page, limit: 25 })}`), [q, status, sort, page]);
  const d = list.data as any;
  const items = (d?.items ?? []) as any[];
  const pages = d ? Math.max(1, Math.ceil(d.total / d.limit)) : 1;
  return <div className="stack">
    <div className="pageHead"><div><h1>My clients</h1><p className="sub">Members assigned to you, and only them. Contact details stay with Bioptime; messages and consultations happen here.</p></div>
      <div className="actions"><Input type="search" placeholder="Name or member ID" defaultValue={q} onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); setParams({ q: (e.target as HTMLInputElement).value }); } }} aria-label="Search clients" />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Assignment status"><option value="">Active and paused</option><option value="active">Active</option><option value="paused">Paused</option><option value="ended">Ended (history)</option><option value="all">All</option></Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort"><option value="name">Name</option><option value="recent">Last check-in</option><option value="next">Next appointment</option><option value="ends">Programme end</option><option value="progress">Tasks done</option></Select></div></div>
    {list.error && <Alert kind="error">{list.error}</Alert>}
    {list.loading && !d ? <Skeleton rows={5} /> : items.length ? <Card dense><div className="tableWrap"><Table head={<><th>Client</th><th>Package</th><th>Progress</th><th>Next</th><th>Last check-in</th><th>Bloodwork</th><th>Engagement</th></>}>
      {items.map((m) => <tr key={m.id} className="link" onClick={() => nav(`/clients/${m.id}`)}>
        <td><div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><span className="avatar avatarSm" aria-hidden="true">{String(m.name).split(/\s+/).slice(0, 2).map((p: string) => p[0]).join('').toUpperCase()}</span><div><Link to={`/clients/${m.id}`} onClick={(e) => e.stopPropagation()}>{m.name}</Link><div className="muted small"><code>{m.memberCode ?? '—'}</code>{m.age ? ` · ${m.age}` : ''}{m.city ? ` · ${m.city}` : ''}</div></div></div></td>
        <td>{m.programme ? <>{m.programme.packageName}<div className="muted small"><Pill status={m.programme.status} /> {fmtDate(m.programme.startAt)} → {fmtDate(m.programme.endAt)}</div></> : <span className="muted">No package</span>}{m.assignment?.status !== 'active' && <div><Pill status={m.assignment?.status} /></div>}</td>
        <td>{m.progress.hasPlan ? <><div className="bp-progress" style={{ width: 90 }}><span style={{ width: `${m.progress.completionPct ?? 0}%` }} /></div><div className="muted small">{m.progress.completionPct ?? 0}% of due · {m.progress.tasksPending} pending{m.progress.tasksOverdue ? ` · ${m.progress.tasksOverdue} overdue` : ''}</div></> : <span className="muted small">No plan yet</span>}</td>
        <td className="small">{m.nextAppointmentAt ? fmtDateTime(m.nextAppointmentAt) : <span className="muted">None booked</span>}</td>
        <td className="small">{m.lastCheckInAt ? relative(m.lastCheckInAt) : <span className="muted">Never</span>}</td>
        <td>{m.bloodworkStatus ? <Pill status={m.bloodworkStatus} /> : <span className="muted small">{m.healthShared === false ? 'not shared' : '—'}</span>}{m.reportsToReview ? <div className="small">{m.reportsToReview} to review</div> : null}</td>
        <td><Pill status={m.engagement === 'active' ? 'active' : m.engagement === 'quiet' ? 'pending' : 'draft'}>{m.engagement === 'active' ? 'Active this week' : m.engagement === 'quiet' ? 'Quiet' : 'New'}</Pill>{!m.onboardingCompleted && <div className="muted small">onboarding</div>}</td>
      </tr>)}
    </Table></div>
      <div className="row between" style={{ marginTop: 10 }}><span className="muted small">{d.total} client{d.total === 1 ? '' : 's'} · page {d.page} of {pages}</span><div className="row"><Button size="sm" variant="tertiary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" variant="tertiary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button></div></div></Card>
      : <Card><Empty title={q ? 'No client matches' : status === 'ended' ? 'No ended assignments' : 'No clients assigned yet'} body={q ? 'Try another name or member ID.' : 'Members appear here once Bioptime assigns them to you.'} /></Card>}
    <p className="muted small">Progress is the share of due plan tasks marked done; engagement is whether the member logged, messaged or ticked a task in the last seven days. Neither is a health outcome.</p>
  </div>;
}
