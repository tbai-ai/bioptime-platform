/* Theme tokens an administrator may change: colours, radii and the typeface, as structured values that become CSS
   custom properties on top of the brand book's tokens. Never raw CSS or code. Every setting overrides a token the
   website draws with (its css/style.css, pages.css, hero3d.css, tour3d.css); the brand book's other tokens stay as they
   are. A draft is previewed; publishing is refused when anything the website draws on a themed colour would fall below
   WCAG AA contrast. */
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { j } from '../db/db.js';
import { errors } from '../lib/errors.js';
import { audit } from './audit.js';

const HEX = /^#[0-9a-fA-F]{6}$/;
const RGBA = /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*((?:0|1)(?:\.0+)?|0?\.\d{1,3})\s*\)$/;
const hex = z.string().regex(HEX, 'Use a six-digit hex colour like #EE3324').transform((v) => v.toUpperCase());
/** Hairlines: a hex colour, or a colour at an opacity as the brand book writes border.default, rgba(255,255,255,0.08). */
const hairline = z.string().trim()
  .refine((v) => HEX.test(v) || !!RGBA.exec(v)?.slice(1, 4).every((c) => Number(c) <= 255), 'Use a hex colour like #283553 or rgba(255,255,255,0.08)')
  .transform((v) => { const m = RGBA.exec(v); return m ? `rgba(${+m[1]!},${+m[2]!},${+m[3]!},${+m[4]!})` : v.toUpperCase(); });
/** Faces the website draws: Montserrat, which it loads, and the system fallback of the brand's font stack. */
export const APPROVED_FONTS = ['Montserrat', 'system-ui'] as const;

export const themeSchema = z.object({
  brandPrimary: hex, actionPrimary: hex, brandDeep: hex, accentText: hex,
  bgCanvas: hex, bgBand: hex, surface: hex, border: hairline,
  textPrimary: hex, textMuted: hex,
  radiusSm: z.number().int().min(0).max(24), radiusMd: z.number().int().min(0).max(32), cardRadius: z.number().int().min(0).max(48), buttonRadius: z.number().int().min(0).max(999),
  fontSans: z.enum(APPROVED_FONTS),
});
export type Theme = z.infer<typeof themeSchema>;

/** The brand book's dark theme, token for token (brand/book/tokens.json v2.2.0; the tests compare it with
    packages/design-system/tokens.css). */
export const DEFAULT_THEME: Theme = {
  brandPrimary: '#EE3324', actionPrimary: '#D42C1E', brandDeep: '#C41C0D', accentText: '#FF7366',
  bgCanvas: '#0B1120', bgBand: '#0F172A', surface: '#182239', border: 'rgba(255,255,255,0.08)',
  textPrimary: '#FFFFFF', textMuted: '#8A95AA',
  radiusSm: 8, radiusMd: 12, cardRadius: 20, buttonRadius: 999,
  fontSans: 'Montserrat',
};

const px = (n: number) => `${n}px`;
const fontStack = (f: Theme['fontSans']) => f === 'system-ui' ? 'system-ui, -apple-system, "Segoe UI", sans-serif' : `"${f}", system-ui, -apple-system, "Segoe UI", sans-serif`;
/** Each setting, the one token it overrides and, in the comment, what the website draws with that token. */
export const VAR_MAP: { [K in keyof Theme]: [string, (v: Theme[K]) => string] } = {
  brandPrimary: ['--bp-color-brand-primary', String],        // highlighted headline words, focus rings, lines, ticks, the announcement bar
  actionPrimary: ['--bp-color-action-primary', String],      // primary button and skip-link fill, white 14–16 px labels
  brandDeep: ['--bp-color-brand-primaryDeep', String],       // red text on ivory sections (article categories, field errors)
  accentText: ['--bp-color-accent-text', String],            // small red text on dark (article categories)
  bgCanvas: ['--bp-color-bg-canvas', String],                // the page background
  bgBand: ['--bp-color-bg-band', String],                    // alternating sections, the tour, the final call to action
  surface: ['--bp-color-surface-default', String],           // image placeholders, tour video cards, the article figure
  border: ['--bp-color-border-default', String],             // hairlines between and around things
  textPrimary: ['--bp-color-text-primary', String],          // headlines and strong text
  textMuted: ['--bp-color-text-muted', String],              // captions, hints, meta lines
  radiusSm: ['--bp-radius-sm', px],                          // wells, inputs and badges
  radiusMd: ['--bp-radius-md', px],                          // inner tiles and bubbles
  cardRadius: ['--bp-card-radius-web', px],                  // cards
  buttonRadius: ['--bp-button-radius', px],                  // buttons (.btn)
  fontSans: ['--bp-font-sans', fontStack],                   // all text but the mono labels
};

