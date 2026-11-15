/* The three onboarding slides, in the earlier app's carousel (shots 15–17, tx-onboarding-next-*): black with the red
   particle network, a 128 pt round photo (people-free or no member data near it, AMENDED §6 slots) with its red wash,
   white/10 ring and soft red glow, a Bebas title, the light subtitle, the dots (active 32 × 6 white) and a ghost "Back"
   beside the white pill "Next" / "Start". The words are Bioptime's own: how the coach and the plan work, blood tests at
   home with the member's package, and progress, with the "Not medical advice." paragraph word for word. Slide 2 saves
   programme_info and slide 3 how_it_works as seen (model.saveSlide). A slide taller than the screen (large text)
   scrolls under the status bar's backing (StatusScrim).
   Motion v2:
   - The round photo is one element for all three slides (M55): each slide's photo is already there, and on a change
     the next one slides into the circle as the last one slides out of it, the way the words go (m55.photoFadeMs on
     the expo curve, the new one settling from m55.photoScaleFrom), so the circle is never empty and only ever shows
     one photograph at a point: no double exposure (release C14, T2-19, T4-15). It grows in from m55.firstGrowFrom on
     the first slide only. When the words change height the circle glides to its new place (the web: a measured
     translate, src/flow/follow; native: a LinearTransition of m55.circleMs).
   - The words, one slide's at a time (SlideDeck below): the old ones leave first (x ∓20, their opacity gone over
     t.swapOut on the expo curve) and the new ones come in once they have (from flowSwap.enterAt: x ±20, opacity over
     500 ms), so two slides' titles and paragraphs never draw over each other (release T2-19, T4-15).
   - They follow the finger (M59): a drag moves the words 1:1 and the photo at m59.photoFollow (tier A; 1:1 at B and C),
     with a rubber band past the first and last slides; the active dot stretches towards the next one (its leaf's
     width). A release past m59.commitShare of the column or faster than m59.commitV turns the slide from where the
     finger left it, on the quiz spring; anything less springs back.
   - Back comes in from m55.backX with its opacity over m55.backMs; the Next pill's width follows (the web: its single
     background leaf animates its width, round ends on every frame; native: a LinearTransition of m55.nextMs).
   - The dots are drawn as before (8 pt apart); their touch boxes are 48 pt tall and at least 48 wide (DotRow): the
     current dot's place goes to the dots beside it, half each, or all to the one neighbour of an end dot, and the
     end dots reach further out (release T2-20).
   Tier C: the words fade out and then in (no travel); the photos still slide (a translate). Reduced motion: no
   tracking (a release still turns the slide), the words fade out and then in and the photo crossfades (150 ms each),
   at rest otherwise. */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { ReduceMotion, cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AnimatedPressable, Button, FlowEnter, Icon, Notice, Particles, Photo, RadialGlow, RingSpinner, StatusScrim, T, ease, fontFor, fx, haptics, timing, useMotion, usePress } from '@/fx';
import { PRESS_PROPS } from '@/fx/press';
import { calmFade, motionValues, spring, t } from '@/fx/motion/tokens';
import { doneOnce } from '@/fx/motion/once';
import { errorText } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { followLayout, useFollow } from '@/flow/follow';
import { SLIDE_ENTER, useDeckDrag, type DeckDrag } from './Deck';
import { saveSlide, type Onboarding } from './model';

type Slide = { slot: string; title: string; body: string; extra?: 'package' | 'advice' };

const SLIDES: Slide[] = [
  { slot: 'onboarding.slide1', title: 'Your coach, your plan', body: 'A Bioptime coach writes your weekly plan and answers your messages. Tick the tasks off here; consultations are booked from your coach’s free slots.' },
  { slot: 'onboarding.slide2', title: 'Blood tests at home', body: 'Blood tests are collected at home by our partner laboratory. The report is reviewed with notes before it reaches you: by your coach while health sharing is on, otherwise by the Bioptime team.', extra: 'package' },
  { slot: 'onboarding.slide3', title: 'Progress you can see', body: 'Log your measurements, workouts and habits here and watch them over the weeks, next to what your coach planned.', extra: 'advice' },
];

