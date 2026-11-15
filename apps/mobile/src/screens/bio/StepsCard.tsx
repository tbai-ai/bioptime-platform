/* Bio's device card: the earlier app's wearable card (radius 24, 145° #141414 → #111111, white/8 border, the status
   line with its dot, the Bebas title and the three-state body) for the one device Bioptime really reads: this phone's
   step count (src/fx/device/steps). No watch, sleep stage or heart-rate data is shown, because none is connected.
   - Counting (iOS, Android): the live count (never below what the server already has for today), the mini ring to the
     member's steps goal when one exists, an approximate distance, "Send now" (PUT /me/progress/daily) and stop.
   - Off: what turning it on does and the button; denied: how to allow it; web: it works in the app on a phone.
   - In every state, when the phone has sent steps before: the Activity rings for today only (today's steps against the
     member's steps goal and the distance, "—" until a step is counted or sent today: never an earlier day's total as
     today's, lib/today), and the last 7 days the phone sent as the earlier app's 24-hour chart chrome, with average and
     best computed from those days. The chart says "last N days" only when its days run to today without a gap; else it
     names its real dates ("1 Nov – 7 Nov"). Its big number is today's total, or the last day's with that day named.
   Motion (motion v2 M64): the ring, the count and the line start from the card's own entrance (the kit's data rule),
   the count never from zero (a first showing appears with the pop; a change counts from the value shown last), and a
   revisit shows them at rest (seen key bio.steps). */
