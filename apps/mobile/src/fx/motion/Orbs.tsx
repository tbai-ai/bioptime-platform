/* Soft red orbs (THEME §3 and §12.3, PREMIUM §1.6): radial gradients fading to transparent at 70 % (no blur filter).
   Each stop is the token's opaque colour with its alpha as stopOpacity (theme svgStop), fading in the same colour to
   opacity 0: Android's SVG drops an alpha written inside stopColor (the orb drew as an opaque disc, and a fade to
   rgba(0,0,0,0) as a black rim), so no stop ever carries its alpha in the colour or fades towards black.
   - home: rgba(220,38,38,.10) 384 pt at (−80, −80) and rgba(239,68,68,.10) 320 pt at (top 40, right −80); tier A
     loops the earlier app's paths (15 s and 20 s, linear).
   - auth: red .15 300 pt at (−20 %, 18 %) and white .08 250 pt at (70 %, 62 %); tier A drifts (15 s, and 12 s reversed).
   - longevity / profile: one red orb at the top corner, still.
   Android draws each disc as its box's own radial-gradient background (the same stops; Gradient nativeRadial), not as an
   SVG, which renders a software bitmap the size of the orb on the UI thread.
   Tier B: still. Tier C: none. Calm: still. Loops pause while the page is not active (on the UI thread, the frame it
   goes inactive; they resume from where they were the frame it is active again) and drift only for the motion budget
   (5 s after focus or the last touch: ./budget), then rest where they are. Decorative: no touches, hidden
   from screen readers. Place it first in the area it fills (it is absolutely positioned). */
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { fx, svgStop } from '@/theme';
import { nativeRadial } from '../Gradient';
import { ease } from './tokens';
import { keyframes } from './curve';
import { useLoopClock, useLoopGate } from './loop';
import { useMotionBudget } from './budget';
import { useMotion } from './tier';
import { useSvgId } from './svgId';

type Path = { x: readonly number[]; y: readonly number[]; scale?: readonly number[]; ms: number; reverse?: boolean; inOut?: boolean };
type Place = { left?: number | `${number}%`; right?: number | `${number}%`; top?: number | `${number}%` };
export type OrbSpec = { color: string; size: number; place: Place; path?: Path };

const AT = [0, 0.25, 0.5, 0.75, 1] as const;
const drift = { x: [0, 10, -5, 5, 0], y: [0, -10, 5, 10, 0], inOut: true } as const;

export const ORB_PRESETS: Record<'home' | 'auth' | 'longevity' | 'profile', OrbSpec[]> = {
  home: [
    { color: fx.premium.orbRed, size: 384, place: { left: -80, top: -80 }, path: { x: [0, 20, 0, -20, 0], y: [0, -20, -40, -20, 0], scale: [1, 1.2, 1, 0.8, 1], ms: 15000 } },
    { color: fx.premium.orbRed2, size: 320, place: { right: -80, top: 40 }, path: { x: [0, -30, 0, 30, 0], y: [0, 30, 0, -30, 0], scale: [1, 0.8, 1, 1.2, 1], ms: 20000 } },
  ],
  auth: [
    { color: fx.premium.orbAuth, size: 300, place: { left: '-20%', top: '18%' }, path: { ...drift, ms: 15000 } },
    { color: fx.premium.orbWhite, size: 250, place: { left: '70%', top: '62%' }, path: { ...drift, ms: 12000, reverse: true } },
  ],
  longevity: [{ color: fx.premium.orbRed, size: 320, place: { right: -100, top: -60 } }],
  profile: [{ color: fx.premium.orbRed, size: 300, place: { left: -60, top: -80 } }],
};

function Orb({ spec, clock }: { spec: OrbSpec; clock: SharedValue<number> | null }) {
  const id = useSvgId('fxOrb');
  const path = spec.path;
  const stop = svgStop(spec.color);
  // Android: the same disc as the box's own radial-gradient background (the GPU draws it; no software bitmap)
  const wash = React.useMemo(() => nativeRadial([{ color: spec.color, at: 0 }, { color: spec.color, alpha: 0, at: 0.7 }]), [spec.color]);
  const moving = useAnimatedStyle(() => {
    if (!clock || !path) return { transform: [] };
    const raw = clock.get();
    const p = path.reverse ? 1 - raw : raw;
    const e = path.inOut ? ease.cssInOut : undefined;
    return {
      transform: [
        { translateX: keyframes(p, AT, path.x, e) },
        { translateY: keyframes(p, AT, path.y, e) },
        { scale: path.scale ? keyframes(p, AT, path.scale, e) : 1 },
      ],
    };
  });
  if (wash) return <Animated.View style={[{ position: 'absolute', width: spec.size, height: spec.size }, spec.place, wash, moving]} />;
  return <Animated.View style={[{ position: 'absolute', width: spec.size, height: spec.size }, spec.place, moving]}>
    <Svg width={spec.size} height={spec.size}>
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={stop.stopColor} stopOpacity={stop.stopOpacity} />
          <Stop offset="0.7" stopColor={stop.stopColor} stopOpacity={0} />
          <Stop offset="1" stopColor={stop.stopColor} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={spec.size / 2} cy={spec.size / 2} r={spec.size / 2} fill={`url(#${id})`} />
    </Svg>
  </Animated.View>;
}

function LoopingOrb({ spec, run, active }: { spec: OrbSpec; run: boolean; active: SharedValue<number> }) {
  const clock = useLoopClock(spec.path?.ms ?? 15000, run && !!spec.path, active, true);
  return <Orb spec={spec} clock={spec.path ? clock : null} />;
}

export type OrbsProps = {
  preset?: keyof typeof ORB_PRESETS;
  /** Custom orbs instead of a preset. */
  orbs?: OrbSpec[];
  style?: StyleProp<ViewStyle>;
};

export function Orbs({ preset = 'home', orbs, style }: OrbsProps) {
  const { tier, still } = useMotion();
  const { active, visible } = useLoopGate();
  const run = useMotionBudget(tier === 'A' && !still && visible, undefined, active);
  if (tier === 'C') return null;
  const list = orbs ?? ORB_PRESETS[preset];
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
    {list.map((o, i) => <LoopingOrb key={i} spec={o} run={run} active={active} />)}
  </View>;
}
