/* Hydration (the earlier app's card, THEME §11.6; needs the water_ml daily total, PUT /me/progress/daily): eight drops of
   250 ml. Tapping the n-th sets today's total to n × 250 ml; tapping the last filled one empties it. The change shows at
   once and is sent; it is put back with an error toast if the server refuses. With a water goal the percentage and the
   bar follow it; without one the card says 250 ml a glass and draws no target. A still life of water sits behind the
   card's right side (people-free: the card holds the member's own millilitres).
   Motion (motion v2 M66): tapping drop n fills the drops up to it one after another, 40 ms apart, each popping
   1 → 1.18 → 1 (back on the drop spring) as its fill crossfades in over 120 ms; drops being emptied fade out. The bar is
   a full-width fill inside its rounded track, moved by translateX over 500 ms expo (its ends stay round on every
   frame), and at tier A a 1 pt highlight sweeps once along the part just filled (700 ms). The percentage counts to its
   new value over 300 ms. One light haptic per tap; the confirmation is the top toast with the day's total ("2,000 ml
   today", HomeScreen), never a pill over this card. A full day (all eight glasses) says so ("All 8 glasses today"), and
   only the tap that fills it (the value that tap asked for arriving as the day's total) sends one red glow along the
   drops (40 ms apart, up over 200 ms and away over 300) with a success haptic, once a day in a launch: a full day that
   arrives any other way (Log a value, a refresh) shows the line at rest. Each drop is 44 pt (48 dp) tall to touch and
   meets its neighbours' touch boxes (eight to a row leaves 39 pt across each). Tier C: the fills change colour in sequence, the bar moves without the highlight, the
   number changes at once and the glow is a fade; reduced motion: everything at once, no glow. */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { CountUp, fx, GlassCard, haptics, Icon, Photo, Scrim, T, typeScale, useMotion } from '@/fx';
import { markSeen, seenValue } from '@/fx/motion/seen';
import { ease, motionValues, spring, t, timing } from '@/fx/motion/tokens';
import { istDate } from '@/lib/format';
import { CardHead, reach } from './parts';
import { num } from './data';

export const GLASS_ML = 250;
const DROPS = 8;
const S = motionValues.screens.m66;
/** The drops' drawn size (at most 36, about 33 at 390 wide) and the space between them. */
const DROP_H = 32;
const DROP_GAP = 6;

function Drop({ index, filled, wait, glow, glowAt, onPress }: { index: number; filled: boolean; wait: number; glow: number; glowAt: number; onPress: () => void }) {
  const { still, tier } = useMotion();
  const on = useSharedValue(filled ? 1 : 0); // the filled look's opacity over the empty one
  const s = useSharedValue(1);
  const g = useSharedValue(0); // the full day's glow passing this drop
  const was = useRef(filled);
  const glowWas = useRef(glow);
  useEffect(() => {
    if (glowWas.current === glow) return;
    glowWas.current = glow;
    if (still) return;
    const pass = withSequence(withTiming(1, timing(t.fast, ease.css)), withTiming(0, timing(t.base, ease.css)));
    g.set(glowAt > 0 ? withDelay(glowAt, pass) : pass);
  }, [glow, glowAt, still, g]);
  const glowStyle = useAnimatedStyle(() => ({ opacity: g.get() }));
  useEffect(() => {
    if (was.current === filled) return;
    was.current = filled;
    if (still) { on.set(filled ? 1 : 0); return; }
    const fade = withTiming(filled ? 1 : 0, timing(S.fillMs, ease.css));
    on.set(wait > 0 ? withDelay(wait, fade) : fade);
    if (!filled || tier === 'C') return;
    const pop = withSequence(withTiming(S.dropPeak, timing(motionValues.press.inMs, ease.expo)), withSpring(1, spring.drop));
    s.set(wait > 0 ? withDelay(wait, pop) : pop);
  }, [filled, wait, still, tier, on, s]);
  const a = useAnimatedStyle(() => (s.get() === 1 ? { transform: [] } : { transform: [{ scale: s.get() }] }));
  const lit = useAnimatedStyle(() => ({ opacity: on.get() }));
  const ml = (index + 1) * GLASS_ML;
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={`Set water to ${num(filled ? index * GLASS_ML : ml)} ml`}
    accessibilityState={{ selected: filled }}
    onPress={onPress}
    style={styles.dropHit}>
    <Animated.View style={[styles.drop, a]}>
      <Icon name="droplet" size={14} color={fx.ink.a50} />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.dropOn, lit]}>
        <Icon name="droplet" size={14} color={fx.red.vivid} fill={fx.red.a40} />
      </Animated.View>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.dropGlow, glowStyle]} />
    </Animated.View>
  </Pressable>;
}

