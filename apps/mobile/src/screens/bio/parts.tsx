/* Small pieces Bio and Life share (both S4/S5): the section title row, the 48 pt icon tile of the earlier app's metric
   sheets, the coach's rail card whose red rule draws before its words fade in (PREMIUM §1.10 Bio; from its card's
   entrance on an active page, the kit's data rule), the status pill that
   flips when it changes (goals and milestones), and a horizontal chip row that keeps the tab swipe out of it.
   Small controls reach 44 pt (48 dp on Android) to touch without changing the layout: the touch box is padded around
   the drawn control inside a matching negative margin (RN-web ignores hitSlop, and a scroll view takes no touch outside
   its own bounds, so the chip row's scroller is that much taller inside a negative margin too: the kit's
   CHIP_ROW_TOUCH). */
import React, { useEffect, useRef, useState } from 'react';
import { PixelRatio, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';
import { AnimatedPressable, CheckPop, ease, fx, GlassCard, Icon, NoSwipeZone, Pill, T, timing, useMotion, usePress, type IconName, type PillTone } from '@/fx';
import { CHIP_ROW_TOUCH } from '@/fx/Chip';
import { maxScaleFor, type as typeScaleOf } from '@/fx/type';
import { useDataStart } from '@/fx/motion/Reveal';
import { t } from '@/fx/motion/tokens';
import { touchSlopY } from '@/fx/press';
import { takeJustReached } from './data';
import { FitText } from './wordFit';

/** The action chip's drawn height (about 31.5: 8 + its 10 pt line + 8 and the border, rounded down so the touch box
 *  never falls short); its touch box reaches the platform minimum. */
const CHIP_BUTTON_H = 31;
const CHIP_BUTTON_REACH = touchSlopY(CHIP_BUTTON_H);

/** A section's title (Montserrat 14/600) with an optional icon and right-hand action, as the earlier app's
 *  `flex justify-between items-center mb-3` rows. */
export function SectionHead({ title, icon, right, style }: { title: string; icon?: IconName; right?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.head, style]}>
    <View style={styles.headLeft}>
      {icon ? <Icon name={icon} size={15} color={fx.red.label} /> : null}
      <T v="sectionStrong" accessibilityRole="header" style={styles.headText}>{title}</T>
    </View>
    {right}
  </View>;
}

/** The 48 pt tile at the top of a metric or marker sheet (radius 12, white/5 with a white/10 border). */
export function IconTile({ icon, color = fx.ink.white, size = 48 }: { icon: IconName; color?: string; size?: number }) {
  return <View style={[styles.tile, { width: size, height: size, borderRadius: size >= 48 ? fx.radius.xl : fx.radius.lg }]}>
    <Icon name={icon} size={Math.round(size * 0.42)} color={color} />
  </View>;
}

/** A card with the coach's red rule on its left: the rule draws downwards (400 ms expo), then the words fade in, from
 *  its card's entrance (the nearest Reveal or FirstCard; at once outside one), only while its page is active. At rest
 *  under reduced motion. */
export function RailCard({ children, color = fx.red.brand, onPress, label, hint, style }: {
  children: React.ReactNode; color?: string; onPress?: () => void; label?: string; hint?: string; style?: StyleProp<ViewStyle>;
}) {
  const { still } = useMotion();
  const rail = useSharedValue(still ? 1 : 0);
  const words = useSharedValue(still ? 1 : 0);
  useDataStart(undefined, undefined, !still, (wait) => {
    'worklet';
    const draw = withTiming(1, timing(t.flow, ease.expo));
    rail.set(wait > 0 ? withDelay(wait, draw) : draw);
    words.set(withDelay(wait + t.base, withTiming(1, timing(t.base))));
  });
  useEffect(() => {
    if (still) { rail.set(1); words.set(1); }
  }, [still, rail, words]);
  const railStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: rail.get() }] }));
  const wordsStyle = useAnimatedStyle(() => ({ opacity: words.get() }));
  return <GlassCard variant="three" padding={0} clip onPress={onPress} label={label} hint={hint} style={style}>
    <Animated.View style={[styles.rail, { backgroundColor: color }, railStyle]} />
    <Animated.View style={[styles.railBody, wordsStyle]}>{children}</Animated.View>
  </GlassCard>;
}

/** A status pill that turns over (rotateX 90° → 0, 260 ms) when its word changes; still under reduced motion. */
export function FlipPill({ children, tone, color }: { children: string; tone?: PillTone; color?: string }) {
  const { still } = useMotion();
  const turn = useSharedValue(0);
  const last = useRef(children);
  useEffect(() => {
    if (last.current === children) return;
    last.current = children;
    if (still) return;
    turn.set(withSequence(withTiming(1, { duration: 0 }), withTiming(0, timing(260, ease.expo))));
  }, [children, still, turn]);
  const a = useAnimatedStyle(() => (turn.get() === 0 ? { transform: [] } : { transform: [{ perspective: 400 }, { rotateX: `${turn.get() * 90}deg` }] }));
  return <Animated.View style={a}><Pill tone={tone} color={color}>{children}</Pill></Animated.View>;
}

/** A goal that a value just logged has reached (LogValue noteJustReached): its done check pops once, the first time a
 *  card draws it achieved after the log, whether the card mounts then or was already on screen when the goal turned
 *  achieved (CheckPop: the pop and the ring burst on tiers A and B, the pop alone at C, at once under reduced motion).
 *  The note is taken in an effect (never during a render), so only one card takes it. Nothing otherwise. */
