/* The first card of a tab page (motion v2 M64: Bio's first card, Life's report hero): it arrives with the page instead
   of after it. Its entrance starts on the page-active edge (the frame the pager's spring starts towards the page, or
   the frame a drag reveals it), with no delay: scale .97 → 1 and opacity .4 → 1 over 420 ms expo, so the card is
   already there, dimmed, on the pager's landing frame. Tier C: opacity only over the tier's reveal (200 ms); reduced
   motion and the web's pre-rendered HTML: at rest from the first frame. Once per launch (`id`): a revisit shows it at
   rest. It provides the same landing as a Reveal (RevealContext), so the rings, counts and lines inside start from it
   (the kit's data rule) and `useRevealLanding()` works inside. */
import React, { useEffect, useMemo, useState } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { RevealContext } from '@/fx/motion/Reveal';
import { markRevealed, wasRevealed } from '@/fx/motion/seen';
import { ease, motionValues, timing } from '@/fx/motion/tokens';
import { useMotion } from '@/fx/motion/tier';
import { usePageActive } from '@/fx/nav/pageReady';

const M = motionValues.screens.m64;

export function FirstCard({ id, children, style }: { id: string; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { tier, still } = useMotion();
  const active = usePageActive();
  const [rest] = useState(() => still || wasRevealed(id)); // decided once, at mount
  const p = useSharedValue(rest ? 1 : 0);
  const startedAt = useSharedValue(rest ? 0 : -1);
  const landed = useSharedValue(rest ? 1 : 0);
  const begun = useSharedValue(rest ? 1 : 0);
  const lite = tier === 'C';
  const ms = lite ? motionValues.reveal.C.duration : M.firstMs;
  const landAt = motionValues.reveal.landAt;
  const remember = () => markRevealed(id);
  useAnimatedReaction(() => (begun.get() === 0 && active.get() === 1 ? 1 : 0), (go) => {
    if (go !== 1 || begun.get() === 1) return;
    begun.set(1);
    startedAt.set(Date.now());
    p.set(withTiming(1, timing(ms, ease.expo)));
    scheduleOnRN(remember);
  });
  useAnimatedReaction(() => (landed.get() === 0 && p.get() >= landAt ? 1 : 0), (hit) => {
    if (hit === 1 && landed.get() === 0) landed.set(1);
  });
  // reduced motion switched on while it enters: at rest
  useEffect(() => {
    if (!still) return;
    begun.set(1);
    p.set(1);
    landed.set(1);
    if (startedAt.get() < 0) startedAt.set(0);
  }, [still, begun, p, landed, startedAt]);
  const animated = useAnimatedStyle(() => {
    const k = p.get();
    if (k >= 1) return { opacity: 1, transform: [] };
    const opacity = M.firstOpacity + (1 - M.firstOpacity) * k;
    if (lite) return { opacity, transform: [] };
    return { opacity, transform: [{ scale: M.firstFrom + (1 - M.firstFrom) * k }] };
  });
  const landing = useMemo(() => ({ startedAt, landed, index: 0 }), [startedAt, landed]);
  return <RevealContext.Provider value={landing}>
    <Animated.View style={[style, animated]}>{children}</Animated.View>
  </RevealContext.Provider>;
}
