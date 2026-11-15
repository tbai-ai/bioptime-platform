/* Coach workspace: Workouts (/coach/workouts). The workout plans as a grid of cards,
   filled with what Bioptime's workouts module holds (see workoutPlans.ts):
   - text tabs All plans · Daily (templates: one session each) · Weekly and Monthly (the coach's client programmes,
     under four weeks and from four weeks on), with counts;
   - filters: source (my templates, the Bioptime team's, or my clients' programmes), exercise category, level, and a
     search over the name (and a programme's client);
   - each card: source and frequency badges, the name, tag chips, what it includes and "+ Assign client", which creates
     the chosen client's programme from it (AssignWorkoutDialog); pagination under the grid.
   The header opens the categories, the exercise library and the template editor for a new template. Everything the
   page shows comes from two coach lists (GET /coach/workout-templates, whose items carry their exercises' categories;
   GET /coach/workout-programs): team templates are the published ones, then the coach's own, then the programmes of
   the coach's assigned clients. */
import React, { useMemo, useState } from 'react';
import { api } from '../../../../lib/api';
import { fmtDate, label } from '../../../../lib/format';
import { Link, useNavigate } from '../../../../lib/nav';
import { Alert, Button, Dialog, Empty, Input, Select, Skeleton, Tabs, useApi } from '../../../../ui';
import { CATEGORIES, LEVELS } from '../../../../modules/workouts/shared';
import { CardGrid, Icon, PageHeader, StatusPill } from '../ui';
import { AssignWorkoutDialog } from './AssignWorkoutDialog';
import { Badge, Cover, FeatureGate, Pager, PlansPage, Tag, pageOf } from './parts';
import { FREQUENCY_LABEL, programmePlan, templatePlan, type Frequency, type WorkoutPlan } from './workoutPlans';

type TabId = 'all' | Frequency;
type Source = '' | 'mine' | 'team' | 'programmes';
const TAB_HINT: Record<TabId, string> = {
  all: 'Templates and your clients’ programmes. Assign any of them to a client.',
  daily: 'Templates: one session each, with exercises in order. Assigning one puts it on the days you choose, every week.',
  weekly: 'Your clients’ programmes of one to three weeks. Assigning one copies its weeks to another client.',
  monthly: 'Your clients’ programmes of four weeks or more. Assigning one copies its weeks to another client.',
};

export function WorkoutsPage() {
  return <FeatureGate feature="workouts"><Workouts /></FeatureGate>;
}

