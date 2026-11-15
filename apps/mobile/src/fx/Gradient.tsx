/* Every gradient of the client app as a named preset (THEME §3, PREMIUM §1.6), so screens never write a colour:
   <Scrim kind="heroHome" style={StyleSheet.absoluteFill} />. Scrims are decorative (no touches, hidden from screen
   readers). Directions follow CSS: "to top" starts at the bottom. RadialGlow draws the earlier app's radial washes (orbs,
   halos, the dish fallback) with react-native-svg, since a blurred disc has no cheap native equivalent. */
import { LinearGradient } from 'expo-linear-gradient';
import React, { useId } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { fx } from '@/theme';
import { motionValues } from './motion/tokens';

type Dir = 'toTop' | 'toBottom' | 'toRight' | 'toLeft' | 'toBottomRight' | 'toTopRight' | 'deg145' | 'deg135';
const DIRS: Record<Dir, { start: { x: number; y: number }; end: { x: number; y: number } }> = {
  toTop: { start: { x: 0, y: 1 }, end: { x: 0, y: 0 } },
  toBottom: { start: { x: 0, y: 0 }, end: { x: 0, y: 1 } },
  toRight: { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
  toLeft: { start: { x: 1, y: 0 }, end: { x: 0, y: 0 } },
  toBottomRight: { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },
  toTopRight: { start: { x: 0, y: 1 }, end: { x: 1, y: 0 } },
  deg145: { start: { x: 0.213, y: 0.09 }, end: { x: 0.787, y: 0.91 } },
  deg135: { start: { x: 0.146, y: 0.146 }, end: { x: 0.854, y: 0.854 } },
};

const T = fx.premium.transparent;

/** name → direction, colours and (optionally) their stops. */
const SCRIMS = {
  /** Home hero photo (with the red overlay drawn by Photo tint="red"). */
  heroHome: { d: 'toTop', c: [fx.bg.panel, 'rgba(10,10,10,0.80)', T] },
  /** The role chooser's ghosted photo. */
  authRole: { d: 'toBottom', c: ['rgba(8,8,8,0.70)', 'rgba(8,8,8,0.85)', fx.bg.base] },
  /** Sign-in backdrop (top 45 % of the screen). */
  login: { d: 'toBottom', c: ['rgba(8,8,8,0.80)', 'rgba(8,8,8,0.60)', fx.bg.base] },
  /** Train header photo. */
  trainHeader: { d: 'toBottom', c: ['rgba(8,8,8,0.30)', 'rgba(8,8,8,0.60)', fx.bg.base] },
  /** Bio, Life, Fuel and Tests header bands (premium). */
  headerBand: { d: 'toBottom', c: ['rgba(0,0,0,0.30)', 'rgba(0,0,0,0.70)', fx.bg.deep] },
  /** Splash bottom. */
  splash: { d: 'toTop', c: [fx.bg.deep, 'rgba(0,0,0,0.40)', T] },
  /** Quick-workout and photo card bottoms. */
  cardBottom: { d: 'toTop', c: ['rgba(0,0,0,0.90)', 'rgba(0,0,0,0.40)', T] },
  /** Package card and sheet hero. */
  programme: { d: 'toTop', c: [fx.bg.panel, 'rgba(10,10,10,0.60)', T] },
  /** Test card photo (draw at opacity .9). */
  diagnostics: { d: 'toTop', c: [fx.bg.panel, T] },
  /** Next-workout banner (text on the left). */
  banner: { d: 'toRight', c: ['rgba(0,0,0,0.90)', 'rgba(0,0,0,0.60)', T] },
  /** Gallery tile. */
  gallery: { d: 'toTop', c: ['rgba(0,0,0,0.70)', T] },
  /** Sticky CTA footer over a scrolling list (flows, checkout). */
  stickyCta: { d: 'toTop', c: [fx.bg.base, T] },
  /** Sticky footer over the black tabs canvas. */
  stickyCtaDeep: { d: 'toTop', c: [fx.bg.deep, T] },
  /** Coach (chat) screen background. */
  aiScreen: { d: 'toBottom', c: [fx.bg.panel, fx.bg.card, fx.bg.panel] },
  /** Longevity hero card wash. */
  longevityHero: { d: 'toBottom', c: [fx.fill.a05, T] },
  /** Score card hover wash. */
  scoreWash: { d: 'toBottomRight', c: ['rgba(239,68,68,0.05)', T] },
  /** TiltCard press sheen. */
  redSheen: { d: 'toTopRight', c: [...fx.premium.redSheen] },
  /** The light sheen band (premium), horizontal. */
  sheen: { d: 'toRight', c: [T, fx.premium.sheen, T] },
  /** Top-lit hairline inside a glass card's top edge (premium). */
  topLight: { d: 'toRight', c: [T, fx.premium.topLight, T] },
  /** The soft light inside the top half of a primary button (premium). */
  buttonLight: { d: 'toBottom', c: [fx.premium.buttonLight, T] },
  /** Streak day done. */
  streakDay: { d: 'toBottomRight', c: [fx.red.vivid, fx.red.streakEnd] },
  /** Nav pill edge fades (56 wide). */
  navLeft: { d: 'toRight', c: ['rgba(0,0,0,0.75)', 'rgba(0,0,0,0.40)', T] },
  navRight: { d: 'toLeft', c: ['rgba(0,0,0,0.75)', 'rgba(0,0,0,0.40)', T] },
  /** Under the tab bar where the pill cannot blur (Android, tier B on the web, tier C): the page dissolves into black
   *  before it reaches the pill, so no line of text runs on under the icons. */
  navBase: { d: 'toTop', c: [fx.bg.deep, fx.bg.deep, 'rgba(0,0,0,0.70)', T], at: [0, 0.42, 0.7, 1] },
  /** The same edges where the pill cannot mask its content (iOS, Android), 56 wide: solid pill black under the chevron
   *  and its room (the first 32 pt), so a half-scrolled tab icon neither shows through nor touches it. */
  navEdgeLeft: { d: 'toRight', c: [fx.glass.pillLite, fx.glass.pillLite, 'rgba(0,0,0,0.40)', T], at: [0, 0.57, 0.8, 1] },
  navEdgeRight: { d: 'toLeft', c: [fx.glass.pillLite, fx.glass.pillLite, 'rgba(0,0,0,0.40)', T], at: [0, 0.57, 0.8, 1] },
  /** Horizontal list edge fades over the black canvas (PillTabs). */
  edgeLeft: { d: 'toRight', c: [fx.bg.deep, T] },
  edgeRight: { d: 'toLeft', c: [fx.bg.deep, T] },
  /** Wearable-style solid card. */
  solidCard: { d: 'deg145', c: [...fx.bg.cardGradient] },
  /** Coach medallion and avatar ring. */
  coach: { d: 'deg135', c: [fx.red.brand, fx.red.avatarEnd] },
  /** Empty-state photo band (premium). */
  emptyBand: { d: 'toBottom', c: [T, fx.bg.deep] },
  /** Profile backdrop (premium). */
  profileBand: { d: 'toBottom', c: ['rgba(0,0,0,0.20)', fx.bg.deep] },
  /** Skeleton shimmer band. */
  shimmer: { d: 'toRight', c: [...fx.premium.shimmer] },
  /** Overlay footer fade (#080808 overlays). */
  overlayFooter: { d: 'toTop', c: [fx.bg.base, fx.bg.base, T], at: [0, 0.55, 1] },
  /** Coach: the thread's top edge under the consultation strip (the thread passes under it with a fade, CRT-N6). */
  threadTop: { d: 'toBottom', c: [fx.bg.panel, T] },
  /** The status bar's backing at rest (src/fx/StatusScrim): black under the clock, clear at the inset's lower edge. */
  statusBar: { d: 'toBottom', c: ['rgba(0,0,0,0.85)', 'rgba(0,0,0,0.45)', T], at: [0, 0.5, 1] },
  /** The tab pager's edge shadow on the incoming page's leading edge (28 pt wide; the pager drives its opacity). */
  pagerEdgeL: { d: 'toRight', c: [fx.premium.pagerDim, T] },
  pagerEdgeR: { d: 'toLeft', c: [fx.premium.pagerDim, T] },
  /** Home hero wash: the red overlay solid down to 55 %, then clear. */
  heroWash: { d: 'toBottom', c: [fx.premium.heroOverlay, fx.premium.heroOverlay, T], at: [0, motionValues.screens.m65.washSolidTo, 1] },
} satisfies Record<string, { d: Dir; c: string[]; at?: number[] }>;

export type ScrimKind = keyof typeof SCRIMS;

export function Scrim({ kind, style, opacity }: { kind: ScrimKind; style?: StyleProp<ViewStyle>; opacity?: number }) {
  const preset: { d: Dir; c: string[]; at?: number[] } = SCRIMS[kind];
  const d = DIRS[preset.d];
  return <LinearGradient
    pointerEvents="none"
    accessible={false}
    importantForAccessibility="no-hide-descendants"
    colors={preset.c as [string, string, ...string[]]}
    locations={preset.at as [number, number, ...number[]] | undefined}
    start={d.start}
    end={d.end}
    style={[opacity != null ? { opacity } : null, style]}
  />;
}

/** `color` (#RRGGBB, #RRGGBBAA or rgb(a)) with its alpha multiplied by `a`, as a CSS colour; null for anything else. */
function alphaOf(color: string, a: number): string | null {
  const k = Math.max(0, Math.min(1, a));
  const hex = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(color);
  if (hex) return `#${hex[1]}${Math.round((hex[2] ? parseInt(hex[2], 16) / 255 : 1) * k * 255).toString(16).padStart(2, '0')}`;
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(color);
  if (rgb) return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${Math.round((rgb[4] != null ? Number(rgb[4]) : 1) * k * 10000) / 10000})`;
  return null;
}

/** Android: the wash as the view's own CSS radial-gradient background (a shader the view draws), not an SVG: an SVG
 *  draws into a bitmap the size of its box, and a card-sized wash (Train's tiles carry two at 970 × 420 px) held
 *  1.6 MB of bitmap and texture each, drawn again on every re-attach. The ellipse is the SVG's: radii half the box's
 *  width and height (`50% 50%`) at (cx, cy), the same stops. The web and iOS keep the SVG. */
const NATIVE_WASH = Platform.OS === 'android';

const pct = (v: number) => `${Math.round(v * 10000) / 100}%`;

/** Android: a radial wash as a view's own CSS radial-gradient background (a shader the view draws, as RadialGlow's
 *  NATIVE_WASH), for the motion kit's discs (the orbs, the score ring's halo): `stops` are token colours, each with an
 *  optional multiplier on its alpha, at 0..1 of the radius (radii half the box's width and height at (cx, cy), as the
 *  SVG's r="50%"). An SVG draws into a software bitmap the size of its box on the UI thread (Home's two orbs and the halo
 *  held 1008², 840² and 742² px bitmaps, drawn and uploaded again on every mount). Null elsewhere, or for a colour it
 *  cannot read: the caller keeps its SVG. */
export function nativeRadial(stops: readonly { color: string; alpha?: number; at: number }[], cx = 0.5, cy = 0.5): ViewStyle | null {
  if (!NATIVE_WASH) return null;
  const parts: string[] = [];
  for (const s of stops) {
    const c = alphaOf(s.color, s.alpha ?? 1);
    if (!c) return null;
    parts.push(`${c} ${pct(s.at)}`);
  }
  return { experimental_backgroundImage: `radial-gradient(50% 50% at ${pct(cx)} ${pct(cy)}, ${parts.join(', ')})` };
}

/** A radial wash: `color` at `opacity` in the centre, fading to transparent at `fade` (0..1 of the radius; the earlier app used
 *  70 %). Fills its box; position and size it with `style`. */
export function RadialGlow({ color = fx.red.brand, opacity = 0.15, mid, fade = 0.7, cx = 0.5, cy = 0.5, style }: {
  color?: string; opacity?: number; mid?: { at: number; opacity: number }; fade?: number; cx?: number; cy?: number; style?: StyleProp<ViewStyle>;
}) {
  const id = `glow${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const c0 = NATIVE_WASH ? alphaOf(color, opacity) : null;
  const cm = NATIVE_WASH && mid ? alphaOf(color, mid.opacity) : null;
  const c1 = NATIVE_WASH ? alphaOf(color, 0) : null;
  if (c0 && c1 && (!mid || cm)) {
    const stops = [`${c0} 0%`, ...(mid && cm ? [`${cm} ${pct(mid.at)}`] : []), `${c1} ${pct(fade)}`].join(', ');
    return <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants"
      style={[style, { experimental_backgroundImage: `radial-gradient(50% 50% at ${pct(cx)} ${pct(cy)}, ${stops})` }]} />;
  }
  return <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={style}>
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
      <Defs>
        <RadialGradient id={id} cx={`${cx * 100}%`} cy={`${cy * 100}%`} r="50%" fx={`${cx * 100}%`} fy={`${cy * 100}%`}>
          {[
            <Stop key="0" offset="0" stopColor={color} stopOpacity={opacity} />,
            ...(mid ? [<Stop key="mid" offset={String(mid.at)} stopColor={color} stopOpacity={mid.opacity} />] : []),
            <Stop key="end" offset={String(fade)} stopColor={color} stopOpacity={0} />,
          ]}
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  </View>;
}
