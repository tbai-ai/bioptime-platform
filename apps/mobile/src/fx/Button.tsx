/* Buttons, exactly as the earlier app drew them (THEME §11.3), with the premium press (PREMIUM §1.5): the primary red scales
   to .97 in 90 ms, darkens to #D42C1E, its glow grows and it settles 1 pt lower; a soft top light sits inside the fill.
   The title is the accessibility label (E2E clicks buttons by their text). `busy` swaps the label for a 16 pt ring and
   keeps the width. Variants:
   - primary: red flow CTA, radius 12 (`shape="auth"`) or 16 (`shape="flow"`), Montserrat 16/700, optional 18 pt icon
   - white: white pill, black 16/500 with an arrow (onboarding Next, welcome)
   - whiteBlock: white block radius 12 (Book a blood test)
   - ghost: outline pill (onboarding Back)
   - soft: white/5 block with a hairline (View details, Continue with Google)
   - redTint: red/10 pill (Browse meals)
   - redGlass: the danger button (Sign out)
   - solidSm: small solid red (coach tools, player)
   - link: red text link with a chevron (See all); laid out 24 pt high as before, but 44 pt to touch (10 pt more above
     and below: hitSlop on native, padding with a matching negative margin on the web, so rows do not grow)
   - back: chevron and "Back" in zinc-400
   `color` paints the primary in a programme colour (Store). IconButton covers the round icon controls: round (28–36),
   glass (on photos), stepper (64, minus or plus), fab (56 or 80 play), send (44); each keeps a 44 pt touch area
   (48 dp on Android, Material's minimum) around a smaller visual. Over a hero a photo flies into (PhotoMorph
   MorphChromeContext) it fades in after the landing, and inside the flying copy it is not drawn at all.
   Enabled ↔ disabled glides (useStateMix over t.stateMix): the fill, the border, the label's colour, the icons, the
   rest glow and the primary's top light all follow one 0…1 mix, so a CTA that turns on never changes in one frame.
   The animated style returns its fill and border on every frame (the web keeps a key a style stops returning).
   `iconPulse`: each change pops the trailing icon 1 → screens.m58.flamePeak → 1 (spring.pop; none under reduced motion). */
