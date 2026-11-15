/* Toasts (THEME §11.11, AMENDED §3). Two kinds, both drawn by the one ToastHost in the root layout:
   - top (toast.info / success / error): an opaque dark pill at the top centre (radius 14, #333 border, 13/500 with a
     16 pt icon, at most 358 wide), sliding down from above in 400 ms, held 3.2 s, then rising away in 200 ms (ease.exit).
     A newer one pushes the older down 8 pt and shrinks it by 4 % over 200 ms while the older one's content fades, so
     only its edge peeks; a third evicts the oldest, which plays its exit before it goes. The success icon draws its
     check; the error icon shakes 3 pt once. Swipe it up to dismiss: past 24 pt (or a 600 pt/s flick) it leaves with the
     finger's speed (a soft haptic at the threshold); otherwise it springs back. A header with controls under the top
     lane registers its bottom edge (useTopToastClearance) and the lane starts below it, so a toast never covers them;
   - bottom (toast.logged): the quick confirmation pill above the tab bar (bottom = 24 + 74 + 12 + inset) on a tab
     page; on a screen with no tab bar (an overlay, a flow, a sheet route) it sits 24 pt above the bottom (or the home
     indicator), or 12 pt above a pinned footer (the kit's Overlay, FlowScreen and SheetPanel footers say how tall
     theirs is: useToastClearance). Filled green with black words for success, action red for an error, #1A1A1A for
     information (every pair AA: BOTTOM_LOOK), rising 20 pt in
     300 ms, held 2.4 s, one at a time (a replacement crossfades in 150 ms); if the screen changes while it shows, the
     lane glides to the new place (a transform, not a layout change).
   Reduced motion: fades in over 150 ms and out over 120 ms, with no travel. Every toast is announced to screen readers,
   also while a sheet hides the page behind it. Nothing here blocks a touch outside the pill. */
import { useSegments } from 'expo-router';
import React, { useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Circle, Path } from 'react-native-svg';
import Animated, { useAnimatedProps, useAnimatedReaction, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fx } from '@/theme';
import { haptics } from './device/haptics';
import { ease, motionValues, spring, t, timing, tk, useFx } from './effects';
import { Icon, type IconName } from './Icon';
import { calmFade } from './motion/tokens';
import { doneOnce } from './motion/once';
import { T } from './Text';
import { FONTS } from './type';

type Kind = 'info' | 'success' | 'error';
/** `leaving`: playing its exit (evicted, timed out, replaced or swiped); `swap`: a bottom pill that replaced a shown one. */
type Item = { id: number; text: string; kind: Kind; place: 'top' | 'bottom'; leaving?: boolean; swap?: boolean };

