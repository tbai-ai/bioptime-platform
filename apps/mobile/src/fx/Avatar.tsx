/* People's marks. Avatar: the earlier app's initials avatar on a 135° gradient in the brand's own reds (fx.red.brand →
   fx.red.avatarEnd, the coach medallion's pair; the earlier per-name HSL hues fell outside the palette and read muddy),
   white initials at 600 and .4 of the size; `ring` adds the Profile header ring
   (2 pt red/30 with a soft red glow). Medallion: the coach's monogram (there is no coach photo in the API), Bebas
   initials on the brand red gradient, on the motion kit's DepthTile. Both carry the person's name as their label. */
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { fx } from '@/theme';
import { DepthTile } from './motion/DepthTile';
import { T } from './Text';
import { FONTS } from './type';

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '·';
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '')).toUpperCase();
}

export function hueOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

export function Avatar({ name, size = 40, ring, style }: { name: string; size?: number; ring?: boolean; style?: StyleProp<ViewStyle> }) {
  const inner = <LinearGradient
    colors={[fx.red.brand, fx.red.avatarEnd]}
    start={{ x: 0.146, y: 0.146 }}
    end={{ x: 0.854, y: 0.854 }}
    style={[styles.center, { width: size, height: size, borderRadius: size / 2 }]}>
    <T v="section" style={{ fontFamily: FONTS.sans600, fontSize: size * 0.4, lineHeight: size * 0.5 }} accessible={false}>{initialsOf(name)}</T>
  </LinearGradient>;
  if (!ring) return <View accessible accessibilityRole="image" accessibilityLabel={name} style={style}>{inner}</View>;
  const outer = size + 4;
  return <View accessible accessibilityRole="image" accessibilityLabel={name} style={[styles.center, { width: outer, height: outer, borderRadius: outer / 2, borderWidth: 2, borderColor: fx.red.a30, boxShadow: fx.shadow.avatarRing }, style]}>
    {inner}
  </View>;
}

/** The coach's monogram medallion (header 40, thread 28): the motion kit's DepthTile, so it has depth when it turns and
 *  follows a finger (`follow`), flat at rest. */
export function Medallion({ name, size = 40, follow, turnIn, style }: { name: string; size?: number; follow?: boolean; turnIn?: boolean; style?: StyleProp<ViewStyle> }) {
  return <DepthTile size={size} radius={size / 2} color={fx.red.avatarEnd} follow={follow} turnIn={turnIn} accessibilityLabel={name} style={style}>
    <LinearGradient colors={[fx.red.brand, fx.red.avatarEnd]} start={{ x: 0.146, y: 0.146 }} end={{ x: 0.854, y: 0.854 }} style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }]} />
    <View style={[StyleSheet.absoluteFill, styles.center, { borderRadius: size / 2, borderWidth: 1, borderColor: fx.line.a15 }]}>
      <T v="small20" style={{ fontSize: size * 0.45, lineHeight: size * 0.5, paddingTop: size * 0.04 }} accessible={false}>{initialsOf(name)}</T>
    </View>
  </DepthTile>;
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
});
