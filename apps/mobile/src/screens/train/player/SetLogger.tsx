/* Set-by-set logging inside the player (Bioptime's logging in the earlier app's option-row look, GAP_MAP §4.5):
   - one card per exercise: its number, name and prescription, the sets ticked so far, then a row per set: the tick
     (a checkbox, "Set 2 of 3, done"), then reps, seconds and load in mono inputs, as the coach prescribed them (load in
     the device's unit, sent in kg). The card of the exercise on screen in the player has a red edge; tapping a card's
     head brings its exercise to the player;
   - the rest timer: the 144 pt ring counting down the item's rest; it starts when a set is ticked (or from its button)
     and buzzes once at 0. Timed exercises also get a work countdown on the same ring. Ticking stays the member's own act.
   Motion v2 (The Set, M73, and the rest timer, M70):
   - a tick sweeps: the row's red/10 fill moves in from the checkbox side (translateX of a full-width fill inside the
     row's rounded clip, 240 ms expo) while its border turns red (one shared value, colour over 200 ms); an untick runs
     back in 140 ms. A 2 pt hairline along the card's top fills to ticked/total (300 ms expo) and the 'n/3' and the
     screen's 'x of y sets ticked' roll their digits in the direction of change. When an exercise's last set is ticked
     its number becomes a green check (CheckPop) and the hairline flashes green once. Light haptic per tick, success on
     an exercise's last set. Tier C: colours only; reduced motion: 150 ms crossfades;
   - the timer counts in its own block: only its clock renders each second (two text layers kept mounted, rolled on
     one shared value: old up 8, new from below, 150 ms expo); the ring runs one linear clock to `endAt` on the UI
     thread and renders again only at 0. It opens with its ring fading and growing from .92 (300 ms expo) while the
     cards below glide to their new place, and a log that commits closes it (a t.swapOut fade). One success haptic at
     0. Tier C: no scale or roll; reduced motion: digits change in place. Screen readers hear it three times (its start,
     10 s before the end, the end), on the web through a visually hidden polite live region.
   The cards are memoised: ticking one set renders that card only, and a set row renders only when its tick, reps,
   seconds or load change. */
import React, { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Button, CheckBox, CheckPop, GlassCard, Input, T, TimerRing, calmFade, doneOnce, ease, fx, haptics, motionValues, t, timing, useFx } from '@/fx';
import { FitText } from '@/fx/wordFit';
import { touchSlopY, useStateMix } from '@/fx/press';
import { Roll, useChangeDir } from '../motion';
import { mmss, prescription, secs, type SessionItem, type WeightUnit } from '../shared';
import { useOverlayScroll } from './MorphOverlay';

const S = motionValues.screens;

export type SetRow = { done: boolean; reps: string; seconds: string; load: string };
/** A running rest or work countdown: it ends at `endAt` (epoch ms). `closing`: a log committed, so it fades out
 *  (t.swapOut) and then goes. */
export type Timer = { itemId: string; kind: 'rest' | 'work'; total: number; endAt: number; closing?: boolean };

/** The planned rep count, for prefilling: a plain number ("10") or one with words after it ("16 in total", "10 each
 *  side"); a distance ("20 m"), a time ("30 s") or a range ("8-10") is not a rep count. */
export const plannedReps = (reps?: string | null): string => {
  const m = /^(\d+)(?:\s+([a-z].*))?$/i.exec((reps ?? '').trim());
  return m && !(m[2] && NOT_REPS.test(m[2])) ? m[1] : '';
};
/** A distance prescription ("20 m", "1.5 km"): the set row shows it in place of a reps field (the log has no distance;
 *  a reps field asked for a number that is not there). */
export function plannedDistance(reps?: string | null): { value: string; unit: string } | null {
  const m = /^(\d+(?:[.,]\d+)?)\s*(m|km)$/i.exec((reps ?? '').trim());
  return m ? { value: m[1], unit: m[2].toLowerCase() } : null;
}
/** Words after a number that make it a distance or a time, not reps. */
const NOT_REPS = /^(m|km|metres?|meters?|kilometres?|kilometers?|s|secs?|seconds?|min|mins|minutes?)$/i;