import React, { useEffect, useRef, useState } from 'react';
import { PixelRatio, Platform, StyleSheet, Text, View, useWindowDimensions, type GestureResponderEvent, type LayoutChangeEvent, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, Easing, interpolateColor, useAnimatedReaction, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { fx } from '@/theme';
import { haptics } from './device/haptics';
import { ease, motionValues, spring, t, timing, useFx } from './effects';
import { Scrim } from './Gradient';
import { Icon, type IconName } from './Icon';
import { useMorphChrome, useMorphCopy } from './motion/PhotoMorph';
import { usePageActive } from './nav/pageReady';
import { AnimatedPressable, PRESS_PROPS, pressTransform, usePress, useStateMix, type PressKind } from './press';
import { maxScaleFor, type as typeScale } from './type';
import { WORD_KEEP, WordMeasure, type DrawnWord } from './wordFit';
import { largeText } from './layout';

const AnimatedText = Animated.createAnimatedComponent(Text);

export type ButtonVariant = 'primary' | 'white' | 'whiteBlock' | 'ghost' | 'soft' | 'redTint' | 'redGlass' | 'solidSm' | 'link' | 'back';

export type ButtonProps = {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  /** Primary radius: auth 12 (default), flow 16 (quiz, consent, checkout). */
  shape?: 'auth' | 'flow';
  /** Icon before the title (18 pt on primary). */
  icon?: IconName;
  /** Icon after the title; the white pill shows an arrow unless `iconRight={null}`. */
  iconRight?: IconName | null;
  busy?: boolean;
  disabled?: boolean;
  /** A smaller primary (py 12, 14/600). */
  small?: boolean;
  /** Stretch to the row's width (primary, whiteBlock, soft and redGlass do by default). */
  full?: boolean;
  /** Programme colour for a primary CTA. */
  color?: string;
  /** The primary's label and icon colour on a light programme colour (default fx.ink.white); the disabled look keeps
   *  its own grey. Store's Buy passes fx.bg.deep on the gold and light-blue programmes (4.5:1 or more). */
  labelColor?: string;
  /** A light haptic on press-in: commit CTAs only (sign in, log, book, buy, agree, send). */
  commit?: boolean;
  label?: string;
  hint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /** Each change pops the trailing icon once (a form becoming valid: the quiz's 'Send my answers' flame, M58). */
  iconPulse?: number;
  /** One line at every text size: the label shrinks to fit the button (to 0.7 of its size at most) instead of
   *  wrapping. For a long label in a narrow box at a large system text size (the preview card's "Continue without
   *  signing in", release C13). */
  fit?: boolean;
};

const BLOCK: ButtonVariant[] = ['primary', 'whiteBlock', 'soft', 'redGlass'];
/** The link's touch box: 10 pt above and below its 24 pt line (44 in all), 8 at the sides. */
const LINK_SLOP = { top: 10, bottom: 10, left: 8, right: 8 };

export function Button({ title, onPress, variant = 'primary', shape = 'auth', icon, iconRight, busy, disabled, small, full, color, labelColor: ink, commit, label, hint, style, testID, iconPulse, fit: oneLine }: ButtonProps) {
  const press = usePress(variant === 'white' ? 'card' : variant === 'link' || variant === 'back' ? 'chip' : 'cta', variant === 'primary' ? 1 : 0);
  const off = !!disabled;
  const red = color ?? fx.red.brand;
  const sh = { pressed: press.pressed, red, ink, small: !!small, shape };
  const look = looks(variant, { off, ...sh });
  // both ends of the enabled mix: the fill, border, label, icons and glow glide between them (one frame never switches)
  const onLook = off ? looks(variant, { off: false, ...sh }) : look;
  const offLook = off ? look : looks(variant, { off: true, ...sh });
  const en = useStateMix(!off, t.stateMix);
  const stretch = full ?? BLOCK.includes(variant);
  const right = iconRight === null ? null : iconRight ?? (variant === 'white' ? 'arrow-right' : variant === 'link' ? 'chevron-right' : undefined);
  const left = variant === 'back' ? 'chevron-left' : icon;
  // the link's 44 pt touch box, unless the caller already gave it a 44 pt box of its own
  const ownBox = variant === 'link' && Number(StyleSheet.flatten(style)?.minHeight ?? 0) >= 44;
  const linkTouch = variant === 'link' && !ownBox;
  const iconSize = variant === 'primary' || variant === 'white' ? 18 : variant === 'back' ? 18 : 14;
  // the pressed colours ride the press progress on the UI thread, with the scale (never React state); the enabled mix
  // takes the fill and border from the disabled look's to the enabled look's
  const mix = onLook.mix;
  const bgFrom = mix?.bg?.[0], bgTo = mix?.bg?.[1], bdFrom = mix?.border?.[0], bdTo = mix?.border?.[1];
  const onBg = colorOf(onLook.box.backgroundColor), offBg = colorOf(offLook.box.backgroundColor);
  const onBd = colorOf(onLook.box.borderColor), offBd = colorOf(offLook.box.borderColor);
  const { progress, to, calm } = press;
  const sink = variant === 'primary' ? 1 : 0;
  const animated = useAnimatedStyle(() => {
    const p = progress.value;
    const e = en.value;
    const o: Record<string, unknown> = { transform: pressTransform(p, to, sink, calm) };
    const bgOn = bgFrom && bgTo ? interpolateColor(p, [0, 1], [bgFrom, bgTo]) : onBg;
    const bdOn = bdFrom && bdTo ? interpolateColor(p, [0, 1], [bdFrom, bdTo]) : onBd;
    const bg = bgOn && offBg && bgOn !== offBg ? (e >= 1 ? bgOn : e <= 0 ? offBg : interpolateColor(e, [0, 1], [offBg, bgOn])) : bgOn ?? offBg;
    const bd = bdOn && offBd && bdOn !== offBd ? (e >= 1 ? bdOn : e <= 0 ? offBd : interpolateColor(e, [0, 1], [offBd, bdOn])) : bdOn ?? offBd;
    if (bg) o.backgroundColor = bg;
    if (bd) o.borderColor = bd;
    return o;
  }, [bgFrom, bgTo, bdFrom, bdTo, onBg, offBg, onBd, offBd, to, sink, calm]);
  const radius = Number(look.box.borderRadius ?? 0);
  const fgOn = onLook.fg, fgOff = offLook.fg;
  // a button that is given `disabled` (it can turn on and off) crossfades its label and icons; others draw one copy
  const fades = disabled !== undefined && fgOn !== fgOff;
  // the label's colour on the same mix (an animated Text with the kit's type scale and its large-text cap)
  const labelColor = useAnimatedStyle(() => ({ color: !fades ? (en.value >= 0.5 ? fgOn : fgOff) : en.value >= 1 ? fgOn : en.value <= 0 ? fgOff : interpolateColor(en.value, [0, 1], [fgOff, fgOn]) }), [fades, fgOn, fgOff]);
  // the enabled look's icons, glow and top light fade in with the mix (a disabled primary has no glow or light)
  const iconOn = useAnimatedStyle(() => ({ opacity: en.value }));
  // iconPulse: each change pops the trailing icon once
  const pulse = useSharedValue(1);
  const pulseSeen = useRef(iconPulse);
  useEffect(() => {
    if (iconPulse === pulseSeen.current) return;
    pulseSeen.current = iconPulse;
    if (calm) return;
    cancelAnimation(pulse);
    pulse.value = withSequence(withTiming(motionValues.screens.m58.flamePeak, timing(t.press, ease.expo)), withSpring(1, spring.pop));
  }, [iconPulse, calm, pulse]);
  const pulseStyle = useAnimatedStyle(() => (pulse.value === 1 ? { transform: [] } : { transform: [{ scale: pulse.value }] }));
  const maxScale = maxScaleFor(look.text);
  const glyph = (name: IconName, pulsed: boolean) => {
    const g = fades
      ? <View style={styles.iconBox}>
        <Icon name={name} size={iconSize} color={fgOff} />
        <Animated.View style={[StyleSheet.absoluteFill, iconOn]}><Icon name={name} size={iconSize} color={fgOn} /></Animated.View>
      </View>
      : <Icon name={name} size={iconSize} color={look.fg} />;
    return pulsed ? <Animated.View style={pulseStyle}>{g}</Animated.View> : g;
  };
  // the label's room: the button's own width (never more than its row allows) less its padding and its icons (its
  // exact width: a whole-dp floor left a hugging link's cap under its label's width, so 'All goals' lost 'goals')
  const { width: winW, fontScale } = useWindowDimensions();
  const [boxW, setBoxW] = useState(0);
  const flat = StyleSheet.flatten([look.box, style]) as ViewStyle;
  const room = boxW > 0 ? boxW - padX(flat) - (left ? iconSize + 10 : 0) - (right ? iconSize + 10 : 0) : 0;
  // (a button that hugs its label has exactly the label's width as its room: the cap keeps the two pixels on top)
  const fit = useTitleFit(title, room > 0 ? room + 2 / PixelRatio.get() : 0);
  // SWB-18: a word wider than the label's room shrinks the label (to 0.7 at most) until it fits whole, as FitText
  // does ('Recommendat/ions'); measured once per title, window and text size (a button that hugs its label narrows
  // with the shrink, so it is never measured again from its own shrunk width)
  const [word, setWord] = useState<DrawnWord | null>(null);
  const [shrunk, setShrunk] = useState<{ key: string; fit: number } | null>(null);
  const fitKey = `${title}|${word?.width ?? 0}|${winW}|${fontScale}`;
  const kept = !oneLine && shrunk && shrunk.key === fitKey ? shrunk.fit : 1;
  // (only a word clearly wider than the room: a button that hugs its one-word label has that word's width as its room)
  if (!oneLine && word && room > 0 && word.width * kept > room + 1) {
    const f = Math.max(0.7, Math.floor(((room - WORD_KEEP) / word.width) * (Platform.OS === 'android' ? 0.98 : 1) * 100) / 100);
    if (f < kept) setShrunk({ key: fitKey, fit: f });
  }
  const tType = typeScale[look.text] as TextStyle;
  const tSize = word?.fontSize ?? tType.fontSize ?? 14, tLine = word?.lineHeight ?? tType.lineHeight;
  const shrink = kept < 1 ? { fontSize: tSize * kept, lineHeight: tLine != null ? tLine * kept : undefined, letterSpacing: tType.letterSpacing != null ? tType.letterSpacing * kept : undefined } : null;
  const content = <View style={[styles.row, busy ? styles.hidden : null]}>
    {left ? glyph(left, false) : null}
    <AnimatedText
      {...(oneLine ? null : fit.props)}
      // a long label at a large text size takes a third line rather than ending in an ellipsis
      numberOfLines={oneLine ? 1 : largeText(fontScale) ? 3 : 2}
      adjustsFontSizeToFit={oneLine}
      minimumFontScale={oneLine ? 0.7 : undefined}
      maxFontSizeMultiplier={maxScale}
      {...(Platform.OS === 'web' ? { dataSet: oneLine ? { fsmax: String(maxScale), fit: '0.7' } : { fsmax: String(maxScale) } } as object : null)}
      style={[tType, { color: look.fg }, styles.title, shrink, oneLine ? null : fit.style, labelColor]}>{title}</AnimatedText>
    {right ? glyph(right, iconPulse !== undefined) : null}
    {oneLine ? null : <WordMeasure text={title} v={look.text} maxFontSizeMultiplier={maxScale} onWord={(w) => setWord((o) => (o && o.width === w.width && o.fontSize === w.fontSize && o.lineHeight === w.lineHeight ? o : w))} />}
  </View>;

  return <AnimatedPressable
    {...PRESS_PROPS}
    testID={testID}
    accessibilityRole={variant === 'link' || variant === 'back' ? 'link' : 'button'}
    accessibilityLabel={label ?? title}
    accessibilityHint={hint}
    accessibilityState={{ disabled: off, busy: !!busy }}
    disabled={off || busy}
    // a commit CTA's haptic on release (a press that turned into a scroll never gets one)
    onPress={onPress || commit ? () => { if (commit) haptics.commit(); onPress?.(); } : undefined}
    onPressIn={press.onPressIn}
    onPressOut={press.onPressOut}
    hitSlop={linkTouch && Platform.OS !== 'web' ? LINK_SLOP : undefined}
    onLayout={oneLine ? undefined : (e: LayoutChangeEvent) => { const w = e.nativeEvent.layout.width; setBoxW((o) => (Math.abs(o - w) < 0.01 ? o : w)); }}
    style={[look.box, linkTouch && Platform.OS === 'web' ? styles.linkTouch : null, stretch ? styles.full : styles.hug, style, animated]}>
    {mix?.glow ? <Glow shadow={mix.glow[0]} radius={radius} progress={progress} rest on={en} /> : null}
    {mix?.glow?.[1] ? <Glow shadow={mix.glow[1]} radius={radius} progress={progress} /> : null}
    {variant === 'primary' ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius }, styles.clip, iconOn]}><Scrim kind="buttonLight" style={styles.light} /></Animated.View> : null}
    {content}
    {busy ? <View style={styles.busy}><RingSpinner color={look.fg === fx.ink.white ? fx.ink.white : ink && look.fg === ink ? ink : fx.red.brand} track={look.fg === fx.ink.white ? fx.ink.a30 : ink && look.fg === ink ? fx.glass.note : fx.red.a30} /></View> : null}
  </AnimatedPressable>;
}

