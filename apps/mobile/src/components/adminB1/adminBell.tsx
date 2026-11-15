/* The administrative portal's bell and tab bar.
   AdminBell   the bell every admin header carries: the unread count from GET /notifications, and a press opens the
               admin notifications screen (/admin/notifications) instead of a popover; refreshAdminBell() asks every
               mounted bell to reload at once (the notifications screen calls it after "Mark all read")
   AdminTabs   the admin tab bar of components/workspaceShell WorkspaceTabs with this bell in every header; the
               (admin) layout renders it so the bell opens the screen (the shared WorkspaceTabs keeps its sheet) */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { get } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { WORKSPACE_TABS } from '../../lib/workspaceNav';
import { Badge } from '../workspace';
import { useWorkspaceHome } from '../workspaceShell';
import { colors, font } from '../../theme';

export const ADMIN_NOTIFICATIONS = '/admin/notifications';

const listeners = new Set<() => void>();
/** Ask every mounted AdminBell to reload its count now (after notifications were marked read). */
export function refreshAdminBell(): void { for (const l of listeners) l(); }

export function AdminBell() {
  const router = useRouter();
  const { user } = useAuth();
  const [unread, setUnread] = useState(0);
  const load = useCallback(async () => {
    try { const r = await get<{ items?: Array<{ read_at?: string | null }>; unread?: number }>('/notifications?limit=12'); setUnread(r.unread ?? (r.items ?? []).filter((n) => !n.read_at).length); }
    catch { /* the count keeps its last value */ }
  }, []);
  useEffect(() => {
    if (!user) return;
    void load();
    const bump = () => { void load(); };
    listeners.add(bump);
    const t = setInterval(bump, 60_000);
    return () => { listeners.delete(bump); clearInterval(t); };
  }, [user?.id, load]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Pressable accessibilityRole="button" accessibilityLabel={`Notifications${unread ? `, ${unread} unread` : ''}`} onPress={() => router.push(ADMIN_NOTIFICATIONS)} hitSlop={8} style={styles.bell}>
    <Ionicons name="notifications-outline" size={22} color={colors.text} />
    {unread > 0 ? <Badge count={unread} style={styles.bellBadge} /> : null}
  </Pressable>;
}

/** The admin workspace's five tabs (lib/workspaceNav ADMIN_TABS), as WorkspaceTabs draws them, with AdminBell in every
 *  header and the badge counts from GET /admin/overview. */
export function AdminTabs() {
  const home = useWorkspaceHome('admin');
  return <Tabs screenOptions={{ headerStyle: { backgroundColor: colors.canvas }, headerTintColor: colors.text, headerShadowVisible: false, headerTitleStyle: { fontWeight: '700' }, headerRight: () => <AdminBell />, tabBarStyle: { backgroundColor: colors.base, borderTopColor: colors.border }, tabBarActiveTintColor: colors.accentText, tabBarInactiveTintColor: colors.muted, tabBarBadgeStyle: { backgroundColor: colors.brand, color: colors.onAccent, fontSize: font.tiny, fontWeight: '700' }, sceneStyle: { backgroundColor: colors.canvas } }}>
    {WORKSPACE_TABS.admin.map((t) => <Tabs.Screen key={t.name} name={t.name} options={{ title: t.title, tabBarBadge: t.badge?.(home), tabBarIcon: ({ color, size }) => <Ionicons name={t.icon as React.ComponentProps<typeof Ionicons>['name']} size={size} color={String(color ?? colors.muted)} /> }} />)}
  </Tabs>;
}

const styles = StyleSheet.create({
  bell: { marginEnd: 16, padding: 4 },
  bellBadge: { position: 'absolute', top: -2, right: -4 },
});
