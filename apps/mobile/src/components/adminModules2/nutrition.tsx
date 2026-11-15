/* M5 Nutrition, the library in its admin mode (library.manage): the food and the recipe sheets (the web's FoodDialog and
   RecipeDialog, apps/dashboard/src/modules/nutrition/NutritionLibrary.tsx:76-158, admin mode). A correction asks for a
   reason (recorded in the audit log); a new item may carry one. A nutrient value is accepted only with its source; the
   server checks that and answers in plain words, shown here. */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { ApiError, errorText, patch, post } from '@/lib/api';
import { NUTRIENTS, type Food, type Recipe } from '@/lib/coach/libraries/nutrition';
import { commaList, decimal, digits, parseNum } from '@/lib/admin/modules2/libraries';
import { SelectField } from '@/components/coachLibraries/SelectField';
import { Button, Field, Input, Notice, Row } from '@/components/ui';
import { Sheet } from '@/components/workspace';
import { IconButton } from './frame';
import { colors, radius, space } from '@/theme';

const area = { minHeight: 72, textAlignVertical: 'top' as const };
const REASON = 'Reason (recorded in the audit log)';

type FoodDraft = Record<'name' | 'servingLabel' | 'servingGrams' | 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fibre_g' | 'sourceRef' | 'tags', string>;

export function FoodSheet({ state, onClose, onSaved }: { state: { item: Food | null } | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const item = state?.item ?? null;
  const [f, setF] = useState<FoodDraft | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!state) return;
    const it = state.item;
    const s = (v: number | null | undefined) => (v != null ? String(v) : '');
    setF({ name: it?.name ?? '', servingLabel: it?.servingLabel ?? '', servingGrams: s(it?.servingGrams), kcal: s(it?.kcal), protein_g: s(it?.protein_g), carbs_g: s(it?.carbs_g), fat_g: s(it?.fat_g), fibre_g: s(it?.fibre_g), sourceRef: it?.sourceRef ?? '', tags: (it?.tags ?? []).join(', ') });
    setReason(''); setErr(''); setErrs({});
  }, [state]);
  const set = (k: keyof FoodDraft) => (v: string) => setF((x) => (x ? { ...x, [k]: v } : x));
  const save = async () => {
    if (!f) return;
    const nums = { servingGrams: parseNum(f.servingGrams), kcal: parseNum(f.kcal), proteinG: parseNum(f.protein_g), carbsG: parseNum(f.carbs_g), fatG: parseNum(f.fat_g), fibreG: parseNum(f.fibre_g) };
    const bad = Object.entries(nums).filter(([, v]) => v.bad).map(([k]) => k);
    if (bad.length) { setErrs(Object.fromEntries(bad.map((k) => [k, 'Write a number, like 12.5']))); return; }
    setBusy(true); setErr(''); setErrs({});
    try {
      const payload = { name: f.name, servingLabel: f.servingLabel, servingGrams: nums.servingGrams.value, kcal: nums.kcal.value, proteinG: nums.proteinG.value, carbsG: nums.carbsG.value, fatG: nums.fatG.value, fibreG: nums.fibreG.value, sourceRef: f.sourceRef.trim() || null, tags: commaList(f.tags) };
      if (item) await patch(`/admin/foods/${item.id}`, { ...payload, reason });
      else await post('/admin/foods', reason.trim() ? { ...payload, reason } : payload);
      onSaved(item ? 'Food corrected' : 'Food added as a draft'); onClose();
    } catch (e) { if (e instanceof ApiError) setErrs(e.fieldErrors()); setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <Sheet open={!!state} onClose={onClose} title={item ? `Correct ${item.name}` : 'Add a food'} footer={<Row><Button title="Not now" variant="ghost" onPress={onClose} disabled={busy} /><Button title="Save" busy={busy} onPress={save} style={{ flex: 1 }} /></Row>}>
    {f ? <>
      <Field label="Name" error={errs.name}><Input value={f.name} maxLength={120} onChangeText={set('name')} accessibilityLabel="Name" /></Field>
      <Field label="Serving (optional)" hint="What the values refer to, e.g. 1 katori" error={errs.servingLabel}><Input value={f.servingLabel} maxLength={80} onChangeText={set('servingLabel')} accessibilityLabel="Serving" /></Field>
      <Field label="Serving weight (g) (optional)" error={errs.servingGrams}><Input value={f.servingGrams} keyboardType="decimal-pad" onChangeText={(v) => set('servingGrams')(decimal(v))} accessibilityLabel="Serving weight (g)" /></Field>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.md }}>
        {NUTRIENTS.map((n) => <View key={n.key} style={{ width: '47%' }}><Field label={`${n.label} (${n.unit}) (optional)`} error={errs[n.body]}><Input value={f[n.key]} keyboardType="decimal-pad" onChangeText={(v) => set(n.key)(decimal(v))} accessibilityLabel={`${n.label} (${n.unit})`} /></Field></View>)}
      </View>
      <Field label="Source" hint="Required with any value: the label, publication or table the values were read from." error={errs.sourceRef}><Input value={f.sourceRef} maxLength={300} onChangeText={set('sourceRef')} accessibilityLabel="Source" /></Field>
      <Field label="Tags (comma separated) (optional)" error={errs.tags}><Input value={f.tags} onChangeText={set('tags')} accessibilityLabel="Tags (comma separated)" /></Field>
      <Field label={item ? REASON : 'Reason (optional)'} error={errs.reason}><Input value={reason} onChangeText={setReason} multiline style={area} accessibilityLabel={item ? REASON : 'Reason'} /></Field>
      {err ? <Notice kind="error">{err}</Notice> : null}
    </> : null}
  </Sheet>;
}

type Ingredient = { foodId: string; label: string; quantity: string; unit: string };

