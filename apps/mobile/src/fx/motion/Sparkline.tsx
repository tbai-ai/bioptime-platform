/* Sparklines (THEME §11.6, PREMIUM §1.4): a polyline with no fill that draws itself left to right. The path is laid
   out in points (no viewBox scaling, so the stroke stays round and even), its length L is computed here from the
   points (no getTotalLength), and strokeDashoffset runs L → 0 over 900 ms expo, `index` × 80 ms after `delay`.
   AreaSpark adds the heart-rate style area under the line (the line's colour at .08). Fewer than two values draw
   nothing (the box keeps its size). Calm and the pre-rendered HTML: drawn from the first frame.
   Never a flash: the dash pattern is one fixed long dash (DASH, longer than any line here) and the offset is computed on
   the UI thread from the path length L, kept in a shared value that a layout effect updates with the series, so the
   pattern and the offset can never disagree for a frame; the stroke stays transparent until the draw starts. When it
   starts: an explicit `start`, else the nearest Reveal's landing (+120 ms, Reveal's useDataStart), else at once; always
   only while the page is active. */
import React, { useEffect, useLayoutEffect, useMemo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, { useAnimatedProps, useSharedValue, withDelay, withTiming, type SharedValue } from 'react-native-reanimated';
import { fx } from '@/theme';
import { ease, motionValues, t, timing } from './tokens';
import { useMotion } from './tier';
import { useDataStart } from './Reveal';

/** One dash longer than any line the kit draws (sparklines and charts): offset DASH − p·L shows the first p·L of it. */
export const DASH = 8192;
export const DASH_ARRAY = `${DASH} ${DASH}`;

const AnimatedPath = Animated.createAnimatedComponent(Path);

export type SparkPoint = { x: number; y: number };

/** The points of a series in a box, `pad` in from the edges; a flat series runs through the middle. */
export function sparkPoints(values: readonly number[], width: number, height: number, pad: number, domain?: { min: number; max: number }): SparkPoint[] {
  const n = values.length;
  if (n < 2) return [];
  const min = domain?.min ?? Math.min(...values);
  const max = domain?.max ?? Math.max(...values);
  const span = max - min;
  return values.map((v, i) => ({
    x: pad + (i / (n - 1)) * (width - 2 * pad),
    y: span === 0 ? height / 2 : pad + (1 - (v - min) / span) * (height - 2 * pad),
  }));
}

export function pathOf(points: readonly SparkPoint[]): string {
  return points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
}

export function lengthOf(points: readonly SparkPoint[]): number {
  let l = 0;
  for (let i = 1; i < points.length; i += 1) l += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return l;
}

/** The draw progress of a line (0 → 1, once per mount, when it may start): `drawn` is 1 from the frame the draw starts
 *  (the stroke is transparent before it). */
export function useDraw({ start, delay = 0, duration = t.sweepS, index }: { start?: boolean; delay?: number; duration?: number; index?: number }): { p: SharedValue<number>; drawn: SharedValue<number> } {
  const { tier, still } = useMotion();
  const p = useSharedValue(still ? 1 : 0);
  const drawn = useSharedValue(still ? 1 : 0);
  const ms = tier === 'C' ? motionValues.chart.lineMsC : duration;
  useDataStart(start, index, !still, (wait) => {
    'worklet';
    const w = wait + delay;
    drawn.set(1);
    const anim = withTiming(1, timing(ms, ease.expo));
    p.set(w > 0 ? withDelay(w, anim) : anim);
  });
  useEffect(() => {
    if (still) { p.set(1); drawn.set(1); }
  }, [still, p, drawn]);
  return { p, drawn };
}

/** The path length as a shared value, set before paint whenever the series changes. */
export function useLength(L: number): SharedValue<number> {
  const length = useSharedValue(L);
  useLayoutEffect(() => { length.set(L); }, [L, length]);
  return length;
}

/** strokeDashoffset and strokeOpacity of a drawing line, on the UI thread. */
export function useLineProps(length: SharedValue<number>, draw: { p: SharedValue<number>; drawn: SharedValue<number> }, opacity = 1) {
  return useAnimatedProps(() => {
    const k = Math.max(0, Math.min(1, draw.p.get()));
    // a draw that has started shows from its first frame; the moment p is 0 it shows nothing (offset = DASH)
    return { strokeDashoffset: DASH - k * length.get(), strokeOpacity: draw.drawn.get() === 1 && k > 0 ? opacity : 0 };
  });
}

export type SparklineProps = {
  values: readonly number[];
  width?: number;
  height?: number;
  color?: string;
  strokeWidth?: number;
  /** Hold the draw until true; left out, it follows the nearest Reveal (or draws at once outside one). */
  start?: boolean;
  delay?: number;
  /** Position among siblings: each waits 80 ms more. */
  index?: number;
  /** Spoken summary; the line is decorative without one. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

/** Home 60×24 (stroke 2.4), Bio 120×40 (stroke 2). */
export function Sparkline({ values, width = 60, height = 24, color = fx.red.brand, strokeWidth = 2.4, start, delay = 0, index = 0, accessibilityLabel, style }: SparklineProps) {
  const points = useMemo(() => sparkPoints(values, width, height, strokeWidth / 2 + 1), [values, width, height, strokeWidth]);
  const L = lengthOf(points);
  const length = useLength(L);
  const draw = useDraw({ start, delay: delay + index * 80 });
  const line = useLineProps(length, draw);
  const hidden = !accessibilityLabel;
  return <View style={[{ width, height }, style]} accessible={!hidden} accessibilityLabel={accessibilityLabel}
    accessibilityElementsHidden={hidden} importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}>
    {points.length ? <Svg width={width} height={height}>
      <AnimatedPath d={pathOf(points)} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
        strokeDasharray={DASH_ARRAY} animatedProps={line} />
    </Svg> : null}
  </View>;
}

/** Heart-rate style: an area (the colour at .08) under a 1.8 line with a soft glow stroke; 48 high by default. */
export function AreaSpark({ values, width = 120, height = 48, color = fx.red.brand, strokeWidth = 1.8, start, delay = 0, index = 0, accessibilityLabel, style }: SparklineProps) {
  const points = useMemo(() => sparkPoints(values, width, height, strokeWidth / 2 + 3), [values, width, height, strokeWidth]);
  const L = lengthOf(points);
  const length = useLength(L);
  const draw = useDraw({ start, delay: delay + index * 80 });
  const line = useLineProps(length, draw);
  const glow = useLineProps(length, draw, 0.25);
  const area = useAnimatedProps(() => ({ fillOpacity: 0.08 * Math.max(0, Math.min(1, (draw.p.get() - 0.15) / 0.85)) }));
  const hidden = !accessibilityLabel;
  const d = pathOf(points);
  const last = points[points.length - 1];
  const first = points[0];
  return <View style={[{ width, height }, style]} accessible={!hidden} accessibilityLabel={accessibilityLabel}
    accessibilityElementsHidden={hidden} importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}>
    {points.length ? <Svg width={width} height={height}>
      <AnimatedPath d={`${d} L${last.x.toFixed(2)} ${height} L${first.x.toFixed(2)} ${height} Z`} fill={color} animatedProps={area} />
      <AnimatedPath d={d} fill="none" stroke={color} strokeWidth={strokeWidth + 4} strokeLinecap="round" strokeLinejoin="round"
        strokeDasharray={DASH_ARRAY} animatedProps={glow} />
      <AnimatedPath d={d} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
        strokeDasharray={DASH_ARRAY} animatedProps={line} />
    </Svg> : null}
  </View>;
}
