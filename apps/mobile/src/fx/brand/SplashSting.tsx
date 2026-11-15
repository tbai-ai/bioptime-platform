/* The Bioptime splash sting (PREMIUM §1.7; AMENDED §1 "Splash length", "Splash tagline"; CRITIQUE §15). Cold start only
   (F's app/index.tsx renders it), on black, built from the brand's own vectors and timed to brand-anim.css. One clock
   (ms, on the UI thread) drives every layer; each layer's state is a pure function of it.

   Full sting, 3.5 s (tier A; tier B has no orbs or sheen and three depth copies instead of six):
     0–900      ambient orbs fade to .8, then drift (tier A)
     150–1150   the white loop draws (a sweep mask, ease in-out); 300–1300 the red loop
     0–1500     the mark settles: scale 1.08 → 1, rotateY −22° → 0 and rotateX 8° → 0 under perspective 420 (ease.turn),
                its depth copies showing while it is turned
     1050–2450  the red bloom behind it: scale .7 → 1.18, opacity up to 1 at 35 % then down to .35
     1150–2035  the seven rungs grow (scaleX .25 → 1, 420 ms expo, 55 ms apart) and cool from red to slate (700 ms)
     1350–2050  a specular sheen crosses the loops (tier A)
     1500–2560  the wordmark rises glyph by glyph (760 ms expo, 50 ms apart); the Skip pill appears at 1500
     2150–3350  a ring pings from the o
     2200–3100  the tagline's letters slide in from their offsets (900 ms expo, 8 ms apart)
     2950–3420  the helix heartbeat: rungs pulse slate → red → slate (760 ms, 70 ms apart)
     3000–3520  exit: wordmark, tagline and orbs fade (280 ms); the flat mark hands off to the next screen (MarkHandoff)
   As the overlay above the navigator (SplashHost, the cold start), the exit hands over without a gap, in steps that
   each wait for the one before, so no mount or long task of the next screen lands in a frame that moves: a restored
   session's Home, mounted under the lockup at mark.earlyMountAt (onEarly), has drawn its mark and settled; the sting
   releases the route (the sign-in mounts; Home's page turns active) while the whole lockup still covers it; the next
   screen has drawn its mark and mark.startFrames quiet frames follow; then the black and the words fade over it in
   280 ms and the mark stays until the next screen has drawn its own mark at the same place (handoffTaken), which then
   flies home (motion v2 M45: one window for both ends, motionValues.mark.cap, tier C mark.waitC; past it the hand-off
   is cancelled and the mark fades once, so a late screen's mark enters with its column instead of flying). The
   overlay leaves once that mark has landed.
   The clock starts on the sting's first painted frame (its stage's layout, then a frame), not while JS boots.
   On Android and iOS the native splash shows the finished mark (assets/splash/mark.png, 120 dp, 160 dp from 700 dp
   wide) at the window's centre: as the overlay the sting starts from it (C03). Its mark sits at the window's centre
   (the lockup below it), complete and flat from the first frame in the full, light and short sting (the loops' draw,
   the rungs' growth and cooling, the turn and the settle are skipped; the bloom, sheen, words, ping and heartbeat play
   as timed), and the calm lockup shows at once around it. The native splash goes once the stage, or the calm lockup,
   has painted its first frame over it.
   Tier C, 2.4 s: draw, rungs and wordmark only (no 3D, bloom, sheen, orbs, ping or heartbeat). As the overlay the
   centred lockup leaves over the first half of the black's fade (the marks crossfade, so it is never over the screen
   beneath as that shows through).
   A cold start within 10 minutes of the last full sting (bp.fx.splashAt), 1.2 s: loops 0–700, wordmark 400–900, exit.
   Reduced motion, 0.9 s: the lockup fades in over 300 ms, holds to 700 ms and fades over 200 ms; as the overlay the
   next screen opens and draws under the held lockup first (a restored Home mounts there at 300 ms), and the lockup and
   the black then fade together over t.calm, so no black frame comes between them.
   If auth is not ready when the exit is due, the flat lockup holds with the earlier app's 48 pt ring loader until it is,
   never longer than 9 s from the start. Any tap after 1.5 s goes to the exit: the clock stays where it is, what has not
   risen fades with the words (splash.skipFadeMs, ease.exit) while the mark completes, and the hand-off starts at once;
   the Skip pill answers the touch itself (splash.skipPress*). The splash draws no text but "Skip"; the
   lockup's label is "Bioptime. Your wellness, our passion.". No sound, no haptics. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import Svg, { Circle, ClipPath, Defs, Ellipse, G, LinearGradient, Mask, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import Animated, { cancelAnimation, ReduceMotion, useAnimatedProps, useAnimatedReaction, useAnimatedRef, useAnimatedStyle, useDerivedValue, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { measureView } from '../motion/measured';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import { fx, svgStop } from '@/theme';
import { FONTS } from '@/fx/type';
import { loadDeviceSettings, peekSetting, setSetting } from '@/fx/device/settings';
import { layerOffset, revealAmount } from '@/motion/depthMath';
import { motion as staffMotion } from '@/motion/values';
import { ease, motionValues, t as tm } from '@/fx/motion/tokens';
import { hump, keyframes, mix, seg } from '@/fx/motion/curve';
import { warmUnder } from '@/fx/motion/gestureState';
import { useMotion, type MotionTier } from '@/fx/motion/tier';
import { Orbs } from '@/fx/motion/Orbs';
import { Spinner } from '@/fx/motion/Spinner';
import { useSvgId } from '@/fx/motion/svgId';
import { BLOOM, GLYPH_RISE, GLYPHS, LOCKUP_BOX, LOOP_RED, LOOP_WHITE, MARK_BOX, PING, RUNGS, STAGE_BOX, SWEEP_RED, SWEEP_WHITE, TAGLINE, WORD_CLIP, type Box } from './markData';
import { markColors, viewBoxOf } from './MarkPaths';
import { Lockup, TAGLINE_BOX } from './Wordmark';
import {
  afterQuietFrames, cancelMarkHandoff, expectMarkHandoff, flightTransform, handoffTaken, holdMarkFlight, isMarkLaidOut, markFlight, markFlightP, onMarkLanded,
  QUIET_CAP_MS, recordMarkHandoff, registerFlyingSource, subscribeMarkHandoff, type HandoffTarget,
} from './MarkLayer';

/** The bloom's stops (theme svgStop). */
const BLOOM_STOP = svgStop(fx.premium.bloom);
const BLOOM_MID = svgStop(fx.premium.bloomMid);

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedRect = Animated.createAnimatedComponent(Rect);