type CardProps = {
  item: SessionItem; index: number; current: boolean; rows: SetRow[]; open: boolean; unit: WeightUnit;
  /** This card's countdown (null when it has none). */
  timer: Timer | null;
  onRow: (itemId: string, k: number, patch: Partial<SetRow>) => void; onSelect: (index: number) => void;
  onTimer: (itemId: string, kind: 'rest' | 'work') => void; onStopTimer: () => void;
  /** A countdown opened in this card (its block, to bring into view above the footer); returns a cancel, run when the
   *  countdown restarts, closes or goes. */
  onTimerShown?: (node: unknown) => (() => void) | void;
  /** A rest of this card ran out (seen counting): the screen points to the next set. */
  onRestDone?: (itemId: string) => void;
  /** The set of this card to point to (`n` changes for each new pulse), or null. */
  pulse?: { k: number; n: number } | null;
};

export const SetCard = memo(function SetCard({ item, index, current, rows, open, unit, timer, onRow, onSelect, onTimer, onStopTimer, onTimerShown, onRestDone, pulse }: CardProps) {
  const ticked = rows.filter((r) => r.done).length;
  const n = rows.length;
  const allDone = n > 0 && ticked === n;
  const up = useChangeDir(ticked);
  const detail = [prescription(item), item.restSeconds ? `rest ${secs(item.restSeconds)}` : null, item.loadNote || null].filter(Boolean).join(' · ');
  return <GlassCard padding={16} borderColor={current ? fx.red.a30 : undefined} style={styles.card}>
    <Hairline share={n ? ticked / n : 0} complete={allDone} />
    <Pressable accessibilityRole="button" accessibilityLabel={`${item.exerciseName}: show it in the player`} accessibilityState={{ selected: current }} onPress={() => onSelect(index)} style={styles.head}>
      <View style={[styles.num, current ? styles.numOn : null]}>
        <T v="mono12" color={current ? fx.ink.white : fx.ink.a60}>{String(index + 1)}</T>
        <CheckPop checked={allDone} size={28} color={fx.status.optimal} style={styles.numCheck} />
      </View>
      <View style={styles.flex}>
        {item.block ? <T v="label" color={fx.ink.a50}>{item.block}</T> : null}
        <FitText v="cardTitle" numberOfLines={2}>{item.exerciseName}</FitText>
        <T v="caption" color={fx.ink.a60}>{detail}</T>
      </View>
      <Roll value={`${ticked}/${n}`} up={up} distance={S.m73.digitRoll} ms={S.m73.digitMs}>
        <T v="mono12" color={allDone ? fx.hue.green400 : fx.ink.a50} accessibilityLabel={`${ticked} of ${n} sets ticked`}>{`${ticked}/${n}`}</T>
      </Roll>
    </Pressable>
    {item.note ? <T v="bodySm" color={fx.ink.a60}>{item.note}</T> : null}
    {rows.map((r, k) => <SetLine key={k} item={item} k={k} n={n} row={r} open={open} unit={unit}
      last={!r.done && ticked === n - 1} pulse={pulse && pulse.k === k ? pulse.n : 0} onRow={onRow} />)}
    {timer ? <TimerBlock timer={timer} onStop={onStopTimer} onAgain={() => onTimer(item.id, timer.kind)} onShown={onTimerShown}
      onRestDone={onRestDone ? () => onRestDone(item.id) : undefined} />
      : open && (item.restSeconds || item.durationSeconds) ? <View style={styles.timerButtons}>
        {item.durationSeconds ? <Button title={`Start ${secs(item.durationSeconds)}`} icon="play" variant="ghost" onPress={() => onTimer(item.id, 'work')} /> : null}
        {item.restSeconds ? <Button title={`Rest ${secs(item.restSeconds)}`} icon="timer" variant="ghost" onPress={() => onTimer(item.id, 'rest')} /> : null}
      </View> : null}
  </GlassCard>;
});

