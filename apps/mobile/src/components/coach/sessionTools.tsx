/* The sessions module's two sheets on the coach's appointments (the portal's modules/sessions/AppointmentTools.tsx),
   shown only while the 'sessions' flag is on. How to join: the https link the coach will use, or none (no video provider
   creates meetings yet), and the calendar file. The summary: after a completed consultation, a summary the member reads,
   an optional private note and the coach's follow-ups. */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { errorText, get, patch, post } from '@/lib/api';
import { fmtDate, fmtDateTime, label } from '@/lib/format';
import { openAuthenticatedFile } from '@/lib/coach/core/files';
import { useLoad } from '@/lib/useLoad';
import { Button, Eyebrow, Field, Input, Loading, Notice, P, Row } from '@/components/ui';
import { Sheet } from '@/components/workspace';
import { LinkText, Muted, Small, StatusPill, TextArea, Tile } from './shared';
import { space } from '@/theme';

export type Appointment = { id: string; memberId: string; memberName: string | null; kind: string; status: string; startAt: string; meetingLink?: string | null };

/** https only, as the server (checkJoinUrl). */
export function safeLink(url?: string | null): string | null { return url && /^https:\/\/\S+$/i.test(url) ? url : null; }

export function MeetingDialog({ appointment, onClose, onSaved }: { appointment: Appointment | null; onClose: () => void; onSaved: () => void }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (appointment) { setUrl(appointment.meetingLink ?? ''); setErr(''); } }, [appointment]);
  const save = async (value: string | null) => {
    if (!appointment) return;
    setBusy(true); setErr('');
    try { await patch(`/coach/appointments/${appointment.id}/meeting`, { joinUrl: value }); onSaved(); onClose(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const ics = async () => { if (!appointment) return; setErr(''); try { await openAuthenticatedFile(`/coach/appointments/${appointment.id}/ics`, `consultation-${appointment.id}.ics`, 'text/calendar'); } catch (e) { setErr(errorText(e)); } };
  return <Sheet open={!!appointment} onClose={onClose} title="How to join" footer={<View style={{ gap: space.sm }}>
    {appointment?.meetingLink ? <Button title="Remove the link" variant="ghost" small busy={busy} onPress={() => { void save(null); }} /> : null}
    <Row><Button title="Cancel" variant="secondary" onPress={onClose} style={{ flex: 1 }} /><Button title="Save" busy={busy} disabled={!url.trim()} onPress={() => { void save(url.trim()); }} style={{ flex: 1 }} /></Row>
  </View>}>
    {appointment ? <>
      <Small>{`${appointment.memberName ?? ''} · ${fmtDateTime(appointment.startAt)}`}</Small>
      <Field label="Meeting link" hint="The https link you will use for this consultation. The member sees it under Appointments once the consultation is confirmed, and is told when you add it."><Input value={url} onChangeText={setUrl} placeholder="https://" keyboardType="url" autoCapitalize="none" autoCorrect={false} accessibilityLabel="Meeting link" /></Field>
      <Muted>No video provider is connected, so Bioptime creates no meeting. Without a link the member reads “Your coach will share how to join.”</Muted>
      <LinkText onPress={() => { void ics(); }}>Add this consultation to your calendar</LinkText>
      {err ? <Notice kind="error">{err}</Notice> : null}
    </> : null}
  </Sheet>;
}

type FollowUpDraft = { title: string; detail: string };
type SummaryView = { summary: { body: string; createdAt: string } | null; privateNotes: Array<{ id: string; body: string }>; followUps: Array<{ id: string; title: string; detail: string | null; status: string }> };

export function SummaryDialog({ appointment, onClose, onSaved }: { appointment: Appointment | null; onClose: () => void; onSaved: () => void }) {
  const existing = useLoad<SummaryView | null>(null, () => (appointment ? get(`/coach/appointments/${appointment.id}/summary`) : Promise.resolve(null)), [appointment?.id]);
  const [forMember, setForMember] = useState('');
  const [privateNote, setPrivateNote] = useState('');
  const [followUps, setFollowUps] = useState<FollowUpDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (appointment) { setForMember(''); setPrivateNote(''); setFollowUps([]); setErr(''); } }, [appointment]);
  const d = existing.data;
  const written = !!d?.summary;
  const save = async () => {
    if (!appointment) return;
    setBusy(true); setErr('');
    try {
      await post(`/coach/appointments/${appointment.id}/summary`, { forMember, privateNote: privateNote.trim() || undefined, followUps: followUps.filter((f) => f.title.trim()).map((f) => ({ title: f.title.trim(), detail: f.detail.trim() || undefined })) });
      onSaved(); onClose();
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const setFollowUp = (i: number, p: Partial<FollowUpDraft>) => setFollowUps((list) => list.map((f, k) => (k === i ? { ...f, ...p } : f)));
  return <Sheet open={!!appointment} onClose={onClose} title={written ? 'Consultation summary' : 'Write the consultation summary'} footer={written ? <Button title="Close" onPress={onClose} /> : <Row><Button title="Not now" variant="secondary" onPress={onClose} style={{ flex: 1 }} /><Button title="Send to the member" busy={busy} disabled={forMember.trim().length < 10} onPress={save} style={{ flex: 1 }} /></Row>}>
    {!appointment ? null : existing.loading && !d ? <Loading /> : existing.error ? <Notice kind="error">{existing.error.message}</Notice> : written && d ? <View style={{ gap: space.md }}>
      <Small>{`${appointment.memberName ?? ''} · ${label(appointment.kind)} on ${fmtDate(appointment.startAt)}`}</Small>
      <View><Eyebrow>{`Sent to the member, ${fmtDate(d.summary!.createdAt)}`}</Eyebrow><P>{d.summary!.body}</P></View>
      {d.privateNotes?.length ? <View><Eyebrow>Private notes</Eyebrow>{d.privateNotes.map((n) => <Small key={n.id}>{n.body}</Small>)}</View> : null}
      {d.followUps?.length ? <View style={{ gap: space.sm }}><Eyebrow>Follow-ups</Eyebrow>{d.followUps.map((f) => <Row key={f.id} between><View style={{ flex: 1 }}><P>{f.title}</P>{f.detail ? <Small>{f.detail}</Small> : null}</View><StatusPill status={f.status} /></Row>)}</View> : null}
    </View> : <View style={{ gap: space.sm }}>
      <Small>{`${appointment.memberName ?? ''} · ${label(appointment.kind)} on ${fmtDate(appointment.startAt)}`}</Small>
      <Field label="Summary for the member" hint="What you covered and agreed, in plain words. The member reads it under Appointments; the notification carries no detail."><TextArea rows={5} value={forMember} maxLength={4000} onChangeText={setForMember} /></Field>
      <Field label="Private note (optional)" hint="For the coaching team only; the member never sees it."><TextArea rows={3} value={privateNote} maxLength={4000} onChangeText={setPrivateNote} /></Field>
      <Eyebrow>Follow-ups for you</Eyebrow>
      {followUps.map((f, i) => <Tile key={i}>
        <Input accessibilityLabel={`Follow-up ${i + 1}`} placeholder="What to follow up" value={f.title} maxLength={200} onChangeText={(v) => setFollowUp(i, { title: v })} />
        <Input accessibilityLabel={`Detail ${i + 1}`} placeholder="Detail (optional)" value={f.detail} maxLength={1000} onChangeText={(v) => setFollowUp(i, { detail: v })} />
        <Button title="Remove" small variant="ghost" onPress={() => setFollowUps((list) => list.filter((_, k) => k !== i))} style={{ alignSelf: 'flex-start' }} />
      </Tile>)}
      {followUps.length < 10 ? <Button title="Add a follow-up" small variant="secondary" onPress={() => setFollowUps((list) => [...list, { title: '', detail: '' }])} style={{ alignSelf: 'flex-start' }} /> : null}
      <Muted>Follow-ups join your list on Today and in the client’s record. One summary per consultation.</Muted>
      {err ? <Notice kind="error">{err}</Notice> : null}
    </View>}
  </Sheet>;
}
