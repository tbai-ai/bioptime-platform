/* Today's target card (the earlier app's calorie card, 51-fuel-nutrition / 57-fuel-today-meal-logged): a 180 pt ring and
   the macro bars, on a TiltCard (intensity 5, radius 24).
   - With a calorie target in the coach's plan: goal = the target, eaten = today's counted calories (todayTotals.kcal:
     only values entered with their source; a swap or an extra meal without a dish adds nothing and is counted as
     missing). The centre counts down the remaining calories (Bebas 36) over "x / goal kcal" (mono).
   - Without one: the ring shows the planned meals logged today out of today's planned meals.
   - Macro bars only for the targets the plan has (fibre has no target key, so its counted grams show without a bar).
   - The caption says what was counted and what was not; "How this is counted" opens the API's own note and sources.
   Nothing here is an estimate.
   Motion (v2, M80 "fuel added"): the ring and the remaining count share one clock and remember what was seen
   ('fuel.ring', 'fuel.remaining'): the first visit of the session sweeps (1000 ms cubic-out), a revisit is at rest on
   its first frame, and logging a meal extends the arc from the old value to the new over 600 ms cubic-out with a soft
   glow travelling at its head (tier A); the macro bars slide from their old fills, 60 ms apart.
   Tilt: the page's hero card; on native its device tilt runs only while it is on screen (HeroTilt). On Android at tiers A
   and B the whole card is drawn into a texture while it tilts (HeroTilt's layer, fix r2); at tier C the ring alone is
   (CACHED_RING), re-drawn only while it moves. */
import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Button, CountUp, GlassCard, Icon, T, TargetRing, fx, t, typeScale } from '@/fx';
import { HeroTilt, useHeroLayer } from '@/screens/tests/RowTilt';
import { motionValues } from '@/fx/motion/tokens';
import { seenValue } from '@/fx/motion/seen';
import { MACRO, has, kcal, num, plural } from './format';
import { ArcGlow, FillBar, useChangeClock, useSeenKind } from './Live';
import type { Nutrition, NutrientKey, TargetKey } from './types';
import { Beside } from '@/fx/wordFit';

const S = motionValues.screens.m80;
/** The target ring's geometry (Ring.tsx 'target': a 180 pt box, r 80 in a 180 view box, stroke 14). */
const RING = { box: 180, c: 90, r: 80, stroke: 14 };
/** The widest a label may be inside the ring: the inner circle's chord at its lower lines (FU-m8). At a large system
 *  text size a label shrinks to this width (one line) instead of running over the ring; at the usual sizes it fits. */
const LABEL_W = Math.round(2 * (RING.r - RING.stroke / 2) * 0.9);
/** A label inside the ring: one line, shrinking to fit LABEL_W. */
const FIT = { numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.5 } as const;
/** The first sweep of the session (the target ring's own length); a change takes S.fuelArcMs. */
const CLOCK = { first: t.metricRing, change: S.fuelArcMs };

const MACROS: TargetKey[] = ['protein_g', 'carbs_g', 'fat_g'];

/** Android: the ring (its layered glow strokes, gradient arc and knob, in SVG) is drawn once into a texture of its own and
 *  re-drawn only while it moves, so a scroll frame composites one image instead of re-rendering every stroke; not inside
 *  the hero's own layer (tiers A and B), which already holds it. */
const CACHED_RING = Platform.OS === 'android';

export function TargetCard({ n, onExplain }: { n: Nutrition; onExplain: () => void }) {
  const targets = n.plan?.version?.targets ?? null;
  const totals = n.todayTotals ?? null;
  const goal = has(targets?.kcal) && targets!.kcal! > 0 ? targets!.kcal! : null;
  const eaten = totals?.kcal ?? 0;
  const counted = totals ? totals.meals - totals.missing : 0;
  const missing = totals?.missing ?? 0;
  const slots = n.todaySlots;
  const loggedSlots = slots.filter((s) => n.todayLogs.some((l) => l.slotId === s.id && l.outcome !== 'skipped')).length;
  const macroRows = MACROS.filter((k) => has(targets?.[k]) && targets![k]! > 0);
  const fibre = totals?.fibre_g;

  let ring: React.ReactNode;
  if (goal) {
    // remounted when the counted values change: each mount moves from what was seen last to these, on one clock
    ring = <GoalRing key={`${eaten}|${goal}`} eaten={eaten} goal={goal} />;
  } else if (slots.length) {
    ring = <TargetRing value={loggedSlots} max={slots.length} seenKey="fuel.ring.slots" accessibilityLabel={`${loggedSlots} of ${slots.length} planned meals logged today`}>
      <View style={styles.centre}>
        <T v="display36" {...FIT} style={[styles.big, styles.fit]}>{`${loggedSlots} of ${slots.length}`}</T>
        <T v="caption" color={fx.ink.white} {...FIT} style={[styles.under, styles.fit]}>planned meals logged</T>
      </View>
    </TargetRing>;
  } else {
    ring = <TargetRing value={null} max={1} accessibilityLabel={has(totals?.kcal) ? `${kcal(totals!.kcal!)} kcal counted today` : 'Nothing counted today yet'}>
      <View style={styles.centre}>
        <T v="display36" {...FIT} style={[styles.big, styles.fit]}>{has(totals?.kcal) ? kcal(totals!.kcal!) : '—'}</T>
        <T v="caption" color={fx.ink.white} {...FIT} style={[styles.under, styles.fit]}>{has(totals?.kcal) ? 'kcal counted' : 'nothing counted yet'}</T>
      </View>
    </TargetRing>;
  }

  const caption = !totals || totals.meals === 0
    ? (goal ? 'From your plan’s entered values. Log a meal to count it.' : 'Meals you log count here with the values entered for them.')
    : `Counted from ${plural(counted, 'meal')} with entered values${missing ? `; ${plural(missing, 'meal')} without values ${missing === 1 ? 'is' : 'are'} not counted` : ''}. Nothing is estimated.`;

  const heroLayer = useHeroLayer();
  return <HeroTilt intensity={5} radius={fx.radius.three} hero>
    <GlassCard variant="three" padding={24} style={styles.card}>
      <View style={styles.ringWrap} collapsable={false} renderToHardwareTextureAndroid={CACHED_RING && !heroLayer}>{ring}</View>
      {macroRows.length ? <View style={styles.macros}>
        {macroRows.map((k, i) => <MacroRow key={k} k={k} value={totals?.[k] ?? null} target={targets![k]!} index={i} />)}
        {has(fibre) ? <View accessible accessibilityLabel={`Fibre ${num(fibre)} grams counted; your plan sets no fibre target`}>
          <Beside words={[{ text: 'Fibre', v: 'body', style: styles.rowText }]} gap={8} reserve={24} style={styles.row} columnStyle={styles.rowLabel}
            side={<T v="mono12" color={fx.ink.a70}>{`${num(fibre)} g · no target`}</T>}>
            <Icon name={MACRO.fibre_g.icon} size={16} color={MACRO.fibre_g.color} /><T v="body" style={styles.rowText}>Fibre</T>
          </Beside>
        </View> : null}
      </View> : null}
      <View style={styles.captionRow}>
        <T v="caption" color={fx.ink.a55} style={styles.caption}>{caption}</T>
        <Button variant="link" title="How this is counted" onPress={onExplain} style={styles.link} />
      </View>
    </GlassCard>
  </HeroTilt>;
}

