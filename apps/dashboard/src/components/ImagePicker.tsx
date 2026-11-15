/* The image library for CMS image blocks: pick an uploaded image, upload a new one (PNG, JPEG or WebP, 3 MB, checked
   by content on the server), set the alternative text. Uploads are base64 JSON so no multipart dependency is needed.
   A chosen image asks for its alternative text (the field is marked and focused while it is empty); the server has the
   last word when the block is saved, and the editor shows its message. */
import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { Alert, Button, Field, Skeleton, useApi, useToast, errorText } from '../ui';

export type ImageValue = { assetId: string; alt: string; url?: string } | null;

export function ImagePicker({ value, onChange }: { value: ImageValue; onChange: (v: ImageValue) => void }) {
  const lib = useApi(() => api.get<{ items: Array<{ id: string; url: string; alt: string; filename: string; width: number | null; height: number | null; bytes: number }>; maxBytes: number }>('/admin/assets'), []);
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const altRef = useRef<HTMLInputElement>(null);
  const [ask, setAsk] = useState(0); // bumped when an image is chosen or uploaded, to move focus to its alternative text
  const items = lib.data?.items ?? [];
  const altMissing = !!value?.assetId && !value.alt.trim();
  useEffect(() => { if (ask && altMissing) altRef.current?.focus(); }, [ask]); // eslint-disable-line react-hooks/exhaustive-deps
  const choose = (v: ImageValue) => { onChange(v); setAsk((n) => n + 1); };
  const upload = async (f: File) => {
    setErr(''); setBusy(true);
    try {
      if (f.size > (lib.data?.maxBytes ?? 3 * 1024 * 1024)) throw new Error('Images are limited to 3 MB; export a smaller or compressed file.');
      const buf = await f.arrayBuffer();
      let bin = ''; const bytes = new Uint8Array(buf); for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      // a new image never inherits the previous selection's alt text: the editor describes this image
      const r = await api.post<{ id: string; url: string; alt: string }>('/admin/assets', { filename: f.name, dataBase64: btoa(bin), alt: '' });
      toast('Image added to the library'); lib.reload(); choose({ assetId: r.id, alt: r.alt ?? '', url: r.url });
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); if (file.current) file.current.value = ''; }
  };
  return <div className="imagePicker">
    {value?.assetId && <div className="imageCurrent"><img src={value.url ?? items.find((a) => a.id === value.assetId)?.url ?? ''} alt={value.alt} /><div className="form" style={{ flex: 1 }}><Field label="Alternative text" hint="What the image shows, for people who cannot see it." error={altMissing ? 'Describe what the image shows: people who cannot see it hear this text instead.' : undefined}><input ref={altRef} className="bp-input bp-input-dense" value={value.alt} maxLength={200} required aria-required="true" aria-invalid={altMissing || undefined} onChange={(e) => onChange({ ...value, alt: e.target.value })} /></Field><div><Button size="sm" variant="tertiary" onClick={() => onChange(null)}>Use the built-in image</Button></div></div></div>}
    <div className="row" style={{ marginTop: 8 }}><input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} /><Button size="sm" busy={busy} onClick={() => file.current?.click()}>Upload an image</Button><span className="muted small">PNG, JPEG or WebP, up to 3 MB. SVG is not accepted.</span></div>
    {err && <Alert kind="error">{err}</Alert>}
    {lib.error && <Alert kind="error">{lib.error}</Alert>}
    {!lib.data ? <Skeleton rows={1} /> : items.length ? <div className="imageGrid">{items.map((a) => <button key={a.id} type="button" className={`imageTile ${value?.assetId === a.id ? 'selected' : ''}`} onClick={() => choose({ assetId: a.id, alt: value?.assetId === a.id ? value.alt : a.alt ?? '', url: a.url })} aria-pressed={value?.assetId === a.id}><img src={a.url} alt={a.alt || a.filename} loading="lazy" /><span className="small">{a.filename}{a.width ? ` · ${a.width}×${a.height}` : ''}</span></button>)}</div> : <p className="muted small">The library is empty; upload the first image.</p>}
  </div>;
}
