/* Rows (THEME §11.4 settings row, §11.9 lists). SettingsRow: a glass row (radius 12, px 16, py 16, white/5 border) with
   a 16 pt icon, a 14/500 title, an 11 pt subline and a chevron (or anything on the right, such as a Toggle); pressed,
   its border warms to red/30 (interpolated from the press progress on the UI thread). Rows sit in scrollers, so the
   pressed state waits motionValues.press.scrollDelay: a scroll that starts on a row never flashes it. On a desktop,
   pressing a row and leaving it with the mouse before the release cancels the press (touch is unaffected).
   KVRow: a label at white/60 and a mono value (`total`: 16/700 and mono 20/700 in light red). The label and a text
   value each keep their widest word whole (measured as drawn: WordMeasure) and wrap between words, so a long value
   never squeezes a one-word label below its word ('Lates/t', 'Count/s': SWA-02, SWB-02), and a text value takes a
   line of its own under the label when the two words do not fit the row side by side (R1-02); on Android a total's
   label gets two pixels more than it measured ('To pay' drawn as 'To': SWB-03, as Button's titles). A SettingsRow title
   shrinks just enough for its longest word to fit the row whole (FitText: 'Recommendation/s', SWB-10). Accordion: a
   header whose chevron turns 180° in 200 ms and a body that opens to its height in 250 ms and closes in 170 ms (expo). */
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { fx } from '@/theme';
import { useTitleFit } from './Button';
import { motionValues, t, timing, useFx } from './effects';
import { Icon, type IconName } from './Icon';
import { AnimatedPressable, pressTransform, usePress } from './press';
import { T } from './Text';
import { FONTS } from './type';
import { FitText, WORD_KEEP, WordMeasure } from './wordFit';

export function SettingsRow({ icon, title, sub, right, onPress, danger, label, style }: {
  icon?: IconName; title: string; sub?: string; right?: React.ReactNode; onPress?: () => void; danger?: boolean; label?: string; style?: StyleProp<ViewStyle>;
}) {
  const press = usePress('card', 0, { scroll: true });
  // the web: a press the pointer dragged off the row before the release is no press. The pressed row holds the
  // pointer (no hover-out until the release), so the drag is read from the press's own moves: past the row's size
  // from where it went down, the pointer has left. (A finger moved that far never gets a click anyway.)
  const leftWhilePressed = useRef(false);
  const down = useRef<{ x: number; y: number } | null>(null);
  const size = useRef({ w: 0, h: 0 });
  const { progress, to, calm } = press;
  const a = useAnimatedStyle(() => ({
    transform: pressTransform(progress.value, to, 0, calm),
    borderColor: interpolateColor(progress.value, [0, 1], [ROW_BORDER, ROW_BORDER_PRESSED]),
    backgroundColor: interpolateColor(progress.value, [0, 1], [ROW_BG, ROW_BG_PRESSED]),
  }), [to, calm]);
  const fg = danger ? fx.red.vivid : fx.ink.white;
  const inner = <>
    {icon ? <Icon name={icon} size={16} color={danger ? fx.red.vivid : fx.ink.a70} /> : null}
    <View style={styles.flex}>
      <FitText v="section" color={fg}>{title}</FitText>
      {sub ? <T v="caption" color={fx.ink.a55}>{sub}</T> : null}
    </View>
    {right ?? (onPress ? <Icon name="chevron-right" size={16} color={fx.ink.a40} /> : null)}
  </>;
  if (!onPress) return <View style={[styles.row, style]}>{inner}</View>;
  return <AnimatedPressable
    {...press.scrollProps}
    accessibilityRole="button"
    accessibilityLabel={label ?? title}
    accessibilityHint={sub}
    onLayout={(e) => { const { width, height } = e.nativeEvent.layout; if (width > 0 && height > 0) size.current = { w: width, h: height }; }}
    onPress={() => { if (leftWhilePressed.current) { leftWhilePressed.current = false; return; } onPress(); }}
    onPressIn={(e) => { leftWhilePressed.current = false; down.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }; press.onPressIn(); }}
    onPressOut={press.onPressOut}
    onPressMove={Platform.OS === 'web' ? (e) => {
      const d = down.current;
      if (!d || leftWhilePressed.current || !size.current.w) return;
      if (Math.abs(e.nativeEvent.pageX - d.x) > size.current.w || Math.abs(e.nativeEvent.pageY - d.y) > size.current.h) { leftWhilePressed.current = true; press.onPressOut(); }
    } : undefined}
    onHoverOut={Platform.OS === 'web' ? () => { if (press.pressed) { leftWhilePressed.current = true; press.onPressOut(); } } : undefined}
    style={[styles.row, style, a]}>
    {inner}
  </AnimatedPressable>;
}

