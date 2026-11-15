/* Coach › Libraries › Nutrition library (the web's /coach/nutrition-library, apps/dashboard/src/modules/nutrition/NutritionLibrary.tsx
   in coach mode): published foods and recipes plus the coach's own drafts (GET /coach/nutrition-library?status&q), and
   new drafts (POST /coach/foods, POST /coach/recipes). A nutrient value is accepted only with its source; the licensed
   dataset is named as pending. No edit or status change for a coach: the Bioptime team publishes. A recipe's image is
   shown when the team gave it one (imageUrl, a public asset); the web's coach form has no image field and the API offers
   coaches no image upload (POST /admin/assets needs content.manage), so the app's form has none either. Flag: nutrition. */
import { Stack } from 'expo-router';
import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { ApiError, errorText, get, post, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { apiBaseSync, remoteImage } from '@/lib/config';
import { label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { commaList, decimal, digits, fieldErrorsOf, libraryPill, num, useFlash, type PillTone } from '@/lib/coach/libraries/shared';
import { ingredientsLine, methodText, NUTRIENTS, nutrientLine, type Food, type Library } from '@/lib/coach/libraries/nutrition';
import { Button, ErrorBox, Field, Input, Loading, Notice, P, Row, Screen, StaleBanner, Title } from '@/components/ui';
import { EmptyState, FilterChips, KeyValue, RecordList, RecordRow, SearchBar, SegmentTabs, Sheet } from '@/components/workspace';
import { NotificationBell, RoleGate } from '@/components/workspaceShell';
import { ModuleGate } from '@/components/coachLibraries/ModuleGate';
import { SelectField } from '@/components/coachLibraries/SelectField';
import { Enter } from '@/motion';
import { colors, radius, space } from '@/theme';

const TITLE = 'Nutrition library';

export default function NutritionLibraryScreen() {
  return <>
    <Stack.Screen options={{ title: TITLE, headerRight: () => <NotificationBell /> }} />
    <RoleGate workspace="coach"><ModuleGate flag="nutrition" title={TITLE}><Body /></ModuleGate></RoleGate>
  </>;
}

function useDebounced(value: string, ms = 350): string {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

function Body() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'foods' | 'recipes'>('foods');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim());
  const lib = useLoad<Library>(`coach.nutrition-library.${status}.${query}`, () => get(`/coach/nutrition-library${qs({ status: status || undefined, q: query || undefined })}`), [status, query]);
  const [open, setOpen] = useState<string | null>(null);
  const [foodForm, setFoodForm] = useState(false);
  const [recipeForm, setRecipeForm] = useState(false);
  const { flash, ok, clear } = useFlash();
  const d = lib.data;
  const foods = d?.foods ?? [];
  const recipes = d?.recipes ?? [];
  const mine = (it: { createdBy: string | null; status: string }) => it.createdBy === user?.id && it.status === 'draft';
  const pills = (it: { createdBy: string | null; status: string }): Array<{ label: string; tone?: PillTone }> => { const p = libraryPill(it.status); return mine(it) ? [{ label: p.label, tone: p.tone }, { label: 'my draft', tone: 'info' }] : [{ label: p.label, tone: p.tone }]; };
  return <Screen refreshing={lib.loading} onRefresh={lib.reload}>
    <Enter><Title sub="Published foods and recipes, and your own drafts. Your drafts are usable in your plans; the Bioptime team publishes them for everyone.">{TITLE}</Title></Enter>
    <Enter index={1}><Row><Button title="Add recipe (draft)" variant="secondary" small onPress={() => { clear(); setRecipeForm(true); }} /><Button title="Add food (draft)" small onPress={() => { clear(); setFoodForm(true); }} /></Row></Enter>
    {flash ? <Notice kind={flash.kind}>{flash.text}</Notice> : null}
    <Enter index={2}><Notice kind="info" title="Nutrient values need a source">Enter energy, protein, carbohydrate, fat or fibre only from a source you can name, such as the food's label or a published composition table, and write it in Source. Leave them empty otherwise: plans then show the meal without values and mark the day's totals incomplete.</Notice></Enter>
    {d && !d.licensedDataset.configured ? <Notice kind="warning" title="Pending configuration: licensed food dataset">{`${d.licensedDataset.missing}.`}</Notice> : null}
    <SearchBar value={q} onChangeText={setQ} placeholder="Name or title" />
    <FilterChips options={[{ value: '', label: 'Any' }, { value: 'published', label: 'Published' }, { value: 'draft', label: 'Draft' }]} value={status} onChange={(v) => setStatus(String(v))} />
    <StaleBanner at={lib.stale} />
    <ErrorBox error={lib.error} onRetry={lib.reload} />
    {lib.loading && !d ? <Loading /> : d ? <View style={{ gap: space.md }}>
      <SegmentTabs items={[{ id: 'foods', label: 'Foods', count: foods.length }, { id: 'recipes', label: 'Recipes', count: recipes.length }]} value={tab} onChange={(id) => setTab(id as 'foods' | 'recipes')} />
      {tab === 'foods' ? (foods.length ? <RecordList title="Foods">
        {foods.map((f) => {
          const expanded = open === f.id;
          return <View key={f.id}>
            <RecordRow title={f.name} meta={`${f.servingLabel ? `${f.servingLabel}${f.servingGrams ? ` (${f.servingGrams} g)` : ''} · ` : f.servingGrams ? `${f.servingGrams} g · ` : ''}${nutrientLine(f)}`} pills={pills(f)} selected={expanded} onPress={() => setOpen(expanded ? null : f.id)} />
            {expanded ? <View style={{ paddingVertical: space.sm }}><KeyValue rows={[['Serving', `${f.servingLabel || '—'}${f.servingGrams ? ` · ${f.servingGrams} g` : ''}`], ['Values per serving', nutrientLine(f)], ['Source', `${label(f.source)}${f.sourceRef ? ` · ${f.sourceRef}` : ''}`], ['Tags', f.tags.length ? f.tags.join(', ') : '—']]} /></View> : null}
          </View>;
        })}
      </RecordList> : <EmptyState title="No foods" body="Nothing is published yet. Add a draft for your own plans." icon="nutrition-outline" />)
      : (recipes.length ? <RecordList title="Recipes">
        {recipes.map((r) => {
          const expanded = open === r.id;
          return <View key={r.id}>
            <RecordRow title={r.title} meta={ingredientsLine(r.ingredients)} pills={pills(r)} selected={expanded} onPress={() => setOpen(expanded ? null : r.id)} leading={r.imageUrl ? <Image source={remoteImage(`${apiBaseSync()}${r.imageUrl}`)} accessibilityLabel={`Image of ${r.title}`} contentFit="cover" style={{ width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.raised }} /> : undefined} />
            {expanded ? <View style={{ paddingVertical: space.sm, gap: space.sm }}>
              {r.summary ? <P muted small>{r.summary}</P> : null}
              <KeyValue rows={[['Ingredients', ingredientsLine(r.ingredients)], ['Servings', r.servings ?? '—'], ['Preparation', r.prepMinutes ? `${r.prepMinutes} min` : '—'], ['Source', label(r.source)], ['Tags', r.tags.length ? r.tags.join(', ') : '—']]} />
              {methodText(r.method) ? <P small>{methodText(r.method)}</P> : null}
            </View> : null}
          </View>;
        })}
      </RecordList> : <EmptyState title="No recipes" icon="restaurant-outline" />)}
    </View> : null}
    <FoodSheet open={foodForm} onClose={() => setFoodForm(false)} onSaved={() => { setFoodForm(false); ok('Draft food added: usable in your plans'); void lib.reload(); }} />
    <RecipeSheet open={recipeForm} foods={foods} onClose={() => setRecipeForm(false)} onSaved={() => { setRecipeForm(false); ok('Recipe added as a draft'); void lib.reload(); }} />
  </Screen>;
}

/* ---------- the food form (the web's FoodDialog, foodInputSchema) ---------- */

type FoodDraft = { name: string; servingLabel: string; servingGrams: string; kcal: string; protein_g: string; carbs_g: string; fat_g: string; fibre_g: string; sourceRef: string; tags: string };
const EMPTY_FOOD: FoodDraft = { name: '', servingLabel: '', servingGrams: '', kcal: '', protein_g: '', carbs_g: '', fat_g: '', fibre_g: '', sourceRef: '', tags: '' };

/** The schema's rules before anything is sent (packages/domain nutrition.ts foodInputSchema and the server's SOURCE_REQUIRED). */
function checkFood(f: FoodDraft): Record<string, string> {
  const e: Record<string, string> = {};
  const name = f.name.trim();
  if (name.length < 2) e.name = 'At least 2 characters.'; else if (name.length > 120) e.name = 'At most 120 characters.';
  if (f.servingLabel.length > 80) e.servingLabel = 'At most 80 characters.';
  const g = num(f.servingGrams);
  if (g !== null && !(g > 0 && g <= 10000)) e.servingGrams = 'A weight above 0 and up to 10000 g.';
  for (const n of NUTRIENTS) { const v = num(f[n.key]); if (v !== null && !(v >= 0 && v <= 100000)) e[n.body] = 'A number from 0 to 100000.'; }
  if (f.sourceRef.trim().length > 300) e.sourceRef = 'At most 300 characters.';
  const anyValue = g !== null || NUTRIENTS.some((n) => num(f[n.key]) !== null);
  if (anyValue && f.sourceRef.trim().length < 3) e.sourceRef = 'Required with any value: the label, publication or table the values were read from.';
  const tags = commaList(f.tags);
  if (tags.length > 20) e.tags = 'At most 20 tags.'; else if (tags.some((t) => t.length > 40)) e.tags = 'Each tag at most 40 characters.';
  return e;
}

function FoodSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<FoodDraft>(EMPTY_FOOD);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const set = (k: keyof FoodDraft, clean?: (v: string) => string) => (v: string) => setF((x) => ({ ...x, [k]: clean ? clean(v) : v }));
  const save = async () => {
    setErr(null);
    const own = checkFood(f);
    setErrs(own);
    if (Object.keys(own).length) return;
    setBusy(true);
    try {
      await post('/coach/foods', { name: f.name.trim(), servingLabel: f.servingLabel.trim(), servingGrams: num(f.servingGrams), kcal: num(f.kcal), proteinG: num(f.protein_g), carbsG: num(f.carbs_g), fatG: num(f.fat_g), fibreG: num(f.fibre_g), sourceRef: f.sourceRef.trim() || null, tags: commaList(f.tags) });
      onSaved(); setF(EMPTY_FOOD); setErrs({});
    } catch (e) {
      const fe = fieldErrorsOf(e);
      if (e instanceof ApiError && e.code === 'SOURCE_REQUIRED') fe.sourceRef = e.message;
      setErrs(fe); setErr(errorText(e));
    } finally { setBusy(false); }
  };
  return <Sheet open={open} onClose={onClose} title="Add a food (draft)" footer={<Row><Button title="Not now" variant="secondary" small onPress={onClose} disabled={busy} /><Button title="Save" small busy={busy} onPress={save} /></Row>}>
    <Field label="Name" error={errs.name}><Input value={f.name} onChangeText={set('name')} maxLength={120} accessibilityLabel="Name" /></Field>
    <Field label="Serving" hint="Optional. What the values refer to, e.g. 1 katori" error={errs.servingLabel}><Input value={f.servingLabel} onChangeText={set('servingLabel')} maxLength={80} accessibilityLabel="Serving" /></Field>
    <Field label="Serving weight (g)" hint="Optional" error={errs.servingGrams}><Input value={f.servingGrams} onChangeText={set('servingGrams', decimal)} keyboardType="decimal-pad" accessibilityLabel="Serving weight (g)" /></Field>
    {NUTRIENTS.map((n) => <Field key={n.key} label={`${n.label} (${n.unit})`} hint="Optional" error={errs[n.body]}><Input value={f[n.key]} onChangeText={set(n.key, decimal)} keyboardType="decimal-pad" accessibilityLabel={`${n.label} (${n.unit})`} /></Field>)}
    <Field label="Source" hint="Required with any value: the label, publication or table the values were read from." error={errs.sourceRef}><Input value={f.sourceRef} onChangeText={set('sourceRef')} maxLength={300} accessibilityLabel="Source" /></Field>
    <Field label="Tags (comma separated)" hint="Optional" error={errs.tags}><Input value={f.tags} onChangeText={set('tags')} accessibilityLabel="Tags (comma separated)" /></Field>
    {err ? <Notice kind="error">{err}</Notice> : null}
  </Sheet>;
}

