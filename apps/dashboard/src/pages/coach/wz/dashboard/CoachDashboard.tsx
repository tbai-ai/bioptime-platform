/* The coach dashboard, from GET /coach/home, plus GET /coach/clients for the client counts:
   1. the greeting (time of day in the coach's time zone, the date and the active clients) with the accent bar, and on
      the right the coach ID, availability and the small 3D brand mark (the additive motion layer; flat under reduced
      motion);
   2. five KPI tiles: active clients, plans to write or publish, upcoming consultations, reports to review, unread
      conversations. Every number is a count the payloads carry. "Active clients" (and the greeting) count with the
      clients list's own rule (shared.tsx clientStatus), so the tile equals the Active chip it opens; upcoming counts
      scheduled consultations only (requests are counted apart), and as the API lists at most ten upcoming ones a full
      list reads "N+";
   3. the Overview card: segmented tabs over Follow-ups, Plans to write or publish, Reports to review, Upcoming
      consultations and Unread conversations, each a table with a name filter and an empty state;
   4. Appointments (upcoming and requests, the next ones, a link to the appointments overview) beside Recent activity
      (Bioptime sends coaches no product news, so there is no "What's new" card), then the cards the modules add.
   No promotional banner. Follow-ups can be marked done here, saying how (PATCH /coach/follow-ups/:id). */
import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Link } from '../../../../lib/nav';
import { api } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth';
import { actionLabel, fmtDate, fmtDateTime, label, plural, relative } from '../../../../lib/format';
import { Alert, Card, Empty, Input, Pill, ReasonDialog, Skeleton, Table, useApi, useToast } from '../../../../ui';
import { ModuleCards, useModuleCards } from '../../../../modules/runtime';
import { BrandMark3D } from '../../../../components/BrandMark3D';
import { AccentCard, CardGrid, Icon, KpiTile, PageHeader, SegmentChips, StatusPill } from '../ui';
import { chipCounts, loadClients } from '../clients/shared';
import './dash.css';

type OverviewTab = 'followups' | 'plans' | 'reports' | 'consultations' | 'unread';
const OVERVIEW_TABS: OverviewTab[] = ['followups', 'plans', 'reports', 'consultations', 'unread'];
const PANEL_ID = 'wzd-overview-panel';
/** GET /coach/home lists at most ten upcoming appointments after today (domain/coaches.ts coachHome). */
const UPCOMING_CAP = 10;

function greeting(tz: string): string {
  let h = new Date().getHours();
  try { h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(new Date())); } catch { /* unknown zone: the browser's hour */ }
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
function today(tz: string): string {
  try { return new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz }).format(new Date()); }
  catch { return new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date()); }
}
const matches = (text: unknown, f: string) => !f || String(text ?? '').toLowerCase().includes(f.toLowerCase());

