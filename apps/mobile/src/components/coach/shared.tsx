/* Pieces every coach screen uses, built from the existing primitives (components/ui, components/workspace) and the
   tokens (theme): the portal's toast, card head, page head with its back link, a select that opens a sheet (the phone's
   answer to the portal's <select>), a readout, a sparkline, a progress bar, timeline rows and warning pills. Nothing
   here fetches. */
import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { Button, Eyebrow, Field, H2, Notice, Pill, Row } from '@/components/ui';
import { RecordRow, Sheet } from '@/components/workspace';
import { initials, pillTone } from '@/lib/coach/core/format';
import { colors, font, radius, space } from '@/theme';

/* ---------- toasts: 2.4 s for ok, 5 s for errors, as the portal (ui/index.tsx:13-17) ---------- */

export type Toast = { kind: 'ok' | 'error'; text: string };

/** A toast for the next screen that mounts (a new plan saved: the editor moves to the plan's own route). */
let pending: Toast | null = null;
export function setPendingToast(text: string, kind: 'ok' | 'error' = 'ok'): void { pending = { kind, text }; }
/** Take the waiting toast once. A plain function on purpose: the React Compiler (transform.reactCompiler) rewrote
 *  "const p = pending; pending = null; show(p.text)" inside the hook into a read of the cleared variable. */
function takePendingToast(): Toast | null { const p = pending; pending = null; return p; }

/** `resetKey`: the toast is cleared when it changes (the same screen showing another record). */
export function useToast(resetKey?: unknown): { toast: Toast | null; show: (text: string, kind?: 'ok' | 'error') => void; clear: () => void } {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ kind, text });
    timer.current = setTimeout(() => { timer.current = null; setToast(null); }, kind === 'ok' ? 2400 : 5000);
  }, []);
  const clear = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = null; setToast(null); }, []);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; const p = takePendingToast(); if (p) show(p.text, p.kind); return; }
    clear();
  }, [resetKey, show, clear]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return { toast, show, clear };
}

export function ToastView({ toast }: { toast: Toast | null }) {
  if (!toast) return null;
  return <Notice kind={toast.kind === 'ok' ? 'success' : 'error'}>{toast.text}</Notice>;
}

/** The same toast floating over the bottom of the screen, as the portal's toasts float, so it is seen from a long
 *  record scrolled down to the Notes form. Render it next to the screen's scroll view, not inside it. */
export function ToastFloat({ toast }: { toast: Toast | null }) {
  if (!toast) return null;
  return <View pointerEvents="none" style={styles.toastFloat} accessibilityLiveRegion="polite"><ToastView toast={toast} /></View>;
}

/** A small icon-only control with its spoken name (the portal's ✕ with aria-label "Remove task"). */
export function IconButton({ icon, label, onPress, disabled }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.iconBtn, pressed && { backgroundColor: colors.hover }, disabled && { opacity: 0.5 }]}>
    <Ionicons name={icon} size={18} color={colors.muted} />
  </Pressable>;
}

/* ---------- heads ---------- */

export function CardHead({ eyebrow, title, right }: { eyebrow?: string; title: string; right?: React.ReactNode }) {
  return <View style={styles.cardHead}>
    <View style={{ flex: 1, minWidth: 0 }}>{eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}<H2>{title}</H2></View>
    {right ? <View style={styles.cardHeadRight}>{right}</View> : null}
  </View>;
}

/** The portal's pageHead on a phone: a back link, the title, the sub-line and the actions under it. */
export function PageHead({ back, onBack, title, code, sub, children }: { back?: string; onBack?: () => void; title: string; code?: string | null; sub?: React.ReactNode; children?: React.ReactNode }) {
  return <View style={{ gap: space.xs }}>
    {back && onBack ? <Pressable accessibilityRole="link" onPress={onBack} hitSlop={6} style={{ alignSelf: 'flex-start' }}><Text style={styles.back}>{`← ${back}`}</Text></Pressable> : null}
    <Row><Text style={styles.h1}>{title}</Text>{code ? <Text style={styles.code} selectable>{code}</Text> : null}</Row>
    {sub ? <Text style={styles.sub}>{sub}</Text> : null}
    {children ? <Row style={{ marginTop: space.xs }}>{children}</Row> : null}
  </View>;
}

/** A link in text, in the brand's accent, for row links the portal renders as <a>. */
export function LinkText({ children, onPress, muted, small, style }: { children: React.ReactNode; onPress: () => void; muted?: boolean; small?: boolean; style?: StyleProp<ViewStyle> }) {
  return <Pressable accessibilityRole="link" onPress={onPress} hitSlop={4} style={[{ alignSelf: 'flex-start' }, style]}><Text style={[styles.link, muted && { color: colors.muted }, small && { fontSize: font.small }]}>{children}</Text></Pressable>;
}

