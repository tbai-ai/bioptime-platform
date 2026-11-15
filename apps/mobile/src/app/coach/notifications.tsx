/* Coach › Notifications: the portal's Shell bell popover on its own screen (the bell in every coach header opens it,
   components/coach/bell). The popover's wording: the title "Notifications", "Mark all read", each item's title, body and
   relative time, and "Nothing yet." when there is none. The same two endpoints as the web Shell: GET /notifications and
   POST /notifications/read { all: true }; afterwards the bell's count and the tab badges reload. A notification is shown
   as the server wrote it; this screen adds no wording of its own about what notifications carry. */
import { Stack } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { errorText, get, post } from '@/lib/api';
import { relative } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Button, Card, ErrorBox, Loading, P, Row, Screen, StaleBanner, Title } from '@/components/ui';
import { RoleGate, notifyBadges } from '@/components/workspaceShell';
import { Enter, MotionCard } from '@/motion';
import { coachScreenOptions, refreshCoachBell } from '@/components/coach/bell';
import { ToastView, useToast } from '@/components/coach/shared';
import { colors, font, space } from '@/theme';

type Notification = { id: string; title: string; body?: string | null; category?: string; created_at: string; read_at?: string | null };

export default function CoachNotifications() {
  // the screen shows the latest fifty (the server's default page); the portal's popover shows twelve of the same list
  const n = useLoad<{ items: Notification[]; unread: number }>('coach-notifications', () => get('/notifications?limit=50'), []);
  const { toast, show } = useToast();
  const [busy, setBusy] = useState(false);
  const items = n.data?.items ?? [];
  const readAll = async () => {
    setBusy(true);
    try { await post('/notifications/read', { all: true }); await n.reload(); refreshCoachBell(); notifyBadges(); }
    catch (e) { show(errorText(e), 'error'); } finally { setBusy(false); }
  };
  return <RoleGate workspace="coach"><Screen refreshing={n.loading} onRefresh={n.reload}>
    <Stack.Screen options={coachScreenOptions('Notifications')} />
    <Enter><Row between style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
      <View style={{ flex: 1 }}><Title>Notifications</Title></View>
      <Button title="Mark all read" small variant="ghost" busy={busy} onPress={readAll} />
    </Row></Enter>
    <StaleBanner at={n.stale} /><ErrorBox error={n.error} onRetry={n.reload} />
    <ToastView toast={toast} />
    {n.loading && !n.data ? <Loading /> : n.data ? <MotionCard index={1} pressable={false}><Card>
      {items.length ? items.map((x, i) => <View key={x.id} style={[styles.item, i === items.length - 1 && { borderBottomWidth: 0 }, !!x.read_at && styles.read]} accessibilityLabel={`${x.read_at ? '' : 'Unread: '}${x.title}`}>
        <View style={[styles.dot, !x.read_at && { backgroundColor: colors.brand }]} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>{x.title}</Text>
          {x.body ? <Text style={styles.body}>{x.body}</Text> : null}
          <Text style={styles.time}>{relative(x.created_at)}</Text>
        </View>
      </View>) : <P muted>Nothing yet.</P>}
    </Card></MotionCard> : null}
  </Screen></RoleGate>;
}

const styles = StyleSheet.create({
  item: { flexDirection: 'row', gap: space.sm, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  read: { opacity: 0.7 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.borderStrong, marginTop: 7 },
  title: { color: colors.text, fontSize: font.body, fontWeight: '700' },
  body: { color: colors.text, fontSize: font.small, lineHeight: 18, marginTop: 2 },
  time: { color: colors.muted, fontSize: font.tiny, marginTop: 2 },
});
