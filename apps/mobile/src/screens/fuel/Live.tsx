/* Fuel's live numbers (motion v2, M78 and M80): "fuel added".
   - useChangeClock: one 0..1 clock for a number and its arc or bar, so they never drift apart. It runs once per mount,
     when the data may start (the page is active and the card's reveal has begun: Reveal's useDataStart): over `firstMs`
     the first time this session, over `changeMs` when the value changed since it was last seen, and not at all when it
     did not (a revisit shows the values at rest on its first frame). Callers remount the parts it drives when the value
     changes (a `key`), so each change moves from the value seen last to the new one.
   - FillBar: a bar whose fill moves by translateX inside a rounded track that clips it (never scaleX on a rounded
     shape), from the share it showed last (kept by `seenKey` for the session) to the new one; on its own clock (with a
     delay) or on the caller's `progress`.
   - ArcGlow: a soft pre-rendered radial glow that travels at the head of an arc while it extends (tier A; only its
     opacity and position move).
   Reduced motion and the pre-rendered web HTML: everything at its value from the first frame. */
import React, { useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, withDelay, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { RadialGlow, fx, useFx } from '@/fx';
import { useDataStart } from '@/fx/motion/Reveal';
import { markSeen, seenValue } from '@/fx/motion/seen';
import { ease, motionValues, timing } from '@/fx/motion/tokens';

const M80 = motionValues.screens.m80;

/** What a clock does on this mount: 'rest' (nothing changed since it was seen), 'first' (never seen this session) or
 *  'change' (seen, and different now). */
export type ClockKind = 'rest' | 'first' | 'change';

/** The clock for values seen under `keys` (all must be unchanged for 'rest'): 1 at once for 'rest' and under reduced
 *  motion, else 0 → 1 once it may start. */
export function useChangeClock(kind: ClockKind, ms: { first: number; change: number }, delay = 0): SharedValue<number> {
  const { calm, inHtml } = useFx();
  const still = calm || inHtml || kind === 'rest';
  const p = useSharedValue(still ? 1 : 0);
  const length = kind === 'first' ? ms.first : ms.change;
  useDataStart(undefined, undefined, !still, (wait) => {
    'worklet';
    const run = withTiming(1, timing(length, ease.cubicOut));
    const w = wait + delay;
    p.set(w > 0 ? withDelay(w, run) : run);
  });
  return p;
}

/** How a value under `key` compares with what was seen last this session (read once, at mount). */
export function useSeenKind(key: string, value: number | null): ClockKind {
  const [kind] = useState<ClockKind>(() => {
    if (value == null) return 'rest';
    const prior = seenValue(key);
    return prior === undefined ? 'first' : prior === value ? 'rest' : 'change';
  });
  return kind;
}

/** A rounded bar whose fill slides in by translateX from the share shown last. */
/** Each bar's last measured track width, by its seen key (FillBar). */
const TRACK_W = new Map<string, number>();

export function FillBar({ share, seenKey, color, height = 6, track = fx.fill.a10, progress, ms = M80.fuelArcMs, delay = 0, accessibilityLabel, style }: {
  share: number; seenKey: string; color: string; height?: number; track?: string;
  /** The caller's clock (one clock with a number); without it the bar runs its own over `ms` after `delay`. */
  progress?: SharedValue<number>; ms?: number; delay?: number; accessibilityLabel?: string; style?: StyleProp<ViewStyle>;
}) {
  const { calm, inHtml } = useFx();
  const still = calm || inHtml;
  const key = `bar:${seenKey}`;
  const target = Math.max(0, Math.min(1, share));
  const [base] = useState(() => seenValue(key) ?? 0); // the share shown last, read once
  const atRest = still || base === target;
  const own = useSharedValue(atRest ? 1 : 0);
  // the track's last measured width: a bar drawn again (a new key for a new share) shows on its first frame instead of
  // waiting a layout pass hidden (the adherence bar blinked out for 3 frames on a meal log, CRT-5)
  const width = useSharedValue(TRACK_W.get(key) ?? 0);
  const remember = () => markSeen(key, target);
  useEffect(() => { if (atRest) remember(); }); // eslint-disable-line react-hooks/exhaustive-deps
  useDataStart(undefined, undefined, !atRest && !progress, (wait) => {
    'worklet';
    scheduleOnRN(remember);
    const run = withTiming(1, timing(ms, ease.cubicOut));
    const w = wait + delay;
    own.set(w > 0 ? withDelay(w, run) : run);
  });
  // the caller's clock: the new share counts as seen once it starts to move
  useAnimatedReaction(() => (progress && !atRest ? progress.get() > 0 : false), (moving, was) => {
    if (moving && !was) scheduleOnRN(remember);
  });
  const fill = useAnimatedStyle(() => {
    const k = atRest ? 1 : Math.max(0, Math.min(1, progress ? progress.get() : own.get()));
    const v = base + (target - base) * k;
    const w = width.get();
    return { opacity: w > 0 ? 1 : 0, transform: [{ translateX: -(1 - v) * w }] }; // hidden until the track is measured
  });
  const onLayout = (e: LayoutChangeEvent) => { const w = e.nativeEvent.layout.width; if (w > 0) { TRACK_W.set(key, w); width.set(w); } };
  return <View
    onLayout={onLayout}
    style={[{ height, borderRadius: height / 2, backgroundColor: track, overflow: 'hidden' }, style]}
    accessibilityRole="progressbar"
    accessibilityLabel={accessibilityLabel}
    accessibilityValue={{ min: 0, max: 100, now: Math.round(target * 100) }}>
    <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: height / 2, backgroundColor: color }, fill]} />
  </View>;
}

/** A soft glow at the head of an arc (centre `c`, radius `r`, in a `box`-point square) while `share` moves: visible
 *  only between the clock's start and end (opacity sin(πk)). Tier A only; reduced motion and other tiers draw nothing. */
export function ArcGlow({ progress, from, to, box, c, r, size = 44 }: { progress: SharedValue<number>; from: number; to: number; box: number; c: number; r: number; size?: number }) {
  const { calm, inHtml, tier } = useFx();
  const scale = box / (2 * c);
  const a = useAnimatedStyle(() => {
    const k = Math.max(0, Math.min(1, progress.get()));
    const s = from + (to - from) * k;
    const th = -Math.PI / 2 + Math.PI * 2 * s;
    const x = (c + r * Math.cos(th)) * scale - size / 2;
    const y = (c + r * Math.sin(th)) * scale - size / 2;
    return { opacity: k > 0 && k < 1 ? Math.sin(Math.PI * k) : 0, transform: [{ translateX: x }, { translateY: y }] };
  });
  if (calm || inHtml || tier !== 'A' || from === to) return null;
  return <Animated.View pointerEvents="none" style={[styles.glow, { width: size, height: size }, a]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <RadialGlow color={fx.red.brand} opacity={0.6} fade={0.7} style={StyleSheet.absoluteFill} />
  </Animated.View>;
}

const styles = StyleSheet.create({
  glow: { position: 'absolute', left: 0, top: 0 },
});
