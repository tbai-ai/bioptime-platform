/* A released report in the list, in the earlier app's blood-work summary look (shot 77): the report's name, its
   reference and collection date, who reviewed it, and on the right the count of values the laboratory put outside
   its range (orange) or "In range" (green), counted up once. Opens the report overlay. The name and the reviewer
   shrink just enough for their longest word to fit whole at a large text size on a narrow phone (FitText). */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { fmtDate } from '@/lib/format';
import { CountUp, fx, GlassCard, Icon, motionValues, T, typeScale } from '@/fx';
import { FitText } from '../bio/wordFit';
import { RowTilt } from './RowTilt';
import { reportState, type Report } from './model';

export function ReportCard({ r, onPress }: { r: Report; onPress: () => void }) {
  const state = reportState(r);
  const flags = r.flagged?.length ?? 0;
  const ready = r.valuesStatus === 'ready' && (r.values?.length ?? 0) > 0;
  const colour = flags ? fx.hue.orange500 : ready ? fx.hue.emerald : fx.ink.a50;
  return <RowTilt intensity={motionValues.tilt.row} radius={fx.radius.three} pressScale={1}><GlassCard variant="three" padding={20} borderColor={fx.line.a08} onPress={onPress}
    label={`${r.test?.name ?? 'Report'}, ${r.reference}, collected ${fmtDate(r.collectedAt)}, ${state.text}`} hint="Opens the report">
    <View style={styles.row}>
      <View style={styles.flex}>
        <FitText v="cardTitle">{r.test?.name ?? 'Report'}</FitText>
        <T v="caption" color={fx.ink.a60}>{`${r.reference} · collected ${fmtDate(r.collectedAt)}`}</T>
        <View style={styles.review}>
          <Icon name={r.reviewed ? 'badge-check' : 'hourglass'} size={12} color={r.reviewed ? fx.hue.green400 : fx.ink.a50} />
          <FitText v="caption" color={fx.ink.a60} boxStyle={styles.flex}>{r.reviewed ? `Reviewed by ${r.reviewerName ?? (r.reviewerKind === 'team' ? 'the Bioptime team' : 'your coach')}` : 'Awaiting review'}</FitText>
        </View>
      </View>
      <View style={styles.right}>
        {flags ? <CountUp value={flags} duration={700} style={[styles.count, { color: colour }]} /> : <Icon name={ready ? 'circle-check' : 'file-text'} size={26} color={colour} />}
        <T v="micro" color={flags ? colour : fx.ink.a60} style={styles.label}>{flags ? 'Outside range' : state.text}</T>
      </View>
      <Icon name="chevron-right" size={16} color={fx.ink.a40} />
    </View>
  </GlassCard></RowTilt>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1, minWidth: 0, gap: 3 },
  review: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  right: { alignItems: 'flex-end', gap: 4, maxWidth: 96 },
  count: { ...typeScale.metric30, fontSize: 30 },
  label: { textAlign: 'right', fontSize: 9 },
});
