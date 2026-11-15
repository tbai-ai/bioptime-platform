/* Shared pieces for the data-heavy coach and admin screens: a phone's answer to the portal's tables, filters, dialogs and
   pickers, built from the existing tokens (theme.ts) and primitives (components/ui.tsx). Dark theme only, like the
   rest; no new colours. Nothing here fetches: screens pass what they loaded.

   SearchBar        { value, onChangeText, placeholder?, onSubmit?, autoFocus? }     a search field with a clear button
   FilterChips      { options: {value,label,count?}[], value, onChange, multiple? }    one row of chips that scrolls sideways;
                                                                                     `value` is a string, or string[] with `multiple`
   SegmentTabs      { items: {id,label,count?}[], value, onChange }                   horizontal scrollable tabs with an active
                                                                                     indicator (client records); the active tab scrolls into view
   RecordList       { children, title?, right? }                                      a bordered list standing in for a table
   RecordRow        { title, meta?, pills?, right?, onPress?, leading?, selected? }   one record: title, meta line, pills, chevron when pressable
   KeyValue         { rows: {label,value,mono?}[] | [label,value][] }                 a key-value table for a record's details
   Sheet            { open, onClose, title, children, footer? }                       a bottom sheet (forms, confirmations)
   ReasonDialog     { open, title, body?, confirmLabel?, destructive?, onConfirm(reason), onClose, minLength?, busy?, error? }
                                                                                     an action that needs a written reason (most admin actions)
   DatePickerField  { label, value 'YYYY-MM-DD', onChange, hint?, error?, min?, max? } a validated date field (the community picker does
                                                                                     not run on the web; this one behaves the same everywhere)
   TimePickerField  { label, value 'HH:MM', onChange, hint?, error? }                 a validated 24-hour time field
   Badge            { count, tone? }                                                  a small count for tabs and navigation; nothing for 0
   SectionHeader    { title, sub?, right? }                                           an eyebrow with an optional action on the right
   EmptyState       { title, body?, action?, icon? }                                  Empty with an optional action button
   Paginator        { page, pageSize, total?, hasMore?, onMore, loading? }            "Showing n of m" and a Load more button
   isIsoDate / isClockTime                                                            the validators the two fields use */
import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Chip, Empty, Eyebrow, Field, Input, Notice, P, Pill } from './ui';
import { colors, font, radius, space } from '../theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
const icon = (name: string): IconName => name as IconName;

/* ---------- search and filters ---------- */

export function SearchBar({ value, onChangeText, placeholder = 'Search', onSubmit, autoFocus, style }: { value: string; onChangeText: (v: string) => void; placeholder?: string; onSubmit?: () => void; autoFocus?: boolean; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.search, style]}>
    <Ionicons name="search-outline" size={18} color={colors.muted} />
    <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.disabled} autoFocus={autoFocus} autoCapitalize="none" autoCorrect={false} returnKeyType="search" onSubmitEditing={onSubmit} accessibilityLabel={placeholder} style={styles.searchInput} />
    {value ? <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => onChangeText('')} hitSlop={8}><Ionicons name="close-circle" size={18} color={colors.muted} /></Pressable> : null}
  </View>;
}

export type FilterOption = { value: string; label: string; count?: number };

export function FilterChips({ options, value, onChange, multiple, style }: { options: FilterOption[]; value: string | string[]; onChange: (v: string | string[]) => void; multiple?: boolean; style?: StyleProp<ViewStyle> }) {
  const selected = new Set(([] as string[]).concat(value));
  const press = (v: string) => {
    if (!multiple) { onChange(v); return; }
    const next = new Set(selected);
    if (next.has(v)) next.delete(v); else next.add(v);
    onChange([...next]);
  };
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} style={style} keyboardShouldPersistTaps="handled">
    {options.map((o) => <Chip key={o.value} selected={selected.has(o.value)} onPress={() => press(o.value)}>{o.count !== undefined ? `${o.label} · ${o.count}` : o.label}</Chip>)}
  </ScrollView>;
}

