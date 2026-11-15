/* The earlier app's glass panel (THEME §5, §11.4): rgba(20,20,20,.4) with a 16 pt blur, a 1 px white/5 border, radius 16,
   padding 20 and a soft drop shadow. Over plain black a blur shows nothing and costs a lot, so a card blurs only when
   something passes behind it (`blur`: a photo or the orbs) and the device allows it (iOS and the web, not lite; Android
   uses the opaque fallback in Phase 1); otherwise it is the solid #0B0B0B the glass renders as (PREMIUM §1.6). A thin
   top-lit hairline sits inside the top edge (premium). Pressable cards scale per the ladder and their border warms to
   red/30 while pressed, with a faint red glow (a pre-rendered layer whose opacity follows the press; the shadow never
   animates), all from the press progress on the UI thread. Cards sit in scrollers: the pressed state waits
   motionValues.press.scrollDelay, so a scroll that starts on a card never flashes it. Variants: card (16/20), tile
   (16/16, press .96), three (24/20), hero (32/24, white/10 border, deep shadow). */
import { BlurView } from 'expo-blur';
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle } from 'react-native-reanimated';
import { fx } from '@/theme';
import { useFx } from './effects';
import { Scrim } from './Gradient';
import { AnimatedPressable, pressTransform, usePress } from './press';

export type GlassVariant = 'card' | 'tile' | 'three' | 'hero';

const SHAPE: Record<GlassVariant, { radius: number; padding: number; border: string; shadow: string }> = {
  card: { radius: fx.radius.card, padding: fx.space.pad, border: fx.line.a05, shadow: fx.shadow.panel },
  tile: { radius: fx.radius.card, padding: fx.space.tile, border: fx.line.a05, shadow: fx.shadow.panel },
  three: { radius: fx.radius.three, padding: fx.space.pad, border: fx.line.a05, shadow: fx.shadow.card },
  hero: { radius: fx.radius.hero, padding: fx.space.hero, border: fx.line.a10, shadow: fx.shadow.deep },
};

export type GlassCardProps = {
  children?: React.ReactNode;
  variant?: GlassVariant;
  /** Something passes behind this card (a photo, the orbs): blur it where the device allows. */
  blur?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  /** The accessibility label of a pressable card (its title). */
  label?: string;
  hint?: string;
  /** A coloured left rule (insight cards: 4, stat tiles: 2). */
  rule?: { color: string; width?: number };
  /** Override the border colour (selected, done states). */
  borderColor?: string;
  padding?: number;
  /** Overflow hidden (cards with an image or a strip). */
  clip?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function GlassCard({ children, variant = 'card', blur, onPress, onLongPress, label, hint, rule, borderColor, padding, clip, style, testID }: GlassCardProps) {
  const fxs = useFx();
  const shape = SHAPE[variant];
  const press = usePress(variant === 'tile' ? 'tile' : 'card', 0, { scroll: true });
  const glass = !!blur && fxs.blur;
  const border = borderColor ?? shape.border;
  const clipped = !!(clip || glass);
  const box: ViewStyle = {
    borderRadius: shape.radius,
    borderWidth: 1,
    borderColor: border,
    backgroundColor: glass ? fx.glass.card : blur ? fx.glass.cardLite : fx.bg.panelSolid,
    padding: padding ?? shape.padding,
    boxShadow: shape.shadow,
    overflow: clipped ? 'hidden' : undefined,
    ...(rule ? { borderLeftWidth: rule.width ?? 4, borderLeftColor: rule.color } : null),
  };
  // the pressed border and glow ride the press progress (a rule keeps its own left colour: borderColor sets all four)
  const { progress, to, calm } = press;
  const ruleColor = rule?.color;
  const pressedLook = useAnimatedStyle(() => {
    const p = progress.value;
    if (p === 0) return { transform: [] };
    const c = interpolateColor(Math.max(0, Math.min(1, p)), [0, 1], [border, PRESSED_BORDER]);
    return ruleColor
      ? { transform: pressTransform(p, to, 0, calm), borderTopColor: c, borderRightColor: c, borderBottomColor: c }
      : { transform: pressTransform(p, to, 0, calm), borderColor: c };
  }, [border, ruleColor, to, calm]);
  const glow = useAnimatedStyle(() => ({ opacity: Math.max(0, Math.min(1, progress.value)) }));
  const inner = <>
    {glass ? <BlurView intensity={40} tint="dark" style={[StyleSheet.absoluteFill, { borderRadius: shape.radius }]} /> : null}
    <Scrim kind="topLight" style={[styles.topLight, { left: shape.radius, right: shape.radius }]} />
    {children}
  </>;
  if (!onPress && !onLongPress) return <View testID={testID} style={[box, style]}>{inner}</View>;
  return <AnimatedPressable
    {...press.scrollProps}
    testID={testID}
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityHint={hint}
    onPress={onPress}
    onLongPress={onLongPress}
    onPressIn={press.onPressIn}
    onPressOut={press.onPressOut}
    style={[box, style, pressedLook]}>
    {/* the pressed glow, outside the card's edge (a clipped card has no room for it) */}
    {!clipped ? <Animated.View pointerEvents="none" style={[styles.glow, { borderRadius: shape.radius }, glow]} /> : null}
    {inner}
  </AnimatedPressable>;
}

/** The pressed border colour. */
const PRESSED_BORDER = fx.red.a30;

const styles = StyleSheet.create({
  glow: { position: 'absolute', top: -1, left: -1, right: -1, bottom: -1, boxShadow: fx.shadow.cardHover, backgroundColor: fx.premium.transparent },
  topLight: { position: 'absolute', top: 0, height: 1 },
});
