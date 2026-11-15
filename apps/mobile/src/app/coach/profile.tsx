/* Coach › My profile (the portal's /coach/profile, pages/coach/CoachProfile.tsx): GET /coach/profile and GET /coach/home
   for the identity card's counts; the hero, the identity card, the profile form, the professional record set by
   Bioptime, availability and security (components/coach/settingsCards). */
import { Stack } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { get } from '@/lib/api';
import { fmtDateTime, label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { ErrorBox, Eyebrow, Loading, Screen, StaleBanner, Title } from '@/components/ui';
import { RoleGate } from '@/components/workspaceShell';
import { Enter, MotionCard } from '@/motion';
import { coachScreenOptions } from '@/components/coach/bell';
import { CoachIdentity } from '@/components/coach/identity';
import { AvailabilityCard, CoachProfileCard, ProfessionalRecordCard, SecurityCard } from '@/components/coach/settingsCards';

export default function CoachProfile() {
  const p = useLoad<any>('coach-profile', () => get('/coach/profile'), []);
  const home = useLoad<any>('coach-home', () => get('/coach/home'), []);
  const d = p.data;
  const h = home.data;
  return <RoleGate workspace="coach"><Screen refreshing={p.loading} onRefresh={() => { void p.reload(); void home.reload(); }}>
    <Stack.Screen options={coachScreenOptions('My profile')} />
    <StaleBanner at={p.stale} /><ErrorBox error={p.error} onRetry={p.reload} />
    {p.loading && !d ? <Loading /> : d ? <>
      <Enter><View><Eyebrow>Coach profile</Eyebrow><Title sub={`Coach ID ${d.coachCode ?? '—'} · ${d.designation ?? 'Coach'} · account ${label(d.state)}${d.lastLoginAt ? ` · last sign-in ${fmtDateTime(d.lastLoginAt)}` : ''}`}>{d.displayName}</Title></View></Enter>
      <MotionCard index={1} pressable={false}><CoachIdentity coach={d} upcoming={h ? h.metrics?.upcomingConsultations : undefined} unread={h ? h.unreadConversations?.length : undefined} /></MotionCard>
      <MotionCard index={2} pressable={false}><CoachProfileCard onSaved={() => { void p.reload(); }} /></MotionCard>
      <MotionCard index={3} pressable={false}><ProfessionalRecordCard d={d} /></MotionCard>
      <MotionCard index={4} pressable={false}><AvailabilityCard onChanged={() => { void p.reload(); }} /></MotionCard>
      <MotionCard index={5} pressable={false}><SecurityCard /></MotionCard>
    </> : null}
  </Screen></RoleGate>;
}
