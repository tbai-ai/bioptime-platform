/* The Wellness Score card (the earlier app's score hero, THEME §11.4 and §11.6, CRITIQUE §7 and §14): a 32-radius glass
   card in a TiltCard (I 8, the screen's hero), a red orb in its top corner, the 210 pt ScoreRing with its ticks, knob
   and glow, the number in Bebas 54 counting with the ring on one clock, "Wellness" between two hairlines and the API's
   own label in the tier slot ("PREVIEW"). Under the ring, three mini metrics from the member's real progress (resting
   heart rate, sleep, steps: a 60×24 sparkline, the mono value, the label), each opening its metric in Bio. A member
   without a score sees the empty ring, "—" and why; a metric without values shows "—" and no line.
   Motion (The Living Score, motion v2 M61, wave-2 fix): the ring, its knob and the digits share one 0..1 clock (the
   digits are rounded from it) that starts the moment the card's own entrance reaches opacity .6 (the Reveal's soft
   spring: read from its progress where the kit's RevealContext carries it, else timed from its start on the UI thread),
   900 ms expo. On the web it never waits for the header mark's flight to land: the dial is empty only while the card
   fades in. On a phone (wave-2 final fix) the card still arrives first, but the clock also waits while a mark handed
   to Home's header is still travelling (gestureState.markInFlight, until the flight's progress reaches MARK_HOME_AT,
   where the mark is home to the eye; the spring's numerical tail keeps markInFlight up some 0.5 s longer) or the
   launch sting's lockup covers Home (warmUnder): the ring's per-frame redraw (its glow arcs, knob and the minis'
   lines) cost the tier-A hand-off 84-101 ms frames when it shared the flight's frames. The
   minis' lines draw 150 ms into the count, over 500 ms. Until the count starts the number slot is drawn but empty
   (opacity 0, its width kept, tabular figures) and the tier line is drawn transparent, so nothing in the centre moves
   when the count starts; the number shows on the count's first frame, with the arc, and the tier line fades in over 200
   ms. "—" belongs only to a member with no score. Tier C sweeps the same clock over m61.sweepMsC (800 ms; its ring
   draws without the glow layers); reduced motion and a revisit in the same launch (the number already shown) show the
   final values from the first frame. A mini line is drawn only from values on two days (one a day: a second value
   logged the same day is no trend, data.metricView).
   Honest wording (CRITIQUE §7, owner question Q2): Bioptime does not calculate a Wellness Score. The only score there
   is, the preview member's, is prepared data the API labels 'preview' ("Prepared for the preview", word for word).
   Its sentence opens the card, above the ring (release gate T6-19): the screen says what the number is before it shows
   it, so the number is never followed by a sentence that seems to deny it. The sentence's first clause ("Prepared for
   the preview:") is drawn in the red of the ring's PREVIEW tag, so the tag and the clause read as one label. A member
   without a score sees the empty ring first and, under it, that no score is calculated, not a promise of one. The
   caption speaks of trends only. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, withDelay, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { CountUp, fx, GlassCard, RadialGlow, ScoreRing, T, TiltCard, typeScale, useMotion } from '@/fx';
import { markFlight, markFlightP } from '@/fx/brand/MarkLayer';
import { markInFlight, warmUnder } from '@/fx/motion/gestureState';
import { useRevealLanding } from '@/fx/motion/Reveal';
import { seenValue } from '@/fx/motion/seen';
import { HugText } from '@/fx/wordFit';
import { DASH_ARRAY, lengthOf, pathOf, sparkPoints, useLength, useLineProps } from '@/fx/motion/Sparkline';
import { calmFade, ease, motionValues, spring, t, timing } from '@/fx/motion/tokens';
import { usePageActive } from '@/fx/nav/pageReady';
import { isTodayAt } from '@/lib/today';
import { dayMonth, lowerIsBetter, num, type MetricView } from './data';

export type MiniMetric = Pick<MetricView, 'key' | 'short' | 'label' | 'unit' | 'latest' | 'at' | 'values' | 'decimals' | 'trend'>;

const CAPTION = 'Trends come from what you log, never a diagnosis.';
const NO_SCORE = 'Bioptime does not calculate a Wellness Score yet.';
const PREPARED = 'Prepared for the preview: Bioptime does not calculate a Wellness Score yet.';
/** PREPARED's two halves: what the number is ("Prepared for the preview:", in the PREVIEW tag's red, as the number's
 *  own label) and why members have none (the muted rest). The words are PREPARED's, word for word. */
