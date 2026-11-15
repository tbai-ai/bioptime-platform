/* Inputs (THEME §11.7). A Field draws the uppercase label above (10/700, .2em, zinc-400), the input, and the hint or
   the error under it; its input takes the field's plain label as its accessibility label (E2E finds inputs by
   aria-label: the visible label is uppercase). Flow inputs: white/5 fill, white/10 border, radius 12, padding 16,
   Montserrat 16; the border turns red/60 on focus. `size="sheet"` is the sheet and search size (py 12, 14 pt, focus
   red-500/50). IconInput is the checkout row with a leading icon; SearchInput has the search glyph; NumberInput a mono
   value with its unit on the right. On the web no input draws the browser's focus ring (outline-style 'auto' paints
   it whatever the width): the border colour is the focus mark, as in the earlier app.
   Motion (v2): the focus border glides in over 200 ms and the error colours over t.stateMix (useStateMix; reduced
   motion: 150 ms crossfades). A new error rises 4 pt into place as it fades in (160 ms), and the input shakes
   (0, −6, 6, −4, 4, −2, 0 over 300 ms) with the error haptic; reduced motion keeps the haptic and the fades, without
   the shake or the rise. */
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withSequence, withTiming, type SharedValue } from 'react-native-reanimated';
import { fx } from '@/theme';
import { IconButton } from './Button';
import { haptics } from './device/haptics';
import { ease, motionValues, timing, useFx } from './effects';
import { Icon, type IconName } from './Icon';
import { calmFade } from './motion/tokens';
import { useStateMix } from './press';
import { T } from './Text';
import { fontFor } from './type';
import { WordMeasure } from './wordFit';

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);
/** Placeholder text (an example such as 'you@example.com'): white/50, about 5:1 on a field over black (ink4 was 2.3:1);
 *  still well below the typed text's white, so a hint never reads as a value. */
const PLACEHOLDER = fx.ink.a50;
/** How far a one-line input's text grows with the system text size (unless its caller sets its own cap). */
const ONE_LINE_MAX = 1.6;

/** The field's idle, error and (checkout row) focus colours: defined before the worklet that captures them. */
const IDLE_BORDER = fx.line.a10, ERROR_BORDER = fx.tone.errorLine, IDLE_BG = fx.fill.a05, ERROR_BG = fx.tone.errorBg;
const FOCUS_LITE = fx.tone.inputBorderFocusLite;

/** A field's border and fill from its focus and error mixes (0…1 each): idle → focus, then → error. A worklet. */
function fieldColors(focus: number, err: number, focusColor: string) {
  'worklet';
  const border = interpolateColor(err, [0, 1], [interpolateColor(focus, [0, 1], [IDLE_BORDER, focusColor]), ERROR_BORDER]);
  return { borderColor: border, backgroundColor: interpolateColor(err, [0, 1], [IDLE_BG, ERROR_BG]) };
}

/** The input shake and error haptic when an error appears (no shake under reduced motion; the haptic always). */
function useErrorShake(error: string | null | undefined): SharedValue<number> {
  const { calm } = useFx();
  const x = useSharedValue(0);
  const last = useRef(error || null);
  useEffect(() => {
    const now = error || null;
    if (now && now !== last.current) {
      haptics.error();
      if (!calm) {
        const f = motionValues.field;
        const step = f.shakeMs / (f.shake.length - 1);
        x.value = withSequence(...f.shake.slice(1).map((v) => withTiming(v, timing(step, ease.cssInOut))));
      }
    }
    last.current = now;
  }, [error, calm, x]);
  return x;
}

type FieldCtx = { label: string; error: boolean };
type InputNode = React.ComponentRef<typeof TextInput>;
const FieldContext = createContext<FieldCtx | null>(null);

/** `label` is the plain field name (the input's accessibility label); `title` the visible label when it differs
 *  ("Email" read aloud, "Email address" shown). */
