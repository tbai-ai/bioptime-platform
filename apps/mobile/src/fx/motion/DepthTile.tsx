/* DepthTile (CRITIQUE §45): a rounded tile with depth, for achievement medals, the "Sending your answers" tile and the
   coach's Medallion. Four copies of the tile's plate stack behind it (BrandMark3D's technique from src/motion: each
   further back, smaller under the camera and fainter, shown only while the tile is turned), with the content (a Lucide
   icon or initials) on the face only.
   - `turnIn`: turns in from rotateY −20° over 900 ms expo (the Sending loader; the coach profile sheet).
   - Tier A tilts it with the device (TiltProvider); `follow` lets a finger tip and drag it (90 ms in), springing back
     on spring.tilt; on the web the tile then takes the touch (touch-action none), so the page scroll never cancels it.
   - `sheen`: one light sweep across the face when it appears (700 ms, ease in-out): medals on reveal.
   - `locked`: flat at .5 opacity, no depth, no motion.
   At rest it is the flat face with no transform. Calm: flat, still. */
import React, { useEffect } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withDelay, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { layerOffset, revealAmount } from '@/motion/depthMath';
import { motion as staffMotion } from '@/motion/values';
import { usePointerTilt } from '@/motion/usePointerTilt';
import { fx } from '@/theme';
import { ease, motionValues, spring, t, timing } from './tokens';
import { useMotion } from './tier';
import { useDeviceTilt } from './Tilt';

/** The light sweep: clear, the specular light, clear, left to right (a gradient view, not an SVG). */
const SWEEP = [fx.premium.sheenClear, fx.premium.specular, fx.premium.sheenClear] as const;
const SWEEP_AT = [0, 0.5, 1] as const;

const LAYERS = 4;
const OPACITY = staffMotion.mark.opacity.slice(0, LAYERS);
const DEVICE_MAX = 10;
/** A resting transform and a hidden plate at rest, one object each for every run: Reanimated compares a style's values
 *  by identity, so a new [] on every sensor reading re-sent an unchanged style (a props update per view per frame). */
const REST_T: never[] = [];
const PLATE_REST = { opacity: 0, transform: REST_T };
const FACE_REST = { opacity: 1, transform: REST_T };

type Angles = { rx: number; ry: number; flat: boolean };

function Plate({ index, size, radius, color, angles }: { index: number; size: number; radius: number; color: string; angles: SharedValue<Angles> }) {
  const depth = (0.06 + index * 0.075) * size;
  const animated = useAnimatedStyle(() => {
    const a = angles.get();
    if (a.flat) return PLATE_REST;
    const o = layerOffset(depth, a.rx, a.ry, motionValues.perspective.mark);
    return { opacity: OPACITY[index - 1] * revealAmount(a.rx, a.ry), transform: [{ translateX: o.x }, { translateY: o.y }, { scale: o.scale }] };
  });
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, backgroundColor: color }, animated]} />;
}

