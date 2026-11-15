/* M6 Workouts: the exercise library and the workout templates.
   - Coach workspace: published exercises and their own proposals (drafts an administrator reviews); published team
     templates and their own templates.
   - Admin workspace (library.manage): every exercise and template, with publish, return to draft and archive (each with
     a reason), and team templates.
   Exercises are text only: demonstration media stays "pending configuration" until it is licensed and a video host
   exists. */
import React, { useState } from 'react';
import { Link, useNavigate } from '../../lib/nav';
import { api, qs } from '../../lib/api';
import { fmtDate, label } from '../../lib/format';
import { Alert, Button, Card, CardHead, Dialog, Empty, Field, Input, Pill, ReasonDialog, Select, Skeleton, Table, Tabs, Textarea, useApi, useToast, errorText } from '../../ui';
import { CATEGORIES, sourceLabel } from './shared';

type Mode = 'coach' | 'admin';

export function ExerciseLibrary({ mode }: { mode: Mode }) {
  const [tab, setTab] = useState<'exercises' | 'templates'>('exercises');
  return <div className="stack">
    <div className="pageHead"><div><h1>Exercise library</h1><p className="sub">{mode === 'admin' ? 'The exercises and team templates coaches build programmes from. Coach proposals wait here for review.' : 'Exercises and templates to build your clients’ workout programmes from. Propose an exercise and the Bioptime team reviews it.'}</p></div></div>
    <Tabs items={[{ id: 'exercises', label: 'Exercises' }, { id: 'templates', label: 'Templates' }]} value={tab} onChange={setTab}>
      {tab === 'exercises' ? <Exercises mode={mode} /> : <Templates mode={mode} />}
    </Tabs>
  </div>;
}

type Draft = { name: string; description: string; instructions: string; category: string; equipment: string; muscleGroups: string };
const EMPTY: Draft = { name: '', description: '', instructions: '', category: 'strength', equipment: '', muscleGroups: '' };
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

