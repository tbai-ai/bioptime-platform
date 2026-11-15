/* One released report (overlay; from Tests, Life, Profile › Reports, booking and notifications) in the earlier app's
   blood-work look (shots 77-bloodwork-results*): the abstract band, date chips to switch between released reports, the
   summary card (name, reference, dates, values outside range), the markers in collapsible panels with range bars, the
   laboratory's provenance line, the marker trend and next steps (labFollowups on), the coach's or the Bioptime team's
   review note, the limits (word for word), and "Open the laboratory document" through a five-minute link.
   Data: GET /reports/:id, /me/reports (the chips), POST /reports/:id/file-token. */
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { errorText, get, post } from '@/lib/api';
import { apiBaseSync } from '@/lib/config';
import { fmtDate } from '@/lib/format';
import { MarkerTrendCard, NextStepsCard, useLabFlag } from '@/lib/modules/labFollowupsViews';
import { useLoad } from '@/lib/useLoad';
import { Button, ErrorState, FilterChip, fx, Overlay, Photo, Pill, Scrim, Skeleton, StaleBanner, T, toast, useFocusRefresh } from '@/fx';
import { Panel } from '@/screens/tests/Checkout';
import { markerPanels, reportState, type Report } from '@/screens/tests/model';
import { MarkerPanel, ReportSummary, ReviewNote } from '@/screens/tests/ReportParts';

export default function ReportRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const r = useLoad<Report>(`report-${id}`, () => get(`/reports/${id}`), [id]);
  const list = useLoad<{ items: Report[] }>('reports', () => get('/me/reports'), []);
  const labFollowUps = useLabFlag(); // next steps and the marker trend, while the labFollowups module is on
  useFocusRefresh(() => Promise.all([r.reload(), list.reload()]));
  const d = r.data;
  const openFile = async () => { try { const t = await post<{ token: string }>(`/reports/${id}/file-token`); await WebBrowser.openBrowserAsync(`${apiBaseSync()}/api/reports/file?token=${encodeURIComponent(t.token)}`); } catch (e) { toast.error(errorText(e)); } };
  const others = list.data?.items ?? [];
  const state = d ? reportState(d) : null;
  const panels = d?.values?.length ? markerPanels(d.values) : [];

  return <Overlay title="Blood work" display subtitle={d ? `${d.reference} · ${fmtDate(d.collectedAt)}` : undefined} fallback="/(tabs)/tests"
    hero={<View style={styles.band} pointerEvents="none">
      <Photo slot="report.header" opacity={0.22} decorative style={StyleSheet.absoluteFill} />
      <Scrim kind="headerBand" style={StyleSheet.absoluteFill} />
    </View>}
    contentStyle={styles.body}>
    <StaleBanner at={r.stale} />
    <ErrorState error={r.error} onRetry={r.reload} />
    {others.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipScroll}>
      {others.map((o) => <FilterChip key={o.id} label={fmtDate(o.collectedAt)} selected={o.id === id} onPress={() => { if (o.id !== id) router.setParams({ id: o.id }); }} />)}
    </ScrollView> : null}
    {r.loading && !d ? <View style={styles.gap}><Skeleton height={120} radius={fx.radius.three} /><Skeleton height={300} radius={fx.radius.three} /></View> : null}
    {d ? <>
      <ReportSummary d={d} pills={<>
        {d.simulated ? <Pill tone="sample">Simulated result</Pill> : null}
        {state ? <Pill tone={state.tone}>{state.text}</Pill> : null}
      </>} />

      {panels.length ? panels.map((p, i) => <MarkerPanel key={p.title} title={p.title} values={p.values} flags={p.flags} index={i} />)
        : <Panel label="Results as reported by the laboratory">
          <T v="body" color={fx.ink.a70}>{d.valuesStatus === 'pending' ? 'Marker values have not arrived from the laboratory yet; the document below is the record until they do.' : d.valuesStatus === 'failed' ? 'The laboratory could not extract values for this report; the document is still available.' : 'No values.'}</T>
        </Panel>}
      <T v="caption" color={fx.ink.a50}>{d.provenance}</T>

      {labFollowUps ? <MarkerTrendCard values={d.values?.map((v) => ({ marker_key: v.marker_key, label: v.label, value: v.value, units: v.units, flag: v.flag }))} /> : null}
      <ReviewNote d={d} />
      {labFollowUps ? <NextStepsCard reportId={id} /> : null}

      <Panel label="Limits">
        <T v="body" color={fx.ink.a80}>A single test is a snapshot. A result outside a range is not a diagnosis, and one inside does not rule a condition out. Bioptime is wellbeing guidance, not medical advice; medicines, supplements and further tests are a doctor's call.</T>
      </Panel>
      {d.hasFile ? <Button title="Open the laboratory document" variant="soft" icon="file-text" onPress={openFile} style={styles.file} /> : null}
      <T v="caption" color={fx.ink.a50} center>Reports stay in the app and are never emailed. Opening the document uses a link that expires in five minutes.</T>
    </> : null}
  </Overlay>;
}

const styles = StyleSheet.create({
  band: { height: 96, marginBottom: -96 },
  body: { gap: 14 },
  gap: { gap: 16 },
  chips: { gap: 8, paddingRight: 4 },
  chipScroll: { flexGrow: 0 },
  file: { minHeight: 52, borderRadius: fx.radius.card },
});
