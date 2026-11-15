/* The quiz, in the earlier app's chrome exactly (shots 18–29, tx-quiz-*): a 3 px progress bar across the top, the round
   back button, the step dots (active 20 wide; done and active red) and "n/N" in mono, the ghost step numeral in Bebas
   120 at 2.5 % white, "STEP n OF N" in red, the Bebas 42 question and its light subtitle, the answers, and the sticky red
   "Continue" with the helper line while nothing is chosen. Titles cross-fade (y 8, 250 ms); the ghost numeral follows
   the answers at 0.4× (depth).
   Steps (model.QuizStepId) map onto what Bioptime keeps: activity, height, fitness level and lifestyle tags go into the
   profile's preferences (saved whole every time, over what the server had), the goals into the profile's goals, the
   weight into progress, the date of birth, gender and place into the profile, the diet tags also into the nutrition
   profile while that module is on. Each step saves when it is left (model.ts). Nothing is calculated from the answers.
   Motion v2, The Quiz Deck:
   - The answers are a Deck (./Deck, M58): the step that is left stays mounted, inert, and leaves to the side while the
     next one comes in from the other side in the same frame, on the quiz spring; Back reverses it. Options rise in
     turn (m58.optionStep, at most m58.optionMax; tier A).
   - A step advances at once (optimistic): its answers are saved in the background, one save after another in order; a
     save that fails brings the member back to that step with a toast, a shake and the error haptic. Only "Send my
     answers" waits (its saves must be in before the answers are sent).
   - The answers follow the finger (M59): a horizontal drag moves them 1:1, back to an answered step or forward to one
     already reached, with a rubber band elsewhere; a release past m59.commitShare of the column, or faster than
     m59.commitV, turns the step from where the finger left it.
   - The footer never moves (M54): the helper line and "Skip this step" share one slot above the button, as tall as the
     tallest thing it may hold (measured at the current font scale), crossfading in m54.swapMs.
   - The bar and the dots move by transform (a full-width fill inside the rounded track) and one leaf's width (A30).
   Tier C: an m58.cMs crossfade between steps; reduced motion: 150 ms, no tracking. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Eyebrow, Field, FlowEnter, GoalTile, IconButton, Input, OptionCard, Scrim, Segmented, Stepper, T, Tag, fx, haptics, peekSetting, setSetting, spring, timing, toast, useFx } from '@/fx';
import { ease, motionValues, t } from '@/fx/motion/tokens';
import { errorText } from '@/lib/api';
import { Deck, useDeckDrag } from './Deck';
import { MeasuredSlot } from './Slot';
import { ageOn, saveDiet, saveGoals, saveProfile, saveWeight, type Diet, type Preferences, type Profile, type QuizStepId, type Setup } from './model';
import { ACTIVITY, FITNESS, GENDER, GOALS, LIFESTYLE, STEP_COPY, type Choice } from './quizSteps';
import { DateOfBirth, fromIso, toIso, type Ymd } from './DateOfBirth';

const M58 = motionValues.screens.m58;
const M59 = motionValues.screens.m59;
/** The onboarding column (FlowScreen 'onboarding'). */
const QUIZ_COLUMN = 448;
const SKIP_TITLE = 'Skip this step';

const LB = 0.45359237;
const IN = 2.54;
const SKIPPABLE: QuizStepId[] = ['birth', 'weight', 'height'];
const PIN_HINT = 'Enter a 6-digit PIN code';

type Answers = {
  activityLevel: string | null; fitnessLevel: string | null; heightCm: number | null; lifestyle: string[] | null; goals: string[];
  dob: Ymd; dobSet: boolean; weightKg: number; weightUnit: 'kg' | 'lb'; heightShown: number; heightUnit: 'cm' | 'in';
  profile: Profile;
};