export function KVRow({ label, value, total, divider = true, valueColor }: { label: string; value: React.ReactNode; total?: boolean; divider?: boolean; valueColor?: string }) {
  const [word, setWord] = useState({ label: 0, value: 0 });
  const [line, setLine] = useState({ label: 0, value: 0 }); // each one on one line, as drawn
  const [row, setRow] = useState(0);
  const whole = useTitleFit(label);
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : null;
  const lv = total ? 'cardTitle' : 'body', vv = total ? 'metric24' : 'mono14';
  const labelType = total ? styles.totalLabel : undefined, valueType = total ? styles.totalValue : styles.value;
  // a text value takes a line of its own under the label, at the row's end, once the two widest words do not fit the
  // row side by side (a long package name and a six-digit price at text 2.0 ran the price off the screen: R1-02). The
  // row's width is the same either way, so the value never moves back and forth.
  // (a total row keeps one point of rounding, not two: its label and price fit side by side where they do, VWR2-3). A
  // long text value (a check-in's written answer) that cannot share a line with its label and is longer than the room
  // the label leaves it takes a line of its own as well: beside a label at its widest it ran off the row (VA-6b)
  const long = text != null && row > 0 && line.value > 0 && line.label > 0
    && line.value + KV_GAP + Math.min(line.label, row * LABEL_SHARE) > row && line.value > row * (1 - LABEL_SHARE) - KV_GAP;
  const under = text != null && row > 0 && word.label > 0 && word.value > 0 && (word.label + word.value + (total ? 1 : 2) * WORD_KEEP + KV_GAP > row || long);
  const keep = (w: number) => (w > 0 && (!row || w + WORD_KEEP <= row) ? w + WORD_KEEP : 0);
  const labelMin = Math.max(keep(word.label), total && whole.style ? whole.style.minWidth : 0);
  return <View style={[under ? styles.kvUnder : styles.kv, divider ? styles.kvLine : null]}
    onLayout={text != null ? (e) => { const w = Math.floor(e.nativeEvent.layout.width); setRow((r) => (r === w ? r : w)); } : undefined}>
    <T v={lv} color={total ? fx.ink.white : fx.ink.a60} {...(total ? whole.props : null)}
      style={[under ? null : styles.kvLabel, labelType, labelMin ? { minWidth: under ? Math.min(labelMin, row) : labelMin } : null]}>{label}</T>
    {text != null
      ? <T v={vv} color={valueColor ?? (total ? fx.red.label : fx.ink.white)} style={[valueType, under ? styles.kvValueUnder : null, keep(word.value) ? { minWidth: keep(word.value) } : null]}>{text}</T>
      : value}
    <WordMeasure text={label} v={lv} style={labelType} onWord={(w) => setWord((o) => (o.label === w.width ? o : { ...o, label: w.width }))} />
    {text != null ? <WordMeasure text={text} v={vv} style={valueType} onWord={(w) => setWord((o) => (o.value === w.width ? o : { ...o, value: w.width }))} /> : null}
    {text != null ? <WordMeasure text={label} v={lv} style={labelType} whole onWord={(w) => setLine((o) => (o.label === w.width ? o : { ...o, label: w.width }))} /> : null}
    {text != null ? <WordMeasure text={text} v={vv} style={valueType} whole onWord={(w) => setLine((o) => (o.value === w.width ? o : { ...o, value: w.width }))} /> : null}
  </View>;
}

