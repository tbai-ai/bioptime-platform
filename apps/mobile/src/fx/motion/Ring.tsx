/* Progress rings (THEME §11.6, PREMIUM §1.4 "Ring sweeps", CRITIQUE §14), drawn with react-native-svg.
   - The arc is a circle whose strokeDashoffset (C·(1 − p), C computed from the radius) animates on the UI thread.
   - Glow is layered strokes under the arc on every tier (no SVG filter): the Wellness Score keeps the earlier app's 22 px at
     .25 and 16 px at .12 (tier C drops the 16); tier A adds PREMIUM's extras: an outer 30 px at .06, the gradient arc
     (#FF5740 → #EE3324 → #C41C0D), a specular arc, the groove and the halo's slow pulse.
   - The knob sits at the arc's end (θ = −90° + 360°·p), fixing the earlier app's dot that trailed 90° behind it.
   - Real values only: `value` null leaves the ring empty with no sweep, no knob, and the centre shows what the caller
     puts there ("—"). A later change sweeps from the old value over 600 ms.
   - Sweeps: Wellness Score 1800 ms expo, metric 1000 ms expo (stagger index × 60), target 1000 ms cubic-out, mini
     1200 ms expo, timer linear over the remaining seconds. Tier C 800 ms; calm and pre-rendered HTML: the final state.
   - When it starts: an explicit `start` holds the sweep until it is true; without one, inside a Reveal the sweep starts
     120 ms after the card's entrance begins (+ 60 ms per grid index, at most 4: Reveal's useDataStart); outside a
     Reveal at once. Every sweep waits for the page to be active (usePageActive), so a pre-mounted page holds its
     rings empty and spends no first visit.
   - `progress` (a 0..1 shared value the caller drives): the arc shows prior + progress × (value − prior) on the
     caller's clock, so a number counting on the same clock (CountUp `progress`) never drifts from the arc.
   - `seenKey`: once this key has swept in this run, a later mount (a revisit) draws the arc at rest, and a changed
     value sweeps from the one shown last over 600 ms (src/fx/motion/seen). The share is recorded when the sweep
     actually starts on an active page.
   - TimerRing runs one linear clock per rest to `endAt` (never re-armed each second), freezes on pause, and gives one
     1.04 beat when it reaches 0 (tiers A and B). The halo's loop runs only while its page is active. */
