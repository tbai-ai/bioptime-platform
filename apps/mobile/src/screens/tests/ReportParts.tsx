/* Pieces of the report overlay (report/[id]) in the earlier app's blood-work look (BloodWorkResults, shots 77):
   - ReportSummary: the #0B0B0B summary card: the report's name, reference, collection and laboratory dates, and on the
     right how many values the laboratory put outside its range (orange) or a green check. A flag count is never
     counted: it appears final with the small pop (opacity .6 → 1, scale .92 → 1, 120 ms), and its noun follows it.
   - MarkerPanel: a collapsible panel per group of markers (open at first; the chevron turns), with "n flags" (orange)
     or "all clear" (green); each marker shows its value in mono with the unit, the range bar (the green band is the
     laboratory's range, the dot is the value, glowing in its state colour) and the laboratory's range and state. The
     panel keeps its natural layout until it is first toggled (no measuring pass that collapses it for a frame); its
     height is clipped to h × progress only while it opens or closes. The range dots glide in 60 ms apart once their
     panel is in view.
   - ReviewNote: the coach's (or the Bioptime team's) note on the red tint, or that the review is awaited.
   Values, units, ranges and flags are the laboratory's, unchanged; the app adds no judgement. A panel's badge and a
   marker's value sit beside their title while its longest word fits whole beside them, else under it (measured:
   Beside, SWA-07, SWA-13); a unit is drawn whole on one line ('10³/µL' drawn as '10³/', SWA-08), and a range's unit
   moves to the next line whole (SWA-09). */
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { fmtDate, rangeWithUnit } from '@/lib/format';
import { CountUp, fx, Icon, RangeBar, RowDivider, T, timing, tk, typeScale, useFx, withAlpha } from '@/fx';
import { useTitleFit } from '@/fx/Button';
import { motionValues } from '@/fx/motion/tokens';
import { Beside } from '@/fx/wordFit';

const S = motionValues.screens.m79;
import { markerState, rangePosition, rangeText, type Report, type ReportValue } from './model';

export function ReportSummary({ d, pills }: { d: Report; pills: React.ReactNode }) {
  const flags = d.flagged?.length ?? 0;
  const ready = d.valuesStatus === 'ready' && (d.values?.length ?? 0) > 0;
  const colour = flags ? fx.hue.orange500 : fx.hue.emerald;
  return <View style={styles.summary}>
    <View style={styles.row}>
      <View style={styles.flex}>
        <T v="cardTitle" style={styles.name}>{d.test?.name ?? 'Report'}</T>
        <T v="caption" color={fx.ink.a60}>{`${d.reference} · collected ${fmtDate(d.collectedAt)}`}</T>
        {d.deliveredAt ? <T v="caption" color={fx.ink.a60}>{`Laboratory report ${fmtDate(d.deliveredAt)}`}</T> : null}
      </View>
      {ready ? <View style={styles.flags} accessible accessibilityLabel={flags ? `${flags} outside the laboratory's range` : 'All in range'}>
        {flags ? <CountUp value={flags} honest style={[styles.count, { color: colour }]} /> : <Icon name="circle-check" size={28} color={colour} />}
        <T v="micro" color={flags ? colour : fx.ink.a60}>{flags ? (flags === 1 ? 'Flag' : 'Flags') : 'In range'}</T>
      </View> : null}
    </View>
    <View style={styles.pills}>{pills}</View>
  </View>;
}