export function Accordion({ title, icon, children, initiallyOpen = false, style }: { title: string; icon?: IconName; children: React.ReactNode; initiallyOpen?: boolean; style?: StyleProp<ViewStyle> }) {
  const { calm } = useFx();
  const [open, setOpen] = useState(initiallyOpen);
  const [h, setH] = useState(0);
  const p = useSharedValue(initiallyOpen ? 1 : 0);
  const turn = useSharedValue(initiallyOpen ? 1 : 0);
  useEffect(() => {
    p.value = calm ? (open ? 1 : 0) : withTiming(open ? 1 : 0, timing(open ? motionValues.accordion.openMs : motionValues.accordion.closeMs));
    turn.value = calm ? (open ? 1 : 0) : withTiming(open ? 1 : 0, timing(t.fast));
  }, [open, calm, p, turn]);
  const body = useAnimatedStyle(() => ({ height: h * p.value, opacity: p.value }));
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: 180 * turn.value + 'deg' }] }));
  return <View style={[styles.acc, style]}>
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded: open }} aria-expanded={open} onPress={() => setOpen((o) => !o)} style={({ pressed }) => [styles.accHead, pressed ? { backgroundColor: fx.fill.a05 } : null]}>
      {icon ? <Icon name={icon} size={16} color={fx.ink.a70} /> : null}
      <T v="section" style={styles.flex}>{title}</T>
      <Animated.View style={chevron}><Icon name="chevron-down" size={16} color={fx.ink.a50} /></Animated.View>
    </Pressable>
    <Animated.View style={[styles.accClip, body]} accessibilityElementsHidden={!open} importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}>
      <View style={styles.accBody} onLayout={(e) => setH(e.nativeEvent.layout.height)}>{children}</View>
    </Animated.View>
  </View>;
}

/** The gap between a KVRow's label and its value, and the share of the row a label takes at most beside its value. */
const KV_GAP = 12;
const LABEL_SHARE = 0.68;

/** The row's border and fill at rest and pressed. */
const ROW_BORDER = fx.line.a05, ROW_BORDER_PRESSED = fx.red.a30, ROW_BG = fx.bg.panelSolid, ROW_BG_PRESSED = fx.fill.a05;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 16, borderRadius: fx.radius.xl, borderWidth: 1, borderColor: fx.line.a05, backgroundColor: fx.bg.panelSolid, minHeight: 52 },
  flex: { flex: 1, gap: 2 },
  kv: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: KV_GAP, paddingVertical: 10 },
  kvUnder: { gap: 2, paddingVertical: 10 },
  kvValueUnder: { alignSelf: 'flex-end', textAlign: 'right' },
  kvLine: { borderBottomWidth: 1, borderBottomColor: fx.line.a05 },
  // a long label (a check-in question) wraps inside about two thirds of the row instead of taking the whole width and
  // squeezing the value to nothing; a short label is unchanged; neither goes below its widest word (KVRow)
  kvLabel: { flexShrink: 1, maxWidth: '68%' },
  value: { textAlign: 'right', flexShrink: 1 },
  totalLabel: { fontFamily: FONTS.sans700 },
  totalValue: { fontSize: 20, lineHeight: 24, fontFamily: FONTS.mono700 },
  acc: { borderRadius: fx.radius.xl, borderWidth: 1, borderColor: fx.line.a05, backgroundColor: fx.bg.panelSolid, overflow: 'hidden' },
  accHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 16, minHeight: 52 },
  accClip: { overflow: 'hidden' },
  accBody: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: 16, paddingBottom: 16, paddingTop: 4, borderTopWidth: 1, borderTopColor: fx.line.a05 },
});
