/* The administrator theme: its defaults are the brand book's tokens, each setting overrides one token the website draws
   with, values are checked before they reach CSS, and the contrast gate covers every pair the website draws on a themed
   colour at the threshold for how it is drawn. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_THEME, VAR_MAP, themeCss, themeSchema, contrastProblems, contrast, over, type Theme } from '../../src/domain/theme.js';

const TOKENS = fs.readFileSync(fileURLToPath(new URL('../../../../packages/design-system/tokens.css', import.meta.url)), 'utf8');
/** a custom property as tokens.css sets it for the default (dark) theme */
function token(name: string): string | undefined {
  const block = (selector: string) => TOKENS.split(`\n${selector} {\n`)[1]?.split('\n}\n')[0] ?? '';
  const find = (css: string) => new RegExp(`(?<![\\w-])${name.replace(/[-]/g, '\\-')}:\\s*([^;]+);`).exec(css)?.[1]?.trim();
  return find(block(':root, [data-theme="dark"]')) ?? find(block(':root'));
}
const entries = () => Object.entries(VAR_MAP) as Array<[keyof Theme, [string, (v: unknown) => string]]>;
const problems = (o: Partial<Theme>) => contrastProblems({ ...DEFAULT_THEME, ...o });

test('theme defaults are the brand book tokens the website renders, so the admin shows what is drawn', () => {
  const norm = (v: string) => v.replace(/'/g, '"').replace(/\s+/g, ' ');
  for (const [k, [name, format]] of entries()) {
    const want = token(name);
    assert.ok(want, `${name} is a brand token`);
    assert.equal(norm(format(DEFAULT_THEME[k])), norm(want), `${k} is ${name}`);
  }
  assert.equal(DEFAULT_THEME.cardRadius, 20, 'web cards: --bp-card-radius-web, not radius.lg');
  assert.equal(DEFAULT_THEME.border, 'rgba(255,255,255,0.08)');
  assert.ok(themeCss(DEFAULT_THEME).includes('no overrides'), 'the defaults write nothing');
  assert.deepEqual(contrastProblems(DEFAULT_THEME), [], 'the brand defaults pass every pair');
});

test('every setting writes the one token the website reads, and nothing the website ignores', () => {
  const changed: Theme = { brandPrimary: '#E53A2B', actionPrimary: '#B8261A', brandDeep: '#B01A0C', accentText: '#FF8A7E', bgCanvas: '#0A0F1C', bgBand: '#0D1426', surface: '#162036', border: 'rgba(255,255,255,0.12)', textPrimary: '#F8FAFC', textMuted: '#93A0B4', radiusSm: 6, radiusMd: 10, cardRadius: 24, buttonRadius: 12, fontSans: 'system-ui' };
  assert.deepEqual(Object.keys(changed).sort(), Object.keys(DEFAULT_THEME).sort());
  const css = themeCss(changed);
  for (const [k, [name, format]] of entries()) {
    assert.notEqual(changed[k], DEFAULT_THEME[k], k);
    assert.ok(css.includes(`  ${name}: ${format(changed[k])};\n`), `${k} → ${name}\n${css}`);
  }
  assert.equal(css.match(/^ {2}--/gm)?.length, entries().length, 'one token per setting');
  assert.ok(css.includes('--bp-font-sans: system-ui, -apple-system, "Segoe UI", sans-serif;'));
  for (const unread of ['--bp-radius-lg', '--bp-motion-scale', '--bp-color-bg-base', 'Inter']) assert.ok(!css.includes(unread), `${unread} is not written`);
  assert.deepEqual(contrastProblems(changed), []);
});

test('a custom brand red leaves the button fill alone; the fill is gated for its white labels at 4.5:1', () => {
  const brand = { ...DEFAULT_THEME, brandPrimary: '#F03A2A' };
  assert.ok(themeCss(brand).includes('--bp-color-brand-primary: #F03A2A'));
  assert.ok(!themeCss(brand).includes('--bp-color-action-primary'), 'the primary button keeps #D42C1E');
  assert.deepEqual(contrastProblems(brand), [], 'the brand red itself is not held to 4.5:1');
  assert.ok(contrast('#FFFFFF', DEFAULT_THEME.brandPrimary) < 4.5 && contrast('#FFFFFF', DEFAULT_THEME.actionPrimary) >= 4.5, 'which the default #EE3324 (4.09:1) would fail; #D42C1E reaches 5.03:1');
  assert.deepEqual(problems({ actionPrimary: '#F03A2A' }), ['White label on the button fill: 3.93:1, needs 4.5:1'], 'the old 3:1 gate let this through');
  assert.ok(themeCss({ ...DEFAULT_THEME, actionPrimary: '#B8261A' }).includes('--bp-color-action-primary: #B8261A'));
});

test('the contrast gate covers the pairs the website draws that the old gate skipped', () => {
  const cases: Array<[Partial<Theme>, string]> = [
    [{ bgBand: '#808080' }, 'Primary text on bands'],
    [{ bgBand: '#2E3A55' }, 'Muted text on bands'],
    [{ bgBand: '#3A4560' }, 'Secondary text on bands'],
    [{ surface: '#404B66' }, 'Secondary text on surfaces'],
    [{ bgCanvas: '#767676' }, 'Body text on the canvas'],
    [{ bgCanvas: '#1F2B46' }, 'Muted text on cards on the canvas'],
    [{ textPrimary: '#8F8F8F' }, 'Primary text on raised surfaces'],
    [{ textMuted: '#8590A6' }, 'Muted text on raised surfaces'],
    [{ accentText: '#E85040' }, 'Accent text on surfaces'],
    [{ brandDeep: '#E2301F' }, 'Deep red text on ivory sections'],
    [{ brandDeep: '#E2301F' }, 'Deep red text on ivory cards'],
    [{ brandPrimary: '#9E1A10' }, 'Brand red highlights and focus rings on the canvas'],
  ];
  for (const [o, want] of cases) {
    const p = problems(o);
    assert.ok(p.some((m) => m.startsWith(`${want}: `)), `${JSON.stringify(o)} should fail "${want}"; got: ${p.join('; ') || 'nothing'}`);
  }
  // body text is white at 92% composited over the background: it fails where full white still passes
  const grey = problems({ bgCanvas: '#767676' });
  assert.ok(!grey.some((m) => m.startsWith('Primary text on the canvas:')), grey.join('; '));
  assert.equal(over('#FFFFFF', 0.92, '#0B1120'), '#EBECED');
  // each of these passes everything the old gate checked (canvas and surfaces only)
  for (const o of [{ textMuted: '#8590A6' }, { accentText: '#E85040' }, { textPrimary: '#8F8F8F' }]) {
    const t = { ...DEFAULT_THEME, ...o };
    for (const bg of [t.bgCanvas, t.surface]) assert.ok(contrast(t.textMuted, bg) >= 4.5 && contrast(t.textPrimary, bg) >= 4.5);
    assert.ok(contrast(t.accentText, t.bgCanvas) >= 4.5);
  }
});

test('theme values are checked before they reach CSS', () => {
  const ok = (o: Record<string, unknown>) => themeSchema.safeParse({ ...DEFAULT_THEME, ...o });
  const border = ok({ border: 'rgba(255, 255, 255, .08)' });
  assert.ok(border.success && border.data.border === DEFAULT_THEME.border, 'rgba() is normalised, so the default writes no override');
  assert.ok(ok({ border: '#283553' }).success);
  const lower = ok({ brandPrimary: '#ee3324' });
  assert.ok(lower.success && lower.data.brandPrimary === '#EE3324');
  for (const bad of ['red', '#fff', 'rgba(256,0,0,0.1)', 'rgba(255,255,255,1.5)', '#283553; } body { display: none', 'rgba(255,255,255,0.08); color: red']) assert.equal(ok({ border: bad }).success, false, bad);
  assert.equal(ok({ brandPrimary: 'rgba(238,51,36,1)' }).success, false, 'only the border takes rgba()');
  assert.equal(ok({ fontSans: 'Inter' }).success, false, 'the website does not load Inter');
  assert.equal(ok({ cardRadius: 49 }).success, false);
  const { actionPrimary: _drop, ...noFill } = DEFAULT_THEME;
  assert.equal(themeSchema.safeParse(noFill).success, false, 'a draft names every setting');
  const legacy = ok({ motion: 'reduced', radiusLg: 18, bgBase: '#131D33' });
  assert.ok(legacy.success && !('motion' in legacy.data) && !('radiusLg' in legacy.data) && !('bgBase' in legacy.data), 'settings the website ignores are dropped');
});
