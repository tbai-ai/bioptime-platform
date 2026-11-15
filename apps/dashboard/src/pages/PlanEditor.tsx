import React, { Suspense, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Link, useNavigate } from '../lib/nav';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { todayIst } from '../lib/format';
import { Alert, Button, Card, CardHead, Field, Input, Pill, Select, Skeleton, Textarea, useApi, useToast, errorText } from '../ui';
import { useFeatures } from '../modules/runtime';

/* The coach's plan editor: a draft until the coach publishes it.

   Coach AI (M11, flag 'ai'): while the flag is on and a client is chosen, a closed "Draft a plan outline" panel sits
   under the basics and the weekly structure (modules/ai/shared.tsx AiDraftInline, loaded only then; it stays hidden
   for a client the server does not count as assigned to this coach). The coach asks for an outline for this client,
   edits it, and accepting adds the text to the summary field, after anything already there: nothing is saved until
   the coach saves the draft or publishes, and the weekly tasks are still the coach's own to write. */

const AiDraftInline = React.lazy(() => import('../modules/ai/shared').then((m) => ({ default: m.AiDraftInline })));

type Task = { title: string; kind: string; day: number };
type Week = { week: number; focus: string; tasks: Task[] };

const KINDS = ['training', 'movement', 'nutrition', 'sleep', 'habit', 'recovery', 'reflection'];

