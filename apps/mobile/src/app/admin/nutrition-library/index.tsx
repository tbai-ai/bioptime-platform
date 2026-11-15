/* Admin › Nutrition library (the web's /admin/nutrition-library, modules/nutrition/NutritionLibrary.tsx admin mode;
   nutrition module, library.manage): every food and recipe the coaches use in meal plans, with corrections and
   publishing, each recorded with its reason. A nutrient value is accepted only with the source it was read from; no
   licensed food dataset and no automatic estimate exist yet, and both are shown as pending configuration.
   GET /admin/foods?status&q and GET /admin/recipes?status&q → { items, licensedDataset, estimates };
   POST /admin/foods|recipes, PATCH …/:id { …, reason }, POST …/:id/status { status, reason }. */
import React, { useState } from 'react';
import { View } from 'react-native';
import { get, post, qs } from '@/lib/api';
import { label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { ingredientsLine, nutrientLine, type Food, type Recipe } from '@/lib/coach/libraries/nutrition';
import { nutritionStatusDialog, type FoodList, type RecipeList } from '@/lib/admin/modules2/libraries';
import { ReasonSheet } from '@/components/adminA/ReasonSheet';
import { useToast } from '@/components/adminA/toast';
import { statusToneOf } from '@/components/coachModules/shared';
import { Button, Card, ErrorBox, Loading, Notice, Row, Screen, StaleBanner, Title } from '@/components/ui';
import { EmptyState, FilterChips, RecordList, SearchBar, SegmentTabs } from '@/components/workspace';
import { AdminModuleGate, ItemRow, useDebounced } from '@/components/adminModules2/frame';
import { FoodSheet, RecipeSheet } from '@/components/adminModules2/nutrition';
import { Enter } from '@/motion';

const TITLE = 'Nutrition library';
const STATUSES = [{ value: '', label: 'Any' }, { value: 'published', label: 'Published' }, { value: 'draft', label: 'Draft' }, { value: 'archived', label: 'Archived' }];
type StatusFor = { kind: 'foods' | 'recipes'; item: Food | Recipe; to: string };

export default function AdminNutritionLibraryScreen() {
  return <AdminModuleGate title={TITLE} module="nutrition" permission="library.manage"><Body /></AdminModuleGate>;
}

function Body() {
  const toast = useToast();
  const [tab, setTab] = useState<'foods' | 'recipes'>('foods');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const search = useDebounced(q.trim());
  const query = qs({ status, q: search });
  const foods = useLoad<FoodList>(`admin-foods${query}`, () => get(`/admin/foods${query}`), [query]);
  const recipes = useLoad<RecipeList>(`admin-recipes${query}`, () => get(`/admin/recipes${query}`), [query]);
  const [foodForm, setFoodForm] = useState<{ item: Food | null } | null>(null);
  const [recipeForm, setRecipeForm] = useState<{ item: Recipe | null } | null>(null);
  const [statusFor, setStatusFor] = useState<StatusFor | null>(null);
  const reload = () => { void foods.reload(); void recipes.reload(); };
  const foodItems = foods.data?.items ?? [];
  const recipeItems = recipes.data?.items ?? [];
  const pending = foods.data;
  const loaded = !!foods.data && !!recipes.data;
  const dlg = statusFor ? nutritionStatusDialog(statusFor.to, 'name' in statusFor.item ? statusFor.item.name : statusFor.item.title) : null;
  const statusButtons = (kind: 'foods' | 'recipes', item: Food | Recipe) => <>
    {item.status !== 'published' ? <Button title="Publish" variant="secondary" small onPress={() => setStatusFor({ kind, item, to: 'published' })} /> : null}
    {item.status === 'published' ? <Button title="Unpublish" variant="ghost" small onPress={() => setStatusFor({ kind, item, to: 'draft' })} /> : null}
    {item.status !== 'archived' ? <Button title="Archive" variant="ghost" small onPress={() => setStatusFor({ kind, item, to: 'archived' })} /> : null}
  </>;
  return <View style={{ flex: 1 }}><Screen refreshing={foods.loading || recipes.loading} onRefresh={reload}>
    <Enter><Title sub="Foods and recipes the coaches use in meal plans. Publish an item once it is checked against its source; every change is recorded with its reason.">{TITLE}</Title></Enter>
    <Enter index={1}><Row><Button title="Add recipe" variant="secondary" small onPress={() => setRecipeForm({ item: null })} /><Button title="Add food" small onPress={() => setFoodForm({ item: null })} /></Row></Enter>
    <Notice kind="info" title="Nutrient values need a source">{"Enter energy, protein, carbohydrate, fat or fibre only from a source you can name, such as the food's label or a published composition table, and write it in Source. Leave them empty otherwise: plans then show the meal without values and mark the day's totals incomplete."}</Notice>
    {pending?.licensedDataset && !pending.licensedDataset.configured ? <Notice kind="warning" title="Pending configuration: licensed food dataset">{`${pending.licensedDataset.missing}.`}</Notice> : null}
    {pending?.estimates && !pending.estimates.configured ? <Notice kind="warning" title="Pending configuration: automatic estimates">{`${pending.estimates.missing}.`}</Notice> : null}
    <SearchBar value={q} onChangeText={setQ} placeholder="Name or title" />
    <FilterChips options={STATUSES} value={status} onChange={(v) => setStatus(String(v))} />
    <StaleBanner at={foods.stale ?? recipes.stale} />
    <ErrorBox error={foods.error ?? recipes.error} onRetry={reload} />
    {!loaded ? (foods.error || recipes.error ? null : <Loading />) : <>
      <SegmentTabs items={[{ id: 'foods', label: `Foods (${foodItems.length})` }, { id: 'recipes', label: `Recipes (${recipeItems.length})` }]} value={tab} onChange={(v) => setTab(v as 'foods' | 'recipes')} />
      {tab === 'foods' ? (foodItems.length ? <RecordList title="Foods">
        {foodItems.map((f) => <ItemRow key={f.id} title={f.name} lines={[
            f.tags?.length ? f.tags.join(', ') : null,
            `Serving: ${f.servingLabel || '—'}${f.servingGrams ? ` · ${f.servingGrams} g` : ''}`,
            `Values per serving: ${nutrientLine(f as unknown as Record<string, unknown>)}`,
            `Source: ${label(f.source)}${f.sourceRef ? ` · ${f.sourceRef}` : ''}`,
          ]} pills={[{ label: label(f.status), tone: statusToneOf(f.status) }]}
          actions={<><Button title="Edit" variant="ghost" small onPress={() => setFoodForm({ item: f })} />{statusButtons('foods', f)}</>} />)}
      </RecordList> : <Card><EmptyState title="No foods" body="Add the first one." /></Card>)
      : (recipeItems.length ? <RecordList title="Recipes">
        {recipeItems.map((r) => <ItemRow key={r.id} title={r.title} lines={[
            r.summary || null,
            `Ingredients: ${ingredientsLine(r.ingredients)}`,
            `Servings: ${r.servings ?? '—'}${r.prepMinutes ? ` · ${r.prepMinutes} min` : ''}`,
            `Source: ${label(r.source)}`,
          ]} pills={[{ label: label(r.status), tone: statusToneOf(r.status) }]}
          actions={<><Button title="Edit" variant="ghost" small onPress={() => setRecipeForm({ item: r })} />{statusButtons('recipes', r)}</>} />)}
      </RecordList> : <Card><EmptyState title="No recipes" /></Card>)}
    </>}
    <FoodSheet state={foodForm} onClose={() => setFoodForm(null)} onSaved={(msg) => { toast.show(msg); reload(); }} />
    <RecipeSheet state={recipeForm} foods={foodItems} onClose={() => setRecipeForm(null)} onSaved={(msg) => { toast.show(msg); reload(); }} />
    <ReasonSheet open={!!statusFor} onClose={() => setStatusFor(null)} title={dlg?.title ?? ''} body={dlg?.body} confirmLabel={dlg?.confirm ?? 'Confirm'} destructive={!!dlg?.danger}
      onConfirm={async (reason) => { const s = statusFor; if (!s) return; await post(`/admin/${s.kind}/${s.item.id}/status`, { status: s.to, reason }); toast.show('Status changed'); reload(); }} />
  </Screen>{toast.float}</View>;
}
