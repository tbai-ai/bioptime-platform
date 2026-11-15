/* Admin › Live sessions (the web's /admin/sessions, modules/sessions/HostSessions.tsx admin mode; sessions module,
   sessions.manage): every group class, webinar and workshop, whoever hosts it, upcoming, past or all; public webinars
   are set up here. "New session" opens the form (a draft until published) and then the new session.
   GET /admin/sessions?range → { items }. */
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { get, qs } from '@/lib/api';
import { label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { DetailRow } from '@/components/adminB2/parts';
import { fmtSpan } from '@/components/coachModules/shared';
import { AUDIENCE_SHORT, placesText, type Session } from '@/components/coachModules/sessions';
import { Button, Card, Empty, ErrorBox, Loading, Notice, Screen, StaleBanner, Title } from '@/components/ui';
import { RecordList, SegmentTabs } from '@/components/workspace';
import { AdminModuleGate, setPendingToast } from '@/components/adminModules2/frame';
import { AdminSessionForm } from '@/components/adminModules2/sessions';
import { Enter } from '@/motion';

type Range = 'upcoming' | 'past' | 'all';
const TITLE = 'Live sessions';
const STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'info' }> = { published: { label: 'Open', tone: 'success' }, draft: { label: 'Draft', tone: 'warning' }, completed: { label: 'Completed', tone: 'success' }, cancelled: { label: 'Cancelled', tone: 'info' } };

export default function AdminSessionsScreen() {
  return <AdminModuleGate title={TITLE} module="sessions" permission="sessions.manage"><Body /></AdminModuleGate>;
}

function Body() {
  const router = useRouter();
  const [range, setRange] = useState<Range>('upcoming');
  const [creating, setCreating] = useState(false);
  const list = useLoad<{ items: Session[] }>(`admin-sessions-${range}`, () => get(`/admin/sessions${qs({ range })}`), [range]);
  const first = useRef(true);
  useFocusEffect(useCallback(() => { if (first.current) { first.current = false; return; } void list.reload(); }, [list.reload])); // eslint-disable-line react-hooks/exhaustive-deps
  const items = list.data?.items ?? [];
  return <Screen refreshing={list.loading} onRefresh={list.reload}>
    <Enter><Title sub="Every group class, webinar and workshop, whoever hosts it. Public webinars are set up here.">{TITLE}</Title></Enter>
    <Enter index={1}><Button title="New session" small onPress={() => setCreating(true)} style={{ alignSelf: 'flex-start' }} /></Enter>
    <Notice kind="info" title="Video meetings: pending configuration">No video provider is connected, so no meeting is created for a session. Add the https link you will use, or members read that the host will share how to join.</Notice>
    <SegmentTabs items={[{ id: 'upcoming', label: 'Upcoming' }, { id: 'past', label: 'Past' }, { id: 'all', label: 'All' }]} value={range} onChange={(v) => setRange(v as Range)} />
    <StaleBanner at={list.stale} />
    <ErrorBox error={list.error} onRetry={list.reload} />
    {list.loading && !list.data ? <Loading /> : list.data ? (items.length ? <Enter index={2}><RecordList title="Live sessions">
      {items.map((s) => <DetailRow key={s.id} title={s.title}
        lines={[
          fmtSpan(s.startAt, s.endAt),
          `${s.kindLabel} · ${s.hostName}${s.hostRole !== 'coach' ? ' · Bioptime team' : ''}`,
          `${AUDIENCE_SHORT[s.audience] ?? label(s.audience)}${s.packages?.length ? `: ${s.packages.map((p) => p.name).join(', ')}` : ''} · ${placesText(s)}`,
        ]}
        pills={[STATUS[s.status] ?? { label: label(s.status), tone: 'info' }]}
        onPress={() => router.push(`/admin/sessions/${s.id}`)} />)}
    </RecordList></Enter> : <Card><Empty title={range === 'upcoming' ? 'Nothing scheduled' : 'Nothing here'} body={range === 'upcoming' ? 'Create a session; it stays a draft until you publish it.' : undefined} /></Card>) : null}
    <AdminSessionForm open={creating} onClose={() => setCreating(false)} onSaved={(s) => { setPendingToast('Draft saved'); router.push(`/admin/sessions/${s.id}`); }} />
  </Screen>;
}
