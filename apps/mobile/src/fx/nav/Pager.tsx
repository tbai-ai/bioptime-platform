/* The tab pager, "the Deck" (PREMIUM §1.3A, AMENDED §1, motion v2): expo-router's headless tabs (expo-router/ui)
   render each visited tab as a page, and one shared value `pos` (a float tab slot) places every page:
   - d = slot − pos. On top (d ≥ 0): translateX = d·W, with a 28 pt shadow on its leading edge (tiers A and B).
     Underneath (d < 0): translateX = d·W·0.30, scale 1 − 0.02·|d| (tier A; not on Android) and a black dim of 0.45·|d|
     (A and B). Higher slots draw on top, so going forward reads as a push and back as a pop, and there is never a black
     frame. On Android the page underneath draws only the strip the page on top leaves in view (Android draws every
     page in full, and redraws scaled text glyph by glyph: both doubled the GPU work of a swipe on the 2 GB emulator).
   - A tap on a tab starts the halo, the icons and the pages on the press itself (startTo, on the UI thread); the route
     follows (on the web after one frame, inside a transition). The route stays the source of truth: a deep link, back
     or a redirect moves the pages from wherever they are. For a jump of more than one tab, the page that covers the
     screen now takes the slot next to the target, so exactly two pages move; an interrupted jump decides again from
     where the pages are (never a page forced away with nothing in its place).
   - The page follows the finger: a horizontal pan (active past 16 pt, failing on 10 pt of vertical movement) moves
     `pos` with the drag and can catch a page in flight. Past the first and last tab it rubber-bands asymptotically
     (never a wall, at most 0.22 of a page). On release it commits one tab when |dx|·|vx| > 10 000 or |dx| > 0.42·W,
     springing with the release velocity; the selection haptic fires only when the tab really changes.
   - Neighbours are pre-mounted while idle (600 ms after a page settles and has drawn, one at a time), so a swipe
     reveals a drawn page; one the drag reaches before that mounts at once with its skeleton, and its screen fades in.
   - Every page knows whether it is the one in front (src/fx/nav/pageReady): the target of a tap or a drag is active
     from its first moving frame; pre-mounted, parked and detached pages, and every page under the launch sting, are not.
   - On the web a mouse drag that moved the pages does not also click the card it started on (only the click within
     50 ms of the release, only inside the pages); touch taps are never swallowed.
   - No swipe while a sheet is open, while something holds a swipe lock (the Coach composer, a chart being scrubbed),
     or inside a NoSwipeZone (horizontal carousels: the native scroll wins). The pan is created once, so a NoSwipeZone
     always blocks the live one.
   - Pages away from the screen are hidden from screen readers and touches. On the web only the pages that can be on
     screen are displayed: the focused one, the ones a move is crossing, and the pre-mounted neighbours (laid out,
     parked two widths away and hidden); the others stay display:none. The slot clips them, so a parked page never
     widens the document. On native three pages are laid out (the focused one, Home, the root tab and the heaviest page
     to lay out again, and the neighbour a swipe reveals next, then the most recent; tiers A and B keep both
     neighbours, so four between two other tabs; tier C lays out only Home and that neighbour while Home is in front;
     a neighbour not mounted yet keeps its place for its pre-mount, so its arrival never lays out one page more:
     Android pins the bitmaps of every laid-out page in the GPU cache on every frame, on screen or not, and Home's
     scroll must not outgrow it); the others go display:none 600 ms after a switch settles, never
     under a finger (React state is kept; their GPU textures and SVG bitmaps are released) and come back a frame
     before they move. A finger on the pages also holds the queued pre-mounts and unmounts until it lifts.
     A page that is neither Home, nor a neighbour of the focused page, nor one of the pager.mounted most recent, and
     that has not been in front or beside it for pager.dormantAfter, is unmounted in the same commit as the settle's
     detach ("dormant": Android keeps a display:none page's views, so nine mounted pages held about 700 MB), never in a
     later idle moment that could meet the next swipe's finger; its scroll offset is kept (TabScreen), and a visit, a
     drag or a pre-mount mounts it again like a first visit (its skeleton, then its screen in a transition, fading in
     once drawn). On a small phone the memory it held is collected at the next quiet moment (src/fx/device/collect).
   - Decorative loops run only on the focused page while pages move (src/fx/nav/pageReady's PageActiveContext).
   - Tiers: C translates only; reduced motion crossfades in 150 ms: the incoming page fades in on top of the outgoing
     one, which stays opaque underneath until the fade ends (decided live, when each change starts).
   - A first visit by a tap on the web waits for the new page to draw (at most 900 ms; the halo and the icon move at
     once); native slides at once over the page's skeleton and fades the content in once drawn. */