const M55 = motionValues.screens.m55;
const M58 = motionValues.screens.m58;
const M59 = motionValues.screens.m59;
/** The round photo's size (its style below): how far a photo slides to leave the circle. */
const ROUND = 128;
/** The slides' column: the words' width cap (400) inside the screen's 24 pt margins. */
const SLIDE_COLUMN = 400;
const DOT = { on: 32, off: 8, gap: 8 } as const;
/** The dots' touch boxes (release T2-20): 48 pt tall (the dots were 14 pt boxes), and the first and last reach this
 *  far beyond their dot. The dots themselves stay where they were drawn, 8 pt apart. */
const DOT_TOUCH = 48;
const DOT_REACH = 44 - DOT.off;
/** The dots' row as drawn once the current dot `on` (of n) has grown: x, width and centre of each dot. */
function dotRow(on: number, n: number) {
  const x: number[] = [];
  const w: number[] = [];
  let at = 0;
  for (let k = 0; k < n; k++) { x.push(at); w.push(k === on ? DOT.on : DOT.off); at += w[k] + DOT.gap; }
  return { x, w, c: x.map((v, k) => v + w[k] / 2), width: at - DOT.gap };
}
/** Dot k's touch box [from, to] in the row's points while dot `on` is current (k ≠ on). Tapping the current dot does
 *  nothing, so its place belongs to the dots beside it: the neighbours split it at its centre, and an end dot's one
 *  neighbour takes all of it. Two dots on the same side meet halfway between their centres, and the end dots reach
 *  DOT_REACH beyond the row. Every box is 48 pt or wider with three slides (the short middle dot was 24). */
function dotBox(k: number, on: number, n: number): [number, number] {
  const r = dotRow(on, n);
  const mid = (a: number, b: number) => (r.c[a] + r.c[b]) / 2;
  if (k < on) return [k === 0 ? -DOT_REACH : mid(k - 1, k), k < on - 1 ? mid(k, k + 1) : on === n - 1 ? r.x[on] + r.w[on] : r.c[on]];
  return [k > on + 1 ? mid(k - 1, k) : on === 0 ? r.x[on] : r.c[on], k === n - 1 ? r.width + DOT_REACH : mid(k, k + 1)];
}

