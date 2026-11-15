/* The quiz stepper (THEME §11.3, §11.13): the value in Bebas 96, the unit under it, a 64 pt minus (white/15 outline) and
   a 64 pt red plus with its glow, and a 128×6 bar for where the value sits in its range.
   - A press steps once the finger has stayed down 60 ms within 6 pt (or at the release of a quicker tap), never on a
     scroll: a press that a scroll or a swipe takes within 150 ms of its step rolls the value back, without a haptic.
   - Holding repeats after 350 ms, every 60 ms (stepper.repeat), and every 50 ms once held 1.5 s; the release after a hold steps no more.
   - The numeral rolls by direction in a masked box (+ enters from below, − from above, at full opacity; the old value
     leaves the other way as it fades, 140 ms expo); while held (repeats faster than 150 ms) it is a 6 pt roll and the
     old value goes at once: never a strobe.
   - At a limit, a press on the end button bumps the value 4 pt sideways with the limit haptic.
   Tier C: the roll without the bump. Reduced motion: the value swaps; the haptics are kept. Screen readers get an
   adjustable value with increment and decrement. */
import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { fx } from '@/theme';
import { IconButton } from './Button';
import { haptics } from './device/haptics';
import { motionValues, spring, springBar, t, timing, useFx } from './effects';
import { T } from './Text';

/** A web release (the click, and with it onPress, follows); anything else that ends a press (a scroll, a cancel) is not. */
const RELEASES = new Set(['touchend', 'mouseup', 'pointerup', 'keyup', 'click']);

type Hold = {
  dir: 1 | -1; x: number; y: number; at: number; moved: boolean; stepped: boolean; stepAt: number; before: number;
  repeated: boolean; pressed: boolean; outAt: number; arm?: ReturnType<typeof setTimeout>; next?: ReturnType<typeof setTimeout>;
};

/** How long after a release its onPress may still arrive (the web's click). */
const CLICK_WITHIN = 1000;

export function Stepper({ value, onChange, min, max, step = 1, unit, format, label }: {
  value: number; onChange: (v: number) => void; min: number; max: number; step?: number; unit: string; format?: (v: number) => string; label?: string;
}) {
  const { calm, tier } = useFx();
  const s = motionValues.stepper;
  const valueRef = useRef(value);
  valueRef.current = value;
  const hold = useRef<Hold | null>(null);
  const lastStep = useRef(0);
  const [roll, setRoll] = useState<{ dir: 1 | -1; held: boolean; n: number }>({ dir: 1, held: false, n: 0 });
  const bump = useSharedValue(0);
  const bar = useSharedValue((value - min) / Math.max(1, max - min));
  useEffect(() => { bar.value = calm ? (value - min) / Math.max(1, max - min) : withSpring((value - min) / Math.max(1, max - min), springBar); }, [value, min, max, calm, bar]);

  const set = (next: number, dir: 1 | -1, held: boolean) => {
    valueRef.current = next;
    setRoll((r) => ({ dir, held, n: r.n + 1 }));
    onChange(next);
  };
  /** One step in `dir`; at a limit, the bump and the limit haptic instead. `held`: a repeat of a hold. */
  const nudge = (dir: 1 | -1, held = false): boolean => {
    const next = Math.round((valueRef.current + dir * step) * 1000) / 1000;
    if (next < min || next > max) {
      haptics.limit();
      if (!calm && tier !== 'C') bump.value = withSequence(withTiming(s.bump * dir, timing(t.pop / 2)), withSpring(0, spring.bump));
      return false;
    }
    haptics.step();
    const now = Date.now();
    // a repeat faster than heldBelow rolls 6 pt at full opacity
    set(next, dir, held && now - lastStep.current < s.heldBelow);
    lastStep.current = now;
    return true;
  };
  const clear = (h: Hold | null) => { if (!h) return; if (h.arm) clearTimeout(h.arm); if (h.next) clearTimeout(h.next); h.arm = undefined; h.next = undefined; };
  const first = (h: Hold) => {
    if (h.stepped || h.moved) return;
    h.stepped = true;
    h.stepAt = Date.now();
    if (!nudge(h.dir)) h.stepAt = 0;
  };
  const repeat = (h: Hold) => {
    if (hold.current !== h || h.moved) return;
    h.repeated = true;
    if (!h.stepped) { h.stepped = true; h.stepAt = Date.now(); }
    if (!nudge(h.dir, true)) { clear(h); return; }
    h.next = setTimeout(() => repeat(h), Date.now() - h.at >= s.fastAfter ? s.fastRepeat : s.repeat);
  };
  const pressIn = (dir: 1 | -1) => (e: GestureResponderEvent) => {
    clear(hold.current);
    const h: Hold = { dir, x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, at: Date.now(), moved: false, stepped: false, stepAt: 0, before: valueRef.current, repeated: false, pressed: false, outAt: 0 };
    hold.current = h;
    h.arm = setTimeout(() => first(h), s.armMs);
    h.next = setTimeout(() => repeat(h), s.firstRepeat);
  };
  const pressMove = (e: GestureResponderEvent) => {
    const h = hold.current;
    if (!h || h.moved) return;
    if (Math.hypot(e.nativeEvent.pageX - h.x, e.nativeEvent.pageY - h.y) > s.armSlop) { h.moved = true; if (!h.repeated) clear(h); }
  };
  // a press that a scroll or swipe took (no onPress follows) within rollbackWithin of its step rolls back, silently
  const rollback = (h: Hold) => {
    if (h.pressed || h.repeated || !h.stepped || !h.stepAt) return;
    if (Date.now() - h.stepAt > s.rollbackWithin) return;
    if (valueRef.current !== h.before) set(h.before, h.dir === 1 ? -1 : 1, false);
  };
  const pressOut = (e: GestureResponderEvent) => {
    const h = hold.current;
    if (!h) return;
    clear(h);
    h.outAt = Date.now();
    const type = (e.nativeEvent as unknown as { type?: string }).type;
    if (Platform.OS === 'web') { if (h.moved || (type != null && !RELEASES.has(type))) rollback(h); }
    // native calls onPress in the same tick as onPressOut: a press with no onPress by the next tick was taken
    else setTimeout(() => rollback(h), 0);
  };
  const tap = (dir: 1 | -1) => {
    const h = hold.current;
    // the onPress of the press that is ending (once); anything else (a keyboard press) steps on its own
    if (h && h.dir === dir && !h.pressed && (h.outAt === 0 || Date.now() - h.outAt < CLICK_WITHIN)) {
      h.pressed = true;
      if (h.repeated) return; // the release after a hold is no step
      if (!h.stepped) first(h);
      return;
    }
    nudge(dir);
  };
  useEffect(() => () => clear(hold.current), []);
  const shift = useAnimatedStyle(() => (bump.value === 0 ? { transform: [] } : { transform: [{ translateX: bump.value }] }));
  // the range fill moves by translateX inside the rounded track (never a scaleX of a rounded shape)
  const fill = useAnimatedStyle(() => {
    const k = Math.max(0, Math.min(1, bar.value));
    return { transform: [{ translateX: -BAR_W * (1 - k) }] };
  });
  const shown = format ? format(value) : String(value);
  return <View style={styles.wrap}>
    <Animated.View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label ?? unit}
      accessibilityValue={{ min, max, now: value, text: `${shown} ${unit}` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => { nudge(e.nativeEvent.actionName === 'increment' ? 1 : -1); }}
      style={[styles.value, shift]}>
      <Numeral text={shown} roll={roll} calm={calm} />
      <T v="eyebrowStore" color={fx.ink.a60} style={styles.unit}>{unit}</T>
    </Animated.View>
    <View style={styles.track}><Animated.View style={[styles.fill, fill]} /></View>
    <View style={styles.buttons}>
      <IconButton kind="stepperMinus" icon="minus" label={`Decrease ${unit}`} style={value <= min ? styles.atLimit : null}
        onPress={() => tap(-1)} onPressIn={pressIn(-1)} onPressOut={pressOut} onPressMove={pressMove} />
      <IconButton kind="stepperPlus" icon="plus" label={`Increase ${unit}`} style={value >= max ? styles.atLimit : null}
        onPress={() => tap(1)} onPressIn={pressIn(1)} onPressOut={pressOut} onPressMove={pressMove} />
    </View>
  </View>;
}

