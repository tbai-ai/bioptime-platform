/* TrendChart: one series over time (the Bio metric sheet, Life's marker trend, Profile), THEME §11.6 and PREMIUM §1.10
   Bio and Life. Grid lines at white .08 (0.5), an optional laboratory range band (gold dashed lines at low and high
   that fade in over 400 ms) and three clocks: the line draws over 900 ms expo; each dot pops (ease.pop, 300 ms) when a
   linear twin of the line's clock passes its x; the latest point pops on its own clock, 900 ms in, over 500 ms with
   ease.pop. Tier C: the line in 400 ms with the dots. A new series (a range chip changed) crossfades old and new over
   250 ms: no path morphing. It starts with an explicit `start`, else the nearest Reveal's landing, else at once, and
   only while the page is active.
   The width follows the container; the height is fixed. The chart speaks one summary sentence (pass it as
   `accessibilityLabel`, e.g. "Resting heart rate: 6 values from 62 to 58"); everything inside is hidden from screen
   readers. Calm and the pre-rendered HTML: drawn, dots shown. */
import React, { useEffect, useMemo, useState } from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect } from 'react-native-svg';
import Animated, { useAnimatedProps, useSharedValue, withDelay, withTiming, type SharedValue } from 'react-native-reanimated';
import { fx } from '@/theme';
import { ease, motionValues, timing } from './tokens';
import { useMotion } from './tier';
import { DASH, DASH_ARRAY, lengthOf, pathOf, sparkPoints, useLength, type SparkPoint } from './Sparkline';
import { useDataStart } from './Reveal';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedG = Animated.createAnimatedComponent(G);

export type TrendChartProps = {
  values: readonly number[];
  height?: number;
  color?: string;
  /** The laboratory or target range: gold dashed lines and a faint band. */
  range?: { low: number; high: number } | null;
  /** Horizontal grid lines (default 3). */
  grid?: number;
  dots?: boolean;
  /** Hold the draw until true; left out, it follows the nearest Reveal (or draws at once outside one). */
  start?: boolean;
  delay?: number;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
};

const PAD = 8;

/** A dot: pops (ease.pop over chart.dotMs) when the linear twin of the line clock passes its x; the latest point pops
 *  on its own clock (`point`). */
function Dot({ twin, point, at, x, y, r, color, latest, lineMs }: { twin: SharedValue<number>; point: SharedValue<number>; at: number; x: number; y: number; r: number; color: string; latest: boolean; lineMs: number }) {
  const props = useAnimatedProps(() => {
    const v = latest ? point.get() : Math.max(0, Math.min(1, ((twin.get() - at) * lineMs) / motionValues.chart.dotMs));
    const s = latest ? v : ease.pop(v);
    return { r: r * (0.4 + 0.6 * s), opacity: v > 0 ? 1 : 0 };
  });
  return <AnimatedCircle cx={x} cy={y} fill={color} animatedProps={props} />;
}

function Series({ points, color, dots, progress, twin, point, fade, lineMs }: { points: SparkPoint[]; color: string; dots: boolean; progress: SharedValue<number>; twin: SharedValue<number>; point: SharedValue<number>; fade: SharedValue<number>; lineMs: number }) {
  const length = useLength(lengthOf(points));
  const line = useAnimatedProps(() => {
    const k = Math.max(0, Math.min(1, progress.get()));
    return { strokeDashoffset: DASH - k * length.get(), strokeOpacity: k > 0 ? 1 : 0 };
  });
  const group = useAnimatedProps(() => ({ opacity: fade.get() }));
  const n = points.length;
  return <AnimatedG animatedProps={group}>
    <AnimatedPath d={pathOf(points)} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      strokeDasharray={DASH_ARRAY} animatedProps={line} />
    {dots ? points.map((pt, i) => (
      <Dot key={i} twin={twin} point={point} at={n > 1 ? i / (n - 1) : 0} x={pt.x} y={pt.y} r={i === n - 1 ? 4 : 2.5} color={color} latest={i === n - 1} lineMs={lineMs} />
    )) : null}
  </AnimatedG>;
}

