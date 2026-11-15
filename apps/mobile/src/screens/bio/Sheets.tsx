/* Bio's two sheets, in the earlier app's chrome (shots 43 and 44):
   - MetricBody: the 48 pt icon tile, the name with its source pills, the Bebas 48 value counting up, the line of the
     last values drawing in, and a plain sentence of what the values are (how many, since when, the latest's source,
     up or down since the first: never "improving"); then Log a value and the trend.
   - TrendBody: the chart with dots over the chosen range (7 days, 30 days, 90 days, a year: GET /me/progress/series;
     a change crossfades), its first and last days, Average / Highest / Lowest from those values, the latest values
     with their sources, and the API's note. Without the progress module the sheet shows the summary's last values.
   These render inside the root SheetHost, so they take what they need from the screen as props.
   Motion (motion v2 M62, M67):
   - The value is the latest, at rest from the sheet's first frame (UX-05 / TC-10: it used to count from the previous
     reading, so a stale 63.5 rode up with the sheet and rolled to 63.3); the change since the entry before rises in
     beside it ('−0.4 kg', CountUp's chip: 6 pt, 300 ms expo, a 2.4 s hold, then it fades) as the sheet's rise passes
     90 % (the sheet spring's own timing), once per latest value in this run. A value that changes while the sheet is
     open counts to the new one (600 ms expo). A first value with nothing before it appears with the pop; opening the
     sheet again shows it at rest. Tier C and reduced motion: the final value, no chip.
   - "See the trend": the metric sheet hands over to the tall trend sheet (one scrim kept up, the M48 hand-over) and
     the sheet's 220×56 line travels into the chart's frame and grows to its size (360 ms expo, its points moving, the
     stroke kept), then dissolves as the chart draws its own line. Tier C and reduced motion: the plain hand-over. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedProps, useAnimatedRef, useAnimatedStyle, useFrameCallback, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';
import { measureView } from '@/fx/motion/measured';
import { scheduleOnRN } from 'react-native-worklets';
import Svg, { Path } from 'react-native-svg';
import { Button, CountUp, FONTS, formatCount, fx, Pill, RowDivider, Segmented, Sparkline, T, TrendChart, useMotion } from '@/fx';
import { markSeen, seenValue } from '@/fx/motion/seen';
import { sparkPoints, type SparkPoint } from '@/fx/motion/Sparkline';
import { ease, motionValues, spring, t, timing } from '@/fx/motion/tokens';
import { useLoad } from '@/lib/useLoad';
import { lowerIsBetter } from '../home/data';
import { IconTile, Stat } from './parts';
import {
  changeText, dayOf, decimalsOf, fmtValue, iconOf, loadSeries, RANGES, ringFor, sourceOf, statsOf, unitText, weekdayOf, whenText,
  type Goal, type RangeKey, type SeriesPoint, type SeriesResponse, type SummaryMetric,
} from './data';

const LINE = fx.status.good;
const M62 = motionValues.screens.m62;
const M67 = motionValues.screens.m67;
/** The sheet's sparkline (220 × 56, stroke 2) and the trend chart's inset (src/fx/motion/Chart's PAD). */
const SPARK = { w: 220, h: 56, stroke: 2 };
const CHART_H = 140;
const CHART_PAD = 8;

/** When a spring released at rest at 0 first passes `share` of its way to 1 (ms): a property of the kit's spring,
 *  integrated once at load (1 ms steps), not a tuned delay. */
function reachMs(cfg: { stiffness: number; damping: number; mass: number }, share: number): number {
  let x = 0;
  let v = 0;
  for (let ms = 1; ms <= 4000; ms += 1) {
    v += (cfg.stiffness * (1 - x) - cfg.damping * v) / cfg.mass / 1000;
    x += v / 1000;
    if (x >= share) return ms;
  }
  return 0;
}
/** The metric sheet's rise passes S.m62.startAt (90 %) this long after its panel has laid out. */
const SHEET_AT = reachMs(spring.sheet, M62.startAt);

