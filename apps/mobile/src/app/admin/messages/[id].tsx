/* One conversation, read by an administrator for support (the web's /admin/messages/:id, members.manage): the thread
   between a member and their coach with each message's author, the "Open client" link, and the files on messages as
   chips while the messaging flag is on (they open through the module's 5-minute token route). No composer: writing is
   between the member and their coach, and administrators never mark a thread read (the server refuses it). Pull to
   refresh reloads the thread and the conversation list (the names in the title). */
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React, { useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { errorText, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { apiBaseSync } from '@/lib/config';
import { useFeatures } from '@/lib/features';
import { fmtDateTime } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import type { Attachment, Conversation, Message, Thread } from '@/lib/admin/b1/types';
import { AdminBell } from '@/components/adminB1/adminBell';
import { Button, Chip, Empty, ErrorBox, Loading, Notice, StaleBanner } from '@/components/ui';
import { RequirePermission, RoleGate } from '@/components/workspaceShell';
import { colors, font, radius, space } from '@/theme';

const size = (n: number) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.ceil(n / 1024))} KB`);

export default function AdminMessageThread() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAuth();
  const allowed = can('members.manage') && !!id;
  const convs = useLoad<{ items: Conversation[] } | null>(allowed ? 'admin-conversations' : null, () => (allowed ? get('/conversations') : Promise.resolve(null)), [allowed]);
  const thread = useLoad<Thread | null>(allowed ? `admin-thread-${id}` : null, () => (allowed ? get(`/conversations/${id}/messages?limit=100`) : Promise.resolve(null)), [allowed, id]);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const filesOn = !!useFeatures(true)?.has('messaging');
  const open = convs.data?.items.find((c) => c.id === id) ?? null;
  const t = thread.data;
  // administrators read both sides of a thread, so each message names who wrote it (Messages.tsx:81)
  const who = (m: Message) => (m.senderId === t?.conversation.memberId ? open?.memberName ?? 'Member' : m.senderId === t?.conversation.coachId ? open?.coachName ?? 'Coach' : 'Bioptime');
  const openFile = async (a: Attachment) => {
    setErr(null);
    try { const r = await post<{ url: string }>(`/attachments/${a.id}/file-token`); await WebBrowser.openBrowserAsync(`${apiBaseSync()}${r.url}`); }
    catch (e) { setErr(errorText(e)); }
  };
  useEffect(() => { const h = setTimeout(() => ref.current?.scrollToEnd({ animated: false }), 50); return () => clearTimeout(h); }, [t]);
  const title = open ? `${open.memberName} ↔ ${open.coachName}` : 'Conversation';
  const refresh = () => { void thread.reload(); void convs.reload(); };
  const items = t?.items ?? [];
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['bottom']}>
    <Stack.Screen options={{ title, headerRight: () => <AdminBell /> }} />
    <RoleGate workspace="admin">
      <ScrollView ref={ref} contentContainerStyle={{ padding: space.lg, gap: space.sm, flexGrow: 1 }} refreshControl={allowed ? <RefreshControl refreshing={thread.loading} onRefresh={refresh} tintColor={colors.muted} /> : undefined}>
        <RequirePermission permission="members.manage">
          <StaleBanner at={thread.stale} /><ErrorBox error={thread.error} onRetry={thread.reload} />
          {err ? <Notice kind="error">{err}</Notice> : null}
          {t ? <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, marginBottom: space.sm }}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: font.body, flex: 1 }} numberOfLines={2}>{title}</Text>
            <Button title="Open client" variant="ghost" small onPress={() => router.push(`/admin/clients/${t.conversation.memberId}`)} />
          </View> : null}
          {thread.loading && !t ? <Loading /> : t ? <>
            {items.map((m) => {
              const coach = m.senderId === t.conversation.coachId;
              return <View key={m.id} style={{ alignSelf: coach ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
                {m.body ? <View style={{ backgroundColor: coach ? colors.raised : colors.surface, padding: 12, borderRadius: radius.lg, borderBottomRightRadius: coach ? 4 : radius.lg, borderBottomLeftRadius: coach ? radius.lg : 4 }}><Text style={{ color: colors.text, fontSize: font.body, lineHeight: 21 }}>{m.body}</Text></View> : null}
                {(m.attachments ?? []).length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs, justifyContent: coach ? 'flex-end' : 'flex-start' }}>
                  {(m.attachments ?? []).map((a) => <Chip key={a.id} onPress={filesOn ? () => { void openFile(a); } : undefined}>{`${a.kind === 'pdf' ? 'PDF' : 'IMG'} · ${a.name} · ${size(a.bytes)}`}</Chip>)}
                </View> : null}
                <Text style={{ color: colors.muted, fontSize: font.tiny, marginTop: 3, textAlign: coach ? 'right' : 'left' }}>{`${who(m)} · ${fmtDateTime(m.createdAt)}`}</Text>
              </View>;
            })}
            {!items.length ? <Empty title="No messages yet. Say hello." /> : null}
            <Text style={{ color: colors.muted, fontSize: font.tiny, textAlign: 'center', marginTop: space.md }}>Administrators can read threads for support; writing is between a member and their coach.</Text>
          </> : null}
        </RequirePermission>
      </ScrollView>
    </RoleGate>
  </SafeAreaView>;
}
