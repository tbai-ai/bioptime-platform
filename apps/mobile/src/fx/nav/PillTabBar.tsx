/* The floating glass tab bar (THEME §11.1, PREMIUM §1.3A, motion v2 "the Deck"). A pill 24 pt above the bottom (or 8
   above the home indicator), black/60 with a 24 pt blur where the device allows (else black/94), a white/10 border and
   a soft shadow; nine 56 pt icon-only tabs with 4 pt gaps (568 pt in all, so phones scroll it sideways). Each tab is a
   TabTrigger (expo-router/ui) labelled for screen readers; a long press shows its name above it.
   - A press starts the motion on the release itself: the halo (a 56 pt red/12 circle) glides to the tab on the UI
     thread and the pages start with it (src/fx/nav/Pager startTo); the route follows (on the web one frame later, in a
     transition). While a finger drags the pages, the halo rides their position and lights the icons it passes.
   - Each icon is one SVG view (src/fx/nav/TabIcon) whose stroke goes from zinc-500 at 1.5 to Bioptime red at 2.5. On a
     tap only the source and the target change colour (150 ms); the target pops to 1.1 on the earlier app's nav spring
     (it peaks near 1.14; no overshoot at tier C) and the source springs back. A press dips the icon to .9 from the
     touch-down (a scroll of the strip springs it back). Reduced motion: colour only.
   - The strip follows the halo on the UI thread, so the chosen tab is in view on every frame. While tabs hide at either
     end, that end fades out (a true mask on the web, a solid-to-clear edge elsewhere) under a chevron with its own
     room (narrower on phones under 360 pt). The right chevron nudges every 1.6 s (not with reduced motion or at tier C,
     the light tier's still idle loops; only for the motion budget, and not while an overlay or a sheet route covers the
     tabs or the launch sting runs). The
     chevrons are decoration: hidden from screen readers and letting a tap through to the tab under them.
   - Where the pill cannot blur (Android, touch-first web, tier C) it is near-opaque black (black/94) and a soft black
     fade sits under the bar area, so the page dissolves before it reaches the pill. Coach, whose composer sits right
     above the pill, has none (the fade follows the halo, so it eases out and in as the pager crosses Coach).
   - The bar rises in once per launch (y 50 → 0, after 200 ms, the soft nav spring), after the launch sting has left,
     and hides while the keyboard is up.
   - A red dot on Coach while messages wait; its name then says so too ("Coach, new messages"). While a tab with a dot
     is scrolled out of the pill, the chevron on that side carries the dot, so it is never hidden. */
import { BlurView } from 'expo-blur';
import { useSegments } from 'expo-router';
import React, { createContext, startTransition, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, View, useWindowDimensions, type GestureResponderEvent, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, interpolate, scrollTo, useAnimatedReaction, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fx } from '@/theme';
import { useSplashState } from '../brand/SplashHost';
import { calmFade, ease, motionValues, spring, t, timing, tk, useFx } from '../effects';
import { Scrim } from '../Gradient';
import { Icon } from '../Icon';
import { navBottom } from '../layout';
import { T } from '../Text';
import { usePager } from './Pager';
import { TabIcon } from './TabIcon';
import { PRESS_PROPS } from '../press';
import { useMotionBudget } from '../motion/budget';
import { pagerPanning, warmUnder } from '../motion/gestureState';
import type { TabDef } from './tabs';

const ITEM = 56;
const GAP = 4;
const PAD_X = 16;
const PAD_Y = 8;
const PILL = motionValues.pill;
/** How far the fade under the bar reaches above the pill's top edge. */
const BASE_FADE = 36;
/** Tabs whose screen ends above the bar on its own (Coach: the composer), so no fade is drawn there. */
const BARE_TABS: readonly string[] = ['coach'];
let entered = false;
/** Android: the pill's soft shadow is drawn by a view of its own inside a hardware layer, `SHADOW_ROOM` larger than the
 *  pill on every side (the blur's reach: 24 pt blur, 4 pt drop), so it is rasterised once and only composited after.
 *  On the pill itself it was a blurred stadium Skia cannot draw on the GPU: a 1080 × 351 px mask drawn in software and
 *  uploaded again on every frame of every scroll and swipe (release C01 / G2-1). The same shadow, the same place. */