function Exercises({ mode }: { mode: Mode }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const base = mode === 'admin' ? '/admin/exercises' : '/coach/exercise-library';
  const data = useApi(() => api.get(`${base}${qs({ q: q.trim() || undefined, category: category || undefined, status: mode === 'admin' ? status || undefined : undefined })}`), [q, category, status, mode]);
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [statusDlg, setStatusDlg] = useState<{ e: any; to: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const d = data.data as any;
  const items = ((d?.items ?? []) as any[]);
  const save = async () => {
    if (!editing) return;
    setBusy(true); setErr('');
    const body = { name: editing.draft.name, description: editing.draft.description, instructions: editing.draft.instructions, category: editing.draft.category, equipment: list(editing.draft.equipment), muscleGroups: list(editing.draft.muscleGroups) };
    try {
      if (mode === 'coach') { await api.post('/coach/exercises', body); toast('Proposed: the Bioptime team reviews it'); }
      else if (editing.id) { await api.patch(`/admin/exercises/${editing.id}`, body); toast('Exercise saved'); }
      else { await api.post('/admin/exercises', { ...body, status: 'draft' }); toast('Draft exercise added'); }
      setEditing(null); data.reload();
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const open = (e?: any) => { setErr(''); setEditing(e ? { id: e.id, draft: { name: e.name, description: e.description, instructions: e.instructions, category: e.category, equipment: (e.equipment ?? []).join(', '), muscleGroups: (e.muscleGroups ?? []).join(', ') } } : { id: null, draft: { ...EMPTY } }); };
  const setDraft = (patch: Partial<Draft>) => setEditing((x) => (x ? { ...x, draft: { ...x.draft, ...patch } } : x));
  return <div className="stack">
    {d?.media && (mode === 'admin' ? <Alert kind="info" title="Demonstration media: pending configuration">Exercises are text only. Missing: {(d.media.missing as string[]).join('; ')}.</Alert>
      : <Alert kind="info" title="Demonstration media: not available yet">Exercises are text only until licensed demonstration media and a video host are in place.</Alert>)}
    <Card><CardHead eyebrow={mode === 'admin' ? 'All entries' : 'Published and your drafts'} title={`${items.length} exercise${items.length === 1 ? '' : 's'}`} right={<Button variant="primary" size="sm" onClick={() => open()}>{mode === 'admin' ? 'Add exercise' : 'Propose an exercise'}</Button>} />
      <div className="row" style={{ marginBottom: 12 }}>
        <Input style={{ maxWidth: 240 }} placeholder="Search by name" aria-label="Search exercises" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select style={{ maxWidth: 180 }} aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Every category</option>{CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select>
        {mode === 'admin' && <Select style={{ maxWidth: 160 }} aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Every status</option>{['draft', 'published', 'archived'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>}
      </div>
      {data.error ? <Alert kind="error">{data.error}</Alert> : !d ? <Skeleton rows={5} /> : items.length ? <Table label="Exercises" head={<><th>Exercise</th><th>Category</th><th>Equipment</th><th>Source</th><th>Status</th>{mode === 'admin' && <th />}</>}>
        {items.map((e) => <tr key={e.id}><td><b style={{ color: 'var(--bp-color-text-primary)' }}>{e.name}</b>{e.description && <div className="small">{e.description}</div>}{e.muscleGroups?.length ? <div className="small">{e.muscleGroups.join(', ')}</div> : null}</td><td>{label(e.category)}</td><td className="small">{e.equipment?.length ? e.equipment.join(', ') : 'None'}</td><td className="small">{sourceLabel(e.source)}{e.authorName && (mode === 'admin' || e.source === 'coach') ? <div>{e.authorName}</div> : null}</td><td><Pill status={e.status} /><div className="small">{fmtDate(e.updatedAt)}</div></td>
          {mode === 'admin' && <td><div className="row" style={{ gap: 4 }}><Button size="sm" variant="tertiary" onClick={() => open(e)}>Edit</Button>{e.status !== 'published' && <Button size="sm" variant="secondary" onClick={() => setStatusDlg({ e, to: 'published' })}>Publish</Button>}{e.status === 'published' && <Button size="sm" variant="tertiary" onClick={() => setStatusDlg({ e, to: 'draft' })}>To draft</Button>}{e.status !== 'archived' && <Button size="sm" variant="tertiary" onClick={() => setStatusDlg({ e, to: 'archived' })}>Archive</Button>}</div></td>}</tr>)}
      </Table> : <Empty title="No exercises match" body={mode === 'admin' ? 'Add the first one, or clear the filters.' : 'Clear the filters, or propose one.'} />}
    </Card>
    <Dialog open={!!editing} onClose={() => setEditing(null)} title={mode === 'coach' ? 'Propose an exercise' : editing?.id ? 'Edit exercise' : 'Add an exercise'} footer={<><Button variant="tertiary" onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>{mode === 'coach' ? 'Propose' : 'Save'}</Button></>}>
      {editing && <div className="form">
        <Field label="Name"><Input value={editing.draft.name} onChange={(e) => setDraft({ name: e.target.value })} /></Field>
        <Field label="Category"><Select value={editing.draft.category} onChange={(e) => setDraft({ category: e.target.value })}>{CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select></Field>
        <Field label="Description" optional><Textarea value={editing.draft.description} onChange={(e) => setDraft({ description: e.target.value })} /></Field>
        <Field label="Instructions" optional hint="How to perform it, in plain steps. No medical, rehabilitation or injury-prevention claims."><Textarea value={editing.draft.instructions} onChange={(e) => setDraft({ instructions: e.target.value })} /></Field>
        <Field label="Equipment (comma separated)" optional><Input value={editing.draft.equipment} onChange={(e) => setDraft({ equipment: e.target.value })} /></Field>
        <Field label="Muscle groups (comma separated)" optional><Input value={editing.draft.muscleGroups} onChange={(e) => setDraft({ muscleGroups: e.target.value })} /></Field>
        {mode === 'coach' && <p className="muted small">A proposal is a draft: you can use it in your own templates now, and every coach sees it once the Bioptime team publishes it.</p>}
        {err && <Alert kind="error">{err}</Alert>}
      </div>}
    </Dialog>
    <ReasonDialog open={!!statusDlg} onClose={() => setStatusDlg(null)} title={statusDlg ? `${statusDlg.to === 'published' ? 'Publish' : statusDlg.to === 'archived' ? 'Archive' : 'Return to draft'}: ${statusDlg.e.name}` : ''} body={statusDlg?.to === 'archived' ? 'Templates that use it keep it; new templates cannot add it. Sessions already given are unchanged.' : statusDlg?.to === 'published' ? 'Every coach can use it once published.' : 'Coaches stop seeing it, except its author.'} confirmLabel="Confirm" danger={statusDlg?.to === 'archived'} onConfirm={async (reason) => { await api.post(`/admin/exercises/${statusDlg!.e.id}/status`, { status: statusDlg!.to, reason }); toast('Status changed'); data.reload(); }} />
  </div>;
}

function Templates({ mode }: { mode: Mode }) {
  const nav = useNavigate();
  const toast = useToast();
  const [archived, setArchived] = useState(false);
  const data = useApi(() => api.get(mode === 'admin' ? '/admin/workout-templates' : `/coach/workout-templates${qs({ includeArchived: archived ? '1' : undefined })}`), [mode, archived]);
  const [statusDlg, setStatusDlg] = useState<{ t: any; to: string } | null>(null);
  const items = (((data.data as any)?.items ?? []) as any[]);
  return <Card><CardHead eyebrow={mode === 'admin' ? 'Team templates and coaches’ own' : 'Team templates and yours'} title={`${items.length} template${items.length === 1 ? '' : 's'}`} right={<div className="row" style={{ gap: 6 }}>{mode === 'coach' && <Button size="sm" variant="tertiary" onClick={() => setArchived((a) => !a)}>{archived ? 'Hide archived' : 'Show archived'}</Button>}<Button variant="primary" size="sm" onClick={() => nav('/workout-templates/new')}>{mode === 'admin' ? 'New team template' : 'New template'}</Button></div>} />
    {data.error ? <Alert kind="error">{data.error}</Alert> : !data.data ? <Skeleton rows={4} /> : items.length ? <Table label="Workout templates" head={<><th>Template</th><th>Source</th><th>Level</th><th>Exercises</th><th>Status</th><th /></>}>
      {items.map((t) => <tr key={t.id}><td><Link to={`/workout-templates/${t.id}`}><b>{t.title}</b></Link>{t.description && <div className="small">{t.description}</div>}</td><td className="small">{sourceLabel(t.source)}{t.authorName ? <div>{t.authorName}</div> : null}</td><td>{t.level ? label(t.level) : '—'}</td><td className="num">{t.itemCount}</td><td><Pill status={t.status} /></td>
        <td><div className="row" style={{ gap: 4 }}><Link className="bp-btn bp-btn-tertiary bp-btn-sm" to={`/workout-templates/${t.id}`}>{(mode === 'admin' && t.source === 'team') || (mode === 'coach' && t.source === 'coach') ? 'Edit' : 'View'}</Link>
          {mode === 'admin' && t.source === 'team' && t.status !== 'published' && <Button size="sm" variant="secondary" onClick={() => setStatusDlg({ t, to: 'published' })}>Publish</Button>}
          {mode === 'admin' && t.source === 'team' && t.status !== 'archived' && <Button size="sm" variant="tertiary" onClick={() => setStatusDlg({ t, to: 'archived' })}>Archive</Button>}</div></td></tr>)}
    </Table> : <Empty title="No templates yet" body={mode === 'admin' ? 'Team templates are shared with every coach once published.' : 'A template is a session: exercises with sets, reps or time, and rest.'} />}
    <ReasonDialog open={!!statusDlg} onClose={() => setStatusDlg(null)} title={statusDlg ? `${statusDlg.to === 'published' ? 'Publish' : 'Archive'}: ${statusDlg.t.title}` : ''} body={statusDlg?.to === 'published' ? 'Every coach can use it in programmes once published.' : 'Coaches can no longer add it to programmes; sessions already given are unchanged.'} confirmLabel="Confirm" danger={statusDlg?.to === 'archived'} onConfirm={async (reason) => { await api.post(`/admin/workout-templates/${statusDlg!.t.id}/status`, { status: statusDlg!.to, reason }); toast('Status changed'); data.reload(); }} />
  </Card>;
}
