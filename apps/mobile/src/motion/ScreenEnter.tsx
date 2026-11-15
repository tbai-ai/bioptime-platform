/* Screen entrance with depth: when a screen mounts, its content swings in about its vertical axis under a perspective
   camera (rotateY), slides a few points in from the right and grows from slightly smaller, then rests flat. Short
   (motion.screen.duration) and never in the way: touches work from the first frame, nothing waits for it, and the
   entrance plays once per screen (a tab that is shown again does not replay it). Used by Screen in components/ui.tsx,
   so every screen enters this way. The wrapper only fills the space its content had (flex 1 for a fixed screen,
   flexGrow 1 inside a scroll view), so the layout is exactly what it was. At rest: opacity 1 and no transform. Reduced
   motion: at rest from the first frame. On the web, a screen in the page's pre-rendered HTML starts at rest
   (./staticHtml.ts); native always plays the entrance. */
import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { screenPose } from './depthMath';
import { ease, motion } from './tokens';
import { useInStaticHtml } from './staticHtml';
import { useReduceMotion } from './useReduceMotion';

export function ScreenEnter({ children, fill }: { children: React.ReactNode; fill?: boolean }) {
  const reduce = useReduceMotion();
  const inHtml = useInStaticHtml(Platform.OS === 'web');
  const atRest = reduce || inHtml;
  const progress = useSharedValue(atRest ? 1 : 0);
  const settled = useSharedValue(atRest ? 1 : 0);

  useEffect(() => {
    if (reduce) { cancelAnimation(progress); progress.set(1); settled.set(1); return; }
    if (settled.get() === 1) return; // already in place: never replay because a setting changed
    progress.set(withTiming(1, { duration: motion.screen.duration, easing: ease.out }, (finished) => {
      'worklet';
      if (finished) settled.set(1);
    }));
    // the entrance plays once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce]);

  const animated = useAnimatedStyle(() => {
    if (settled.get() === 1) return { opacity: 1, transform: [] };
    const p = screenPose(progress.get());
    return { opacity: p.opacity, transform: [{ perspective: motion.perspective.screen }, { translateX: p.translateX }, { rotateY: `${p.rotateY}deg` }, { scale: p.scale }] };
  });

  return <Animated.View style={[fill ? { flex: 1 } : { flexGrow: 1 }, animated]}>{children}</Animated.View>;
}
