/* The "Verified" moment after a code is accepted (THEME §11.7, tx-otp-verify-*): the screen dims to black/80, a 64 pt
   white check badge springs in (the pop spring; only the badge, never the title) and draws its check (180 ms from
   60 ms) while a ring bursts behind it (tiers A and B), "Verified" in Bebas 24 fades up 6 pt (200 ms from 120 ms), it
   holds 700 ms, then it leaves: the badge grows to 1.06 as it fades and the veil goes in 180 ms. onExitStart runs on
   the exit's first frame (the flow starts its next step with it) and onDone when the exit has played. Reduced motion:
   150 ms fades in and out. A blur sits behind the veil only over a photograph (`overPhoto`). Announced politely. Draw
   it as the last child of the screen; it covers the screen and takes no touches. */
import { BlurView } from 'expo-blur';
import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, { useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { fx } from '@/theme';
import { haptics } from './device/haptics';
import { ease, motionValues, spring, t, timing, useFx } from './effects';
import { calmFade } from './motion/tokens';
import { doneOnce } from './motion/once';
import { T } from './Text';

const AnimatedPath = Animated.createAnimatedComponent(Path);
/** The lucide check in its 24-unit box, and its length. */
const CHECK = 'M20 6 9 17l-5-5';
const CHECK_LEN = 22.63;

export function VerifiedOverlay({ visible, onDone, onExitStart, title = 'Verified', overPhoto }: { visible: boolean; onDone?: () => void; onExitStart?: () => void; title?: string; overPhoto?: boolean }) {
  const { calm, blur, lite } = useFx();
  const v = motionValues.verified;
  const veil = useSharedValue(0);
  const pop = useSharedValue(calm ? 1 : 0.5);
  const draw = useSharedValue(calm ? 1 : 0);
  const titleIn = useSharedValue(0);
  const burst = useSharedValue(0);
  const out = useSharedValue(0);
  const cb = useRef({ onDone, onExitStart });
  cb.current = { onDone, onExitStart };
  useEffect(() => {
    if (!visible) return;
    haptics.success();
    out.value = 0;
    veil.value = 0;
    if (calm) {
      veil.value = withTiming(1, calmFade());
      titleIn.value = withTiming(1, calmFade());
      pop.value = 1;
      draw.value = 1;
    } else {
      veil.value = withTiming(1, timing(t.base));
      pop.value = 0.5;
      pop.value = withSpring(1, spring.pop);
      draw.value = 0;
      draw.value = withDelay(v.checkAt, withTiming(1, timing(v.checkMs)));
      titleIn.value = 0;
      titleIn.value = withDelay(v.titleAt, withTiming(1, timing(v.titleMs)));
      if (!lite) { burst.value = 0; burst.value = withTiming(1, timing(v.burstMs, ease.tailOut)); }
    }
    let end: ReturnType<typeof doneOnce> | null = null;
    const exit = setTimeout(() => {
      // the exit's first frame: the flow may start its next step with it
      cb.current.onExitStart?.();
      const ms = calm ? v.calmOut : v.veilOutMs;
      end = doneOnce(() => cb.current.onDone?.(), ms + motionValues.overlay.fallbackExtra);
      const done = end.done;
      out.value = withTiming(1, calm ? calmFade(ms) : timing(ms, ease.css), (fin) => { 'worklet'; if (fin) scheduleOnRN(done); });
    }, t.verifiedHold);
    return () => { clearTimeout(exit); end?.cancel(); };
  }, [visible, calm, lite, veil, pop, draw, titleIn, burst, out, v]);
  const veilStyle = useAnimatedStyle(() => ({ opacity: veil.value * (1 - out.value) }));
  const badge = useAnimatedStyle(() => {
    const o = Math.min(1, veil.value * 1.5) * (1 - out.value);
    if (calm) return { opacity: o, transform: [] };
    return { opacity: o, transform: [{ scale: pop.value + (v.exitScale - 1) * out.value }] };
  });
  const words = useAnimatedStyle(() => (calm
    ? { opacity: titleIn.value * (1 - out.value), transform: [] }
    : { opacity: titleIn.value * (1 - out.value), transform: [{ translateY: v.titleY * (1 - titleIn.value) }] }));
  const ring = useAnimatedStyle(() => {
    const b = burst.value;
    if (b <= 0 || b >= 1) return { opacity: 0, transform: [] };
    return { opacity: v.burstOpacity * (1 - b), transform: [{ scale: v.burstFrom + (v.burstTo - v.burstFrom) * b }] };
  });
  const check = useAnimatedProps(() => ({ strokeDashoffset: CHECK_LEN * (1 - draw.value) }));
  if (!visible) return null;
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.veil, veilStyle]} accessibilityLiveRegion="polite" accessible accessibilityLabel={title}>
    {overPhoto && blur ? <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} /> : null}
    <View style={[StyleSheet.absoluteFill, { backgroundColor: fx.scrim.verified }]} />
    <View style={styles.center}>
      <View style={styles.badgeBox}>
        <Animated.View style={[styles.ring, ring]} />
        <Animated.View style={[styles.badge, badge]}>
          <Svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke={fx.bg.deep} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
            <AnimatedPath d={CHECK} strokeDasharray={`${CHECK_LEN} ${CHECK_LEN}`} animatedProps={check} />
          </Svg>
        </Animated.View>
      </View>
      <Animated.View style={words}><T v="card24">{title}</T></Animated.View>
    </View>
  </Animated.View>;
}

const styles = StyleSheet.create({
  veil: { zIndex: 50, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', gap: 16 },
  badgeBox: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: fx.ink.white },
  badge: { width: 64, height: 64, borderRadius: 32, backgroundColor: fx.ink.white, alignItems: 'center', justifyContent: 'center', boxShadow: fx.shadow.verified },
});
