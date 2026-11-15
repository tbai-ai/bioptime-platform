/* Checkboxes (THEME §11.4 consent row, PREMIUM §1.8 check pop). Check: a 20 pt box, radius 6, solid red-500 with a
   white check (stroke 3) when on; the label sits inside the pressable. ConsentCard: the consent row (p 16, radius 16;
   on: red/40 border on red/5, off: white/10 on white/3) with a 36 pt icon tile, title, note and the box. The badge pops
   in with the pop spring (and a ring burst on full motion); unchecking shrinks it in 140 ms. The box's border and the
   consent row's border, fill, tile and icon glide between their states over t.stateMix (useStateMix; reduced motion:
   a 150 ms crossfade). Screen readers get a checkbox with aria-checked (the web harness reads it). */
import React, { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { fx } from '@/theme';
import { MixIcon } from './Chip';
import { haptics } from './device/haptics';
import { motionValues, spring, timing, useFx } from './effects';
import { Icon, type IconName } from './Icon';
import { PRESS_PROPS, useStateMix } from './press';
import { T } from './Text';

const BOX_IDLE = fx.line.a20;
const CONSENT = { border: [fx.line.a10, fx.red.a40], bg: [fx.fill.a03, fx.red.a05], tile: [fx.fill.a05, fx.red.a15] } as const;
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** The 20 pt box with its pop (used by Check, ConsentCard and list rows). */
export function CheckBox({ checked, size = 20, radius = 6, color = fx.red.vivid }: { checked: boolean; size?: number; radius?: number; color?: string }) {
  const { calm, lite } = useFx();
  const s = useSharedValue(checked ? 1 : 0);
  const burst = useSharedValue(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current || calm) { s.value = checked ? 1 : 0; first.current = false; return; }
    s.value = checked ? withSpring(1, spring.pop) : withTiming(0, timing(motionValues.check.outMs));
    if (checked && !lite) burst.value = withSequence(withTiming(0, { duration: 0 }), withTiming(1, timing(motionValues.check.burstMs)));
  }, [checked, calm, lite, s, burst]);
  const fill = useAnimatedStyle(() => (s.value === 0 || s.value === 1 ? { opacity: s.value, transform: [] } : { opacity: Math.min(1, s.value * 1.4), transform: [{ scale: 0.6 + 0.4 * s.value }] }));
  const ring = useAnimatedStyle(() => (burst.value > 0 && burst.value < 1 ? { opacity: 0.8 * (1 - burst.value), transform: [{ scale: 0.8 + 1.2 * burst.value }] } : { opacity: 0, transform: [] }));
  const mix = useStateMix(checked);
  const edge = useAnimatedStyle(() => ({ borderColor: interpolateColor(mix.value, [0, 1], [BOX_IDLE, color]) }), [color]);
  return <View style={{ width: size, height: size }}>
    <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: 1.5 }, edge]} />
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: size, borderWidth: 1.5, borderColor: fx.red.a60 }, ring]} />
    <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: radius, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }, fill]}>
      <Icon name="check" size={size * 0.7} color={fx.ink.white} stroke={3} />
    </Animated.View>
  </View>;
}

export function Check({ checked, onChange, label, hint, style, children }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; style?: StyleProp<ViewStyle>; children?: React.ReactNode }) {
  return <Pressable
    {...PRESS_PROPS}
    accessibilityRole="checkbox"
    accessibilityState={{ checked }}
    aria-checked={checked}
    accessibilityLabel={label}
    accessibilityHint={hint}
    onPress={() => { haptics.light(); onChange(!checked); }}
    style={[styles.check, style]}>
    <View style={styles.boxTop}><CheckBox checked={checked} /></View>
    <View style={styles.flex}>
      {children ?? <T v="body">{label}</T>}
      {hint ? <T v="caption" color={fx.ink.a50}>{hint}</T> : null}
    </View>
  </Pressable>;
}

/** The consent row of the onboarding consent screen and Privacy settings. `required` adds the word to the note. */
export function ConsentCard({ checked, onChange, title, note, icon = 'shield-check', disabled }: { checked: boolean; onChange: (v: boolean) => void; title: string; note?: string; icon?: IconName; disabled?: boolean }) {
  const mix = useStateMix(checked);
  const row = useAnimatedStyle(() => ({
    borderColor: interpolateColor(mix.value, [0, 1], [CONSENT.border[0], CONSENT.border[1]]),
    backgroundColor: interpolateColor(mix.value, [0, 1], [CONSENT.bg[0], CONSENT.bg[1]]),
  }));
  const tile = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(mix.value, [0, 1], [CONSENT.tile[0], CONSENT.tile[1]]) }));
  return <AnimatedPressable
    {...PRESS_PROPS}
    accessibilityRole="checkbox"
    accessibilityState={{ checked, disabled: !!disabled }}
    aria-checked={checked}
    accessibilityLabel={title}
    accessibilityHint={note}
    disabled={disabled}
    onPress={() => { haptics.light(); onChange(!checked); }}
    style={[styles.consent, row]}>
    <Animated.View style={[styles.tile, tile]}><MixIcon name={icon} size={18} mix={mix} idle={fx.ink.a50} on={fx.red.label} /></Animated.View>
    <View style={styles.flex}>
      <T v="sectionStrong">{title}</T>
      {note ? <T v="caption" color={fx.ink.a55}>{note}</T> : null}
    </View>
    <CheckBox checked={checked} />
  </AnimatedPressable>;
}

const styles = StyleSheet.create({
  check: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 8, minHeight: 44 },
  boxTop: { paddingTop: 2 },
  flex: { flex: 1, gap: 2 },
  consent: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: fx.radius.card, borderWidth: 1 },
  tile: { width: 36, height: 36, borderRadius: fx.radius.xl, alignItems: 'center', justifyContent: 'center' },
});
