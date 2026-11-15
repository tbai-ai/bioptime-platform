/* The check pop (PREMIUM §1.8): a task tick, a habit, a set row, a consent box, a quiz option's badge.
   - Checking: the badge springs from 0 to full size (spring.pop), its white check draws over 180 ms from 60 ms, and on
     tiers A and B a ring bursts (1.5 pt red/60, scale .8 → 2, opacity .8 → 0, 600 ms ease-out).
   - Unchecking: the badge shrinks to nothing over 140 ms; no burst.
   - Mounting already checked shows it at rest (no pop for a state that was already true). Calm: no movement at all.
   - `empty`: draw the unchecked state too, a 1.5 pt white/20 outline of the same shape (or the colour given), under
     the badge: it shows while unchecked and disappears under the badge as it pops.
   <Strike> draws a done task's 1 px line across its text (scaleX 0 → 1 from the left over 240 ms expo).
   The badge is decorative: the row or checkbox around it carries the role, the label and the checked state. */
import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, { useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import { fx } from '@/theme';
import { ease, spring, timing } from './tokens';
import { useMotion } from './tier';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const CHECK = 'M6.5 12.5 L10.5 16.5 L18 8.5';
const CHECK_LEN = 16.7; // length of CHECK in its 24-unit box

export type CheckPopProps = {
  checked: boolean;
  size?: number;
  /** circle (badges) or square (checkboxes, radius 6). */
  shape?: 'circle' | 'square';
  color?: string;
  checkColor?: string;
  /** The ring burst (default on; tiers A and B only). */
  burst?: boolean;
  /** Draw the empty outline while unchecked (true: white/20; or a colour). Default off: a badge over a photo or an
   *  icon shows nothing until checked. */
  empty?: boolean | string;
  style?: StyleProp<ViewStyle>;
};

export function CheckPop({ checked, size = 24, shape = 'circle', color = fx.red.brand, checkColor = fx.ink.white, burst = true, empty, style }: CheckPopProps) {
  const { tier, still } = useMotion();
  const badge = useSharedValue(checked ? 1 : 0);
  const draw = useSharedValue(checked ? 1 : 0);
  const ring = useSharedValue(0);
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    if (still) { badge.set(checked ? 1 : 0); draw.set(checked ? 1 : 0); return; }
    if (checked) {
      badge.set(0);
      badge.set(withSpring(1, spring.pop));
      draw.set(0);
      draw.set(withDelay(60, withTiming(1, timing(180, ease.expo))));
      if (burst && tier !== 'C') {
        ring.set(0);
        ring.set(withTiming(1, timing(600, ease.tailOut)));
      }
    } else {
      badge.set(withTiming(0, timing(140, ease.expo)));
      draw.set(0);
    }
    // reacts to the checked state only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked]);

  const radius = shape === 'circle' ? size / 2 : 6;
  const badgeStyle = useAnimatedStyle(() => {
    const b = badge.get();
    if (b === 1) return { opacity: 1, transform: [] };
    return { opacity: b > 0.01 ? 1 : 0, transform: [{ scale: b }] };
  });
  const ringStyle = useAnimatedStyle(() => {
    const r = ring.get();
    if (r <= 0 || r >= 1) return { opacity: 0, transform: [] };
    return { opacity: 0.8 * (1 - r), transform: [{ scale: 0.8 + 1.2 * r }] };
  });
  const checkProps = useAnimatedProps(() => ({ strokeDashoffset: CHECK_LEN * (1 - draw.get()) }));
  // the outline fades as the badge grows over it (no hairline left around a full badge)
  const emptyStyle = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, Math.max(0, badge.get())) }));
  const outline = empty ? (typeof empty === 'string' ? empty : fx.line.a20) : null;

  return <View style={[{ width: size, height: size }, style]} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    {outline ? <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: 1.5, borderColor: outline }, emptyStyle]} /> : null}
    <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: 1.5, borderColor: fx.red.a60 }, ringStyle]} />
    <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: radius, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }, badgeStyle]}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <AnimatedPath d={CHECK} fill="none" stroke={checkColor} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"
          strokeDasharray={`${CHECK_LEN} ${CHECK_LEN}`} animatedProps={checkProps} />
      </Svg>
    </Animated.View>
  </View>;
}

/** A done task's strike-through, laid over its text (absolute, vertically centred). */
export function Strike({ on, color = fx.ink.a40, style }: { on: boolean; color?: string; style?: StyleProp<ViewStyle> }) {
  const { still } = useMotion();
  const v = useSharedValue(on ? 1 : 0);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    v.set(still ? (on ? 1 : 0) : withTiming(on ? 1 : 0, timing(240, ease.expo)));
  }, [on, still, v]);
  const line = useAnimatedStyle(() => ({ transform: [{ scaleX: v.get() }] }));
  return <Animated.View pointerEvents="none" style={[styles.strike, { backgroundColor: color }, style, line]} />;
}

const styles = StyleSheet.create({
  strike: { position: 'absolute', left: 0, right: 0, top: '50%', height: 1, transformOrigin: 'left' },
});