/** The calorie ring and the remaining count on one clock, from the values seen last (see the header). */
function GoalRing({ eaten: exact, goal: goalExact }: { eaten: number; goal: number }) {
  // the figures are whole calories, and what is left is worked out from them as shown, so the two always add up to the
  // target (680.5 eaten of 1,400 reads 681 eaten and 719 remaining, never 720)
  const eaten = Math.round(exact);
  const goal = Math.round(goalExact);
  const over = eaten > goal;
  const left = Math.abs(goal - eaten);
  const remaining = left;
  const shownShare = Math.min(eaten, goal) / goal;
  const ringKind = useSeenKind('ring:fuel.ring', shownShare);
  const countKind = useSeenKind('count:fuel.remaining', remaining);
  const kind = ringKind === 'rest' && countKind === 'rest' ? 'rest' : ringKind === 'first' || countKind === 'first' ? 'first' : 'change';
  const clock = useChangeClock(kind, CLOCK);
  const [from] = React.useState(() => seenValue('ring:fuel.ring') ?? 0);
  return <View>
    <TargetRing value={Math.min(eaten, goal)} max={goal} seenKey="fuel.ring" progress={clock} accessibilityLabel={`${kcal(eaten)} of ${kcal(goal)} kcal from your plan's values${over ? `, ${kcal(left)} over` : `, ${kcal(left)} remaining`}`}>
      <View style={styles.centre}>
        <CountUp value={remaining} from={over ? 0 : goal} seenKey="fuel.remaining" progress={clock} style={styles.big} maxFontSizeMultiplier={1.2} />
        <T v="caption" color={fx.ink.white} {...FIT} style={[styles.under, styles.fit]}>{over ? 'over target' : 'remaining'}</T>
        <T v="mono12" color={fx.ink.white} {...FIT} style={[styles.mono, styles.fit]}>{`${kcal(eaten)} / ${kcal(goal)} kcal`}</T>
      </View>
    </TargetRing>
    {kind === 'change' ? <ArcGlow progress={clock} from={from} to={shownShare} box={RING.box} c={RING.c} r={RING.r} /> : null}
  </View>;
}

function MacroRow({ k, value, target, index }: { k: NutrientKey; value: number | null; target: number; index: number }) {
  const m = MACRO[k];
  const v = value ?? 0;
  return <View accessible accessibilityLabel={`${m.label}: ${num(v)} of ${num(target)} grams from entered values`}>
    <Beside words={[{ text: m.label, v: 'body', style: styles.rowText }]} gap={8} reserve={24} style={styles.row} columnStyle={styles.rowLabel}
      side={<T v="mono12" color={fx.ink.white}>{`${Math.round(v)} / ${Math.round(target)} g`}</T>}>
      <Icon name={m.icon} size={16} color={m.color} /><T v="body" style={styles.rowText}>{m.label}</T>
    </Beside>
    <FillBar share={v / target} seenKey={`fuel.macro.${k}`} color={k === 'protein_g' ? fx.red.brand : m.color} ms={S.fuelArcMs} delay={index * S.macroStep} />
  </View>;
}

const styles = StyleSheet.create({
  card: { boxShadow: fx.shadow.card },
  ringWrap: { alignItems: 'center', paddingTop: 4, paddingBottom: 8 },
  centre: { alignItems: 'center' },
  big: { ...typeScale.display36, fontVariant: ['tabular-nums'], textAlign: 'center' },
  under: { fontSize: 11, marginTop: 2 },
  mono: { marginTop: 4 },
  fit: { maxWidth: LABEL_W, textAlign: 'center' },
  macros: { gap: 14, marginTop: 20 },
  // a macro's name and its value: the value moves under the name when the name's longest word would not fit beside it
  // (Beside: 'Fibr/e' at 320 dp and text 2.0, SWA-07)
  row: { marginBottom: 8 },
  rowLabel: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowText: { fontSize: 14, flexShrink: 1 },
  captionRow: { marginTop: 18, gap: 4 },
  caption: { lineHeight: 16 },
  link: { alignSelf: 'flex-start' },
});
