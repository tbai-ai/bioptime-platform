/* Bars (THEME §11.6, PREMIUM §1.4 "Bars"). Every fill grows with a transform, never by animating width or height, and
   starts from 0 only for a real value. A rounded fill is never scaled (its round ends would stretch, A30): it slides
   (translateX from the left, translateY from the bottom) inside a rounded track that clips it, so its ends stay round
   on every frame; a soft glow outside the track follows with a scale (a blur shows no ends).
   - ProgressBar: thin (4, goals) or medium (6, steps, macros, plan completion); red with its glow, turning green with
     a green glow (crossfaded over 200 ms) at 100 %. Goals 500 ms ease-out; others pass `duration` (600–1000). The fill
     waits for the track's width (onLayout, a 0 width ignored) before it shows.
   - MacroBar: a medium bar in a macro colour, 80 ms stagger by `index`.
   - WeekBars: Profile's weekly bars (80 high, gap 8, radius 2; above `threshold` red, else white/10), growing over 1 s
     with 50 ms steps. `seenKey`: bars shown before in this run start from the values shown last (src/fx/motion/seen).
   - RangeBar: a marker's place in its range: the optimal band (green at .2, 15 %–85 %) and an 8 pt dot with its glow,
     gliding from `from` (default the band's centre) over `duration` (default 900).
   They grow with an explicit `start`, else 120 ms after the nearest Reveal's entrance begins (Reveal's useDataStart),
   else at once; always only while the page is active (a pre-mounted page holds them empty).
   Calm and the pre-rendered HTML: at the value from the first frame. */
import React, { useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { fx } from '@/theme';
import { ease, motionValues, timing } from './tokens';
import { useMotion } from './tier';
import { useDataStart } from './Reveal';
import { markSeen, seenValue } from './seen';

/** A 0..1 share that grows from `from` (default 0) to `target` once it may start (and follows later changes). */
function useGrow(target: number, { start, delay = 0, duration = 500, easing = ease.tailOut, from = 0 }: { start?: boolean; delay?: number; duration?: number; easing?: (x: number) => number; from?: number }) {
  const { tier, still } = useMotion();
  const v0 = useSharedValue(still ? target : from);
  const v = useSharedValue(still ? target : 0);
  const grow = from ? v0 : v; // (a grow from elsewhere than 0, decided at mount: a range dot from the band's centre)
  const ms = tier === 'C' ? Math.min(duration, motionValues.chart.lineMsC) : duration;
  const fired = useDataStart(start, undefined, !still, (wait) => {
    'worklet';
    const w = wait + delay;
    const anim = withTiming(target, timing(ms, easing));
    grow.set(w > 0 ? withDelay(w, anim) : anim);
  });
  useEffect(() => {
    if (still) { grow.set(target); return; }
    if (fired.get() !== 1) return; // the start grows to the latest value
    grow.set(withTiming(target, timing(ms, easing)));
    // follows the value once grown
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, still]);
  return grow;
}

export type ProgressBarProps = {
  /** 0..1 (values above 1 show full and green). */
  value: number;
  size?: 'thin' | 'medium';
  color?: string;
  /** Turn green with a green glow at 100 % (goals; default on). */
  completeGreen?: boolean;
  /** The fill's glow (red, or the colour's own; default on for thin bars). */
  glow?: boolean;
  duration?: number;
  delay?: number;
  start?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export function ProgressBar({ value, size = 'thin', color = fx.red.brand, completeGreen = true, glow = size === 'thin', duration = 500, delay = 0, start, accessibilityLabel, style }: ProgressBarProps) {
  const { still } = useMotion();
  const target = Math.max(0, Math.min(1, value));
  const v = useGrow(target, { start, delay, duration });
  const done = completeGreen && value >= 1;
  const green = useSharedValue(done ? 1 : 0);
  useEffect(() => { green.set(done ? withDelay(still ? 0 : duration, withTiming(1, timing(still ? 0 : 200))) : 0); }, [done, still, duration, green]);
  // the track's width: the fill slides in from the left by it (hidden until it is known)
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => { const lw = e.nativeEvent.layout.width; if (lw > 0) setW(lw); }; // a detached page reports 0 × 0
  const fill = useAnimatedStyle(() => ({ opacity: w > 0 ? 1 : 0, transform: [{ translateX: (v.get() - 1) * w }] }), [w]);
  const halo = useAnimatedStyle(() => ({ opacity: w > 0 && v.get() > 0 ? 1 : 0, transform: [{ scaleX: v.get() }] }), [w]);
  const greenStyle = useAnimatedStyle(() => ({ opacity: green.get() }));
  const redGlow = useAnimatedStyle(() => ({ opacity: completeGreen ? 1 - green.get() : 1 }));
  const h = size === 'thin' ? 4 : 6;
  return <View
    onLayout={onLayout}
    style={[{ height: h, borderRadius: h / 2, backgroundColor: size === 'thin' ? fx.fill.a05 : fx.fill.a10 }, style]}
    accessibilityRole="progressbar"
    accessibilityLabel={accessibilityLabel}
    accessibilityValue={{ min: 0, max: 100, now: Math.round(target * 100) }}
  >
    {/* the glow, outside the clipping track: a soft shadow scaled from the left (no round end to stretch) */}
    {glow ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.left, halo]}>
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: h / 2, boxShadow: fx.shadow.dot }, redGlow]} />
      {completeGreen ? <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: h / 2, boxShadow: fx.shadow.green }, greenStyle]} /> : null}
    </Animated.View> : null}
    <View style={[StyleSheet.absoluteFill, { borderRadius: h / 2 }, styles.clip]}>
      <Animated.View style={[StyleSheet.absoluteFill, fill]}>
        <View style={[StyleSheet.absoluteFill, { borderRadius: h / 2, backgroundColor: color }]} />
        {completeGreen ? <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: h / 2, backgroundColor: fx.hue.green500 }, greenStyle]} /> : null}
      </Animated.View>
    </View>
  </View>;
}