/** The goal bar: a full-width fill moved by translateX inside its rounded, clipping track (never scaled), green at
 *  100 %; at tier A a 1 pt highlight sweeps once along the part a change just filled. */
function WaterBar({ share }: { share: number }) {
  const { tier, still } = useMotion();
  const target = Math.max(0, Math.min(1, share));
  const [w, setW] = useState(0);
  const p = useSharedValue(target);
  const green = useSharedValue(share >= 1 ? 1 : 0);
  const glint = useSharedValue(0); // 0 → 1 along the new part
  const [seg, setSeg] = useState<{ from: number; to: number } | null>(null);
  const last = useRef(target);
  useEffect(() => {
    const from = last.current;
    last.current = target;
    if (from === target) return;
    if (still) { p.set(target); green.set(share >= 1 ? 1 : 0); return; }
    const ms = tier === 'C' ? motionValues.reveal.C.duration : S.barMs;
    p.set(withTiming(target, timing(ms, ease.expo)));
    green.set(withDelay(share >= 1 ? ms : 0, withTiming(share >= 1 ? 1 : 0, timing(t.fast, ease.css))));
    if (tier === 'A' && target > from) {
      setSeg({ from, to: target });
      glint.set(0);
      glint.set(withTiming(1, timing(S.glintMs, ease.inOut)));
    }
  }, [target, share, still, tier, p, green, glint]);
  const onLayout = (e: LayoutChangeEvent) => { const lw = e.nativeEvent.layout.width; if (lw > 0) setW(lw); }; // never 0 × 0
  const fill = useAnimatedStyle(() => ({ transform: [{ translateX: -w * (1 - p.get()) }] }));
  const greenStyle = useAnimatedStyle(() => ({ opacity: green.get() }));
  const segW = seg && w ? (seg.to - seg.from) * w : 0;
  const glintStyle = useAnimatedStyle(() => {
    const k = glint.get();
    if (!seg || k <= 0 || k >= 1) return { opacity: 0, transform: [] };
    const x = (seg.from + (seg.to - seg.from) * k) * w - segW;
    return { opacity: 1 - k * k, transform: [{ translateX: x }] };
  });
  return <View onLayout={onLayout} style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(target * 100) }}>
    {w > 0 ? <Animated.View style={[styles.fill, { width: w }, fill]}>
      <View style={[StyleSheet.absoluteFill, styles.fillRed]} />
      <Animated.View style={[StyleSheet.absoluteFill, styles.fillGreen, greenStyle]} />
    </Animated.View> : null}
    {w > 0 && segW > 0 ? <Animated.View pointerEvents="none" style={[styles.glint, { width: segW }, glintStyle]} /> : null}
  </View>;
}

/** The percentage: counts from the one shown to the new one over 300 ms (a new count per change, on its own clock). */
function Percent({ from: fromProp, to }: { from: number; to: number }) {
  const { tier, still } = useMotion();
  const [from] = useState(fromProp); // this count's start, kept through a re-render while it runs
  const clock = useSharedValue(still || tier === 'C' || from === to ? 1 : 0);
  useEffect(() => {
    if (clock.get() === 1) return;
    clock.set(withTiming(1, timing(S.pctMs, ease.cubicOut))); // an even count: every step of the number gets its frame
  }, [clock]);
  return <View style={styles.pctRow} accessible accessibilityLabel={`${to} percent of your water goal`}>
    <CountUp value={to} from={from} progress={clock} style={[typeScale.mono14, styles.pct]} />
    <T v="mono14" color={fx.red.vivid} style={styles.pctSign}>%</T>
  </View>;
}