/** Android: a title laid out at its box's whole-pixel width could come out a hair under the width it measured, so its
 *  last word wrapped into a line the box had no height for ('View details' drawn as 'View', at 320 dpi; the laid-out
 *  lines report one line, so it cannot be told apart). Once a title has laid out, it gets two physical pixels more
 *  room than it measured (once per title; the centred label moves by a pixel at most), never more than `cap` (the
 *  room its button has: a link first laid out wider than its row kept a width above the row's and overflowed both
 *  sides of it, F1-m2). Elsewhere nothing. */
export function useTitleFit(title: string, cap = 0): { props: object | null; style: { minWidth: number } | null } {
  const [fitted, setFitted] = useState<{ title: string; minWidth: number } | null>(null);
  const done = useRef<string | null>(null);
  const kept = fitted && fitted.title === title ? fitted.minWidth : 0;
  const minWidth = kept && cap > 0 ? Math.min(kept, cap) : kept;
  if (Platform.OS !== 'android') return { props: null, style: null };
  return {
    props: {
      onLayout: (e: LayoutChangeEvent) => {
        const w = e.nativeEvent.layout.width;
        if (done.current === title || !(w > 0)) return;
        done.current = title;
        setFitted({ title, minWidth: w + 2 / PixelRatio.get() });
      },
    },
    style: minWidth ? { minWidth } : null,
  };
}