const PREPARED_AT = PREPARED.indexOf(': ') + 2;
const PREPARED_LEAD = PREPARED.slice(0, PREPARED_AT);
const PREPARED_REST = PREPARED.slice(PREPARED_AT);

/** The seen key the number and the ring share (src/fx/motion/seen: a revisit shows them at rest). */
const SEEN = 'home.score';

/* The arrival's numbers. They read motionValues.screens.m61's wave-2 entries (startOpacity .6, arrivalMs 900, sparkAt
   150, sparkMs 500) once the tokens addendum has landed them, and until then the kit tokens of the same value. */
const M61 = motionValues.screens.m61 as typeof motionValues.screens.m61 & { startOpacity?: number; arrivalMs?: number; sparkAt?: number; sparkMs?: number; markHomeAt?: number };
/** The count starts when the card's entrance reaches this opacity. */
const START_OPACITY = M61.startOpacity ?? motionValues.count.popOpacity;
/** The ring and the digits: one clock, this long (ease.expo). */
const ARRIVAL_MS = M61.arrivalMs ?? t.sweepS;
/** The minis' lines draw this long into the count, over SPARK_MS. */
const SPARK_AT = M61.sparkAt ?? t.calm;
const SPARK_MS = M61.sparkMs ?? motionValues.chart.pointMs;

/** How long a spring from rest at 0 towards 1 takes to first reach `share`, in ms (the physics Reanimated runs:
 *  m·x″ = −k·(x − 1) − c·x′), integrated once at module load. The card's entrance is a Reveal on spring.soft whose
 *  opacity is the spring's progress, so this is when the card is `share` opaque. */
function springReach(cfg: { stiffness: number; damping: number; mass: number }, share: number): number {
  const dt = 1 / 4000; // s
  let x = 0;
  let v = 0;
  for (let i = 1; i <= 8000; i += 1) {
    v += ((-cfg.stiffness * (x - 1) - cfg.damping * v) / cfg.mass) * dt;
    x += v * dt;
    if (x >= share) return i * dt * 1000;
  }
  return 0;
}
/** The card's soft-spring entrance reaches START_OPACITY this long after it starts (≈ 148 ms). */
const CARD_AT = springReach(spring.soft, START_OPACITY);
/** The clock's value while the start waits: above 0 (CountUp prepares its moving digits) and far below what the ring
 *  draws (an arc or knob shows from a 0.0005 share; this is a 0.000001 share at most) and what the digits round to. */
const PRIME = 1e-6;
/** Native: the clock waits for a mark flying into Home's header to be home, and for the sting's lockup to lift (see the
 *  header). The web redraws the ring cheaply and keeps the start at the card's .6. */
const HOLD_FOR_MARK = Platform.OS !== 'web';
/** The share of the mark's flight (spring.mark, critically damped) from which it is home to the eye: the count may start
 *  then. m61.markHomeAt .99 (some 540 ms in, under 3 pt short) keeps the count's first, heaviest frames out of the
 *  flight on the tier-A emulator; .98 (some 480 ms in) mostly does, and the kit's landing share (reveal.landAt .95)
 *  let 100-117 ms frames back. Until the m61 addendum lands markHomeAt, the nearest token (press.card .98) stands in. */
const MARK_HOME_AT = M61.markHomeAt ?? motionValues.press.card;

/** The mini line's box and stroke (the earlier app's 60 × 24 at 2.4). */
const SPARK_W = 60;
const SPARK_H = 24;
const SPARK_STROKE = 2.4;
const AnimatedPath = Animated.createAnimatedComponent(Path);

