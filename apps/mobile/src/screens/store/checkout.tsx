/* Pieces of the checkout chrome (the earlier app's checkout, shots 64-checkout*, 72, 73) for the package checkout:
   - StepBars: the segmented progress under the header (the Tests checkout's SegmentBar: done and current red, the rest
     white/10, each fill sliding in inside its clipped track);
   - SuccessMark: the app's done moment, the same as the player's SESSION DONE (M72; C15): the red check disc pops in
     (the kit's CheckPop at S.m72.badge, its check drawing, a ring bursting at tier A) with the success haptic, and the
     Bebas title rises S.m72.titleY over S.m72.titleMs with a line under it. Tier C: a static check and the title
     fading in place (t.fast); reduced motion and the pre-rendered web HTML: at rest, the haptic kept. Used by the
     package checkout ("Starter is active") and the blood-test booking ("Booking confirmed"); green stays for the
     status chips;
   - Steps: "What happens next", numbered in red rings, arriving at +200/+260/+320/+380 while their rail draws. */
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { CheckPop, ease, Eyebrow, fx, GlassCard, haptics, T, t, timing, useFx } from '@/fx';
import { motionValues } from '@/fx/motion/tokens';
import { BEATS, Beat, StepsRail } from '@/screens/tests/Beats';
import { SegmentBar } from '@/screens/tests/Checkout';

/** The done moment's sizes and clock: the player's SESSION DONE card (M72). */
const DONE = motionValues.screens.m72;

export function StepBars({ step, of }: { step: number; of: number }) {
  return <View style={styles.bars} accessible accessibilityRole="progressbar" accessibilityLabel={`Step ${step} of ${of}`} accessibilityValue={{ min: 1, max: of, now: step }}>
    <SegmentBar step={step} of={of} />
  </View>;
}

export function SuccessMark({ title, sub }: { title: string; sub?: string | null }) {
  const { calm, tier, inHtml } = useFx();
  const still = calm || inHtml;
  // mounted empty and popped on the next frame (tier C and at rest: drawn checked)
  const [checked, setChecked] = useState(still || tier === 'C');
  const buzzed = useRef(false);
  useEffect(() => {
    if (!buzzed.current && !inHtml) { buzzed.current = true; haptics.success(); }
    if (checked) return;
    const raf = requestAnimationFrame(() => setChecked(true));
    return () => cancelAnimationFrame(raf);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const rise = useSharedValue(still ? 1 : 0);
  useEffect(() => {
    if (still) return;
    rise.value = withTiming(1, tier === 'C' ? timing(t.fast, ease.linear) : timing(DONE.titleMs));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const y = tier === 'C' ? 0 : DONE.titleY;
  const titleStyle = useAnimatedStyle(() => (rise.value >= 1 ? { opacity: 1, transform: [] } : { opacity: rise.value, transform: [{ translateY: y * (1 - rise.value) }] }));
  // not one accessible group: the title stays a heading screen readers can find (the check is decorative, hidden by
  // CheckPop itself), and the line under it is read after it
  return <View style={styles.success}>
    <CheckPop checked={checked} size={DONE.badge} burst={tier === 'A'} />
    <Animated.View style={[styles.titles, titleStyle]}>
      <T v="display36" center accessibilityRole="header">{title}</T>
      {sub ? <T v="body" color={fx.ink.a70} center style={styles.sub}>{sub}</T> : null}
    </Animated.View>
  </View>;
}

export function Steps({ items, title = 'What happens next' }: { items: string[]; title?: string }) {
  return <Beat at={BEATS.stepsAt[0]} rise={0}><GlassCard variant="three">
    <Eyebrow kind="label" style={styles.stepsTitle}>{title}</Eyebrow>
    <StepsRail railLeft={12} gap={14} steps={items.map((s, i) => <View key={s} style={styles.step}>
      <View style={styles.num}><T v="micro" color={fx.red.label}>{String(i + 1)}</T></View>
      <T v="body" color={fx.ink.a80} style={styles.flex}>{s}</T>
    </View>)} />
  </GlassCard></Beat>;
}

const styles = StyleSheet.create({
  bars: { marginTop: -4 },
  success: { alignItems: 'center', gap: 12, paddingVertical: 12 },
  titles: { alignItems: 'center', gap: 8 },
  sub: { maxWidth: 320 },
  stepsTitle: { marginBottom: 14 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  num: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: fx.red.a40, backgroundColor: fx.red.a10, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
});
