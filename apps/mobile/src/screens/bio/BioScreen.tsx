/* Bio (tab 3; the earlier app's BioTab, shots 42-bio, 43, 44, 45, 46): what the member, their coach or this phone
   logged, never a laboratory result (those stay in Life and reports).
   1. Header "Bio" over the people-free notebook band, with "+" for the Log a value sheet.
   2. The device card: this phone's step count (StepsCard), the only device Bioptime reads.
   3. "From your coach": the newest reply to a check-in or client note, on the red rule. Hidden when there is none.
   4. The metric rings (MetricGrid) for every metric the API offers; a tap opens the metric sheet.
   5. The trend card with EXPAND for the chart sheet (ranges from GET /me/progress/series).
   6. Check-ins, goals and "Due and done" (the progress module), then the latest entries and progress photos.
   Data: GET /me/progress/summary (core), /me/notes (core), and with `progress` on /me/goals, /me/checkins,
   /me/adherence. A module that is off is simply not drawn; the rings stay. Refreshes on focus and on return to the
   app (coach replies arrive this way), and when a value is logged.
   `?metric=<key>` (Home's score minis and metric tiles) opens that metric's sheet once its values are here, when it has
   a value; the parameter is then cleared, so coming back to the tab later does not reopen it.
   Motion (motion v2 M64, M67): the first card (the device card, else the coach's insight) arrives with the page
   (FirstCard: from the page-active edge, dimmed at .4 and .97, never blank on the pager's landing frame); the cards
   after it rise as they cross the line, and the rings sweep only once their tile has; a revisit shows the values at
   rest (seen keys). The metric grid, the trend card and everything after them mount once the page has settled and
   the device is idle (Deferred), so a first visit's slide carries only the header and the first cards. "See the trend" hands the metric sheet over to the trend sheet (one scrim kept up) while the sheet's
   line travels into the chart's frame; "Log a value" opens its screen once the sheet's last exit frame has drawn. */
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { get } from '@/lib/api';
import { useFeatures } from '@/lib/features';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import {
  ErrorState, fx, IconButton, Reveal, RevealScope, ScreenHeader, SettingsRow, Sheet, Skeleton, StaleBanner, T, TabScreen, TabTitleBar,
  useFocusRefresh, useStepCounter, useTabScroll,
} from '@/fx';
import { todaySteps, todayTotal } from '@/lib/today';
import { Deferred } from '@/fx/nav/Deferred';
import { FirstCard } from './FirstCard';
import { goalFor, latestInsight, type Adherence, type Checkin, type Goal, type Note, type Summary, type SummaryMetric } from './data';
import { MetricGrid } from './MetricGrid';
import { RailCard } from './parts';
import { Checkins, DueAndDone, GoalsCard, LatestEntries, TrendCard } from './Sections';
import { MetricBody, TrendBody } from './Sheets';
import { StepsCard } from './StepsCard';

type Open = { kind: 'metric' | 'trend'; metric: string } | null;

