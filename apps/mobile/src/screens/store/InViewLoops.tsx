/* The Store's decorative loops run only while their band is on screen (motion language: nothing animates where nobody
   can see it). Wraps a looping decoration (the marquee) in its own page-active flag: the page's flag (the pager's
   PageActiveContext) and, inside a RevealScope, whether the band's box overlaps the viewport at the current scroll
   offset. The kit's loops read that flag (useLoopGate / useLoopClock / useMotionBudget), so the marquee pauses where it
   is once the page has scrolled it out of view and resumes from there when it comes back, instead of committing a new
   transform on every frame of the scroll (wave-2 fix r1: tier-A scroll on the Store).
   The flag is a derived value on the UI thread: it changes (and wakes its readers) only when the band crosses the
   viewport's edge. Before the band is measured, and outside a RevealScope, it is the page's flag. The zero-layout rule
   holds: a 0 × 0 layout (a detached page) is ignored. */
import React, { useContext } from 'react';
import { type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedRef, useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { measureView } from '@/fx/motion/measured';
import { scheduleOnUI } from 'react-native-worklets';
import { useRevealScope } from '@/fx';
import { PageActiveContext } from '@/fx/nav/pageReady';

export function InViewLoops({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const scope = useRevealScope();
  const parent = useContext(PageActiveContext);
  const one = useSharedValue(1);
  const page = parent ?? one;
  const scrollY = scope?.scrollY ?? one;
  const viewport = scope?.viewport ?? one;
  const scoped = !!scope;
  // the band's top and bottom in scroll-content points (−1 until measured)
  const top = useSharedValue(-1);
  const bottom = useSharedValue(-1);
  const ref = useAnimatedRef<Animated.View>();

  const gate = useDerivedValue(() => {
    if (page.get() !== 1) return 0;
    const b = bottom.get();
    if (!scoped || b < 0) return 1;
    const y = scrollY.get();
    return b - y > 0 && top.get() - y < viewport.get() ? 1 : 0;
  });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width === 0 && height === 0) return; // a detached page reports 0 × 0
    scheduleOnUI(() => {
      'worklet';
      const m = measureView(ref);
      if (!m || m.height <= 0) return;
      const y = scoped ? scrollY.get() : 0;
      top.set(m.pageY + y);
      bottom.set(m.pageY + m.height + y);
    });
  };

  return <Animated.View ref={ref} onLayout={onLayout} style={style}>
    <PageActiveContext.Provider value={gate as unknown as SharedValue<number>}>{children}</PageActiveContext.Provider>
  </Animated.View>;
}
