/* Theme and branding: design tokens (colours, radii, font) edited as a draft, previewed live on this page and on
   the website, checked for contrast, published with a reason, or reset to the brand book. Tokens are the only thing
   that changes: components, layout and the 3D hero read them, so nothing here can break the structure of the site. */
import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { Alert, Button, Card, CardHead, Dialog, Field, Input, Select, Skeleton, Textarea, useApi, useToast, errorText } from '../../ui';

type Theme = { brandPrimary: string; actionPrimary: string; brandDeep: string; accentText: string; bgCanvas: string; bgBand: string; surface: string; border: string; textPrimary: string; textMuted: string; radiusSm: number; radiusMd: number; cardRadius: number; buttonRadius: number; fontSans: string };
type ThemeState = { defaults: Theme; published: Theme; draft: Theme; hasDraft: boolean; isCustom: boolean; fonts: string[]; warnings: string[]; publishedProblems: string[] };
type ColourKey = 'brandPrimary' | 'actionPrimary' | 'brandDeep' | 'accentText' | 'bgCanvas' | 'bgBand' | 'surface' | 'border' | 'textPrimary' | 'textMuted';

/* what the website draws with each one (the same list as VAR_MAP in the API's domain/theme.ts) */
const COLOURS: Array<[ColourKey, string, string]> = [
  ['brandPrimary', 'Brand primary', 'Highlights, focus rings, lines and ticks'], ['actionPrimary', 'Button fill', 'Primary buttons, under white labels'],
  ['brandDeep', 'Brand deep', 'Red text on the ivory sections'], ['accentText', 'Accent text', 'Small red text on dark, such as article categories'],
  ['bgCanvas', 'Canvas', 'The page background'], ['bgBand', 'Band', 'Alternating sections'], ['surface', 'Surface', 'Image placeholders and the tour\'s video cards'], ['border', 'Border', 'Lines between and around things; hex, or rgba() for a see-through line (the picker keeps its opacity)'],
  ['textPrimary', 'Primary text', 'Headlines and strong text; body copy stays white at 92%'], ['textMuted', 'Muted text', 'Captions, hints and meta lines'],
];
const RADII: Array<['radiusSm' | 'radiusMd' | 'cardRadius' | 'buttonRadius', string, string, number]> = [
  ['radiusSm', 'Small radius', 'Wells, inputs, badges', 24], ['radiusMd', 'Medium radius', 'Inner tiles, bubbles', 32], ['cardRadius', 'Card radius', 'Cards', 48], ['buttonRadius', 'Button radius', 'Buttons; 999 is a pill', 999],
];
const FONT_LABELS: Record<string, string> = { Montserrat: 'Montserrat (the brand face)', 'system-ui': 'System font (the brand stack\'s fallback)' };

