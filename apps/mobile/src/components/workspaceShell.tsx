/* The frame of the coach and admin workspaces: what every one of their screens shares.
   RoleGate            { workspace, children }   the portal's RequireRole: a person of another role gets the same refusal as on
                                                  the web ("Not available for your account … Go to your workspace"), never a
                                                  silent redirect; a signed-out visitor is sent to their sign-in by the root layout
   RequirePermission   { permission, any?, children }   the portal's RequirePermission wording for an administrator without it
   WorkspaceTabs       { workspace }   the five tabs (lib/workspaceNav), the bell in every header, badge counts on the tabs
   WorkspaceScreen     { workspace, title, sub?, children, refreshing?, onRefresh?, depth? }   a screen with pull to refresh
   NotificationBell    the bell every workspace header carries: GET /notifications, unread count, a sheet with the list and
                       "Mark all read" (the portal's popover); notifyBadges() asks it (and the tab badges) to reload at once
   useWorkspaceHome    { workspace }   GET /coach/home or GET /admin/overview (reports.view) once a minute, for the tab and
                       navigation badges, as the web Shell does; the home shells read the same payload
   TodoRegion          { what, items? }   a clearly marked placeholder for a screen body the next phase builds; replaced
                       before anything ships */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { errorText, get, post } from '../lib/api';
import { homeFor, useAuth, WORKSPACE_OF_ROLE, type Workspace } from '../lib/auth';
import { relative } from '../lib/format';
import { permitted, WORKSPACE_TABS, type WorkspaceKey } from '../lib/workspaceNav';
import { Button, Loading, Notice, P, Screen, Title } from './ui';
import { Badge, Sheet } from './workspace';
import { colors, font, radius, space } from '../theme';

const WORKSPACE_ROLES: Record<WorkspaceKey, string> = { coach: 'coach', admin: 'admin or owner' };

export function RoleGate({ workspace, children }: { workspace: WorkspaceKey; children: React.ReactNode }) {
  const { ready, user } = useAuth();
  const router = useRouter();
  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.canvas, justifyContent: 'center' }}><Loading /></View>;
  if (!user) return <View style={{ flex: 1, backgroundColor: colors.canvas }} />; // the root layout's guard is taking them to sign-in
  if (WORKSPACE_OF_ROLE[user.role] !== (workspace as Workspace)) {
    return <Screen>
      <Notice kind="warning" title="Not available for your account">{`This area is for ${WORKSPACE_ROLES[workspace]} accounts. You are signed in as ${user.role}.`}</Notice>
      <Button title="Go to your workspace" onPress={() => router.replace(homeFor(user.role))} />
    </Screen>;
  }
  return <>{children}</>;
}

export function RequirePermission({ permission, any = false, children }: { permission: string | string[]; any?: boolean; children: React.ReactNode }) {
  const { can } = useAuth();
  const list = ([] as string[]).concat(permission);
  const missing = list.filter((p) => !can(p));
  if (!permitted(can, permission, any)) {
    return <Notice kind="warning" title="Permission needed">{`Your administrator account does not hold “${missing.join(any ? '” or “' : '” and “')}”. An owner can grant ${any && missing.length > 1 ? 'one of them' : 'it'} under Users and permissions.`}</Notice>;
  }
  return <>{children}</>;
}

/* ---------- badges: the home payload and the bell share one "reload now" signal ---------- */

const listeners = new Set<() => void>();
/** Screens call this after they change a count the navigation shows (a thread marked read, a task taken). */
export function notifyBadges(): void { for (const l of listeners) l(); }
function useBadgeTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    listeners.add(bump);
    const t = setInterval(bump, 60_000);
    return () => { listeners.delete(bump); clearInterval(t); };
  }, []);
  return tick;
}

/** The workspace's home payload for badges: the coach's /coach/home, the administrator's /admin/overview when they hold
 *  reports.view (nothing is asked otherwise, rather than a 403 every minute). null while loading or refused. */
export function useWorkspaceHome(workspace: WorkspaceKey): unknown {
  const { user, can } = useAuth();
  const tick = useBadgeTick();
  const [home, setHome] = useState<unknown>(null);
  const allowed = !!user && WORKSPACE_OF_ROLE[user.role] === workspace && (workspace !== 'admin' || can('reports.view'));
  useEffect(() => {
    if (!allowed) { setHome(null); return; }
    let alive = true;
    void get(workspace === 'admin' ? '/admin/overview' : '/coach/home').then((d) => { if (alive) setHome(d); }, () => { /* the badges keep their last value */ });
    return () => { alive = false; };
  }, [allowed, workspace, tick, user?.id]);
  return home;
}

/* ---------- the bell ---------- */

type Notification = { id: string; title: string; body?: string | null; created_at: string; read_at?: string | null };