function initial(s: Setup): Answers {
  const p = s.preferences;
  const year = new Date().getFullYear();
  const dob = fromIso(s.profile.dateOfBirth);
  const height = typeof p.heightCm === 'number' ? p.heightCm : null;
  // the units are this device's setting (Profile › Settings shows the same), the server always gets kg and cm
  const weightUnit = peekSetting('units.weight') === 'lb' ? 'lb' : 'kg';
  const heightUnit = peekSetting('units.height') === 'in' ? 'in' : 'cm';
  return {
    activityLevel: typeof p.activityLevel === 'string' ? p.activityLevel : null,
    fitnessLevel: typeof p.fitnessLevel === 'string' ? p.fitnessLevel : null,
    heightCm: height,
    lifestyle: Array.isArray(p.lifestyle) ? p.lifestyle.filter((x): x is string => typeof x === 'string') : null,
    goals: s.goals,
    dob: dob ?? { y: year - 30, m: 1, d: 1 },
    dobSet: !!dob,
    // the stepper starts from the last weight on record, else a starting point the member sets (or skips)
    weightKg: weightUnit === 'lb' ? Math.round((s.lastWeightKg ?? 70) / LB) : Math.round(s.lastWeightKg ?? 70),
    weightUnit,
    heightShown: heightUnit === 'in' ? Math.round((height ?? 170) / IN) : Math.round(height ?? 170),
    heightUnit,
    profile: { ...s.profile },
  };
}

