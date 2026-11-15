/* Small compositions of the existing primitives for the part B1 admin screens (same tokens as components/workspace.tsx;
   nothing new in colour or type):
   DetailRow   { title, lines?, pills?, right?, onPress?, actions? }   a record row like RecordRow whose detail may run to
                                                                      several lines (a table's extra columns) with small
                                                                      action buttons beneath (the table's last column)
   LoadError   { title, error, onRetry? }   the portal's titled error alert ("Reports could not be loaded"), falling back
                                            to ErrorBox for a dropped connection or an ended session
   Readout     { eyebrow, value, sub? }     the portal's Readout: an eyebrow, a large number, a sub-line
   Bars        { series, labels, caption? } the portal's bar chart (ui/index.tsx Bars) drawn with Views at the same
                                            proportions: tallest bar full height, labels beneath
   PermissionScreen { permission, any? }    RequirePermission for a screen that draws its own Screen (the Operations
                                            page): the children when the permission is held, else the shared refusal
                                            inside a Screen, so it keeps the gutter instead of running edge to edge */
import Ionicons from '@expo/vector-icons/Ionicons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { permitted } from '../../lib/workspaceNav';
import { Button, ErrorBox, Eyebrow, Notice, Pill, Screen } from '../ui';
import type { RecordPill } from '../workspace';
import { RequirePermission } from '../workspaceShell';
import { colors, font, radius, space } from '../../theme';

export function DetailRow({ title, lines, pills, right, onPress, actions, last }: { title: string; lines?: Array<string | null | undefined | false>; pills?: RecordPill[]; right?: React.ReactNode; onPress?: () => void; actions?: React.ReactNode; last?: boolean }) {
  const shown = (lines ?? []).filter((l): l is string => typeof l === 'string' && l.trim().length > 0);
  return <View style={[styles.wrap, last && { borderBottomWidth: 0 }]}>
    <Pressable accessibilityRole={onPress ? 'button' : undefined} onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.hover }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.title}>{title}</Text>
        {shown.map((l, i) => <Text key={`${i}-${l.slice(0, 24)}`} style={styles.meta}>{l}</Text>)}
        {pills?.length ? <View style={styles.pillRow}>{pills.map((p, i) => <Pill key={`${p.label}-${i}`} tone={p.tone}>{p.label}</Pill>)}</View> : null}
      </View>
      {right}
      {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.muted} /> : null}
    </Pressable>
    {actions ? <View style={styles.actions}>{actions}</View> : null}
  </View>;
}

export function LoadError({ title, error, onRetry }: { title: string; error: ApiError | Error | null; onRetry?: () => void }) {
  if (!error) return null;
  if (error instanceof ApiError && (error.offline || error.status === 401)) return <ErrorBox error={error} onRetry={onRetry} />;
  return <Notice kind="error" title={title}>
    <Text style={styles.noticeBody}>{error.message}</Text>
    {onRetry ? <Button title="Try again" variant="secondary" small onPress={onRetry} style={{ marginTop: space.sm, alignSelf: 'flex-start' }} /> : null}
  </Notice>;
}

export function Readout({ eyebrow, value, sub }: { eyebrow: string; value: string | number; sub?: string }) {
  return <View style={styles.readout}>
    <Eyebrow>{eyebrow}</Eyebrow>
    <Text style={styles.readoutValue} accessibilityLabel={`${eyebrow}: ${value}`}>{String(value)}</Text>
    {sub ? <Text style={styles.readoutSub}>{sub}</Text> : null}
  </View>;
}

export function Bars({ series, labels, height = 120 }: { series: number[]; labels: string[]; height?: number }) {
  const max = Math.max(1, ...series);
  return <View style={[styles.bars, { height: height + 22 }]} accessibilityLabel={series.map((v, i) => `${labels[i] ?? i}: ${v}`).join(', ')}>
    {series.map((v, i) => <View key={`${labels[i] ?? i}-${i}`} style={styles.barCol}>
      <View style={[styles.barTrack, { height }]}><View style={[styles.bar, { height: Math.max(2, Math.round((v / max) * height)) }]} /></View>
      <Text style={styles.barLabel} numberOfLines={1}>{labels[i] ?? ''}</Text>
    </View>)}
  </View>;
}

export function PermissionScreen({ permission, any, children }: { permission: string | string[]; any?: boolean; children: React.ReactNode }) {
  const { can } = useAuth();
  if (permitted(can, permission, any)) return <>{children}</>;
  return <Screen><RequirePermission permission={permission} any={any}>{null}</RequirePermission></Screen>;
}

const styles = StyleSheet.create({
  wrap: { borderBottomWidth: 1, borderBottomColor: colors.border, marginHorizontal: -space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg },
  title: { color: colors.text, fontSize: font.body, fontWeight: '600' },
  meta: { color: colors.muted, fontSize: font.small, marginTop: 2 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.md },
  noticeBody: { color: colors.muted, fontSize: font.small, lineHeight: 19 },
  readout: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.lg, flexGrow: 1, flexBasis: '46%' },
  readoutValue: { color: colors.text, fontSize: font.title, fontWeight: '700', letterSpacing: -0.5 },
  readoutSub: { color: colors.muted, fontSize: font.small, marginTop: 2 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  barCol: { flex: 1, maxWidth: 56, alignItems: 'center', gap: 4 },
  barTrack: { width: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', backgroundColor: colors.brand, borderRadius: radius.sm },
  barLabel: { color: colors.muted, fontSize: font.tiny },
});
