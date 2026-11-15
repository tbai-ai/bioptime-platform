/* M6 Workouts: a workout template, the session a programme day points at: exercises in order, each with sets, reps or a
   time, rest and notes. A coach edits their own templates (and archives or restores them); an administrator with
   library.manage edits team templates, which coaches see once published. Anything else opens read-only. */
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Link, useNavigate } from '../../lib/nav';
import { api } from '../../lib/api';
import { label } from '../../lib/format';
import { Alert, Button, Card, CardHead, Field, Input, Pill, Select, Skeleton, Table, Textarea, useApi, useToast, errorText } from '../../ui';
import { LEVELS, prescription, sourceLabel } from './shared';

type Item = { exerciseId: string; block: string; sets: string; reps: string; durationSeconds: string; restSeconds: string; loadNote: string; note: string };
const blankItem = (): Item => ({ exerciseId: '', block: '', sets: '3', reps: '', durationSeconds: '', restSeconds: '60', loadNote: '', note: '' });
const n = (s: string): number | null => (s.trim() === '' ? null : Number(s));

export function TemplateEditor({ mode }: { mode: 'coach' | 'admin' }) {
  const { id = 'new' } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const isNew = id === 'new';
  const base = mode === 'admin' ? '/admin/workout-templates' : '/coach/workout-templates';
  const existing = useApi(() => (isNew ? Promise.resolve(null) : api.get(`${base}/${id}`)), [id, mode]);
  const library = useApi(() => api.get(mode === 'admin' ? '/admin/exercises?status=published' : '/coach/exercise-library'), [mode]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [level, setLevel] = useState('');
  const [estMinutes, setEstMinutes] = useState('');
  const [items, setItems] = useState<Item[]>([blankItem()]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const t = existing.data as any;
  useEffect(() => {
    if (!t) return;
    setTitle(t.title); setDescription(t.description ?? ''); setLevel(t.level ?? ''); setEstMinutes(t.estMinutes ? String(t.estMinutes) : '');
    setItems((t.items ?? []).map((i: any) => ({ exerciseId: i.exerciseId, block: i.block ?? '', sets: String(i.sets), reps: i.reps ?? '', durationSeconds: i.durationSeconds ? String(i.durationSeconds) : '', restSeconds: i.restSeconds != null ? String(i.restSeconds) : '', loadNote: i.loadNote ?? '', note: i.note ?? '' })));
  }, [t]);

  if (!isNew && existing.error) return <Alert kind="error">{existing.error}</Alert>;
  if (!isNew && !t) return <Skeleton rows={6} />;
  const editable = isNew || (mode === 'admin' ? t.source === 'team' : t.source === 'coach');
  const exercises = (((library.data as any)?.items ?? []) as any[]);
  const exName = (eid: string) => exercises.find((e) => e.id === eid)?.name ?? t?.items?.find((i: any) => i.exerciseId === eid)?.exerciseName ?? 'Exercise';
  const setItem = (k: number, patch: Partial<Item>) => setItems((xs) => xs.map((x, i) => (i === k ? { ...x, ...patch } : x)));
  const move = (k: number, by: number) => setItems((xs) => { const out = [...xs]; const j = k + by; if (j < 0 || j >= out.length) return xs; [out[k], out[j]] = [out[j]!, out[k]!]; return out; });

  const save = async (status?: 'published' | 'archived') => {
    setBusy(true); setErr('');
    try {
      const body: any = { title, description, level: level || null, estMinutes: n(estMinutes), items: items.filter((i) => i.exerciseId).map((i) => ({ exerciseId: i.exerciseId, block: i.block, sets: Number(i.sets), reps: i.reps.trim() || null, durationSeconds: n(i.durationSeconds), restSeconds: n(i.restSeconds), loadNote: i.loadNote, note: i.note })) };
      if (status) body.status = status;
      if (isNew) { const r = await api.post(base, body); toast(mode === 'admin' ? 'Team template saved as a draft' : 'Template saved'); nav(`/workout-templates/${r.id}`, { replace: true }); }
      else { await api.patch(`${base}/${id}`, body); toast(status === 'archived' ? 'Template archived' : status === 'published' ? 'Template restored' : 'Template saved'); existing.reload(); }
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };

  return <div className="stack">
    <div className="pageHead"><div><Link className="muted" to="/exercise-library">← Exercise library</Link><h1 style={{ marginTop: 4 }}>{isNew ? (mode === 'admin' ? 'New team template' : 'New template') : t.title}</h1><p className="sub">{isNew ? 'Exercises in order, each with sets, reps or a time, and rest.' : `${sourceLabel(t.source)}${t.authorName ? ` · ${t.authorName}` : ''} · ${t.itemCount} exercise${t.itemCount === 1 ? '' : 's'}`}</p></div>
      <div className="actions">{!isNew && <Pill status={t.status} />}{editable && <Button variant="primary" busy={busy} onClick={() => save()}>Save</Button>}{editable && !isNew && mode === 'coach' && (t.status === 'archived' ? <Button busy={busy} onClick={() => save('published')}>Restore</Button> : <Button variant="tertiary" busy={busy} onClick={() => save('archived')}>Archive</Button>)}</div></div>
    {err && <Alert kind="error">{err}</Alert>}
    {mode === 'admin' && editable && <Alert kind="info">Team templates use published exercises only. Publish or archive from the library’s Templates tab; each change asks for a reason.</Alert>}
    {!editable ? <Card><CardHead eyebrow={label(t.level) || 'Template'} title="Exercises" />{t.description && <p className="small">{t.description}</p>}
      <Table label="Template exercises" head={<><th>Block</th><th>Exercise</th><th>Prescription</th><th>Notes</th></>}>{(t.items as any[]).map((i) => <tr key={i.id}><td>{i.block || '—'}</td><td>{i.exerciseName}</td><td>{prescription(i)}</td><td className="small">{[i.loadNote, i.note].filter(Boolean).join(' · ') || '—'}</td></tr>)}</Table></Card>
    : <div className="grid">
      <div className="span4"><Card><CardHead eyebrow="Template" title="Basics" /><div className="form">
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Full body, two blocks" /></Field>
        <Field label="Description" optional><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Level" optional><Select value={level} onChange={(e) => setLevel(e.target.value)}><option value="">Not set</option>{LEVELS.map((l) => <option key={l} value={l}>{label(l)}</option>)}</Select></Field>
        <Field label="Estimated minutes" optional hint="Your own estimate, shown to coaches only."><Input inputMode="numeric" value={estMinutes} onChange={(e) => setEstMinutes(e.target.value)} /></Field>
      </div></Card></div>
      <div className="span8"><Card><CardHead eyebrow="Exercises" title={`${items.filter((i) => i.exerciseId).length} in order`} right={<Button size="sm" onClick={() => setItems((xs) => [...xs, blankItem()])}>Add exercise</Button>} />
        <div className="stack">{items.map((it, k) => <div key={k} className="bp-tile"><div className="stack">
          <div className="row"><Select style={{ flex: '1 1 260px' }} aria-label="Exercise" value={it.exerciseId} onChange={(e) => setItem(k, { exerciseId: e.target.value })}><option value="">Choose an exercise</option>{it.exerciseId && !exercises.some((e) => e.id === it.exerciseId) && <option value={it.exerciseId}>{exName(it.exerciseId)}</option>}{exercises.map((e) => <option key={e.id} value={e.id}>{e.name}{e.status === 'draft' ? ' (your draft)' : ''}</option>)}</Select>
            <Input style={{ maxWidth: 140 }} aria-label="Block" placeholder="Block (e.g. Main)" value={it.block} onChange={(e) => setItem(k, { block: e.target.value })} />
            <div className="row" style={{ gap: 4 }}><Button size="sm" variant="tertiary" aria-label="Move up" disabled={k === 0} onClick={() => move(k, -1)}>↑</Button><Button size="sm" variant="tertiary" aria-label="Move down" disabled={k === items.length - 1} onClick={() => move(k, 1)}>↓</Button><Button size="sm" variant="tertiary" aria-label="Remove exercise" onClick={() => setItems((xs) => xs.filter((_, i) => i !== k))}>✕</Button></div></div>
          <div className="row">
            <Field label="Sets"><Input style={{ maxWidth: 80 }} inputMode="numeric" value={it.sets} onChange={(e) => setItem(k, { sets: e.target.value })} /></Field>
            <Field label="Reps" optional><Input style={{ maxWidth: 120 }} placeholder="8-10" value={it.reps} onChange={(e) => setItem(k, { reps: e.target.value })} /></Field>
            <Field label="Time (s)" optional><Input style={{ maxWidth: 100 }} inputMode="numeric" value={it.durationSeconds} onChange={(e) => setItem(k, { durationSeconds: e.target.value })} /></Field>
            <Field label="Rest (s)" optional><Input style={{ maxWidth: 100 }} inputMode="numeric" value={it.restSeconds} onChange={(e) => setItem(k, { restSeconds: e.target.value })} /></Field>
          </div>
          <div className="row"><Input style={{ flex: '1 1 200px' }} aria-label="Load note" placeholder="Load note (e.g. bodyweight)" value={it.loadNote} onChange={(e) => setItem(k, { loadNote: e.target.value })} /><Input style={{ flex: '1 1 200px' }} aria-label="Note" placeholder="Note for the client" value={it.note} onChange={(e) => setItem(k, { note: e.target.value })} /></div>
        </div></div>)}</div>
        <p className="muted small" style={{ marginTop: 10 }}>Give reps or a time for each exercise. Sessions already given to clients keep the version they were given.</p>
      </Card></div>
    </div>}
  </div>;
}
