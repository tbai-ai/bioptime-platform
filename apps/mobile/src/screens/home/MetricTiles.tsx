/* The 2×2 metric tiles (the earlier app's biomarker grid, THEME §11.4): resting heart rate, sleep, weight and steps
   from the member's own progress, each with its 10 pt uppercase name, a trend arrow from the last two values (its
   colour says better or worse; the arrow and the spoken label carry it too), the mono 24 value counting up with its
   unit, and a 60×24 sparkline at .7. A metric with no value yet is a dashed "Log" tile that opens Log a value; a tile
   with a value opens the metric in Bio. Under them, "Log a value". A member with no value in any of the four sees one
   dashed row instead of four empty tiles ("Log your first values": resting heart rate, sleep, weight and steps), which
   opens Log a value.
   Motion (motion v2 M64): the values and lines start from the grid's own entrance (the kit's data rule); a value seen
   for the first time appears final with the pop (never counted up from zero), a later change counts from the value
   shown last, and a revisit shows them at rest (seen keys home.tile.*). */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Button, CountUp, fx, Icon, Sparkline, T, typeScale, type IconName } from '@/fx';
import { isTodayAt } from '@/lib/today';
import { dayMonth, lowerIsBetter, type MetricView } from './data';

export type TileSpec = { key: string; label: string; short: string; unit: string; view: MetricView | null };

function trendLook(m: MetricView): { icon: IconName; color: string; word: string } | null {
  if (!m.trend) return null;
  if (m.trend === 'flat') return { icon: 'minus', color: fx.ink.a50, word: 'steady' };
  const better = lowerIsBetter(m.key) ? m.trend === 'down' : m.trend === 'up';
  return { icon: m.trend === 'up' ? 'trending-up' : 'trending-down', color: better ? fx.status.optimal : fx.red.brand, word: m.trend };
}

export function MetricTiles({ tiles, onOpen, onLog }: { tiles: TileSpec[]; onOpen: (key: string, label: string) => void; onLog: (key?: string) => void }) {
  if (tiles.every((s) => !s.view || s.view.latest == null)) {
    const names = tiles.map((s) => s.label.toLowerCase()).join(', ').replace(/, ([^,]*)$/, ' and $1');
    return <Pressable accessibilityRole="button" accessibilityLabel={`Log your first values: ${names}`} onPress={() => onLog()}
      style={({ pressed }) => [styles.tile, styles.ghost, styles.firstRow, pressed ? styles.pressed : null]}>
      <View style={styles.logRow}><Icon name="plus" size={16} color={fx.red.vivid} /><T v="sectionStrong" color={fx.red.vivid}>Log your first values</T></View>
      <T v="caption" color={fx.ink.a60}>{`${names.charAt(0).toUpperCase()}${names.slice(1)}: nothing logged yet.`}</T>
    </Pressable>;
  }
  return <View>
    <View style={styles.grid}>
      {tiles.map((s, i) => {
        const m = s.view;
        if (!m || m.latest == null) return <Pressable key={s.key} accessibilityRole="button" accessibilityLabel={`${s.label}: nothing logged yet. Log a value`}
          onPress={() => onLog(s.key)} style={({ pressed }) => [styles.tile, styles.ghost, pressed ? styles.pressed : null]}>
          <T v="micro" color={fx.ink.a70} style={styles.name}>{s.short}</T>
          <View style={styles.logRow}><Icon name="plus" size={16} color={fx.red.vivid} /><T v="sectionStrong" color={fx.red.vivid}>Log</T></View>
          <T v="caption" color={fx.ink.a50}>No value yet</T>
        </Pressable>;
        const tr = trendLook(m);
        // a value not logged today says its day beside its unit (lib/today: a bare number reads as today's)
        const day = m.at && !isTodayAt(m.at) ? dayMonth(m.at).replace(/ /g, '\u00a0') : null; // "31 Oct" kept on one line
        return <Pressable key={s.key} accessibilityRole="button" accessibilityLabel={`${s.label} ${m.latest} ${m.unit}${day ? `, logged ${day}` : ''}${tr ? `, ${tr.word}` : ''}. Open in Bio`}
          onPress={() => onOpen(s.key, s.label)} style={({ pressed }) => [styles.tile, pressed ? styles.pressed : null]}>
          <View style={styles.top}>
            <T v="micro" color={fx.ink.white} numberOfLines={2} style={[styles.name, styles.shrink]}>{s.short}</T>
            {tr ? <Icon name={tr.icon} size={14} color={tr.color} /> : null}
          </View>
          <View style={styles.valueRow}>
            <CountUp value={m.latest} decimals={m.decimals} honest seenKey={`home.tile.${s.key}`} style={styles.value} maxFontSizeMultiplier={1.3} fit={0.6} />
            <T v="caption" color={fx.ink.a70} style={styles.unit}>{day ? `${s.unit} · ${day}` : s.unit}</T>
          </View>
          <Sparkline values={m.values} width={60} height={24} color={tr?.color === fx.status.optimal ? fx.status.optimal : fx.red.brand} index={i} style={styles.spark} />
        </Pressable>;
      })}
    </View>
    <Button title="Log a value" variant="soft" icon="plus" onPress={() => onLog()} style={styles.log} />
  </View>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { flexGrow: 1, flexBasis: '45%', minHeight: 128, padding: 16, borderRadius: fx.radius.card, borderWidth: 1, borderColor: fx.line.a05, backgroundColor: fx.bg.panelSolid, boxShadow: fx.shadow.panel, gap: 10 },
  ghost: { borderStyle: 'dashed', borderColor: fx.line.a20, backgroundColor: fx.fill.a03, boxShadow: undefined, justifyContent: 'space-between' },
  pressed: { borderColor: fx.red.a30, backgroundColor: fx.fill.a05 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  shrink: { flexShrink: 1 },
  name: { fontSize: 10, lineHeight: 15, letterSpacing: 0.5 },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  // a unit with its day moves under the value whole when the tile is too narrow for both (flexWrap). The unit takes the
  // rest of its line (the whole line once it moves under the value): a unit whose box hugged its text lost its day on
  // Android ('steps · 12 Nov' drawn 'steps ·' under the value: VA-2). It does not shrink, so it still moves whole.
  valueRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 4 },
  value: typeScale.metric24,
  unit: { fontSize: 10, flexGrow: 1 },
  spark: { opacity: 0.7 },
  log: { marginTop: 12 },
  firstRow: { minHeight: 0, flexBasis: 'auto', gap: 6 },
});
