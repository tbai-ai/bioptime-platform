/* Coach › a laboratory report (the portal's /coach/reports/:id, pages/Report.tsx for a coach): GET /reports/:id (the
   server needs the assignment and the client's health sharing; every read is audited), the results as the laboratory
   reported them, the coach's review form (POST /coach/reports/:id/review releases the report to the member and
   completes the booking), the report document through a 5-minute token, "Next steps" while the 'labFollowups' flag is
   on (components/coach/labNextSteps), and the limits. The toast (the release, every Next steps message, a refused
   document) floats over the bottom of the screen (ToastFloat, outside the scroll view), so it is seen from the review
   form and Next steps far down the page. */
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { errorText, get, post } from '@/lib/api';
import { apiBaseSync } from '@/lib/config';
import { useFeatures } from '@/lib/features';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Button, Card, Field, Loading, P, Pill, Row, Screen, StaleBanner } from '@/components/ui';
import { RoleGate, notifyBadges } from '@/components/workspaceShell';
import { Enter, MotionCard } from '@/motion';
import { coachScreenOptions } from '@/components/coach/bell';
import { ReportNextSteps } from '@/components/coach/labNextSteps';
import { CoachRefusal } from '@/components/coach/b/refusal';
import { CardHead, Muted, PageHead, Small, TextArea, ToastFloat, WarnPills, useToast } from '@/components/coach/shared';
import { colors, font, space } from '@/theme';