/* ---------- segment tabs ---------- */

export type SegmentItem = { id: string; label: string; count?: number };

export function SegmentTabs({ items, value, onChange, style }: { items: SegmentItem[]; value: string; onChange: (id: string) => void; style?: StyleProp<ViewStyle> }) {
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const xs = useRef<Record<string, number>>({});
  useEffect(() => { const x = xs.current[value]; if (x !== undefined) scroll.current?.scrollTo({ x: Math.max(0, x - space.xl), animated: true }); }, [value]);
  return <View style={[styles.segments, style]}>
    <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      {items.map((it) => {
        const active = it.id === value;
        return <Pressable key={it.id} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => onChange(it.id)} onLayout={(e) => { xs.current[it.id] = e.nativeEvent.layout.x; }} style={styles.segment}>
          <View style={styles.segmentLabelRow}><Text style={[styles.segmentLabel, active && { color: colors.text }]}>{it.label}</Text>{it.count ? <Badge count={it.count} /> : null}</View>
          <View style={[styles.segmentBar, active && { backgroundColor: colors.brand }]} />
        </Pressable>;
      })}
    </ScrollView>
  </View>;
}

/* ---------- records ---------- */

export function RecordList({ children, title, right, style }: { children: React.ReactNode; title?: string; right?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.list, style]}>
    {title ? <View style={styles.listHead}><Eyebrow>{title}</Eyebrow>{right}</View> : null}
    {children}
  </View>;
}

export type RecordPill = { label: string; tone?: React.ComponentProps<typeof Pill>['tone'] };

export function RecordRow({ title, meta, pills, right, onPress, leading, selected, style }: { title: string; meta?: string; pills?: RecordPill[]; right?: React.ReactNode; onPress?: () => void; leading?: React.ReactNode; selected?: boolean; style?: StyleProp<ViewStyle> }) {
  return <Pressable accessibilityRole={onPress ? 'button' : undefined} onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.row, selected && { backgroundColor: colors.raised }, pressed && { backgroundColor: colors.hover }, style]}>
    {leading ? <View style={styles.leading}>{leading}</View> : null}
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={styles.rowTitle} numberOfLines={2}>{title}</Text>
      {meta ? <Text style={styles.rowMeta} numberOfLines={2}>{meta}</Text> : null}
      {pills?.length ? <View style={styles.pillRow}>{pills.map((p, i) => <Pill key={`${p.label}-${i}`} tone={p.tone}>{p.label}</Pill>)}</View> : null}
    </View>
    {right}
    {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.muted} /> : null}
  </Pressable>;
}

export type KeyValueRow = { label: string; value: React.ReactNode; mono?: boolean } | [string, React.ReactNode];

export function KeyValue({ rows, style }: { rows: KeyValueRow[]; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.kv, style]}>
    {rows.map((r, i) => {
      const row = Array.isArray(r) ? { label: r[0], value: r[1], mono: false } : r;
      return <View key={`${row.label}-${i}`} style={[styles.kvRow, i === rows.length - 1 && { borderBottomWidth: 0 }]}>
        <Text style={styles.kvKey}>{row.label}</Text>
        {typeof row.value === 'string' || typeof row.value === 'number' ? <Text style={[styles.kvVal, row.mono && styles.mono]} selectable>{String(row.value)}</Text> : <View style={{ flex: 1, alignItems: 'flex-end' }}>{row.value ?? <Text style={styles.kvVal}>—</Text>}</View>}
      </View>;
    })}
  </View>;
}

/* ---------- sheet and dialogs ---------- */

export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetRoot}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.scrim} />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space.lg) }]} accessibilityViewIsModal>
        <View style={styles.grabber} />
        <View style={styles.sheetHead}><Text style={styles.sheetTitle} accessibilityRole="header">{title}</Text><Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={8}><Ionicons name="close-circle" size={24} color={colors.muted} /></Pressable></View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space.md }} style={{ flexGrow: 0 }}>{children}</ScrollView>
        {footer ? <View style={styles.sheetFoot}>{footer}</View> : null}
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

