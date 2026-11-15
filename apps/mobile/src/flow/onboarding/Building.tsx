/* "Sending your answers" (the earlier app's "Building your protocol", tx-quiz-build-protocol-*, worded truthfully,
   CRITIQUE 51): the 80 pt red tile with depth turning in, its flame springing in, the title and "Your coach reads them
   before writing your first plan.", a 280 × 4 bar and three pulsing red dots, then Home. It posts the onboarding
   consents step and then done (model.finishSetup). An error stops the bar, shakes the tile and offers "Try again";
   HEALTH_CONSENT_REQUIRED leads back to the consent screen instead. Progress is never shown past what is known.
   Nothing is calculated here.
   The hold follows the work, not a script (motion.md §9: no loader outlasts the work): while the requests run the bar
   shows an indeterminate sweep (a short segment crossing the track, t.spinner a pass); the work is the two posts and
   then Home's first loads (`onSent`: the session read again and prefetchHome, m57.holdMax at most), so Home opens
   from their answers without a skeleton. When it is done the bar fills to 100 % over FILL_MS while the sweep fades,
   the dots stop and the success haptic fires on that frame. The screen is shown for MIN_MS at least in all (a fast
   answer still reads as a moment, never a flash), then it leaves in EXIT_MS (a flow exit): the flame swells to
   m57.flamePeak, falls to m57.flameEnd and fades, the tile turns m57.tileTurn° away (tier A) and the screen fades to
   the flow black; the route changes once it has (doneOnce) and Home's entrance takes over. The fills are full-width
   views moved by translateX inside the rounded track (no scaleX on a rounded shape). Reduced motion: no sweep (the bar
   rests at half until the work is done, then full) and a 150 ms fade; tier C: the sweep still runs, a 200 ms fade. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Button, DepthTile, FlowEnter, Icon, Reveal, T, ease, fx, haptics, spring, timing, useFx } from '@/fx';
import { doneOnce } from '@/fx/motion/once';
import { calmFade, motionValues, t } from '@/fx/motion/tokens';
import { errorText } from '@/lib/api';
import { finishSetup, isHealthConsentRefusal, type Consents } from './model';

const S = motionValues.screens.m57;
/** The least time the screen shows (a fast answer still reads as a moment): m57.minMs, 700 ms. */
const MIN_MS = S.minMs;
/** The bar's fill to 100 % once the work is done: m57.fillMs, 200 ms. */
const FILL_MS = S.fillMs;
/** The exit to Home: m57.exitMs, 240 ms (a flow exit). */
const EXIT_MS = S.exitMs;
/** The sweep's segment: this share of the track (a layout size). */
const SWEEP_SHARE = 0.35;

