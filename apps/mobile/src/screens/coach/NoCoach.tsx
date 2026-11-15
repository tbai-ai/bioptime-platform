/* The Coach tab before a coach is assigned: the honest waiting state in the earlier app's empty-state style, with
   Bioptime's own sentences. A calm photo band (slot coach.empty.header: shown only here, fully faded before any text,
   and never beside a name) sits above the empty tile. "Being matched" while an assignment request is open, "The team is
   choosing" when it needs a person to decide, "Not assigned yet" otherwise; before a package is bought the next real
   action is to choose one. Box breathing works without a coach (it stays on the device). While waiting the member can
   still reach a person: "Ask the Bioptime team" opens a new coaching request in Help (support_requests). Once the
   assignment has landed (GET /me says the coach's status) and the coach's details are on their way, it says so instead
   of "Not assigned yet" (the Coach screen reloads them as soon as GET /me changes). */
import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, EmptyState, Photo, Scrim, ScreenHeader, TabScreen } from '@/fx';
import { useFeatures } from '@/lib/features';
import { BreathingCard } from './BreathingCard';
import type { Me } from './types';

export function NoCoach({ me, refreshing, onRefresh, children }: { me: Me | null; refreshing: boolean; onRefresh: () => void; children?: React.ReactNode }) {
  const status = me?.assignmentStatus;
  const features = useFeatures(true);
  const askOn = !!features?.has('support_requests');
  // GET /me names the coach's own status (active, paused) once one is assigned
  const assigned = !!status && !['pending', 'needs_attention', 'none'].includes(status);
  const title = assigned ? 'Your coach is assigned' : status === 'pending' ? 'Being matched' : status === 'needs_attention' ? 'The team is choosing' : 'Not assigned yet';
  const body = assigned ? 'Opening your conversation with your coach.'
    : me?.programme
      ? 'Bioptime matches you with a coach by expertise, language and availability, and tells you here.'
      : 'Bioptime matches you with a coach after the payment is confirmed and tells you here.';
  const ask = askOn ? <Button title="Ask the Bioptime team" icon="message-square" variant="redTint" iconRight={null} label="Ask the Bioptime team a question" onPress={() => router.push('/help?section=requests&ask=coaching')} /> : null;
  return <TabScreen refreshing={refreshing} onRefresh={onRefresh}>
    <ScreenHeader title="Coach" subtitle="Your coach, consultations and messages." />
    {children}
    <View style={styles.band} pointerEvents="none">
      <Photo slot="coach.empty.header" opacity={0.15} style={StyleSheet.absoluteFill} decorative />
      <Scrim kind="emptyBand" style={StyleSheet.absoluteFill} />
    </View>
    <EmptyState
      icon="users"
      title={title}
      body={body}
      action={me?.programme ? (assigned ? undefined : ask ?? undefined) : { title: 'See packages', icon: 'package', onPress: () => router.push('/(tabs)/store') }}
      style={styles.empty}
    />
    <View style={styles.pad}><BreathingCard /></View>
  </TabScreen>;
}

const styles = StyleSheet.create({
  band: { height: 160, marginBottom: -72, overflow: 'hidden' },
  empty: { paddingHorizontal: 24 },
  pad: { paddingHorizontal: 20, paddingBottom: 8 },
});
