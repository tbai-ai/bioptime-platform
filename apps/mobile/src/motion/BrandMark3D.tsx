/* The 3D brand mark: a pseudo-3D object made from the app's own mark image, with plain transforms (no WebGL).
   - Front: the mark exactly as it was (same image file, size, radius, colours, accessibility label).
   - Depth: `motion.mark.layers` copies of the same image stacked behind it, each further back. Under the perspective
     camera a copy further back shifts against the turn and shrinks (a point `d` behind the face shows d·sin(angle)
     away and scales by p / (p + d); ./depthMath.ts) and is fainter, so a turned mark reads as a solid with depth. The copies are the image as
     it is, only moved and faded; they never show while the mark is flat.
   - Motion: it turns in slowly from an angle when it mounts, then follows a finger (it tips towards the touch and a drag
     turns it) and springs back flat when let go. Nothing loops; once settled the layer does no work.
   At rest there is no transform, the front is at full opacity and the copies are transparent, so the mark draws exactly
   as before. Reduced motion (and Save-Data on the web): at rest from the first frame, no copies, no response to touch.
   On the web, a mark in the page's pre-rendered HTML starts at rest (./staticHtml.ts). Inside a <BrandStage> it shares
   its turn and its touches with the motes around it. */
import React, { useEffect } from 'react';
import { Image, Platform, StyleSheet, type ImageSourcePropType, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { useBrandStage } from './BrandStage';
import { layerDepth, layerOffset, revealAmount } from './depthMath';
import { ease, motion, springs } from './tokens';
import { useInStaticHtml } from './staticHtml';
import { usePointerTilt } from './usePointerTilt';
import { useCalmMotion } from './useCalmMotion';

export type BrandMark3DProps = {
  source: ImageSourcePropType;
  size: number;
  radius: number;
  /** Label for screen readers; leave out for a purely decorative mark (it is then hidden from them). */
  accessibilityLabel?: string;
  /** Wait before the turn-in starts, in ms. */
  delay?: number;
  /** Layout passthrough for the wrapper only (margins, alignSelf), never a visual style. */
  style?: StyleProp<ViewStyle>;
};

type Angles = { rx: number; ry: number; settled: boolean };

function DepthLayer({ index, size, radius, source, angles, opacity }: { index: number; size: number; radius: number; source: ImageSourcePropType; angles: SharedValue<Angles>; opacity: number }) {
  const depth = layerDepth(index, size);
  const animated = useAnimatedStyle(() => {
    const a = angles.get();
    if (a.settled) return { opacity: 0, transform: [] };
    const o = layerOffset(depth, a.rx, a.ry, motion.perspective.mark);
    return { opacity: opacity * revealAmount(a.rx, a.ry), transform: [{ translateX: o.x }, { translateY: o.y }, { scale: o.scale }] };
  });
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, animated]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
    <Image source={source} style={{ width: size, height: size, borderRadius: radius }} accessible={false} />
  </Animated.View>;
}

export function BrandMark3D({ source, size, radius, accessibilityLabel, delay = 0, style }: BrandMark3DProps) {
  const calm = useCalmMotion();
  const inHtml = useInStaticHtml(Platform.OS === 'web');
  const stage = useBrandStage();
  const intro = useSharedValue(calm || inHtml ? 1 : 0);
  const introDone = useSharedValue(calm || inHtml ? 1 : 0);
  const touch = useSharedValue(0);
  const touchIdle = useSharedValue(1);
  const m = motion.mark;

  useEffect(() => {
    if (calm) {
      cancelAnimation(intro); cancelAnimation(touch);
      intro.set(1); introDone.set(1); touch.set(0); touchIdle.set(1);
      return;
    }
    if (introDone.get() === 1) return;
    const run = () => intro.set(withTiming(1, { duration: m.introMs, easing: ease.turn }, (finished) => {
      'worklet';
      if (finished) introDone.set(1);
    }));
    if (!delay) { run(); return; }
    const t = setTimeout(run, delay);
    return () => clearTimeout(t);
    // the turn-in plays once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calm]);

  const { ref, nx, ny, dx, dy, handlers } = usePointerTilt({
    enabled: !calm,
    follow: true,
    onBegin: () => {
      touchIdle.set(0);
      touch.set(withTiming(1, { duration: 160, easing: ease.out }));
      if (stage) stage.touches.set(stage.touches.get() + 1);
    },
    onEnd: () => touch.set(withSpring(0, springs.brandRelease, (finished) => {
      'worklet';
      if (finished) touchIdle.set(1);
    })),
  });

  const angles = useDerivedValue<Angles>(() => {
    if (introDone.get() === 1 && touchIdle.get() === 1) return { rx: 0, ry: 0, settled: true };
    const k = 1 - intro.get();
    const t = touch.get();
    const ry = k * m.rotateYFrom + t * Math.max(-m.dragMaxY, Math.min(m.dragMaxY, nx.get() * m.touchTilt + dx.get() * m.dragDeg));
    const rx = k * m.rotateXFrom + t * Math.max(-m.dragMaxX, Math.min(m.dragMaxX, -ny.get() * m.touchTilt - dy.get() * m.dragDeg));
    return { rx, ry, settled: false };
  });

  // let the motes on the same stage follow the turn
  useAnimatedReaction(() => angles.get(), (a) => {
    if (!stage) return;
    stage.rx.set(a.rx);
    stage.ry.set(a.ry);
  });

  const front = useAnimatedStyle(() => {
    const a = angles.get();
    if (a.settled) return { opacity: 1, transform: [] };
    const i = intro.get();
    const t = touch.get();
    const scale = (m.scaleFrom + (1 - m.scaleFrom) * i) * (1 - m.touchScale * t);
    return {
      opacity: Math.min(1, i * 1.8),
      transform: [{ perspective: motion.perspective.mark }, { rotateX: `${a.rx}deg` }, { rotateY: `${a.ry}deg` }, { scale }],
    };
  });

  const hidden = !accessibilityLabel;
  const order = Array.from({ length: m.layers }, (_, i) => m.layers - i); // furthest first, so each nearer copy draws over the one behind it
  return <Animated.View
    ref={ref}
    style={[style, front]}
    accessibilityElementsHidden={hidden}
    importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
    aria-hidden={hidden || undefined}
    {...handlers}
  >
    {calm ? null : order.map((index) => <DepthLayer key={index} index={index} size={size} radius={radius} source={source} angles={angles} opacity={m.opacity[index - 1] ?? 0} />)}
    <Image source={source} style={{ width: size, height: size, borderRadius: radius }} accessibilityLabel={accessibilityLabel} />
  </Animated.View>;
}