/* ---------- the recipe form (the web's RecipeDialog, recipeInputSchema) ---------- */

type IngredientDraft = { foodId: string; label: string; quantity: string; unit: string };
const EMPTY_RECIPE = { title: '', summary: '', method: '', servings: '', prep: '' };

function checkRecipe(r: typeof EMPTY_RECIPE, ings: IngredientDraft[]): Record<string, string> {
  const e: Record<string, string> = {};
  const title = r.title.trim();
  if (title.length < 2) e.title = 'At least 2 characters.'; else if (title.length > 160) e.title = 'At most 160 characters.';
  if (r.summary.trim().length > 600) e.summary = 'At most 600 characters.';
  if (r.method.length > 10000) e.method = 'At most 10000 characters.';
  const s = num(r.servings);
  if (s !== null && !(Number.isInteger(s) && s >= 1 && s <= 100)) e.servings = 'A whole number from 1 to 100.';
  const p = num(r.prep);
  if (p !== null && !(Number.isInteger(p) && p >= 1 && p <= 1440)) e.prepMinutes = 'A whole number of minutes from 1 to 1440.';
  const kept = ings.filter((i) => i.label.trim());
  if (kept.length > 60) e.ingredients = 'At most 60 ingredients.';
  for (const i of kept) {
    if (i.label.trim().length > 120) { e.ingredients = 'An ingredient name is at most 120 characters.'; break; }
    const q = num(i.quantity);
    if (q !== null && !(q > 0 && q <= 100000)) { e.ingredients = `“${i.label.trim()}”: a quantity above 0 and up to 100000.`; break; }
    if (i.unit.trim().length > 20) { e.ingredients = `“${i.label.trim()}”: a unit of at most 20 characters.`; break; }
  }
  return e;
}

