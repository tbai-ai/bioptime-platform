/* Announcements (M9, flag 'messaging'): news from the Bioptime team and from the member's own coach to their clients,
   newest first, with "Mark read". Plain text only; announcements are service news, never medical advice. A withdrawn
   announcement disappears from this list at once (the server decides who sees what when the list is read).
   In the client app's overlay chrome (BUILD_PLAN §6.2): each announcement is a glass card with who sent it, "New" while
   unread, the title, the text and when; the Home bell's News tab shows the latest ten. */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, EmptyState, ErrorState, Eyebrow, fx, GlassCard, Notice, Overlay, Pill, pollUpdates, Reveal, StaleBanner, T, useFocusRefresh } from '@/fx';
import { errorText, get, post } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';

type Announcement = { id: string; title: string; body: string; origin: 'team' | 'coach'; from: string; publishedAt: string; read: boolean; readAt: string | null };
type List = { items: Announcement[]; unread: number };

export default function Announcements() {
  const list = useLoad<List>('announcements', () => get('/me/announcements'), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useFocusRefresh(list.reload);
  const d = list.data;
  const markRead = async (a: Announcement) => {
    setBusy(a.id); setMsg(null);
    try { await post(`/me/announcements/${a.id}/read`); await list.reload(); void pollUpdates(); } catch (e) { setMsg(errorText(e)); } finally { setBusy(null); }
  };
  return <Overlay title="Announcements" subtitle="News from the Bioptime team and from your coach. Service news only, never medical advice." kind="back" fallback="/(tabs)">
    <StaleBanner at={list.stale} />
    <ErrorState error={list.error} onRetry={list.reload} />
    {msg ? <Notice kind="error">{msg}</Notice> : null}
    {d && !d.items.length ? <EmptyState icon="megaphone" photo="messages" title="No announcements" body="When the Bioptime team or your coach announces something, it appears here and you get a notification." /> : null}
    {(d?.items ?? []).map((a, i) => <Reveal key={a.id} mount index={i}>
      <GlassCard rule={a.read ? undefined : { color: fx.red.brand }}>
        <View style={styles.top}>
          <Eyebrow kind="label" style={styles.flex}>{a.from}</Eyebrow>
          {a.read ? null : <Pill tone="warning">New</Pill>}
        </View>
        <T v="cardTitle" accessibilityRole="header" style={styles.title}>{a.title}</T>
        <T v="body" color={fx.ink.a80}>{a.body}</T>
        <View style={styles.foot}>
          <T v="caption" color={fx.ink.a50} style={styles.flex}>{fmtDateTime(a.publishedAt)}</T>
          {a.read ? null : <Button title="Mark read" variant="link" iconRight={null} busy={busy === a.id} onPress={() => { void markRead(a); }} />}
        </View>
      </GlassCard>
    </Reveal>)}
  </Overlay>;
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  title: { marginTop: 8, marginBottom: 6 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, minHeight: 24 },
});
