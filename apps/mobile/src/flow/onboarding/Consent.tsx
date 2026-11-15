/* The setup's first screen, in the earlier app's consent look (shots 14-consent, 14-consent-s1): the 56 pt shield tile,
   "Your data, your control" in Bebas, a short plain statement, the green note, four toggle cards and the sticky red
   "Agree and continue" (always on screen: the earlier app left it below the fold). The cards are Bioptime's consents
   with their sentences word for word (health information is required; coach sharing, the laboratory and news are the
   member's choice), recorded with POST /me/consents (model.recordConsents); one more row counts steps on this phone
   (a device setting, not a consent). Each check pops.
   Motion v2: the screen enters in four beats (shield and title; the statement and the note; the cards as one block;
   the footer; M57), with no column entrance under them, so the title travels 14 pt. The caption under the button
   sits in a slot as tall as the taller of its two sentences, so the button never moves when the box is ticked (M54).
   The button turns on with its colour (m60.enableMs), its glow (m60.glowMs) and one small pulse timed with the check
   pop (m60.pulse, M60); reduced motion: colour only.
   The one required card sits under a red "Required" label and the member's own choices under "Optional" (release
   T6-27), so the card that holds the button back is plain at a glance; which choices start ticked is unchanged
   (DEFAULT_CONSENTS, the owner's call). */
import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { Button, ConsentCard, FlowScreen, Icon, Notice, Scrim, T, fx, useMotion, useStepCounter } from '@/fx';
import { useStateMix } from '@/fx/press';
import { calmFade, ease, motionValues, timing } from '@/fx/motion/tokens';
import { errorText } from '@/lib/api';
import { Beat, BeatBase } from '@/flow/auth/beats';
import { MeasuredSlot } from './Slot';
import { recordConsents, type Consents } from './model';

const S = motionValues.screens;
const CAPTION_ON = 'You can change these choices any time in your profile.';
const CAPTION_OFF = 'Processing your health information is required to run a programme.';
const AGREE = 'Agree and continue';

export function Consent({ initial, blockers, stepsOn, onDone }: {
  initial: Consents;
  blockers: Array<{ code: string; message: string }>;
  /** The progress module is on (daily steps have somewhere to go). */
  stepsOn: boolean;
  onDone: (c: Consents) => void;
  /** This phase plays its own entrance (the setup's first phase); otherwise the phase swap carries it. */
  enter?: boolean;
}) {
  const [c, setC] = useState<Consents>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const steps = useStepCounter();
  const counting = steps.status === 'counting' || steps.status === 'starting';
  const stepsNote = Platform.OS === 'web' ? 'Works on your phone.' : steps.status === 'unavailable' ? 'This phone has no step counter.'
    : steps.status === 'denied' ? 'Motion access is off for Bioptime in your phone’s settings.'
    : 'Counted on this phone; each day’s total goes to your progress.';
  const set = (k: keyof Consents) => (v: boolean) => { setErr(null); setC((s) => ({ ...s, [k]: v })); };
  const agree = async () => {
    if (!c.healthData) { setErr('Bioptime cannot run a programme without processing health information.'); return; }
    setBusy(true); setErr(null);
    try { await recordConsents(c); onDone(c); }
    catch (e) { setErr(errorText(e)); }
    finally { setBusy(false); }
  };
  const caption = (text: string) => <T v="caption" color={fx.ink.a50} center>{text}</T>;
  const footer = <Beat n={3}><View style={styles.footer}>
    <Scrim kind="stickyCta" style={styles.fade} />
    {err ? <Notice kind="error">{err}</Notice> : null}
    <AgreeButton on={!!c.healthData} busy={busy} onPress={agree} />
    <MeasuredSlot show={{ key: c.healthData ? 'on' : 'off', node: caption(c.healthData ? CAPTION_ON : CAPTION_OFF) }} sizers={[caption(CAPTION_ON), caption(CAPTION_OFF)]} />
  </View></Beat>;
  return <BeatBase at={0} set={S.m57}>
    <FlowScreen width="onboarding" hairline={false} enter={false} footer={footer}>
      <Beat n={0} style={styles.top}>
        <View style={styles.shield}><Icon name="shield" size={26} color={fx.red.vivid} /></View>
        <T v="h1" style={styles.title}>Your data, your control</T>
      </Beat>
      <Beat n={1}>
        <T v="body" color={fx.ink.a60} style={styles.lead}>Bioptime keeps what you share in your account to run your programme. <T v="body" color={fx.ink.white}>You choose what your coach and the partner laboratory may see.</T></T>
        <View style={styles.note}>
          <Icon name="lock" size={13} color={fx.hue.green400} />
          <T v="caption" color={fx.hue.green400} style={styles.flex}>Stored by Bioptime · you can change these any time in Profile › Settings</T>
        </View>
      </Beat>
      <Beat n={2}>
        {blockers.map((b) => <Notice key={b.code} kind="warning" title={b.code === 'EMAIL_UNVERIFIED' ? 'Email not confirmed' : 'Account'} style={styles.blocker}>{b.message}</Notice>)}
        <View style={styles.cards}>
          <T v="eyebrowStore" color={fx.red.label} style={styles.group}>Required</T>
          <ConsentCard icon="heart-pulse" checked={c.healthData} onChange={set('healthData')} title="Process my health information" note="I agree to Bioptime processing my health information (goals, measurements, blood test results) to run my programme. Required to run a programme." />
          <T v="eyebrowStore" color={fx.ink.a50} style={[styles.group, styles.groupNext]}>Optional</T>
          <ConsentCard icon="users" checked={c.coachSharing} onChange={set('coachSharing')} title="My coach may see my health information" note="My coach may see my health information and blood test reports. You can change this any time under Profile › Privacy and sharing." />
          <ConsentCard icon="flask-conical" checked={c.labConsent} onChange={set('labConsent')} title="Share my details with the partner laboratory" note="Bioptime may share my name, phone, email, gender, date of birth and collection address with the partner laboratory to collect samples I book." />
          <ConsentCard icon="mail" checked={c.marketing} onChange={set('marketing')} title="Bioptime news by email" note="Send me occasional Bioptime news." />
          {stepsOn ? <ConsentCard icon="footprints" checked={counting} disabled={Platform.OS === 'web' || steps.status === 'unavailable'} onChange={(v) => { void (v ? steps.enable() : steps.disable()); }} title="Count my steps on this phone" note={stepsNote} /> : null}
        </View>
      </Beat>
    </FlowScreen>
  </BeatBase>;
}

