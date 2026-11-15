/* Life (tab 4, "Longevity"; the earlier app's LongevityTab, shots 47-50 and 77) made of real results only:
   1. Header "Longevity" / "Your results over time" over the walk band, which has fully faded before the first card.
   2. The latest released report (ReportHero): markers inside their laboratory range, counted up; a tap lists every
      marker by panel. No report yet: "Your first report appears here" with Book a test.
   3. Marker trend in the "Projection Engine" chrome: one marker across reports, its laboratory range dashed in gold;
      a tap opens the tall sheet with the values table. Nothing is projected.
   4. The marker grid (ring = where the value sits in its range); a tap opens the marker sheet.
   5. Every released report, newest first (each opens the report).
   6. Next steps from your reports and the preparation for the next collection (labFollowups on). A consultation a
      step points at whose end has passed while it is still open reads "Awaiting update", never "Scheduled", and one
      under way stays as it is (the follow-up row's own rule, lib/today shownStatusWith: the same as Home, Coach and
      the report).
   7. Daily habits (habits on): today's check-ins ("2 of 5 done today": the due habits, the ticked ones included; "All
      done today" with the check popping once the last is ticked), streaks and the last days; "+" adds one, "Manage"
      opens Habits.
   `?section=next-steps` (from /lab-follow-ups) or `?section=habits` puts that section first for the visit.
   Motion (motion v2 M64, M67): the report hero arrives with the page (FirstCard: from the page-active edge, dimmed at
   .4 and .97, never blank on the pager's landing frame); the cards after it rise in 60 ms steps (at most 4) as they
   cross the line; "Your reports" and the sections after the markers mount once the page has settled and the device is
   idle (Deferred), except the section a link puts first. "Open the report" closes the sheet and opens the report once
   the sheet's last exit frame has drawn (its onExited).
   Data: GET /me/reports (core, the shared 'reports' key), /me/reports/markers/:key, /me/lab-follow-ups,
   /me/lab-preparation, /me/habits; refreshed on focus and when the app returns. */
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { get } from '@/lib/api';
import { useFeatures } from '@/lib/features';
import { NextStepsList, PreparationCard, useFollowUps, MarkerTrendView } from '@/lib/modules/labFollowupsViews';
import { useLoad } from '@/lib/useLoad';
import {
  CheckPop, EmptyState, ErrorState, FilterChip, fx, GlassCard, Icon, IconButton, Photo, Pill, Reveal, RevealScope, RowDivider, Scrim, ScreenHeader, Sheet,
  Skeleton, StaleBanner, T, TabScreen, TabTitleBar, Button, useFocusRefresh, useTabScroll,
} from '@/fx';
import { Deferred } from '@/fx/nav/Deferred';
import { ChipButton, ChipRow, SectionHead } from '../bio/parts';
import { FirstCard } from '../bio/FirstCard';
import { HabitForm, HabitRow } from './Habits';
import { AllMarkersBody, MarkerBody, MarkerGrid, ReportHero } from './Report';
import { countInRange, keyed, shortDate, type HabitList, type Report, type ReportValue } from './data';

type Open = { kind: 'all' } | { kind: 'marker'; value: ReportValue } | { kind: 'trend' } | { kind: 'habit' } | null;
type Section = 'next-steps' | 'habits';

