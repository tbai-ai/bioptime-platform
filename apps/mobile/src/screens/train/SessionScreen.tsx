/* session/[id]: one live session (group class, webinar or workshop) as a full-screen overlay: a people-free photo of
   its kind as the header band (the host's name is on this screen), when and who hosts it, the places or the waitlist
   position; register or join the waitlist, give the place back (a confirmation sheet), and how to join once the member
   holds a place: the link the host shared (https only), or who will share how to join, and "Add to calendar" (the
   session's .ics from the API, times in IST). No join link is ever made up.
   Motion v2 (C07): the kit Overlay gives it the overlay entrance and exit; the header photo dissolves in over
   S.c07.heroFadeMs and the cards enter once per launch (Reveal ids 'session.*'), so a revisit is at rest from its
   first frame; the CTAs press with the kit's buttons. Tier C: fades; reduced motion: at rest. */
import { useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Button, ErrorState, GlassCard, KVRow, Notice, Overlay, P, Photo, Pill, Reveal, RingSpinner, Scrim, Sheet, StaleBanner, T, fx, haptics, invalidate, motionValues, toast } from '@/fx';
import { errorText, get, post } from '@/lib/api';
import { fmtDateTime, fmtTime } from '@/lib/format';
import { placeLabel } from '@/lib/modules/sessions';
import { useLoad } from '@/lib/useLoad';
import { openCalendarFile } from '../coach/files';
import { liveKind } from './LiveClasses';

/** An https link with no spaces, line breaks or control characters; anything else is not opened. */
const https = (url?: string | null) => (url && /^https:\/\//i.test(url) && !/[\s\u0000-\u001f\u007f-\u009f]/.test(url) ? url : null);

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const s = useLoad<any>(`session.${id}`, () => get(`/me/sessions/${id}`), [id]);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [ics, setIcs] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const d = s.data;
  const waitlisted = d?.myRegistration?.status === 'waitlisted';
  const register = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await post<any>(`/me/sessions/${id}/register`);
      s.setData(r);
      const text = r.myRegistration?.status === 'waitlisted' ? `You are number ${r.myRegistration.waitlistPosition} on the waitlist. You are told if a place opens up.` : 'You are registered.';
      setMsg({ kind: 'success', text }); haptics.success(); toast.success(text); invalidate(['sessions.list']);
    } catch (e) { setMsg({ kind: 'error', text: errorText(e) }); } finally { setBusy(false); }
  };
  const leave = async () => {
    setBusy(true); setMsg(null);
    try { const r = await post<any>(`/me/sessions/${id}/cancel`, {}); s.setData(r); setConfirm(false); setMsg({ kind: 'success', text: 'Done.' }); invalidate(['sessions.list']); }
    catch (e) { setMsg({ kind: 'error', text: errorText(e) }); setConfirm(false); } finally { setBusy(false); }
  };
  const addToCalendar = async () => {
    setIcs(true);
    try { await openCalendarFile(`/me/sessions/${id}/ics`, `session-${id}.ics`); haptics.success(); }
    catch (e) { toast.error(errorText(e)); } finally { setIcs(false); }
  };
  const link = https(d?.joinUrl);
  const place = d ? placeLabel(d) : null;
  const hero = d ? <Reveal mount id={`session.${id}.hero`} from="fade" duration={motionValues.screens.c07.heroFadeMs}>
    <View style={styles.band}>
      <Photo slot={`session.header.${liveKind(d.kind)}`} opacity={0.35} decorative style={StyleSheet.absoluteFill} />
      <Scrim kind="trainHeader" style={StyleSheet.absoluteFill} />
    </View>
  </Reveal> : null;
  return <>
    <Overlay title={d?.title ?? 'Live session'} subtitle={d?.kindLabel} fallback="/(tabs)/train?section=live" hero={hero}>
      <StaleBanner at={s.stale} />
      <ErrorState error={s.error} onRetry={s.reload} />
      {s.loading && !d ? <View style={styles.loading}><RingSpinner label="Loading the session" /></View> : d ? <>
        <Reveal mount id={`session.${id}.card`}><GlassCard style={styles.gap8}>
          <View style={styles.row}>
            <T v="overline">{d.kindLabel}</T>
            {place ? <Pill tone={place.tone}>{place.text}</Pill> : null}
          </View>
          <T v="card24">{d.title}</T>
          {d.description ? <T v="body" color={fx.ink.a80}>{d.description}</T> : null}
          <View>
            <KVRow label="When" value={`${fmtDateTime(d.startAt)} to ${fmtTime(d.endAt)} IST`} />
            <KVRow label="Host" value={d.hostName} />
            <KVRow label="Places" value={d.capacity === null ? 'No limit' : d.full ? 'Full' : `${d.spotsLeft} of ${d.capacity} left`} divider={false} />
          </View>
        </GlassCard></Reveal>
        {d.status === 'cancelled' ? <Notice kind="warning" title="Cancelled">{d.cancelledReason ?? 'This session was cancelled.'}</Notice> : null}
        {d.myRegistration?.status === 'registered' && d.status === 'published' ? <Reveal mount id={`session.${id}.join`} index={1}><GlassCard rule={{ color: fx.red.brand }} style={styles.gap8}>
          <T v="overline">How to join</T>
          {link ? <><P small muted>Link shared by the host.</P><Button title="Join" icon="external-link" commit onPress={() => Linking.openURL(link).catch(() => {})} /></>
            : <T v="body" color={fx.ink.a80}>{d.howToJoin ?? 'Your coach will share how to join.'}</T>}
          {!d.started ? <Button title="Add to calendar" icon="calendar-days" variant="soft" busy={ics} onPress={() => { void addToCalendar(); }} /> : null}
        </GlassCard></Reveal> : null}
        {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
        {d.status === 'published' && !d.started ? (d.myRegistration
          ? <Button title={waitlisted ? 'Leave the waitlist' : 'Give my place back'} variant="redGlass" busy={busy} onPress={() => { haptics.warning(); setConfirm(true); }} />
          : <Button title={d.full ? 'Join the waitlist' : 'Register'} icon={d.full ? 'hourglass' : 'calendar-check'} commit busy={busy} onPress={register} />) : null}
        {d.started && d.status === 'published' ? <P muted small>This session has started.</P> : null}
        <P muted small>When a session is full you can join its waitlist; if a place opens up, you are told.</P>
      </> : null}
    </Overlay>
    <Sheet visible={confirm} onClose={() => setConfirm(false)} title={waitlisted ? 'Leave the waitlist?' : 'Give your place back?'}>
      <View style={styles.gap16}>
        <T v="body" color={fx.ink.a70}>{waitlisted ? 'You lose your place in the queue.' : 'The next person waiting gets your place.'}</T>
        <Button title="Yes" variant="redGlass" busy={busy} onPress={leave} />
        <Button title="Keep it" variant="ghost" full onPress={() => setConfirm(false)} />
      </View>
    </Sheet>
  </>;
}

const styles = StyleSheet.create({
  band: { height: 140, marginBottom: -60, overflow: 'hidden' },
  loading: { paddingVertical: 48, alignItems: 'center' },
  gap8: { gap: 8 },
  gap16: { gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
});
