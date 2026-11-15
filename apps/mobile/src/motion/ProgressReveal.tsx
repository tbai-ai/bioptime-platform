/* Progress reveal: a progress fill grows from its start edge to the value it already has (scaleX from the left), on mount
   and again whenever `trigger` changes (a new value, a new range). Wrap the fill only, inside its existing track:
     <View style={track}><ProgressReveal trigger={pct}><View style={{ width: `${pct}%`, ...fill }} /></ProgressReveal></View>
   The wrapper stretches to the track's width like the fill's own parent did, so a percentage width resolves to the same
   size. At rest (and with reduced motion) there is no transform. On the web, a fill in the page's pre-rendered HTML
   starts at its value and grows only when the value changes (./staticHtml.ts); native is unchanged. */
import React, { useEffect, useRef } from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { staggerDelay } from './Enter';
import { ease, motion } from './tokens';
import { useInStaticHtml } from './staticHtml';
import { useReduceMotion } from './useReduceMotion';

export function ProgressReveal({ children, trigger, index = 0, delay = 0, style }: { children: React.ReactNode; trigger?: unknown; index?: number; delay?: number; style?: StyleProp<ViewStyle> }) {
  const reduce = useReduceMotion();
  const inHtml = useInStaticHtml(Platform.OS === 'web');
  const fill = useSharedValue(reduce || inHtml ? 1 : 0);
  const settled = useSharedValue(reduce || inHtml ? 1 : 0);
  const last = useRef<{ trigger: unknown } | null>(null);

  useEffect(() => {
    if (reduce) { cancelAnimation(fill); fill.set(1); settled.set(1); last.current = { trigger }; return; }
    if (last.current && Object.is(last.current.trigger, trigger)) return; // nothing new to reveal
    const first = !last.current;
    last.current = { trigger };
    if (first && inHtml) return; // already drawn at its value in the pre-rendered page
    settled.set(0);
    fill.set(0);
    fill.set(withDelay(first ? staggerDelay(index, delay) : 0, withTiming(1, { duration: motion.progress.duration, easing: ease.out }, (finished) => {
      'worklet';
      if (finished) settled.set(1);
    })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce, trigger]);

  const animated = useAnimatedStyle(() => {
    if (settled.get() === 1) return { transform: [] };
    return { transform: [{ scaleX: Math.max(0.001, fill.get()) }] };
  });

  return <Animated.View style={[{ transformOrigin: 'left' }, style, animated]}>{children}</Animated.View>;
}
