/* A number that counts up to its value (PREMIUM §1.4 "Count-ups", CRITIQUE §29).
   - Real values only: `null` shows "—" and never animates.
   - Duration by tier: A `duration` (1200; the Wellness Score passes its own), B 1200, C 600; calm and the pre-rendered
     web HTML show the final value at once. A later change counts from the old value over 600 ms ease.expo.
   - When it starts: an explicit `start` holds it at the start value until true; without one, inside a Reveal it starts
     120 ms after the card's entrance begins (+ 60 ms per grid index: Reveal's useDataStart), outside one at once. Every
     start waits for the page to be active, so a pre-mounted page never shows a final value before it counts.
   - `progress` (a 0..1 shared value the caller drives, the same one its ring gets): the digits are
     round(from + p × (value − from)) on the caller's clock, so the number and the arc never drift apart; the pop fires
     when it lands (95 %).
   - No React render per frame: native writes an animated non-editable TextInput on the UI thread while counting (a
     plain Text before and after; the wrapper carries the label and value for screen readers); the web writes the text
     node of its Text from a reaction and React reconciles once at the end (innerText always holds a number, as E2E reads
     it). A throttled 20 Hz state path stands behind one switch (NATIVE_DIGITS) for a device that drops TextInput updates.
   - Formatting: integers use en-IN grouping (1,23,456), decimals keep their places (7.2 stays 7.2).
   - The accessibility label is the final value from the first frame. Do not nest it in a Text: put a number and its
     words side by side as siblings.
   `pop` gives the Wellness Score's pop on each change (opacity .6 → 1, scale .92 → 1, 120 ms).
   `seenKey`: once this key has counted in this run, a later mount (a revisit) shows the value at rest, and a changed
   value counts from the one shown last over 600 ms (src/fx/motion/seen); the value is recorded when the count actually
   starts on an active page. `delta`: a changed value also shows a small chip with the change ('+0.2 h', '−0.4 kg'),
   rising in, then fading after 2.4 s. `honest`: a health value seen for the first time is never counted up from zero:
   it appears final with the pop. */
import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, useAnimatedProps, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withDelay, withSequence, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { fx } from '@/theme';
import { FONTS } from '@/fx/type';
import { markSeen, seenValue } from './seen';
import { calmFade, ease, motionValues, t, timing } from './tokens';
import { useMotion } from './tier';
import { useDataStart } from './Reveal';

const AnimatedInput = Animated.createAnimatedComponent(TextInput);

/** How native draws the digits while counting: 'input' (an animated TextInput written on the UI thread) or 'state'
 *  (a Text re-rendered at motionValues.count.fallbackHz), the fallback for a device whose TextInput misses updates. */
const NATIVE_DIGITS: 'input' | 'state' = 'input';

/** en-IN grouping for the integer part; `decimals` fixed places. Worklet, so the UI thread formats the same way. */
export function formatCount(value: number, decimals = 0): string {
  'worklet';
  const neg = value < 0;
  const fixed = Math.abs(value).toFixed(decimals);
  const dot = fixed.indexOf('.');
  const int = dot < 0 ? fixed : fixed.slice(0, dot);
  const frac = dot < 0 ? '' : fixed.slice(dot);
  let grouped = int;
  if (int.length > 3) {
    const head = int.slice(0, int.length - 3);
    const tail = int.slice(int.length - 3);
    let h = '';
    for (let i = head.length; i > 0; i -= 2) h = head.slice(Math.max(0, i - 2), i) + (h ? ',' + h : '');
    grouped = h + ',' + tail;
  }
  return (neg ? '-' : '') + grouped + frac;
}

