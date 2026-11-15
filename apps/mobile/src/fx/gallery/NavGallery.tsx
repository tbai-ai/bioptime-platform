/* The kit gallery's navigation part (/__fx, development builds only; the hub src/fx/gallery/MotionGallery renders it):
   a flow step swapping in place (FlowSwap: both steps on screen together, the outgoing one inert), a section that
   mounts after its page has settled (Deferred), the page-active probe (what usePageActive and usePageSettled say for
   this screen), and the tab icon (one SVG view whose colour and stroke follow its activation, with the earlier app's
   pop). Nothing here reads or writes member data; the words are illustrations. */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { fx } from '@/theme';
import { Button } from '../Button';
import { calmFade, ease, motionValues, spring, timing, useFx } from '../effects';
import { Input } from '../Field';
import { FlowSwap } from '../FxScreen';
import { GlassCard } from '../GlassCard';
import { Deferred } from '../nav/Deferred';
import { usePageActive, usePageMotion, usePageSettled } from '../nav/pageReady';
import { TabIcon } from '../nav/TabIcon';
import { P, T } from '../Text';

function Caption({ children }: { children: string }) {
  return <T v="micro" color={fx.ink.a50}>{children}</T>;
}

const STEPS = ['Your goal', 'Your week', 'Your coach'] as const;

/** FlowSwap: three steps, each with a heading, a field and a button. */
function Swap() {
  const [step, setStep] = useState(0);
  return <View style={styles.block} testID="nav-flowswap">
    <Caption>FlowSwap: the outgoing step leaves up while the next rises in; the old one is inert from its first exit frame</Caption>
    <GlassCard style={styles.card}>
      <FlowSwap id={step}>
        <View style={styles.step}>
          <T v="heading" accessibilityRole="header">{STEPS[step]}</T>
          <Input label={`Step ${step + 1} note`} placeholder="A few words" />
          <Button title={step < STEPS.length - 1 ? 'Next step' : 'Start again'} onPress={() => setStep((s) => (s + 1) % STEPS.length)} testID="nav-flowswap-next" />
        </View>
      </FlowSwap>
    </GlassCard>
  </View>;
}

/** What the page lifecycle says here. */
function Probe() {
  const active = usePageActive();
  const settled = usePageSettled();
  const motion = usePageMotion();
  const [a, setA] = useState(active.value);
  useAnimatedReaction(() => active.value, (v, p) => { if (v !== p) scheduleOnRN(setA, v); });
  return <View style={styles.block} testID="nav-probe">
    <Caption>The page-active probe</Caption>
    <P small>{`usePageActive ${a} · usePageSettled ${settled ? 'true' : 'false'} · usePageMotion ${motion ? 'in the pager' : 'none (outside the pager)'}`}</P>
  </View>;
}

/** Deferred: mounts after the page has settled and the device is idle; its height is kept for the next visit. */
function LateSection() {
  return <View style={styles.block} testID="nav-deferred">
    <Caption>Deferred: mounts once the page has settled, reserving its height until then</Caption>
    <Deferred id="nav-gallery-late" placeholderHeight={72}>
      <GlassCard style={styles.card}><P small>This section mounted after the page came to rest.</P></GlassCard>
    </Deferred>
  </View>;
}

/** The tab icon: idle, active, and one that switches with the earlier app's pop. */
function Icons() {
  const { calm, tier } = useFx();
  const idle = useSharedValue(0);
  const lit = useSharedValue(1);
  const on = useSharedValue(0);
  const scale = useSharedValue(1);
  const [chosen, setChosen] = useState(false);
  const toggle = () => {
    const next = !chosen;
    setChosen(next);
    on.value = withTiming(next ? 1 : 0, calm ? calmFade() : timing(motionValues.pill.colourMs, ease.css));
    scale.value = calm ? 1 : withSpring(next ? motionValues.pill.iconPop : 1, tier === 'C' ? spring.navIconC : spring.navIcon);
  };
  const pop = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return <View style={styles.block} testID="nav-tabicon">
    <Caption>TabIcon: one SVG view per tab; idle zinc-500 at 1.5, active Bioptime red at 2.5</Caption>
    <View style={styles.row}>
      <View style={styles.icon} testID="nav-tabicon-idle"><TabIcon name="dna" size={22} on={idle} /></View>
      <View style={styles.icon} testID="nav-tabicon-active"><TabIcon name="dna" size={22} on={lit} /></View>
      <Animated.View style={[styles.icon, pop]} testID="nav-tabicon-pop"><TabIcon name="house" size={22} on={on} /></Animated.View>
      <Button title={chosen ? 'Leave' : 'Choose'} variant="soft" full={false} onPress={toggle} testID="nav-tabicon-toggle" />
    </View>
  </View>;
}

export function NavGallery(): React.JSX.Element {
  return <View style={styles.wrap}>
    <Probe />
    <Swap />
    <LateSection />
    <Icons />
  </View>;
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  block: { gap: 8 },
  card: { padding: 16 },
  step: { gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
