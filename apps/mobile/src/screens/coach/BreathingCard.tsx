/* Box breathing (the earlier app's widget, kept on the device): a glass card over a dim photo (slot
   coach.breathing.backdrop at .18 under a #0A0A0A/.6 veil, PREMIUM §2.4; no name ever sits on it), the wind mark and
   "Box Breathing", the pattern line, and the motion kit's BoxBreathing (4 s in, 4 s hold, 4 s out, 2 s rest, five
   rounds; haptics at each breath). Nothing is recorded or sent. The card folds to one row (remembered on this device);
   it restarts from rest whenever the tab loses focus, so nothing runs off screen.
   Motion (T4-13, the kit accordion's rule M21): the body opens and folds like the kit's Accordion, its height and its
   opacity on one value (opening over accordion.openMs, folding over the shorter accordion.closeMs, ease expo), so what
   follows moves with it instead of jumping; the body stays laid out until the fold has finished, and once open its
   height is its own again (the running exercise adds its cycle line). The pattern line belongs to the body (it grows
   and fades with it), so the header row keeps its height through the change (2 pt). Tier C: the body fades in place
   (t.fast) and the height changes at the start of an opening and the end of a fold; reduced motion: the same with a
   calm crossfade. */
import { useIsFocused } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { BoxBreathing, FONTS, GlassCard, Icon, Photo, T, calmFade, ease, fx, readKeyed, t, timing, toast, useFx, writeKeyed } from '@/fx';
import { motionValues } from '@/fx/motion/tokens';

const KEY = 'coach.breathing';
const ACC = motionValues.accordion;

export function BreathingCard() {
  const focused = useIsFocused();
  const { calm, tier, inHtml } = useFx();
  const [open, setOpen] = useState(true);
  // the body is laid out while open and while it folds (it leaves once the fold has finished)
  const [shown, setShown] = useState(true);
  const [h, setH] = useState(0);
  const p = useSharedValue(1);
  const remembered = React.useRef(false);
  useEffect(() => {
    void readKeyed('segment', KEY).then((v) => {
      if (v !== 'closed') return;
      // the stored fold is the first state, not a change: at rest at once
      remembered.current = true;
      p.value = 0;
      setShown(false);
      setOpen(false);
    }).catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const hide = () => setShown(false);
  useEffect(() => {
    if (remembered.current) { remembered.current = false; return; }
    if (open) setShown(true);
    const to = open ? 1 : 0;
    if (inHtml) { p.value = to; if (!open) setShown(false); return; }
    const cfg = calm ? calmFade() : tier === 'C' ? timing(t.fast, ease.css) : timing(open ? ACC.openMs : ACC.closeMs, ease.expo);
    p.value = withTiming(to, cfg, (f) => { 'worklet'; if (f && to === 0) scheduleOnRN(hide); });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  // tiers A and B: the height follows the same value as the opacity; tier C and reduced motion: the height is at its
  // end at once (only the body fades)
  const grows = !calm && !inHtml && tier !== 'C';
  const body = useAnimatedStyle(() => {
    const v = p.value;
    if (v >= 1 || !grows) return { height: 'auto' as const, opacity: v };
    return { height: h * v, opacity: v };
  }, [h, grows]);
  const toggle = () => { const next = !open; setOpen(next); void writeKeyed('segment', KEY, next ? 'open' : 'closed').catch(() => undefined); };
  return <GlassCard variant="three" clip padding={0} blur>
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Photo slot="coach.breathing.backdrop" opacity={0.18} style={StyleSheet.absoluteFill} decorative />
      <View style={[StyleSheet.absoluteFill, styles.veil]} />
    </View>
    <Pressable onPress={toggle} accessibilityRole="button" accessibilityLabel="Box Breathing" accessibilityHint={open ? 'Folds the breathing exercise' : 'Opens the breathing exercise'} accessibilityState={{ expanded: open }} aria-expanded={open} style={({ pressed }) => [styles.head, open ? styles.headOpen : null, pressed ? styles.pressed : null]}>
      <View style={[styles.titleRow, open ? styles.centre : null]}>
        <Icon name="wind" size={20} color={fx.red.vivid} />
        <T v="heading" style={styles.title}>Box Breathing</T>
        {!open ? <T v="caption" color={fx.ink.a60} style={styles.flex} numberOfLines={1}>4-4-4-2 · five rounds</T> : null}
      </View>
      <View style={styles.chevron}><Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} color={fx.ink.a60} /></View>
    </Pressable>
    {shown ? <Animated.View style={[styles.clip, body]} accessibilityElementsHidden={!open} importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}>
      <View style={styles.body} onLayout={(e) => { const v = e.nativeEvent.layout.height; if (v > 0 && Math.abs(v - h) > 0.5) setH(v); }}>
        <T v="body" color={fx.ink.a80} center style={styles.pattern}>4-4-4-2 pattern · nothing is saved</T>
        <BoxBreathing key={focused ? 'focused' : 'away'} idleLabel="Tap to start" onRunningChange={(on) => { if (on) toast.success('Breathing started'); }} />
      </View>
    </Animated.View> : null}
  </GlassCard>;
}

const styles = StyleSheet.create({
  veil: { backgroundColor: fx.glass.onPhoto },
  head: { paddingHorizontal: 20, paddingVertical: 16, gap: 6 },
  // open: the title 24 from the top and the pattern line (first in the body) 6 under it, as before the line moved
  headOpen: { paddingTop: 24, paddingBottom: 6 },
  pressed: { backgroundColor: fx.fill.a03 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: 28 },
  centre: { justifyContent: 'center', paddingLeft: 28 },
  title: { fontFamily: FONTS.sans500, fontSize: 18 },
  flex: { flex: 1 },
  chevron: { position: 'absolute', right: 16, top: 16 },
  // the body keeps its own height inside the clip (it never shrinks), so it is measured while the clip grows from 0
  clip: { overflow: 'hidden' },
  body: { flexShrink: 0, paddingBottom: 24 },
  pattern: { paddingHorizontal: 20, marginBottom: 24 },
});
