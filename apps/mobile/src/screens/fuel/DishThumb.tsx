/* A dish's picture: the recipe's own image from the Bioptime server when it has one, otherwise the earlier app's own
   fallback, a radial wash of the dish's tint with an icon (AMENDED §6: never a stock photo of a dish, since it would
   stand for food the member did not eat). Used for the dish card header (120), the dish sheet (140) and meal rows (40). */
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon, RadialGlow, RemotePhoto, withAlpha, type IconName } from '@/fx';
import { fx } from '@/theme';
import { absoluteUrl, dishTint } from './format';

export function DishThumb({ seed, imageUrl, icon, size, radius = fx.radius.lg, style }: {
  /** A stable id for the tint. */
  seed: string; imageUrl?: string | null; icon: IconName;
  /** Square side for rows; omit to fill the caller's box (card and sheet headers). */
  size?: number; radius?: number; style?: StyleProp<ViewStyle>;
}) {
  const c = dishTint(seed);
  const box: ViewStyle = size ? { width: size, height: size } : {};
  const uri = absoluteUrl(imageUrl);
  const glyph = size ? Math.max(16, Math.round(size * 0.45)) : 44;
  return <View accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.box, box, { borderRadius: radius, backgroundColor: withAlpha(c, 0.13) }, style]}>
    <View style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha(c, 0.1) }]} />
    <RadialGlow color={c} opacity={0.5} cx={0.3} cy={0.25} fade={0.75} style={StyleSheet.absoluteFill} />
    <View style={styles.centre}><Icon name={icon} size={glyph} color={withAlpha(lighten(c), 0.9)} stroke={1.5} /></View>
    {uri ? <RemotePhoto uri={uri} decorative style={StyleSheet.absoluteFill} /> : null}
  </View>;
}

/** The tint brightened toward white so the icon reads on its own wash. */
function lighten(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (v: number) => Math.round(v + (255 - v) * 0.45);
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden', borderWidth: 1, borderColor: fx.line.a10 },
  centre: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
});
