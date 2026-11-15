/* The one-tap open preview on the client sign-in (BUILD §6.1 item 3, §7.4; owner decision D4), drawn only while the
   server offers it (GET /public/config → openPreview) and nobody is signed in. It takes the place and the chrome of the
   earlier app's "Signing in as Member · Change" chip: radius 12, red/30 border on red/6, a 32 pt red icon tile. The
   white pill sends one POST /auth/open-preview {workspace: 'member'} (components/openPreview usePreviewOffer) and the
   caller goes Home; a refusal (too many attempts, no answer) is said under the pill and the form below stays usable.
   Motion v2 (M52): from the tap until the screen leaves the card stays where it is: the pill shows its busy ring in
   its own width and the card is held at m52.holdScale (no row below it moves); a refusal lets it go.
   Release 1.0.0 (the owner's testing build): the card is on the sign-up screen too, so a tester can skip either form.
   The way Home (useHomeExit, shared with the sign-in's other ways in): Home's first render starts while the screen's
   flow exit plays, in a React transition (the screen stays drawn until Home's tree is ready), not after it, so the
   exit covers Home's first render instead of leaving the flow black on screen while it runs (release T4-02). */
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Button, Icon, T, fx, useMotion } from '@/fx';
import { motionValues, spring, t, timing } from '@/fx/motion/tokens';
import { subscribeMarkHandoff } from '@/fx/brand/MarkLayer';
import type { PreviewOffer } from '@/components/openPreview';
import { homeReady, type AuthLeave, type LeaveOptions } from './leave';

/** Leave for Home in one flow exit (useAuthLeave) while Home renders behind it. The replace is sent in a React
 *  transition, so the screen keeps drawing (and its exit keeps playing) until Home's tree is ready and then gives way
 *  to it in one commit. When the tile's mark is handed to the root layer (every tier but reduced motion: tiers A and B
 *  m56.liftMs into the exit, or after the Verified veil's recordAfter; tier C at once, at its place), the replace goes
 *  on the frame after the hand-over, since the layer's own update would otherwise restart Home's render; if nothing is
 *  handed over (no measure), it goes overlay.fallbackExtra after the hand-over was due. With nothing to hand over
 *  (reduced motion, the sign-up) it goes with the exit's first frame. A replace that has not landed by
 *  motionValues.mark.cap is sent again at once, so the screen is never stuck. */
export function useHomeExit(leave: AuthLeave): (opts?: LeaveOptions) => void {
  const router = useRouter();
  const { calm, tier } = useMotion();
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const off = useRef<(() => void) | null>(null);
  const started = useRef(false);
  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current = []; off.current?.(); off.current = null; }, []);
  return useCallback((opts: LeaveOptions = {}) => {
    if (started.current) return;
    started.current = true;
    // useAuthLeave hands the mark over whenever it is asked to and motion is not reduced, at these times
    const hands = !!opts.mark && !calm;
    const due = tier === 'C' ? opts.recordAfter ?? 0 : Math.max(motionValues.screens.m56.liftMs, opts.recordAfter ?? 0);
    let sent = false;
    const replace = () => {
      if (sent) return;
      sent = true;
      off.current?.(); off.current = null;
      router.replace('/(tabs)', { inTransition: true });
    };
    if (hands) {
      off.current = subscribeMarkHandoff(() => { requestAnimationFrame(replace); });
      timers.current.push(setTimeout(replace, due + motionValues.overlay.fallbackExtra));
    }
    // the exit's own navigation is this replace; its end has nothing left to do
    leave.go(() => undefined, opts);
    if (!hands) replace();
    timers.current.push(setTimeout(() => router.replace('/(tabs)'), motionValues.mark.cap));
  }, [router, calm, tier, leave]);
}

/** The client app's one-tap card, held from the tap until the screen leaves (M52): `offer` stays true and the card
 *  stays busy while the session opens and Home's first loads answer (at most m52.prefetchCap), so nothing below it
 *  moves; a refusal lets go (the reason shows under the card). components/openPreview stays as it is. */
export function useHeldOffer(p: PreviewOffer): PreviewOffer {
  const [held, setHeld] = useState(false);
  const { open } = p;
  const openHeld = useCallback(async () => {
    setHeld(true);
    if (!(await open())) { setHeld(false); return false; }
    await homeReady();
    return true;
  }, [open]);
  return { ...p, offer: p.offer || held, busy: p.busy || held, open: openHeld };
}

export function PreviewCard({ preview, onOpened }: { preview: PreviewOffer; onOpened: () => void }) {
  const { still } = useMotion();
  const hold = useSharedValue(0);
  const busy = preview.busy;
  useEffect(() => {
    if (still) { hold.value = 0; return; }
    hold.value = busy ? withTiming(1, timing(t.press)) : withSpring(0, spring.release);
  }, [busy, still, hold]);
  const held = useAnimatedStyle(() => (hold.value === 0 ? { transform: [] } : { transform: [{ scale: 1 - (1 - motionValues.screens.m52.holdScale) * hold.value }] }));
  return <Animated.View style={[styles.card, held]}>
    <View style={styles.row}>
      <View style={styles.tile}><Icon name="sparkles" size={16} color={fx.red.brand} /></View>
      <View style={styles.flex}>
        <T v="micro" color={fx.ink.ink2} style={styles.over}>Preview</T>
        <T v="bodySm" color={fx.ink.a80}>Look around with a prepared member account. Nothing you do here is real.</T>
      </View>
    </View>
    <Button
      variant="white"
      title="Continue without signing in"
      iconRight={null}
      full
      fit
      commit
      busy={preview.busy}
      onPress={async () => { if (await preview.open()) onOpened(); }}
      style={styles.pill}
    />
    {preview.error ? <T v="caption" color={fx.red.error} accessibilityRole="alert" accessibilityLiveRegion="polite">{preview.error}</T> : null}
  </Animated.View>;
}

const styles = StyleSheet.create({
  card: { borderRadius: fx.radius.xl, borderWidth: 1, borderColor: fx.red.a30, backgroundColor: fx.red.a06, padding: 16, gap: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tile: { width: 32, height: 32, borderRadius: fx.radius.lg, backgroundColor: fx.red.a15, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, gap: 2 },
  over: { letterSpacing: 1.6 },
  pill: { paddingHorizontal: 12, paddingVertical: 13 },
});