export function HydrationCard({ ml, goal, onSet }: { ml: number; goal: number | null; onSet: (ml: number) => void }) {
  const glasses = Math.min(DROPS, Math.floor(ml / GLASS_ML));
  const pct = goal ? Math.round((ml / goal) * 100) : null;
  // the drops that change with this render fill (or empty) in order, from the one next to the old level (the level and
  // the percentage drawn at the last commit)
  const drawn = useRef({ glasses, pct });
  const before = drawn.current.glasses;
  const pctFrom = drawn.current.pct;
  useEffect(() => { drawn.current = { glasses, pct }; }, [glasses, pct]);
  const waitFor = (i: number) => (glasses > before ? Math.max(0, i - before) * S.dropStep : Math.max(0, before - 1 - i) * S.dropStep);
  // the day's water done: the tap that fills the last drop sends one glow along the drops once the fills have landed
  // (once a day in a launch: seen key home.water.full.<day>). Only that tap's own change counts: the value a tap asked
  // for is kept until the total it set is drawn, then consumed, so a full day from Log a value or a refresh (after any
  // earlier tap) plays nothing
  const full = glasses === DROPS;
  const [glow, setGlow] = useState(0);
  const tappedTo = useRef<number | null>(null);
  useEffect(() => {
    const asked = tappedTo.current;
    if (asked == null || ml !== asked) return;
    tappedTo.current = null;
    if (!full || before === DROPS || asked < DROPS * GLASS_ML) return;
    const key = `home.water.full.${istDate()}`;
    if (seenValue(key) === 1) return;
    markSeen(key, 1);
    haptics.success();
    setGlow((n) => n + 1);
  }, [ml, full, before]);
  const glowFrom = Math.max(0, DROPS - 1 - before) * S.dropStep + S.fillMs;
  const tap = (i: number) => {
    const next = i + 1 === glasses ? i * GLASS_ML : (i + 1) * GLASS_ML;
    haptics.light();
    tappedTo.current = next;
    onSet(next);
  };
  return <GlassCard clip style={styles.card}>
    <View pointerEvents="none" style={styles.photo}>
      <Photo slot="home.hydration.card" opacity={0.22} style={StyleSheet.absoluteFill} decorative />
      <Scrim kind="banner" style={StyleSheet.absoluteFill} />
    </View>
    <CardHead icon="droplets" title="Hydration" strong={false} style={styles.head} right={pct != null ? <Percent key={pct} from={pctFrom ?? pct} to={pct} /> : null} />
    <T v="body" color={fx.ink.a80} style={styles.sub} accessibilityLabel={`Water today: ${num(ml)} ml${goal ? ` of a ${num(goal)} ml goal` : ''}`}>
      {goal ? `${num(ml)} ml / ${num(goal)} ml goal` : full ? `${num(ml)} ml today` : `${num(ml)} ml today · ${GLASS_ML} ml a glass`}
    </T>
    <View style={styles.drops} accessibilityLabel={`Water: ${glasses} of ${DROPS} glasses`}>
      {Array.from({ length: DROPS }, (_, i) => <Drop key={i} index={i} filled={i < glasses} wait={waitFor(i)} glow={glow} glowAt={glowFrom + i * S.dropStep} onPress={() => tap(i)} />)}
    </View>
    {full ? <View style={styles.fullRow} accessible accessibilityLabel={`All ${DROPS} glasses today`}>
      <Icon name="check" size={14} color={fx.hue.green400} />
      <T v="caption" color={fx.hue.green400}>{`All ${DROPS} glasses today`}</T>
    </View> : null}
    {goal ? <View style={styles.bar}><WaterBar share={ml / goal} /></View> : null}
  </GlassCard>;
}

const styles = StyleSheet.create({
  card: {},
  photo: { position: 'absolute', top: 0, bottom: 0, right: 0, left: 0 },
  head: { marginBottom: 4 },
  pctRow: { flexDirection: 'row', alignItems: 'baseline' },
  pct: { fontSize: 18, lineHeight: 22, color: fx.red.vivid, fontVariant: ['tabular-nums'] },
  pctSign: { fontSize: 18, lineHeight: 22 },
  sub: { marginBottom: 16, marginLeft: 26 },
  drops: { flexDirection: 'row', gap: DROP_GAP },
  // the touch box: the drop's place in the row, half the gap wider on each side (it meets its neighbours') and 44 pt
  // (48 dp) tall, inside matching negative margins, so the row keeps its look and height
  dropHit: { flex: 1, maxWidth: 36 + DROP_GAP, paddingHorizontal: DROP_GAP / 2, marginHorizontal: -DROP_GAP / 2, ...reach(DROP_H) },
  drop: { aspectRatio: 1, borderRadius: 999, borderWidth: 1, borderColor: fx.line.a15, backgroundColor: fx.fill.a03, alignItems: 'center', justifyContent: 'center' },
  dropGlow: { margin: -1, borderRadius: 999, borderWidth: 1, borderColor: fx.red.label, backgroundColor: fx.red.a20, boxShadow: `0px 0px 12px ${fx.red.a50}` },
  fullRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  // the filled look, crossfaded over the empty one (its glow is drawn, never animated)
  dropOn: { margin: -1, borderRadius: 999, borderWidth: 1, borderColor: fx.red.brand, backgroundColor: fx.red.a20, boxShadow: fx.shadow.dot, alignItems: 'center', justifyContent: 'center' },
  bar: { marginTop: 16 },
  // the medium bar: 6 high, round, clipping its fill
  track: { height: 6, borderRadius: 3, backgroundColor: fx.fill.a10, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 3, overflow: 'hidden' },
  fillRed: { backgroundColor: fx.red.brand, borderRadius: 3 },
  fillGreen: { backgroundColor: fx.hue.green500, borderRadius: 3 },
  glint: { position: 'absolute', left: 0, top: 0, height: 1, borderRadius: 1, backgroundColor: fx.ink.a30 },
});