import React, { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { AreaSpark, Button, CountUp, FONTS, fx, haptics, Icon, IconButton, LiveDot, MiniRing, Pill, Scrim, syncSteps, T, toast, type StepCounter } from '@/fx';
import { istDate } from '@/lib/format';
import { todaySteps } from '@/lib/today';
import { dayOf, fmtValue, goalProgress, isToday, istDayOf, PHONE_APP, phoneLabel, weekdayOf, type Goal, type SeriesPoint, type SummaryMetric } from './data';

const FOOTER = Platform.OS === 'ios' ? 'From this iPhone’s motion data.' : Platform.OS === 'android' ? 'Counted on this phone while Bioptime is open.' : 'Counted by the Bioptime app on your phone. A browser cannot count steps.';

/** `counter`: this phone's step counter (Bio keeps one for the page: its goals count the same steps). */
export function StepsCard({ counter, steps, goal, onSynced }: { counter: StepCounter; steps: SummaryMetric | null; goal: Goal | null; onSynced: () => void }) {
  const [busy, setBusy] = useState(false);
  const series = (steps?.series ?? []).filter((p) => p.source === 'device' || !!p.day);
  const serverToday = steps?.latest && isToday(steps.latest) ? steps.latest.value : null;
  const today = todaySteps(counter.steps, serverToday); // the counter's steps are always today's (src/fx/device/steps)
  const shown = today ?? steps?.latest?.value ?? null;
  const shownLabel = today != null ? (counter.steps != null ? 'Today, on this phone' : `Today · ${phoneLabel(steps?.latest?.sourceLabel ?? PHONE_APP)}`) : steps?.latest ? `${dayOf(steps.latest)} · ${phoneLabel(steps.latest.sourceLabel ?? PHONE_APP)}` : null;
  const week = series.slice(-7);
  const counting = counter.status === 'counting';
  // the rings are today's: today's total against the goal, or "—" when none is counted or sent yet today
  const ring = goal && today != null ? goalProgress(goal, today) : null;

  const send = async () => {
    if (counter.steps == null) return;
    setBusy(true);
    await syncSteps(istDate(0), counter.steps); // only this phone's own count goes out as the phone's
    setBusy(false); haptics.success(); toast.logged('Steps sent'); onSynced();
  };

  return <View style={styles.card}>
    <Scrim kind="solidCard" style={[StyleSheet.absoluteFill, styles.round]} />
    <View style={styles.status}>
      {counting ? <LiveDot color={fx.hue.green500} size={6} /> : <View style={[styles.dot, { backgroundColor: fx.ink.a30 }]} />}
      <T v="micro" color={counting ? fx.hue.green500 : fx.ink.a50} style={styles.statusText}>{counting ? 'Counting on this phone' : 'Step counting'}</T>
    </View>

    <View style={styles.titleRow}>
      <View style={[styles.iconTile, counting ? styles.iconOn : null]}><Icon name="footprints" size={18} color={counting ? fx.hue.green400 : fx.red.brand} /></View>
      <View style={styles.flex}>
        <T v="small20">Count my steps</T>
        <T v="bodySm" color={fx.ink.a60}>{subtitle(counter)}</T>
      </View>
      {counting ? <IconButton icon="x" label="Stop counting steps on this phone" size={36} iconSize={16} onPress={() => { haptics.light(); void counter.disable(); }} /> : null}
    </View>

    {counter.status === 'off' || counter.status === 'denied' ? <View style={styles.action}>
      <Button title={counter.status === 'denied' ? 'Try again' : 'Count my steps'} icon="footprints" variant="redTint" small commit
        onPress={async () => { const ok = await counter.enable(); if (ok) { haptics.success(); toast.logged('Counting steps on this phone'); } }} />
    </View> : null}

    {shown != null ? <View style={styles.activity}>
      <T v="label" color={fx.ink.a50} style={styles.activityLabel}>Activity today</T>
      <View style={styles.rings}>
        <View style={styles.ringCol}>
          <MiniRing value={ring} max={1} color={fx.red.brand} seenKey="bio.steps" accessibilityLabel={`Steps today: ${today != null ? fmtValue(today) : 'none yet'}${goal ? ` of ${fmtValue(goal.targetValue as number)}` : ', no goal'}`}>
            <Icon name="footprints" size={13} color={fx.red.brand} />
            <T v="mono12" style={styles.ringValue}>{today != null ? compact(today) : '—'}</T>
          </MiniRing>
          <T v="micro" color={fx.ink.a70} style={styles.ringName}>Steps</T>
          <T v="mono10" color={fx.ink.ink2} center>{goal ? `/ ${compact(goal.targetValue as number)} goal` : 'No goal'}</T>
        </View>
        <View style={styles.ringCol}>
          <View style={styles.kmRing}>
            <Icon name="map-pin" size={13} color={fx.hue.orange400} />
            <T v="mono12" style={styles.ringValue}>{today != null ? `≈${(Math.round((today * 0.75) / 100) / 10).toFixed(1)}` : '—'}</T>
          </View>
          <T v="micro" color={fx.ink.a70} style={styles.ringName}>Distance</T>
          <T v="mono10" color={fx.ink.ink2} center>km, approximate</T>
        </View>
      </View>

      {week.length >= 2 ? <View style={styles.chart}>
        <View style={styles.chartHead}>
          <View style={styles.flexShrink}>
            <T v="micro" color={fx.ink.a50} style={styles.chartTitle}>{weekTitle(week)}</T>
            <View style={styles.big}>
              <CountUp value={shown} honest seenKey="bio.steps" style={styles.bigValue} />
              <T v="body" color={fx.ink.a60}>steps</T>
            </View>
            {shownLabel ? <T v="caption" color={fx.ink.a50}>{shownLabel}</T> : null}
          </View>
          <View style={styles.side}>
            <T v="caption" color={fx.ink.a50}>Average <T v="mono12" color={fx.hue.emerald}>{fmtValue(Math.round(week.reduce((a, p) => a + p.value, 0) / week.length))}</T></T>
            <T v="caption" color={fx.ink.a50}>Best <T v="mono12" color={fx.red.label}>{fmtValue(Math.max(...week.map((p) => p.value)))}</T></T>
          </View>
        </View>
        <ChartBox values={week.map((p) => p.value)} labels={week.map(weekdayOf)} />
      </View> : null}
    </View> : counter.status !== 'off' && counter.status !== 'denied' ? <T v="bodySm" color={fx.ink.a50} style={styles.empty}>No steps from a phone yet.</T> : null}

    <View style={styles.footer}>
      {counting && counter.steps != null ? <Button title="Send now" icon="refresh-cw" variant="redTint" small busy={busy} onPress={send} /> : null}
      <T v="caption" color={fx.ink.a55} center style={styles.flexText}>{FOOTER}</T>
    </View>
  </View>;
}

function subtitle(c: StepCounter): string {
  switch (c.status) {
    case 'counting': return c.history ? 'Today’s steps from this iPhone, sent to Bioptime' : 'Counted while Bioptime is open, sent to Bioptime';
    case 'starting': return 'Starting the step counter…';
    case 'denied': return 'Motion access is off for Bioptime. Allow it in the phone’s settings.';
    case 'off': return 'Turn it on to send this phone’s step count to Bioptime';
    case 'unavailable': return Platform.OS === 'web' ? 'Steps this phone sent to Bioptime' : 'This phone has no step counter.';
    default: return 'Steps this phone sent to Bioptime';
  }
}

/** "Steps · last 7 days" when the days run to today without a gap; else the real dates ("Steps · 1 Nov – 7 Nov"). */
function weekTitle(week: SeriesPoint[]): string {
  const days = week.map((p) => p.day ?? istDayOf(p.at));
  const step = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
  const toToday = days[days.length - 1] === istDate(0) && days.every((d, i) => i === 0 || step(days[i - 1], d) === 1);
  return toToday ? `Steps · last ${week.length} days` : `Steps · ${dayOf(week[0])} – ${dayOf(week[week.length - 1])}`;
}

/** 7999 → "8.0k", 950 → "950". */
function compact(n: number): string { return n >= 1000 ? `${(Math.round(n / 100) / 10).toFixed(1)}k` : String(Math.round(n)); }

function ChartBox({ values, labels }: { values: number[]; labels: string[] }) {
  const [w, setW] = useState(0);
  return <View onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))}>
    {w > 0 ? <AreaSpark values={values} width={w} height={56} accessibilityLabel={`Steps on the last ${values.length} days: ${values.map(fmtValue).join(', ')}`} /> : <View style={{ height: 56 }} />}
    <View style={styles.axis}>{labels.map((l, i) => <T key={i} v="mono10" color={fx.ink.a60} maxFontSizeMultiplier={1.2} numberOfLines={1}>{l}</T>)}</View>
  </View>;
}

