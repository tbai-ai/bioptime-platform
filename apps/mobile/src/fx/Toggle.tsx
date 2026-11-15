/* The switch (THEME §11.7, PREMIUM §1.8): a 44×24 track, red-500 when on and white/10 when off, a 20 pt white knob that
   springs between x 2 and 22 and stretches to 26 wide while pressed. The knob's anchor is continuous in x (it stretches
   to the right at the off end and to the left at the on end, blending in between) and a release unwinds the stretch
   with the knob's travel rather than by time, so the knob never kicks the wrong way; the track's colour follows x, so
   the red pours in behind the knob. With reduced motion the knob still
   moves (it is state), over a 120 ms linear timing that plays, and the colour follows it. A switch for screen readers;
   `label` is required. */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { interpolate, interpolateColor, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { fx } from '@/theme';
import { haptics } from './device/haptics';
import { motionValues, spring, t, timing, useFx } from './effects';
import { calmFade } from './motion/tokens';
import { PRESS_PROPS } from './press';
import { T } from './Text';

const KNOB = 20;
const KNOB_PRESSED = 26;
/** The track's off and on colours (the worklet captures the two strings, not the theme). */
const OFF = fx.fill.a10;
const ON = fx.red.vivid;

export function Toggle({ value, onChange, label, disabled, showLabel }: { value: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; showLabel?: boolean }) {
  const { calm } = useFx();
  const { from, to, calmMs } = motionValues.toggle;
  const [pressed, setPressed] = useState(false);
  const x = useSharedValue(value ? to : from);
  const goal = useSharedValue(value ? to : from);
  const stretch = useSharedValue(0); // the press stretch (0 … 1), by time while the finger is down
  const carry = useSharedValue(0); // the stretch a release took with it: it unwinds with the knob's travel, never by time
  useEffect(() => {
    const at = value ? to : from;
    goal.value = at;
    if (calm) { x.value = withTiming(at, calmFade(calmMs)); return; }
    carry.value = Math.max(carry.value, stretch.value);
    stretch.value = 0;
    x.value = withSpring(at, spring.knob, (done) => { 'worklet'; if (done) carry.value = 0; });
  }, [value, calm, x, goal, stretch, carry, from, to, calmMs]);
  useEffect(() => { if (!calm) stretch.value = withTiming(pressed ? 1 : 0, timing(t.pop)); }, [pressed, calm, stretch]);
  const knob = useAnimatedStyle(() => {
    const span = to - from;
    const travel = Math.min(1, Math.abs(x.value - goal.value) / span);
    const e = Math.max(stretch.value, carry.value * travel);
    const kw = KNOB + (KNOB_PRESSED - KNOB) * e;
    // the anchor is continuous in x: the stretch grows rightwards at the off end and leftwards at the on end
    const k = interpolate(x.value, [from, to], [0, 1], 'clamp');
    return { width: kw, transform: [{ translateX: x.value - (kw - KNOB) * k }] };
  });
  const fill = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(x.value, [from, to], [OFF, ON]) }));
  const sw = <Pressable
    {...PRESS_PROPS}
    accessibilityRole="switch"
    accessibilityLabel={label}
    accessibilityState={{ checked: value, disabled: !!disabled }}
    aria-checked={value}
    disabled={disabled}
    onPress={() => { haptics.toggle(!value); onChange(!value); }}
    onPressIn={() => setPressed(true)}
    onPressOut={() => setPressed(false)}
    hitSlop={10}
    style={[styles.track, { opacity: disabled ? 0.4 : 1 }]}>
    <Animated.View pointerEvents="none" style={[styles.fill, fill]} />
    <Animated.View style={[styles.knob, knob]} />
  </Pressable>;
  if (!showLabel) return sw;
  return <View style={styles.row}><T v="section" style={styles.label}>{label}</T>{sw}</View>;
}

const styles = StyleSheet.create({
  track: { width: 44, height: 24, borderRadius: fx.radius.pill, justifyContent: 'center' },
  fill: { ...StyleSheet.absoluteFill, borderRadius: fx.radius.pill },
  knob: { position: 'absolute', left: 0, top: 2, height: KNOB, borderRadius: KNOB / 2, backgroundColor: fx.ink.white, boxShadow: fx.premium.knobShadow },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  label: { flex: 1 },
});