export function Building({ consents, onSent, onDone, onConsent, enter = true }: {
  consents: Consents;
  /** The server has the answers: read the session again and start Home's first loads (awaited, m57.holdMax at most). */
  onSent?: () => Promise<void> | void;
  /** After the exit: go Home. */
  onDone: () => Promise<void> | void;
  onConsent: () => void;
  /** This phase plays its own entrance (the setup's first phase); otherwise the phase swap carries it. */
  enter?: boolean;
}) {
  const { calm, tier } = useFx();
  const [err, setErr] = useState<{ text: string; consent: boolean } | null>(null);
  const [run, setRun] = useState(0);
  const [full, setFull] = useState(false); // the bar is at 100 %: the dots stop
  const bar = useSharedValue(0);
  const sweep = useSharedValue(0); // 0 → 1: the sweep's segment crossing the track (repeating)
  const sweepOut = useSharedValue(1); // 0 → 1: the sweep fades (the work is done, or failed)
  const trackW = useSharedValue(0);
  const shake = useSharedValue(0);
  const flame = useSharedValue(calm ? 1 : 0.6);
  const flameOut = useSharedValue(0); // 0 → 1: the flame fades
  const turn = useSharedValue(0); // 0 → 1: the tile turns away
  const out = useSharedValue(0); // 0 → 1: the screen fades to black
  const alive = useRef(true);
  const leaving = useRef<{ cancel: () => void } | null>(null);
  useEffect(() => () => { alive.current = false; leaving.current?.cancel(); }, []);
  useEffect(() => { if (!calm) flame.value = withDelay(100, withSpring(1, spring.flame)); }, [calm, flame]);

  const exit = useCallback(() => {
    const ms = calm ? t.calm : tier === 'C' ? t.fast : EXIT_MS;
    const once = doneOnce(() => { void onDone(); }, ms + motionValues.overlay.fallbackExtra);
    leaving.current = once;
    const done = once.done;
    const cfg = calm ? calmFade() : tier === 'C' ? timing(ms, ease.linear) : timing(ms, ease.css);
    out.value = withTiming(1, cfg, (f) => { 'worklet'; if (f) scheduleOnRN(done); });
    if (calm) return;
    flame.value = withSequence(withTiming(S.flamePeak, timing(t.pop, ease.expo)), withTiming(S.flameEnd, timing(ms - t.pop, ease.exit)));
    flameOut.value = withTiming(1, timing(ms, ease.exit));
    if (tier === 'A') turn.value = withTiming(1, timing(ms, ease.exit));
  }, [calm, tier, onDone, out, flame, flameOut, turn]);

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  /** The indeterminate sweep: on while the work runs (not with reduced motion), fading out when it ends. */
  const sweepOn = useCallback((on: boolean) => {
    cancelAnimation(sweepOut);
    if (on && !calm) {
      sweepOut.value = 0;
      sweep.value = 0;
      sweep.value = withRepeat(withTiming(1, timing(t.spinner, ease.inOut)), -1, false);
      return;
    }
    sweepOut.value = calm ? 1 : withTiming(1, timing(FILL_MS, ease.css), (f) => { 'worklet'; if (f) cancelAnimation(sweep); });
  }, [calm, sweep, sweepOut]);

  const send = useCallback(async () => {
    setErr(null);
    setFull(false);
    const t0 = Date.now();
    cancelAnimation(bar);
    bar.value = calm ? 0.5 : 0;
    sweepOn(true);
    try {
      await finishSetup(consents);
      // Home's first loads are part of the work (Home then opens from their answers), m57.holdMax at most
      const ready = Promise.resolve(onSent?.()).catch(() => undefined);
      await Promise.race([ready, sleep(S.holdMax)]);
      if (!alive.current) return;
      // done: the bar fills while the sweep fades; the dots stop and the success haptic fires as it arrives
      sweepOn(false);
      bar.value = calm ? 1 : withTiming(1, timing(FILL_MS, ease.expo));
      if (!calm) await sleep(FILL_MS);
      if (!alive.current) return;
      setFull(true);
      haptics.success();
      const wait = MIN_MS - (Date.now() - t0);
      if (wait > 0) await sleep(wait);
      if (alive.current) exit();
    } catch (e) {
      if (!alive.current) return;
      cancelAnimation(bar);
      sweepOn(false);
      haptics.error();
      if (!calm) shake.value = withSequence(...[-8, 8, -6, 6, 0].map((x) => withTiming(x, { duration: 80 })));
      setErr({ text: errorText(e), consent: isHealthConsentRefusal(e) });
    }
  }, [bar, calm, consents, onSent, exit, shake, sweepOn]);

  useEffect(() => { void send(); }, [run]); // eslint-disable-line react-hooks/exhaustive-deps

  const onTrack = (e: LayoutChangeEvent) => { const w = e.nativeEvent.layout.width; if (w > 0) trackW.value = w; };
  const fill = useAnimatedStyle(() => {
    const p = Math.max(0, Math.min(1, bar.value));
    if (p === 1) return { opacity: 1, transform: [] };
    if (trackW.value === 0) return { opacity: 0, transform: [] }; // not laid out yet
    return { opacity: 1, transform: [{ translateX: -trackW.value * (1 - p) }] };
  });
  const sweeping = useAnimatedStyle(() => {
    const w = trackW.value;
    const o = 1 - sweepOut.value;
    if (w === 0 || o <= 0) return { opacity: 0, transform: [] };
    const seg = w * SWEEP_SHARE;
    return { opacity: o, transform: [{ translateX: -seg + (w + seg) * sweep.value }] };
  });
  const shook = useAnimatedStyle(() => (turn.value === 0
    ? { transform: [{ translateX: shake.value }] }
    : { transform: [{ perspective: motionValues.perspective.mark }, { translateX: shake.value }, { rotateY: `${S.tileTurn * turn.value}deg` }] }));
  const flameIn = useAnimatedStyle(() => ({ opacity: 1 - flameOut.value, transform: [{ scale: flame.value }] }));
  const screen = useAnimatedStyle(() => ({ opacity: 1 - out.value }));
  return <View style={styles.screen}>
    <FlowEnter off={!enter} style={styles.center}>
      <Animated.View style={[styles.stack, screen]} accessibilityLiveRegion="polite">
        <Animated.View style={shook}>
          <DepthTile size={80} radius={28} glow={fx.shadow.tile} turnIn accessibilityLabel="Sending">
            <Animated.View style={flameIn}><Icon name="flame" size={36} color={fx.ink.white} /></Animated.View>
          </DepthTile>
        </Animated.View>
        <Reveal delay={S.beatStep} distance={S.rise} from={enter ? 'up' : 'fade'}><T v="display36" center style={styles.title}>Sending your answers</T></Reveal>
        <Reveal delay={2 * S.beatStep} from="fade"><T v="body" color={fx.ink.ink2} center style={styles.sub}>Your coach reads them before writing your first plan.</T></Reveal>
        <View style={styles.track} onLayout={onTrack} accessible accessibilityRole="progressbar" accessibilityLabel="Sending your answers">
          <Animated.View style={[styles.sweep, sweeping]} />
          <Animated.View style={[styles.fill, fill]} />
        </View>
        {err ? <View style={styles.error}>
          <T v="body" color={fx.red.error} center accessibilityRole="alert">{err.consent ? 'Bioptime cannot run a programme without processing health information.' : err.text}</T>
          <Button title="Try again" shape="flow" full={false} icon="refresh-cw" onPress={() => { if (err.consent) onConsent(); else setRun((r) => r + 1); }} style={styles.retry} />
        </View> : <Dots calm={calm} stop={full} />}
      </Animated.View>
    </FlowEnter>
  </View>;
}

