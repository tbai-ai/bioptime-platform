/* Stretchy and parallax photo headers (PREMIUM §1.4): the Home hero, the Train / Bio / Life / Fuel / Tests header photos
   and overlay heroes. Put it first inside the scroll content; it is driven by the scroll offset y:
   - y < 0 (iOS bounce pull): pinned to the top (translateY = y) and stretched from the top (scale 1 + (−y)/H); on tier A
     the 64 px copy of the same photo (`blurCopy`) fades in over it (.65 at 120 pt): a blur without a blur filter.
   - 0 ≤ y ≤ H: the photo moves at 0.4× (translateY = 0.6·y) and fades: opacity base·(1 − 0.6·y/H).
   - y > H: not drawn.
   Android keeps its own stretch overscroll, so it never sees a negative y. `settle` plays the hero settle on first show
   (scale 1.1 → 1 and opacity 0 → base over 1.5 s), from the frame its page is active (never under the launch sting or
   on a pre-mounted page). Tier B: no blur copy; tier C: parallax only, and the settle is a 300 ms fade with no scale;
   calm: still.
   <ParallaxLayer speed> moves any layer at a share of the scroll (the red orbs: 0.3). headerHeight(width) gives H:
   320 on a 390-wide phone, 280 at ≤ 360, 360 at ≥ 768. */
import React, { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { usePageActive } from '@/fx/nav/pageReady';
import { ease, motionValues, t, timing } from './tokens';
import { useMotion } from './tier';

/** A resting transform, one array for every run: Reanimated compares a style's values by identity, so a new [] on each
 *  scroll frame re-sent the unchanged style (a shadow-tree commit per view per frame on Android). */
const REST_T: never[] = [];

export function headerHeight(width: number): number {
  if (width >= 768) return 360;
  if (width <= 360) return 280;
  return 320;
}

export type StretchyHeaderProps = {
  scrollY: SharedValue<number>;
  height: number;
  /** The photo (filling the header). */
  photo: React.ReactNode;
  /** The 64 px copy of the same photo, for the pull-down blur illusion (tier A). */
  blurCopy?: React.ReactNode;
  /** The photo's resting opacity (Home .40, Train .20, Bio / Life / Fuel / Tests .22). */
  base?: number;
  /** Play the hero settle on first show. */
  settle?: boolean;
  /** Scrims and tints over the photo: they move with it and fade with the scroll, but not by `base`. */
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function StretchyHeader({ scrollY, height, photo, blurCopy, base = 0.4, settle, children, style }: StretchyHeaderProps) {
  const { tier, still } = useMotion();
  const active = usePageActive();
  const enter = useSharedValue(settle && !still ? 0 : 1);
  const begun = useSharedValue(settle && !still ? 0 : 1);
  const lite = tier === 'C';
  const ms = lite ? motionValues.stretchy.cFadeMs : t.settle;
  // the settle plays once per mount, from the page-active edge
  useAnimatedReaction(() => (begun.get() === 0 && active.get() === 1 ? 1 : 0), (go) => {
    if (go !== 1 || begun.get() === 1) return;
    begun.set(1);
    enter.set(withTiming(1, timing(ms, ease.expo)));
  });
  useEffect(() => {
    if (still) { begun.set(1); enter.set(1); }
  }, [still, begun, enter]);

  const frame = useAnimatedStyle(() => {
    const e = enter.get();
    const settleScale = lite ? 1 : 1.1 - 0.1 * e;
    if (still) return { transform: REST_T };
    const y = scrollY.get();
    if (y < 0) {
      if (tier === 'C') return { transform: [{ translateY: y }, { scale: settleScale }] };
      return { transform: [{ translateY: y }, { scale: (1 + -y / height) * settleScale }] };
    }
    return { transform: [{ translateY: 0.6 * Math.min(y, height) }, { scale: settleScale }] };
  });
  const fade = (k: number) => {
    'worklet';
    const y = scrollY.get();
    if (y <= 0) return k;
    if (y > height) return 0;
    return k * (1 - (0.6 * y) / height);
  };
  const photoStyle = useAnimatedStyle(() => ({ opacity: still ? base : fade(base * enter.get()) }));
  const overStyle = useAnimatedStyle(() => ({ opacity: still ? 1 : fade(1) }));
  const blurStyle = useAnimatedStyle(() => {
    const y = scrollY.get();
    return { opacity: y < 0 ? 0.65 * Math.min(1, -y / 120) * base : 0 };
  });

  return <View pointerEvents="none" style={[{ position: 'absolute', left: 0, right: 0, top: 0, height }, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Animated.View style={[StyleSheet.absoluteFill, styles.top, frame]}>
      <Animated.View style={[StyleSheet.absoluteFill, photoStyle]}>{photo}</Animated.View>
      {blurCopy && tier === 'A' && !still ? <Animated.View style={[StyleSheet.absoluteFill, blurStyle]}>{blurCopy}</Animated.View> : null}
      {children ? <Animated.View style={[StyleSheet.absoluteFill, overStyle]}>{children}</Animated.View> : null}
    </Animated.View>
  </View>;
}

/** A layer that moves at `speed` × the scroll (0.3 for the hero orbs), from y = 0 down; still under calm. */
export function ParallaxLayer({ scrollY, speed, children, style }: { scrollY: SharedValue<number>; speed: number; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { still } = useMotion();
  const animated = useAnimatedStyle(() => {
    if (still) return { transform: REST_T };
    return { transform: [{ translateY: speed * Math.max(0, scrollY.get()) }] };
  });
  return <Animated.View pointerEvents="none" style={[style, animated]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  top: { transformOrigin: 'top' },
});
