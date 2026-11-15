/* Chips (THEME §11.5): FilterChip (Train categories: pill 12/500, active red/10 + red/30 border + red text),
   ColorTab (exercise guide tabs in their own colour), Tag (quiz lifestyle multi-select: solid red with a glow when on),
   SuggestionChip (red-outlined quick replies, 11 pt), DateChip (weekday / day / month column, selected red), and
   PhotoTag (the small dark tag on a photo). Every chip presses to .94 on the frame the finger lands and reports
   `selected`; selecting one glides its fill, border, text and glow over t.stateMix (useStateMix) instead of swapping
   them in one frame (reduced motion: a 150 ms crossfade). Every chip reaches 44 pt to touch (48 dp on Android; press
   touchSlopY on its minimum height): hitSlop on native; on the web the pressable is a touch box padded by the reach with
   a matching negative margin, and the chip's look is drawn by the view inside it, so rows keep their height. */
import React from 'react';
import { Platform, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { fx } from '@/theme';
import { haptics } from './device/haptics';
import { Icon, type IconName } from './Icon';
import { AnimatedPressable, PRESS_PROPS, pressTransform, touchSlopY, usePress, useStateMix } from './press';
import { T } from './Text';
import { fontFor, maxScaleFor, type, type TypeVariant } from './type';
import { motionValues } from './motion/tokens';

const WEB = Platform.OS === 'web';
const ANDROID = Platform.OS === 'android';
/** A chip's reach above and below (at least the earlier 8 pt on native) for its minimum height. */
const reach = (minH: number) => (WEB ? touchSlopY(minH) : Math.max(8, touchSlopY(minH)));
const slopFor = (minH: number) => (WEB ? undefined : { top: reach(minH), bottom: reach(minH), left: 4, right: 4 });

/** A row of 32 pt chips inside a horizontal scroll view: a scroll view takes no touch outside its bounds, so the
 *  chips' reach above and below must be inside it. Spread `scroller` into the ScrollView's style and `content` into its
 *  contentContainerStyle (the row keeps its height: the scroller is that much taller inside a negative margin). */
export const CHIP_ROW_TOUCH = { scroller: { marginVertical: -reach(32) }, content: { paddingVertical: reach(32) } } as const;

const AText = Animated.createAnimatedComponent(Text);
const webCap = (max: number) => (Platform.OS === 'web' ? ({ dataSet: { fsmax: String(max) } } as object) : null);

/** Text whose colour follows a 0…1 mix (idle → on) on the UI thread. */
export function MixText({ v, mix, idle, on, children, style, numberOfLines, ellipsizeMode }: { v: TypeVariant; mix: SharedValue<number>; idle: string; on: string; children: React.ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number; ellipsizeMode?: 'clip' | 'tail' }) {
  const a = useAnimatedStyle(() => ({ color: interpolateColor(mix.value, [0, 1], [idle, on]) }), [idle, on]);
  const max = maxScaleFor(v);
  return <AText {...webCap(max)} maxFontSizeMultiplier={max} numberOfLines={numberOfLines} ellipsizeMode={ellipsizeMode} style={[type[v], style, a]}>{children}</AText>;
}

/** Android measures a letter-spaced label (a one-line BoringLayout) a pixel narrower than the layout it draws it with
 *  needs, so the last letter broke onto a hidden second line: "SAFETY" drew as "SAFET" (L-02). A trailing hair space is
 *  measured with the label and hangs at the line's end when it is drawn (a space draws nothing), which gives the last
 *  letter that pixel. Not on the web or iOS. */
const SPACED_TAIL = ANDROID ? '\u200A' : '';
/** The words a ColorTab draws for `label` (also drawn by the exercise guide's first-frame stand-in, so the two match). */
export const colorTabLabel = (label: string): string => label.toUpperCase() + SPACED_TAIL;

/** A glyph whose colour follows a mix: the idle and on copies crossfade (an icon's stroke is not a style). */
export function MixIcon({ name, size, mix, idle, on, stroke }: { name: IconName; size: number; mix: SharedValue<number>; idle: string; on: string; stroke?: number }) {
  const a = useAnimatedStyle(() => ({ opacity: mix.value }));
  return <View style={{ width: size, height: size }}>
    <Icon name={name} size={size} color={idle} stroke={stroke} />
    <Animated.View style={[StyleSheet.absoluteFill, a]}><Icon name={name} size={size} color={on} stroke={stroke} /></Animated.View>
  </View>;
}

/** A chip's look: fill and border at rest and when selected, and the selected glow (a pre-rendered layer). */
type ChipLook = { bg: [string, string]; border: [string, string]; glow?: string; radius: number };

function ChipBase({ label, selected, mix, onPress, style, look, children, role = 'button', a11y, minH }: { label: string; selected?: boolean; mix: SharedValue<number>; onPress?: () => void; style: StyleProp<ViewStyle>; look?: ChipLook; children: React.ReactNode; role?: 'button' | 'tab' | 'checkbox'; a11y?: string;
  /** The chip's minimum visual height (its reach makes up the rest of the touch target). */
  minH: number }) {
  const press = usePress('chip');
  const { progress, to, calm } = press;
  const bg0 = look?.bg[0], bg1 = look?.bg[1], bd0 = look?.border[0], bd1 = look?.border[1];
  // the scale and the selected colours in one animated style
  const a = useAnimatedStyle(() => {
    const o: Record<string, unknown> = { transform: pressTransform(progress.value, to, 0, calm) };
    if (bg0 && bg1) o.backgroundColor = interpolateColor(mix.value, [0, 1], [bg0, bg1]);
    if (bd0 && bd1) o.borderColor = interpolateColor(mix.value, [0, 1], [bd0, bd1]);
    return o;
  }, [bg0, bg1, bd0, bd1, to, calm]);
  const glow = useAnimatedStyle(() => ({ opacity: mix.value }));
  const k = reach(minH);
  const glowLayer = look?.glow ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: look.radius, boxShadow: look.glow }, styles.glowLayer, glow]} /> : null;
  if (WEB && k > 0) {
    // the touch box: the chip's place in its row, k taller above and below; the chip is drawn inside it
    return <AnimatedPressable
      {...PRESS_PROPS}
      accessibilityRole={role}
      accessibilityLabel={a11y ?? label}
      accessibilityState={role === 'checkbox' ? { checked: !!selected } : { selected: !!selected }}
      {...(role === 'checkbox' ? { 'aria-checked': !!selected } : role === 'tab' ? { 'aria-selected': !!selected } : selected !== undefined ? { 'aria-pressed': selected } : null)}
      onPress={() => { haptics.select(); onPress?.(); }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={{ paddingVertical: k, marginVertical: -k }}>
      <Animated.View style={[style, a]}>
        {glowLayer}
        {children}
      </Animated.View>
    </AnimatedPressable>;
  }
  return <AnimatedPressable
    {...PRESS_PROPS}
    accessibilityRole={role}
    accessibilityLabel={a11y ?? label}
    accessibilityState={role === 'checkbox' ? { checked: !!selected } : { selected: !!selected }}
    {...(role === 'checkbox' ? { 'aria-checked': !!selected } : role === 'tab' ? { 'aria-selected': !!selected } : Platform.OS === 'web' && selected !== undefined ? { 'aria-pressed': selected } : null)}
    onPress={() => { haptics.select(); onPress?.(); }}
    onPressIn={press.onPressIn}
    onPressOut={press.onPressOut}
    hitSlop={slopFor(minH)}
    style={[style, a]}>
    {glowLayer}
    {children}
  </AnimatedPressable>;
}

