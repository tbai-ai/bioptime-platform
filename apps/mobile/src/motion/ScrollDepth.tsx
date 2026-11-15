/* Scroll-linked depth for cards (Home and Plan). DepthScrollView is the screen's scroll view with a scroll handler on the
   UI thread: it keeps the offset and a "lean" that follows how fast the list moves (-1..1) and eases back to 0 as soon
   as the list stops. Each card in a <ScrollDepth> then, while the list moves:
   - trails the scroll by a few points, lower cards more than higher ones (parallax between the cards);
   - bends with the others into a shallow drum: cards near the top of the screen tip back at the top, cards near the
     bottom tip back at the bottom, and the ones at the edges get slightly smaller (depth).
   All of it scales with the lean, so a still list is flat: no transform at rest, whatever the scroll position. Transform
   only, never in the way of a touch. Reduced motion (and Save-Data on the web): the lean stays 0. Outside a
   DepthScrollView a ScrollDepth does nothing (MotionCard then leaves it out altogether). */
import React, { createContext, useContext } from 'react';
import { type LayoutChangeEvent, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withSequence, withTiming, type SharedValue } from 'react-native-reanimated';
import { cardPose, leanFor } from './depthMath';
import { ease, motion } from './tokens';
import { useCalmMotion } from './useCalmMotion';

type Depth = { offset: SharedValue<number>; lean: SharedValue<number>; viewport: SharedValue<number> };

const DepthContext = createContext<Depth | null>(null);

/** The scroll depth of the screen around, or null outside a DepthScrollView. */
export function useScrollDepth(): Depth | null {
  return useContext(DepthContext);
}

export function DepthScrollView({ children, onLayout, ...props }: ScrollViewProps & { children: React.ReactNode }) {
  const calm = useCalmMotion();
  const offset = useSharedValue(0);
  const lean = useSharedValue(0);
  const viewport = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler<{ y?: number; t?: number }>({
    onScroll: (e, ctx) => {
      const y = e.contentOffset.y;
      const now = Date.now();
      offset.set(y);
      if (calm) return;
      if (ctx.y !== undefined && ctx.t !== undefined) {
        const dt = Math.max(1, now - ctx.t);
        const target = leanFor((y - ctx.y) / dt);
        // follow the speed while events keep coming; once they stop, ease back flat
        lean.set(withSequence(withTiming(target, { duration: motion.scroll.inMs }), withTiming(0, { duration: motion.scroll.outMs, easing: ease.out })));
      }
      ctx.y = y;
      ctx.t = now;
    },
  }, [calm]);
  const layout = (e: LayoutChangeEvent) => { viewport.set(e.nativeEvent.layout.height); onLayout?.(e); };
  return <DepthContext.Provider value={{ offset, lean, viewport }}>
    <Animated.ScrollView {...props} onLayout={layout} onScroll={onScroll} scrollEventThrottle={16}>{children}</Animated.ScrollView>
  </DepthContext.Provider>;
}

function DepthLayer({ depth, children, style }: { depth: Depth; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const top = useSharedValue(0);
  const height = useSharedValue(0);
  const animated = useAnimatedStyle(() => {
    const pose = cardPose(depth.lean.get(), top.get() + height.get() / 2 - depth.offset.get(), depth.viewport.get());
    if (!pose) return { transform: [] };
    return { transform: [{ perspective: motion.perspective.card }, { translateY: pose.translateY }, { rotateX: `${pose.rotateX}deg` }, { scale: pose.scale }] };
  });
  // its place in the list: the parent is the screen's content column, which starts at the top of the scroll content
  const measure = (e: LayoutChangeEvent) => { top.set(e.nativeEvent.layout.y); height.set(e.nativeEvent.layout.height); };
  return <Animated.View style={[style, animated]} onLayout={measure}>{children}</Animated.View>;
}

/** Scroll depth for one card. Same wrapper rules as Enter (one always-rendered child; pass the child's alignSelf / flex
 *  through `style`). Outside a DepthScrollView it is a plain wrapper with no effect. */
export function ScrollDepth({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const depth = useScrollDepth();
  if (!depth) return <Animated.View style={style}>{children}</Animated.View>;
  return <DepthLayer depth={depth} style={style}>{children}</DepthLayer>;
}