/** "Agree and continue" turning on (M60): a red layer under the button's translucent off fill comes up over
 *  m60.enableMs (useStateMix), the white words over the grey ones, and the glow over m60.glowMs; the button itself
 *  takes over (enabled, its own red, words and glow) once both are in, so nothing snaps. One m60.pulse over
 *  m60.pulseMs, with the check's pop. Turning off is at once for the button, and the layers fade. Reduced motion:
 *  colour only. */
function AgreeButton({ on, busy, onPress }: { on: boolean; busy: boolean; onPress: () => void }) {
  const { calm, inHtml } = useMotion();
  const still = calm || inHtml;
  const [enabled, setEnabled] = useState(on);
  const mix = useStateMix(on, S.m60.enableMs);
  const glow = useSharedValue(on ? 1 : 0);
  const pulse = useSharedValue(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    glow.value = withTiming(on ? 1 : 0, calm ? calmFade() : timing(on ? S.m60.glowMs : S.m60.enableMs, ease.css));
    if (!on) { setEnabled(false); return; }
    if (!still) pulse.value = withSequence(withTiming(1, timing(S.m60.pulseMs / 2, ease.css)), withTiming(0, timing(S.m60.pulseMs / 2, ease.css)));
    const timer = setTimeout(() => setEnabled(true), still ? 0 : Math.max(S.m60.enableMs, S.m60.glowMs));
    return () => clearTimeout(timer);
  }, [on, calm, still, glow, pulse]);
  const box = useAnimatedStyle(() => (pulse.value === 0 ? { transform: [] } : { transform: [{ scale: 1 + (S.m60.pulse - 1) * pulse.value }] }));
  const red = useAnimatedStyle(() => ({ opacity: mix.value }));
  const lit = useAnimatedStyle(() => ({ opacity: glow.value }));
  const handover = !enabled; // the layers draw only while the button is off (on its way in or out)
  return <Animated.View style={box}>
    {handover ? <Animated.View pointerEvents="none" style={[styles.agreeLayer, styles.agreeGlow, lit]} /> : null}
    {handover ? <Animated.View pointerEvents="none" style={[styles.agreeLayer, styles.agreeRed, red]} /> : null}
    {/* keyed by its state: the kit Button keeps its pressed-colour style on the web after it turns disabled */}
    <Button key={enabled ? 'on' : 'off'} title={AGREE} shape="flow" commit busy={busy} disabled={!enabled} onPress={onPress} />
    {handover && !busy ? <Animated.View pointerEvents="none" style={[styles.agreeLayer, styles.agreeWords, red]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
      <T v="button" color={fx.ink.white} numberOfLines={2} center>{AGREE}</T>
    </Animated.View> : null}
  </Animated.View>;
}

const styles = StyleSheet.create({
  top: { paddingTop: 32 },
  shield: { width: 56, height: 56, borderRadius: fx.radius.card, backgroundColor: fx.red.a10, borderWidth: 1, borderColor: fx.red.a25, alignItems: 'center', justifyContent: 'center' },
  title: { marginTop: 28 },
  lead: { marginTop: 12, fontSize: 15, lineHeight: 24 },
  note: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 20, paddingHorizontal: 16, paddingVertical: 12, borderRadius: fx.radius.xl, borderWidth: 1, borderColor: fx.tone.greenLine, backgroundColor: fx.tone.greenBg },
  flex: { flex: 1 },
  blocker: { marginTop: 20 },
  cards: { gap: 12, marginTop: 28, paddingBottom: 8 },
  // a group's label sits 8 pt over its first card; the second group starts 20 pt under the card before it
  group: { marginBottom: -4, letterSpacing: 2.4 },
  groupNext: { marginTop: 8 },
  footer: { gap: 10 },
  fade: { position: 'absolute', left: -24, right: -24, top: -40, height: 28 },
  agreeLayer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 16 },
  agreeGlow: { boxShadow: fx.shadow.cta },
  agreeRed: { backgroundColor: fx.red.brand },
  agreeWords: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
});
