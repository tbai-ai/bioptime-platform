/* Bioptime brand tokens for the app (from brand/book/tokens.json, dark theme, which the brand book makes the default). */
export const colors = {
  canvas: '#0B1120',
  base: '#131D33',
  surface: '#182239',
  raised: '#1F2B46',
  hover: '#283553',
  border: '#283553',
  borderStrong: '#3A4866',
  text: '#FFFFFF',
  muted: '#8A95AA',
  disabled: '#5B6780',
  brand: '#EE3324',
  brandDeep: '#C41C0D',
  accentText: '#FF7366',
  onAccent: '#FFFFFF',
  success: '#43A047',
  successText: '#9BE0A0',
  warning: '#FFB300',
  warningText: '#FFD27A',
  error: '#EE3324',
  errorText: '#FF7366',
  info: '#A3AEC2',
  sampleBg: '#3B2A00',
  sampleText: '#FFD27A',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 18, pill: 999 } as const;
export const font = { title: 26, h2: 20, h3: 17, body: 15, small: 13, tiny: 11 } as const;

/* The client app's look (the kit in src/fx; staff screens keep the tokens above): the values of the owner's earlier
   app, measured from its own stylesheet, with Bioptime red #EE3324 kept. `premium` holds the light, scrim and depth
   colours the premium layer adds, so no screen ever writes a colour of its own. */