let seq = 0;
let items: Item[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function push(text: string, kind: Kind, place: 'top' | 'bottom') {
  const item: Item = { id: ++seq, text, kind, place };
  if (place === 'bottom') {
    const shown = items.some((i) => i.place === 'bottom' && !i.leaving);
    items = [...items.map((i) => (i.place === 'bottom' && !i.leaving ? { ...i, leaving: true } : i)), { ...item, swap: shown }];
  } else {
    // two at most: the newest and one behind it; an older one is evicted and leaves before it goes
    const live = items.filter((i) => i.place === 'top' && !i.leaving);
    const evict = new Set(live.slice(0, -1).map((i) => i.id));
    items = [...items.map((i) => (evict.has(i.id) ? { ...i, leaving: true } : i)), item];
  }
  emit();
  AccessibilityInfo.announceForAccessibility(text);
  if (kind === 'error') haptics.error();
}
function remove(id: number) { if (!items.some((i) => i.id === id)) return; items = items.filter((i) => i.id !== id); emit(); }
function markLeaving(id: number) {
  if (!items.some((i) => i.id === id && !i.leaving)) return;
  items = items.map((i) => (i.id === id ? { ...i, leaving: true } : i));
  emit();
}

export const toast = {
  info: (text: string) => push(text, 'info', 'top'),
  success: (text: string) => push(text, 'success', 'top'),
  error: (text: string) => push(text, 'error', 'top'),
  /** The bottom pill for a quick confirmation (meal added, water logged). */
  logged: (text: string, kind: Kind = 'success') => push(text, kind, 'bottom'),
};

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => items;

/* Pinned footers on screens without a tab bar: their heights from the screen's bottom edge, by owner. */
const clearances = new Map<string, number>();
let clearance = 0;
const clearanceListeners = new Set<() => void>();
function setClearance(id: string, h: number | null) {
  if (h == null) clearances.delete(id); else clearances.set(id, h);
  const next = Math.max(0, ...clearances.values());
  if (next !== clearance) { clearance = next; clearanceListeners.forEach((l) => l()); }
}
const subscribeClearance = (l: () => void) => { clearanceListeners.add(l); return () => { clearanceListeners.delete(l); }; };
const clearanceSnapshot = () => clearance;

/** A pinned footer (a CTA bar) `height` points tall from the screen's bottom edge, the safe inset included: while
 *  `active`, the bottom toast sits above it on screens without a tab bar. */
export function useToastClearance(height: number, active = true): void {
  const id = useId();
  useEffect(() => {
    if (!active || !(height > 0)) return;
    setClearance(id, height);
    return () => setClearance(id, null);
  }, [id, height, active]);
}

/* Headers with controls under the top lane: their bottom edges in window points, by owner. */
const topClearances = new Map<string, number>();
let topClearance = 0;
const topClearanceListeners = new Set<() => void>();
function setTopClearance(id: string, bottom: number | null) {
  if (bottom == null) topClearances.delete(id); else topClearances.set(id, bottom);
  const next = Math.max(0, ...topClearances.values());
  if (next !== topClearance) { topClearance = next; topClearanceListeners.forEach((l) => l()); }
}
const subscribeTopClearance = (l: () => void) => { topClearanceListeners.add(l); return () => { topClearanceListeners.delete(l); }; };
const topClearanceSnapshot = () => topClearance;

/** A header whose bottom edge sits `bottom` points from the window's top (the safe inset included): while `active`,
 *  the top toast lane starts 8 pt below it, so a toast never covers its controls. The largest registration wins. */
export function useTopToastClearance(bottom: number, active = true): void {
  const id = useId();
  useEffect(() => {
    if (!active || !(bottom > 0)) return;
    setTopClearance(id, bottom);
    return () => setTopClearance(id, null);
  }, [id, bottom, active]);
}

/** A header bottom further down than this share of the window is not a header row at the top (a sample header deep in
 *  a scroll, a row measured off screen): the lane ignores it, so a toast is never pushed off the screen. */
export const HEADER_BAND_MAX = 0.4;

/** The id of the host's root element (the web keeps it readable while a sheet hides the rest: src/fx/Sheet). */
const HOST_ID = 'fx-toast-host';

export function ToastHost() {
  const list = useSyncExternalStore(subscribe, snapshot, snapshot);
  const footer = useSyncExternalStore(subscribeClearance, clearanceSnapshot, clearanceSnapshot);
  const header = useSyncExternalStore(subscribeTopClearance, topClearanceSnapshot, topClearanceSnapshot);
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const segments = useSegments() as string[];
  const onTabs = segments[0] === '(tabs)';
  const tops = list.filter((i) => i.place === 'top');
  const live = tops.filter((i) => !i.leaving);
  const bottoms = list.filter((i) => i.place === 'bottom');
  const lift = onTabs ? fx.space.navBottom + fx.space.navHeight + 12 + insets.bottom : Math.max(fx.space.navBottom + insets.bottom, footer + 12);
  const laneTop = Math.max(insets.top + 8, header > 0 && header <= winH * HEADER_BAND_MAX ? header + 8 : 0);
  // the lane glides to a new clearance (a header row coming back on screen while a toast shows) over toast.depthMs, by
  // transform from its resting top; with nothing showing, or under reduced motion, it is simply placed
  const { calm } = useFx();
  const laneBase = insets.top + 8;
  const laneShift = useSharedValue(laneTop - laneBase);
  const showing = tops.length > 0;
  useEffect(() => {
    const to = laneTop - laneBase;
    laneShift.value = !showing || calm ? to : withTiming(to, timing(motionValues.toast.depthMs));
  }, [laneTop, laneBase, showing, calm, laneShift]);
  const laneStyle = useAnimatedStyle(() => ({ transform: [{ translateY: laneShift.value }] }));
  return <View pointerEvents="box-none" style={StyleSheet.absoluteFill} nativeID={HOST_ID}>
    <Animated.View pointerEvents="box-none" style={[styles.topLane, { top: laneBase }, laneStyle]}>
      {tops.map((it) => <TopToast key={it.id} item={it} depth={it.leaving ? live.length : live.length - 1 - live.indexOf(it)} laneTop={laneTop} />)}
    </Animated.View>
    {bottoms.length ? <BottomLane bottom={lift}>
      {bottoms.map((it) => <BottomToast key={it.id} item={it} />)}
    </BottomLane> : null}
  </View>;
}

const ICON: Record<Kind, IconName> = { info: 'info', success: 'circle-check', error: 'circle-alert' };
const ICON_COLOR: Record<Kind, string> = { info: fx.ink.a70, success: fx.hue.green400, error: fx.red.label };
/** The web's backdrop blur at tier A (a style React Native's types do not list). */
const WEB_BLUR = { backdropFilter: `blur(${motionValues.toast.blur}px)` } as unknown as ViewStyle;

function TopToast({ item, depth, laneTop }: { item: Item; depth: number; laneTop: number }) {
  const fxs = useFx();
  const { calm } = fxs;
  const m = motionValues.toast;
  const y = useSharedValue(calm ? 0 : m.enterY);
  const o = useSharedValue(0);
  const d = useSharedValue(depth);
  const drag = useSharedValue(0);
  const h = useSharedValue(0);
  const thrown = useSharedValue(0);
  const crossed = useSharedValue(0);
  const top = useSharedValue(laneTop);
  const flung = useRef(false);
  const end = useRef<ReturnType<typeof doneOnce> | null>(null);
  const gone = () => remove(item.id);
  const finish = (ms: number) => { end.current?.cancel(); end.current = doneOnce(gone, ms + motionValues.overlay.fallbackExtra); return end.current.done; };
  useEffect(() => { top.value = laneTop; }, [laneTop, top]);
  useEffect(() => {
    o.value = withTiming(1, calm ? calmFade(m.calmIn) : timing(tk.toastIn));
    if (!calm) y.value = withTiming(0, timing(tk.toastIn));
    const timer = setTimeout(() => markLeaving(item.id), t.toastTop);
    return () => { clearTimeout(timer); end.current?.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // a newer toast pushes this one back (a leaving toast keeps the depth it had)
  useEffect(() => {
    if (item.leaving) return;
    d.value = withTiming(depth, calm ? calmFade() : timing(m.depthMs));
  }, [depth, calm, d, item.leaving, m.depthMs]);
  // its exit: evicted, timed out or replaced (a swiped toast is already on its way)
  useEffect(() => {
    if (!item.leaving || flung.current) return;
    const ms = calm ? m.calmOut : t.exitBase;
    const done = finish(ms);
    const cb = (fin?: boolean) => { 'worklet'; if (fin) scheduleOnRN(done); };
    if (calm) { o.value = withTiming(0, calmFade(m.calmOut), cb); return; }
    o.value = withTiming(0, timing(ms, ease.exit), cb);
    y.value = withTiming(m.exitY, timing(ms, ease.exit));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.leaving]);
  const onFlung = (ms: number) => { flung.current = true; finish(ms); markLeaving(item.id); };
  const removeNow = () => { end.current?.done(); };
  // swiped up past the threshold: the pill leaves with the finger's speed and is removed once it is off screen
  useAnimatedReaction(() => thrown.value === 1 && top.value + y.value + drag.value + h.value <= 0, (off, was) => { if (off && !was) scheduleOnRN(removeNow); });
  const swipe = Gesture.Pan().activeOffsetY([-m.panY, m.panY])
    .onUpdate((e) => {
      'worklet';
      if (thrown.value) return;
      if (!calm) drag.value = Math.min(0, e.translationY);
      if (e.translationY < -m.swipeY && !crossed.value) { crossed.value = 1; scheduleOnRN(haptics.soft); }
    })
    .onEnd((e) => {
      'worklet';
      if (thrown.value) return;
      if (e.translationY < -m.swipeY || e.velocityY < -m.swipeV) {
        thrown.value = 1;
        if (calm) {
          scheduleOnRN(onFlung, m.calmOut);
          o.value = withTiming(0, calmFade(m.calmOut), (fin) => { if (fin) scheduleOnRN(removeNow); });
          return;
        }
        scheduleOnRN(onFlung, t.exitBase);
        drag.value = withSpring(-(top.value + h.value) + m.exitY, { ...spring.throw, velocity: Math.min(0, e.velocityY) }, (fin) => { if (fin) scheduleOnRN(removeNow); });
      } else {
        drag.value = withSpring(0, spring.dismiss);
      }
    });
  const a = useAnimatedStyle(() => {
    if (calm) return { opacity: o.value, transform: [] };
    const dd = d.value;
    return { opacity: o.value, transform: [{ translateY: y.value + drag.value + m.depthY * dd }, { scale: 1 - m.depthScale * Math.min(dd, 1) }] };
  });
  // an older toast's content fades as it goes back, so only its edge peeks under the newer one
  const content = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, Math.max(0, d.value)) }));
  const onLayout = (e: LayoutChangeEvent) => { const hh = e.nativeEvent.layout.height; if (hh > 0) h.value = hh; };
  return <GestureDetector gesture={swipe}>
    <Animated.View onLayout={onLayout} accessibilityLiveRegion="polite" style={[styles.top, fxs.blur && Platform.OS === 'web' ? WEB_BLUR : null, { zIndex: 10 - depth }, a]}>
      <Animated.View style={[styles.content, content]}>
        <ToastIcon kind={item.kind} calm={calm} />
        <T v="caption" style={styles.text}>{item.text}</T>
      </Animated.View>
    </Animated.View>
  </GestureDetector>;
}