/** The 2 pt progress hairline along the card's top: a full-width fill moved by translateX inside its clipped track;
 *  it flashes green once when the exercise's last set is ticked. */
function Hairline({ share, complete }: { share: number; complete: boolean }) {
  const { calm, tier } = useFx();
  const width = useSharedValue(0);
  const p = useSharedValue(share);
  const flash = useSharedValue(0);
  const lastShare = useRef(share);
  const lastComplete = useRef(complete);
  useEffect(() => {
    const prev = lastShare.current;
    lastShare.current = share;
    if (prev === share) return;
    p.value = calm || tier === 'C' ? share : withTiming(share, timing(share > prev ? S.m73.hairlineMs : S.m73.untickMs));
  }, [share, calm, tier, p]);
  // the green flash: only for a completion seen here (a card that mounts complete does not flash)
  useEffect(() => {
    const was = lastComplete.current;
    lastComplete.current = complete;
    if (!complete) { flash.value = 0; return; }
    if (was) return;
    flash.value = 1;
    flash.value = withTiming(0, calm ? calmFade(S.m73.greenFlashMs) : timing(S.m73.greenFlashMs, ease.css));
  }, [complete, calm, flash]);
  const fill = useAnimatedStyle(() => ({ transform: [{ translateX: -(1 - p.value) * width.value }] }));
  const green = useAnimatedStyle(() => ({ opacity: flash.value }));
  const onLayout = (e: LayoutChangeEvent) => { const w = e.nativeEvent.layout.width; if (w > 0) width.value = w; };
  return <View pointerEvents="none" onLayout={onLayout} style={styles.hairline} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Animated.View style={[StyleSheet.absoluteFill, styles.hairFill, fill]}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.hairGreen, green]} />
    </Animated.View>
  </View>;
}

type LineProps = {
  item: SessionItem; k: number; n: number; row: SetRow; open: boolean; unit: WeightUnit;
  /** Ticking this one completes the exercise. */
  last: boolean;
  /** Changes when a rest has run out and this is the next set: one red glow pulse (0: none). */
  pulse: number;
  onRow: (itemId: string, k: number, patch: Partial<SetRow>) => void;
};
/** A set row renders again only when what it shows changes (its tick, reps, seconds, load), not when a log refills
 *  the rows with equal values (M70 fix round). */
const sameLine = (a: LineProps, b: LineProps) => a.item.id === b.item.id && a.k === b.k && a.n === b.n && a.open === b.open && a.unit === b.unit && a.last === b.last && a.pulse === b.pulse
  && a.onRow === b.onRow && a.row.done === b.row.done && a.row.reps === b.row.reps && a.row.seconds === b.row.seconds && a.row.load === b.row.load;
