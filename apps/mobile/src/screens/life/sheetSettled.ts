/* Inside a sheet's content: whether its panel has come to rest after rising, so heavy content that is not in view yet
   can mount after the rise instead of inside it (Life's "My blood work": the marker groups after the first).
   On the UI thread, once the panel's rise share (useSheetRise) has reached 1, a frame callback measures `anchor` (a
   view at the top of the content) each frame; the panel has settled once two frames in a row find it at exactly the same
   place (the spring has ended: an overshoot still moves it every frame). The callback stops then. Outside a sheet and
   under reduced motion (the panel appears in place) it is settled at once; a fallback timer (t.settle) makes sure it
   turns true even if no measure comes back. */
import { useEffect, useState } from 'react';
import type { View } from 'react-native';
import { useFrameCallback, useSharedValue, type AnimatedRef } from 'react-native-reanimated';
import { measureView } from '@/fx/motion/measured';
import { scheduleOnRN } from 'react-native-worklets';
import { useFx } from '@/fx/effects';
import { t } from '@/fx/motion/tokens';
import { useSheetRise } from '@/fx/Sheet';

export function useSheetSettled(anchor: AnimatedRef<View>): boolean {
  const rise = useSheetRise();
  const { calm, inHtml } = useFx();
  const [settled, setSettled] = useState(() => !rise || calm || inHtml);
  const done = useSharedValue(settled ? 1 : 0);
  const last = useSharedValue<number | null>(null);
  const frames = useFrameCallback(() => {
    'worklet';
    if (done.get() === 1 || !rise) return;
    if (rise.get() < 1) { last.set(null); return; }
    const m = measureView(anchor);
    if (!m || (m.width === 0 && m.height === 0)) return; // a detached view measures 0 × 0
    const was = last.get();
    last.set(m.pageY);
    if (was !== null && was === m.pageY) {
      done.set(1);
      scheduleOnRN(setSettled, true);
    }
  }, !settled);
  useEffect(() => { if (settled) frames.setActive(false); }, [settled, frames]);
  useEffect(() => {
    if (settled) return;
    const timer = setTimeout(() => setSettled(true), t.settle);
    return () => clearTimeout(timer);
  }, [settled]);
  return settled;
}
