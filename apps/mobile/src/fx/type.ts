/* The client app's type scale (the earlier app, THEME §8; BUILD_PLAN §2.1). One family per weight: Android cannot map
   fontWeight onto a custom family, so a weight is chosen by its family name. The nine files in assets/fonts carry these
   names as their PostScript names, so iOS, Android and the web share one string each. Letter spacing in RN is points:
   em × size. Bebas is caps-only by design: its strings are written in sentence case and the font draws capitals (never
   textTransform on Bebas: the web E2E reads innerText, which applies it). Uppercase Montserrat labels do use
   textTransform, as the staff Eyebrow does. */
import type { TextStyle } from 'react-native';
import { fx } from '@/theme';

export const FONTS = {
  display: 'BebasNeue-Regular',
  sans300: 'Montserrat-Light',
  sans400: 'Montserrat-Regular',
  sans500: 'Montserrat-Medium',
  sans600: 'Montserrat-SemiBold',
  sans700: 'Montserrat-Bold',
  mono400: 'JetBrainsMono-Regular',
  mono500: 'JetBrainsMono-Medium',
  mono700: 'JetBrainsMono-Bold',
} as const;

/** The font files useFonts loads at runtime: the nine files on the web, none on iOS and Android, where the expo-font
 *  config plugin embeds them natively (./fontFiles.ts and ./fontFiles.web.ts). */
export { FONT_FILES } from './fontFiles';

export type SansWeight = 300 | 400 | 500 | 600 | 700;
export type MonoWeight = 400 | 500 | 600 | 700;

/** The family for a weight. Mono 600 resolves to Bold, as the earlier app rendered it (only 400, 500 and 700 were loaded). */
export function fontFor(kind: 'sans', weight: SansWeight): string;
export function fontFor(kind: 'mono', weight: MonoWeight): string;
export function fontFor(kind: 'sans' | 'mono', weight: number): string {
  if (kind === 'mono') return weight >= 600 ? FONTS.mono700 : weight === 500 ? FONTS.mono500 : FONTS.mono400;
  return ({ 300: FONTS.sans300, 400: FONTS.sans400, 500: FONTS.sans500, 600: FONTS.sans600, 700: FONTS.sans700 } as Record<number, string>)[weight] ?? FONTS.sans400;
}

const bebas = (size: number, line: number, em = 0): TextStyle => ({ fontFamily: FONTS.display, fontSize: size, lineHeight: line, letterSpacing: em * size, color: fx.ink.white });
const sans = (weight: SansWeight, size: number, line: number, em = 0, upper = false): TextStyle => ({ fontFamily: fontFor('sans', weight), fontSize: size, lineHeight: line, letterSpacing: em * size, color: fx.ink.white, ...(upper ? { textTransform: 'uppercase' as const } : null) });
const mono = (weight: MonoWeight, size: number, line: number, em = 0): TextStyle => ({ fontFamily: fontFor('mono', weight), fontSize: size, lineHeight: line, letterSpacing: em * size, color: fx.ink.white });

/** Every text style of the kit, by name (BUILD_PLAN §2.1 table). */
export const type = {
  ghost: { ...bebas(120, 120), color: fx.ink.ghost },
  stepper: { ...bebas(96, 96, 0.025), fontVariant: ['tabular-nums'] },
  hero72: bebas(72, 72),
  auth56: bebas(56, 56, 0.025),
  score54: { ...bebas(54, 54), textShadowColor: fx.red.a35, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 24 },
  sheet48: bebas(48, 48),
  quiz42: bebas(42, 42, 0.025),
  display36: bebas(36, 40, 0.025),
  h1: bebas(30, 36),
  card24: bebas(24, 24),
  small20: bebas(20, 28),
  heading: sans(600, 18, 28),
  cardTitle: sans(600, 16, 24),
  section: sans(500, 14, 20),
  sectionStrong: sans(600, 14, 20),
  body: sans(300, 14, 22.75),
  bodySm: sans(300, 12, 19.5),
  caption: sans(400, 11, 16.5),
  eyebrowBrand: { ...sans(700, 10, 15, 0.3, true), color: fx.red.brand },
  eyebrowGreeting: { ...sans(500, 11, 16.5, 0.18, true), color: fx.ink.a60 },
  eyebrowStore: sans(500, 10, 15, 0.2, true),
  label: { ...sans(700, 10, 15, 0.2, true), color: fx.ink.ink2 },
  overline: { ...sans(700, 11, 16.5, 0.1, true), color: fx.red.label },
  micro: sans(700, 9, 13.5, 0.1, true),
  metric24: mono(500, 24, 28),
  metric30: mono(500, 30, 34),
  mono14: mono(400, 14, 20),
  mono12: mono(400, 12, 16),
  mono11: mono(400, 11, 15),
  mono10: mono(400, 10, 14),
  button: sans(700, 16, 24),
  buttonSm: sans(600, 14, 20),
  chip: sans(500, 12, 16),
} satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof type;

const DISPLAY = new Set<TypeVariant>(['ghost', 'stepper', 'hero72', 'auth56', 'score54', 'sheet48', 'quiz42', 'display36', 'h1', 'card24', 'small20']);
const COMPACT = new Set<TypeVariant>(['overline', 'eyebrowGreeting', 'chip']);
/** The tiny uppercase labels (9 and 10 pt, spaced wide) under a value or above a title: they sit in fixed columns
 *  (stat rows, tile grids), so they grow less; the value next to them carries the meaning. */
const TINY = new Set<TypeVariant>(['micro', 'label', 'eyebrowBrand', 'eyebrowStore']);

/** How far a variant may grow with the system text size: display 1.2, tiny uppercase labels 1.2, labels and tabs 1.3,
 *  body 1.6. */
export function maxScaleFor(v: TypeVariant): number {
  return DISPLAY.has(v) || TINY.has(v) ? 1.2 : COMPACT.has(v) ? 1.3 : 1.6;
}