export function Quiz({ steps, start, setup, nutritionOn, onDone, enter = true }: { steps: QuizStepId[]; start: number; setup: Setup; nutritionOn: boolean; onDone: () => void; enter?: boolean }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { calm, inHtml, tier } = useFx();
  const [i, setI] = useState(Math.min(start, steps.length - 1));
  const [dir, setDir] = useState(1);
  const [reached, setReached] = useState(Math.min(start, steps.length - 1)); // the furthest step shown so far
  const [moved, setMoved] = useState(false); // a step has changed (options then rise in)
  const [a, setA] = useState<Answers>(() => initial(setup));
  const [busy, setBusy] = useState(false);
  const id = steps[i];
  const copy = STEP_COPY[id];
  const n = steps.length;
  const column = Math.min(width, QUIZ_COLUMN); // W: the deck's travel and the drag's commit distance (A42)
  const ghostX = useSharedValue(0); // the answers' x (the ghost numeral follows at 0.4×)
  const shake = useSharedValue(0);
  const drag = useDeckDrag();
  const diet = useRef<Diet>({ restrictions: setup.restrictions, dietPattern: setup.dietPattern }); // what the nutrition profile holds
  const queue = useRef<Promise<unknown>>(Promise.resolve()); // the saves, one after another, in order
  const gen = useRef(0); // a failed save brings the member back once; older failures are then moot
  const iRef = useRef(i);
  iRef.current = i;

  const prefs = (x: Answers): Preferences => {
    const out: Preferences = { ...setup.preferences };
    if (x.activityLevel) out.activityLevel = x.activityLevel;
    if (x.fitnessLevel) out.fitnessLevel = x.fitnessLevel;
    if (x.heightCm != null) out.heightCm = x.heightCm;
    if (x.lifestyle) out.lifestyle = x.lifestyle;
    return out;
  };
  const ageOk = ageOn(toIso(a.dob)) >= 18;
  const pinOk = !a.profile.pincode?.trim() || /^\d{6}$/.test(a.profile.pincode.trim());
  const valid = id === 'activity' ? !!a.activityLevel : id === 'fitness' ? !!a.fitnessLevel : id === 'goals' ? a.goals.length > 0
    : id === 'gender' ? !!a.profile.gender : id === 'birth' ? ageOk : id === 'place' ? pinOk : true;
  const hint = id === 'place' && !pinOk ? PIN_HINT : copy.hint;

  const go = (to: number) => {
    if (to === i || to < 0 || to >= n) return;
    // the keyboard of a field on the step that is left goes with it (on iOS and Android a tap on Continue or Back, or a
    // swipe, does not leave a field; the date of birth's typed value is already in, PK5-R1)
    Keyboard.dismiss();
    setDir(to > i ? 1 : -1); setI(to); setMoved(true); setReached((r) => Math.max(r, to));
  };
  const save = async (step: QuizStepId, x: Answers, skip: boolean) => {
    switch (step) {
      case 'activity': case 'fitness': case 'goals': await saveGoals(x.goals, prefs(x)); break;
      case 'height': if (!skip) await saveGoals(x.goals, prefs(x)); break;
      case 'lifestyle': await saveGoals(x.goals, prefs(x)); if (nutritionOn) diet.current = await saveDiet(x.lifestyle ?? [], diet.current); break;
      case 'weight': if (!skip) await saveWeight(x.weightUnit === 'kg' ? x.weightKg : x.weightKg * LB); break;
      case 'birth': if (!skip) await saveProfile(x.profile); break;
      case 'gender': case 'place': await saveProfile(x.profile); break;
    }
  };
  // a save that failed: back to its step, with the reason, a shake and the error haptic
  const failed = (at: number, e: unknown) => {
    gen.current += 1;
    toast.error(errorText(e));
    haptics.error();
    const cur = iRef.current;
    if (cur !== at) { setDir(at < cur ? -1 : 1); setI(at); }
    if (!calm && !inHtml) {
      const k = M58.shake;
      const step = M58.shakeMs / (k.length - 1);
      // after the step is back in front (the deck's spring has mostly landed)
      shake.value = withDelay(cur !== at ? t.flow : 0, withSequence(...k.slice(1).map((x) => withTiming(x, timing(step, ease.cssInOut)))));
    }
  };
  const next = async (skip = false) => {
    let x = a;
    if (id === 'birth' && !skip) { if (!ageOk) { toast.error('You must be 18 or over to use Bioptime.'); return; } x = { ...a, dobSet: true, profile: { ...a.profile, dateOfBirth: toIso(a.dob) } }; }
    if (id === 'birth' && skip) x = { ...a, profile: { ...a.profile, dateOfBirth: a.dobSet ? toIso(a.dob) : setup.profile.dateOfBirth } };
    if (id === 'height' && !skip) x = { ...a, heightCm: a.heightUnit === 'cm' ? a.heightShown : Math.round(a.heightShown * IN) };
    if (id === 'lifestyle') {
      // the stress and sleep tags are goals too (GAP_MAP §4.3); nothing else is derived from the tags
      const tags = a.lifestyle ?? [];
      const extra = [tags.includes('stress') ? 'Stress' : null, tags.includes('sleep') ? 'Energy and sleep' : null].filter((g): g is string => !!g && !a.goals.includes(g));
      x = { ...a, lifestyle: tags, goals: [...a.goals, ...extra] };
    }
    setA(x);
    const at = i;
    const step = id;
    const g = gen.current;
    const job = queue.current.then(() => save(step, x, skip));
    queue.current = job.catch(() => undefined);
    if (at >= n - 1) {
      // "Send my answers": every save must be in before the answers are sent
      setBusy(true);
      try { await job; } catch (e) { setBusy(false); if (gen.current === g) failed(at, e); return; }
      setBusy(false);
      onDone();
      return;
    }
    job.catch((e: unknown) => { if (gen.current === g) failed(at, e); });
    go(at + 1);
  };

  // the drag: forward only to a step already reached (and answered), back to any earlier one
  const canBack = useSharedValue(i > 0 ? 1 : 0);
  const canFwd = useSharedValue(0);
  useEffect(() => { canBack.value = i > 0 ? 1 : 0; canFwd.value = i < reached && valid && i < n - 1 && !busy ? 1 : 0; }, [i, reached, valid, n, busy, canBack, canFwd]);
  const nextRef = useRef(next);
  nextRef.current = next;
  const goRef = useRef(go);
  goRef.current = go;
  // a committed swipe: forward saves and advances as Continue does; back goes to the step before
  const onSwipe = useCallback((d: number) => { if (d > 0) void nextRef.current(false); else goRef.current(iRef.current - 1); }, []);
  const follow = !calm && !inHtml;
  const commitAt = M59.commitShare * column;
  const pan = Gesture.Pan()
    .activeOffsetX([-M59.activeOffsetX, M59.activeOffsetX])
    .failOffsetY([-M59.failOffsetY, M59.failOffsetY])
    .onUpdate((e) => {
      if (!follow) return;
      const dx = e.translationX;
      const ok = dx > 0 ? canBack.value === 1 : canFwd.value === 1;
      drag.x.value = dx * (ok ? M59.textFollow : M59.rubber);
    })
    .onEnd((e) => {
      const dx = e.translationX;
      const vx = e.velocityX;
      const d = dx < 0 ? 1 : -1;
      const ok = d > 0 ? canFwd.value === 1 : canBack.value === 1;
      const far = Math.abs(dx) > commitAt || (Math.abs(vx) > M59.commitV && vx * dx > 0);
      if (ok && far && dx !== 0) {
        drag.v.value = vx;
        scheduleOnRN(onSwipe, d);
      } else if (drag.x.value !== 0) {
        drag.x.value = withSpring(0, { ...spring.dismiss, velocity: vx });
      }
    });

  const pick = (k: 'activityLevel' | 'fitnessLevel') => (v: string) => setA((s) => ({ ...s, [k]: v }));
  const toggle = (k: 'goals' | 'lifestyle', v: string) => setA((s) => { const cur = s[k] ?? []; return { ...s, [k]: cur.includes(v) ? cur.filter((g) => g !== v) : [...cur, v] }; });
  const setProfile = (k: keyof Profile) => (v: string) => setA((s) => ({ ...s, profile: { ...s.profile, [k]: v } }));
  const rise = moved && tier === 'A' && !calm && !inHtml; // options rise in turn on a step change (tier A)

  const body = (() => {
    switch (id) {
      case 'activity': return <Options choices={ACTIVITY} value={a.activityLevel} onPick={pick('activityLevel')} rise={rise} />;
      case 'fitness': return <Options choices={FITNESS} value={a.fitnessLevel} onPick={pick('fitnessLevel')} rise={rise} />;
      case 'gender': return <Options choices={GENDER} value={a.profile.gender ?? null} onPick={setProfile('gender')} rise={rise} />;
      case 'birth': return <View style={styles.center}>
        <DateOfBirth value={a.dob} onChange={(dob) => setA((s) => ({ ...s, dob }))} />
        <T v="eyebrowStore" color={fx.ink.a55} center style={styles.range}>{ageOk ? `${ageOn(toIso(a.dob))} years old` : 'Under 18'}</T>
      </View>;
      case 'weight': return <View style={styles.center}>
        <Stepper key={a.weightUnit} value={a.weightKg} onChange={(v) => setA((s) => ({ ...s, weightKg: v }))} min={a.weightUnit === 'kg' ? 30 : 66} max={a.weightUnit === 'kg' ? 200 : 440} unit={a.weightUnit === 'kg' ? 'kg' : 'lbs'} label="Weight" />
        <T v="eyebrowStore" color={fx.ink.a55} center style={styles.range}>{a.weightUnit === 'kg' ? '30 — 200 kg' : '66 — 440 lbs'}</T>
        <Segmented kind="red" style={styles.units} value={a.weightUnit} items={[{ value: 'kg', label: 'KG', a11y: 'Kilograms' }, { value: 'lb', label: 'LBS', a11y: 'Pounds' }]}
          onChange={(u) => { void setSetting('units.weight', u); setA((s) => ({ ...s, weightUnit: u, weightKg: u === s.weightUnit ? s.weightKg : u === 'lb' ? Math.round(s.weightKg / LB) : Math.round(s.weightKg * LB) })); }} />
      </View>;
      case 'height': return <View style={styles.center}>
        <Stepper key={a.heightUnit} value={a.heightShown} onChange={(v) => setA((s) => ({ ...s, heightShown: v }))} min={a.heightUnit === 'cm' ? 100 : 39} max={a.heightUnit === 'cm' ? 230 : 90} unit={a.heightUnit === 'cm' ? 'cm' : 'in'} label="Height"
          format={a.heightUnit === 'in' ? (v) => `${Math.floor(v / 12)}'${v % 12}"` : undefined} />
        <T v="eyebrowStore" color={fx.ink.a55} center style={styles.range}>{a.heightUnit === 'cm' ? '100 — 230 cm' : '3\'3" — 7\'6"'}</T>
        <Segmented kind="red" style={styles.units} value={a.heightUnit} items={[{ value: 'cm', label: 'CM', a11y: 'Centimetres' }, { value: 'in', label: 'IN', a11y: 'Inches' }]}
          onChange={(u) => { void setSetting('units.height', u); setA((s) => ({ ...s, heightUnit: u, heightShown: u === s.heightUnit ? s.heightShown : u === 'in' ? Math.round(s.heightShown / IN) : Math.round(s.heightShown * IN) })); }} />
      </View>;
      case 'goals': return <View style={styles.grid}>
        {pairs(GOALS).map((row, k) => <Rise key={row[0].value} index={k} on={rise}><View style={styles.gridRow}>
          {row.map((g) => <GoalTile key={g.value} title={g.label} description={g.description} icon={g.icon} selected={a.goals.includes(g.value)} onPress={() => toggle('goals', g.value)} />)}
          {row.length === 1 ? <View style={styles.flex} /> : null}
        </View></Rise>)}
      </View>;
      case 'lifestyle': return <View>
        <View style={styles.tags}>{LIFESTYLE.map((t) => <Tag key={t.value} label={t.label} selected={(a.lifestyle ?? []).includes(t.value)} onPress={() => toggle('lifestyle', t.value)} />)}</View>
        <T v="bodySm" color={fx.ink.a40} style={styles.tagsNote}>{nutritionOn ? 'Select all that apply; you can change them later. Diet tags also go to your nutrition profile.' : 'Select all that apply; you can change them later.'}</T>
      </View>;
      case 'place': return <View style={styles.form}>
        <Field label="City"><Input value={a.profile.city ?? ''} onChangeText={setProfile('city')} autoComplete="postal-address-locality" /></Field>
        <View style={styles.pair}>
          <View style={styles.flex}><Field label="State"><Input value={a.profile.state ?? ''} onChangeText={setProfile('state')} autoComplete="postal-address-region" /></Field></View>
          <View style={styles.flex}><Field label="PIN code" error={pinOk ? null : PIN_HINT}><Input value={a.profile.pincode ?? ''} onChangeText={(v) => setProfile('pincode')(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} autoComplete="postal-code" mono /></Field></View>
        </View>
        <Field label="Address for home collections (optional)"><Input value={a.profile.address ?? ''} onChangeText={setProfile('address')} multiline style={styles.address} autoComplete="street-address" /></Field>
      </View>;
    }
  })();

  // the slot above the button: the helper line, "Skip this step", or both (an under-18 date of birth)
  const showHint = (!valid || id === 'place') && !!hint;
  const showSkip = SKIPPABLE.includes(id);
  const hintLine = (text: string) => <T v="caption" color={fx.ink.a50} center>{text}</T>;
  const skipSizer = <View style={styles.skipSizer}><T v="chip">{SKIP_TITLE}</T></View>;
  const slot = showHint || showSkip ? {
    key: `${showHint ? hint : ''}|${showSkip ? 'skip' : ''}`,
    node: <View style={styles.slotCol}>
      {showHint ? hintLine(hint) : null}
      {showSkip ? <Button title={SKIP_TITLE} variant="link" iconRight={null} onPress={() => { void next(true); }} disabled={busy} style={styles.skip} /> : null}
    </View>,
  } : null;
  const sizers = [
    ...Array.from(new Set([...steps.map((s) => STEP_COPY[s].hint), PIN_HINT].filter(Boolean))).map((h) => <View key={h} style={styles.slotCol}>{hintLine(h)}</View>),
    <View key="skip" style={styles.slotCol}>{skipSizer}</View>,
    <View key="both" style={styles.slotCol}>{hintLine(STEP_COPY.birth.hint)}{skipSizer}</View>,
  ];
  const shook = useAnimatedStyle(() => (shake.value === 0 ? { transform: [] } : { transform: [{ translateX: shake.value }] }));

  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.screen}>
    <TopBar progress={n > 1 ? i / (n - 1) : 1} calm={calm || inHtml} />
    <FlowEnter off={!enter}>
      <View style={[styles.column, { paddingTop: insets.top + 32 }]}>
        <View style={styles.head}>
          {i > 0 ? <IconButton icon="chevron-left" label="Back" kind="round" onPress={() => go(i - 1)} disabled={busy} /> : <View style={styles.headSide} />}
          <StepDots count={n} at={i} calm={calm || inHtml} />
          <T v="mono11" color={fx.ink.a40} style={styles.count} accessibilityLabel={`Step ${i + 1} of ${n}`}>{`${i + 1}/${n}`}</T>
        </View>
      </View>
      <GestureDetector gesture={pan}>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <View style={styles.column}>
            <TitleBlock key={`t${i}`} n={i + 1} of={n} title={copy.title} subtitle={copy.subtitle} slide={ghostX} calm={calm || inHtml} />
            <Animated.View style={[styles.body, shook]}>
              <Deck index={i} dir={dir} width={column} drag={drag} mode="quiz" track={ghostX}>{body}</Deck>
            </Animated.View>
          </View>
        </ScrollView>
      </GestureDetector>
      <View style={[styles.column, styles.footer, { paddingBottom: insets.bottom + 24 }]}>
        <Scrim kind="stickyCta" style={styles.fade} />
        <MeasuredSlot show={slot} sizers={sizers} align="bottom" />
        {/* keyed by its state: on the web the kit Button keeps its pressed-colour style after it turns disabled (a
            disabled Continue would stay red), so it is drawn afresh when it turns on or off (kit request, PK2) */}
        <Button key={valid ? 'on' : 'off'} title={copy.cta ?? 'Continue'} shape="flow" icon={undefined} iconRight={id === 'place' ? 'flame' : 'arrow-right'} commit busy={busy} disabled={!valid} onPress={() => { void next(false); }} />
      </View>
    </FlowEnter>
  </KeyboardAvoidingView>;
}