export function Field({ label, title, hint, error, children, style }: { label: string; title?: string; hint?: string; error?: string | null; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const shake = useErrorShake(error);
  const moved = useAnimatedStyle(() => (shake.value === 0 ? { transform: [] } : { transform: [{ translateX: shake.value }] }));
  return <FieldContext.Provider value={{ label, error: !!error }}>
    <View style={[styles.field, style]}>
      <T v="label" accessible={false} importantForAccessibility="no">{title ?? label}</T>
      <Animated.View style={[styles.field, moved]}>{children}</Animated.View>
      {error ? <ErrorLine key={error} text={error} />
        : hint ? <T v="caption" color={fx.ink.a50}>{hint}</T> : null}
    </View>
  </FieldContext.Provider>;
}

/** The error under a field: rises 4 pt into place while it fades in (reduced motion: the fade only). */
function ErrorLine({ text }: { text: string }) {
  const { calm } = useFx();
  const m = motionValues.field;
  const p = useSharedValue(0);
  useEffect(() => { p.value = withTiming(1, calm ? calmFade() : timing(m.errorMs)); }, [calm, p, m.errorMs]);
  const a = useAnimatedStyle(() => (calm ? { opacity: p.value } : { opacity: p.value, transform: [{ translateY: -m.errorRise * (1 - p.value) }] }));
  return <Animated.View style={a}><T v="caption" color={fx.red.label} accessibilityLiveRegion="polite" accessibilityRole="alert">{text}</T></Animated.View>;
}

export type InputProps = TextInputProps & {
  /** Overrides the surrounding Field's label as the accessibility label. */
  label?: string;
  size?: 'flow' | 'sheet';
  error?: boolean;
  /** A show/hide eye for a password. */
  secureToggle?: boolean;
  /** Mono digits (codes, amounts). */
  mono?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
};

export function Input({ label, size = 'flow', error, secureToggle, mono, style, containerStyle, onFocus, onBlur, secureTextEntry, ...rest }: InputProps) {
  const ctx = useContext(FieldContext);
  const [focus, setFocus] = useState(false);
  const [hidden, setHidden] = useState(true);
  const bad = error ?? ctx?.error ?? false;
  const sheet = size === 'sheet';
  const focusColor = sheet ? fx.tone.focusSheet : fx.tone.focus;
  const f = useStateMix(focus, motionValues.field.focusMs);
  const e = useStateMix(bad);
  const colors = useAnimatedStyle(() => fieldColors(f.value, e.value, focusColor), [focusColor]);
  const input = <AnimatedTextInput
    accessibilityLabel={label ?? ctx?.label ?? rest.placeholder}
    placeholderTextColor={PLACEHOLDER}
    selectionColor={fx.red.brand}
    cursorColor={fx.red.brand}
    secureTextEntry={secureToggle ? hidden : secureTextEntry}
    onFocus={(e) => { setFocus(true); onFocus?.(e); }}
    onBlur={(e) => { setFocus(false); onBlur?.(e); }}
    // a one-line field's text (and its placeholder, the field's only instruction) grows with the system text size only
    // as far as it still fits a 320 dp field: 'you@example.com' and '000 000 0000' were cut at text 2.0 (INV-03)
    maxFontSizeMultiplier={rest.multiline ? undefined : ONE_LINE_MAX}
    {...rest}
    style={[
      styles.input,
      sheet ? styles.sheet : null,
      { fontFamily: mono ? fontFor('mono', 400) : fontFor('sans', 400) },
      secureToggle ? { paddingRight: 52 } : null,
      style,
      colors,
    ]}
  />;
  if (!secureToggle) return containerStyle ? <View style={containerStyle}>{input}</View> : input;
  return <View style={[styles.wrap, containerStyle]}>
    {input}
    <View style={styles.eye}>
      <IconButton icon={hidden ? 'eye' : 'eye-off'} label={hidden ? 'Show password' : 'Hide password'} size={32} iconSize={18} color={fx.ink.ink2} onPress={() => setHidden((h) => !h)} />
    </View>
  </View>;
}

/** The checkout input with a leading icon (15 pt, white/30); focus brightens the border to white/25. The text field
 *  fills the whole 48 pt row, so a tap anywhere on it (the icon too) puts the cursor in the field. */
export function IconInput({ icon, error, label, style, onFocus, onBlur, ref, ...rest }: TextInputProps & { icon: IconName; error?: string | null; label?: string; style?: StyleProp<ViewStyle>; ref?: React.Ref<InputNode> }) {
  const ctx = useContext(FieldContext);
  const [focus, setFocus] = useState(false);
  const own = useRef<InputNode | null>(null);
  const bad = !!error || !!ctx?.error;
  const f = useStateMix(focus, motionValues.field.focusMs);
  const e = useStateMix(bad);
  const colors = useAnimatedStyle(() => fieldColors(f.value, e.value, FOCUS_LITE));
  const setRef = (node: InputNode | null) => {
    own.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) (ref as React.RefObject<InputNode | null>).current = node;
  };
  return <View>
    <Animated.View style={[styles.iconRow, style, colors]}>
      <Pressable onPress={() => own.current?.focus()} accessible={false} tabIndex={-1} style={styles.iconHit}>
        <Icon name={icon} size={15} color={fx.ink.a30} />
      </Pressable>
      <TextInput
        ref={setRef}
        accessibilityLabel={label ?? ctx?.label ?? rest.placeholder}
        placeholderTextColor={PLACEHOLDER}
        selectionColor={fx.red.brand}
        cursorColor={fx.red.brand}
        onFocus={(e) => { setFocus(true); onFocus?.(e); }}
        onBlur={(e) => { setFocus(false); onBlur?.(e); }}
        maxFontSizeMultiplier={rest.multiline ? undefined : ONE_LINE_MAX}
        {...rest}
        style={[styles.iconText, rest.multiline ? styles.iconTextMulti : null]}
      />
    </Animated.View>
    {error ? <T v="micro" color={fx.red.label} style={styles.iconError} accessibilityRole="alert">{error}</T> : null}
  </View>;
}

