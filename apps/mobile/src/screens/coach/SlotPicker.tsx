/* The day and time picker of Book and Move a consultation, in the earlier app's checkout step 4 look: "PREFERRED DATE"
   date chips in a horizontal row (weekday, day, month; the chosen one red), then "FREE TIMES" as a two-column grid of
   time tiles with a clock (the chosen one red/10 with a red border and red text). The tiles pop in 20 ms apart when a
   day's slots arrive (at rest with reduced motion). Times are the coach's free slots from GET
   /me/appointments/slots?date= (IST); a day with none says so.
   Motion (v2, M82): the chosen tile pops .94 → 1 on the pop spring while its red look mixes in over 200 ms; SlotCta is
   the live request button: its label crossfades to the chosen slot ("Request Tue 3 Nov · 07:00", y 6, 200 ms), its
   colour goes from white/5 to the brand red over 300 ms with a glow layer fading in, and it pulses once (1.02, 240 ms).
   Reduced motion: colour only; tier C: no pulse. */
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { AnimatedPressable, DateChip, Eyebrow, Icon, NoSwipeZone, RingSpinner, Skeleton, T, ease, fx, haptics, spring, timing, useFx, usePress } from '@/fx';
import { calmFade, motionValues } from '@/fx/motion/tokens';
import { PRESS_PROPS, pressTransform, useStateMix } from '@/fx/press';
import { chipParts, istDay, istTime } from './time';

const S82 = motionValues.screens.m82;

export type Slot = { startAt: string; endAt?: string };

export function DateRow({ days, value, onChange }: { days: string[]; value: string; onChange: (d: string) => void }) {
  return <View>
    <Eyebrow kind="label" style={styles.label}>Preferred date</Eyebrow>
    <NoSwipeZone>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dates} accessibilityRole="tablist">
        {days.map((d) => { const p = chipParts(d); return <DateChip key={d} weekday={p.weekday} day={p.day} month={p.month} label={p.label} selected={d === value} onPress={() => onChange(d)} />; })}
      </ScrollView>
    </NoSwipeZone>
  </View>;
}

export function SlotGrid({ slots, value, onChange, loading, empty }: { slots: Slot[]; value: string | null; onChange: (s: string) => void; loading?: boolean; empty?: string | null }) {
  return <View>
    <Eyebrow kind="label" style={styles.label}>Free times (IST)</Eyebrow>
    {loading ? <View style={styles.grid}>{[0, 1, 2, 3].map((i) => <View key={i} style={styles.cell}><Skeleton height={48} radius={fx.radius.xl} /></View>)}</View>
      : slots.length ? <View style={styles.grid} accessibilityRole="radiogroup">
        {slots.map((s, i) => <View key={s.startAt} style={styles.cell}><SlotTile at={s.startAt} index={i} selected={value === s.startAt} onPress={() => onChange(s.startAt)} /></View>)}
      </View>
        : empty ? <View style={styles.none}><Icon name="calendar" size={16} color={fx.ink.a40} /><T v="bodySm" color={fx.ink.a60} style={styles.flex}>{empty}</T></View> : null}
  </View>;
}

function SlotTile({ at, index, selected, onPress }: { at: string; index: number; selected: boolean; onPress: () => void }) {
  const { calm } = useFx();
  const press = usePress('chip');
  const p = useSharedValue(calm ? 1 : 0);
  useEffect(() => { if (!calm) p.value = withDelay(Math.min(index, 12) * 20, withSpring(1, spring.pop)); }, [calm, index, p]);
  // the choice: a pop from .94 and the red look mixing in (reduced motion: the colour alone)
  const mix = useStateMix(selected, S82.slotFillMs);
  const chosen = useSharedValue(1);
  const was = useRef(selected);
  useEffect(() => {
    if (selected && !was.current && !calm) { chosen.value = S82.slotFrom; chosen.value = withSpring(1, spring.pop); }
    was.current = selected;
  }, [selected, calm, chosen]);
  const pop = useAnimatedStyle(() => ({ opacity: Math.min(1, p.value * 1.4), transform: [{ scale: (0.9 + 0.1 * p.value) * chosen.value }] }));
  const { progress, to } = press;
  const tile = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(mix.value, [0, 1], [fx.fill.a05, fx.red.a10]),
    borderColor: interpolateColor(mix.value, [0, 1], [fx.line.a10, fx.red.brand]),
    transform: pressTransform(progress.value, to, 0, calm),
  }));
  const time = istTime(at);
  const fg = selected ? fx.red.label : fx.ink.white;
  return <Animated.View style={pop}>
    <AnimatedPressable
      accessibilityRole="radio"
      accessibilityLabel={`${time} IST`}
      accessibilityState={{ selected, checked: selected }}
      aria-checked={selected}
      onPress={() => { haptics.select(); onPress(); }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[styles.tile, tile]}>
      <Icon name="clock" size={15} color={selected ? fx.red.label : fx.ink.a40} />
      <T v="cardTitle" color={fg} style={styles.time}>{time}</T>
    </AnimatedPressable>
  </Animated.View>;
}

/** "Tue 3 Nov · 07:00" for a slot (IST). */
function slotWhen(at: string): string {
  const p = chipParts(istDay(at));
  return `${p.weekday.charAt(0)}${p.weekday.slice(1).toLowerCase()} ${p.day} ${p.month} · ${istTime(at)}`;
}

