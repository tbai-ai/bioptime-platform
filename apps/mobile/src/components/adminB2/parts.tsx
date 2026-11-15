/* Small pieces the Integrations, LabStack, Users, Settings, Modules, Website content and Theme screens share (nothing
   here fetches; built from the tokens and primitives, no new colours):
   useToast        → [node, show(text, kind?)]   the portal's toast as a Notice near the top of the screen (2.4 s ok, 5 s error)
   ReasonSheet     { open, title, body?, confirmLabel, destructive?, onConfirm(reason), onClose, busy?, error?, children,
                     cancelLabel?, placeholder?, gate? }
                   the web's reason dialogs with the web's copy: the ReasonDialog ("Keep as is", "Say why, in a few
                   words." under 3 characters) or, with gate 'disabled', a page's own Dialog (confirm disabled under 3
                   characters, its own cancel label); `children` above the reason (an audience picker, a setting field)
   Toggle          { value, onChange, label?, disabled? }   a Switch in the app's colours (notifications.tsx idiom)
   ChoiceChips     { options, value, onChange }             a Select as a row of Chips
   MonoText        { children }                             a code span (keys, variables, addresses)
   Swatch          { colour, size? }                        a colour square with a hairline (Theme)
   RightPill       { tone?, children }                      a Pill at the end of a key-value row
   DetailRow       { title, lines, pills?, onPress?, leading?, children? }  a RecordRow (components/workspace) whose meta
                   lines are never cut: the web's table cells hold several lines (a booking's test, deadline, vendor status
                   and flag; a block's summary and state), and RecordRow keeps two; `children` after the lines (a status mark)
   LabStatusMark   { status, children? }                    the web's bp-labstatus: the laboratory status as a small shape
                   in the status colour (ring confirmed, dot scheduled, square collected, pulsing square processing, dot
                   results ready, ringed dot completed, grey dot cancelled) before its words
   openOutside(href)                                        a link outside the app: a new browser tab on the web build (the
                   app's own tab keeps its in-memory session), the system browser on a phone */
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Linking from 'expo-linking';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Switch, Text, View, type ViewStyle } from 'react-native';
import { Button, Chip, Field, Input, Notice, P, Pill, Row } from '../ui';
import { Sheet, type RecordPill } from '../workspace';
import { label as words } from '../../lib/format';
import { useReduceMotion } from '../../motion/useReduceMotion';
import { colors, font, radius, space } from '../../theme';

export type ToastKind = 'success' | 'error' | 'info';

export function useToast(): [React.ReactNode, (text: string, kind?: ToastKind) => void] {
  const [toast, setToast] = useState<{ text: string; kind: ToastKind; n: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const show = useCallback((text: string, kind: ToastKind = 'success') => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ text, kind, n: Date.now() });
    timer.current = setTimeout(() => setToast(null), kind === 'error' ? 5000 : 2400);
  }, []);
  const node = toast ? <Notice kind={toast.kind === 'success' ? 'success' : toast.kind}>{toast.text}</Notice> : null;
  return [node, show];
}

/** The web's reason dialogs as a sheet, with `children` above the reason (the web ReasonDialog's `extra`). Field label
 *  "Reason (recorded in the audit log)" in every case. Two behaviours, as on the web:
 *  gate 'error' (default): the web ReasonDialog (ui/index.tsx): "Keep as is", placeholder "What you know, and why this
 *    is right", the confirm answers "Say why, in a few words." under 3 characters;
 *  gate 'disabled': the web pages' own Dialog with a reason field (Users, Theme, the content publish step): the confirm
 *    stays disabled under 3 characters; those pages pass their own cancelLabel ("Cancel", "Not yet") and placeholder. */
export function ReasonSheet({ open, title, body, confirmLabel, destructive, onConfirm, onClose, busy, error, children, disabled, cancelLabel = 'Keep as is', placeholder = 'What you know, and why this is right', gate = 'error' }: { open: boolean; title: string; body?: string; confirmLabel: string; destructive?: boolean; onConfirm: (reason: string) => void | Promise<void>; onClose: () => void; busy?: boolean; error?: string | null; children?: React.ReactNode; disabled?: boolean; cancelLabel?: string; placeholder?: string; gate?: 'error' | 'disabled' }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { if (open) { setReason(''); setErr(''); } }, [open]);
  const short = reason.trim().length < 3;
  const go = () => { if (short) { if (gate === 'error') setErr('Say why, in a few words.'); return; } setErr(''); void onConfirm(reason.trim()); };
  return <Sheet open={open} onClose={onClose} title={title} footer={<View style={{ flexDirection: 'row', gap: space.sm }}><Button title={cancelLabel} variant="secondary" onPress={onClose} disabled={busy} style={{ flex: 1 }} /><Button title={confirmLabel} variant={destructive ? 'danger' : 'primary'} onPress={go} busy={busy} disabled={disabled || (gate === 'disabled' && short)} style={{ flex: 1 }} /></View>}>
    {body ? <P muted small>{body}</P> : null}
    {children}
    <Field label="Reason (recorded in the audit log)" error={err || undefined}><Input value={reason} onChangeText={(v) => { setReason(v); if (err) setErr(''); }} placeholder={placeholder || undefined} multiline numberOfLines={3} style={{ minHeight: 72, textAlignVertical: 'top' }} accessibilityLabel="Reason (recorded in the audit log)" /></Field>
    {error ? <Notice kind="error">{error}</Notice> : null}
  </Sheet>;
}