/** Search (sheets, Fuel): the glyph at the left, sheet-size text. `shortPlaceholder`: the placeholder to show when the
 *  whole one does not fit the field on one line (a narrow phone, a large text size): measured as drawn, so the field's
 *  instruction is never cut inside a word ('Search dishes, cui…' at 320 dp and text 2.0: INV-03). */
export function SearchInput({ label = 'Search', style, shortPlaceholder, placeholder, ...rest }: InputProps & { shortPlaceholder?: string }) {
  const [box, setBox] = useState(0);
  const [whole, setWhole] = useState(0);
  const room = box - SEARCH_PAD_LEFT - SEARCH_PAD_RIGHT - 2;
  const shown = shortPlaceholder && whole > 0 && room > 0 && whole > room ? shortPlaceholder : placeholder;
  return <View style={styles.wrap} onLayout={shortPlaceholder ? (e) => { const w = Math.floor(e.nativeEvent.layout.width); setBox((o) => (o === w ? o : w)); } : undefined}>
    <Input label={label} size="sheet" returnKeyType="search" autoCapitalize="none" autoCorrect={false} placeholder={shown} {...rest} style={[{ paddingLeft: SEARCH_PAD_LEFT }, style]} />
    <View style={styles.searchIcon} pointerEvents="none"><Icon name="search" size={16} color={fx.ink.a40} /></View>
    {shortPlaceholder && placeholder ? <WordMeasure text={placeholder} v="body" style={SEARCH_TYPE} maxFontSizeMultiplier={ONE_LINE_MAX} whole onWord={(w) => setWhole((o) => (o === w.width ? o : w.width))} /> : null}
  </View>;
}

/** The search field's text: its paddings (the glyph at the left) and its type (the sheet size, Montserrat 400). */
const SEARCH_PAD_LEFT = 44, SEARCH_PAD_RIGHT = 16;
const SEARCH_TYPE = { fontSize: 14, fontFamily: fontFor('sans', 400) };

/** A number with its unit (mono value, 10 pt mono unit on the right). */
export function NumberInput({ unit, style, ...rest }: InputProps & { unit: string }) {
  return <View style={styles.wrap}>
    <Input size="sheet" keyboardType="decimal-pad" mono {...rest} style={[{ paddingRight: 48 }, style]} />
    <View style={styles.unit} pointerEvents="none"><T v="mono10" color={fx.ink.a50}>{unit}</T></View>
  </View>;
}

const styles = StyleSheet.create({
  field: { gap: 8 },
  // outlineStyle 'solid' at width 0: the web's default focus ring is outline-style 'auto', drawn at any width
  input: { borderWidth: 1, borderRadius: fx.radius.xl, paddingHorizontal: 16, paddingVertical: 16, fontSize: 16, color: fx.ink.white, minHeight: 52, outlineStyle: 'solid', outlineWidth: 0 },
  sheet: { paddingVertical: 12, fontSize: 14, minHeight: 44 },
  wrap: { position: 'relative', justifyContent: 'center' },
  eye: { position: 'absolute', right: 10, top: 0, bottom: 0, justifyContent: 'center' },
  iconRow: { flexDirection: 'row', alignItems: 'stretch', paddingRight: 16, borderRadius: fx.radius.xl, borderWidth: 1, minHeight: 48 },
  // the same 14 pt above and below as the text: centred in a one-line row, level with the first line when a caller
  // aligns a multi-line row to the top
  iconHit: { paddingLeft: 16, paddingRight: 12, paddingVertical: 14, justifyContent: 'center' },
  iconText: { flex: 1, alignSelf: 'stretch', minHeight: 46, color: fx.ink.white, fontSize: 14, fontFamily: fontFor('sans', 400), paddingHorizontal: 0, paddingVertical: 14, margin: 0, outlineStyle: 'solid', outlineWidth: 0 },
  iconTextMulti: { textAlignVertical: 'top' },
  iconError: { marginTop: 6, textTransform: 'none', letterSpacing: 0, fontSize: 10 },
  searchIcon: { position: 'absolute', left: 16, top: 0, bottom: 0, justifyContent: 'center' },
  unit: { position: 'absolute', right: 16, top: 0, bottom: 0, justifyContent: 'center' },
});