export function Theme() {
  const t = useApi(() => api.get<ThemeState>('/admin/theme'), []);
  const toast = useToast();
  const [draft, setDraft] = useState<Theme | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<'publish' | 'reset' | 'rollback' | null>(null);
  const [reason, setReason] = useState('');
  useEffect(() => { if (t.data && !draft) setDraft(t.data.draft); }, [t.data, draft]);
  const previewVars = useMemo(() => draft ? cssVars(draft, t.data?.defaults) : {}, [draft, t.data]);
  if (t.error) return <Alert kind="error">{t.error}</Alert>;
  if (!t.data || !draft) return <Skeleton rows={8} />;
  const d = t.data;
  const set = (k: keyof Theme, v: string | number) => { setDraft({ ...draft, [k]: v } as Theme); setDirty(true); };
  const save = async () => { setBusy(true); try { const r = await api.put<{ warnings: string[] }>('/admin/theme', { tokens: draft }); setDirty(false); toast(r.warnings?.length ? 'Draft saved with contrast warnings' : 'Draft saved'); t.reload(); } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); } };
  const act = async () => { setBusy(true); try { if (dialog === 'publish') { await api.post('/admin/theme/publish', { reason }); toast('Theme published; the website uses it now'); } else if (dialog === 'rollback') { await api.post('/admin/theme/rollback', { reason }); toast('The previous theme is live again'); setDraft(null); } else { await api.post('/admin/theme/reset', { reason }); toast('Back to the brand book defaults'); setDraft(null); } setDialog(null); setReason(''); setDirty(false); t.reload(); } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); } };
  const warnings = localWarnings(draft);
  const setColour = (k: ColourKey, raw: string, input?: HTMLInputElement) => { const v = colourValue(k, raw); if (v) set(k, v); else if (input) input.value = draft[k]; };
  return <div className="stack">
    <div className="pageHead"><div><h1>Theme and branding</h1><p className="sub">Design tokens over the brand book. The preview on the right and the website preview use the saved draft; publishing is refused below WCAG AA contrast.</p></div>
      <div className="actions"><a className="bp-btn bp-btn-secondary bp-btn-sm" href="/?theme=draft" target="_blank" rel="noopener">Preview on the website</a><Button size="sm" variant="tertiary" onClick={() => setDialog('rollback')}>Roll back</Button><Button size="sm" variant="tertiary" onClick={() => setDialog('reset')}>Reset to brand defaults</Button><Button size="sm" busy={busy} disabled={!dirty} onClick={save}>Save draft</Button><Button size="sm" variant="primary" disabled={dirty || !d.hasDraft} onClick={() => setDialog('publish')}>Publish</Button></div></div>
    {d.publishedProblems.length > 0 && <Alert kind="warning" title="The live theme fails the contrast check">The website shows the brand defaults until a theme that passes is published or the theme is reset. {d.publishedProblems.join('; ')}.</Alert>}
    {d.hasDraft && !dirty && <Alert kind="info">An unpublished draft is saved. {d.isCustom ? 'A custom theme is live.' : 'The brand defaults are live.'}</Alert>}
    {warnings.length > 0 && <Alert kind="warning" title="Contrast below WCAG AA">{warnings.map((w) => <div key={w}>{w}</div>)}<div className="small" style={{ marginTop: 4 }}>Publishing is refused until these pass. Drafts can still be saved.</div></Alert>}
    <div className="grid">
      <div className="span7"><div className="stack">
        <Card><CardHead eyebrow="Colours" title="Palette" /><div className="tokenGrid">{COLOURS.map(([k, label, hint]) => { const value = <Input defaultValue={draft[k]} key={draft[k]} onBlur={(e) => setColour(k, e.target.value, e.target)} aria-label={`${label} value`} style={k === 'border' ? { flex: '1 0 100%', maxWidth: 240, marginLeft: 46, fontFamily: 'var(--bp-font-mono)' } : { width: 96, fontFamily: 'var(--bp-font-mono)' }} />; return <div key={k} className="tokenRow" style={k === 'border' ? { flexWrap: 'wrap' } : undefined}><input type="color" value={pickerHex(draft[k])} onChange={(e) => setColour(k, withAlphaOf(draft[k], e.target.value))} aria-label={label} /><div><b>{label}</b><div className="muted small">{hint}</div></div>{k !== 'border' && value}{draft[k] !== d.defaults[k] && <button type="button" className="bp-btn bp-btn-tertiary bp-btn-sm" onClick={() => set(k, d.defaults[k])}>Default</button>}{k === 'border' && value}</div>; })}</div></Card>
        <Card><CardHead eyebrow="Shape and type" title="Radii and font" /><div className="form">
          <div className="row">{RADII.map(([k, label, hint, max]) => <Field key={k} label={label} hint={`${hint}; px`}><Input type="number" min={0} max={max} value={draft[k]} onChange={(e) => set(k, Number(e.target.value))} style={{ width: 90 }} /></Field>)}</div>
          <div className="row"><Field label="Font" hint="The website loads Montserrat; the system font needs no download. Labels stay in JetBrains Mono."><Select value={draft.fontSans} onChange={(e) => set('fontSans', e.target.value)}>{d.fonts.map((f) => <option key={f} value={f}>{FONT_LABELS[f] ?? f}</option>)}</Select></Field></div>
        </div></Card>
      </div></div>
      <div className="span5"><Card><CardHead eyebrow="Live preview" title="How it reads" /><div className="themePreview" style={previewVars as React.CSSProperties}>
        <div className="tpCanvas"><span className="bp-eyebrow bp-eyebrow-accent" style={{ color: 'var(--bp-color-accent-text)' }}>Longevity coaching</span><h2>Engineer your best years.</h2><p>A coach, blood tests at home and consultations, in one package. Muted text looks like this.</p><div className="row"><button type="button" className="tpBtn">Primary action</button><button type="button" className="tpBtn tpBtnSecondary">Secondary</button></div>
          <div className="tpCard"><b>A card on a surface</b><div className="tpMuted">Body copy on the surface colour, with a border below.</div></div></div>
        <p className="muted small" style={{ marginTop: 10 }}>The portal itself keeps the brand book; the published theme applies to the website and this preview.</p>
      </div></Card></div>
    </div>
    <Dialog open={!!dialog} onClose={() => setDialog(null)} danger={dialog === 'reset'} title={dialog === 'publish' ? 'Publish this theme?' : dialog === 'rollback' ? 'Return to the previous theme?' : 'Reset to the brand book?'} footer={<><Button variant="tertiary" onClick={() => setDialog(null)}>Not yet</Button><Button variant={dialog === 'reset' ? 'destructive' : 'primary'} busy={busy} disabled={reason.trim().length < 3} onClick={act}>{dialog === 'publish' ? 'Publish' : dialog === 'rollback' ? 'Roll back' : 'Reset'}</Button></>}>
      <p className="small">{dialog === 'publish' ? 'The website picks the new tokens up on its next load. The theme that was live is kept for a roll back.' : dialog === 'rollback' ? `The theme that was live before the last publish is republished. The current one is not kept (it stays in the audit log), so this cannot be undone by another roll back.${t.data?.hasDraft ? ' The saved draft is discarded too.' : ''}` : 'Draft and published theme are removed; the brand book defaults apply at once.'}</p>
      <div style={{ marginTop: 12 }}><Field label="Reason (recorded in the audit log)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>
    </Dialog>
  </div>;
}