/** The chip's selected mix (0…1), shared by its box, text and icons. */
function useChipMix(selected?: boolean) {
  return useStateMix(!!selected);
}

export function FilterChip({ label, selected, onPress, icon }: { label: string; selected?: boolean; onPress?: () => void; icon?: IconName }) {
  const mix = useChipMix(selected);
  return <ChipBase label={label} selected={selected} mix={mix} onPress={onPress} style={styles.filter} minH={styles.filter.minHeight}
    look={{ bg: [fx.fill.a05, fx.red.a10], border: [fx.line.a10, fx.red.a30], radius: fx.radius.pill }}>
    {icon ? <MixIcon name={icon} size={12} mix={mix} idle={fx.ink.white} on={fx.red.vivid} /> : null}
    <MixText v="chip" mix={mix} idle={fx.ink.white} on={fx.red.vivid}>{label}</MixText>
  </ChipBase>;
}

/** A tab in its own colour (exercise guide: purpose red, muscles gold, form blue, safety amber, recommendations green).
 *  Its one-word label is written in capitals (not textTransform, so the string measured is the string drawn), on one
 *  line that never wraps or ellipsizes, with the Android tail above (L-02). */
export function ColorTab({ label, color, selected, onPress, icon }: { label: string; color: string; selected?: boolean; onPress?: () => void; icon?: IconName }) {
  const mix = useChipMix(selected);
  return <ChipBase role="tab" label={label} selected={selected} mix={mix} onPress={onPress} style={styles.colorTab} minH={styles.colorTab.minHeight}
    look={{ bg: [fx.fill.a04, `${color}18`], border: [fx.line.a08, `${color}50`], radius: fx.radius.xl }}>
    {icon ? <MixIcon name={icon} size={12} mix={mix} idle={fx.ink.a60} on={color} /> : null}
    <MixText v="micro" mix={mix} idle={fx.ink.a60} on={color} numberOfLines={1} ellipsizeMode="clip" style={styles.colorTabText}>{colorTabLabel(label)}</MixText>
  </ChipBase>;
}

