/* Screen containers (THEME §7, §11.1).
   - TabScreen: a tab page on the black canvas. Its scroll offset is shared (useTabScroll) so the header can collapse
     and the motion kit's StretchyHeader and CompactBar can follow it; pull to refresh in Bioptime red (a light haptic at
     the trigger); content centred in a 520 pt column on wide screens (`bleed` children span the width: hero photos);
     a bottom clearance so the last element ends above the floating tab bar; tapping the active tab scrolls it to the
     top. `sticky` is drawn over the top of the page (a compact bar). Sections can be scrolled to by name: wrap one in
     <ScrollAnchor name>, then pass `anchor` (a route's ?section=) or call useScrollToAnchor()(name); the section lands
     just under the compact bar (smoothly; at once with reduced motion). An anchor that mounts later (after loading)
     is scrolled to when it appears. Its first layout tells the tab pager the page has drawn (a first visit slides in
     only then). Over the top inset, the status bar's backing (StatusScrim): a scrim at rest, solid once the page
     scrolls under the clock, handing the top over to the compact bar when there is one (`sticky`).
   - FlowScreen: the pre-main flows (sign-in, codes, consent, quiz): #080808 with the 2 px red hairline at the very
     top, a centred column (384 auth, 448 onboarding), keyboard aware, entering with the earlier app's flow motion (opacity,
     y 10 → 0, 400 ms expo). `backdrop` sits behind everything (the sign-in photo). The column scrolls under the
     status bar's backing (StatusScrim), below the red hairline. Keyboard: iOS pads with a KeyboardAvoidingView; Android
     draws edge to edge, where the root stack's KeyboardFit (src/fx/Sheet) ends the screen at the keyboard's top edge,
     so the footer rides above the keyboard and the column's scroll view shrinks (the focused field scrolled into
     view). The backdrop keeps the window's full height meanwhile (a photo never rescales as the keyboard opens).
   - FlowEnter starts on the page-active edge (src/fx/nav/pageReady): a page that is pre-mounted, parked or under the
     launch sting holds its start state until it is the one in front.
   - FlowSwap: an in-place swap of a flow's step. The outgoing step stays mounted for its exit (absolute, inert from its
     first exit frame: no touches, hidden from assistive technology, focus to the incoming heading) and leaves upward
     while the incoming one rises in, overlapping, so there is never a frame with neither. `fill`: full-screen steps
     (the swap and its incoming step fill the space they are given; the outgoing one keeps the whole box). */
import { useIsFocused, useScrollToTop } from 'expo-router';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { scrollTo, useAnimatedReaction, useAnimatedRef, useAnimatedStyle, useScrollOffset, useSharedValue, withDelay, withTiming, type AnimatedRef, type SharedValue } from 'react-native-reanimated';
import { measureView } from './motion/measured';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fx } from '@/theme';
import { haptics } from './device/haptics';
import { calmFade, ease, t, timing, useFx } from './effects';
import { COLUMN, navClearance } from './layout';
import { CompactBar } from './motion/CompactBar';
import { pageScrollMoving } from './motion/gestureState';
import { doneOnce } from './motion/once';
import { motionValues } from './motion/tokens';
import { useOwnChrome } from './nav/chrome';
import { markPageScrolling, PageNameContext, usePageActive, usePageReady, usePageSettled } from './nav/pageReady';
import { useKeyboardInsetPad } from './Sheet';
import { StatusScrim } from './StatusScrim';
import { useToastClearance, useTopToastClearance } from './Toast';

const TabScrollContext = createContext<SharedValue<number> | null>(null);

/** How long the decorative loops stay held after a scroll's last frame (a number the scroll worklet captures). */
const SCROLL_PAUSE_MS = motionValues.loop.scrollPauseMs;
const SCROLL_ON = () => markPageScrolling(true);
const SCROLL_OFF = () => markPageScrolling(false);
/** A drag ended: momentum may follow (it reports its own begin); hold a little longer than the plain end. */
const SCROLL_SETTLING = () => markPageScrolling(true);

/** Native: a tab page's scroll offset when the pager unmounted it (a dormant page, src/fx/nav/Pager), by tab name; the
 *  page starts there when it is mounted again. */
const scrollMemory = new Map<string, number>();

/** The scroll offset of the TabScreen around this component (null outside one). */
export function useTabScroll(): SharedValue<number> | null { return useContext(TabScrollContext); }

type AnyRef = AnimatedRef<React.ComponentRef<typeof Animated.View>>;
type Anchors = { register: (name: string, ref: AnyRef) => () => void; scrollTo: (name: string) => boolean };
const AnchorContext = createContext<Anchors | null>(null);

