/* M6 Workouts, member portal: one session. The exercises as the coach prescribed them, a row per set to tick off
   (reps, time, load), a rest timer, the effort rating, the duration and a note; or skip it. Logging again replaces the
   earlier log. */
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Link, useNavigate } from '../../lib/nav';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { Alert, Button, Card, CardHead, ConfirmDialog, Field, Input, Select, Skeleton, Textarea, useApi, useToast, errorText } from '../../ui';
import { RestTimer, SessionPill, fmtDay, prescription, weekday } from './shared';

type SetRow = { done: boolean; reps: string; seconds: string; load: string };

const toNum = (s: string): number | null => { const t = s.trim(); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : NaN; };

export function SessionRunner() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const sess = useApi(() => api.get(`/me/workouts/${id}`), [id]);
  const s = sess.data as any;
  const [rows, setRows] = useState<Record<string, SetRow[]>>({});
  const [rpe, setRpe] = useState('');
  const [minutes, setMinutes] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [skip, setSkip] = useState(false);

  useEffect(() => {
    if (!s) return;
    const next: Record<string, SetRow[]> = {};
    for (const it of s.items ?? []) {
      const logs: any[] = it.logs ?? [];
      const planned = it.reps ? String(Number.parseInt(it.reps, 10) || '') : '';
      next[it.id] = Array.from({ length: Math.max(it.sets, ...logs.map((l) => l.setNumber)) }, (_, k) => {
        const l = logs.find((x) => x.setNumber === k + 1);
        return l ? { done: !!l.completed, reps: l.repsDone != null ? String(l.repsDone) : '', seconds: l.durationSeconds != null ? String(l.durationSeconds) : '', load: l.loadKg != null ? String(l.loadKg) : '' }
          : { done: false, reps: planned, seconds: it.durationSeconds ? String(it.durationSeconds) : '', load: '' };
      });
    }
    setRows(next);
    setRpe(s.rpe ? String(s.rpe) : ''); setMinutes(s.durationMinutes ? String(s.durationMinutes) : ''); setNote(s.memberNote ?? '');
  }, [s]);

  if (sess.error) return <Alert kind="error">{sess.error}</Alert>;
  if (!s) return <Skeleton rows={8} />;
  const open = s.programStatus === 'published';
  const setRow = (itemId: string, k: number, patch: Partial<SetRow>) => setRows((r) => ({ ...r, [itemId]: (r[itemId] ?? []).map((x, i) => (i === k ? { ...x, ...patch } : x)) }));
  const anyTicked = Object.values(rows).some((list) => list.some((x) => x.done));

  const save = async () => {
    setErr('');
    const sets: any[] = [];
    let problem = '';
    for (const it of s.items) (rows[it.id] ?? []).forEach((x, k) => {
      if (!x.done) return;
      const reps = toNum(x.reps), secs = toNum(x.seconds), load = toNum(x.load);
      if ([reps, secs, load].some((v) => Number.isNaN(v))) { problem ||= `${it.exerciseName}, set ${k + 1}: numbers only`; return; }
      sets.push({ itemId: it.id, setNumber: k + 1, repsDone: reps, durationSeconds: secs, loadKg: load, completed: true });
    });
    if (problem) { setErr(problem); return; }
    if (minutes.trim() && !(Number(minutes) >= 1)) { setErr('Duration: a whole number of minutes'); return; }
    const body = { sets, rpe: rpe ? Number(rpe) : null, durationMinutes: minutes.trim() ? Number(minutes) : null, note: note.trim() || undefined };
    setBusy(true);
    try { await api.post(`/me/workouts/${id}/complete`, body); toast(sets.length ? 'Session logged' : 'Marked as done'); sess.reload(); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };

  return <div className="stack">
    <div className="pageHead"><div><Link className="muted" to="/workouts">← Workouts</Link><h1 style={{ marginTop: 4 }}>{s.title}</h1><p className="sub">{s.programTitle} · week {s.week} · {weekday(s.scheduledDate)} {fmtDay(s.scheduledDate)}{s.completedAt ? ` · logged ${fmtDateTime(s.completedAt)}` : ''}</p></div><div className="actions"><SessionPill status={s.status} overdue={!!s.today && s.scheduledDate < s.today} /></div></div>
    {!open && <Alert kind="info" title="This programme was closed">Your coach closed it. What you logged stays in your history and cannot be changed.</Alert>}
    {s.status === 'skipped' && open && <Alert kind="info">You skipped this session{s.skipReason ? `: ${s.skipReason}` : ''}. You can still log it if you did it after all.</Alert>}
    {(s.feedback ?? []).length > 0 && <Card accent><CardHead eyebrow="From your coach" title="Feedback" /><ul className="timeline">{(s.feedback as any[]).map((f) => <li key={f.id} className="done"><div>{f.body}</div><time>{f.coachName} · {fmtDateTime(f.createdAt)}</time></li>)}</ul></Card>}
    {err && <Alert kind="error">{err}</Alert>}
    {(s.items as any[]).map((it) => <Card key={it.id}>
      <CardHead eyebrow={it.block || 'Exercise'} title={it.exerciseName} right={it.restSeconds ? <RestTimer secondsTotal={it.restSeconds} /> : undefined} />
      <p className="small"><b style={{ color: 'var(--bp-color-text-primary)' }}>{prescription(it)}</b>{it.loadNote ? ` · ${it.loadNote}` : ''}</p>
      {it.note && <p className="small">{it.note}</p>}
      {it.instructions ? <p className="small muted">{it.instructions}</p> : null}
      <div className="stack" style={{ marginTop: 10 }}>{(rows[it.id] ?? []).map((x, k) => <div key={k} className="row" style={{ gap: 10 }}>
        <label className="bp-check" style={{ minWidth: 92 }}><input type="checkbox" checked={x.done} disabled={!open} onChange={(e) => setRow(it.id, k, { done: e.target.checked })} /> Set {k + 1}</label>
        {it.reps ? <span className="row" style={{ gap: 6 }}><Input style={{ maxWidth: 90 }} inputMode="numeric" aria-label={`Set ${k + 1} reps`} value={x.reps} disabled={!open} onChange={(e) => setRow(it.id, k, { reps: e.target.value })} /><span className="small">reps</span></span> : null}
        {it.durationSeconds ? <span className="row" style={{ gap: 6 }}><Input style={{ maxWidth: 100 }} inputMode="numeric" aria-label={`Set ${k + 1} seconds`} value={x.seconds} disabled={!open} onChange={(e) => setRow(it.id, k, { seconds: e.target.value })} /><span className="small">seconds</span></span> : null}
        {it.reps ? <span className="row" style={{ gap: 6 }}><Input style={{ maxWidth: 90 }} inputMode="decimal" aria-label={`Set ${k + 1} load in kg (optional)`} placeholder="—" value={x.load} disabled={!open} onChange={(e) => setRow(it.id, k, { load: e.target.value })} /><span className="small">kg, optional</span></span> : null}
      </div>)}</div>
    </Card>)}
    {open && <Card><CardHead eyebrow="After the session" title="How it went" /><div className="form">
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <Field label="Effort (1 very light to 10 maximal)" optional><Select value={rpe} onChange={(e) => setRpe(e.target.value)}><option value="">Not rated</option>{Array.from({ length: 10 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</Select></Field>
        <Field label="Duration (minutes)" optional><Input inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} /></Field>
      </div>
      <Field label="Note for your coach" optional><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything your coach should know about this session" /></Field>
      <p className="muted small">{anyTicked ? 'Every prescribed set ticked logs the session as completed; fewer as partly done.' : 'Nothing ticked: the session is marked done without set detail.'} Your coach sees these details only while you share health data with them.</p>
      <div className="bp-card-foot"><Button variant="primary" busy={busy} onClick={save}>{s.status === 'scheduled' || s.status === 'skipped' ? 'Save log' : 'Update log'}</Button>{s.status === 'scheduled' && <Button variant="tertiary" onClick={() => setSkip(true)}>Skip this session</Button>}<Button variant="tertiary" onClick={() => nav('/workouts')}>Back</Button></div>
    </div></Card>}
    <p className="muted small">Exercises are described in text only; demonstration media is not available yet.</p>
    <ConfirmDialog open={skip} onClose={() => setSkip(false)} title="Skip this session?" body="It is marked as skipped; you can still log it later if you do it after all." confirmLabel="Skip session" note="Reason (optional, shared with your coach while you share health data)" onConfirm={async (reason) => { await api.post(`/me/workouts/${id}/skip`, { reason: reason || undefined }); toast('Session skipped'); sess.reload(); }} />
  </div>;
}
