/* Life's report pieces (the earlier app's Longevity tab, shots 47-50 and 77):
   - ReportHero: the biological-age hero card made honest: the latest released report's markers inside their laboratory
     range as a Bebas 72 number ("8/10") with the "In range" pill, the test, the collection date and the reviewer,
     then three mono stats (flagged, reports so far, days since collection). Tilt 6 with the red orb. A tap opens
     every marker. The in-range number counts once, when its card has landed (900 ms expo, motion v2 M62): it shows 0
     (or the value seen last) until then; a revisit, tier C and reduced motion show the final value.
   - MarkerGrid: the 2-column cards: a ring for where the value sits within its laboratory range (clamped), the name,
     the value and units as reported, and the status word. A tap opens the marker sheet. The name shrinks just enough
     for its longest word to fit the card whole on a narrow phone at a large text size ("cholesterol", A1W-m2).
   - MarkerBody (sheet, shot 50): the 48 pt tile, the name, the Bebas 48 value, the status pill, the range bar with the
     laboratory range, the trend across reports, the review note, provenance and "Open the report".
   - AllMarkersBody (tall sheet, shot 77): the report's markers by panel, each with its range bar and status.
   "Simulated result" stays on every simulated report, word for word. A marker's value and a panel's pill sit beside
   their name while its longest word fits whole beside them, else under it (measured: Beside, SWA-07); a range's unit
   moves to the next line whole (SWA-09), and the sheet's range wraps beside the collection date (SWA-11). */
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useAnimatedReaction, useAnimatedRef, useSharedValue, withTiming } from 'react-native-reanimated';
import { Button, CountUp, FONTS, fx, GlassCard, Icon, MetricRing, Pill, RadialGlow, RangeBar, Reveal, RowDivider, Scrim, T, TiltCard } from '@/fx';
import { useRevealLanding } from '@/fx/motion/Reveal';
import { seenValue } from '@/fx/motion/seen';
import { ease, motionValues, timing } from '@/fx/motion/tokens';
import { useMotion } from '@/fx/motion/tier';
import { Deferred } from '@/fx/nav/Deferred';
import { usePageActive } from '@/fx/nav/pageReady';
import { MarkerTrendView } from '@/lib/modules/labFollowupsViews';
import { IconTile, Stat } from '../bio/parts';
import { rangeWithUnit } from '@/lib/format';
import { Beside, FitText } from '../bio/wordFit';
import { HugText } from '@/fx/wordFit';
import {
  barPosition, countInRange, daysSince, markerIcon, panelsOf, rangeText, ringPosition, shortDate, spoken, STATUS_WORD, statusColor, statusOf,
  type Report, type ReportValue,
} from './data';
import { useSheetSettled } from './sheetSettled';

const IN_RANGE = 'life.inRange';

/** The in-range number: one count, on its own clock, from the frame its card has landed (the nearest landing: the
 *  page's FirstCard), on an active page. */
function InRangeCount({ value }: { value: number }) {
  const { tier, still } = useMotion();
  const landing = useRevealLanding();
  const active = usePageActive();
  const [prior] = useState(() => seenValue(`count:${IN_RANGE}`));
  const [rest] = useState(() => still || tier === 'C' || prior === value);
  const clock = useSharedValue(rest ? 1 : 0);
  const begun = useSharedValue(rest ? 1 : 0);
  const landed = landing?.landed;
  useAnimatedReaction(() => (begun.get() === 0 && active.get() === 1 && (!landed || landed.get() === 1) ? 1 : 0), (go) => {
    if (go !== 1 || begun.get() === 1) return;
    begun.set(1);
    clock.set(withTiming(1, timing(motionValues.screens.m62.lifeMs, ease.expo)));
  });
  // tier C and reduced motion: the final value from the first frame
  if (rest && prior !== value) return <T v="hero72" style={styles.big}>{String(value)}</T>;
  return <CountUp value={value} progress={clock} seenKey={IN_RANGE} style={styles.big} />;
}

