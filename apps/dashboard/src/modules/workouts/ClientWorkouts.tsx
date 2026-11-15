/* M6 Workouts, member portal: this week's sessions from the coach's programme, the live programmes, and the history. */
import React, { useState } from 'react';
import { Link } from '../../lib/nav';
import { api, qs } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { Alert, Button, Card, CardHead, Empty, Readout, Skeleton, Table, Tabs, useApi, errorText, useToast } from '../../ui';
import { SessionPill, fmtDay, shiftDate, weekday } from './shared';

export function ClientWorkouts() {
  const [tab, setTab] = useState<'week' | 'history'>('week');
  return <div className="stack">
    <div className="pageHead"><div><h1>Workouts</h1><p className="sub">The sessions your coach planned for you. Log what you did; your coach sees your logs while you share health data with them.</p></div></div>
    <Tabs items={[{ id: 'week', label: 'This week' }, { id: 'history', label: 'History' }]} value={tab} onChange={setTab}>
      {tab === 'week' ? <Week /> : <History />}
    </Tabs>
  </div>;
}

function Week() {
  const [from, setFrom] = useState<string | null>(null);
  const week = useApi(() => api.get(`/me/workouts${qs({ from: from ?? undefined })}`), [from]);
  const d = week.data as any;
  if (week.error) return <Alert kind="error">{week.error}</Alert>;
  if (!d) return <Skeleton rows={6} />;
  const items = (d.items ?? []) as any[];
  const programs = (d.programs ?? []) as any[];
  const thisWeek = !from;
  return <div className="grid">
    <div className="span8"><div className="stack">
      <Card><CardHead eyebrow={`${fmtDay(d.from)} to ${fmtDay(d.to)}`} title={thisWeek ? 'This week' : 'Week'} right={<div className="row" style={{ gap: 6 }}><Button size="sm" variant="tertiary" onClick={() => setFrom(shiftDate(d.from, -7))}>← Earlier</Button>{!thisWeek && <Button size="sm" variant="tertiary" onClick={() => setFrom(null)}>This week</Button>}<Button size="sm" variant="tertiary" onClick={() => setFrom(shiftDate(d.from, 7))}>Later →</Button></div>} />
        {items.length ? <ul className="taskList">{items.map((s) => <li key={s.id}><div><Link to={`/workouts/${s.id}`}><b style={{ color: 'var(--bp-color-text-primary)' }}>{s.title}</b></Link><span className="muted">{weekday(s.scheduledDate)} {fmtDay(s.scheduledDate)} · {s.programTitle} · week {s.week}{s.feedbackCount ? ' · feedback from your coach' : ''}</span></div><div className="row" style={{ gap: 6 }}><SessionPill status={s.status} overdue={s.scheduledDate < d.today} /><Link className="bp-btn bp-btn-secondary bp-btn-sm" to={`/workouts/${s.id}`}>{s.status === 'scheduled' && s.programStatus === 'published' ? 'Start' : 'Open'}</Link></div></li>)}</ul>
          : <Empty title={programs.length ? 'No sessions this week' : 'No workout programme yet'} body={programs.length ? 'Rest weeks count too. Look ahead with Later.' : 'Your coach writes one after reading your goals; you are told here when it is ready.'} />}
      </Card>
    </div></div>
    <div className="span4"><div className="stack">
      {thisWeek && <Card><CardHead eyebrow="So far this week" title="Your sessions" /><div className="row" style={{ gap: 18 }}><Readout eyebrow="Due" value={d.summary.due} /><Readout eyebrow="Done" value={d.summary.done} /><Readout eyebrow="Still to come" value={d.summary.upcoming} /></div>
        {d.next && <p className="small" style={{ marginTop: 10 }}>Next: <Link to={`/workouts/${d.next.id}`}>{d.next.title}</Link> on {weekday(d.next.scheduledDate)} {fmtDay(d.next.scheduledDate)}</p>}</Card>}
      {programs.map((p) => <Card key={p.id}><CardHead eyebrow={`Version ${p.version} · by ${p.coachName}`} title={p.title} />{p.summary && <p className="small">{p.summary}</p>}<p className="muted small" style={{ marginTop: 6 }}>Started {fmtDay(p.startDate)} · updated {fmtDate(p.updatedAt)}</p></Card>)}
      <p className="muted small">Effort ratings and logs are what you record, never a measurement.</p>
    </div></div>
  </div>;
}

function History() {
  const [pages, setPages] = useState<any[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const first = useApi(() => api.get('/me/workouts/history'), []);
  const d = first.data as any;
  if (first.error) return <Alert kind="error">{first.error}</Alert>;
  if (!d) return <Skeleton rows={6} />;
  const items = [...(d.items ?? []), ...pages] as any[];
  const next = pages.length ? cursor : d.nextCursor;
  const more = async () => { setBusy(true); try { const r = await api.get(`/me/workouts/history${qs({ before: next })}`); setPages((p) => [...p, ...r.items]); setCursor(r.nextCursor); } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); } };
  return <div className="stack">
    <div className="row" style={{ gap: 18 }}><Readout eyebrow="Completed" value={d.totals.completed} /><Readout eyebrow="Partly done" value={d.totals.partial} /><Readout eyebrow="Skipped" value={d.totals.skipped} /></div>
    <Card>{items.length ? <Table label="Workout history" head={<><th>Date</th><th>Session</th><th>Status</th><th>Sets done</th><th>Effort</th><th>Coach</th></>}>
      {items.map((s) => <tr key={s.id}><td>{fmtDay(s.scheduledDate)}</td><td><Link to={`/workouts/${s.id}`}>{s.title}</Link><div className="small">{s.programTitle}</div></td><td><SessionPill status={s.status} /></td><td className="num">{s.status === 'skipped' ? '—' : `${s.setsDone ?? 0} of ${s.setsPrescribed ?? 0}`}</td><td className="num">{s.rpe ? `${s.rpe}/10` : '—'}</td><td>{s.feedbackCount ? 'Feedback' : '—'}</td></tr>)}
    </Table> : <Empty title="Nothing logged yet" body="Sessions you complete or skip appear here." />}
    {next && <div className="bp-card-foot"><Button size="sm" busy={busy} onClick={more}>Show earlier sessions</Button></div>}</Card>
  </div>;
}