/** Multi-select tag (quiz lifestyle). */
export function Tag({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  const mix = useChipMix(selected);
  return <ChipBase role="checkbox" label={label} selected={selected} mix={mix} onPress={onPress} style={styles.tag} minH={styles.tag.minHeight}
    look={{ bg: [fx.fill.a05, fx.red.action], border: [fx.line.a10, fx.red.action], glow: fx.shadow.segment, radius: fx.radius.pill }}>
    <MixText v="section" mix={mix} idle={fx.ink.ink2} on={fx.ink.white}>{label}</MixText>
  </ChipBase>;
}

/** A suggested reply or quick message (red outline, 11 pt). */
export function SuggestionChip({ label, onPress }: { label: string; onPress?: () => void }) {
  const mix = useChipMix(false);
  return <ChipBase label={label} mix={mix} onPress={onPress} style={styles.suggestion} minH={styles.suggestion.minHeight}>
    <T v="caption" color={fx.red.label}>{label}</T>
  </ChipBase>;
}

/** A date to pick (booking): weekday 9, day 18 bold, month 9; selected is solid red. */
export function DateChip({ weekday, day, month, selected, onPress, label }: { weekday: string; day: string | number; month: string; selected?: boolean; onPress?: () => void; label: string }) {
  const mix = useChipMix(selected);
  return <ChipBase label={label} selected={selected} mix={mix} onPress={onPress} style={styles.date} minH={motionValues.touch.min}
    look={{ bg: [fx.fill.a05, fx.red.action], border: [fx.line.a10, fx.red.action], glow: fx.shadow.segment, radius: fx.radius.xl }}>
    <MixText v="micro" mix={mix} idle={fx.ink.a70} on={fx.ink.white}>{weekday}</MixText>
    <T v="mono14" color={fx.ink.white} style={styles.dateDay}>{String(day)}</T>
    <MixText v="micro" mix={mix} idle={fx.ink.a70} on={fx.ink.white}>{month}</MixText>
  </ChipBase>;
}

/** The small dark tag over a photo (test cards, duration badges). Not pressable. */
export function PhotoTag({ children, color = fx.ink.white, mono }: { children: React.ReactNode; color?: string; mono?: boolean }) {
  return <View style={styles.photoTag}><T v={mono ? 'mono10' : 'micro'} color={color}>{children}</T></View>;
}

const styles = StyleSheet.create({
  filter: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingVertical: 8, borderRadius: fx.radius.pill, borderWidth: 1, minHeight: 32 },
  colorTab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: fx.radius.xl, borderWidth: 1, minHeight: 32 },
  colorTabText: { fontSize: 10, letterSpacing: 0.5, textTransform: 'none' },
  tag: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: fx.radius.pill, borderWidth: 1, minHeight: 36, justifyContent: 'center' },
  suggestion: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: fx.radius.pill, borderWidth: 1, borderColor: fx.red.a25, backgroundColor: fx.red.a05, minHeight: 28, justifyContent: 'center' },
  date: { width: 56, paddingVertical: 10, borderRadius: fx.radius.xl, borderWidth: 1, alignItems: 'center', gap: 2 },
  dateDay: { fontSize: 18, lineHeight: 22, fontFamily: fontFor('mono', 700) },
  photoTag: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: fx.radius.md, backgroundColor: fx.glass.onPhoto, borderWidth: 1, borderColor: fx.line.a10, alignSelf: 'flex-start' },
  glowLayer: { backgroundColor: fx.premium.transparent },
});
