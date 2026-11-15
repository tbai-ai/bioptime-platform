/* Box breathing (THEME §11.15, PREMIUM §1.10 Coach): the 96 pt circle grows to 1.5× while breathing in (4 s, ease in
   out), stays there for the hold (4 s), returns while breathing out (4 s) and rests (2 s); five cycles. While running
   the circle is red-bordered with a red/10 fill and a glow that follows its size. The phase name sits in the circle
   (and is announced); before the start it says "Tap to start", and a tap on the circle starts it, as in the earlier
   app. "Cycle n of 5" under it counts the cycles done while it runs. The pill under it is the earlier app's red Start
   (red-500 with a 20 pt red glow) and, while running, the neutral white/10 Stop. A soft haptic marks each breath in
   and a light one each breath out (off with `haptics={false}`). Calm: the circle stays still and each phase shows a
   countdown of its seconds instead. Nothing runs until Start; the card around it is the screen's. */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { fx } from '@/theme';
import { FONTS } from '@/fx/type';
import { haptics as buzz } from '@/fx/device/haptics';
import { ease, timing } from './tokens';
import { useMotion } from './tier';

type Phase = 'in' | 'hold' | 'out' | 'rest';
const PHASES: readonly { phase: Phase; seconds: number; label: string }[] = [
  { phase: 'in', seconds: 4, label: 'Breathe in…' },
  { phase: 'hold', seconds: 4, label: 'Hold…' },
  { phase: 'out', seconds: 4, label: 'Breathe out…' },
  { phase: 'rest', seconds: 2, label: 'Rest…' },
];
const SNAP = 400;

export type BoxBreathingProps = {
  cycles?: number;
  /** What the circle says before Start (default "Tap to start"). */
  idleLabel?: string;
  haptics?: boolean;
  size?: number;
  onRunningChange?: (running: boolean) => void;
  style?: StyleProp<ViewStyle>;
};

export function BoxBreathing({ cycles = 5, idleLabel = 'Tap to start', haptics = true, size = 96, onRunningChange, style }: BoxBreathingProps) {
  const { still } = useMotion();
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(0); // index into PHASES
  const [done, setDone] = useState(0); // cycles completed
  const [left, setLeft] = useState(0); // seconds left in the phase (calm countdown)
  const scale = useSharedValue(1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    if (ticker.current) clearInterval(ticker.current);
    timer.current = null;
    ticker.current = null;
  };

  // run one phase, then schedule the next
  const enter = (i: number, completed: number) => {
    const p = PHASES[i];
    setStep(i);
    setDone(completed);
    setLeft(p.seconds);
    if (haptics && p.phase === 'in') buzz.soft();
    if (haptics && p.phase === 'out') buzz.light();
    if (!still) {
      if (p.phase === 'in') scale.set(withTiming(1.5, { duration: p.seconds * 1000, easing: ease.cssInOut }));
      else if (p.phase === 'out') scale.set(withTiming(1, { duration: p.seconds * 1000, easing: ease.cssInOut }));
      else scale.set(withTiming(p.phase === 'hold' ? 1.5 : 1, timing(SNAP)));
    }
    if (ticker.current) clearInterval(ticker.current);
    ticker.current = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    timer.current = setTimeout(() => {
      const next = (i + 1) % PHASES.length;
      const finished = next === 0 ? completed + 1 : completed;
      if (finished >= cycles) { stop(finished); return; }
      enter(next, finished);
    }, p.seconds * 1000);
  };

  const stop = (finished?: number) => {
    clear();
    setRunning(false);
    if (finished != null) setDone(finished);
    cancelAnimation(scale);
    scale.set(withTiming(1, timing(SNAP)));
    onRunningChange?.(false);
  };

  const start = () => {
    clear();
    setRunning(true);
    onRunningChange?.(true);
    enter(0, 0);
  };

  useEffect(() => () => clear(), []);

  const circle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const glow = useAnimatedStyle(() => ({ opacity: running ? 0.35 + 0.65 * Math.min(1, (scale.get() - 1) / 0.5) : 0 }));
  const current = PHASES[step];
  const label = running ? current.label : idleLabel;

  return <View style={[styles.wrap, style]}>
    {/* the circle starts it too; the pill below is the control screen readers use, so this one is not announced */}
    <Pressable onPress={running ? undefined : start} disabled={running} accessible={false} tabIndex={-1}
      style={{ width: size * 1.5, height: size * 1.5, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ width: size, height: size, borderRadius: size / 2 }, circle]}>
        <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: size / 2, boxShadow: fx.shadow.fabLg }, glow]} />
        <View style={[StyleSheet.absoluteFill, styles.circle, { borderRadius: size / 2 }, running ? styles.active : styles.idle]} />
      </Animated.View>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.centre]}>
        <Text style={[styles.phase, running ? styles.phaseOn : styles.phaseIdle]} accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.3}>{label}</Text>
        {running && still ? <Text style={styles.count} maxFontSizeMultiplier={1.3}>{left}</Text> : null}
      </View>
    </Pressable>
    {running ? <Text style={styles.cycle} maxFontSizeMultiplier={1.3}>{`Cycle ${Math.min(done + 1, cycles)} of ${cycles}`}</Text> : null}
    <Pressable
      onPress={() => (running ? stop() : start())}
      accessibilityRole="button"
      accessibilityLabel={running ? 'Stop' : 'Start'}
      hitSlop={8}
      style={({ pressed }) => [styles.pill, running ? null : styles.pillStart, !running && pressed ? styles.pillStartPressed : null, pressed ? styles.pillPressed : null]}
    >
      <Text style={styles.pillText} maxFontSizeMultiplier={1.3}>{running ? 'Stop' : 'Start'}</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 12 },
  circle: { borderWidth: 2 },
  idle: { borderColor: fx.line.a10, backgroundColor: fx.fill.a03 },
  active: { borderColor: fx.red.vivid, backgroundColor: fx.red.a10 },
  centre: { alignItems: 'center', justifyContent: 'center' },
  phase: { fontFamily: FONTS.sans500, fontSize: 15, lineHeight: 22, color: fx.ink.a70 },
  phaseOn: { color: fx.red.label },
  phaseIdle: { fontSize: 14, lineHeight: 20, color: fx.ink.a80, textAlign: 'center', paddingHorizontal: 6 },
  count: { fontFamily: FONTS.mono500, fontSize: 14, lineHeight: 20, color: fx.ink.a60 },
  cycle: { fontFamily: FONTS.sans400, fontSize: 12, lineHeight: 18, color: fx.ink.a70 },
  pill: { paddingHorizontal: 24, paddingVertical: 10, minHeight: 44, justifyContent: 'center', borderRadius: 999, backgroundColor: fx.fill.a10, borderWidth: 1, borderColor: fx.line.a10 },
  pillStart: { backgroundColor: fx.red.pressed, borderColor: fx.red.pressed, boxShadow: fx.shadow.fab },
  pillStartPressed: { backgroundColor: fx.red.deep, borderColor: fx.red.deep },
  pillPressed: { transform: [{ scale: 0.97 }] },
  pillText: { fontFamily: FONTS.sans500, fontSize: 15, lineHeight: 22, color: fx.ink.white },
});
