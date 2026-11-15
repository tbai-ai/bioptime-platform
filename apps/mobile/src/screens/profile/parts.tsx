/* Profile's own pieces, drawn as the earlier app drew its Profile tab (THEME §11.4 stat tile with a left rule, the
   records card, the order card with its status bar, the settings rows) from kit parts only.
   Motion (v2, M80): the stat tiles count once per session (seenKey 'profile.stat.*', 1200 ms cubic-out; a revisit
   shows them at rest) and, on the session's first visit, pop from .92 to 1 on the pop spring 50 ms apart; the week's
   bars grow from the values seen last (a revisit draws them at rest), their fills moving by transform inside clipped,
   rounded bars. Everything waits for the page to be active; reduced motion and the pre-rendered HTML are at rest. */
import React, { useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CountUp, FONTS, fx, GlassCard, Icon, motionValues, spring, StickyUnderBar, T, t, timing, ease, useFx, useTabScroll, withAlpha, type IconName } from '@/fx';
import { usePageActive } from '@/fx/nav/pageReady';
import { Beside, FitText, HugText, keepShort } from '@/fx/wordFit';
import { useDataStart } from '@/fx/motion/Reveal';
import { markRevealed, markSeen, seenValue, wasRevealed } from '@/fx/motion/seen';

const S = motionValues.screens.m80;
/** The first-visit pop of the stat tiles, once per session. */
const TILE_POP = 'profile.tiles.pop';

/** A 2×2 stat tile: mono 30 value (counting up), a 12/500 label and a small line in the stat's colour, on a 2 pt
 *  left rule of that colour. `value` null shows "—" (nothing recorded yet). */
export function StatTile({ value, suffix, label, sub, color, onPress, hint, seenKey }: {
  value: number | null; suffix?: string; label: string; sub: string; color: string; onPress?: () => void; hint?: string; seenKey: string;
}) {
  const spoken = `${label}: ${value == null ? 'none yet' : `${value}${suffix ?? ''}`}, ${sub}`;
  return <GlassCard variant="tile" rule={{ color, width: 2 }} onPress={onPress} label={onPress ? spoken : undefined} hint={hint} style={styles.tile}>
    <View accessible={!onPress} accessibilityLabel={onPress ? undefined : spoken}>
      <View style={styles.valueRow}>
        <CountUp value={value} seenKey={`profile.stat.${seenKey}`} duration={S.profileMs} style={styles.value} accessibilityLabel={value == null ? '—' : undefined} />
        {suffix && value != null ? <T v="metric24" style={styles.suffix}>{suffix}</T> : null}
      </View>
      <FitText v="section" style={styles.tileLabel} numberOfLines={2}>{label}</FitText>
      <T v="caption" color={color} style={styles.tileSub} numberOfLines={3}>{sub}</T>
    </View>
  </GlassCard>;
}

/** The stat tiles' pop on the session's first visit: scale .92 → 1 on the pop spring, `index` × 50 ms apart, once the
 *  page is active (tier C, reduced motion and later visits: at rest). */
export function TilePop({ index, children }: { index: number; children: React.ReactNode }) {
  const { calm, inHtml, tier } = useFx();
  const [play] = useState(() => !calm && !inHtml && tier !== 'C' && !wasRevealed(TILE_POP)); // decided at mount
  const active = usePageActive();
  const s = useSharedValue(play ? 0 : 1);
  const armed = useSharedValue(play ? 0 : 1);
  const mark = () => markRevealed(TILE_POP);
  useAnimatedReaction(() => (armed.get() === 0 && active.get() === 1 ? 1 : 0), (go) => {
    if (go !== 1 || armed.get() === 1) return;
    armed.set(1);
    scheduleOnRN(mark);
    const pop = withSpring(1, spring.pop);
    s.set(index > 0 ? withDelay(index * S.tileStep, pop) : pop);
  });
  const a = useAnimatedStyle(() => (s.get() === 1 ? { transform: [] } : { transform: [{ scale: S.tilePopFrom + (1 - S.tilePopFrom) * s.get() }] }));
  if (!play) return <>{children}</>;
  return <Animated.View style={[styles.popFill, a]}>{children}</Animated.View>;
}

