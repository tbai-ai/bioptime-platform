/* Website content: every editable block, grouped by page and section, with a draft/published/default state per block,
   a draft preview of the real website (?cms=draft), and a publish step that asks for a reason. Values are validated and
   sanitised by the server (rich text keeps a small allowlist; no scripts, no inline handlers, no javascript: links). */
import React, { useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDateTime } from '../../lib/format';
import { Alert, Button, Card, CardHead, Dialog, Field, Input, Pill, ReasonDialog, Skeleton, Tabs, Textarea, useApi, useToast, errorText } from '../../ui';
import { ImagePicker } from '../../components/ImagePicker';

type Block = { key: string; type: 'text' | 'richtext' | 'url' | 'boolean' | 'faq' | 'image'; label: string; section: string; page: string; max: number | null; default: unknown; published: unknown; publishedAt: string | null; publishedBy: string | null; draft: unknown; draftUpdatedAt: string | null; draftBy: string | null };

/* An image block needs alternative text before it is saved or published: the same rule and the same words as the API's
   CONTENT_ALT_REQUIRED (apps/api domain/content.ts), checked here too so the editor refuses it whichever side is
   deployed first. The server stays the authority. */
const altRequired = (blockLabel: string) => `${blockLabel.replace(/\s*\(empty[^)]*\)\s*$/, '')}: describe the image in the alternative text (what it shows, for people who cannot see it) before saving or publishing.`;
const imageWithoutAlt = (type: Block['type'], v: unknown) => type === 'image' && !!v && typeof v === 'object' && !!(v as { assetId?: unknown }).assetId && !String((v as { alt?: unknown }).alt ?? '').trim();

export function Content() {
  const { can } = useAuth();
  const canPublish = can('content.publish'); // POST /admin/content/publish needs it (apps/api/src/http/routes/cms.ts); drafts need only content.manage
  const list = useApi(() => api.get<{ items: Block[]; previewUrl: string }>('/admin/content'), []);
  const toast = useToast();
  const [page, setPage] = useState<string>('');
  const [publishing, setPublishing] = useState(false);
  const [reason, setReason] = useState('');
  const [publishErr, setPublishErr] = useState('');
  const items = list.data?.items ?? [];
  const pages = useMemo(() => Array.from(new Set(items.map((b) => b.page))), [items]);
  const current = page || pages[0] || '';
  const drafts = items.filter((b) => b.draft !== null);
  const sections = useMemo(() => { const m = new Map<string, Block[]>(); for (const b of items.filter((x) => x.page === current)) m.set(b.section, [...(m.get(b.section) ?? []), b]); return Array.from(m.entries()); }, [items, current]);
  // a refusal (a block the server will not publish, such as an image without alternative text) stays in the dialog, in the server's words
  const publish = async () => {
    setPublishErr('');
    const noAlt = drafts.find((d) => imageWithoutAlt(d.type, d.draft));
    if (noAlt) { setPublishErr(altRequired(noAlt.label)); return; }
    try { await api.post('/admin/content/publish', { reason }); toast(`Published ${drafts.length} block${drafts.length === 1 ? '' : 's'}; the website shows them now`); setPublishing(false); setReason(''); list.reload(); } catch (e) { setPublishErr(errorText(e)); } };
  if (list.error) return <Alert kind="error">{list.error}</Alert>;
  if (!list.data) return <Skeleton rows={8} />;
  return <div className="stack">
    <div className="pageHead"><div><h1>Website content</h1><p className="sub">Headlines, copy, calls to action, navigation labels, the announcement bar, questions and answers, SEO titles. Save drafts, preview them on the real site, then publish with a reason.</p></div>
      <div className="actions"><a className="bp-btn bp-btn-secondary bp-btn-sm" href={list.data.previewUrl} target="_blank" rel="noopener">Preview drafts on the website</a>{canPublish ? <Button variant="primary" size="sm" disabled={!drafts.length} onClick={() => { setPublishErr(''); setPublishing(true); }}>Publish {drafts.length ? `${drafts.length} draft${drafts.length === 1 ? '' : 's'}` : ''}</Button> : <span className="muted small">Publishing needs the “Publish website content” permission; an administrator who holds it publishes the drafts.</span>}</div></div>
    <Alert kind="info" title="What this cannot do">Text fields never accept code. Rich text keeps paragraphs, bold, italics, lists, small headings and links to https or the site itself; anything else is stripped on save. Layout and the 3D hero are code, changed by a developer; the pictures listed under Images can be swapped here.</Alert>
    <Tabs items={pages.map((p) => ({ id: p, label: p, count: items.filter((b) => b.page === p && b.draft !== null).length }))} value={current} onChange={setPage}>
    {sections.map(([section, blocks]) => <Card key={section}><CardHead eyebrow={current} title={section} /><div className="stack">{blocks.map((b) => <BlockEditor key={b.key} block={b} onChange={() => list.reload()} />)}</div></Card>)}
    </Tabs>
    {canPublish && <Dialog open={publishing} onClose={() => setPublishing(false)} title="Publish the drafts?" footer={<><Button variant="tertiary" onClick={() => setPublishing(false)}>Not yet</Button><Button variant="primary" disabled={reason.trim().length < 3} onClick={publish}>Publish to the website</Button></>}>
      <p className="small">{drafts.length} {drafts.length === 1 ? 'block goes' : 'blocks go'} live at once: {drafts.map((d) => d.label).join(', ')}.</p>
      <div style={{ marginTop: 12 }}><Field label="Reason (recorded in the audit log)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this change, in a few words" /></Field></div>
      {publishErr && <Alert kind="error">{publishErr}</Alert>}
    </Dialog>}
  </div>;
}

