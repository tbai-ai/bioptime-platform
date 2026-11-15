/* The kit gallery's controls and feedback part (/__fx, development builds only; the hub src/fx/gallery/MotionGallery
   renders it): the sub-view swap under tabs, the segment pill and its cancelled press, the switch, the stepper held,
   the press colours, toasts stacking, swiped away and clearing a header, the verified moment and its exit, field
   errors, the code boxes filled at once and cleared, and the empty, error and notice states. Nothing here reads or
   writes member data; the words and numbers are illustrations. */
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedRef, useScrollOffset } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '@/lib/api';
import { fx } from '@/theme';
import { Button, IconButton, RingSpinner } from '../Button';
import { Check, ConsentCard } from '../Check';
import { FilterChip, Tag } from '../Chip';
import { EmptyState } from '../EmptyState';
import { ErrorState, StaleBanner } from '../ErrorState';
import { Field, Input } from '../Field';
import { GlassCard } from '../GlassCard';
import { Accordion, SettingsRow } from '../ListRow';
import { RevealScope } from '../motion/Reveal';
import { Notice } from '../Notice';
import { GoalTile, OptionCard } from '../OptionCard';
import { OtpBoxes, type OtpBoxesHandle } from '../OtpBoxes';
import { PillTabs, SwitchView } from '../PillTabs';
import { Segmented } from '../Segmented';
import { Stepper } from '../Stepper';
import { Eyebrow, T } from '../Text';
import { toast, useTopToastClearance } from '../Toast';
import { Toggle } from '../Toggle';
import { VerifiedOverlay } from '../Verified';

/** The height of the gallery's own header below the safe inset (the Overlay's back row). */
const HEADER_H = 56;

