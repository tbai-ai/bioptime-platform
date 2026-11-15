/* The bell of the coach workspace: the same bell as every workspace header (components/workspaceShell NotificationBell,
   GET /notifications for the unread count once a minute and whenever the screen comes back into focus), but pressing it
   opens the coach's Notifications screen (/coach/notifications) instead of a sheet, as the task asks. coachScreenOptions
   gives a plain coach screen its header title and this bell. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge } from '@/components/workspace';
import { colors } from '@/theme';

let lastUnread = 0;
/** Remember the last count for the next bell that mounts (a plain function: the hook below never reassigns the module
 *  variable itself, which the React Compiler does not keep in order). */
function rememberUnread(n: number): number { lastUnread = n; return n; }
function rememberedUnread(): number { return lastUnread; }
const listeners = new Set<(n: number) => void>();
/** Ask every bell to reload now (after "Mark all read"). */
export function refreshCoachBell(): void { for (const l of listeners) l(-1); }

export function CoachBell() {
  const router = useRouter();
  const { user } = useAuth();
  const [unread, setUnread] = useState(rememberedUnread);
  const load = useCallback(async () => {
    if (!user) return;
    try { const r = await get<{ unread?: number; items?: Array<{ read_at?: string | null }> }>('/notifications?limit=12'); setUnread(rememberUnread(r.unread ?? (r.items ?? []).filter((x) => !x.read_at).length)); } catch { /* the badge keeps its last value */ }
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const l = (n: number) => { if (n < 0) void load(); else setUnread(n); };
    listeners.add(l);
    const t = setInterval(() => { void load(); }, 60_000);
    return () => { listeners.delete(l); clearInterval(t); };
  }, [load]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  return <Pressable accessibilityRole="button" accessibilityLabel={`Notifications${unread ? `, ${unread} unread` : ''}`} onPress={() => router.push('/coach/notifications')} hitSlop={8} style={styles.bell}>
    <Ionicons name="notifications-outline" size={22} color={colors.text} />
    {unread > 0 ? <Badge count={unread} style={styles.badge} /> : null}
  </Pressable>;
}

/** The header options of a plain coach screen: its title and the bell. */
export function coachScreenOptions(title: string): { title: string; headerRight: () => React.ReactElement } {
  return { title, headerRight: () => <CoachBell /> };
}

const styles = StyleSheet.create({
  bell: { marginEnd: 16, padding: 4 },
  badge: { position: 'absolute', top: -2, right: -4 },
});