function pairs<T>(list: T[]): T[][] { const out: T[][] = []; for (let k = 0; k < list.length; k += 2) out.push(list.slice(k, k + 2)); return out; }

function Options({ choices, value, onPick, rise }: { choices: Choice[]; value: string | null; onPick: (v: string) => void; rise: boolean }) {
  return <View style={styles.options} accessibilityRole="radiogroup">
    {choices.map((c, k) => <Rise key={c.value} index={k} on={rise}><OptionCard title={c.label} description={c.description} icon={c.icon} selected={value === c.value} onPress={() => onPick(c.value)} /></Rise>)}
  </View>;
}

/** An answer rising in with its step: y m58.optionRise → 0 and its opacity, m58.optionStep apart (at most
 *  m58.optionMax steps), as the step comes in. `on` false (the first step, tier B and C, reduced motion): at rest. */
function Rise({ index, on, children }: { index: number; on: boolean; children: React.ReactNode }) {
  const [play] = useState(on);
  const p = useSharedValue(play ? 0 : 1);
  useEffect(() => {
    if (play) p.value = withDelay(Math.min(index, M58.optionMax) * M58.optionStep, withTiming(1, timing(t.base)));
    // once, on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const a = useAnimatedStyle(() => (p.value === 1 ? { opacity: 1, transform: [] } : { opacity: p.value, transform: [{ translateY: M58.optionRise * (1 - p.value) }] }));
  return <Animated.View style={a}>{children}</Animated.View>;
}

/** The 3 px bar across the very top (white/5 track, red fill): a full-width fill moved by translateX inside the
 *  clipped track (A30), on the quiz spring with the deck. */
function TopBar({ progress, calm }: { progress: number; calm: boolean }) {
  const p = useSharedValue(progress);
  const w = useSharedValue(0);
  useEffect(() => { p.value = calm ? progress : withSpring(progress, spring.quiz); }, [progress, calm, p]);
  const onLayout = (e: LayoutChangeEvent) => { const v = e.nativeEvent.layout.width; if (v > 0) w.value = v; };
  const fill = useAnimatedStyle(() => {
    const k = Math.max(0, Math.min(1, p.value));
    if (w.value === 0) return { opacity: k > 0 ? 0 : 1, transform: [] }; // not laid out yet
    return k === 1 ? { opacity: 1, transform: [] } : { opacity: 1, transform: [{ translateX: -w.value * (1 - k) }] };
  });
  return <View style={styles.bar} onLayout={onLayout} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Animated.View style={[styles.barFill, fill]} /></View>;
}

function StepDots({ count, at, calm }: { count: number; at: number; calm: boolean }) {
  return <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    {Array.from({ length: count }, (_, k) => <StepDot key={k} state={k < at ? 'done' : k === at ? 'on' : 'todo'} calm={calm} />)}
  </View>;
}

function StepDot({ state, calm }: { state: 'done' | 'on' | 'todo'; calm: boolean }) {
  const w = useSharedValue(state === 'on' ? 20 : 6);
  useEffect(() => { const to = state === 'on' ? 20 : 6; w.value = calm ? to : withSpring(to, spring.stagger); }, [state, calm, w]);
  const a = useAnimatedStyle(() => ({ width: w.value }));
  return <Animated.View style={[styles.dot, { backgroundColor: state === 'todo' ? fx.fill.a10 : fx.red.brand }, a]} />;
}

function TitleBlock({ n, of, title, subtitle, slide, calm }: { n: number; of: number; title: string; subtitle: string; slide: SharedValue<number>; calm: boolean }) {
  const p = useSharedValue(calm ? 1 : 0);
  useEffect(() => { if (!calm) p.value = withTiming(1, timing(250)); }, [calm, p]);
  const text = useAnimatedStyle(() => (p.value === 1 ? { opacity: 1, transform: [] } : { opacity: p.value, transform: [{ translateY: 8 * (1 - p.value) }] }));
  const ghost = useAnimatedStyle(() => ({ transform: [{ translateX: slide.value * 0.4 }] }));
  return <View style={styles.titleBlock}>
    <Animated.View style={[styles.ghost, ghost]} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
      <T v="ghost" accessible={false}>{String(n).padStart(2, '0')}</T>
    </Animated.View>
    <Animated.View style={text}>
      <Eyebrow kind="brand">{`Step ${n} of ${of}`}</Eyebrow>
      <T v="quiz42" style={styles.title}>{title}</T>
      <T v="body" color={fx.ink.ink2} style={styles.subtitle}>{subtitle}</T>
    </Animated.View>
  </View>;
}


const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: fx.bg.base },
  bar: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, backgroundColor: fx.fill.a05, zIndex: 5, overflow: 'hidden' },
  barFill: { width: '100%', height: 3, backgroundColor: fx.red.brand },
  column: { width: '100%', maxWidth: 448, alignSelf: 'center', paddingHorizontal: 20 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  headSide: { width: 36, height: 36 },
  count: { width: 36, textAlign: 'right', letterSpacing: 1 },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { height: 6, borderRadius: 3 },
  scroll: { flexGrow: 1, paddingBottom: 16 },
  titleBlock: { marginTop: 28, marginBottom: 24 },
  ghost: { position: 'absolute', right: -4, top: -40 },
  title: { marginTop: 10 },
  subtitle: { marginTop: 10 },
  body: { flexGrow: 1 },
  options: { gap: 12 },
  center: { alignItems: 'center', gap: 4, paddingTop: 8 },
  range: { marginTop: 16, letterSpacing: 2 },
  units: { marginTop: 24, width: 140, alignSelf: 'center' },
  grid: { gap: 12 },
  gridRow: { flexDirection: 'row', gap: 12 },
  flex: { flex: 1 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tagsNote: { marginTop: 16 },
  form: { gap: 20 },
  pair: { flexDirection: 'row', gap: 12 },
  address: { minHeight: 88, textAlignVertical: 'top' },
  footer: { gap: 10, paddingTop: 12 },
  fade: { position: 'absolute', left: 0, right: 0, top: -28, height: 28 },
  skip: { alignSelf: 'center' },
  slotCol: { alignItems: 'stretch', gap: 6 },
  skipSizer: { alignSelf: 'center', paddingVertical: 6, minHeight: 24, justifyContent: 'center' },
});
