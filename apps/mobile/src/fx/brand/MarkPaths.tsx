/* The Bioptime mark as a react-native-svg drawing, from the brand vectors (./markData.ts, transcribed from
   ~/Desktop/drive/brand); the wordmark, tagline and lockup are in ./Wordmark.tsx. Colours come from the theme: white,
   the brand red and the rung slate (`fx.premium.slate`, the brand's #7A8293). Sizes are widths in points; heights
   follow the artwork. The brand book's minimum mark size is 24 pt. Decorative unless given an accessibility label. */
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';
import { fx } from '@/theme';
import { LOOP_RED, LOOP_WHITE, MARK_BOX, RUNGS, type Box } from './markData';

/** The mark's three colours. */
export const markColors = {
  white: fx.ink.white,
  red: fx.red.brand,
  slate: fx.premium.slate,
} as const;

export const viewBoxOf = (b: Box) => `${b[0]} ${b[1]} ${b[2]} ${b[3]}`;
export const heightFor = (b: Box, width: number) => (width * b[3]) / b[2];

export type ArtProps = { width: number; accessibilityLabel?: string; style?: StyleProp<ViewStyle> };

export function ArtFrame({ box, width, accessibilityLabel, style, children }: ArtProps & { box: Box; children: React.ReactNode }) {
  const hidden = !accessibilityLabel;
  return <View
    style={[{ width, height: heightFor(box, width) }, style]}
    accessible={!hidden}
    accessibilityRole={hidden ? undefined : 'image'}
    accessibilityLabel={accessibilityLabel}
    accessibilityElementsHidden={hidden}
    importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
  >
    <Svg width={width} height={heightFor(box, width)} viewBox={viewBoxOf(box)}>{children}</Svg>
  </View>;
}

/** The mark's paths, for use inside an Svg whose viewBox includes MARK_BOX. */
export function MarkShapes() {
  return <G>
    <Path d={LOOP_WHITE} fill={markColors.white} />
    <Path d={LOOP_RED} fill={markColors.red} />
    {RUNGS.map((r, i) => <Path key={i} d={r.d} fill={markColors.slate} />)}
  </G>;
}

/** The mark (the two loops and the helix rungs). */
export function MarkPaths(props: ArtProps) {
  return <ArtFrame box={MARK_BOX} {...props}><MarkShapes /></ArtFrame>;
}
