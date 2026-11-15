/* The Bioptime wordmark, tagline and full lockup as react-native-svg drawings, from the brand vectors (./markData.ts).
   Widths in points; heights follow the artwork. The lockup is at least 180 pt wide wherever it stands alone (brand
   book). Decorative unless given an accessibility label. */
import React from 'react';
import { Path } from 'react-native-svg';
import { GLYPHS, LOCKUP_BOX, TAGLINE, type Box } from './markData';
import { ArtFrame, MarkShapes, markColors, type ArtProps } from './MarkPaths';

/** The union of the wordmark glyphs (bioptime-wordmark.svg's frame). */
export const WORDMARK_BOX: Box = [842, 2890, 3256, 687];
/** The tagline's frame. */
export const TAGLINE_BOX: Box = [800, 3638, 3340, 165];

/** The wordmark "bioptime" (the o in red). */
export function Wordmark(props: ArtProps) {
  return <ArtFrame box={WORDMARK_BOX} {...props}>
    {GLYPHS.map((g, i) => <Path key={i} d={g.d} fill={g.red ? markColors.red : markColors.white} />)}
  </ArtFrame>;
}

/** The tagline "YOUR WELLNESS, OUR PASSION." as the lockup draws it. */
export function Tagline(props: ArtProps) {
  return <ArtFrame box={TAGLINE_BOX} {...props}>
    {TAGLINE.map((l, i) => <Path key={i} d={l.d} fill={markColors.white} />)}
  </ArtFrame>;
}

/** The full lockup: mark, wordmark and tagline (≥ 180 pt wide, brand book). */
export function Lockup(props: ArtProps) {
  return <ArtFrame box={LOCKUP_BOX} {...props}>
    <MarkShapes />
    {GLYPHS.map((g, i) => <Path key={`g${i}`} d={g.d} fill={g.red ? markColors.red : markColors.white} />)}
    {TAGLINE.map((l, i) => <Path key={`t${i}`} d={l.d} fill={markColors.white} />)}
  </ArtFrame>;
}
