/* Small parts the administrative portal's core screens share (group admin-a), composed from the app's primitives and
   tokens only: the stack header with the bell, the portal's Readout queue card, its Bars chart drawn with views, the
   timeline row, a chip-row stand-in for its Select, a progress bar, a collapsible section, the portal's Field with its
   "Optional" tag (and a date field with it), its accent pill, and a record row whose extra lines are never clamped.
   Nothing here fetches. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack } from 'expo-router';
import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, Chip, Eyebrow, Field, Input } from '@/components/ui';
import { isIsoDate, RecordRow } from '@/components/workspace';
import { NotificationBell } from '@/components/workspaceShell';
import { colors, font, radius, space } from '@/theme';

/** The header of a plain admin screen (src/app/admin/…): the title and the workspace's bell, as every tab has. */
export function AdminHeader({ title }: { title: string }) {
  return <Stack.Screen options={{ title, headerRight: () => <NotificationBell /> }} />;
}

/** The portal's Readout queue card: an eyebrow, a large value, an optional unit; `hot` draws the brand border the
 *  web's `.queue.hot` has; pressing it opens the section it counts; `children` go under it in the same card (the
 *  record's progress sparkline, as the web's dense card holds its Spark). */
export function Readout({ eyebrow, value, unit, sub, hot, onPress, children }: { eyebrow: string; value: string | number; unit?: string; sub?: string; hot?: boolean; onPress?: () => void; children?: React.ReactNode }) {
  return <Pressable accessibilityRole={onPress ? 'link' : undefined} accessibilityLabel={`${eyebrow}: ${value}${unit ?? ''}`} onPress={onPress} disabled={!onPress} style={({ pressed }) => [{ flex: 1, minWidth: 140 }, pressed && { opacity: 0.85 }]}>
    <Card accent={hot} style={{ flex: 1 }}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}><Text style={styles.readout}>{String(value)}</Text>{unit ? <Text style={styles.unit}>{unit}</Text> : null}</View>
      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
      {children}
    </Card>
  </Pressable>;
}

/** The portal's Bars chart (ui/index.tsx Bars) as a row of views: the last bar in the brand colour, the others raised. */
export function Bars({ series, labels, height = 120 }: { series: number[]; labels: string[]; height?: number }) {
  const max = Math.max(1, ...series);
  return <View accessibilityRole="image" accessibilityLabel={`Bar chart: ${labels.map((l, i) => `${l} ${series[i]}`).join(', ')}`} style={{ gap: space.xs }}>
    <Text style={styles.axis}>{max}</Text>
    <View style={[styles.bars, { height }]}>
      {series.map((v, i) => <View key={`${labels[i]}-${i}`} style={styles.barCol}>
        <View style={[styles.bar, { height: Math.max(2, Math.round((v / max) * (height - 4))), backgroundColor: i === series.length - 1 ? colors.brand : colors.borderStrong }]} />
      </View>)}
    </View>
    <View style={styles.bars}>{labels.map((l, i) => <Text key={`${l}-${i}`} style={[styles.axis, styles.barCol, { textAlign: 'center' }]} numberOfLines={1}>{l}</Text>)}</View>
  </View>;
}

/** One row of the portal's timeline: a bold title, an optional detail after it, and a muted time line. */
export function TimelineItem({ title, detail, time, body }: { title: string; detail?: string | null; time: string; body?: string | null }) {
  return <View style={styles.tl}>
    <View style={styles.tlDot} />
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={styles.tlTitle}><Text style={{ fontWeight: '700' }}>{title}</Text>{detail ? ` · ${detail}` : ''}</Text>
      {body ? <Text style={styles.tlBody}>{body}</Text> : null}
      <Text style={styles.tlTime}>{time}</Text>
    </View>
  </View>;
}

export type ChoiceOption = { value: string; label: string };

/** A Field whose control is a row of chips: the app's answer to the portal's Select. */
export function Choice({ label, options, value, onChange, hint, error }: { label: string; options: ChoiceOption[]; value: string; onChange: (v: string) => void; hint?: string; error?: string }) {
  return <Field label={label} hint={hint} error={error}>
    <View style={styles.chips} accessibilityLabel={label}>{options.map((o) => <Chip key={o.value} selected={o.value === value} onPress={() => onChange(o.value)}>{o.label}</Chip>)}</View>
  </Field>;
}

/** The portal's .bp-progress bar: a brand fill over a raised track. */
export function ProgressBar({ pct }: { pct: number }) {
  return <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}><View style={[styles.fill, { width: `${Math.max(0, Math.min(100, pct))}%` }]} /></View>;
}

/** The portal's details/summary accordion (.bp-acc): a pressable summary line that shows its children. */
export function Collapsible({ title, children, openAtFirst = false }: { title: string; children: React.ReactNode; openAtFirst?: boolean }) {
  const [open, setOpen] = useState(openAtFirst);
  return <View>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((o) => !o)} style={styles.acc} hitSlop={6}>
      <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={16} color={colors.muted} /><Text style={styles.accText}>{title}</Text>
    </Pressable>
    {open ? <View style={{ marginTop: space.sm }}>{children}</View> : null}
  </View>;
}

/** The portal's Field (ui/index.tsx Field) with its "Optional" tag beside the label when `optional`, as the coach
 *  workspace draws it (components/coachWorkouts/parts OptField): the label, the control, then the error or the hint. */
