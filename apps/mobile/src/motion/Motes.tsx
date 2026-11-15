/* Light motes drifting in depth: a few small dots in the app's existing colours (white, the muted grey-blue, the brand
   red) that float slowly in a band behind the brand mark. Each mote has a depth that slowly changes: nearer motes are
   larger and brighter, further ones smaller and fainter, and inside a <BrandStage> they shift with the mark's turn by
   their depth (a parallax). The drift slows to a stop after `motion.motes.driftMs` and stays still (no work at all) until
   the screen gains focus again or the mark is touched.
   Place it as the first child of the area it fills, in space that is empty: it never takes a touch (pointerEvents none),
   draws behind what follows it, keeps its motes inside its own box (overflow hidden) and must not be put over text or
   buttons. Reduced motion (and Save-Data on the web): it renders nothing, so the screen is exactly as before. */
import React, { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useIsFocused } from 'expo-router';
import Animated, { cancelAnimation, Easing, useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useBrandStage, type BrandStageValue } from './BrandStage';
import { makeMotes, motePose, type Mote } from './depthMath';
import { motion } from './tokens';
import { useCalmMotion } from './useCalmMotion';

function MoteDot({ mote, clock, fade, stage }: { mote: Mote; clock: SharedValue<number>; fade: SharedValue<number>; stage: BrandStageValue | null }) {
  const animated = useAnimatedStyle(() => {
    const p = motePose(mote, clock.get(), stage ? stage.rx.get() : 0, stage ? stage.ry.get() : 0);
    return { opacity: p.opacity * fade.get(), transform: [{ translateX: p.x }, { translateY: p.y }, { scale: p.scale }] };
  });
  return <Animated.View style={[{ position: 'absolute', left: `${mote.x * 100}%`, top: `${mote.y * 100}%`, width: mote.size, height: mote.size, borderRadius: mote.size, backgroundColor: mote.color }, animated]} />;
}

function MoteField({ count, seed, style }: { count: number; seed: number; style?: StyleProp<ViewStyle> }) {
  const focused = useIsFocused();
  const stage = useBrandStage();
  const clock = useSharedValue(0);
  const fade = useSharedValue(0);
  const motes = makeMotes(count, seed);

  // a drift that starts gently and slows to a stop: one cycle over driftMs, then nothing runs
  const drift = () => {
    'worklet';
    clock.set(withTiming(clock.get() + motion.motes.driftCycles, { duration: motion.motes.driftMs, easing: Easing.bezier(0.33, 0.25, 0.4, 1) }));
  };

  useEffect(() => {
    if (!focused) { cancelAnimation(clock); return; } // hold still while another screen is in front
    fade.set(withTiming(1, { duration: motion.motes.fadeMs }));
    drift();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused]);

  // a touch on the mark wakes the drift again
  useAnimatedReaction(() => (stage ? stage.touches.get() : 0), (now, before) => {
    if (before !== null && now !== before) drift();
  });

  return <View pointerEvents="none" style={[{ position: 'absolute', overflow: 'hidden' }, style ?? StyleSheet.absoluteFill]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
    {motes.map((m, i) => <MoteDot key={i} mote={m} clock={clock} fade={fade} stage={stage} />)}
  </View>;
}

/** `style` places the band (absolute: give its top / left / right / bottom or height); the default fills the parent. */
export function Motes({ count = 14, seed = 0xb10a, style }: { count?: number; seed?: number; style?: StyleProp<ViewStyle> }) {
  const calm = useCalmMotion();
  if (calm) return null;
  return <MoteField count={count} seed={seed} style={style} />;
}
