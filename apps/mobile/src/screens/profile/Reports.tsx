/* Profile › Reports (the earlier app's shots 76-profile-reports): what the member's records add up to, never an AI
   summary and never a score Bioptime does not compute.
   - Plan progress: GET /me/progress/summary `programmeCompletion` and its task counts.
   - Key measures: each metric with a latest value, its sparkline and the change since the entry before it (both
     recorded values, in neutral ink: no goal says which way is better here), with who recorded it; "Log a value"
     opens the log sheet.
   - My blood work: the released reports (GET /me/reports) → the report overlay.
   - Download: the latest report's document (POST /reports/:id/file-token, a five-minute link) and the data export
     (Your data). */
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { errorText, get, post } from '@/lib/api';
import { apiBaseSync } from '@/lib/config';
import { fmtDate, istDate } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import {
  Button, EmptyState, ErrorState, formatCount, fx, GlassCard, Icon, ProgressBar, Reveal, SettingsRow, Skeleton, Sparkline,
  StaleBanner, T, toast,
} from '@/fx';
import { Beside, FitText } from '@/fx/wordFit';
import type { Metric, Report, Summary } from './data';
import { CardTitle, Pair, shared } from './parts';

const SOURCE: Record<string, string> = { member: 'Self-reported', device: 'From a device', coach: 'From your coach' };

export function Reports({ register }: { register: (fn: (() => Promise<unknown>) | null) => void }) {
  const summary = useLoad<Summary>('progress', () => get('/me/progress/summary'), []);
  const reports = useLoad<{ items: Report[] }>('reports', () => get('/me/reports'), []);
  const reload = useCallback(() => Promise.all([summary.reload(), reports.reload()]), [summary.reload, reports.reload]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { register(reload); return () => register(null); }, [register, reload]);
  const [opening, setOpening] = useState(false);

  const s = summary.data;
  const metrics = (s?.metrics ?? []).filter((m) => m.enabled !== false && m.latest);
  const pairs: Metric[][] = [];
  for (let i = 0; i < metrics.length; i += 2) pairs.push(metrics.slice(i, i + 2));
  const list = reports.data?.items ?? [];
  const withFile = list.find((r) => r.hasFile) ?? null;

  const download = async (r: Report) => {
    setOpening(true);
    try { const t = await post<{ token: string }>(`/reports/${r.id}/file-token`); await WebBrowser.openBrowserAsync(`${apiBaseSync()}/api/reports/file?token=${encodeURIComponent(t.token)}`); }
    catch (e) { toast.error(errorText(e)); } finally { setOpening(false); }
  };

  return <View style={shared.gap16}>
    <StaleBanner at={summary.stale ?? reports.stale} />
    <ErrorState error={summary.error} onRetry={summary.reload} />
    {summary.loading && !s ? <Skeleton height={150} radius={fx.radius.card} /> : s ? <Reveal index={0} id="profile.reports.plan">
      <GlassCard>
        {/* the figure sits beside the title while its longest word fits whole beside it, else under it (measured:
            Beside; 'pr/ogress' at 320 dp and text 2.0, SWB-17) */}
        <Beside words={[{ text: 'Plan progress', v: 'label' }, { text: 'Due tasks done', v: 'cardTitle', style: styles.planTitle }]} align="flex-start" underGap={6}
          side={<View style={styles.planValue}>
            <T v="metric30" accessibilityLabel={s.programmeCompletion == null ? 'No plan tasks yet' : `${s.programmeCompletion} percent`}>{s.programmeCompletion == null ? '—' : `${s.programmeCompletion}%`}</T>
            {s.tasks?.total ? <T v="caption" color={fx.hue.green400}>{`${s.tasks.done} of ${s.tasks.total}${s.tasks.skipped ? ` · ${s.tasks.skipped} skipped` : ''}`}</T> : null}
          </View>}>
          <T v="label" color={fx.ink.a55}>Plan progress</T>
          <T v="cardTitle" style={styles.planTitle}>Due tasks done</T>
        </Beside>
        {s.programmeCompletion != null ? <ProgressBar value={s.programmeCompletion / 100} size="medium" color={fx.status.optimal} completeGreen={false} duration={800} accessibilityLabel="Due plan tasks done" style={styles.bar} />
          : <T v="bodySm" color={fx.ink.a60} style={styles.bar}>No plan tasks are due yet.</T>}
      </GlassCard>
    </Reveal> : null}

    {s ? <View style={shared.gap12}>
      <View style={styles.sectionHead}>
        <T v="label" accessibilityRole="header" color={fx.ink.a55}>Key measures</T>
        <Button title="Log a value" variant="link" icon="plus" iconRight={null} onPress={() => router.push('/progress-entry')} />
      </View>
      {pairs.length ? pairs.map((p, i) => <Reveal key={i} index={i + 1} id={`profile.reports.m${i}`}>
        <Pair>{p.map((m, j) => <MeasureTile key={m.metric} m={m} index={i * 2 + j} />)}</Pair>
      </Reveal>) : <EmptyState dashed icon="chart-line" title="Nothing logged yet" body="Weight, sleep, steps and the rest appear here once you, your coach or this phone log them." />}
      {s.note ? <T v="caption" color={fx.ink.a50} style={styles.note}>{s.note}</T> : null}
    </View> : null}

    <ErrorState error={reports.error} onRetry={reports.reload} />
    {reports.data ? <Reveal index={2} id="profile.reports.blood">
      <GlassCard>
        <CardTitle icon="flask-conical" title="My blood work" right={list.length ? <T v="caption" color={fx.ink.a55}>{`${list.length} released`}</T> : null} />
        {list.length ? list.map((r, i) => <View key={r.id}>
          {i ? <View style={styles.line} /> : null}
          <SettingsRow title={r.test?.name ?? 'Report'} sub={`${r.collectedAt ? `Collected ${fmtDate(r.collectedAt)}` : r.reference} · ${r.flagged.length ? `${r.flagged.length} outside range` : 'all in range'}${r.reviewed && r.reviewerName ? ` · reviewed by ${r.reviewerName}` : ''}`}
            onPress={() => router.push(`/report/${r.id}`)} style={styles.flatRow} />
        </View>) : <T v="bodySm" color={fx.ink.a60}>No report released yet. A report appears here once the laboratory delivers it and it is reviewed.</T>}
        {!list.length ? <Button title="Book a blood test" variant="link" iconRight={null} onPress={() => router.push('/(tabs)/tests')} style={styles.link} /> : null}
      </GlassCard>
    </Reveal> : reports.loading ? <Skeleton height={120} radius={fx.radius.card} /> : null}

    <Reveal index={3} id="profile.reports.downloads">
      <View style={shared.gap8}>
        {withFile ? <SettingsRow icon="download" title="Download your latest report" sub={`${withFile.test?.name ?? 'Report'} · ${fmtDate(withFile.releasedAt ?? withFile.collectedAt)} · a link that works for five minutes`}
          onPress={() => { if (!opening) void download(withFile); }} right={opening ? <Icon name="loader-circle" size={16} color={fx.ink.a50} /> : undefined} /> : null}
        <SettingsRow icon="download" title="A copy of your data" sub="Ask for an export of your records, or for deletion" onPress={() => router.push('/settings/data')} />
      </View>
    </Reveal>
  </View>;
}

