/* The administrator theme over HTTP: the button fill is its own setting, publishing is refused on any pair the website
   draws below WCAG AA, a theme stored before the current settings existed is read setting by setting, and a published
   theme that fails the current check is neither served nor rolled back to. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, DEMO, DEMO_PASSWORDS, DEMO_MFA_SECRET } from '../helpers.js';
import { totpCode } from '../../src/lib/crypto.js';

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); h.db.close(); });

type R = { json: { error?: { code: string; details?: unknown } } };
const stateCode = (r: R) => (r.json.error?.details as { code?: string } | undefined)?.code ?? r.json.error?.code;
const stateProblems = (r: R) => (r.json.error?.details as { problems?: string[] } | undefined)?.problems ?? [];
async function admin() {
  const c = client(h.app);
  const r = await c.post('/api/auth/login', { email: DEMO.admin, password: DEMO_PASSWORDS.admin, workspace: 'admin', mfaCode: totpCode(DEMO_MFA_SECRET) });
  assert.equal(r.status, 200);
  return c;
}
const store = (key: string, value: unknown) => h.db.run('INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, NULL) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(value), new Date().toISOString()]);

test('theme: the button fill is its own setting; publishing is refused on a fill under 4.5:1 and on pairs the old gate skipped', async () => {
  const a = await admin(), anon = client(h.app);
  const t = await a.get('/api/admin/theme');
  const defaults = t.json.defaults as Record<string, unknown>;
  assert.equal(defaults.actionPrimary, '#D42C1E');
  assert.equal(defaults.cardRadius, 20);
  assert.equal(defaults.border, 'rgba(255,255,255,0.08)');
  assert.ok(!('motion' in defaults) && !('radiusLg' in defaults) && !('bgBase' in defaults));
  assert.deepEqual(t.json.fonts, ['Montserrat', 'system-ui']);

  assert.deepEqual((await a.put('/api/admin/theme', { tokens: { ...defaults, brandPrimary: '#F03A2A' } })).json.warnings, []);
  assert.equal((await a.post('/api/admin/theme/publish', { reason: 'test: brand red only' })).status, 200);
  const css = (await anon.get('/api/public/theme.css')).text;
  assert.ok(css.includes('--bp-color-brand-primary: #F03A2A') && !css.includes('--bp-color-action-primary'), css);

  const fill = await a.put('/api/admin/theme', { tokens: { ...defaults, actionPrimary: '#F03A2A' } });
  assert.deepEqual(fill.json.warnings, ['White label on the button fill: 3.93:1, needs 4.5:1']);
  const refused = await a.post('/api/admin/theme/publish', { reason: 'test: fill too light' });
  assert.equal(stateCode(refused), 'CONTRAST');
  assert.deepEqual(stateProblems(refused), ['White label on the button fill: 3.93:1, needs 4.5:1']);

  assert.equal((await a.put('/api/admin/theme', { tokens: { ...defaults, bgBand: '#2E3A55' } })).status, 200);
  const band = await a.post('/api/admin/theme/publish', { reason: 'test: muted text on bands' });
  assert.equal(stateCode(band), 'CONTRAST');
  assert.ok(stateProblems(band).some((p) => p.startsWith('Muted text on bands:')));
  assert.ok(!(await anon.get('/api/public/theme.css')).text.includes('#2E3A55'));
  assert.equal((await a.post('/api/admin/theme/reset', { reason: 'test: reset' })).status, 200);
});

test('theme: a stored theme from before the button fill and card radius is read setting by setting; one failing the current check is not served or rolled back to', async () => {
  const a = await admin(), anon = client(h.app);
  const legacy = { brandPrimary: '#D12A1C', brandDeep: '#C41C0D', accentText: '#FF7366', bgCanvas: '#0B1120', bgBand: '#0F172A', bgBase: '#131D33', surface: '#182239', border: '#283553', textPrimary: '#FFFFFF', textMuted: '#8A95AA', radiusSm: 8, radiusMd: 6, radiusLg: 18, buttonRadius: 999, fontSans: 'Inter', motion: 'reduced' };
  store('theme.published', legacy);
  const t = await a.get('/api/admin/theme');
  const published = t.json.published as Record<string, unknown>;
  assert.equal(published.actionPrimary, '#D42C1E', 'the button fill starts at the brand value, not the old brand red');
  assert.equal(published.radiusMd, 6, 'settings that still exist are kept');
  assert.equal(published.cardRadius, 20);
  assert.equal(published.fontSans, 'Montserrat', 'Inter is no longer offered');
  assert.ok(!('motion' in published) && !('radiusLg' in published) && !('bgBase' in published));
  assert.deepEqual(t.json.publishedProblems, []);
  const css = (await anon.get('/api/public/theme.css')).text;
  assert.ok(css.includes('--bp-color-brand-primary: #D12A1C') && css.includes('--bp-radius-md: 6px') && css.includes('--bp-color-border-default: #283553'), css);
  assert.ok(!/action-primary|motion|Inter|radius-lg|bg-base/.test(css), css);

  // published under the old gate, which checked only the canvas and surfaces: muted text on bands is 3.76:1
  const failing = { ...legacy, bgBand: '#2E3A55' };
  store('theme.published', failing);
  const live = await a.get('/api/admin/theme');
  assert.ok((live.json.publishedProblems as string[]).some((p) => p.startsWith('Muted text on bands:')));
  const served = (await anon.get('/api/public/theme.css')).text;
  assert.ok(served.includes('fails the contrast check') && !served.includes('#2E3A55') && !served.includes(':root'), served);

  store('theme.published', { ...legacy, brandPrimary: '#E02A1A' });
  store('theme.previous', failing);
  const back = await a.post('/api/admin/theme/rollback', { reason: 'test: back to a theme that fails' });
  assert.equal(stateCode(back), 'CONTRAST');
  assert.ok((await anon.get('/api/public/theme.css')).text.includes('#E02A1A'), 'the live theme stays');
  assert.equal((await a.post('/api/admin/theme/reset', { reason: 'test: reset' })).status, 200);
});
