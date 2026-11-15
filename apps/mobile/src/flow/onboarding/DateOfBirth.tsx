/* The date of birth in the quiz's stepper look: three columns (day, month, year), each a Bebas value between a red plus
   and an outlined minus (the kit's stepper buttons at 44 pt), with the column's name under it. Holding a button repeats
   (after 350 ms, every 80 ms), as the kit Stepper does; the day is kept inside the chosen month. Each column is an
   adjustable control for screen readers. The value re-keys with the stepper's rise (y 10, .95 → 1, 150 ms).
   An exact day or year is quicker typed (release T6-41): tapping the day's or the year's numeral turns it into a number
   field in the same Bebas size, underlined in red, with the number pad. The value goes into the quiz as it is typed (a
   year once all four digits are in), kept inside the column's range, so whatever comes next (Continue, a swipe, a
   stepper) sees what leaving the field would take: on iOS and Android a tap elsewhere does not leave a field, and iOS's
   number pad has no Done (release review PK5-R1). The field closes, and the numeral comes back, when it is left, Done
   is pressed or the column's stepper is pressed. The steppers stay as they are; the month keeps its steppers only. */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { IconButton, T, fx, haptics, maxScaleFor, timing, typeScale, useFx } from '@/fx';
import { MONTHS } from './quizSteps';

export type Ymd = { y: number; m: number; d: number };


export const daysIn = (y: number, m: number) => new Date(y, m, 0).getDate();
export const toIso = ({ y, m, d }: Ymd) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
export function fromIso(v: string | undefined): Ymd | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v ?? '');
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}

export function DateOfBirth({ value, onChange }: { value: Ymd; onChange: (v: Ymd) => void }) {
  const now = new Date().getFullYear();
  const ref = useRef(value);
  ref.current = value;
  const set = (patch: Partial<Ymd>) => {
    const next = { ...ref.current, ...patch };
    next.d = Math.min(next.d, daysIn(next.y, next.m));
    ref.current = next;
    onChange(next);
  };
  return <View style={styles.row}>
    <Column label="Day" shown={String(value.d).padStart(2, '0')} spoken={String(value.d)} min={1} max={daysIn(value.y, value.m)} value={value.d} onStep={(v) => set({ d: v })} digits={2} />
    <Column label="Month" shown={MONTHS[value.m - 1]} spoken={MONTHS[value.m - 1]} min={1} max={12} value={value.m} onStep={(v) => set({ m: v })} wide />
    <Column label="Year" shown={String(value.y)} spoken={String(value.y)} min={now - 100} max={now - 18} value={value.y} onStep={(v) => set({ y: v })} wide digits={4} />
  </View>;
}