export function PlanEditor() {
  const { id = 'new' } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const { isCoach } = useAuth();
  const features = useFeatures(isCoach);
  const aiOn = isCoach && !!features?.has('ai');
  const isNew = id === 'new';
  const memberId = params.get('member') ?? '';
  const existing = useApi(() => (isNew ? Promise.resolve(null) : api.get(`/coach/plans/${id}`)), [id]);
  const clients = useApi(() => api.get('/coach/clients'), []);
  const [title, setTitle] = useState('');
  const [goals, setGoals] = useState('');
  const [summary, setSummary] = useState('');
  const [member, setMember] = useState(memberId);
  const [weeks, setWeeks] = useState<Week[]>([{ week: 1, focus: 'Foundation', tasks: [{ title: 'Evening walk · 25 min', kind: 'movement', day: 1 }] }]);
  const [startDate, setStartDate] = useState(todayIst());
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const p = existing.data as any;
  useEffect(() => {
    if (!p) return;
    setTitle(p.title); setGoals((p.goals ?? []).join(', ')); setMember(p.member_id);
    const v = p.currentVersion ?? p.versions?.[0];
    const draft = (p.versions ?? []).find((x: any) => x.status === 'draft');
    const structure = (p.currentVersion?.structure ?? { weeks: [] }) as { weeks: Week[] };
    setSummary(v?.summary ?? ''); if (structure.weeks?.length) setWeeks(structure.weeks.map((w: any) => ({ week: w.week, focus: w.focus ?? '', tasks: (w.tasks ?? []).map((t: any) => ({ title: t.title, kind: t.kind ?? 'habit', day: t.day ?? 1 })) })));
    void draft;
  }, [p]);

  const save = async (publish: boolean) => {
    setBusy(true); setErr('');
    try {
      const body = { title, goals: goals.split(',').map((s) => s.trim()).filter(Boolean), summary, structure: { weeks: weeks.map((w) => ({ ...w, tasks: w.tasks.filter((t) => t.title.trim()) })) } };
      let planId = id;
      if (isNew) { const r = await api.post('/coach/plans', { memberId: member, ...body }); planId = r.id; }
      else await api.patch(`/coach/plans/${id}`, body);
      if (publish) { await api.post(`/coach/plans/${planId}/publish`, { startDate }); toast('Plan published: the member has their tasks'); }
      else toast('Draft saved');
      nav(`/plans/${planId}`, { replace: true });
      if (!isNew) existing.reload();
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const setWeek = (i: number, patch: Partial<Week>) => setWeeks((ws) => ws.map((w, k) => (k === i ? { ...w, ...patch } : w)));
  const setTask = (wi: number, ti: number, patch: Partial<Task>) => setWeeks((ws) => ws.map((w, k) => (k === wi ? { ...w, tasks: w.tasks.map((t, j) => (j === ti ? { ...t, ...patch } : t)) } : w)));

  if (!isNew && existing.error) return <Alert kind="error">{existing.error}</Alert>;
  if (!isNew && !p) return <Skeleton rows={6} />;
  const hasDraft = isNew || (p.versions ?? []).some((v: any) => v.status === 'draft') || p.status === 'draft';
  return <div className="stack">
    <div className="pageHead"><div><Link className="muted" to={member ? `/clients/${member}?tab=plan` : '/clients'}>← Client</Link><h1 style={{ marginTop: 4 }}>{isNew ? 'New coaching plan' : p.title}</h1><p className="sub">{isNew ? 'A draft until you publish it. Publishing generates the member\'s tasks and tells them.' : `Version ${p.current_version} · ${p.status} · ${p.member_name}`}</p></div><div className="actions">{!isNew && <Pill status={p.status} />}<Button busy={busy} onClick={() => save(false)}>Save draft</Button><Button variant="primary" busy={busy} onClick={() => save(true)}>{hasDraft ? 'Publish' : 'Publish revision'}</Button></div></div>
    {err && <Alert kind="error">{err}</Alert>}
    <div className="grid">
      <div className="span4"><Card><CardHead eyebrow="Plan" title="Basics" /><div className="form">
        {isNew && <Field label="Client"><Select value={member} onChange={(e) => setMember(e.target.value)}><option value="">Choose a client</option>{(((clients.data as any)?.items ?? []) as any[]).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>}
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Block 2: strength and sleep" /></Field>
        <Field label="Goals (comma separated)"><Input value={goals} onChange={(e) => setGoals(e.target.value)} /></Field>
        <Field label="Summary for the member" optional><Textarea value={summary} onChange={(e) => setSummary(e.target.value)} /></Field>
        <Field label="Start date (tasks are dated from it)"><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
        <p className="muted">Only tasks within your professional scope. No supplement or medical advice in a plan.</p>
      </div></Card></div>
      <div className="span8"><Card><CardHead eyebrow="Weekly structure" title={`${weeks.length} weeks`} right={<Button size="sm" onClick={() => setWeeks((ws) => [...ws, { week: ws.length + 1, focus: '', tasks: [{ title: '', kind: 'habit', day: 1 }] }])}>Add week</Button>} />
        <div className="stack">{weeks.map((w, wi) => <div key={wi} className="bp-tile"><div className="row between"><div className="row"><b style={{ color: 'var(--bp-color-text-primary)' }}>Week {w.week}</b><Input style={{ maxWidth: 220 }} placeholder="Focus (e.g. Build)" value={w.focus} onChange={(e) => setWeek(wi, { focus: e.target.value })} /></div><div className="row"><Button size="sm" variant="tertiary" onClick={() => setWeek(wi, { tasks: [...w.tasks, { title: '', kind: 'habit', day: 1 }] })}>Add task</Button>{weeks.length > 1 && <Button size="sm" variant="tertiary" onClick={() => setWeeks((ws) => ws.filter((_, k) => k !== wi).map((x, k) => ({ ...x, week: k + 1 })))}>Remove week</Button>}</div></div>
          <div className="stack" style={{ marginTop: 10 }}>{w.tasks.map((t, ti) => <div key={ti} className="row"><Input style={{ flex: '1 1 240px' }} placeholder="Task, e.g. Full body session · 40 min" value={t.title} onChange={(e) => setTask(wi, ti, { title: e.target.value })} /><Select style={{ maxWidth: 140 }} value={t.kind} onChange={(e) => setTask(wi, ti, { kind: e.target.value })}>{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</Select><Select style={{ maxWidth: 110 }} value={t.day} onChange={(e) => setTask(wi, ti, { day: Number(e.target.value) })}>{[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>Day {d}</option>)}</Select><Button size="sm" variant="tertiary" onClick={() => setWeek(wi, { tasks: w.tasks.filter((_, j) => j !== ti) })} aria-label="Remove task">✕</Button></div>)}</div>
        </div>)}</div>
      </Card></div>
    </div>
    {aiOn && member && <Suspense fallback={null}><AiDraftInline key={member} memberId={member} purpose="plan_outline" title="Draft a plan outline"
      intro="Ask Coach AI for an outline for this client and edit it here. Accepting adds it to the summary; nothing is saved until you save the draft, and the weekly tasks stay yours to write."
      use={{ accept: 'Accept and add to the summary', again: 'Add to the summary', done: 'It is in the summary. Nothing is saved until you save the draft.', set: setSummary }} /></Suspense>}
    {!isNew && <Card><CardHead eyebrow="Versions" title="History" /><ul className="timeline">{(p.versions ?? []).map((v: any) => <li key={v.id} className={v.status === 'published' ? 'done' : ''}><b>Version {v.version}</b> · {v.status}{v.summary ? ` · ${v.summary}` : ''}<time>{v.publishedAt ?? v.createdAt}</time></li>)}</ul></Card>}
  </div>;
}