function RecipeSheet({ open, foods, onClose, onSaved }: { open: boolean; foods: Food[]; onClose: () => void; onSaved: () => void }) {
  const [r, setR] = useState(EMPTY_RECIPE);
  const [ings, setIngs] = useState<IngredientDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const set = (k: keyof typeof EMPTY_RECIPE, clean?: (v: string) => string) => (v: string) => setR((x) => ({ ...x, [k]: clean ? clean(v) : v }));
  const setIng = (i: number, patch: Partial<IngredientDraft>) => setIngs((xs) => xs.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const reset = () => { setR(EMPTY_RECIPE); setIngs([]); setErrs({}); setErr(null); };
  const save = async () => {
    setErr(null);
    const own = checkRecipe(r, ings);
    setErrs(own);
    if (Object.keys(own).length) return;
    setBusy(true);
    try {
      await post('/coach/recipes', {
        title: r.title.trim(), summary: r.summary.trim(), method: r.method, servings: num(r.servings), prepMinutes: num(r.prep),
        ingredients: ings.filter((i) => i.label.trim()).map((i) => ({ foodId: i.foodId || null, label: i.label.trim(), quantity: num(i.quantity), unit: i.unit.trim() })),
      });
      onSaved(); reset();
    } catch (e) { setErrs(fieldErrorsOf(e)); setErr(errorText(e)); }
    finally { setBusy(false); }
  };
  const foodOptions = [{ value: '', label: 'No library food' }, ...foods.filter((f) => f.status !== 'archived').map((f) => ({ value: f.id, label: f.name, detail: f.servingLabel || undefined }))];
  return <Sheet open={open} onClose={onClose} title="Add a recipe (draft)" footer={<Row><Button title="Not now" variant="secondary" small onPress={onClose} disabled={busy} /><Button title="Save" small busy={busy} onPress={save} /></Row>}>
    <Field label="Title" error={errs.title}><Input value={r.title} onChangeText={set('title')} maxLength={160} accessibilityLabel="Title" /></Field>
    <Field label="Summary" hint="Optional" error={errs.summary}><Input value={r.summary} onChangeText={set('summary')} maxLength={600} accessibilityLabel="Summary" /></Field>
    <Field label="Method" hint="Optional. Plain text; basic formatting is kept, anything else is removed." error={errs.method}><Input value={r.method} onChangeText={set('method')} multiline numberOfLines={4} style={{ minHeight: 96, textAlignVertical: 'top' }} accessibilityLabel="Method" /></Field>
    <Field label="Servings" hint="Optional. Needed for per-serving totals" error={errs.servings}><Input value={r.servings} onChangeText={set('servings', digits)} keyboardType="number-pad" accessibilityLabel="Servings" /></Field>
    <Field label="Preparation (minutes)" hint="Optional" error={errs.prepMinutes}><Input value={r.prep} onChangeText={set('prep', digits)} keyboardType="number-pad" accessibilityLabel="Preparation (minutes)" /></Field>
    <Field label="Ingredients" hint="Totals count an ingredient linked to a food when its quantity is in servings of that food, or in grams of a food with a serving weight." error={errs.ingredients}>
      <View style={{ gap: space.sm }}>
        {ings.map((i, k) => <View key={k} style={{ gap: space.sm, padding: space.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }}>
          <SelectField compact label={`Food of ingredient ${k + 1}`} title="Food" value={i.foodId} options={foodOptions} searchable onChange={(v) => setIng(k, { foodId: v, label: i.label || (foods.find((f) => f.id === v)?.name ?? '') })} />
          <Input value={i.label} onChangeText={(v) => setIng(k, { label: v })} placeholder="Ingredient" accessibilityLabel={`Ingredient ${k + 1}`} maxLength={120} />
          <Row>
            <View style={{ flex: 1 }}><Input value={i.quantity} onChangeText={(v) => setIng(k, { quantity: decimal(v) })} placeholder="Qty" keyboardType="decimal-pad" accessibilityLabel={`Quantity ${k + 1}`} /></View>
            <View style={{ flex: 1 }}><Input value={i.unit} onChangeText={(v) => setIng(k, { unit: v })} placeholder="serving, g …" accessibilityLabel={`Unit ${k + 1}`} maxLength={20} /></View>
            <Button title="✕" variant="ghost" small onPress={() => setIngs((xs) => xs.filter((_, j) => j !== k))} />
          </Row>
        </View>)}
        <Row><Button title="Add an ingredient" variant="secondary" small onPress={() => setIngs((xs) => [...xs, { foodId: '', label: '', quantity: '', unit: '' }])} /></Row>
      </View>
    </Field>
    {err ? <Notice kind="error">{err}</Notice> : null}
  </Sheet>;
}

