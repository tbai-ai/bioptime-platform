/* The large-title collapse and the compact bar (PREMIUM §1.4 "Large-title collapse and sticky bars").
   - <LargeTitle>: over y 0 → 56 the big title fades out, rises at 0.3× the scroll and shrinks to .94 from its left edge.
   - <CompactBar>: safe top + 44 high, laid over the top of the screen; fades in over y 48 → 88 with its title (Bebas 20)
     rising 6 → 0; a white/5 hairline appears at 88. Background: #0A0A0A at .80 with a 12 pt blur on tier A (iOS and
     web); with no blur (tiers B and C, every Android: no blur on Android in Phase 1, CRITIQUE §19) the panel's own
     opaque #0A0A0A, since a .94 fill without blur is no glass and only let the scrolled text read through behind the
     title (SMA-3). The background is in over the first 16 pt of the fade (header.groundIn), ahead of the title, so the
     page never shows through a half-faded bar under the rising title.
     While it is hidden (less than half shown) it takes no touch at all, so buttons in the page header under it keep
     working; once shown it takes touches like any bar (its own buttons, and nothing passes through to the page).
   - <StickyUnderBar>: a segment row that pins under the compact bar (translateY = max(0, y − (rowTop − barH))) and
     takes an opaque #0A0A0A background over 24 pt of scroll (the page passing under it never shows through a
     translucent segment track); built from transforms, not stickyHeaderIndices.
   Calm: the bar and the sticky row switch with the scroll position without movement (opacity only, no rise). */
import React, { useState } from 'react';
import { Platform, StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import Animated, { useAnimatedReaction, useAnimatedRef, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { measureView } from './measured';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import { fx } from '@/theme';
import { type } from '@/fx/type';
import { motionValues } from './tokens';
import { useMotion } from './tier';

const H = motionValues.header;

/** A resting transform, one array for every run: Reanimated compares a style's values by identity, so a new [] on each
 *  scroll frame re-sent the unchanged style (a shadow-tree commit per view per frame on Android). */
const REST_T: never[] = [];

export function LargeTitle({ scrollY, children, style }: { scrollY: SharedValue<number>; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { still } = useMotion();
  const animated = useAnimatedStyle(() => {
    const y = Math.max(0, scrollY.get());
    const k = Math.min(1, y / H.collapse);
    if (k <= 0) return { opacity: 1, transform: REST_T };
    if (still) return { opacity: 1 - k, transform: REST_T };
    return { opacity: 1 - k, transform: [{ translateY: -H.titleShift * Math.min(y, H.collapse) }, { scale: 1 - (1 - H.titleScale) * k }] };
  });
  return <Animated.View style={[styles.left, style, animated]}>{children}</Animated.View>;
}

export type CompactBarProps = {
  scrollY: SharedValue<number>;
  title: string;
  /** Buttons at the right end (close, bell). They take touches only once the bar shows (more than half faded in). */
  right?: React.ReactNode;
  left?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function CompactBar({ scrollY, title, right, left, style }: CompactBarProps) {
  const { tier, still } = useMotion();
  const insets = useSafeAreaInsets();
  const blur = tier === 'A' && !still && Platform.OS !== 'android';
  const height = insets.top + H.barHeight;

  const bar = useAnimatedStyle(() => ({ opacity: Math.max(0, Math.min(1, (scrollY.get() - H.barFrom) / (H.barTo - H.barFrom))) }));
  const ground = useAnimatedStyle(() => ({ opacity: Math.max(0, Math.min(1, (scrollY.get() - H.barFrom) / H.groundIn)) }));
  const titleStyle = useAnimatedStyle(() => {
    const k = Math.max(0, Math.min(1, (scrollY.get() - H.barFrom) / (H.barTo - H.barFrom)));
    return still ? { transform: REST_T } : { transform: [{ translateY: H.titleRise * (1 - k) }] };
  });
  const hairline = useAnimatedStyle(() => ({ opacity: scrollY.get() >= H.barTo ? 1 : 0 }));
  // touches only while the bar is more than half shown (a transparent bar must not cover the header under it)
  const [shown, setShown] = useState(false);
  useAnimatedReaction(() => scrollY.get() > (H.barFrom + H.barTo) / 2, (on, was) => { if (on !== was) scheduleOnRN(setShown, on); });

  return <Animated.View pointerEvents={shown ? 'auto' : 'none'} aria-hidden={!shown || undefined} accessibilityElementsHidden={!shown}
    importantForAccessibility={shown ? 'auto' : 'no-hide-descendants'} style={[styles.bar, { height }, style]}>
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, ground]}>
      {blur ? <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} /> : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: blur ? fx.glass.header : fx.bg.panel }]} />
    </Animated.View>
    <Animated.View pointerEvents="box-none" style={[styles.row, { paddingTop: insets.top }, bar]}>
      <View style={styles.side}>{left}</View>
      <Animated.View style={[styles.titleBox, titleStyle]}>
        <Text style={type.small20} numberOfLines={1} maxFontSizeMultiplier={1.2} accessibilityRole="header">{title}</Text>
      </Animated.View>
      <View style={[styles.side, styles.end]}>{right}</View>
    </Animated.View>
    <Animated.View style={[styles.hairline, hairline]} />
  </Animated.View>;
}

export function StickyUnderBar({ scrollY, children, style }: { scrollY: SharedValue<number>; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const insets = useSafeAreaInsets();
  const barH = insets.top + H.barHeight;
  const ref = useAnimatedRef();
  const top = useSharedValue<number | null>(null);
  const onLayout = (_: LayoutChangeEvent) => {
    scheduleOnUI(() => {
      'worklet';
      const m = measureView(ref);
      if (m) top.set(m.pageY + scrollY.get());
    });
  };
  const pinned = (y: number, t0: number) => {
    'worklet';
    return Math.max(0, y - (t0 - barH));
  };
  const animated = useAnimatedStyle(() => {
    const t0 = top.get();
    if (t0 == null) return { transform: REST_T };
    return { transform: [{ translateY: pinned(scrollY.get(), t0) }] };
  });
  const back = useAnimatedStyle(() => {
    const t0 = top.get();
    return { opacity: t0 == null ? 0 : Math.min(1, pinned(scrollY.get(), t0) / 24) };
  });
  return <Animated.View ref={ref} onLayout={onLayout} style={[styles.sticky, style, animated]}>
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: fx.bg.panel }, back]} />
    {children}
  </Animated.View>;
}

const styles = StyleSheet.create({
  left: { transformOrigin: 'left' },
  bar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20, overflow: 'hidden' },
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
  side: { width: 56, flexDirection: 'row', alignItems: 'center' },
  end: { justifyContent: 'flex-end' },
  titleBox: { flex: 1, alignItems: 'center' },
  hairline: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 1, backgroundColor: fx.line.a05 },
  sticky: { zIndex: 10 },
});