function Workouts() {
  const nav = useNavigate();
  const templates = useApi(() => api.get('/coach/workout-templates'), []);
  const programmes = useApi(() => api.get('/coach/workout-programs'), []);
  const tplRows = (templates.data ? ((templates.data as any).items ?? []) : null) as any[] | null;
  const [tab, setTab] = useState<TabId>('all');
  const [source, setSource] = useState<Source>('');
  const [category, setCategory] = useState('');
  const [level, setLevel] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [assign, setAssign] = useState<WorkoutPlan | null>(null);
  const [showCats, setShowCats] = useState(false);

  const plans = useMemo<WorkoutPlan[]>(() => {
    if (!tplRows) return [];
    const tpl = tplRows.map(templatePlan);
    const cats = new Map(tpl.map((p) => [p.id, p.categories]));
    const progs = (((programmes.data as any)?.items ?? []) as any[]).filter((p) => p.status !== 'archived').map((p) => programmePlan(p, (id) => cats.get(id) ?? [])).filter((p): p is NonNullable<typeof p> => !!p);
    return [...tpl, ...progs];
  }, [tplRows, programmes.data]);

  const matches = (p: WorkoutPlan, ignoreTab = false) => (ignoreTab || tab === 'all' || p.frequency === tab)
    && (!source || (source === 'programmes' ? p.kind === 'programme' : p.kind === 'template' && p.source === (source === 'team' ? 'team' : 'coach')))
    && (!category || p.categories.includes(category))
    && (!level || (p.kind === 'template' && p.level === level))
    && (!q.trim() || p.title.toLowerCase().includes(q.trim().toLowerCase()) || (p.kind === 'programme' && p.memberName.toLowerCase().includes(q.trim().toLowerCase())));
  const filtered = plans.filter((p) => matches(p));
  const countFor = (t: TabId) => plans.filter((p) => (t === 'all' || p.frequency === t) && matches(p, true)).length;
  const { shown, pages, page: at } = pageOf(filtered, page);
  const reset = () => setPage(1);
  const filtersOn = !!(source || category || level || q.trim());

  const loading = !templates.data && !templates.error;
  return <PlansPage label="Workouts">
    <PageHeader title="Workouts" sub="Bioptime team templates, your own, and your clients’ programmes." actions={<>
      <Button onClick={() => setShowCats(true)} aria-label={category ? `Categories, showing ${label(category)}` : 'Categories'}><Icon name="filter" size={16} /> Categories{category ? <span className="bp-badge">1</span> : null}</Button>
      <Link className="bp-btn bp-btn-secondary" to="/exercise-library"><Icon name="library" size={16} /> Exercise library</Link>
      <Button variant="primary" onClick={() => nav('/workout-templates/new')}><Icon name="plus" size={16} /> Create workout plan</Button>
    </>} />
    {templates.error && <Alert kind="error">{templates.error}</Alert>}
    {programmes.error && <Alert kind="warning" title="Your clients’ programmes could not be loaded">{programmes.error}</Alert>}
    <Tabs label="Plan frequency" value={tab} onChange={(t) => { setTab(t); reset(); }} items={[{ id: 'all', label: 'All plans', count: countFor('all') }, { id: 'daily', label: 'Daily', count: countFor('daily') }, { id: 'weekly', label: 'Weekly', count: countFor('weekly') }, { id: 'monthly', label: 'Monthly', count: countFor('monthly') }]}>
      <p className="small muted" style={{ margin: 0 }}>{TAB_HINT[tab]}</p>
      <div className="wzp-filters">
        <span className="wzp-count" aria-live="polite"><b>{filtered.length}</b> workout plan{filtered.length === 1 ? '' : 's'}{filtersOn ? ' match' : ''}</span>
        <Input type="search" aria-label="Search plans by name or client" placeholder="Search by name" value={q} onChange={(e) => { setQ(e.target.value); reset(); }} />
        <Select aria-label="Source" value={source} onChange={(e) => { setSource(e.target.value as Source); reset(); }}><option value="">All sources</option><option value="mine">Mine</option><option value="team">Bioptime team</option><option value="programmes">Client programmes</option></Select>
        <Select aria-label="Category" value={category} onChange={(e) => { setCategory(e.target.value); reset(); }}><option value="">All categories</option>{CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select>
        <Select aria-label="Level" value={level} onChange={(e) => { setLevel(e.target.value); reset(); }}><option value="">All levels</option>{LEVELS.map((l) => <option key={l} value={l}>{label(l)}</option>)}</Select>
        {filtersOn && <Button size="sm" variant="tertiary" onClick={() => { setSource(''); setCategory(''); setLevel(''); setQ(''); reset(); }}>Clear filters</Button>}
      </div>
      {loading ? <Skeleton rows={6} /> : templates.error && !templates.data ? null : shown.length ? <>
        <CardGrid columns={4} label="Workout plans">{shown.map((p) => <PlanCard key={`${p.kind}:${p.id}`} plan={p} onAssign={() => setAssign(p)} />)}</CardGrid>
        <Pager page={at} pages={pages} onPage={setPage} label="Workout plan pages" />
      </> : <Empty title={plans.length ? 'No plans match' : 'No workout plans yet'} body={plans.length ? 'Clear the filters, or pick another tab.' : 'Create a template: a session of exercises with sets, reps or time, and rest.'} action={plans.length ? undefined : <Button variant="primary" onClick={() => nav('/workout-templates/new')}>Create workout plan</Button>} />}
    </Tabs>
    <AssignWorkoutDialog plan={assign} onClose={() => setAssign(null)} onAssigned={programmes.reload} />
    <CategoriesDialog open={showCats} onClose={() => setShowCats(false)} plans={plans} value={category} onPick={(c) => { setCategory(c); reset(); setShowCats(false); }} />
  </PlansPage>;
}

function PlanCard({ plan: p, onAssign }: { plan: WorkoutPlan; onAssign: () => void }) {
  const to = p.kind === 'template' ? `/workout-templates/${p.id}` : `/workout-programs/${p.id}`;
  const tags: string[] = [...p.categories.map(label)];
  if (p.kind === 'template') { if (p.level) tags.push(label(p.level)); if (p.estMinutes) tags.push(`${p.estMinutes} min`); }
  return <article className="wzp-card" aria-label={p.title}>
    <Cover icon="workout" start={<Badge at="start" accent={p.source === 'team'}>{p.kind === 'programme' ? 'Programme' : p.source === 'team' ? 'Bioptime team' : 'Mine'}</Badge>} end={<Badge at="end">{FREQUENCY_LABEL[p.frequency]}</Badge>} />
    <h3><Link to={to}>{p.title}</Link></h3>
    {p.kind === 'programme' && <div className="row" style={{ gap: 6 }}><StatusPill status={p.status} />{p.draftRevision && <span className="small muted">draft revision open</span>}</div>}
    <div className="wzp-tags">{tags.map((t) => <Tag key={t}>{t}</Tag>)}</div>
    <p className="wzp-meta">{p.kind === 'template'
      ? <>Includes <b>{p.exercises}</b> exercise{p.exercises === 1 ? '' : 's'}</>
      : <>Includes <b>{p.sessions}</b> session{p.sessions === 1 ? '' : 's'} over <b>{p.weeks}</b> week{p.weeks === 1 ? '' : 's'} · for {p.memberName}</>}</p>
    {p.kind === 'template' && p.updatedAt && <p className="small muted" style={{ margin: 0 }}>Updated {fmtDate(p.updatedAt)}</p>}
    <div className="wzp-foot">
      <Button variant="primary" size="sm" disabled={p.kind === 'template' && !p.exercises} title={p.kind === 'template' && !p.exercises ? 'Add exercises to this template first' : undefined} onClick={onAssign}><Icon name="plus" size={14} /> Assign client</Button>
      <Link className="bp-btn bp-btn-tertiary bp-btn-sm" to={to}>{p.kind === 'template' ? (p.source === 'coach' ? 'Edit' : 'View') : 'Open'}</Link>
    </div>
  </article>;
}

/** The exercise categories, with how many plans include each; picking one filters the grid. */
function CategoriesDialog({ open, onClose, plans, value, onPick }: { open: boolean; onClose: () => void; plans: WorkoutPlan[]; value: string; onPick: (c: string) => void }) {
  return <Dialog open={open} onClose={onClose} title="Categories" footer={<><Button variant="tertiary" onClick={onClose}>Close</Button>{value && <Button onClick={() => onPick('')}>Show every category</Button>}</>}>
    <p className="small">A plan’s categories are those of the exercises in it, as filed in the exercise library.</p>
    <ul className="taskList" style={{ marginTop: 10 }}>{CATEGORIES.map((c) => { const n = plans.filter((p) => p.categories.includes(c)).length; return <li key={c}><div><b style={{ color: 'var(--bp-color-text-primary)' }}>{label(c)}</b><span className="muted">{n} plan{n === 1 ? '' : 's'}</span></div><Button size="sm" variant={value === c ? 'primary' : 'secondary'} disabled={!n} aria-pressed={value === c} onClick={() => onPick(c)}>{value === c ? 'Shown' : 'Show'}</Button></li>; })}</ul>
  </Dialog>;
}
