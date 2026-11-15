/* M5 Nutrition: the food and recipe library. Coach workspace (/coach/nutrition-library): published items plus the
   coach's own drafts, and new drafts. Admin workspace (/admin/nutrition-library, library.manage): every item, corrections
   and publishing, each with a reason in the audit log.

   A nutrient value is accepted only with the source it was read from; without one the values stay empty. No licensed
   food-composition dataset and no automatic estimate exist yet: both are shown as pending configuration. */
import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { label } from '../../lib/format';
import { useAuth } from '../../lib/auth';
import { Alert, Button, Card, CardHead, Dialog, Empty, Field, Input, Pill, ReasonDialog, Select, Skeleton, Tabs, Table, Textarea, errorText, useApi, useToast } from '../../ui';
import { NUTRIENTS, nutrientLine } from './shared';

type Mode = 'coach' | 'admin';

export function NutritionLibrary({ mode }: { mode: Mode }) {
  const { user } = useAuth();
  const [tab, setTab] = useState<'foods' | 'recipes'>('foods');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const query = `${status ? `status=${status}&` : ''}${q.trim() ? `q=${encodeURIComponent(q.trim())}` : ''}`;
  const coachLib = useApi(() => (mode === 'coach' ? api.get(`/coach/nutrition-library?${query}`) : Promise.resolve(null)), [mode, query]);
  const adminFoods = useApi(() => (mode === 'admin' ? api.get(`/admin/foods?${query}`) : Promise.resolve(null)), [mode, query]);
  const adminRecipes = useApi(() => (mode === 'admin' ? api.get(`/admin/recipes?${query}`) : Promise.resolve(null)), [mode, query]);
  const [foodForm, setFoodForm] = useState<{ item: any | null } | null>(null);
  const [recipeForm, setRecipeForm] = useState<{ item: any | null } | null>(null);
  const [statusFor, setStatusFor] = useState<{ kind: 'foods' | 'recipes'; item: any; to: string } | null>(null);
  const toast = useToast();
  const reload = () => { coachLib.reload(); adminFoods.reload(); adminRecipes.reload(); };
  const foods: any[] = mode === 'coach' ? (coachLib.data as any)?.foods ?? [] : (adminFoods.data as any)?.items ?? [];
  const recipes: any[] = mode === 'coach' ? (coachLib.data as any)?.recipes ?? [] : (adminRecipes.data as any)?.items ?? [];
  const pending = mode === 'coach' ? { licensedDataset: (coachLib.data as any)?.licensedDataset } : (adminFoods.data as any);
  const error = coachLib.error || adminFoods.error || adminRecipes.error;
  const loaded = mode === 'coach' ? !!coachLib.data : !!adminFoods.data && !!adminRecipes.data;
  const mine = (it: any) => it.createdBy === user?.id;
  const canEdit = mode === 'admin';

  return <div className="stack">
    <div className="pageHead"><div><h1>Nutrition library</h1><p className="sub">{mode === 'admin' ? 'Foods and recipes the coaches use in meal plans. Publish an item once it is checked against its source; every change is recorded with its reason.' : 'Published foods and recipes, and your own drafts. Your drafts are usable in your plans; the Bioptime team publishes them for everyone.'}</p></div>
      <div className="actions"><Button onClick={() => setRecipeForm({ item: null })}>{mode === 'admin' ? 'Add recipe' : 'Add recipe (draft)'}</Button><Button variant="primary" onClick={() => setFoodForm({ item: null })}>{mode === 'admin' ? 'Add food' : 'Add food (draft)'}</Button></div></div>
    <Alert kind="info" title="Nutrient values need a source">Enter energy, protein, carbohydrate, fat or fibre only from a source you can name, such as the food's label or a published composition table, and write it in Source. Leave them empty otherwise: plans then show the meal without values and mark the day's totals incomplete.</Alert>
    {pending?.licensedDataset && !pending.licensedDataset.configured && <Alert kind="warning" title="Pending configuration: licensed food dataset">{pending.licensedDataset.missing}.</Alert>}
    {mode === 'admin' && pending?.estimates && !pending.estimates.configured && <Alert kind="warning" title="Pending configuration: automatic estimates">{pending.estimates.missing}.</Alert>}
    <div className="row"><Field label="Search"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or title" /></Field><Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any</option><option value="published">Published</option><option value="draft">Draft</option>{mode === 'admin' && <option value="archived">Archived</option>}</Select></Field></div>
    {error && <Alert kind="error">{error}</Alert>}
    {!loaded && !error ? <Skeleton rows={6} /> : <Tabs items={[{ id: 'foods', label: 'Foods', count: foods.length }, { id: 'recipes', label: 'Recipes', count: recipes.length }]} value={tab} onChange={setTab} label="Library">
      {tab === 'foods' && <Card>{foods.length ? <Table label="Foods" head={<><th>Name</th><th>Serving</th><th>Values per serving</th><th>Source</th><th>Status</th><th /></>}>{foods.map((f) => <tr key={f.id}>
        <td>{f.name}{(f.tags ?? []).length ? <div className="muted">{f.tags.join(', ')}</div> : null}</td>
        <td>{f.servingLabel || '—'}{f.servingGrams ? <div className="muted">{f.servingGrams} g</div> : null}</td>
        <td className="small">{nutrientLine(f)}</td>
        <td className="small">{label(f.source)}{f.sourceRef ? <div className="muted">{f.sourceRef}</div> : null}</td>
        <td><Pill status={f.status} />{mode === 'coach' && mine(f) && f.status === 'draft' ? <div className="muted">my draft</div> : null}</td>
        <td className="num">{canEdit && <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}><Button size="sm" variant="tertiary" onClick={() => setFoodForm({ item: f })}>Edit</Button><StatusButtons item={f} onPick={(to) => setStatusFor({ kind: 'foods', item: f, to })} /></div>}</td>
      </tr>)}</Table> : <Empty title="No foods" body={mode === 'admin' ? 'Add the first one.' : 'Nothing is published yet. Add a draft for your own plans.'} />}</Card>}
      {tab === 'recipes' && <Card>{recipes.length ? <Table label="Recipes" head={<><th>Title</th><th>Ingredients</th><th>Servings</th><th>Source</th><th>Status</th><th /></>}>{recipes.map((r) => <tr key={r.id}>
        <td>{r.title}{r.summary ? <div className="muted">{r.summary}</div> : null}</td>
        <td className="small">{(r.ingredients ?? []).map((i: any) => `${i.label}${i.quantity ? ` ${i.quantity}${i.unit ? ` ${i.unit}` : ''}` : ''}`).join(', ') || '—'}</td>
        <td className="num">{r.servings ?? '—'}{r.prepMinutes ? <div className="muted">{r.prepMinutes} min</div> : null}</td>
        <td className="small">{label(r.source)}</td>
        <td><Pill status={r.status} />{mode === 'coach' && mine(r) && r.status === 'draft' ? <div className="muted">my draft</div> : null}</td>
        <td className="num">{canEdit && <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}><Button size="sm" variant="tertiary" onClick={() => setRecipeForm({ item: r })}>Edit</Button><StatusButtons item={r} onPick={(to) => setStatusFor({ kind: 'recipes', item: r, to })} /></div>}</td>
      </tr>)}</Table> : <Empty title="No recipes" />}</Card>}
    </Tabs>}
    <FoodDialog mode={mode} state={foodForm} onClose={() => setFoodForm(null)} onSaved={() => { setFoodForm(null); reload(); }} />
    <RecipeDialog mode={mode} state={recipeForm} foods={foods} onClose={() => setRecipeForm(null)} onSaved={() => { setRecipeForm(null); reload(); }} />
    <ReasonDialog open={!!statusFor} onClose={() => setStatusFor(null)} title={statusFor ? `${statusFor.to === 'published' ? 'Publish' : statusFor.to === 'archived' ? 'Archive' : 'Return to draft'}: ${statusFor.item.name ?? statusFor.item.title}` : ''} body={statusFor?.to === 'published' ? 'Every coach can then use it in their plans.' : statusFor?.to === 'archived' ? 'Coaches can no longer add it to plans; plans that use it keep it.' : 'Coaches other than its author stop seeing it.'} confirmLabel={statusFor?.to === 'published' ? 'Publish' : statusFor?.to === 'archived' ? 'Archive' : 'Return to draft'} danger={statusFor?.to === 'archived'} onConfirm={async (reason) => { await api.post(`/admin/${statusFor!.kind}/${statusFor!.item.id}/status`, { status: statusFor!.to, reason }); toast('Status changed'); reload(); }} />
  </div>;
}

