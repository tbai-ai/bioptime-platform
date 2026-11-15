/* What the coach's module tabs and module screens share: the web's status-to-pill rule (D/lib/format.ts STATUS_PILL),
   IST date helpers, a short-lived notice standing in for the portal's toasts (2.4 s for ok, 5 s for errors), a picker
   field (the portal's <select>) built from the existing primitives, a confirm sheet with an optional note (the portal's
   ConfirmDialog), private-file opening through the 5-minute token, and the clipboard. Tokens from theme.ts only. */
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { ApiError, post } from '@/lib/api';
import { apiBaseSync } from '@/lib/config';
import { fmtDate, fmtTime, label } from '@/lib/format';
import { Button, Chip, Empty, Field, Input, Loading, Notice, P, Pill } from '@/components/ui';
import { ErrorBox } from '@/components/ui';
import { Sheet } from '@/components/workspace';
import { colors, font, radius, space } from '@/theme';

export type Tone = React.ComponentProps<typeof Pill>['tone'];

/* ---------- the web's status pill rule ---------- */
const SUCCESS = ['active', 'activated', 'paid', 'completed', 'results_ready', 'published', 'resolved', 'assigned', 'accepted', 'available', 'done', 'attended'];
const INFO = ['scheduled', 'confirmed', 'onboarding', 'invited', 'proposal_sent', 'under_review', 'scoping', 'registered'];
const WARNING = ['requested', 'pending', 'pending_payment', 'open', 'draft', 'processing', 'sample_collected', 'in_progress', 'refund_pending', 'payment_pending', 'enquiry_received', 'awaiting_professional_input', 'awaiting_internal_approval', 'new', 'pending_verification', 'waitlisted', 'contacted'];
const ERROR = ['exception', 'failed', 'no_show', 'suspended'];
/** The tone the portal gives a status. The app's pills have no neutral (the web's outlined pill for cancelled, paused,
 *  ended, closed…): those read in the app's nearest tone, 'info' (the raised, muted pill). */
export function statusToneOf(s?: string | null): Tone {
  if (!s) return 'info';
  if (SUCCESS.includes(s)) return 'success';
  if (WARNING.includes(s)) return 'warning';
  if (ERROR.includes(s)) return 'error';
  if (INFO.includes(s)) return 'info';
  return 'info';
}
/** The portal's `<Pill status>` with no children: label(status) in the status tone. */
export function StatusPill({ status, children }: { status: string; children?: React.ReactNode }) {
  return <Pill tone={statusToneOf(status)}>{children ?? label(status)}</Pill>;
}

/** A support request's status as the requester reads it (the web's RequestStatus). */
export function RequestStatus({ status }: { status: string }) {
  if (status === 'waiting_on_requester') return <Pill tone="warning">Waiting on you</Pill>;
  if (status === 'open') return <Pill tone="info">With the team</Pill>;
  return <Pill tone={status === 'resolved' ? 'success' : 'info'}>{label(status)}</Pill>;
}