export function ReportHero({ report, count, onOpen }: { report: Report; count: number; onOpen: () => void }) {
  const c = countInRange(report);
  const allIn = c.total > 0 && c.flagged === 0;
  const pending = report.valuesStatus !== 'ready' || !c.total;
  // after the collection date, in the same words as Profile ("… · reviewed by Asha Menon")
  const reviewer = report.reviewed && report.reviewerName ? `reviewed by ${report.reviewerName}` : report.reviewerKind === 'team' ? 'awaiting the Bioptime team’s review' : 'awaiting your coach’s review';
  return <TiltCard intensity={6} hero radius={fx.radius.hero}>
    <GlassCard variant="hero" clip padding={0} onPress={onOpen} label={pending ? `${report.test?.name ?? 'Report'}: values pending` : `Latest report: ${c.inRange} of ${c.total} markers in the laboratory range. ${report.test?.name ?? ''}, collected ${shortDate(report.collectedAt)}`} hint="Opens every marker">
      <Scrim kind="longevityHero" style={StyleSheet.absoluteFill} />
      <RadialGlow opacity={0.3} style={styles.orb} />
      <View style={styles.heroBody}>
        <View style={styles.eyebrow}>
          <Icon name="flask-conical" size={14} color={fx.red.label} />
          <T v="overline" color={fx.red.label} style={styles.eyebrowText}>Latest report</T>
        </View>
        {report.simulated ? <Pill tone="sample">Simulated result</Pill> : null}
        {pending ? <T v="display36" center>{report.valuesStatus === 'pending' ? 'Values pending' : 'See the laboratory PDF'}</T> : <View style={styles.countRow}>
          <View style={styles.count} accessible accessibilityLabel={`${c.inRange} of ${c.total} in range`}>
            <InRangeCount value={c.inRange} />
            <T v="hero72" color={fx.ink.a40}>/</T>
            <T v="hero72">{String(c.total)}</T>
          </View>
          <View style={styles.badge}><Pill color={allIn ? fx.map.marker.in_range : undefined} icon={allIn ? 'check' : undefined}>In range</Pill></View>
        </View>}
        <T v="body" center style={styles.sub}>{report.test?.name ?? 'Report'}</T>
        <T v="caption" color={fx.ink.a60} center>{`Collected ${shortDate(report.collectedAt)} · ${reviewer}`}</T>
        <View style={styles.divider} />
        <View style={styles.stats}>
          <Stat value={String(c.flagged)} label="Flagged" color={c.flagged ? fx.map.marker.borderline : fx.ink.white} />
          <View style={styles.vr} />
          <Stat value={String(count)} label={count === 1 ? 'Report so far' : 'Reports so far'} />
          <View style={styles.vr} />
          <Stat value={String(daysSince(report.collectedAt))} label="Days since collection" />
        </View>
      </View>
    </GlassCard>
  </TiltCard>;
}

export function MarkerGrid({ values, onOpen }: { values: ReportValue[]; onOpen: (v: ReportValue) => void }) {
  const rows: ReportValue[][] = [];
  for (let i = 0; i < values.length; i += 2) rows.push(values.slice(i, i + 2));
  return <View style={styles.grid}>
    {rows.map((row, r) => <View key={row[0].marker_key ?? row[0].label} style={styles.gridRow}>
      {row.map((v, c) => <Reveal key={v.marker_key ?? v.label} index={r * 2 + c} id={`life.marker.${v.marker_key}`} style={styles.cell}>
        <MarkerTile v={v} index={r * 2 + c} onPress={() => onOpen(v)} />
      </Reveal>)}
      {row.length === 1 ? <View style={styles.cell} /> : null}
    </View>)}
  </View>;
}

