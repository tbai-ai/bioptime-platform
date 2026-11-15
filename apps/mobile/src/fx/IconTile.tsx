/* The earlier app's icon tile: a rounded square tinted with its colour (colour/10 fill, colour/25 ring) holding a
   Lucide icon in that colour; `solid` fills it (a chosen option: white icon on the colour), `glow` adds the soft colour/15
   halo of the featured cards. 40 pt by default (rows and cards), 48 in metric sheets, 36 in consent cards; the corner
   follows the size (8 under 36, 12 to 47, 16 from 48). Decorative: the row or card it sits in carries the label. */
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { fx } from '@/theme';
import { Icon, type IconName } from './Icon';
import { withAlpha } from './StatusPill';

export function IconTile({ icon, size = 40, color = fx.red.brand, radius, solid, glow, iconSize, style }: {
  icon: IconName; size?: number; color?: string; radius?: number; solid?: boolean; glow?: boolean; iconSize?: number; style?: StyleProp<ViewStyle>;
}) {
  const r = radius ?? (size >= 48 ? fx.radius.card : size >= 36 ? fx.radius.xl : fx.radius.lg);
  return <View
    accessible={false}
    importantForAccessibility="no-hide-descendants"
    style={[{
      width: size, height: size, borderRadius: r, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
      backgroundColor: solid ? color : withAlpha(color, 0.1),
      borderColor: solid ? color : withAlpha(color, 0.25),
      boxShadow: glow ? `0px 0px 20px ${withAlpha(color, 0.15)}` : undefined,
    }, style]}>
    <Icon name={icon} size={iconSize ?? Math.round(size * 0.45)} color={solid ? fx.ink.white : color} />
  </View>;
}