function MeasureTile({ m, index }: { m: Metric; index: number }) {
  const latest = m.latest! as NonNullable<Metric['latest']> & { day?: string; sourceLabel?: string };
  const values = m.series.map((x) => Number(x.value)).filter((v) => Number.isFinite(v));
  // a daily total (steps, water) keeps growing through the day: today's is not compared with yesterday's
  const daily = !!latest.day;
  const prev = !daily && values.length >= 2 ? values[values.length - 2] : null;
  const decimals = decimalsOf(latest.value);
  // the change keeps the finer of the two entries' decimals (76.5 → 76 is −0.5, never −1)
  const diffDecimals = prev == null ? decimals : Math.max(decimals, decimalsOf(prev));
  const diff = prev == null ? null : Math.round((Number(latest.value) - prev) * 10 ** diffDecimals) / 10 ** diffDecimals;
  const when = daily ? (latest.day === istDate() ? 'Today so far' : fmtDate(`${latest.day}T12:00:00.000Z`)) : fmtDate(latest.at);
  const who = latest.sourceLabel ?? SOURCE[latest.source] ?? 'Recorded';
  const unit = m.unit === '/5' ? '/ 5' : m.unit;
  const value = formatCount(Number(latest.value), decimals);
  return <GlassCard variant="tile" style={styles.fill}>
    <View accessible accessibilityLabel={`${m.label}: ${value} ${m.unit}, ${when}, ${who}${diff != null ? `, ${diff === 0 ? 'no change' : `${diff > 0 ? 'up' : 'down'} ${formatCount(Math.abs(diff), diffDecimals)}`} since the entry before` : ''}`}>
      <T v="caption" color={fx.ink.a55} numberOfLines={2}>{m.label}</T>
      <View style={styles.valueRow}>
        {/* the number shrinks to fit beside its unit rather than lose digits to an ellipsis ('9,0…', SWB-08) */}
        <T v="metric24" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={styles.flexShrink}>{value}</T>
        <T v="caption" color={fx.ink.a50} numberOfLines={1} style={styles.keep}>{unit}</T>
      </View>
      {values.length >= 2 ? <Sparkline values={values.slice(-12)} width={96} height={24} index={index} style={styles.spark} /> : <View style={styles.sparkGap} />}
      {/* the change in neutral ink: without a goal a change is neither good nor bad, so it takes no hue (TC-12) */}
      <T v="caption" color={diff == null || diff === 0 ? fx.ink.a55 : fx.ink.a70} numberOfLines={3}>
        {diff == null ? when : diff === 0 ? `No change · ${when}` : `${diff > 0 ? '+' : '−'}${formatCount(Math.abs(diff), diffDecimals)} vs the entry before`}
      </T>
      {/* who recorded it keeps its word whole in a narrow tile ('Self-report/ed', 'From this p…': SWA-17) */}
      <FitText v="caption" color={fx.ink.a50} numberOfLines={2}>{who}</FitText>
    </View>
  </GlassCard>;
}

function decimalsOf(v: number): number {
  const s = String(v);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : Math.min(2, s.length - dot - 1);
}

const styles = StyleSheet.create({
  fill: { flexGrow: 1 },
  planTitle: { marginTop: 4 },
  planValue: { alignItems: 'flex-end' },
  bar: { marginTop: 16 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 8 },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 6 },
  flexShrink: { flexShrink: 1 },
  keep: { flexShrink: 0 },
  spark: { marginVertical: 8 },
  sparkGap: { height: 12 },
  note: { paddingHorizontal: 4 },
  line: { height: 1, backgroundColor: fx.line.a05 },
  flatRow: { borderWidth: 0, backgroundColor: fx.premium.transparent, paddingHorizontal: 0, borderRadius: 0 },
  link: { alignSelf: 'flex-start', marginTop: 8 },
});
