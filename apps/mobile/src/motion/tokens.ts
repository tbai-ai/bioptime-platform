/* Motion tokens for the app's additive motion layer (docs/PREMIUM_DIRECTION.md). Timings, easing and depth only: no
   colour, font, size, spacing, radius or shadow lives here, and nothing here changes src/theme.ts. Every primitive in
   src/motion moves only `transform` and `opacity` on a wrapper layer and comes to rest at full opacity with no transform
   at all, so a settled screen, and every screen while the OS asks for reduced motion, draws exactly as it did before. */
import { Easing } from 'react-native-reanimated';

export { motion } from './values';

export const ease = {
  /** Fast start, long soft landing (easeOutQuint-like). */
  out: Easing.bezier(0.22, 1, 0.36, 1),
  /** Ends a touch past the target and settles back (back-out), for milestone pops. */
  pop: Easing.bezier(0.34, 1.56, 0.64, 1),
  /** A slow, even turn that glides to a stop, for the 3D brand mark's turn-in. */
  turn: Easing.bezier(0.3, 0.5, 0.25, 1),
};

/** Springs for things a finger lets go of. */
export const springs = {
  brandRelease: { damping: 10, stiffness: 150, mass: 0.8 },
} as const;