const SHADOW_LAYER = Platform.OS === 'android';
const SHADOW_ROOM = 40;
/** Native: under the launch sting's lockup the pill waits at a trace opacity (gestureState.warmUnder), so its glass,
 *  shadow and icons are drawn once before the black fades. */
const WARM = Platform.OS === 'web' ? 0 : motionValues.reveal.warmOpacity;

/** The web's fade mask for the pill's scroller, at an end where tabs hide: clear under the chevron and its room
 *  (`clear`), then fading in to full by `edge`, so a half-scrolled icon never sits under or against the chevron. */
function edgeMask(left: boolean, right: boolean, edge: number, clear: number): ViewStyle | null {
  if (Platform.OS !== 'web' || (!left && !right)) return null;
  const g = `linear-gradient(to right, ${left ? `transparent 0px, transparent ${clear}px, black ${edge}px` : 'black 0px'}, ${right ? `black calc(100% - ${edge}px), transparent calc(100% - ${clear}px), transparent 100%` : 'black 100%'})`;
  return { maskImage: g, WebkitMaskImage: g } as ViewStyle;
}

type BarCtx = { frames: SharedValue<number[]>; setFrame: (order: number, x: number) => void; showTip: (order: number, label: string) => void; setBadge: (order: number, on: boolean) => void };
const BarContext = createContext<BarCtx | null>(null);

