/* Staggered entrances (PREMIUM §1.4 "Staggered reveals", THEME §12.3) and the clock data motion follows.
   - Page-active: nothing enters on a page that cannot be seen. Every start waits for usePageActive() (src/fx/nav/pageReady)
     and happens on its 0 → 1 edge (a reaction on the UI thread); a pre-mounted page holds its elements at the start
     state and never uses up their first visit. `when="settled"` waits for the pager to settle on the page instead.
   - On mount (default outside a <RevealScope>, or with `mount`): the element enters after `delay` + `index` steps.
   - On scroll (inside a <RevealScope>): once, when its top crosses scrollY + 0.92 of the viewport. An element already
     above that line at its first measure enters with its index stagger; one that crosses later waits only for its
     queue slot (crossings in the same frame 50 ms apart, at most 4 slots), never for its mount index. During a fling
     faster than 2500 px/s crossing elements simply appear at rest. Measuring happens only while the page is active; a
     measure that comes back empty is retried on the next two frames, then the element shows at rest (never a blank band).
   - By tier: A y 20 + opacity + scale .985 over 420 ms, step 60; B y 12 + opacity over 320 ms, step 50; C opacity only
     over 200 ms, step 30; at most 4 steps at every tier. Calm and the web's pre-rendered HTML: at rest from the first
     frame. `from="scale"` grows from .95 without the rise; `duration` replaces the tier's length.
   - `id`: an element with an id enters once per launch (src/fx/motion/seen, cleared when the member changes); the
     decision is made once, at mount, so a re-render while it enters never snaps it to rest.
   - RevealContext: { startedAt, landed, index } for what is inside: rings, counts, lines and bars start their data motion
     120 ms after the entrance begins (+ 60 ms per grid index, at most 4) unless given an explicit `start`. `onLand` fires
     once when the entrance is 95 % in (or on the next frame when it is at rest).
   - The web fires no layout event when an element only moves (a filtered list closing up under a search): there an
     IntersectionObserver notices the element crossing the line and measures it again.
   - The launch hand-off (src/fx/motion/gestureState): on native, while the sting's lockup still covers the screen
     (warmUnder), an element waiting at its start state draws at reveal.warmOpacity instead of 0, so its GPU programs
     and pictures are ready before the black fades; while a mark flies into Home (markInFlight) the landing (onLand,
     RevealContext.landed) and the data motion wait for it to land, so no ring or line is drawn again on every frame of
     the flight; under the lockup (warmUnder) nothing lands and no data motion starts (it would play unseen). A spring entrance holds opacity 1 once it has arrived (the soft spring dips back under 1).
   The wrapper has no style of its own: wrap one always-rendered element and pass its alignSelf / flex through `style`.
   At rest: opacity 1, no transform. Everything runs on the UI thread (one reaction per element, no JS per frame). */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, useWindowDimensions, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { makeMutable, useAnimatedReaction, useAnimatedRef, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { measureView } from './measured';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import { usePageActive, usePageSettled } from '@/fx/nav/pageReady';
import { markInFlight, warmUnder } from './gestureState';
import { ease, motionValues, spring as springs, timing } from './tokens';
import { useMotion } from './tier';
import { markRevealed, wasRevealed } from './seen';

type Scope = { scrollY: SharedValue<number>; viewport: SharedValue<number>; velocity: SharedValue<number> };
const ScopeContext = createContext<Scope | null>(null);

/** Gives the Reveals inside a scroll view its offset (`useScrollOffset(ref)` or an onScroll handler's shared value). */
export function RevealScope({ scrollY, children }: { scrollY: SharedValue<number>; children: React.ReactNode }) {
  const { height } = useWindowDimensions();
  const viewport = useSharedValue(height);
  const velocity = useSharedValue(0);
  const last = useSharedValue({ y: 0, at: 0 });
  useEffect(() => { viewport.set(height); }, [height, viewport]);

  // scroll speed in px/s, from the offset's own changes (for the fling rule)
  useAnimatedReaction(() => scrollY.get(), (y) => {
    const now = Date.now();
    const l = last.get();
    const dt = now - l.at;
    if (dt > 0 && dt < 200) velocity.set(((y - l.y) / dt) * 1000);
    else velocity.set(0);
    last.set({ y, at: now });
  });

  const value = useMemo(() => ({ scrollY, viewport, velocity }), [scrollY, viewport, velocity]);
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useRevealScope(): Scope | null {
  return useContext(ScopeContext);
}

/* ---------- the landing context (K08) ---------- */

/** What a Reveal tells its content: when its entrance started (Date.now() on the UI thread, −1 before; a time in the
 *  past for one at rest), whether it has landed (0 | 1), and its index among its siblings. */
export type RevealLanding = { startedAt: SharedValue<number>; landed: SharedValue<number>; index: number };
export const RevealContext = createContext<RevealLanding | null>(null);

/** The nearest Reveal's landing, or null outside one: screen components follow the same data rule as the kit's. */
export function useRevealLanding(): RevealLanding | null {
  return useContext(RevealContext);
}

/** For data motion (rings, counts, lines, bars): calls the worklet `begin(wait)` once, on the UI thread, when it may
 *  start, with the wait in ms still to go:
 *  - `start` given: when it is true and the page is active (wait 0; the caller adds its own delay);
 *  - `start` left out inside a Reveal: once the entrance has begun and the page is active, dataDelay + dataStep ×
 *    min(index, dataMaxSteps) after the entrance's start (index: the caller's grid index, else the Reveal's);
 *  - `start` left out outside a Reveal: when the page is active.
 *  `enabled` false (calm, no value) never fires. Returns the fired flag (0 | 1). */
export function useDataStart(start: boolean | undefined, index: number | undefined, enabled: boolean, begin: (wait: number) => void): SharedValue<number> {
  const active = usePageActive();
  const reveal = useContext(RevealContext);
  const fired = useSharedValue(0);
  const fromReveal = start === undefined && !!reveal;
  const allowed = enabled && (start ?? true);
  const startedAt = reveal?.startedAt;
  const steps = Math.min(Math.max(0, Math.floor(index ?? reveal?.index ?? 0)), motionValues.reveal.dataMaxSteps);
  const offset = motionValues.reveal.dataDelay + steps * motionValues.reveal.dataStep;
  useAnimatedReaction(() => {
    if (!allowed || fired.get() === 1 || active.get() !== 1 || markInFlight.get() === 1 || warmUnder.get() === 1) return -2;
    if (!fromReveal || !startedAt) return -1;
    const s = startedAt.get();
    return s < 0 ? -2 : s;
  }, (s) => {
    if (s === -2 || fired.get() === 1) return;
    fired.set(1);
    begin(s === -1 ? 0 : Math.max(0, s + offset - Date.now()));
  });
  return fired;
}

/* ---------- the start queue for elements crossing the line later ---------- */

/** Crossings in the same frame take the next slot, scrollStep apart, at most scrollMaxSteps slots. */
const crossings = makeMutable({ at: -1, n: 0 });
const SAME_FRAME = 4;
/** Native only: the web has no launch sting over a mounted screen (gestureState.warmUnder). */
const WARM = Platform.OS === 'web' ? 0 : motionValues.reveal.warmOpacity;

export type RevealProps = {
  children: React.ReactNode;
  /** Position among siblings entering together. */
  index?: number;
  /** Extra wait (ms) before this element starts (the earlier app's timeline delays). */
  delay?: number;
  /** up: rise; left: slide from the left (greeting); scale: grow (brief); fade: opacity only. */
  from?: 'up' | 'left' | 'scale' | 'fade';
  /** Distance in points (tier A; B scales it down, C has none). Default 20 (left: 20, from -x). */
  distance?: number;
  /** Enter with a spring instead of the 420 ms curve: the Wellness Score card (soft) and Store cards (stagger). */
  spring?: 'soft' | 'stagger';
  /** Enter on mount even inside a RevealScope (the above-the-fold timeline). */
  mount?: boolean;
  /** Enter once per launch. */
  id?: string;
  /** The entrance's length in ms instead of the tier's (tier C keeps its 200 ms at most). */
  duration?: number;
  /** Called once on the JS side when the entrance is 95 % in (the soft spring: screens.m61.landAt), or on the next
   *  frame when it is at rest. */
  onLand?: () => void;
  /** 'active' (default): start on the page-active edge; 'settled': wait for the pager to settle on the page. */
  when?: 'active' | 'settled';
  style?: StyleProp<ViewStyle>;
};

export function Reveal({ children, index = 0, delay = 0, from = 'up', distance, spring, mount, id, duration: length, onLand, when = 'active', style }: RevealProps) {
  const { tier, still } = useMotion();
  const scope = useRevealScope();
  const active = usePageActive();
  const pageSettled = usePageSettled();
  // once per launch, decided at mount only: a re-render (data arriving) never turns a playing entrance to rest
  const [done] = useState(() => !!id && wasRevealed(id));
  const atRest = still || done;
  const ref = useAnimatedRef();
  const progress = useSharedValue(atRest ? 1 : 0);
  const settled = useSharedValue(atRest ? 1 : 0);
  const startedAt = useSharedValue(atRest ? 0 : -1);
  const landed = useSharedValue(atRest ? 1 : 0);
  const reached = useSharedValue(atRest ? 1 : 0); // a spring entrance has arrived once (its opacity stays 1 from then)
  const top = useSharedValue<number | null>(null); // the element's top in scroll content coordinates
  const measured = useSharedValue(0); // a first measure has been taken
  const laidOut = useSharedValue(0); // a non-zero layout has been seen
  const armed = useSharedValue(0);

  const v = motionValues.reveal[tier];
  const steps = Math.min(Math.max(0, Math.floor(index)), v.maxSteps);
  const wait = delay + steps * v.step;
  const dist = tier === 'C' || from === 'scale' || from === 'fade' ? 0 : (distance ?? 20) * (tier === 'B' ? 0.6 : 1);
  const scaleFrom = from === 'scale' ? (tier === 'C' ? 1 : motionValues.reveal.scaleFrom) : v.scale;
  const springCfg = spring && tier !== 'C' ? springs[spring] : null;
  const duration = tier === 'C' ? Math.min(length ?? v.duration, v.duration) : length ?? v.duration;
  // the soft spring (the Wellness Score card, m61) lands at m61.landAt: its long settle is no reason to hold the score
  const landAt = springCfg && spring === 'soft' ? motionValues.screens.m61.landAt : motionValues.reveal.landAt;
  const settledOk = when !== 'settled' || pageSettled;
  const scrollMode = !!scope && !mount && !atRest;

  const remember = () => { if (id) markRevealed(id); };

  /** Show at once (a fling, or an element that could not be measured). */
  const rest = () => {
    'worklet';
    if (armed.get() === 1) return;
    armed.set(1);
    startedAt.set(Date.now());
    progress.set(1);
    settled.set(1);
    scheduleOnRN(remember);
  };

  const start = (extra: number) => {
    'worklet';
    if (armed.get() === 1) return;
    armed.set(1);
    const finish = (f?: boolean) => {
      'worklet';
      if (f) settled.set(1);
    };
    const anim = springCfg
      ? withSpring(1, springCfg, finish)
      : withTiming(1, timing(duration, ease.expo), finish);
    startedAt.set(Date.now() + extra);
    progress.set(extra > 0 ? withDelay(extra, anim) : anim);
    scheduleOnRN(remember);
  };

  // mount mode: start on the page-active edge (at once when it is already 1)
  useAnimatedReaction(() => (!atRest && !scrollMode && settledOk && active.get() === 1 ? 1 : 0), (go) => {
    if (go === 1 && armed.get() === 0) start(wait);
  });

  // reduced motion turned on while entering: straight to rest
  useEffect(() => {
    if (!still) return;
    armed.set(1);
    progress.set(1);
    settled.set(1);
    if (startedAt.get() < 0) startedAt.set(0);
  }, [still, armed, progress, settled, startedAt]);

  // landing: once, when the entrance is 95 % in (or as soon as it is at rest)
  const onLandRef = useRef(onLand);
  useEffect(() => { onLandRef.current = onLand; }, [onLand]);
  const land = useCallback(() => { onLandRef.current?.(); }, []);
  // under the launch sting's lockup (warmUnder) nothing lands: data motion is never spent where it cannot be seen
  useAnimatedReaction(() => (landed.get() === 0 && markInFlight.get() === 0 && warmUnder.get() === 0 && (settled.get() === 1 || progress.get() >= landAt) ? 1 : 0), (hit) => {
    if (hit !== 1 || landed.get() === 1) return;
    landed.set(1);
    scheduleOnRN(land);
  });
  // a spring entrance overshoots and dips back under 1: once arrived, its opacity holds at 1
  useAnimatedReaction(() => (reached.get() === 0 && progress.get() >= 1 ? 1 : 0), (hit) => { if (hit === 1) reached.set(1); });
  useEffect(() => {
    if (!atRest) return;
    const raf = requestAnimationFrame(land);
    return () => cancelAnimationFrame(raf);
    // an element at rest lands once, on its first frame
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- scroll mode ---------- */

  const retry = (attempt: number) => {
    requestAnimationFrame(() => scheduleOnUI(takeMeasure, attempt));
  };

  /** Measure the element's top (only while the page is active). The first measure decides: above the line, enter with
   *  the index stagger; below it, wait for the crossing. */
  const takeMeasure = (attempt: number) => {
    'worklet';
    if (!scrollMode || !scope || armed.get() === 1 || active.get() !== 1) return;
    const m = measureView(ref);
    if (!m || (m.width === 0 && m.height === 0)) {
      if (attempt < motionValues.reveal.measureRetries) scheduleOnRN(retry, attempt + 1);
      else if (measured.get() === 0) rest(); // never leave a blank band
      return;
    }
    const y = m.pageY + scope.scrollY.get();
    top.set(y);
    if (measured.get() === 1) return;
    measured.set(1);
    if (y - scope.scrollY.get() < motionValues.reveal.line * scope.viewport.get()) start(wait);
  };

  const onLayout = (e: LayoutChangeEvent) => {
    if (!scrollMode) return;
    const { width, height } = e.nativeEvent.layout;
    if (width === 0 && height === 0) return; // a detached page reports 0 × 0
    laidOut.set(1);
    scheduleOnUI(takeMeasure, 0);
  };

  // a page that was inactive at layout measures on its active edge
  useAnimatedReaction(() => (scrollMode && laidOut.get() === 1 && measured.get() === 0 && armed.get() === 0 && active.get() === 1 ? 1 : 0), (need) => {
    if (need === 1) takeMeasure(0);
  });

  // the web: measure again whenever the element crosses the reveal line, however it got there
  useEffect(() => {
    if (Platform.OS !== 'web' || !scrollMode || typeof IntersectionObserver === 'undefined') return;
    const el = (ref as unknown as () => unknown)() as Element | null;
    if (!el || typeof (el as Element).getBoundingClientRect !== 'function') return;
    const below = Math.round((1 - motionValues.reveal.line) * 100);
    const io = new IntersectionObserver(() => {
      if (armed.get() === 1) { io.disconnect(); return; }
      scheduleOnUI(takeMeasure, 0);
    }, { rootMargin: `0px 0px -${below}% 0px` });
    io.observe(el);
    return () => io.disconnect();
    // set up once per mount, in scroll mode
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollMode]);

  // a later crossing: only the queue slot, never the mount index
  useAnimatedReaction(() => {
    if (!scrollMode || !scope || armed.get() === 1 || measured.get() === 0 || active.get() !== 1) return null;
    const t0 = top.get();
    if (t0 == null) return null;
    return t0 - scope.scrollY.get() < motionValues.reveal.line * scope.viewport.get();
  }, (crossed) => {
    if (!crossed || !scope || armed.get() === 1) return;
    if (Math.abs(scope.velocity.get()) > motionValues.reveal.fling) { rest(); return; }
    const now = Date.now();
    const q = crossings.get();
    const n = q.at >= 0 && now - q.at <= SAME_FRAME ? q.n + 1 : 0;
    crossings.set({ at: n === 0 ? now : q.at, n });
    start(Math.min(n, motionValues.reveal.scrollMaxSteps - 1) * motionValues.reveal.scrollStep);
  });

  const animated = useAnimatedStyle(() => {
    if (settled.get() === 1) return { opacity: 1, transform: [] };
    const p = progress.get();
    const k = 1 - p;
    const opacity = reached.get() === 1 ? 1 : Math.min(1, Math.max(WARM * warmUnder.get(), p));
    if (from === 'fade' || (dist === 0 && scaleFrom === 1)) return { opacity, transform: [] };
    const scale = scaleFrom + (1 - scaleFrom) * p;
    if (dist === 0) return { opacity, transform: [{ scale }] };
    return {
      opacity,
      transform: from === 'left'
        ? [{ translateX: -k * dist }, { scale }]
        : [{ translateY: k * dist }, { scale }],
    };
  });

  const landing = useMemo(() => ({ startedAt, landed, index }), [startedAt, landed, index]);

  return <RevealContext.Provider value={landing}>
    <Animated.View ref={ref} onLayout={onLayout} style={[style, animated]}>{children}</Animated.View>
  </RevealContext.Provider>;
}
