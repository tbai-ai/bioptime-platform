/* Theme and branding (Admin › Theme): the token list, the colour parsing and the WCAG contrast arithmetic of the web
   page (apps/dashboard/src/pages/admin/Theme.tsx), which mirror contrastProblems() in the API's domain/theme.ts so the
   warning shows while typing; the server's check is the one that counts (publishing is refused below WCAG AA). */

export type Theme = { brandPrimary: string; actionPrimary: string; brandDeep: string; accentText: string; bgCanvas: string; bgBand: string; surface: string; border: string; textPrimary: string; textMuted: string; radiusSm: number; radiusMd: number; cardRadius: number; buttonRadius: number; fontSans: string };
export type ThemeState = { defaults: Theme; published: Theme; draft: Theme; hasDraft: boolean; isCustom: boolean; fonts: string[]; warnings: string[]; publishedProblems: string[] };
export type ColourKey = 'brandPrimary' | 'actionPrimary' | 'brandDeep' | 'accentText' | 'bgCanvas' | 'bgBand' | 'surface' | 'border' | 'textPrimary' | 'textMuted';
export type RadiusKey = 'radiusSm' | 'radiusMd' | 'cardRadius' | 'buttonRadius';

/* what the website draws with each one (the same list as VAR_MAP in the API's domain/theme.ts) */
export const COLOURS: Array<[ColourKey, string, string]> = [
  ['brandPrimary', 'Brand primary', 'Highlights, focus rings, lines and ticks'], ['actionPrimary', 'Button fill', 'Primary buttons, under white labels'],
  ['brandDeep', 'Brand deep', 'Red text on the ivory sections'], ['accentText', 'Accent text', 'Small red text on dark, such as article categories'],
  ['bgCanvas', 'Canvas', 'The page background'], ['bgBand', 'Band', 'Alternating sections'], ['surface', 'Surface', 'Image placeholders and the tour\'s video cards'], ['border', 'Border', 'Lines between and around things; hex, or rgba() for a see-through line (the picker keeps its opacity)'],
  ['textPrimary', 'Primary text', 'Headlines and strong text; body copy stays white at 92%'], ['textMuted', 'Muted text', 'Captions, hints and meta lines'],
];
export const RADII: Array<[RadiusKey, string, string, number]> = [
  ['radiusSm', 'Small radius', 'Wells, inputs, badges', 24], ['radiusMd', 'Medium radius', 'Inner tiles, bubbles', 32], ['cardRadius', 'Card radius', 'Cards', 48], ['buttonRadius', 'Button radius', 'Buttons; 999 is a pill', 999],
];
export const FONT_LABELS: Record<string, string> = { Montserrat: 'Montserrat (the brand face)', 'system-ui': 'System font (the brand stack\'s fallback)' };

/* colour inputs: hex everywhere; the border also takes rgba(), as the brand book writes it. Normalised as the server does. */
const HEX = /^#[0-9a-fA-F]{6}$/;
const RGBA = /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*((?:0|1)(?:\.0+)?|0?\.\d{1,3})\s*\)$/;
export function colourValue(k: ColourKey, raw: string): string | null {
  const v = raw.trim();
  if (HEX.test(v)) return v.toUpperCase();
  const m = k === 'border' ? RGBA.exec(v) : null;
  return m && [m[1], m[2], m[3]].every((c) => Number(c) <= 255) ? `rgba(${+m[1]!},${+m[2]!},${+m[3]!},${+m[4]!})` : null;
}
/** the swatch and the picker show the colour without its opacity; picking keeps the opacity (the web's withAlphaOf) */
export function pickerHex(v: string): string { const m = RGBA.exec(v); return m ? '#' + [m[1], m[2], m[3]].map((c) => Number(c).toString(16).padStart(2, '0')).join('').toUpperCase() : v; }
export function withAlphaOf(current: string, picked: string): string { const m = RGBA.exec(current); if (!m) return picked; const n = parseInt(picked.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${+m[4]!})`; }

/* the same WCAG 2.x arithmetic and pairs as contrastProblems() on the server */
function lum(hex: string): number { const c = hex.slice(1); if (c.length !== 6) return 0; const ch = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!; }
export function contrast(a: string, b: string): number { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
export function over(fg: string, alpha: number, bg: string): string { const ch = (h: string, i: number) => parseInt(h.slice(1 + i, 3 + i), 16); return '#' + [0, 2, 4].map((i) => Math.round(ch(fg, i) * alpha + ch(bg, i) * (1 - alpha)).toString(16).padStart(2, '0')).join('').toUpperCase(); }
const WHITE = '#FFFFFF', TEXT_SECONDARY = '#A7B0C0', SURFACE_RAISED = '#1F2B46', IVORY = '#F5F1EA', IVORY_CARD = '#FFFFFF';
export function localWarnings(t: Theme): string[] {
  const out: string[] = [];
  const need = (fg: string, bg: string, min: number, what: string) => { const r = contrast(fg, bg); if (r < min) out.push(`${what}: ${r.toFixed(2)}:1, needs ${min}:1`); };
  const card = (bg: string) => over(WHITE, 0.05, bg);
  const dark: Array<[string, string]> = [['the canvas', t.bgCanvas], ['bands', t.bgBand], ['surfaces', t.surface], ['cards on the canvas', card(t.bgCanvas)], ['cards on bands', card(t.bgBand)]];
  const text: Array<[string, (bg: string) => string]> = [
    ['Primary text', () => t.textPrimary], ['Body text', (bg) => over(WHITE, 0.92, bg)], ['Secondary text', () => TEXT_SECONDARY],
    ['Muted text', () => t.textMuted], ['Accent text', () => t.accentText],
  ];
  for (const [what, fg] of text) for (const [where, bg] of dark) need(fg(bg), bg, 4.5, `${what} on ${where}`);
  need(t.textPrimary, SURFACE_RAISED, 4.5, 'Primary text on raised surfaces');
  need(t.textMuted, SURFACE_RAISED, 4.5, 'Muted text on raised surfaces');
  need(t.brandDeep, IVORY, 4.5, 'Deep red text on ivory sections');
  need(t.brandDeep, IVORY_CARD, 4.5, 'Deep red text on ivory cards');
  need(WHITE, t.actionPrimary, 4.5, 'White label on the button fill');
  need(WHITE, t.brandPrimary, 3, 'White on the brand red');
  for (const [where, bg] of [['the canvas', t.bgCanvas], ['bands', t.bgBand], ['surfaces', t.surface], ['ivory sections', IVORY]] as const) need(t.brandPrimary, bg, 3, `Brand red highlights and focus rings on ${where}`);
  return out;
}