export function Slides({ start = 0, onboarding, onBack, onDone, enter = true }: { start?: number; onboarding: Onboarding; onBack?: () => void; onDone: () => void; enter?: boolean }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { tier, calm, inHtml } = useMotion();
  const still = calm || inHtml;
  const [i, setI] = useState(start);
  const [dir, setDir] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollY = useSharedValue(0);
  const drag = useDeckDrag();
  const photoX = useSharedValue(0); // the photo's follow (parallax at tier A)
  const column = Math.min(width - 48, SLIDE_COLUMN);
  const circle = useFollow(M55.circleMs, !still);
  const last = i === SLIDES.length - 1;
  const iRef = useRef(i);
  iRef.current = i;
  const go = (to: number) => { if (to < 0 || to >= SLIDES.length || to === iRef.current) return; haptics.select(); setDir(to > iRef.current ? 1 : -1); setErr(null); setI(to); };
  const next = async () => {
    setErr(null);
    const at = iRef.current;
    // slide 2 has been read: its programme information is seen; slide 3: how it works (the server keeps both)
    if (at === SLIDES.length - 1) {
      setBusy(true);
      try { await saveSlide('how_it_works'); }
      catch (e) { setErr(errorText(e)); setBusy(false); return; }
      setBusy(false);
      onDone();
      return;
    }
    go(at + 1);
    if (at >= 1) {
      // saved in the background: a refusal brings the slide back with the reason
      try { await saveSlide('programme_info'); }
      catch (e) { setErr(errorText(e)); if (iRef.current !== at) { setDir(-1); setI(at); } }
    }
  };
  const nextRef = useRef(next);
  nextRef.current = next;
  const onSwipe = useCallback((d: number) => { if (d > 0) void nextRef.current(); else go(iRef.current - 1); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const n = SLIDES.length;
  const canBack = useSharedValue(i > 0 ? 1 : 0);
  const canFwd = useSharedValue(i < n - 1 ? 1 : 0);
  useEffect(() => { canBack.value = i > 0 ? 1 : 0; canFwd.value = i < n - 1 && !busy ? 1 : 0; }, [i, n, busy, canBack, canFwd]);
  const follow = !still;
  const photoK = tier === 'A' ? M59.photoFollow : M59.textFollow;
  const commitAt = M59.commitShare * Math.min(width, column);
  const swipe = Gesture.Pan()
    .activeOffsetX([-M59.activeOffsetX, M59.activeOffsetX])
    .failOffsetY([-M59.failOffsetY, M59.failOffsetY])
    .onUpdate((e) => {
      if (!follow) return;
      const dx = e.translationX;
      const ok = dx > 0 ? canBack.value === 1 : canFwd.value === 1;
      const x = dx * (ok ? M59.textFollow : M59.rubber);
      drag.x.value = x;
      photoX.value = x * photoK;
    })
    .onEnd((e) => {
      const dx = e.translationX;
      const vx = e.velocityX;
      const d = dx < 0 ? 1 : -1;
      const ok = d > 0 ? canFwd.value === 1 : canBack.value === 1;
      const far = Math.abs(dx) > commitAt || (Math.abs(vx) > M59.commitV && vx * dx > 0);
      if (ok && far && dx !== 0) {
        drag.v.value = vx;
        if (follow) photoX.value = withSpring(0, { ...spring.quiz, velocity: vx * photoK });
        scheduleOnRN(onSwipe, d);
        return;
      }
      if (drag.x.value !== 0) drag.x.value = withSpring(0, { ...spring.dismiss, velocity: vx });
      if (photoX.value !== 0) photoX.value = withSpring(0, { ...spring.dismiss, velocity: vx * photoK });
    });
  const photoFollow = useAnimatedStyle(() => (photoX.value === 0 ? { transform: [] } : { transform: [{ translateX: photoX.value }] }));
  const s = SLIDES[i];
  const pkg = onboarding.purchasedPackage;
  const words = <View style={styles.words}>
    <T v="h1" center style={styles.title}>{s.title}</T>
    <T v="body" center style={styles.body}>{s.body}</T>
    {s.extra === 'package' ? <View style={styles.pill}>
      <T v="caption" color={fx.ink.a80} center>{pkg ? `${pkg.name} runs until ${fmtDate(pkg.endAt)}. Bioptime matches you with a coach and tells you here.` : 'No package yet. Every package pairs you with a coach for a set number of months and includes blood tests collected at home and one-to-one consultations.'}</T>
    </View> : null}
    {s.extra === 'advice' ? <View style={styles.pill}>
      <T v="caption" color={fx.ink.a80} center><T v="caption" color={fx.ink.white} style={styles.strong}>Not medical advice.</T> A result outside a range is not a diagnosis. Medicines, supplements and further tests are a doctor's call.</T>
    </View> : null}
  </View>;
  return <View style={styles.screen}>
    <Particles style={StyleSheet.absoluteFill} />
    <FlowEnter off={!enter}>
      <GestureDetector gesture={swipe}>
        <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 40 }]} showsVerticalScrollIndicator={false} scrollEventThrottle={16} onScroll={(e) => scrollY.set(e.nativeEvent.contentOffset.y)}>
          <Animated.View ref={(node: unknown) => { circle.watchRef(node); circle.moverRef(node); }} layout={followLayout(M55.circleMs)} style={[styles.slide, { maxWidth: column }, circle.style]}>
            <Animated.View style={photoFollow}><Round index={i} dir={dir} /></Animated.View>
            <SlideDeck index={i} dir={dir} width={column} drag={drag} style={styles.deck}>{words}</SlideDeck>
          </Animated.View>
        </ScrollView>
      </GestureDetector>
      <View style={[styles.footer, { paddingBottom: insets.bottom + 24 }]}>
        {err ? <Notice kind="error">{err}</Notice> : null}
        <DotRow current={i} count={SLIDES.length} onPress={go} drag={drag.x} reach={commitAt} />
        <View style={styles.buttons}>
          {i > 0 ? <BackIn key="back"><Button variant="ghost" title="Back" full onPress={() => go(i - 1)} /></BackIn>
            : onBack ? <View style={styles.back}><Button variant="ghost" title="Back" full onPress={onBack} /></View> : null}
          <NextPill title={last ? 'Start' : 'Next'} busy={busy} onPress={() => { void next(); }} />
        </View>
      </View>
    </FlowEnter>
    <StatusScrim scrollY={scrollY} color={fx.bg.deep} />
  </View>;
}