export default function LifeScreen() {
  const params = useLocalSearchParams<{ section?: string }>();
  const [section, setSection] = useState<Section | null>(params.section === 'next-steps' || params.section === 'habits' ? params.section : null);
  useFocusEffect(useCallback(() => {
    if (params.section === 'next-steps' || params.section === 'habits') setSection(params.section);
    return () => { if (params.section) router.setParams({ section: undefined }); setSection(null); };
  }, [params.section]));
  const features = useFeatures(true);
  const labOn = !!features?.has('labFollowups');
  const habitsOn = !!features?.has('habits');
  const reports = useLoad<{ items: Report[] }>('reports', () => get('/me/reports'), [], { shared: true });
  const steps = useFollowUps(undefined, labOn);
  const habits = useLoad<HabitList | null>(habitsOn ? 'habits' : null, () => (habitsOn ? get('/me/habits') : Promise.resolve(null)), [habitsOn]);
  const reload = () => Promise.all([reports.reload(), steps.reload(), habits.reload()]);
  const { refreshing, onRefresh } = useFocusRefresh(reload);
  const [open, setOpen] = useState<Open>(null);
  // the sheet goes first (it is drawn above every screen); the report opens after its last exit frame (onExited)
  const pendingReport = useRef<string | null>(null);
  const openReport = (id: string) => { pendingReport.current = id; setOpen(null); };
  const afterSheet = () => {
    const id = pendingReport.current;
    pendingReport.current = null;
    if (id) router.push({ pathname: '/report/[id]', params: { id } });
  };

  const released = useMemo(() => (reports.data?.items ?? []).filter((r) => r.released).sort((a, b) => b.collectedAt.localeCompare(a.collectedAt)), [reports.data]);
  const latest = released[0] ?? null;
  const markers = useMemo(() => {
    const k = keyed(latest);
    return [...k.filter((v) => v.flag), ...k.filter((v) => !v.flag)];
  }, [latest]);
  const [trendKey, setTrendKey] = useState<string | null>(null);
  const trend = markers.find((m) => m.marker_key === trendKey) ?? markers[0] ?? null;
  const loading = reports.loading && !reports.data;

  // the sections are kept as the same elements while their data is the same, so opening or closing a sheet (the
  // `open` state) re-renders none of them: the tap's frame carries only the sheet's own work
  const reportsData = reports.data;
  const reportSections = useMemo(() => (loading ? <View style={styles.gap} accessibilityLabel="Loading"><Skeleton height={340} radius={fx.radius.hero} /><Skeleton height={260} radius={fx.radius.three} /></View>
    : latest ? <>
      <FirstCard id="life.hero"><ReportHero report={latest} count={released.length} onOpen={() => setOpen({ kind: 'all' })} /></FirstCard>
      {trend?.marker_key ? <Reveal index={1} id="life.trend">
        <GlassCard variant="three" padding={22} style={styles.gap}>
          <View style={styles.rowBetween}>
            <T v="cardTitle" style={styles.flex}>Marker trend</T>
            <ChipButton title="Expand" onPress={() => setOpen({ kind: 'trend' })} label={`Expand the ${trend.label} trend`} />
          </View>
          <ChipRow>{markers.map((m) => <FilterChip key={m.marker_key!} label={m.label} selected={m.marker_key === trend.marker_key} onPress={() => setTrendKey(m.marker_key)} />)}</ChipRow>
          <MarkerTrendView key={trend.marker_key} markerKey={trend.marker_key} name={trend.label} compact height={120} />
        </GlassCard>
      </Reveal> : null}
      {markers.length ? <View>
        <SectionHead title="Markers" icon="flask-conical" style={styles.headTight} />
        <T v="caption" color={fx.ink.a50} style={styles.headCaption}>{`${latest.test?.name ?? 'Report'} · ${shortDate(latest.collectedAt)}, as the laboratory reported them`}</T>
        <MarkerGrid values={markers} onOpen={(v) => setOpen({ kind: 'marker', value: v })} />
      </View> : null}
      {released.length ? <Deferred id="life.reports">
        <SectionHead title={released.length === 1 ? 'Your report' : 'Your reports'} icon="file-text" />
        <GlassCard padding={8}>
          {released.map((r, i) => {
            const c = countInRange(r);
            return <View key={r.id}>
              {i ? <RowDivider inset={12} /> : null}
              <GlassCard padding={12} borderColor={fx.premium.transparent} style={styles.inner} onPress={() => router.push({ pathname: '/report/[id]', params: { id: r.id } })}
                label={`${r.test?.name ?? 'Report'}, ${shortDate(r.collectedAt)}, ${c.flagged ? `${c.flagged} outside range` : 'all in range'}`}>
                <View style={styles.rowBetween}>
                  <View style={styles.flexGap}>
                    <T v="section" numberOfLines={3}>{r.test?.name ?? 'Report'}</T>
                    <T v="caption" color={fx.ink.a50}>{`${r.reference} · ${shortDate(r.collectedAt)}`}</T>
                    <View style={styles.pillRow}>{c.total ? (c.flagged ? <Pill tone="warning">{`${c.flagged} outside range`}</Pill> : <Pill tone="success">All in range</Pill>) : <Pill>{r.valuesStatus === 'pending' ? 'Values pending' : 'Document'}</Pill>}{r.simulated ? <Pill tone="sample">Simulated result</Pill> : null}</View>
                  </View>
                  <Icon name="chevron-right" size={16} color={fx.ink.a40} />
                </View>
              </GlassCard>
            </View>;
          })}
        </GlassCard>
      </Deferred> : null}
    </> : reportsData ? <EmptyState photo="report" icon="flask-conical" title="Your first report appears here"
      body="Once the laboratory reports a blood test and your coach has reviewed it, your results and how each marker changes show here."
      action={{ title: 'Book a test', onPress: () => router.push('/(tabs)/tests') }} /> : null), [loading, latest, released, trend, markers, reportsData]);

  const stepsData = steps.data, stepsError = steps.error, stepsLoading = steps.loading, stepsReload = steps.reload;
  const stepItems = useMemo(() => stepsData?.items ?? [], [stepsData]);
  const nextSteps = useMemo(() => (labOn ? <View key="next-steps" nativeID="life-next-steps">
    <SectionHead title="Next steps from your reports" icon="clipboard-list" />
    <View style={styles.gap}>
      <ErrorState error={stepsError} onRetry={stepsReload} />
      {stepsLoading && !stepsData ? <Skeleton height={140} radius={fx.radius.three} /> : <NextStepsList items={stepItems} showReport />}
      <PreparationCard />
    </View>
  </View> : null), [labOn, stepsData, stepItems, stepsError, stepsLoading, stepsReload]);

  const habitsData = habits.data, habitsError = habits.error, habitsLoading = habits.loading, habitsReload = habits.reload;
  const habitsSection = useMemo(() => {
    const habitItems = (habitsData?.items ?? []).filter((h) => h.status !== 'archived');
    // due today first, in an order that holds through the day: a habit ticked keeps its place (its check pops where it
    // was tapped) instead of jumping to the end as the next one slides under the finger (CRT-1)
    const ordered = [...habitItems.filter((h) => h.today.due && h.status === 'active'), ...habitItems.filter((h) => !(h.today.due && h.status === 'active'))];
    // today's count: the habits due today, the ones already ticked included (the API's dueToday counts only those still
    // waiting), so ticking one never reads as fewer due
    const dueToday = habitItems.filter((h) => h.status === 'active' && h.today.due);
    const doneToday = dueToday.filter((h) => h.today.checkin?.status === 'done').length;
    const allDone = dueToday.length > 0 && doneToday === dueToday.length;
    const countText = !habitsData ? ' ' : !dueToday.length ? 'Nothing due today' : allDone ? 'All done today' : `${doneToday} of ${dueToday.length} done today`;
    return habitsOn ? <View key="habits" nativeID="life-habits">
      <View style={styles.band}>
        <Photo slot="life.habits.header" opacity={0.3} style={StyleSheet.absoluteFill} decorative />
        <Scrim kind="headerBand" style={StyleSheet.absoluteFill} />
        <Scrim kind="emptyBand" style={styles.topFade} />
        <View style={styles.bandRow}>
          <View style={styles.flex}>
            <T v="eyebrowBrand">Every day</T>
            <T v="card24" accessibilityRole="header">Daily habits</T>
          </View>
          <IconButton icon="plus" label="Add a habit" kind="glass" size={40} iconSize={18} onPress={() => setOpen({ kind: 'habit' })} />
        </View>
      </View>
      <View style={styles.gapSm}>
        <View style={styles.rowBetween}>
          <View style={styles.countRow} accessible accessibilityLabel={countText}>
            {dueToday.length ? <CheckPop checked={allDone} size={16} color={fx.hue.green500} empty /> : null}
            <T v="caption" color={allDone ? fx.hue.green400 : fx.ink.a60} style={styles.flex}>{countText}</T>
          </View>
          <Button title="Manage" variant="link" style={styles.link44} small onPress={() => router.push('/habits')} />
        </View>
        <ErrorState error={habitsError} onRetry={habitsReload} />
        {habitsLoading && !habitsData ? <Skeleton height={110} radius={fx.radius.card} />
          : ordered.length ? ordered.map((h, i) => <Reveal key={h.id} index={i} id={`life.habit.${h.id}`}><HabitRow h={h} onChanged={habitsReload} /></Reveal>)
          : <EmptyState dashed icon="list-checks" title="No habits yet" body="Add one of your own, or your coach sets them from your plan." action={{ title: 'Add a habit', onPress: () => setOpen({ kind: 'habit' }) }} />}
        {habitsData?.note ? <T v="caption" color={fx.ink.a55}>{habitsData.note}</T> : null}
      </View>
    </View> : null;
  }, [habitsOn, habitsData, habitsError, habitsLoading, habitsReload]);

  const tail = section === 'habits' ? [habitsSection, nextSteps] : [nextSteps, habitsSection];
  // below the reports: mounted once the page has settled and the device is idle; the section a link puts first is
  // never deferred (it is what the link asked for)
  const later = (id: string, node: React.ReactNode) => (node ? <Deferred key={id} id={id}>{node}</Deferred> : null);

  return <TabScreen refreshing={refreshing} onRefresh={onRefresh} sticky={<TabTitleBar title="Longevity" />}>
    <ScreenHeader title="Longevity" subtitle="Your results over time" backdrop={<View style={styles.headerBand}>
      <Photo slot="life.header" opacity={0.22} style={StyleSheet.absoluteFill} decorative />
      <Scrim kind="headerBand" style={StyleSheet.absoluteFill} />
    </View>} />
    <Body>
      <StaleBanner at={reports.stale} />
      <ErrorState error={reports.error} onRetry={reports.reload} />
      {section ? <>{tail[0]}{reportSections}{later(`life.tail.${section}`, tail[1])}</>
        : <>{reportSections}{later('life.tail.0', tail[0])}{later('life.tail.1', tail[1])}</>}
    </Body>

    <Sheet visible={open?.kind === 'all' && !!latest} onClose={() => setOpen(null)} onExited={afterSheet} tall kind="lab" closeButton title="My blood work">
      {latest ? <AllMarkersBody report={latest} onReport={() => openReport(latest.id)} /> : null}
    </Sheet>
    <Sheet visible={open?.kind === 'marker'} onClose={() => setOpen(null)} onExited={afterSheet}>
      {open?.kind === 'marker' && latest ? <MarkerBody v={open.value} report={latest} onReport={() => openReport(latest.id)} /> : null}
    </Sheet>
    <Sheet visible={open?.kind === 'trend' && !!trend?.marker_key} onClose={() => setOpen(null)} tall closeButton title={trend ? `${trend.label} over time` : 'Marker trend'}>
      {trend?.marker_key ? <MarkerTrendView key={trend.marker_key} markerKey={trend.marker_key} name={trend.label} height={180} /> : null}
    </Sheet>
    <Sheet visible={open?.kind === 'habit'} onClose={() => setOpen(null)} title="Add a habit">
      {open?.kind === 'habit' ? <HabitForm onDone={() => { setOpen(null); void habits.reload(); }} /> : null}
    </Sheet>
  </TabScreen>;
}