export function ReachedPop({ id, achieved }: { id: string; achieved: boolean }) {
  const [fresh, setFresh] = useState(false);
  const [on, setOn] = useState(false);
  useEffect(() => { if (achieved && !fresh && takeJustReached(id)) setFresh(true); }, [achieved, fresh, id]);
  // mounted unchecked first, then checked: CheckPop pops on the change
  useEffect(() => { if (fresh) setOn(true); }, [fresh]);
  if (!fresh) return null;
  return <View accessible accessibilityLabel="Goal reached just now"><CheckPop checked={on} size={20} color={fx.hue.green500} /></View>;
}

/** A horizontal row of chips that scrolls on its own (the tab swipe waits for it). */
export function ChipRow({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <NoSwipeZone>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chips, CHIP_ROW_TOUCH.content, style]} style={[styles.chipScroll, CHIP_ROW_TOUCH.scroller]}>{children}</ScrollView>
  </NoSwipeZone>;
}

/** The earlier app's small red-outlined action chip ("EXPAND"): 10 pt caps on red/6 with a red/40 border, radius 8;
 *  its touch box reaches 44 pt (48 dp) above and below (padding inside a matching negative margin: the row keeps its
 *  height) and 6 pt beyond each side. */
export function ChipButton({ title, onPress, label, icon }: { title: string; onPress: () => void; label?: string; icon?: IconName }) {
  const press = usePress('chip');
  return <AnimatedPressable accessibilityRole="button" accessibilityLabel={label ?? title} onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut}
    style={styles.chipButtonHit}>
    <Animated.View style={[styles.chipButton, press.pressed ? styles.chipButtonOn : null, press.style]}>
      {icon ? <Icon name={icon} size={12} color={fx.red.label} /> : null}
      <T v="micro" color={fx.red.label} style={styles.chipButtonText}>{title}</T>
    </Animated.View>
  </AnimatedPressable>;
}

/** The micro label's size, its spacing and an uppercase letter's widest advance (em) for labelFit's estimate. */
const MICRO = typeScaleOf.micro;
const UPPER_EM = 0.8;
/** How far a stat's label shrinks (0.6 … 1) so its longest word fits the column whole: a narrow column (a 320 dp phone,
 *  a large text size) never breaks a word in the middle ("COLLECTIO/N"); the label still wraps between words. */
function labelFit(label: string, width: number): number {
  if (width <= 0) return 1;
  const longest = label.split(/\s+/).reduce((n, w) => Math.max(n, w.length), 0);
  const size = (MICRO.fontSize ?? 9) * Math.min(PixelRatio.getFontScale(), maxScaleFor('micro'));
  const need = longest * size * UPPER_EM + Math.max(0, longest - 1) * (MICRO.letterSpacing ?? 0) * (size / (MICRO.fontSize ?? 9));
  return need <= width ? 1 : Math.max(0.6, Math.floor((width / need) * 100) / 100);
}

/** A small mono stat with its label under it (the earlier app's hero stat row and sheet stat tiles). The label shrinks
 *  just enough for its longest word to fit the column: labelFit's estimate from the system text size, or less when the
 *  word as drawn needs it (FitText measures it, so the web's large-text pass is covered too: A1W-m2). */
export function Stat({ value, label, color = fx.ink.white, tile }: { value: string; label: string; color?: string; tile?: boolean }) {
  return <View style={[styles.stat, tile ? styles.statTile : null]} accessible accessibilityLabel={`${label}: ${value}`}>
    <T v="metric24" color={color} style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{value}</T>
    <FitText v="micro" color={fx.ink.a60} center boxStyle={styles.statLabel} cap={(w) => labelFit(label, w)}>{label}</FitText>
  </View>;
}

const styles = StyleSheet.create({
  // at a large text size the right-hand part moves under the title instead of squeezing it (flexWrap)
  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 8, rowGap: 4, marginBottom: 12, minHeight: 28 },
  headLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flexGrow: 1, flexShrink: 1, minWidth: 0 },
  headText: { flexGrow: 1, flexShrink: 1 },
  tile: { alignItems: 'center', justifyContent: 'center', backgroundColor: fx.fill.a05, borderWidth: 1, borderColor: fx.line.a10 },
  rail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, transformOrigin: 'top' },
  railBody: { paddingVertical: 22, paddingLeft: 26, paddingRight: 22, gap: 10 },
  chips: { gap: 8, paddingRight: 4 },
  chipButtonHit: { paddingVertical: CHIP_BUTTON_REACH, marginVertical: -CHIP_BUTTON_REACH, paddingHorizontal: 6, marginHorizontal: -6 },
  chipButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: fx.radius.lg, borderWidth: 1, borderColor: fx.red.a40, backgroundColor: fx.red.a06 },
  chipButtonOn: { backgroundColor: fx.red.a15 },
  chipButtonText: { fontSize: 10, letterSpacing: 1.4 },
  chipScroll: { flexGrow: 0 },
  stat: { flex: 1, alignItems: 'center', gap: 4, minWidth: 0, paddingHorizontal: 4 },
  statTile: { paddingVertical: 14, paddingHorizontal: 8, borderRadius: fx.radius.card, borderWidth: 1, borderColor: fx.line.a08, backgroundColor: fx.fill.a03 },
  statValue: { fontSize: 18, lineHeight: 24 },
  statLabel: { alignSelf: 'stretch' },
});
