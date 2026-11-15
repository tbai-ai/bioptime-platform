/* The brand moment: the Bioptime mark turns in from an angle under a close perspective camera (a 3D feel with plain
   transforms, no WebGL), settles flat, then follows a finger (it tips towards where it is touched) and springs back when
   let go. The mark itself is untouched: same image, size, radius and colours; only the wrapper moves. At rest (and with
   reduced motion) there is no transform and full opacity. Nothing loops: once settled the layer does no work. On the
   web, a mark in the page's pre-rendered HTML starts settled (./staticHtml.ts); native always plays the turn-in. */
import React, { useEffect } from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { ease, motion, springs } from './tokens';
import { useInStaticHtml } from './staticHtml';
import { usePointerTilt } from './usePointerTilt';
import { useReduceMotion } from './useReduceMotion';

export function BrandTilt({ children, delay = 0, style }: { children: React.ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
  const reduce = useReduceMotion();
  const inHtml = useInStaticHtml(Platform.OS === 'web');
  const intro = useSharedValue(reduce || inHtml ? 1 : 0);
  const introDone = useSharedValue(reduce || inHtml ? 1 : 0);
  const touch = useSharedValue(0);
  const touchIdle = useSharedValue(1);

  useEffect(() => {
    if (reduce) {
      cancelAnimation(intro); cancelAnimation(touch);
      intro.set(1); introDone.set(1); touch.set(0); touchIdle.set(1);
      return;
    }
    if (introDone.get() === 1) return;
    const run = () => intro.set(withTiming(1, { duration: motion.brand.duration, easing: ease.out }, (finished) => {
      'worklet';
      if (finished) introDone.set(1);
    }));
    if (!delay) { run(); return; }
    const t = setTimeout(run, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce]);

  const { ref, nx, ny, handlers } = usePointerTilt({
    enabled: !reduce,
    follow: true,
    onBegin: () => { touchIdle.set(0); touch.set(withTiming(1, { duration: 160, easing: ease.out })); },
    onEnd: () => touch.set(withSpring(0, springs.brandRelease, (finished) => {
      'worklet';
      if (finished) touchIdle.set(1);
    })),
  });

  const animated = useAnimatedStyle(() => {
    if (introDone.get() === 1 && touchIdle.get() === 1) return { opacity: 1, transform: [] };
    const i = intro.get();
    const t = touch.get();
    const k = 1 - i;
    const scale = (motion.brand.scaleFrom + (1 - motion.brand.scaleFrom) * i) * (1 - motion.brand.touchScale * t);
    return {
      opacity: Math.min(1, i * 1.8),
      transform: [
        { perspective: motion.perspective.brand },
        { rotateX: `${k * motion.brand.rotateXFrom - ny.get() * motion.brand.touchTilt * t}deg` },
        { rotateY: `${k * motion.brand.rotateYFrom + nx.get() * motion.brand.touchTilt * t}deg` },
        { scale },
      ],
    };
  });

  return <Animated.View ref={ref} style={[style, animated]} {...handlers}>{children}</Animated.View>;
}