/** The sheet's value: the latest at rest, with the change since the entry before beside it (see the header). */
function SheetValue({ m, value, unit, towardsLower }: { m: SummaryMetric; value: number; unit: string; towardsLower: boolean }) {
  const { tier, still } = useMotion();
  const key = `bio.sheet.${m.metric}`;
  const n = m.series.length;
  const prev = n >= 2 ? m.series[n - 2].value : null;
  const decimals = decimalsOf(value);
  // with a reading before it, the latest is what the sheet has shown (so CountUp draws it at rest from the first frame
  // and never rolls the previous reading into it); its change shows once per latest value in this run
  const [chip] = useState<{ text: string; better: boolean } | null>(() => {
    if (still || tier === 'C' || prev == null) return null;
    markSeen(`count:${key}`, value);
    if (prev === value || seenValue(`chip:${key}`) === value) return null;
    const change = value - prev;
    // the change keeps the finer of the two readings' decimals (63.5 → 63 is −0.5, never −1)
    const text = `${change > 0 ? '+' : '−'}${formatCount(Math.abs(change), Math.max(decimals, decimalsOf(prev)))}${unit ? ` ${unit}` : ''}`;
    return { text, better: towardsLower ? change < 0 : change > 0 };
  });
  const [go, setGo] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => { if (go && chip) markSeen(`chip:${key}`, value); }, [go]); // eslint-disable-line react-hooks/exhaustive-deps
  // the panel lays out with this content and starts its rise: the chip (or a first value's pop) starts as the rise
  // passes 90 %
  const onLayout = () => { if (!timer.current && !go) timer.current = setTimeout(() => setGo(true), SHEET_AT); };
  if (tier === 'C' && !still) return <T style={styles.sheetValue}>{fmtValue(value)}</T>;
  const number = <CountUp value={value} decimals={decimals} start={go} duration={M62.countMs} seenKey={key} honest style={styles.sheetValue} />;
  return <View onLayout={onLayout}>
    {chip ? <View style={styles.withChip}>{number}<DeltaChip text={chip.text} better={chip.better} go={go} /></View> : number}
  </View>;
}

/** The change beside the sheet's value: CountUp's chip (it sits there from the first frame, only its opacity and rise
 *  move, so nothing reflows): it rises in over motionValues.count.deltaMs (expo), holds deltaHold, then fades; green
 *  when the value moved the better way (towards the goal), else red. Only drawn at tiers A and B without reduced
 *  motion (the caller decides). */
