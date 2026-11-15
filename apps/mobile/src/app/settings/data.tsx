/* Your data: a copy of the member's data, or the deletion of the account, asked of the Bioptime team
   (POST /me/data-requests). Reached from Profile › Settings and Profile › Reports. */
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Alert } from '@/lib/alert';
import { errorText, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFeatures } from '@/lib/features';
import { Button, fx, GlassCard, haptics, Icon, Notice, Overlay, Reveal, T } from '@/fx';

/* With the support module on, an export request becomes a file once the team approves it, downloaded under Profile ›
   Settings › Help and support › Your data (src/app/help.tsx; api/domain/dataExport.ts). With it off, the request only
   reaches the team's queue: nothing generates or delivers a file in the app. A deletion request (api/domain/members.ts
   requestData) opens a task in the team's queue and marks the account deletion_requested, which blocks purchases;
   nothing is removed automatically and no email is sent about it. The only sign of it in the app is the account state
   under the name on Profile ((tabs)/profile.tsx, from /auth/me), which reads Deletion requested until the team closes
   the account or makes it active again. */
export default function Data() {
  const router = useRouter();
  const { refresh } = useAuth();
  const features = useFeatures(true);
  const exportsHere = !!features?.has('support');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const exportAsk = exportsHere ? 'Once the Bioptime team approves it, the file is prepared and a notification tells you it is ready to download under Profile › Settings › Help and support › Your data.' : 'Your request goes to the Bioptime team’s queue, and the team prepares the copy. There is no download for it in the app yet.';
  const exportDone = exportsHere ? 'Request recorded. A notification tells you when your copy is ready.' : 'Request recorded. It is in the Bioptime team’s queue.';
  const request = (kind: 'export' | 'deletion') => {
    if (kind === 'deletion') haptics.warning();
    Alert.alert(kind === 'export' ? 'Request a copy of your data?' : 'Request account deletion?', kind === 'export' ? exportAsk : 'You cannot make purchases while the request is open. It goes to the Bioptime team’s queue, and nothing is removed until the team acts on it. Records we must keep by law stay, without your name.', [{ text: 'Not now', style: 'cancel' }, { text: kind === 'export' ? 'Request' : 'Request deletion', style: kind === 'deletion' ? 'destructive' : 'default', onPress: async () => {
      setBusy(kind); setMsg(null);
      try { await post('/me/data-requests', { kind }); await refresh(); setMsg({ kind: 'success', text: kind === 'export' ? exportDone : 'Request recorded. It is in the Bioptime team’s queue.' }); haptics.success(); }
      catch (e) { setMsg({ kind: 'error', text: errorText(e) }); } finally { setBusy(null); }
    } }]);
  };
  return <Overlay kind="back" title="Your data" subtitle="What we hold, and how to take it with you or have it removed." fallback="/(tabs)/profile?tab=settings">
    {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
    <Reveal index={0} mount>
      <GlassCard>
        <View style={styles.head}><Icon name="download" size={16} color={fx.red.label} /><T v="label" color={fx.red.label}>Download</T></View>
        <T v="heading" accessibilityRole="header">A copy of your data</T>
        <T v="bodySm" color={fx.ink.a70} style={styles.body}>Your profile, goals, bookings, reports, progress and messages.{!features ? '' : exportsHere ? ' Once the Bioptime team approves your request, they are prepared as one file and a notification tells you it is ready. You download it under Help and support › Your data, where only you can open it.' : ' Asking records your request and puts it in the Bioptime team’s queue; the team prepares the copy. There is no download for it in the app yet. Questions about your request: privacy@bioptime.com.'}</T>
        <Button title="Request my data" variant="soft" onPress={() => request('export')} busy={busy === 'export'} />
        {exportsHere ? <Button title="Open Help and support" variant="link" iconRight={null} onPress={() => router.push('/help')} style={styles.link} /> : null}
      </GlassCard>
    </Reveal>
    <Reveal index={1} mount>
      <GlassCard>
        <View style={styles.head}><Icon name="trash-2" size={16} color={fx.red.label} /><T v="label" color={fx.red.label}>Delete</T></View>
        <T v="heading" accessibilityRole="header">Close your account</T>
        <T v="bodySm" color={fx.ink.a70} style={styles.body}>Asking puts your request in the Bioptime team’s queue. Nothing is removed until the team acts on it. While it is open, Profile shows your account as Deletion requested; the app shows nothing more about its progress: questions to privacy@bioptime.com. Deletion takes effect after any bookings in progress complete. Payment and order records are kept for the period the law requires, without your name.</T>
        <Button title="Request deletion" variant="redGlass" onPress={() => request('deletion')} busy={busy === 'deletion'} />
      </GlassCard>
    </Reveal>
    <T v="caption" color={fx.ink.a55} style={styles.foot}>Questions about privacy: privacy@bioptime.com. We acknowledge grievances within 48 hours.</T>
  </Overlay>;
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  body: { marginTop: 8, marginBottom: 16 },
  link: { alignSelf: 'flex-start', marginTop: 8 },
  foot: { paddingHorizontal: 4 },
});
