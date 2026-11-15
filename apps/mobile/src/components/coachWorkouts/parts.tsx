/* Small pieces the coach's library, editor and learning screens share (coach-libs-b), built from the existing primitives
   and tokens only:
   ModuleGate   { flag, children }      the web's ModuleRouteGate: the screen's body only while the module's flag is in
                                        GET /public/config → features, read again each time the screen is focused (the
                                        flags are kept for a minute); a spinner while they load; otherwise the wording the
                                        other coach module screens use. The server refuses the routes anyway.
   BackLink     { title, onPress }      the web's muted "← Exercise library" link above a page title
   IconButton   { icon, label, … }      a small icon control with the web's aria-label ("Move up", "Remove exercise")
   OptField     { label, optional?, hint?, error?, children }   the web's Field with its "Optional" tag next to the label
   InfoRow      { title, sub?, extra?, meta?, pills?, pillNote?, right?, onPress?, forward? } one record of a list standing in for a table row: the bold
                                        first column, its small line, the other columns as a muted line, the status pills
   useRefreshOnFocus(reload)            reload quietly when the screen is shown again (back from an editor or a lesson) */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/lib/auth';
import { loadFeatures } from '@/lib/features';
import { Empty, Loading, Pill, Screen } from '@/components/ui';
import { colors, font, radius, space } from '@/theme';

export function ModuleGate({ flag, children }: { flag: string; children: React.ReactNode }) {
  const { user } = useAuth();
  const who = user?.id ?? 'signed-out';
  const [features, setFeatures] = useState<Set<string> | null>(null);
  useFocusEffect(useCallback(() => {
    let alive = true;
    void loadFeatures(who).then((f) => { if (alive) setFeatures(f); });
    return () => { alive = false; };
  }, [who]));
  if (!features) return <Screen><Loading /></Screen>;
  if (!features.has(flag)) return <Screen><Empty title="No such page" body="This part of Bioptime is not switched on." /></Screen>;
  return <>{children}</>;
}

export function BackLink({ title, onPress }: { title: string; onPress: () => void }) {
  return <Pressable accessibilityRole="link" accessibilityLabel={title} onPress={onPress} hitSlop={8} style={({ pressed }) => [styles.back, pressed && { opacity: 0.7 }]}>
    <Text style={styles.backText}>{title}</Text>
  </Pressable>;
}

type IconName = React.ComponentProps<typeof Ionicons>['name'];
export function IconButton({ icon, label, onPress, disabled }: { icon: string; label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.icon, disabled && { opacity: 0.4 }, pressed && { backgroundColor: colors.hover }]}>
    <Ionicons name={icon as IconName} size={18} color={colors.text} />
  </Pressable>;
}

export function OptField({ label, optional, hint, error, children }: { label: string; optional?: boolean; hint?: string; error?: string; children: React.ReactNode }) {
  return <View style={styles.field}>
    <View style={styles.labelRow}><Text style={styles.label}>{label}</Text>{optional ? <Text style={styles.optional}>Optional</Text> : null}</View>
    {children}
    {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
  </View>;
}

export type InfoPill = { label: string; tone?: React.ComponentProps<typeof Pill>['tone'] };
export function InfoRow({ title, sub, extra, meta, pills, pillNote, right, onPress, selected, last, forward }: { title: string; sub?: string | null; extra?: string | null; meta?: string | null; pills?: InfoPill[]; pillNote?: string | null; right?: React.ReactNode; onPress?: () => void; selected?: boolean; last?: boolean; forward?: boolean }) {
  return <Pressable accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={onPress ? title : undefined} onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.row, last && { borderBottomWidth: 0 }, selected && { backgroundColor: colors.raised }, pressed && { backgroundColor: colors.hover }]}>
    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
      <Text style={styles.rowTitle}>{title}</Text>
      {sub ? <Text style={styles.rowSub} numberOfLines={selected ? undefined : 2}>{sub}</Text> : null}
      {extra ? <Text style={styles.rowSub}>{extra}</Text> : null}
      {meta ? <Text style={styles.rowMeta}>{meta}</Text> : null}
      {pills?.length ? <View style={styles.pills}>{pills.map((p, i) => <Pill key={`${p.label}-${i}`} tone={p.tone}>{p.label}</Pill>)}{pillNote ? <Text style={styles.rowMeta}>{pillNote}</Text> : null}</View> : null}
    </View>
    {right}
    {onPress && !right ? <Ionicons name={forward ? 'chevron-forward' : selected ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} /> : null}
  </Pressable>;
}

/** Reload quietly when the screen is shown again, skipping the first focus (the screen loads by itself then). */
export function useRefreshOnFocus(reload: () => unknown): void {
  const first = useRef(true);
  const fn = useRef(reload);
  fn.current = reload;
  useFocusEffect(useCallback(() => { if (first.current) { first.current = false; return; } void fn.current(); }, []));
}

const styles = StyleSheet.create({
  back: { alignSelf: 'flex-start', paddingVertical: space.xs, marginBottom: space.xs },
  backText: { color: colors.muted, fontSize: font.small },
  field: { marginBottom: space.lg },
  labelRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, marginBottom: space.xs },
  label: { color: colors.text, fontSize: font.small, fontWeight: '600' },
  optional: { color: colors.muted, fontSize: font.tiny },
  hint: { color: colors.muted, fontSize: font.small, marginTop: space.xs, lineHeight: 18 },
  error: { color: colors.errorText, fontSize: font.small, marginTop: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowTitle: { color: colors.text, fontSize: font.body, fontWeight: '600' },
  rowSub: { color: colors.text, fontSize: font.small, lineHeight: 18 },
  rowMeta: { color: colors.muted, fontSize: font.small, lineHeight: 18 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginTop: space.xs },
  icon: { width: 36, height: 36, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
});