function MarkerTile({ v, index, onPress }: { v: ReportValue; index: number; onPress: () => void }) {
  const s = statusOf(v);
  const color = statusColor(s);
  return <GlassCard variant="three" padding={16} onPress={onPress} label={spoken(v)} hint="Opens the marker" style={styles.tile}>
    <View style={styles.tileTop}>
      <MetricRing value={ringPosition(v)} max={1} size={52} index={index} color={color} seenKey={`life.marker.${v.marker_key ?? v.label}`} accessibilityLabel={`${v.label}: ${STATUS_WORD[s].toLowerCase()}`}>
        <Icon name={markerIcon(v.marker_key)} size={16} color={color} />
      </MetricRing>
      <Icon name="chevron-right" size={16} color={fx.ink.a40} />
    </View>
    {/* a short word keeps the word beside it on its line ('Vitamin / D / (25-OH)' in a 320 dp tile at text 2.0: VA-5) */}
    <FitText v="section" numberOfLines={3} pairs style={styles.tileName}>{v.label}</FitText>
    <View style={styles.valueRow}>
      <T v="metric24" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={styles.shrink}>{v.value}</T>
      {v.units ? <T v="mono11" color={fx.ink.a60} style={styles.units} numberOfLines={1}>{v.units}</T> : null}
    </View>
    <HugText v="micro" color={color}>{STATUS_WORD[s]}</HugText>
  </GlassCard>;
}

/** `onReport` closes the sheet and opens the report (a sheet left open would stay above the report screen). */
export function MarkerBody({ v, report, onReport }: { v: ReportValue; report: Report; onReport: () => void }) {
  const s = statusOf(v);
  const color = statusColor(s);
  return <View style={styles.sheet}>
    <View style={styles.sheetHead}>
      <IconTile icon={markerIcon(v.marker_key)} color={color} />
      <T v="heading" style={styles.flex} numberOfLines={2}>{v.label}</T>
    </View>
    <View style={styles.sheetValue} accessible accessibilityLabel={spoken(v)}>
      <T v="sheet48">{v.value}</T>
      {v.units ? <T v="cardTitle" color={fx.ink.a70}>{v.units}</T> : null}
    </View>
    <View style={styles.pills}>
      <Pill color={color}>{STATUS_WORD[s]}</Pill>
      {report.simulated ? <Pill tone="sample">Simulated result</Pill> : null}
    </View>
    <View style={styles.range}>
      <RangeBar position={barPosition(v)} color={color} accessibilityLabel={`${v.label} within ${rangeText(v)}`} />
      <View style={styles.rowBetween}>
        <T v="caption" color={fx.ink.a60} style={styles.flex}>{`Laboratory range ${rangeWithUnit(rangeText(v), v.units)}`}</T>
        <T v="caption" color={fx.ink.a50} style={styles.keep}>{shortDate(report.collectedAt)}</T>
      </View>
    </View>
    {v.marker_key ? <View style={styles.block}>
      <T v="label">Across your reports</T>
      <MarkerTrendView markerKey={v.marker_key} name={v.label} height={120} />
    </View> : null}
    <View style={styles.block}>
      <T v="label">{report.reviewerKind === 'team' ? 'Review notes from the Bioptime team' : 'Your coach’s notes'}</T>
      {report.coachNote ? <>
        <T v="body">{report.coachNote}</T>
        <T v="caption" color={fx.ink.a50}>{`${report.reviewerName ?? ''} · ${report.reviewedAt ? shortDate(report.reviewedAt) : ''}`}</T>
      </> : <T v="body" color={fx.ink.a60}>{report.reviewerKind === 'team' ? 'Awaiting the Bioptime team’s review.' : 'Awaiting your coach’s review.'}</T>}
    </View>
    {report.provenance ? <T v="caption" color={fx.ink.a50}>{report.provenance}</T> : null}
    <Button title="Open the report" icon="file-text" shape="flow" onPress={onReport} />
  </View>;
}

/** One panel of markers (a GlassCard: its title, flags, and each marker with its range bar and status). `onGeom`: the
 *  panel's height and its last row's height (its divider included), for the reserve of the panels that come later. */
