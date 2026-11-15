/* The first-run setup (AMENDED_PLAN_NOTES §2; the earlier app's consent → carousel → quiz → "building" sequence, worded
   for Bioptime): consent (POST /me/consents) → three slides → the quiz → "Sending your answers" → Home. The calls and
   their order are in src/flow/onboarding/model.ts: the onboarding consents step and done are posted last, so the
   account is not completed before the coach has the answers. The setup opens where the server's answers say the
   member got to (GET /me/onboarding savedData and GET /me/consents), never from the step pointer; a member who finished
   it goes Home. EMAIL_UNVERIFIED and other blockers show on the consent screen. Feature flags: the weight step needs
   the progress module, the diet tags go to the nutrition profile only while nutrition is on.
   Motion v2 (M57): the phases follow each other through one FlowSwap (the phase that leaves fades upward, inert, while
   the next rises in, overlapped); no outer entrance compounds with a phase's own, which only the first phase shown
   plays. "Sending" hands over to Home: once the server has the answers the session is read again and Home's first
   loads start (prefetchHome) during the bar's last stretch and its hold, so Home opens without a skeleton; the screen
   fades out (Building) and then the route changes. */
import { Redirect, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { ErrorState, FlowScreen, RingSpinner, fx, invalidate } from '@/fx';
import { FlowSwap } from '@/fx/FxScreen';
import { prefetchHome } from '@/screens/home/data';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFeatures } from '@/lib/features';
import { Building } from '@/flow/onboarding/Building';
import { Consent } from '@/flow/onboarding/Consent';
import { loadSetup, resumeAt, type Consents, type Phase, type QuizStepId, type Setup } from '@/flow/onboarding/model';
import { Quiz } from '@/flow/onboarding/Quiz';
import { Slides } from '@/flow/onboarding/Slides';

const ALL_STEPS: QuizStepId[] = ['activity', 'birth', 'weight', 'height', 'fitness', 'goals', 'lifestyle', 'gender', 'place'];

export default function Onboarding() {
  const router = useRouter();
  const { refresh } = useAuth();
  const features = useFeatures(true);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [slide, setSlide] = useState(0);
  const [step, setStep] = useState(0);
  const [consents, setConsents] = useState<Consents | null>(null);
  const [backToSending, setBackToSending] = useState(false); // the consent screen was reopened by the sending step
  const nutritionOn = !!features?.has('nutrition');
  const progressOn = !features || features.has('progress');
  const steps = useMemo(() => ALL_STEPS.filter((s) => s !== 'weight' || progressOn), [progressOn]);

  const known = !!features; // the module switches are read once; the setup then keeps its own phase
  useEffect(() => {
    if (!known) return;
    let alive = true;
    setError(null);
    loadSetup(nutritionOn).then((s) => {
      if (!alive) return;
      setSetup(s);
      setConsents(s.consents);
      const at = resumeAt(s, steps);
      setPhase(at.phase); setSlide(at.slide); setStep(at.step);
    }, (e: unknown) => { if (alive) setError(e instanceof Error ? e : new Error(String(e))); });
    return () => { alive = false; };
  }, [known, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  // the server has the answers: the session and Home's first loads, read again now (onboarding is complete)
  const sent = async () => {
    await refresh();
    invalidate(['me']); // the tabs read GET /me again: onboarding is complete now
    await prefetchHome({ workouts: true });
  };
  const home = () => router.replace('/(tabs)');

  // the phases share the screen's height (a FlowSwap layer is as tall as its content)
  const [height, setHeight] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => { const h = Math.round(e.nativeEvent.layout.height); if (h > 0) setHeight(h); };
  // only the first phase shown plays its own entrance; later ones enter with the swap
  const first = useRef<Phase | null>(null);
  const swapped = useRef(false);
  if (phase && first.current === null) first.current = phase;
  if (phase && first.current !== null && phase !== first.current) swapped.current = true;
  const own = (p: Phase) => first.current === p && phase === p && !swapped.current;

  if (setup?.onboarding.completedAt) return <Redirect href="/(tabs)" />;
  if (error) return <FlowScreen width="onboarding"><View style={styles.pad}><ErrorState error={error} onRetry={() => setAttempt((a) => a + 1)} /></View></FlowScreen>;
  const ready = !!setup && !!phase && !!consents;
  const box = height ? { height } : styles.fill;

  return <View style={styles.screen} onLayout={onLayout}>
    {!ready || !setup || !phase || !consents ? <View style={styles.wait}><RingSpinner size={24} label="Loading" /></View>
      : <FlowSwap id={phase} style={styles.fill}>
        <View style={box}>
          {phase === 'consent' ? <Consent enter={own('consent')} initial={consents} blockers={setup.onboarding.blockers ?? []} stepsOn={progressOn} onDone={(c) => { setConsents(c); setSetup({ ...setup, consents: c, consented: true }); setSlide(0); setPhase(backToSending ? 'sending' : 'slides'); setBackToSending(false); }} />
            : phase === 'slides' ? <Slides enter={own('slides')} start={slide} onboarding={setup.onboarding} onDone={() => setPhase('quiz')} />
            : phase === 'quiz' ? <Quiz enter={own('quiz')} steps={steps} start={step} setup={setup} nutritionOn={nutritionOn} onDone={() => setPhase('sending')} />
            : <Building enter={own('sending')} consents={consents} onSent={sent} onDone={home} onConsent={() => { setBackToSending(true); setPhase('consent'); }} />}
        </View>
      </FlowSwap>}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: fx.bg.base },
  fill: { flex: 1 },
  wait: { flex: 1, backgroundColor: fx.bg.base, alignItems: 'center', justifyContent: 'center' },
  pad: { paddingTop: 48 },
});
