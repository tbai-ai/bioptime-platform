/* Admin › one live session (the web's /admin/sessions/:id, modules/sessions/SessionDetail.tsx admin mode; sessions.manage):
   details, edit, publish, mark completed, the calendar file, cancel with a reason, and the registrations: members (a tap
   opens the client record) and public visitors with their email address; attendance is recorded once the session has
   started (a choice per person and "Save attendance (n)"), and a registration or waitlist place can be removed with a
   reason (the next person waiting gets the place). GET /admin/sessions/:id → { session, registrations } (not cached on
   the device: it carries visitors' emails); POST …/publish, …/complete, …/cancel { reason }, …/attendance { marks },
   …/registrations/:registrationId/cancel { reason }; GET …/ics. */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { errorText, get, post } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { ReasonSheet } from '@/components/adminA/ReasonSheet';
import { useToast } from '@/components/adminA/toast';
import { KvList, fmtSpan, safeLink } from '@/components/coachModules/shared';
import { AUDIENCES, RegistrationPill, SessionStatusPill, placesText, shareIcs, type Session } from '@/components/coachModules/sessions';
import { Button, Card, Chip, Empty, ErrorBox, Loading, Notice, P, Row, Screen, Title } from '@/components/ui';
import { notifyBadges } from '@/components/workspaceShell';
import { AdminModuleGate, BackLink, SectionCard, takePendingToast } from '@/components/adminModules2/frame';
import { AdminSessionForm } from '@/components/adminModules2/sessions';
import { Enter } from '@/motion';
import { colors, font, space } from '@/theme';

type Reg = { id: string; name: string; status: string; registeredAt: string; waitlistPosition: number | null; attendanceAt: string | null; source: 'member' | 'public'; memberId?: string | null; email?: string | null };
const ATTENDANCE: Array<[string, string]> = [['registered', 'Not recorded'], ['attended', 'Attended'], ['no_show', 'No-show']];

export default function AdminSessionScreen() {
  return <AdminModuleGate title="Live session" module="sessions" permission="sessions.manage"><Body /></AdminModuleGate>;
}