function MarkerPanel({ panel, onGeom }: { panel: { title: string; items: ReportValue[] }; onGeom?: (g: { panel?: number; row?: number }) => void }) {
  const flags = panel.items.filter((v) => v.flag).length;
  const last = panel.items.length - 1;
  const card = <GlassCard variant="three" padding={18} borderColor={fx.line.a20} style={styles.panel}>
    <Beside words={[{ text: panel.title, v: 'cardTitle' }]} gap={10} grow={false} underGap={6} style={styles.panelHead}
      side={flags ? <Pill color={fx.map.marker.borderline} icon="triangle-alert">{flags === 1 ? '1 flag' : `${flags} flags`}</Pill> : <Pill color={fx.map.marker.in_range} icon="circle-check">All clear</Pill>}>
      <T v="cardTitle">{panel.title}</T>
    </Beside>
    {panel.items.map((v, i) => {
      const s = statusOf(v);
      return <View key={`${v.marker_key ?? v.label}-${i}`} accessible accessibilityLabel={spoken(v)}
        onLayout={onGeom && i === last ? (e) => { const h = e.nativeEvent.layout.height; if (h > 0) onGeom({ row: h }); } : undefined}>
        {i ? <RowDivider /> : null}
        <View style={styles.markerRow}>
          <Beside words={[{ text: v.label, v: 'section' }]} underGap={2} side={<T v="mono14">{v.value} <T v="mono11" color={fx.ink.a50}>{v.units ?? ''}</T></T>}>
            <T v="section" numberOfLines={2}>{v.label}</T>
          </Beside>
          <RangeBar position={barPosition(v)} color={statusColor(s)} delay={i * 60} />
          <View style={styles.rowBetween}>
            <T v="caption" color={fx.ink.a50} style={styles.shrink}>{`Ref ${rangeWithUnit(rangeText(v), v.units)}`}</T>
            <HugText v="micro" color={statusColor(s)}>{STATUS_WORD[s]}</HugText>
          </View>
        </View>
      </View>;
    })}
  </GlassCard>;
  return onGeom ? <View onLayout={(e) => { const h = e.nativeEvent.layout.height; if (h > 0) onGeom({ panel: h }); }}>{card}</View> : card;
}

/** The measured height of the panels after the first, per report (a later opening reserves exactly that). */
const restHeights = new Map<string, number>();
/** The sheet body's gap between its blocks (and between the later marker groups). */
const SHEET_GAP = 18;

/** The tall "My blood work" sheet (wave-2 fix): the summary and the first marker group render as the sheet opens; the
 *  other groups mount once the panel has come to rest after its rise (useSheetSettled), then once the device is idle
 *  (Deferred), and fade in. Until then their height is reserved (measured on an earlier opening, else estimated from the
 *  first group: its height plus a row for every extra marker), so nothing below moves and the panel's height is right
 *  from the first frame of the rise. Reduced motion: everything at once. */
