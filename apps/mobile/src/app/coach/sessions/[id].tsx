/* Coach › one live session (the web's /coach/sessions/:id, modules/sessions/SessionDetail.tsx coach mode): details,
   edit, publish, cancel with a reason, complete, the calendar file, and the registrations: names, statuses and waitlist
   places only (never an email address or a phone number). Attendance is recorded once the session has started.
   Nothing is requested while the 'sessions' flag is off or still loading (the web never mounts the page then). A new
   draft arrives here from the list with ?saved=draft, and the list's "Draft saved" toast shows here, as on the web. */
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { errorText, get, post } from '@/lib/api';
import { useFeatures } from '@/lib/features';
import { fmtDateTime } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Button, Card, Chip, Empty, ErrorBox, Eyebrow, H2, Loading, Notice, P, Row, StaleBanner } from '@/components/ui';
import { ReasonSheet } from '@/components/adminA/ReasonSheet';
import { NotificationBell, RoleGate, WorkspaceScreen } from '@/components/workspaceShell';
import { KvList, ModuleGate, fmtSpan, safeLink, useFlash } from '@/components/coachModules/shared';
import { AUDIENCES, RegistrationPill, SessionForm, SessionStatusPill, placesText, shareIcs, type Session } from '@/components/coachModules/sessions';
import { Enter } from '@/motion';
import { colors, font, space } from '@/theme';
import { Linking } from 'react-native';

type Reg = { id: string; name: string; status: string; registeredAt: string; waitlistPosition: number | null; attendanceAt: string | null; source: 'member' | 'public'; clientId?: string | null };
const ATTENDANCE: Array<[string, string]> = [['registered', 'Not recorded'], ['attended', 'Attended'], ['no_show', 'No-show']];

