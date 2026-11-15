/* Coach › Messages (the portal's /coach/messages, pages/Messages.tsx list): GET /conversations, one row per client
   thread with the last line, the time and the unread count; a row opens the thread (/coach/messages/[id]). Reloaded
   whenever the tab comes back into focus, so a thread just read shows no count, and on the badges tick (the portal's
   Shell polls GET /coach/home once a minute): when the unread conversations it reports change, the list is fetched
   again, so a new message shows without a pull. `?member=` (from a client record's Messages tab) opens that client's
   thread once the list is in. */
import { Tabs, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef } from 'react';
import { get } from '@/lib/api';
import { relative } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Card, Empty, ErrorBox, Loading, Screen, StaleBanner, Title } from '@/components/ui';
import { Badge, RecordList, RecordRow } from '@/components/workspace';
import { useWorkspaceHome } from '@/components/workspaceShell';
import { Enter, MotionCard } from '@/motion';
import { CoachBell } from '@/components/coach/bell';

export default function CoachMessages() {
  const router = useRouter();
  const { member } = useLocalSearchParams<{ member?: string }>();
  const convs = useLoad<any>('coach-conversations', () => get('/conversations'), []);
  const first = useRef(true);
  useFocusEffect(useCallback(() => { if (first.current) { first.current = false; return; } void convs.reload(); }, [convs.reload])); // back from a thread: the unread counts
  const home = useWorkspaceHome('coach') as { unreadConversations?: unknown[] } | null;
  const unreadKey = home ? JSON.stringify(home.unreadConversations ?? []) : null;
  const seenKey = useRef<string | null>(null);
  useEffect(() => {
    if (unreadKey === null) return;
    if (seenKey.current !== null && seenKey.current !== unreadKey) void convs.reload();
    seenKey.current = unreadKey;
  }, [unreadKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!member || !convs.data || opened.current === member) return;
    const c = ((convs.data.items ?? []) as any[]).find((x) => x.memberId === member);
    if (c) { opened.current = member; router.push(`/coach/messages/${c.id}`); }
  }, [member, convs.data, router]);
  const items: any[] = convs.data?.items ?? [];
  return <Screen refreshing={convs.loading} onRefresh={convs.reload} depth>
    <Tabs.Screen options={{ headerRight: () => <CoachBell /> }} />
    <Enter><Title sub="Your conversations with assigned clients. Keep health detail in the app, not in notifications.">Messages</Title></Enter>
    <StaleBanner at={convs.stale} /><ErrorBox error={convs.error} onRetry={convs.reload} />
    {convs.loading && !convs.data ? <Loading /> : convs.data ? (items.length ? <MotionCard index={1} pressable={false}><RecordList>
      {items.map((c) => <RecordRow key={c.id} title={c.memberName ?? 'Member'} meta={`${c.lastBody ?? 'No messages yet'} · ${c.lastMessageAt ? relative(c.lastMessageAt) : '—'}`} right={c.unread ? <Badge count={c.unread} /> : undefined} onPress={() => router.push(`/coach/messages/${c.id}`)} />)}
    </RecordList></MotionCard> : <Card><Empty title="No conversations" body="A conversation opens when a coach is assigned." /></Card>) : null}
  </Screen>;
}