/** The live request button of Book a consultation (see the header). */
export function SlotCta({ slot, busy, disabled, onPress }: { slot: string | null; busy?: boolean; disabled?: boolean; onPress: () => void }) {
  const { calm, inHtml, tier } = useFx();
  const ready = !!slot && !disabled;
  const mix = useStateMix(ready, S82.ctaColourMs);
  const press = usePress('cta', 1);
  const pulse = useSharedValue(1);
  const title = slot ? `Request ${slotWhen(slot)}` : 'Request this slot';
  useEffect(() => {
    if (!slot || calm || inHtml || tier === 'C') return;
    const half = timing(S82.ctaPulseMs / 2, ease.cssInOut);
    pulse.value = withSequence(withTiming(S82.ctaPulse, half), withTiming(1, half));
  }, [slot, calm, inHtml, tier, pulse]);
  const { progress, to } = press;
  const box = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(mix.value, [0, 1], [fx.fill.a05, fx.red.brand]),
    transform: [...pressTransform(progress.value, to, 1, calm), { scale: pulse.value }],
  }));
  const glow = useAnimatedStyle(() => ({ opacity: mix.value }));
  return <AnimatedPressable
    {...PRESS_PROPS}
    accessibilityRole="button"
    accessibilityLabel={title}
    accessibilityState={{ disabled: !ready, busy: !!busy }}
    disabled={!ready || busy}
    onPress={() => { haptics.commit(); onPress(); }}
    onPressIn={press.onPressIn}
    onPressOut={press.onPressOut}
    style={[styles.cta, box]}>
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.ctaGlow, glow]} />
    <View style={[styles.ctaLabel, busy ? styles.hidden : null]}><LabelSwap text={title} ready={ready} /></View>
    {busy ? <View style={styles.busy}><RingSpinner color={fx.ink.white} track={fx.ink.a30} /></View> : null}
  </AnimatedPressable>;
}

/** The CTA's label: a new text rises 6 pt as it fades in while the old one fades out over it (200 ms). */
function LabelSwap({ text, ready }: { text: string; ready: boolean }) {
  const { calm, inHtml } = useFx();
  const colour = ready ? fx.ink.white : fx.ink.ink4;
  // each label keeps the colour it was drawn in (the old one leaves as it was)
  const [state, setState] = useState<{ cur: string; curColour: string; old: string | null; oldColour: string; n: number }>({ cur: text, curColour: colour, old: null, oldColour: colour, n: 0 });
  let shown = state;
  if (state.cur !== text) { shown = { cur: text, curColour: colour, old: state.cur, oldColour: state.curColour, n: state.n + 1 }; setState(shown); }
  else if (state.curColour !== colour) { shown = { ...state, curColour: colour }; setState(shown); }
  return <View style={styles.swap}>
    {shown.old ? <SwapLayer key={`o${shown.n}`} text={shown.old} colour={shown.oldColour} out still={calm || inHtml} onGone={() => setState((st) => ({ ...st, old: null }))} /> : null}
    <SwapLayer key={`c${shown.n}`} text={shown.cur} colour={shown.curColour} enter={shown.n > 0} still={calm || inHtml} />
  </View>;
}

function SwapLayer({ text, colour, out, enter, still, onGone }: { text: string; colour: string; out?: boolean; enter?: boolean; still: boolean; onGone?: () => void }) {
  const p = useSharedValue(out || !enter ? 1 : 0);
  const { calm } = useFx();
  useEffect(() => {
    if (out) {
      const end = setTimeout(() => onGone?.(), S82.ctaMs);
      p.value = still ? 0 : withTiming(0, calm ? calmFade() : timing(S82.ctaMs, ease.css));
      return () => clearTimeout(end);
    }
    if (enter) p.value = still ? 1 : withTiming(1, calm ? calmFade() : timing(S82.ctaMs, ease.expo));
    // once, at mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const a = useAnimatedStyle(() => (out
    ? { opacity: p.value, transform: [] }
    : { opacity: p.value, transform: calm || still ? [] : [{ translateY: S82.ctaY * (1 - p.value) }] }));
  return <Animated.View style={[out ? styles.swapOut : null, a]} pointerEvents="none" {...(out ? { 'aria-hidden': true } : null)}>
    <T v="button" color={colour} numberOfLines={1} center>{text}</T>
  </Animated.View>;
}

const styles = StyleSheet.create({
  label: { marginBottom: 12 },
  dates: { gap: 8, paddingRight: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5 },
  cell: { width: '50%', padding: 5 },
  tile: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, minHeight: 48, borderRadius: fx.radius.xl, borderWidth: 1 },
  cta: { borderRadius: 12, paddingVertical: 16, paddingHorizontal: 20, minHeight: 44, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' },
  ctaGlow: { borderRadius: 12, boxShadow: fx.shadow.ctaAuth, backgroundColor: fx.premium.transparent },
  ctaLabel: { alignSelf: 'stretch' },
  hidden: { opacity: 0 },
  busy: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  swap: { alignSelf: 'stretch' },
  swapOut: { position: 'absolute', left: 0, right: 0, top: 0 },
  time: { fontSize: 15, lineHeight: 22 },
  none: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: fx.radius.xl, borderWidth: 1, borderStyle: 'dashed', borderColor: fx.line.a15 },
  flex: { flex: 1 },
});