export default function BioScreen() {
  const features = useFeatures(true);
  const progressOn = !!features?.has('progress');
  const photosOn = progressOn && !!features?.has('progressPhotos');
  const summary = useLoad<Summary>('progress', () => get('/me/progress/summary'), []);
  const notes = useLoad<{ items: Note[] }>('notes', () => get('/me/notes'), []);
  const goals = useLoad<{ items: Goal[] } | null>(progressOn ? 'progress-goals' : null, () => (progressOn ? get('/me/goals') : Promise.resolve(null)), [progressOn]);
  const checkins = useLoad<{ items: Checkin[] } | null>(progressOn ? 'progress-checkins' : null, () => (progressOn ? get('/me/checkins') : Promise.resolve(null)), [progressOn]);
  const adherence = useLoad<Adherence | null>(progressOn ? 'progress-adherence' : null, () => (progressOn ? get('/me/adherence') : Promise.resolve(null)), [progressOn]);
  const reload = () => Promise.all([summary.reload(), notes.reload(), goals.reload(), checkins.reload(), adherence.reload()]);
  const { refreshing, onRefresh } = useFocusRefresh(reload);
  const [open, setOpen] = useState<Open>(null);
  const [trendMetric, setTrendMetric] = useState<string | null>(null);

  const metrics = useMemo(() => {
    const all = (summary.data?.metrics ?? []).filter((m) => m.enabled !== false);
    return [...all.filter((m) => m.latest), ...all.filter((m) => !m.latest)];
  }, [summary.data]);
  const withData = metrics.filter((m) => m.series.length);
  const goalList = goals.data?.items ?? null;
  const steps = metrics.find((m) => m.metric === 'steps') ?? null;
  // this phone's step counter, one for the page: the device card shows it, and the goals count it as today's steps
  const counter = useStepCounter(true);
  // today's totals for the goals on a day's total (lib/today, the same rule as Home): today's steps as the device card
  // counts them (the phone's live count while it counts, never below the server's total for today), else none
  const todayTotals = useMemo(() => {
    const water = metrics.find((m) => m.metric === 'water_ml') ?? null;
    const live = counter.status === 'counting' ? counter.steps : null;
    return { steps: todaySteps(live, todayTotal(steps?.series)), water_ml: todayTotal(water?.series) };
  }, [metrics, steps, counter.status, counter.steps]);
  const insight = latestInsight(checkins.data?.items, notes.data?.items);
  const chosen = withData.find((m) => m.metric === trendMetric) ?? withData[0] ?? null;
  const sheetMetric: SummaryMetric | null = open ? metrics.find((m) => m.metric === open.metric) ?? null : null;

  // a link's ?metric= opens that metric's sheet (a metric with no value yet stays on the page, where its tile says "Log")
  const { metric: asked } = useLocalSearchParams<{ metric?: string }>();
  useEffect(() => {
    if (!asked || !summary.data) return;
    if (metrics.some((m) => m.metric === asked && m.latest)) setOpen({ kind: 'metric', metric: asked });
    router.setParams({ metric: undefined });
  }, [asked, summary.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const loading = summary.loading && !summary.data;
  // "Log a value" in the metric sheet: the entry screen opens after the sheet's last exit frame
  const pendingLog = useRef<string | null>(null);
  const afterSheet = () => {
    const metric = pendingLog.current;
    pendingLog.current = null;
    if (metric) router.push({ pathname: '/progress-entry', params: { metric } });
  };

  const header = <ScreenHeader title="Bio" subtitle="What you, your coach or a connected device logged" photo={{ slot: 'bio.header', look: 'band' }}
    right={<Reveal from="scale" delay={300} id="bio.plus"><IconButton icon="plus" label="Log a value" kind="glass" size={40} iconSize={18} onPress={() => router.push('/progress-entry')} /></Reveal>} />;

  return <TabScreen refreshing={refreshing} onRefresh={onRefresh} sticky={<TabTitleBar title="Bio" />}>
    {header}
    <Body>
      <StaleBanner at={summary.stale} />
      <ErrorState error={summary.error} onRetry={summary.reload} />
      {loading ? <Placeholder /> : <>
        {/* the first card arrives with the page; the next one follows in the scroll reveal */}
        {steps ? <FirstCard id="bio.steps"><StepsCard counter={counter} steps={steps} goal={goalFor(goalList, 'steps')} onSynced={summary.reload} /></FirstCard> : null}

        {insight ? (() => {
          const card = <RailCard onPress={() => (insight.open.kind === 'checkin' ? router.push({ pathname: '/checkin/[id]', params: { id: insight.open.id } }) : router.push('/recommendations'))}
            label={`From your coach: ${insight.text}`} hint={insight.open.kind === 'checkin' ? 'Opens the check-in' : 'Opens your coach’s recommendations'}>
            <T v="overline" color={fx.red.brand} style={styles.overline}>From your coach</T>
            <T v="body" style={styles.insight}>{insight.text}</T>
            <T v="caption" color={fx.ink.a50}>{`${insight.who ?? 'Your coach'} · ${fmtDate(insight.at)}`}</T>
          </RailCard>;
          return steps ? <Reveal index={1} id="bio.insight">{card}</Reveal> : <FirstCard id="bio.insight">{card}</FirstCard>;
        })() : null}

        {/* the rings sit below the first cards: they mount once the page has settled (each tile is revealed, and its
            ring sweeps, as it crosses the line) */}
        {metrics.length ? <Deferred id="bio.grid"><MetricGrid metrics={metrics} goals={goalList} onOpen={(m) => setOpen({ kind: 'metric', metric: m.metric })} /></Deferred>
          : summary.data ? <T v="body" color={fx.ink.a60}>No measures are switched on for your account.</T> : null}

        {/* below the rings: mounted once the page has settled and the device is idle */}
        <Deferred id="bio.below" style={styles.below}>
          {chosen ? <Reveal index={1} id="bio.trend"><TrendCard metrics={withData} chosen={chosen} onChoose={setTrendMetric} onExpand={() => setOpen({ kind: 'trend', metric: chosen.metric })} /></Reveal> : null}

          {progressOn && checkins.data ? <Checkins items={checkins.data.items} /> : null}
          {progressOn && goals.data ? <GoalsCard goals={goals.data.items} today={todayTotals} /> : null}
          {progressOn && adherence.data ? <DueAndDone data={adherence.data} /> : null}
          {progressOn ? <ErrorState error={goals.error ?? checkins.error ?? adherence.error} onRetry={reload} /> : null}

          <LatestEntries metrics={metrics} />
          {photosOn ? <SettingsRow icon="images" title="Progress photos" sub="Private; your coach sees only the ones you share" onPress={() => router.push('/photos')} /> : null}
          {summary.data?.note ? <T v="caption" color={fx.ink.a55} style={styles.note}>{summary.data.note}</T> : null}
        </Deferred>
      </>}
    </Body>

    <Sheet visible={open?.kind === 'metric' && !!sheetMetric} onClose={() => setOpen(null)} onExited={afterSheet}>
      {sheetMetric ? <MetricBody m={sheetMetric} goals={goalList} canTrend={sheetMetric.series.length > 0}
        onLog={() => { pendingLog.current = sheetMetric.metric; setOpen(null); }}
        onTrend={() => setOpen({ kind: 'trend', metric: sheetMetric.metric })} /> : null}
    </Sheet>
    <Sheet visible={open?.kind === 'trend' && !!sheetMetric} onClose={() => setOpen(null)} tall>
      {sheetMetric ? <TrendBody key={sheetMetric.metric} m={sheetMetric} canRange={progressOn} /> : null}
    </Sheet>
  </TabScreen>;
}

/** The page's sections, revealed as they scroll in. */
function Body({ children }: { children: React.ReactNode }) {
  const scrollY = useTabScroll();
  const inner = <View style={styles.body}>{children}</View>;
  return scrollY ? <RevealScope scrollY={scrollY}>{inner}</RevealScope> : inner;
}

function Placeholder() {
  return <View style={styles.gap} accessibilityLabel="Loading">
    <Skeleton height={190} radius={fx.radius.three} />
    <Skeleton height={140} radius={fx.radius.three} />
    {[0, 1].map((r) => <View key={r} style={styles.row}><Skeleton height={210} radius={fx.radius.three} style={styles.flex} /><Skeleton height={210} radius={fx.radius.three} style={styles.flex} /></View>)}
  </View>;
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: fx.space.cardX, paddingTop: 8, gap: 24 },
  below: { gap: 24 },
  gap: { gap: 16 },
  row: { flexDirection: 'row', gap: 12 },
  flex: { flex: 1 },
  overline: { letterSpacing: 11 * 0.15 },
  insight: { fontSize: 16, lineHeight: 26, color: fx.ink.white },
  note: { textAlign: 'center', paddingHorizontal: 8 },
});
