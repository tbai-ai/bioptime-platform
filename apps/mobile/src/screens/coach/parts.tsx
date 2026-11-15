/* Small pieces the Coach screens share: the success state of a sheet (a check that pops in, a title and Bioptime's
   sentence), a quiet chip for a coach's details (expertise, languages, scope), the coach's assignment status (the dot
   and its word: the colour never carries the meaning alone; no "online" claim, nothing pulses) and section labels. */
import React, { useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { CheckPop, T, fx } from '@/fx';
import { label } from '@/lib/format';

export function DoneState({ title, text }: { title: string; text: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setOn(true), 60); return () => clearTimeout(timer); }, []);
  return <View style={styles.done} accessibilityLiveRegion="polite">
    <CheckPop checked={on} size={56} />
    <T v="heading" center accessibilityRole="header">{title}</T>
    <T v="body" color={fx.ink.a70} center>{text}</T>
  </View>;
}

export function InfoChip({ children }: { children: React.ReactNode }) {
  return <View style={styles.chip}><T v="chip" color={fx.ink.a80}>{children}</T></View>;
}

export function ChipRow({ items, style }: { items: string[]; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{items.map((x) => <InfoChip key={x}>{label(x)}</InfoChip>)}</View>;
}

export type CoachStatus = 'active' | 'paused' | 'none';

export function statusOf(s?: string | null): CoachStatus {
  return s === 'active' ? 'active' : s === 'paused' ? 'paused' : 'none';
}

export const STATUS_WORD: Record<CoachStatus, string> = { active: 'Active', paused: 'Away for now', none: 'Not assigned' };
const STATUS_DOT: Record<CoachStatus, string> = { active: fx.hue.green500, paused: fx.hue.amber400, none: fx.hue.grey };

/** The 10 pt dot on the medallion (2 pt ring in the header colour). */
export function StatusDot({ status, size = 10, ring = fx.bg.panel, style }: { status: CoachStatus; size?: number; ring?: string; style?: StyleProp<ViewStyle> }) {
  return <View accessible={false} style={[{ width: size + 4, height: size + 4, borderRadius: (size + 4) / 2, backgroundColor: ring, alignItems: 'center', justifyContent: 'center' }, style]}>
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: STATUS_DOT[status] }} />
  </View>;
}

export function SectionLabel({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={style}><T v="label">{children}</T></View>;
}

const styles = StyleSheet.create({
  done: { alignItems: 'center', gap: 12, paddingVertical: 24 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: fx.radius.pill, borderWidth: 1, borderColor: fx.line.a10, backgroundColor: fx.fill.a05 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