/** A macro's bar (Fuel): medium, the macro colour, 600 ms by default, 80 ms apart by `index`. */
export function MacroBar({ index = 0, delay = 0, duration = 600, ...rest }: ProgressBarProps & { index?: number }) {
  return <ProgressBar size="medium" completeGreen={false} glow={false} duration={duration} delay={delay + index * 80} {...rest} />;
}

export type WeekBarsProps = {
  /** One value per bar, 0..100. */
  values: readonly number[];
  /** Above this the bar is red (the earlier app's 75). */
  threshold?: number;
  height?: number;
  start?: boolean;
  delay?: number;
  /** Bars shown before in this run start from the values shown last (and a revisit at the same values is at rest). */
  seenKey?: string;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
};

function WeekBar({ value, threshold, height, delay, start, seen }: { value: number; threshold: number; height: number; delay: number; start?: boolean; seen?: string }) {
  const clampV = Math.max(0, Math.min(100, value));
  const h = clampV * 0.7 * (height / 80);
  // the share of the final height to grow from: what was shown last (seenKey), else nothing
  const [from] = useState(() => { const p = seenValue(seen); return p == null || clampV <= 0 ? 0 : Math.max(0, Math.min(1, p / clampV)); });
  const v = useGrow(1, { start, delay, duration: 1000, easing: ease.tailOut, from });
  useEffect(() => { markSeen(seen, clampV); }, [seen, clampV]);
  // the rounded bar slides up from below the slot's bottom, which clips it (its round ends never stretch)
  const grow = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - v.get()) * h }] }), [h]);
  return <View style={[styles.weekSlot, styles.clip, { height }]}>
    <Animated.View style={[styles.bottom, { height: h, borderRadius: fx.radius.xs, backgroundColor: value > threshold ? fx.red.vivid : fx.fill.a10 }, grow]} />
  </View>;
}

export function WeekBars({ values, threshold = 75, height = 80, start, delay = 0, seenKey, accessibilityLabel, style }: WeekBarsProps) {
  return <View style={[styles.week, { height }, style]} accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
    {values.map((v, i) => <WeekBar key={i} value={v} threshold={threshold} height={height} delay={delay + i * 50} start={start} seen={seenKey ? `bars:${seenKey}:${i}` : undefined} />)}
  </View>;
}

export type RangeBarProps = {
  /** Where the value sits, 0..1 across the bar (the band is 15 %–85 %); null: no dot. */
  position: number | null;
  /** The status colour of the dot. */
  color: string;
  start?: boolean;
  delay?: number;
  /** Where the dot starts, 0..1 across the bar (default .5, the band's centre). */
  from?: number;
  /** The dot's glide in ms (default 900; reports pass screens.m79.dotMinMs … dotMaxMs). */
  duration?: number;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export function RangeBar({ position, color, start, delay = 0, from = 0.5, duration = 900, accessibilityLabel, style }: RangeBarProps) {
  const [width, setWidth] = useState(0);
  const target = position == null ? 0.5 : Math.max(0, Math.min(1, position));
  const v = useGrow(target, { start, delay, duration, easing: ease.expo, from: Math.max(0, Math.min(1, from)) });
  const shown = useGrow(position == null ? 0 : 1, { start, delay, duration: 300, easing: ease.expo });
  const dot = useAnimatedStyle(() => ({ opacity: shown.get(), transform: [{ translateX: v.get() * width - 4 }] }));
  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0) setWidth(w); // a detached page reports 0 × 0
  };
  return <View style={[styles.range, style]} onLayout={onLayout} accessible={!!accessibilityLabel} accessibilityLabel={accessibilityLabel}>
    <View style={[styles.band, { backgroundColor: fx.hue.green500 }]} />
    {position != null && width > 0 ? <Animated.View style={[styles.dot, { backgroundColor: color, boxShadow: `0px 0px 8px ${color}` }, dot]} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  left: { transformOrigin: 'left' },
  clip: { overflow: 'hidden' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, transformOrigin: 'bottom' },
  week: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  weekSlot: { flex: 1, justifyContent: 'flex-end' },
  range: { height: 6, borderRadius: 3, justifyContent: 'center' },
  band: { position: 'absolute', left: '15%', right: '15%', top: 0, bottom: 0, borderRadius: 3, opacity: 0.2 },
  dot: { position: 'absolute', left: 0, width: 8, height: 8, borderRadius: 4 },
});