const AnimatedPath = Animated.createAnimatedComponent(Path);
/** The circle-check glyph's check (lucide, 24-unit box) and its length. */
const CHECK = 'm9 12 2 2 4-4';
const CHECK_LEN = 8.49;

/** The top toast's icon: success draws its check, error shakes once (both at rest under reduced motion). */
function ToastIcon({ kind, calm }: { kind: Kind; calm: boolean }) {
  const m = motionValues.toast;
  const draw = useSharedValue(calm || kind !== 'success' ? 1 : 0);
  const shake = useSharedValue(0);
  useEffect(() => {
    if (calm) return;
    if (kind === 'success') draw.value = withDelay(m.checkAt, withTiming(1, timing(m.checkMs)));
    if (kind === 'error') {
      const f = motionValues.field;
      const step = f.shakeMs / (f.shake.length - 1);
      const k = m.errorShake / Math.max(...f.shake.map(Math.abs));
      shake.value = withSequence(...f.shake.slice(1).map((v) => withTiming(v * k, timing(step, ease.cssInOut))));
    }
  }, [calm, kind, draw, shake, m.checkAt, m.checkMs, m.errorShake]);
  const check = useAnimatedProps(() => ({ strokeDashoffset: CHECK_LEN * (1 - draw.value) }));
  const s = useAnimatedStyle(() => (shake.value === 0 ? { transform: [] } : { transform: [{ translateX: shake.value }] }));
  if (kind === 'success') {
    return <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={ICON_COLOR.success} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx={12} cy={12} r={10} />
      <AnimatedPath d={CHECK} strokeDasharray={`${CHECK_LEN} ${CHECK_LEN}`} animatedProps={check} />
    </Svg>;
  }
  return <Animated.View style={s}><Icon name={ICON[kind]} size={16} color={ICON_COLOR[kind]} /></Animated.View>;
}