import React, { useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, RadialGradient, Stop } from 'react-native-svg';
import Animated, { cancelAnimation, useAnimatedProps, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { fx, svgStop } from '@/theme';
import { markSeen, seenValue } from './seen';
import { ease, motionValues, spring, t, timing } from './tokens';
import { useMotion, type MotionTier } from './tier';
import { useSvgId } from './svgId';
import { useMotionBudget } from './budget';
import { useLoopGate } from './loop';
import { pageScrollMoving } from './gestureState';
import { useDataStart, useRevealLanding } from './Reveal';
import { nativeRadial } from '../Gradient';

/** Android: the halo's two discs as radial-gradient backgrounds (Gradient nativeRadial), the same stops as the SVG's. */
const HALO_WASH = nativeRadial([{ color: fx.premium.halo, at: 0 }, { color: fx.premium.haloMid, at: 0.55 }, { color: fx.premium.halo, alpha: 0, at: 0.7 }]);
const CORE_WASH = nativeRadial([{ color: fx.premium.haloCore, at: 0 }, { color: fx.premium.haloCore, alpha: 0, at: 1 }]);

/** The score ring's halo stops (theme svgStop). */
const HALO = svgStop(fx.premium.halo);
const HALO_MID = svgStop(fx.premium.haloMid);
const HALO_CORE = svgStop(fx.premium.haloCore);

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedGroup = Animated.createAnimatedComponent(G);

type Layer = { width: number; color: string; opacity?: number };

/* ---------- one arc ---------- */

function Arc({ p, c, r, width, color, opacity = 1, cap = 1 }: { p: SharedValue<number>; c: number; r: number; width: number; color: string; opacity?: number; cap?: number }) {
  const C = 2 * Math.PI * r;
  const props = useAnimatedProps(() => {
    const v = Math.min(p.get(), cap);
    return { strokeDashoffset: C * (1 - v), strokeOpacity: v > 0.0005 ? opacity : 0 };
  });
  return <AnimatedCircle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round"
    strokeDasharray={`${C} ${C}`} transform={`rotate(-90 ${c} ${c})`} animatedProps={props} />;
}

function KnobDot({ p, c, r, rad, fill, fillOpacity, show }: { p: SharedValue<number>; c: number; r: number; rad: number; fill: string; fillOpacity?: number; show: boolean }) {
  const props = useAnimatedProps(() => {
    const v = p.get();
    const th = -Math.PI / 2 + Math.PI * 2 * v; // unrotated SVG space: 0 at the top, clockwise
    return { cx: c + r * Math.cos(th), cy: c + r * Math.sin(th), opacity: show && v > 0.0005 ? 1 : 0 };
  });
  return <AnimatedCircle r={rad} fill={fill} fillOpacity={fillOpacity} animatedProps={props} />;
}

/** The knob at the arc's end: r 10 at .25, r 7 in the arc colour, r 2.8 white. */
function Knob({ p, c, r, color, show }: { p: SharedValue<number>; c: number; r: number; color: string; show: boolean }) {
  return <G>
    <KnobDot p={p} c={c} r={r} rad={10} fill={fx.red.a25} show={show} />
    <KnobDot p={p} c={c} r={r} rad={7} fill={color} show={show} />
    <KnobDot p={p} c={c} r={r} rad={2.8} fill={fx.ink.white} fillOpacity={0.95} show={show} />
  </G>;
}

/* ---------- the shared engine ---------- */

type Kind = 'score' | 'metric' | 'target' | 'mini' | 'timer';

export type RingProps = {
  /** 0..max; null: no value yet (empty ring, no sweep). */
  value: number | null;
  max?: number;
  /** Box size in points (default per kind). */
  size?: number;
  /** Arc colour (default brand red; metric rings pass their status colour). */
  color?: string;
  /** Hold the sweep until true (an explicit start wins over the nearest Reveal's landing). */
  start?: boolean;
  /** Extra wait before the sweep (ms). */
  delay?: number;
  /** Position in a grid (metric rings stagger by 60 ms). */
  index?: number;
  /** The centre (number, unit, label); laid over the ring. */
  children?: React.ReactNode;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  /** Show at rest on a revisit: a key naming this ring (e.g. 'home.score'); see the header. */
  seenKey?: string;
  /** The caller's 0..1 clock: the arc follows it (one clock with a CountUp `progress`). */
  progress?: SharedValue<number>;
};

const GEOMETRY: Record<Kind, { size: number; vb: number; r: number; stroke: number }> = {
  score: { size: 210, vb: 200, r: 82, stroke: 13 },
  metric: { size: 80, vb: 80, r: 36, stroke: 6 },
  target: { size: 180, vb: 180, r: 80, stroke: 14 },
  mini: { size: 84, vb: 84, r: 30, stroke: 8 },
  timer: { size: 144, vb: 144, r: 54, stroke: 8 },
};

function glowFor(kind: Kind, tier: MotionTier, color: string): Layer[] {
  switch (kind) {
    case 'score':
      // The earlier app blurred its 22 px stroke by 8 px; without filters, tier A feathers it with wider, fainter strokes
      return [
        ...(tier === 'A' ? [
          { width: 46, color: fx.red.brand, opacity: 0.025 }, { width: 38, color: fx.red.brand, opacity: 0.04 },
          { width: 30, color: fx.red.a06 }, { width: 26, color: fx.red.brand, opacity: 0.08 },
        ] : []),
        { width: 22, color: fx.premium.ringGlow },
        ...(tier === 'C' ? [] : [{ width: 16, color: fx.premium.ringGlow2 }]),
      ];
    case 'metric': return [{ width: 10, color, opacity: 0.12 }];
    case 'target': return [...(tier === 'A' ? [{ width: 28, color, opacity: 0.05 }] : []), { width: 22, color, opacity: 0.1 }];
    case 'mini': return [{ width: 14, color, opacity: 0.18 }];
    case 'timer': return [{ width: 12, color, opacity: 0.1 }];
  }
}

function sweepFor(kind: Kind, tier: MotionTier): { ms: number; easing: (x: number) => number } {
  if (tier === 'C') return { ms: motionValues.screens.m64.arcC, easing: ease.expo };
  switch (kind) {
    case 'score': return { ms: t.sweepL, easing: ease.expo };
    case 'metric': return { ms: t.metricRing, easing: ease.expo };
    case 'target': return { ms: 1000, easing: ease.cubicOut };
    case 'mini': return { ms: t.sweepM, easing: ease.expo };
    case 'timer': return { ms: 0, easing: ease.linear };
  }
}

/** The arc's share, 0..1: its own sweep (started by useDataStart), or the caller's clock when `external` is given. */
function useSweep(kind: Kind, value: number | null, max: number, start: boolean | undefined, delay: number, index: number | undefined, seenKey?: string, external?: SharedValue<number>) {
  const { tier, still } = useMotion();
  const empty = value == null;
  const target = value == null ? 0 : Math.max(0, Math.min(1, value / max));
  const key = seenKey ? `ring:${seenKey}` : undefined;
  const [prior] = useState(() => seenValue(key)); // the share drawn last time, read once on mount
  const p = useSharedValue(still ? target : prior ?? 0);
  const swept = useSharedValue(prior !== undefined ? 1 : 0);
  const reveal = useRevealLanding();
  const { ms, easing } = sweepFor(kind, tier);
  // outside the Reveal rule (an explicit start, or no Reveal) the old stagger stays: delay + index × 60 for metric rings
  const own = start !== undefined || !reveal;
  const firstWait = own ? delay + (kind === 'metric' ? (index ?? 0) * 60 : 0) : delay;
  const mark = (share: number) => { markSeen(key, share); };

  const fired = useDataStart(start, index, !empty && !still && !external, (wait) => {
    'worklet';
    scheduleOnRN(mark, target);
    if (swept.get() === 1 && Math.abs(p.get() - target) < 1e-6) return; // already there (a revisit)
    const first = swept.get() === 0;
    swept.set(1);
    const anim = withTiming(target, timing(first ? ms : t.change, first ? easing : ease.expo));
    const total = wait + (first ? firstWait : 0);
    p.set(total > 0 ? withDelay(total, anim) : anim);
  });

  // a later change, once the first sweep has started, moves from the share shown over 600 ms
  useEffect(() => {
    if (external) return;
    if (empty) { cancelAnimation(p); p.set(0); return; }
    if (still) { cancelAnimation(p); p.set(target); markSeen(key, target); return; }
    if (fired.get() !== 1) return; // the start sweeps to the latest value
    markSeen(key, target);
    if (p.get() === target) return;
    p.set(withTiming(target, timing(t.change, ease.expo)));
    // the sweep follows the value
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, empty, still]);

  // the caller's clock: prior + progress × (target − prior); the share is remembered when it starts moving
  const base = prior ?? 0;
  useAnimatedReaction(() => (external ? external.get() > 0 : false), (moving, was) => {
    if (moving && !was && !empty) scheduleOnRN(mark, target);
  });
  return useDerivedValue(() => {
    if (!external) return p.get();
    if (empty) return 0;
    if (still) return target;
    const k = Math.max(0, Math.min(1, external.get()));
    return base + k * (target - base);
  });
}

function RingFrame({ size, label, value, max, children, style, under }: { size: number; label?: string; value: number | null; max: number; children: React.ReactNode; style?: StyleProp<ViewStyle>; under?: React.ReactNode }) {
  return <View
    style={[{ width: size, height: size }, style]}
    accessibilityRole="progressbar"
    accessibilityLabel={label}
    accessibilityValue={value == null ? undefined : { min: 0, max, now: Math.round(value) }}
  >
    {under}
    {children}
  </View>;
}

function Centre({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.centre]}>{children}</View>;
}

