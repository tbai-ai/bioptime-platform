/* The six-digit code (THEME §11.7, PREMIUM §1.8): six boxes 40×48 (48×56 on wide screens), black/50, radius 12,
   JetBrains Mono 20. A filled box gets a white/50 border and a faint white glow; the next box to fill is outlined
   white while the code has focus. One real input (transparent, over the boxes) holds the code, so paste, the SMS
   one-time-code suggestion and screen readers all work on it; it is labelled with `label`. Each new digit pops; a
   paste (several digits in one change) pops the boxes in sequence, 30 ms apart; six digits call onComplete. `error`
   shakes the row (not under reduced motion, where the red borders fade in over 150 ms instead) and always fires the
   error haptic. The handle (ref) has clear(): the digits fade out (120 ms), then the code empties and the input takes
   the focus again (the flow calls it 600 ms after an error), and focus(). */
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { fx } from '@/theme';
import { haptics } from './device/haptics';
import { ease, motionValues, t, timing, useFx } from './effects';
import { calmFade } from './motion/tokens';
import { doneOnce } from './motion/once';
import { T } from './Text';
import { fontFor } from './type';

export type OtpBoxesProps = {
  value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; label?: string; error?: boolean; autoFocus?: boolean; editable?: boolean;
};
export type OtpBoxesHandle = { clear: () => void; focus: () => void };

const ERROR_LINE = fx.tone.errorLine;

export const OtpBoxes = forwardRef<OtpBoxesHandle, OtpBoxesProps>(function OtpBoxes({ value, onChange, onComplete, label = 'Six-digit code', error, autoFocus, editable = true }, ref) {
  const { width } = useWindowDimensions();
  const wide = width >= 768;
  const [focus, setFocus] = useState(false);
  const { calm } = useFx();
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const shake = useSharedValue(0);
  const shown = useSharedValue(1); // the digits' opacity (clear() fades them out)
  const bad = useSharedValue(error ? 1 : 0); // the red borders
  const wasError = useRef(false);
  const digits = value.replace(/\D/g, '').slice(0, 6);
  const prevDigits = useRef(digits);
  // how many digits arrived in the last change (a paste pops the boxes in sequence)
  const burst = useRef({ from: digits.length, count: 0 });
  if (prevDigits.current !== digits) {
    const added = digits.length - prevDigits.current.length;
    burst.current = { from: prevDigits.current.length, count: added > 1 && digits.startsWith(prevDigits.current) ? added : 0 };
    prevDigits.current = digits;
  }
  useEffect(() => {
    if (error && !wasError.current) {
      haptics.error(); // every error, reduced motion included
      if (!calm) {
        const f = motionValues.field;
        const step = f.shakeMs / (f.shake.length - 1);
        shake.value = withSequence(...motionValues.otp.shake.map((x) => withTiming(x, timing(step))));
      }
    }
    bad.value = error ? (calm ? withTiming(1, calmFade(motionValues.otp.calmBorderMs)) : 1) : 0;
    wasError.current = !!error;
  }, [error, calm, shake, bad]);
  const clearing = useRef<ReturnType<typeof doneOnce> | null>(null);
  useEffect(() => () => clearing.current?.cancel(), []);
  useImperativeHandle(ref, () => ({
    focus: () => input.current?.focus(),
    clear: () => {
      const m = motionValues.otp.clearMs;
      clearing.current?.cancel();
      const end = doneOnce(() => { onChange(''); shown.value = 1; input.current?.focus(); }, m + motionValues.overlay.fallbackExtra);
      clearing.current = end;
      const done = end.done;
      shown.value = withTiming(0, calm ? calmFade(m) : timing(m, ease.css), (fin) => { 'worklet'; if (fin) scheduleOnRN(done); });
    },
  }), [calm, onChange, shown]);
  const row = useAnimatedStyle(() => (shake.value === 0 ? { transform: [] } : { transform: [{ translateX: shake.value }] }));
  const w = wide ? 48 : 40, h = wide ? 56 : 48;
  return <View>
    <Animated.View style={[styles.row, row]}>
      {Array.from({ length: 6 }, (_, i) => <Box key={i} digit={digits[i] ?? ''} active={focus && i === Math.min(digits.length, 5)} error={!!error} bad={bad} shown={shown} w={w} h={h} calm={calm}
        delay={burst.current.count > 1 && i >= burst.current.from && i < burst.current.from + burst.current.count ? (i - burst.current.from) * motionValues.otp.pasteStep : 0} />)}
    </Animated.View>
    <TextInput
      ref={input}
      accessibilityLabel={label}
      value={digits}
      onChangeText={(v) => {
        const next = v.replace(/\D/g, '').slice(0, 6);
        onChange(next);
        if (next.length === 6 && digits.length < 6) onComplete?.(next);
      }}
      keyboardType="number-pad"
      inputMode="numeric"
      textContentType="oneTimeCode"
      autoComplete="sms-otp"
      maxLength={6}
      autoFocus={autoFocus}
      editable={editable}
      caretHidden
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={styles.hidden}
    />
  </View>;
});

function Box({ digit, active, error, bad, shown, w, h, calm, delay }: { digit: string; active: boolean; error: boolean; bad: SharedValue<number>; shown: SharedValue<number>; w: number; h: number; calm: boolean; delay: number }) {
  const s = useSharedValue(1);
  const prev = useRef(digit);
  useEffect(() => {
    if (digit && digit !== prev.current && !calm) {
      const pop = withSequence(withTiming(1.06, timing(t.pop / 2)), withTiming(1, timing(t.pop / 2)));
      s.value = delay > 0 ? withDelay(delay, pop) : pop;
    }
    prev.current = digit;
  }, [digit, calm, s, delay]);
  const rest = active ? fx.ink.white : digit ? fx.line.a50 : fx.line.a10;
  const look = useAnimatedStyle(() => ({ transform: s.value === 1 ? [] : [{ scale: s.value }], borderColor: interpolateColor(bad.value, [0, 1], [rest, ERROR_LINE]) }), [rest]);
  const ink = useAnimatedStyle(() => ({ opacity: shown.value }));
  return <Animated.View style={[styles.box, { width: w, height: h, boxShadow: digit && !error ? fx.shadow.otp : undefined }, look]}>
    <Animated.View style={ink}><T v="mono14" style={styles.digit} accessible={false}>{digit}</T></Animated.View>
  </Animated.View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  box: { borderRadius: fx.radius.xl, borderWidth: 1, backgroundColor: fx.glass.onPhoto, alignItems: 'center', justifyContent: 'center' },
  digit: { fontSize: 20, lineHeight: 26, fontFamily: fontFor('mono', 500) },
  hidden: { ...StyleSheet.absoluteFill, opacity: 0.011, color: fx.premium.transparent, fontSize: 1 },
});
