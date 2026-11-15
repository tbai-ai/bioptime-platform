/* The coach's meal plan (the earlier app's "Coach's Meal Plan" card): the plan's name, version and coach, the calorie
   target beside what today's planned meals add up to (the plan's own totals of entered values; a day with meals
   without values says so), today's planned meals with their red slot labels and compact mono values, and "See the
   week" opening the plan day by day. The card carries the coach's targets only, never the member's own values, so the
   still-life photo band (fuel.mealPlan.card) may sit in its corner. */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Accordion, GlassCard, Icon, Photo, Scrim, T, fx } from '@/fx';
import { DAY_LABEL, SLOT_LABEL, compactMacros, has, kcal, plural, slotValues } from './format';
import type { Dish, MealPlan, PlanSlot } from './types';
import { FitText } from '@/fx/wordFit';

export function MealPlanCard({ plan, day, recipes, recipesKnown = true }: { plan: MealPlan; day: number; recipes: Map<string, Dish>; recipesKnown?: boolean }) {
  const v = plan.version;
  const slots = (v?.slots ?? []).filter((s) => s.day === day);
  const target = v?.targets?.kcal;
  const total = v?.totals?.days.find((d) => d.day === day) ?? null;
  const planned = total && has(total.kcal) && total.kcal > 0
    ? `${kcal(total.kcal)}${total.complete ? '' : '+'} planned${total.slotsMissingValues ? ` (${plural(total.slotsMissingValues, 'meal')} without values)` : ''}`
    : null;
  const meta = [has(target) ? `${kcal(target)} kcal target` : null, planned].filter(Boolean).join(' · ');
  const days = [1, 2, 3, 4, 5, 6, 7].filter((d) => v?.slots.some((s) => s.day === d));
  return <GlassCard variant="three" padding={0} clip style={styles.card}>
    <View pointerEvents="none" style={styles.photo}>
      <Photo slot="fuel.mealPlan.card" opacity={0.55} style={StyleSheet.absoluteFill} decorative />
      <Scrim kind="edgeLeft" style={styles.fadeLeft} />
      <Scrim kind="emptyBand" style={StyleSheet.absoluteFill} />
    </View>
    <View style={styles.head}>
      <View style={styles.titleRow}>
        <Icon name="salad" size={20} color={fx.red.label} />
        <T v="cardTitle" accessibilityRole="header" style={styles.flex}>Coach’s meal plan</T>
      </View>
      {meta ? <T v="caption" color={fx.ink.a55} style={styles.meta}>{meta}</T> : null}
      <T v="body" style={styles.planTitle}>{plan.title}</T>
      <T v="caption" color={fx.ink.a55}>{[`Version ${v?.version ?? plan.currentVersion ?? 1}`, plan.coachName ? `by ${plan.coachName}` : null].filter(Boolean).join(' · ')}</T>
      {v?.summary ? <T v="bodySm" color={fx.ink.a70} style={styles.summary}>{v.summary}</T> : null}
    </View>
    <View style={styles.body}>
      <T v="micro" color={fx.ink.a60} style={styles.dayLabel}>{`Today · ${DAY_LABEL[day] ?? ''}`}</T>
      {slots.length ? slots.map((s) => <SlotRow key={s.id} s={s} recipes={recipes} recipesKnown={recipesKnown} />)
        : <T v="bodySm" color={fx.ink.a60}>Your plan has no meals for today.</T>}
      {days.length ? <Accordion title="See the week" icon="calendar-days" style={styles.week}>
        {days.map((d) => <WeekDay key={d} plan={plan} d={d} today={day} recipes={recipes} />)}
        {v?.totals?.note ? <T v="caption" color={fx.ink.a60} style={styles.note}>{v.totals.note}</T> : null}
      </Accordion> : null}
    </View>
  </GlassCard>;
}

/** A recipe meal whose recipe values are not at hand (not read yet, or offline without a saved copy): its values are
 *  unknown here, which is not the same as none entered, so the row says nothing about them. */
function unknownValues(s: PlanSlot, recipes: Map<string, Dish>, recipesKnown: boolean): boolean {
  return !s.food && !!s.recipe && !recipes.has(s.recipe.id) && !recipesKnown;
}

function SlotRow({ s, recipes, recipesKnown }: { s: PlanSlot; recipes: Map<string, Dish>; recipesKnown: boolean }) {
  const line = compactMacros(slotValues(s, recipes));
  const unknown = !line && unknownValues(s, recipes, recipesKnown);
  const label = SLOT_LABEL[s.slot] ?? s.slot;
  return <View style={styles.slot} accessible accessibilityLabel={`${label}: ${s.title}${line ? `, ${line}` : unknown ? '' : ', no values entered'}`}>
    <T v="micro" color={fx.red.label} style={styles.slotLabel} numberOfLines={2}>{label}</T>
    <View style={styles.flex}>
      <T v="body" style={styles.slotTitle}>{s.title}</T>
      {unknown ? null : <T v="mono10" color={fx.ink.a60}>{line ?? 'No values entered'}</T>}
    </View>
  </View>;
}

function WeekDay({ plan, d, today, recipes }: { plan: MealPlan; d: number; today: number; recipes: Map<string, Dish> }) {
  const slots = plan.version!.slots.filter((s) => s.day === d);
  const total = plan.version?.totals?.days.find((x) => x.day === d);
  return <View style={styles.weekDay}>
    <View style={styles.weekHead}>
      <T v="micro" color={d === today ? fx.red.label : fx.ink.a60}>{`${DAY_LABEL[d]}${d === today ? ' · today' : ''}`}</T>
      {total && has(total.kcal) && total.kcal > 0 ? <T v="mono10" color={fx.ink.a60}>{`${kcal(total.kcal)}${total.complete ? '' : '+'} kcal`}</T> : null}
    </View>
    {slots.map((s) => {
      const line = compactMacros(slotValues(s, recipes));
      return <View key={s.id} style={styles.weekRow}>
        {/* the slot word shrinks just enough to stay whole in its column ('Breakfas/t' at text 2.0, SWA-16) */}
        <FitText v="caption" color={fx.ink.a55} boxStyle={styles.weekSlot}>{SLOT_LABEL[s.slot] ?? s.slot}</FitText>
        <View style={styles.flex}>
          <T v="bodySm" color={fx.ink.white}>{s.title}</T>
          {line ? <T v="mono10" color={fx.ink.a60}>{line}</T> : null}
        </View>
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  card: { boxShadow: fx.shadow.card, backgroundColor: fx.bg.deep }, // black, so the photo's scrims meet the card without an edge
  photo: { position: 'absolute', top: 0, right: 0, width: '62%', height: 150 },
  fadeLeft: { position: 'absolute', top: 0, bottom: 0, left: 0, width: '55%' },
  head: { paddingHorizontal: 20, paddingTop: 20, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  flex: { flex: 1 },
  meta: { marginBottom: 8 },
  planTitle: { fontSize: 15 },
  summary: { marginTop: 8 },
  body: { padding: 16, paddingTop: 14, gap: 10 },
  dayLabel: { marginLeft: 4 },
  slot: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderRadius: fx.radius.xl, borderWidth: 1, borderColor: fx.line.a05, backgroundColor: fx.fill.a03 },
  slotLabel: { width: 88 }, // BREAKFAST on one line at the micro labels' largest size (1.2×); MID-MORNING breaks at its hyphen
  slotTitle: { fontSize: 15, lineHeight: 22 },
  week: { marginTop: 4 },
  weekDay: { paddingTop: 12, gap: 6 },
  weekHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  weekRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  weekSlot: { width: 84 },
  note: { marginTop: 12 },
});