/* ---------- Wellness Score ring (210, ticks, knob, halo) ---------- */

function Ticks({ c }: { c: number }) {
  return <G>
    {Array.from({ length: 36 }, (_, i) => {
      const th = (i * 10 - 90) * (Math.PI / 180);
      const major = i % 3 === 0;
      const r0 = 95;
      const r1 = major ? 88 : 91;
      return <Line key={i} x1={c + r0 * Math.cos(th)} y1={c + r0 * Math.sin(th)} x2={c + r1 * Math.cos(th)} y2={c + r1 * Math.sin(th)}
        stroke={major ? fx.premium.tick : fx.premium.tickMinor} strokeWidth={major ? 1.5 : 0.8} strokeLinecap="round" />;
    })}
  </G>;
}

/** The pulsing radial halo behind the score ring (inset −18) and its 112 pt core. A: loops .55 → 1 → .55 over 3.2 s for
 *  the motion budget (5 s after focus or the last touch: ./budget) while its page is active (stopped on the UI thread
 *  the frame the page goes inactive, resumed from where it was the frame it is active again), then eases to .8 and
 *  rests; B (and calm on A/B): still at .8; C: still at .55. */
function Halo({ size }: { size: number }) {
  const { tier, still } = useMotion();
  const { active, visible } = useLoopGate();
  const id = useSvgId('fxHalo');
  const allowed = tier === 'A' && !still && visible;
  const loop = useMotionBudget(allowed, undefined, active);
  const o = useSharedValue(tier === 'C' ? 0.55 : loop ? 0.55 : 0.8);
  const rest = tier === 'C' ? 0.55 : 0.8;
  // a scrolling page holds the breath where it is (pageScrollMoving) and resumes it from there
  useAnimatedReaction(() => (loop && active.get() === 1 && pageScrollMoving.get() === 0 ? 1 : 0), (go, was) => {
    if (go === was) return;
    if (go === 1) {
      // resume from the current opacity: up to 1 first, then the 3.2 s breath
      const now = o.get();
      const half = t.halo / 2;
      const up = withTiming(1, { duration: Math.max(1, half * (1 - Math.max(0, now - 0.55) / 0.45)), easing: ease.cssInOut });
      o.set(withSequence(up, withRepeat(withTiming(0.55, { duration: half, easing: ease.cssInOut }), -1, true)));
      return;
    }
    cancelAnimation(o);
    if (!loop) o.set(allowed ? withTiming(0.8, timing(600, ease.cssInOut)) : rest);
  });
  useEffect(() => () => cancelAnimation(o), [o]);
  const animated = useAnimatedStyle(() => ({ opacity: o.get() }));
  const box = size + 36;
  const core = 112 * (size / 210);
  if (HALO_WASH && CORE_WASH) {
    // Android: no SVG (a software bitmap of the halo's whole box, drawn on the UI thread as Home arrives)
    return <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: -18, top: -18, width: box, height: box }, HALO_WASH, animated]}>
      <View style={[{ position: 'absolute', left: (box - core) / 2, top: (box - core) / 2, width: core, height: core }, CORE_WASH]} />
    </Animated.View>;
  }
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: -18, top: -18, width: box, height: box }, animated]}>
    <Svg width={box} height={box}>
      <Defs>
        {/* opaque colours with stopOpacity (theme svgStop): Android drops an alpha inside stopColor */}
        <RadialGradient id={`${id}h`} cx="50%" cy="50%" r="50%">
          <Stop offset="0" {...HALO} />
          <Stop offset="0.55" {...HALO_MID} />
          <Stop offset="0.7" stopColor={HALO.stopColor} stopOpacity={0} />
          <Stop offset="1" stopColor={HALO.stopColor} stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id={`${id}c`} cx="50%" cy="50%" r="50%">
          <Stop offset="0" {...HALO_CORE} />
          <Stop offset="1" stopColor={HALO_CORE.stopColor} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={box / 2} cy={box / 2} r={box / 2} fill={`url(#${id}h)`} />
      <Circle cx={box / 2} cy={box / 2} r={core / 2} fill={`url(#${id}c)`} />
    </Svg>
  </Animated.View>;
}

