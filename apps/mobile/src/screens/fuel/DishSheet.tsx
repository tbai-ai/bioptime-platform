/* The dish sheet (the earlier app's portion sheet, 55-fuel-portion-sheet / 56-fuel-portion-1.5-selected): the dish's
   picture, its name and serving, the recipe's summary, the value panel (calories over protein · carbs · fat · fibre in
   their colours, each times the chosen portion, counting to the new value; a value nobody entered stays "—"), where
   the values come from, a recipe's method (as the Bioptime team wrote it), the portion on the red sliding segment (half, 1, 1.5 or 2 servings), which meal it was, and the
   white pill "Log this meal" (POST /me/meal-logs with the dish and the portion: an extra meal, or what was eaten instead
   of a planned one when the sheet was opened for a swap). Nothing is estimated. */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, CountUp, FONTS, FilterChip, Notice, Segmented, T, fx, haptics, typeScale } from '@/fx';
import { errorText, post } from '@/lib/api';
import { DishThumb } from './DishThumb';
import { Heart } from './DishCard';
import { MACRO, PORTIONS, SLOTS, SLOT_LABEL, dishIcon, dishName, has, methodText, num, scaled, servingText, slotForNow } from './format';
import type { Dish, MealLog, MealSlotName, NutrientKey, PlanSlot, Portion } from './types';

export type DishMode = { swapFor?: PlanSlot | null };

export function DishSheetBody({ dish, today, mode, saved, onToggleSave, onLogged }: {
  dish: Dish; today: string; mode: DishMode; saved: boolean; onToggleSave: () => void; onLogged: (log: MealLog, name: string) => void;
}) {
  const name = dishName(dish);
  const [portion, setPortion] = useState<Portion>(1);
  const [slot, setSlot] = useState<MealSlotName>(mode.swapFor?.slot ?? slotForNow());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const v = scaled(dish.perServing, portion);
  const swap = mode.swapFor ?? null;
  const method = dish.kind === 'recipe' ? methodText(dish.method) : '';

  const log = async () => {
    setBusy(true); setError(null);
    try {
      const body = {
        date: today, portion,
        ...(dish.kind === 'food' ? { foodId: dish.id } : { recipeId: dish.id }),
        ...(swap ? { outcome: 'swapped', slotId: swap.id } : { outcome: 'extra', slot }),
      };
      const saved = await post<MealLog>('/me/meal-logs', body);
      haptics.success();
      onLogged(saved, name);
    } catch (e) { setError(errorText(e)); haptics.error(); } finally { setBusy(false); }
  };

  return <View style={styles.wrap}>
    <DishThumb seed={dish.id} imageUrl={dish.imageUrl} icon={dishIcon(dish)} radius={fx.radius.toast} style={styles.image} />
    <View style={styles.titleRow}>
      <View style={styles.flex}>
        <T v="heading" style={styles.name}>{name}</T>
        <T v="body" color={fx.ink.a70} style={styles.serving}>{servingText(dish)}</T>
      </View>
      <Heart saved={saved} name={name} onPress={onToggleSave} size={22} />
    </View>
    {dish.summary ? <T v="body" color={fx.ink.a80}>{dish.summary}</T> : null}
    {dish.ingredients?.length ? <T v="bodySm" color={fx.ink.a60}>{`Made with ${dish.ingredients.map((i) => i.foodName || i.label).filter(Boolean).join(', ')}.`}</T> : null}

    <View style={styles.panel} accessible accessibilityLabel={panelLabel(v, portion)}>
      <View style={styles.kcal}>
        {has(v.kcal) ? <CountUp value={Math.round(v.kcal)} from={Math.round(v.kcal)} style={styles.kcalValue} maxFontSizeMultiplier={1.2} /> : <T v="metric30" style={styles.kcalValue}>—</T>}
        <T v="micro" color={fx.ink.white} style={styles.unit}>Kcal</T>
      </View>
      <View style={styles.rule} />
      <View style={styles.cols}>
        {(['protein_g', 'carbs_g', 'fat_g', 'fibre_g'] as NutrientKey[]).map((k, i) => <View key={k} style={[styles.col, i ? styles.colLine : null]}>
          <View style={styles.colValue}>
            {has(v[k]) ? <><CountUp value={v[k]} from={v[k]!} decimals={Number.isInteger(Math.round(v[k]! * 10) / 10) ? 0 : 1} style={[styles.macroValue, { color: MACRO[k].color }]} maxFontSizeMultiplier={1.2} /><T v="mono14" color={MACRO[k].color} style={styles.macroUnit}>g</T></>
              : <T v="mono14" color={fx.ink.a60} style={styles.macroValue}>—</T>}
          </View>
          {/* the macro's name shrinks to fit its column rather than end in an ellipsis ('PROTE…' at 320 dp: INV-04) */}
          <T v="micro" color={fx.ink.white} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{MACRO[k].label}</T>
        </View>)}
      </View>
    </View>
    <T v="caption" color={fx.ink.a60}>{dish.sources.length ? `Source: ${dish.sources.join('; ')}. Values are per serving as entered; nothing is estimated.` : 'No values were entered for this dish, so it adds nothing to your counted totals.'}</T>

    {method ? <View style={styles.method}>
      <T v="label" color={fx.ink.white} accessibilityRole="header">Method</T>
      <T v="body" color={fx.ink.a80}>{method}</T>
    </View> : null}

    <View style={styles.section}>
      <T v="label" color={fx.ink.white}>Select portion</T>
      <Segmented<string>
        kind="red"
        value={String(portion)}
        onChange={(p) => setPortion(Number(p) as Portion)}
        items={PORTIONS.map((p) => ({ value: String(p), label: p === 0.5 ? 'Half' : num(p), a11y: p === 0.5 ? 'Half a serving' : p === 1 ? '1 serving' : `${num(p)} servings` }))}
      />
      <T v="caption" color={fx.ink.a55}>{dish.kind === 'food' ? `Servings · 1 serving = ${servingText(dish)}` : 'Servings of the recipe, as written'}</T>
    </View>

    {swap ? <Notice kind="info" title={`Instead of your ${(SLOT_LABEL[swap.slot] ?? swap.slot).toLowerCase()}`}>{`This is logged as what you ate instead of “${swap.title}”.`}</Notice>
      : <View style={styles.section}>
        <T v="label" color={fx.ink.white}>Which meal</T>
        <View style={styles.chips}>{SLOTS.map((s) => <FilterChip key={s} label={SLOT_LABEL[s]} selected={slot === s} onPress={() => setSlot(s)} />)}</View>
      </View>}

    {error ? <Notice kind="error">{error}</Notice> : null}
    <Button title="Log this meal" variant="white" icon="plus" iconRight={null} commit busy={busy} onPress={log} full style={styles.cta} />
  </View>;
}