/** Scrolls the TabScreen around it to a <ScrollAnchor name>; false when no such anchor is on the page yet (it is then
 *  scrolled to when it mounts). Outside a TabScreen it does nothing. */
export function useScrollToAnchor(): (name: string) => boolean {
  const ctx = useContext(AnchorContext);
  return useCallback((name: string) => (ctx ? ctx.scrollTo(name) : false), [ctx]);
}

/** A section a TabScreen can scroll to by name (a route's ?section=). Wraps its children in a plain view. */
export function ScrollAnchor({ name, children, style }: { name: string; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const ctx = useContext(AnchorContext);
  const ref = useAnimatedRef<React.ComponentRef<typeof Animated.View>>();
  useEffect(() => (ctx ? ctx.register(name, ref as AnyRef) : undefined), [ctx, name, ref]);
  return <Animated.View ref={ref} collapsable={false} style={style}>{children}</Animated.View>;
}

export function TabScreen({ children, refreshing, onRefresh, sticky, bleedTop, contentStyle, scroll = true, testID, anchor }: {
  children: React.ReactNode; refreshing?: boolean; onRefresh?: () => void; sticky?: React.ReactNode;
  /** Draw a full-width element above the column (a hero photo), outside the 520 pt cap. */
  bleedTop?: React.ReactNode; contentStyle?: StyleProp<ViewStyle>; scroll?: boolean; testID?: string;
  /** Scroll to this <ScrollAnchor> once it is on the page (and again whenever it changes). */
  anchor?: string | null;
}) {
  const insets = useSafeAreaInsets();
  const ref = useAnimatedRef<Animated.ScrollView>();
  const offset = useScrollOffset(ref);
  useScrollToTop(ref as unknown as Parameters<typeof useScrollToTop>[0]);
  // the decorative loops hold while the page scrolls (gestureState pageScrollMoving): set on each scroll frame, let go
  // loop.scrollPauseMs after the last one, all on the UI thread
  useAnimatedReaction(() => offset.get(), (y, was) => {
    if (was == null || y === was) return;
    pageScrollMoving.set(1);
    pageScrollMoving.set(withDelay(SCROLL_PAUSE_MS, withTiming(0, { duration: 0 })));
  });
  // native: a page the pager unmounted and mounts again starts where it was left
  const pageName = useContext(PageNameContext);
  const remember = Platform.OS !== 'web' && !!pageName;
  // Android, inside a pager page: the page already paints the same black ground right under this one
  const groundless = Platform.OS === 'android' && !!pageName;
  const [startY] = useState(() => (remember && pageName ? scrollMemory.get(pageName) ?? 0 : 0));
  useEffect(() => {
    if (!remember || !pageName) return;
    scrollMemory.delete(pageName);
    return () => { scrollMemory.set(pageName, offset.get()); };
  }, [remember, pageName, offset]);
  const { calm } = useFx();
  const anchorRefs = useRef(new Map<string, AnyRef>());
  const pending = useRef<string | null>(null);
  const below = insets.top + motionValues.header.barHeight + 12; // where a section lands: under the compact bar
  const goTo = useCallback((name: string): boolean => {
    const target = anchorRefs.current.get(name);
    if (!target || !scroll) { pending.current = name; return false; }
    pending.current = null;
    const animated = !calm;
    scheduleOnUI(() => {
      'worklet';
      const a = measureView(target);
      const v = measureView(ref);
      if (!a || !v) return;
      scrollTo(ref, 0, Math.max(0, offset.get() + a.pageY - v.pageY - below), animated);
    });
    return true;
  }, [scroll, calm, ref, offset, below]);
  const anchors = useMemo<Anchors>(() => ({
    register: (name, r) => {
      anchorRefs.current.set(name, r);
      // asked for before it existed (the page was loading): go once it has been laid out
      let timer: ReturnType<typeof setTimeout> | null = pending.current === name ? setTimeout(() => { timer = null; goTo(name); }, 350) : null;
      return () => { if (timer) clearTimeout(timer); if (anchorRefs.current.get(name) === r) anchorRefs.current.delete(name); };
    },
    scrollTo: goTo,
  }), [goTo]);
  useEffect(() => {
    if (!anchor) return;
    const timer = setTimeout(() => { goTo(anchor); }, 350); // after the first layout of what is already there
    return () => clearTimeout(timer);
  }, [anchor]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = onRefresh ? <RefreshControl
    refreshing={!!refreshing}
    onRefresh={() => { haptics.refresh(); onRefresh(); }}
    tintColor={fx.red.brand}
    colors={[fx.red.brand]}
    progressBackgroundColor={fx.bg.card}
    progressViewOffset={insets.top}
  /> : undefined;
  const column = <View style={[styles.column, contentStyle]}>{children}</View>;
  // the tab pager slides a first-visited page in once it has drawn (src/fx/nav/pageReady); a detached page lays out
  // at 0×0, which is not a draw
  const pageReady = usePageReady();
  // while the compact bar shows, a top toast starts below it (never over its actions); read once the pages are at rest
  const inFront = usePageSettled();
  const [stickyH, setStickyH] = useState(0);
  useTopToastClearance(stickyH, !!sticky && inFront && stickyH > 0);
  return <AnchorContext.Provider value={anchors}><TabScrollContext.Provider value={offset}>
    <View testID={testID} style={[styles.screen, groundless ? styles.groundless : null]} onLayout={pageReady ? (e) => { const l = e.nativeEvent.layout; if (l.width && l.height) pageReady(); } : undefined}>
      {scroll ? <Animated.ScrollView
        ref={ref}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        showsVerticalScrollIndicator={false}
        refreshControl={refresh}
        contentOffset={startY ? { x: 0, y: startY } : undefined}
        // the pager's idle work waits while a page scrolls (src/fx/nav/pageReady markPageScrolling)
        onScrollBeginDrag={SCROLL_ON}
        onScrollEndDrag={SCROLL_SETTLING}
        onMomentumScrollBegin={SCROLL_ON}
        onMomentumScrollEnd={SCROLL_OFF}
        contentContainerStyle={{ paddingBottom: navClearance(insets.bottom) }}>
        {bleedTop}
        {column}
      </Animated.ScrollView> : <View style={[styles.fill, { paddingBottom: navClearance(insets.bottom) }]}>{bleedTop}{column}</View>}
      {scroll ? <StatusScrim scrollY={offset} color={fx.bg.deep} handover={!!sticky} /> : null}
      {sticky ? <View pointerEvents="box-none" style={styles.sticky} onLayout={(e) => { const l = e.nativeEvent.layout; if (l.width) setStickyH(Math.round(l.y + l.height)); }}>{sticky}</View> : null}
    </View>
  </TabScrollContext.Provider></AnchorContext.Provider>;
}

/** A tab's compact bar (PREMIUM §1.4): its title in the blurred bar that takes the big title's place as the page
 *  scrolls. Pass it as TabScreen's `sticky`. Mounted only once the page has scrolled to where it starts to show: its
 *  background takes touches even while transparent, and would otherwise sit over the header's own buttons. */
export function TabTitleBar({ title }: { title: string }) {
  const y = useTabScroll();
  const [shown, setShown] = useState(false);
  useAnimatedReaction(() => (y ? y.get() > motionValues.header.barFrom - 4 : false), (v, prev) => { if (v !== prev) scheduleOnRN(setShown, v); }, [y]);
  return y && shown ? <CompactBar scrollY={y} title={title} /> : null;
}

/** The earlier app's flow entrance: opacity 0 → 1 and y 10 → 0 over 400 ms (at rest with reduced motion and in the
 *  pre-rendered HTML). `web` limits it to the web, where native-stack transitions do not run (overlays). It starts
 *  (after `delay`) on the page-active edge: a page nobody sees yet holds its start state. */
export function FlowEnter({ children, duration = t.flow, delay = 0, webOnly, off, style }: { children: React.ReactNode; duration?: number; delay?: number; webOnly?: boolean; off?: boolean; style?: StyleProp<ViewStyle> }) {
  const { calm, inHtml } = useFx();
  const still = calm || inHtml || !!off || (webOnly && Platform.OS !== 'web');
  const p = useSharedValue(still ? 1 : 0);
  const started = useSharedValue(still ? 1 : 0);
  const active = usePageActive();
  useEffect(() => { if (still) { started.set(1); p.set(1); } }, [still, p, started]);
  useAnimatedReaction(() => active.get(), (a, prev) => {
    if (still || started.get() || a !== 1 || prev === 1) return;
    started.set(1);
    p.set(withDelay(delay, withTiming(1, timing(duration))));
  }, [still, delay, duration]);
  const a = useAnimatedStyle(() => { const k = p.get(); return k === 1 ? { opacity: 1, transform: [] } : { opacity: k, transform: [{ translateY: 10 * (1 - k) }] }; });
  return <Animated.View style={[styles.fill, style, a]}>{children}</Animated.View>;
}

export type FlowSwapTiming = { exitY: number; exitMs: number; enterY: number; enterMs: number; enterAt: number };

type SwapState = { id: string | number; leaving: { id: string | number; node: React.ReactNode } | null; swaps: number };

/** An in-place swap of a flow's step: when `id` changes, the previous step leaves (opacity 1 → 0, y 0 → exitY over
 *  exitMs, ease.exit) while the new one enters (opacity 0 → 1, y enterY → 0 over enterMs, ease.expo, from enterAt).
 *  Default timing motionValues.flowSwap. Reduced motion: a 150 ms crossfade; tier C: a 200 ms fade. `onExited` once
 *  the outgoing step has gone. The first step is drawn at rest. `fill`: for full-screen steps, the swap fills its
 *  parent (flex 1), the incoming step fills the swap and the outgoing one is held to the whole box (top to bottom). */
export function FlowSwap({ id, children, timing: swap, onExited, style, fill }: { id: string | number; children: React.ReactNode; timing?: FlowSwapTiming; onExited?: () => void; style?: StyleProp<ViewStyle>; fill?: boolean }): React.JSX.Element {
  const [state, setState] = useState<SwapState>({ id, leaving: null, swaps: 0 });
  const last = useRef<React.ReactNode>(children);
  if (state.id !== id) {
    // the step changed: what was drawn for the old id becomes the leaving layer (same key, so it keeps its state)
    setState({ id, leaving: { id: state.id, node: last.current }, swaps: state.swaps + 1 });
  } else {
    last.current = children;
  }
  const exitedRef = useRef(onExited);
  exitedRef.current = onExited;
  const leftKey = state.leaving ? String(state.leaving.id) : null;
  const left = useCallback(() => {
    setState((s) => (s.leaving && String(s.leaving.id) === leftKey ? { ...s, leaving: null } : s));
    exitedRef.current?.();
  }, [leftKey]);
  const tm = swap ?? motionValues.flowSwap;
  const layers: React.ReactNode[] = [];
  if (state.leaving) layers.push(<SwapLayer key={'k' + String(state.leaving.id)} phase="leave" tm={tm} onLeft={left} fill={fill}>{state.leaving.node}</SwapLayer>);
  layers.push(<SwapLayer key={'k' + String(state.id)} phase={state.swaps ? 'enter' : 'rest'} tm={tm} fill={fill}>{state.id === id ? children : last.current}</SwapLayer>);
  return <View style={[styles.swap, fill ? styles.fill : null, style]}>{layers}</View>;
}

function SwapLayer({ phase, tm, onLeft, fill, children }: { phase: 'rest' | 'enter' | 'leave'; tm: FlowSwapTiming; onLeft?: () => void; fill?: boolean; children: React.ReactNode }) {
  const { calm, inHtml, tier } = useFx();
  const still = calm || inHtml;
  const fadeOnly = still || tier === 'C';
  const p = useSharedValue(phase === 'enter' && !inHtml ? 0 : 1); // 0 → 1 entering
  const out = useSharedValue(0); // 0 → 1 leaving
  const ref = useRef<React.ComponentRef<typeof Animated.View>>(null);
  const leaving = phase === 'leave';
  useEffect(() => {
    if (phase !== 'enter' || inHtml) return;
    p.set(calm ? withTiming(1, calmFade()) : tier === 'C' ? withTiming(1, timing(t.fast, ease.linear)) : withDelay(tm.enterAt, withTiming(1, timing(tm.enterMs))));
    // the incoming step takes the focus when the outgoing one had it (a screen reader or keyboard user stays in the flow)
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const el = ref.current as unknown as HTMLElement | null;
      const heading = el?.querySelector?.('[role="heading"], h1, h2') as HTMLElement | null;
      const focus = document.activeElement;
      if (heading && (!focus || focus === document.body || !el?.contains(focus))) {
        if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!leaving) return;
    const ms = calm ? t.calm : tier === 'C' ? t.fast : tm.exitMs;
    const once = doneOnce(() => onLeft?.(), ms + motionValues.overlay.fallbackExtra);
    const finish = (finished?: boolean) => { 'worklet'; if (finished) scheduleOnRN(once.done); };
    out.set(calm ? withTiming(1, calmFade(), finish) : tier === 'C' ? withTiming(1, timing(t.fast, ease.linear), finish) : withTiming(1, timing(tm.exitMs, ease.exit), finish));
    return () => once.cancel();
  }, [leaving]); // eslint-disable-line react-hooks/exhaustive-deps
  const a = useAnimatedStyle(() => {
    if (leaving) { const o = out.get(); return { opacity: 1 - o, transform: [{ translateY: fadeOnly ? 0 : tm.exitY * o }] }; }
    const k = p.get();
    return { opacity: k, transform: [{ translateY: fadeOnly ? 0 : tm.enterY * (1 - k) }] };
  });
  const inert = leaving ? { pointerEvents: 'none' as const, accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const, 'aria-hidden': true } : null;
  return <Animated.View ref={ref} style={[leaving ? styles.swapLeaving : null, fill ? (leaving ? styles.swapLeavingFill : styles.fill) : null, a]} {...inert}>{children}</Animated.View>;
}

export function FlowScreen({ children, width = 'auth', backdrop, footer, scroll = true, hairline = true, center, contentStyle, enter = true }: {
  children: React.ReactNode; width?: 'auth' | 'onboarding' | number; backdrop?: React.ReactNode; footer?: React.ReactNode; scroll?: boolean; hairline?: boolean; center?: boolean; contentStyle?: StyleProp<ViewStyle>;
  /** false: no entrance for the whole column (its parts enter on their own: the sign-in while the splash's mark flies in). */
  enter?: boolean;
}) {
  const insets = useSafeAreaInsets();
  useOwnChrome(); // a flow draws its own top (the hairline, its back links)
  const focused = useIsFocused();
  const scroller = useAnimatedRef<Animated.ScrollView>();
  const scrollY = useScrollOffset(scroller);
  const [footerH, setFooterH] = useState(0);
  useToastClearance(footerH, !!footer && focused);
  const max = width === 'auth' ? 384 : width === 'onboarding' ? 448 : width;
  // the footer pads the navigation bar's inset only while no keyboard covers the bar (Android)
  const footerPad = useKeyboardInsetPad(16, insets.bottom);
  // the screen's full height (its tallest layout: before any keyboard took its room), for the backdrop
  const [fullH, setFullH] = useState(0);
  const column = <View style={[styles.flowColumn, { maxWidth: max, paddingTop: insets.top + 32, paddingBottom: (footer ? 16 : 32) + (footer ? 0 : insets.bottom) }, center ? styles.center : null, contentStyle]}>{children}</View>;
  return <View style={styles.flow} onLayout={backdrop ? (e) => { const h = Math.round(e.nativeEvent.layout.height); if (h > fullH) setFullH(h); } : undefined}>
    {backdrop ? <View pointerEvents="box-none" style={[styles.flowBackdrop, fullH ? { height: fullH } : styles.flowBackdropFill]}>{backdrop}</View> : null}
    {hairline ? <View style={styles.hairline} accessible={false} /> : null}
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
      <FlowEnter off={!enter}>
        {scroll ? <Animated.ScrollView ref={scroller} scrollEventThrottle={16} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.grow}>{column}</Animated.ScrollView> : column}
        {footer ? <Animated.View onLayout={(e) => { const h = Math.round(e.nativeEvent.layout.height); if (h > 0) setFooterH(h); }} style={[styles.flowFooter, { maxWidth: max }, footerPad]}>{footer}</Animated.View> : null}
      </FlowEnter>
    </KeyboardAvoidingView>
    {scroll ? <StatusScrim scrollY={scrollY} color={fx.bg.base} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: fx.bg.deep },
  groundless: { backgroundColor: fx.premium.transparent },
  fill: { flex: 1 },
  grow: { flexGrow: 1 },
  column: { width: '100%', maxWidth: COLUMN, alignSelf: 'center' },
  sticky: { position: 'absolute', left: 0, right: 0, top: 0 },
  flow: { flex: 1, backgroundColor: fx.bg.base },
  // the window's height whatever the screen's (the keyboard's room on Android), anchored at the top
  flowBackdrop: { position: 'absolute', left: 0, right: 0, top: 0 },
  flowBackdropFill: { bottom: 0 },
  swap: { position: 'relative' },
  swapLeaving: { position: 'absolute', left: 0, right: 0, top: 0 },
  swapLeavingFill: { bottom: 0 },
  hairline: { position: 'absolute', top: 0, left: 0, right: 0, height: 2, backgroundColor: fx.red.brand, zIndex: 5 },
  flowColumn: { width: '100%', alignSelf: 'center', paddingHorizontal: 24, flexGrow: 1 },
  center: { justifyContent: 'center' },
  flowFooter: { width: '100%', alignSelf: 'center', paddingHorizontal: 24, paddingTop: 12 },
});