export function Toggle({ value, onChange, label, disabled }: { value: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  // react-native-web draws a switched-on thumb in its own default colour unless told (activeThumbColor is web-only)
  const webThumb = (Platform.OS === 'web' ? { activeThumbColor: colors.onAccent } : {}) as object;
  return <Switch value={value} onValueChange={onChange} disabled={disabled} accessibilityLabel={label} accessibilityRole="switch" trackColor={{ true: colors.brand, false: colors.borderStrong }} thumbColor={colors.onAccent} {...webThumb} />;
}

export function ChoiceChips<T extends string>({ options, value, onChange }: { options: Array<{ value: T; label: string }>; value: T; onChange: (v: T) => void }) {
  return <Row>{options.map((o) => <Chip key={o.value} selected={o.value === value} onPress={() => onChange(o.value)}>{o.label}</Chip>)}</Row>;
}

export function MonoText({ children, small }: { children: React.ReactNode; small?: boolean }) {
  return <Text style={[styles.mono, small && { fontSize: font.tiny }]} selectable>{children}</Text>;
}

export function Swatch({ colour, size = 28 }: { colour: string; size?: number }) {
  return <View accessibilityLabel={`Colour ${colour}`} style={{ width: size, height: size, borderRadius: radius.sm, backgroundColor: colour, borderWidth: 1, borderColor: colors.borderStrong }} />;
}

/** A Pill at the end of a key-value row (Pill keeps itself to the start of its column). */
export function RightPill({ tone, children }: { tone?: React.ComponentProps<typeof Pill>['tone']; children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}><Pill tone={tone}>{children}</Pill></View>;
}

export function DetailRow({ title, lines, pills, onPress, leading, children }: { title: string; lines: Array<string | null | undefined | false>; pills?: RecordPill[]; onPress?: () => void; leading?: React.ReactNode; children?: React.ReactNode }) {
  const shown = lines.filter((l): l is string => !!l);
  return <Pressable accessibilityRole={onPress ? 'button' : undefined} onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.hover }]}>
    {leading ? <View style={styles.leading}>{leading}</View> : null}
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={styles.rowTitle}>{title}</Text>
      {shown.map((l, i) => <Text key={i} style={styles.rowMeta}>{l}</Text>)}
      {children}
      {pills?.length ? <View style={styles.pillRow}>{pills.map((p, i) => <Pill key={`${p.label}-${i}`} tone={p.tone}>{p.label}</Pill>)}</View> : null}
    </View>
    {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.muted} /> : null}
  </Pressable>;
}

/** The laboratory status as the web draws it (packages/design-system components.css .bp-labstatus): a 10-point shape in
 *  the status colour, then the status in words. Processing pulses (opacity 1 → .35 → 1 over 1.4 s) and holds still under reduced
 *  motion, as the web stops the animation there. */
export function LabStatusMark({ status, children, style }: { status: string; children?: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.lab, style]}>
    <LabGlyph status={status} />
    <Text style={styles.labText}>{children ?? words(status)}</Text>
  </View>;
}

function LabGlyph({ status }: { status: string }) {
  const reduce = useReduceMotion();
  const pulse = useRef(new Animated.Value(1)).current;
  const pulsing = status === 'processing' && !reduce;
  useEffect(() => {
    if (!pulsing) { pulse.setValue(1); return; }
    const half = { duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: Platform.OS !== 'web' };
    const loop = Animated.loop(Animated.sequence([Animated.timing(pulse, { toValue: 0.35, ...half }), Animated.timing(pulse, { toValue: 1, ...half })]));
    loop.start();
    return () => loop.stop();
  }, [pulsing, pulse]);
  const box: ViewStyle = { width: 10, height: 10 };
  switch (status) {
    case 'confirmed': return <View style={[box, { borderRadius: 5, borderWidth: 2, borderColor: colors.info }]} />;
    case 'scheduled': return <View style={[box, { borderRadius: 5, backgroundColor: colors.info }]} />;
    case 'sample_collected': return <View style={[box, { borderRadius: 2, backgroundColor: colors.warning }]} />;
    case 'processing': return <Animated.View style={[box, { borderRadius: 2, backgroundColor: colors.warning, opacity: pulse }]} />;
    case 'results_ready': return <View style={[box, { borderRadius: 5, backgroundColor: colors.success }]} />;
    // a 6-point dot with a 2-point ring 2 points out, in the space of the others
    case 'completed': return <View style={[box, { alignItems: 'center', justifyContent: 'center' }]}>
      <View style={{ position: 'absolute', top: -2, left: -2, width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: colors.success }} />
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success }} />
    </View>;
    case 'cancelled': return <View style={[box, { borderRadius: 5, backgroundColor: colors.disabled }]} />;
    default: return <View style={box} />;
  }
}

/** A link outside the app. On the web build a new tab (window.open), so the app's own tab, whose session lives in
 *  memory, is never replaced; on a phone the system browser, never a web view inside the app. */
export function openOutside(href: string): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.open(href, '_blank', 'noopener,noreferrer');
    return;
  }
  Linking.openURL(href).catch(() => { /* no browser on this device */ });
}

/** The monospace face the workspace components use (workspace.tsx KeyValue mono). */
export const MONO_FONT = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

const styles = StyleSheet.create({
  mono: { color: colors.muted, fontSize: font.small, fontFamily: MONO_FONT },
  // the RecordRow look (components/workspace.tsx), inside a RecordList
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: colors.border, marginHorizontal: -space.lg, paddingHorizontal: space.lg },
  leading: { width: 36, alignItems: 'center' },
  rowTitle: { color: colors.text, fontSize: font.body, fontWeight: '600' },
  rowMeta: { color: colors.muted, fontSize: font.small, marginTop: 2 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },
  lab: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  labText: { color: colors.text, fontSize: font.small, fontWeight: '600' },
});