export function TrendChart({ values, height = 120, color = fx.red.brand, range, grid = 3, dots = true, start, delay = 0, accessibilityLabel, style }: TrendChartProps) {
  const { tier, still } = useMotion();
  const [width, setWidth] = useState(0);
  const domain = useMemo(() => {
    const all = [...values, ...(range ? [range.low, range.high] : [])];
    if (!all.length) return { min: 0, max: 1 };
    const min = Math.min(...all);
    const max = Math.max(...all);
    const padV = (max - min || Math.abs(max) || 1) * 0.1;
    return { min: min - padV, max: max + padV };
  }, [values, range]);
  const points = useMemo(() => (width > 0 ? sparkPoints(values, width, height, PAD, domain) : []), [values, width, height, domain]);
  const yOf = (v: number) => PAD + (1 - (v - domain.min) / (domain.max - domain.min)) * (height - 2 * PAD);

  // the current and the previous series, for the 250 ms crossfade
  const [shown, setShown] = useState<{ key: number; points: SparkPoint[] }[]>([]);
  const progress = useSharedValue(still ? 1.5 : 0);
  const { lineMs: lineA, lineMsC, pointDelay, pointMs, dotMs } = motionValues.chart;
  const lineMs = tier === 'C' ? lineMsC : lineA;
  const twinEnd = 1 + dotMs / lineMs; // the twin runs on past the line's end so the last dots finish their pop
  const twin = useSharedValue(still ? twinEnd : 0);
  const point = useSharedValue(still ? 1 : 0);
  const fadeIn = useSharedValue(1);
  const fadeOut = useSharedValue(0);
  const band = useSharedValue(still ? 1 : 0);
  const drawnOnce = useSharedValue(still ? 1 : 0);
  const hasPoints = points.length > 0;

  // the first draw: on the UI thread, once laid out, when the page is active (and the card has landed)
  useDataStart(start, undefined, !still && hasPoints, (wait) => {
    'worklet';
    if (drawnOnce.get() === 1) return;
    drawnOnce.set(1);
    const w = wait + delay;
    const at = <T,>(a: T) => (w > 0 ? withDelay(w, a as never) : a);
    fadeIn.set(1);
    band.set(at(withTiming(1, timing(400))));
    progress.set(0);
    twin.set(0);
    point.set(0);
    progress.set(at(withTiming(1, timing(lineMs, ease.expo))));
    twin.set(at(withTiming(twinEnd, { duration: lineMs + dotMs, easing: ease.linear })));
    // tier C: the latest point pops with the line
    point.set(withDelay(w + (tier === 'C' ? 0 : pointDelay), withTiming(1, timing(tier === 'C' ? lineMs : pointMs, ease.pop))));
  });

  useEffect(() => {
    if (!points.length) return;
    setShown((prev) => {
      const next = { key: (prev[prev.length - 1]?.key ?? 0) + 1, points };
      return prev.length ? [prev[prev.length - 1], next] : [next];
    });
    if (still) { progress.set(1.5); twin.set(twinEnd); point.set(1); band.set(1); drawnOnce.set(1); return; }
    if (drawnOnce.get() === 1) {
      // a new series: crossfade, already drawn
      progress.set(1.5);
      twin.set(twinEnd);
      point.set(1);
      fadeIn.set(0);
      fadeIn.set(withTiming(1, timing(250)));
      fadeOut.set(1);
      fadeOut.set(withTiming(0, timing(250)));
    }
    // a new series (or the first width) restarts the chart
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, still]);

  const bandProps = useAnimatedProps(() => ({ opacity: band.get() }));
  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w > 0) setWidth(w); // a detached page reports 0 × 0
  };
  const current = shown[shown.length - 1];
  const previous = shown.length > 1 ? shown[0] : null;

  return <View style={[{ height }, style]} onLayout={onLayout} accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
    {width > 0 ? <Svg width={width} height={height}>
      {Array.from({ length: grid }, (_, i) => {
        const y = PAD + ((i + 1) / (grid + 1)) * (height - 2 * PAD);
        return <Line key={i} x1={0} x2={width} y1={y} y2={y} stroke={fx.line.a08} strokeWidth={0.5} />;
      })}
      {range ? <AnimatedG animatedProps={bandProps}>
        <Rect x={0} width={width} y={yOf(range.high)} height={Math.max(0, yOf(range.low) - yOf(range.high))} fill={fx.gold.base} fillOpacity={0.06} />
        <Line x1={0} x2={width} y1={yOf(range.high)} y2={yOf(range.high)} stroke={fx.gold.base} strokeWidth={1} strokeDasharray="4 4" />
        <Line x1={0} x2={width} y1={yOf(range.low)} y2={yOf(range.low)} stroke={fx.gold.base} strokeWidth={1} strokeDasharray="4 4" />
      </AnimatedG> : null}
      {previous ? <Series key={previous.key} points={previous.points} color={color} dots={dots} progress={progress} twin={twin} point={point} fade={fadeOut} lineMs={lineMs} /> : null}
      {current ? <Series key={current.key} points={current.points} color={color} dots={dots} progress={progress} twin={twin} point={point} fade={fadeIn} lineMs={lineMs} /> : null}
    </Svg> : null}
  </View>;
}
