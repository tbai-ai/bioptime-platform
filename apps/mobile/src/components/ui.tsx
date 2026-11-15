import React from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { colors, font, radius, space } from '../theme';
import { ApiError } from '../lib/api';
import { signInFor, useAuth } from '../lib/auth';
import { relative } from '../lib/format';
import { ScreenEnter } from '../motion/ScreenEnter';
import { DepthScrollView } from '../motion/ScrollDepth';

/** A screen. Its content enters with depth (motion/ScreenEnter: a short rotateY swing, at rest with reduced motion).
 *  `depth` gives the cards on it scroll-linked parallax and depth while the list moves (motion/ScrollDepth; Home, Plan). */
export function Screen({ children, scroll = true, refreshing, onRefresh, padded = true, style, depth }: { children: React.ReactNode; scroll?: boolean; refreshing?: boolean; onRefresh?: () => void; padded?: boolean; style?: ViewStyle; depth?: boolean }) {
  const inner = <ScreenEnter fill={!scroll}><View style={[padded && styles.padded, style]}>{children}</View></ScreenEnter>;
  const refreshControl = onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.muted} /> : undefined;
  return <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
    {!scroll ? inner
      : depth ? <DepthScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={styles.scrollContent} refreshControl={refreshControl}>{inner}</DepthScrollView>
      : <ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={styles.scrollContent} refreshControl={refreshControl}>{inner}</ScrollView>}
  </SafeAreaView>;
}

export function Title({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
  return <View style={{ marginBottom: space.lg }}><Text style={styles.title}>{children}</Text>{sub ? <Text style={styles.sub}>{sub}</Text> : null}</View>;
}
export function Eyebrow({ children }: { children: React.ReactNode }) { return <Text style={styles.eyebrow}>{children}</Text>; }
export function H2({ children }: { children: React.ReactNode }) { return <Text style={styles.h2}>{children}</Text>; }
export function P({ children, muted, small, style }: { children: React.ReactNode; muted?: boolean; small?: boolean; style?: object }) { return <Text style={[styles.p, muted && { color: colors.muted }, small && { fontSize: font.small }, style]}>{children}</Text>; }

export function Card({ children, style, accent }: { children: React.ReactNode; style?: ViewStyle; accent?: boolean }) {
  return <View style={[styles.card, accent && { borderColor: colors.brand }, style]}>{children}</View>;
}

export function Button({ title, onPress, variant = 'primary', disabled, busy, small, style }: { title: string; onPress?: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; disabled?: boolean; busy?: boolean; small?: boolean; style?: ViewStyle }) {
  const bg = variant === 'primary' ? colors.brand : variant === 'danger' ? colors.brandDeep : variant === 'secondary' ? colors.raised : 'transparent';
  const fg = variant === 'ghost' ? colors.accentText : colors.onAccent;
  return <Pressable accessibilityRole="button" disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [styles.btn, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }, variant === 'secondary' && { borderWidth: 1, borderColor: colors.borderStrong }, small && styles.btnSmall, style]}>
    {busy ? <ActivityIndicator color={fg} /> : <Text style={[styles.btnText, { color: fg }, small && { fontSize: font.small }]}>{title}</Text>}
  </Pressable>;
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return <View style={{ marginBottom: space.lg }}>
    <Text style={styles.label}>{label}</Text>
    {children}
    {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
  </View>;
}
export function Input(props: TextInputProps) {
  return <TextInput placeholderTextColor={colors.disabled} {...props} style={[styles.input, props.style]} />;
}

export function Pill({ children, tone = 'info' }: { children: React.ReactNode; tone?: 'info' | 'success' | 'warning' | 'error' | 'sample' }) {
  const map = { info: [colors.raised, colors.info], success: ['#153A1A', colors.successText], warning: ['#3B2A00', colors.warningText], error: ['#3A1512', colors.errorText], sample: [colors.sampleBg, colors.sampleText] } as const;
  const [bg, fg] = map[tone];
  return <View style={[styles.pill, { backgroundColor: bg }]}><Text style={[styles.pillText, { color: fg }]}>{children}</Text></View>;
}
export function statusTone(s?: string | null): 'info' | 'success' | 'warning' | 'error' | 'sample' {
  if (!s) return 'info';
  if (['active', 'completed', 'done', 'confirmed', 'scheduled', 'activated', 'paid', 'available', 'results_ready', 'released'].includes(s)) return 'success';
  if (['pending', 'requested', 'pending_payment', 'processing', 'sample_collected', 'paused', 'onboarding', 'pending_verification'].includes(s)) return 'warning';
  if (['cancelled', 'failed', 'no_show', 'suspended', 'refunded', 'declined', 'expired'].includes(s)) return 'error';
  return 'info';
}

