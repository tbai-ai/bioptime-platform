/* TiltCard: the earlier app's TiltCard rebuilt with the perspective it never had (PREMIUM §1.5), plus a light sheen and a lift
   shadow.
   - Transform: perspective 900, rotateX / rotateY smoothed by spring.tilt, at most `intensity` degrees.
   - Drivers by tier: A on a phone, device motion from the one gravity sensor in <TiltProvider> (rotateY = 40·Δroll,
     rotateX = -40·Δpitch); A on the web, the pointer over the card (no sensor on the web); B, the earlier app's idle sway
     (±0.2·I on a 6.3 s orbit) on the screen's hero card only (`hero`); C, press only; calm, nothing at all.
   - Press (every tier but calm): the card tips 3.5° away from the finger (not at tier C: press scale only) and sinks to
     `pressScale` (the press ladder in motionValues.press) over 90 ms, and springs back (spring.release), without claiming
     the touch, so buttons inside keep working and a scroll still scrolls.
   - The tab pager panning (pagerPanning, src/fx/motion/gestureState) stands the card down: rotation and press scale go
     back to rest on spring.release and stay flat until the pan ends, so a card never stays tilted under a page move.
   - Light (tier A; B on the hero): a white band 70 % wide slanted 20° sits where the light is. It stays fixed while the
     card turns (it moves by rotateY / I · 45 % of the width), brightens with the tilt, and follows the finger while
     pressed. The earlier app's red press sheen fades in over 160 ms. A deeper lift shadow fades in with tilt and press; at rest
     it is transparent, so a card at rest looks exactly as it did.
   - <TiltLayer depth> moves a layer with the tilt (photo -1.2 with `overscan`, text 0.5, ring 1.0, numbers 1.4), so a
     photo sits behind glass and the type floats in front.
   - Both idle drivers are decoration, so they run for the motion budget only (5 s after focus or the last touch:
     ./budget): then the sensor stops (the cards ease back flat) and the sway eases out; a touch starts them again.
   At rest (calm, the web's pre-rendered HTML, or nothing touching it) the card has no transform. */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState, Platform, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { useIsFocused } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { cancelAnimation, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withRepeat, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { measureView } from './measured';
import { scheduleOnUI } from 'react-native-worklets';
import { usePointerTilt } from '@/motion/usePointerTilt';
import { fx } from '@/theme';
import { GravitySensor } from './GravitySensor';
import { ease, motionValues, spring, t, timing } from './tokens';
import { useMotion } from './tier';
import { useMotionBudget } from './budget';

/** A resting transform, one array for every run: Reanimated compares a style's values by identity, so a new [] on each
 *  scroll frame re-sent the unchanged style (a shadow-tree commit per view per frame on Android). */
const REST_T: never[] = [];
/** The sheen band at rest (opacity .35, unmoved), one object for every run. */
const BAND_REST = { opacity: 0.35, transform: [{ translateX: 0 }, { rotate: '20deg' }] };
import { pagerPanning, pageScrollMoving } from './gestureState';

/* ---------- the provider: one sensor for the whole app ---------- */

type TiltSource = {
  /** Δroll and Δpitch from the gravity sensor, -1..1 (0 when no sensor runs). */
  roll: SharedValue<number>;
  pitch: SharedValue<number>;
  /** A focused tier-A card asks for the sensor; it runs while at least one asks and the app is in front. */
  want: () => () => void;
};

const TiltContext = createContext<TiltSource | null>(null);

/** Wrap the client app once (F's root layout). Runs the gravity sensor only on tier-A phones, only while the app is
 *  active and a focused card wants it. */
export function TiltProvider({ children }: { children: React.ReactNode }) {
  const roll = useSharedValue(0);
  const pitch = useSharedValue(0);
  const [wanted, setWanted] = useState(0);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const { tier, calm } = useMotion();

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);

  const want = useCallback(() => {
    setWanted((n) => n + 1);
    return () => setWanted((n) => Math.max(0, n - 1));
  }, []);

  const run = useMotionBudget(Platform.OS !== 'web' && tier === 'A' && !calm && active && wanted > 0);
  useEffect(() => {
    if (!run) { roll.set(withTiming(0, timing(400))); pitch.set(withTiming(0, timing(400))); }
  }, [run, roll, pitch]);

  const value = useMemo(() => ({ roll, pitch, want }), [roll, pitch, want]);
  return <TiltContext.Provider value={value}>
    {run ? <GravitySensor roll={roll} pitch={pitch} /> : null}
    {children}
  </TiltContext.Provider>;
}

