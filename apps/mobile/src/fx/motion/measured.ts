/* Reanimated's measure() for the kit's worklets, quiet when the view is not there. measure() logs a warning for a ref
   with no view (an element that unmounted before a scheduled measure ran, a page the pager let go, a skeleton gone
   before its layout's measure): the release gate counted 649 such warnings in one Android session. This returns null at
   once in that case, as measure() does after its warning, so every caller keeps its own fallback (a retry, the rest
   state). A view that is there but not laid out still goes through measure(). */
import { Platform } from 'react-native';
import { measure, type AnimatedRef, type MeasuredDimensions } from 'react-native-reanimated';

const WEB = Platform.OS === 'web';

/** measure(ref), or null without a warning when the ref holds no view. A worklet. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any view's ref (measure() itself is generic over it)
export function measureView(ref: AnimatedRef<any>): MeasuredDimensions | null {
  'worklet';
  // native: the ref arrives on the UI thread as a shareable holding the view's shadow node (null before it mounts);
  // the web: as the function returning the element
  const held = WEB ? (ref as unknown as () => unknown)() : (ref as unknown as { value?: unknown }).value;
  if (!held) return null;
  return measure(ref);
}
