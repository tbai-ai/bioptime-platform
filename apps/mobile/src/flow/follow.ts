/* Layout that changes above a block, without a jump (motion v2 A34: M53, M55). On the web, when a watched element
   changes size, the block that follows it is put back where it was with a transform in the same frame (a
   ResizeObserver runs after layout and before paint) and glides to its new place over `ms` on the expo curve; a change
   while it glides starts from where it is. Native uses a Reanimated LinearTransition on the same views instead
   (`followLayout`). Reduced motion: it simply moves. The block's place is read from offsetTop (its parent's
   coordinates: scrolling never counts as a move); the parent is watched too, so a change elsewhere (a card appearing
   above, fonts arriving) only updates where the block is, without moving it. `easing`: the glide's curve (expo by
   default; the sign-in's form swap uses the cubic ease-out, whose first frame is its fastest and still moves a 100 pt
   change less than 20 pt, where expo would move it 35). */
import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { LinearTransition, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { EasingFunction } from 'react-native-reanimated';
import { ease, timing } from '@/fx/motion/tokens';

type El = HTMLElement & { offsetTop: number };

/** The native layout transition for both the watched view and the block that follows (undefined on the web). */
export function followLayout(ms: number) {
  if (Platform.OS === 'web') return undefined;
  return LinearTransition.duration(ms).easing(ease.expo).reduceMotion(ReduceMotion.System);
}

/** Web: `watch` (the element whose size changes) and `mover` (the block after it) refs, and the mover's animated
 *  style. `on` false (reduced motion, the pre-rendered HTML): no glide. */
export function useFollow(ms: number, on: boolean, easing?: EasingFunction) {
  const shift = useSharedValue(0);
  const watched = useRef<El | null>(null);
  const mover = useRef<El | null>(null);
  const onRef = useRef(on);
  onRef.current = on;
  const [watchRef, moverRef] = [
    useCallback((node: unknown) => { watched.current = (node as El | null) ?? null; }, []),
    useCallback((node: unknown) => { mover.current = (node as El | null) ?? null; }, []),
  ];
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof ResizeObserver === 'undefined') return;
    const w = watched.current;
    const m = mover.current;
    if (!w || !m || typeof m.offsetTop !== 'number') return;
    let last = m.offsetTop;
    const parent = m.parentElement;
    const ro = new ResizeObserver((entries) => {
      const now = m.offsetTop;
      const d = last - now;
      last = now;
      if (!entries.some((e) => e.target === w)) return; // something else changed size: only where the block is now
      if (!onRef.current || Math.abs(d) < 0.5) return;
      const from = shift.value + d;
      m.style.transform = `translateY(${from}px)`; // this frame, before paint; the animated style takes over from here
      shift.value = from;
      shift.value = withTiming(0, timing(ms, easing ?? ease.expo));
    });
    ro.observe(w);
    if (parent && parent !== w) ro.observe(parent);
    return () => ro.disconnect();
  }, [ms, shift, easing]);
  const style = useAnimatedStyle(() => (shift.value === 0 ? { transform: [] } : { transform: [{ translateY: shift.value }] }));
  return { watchRef, moverRef, style, shift };
}