export function themeCss(t: Theme): string {
  const lines: string[] = [];
  for (const k of Object.keys(VAR_MAP) as Array<keyof Theme>) {
    if (t[k] === DEFAULT_THEME[k]) continue;
    const [name, format] = VAR_MAP[k] as [string, (v: unknown) => string];
    lines.push(`  ${name}: ${format(t[k])};`);
  }
  const head = `/* Bioptime theme overrides, generated from the administrator's published theme; the brand book's tokens.css stays the base. */\n`;
  if (!lines.length) return head + '/* no overrides: the brand defaults apply */\n';
  return `${head}:root, [data-theme="dark"] {\n${lines.join('\n')}\n}\n`;
}

/* ---------- contrast (WCAG 2.x relative luminance) ---------- */
function lum(hexColour: string): number {
  const c = hexColour.slice(1);
  const ch = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}
export function contrast(a: string, b: string): number { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
/** fg at an opacity over bg, composited the way the browser paints it (8-bit channels). */
export function over(fg: string, alpha: number, bg: string): string {
  const ch = (h: string, i: number) => parseInt(h.slice(1 + i, 3 + i), 16);
  return '#' + [0, 2, 4].map((i) => Math.round(ch(fg, i) * alpha + ch(bg, i) * (1 - alpha)).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/* What the website draws over the themed colours without the theme changing it (tokens.css, style.css). */
const WHITE = '#FFFFFF';              // text.body's base, action.primaryText, text.onAccent
const TEXT_SECONDARY = '#A7B0C0';     // text.secondary
const SURFACE_RAISED = '#1F2B46';     // surface.raised: chat bubbles, phone cards
const IVORY = '#F5F1EA';              // ivory.200: the ivory sections
const IVORY_CARD = '#FFFFFF';         // ivory.50: cards on ivory

/** Every pair the website draws on a themed colour, at the WCAG AA threshold for how it is drawn: 4.5:1 for text (the
    button and skip-link labels are 14–16 px at weight 600, under the large-text size), 3:1 for large text, focus rings
    and marks. The brand defaults pass every pair. */
export function contrastProblems(t: Theme): string[] {
  const out: string[] = [];
  const need = (fg: string, bg: string, min: number, what: string) => { const r = contrast(fg, bg); if (r < min) out.push(`${what}: ${r.toFixed(2)}:1, needs ${min}:1`); };
  const card = (bg: string) => over(WHITE, 0.05, bg); // cards paint a 5% white wash over their section (style.css --surface)
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

/* ---------- storage: two settings rows ---------- */
/** A stored theme, setting by setting: a setting saved before it existed (the button fill, the card radius) or in a form
    no longer offered (the Inter face, the motion switch, the large radius, the base colour) takes the brand default. */
function read(ctx: Ctx, key: 'theme.draft' | 'theme.published' | 'theme.previous'): Theme | null {
  const row = ctx.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  if (!row) return null;
  const stored = j.out<unknown>(row.value, null);
  if (!stored || typeof stored !== 'object') return null;
  const t: Record<string, unknown> = { ...DEFAULT_THEME };
  for (const [k, field] of Object.entries(themeSchema.shape)) { const v = field.safeParse((stored as Record<string, unknown>)[k]); if (v.success) t[k] = v.data; }
  return t as Theme;
}
function write(ctx: Ctx, key: 'theme.draft' | 'theme.published' | 'theme.previous', t: Theme | null): void {
  if (!t) { ctx.db.run('DELETE FROM settings WHERE key = ?', [key]); return; }
  ctx.db.run('INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by', [key, j.in(t), ctx.now(), ctx.actor?.id ?? null]);
}

export function getTheme(ctx: Ctx) {
  const published = read(ctx, 'theme.published');
  const draft = read(ctx, 'theme.draft');
  return { defaults: DEFAULT_THEME, published: published ?? DEFAULT_THEME, draft: draft ?? published ?? DEFAULT_THEME, hasDraft: !!draft, isCustom: !!published, fonts: APPROVED_FONTS, warnings: contrastProblems(draft ?? published ?? DEFAULT_THEME), publishedProblems: published ? contrastProblems(published) : [] };
}
/** What the website loads. A theme published before the contrast check covered every pair, and failing it now, is not
    served: the brand defaults apply until a theme that passes is published (the admin page says so). */
export function publishedThemeCss(ctx: Ctx): string {
  const published = read(ctx, 'theme.published');
  if (published && contrastProblems(published).length) return themeCss(DEFAULT_THEME) + '/* the published theme fails the contrast check, so the brand defaults apply */\n';
  return themeCss(published ?? DEFAULT_THEME);
}
export function draftThemeCss(ctx: Ctx): string { return themeCss(read(ctx, 'theme.draft') ?? read(ctx, 'theme.published') ?? DEFAULT_THEME); }

export function saveThemeDraft(ctx: Ctx, input: unknown, reason?: string) {
  const parsed = themeSchema.safeParse(input);
  if (!parsed.success) throw errors.validation(parsed.error.issues, 'Check the theme values');
  write(ctx, 'theme.draft', parsed.data);
  audit(ctx, 'theme.draft', { type: 'setting', id: 'theme' }, reason ?? null, { warnings: contrastProblems(parsed.data) });
  return getTheme(ctx);
}
export function publishTheme(ctx: Ctx, reason: string) {
  const draft = read(ctx, 'theme.draft');
  if (!draft) throw errors.state('There is no theme draft to publish', { code: 'NO_DRAFT' });
  const problems = contrastProblems(draft);
  if (problems.length) throw errors.state('The draft does not reach WCAG AA contrast; fix these before publishing', { code: 'CONTRAST', problems });
  const previous = read(ctx, 'theme.published');
  ctx.db.tx(() => { write(ctx, 'theme.previous', previous ?? DEFAULT_THEME); write(ctx, 'theme.published', draft); write(ctx, 'theme.draft', null); });
  audit(ctx, 'theme.publish', { type: 'setting', id: 'theme' }, reason, { previous, published: draft });
  return getTheme(ctx);
}
/** Republish the theme that was live before the last publish (the brand defaults when there was none). */
export function rollbackTheme(ctx: Ctx, reason: string) {
  const previous = read(ctx, 'theme.previous');
  if (!previous) throw errors.state('There is no earlier theme to return to', { code: 'NO_PREVIOUS' });
  const problems = contrastProblems(previous);
  if (problems.length) throw errors.state('The earlier theme does not reach WCAG AA contrast, so it cannot be republished', { code: 'CONTRAST', problems });
  const current = read(ctx, 'theme.published');
  // one way: the theme rolled back from survives only in the audit event, so a second call cannot re-apply it
  ctx.db.tx(() => { write(ctx, 'theme.previous', null); write(ctx, 'theme.published', previous); write(ctx, 'theme.draft', null); });
  audit(ctx, 'theme.rollback', { type: 'setting', id: 'theme' }, reason, { from: current, to: previous });
  return getTheme(ctx);
}
export function resetTheme(ctx: Ctx, reason: string) {
  const previous = read(ctx, 'theme.published');
  ctx.db.tx(() => { write(ctx, 'theme.published', null); write(ctx, 'theme.previous', null); write(ctx, 'theme.draft', null); });
  audit(ctx, 'theme.reset', { type: 'setting', id: 'theme' }, reason, { previous });
  return getTheme(ctx);
}