function Dots({ calm, stop }: { calm: boolean; stop: boolean }) {
  return <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    {[0, 1, 2].map((k) => <Dot key={k} delay={k * 200} calm={calm} stop={stop} />)}
  </View>;
}

/** A pulsing dot; `stop`: it settles lit (the bar has arrived). */
function Dot({ delay, calm, stop }: { delay: number; calm: boolean; stop: boolean }) {
  const p = useSharedValue(calm ? 1 : 0);
  useEffect(() => {
    if (calm) return;
    if (stop) { cancelAnimation(p); p.value = withTiming(1, timing(t.fast, ease.css)); return; }
    p.value = withDelay(delay, withRepeat(withSequence(withTiming(1, timing(600, ease.cssInOut)), withTiming(0, timing(600, ease.cssInOut))), -1, false));
    return () => cancelAnimation(p);
  }, [calm, delay, p, stop]);
  const a = useAnimatedStyle(() => ({ opacity: 0.3 + 0.7 * p.value, transform: [{ scale: 0.8 + 0.4 * p.value }] }));
  return <Animated.View style={[styles.dot, a]} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: fx.bg.base },
  center: { justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  stack: { alignItems: 'center', width: '100%', maxWidth: 448 },
  title: { marginTop: 32 },
  sub: { marginTop: 10, maxWidth: 300 },
  track: { marginTop: 32, width: 280, maxWidth: '100%', height: 4, borderRadius: 2, backgroundColor: fx.line.a08, overflow: 'hidden' },
  fill: { width: '100%', height: 4, borderRadius: 2, backgroundColor: fx.red.brand },
  sweep: { position: 'absolute', left: 0, top: 0, width: `${SWEEP_SHARE * 100}%`, height: 4, borderRadius: 2, backgroundColor: fx.red.brand },
  dots: { flexDirection: 'row', gap: 8, marginTop: 28 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: fx.red.brand },
  error: { marginTop: 24, alignItems: 'center', gap: 16 },
  retry: { alignSelf: 'center' },
});
