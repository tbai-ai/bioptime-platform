/* The app's additive motion layer (docs/PREMIUM_DIRECTION.md). Wrap existing elements; never restyle them.
   - Enter: entrance with depth (opacity, rise, slight scale and lean), staggered by `index`;
   - PressDepth / MotionCard: press depth on cards (MotionCard = Enter + PressDepth);
   - BrandTilt: the earlier brand moment (perspective turn-in, follows a finger, springs back), kept for reuse; the sign-in
     screen and the Home header now use BrandMark3D;
   - ProgressReveal: a progress fill grows to its value;
   - MilestoneReveal: a pop or a split-flap flip when something is reached;
   - BrandMark3D / BrandStage / Motes: the 3D brand mark (the unchanged mark with stacked copies of the same image behind
     it for depth; turns in slowly, follows a touch or drag, springs back) and the light motes drifting in depth around it;
   - ScreenEnter: every screen's entrance (a rotateY swing under perspective), used by Screen;
   - DepthScrollView / ScrollDepth: scroll-linked parallax and depth on cards while a list moves (Screen `depth`);
   - useReduceMotion: the OS reduce-motion setting (reanimated's useReducedMotion, kept live);
   - useCalmMotion: reduced motion, or Save-Data on the web: the decorative 3D layers stand down.
   Every primitive rests at opacity 1 with no transform, and renders at rest from the first frame with reduced motion,
   and on the web whenever it is part of the page's pre-rendered HTML (./staticHtml.ts; web.output is 'static'). */
export { Enter, staggerDelay, type EnterProps } from './Enter';
export { PressDepth, MotionCard, type PressDepthProps } from './PressDepth';
export { BrandTilt } from './BrandTilt';
export { ProgressReveal } from './ProgressReveal';
export { MilestoneReveal, type MilestoneRevealProps } from './MilestoneReveal';
export { BrandMark3D, type BrandMark3DProps } from './BrandMark3D';
export { BrandStage, useBrandStage } from './BrandStage';
export { Motes } from './Motes';
export { ScreenEnter } from './ScreenEnter';
export { DepthScrollView, ScrollDepth, useScrollDepth } from './ScrollDepth';
export { cardPose, layerDepth, layerOffset, leanFor, makeMotes, motePose, revealAmount, screenPose, type Mote } from './depthMath';
export { useReduceMotion } from './useReduceMotion';
export { useCalmMotion, prefersSaveData } from './useCalmMotion';
export { motion, ease, springs } from './tokens';