export function MarkerPanel({ title, values, flags, index }: { title: string; values: ReportValue[]; flags: number; index: number }) {
  const { calm } = useFx();
  const [open, setOpen] = useState(true);
  const toggled = useSharedValue(0); // 0: the natural layout (never toggled); 1: clipped to h × p
  const h = useSharedValue(0);
  const p = useSharedValue(1);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    toggled.value = 1;
    p.value = calm ? (open ? 1 : 0) : withTiming(open ? 1 : 0, timing(tk.accordion));
  }, [open, calm, p, toggled]);
  const body = useAnimatedStyle(() => (toggled.value === 1 && h.value > 0 ? { height: h.value * p.value, opacity: p.value } : { opacity: 1 }));
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: String(180 * (1 - p.value)) + 'deg' }] }));
  const inView = useInView();
  const badge = flags ? { c: fx.hue.orange500, icon: 'triangle-alert' as const, text: `${flags} flag${flags === 1 ? '' : 's'}` } : { c: fx.hue.green400, icon: 'circle-check' as const, text: 'all clear' };
  return <View style={styles.panel} ref={inView.ref} onLayout={inView.onLayout}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}, ${badge.text}`} accessibilityState={{ expanded: open }} onPress={() => setOpen((o) => !o)} style={styles.panelHead}>
      <Beside words={[{ text: title, v: 'cardTitle', style: styles.panelTitle }]} gap={10} grow={false} underGap={6} style={styles.flex}
        side={<View style={[styles.badge, { backgroundColor: withAlpha(badge.c, 0.1), borderColor: withAlpha(badge.c, 0.3) }]}>
          <Icon name={badge.icon} size={12} color={badge.c} />
          <T v="sectionStrong" color={badge.c} style={styles.badgeText}>{badge.text}</T>
        </View>}>
        <T v="cardTitle" style={styles.panelTitle}>{title}</T>
      </Beside>
      <Animated.View style={chevron}><Icon name="chevron-up" size={18} color={fx.ink.a50} /></Animated.View>
    </Pressable>
    <Animated.View style={[styles.clip, body]} accessibilityElementsHidden={!open} importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}>
      <View onLayout={(e) => { const v = e.nativeEvent.layout.height; if (v > 0) h.value = v; }}>
        {values.map((v, i) => <View key={`${v.marker_key ?? v.label}-${i}`}>
          {i ? <RowDivider /> : null}
          <Marker v={v} start={inView.seen} delay={Math.min(i, motionValues.reveal.dataMaxSteps) * S.dotStep} />
        </View>)}
      </View>
    </Animated.View>
  </View>;
}

/** Whether a panel has come into view (once): the web watches it with an IntersectionObserver; native starts when it
 *  first lays out (the report scrolls in an overlay that does not share its offset with its parts). */
function useInView() {
  const ref = useRef<React.ComponentRef<typeof View>>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen || Platform.OS !== 'web') return;
    const el = ref.current as unknown as Element | null;
    if (typeof IntersectionObserver === 'undefined' || !el || typeof el.getBoundingClientRect !== 'function') { setSeen(true); return; }
    const io = new IntersectionObserver((list) => { if (list.some((x) => x.isIntersecting)) { setSeen(true); io.disconnect(); } });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (seen || Platform.OS === 'web' || (width === 0 && height === 0)) return; // a detached page reports 0 × 0
    setSeen(true);
  };
  return { ref, onLayout, seen };
}

function Marker({ v, delay, start }: { v: ReportValue; delay: number; start: boolean }) {
  const state = markerState(v);
  const pos = rangePosition(v);
  const range = rangeText(v);
  const unit = useTitleFit(v.units ?? '');
  return <View style={styles.marker} accessible accessibilityLabel={`${v.label}: ${v.value}${v.units ? ` ${v.units}` : ''}. Laboratory range ${range}${v.units ? ` ${v.units}` : ''}.${state ? ` ${state.text}.` : ''}`}>
    <Beside words={[{ text: v.label, v: 'body', style: styles.markerName }]} align="baseline" underGap={2} side={<View style={styles.value}>
      <T v="mono14" color={v.flag && state ? state.colour : fx.ink.white} style={styles.valueText}>{v.value}</T>
      {v.units ? <T v="caption" color={fx.ink.a60} numberOfLines={1} {...unit.props} style={unit.style}>{v.units}</T> : null}
    </View>}>
      <T v="body" color={fx.ink.white} style={styles.markerName}>{v.label}</T>
    </Beside>
    {pos != null ? <RangeBar position={pos} color={state?.colour ?? fx.map.marker.in_range} delay={delay} start={start} /> : null}
    <View style={styles.markerFoot}>
      <T v="caption" color={fx.ink.a60} style={styles.flex}>{`Laboratory range ${rangeWithUnit(range, range !== '—' ? v.units : null)}`}</T>
      {state ? <T v="micro" color={state.colour} style={styles.state}>{state.text}</T> : null}
    </View>
  </View>;
}

export function ReviewNote({ d }: { d: Report }) {
  const team = d.reviewerKind === 'team';
  return <View style={styles.note}>
    <View style={styles.noteHead}>
      <Icon name={team ? 'shield-check' : 'message-square'} size={15} color={fx.red.label} />
      <T v="overline" style={styles.flex}>{team ? 'Review notes from the Bioptime team' : 'Your coach’s notes'}</T>
    </View>
    {d.coachNote ? <>
      <T v="body" color={fx.ink.white} style={styles.noteText}>{d.coachNote}</T>
      <T v="caption" color={fx.ink.a60}>{`${d.reviewerName ?? (team ? 'Bioptime team' : 'Your coach')} · ${fmtDate(d.reviewedAt)}`}</T>
    </> : <T v="body" color={fx.ink.a60}>{team ? 'Awaiting the Bioptime team’s review.' : 'Awaiting your coach’s review.'}</T>}
  </View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  summary: { backgroundColor: fx.bg.sheetLab, borderRadius: fx.radius.three, borderWidth: 1, borderColor: fx.line.a10, padding: 20, gap: 14 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  name: { fontSize: 17, lineHeight: 24 },
  flags: { alignItems: 'flex-end', gap: 2 },
  count: { ...typeScale.metric30, fontSize: 32, lineHeight: 36 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  panel: { backgroundColor: fx.bg.sheetLab, borderRadius: fx.radius.three, borderWidth: 1, borderColor: fx.line.a10, overflow: 'hidden' },
  panelHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingVertical: 18, minHeight: 56 },
  panelTitle: { fontSize: 17, lineHeight: 24, flexShrink: 1 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: fx.radius.pill, borderWidth: 1 },
  badgeText: { fontSize: 12, lineHeight: 16 },
  clip: { overflow: 'hidden' },
  marker: { paddingHorizontal: 20, paddingVertical: 14, gap: 10 },
  markerName: { fontSize: 15, lineHeight: 22 },
  value: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  valueText: { fontFamily: typeScale.metric24.fontFamily, fontSize: 16, lineHeight: 22 },
  markerFoot: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  state: { fontSize: 10, letterSpacing: 10 * 0.12 },
  note: { borderRadius: fx.radius.three, borderWidth: 1, borderColor: fx.red.a20, backgroundColor: fx.red.a05, padding: 20, gap: 10 },
  noteHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  noteText: { fontSize: 15, lineHeight: 24 },
});