export function ReasonDialog({ open, title, body, confirmLabel = 'Confirm', destructive, onConfirm, onClose, minLength = 3, busy, error, placeholder = 'What you know, and why this is right' }: { open: boolean; title: string; body?: string; confirmLabel?: string; destructive?: boolean; onConfirm: (reason: string) => void | Promise<void>; onClose: () => void; minLength?: number; busy?: boolean; error?: string | null; placeholder?: string }) {
  const [reason, setReason] = useState('');
  useEffect(() => { if (!open) setReason(''); }, [open]);
  const ok = reason.trim().length >= minLength;
  return <Sheet open={open} onClose={onClose} title={title} footer={<View style={{ flexDirection: 'row', gap: space.sm }}><Button title="Keep as is" variant="secondary" onPress={onClose} disabled={busy} style={{ flex: 1 }} /><Button title={confirmLabel} variant={destructive ? 'danger' : 'primary'} onPress={() => { if (ok) void onConfirm(reason.trim()); }} disabled={!ok} busy={busy} style={{ flex: 1 }} /></View>}>
    {body ? <P muted>{body}</P> : null}
    <Field label="Reason (recorded in the audit log)" hint={reason.trim() && !ok ? 'Say why, in a few words.' : undefined}><Input value={reason} onChangeText={setReason} placeholder={placeholder} multiline numberOfLines={3} style={{ minHeight: 72, textAlignVertical: 'top' }} autoFocus accessibilityLabel="Reason (recorded in the audit log)" /></Field>
    {error ? <Notice kind="error">{error}</Notice> : null}
  </Sheet>;
}

/* ---------- date and time ---------- */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** A real calendar date written YYYY-MM-DD. */
export function isIsoDate(v: string): boolean {
  const m = ISO_DATE.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}
/** A 24-hour clock time written HH:MM. */
export function isClockTime(v: string): boolean { return CLOCK.test(v); }

export function DatePickerField({ label, value, onChange, hint, error, min, max }: { label: string; value: string; onChange: (v: string) => void; hint?: string; error?: string; min?: string; max?: string }) {
  const [touched, setTouched] = useState(false);
  const own = !value ? null : !isIsoDate(value) ? 'Write the date as YYYY-MM-DD, like 2026-11-05.' : min && value < min ? `Not before ${min}.` : max && value > max ? `Not after ${max}.` : null;
  return <Field label={label} hint={hint ?? 'YYYY-MM-DD'} error={error ?? (touched ? own ?? undefined : undefined)}>
    <Input value={value} onChangeText={(v) => onChange(v.replace(/[^\d-]/g, '').slice(0, 10))} onBlur={() => setTouched(true)} placeholder="YYYY-MM-DD" keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'} autoCapitalize="none" autoCorrect={false} maxLength={10} accessibilityLabel={label} />
  </Field>;
}

export function TimePickerField({ label, value, onChange, hint, error }: { label: string; value: string; onChange: (v: string) => void; hint?: string; error?: string }) {
  const [touched, setTouched] = useState(false);
  const own = value && !isClockTime(value) ? 'Write the time as HH:MM on the 24-hour clock, like 14:30.' : null;
  return <Field label={label} hint={hint ?? 'HH:MM, 24-hour clock'} error={error ?? (touched ? own ?? undefined : undefined)}>
    <Input value={value} onChangeText={(v) => onChange(v.replace(/[^\d:]/g, '').slice(0, 5))} onBlur={() => setTouched(true)} placeholder="HH:MM" keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'} autoCapitalize="none" autoCorrect={false} maxLength={5} accessibilityLabel={label} />
  </Field>;
}

/* ---------- small parts ---------- */