/** The device tilt (Δroll, Δpitch; zero without a provider or a sensor), for DepthTile and photo parallax. */
export function useDeviceTilt(): { roll: SharedValue<number>; pitch: SharedValue<number>; want: (() => () => void) | null } {
  const ctx = useContext(TiltContext);
  const zeroR = useSharedValue(0);
  const zeroP = useSharedValue(0);
  return ctx ? { roll: ctx.roll, pitch: ctx.pitch, want: ctx.want } : { roll: zeroR, pitch: zeroP, want: null };
}

/* ---------- the card ---------- */

type Pose = { rx: SharedValue<number>; ry: SharedValue<number> };
const PoseContext = createContext<Pose | null>(null);

export type TiltCardProps = {
  children: React.ReactNode;
  /** Largest turn in degrees (motionValues.tilt: score 8, banner 6, package / featured 5, default 4). */
  intensity?: number;
  /** The screen's hero card: idle sway on tier B, and the light on tier B too. */
  hero?: boolean;
  /** Scale while pressed (motionValues.press ladder). */
  pressScale?: number;
  /** Corner radius of the card, for the light and the lift shadow. */
  radius?: number;
  /** The white light band (default on). */
  sheen?: boolean;
  /** The deeper shadow that fades in with tilt and press (default on). */
  lift?: boolean;
  disabled?: boolean;
  /** Layout passthrough for the wrapper (margins, flex, alignSelf). */
  style?: StyleProp<ViewStyle>;
};

const SWAY_MS = 6283; // one orbit: the earlier app's t += .05 every 50 ms

/** The white light band: clear, the sheen, clear, left to right (a gradient view, not an SVG: one texture fewer). */
const SHEEN = [fx.premium.sheenClear, fx.premium.sheen, fx.premium.sheenClear] as const;
const SHEEN_AT = [0, 0.5, 1] as const;
const H_START = { x: 0, y: 0 };
const H_END = { x: 1, y: 0 };