export function KV({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return <View style={{ gap: space.sm }}>{rows.map(([k, v]) => <View key={k} style={styles.kvRow}><Text style={styles.kvKey}>{k}</Text><Text style={styles.kvVal}>{v}</Text></View>)}</View>;
}

export function Row({ children, between, style }: { children: React.ReactNode; between?: boolean; style?: ViewStyle }) {
  return <View style={[styles.row, between && { justifyContent: 'space-between' }, style]}>{children}</View>;
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return <View style={styles.empty}><Text style={styles.emptyTitle}>{title}</Text>{body ? <Text style={styles.sub}>{body}</Text> : null}</View>;
}

export function Loading() { return <View style={{ padding: space.xl, alignItems: 'center' }}><ActivityIndicator color={colors.muted} /></View>; }

export function Notice({ kind = 'info', title, children }: { kind?: 'info' | 'warning' | 'error' | 'success' | 'sample'; title?: string; children?: React.ReactNode }) {
  const border = kind === 'error' ? colors.error : kind === 'warning' || kind === 'sample' ? colors.warning : kind === 'success' ? colors.success : colors.info;
  return <View style={[styles.notice, { borderLeftColor: border }]}>{title ? <Text style={styles.noticeTitle}>{title}</Text> : null}{typeof children === 'string' ? <Text style={styles.noticeBody}>{children}</Text> : children}</View>;
}

export function ErrorBox({ error, onRetry }: { error: ApiError | Error | null; onRetry?: () => void }) {
  const { ready, user, lastWorkspace, config } = useAuth();
  if (!error) return null;
  const offline = error instanceof ApiError && error.offline;
  // signed out (no session, or it ended): trying again repeats the 401, so offer the way back in instead. Only when the
  // app knows nobody is signed in (auth ready, no user): a 401 that arrives while the stored session is still being
  // checked is not proof of that, and for a member who is signed in Try again works. In the open preview nobody signs
  // in: the button opens Bioptime again (the sign-in route opens a new session by itself, components/openPreview)
  const signedOut = error instanceof ApiError && error.status === 401 && ready && !user && !['INVALID_CREDENTIALS', 'MFA_REQUIRED', 'MFA_INVALID'].includes(error.code);
  return <Notice kind={offline ? 'warning' : 'error'} title={offline ? 'No connection' : signedOut ? 'Signed out' : 'Something went wrong'}>
    <Text style={styles.noticeBody}>{offline ? 'The Bioptime service could not be reached. Check your connection; nothing you did was lost.' : error.message}</Text>
    {signedOut ? <Button title={config?.openPreview ? 'Open Bioptime' : 'Sign in'} variant="secondary" small onPress={() => router.replace(signInFor(lastWorkspace))} style={{ marginTop: space.sm, alignSelf: 'flex-start' }} />
      : onRetry ? <Button title="Try again" variant="secondary" small onPress={onRetry} style={{ marginTop: space.sm, alignSelf: 'flex-start' }} /> : null}
  </Notice>;
}

export function StaleBanner({ at }: { at: string | null }) {
  if (!at) return null;
  return <Notice kind="warning" title="Offline">{`Showing what was saved ${relative(at)}. Pull to refresh when you are back online.`}</Notice>;
}

export function ListItem({ title, sub, right, onPress }: { title: string; sub?: string; right?: React.ReactNode; onPress?: () => void }) {
  return <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.hover }]}>
    <View style={{ flex: 1, minWidth: 0 }}><Text style={styles.itemTitle}>{title}</Text>{sub ? <Text style={styles.itemSub}>{sub}</Text> : null}</View>
    {right}
  </Pressable>;
}

export function Check({ checked, onChange, label: text, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => onChange(!checked)} style={styles.check}>
    <View style={[styles.checkBox, checked && { backgroundColor: colors.brand, borderColor: colors.brand }]}>{checked ? <Text style={{ color: '#fff', fontWeight: '700' }}>✓</Text> : null}</View>
    <View style={{ flex: 1 }}><Text style={styles.p}>{text}</Text>{hint ? <Text style={styles.hint}>{hint}</Text> : null}</View>
  </Pressable>;
}

export function Chip({ selected, onPress, children }: { selected?: boolean; onPress?: () => void; children: React.ReactNode }) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!selected }} style={[styles.chip, selected && { backgroundColor: colors.brand, borderColor: colors.brand }]}><Text style={[styles.chipText, selected && { color: '#fff' }]}>{children}</Text></Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  scrollContent: { flexGrow: 1 },
  padded: { padding: space.lg, paddingBottom: space.xxl, gap: space.md },
  title: { color: colors.text, fontSize: font.title, fontWeight: '700', letterSpacing: -0.5 },
  sub: { color: colors.muted, fontSize: font.body, marginTop: space.xs, lineHeight: 21 },
  eyebrow: { color: colors.muted, fontSize: font.tiny, letterSpacing: 1.6, textTransform: 'uppercase', fontWeight: '600', marginBottom: space.xs },
  h2: { color: colors.text, fontSize: font.h2, fontWeight: '700', marginBottom: space.sm },
  p: { color: colors.text, fontSize: font.body, lineHeight: 22 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.lg, gap: space.sm },
  btn: { minHeight: 48, paddingHorizontal: space.xl, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  btnSmall: { minHeight: 38, paddingHorizontal: space.lg },
  btnText: { fontSize: font.body, fontWeight: '600' },
  label: { color: colors.text, fontSize: font.small, fontWeight: '600', marginBottom: space.xs },
  hint: { color: colors.muted, fontSize: font.small, marginTop: space.xs, lineHeight: 18 },
  error: { color: colors.errorText, fontSize: font.small, marginTop: space.xs },
  input: { backgroundColor: colors.base, color: colors.text, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 12, fontSize: font.body },
  pill: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  pillText: { fontSize: font.tiny, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  kvRow: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  kvKey: { color: colors.muted, fontSize: font.small, width: 110 },
  kvVal: { color: colors.text, fontSize: font.small, flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  empty: { padding: space.xl, alignItems: 'center', gap: space.xs },
  emptyTitle: { color: colors.text, fontSize: font.h3, fontWeight: '600' },
  notice: { backgroundColor: colors.surface, borderLeftWidth: 3, borderRadius: radius.md, padding: space.md, gap: space.xs },
  noticeTitle: { color: colors.text, fontWeight: '700', fontSize: font.body },
  noticeBody: { color: colors.muted, fontSize: font.small, lineHeight: 19 },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  itemTitle: { color: colors.text, fontSize: font.body, fontWeight: '600' },
  itemSub: { color: colors.muted, fontSize: font.small, marginTop: 2 },
  check: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start', paddingVertical: space.sm },
  checkBox: { width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.raised },
  chipText: { color: colors.text, fontSize: font.small, fontWeight: '600' },
});
