/* Segmented controls (THEME §11.5, PREMIUM §1.8): one indicator glides under the chosen segment instead of each button
   swapping its background.
   - neutral (Fuel Today/Search/Saved, Train, Profile): white/5 track, radius 999, white/10 pill, 12/500 labels;
   - red (sign-in Email/Phone, quiz units): radius 12 track with the bright #E2E8F0 hairline the owner knows, a red
     pill with its glow, 14/600 labels, idle labels zinc-400.
   Motion (v2): the pill glides on the critically damped segment spring (no overshoot) and starts on the frame the finger
   lands (onPressIn, the pressed segment's frame); a press that is cancelled (the finger slid off, or a scroll took it)
   springs back to the chosen value, or, when no value is chosen (a row of choices nothing has been logged for yet, such as
   Fuel's meal outcome), fades the pill out (t.fast; at once under reduced motion) so a press a scroll took never leaves
   a segment looking chosen. Each label's colour follows the pill's distance on the UI thread, so the white label
   rides inside the pill. Width animates only when the segments differ in width. Tier C: a 200 ms expo timing; reduced
   motion: the pill is placed, not moved. The red pill's glow is a static shadow on the moving view (never animated).
   A tablist of tabs; each reports `selected` (aria-selected too: the web reads no accessibilityState).
   Touch: a segment keeps its visual height and reaches 44 pt (48 dp on Android) to touch above and below (hitSlop on
   native; on the web a padding with a matching negative margin, so the track does not grow). */
