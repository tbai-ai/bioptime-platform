/* The coach's clients list: status chips (All · Waiting · Active · Paused/Inactive over the current
   clients, read from the assignment, the account and the published plan, plus Ended (history) as an explicit choice),
   package and goal filters, sort, search by name or member ID, a two-column grid of client rows with a ⋮ menu (Open,
   Message, Schedule consultation, Open workouts) and pagination. Each row keeps what the old table showed (package with
   its status and dates, progress with pending and overdue tasks, next appointment, last check-in, bloodwork,
   engagement). An ended assignment is history only: its row has no link, no menu and none of the client's progress or
   health facts, because the API no longer opens that record to the coach. Only the members assigned to this coach
   arrive (GET /coach/clients), never their contact details; there is no export, so the list does not leave Bioptime. */
import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Link, useNavigate } from '../../../../lib/nav';
import { useAuth } from '../../../../lib/auth';
import { fmtDate, fmtDateTime, label, plural, relative } from '../../../../lib/format';
import { Alert, Card, Empty, Input, Select, Skeleton, useApi, useToast } from '../../../../ui';
import { useModuleTabs } from '../../../../modules/runtime';
import { ScheduleDialog } from '../../../ClientDetail';
import { CardGrid, Icon, PageHeader, SegmentChips } from '../ui';
import { ClientMenu, ClientStatusPill, chipCounts, initials, loadClients, statusOf, useOpenConversation, type ChipKey, type ClientItem } from './shared';

const CHIPS: Array<{ id: ChipKey; label: string }> = [{ id: 'all', label: 'All' }, { id: 'waiting', label: 'Waiting' }, { id: 'active', label: 'Active' }, { id: 'inactive', label: 'Paused/Inactive' }, { id: 'ended', label: 'Ended (history)' }];
/** The sorts GET /coach/clients offers (listQuery in apps/api http/routes/coach.ts). */
const SORTS: Array<[string, string]> = [['name', 'Name'], ['recent', 'Last check-in'], ['next', 'Next appointment'], ['ends', 'Programme end'], ['progress', 'Tasks done']];
const PER_PAGE = 20;
const NO_PACKAGE = '__none';

