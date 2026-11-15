/* The premium motion kit (PREMIUM §1 with AMENDED_PLAN_NOTES §1, §3 and §4). Every primitive animates transform and
   opacity on the UI thread (Reanimated 4 worklets), draws its rest state under reduced motion and in the web build's
   pre-rendered HTML, and scales its layers to the device tier (useMotion: A, B, C and calm). Colours come from `fx` and
   `fx.premium` in src/theme.ts; src/motion (the staff layer) is imported, never changed.
   - tokens: easings, springs, durations, distances, calmFade (the reduced-motion crossfade); doneOnce (exit then
     navigate, once); tier: useMotion / useMotionTier / useLiteMotion / DemotionProbe
   - depth: TiltProvider, TiltCard, TiltLayer, DepthTile, StackRecede, ShelfCarousel (+ ShelfPhoto)
   - scroll: RevealScope, Reveal (+ RevealContext / useRevealLanding: data starts when its card lands), StretchyHeader, ParallaxLayer, LargeTitle, CompactBar, StickyUnderBar
   - values: CountUp, ScoreRing / MetricRing / TargetRing / MiniRing / TimerRing, Sparkline, AreaSpark, TrendChart,
     ProgressBar, MacroBar, WeekBars, RangeBar
   - transitions: PhotoMorph (MorphSource, openWithMorph, MorphStage, MorphHero, MorphContent, useMorphClose)
   - loading and life: ShimmerProvider, Skeleton, SkeletonRing, SkeletonGate, Spinner, TypingDots, LiveDot, Orbs,
     Particles, Marquee, Typewriter, BoxBreathing, CheckPop, Strike */
export { ease, spring, t, timing, motionValues, calmFade } from './tokens';
export { doneOnce } from './once';
export { useMotion, useMotionTier, useLiteMotion, useDemotionProbe, DemotionProbe, deviceTier, type MotionState, type MotionTier } from './tier';
export { clamp01, seg, mix, keyframes, hump } from './curve';
export { useLoopClock } from './loop';
export { useSvgId } from './svgId';
export { TiltProvider, TiltCard, TiltLayer, useDeviceTilt, type TiltCardProps, type TiltLayerProps } from './Tilt';
export { RevealScope, Reveal, useRevealScope, RevealContext, useRevealLanding, type RevealProps, type RevealLanding } from './Reveal';
export { CountUp, formatCount, type CountUpProps } from './CountUp';
export { seenValue, markSeen, forgetSeen } from './seen';
export { ScoreRing, MetricRing, TargetRing, MiniRing, TimerRing, type RingProps, type ScoreRingProps, type TimerRingProps } from './Ring';
export { Sparkline, AreaSpark, sparkPoints, type SparklineProps } from './Sparkline';
export { TrendChart, type TrendChartProps } from './Chart';
export { ProgressBar, MacroBar, WeekBars, RangeBar, type ProgressBarProps, type WeekBarsProps, type RangeBarProps } from './Bars';
export { ShelfCarousel, ShelfPhoto, type ShelfCarouselProps } from './ShelfCarousel';
export { StackRecede, type StackRecedeProps } from './StackRecede';
export { MorphSource, openWithMorph, MorphStage, MorphHero, MorphContent, useMorphClose, type MorphStageProps } from './PhotoMorph';
export { StretchyHeader, ParallaxLayer, headerHeight, type StretchyHeaderProps } from './StretchyHeader';
export { LargeTitle, CompactBar, StickyUnderBar, type CompactBarProps } from './CompactBar';
export { ShimmerProvider, Skeleton, SkeletonRing, SkeletonGate, type SkeletonProps, type SkeletonGateProps } from './Skeleton';
export { Orbs, ORB_PRESETS, type OrbSpec, type OrbsProps } from './Orbs';
export { Particles } from './Particles';
export { Marquee } from './Marquee';
export { Typewriter, type TypewriterProps } from './Typewriter';
export { BoxBreathing, type BoxBreathingProps } from './Breathing';
export { LiveDot } from './LiveDot';
export { Spinner, type SpinnerProps } from './Spinner';
export { TypingDots } from './TypingDots';
export { CheckPop, Strike, type CheckPopProps } from './CheckPop';
export { DepthTile, type DepthTileProps } from './DepthTile';