function Body() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const data = useLoad<{ session: Session; registrations: Reg[] }>(null, () => get(`/admin/sessions/${id}`), [id]);
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [removing, setRemoving] = useState<Reg | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [marks, setMarks] = useState<Record<string, string>>({});
  useEffect(() => { setMarks({}); }, [data.data]);
  useEffect(() => { const t = takePendingToast(); if (t) toast.show(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const s = data.data?.session;
  const regs = data.data?.registrations ?? [];
  const started = !!s && Date.parse(s.startAt) <= Date.now();
  const open = !!s && (s.status === 'draft' || s.status === 'published');
  const attendanceOpen = !!s && started && (s.status === 'published' || s.status === 'completed');
  const act = async (key: string, fn: () => Promise<unknown>, msg: string) => { setBusy(key); try { await fn(); toast.show(msg); notifyBadges(); void data.reload(); } catch (e) { toast.show(errorText(e), 'error'); } finally { setBusy(null); } };
  const changed = Object.entries(marks).filter(([rid, st]) => regs.find((r) => r.id === rid)?.status !== st);
  const saveAttendance = () => act('attendance', () => post(`/admin/sessions/${id}/attendance`, { marks: changed.map(([registrationId, status]) => ({ registrationId, status })) }), 'Attendance saved');
  const link = s ? safeLink(s.joinUrl) : null;
  return <View style={{ flex: 1 }}><Screen refreshing={data.loading} onRefresh={data.reload}>
    <BackLink title="← Live sessions" href="/admin/sessions" />
    <Enter><Title sub={s ? `${s.kindLabel} · ${fmtSpan(s.startAt, s.endAt)}` : undefined}>{s?.title ?? 'Live session'}</Title></Enter>
    <ErrorBox error={data.error} onRetry={data.reload} />
    {data.loading && !s ? <Loading /> : s ? <>
      <Enter index={1}><Row>
        <SessionStatusPill status={s.status} />
        {open ? <Button title="Edit" variant="secondary" small onPress={() => setEditing(true)} /> : null}
        {s.status === 'draft' ? <Button title="Publish" small busy={busy === 'publish'} onPress={() => act('publish', () => post(`/admin/sessions/${id}/publish`), 'Published: members in the audience can register')} /> : null}
        {s.status === 'published' && started ? <Button title="Mark completed" small busy={busy === 'complete'} onPress={() => act('complete', () => post(`/admin/sessions/${id}/complete`), 'Marked completed')} /> : null}
        {s.status !== 'draft' ? <Button title="Add to calendar" variant="ghost" small busy={busy === 'ics'} onPress={() => { setBusy('ics'); shareIcs(`/admin/sessions/${id}/ics`, `session-${id}.ics`).catch((e) => toast.show(errorText(e), 'error')).finally(() => setBusy(null)); }} /> : null}
        {open ? <Button title="Cancel session" variant="danger" small onPress={() => setCancelling(true)} /> : null}
      </Row></Enter>
      {s.status === 'cancelled' ? <Notice kind="warning" title="Cancelled">{s.cancelledReason ?? ''}</Notice> : null}
      {s.status === 'draft' ? <Notice kind="info" title="Draft">Members cannot see it yet. Publish it to open registration.</Notice> : null}
      <Enter index={2}><SectionCard eyebrow="Details" title="The session">
        <KvList rows={[
          ['Host', `${s.hostName}${s.hostRole && s.hostRole !== 'coach' ? ' (Bioptime team)' : ''}`],
          ['Who can join', `${AUDIENCES[s.audience] ?? s.audience}${s.packages?.length ? `: ${s.packages.map((p) => p.name).join(', ')}` : ''}`],
          ['Places', placesText(s)],
          ['How to join', link ? <Text style={{ color: colors.text, fontSize: font.small }}><Text accessibilityRole="link" style={{ color: colors.accentText, fontWeight: '600' }} onPress={() => { Linking.openURL(link).catch(() => undefined); }}>Join</Text><Text style={{ color: colors.muted }}> · link shared by the host</Text></Text> : <Text style={{ color: colors.muted, fontSize: font.small }}>No join link. No video provider is connected; add the link you will use, or tell people how to join.</Text>],
          ['Created', fmtDateTime(s.createdAt)],
        ]} />
        {s.description ? <P small>{s.description}</P> : null}
      </SectionCard></Enter>
      <Enter index={3}><SectionCard eyebrow="Registrations" title={`${regs.filter((r) => r.status !== 'cancelled').length} people`}
        right={attendanceOpen && changed.length ? <Button title={`Save attendance (${changed.length})`} small busy={busy === 'attendance'} onPress={saveAttendance} /> : undefined}>
        {!started && s.status !== 'cancelled' && regs.length > 0 ? <P muted small>Attendance opens when the session starts.</P> : null}
        {regs.length ? regs.map((r) => <View key={r.id} style={st.item}>
          <Row between>
            {r.memberId ? <Text accessibilityRole="link" style={[st.name, { color: colors.accentText }]} onPress={() => router.push(`/admin/clients/${r.memberId}`)}>{r.name}</Text> : <Text style={st.name}>{r.name}</Text>}
            <RegistrationPill status={r.status} position={r.waitlistPosition} />
          </Row>
          <Text style={st.meta}>{`${r.source === 'public' ? 'Visitor (public sign-up)' : 'Member'}${r.email ? ` · ${r.email}` : ''}`}</Text>
          <Text style={st.meta}>{`Signed up ${fmtDateTime(r.registeredAt)}`}</Text>
          {attendanceOpen ? (['registered', 'attended', 'no_show'].includes(r.status) ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }} accessibilityLabel={`Attendance for ${r.name}`}>{ATTENDANCE.map(([v, l]) => <Chip key={v} selected={(marks[r.id] ?? r.status) === v} onPress={() => setMarks((m) => ({ ...m, [r.id]: v }))}>{l}</Chip>)}</View> : null) : null}
          {r.status === 'registered' || r.status === 'waitlisted' ? <Button title="Remove" variant="ghost" small onPress={() => setRemoving(r)} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} /> : null}
        </View>) : <Empty title="Nobody yet" body={s.status === 'draft' ? 'Registration opens when you publish.' : 'People who register appear here.'} />}
      </SectionCard></Enter>
      <AdminSessionForm open={editing} session={s} onClose={() => setEditing(false)} onSaved={() => { toast.show('Saved'); void data.reload(); }} />
    </> : null}
    <ReasonSheet open={cancelling} onClose={() => setCancelling(false)} destructive title="Cancel this session?" confirmLabel="Cancel session" body="Everyone registered or waiting is told, with your reason."
      onConfirm={async (reason) => { await post(`/admin/sessions/${id}/cancel`, { reason }); toast.show('Session cancelled'); notifyBadges(); void data.reload(); }} />
    <ReasonSheet open={!!removing} onClose={() => setRemoving(null)} destructive title={`Remove ${removing?.name ?? 'this person'}?`} confirmLabel="Remove" body="Their registration is cancelled and they are told; if they held a place, the next person waiting gets it."
      onConfirm={async (reason) => { const r = removing; if (!r) return; await post(`/admin/sessions/${id}/registrations/${r.id}/cancel`, { reason }); toast.show('Registration cancelled'); void data.reload(); }} />
  </Screen>{toast.float}</View>;
}

const st = {
  item: { paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: space.xs },
  name: { color: colors.text, fontSize: font.body, fontWeight: '600' as const, flex: 1 },
  meta: { color: colors.muted, fontSize: font.small },
};
