/* Admin › Announcements (the web's /admin/announcements, modules/messaging/AdminAnnouncements.tsx; messaging module,
   announcements.manage): the team's announcements to members and the coaches' announcements to their own clients, with
   whom each reaches, its status and how many read it. A row opens the announcement (/admin/announcements/[id]): the
   editor for the team's drafts and scheduled ones, read only otherwise; "New announcement" opens an empty draft.
   GET /admin/announcements → { items }. */
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useRef } from 'react';
import { View } from 'react-native';
import { get } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { STATUS_PILL, audienceText, whenText, type ManagedAnnouncement } from '@/lib/admin/modules2/announcements';
import { DetailRow } from '@/components/adminB2/parts';
import { Button, ErrorBox, Loading, Notice, Screen, StaleBanner, Title } from '@/components/ui';
import { EmptyState, RecordList } from '@/components/workspace';
import { AdminModuleGate } from '@/components/adminModules2/frame';
import { Enter } from '@/motion';
import { space } from '@/theme';

const TITLE = 'Announcements';

export default function AdminAnnouncementsScreen() {
  return <AdminModuleGate title={TITLE} module="messaging" permission="announcements.manage"><Body /></AdminModuleGate>;
}

function Body() {
  const router = useRouter();
  const list = useLoad<{ items: ManagedAnnouncement[] }>('admin-announcements', () => get('/admin/announcements'), []);
  // back from an announcement: read the list again quietly (it may have been saved, published or withdrawn)
  const first = useRef(true);
  useFocusEffect(useCallback(() => { if (first.current) { first.current = false; return; } void list.reload(); }, [list.reload])); // eslint-disable-line react-hooks/exhaustive-deps
  const items = list.data?.items ?? [];
  return <Screen refreshing={list.loading} onRefresh={list.reload}>
    <Enter><Title sub="News for members in the portal and the app: write a draft, choose who it reaches, then publish it or schedule it. Members are notified when it goes out.">{TITLE}</Title></Enter>
    <Enter index={1}><Button title="New announcement" small onPress={() => router.push('/admin/announcements/new')} style={{ alignSelf: 'flex-start' }} /></Enter>
    <Notice kind="info" title="Service news only">Announcements carry service news, such as opening hours or a change to bookings. Clinical guidance, results, prices or promises need the owner’s approved wording first. Text is kept plain: any markup is removed when saved.</Notice>
    <StaleBanner at={list.stale} />
    <ErrorBox error={list.error} onRetry={list.reload} />
    {list.loading && !list.data ? <Loading /> : list.data ? (items.length ? <Enter index={2}><RecordList title="Announcements">
      {items.map((a) => <DetailRow key={a.id} title={a.title}
        lines={[
          a.origin === 'coach' ? `From ${a.createdBy.name ?? 'a coach'}` : whenText(a),
          `Reaches: ${audienceText(a)}${a.reach.members !== null ? ` · ${a.reach.members}` : ''}`,
          `Read: ${a.status === 'published' || a.status === 'withdrawn' ? a.reach.reads : '—'}`,
        ]}
        pills={[{ label: STATUS_PILL[a.status].label, tone: STATUS_PILL[a.status].tone }]}
        onPress={() => router.push(`/admin/announcements/${a.id}`)} />)}
    </RecordList></Enter> : <View style={{ marginTop: space.sm }}><EmptyState title="No announcements yet" body="Write one with New announcement." /></View>) : null}
  </Screen>;
}