/** The bottom pill's fill, edge and words, each pair at least 4.5:1 (WCAG AA for its 13 pt text; release UX-01): the
 *  earlier app's green #43A047 keeps its fill with black words (6.4:1; white was 3.3:1), an error takes the brand book's
 *  action red under white (5.0:1; the brand red #EE3324 was 4.1:1, as for buttons in T3-03), information stays white
 *  on #1A1A1A. */
const BOTTOM_LOOK: Record<Kind, { bg: string; border: string; ink: string }> = {
  success: { bg: fx.status.optimal, border: fx.tone.successLine, ink: fx.bg.deep },
  error: { bg: fx.red.action, border: fx.tone.toastErrorLine, ink: fx.ink.white },
  info: { bg: fx.bg.elevated, border: fx.line.a12, ink: fx.ink.white },
};

/** The bottom lane: its height above the bottom is set at once for the first frame, then glides (translateY) when
 *  the screen changes under it. */
function BottomLane({ bottom, children }: { bottom: number; children: React.ReactNode }) {
  const { calm } = useFx();
  const lane = useSharedValue(bottom);
  useEffect(() => { lane.value = calm ? bottom : withTiming(bottom, timing(t.base)); }, [bottom, calm, lane]);
  const at = useAnimatedStyle(() => ({ transform: [{ translateY: -lane.value }] }));
  return <Animated.View pointerEvents="none" style={[styles.bottomLane, at]}>{children}</Animated.View>;
}