export default function CoachReport() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const report = useLoad<any>(`coach-report-${id}`, () => get(`/reports/${id}`), [id]);
  const labOn = !!useFeatures(true)?.has('labFollowups');
  const { toast, show } = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const r = report.data;
  const review = async () => {
    setBusy(true);
    try { await post(`/coach/reports/${id}/review`, { coachNote: note.trim(), flagged: r.flagged ?? [] }); show('Report reviewed and released to the member'); void report.reload(); notifyBadges(); }
    catch (e) { show(errorText(e), 'error'); } finally { setBusy(false); }
  };
  const openFile = async () => { try { const t = await post<{ token: string }>(`/reports/${id}/file-token`); await WebBrowser.openBrowserAsync(`${apiBaseSync()}/api/reports/file?token=${encodeURIComponent(t.token)}`); } catch (e) { show(errorText(e), 'error'); } };
  const range = (v: any) => v.matched_range ?? (v.range_low !== null && v.range_high !== null ? `${v.range_low}–${v.range_high}` : v.range_low !== null ? `≥ ${v.range_low}` : v.range_high !== null ? `≤ ${v.range_high}` : '—');
  return <RoleGate workspace="coach"><View style={{ flex: 1 }}><Screen refreshing={report.loading} onRefresh={report.reload}>
    <Stack.Screen options={coachScreenOptions(r?.test?.name ?? 'Report')} />
    <StaleBanner at={report.stale} /><CoachRefusal error={report.error} onRetry={report.reload} />
    {report.loading && !r ? <Loading /> : r ? <>
      <Enter><PageHead back="Client" onBack={() => router.push(`/coach/clients/${r.memberId}?tab=bloodwork`)} title={r.test?.name ?? 'Report'} sub={`${r.reference} · collected ${fmtDateTime(r.collectedAt)} · laboratory report ${fmtDate(r.deliveredAt)} · ${r.reviewed ? `reviewed by ${r.reviewerName} on ${fmtDate(r.reviewedAt)}` : 'awaiting review'}`}>
        <Pill tone={r.released ? 'success' : 'warning'}>{r.released ? 'Released to member' : 'Not released'}</Pill>
        <Button title="Open report document" small variant="secondary" onPress={openFile} />
      </PageHead></Enter>
      {r.simulated ? <Muted>Practice laboratory: this result is simulated and no sample is collected.</Muted> : null}
      <MotionCard index={1} pressable={false}><Card>
        <CardHead eyebrow="Section 1" title="Results as reported by the laboratory" />
        {r.values?.length ? r.values.map((v: any, i: number) => <View key={i} style={styles.valueRow}>
          <Row between style={{ flexWrap: 'nowrap' }}><View style={{ flex: 1, minWidth: 0 }}><Text style={styles.marker}>{v.label}</Text>{v.unmapped ? <Muted>not mapped to a Bioptime marker; kept as sent</Muted> : null}</View><Text style={[styles.result, v.flag && { color: colors.warningText }]}>{v.value} <Text style={styles.unit}>{v.units ?? ''}</Text></Text></Row>
          <Row between><Muted>{`Laboratory range ${range(v)}`}</Muted>{v.flag ? <Pill tone="warning">{`▲ Outside range (${v.flag})`}</Pill> : <Small>In range</Small>}</Row>
        </View>) : <Small>{r.valuesStatus === 'pending' ? 'Marker values have not arrived from the laboratory yet; the PDF is the record until they do.' : r.valuesStatus === 'failed' ? 'The laboratory could not extract values for this report; the PDF stays available and the team has been alerted.' : 'No values.'}</Small>}
        {r.provenance ? <Muted>{r.provenance}</Muted> : null}
      </Card></MotionCard>
      <MotionCard index={2} pressable={false}><Card>
        <CardHead eyebrow="Section 2" title={r.reviewerKind === 'team' ? 'Review notes · Bioptime team' : 'Coach commentary'} />
        {r.reviewed ? <><P>{r.coachNote}</P><Muted>{`Released ${fmtDateTime(r.releasedAt)}.`}</Muted></>
          : r.reviewerKind === 'team' ? <Small>The Bioptime team reviews this report and releases it to the member: you are away, or the member keeps health sharing with their coach off. Coach review is not available for it.</Small>
            : <>
              <Field label="Note for the member" hint="Plain language: what is in range, what is outside, what is urgent (usually nothing), what changes. Point to a doctor for decisions about medicines or tests."><TextArea rows={5} value={note} onChangeText={setNote} maxLength={4000} placeholder="Seven of nine markers are inside the laboratory's ranges…" accessibilityLabel="Note for the member" /></Field>
              {(r.flagged ?? []).length ? <View><Text style={styles.label}>Flags from the laboratory's ranges</Text><WarnPills items={r.flagged} /></View> : null}
              <Button title="Mark reviewed and release" busy={busy} disabled={note.trim().length < 5} onPress={review} />
              <Muted>Releasing completes the booking and notifies the member. It is recorded with your name.</Muted>
            </>}
      </Card></MotionCard>
      {labOn ? <MotionCard index={3} pressable={false}><ReportNextSteps report={{ id: r.id, memberId: r.memberId, released: !!r.released }} show={show} /></MotionCard> : null}
      <MotionCard index={4} pressable={false}><Card>
        <CardHead eyebrow="Section 3" title="Limits" />
        <Small>A single test is a snapshot. A result outside a range is not a diagnosis, and one inside does not rule a condition out. Bioptime is wellbeing guidance, not medical advice; medicines, supplements and further tests are a doctor's call.</Small>
        <Button title="Back" small variant="ghost" onPress={() => { if (router.canGoBack()) router.back(); else router.push(`/coach/clients/${r.memberId}?tab=bloodwork`); }} style={{ alignSelf: 'flex-start' }} />
      </Card></MotionCard>
    </> : null}
  </Screen><ToastFloat toast={toast} /></View></RoleGate>;
}

const styles = StyleSheet.create({
  valueRow: { paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 2 },
  marker: { color: colors.text, fontSize: font.body, fontWeight: '600' },
  result: { color: colors.text, fontSize: font.body, fontWeight: '700' },
  unit: { color: colors.muted, fontWeight: '400', fontSize: font.small },
  label: { color: colors.text, fontSize: font.small, fontWeight: '600' },
});