/** The 128 pt round photo: red wash, white/10 ring, soft red glow. Every slide's photo is drawn (so it is loaded); on a
 *  change the new one slides into the circle from the side the slide comes from while the last one slides out of the
 *  other side (the circle clips both), so the circle is never empty and never shows two photographs over each other.
 *  Grows from m55.firstGrowFrom once. */
function Round({ index, dir }: { index: number; dir: number }) {
  const { still } = useMotion();
  const grow = useSharedValue(still ? 1 : 0);
  useEffect(() => { if (!still) grow.value = withDelay(200, withTiming(1, timing(500, ease.expo))); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const a = useAnimatedStyle(() => (grow.value === 1 ? { opacity: 1, transform: [] } : { opacity: grow.value, transform: [{ scale: M55.firstGrowFrom + (1 - M55.firstGrowFrom) * grow.value }] }));
  // the order the photos came to the front in: the newest is drawn on top
  const [order, setOrder] = useState<number[]>(() => [...SLIDES.keys()].filter((k) => k !== index).concat(index));
  if (order[order.length - 1] !== index) setOrder(order.filter((k) => k !== index).concat(index));
  return <Animated.View style={[styles.roundBox, a]}>
    <RadialGlow opacity={0.15} fade={0.7} style={styles.glow} />
    <View style={styles.round}>
      {order.map((k) => <RoundPhoto key={k} slot={SLIDES[k].slot} front={k === index} dir={dir} />)}
      <View style={[StyleSheet.absoluteFill, styles.wash]} />
    </View>
  </Animated.View>;
}

/** One slide's photo in the circle. Coming to the front it slides in from ROUND × dir to 0 over m55.photoFadeMs on the
 *  expo curve, settling from m55.photoScaleFrom (tiers A and B; tier C slides over t.fast); leaving the front it slides
 *  out to −ROUND × dir on the same curve and is then put away (transparent) until it comes to the front again.
 *  Reduced motion: the new one crossfades in over the last (calmFade), which stays under it. The two slide in step
 *  (same distance, same curve), so their edges meet and nothing under them shows. */
function RoundPhoto({ slot, front, dir }: { slot: string; front: boolean; dir: number }) {
  const { still, tier } = useMotion();
  const x = useSharedValue(0);
  const o = useSharedValue(front ? 1 : 0);
  const k = useSharedValue(1); // 1: settled; below 1 the scale is still settling from m55.photoScaleFrom
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    cancelAnimation(x); cancelAnimation(o); cancelAnimation(k);
    if (still) {
      // no travel: the new one crossfades in on top; the last one stays under it (covered once it is in)
      x.value = 0;
      if (front) { o.value = 0; o.value = withTiming(1, calmFade()); }
      return;
    }
    const cfg = tier === 'C' ? timing(t.fast, ease.expo) : timing(M55.photoFadeMs, ease.expo);
    if (front) {
      o.value = 1;
      x.value = ROUND * dir;
      x.value = withTiming(0, cfg);
      if (tier !== 'C') { k.value = 0; k.value = withTiming(1, cfg); }
      return;
    }
    x.value = withTiming(-ROUND * dir, cfg, (f) => { 'worklet'; if (f) o.value = 0; });
  }, [front, dir, still, tier, x, o, k]);
  const a = useAnimatedStyle(() => {
    const s = k.value === 1 ? 1 : M55.photoScaleFrom + (1 - M55.photoScaleFrom) * k.value;
    return x.value === 0 && s === 1 ? { opacity: o.value, transform: [] } : { opacity: o.value, transform: [{ translateX: x.value }, { scale: s }] };
  });
  return <Animated.View style={[StyleSheet.absoluteFill, a]}>
    <Photo slot={slot} decorative style={StyleSheet.absoluteFill} priority="high" />
  </Animated.View>;
}

