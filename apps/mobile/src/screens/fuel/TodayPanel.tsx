/* Today (the earlier app's Today panel, 51-fuel-nutrition / 57-fuel-today-meal-logged, with Bioptime's nutrition kept
   whole): the target card, the coach's meal plan (with the week), today's meals with As planned / Swapped / Skipped,
   the coach's feedback on today's meals, the last seven days' adherence (self-reported), and the standing sentence on
   what is and is not done with what the member logs. Without a published plan: the honest empty card in its place.
   Motion (v2): the meal plan, today's meals, the feedback and the adherence card are below the fold, so they mount
   after the page has settled (Deferred: the height of the last visit is held meanwhile). The adherence figure and its bar share one clock
   and move from the values seen last (600 ms cubic-out); a revisit shows them at rest. */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { CountUp, EmptyState, GlassCard, Icon, Reveal, T, fx, typeScale } from '@/fx';
import { Deferred } from '@/fx/nav/Deferred';
import { motionValues } from '@/fx/motion/tokens';
import { FillBar, useChangeClock, useSeenKind } from './Live';
import { MealPlanCard } from './MealPlanCard';
import { TargetCard } from './TargetCard';
import { TodayMeals, type MealActions } from './TodayMeals';
import type { Dish, Nutrition } from './types';

export function TodayPanel({ n, recipes, recipesKnown = true, busy, actions, onExplain }: {
  n: Nutrition; recipes: Map<string, Dish>;
  /** The plan's recipe values have been read (from the server or the saved copy): until then a recipe meal's values are
   *  not known, which is not the same as none entered. */
  recipesKnown?: boolean;
  busy: string | null; actions: MealActions; onExplain: () => void;
}) {
  const feedback = n.todayLogs.flatMap((l) => (l.feedback ?? []).map((f) => ({ ...f, meal: l.description })));
  const a = n.adherence;
  return <View style={styles.wrap}>
    <Reveal mount index={0}>
      {n.plan ? <TargetCard n={n} onExplain={onExplain} />
        : <GlassCard variant="three" padding={0}>
          <EmptyState icon="salad" title="No meal plan yet" body="Your coach writes it with you; you are told here when it is ready. You can still log what you eat." />
        </GlassCard>}
    </Reveal>
    <Deferred id="fuel.today.below">
      <View style={styles.wrap}>
        {n.plan ? <Reveal index={1}><MealPlanCard plan={n.plan} day={n.day} recipes={recipes} recipesKnown={recipesKnown} /></Reveal> : null}
        <Reveal index={2}><TodayMeals n={n} recipes={recipes} busy={busy} actions={actions} /></Reveal>
        {feedback.length ? <Reveal index={3}>
          <GlassCard rule={{ color: fx.red.brand }} padding={20} style={styles.feedback}>
            <View style={styles.feedbackHead}><Icon name="message-square" size={14} color={fx.red.label} /><T v="overline">From your coach</T></View>
            {feedback.map((f) => <View key={f.id} style={styles.feedbackItem}>
              <T v="body">{f.body}</T>
              <T v="caption" color={fx.ink.a55}>{`${f.coachName} · on ${f.meal}`}</T>
            </View>)}
          </GlassCard>
        </Reveal> : null}
        {a ? <Reveal index={4}>
          <Adherence key={`${a.pct ?? 'none'}|${a.due}`} pct={a.pct ?? null} done={a.done} due={a.due} />
        </Reveal> : null}
      </View>
    </Deferred>
    <T v="caption" color={fx.ink.a50} style={styles.foot}>Nothing is calculated from your photos or what you write. Your coach sees your meal log only while you share health records with them.</T>
  </View>;
}

const S = motionValues.screens.m78;

/** The last seven days' adherence: the figure and its bar on one clock, from the values seen last. */
function Adherence({ pct, done, due }: { pct: number | null; done: number; due: number }) {
  const kind = useSeenKind('count:fuel.adherence', pct);
  const clock = useChangeClock(kind, { first: S.adherenceMs, change: S.adherenceMs });
  return <GlassCard padding={20} style={styles.stat}>
    <View style={styles.statHead}>
      <T v="label">Last 7 days</T>
      <T v="caption" color={fx.ink.a55}>Self-reported</T>
    </View>
    <View style={styles.statRow} accessible accessibilityLabel={due ? `${pct ?? 0} percent: ${done} of ${due} planned meals logged as planned or swapped. Self-reported.` : 'No planned meals were due.'}>
      <View style={styles.pct}>
        <CountUp value={pct} seenKey="fuel.adherence" progress={clock} style={styles.metric} accessibilityLabel={pct == null ? '—' : `${pct}%`} />
        {pct != null ? <T v="metric30" color={fx.ink.white}>%</T> : null}
      </View>
      <T v="bodySm" color={fx.ink.a70} style={styles.flex}>{due ? `${done} of ${due} planned meals logged as planned or swapped.` : 'No planned meals were due.'}</T>
    </View>
    {due ? <FillBar share={(pct ?? 0) / 100} seenKey="fuel.adherence" color={fx.red.brand} progress={clock} /> : null}
  </GlassCard>;
}

const styles = StyleSheet.create({
  pct: { flexDirection: 'row', alignItems: 'baseline' },
  metric: { ...typeScale.metric30, color: fx.ink.white, fontVariant: ['tabular-nums'] },
  wrap: { gap: 20 },
  flex: { flex: 1 },
  feedback: { gap: 12 },
  feedbackHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  feedbackItem: { gap: 4 },
  stat: { gap: 12 },
  // the two labels never touch ('DAYSSelf-reported' at 320 dp and text 2.0: N5): a gap, and the second moves under
  statHead: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  foot: { paddingHorizontal: 4 },
});