export function RecipeSheet({ state, foods, onClose, onSaved }: { state: { item: Recipe | null } | null; foods: Food[]; onClose: () => void; onSaved: (msg: string) => void }) {
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
  const [errs, setErrs] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!state) return;
    const it = state.item;
    setTitle(it?.title ?? ''); setSummary(it?.summary ?? ''); setMethod(it?.method ?? ''); setServings(it?.servings ? String(it.servings) : ''); setPrep(it?.prepMinutes ? String(it.prepMinutes) : '');
    setIngredients((it?.ingredients ?? []).map((i) => ({ foodId: i.foodId ?? '', label: i.label, quantity: i.quantity != null ? String(i.quantity) : '', unit: i.unit ?? '' })));
    setReason(''); setErr(''); setErrs({});
  }, [state]);
  const setIng = (i: number, p: Partial<Ingredient>) => setIngredients((xs) => xs.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const save = async () => {
    const qtyBad = ingredients.some((i) => parseNum(i.quantity).bad);
    if (qtyBad) { setErrs({ ingredients: 'Write each quantity as a number, like 1.5' }); return; }
    setBusy(true); setErr(''); setErrs({});
    try {
      const payload = { title, summary, method, servings: servings ? Number(servings) : null, prepMinutes: prep ? Number(prep) : null, ingredients: ingredients.filter((i) => i.label.trim()).map((i) => ({ foodId: i.foodId || null, label: i.label.trim(), quantity: parseNum(i.quantity).value, unit: i.unit.trim() })) };
      if (item) await patch(`/admin/recipes/${item.id}`, { ...payload, reason });
      else await post('/admin/recipes', reason.trim() ? { ...payload, reason } : payload);
      onSaved(item ? 'Recipe corrected' : 'Recipe added as a draft'); onClose();
    } catch (e) { if (e instanceof ApiError) setErrs(e.fieldErrors()); setErr(errorText(e)); } finally { setBusy(false); }
  };
  const foodOptions = [{ value: '', label: 'No library food' }, ...foods.filter((x) => x.status !== 'archived').map((x) => ({ value: x.id, label: x.name }))];
  return <Sheet open={!!state} onClose={onClose} title={item ? `Correct ${item.title}` : 'Add a recipe'} footer={<Row><Button title="Not now" variant="ghost" onPress={onClose} disabled={busy} /><Button title="Save" busy={busy} onPress={save} style={{ flex: 1 }} /></Row>}>
    <Field label="Title" error={errs.title}><Input value={title} maxLength={160} onChangeText={setTitle} accessibilityLabel="Title" /></Field>
    <Field label="Summary (optional)" error={errs.summary}><Input value={summary} maxLength={600} onChangeText={setSummary} accessibilityLabel="Summary" /></Field>
    <Field label="Method (optional)" hint="Plain text; basic formatting is kept, anything else is removed." error={errs.method}><Input value={method} maxLength={10000} onChangeText={setMethod} multiline style={{ minHeight: 100, textAlignVertical: 'top' }} accessibilityLabel="Method" /></Field>
    <Row>
      <View style={{ flex: 1 }}><Field label="Servings (optional)" hint="Needed for per-serving totals" error={errs.servings}><Input value={servings} keyboardType="number-pad" maxLength={3} onChangeText={(v) => setServings(digits(v))} accessibilityLabel="Servings" /></Field></View>
      <View style={{ flex: 1 }}><Field label="Preparation (minutes) (optional)" error={errs.prepMinutes}><Input value={prep} keyboardType="number-pad" maxLength={4} onChangeText={(v) => setPrep(digits(v))} accessibilityLabel="Preparation (minutes)" /></Field></View>
    </Row>
    <Field label="Ingredients" hint="Totals count an ingredient linked to a food when its quantity is in servings of that food, or in grams of a food with a serving weight." error={errs.ingredients}>
      <View style={{ gap: space.sm }}>
        {ingredients.map((i, k) => <View key={k} style={{ backgroundColor: colors.base, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.sm, gap: space.sm }}>
          <Row style={{ flexWrap: 'nowrap' }}>
            <View style={{ flex: 1 }}><SelectField compact searchable label="Food" title="Food" value={i.foodId} options={foodOptions} onChange={(v) => setIng(k, { foodId: v, label: i.label || (foods.find((x) => x.id === v)?.name ?? '') })} /></View>
            <IconButton icon="close" label="Remove ingredient" onPress={() => setIngredients((xs) => xs.filter((_, j) => j !== k))} />
          </Row>
          <Input value={i.label} placeholder="Ingredient" maxLength={120} onChangeText={(v) => setIng(k, { label: v })} accessibilityLabel="Ingredient" />
          <Row style={{ flexWrap: 'nowrap' }}>
            <View style={{ flex: 1 }}><Input value={i.quantity} placeholder="Qty" keyboardType="decimal-pad" onChangeText={(v) => setIng(k, { quantity: decimal(v) })} accessibilityLabel="Quantity" /></View>
            <View style={{ flex: 1 }}><Input value={i.unit} placeholder="serving, g …" maxLength={20} onChangeText={(v) => setIng(k, { unit: v })} accessibilityLabel="Unit" /></View>
          </Row>
        </View>)}
        <Button title="Add an ingredient" variant="secondary" small onPress={() => setIngredients((xs) => [...xs, { foodId: '', label: '', quantity: '', unit: '' }])} style={{ alignSelf: 'flex-start' }} />
      </View>
    </Field>
    <Field label={item ? REASON : 'Reason (optional)'} error={errs.reason}><Input value={reason} onChangeText={setReason} multiline style={area} accessibilityLabel={item ? REASON : 'Reason'} /></Field>
    {err ? <Notice kind="error">{err}</Notice> : null}
  </Sheet>;
}
