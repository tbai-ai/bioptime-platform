/* Loading placeholders (PREMIUM §1.7 "Skeletons", the earlier app's `.shimmer`).
   - <Skeleton>: a #161616 block with the final element's size and radius, so nothing shifts when content arrives.
   - One shared clock (<ShimmerProvider>, once per screen or app): every block's band (#161616 → #1E1E1E → #161616) is
     placed by the block's own page x, so a single light sweeps across the whole screen every 1400 ms (linear). The
     clock runs only while at least one moving Skeleton is mounted, and stops when the last one goes.
   - <SkeletonRing>: the white/7 track (a bordered view) with a 40° #1E1E1E arc (the one SVG) turning once every 1400 ms.
   - <SkeletonGate loading skeleton>: shows the skeleton only if loading lasts longer than 120 ms, keeps it at least
     300 ms once shown, then crossfades to the content over 200 ms (the content mounts then, so its rings sweep from 0).
   Tier C and calm: static blocks. Loops run only while something is loading (they do not count in the loop budget). */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Dimensions, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle } from 'react-native-svg';
import Animated, { cancelAnimation, useAnimatedRef, useAnimatedStyle, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';
import { measureView } from './measured';
import { scheduleOnUI } from 'react-native-worklets';
import { fx } from '@/theme';
import { ease, t, timing } from './tokens';
import { useMotion } from './tier';

type Shimmer = { clock: SharedValue<number>; /** A moving block mounted: returns its release. */ hold: () => () => void };
const ShimmerContext = createContext<Shimmer | null>(null);

/** The shared clock (0..1 every 1400 ms) for every Skeleton inside it, running only while one is on screen. Without a
 *  provider each block runs its own. */
export function ShimmerProvider({ children }: { children: React.ReactNode }) {
  const [holders, setHolders] = useState(0);
  const clock = useShimmerClock(holders > 0);
  const hold = useCallback(() => {
    setHolders((n) => n + 1);
    let held = true;
    return () => { if (held) { held = false; setHolders((n) => Math.max(0, n - 1)); } };
  }, []);
  const value = useMemo(() => ({ clock, hold }), [clock, hold]);
  return <ShimmerContext.Provider value={value}>{children}</ShimmerContext.Provider>;
}

function useShimmerClock(enabled: boolean): SharedValue<number> {
  const { tier, still } = useMotion();
  const clock = useSharedValue(0);
  const run = enabled && !still && tier !== 'C';
  useEffect(() => {
    if (!run) { cancelAnimation(clock); return; }
    clock.set(0);
    clock.set(withRepeat(withTiming(1, { duration: t.shimmer, easing: ease.linear }), -1, false));
    return () => cancelAnimation(clock);
  }, [run, clock]);
  return clock;
}

export type SkeletonProps = {
  width?: ViewStyle['width'];
  height: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
};

export function Skeleton({ width = '100%', height, radius = fx.radius.lg, style }: SkeletonProps) {
  const { tier, still } = useMotion();
  const shared = useContext(ShimmerContext);
  const moving = !still && tier !== 'C';
  const own = useShimmerClock(!shared && moving);
  const clock = shared?.clock ?? own;
  const hold = shared?.hold;
  // keep the shared clock running while this block is on screen
  useEffect(() => (moving && hold ? hold() : undefined), [moving, hold]);
  const ref = useAnimatedRef();
  const pageX = useSharedValue(0);
  const w = useSharedValue(0);
  const [bandW, setBandW] = useState(1); // the band's width is layout, set on layout (never in the animated style)
  const screen = Dimensions.get('window').width;

  const onLayout = (e: LayoutChangeEvent) => {
    const { width: lw, height: lh } = e.nativeEvent.layout;
    if (lw === 0 && lh === 0) return; // a detached page reports 0 × 0
    w.set(lw);
    setBandW(Math.max(2 * lw, 1));
    if (!moving) return;
    scheduleOnUI(() => {
      'worklet';
      const m = measureView(ref);
      if (m) pageX.set(m.pageX);
    });
  };

  // the light's centre crosses the screen from −½ to 1½ screen widths; each band sits where that light is
  const band = useAnimatedStyle(() => {
    const bw = Math.max(2 * w.get(), 1);
    const cx = -0.5 * screen + clock.get() * 2 * screen;
    return { transform: [{ translateX: cx - pageX.get() - bw / 2 }] };
  });

  return <Animated.View
    ref={ref}
    onLayout={onLayout}
    style={[{ width, height, borderRadius: radius, backgroundColor: fx.premium.shimmer[0], overflow: 'hidden' }, style]}
    accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants"
  >
    {moving ? <Animated.View style={[styles.band, { width: bandW }, band]}>
      <LinearGradient colors={fx.premium.shimmer} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
    </Animated.View> : null}
  </Animated.View>;
}

/** A ring's placeholder: the track and a 40° arc turning every 1400 ms (still on tier C and under calm). */
export function SkeletonRing({ size, stroke = 8 }: { size: number; stroke?: number }) {
  const { tier, still } = useMotion();
  const turn = useSharedValue(0);
  const moving = !still && tier !== 'C';
  useEffect(() => {
    if (!moving) { cancelAnimation(turn); return; }
    turn.set(withRepeat(withTiming(360, { duration: t.shimmer, easing: ease.linear }), -1, false));
    return () => cancelAnimation(turn);
  }, [moving, turn]);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get()}deg` }] }));
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  return <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <View style={[StyleSheet.absoluteFill, { borderWidth: stroke, borderColor: fx.premium.ringTrack, borderRadius: size / 2 }]} />
    <Animated.View style={[StyleSheet.absoluteFill, spin]}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={fx.premium.shimmer[1]} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${(C * 40) / 360} ${C}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </Svg>
    </Animated.View>
  </View>;
}

const SHOW_AFTER = 120;
const MIN_SHOWN = 300;
const CROSSFADE = 200;

export type SkeletonGateProps = {
  loading: boolean;
  /** The placeholder, laid out like the content. */
  skeleton: React.ReactNode;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function SkeletonGate({ loading, skeleton, children, style }: SkeletonGateProps) {
  const { still } = useMotion();
  const [phase, setPhase] = useState<'wait' | 'skeleton' | 'fade' | 'content'>(loading ? 'wait' : 'content');
  const [shownAt, setShownAt] = useState(0);
  const fade = useSharedValue(loading ? 0 : 1);

  useEffect(() => {
    if (loading) {
      if (phase === 'content' || phase === 'fade') { setPhase('skeleton'); setShownAt(Date.now()); fade.set(0); return; }
      if (phase === 'wait') {
        const timer = setTimeout(() => { setPhase('skeleton'); setShownAt(Date.now()); }, SHOW_AFTER);
        return () => clearTimeout(timer);
      }
      return;
    }
    if (phase === 'wait') { fade.set(1); setPhase('content'); return; }
    if (phase === 'skeleton') {
      const left = Math.max(0, MIN_SHOWN - (Date.now() - shownAt));
      const timer = setTimeout(() => {
        setPhase('fade');
        fade.set(withTiming(1, timing(still ? 0 : CROSSFADE)));
        setTimeout(() => setPhase('content'), still ? 0 : CROSSFADE);
      }, left);
      return () => clearTimeout(timer);
    }
  }, [loading, phase, shownAt, still, fade]);

  const contentStyle = useAnimatedStyle(() => ({ opacity: fade.get() }));
  const skeletonStyle = useAnimatedStyle(() => ({ opacity: 1 - fade.get() }));
  const showContent = phase === 'fade' || phase === 'content';
  const showSkeleton = phase === 'skeleton' || phase === 'fade';

  return <View style={style}>
    {showContent ? <Animated.View style={contentStyle}>{children}</Animated.View> : null}
    {showSkeleton ? <Animated.View
      style={[showContent ? StyleSheet.absoluteFill : null, skeletonStyle]}
      pointerEvents="none"
      accessible
      accessibilityLabel="Loading"
    >{skeleton}</Animated.View> : null}
  </View>;
}

const styles = StyleSheet.create({
  band: { position: 'absolute', top: 0, bottom: 0, left: 0 },
});