const SetLine = memo(function SetLine({ item, k, n, row, open, unit, last, pulse, onRow }: LineProps) {
  const { calm, tier } = useFx();
  const colourOnly = calm || tier === 'C';
  // the rest ran out and this is the next set: one red glow (in over m60.glowMs / 2, out over m60.glowMs; an opacity
  // only, so tier C is the same; reduced motion: none, the 'Rest done' words say it)
  const point = useSharedValue(0);
  useEffect(() => {
    if (!pulse || calm || row.done) return;
    point.set(withSequence(withTiming(1, timing(S.m60.glowMs / 2, ease.css)), withTiming(0, timing(S.m60.glowMs * 2, ease.css))));
  }, [pulse]); // eslint-disable-line react-hooks/exhaustive-deps
  const pointStyle = useAnimatedStyle(() => ({ opacity: point.get() }));
  const mix = useStateMix(row.done, row.done ? S.m73.colourMs : S.m73.untickMs);
  const sweep = useSharedValue(row.done ? 1 : 0);
  const width = useSharedValue(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (colourOnly) { sweep.value = row.done ? 1 : 0; return; }
    sweep.value = withTiming(row.done ? 1 : 0, timing(row.done ? S.m73.sweepMs : S.m73.untickMs));
  }, [row.done, colourOnly, sweep]);
  const toggle = () => {
    if (!open) return;
    const done = !row.done;
    if (done && last) haptics.success(); else haptics.light();
    onRow(item.id, k, done && item.reps && !row.reps && plannedReps(item.reps) ? { done, reps: plannedReps(item.reps) } : { done });
  };
  const edge = useAnimatedStyle(() => {
    const m = mix.value;
    return colourOnly
      ? { borderColor: interpolateColor(m, [0, 1], [fx.line.a10, fx.red.brand]), backgroundColor: interpolateColor(m, [0, 1], [fx.fill.a04, fx.red.a10]) }
      : { borderColor: interpolateColor(m, [0, 1], [fx.line.a10, fx.red.brand]) };
  }, [colourOnly]);
  const fill = useAnimatedStyle(() => ({ transform: [{ translateX: -(1 - sweep.value) * width.value }] }));
  const glow = useAnimatedStyle(() => ({ opacity: mix.value }));
  const onLayout = (e: LayoutChangeEvent) => { const w = e.nativeEvent.layout.width; if (w > 0) width.value = w; };
  const setNo = k + 1;
  const distance = plannedDistance(item.reps);
  return <View style={styles.setWrap}>
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.setGlow, glow]} />
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.setPoint, pointStyle]} />
    <Animated.View onLayout={onLayout} style={[styles.set, edge]}>
      {colourOnly ? null : <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.sweep, fill]} />}
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: row.done, disabled: !open }}
        aria-checked={row.done}
        accessibilityLabel={`Set ${setNo} of ${n}${row.done ? ', done' : ''}`}
        disabled={!open}
        onPress={toggle}
        hitSlop={TICK_SLOP}
        style={styles.tick}>
        <CheckBox checked={row.done} />
      </Pressable>
      <T v="micro" color={row.done ? fx.red.label : fx.ink.a50} numberOfLines={1} style={styles.setLabel}>{`Set ${setNo}`}</T>
      <View style={styles.cells}>
        {distance ? <Fixed label={`Set ${setNo}: ${distance.value} ${distance.unit}, as prescribed`} value={distance.value} unit={distance.unit} />
          : item.reps ? <Cell label={`Set ${setNo} reps`} unit="reps" value={row.reps} placeholder={plannedReps(item.reps) || '–'} open={open} pad="number-pad" onChange={(v) => onRow(item.id, k, { reps: v })} /> : null}
        {item.durationSeconds ? <Cell label={`Set ${setNo} seconds`} unit="sec" value={row.seconds} placeholder={String(item.durationSeconds)} open={open} pad="number-pad" onChange={(v) => onRow(item.id, k, { seconds: v })} /> : null}
        {item.reps ? <Cell label={`Set ${setNo} load in ${unit}, optional`} unit={unit} value={row.load} placeholder="–" open={open} pad="decimal-pad" onChange={(v) => onRow(item.id, k, { load: v })} /> : null}
      </View>
    </Animated.View>
  </View>;
}, sameLine);

/** A prescription the log has no field for (a distance): the planned value, in the cells' place and type, not editable. */
function Fixed({ label, value, unit }: { label: string; value: string; unit: string }) {
  return <View style={styles.cell} accessible accessibilityLabel={label}>
    <View style={styles.fixed}><T v="mono14" color={fx.ink.a70}>{value}</T></View>
    <T v="micro" color={fx.ink.a60} center>{unit}</T>
  </View>;
}

function Cell({ label, unit, value, placeholder, open, pad, onChange }: { label: string; unit: string; value: string; placeholder?: string; open: boolean; pad: 'number-pad' | 'decimal-pad'; onChange: (v: string) => void }) {
  const { follow } = useOverlayScroll(); // the keyboard keeps this field in view while it is typed in
  return <View style={styles.cell}>
    {/* the field's digits grow with the text size up to 1.4× (as the ring values cap theirs): '47.5' stays whole in the
        96 pt cell at text 2.0 on a 320 dp phone ('‹7.5', SWA-15) */}
    <Input label={label} size="sheet" mono keyboardType={pad} value={value} placeholder={placeholder} editable={open} onChangeText={onChange} onFocus={() => follow('number')} style={styles.input} maxFontSizeMultiplier={1.4} />
    <T v="micro" color={fx.ink.a60} center>{unit}</T>
  </View>;
}