const styles = StyleSheet.create({
  card: { borderRadius: fx.radius.three, borderWidth: 1, borderColor: fx.line.a08, padding: 20, gap: 16, overflow: 'hidden', boxShadow: fx.shadow.card },
  round: { borderRadius: fx.radius.three },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusText: { letterSpacing: 9 * 0.25 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconTile: { width: 40, height: 40, borderRadius: fx.radius.xl, alignItems: 'center', justifyContent: 'center', backgroundColor: fx.red.a10, borderWidth: 1, borderColor: fx.red.a20 },
  iconOn: { backgroundColor: fx.tone.greenBg, borderColor: fx.tone.greenLine },
  flex: { flex: 1, minWidth: 0 },
  flexText: { flex: 1 },
  action: { flexDirection: 'row' },
  activity: { gap: 14, borderTopWidth: 1, borderTopColor: fx.line.a05, paddingTop: 16 },
  activityLabel: { letterSpacing: 2 },
  rings: { flexDirection: 'row', justifyContent: 'space-around' },
  // two equal halves: each ring sits where space-around put it, and a caption grown by a large text size stays in its half
  ringCol: { flex: 1, minWidth: 0, alignItems: 'center', gap: 2 },
  ringValue: { fontFamily: FONTS.mono700, marginTop: 2 },
  ringName: { marginTop: 8 },
  kmRing: { width: 84, height: 84, borderRadius: 42, borderWidth: 8, borderColor: fx.premium.ringTrackSoft, alignItems: 'center', justifyContent: 'center' },
  chart: { borderRadius: fx.radius.card, borderWidth: 1, borderColor: fx.line.a08, backgroundColor: fx.fill.a03, padding: 16, gap: 10 },
  // at a large text size Average and Best move under the big number instead of running off the card (flexWrap)
  chartHead: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', columnGap: 8, rowGap: 6 },
  flexShrink: { flexShrink: 1, minWidth: 0 },
  chartTitle: { letterSpacing: 9 * 0.2 },
  big: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 4 },
  bigValue: { fontFamily: FONTS.display, fontSize: 32, lineHeight: 36, color: fx.ink.white },
  side: { alignItems: 'flex-end', gap: 2, marginLeft: 'auto' },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  empty: { marginTop: -4 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