type WordsLayer = { index: number; node: React.ReactNode; slot: 0 | 1 };
type WordsState = { index: number; slot: 0 | 1; prev: WordsLayer | null; dir: number; n: number };

/** The slides' words, one slide's at a time (release C14, T2-19, T4-15). When the slide changes, the words in front
 *  stay mounted (absolute, inert from their first exit frame) and leave first: x → ∓SLIDE_ENTER.x on spring.quiz (or
 *  on from where the finger left them, with its speed, to m58.exitShare of the column), their opacity gone over
 *  t.swapOut on the expo curve; the next slide's words come in from flowSwap.enterAt, by when the old ones have gone
 *  (x ±SLIDE_ENTER.x → 0 and opacity over SLIDE_ENTER.ms on the expo curve), so two slides' titles and paragraphs never
 *  draw over each other. `drag` moves the words in front with the finger (M59; the screen's Pan writes it). Tier C:
 *  opacity only, out over t.swapOut and then in over m58.cMs. Reduced motion: out and then in over 150 ms each. */
function SlideDeck({ index, dir, width, drag, children, style }: { index: number; dir: number; width: number; drag: DeckDrag; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { calm, inHtml, tier } = useMotion();
  const still = calm || inHtml;
  // slot 0 holds the first slide's words at rest; slot 1 is transparent until words enter into it
  const x0 = useSharedValue(0), x1 = useSharedValue(0);
  const o0 = useSharedValue(1), o1 = useSharedValue(0);
  const f0 = useSharedValue(1), f1 = useSharedValue(0); // 1: this slot follows the finger
  const [s, setS] = useState<WordsState>({ index, slot: 0, prev: null, dir, n: 0 });
  const last = useRef<React.ReactNode>(children);
  if (s.index !== index) {
    // what was drawn for the old slide becomes the leaving layer (same key: it keeps its slot)
    setS({ index, slot: s.slot === 0 ? 1 : 0, prev: { index: s.index, node: last.current, slot: s.slot }, dir, n: s.n + 1 });
  } else {
    last.current = children;
  }
  const curNode = s.index === index ? children : last.current;
  const prevSlot = s.prev?.slot ?? null;
  const dropPrev = useCallback(() => setS((x) => (x.prev && x.prev.slot === prevSlot ? { ...x, prev: null } : x)), [prevSlot]);
  const pending = useRef<{ cancel: () => void } | null>(null);
  useEffect(() => () => { pending.current?.cancel(); }, []);

  // the change, on the UI thread, in the frame after the new words' first commit
  useLayoutEffect(() => {
    if (s.n === 0) return;
    pending.current?.cancel();
    const inSlot = s.slot;
    const d = s.dir;
    const W = width;
    const fade = still || tier === 'C';
    const once = s.prev ? doneOnce(dropPrev, t.flow + motionValues.overlay.fallbackExtra) : null;
    pending.current = once;
    const gone = once ? once.done : () => undefined;
    const outCfg = still ? calmFade() : timing(t.swapOut, ease.expo);
    const inAt = still ? t.calm : motionValues.flowSwap.enterAt;
    const inCfg = still ? calmFade() : tier === 'C' ? timing(M58.cMs, ease.linear) : timing(SLIDE_ENTER.ms, ease.expo);
    // with reduced motion the wait before the new words is kept (a delay left to the OS setting would be skipped, and
    // the two slides' words would cross-fade over each other)
    const waitMode = still ? ReduceMotion.Never : ReduceMotion.System;
    scheduleOnUI(() => {
      'worklet';
      const xIn = inSlot === 0 ? x0 : x1, xOut = inSlot === 0 ? x1 : x0;
      const oIn = inSlot === 0 ? o0 : o1, oOut = inSlot === 0 ? o1 : o0;
      const fIn = inSlot === 0 ? f0 : f1, fOut = inSlot === 0 ? f1 : f0;
      const v = drag.v.value;
      const from = xOut.value + drag.x.value * fOut.value; // where the leaving words are drawn now
      cancelAnimation(xOut); cancelAnimation(oOut); cancelAnimation(xIn); cancelAnimation(oIn); cancelAnimation(drag.x);
      fOut.value = 0;
      drag.x.value = 0;
      drag.v.value = 0;
      fIn.value = 1;
      // the old words go first
      xOut.value = from;
      if (!fade) xOut.value = withSpring(Math.abs(from) > SLIDE_ENTER.x ? -d * M58.exitShare * W : -d * SLIDE_ENTER.x, { ...spring.quiz, velocity: v });
      oOut.value = withTiming(0, outCfg, (f) => { 'worklet'; if (f) scheduleOnRN(gone); });
      // then the new ones come in
      xIn.value = fade ? 0 : d * SLIDE_ENTER.x;
      oIn.value = 0;
      if (!fade) xIn.value = withDelay(inAt, withTiming(0, inCfg));
      oIn.value = withDelay(inAt, withTiming(1, inCfg), waitMode);
    });
    // the change runs once per slide change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.n]);

  const layers: React.ReactNode[] = [];
  if (s.prev) layers.push(<WordsLayerView key={'s' + s.prev.slot + ':' + s.prev.index} leaving x={s.prev.slot === 0 ? x0 : x1} o={s.prev.slot === 0 ? o0 : o1} f={s.prev.slot === 0 ? f0 : f1} drag={drag}>{s.prev.node}</WordsLayerView>);
  layers.push(<WordsLayerView key={'s' + s.slot + ':' + s.index} x={s.slot === 0 ? x0 : x1} o={s.slot === 0 ? o0 : o1} f={s.slot === 0 ? f0 : f1} drag={drag}>{curNode}</WordsLayerView>);
  return <Animated.View style={[styles.wordsDeck, style]}>{layers}</Animated.View>;
}

function WordsLayerView({ children, leaving, x, o, f, drag }: { children: React.ReactNode; leaving?: boolean; x: SharedValue<number>; o: SharedValue<number>; f: SharedValue<number>; drag: DeckDrag }) {
  // an entering slot is transparent (o 0) until the change places it, so its first frame never flashes
  const a = useAnimatedStyle(() => {
    const X = x.value + drag.x.value * f.value;
    return X === 0 ? { opacity: o.value, transform: [] } : { opacity: o.value, transform: [{ translateX: X }] };
  });
  const inert = leaving ? { pointerEvents: 'none' as const, accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const, 'aria-hidden': true } : null;
  return <Animated.View style={[leaving ? styles.wordsLeaving : null, a]} {...inert}>{children}</Animated.View>;
}

/** Back, coming in from m55.backX with its opacity over m55.backMs. */
function BackIn({ children }: { children: React.ReactNode }) {
  const { still } = useMotion();
  const p = useSharedValue(still ? 1 : 0);
  useEffect(() => { if (!still) p.value = withTiming(1, timing(M55.backMs)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const a = useAnimatedStyle(() => (p.value === 1 ? { opacity: 1, transform: [] } : { opacity: p.value, transform: [{ translateX: M55.backX * (1 - p.value) }] }));
  return <Animated.View layout={followLayout(M55.nextMs)} style={[styles.back, a]}>{children}</Animated.View>;
}

/** The white pill "Next" / "Start" (the kit's white button, drawn here so its width can follow Back): on the web its
 *  one background leaf, anchored to the right, animates its width from where it was (round ends on every frame), and
 *  the words ride a transparent layer of the same width, so they stay centred on it; native lays the box out with a
 *  LinearTransition instead. Busy: the 16 pt ring in the words' place. */
function NextPill({ title, busy, onPress }: { title: string; busy: boolean; onPress: () => void }) {
  const { still } = useMotion();
  const press = usePress('card');
  const bgW = useSharedValue(0);
  const web = Platform.OS === 'web';
  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (!(w > 0) || !web) return;
    bgW.value = bgW.value === 0 || still ? w : withTiming(w, timing(M55.nextMs));
  };
  // the same key on every frame (a key an animated style stops returning keeps its last value on the web)
  const wide = useAnimatedStyle(() => ({ width: web && bgW.value > 0 ? bgW.value : '100%' }));
  const words = <View style={[styles.pillRow, busy ? styles.hidden : null]}>
    <T v="cardTitle" color={fx.bg.deep} numberOfLines={1}>{title}</T>
    <Icon name="arrow-right" size={18} color={fx.bg.deep} />
  </View>;
  return <Animated.View layout={followLayout(M55.nextMs)} style={styles.next} onLayout={onLayout}>
    <AnimatedPressable
      {...PRESS_PROPS}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[styles.pillBox, press.style]}>
      <Animated.View pointerEvents="none" style={[styles.pillBg, wide]} />
      <View style={styles.sizer} aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{words}</View>
      <Animated.View pointerEvents="none" style={[styles.pillWords, wide]}>{words}</Animated.View>
      {busy ? <View style={styles.busy}><RingSpinner color={fx.red.brand} track={fx.red.a30} /></View> : null}
    </AnimatedPressable>
  </Animated.View>;
}

/** The slides' dots (a tab list): drawn as before, and above them one touch box per slide (dotBox), 48 pt tall and at
 *  least 48 wide, so the short middle dot is no longer a 24 pt target (release T2-20). The current dot's own box is
 *  its drawn width and takes no touches (its place is its neighbours'); it stays in the list, selected, for screen
 *  readers. The drawn dots are hidden from them. */
function DotRow({ current, count, onPress, drag, reach }: { current: number; count: number; onPress: (k: number) => void; drag: SharedValue<number>; reach: number }) {
  const row = dotRow(current, count);
  const dots = Array.from({ length: count }, (_, k) => k);
  return <View style={styles.dots}>
    <View style={[styles.dotArea, { width: row.width + 2 * DOT_REACH }]} accessibilityRole="tablist">
      <View pointerEvents="none" style={styles.dotLine} aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {dots.map((k) => <Dot key={k} on={k === current} drag={k === current ? drag : null} reach={reach} />)}
      </View>
      {dots.map((k) => {
        const [from, to] = k === current ? [row.x[k], row.x[k] + row.w[k]] : dotBox(k, current, count);
        return <Pressable key={k} pointerEvents={k === current ? 'none' : 'auto'} accessibilityRole="tab" accessibilityLabel={`Slide ${k + 1} of ${count}`}
          accessibilityState={{ selected: k === current }} onPress={() => onPress(k)} style={[styles.dotTouch, { left: DOT_REACH + from, width: to - from }]} />;
      })}
    </View>
  </View>;
}

/** A slide's dot as drawn. The current one is 32 wide; while the words are dragged it stretches towards the slide the
 *  drag leads to (its leaf's width, anchored on the far side). */
function Dot({ on, drag, reach }: { on: boolean; drag: SharedValue<number> | null; reach: number }) {
  const { still } = useMotion();
  const w = useSharedValue(on ? DOT.on : DOT.off);
  useEffect(() => { w.value = still ? (on ? DOT.on : DOT.off) : withTiming(on ? DOT.on : DOT.off, timing(500, ease.tailOut)); }, [on, still, w]);
  const slot = useAnimatedStyle(() => ({ width: w.value }));
  const leaf = useAnimatedStyle(() => {
    const dx = drag ? drag.value : 0;
    const extra = dx === 0 ? 0 : Math.min(1, Math.abs(dx) / Math.max(1, reach)) * (DOT.gap + DOT.off);
    // a drag to the left leads to the next slide: grow to the right (anchored left), and the other way round
    return dx < 0 ? { left: 0, width: w.value + extra } : { right: 0, width: w.value + extra };
  });
  return <Animated.View style={[styles.dot, slot]}>
    <Animated.View style={[styles.dotLeaf, { backgroundColor: on ? fx.ink.white : fx.ink.a20 }, leaf]} />
  </Animated.View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: fx.bg.deep },
  scroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingBottom: 24 },
  slide: { width: '100%', alignItems: 'center' },
  deck: { alignSelf: 'stretch' },
  wordsDeck: { position: 'relative' },
  wordsLeaving: { position: 'absolute', left: 0, right: 0, top: 0 },
  words: { alignItems: 'center' },
  roundBox: { width: 128, height: 128 },
  glow: { position: 'absolute', left: -64, top: -64, width: 256, height: 256 },
  round: { width: ROUND, height: ROUND, borderRadius: ROUND / 2, overflow: 'hidden', borderWidth: 1, borderColor: fx.line.a10, backgroundColor: fx.bg.card },
  wash: { backgroundColor: fx.premium.heroOverlay, borderRadius: 64 },
  title: { marginTop: 48 },
  body: { marginTop: 16, fontSize: 16, lineHeight: 26, color: fx.ink.white },
  pill: { marginTop: 20, paddingHorizontal: 16, paddingVertical: 12, borderRadius: fx.radius.xl, borderWidth: 1, borderColor: fx.line.a10, backgroundColor: fx.fill.a04 },
  strong: { fontFamily: fontFor('sans', 600) },
  footer: { width: '100%', maxWidth: 448, alignSelf: 'center', paddingHorizontal: 24, gap: 24 },
  dots: { flexDirection: 'row', justifyContent: 'center' },
  // the touch boxes' band: 48 pt tall, laid out as the 14 pt row it was (the negative margins), the end dots' reach
  // inside it (a touch outside a view's bounds never reaches it on Android)
  dotArea: { height: DOT_TOUCH, marginVertical: -(DOT_TOUCH - 14) / 2, justifyContent: 'center' },
  dotLine: { flexDirection: 'row', gap: DOT.gap, paddingHorizontal: DOT_REACH },
  dotTouch: { position: 'absolute', top: 0, bottom: 0 },
  dot: { height: 6 },
  dotLeaf: { position: 'absolute', top: 0, height: 6, borderRadius: 3 },
  buttons: { flexDirection: 'row', gap: 16 },
  back: { flex: 1 },
  next: { flex: 2 },
  pillBox: { minHeight: 44, paddingVertical: 16, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
  pillBg: { position: 'absolute', top: 0, bottom: 0, right: 0, borderRadius: fx.radius.pill, backgroundColor: fx.ink.white, boxShadow: fx.shadow.white },
  pillWords: { position: 'absolute', top: 0, bottom: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  sizer: { opacity: 0 },
  pillRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  hidden: { opacity: 0 },
  busy: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
});
