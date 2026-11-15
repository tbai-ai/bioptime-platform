/* Admin › Appointments (the web's /admin/appointments, members.manage): every consultation, check-in and review across
   coaches, upcoming, past or all. Administrators only read; confirming, completing, moving, cancelling, no-shows, join
   links and summaries are the coach's (apps/dashboard/src/pages/Appointments.tsx:30-31). A row opens the member's record. */
import { Stack, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { get, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime, label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { safeLink, tone } from '@/lib/admin/b1/common';
import type { Appointment } from '@/lib/admin/b1/types';
import { AdminBell } from '@/components/adminB1/adminBell';
import { DetailRow } from '@/components/adminB1/parts';
import { ErrorBox, Loading, Pill, Screen, StaleBanner, Title } from '@/components/ui';
import { EmptyState, RecordList, SegmentTabs } from '@/components/workspace';
import { RequirePermission, RoleGate } from '@/components/workspaceShell';
import { Enter } from '@/motion';

type Range = 'upcoming' | 'past' | 'all';
const RANGES: Array<{ id: Range; label: string }> = [{ id: 'upcoming', label: 'Upcoming' }, { id: 'past', label: 'Past' }, { id: 'all', label: 'All' }];

export default function AdminAppointments() {
  const router = useRouter();
  const { can } = useAuth();
  const allowed = can('members.manage');
  const [range, setRange] = useState<Range>('upcoming');
  const list = useLoad<{ items: Appointment[] } | null>(allowed ? `admin-appointments-${range}` : null, () => (allowed ? get(`/admin/appointments${qs({ range })}`) : Promise.resolve(null)), [allowed, range]);
  const items = list.data?.items ?? [];
  // the table's columns as lines: when · kind · coach, then the entitlement and join-link notes, then the note
  const lines = (a: Appointment) => [`${fmtDateTime(a.startAt)} · ${label(a.kind)} · ${a.coachName ?? '—'}`, [a.consumesEntitlement ? 'uses entitlement' : null, a.status === 'scheduled' && safeLink(a.meetingLink) ? 'Join link added' : null].filter(Boolean).join(' · '), a.memberNote ?? a.note ?? ''];
  return <Screen refreshing={list.loading} onRefresh={list.reload}>
    <Stack.Screen options={{ title: 'Appointments', headerRight: () => <AdminBell /> }} />
    <RoleGate workspace="admin">
      <RequirePermission permission="members.manage">
        <Enter><Title sub="Every consultation, check-in and review across coaches.">Appointments</Title></Enter>
        <SegmentTabs items={RANGES} value={range} onChange={(v) => setRange(v as Range)} />
        <StaleBanner at={list.stale} /><ErrorBox error={list.error} onRetry={list.reload} />
        {list.loading && !list.data ? <Loading /> : list.data ? <Enter index={1}>
          {items.length ? <RecordList>
            {items.map((a, i) => <DetailRow key={a.id} last={i === items.length - 1} title={a.memberName} lines={lines(a)} right={<Pill tone={tone(a.status)}>{label(a.status)}</Pill>} onPress={() => router.push(`/admin/clients/${a.memberId}`)} />)}
          </RecordList> : <EmptyState title="No appointments" body={range === 'upcoming' ? "Schedule one from a client's page." : undefined} icon="calendar-outline" />}
        </Enter> : null}
      </RequirePermission>
    </RoleGate>
  </Screen>;
}