/** The week's bars (the kit's WeekBars look: 80 high, gap 8, radius 2; above `threshold` red, else white/10), each a
 *  clipped rounded bar whose fill rises by translateY from the share seen last ('profile.week.*'); the first visit of
 *  the session grows them over 1000 ms, 50 ms apart; a revisit draws them at rest. */
export function SeenWeekBars({ values, threshold = 75, height = 80, accessibilityLabel }: { values: readonly number[]; threshold?: number; height?: number; accessibilityLabel: string }) {
  return <View style={[styles.week, { height }]} accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
    {values.map((v, i) => <SeenWeekBar key={i} index={i} value={v} threshold={threshold} height={height} />)}
  </View>;
}

function SeenWeekBar({ index, value, threshold, height }: { index: number; value: number; threshold: number; height: number }) {
  const { calm, inHtml } = useFx();
  const key = `bar:profile.week.${index}`;
  const h = Math.max(0, Math.min(100, value)) * 0.7 * (height / 80);
  const [base] = useState(() => seenValue(key) ?? 0); // the bar height drawn last, read once
  const atRest = calm || inHtml || base === h;
  const v = useSharedValue(atRest ? h : base);
  const remember = () => markSeen(key, h);
  useEffect(() => { if (atRest) remember(); }); // eslint-disable-line react-hooks/exhaustive-deps
  useDataStart(undefined, undefined, !atRest, (wait) => {
    'worklet';
    scheduleOnRN(remember);
    const run = withTiming(h, timing(t.metricRing, ease.tailOut));
    const w = wait + Math.min(index, values7) * S.tileStep;
    v.set(w > 0 ? withDelay(w, run) : run);
  });
  const fill = useAnimatedStyle(() => ({ transform: [{ translateY: h - v.get() }] }));
  return <View style={[styles.weekSlot, { height }]}>
    <View style={[styles.weekBar, { height: h }]}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: value > threshold ? fx.red.vivid : fx.fill.a10 }, fill]} />
    </View>
  </View>;
}
/** At most this many bars wait for their step (a week has seven). */
const values7 = 6;

/** A two-column row of cards with equal halves: each cell is a padding-free flex box, so a card's own padding never
 *  makes it wider than its neighbour (or than the empty half next to a lone card). */
export function Pair({ children }: { children: React.ReactNode }) {
  const cells = React.Children.toArray(children);
  return <View style={styles.pair}>
    {cells.map((c, i) => <View key={i} style={styles.cell}>{c}</View>)}
    {cells.length === 1 ? <View style={styles.cell} /> : null}
  </View>;
}

/** The title row inside a card: an optional icon, the 14/500 title and something on the right. */
export function CardTitle({ icon, iconColor = fx.red.label, title, right, style }: { icon?: IconName; iconColor?: string; title: string; right?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.cardTitle, style]}>
    <View style={styles.cardTitleLeft}>
      {icon ? <Icon name={icon} size={16} color={iconColor} /> : null}
      <T v="section" accessibilityRole="header" style={styles.shrink}>{title}</T>
    </View>
    {right}
  </View>;
}

/** A tinted square with an icon (order cards, report rows, achievement medals' locked face). */
export function IconTile({ icon, size = 40, colour = fx.red.brand, radius }: { icon: IconName; size?: number; colour?: string; radius?: number }) {
  return <View style={[styles.iconTile, { width: size, height: size, borderRadius: radius ?? Math.round(size / 4), backgroundColor: withAlpha(colour, 0.1), borderColor: withAlpha(colour, 0.25) }]}>
    <Icon name={icon} size={Math.round(size * 0.45)} color={colour} />
  </View>;
}

/** A records row: the name and when, the value in yellow mono on the right (the earlier app's Personal Records); the
 *  value moves under the name when the name's longest word would not fit beside it (measured: Beside, SWB-17). */
export function RecordRow({ title, sub, value, last }: { title: string; sub?: string; value: string; last?: boolean }) {
  return <View style={[styles.record, last ? null : styles.recordLine]} accessible accessibilityLabel={`${title}: ${value}${sub ? `, ${sub}` : ''}`}>
    {/* the value moves under a name that would need more than two lines beside it ('Bar/bell', cut to two lines at
        320 dp from text 1.3: VA-6a), and the name's short words keep a neighbour (keepShort) */}
    <Beside words={[{ text: keepShort(title), v: 'section', pairs: true }]} underGap={2} under="end" lines={2} style={styles.shrink}
      side={<T v="mono14" color={fx.hue.yellow} style={styles.recordValue}>{value}</T>}>
      <T v="section" numberOfLines={2}>{keepShort(title)}</T>
      {sub ? <T v="caption" color={fx.ink.a55}>{sub}</T> : null}
    </Beside>
  </View>;
}