const LABEL = 'Bioptime. Your wellness, our passion.';
const SHORT_WITHIN = 10 * 60 * 1000;
const CAP_MS = 9000;
const HOLD_SPINNER_AFTER = 200;

/* ---------- timelines (ms) ---------- */

type Variant = 'full' | 'light' | 'short';
type Timeline = {
  variant: Variant;
  sweepW: [number, number]; sweepR: [number, number];
  settle: number; turn: boolean; copies: number;
  bloom: [number, number] | null;
  rungs: { start: number; step: number; grow: number; cool: number };
  sheen: [number, number] | null;
  glyphs: { start: number; step: number; dur: number };
  skip: number | null;
  ping: [number, number] | null;
  tagline: { start: number; step: number; dur: number; letters: boolean };
  beat: { start: number; step: number; dur: number } | null;
  orbs: boolean;
  exit: number;
};

function timelineFor(variant: Variant, tier: MotionTier, fromNative: boolean): Timeline {
  const tl = timelineOf(variant, tier);
  // from the native splash's finished mark: the mark is complete and flat from the first frame (C03)
  return fromNative ? { ...tl, turn: false, copies: 0, rungs: { ...tl.rungs, cool: 0 } } : tl;
}

function timelineOf(variant: Variant, tier: MotionTier): Timeline {
  if (variant === 'short') {
    return {
      variant, sweepW: [0, 700], sweepR: [100, 600], settle: 900, turn: false, copies: 0, bloom: null,
      rungs: { start: 300, step: 30, grow: 300, cool: 0 }, sheen: null, glyphs: { start: 400, step: 30, dur: 500 }, skip: null,
      ping: null, tagline: { start: 500, step: 0, dur: 400, letters: false }, beat: null, orbs: false, exit: 900,
    };
  }
  if (variant === 'light') {
    return {
      variant, sweepW: [150, 1000], sweepR: [300, 1000], settle: 1500, turn: false, copies: 0, bloom: null,
      rungs: { start: 1150, step: 55, grow: 420, cool: 700 }, sheen: null, glyphs: { start: 1300, step: 50, dur: 600 }, skip: 1500,
      ping: null, tagline: { start: 1600, step: 0, dur: 400, letters: false }, beat: null, orbs: false, exit: 2000,
    };
  }
  return {
    variant, sweepW: [150, 1000], sweepR: [300, 1000], settle: 1500, turn: true, copies: tier === 'A' ? 6 : 3, bloom: [1050, 1400],
    rungs: { start: 1150, step: 55, grow: 420, cool: 700 }, sheen: tier === 'A' ? [1350, 700] : null,
    glyphs: { start: 1500, step: 50, dur: 760 }, skip: 1500, ping: [2150, 1200],
    tagline: { start: 2200, step: 8, dur: 900, letters: true }, beat: { start: 2950, step: 70, dur: 760 }, orbs: tier === 'A', exit: 3000,
  };
}

const EXIT_FADE = 280;
const NAVIGATE_AFTER = 120;
/** The loader row under the lockup (styles.loader): its gap above and its height. */
const LOADER_GAP = 24;
const LOADER_H = 64;
const mv = motionValues.mark;
const sp = motionValues.splash;
/* The sting picks its own reduced-motion variant (the 0.9 s fade), so its clock and fades always run as timed. */
const clockTiming = (duration: number, easing = ease.linear) => ({ duration, easing, reduceMotion: ReduceMotion.Never });

/* ---------- geometry: the stage's user units → points ---------- */

type Place = { left: number; top: number; width: number; height: number };
function place(b: Box, k: number, origin: Box = STAGE_BOX): Place {
  return { left: (b[0] - origin[0]) * k, top: (b[1] - origin[1]) * k, width: b[2] * k, height: b[3] * k };
}

/* ---------- layers ---------- */

