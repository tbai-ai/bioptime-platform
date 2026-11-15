/* Admin › one corporate enquiry (the web's /admin/growth/corporate/:id, modules/growth/AdminCorporate.tsx EnquiryDetail;
   growth.manage): the enquiry (team size, interests, message), the team's notes, the contact (the phone only with
   members.view_restricted) and what they agreed to, and the handling: status, who handles it (only team members holding
   growth.manage take one; coaches are left out) and an optional note. Saving sends them nothing.
   GET /admin/growth/corporate/:id, GET /admin/growth/assignees; PATCH …/:id { status, assignedTo, note? };
   POST …/:id/notes { body }. Not kept on the device. */
import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { errorText, get, patch } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { CORPORATE_INTEREST_LABELS, CORPORATE_STATUSES, growthPill, type CorporateEnquiry, type CorporateStatus, type Person } from '@/lib/admin/modules2/growth';
import { useToast } from '@/components/adminA/toast';
import { PickerField } from '@/components/coachModules/shared';
import { Button, ErrorBox, Field, Input, Loading, Notice, Pill, Row, Screen, Title } from '@/components/ui';
import { notifyBadges } from '@/components/workspaceShell';
import { AdminModuleGate, BackLink, SectionCard } from '@/components/adminModules2/frame';
import { ContactCard, Notes } from '@/components/adminModules2/growth';
import { Enter } from '@/motion';
import { colors, font } from '@/theme';

export default function AdminCorporateEnquiryScreen() {
  return <AdminModuleGate title="Corporate enquiry" module="growth" permission="growth.manage"><Body /></AdminModuleGate>;
}

function Body() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const r = useLoad<CorporateEnquiry>(null, () => get(`/admin/growth/corporate/${id}`), [id]);
  const people = useLoad<{ items: Person[] }>(null, () => get('/admin/growth/assignees'), []);
  const d = r.data;
  const [status, setStatus] = useState<CorporateStatus>('new');
  const [assigned, setAssigned] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (d) { setStatus(d.status); setAssigned(d.assignedTo?.id ?? ''); setNote(''); setErr(''); } }, [d]);
  const save = async () => {
    setBusy(true); setErr('');
    try { await patch(`/admin/growth/corporate/${id}`, { status, assignedTo: assigned || null, ...(note.trim() ? { note: note.trim() } : {}) }); toast.show('Saved'); notifyBadges(); void r.reload(); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const changed = !!d && (status !== d.status || (assigned || null) !== (d.assignedTo?.id ?? null) || !!note.trim());
  const team = (people.data?.items ?? []).filter((p) => p.role !== 'coach');
  return <View style={{ flex: 1 }}><Screen refreshing={r.loading} onRefresh={() => { void r.reload(); void people.reload(); }}>
    <BackLink title="← Back to the list" href="/admin/growth/corporate" />
    <Enter><Title sub={d ? `${d.reference} · received ${fmtDateTime(d.createdAt)}` : undefined}>{d ? d.company : 'Corporate enquiry'}</Title></Enter>
    <ErrorBox error={r.error} onRetry={r.reload} />
    {!d ? (r.error ? null : <Loading />) : <>
      <Row><Pill tone={growthPill(d.status).tone}>{growthPill(d.status).label}</Pill></Row>
      <Enter index={1}><SectionCard eyebrow="Their enquiry" title={`A team of ${d.teamSize}`}>
        <Text style={{ color: colors.text, fontSize: font.small }}>{`Interested in: ${d.interests.map((i) => CORPORATE_INTEREST_LABELS[i] ?? i).join(', ')}`}</Text>
        {d.message ? <Text style={{ color: colors.text, fontSize: font.body, lineHeight: 22 }} selectable>{d.message}</Text> : <Text style={{ color: colors.muted, fontSize: font.small }}>No message.</Text>}
      </SectionCard></Enter>
      <Enter index={2}><ContactCard eyebrow="Contact" title={d.contactName} email={d.email} phone={d.phone} consentText={d.consentText} consentVersion={d.consentVersion} consentAt={d.consentAt} note="Reply to them yourself; saving here sends them nothing. Promise only what Bioptime runs today." /></Enter>
      <Enter index={3}><SectionCard eyebrow="Handling" title="Status and owner">
        <PickerField label="Status" value={status} options={CORPORATE_STATUSES.map((s) => ({ value: s.id, label: s.label }))} onChange={(v) => setStatus(v as CorporateStatus)} />
        <PickerField label="Handled by" hint="Team members who handle growth." placeholder="Not assigned" value={assigned} options={team.map((p) => ({ value: p.id, label: p.name }))} onChange={setAssigned} chipsUpTo={1} />
        <Field label="Note (optional)"><Input value={note} maxLength={2000} onChangeText={setNote} multiline style={{ minHeight: 72, textAlignVertical: 'top' }} accessibilityLabel="Note" /></Field>
        {err ? <Notice kind="error">{err}</Notice> : null}
        <Button title="Save" busy={busy} disabled={!changed} onPress={save} />
      </SectionCard></Enter>
      <Enter index={4}><Notes notes={d.notes ?? []} path={`/admin/growth/corporate/${id}/notes`} onSaved={() => void r.reload()} show={toast.show} /></Enter>
    </>}
  </Screen>{toast.float}</View>;
}
