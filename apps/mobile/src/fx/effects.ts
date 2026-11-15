/* What the kit core takes from the premium motion kit (src/fx/motion): its easing, springs and timings (the final values
   of AMENDED_PLAN_NOTES §3) and how much effect this device and person get (PREMIUM §1.9 tiers). The core reads them
   through this file only, as useFx():
   - calm: reduced motion (or Save-Data): rest states only;
   - lite: calm or tier C (no blur, no idle loops, no previews);
   - blur: glass cards, sheets and bars may blur (tier A on iOS and the web; never on Android in Phase 1, CRITIQUE §19);
   - blurNav: the tab bar pill may blur (tiers A and B on iOS, tier A on the web);
   - inHtml: part of the web build's pre-rendered HTML: draw at rest. */
import { Platform } from 'react-native';
import { useMotion } from './motion/tier';

export { ease, motionValues, spring, t, timing, calmFade } from './motion/tokens';

/** Timings only the kit core uses and the quiz stepper's range bar: they live in tokens.ts now and keep this path. */
export { tk, springBar } from './motion/tokens';

export type FxEffects = { calm: boolean; lite: boolean; blur: boolean; blurNav: boolean; inHtml: boolean; tier: 'A' | 'B' | 'C' };

export function useFx(): FxEffects {
  const m = useMotion();
  const android = Platform.OS === 'android';
  const blur = !android && !m.lite && m.tier === 'A';
  const blurNav = !android && !m.lite && (m.tier === 'A' || (m.tier === 'B' && Platform.OS === 'ios'));
  return { calm: m.calm, lite: m.lite, blur, blurNav, inHtml: m.inHtml, tier: m.tier };
}
