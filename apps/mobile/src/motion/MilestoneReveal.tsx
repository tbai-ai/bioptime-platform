/* Milestone reveal: marks the moment something is reached (a task ticked, a goal or milestone achieved, a value saved).
   - variant 'pop': the element springs up from smaller with a slight overshoot;
   - variant 'flip': it turns in about its horizontal axis like a split-flap card (a 3D flip under perspective).
   It plays when `trigger` changes (pass the status it reflects), and also on mount with `playOnMount` (for an element
   that only appears when the milestone is reached). It never plays for the value it mounted with unless asked, so a list
   that loads with ticks already in place stays still. Same wrapper rules as Enter. At rest (and with reduced motion):
   opacity 1 and no transform. On the web, an element in the page's pre-rendered HTML does not play on mount
   (./staticHtml.ts); native is unchanged. */
import React, { useEffect, useRef } from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { ease, motion } from './tokens';
import { useInStaticHtml } from './staticHtml';
import { useReduceMotion } from './useReduceMotion';

export type MilestoneRevealProps = {
  children: React.ReactNode;
  trigger?: unknown;
  playOnMount?: boolean;
  variant?: 'pop' | 'flip';
  style?: StyleProp<ViewStyle>;
};

export function MilestoneReveal({ children, trigger, playOnMount = false, variant = 'pop', style }: MilestoneRevealProps) {
  const reduce = useReduceMotion();
  const inHtml = useInStaticHtml(Platform.OS === 'web');
  const onMount = playOnMount && !inHtml; // nothing in pre-rendered HTML may start hidden
  const startHidden = onMount && !reduce;
  const p = useSharedValue(startHidden ? 0 : 1);
  const settled = useSharedValue(startHidden ? 0 : 1);
  const fromMount = useSharedValue(startHidden ? 1 : 0); // fade in only when the element itself is new
  const last = useRef<{ trigger: unknown } | null>(null);

  useEffect(() => {
    if (reduce) { cancelAnimation(p); p.set(1); settled.set(1); last.current = { trigger }; return; }
    const first = !last.current;
    if (!first && Object.is(last.current!.trigger, trigger)) return;
    last.current = { trigger };
    if (first && !onMount) return;
    fromMount.set(first ? 1 : 0);
    settled.set(0);
    p.set(0);
    p.set(withTiming(1, { duration: variant === 'pop' ? motion.milestone.popMs : motion.milestone.flipMs, easing: variant === 'pop' ? ease.pop : ease.out }, (finished) => {
      'worklet';
      if (finished) settled.set(1);
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce, trigger]);

  const animated = useAnimatedStyle(() => {
    if (settled.get() === 1) return { opacity: 1, transform: [] };
    const v = p.get();
    const opacity = fromMount.get() === 1 ? Math.min(1, Math.max(0, v * 2)) : 1;
    if (variant === 'flip') {
      return { opacity, transform: [{ perspective: motion.perspective.flip }, { rotateX: `${(1 - v) * motion.milestone.flipFrom}deg` }] };
    }
    return { opacity, transform: [{ scale: motion.milestone.popFrom + (1 - motion.milestone.popFrom) * v }] };
  });

  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}