function StatusButtons({ item, onPick }: { item: any; onPick: (to: string) => void }) {
  return <>{item.status !== 'published' && <Button size="sm" variant="secondary" onClick={() => onPick('published')}>Publish</Button>}{item.status === 'published' && <Button size="sm" variant="tertiary" onClick={() => onPick('draft')}>Unpublish</Button>}{item.status !== 'archived' && <Button size="sm" variant="tertiary" onClick={() => onPick('archived')}>Archive</Button>}</>;
}

const num = (s: string) => (s.trim() === '' ? null : Number(s));

function FoodDialog({ mode, state, onClose, onSaved }: { mode: Mode; state: { item: any | null } | null; onClose: () => void; onSaved: () => void }) {
  const item = state?.item ?? null;
  const [f, setF] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toast = useToast();
  useEffect(() => {
    if (!state) return;
    const it = state.item ?? {};
    setF({ name: it.name ?? '', servingLabel: it.servingLabel ?? '', servingGrams: it.servingGrams != null ? String(it.servingGrams) : '', kcal: it.kcal != null ? String(it.kcal) : '', protein_g: it.protein_g != null ? String(it.protein_g) : '', carbs_g: it.carbs_g != null ? String(it.carbs_g) : '', fat_g: it.fat_g != null ? String(it.fat_g) : '', fibre_g: it.fibre_g != null ? String(it.fibre_g) : '', sourceRef: it.sourceRef ?? '', tags: (it.tags ?? []).join(', ') });
    setReason(''); setErr('');
  }, [state]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const payload = { name: f.name, servingLabel: f.servingLabel, servingGrams: num(f.servingGrams ?? ''), kcal: num(f.kcal ?? ''), proteinG: num(f.protein_g ?? ''), carbsG: num(f.carbs_g ?? ''), fatG: num(f.fat_g ?? ''), fibreG: num(f.fibre_g ?? ''), sourceRef: f.sourceRef?.trim() || null, tags: (f.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean) };
      if (item) await api.patch(`/admin/foods/${item.id}`, { ...payload, reason });
      else await api.post(mode === 'admin' ? '/admin/foods' : '/coach/foods', mode === 'admin' && reason.trim() ? { ...payload, reason } : payload);
      toast(item ? 'Food corrected' : mode === 'admin' ? 'Food added as a draft' : 'Draft food added: usable in your plans');
      onSaved();
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <Dialog open={!!state} onClose={onClose} title={item ? `Correct ${item.name}` : mode === 'admin' ? 'Add a food' : 'Add a food (draft)'} footer={<><Button variant="tertiary" onClick={onClose}>Not now</Button><Button variant="primary" busy={busy} onClick={save}>Save</Button></>}>
    <div className="form">
      <Field label="Name"><Input value={f.name ?? ''} onChange={set('name')} /></Field>
      <div className="row"><Field label="Serving" optional hint="What the values refer to, e.g. 1 katori"><Input value={f.servingLabel ?? ''} onChange={set('servingLabel')} /></Field><Field label="Serving weight (g)" optional><Input inputMode="decimal" value={f.servingGrams ?? ''} onChange={set('servingGrams')} /></Field></div>
      <div className="row">{NUTRIENTS.map((n) => <Field key={n.key} label={`${n.label} (${n.unit})`} optional><Input inputMode="decimal" style={{ maxWidth: 110 }} value={f[n.key] ?? ''} onChange={set(n.key)} /></Field>)}</div>
      <Field label="Source" hint="Required with any value: the label, publication or table the values were read from."><Input value={f.sourceRef ?? ''} onChange={set('sourceRef')} /></Field>
      <Field label="Tags (comma separated)" optional><Input value={f.tags ?? ''} onChange={set('tags')} /></Field>
      {mode === 'admin' && <Field label={item ? 'Reason (recorded in the audit log)' : 'Reason'} optional={!item}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
      {err && <Alert kind="error">{err}</Alert>}
    </div>
  </Dialog>;
}

type Ingredient = { foodId: string; label: string; quantity: string; unit: string };

function RecipeDialog({ mode, state, foods, onClose, onSaved }: { mode: Mode; state: { item: any | null } | null; foods: any[]; onClose: () => void; onSaved: () => void }) {
  const item = state?.item ?? null;
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [method, setMethod] = useState('');
  const [servings, setServings] = useState('');
  const [prep, setPrep] = useState('');
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toast = useToast();
  useEffect(() => {
    if (!state) return;
    const it = state.item ?? {};
    setTitle(it.title ?? ''); setSummary(it.summary ?? ''); setMethod(it.method ?? ''); setServings(it.servings ? String(it.servings) : ''); setPrep(it.prepMinutes ? String(it.prepMinutes) : '');
    setIngredients((it.ingredients ?? []).map((i: any) => ({ foodId: i.foodId ?? '', label: i.label, quantity: i.quantity != null ? String(i.quantity) : '', unit: i.unit ?? '' })));
    setReason(''); setErr('');
  }, [state]);
  const setIng = (i: number, patch: Partial<Ingredient>) => setIngredients((xs) => xs.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const payload = { title, summary, method, servings: servings ? Number(servings) : null, prepMinutes: prep ? Number(prep) : null, ingredients: ingredients.filter((i) => i.label.trim()).map((i) => ({ foodId: i.foodId || null, label: i.label.trim(), quantity: i.quantity ? Number(i.quantity) : null, unit: i.unit.trim() })) };
      if (item) await api.patch(`/admin/recipes/${item.id}`, { ...payload, reason });
      else await api.post(mode === 'admin' ? '/admin/recipes' : '/coach/recipes', mode === 'admin' && reason.trim() ? { ...payload, reason } : payload);
      toast(item ? 'Recipe corrected' : 'Recipe added as a draft');
      onSaved();
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <Dialog open={!!state} onClose={onClose} title={item ? `Correct ${item.title}` : mode === 'admin' ? 'Add a recipe' : 'Add a recipe (draft)'} footer={<><Button variant="tertiary" onClick={onClose}>Not now</Button><Button variant="primary" busy={busy} onClick={save}>Save</Button></>}>
    <div className="form">
      <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Summary" optional><Input value={summary} onChange={(e) => setSummary(e.target.value)} /></Field>
      <Field label="Method" optional hint="Plain text; basic formatting is kept, anything else is removed."><Textarea value={method} onChange={(e) => setMethod(e.target.value)} /></Field>
      <div className="row"><Field label="Servings" optional hint="Needed for per-serving totals"><Input inputMode="numeric" style={{ maxWidth: 110 }} value={servings} onChange={(e) => setServings(e.target.value.replace(/\D/g, ''))} /></Field><Field label="Preparation (minutes)" optional><Input inputMode="numeric" style={{ maxWidth: 110 }} value={prep} onChange={(e) => setPrep(e.target.value.replace(/\D/g, ''))} /></Field></div>
      <div><span className="bp-label">Ingredients</span><span className="bp-hint" style={{ display: 'block' }}>Totals count an ingredient linked to a food when its quantity is in servings of that food, or in grams of a food with a serving weight.</span>
        <div className="stack" style={{ marginTop: 6 }}>{ingredients.map((i, k) => <div key={k} className="row"><Select aria-label="Food" style={{ maxWidth: 200 }} value={i.foodId} onChange={(e) => setIng(k, { foodId: e.target.value, label: i.label || (foods.find((f) => f.id === e.target.value)?.name ?? '') })}><option value="">No library food</option>{foods.filter((f) => f.status !== 'archived').map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select><Input aria-label="Ingredient" style={{ flex: '1 1 160px' }} placeholder="Ingredient" value={i.label} onChange={(e) => setIng(k, { label: e.target.value })} /><Input aria-label="Quantity" style={{ maxWidth: 90 }} inputMode="decimal" placeholder="Qty" value={i.quantity} onChange={(e) => setIng(k, { quantity: e.target.value })} /><Input aria-label="Unit" style={{ maxWidth: 120 }} placeholder="serving, g …" value={i.unit} onChange={(e) => setIng(k, { unit: e.target.value })} /><Button size="sm" variant="tertiary" aria-label="Remove ingredient" onClick={() => setIngredients((xs) => xs.filter((_, j) => j !== k))}>✕</Button></div>)}
          <div><Button size="sm" onClick={() => setIngredients((xs) => [...xs, { foodId: '', label: '', quantity: '', unit: '' }])}>Add an ingredient</Button></div></div></div>
      {mode === 'admin' && <Field label={item ? 'Reason (recorded in the audit log)' : 'Reason'} optional={!item}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
      {err && <Alert kind="error">{err}</Alert>}
    </div>
  </Dialog>;
}
