/* Coach workspace: Sessions (/coach/workouts/sessions). The "Training sessions" grid, filled
   with what Bioptime truly has for it: the live sessions the coach hosts (group classes, webinars and workshops, the
   live sessions module, GET /coach/sessions). Bioptime has no session videos, so a card shows no thumbnail or player:
   the title, the kind, the host, the date and time (IST), who can join, the places and the status, and opens the
   session's own page (/coach/sessions/:id). "Add session" is the module's own create dialog (SessionForm); the full
   list with its table stays at /coach/sessions. */
import React, { useState } from 'react';
import { api, qs } from '../../../../lib/api';
import { fmtDate, fmtTime, label } from '../../../../lib/format';
import { Link, useNavigate } from '../../../../lib/nav';
import { Alert, Button, Empty, Select, Skeleton, Tabs, useApi, useToast } from '../../../../ui';
import { SessionForm } from '../../../../modules/sessions/SessionForm';
import { AUDIENCE_SHORT, KINDS, SessionStatusPill, placesText, safeLink } from '../../../../modules/sessions/shared';
import { CardGrid, Icon, PageHeader } from '../ui';
import { Badge, Cover, FeatureGate, Pager, PlansPage, Tag, pageOf } from './parts';

type Range = 'upcoming' | 'past' | 'all';
/** Soonest / latest go by the start time; newest by when the session was added. Upcoming opens on the next session
 *  first, Past and All on the most recent start first. */
type Sort = 'soonest' | 'latest' | 'newest';
const SORT_LABEL: Record<Sort, string> = { soonest: 'Soonest first', latest: 'Latest first', newest: 'Newest first (recently added)' };
const defaultSort = (r: Range): Sort => (r === 'upcoming' ? 'soonest' : 'latest');
const byStart = (a: any, b: any) => String(a.startAt).localeCompare(String(b.startAt));
const SORTS: Record<Sort, (a: any, b: any) => number> = {
  soonest: byStart,
  latest: (a, b) => byStart(b, a),
  newest: (a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')) || byStart(a, b),
};

export function SessionsPage() {
  return <FeatureGate feature="sessions"><Sessions /></FeatureGate>;
}

const weekdayIst = (iso: string) => new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(iso));

function Sessions() {
  const nav = useNavigate();
  const toast = useToast();
  const [range, setRange] = useState<Range>('upcoming');
  const [kind, setKind] = useState('');
  const [sort, setSort] = useState<Sort>(defaultSort('upcoming'));
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const list = useApi(() => api.get(`/coach/sessions${qs({ range })}`), [range]);
  const items = (((list.data as any)?.items ?? []) as any[]);
  const filtered = items.filter((s) => !kind || s.kind === kind).sort(SORTS[sort]);
  const { shown, pages, page: at } = pageOf(filtered, page, 9);
  const count = (k: string) => items.filter((s) => s.kind === k).length;
  return <PlansPage label="Sessions">
    <PageHeader title="Sessions" sub="The group classes, webinars and workshops you host. Members register; a full session has a waitlist." actions={<>
      <Link className="bp-btn bp-btn-secondary" to="/sessions"><Icon name="video" size={16} /> Live sessions list</Link>
      <Button variant="primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> Add session</Button>
    </>} />
    <p className="small muted" style={{ margin: 0 }}>No video provider is connected, so sessions carry no recording or meeting of their own: add the https link you will use, or members read that you will share how to join.</p>
    <Tabs label="When" value={range} onChange={(r) => { setRange(r); setSort(defaultSort(r)); setPage(1); }} items={[{ id: 'upcoming', label: 'Upcoming' }, { id: 'past', label: 'Past' }, { id: 'all', label: 'All' }]}>
      <div className="wzp-filters">
        <span className="wzp-count" aria-live="polite"><b>{filtered.length}</b> session{filtered.length === 1 ? '' : 's'}</span>
        <Select aria-label="Category" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }}><option value="">All categories</option>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}{list.data ? ` (${count(k)})` : ''}</option>)}</Select>
        <Select aria-label="Sort" value={sort} onChange={(e) => { setSort(e.target.value as Sort); setPage(1); }}>{(Object.keys(SORT_LABEL) as Sort[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}</Select>
      </div>
      {list.error && <Alert kind="error">{list.error}</Alert>}
      {list.loading && !list.data ? <Skeleton rows={5} /> : shown.length ? <>
        <CardGrid columns={3} label="Sessions">{shown.map((s) => <SessionCard key={s.id} s={s} />)}</CardGrid>
        <Pager page={at} pages={pages} onPage={setPage} label="Session pages" />
      </> : <Empty title={items.length ? 'No sessions in this category' : range === 'upcoming' ? 'Nothing scheduled' : 'Nothing here'} body={items.length ? 'Pick another category.' : range === 'upcoming' ? 'Add a session; it stays a draft until you publish it.' : undefined} action={!items.length && range === 'upcoming' ? <Button variant="primary" onClick={() => setCreating(true)}>Add session</Button> : undefined} />}
    </Tabs>
    <SessionForm mode="coach" open={creating} onClose={() => setCreating(false)} onSaved={(s) => { toast('Draft saved'); nav(`/sessions/${s.id}`); }} />
  </PlansPage>;
}

function SessionCard({ s }: { s: any }) {
  const audience = [AUDIENCE_SHORT[s.audience] ?? label(s.audience), ...((s.packages ?? []) as any[]).map((p) => p.name as string)];
  return <article className="wzp-card" aria-label={s.title}>
    <Cover icon="session" start={<Badge at="start" accent>{s.kindLabel ?? label(s.kind)}</Badge>} end={<span className="wzp-corner"><SessionStatusPill status={s.status} /></span>} />
    <h3><Link to={`/sessions/${s.id}`}>{s.title}</Link></h3>
    <p className="wzp-meta" style={{ margin: 0 }}>Host: <b>{s.hostName ?? 'You'}</b></p>
    <p className="wzp-meta" style={{ margin: 0 }}><Icon name="calendar" size={14} /> {weekdayIst(s.startAt)} {fmtDate(s.startAt)} · <Icon name="clock" size={14} /> {fmtTime(s.startAt)} to {fmtTime(s.endAt)} IST</p>
    <div className="wzp-tags">{audience.map((a) => <Tag key={a}>{a}</Tag>)}</div>
    <p className="small muted" style={{ margin: 0 }}>{placesText(s)}{safeLink(s.joinUrl) ? ' · join link added' : ''}</p>
    <div className="wzp-foot"><Link className="bp-btn bp-btn-secondary bp-btn-sm" to={`/sessions/${s.id}`}>Open</Link></div>
  </article>;
}