/** Both loops, each revealed by its sweep mask (a circle stroked as wide as its diameter, drawn from its start angle). */
function MaskedLoops({ clock, tl, width, height, sheen, skip }: { clock: SharedValue<number>; tl: Timeline; width: number; height: number; sheen?: boolean; skip: Readonly<SharedValue<number>> }) {
  const id = useSvgId('fxSweep');
  const Cw = 2 * Math.PI * SWEEP_WHITE.r;
  const Cr = 2 * Math.PI * SWEEP_RED.r;
  const white = useAnimatedProps(() => ({ strokeDashoffset: Cw * (1 - Math.max(skip.get(), ease.inOut(seg(clock.get(), tl.sweepW[0], tl.sweepW[1])))) }));
  const red = useAnimatedProps(() => ({ strokeDashoffset: Cr * (1 - Math.max(skip.get(), ease.inOut(seg(clock.get(), tl.sweepR[0], tl.sweepR[1])))) }));
  const [mx, my, mw, mh] = MARK_BOX;
  const band = useAnimatedProps(() => {
    if (!tl.sheen) return { x: mx, opacity: 0 };
    const s = ease.inOut(seg(clock.get(), tl.sheen[0], tl.sheen[1]));
    return { x: mx + mix(-0.6, 1.6, s) * mw - 0.15 * mw, opacity: 0.22 * hump(s) };
  });
  const cx = mx + mw / 2;
  const cy = my + mh / 2;
  return <Svg width={width} height={height} viewBox={viewBoxOf(MARK_BOX)}>
    <Defs>
      <Mask id={`${id}w`} maskUnits="userSpaceOnUse" x={mx} y={my} width={mw} height={mh}>
        <AnimatedCircle cx={SWEEP_WHITE.cx} cy={SWEEP_WHITE.cy} r={SWEEP_WHITE.r} fill="none" stroke={fx.ink.white} strokeWidth={SWEEP_WHITE.r * 2}
          strokeDasharray={`${Cw} ${Cw}`} transform={SWEEP_WHITE.transform} animatedProps={white} />
      </Mask>
      <Mask id={`${id}r`} maskUnits="userSpaceOnUse" x={mx} y={my} width={mw} height={mh}>
        <AnimatedCircle cx={SWEEP_RED.cx} cy={SWEEP_RED.cy} r={SWEEP_RED.r} fill="none" stroke={fx.ink.white} strokeWidth={SWEEP_RED.r * 2}
          strokeDasharray={`${Cr} ${Cr}`} transform={SWEEP_RED.transform} animatedProps={red} />
      </Mask>
      {sheen ? <ClipPath id={`${id}c`}>
        <Path d={LOOP_WHITE} />
        <Path d={LOOP_RED} />
      </ClipPath> : null}
      {sheen ? <LinearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="0">
        <Stop offset="0" stopColor={fx.ink.white} stopOpacity={0} />
        <Stop offset="0.5" stopColor={fx.ink.white} stopOpacity={1} />
        <Stop offset="1" stopColor={fx.ink.white} stopOpacity={0} />
      </LinearGradient> : null}
    </Defs>
    <Path d={LOOP_WHITE} fill={markColors.white} mask={`url(#${id}w)`} />
    <Path d={LOOP_RED} fill={markColors.red} mask={`url(#${id}r)`} />
    {sheen ? <G clipPath={`url(#${id}c)`}>
      <G transform={`rotate(20 ${cx} ${cy})`}>
        <AnimatedRect y={my - mh} width={0.3 * mw} height={mh * 3} fill={`url(#${id}g)`} animatedProps={band} />
      </G>
    </G> : null}
  </Svg>;
}

type Angles = { rx: number; ry: number; flat: boolean };

function DepthCopy({ index, clock, tl, angles, width, height, depthUnit, skip }: { index: number; clock: SharedValue<number>; tl: Timeline; angles: SharedValue<Angles>; width: number; height: number; depthUnit: number; skip: Readonly<SharedValue<number>> }) {
  const depth = (staffMotion.mark.base + index * staffMotion.mark.gap) * depthUnit;
  const animated = useAnimatedStyle(() => {
    const a = angles.get();
    if (a.flat) return { opacity: 0, transform: [] };
    const o = layerOffset(depth, a.rx, a.ry, staffMotion.perspective.mark);
    return { opacity: (staffMotion.mark.opacity[index - 1] ?? 0) * revealAmount(a.rx, a.ry), transform: [{ translateX: o.x }, { translateY: o.y }, { scale: o.scale }] };
  });
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, animated]}>
    <MaskedLoops clock={clock} tl={tl} width={width} height={height} skip={skip} />
  </Animated.View>;
}

function Rung({ i, clock, tl, k, skip, fade }: { i: number; clock: SharedValue<number>; tl: Timeline; k: number; skip: Readonly<SharedValue<number>>; fade: SharedValue<number> }) {
  const r = RUNGS[i];
  const p = place(r.box, k, MARK_BOX);
  const start = tl.rungs.start + i * tl.rungs.step;
  const grow = useAnimatedStyle(() => {
    const v = Math.max(skip.get(), ease.expo(seg(clock.get(), start, tl.rungs.grow)));
    if (v >= 1) return { opacity: 1, transform: [] };
    return { opacity: v, transform: [{ scaleX: 0.25 + 0.75 * v }] };
  });
  const warm = useAnimatedProps(() => {
    const now = clock.get();
    let o = 0;
    if (tl.rungs.cool > 0 && now >= start) {
      const c = seg(now, start, tl.rungs.cool);
      o = c < 0.35 ? 1 : 1 - ease.css((c - 0.35) / 0.65);
    }
    if (tl.beat) {
      const b0 = tl.beat.start + i * tl.beat.step;
      if (now >= b0) {
        const h = seg(now, b0, tl.beat.dur);
        o = Math.max(o, keyframes(h, [0, 0.4, 1], [0, 1, 0], ease.cssInOut));
      }
    }
    return { opacity: o * (1 - fade.get()) };
  });
  return <Animated.View style={[{ position: 'absolute', ...p }, grow]}>
    <Svg width={p.width} height={p.height} viewBox={viewBoxOf(r.box)}>
      <Path d={r.d} fill={markColors.slate} />
      <AnimatedPath d={r.d} fill={markColors.red} animatedProps={warm} />
    </Svg>
  </Animated.View>;
}

function Glyph({ i, clock, tl, k, exit }: { i: number; clock: SharedValue<number>; tl: Timeline; k: number; exit: Readonly<SharedValue<number>> }) {
  const g = GLYPHS[i];
  const p = place(g.box, k, WORD_CLIP);
  const start = tl.glyphs.start + i * tl.glyphs.step;
  const rise = GLYPH_RISE * k;
  const animated = useAnimatedStyle(() => {
    const now = clock.get();
    const v = ease.expo(seg(now, start, tl.glyphs.dur));
    const o = seg(now, start, 200) * (1 - exit.get());
    if (v >= 1) return { opacity: o, transform: [] };
    return { opacity: o, transform: [{ translateY: rise * (1 - v) }] };
  });
  return <Animated.View style={[{ position: 'absolute', ...p }, animated]}>
    <Svg width={p.width} height={p.height} viewBox={viewBoxOf(g.box)}>
      <Path d={g.d} fill={g.red ? markColors.red : markColors.white} />
    </Svg>
  </Animated.View>;
}