export function ClientsList() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const chip = (CHIPS.find((c) => c.id === params.get('status'))?.id ?? 'all') as ChipKey;
  const sort = SORTS.some(([k]) => k === params.get('sort')) ? params.get('sort')! : 'name';
  const pkg = params.get('package') ?? '';
  const goal = params.get('goal') ?? '';
  const page = Math.max(1, Math.floor(Number(params.get('page')) || 1));
  const [draft, setDraft] = useState(q);
  useEffect(() => { setDraft(q); }, [q]); // a search that arrives in the address (the top bar, a link) shows in the box
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };
  const history = chip === 'ended';
  // my current clients (active and paused assignments, the API's default); ended assignments load only when asked for
  const current = useApi(() => loadClients(q, sort), [q, sort]);
  const ended = useApi(() => (history ? loadClients(q, sort, true) : Promise.resolve(null)), [q, sort, history]);
  const list = history ? ended : current;
  const all = list.data?.items ?? [];

  const packages = useMemo(() => Array.from(new Set(all.map((m) => m.programme?.packageName).filter((n): n is string => !!n))).sort(), [all]);
  const goals = useMemo(() => Array.from(new Set(all.flatMap((m) => m.goals ?? []))).sort(), [all]);
  const keep = (m: ClientItem) => (!pkg || (pkg === NO_PACKAGE ? !m.programme : m.programme?.packageName === pkg)) && (!goal || (m.goals ?? []).includes(goal));
  const counts: Partial<Record<ChipKey, number>> = { ...chipCounts((current.data?.items ?? []).filter(keep)), ...(history && ended.data ? { ended: ended.data.items.filter(keep).length } : {}) };
  const shown = all.filter(keep).map((m) => ({ m, s: statusOf(m) })).filter((x) => (chip === 'all' ? x.s.chip !== 'ended' : x.s.chip === chip));
  const pages = Math.max(1, Math.ceil(shown.length / PER_PAGE));
  const at = Math.min(page, pages);
  const slice = shown.slice((at - 1) * PER_PAGE, at * PER_PAGE);

  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const openThread = useOpenConversation();
  const workoutsOn = useModuleTabs('coach').some((t) => t.id === 'workouts');
  const [schedule, setSchedule] = useState<ClientItem | null>(null);
  const filtersOn = !!(q || pkg || goal);

  return <div className="stack wzdPage">
    <PageHeader title="My clients" sub="Members assigned to you, and only them. Contact details stay with Bioptime; messages and consultations happen here."
      actions={<form className="wzdSearch" role="search" onSubmit={(e) => { e.preventDefault(); set({ q: draft.trim() || null }); }}>
        <Icon name="search" size={16} className="wzdSearchIcon" />
        <Input type="search" placeholder="Name or member ID" value={draft} onChange={(e) => { setDraft(e.target.value); if (!e.target.value && q) set({ q: null }); }} aria-label="Search clients by name or member ID" />
      </form>} />

    <div className="wzdToolbar">
      <SegmentChips label="Client status" items={CHIPS.map((c) => ({ ...c, count: current.data ? counts[c.id] : undefined }))} value={chip} onChange={(v) => set({ status: v === 'all' ? null : v })} />
      <div className="wzdToolbarRight">
        {(packages.length > 0 || all.some((m) => !m.programme)) && <label className="wzdInlineSelect"><Icon name="filter" size={16} /><span className="sr">Package</span>
          <Select value={pkg} onChange={(e) => set({ package: e.target.value || null })} aria-label="Filter by package"><option value="">All packages</option>{packages.map((p) => <option key={p} value={p}>{p}</option>)}{all.some((m) => !m.programme) && <option value={NO_PACKAGE}>No package</option>}</Select></label>}
        {goals.length > 0 && <label className="wzdInlineSelect"><Icon name="target" size={16} /><span className="sr">Goal</span>
          <Select value={goal} onChange={(e) => set({ goal: e.target.value || null })} aria-label="Filter by goal"><option value="">All goals</option>{goals.map((g) => <option key={g} value={g}>{g}</option>)}</Select></label>}
        <label className="wzdInlineSelect"><Icon name="sort" size={16} /><span className="sr">Sort</span>
          <Select value={sort} onChange={(e) => set({ sort: e.target.value === 'name' ? null : e.target.value })} aria-label="Sort clients">{SORTS.map(([k, l]) => <option key={k} value={k}>Sort: {l}</option>)}</Select></label>
      </div>
    </div>

    {list.error && <Alert kind="error">{list.error}</Alert>}
    {list.loading && !list.data ? <Card><Skeleton rows={5} /></Card>
      : slice.length ? <>
        <CardGrid columns={2} as="ul" className="wzdClientGrid" label="Clients">
          {slice.map(({ m, s }) => s.key === 'ended'
            // history only: the API no longer opens this record to me, so no link, no menu and none of the client's facts
            ? <li key={m.assignment?.id ?? m.id} className="bp-card wzdClientRow wzdClientEnded">
              <span className="avatar avatarSm wzdAvatar" aria-hidden="true">{initials(m.name)}</span>
              <div className="wzdClientMain">
                <div className="wzdClientTop"><span className="wzdClientName">{m.name}</span><ClientStatusPill status={s} /></div>
                <div className="wzdClientSub"><code>{m.memberCode ?? '—'}</code>{m.assignment?.since && <span>Assigned to you from {fmtDate(m.assignment.since)}</span>}</div>
                <p className="wzdFacts wzdEndedNote">The assignment has ended, so the client record is no longer open to you.</p>
              </div>
            </li>
            : <li key={m.assignment?.id ?? m.id} className="bp-card wzdClientRow">
            <span className="avatar avatarSm wzdAvatar" aria-hidden="true">{initials(m.name)}</span>
            <div className="wzdClientMain">
              <div className="wzdClientTop"><Link className="wzdClientName" to={`/clients/${m.id}`}>{m.name}</Link><ClientStatusPill status={s} /></div>
              <div className="wzdClientSub"><code>{m.memberCode ?? '—'}</code>
                <span>{m.programme ? <>{m.programme.packageName ?? 'Package'} · {label(m.programme.status).toLowerCase()} · {fmtDate(m.programme.startAt)} → {fmtDate(m.programme.endAt)}</> : 'No package'}</span>
                {m.age != null && <span>{m.age}{m.gender ? ` · ${label(m.gender)}` : ''}</span>}
                {m.city && <span>{m.city}</span>}</div>
              <ul className="wzdFacts" aria-label={`${m.name}: progress and next steps`}>
                <li>{m.progress.hasPlan ? <><span className="bp-progress wzdMiniBar" aria-hidden="true"><span style={{ width: `${m.progress.completionPct ?? 0}%` }} /></span>{m.progress.completionPct ?? 0}% of due · {m.progress.tasksPending} pending{m.progress.tasksOverdue ? ` · ${m.progress.tasksOverdue} overdue` : ''}</> : 'No plan yet'}</li>
                <li title="Next appointment">{m.nextAppointmentAt ? `Next ${fmtDateTime(m.nextAppointmentAt)}` : 'No appointment booked'}</li>
                <li>{m.lastCheckInAt ? `Checked in ${relative(m.lastCheckInAt)}` : 'No check-in yet'}</li>
                <li>{m.healthShared === false ? 'Health not shared' : m.bloodworkStatus ? `Bloodwork ${label(m.bloodworkStatus).toLowerCase()}${m.reportsToReview ? ` · ${m.reportsToReview} to review` : ''}` : 'No bloodwork yet'}</li>
                <li>{m.engagement === 'active' ? 'Active this week' : m.engagement === 'quiet' ? 'Quiet this week' : 'New'}{!m.onboardingCompleted ? ' · onboarding' : ''}</li>
              </ul>
            </div>
            <ClientMenu name={m.name} items={[
              { label: 'Open', onSelect: () => nav(`/clients/${m.id}`) },
              { label: 'Message', onSelect: () => void openThread(m.id) },
              ...(m.assignment?.status === 'active' ? [{ label: 'Schedule consultation', onSelect: () => setSchedule(m) }] : []),
              ...(workoutsOn ? [{ label: 'Open workouts', onSelect: () => nav(`/clients/${m.id}?tab=workouts`) }] : []),
            ]} />
          </li>)}
        </CardGrid>
        <nav className="wzdPagerRow" aria-label="Client pages">
          <span className="muted">{history ? plural(shown.length, 'ended assignment') : plural(shown.length, 'client')}{!history && (chip !== 'all' || filtersOn) ? ` of ${current.data?.total ?? all.length}` : ''} · page {at} of {pages}</span>
          {pages > 1 && <div className="bp-pager">
            <button type="button" disabled={at <= 1} onClick={() => set({ page: String(at - 1) })} aria-label="Previous page">‹</button>
            {Array.from({ length: pages }, (_, i) => i + 1).map((n) => <button key={n} type="button" aria-current={n === at ? 'page' : undefined} onClick={() => set({ page: n === 1 ? null : String(n) })}>{n}</button>)}
            <button type="button" disabled={at >= pages} onClick={() => set({ page: String(at + 1) })} aria-label="Next page">›</button>
          </div>}
        </nav>
      </>
      : list.data && <Card><Empty title={emptyTitle(chip, filtersOn, all.length)} body={history ? (filtersOn ? 'Try another name, member ID, package or goal.' : 'Assignments that end stay listed here as history.') : all.length ? (filtersOn ? 'Try another name, member ID, package or goal.' : 'Clients move here as their status changes.') : 'Members appear here once Bioptime assigns them to you.'}
          action={filtersOn ? <button type="button" className="bp-btn bp-btn-tertiary bp-btn-sm" onClick={() => { setDraft(''); set({ q: null, package: null, goal: null }); }}>Clear search and filters</button> : undefined} /></Card>}

    <p className="muted small">All lists your current clients. Waiting: no published plan yet, or still setting up their account. Paused/Inactive: the assignment is paused, or the account is not active. Ended (history): assignments that have ended; their records are no longer open to you. Progress is the share of due plan tasks marked done; engagement is whether the member logged, messaged or ticked a task in the last seven days. Neither is a health outcome.</p>
    {/* keyed by client, so a slot chosen for one client is never offered as chosen for the next */}
    <ScheduleDialog key={schedule?.id ?? 'none'} open={!!schedule} onClose={() => setSchedule(null)} memberId={schedule?.id ?? ''} coachId={user?.id ?? ''} onDone={() => { toast(`Consultation scheduled with ${schedule?.name ?? 'the client'}`); list.reload(); }} />
  </div>;
}

function emptyTitle(chip: ChipKey, filtersOn: boolean, total: number): string {
  if (chip === 'ended') return filtersOn ? 'No ended assignment matches' : 'No ended assignments';
  if (!total) return filtersOn ? 'No client matches' : 'No clients assigned yet';
  if (filtersOn && chip === 'all') return 'No client matches';
  return chip === 'waiting' ? 'No clients waiting' : chip === 'active' ? 'No active clients' : chip === 'inactive' ? 'No paused or inactive clients' : 'No client matches';
}
