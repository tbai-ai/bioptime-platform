/* The Sessions tab on the coach's client record (the web's modules/sessions/SessionsTab.tsx, coach mode): the client's
   live sessions, the summaries their coaches wrote after consultations, and the coach's own follow-ups. Nothing here is
   health data: sessions are sign-ups, summaries are what the coach wrote for the member. Read only. */
import { useRouter } from 'expo-router';
import React from 'react';
import { Text, View } from 'react-native';
import { get } from '@/lib/api';
import { fmtDate, label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import type { RecordTabContext } from '@/lib/coach/moduleTabs';
import { Button, Card, Empty, Eyebrow, H2, Row } from '@/components/ui';
import { StatusPill, TabState, useRecordTick } from '@/components/coachModules/shared';
import { RegistrationPill, SessionStatusPill } from '@/components/coachModules/sessions';
import { colors, font, space } from '@/theme';

type Payload = {
  registrations: Array<{ sessionId: string; title: string; kindLabel: string; startAt: string; hostName: string; hostedByMe: boolean; status: string; sessionStatus: string }>;
  summaries: Array<{ id: string; kind: string; startAt: string; body: string; coachName: string; createdAt: string }>;
  followUps: Array<{ id: string; title: string; detail: string | null; resolution: string | null; status: string; createdAt: string }>;
};

export function SessionsTab({ ctx }: { ctx: RecordTabContext }) {
  const { memberId } = ctx;
  const router = useRouter();
  const tick = useRecordTick(ctx.record); // the record screen's pull to refresh reloads this tab's data too
  const data = useLoad<Payload>(`coach-client-sessions-${memberId}`, () => get(`/coach/clients/${memberId}/sessions`), [memberId, tick]);
  const d = data.data;
  return <TabState loading={data.loading && !d} error={data.error} onRetry={data.reload}>
    {d ? <View style={{ gap: space.md }}>
      <Card><Eyebrow>Consultations</Eyebrow><H2>Summaries for the client</H2>
        {d.summaries.length ? d.summaries.map((s) => <View key={s.id} style={st.item}><Text style={st.title}>{`${label(s.kind)} · ${fmtDate(s.startAt)}`}</Text><Text style={st.body}>{s.body}</Text><Text style={st.meta}>{`by ${s.coachName}, sent ${fmtDate(s.createdAt)}`}</Text></View>)
          : <Empty title="No summaries yet" body="Write one from Appointments after a consultation is completed." />}
      </Card>
      <Card><Eyebrow>Follow-ups</Eyebrow><H2>Your follow-ups from consultations</H2>
        {d.followUps.length ? d.followUps.map((t) => <View key={t.id} style={st.item}><Row between><Text style={st.title}>{t.title}</Text><StatusPill status={t.status} /></Row>{t.detail ? <Text style={st.body}>{t.detail}</Text> : null}{t.resolution ? <Text style={st.meta}>{t.resolution}</Text> : null}<Text style={st.meta}>{`Opened ${fmtDate(t.createdAt)}`}</Text></View>)
          : <Empty title="No follow-ups" />}
      </Card>
      <Card><Eyebrow>Live sessions</Eyebrow><H2>Group classes, webinars and workshops</H2>
        {d.registrations.length ? d.registrations.map((r) => <View key={r.sessionId} style={st.item}>
          {r.hostedByMe ? <Button title={r.title} variant="ghost" small onPress={() => router.push(`/coach/sessions/${r.sessionId}`)} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} /> : <Text style={st.title}>{r.title}</Text>}
          <Text style={st.meta}>{`${r.kindLabel} · ${fmtDate(r.startAt)} · ${r.hostName}`}</Text>
          <Row><RegistrationPill status={r.status} /><SessionStatusPill status={r.sessionStatus} /></Row>
        </View>) : <Empty title="No live sessions" body="Sessions the client registers for appear here." />}
      </Card>
    </View> : null}
  </TabState>;
}

const st = {
  item: { paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: space.xs },
  title: { color: colors.text, fontSize: font.body, fontWeight: '600' as const, flex: 1 },
  body: { color: colors.text, fontSize: font.small },
  meta: { color: colors.muted, fontSize: font.small },
};
