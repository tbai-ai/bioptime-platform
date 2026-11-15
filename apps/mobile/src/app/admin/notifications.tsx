/* Admin › Notifications (/admin/notifications): what the portal's bell lists (GET /notifications, the newest 50) as a
   screen, opened from the bell in every admin header (components/adminB1 AdminBell). "Mark all read" is the popover's
   button (POST /notifications/read { all: true }); the bell and the tab badges reload at once afterwards, and the
   count line shows the result (the web's popover answers with no toast). */
import { Stack } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { errorText, get, post } from '@/lib/api';
import { label, relative } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import type { Notification } from '@/lib/admin/b1/types';
import { refreshAdminBell } from '@/components/adminB1/adminBell';
import { Button, Card, ErrorBox, Loading, Notice, P, Row, Screen, StaleBanner, Title } from '@/components/ui';
import { notifyBadges, RoleGate } from '@/components/workspaceShell';
import { Enter } from '@/motion';
import { colors, font, space } from '@/theme';

export default function AdminNotifications() {
  const n = useLoad<{ items: Notification[]; unread: number }>('admin-notifications', () => get('/notifications?limit=50'), []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const items = n.data?.items ?? [];
  const unread = n.data ? (n.data.unread ?? items.filter((x) => !x.read_at).length) : 0;
  const markAll = async () => {
    setBusy(true); setErr(null);
    try { await post('/notifications/read', { all: true }); await n.reload(); notifyBadges(); refreshAdminBell(); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <Screen refreshing={n.loading} onRefresh={n.reload}>
    <Stack.Screen options={{ title: 'Notifications' }} />
    <RoleGate workspace="admin">
      <Enter><Title>Notifications</Title></Enter>
      <StaleBanner at={n.stale} /><ErrorBox error={n.error} onRetry={n.reload} />
      {err ? <Notice kind="error">{err}</Notice> : null}
      {n.loading && !n.data ? <Loading /> : n.data ? <Enter index={1}><Card>
        <Row between><Text style={styles.count}>{unread ? `${unread} unread` : 'Nothing unread'}</Text>{items.length ? <Button title="Mark all read" variant="secondary" small onPress={markAll} disabled={!unread} busy={busy} /> : null}</Row>
        {items.length ? items.map((x) => <View key={x.id} style={[styles.row, !!x.read_at && { opacity: 0.7 }]}>
          <View style={[styles.dot, !x.read_at && { backgroundColor: colors.brand }]} />
          <View style={{ flex: 1 }}>
            <Row between><Text style={[styles.title, !x.read_at && { fontWeight: '700' }]}>{x.title}</Text><Text style={styles.time}>{relative(x.created_at)}</Text></Row>
            {x.body ? <Text style={styles.body}>{x.body}</Text> : null}
            {x.category ? <Text style={styles.cat}>{label(x.category)}</Text> : null}
          </View>
        </View>) : <P muted>Nothing yet.</P>}
      </Card></Enter> : null}
    </RoleGate>
  </Screen>;
}

const styles = StyleSheet.create({
  count: { color: colors.muted, fontSize: font.small },
  row: { flexDirection: 'row', gap: space.sm, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.borderStrong, marginTop: 6 },
  title: { color: colors.text, fontSize: font.body, flex: 1 },
  time: { color: colors.disabled, fontSize: font.tiny, marginTop: 3 },
  body: { color: colors.muted, fontSize: font.small, marginTop: 2 },
  cat: { color: colors.disabled, fontSize: font.tiny, marginTop: 2 },
});