export default function CoachSessionDetail() {
  const { id = '', saved } = useLocalSearchParams<{ id: string; saved?: string }>();
  const features = useFeatures(true);
  const router = useRouter();
  const on = !!features?.has('sessions');
  const data = useLoad<{ session: Session; regs: Reg[] } | null>(on ? `coach-session-${id}` : null, async () => {
    if (!on) return null; // no module request while the flag is off or the flags are still loading
    const [session, regs] = await Promise.all([get<Session>(`/coach/sessions/${id}`), get<{ items: Reg[] }>(`/coach/sessions/${id}/registrations`)]);
    return { session, regs: regs.items };
  }, [id, on]);
  const { show, node: flash } = useFlash();
  // the list's "Draft saved" for a session it just created (once; the parameter is dropped so it does not come back)
  useEffect(() => { if (saved === 'draft') { show('Draft saved'); router.setParams({ saved: undefined }); } }, [saved, show, router]);
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [marks, setMarks] = useState<Record<string, string>>({});
  useEffect(() => { setMarks({}); }, [data.data]);
  const d = data.data;
  const s = d?.session;
  const regs = d?.regs ?? [];
  const started = !!s && Date.parse(s.startAt) <= Date.now();
  const open = !!s && (s.status === 'draft' || s.status === 'published');
  const attendanceOpen = !!s && started && (s.status === 'published' || s.status === 'completed');
  const act = async (key: string, fn: () => Promise<unknown>, msg: string) => { setBusy(key); try { await fn(); show(msg); data.reload(); } catch (e) { show(errorText(e), 'error'); } finally { setBusy(null); } };
  const changed = Object.entries(marks).filter(([rid, st]) => regs.find((r) => r.id === rid)?.status !== st);
  const saveAttendance = () => act('attendance', () => post(`/coach/sessions/${id}/attendance`, { marks: changed.map(([registrationId, status]) => ({ registrationId, status })) }), 'Attendance saved');
  const link = s ? safeLink(s.joinUrl) : null;
  return <RoleGate workspace="coach">
    <Stack.Screen options={{ title: s?.title ?? 'Session', headerRight: () => <NotificationBell /> }} />
    <WorkspaceScreen workspace="coach" title={s?.title ?? 'Session'} sub={s ? `${s.kindLabel} · ${fmtSpan(s.startAt, s.endAt)}` : undefined} refreshing={on && data.loading} onRefresh={data.reload}>
      <ModuleGate features={features} module="sessions">
        <Button title="← Live sessions" variant="ghost" small onPress={() => router.push('/coach/sessions')} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} />
        {flash}
        <StaleBanner at={data.stale} />
        <ErrorBox error={data.error} onRetry={data.reload} />
        {data.loading && !d ? <Loading /> : s ? <>
          <Enter><Row>
            <SessionStatusPill status={s.status} />
            {open ? <Button title="Edit" variant="secondary" small onPress={() => setEditing(true)} /> : null}
            {s.status === 'draft' ? <Button title="Publish" small busy={busy === 'publish'} onPress={() => act('publish', () => post(`/coach/sessions/${id}/publish`), 'Published: members in the audience can register')} /> : null}
            {s.status === 'published' && started ? <Button title="Mark completed" small busy={busy === 'complete'} onPress={() => act('complete', () => post(`/coach/sessions/${id}/complete`), 'Marked completed')} /> : null}
            {s.status !== 'draft' ? <Button title="Add to calendar" variant="ghost" small busy={busy === 'ics'} onPress={() => { setBusy('ics'); shareIcs(`/coach/sessions/${id}/ics`, `session-${id}.ics`).catch((e) => show(errorText(e), 'error')).finally(() => setBusy(null)); }} /> : null}
            {open ? <Button title="Cancel session" variant="danger" small onPress={() => setCancelling(true)} /> : null}
          </Row></Enter>
          {s.status === 'cancelled' ? <Notice kind="warning" title="Cancelled">{s.cancelledReason ?? ''}</Notice> : null}
          {s.status === 'draft' ? <Notice kind="info" title="Draft">Members cannot see it yet. Publish it to open registration.</Notice> : null}
          <Enter index={1}><Card><Eyebrow>Details</Eyebrow><H2>The session</H2>
            <KvList rows={[
              ['Host', `${s.hostName}${s.hostRole && s.hostRole !== 'coach' ? ' (Bioptime team)' : ''}`],
              ['Who can join', `${AUDIENCES[s.audience] ?? s.audience}${s.packages?.length ? `: ${s.packages.map((p) => p.name).join(', ')}` : ''}`],
              ['Places', placesText(s)],
              ['How to join', link ? <Text style={{ color: colors.text, fontSize: font.small }}><Text style={{ color: colors.accentText, fontWeight: '600' }} onPress={() => Linking.openURL(link).catch(() => {})}>Join</Text><Text style={{ color: colors.muted }}> · link shared by the host</Text></Text> : <Text style={{ color: colors.muted, fontSize: font.small }}>No join link. No video provider is connected; add the link you will use, or tell people how to join.</Text>],
              ['Created', fmtDateTime(s.createdAt)],
            ]} />
            {s.description ? <P small>{s.description}</P> : null}
          </Card></Enter>
          <Enter index={2}><Card>
            <Row between><View style={{ flex: 1 }}><Eyebrow>Registrations (names only)</Eyebrow><H2>{`${regs.filter((r) => r.status !== 'cancelled').length} people`}</H2></View>{attendanceOpen && changed.length ? <Button title={`Save attendance (${changed.length})`} small busy={busy === 'attendance'} onPress={saveAttendance} /> : null}</Row>
            {!started && s.status !== 'cancelled' && regs.length > 0 ? <P muted small>Attendance opens when the session starts.</P> : null}
            {regs.length ? regs.map((r) => <View key={r.id} style={st.item}>
              <Row between>{r.clientId ? <Text style={[st.name, { color: colors.accentText }]} onPress={() => router.push(`/coach/clients/${r.clientId}`)}>{r.name}</Text> : <Text style={st.name}>{r.name}</Text>}<RegistrationPill status={r.status} position={r.waitlistPosition} /></Row>
              <Text style={st.meta}>{`${r.source === 'public' ? 'Visitor (public sign-up)' : 'Member'} · signed up ${fmtDateTime(r.registeredAt)}`}</Text>
              {attendanceOpen ? (['registered', 'attended', 'no_show'].includes(r.status) ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }} accessibilityLabel={`Attendance for ${r.name}`}>{ATTENDANCE.map(([v, l]) => <Chip key={v} selected={(marks[r.id] ?? r.status) === v} onPress={() => setMarks((m) => ({ ...m, [r.id]: v }))}>{l}</Chip>)}</View> : <Text style={st.meta}>—</Text>) : null}
            </View>) : <Empty title="Nobody yet" body={s.status === 'draft' ? 'Registration opens when you publish.' : 'People who register appear here.'} />}
          </Card></Enter>
          <SessionForm open={editing} session={s} onClose={() => setEditing(false)} onSaved={() => { show('Saved'); data.reload(); }} />
          <ReasonSheet open={cancelling} onClose={() => setCancelling(false)} title="Cancel this session?" destructive confirmLabel="Cancel session" body="Everyone registered or waiting is told, with your reason."
            onConfirm={async (reason) => { await post(`/coach/sessions/${id}/cancel`, { reason }); show('Session cancelled'); data.reload(); }} />
        </> : null}
      </ModuleGate>
    </WorkspaceScreen>
  </RoleGate>;
}

const st = {
  item: { paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: space.xs },
  name: { color: colors.text, fontSize: font.body, fontWeight: '600' as const, flex: 1 },
  meta: { color: colors.muted, fontSize: font.small },
};
