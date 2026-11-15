/* M5 Nutrition, coach workspace: the meal plan editor (/coach/meal-plans/:id, 'new' with ?member=). A draft until it is
   published; publishing freezes the version and tells the client; editing a published plan opens the next version.
   Targets are optional and typed by the coach; totals show only the values entered in the library. */
import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { Link, useNavigate } from '../../lib/nav';
import { Alert, Button, Card, CardHead, Field, Input, Pill, ReasonDialog, Select, Skeleton, Textarea, errorText, useApi, useToast } from '../../ui';
import { DAY_LABEL, SLOTS, SLOT_LABEL, TARGETS, TotalsTable } from './shared';

type SlotDraft = { day: number; slot: string; timeHint: string; ref: string; title: string; portionNote: string };

export function MealPlanEditor() {
  const { id = 'new' } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const isNew = id === 'new';
  const existing = useApi(() => (isNew ? Promise.resolve(null) : api.get(`/coach/meal-plans/${id}`)), [id]);
  const clients = useApi(() => (isNew ? api.get('/coach/clients?limit=100') : Promise.resolve(null)), [isNew]);
  const library = useApi(() => api.get('/coach/nutrition-library'), []);
  const [member, setMember] = useState(params.get('member') ?? '');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [slots, setSlots] = useState<SlotDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [archiving, setArchiving] = useState(false);
  const p = existing.data as any;
  useEffect(() => {
    if (!p) return;
    setMember(p.memberId); setTitle(p.title);
    const v = p.version;
    setSummary(v?.summary ?? '');
    setTargets(Object.fromEntries(Object.entries(v?.targets ?? {}).map(([k, val]) => [k, String(val)])));
    setSlots((v?.slots ?? []).map((s: any) => ({ day: s.day, slot: s.slot, timeHint: s.timeHint ?? '', ref: s.food ? `food:${s.food.id}` : s.recipe ? `recipe:${s.recipe.id}` : '', title: s.title, portionNote: s.portionNote ?? '' })));
  }, [p]);

  const foods: any[] = (library.data as any)?.foods ?? [];
  const recipes: any[] = (library.data as any)?.recipes ?? [];
  // items the plan already uses that are not in my library (a previous coach's draft after a handover, or one the team
  // archived since): the API keeps accepting them on this plan, so they stay selectable instead of showing as empty
  const onPlanOnly: Array<{ ref: string; label: string }> = [];
  if (library.data) {
    for (const s of (p?.version?.slots ?? []) as any[]) {
      const ref = s.food ? `food:${s.food.id}` : s.recipe ? `recipe:${s.recipe.id}` : '';
      const known = s.food ? foods.some((f) => f.id === s.food.id) : s.recipe ? recipes.some((r) => r.id === s.recipe.id) : true;
      if (ref && !known && !onPlanOnly.some((o) => o.ref === ref)) onPlanOnly.push({ ref, label: s.food ? s.food.name : s.recipe.title });
    }
  }
  const body = () => ({
    title, summary,
    targets: Object.fromEntries(Object.entries(targets).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, Number(v)])),
    slots: slots.map((s) => ({ day: s.day, slot: s.slot, timeHint: s.timeHint.trim() || null, title: s.title.trim() || undefined, portionNote: s.portionNote.trim() || undefined, ...(s.ref.startsWith('food:') ? { foodId: s.ref.slice(5) } : s.ref.startsWith('recipe:') ? { recipeId: s.ref.slice(7) } : {}) })),
  });
  const save = async (publish: boolean) => {
    setBusy(true); setErr('');
    try {
      let planId = id;
      if (isNew) { if (!member) throw new Error('Choose the client first'); const r = await api.post('/coach/meal-plans', { memberId: member, ...body() }); planId = r.id; }
      else await api.patch(`/coach/meal-plans/${id}`, body());
      if (publish) { await api.post(`/coach/meal-plans/${planId}/publish`); toast('Meal plan published: the client has been told'); }
      else toast('Draft saved');
      if (isNew) nav(`/meal-plans/${planId}`, { replace: true }); else existing.reload();
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const setSlot = (i: number, patch: Partial<SlotDraft>) => setSlots((ss) => ss.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const addSlot = (day: number) => setSlots((ss) => [...ss, { day, slot: 'lunch', timeHint: '', ref: '', title: '', portionNote: '' }]);
  const copyMonday = () => setSlots((ss) => { const mon = ss.filter((s) => s.day === 1); return [...mon, ...[2, 3, 4, 5, 6, 7].flatMap((d) => mon.map((s) => ({ ...s, day: d })))]; });

  if (!isNew && existing.error) return <Alert kind="error">{existing.error}</Alert>;
  if (!isNew && !p) return <Skeleton rows={6} />;
  const archived = p?.status === 'archived';
  const hasDraft = isNew || p.hasDraft;
  const back = member ? `/clients/${member}?tab=nutrition` : '/clients';
  return <div className="stack">
    <div className="pageHead"><div><Link className="muted" to={back}>← Client</Link><h1 style={{ marginTop: 4 }}>{isNew ? 'New meal plan' : p.title}</h1><p className="sub">{isNew ? 'A draft until you publish it. Publishing shows it to the client and tells them.' : `${p.memberName} · version ${p.version?.version ?? p.currentVersion} · ${p.version?.status ?? p.status}${p.hasDraft && p.status === 'published' ? ' (the client still sees the last published version)' : ''}`}</p></div>
      <div className="actions">{!isNew && <Pill status={p.status} />}{!archived && <><Button busy={busy} onClick={() => save(false)}>Save draft</Button><Button variant="primary" busy={busy} onClick={() => save(true)}>{hasDraft || isNew ? 'Publish' : 'Publish revision'}</Button></>}{!isNew && !archived && <Button variant="tertiary" onClick={() => setArchiving(true)}>Archive</Button>}</div></div>
    {err && <Alert kind="error">{err}</Alert>}
    {archived && <Alert kind="info" title="Archived">This plan is archived and no longer shown to the client. Start a new plan from the client record.</Alert>}
    <div className="grid">
      <div className="span4"><Card><CardHead eyebrow="Meal plan" title="Basics" /><div className="form">
        {isNew && <Field label="Client"><Select value={member} onChange={(e) => setMember(e.target.value)}><option value="">Choose a client</option>{(((clients.data as any)?.items ?? []) as any[]).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>}
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Regular meals, weeks 1 to 4" /></Field>
        <Field label="Summary for the client" optional><Textarea value={summary} onChange={(e) => setSummary(e.target.value)} /></Field>
        <div><span className="bp-label">Targets per day</span><span className="bp-hint" style={{ display: 'block' }}>Optional. Only targets you agreed with the client; leave empty otherwise.</span><div className="stack" style={{ marginTop: 6 }}>{TARGETS.map((t) => <div key={t.key} className="row"><span className="small" style={{ minWidth: 110 }}>{t.label} ({t.unit})</span><Input aria-label={`${t.label} target`} style={{ maxWidth: 120 }} inputMode="decimal" value={targets[t.key] ?? ''} onChange={(e) => setTargets((x) => ({ ...x, [t.key]: e.target.value.replace(/[^0-9.]/g, '') }))} /></div>)}</div></div>
        <p className="muted">Within your coaching scope: no diet-for-condition claims, no supplement or medical advice in a plan.</p>
      </div></Card></div>
      <div className="span8"><Card><CardHead eyebrow="Week" title={`${slots.length} meal${slots.length === 1 ? '' : 's'}`} right={<Button size="sm" disabled={!slots.some((s) => s.day === 1)} onClick={copyMonday}>Copy Monday to every day</Button>} />
        {library.error && <Alert kind="warning">{library.error}</Alert>}
        <div className="stack">{[1, 2, 3, 4, 5, 6, 7].map((day) => <div key={day} className="bp-tile"><div className="row between"><b style={{ color: 'var(--bp-color-text-primary)' }}>{DAY_LABEL[day]}</b><Button size="sm" variant="tertiary" onClick={() => addSlot(day)}>Add meal</Button></div>
          <div className="stack" style={{ marginTop: 8 }}>{slots.map((s, i) => s.day !== day ? null : <div key={i} className="row">
            <Select aria-label="Meal" style={{ maxWidth: 140 }} value={s.slot} onChange={(e) => setSlot(i, { slot: e.target.value })}>{SLOTS.map((x) => <option key={x} value={x}>{SLOT_LABEL[x]}</option>)}</Select>
            <Select aria-label="Food or recipe" style={{ maxWidth: 220 }} value={s.ref} onChange={(e) => setSlot(i, { ref: e.target.value })}><option value="">No library item</option><optgroup label="Foods">{foods.map((f) => <option key={f.id} value={`food:${f.id}`}>{f.name}{f.status === 'draft' ? ' (my draft)' : ''}</option>)}</optgroup><optgroup label="Recipes">{recipes.map((r) => <option key={r.id} value={`recipe:${r.id}`}>{r.title}{r.status === 'draft' ? ' (my draft)' : ''}</option>)}</optgroup>{onPlanOnly.length > 0 && <optgroup label="Already on this plan">{onPlanOnly.map((o) => <option key={o.ref} value={o.ref}>{o.label}</option>)}</optgroup>}</Select>
            <Input aria-label="Meal name" style={{ flex: '1 1 180px' }} placeholder={s.ref ? 'Name (optional)' : 'Name, e.g. Home-cooked dinner'} value={s.title} onChange={(e) => setSlot(i, { title: e.target.value })} />
            <Input aria-label="Time" style={{ maxWidth: 110 }} placeholder="Time" value={s.timeHint} onChange={(e) => setSlot(i, { timeHint: e.target.value })} />
            <Input aria-label="Portion note" style={{ flex: '1 1 160px' }} placeholder="Portion note (optional)" value={s.portionNote} onChange={(e) => setSlot(i, { portionNote: e.target.value })} />
            <Button size="sm" variant="tertiary" aria-label="Remove meal" onClick={() => setSlots((ss) => ss.filter((_, k) => k !== i))}>✕</Button>
          </div>)}{!slots.some((s) => s.day === day) && <p className="muted small">No meals planned.</p>}</div>
        </div>)}</div>
        <p className="muted small" style={{ marginTop: 10 }}>Foods and recipes come from the <Link to="/nutrition-library">nutrition library</Link>: published items and your own drafts.</p>
      </Card></div>
    </div>
    {!isNew && p.version && <Card><CardHead eyebrow={`Version ${p.version.version} · entered values only`} title="Totals per day" /><TotalsTable totals={p.version.totals} targets={p.version.targets} /><p className="muted small" style={{ marginTop: 6 }}>Totals follow the last saved draft; save to refresh them.</p></Card>}
    {!isNew && <Card><CardHead eyebrow="Versions" title="History" /><ul className="timeline">{(p.versions ?? []).map((v: any) => <li key={v.id} className={v.status === 'published' ? 'done' : ''}><b>Version {v.version}</b> · {v.status}{v.summary ? ` · ${v.summary}` : ''}<time>{fmtDateTime(v.publishedAt ?? v.createdAt)}</time></li>)}</ul></Card>}
    {!isNew && <ReasonDialog open={archiving} onClose={() => setArchiving(false)} title="Archive this meal plan?" body="The client no longer sees it. The history stays." confirmLabel="Archive" danger onConfirm={async (reason) => { await api.post(`/coach/meal-plans/${id}/archive`, { reason }); toast('Meal plan archived'); existing.reload(); }} />}
  </div>;
}
