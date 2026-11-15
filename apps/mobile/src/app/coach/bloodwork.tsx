/* Coach › Bloodwork (the portal's /coach/bloodwork, pages/Bloodwork.tsx for a coach): GET /coach/reports and
   GET /coach/bookings (both only clients who share health records), two tabs, the portal's rows, errors and empties.
   The Catalogue tab and the Release, Override and Price dialogs are administrators' and are not here. */
import { Stack, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { get } from '@/lib/api';
import { fmtDate, fmtDateTime, relative } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Button, Card, Empty, Loading, Notice, Pill, Row, Screen, StaleBanner, Title } from '@/components/ui';
import { SegmentTabs } from '@/components/workspace';
import { RoleGate } from '@/components/workspaceShell';
import { Enter, MotionCard } from '@/motion';
import { coachScreenOptions } from '@/components/coach/bell';
import { Bold, LinkText, Muted, Small, StatusPill, WarnPills } from '@/components/coach/shared';
import { space } from '@/theme';

export default function CoachBloodwork() {
  const router = useRouter();
  const [tab, setTab] = useState('reports');
  const reports = useLoad<any>('coach-reports', () => get('/coach/reports'), []);
  const bookings = useLoad<any>('coach-bookings', () => get('/coach/bookings'), []);
  const rep: any[] = reports.data?.items ?? [];
  const bk: any[] = bookings.data?.items ?? [];
  const reload = () => { void reports.reload(); void bookings.reload(); };
  return <RoleGate workspace="coach"><Screen refreshing={reports.loading || bookings.loading} onRefresh={reload} depth>
    <Stack.Screen options={coachScreenOptions('Bloodwork')} />
    <Enter><Title sub="Reports to review for your clients, and their bookings. Reviewing a report releases it to the member and completes the booking.">Bloodwork</Title></Enter>
    <SegmentTabs items={[{ id: 'reports', label: 'Reports', count: rep.filter((r) => !r.reviewed).length }, { id: 'bookings', label: 'Bookings' }]} value={tab} onChange={setTab} style={{ marginHorizontal: -space.lg }} />
    {tab === 'reports' ? <>
      <StaleBanner at={reports.stale} />
      {reports.error ? <Notice kind="error" title="Reports could not be loaded">{reports.error.message}</Notice> : reports.loading && !reports.data ? <Loading /> : rep.length ? rep.map((r, i) => <MotionCard key={r.id} index={1 + i} pressable={false}><Card>
        <Row between style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
          <View style={{ flex: 1, minWidth: 0 }}><LinkText onPress={() => router.push(`/coach/clients/${r.memberId}`)}>{r.memberName ?? r.memberId}</LinkText><Muted>{r.reference}</Muted></View>
          {r.reviewed ? <Small>{`${r.reviewerName} · ${fmtDate(r.reviewedAt)}`}</Small> : <Pill tone="warning">Awaiting review</Pill>}
        </Row>
        <Bold>{r.test?.name ?? 'Report'}</Bold>
        <Small>{`Delivered ${relative(r.deliveredAt)}`}</Small>
        <WarnPills items={r.flagged} />
        <Button title={r.reviewed ? 'Open' : 'Review'} small variant={r.reviewed ? 'secondary' : 'primary'} onPress={() => router.push(`/coach/reports/${r.id}`)} style={{ alignSelf: 'flex-start' }} />
      </Card></MotionCard>) : <Card><Empty title="No reports" body="Laboratory reports appear here when the vendor delivers them." /></Card>}
    </> : <>
      <StaleBanner at={bookings.stale} />
      {bookings.error ? <Notice kind="error" title="Bookings could not be loaded">{bookings.error.message}</Notice> : bookings.loading && !bookings.data ? <Loading /> : bk.length ? bk.map((b, i) => <MotionCard key={b.id} index={1 + i} pressable={false}><Card>
        <Row between style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}><Bold>{b.reference}</Bold><StatusPill status={b.status} /></Row>
        <LinkText onPress={() => router.push(`/coach/clients/${b.memberId}`)}>{b.memberName ?? 'Member'}</LinkText>
        <Small>{`${b.test?.name ?? 'Blood test'} · ${fmtDateTime(b.slotAt)}`}</Small>
        {b.flag ? <Muted>{b.flag}</Muted> : null}
        <Muted>{`Laboratory ${b.vendorOrderId ?? '—'}${b.vendorStatus ? ` · ${b.vendorStatus}` : ''}${b.simulated ? ' · stand-in' : ''}`}</Muted>
      </Card></MotionCard>) : <Card><Empty title="No bookings" /></Card>}
    </>}
  </Screen></RoleGate>;
}