export type ScoreRingProps = RingProps & { /** The halo behind the ring (default on). */ halo?: boolean };

export function ScoreRing({ value, max = 100, size, start, delay = 0, children, accessibilityLabel, style, halo = true, seenKey, progress }: ScoreRingProps) {
  const { tier } = useMotion();
  const g = GEOMETRY.score;
  const box = size ?? g.size;
  const c = g.vb / 2;
  const p = useSweep('score', value, max, start, delay, undefined, seenKey, progress);
  const id = useSvgId('fxArc');
  const rich = tier === 'A';
  const arcColor = rich ? `url(#${id})` : fx.red.brand;
  return <RingFrame size={box} label={accessibilityLabel} value={value} max={max} style={style} under={halo ? <Halo size={box} /> : null}>
    <Svg width={box} height={box} viewBox={`0 0 ${g.vb} ${g.vb}`}>
      {rich ? <Defs>
        <LinearGradient id={id} x1="1" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={fx.premium.arc[0]} />
          <Stop offset="0.55" stopColor={fx.premium.arc[1]} />
          <Stop offset="1" stopColor={fx.premium.arc[2]} />
        </LinearGradient>
      </Defs> : null}
      <Ticks c={c} />
      {rich ? <Circle cx={c} cy={c} r={88.5} fill="none" stroke={fx.premium.grooveOuter} strokeWidth={1} /> : null}
      <Circle cx={c} cy={c} r={g.r} fill="none" stroke={fx.premium.ringTrack} strokeWidth={g.stroke} />
      {rich ? <Circle cx={c} cy={c} r={75.5} fill="none" stroke={fx.premium.groove} strokeWidth={1} /> : null}
      {glowFor('score', tier, fx.red.brand).map((l, i) => <Arc key={i} p={p} c={c} r={g.r} width={l.width} color={l.color} opacity={l.opacity} />)}
      <Arc p={p} c={c} r={g.r} width={g.stroke} color={arcColor} />
      {rich ? <Arc p={p} c={c} r={79.5} width={1.5} color={fx.premium.specular} cap={0.3} /> : null}
      <Knob p={p} c={c} r={g.r} color={fx.red.brand} show={value != null} />
    </Svg>
    <Centre>{children}</Centre>
  </RingFrame>;
}