export function TiltCard({ children, intensity = motionValues.tilt.default, hero = false, pressScale = motionValues.press.card,
  radius = fx.radius.card, sheen = true, lift = true, disabled, style }: TiltCardProps) {
  const { tier, still } = useMotion();
  const focused = useIsFocused();
  const device = useDeviceTilt();
  const I = intensity;
  const web = Platform.OS === 'web';
  const useDevice = tier === 'A' && !web && !still && !disabled;
  const useHover = tier === 'A' && web && !still && !disabled;
  const swayAllowed = tier === 'B' && hero && !still && !disabled;
  const useSway = useMotionBudget(swayAllowed && focused);
  const lit = sheen && !still && (tier === 'A' || (tier === 'B' && hero));

  const press = useSharedValue(0);
  const srcX = useSharedValue(0); // the driver's turn, degrees (before press)
  const srcY = useSharedValue(0);
  const phase = useSharedValue(0);
  const swayOn = useSharedValue(0);
  const width = useSharedValue(0);
  const live = useSharedValue(focused ? 1 : 0);

  useEffect(() => { live.set(focused ? 1 : 0); }, [focused, live]);

  // the sensor runs while a focused tier-A card is on screen
  useEffect(() => {
    if (!useDevice || !focused || !device.want) return;
    return device.want();
  }, [useDevice, focused, device]);

  // a turn smaller than tilt.deadband (sensor noise moves the aim by hundredths of a degree on every 33 ms reading) does
  // not restart the springs: each restart sent the card's layers a props update on every frame (a shadow-tree commit
  // each on Android), so a still phone kept every tilting card on the page busy
  const aimX = useSharedValue(0);
  const aimY = useSharedValue(0);
  const dead = motionValues.tilt.deadband;
  useAnimatedReaction(() => (useDevice && live.get() === 1 ? { r: device.roll.get(), p: device.pitch.get() } : null), (v) => {
    if (!v) return;
    const y = Math.max(-I, Math.min(I, 40 * v.r));
    const x = Math.max(-I, Math.min(I, -40 * v.p));
    if (Math.abs(y - aimY.get()) >= dead) { aimY.set(y); srcY.set(withSpring(y, spring.tilt)); }
    if (Math.abs(x - aimX.get()) >= dead) { aimX.set(x); srcX.set(withSpring(x, spring.tilt)); }
  });

  // tier B: the hero card sways on a slow orbit while its screen is in front; the orbit holds where it is while a tab
  // page scrolls (pageScrollMoving) and goes on from there
  const swayRun = useSharedValue(0);
  useEffect(() => {
    if (!useSway || !focused) { swayRun.set(0); swayOn.set(withTiming(0, timing(400))); return; }
    swayRun.set(1);
    swayOn.set(withTiming(1, timing(1000)));
    return () => { swayRun.set(0); };
  }, [useSway, focused, swayRun, swayOn]);
  useAnimatedReaction(() => (swayRun.get() === 1 && pageScrollMoving.get() === 0 ? 1 : 0), (go, was) => {
    if (go === was) return;
    if (go === 0) { cancelAnimation(phase); return; }
    phase.set(withRepeat(withTiming(phase.get() + Math.PI * 2, { duration: SWAY_MS, easing: ease.linear }), -1, false));
  });
  useEffect(() => () => cancelAnimation(phase), [phase]);

  const { ref, nx, ny, handlers } = usePointerTilt({
    enabled: !still && !disabled,
    onBegin: () => press.set(withTiming(1, timing(t.press))),
    onEnd: () => press.set(withSpring(0, spring.release)),
  });

  // the pager pan stands the card down: 1 normal, 0 flat (rotation and press scale at rest)
  const stand = useSharedValue(1);
  useAnimatedReaction(() => pagerPanning.get(), (pan, was) => {
    if (pan === was) return;
    stand.set(withSpring(pan === 1 ? 0 : 1, spring.release));
  });
  const pressTilt = tier === 'C' ? 0 : motionValues.press.tilt; // tier C: press scale only

  // desktop web, tier A: the pointer over the card turns it
  const hover = useCallback((pageX: number, pageY: number, on: boolean) => {
    scheduleOnUI((px: number, py: number, inside: boolean) => {
      'worklet';
      if (!inside) { srcX.set(withSpring(0, spring.tilt)); srcY.set(withSpring(0, spring.tilt)); return; }
      const m = measureView(ref);
      if (!m || m.width <= 0 || m.height <= 0) return;
      const hx = Math.max(-1, Math.min(1, ((px - m.pageX) / m.width) * 2 - 1));
      const hy = Math.max(-1, Math.min(1, ((py - m.pageY) / m.height) * 2 - 1));
      srcY.set(withSpring(hx * I, spring.tilt));
      srcX.set(withSpring(-hy * I, spring.tilt));
    }, pageX, pageY, on);
  }, [I, ref, srcX, srcY]);

  type PointLike = { nativeEvent: { pageX: number; pageY: number } };
  const allHandlers = useHover
    ? {
      ...handlers,
      onPointerMove: (e: PointLike) => { handlers.onPointerMove?.(e as never); hover(e.nativeEvent.pageX, e.nativeEvent.pageY, true); },
      onPointerLeave: (e: PointLike) => { handlers.onPointerLeave?.(e as never); hover(0, 0, false); },
    }
    : handlers;

  const rx = useDerivedValue(() => {
    const sway = swayOn.get() > 0 ? -Math.cos(phase.get()) * 0.2 * I * swayOn.get() : 0;
    const p = Math.max(0, press.get());
    return (srcX.get() + sway - ny.get() * pressTilt * p) * Math.max(0, stand.get());
  });
  const ry = useDerivedValue(() => {
    const sway = swayOn.get() > 0 ? Math.sin(phase.get()) * 0.2 * I * swayOn.get() : 0;
    const p = Math.max(0, press.get());
    return (srcY.get() + sway + nx.get() * pressTilt * p) * Math.max(0, stand.get());
  });

  const card = useAnimatedStyle(() => {
    const p = Math.max(0, press.get()) * Math.max(0, stand.get());
    const x = rx.get();
    const y = ry.get();
    if (p < 0.0005 && Math.abs(x) < 0.01 && Math.abs(y) < 0.01) return { transform: REST_T };
    const scale = 1 - (1 - pressScale) * p;
    if (tier === 'C') return { transform: [{ scale }] };
    return { transform: [{ perspective: motionValues.perspective.card }, { rotateX: `${x}deg` }, { rotateY: `${y}deg` }, { scale }] };
  });

  const liftStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(Math.max(0, press.get()), (Math.abs(rx.get()) + Math.abs(ry.get())) / I)),
  }));

  const band = useAnimatedStyle(() => {
    const w = width.get();
    const p = Math.max(0, press.get());
    const fromTilt = (ry.get() / I) * 0.45 * w;
    const fromFinger = nx.get() * 0.45 * w;
    const x = fromTilt * (1 - p) + fromFinger * p;
    const tilt = Math.min(1, (Math.abs(rx.get()) + Math.abs(ry.get())) / I);
    if (x === 0 && p === 0 && tilt === 0) return BAND_REST; // at rest: the same object every run, so nothing is re-sent
    return { opacity: 0.35 + 0.65 * Math.max(tilt, p), transform: [{ translateX: x }, { rotate: '20deg' }] };
  });
  const redSheen = useAnimatedStyle(() => ({ opacity: Math.max(0, press.get()) }));

  const pose = useMemo(() => ({ rx, ry }), [rx, ry]);
  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0) width.set(w); // a detached page reports 0 × 0
  };

  return <Animated.View ref={ref} style={[style, card]} onLayout={onLayout} {...allHandlers}>
    {lift && !still ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, boxShadow: fx.premium.liftShadow }, liftStyle]} /> : null}
    <PoseContext.Provider value={pose}>{children}</PoseContext.Provider>
    {lit ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
      <Animated.View style={[styles.band, band]}>
        <LinearGradient colors={SHEEN} locations={SHEEN_AT} start={H_START} end={H_END} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, redSheen]}>
        <LinearGradient colors={fx.premium.redSheen} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </View> : null}
  </Animated.View>;
}