/** The small uppercase heading over a group of rows (Settings). */
export function GroupLabel({ children }: { children: string }) {
  return <T v="label" accessibilityRole="header" style={styles.group}>{children}</T>;
}

/** A coloured status pill with its icon (order and booking colours). */
export function StatusChip({ text, colour, icon }: { text: string; colour: string; icon?: IconName }) {
  return <View style={[styles.pill, { backgroundColor: withAlpha(colour, 0.1), borderColor: withAlpha(colour, 0.3) }]}>
    {icon ? <Icon name={icon} size={12} color={colour} /> : null}
    <HugText v="micro" color={colour} style={styles.pillText}>{text}</HugText>
  </View>;
}

export function Meta({ icon, text }: { icon: IconName; text: string }) {
  // at a large text size a date wraps inside its column instead of running under the amount beside it (SWB-19, as Tests)
  return <View style={[styles.meta, styles.metaShrink]}><Icon name={icon} size={12} color={fx.ink.a50} /><T v="caption" color={fx.ink.a60} style={styles.textShrink}>{text}</T></View>;
}

/** The sub-tab row, pinned under the compact bar while the page scrolls; it turns opaque once pinned so the page
 *  passing under it does not show through the translucent track. */
export function StickyRow({ top, children }: { top: number; children: React.ReactNode }) {
  const y = useTabScroll();
  const insets = useSafeAreaInsets();
  const from = top - (insets.top + motionValues.header.barHeight);
  const back = useAnimatedStyle(() => ({ opacity: y ? Math.max(0, Math.min(1, (y.value - from) / 24)) : 0 }));
  const row = <View style={styles.stickyRow}>
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.stickyBack, back]} />
    {children}
  </View>;
  // keyed by the header's height: the kit's bar measures where the row sits once, when it is laid out, and on the web a
  // row that only moves (the header above it grew when the member's data arrived) is not laid out again, so it would
  // pin too low; a new header height measures it afresh
  return y ? <StickyUnderBar key={top} scrollY={y}>{row}</StickyUnderBar> : row;
}

export const shared = StyleSheet.create({
  gap16: { gap: 16 },
  gap12: { gap: 12 },
  gap8: { gap: 8 },
  row: { flexDirection: 'row', gap: 12 },
  flex: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  center: { alignItems: 'center', justifyContent: 'center' },
});

const styles = StyleSheet.create({
  popFill: { flexGrow: 1 },
  week: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  weekSlot: { flex: 1, justifyContent: 'flex-end' },
  weekBar: { borderRadius: fx.radius.xs, overflow: 'hidden' },
  tile: { flexGrow: 1, minHeight: 112 },
  pair: { flexDirection: 'row', gap: 12, alignItems: 'stretch' },
  cell: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 2, marginBottom: 4 },
  value: { fontFamily: FONTS.mono500, fontSize: 30, lineHeight: 34, color: fx.ink.white, fontVariant: ['tabular-nums'] },
  suffix: { fontSize: 18, lineHeight: 22, color: fx.ink.a70 },
  tileLabel: { fontSize: 13, lineHeight: 18 },
  tileSub: { fontFamily: FONTS.sans600, fontSize: 10, letterSpacing: 0.5, marginTop: 4 },
  cardTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 },
  cardTitleLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  shrink: { flexShrink: 1, flex: 1, minWidth: 0 },
  iconTile: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  record: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  recordLine: { borderBottomWidth: 1, borderBottomColor: fx.line.a05 },
  recordValue: { fontSize: 15, lineHeight: 20, textAlign: 'right' },
  group: { marginTop: 12, marginBottom: 2, marginLeft: 4 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: fx.radius.pill, borderWidth: 1, alignSelf: 'flex-start' },
  pillText: { fontSize: 10, lineHeight: 14 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaShrink: { flexShrink: 1, minWidth: 0 },
  textShrink: { flexShrink: 1 },
  stickyRow: { paddingHorizontal: fx.space.cardX, paddingVertical: 8 },
  stickyBack: { backgroundColor: fx.glass.headerLite },
});