function Column({ label, shown, spoken, value, min, max, onStep, wide, digits }: { label: string; shown: string; spoken: string; value: number; min: number; max: number; onStep: (v: number) => void; wide?: boolean; digits?: number }) {
  const cur = useRef(value);
  cur.current = value;
  const hold = useRef<{ wait?: ReturnType<typeof setTimeout>; every?: ReturnType<typeof setInterval> }>({});
  const repeated = useRef(false);
  const nudge = (dir: 1 | -1) => {
    const next = cur.current + dir;
    if (next < min || next > max) { haptics.limit(); return false; }
    haptics.step(); cur.current = next; onStep(next); return true;
  };
  // the typed value: in the quiz as it is typed; the field closes once, when it is left, Done is pressed or the
  // column's stepper is pressed
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const [colW, setColW] = useState(0); // the column's drawn width (the numeral's at a large text size)
  const taken = useRef(false);
  const startTyping = () => { taken.current = false; setDraft(''); setTyping(true); };
  // the draft into the quiz, kept inside min..max; a part of a year would land on the oldest one, so a year goes in
  // with all its digits, a day with one or two
  const commit = (text: string) => {
    const n = Number(text);
    if (!text || !Number.isFinite(n) || (digits === 4 && text.length < 4)) return;
    const next = Math.max(min, Math.min(max, n));
    if (next === cur.current) return;
    haptics.step(); cur.current = next; onStep(next);
  };
  const type = (v: string) => { const text = v.replace(/\D/g, '').slice(0, digits); setDraft(text); commit(text); };
  // the day's range follows the month and the year: an open day field keeps the quiz on what it would take
  useEffect(() => { if (typing) commit(draft); }, [max]); // eslint-disable-line react-hooks/exhaustive-deps
  const take = () => {
    if (taken.current) return;
    taken.current = true;
    setTyping(false);
    commit(draft);
  };
  const stop = () => { if (hold.current.wait) clearTimeout(hold.current.wait); if (hold.current.every) clearInterval(hold.current.every); hold.current = {}; };
  // a stepper pressed while the field is open closes it first (its value is already in), then steps from that value
  const start = (dir: 1 | -1) => { if (typing) take(); stop(); repeated.current = false; hold.current.wait = setTimeout(() => { hold.current.every = setInterval(() => { repeated.current = true; if (!nudge(dir)) stop(); }, 80); }, 350); };
  const tap = (dir: 1 | -1) => { if (typing) take(); if (repeated.current) { repeated.current = false; return; } nudge(dir); };
  useEffect(() => stop, []);
  return <View style={[styles.col, wide ? styles.wide : null]} onLayout={digits ? (e) => { if (!typing) setColW(e.nativeEvent.layout.width); } : undefined}>
    <IconButton kind="stepperPlus" size={44} iconSize={18} icon="plus" label={`Later ${label.toLowerCase()}`} disabled={value >= max} onPress={() => tap(1)} onPressIn={() => start(1)} onPressOut={stop} />
    <View accessible accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ text: spoken }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} onAccessibilityAction={(e) => { nudge(e.nativeEvent.actionName === 'increment' ? 1 : -1); }} style={styles.value}>
      {typing && digits ? <View pointerEvents="none" style={styles.fieldLine} /> : null}
      {typing && digits ? <TextInput
        autoFocus
        value={draft}
        onChangeText={type}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={digits}
        maxFontSizeMultiplier={maxScaleFor('sheet48')}
        returnKeyType="done"
        onSubmitEditing={take}
        onBlur={take}
        placeholder={shown}
        placeholderTextColor={fx.ink.a30}
        selectionColor={fx.red.a50}
        cursorColor={fx.red.brand}
        underlineColorAndroid={fx.premium.transparent}
        accessibilityLabel={`${label}, type it`}
        style={[typeScale.sheet48, styles.numeral, styles.field, wide ? styles.fieldWide : null, colW ? { width: colW } : null]} />
        : digits ? <Pressable onPress={startTyping} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Numeral key={shown} text={shown} /></Pressable>
        : <Numeral key={shown} text={shown} />}
    </View>
    <IconButton kind="stepperMinus" size={44} iconSize={18} icon="minus" label={`Earlier ${label.toLowerCase()}`} disabled={value <= min} onPress={() => tap(-1)} onPressIn={() => start(-1)} onPressOut={stop} />
    <T v="eyebrowStore" color={fx.ink.a50} style={styles.label}>{label}</T>
  </View>;
}

function Numeral({ text }: { text: string }) {
  const { calm } = useFx();
  const p = useSharedValue(calm ? 1 : 0);
  useEffect(() => { if (!calm) p.value = withTiming(1, timing(150)); }, [calm, p]);
  const a = useAnimatedStyle(() => ({ opacity: 0.4 + 0.6 * p.value, transform: [{ translateY: 10 * (1 - p.value) }, { scale: 0.95 + 0.05 * p.value }] }));
  return <Animated.View style={a}><T v="sheet48" accessible={false} style={styles.numeral}>{text}</T></Animated.View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', gap: 12, marginTop: 8 },
  col: { alignItems: 'center', gap: 10, minWidth: 64 },
  wide: { minWidth: 92 },
  value: { minHeight: 56, justifyContent: 'center', alignItems: 'center' },
  numeral: { fontSize: 52, lineHeight: 56, fontVariant: ['tabular-nums'] },
  // the typed numeral: as wide as its column was before (a field would size itself to its own default on the web and
  // push the row about) and as large as the numeral at every system text size; white on the flow black; no focus ring
  // on the web (outline 'solid' at width 0, as the kit's fields: the default 'auto' ring is drawn at any width)
  field: { color: fx.ink.white, textAlign: 'center', width: 64, padding: 0, outlineStyle: 'solid', outlineWidth: 0 },
  // the red line under the typed numeral, drawn over the box's foot so it takes no room (a field's own border draws
  // dimmed on Android)
  fieldLine: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, borderRadius: 1, backgroundColor: fx.red.brand },
  fieldWide: { width: 92 },
  label: { letterSpacing: 2.4 },
});
