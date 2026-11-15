/* The earlier app's blood-test checkout chrome (BloodWorkCheckout, shots 64–73), shared by the steps of Book a test:
   - CheckoutHeader: the 32 pt red flask tile, "STEP n OF 5" over the step's name, the plain X, and the 5-segment 2 pt
     bar (red for the steps reached, each filling over 500 ms). The header is one accessible element that reads
     "Step 2 of 5, Your details", and every change of step is announced.
   - StepSlide: a step's content entering from x ±24 with opacity over 220 ms expo (the earlier app's .22 s), by
     direction (tier C and reduced motion: no slide). The Store checkout uses it too (M81).
   - SegmentBar: the segmented progress (each 2 pt segment's red fill slides in by translateX inside its clipped,
     rounded track; never a scaleX of a rounded shape), shared with the Store checkout.
   - CheckoutFooter: the sticky footer over the fade (#080808 → transparent): the 56 pt back square (from step 2) and
     the red "Continue ›"; a caption may sit under it.
   - Panel: the checkout card (#0B0B0B, radius 24, a white/10 hairline: the earlier app's outline, softened) with an
     optional uppercase label; DetailRow: an icon, a label and a value on the right (the review cards).
   Reduced motion: no slide, no fill animation; everything at rest. */
import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AnimatedPressable, Button, COLUMN, ease, fx, Icon, Scrim, T, t, timing, useFx, usePress, type IconName } from '@/fx';
import { motionValues } from '@/fx/motion/tokens';
import { FitText, WORD_KEEP, WordMeasure } from '@/fx/wordFit';
import { IconTile } from './parts';

const S = motionValues.screens.m81;
/** A segment's fill: t.flow (the earlier app's bar took 500 ms; a screens.m81.segmentMs token is requested). */
const SEGMENT_MS = t.flow;

export const STEP_NAMES = ['Book a blood test', 'Your details', 'Collection address', 'Appointment', 'Review and book'] as const;

export function CheckoutHeader({ step, done, onClose }: { step: number; done?: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const name = done ? 'Booking confirmed' : STEP_NAMES[step - 1];
  const eyebrow = done ? 'Booked' : `Step ${step} of ${STEP_NAMES.length}`;
  useEffect(() => { AccessibilityInfo.announceForAccessibility(done ? name : `Step ${step} of ${STEP_NAMES.length}, ${name}`); }, [step, done, name]);
  return <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
    <View style={styles.headerRow}>
      <View style={styles.headerText} accessible accessibilityRole="header" accessibilityLabel={done ? name : `Step ${step} of ${STEP_NAMES.length}, ${name}`}>
        <IconTile icon="flask-conical" size={32} radius={8} />
        <View style={styles.flex}>
          <T v="label" color={fx.ink.ink2}>{eyebrow}</T>
          <T v="cardTitle" numberOfLines={2}>{name}</T>
        </View>
      </View>
      <PlainIcon icon="x" label="Close" onPress={onClose} />
    </View>
    {done ? null : <View style={styles.bar} accessible={false} importantForAccessibility="no-hide-descendants">
      <SegmentBar step={step} of={STEP_NAMES.length} />
    </View>}
  </View>;
}

/** The segmented progress: `of` 2 pt segments, red up to `step`. */
export function SegmentBar({ step, of, style }: { step: number; of: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.segments, style]}>
    {Array.from({ length: of }, (_, i) => <Segment key={i} on={i < step} />)}
  </View>;
}

function Segment({ on }: { on: boolean }) {
  const { calm, inHtml } = useFx();
  const p = useSharedValue(on ? 1 : 0);
  const w = useSharedValue(0);
  useEffect(() => { p.value = calm || inHtml ? (on ? 1 : 0) : withTiming(on ? 1 : 0, timing(SEGMENT_MS, ease.tailOut)); }, [on, calm, inHtml, p]);
  const fill = useAnimatedStyle(() => ({ opacity: w.value > 0 ? 1 : 0, transform: [{ translateX: -(1 - p.value) * w.value }] })); // hidden until measured
  const onLayout = (e: LayoutChangeEvent) => { const v = e.nativeEvent.layout.width; if (v > 0) w.value = v; };
  return <View style={styles.segment} onLayout={onLayout}><Animated.View style={[styles.segmentFill, fill]} /></View>;
}

/** A step's content, sliding in by direction (+1 forward, −1 back). Key it by the step. */
export function StepSlide({ dir, children, style }: { dir: number; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { calm, inHtml, tier } = useFx();
  const still = calm || inHtml || dir === 0 || tier === 'C';
  const p = useSharedValue(still ? 1 : 0);
  useEffect(() => { if (!still) p.value = withTiming(1, timing(S.slideMs, ease.expo)); }, [still, p]);
  const a = useAnimatedStyle(() => (p.value === 1 ? { opacity: 1, transform: [] } : { opacity: p.value, transform: [{ translateX: S.slideX * dir * (1 - p.value) }] }));
  return <Animated.View style={[styles.slide, style, a]}>{children}</Animated.View>;
}

export function CheckoutFooter({ step, onBack, title, icon, onNext, disabled, busy, caption }: {
  step: number; onBack: () => void; title: string; icon?: IconName; onNext: () => void; disabled?: boolean; busy?: boolean; caption?: string;
}) {
  const insets = useSafeAreaInsets();
  return <View pointerEvents="box-none" style={styles.footerWrap}>
    <Scrim kind="overlayFooter" style={StyleSheet.absoluteFill} />
    <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.footerRow}>
        {step > 1 ? <BackSquare onPress={onBack} /> : null}
        <View style={styles.flex}>
          <Button title={title} shape="flow" icon={icon} iconRight={icon ? undefined : 'chevron-right'} onPress={onNext} disabled={disabled} busy={busy} commit={step === STEP_NAMES.length} style={styles.cta} />
        </View>
      </View>
      {caption ? <T v="caption" color={fx.ink.a60} center>{caption}</T> : null}
    </View>
  </View>;
}

