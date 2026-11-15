/* Bio's metric grid (the earlier app's 2-column biomarker cards, shot 42-bio-s1): an 80 pt ring with the value inside,
   the icon and name, the value with its unit and the last move's arrow. The ring sweeps in 1000 ms to the progress
   towards the member's goal for that metric, or along the 1–5 and 0–100 % scales; a metric without a goal keeps an
   empty ring and says "No goal". A metric with no value yet is a "Log" tile that opens the Log a value sheet on it.
   Real values only; nothing is estimated.
   Motion (motion v2 M64): each tile is revealed as it crosses the line, and its ring sweeps from that tile's own
   entrance (the kit's data rule: 120 ms after it starts, 60 ms more per grid place, at most 4), never before. A value
   seen for the first time is never counted up from zero (it appears with the pop); a later change counts from the
   value shown last; a revisit shows the ring and the value at rest (seen keys bio.metric.*). */
import { router } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CountUp, FONTS, fx, GlassCard, Icon, MetricRing, Reveal, T } from '@/fx';
import { FitText } from './wordFit';
import { decimalsOf, fmtValue, iconOf, lastMove, moveIcon, ringFor, shortLabel, unitText, whenText, type Goal, type SummaryMetric } from './data';

const GOOD = fx.status.good;
const REACHED = fx.status.optimal;

export function MetricGrid({ metrics, goals, onOpen }: { metrics: SummaryMetric[]; goals: Goal[] | null; onOpen: (m: SummaryMetric) => void }) {
  const rows: SummaryMetric[][] = [];
  for (let i = 0; i < metrics.length; i += 2) rows.push(metrics.slice(i, i + 2));
  return <View style={styles.grid}>
    {rows.map((row, r) => <View key={row[0].metric} style={styles.row}>
      {row.map((m, c) => <Reveal key={m.metric} index={r * 2 + c} id={`bio.metric.${m.metric}`} style={styles.cell}>
        {m.latest ? <MetricTile m={m} goals={goals} index={r * 2 + c} onPress={() => onOpen(m)} /> : <LogTile m={m} />}
      </Reveal>)}
      {row.length === 1 ? <View style={styles.cell} /> : null}
    </View>)}
  </View>;
}

function MetricTile({ m, goals, index, onPress }: { m: SummaryMetric; goals: Goal[] | null; index: number; onPress: () => void }) {
  const v = m.latest!.value;
  const ring = ringFor(m, goals);
  const color = ring.reached ? REACHED : GOOD;
  const move = lastMove(m.series);
  const decimals = decimalsOf(v);
  const unit = unitText(m.unit);
  // a scale metric's own scale is in its unit already ("4 /5", "80 %"): its foot is the date alone
  const foot = ring.kind === 'goal' && ring.goal ? `Goal ${fmtValue(ring.goal.targetValue as number)} ${unit}` : ring.kind === 'scale' ? null : 'No goal';
  const ringText = ring.kind === 'goal' && ring.goal ? `${Math.round((ring.fill ?? 0) * 100)} percent of the way to ${fmtValue(ring.goal.targetValue as number)} ${unit}` : ring.kind === 'scale' ? `${v} ${m.unit}` : 'no goal';
  return <GlassCard variant="three" padding={18} onPress={onPress} label={`${m.label}: ${v} ${unit}, ${whenText(m.latest!)}; ${ringText}`} hint="Opens the details" style={styles.tile}>
    <MetricRing value={ring.fill} max={1} index={index} color={color} seenKey={`bio.metric.${m.metric}`} accessibilityLabel={`${shortLabel(m.label)}, ${ringText}`}>
      <CountUp value={v} decimals={decimals} honest seenKey={`bio.metric.${m.metric}`} style={styles.ringValue} maxFontSizeMultiplier={1.1} />
      <T v="mono10" color={fx.ink.a60} style={styles.ringUnit} maxFontSizeMultiplier={1.1} numberOfLines={1}>{m.unit === 'steps' ? 'steps' : m.unit}</T>
    </MetricRing>
    <TileName icon={<Icon name={iconOf(m.metric)} size={16} color={ring.fill != null ? color : fx.ink.a70} />}>{shortLabel(m.label)}</TileName>
    <View style={styles.value}>
      {/* the value grows with the text size up to 1.3× (as the app's other big figures), so a four-digit count stays on
          one line in a 320 dp tile at text 2.0 ('2,43' / '6', SWA-14); the unit moves under it when the row is full */}
      <CountUp value={v} decimals={decimals} honest seenKey={`bio.metric.${m.metric}.value`} style={styles.big} maxFontSizeMultiplier={1.3} fit={0.6} />
      <T v="mono12" color={fx.ink.a60} numberOfLines={2} style={styles.shrink}>{unit}</T>
      {move ? <Icon name={moveIcon(move)} size={14} color={fx.ink.a50} label={move === 'up' ? 'Up from the value before' : move === 'down' ? 'Down from the value before' : 'Same as the value before'} /> : null}
    </View>
    <T v="caption" color={fx.ink.a60} numberOfLines={3}>{foot ? `${foot} · ${whenText(m.latest!)}` : whenText(m.latest!)}</T>
  </GlassCard>;
}

