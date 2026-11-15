/* The frame and small parts of the administrative portal's module screens, part B (group admin-mod-b: announcements,
   live sessions, courses, the three libraries in their admin modes, growth). Built from the tokens (theme.ts) and the
   primitives (components/ui, components/workspace) only; nothing here fetches.
   AdminModuleGate  { title, module, permission, any?, children }  the stack header with the bell, the admin RoleGate,
                    the module's flag (the web's ModuleRouteGate: "No such page" while the flag is off, the wording the
                    app's other module screens use) and the permission (the web's RequirePermission wording). The body
                    renders only behind all three, so nothing is requested while the module is off or the permission
                    is missing; it draws its own Screen (pull to refresh) and title.
   SectionCard      { eyebrow, title, right?, children }   the portal's Card with its CardHead
   BackLink         { title, href }                         the portal's "← Live sessions" link above a page head
   CheckList        { label, hint?, error?, options, value, onChange, disabled? }   a fieldset of checkboxes
   Hint             { children }                            the portal's muted small paragraph
   IconButton       { icon, label, onPress, disabled? }     the portal's small "↑" / "↓" / "✕" buttons, with their aria-label
   ItemRow          { title, lines, pills?, actions?, onPress? }   a table row as a card row inside a RecordList: the first
                    cell as the title, the others as muted lines (never cut), the status pills, and the row's buttons
                    in its footer, as the phone notes ask
   useDebounced     search-as-you-type, as the phone notes ask
   setPendingToast / takePendingToast   a toast that greets the next screen (the web's toasts outlive a navigation) */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useRouter, type Href } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useAuth } from '@/lib/auth';
import { useFeatures } from '@/lib/features';
import { permitted } from '@/lib/workspaceNav';
import { Card, Check, Empty, Eyebrow, Field, H2, Loading, Pill, Screen, Title } from '@/components/ui';
import type { RecordPill } from '@/components/workspace';
import { NotificationBell, RequirePermission, RoleGate } from '@/components/workspaceShell';
import { colors, font, radius, space } from '@/theme';

/** The module flag gate's wording, as the app's other module screens word it (the API's sentence for a switched-off
 *  module under the web's "No such page"). */
export const SWITCHED_OFF_TITLE = 'No such page';
export const SWITCHED_OFF_BODY = 'This part of Bioptime is not switched on.';

export function AdminModuleGate({ title, module, permission, any, children }: { title: string; module: string; permission: string | string[]; any?: boolean; children: React.ReactNode }) {
  const features = useFeatures(true);
  const { can } = useAuth();
  let body: React.ReactNode;
  if (!features) body = <Screen><Loading /></Screen>;
  else if (!features.has(module)) body = <Screen><Title>{title}</Title><Empty title={SWITCHED_OFF_TITLE} body={SWITCHED_OFF_BODY} /></Screen>;
  else if (!permitted(can, permission, any)) body = <Screen><Title>{title}</Title><RequirePermission permission={permission} any={any}>{null}</RequirePermission></Screen>;
  else body = children;
  return <RoleGate workspace="admin">
    <Stack.Screen options={{ title, headerRight: () => <NotificationBell /> }} />
    {body}
  </RoleGate>;
}

export function SectionCard({ eyebrow, title, right, children }: { eyebrow: string; title: string; right?: React.ReactNode; children?: React.ReactNode }) {
  return <Card>
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
      <View style={{ flex: 1, minWidth: 0 }}><Eyebrow>{eyebrow}</Eyebrow><H2>{title}</H2></View>
      {right}
    </View>
    {children}
  </Card>;
}

export function BackLink({ title, href }: { title: string; href: Href }) {
  const router = useRouter();
  return <Text accessibilityRole="link" onPress={() => router.push(href)} style={{ color: colors.accentText, fontSize: font.small, fontWeight: '600', paddingVertical: space.xs, alignSelf: 'flex-start' }}>{title}</Text>;
}

export type CheckOption = { value: string; label: string };

export function CheckList({ label, hint, error, options, value, onChange, disabled }: { label: string; hint?: string; error?: string; options: CheckOption[]; value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  return <Field label={label} hint={hint} error={error}>
    <View style={{ gap: space.xs, opacity: disabled ? 0.6 : 1 }} accessibilityLabel={label}>
      {options.map((o) => <Check key={o.value} label={o.label} checked={value.includes(o.value)} onChange={(on) => { if (disabled) return; onChange(on ? [...value, o.value] : value.filter((x) => x !== o.value)); }} />)}
    </View>
  </Field>;
}

export function Hint({ children }: { children: React.ReactNode }) {
  return <Text style={{ color: colors.muted, fontSize: font.small, lineHeight: 19 }}>{children}</Text>;
}

export function IconButton({ icon, label, onPress, disabled }: { icon: 'arrow-up' | 'arrow-down' | 'close'; label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} hitSlop={4}
    style={({ pressed }) => [{ width: 34, height: 34, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.raised }, pressed && { backgroundColor: colors.hover }, disabled && { opacity: 0.4 }]}>
    <Ionicons name={icon} size={16} color={colors.text} />
  </Pressable>;
}

export function ItemRow({ title, lines, pills, actions, onPress }: { title: string; lines: Array<string | null | undefined | false>; pills?: RecordPill[]; actions?: React.ReactNode; onPress?: () => void }) {
  const shown = lines.filter((l): l is string => !!l);
  return <View style={{ paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: colors.border, gap: space.sm }}>
    <Pressable accessibilityRole={onPress ? 'button' : undefined} onPress={onPress} disabled={!onPress} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: space.md }, pressed && { opacity: 0.8 }]}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ color: colors.text, fontSize: font.body, fontWeight: '600' }}>{title}</Text>
        {shown.map((l, i) => <Text key={i} style={{ color: colors.muted, fontSize: font.small }}>{l}</Text>)}
        {pills?.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs }}>{pills.map((p, i) => <Pill key={`${p.label}-${i}`} tone={p.tone}>{p.label}</Pill>)}</View> : null}
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.muted} /> : null}
    </Pressable>
    {actions ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm }}>{actions}</View> : null}
  </View>;
}

/** A search value that settles after `ms` without typing. */
export function useDebounced(value: string, ms = 350): string {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

let pending: string | null = null;
export function setPendingToast(text: string): void { pending = text; }
export function takePendingToast(): string | null { const t = pending; pending = null; return t; }