/** The 56 pt back square (radius 16, a light hairline). */
function BackSquare({ onPress }: { onPress: () => void }) {
  const press = usePress('icon');
  return <AnimatedPressable accessibilityRole="button" accessibilityLabel="Previous step" onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut}
    style={[styles.back, press.pressed ? styles.backPressed : null, press.style]}>
    <Icon name="chevron-left" size={20} color={fx.ink.white} />
  </AnimatedPressable>;
}

/** The checkout's plain X (no circle), with a 44 pt touch area. */
function PlainIcon({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const press = usePress('icon');
  return <AnimatedPressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut} style={[styles.plain, press.style]}>
    <Icon name={icon} size={22} color={press.pressed ? fx.ink.white : fx.ink.a50} />
  </AnimatedPressable>;
}

export function Panel({ label, children, tint, style }: { label?: string; children: React.ReactNode; tint?: boolean; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.panel, tint ? styles.panelTint : null, style]}>
    {label ? <T v="label" color={fx.ink.ink2} accessibilityRole="header">{label}</T> : null}
    {children}
  </View>;
}

/** A review row: the label keeps its widest word whole (measured as drawn) and the value shrinks just enough for its
 *  longest word (a phone number) to fit the rest of the row, so neither breaks inside a word ('Includ/ed',
 *  '+91970000001/9': SWB-02). Once the label's widest word and the value's, at the value's smallest size, do not fit
 *  the row side by side (a test name with a long word at text 2.0 left 'Included' a letter a line: R1-03), the value
 *  takes a line of its own under the label, at the row's end. The row's width is the same either way, so the value
 *  never moves back and forth. */
export function DetailRow({ icon, label, value, strong }: { icon?: IconName; label: string; value: string; strong?: boolean }) {
  const [word, setWord] = useState({ label: 0, value: 0 });
  const [row, setRow] = useState(0);
  const vv = strong ? 'cardTitle' : 'body';
  const lead = icon ? DETAIL_ICON + DETAIL_GAP : 0;
  const under = row > 0 && word.label > 0 && word.value > 0 && lead + word.label + DETAIL_GAP + word.value * VALUE_FLOOR + 2 * WORD_KEEP > row;
  const labelMin = word.label > 0 && (!row || lead + word.label + WORD_KEEP <= row) ? word.label + WORD_KEEP : 0;
  const head = <>
    {icon ? <View style={styles.detailIcon}><Icon name={icon} size={15} color={fx.ink.a40} /></View> : null}
    <T v="section" color={fx.ink.a60} style={[under ? styles.flex : styles.detailLabel, labelMin ? { minWidth: labelMin } : null]}>{label}</T>
  </>;
  return <View style={under ? styles.detailUnder : styles.detail} onLayout={(e) => { const w = Math.floor(e.nativeEvent.layout.width); setRow((r) => (r === w ? r : w)); }}>
    {under ? <View style={styles.detail}>{head}</View> : head}
    <FitText v={vv} color={fx.ink.white} style={styles.detailValue} min={VALUE_FLOOR} boxStyle={under ? null : styles.flex}>{value}</FitText>
    <WordMeasure text={label} v="section" onWord={(w) => setWord((o) => (o.label === w.width ? o : { ...o, label: w.width }))} />
    <WordMeasure text={value} v={vv} onWord={(w) => setWord((o) => (o.value === w.width ? o : { ...o, value: w.width }))} />
  </View>;
}

/** A review row's icon column and its gaps (styles.detail, styles.detailIcon), and the smallest size its value shrinks
 *  to (FitText's floor). */
const DETAIL_ICON = 16, DETAIL_GAP = 10, VALUE_FLOOR = 0.6;

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  header: { paddingHorizontal: 20, paddingBottom: 8, width: '100%', maxWidth: COLUMN, alignSelf: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerText: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 },
  plain: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -10 },
  bar: { marginTop: 20 },
  segments: { flexDirection: 'row', gap: 6 },
  segment: { flex: 1, height: 2, borderRadius: 1, backgroundColor: fx.fill.a10, overflow: 'hidden' },
  segmentFill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 1, backgroundColor: fx.red.brand },
  slide: { gap: 16 },
  footerWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 36 },
  footer: { width: '100%', maxWidth: COLUMN, alignSelf: 'center', paddingHorizontal: 20, gap: 10 },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cta: { minHeight: 56 },
  back: { width: 56, height: 56, borderRadius: fx.radius.card, borderWidth: 1, borderColor: fx.line.a20, backgroundColor: fx.fill.a05, alignItems: 'center', justifyContent: 'center' },
  backPressed: { borderColor: fx.line.a50, backgroundColor: fx.fill.a10 },
  panel: { backgroundColor: fx.bg.panelSolid, borderRadius: fx.radius.three, borderWidth: 1, borderColor: fx.line.a10, padding: 20, gap: 14 },
  panelTint: { backgroundColor: fx.red.a05, borderColor: fx.red.a20 },
  detail: { flexDirection: 'row', alignItems: 'center', gap: DETAIL_GAP },
  detailUnder: { gap: 2 },
  detailIcon: { width: DETAIL_ICON, alignItems: 'center', flexShrink: 0 },
  detailLabel: { flexShrink: 1, maxWidth: '55%' },
  detailValue: { textAlign: 'right' },
});
