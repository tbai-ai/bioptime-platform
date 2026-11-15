/* Text in the kit's type scale. `T v="h1"` picks a variant of ./type; `P` keeps the staff kit's props (muted, small)
   so pinned lines read the same; `Eyebrow` is the uppercase label above a title; `H` a section title. Headings
   (h1 and heading, and H) are announced as headers. Each variant caps how far the system text size may grow it. */
import React from 'react';
import { Platform, Text, View, type TextProps, type TextStyle, type StyleProp, type ViewStyle } from 'react-native';
import { fx } from '@/theme';
import { maxScaleFor, type, type TypeVariant } from './type';

export type TProps = TextProps & { v?: TypeVariant; color?: string; style?: StyleProp<TextStyle>; children?: React.ReactNode; center?: boolean };

const HEADERS = new Set<TypeVariant>(['h1', 'heading', 'auth56', 'quiz42', 'display36']);

/** The web has no system text size, so the cap (and a shrink-to-fit with its floor) is written where a check can read
 *  it (data-fsmax, data-fit): the large-text pass scales the web build the way Android does. Nothing reads it in the app. */
const WEB_SCALE_CAP = (max: number, fit?: boolean, floor?: number) => (Platform.OS === 'web'
  ? { dataSet: fit ? { fsmax: String(max), fit: String(floor ?? 0.5) } : { fsmax: String(max) } } as object : null);

export function T({ v = 'body', color, style, center, children, ...rest }: TProps) {
  const max = rest.maxFontSizeMultiplier ?? maxScaleFor(v);
  return <Text
    accessibilityRole={HEADERS.has(v) ? 'header' : rest.accessibilityRole}
    {...WEB_SCALE_CAP(max, rest.adjustsFontSizeToFit, rest.minimumFontScale)}
    {...rest}
    maxFontSizeMultiplier={max}
    style={[type[v], color ? { color } : null, center ? { textAlign: 'center' } : null, style]}>
    {children}
  </Text>;
}

/** A paragraph: white light 14 (the earlier app rendered its secondary copy white); `muted` → white/60, `small` → 12. */
export function P({ children, muted, small, style, ...rest }: Omit<TProps, 'v'> & { muted?: boolean; small?: boolean }) {
  return <T v={small ? 'bodySm' : 'body'} color={muted ? fx.ink.a60 : undefined} style={style} {...rest}>{children}</T>;
}

/** The uppercase label above a title. `brand`: red, wide (BIOPTIME, STEP 1 OF 9); `store`: white, wide; default: the
 *  Home greeting style (white/60). */
export function Eyebrow({ children, kind = 'greeting', color, style }: { children: React.ReactNode; kind?: 'brand' | 'greeting' | 'store' | 'label' | 'overline'; color?: string; style?: StyleProp<TextStyle> }) {
  const v: TypeVariant = kind === 'brand' ? 'eyebrowBrand' : kind === 'store' ? 'eyebrowStore' : kind === 'label' ? 'label' : kind === 'overline' ? 'overline' : 'eyebrowGreeting';
  return <T v={v} color={color} style={style}>{children}</T>;
}

/** A section title (Montserrat 14/500; `strong` 600), optionally with a right-hand action such as "See all"
 *  (the earlier app's `flex justify-between items-center mb-3` row). */
export function H({ children, strong, right, icon, style }: { children: React.ReactNode; strong?: boolean; right?: React.ReactNode; icon?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  // at a large text size the right-hand part moves under the title instead of squeezing it (flexWrap). The title and
  // its row take the line's free width (the text stays left-aligned, so nothing moves): Android lays a title out at
  // its box's whole-pixel width, which could come out a hair under the width it measured, and the last word then wrapped
  // into a line the box had no height for ('Your sets' drawn as 'Your'); with the free width it fits as measured.
  return <View style={[{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 8, rowGap: 4, marginBottom: 12 }, style]}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
      {icon}
      <T v={strong ? 'sectionStrong' : 'section'} accessibilityRole="header" style={{ flexGrow: 1, flexShrink: 1 }}>{children}</T>
    </View>
    {right}
  </View>;
}