function BlockEditor({ block, onChange }: { block: Block; onChange: () => void }) {
  const toast = useToast();
  const effective = block.draft ?? block.published ?? block.default;
  const [value, setValue] = useState<unknown>(effective);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const state = block.draft !== null ? 'draft' : block.published !== null ? 'published' : 'default';
  const save = async () => {
    if (imageWithoutAlt(block.type, value)) { setErr(altRequired(block.label)); return; } // never sent without alternative text
    setBusy(true); setErr(''); try { await api.put(`/admin/content/${encodeURIComponent(block.key)}`, { value }); toast('Draft saved'); setEditing(false); onChange(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); } };
  const discard = async () => { try { await api.del(`/admin/content/${encodeURIComponent(block.key)}/draft`); toast('Draft discarded'); setValue(block.published ?? block.default); setEditing(false); onChange(); } catch (e) { toast(errorText(e), 'error'); } };
  const [resetting, setResetting] = useState(false);
  const summary = block.type === 'boolean' ? (effective ? 'On' : 'Off') : block.type === 'image' ? (effective && typeof effective === 'object' ? `Library image · ${(effective as any).alt || 'no alt text'}` : 'Built-in image') : block.type === 'faq' ? `${(Array.isArray(effective) && effective.length) || 'built-in'} entries` : String(effective ?? '').replace(/<[^>]+>/g, '').slice(0, 140) || '(empty)';
  return <div className="cmsBlock">
    <div className="row between" style={{ alignItems: 'flex-start' }}>
      <div style={{ flex: '1 1 320px', minWidth: 0 }}><b style={{ color: 'var(--bp-color-text-primary)' }}>{block.label}</b> <code className="muted small">{block.key}</code>{!editing && <div className="small" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{block.type === 'image' && effective && typeof effective === 'object' && (effective as any).url ? <img className="cmsThumb" src={(effective as any).url} alt={(effective as any).alt ?? ''} /> : null}{summary}</div>}
        <div className="muted small">{state === 'draft' ? `Draft by ${block.draftBy ?? '?'} ${block.draftUpdatedAt ? fmtDateTime(block.draftUpdatedAt) : ''}` : state === 'published' ? `Published by ${block.publishedBy ?? '?'} ${block.publishedAt ? fmtDateTime(block.publishedAt) : ''}` : 'Built-in default'}{block.max ? ` · up to ${block.max} characters` : ''}</div></div>
      <div className="row" style={{ gap: 6 }}><Pill status={state === 'draft' ? 'draft' : state === 'published' ? 'active' : 'pending'}>{state}</Pill>{!editing && <Button size="sm" onClick={() => { setValue(effective); setEditing(true); }}>Edit</Button>}{state === 'draft' && !editing && <Button size="sm" variant="tertiary" onClick={discard}>Discard draft</Button>}{state !== 'default' && !editing && <Button size="sm" variant="tertiary" onClick={() => setResetting(true)}>Reset</Button>}</div>
    <ReasonDialog open={resetting} onClose={() => setResetting(false)} title={`Return “${block.label}” to its built-in copy?`} confirmLabel="Reset" body="The draft and the published value are removed; the website shows the built-in copy at once." onConfirm={async (reason) => { await api.post(`/admin/content/${encodeURIComponent(block.key)}/reset`, { reason }); toast('Back to the built-in copy'); setValue(block.default); setEditing(false); onChange(); }} />
    </div>
    {editing && <div className="form" style={{ marginTop: 10 }}>
      {block.type === 'text' && (block.max && block.max > 160 ? <Textarea value={String(value ?? '')} maxLength={block.max ?? undefined} onChange={(e) => setValue(e.target.value)} /> : <Input value={String(value ?? '')} maxLength={block.max ?? undefined} onChange={(e) => setValue(e.target.value)} />)}
      {block.type === 'url' && <Input value={String(value ?? '')} onChange={(e) => setValue(e.target.value)} placeholder="/packages or https://…" />}
      {block.type === 'richtext' && <><Textarea value={String(value ?? '')} maxLength={block.max ?? undefined} onChange={(e) => setValue(e.target.value)} style={{ minHeight: 140, fontFamily: 'var(--bp-font-mono)', fontSize: 12.5 }} /><div className="muted small">Allowed: &lt;p&gt; &lt;br&gt; &lt;strong&gt; &lt;em&gt; &lt;ul&gt; &lt;ol&gt; &lt;li&gt; &lt;h3&gt; &lt;a href="https://… or /…"&gt;. Everything else is removed when saved.</div><div className="cmsPreview" dangerouslySetInnerHTML={{ __html: previewHtml(String(value ?? '')) }} /></>}
      {block.type === 'boolean' && <label className="bp-switch"><input type="checkbox" role="switch" checked={!!value} onChange={(e) => setValue(e.target.checked)} aria-label={block.label} /><span className="bp-switch-track" /> {value ? 'On' : 'Off'}</label>}
      {block.type === 'faq' && <FaqEditor value={Array.isArray(value) ? (value as any[]) : []} onChange={setValue} />}
      {block.type === 'image' && <ImagePicker value={value && typeof value === 'object' ? (value as any) : null} onChange={setValue} />}
      {err && <Alert kind="error">{err}</Alert>}
      <div className="row"><Button variant="primary" size="sm" busy={busy} onClick={save}>Save draft</Button><Button size="sm" variant="tertiary" onClick={() => { setEditing(false); setValue(effective); }}>Cancel</Button></div>
    </div>}
  </div>;
}