export function PillTabBar({ children, count }: { children: React.ReactNode; count: number }) {
  const pager = usePager();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { calm, blurNav, inHtml } = useFx();
  const sting = useSplashState() === 'running';
  const segments = useSegments() as string[];
  const covered = segments[0] !== '(tabs)'; // an overlay or a sheet route is over the tabs
  // narrow phones keep more icons in view (the window, not the pill: the pill is ≈ 358 at a 390 window)
  const EDGE = width < PILL.narrowBelow ? PILL.edgeNarrow : PILL.edgeWide;
  const CLEAR = width < PILL.narrowBelow ? PILL.clearNarrow : PILL.clearWide;
  const scroll = useAnimatedRef<Animated.ScrollView>();
  const frames = useSharedValue<number[]>(Array.from({ length: count }, (_, i) => PAD_X + i * (ITEM + GAP)));
  const [viewW, setViewW] = useState(0);
  const [x, setX] = useState(0);
  const scrollX = useSharedValue(0);
  const viewWSV = useSharedValue(0);
  const contentW = count * ITEM + (count - 1) * GAP + PAD_X * 2;
  const [keyboard, setKeyboard] = useState(false);
  const [tip, setTip] = useState<{ order: number; label: string; x: number } | null>(null);
  const [badges, setBadges] = useState<number[]>([]);
  const badgesSV = useSharedValue<number[]>([]);
  useEffect(() => { badgesSV.value = badges; }, [badges, badgesSV]);
  const setBadge = useCallback((order: number, on: boolean) => setBadges((b) => (b.includes(order) === on ? b : on ? [...b, order] : b.filter((o) => o !== order))), []);
  useEffect(() => { if (!tip) return; const timer = setTimeout(() => setTip(null), 1400); return () => clearTimeout(timer); }, [tip]);

  // entrance, once per launch (after the launch sting: a restored session mounts the tabs under it)
  const still = calm || inHtml || entered;
  const rise = useSharedValue(still ? 1 : 0);
  useEffect(() => { if (!still && !sting) { entered = true; rise.value = withDelay(200, withSpring(1, spring.navIn)); } }, [still, sting, rise]);
  const enter = useAnimatedStyle(() => ({ opacity: Math.max(rise.value, WARM * warmUnder.value), transform: [{ translateY: 50 * (1 - rise.value) }] }));
  const shadowEnter = useAnimatedStyle(() => ({ opacity: Math.max(rise.value, WARM * warmUnder.value), transform: [{ translateY: 50 * (1 - rise.value) }] }));
  // Android: where the pill sits in its row, for its shadow's layer (SHADOW_LAYER)
  const [pillBox, setPillBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const onPillLayout = SHADOW_LAYER ? (e: LayoutChangeEvent) => {
    const { x: px, y: py, width: pw, height: ph } = e.nativeEvent.layout;
    if (!pw || !ph) return;
    setPillBox((b) => (b && b.x === px && b.y === py && b.w === pw && b.h === ph ? b : { x: px, y: py, w: pw, h: ph }));
  } : undefined;

  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboard(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboard(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  // the strip follows the halo on the UI thread while it travels, so the chosen tab is in view on every frame
  const halo = pager?.halo;
  const sel = pager?.sel;
  const index = pager?.index ?? 0;
  useAnimatedReaction(() => (halo ? halo.value : -1), (h, prev) => {
    const vw = viewWSV.value;
    if (!halo || !sel || h < -0.5 || !vw || contentW <= vw) return;
    const s = sel.value;
    const near = Math.abs(h - s) <= 0.01;
    if (near && !(prev !== null && Math.abs(prev - s) > 0.01)) return;
    const at = near ? s : h;
    scrollTo(scroll, Math.max(0, Math.min(contentW - vw, PAD_X + at * (ITEM + GAP) - (vw - ITEM) / 2)), 0, false);
  }, [contentW]);
  // and lands on the chosen tab once the pill's width is known (a deep link into Profile)
  useEffect(() => {
    if (!viewW || contentW <= viewW) return;
    const target = PAD_X + index * (ITEM + GAP) - (viewW - ITEM) / 2;
    scroll.current?.scrollTo({ x: Math.max(0, Math.min(contentW - viewW, target)), animated: false });
  }, [viewW]); // eslint-disable-line react-hooks/exhaustive-deps

  // the edge fades and dots follow the scroll offset; the JS state changes only when a threshold is crossed
  const onScroll = useAnimatedScrollHandler((e) => { scrollX.value = e.contentOffset.x; });
  useAnimatedReaction(() => {
    const sx = scrollX.value;
    const vw = viewWSV.value;
    if (!vw) return -1;
    let b = (sx > 8 ? 1 : 0) | (contentW - vw - sx > 8 ? 2 : 0);
    for (const o of badgesSV.value) {
      const m = PAD_X + o * (ITEM + GAP) + ITEM / 2 - sx;
      if (m < EDGE) b |= 4;
      if (m > vw - EDGE) b |= 8;
    }
    return b;
  }, (b, prev) => { if (b !== prev) scheduleOnRN(setX, scrollX.value); }, [contentW, EDGE]);

  const bare = (pager?.tabs ?? []).map((tab, i) => (BARE_TABS.includes(tab.name) ? i : -1)).filter((i) => i >= 0);
  const baseStyle = useAnimatedStyle(() => {
    const p = halo ? halo.value : index;
    let o = 1;
    for (const i of bare) o = Math.min(o, Math.abs(p - i));
    return { opacity: Math.min(1, o) };
  });
  const haloStyle = useAnimatedStyle(() => {
    const f = frames.value;
    const p = halo ? halo.value : 0;
    const lo = Math.max(0, Math.min(f.length - 1, Math.floor(p)));
    const hi = Math.max(0, Math.min(f.length - 1, Math.ceil(p)));
    const left = lo === hi ? f[lo] : interpolate(p, [lo, hi], [f[lo], f[hi]]);
    return { transform: [{ translateX: left ?? 0 }] };
  });

  const showLeft = viewW > 0 && x > 8;
  const showRight = viewW > 0 && contentW - viewW - x > 8;
  // a tab with a dot whose middle is under an edge's fade (or past it): that edge's chevron shows the dot
  const mid = (o: number) => PAD_X + o * (ITEM + GAP) + ITEM / 2 - x;
  const dotLeft = showLeft && badges.some((o) => mid(o) < EDGE);
  const dotRight = showRight && badges.some((o) => mid(o) > viewW - EDGE);
  const maxWidth = width - 32;
  const setFrame = useCallback((order: number, at: number) => { const next = frames.value.slice(); next[order] = at; frames.value = next; }, [frames]);
  const showTip = useCallback((order: number, label: string) => setTip({ order, label, x: scrollX.value }), [scrollX]);
  const bar = useMemo<BarCtx>(() => ({ frames, setFrame, showTip, setBadge }), [frames, setFrame, showTip, setBadge]);
  const pillLeft = Math.max(0, (width - Math.min(maxWidth, contentW)) / 2);
  return <BarContext.Provider value={bar}>
    {!blurNav && !keyboard ? <Animated.View
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      style={[styles.base, { height: navBottom(insets.bottom) + fx.space.navHeight + BASE_FADE }, baseStyle]}>
      <Scrim kind="navBase" style={StyleSheet.absoluteFill} />
    </Animated.View> : null}
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: navBottom(insets.bottom) }, keyboard ? styles.hidden : null]}>
      {SHADOW_LAYER && pillBox ? <Animated.View pointerEvents="none" collapsable={false} renderToHardwareTextureAndroid accessible={false}
        accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        style={[styles.shadowHost, { left: pillBox.x - SHADOW_ROOM, top: pillBox.y - SHADOW_ROOM, width: pillBox.w + 2 * SHADOW_ROOM, height: pillBox.h + 2 * SHADOW_ROOM }, shadowEnter]}>
        <View collapsable={false} style={[styles.shadowShape, { left: SHADOW_ROOM, top: SHADOW_ROOM, width: pillBox.w, height: pillBox.h }]} />
      </Animated.View> : null}
      <Animated.View onLayout={onPillLayout} style={[styles.pill, SHADOW_LAYER ? null : styles.pillShadow, { maxWidth, backgroundColor: blurNav ? fx.glass.pill : fx.glass.pillLite }, enter]}>
        {blurNav ? <BlurView intensity={60} tint="dark" style={StyleSheet.absoluteFill} /> : null}
        <Animated.ScrollView
          ref={scroll}
          horizontal
          showsHorizontalScrollIndicator={false}
          scrollEnabled={contentW > viewW}
          onLayout={(e) => { const w = e.nativeEvent.layout.width; if (!w) return; setViewW(w); viewWSV.value = w; }}
          onScroll={onScroll}
          scrollEventThrottle={16}
          accessibilityRole="tablist"
          style={edgeMask(showLeft, showRight, EDGE, CLEAR)}
          contentContainerStyle={styles.content}>
          <Animated.View pointerEvents="none" style={[styles.halo, haloStyle]} />
          {children}
        </Animated.ScrollView>
        <EdgeFade side="left" shown={showLeft} calm={calm} dot={dotLeft} edge={EDGE} paused={covered || sting} />
        <EdgeFade side="right" shown={showRight} calm={calm} dot={dotRight} edge={EDGE} paused={covered || sting} />
      </Animated.View>
      {tip ? <View pointerEvents="none" style={[styles.tip, { left: pillLeft + PAD_X + tip.order * (ITEM + GAP) - tip.x + ITEM / 2 - 40 }]}>
        <T v="micro" center>{tip.label}</T>
      </View> : null}
    </View>
  </BarContext.Provider>;
}

