/* Train's own motion pieces (motion v2, PK7), built on the kit's tokens, page-active rule and inert-exit rule:
   - Swap: an in-place swap keyed by `id` that overlaps its exit with its entry. The outgoing layer stays mounted
     (absolute, inert from its first exit frame: no touches, hidden from assistive technology) and leaves the other way
     while the incoming one enters from the side of the change. Used by the player strip (x ±8), the week arrows (x ±24),
     the guide panels and the rolling digits (y ±8). Tier C: opacity only; reduced motion: a 150 ms crossfade; in the
     web's pre-rendered HTML: at rest.
   - Roll: a short text whose digits roll in the direction of change (a clipped vertical Swap).
   - ListIn: a list row that appears after the list has drawn (a filter shows it): opacity and a short rise, staggered
     among the rows that appear together. Rows already shown never move except by layout.
   - Rise: content that mounts after the screen's first frames (the player's second phase): opacity and y 10.
   - ShiftHost / Shifted: a column whose blocks change height (a rest timer opening in a set card): the blocks below
     glide to their new place (native: LinearTransition; web: the height snaps and they move by a transform).
   - useDelayed: true once a flag has held for a while (a spinner only for a load that lasts).
   Everything animates transforms and opacity on the UI thread; nothing runs per frame on the JS thread. */
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { LinearTransition, useAnimatedReaction, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { calmFade, doneOnce, ease, motionValues, t, timing, useMotion } from '@/fx';
import { usePageActive } from '@/fx/nav/pageReady';

const S = motionValues.screens;

export type SwapTiming = {
  /** Distance the outgoing layer travels (pt, against the change) and its length (ms). */
  outD: number; outMs: number;
  /** Distance the incoming layer starts from (pt, from the side of the change), its length and its start (ms). */
  inD: number; inMs: number; inAt?: number;
  /** Tier C's opacity-only length (default t.fast). */
  cMs?: number;
};

type SwapLayer = { id: string | number; node: React.ReactNode };

/** An overlapped swap of what `id` names. `dir` +1: the new content comes from the right (or from below on 'y'). */
export function Swap({ id, dir = 1, axis = 'x', timing: tm, clip, children, style }: {
  id: string | number; dir?: 1 | -1; axis?: 'x' | 'y'; timing: SwapTiming; clip?: boolean; children: React.ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const [state, setState] = useState<{ id: string | number; leaving: SwapLayer | null; dir: 1 | -1; swaps: number }>({ id, leaving: null, dir, swaps: 0 });
  const last = useRef<React.ReactNode>(children);
  if (state.id !== id) {
    // derived during render: what was drawn for the old id leaves, the new id enters (same keys keep their state)
    setState({ id, leaving: { id: state.id, node: last.current }, dir, swaps: state.swaps + 1 });
  } else {
    last.current = children;
  }
  const leftId = state.leaving ? state.leaving.id : null;
  const gone = () => setState((s) => (s.leaving && s.leaving.id === leftId ? { ...s, leaving: null } : s));
  return <View style={[clip ? styles.clip : null, style]}>
    {state.leaving ? <SwapPane key={'k' + String(state.leaving.id)} phase="leave" dir={state.dir} axis={axis} tm={tm} onGone={gone}>{state.leaving.node}</SwapPane> : null}
    <SwapPane key={'k' + String(state.id)} phase={state.swaps ? 'enter' : 'rest'} dir={state.dir} axis={axis} tm={tm}>{state.id === id ? children : last.current}</SwapPane>
  </View>;
}

function SwapPane({ phase, dir, axis, tm, onGone, children }: { phase: 'rest' | 'enter' | 'leave'; dir: 1 | -1; axis: 'x' | 'y'; tm: SwapTiming; onGone?: () => void; children: React.ReactNode }) {
  const { tier, calm, inHtml } = useMotion();
  const fadeOnly = calm || inHtml || tier === 'C';
  const leaving = phase === 'leave';
  const p = useSharedValue(phase === 'enter' && !inHtml ? 0 : 1); // entering 0 → 1
  const out = useSharedValue(0); // leaving 0 → 1
  useEffect(() => {
    if (phase !== 'enter' || inHtml) return;
    const cfg = calm ? calmFade() : tier === 'C' ? timing(tm.cMs ?? t.fast, ease.linear) : timing(tm.inMs);
    const at = calm || tier === 'C' ? 0 : tm.inAt ?? 0;
    p.value = at > 0 ? withDelay(at, withTiming(1, cfg)) : withTiming(1, cfg);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!leaving) return;
    const ms = calm ? t.calm : tier === 'C' ? tm.cMs ?? t.fast : tm.outMs;
    const once = doneOnce(() => onGone?.(), ms + motionValues.overlay.fallbackExtra);
    const finish = (finished?: boolean) => { 'worklet'; if (finished) scheduleOnRN(once.done); };
    out.value = withTiming(1, calm ? calmFade() : tier === 'C' ? timing(ms, ease.linear) : timing(ms), finish);
    return () => once.cancel();
  }, [leaving]); // eslint-disable-line react-hooks/exhaustive-deps
  const outD = tm.outD, inD = tm.inD;
  const a = useAnimatedStyle(() => {
    if (leaving) {
      const o = out.value;
      if (fadeOnly) return { opacity: 1 - o, transform: [] };
      const d = -outD * dir * o;
      return { opacity: 1 - o, transform: axis === 'x' ? [{ translateX: d }] : [{ translateY: d }] };
    }
    const v = p.value;
    if (v >= 1 || fadeOnly) return { opacity: v, transform: [] };
    const d = inD * dir * (1 - v);
    return { opacity: v, transform: axis === 'x' ? [{ translateX: d }] : [{ translateY: d }] };
  });
  const inert = leaving ? { pointerEvents: 'none' as const, accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const, 'aria-hidden': true } : null;
  return <Animated.View style={[leaving ? styles.leaving : null, a]} {...inert}>{children}</Animated.View>;
}

/** A short text (a count, a clock) whose digits roll in the direction of change: `up` +1 when the value grew. */
export function Roll({ value, up = 1, distance, ms, children, style }: { value: string | number; up?: 1 | -1; distance: number; ms: number; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <Swap id={value} dir={up} axis="y" clip timing={{ outD: distance, outMs: ms, inD: distance, inMs: ms }} style={style}>{children}</Swap>;
}

/** The direction of change of a number between renders (+1 up, −1 down), for Roll. */
export function useChangeDir(n: number): 1 | -1 {
  const prev = useRef(n);
  const dir = useRef<1 | -1>(1);
  if (prev.current !== n) { dir.current = n > prev.current ? 1 : -1; prev.current = n; }
  return dir.current;
}

/** A list row: `enter` (it appeared after the list had drawn) rises S.m71.rowY with opacity over S.m71.rowMs, its
 *  start `index` × S.m71.rowStep (at most S.m71.rowMax steps); otherwise it is drawn at rest. Tier C: opacity over
 *  S.m71.cMs; reduced motion: at once. It starts on the page-active edge. */
export function ListIn({ enter, index = 0, children, style }: { enter: boolean; index?: number; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { tier, still } = useMotion();
  const active = usePageActive();
  const [animate] = useState(enter && !still);
  const p = useSharedValue(animate ? 0 : 1);
  const armed = useSharedValue(animate ? 0 : 1);
  const m = S.m71;
  const wait = Math.min(Math.max(0, index), m.rowMax - 1) * m.rowStep;
  const c = tier === 'C';
  useAnimatedReaction(() => (armed.get() === 0 && active.get() === 1 ? 1 : 0), (go) => {
    if (go !== 1 || armed.get() === 1) return;
    armed.set(1);
    const anim = withTiming(1, c ? timing(m.cMs, ease.linear) : timing(m.rowMs));
    p.set(wait > 0 && !c ? withDelay(wait, anim) : anim);
  });
  const y = c ? 0 : m.rowY;
  const a = useAnimatedStyle(() => {
    const v = p.get();
    if (v >= 1) return { opacity: 1, transform: [] };
    return { opacity: v, transform: y ? [{ translateY: y * (1 - v) }] : [] };
  });
  return <Animated.View style={[style, a]}>{children}</Animated.View>;
}

/** A keyed list that keeps the items a change removed for their exit: each comes back marked `leaving` at the place it
 *  had until `done(id)` is called (Gone below calls it when its fade ends). Reduced motion: removed at once. (Reanimated's
 *  own exiting animations are not used: on the web they also play when the whole list leaves with its view, drawing
 *  the rows again outside their panel.) */
export function usePresence<T extends { id: string }>(items: T[], instant: boolean): { list: Array<{ item: T; leaving: boolean }>; done: (id: string) => void } {
  const ids = items.map((i) => i.id).join('|');
  const [state, setState] = useState<{ ids: string; items: T[]; gone: Array<{ item: T; index: number }> }>({ ids, items, gone: [] });
  if (state.ids !== ids) {
    // derived during render: what the new list no longer has leaves from where it was
    const now = new Set(items.map((i) => i.id));
    const removed = instant ? [] : state.items.map((item, index) => ({ item, index })).filter((x) => !now.has(x.item.id));
    setState({ ids, items, gone: [...state.gone.filter((g) => !now.has(g.item.id)), ...removed] });
  }
  const done = (id: string) => setState((s) => ({ ...s, gone: s.gone.filter((g) => g.item.id !== id) }));
  const list: Array<{ item: T; leaving: boolean }> = items.map((item) => ({ item, leaving: false }));
  for (const g of [...state.gone].sort((a, b) => a.index - b.index)) list.splice(Math.min(g.index, list.length), 0, { item: g.item, leaving: true });
  return { list, done };
}

/** An item a list removed: it fades out in place over S.m71.rowOutMs (tier C: S.m71.cMs), inert, then `onGone`. */
export function Gone({ onGone, children }: { onGone: () => void; children: React.ReactNode }) {
  const { tier } = useMotion();
  const o = useSharedValue(1);
  useEffect(() => {
    const ms = tier === 'C' ? S.m71.cMs : S.m71.rowOutMs;
    const once = doneOnce(onGone, ms + motionValues.overlay.fallbackExtra);
    const finish = (f?: boolean) => { 'worklet'; if (f) scheduleOnRN(once.done); };
    o.value = withTiming(0, timing(ms, ease.linear), finish);
    return () => once.cancel();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const a = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={a} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>{children}</Animated.View>;
}

/** Content that mounts after the first frames of a screen (the player's second phase): opacity 0 → 1 and y 10 → 0 over
 *  t.base, at rest under reduced motion and in the pre-rendered HTML; tier C fades only. */
export function Rise({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { tier, still } = useMotion();
  const active = usePageActive();
  const p = useSharedValue(still ? 1 : 0);
  const armed = useSharedValue(still ? 1 : 0);
  const c = tier === 'C';
  useAnimatedReaction(() => (armed.get() === 0 && active.get() === 1 ? 1 : 0), (go) => {
    if (go !== 1 || armed.get() === 1) return;
    armed.set(1);
    p.set(withTiming(1, c ? timing(t.fast, ease.linear) : timing(t.base)));
  });
  const y = c ? 0 : motionValues.flowSwap.enterY;
  const a = useAnimatedStyle(() => {
    const v = p.get();
    if (v >= 1) return { opacity: 1, transform: [] };
    return { opacity: v, transform: y ? [{ translateY: y * (1 - v) }] : [] };
  });
  return <Animated.View style={[style, a]}>{children}</Animated.View>;
}

/* ---------- a column whose blocks change height (the player's set cards: a rest timer opening or closing) ---------- */

type ShiftCtx = { y: SharedValue<number>; from: SharedValue<number>; calm: boolean };
const ShiftContext = createContext<ShiftCtx | null>(null);

/** Holds the column's shift: when a block's height changes, the blocks below it start from where they were and glide
 *  to their new place (S.m70.heightMs expo). Native animates the layout itself (LinearTransition); the web snaps the
 *  height in one frame and moves what follows with a transform from the old offset. Reduced motion: it snaps. */
export function ShiftHost({ children }: { children: React.ReactNode }) {
  const { still } = useMotion();
  const y = useSharedValue(0);
  const from = useSharedValue(-1);
  const value = useMemo(() => ({ y, from, calm: still }), [y, from, still]);
  return <ShiftContext.Provider value={value}>{children}</ShiftContext.Provider>;
}

/** A block of the column at position `order`. `resizes`: report this block's height changes (the blocks below follow). */
export function Shifted({ order, resizes, children, style }: { order: number; resizes?: boolean; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const ctx = useContext(ShiftContext);
  const own = useSharedValue(0);
  const none = useSharedValue(-1);
  const y = ctx?.y ?? own;
  const from = ctx?.from ?? none;
  const calm = !ctx || ctx.calm;
  const lastH = useRef(0);
  const web = Platform.OS === 'web';
  const onLayout = resizes ? (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (!h) return; // a detached page reports 0
    const was = lastH.current;
    lastH.current = h;
    if (!web || calm || !was || Math.abs(h - was) < 1) return;
    // what follows has snapped by (h − was): start it from where it was and glide it home
    from.value = order;
    y.value = withSequence(withTiming(y.value + was - h, { duration: 0 }), withTiming(0, timing(S.m70.heightMs)));
  } : undefined;
  const a = useAnimatedStyle(() => (web && order > from.value && y.value !== 0 ? { transform: [{ translateY: y.value }] } : { transform: [] }));
  const layout = web || calm ? undefined : LinearTransition.duration(S.m70.heightMs).easing(ease.expo);
  return <Animated.View layout={layout} onLayout={onLayout} style={[style, a]}>{children}</Animated.View>;
}

/** True once `on` has held for `ms` (false again as soon as it drops). */
export function useDelayed(on: boolean, ms: number): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!on) { setLate(false); return; }
    const timer = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(timer);
  }, [on, ms]);
  return on && late;
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  leaving: { position: 'absolute', left: 0, right: 0, top: 0 },
});
