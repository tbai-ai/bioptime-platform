/* Typing dots (THEME §11.12): three 6 pt red dots rising 5 pt and brightening (.4 → 1 → .4) over 1.1 s, 0.16 s apart.
   Shown only while the member's message is on its way, or while the assistant (when the server turns it on) waits
   for its answer: never as decoration. A loader, so it runs at every tier (tier C included), only while its page is
   active; calm: three still dots. Hidden from screen readers (the thread announces the state in words). */
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { fx } from '@/theme';
import { t } from './tokens';
import { keyframes } from './curve';
import { useLoopClock, useLoopGate } from './loop';
import { useMotion } from './tier';

function Dot({ clock, offset, run, color }: { clock: SharedValue<number>; offset: number; run: boolean; color: string }) {
  const animated = useAnimatedStyle(() => {
    if (!run) return { opacity: 0.6, transform: [] };
    const p = (clock.get() - offset + 1) % 1;
    return { opacity: keyframes(p, [0, 0.5, 1], [0.4, 1, 0.4]), transform: [{ translateY: keyframes(p, [0, 0.5, 1], [0, -5, 0]) }] };
  });
  return <Animated.View style={[styles.dot, { backgroundColor: color }, animated]} />;
}

export function TypingDots({ color = fx.red.vivid, style }: { color?: string; style?: StyleProp<ViewStyle> }) {
  const { still } = useMotion();
  const { active } = useLoopGate();
  const run = !still;
  const clock = useLoopClock(t.typing, run, active);
  return <View style={[styles.row, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    {[0, 0.16, 0.32].map((d) => <Dot key={d} clock={clock} offset={d / (t.typing / 1000)} run={run} color={color} />)}
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 16 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
