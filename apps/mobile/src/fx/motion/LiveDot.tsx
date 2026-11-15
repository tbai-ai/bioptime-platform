/* The live dot (THEME §11.12): an 8 pt dot with a ring that grows to 2.2× and fades (opacity .8 → 0 → .8) every 2 s.
   Only for something that is live right now (steps being counted on this phone): nothing pulses "live" otherwise
   (PREMIUM §0). The pulse runs for the motion budget (5 s after focus or the last touch: ./budget), then the ring
   fades and the solid dot stays, still saying "live". While its page is not active the pulse holds where it is (on
   the UI thread) and resumes from there. Calm, tier C, and screens not in front: the dot alone, still. */
import React, { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { fx } from '@/theme';
import { t } from './tokens';
import { keyframes } from './curve';
import { useLoopClock, useLoopGate } from './loop';
import { useMotionBudget } from './budget';
import { useMotion } from './tier';

export function LiveDot({ color = fx.hue.emerald, size = 8, style }: { color?: string; size?: number; style?: StyleProp<ViewStyle> }) {
  const { tier, still } = useMotion();
  const { active, visible } = useLoopGate();
  const run = useMotionBudget(!still && tier !== 'C' && visible, undefined, active);
  const clock = useLoopClock(t.liveDot, run, active, true);
  // the ring fades out over 300 ms when the budget ends (rather than vanishing mid-pulse)
  const shown = useSharedValue(run ? 1 : 0);
  useEffect(() => { shown.set(run ? 1 : withTiming(0, { duration: 300 })); }, [run, shown]);
  const ring = useAnimatedStyle(() => {
    const k = shown.get();
    if (k === 0) return { opacity: 0, transform: [] };
    const p = clock.get();
    return { opacity: k * keyframes(p, [0, 0.5, 1], [0.8, 0, 0.8]), transform: [{ scale: keyframes(p, [0, 0.5, 1], [1, 2.2, 1]) }] };
  });
  return <View style={[{ width: size, height: size }, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: size / 2, backgroundColor: color }, ring]} />
    <View style={[StyleSheet.absoluteFill, { borderRadius: size / 2, backgroundColor: color }]} />
  </View>;
}