function Letter({ i, clock, tl, k, exit }: { i: number; clock: SharedValue<number>; tl: Timeline; k: number; exit: Readonly<SharedValue<number>> }) {
  const l = TAGLINE[i];
  const p = place(l.box, k);
  const start = tl.tagline.start + i * tl.tagline.step;
  const dx = l.dx * k;
  const animated = useAnimatedStyle(() => {
    const v = ease.expo(seg(clock.get(), start, tl.tagline.dur));
    const o = v * (1 - exit.get());
    if (v >= 1) return { opacity: o, transform: [] };
    return { opacity: o, transform: [{ translateX: dx * (1 - v) }] };
  });
  return <Animated.View style={[{ position: 'absolute', ...p }, animated]}>
    <Svg width={p.width} height={p.height} viewBox={viewBoxOf(l.box)}>
      <Path d={l.d} fill={markColors.white} />
    </Svg>
  </Animated.View>;
}

function TaglineFade({ clock, tl, k, exit }: { clock: SharedValue<number>; tl: Timeline; k: number; exit: Readonly<SharedValue<number>> }) {
  const p = place(TAGLINE_BOX, k);
  const animated = useAnimatedStyle(() => ({ opacity: ease.expo(seg(clock.get(), tl.tagline.start, tl.tagline.dur)) * (1 - exit.get()) }));
  return <Animated.View style={[{ position: 'absolute', ...p }, animated]}>
    <Svg width={p.width} height={p.height} viewBox={viewBoxOf(TAGLINE_BOX)}>
      {TAGLINE.map((l, i) => <Path key={i} d={l.d} fill={markColors.white} />)}
    </Svg>
  </Animated.View>;
}

function Bloom({ clock, tl, k }: { clock: SharedValue<number>; tl: Timeline; k: number }) {
  const id = useSvgId('fxBloom');
  const box: Box = [BLOOM.cx - BLOOM.rx, BLOOM.cy - BLOOM.ry, BLOOM.rx * 2, BLOOM.ry * 2];
  const p = place(box, k);
  const span = tl.bloom;
  const animated = useAnimatedStyle(() => {
    if (!span) return { opacity: 0 };
    const u = seg(clock.get(), span[0], span[1]);
    if (u <= 0) return { opacity: 0, transform: [{ scale: 0.7 }] };
    const opacity = u < 0.35 ? ease.expo(u / 0.35) : 1 - 0.65 * ease.expo((u - 0.35) / 0.65);
    return { opacity, transform: [{ scale: 0.7 + 0.48 * ease.expo(u) }] };
  });
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', ...p }, animated]}>
    <Svg width={p.width} height={p.height} viewBox={viewBoxOf(box)}>
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          {/* opaque colours with stopOpacity (theme svgStop): Android drops an alpha inside stopColor */}
          <Stop offset="0" {...BLOOM_STOP} />
          <Stop offset="0.45" {...BLOOM_MID} />
          <Stop offset="0.7" stopColor={BLOOM_STOP.stopColor} stopOpacity={0} />
          <Stop offset="1" stopColor={BLOOM_STOP.stopColor} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Ellipse cx={BLOOM.cx} cy={BLOOM.cy} rx={BLOOM.rx} ry={BLOOM.ry} fill={`url(#${id})`} />
    </Svg>
  </Animated.View>;
}

function Ping({ clock, tl, k, exit }: { clock: SharedValue<number>; tl: Timeline; k: number; exit: Readonly<SharedValue<number>> }) {
  const half = PING.r + PING.stroke;
  const box: Box = [PING.cx - half, PING.cy - half, half * 2, half * 2];
  const p = place(box, k);
  const span = tl.ping;
  const animated = useAnimatedStyle(() => {
    if (!span) return { opacity: 0 };
    const now = clock.get();
    if (now < span[0] || now > span[0] + span[1]) return { opacity: 0 };
    const u = seg(now, span[0], span[1]);
    return { opacity: keyframes(u, [0, 0.45, 1], [0.9, 0.5, 0], ease.ping) * (1 - exit.get()), transform: [{ scale: mix(0.92, 1.75, ease.ping(u)) }] };
  });
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', ...p }, animated]}>
    <Svg width={p.width} height={p.height} viewBox={viewBoxOf(box)}>
      <Circle cx={PING.cx} cy={PING.cy} r={PING.r} fill="none" stroke={markColors.red} strokeWidth={PING.stroke} />
    </Svg>
  </Animated.View>;
}

/* ---------- the sting ---------- */

export type SplashStingProps = {
  /** Auth has answered (useAuth().ready): the sting may exit. */
  ready: boolean;
  /** Called once, as the exit starts (navigate now: the next screen's mark takes over). */
  onDone: () => void;
  /** Where the mark hands off: the sign-in tile, or Home's header ring when a session was restored. */
  target?: HandoffTarget;
  /** Called on the sting's first layout (hide the native splash then). */
  onFirstFrame?: () => void;
  /** Always the full sting (the gallery), ignoring the 10-minute rule. */
  replay?: boolean;
  /** Drawn above the navigator (SplashHost): `onDone` comes as the exit starts, and the black fades over the next screen. */
  overlay?: boolean;
  /** As an overlay: called once nothing of the splash is left on screen (unmount it then). */
  onGone?: () => void;
  /** As an overlay: called once the sting's clock passes motionValues.mark.earlyMountAt while it still runs (a
   *  restored session mounts Home under the lockup then). */
  onEarly?: () => void;
};

