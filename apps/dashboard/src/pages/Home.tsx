import React from 'react';
import { Link, useNavigate } from '../lib/nav';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { actionLabel, fmtDateTime, fmtInr, label, plural, relative } from '../lib/format';
import { Alert, Bars, Card, CardHead, Empty, Pill, Readout, Skeleton, useApi } from '../ui';
import { HeroBand } from '../components/HeroBand';
import { CoachIdentity } from './coach/CoachProfile';
import { ModuleCards, useModuleCards } from '../modules/runtime';

export function Home() {
  const { isPrivileged } = useAuth();
  return isPrivileged ? <AdminOverview /> : <CoachHome />;
}

function CoachHome() {
  const home = useApi(() => api.get('/coach/home'), []);
  const nav = useNavigate();
  const moduleCards = useModuleCards('coachToday'); // cards the registered modules add (src/modules), while their flag is on
  const d = home.data as any;
  if (home.error) return <Alert kind="error">{home.error}</Alert>;
  if (!d) return <Skeleton rows={6} />;
  const Q = ({ n, text, to, hot }: { n: number; text: string; to: string; hot?: boolean }) => <Card dense className={`queue ${hot ? 'hot' : ''}`} ><div role="link" tabIndex={0} onClick={() => nav(to)} onKeyDown={(e) => { if (e.key === 'Enter') nav(to); }}><Readout eyebrow={text} value={n} /></div></Card>;
  return <div className="stack">
    <HeroBand eyebrow="Coach workspace" title={`Today, ${(d.coach?.displayName ?? '').split(' ')[0]}`} sub={`${plural(d.activeClients ?? 0, 'active client')} · ${plural(d.todaysAppointments.length, 'consultation')} today · ${plural(d.reportsToReview.length, 'report')} to review · ${plural(d.unreadConversations.length, 'unread thread')}`} />
    <CoachIdentity coach={d.coach} upcoming={d.metrics?.upcomingConsultations} unread={d.unreadConversations?.length} />
    <div className="grid">
      <div className="span3"><Q n={d.reportsToReview.length} text="Results to review" to="/bloodwork" hot={d.reportsToReview.length > 0} /></div>
      <div className="span3"><Q n={d.requestedAppointments.length} text="Consultation requests" to="/appointments" /></div>
      <div className="span3"><Q n={d.unreadConversations.length} text="Unread conversations" to="/messages" /></div>
      <div className="span3"><Q n={new Set([...d.draftPlans.map((p: any) => p.member_id), ...d.clientsWithoutPlan.map((c: any) => c.id)]).size} text="Plans to write or publish" to="/clients" /></div>
    </div>
    <div className="grid">
      <div className="span6"><Card><CardHead eyebrow="Today and next" title="Consultations" right={<Link className="bp-btn bp-btn-tertiary bp-btn-sm" to="/appointments">All</Link>} />
        {[...d.todaysAppointments, ...d.upcomingAppointments].length ? <div className="stack">{[...d.todaysAppointments, ...d.upcomingAppointments].slice(0, 6).map((a: any) => <div key={a.id} className="row between"><div><b style={{ color: 'var(--bp-color-text-primary)' }}>{a.member_name}</b><div className="small">{fmtDateTime(a.start_at)} · {label(a.kind)}</div></div><Pill status={a.status} /></div>)}</div> : <Empty title="No consultations scheduled" body="Book one from a client's page." />}
      </Card></div>
      <div className="span6"><Card><CardHead eyebrow="Needs you" title="Reports to review" right={<Link className="bp-btn bp-btn-tertiary bp-btn-sm" to="/bloodwork">Queue</Link>} />
        {d.reportsToReview.length ? <div className="stack">{d.reportsToReview.map((r: any) => <div key={r.id} className="row between"><div><Link to={`/reports/${r.id}`}><b>{r.member_name}</b></Link><div className="small">{r.test_name} · {r.reference} · delivered {relative(r.delivered_at)}</div>{r.flagged?.length ? <div className="pillRow" style={{ marginTop: 4 }}>{r.flagged.map((f: string) => <span key={f} className="bp-pill bp-pill-warning">{f}</span>)}</div> : null}</div><Link className="bp-btn bp-btn-primary bp-btn-sm" to={`/reports/${r.id}`}>Review</Link></div>)}</div> : <Empty title="Nothing to review" body="New laboratory reports appear here." />}
      </Card></div>
      <div className="span6"><Card><CardHead eyebrow="Clients" title="Follow-ups and plans" />
        <div className="stack">
          {d.clientsWithoutPlan.map((c: any) => <div key={c.id} className="row between"><span><b style={{ color: 'var(--bp-color-text-primary)' }}>{c.name}</b> <span className="small">has no published plan</span></span><Link className="bp-btn bp-btn-secondary bp-btn-sm" to={`/clients/${c.id}?tab=plan`}>Write a plan</Link></div>)}
          {d.draftPlans.map((p: any) => <div key={p.id} className="row between"><span><b style={{ color: 'var(--bp-color-text-primary)' }}>{p.member_name}</b> <span className="small">draft: {p.title}</span></span><Link className="bp-btn bp-btn-secondary bp-btn-sm" to={`/plans/${p.id}`}>Open draft</Link></div>)}
          {d.followUps.map((t: any) => <div key={t.id} className="row between"><span><b style={{ color: 'var(--bp-color-text-primary)' }}>{t.title}</b><div className="small">{t.detail}</div></span><Pill status={t.status} /></div>)}
          {!d.clientsWithoutPlan.length && !d.draftPlans.length && !d.followUps.length && <Empty title="All caught up" />}
        </div>
      </Card></div>
      <div className="span6"><Card><CardHead eyebrow="Recent" title="Activity" /><ul className="timeline">{d.recentActivity.slice(0, 8).map((a: any, i: number) => <li key={i} className="done"><b>{actionLabel(a.action)}</b>{a.reason ? ` · ${a.reason}` : ''}<time>{a.actor_name ?? 'system'} · {relative(a.at)}</time></li>)}</ul></Card></div>
      <ModuleCards cards={moduleCards} />
    </div>
    <p className="muted">{d.metrics.note}</p>
  </div>;
}