export type CountUpProps = {
  value: number | null;
  decimals?: number;
  /** Tier-A duration in ms (default 1200; the Wellness Score 1800). */
  duration?: number;
  /** Counting starts when true; left out, it follows the nearest Reveal (or starts at once outside one). */
  start?: boolean;
  /** Start value of the first count (default 0). */
  from?: number;
  /** Pop on each change (the Wellness Score number). */
  pop?: boolean;
  style?: StyleProp<TextStyle>;
  /** Layout passthrough for the pop wrapper. */
  wrapStyle?: StyleProp<ViewStyle>;
  maxFontSizeMultiplier?: number;
  /** Spoken label; default the formatted final value. */
  accessibilityLabel?: string;
  testID?: string;
  /** Show at rest on a revisit: a key naming this number (e.g. 'home.score'); see the header. */
  seenKey?: string;
  /** The caller's 0..1 clock (one clock with its ring): the digits follow it instead of their own count. */
  progress?: SharedValue<number>;
  /** A chip with the change from the last seen value ('+0.2 h'); lowerIsBetter colours a fall as the better move. */
  delta?: boolean | { lowerIsBetter?: boolean; unit?: string; decimals?: number };
  /** A health value seen for the first time appears final with the pop instead of counting from zero. */
  honest?: boolean;
  /** On a phone, the number stays on one line and shrinks (to this share of its size at most) to fit its box: a
   *  five-digit value in a narrow tile at a large text size broke across lines ('10,58' / '3', VA-6c). */
  fit?: number;
};

