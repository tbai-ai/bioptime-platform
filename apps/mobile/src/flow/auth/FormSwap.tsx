/* The sign-in's Email | Phone swap (motion v2 M53): never a blank frame, never a jump, an inert outgoing form.
   When `id` changes, the outgoing form stays mounted on top of where it was (absolute, inert from its first exit frame:
   no touches, hidden from assistive technology) and leaves opacity 1 → 0 and y 0 → m53.outY over m53.outMs on the
   expo curve, while the incoming form rises from m53.inY over m53.inMs, starting m53.inAt in. The block keeps the old
   height until the outgoing form is nearly gone (opacity ≤ m53.snapAt), then takes the new one: on the web what
   follows it glides from its old place with a transform (src/flow/follow, the `watchRef` given here), on native a
   LinearTransition of m53.heightMs animates it. The first form is drawn as it is (its entrance is the screen's beat).
   Reduced motion: an instant swap. Tier C: opacity only. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { doneOnce } from '@/fx/motion/once';
import { useMotion } from '@/fx/motion/tier';
import { motionValues, timing } from '@/fx/motion/tokens';
import { followLayout } from '@/flow/follow';

const S = motionValues.screens.m53;

type Swap = { id: string; leaving: { id: string; node: React.ReactNode } | null; n: number };

export function FormSwap({ id, children, watchRef }: { id: string; children: React.ReactNode; watchRef?: (node: unknown) => void }) {
  const { calm, inHtml } = useMotion();
  const still = calm || inHtml;
  const [swap, setSwap] = useState<Swap>({ id, leaving: null, n: 0 });
  const [hold, setHold] = useState<number | null>(null);
  const last = useRef<React.ReactNode>(children);
  const height = useRef(0);
  if (swap.id !== id) {
    setSwap({ id, leaving: still ? null : { id: swap.id, node: last.current }, n: swap.n + 1 });
    if (!still && height.current > 0) setHold(height.current); // the old height, until the outgoing form is nearly gone
  } else {
    last.current = children;
  }
  const leftKey = swap.leaving?.id ?? null;
  const left = useCallback(() => {
    setSwap((s) => (s.leaving && s.leaving.id === leftKey ? { ...s, leaving: null } : s));
    setHold(null);
  }, [leftKey]);
  const release = useCallback(() => setHold(null), []);
  const onLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0 && hold == null) height.current = h; // a detached page reports 0
  };
  return <Animated.View ref={watchRef} onLayout={onLayout} layout={followLayout(S.heightMs)} style={hold != null ? { minHeight: hold } : null}>
    {swap.leaving ? <Leaving key={'k' + swap.leaving.id} onLeft={left} onSnap={release}>{swap.leaving.node}</Leaving> : null}
    <Entering key={'k' + swap.id} enter={swap.n > 0 && !still}>{swap.id === id ? children : last.current}</Entering>
  </Animated.View>;
}

function Leaving({ children, onLeft, onSnap }: { children: React.ReactNode; onLeft: () => void; onSnap: () => void }) {
  const { tier } = useMotion();
  const out = useSharedValue(0);
  useEffect(() => {
    const once = doneOnce(onLeft, S.outMs + motionValues.overlay.fallbackExtra);
    const done = once.done;
    out.value = withTiming(1, timing(S.outMs), (f) => { 'worklet'; if (f) scheduleOnRN(done); });
    return () => once.cancel();
    // once, as it starts leaving
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // the block takes its new height once this form is nearly gone
  useAnimatedReaction(() => (out.value >= 1 - S.snapAt ? 1 : 0), (now, was) => { if (now === 1 && was !== 1) scheduleOnRN(onSnap); });
  const move = tier !== 'C';
  const a = useAnimatedStyle(() => ({ opacity: 1 - out.value, transform: move ? [{ translateY: S.outY * out.value }] : [] }));
  return <Animated.View style={[styles.leaving, a]} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
    {children}
  </Animated.View>;
}

function Entering({ children, enter }: { children: React.ReactNode; enter: boolean }) {
  const { tier } = useMotion();
  const p = useSharedValue(enter ? 0 : 1);
  useEffect(() => {
    if (enter) p.value = withDelay(S.inAt, withTiming(1, timing(S.inMs)));
    // once, on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const move = tier !== 'C';
  const a = useAnimatedStyle(() => (p.value === 1 ? { opacity: 1, transform: [] } : { opacity: p.value, transform: move ? [{ translateY: S.inY * (1 - p.value) }] : [] }));
  return <Animated.View style={a}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  leaving: { position: 'absolute', left: 0, right: 0, top: 0 },
});