/** A box's left and right padding and border (the label's room is the box's width less them). */
function padX(b: ViewStyle): number {
  const n = (v: unknown) => (typeof v === 'number' ? v : 0);
  const ph = b.paddingHorizontal ?? b.padding, bw = b.borderWidth;
  return n(b.paddingLeft ?? b.paddingStart ?? ph) + n(b.paddingRight ?? b.paddingEnd ?? ph) + n(b.borderLeftWidth ?? bw) + n(b.borderRightWidth ?? bw);
}

/** A pre-rendered glow (a box shadow on a transparent layer the button's shape) whose opacity follows the press:
 *  `rest` shows at rest and fades as the press goes in; otherwise it shows only while pressed. The shadow itself
 *  never animates. `on`: the enabled mix (the rest glow fades with it as a CTA turns on or off). */
function Glow({ shadow, radius, progress, rest, on }: { shadow?: string; radius: number; progress: SharedValue<number>; rest?: boolean; on?: SharedValue<number> }) {
  const a = useAnimatedStyle(() => {
    const p = Math.max(0, Math.min(1, progress.value));
    const e = on ? Math.max(0, Math.min(1, on.value)) : 1;
    return { opacity: rest ? (1 - p) * e : p };
  }, [rest, on]);
  if (!shadow) return null;
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, boxShadow: shadow }, styles.glow, a]} />;
}