export const fx = {
  bg: {
    deep: '#000000', base: '#080808', panel: '#0A0A0A', panelSolid: '#0B0B0B', sheetTall: '#0D0D0D', sheetLab: '#0B0B0B',
    card: '#111111', elevated: '#1A1A1A', hover: '#222222', cardGradient: ['#141414', '#111111'] as const, // 145deg
  },
  glass: {
    card: 'rgba(20,20,20,0.40)', cardLite: 'rgba(20,20,20,0.72)', pill: 'rgba(0,0,0,0.60)', pillLite: 'rgba(0,0,0,0.94)',
    note: 'rgba(0,0,0,0.40)', onPhoto: 'rgba(0,0,0,0.50)', onPhotoStrong: 'rgba(0,0,0,0.80)', sheet: 'rgba(10,10,10,0.92)',
    sheetLite: 'rgba(10,10,10,0.96)', header: 'rgba(10,10,10,0.80)', headerLite: 'rgba(10,10,10,0.94)',
    composer: 'rgba(10,10,10,0.90)', skip: 'rgba(255,255,255,0.10)', toast: 'rgba(0,0,0,0.90)',
  },
  red: {
    brand: '#EE3324', pressed: '#D42C1E', deep: '#C41C0D', fill: '#DC2626', vivid: '#EF4444', label: '#F87171', error: '#FCA5A5',
    streakEnd: '#B91C1C', avatarEnd: '#7A1D16', rem: '#FF5740',
    /** A red fill under a white label (primary buttons, the chosen segment, a chosen date or tag): the brand book's
     *  action colour (tokens.css --bp-color-action-primary #D42C1E, label --bp-color-action-primaryText #FFFFFF), 5.0:1
     *  for white text (AA), and #C41C0D (6.0:1) pressed; the brand red #EE3324 (4.09:1 under white) stays for the glow,
     *  accents, icons and red text (release T3-03). */
    action: '#D42C1E', actionPressed: '#C41C0D',
    a05: 'rgba(238,51,36,0.05)', a06: 'rgba(238,51,36,0.06)', a10: 'rgba(238,51,36,0.10)', a12: 'rgba(238,51,36,0.12)',
    a15: 'rgba(238,51,36,0.15)', a20: 'rgba(238,51,36,0.20)', a25: 'rgba(238,51,36,0.25)', a30: 'rgba(238,51,36,0.30)', a35: 'rgba(238,51,36,0.35)',
    a40: 'rgba(238,51,36,0.40)', a50: 'rgba(238,51,36,0.50)', a60: 'rgba(238,51,36,0.60)',
  },
  gold: { base: '#C9A96E', dim: 'rgba(201,169,110,0.10)', a12: 'rgba(201,169,110,0.12)' },
  status: { optimal: '#43A047', good: '#7CB342', caution: '#FFB300', alert: '#FB8C00', critical: '#EE3324' },
  hue: {
    green500: '#22C55E', green400: '#4ADE80', emerald: '#34D399', amber300: '#FCD34D', amber400: '#FBBF24', amber500: '#F59E0B',
    yellow: '#EAB308', orange400: '#FB923C', orange500: '#F97316', blue: '#60A5FA', violet: '#A78BFA', lightBlue: '#64B5F6',
    night: 'rgba(144,202,249,0.70)', grey: '#6B7280',
  },
  ink: {
    white: '#FFFFFF', zinc200: '#E4E4E7', zinc300: '#D4D4D8', ink2: '#A1A1AA', ink3: '#71717A', ink4: '#52525B',
    // white alpha ladder (THEME §2.4); meaningful text never below a50 (contrast ≥ 5:1 on #000)
    a90: 'rgba(255,255,255,0.90)', a80: 'rgba(255,255,255,0.80)', a70: 'rgba(255,255,255,0.70)', a60: 'rgba(255,255,255,0.60)',
    a55: 'rgba(255,255,255,0.55)', a50: 'rgba(255,255,255,0.50)', a40: 'rgba(255,255,255,0.40)', a35: 'rgba(255,255,255,0.35)',
    a30: 'rgba(255,255,255,0.30)', a25: 'rgba(255,255,255,0.25)', a20: 'rgba(255,255,255,0.20)', ghost: 'rgba(255,255,255,0.025)',
  },
  line: {
    a05: 'rgba(255,255,255,0.05)', a08: 'rgba(255,255,255,0.08)', a10: 'rgba(255,255,255,0.10)', a12: 'rgba(255,255,255,0.12)',
    a15: 'rgba(255,255,255,0.15)', a20: 'rgba(255,255,255,0.20)', a50: 'rgba(255,255,255,0.50)', toast: '#333333',
    segmented: '#E2E8F0', // the bright hairline the owner knows: auth Email/Phone and unit toggles only (THEME §0.2)
  },
  fill: { a03: 'rgba(255,255,255,0.03)', a04: 'rgba(255,255,255,0.04)', a05: 'rgba(255,255,255,0.05)', a10: 'rgba(255,255,255,0.10)', a20: 'rgba(255,255,255,0.20)' },
  scrim: { sheet: 'rgba(0,0,0,0.80)', sheetDeep: 'rgba(0,0,0,0.85)', verified: 'rgba(0,0,0,0.80)', photo: 'rgba(0,0,0,0.30)' },
  tone: { // tinted fills for states that carry a colour (status pills, notices, inputs in error)
    successBg: 'rgba(67,160,71,0.12)', successLine: 'rgba(109,191,139,0.30)', warningBg: 'rgba(251,191,36,0.12)',
    warningLine: 'rgba(251,191,36,0.35)', errorBg: 'rgba(239,68,68,0.05)', errorLine: 'rgba(239,68,68,0.60)',
    greenBg: 'rgba(34,197,94,0.12)', greenLine: 'rgba(34,197,94,0.30)', focus: 'rgba(238,51,36,0.60)', focusSheet: 'rgba(239,68,68,0.50)',
    toastErrorLine: 'rgba(184,92,92,0.30)', inputBorderFocusLite: 'rgba(255,255,255,0.25)',
  },
  map: {
    category: { strength: '#C9A96E', conditioning: '#EE3324', mobility: '#43A047', core: '#60A5FA', balance: '#A78BFA',
                recovery: '#64B5F6', other: '#A1A1AA' }, // the earlier app's cardio→conditioning red, flexibility→mobility green
    guide: { purpose: '#EE3324', muscles: '#C9A96E', form: '#60A5FA', safety: '#FBBF24', recs: '#34D399' },
    macro: { kcal: '#EE3324', protein: '#EE3324', carbs: '#F59E0B', fat: '#C9A96E', fibre: '#34D399' },
    order: { confirmed: '#60A5FA', scheduled: '#FBBF24', sample_collected: '#A78BFA', processing: '#F97316',
             results_ready: '#34D399', completed: '#6B7280', cancelled: '#EF4444' },
    marker: { low: '#FBBF24', in_range: '#34D399', borderline: '#F97316', high: '#EF4444' },
    programme: [{ c: '#EE3324', dim: 'rgba(238,51,36,0.12)' }, { c: '#C9A96E', dim: 'rgba(201,169,110,0.12)' },
                { c: '#64B5F6', dim: 'rgba(100,181,246,0.10)' }] as const,
    dishTint: ['#8B6914', '#C4824A', '#E8D5B0', '#7A4A2A', '#C4A882', '#4A7C59', '#3A6B8A', '#6B8F71'] as const,
  },
  radius: { xs: 2, sm: 4, md: 6, lg: 8, xl: 12, toast: 14, card: 16, logo: 22, three: 24, tall: 28, hero: 32, pill: 999 },
  space: { titleX: 24, cardX: 20, tightX: 16, stack: 12, stackLg: 16, grid: 12, gridLg: 20, pad: 20, tile: 16, hero: 24,
           navBottom: 24, navHeight: 74, clear: 112 /* pb-28 */ },
  shadow: { // RN boxShadow strings (New Architecture, iOS + Android 9+, react-native-web)
    panel: '0px 8px 32px rgba(0,0,0,0.30)', pill: '0px 4px 24px -4px rgba(0,0,0,0.50)', deep: '0px 10px 40px rgba(0,0,0,0.80)',
    card: '0px 8px 30px rgba(0,0,0,0.50)', ctaAuth: '0px 4px 20px rgba(238,51,36,0.35)', cta: '0px 4px 24px rgba(238,51,36,0.35)',
    ctaPressed: '0px 6px 28px rgba(238,51,36,0.50)', segment: '0px 2px 12px rgba(238,51,36,0.30)',
    option: '0px 0px 20px rgba(238,51,36,0.12)', fab: '0px 0px 20px rgba(238,51,36,0.40)', fabLg: '0px 0px 30px rgba(238,51,36,0.40)',
    tile: '0px 0px 50px rgba(238,51,36,0.40)', dot: '0px 0px 8px rgba(238,51,36,0.60)', cardHover: '0px 0px 15px rgba(238,51,36,0.15)',
    white: '0px 0px 20px rgba(255,255,255,0.20)', whitePressed: '0px 0px 20px rgba(255,255,255,0.30)',
    verified: '0px 0px 30px rgba(255,255,255,0.30)', otp: '0px 0px 10px rgba(255,255,255,0.10)', green: '0px 0px 8px rgba(34,197,94,0.60)',
    checkout: '0px 0px 24px rgba(238,51,36,0.35)', logo: '0px 25px 50px -12px rgba(239,68,68,0.10)', toast: '0px 4px 20px rgba(0,0,0,0.30)',
    signOut: '0px 0px 15px rgba(238,51,36,0.10)', avatarRing: '0px 0px 20px rgba(238,51,36,0.25)',
  },
  premium: { // PREMIUM §1.6: one light source, above and slightly left
    sheen: 'rgba(255,255,255,0.09)', topLight: 'rgba(255,255,255,0.10)', buttonLight: 'rgba(255,255,255,0.12)',
    shimmer: ['#161616', '#1E1E1E', '#161616'] as const, liftShadow: '0px 16px 40px rgba(0,0,0,0.55)',
    fog: 'rgba(0,0,0,0.35)', pagerDim: '#000000', pagerDimMax: 0.45, halo: 'rgba(238,51,36,0.18)', haloMid: 'rgba(238,51,36,0.06)',
    haloCore: 'rgba(238,51,36,0.09)', bloom: 'rgba(238,51,36,0.55)', bloomMid: 'rgba(238,51,36,0.12)',
    arc: ['#FF5740', '#EE3324', '#C41C0D'] as const, specular: 'rgba(255,255,255,0.30)', groove: 'rgba(255,255,255,0.04)',
    grooveOuter: 'rgba(0,0,0,0.50)', redSheen: ['rgba(239,68,68,0)', 'rgba(239,68,68,0.05)', 'rgba(239,68,68,0.10)'] as const,
    orbRed: 'rgba(220,38,38,0.10)', orbRed2: 'rgba(239,68,68,0.10)', orbAuth: 'rgba(238,51,36,0.15)', orbWhite: 'rgba(255,255,255,0.08)',
    heroOverlay: 'rgba(239,68,68,0.10)', heroOverlayFlat: 'rgba(239,68,68,0.06)', headerOverlay: 'rgba(239,68,68,0.05)',
    ringTrack: 'rgba(255,255,255,0.07)', ringTrackSoft: 'rgba(255,255,255,0.05)', ringGlow: 'rgba(238,51,36,0.25)', ringGlow2: 'rgba(238,51,36,0.12)',
    tick: 'rgba(255,255,255,0.18)', tickMinor: 'rgba(255,255,255,0.07)', transparent: 'rgba(0,0,0,0)',
    sheenClear: 'rgba(255,255,255,0)', // the clear ends of the white sheen band (a gradient, no SVG stop opacity)
    slate: '#7A8293', // the brand mark's rung colour (bioptime-mark.svg .rung)
    knobShadow: '0px 1px 2px rgba(0,0,0,0.25)',
  },
} as const;

/** An SVG gradient stop drawn from a colour token: the opaque colour (#RRGGBB) and the token's alpha as the stop's
 *  opacity. react-native-svg on Android drops the alpha written inside stopColor, so an rgba stop drew opaque and a fade
 *  to `transparent` (rgba(0,0,0,0)) drew towards black (the orbs' hard discs with a dark rim); stopOpacity is honoured on
 *  every platform. A token without alpha keeps its colour at opacity 1. */
export function svgStop(color: string): { stopColor: string; stopOpacity: number } {
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(color.trim());
  if (!m) return { stopColor: color, stopOpacity: 1 };
  const hex = (v: string) => Math.max(0, Math.min(255, Number(v))).toString(16).padStart(2, '0').toUpperCase();
  return { stopColor: `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`, stopOpacity: m[4] === undefined ? 1 : Math.max(0, Math.min(1, Number(m[4]))) };
}