export function CountUp({ value, decimals = 0, duration = t.sweepM, start, from = 0, pop, style, wrapStyle,
  maxFontSizeMultiplier, accessibilityLabel, testID, seenKey, progress, delta, honest, fit }: CountUpProps) {
  const { tier, still } = useMotion();
  const web = Platform.OS === 'web';
  const firstDuration = still ? 0 : tier === 'A' ? duration : tier === 'B' ? t.sweepM : motionValues.screens.m64.countC;
  const finalText = value == null ? '—' : formatCount(value, decimals);
  const label = accessibilityLabel ?? finalText;
  const key = seenKey ? `count:${seenKey}` : undefined;
  const [prior] = useState(() => seenValue(key)); // read once, on mount
  const begin = prior ?? from;
  const atRest = still || value == null || prior === value;
  const empty = value == null;
  const honestFirst = !!honest && prior === undefined && !atRest;
  const fixed = atRest || honestFirst; // shows the final value from the first frame

  const n = useSharedValue(fixed ? (value ?? 0) : begin);
  const counted = useRef(prior !== undefined); // the first count has run (read in effects only)
  // the value whose count has finished (React then draws it as final); before that React draws the start value and the
  // digits in between are written without React (web: the text node; native: the TextInput while `inputOn`)
  const [doneFor, setDoneFor] = useState<number | null>(fixed ? value : null);
  const [inputOn, setInputOn] = useState(false);
  const [stateText, setStateText] = useState(formatCount(fixed ? (value ?? 0) : begin, decimals)); // native 'state' digits
  const popV = useSharedValue(honestFirst && !still ? 0 : 1);
  const honestPop = useSharedValue(honestFirst ? 1 : 0); // which pop curve: the honest one or the change one

  // the change chip: from the last seen value to this one
  const dOpts = typeof delta === 'object' ? delta : {};
  const change = delta && prior !== undefined && value != null && prior !== value ? value - prior : null;
  const chip = useSharedValue(0);
  const chipText = change == null ? '' : `${change > 0 ? '+' : '−'}${formatCount(Math.abs(change), dOpts.decimals ?? decimals)}${dOpts.unit ? ` ${dOpts.unit}` : ''}`;
  const better = change == null ? false : dOpts.lowerIsBetter ? change < 0 : change > 0;

  const remember = (v: number) => { markSeen(key, v); counted.current = true; };
  const counting = () => { if (!web) setInputOn(true); };
  const finish = (v: number) => { setDoneFor(v); setInputOn(false); };

  const { popMs, popOpacity, popScale, deltaMs, deltaHold, deltaRise } = motionValues.count;
  const ms = firstDuration;

  // the first start (own clock): on the UI thread, when the page is active and the card has landed
  const fired = useDataStart(start, undefined, !empty && !atRest && !progress, (wait) => {
    'worklet';
    scheduleOnRN(remember, value ?? 0);
    if (change != null) {
      const shown = withSequence(withTiming(1, timing(deltaMs, ease.expo)), withDelay(deltaHold, withTiming(0, timing(deltaMs, ease.expo))));
      chip.set(wait > 0 ? withDelay(wait, shown) : shown);
    }
    if (honestFirst) {
      const appear = withTiming(1, timing(popMs, ease.expo));
      popV.set(0);
      popV.set(wait > 0 ? withDelay(wait, appear) : appear);
      scheduleOnRN(finish, value ?? 0);
      return;
    }
    if (pop) {
      popV.set(0);
      const p = withTiming(1, timing(t.pop, ease.expo));
      popV.set(wait > 0 ? withDelay(wait, p) : p);
    }
    const length = prior !== undefined ? Math.min(t.change, ms || t.change) : ms;
    const easing = prior !== undefined ? ease.expo : ease.cubicOut;
    const to = value ?? 0;
    const anim = withTiming(to, timing(length, easing), (f) => {
      'worklet';
      if (f) scheduleOnRN(finish, to);
    });
    n.set(wait > 0 ? withDelay(wait, anim) : anim);
    scheduleOnRN(counting);
  });

  // later changes, once counted: from the number shown over 600 ms
  const last = useRef(value);
  useEffect(() => {
    if (last.current === value) return;
    last.current = value;
    if (value == null) { cancelAnimation(n); setInputOn(false); return; }
    if (progress) return;
    if (still) { n.set(value); markSeen(key, value); setDoneFor(value); setStateText(formatCount(value, decimals)); return; }
    if (fired.get() !== 1) {
      // the first real value has arrived (it was null): hold the start value (or, at rest or honest, the value itself)
      // until the start counts to it
      n.set(atRest || honestFirst ? value : begin);
      if (honestFirst) popV.set(0);
      return;
    }
    if (n.get() === value) { setDoneFor(value); return; }
    markSeen(key, value);
    if (pop) { popV.set(0); popV.set(withTiming(1, timing(t.pop, ease.expo))); }
    if (!web) setInputOn(true);
    const to = value;
    n.set(withTiming(to, timing(t.change, ease.expo), (f) => { 'worklet'; if (f) scheduleOnRN(finish, to); }));
    // a value change drives it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // the caller's clock: digits follow it; native shows the input while it moves; the pop fires on landing
  const landAt = motionValues.reveal.landAt;
  useAnimatedReaction(() => (progress ? progress.get() : -1), (p, was) => {
    if (p < 0 || empty || atRest) return;
    const prev = was == null || was < 0 ? 0 : was;
    if (p > 0 && prev <= 0) { scheduleOnRN(remember, value ?? 0); scheduleOnRN(counting); }
    if (pop && p >= landAt && prev < landAt) { popV.set(0); popV.set(withTiming(1, timing(t.pop, ease.expo))); }
    if (p >= 1 && prev < 1) scheduleOnRN(finish, value ?? 0);
  });

  const shownNum = useDerivedValue(() => {
    if (!progress || empty) return n.get();
    if (atRest) return value ?? 0;
    const k = Math.max(0, Math.min(1, progress.get()));
    return begin + k * ((value ?? 0) - begin);
  });

  // the web: write the digits into the Text's own text node (no React render per frame)
  const textRef = useRef<React.ComponentRef<typeof Text>>(null);
  const writeWeb = (txt: string) => {
    const el = textRef.current as unknown as { firstChild?: { nodeType: number; nodeValue: string | null } | null; textContent?: string } | null;
    if (!el) return;
    const node = el.firstChild;
    if (node && node.nodeType === 3) { if (node.nodeValue !== txt) node.nodeValue = txt; } else if (typeof el.textContent === 'string') el.textContent = txt;
  };
  const writeState = (txt: string) => { setStateText(txt); };
  const lastWrite = useSharedValue(0);
  const hz = motionValues.count.fallbackHz;
  const stateDigits = !web && NATIVE_DIGITS === 'state';
  useAnimatedReaction(() => formatCount(shownNum.get(), decimals), (txt, was) => {
    if (empty || txt === was) return;
    if (web) { scheduleOnRN(writeWeb, txt); return; }
    if (!stateDigits) return;
    const now = Date.now();
    if (now - lastWrite.get() < 1000 / hz && shownNum.get() !== (value ?? 0)) return;
    lastWrite.set(now);
    scheduleOnRN(writeState, txt);
  });

  const animatedProps = useAnimatedProps(() => {
    const text = formatCount(shownNum.get(), decimals);
    return { text, defaultValue: text } as unknown as Record<string, unknown>;
  });
  const popStyle = useAnimatedStyle(() => {
    const p = popV.get();
    if (p >= 1) return { opacity: 1, transform: [] };
    const o0 = honestPop.get() === 1 ? popOpacity : 0.6;
    const s0 = honestPop.get() === 1 ? popScale : 0.92;
    return { opacity: o0 + (1 - o0) * p, transform: [{ scale: s0 + (1 - s0) * p }] };
  });
  const chipStyle = useAnimatedStyle(() => {
    const c = chip.get();
    return { opacity: c, transform: [{ translateY: (1 - c) * deltaRise }] };
  });

  // the calm chip: a short crossfade in, the hold, a crossfade out
  useEffect(() => {
    if (!still || change == null) return;
    chip.set(withTiming(1, calmFade(t.calm)));
    const timer = setTimeout(() => { chip.set(withTiming(0, calmFade(t.calm))); }, deltaHold);
    return () => clearTimeout(timer);
    // shown once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const textOf = () => {
    if (value == null) return '—';
    if (atRest || honestFirst || doneFor === value) return finalText;
    if (stateDigits && inputOn) return stateText;
    return formatCount(doneFor ?? begin, decimals);
  };
  const body = inputOn && !web && !stateDigits
    ? <View accessible accessibilityLabel={label} accessibilityValue={{ text: finalText }} testID={testID}>
      <AnimatedInput
        editable={false}
        pointerEvents="none"
        accessible={false}
        importantForAccessibility="no"
        caretHidden
        underlineColorAndroid="transparent"
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        style={[styles.input, style, styles.inputTail]}
        animatedProps={animatedProps}
      />
    </View>
    : <Text ref={textRef} style={style} maxFontSizeMultiplier={maxFontSizeMultiplier} accessibilityLabel={label} testID={testID}
      {...(fit && !web ? { numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: fit } : null)}>{textOf()}</Text>;

  const chipNode = change != null
    ? <Animated.View pointerEvents="none" style={[styles.chip, chipStyle]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={[styles.chipText, { color: better ? fx.status.optimal : fx.red.brand }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>{chipText}</Text>
    </Animated.View>
    : null;
  if (!pop && !honestFirst && !chipNode) return body;
  return <Animated.View style={[wrapStyle, chipNode ? styles.withChip : null, popStyle]}>{body}{chipNode}</Animated.View>;
}

const styles = StyleSheet.create({
  input: { padding: 0, margin: 0, includeFontPadding: false, textAlignVertical: 'center' },
  inputTail: { padding: 0, fontVariant: ['tabular-nums'] },
  // the chip sits beside the number from the first frame (only its opacity and rise move), so nothing reflows
  withChip: { flexDirection: 'row', alignItems: 'center' },
  chip: { marginLeft: 6 },
  chipText: { fontFamily: FONTS.mono500, fontSize: 11, lineHeight: 14 },
});