function DeltaChip({ text, better, go }: { text: string; better: boolean; go: boolean }) {
  const c = useSharedValue(0);
  const rise = motionValues.count.deltaRise;
  useEffect(() => {
    if (!go) return;
    const { deltaMs, deltaHold } = motionValues.count;
    c.set(withSequence(withTiming(1, timing(deltaMs, ease.expo)), withDelay(deltaHold, withTiming(0, timing(deltaMs, ease.expo)))));
  }, [go, c]);
  const a = useAnimatedStyle(() => ({ opacity: c.get(), transform: [{ translateY: (1 - c.get()) * rise }] }));
  return <Animated.View pointerEvents="none" style={[styles.chip, a]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Text style={[styles.chipText, { color: better ? fx.status.optimal : fx.red.brand }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>{text}</Text>
  </Animated.View>;
}

/* ---------- the line that travels from the metric sheet into the trend chart ---------- */

type LineFrom = { metric: string; x: number; y: number; values: number[]; at: number };
let lineFrom: LineFrom | null = null;
/** The metric sheet's line as "See the trend" was pressed (window points), taken once by the trend sheet. */
function takeLine(metric: string): LineFrom | null {
  const l = lineFrom;
  lineFrom = null;
  return l && l.metric === metric && Date.now() - l.at < t.premount ? l : null;
}

/** The sheet's line on its way into the chart frame: drawn in the chart's box, it starts where the sheet's line was
 *  (followed every frame while the panels move) and its points spread from 220 × 56 to the frame over 360 ms expo;
 *  once there it dissolves as the chart draws (`handOff`). */
function TravelLine({ from, height, color, handOff, onLanded }: { from: LineFrom; height: number; color: string; handOff: boolean; onLanded: () => void }) {
  const ref = useAnimatedRef<Animated.View>();
  const [w, setW] = useState(0);
  const k = useSharedValue(0);
  const ox = useSharedValue(0);
  const oy = useSharedValue(0);
  const seen = useSharedValue(0); // the first measure has placed it (hidden until then)
  const fade = useSharedValue(1);
  const small = useMemo(() => sparkPoints(from.values, SPARK.w, SPARK.h, SPARK.stroke / 2 + 1), [from.values]);
  const big = useMemo<SparkPoint[]>(() => {
    if (!w) return [];
    const min = Math.min(...from.values);
    const max = Math.max(...from.values);
    const pad = (max - min || Math.abs(max) || 1) * 0.1; // the chart's own domain margin
    return sparkPoints(from.values, w, height, CHART_PAD, { min: min - pad, max: max + pad });
  }, [from.values, w, height]);
  const follow = useFrameCallback(() => {
    'worklet';
    const r = measureView(ref);
    if (!r || r.width === 0) return;
    const e = 1 - k.get();
    ox.set((from.x - r.pageX) * e);
    oy.set((from.y - r.pageY) * e);
    seen.set(1);
  }, false);
  const landed = () => { follow.setActive(false); onLanded(); };
  const onLayout = (e: { nativeEvent: { layout: { width: number } } }) => {
    const lw = Math.round(e.nativeEvent.layout.width);
    if (lw <= 0 || w) return; // never 0 × 0; laid out once
    setW(lw);
    follow.setActive(true);
    k.set(withTiming(1, timing(M67.sparkMs, ease.expo), (f) => { 'worklet'; if (f) scheduleOnRN(landed); }));
  };
  // the chart draws its own line from the left (expo): the travelled line gives way over its first 300 ms
  useEffect(() => { if (handOff) fade.set(withTiming(0, timing(t.base, ease.css))); }, [handOff, fade]);
  const box = useAnimatedStyle(() => ({ opacity: seen.get() * fade.get(), transform: [{ translateX: ox.get() }, { translateY: oy.get() }] }));
  const line = useAnimatedProps(() => {
    const kk = Math.max(0, Math.min(1, k.get()));
    let d = '';
    for (let i = 0; i < big.length; i += 1) {
      const a = small[i];
      const b = big[i];
      d += (i ? 'L' : 'M') + (a.x + (b.x - a.x) * kk).toFixed(2) + ' ' + (a.y + (b.y - a.y) * kk).toFixed(2);
    }
    return { d };
  });
  // the frame is measured on an untransformed layer (the chart's box), the line moves on the one inside it
  return <Animated.View ref={ref} collapsable={false} pointerEvents="none" onLayout={onLayout} style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Animated.View style={[StyleSheet.absoluteFill, box]}>
      {w && big.length ? <Svg width={w} height={height}>
        <AnimatedPath d={big.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')} fill="none" stroke={color} strokeWidth={SPARK.stroke} strokeLinecap="round" strokeLinejoin="round" animatedProps={line} />
      </Svg> : null}
    </Animated.View>
  </Animated.View>;
}
const AnimatedPath = Animated.createAnimatedComponent(Path);

export function MetricBody({ m, goals, canTrend, onLog, onTrend }: { m: SummaryMetric; goals: Goal[] | null; canTrend: boolean; onLog: () => void; onTrend: () => void }) {
  const latest = m.latest;
  const ring = ringFor(m, goals);
  const stats = statsOf(m.series);
  const sources = [...new Set(m.series.map(sourceOf))];
  const unit = unitText(m.unit);
  // a fall is the better move when the goal points down (else as Home reads the metric)
  const g = ring.goal;
  const towardsLower = g && typeof g.targetValue === 'number' && latest ? g.targetValue < (typeof g.baselineValue === 'number' ? g.baselineValue : latest.value) : lowerIsBetter(m.metric);
  // "See the trend": the line is measured where it is, then hands over (it travels into the chart's frame)
  const spark = useRef<React.ComponentRef<typeof View>>(null);
  const [lifted, setLifted] = useState(false);
  const trend = () => {
    const values = m.series.map((p) => p.value);
    const el = spark.current;
    if (!el || values.length < 2) { onTrend(); return; }
    el.measureInWindow((x: number, y: number, w: number, h: number) => {
      if (w && h) { lineFrom = { metric: m.metric, x, y, values, at: Date.now() }; setLifted(true); }
      onTrend();
    });
  };
  return <View style={styles.body}>
    <View style={styles.head}>
      <IconTile icon={iconOf(m.metric)} color={ring.fill != null ? LINE : fx.ink.a80} />
      <View style={styles.flex}>
        <T v="heading" numberOfLines={2}>{m.label}</T>
        <View style={styles.pills}>
          {sources.map((s) => <Pill key={s} color={s === 'From the phone app' || s === 'From a connected device' ? fx.hue.emerald : undefined}>{s}</Pill>)}
          {ring.goal ? <Pill color={ring.reached ? fx.status.optimal : LINE}>{`Goal ${ring.goal.targetValue} ${unit}`}</Pill> : null}
        </View>
      </View>
    </View>
    {latest ? <>
      <View style={styles.valueRow} accessible accessibilityLabel={`${m.label}: ${latest.value} ${unit}, ${sourceOf(latest)}, ${whenText(latest)}`}>
        <SheetValue m={m} value={latest.value} unit={unit} towardsLower={!!towardsLower} />
        <T v="cardTitle" color={fx.ink.a70} style={styles.unit}>{unit}</T>
      </View>
      {m.series.length >= 2 ? <View ref={spark} collapsable={false} style={[styles.center, lifted ? styles.lifted : null]}>
        <Sparkline values={m.series.map((p) => p.value)} width={SPARK.w} height={SPARK.h} strokeWidth={SPARK.stroke} color={LINE}
          accessibilityLabel={`The last ${m.series.length} values, from ${fmtValue(m.series[0].value)} to ${fmtValue(latest.value)} ${unit}`} />
      </View> : null}
      <T v="body" color={fx.ink.a90}>
        {stats && stats.n > 1 ? `${stats.n} values since ${dayOf(stats.first)}. ${changeText(stats, m.unit)}. ` : ''}
        {`The latest, ${fmtValue(latest.value)} ${unit}, is ${sourceOf(latest).toLowerCase()} (${whenText(latest).toLowerCase() === 'today' ? 'today' : dayOf(latest)}).`}
        {ring.goal ? ` Your goal: ${ring.goal.title}${ring.reached ? ', reached.' : '.'}` : ''}
      </T>
    </> : <T v="body" color={fx.ink.a70}>Nothing logged yet.</T>}
    <View style={styles.actions}>
      <Button title="Log a value" icon="plus" shape="flow" commit onPress={onLog} />
      {canTrend ? <Button title="See the trend" variant="ghost" icon="chart-line" onPress={trend} /> : null}
    </View>
  </View>;
}

export function TrendBody({ m, canRange }: { m: SummaryMetric; canRange: boolean }) {
  const { tier, still } = useMotion();
  // the metric sheet's line, when this sheet was opened from it (taken once, at mount)
  const [from] = useState(() => (still || tier === 'C' ? null : takeLine(m.metric)));
  const [landed, setLanded] = useState(!from);
  const [range, setRange] = useState<RangeKey>('30');
  const days = RANGES.find((r) => r.value === range)?.days ?? 30;
  const series = useLoad<SeriesResponse | null>(canRange ? `progress-series-${m.metric}-${days}` : null, () => (canRange ? loadSeries(m.metric, days) : Promise.resolve(null)), [m.metric, days, canRange]);
  const points: SeriesPoint[] = canRange ? series.data?.points ?? [] : m.series;
  const stats = statsOf(points);
  const unit = unitText(m.unit);
  const weekly = days <= 7 && points.length <= 7;
  return <View style={styles.body}>
    <View style={styles.trendHead}>
      <T v="heading" style={styles.flex} numberOfLines={2}>{`${m.label} trend`}</T>
      {stats && stats.n > 1 ? <Pill>{stats.change === 0 ? 'Level' : `${stats.change > 0 ? 'Up' : 'Down'} ${fmtValue(Math.abs(stats.change))} ${unit}`}</Pill> : null}
    </View>
    {canRange ? <Segmented items={RANGES.map((r) => ({ value: r.value, label: r.label, a11y: `Last ${r.days === 365 ? 'year' : `${r.days} days`}` }))} value={range} onChange={setRange} /> : <T v="caption" color={fx.ink.a50}>{`The last ${points.length} values`}</T>}
    {series.error && canRange ? <T v="bodySm" color={fx.red.error}>{series.error.message}</T> : null}
    {/* the chart's frame: the travelling line lands in it (also while the range's values are on their way) */}
    {points.length || (from && series.loading && canRange) ? <View style={styles.chartBox}>
      {points.length ? <TrendChart values={points.map((p) => p.value)} height={CHART_H} color={LINE} grid={4} start={landed}
        accessibilityLabel={`${m.label}: ${points.length} values from ${fmtValue(points[0].value)} to ${fmtValue(points[points.length - 1].value)} ${unit}`} /> : null}
      {from ? <TravelLine from={from} height={CHART_H} color={LINE} handOff={landed && points.length > 0} onLanded={() => setLanded(true)} /> : null}
    </View> : null}
    {points.length ? <>
      <View style={styles.axis}>
        {weekly ? points.map((p, i) => <T key={i} v="mono10" color={fx.ink.a50}>{weekdayOf(p)}</T>)
          : <><T v="mono10" color={fx.ink.a50}>{dayOf(points[0])}</T><T v="mono10" color={fx.ink.a50}>{dayOf(points[points.length - 1])}</T></>}
      </View>
      {stats ? <View style={styles.stats}>
        <Stat tile value={fmtValue(stats.average)} label="Average" />
        <Stat tile value={fmtValue(stats.highest)} label="Highest" />
        <Stat tile value={fmtValue(stats.lowest)} label="Lowest" />
      </View> : null}
      <View>
        <T v="label" style={styles.listHead}>{`Latest values (${unit})`}</T>
        {points.slice(-6).reverse().map((p, i) => <View key={`${p.at}-${i}`}>
          {i ? <RowDivider /> : null}
          <View style={styles.point}>
            <T v="mono14">{`${fmtValue(p.value)} ${unit}`}</T>
            <T v="caption" color={fx.ink.a60} style={styles.pointMeta} numberOfLines={1}>{`${sourceOf(p)} · ${dayOf(p)}`}</T>
          </View>
        </View>)}
      </View>
    </> : series.loading && canRange ? (from ? null : <View style={styles.placeholder} />) : <T v="body" color={fx.ink.a60}>No values in this range. Choose a longer range, or log a value.</T>}
    {series.data?.truncated ? <T v="caption" color={fx.ink.a50}>Only the first 2,000 values in this range are shown.</T> : null}
    {series.data?.note ? <T v="caption" color={fx.ink.a50}>{series.data.note}</T> : null}
  </View>;
}

const styles = StyleSheet.create({
  body: { gap: 18 },
  head: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  flex: { flex: 1, minWidth: 0 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 6, marginTop: 4 },
  sheetValue: { fontFamily: FONTS.display, fontSize: 48, lineHeight: 52, color: fx.ink.white },
  // the value and its change chip side by side (as CountUp lays them out)
  withChip: { flexDirection: 'row', alignItems: 'center' },
  chip: { marginLeft: 6 },
  chipText: { fontFamily: FONTS.mono500, fontSize: 11, lineHeight: 14 },
  unit: { fontSize: 16 },
  center: { alignSelf: 'center' },
  // the line has left for the trend sheet
  lifted: { opacity: 0 },
  actions: { gap: 10 },
  trendHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -8 },
  stats: { flexDirection: 'row', gap: 10 },
  listHead: { marginBottom: 4 },
  point: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingVertical: 10 },
  pointMeta: { flexShrink: 1, textAlign: 'right' },
  placeholder: { height: CHART_H },
  chartBox: { minHeight: CHART_H },
});
