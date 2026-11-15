/* Dividers (THEME §11.9): TitledDivider, the "OR CONTINUE WITH" / "EXERCISE GUIDE" rule (10 pt uppercase, .2em,
   white/30 between two white/10 hairlines; white/50 when it is the only label of a section), and RowDivider, the
   white/5 line between rows. */
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { fx } from '@/theme';
import { T } from './Text';

export function TitledDivider({ text, strong, style }: { text: string; strong?: boolean; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>
    <View style={styles.line} />
    <T v="eyebrowStore" color={strong ? fx.ink.a50 : fx.ink.a30} style={styles.text}>{text}</T>
    <View style={styles.line} />
  </View>;
}

export function RowDivider({ inset = 0, style }: { inset?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.rowLine, { marginLeft: inset }, style]} accessible={false} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  line: { flex: 1, height: 1, backgroundColor: fx.line.a10 },
  text: { fontSize: 10, letterSpacing: 2 },
  rowLine: { height: 1, backgroundColor: fx.line.a05 },
});