export function FormField({ label, optional, hint, error, children }: { label: string; optional?: boolean; hint?: string; error?: string; children: React.ReactNode }) {
  return <View style={styles.field}>
    <View style={styles.labelRow}><Text style={styles.label}>{label}</Text>{optional ? <Text style={styles.optional}>Optional</Text> : null}</View>
    {children}
    {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
  </View>;
}

/** The shared DatePickerField (components/workspace) with the "Optional" tag: the same YYYY-MM-DD entry and the same
 *  check once the field is left. */
export function DateField({ label, value, onChange, optional, hint, error }: { label: string; value: string; onChange: (v: string) => void; optional?: boolean; hint?: string; error?: string }) {
  const [touched, setTouched] = useState(false);
  const own = value && !isIsoDate(value) ? 'Write the date as YYYY-MM-DD, like 2026-11-05.' : null;
  return <FormField label={label} optional={optional} hint={hint ?? 'YYYY-MM-DD'} error={error ?? (touched ? own ?? undefined : undefined)}>
    <Input value={value} onChangeText={(v) => onChange(v.replace(/[^\d-]/g, '').slice(0, 10))} onBlur={() => setTouched(true)} placeholder="YYYY-MM-DD" keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'} autoCapitalize="none" autoCorrect={false} maxLength={10} accessibilityLabel={label} />
  </FormField>;
}

/** The portal's accent pill (.bp-pill-accent: the accent text on the brand colour at low strength), for a package's
 *  promotional label. */
export function AccentPill({ children }: { children: string }) {
  return <View style={styles.accentPill}><View style={styles.accentDim} /><Text style={styles.accentPillText}>{children}</Text></View>;
}

/** A RecordRow with extra lines under it, inside the same row and never clamped: RecordRow keeps its meta to two lines
 *  (components/workspace), so a note, a reason or a date the web shows in its own column goes here in full. `line`
 *  false leaves the bottom rule to what follows (a row of actions). */
export function NotedRow({ notes, line = true, ...row }: React.ComponentProps<typeof RecordRow> & { notes?: Array<string | null | undefined | false>; line?: boolean }) {
  const lines = (notes ?? []).filter((l): l is string => typeof l === 'string' && l.trim() !== '');
  if (!lines.length) return <RecordRow {...row} style={[!line && styles.noLine, row.style]} />;
  return <View style={[styles.notedWrap, !line && styles.noLine]}>
    <RecordRow {...row} style={[styles.notedRow, row.style]} />
    <View style={[styles.notes, row.leading ? { paddingLeft: 36 + space.md } : null]}>{lines.map((l, i) => <Text key={i} style={styles.note} selectable>{l}</Text>)}</View>
  </View>;
}

/** A two-up row of fields, as the portal's `.row` of fields. */
export function TwoUp({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', gap: space.md }}>{React.Children.map(children, (c, i) => <View key={i} style={{ flex: 1, minWidth: 0 }}>{c}</View>)}</View>;
}

/** A code chip (the portal's <code> member id). */
export function Code({ children }: { children: string }) { return <Text style={styles.code} selectable>{children}</Text>; }

const styles = StyleSheet.create({
  readout: { color: colors.text, fontSize: font.title, fontWeight: '700', letterSpacing: -0.5 },
  unit: { color: colors.muted, fontSize: font.body, fontWeight: '600' },
  sub: { color: colors.muted, fontSize: font.small },
  axis: { color: colors.muted, fontSize: font.tiny },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  barCol: { flex: 1, justifyContent: 'flex-end', alignItems: 'stretch' },
  bar: { borderRadius: 3 },
  tl: { flexDirection: 'row', gap: space.sm, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  tlDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.borderStrong, marginTop: 7 },
  tlTitle: { color: colors.text, fontSize: font.small, lineHeight: 19 },
  tlBody: { color: colors.text, fontSize: font.small, lineHeight: 19, marginTop: 2 },
  tlTime: { color: colors.muted, fontSize: font.tiny, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.raised, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.brand },
  acc: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingVertical: space.xs },
  accText: { color: colors.accentText, fontSize: font.small, fontWeight: '600' },
  field: { marginBottom: space.lg },
  labelRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, marginBottom: space.xs },
  label: { color: colors.text, fontSize: font.small, fontWeight: '600' },
  optional: { color: colors.muted, fontSize: font.tiny },
  hint: { color: colors.muted, fontSize: font.small, marginTop: space.xs, lineHeight: 18 },
  error: { color: colors.errorText, fontSize: font.small, marginTop: space.xs },
  accentPill: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, overflow: 'hidden' },
  accentDim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.brand, opacity: 0.12 },
  accentPillText: { color: colors.accentText, fontSize: font.tiny, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  notedWrap: { borderBottomWidth: 1, borderBottomColor: colors.border, marginHorizontal: -space.lg, paddingHorizontal: space.lg },
  notedRow: { borderBottomWidth: 0, marginHorizontal: 0, paddingHorizontal: 0, paddingBottom: space.xs },
  noLine: { borderBottomWidth: 0 },
  notes: { paddingBottom: space.md, gap: 2 },
  note: { color: colors.muted, fontSize: font.small, lineHeight: 18 },
  code: { color: colors.text, fontSize: font.small, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }), backgroundColor: colors.raised, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm, alignSelf: 'flex-start' },
});
