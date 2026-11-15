/* Press depth on cards: while a finger rests on the card it sinks a little (scale) and tips away from the finger under a
   perspective camera, then eases back when the finger lifts, leaves or starts a scroll. It never claims the touch, so the
   buttons, rows and links inside the card behave exactly as before. Transform only: no colour, size or shadow change, and
   no transform at all at rest. Reduced motion: no response. Same wrapper rules as Enter (one always-rendered child;
   pass the child's alignSelf / flex through `style`). */
import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { ease, motion } from './tokens';
import { usePointerTilt } from './usePointerTilt';
import { useReduceMotion } from './useReduceMotion';
import { Enter, type EnterProps } from './Enter';
import { ScrollDepth, useScrollDepth } from './ScrollDepth';

export type PressDepthProps = {
  children: React.ReactNode;
  /** Largest tip, in degrees, when the finger is at an edge. */
  tilt?: number;
  /** Scale while pressed. */
  scale?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function PressDepth({ children, tilt = motion.press.tilt, scale = motion.press.scale, disabled, style }: PressDepthProps) {
  const reduce = useReduceMotion();
  const press = useSharedValue(0);
  const { ref, nx, ny, handlers } = usePointerTilt({
    enabled: !reduce && !disabled,
    onBegin: () => press.set(withTiming(1, { duration: motion.press.inMs, easing: ease.out })),
    onEnd: () => press.set(withTiming(0, { duration: motion.press.outMs, easing: ease.out })),
  });

  const animated = useAnimatedStyle(() => {
    const v = press.get();
    if (v <= 0) return { transform: [] };
    return {
      transform: [
        { perspective: motion.perspective.card },
        { rotateX: `${-ny.get() * tilt * v}deg` }, // the pressed edge goes away from the viewer
        { rotateY: `${nx.get() * tilt * v}deg` },
        { scale: 1 - (1 - scale) * v },
      ],
    };
  });

  return <Animated.View ref={ref} style={[style, animated]} {...handlers}>{children}</Animated.View>;
}

/** A card's usual motion: it enters with depth (staggered by `index`) and responds to a press with depth. On a screen
 *  with scroll depth (Screen `depth`, ./ScrollDepth.tsx) it also trails and bends with the scroll; elsewhere the tree is
 *  exactly Enter > PressDepth, as before. */
export function MotionCard({ children, index, delay, style, pressable = true }: Omit<EnterProps, 'depth' | 'distance'> & { pressable?: boolean }) {
  const scrollDepth = useScrollDepth();
  if (scrollDepth) return <ScrollDepth style={style}><Enter index={index} delay={delay}><PressDepth disabled={!pressable}>{children}</PressDepth></Enter></ScrollDepth>;
  return <Enter index={index} delay={delay} style={style}><PressDepth disabled={!pressable}>{children}</PressDepth></Enter>;
}