/** The live preview: a DOM walk with the server's allowlist, so pasted copy can never run in the administrator's browser.
    Disallowed elements are unwrapped (their text stays), every attribute is dropped except a checked href, and the
    server's sanitiser remains the authority on save. */
function previewHtml(html: string): string {
  const ALLOWED = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'UL', 'OL', 'LI', 'H3', 'A']);
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  for (const el of Array.from(tpl.content.querySelectorAll('*'))) {
    if (!ALLOWED.has(el.tagName)) { el.replaceWith(...Array.from(el.childNodes)); continue; }
    for (const a of Array.from(el.attributes)) if (!(el.tagName === 'A' && a.name === 'href')) el.removeAttribute(a.name);
    if (el.tagName === 'A') {
      const h = (el.getAttribute('href') ?? '').trim();
      if (/^https:\/\//i.test(h) || (/^\/(?![/\\])/.test(h) && !/[\s"'<>\\]/.test(h)) || /^[\w./-]+\.html(#[\w-]*)?$/.test(h) || /^#[\w-]+$/.test(h)) { el.setAttribute('href', h); if (/^https:/i.test(h)) el.setAttribute('rel', 'noopener'); } else el.removeAttribute('href');
    }
  }
  return tpl.innerHTML;
}

function FaqEditor({ value, onChange }: { value: Array<{ q: string; a: string }>; onChange: (v: unknown) => void }) {
  const set = (i: number, k: 'q' | 'a', v: string) => onChange(value.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return <div className="stack">
    {value.map((item, i) => <div key={i} className="bp-card" style={{ padding: 12 }}><div className="form"><Field label={`Question ${i + 1}`}><Input value={item.q} maxLength={200} onChange={(e) => set(i, 'q', e.target.value)} /></Field><Field label="Answer" hint="Text; <strong>, <em>, lists and links to https or this site are kept, everything else is stripped."><Textarea value={item.a} maxLength={1200} onChange={(e) => set(i, 'a', e.target.value)} /></Field><div className="row"><Button size="sm" variant="tertiary" disabled={i === 0} onClick={() => { const v = [...value]; [v[i - 1], v[i]] = [v[i]!, v[i - 1]!]; onChange(v); }}>Up</Button><Button size="sm" variant="tertiary" disabled={i === value.length - 1} onClick={() => { const v = [...value]; [v[i + 1], v[i]] = [v[i]!, v[i + 1]!]; onChange(v); }}>Down</Button><Button size="sm" variant="destructive" onClick={() => onChange(value.filter((_, j) => j !== i))}>Remove</Button></div></div></div>)}
    <div><Button size="sm" onClick={() => onChange([...value, { q: '', a: '' }])}>Add a question</Button> <span className="muted small">Empty list: the website shows its built-in questions.</span></div>
  </div>;
}