export function Muted({ children, small = true, style }: { children: React.ReactNode; small?: boolean; style?: object }) { return <Text style={[styles.muted, !small && { fontSize: font.body, lineHeight: 21 }, style]}>{children}</Text>; }
export function Small({ children, style }: { children: React.ReactNode; style?: object }) { return <Text style={[styles.small, style]}>{children}</Text>; }
export function Bold({ children, style }: { children: React.ReactNode; style?: object }) { return <Text style={[styles.bold, style]}>{children}</Text>; }
export function Code({ children }: { children: React.ReactNode }) { return <Text style={styles.code} selectable>{children}</Text>; }

/** A status pill in the portal's tone for that status. */
export function StatusPill({ status, children }: { status?: string | null; children?: React.ReactNode }) {
  const text = children ?? (status ? status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '—');
  return <Pill tone={pillTone(status)}>{text}</Pill>;
}

export function WarnPills({ items }: { items?: string[] | null }) {
  if (!items?.length) return null;
  return <Row style={{ marginTop: space.xs }}>{items.map((f, i) => <Pill key={`${f}-${i}`} tone="warning">{f}</Pill>)}</Row>;
}

export function Avatar({ name, size = 40 }: { name?: string | null; size?: number }) {
  return <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]} accessibilityElementsHidden><Text style={[styles.avatarText, { fontSize: size * 0.36 }]}>{initials(name)}</Text></View>;
}

/* ---------- a select that opens a sheet ---------- */

export type PickerOption = { value: string; label: string; detail?: string; disabled?: boolean };

export function PickerField({ label, value, options, onChange, placeholder = 'Choose', hint, error, disabled, accessibilityLabel }: { label: string; value: string; options: PickerOption[]; onChange: (v: string) => void; placeholder?: string; hint?: string; error?: string; disabled?: boolean; accessibilityLabel?: string }) {
  const [open, setOpen] = useState(false);
  const chosen = options.find((o) => o.value === value);
  return <Field label={label} hint={hint} error={error}>
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={() => setOpen(true)} style={[styles.select, disabled && { opacity: 0.5 }]}>
      <Text style={[styles.selectText, !chosen && { color: colors.disabled }]} numberOfLines={1}>{chosen ? chosen.label : placeholder}</Text>
      <Ionicons name="chevron-down" size={18} color={colors.muted} />
    </Pressable>
    <Sheet open={open} onClose={() => setOpen(false)} title={label}>
      {options.length ? options.map((o) => <RecordRow key={o.value || '__empty'} title={o.label} meta={o.detail} selected={o.value === value} onPress={o.disabled ? undefined : () => { onChange(o.value); setOpen(false); }} right={o.value === value ? <Ionicons name="checkmark" size={18} color={colors.accentText} /> : undefined} />) : <Muted>Nothing to choose from.</Muted>}
    </Sheet>
  </Field>;
}

/** A multi-line input in the portal's Textarea role. */
export function TextArea(props: TextInputProps & { rows?: number }) {
  const { rows = 4, style, ...rest } = props;
  return <TextInput placeholderTextColor={colors.disabled} multiline numberOfLines={rows} textAlignVertical="top" {...rest} style={[styles.textarea, { minHeight: 24 * rows + 24 }, style]} />;
}

/* ---------- readouts, bars, timelines ---------- */

export function Readout({ eyebrow, value, unit, sub, onPress, hot }: { eyebrow: string; value: React.ReactNode; unit?: string; sub?: string; onPress?: () => void; hot?: boolean }) {
  const body = <>
    <Eyebrow>{eyebrow}</Eyebrow>
    <Row style={{ alignItems: 'baseline', gap: space.xs }}><Text style={[styles.readoutValue, hot && { color: colors.accentText }]}>{value}</Text>{unit ? <Text style={styles.readoutUnit}>{unit}</Text> : null}</Row>
    {sub ? <Muted>{sub}</Muted> : null}
  </>;
  if (!onPress) return <View style={[styles.readout, hot && { borderColor: colors.brand }]}>{body}</View>;
  return <Pressable accessibilityRole="link" accessibilityLabel={`${eyebrow}: ${typeof value === 'number' || typeof value === 'string' ? String(value) : ''}`} onPress={onPress} style={({ pressed }) => [styles.readout, hot && { borderColor: colors.brand }, pressed && { backgroundColor: colors.hover }]}>{body}</Pressable>;
}

export function ProgressBar({ pct, style }: { pct: number | null | undefined; style?: StyleProp<ViewStyle> }) {
  const w = Math.max(0, Math.min(100, pct ?? 0));
  return <View style={[styles.bar, style]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: w }}><View style={[styles.barFill, { width: `${w}%` }]} /></View>;
}

