/* The confirmation's four beats (motion v2, M81), shared by the blood-test booking and the Store checkout: on one clock
   from the moment the confirmation shows,
   1. the badge springs in (.6 → 1 on the pop spring) with a thin ring bursting out of it (.8 → 2, .8 → 0, 600 ms;
      tiers A and B) and the success haptic (the only one);
   2. the title rises 10 pt from +80 ms;
   3. the reference card arrives at +140 ms and its digits flash once (.6 → 1, 120 ms);
   4. the "what happens next" steps come at +200/+260/+320/+380 (8 pt, 300 ms expo) while their left rail draws (a
      full-height fill moved by translateY inside a clipped rail, 400 ms expo).
   Tier C: the beats fade in place (no rise, no burst). Reduced motion and the pre-rendered web HTML: at rest, the haptic
   kept. Everything starts on the page-active edge (an overlay is active once the launch sting has gone). */
import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import { ease, fx, haptics, spring, timing, useFx } from '@/fx';
import { usePageActive } from '@/fx/nav/pageReady';
import { motionValues } from '@/fx/motion/tokens';

export const BEATS = motionValues.screens.m81;

/** Starts `run` once, on the UI thread, when the page is active (at once when it already is). */
function useOnActive(run: () => void, enabled: boolean) {
  const active = usePageActive();
  const armed = useSharedValue(enabled ? 0 : 1);
  useAnimatedReaction(() => (armed.get() === 0 && active.get() === 1 ? 1 : 0), (go) => {
    if (go !== 1 || armed.get() === 1) return;
    armed.set(1);
    run();
  });
}

/** Beat 1: the badge (the caller draws its disc and glyph) with the ring burst; `ring` is the burst's colour. */
export function BeatBadge({ ring, size, children, style }: { ring: string; size: number; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { calm, inHtml, tier } = useFx();
  const still = calm || inHtml;
  const burst = !still && tier !== 'C';
  const s = useSharedValue(still ? 1 : 0);
  const b = useSharedValue(0);
  const buzzed = useRef(false);
  useEffect(() => {
    if (buzzed.current || inHtml) return;
    buzzed.current = true;
    haptics.success();
  }, [inHtml]);
  useOnActive(() => {
    'worklet';
    s.set(tier === 'C' ? withTiming(1, timing(motionValues.states.fadeMs, ease.css)) : withSpring(1, spring.pop));
    if (burst) b.set(withTiming(1, timing(BEATS.burstMs, ease.expo)));
  }, !still);
  const disc = useAnimatedStyle(() => {
    const v = s.get();
    if (tier === 'C') return { opacity: Math.min(1, v), transform: [] };
    return { opacity: Math.min(1, v * 1.5), transform: [{ scale: BEATS.badgeFrom + (1 - BEATS.badgeFrom) * v }] };
  });
  const ringStyle = useAnimatedStyle(() => {
    const v = b.get();
    if (v <= 0 || v >= 1) return { opacity: 0, transform: [{ scale: BEATS.burstFrom }] };
    return { opacity: motionValues.verified.burstOpacity * (1 - v), transform: [{ scale: BEATS.burstFrom + (BEATS.burstTo - BEATS.burstFrom) * v }] };
  });
  return <View style={[styles.badgeBox, { width: size, height: size }, style]}>
    {burst ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: size / 2, borderWidth: BEATS.burstStroke, borderColor: ring }, ringStyle]} /> : null}
    <Animated.View style={[StyleSheet.absoluteFill, disc]}>{children}</Animated.View>
  </View>;
}

/** Beats 2-4: content arriving `at` ms after the confirmation shows, rising `rise` pt (tier C: a fade in place). */
export function Beat({ at, rise = BEATS.stepY, ms = BEATS.stepMs, children, style }: { at: number; rise?: number; ms?: number; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { calm, inHtml, tier } = useFx();
  const still = calm || inHtml;
  const p = useSharedValue(still ? 1 : 0);
  useOnActive(() => {
    'worklet';
    const run = withTiming(1, timing(tier === 'C' ? motionValues.states.fadeMs : ms, tier === 'C' ? ease.css : ease.expo));
    p.set(at > 0 ? withDelay(at, run) : run);
  }, !still);
  const a = useAnimatedStyle(() => {
    const v = p.get();
    if (v >= 1) return { opacity: 1, transform: [] };
    return tier === 'C' ? { opacity: v, transform: [] } : { opacity: v, transform: [{ translateY: rise * (1 - v) }] };
  });
  return <Animated.View style={[style, a]}>{children}</Animated.View>;
}

/** The reference's digits flashing once (.6 → 1) as their card arrives. */
export function Flash({ at, children, style }: { at: number; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { calm, inHtml } = useFx();
  const still = calm || inHtml;
  const o = useSharedValue(still ? 1 : BEATS.refFlashFrom);
  useOnActive(() => {
    'worklet';
    const run = withTiming(1, timing(BEATS.refFlashMs, ease.css));
    o.set(at > 0 ? withDelay(at, run) : run);
  }, !still);
  const a = useAnimatedStyle(() => ({ opacity: o.get() }));
  return <Animated.View style={[style, a]}>{children}</Animated.View>;
}

/** Beat 4: the steps, each at its slot of stepsAt (later ones take the last), beside a rail that draws down with them.
 *  `railLeft`: the rail's x (the centre of the step numbers). */
export function StepsRail({ steps, railLeft, gap, style }: { steps: React.ReactNode[]; railLeft: number; gap: number; style?: StyleProp<ViewStyle> }) {
  const { calm, inHtml, tier } = useFx();
  const still = calm || inHtml;
  const r = useSharedValue(still ? 1 : 0);
  const h = useSharedValue(0);
  const slots = BEATS.stepsAt;
  useOnActive(() => {
    'worklet';
    const run = withTiming(1, timing(tier === 'C' ? motionValues.states.fadeMs : BEATS.railMs, ease.expo));
    r.set(withDelay(slots[0], run));
  }, !still);
  const fill = useAnimatedStyle(() => ({ transform: [{ translateY: -(1 - r.get()) * h.get() }] }));
  return <View style={[{ gap }, style]}>
    <View pointerEvents="none" style={[styles.rail, { left: railLeft }]} onLayout={(e) => { const v = e.nativeEvent.layout.height; if (v > 0) h.set(v); }}
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[StyleSheet.absoluteFill, styles.railFill, fill]} />
    </View>
    {steps.map((node, i) => <Beat key={i} at={slots[Math.min(i, slots.length - 1)]}>{node}</Beat>)}
  </View>;
}

const styles = StyleSheet.create({
  badgeBox: { alignItems: 'center', justifyContent: 'center' },
  rail: { position: 'absolute', top: 12, bottom: 12, width: 1, marginLeft: -0.5, overflow: 'hidden', backgroundColor: fx.line.a05 },
  railFill: { backgroundColor: fx.red.a30 },
});
