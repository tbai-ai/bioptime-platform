/* Admin › Report (the web's /admin/reports/:id, apps/dashboard/src/pages/Report.tsx): one laboratory report as the
   laboratory reported it, the review commentary (the coach's, or the Bioptime team's release) and the limits. GET
   /reports/:id admits any administrator; the review form itself is the coach's, so administrators read. The document
   opens through a 5-minute token in the system browser; the button is always offered, as on the web (Report.tsx:25),
   and a report without a file answers with the server's refusal as an error toast. Modules add sections under the review card through
   lib/admin/b1/reportSections (the web hosts the lab follow-ups' "Next steps" there). */
import { Stack, useRouter } from 'expo-router';
import { useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React from 'react';
import { Text, View } from 'react-native';
import { errorText, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { apiBaseSync } from '@/lib/config';
import { useFeatures } from '@/lib/features';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { labRange } from '@/lib/admin/b1/common';
import { REPORT_SECTIONS } from '@/lib/admin/b1/reportSections';
import type { Report } from '@/lib/admin/b1/types';
import { AdminBell } from '@/components/adminB1/adminBell';
import { useToast } from '@/components/adminB1/toast';
import { Button, Card, ErrorBox, Eyebrow, H2, Loading, P, Pill, Row, Screen, StaleBanner } from '@/components/ui';
import { RoleGate } from '@/components/workspaceShell';
import { Enter } from '@/motion';
import { colors, font, space } from '@/theme';

export default function AdminReport() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAuth();
  const features = useFeatures(true);
  const r = useLoad<Report>(`admin-report-${id}`, () => get(`/reports/${id}`), [id]);
  const { toast, show } = useToast();
  const d = r.data;
  const openFile = async () => {
    try { const t = await post<{ token: string }>(`/reports/${id}/file-token`); await WebBrowser.openBrowserAsync(`${apiBaseSync()}/api/reports/file?token=${encodeURIComponent(t.token)}`); }
    catch (e) { show(errorText(e), 'error'); }
  };
  const sections = d ? REPORT_SECTIONS.filter((s) => !!features && features.has(s.module) && (!s.feature || features.has(s.feature)) && (!s.permission || can(s.permission))) : [];
  return <Screen refreshing={r.loading} onRefresh={r.reload}>
    <Stack.Screen options={{ title: 'Report', headerRight: () => <AdminBell /> }} />
    <RoleGate workspace="admin">
      <StaleBanner at={r.stale} /><ErrorBox error={r.error} onRetry={r.reload} />
      {toast}
      {r.loading && !d ? <Loading /> : d ? <>
        <Enter>
          <Button title="← Client" variant="ghost" small onPress={() => router.push(`/admin/clients/${d.memberId}?tab=bloodwork`)} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} />
          <Text style={{ color: colors.text, fontSize: font.title, fontWeight: '700', letterSpacing: -0.5 }}>{d.test?.name ?? 'Report'}</Text>
          <Text style={{ color: colors.muted, fontSize: font.body, marginTop: space.xs, lineHeight: 21 }}>{`${d.reference} · collected ${fmtDateTime(d.collectedAt)} · laboratory report ${fmtDate(d.deliveredAt)} · ${d.reviewed ? `reviewed by ${d.reviewerName ?? '—'} on ${fmtDate(d.reviewedAt)}` : 'awaiting review'}`}</Text>
          {d.simulated ? <P muted small>Practice laboratory: this result is simulated and no sample is collected.</P> : null}
          <Row style={{ marginTop: space.sm }}><Pill tone={d.released ? 'success' : 'warning'}>{d.released ? 'Released to member' : 'Not released'}</Pill><Button title="Open report document" variant="secondary" small onPress={openFile} /></Row>
        </Enter>
        <Enter index={1}><Card><Eyebrow>Section 1</Eyebrow><H2>Results as reported by the laboratory</H2>
          {d.values?.length ? d.values.map((v, i) => <View key={`${v.label}-${i}`} style={{ paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Row between><Text style={{ color: colors.text, fontWeight: '600', flex: 1 }}>{v.label}</Text><Text style={{ color: v.flag ? colors.warningText : colors.text, fontWeight: '700' }}>{v.value} <Text style={{ color: colors.muted, fontWeight: '400' }}>{v.units ?? ''}</Text></Text></Row>
            {v.unmapped ? <Text style={{ color: colors.muted, fontSize: font.tiny }}>not mapped to a Bioptime marker; kept as sent</Text> : null}
            <Row between><Text style={{ color: colors.muted, fontSize: font.small }}>Laboratory range {labRange(v)}</Text>{v.flag ? <Pill tone="warning">{`▲ Outside range (${v.flag})`}</Pill> : <Text style={{ color: colors.muted, fontSize: font.small }}>In range</Text>}</Row>
          </View>) : <P small>{d.valuesStatus === 'pending' ? 'Marker values have not arrived from the laboratory yet; the PDF is the record until they do.' : d.valuesStatus === 'failed' ? 'The laboratory could not extract values for this report; the PDF stays available and the team has been alerted.' : 'No values.'}</P>}
          <P muted small>{d.provenance}</P>
        </Card></Enter>
        <Enter index={2}><Card><Eyebrow>Section 2</Eyebrow><H2>{d.reviewerKind === 'team' ? 'Review notes · Bioptime team' : 'Coach commentary'}</H2>
          {d.reviewed ? <><P>{d.coachNote}</P><P muted small>{`Released ${fmtDateTime(d.releasedAt)}.`}</P></>
            : d.reviewerKind === 'team' ? <View><P small>No coach can review this report, so it waits for a release by the Bioptime team from Bloodwork → Reports.</P><Button title="Bloodwork → Reports" variant="ghost" small onPress={() => router.push('/admin/bloodwork')} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} /></View>
            : <P small>Awaiting the assigned coach's review.</P>}
        </Card></Enter>
        {sections.map((s, i) => <Enter key={s.id} index={3 + i}>{s.render({ report: d, reload: () => { void r.reload(); } })}</Enter>)}
        <Enter index={3 + sections.length}><Card><Eyebrow>Section 3</Eyebrow><H2>Limits</H2>
          <P small>A single test is a snapshot. A result outside a range is not a diagnosis, and one inside does not rule a condition out. Bioptime is wellbeing guidance, not medical advice; medicines, supplements and further tests are a doctor's call.</P>
          <Button title="Back" variant="secondary" small onPress={() => (router.canGoBack() ? router.back() : router.replace('/admin/bloodwork'))} style={{ alignSelf: 'flex-start', marginTop: space.sm }} />
        </Card></Enter>
      </> : null}
    </RoleGate>
  </Screen>;
}
