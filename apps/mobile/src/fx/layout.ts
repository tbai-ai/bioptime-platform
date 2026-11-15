/* Layout measures (THEME §7): the earlier app's 390 pt phone with 24 pt title gutters and 20 pt card gutters. On wide screens
   (tablets, the web) content sits in a centred column of at most 520 pt while hero photos stay full-bleed. The tab bar
   floats 24 pt above the bottom (or the home indicator) and is 74 tall; tab content clears it. */
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fx } from '@/theme';

export const COLUMN = 520;

/** A system text size of 1.3 (Android's Large) or more. Android hands the scale over as a ratio of floats (1.2999999 at
 *  320 dpi, where `fontScale >= 1.3` was false and the actions that stack from text 1.3 stayed side by side), so the test
 *  allows for that rounding. */
export function largeText(fontScale: number): boolean { return fontScale >= 1.3 - 0.005; }

/** Bottom of the floating pill above the screen's bottom edge. */
export function navBottom(insetBottom: number): number { return Math.max(fx.space.navBottom, insetBottom + 8); }

/** Space tab content leaves under its last element so nothing hides behind the pill. */
export function navClearance(insetBottom: number): number { return navBottom(insetBottom) + fx.space.navHeight + 16; }

export type Layout = {
  width: number;
  height: number;
  /** ≥ 700 pt wide. */
  isTablet: boolean;
  /** The content column width (≤ 520). */
  column: number;
  /** Side gutter that centres the column (0 on phones). */
  gutter: number;
  /** Hero photo heights (PREMIUM §1.4): 280 at ≤ 360, 320 on phones, 360 from 768. */
  heroHeight: number;
  /** Use the 1600 px photo files. */
  largePhotos: boolean;
  insets: { top: number; bottom: number; left: number; right: number };
  /** Bottom clearance for tab content. */
  clearance: number;
};

export function useLayout(): Layout {
  const { width, height, scale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const column = Math.min(width, COLUMN);
  return {
    width,
    height,
    isTablet: width >= 700,
    column,
    gutter: Math.max(0, (width - column) / 2),
    heroHeight: width >= 768 ? 360 : width <= 360 ? 280 : 320,
    largePhotos: width * scale > 1300,
    insets,
    clearance: navClearance(insets.bottom),
  };
}
