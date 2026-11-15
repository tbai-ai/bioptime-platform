/* The earlier app's chat composer, writing to the coach: the quick-message chips (red outline, horizontal; device-only
   starters that fill the composer and never send by themselves; hidden while a draft is written), then, over a
   hairline, the round input ("Write to Asha…", grows to five lines), the paperclip while the 'messaging' module is on
   (files added for the next message show as chips above the input, each removable), and the 44 pt send circle (red
   with its glow once there is something to send). On the web Enter sends and Shift+Enter starts a new line. While the
   input has focus the tab pager does not swipe (the tab bar itself hides with the keyboard).
   Motion (v2): the chips' row keeps its height at all times (reserved, so the thread above never moves for them):
   they fade out while a draft is written or a message is on its way and fade back in over 200 ms after it has landed;
   on Send the paper plane flicks up and to the right and comes back from below (M82); the send circle's red, its
   glow and its strength cross over 180 ms as it becomes ready. Reduced motion: colour only. */
import React, { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, TextInput, View, useWindowDimensions, type TextInputKeyPressEvent } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { AnimatedPressable, Icon, IconButton, Input, NoSwipeZone, SuggestionChip, ease, fx, timing, useFx, usePress, useSwipeLock } from '@/fx';
import { calmFade, motionValues, t } from '@/fx/motion/tokens';
import { PRESS_PROPS, pressTransform, useStateMix } from '@/fx/press';
import { FileChip } from './Thread';
import type { Attachment } from './files';
import { largeText } from '@/fx/layout';

const S = motionValues.screens.m77;
const S82 = motionValues.screens.m82;
/** The send circle's strength while there is nothing to send (the kit's disabled look). */
const IDLE_OPACITY = 0.3;

export const STARTERS = ['Can we move my session?', 'Question about my plan', 'I logged a workout', 'How did my report look?'];

/** The quick messages that fit where the member is (T6-36): a hello for a new thread, moving a session only while one is
 *  booked, the plan question or (before a plan) when it will be ready, a logged workout only with a plan and the
 *  workouts module, and the report question only once a report has been released. */
export function startersFor(s: { newHere: boolean; session: boolean; plan: boolean; workouts: boolean; report: boolean }): string[] {
  const out: string[] = [];
  if (s.newHere) out.push('Hello, I’ve just joined');
  if (s.session) out.push(STARTERS[0]);
  out.push(s.plan ? STARTERS[1] : 'When will my plan be ready?');
  if (s.plan && s.workouts) out.push(STARTERS[2]);
  if (s.report) out.push(STARTERS[3]);
  return out;
}

export type PendingFile = Attachment & { uploading?: boolean };

/** The quick-message chips. The row is always laid out (its height stays reserved), so the thread above never moves
 *  when the chips go or come back: `shown` fades them in over S.m77.chipsFadeMs and out over t.swapOut (tier C both
 *  ways over S.m77.cMs; reduced motion through calmFade; the pre-rendered HTML at rest). Hidden, the row is inert: no
 *  touches, and hidden from assistive technology. */
export function QuickChips({ onPick, items = STARTERS, shown = true }: { onPick: (text: string) => void; items?: string[]; shown?: boolean }) {
  const { calm, inHtml, tier } = useFx();
  const p = useSharedValue(shown ? 1 : 0);
  useEffect(() => {
    const to = shown ? 1 : 0;
    if (inHtml) { p.value = to; return; }
    const ms = tier === 'C' ? S.cMs : shown ? S.chipsFadeMs : t.swapOut;
    p.value = withTiming(to, calm ? calmFade() : timing(ms, ease.css));
  }, [shown, calm, inHtml, tier, p]);
  const a = useAnimatedStyle(() => ({ opacity: p.value }));
  return <Animated.View
    style={a}
    pointerEvents={shown ? 'auto' : 'none'}
    accessibilityElementsHidden={!shown}
    importantForAccessibility={shown ? 'auto' : 'no-hide-descendants'}
    aria-hidden={!shown}>
    <NoSwipeZone>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.chips} accessibilityLabel="Quick messages">
        {items.map((s) => <SuggestionChip key={s} label={s} onPress={() => onPick(s)} />)}
      </ScrollView>
    </NoSwipeZone>
  </Animated.View>;
}

