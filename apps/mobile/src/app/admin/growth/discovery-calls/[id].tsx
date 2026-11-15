/* Admin › one discovery call request (the web's /admin/growth/discovery-calls/:id, modules/growth/AdminDiscoveryCalls.tsx
   CallDetail; growth.manage): what the person told us (goals, preferred times, the package finder's suggestions), the
   team's notes, their contact details (the phone only with members.view_restricted) and what they agreed to, and the
   handling: status, the agreed time (IST) once booked, who handles it (a coach sees the name, goals and times, never the
   email or phone number) and an optional note. Saving sends the person nothing.
   GET /admin/growth/discovery-calls/:id, GET /admin/growth/assignees; PATCH …/:id { status, assignedTo, bookedAt?, note? };
   POST …/:id/notes { body }. Not kept on the device. */
import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { errorText, get, patch } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { DISCOVERY_STATUSES, SOURCE_LABELS, growthPill, isoToIstParts, istPartsToIso, type DiscoveryCall, type DiscoveryStatus, type Person } from '@/lib/admin/modules2/growth';
import { useToast } from '@/components/adminA/toast';
import { PickerField } from '@/components/coachModules/shared';
import { Button, ErrorBox, Eyebrow, Field, Input, Loading, Notice, Pill, Row, Screen, Title } from '@/components/ui';
import { DatePickerField, TimePickerField } from '@/components/workspace';
import { notifyBadges } from '@/components/workspaceShell';
import { AdminModuleGate, BackLink, SectionCard } from '@/components/adminModules2/frame';
import { ContactCard, Notes, PreferredTimes } from '@/components/adminModules2/growth';
import { Enter } from '@/motion';
import { colors, font, space } from '@/theme';

export default function AdminDiscoveryCallScreen() {
  return <AdminModuleGate title="Discovery call" module="growth" permission="growth.manage"><Body /></AdminModuleGate>;
}

function Body() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const r = useLoad<DiscoveryCall>(null, () => get(`/admin/growth/discovery-calls/${id}`), [id]);
  const people = useLoad<{ items: Person[] }>(null, () => get('/admin/growth/assignees'), []);
  const d = r.data;
  const [status, setStatus] = useState<DiscoveryStatus>('new');
  const [assigned, setAssigned] = useState('');
  const [bookedDate, setBookedDate] = useState('');
  const [bookedTime, setBookedTime] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (d) { const b = isoToIstParts(d.bookedAt); setStatus(d.status); setAssigned(d.assignedTo?.id ?? ''); setBookedDate(b.date); setBookedTime(b.time); setNote(''); setErr(''); } }, [d]);
  const stored = isoToIstParts(d?.bookedAt);
  const bookedTyped = !!bookedDate || !!bookedTime;
  const save = async () => {
    if (!d) return;
    const bookedAt = status === 'booked' ? (bookedTyped ? istPartsToIso(bookedDate, bookedTime) : null) : undefined;
    if (status === 'booked' && bookedTyped && !bookedAt) { setErr('Choose the agreed date and time'); return; }
    setBusy(true); setErr('');
    try {
      await patch(`/admin/growth/discovery-calls/${id}`, { status, assignedTo: assigned || null, ...(bookedAt !== undefined ? { bookedAt } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
      toast.show('Saved'); notifyBadges(); void r.reload();
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const changed = !!d && (status !== d.status || (assigned || null) !== (d.assignedTo?.id ?? null) || (status === 'booked' && (bookedDate !== stored.date || bookedTime !== stored.time)) || !!note.trim());
  return <View style={{ flex: 1 }}><Screen refreshing={r.loading} onRefresh={() => { void r.reload(); void people.reload(); }}>
    <BackLink title="← Back to the list" href="/admin/growth/discovery-calls" />
    <Enter><Title sub={d ? `${d.reference} · asked ${fmtDateTime(d.createdAt)} · ${SOURCE_LABELS[d.source] ?? d.source}` : undefined}>{d ? d.name : 'Discovery call'}</Title></Enter>
    <ErrorBox error={r.error} onRetry={r.reload} />
    {!d ? (r.error ? null : <Loading />) : <>
      <Row><Pill tone={growthPill(d.status).tone}>{growthPill(d.status).label}</Pill></Row>
      <Enter index={1}><SectionCard eyebrow="What they told us" title="Goals">
        <Text style={{ color: colors.text, fontSize: font.body, lineHeight: 22 }} selectable>{d.goals}</Text>
        <Eyebrow>Preferred times</Eyebrow>
        <PreferredTimes slots={d.preferredSlots} windows={d.preferredWindows} />
        {d.interests.length > 0 ? <Text style={{ color: colors.text, fontSize: font.small, marginTop: space.xs }}>{`Packages the package finder suggested: ${d.interests.join(', ')}`}</Text> : null}
      </SectionCard></Enter>
      <Enter index={2}><ContactCard eyebrow="Contact" title={d.reference} email={d.email} phone={d.phone} consentText={d.consentText} consentVersion={d.consentVersion} consentAt={d.consentAt} note="Write to them yourself to agree a time; saving here sends them nothing." /></Enter>
      <Enter index={3}><SectionCard eyebrow="Handling" title="Status and owner">
        <PickerField label="Status" value={status} options={DISCOVERY_STATUSES.map((s) => ({ value: s.id, label: s.label }))} onChange={(v) => setStatus(v as DiscoveryStatus)} />
        {status === 'booked' ? <>
          <DatePickerField label="Agreed time (IST) (optional)" value={bookedDate} onChange={setBookedDate} hint="The time you agreed with them." />
          <TimePickerField label="Time (IST)" value={bookedTime} onChange={setBookedTime} />
        </> : null}
        <PickerField label="Handled by" hint="A coach is told by reference and sees the name, goals and times, never the email or phone number." placeholder="Not assigned" value={assigned}
          options={(people.data?.items ?? []).map((p) => ({ value: p.id, label: `${p.name} (${p.role === 'coach' ? 'coach' : 'team'})` }))} onChange={setAssigned} chipsUpTo={1} />
        <Field label="Note (optional)"><Input value={note} maxLength={2000} onChangeText={setNote} placeholder="For example: emailed two evening options." multiline style={{ minHeight: 72, textAlignVertical: 'top' }} accessibilityLabel="Note" /></Field>
        {err ? <Notice kind="error">{err}</Notice> : null}
        <Button title="Save" busy={busy} disabled={!changed} onPress={save} />
      </SectionCard></Enter>
      <Enter index={4}><Notes notes={d.notes ?? []} path={`/admin/growth/discovery-calls/${id}/notes`} onSaved={() => void r.reload()} show={toast.show} /></Enter>
    </>}
  </Screen>{toast.float}</View>;
}