/** A small sparkline from a series of numbers (bars, no chart library). */
export function Spark({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const max = Math.max(...points), min = Math.min(...points);
  const span = max - min || 1;
  return <View style={styles.spark} accessibilityLabel={`${points.length} values`}>{points.slice(-24).map((p, i) => <View key={i} style={[styles.sparkBar, { height: 6 + Math.round(((p - min) / span) * 22) }]} />)}</View>;
}

export function TimelineItem({ title, meta, time, done, body, right }: { title: React.ReactNode; meta?: React.ReactNode; time?: string; done?: boolean; body?: React.ReactNode; right?: React.ReactNode }) {
  return <View style={styles.timeline}>
    <View style={[styles.dot, done && { backgroundColor: colors.brand }]} />
    <View style={{ flex: 1, minWidth: 0 }}>
      <Row between><View style={{ flex: 1, minWidth: 0 }}><Text style={styles.bold}>{title}</Text>{meta ? <Text style={styles.small}>{meta}</Text> : null}</View>{right}</Row>
      {body ? <View style={{ marginTop: 2 }}>{typeof body === 'string' ? <Text style={styles.p}>{body}</Text> : body}</View> : null}
      {time ? <Text style={styles.time}>{time}</Text> : null}
    </View>
  </View>;
}

/** A tile inside a card (the portal's .bp-tile). */
export function Tile({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) { return <View style={[styles.tile, style]}>{children}</View>; }

/** A small confirm sheet (the portal's ConfirmDialog): "Not now" and the confirm label, with an optional note field. */
export function ConfirmSheet({ open, onClose, title, body, confirmLabel = 'Confirm', destructive, note, onConfirm, busy, error }: { open: boolean; onClose: () => void; title: string; body?: string; confirmLabel?: string; destructive?: boolean; note?: string; onConfirm: (note: string) => void | Promise<void>; busy?: boolean; error?: string | null }) {
  const [text, setText] = useState('');
  useEffect(() => { if (!open) setText(''); }, [open]);
  return <Sheet open={open} onClose={onClose} title={title} footer={<Row><Button title="Not now" variant="secondary" onPress={onClose} disabled={busy} style={{ flex: 1 }} /><Button title={confirmLabel} variant={destructive ? 'danger' : 'primary'} onPress={() => { void onConfirm(text.trim()); }} busy={busy} style={{ flex: 1 }} /></Row>}>
    {body ? <Muted small={false}>{body}</Muted> : null}
    {note ? <Field label={note}><TextArea rows={2} value={text} onChangeText={setText} /></Field> : null}
    {error ? <Notice kind="error">{error}</Notice> : null}
  </Sheet>;
}

const styles = StyleSheet.create({
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.md },
  cardHeadRight: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap', justifyContent: 'flex-end', flexShrink: 1, maxWidth: '58%' },
  back: { color: colors.muted, fontSize: font.small },
  h1: { color: colors.text, fontSize: font.title, fontWeight: '700', letterSpacing: -0.5, flexShrink: 1 },
  sub: { color: colors.muted, fontSize: font.body, lineHeight: 21 },
  code: { color: colors.text, fontSize: font.small, fontFamily: 'monospace', backgroundColor: colors.raised, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm, overflow: 'hidden' },
  link: { color: colors.accentText, fontSize: font.body, fontWeight: '600' },
  muted: { color: colors.muted, fontSize: font.small, lineHeight: 18 },
  small: { color: colors.muted, fontSize: font.small, lineHeight: 18 },
  bold: { color: colors.text, fontSize: font.body, fontWeight: '600' },
  p: { color: colors.text, fontSize: font.body, lineHeight: 21 },
  time: { color: colors.disabled, fontSize: font.tiny, marginTop: 2 },
  avatar: { backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.borderStrong },
  avatarText: { color: colors.text, fontWeight: '700' },
  select: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, backgroundColor: colors.base, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 12, minHeight: 46 },
  selectText: { color: colors.text, fontSize: font.body, flex: 1 },
  textarea: { backgroundColor: colors.base, color: colors.text, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 12, fontSize: font.body, lineHeight: 21 },
  readout: { flex: 1, minWidth: 140, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.md, gap: 2 },
  readoutValue: { color: colors.text, fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  readoutUnit: { color: colors.muted, fontSize: font.small },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.raised, overflow: 'hidden' },
  barFill: { height: 6, backgroundColor: colors.brand },
  spark: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 30, marginTop: space.sm },
  sparkBar: { flex: 1, maxWidth: 10, backgroundColor: colors.borderStrong, borderRadius: 2 },
  timeline: { flexDirection: 'row', gap: space.sm, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.borderStrong, marginTop: 7 },
  tile: { backgroundColor: colors.base, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: space.md, gap: space.sm },
  toastFloat: { position: 'absolute', left: space.lg, right: space.lg, bottom: space.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.raised, shadowColor: colors.canvas, shadowOpacity: 0.6, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  iconBtn: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
