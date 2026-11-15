/* Coach › Settings (the portal's /coach/settings, pages/Settings.tsx for a coach): Security (password; the MFA pill),
   Active sessions, the profile form and Availability (components/coach/settingsCards). The administrators' Runtime,
   Features, Templates, Integrations and Metrics cards are never shown to a coach. */
import { Stack } from 'expo-router';
import React, { useState } from 'react';
import { Screen, Title } from '@/components/ui';
import { RoleGate } from '@/components/workspaceShell';
import { Enter, MotionCard } from '@/motion';
import { coachScreenOptions } from '@/components/coach/bell';
import { AvailabilityCard, CoachProfileCard, SecurityCard, SessionsCard } from '@/components/coach/settingsCards';

export default function CoachSettings() {
  const [tick, setTick] = useState(0); // pull to refresh remounts the cards, which reload their own data
  const [refreshing, setRefreshing] = useState(false);
  const refresh = () => { setRefreshing(true); setTick((n) => n + 1); setTimeout(() => setRefreshing(false), 400); };
  return <RoleGate workspace="coach"><Screen refreshing={refreshing} onRefresh={refresh}>
    <Stack.Screen options={coachScreenOptions('Settings')} />
    <Enter><Title sub="Your profile as members see it, your working hours, availability and security.">Settings</Title></Enter>
    <MotionCard index={1} pressable={false}><SecurityCard key={`s${tick}`} /></MotionCard>
    <MotionCard index={2} pressable={false}><SessionsCard key={`d${tick}`} /></MotionCard>
    <MotionCard index={3} pressable={false}><CoachProfileCard key={`p${tick}`} /></MotionCard>
    <MotionCard index={4} pressable={false}><AvailabilityCard key={`a${tick}`} /></MotionCard>
  </Screen></RoleGate>;
}