export type TiltLayerProps = {
  children: React.ReactNode;
  /** Points moved per degree of tilt: photo -1.2, text 0.5, ring 1.0, centre numbers 1.4. */
  depth: number;
  /** Scale the layer up (1.08) so a counter-moving photo never shows its edge. */
  overscan?: number;
  style?: StyleProp<ViewStyle>;
};

/** A layer inside a TiltCard that moves with the tilt by `depth`; outside a TiltCard it is a plain view. */
export function TiltLayer({ children, depth, overscan, style }: TiltLayerProps) {
  const pose = useContext(PoseContext);
  const zero = useSharedValue(0);
  const rx = pose?.rx ?? zero;
  const ry = pose?.ry ?? zero;
  const animated = useAnimatedStyle(() => {
    const x = ry.get();
    const y = rx.get();
    if (Math.abs(x) < 0.01 && Math.abs(y) < 0.01) return { transform: overscan ? [{ scale: overscan }] : [] };
    return { transform: [{ translateX: depth * x }, { translateY: -depth * y }, ...(overscan ? [{ scale: overscan }] : [])] };
  });
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  // a band 70 % of the card wide, tall enough to cover the card once slanted, centred
  band: { position: 'absolute', top: '-50%', bottom: '-50%', left: '15%', width: '70%' },
});