function Body({ children }: { children: React.ReactNode }) {
  const scrollY = useTabScroll();
  const inner = <View style={styles.body}>{children}</View>;
  return scrollY ? <RevealScope scrollY={scrollY}>{inner}</RevealScope> : inner;
}

const styles = StyleSheet.create({
  link44: { minHeight: 44, minWidth: 44, paddingHorizontal: 4 },
  body: { paddingHorizontal: fx.space.cardX, paddingTop: 8, gap: 24 },
  headerBand: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 40, overflow: 'hidden' },
  gap: { gap: 16 },
  gapSm: { gap: 10 },
  flex: { flex: 1, minWidth: 0 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  // today's count takes the row's free width beside Manage: a caption whose box hugs its text lost its last word on
  // Android ('1 of 5 done today' drawn '1 of 5 done' at text 2.0: VA-1)
  countRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 },
  inner: { boxShadow: 'none', backgroundColor: fx.premium.transparent },
  flexGap: { flex: 1, minWidth: 0, gap: 4 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  headTight: { marginBottom: 2 },
  headCaption: { marginBottom: 12 },
  topFade: { position: 'absolute', left: 0, right: 0, top: 0, height: 56, transform: [{ scaleY: -1 }] },
  band: { height: 132, marginHorizontal: -fx.space.cardX, marginBottom: 4, justifyContent: 'flex-end', overflow: 'hidden' },
  bandRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, paddingHorizontal: fx.space.cardX, paddingBottom: 8 },
});