export function SplashSting({ ready, onDone, target = 'signin', onFirstFrame, replay, overlay, onGone, onEarly }: SplashStingProps) {
  const { tier, calm } = useMotion();
  const { width: screenW } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [variant, setVariant] = useState<Variant | 'calm' | null>(null);
  // run → (hold: auth not ready) → wait (as an overlay: the next screen mounts, draws and settles under the whole lockup)
  // → exit (the words and the black fade, the mark is handed over)
  const [phase, setPhase] = useState<'run' | 'hold' | 'wait' | 'exit'>('run');
  const [spinner, setSpinner] = useState(false);
  const clock = useSharedValue(0);
  const exit = useSharedValue(0);
  const calmFade = useSharedValue(0);
  const markOut = useSharedValue(0); // as an overlay: the mark fading when no screen took it
  const skipP = useSharedValue(0); // a skip: the mark completes while what has not risen fades with the words
  // CRT-4: tier C, as the overlay, the next screen is drawn at rest under the black (the sign-in's preview card at the
  // window's centre) and its mark crossfades in at its own place (MarkHandoff), so the centred lockup leaves ahead of
  // the reveal, on the exit's own clock: (1 − 2·exit)², gone once the black is half faded (it sat over the preview card
  // and its button for about 190 ms). The square keeps the steps even when the exit's first frames come late (its
  // ease is slow at the start). Tier A and B fly the mark and calm fades the lockup with the black: 0 there
  const ahead = !!overlay && tier === 'C' && !calm;
  const lockOut = useDerivedValue(() => {
    if (!ahead) return 0;
    const k = 1 - Math.min(1, 2 * exit.get());
    return 1 - k * k;
  });
  // the words, the ping, the orbs and the Skip pill: they go with the exit, and at once on a skip (the black and the mark
  // stay until the next screen has drawn and settled)
  const wordsOut = useDerivedValue(() => Math.max(exit.get(), skipP.get(), lockOut.get()));
  const skipPress = useSharedValue(0);
  const markRef = useAnimatedRef();
  const clockStarted = useRef(false);
  const t0 = useRef(Date.now());
  const finished = useRef(false);
  const exiting = useRef(false);
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const targetRef = useRef(target);
  targetRef.current = target;
  // as an overlay: gone once the black has faded and the mark was taken (or faded)
  const left = useRef({ fade: false, mark: false, gone: false });
  const markTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const landTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelWait = useRef<(() => void) | null>(null);
  useEffect(() => () => {
    if (markTimer.current) clearTimeout(markTimer.current);
    if (landTimer.current) clearTimeout(landTimer.current);
    cancelWait.current?.();
    warmUnder.set(0);
  }, []);
  const leave = (part: 'fade' | 'mark') => {
    const l = left.current;
    l[part] = true;
    if (part === 'mark' && markTimer.current) { clearTimeout(markTimer.current); markTimer.current = null; }
    if (part === 'mark' && landTimer.current) { clearTimeout(landTimer.current); landTimer.current = null; }
    if (l.fade && l.mark && !l.gone) { l.gone = true; onGone?.(); }
  };
  const fadeDone = () => leave('fade');
  const markDone = () => leave('mark');
  // the next screen drew the mark at the splash's place: the splash's own mark goes in the same frame (style below).
  // The overlay leaves once that mark has landed (so its unmount never lands in the flight), or the cap after it was taken.
  const taken = () => {
    if (left.current.mark || landTimer.current) return;
    landTimer.current = setTimeout(() => { landTimer.current = null; markDone(); }, mv.cap);
  };
  useAnimatedReaction(() => (overlay && exit.get() > 0 ? handoffTaken.get() : 0), (v, was) => { if (v >= 1 && !(was != null && was >= 1)) scheduleOnRN(taken); });
  const recorded = useRef(false);
  // as an overlay the sting flies its own mark to the destination (MarkLayer: flightTransform), above every screen
  useEffect(() => (overlay ? registerFlyingSource() : undefined), [overlay]);
  useEffect(() => (overlay ? onMarkLanded(() => { if (recorded.current) markDone(); }) : undefined), [overlay]); // eslint-disable-line react-hooks/exhaustive-deps
  // a restored session: Home mounts under the lockup while the sting still runs (SplashHost, app/index)
  const earlyFired = useRef(false);
  const early = () => { earlyFired.current = true; onEarly?.(); };
  useAnimatedReaction(() => clock.get() >= mv.earlyMountAt, (on, was) => { if (on && !was && overlay) scheduleOnRN(early); });

  // the mark is 120 pt wide (160 on tablets, as the native splash's drawable-w700dp mark); the stage around it follows
  const markW = screenW >= 700 ? 160 : 120;
  const k = markW / MARK_BOX[2];
  const stageW = STAGE_BOX[2] * k;
  const stageH = STAGE_BOX[3] * k;
  // C03: on Android and iOS the cold start's overlay follows the native splash, which shows the finished mark at the
  // window's centre. The sting starts from it: its mark at the same place (the column below shifts down by `centreTop`,
  // so the mark's centre, not the column's, is at the window's centre) and complete from the first frame (`markSkip`).
  const fromNative = !!overlay && Platform.OS !== 'web';
  const drawn = fromNative ? 1 : 0;
  const markSkip = useDerivedValue(() => Math.max(skipP.get(), drawn));
  const markCy = (body: Box) => (MARK_BOX[1] - body[1] + MARK_BOX[3] / 2) * k;
  const centreTop = (body: Box) => body[3] * k + LOADER_GAP + LOADER_H - 2 * markCy(body);

  // one object per variant: every layer's worklets capture it, so a new one on each render (the exit's phase changes)
  // would rebuild every animated style of the sting in the frames of its fade
  const tlVariant: Variant = variant === 'short' ? 'short' : variant === 'light' ? 'light' : 'full';
  const tl = useMemo(() => timelineFor(tlVariant, tier, fromNative), [tlVariant, tier, fromNative]);

  // choose the variant once the device settings are known (the 10-minute rule)
  useEffect(() => {
    let live = true;
    loadDeviceSettings().then(() => {
      if (!live) return;
      const last = peekSetting('splashAt');
      if (calm) { setVariant('calm'); return; }
      const recent = !replay && typeof last === 'number' && Date.now() - last < SHORT_WITHIN;
      const v: Variant = recent ? 'short' : tier === 'C' ? 'light' : 'full';
      if (v !== 'short') void setSetting('splashAt', Date.now());
      setVariant(v);
    });
    return () => { live = false; };
    // decided once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const done = () => {
    if (finished.current) return;
    finished.current = true;
    onDone();
  };

  // as an overlay: record where the mark is, then open the next screen underneath (in that order, so it finds the
  // record). The mark stays drawn until the next screen draws it (handoffTaken); one window, the cap, for both ends:
  // past it the hand-off is cancelled (a late screen's mark enters with its column) and the mark fades, once.
  const handOver = (frame: { x: number; y: number; w: number; h: number } | null) => {
    // a destination that never drew within the window gets no flight: it enters with its column, the mark fades once
    const drawn = isMarkLaidOut(targetRef.current);
    if (frame && drawn) { recorded.current = true; recordMarkHandoff(frame, targetRef.current); }
    else if (frame) cancelMarkHandoff();
    else { expectMarkHandoff(null); holdMarkFlight(false); }
    markTimer.current = setTimeout(() => {
      markTimer.current = null;
      if (handoffTaken.get() > 0) return;
      cancelMarkHandoff();
      markOut.set(withTiming(1, clockTiming(tm.fast), (f) => { 'worklet'; if (f) scheduleOnRN(markDone); }));
    }, frame && drawn ? (tier === 'C' ? mv.waitC : mv.cap) : 0);
  };

  // the words and the black fade over the next screen and the mark is handed over. After a skip the clock stays where
  // it was: what has not risen has faded already (splash.skipFadeMs, ease.exit) and the words go the same way.
  const fadeOut = () => {
    // a mark about to fly into Home holds Home's data motion from this frame on (the flight is recorded a few frames
    // later), so the score's sweep that waited under the lockup never starts in between, under the flying mark
    if (targetRef.current === 'home' && isMarkLaidOut('home')) holdMarkFlight(true);
    warmUnder.set(0); // the black starts to fade: what waits to enter beneath goes back to its start state (0)
    setPhase('exit');
    if (skipped.current) {
      exit.set(withTiming(1, clockTiming(sp.skipFadeMs, ease.exit), (f) => { 'worklet'; if (f && overlay) scheduleOnRN(fadeDone); }));
    } else {
      exit.set(withTiming(1, clockTiming(EXIT_FADE, ease.inOut), (f) => { 'worklet'; if (f && overlay) scheduleOnRN(fadeDone); }));
      clock.set(withTiming(tl.exit + 520, clockTiming(520)));
    }
    scheduleOnUI(() => {
      'worklet';
      const m = measureView(markRef);
      scheduleOnRN(handOver, m ? { x: m.pageX, y: m.pageY, w: m.width, h: m.height } : null);
    });
  };

  // As an overlay the exit goes in steps, each waiting for the one before, so no mount or long task of the next screen
  // ever lands in a frame that moves: (1) a restored session's Home, mounted early under the lockup, has drawn its mark
  // and settled (mark.startFrames quiet frames in a row); (2) the sting releases the route (the sign-in mounts then;
  // Home's page turns active, its entrances start) while the whole lockup still covers it; (3) the next screen has drawn
  // its mark, and quiet frames follow again; (4) the words and the black fade and the mark is handed over. One window
  // for the waits on a screen to draw (mark.cap, tier C mark.waitC) and QUIET_CAP_MS for each wait on quiet frames:
  // past them the steps go on anyway, and a destination that has not drawn gets its mark late.
  const untilDrawn = (target: HandoffTarget, until: number, then: () => void): (() => void) => {
    let live = true;
    let off: () => void = () => undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const go = () => { if (!live) return; live = false; off(); if (timer) clearTimeout(timer); then(); };
    if (isMarkLaidOut(target) || Date.now() >= until) queueMicrotask(go); // (after the caller has kept the cancel)
    else {
      off = subscribeMarkHandoff(() => { if (isMarkLaidOut(target)) go(); });
      timer = setTimeout(go, until - Date.now());
    }
    return () => { live = false; off(); if (timer) clearTimeout(timer); };
  };
  const skipped = useRef(false);
  const runExit = () => {
    if (exiting.current) return;
    exiting.current = true;
    setSpinner(false);
    if (variant === 'calm') {
      if (overlay) {
        // calm, as the moving path does it without the flight: the next screen opens under the still lockup (a restored
        // Home already mounted there at the hold, onEarly) and draws and settles; only then the lockup and the black
        // fade together (t.calm) over a screen that is there, never over black
        setPhase('wait');
        const target = targetRef.current;
        const until = Date.now() + (tier === 'C' ? mv.waitC : mv.cap);
        const settled = (then: () => void) => {
          cancelWait.current = untilDrawn(target, until, () => {
            cancelWait.current = afterQuietFrames(mv.startFrames, QUIET_CAP_MS, () => { cancelWait.current = null; then(); });
          });
        };
        const fade = () => {
          setPhase('exit');
          left.current.mark = true;
          exit.set(withTiming(1, clockTiming(tm.calm)));
          calmFade.set(withTiming(0, clockTiming(tm.calm), (f) => { 'worklet'; if (f) scheduleOnRN(fadeDone); }));
        };
        const release = () => { done(); settled(fade); };
        if (earlyFired.current && target === 'home') settled(release);
        else release();
        return;
      }
      setPhase('exit');
      calmFade.set(withTiming(0, clockTiming(200), (f) => { 'worklet'; if (f) scheduleOnRN(done); }));
      return;
    }
    // a skip answers at once: what has not risen fades now (the words follow with the black)
    if (skipped.current) skipP.set(withTiming(1, clockTiming(sp.skipFadeMs, ease.exit)));
    if (overlay) {
      setPhase('wait');
      const target = targetRef.current;
      const until = Date.now() + (tier === 'C' ? mv.waitC : mv.cap);
      // drawn, then settled: the screen's mark has laid out and mark.startFrames quiet frames follow
      const settled = (then: () => void) => {
        cancelWait.current = untilDrawn(target, until, () => {
          cancelWait.current = afterQuietFrames(mv.startFrames, QUIET_CAP_MS, () => { cancelWait.current = null; then(); });
        });
      };
      // from here to the fade the lockup stands still over the next screen: what waits to enter there draws at a trace
      // opacity meanwhile (gestureState.warmUnder), so its GPU programs compile under the lockup, not in the flight
      const release = () => { done(); warmUnder.set(1); settled(fadeOut); };
      // Home mounted early: it draws and settles (its content's own mounts) under the lockup before the route is
      // released, so the release starts only its entrances; anything else mounts on release
      if (earlyFired.current && target === 'home') { warmUnder.set(1); settled(release); }
      else release();
      return;
    }
    setPhase('exit');
    if (skipped.current) exit.set(withTiming(1, clockTiming(sp.skipFadeMs, ease.exit)));
    else {
      exit.set(withTiming(1, clockTiming(EXIT_FADE, ease.inOut)));
      clock.set(withTiming(tl.exit + 520, clockTiming(520)));
    }
    scheduleOnUI(() => {
      'worklet';
      const m = measureView(markRef);
      if (m) scheduleOnRN(recordMarkHandoff, { x: m.pageX, y: m.pageY, w: m.width, h: m.height }, targetRef.current);
    });
    setTimeout(done, NAVIGATE_AFTER);
  };

  const atExit = () => {
    const capped = Date.now() - t0.current >= CAP_MS;
    if (readyRef.current || capped) runExit();
    else setPhase('hold');
  };

  // the calm variant's clock (a fade and a hold); as the overlay, a restored session's Home mounts under the lockup once
  // it has faded in (onEarly), so it has drawn by the exit
  useEffect(() => {
    if (variant !== 'calm') return;
    t0.current = Date.now();
    // after the native splash's mark the lockup shows at once around it (no fade from black, which would blink the mark)
    if (fromNative) calmFade.set(1);
    else calmFade.set(withTiming(1, clockTiming(300)));
    const mount = overlay ? setTimeout(early, 300) : null;
    const hold = setTimeout(atExit, 700);
    return () => { clearTimeout(hold); if (mount) clearTimeout(mount); };
    // one run per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant]);
  // the sting's clock starts on its first painted frame (its stage's first layout, then a frame), not while JS boots
  const startClock = () => {
    if (clockStarted.current || !variant || variant === 'calm') return;
    clockStarted.current = true;
    const cfg = clockTiming(tl.exit);
    const end = tl.exit;
    requestAnimationFrame(() => {
      t0.current = Date.now();
      scheduleOnUI(() => {
        'worklet';
        clock.set(0);
        clock.set(withTiming(end, cfg, (f) => { 'worklet'; if (f) scheduleOnRN(atExit); }));
      });
    });
  };
  // as an overlay: an early destination (Home mounted under the lockup) waits for the mark from the start
  useEffect(() => {
    if (!overlay || !variant || variant === 'calm' || exiting.current) return;
    expectMarkHandoff(target);
  }, [overlay, variant, target]);
  useEffect(() => () => { if (overlay && !exiting.current) expectMarkHandoff(null); }, [overlay]);

  // holding: exit when auth answers, or at the cap; the ring loader shows after a moment
  useEffect(() => {
    if (phase !== 'hold') return;
    if (ready) { runExit(); return; }
    const spin = setTimeout(() => setSpinner(true), HOLD_SPINNER_AFTER);
    const cap = setTimeout(runExit, Math.max(0, CAP_MS - (Date.now() - t0.current)));
    return () => { clearTimeout(spin); clearTimeout(cap); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, ready]);

  const skip = () => {
    if (!variant || variant === 'calm' || tl.skip == null || phase !== 'run') return;
    if (clock.get() < tl.skip) return;
    cancelAnimation(clock); // the clock stays where it is: nothing snaps to its end state
    skipped.current = true;
    atExit();
  };
  // the pressed state answers the touch itself (a press-in waits for the responder a few frames)
  const pressSkip = (on: boolean) => skipPress.set(withTiming(on ? 1 : 0, clockTiming(sp.skipPressMs, ease.css)));

  // the mark's settle: scale, and the 3D turn its depth copies follow
  const shortSettle = variant === 'short';
  const turn = useDerivedValue<Angles>(() => {
    if (!tl.turn) return { rx: 0, ry: 0, flat: true };
    const kk = (1 - ease.turn(seg(clock.get(), 0, tl.settle))) * (1 - markSkip.get());
    return { rx: 8 * kk, ry: -22 * kk, flat: kk < 0.001 };
  });
  const mark = useAnimatedStyle(() => {
    const e = Math.max(markSkip.get(), ease.expo(seg(clock.get(), 0, tl.settle)));
    const s = shortSettle ? 1.04 - 0.04 * e : 1.08 - 0.08 * e;
    const a = turn.get();
    // as an overlay the mark goes when the next screen has drawn it at this place (tier C: crossfading, and with the
    // words ahead of the reveal, lockOut), or fades once when nothing took it
    const opacity = overlay && exit.get() > 0 ? (1 - Math.min(1, handoffTaken.get())) * (1 - markOut.get()) * (1 - lockOut.get()) : 1;
    // (the flight's values are read here, so this style runs on every frame of it; the settle is over by then)
    const g = markFlight.get();
    const fp = markFlightP.get();
    const flight = overlay && exit.get() > 0 ? flightTransform(g, fp) : null;
    if (flight) return { opacity, transform: flight };
    if (a.flat) return { opacity, transform: s >= 1 ? [] : [{ scale: s }] };
    return { opacity, transform: [{ perspective: staffMotion.perspective.mark }, { rotateX: `${a.rx}deg` }, { rotateY: `${a.ry}deg` }, { scale: s }] };
  });
  const backdrop = useAnimatedStyle(() => ({ opacity: 1 - exit.get() }));
  const orbs = useAnimatedStyle(() => ({ opacity: 0.8 * ease.expo(seg(clock.get(), 0, 900)) * (1 - wordsOut.get()) }));
  const skipStyle = useAnimatedStyle(() => {
    if (tl.skip == null) return { opacity: 0 };
    const v = ease.expo(seg(clock.get(), tl.skip, 300)) * (1 - wordsOut.get());
    const pr = skipPress.get();
    return { opacity: v * (1 - (1 - sp.skipPressOpacity) * pr), transform: [{ translateY: 8 * (1 - v) }, { scale: 1 - (1 - sp.skipPressScale) * pr }] };
  });
  const calmStyle = useAnimatedStyle(() => ({ opacity: calmFade.get() }));

  const markPlace = place(MARK_BOX, k);
  const clipPlace = place(WORD_CLIP, k);
  const stage = { width: stageW, height: stageH };
  // the native splash goes once the stage (or the calm lockup) has painted its first frame over it: the root's own
  // layout comes while the variant is still being chosen, over an empty black screen
  const bodyShown = useRef(false);
  const showBody = () => {
    if (bodyShown.current) return;
    bodyShown.current = true;
    requestAnimationFrame(() => onFirstFrame?.());
  };

  let body: React.ReactNode = null;
  if (variant === 'calm') {
    body = <Animated.View style={calmStyle} onLayout={showBody}>
      <Lockup width={LOCKUP_BOX[2] * k} />
    </Animated.View>;
  } else if (variant) {
    body = <View style={stage} onLayout={() => { startClock(); showBody(); }}>
      {tl.bloom ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, overlay ? backdrop : null]}><Bloom clock={clock} tl={tl} k={k} /></Animated.View> : null}
      <Animated.View style={[{ position: 'absolute', ...markPlace }, mark]}>
        {Array.from({ length: tl.copies }, (_, i) => tl.copies - i).map((i) =>
          <DepthCopy key={i} index={i} clock={clock} tl={tl} angles={turn} width={markPlace.width} height={markPlace.height} depthUnit={markPlace.width} skip={markSkip} />)}
        <Animated.View ref={markRef} collapsable={false} style={StyleSheet.absoluteFill}>
          <MaskedLoops clock={clock} tl={tl} width={markPlace.width} height={markPlace.height} sheen={!!tl.sheen} skip={markSkip} />
          {RUNGS.map((_, i) => <Rung key={i} i={i} clock={clock} tl={tl} k={k} skip={markSkip} fade={skipP} />)}
        </Animated.View>
      </Animated.View>
      <View style={[{ position: 'absolute', ...clipPlace }, styles.clip]}>
        {GLYPHS.map((_, i) => <Glyph key={i} i={i} clock={clock} tl={tl} k={k} exit={wordsOut} />)}
      </View>
      {tl.ping ? <Ping clock={clock} tl={tl} k={k} exit={wordsOut} /> : null}
      {tl.tagline.letters
        ? TAGLINE.map((_, i) => <Letter key={i} i={i} clock={clock} tl={tl} k={k} exit={wordsOut} />)
        : <TaglineFade clock={clock} tl={tl} k={k} exit={wordsOut} />}
    </View>;
  }

  const skippable = !!variant && variant !== 'calm' && tl.skip != null && phase === 'run';
  const skipShown = !!variant && variant !== 'calm' && tl.skip != null; // kept through the exit: it fades with the words
  const leaving = overlay && phase === 'exit'; // the next screen is underneath: touches and screen readers go to it
  return <View
    style={overlay ? styles.overlay : styles.root}
    pointerEvents={leaving ? 'none' : 'auto'}
    accessibilityElementsHidden={leaving}
    importantForAccessibility={leaving ? 'no-hide-descendants' : 'auto'}
    onStartShouldSetResponder={() => skippable}
    onResponderRelease={skip}
  >
    {overlay ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.black, backdrop]} /> : null}
    {tl.orbs && variant === 'full' ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, orbs]}><Orbs preset="auth" /></Animated.View> : null}
    <View style={[styles.centre, fromNative && variant ? { paddingTop: centreTop(variant === 'calm' ? LOCKUP_BOX : STAGE_BOX) } : null]} pointerEvents="none">
      <View accessible accessibilityRole="image" accessibilityLabel={LABEL}>{body}</View>
      <View style={styles.loader}>{spinner ? <Spinner variant="splash" /> : null}</View>
    </View>
    {skipShown ? <Animated.View pointerEvents={skippable ? 'auto' : 'none'} onTouchStart={skippable ? () => pressSkip(true) : undefined} style={[styles.skipWrap, { bottom: 32 + insets.bottom }, skipStyle]}>
      <Pressable onPress={skip} onPressIn={() => pressSkip(true)} onPressOut={() => pressSkip(false)} disabled={!skippable} accessibilityRole="button" accessibilityLabel="Skip" hitSlop={10} style={styles.skip}>
        {Platform.OS !== 'android' ? <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} /> : null}
        <Text style={styles.skipText} maxFontSizeMultiplier={1.3}>Skip</Text>
        <View>
          <Svg width={14} height={14} viewBox="0 0 24 24">
            <Path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke={fx.ink.white} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </View>
      </Pressable>
    </Animated.View> : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: fx.bg.deep },
  overlay: { ...StyleSheet.absoluteFill },
  black: { backgroundColor: fx.bg.deep },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loader: { height: LOADER_H, marginTop: LOADER_GAP, alignItems: 'center', justifyContent: 'center' },
  clip: { overflow: 'hidden' },
  skipWrap: { position: 'absolute', right: 24 },
  skip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 8, minHeight: 36,
    borderRadius: 999, overflow: 'hidden', backgroundColor: fx.glass.skip, borderWidth: 1, borderColor: fx.line.a15,
  },
  skipText: { fontFamily: FONTS.sans500, fontSize: 14, lineHeight: 20, color: fx.ink.white },
});