/** Whole seconds left until `endAt`, rendered once a second (on each second's boundary); `onZero` once at 0 (only
 *  when it was seen counting in this mount). */
function useCountdown(endAt: number, onZero: (seen: boolean) => void): number {
  const leftAt = () => Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
  const [left, setLeft] = useState(leftAt);
  const zero = useRef(onZero);
  zero.current = onZero;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false; // seen counting in this mount: only then does reaching 0 buzz
    const tick = () => {
      const now = Date.now();
      const l = Math.max(0, Math.ceil((endAt - now) / 1000));
      setLeft(l);
      if (l <= 0) { zero.current(running); return; }
      running = true;
      // the next boundary, when the shown second changes
      timer = setTimeout(tick, Math.max(1, (endAt - now) - (l - 1) * 1000));
    };
    tick();
    return () => { if (timer) clearTimeout(timer); };
  }, [endAt]);
  return left;
}

/** The rest or work block. Only its clock renders each second (Clock, below): the ring runs one linear clock to
 *  `endAt` on the UI thread and renders again once, at 0. It opens with the ring fading and growing from .92; a log
 *  that commits closes it (a t.swapOut fade, then `onStop`). */
function TimerBlock({ timer, onStop, onAgain, onShown, onRestDone }: {
  timer: Timer; onStop: () => void; onAgain: () => void; onShown?: (node: unknown) => (() => void) | void; onRestDone?: () => void;
}) {
  const { calm, tier, inHtml } = useFx();
  const [done, setDone] = useState(() => timer.endAt <= Date.now());
  // a restart (a new end) counts again in the same block
  const endRef = useRef(timer.endAt);
  if (endRef.current !== timer.endAt) { endRef.current = timer.endAt; if (done && timer.endAt > Date.now()) setDone(false); }
  const what = timer.kind === 'rest' ? 'Rest' : 'Work';
  // what screen readers are told: native speaks it (announceForAccessibility); react-native-web's announce does nothing,
  // so the web writes it into a visually hidden polite live region instead (Said, below; keyed, so the same sentence
  // again is announced again)
  const [said, setSaid] = useState<{ text: string; n: number }>({ text: '', n: 0 });
  const announce = useCallback((text: string) => {
    if (Platform.OS === 'web') setSaid((p) => ({ text, n: p.n + 1 }));
    else AccessibilityInfo.announceForAccessibility(text);
  }, []);
  const restDone = useRef(onRestDone);
  restDone.current = onRestDone;
  const onZero = useCallback((seen: boolean) => {
    setDone(true);
    if (!seen) return;
    haptics.success();
    announce(`${what} done`);
    restDone.current?.();
  }, [what, announce]);
  // screen readers hear the countdown three times, never each second (the digits are not announced, and the only live
  // region, the web's, changes with these three sentences alone: the accessibility tree stays still while it counts):
  // at its start, 10 s before the end, and at 0 (onZero)
  useEffect(() => {
    const left = timer.endAt - Date.now();
    if (timer.closing || left <= 0) return;
    announce(`${what} timer started: ${secs(Math.round(left / 1000))}`);
    if (left <= WARN_MS + 1000) return;
    const warn = setTimeout(() => announce(`${WARN_MS / 1000} seconds left`), left - WARN_MS);
    return () => clearTimeout(warn);
  }, [timer.endAt, timer.closing, what, announce]);
  // a countdown that starts is brought into view (it opens under the card's sets, often under the player's footer);
  // the screen decides when (see PlayerScreen's revealTimer), and a restart, a close or the block going cancels it
  const box = useRef<React.ComponentRef<typeof View>>(null);
  const shownRef = useRef(onShown);
  shownRef.current = onShown;
  useEffect(() => {
    if (timer.closing) return;
    let cancel: (() => void) | void;
    const raf = requestAnimationFrame(() => { cancel = shownRef.current?.(box.current); });
    return () => { cancelAnimationFrame(raf); cancel?.(); };
  }, [timer.endAt, timer.closing]); // eslint-disable-line react-hooks/exhaustive-deps
  // the ring opens: opacity and .92 → 1 (tier C: opacity only; reduced motion: a 150 ms fade)
  const plain = calm || inHtml || tier === 'C';
  const shown = useSharedValue(inHtml ? 1 : 0);
  useEffect(() => {
    if (inHtml) return;
    shown.value = withTiming(1, calm ? calmFade() : tier === 'C' ? timing(S.m70.ringMs, ease.linear) : timing(S.m70.ringMs));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // closing: it fades out where it is, then goes (the cards below then glide up)
  const stopRef = useRef(onStop);
  stopRef.current = onStop;
  useEffect(() => {
    if (!timer.closing) return;
    const ms = calm ? t.calm : t.swapOut;
    const gone = doneOnce(() => stopRef.current(), ms + motionValues.overlay.fallbackExtra);
    const end = (f?: boolean) => { 'worklet'; if (f) scheduleOnRN(gone.done); };
    shown.value = withTiming(0, calm ? calmFade() : timing(ms, ease.linear), end);
    return () => gone.cancel();
  }, [timer.closing]); // eslint-disable-line react-hooks/exhaustive-deps
  const from = S.m70.ringFrom;
  const closing = !!timer.closing;
  const enter = useAnimatedStyle(() => {
    const v = shown.value;
    if (v >= 1) return { opacity: 1, transform: [] };
    return plain || closing ? { opacity: v, transform: [] } : { opacity: v, transform: [{ scale: from + (1 - from) * v }] };
  }, [closing]);
  const inert = closing ? { pointerEvents: 'none' as const, accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const } : null;
  return <Animated.View ref={box} collapsable={false} style={[styles.timer, enter]} {...inert}>
    <TimerRing remaining={done ? 0 : timer.total} total={timer.total} running={!done} endAt={done ? null : timer.endAt} accessibilityLabel={done ? `${what} done` : `${what} timer, ${secs(timer.total)}`}>
      <View style={styles.ringText}>
        <Clock endAt={timer.endAt} roll={!plain} onZero={onZero} />
        <T v="micro" color={done ? fx.hue.green400 : fx.ink.a50}>{done ? `${what} done` : timer.kind === 'rest' ? 'Rest left' : 'Time left'}</T>
      </View>
    </TimerRing>
    <View style={styles.timerButtons}>
      <Button title={done ? 'Again' : 'Restart'} icon="rotate-ccw" variant="ghost" onPress={onAgain} />
      <Button title={done ? 'Close' : 'Stop'} variant="ghost" onPress={onStop} />
    </View>
    {Platform.OS === 'web' ? <View accessibilityLiveRegion="polite" style={styles.said}>
      <T key={said.n} v="caption" color={fx.premium.transparent}>{said.text}</T>
    </View> : null}
  </Animated.View>;
}

/** The mono digits, the only thing that renders each second. Two text layers stay mounted: on each second the old
 *  one rolls up S.m70.digitRoll and out while the new one comes from below (S.m70.digitMs expo), on one shared value.
 *  The last step lands at once, so 00:00 shows in the frame the label says the rest is done. `roll` false (tier C,
 *  reduced motion): the digits change in place. Not announced (the block announces its start, 10 s and the end). */
const Clock = memo(function Clock({ endAt, roll, onZero }: { endAt: number; roll: boolean; onZero: (seen: boolean) => void }) {
  const left = useCountdown(endAt, onZero);
  const text = mmss(left);
  const [pair, setPair] = useState<{ now: string; was: string | null; n: number }>({ now: text, was: null, n: 0 });
  if (pair.now !== text) setPair({ now: text, was: pair.now, n: pair.n + 1 });
  const p = useSharedValue(1);
  const zero = left <= 0;
  // a layout effect: the roll starts before the new digits are painted (from a passive effect the new digits showed
  // for one frame at rest, then the old ones came back and rolled out)
  useLayoutEffect(() => {
    if (!pair.n || !roll || zero) { p.set(1); return; }
    p.set(0);
    p.set(withTiming(1, timing(S.m70.digitMs)));
  }, [pair.n, roll, zero, p]);
  const D = S.m70.digitRoll;
  const inStyle = useAnimatedStyle(() => (p.get() >= 1 ? { opacity: 1, transform: [] } : { opacity: p.get(), transform: [{ translateY: D * (1 - p.get()) }] }));
  const outStyle = useAnimatedStyle(() => ({ opacity: 1 - p.get(), transform: [{ translateY: -D * p.get() }] }));
  return <View style={styles.clock} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
    {roll ? <Animated.View pointerEvents="none" style={[styles.clockOut, outStyle]}>
      <T v="metric24">{pair.was ?? ''}</T>
    </Animated.View> : null}
    <Animated.View style={inStyle}><T v="metric24">{pair.now}</T></Animated.View>
  </View>;
});
/** The countdown's spoken warning before its end. */
const WARN_MS = 10_000;

/** The set tick's drawn box (its checkbox's), and its reach on every side so it takes a touch motionValues.touch.min
 *  (44 pt) square, 48 dp on Android (UX-07): native hitSlop, inside the row's 12 pt side and 10 pt top and bottom
 *  padding (a parent's bounds clip a native hitSlop), and short of 'Set n' and the first field, 10 pt and more to its
 *  right. Nothing it draws moves. RN-web ignores hitSlop. */
const TICK = 28;
const TICK_SLOP = touchSlopY(TICK);

const styles = StyleSheet.create({
  card: { gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  num: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: fx.line.a10, backgroundColor: fx.fill.a05, alignItems: 'center', justifyContent: 'center' },
  numOn: { backgroundColor: fx.red.brand, borderColor: fx.red.brand },
  numCheck: { position: 'absolute', top: -1, left: -1 },
  flex: { flex: 1, gap: 2 },
  hairline: { position: 'absolute', top: 0, left: fx.radius.card, right: fx.radius.card, height: 2, borderRadius: 1, overflow: 'hidden', backgroundColor: fx.line.a05 },
  hairFill: { backgroundColor: fx.red.brand },
  hairGreen: { backgroundColor: fx.status.optimal },
  setWrap: { borderRadius: fx.radius.card },
  setGlow: { borderRadius: fx.radius.card, boxShadow: fx.shadow.option, backgroundColor: fx.premium.transparent },
  setPoint: { borderRadius: fx.radius.card, borderWidth: 1, borderColor: fx.red.a60, boxShadow: fx.shadow.fab, backgroundColor: fx.premium.transparent },
  set: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: fx.radius.card, borderWidth: 1, overflow: 'hidden', backgroundColor: fx.fill.a04, borderColor: fx.line.a10 },
  sweep: { backgroundColor: fx.red.a10 },
  tick: { minWidth: TICK, minHeight: TICK, alignItems: 'center', justifyContent: 'center' },
  // at least the 34 pt column, wider where the font needs it ('SET 2' broke over two lines on Android)
  setLabel: { minWidth: 34 },
  cells: { flex: 1, flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  cell: { flex: 1, maxWidth: 96, gap: 2 },
  input: { textAlign: 'center', paddingHorizontal: 4, paddingVertical: 8, minHeight: 40 },
  fixed: { minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  timer: { alignItems: 'center', gap: 12, paddingTop: 6 },
  ringText: { alignItems: 'center', gap: 2 },
  clock: { overflow: 'hidden', alignItems: 'center' },
  clockOut: { position: 'absolute', left: 0, right: 0, top: 0, alignItems: 'center' },
  timerButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  // the web's live region: read by screen readers, never seen (a 1 pt clip, transparent words)
  said: { position: 'absolute', left: 0, top: 0, width: 1, height: 1, overflow: 'hidden' },
});