export function AllMarkersBody({ report, onReport }: { report: Report; onReport: () => void }) {
  const values = report.values ?? [];
  const c = countInRange(report);
  const panels = useMemo(() => panelsOf(values), [values]);
  const first = panels[0] ?? null;
  const rest = panels.slice(1);
  const key = `life.allMarkers.${report.id}`;
  const top = useAnimatedRef<View>();
  const settled = useSheetSettled(top);
  const { height: winH } = useWindowDimensions();
  const [geom, setGeom] = useState<{ panel?: number; row?: number }>({});
  const onGeom = useCallback((g: { panel?: number; row?: number }) => setGeom((was) => ({ ...was, ...g })), []);
  // the reserve: measured on an earlier opening; else the first group's height plus a row per extra marker for each
  // later group; before the first group is measured, a screen's height (the panel stays at its full height meanwhile)
  const estimate = first && geom.panel && geom.row
    ? rest.reduce((h, p) => h + geom.panel! + (p.items.length - first.items.length) * geom.row!, 0) + SHEET_GAP * Math.max(0, rest.length - 1)
    : winH;
  const reserve = restHeights.get(key) ?? estimate;
  return <View style={styles.sheet}>
    <View ref={top} collapsable={false} style={styles.summary}>
      <View style={styles.flex}>
        <T v="cardTitle" numberOfLines={2}>{report.test?.name ?? 'Report'}</T>
        <T v="caption" color={fx.ink.a60}>{`${shortDate(report.collectedAt)} · ${report.reference}`}</T>
        {report.simulated ? <View style={styles.pills}><Pill tone="sample">Simulated result</Pill></View> : null}
      </View>
      <View style={styles.flags}>
        <T v="display36" color={c.flagged ? fx.map.marker.borderline : fx.map.marker.in_range}>{String(c.flagged)}</T>
        <T v="micro" color={fx.ink.a50}>{c.flagged === 1 ? 'Flag' : 'Flags'}</T>
      </View>
    </View>
    {first ? <MarkerPanel panel={first} onGeom={restHeights.has(key) ? undefined : onGeom} /> : <T v="body" color={fx.ink.a60}>{report.valuesStatus === 'pending' ? 'Marker values have not arrived from the laboratory yet; the document is the record until they do.' : 'No values. The laboratory document is the record.'}</T>}
    {rest.length ? <View onLayout={settled ? (e) => { const h = e.nativeEvent.layout.height; if (h > 0) restHeights.set(key, h); } : undefined}>
      {settled ? <Deferred id={key} placeholderHeight={reserve} style={styles.sheet}>
        {rest.map((p) => <Reveal key={p.title} from="fade"><MarkerPanel panel={p} /></Reveal>)}
      </Deferred> : <View style={{ height: reserve }} />}
    </View> : null}
    {report.provenance ? <T v="caption" color={fx.ink.a50}>{report.provenance}</T> : null}
    <Button title="Open the report" icon="file-text" shape="flow" onPress={onReport} />
  </View>;
}

const styles = StyleSheet.create({
  heroBody: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 24, alignItems: 'center', gap: 10 },
  orb: { position: 'absolute', right: -96, top: -96, width: 260, height: 260 },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eyebrowText: { fontSize: 12, letterSpacing: 12 * 0.25 },
  countRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center' },
  count: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  big: { fontFamily: FONTS.display, fontSize: 72, lineHeight: 76, color: fx.ink.white },
  badge: { marginLeft: 6, marginTop: 6 },
  sub: { marginTop: 4 },
  divider: { alignSelf: 'stretch', height: 1, backgroundColor: fx.line.a08, marginVertical: 8 },
  stats: { flexDirection: 'row', alignItems: 'flex-start', alignSelf: 'stretch' },
  vr: { width: 1, height: 36, marginTop: 4, backgroundColor: fx.line.a08 },
  grid: { gap: 12 },
  gridRow: { flexDirection: 'row', gap: 12 },
  cell: { flex: 1, minWidth: 0 },
  tile: { gap: 8, minHeight: 176 },
  tileTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  tileName: { marginTop: 4 },
  // the unit moves whole under the value when both do not fit one line ('112 mg/…' at 320 and 360 dp, text 2.0: VPOL2-4)
  valueRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 6, rowGap: 2 },
  units: { flexShrink: 0, maxWidth: '100%' },
  shrink: { flexShrink: 1 },
  flex: { flex: 1, minWidth: 0 },
  sheet: { gap: SHEET_GAP },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  sheetValue: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  range: { gap: 8 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  block: { gap: 8 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 18, borderRadius: fx.radius.three, borderWidth: 1, borderColor: fx.line.a20 },
  flags: { alignItems: 'center' },
  panel: { gap: 4 },
  panelHead: { marginBottom: 6 },
  keep: { flexShrink: 0 },
  markerRow: { gap: 8, paddingVertical: 12 },
});
