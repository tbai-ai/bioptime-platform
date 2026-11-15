/* The status bar's backing (the clock, the battery and the signal the phone draws over the app), for every client
   screen whose content scrolls under it: TabScreen, FlowScreen (the sign-in, the other auth screens, the Server screen,
   onboarding's consent) and onboarding's slides. Overlay, the stack's header (StackHeader), the Coach header and the
   checkout header sit in the flow above their content, so nothing scrolls under the clock there.
   - Over the top inset only. At rest a black-to-clear scrim (Scrim "statusBar"), so the clock reads over a header photo.
   - Once the page scrolls under it (over the first 12 pt, the in-page header's own top padding: ScreenHeader pt = inset
     + 12) it turns solid in the screen's canvas colour, so no text ever runs under the clock.
   - `handover`: a tab whose compact bar takes the top (src/fx/motion/CompactBar, fading in over y 48 → 88). The backing
     stays solid while the bar fades in (the big title passing under the clock stays hidden), then fades out over the
     next 24 pt, so the bar's own glass is the only layer up there and no band shows at the inset's edge.
   Nothing is drawn without a top inset (the web, a phone whose status bar is not over the app), so those look as before.
   Decorative: no touches, hidden from screen readers. Callers draw it after their scroller and before their own top
   chrome (the compact bar, the flow's red hairline), which stays above it. */
import React from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fx } from '@/theme';
import { Scrim } from './Gradient';
import { motionValues } from './motion/tokens';

const H = motionValues.header;
/** How far the page scrolls before the backing is solid (the in-page header's top padding). */
export const STATUS_SOLID_AFTER = 12;
/** With a compact bar: how far past the bar's full opacity (y 88) the backing takes to hand the top over to it. */
const HANDOVER = 24;

export function StatusScrim({ scrollY, color = fx.bg.deep, handover = false }: {
  /** The scroll offset of the content under it; without one the scrim stays at rest. */
  scrollY?: SharedValue<number> | null;
  /** The solid colour: the screen's canvas (black on the tabs, #080808 on the flows). */
  color?: string;
  /** Hand the top over to the compact bar once it is fully in (a tab with a compact bar as TabScreen's `sticky`). */
  handover?: boolean;
}) {
  const { top } = useSafeAreaInsets();
  const solid = useAnimatedStyle(() => {
    const y = scrollY ? scrollY.get() : 0;
    return { opacity: Math.max(0, Math.min(1, y / STATUS_SOLID_AFTER)) };
  });
  const whole = useAnimatedStyle(() => {
    if (!handover || !scrollY) return { opacity: 1 };
    return { opacity: 1 - Math.max(0, Math.min(1, (scrollY.get() - H.barTo) / HANDOVER)) };
  });
  if (top <= 0) return null;
  return <Animated.View
    pointerEvents="none"
    accessible={false}
    accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants"
    aria-hidden
    testID="status-scrim"
    style={[styles.wrap, { height: top }, whole]}>
    <Scrim kind="statusBar" style={StyleSheet.absoluteFill} />
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: color }, solid]} />
  </Animated.View>;
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0 },
});