/** A mini metric's line, drawn on the card's own clock (`draw`), so it starts with the count and never waits for
 *  anything else (the kit Sparkline would wait for the mark's flight). Fewer than two values draw nothing. */
function MiniSpark({ values, color, draw }: { values: readonly number[]; color: string; draw: { p: SharedValue<number>; drawn: SharedValue<number> } }) {
  const points = useMemo(() => sparkPoints(values, SPARK_W, SPARK_H, SPARK_STROKE / 2 + 1), [values]);
  const length = useLength(lengthOf(points));
  const line = useLineProps(length, draw);
  return <View style={styles.spark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    {points.length ? <Svg width={SPARK_W} height={SPARK_H}>
      <AnimatedPath d={pathOf(points)} fill="none" stroke={color} strokeWidth={SPARK_STROKE} strokeLinecap="round" strokeLinejoin="round"
        strokeDasharray={DASH_ARRAY} animatedProps={line} />
    </Svg> : null}
  </View>;
}

export function ScoreCard({ score, label, metrics, onMetric, onSwept }: {
  score: number | null; label: string | null; metrics: MiniMetric[];
  onMetric: (key: string, label: string) => void;
  /** Once, when the sweep has landed (at once when it is at rest): Home mounts what is below the brief then. */
  onSwept?: () => void;
}) {
  const { still, tier: motionTier } = useMotion();
  const S = motionValues.screens.m61;
  const landing = useRevealLanding();
  const active = usePageActive();
  // decided once, at mount: reduced motion, no score, or this number already shown in this run → at rest (tier C sweeps
  // too, on its shorter clock: FINAL_PLAN M61 'tier C S.m61.sweepMsC')
  const [prior] = useState(() => seenValue(`count:${SEEN}`));
  const [rest] = useState(() => still || score == null || prior === score);
  const ms = prior !== undefined ? t.change : motionTier === 'C' ? S.sweepMsC : ARRIVAL_MS; // a changed score moves from the one shown last
  // the one clock: ring, knob and digits (K09 `progress`)
  const clock = useSharedValue(rest ? 1 : 0);
  const begun = useSharedValue(rest ? 1 : 0); // the start has been scheduled
  const tierIn = useSharedValue(rest ? 1 : 0);
  const spark = useSharedValue(rest ? 1 : 0); // the minis' lines, on the same start
  const sparkOn = useSharedValue(rest ? 1 : 0);
  const draw = useMemo(() => ({ p: spark, drawn: sparkOn }), [spark, sparkOn]);
  const sweptRef = useRef(onSwept);
  sweptRef.current = onSwept;
  const told = useRef(false);
  const swept = () => { if (told.current) return; told.current = true; sweptRef.current?.(); };
  useEffect(() => { if (rest) swept(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const startedAt = landing?.startedAt;
  // the entrance's own 0..1 progress, where the kit's RevealContext carries it (then the start is exact even when frames
  // are dropped: the spring steps at most 64 ms a frame while a timer keeps the wall clock)
  const entrance = (landing as { progress?: SharedValue<number> } | null)?.progress;
  // native: the clock leaves 0 by a hair (PRIME: no arc, knob or digit shows it) as soon as the card's entrance is under
  // way on an active page, so CountUp swaps in its UI-thread digits while the number slot is still empty, even when the
  // count itself then waits for the mark (without this lead the slot showed React's "0" for the frames the swap took
  // while the arc was already sweeping)
  const primed = useSharedValue(rest || !HOLD_FOR_MARK ? 1 : 0);
  useAnimatedReaction(() => (primed.get() === 0 && begun.get() === 0 && active.get() === 1 && (!startedAt || startedAt.get() >= 0) ? 1 : 0), (go) => {
    if (go !== 1 || primed.get() === 1 || begun.get() === 1) return;
    primed.set(1);
    clock.set(PRIME);
  });
  // the start: on an active page, when the card's entrance reaches START_OPACITY: read from its progress, else timed
  // from its start (Reveal's startedAt, set on the UI thread with its delay) plus the time its spring takes to get
  // there; outside a Reveal, at once. On a phone it also waits for a mark flying into the header to be home (its flight
  // past MARK_HOME_AT; a flight it cannot follow, until markInFlight clears) and for the sting's lockup to lift; the
  // card has passed .6 by then, so the count starts on that frame.
  useAnimatedReaction(() => {
    if (begun.get() === 1 || active.get() !== 1) return -2;
    if (HOLD_FOR_MARK) {
      if (warmUnder.get() === 1) return -2;
      if (markInFlight.get() === 1 && (markFlight.get() === null || markFlightP.get() < MARK_HOME_AT)) return -2;
    }
    if (entrance) return entrance.get() >= START_OPACITY ? -1 : -2;
    if (!startedAt) return -1;
    const s = startedAt.get();
    return s < 0 ? -2 : s;
  }, (s) => {
    if (s === -2 || begun.get() === 1) return;
    begun.set(1);
    const wait = s === -1 ? 0 : Math.max(0, s + CARD_AT - Date.now());
    // the clock leaves 0 by a hair at once (no arc, knob or digit shows it), so CountUp swaps in its UI-thread digits
    // while the number slot is still empty (on a phone it was primed as the card started to enter; see above)
    clock.set(PRIME);
    const sweep = withTiming(1, timing(ms, ease.expo), (f) => { 'worklet'; if (f) scheduleOnRN(swept); });
    clock.set(wait > 0 ? withDelay(wait, sweep) : sweep);
    tierIn.set(withDelay(wait, withTiming(1, timing(S.tierFadeMs, ease.expo))));
    sparkOn.set(1); // the stroke stays transparent until its progress moves
    spark.set(withDelay(wait + SPARK_AT, withTiming(1, timing(SPARK_MS, ease.expo))));
  });
  // reduced motion switched on mid-count: the final values at once (a short crossfade for the tier line)
  useEffect(() => {
    if (!still) return;
    begun.set(1);
    clock.set(1);
    spark.set(1);
    sparkOn.set(1);
    tierIn.set(withTiming(1, calmFade()));
    swept();
  }, [still, begun, clock, spark, sparkOn, tierIn]); // eslint-disable-line react-hooks/exhaustive-deps
  // the number shows from the clock's first moving frame, the same frame the arc first draws
  const numberStyle = useAnimatedStyle(() => ({ opacity: clock.get() > PRIME ? 1 : 0 }));
  const tierStyle = useAnimatedStyle(() => ({ opacity: tierIn.get() }));

  const tier = score == null ? '' : (label ?? '').trim(); // the API's label belongs to a score, never to the empty ring
  const prepared = score != null && tier.toLowerCase() === 'preview';
  const ringLabel = score == null ? 'Wellness Score: not calculated' : `Wellness Score ${score} of 100${tier ? `, ${tier}` : ''}${prepared ? ', prepared for the preview' : ''}`;
  return <TiltCard intensity={motionValues.tilt.score} hero radius={fx.radius.hero}>
    <GlassCard variant="hero" blur clip>
      <RadialGlow color={fx.red.brand} opacity={0.12} style={styles.orb} />
      {/* the prepared score's sentence comes first: what the number is, then the number (T6-19) */}
      {prepared ? <T v="bodySm" color={fx.ink.a60} center style={styles.prepared} accessibilityLabel={PREPARED}>
        <T v="bodySm" color={fx.red.label}>{PREPARED_LEAD}</T>{PREPARED_REST}
      </T> : null}
      <View style={styles.ringWrap}>
        <ScoreRing value={score} progress={score == null ? undefined : clock} seenKey={SEEN} accessibilityLabel={ringLabel}>
          <View style={styles.centre} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {score == null ? <T v="score54" maxFontSizeMultiplier={1.2}>—</T>
              : <Animated.View style={numberStyle}>
                <CountUp value={score} progress={clock} seenKey={SEEN} pop style={[typeScale.score54, styles.digits]} maxFontSizeMultiplier={1.2} />
              </Animated.View>}
            <View style={styles.divider}>
              <View style={styles.hair} />
              <T v="micro" color={fx.ink.a50} style={styles.wide}>Wellness</T>
              <View style={styles.hair} />
            </View>
            {/* the tier slot is always there (the centre never re-lays out); its words fade in with the count */}
            <Animated.View style={tierStyle}>
              <T v="micro" color={fx.red.label} style={[styles.tier, tier ? styles.glow : null]}>{tier || ' '}</T>
            </Animated.View>
          </View>
        </ScoreRing>
      </View>
      {score == null ? <T v="bodySm" color={fx.ink.a60} center style={styles.empty}>{NO_SCORE}</T> : null}
      <View style={styles.minis}>
        {metrics.map((m) => {
          const v = m.latest;
          const good = m.trend && lowerIsBetter(m.key) ? m.trend === 'down' : null;
          const color = good === true ? fx.status.optimal : fx.red.brand;
          const shown = v == null ? '—' : num(v, m.decimals);
          // a value not logged today says its day (lib/today: a bare number reads as today's)
          const day = v != null && m.at && !isTodayAt(m.at) ? dayMonth(m.at).replace(/ /g, '\u00a0') : null; // "31 Oct" kept on one line
          return <Pressable key={m.key} accessibilityRole="button" accessibilityLabel={`${m.label}: ${v == null ? 'no value yet' : `${shown} ${m.unit}${day ? `, logged ${day}` : ''}`}. Open in Bio`}
            onPress={() => onMetric(m.key, m.label)} style={({ pressed }) => [styles.mini, pressed ? styles.pressed : null]}>
            <MiniSpark values={m.values} color={color} draw={draw} />
            <T v="mono14" style={styles.miniValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{shown}</T>
            {/* the day on a line of its own (RC2S-1: 'RESTING HR · 30 O…' at 320 dp and text 1.3), in a label that keeps
                its last word on a box that hugs it (HugText, TAB-01: 'SLEEP · 13 NOV' drawn 'SLEEP ·' at 320 dpi) */}
            <HugText v="micro" numberOfLines={3} center style={styles.miniLabel}>{day ? `${m.short}\n${day}` : m.short}</HugText>
          </Pressable>;
        })}
      </View>
      <T v="bodySm" color={fx.ink.a60} center style={styles.caption}>{CAPTION}</T>
    </GlassCard>
  </TiltCard>;
}

const styles = StyleSheet.create({
  orb: { position: 'absolute', top: -120, right: -120, width: 280, height: 280 },
  ringWrap: { alignItems: 'center', paddingTop: 4 },
  centre: { alignItems: 'center' },
  // the number keeps its width as the digits change
  digits: { fontVariant: ['tabular-nums'] },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  hair: { width: 20, height: 1, backgroundColor: fx.line.a20 },
  wide: { letterSpacing: 2.5, fontSize: 9 },
  tier: { letterSpacing: 2, fontSize: 9, marginTop: 8 },
  glow: { textShadowColor: fx.red.a60, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 8 },
  empty: { marginTop: 8, paddingHorizontal: 8 },
  prepared: { marginBottom: 16, paddingHorizontal: 8 },
  // the row may use most of the card's padding: at 320 dp the three 76-wide minis (260) are wider than the card's inner
  // width (230) and overflowed into the padding; when every mini was held at its minimum, Yoga's shrink divided by a
  // rounding residue and drew all three at their 120 maximum, cut at both card edges (320 dp, text 2.0, '10,5' / 'STE')
  minis: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 24, marginHorizontal: -(fx.space.hero - 8) },
  // 76 wide as in the earlier app; at a large text size a label widens its column, and when three no longer fit they
  // share the row and the label takes a second line
  mini: { minWidth: 76, maxWidth: 120, flexShrink: 1, alignItems: 'center', minHeight: 44, borderRadius: fx.radius.lg },
  pressed: { opacity: 0.7 },
  spark: { width: SPARK_W, height: SPARK_H },
  miniValue: { marginTop: 8 },
  miniLabel: { marginTop: 4, fontSize: 10, lineHeight: 14, letterSpacing: 0.5 },
  caption: { marginTop: 20 },
});