const BAR_W = 128;

/** The value in a masked box: the new one rolls in from the side of the change while the old one leaves the other
 *  way. Held repeats roll 6 pt at full opacity (the old one goes at once). */
function Numeral({ text, roll, calm }: { text: string; roll: { dir: 1 | -1; held: boolean; n: number }; calm: boolean }) {
  const s = motionValues.stepper;
  const [pair, setPair] = useState<{ cur: string; prev: string | null; n: number }>({ cur: text, prev: null, n: roll.n });
  if (pair.cur !== text && pair.n !== roll.n) setPair({ cur: text, prev: roll.held ? null : pair.cur, n: roll.n });
  else if (pair.cur !== text) setPair({ cur: text, prev: null, n: roll.n });
  const p = useSharedValue(1);
  const from = calm ? 0 : (roll.held ? s.heldRoll : s.roll) * roll.dir;
  useEffect(() => {
    if (calm || pair.n === 0) { p.value = 1; return; }
    p.value = 0;
    p.value = withTiming(1, timing(roll.held ? s.heldRollMs : s.rollMs));
  }, [pair.n]); // eslint-disable-line react-hooks/exhaustive-deps
  // the value shown never dips (no strobe): it rolls in at full opacity; the old one fades as it leaves
  const inStyle = useAnimatedStyle(() => (p.value === 1 ? { transform: [] } : { transform: [{ translateY: from * (1 - p.value) }] }), [from]);
  const outStyle = useAnimatedStyle(() => ({ opacity: p.value === 1 ? 0 : 1 - p.value, transform: [{ translateY: -from * p.value }] }), [from]);
  return <View style={styles.mask}>
    {pair.prev != null && !calm ? <Animated.View style={[styles.layer, outStyle]} pointerEvents="none"><T v="stepper" accessible={false} style={styles.digits}>{pair.prev}</T></Animated.View> : null}
    <Animated.View style={inStyle}><T v="stepper" accessible={false} style={styles.digits}>{pair.cur}</T></Animated.View>
  </View>;
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 20 },
  value: { alignItems: 'center' },
  mask: { overflow: 'hidden', alignItems: 'center' },
  layer: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center' },
  digits: { fontVariant: ['tabular-nums'] },
  unit: { fontSize: 16, lineHeight: 20, letterSpacing: 4, marginTop: 4 },
  track: { width: BAR_W, height: 6, borderRadius: 3, backgroundColor: fx.fill.a10, overflow: 'hidden' },
  fill: { width: BAR_W, height: 6, borderRadius: 3, backgroundColor: fx.red.brand },
  buttons: { flexDirection: 'row', gap: 32, alignItems: 'center' },
  atLimit: { opacity: 0.3 },
});
