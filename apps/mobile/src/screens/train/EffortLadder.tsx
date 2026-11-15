/* Effort 1–10 as a ladder that reads as intensity (motion v2 M76; the player's "After the session" and the MARK sheet):
   choosing n tints chips 1..n in the intensity band of each (1–3 light: green, 4–6 moderate: amber, 7–8 hard: orange,
   9–10 maximal: Bioptime red; one token per band, never a colour mixed between two hues) one after another in the
   direction of change (S.m76.effortStep apart, S.m76.effortMs each), and the chosen chip pops
   (spring.pop) with a selection haptic. Each chip is a button that reads its number and says whether it is the one
   chosen (the E2E presses '7'); a second press on the chosen one clears it. Every chip presses to .94 on the frame the
   finger lands. Tier C: colours only (no pop); reduced motion: a 150 ms crossfade. */
import React, { useEffect, useRef } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import { AnimatedPressable, calmFade, fx, haptics, maxScaleFor, motionValues, spring, timing, typeScale, usePress, useFx, withAlpha } from '@/fx';
import { PRESS_PROPS } from '@/fx/press';

const S = motionValues.screens.m76;
const COUNT = 10;
const AText = Animated.createAnimatedComponent(Text);

const IDLE_BG = fx.fill.a05;
const IDLE_LINE = fx.line.a10;
const IDLE_TEXT = fx.ink.white;

/** The intensity band of chip `n` (1..10): its colour (fill and border tints, the chosen chip's border) and the shade
 *  its number is written in (light enough for the chip's 4.5:1 on its tint). */
function band(n: number): { c: string; ink: string } {
  if (n <= 3) return { c: fx.hue.green500, ink: fx.hue.green400 };
  if (n <= 6) return { c: fx.hue.amber400, ink: fx.hue.amber400 };
  if (n <= 8) return { c: fx.hue.orange500, ink: fx.hue.orange400 };
  return { c: fx.red.brand, ink: fx.red.label };
}

export function EffortLadder({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const prev = useRef(value ?? 0);
  const was = prev.current;
  const now = value ?? 0;
  if (was !== now) prev.current = now;
  const lo = Math.min(was, now), hi = Math.max(was, now);
  const up = now > was;
  return <View style={styles.row}>
    {Array.from({ length: COUNT }, (_, i) => {
      const n = i + 1;
      // the chips that change tint, in the direction of change: up from the old top, down from it
      const delay = n > lo && n <= hi ? (up ? n - lo - 1 : hi - n) * S.effortStep : 0;
      return <EffortChip key={n} n={n} on={n <= now} chosen={n === now} delay={delay}
        onPress={() => onChange(value === n ? null : n)} />;
    })}
  </View>;
}

function EffortChip({ n, on, chosen, delay, onPress }: { n: number; on: boolean; chosen: boolean; delay: number; onPress: () => void }) {
  const { calm, tier } = useFx();
  const press = usePress('chip');
  const { progress, to } = press;
  const tint = useSharedValue(on ? 1 : 0);
  const sel = useSharedValue(chosen ? 1 : 0);
  const pop = useSharedValue(1);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const cfg = calm ? calmFade() : timing(S.effortMs);
    tint.value = calm || delay <= 0 ? withTiming(on ? 1 : 0, cfg) : withDelay(delay, withTiming(on ? 1 : 0, cfg));
    sel.value = withTiming(chosen ? 1 : 0, cfg);
    if (chosen && !calm && tier !== 'C') {
      pop.value = motionValues.count.popScale;
      pop.value = withSpring(1, spring.pop);
    }
  }, [on, chosen]); // eslint-disable-line react-hooks/exhaustive-deps
  const { c, ink } = band(n);
  const bgOn = withAlpha(c, 0.15), lineOn = withAlpha(c, 0.3);
  const box = useAnimatedStyle(() => {
    const p = progress.value;
    const ps = calm || p === 0 ? 1 : 1 - (1 - to) * p;
    const k = pop.value * ps;
    const t0 = tint.value;
    return {
      backgroundColor: interpolateColor(t0, [0, 1], [IDLE_BG, bgOn]),
      borderColor: interpolateColor(sel.value, [0, 1], [interpolateColor(t0, [0, 1], [IDLE_LINE, lineOn]), c]),
      transform: k === 1 ? [] : [{ scale: k }],
    };
  }, [bgOn, lineOn, c, to, calm]);
  const label = useAnimatedStyle(() => ({ color: interpolateColor(tint.value, [0, 1], [IDLE_TEXT, ink]) }), [ink]);
  return <AnimatedPressable
    {...PRESS_PROPS}
    accessibilityRole="button"
    accessibilityLabel={String(n)}
    accessibilityState={{ selected: chosen }}
    {...(Platform.OS === 'web' ? { 'aria-pressed': chosen } : null)}
    onPress={() => { haptics.select(); onPress(); }}
    onPressIn={press.onPressIn}
    onPressOut={press.onPressOut}
    hitSlop={Platform.OS === 'web' ? undefined : SLOP}
    style={[styles.chip, box]}>
    <AText maxFontSizeMultiplier={maxScaleFor('chip')} style={[typeScale.chip, label]}>{String(n)}</AText>
  </AnimatedPressable>;
}

const SLOP = { top: 8, bottom: 8, left: 4, right: 4 };

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingVertical: 8, borderRadius: fx.radius.pill, borderWidth: 1, minHeight: 32 },
});