export function NotificationBell() {
  const tick = useBadgeTick();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ items: Notification[]; unread: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { const r = await get<{ items?: Notification[]; unread?: number }>('/notifications?limit=12'); const items = r.items ?? []; setData({ items, unread: r.unread ?? items.filter((n) => !n.read_at).length }); setErr(null); }
    catch (e) { setErr(errorText(e)); }
  }, []);
  useEffect(() => { if (user) void load(); }, [user?.id, tick, load]); // eslint-disable-line react-hooks/exhaustive-deps
  const markAll = async () => { try { await post('/notifications/read', { all: true }); await load(); notifyBadges(); } catch (e) { setErr(errorText(e)); } };
  const unread = data?.unread ?? 0;
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`Notifications${unread ? `, ${unread} unread` : ''}`} onPress={() => setOpen(true)} hitSlop={8} style={styles.bell}>
      <Ionicons name="notifications-outline" size={22} color={colors.text} />
      {unread > 0 ? <Badge count={unread} style={styles.bellBadge} /> : null}
    </Pressable>
    <Sheet open={open} onClose={() => setOpen(false)} title="Notifications" footer={data?.items.length ? <Button title="Mark all read" variant="secondary" small onPress={markAll} disabled={!unread} /> : undefined}>
      {err ? <Notice kind="error">{err}</Notice> : null}
      {!data ? <Loading /> : data.items.length ? data.items.map((n) => <View key={n.id} style={[styles.notif, !!n.read_at && { opacity: 0.7 }]}>
        <View style={[styles.dot, !n.read_at && { backgroundColor: colors.brand }]} />
        <View style={{ flex: 1 }}><Text style={[styles.notifTitle, !n.read_at && { fontWeight: '700' }]}>{n.title}</Text>{n.body ? <Text style={styles.notifBody}>{n.body}</Text> : null}<Text style={styles.notifTime}>{relative(n.created_at)}</Text></View>
      </View>) : <P muted>Nothing yet.</P>}
    </Sheet>
  </>;
}

/* ---------- the tab bar ---------- */

/** The five tabs of a workspace (lib/workspaceNav COACH_TABS / ADMIN_TABS) with the bell in every header and the
 *  badge counts from the workspace's home payload, in the same colours and metrics as the member tabs. */
export function WorkspaceTabs({ workspace }: { workspace: WorkspaceKey }) {
  const home = useWorkspaceHome(workspace);
  return <Tabs screenOptions={{ headerStyle: { backgroundColor: colors.canvas }, headerTintColor: colors.text, headerShadowVisible: false, headerTitleStyle: { fontWeight: '700' }, headerRight: () => <NotificationBell />, tabBarStyle: { backgroundColor: colors.base, borderTopColor: colors.border }, tabBarActiveTintColor: colors.accentText, tabBarInactiveTintColor: colors.muted, tabBarBadgeStyle: { backgroundColor: colors.brand, color: colors.onAccent, fontSize: font.tiny, fontWeight: '700' }, sceneStyle: { backgroundColor: colors.canvas } }}>
    {WORKSPACE_TABS[workspace].map((t) => <Tabs.Screen key={t.name} name={t.name} options={{ title: t.title, tabBarBadge: t.badge?.(home), tabBarIcon: ({ color, size }) => <Ionicons name={t.icon as React.ComponentProps<typeof Ionicons>['name']} size={size} color={String(color ?? colors.muted)} /> }} />)}
  </Tabs>;
}

/* ---------- a workspace screen ---------- */

export function WorkspaceScreen({ title, sub, children, refreshing, onRefresh, depth }: { workspace: WorkspaceKey; title: string; sub?: string; children: React.ReactNode; refreshing?: boolean; onRefresh?: () => void; depth?: boolean }) {
  return <Screen refreshing={refreshing} onRefresh={onRefresh} depth={depth}>
    <Title sub={sub}>{title}</Title>
    {children}
  </Screen>;
}

/** TODO (next phase): the body of this screen. Clearly marked so nothing ships with it in place. */
export function TodoRegion({ what, items }: { what: string; items?: string[] }) {
  return <View style={styles.todo} accessibilityLabel={`To do: ${what}`}>
    <Text style={styles.todoTag}>TODO · NEXT PHASE</Text>
    <Text style={styles.todoTitle}>{what}</Text>
    {items?.length ? <View style={{ gap: space.xs }}>{items.map((it) => <Text key={it} style={styles.todoItem}>{`• ${it}`}</Text>)}</View> : null}
    <Text style={styles.todoNote}>This placeholder is replaced by the real screen before anything ships.</Text>
  </View>;
}

const styles = StyleSheet.create({
  bell: { marginEnd: 16, padding: 4 },
  bellBadge: { position: 'absolute', top: -2, right: -4 },
  notif: { flexDirection: 'row', gap: space.sm, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.borderStrong, marginTop: 6 },
  notifTitle: { color: colors.text, fontSize: font.body },
  notifBody: { color: colors.muted, fontSize: font.small, marginTop: 2 },
  notifTime: { color: colors.disabled, fontSize: font.tiny, marginTop: 2 },
  todo: { borderWidth: 1, borderStyle: 'dashed', borderColor: colors.warning, borderRadius: radius.lg, padding: space.lg, gap: space.sm, backgroundColor: colors.surface },
  todoTag: { color: colors.warningText, fontSize: font.tiny, letterSpacing: 1.6, fontWeight: '700' },
  todoTitle: { color: colors.text, fontSize: font.h3, fontWeight: '600' },
  todoItem: { color: colors.muted, fontSize: font.small, lineHeight: 19 },
  todoNote: { color: colors.disabled, fontSize: font.tiny, marginTop: space.xs },
});
