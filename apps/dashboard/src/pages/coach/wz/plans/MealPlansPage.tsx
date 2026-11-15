/* Coach workspace: Meal plans (/coach/meals). The meal plan grid, filled with the meal plans
   the coach wrote for their assigned clients: one request, GET /coach/meal-plans, which summarises each plan (title,
   summary, status, open draft, meals, days, how the meals repeat) and reads no client's health record, so opening the
   page records no health view. The plan type is the list's `frequency`: a Bioptime meal plan is a week (Monday to
   Sunday) of meals, so "Daily" is a plan with the same meals on all seven days, "Weekly" one whose meals change across
   the week or leave days out; a plan with no meals yet shows under All plans only.
   "Assign meal" starts the existing meal plan editor for the client the coach picks: a new draft with this plan's meals
   and targets (POST /coach/meal-plans/:id/copy, then /coach/meal-plans/:id), or a blank plan
   (/coach/meal-plans/new?member=…). The summary is not copied: it was written for another client. */
import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../../../lib/api';
import { fmtDate } from '../../../../lib/format';
import { Link, useNavigate } from '../../../../lib/nav';
import { Alert, Button, Dialog, Empty, Field, Input, Select, Skeleton, Tabs, errorText, useApi } from '../../../../ui';
import { CardGrid, Icon, PageHeader, StatusPill } from '../ui';
import { Badge, ClientSelect, Cover, FeatureGate, Pager, PlansPage, Tag, pageOf, useCoachClients, type CoachClient } from './parts';

type PlanType = 'daily' | 'weekly' | 'empty';
type MealPlan = { id: string; title: string; summary: string; status: string; hasDraft: boolean; memberId: string; memberName: string; updatedAt: string; meals: number; days: number; type: PlanType };
const TYPE_LABEL: Record<PlanType, string> = { daily: 'Daily', weekly: 'Weekly', empty: 'No meals yet' };
/** GET /coach/meal-plans answers with at most this many plans (the coach's latest changes first). */
const LIST_CAP = 500;

export function MealPlansPage() {
  return <FeatureGate feature="nutrition"><MealPlans /></FeatureGate>;
}

function MealPlans() {
  const nav = useNavigate();
  const clients = useCoachClients();
  const list = useApi(() => api.get('/coach/meal-plans'), []);
  const [tab, setTab] = useState<'all' | 'daily' | 'weekly'>('all');
  const [status, setStatus] = useState('');
  const [member, setMember] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [assign, setAssign] = useState<MealPlan | null>(null);

  const raw = (((list.data as any)?.items ?? []) as any[]);
  const plans = useMemo<MealPlan[]>(() => raw.map((p) => ({
    id: p.id, title: p.title, summary: p.summary ?? '', status: p.status, hasDraft: !!p.hasDraft, memberId: p.memberId, memberName: p.memberName,
    updatedAt: p.updatedAt ?? '', meals: Number(p.meals ?? 0), days: Number(p.days ?? 0),
    type: (p.frequency === 'daily' || p.frequency === 'weekly' ? p.frequency : 'empty') as PlanType,
  })).sort((a, b) => Number(a.status === 'archived') - Number(b.status === 'archived') || b.updatedAt.localeCompare(a.updatedAt)), [list.data]);

  const needle = q.trim().toLowerCase();
  const matches = (p: MealPlan, ignoreTab = false) => (ignoreTab || tab === 'all' || p.type === tab) && (!status || p.status === status) && (!member || p.memberId === member) && (!needle || p.title.toLowerCase().includes(needle) || p.memberName.toLowerCase().includes(needle));
  const filtered = plans.filter((p) => matches(p));
  const countFor = (t: 'all' | 'daily' | 'weekly') => plans.filter((p) => (t === 'all' || p.type === t) && matches(p, true)).length;
  const { shown, pages, page: at } = pageOf(filtered, page);
  const reset = () => setPage(1);
  const loading = !list.data && !list.error;
  const filtersOn = !!(status || member || needle);

  return <PlansPage label="Meal plans">
    <PageHeader title="Meal plans" sub="Your clients’ meal plans: a week of meals each, seen by the client once published." actions={<>
      <Link className="bp-btn bp-btn-secondary" to="/nutrition-library"><Icon name="library" size={16} /> Recipes and foods</Link>
      <Button variant="primary" onClick={() => nav('/meal-plans/new')}><Icon name="plus" size={16} /> Create meal plan</Button>
    </>} />
    {list.error && <Alert kind="error">{list.error}</Alert>}
    {clients.error && <Alert kind="warning" title="Your client list could not be loaded">{clients.error} The client filter and Assign meal need it; reload the page to try again.</Alert>}
    <Tabs label="Plan type" value={tab} onChange={(t) => { setTab(t); reset(); }} items={[{ id: 'all', label: 'All plans', count: countFor('all') }, { id: 'daily', label: 'Daily', count: countFor('daily') }, { id: 'weekly', label: 'Weekly', count: countFor('weekly') }]}>
      <p className="small muted" style={{ margin: 0 }}>{tab === 'daily' ? 'The same meals every day of the week.' : tab === 'weekly' ? 'Meals that change across the week, or only on some days.' : 'Every meal plan of your assigned clients, drafts and archived ones included.'}</p>
      <div className="wzp-filters">
        <span className="wzp-count" aria-live="polite"><b>{filtered.length}</b> meal plan{filtered.length === 1 ? '' : 's'}{filtersOn ? ' match' : ''}</span>
        <Input type="search" aria-label="Search meal plans by title or client" placeholder="Title or client" value={q} onChange={(e) => { setQ(e.target.value); reset(); }} />
        <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); reset(); }}><option value="">All statuses</option><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></Select>
        <Select aria-label="Client" value={member} onChange={(e) => { setMember(e.target.value); reset(); }}><option value="">All clients</option>{clients.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        {filtersOn && <Button size="sm" variant="tertiary" onClick={() => { setStatus(''); setMember(''); setQ(''); reset(); }}>Clear filters</Button>}
      </div>
      {loading ? <Skeleton rows={6} /> : list.error && !list.data ? null : shown.length ? <>
        <CardGrid columns={4} label="Meal plans">{shown.map((p) => <MealCard key={p.id} p={p} onAssign={() => setAssign(p)} />)}</CardGrid>
        <Pager page={at} pages={pages} onPage={setPage} label="Meal plan pages" />
      </> : <Empty title={plans.length ? 'No meal plans match' : 'No meal plans yet'} body={plans.length ? 'Clear the filters, or pick another tab.' : 'Write one for a client: a week of meals from the nutrition library or in your own words.'} action={plans.length ? undefined : <Button variant="primary" onClick={() => nav('/meal-plans/new')}>Create meal plan</Button>} />}
      {raw.length >= LIST_CAP && <p className="small muted">Showing the {LIST_CAP} meal plans you changed most recently. Open a client’s record for the rest of theirs.</p>}
    </Tabs>
    <AssignMealDialog plan={assign} clients={clients.items} onClose={() => setAssign(null)} />
  </PlansPage>;
}

