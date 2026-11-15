/* The onboarding particle network (THEME §12.4, PREMIUM §1.10): red dots (r 1.5 at .25) drifting slowly and wrapping
   at the edges, joined by thin lines when closer than 120 pt (fainter with distance, .08·(1 − d/120)), the whole layer
   at .4. Drawn as a few SVG paths whose `d` a frame callback rebuilds on the UI thread at most 30 times a second (the
   lines in three distance bands, so each band has one opacity). Tier A 50 particles, tier B 24; tier C and calm: the
   first frame, still. Pauses while the page is not active (the frame callback is switched off on that edge) or the
   screen is not in front, and drifts only for the motion budget (5 s after focus or the last touch: ./budget), then
   rests where it is. Decorative and touch-transparent. */
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, { useAnimatedProps, useAnimatedReaction, useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { fx } from '@/theme';
import { useMotion } from './tier';
import { useMotionBudget } from './budget';
import { useLoopGate } from './loop';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const LINK = 120;
const SPEED = 0.15 / 16.7; // the earlier app: ±0.15 px per 60 Hz frame
const BANDS = [40, 80, 120] as const;

type P = { x: number; y: number; vx: number; vy: number };

function seed(n: number, w: number, h: number): P[] {
  let a = 0x5eed;
  const rand = () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff; };
  return Array.from({ length: n }, () => ({ x: rand() * w, y: rand() * h, vx: (rand() * 2 - 1) * SPEED, vy: (rand() * 2 - 1) * SPEED }));
}

function build(ps: readonly P[]): { dots: string; lines: [string, string, string] } {
  'worklet';
  let dots = '';
  const lines: [string, string, string] = ['', '', ''];
  for (let i = 0; i < ps.length; i += 1) {
    const p = ps[i];
    dots += `M${(p.x - 1.5).toFixed(1)} ${p.y.toFixed(1)}a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0`;
    for (let j = i + 1; j < ps.length; j += 1) {
      const q = ps[j];
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d >= LINK) continue;
      const b = d < BANDS[0] ? 0 : d < BANDS[1] ? 1 : 2;
      lines[b] += `M${p.x.toFixed(1)} ${p.y.toFixed(1)}L${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
    }
  }
  return { dots, lines };
}

function Field({ width, height, count, run, active }: { width: number; height: number; count: number; run: boolean; active: SharedValue<number> }) {
  const start = useMemo(() => seed(count, width, height), [count, width, height]);
  const state = useSharedValue(start);
  const shapes = useSharedValue(build(start));
  const last = useSharedValue(0);

  useEffect(() => { state.set(start); shapes.set(build(start)); }, [start, state, shapes]);

  const frame = useFrameCallback((info) => {
    'worklet';
    const now = info.timestamp;
    if (now - last.get() < 33) return; // 30 fps is plenty for a slow drift
    const dt = Math.min(100, last.get() ? now - last.get() : 33);
    last.set(now);
    const next = state.get().map((p) => {
      let x = p.x + p.vx * dt;
      let y = p.y + p.vy * dt;
      if (x < 0) x += width; else if (x > width) x -= width;
      if (y < 0) y += height; else if (y > height) y -= height;
      return { x, y, vx: p.vx, vy: p.vy };
    });
    state.set(next);
    shapes.set(build(next));
  }, false);

  // runs while allowed and the page is active (the page-active edge switches it on and off)
  const switchTo = (on: boolean) => {
    frame.setActive(on);
    if (!on) last.set(0);
  };
  useAnimatedReaction(() => run && active.get() === 1, (on, was) => {
    if (on !== was) scheduleOnRN(switchTo, on);
  });
  useEffect(() => () => frame.setActive(false), [frame]);

  const dotsProps = useAnimatedProps(() => ({ d: shapes.get().dots || 'M0 0' }));
  const band0 = useAnimatedProps(() => ({ d: shapes.get().lines[0] || 'M0 0' }));
  const band1 = useAnimatedProps(() => ({ d: shapes.get().lines[1] || 'M0 0' }));
  const band2 = useAnimatedProps(() => ({ d: shapes.get().lines[2] || 'M0 0' }));
  const opacityFor = (i: number) => 0.08 * (1 - (i === 0 ? 20 : i === 1 ? 60 : 100) / LINK);

  return <Svg width={width} height={height}>
    <AnimatedPath fill="none" stroke={fx.red.brand} strokeWidth={0.5} strokeOpacity={opacityFor(0)} animatedProps={band0} />
    <AnimatedPath fill="none" stroke={fx.red.brand} strokeWidth={0.5} strokeOpacity={opacityFor(1)} animatedProps={band1} />
    <AnimatedPath fill="none" stroke={fx.red.brand} strokeWidth={0.5} strokeOpacity={opacityFor(2)} animatedProps={band2} />
    <AnimatedPath fill={fx.red.a25} animatedProps={dotsProps} />
  </Svg>;
}

export function Particles({ style }: { style?: StyleProp<ViewStyle> }) {
  const { tier, still } = useMotion();
  const { active, visible } = useLoopGate();
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width === 0 || height === 0) return; // a detached page reports 0 × 0
    if (!box || Math.abs(box.w - width) > 1 || Math.abs(box.h - height) > 1) setBox({ w: Math.round(width), h: Math.round(height) });
  };
  const count = tier === 'A' ? 50 : 24;
  const run = useMotionBudget(!still && tier !== 'C' && visible, undefined, active);
  return <View pointerEvents="none" onLayout={onLayout} style={[StyleSheet.absoluteFill, { opacity: 0.4 }, style]}
    accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
    {box ? <Field width={box.w} height={box.h} count={count} run={run} active={active} /> : null}
  </View>;
}
