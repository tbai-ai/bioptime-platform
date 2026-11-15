/* Quiz and picker options (THEME §11.4). OptionCard: a full-width row (px 16, py 16, radius 16), idle white/4 with a
   white/10 border; selected red/10 with the brand-red border and a soft red glow, a solid red 40 pt icon tile and a
   24 pt check badge that springs in. GoalTile: the two-column tile of the goals step (36 pt icon tile, no glow). Both
   press to .97 / .96 on the frame the finger lands. Selecting glides the fill, border, tile, text and the glow layer's
   opacity over t.stateMix (useStateMix; reduced motion: a 150 ms crossfade) instead of swapping them in one frame.
   In a single-choice group they are radios; GoalTile is a checkbox (multi-select). */
import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { fx } from '@/theme';
import { MixIcon, MixText } from './Chip';
import { haptics } from './device/haptics';
import { motionValues, spring, timing, useFx } from './effects';
import { Icon, type IconName } from './Icon';
import { AnimatedPressable, PRESS_PROPS, pressTransform, usePress, useStateMix } from './press';
import { T } from './Text';

/** The idle and selected colours of the box (fill, border) and of the icon tile. */
const IDLE_BG = fx.fill.a04, ON_BG = fx.red.a10, IDLE_BORDER = fx.line.a10, ON_BORDER = fx.red.brand;
const TILE_OFF = fx.premium.transparent, TILE_ON = fx.red.brand;

/** The pressable's scale and the selected colours in one animated style. */
function useOptionStyle(mix: SharedValue<number>, press: ReturnType<typeof usePress>) {
  const { progress, to, calm } = press;
  return useAnimatedStyle(() => ({
    transform: pressTransform(progress.value, to, 0, calm),
    backgroundColor: interpolateColor(mix.value, [0, 1], [IDLE_BG, ON_BG]),
    borderColor: interpolateColor(mix.value, [0, 1], [IDLE_BORDER, ON_BORDER]),
  }), [to, calm]);
}

function useTileStyle(mix: SharedValue<number>) {
  return useAnimatedStyle(() => ({ backgroundColor: interpolateColor(mix.value, [0, 1], [TILE_OFF, TILE_ON]) }));
}

function Badge({ on }: { on: boolean }) {
  const { calm } = useFx();
  const s = useSharedValue(on ? 1 : 0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current || calm) { s.value = on ? 1 : 0; first.current = false; return; }
    s.value = on ? withSpring(1, spring.pop) : withTiming(0, timing(motionValues.check.outMs));
  }, [on, calm, s]);
  const a = useAnimatedStyle(() => (s.value === 0 || s.value === 1 ? { opacity: s.value, transform: [] } : { opacity: Math.min(1, s.value * 2), transform: [{ scale: s.value }] }));
  return <Animated.View style={[styles.badge, a]}><Icon name="check" size={14} color={fx.ink.white} stroke={3} /></Animated.View>;
}

export function OptionCard({ title, description, descriptionColor = fx.ink.ink3, icon, selected, onPress, role = 'radio', style }: { title: string; description?: string;
  /** The description's ink (default ink3); a line the choice depends on (Book a test's test details) uses ink2 for AA. */
  descriptionColor?: string; icon?: IconName; selected: boolean; onPress: () => void; role?: 'radio' | 'button' | 'checkbox'; style?: StyleProp<ViewStyle> }) {
  const press = usePress('cta');
  const mix = useStateMix(selected);
  const box = useOptionStyle(mix, press);
  const tile = useTileStyle(mix);
  const glow = useAnimatedStyle(() => ({ opacity: mix.value }));
  return <AnimatedPressable
    {...PRESS_PROPS}
    accessibilityRole={role}
    accessibilityLabel={title}
    accessibilityHint={description}
    accessibilityState={role === 'button' ? { selected } : { checked: selected }}
    aria-checked={role === 'button' ? undefined : selected}
    onPress={() => { haptics.light(); onPress(); }}
    onPressIn={press.onPressIn}
    onPressOut={press.onPressOut}
    style={[styles.option, style, box]}>
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.glow, glow]} />
    {icon ? <Animated.View style={[styles.tile40, tile]}><MixIcon name={icon} size={20} mix={mix} idle={fx.ink.ink2} on={fx.ink.white} /></Animated.View> : null}
    <View style={styles.flex}>
      <MixText v="sectionStrong" mix={mix} idle={fx.ink.zinc200} on={fx.ink.white}>{title}</MixText>
      {description ? <T v="caption" color={descriptionColor}>{description}</T> : null}
    </View>
    <Badge on={selected} />
  </AnimatedPressable>;
}

export function GoalTile({ title, description, icon, selected, onPress, style }: { title: string; description?: string; icon?: IconName; selected: boolean; onPress: () => void; style?: StyleProp<ViewStyle> }) {
  const press = usePress('tile');
  const mix = useStateMix(selected);
  const box = useOptionStyle(mix, press);
  const tile = useTileStyle(mix);
  return <AnimatedPressable
    {...PRESS_PROPS}
    accessibilityRole="checkbox"
    accessibilityLabel={title}
    accessibilityHint={description}
    accessibilityState={{ checked: selected }}
    aria-checked={selected}
    onPress={() => { haptics.light(); onPress(); }}
    onPressIn={press.onPressIn}
    onPressOut={press.onPressOut}
    style={[styles.goal, style, box]}>
    {icon ? <Animated.View style={[styles.tile36, tile]}><MixIcon name={icon} size={18} mix={mix} idle={fx.ink.ink2} on={fx.ink.white} /></Animated.View> : null}
    <MixText v="sectionStrong" mix={mix} idle={fx.ink.zinc200} on={fx.ink.white}>{title}</MixText>
    {description ? <T v="caption" color={fx.ink.ink3} style={styles.goalDesc}>{description}</T> : null}
    <View style={styles.goalBadge}><Badge on={selected} /></View>
  </AnimatedPressable>;
}

const styles = StyleSheet.create({
  option: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, paddingVertical: 16, borderRadius: fx.radius.card, borderWidth: 1 },
  // the selected glow, pre-rendered: its opacity follows the mix (the shadow itself never animates)
  glow: { borderRadius: fx.radius.card, boxShadow: fx.shadow.option, backgroundColor: fx.premium.transparent },
  goal: { alignItems: 'flex-start', gap: 12, padding: 16, borderRadius: fx.radius.card, borderWidth: 1, flex: 1 },
  goalDesc: { fontSize: 10, lineHeight: 14 },
  goalBadge: { position: 'absolute', top: 12, right: 12 },
  flex: { flex: 1, gap: 2 },
  tile40: { width: 40, height: 40, borderRadius: fx.radius.xl, alignItems: 'center', justifyContent: 'center' },
  tile36: { width: 36, height: 36, borderRadius: fx.radius.xl, alignItems: 'center', justifyContent: 'center' },
  badge: { width: 24, height: 24, borderRadius: 12, backgroundColor: fx.red.brand, alignItems: 'center', justifyContent: 'center' },
});