function MealCard({ p, onAssign }: { p: MealPlan; onAssign: () => void }) {
  return <article className="wzp-card" aria-label={p.title}>
    <Cover icon="meal" start={<Badge at="start" accent={p.type !== 'empty'}>{TYPE_LABEL[p.type]}</Badge>} end={<span className="wzp-corner"><StatusPill status={p.status} /></span>} />
    <h3><Link to={`/meal-plans/${p.id}`}>{p.title}</Link></h3>
    <p className="wzp-desc">{p.summary || 'No summary for the client yet.'}</p>
    <div className="wzp-tags"><Tag>{p.memberName}</Tag>{p.meals > 0 && <Tag>{p.meals} meal{p.meals === 1 ? '' : 's'}</Tag>}{p.days > 0 && <Tag>{p.days} day{p.days === 1 ? '' : 's'}</Tag>}</div>
    <p className="small muted" style={{ margin: 0 }}>Updated {fmtDate(p.updatedAt)}{p.hasDraft && p.status === 'published' ? ' · draft revision open' : ''}</p>
    <div className="wzp-foot">
      <Button variant="primary" size="sm" onClick={onAssign}><Icon name="plus" size={14} /> Assign meal</Button>
      <Link className="bp-btn bp-btn-tertiary bp-btn-sm" to={`/meal-plans/${p.id}`}>Open</Link>
    </div>
  </article>;
}

function AssignMealDialog({ plan, clients, onClose }: { plan: MealPlan | null; clients: CoachClient[]; onClose: () => void }) {
  const nav = useNavigate();
  const [member, setMember] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (plan) { setMember(''); setTitle(plan.title); setErr(''); setBusy(false); } }, [plan]);
  const client = clients.find((c) => c.id === member);
  const copy = async () => {
    if (!plan) return;
    setBusy(true); setErr('');
    try {
      // the server copies the meals and targets (the source's open draft, else its published version) and checks every
      // food and recipe against this coach's library; the summary stays empty, since it was written for another client
      const r = await api.post(`/coach/meal-plans/${plan.id}/copy`, { memberId: member, title: title.trim(), summary: '' });
      onClose(); nav(`/meal-plans/${r.id}`);
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const blank = () => { onClose(); nav(`/meal-plans/new?member=${encodeURIComponent(member)}`); };
  return <Dialog open={!!plan} onClose={onClose} title={`Assign: ${plan?.title ?? ''}`} footer={<><Button variant="tertiary" onClick={onClose}>Cancel</Button><Button disabled={!member} onClick={blank}>Start a blank plan</Button><Button variant="primary" busy={busy} disabled={!member || title.trim().length < 2 || !plan?.meals} onClick={copy}>Copy the meals into a draft</Button></>}>
    {plan && <div className="form">
      <p className="small">Opens the meal plan editor for the client you choose: a new draft with the {plan.meals} meal{plan.meals === 1 ? '' : 's'} and the targets of {plan.title} copied in, or a blank plan. The summary is left for you to write for this client. Nothing reaches the client until you publish it.</p>
      <Field label="Client"><ClientSelect clients={clients} value={member} onChange={setMember} /></Field>
      {client && !client.healthShared && <p className="small muted">{client.name} does not share health records with you: you can write and publish their plan; their meal logs and adherence stay hidden until they turn on sharing.</p>}
      <Field label="Title of the new plan"><Input value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} /></Field>
      {!plan.meals && <p className="small muted">This plan has no meals yet, so there is nothing to copy: start a blank plan instead.</p>}
      {err && <Alert kind="error">{err}</Alert>}
    </div>}
  </Dialog>;
}