/* ---------- the smaller rings ---------- */

function SimpleRing({ kind, value, max = 100, size, color = fx.red.brand, start, delay = 0, index, children, accessibilityLabel, style, track, seenKey, progress }: RingProps & { kind: Kind; track: string }) {
  const { tier } = useMotion();
  const g = GEOMETRY[kind];
  const box = size ?? g.size;
  const c = g.vb / 2;
  const p = useSweep(kind, value, max, start, delay, index, seenKey, progress);
  const id = useSvgId('fxDisc');
  const disc = kind === 'mini' && tier === 'A';
  return <RingFrame size={box} label={accessibilityLabel} value={value} max={max} style={style}>
    <Svg width={box} height={box} viewBox={`0 0 ${g.vb} ${g.vb}`}>
      {disc ? <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color} stopOpacity={0.2} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs> : null}
      {disc ? <Circle cx={c} cy={c} r={c} fill={`url(#${id})`} /> : null}
      <Circle cx={c} cy={c} r={g.r} fill="none" stroke={track} strokeWidth={g.stroke} />
      {glowFor(kind, tier, color).map((l, i) => <Arc key={i} p={p} c={c} r={g.r} width={l.width} color={l.color} opacity={l.opacity} />)}
      <Arc p={p} c={c} r={g.r} width={g.stroke} color={color} />
    </Svg>
    <Centre>{children}</Centre>
  </RingFrame>;
}

/** Bio metric ring: 80 pt, r 36, stroke 6, the status colour; sweeps 1000 ms after `index` × 60 ms. */
export function MetricRing(props: RingProps) {
  return <SimpleRing kind="metric" track={fx.premium.ringTrackSoft} {...props} />;
}

/** Fuel plan target ring: 180 pt, r 80, stroke 14; 1000 ms cubic-out. */
export function TargetRing(props: RingProps) {
  return <SimpleRing kind="target" track={fx.premium.ringTrackSoft} {...props} />;
}

/** Wearable / steps mini ring: 84 pt, r 30, stroke 8; 1200 ms expo; tier A adds the soft disc of its colour. */
export function MiniRing(props: RingProps) {
  return <SimpleRing kind="mini" track={fx.premium.ringTrackSoft} {...props} />;
}