function panelLabel(v: ReturnType<typeof scaled>, portion: number): string {
  const parts = [has(v.kcal) ? `${Math.round(v.kcal)} kilocalories` : 'calories not entered'];
  for (const k of ['protein_g', 'carbs_g', 'fat_g', 'fibre_g'] as NutrientKey[]) parts.push(has(v[k]) ? `${MACRO[k].label} ${num(v[k]!)} grams` : `${MACRO[k].label} not entered`);
  return `For ${portion === 0.5 ? 'half a serving' : `${num(portion)} serving${portion === 1 ? '' : 's'}`}: ${parts.join(', ')}`;
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  image: { height: 140, width: '100%' },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  flex: { flex: 1, gap: 2 },
  name: { fontSize: 20, lineHeight: 28 },
  serving: { fontStyle: 'italic' },
  panel: { borderRadius: fx.radius.card, borderWidth: 1, borderColor: fx.line.a10, backgroundColor: fx.bg.elevated, padding: 20, gap: 14 },
  kcal: { alignItems: 'center', gap: 4 },
  kcalValue: { ...typeScale.metric30, fontFamily: FONTS.mono700, textAlign: 'center' },
  unit: { letterSpacing: 1.2 },
  rule: { height: 1, backgroundColor: fx.line.a50, marginHorizontal: 12 },
  cols: { flexDirection: 'row' },
  col: { flex: 1, alignItems: 'center', gap: 4, paddingHorizontal: 2 },
  colLine: { borderLeftWidth: 1, borderLeftColor: fx.line.a50 },
  colValue: { flexDirection: 'row', alignItems: 'baseline' },
  macroValue: { ...typeScale.mono14, fontSize: 18, lineHeight: 24, fontFamily: FONTS.mono700 },
  macroUnit: { fontSize: 14, fontFamily: FONTS.mono700 },
  section: { gap: 10 },
  method: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cta: { marginTop: 4 },
});