/** A variant's look at rest, and what its press changes: the fill and border (rest → pressed) and the glow layers
 *  (rest shadow, pressed shadow), interpolated from the press progress. */
type Look = {
  box: ViewStyle; fg: string; text: 'button' | 'buttonSm' | 'chip' | 'section' | 'cardTitle';
  mix?: { bg?: [string, string]; border?: [string, string]; glow?: [string | undefined, string | undefined] };
};

function looks(v: ButtonVariant, s: { off: boolean; pressed: boolean; red: string; ink?: string; small: boolean; shape: 'auth' | 'flow' }): Look {
  switch (v) {
    case 'primary': {
      const box = base(s.shape === 'flow' ? 16 : 12, s.small ? 12 : 16);
      // disabled: a quiet grey that still reads (ink3, about 3.8:1 on the dimmed block; ink4 was 2.4:1)
      if (s.off) return { box: { ...box, backgroundColor: fx.fill.a05 }, fg: fx.ink.ink3, text: s.small ? 'buttonSm' : 'button' };
      // the brand primary fills with the brand book's action red under its white label (5.0:1, AA; pressed 6.0:1), its
      // glow stays the brand red (T3-03); a programme colour fills as given (its label colour is the caller's)
      const brand = s.red === fx.red.brand;
      const fill = brand ? fx.red.action : s.red;
      return {
        box: { ...box, backgroundColor: fill },
        fg: s.ink ?? fx.ink.white, text: s.small ? 'buttonSm' : 'button',
        mix: { bg: brand ? [fill, fx.red.actionPressed] : undefined, glow: brand ? [s.shape === 'flow' ? fx.shadow.cta : fx.shadow.ctaAuth, fx.shadow.ctaPressed] : undefined },
      };
    }
    case 'white':
      return { box: { ...base(fx.radius.pill, 16), paddingHorizontal: 24, backgroundColor: s.off ? fx.fill.a10 : fx.ink.white }, fg: s.off ? fx.ink.a30 : fx.bg.deep, text: 'cardTitle',
        mix: s.off ? undefined : { glow: [fx.shadow.white, fx.shadow.whitePressed] } };
    case 'whiteBlock':
      return { box: { ...base(12, 14), backgroundColor: s.off ? fx.fill.a10 : fx.ink.white }, fg: s.off ? fx.ink.a30 : fx.bg.deep, text: 'cardTitle',
        mix: { glow: [undefined, fx.shadow.whitePressed] } };
    case 'ghost':
      return { box: { ...base(fx.radius.pill, 16), paddingHorizontal: 24, borderWidth: 1, borderColor: fx.line.a10, backgroundColor: fx.premium.transparent }, fg: s.off ? fx.ink.a30 : fx.ink.white, text: 'section',
        mix: { bg: [fx.premium.transparent, fx.fill.a10] } };
    case 'soft':
      return { box: { ...base(12, 12), borderWidth: 1, borderColor: fx.line.a10, backgroundColor: fx.fill.a05 }, fg: s.off ? fx.ink.a30 : fx.ink.white, text: 'section',
        mix: { bg: [fx.fill.a05, fx.fill.a10] } };
    case 'redTint':
      return { box: { ...base(fx.radius.pill, 8), paddingHorizontal: 16, borderWidth: 1, borderColor: fx.red.a30, backgroundColor: fx.red.a10 }, fg: fx.red.vivid, text: 'section',
        mix: { bg: [fx.red.a10, fx.red.a20] } };
    case 'redGlass':
      return { box: { ...base(12, 16), borderWidth: 1, borderColor: fx.red.a30, backgroundColor: fx.bg.panelSolid }, fg: fx.red.vivid, text: 'buttonSm',
        mix: { bg: [fx.bg.panelSolid, fx.red.a10], border: [fx.red.a30, fx.red.a50], glow: [fx.shadow.signOut, fx.shadow.segment] } };
    case 'solidSm':
      return { box: { ...base(12, 11), paddingHorizontal: 16, backgroundColor: s.off ? fx.fill.a05 : fx.red.fill }, fg: s.off ? fx.ink.ink3 : fx.ink.white, text: 'buttonSm',
        mix: s.off ? undefined : { bg: [fx.red.fill, fx.red.vivid] } };
    case 'link':
      return { box: { paddingVertical: 6, minHeight: 24, justifyContent: 'center' }, fg: s.pressed ? fx.red.label : fx.red.vivid, text: 'chip' };
    case 'back':
      return { box: { paddingVertical: 10, minHeight: 44, justifyContent: 'center' }, fg: s.pressed ? fx.ink.white : fx.ink.ink2, text: 'section' };
  }
}