import React, { useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type GestureResponderEvent, type LayoutChangeEvent, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { fx } from '@/theme';
import { haptics } from './device/haptics';
import { motionValues, spring, t, timing, useFx } from './effects';
import { Icon, type IconName } from './Icon';
import { PRESS_PROPS, touchSlopY, usePress } from './press';
import { maxScaleFor, type, type TypeVariant } from './type';

export type SegmentItem<V extends string> = { value: V; label: string; icon?: IconName; a11y?: string };

export type Frame = { x: number; w: number };

/** The zero-layout rule: a detached page reports 0×0 (native Fabric and RN-web); such a frame is never used. */
export const usableFrame = (e: LayoutChangeEvent): Frame | null => {
  const { x, width, height } = e.nativeEvent.layout;
  return width > 0 && height > 0 ? { x, w: width } : null;
};

/** The indicator of a segmented row: x and width shared values, placed at once the first time and gliding after. */
export function useGlide() {
  const { calm, tier } = useFx();
  const x = useSharedValue(0);
  const w = useSharedValue(0);
  const ready = useSharedValue(0);
  const aimed = useRef<Frame | null>(null);
  const glide = (f: Frame, animate = true) => {
    const prev = aimed.current;
    aimed.current = f;
    if (!prev || !animate || calm || ready.value === 0) { x.value = f.x; w.value = f.w; ready.value = 1; return; }
    if (tier === 'C') {
      x.value = withTiming(f.x, timing(motionValues.segment.cMs));
      w.value = Math.abs(prev.w - f.w) < 0.5 ? f.w : withTiming(f.w, timing(motionValues.segment.cMs));
      return;
    }
    x.value = withSpring(f.x, spring.segment);
    // equal segments move by translateX only; a width change animates the pill's (leaf) width
    w.value = Math.abs(prev.w - f.w) < 0.5 ? f.w : withSpring(f.w, spring.segment);
  };
  return { x, w, ready, aimed, glide };
}

const AText = Animated.createAnimatedComponent(Text);

/** The web has no system text size: the cap is written where the large-text pass reads it (as T does). */
const webCap = (max: number) => (Platform.OS === 'web' ? ({ dataSet: { fsmax: String(max) } } as object) : null);

/** A label whose colour follows the pill: c = mix(idle, active) by 1 − |pill centre − segment centre| / segment width,
 *  on the UI thread. Before the segment has a frame it takes the colour of its state. `shown`: the pill's opacity, when
 *  the pill can fade out (Segmented with no chosen value); the mix fades with it. */
export function GlideLabel({ v, frame, x, w, on, idle, active, children, numberOfLines = 1, maxFontSizeMultiplier, style, center, shown }: {
  v: TypeVariant; frame: Frame | undefined; x: SharedValue<number>; w: SharedValue<number>; on: boolean; idle: string; active: string;
  children: React.ReactNode; numberOfLines?: number; maxFontSizeMultiplier?: number; style?: StyleProp<TextStyle>; center?: boolean; shown?: SharedValue<number>;
}) {
  const fx0 = frame?.x ?? 0;
  const fw = frame?.w ?? 0;
  const a = useAnimatedStyle(() => {
    if (fw <= 0 || w.value <= 0) return { color: on ? active : idle };
    const vis = shown ? Math.min(1, Math.max(0, shown.value)) : 1;
    const k = vis * Math.min(1, Math.max(0, 1 - Math.abs(x.value + w.value / 2 - (fx0 + fw / 2)) / fw));
    return { color: interpolateColor(k, [0, 1], [idle, active]) };
  }, [fx0, fw, on, idle, active, shown]);
  const max = maxFontSizeMultiplier ?? maxScaleFor(v);
  return <AText {...webCap(max)} numberOfLines={numberOfLines} maxFontSizeMultiplier={max} style={[type[v], center ? styles.center : null, style, a]}>{children}</AText>;
}

/** A glyph whose colour follows the pill the same way: two copies (idle and active) crossfading on the mix. */
function GlideIcon({ name, size, frame, x, w, on, idle, active, shown }: { name: IconName; size: number; frame: Frame | undefined; x: SharedValue<number>; w: SharedValue<number>; on: boolean; idle: string; active: string; shown?: SharedValue<number> }) {
  const fx0 = frame?.x ?? 0;
  const fw = frame?.w ?? 0;
  const a = useAnimatedStyle(() => {
    if (fw <= 0 || w.value <= 0) return { opacity: on ? 1 : 0 };
    const vis = shown ? Math.min(1, Math.max(0, shown.value)) : 1;
    return { opacity: vis * Math.min(1, Math.max(0, 1 - Math.abs(x.value + w.value / 2 - (fx0 + fw / 2)) / fw)) };
  }, [fx0, fw, on, shown]);
  return <View style={{ width: size, height: size }}>
    <Icon name={name} size={size} color={idle} />
    <Animated.View style={[StyleSheet.absoluteFill, a]}><Icon name={name} size={size} color={active} /></Animated.View>
  </View>;
}

export function Segmented<V extends string>({ items, value, onChange, kind = 'neutral', compact, style }: {
  items: SegmentItem<V>[]; value: V; onChange: (v: V) => void; kind?: 'neutral' | 'red'; compact?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const [frames, setFrames] = useState<Record<string, Frame>>({});
  const { x, w, ready, aimed, glide } = useGlide();
  const { calm } = useFx();
  const valueRef = useRef(value);
  valueRef.current = value;
  const framesRef = useRef(frames);
  framesRef.current = frames;
  const down = useRef<{ x: number; y: number } | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const target = frames[value];
  // the chosen value's frame: placed the first time, glided when it changes from outside (a press already started it)
  React.useEffect(() => {
    if (!target) return;
    const a = aimed.current;
    if (a && Math.abs(a.x - target.x) < 0.5 && Math.abs(a.w - target.w) < 0.5) return;
    glide(target, !!a);
  }, [target?.x, target?.w]); // eslint-disable-line react-hooks/exhaustive-deps
  const pill = useAnimatedStyle(() => ({ opacity: ready.value, width: w.value, transform: [{ translateX: x.value }] }));
  const red = kind === 'red';
  const idle = red ? fx.ink.ink2 : fx.ink.a70;
  const active = fx.ink.white;
  const onLayout = (v: string) => (e: LayoutChangeEvent) => {
    const f = usableFrame(e);
    if (!f) return;
    setFrames((p) => (p[v]?.x === f.x && p[v]?.w === f.w ? p : { ...p, [v]: f }));
  };
  const clearPending = () => { if (pending.current) { clearTimeout(pending.current); pending.current = null; } };
  // a cancelled press glides back to the chosen value; with no chosen value (no frame) the pill fades out and the next
  // press places it afresh (the pressed segment never stays looking chosen)
  const fadeOut = () => { aimed.current = null; ready.value = calm ? 0 : withTiming(0, timing(t.fast)); };
  const back = () => {
    clearPending();
    const f = framesRef.current[valueRef.current];
    if (f) glide(f); else fadeOut();
  };
  const pressIn = (v: V) => (e: GestureResponderEvent) => {
    clearPending();
    down.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
    const f = framesRef.current[v];
    if (f) glide(f);
  };
  // a release with no onPress is a cancel: native calls onPress right after onPressOut (in the same tick), so springing
  // back here is overridden at once by a real press; the web's onPress comes with the click event a moment later, so
  // there a release that stayed on the segment waits for it (a moved finger never gets a click)
  const pressOut = (e: GestureResponderEvent) => {
    const d = down.current;
    const moved = d ? Math.hypot(e.nativeEvent.pageX - d.x, e.nativeEvent.pageY - d.y) : 0;
    if (Platform.OS !== 'web' || !(moved <= motionValues.segment.slop)) back();
    else { clearPending(); pending.current = setTimeout(back, t.base); }
  };
  React.useEffect(() => clearPending, []);
  return <View accessibilityRole="tablist" style={[red ? styles.trackRed : styles.track, style]}>
    <Animated.View pointerEvents="none" style={[styles.pill, red ? styles.pillRed : styles.pillNeutral, pill]} />
    {items.map((it) => {
      const on = it.value === value;
      const f = frames[it.value];
      return <SegmentButton
        key={it.value}
        onLayout={onLayout(it.value)}
        label={it.a11y ?? it.label}
        on={on}
        onPressIn={pressIn(it.value)}
        onPressOut={pressOut}
        onPress={() => {
          clearPending();
          const fr = framesRef.current[it.value];
          if (fr) glide(fr);
          if (!on) { haptics.select(); onChange(it.value); }
          // a press the owner did not turn into a value (Fuel's 'Swapped' opens a picker first) leaves nothing chosen
          pending.current = setTimeout(() => { pending.current = null; if (!framesRef.current[valueRef.current]) fadeOut(); }, t.base);
        }}
        style={[styles.segment, red ? styles.segmentRed : compact ? styles.segmentCompact : styles.segmentNeutral]}
        touch={red ? TOUCH.red : TOUCH.neutral}>
        {it.icon ? <GlideIcon name={it.icon} size={red ? 16 : 13} frame={f} x={x} w={w} on={on} idle={idle} active={active} shown={ready} /> : null}
        <GlideLabel v={red ? 'buttonSm' : 'chip'} frame={f} x={x} w={w} on={on} idle={idle} active={active} numberOfLines={2} maxFontSizeMultiplier={1.15} center style={it.icon ? styles.label : styles.labelWide} shown={ready}>{it.label}</GlideLabel>
      </SegmentButton>;
    })}
  </View>;
}

/** One segment: a tab that presses to .96 (the tile rung of the ladder) and answers on the touch-down frame. */
function SegmentButton({ label, on, onLayout, onPressIn, onPressOut, onPress, style, touch, children }: {
  label: string; on: boolean; onLayout: (e: LayoutChangeEvent) => void; onPressIn: (e: GestureResponderEvent) => void; onPressOut: (e: GestureResponderEvent) => void;
  onPress: () => void; style: StyleProp<ViewStyle>; touch: ReturnType<typeof segmentTouch>; children: React.ReactNode;
}) {
  const press = usePress('tile');
  return <Pressable
    {...PRESS_PROPS}
    onLayout={onLayout}
    accessibilityRole="tab"
    accessibilityLabel={label}
    accessibilityState={{ selected: on }}
    aria-selected={on}
    onPressIn={(e) => { press.onPressIn(); onPressIn(e); }}
    onPressOut={(e) => { press.onPressOut(); onPressOut(e); }}
    onPress={onPress}
    hitSlop={touch.slop}
    style={[style, touch.web]}>
    <Animated.View style={[styles.inner, press.style]}>{children}</Animated.View>
  </Pressable>;
}

/** A segment's touch reach (press touchSlopY): native hitSlop; the web's padding (added to the segment's own) with a
 *  matching negative margin and a taller minimum, so the visual and the track stay as they were. */
function segmentTouch(padY: number, minH: number) {
  const k = touchSlopY(minH);
  if (Platform.OS !== 'web') return { slop: k ? { top: k, bottom: k } : undefined, web: null };
  return { slop: undefined, web: k ? { paddingVertical: padY + k, marginVertical: -k, minHeight: minH + 2 * k } : null };
}
const TOUCH = { neutral: segmentTouch(8, 32), red: segmentTouch(10, 40) };

const styles = StyleSheet.create({
  track: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: fx.radius.pill, borderWidth: 1, borderColor: fx.line.a10, backgroundColor: fx.fill.a05 },
  trackRed: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: fx.radius.xl, borderWidth: 1, borderColor: fx.line.segmented, backgroundColor: fx.fill.a05 },
  pill: { position: 'absolute', top: 4, bottom: 4, left: -1 }, // -1: item frames include the track's 1 pt border
  pillNeutral: { borderRadius: fx.radius.pill, backgroundColor: fx.fill.a10 },
  // the chosen segment's fill under its white label: the action red (5.0:1, T3-03); its glow stays the brand red
  pillRed: { borderRadius: fx.radius.lg, backgroundColor: fx.red.action, boxShadow: fx.shadow.segment },
  segment: { flex: 1, minWidth: 0, justifyContent: 'center', minHeight: 32 },
  inner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  center: { textAlign: 'center' },
  // segment labels are short control names in equal shares: they grow to 1.15× with the system text size and take a
  // second line rather than cut off (Android's shrink-to-fit breaks two-word labels at the space and hides the rest)
  label: { flexShrink: 1 },
  // a label alone in its segment takes the segment's whole width (its text is centred, so it looks the same): Android
  // lays a label out at its box's whole-pixel width, which could come out a hair under the width it measured, and the
  // last word then wrapped into a line the box had no height for ('This week' drawn as 'This' at 320 dpi)
  labelWide: { flexGrow: 1, flexShrink: 1 },
  segmentNeutral: { paddingVertical: 8, borderRadius: fx.radius.pill },
  segmentCompact: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: fx.radius.pill, flex: 0 },
  segmentRed: { paddingVertical: 10, borderRadius: fx.radius.lg, minHeight: 40 },
});