export type DepthTileProps = {
  size: number;
  radius?: number;
  /** The face colour (default brand red). */
  color?: string;
  /** A boxShadow token for the face (e.g. fx.shadow.tile). */
  glow?: string;
  turnIn?: boolean;
  delay?: number;
  follow?: boolean;
  sheen?: boolean;
  locked?: boolean;
  /** The face's content: an icon or initials. */
  children?: React.ReactNode;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export function DepthTile({ size, radius = size * 0.35, color = fx.red.brand, glow, turnIn, delay = 0, follow, sheen, locked, children, accessibilityLabel, style }: DepthTileProps) {
  const { tier, still } = useMotion();
  const quiet = still || locked;
  const device = useDeviceTilt();
  const deviceOn = tier === 'A' && !quiet;
  const intro = useSharedValue(turnIn && !quiet ? 0 : 1);
  const touch = useSharedValue(0);
  const devX = useSharedValue(0);
  const devY = useSharedValue(0);
  const shine = useSharedValue(0);

  useEffect(() => {
    if (!turnIn || quiet) { intro.set(1); return; }
    intro.set(withDelay(delay, withTiming(1, timing(900, ease.expo))));
    if (sheen) shine.set(withDelay(delay + 300, withTiming(1, timing(700, ease.inOut))));
    // plays once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quiet]);
  useEffect(() => {
    if (sheen && !turnIn && !quiet) shine.set(withDelay(delay, withTiming(1, timing(700, ease.inOut))));
    // the sweep plays once, when the tile appears
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quiet]);
  useEffect(() => {
    if (!deviceOn || !device.want) return;
    return device.want();
  }, [deviceOn, device]);

  // as TiltCard: a new aim within tilt.deadband of the last one does not restart the springs (each sensor reading, every
  // 33 ms, restarted them, so the tile's six layers were re-sent on every frame for as long as the sensor ran, a still
  // phone and every scroll frame included: C01)
  const aimX = useSharedValue(0);
  const aimY = useSharedValue(0);
  const dead = motionValues.tilt.deadband;
  useAnimatedReaction(() => (deviceOn ? { r: device.roll.get(), p: device.pitch.get() } : null), (v) => {
    if (!v) return;
    const y = Math.max(-DEVICE_MAX, Math.min(DEVICE_MAX, 40 * v.r));
    const x = Math.max(-DEVICE_MAX, Math.min(DEVICE_MAX, -40 * v.p));
    if (Math.abs(y - aimY.get()) >= dead) { aimY.set(y); devY.set(withSpring(y, spring.tilt)); }
    if (Math.abs(x - aimX.get()) >= dead) { aimX.set(x); devX.set(withSpring(x, spring.tilt)); }
  });

  const { ref, nx, ny, dx, dy, handlers } = usePointerTilt({
    enabled: !!follow && !quiet,
    follow: true,
    onBegin: () => touch.set(withTiming(1, timing(t.press))),
    onEnd: () => touch.set(withSpring(0, spring.tilt)),
  });

  const angles = useDerivedValue<Angles>(() => {
    const k = 1 - intro.get();
    const tt = touch.get();
    const ry = k * -20 + devY.get() + tt * Math.max(-30, Math.min(30, nx.get() * 14 + dx.get() * 0.55));
    const rx = devX.get() + tt * Math.max(-24, Math.min(24, -ny.get() * 14 - dy.get() * 0.55));
    return { rx, ry, flat: Math.abs(rx) < 0.05 && Math.abs(ry) < 0.05 };
  });

  const face = useAnimatedStyle(() => {
    const a = angles.get();
    if (a.flat) return FACE_REST;
    const i = intro.get();
    return { opacity: turnIn ? Math.min(1, i * 1.8) : 1, transform: [{ perspective: motionValues.perspective.mark }, { rotateX: `${a.rx}deg` }, { rotateY: `${a.ry}deg` }] };
  });
  const band = useAnimatedStyle(() => {
    const s = shine.get();
    return { opacity: s > 0 && s < 1 ? 1 - Math.abs(2 * s - 1) : 0, transform: [{ translateX: (-0.8 + 1.6 * s) * size }, { rotate: '20deg' }] };
  });

  const hidden = !accessibilityLabel;
  return <Animated.View
    ref={ref}
    style={[{ width: size, height: size, opacity: locked ? 0.5 : 1 }, follow && !quiet && Platform.OS === 'web' ? styles.ownTouch : null, style, face]}
    accessible={!hidden}
    accessibilityLabel={accessibilityLabel}
    accessibilityElementsHidden={hidden}
    importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
    {...handlers}
  >
    {quiet ? null : [4, 3, 2, 1].map((i) => <Plate key={i} index={i} size={size} radius={radius} color={color} angles={angles} />)}
    <View style={[StyleSheet.absoluteFill, styles.face, { borderRadius: radius, backgroundColor: color, boxShadow: glow }]}>
      {children}
      {sheen && !quiet ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}>
        <Animated.View style={[styles.band, band]}>
          <LinearGradient colors={SWEEP} locations={SWEEP_AT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
      </View> : null}
    </View>
  </Animated.View>;
}

const styles = StyleSheet.create({
  face: { alignItems: 'center', justifyContent: 'center' },
  band: { position: 'absolute', top: '-40%', bottom: '-40%', left: '20%', width: '60%' },
  // the web: a finger on a following tile drags the tile, never the page (no pointercancel mid-drag)
  ownTouch: { touchAction: 'none' } as unknown as ViewStyle,
});