import { Image as ExpoImage } from 'expo-image';
import { router, useSegments, type Href } from 'expo-router';
import { useTabSlot, type TabsDescriptor } from 'expo-router/ui';
import React, { createContext, memo, startTransition, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import { fx } from '@/theme';
import { useSplashState, whenSplashGone } from '../brand/SplashHost';
import { collectWhenQuiet } from '../device/collect';
import { haptics } from '../device/haptics';
import { calmFade, ease, motionValues, spring, t, timing, useFx } from '../effects';
import { Scrim } from '../Gradient';
import { COLUMN } from '../layout';
import { pagerPanning } from '../motion/gestureState';
import { Skeleton } from '../motion/Skeleton';
import { useSheetOpen } from '../Sheet';
import { createSettledStore, markPageTouch, PageActiveContext, PageEnterContext, PageMotionContext, PageNameContext, PageReadyContext, PageSettledContext, pageScrolling, type PageMotion } from './pageReady';
import type { TabDef } from './tabs';

const WEB = Platform.OS === 'web';
/** Android draws every page it is given in full (HWUI has no occlusion culling) and redraws scaled text glyph by glyph,
 *  so there the page underneath is clipped to what is in view and does not scale (measured on the 2 GB emulator). */
const ANDROID = Platform.OS === 'android';
const PV = motionValues.pager;
const SW = motionValues.swipe;
const CONTENT_FADE = PV.contentFade;
/** Android: how far the page underneath still draws under the page on top (pt), so their meeting edge never shows a seam. */
const UNDER_OVERLAP = 2;

type SlotApi = { startTo: (order: number) => void; route: (name: string) => void };

type PagerState = {
  tabs: readonly TabDef[];
  /** The page position (float slot) every page follows. */
  pos: SharedValue<number>;
  /** The halo's position: follows `pos` while dragging, springs to a tapped tab on its own. */
  halo: SharedValue<number>;
  /** The selected tab on the UI thread: set by a press, a committed swipe and the route. */
  sel: SharedValue<number>;
  /** The order index of the focused tab (JS, from the route). */
  index: number;
  /** Swipe locks held now. */
  locks: Record<string, boolean>;
  /** Hold or release a swipe lock (the Coach composer, a chart being scrubbed). */
  lockSwipe: (key: string, on: boolean) => void;
  /** The pager's pan (created once), for NoSwipeZone to block while a horizontal list scrolls. */
  pan: React.RefObject<GestureType | undefined>;
  /** A tab press: the halo, the icons and the pages start now; the caller routes after (see NavItem). */
  startTo: (order: number) => void;
  /** Switch the router's tab by name (the web routes a press one frame after its motion started). */
  route: (name: string) => void;
  /** @internal the slot's handlers */
  slot: React.RefObject<SlotApi | null>;
};

const PagerContext = createContext<PagerState | null>(null);

export function usePager(): PagerState | null { return useContext(PagerContext); }

/** The order index of the focused tab, from the route (a stack overlay above the tabs keeps the last tab). */
function useFocusedIndex(tabs: readonly TabDef[]): number {
  const segments = useSegments() as string[];
  const last = useRef(0);
  if (segments[0] === '(tabs)') {
    const name = segments[1] ?? 'index';
    const i = tabs.findIndex((tab) => tab.name === name);
    if (i >= 0) last.current = i;
  }
  return last.current;
}

export function PagerProvider({ tabs, children }: { tabs: readonly TabDef[]; children: React.ReactNode }) {
  const index = useFocusedIndex(tabs);
  const pos = useSharedValue(index);
  const halo = useSharedValue(index);
  const sel = useSharedValue(index);
  const [locks, setLocks] = useState<Record<string, boolean>>({});
  const pan = useRef<GestureType | undefined>(undefined);
  const slot = useRef<SlotApi | null>(null);
  const lockSwipe = useCallback((key: string, on: boolean) => setLocks((l) => (!!l[key] === on ? l : { ...l, [key]: on })), []);
  const startTo = useCallback((order: number) => { slot.current?.startTo(order); }, []);
  const route = useCallback((name: string) => { slot.current?.route(name); }, []);
  const value = useMemo<PagerState>(() => ({ tabs, pos, halo, sel, index, pan, locks, lockSwipe, startTo, route, slot }),
    [tabs, pos, halo, sel, index, locks, lockSwipe, startTo, route]);
  return <PagerContext.Provider value={value}>{children}</PagerContext.Provider>;
}

/* A tab page has drawn (its first layout, TabScreen's report): the root layout's arrival veil (src/app/_layout.tsx
   ArrivalVeil, Android) waits for it. */
let pagesDrawn = 0;
const drawnListeners = new Set<() => void>();
/** Runs `fn` the next time a tab page reports its first draw (returns the unsubscribe). */
export function whenTabPageDrawn(fn: () => void): () => void {
  const seen = pagesDrawn;
  const l = () => { if (pagesDrawn !== seen) { drawnListeners.delete(l); fn(); } };
  drawnListeners.add(l);
  return () => { drawnListeners.delete(l); };
}
function tellPageDrawn() { pagesDrawn += 1; [...drawnListeners].forEach((l) => l()); }

/** Hold the pager still while `on` (a focused composer, a scrubbed chart). */
export function useSwipeLock(key: string, on: boolean): void {
  const pager = usePager();
  useEffect(() => {
    if (!pager) return;
    pager.lockSwipe(key, on);
    return () => pager.lockSwipe(key, false);
  }, [pager?.lockSwipe, key, on]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Wrap a horizontal list: while it scrolls, the tab pager waits. The pager's pan never changes, so this blocks the
 *  live one even after a sheet opened and closed. */
export function NoSwipeZone({ children }: { children: React.ReactNode }) {
  const pager = usePager();
  const pan = pager?.pan.current;
  const native = useMemo(() => (pan ? Gesture.Native().blocksExternalGesture(pan) : Gesture.Native()), [pan]);
  return <GestureDetector gesture={native}>{children}</GestureDetector>;
}

const union = (a: readonly number[], b: readonly number[]): number[] => { const s = new Set(a); for (const x of b) s.add(x); return [...s].sort((x, y) => x - y); };
const sameList = (a: readonly number[] | null, b: readonly number[] | null) => a === b || (!!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]));

/** An idle moment: requestIdleCallback (at most `timeout` later); native adds a beat after it (RN 0.88 has no
 *  InteractionManager any more; its idle callback is the replacement). */
function whenIdle(fn: () => void, timeout: number): () => void {
  const g = globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = WEB ? fn : () => { timer = setTimeout(fn, PV.nativeIdleExtra); };
  if (!g.requestIdleCallback) { timer = setTimeout(run, 0); return () => { if (timer) clearTimeout(timer); }; }
  const h = g.requestIdleCallback(run, { timeout });
  return () => { g.cancelIdleCallback?.(h); if (timer) clearTimeout(timer); };
}

/** The pages. Render inside <Tabs>; `navigate(name)` switches the router's tab (the layout passes the trigger's). */
export function PagerSlot({ navigate }: { navigate: (name: string) => void }) {
  const pager = usePager()!;
  const { tabs, pos, halo, sel, index, locks } = pager;
  const { width } = useWindowDimensions();
  const fxs = useFx();
  const sheetOpen = useSheetOpen();
  const splashRunning = useSplashState() === 'running';
  const last = tabs.length - 1;

  // ---- React state: which pages exist and which are drawn by the host
  const [mounted, setMounted] = useState<ReadonlySet<string>>(() => new Set(tabs[index] ? [tabs[index].name] : []));
  // the web: while the pages move, the orders that may show (null: settled)
  const [live, setLive] = useState<number[] | null>(null);
  // the web: pre-mounted neighbours, laid out but parked and hidden (a swipe reveals a drawn page)
  const [near, setNear] = useState<number[]>([]);
  // native: mounted pages whose host views are dropped (display: none), at most PV.attached kept
  const [detached, setDetached] = useState<ReadonlySet<string>>(() => new Set());
  const [, setTick] = useState(0);
  const afterCommit = useRef<Array<() => void>>([]);
  useLayoutEffect(() => {
    const queue = afterCommit.current;
    if (!queue.length) return;
    afterCommit.current = [];
    queue.forEach((fn) => fn());
  });
  const mountedRef = useRef(mounted); mountedRef.current = mounted;
  const liveRef = useRef(live); liveRef.current = live;
  const detachedRef = useRef(detached); detachedRef.current = detached;
  const indexRef = useRef(index); indexRef.current = index;
  const fxRef = useRef(fxs); fxRef.current = fxs;
  // pages mounted ahead of their screen (a drag or an idle pre-mount): skeleton first, the screen in a transition
  const deferred = useRef(new Set<string>());
  const initial = useRef(tabs[index]?.name);

  // ---- UI-thread state
  const jumpFrom = useSharedValue(-1);
  const jumpTo = useSharedValue(-1);
  /** Reduced motion: the page that stays opaque underneath while the other fades in. */
  const base = useSharedValue(index);
  /** The mode of the move in progress (1: the reduced-motion crossfade), decided when it starts. */
  const calmMove = useSharedValue(fxs.calm ? 1 : 0);
  const calmSV = useSharedValue(fxs.calm ? 1 : 0);
  /** Bit per order: the pages that are active (src/fx/nav/pageReady). */
  const activeMask = useSharedValue(1 << index);
  /** The focused tab's order (the route's), for the loop gate: while pages move only the focused page's loops run. */
  const focusSV = useSharedValue(index);
  /** Android, bit per order: the pages whose views are laid out (attached), so a page beneath may stop drawing under one. */
  const shownMask = useSharedValue(0);
  const splashSV = useSharedValue(splashRunning ? 1 : 0);
  const enabledSV = useSharedValue(1);
  const widthSV = useSharedValue(width);
  const lastSV = useSharedValue(last);
  const start = useSharedValue(0);
  const dragLo = useSharedValue(0);
  const dragHi = useSharedValue(last);
  const limitHit = useSharedValue(0);
  const enabled = !sheetOpen && !Object.values(locks).some(Boolean) && tabs.length > 1;
  useEffect(() => { calmSV.value = fxs.calm ? 1 : 0; }, [fxs.calm, calmSV]);
  useEffect(() => { splashSV.value = splashRunning ? 1 : 0; }, [splashRunning, splashSV]);
  useEffect(() => { enabledSV.value = enabled ? 1 : 0; }, [enabled, enabledSV]);
  useEffect(() => { widthSV.value = width; }, [width, widthSV]);
  useEffect(() => { lastSV.value = last; }, [last, lastSV]);

  // ---- JS bookkeeping
  const prev = useRef(index);
  /** The tab a press or a swipe has already sent the pages to (the route's layout effect then leaves them alone). */
  const heading = useRef(-1);
  const drawn = useRef(new Set<string>());
  const waiting = useRef<{ name: string; go: () => void; timer: ReturnType<typeof setTimeout> } | null>(null);
  const mru = useRef<string[]>(tabs[index] ? [tabs[index].name] : []);
  const idleCancel = useRef<(() => void) | null>(null);
  const detachTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDir = useRef(1);
  /** The launch page and whether its first pre-mount still waits (schedulePremount). */
  const launchOrder = useRef(index);
  const launchHold = useRef(true);
  const navRef = useRef(navigate);
  useEffect(() => { navRef.current = navigate; }, [navigate]);
  const slotRef = useRef<React.ComponentRef<typeof View>>(null);
  const pointer = useRef<string>('');
  const mouseDragged = useRef(false);
  const upAt = useRef(0);

  const sleepCancel = useRef<(() => void) | null>(null);
  const cancelIdle = () => {
    idleCancel.current?.();
    idleCancel.current = null;
    sleepCancel.current?.();
    sleepCancel.current = null;
    if (detachTimer.current) { clearTimeout(detachTimer.current); detachTimer.current = null; }
  };
  const dropWaiting = () => { const w = waiting.current; if (w) { clearTimeout(w.timer); waiting.current = null; } };
  useEffect(() => () => { dropWaiting(); cancelIdle(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // the tab routes the navigator has (a tab enters it on its first visit, or when it is preloaded)
  const present = useRef(new Set<string>());
  /** Have the tab navigator create a tab's route without focusing it (its screen can then mount ahead of a visit). */
  const preload = (name: string) => {
    if (present.current.has(name)) return;
    const tab = tabs.find((x) => x.name === name);
    if (tab) router.prefetch(tab.href as Href);
  };
  /** Native: pages unmounted to save memory (see the header); mounted again like a first visit. */
  const dormant = useRef(new Set<string>());
  /** Native: when each page was last in front or beside the page in front (a page needed again soon is never unmounted:
   *  swiping back and forth across three tabs must not unmount and mount the outer one each time). */
  const needed = useRef(new Map<string, number>());
  const mountNames = (names: string[], ahead: boolean) => {
    if (names.some((n) => dormant.current.has(n))) ahead = true; // a dormant page: its skeleton first, its screen in a transition
    names.forEach((n) => dormant.current.delete(n));
    if (ahead) names.forEach(preload);
    const add = names.filter((n) => !mountedRef.current.has(n));
    if (!add.length) return false;
    if (ahead) add.forEach((n) => deferred.current.add(n));
    setMounted((m) => { const next = new Set(m); add.forEach((n) => next.add(n)); return next; });
    return true;
  };
  const attachNames = (names: string[]) => {
    if (WEB || !names.some((n) => detachedRef.current.has(n))) return false;
    setDetached((d) => { const next = new Set(d); names.forEach((n) => next.delete(n)); return next; });
    return true;
  };

  // the page that drew once (TabScreen's first layout): a first visit waiting for it slides in now
  const pageDrawn = useCallback((name: string) => {
    if (drawn.current.has(name)) return;
    drawn.current.add(name);
    tellPageDrawn();
    const w = waiting.current;
    if (w && w.name === name) { waiting.current = null; clearTimeout(w.timer); w.go(); }
  }, []);

  // ---- the moves (worklets: they run on the UI thread on native, and on the JS thread on the web)
  const settledRN = useCallback((order: number) => { onSettled.current(order); }, []);
  const arrive = (slotTo: number) => {
    'worklet';
    const jf = jumpFrom.value;
    const jt = jumpTo.value;
    let order = slotTo;
    if (jf >= 0) {
      // a drag that caught a jump and went back: the page in the slot beside the target is the jump's start page
      if (slotTo === jt - (jt > jf ? 1 : -1)) { order = jf; }
      jumpFrom.value = -1;
      jumpTo.value = -1;
      pos.value = order;
    }
    activeMask.value = 1 << order;
    scheduleOnRN(settledRN, order);
  };
  /** The halo and the selection: at once on a press, before the pages (a first visit on the web waits for its page). */
  const press = (target: number, calm: boolean) => {
    'worklet';
    sel.value = target;
    halo.value = calm ? target : withSpring(target, spring.indicator);
  };
  /** The pages to `target`, from wherever they are now. */
  const move = (target: number, calm: boolean) => {
    'worklet';
    const jf = jumpFrom.value;
    const jt = jumpTo.value;
    const at = pos.value;
    // the page that covers the screen now (during a jump the slot beside the target holds the jump's start page)
    let from = Math.round(at);
    if (jf >= 0) from = from === jt ? jt : jf;
    from = Math.max(0, Math.min(lastSV.value, from));
    // M29: always start clean; a jump is decided from where the pages are
    jumpFrom.value = -1;
    jumpTo.value = -1;
    calmMove.value = calm ? 1 : 0;
    base.value = from;
    activeMask.value = activeMask.value | (1 << target);
    if (jf >= 0 && from !== Math.round(at)) {
      // the page that was in front keeps the screen: put the position on it
      cancelAnimation(pos);
      pos.value = from;
    }
    const now = pos.value;
    if (Math.abs(target - now) < 0.001) {
      cancelAnimation(pos);
      pos.value = target;
      arrive(target);
      return;
    }
    if (Math.abs(target - now) > 1) {
      const dir = target > now ? 1 : -1;
      jumpFrom.value = from;
      jumpTo.value = target;
      cancelAnimation(pos);
      pos.value = target - dir;
    }
    const done = (finished?: boolean) => { 'worklet'; if (finished) arrive(target); };
    pos.value = calm ? withTiming(target, calmFade(), done) : withSpring(target, spring.tab, done);
  };
  const begin = (target: number, calm: boolean) => {
    if (WEB) move(target, calm);
    else scheduleOnUI(move, target, calm);
  };

  /** Move to `target` (a press, a deep link, back): mount or re-attach it first when needed; the web shows both pages. */
  const goTo = (target: number, from: number) => {
    const name = tabs[target]?.name;
    if (!name) return;
    cancelIdle();
    dropWaiting();
    const calm = fxRef.current.calm;
    lastDir.current = target >= from ? 1 : -1;
    let commit = mountNames([name], false);
    if (WEB) { setLive((l) => union(l ?? [from], [target])); commit = true; }
    if (attachNames([name])) commit = true;
    if (WEB) press(target, calm); else scheduleOnUI(press, target, calm);
    const go = () => begin(target, calm);
    if (WEB && !drawn.current.has(name)) {
      // a first visit on the web: the page lays out off screen and slides in once it has drawn (the halo moved already)
      waiting.current = { name, go, timer: setTimeout(() => { waiting.current = null; go(); }, PV.firstVisitCap) };
      if (commit) setTick((n) => n + 1);
      return;
    }
    if (commit) { afterCommit.current.push(go); setTick((n) => n + 1); } else go();
  };

  // settled on `order`: the web drops the pages that moved; pre-mount the neighbours, then (native) detach the rest
  const onSettled = useRef<(order: number) => void>(() => undefined);
  onSettled.current = (order: number) => {
    if (order !== indexRef.current) {
      // the pages stopped on a tab the route has not reached (a press whose route was refused): the route wins
      const target = order;
      setTimeout(() => { if (indexRef.current !== target && heading.current === target) { heading.current = -1; goTo(indexRef.current, target); } }, PV.firstVisitCap);
      return;
    }
    if (WEB) {
      // a neighbour that the move laid out stays laid out (parked and hidden): it is a pre-mounted page already
      const moved = (liveRef.current ?? []).filter((o) => Math.abs(o - order) === 1 && mountedRef.current.has(tabs[o]?.name ?? ''));
      setLive((l) => (l === null ? l : null));
      setNear((n) => { const keep = union(n.filter((o) => Math.abs(o - order) === 1), moved); return sameList(keep, n) ? n : keep; });
    }
    schedulePremount(order);
    scheduleDetach(order);
  };

  /** The neighbour a swipe from `at` most likely reveals: the one in the last direction, or at either end the only one
   *  (Home reached by a tap from a later tab has its last direction pointing past the first tab). */
  const nextNeighbour = (at: number) => { const o = at + lastDir.current; return o >= 0 && o <= last ? o : at - lastDir.current; };

  /** The neighbours of `at`, mounted one at a time in idle moments (tier C: the one in the last direction, later).
   *  The launch page's first pre-mount waits until the launch sting has left the screen (its mark's flight) and then
   *  for the page's own first-visit motion (the Wellness sweep, m61.sweepMs), so no pre-mount lands in the frames of
   *  either; a settle on any other page ends that hold. */
  const schedulePremount = (at: number) => {
    cancelIdle();
    const tierC = fxRef.current.tier === 'C';
    if (at !== launchOrder.current) launchHold.current = false;
    const first = launchHold.current;
    const wanted = (tierC ? [nextNeighbour(at)] : [at + 1, at - 1]).filter((o) => o >= 0 && o <= last);
    let stopped = false;
    let cancelStep: (() => void) | null = null;
    // a page this pre-mount mounted takes a kept place: the settle's detach runs again (only then)
    let mountedAny = false;
    const step = (i: number) => {
      if (stopped) return;
      if (i >= wanted.length) { if (mountedAny) scheduleDetach(at); return; }
      cancelStep = whenIdle(() => {
        if (stopped) return;
        // never mount under a scrolling finger: try again once the scroll has ended
        if (pageScrolling()) { step(i); return; }
        const o = wanted[i];
        const name = tabs[o]?.name;
        if (name) {
          preload(name);
          const fresh = !mountedRef.current.has(name);
          if (fresh) { deferred.current.add(name); mountedAny = true; }
          startTransition(() => {
            if (fresh) setMounted((m) => (m.has(name) ? m : new Set(m).add(name)));
            if (WEB) setNear((n) => (n.includes(o) ? n : union(n, [o])));
          });
        }
        step(i + 1);
      }, t.premount);
    };
    let cancelGone: (() => void) | null = null;
    const begin = () => {
      if (stopped) return;
      // the settled page has drawn first (its own first render keeps the frame budget)
      if (!drawn.current.has(tabs[at]?.name ?? '')) { timer = setTimeout(begin, t.premount); return; }
      if (!first) { step(0); return; }
      cancelGone = whenSplashGone(() => {
        cancelGone = null;
        if (stopped) return;
        timer = setTimeout(() => { launchHold.current = false; step(0); }, tierC ? motionValues.screens.m61.sweepMsC : motionValues.screens.m61.sweepMs);
      });
    };
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(begin, tierC ? PV.premountTierC : t.premount);
    idleCancel.current = () => { stopped = true; if (timer) clearTimeout(timer); cancelGone?.(); cancelStep?.(); };
  };

  /** Native: keep the views of the focused page, Home and the neighbours a swipe reveals next, then the most recent
   *  pages while fewer than PV.attached are kept; the others drop theirs after the switch has settled (and never under a
   *  finger: a detach waits until the touch has ended, as the idle work does). */
  const scheduleDetach = (at: number) => {
    if (WEB) return;
    if (detachTimer.current) clearTimeout(detachTimer.current);
    const run = () => {
      detachTimer.current = null;
      if (indexRef.current !== at) return;
      if (pageScrolling()) { detachTimer.current = setTimeout(run, t.detach); return; }
      const keep = new Set<string>();
      // a neighbour kept for the next swipe holds its place while it is not mounted yet (dormant, or never visited):
      // its pre-mount fills that place, so the pages laid out never outnumber the kept places. Android pins every
      // mutable bitmap of every laid-out page in the GPU cache on each frame, on screen or not; after the nine-tab walk
      // Home, its two most recent pages and the re-mounted Train held more than the cache (124 MB on the 2 GB
      // emulator), and Home's scroll uploaded and dropped its pictures on every frame (gate r5 R5-A1: p50 28-32 ms)
      const held = new Set<string>();
      // tier C with Home in front: Home and its neighbour only (the most recent page goes display:none like any other)
      const room = at === 0 && fxRef.current.tier === 'C' ? PV.attachedHomeC : PV.attached;
      const add = (n: string | undefined, always = false) => {
        if (!n) return;
        if (!mountedRef.current.has(n)) { if (always) held.add(n); return; }
        if (always || keep.size + held.size < room) keep.add(n);
      };
      add(tabs[at]?.name, true);
      add(tabs[0]?.name, true); // Home, the root tab, stays attached: it is the heaviest page to lay out and draw again
      // M31: a neighbour stays laid out ahead of an older page, so a swipe never lays a whole page out again under the
      // finger (re-attaching Train as a drag from Home began stalled the first frames 100-117 ms on the 2 GB emulator,
      // tiers C and A, whenever the most recent pages were others). Tier C keeps the one in the last direction (the
      // neighbour it pre-mounts); A and B keep both, so a page between two others holds at most one page more.
      const nb = nextNeighbour(at);
      add(tabs[nb]?.name, true);
      if (fxRef.current.tier !== 'C') add(tabs[2 * at - nb]?.name, true);
      for (const n of mru.current) add(n);
      const next = new Set([...mountedRef.current].filter((n) => !keep.has(n)));
      const cur = detachedRef.current;
      // pages to drop, outside Home, the neighbours and the most recent, and not needed for pager.dormantAfter: unmounted
      // in this same commit, whether they were detached before or are being detached now. The housekeeping of a settle
      // is then one commit, t.detach after it; a later idle unmount could land on the finger of the next swipe (the
      // wave-2 gate's 117 ms warm-swipe stalls: an unmount 3.4 s after the settle, as the swipe began).
      const warm = new Set<string>();
      const now = Date.now();
      for (const n of [tabs[at]?.name, tabs[at - 1]?.name, tabs[at + 1]?.name]) if (n) needed.current.set(n, now);
      for (const n of [tabs[0]?.name, tabs[at - 1]?.name, tabs[at + 1]?.name, ...mru.current.slice(0, PV.mounted)]) if (n) warm.add(n);
      const gone = [...next].filter((n) => !warm.has(n) && now - (needed.current.get(n) ?? 0) >= PV.dormantAfter);
      if (gone.length) {
        gone.forEach((n) => { next.delete(n); dormant.current.add(n); drawn.current.delete(n); deferred.current.delete(n); });
        setMounted((m) => { const nx = new Set(m); gone.forEach((n) => nx.delete(n)); return nx; });
        // and the pictures only they drew leave the image memory cache (the ones on screen are in use, not cached)
        sleepCancel.current?.();
        const timer = setTimeout(() => { sleepCancel.current = null; void ExpoImage.clearMemoryCache().catch(() => undefined); }, t.detach);
        sleepCancel.current = () => clearTimeout(timer);
        // and on a small phone their memory is collected at the next quiet moment (T2-05: src/fx/device/collect)
        collectWhenQuiet();
      }
      if (!gone.length && next.size === cur.size && [...next].every((n) => cur.has(n))) return;
      setDetached(next);
    };
    detachTimer.current = setTimeout(run, t.detach);
  };

  // the first page: its neighbours are pre-mounted once it has drawn, the launch sting has gone and its first-visit
  // motion has played, and the device is idle
  useEffect(() => { schedulePremount(index); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // the route changed (a tap, a deep link, back, or a committed swipe): bring the pages to it, unless a press or the
  // swipe already sent them there (before the paint, so the page being left is never undisplayed for a frame)
  useLayoutEffect(() => {
    const from = prev.current;
    prev.current = index;
    focusSV.value = index;
    const name = tabs[index]?.name;
    if (name) mru.current = [name, ...mru.current.filter((n) => n !== name)];
    if (heading.current === index) {
      heading.current = -1;
      if (name && !mountedRef.current.has(name)) mountNames([name], false);
      return;
    }
    heading.current = -1;
    goTo(index, from);
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- the pan (created once; reads everything that changes from shared values)
  const rn = useRef({
    dragStart: (_s: number, _dir: number, _around: number[]) => undefined as void,
    commit: (_order: number) => undefined as void,
    limit: () => undefined as void,
  });
  rn.current.dragStart = (s: number, dir: number, around: number[]) => {
    cancelIdle();
    dropWaiting();
    lastDir.current = dir;
    heading.current = -1;
    const names: string[] = [];
    for (const o of around) { const n = tabs[o]?.name; if (n) names.push(n); }
    mountNames(names, true);
    attachNames(names);
    if (WEB) setLive((l) => union(l ?? [s], around));
    if (pointer.current === 'mouse') mouseDragged.current = true;
  };
  rn.current.commit = (order: number) => {
    if (order === indexRef.current) return; // a snap back or a rubber band: no haptic, no route
    haptics.select();
    heading.current = order;
    lastDir.current = order > indexRef.current ? 1 : -1;
    navRef.current(tabs[order].name);
  };
  rn.current.limit = () => { haptics.limit(); };
  const dragStartRN = useCallback((s: number, dir: number, around: number[]) => rn.current.dragStart(s, dir, around), []);
  const commitRN = useCallback((order: number) => rn.current.commit(order), []);
  const limitRN = useCallback(() => rn.current.limit(), []);
  // a finger on the pages holds the pager's queued idle work (pre-mount, detach, unmount) until it lifts
  const touchRN = useCallback((on: boolean) => markPageTouch(on), []);

  const gesture = useMemo(() => {
    const slotToOrder = (s: number) => {
      'worklet';
      const jf = jumpFrom.value;
      const jt = jumpTo.value;
      if (jf >= 0 && s === jt - (jt > jf ? 1 : -1)) return jf;
      return s;
    };
    return Gesture.Pan()
      .activeOffsetX([-SW.activeOffsetX, SW.activeOffsetX])
      .failOffsetY([-SW.failOffsetY, SW.failOffsetY])
      .onTouchesDown((_e, manager) => {
        'worklet';
        if (!enabledSV.value) manager.fail();
      })
      .onBegin(() => {
        'worklet';
        scheduleOnRN(touchRN, true);
      })
      .onStart((e) => {
        'worklet';
        pagerPanning.value = 1;
        cancelAnimation(pos);
        // catch the pages where they are (a float); a jump in flight keeps its two pages, and the drag stays on their side
        const p0 = pos.value;
        const jf = jumpFrom.value;
        const jt = jumpTo.value;
        let lo = 0;
        let hi = lastSV.value;
        if (jf >= 0) { const js = jt - (jt > jf ? 1 : -1); if (jt > jf) lo = js; else hi = js; }
        dragLo.value = lo;
        dragHi.value = hi;
        // the page moves from where it is when the pan activates (the activation slop is not a jump)
        start.value = p0 + e.translationX / widthSV.value;
        limitHit.value = 0;
        calmMove.value = calmSV.value;
        const s = Math.round(p0);
        base.value = slotToOrder(s);
        const dir = e.translationX < 0 ? 1 : -1;
        const around: number[] = [];
        for (let k = -1; k <= 1; k++) { const sl = s + k; if (sl >= lo && sl <= hi) around.push(slotToOrder(sl)); }
        const reveal = s + dir;
        if (reveal >= lo && reveal <= hi) activeMask.value = activeMask.value | (1 << slotToOrder(reveal));
        scheduleOnRN(dragStartRN, slotToOrder(s), dir, around);
      })
      .onUpdate((e) => {
        'worklet';
        const W = widthSV.value;
        const lo = dragLo.value;
        const hi = dragHi.value;
        let p = start.value - e.translationX / W;
        // M40: an asymptotic rubber band past either end, in page units (never flat, at most rubberC of a page)
        const c = SW.rubberC;
        const k = SW.rubberK;
        if (p < lo) p = lo - c * (1 - 1 / (1 + ((lo - p) * k) / c));
        else if (p > hi) p = hi + c * (1 - 1 / (1 + ((p - hi) * k) / c));
        if (!limitHit.value && (p < lo - PV.limitAt || p > hi + PV.limitAt)) { limitHit.value = 1; scheduleOnRN(limitRN); }
        pos.value = p;
        const f = Math.max(lo, Math.min(hi, Math.floor(p)));
        const cl = Math.max(lo, Math.min(hi, Math.ceil(p)));
        const m = activeMask.value | (1 << slotToOrder(f)) | (1 << slotToOrder(cl));
        if (m !== activeMask.value) activeMask.value = m;
        // the halo follows the finger (between a jump's two pages it crosses the icons between them)
        const jf = jumpFrom.value;
        const jt = jumpTo.value;
        if (jf >= 0) {
          const js = jt - (jt > jf ? 1 : -1);
          const frac = Math.max(0, Math.min(1, (p - js) / (jt - js)));
          halo.value = (p - js) * (jt - js) >= 0 && (p - jt) * (js - jt) >= 0 ? jf + frac * (jt - jf) : p;
        } else {
          halo.value = p;
        }
      })
      .onEnd((e) => {
        'worklet';
        const W = widthSV.value;
        const dx = e.translationX;
        const vx = e.velocityX;
        const p = pos.value;
        const go = Math.abs(dx) * Math.abs(vx) > SW.commitProduct || Math.abs(dx) > SW.commitShare * W;
        let to = go ? (dx < 0 ? Math.ceil(p - 0.001) : Math.floor(p + 0.001)) : Math.round(p);
        const s0 = Math.round(start.value);
        to = Math.max(s0 - 1, Math.min(s0 + 1, to));
        to = Math.max(dragLo.value, Math.min(dragHi.value, to));
        const order = slotToOrder(to);
        const calm = calmMove.value === 1;
        activeMask.value = activeMask.value | (1 << order);
        sel.value = order;
        halo.value = calm ? order : withSpring(order, spring.indicator);
        const done = (finished?: boolean) => { 'worklet'; if (finished) arrive(to); };
        pos.value = calm ? withTiming(to, calmFade(), done) : withSpring(to, { ...spring.tab, velocity: -vx / W }, done);
        scheduleOnRN(commitRN, order);
      })
      .onFinalize(() => {
        'worklet';
        pagerPanning.value = 0;
        scheduleOnRN(touchRN, false);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // set in render (it never changes), so a NoSwipeZone on the first page already blocks it
  pager.pan.current = gesture;

  // the web: a mouse drag that moved the pages does not click what it started on (only within 50 ms of the release,
  // only inside the pages; a touch tap is never swallowed, so a tab tapped right after a swipe works)
  useEffect(() => {
    if (!WEB || typeof window === 'undefined') return;
    const down = (e: PointerEvent) => { pointer.current = e.pointerType; mouseDragged.current = false; };
    // event times (when the browser made the events), so a busy frame that delays the click does not let it through
    const up = (e: PointerEvent) => { upAt.current = e.timeStamp; };
    const click = (e: MouseEvent) => {
      if (!mouseDragged.current) return;
      if (e.timeStamp - upAt.current > PV.mouseClickGuard) { mouseDragged.current = false; return; }
      const el = slotRef.current as unknown as HTMLElement | null;
      if (!el || !(e.target instanceof Node) || !el.contains(e.target)) return;
      mouseDragged.current = false;
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('click', click, true);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('click', click, true); };
  }, []);

  // the press path, for the tab bar
  pager.slot.current = {
    startTo: (order: number) => {
      if (order < 0 || order > last) return;
      heading.current = order;
      goTo(order, indexRef.current);
    },
    route: (name: string) => {
      // the web: the router's queue renders the switch in a React transition (time-sliced, behind the motion)
      // (with the tab's own params, as the tab switch keeps them: Train stays on the segment it was left on)
      const tab = tabs.find((x) => x.name === name);
      if (WEB && tab) {
        const params = tabParams.current.get(name);
        router.navigate((params && Object.keys(params).length ? { pathname: tab.href, params } : tab.href) as Href, { inTransition: true });
        return;
      }
      navRef.current(name);
    },
  };

  // ---- the pages
  const cache = useRef(new Map<string, { route: unknown; el: React.ReactNode }>());
  const tabParams = useRef(new Map<string, Record<string, string>>());
  const renderFn = useCallback((descriptor: TabsDescriptor, opts: { isFocused: boolean; loaded: boolean }) => {
    const name = descriptor.route.name;
    const order = tabs.findIndex((tab) => tab.name === name);
    if (order < 0) {
      // a hidden redirect route (plan, me): drawn on top only while it is focused, for the moment it redirects
      return opts.isFocused ? <View key={descriptor.route.key} style={[StyleSheet.absoluteFill, styles.page, { zIndex: 100 }]}>{descriptor.render()}</View> : null;
    }
    tabParams.current.set(name, (descriptor.route.params ?? {}) as Record<string, string>);
    present.current.add(name);
    if (!mounted.has(name) && !opts.isFocused) return null;
    const key = descriptor.route.key ?? name;
    // a page's element is made again only when its route changes (a params change still re-renders that one page)
    const c = cache.current.get(key);
    const el = c && c.route === descriptor.route ? c.el : descriptor.render();
    cache.current.set(key, { route: descriptor.route, el });
    const focused = order === index;
    return <Page key={key} name={name} order={order} pos={pos} jumpFrom={jumpFrom} jumpTo={jumpTo} base={base} calmMove={calmMove}
      shownMask={shownMask} last={last} focus={focusSV}
      activeMask={activeMask} splash={splashSV} width={width} tier={fxs.tier} calm={fxs.calm} focused={focused}
      hideOnWeb={WEB && !focused && !live?.includes(order) && !near.includes(order)} detached={!WEB && !focused && detached.has(name)}
      defer={deferred.current.has(name)} fadeIn={name !== initial.current} onDrawn={pageDrawn}>
      {el}
    </Page>;
  }, [tabs, mounted, index, pos, jumpFrom, jumpTo, base, calmMove, shownMask, last, focusSV, activeMask, splashSV, width, fxs.tier, fxs.calm, live, near, detached, pageDrawn]);

  const slot = useTabSlot({ detachInactiveScreens: false, renderFn, style: styles.slot });
  // pages a drag or a pre-mount reached whose route the navigator has not made yet: their skeleton, in place
  const ghosts = [...new Set([...(live ?? []), ...near])].filter((o) => { const n = tabs[o]?.name; return !!n && o !== index && mounted.has(n) && !present.current.has(n); });
  // under the launch sting (a restored session mounts Home beneath it) the pages are hidden and take no touches
  const hide = splashRunning ? { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const, 'aria-hidden': true, pointerEvents: 'none' as const } : null;
  return <GestureDetector gesture={gesture}>
    <View ref={slotRef} style={styles.slot} collapsable={false} {...hide}>
      {/* native orders siblings by zIndex only among siblings: a ghost below the focused page is drawn before the pages */}
      {ghosts.filter((o) => o < index).map((o) => <GhostPage key={'ghost-' + tabs[o].name} order={o} pos={pos} jumpFrom={jumpFrom} jumpTo={jumpTo} base={base} calmMove={calmMove} shownMask={shownMask} last={last} width={width} tier={fxs.tier} />)}
      {slot}
      {ghosts.filter((o) => o > index).map((o) => <GhostPage key={'ghost-' + tabs[o].name} order={o} pos={pos} jumpFrom={jumpFrom} jumpTo={jumpTo} base={base} calmMove={calmMove} shownMask={shownMask} last={last} width={width} tier={fxs.tier} />)}
    </View>
  </GestureDetector>;
}

type PageProps = {
  name: string; order: number; pos: SharedValue<number>; jumpFrom: SharedValue<number>; jumpTo: SharedValue<number>; base: SharedValue<number>;
  calmMove: SharedValue<number>; shownMask: SharedValue<number>; last: number; focus: SharedValue<number>;
  activeMask: SharedValue<number>; splash: SharedValue<number>; width: number; tier: 'A' | 'B' | 'C'; calm: boolean;
  focused: boolean; hideOnWeb: boolean; detached: boolean; defer: boolean; fadeIn: boolean; onDrawn: (name: string) => void; children: React.ReactNode;
};

type DeckProps = { order: number; pos: SharedValue<number>; jumpFrom: SharedValue<number>; jumpTo: SharedValue<number>; base: SharedValue<number>;
  calmMove: SharedValue<number>; shownMask: SharedValue<number>; last: number; width: number; tier: 'A' | 'B' | 'C' };

/** Where a page of the deck is (d = slot − pos; a page out of a jump's play: 9, parked) and how it is drawn there. */
function useDeck({ order, pos, jumpFrom, jumpTo, base, calmMove, shownMask, last, width, tier }: DeckProps) {
  const d = useDerivedValue(() => {
    const jf = jumpFrom.value;
    const jt = jumpTo.value;
    if (jf >= 0 && order !== jf && order !== jt && (jt > jf ? order < jt : order > jt)) return 9;
    const slot = jf >= 0 && order === jf ? jt - (jt > jf ? 1 : -1) : order;
    return slot - pos.value;
  });
  // the stacking: on native every page keeps zIndex order + 1 (a page's static style): a zIndex written from the UI
  // thread goes through a shadow-tree commit, and Fabric then re-orders the page views (on Android it takes each page's
  // views off the window and back: 100 ms of mounting, and every SVG redrawn, at both ends of a jump). Higher slots on
  // top already put a jump's two pages the right way round (its start page waits beside the target, on its own side).
  // The web keeps the jump's own stacking (cheap there).
  const page = useAnimatedStyle(() => {
    const off = d.value;
    const jf = jumpFrom.value;
    const jt = jumpTo.value;
    const z = jf >= 0 ? (order === jf ? (jt > jf ? 1 : 3) : order === jt ? (jt > jf ? 3 : 1) : 0) : order + 1;
    if (Math.abs(off) >= 1) return WEB ? { opacity: 0, zIndex: z, transform: [{ translateX: off > 0 ? width * 2 : -width * 2 }] } : { opacity: 0, transform: [{ translateX: off > 0 ? width * 2 : -width * 2 }] };
    if (calmMove.value) {
      if (!WEB) {
        // reduced motion, native: of the two pages the one drawn on top (d > 0) fades (in when it is the target, out
        // when it is the page being left) and the one underneath stays opaque, so there is never a dark frame
        return { opacity: off > 0 ? 1 - off : 1, transform: [{ translateX: 0 }] };
      }
      // reduced motion: the incoming page fades in on top; the outgoing one stays opaque underneath, then goes
      const below = order === base.value;
      return { opacity: below ? 1 : 1 - Math.abs(off), zIndex: below ? 2 : 3, transform: [{ translateX: 0 }] };
    }
    if (off >= 0) return WEB ? { opacity: 1, zIndex: z, transform: [{ translateX: off * width }] } : { opacity: 1, transform: [{ translateX: off * width }] };
    const k = Math.min(1, -off);
    const recede = tier === 'A' && !ANDROID ? [{ translateX: off * width * SW.underShift }, { scale: 1 - SW.underScale * k }] : [{ translateX: off * width * SW.underShift }];
    return WEB ? { opacity: 1, zIndex: z, transform: recede } : { opacity: 1, transform: recede };
  });
  const dim = useAnimatedStyle(() => {
    const off = d.value;
    return { opacity: calmMove.value || tier === 'C' || off >= 0 || off <= -1 ? 0 : SW.dim * Math.min(1, -off) };
  });
  // M35: the page on top casts a shadow from its leading edge onto the page it covers
  const edge = useAnimatedStyle(() => {
    const off = d.value;
    return { opacity: calmMove.value || off <= 0 || off >= 1 ? 0 : PV.edgeShadowMax * Math.min(1, off * PV.edgeShadowGain) };
  });
  // Android: the page underneath draws only the part the page on top leaves in view (a clip window moved by transforms
  // alone: the outer layer shifts left by `under`, the inner one back by as much), so a swipe draws about one screen
  // of pages instead of two. Only while the page on top is laid out (it covers the rest), never under reduced motion.
  const under = useDerivedValue(() => {
    if (!ANDROID) return 0;
    const off = d.value;
    if (calmMove.value || off >= 0 || off <= -1) return 0;
    const jf = jumpFrom.value;
    const jt = jumpTo.value;
    const mine = jf >= 0 && order === jf ? jt - (jt > jf ? 1 : -1) : order;
    const up = mine + 1;
    if (up > last) return 0;
    const upOrder = jf >= 0 && up === jt - (jt > jf ? 1 : -1) ? jf : up;
    if (!((shownMask.value >> upOrder) & 1)) return 0;
    // the top page's left edge, in this page's own coordinates (this page is shifted by off·W·underShift)
    const right = (off + 1) * width - off * width * SW.underShift + UNDER_OVERLAP;
    return right >= width ? 0 : Math.min(0, right - width);
  });
  const clipOut = useAnimatedStyle(() => ({ transform: [{ translateX: under.value }] }));
  const clipIn = useAnimatedStyle(() => ({ transform: [{ translateX: -under.value }] }));
  return { d, page, dim, edge, clipOut, clipIn };
}

/** A page a drag or a pre-mount reached before the tab navigator has its route: its skeleton, placed like a page. */
function GhostPage(props: DeckProps) {
  const { page, dim, edge } = useDeck(props);
  return <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden style={[StyleSheet.absoluteFill, WEB ? null : { zIndex: props.order + 1 }, page]}>
    {props.tier !== 'C' ? <Animated.View pointerEvents="none" style={[styles.edge, edge]}><Scrim kind="pagerEdgeR" style={StyleSheet.absoluteFill} /></Animated.View> : null}
    <View style={[StyleSheet.absoluteFill, styles.page]}>
      <PageSkeleton />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.dim, dim]} />
    </View>
  </Animated.View>;
}

const Page = memo(function Page({ name, order, pos, jumpFrom, jumpTo, base, calmMove, shownMask, last, focus, activeMask, splash, width, tier, calm, focused, hideOnWeb, detached, defer, fadeIn, onDrawn, children }: PageProps) {
  const [drawn, setDrawn] = useState(false);
  // a page mounted ahead of its screen draws its skeleton now and its screen in a transition
  const [show, setShow] = useState(!defer);
  useEffect(() => { if (!show) startTransition(() => setShow(true)); }, [show]);
  const { d, page, dim, edge, clipOut, clipIn } = useDeck({ order, pos, jumpFrom, jumpTo, base, calmMove, shownMask, last, width, tier });
  // Android: whether this page's views are laid out (a detached page lays out at 0×0); told a frame later when it
  // turns on, so the page beneath stops drawing under it only once it is really there
  const bit = 1 << order;
  const onLayout = useCallback((e: { nativeEvent: { layout: { width: number; height: number } } }) => {
    if (!ANDROID) return;
    const on = e.nativeEvent.layout.width > 0 && e.nativeEvent.layout.height > 0;
    const set = () => shownMask.modify((m) => { 'worklet'; return on ? m | bit : m & ~bit; });
    if (on) requestAnimationFrame(set); else set();
  }, [shownMask, bit]);
  useEffect(() => () => { if (ANDROID) shownMask.modify((m) => { 'worklet'; return m & ~bit; }); }, [shownMask, bit]);
  // the content fades in once drawn when the page is on screen then (a first visit on native, a page a drag reached)
  const content = useSharedValue(fadeIn ? 0 : 1);
  const reveal = useCallback(() => {
    'worklet';
    if (content.value >= 1) return;
    content.value = Math.abs(d.value) < 1 ? withTiming(1, calm ? calmFade() : timing(CONTENT_FADE, ease.css)) : 1;
  }, [content, d, calm]);
  const drawnHere = useCallback(() => {
    setDrawn(true);
    onDrawn(name);
    if (WEB) reveal(); else scheduleOnUI(reveal);
  }, [onDrawn, name, reveal]);
  // a page that never says it has drawn (a screen outside TabScreen) still loses its placeholder once it has been in
  // front for a moment: a shimmer left under a drawn page would request frames for as long as the page stays mounted
  useEffect(() => {
    if (drawn || !focused) return;
    const timer = setTimeout(() => { setDrawn(true); if (WEB) reveal(); else scheduleOnUI(reveal); }, PV.firstVisitCap + t.premount);
    return () => clearTimeout(timer);
  }, [drawn, focused, reveal]);

  const active = useDerivedValue(() => (splash.value ? 0 : (activeMask.value >> order) & 1));
  // the decorative loops' gate: while pages move, only the focused page's loops run (a page a drag reveals starts its
  // entrance at once and its loops when it has landed)
  const loops = useDerivedValue(() => {
    const a = splash.value ? 0 : (activeMask.value >> order) & 1;
    if (!a || focus.value === order) return a;
    return Math.abs(d.value) < 0.001 && jumpFrom.value < 0 ? 1 : 0;
  });
  // settled (focused and at rest) as a store, so a page coming to rest re-renders only what reads it
  const settled = useMemo(() => createSettledStore(t.detach), []);
  const atRest = useRef(false);
  const focusedRef = useRef(focused);
  const setAtRest = useCallback((v: boolean) => { atRest.current = v; settled.set(focusedRef.current, v); }, [settled]);
  useLayoutEffect(() => { focusedRef.current = focused; settled.set(focused, atRest.current); }, [focused, settled]);
  useAnimatedReaction(() => Math.abs(d.value) < 0.001 && jumpFrom.value < 0, (v, p) => { if (v !== p) scheduleOnRN(setAtRest, v); });
  const motion = useMemo<PageMotion>(() => ({ offset: d as unknown as SharedValue<number>, width }), [d, width]);

  const fade = useAnimatedStyle(() => ({ opacity: content.value }));
  const hidden = !focused;
  const body = <>
    {drawn ? null : <PageSkeleton />}
    <PageReadyContext.Provider value={drawnHere}>
      <PageEnterContext.Provider value={active as unknown as SharedValue<number>}>
        <PageActiveContext.Provider value={loops as unknown as SharedValue<number>}>
          <PageSettledContext.Provider value={settled}>
            <PageMotionContext.Provider value={motion}>
              <PageNameContext.Provider value={name}>
                <Animated.View style={[StyleSheet.absoluteFill, fade]}>{show ? children : null}</Animated.View>
              </PageNameContext.Provider>
            </PageMotionContext.Provider>
          </PageSettledContext.Provider>
        </PageActiveContext.Provider>
      </PageEnterContext.Provider>
    </PageReadyContext.Provider>
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.dim, dim]} />
  </>;
  return <Animated.View
    pointerEvents={hidden ? 'none' : 'auto'}
    accessibilityElementsHidden={hidden}
    importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
    aria-hidden={hidden || undefined}
    onLayout={ANDROID ? onLayout : undefined}
    style={[StyleSheet.absoluteFill, WEB ? null : { zIndex: order + 1 }, hideOnWeb || detached ? styles.gone : null, page]}>
    {tier !== 'C' ? <Animated.View pointerEvents="none" style={[styles.edge, edge]}><Scrim kind="pagerEdgeR" style={StyleSheet.absoluteFill} /></Animated.View> : null}
    {!ANDROID ? <View style={[StyleSheet.absoluteFill, styles.page]}>{body}</View>
      : <Animated.View style={[StyleSheet.absoluteFill, styles.clip, clipOut]}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.page, clipIn]}>{body}</Animated.View>
      </Animated.View>}
  </Animated.View>;
}, (a, b) => a.order === b.order && a.focused === b.focused && a.hideOnWeb === b.hideOnWeb && a.detached === b.detached
  && a.tier === b.tier && a.calm === b.calm && a.width === b.width && a.last === b.last && a.children === b.children);

/** A tab page that has not drawn yet: the shape of a tab header and its first cards, shimmering (also the root layout's
 *  arrival veil, drawn in the same place). */
export function PageSkeleton() {
  const insets = useSafeAreaInsets();
  return <View pointerEvents="none" accessibilityLabel="Loading" style={[StyleSheet.absoluteFill, styles.skeleton, { paddingTop: insets.top + 28 }]}>
    <View style={styles.skeletonColumn}>
      <Skeleton width={150} height={40} radius={8} />
      <Skeleton width={230} height={14} radius={6} style={styles.skeletonSub} />
      <Skeleton height={180} radius={fx.radius.card} style={styles.skeletonCard} />
      <Skeleton height={120} radius={fx.radius.card} style={styles.skeletonCard} />
      <Skeleton height={120} radius={fx.radius.card} style={styles.skeletonCard} />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  skeleton: { paddingHorizontal: 24 },
  skeletonColumn: { width: '100%', maxWidth: COLUMN, alignSelf: 'center' },
  skeletonSub: { marginTop: 10 },
  skeletonCard: { marginTop: 24 },
  // clipped: a page waiting off to the side (±2 widths) must never widen the document, or a mobile browser grows its
  // layout viewport to fit it mid-switch (every page then lays out three screens wide)
  // Android: the slot paints no ground (each page paints its own, and what is beneath is black); a fill here was drawn
  // under every page on every frame (C01, the tabs' overdraw)
  slot: { flex: 1, backgroundColor: ANDROID ? fx.premium.transparent : fx.bg.deep, overflow: 'hidden' },
  page: { backgroundColor: fx.bg.deep, overflow: 'hidden' },
  clip: { overflow: 'hidden' },
  // the leading-edge shadow sits just outside the page, over the page it covers
  edge: { position: 'absolute', top: 0, bottom: 0, left: -PV.edgeShadow, width: PV.edgeShadow },
  dim: { backgroundColor: fx.premium.pagerDim },
  gone: { display: 'none' },
});
