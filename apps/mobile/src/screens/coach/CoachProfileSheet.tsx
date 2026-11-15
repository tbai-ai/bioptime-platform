/* The coach's profile sheet (opened from the Coach header): the monogram medallion turning in, the name, "Your coach"
   with the city and the assignment status in words, the bio, then the details GET /me/coach permits a member to see:
   expertise, languages, qualifications (Bioptime shows them once verified) and scope (wellness and fitness coaching,
   never medical advice). While the coach is away, Bioptime's notice, word for word. Then the ways on: the coach's
   recommendations, and "Coach AI and your data" while the 'ai' module is on or a consent is on record (the whileOff
   rule: withdrawing must stay reachable). Last, how to ask for a different coach (there is no switch in the app). */
import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Medallion, Notice, Pill, SettingsRow, Sheet, T, fx } from '@/fx';
import { ChipRow, STATUS_WORD, SectionLabel, type CoachStatus } from './parts';
import type { Coach } from './types';

export function CoachProfileSheet({ visible, onClose, coach, status, notes, showCoachAi, supportEmail }: {
  visible: boolean; onClose: () => void; coach: Coach; status: CoachStatus; notes: number; showCoachAi: boolean; supportEmail: string | null;
}) {
  const go = (href: '/recommendations' | '/coach-ai') => { onClose(); router.push(href); };
  return <Sheet visible={visible} onClose={onClose} tall closeButton>
    <View style={styles.top}>
      {visible ? <Medallion name={coach.displayName} size={72} turnIn follow /> : <View style={styles.medalSpace} />}
      <View style={styles.flex}>
        <T v="card24" accessibilityRole="header">{coach.displayName}</T>
        <T v="bodySm" color={fx.ink.a70}>{[coach.designation || 'Your coach', coach.city].filter(Boolean).join(' · ')}</T>
        <Pill tone={status === 'active' ? 'success' : status === 'paused' ? 'warning' : 'info'} style={styles.pill}>{STATUS_WORD[status]}</Pill>
      </View>
    </View>
    {coach.bio ? <T v="body" color={fx.ink.a90} style={styles.bio}>{coach.bio}</T> : null}
    {status === 'paused' ? <Notice kind="warning" title="Away for now" style={styles.block}>Your coach is away. Your plan and bookings stay as they are, messages wait for your coach, and Bioptime can reassign you if needed.</Notice> : null}
    <View style={styles.block}>
      <SectionLabel style={styles.label}>Expertise</SectionLabel>
      {coach.expertise?.length ? <ChipRow items={coach.expertise} /> : <T v="bodySm" color={fx.ink.a60}>—</T>}
    </View>
    <View style={styles.block}>
      <SectionLabel style={styles.label}>Languages</SectionLabel>
      {coach.languages?.length ? <ChipRow items={coach.languages} /> : <T v="bodySm" color={fx.ink.a60}>—</T>}
    </View>
    <View style={styles.block}>
      <SectionLabel style={styles.label}>Qualifications</SectionLabel>
      {coach.qualifications?.length ? <ChipRow items={coach.qualifications} /> : <T v="bodySm" color={fx.ink.a60}>Shown once verified by Bioptime</T>}
    </View>
    <View style={styles.block}>
      <SectionLabel style={styles.label}>Scope</SectionLabel>
      {coach.scope?.length ? <ChipRow items={coach.scope} /> : <T v="bodySm" color={fx.ink.a60}>Wellness and fitness coaching; not medical advice</T>}
    </View>
    <View style={[styles.block, styles.rows]}>
      {notes ? <SettingsRow icon="clipboard-list" title="Recommendations" sub={`${notes} note${notes === 1 ? '' : 's'} from your coach`} onPress={() => go('/recommendations')} /> : null}
      {showCoachAi ? <SettingsRow icon="shield-check" title="Coach AI and your data" sub="Whether your coach may use Coach AI for drafts about you" onPress={() => go('/coach-ai')} /> : null}
    </View>
    <T v="bodySm" color={fx.ink.a60} style={styles.block}>{`You can ask for a different coach by writing to the Bioptime team at ${supportEmail ?? 'the support address'}; there is no switch for it in the app.`}</T>
  </Sheet>;
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 16 },
  medalSpace: { width: 72, height: 72 },
  flex: { flex: 1, minWidth: 0, gap: 4 },
  pill: { marginTop: 4 },
  bio: { fontSize: 15, lineHeight: 23 },
  block: { marginTop: 20 },
  label: { marginBottom: 10 },
  rows: { gap: 10 },
});
