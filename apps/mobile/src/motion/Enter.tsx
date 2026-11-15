/* Entrance with depth: on mount the content fades in, rises `distance` points, grows from slightly smaller and leans back
   into place under a perspective camera. `index` staggers siblings. Give it a `key` that changes (a step name) to play it
   again. The wrapper is a plain view with no style of its own: wrap a single element that is always rendered (never one
   that may render nothing, or the empty wrapper would take a slot in its parent's gap), and pass the child's own
   `alignSelf` / `flex` through `style` when it has one, so the layout is exactly what it was. At rest: opacity 1 and no
   transform. Reduced motion: the content is shown at rest from the first frame. On the web, content in the page's
   pre-rendered HTML is at rest from the first frame too (./staticHtml.ts); native always plays the entrance. */
import React, { useEffect } from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { ease, motion } from './tokens';
import { useInStaticHtml } from './staticHtml';
import { useReduceMotion } from './useReduceMotion';

export type EnterProps = {
  children: React.ReactNode;
  /** Position among siblings that enter together; each step waits `motion.stagger.step` ms. */
  index?: number;
  /** Extra wait before this element starts, in ms. */
  delay?: number;
  /** How far the element rises, in points. */
  distance?: number;
  /** Lean back from a slight tilt (3D). Off for small inline text. */
  depth?: boolean;
  /** Layout passthrough for the wrapper only (alignSelf, flex), never a visual style. */
  style?: StyleProp<ViewStyle>;
};

export function staggerDelay(index: number, delay = 0): number {
  return delay + Math.min(Math.max(0, Math.floor(index)), motion.stagger.maxSteps) * motion.stagger.step;
}

export function Enter({ children, index = 0, delay = 0, distance = motion.enter.distance, depth = true, style }: EnterProps) {
  const reduce = useReduceMotion();
  const inHtml = useInStaticHtml(Platform.OS === 'web');
  const atRest = reduce || inHtml;
  const progress = useSharedValue(atRest ? 1 : 0);
  const settled = useSharedValue(atRest ? 1 : 0);

  useEffect(() => {
    if (reduce) { cancelAnimation(progress); progress.set(1); settled.set(1); return; }
    if (settled.get() === 1) return; // already in place: never replay because a setting changed
    progress.set(withDelay(staggerDelay(index, delay), withTiming(1, { duration: motion.enter.duration, easing: ease.out }, (finished) => {
      'worklet';
      if (finished) settled.set(1);
    })));
    // the entrance plays once per mount; a new `key` mounts it again
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce]);

  const animated = useAnimatedStyle(() => {
    if (settled.get() === 1) return { opacity: 1, transform: [] };
    const v = progress.get();
    const k = 1 - v;
    const scale = motion.enter.scaleFrom + (1 - motion.enter.scaleFrom) * v;
    return {
      opacity: v,
      transform: depth
        ? [{ perspective: motion.perspective.card }, { translateY: k * distance }, { rotateX: `${k * motion.enter.tiltFrom}deg` }, { scale }]
        : [{ translateY: k * distance }, { scale }],
    };
  });

  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}