export type TimerRingProps = Omit<RingProps, 'value' | 'max' | 'start' | 'delay' | 'index' | 'seenKey' | 'progress'> & {
  /** Seconds left and the full length; the arc shows remaining / total. */
  remaining: number;
  total: number;
  /** While true the arc runs down linearly to 0 over `remaining` seconds. */
  running: boolean;
  /** Epoch ms at which this rest ends (null while paused): one linear clock per rest, armed once. Without it the ring
   *  keeps its own end from `remaining` when it starts running and re-arms only when the seconds drift by more than 1. */
  endAt?: number | null;
  /** The colour it turns at 0 (default green, over 300 ms). */
  doneColor?: string;
};

/** The player's timer ring: 144 pt, r 54, stroke 8. Linear while running; green at 0 with one beat. */
export function TimerRing({ remaining, total, running, endAt, size, color = fx.red.brand, doneColor = fx.hue.green500, children, accessibilityLabel, style }: TimerRingProps) {
  const { tier, still } = useMotion();
  const g = GEOMETRY.timer;
  const box = size ?? g.size;
  const c = g.vb / 2;
  const share = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
  const p = useSharedValue(share);
  const green = useSharedValue(remaining <= 0 ? 1 : 0);
  const beat = useSharedValue(1);

  // the end of this rest: the caller's endAt, or one kept here from `remaining` (re-armed only on a drift over 1 s)
  const [kept, setKept] = useState<number | null>(() => (running && remaining > 0 ? Date.now() + remaining * 1000 : null));
  useEffect(() => {
    if (endAt !== undefined) return;
    if (!running || remaining <= 0) { setKept(null); return; }
    const due = Date.now() + remaining * 1000;
    setKept((k) => (k == null || Math.abs(k - due) > 1000 ? due : k));
  }, [endAt, running, remaining]);
  const end = endAt !== undefined ? endAt : kept;

  useEffect(() => {
    cancelAnimation(p);
    if (end == null || still) { p.set(share); return; } // paused (frozen at the share shown) or calm
    const left = Math.max(0, end - Date.now());
    p.set(total > 0 ? Math.max(0, Math.min(1, left / 1000 / total)) : 0);
    if (left > 0) p.set(withTiming(0, { duration: left, easing: ease.linear }));
    // one clock per rest: armed when the end or the length changes, never on each second's tick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [end, total, still]);

  useEffect(() => {
    const done = remaining <= 0;
    green.set(done ? withTiming(1, timing(still ? 0 : 300)) : 0);
    if (done && !still && tier !== 'C') beat.set(withSequence(withSpring(motionValues.timer.beat, spring.pop), withSpring(1, spring.pop)));
    else beat.set(1);
  }, [remaining <= 0, still, tier, green, beat]); // eslint-disable-line react-hooks/exhaustive-deps

  const doneStyle = useAnimatedProps(() => ({ opacity: green.get() }));
  const beatStyle = useAnimatedStyle(() => (beat.get() === 1 ? { transform: [] } : { transform: [{ scale: beat.get() }] }));
  return <RingFrame size={box} label={accessibilityLabel} value={Math.round(share * 100)} max={100} style={style}>
    <Animated.View style={[StyleSheet.absoluteFill, beatStyle]}>
      <Svg width={box} height={box} viewBox={`0 0 ${g.vb} ${g.vb}`}>
        <Circle cx={c} cy={c} r={g.r} fill="none" stroke={fx.premium.ringTrackSoft} strokeWidth={g.stroke} />
        {glowFor('timer', tier, color).map((l, i) => <Arc key={i} p={p} c={c} r={g.r} width={l.width} color={l.color} opacity={l.opacity} />)}
        <Arc p={p} c={c} r={g.r} width={g.stroke} color={color} />
        <AnimatedGroup animatedProps={doneStyle}>
          <Circle cx={c} cy={c} r={g.r} fill="none" stroke={doneColor} strokeWidth={g.stroke} />
        </AnimatedGroup>
      </Svg>
    </Animated.View>
    <Centre>{children}</Centre>
  </RingFrame>;
}

const styles = StyleSheet.create({
  centre: { alignItems: 'center', justifyContent: 'center' },
});