/** A tile's icon and name (the name moves under the icon when it does not fit beside it). The name shrinks just enough
 *  for its longest word to fit the tile whole at a large text size on a narrow phone, against the row's width (the
 *  room it has on a line of its own): FitText. */
function TileName({ icon, color, children }: { icon: React.ReactNode; color?: string; children: string }) {
  const [room, setRoom] = useState(0);
  return <View style={styles.name} onLayout={(e) => { const w = Math.floor(e.nativeEvent.layout.width); if (w !== room) setRoom(w); }}>
    {icon}
    <FitText v="section" numberOfLines={2} color={color} width={room} boxStyle={styles.nameText}>{children}</FitText>
  </View>;
}

function LogTile({ m }: { m: SummaryMetric }) {
  return <GlassCard variant="three" padding={18} borderColor={fx.line.a10} onPress={() => router.push({ pathname: '/progress-entry', params: { metric: m.metric } })}
    label={`${m.label}: nothing logged yet. Log a value`} style={[styles.tile, styles.dashed]}>
    <View style={styles.logRing}><Icon name={iconOf(m.metric)} size={22} color={fx.ink.a40} /></View>
    <TileName icon={<Icon name={iconOf(m.metric)} size={16} color={fx.ink.a50} />} color={fx.ink.a80}>{shortLabel(m.label)}</TileName>
    <T v="bodySm" color={fx.ink.a50} numberOfLines={3}>Nothing logged yet</T>
    <View style={styles.logPill}><Icon name="plus" size={12} color={fx.red.label} /><T v="micro" color={fx.red.label}>Log</T></View>
  </GlassCard>;
}

const styles = StyleSheet.create({
  grid: { gap: 12 },
  row: { flexDirection: 'row', gap: 12 },
  cell: { flex: 1, minWidth: 0 },
  tile: { gap: 8, minHeight: 210 },
  dashed: { borderStyle: 'dashed' },
  flex: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  nameText: { flexShrink: 1, alignSelf: 'auto' },
  ringValue: { fontFamily: FONTS.mono700, fontSize: 14, lineHeight: 18, color: fx.ink.white, textAlign: 'center' },
  ringUnit: { fontSize: 9, lineHeight: 12, textAlign: 'center', maxWidth: 60 },
  // the icon and the name share a line; a name too long for the rest of it moves under the icon whole (flexWrap)
  // rather than breaking inside a word at a large text size
  name: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 2, marginTop: 12 },
  value: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 6 },
  big: { fontFamily: FONTS.mono500, fontSize: 22, lineHeight: 28, color: fx.ink.white },
  logRing: { width: 80, height: 80, borderRadius: 40, borderWidth: 6, borderColor: fx.premium.ringTrackSoft, alignItems: 'center', justifyContent: 'center' },
  logPill: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: fx.radius.pill, borderWidth: 1, borderColor: fx.red.a30, backgroundColor: fx.red.a06 },
});