function EdgeFade({ side, shown, calm, dot, edge, paused }: { side: 'left' | 'right'; shown: boolean; calm: boolean; dot?: boolean; edge: number; paused: boolean }) {
  const o = useSharedValue(shown ? 1 : 0);
  const nudge = useSharedValue(0);
  // the nudge rests while nobody sees the bar (an overlay or a sheet route over the tabs, the launch sting), and is an
  // idle loop, so the light tier (tier C, effects `lite`) has none: the chevron stands still there. Each nudge frame
  // redraws the whole window on Android, so it kept the 2 GB emulator drawing 60 frames a second for 5 s after every
  // touch, and a page scrolled in that time started behind (release G2-1: Life and Home at tier C)
  const { lite } = useFx();
  const nudging = useMotionBudget(side === 'right' && !calm && !lite && shown && !paused);
  useEffect(() => { o.value = withTiming(shown ? 1 : 0, timing(tk.navFade)); }, [shown, o]);
  useEffect(() => {
    if (!nudging) { cancelAnimation(nudge); nudge.value = calm || paused ? 0 : withTiming(0, timing(t.chevronNudge / 2)); return; }
    nudge.value = withRepeat(withSequence(withTiming(2.5, timing(t.chevronNudge / 2)), withTiming(0, timing(t.chevronNudge / 2))), -1, false);
    return () => cancelAnimation(nudge);
  }, [nudging, calm, paused, nudge]);
  const a = useAnimatedStyle(() => ({ opacity: o.value }));
  const c = useAnimatedStyle(() => ({ transform: [{ translateX: nudge.value }] }));
  const web = Platform.OS === 'web';
  const scrim = side === 'left' ? (web ? 'navLeft' : 'navEdgeLeft') : (web ? 'navRight' : 'navEdgeRight');
  return <Animated.View
    pointerEvents="none"
    accessible={false}
    accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants"
    aria-hidden
    style={[styles.fade, { width: edge }, side === 'left' ? styles.atLeft : styles.atRight, a]}>
    <Scrim kind={scrim} style={StyleSheet.absoluteFill} />
    <View style={[StyleSheet.absoluteFill, styles.edgeIcon, side === 'left' ? styles.fadeLeft : styles.fadeRight]}>
      <Animated.View style={c}>
        <Icon name={side === 'left' ? 'chevron-left' : 'chevron-right'} size={13} color={fx.ink.a55} stroke={2.5} />
        {dot ? <View style={[styles.edgeDot, side === 'left' ? styles.edgeDotLeft : styles.edgeDotRight]} /> : null}
      </Animated.View>
    </View>
  </Animated.View>;
}