/** A look's colour value as a string (a style colour can be a number on native; the looks only use strings). */
function colorOf(v: ViewStyle['backgroundColor']): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function base(radius: number, py: number): ViewStyle {
  return { borderRadius: radius, paddingVertical: py, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', minHeight: 44 };
}

/** The earlier app's inline spinner: a 16 pt ring, border 2, with a brighter top segment, one turn a second. It spins at
 *  every tier (tier C included) while its page is active (paused on a page nobody sees); under reduced motion it is a
 *  static ring on every platform. */
export function RingSpinner({ size = 16, color = fx.red.brand, track = fx.red.a30, label }: { size?: number; color?: string; track?: string; label?: string }) {
  const { calm } = useFx();
  const active = usePageActive();
  const r = useSharedValue(0);
  const turn = t.spinner;
  useAnimatedReaction(() => (calm ? 0 : active.value), (on, was) => {
    if (on === was) return;
    if (on === 1) { r.value = 0; r.value = withRepeat(withTiming(360, { duration: turn, easing: Easing.linear }), -1, false); }
    else { cancelAnimation(r); r.value = 0; }
  }, [calm]);
  useEffect(() => () => cancelAnimation(r), [r]);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: r.value + 'deg' }] }));
  return <Animated.View
    accessible={!!label}
    accessibilityLabel={label}
    accessibilityRole={label ? 'progressbar' : undefined}
    style={[{ width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: track, borderTopColor: color }, spin]} />;
}

export type IconButtonKind = 'round' | 'glass' | 'stepperMinus' | 'stepperPlus' | 'fab' | 'fabLg' | 'send';

/** A round icon control. `label` is required: the icon is its only content. Its press handlers receive the
 *  responder event (the stepper reads where the finger is). */
