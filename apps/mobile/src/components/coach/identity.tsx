/* The coach's identity block, shared by Today and My profile (the portal's pages/coach/CoachProfile.tsx CoachIdentity):
   the initials, the display name, the account, availability and profile pills, designation and expertise, and the
   facts (coach ID, work email, caseload, upcoming consultations, unread, coaching since). The coach's own work email is
   the one address the portal shows a coach (their own). */
import React from 'react';
import { View } from 'react-native';
import { fmtDate, label } from '@/lib/format';
import { Card, Pill, Row } from '@/components/ui';
import { KeyValue } from '@/components/workspace';
import { pillTone } from '@/lib/coach/core/format';
import { Avatar, Bold, Code, Small } from './shared';
import { space } from '@/theme';

export type CoachRecord = { id: string; coachCode?: string | null; designation?: string | null; displayName: string; name?: string; bio?: string | null; expertise?: string[]; languages?: string[]; city?: string | null; timezone?: string; qualifications?: string[]; scope?: string[]; email?: string; state?: string; mfaEnabled?: boolean; lastLoginAt?: string | null; caseloadLimit?: number; caseload?: number; available?: boolean; unavailableUntil?: string | null; activatedAt?: string | null; profileStatus?: 'complete' | 'incomplete' };

export function CoachIdentity({ coach, upcoming, unread }: { coach: CoachRecord; upcoming?: number; unread?: number }) {
  const rows: Array<{ label: string; value: React.ReactNode }> = [
    { label: 'Coach ID', value: <Code>{coach.coachCode ?? '—'}</Code> },
    { label: 'Work email', value: coach.email ?? '—' },
    { label: 'Caseload', value: `${coach.caseload ?? 0} of ${coach.caseloadLimit ?? 0} clients` },
  ];
  if (upcoming !== undefined) rows.push({ label: 'Upcoming consultations', value: String(upcoming) });
  if (unread !== undefined) rows.push({ label: 'Unread', value: `${unread} conversation${unread === 1 ? '' : 's'}` });
  if (coach.activatedAt) rows.push({ label: 'Coaching since', value: fmtDate(coach.activatedAt) });
  return <Card>
    <Row style={{ alignItems: 'flex-start', flexWrap: 'nowrap', gap: space.md }}>
      <Avatar name={coach.displayName || coach.name} size={44} />
      <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>
        <Bold>{coach.displayName}</Bold>
        <Row>
          <Pill tone={pillTone(coach.state ?? 'active')}>{label(coach.state ?? 'active')}</Pill>
          <Pill tone={coach.available ? 'success' : 'info'}>{coach.available ? 'Available' : `Away${coach.unavailableUntil ? ` until ${fmtDate(coach.unavailableUntil)}` : ''}`}</Pill>
          <Pill tone={coach.profileStatus === 'complete' ? 'success' : 'warning'}>{coach.profileStatus === 'complete' ? 'Profile complete' : 'Profile incomplete'}</Pill>
        </Row>
        <Small>{`${coach.designation ?? 'Coach'} · ${(coach.expertise ?? []).join(', ') || 'expertise not set'}`}</Small>
      </View>
    </Row>
    <KeyValue rows={rows} />
  </Card>;
}
