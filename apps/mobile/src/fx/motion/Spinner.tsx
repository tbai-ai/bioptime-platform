/* Spinners (THEME §11.12): the inline 16 pt ring (border 2, red/30 with a red top) and the splash's 48 pt ring
   (white/20 with a white/80 top), one turn per second, linear, on the UI thread. They run only while something loads,
   at every tier (tier C included: one rotation is the cheapest loop there is, and a still ring looks frozen), and only
   while their page is active. Calm (`!still` gates the turn): the ring stands still as drawn, and on the splash variant
   a static "Loading…" caption fades in once if the wait passes a second. */
import React, { useEffect } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { fx } from '@/theme';
import { FONTS } from '@/fx/type';
import { calmFade, motionValues, t } from './tokens';
import { useLoopClock, useLoopGate } from './loop';
import { useMotion } from './tier';

export type SpinnerProps = {
  /** inline: 16 pt red (buttons, rows); splash: 48 pt white (the splash hold, the earlier app's loader). */
  variant?: 'inline' | 'splash';
  size?: number;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export function Spinner({ variant = 'inline', size, accessibilityLabel = 'Loading', style }: SpinnerProps) {
  const { still, calm } = useMotion();
  const { active } = useLoopGate();
  const run = !still;
  const clock = useLoopClock(t.spinner, run, active);
  const spin = useAnimatedStyle(() => (run ? { transform: [{ rotate: clock.get() * 360 + 'deg' }] } : { transform: [] }));
  const s = size ?? (variant === 'splash' ? 48 : 16);
  const ring = variant === 'splash'
    ? { borderColor: fx.ink.a20, borderTopColor: fx.ink.a80 }
    : { borderColor: fx.red.a30, borderTopColor: fx.red.brand };

  // calm, on a page-level wait: a still caption once the wait passes a second
  const captioned = calm && variant === 'splash';
  const caption = useSharedValue(0);
  useEffect(() => {
    if (!captioned) { caption.set(0); return; }
    const timer = setTimeout(() => { caption.set(withTiming(1, calmFade(t.calm))); }, motionValues.loader.calmCaptionAfter);
    return () => clearTimeout(timer);
  }, [captioned, caption]);
  const captionStyle = useAnimatedStyle(() => ({ opacity: caption.get() }));

  return <View style={style} accessible accessibilityRole="progressbar" accessibilityLabel={accessibilityLabel}>
    <Animated.View style={[{ width: s, height: s, borderRadius: s / 2, borderWidth: 2 }, ring, spin]} />
    {captioned ? <Animated.View pointerEvents="none" style={[styles.caption, { top: s + 12 }, captionStyle]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={styles.captionText} maxFontSizeMultiplier={1.3}>Loading…</Text>
    </Animated.View> : null}
  </View>;
}

const styles = StyleSheet.create({
  caption: { position: 'absolute', left: -60, right: -60, alignItems: 'center' },
  captionText: { fontFamily: FONTS.sans500, fontSize: 12, lineHeight: 16, color: fx.ink.a50 },
});