function cssVars(t: Theme, defaults?: Theme): Record<string, string> {
  const v: Record<string, string> = {
    '--bp-color-brand-primary': t.brandPrimary, '--bp-color-action-primary': t.actionPrimary, '--bp-color-brand-primaryDeep': t.brandDeep, '--bp-color-accent-text': t.accentText,
    '--bp-color-bg-canvas': t.bgCanvas, '--bp-color-bg-band': t.bgBand, '--bp-color-surface-default': t.surface, '--bp-color-border-default': t.border,
    '--bp-color-text-primary': t.textPrimary, '--bp-color-text-muted': t.textMuted,
    '--bp-radius-sm': `${t.radiusSm}px`, '--bp-radius-md': `${t.radiusMd}px`, '--bp-card-radius-web': `${t.cardRadius}px`, '--bp-button-radius': `${t.buttonRadius}px`,
    '--bp-font-sans': t.fontSans === 'system-ui' ? 'system-ui, -apple-system, "Segoe UI", sans-serif' : `"${t.fontSans}", system-ui, -apple-system, "Segoe UI", sans-serif`,
  };
  void defaults;
  return v;
}

/* colour inputs: hex everywhere; the border also takes rgba(), as the brand book writes it. Normalised as the server does. */
const HEX = /^#[0-9a-fA-F]{6}$/;
const RGBA = /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*((?:0|1)(?:\.0+)?|0?\.\d{1,3})\s*\)$/;
function colourValue(k: ColourKey, raw: string): string | null {
  const v = raw.trim();
  if (HEX.test(v)) return v.toUpperCase();
  const m = k === 'border' ? RGBA.exec(v) : null;
  return m && [m[1], m[2], m[3]].every((c) => Number(c) <= 255) ? `rgba(${+m[1]!},${+m[2]!},${+m[3]!},${+m[4]!})` : null;
}
/** the picker shows the colour without its opacity; picking keeps the opacity */
function pickerHex(v: string): string { const m = RGBA.exec(v); return m ? '#' + [m[1], m[2], m[3]].map((c) => Number(c).toString(16).padStart(2, '0')).join('').toUpperCase() : v; }
function withAlphaOf(current: string, picked: string): string { const m = RGBA.exec(current); if (!m) return picked; const n = parseInt(picked.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${+m[4]!})`; }

/* the same WCAG 2.x arithmetic and pairs as contrastProblems() on the server, so the warning shows while typing; the server's check is the one that counts */
function lum(hex: string): number { const c = hex.slice(1); if (c.length !== 6) return 0; const ch = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!; }
function contrast(a: string, b: string): number { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
function over(fg: string, alpha: number, bg: string): string { const ch = (h: string, i: number) => parseInt(h.slice(1 + i, 3 + i), 16); return '#' + [0, 2, 4].map((i) => Math.round(ch(fg, i) * alpha + ch(bg, i) * (1 - alpha)).toString(16).padStart(2, '0')).join('').toUpperCase(); }
const WHITE = '#FFFFFF', TEXT_SECONDARY = '#A7B0C0', SURFACE_RAISED = '#1F2B46', IVORY = '#F5F1EA', IVORY_CARD = '#FFFFFF';
function localWarnings(t: Theme): string[] {
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
