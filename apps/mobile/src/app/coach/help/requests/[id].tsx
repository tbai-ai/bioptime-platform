/* Coach › one support request (the web's /coach/help/requests/:id): the thread with the Bioptime team and the
   composer. A closed request says so; writing again to a resolved one reopens it. Shown while the 'support' flag and
   its 'support_requests' part are on. */
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText, get, post } from '@/lib/api';
import { useFeatures } from '@/lib/features';
import { fmtDateTime } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Button, Card, ErrorBox, Input, Loading, Notice, P, Row, StaleBanner } from '@/components/ui';
import { NotificationBell, RoleGate, WorkspaceScreen } from '@/components/workspaceShell';
import { ModuleGate, RequestStatus } from '@/components/coachModules/shared';
import { Enter } from '@/motion';
import { colors, font, radius, space } from '@/theme';

type Message = { id: string; body: string; createdAt: string; mine: boolean; authorName: string };
type Req = { id: string; reference: string; categoryLabel: string; subject: string; status: string; createdAt: string; messages: Message[] };

export default function CoachSupportRequest() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const features = useFeatures(true);
  const router = useRouter();
  const on = !!features?.has('support') && !!features?.has('support_requests');
  const r = useLoad<Req>(on ? `support-request-coach-${id}` : null, () => (on ? get(`/support-requests/${id}`) : Promise.resolve(null as unknown as Req)), [id, on]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const d = r.data;
  const send = async () => { if (!body.trim()) return; setBusy(true); setErr(''); try { await post(`/support-requests/${id}/messages`, { body: body.trim() }); setBody(''); r.reload(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); } };
  return <RoleGate workspace="coach">
    <Stack.Screen options={{ title: d?.subject ?? 'Support request', headerRight: () => <NotificationBell /> }} />
    <WorkspaceScreen workspace="coach" title={d?.subject ?? 'Support request'} sub={d ? `${d.reference} · ${d.categoryLabel} · opened ${fmtDateTime(d.createdAt)}` : undefined} refreshing={on && r.loading} onRefresh={r.reload}>
      <ModuleGate features={features} module="support" feature="support_requests">
        <Row between>{d ? <RequestStatus status={d.status} /> : <View />}<Button title="All requests" variant="ghost" small onPress={() => router.push('/coach/help?tab=requests')} /></Row>
        <StaleBanner at={r.stale} />
        <ErrorBox error={r.error} onRetry={r.reload} />
        {r.loading && !d ? <Loading /> : d ? <Enter><Card>
          {d.messages.length ? d.messages.map((m) => <View key={m.id} style={[st.msg, m.mine && st.mine]}>
            <View style={[st.bubble, m.mine && { backgroundColor: colors.raised }]}><Text style={{ color: colors.text, fontSize: font.body, lineHeight: 21 }}>{m.body}</Text></View>
            <Text style={st.time}>{`${m.authorName} · ${fmtDateTime(m.createdAt)}`}</Text>
          </View>) : <P muted>No messages yet.</P>}
          {d.status === 'closed' ? <Notice kind="info" title="This request is closed">{`Open a new request and mention ${d.reference} if you need more help.`}</Notice> : <View style={{ gap: space.sm, marginTop: space.sm }}>
            <Input value={body} onChangeText={setBody} maxLength={5000} placeholder="Write to the Bioptime team" accessibilityLabel="Write to the Bioptime team" multiline style={{ minHeight: 90, textAlignVertical: 'top' }} />
            {d.status === 'resolved' ? <P muted small>Marked resolved. Writing again reopens it.</P> : null}
            {err ? <Notice kind="error">{err}</Notice> : null}
            <Button title="Send" busy={busy} disabled={!body.trim()} onPress={send} />
          </View>}
        </Card></Enter> : null}
      </ModuleGate>
    </WorkspaceScreen>
  </RoleGate>;
}

const st = {
  msg: { alignItems: 'flex-start' as const, gap: 2, marginBottom: space.sm, maxWidth: '88%' as const },
  mine: { alignSelf: 'flex-end' as const, alignItems: 'flex-end' as const },
  bubble: { backgroundColor: colors.base, borderRadius: radius.md, padding: space.md, borderWidth: 1, borderColor: colors.border },
  time: { color: colors.muted, fontSize: font.tiny },
};