/* ---------- dates in IST ---------- */
/** A calendar date (YYYY-MM-DD) in the brand's format. */
export const day = (d?: string | null) => (d ? fmtDate(`${d}T12:00:00Z`) : '—');
/** "Sat 24 Oct 2026, 18:30 to 19:15 IST" */
export function fmtSpan(startAt: string, endAt: string): string {
  const weekday = new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(startAt));
  return `${weekday} ${fmtDate(startAt)}, ${fmtTime(startAt)} to ${fmtTime(endAt)} IST`;
}
/** "Mon 27 Oct, 18:30" in India time. */
export function istLabel(iso?: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}
/** Date and time entered in India's time: YYYY-MM-DD and HH:MM → an ISO instant. */
export function istToIso(date: string, time: string): string { return new Date(`${date}T${time}:00+05:30`).toISOString(); }
export function isoToIstDate(iso: string): string { return new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10); }
export function isoToIstTime(iso: string): string { return new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(11, 16); }
export function minutesBetween(a: string, b: string): number { return Math.round((Date.parse(b) - Date.parse(a)) / 60_000); }
/** "Mon 27 Oct" for a YYYY-MM-DD date. */
export function fmtLocalDate(date: string): string { return new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`)); }
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Only an https link without spaces or control characters is ever opened. */
export function safeLink(url?: string | null): string | null {
  if (!url || /[\s\u0000-\u001f\u007f-\u009f]/.test(url)) return null;
  try { return new URL(url).protocol === 'https:' ? url : null; } catch { return null; }
}

/* ---------- field errors ---------- */
export function fieldErrorsOf(e: unknown): Record<string, string> { return e instanceof ApiError ? e.fieldErrors() : {}; }
export function errorTextOf(e: unknown): string { return e instanceof Error ? e.message : 'Something went wrong.'; }

/* ---------- the portal's toasts ---------- */
export type Flash = { kind: 'success' | 'error'; text: string } | null;
/** A short-lived notice: 2.4 s for ok, 5 s for errors, as the portal's toasts. */
export function useFlash(): { flash: Flash; show: (text: string, kind?: 'success' | 'error') => void; node: React.ReactNode } {
  const [flash, setFlash] = useState<Flash>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((text: string, kind: 'success' | 'error' = 'success') => {
    setFlash({ kind, text });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFlash(null), kind === 'error' ? 5000 : 2400);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const node = flash ? <Notice kind={flash.kind}>{flash.text}</Notice> : null;
  return { flash, show, node };
}

/* ---------- the record screen's refresh, inside a tab ---------- */
/** A number that goes up each time the record screen hands its tab a new `record` (it reloads the record on pull to
 *  refresh and when the screen comes back into view). A tab puts it in its useLoad deps so that its own data reloads
 *  with the record; it stays 0 on the first render, so the tab's first load runs once. */
export function useRecordTick(record: unknown): number {
  const seen = useRef<{ record: unknown; tick: number }>({ record, tick: 0 });
  if (seen.current.record !== record) seen.current = { record, tick: seen.current.tick + 1 };
  return seen.current.tick;
}

/* ---------- a module screen while its flag is off ---------- */
/** The portal's ModuleRouteGate: the screen's body only while the module's flag is in GET /public/config → features
 *  (and its `feature` sub-flag when named); a spinner while the flags load; the web's wording otherwise. */
export function ModuleGate({ features, module, feature, children }: { features: Set<string> | null; module: string; feature?: string; children: React.ReactNode }) {
  if (!features) return <Loading />;
  if (!features.has(module) || (feature && !features.has(feature))) return <Empty title="No such page" body="This part of Bioptime is not switched on." />;
  return <>{children}</>;
}

/* ---------- loading and errors inside a tab ---------- */
export function TabState({ loading, error, onRetry, children }: { loading: boolean; error: ApiError | null; onRetry: () => void; children?: React.ReactNode }) {
  if (error) return <ErrorBox error={error} onRetry={onRetry} />;
  if (loading) return <Loading />;
  return <>{children}</>;
}

/* ---------- a picker (the portal's <select>) ---------- */
export type PickerOption = { value: string; label: string; disabled?: boolean };

/** A single choice: chips inline when there are few options, otherwise a sheet with the list. `placeholder` is the
 *  empty choice's wording (the portal's first <option>). */
export function PickerField({ label: text, value, options, onChange, placeholder, hint, error, disabled, chipsUpTo = 7 }: { label: string; value: string; options: PickerOption[]; onChange: (v: string) => void; placeholder?: string; hint?: string; error?: string; disabled?: boolean; chipsUpTo?: number }) {
  const [open, setOpen] = useState(false);
  const all = placeholder ? [{ value: '', label: placeholder }, ...options] : options;
  const current = all.find((o) => o.value === value);
  if (all.length <= chipsUpTo) {
    return <Field label={text} hint={hint} error={error}>
      <View style={styles.chips} accessibilityLabel={text}>{all.map((o) => <Chip key={o.value || '∅'} selected={o.value === value} onPress={disabled || o.disabled ? undefined : () => onChange(o.value)}>{o.label}</Chip>)}</View>
    </Field>;
  }
  return <Field label={text} hint={hint} error={error}>
    <Pressable accessibilityRole="button" accessibilityLabel={text} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={() => setOpen(true)} style={[styles.picker, disabled && { opacity: 0.6 }]}>
      <Text style={[styles.pickerText, !current && { color: colors.disabled }]} numberOfLines={2}>{current?.label ?? placeholder ?? 'Choose…'}</Text>
      <Ionicons name="chevron-down" size={18} color={colors.muted} />
    </Pressable>
    <Sheet open={open} onClose={() => setOpen(false)} title={text}>
      {all.map((o) => <Pressable key={o.value || '∅'} accessibilityRole="button" accessibilityState={{ selected: o.value === value, disabled: !!o.disabled }} disabled={o.disabled} onPress={() => { onChange(o.value); setOpen(false); }} style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.hover }, o.disabled && { opacity: 0.5 }]}>
        <Text style={[styles.optionText, o.value === value && { color: colors.accentText, fontWeight: '700' }]}>{o.label}</Text>
        {o.value === value ? <Ionicons name="checkmark" size={18} color={colors.accentText} /> : null}
      </Pressable>)}
    </Sheet>
  </Field>;
}

/* ---------- the portal's ConfirmDialog ---------- */
export function ConfirmSheet({ open, title, body, confirmLabel, destructive, note, onConfirm, onClose, busy }: { open: boolean; title: string; body?: string; confirmLabel: string; destructive?: boolean; note?: string; onConfirm: (note: string) => void | Promise<void>; onClose: () => void; busy?: boolean }) {
  const [text, setText] = useState('');
  useEffect(() => { if (!open) setText(''); }, [open]);
  return <Sheet open={open} onClose={onClose} title={title} footer={<View style={{ flexDirection: 'row', gap: space.sm }}><Button title="Not now" variant="secondary" onPress={onClose} disabled={busy} style={{ flex: 1 }} /><Button title={confirmLabel} variant={destructive ? 'danger' : 'primary'} onPress={() => void onConfirm(text.trim())} busy={busy} style={{ flex: 1 }} /></View>}>
    {body ? <P muted>{body}</P> : null}
    {note ? <Field label={note}><Input value={text} onChangeText={setText} maxLength={500} multiline numberOfLines={2} style={{ minHeight: 56, textAlignVertical: 'top' }} /></Field> : null}
  </Sheet>;
}

/* ---------- a progress bar ---------- */
export function Bar({ pct, tone = 'text', style }: { pct: number; tone?: 'text' | 'success' | 'brand'; style?: StyleProp<ViewStyle> }) {
  const fill = tone === 'success' ? colors.success : tone === 'brand' ? colors.brand : colors.text;
  const w = Math.max(0, Math.min(100, Math.round(pct)));
  return <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: w }} style={[styles.bar, style]}><View style={{ width: `${w}%`, height: 6, backgroundColor: fill }} /></View>;
}

/* ---------- a key-value list inside a card (the portal's dl.kv) ---------- */
export function KvList({ rows }: { rows: Array<[string, React.ReactNode] | null | false> }) {
  const shown = rows.filter((r): r is [string, React.ReactNode] => !!r);
  return <View style={{ gap: space.xs }}>{shown.map(([k, v]) => <View key={k} style={styles.kvRow}><Text style={styles.kvKey}>{k}</Text>{typeof v === 'string' || typeof v === 'number' ? <Text style={styles.kvVal}>{String(v)}</Text> : <View style={{ flex: 1 }}>{v}</View>}</View>)}</View>;
}

/* ---------- a tile (the portal's .bp-tile) ---------- */
export function Tile({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.tile, style]}>{children}</View>;
}

/* ---------- private files and the clipboard ---------- */
/** Opens a private file through a 5-minute token (no permanent link exists); each opening is audited by the server. */
export async function openPrivateFile(fileId: string): Promise<void> {
  const t = await post<{ url: string }>(`/files/${encodeURIComponent(fileId)}/token`);
  const url = /^https?:\/\//.test(t.url) ? t.url : `${apiBaseSync()}${t.url}`;
  await WebBrowser.openBrowserAsync(url);
}
/** Copy text; false when the platform refused. */
export async function copyText(text: string): Promise<boolean> {
  try { return await Clipboard.setStringAsync(text); } catch { return false; }
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  picker: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, backgroundColor: colors.base, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 12 },
  pickerText: { color: colors.text, fontSize: font.body, flex: 1 },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  optionText: { color: colors.text, fontSize: font.body, flex: 1 },
  bar: { height: 6, borderRadius: radius.pill, backgroundColor: colors.hover, overflow: 'hidden' },
  kvRow: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  kvKey: { color: colors.muted, fontSize: font.small, width: 118 },
  kvVal: { color: colors.text, fontSize: font.small, flex: 1 },
  tile: { backgroundColor: colors.raised, borderRadius: radius.md, padding: space.md, gap: space.xs },
});
