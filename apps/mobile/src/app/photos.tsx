/* Progress photos (M2): the photo consent (its wording is a draft pending counsel, and says so), the member's photos,
   which ones the coach may see, adding one and deleting one. Photos open through links that expire after five minutes;
   the coach sees a photo only when the member shares it and health sharing is on; administrators never see them.
   Adding a photo uses the phone's photo library (expo-image-picker; on the web the file dialog) once the consent is
   given and the progressPhotos module is on; the server checks type, size and consent. While adding is off, the notice
   says so and the empty list says only that there are no photos (never a place to add them that is off too).
   In the client app's overlay chrome (BUILD_PLAN §6.2); the photos themselves are drawn plainly (no tilt, no grade). */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Button, Check, EmptyState, ErrorState, Eyebrow, FilterChip, fx, GlassCard, Notice, Overlay, P, Pill, Skeleton, StaleBanner, T, toast, useFocusRefresh,
} from '@/fx';
import { Alert } from '@/lib/alert';
import { api, errorText, get, patch, post } from '@/lib/api';
import { clearImageCaches } from '@/lib/cache';
import { fmtDate, label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { PrivatePhoto } from '@/screens/home/PrivatePhoto';
import { pickAndUploadPhoto, POSES, type Pose } from '@/screens/home/photoUpload';
import type { PhotosData, ProgressPhoto } from '@/screens/home/data';

export default function Photos() {
  const p = useLoad<PhotosData>('progress-photos', () => get('/me/progress/photos'), []);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pose, setPose] = useState<Pose>('front');
  const [msg, setMsg] = useState<string | null>(null);
  useFocusRefresh(p.reload);
  const d = p.data;
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setMsg(null); try { await fn(); await p.reload(); } catch (e) { setMsg(errorText(e)); } finally { setBusy(false); } };
  const withdraw = () => Alert.alert('Withdraw the photo consent?', 'Your coach loses access to every photo at once and each photo stops being shared. Your photos stay until you delete them.', [
    { text: 'Keep', style: 'cancel' },
    { text: 'Withdraw', style: 'destructive', onPress: () => { void run(() => post('/me/progress/photos/consent', { granted: false })); } },
  ]);
  const remove = (x: ProgressPhoto) => Alert.alert('Delete this photo?', 'It is removed from storage at once and cannot be recovered.', [
    { text: 'Keep', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => { void run(async () => { await api('DELETE', `/me/progress/photos/${x.id}`); await clearImageCaches(); }); } }, // nothing of it stays on the phone either
  ]);
  const add = async () => {
    setAdding(true); setMsg(null);
    try { if (await pickAndUploadPhoto(pose, d?.maxBytes)) { toast.logged('Photo added'); await p.reload(); } }
    catch (e) { setMsg(errorText(e)); } finally { setAdding(false); }
  };
  return <Overlay title="Progress photos" subtitle="Private by default. Your coach sees a photo only if you share it, and only while you share health records with your coach." kind="back" fallback="/(tabs)">
    <StaleBanner at={p.stale} />
    <ErrorState error={p.error} onRetry={p.reload} />
    {!d && p.loading ? <><Skeleton height={180} radius={fx.radius.card} /><Skeleton height={320} radius={fx.radius.card} /></> : null}
    {d ? <>
      <GlassCard>
        <Eyebrow kind="label">Consent</Eyebrow>
        <View style={styles.tag}><T v="micro" color={fx.hue.amber400} style={styles.tagText}>{d.consent.wording.label}</T></View>
        <T v="body" color={fx.ink.a90} style={styles.gap}>{d.consent.wording.text}</T>
        {d.consent.granted ? <View style={[styles.row, styles.gap]}><Pill tone="success">{`Agreed ${fmtDate(d.consent.at)}`}</Pill><View style={styles.flex} /><Button title="Withdraw" variant="ghost" busy={busy} onPress={withdraw} /></View>
          : d.consent.canGrant ? <Button title="I agree" busy={busy} disabled={!d.photosEnabled} commit style={styles.gap} onPress={() => run(() => post('/me/progress/photos/consent', { granted: true, version: d.consent.wording.version }))} />
          : <Notice kind="warning" title="Not available yet" style={styles.gap}>{`Pending configuration. Missing: ${d.consent.missing ?? ''}`}</Notice>}
      </GlassCard>
      {d.photosEnabled ? (d.consent.granted ? <GlassCard>
        <Eyebrow kind="label">Add a photo</Eyebrow>
        <P muted small style={styles.gap}>Which pose is it? A new photo stays private until you share it.</P>
        <View style={[styles.poses, styles.gap]}>{POSES.map((x) => <FilterChip key={x.value} label={x.label} selected={pose === x.value} onPress={() => setPose(x.value)} />)}</View>
        <Button title="Choose a photo" icon="images" busy={adding} commit onPress={() => { void add(); }} style={styles.gap} />
      </GlassCard> : <Notice kind="info" title="Adding photos">Agree to the consent above to add a photo from this phone.</Notice>)
        : <Notice kind="info" title="Adding photos">Adding progress photos is not switched on for your account yet.</Notice>}
      {msg ? <Notice kind="error">{msg}</Notice> : null}
      {d.items.length ? d.items.map((x) => <GlassCard key={x.id}>
        <PrivatePhoto fileId={x.fileId} refreshed={p.data} style={styles.photo} label={`${label(x.pose)} progress photo, ${fmtDate(x.takenAt)}`} />
        <View style={[styles.row, styles.gap]}>
          <T v="cardTitle" style={styles.flex}>{`${label(x.pose)} · ${fmtDate(x.takenAt)}`}</T>
          <Pill tone={x.sharedWithCoach ? 'success' : 'info'}>{x.sharedWithCoach ? 'Shared' : 'Private'}</Pill>
        </View>
        <Check checked={x.sharedWithCoach} label="Share with my coach" hint={!x.sharedWithCoach && !d.consent.granted ? 'Agree to the consent first.' : undefined} style={styles.gap}
          onChange={(v) => { if (v && (!d.consent.granted || !d.photosEnabled)) return; void run(() => patch(`/me/progress/photos/${x.id}`, { shareWithCoach: v })); }} />
        <Button title="Delete" variant="redGlass" small full={false} onPress={() => remove(x)} style={styles.gap} />
      </GlassCard>) : <EmptyState dashed icon="images" title="No photos yet" body={d.photosEnabled ? 'Photos you add appear here, newest first.' : undefined} />}
      <P muted small>{`Health sharing with your coach is ${d.healthShared ? 'on' : 'off'}. ${d.retentionDays ? `Photos are deleted ${d.retentionDays} days after you add them.` : 'Photos stay until you delete them.'} Links to a photo expire after five minutes.`}</P>
    </> : null}
  </Overlay>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  gap: { marginTop: 12 },
  poses: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photo: { width: '100%', aspectRatio: 3 / 4 },
  tag: { alignSelf: 'flex-start', maxWidth: '100%', marginTop: 10, paddingHorizontal: 10, paddingVertical: 3, borderRadius: fx.radius.lg, borderWidth: 1, borderColor: fx.tone.warningLine, backgroundColor: fx.tone.warningBg },
  tagText: { flexShrink: 1, lineHeight: 14 },
});
