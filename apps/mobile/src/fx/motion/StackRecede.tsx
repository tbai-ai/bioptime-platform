/* The Store's vertical stack (PREMIUM §1.4 with CRITIQUE §20): as a package card's top passes `line` (safe top + 64,
   under the compact bar), it recedes over one card height: scale 1 → .96, its top edge tipping away up to 4°, opacity
   1 → .6. It does not lag behind the scroll, so no card ever slides over another and nothing overlaps.
   Tier A: all three; tier B: scale and opacity; tier C and calm: none. Reads the scroll offset from the enclosing
   <RevealScope> unless `scrollY` is given. */
import React from 'react';
import { type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedRef, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { measureView } from './measured';
import { scheduleOnUI } from 'react-native-worklets';
import { motionValues } from './tokens';
import { useMotion } from './tier';
import { useRevealScope } from './Reveal';

export type StackRecedeProps = {
  children: React.ReactNode;
  scrollY?: SharedValue<number>;
  /** Screen y where receding starts (default safe top + 64). */
  line?: number;
  style?: StyleProp<ViewStyle>;
};

export function StackRecede({ children, scrollY, line, style }: StackRecedeProps) {
  const { tier, still } = useMotion();
  const insets = useSafeAreaInsets();
  const scope = useRevealScope();
  const zero = useSharedValue(0);
  const y = scrollY ?? scope?.scrollY ?? zero;
  const on = !still && tier !== 'C' && (!!scrollY || !!scope);
  const at = line ?? insets.top + 64;
  const ref = useAnimatedRef();
  const top = useSharedValue<number | null>(null);
  const height = useSharedValue(1);

  const onLayout = (e: LayoutChangeEvent) => {
    height.set(Math.max(1, e.nativeEvent.layout.height));
    if (!on) return;
    scheduleOnUI(() => {
      'worklet';
      const m = measureView(ref);
      if (m) top.set(m.pageY + y.get());
    });
  };

  const animated = useAnimatedStyle(() => {
    const t0 = top.get();
    if (!on || t0 == null) return { opacity: 1, transform: [] };
    const k = Math.max(0, Math.min(1, (at - (t0 - y.get())) / height.get()));
    if (k <= 0) return { opacity: 1, transform: [] };
    const scale = 1 - 0.04 * k;
    const opacity = 1 - 0.4 * k;
    if (tier !== 'A') return { opacity, transform: [{ scale }] };
    return { opacity, transform: [{ perspective: motionValues.perspective.card }, { rotateX: `${4 * k}deg` }, { scale }] };
  });

  return <Animated.View ref={ref} onLayout={onLayout} style={[style, animated]}>{children}</Animated.View>;
}