/** One tab of the bar. Rendered as the child of a TabTrigger (asChild), which passes the press handlers, `isFocused`
 *  and the web href. */
export function NavItem({ tab, order, badge, badgeLabel = 'new', isFocused, onPress, onLongPress, href, ...rest }: {
  tab: TabDef; order: number; badge?: boolean; badgeLabel?: string; isFocused?: boolean; href?: string;
  onPress?: (e: GestureResponderEvent) => void; onLongPress?: (e: GestureResponderEvent) => void;
}) {
  const bar = useContext(BarContext);
  const setBadge = bar?.setBadge;
  useEffect(() => { setBadge?.(order, !!badge); return () => setBadge?.(order, false); }, [setBadge, order, badge]);
  const pager = usePager();
  const halo = pager?.halo;
  const sel = pager?.sel;
  const { calm, tier } = useFx();
  const chosen = (pager ? pager.index : 0) === order;
  // `on`: 0 idle … 1 active (the icon's colour and stroke); the scale pops on the chosen tab
  const on = useSharedValue(chosen ? 1 : 0);
  const scale = useSharedValue(chosen && !calm ? PILL.iconPop : 1);
  const pop = tier === 'C' ? spring.navIconC : spring.navIcon;
  // a selection (a tap, a committed swipe, a route): only the source and the target change
  useAnimatedReaction(() => (sel ? sel.value : -1), (s, prev) => {
    if (prev === null || s === prev || (s !== order && prev !== order)) return;
    const target = s === order;
    scale.value = calm ? 1 : withSpring(target ? PILL.iconPop : 1, pop);
    if (!pagerPanning.value) on.value = withTiming(target ? 1 : 0, calm ? calmFade() : timing(PILL.colourMs, ease.css));
  }, [calm, pop]);
  // while a finger drags the pages, the halo lights the icons it passes
  useAnimatedReaction(() => (pagerPanning.value && halo ? halo.value : -100), (h, prev) => {
    if (h > -50) { on.value = Math.max(0, Math.min(1, (0.65 - Math.abs(h - order)) / 0.3)); return; }
    if (prev !== null && prev > -50) on.value = withTiming(sel && sel.value === order ? 1 : 0, calm ? calmFade() : timing(PILL.colourMs, ease.css));
  }, [calm]);
  const grow = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  // the press: the dip starts on touch-down (the strip is no page scroller: a sideways flick of the pill springs it back
  // on release), the motion on the release
  const dip = () => { if (!calm) scale.value = withTiming(PILL.iconDip, timing(t.press)); };
  const undip = () => { if (!calm) scale.value = withSpring(sel && sel.value === order ? PILL.iconPop : 1, pop); };
  const press = (e: GestureResponderEvent) => {
    if (!pager || isFocused) { onPress?.(e); return; } // the chosen tab: the trigger scrolls the page to the top
    if (Platform.OS === 'web') {
      const ne = e?.nativeEvent as unknown as { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; button?: number } | undefined;
      if (ne && (ne.metaKey || ne.ctrlKey || ne.shiftKey || ne.altKey || (ne.button ?? 0) !== 0)) { onPress?.(e); return; } // a new browser tab
      e?.preventDefault?.();
      pager.startTo(order);
      // the route follows once the first moving frame has painted (a task after the frame, inside a transition)
      requestAnimationFrame(() => { setTimeout(() => { startTransition(() => { pager.route(tab.name); }); }, 0); });
      return;
    }
    pager.startTo(order);
    onPress?.(e);
  };
  const web = Platform.OS === 'web' && href ? ({ href } as object) : null;
  return <Pressable
    {...rest}
    {...web}
    {...PRESS_PROPS}
    onLayout={(e) => { const l = e.nativeEvent.layout; if (l.width && l.height) bar?.setFrame(order, l.x); }}
    onPressIn={dip}
    onPressOut={undip}
    onPress={press}
    onLongPress={(e) => { bar?.showTip(order, tab.label); onLongPress?.(e); }}
    accessibilityRole="tab"
    accessibilityLabel={badge ? `${tab.label}, ${badgeLabel}` : tab.label}
    accessibilityState={{ selected: !!isFocused }}
    aria-selected={!!isFocused}
    style={styles.item}>
    <Animated.View style={[styles.icon, grow]}>
      <TabIcon name={tab.icon} size={22} on={on} />
    </Animated.View>
    {badge ? <View style={styles.badge} /> : null}
  </Pressable>;
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: 16 },
  base: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  hidden: { display: 'none' },
  pill: { borderRadius: fx.radius.pill, borderWidth: 1, borderColor: fx.line.a10, overflow: 'hidden' },
  pillShadow: { boxShadow: fx.shadow.pill },
  shadowHost: { position: 'absolute' },
  shadowShape: { position: 'absolute', borderRadius: fx.radius.pill, boxShadow: fx.shadow.pill },
  content: { flexDirection: 'row', gap: GAP, paddingHorizontal: PAD_X, paddingVertical: PAD_Y },
  halo: { position: 'absolute', left: 0, top: PAD_Y, width: ITEM, height: ITEM, borderRadius: ITEM / 2, backgroundColor: fx.red.a12 },
  item: { width: ITEM, height: ITEM, borderRadius: ITEM / 2, alignItems: 'center', justifyContent: 'center' },
  icon: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 12, right: 12, width: 8, height: 8, borderRadius: 4, backgroundColor: fx.red.brand, boxShadow: fx.shadow.dot },
  tip: { position: 'absolute', top: -32, width: 80, paddingHorizontal: 8, paddingVertical: 4, borderRadius: fx.radius.md, backgroundColor: fx.bg.elevated, borderWidth: 1, borderColor: fx.line.a10 },
  fade: { position: 'absolute', top: 0, bottom: 0, width: PILL.edgeWide },
  atLeft: { left: 0 },
  atRight: { right: 0 },
  edgeIcon: { justifyContent: 'center' },
  fadeLeft: { alignItems: 'flex-start', paddingLeft: 8 },
  fadeRight: { alignItems: 'flex-end', paddingRight: 8 },
  edgeDot: { position: 'absolute', top: -5, width: 6, height: 6, borderRadius: 3, backgroundColor: fx.red.brand, boxShadow: fx.shadow.dot },
  edgeDotLeft: { left: 7 },
  edgeDotRight: { right: -2 },
});