function AdminOverview() {
  const ov = useApi(() => api.get('/admin/overview'), []);
  const nav = useNavigate();
  const moduleCards = useModuleCards('adminOverview'); // cards the registered modules add (src/modules), while their flag is on
  const d = ov.data as any;
  if (ov.error) return <Alert kind="error">{ov.error}</Alert>;
  if (!d) return <Skeleton rows={6} />;
  const Q = ({ n, text, to, hot, unit }: { n: React.ReactNode; text: string; to: string; hot?: boolean; unit?: string }) => <Card dense className={`queue ${hot ? 'hot' : ''}`}><div role="link" tabIndex={0} onClick={() => nav(to)} onKeyDown={(e) => { if (e.key === 'Enter') nav(to); }}><Readout eyebrow={text} value={n} unit={unit} /></div></Card>;
  const weeks = d.ordersByWeek as Array<{ week: string; n: number; inr: number }>;
  return <div className="stack">
    <HeroBand eyebrow="Admin workspace" title="Overview" sub={`${d.members.active} active members · ${d.programmes.active} active programmes · ${d.coaches.utilisationPct}% coach utilisation · ${d.exceptions.open} open exceptions`} />
    <div className="grid">
      <div className="span3"><Q n={d.members.total} text="Members" to="/clients" /></div>
      <div className="span3"><Q n={d.orders.new30d} text="New orders · 30 days" to="/orders" /></div>
      <div className="span3"><Q n={fmtInr(d.revenue.verifiedInr30d)} text="Verified revenue · 30 days" to="/orders" /></div>
      <div className="span3"><Q n={d.assignments.unassigned} text="Unassigned members" to="/assignments" hot={d.assignments.unassigned > 0} /></div>
      <div className="span3"><Q n={d.coaches.utilisationPct} unit="%" text="Coach utilisation" to="/coaches" /></div>
      <div className="span3"><Q n={d.appointments.upcoming7d} text="Appointments · 7 days" to="/appointments" /></div>
      <div className="span3"><Q n={d.reportsAwaitingReview} text="Reports awaiting review" to="/bloodwork" hot={d.reportsAwaitingReview > 0} /></div>
      <div className="span3"><Q n={d.exceptions.open} text="Operational exceptions" to="/operations" hot={d.exceptions.open > 0} /></div>
    </div>
    <div className="grid">
      <div className="span8"><Card><CardHead eyebrow="12 weeks" title="Orders per week" /><Bars series={weeks.map((w) => w.n)} labels={weeks.map((w) => w.week.slice(5))} /><p className="muted">Bars: orders created. Verified revenue in the period: {fmtInr(weeks.reduce((s, w) => s + w.inr, 0))}.{d.demo && d.revenue.note ? ` ${d.revenue.note}` : ''}</p></Card></div>
      <div className="span4"><Card><CardHead eyebrow="Bloodwork" title="Bookings by status" /><dl className="kv">{Object.entries(d.bloodwork).map(([k, v]) => <React.Fragment key={k}><dt>{label(k)}</dt><dd className="num">{v as number}</dd></React.Fragment>)}{!Object.keys(d.bloodwork).length && <dd>No bookings</dd>}</dl></Card></div>
      <div className="span6"><Card><CardHead eyebrow="Capacity" title="Coaches" right={<Link className="bp-btn bp-btn-tertiary bp-btn-sm" to="/coaches">Manage</Link>} /><div className="stack">{d.coaches.byCoach.map((c: any) => <div key={c.coachId} className="row between"><span><b style={{ color: 'var(--bp-color-text-primary)' }}>{c.name}</b> <span className="small">{c.caseload}/{c.limit}</span></span><div style={{ flex: '1 1 120px', maxWidth: 200 }}><div className="bp-progress"><span style={{ width: `${Math.min(100, (100 * c.caseload) / Math.max(1, c.limit))}%` }} /></div></div><Pill status={c.available ? 'available' : 'paused'}>{c.available ? 'Available' : 'Away'}</Pill></div>)}</div></Card></div>
      <div className="span6"><Card><CardHead eyebrow="Exceptions" title="By kind" right={<Link className="bp-btn bp-btn-tertiary bp-btn-sm" to="/operations">Queue</Link>} /><dl className="kv">{Object.entries(d.exceptions.byKind).map(([k, v]) => <React.Fragment key={k}><dt>{label(k)}</dt><dd className="num">{v as number}</dd></React.Fragment>)}{!Object.keys(d.exceptions.byKind).length && <dd>None open</dd>}</dl></Card></div>
      <ModuleCards cards={moduleCards} />
    </div>
  </div>;
}