export function Composer({ value, onChange, onSend, canSend, placeholder, label, filesOn, onAttach, pending, onRemove, inputRef, onFocusChange, maxLength = 4000 }: {
  value: string; onChange: (v: string) => void; onSend: () => void; canSend: boolean; placeholder: string; label: string;
  filesOn: boolean; onAttach?: () => void; pending: PendingFile[]; onRemove?: (a: PendingFile) => void;
  inputRef?: React.RefObject<React.ComponentRef<typeof TextInput> | null>; onFocusChange?: (focused: boolean) => void; maxLength?: number;
}) {
  const [focused, setFocused] = useState(false);
  const [height, setHeight] = useState(46);
  // the empty field is one line tall: on a narrow phone or at a large text size a short placeholder fits it whole ('Write
  // to' over half of 'Asha…', SWB-14); the field's label still names who it goes to
  const { width, fontScale } = useWindowDimensions();
  const hint = largeText(fontScale) || width < 360 ? 'Message…' : placeholder;
  const { calm } = useFx();
  useSwipeLock('coach-composer', focused);
  useEffect(() => { if (!value) setHeight(46); }, [value]);
  // the paper plane's flick on Send: out up and to the right (ease.exit), back in from below (expo); on the UI thread
  const px = useSharedValue(0);
  const py = useSharedValue(0);
  const po = useSharedValue(1);
  const send = () => {
    if (!calm) {
      const out = timing(S82.planeOutMs, ease.exit);
      const back = timing(S82.planeInMs, ease.expo);
      px.value = withSequence(withTiming(S82.planeX, out), withTiming(0, { duration: 0 }));
      py.value = withSequence(withTiming(S82.planeY, out), withTiming(S82.planeInY, { duration: 0 }), withTiming(0, back));
      po.value = withSequence(withTiming(0, out), withTiming(1, back));
    }
    // the input goes back to one line in the same commit as the cleared draft and the new bubble (not a frame later
    // from the effect below), so the thread's end is pinned once, with the composer already at its new height
    setHeight(46);
    onSend();
  };
  const plane = useAnimatedStyle(() => ({ opacity: po.value, transform: [{ translateX: px.value }, { translateY: py.value }] }));
  const onKey = (e: TextInputKeyPressEvent) => {
    if (Platform.OS !== 'web') return;
    const ev = e.nativeEvent as { key: string; shiftKey?: boolean; isComposing?: boolean };
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { (e as unknown as { preventDefault?: () => void }).preventDefault?.(); if (canSend) send(); }
  };
  return <View style={styles.wrap}>
    {pending.length ? <NoSwipeZone>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pending} keyboardShouldPersistTaps="handled">
        {pending.map((a) => <FileChip key={a.id} a={a} busy={a.uploading} onRemove={a.uploading || !onRemove ? undefined : () => onRemove(a)} />)}
      </ScrollView>
    </NoSwipeZone> : null}
    <View style={styles.row}>
      {filesOn && onAttach ? <IconButton icon="paperclip" label="Add a file" onPress={onAttach} size={40} iconSize={18} color={fx.ink.a70} /> : null}
      <Input
        // React 19 passes `ref` as a prop: Input hands it to its TextInput with the rest
        {...({ ref: inputRef } as object)}
        label={label}
        size="sheet"
        value={value}
        onChangeText={onChange}
        placeholder={hint}
        multiline
        maxLength={maxLength}
        onKeyPress={onKey}
        onFocus={() => { setFocused(true); onFocusChange?.(true); }}
        onBlur={() => { setFocused(false); onFocusChange?.(false); }}
        onContentSizeChange={(e) => setHeight(Math.max(46, Math.min(124, Math.ceil(e.nativeEvent.contentSize.height) + 2)))}
        containerStyle={styles.inputBox}
        style={[styles.input, { height }]}
      />
      <SendButton ready={canSend} onPress={send} plane={plane} />
    </View>
  </View>;
}

/** The 44 pt send circle (the kit's send look): white/5 with a hairline while there is nothing to send, red with its
 *  glow once there is; the change crosses over t.stateMix (a pre-rendered glow layer's opacity, never the shadow). */
function SendButton({ ready, onPress, plane }: { ready: boolean; onPress: () => void; plane: ReturnType<typeof useAnimatedStyle> }) {
  const press = usePress('send');
  const mix = useStateMix(ready);
  const { progress, to, calm } = press;
  const disc = useAnimatedStyle(() => ({
    opacity: IDLE_OPACITY + (1 - IDLE_OPACITY) * mix.value,
    backgroundColor: interpolateColor(mix.value, [0, 1], [fx.fill.a05, fx.red.vivid]),
    borderColor: interpolateColor(mix.value, [0, 1], [fx.line.a10, fx.red.vivid]),
    transform: pressTransform(progress.value, to, 0, calm),
  }));
  const glow = useAnimatedStyle(() => ({ opacity: mix.value }));
  return <AnimatedPressable
    {...PRESS_PROPS}
    accessibilityRole="button"
    accessibilityLabel="Send"
    accessibilityState={{ disabled: !ready }}
    disabled={!ready}
    onPress={onPress}
    onPressIn={press.onPressIn}
    onPressOut={press.onPressOut}
    style={[styles.send, disc]}>
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.sendGlow, glow]} />
    <Animated.View style={plane}><Icon name="send" size={18} color={fx.ink.white} stroke={2} /></Animated.View>
  </AnimatedPressable>;
}

const styles = StyleSheet.create({
  send: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  sendGlow: { borderRadius: 22, boxShadow: fx.shadow.fab, backgroundColor: fx.premium.transparent },
  chips: { gap: 8, paddingHorizontal: 20, paddingVertical: 10 },
  wrap: { borderTopWidth: 1, borderTopColor: fx.line.a05, backgroundColor: fx.glass.composer, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, gap: 8 },
  pending: { gap: 8, paddingRight: 8 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  inputBox: { flex: 1 },
  // outlineStyle solid (width 0): the web's focus ring is 'auto' otherwise, drawn whatever the width (the red border shows focus)
  input: { borderRadius: 23, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, fontSize: 15, lineHeight: 20, minHeight: 46, textAlignVertical: 'center', outlineStyle: 'solid', outlineWidth: 0 },
});
