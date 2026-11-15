/* Status pills (THEME §11.5): 10/700 uppercase, wide, px 10 py 2, fully round, the colour at 12 % behind and 30 % around
   the word. `tone` keeps the staff kit's API (info, success, warning, error, sample) and its statusTone() mapping;
   `color` paints any status colour (order and marker maps). The word itself carries the meaning, never the colour. */
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { fx } from '@/theme';
import { Icon, type IconName } from './Icon';
import { HugText } from './wordFit';

export type PillTone = 'info' | 'success' | 'warning' | 'error' | 'sample';

const TONE: Record<PillTone, { fg: string; bg: string; line: string }> = {
  info: { fg: fx.ink.a60, bg: fx.fill.a05, line: fx.line.a10 },
  success: { fg: fx.hue.green400, bg: fx.tone.greenBg, line: fx.tone.greenLine },
  warning: { fg: fx.hue.amber400, bg: fx.tone.warningBg, line: fx.tone.warningLine },
  error: { fg: fx.red.label, bg: fx.red.a12, line: fx.red.a30 },
  sample: { fg: fx.hue.amber400, bg: fx.tone.warningBg, line: fx.tone.warningLine },
};

/** `#RRGGBB` + alpha (the earlier app's `{c}12` / `{c}30` suffixes). */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0');
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? `${hex}${a}` : hex;
}

export function Pill({ children, tone = 'info', color, icon, style }: { children: React.ReactNode; tone?: PillTone; color?: string; icon?: IconName; style?: StyleProp<ViewStyle> }) {
  const look = color ? { fg: color, bg: withAlpha(color, 0.12), line: withAlpha(color, 0.3) } : TONE[tone];
  return <View style={[styles.pill, { backgroundColor: look.bg, borderColor: look.line }, style]}>
    {icon ? <Icon name={icon} size={10} color={look.fg} /> : null}
    {/* its word never loses its last letter to the pixel rounding of a hugging box (TAB-01: 'ACTIVE' drawn 'ACTIV') */}
    <HugText v="micro" color={look.fg} style={styles.text}>{children}</HugText>
  </View>;
}

export function statusTone(s?: string | null): PillTone {
  if (!s) return 'info';
  if (['active', 'completed', 'done', 'confirmed', 'scheduled', 'activated', 'paid', 'available', 'results_ready', 'released'].includes(s)) return 'success';
  if (['pending', 'requested', 'pending_payment', 'processing', 'sample_collected', 'paused', 'onboarding', 'pending_verification'].includes(s)) return 'warning';
  if (['cancelled', 'failed', 'no_show', 'suspended', 'refunded', 'declined', 'expired'].includes(s)) return 'error';
  return 'info';
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 2, borderRadius: fx.radius.pill, borderWidth: 1 },
  text: { fontSize: 10, lineHeight: 15 },
});