export function Badge({ count, tone = 'brand', style }: { count?: number | null; tone?: 'brand' | 'muted'; style?: StyleProp<ViewStyle> }) {
  if (!count || count <= 0) return null;
  return <View style={[styles.badge, tone === 'muted' && { backgroundColor: colors.borderStrong }, style]} accessibilityLabel={`${count}`}><Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text></View>;
}

export function SectionHeader({ title, sub, right, style }: { title: string; sub?: string; right?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.sectionHead, style]}>
    <View style={{ flex: 1, minWidth: 0 }}><Eyebrow>{title}</Eyebrow>{sub ? <Text style={styles.sectionSub}>{sub}</Text> : null}</View>
    {right}
  </View>;
}

export function EmptyState({ title, body, action, icon: name }: { title: string; body?: string; action?: { title: string; onPress: () => void }; icon?: string }) {
  return <View style={{ alignItems: 'center' }}>
    {name ? <Ionicons name={icon(name)} size={28} color={colors.disabled} style={{ marginTop: space.lg }} /> : null}
    <Empty title={title} body={body} />
    {action ? <Button title={action.title} variant="secondary" small onPress={action.onPress} style={{ marginBottom: space.lg }} /> : null}
  </View>;
}

export function Paginator({ page, pageSize, total, hasMore, onMore, loading }: { page: number; pageSize: number; total?: number; hasMore?: boolean; onMore: () => void; loading?: boolean }) {
  const shown = total !== undefined ? Math.min(total, page * pageSize) : page * pageSize;
  const more = hasMore ?? (total !== undefined ? shown < total : true);
  if (!more && total === undefined) return null;
  return <View style={styles.paginator}>
    <Text style={styles.paginatorText}>{total !== undefined ? `Showing ${shown} of ${total}` : `Showing ${shown}`}</Text>
    {more ? <Button title="Load more" variant="secondary" small onPress={onMore} busy={loading} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.base, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, paddingHorizontal: space.md, minHeight: 46 },
  searchInput: { flex: 1, color: colors.text, fontSize: font.body, paddingVertical: 10 },
  chipRow: { flexDirection: 'row', gap: space.sm, paddingVertical: space.xs },
  segments: { borderBottomWidth: 1, borderBottomColor: colors.border },
  segment: { paddingHorizontal: space.md, paddingTop: space.sm },
  segmentLabelRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingBottom: space.sm },
  segmentLabel: { color: colors.muted, fontSize: font.small, fontWeight: '600' },
  segmentBar: { height: 2, borderRadius: 1, backgroundColor: 'transparent' },
  list: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: space.lg, overflow: 'hidden' },
  listHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: colors.border, marginHorizontal: -space.lg, paddingHorizontal: space.lg },
  leading: { width: 36, alignItems: 'center' },
  rowTitle: { color: colors.text, fontSize: font.body, fontWeight: '600' },
  rowMeta: { color: colors.muted, fontSize: font.small, marginTop: 2 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },
  kv: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: space.lg },
  kvRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space.md, paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  kvKey: { color: colors.muted, fontSize: font.small, width: 120 },
  kvVal: { color: colors.text, fontSize: font.small, flex: 1, textAlign: 'right' },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) },
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(11, 17, 32, 0.72)' },
  sheet: { backgroundColor: colors.base, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: space.lg, paddingTop: space.sm, maxHeight: '88%', gap: space.md },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginBottom: space.xs },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  sheetTitle: { color: colors.text, fontSize: font.h2, fontWeight: '700', flex: 1 },
  sheetFoot: { paddingTop: space.sm },
  badge: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: radius.pill, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: colors.onAccent, fontSize: font.tiny, fontWeight: '700' },
  sectionHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.md, marginTop: space.sm },
  sectionSub: { color: colors.muted, fontSize: font.small },
  paginator: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, paddingVertical: space.sm },
  paginatorText: { color: colors.muted, fontSize: font.small },
});