export function IconButton({ icon, label, onPress, kind = 'round', size, active, disabled, iconSize, color, style, onPressIn, onPressOut, onPressMove, testID }: {
  icon: IconName; label: string; onPress?: () => void; kind?: IconButtonKind; size?: number; active?: boolean; disabled?: boolean; iconSize?: number; color?: string;
  style?: StyleProp<ViewStyle>; onPressIn?: (e: GestureResponderEvent) => void; onPressOut?: (e: GestureResponderEvent) => void; onPressMove?: (e: GestureResponderEvent) => void; testID?: string;
}) {
  const pressKind: PressKind = kind === 'send' ? 'send' : 'icon';
  const press = usePress(pressKind);
  const d = size ?? (kind === 'stepperMinus' || kind === 'stepperPlus' ? 64 : kind === 'fab' ? 56 : kind === 'fabLg' ? 80 : kind === 'send' ? 44 : 36);
  // the pressed colours (round and the stepper's minus) ride the press progress
  const mix: { bg?: [string, string]; border?: [string, string] } | null = kind === 'stepperMinus' ? { bg: [fx.premium.transparent, fx.fill.a05] }
    : kind === 'round' ? { bg: [fx.fill.a05, fx.red.a10], border: [fx.line.a10, fx.red.a30] } : null;
  const look: ViewStyle = (() => {
    switch (kind) {
      case 'glass': return { backgroundColor: fx.glass.onPhotoStrong, borderWidth: 1, borderColor: fx.line.a10 };
      case 'stepperMinus': return { borderWidth: 1, borderColor: fx.line.a15, backgroundColor: fx.premium.transparent };
      case 'stepperPlus': return { backgroundColor: fx.red.brand, borderWidth: 1, borderColor: fx.red.a50, boxShadow: fx.shadow.cta };
      case 'fab': return { backgroundColor: active ? fx.hue.green500 : fx.red.fill, boxShadow: fx.shadow.fab };
      case 'fabLg': return { backgroundColor: active ? fx.hue.green500 : fx.red.fill, boxShadow: fx.shadow.fabLg };
      case 'send': return active ? { backgroundColor: fx.red.vivid, boxShadow: fx.shadow.fab } : { backgroundColor: fx.fill.a05, borderWidth: 1, borderColor: fx.line.a10 };
      default: return { backgroundColor: fx.fill.a05, borderWidth: 1, borderColor: fx.line.a10 };
    }
  })();
  const bgFrom = mix?.bg?.[0], bgTo = mix?.bg?.[1], bdFrom = mix?.border?.[0], bdTo = mix?.border?.[1];
  const { progress } = press;
  // over a hero a photo flies into: 0 while it flies, then fading in (a copy of the photo never carries the control)
  const chrome = useMorphChrome();
  const inCopy = useMorphCopy();
  const disc = useAnimatedStyle(() => {
    const o: Record<string, unknown> = {};
    if (bgFrom && bgTo) o.backgroundColor = interpolateColor(progress.value, [0, 1], [bgFrom, bgTo]);
    if (bdFrom && bdTo) o.borderColor = interpolateColor(progress.value, [0, 1], [bdFrom, bdTo]);
    o.opacity = inCopy ? 0 : chrome ? chrome.get() : 1;
    return o;
  }, [bgFrom, bgTo, bdFrom, bdTo, inCopy, chrome]);
  const glyph = iconSize ?? (kind === 'fabLg' ? 32 : kind === 'fab' ? 26 : kind.startsWith('stepper') ? 22 : kind === 'send' ? 18 : Math.round(d * 0.5));
  const filled = kind === 'fab' || kind === 'fabLg';
  const hit = Math.max(Platform.OS === 'android' ? 48 : 44, d);
  const pad = (hit - d) / 2;
  return <AnimatedPressable
    {...PRESS_PROPS}
    testID={testID}
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ disabled: !!disabled }}
    disabled={disabled}
    onPress={onPress}
    onPressIn={(e) => { press.onPressIn(); onPressIn?.(e); }}
    onPressOut={(e) => { press.onPressOut(); onPressOut?.(e); }}
    onPressMove={onPressMove}
    hitSlop={Platform.OS === 'web' ? undefined : pad}
    style={[Platform.OS === 'web' && pad > 0 ? { padding: pad, margin: -pad } : null, { opacity: disabled ? 0.3 : 1 }, style, press.style]}>
    <Animated.View style={[{ width: d, height: d, borderRadius: d / 2, alignItems: 'center', justifyContent: 'center' }, look, disc]}>
      <Icon name={icon} size={glyph} color={color ?? fx.ink.white} stroke={kind === 'stepperPlus' || kind === 'stepperMinus' ? 2.5 : 2} fill={filled ? fx.ink.white : undefined} />
    </Animated.View>
  </AnimatedPressable>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  hidden: { opacity: 0 },
  busy: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  full: { alignSelf: 'stretch' },
  hug: { alignSelf: 'flex-start' },
  light: { position: 'absolute', left: 0, right: 0, top: 0, height: '50%' },
  clip: { overflow: 'hidden' },
  glow: { backgroundColor: fx.premium.transparent },
  // one line at the usual sizes; a long title at a large text size takes a second line instead of cutting off
  title: { flexShrink: 1, textAlign: 'center' },
  iconBox: { alignItems: 'center', justifyContent: 'center' },
  linkTouch: { paddingVertical: 16, marginVertical: -10, minHeight: 44 },
});
