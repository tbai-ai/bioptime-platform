/* Admin › Support › one request (the web's /admin/support/:id, modules/support/AdminSupport.tsx RequestDetail; support
   module, the support_requests part, operations.manage): the whole thread with internal notes
   (GET /admin/support-requests/:id), a reply or an internal note with the status to leave it in
   (POST …/messages { body, internal, status? }), "Take it" (PATCH { assignedTo: me, reason: 'Taken from the queue' }) and
   a status change with a reason (PATCH { status, reason }). The requester is notified of a reply, never of an internal
   note; the notification does not carry the text. */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText, get, patch, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime, label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { ReasonSheet } from '@/components/adminA/ReasonSheet';
import { useToast } from '@/components/adminA/toast';
import { LoadError } from '@/components/adminB1/parts';
import { Button, Card, Check, Eyebrow, H2, Input, Loading, Notice, P, Row } from '@/components/ui';
import { KeyValue } from '@/components/workspace';
import { notifyBadges } from '@/components/workspaceShell';
import { PickerField } from '@/components/coachModules/shared';
import { AdminModuleScreen, useScreenRefresh } from '@/components/adminModules/shared';
import { categoryLabel, STATUSES, TeamStatusPill, TeamThread, type RequestDetail } from '@/components/adminModules/support';
import { Enter } from '@/motion';
import { colors, font, space } from '@/theme';

export default function AdminSupportRequestScreen() {
  return <AdminModuleScreen title="Support request" noTitle module="support" feature="support_requests" permission="operations.manage">
    <Detail />
  </AdminModuleScreen>;
}

function Detail() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [tick, setTick] = useState(0);
  const r = useLoad<RequestDetail>(id ? `admin-support-request-${id}` : null, () => get(`/admin/support-requests/${id}`), [id, tick]);
  const pull = useScreenRefresh(r.loading, r.stale);
  React.useEffect(() => { if (pull) setTick((n) => n + 1); }, [pull]);
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [after, setAfter] = useState('waiting_on_requester');
  const [busy, setBusy] = useState(false);
  const [statusDlg, setStatusDlg] = useState<string | null>(null);
  const d = r.data;
  const send = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try { await post(`/admin/support-requests/${id}/messages`, { body: body.trim(), internal, ...(internal ? {} : { status: after }) }); setBody(''); toast.show(internal ? 'Internal note added' : 'Reply sent; the requester is notified'); void r.reload(); notifyBadges(); }
    catch (e) { toast.show(errorText(e), 'error'); } finally { setBusy(false); }
  };
  const take = async () => { try { await patch(`/admin/support-requests/${id}`, { assignedTo: user?.id, reason: 'Taken from the queue' }); toast.show('You own it'); void r.reload(); notifyBadges(); } catch (e) { toast.show(errorText(e), 'error'); } };
  const mine = !!d && d.requester?.id === user?.id;
  return <View style={{ gap: space.md }}>
    <Enter><View style={{ gap: space.xs }}>
      <Text style={{ color: colors.text, fontSize: font.title, fontWeight: '700', letterSpacing: -0.5 }}>{d ? d.subject : 'Support request'}</Text>
      {d ? <Text style={{ color: colors.muted, fontSize: font.body, lineHeight: 21 }}>{`${d.reference} · ${categoryLabel(d.category)} · opened ${fmtDateTime(d.createdAt)}`}</Text> : null}
      <Row>{d ? <TeamStatusPill status={d.status} /> : null}<Button title="Back to the queue" variant="ghost" small onPress={() => router.push('/admin/support' as never)} /></Row>
    </View></Enter>
    {toast.node}
    {r.error ? <LoadError title="The request could not be loaded" error={r.error} onRetry={r.reload} /> : !d ? <Loading /> : <>
      <Enter index={1}><Card>
        <Eyebrow>Thread</Eyebrow><H2>{`${d.messages.length} message${d.messages.length === 1 ? '' : 's'}`}</H2>
        <TeamThread d={d} />
        {mine ? <Notice kind="info">This is your own request; someone else on the team answers it.</Notice> : <View style={{ marginTop: space.md }}>
          <Input value={body} onChangeText={setBody} maxLength={5000} multiline numberOfLines={4} style={{ minHeight: 96, textAlignVertical: 'top' }}
            placeholder={internal ? 'A note for the team. The requester never sees it.' : 'Your reply to the requester. Plain and specific; no health advice.'}
            accessibilityLabel={internal ? 'Internal note text' : 'Reply text'} />
          <View style={{ marginTop: space.md }}><Check checked={internal} onChange={setInternal} label="Internal note" /></View>
          {!internal ? <View style={{ marginTop: space.md }}><PickerField label="Then" value={after} options={STATUSES.map((s) => ({ value: s.id, label: s.label }))} onChange={setAfter} /></View> : null}
          <Button title={internal ? 'Add note' : 'Send reply'} busy={busy} disabled={!body.trim()} onPress={() => void send()} style={{ alignSelf: 'flex-start', marginTop: internal ? space.md : 0 }} />
          <P muted small>{internal ? 'Nobody is notified of an internal note.' : 'The requester is notified that a reply arrived; the notification does not carry the text.'}</P>
        </View>}
      </Card></Enter>
      <Enter index={2}><Card>
        <Eyebrow>Request</Eyebrow><H2>{d.reference}</H2>
        <KeyValue rows={[
          ['From', d.requester ? `${d.requester.name} · ${label(d.requester.role)}` : '—'],
          ['Email', d.requester?.email ?? '—'],
          ['Topic', categoryLabel(d.category)],
          ['Owner', d.assignedTo?.name ?? 'Unowned'],
          ['Opened', fmtDateTime(d.createdAt)],
          ['Resolved', d.resolvedAt ? fmtDateTime(d.resolvedAt) : '—'],
        ]} />
        {d.requester?.role === 'member' ? <Button title="Client record" variant="ghost" small onPress={() => { const rid = d.requester?.id; if (rid) router.push(`/admin/clients/${rid}` as never); }} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} /> : null}
        {d.assignedTo?.id !== user?.id && !mine ? <Button title="Take it" small variant="secondary" onPress={() => void take()} style={{ alignSelf: 'flex-start' }} /> : null}
        <PickerField label="Change status…" value="" options={STATUSES.filter((s) => s.id !== d.status).map((s) => ({ value: s.id, label: s.label }))} onChange={(v) => { if (v) setStatusDlg(v); }} />
      </Card></Enter>
    </>}
    <ReasonSheet open={!!statusDlg} onClose={() => setStatusDlg(null)} title={`Mark ${d?.reference ?? ''} ${STATUSES.find((s) => s.id === statusDlg)?.label.toLowerCase() ?? ''}?`} confirmLabel="Change status"
      body="The requester sees the new status. Changing it does not notify them; reply if they should hear from you."
      onConfirm={async (reason) => { const status = statusDlg; if (!status) return; await patch(`/admin/support-requests/${id}`, { status, reason }); toast.show('Status changed'); void r.reload(); notifyBadges(); }} />
  </View>;
}