function Part({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return <View style={styles.part}>
    <Eyebrow kind="brand">{title}</Eyebrow>
    {note ? <T v="bodySm" color={fx.ink.a60}>{note}</T> : null}
    {children}
  </View>;
}

function Row({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

const VIEWS = [{ value: 'summary', label: 'Summary' }, { value: 'badges', label: 'Badges' }, { value: 'records', label: 'Records' }, { value: 'history', label: 'History' }, { value: 'options', label: 'Options' }] as const;
type ViewId = (typeof VIEWS)[number]['value'];

/** M16, M17: the pill glides (critically damped), labels follow it, the old panel stays inert while it leaves. */
function Switching() {
  const [view, setView] = useState<ViewId>('summary');
  const [dir, setDir] = useState<1 | -1>(1);
  const [unit, setUnit] = useState<'kg' | 'lb'>('kg');
  const [range, setRange] = useState<'day' | 'week' | 'month'>('week');
  const order = VIEWS.map((v) => v.value as string);
  return <>
    <Segmented kind="red" value={unit} onChange={setUnit} items={[{ value: 'kg', label: 'KG', a11y: 'Kilograms' }, { value: 'lb', label: 'LBS', a11y: 'Pounds' }]} />
    <T v="micro" color={fx.ink.a50} testID="fx-unit">{`Unit: ${unit === 'kg' ? 'kilograms' : 'pounds'}`}</T>
    <Segmented value={range} onChange={setRange} items={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />
    <PillTabs items={[...VIEWS]} value={view} onChange={(v) => { setDir(order.indexOf(v) > order.indexOf(view) ? 1 : -1); setView(v); }} />
    <SwitchView id={view} direction={dir}>
      {view === 'summary' ? <GlassCard><T v="cardTitle">Summary</T><T v="bodySm" color={fx.ink.a60}>A short panel with a field and a button.</T>
        <View style={styles.gap}><Input placeholder="A note" label="Summary note" /><Button title="Save the note" variant="soft" small full={false} /></View></GlassCard>
        : view === 'badges' ? <View style={styles.gap}>{Array.from({ length: 5 }, (_, i) => <GlassCard key={i}><T v="cardTitle">{`Badge ${i + 1}`}</T><T v="bodySm" color={fx.ink.a60}>A taller panel: the height glides on native and snaps under the faded exit on the web.</T></GlassCard>)}</View>
          : <GlassCard><T v="cardTitle">{VIEWS.find((v) => v.value === view)?.label}</T><Button title={`Open ${view}`} variant="soft" small full={false} /></GlassCard>}
    </SwitchView>
  </>;
}

/** M18, M22: the knob and its colour on one value; the stepper steps early, never on a scroll, and rolls. */
function SwitchAndStepper() {
  const [on, setOn] = useState(false);
  const [weight, setWeight] = useState(72);
  const [floor, setFloor] = useState(30);
  return <>
    <Toggle value={on} onChange={setOn} label="Weekly reminders" showLabel />
    <Stepper value={weight} onChange={setWeight} min={30} max={200} unit="kg" label="Body weight" />
    <T v="micro" color={fx.ink.a50} center>Hold the plus: it repeats after 350 ms, faster after 1.5 s. A scroll that starts on it changes nothing.</T>
    <Stepper value={floor} onChange={setFloor} min={30} max={40} unit="min" label="Session length" />
    <T v="micro" color={fx.ink.a50} center>At its lowest value the minus bumps instead of staying silent.</T>
  </>;
}

/** M20, M21, M28: press colours on the first frame, state colours that glide, rows that a drag-off cancels. */
function Presses() {
  const [chip, setChip] = useState('Strength');
  const [option, setOption] = useState('steady');
  const [tags, setTags] = useState<string[]>([]);
  const [agree, setAgree] = useState(false);
  const [consent, setConsent] = useState(false);
  const [goal, setGoal] = useState(false);
  const [saving, setSaving] = useState(false);
  return <>
    <Button title="Save changes" commit busy={saving} onPress={() => { setSaving(true); setTimeout(() => setSaving(false), 1600); }} />
    <Row>
      <Button title="View details" variant="soft" full={false} />
      <Button title="Browse" variant="redTint" full={false} />
      <Button title="Log" variant="solidSm" full={false} />
    </Row>
    <Row>
      <Button title="Leave" variant="redGlass" full={false} />
      <Button title="Next" variant="white" full={false} />
      <IconButton icon="x" label="Dismiss" />
      <RingSpinner label="Saving" />
    </Row>
    <View style={styles.wrap}>{['Strength', 'Mobility', 'Recovery'].map((c) => <FilterChip key={c} label={c} selected={chip === c} onPress={() => setChip(c)} />)}</View>
    <View style={styles.wrap}>{['Early riser', 'Desk job'].map((x) => <Tag key={x} label={x} selected={tags.includes(x)} onPress={() => setTags((t) => (t.includes(x) ? t.filter((y) => y !== x) : [...t, x]))} />)}</View>
    {[['steady', 'Steady pace', 'Three sessions a week'], ['push', 'Push harder', 'Four or five sessions']].map(([v, title, d]) => <OptionCard key={v} title={title!} description={d} icon={v === 'steady' ? 'footprints' : 'zap'} selected={option === v} onPress={() => setOption(v!)} />)}
    <Row><GoalTile title="Calmer evenings" description="A goal tile" icon="moon" selected={goal} onPress={() => setGoal((g) => !g)} /></Row>
    <Check checked={agree} onChange={setAgree} label="Remind me on Sundays" />
    <ConsentCard checked={consent} onChange={setConsent} title="Share my progress" note="Your coach sees your weekly summary." icon="heart-pulse" />
    <SettingsRow icon="shield-check" title="Privacy and sharing" sub="Press, move away and release: nothing opens" onPress={() => toast.info('Opened privacy and sharing')} />
    <View style={styles.frame}>
      <ScrollView nestedScrollEnabled contentContainerStyle={styles.frameBody}>
        {Array.from({ length: 6 }, (_, i) => <GlassCard key={i} onPress={() => toast.info(`Card ${i + 1} opened`)} label={`Card ${i + 1}`}><T v="cardTitle">{`Card ${i + 1}`}</T><T v="bodySm" color={fx.ink.a60}>A scroll that starts here never warms the border.</T></GlassCard>)}
      </ScrollView>
    </View>
  </>;
}

/** M19, M23, M25: the stack composes, the evicted toast leaves, a swipe dismisses, the lane clears a header. */
function Toasts() {
  const insets = useSafeAreaInsets();
  const [clear, setClear] = useState(false);
  useTopToastClearance(insets.top + HEADER_H, clear);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const three = () => {
    toast.info('First: saved to your plan');
    timers.current.push(setTimeout(() => toast.success('Second: booking confirmed'), 350));
    timers.current.push(setTimeout(() => toast.error('Third: that did not go through'), 700));
  };
  return <>
    <Row>
      <Button title="Three toasts" variant="soft" small full={false} onPress={three} />
      <Button title="Info" variant="soft" small full={false} onPress={() => toast.info('Saved to your plan')} />
      <Button title="Success" variant="soft" small full={false} onPress={() => toast.success('Booking confirmed')} />
      <Button title="Error" variant="soft" small full={false} onPress={() => toast.error('That did not go through')} />
    </Row>
    <Row>
      <Button title="Bottom pill" variant="soft" small full={false} onPress={() => toast.logged('250 ml added')} />
      <Button title="Replace the pill" variant="soft" small full={false} onPress={() => { toast.logged('250 ml added'); timers.current.push(setTimeout(() => toast.logged('500 ml added'), 400)); }} />
    </Row>
    <Toggle value={clear} onChange={setClear} label="Clear the header" showLabel />
    <T v="micro" color={fx.ink.a50}>Swipe a top toast up to dismiss it; with the header cleared, the top lane starts under this screen's header.</T>
  </>;
}

/** M24: badge-only pop, the ring burst, the hold and a real exit; onExitStart and onDone in order. */
function Verified() {
  const [shown, setShown] = useState(false);
  const [log, setLog] = useState('');
  const at = useRef(0);
  return <>
    <View style={styles.verifiedFrame}>
      <T v="bodySm" color={fx.ink.a60} center>The code was accepted.</T>
      <VerifiedOverlay visible={shown}
        onExitStart={() => setLog(`Exit started after ${Date.now() - at.current} ms`)}
        onDone={() => { setLog((l) => `${l}; done after ${Date.now() - at.current} ms`); setShown(false); }} />
    </View>
    <Row><Button title="Show verified" variant="soft" small full={false} disabled={shown} onPress={() => { at.current = Date.now(); setLog(''); setShown(true); }} /></Row>
    <T v="micro" color={fx.ink.a50} testID="fx-verified-log">{log || 'Not shown yet'}</T>
  </>;
}

/** M21, M25, M27: an error that rises with a shake, codes that fill in sequence and clear. */
function Inputs() {
  const [email, setEmail] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [codeErr, setCodeErr] = useState(false);
  const otp = useRef<OtpBoxesHandle>(null);
  return <>
    <Field label="Email" title="Email address" error={err} hint="The address your coach writes to.">
      <Input value={email} onChangeText={(v) => { setEmail(v); setErr(null); }} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" />
    </Field>
    <Row><Button title="Check the email" variant="soft" small full={false} onPress={() => setErr(/.+@.+\..+/.test(email) ? null : 'Enter an email address such as name@example.com.')} /></Row>
    <OtpBoxes ref={otp} label="Gallery code" value={code} onChange={(v) => { setCode(v); setCodeErr(false); }} error={codeErr} />
    <Row>
      <Button title="Fill at once" variant="soft" small full={false} onPress={() => setCode('482913')} />
      <Button title="Wrong code" variant="soft" small full={false} onPress={() => setCodeErr(true)} />
      <Button title="Clear the code" variant="soft" small full={false} onPress={() => otp.current?.clear()} />
    </Row>
  </>;
}

/** M26: an empty state that waits until it is scrolled to; errors and notices that arrive at once. */
function States() {
  const ref = useAnimatedRef<Animated.ScrollView>();
  const y = useScrollOffset(ref);
  return <>
    <View style={styles.frame}>
      <Animated.ScrollView ref={ref} nestedScrollEnabled scrollEventThrottle={16} contentContainerStyle={styles.frameBody} testID="fx-empty-frame">
        <RevealScope scrollY={y}>
          <T v="bodySm" color={fx.ink.a60}>Scroll down: the empty state below enters when it crosses the reveal line.</T>
          <View style={styles.spacer} />
          <EmptyState icon="dumbbell" title="No sessions this week" body="Your coach is writing your plan. It appears here once it is published." action={{ title: 'Message your coach', onPress: () => undefined }} />
        </RevealScope>
      </Animated.ScrollView>
    </View>
    <ErrorState error={new ApiError(0, null)} onRetry={() => undefined} />
    <StaleBanner at={new Date(Date.now() - 2 * 3600_000).toISOString()} />
    <Notice kind="success" title="Saved">Your answers reached your coach.</Notice>
    <Notice kind="error" title="Refused">The server said no.</Notice>
    <Accordion title="Units" icon="ruler"><T v="bodySm">Weight in kilograms, height in centimetres. It closes faster than it opens.</T></Accordion>
  </>;
}

export function ControlsGallery(): React.JSX.Element | null {
  return <View style={styles.root} testID="fx-controls">
    <Part title="Controls · tabs and segments" note="The pill glides without overshoot and the labels follow it; a press slid off returns. The old panel leaves inert.">
      <Switching />
    </Part>
    <Part title="Controls · switch and stepper"><SwitchAndStepper /></Part>
    <Part title="Controls · press" note="Colours and scale answer on the first frame; selected states glide."><Presses /></Part>
    <Part title="Feedback · toasts"><Toasts /></Part>
    <Part title="Feedback · verified"><Verified /></Part>
    <Part title="Inputs · errors and codes"><Inputs /></Part>
    <Part title="States · empty, error and notices"><States /></Part>
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 24, paddingTop: 12, paddingBottom: 20 },
  part: { gap: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  gap: { gap: 12 },
  frame: { height: 360, borderRadius: fx.radius.card, overflow: 'hidden', borderWidth: 1, borderColor: fx.line.a05, backgroundColor: fx.bg.deep },
  frameBody: { padding: 16, gap: 12 },
  spacer: { height: 1000 }, // well past the reveal line (the window's height), so the state waits for the scroll
  verifiedFrame: { height: 220, borderRadius: fx.radius.card, overflow: 'hidden', borderWidth: 1, borderColor: fx.line.a05, backgroundColor: fx.bg.deep, alignItems: 'center', justifyContent: 'center' },
});