function BottomToast({ item }: { item: Item }) {
  const { calm } = useFx();
  const y = useSharedValue(calm || item.swap ? 0 : motionValues.toast.pillRise);
  const o = useSharedValue(0);
  const end = useRef<ReturnType<typeof doneOnce> | null>(null);
  useEffect(() => {
    o.value = withTiming(1, calm ? calmFade(motionValues.toast.calmIn) : item.swap ? timing(t.calm, ease.css) : timing(t.base));
    if (!calm && !item.swap) y.value = withTiming(0, timing(t.base));
    const timer = setTimeout(() => markLeaving(item.id), t.toastBottom);
    return () => { clearTimeout(timer); end.current?.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!item.leaving) return;
    const ms = calm ? motionValues.toast.calmOut : t.calm;
    end.current = doneOnce(() => remove(item.id), ms + motionValues.overlay.fallbackExtra);
    const done = end.current.done;
    o.value = withTiming(0, calm ? calmFade(ms) : timing(ms, ease.css), (fin) => { 'worklet'; if (fin) scheduleOnRN(done); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.leaving]);
  const a = useAnimatedStyle(() => (y.value === 0 ? { opacity: o.value, transform: [] } : { opacity: o.value, transform: [{ translateY: y.value }] }));
  const look = BOTTOM_LOOK[item.kind];
  return <View pointerEvents="none" style={styles.bottomSlot}>
    <Animated.View accessibilityLiveRegion="polite" style={[styles.bottom, { backgroundColor: look.bg, borderColor: look.border }, a]}>
      <T v="caption" color={look.ink} style={styles.text}>{item.text}</T>
    </Animated.View>
  </View>;
}

const styles = StyleSheet.create({
  topLane: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  top: { position: 'absolute', top: 0, maxWidth: 358, width: '100%', paddingHorizontal: 16, paddingVertical: 14, borderRadius: fx.radius.toast, borderWidth: 1, borderColor: fx.line.toast, backgroundColor: fx.bg.panel, boxShadow: fx.shadow.toast },
  content: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  text: { fontFamily: FONTS.sans500, fontSize: 13, lineHeight: 18, flexShrink: 1 },
  bottomLane: { position: 'absolute', left: 16, right: 16, bottom: 0, height: 0 },
  bottomSlot: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  bottom: { maxWidth: 358, paddingHorizontal: 20, paddingVertical: 12, borderRadius: fx.radius.toast, borderWidth: 1, boxShadow: fx.shadow.toast },
});