export function CoachDashboard() {
  const { user } = useAuth();
  const home = useApi(() => api.get('/coach/home'), []);
  // the counts of the clients list's chips (same rows, same rule), so "Active clients" is the Active chip's number
  const roster = useApi(() => loadClients('', 'name'), []);
  const counts = roster.data ? chipCounts(roster.data.items) : null;
  const moduleCards = useModuleCards('coachToday'); // cards the registered modules add (src/modules), while their flag is on
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState('');
  const [resolve, setResolve] = useState<any>(null);
  const toast = useToast();
  const d = home.data as any;
  const tz = d?.coach?.timezone || 'Asia/Kolkata';
  const first = String(d?.coach?.displayName || user?.name || '').split(' ')[0];

  const clientsById = useMemo(() => new Map<string, string>(((d?.clients ?? []) as any[]).map((c) => [c.id, c.name])), [d]);
  const planRows = useMemo(() => !d ? [] : [
    ...(d.clientsWithoutPlan as any[]).map((c) => ({ key: `none-${c.id}`, memberId: c.id, name: c.name, what: 'No plan yet', at: null as string | null, to: `/clients/${c.id}?tab=plan`, cta: 'Write a plan' })),
    ...(d.draftPlans as any[]).map((p) => ({ key: p.id, memberId: p.member_id, name: p.member_name, what: `Draft: ${p.title}`, at: p.updated_at as string, to: `/plans/${p.id}`, cta: 'Open draft' })),
  ], [d]);
  const consultations = useMemo(() => !d ? [] : [...d.todaysAppointments, ...d.upcomingAppointments] as any[], [d]);

  if (home.error) return <div className="stack wzdPage"><Alert kind="error">{home.error}</Alert></div>;

  const planCount = d ? new Set(planRows.map((r) => r.memberId)).size : 0;
  const upcomingN = d ? consultations.length : 0;
  const capped = d ? d.upcomingAppointments.length >= UPCOMING_CAP : false;
  // confirmed consultations only; requests waiting for the coach are counted apart (requestedAppointments)
  const scheduledN = consultations.filter((a) => a.status === 'scheduled').length;
  const scheduledToday = d ? (d.todaysAppointments as any[]).filter((a) => a.status === 'scheduled').length : 0;
  const requestsN = d ? (d.requestedAppointments ?? []).length : 0;
  const requestsLabel = requestsN >= UPCOMING_CAP ? `${requestsN}+` : String(requestsN);
  const items: Array<{ id: OverviewTab; label: string; count?: number }> = [
    { id: 'followups', label: 'Follow-ups', count: d?.followUps.length },
    { id: 'plans', label: 'Plans to write or publish', count: planCount },
    { id: 'reports', label: 'Reports to review', count: d?.reportsToReview.length },
    { id: 'consultations', label: 'Upcoming consultations', count: upcomingN },
    { id: 'unread', label: 'Unread conversations', count: d?.unreadConversations.length },
  ];
  // the tab named in ?overview=, else the first list with something in it, else Follow-ups
  const tab = (OVERVIEW_TABS.find((t) => t === params.get('overview')) ?? items.find((i) => (i.count ?? 0) > 0)?.id ?? 'followups') as OverviewTab;
  const chooseTab = (t: OverviewTab) => { setFilter(''); const next = new URLSearchParams(params); next.set('overview', t); setParams(next, { replace: true }); };
  const who = (memberId?: string | null, name?: string | null) => memberId && clientsById.has(memberId) ? <Link to={`/clients/${memberId}`}>{name ?? clientsById.get(memberId)}</Link> : <span>{name ?? '—'}</span>;

  return <div className="stack wzdPage wzdDash">
    <PageHeader accent title={`${greeting(tz)}${first ? `, ${first}` : ''}`}
      sub={<>{today(tz)}{counts ? <> · {plural(counts.active, 'client')} active</> : null}</>}
      actions={<div className="wzdGreetSide">
        {d?.coach && <div className="wzdGreetMeta">
          {d.coach.coachCode && <span className="muted">Coach ID <code>{d.coach.coachCode}</code></span>}
          {/* the API keeps the chosen last day as <date>T23:59:59Z, so the date part is the day the coach picked */}
          <StatusPill tone={d.coach.available ? 'success' : 'warning'}>{d.coach.available ? 'Available' : d.coach.unavailableUntil ? `Away until ${fmtDate(String(d.coach.unavailableUntil).slice(0, 10))}` : 'Away'}</StatusPill>
        </div>}
        {/* the additive 3D layer: the Bioptime mark, calm (no pointer-following light), flat under reduced motion */}
        <BrandMark3D className="wzdGreetMark" interactive={false} />
      </div>} />

    <CardGrid columns={5} phone={2} className="wzdKpis" label="Today in numbers">
      <KpiTile label="Active clients" value={counts?.active} icon="clients" tone="success" to="/clients?status=active" loading={!counts && !roster.error} sub={counts ? `${counts.waiting} waiting · ${counts.inactive} paused or inactive` : undefined} />
      <KpiTile label="Plans to write or publish" value={d ? planCount : null} icon="plans" tone="warning" to="?overview=plans" loading={!d} sub={d ? `${d.clientsWithoutPlan.length} without a plan · ${d.draftPlans.length} draft${d.draftPlans.length === 1 ? '' : 's'}` : undefined} />
      <KpiTile label="Upcoming consultations" value={d ? (capped ? `${scheduledN}+` : scheduledN) : null} icon="calendar" tone="info" to="/appointments" loading={!d} sub={d ? `${scheduledToday} today · ${requestsLabel} request${requestsN === 1 ? '' : 's'} to confirm` : undefined} />
      <KpiTile label="Reports to review" value={d?.reportsToReview.length} icon="report" tone="accent" to="/bloodwork" loading={!d} sub={d ? `${d.metrics?.reviewsDone30d ?? 0} reviewed in 30 days` : undefined} />
      <KpiTile label="Unread conversations" value={d?.unreadConversations.length} icon="messages" tone="neutral" to="/messages" loading={!d} />
    </CardGrid>

    <AccentCard className="wzdOverview" title="Overview" eyebrow="Needs you" loading={!d}
      right={<label className="wzdFilter"><Icon name="search" size={16} /><Input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name" aria-label="Filter this list by name" /></label>}>
      {d && <>
        <SegmentChips tabs panelId={PANEL_ID} label="Overview lists" items={items} value={tab} onChange={chooseTab} />
        <div id={PANEL_ID} role="tabpanel" aria-label={items.find((i) => i.id === tab)?.label} className="wzdOverviewPanel">
          {tab === 'followups' && <OverviewTable eyebrow="Follow-ups" rows={(d.followUps as any[]).filter((t) => matches(`${t.title} ${t.detail ?? ''} ${t.ref_type === 'user' ? clientsById.get(t.ref_id) ?? '' : ''}`, filter))}
            empty={<Empty title={filter ? 'Nothing matches' : 'No open follow-ups'} body={filter ? undefined : 'Add one from a client’s profile (Add a follow-up) or after a consultation.'} action={filter ? undefined : <Link className="bp-btn bp-btn-tertiary bp-btn-sm" to="/clients">Open clients →</Link>} />}
            head={<><th>Follow-up</th><th>About</th><th>Opened</th><th>Status</th><th><span className="sr">Action</span></th></>}
            row={(t) => <tr key={t.id}><td><b className="wzdStrong">{t.title}</b>{t.detail ? <div className="small">{t.detail}</div> : null}</td>
              <td>{t.ref_type === 'user' ? who(t.ref_id, clientsById.get(t.ref_id)) : t.ref_type === 'appointment' ? <Link to="/appointments">A consultation</Link> : <span className="muted">—</span>}</td>
              <td className="small">{relative(t.created_at)}</td><td><Pill status={t.status} /></td>
              <td className="wzdCellAction"><button type="button" className="bp-btn bp-btn-secondary bp-btn-sm" onClick={() => setResolve(t)}>Mark done</button></td></tr>} />}

          {tab === 'plans' && <OverviewTable eyebrow="Plans" rows={planRows.filter((r) => matches(`${r.name} ${r.what}`, filter))}
            empty={<Empty title={filter ? 'Nothing matches' : 'Every client has a published plan'} body={filter ? undefined : 'Clients without a plan and plans still in draft appear here.'} />}
            head={<><th>Client</th><th>What is needed</th><th>Updated</th><th><span className="sr">Action</span></th></>}
            row={(r) => <tr key={r.key}><td>{who(r.memberId, r.name)}</td><td>{r.what}</td><td className="small">{r.at ? relative(r.at) : '—'}</td><td className="wzdCellAction"><Link className="bp-btn bp-btn-secondary bp-btn-sm" to={r.to}>{r.cta}</Link></td></tr>} />}

          {tab === 'reports' && <OverviewTable eyebrow="Bloodwork" rows={(d.reportsToReview as any[]).filter((r) => matches(`${r.member_name} ${r.test_name} ${r.reference}`, filter))}
            empty={<Empty title={filter ? 'Nothing matches' : 'Nothing to review'} body={filter ? undefined : 'New laboratory reports of clients who share health information appear here.'} action={filter ? undefined : <Link className="bp-btn bp-btn-tertiary bp-btn-sm" to="/bloodwork">Open reports →</Link>} />}
            head={<><th>Client</th><th>Test</th><th>Delivered</th><th>Flags</th><th><span className="sr">Action</span></th></>}
            row={(r) => <tr key={r.id}><td>{who(r.member_id, r.member_name)}</td><td>{r.test_name}<div className="muted">{r.reference}</div></td><td className="small">{relative(r.delivered_at)}</td>
              <td>{r.flagged?.length ? <div className="pillRow">{r.flagged.map((f: string) => <span key={f} className="bp-pill bp-pill-warning">{f}</span>)}</div> : <span className="muted">None</span>}</td>
              <td className="wzdCellAction"><Link className="bp-btn bp-btn-primary bp-btn-sm" to={`/reports/${r.id}`}>Review</Link></td></tr>} />}

          {tab === 'consultations' && <OverviewTable eyebrow="Consultations" rows={consultations.filter((a) => matches(`${a.member_name} ${a.kind}`, filter))}
            empty={<Empty title={filter ? 'Nothing matches' : 'No consultations scheduled'} body={filter ? undefined : 'Book one from a client’s profile.'} action={filter ? undefined : <Link className="bp-btn bp-btn-tertiary bp-btn-sm" to="/appointments">Appointments →</Link>} />}
            head={<><th>Client</th><th>When</th><th>Kind</th><th>Status</th><th><span className="sr">Action</span></th></>}
            row={(a) => <tr key={a.id}><td>{who(a.member_id, a.member_name)}</td><td className="small">{fmtDateTime(a.start_at)}</td><td>{label(a.kind)}</td><td><Pill status={a.status} /></td>
              <td className="wzdCellAction"><Link className="bp-btn bp-btn-tertiary bp-btn-sm" to={clientsById.has(a.member_id) ? `/clients/${a.member_id}?tab=appointments` : '/appointments'}>Open</Link></td></tr>}
            foot={d.upcomingAppointments.length >= UPCOMING_CAP ? <p className="muted">Showing today and the next {UPCOMING_CAP}; the appointments overview has them all.</p> : undefined} />}

          {tab === 'unread' && <OverviewTable eyebrow="Messages" rows={(d.unreadConversations as any[]).filter((c) => matches(c.member_name, filter))}
            empty={<Empty title={filter ? 'Nothing matches' : 'No unread messages'} body={filter ? undefined : 'Conversations with new messages from your clients appear here.'} action={filter ? undefined : <Link className="bp-btn bp-btn-tertiary bp-btn-sm" to="/messages">Messages →</Link>} />}
            head={<><th>Client</th><th className="num">Unread</th><th>Last message</th><th><span className="sr">Action</span></th></>}
            row={(c) => <tr key={c.conversation_id}><td>{who(c.member_id, c.member_name)}</td><td className="num">{c.unread}</td><td className="small">{relative(c.last_at)}</td>
              <td className="wzdCellAction"><Link className="bp-btn bp-btn-primary bp-btn-sm" to={`/messages/${c.conversation_id}`}>Reply</Link></td></tr>} />}
        </div>
      </>}
    </AccentCard>

    {d ? <div className="wzdSideBySide">
      <AppointmentsCard d={d} who={who} />
      <Card className="wzdActivity"><div className="bp-card-head"><div><span className="bp-eyebrow">Recent</span><h3>Recent activity</h3></div></div>
        {(d.recentActivity as any[]).length ? <ul className="timeline">{(d.recentActivity as any[]).slice(0, 8).map((a, i) => {
          const to = a.target_type === 'user' && clientsById.has(a.target_id) ? `/clients/${a.target_id}` : a.target_type === 'coaching_plan' ? `/plans/${a.target_id}` : a.target_type === 'report' ? `/reports/${a.target_id}` : a.target_type === 'appointment' ? '/appointments' : null;
          return <li key={i} className="done">{to ? <Link to={to}><b>{actionLabel(a.action)}</b></Link> : <b>{actionLabel(a.action)}</b>}{a.reason ? ` · ${a.reason}` : ''}<time>{a.actor_name ?? 'system'} · {relative(a.at)}</time></li>;
        })}</ul> : <Empty title="No recent activity" body="Notes, plans, consultations and reviews about your clients appear here." />}
      </Card>
    </div> : <Card><Skeleton rows={4} /></Card>}

    {moduleCards.length > 0 && <div className="grid"><ModuleCards cards={moduleCards} /></div>}
    {d?.metrics?.note && <p className="muted">{d.metrics.note}</p>}

    {/* the API keeps how a follow-up was resolved (RESOLUTION_REQUIRED), so the dialog asks for it */}
    <ReasonDialog open={!!resolve} onClose={() => setResolve(null)} title="Mark this follow-up done?" body={resolve?.title} confirmLabel="Mark done"
      onConfirm={async (reason) => { await api.patch(`/coach/follow-ups/${resolve.id}`, { status: 'resolved', resolution: reason.slice(0, 500) }); toast('Follow-up marked done'); home.reload(); }} />
  </div>;
}

function OverviewTable<T>({ eyebrow, rows, head, row, empty, foot }: { eyebrow: string; rows: T[]; head: React.ReactNode; row: (r: T) => React.ReactNode; empty: React.ReactNode; foot?: React.ReactNode }) {
  return <div className="wzdTableCard">
    <span className="bp-eyebrow wzdSection">{eyebrow}</span>
    {rows.length ? <Table head={head} label={eyebrow}>{rows.map(row)}</Table> : empty}
    {foot}
  </div>;
}

function AppointmentsCard({ d, who }: { d: any; who: (id?: string | null, name?: string | null) => React.ReactNode }) {
  const scheduled = [...d.todaysAppointments, ...d.upcomingAppointments].filter((a: any) => a.status === 'scheduled');
  const next = scheduled.slice(0, 4);
  const requests = (d.requestedAppointments ?? []) as any[];
  // Upcoming counts confirmed consultations only: a request shows under Requests, never under both
  const upcoming = scheduled.length;
  return <Card className="wzdAppts">
    <div className="bp-card-head"><div><span className="bp-eyebrow">Consultations</span><h3>Appointments</h3></div><Link className="bp-btn bp-btn-tertiary bp-btn-sm" to="/appointments">Overview →</Link></div>
    <div className="wzdMiniTiles">
      <Link className="bp-tile wzdMiniTile" to="/appointments"><span className="bp-eyebrow">Upcoming</span><b className="num">{d.upcomingAppointments.length >= UPCOMING_CAP ? `${upcoming}+` : upcoming}</b></Link>
      <Link className="bp-tile wzdMiniTile" to="/appointments"><span className="bp-eyebrow">Requests</span><b className="num">{requests.length >= UPCOMING_CAP ? `${requests.length}+` : requests.length}</b></Link>
    </div>
    {requests.length > 0 && <><span className="bp-eyebrow wzdSection">Requests to confirm</span>
      <ul className="wzdApptList">{requests.slice(0, 3).map((a) => <li key={a.id}><div>{who(a.member_id, a.member_name)}<div className="small">{fmtDateTime(a.start_at)} · {label(a.kind)}</div></div><Link className="bp-btn bp-btn-secondary bp-btn-sm" to="/appointments">Review</Link></li>)}</ul></>}
    <span className="bp-eyebrow wzdSection">Next appointments</span>
    {next.length ? <ul className="wzdApptList">{next.map((a: any) => <li key={a.id}><div>{who(a.member_id, a.member_name)}<div className="small">{fmtDateTime(a.start_at)} · {label(a.kind)}</div></div><Pill status={a.status} /></li>)}</ul>
      : <Empty title="No consultations scheduled" body="Book one from a client’s profile." action={<Link className="bp-btn bp-btn-tertiary bp-btn-sm" to="/clients">Open clients →</Link>} />}
  </Card>;
}
