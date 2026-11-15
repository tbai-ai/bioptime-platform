/* M6 Workouts, client record (coach and admin workspaces): the client's workout programmes and sessions. The coach sees
   the schedule and statuses always, and the set logs, effort, duration and notes only while the client shares health
   data (the server leaves them out otherwise). A coach writes programmes and gives feedback; an administrator
   with members.manage writes, publishes and archives programmes too (the coach's editor in admin mode, /admin/workout-
   programs/:id) and reads the logs. Like the coach's Today card, a session of a client who does not share health data offers Open, not Review: the coach sees
   the session's date and status and the feedback already given, and there is nothing to review or answer. */
import React, { useState } from 'react';
import { Link } from '../../lib/nav';
import { api } from '../../lib/api';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { Alert, Button, Card, CardHead, Dialog, Empty, Field, Pill, Skeleton, Table, Textarea, useApi, useToast, errorText } from '../../ui';
import type { ClientRecordTabContext } from '../types';
import { SessionPill, fmtDay, prescription } from './shared';

export function WorkoutsTab({ memberId, isPrivileged, detail }: ClientRecordTabContext) {
  const data = useApi(() => api.get(isPrivileged ? `/admin/members/${memberId}/workouts` : `/coach/clients/${memberId}/workouts`), [memberId, isPrivileged]);
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const d = data.data as any;
  if (data.error) return <Alert kind="error">{data.error}</Alert>;
  if (!d) return <Skeleton rows={6} />;
  const programs = (d.programs ?? []) as any[];
  const sessions = (d.sessions ?? []) as any[];
  const health = d.healthShared !== false;
  const shown = all ? sessions : sessions.slice(0, 30);
  // the admin editor names the member and offers the assigned coach's templates, without putting either in the address
  const memberName = (detail as any)?.member?.name as string | undefined;
  const coachId = (detail as any)?.coach?.coachId as string | undefined;
  return <div className="stack">
    {!health && <Alert kind="warning" title="Workout logs not shared">You see the schedule and whether each session was done. Sets, effort, duration and notes appear once the client turns on sharing with their coach in the app; feedback needs the same.</Alert>}
    <Card><CardHead eyebrow="Programmes" title="Workout programmes" right={<Link className="bp-btn bp-btn-primary bp-btn-sm" to={`/workout-programs/new?member=${memberId}`} state={isPrivileged ? { memberName, coachId } : undefined}>New workout programme</Link>} />
      {programs.length ? <Table label="Workout programmes" head={<><th>Programme</th><th>Status</th><th>Version</th><th>Starts</th><th>Sessions</th><th /></>}>
        {programs.map((p) => <tr key={p.id}><td><b style={{ color: 'var(--bp-color-text-primary)' }}>{p.title}</b><div className="small">by {p.coachName}</div></td><td><Pill status={p.status} />{p.draft && p.status === 'published' ? <div className="small">draft revision</div> : null}</td><td className="num">{p.currentVersion}</td><td>{fmtDay(p.startDate)}</td><td className="small">{p.sessions.completed + p.sessions.partial} done · {p.sessions.skipped} skipped · {p.sessions.scheduled} to come</td><td><Link className="bp-btn bp-btn-secondary bp-btn-sm" to={`/workout-programs/${p.id}`}>{p.status === 'archived' ? 'View' : 'Edit'}</Link></td></tr>)}
      </Table> : <Empty title="No workout programme" body={isPrivileged ? 'Write one from the exercise library templates, or leave it to the client’s coach; the client gets the sessions once it is published.' : 'Write one from the exercise library templates; the client gets the sessions once you publish it.'} />}
    </Card>
    <Card><CardHead eyebrow="Sessions" title="Schedule and logs" />
      {sessions.length ? <Table label="Workout sessions" head={<><th>Date</th><th>Session</th><th>Status</th>{health && <><th>Sets done</th><th>Effort</th><th>Minutes</th></>}<th>Feedback</th><th /></>}>
        {shown.map((s) => <tr key={s.id}><td>{fmtDay(s.scheduledDate)}<div className="small">week {s.week} · day {s.day}</div></td><td>{s.title}<div className="small">{s.programTitle}</div></td><td><SessionPill status={s.status} overdue={s.scheduledDate < d.today} /></td>
          {health && <><td className="num">{s.status === 'scheduled' || s.status === 'skipped' ? '—' : `${s.setsDone} of ${s.setsPrescribed}`}</td><td className="num">{s.rpe ? `${s.rpe}/10` : '—'}</td><td className="num">{s.durationMinutes ?? '—'}</td></>}
          <td className="num">{s.feedbackCount || '—'}</td><td>{s.status !== 'scheduled' && <Button size="sm" variant="tertiary" onClick={() => setOpen(s.id)}>{isPrivileged ? 'View' : health ? 'Review' : 'Open'}</Button>}</td></tr>)}
      </Table> : <Empty title="No sessions yet" body="Sessions appear when a programme is published." />}
      {sessions.length > 30 && !all && <div className="bp-card-foot"><Button size="sm" onClick={() => setAll(true)}>Show all {sessions.length}</Button></div>}
    </Card>
    {open && <SessionDialog id={open} isPrivileged={isPrivileged} onClose={() => setOpen(null)} onChanged={data.reload} />}
  </div>;
}

function SessionDialog({ id, isPrivileged, onClose, onChanged }: { id: string; isPrivileged: boolean; onClose: () => void; onChanged: () => void }) {
  const s = useApi(() => api.get(isPrivileged ? `/admin/workouts/${id}` : `/coach/workouts/${id}`), [id]);
  const toast = useToast();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const d = s.data as any;
  const send = async () => { setBusy(true); setErr(''); try { await api.post(`/coach/workouts/${id}/feedback`, { body }); setBody(''); toast('Feedback sent: the client is told'); s.reload(); onChanged(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); } };
  return <Dialog open onClose={onClose} title={d ? d.title : 'Session'} footer={<Button variant="tertiary" onClick={onClose}>Close</Button>}>
    {s.error ? <Alert kind="error">{s.error}</Alert> : !d ? <Skeleton rows={4} /> : <div className="stack">
      <p className="small">{d.programTitle} · week {d.week} · {fmtDay(d.scheduledDate)}{d.completedAt ? ` · logged ${fmtDateTime(d.completedAt)}` : ''} · <SessionPill status={d.status} overdue={!!d.today && d.scheduledDate < d.today} /></p>
      {d.healthWithheld ? <Alert kind="warning">Sets, effort, duration and notes are not shared with you: the client has not turned on sharing with their coach, and feedback needs the same.</Alert> : <>
        <dl className="kv"><dt>Effort</dt><dd>{d.rpe ? `${d.rpe}/10 (self-rated)` : 'Not rated'}</dd><dt>Duration</dt><dd>{d.durationMinutes ? `${d.durationMinutes} min` : '—'}</dd>{d.memberNote ? <><dt>Client’s note</dt><dd>{d.memberNote}</dd></> : null}{d.skipReason ? <><dt>Why skipped</dt><dd>{d.skipReason}</dd></> : null}</dl>
        {(d.items as any[]).map((it) => <div key={it.id} className="bp-tile"><b style={{ color: 'var(--bp-color-text-primary)' }}>{it.exerciseName}</b> <span className="small">{prescription(it)}</span>
          {(it.logs ?? []).length ? <div className="small" style={{ marginTop: 4 }}>{(it.logs as any[]).map((l) => `Set ${l.setNumber}: ${[l.repsDone != null ? `${l.repsDone} reps` : '', l.durationSeconds != null ? `${l.durationSeconds} s` : '', l.loadKg != null ? `${l.loadKg} kg` : ''].filter(Boolean).join(', ') || 'done'}${l.completed ? '' : ' (not done)'}`).join(' · ')}</div> : <div className="small muted">No sets logged</div>}
        </div>)}
      </>}
      {(d.feedback ?? []).length > 0 && <ul className="timeline">{(d.feedback as any[]).map((f) => <li key={f.id} className="done"><div>{f.body}</div><time>{f.coachName} · {fmtDate(f.createdAt)}</time></li>)}</ul>}
      {!isPrivileged && !d.healthWithheld && <div className="form"><Field label="Feedback for the client" hint="The client reads it with this session and is notified."><Textarea value={body} onChange={(e) => setBody(e.target.value)} /></Field>{err && <Alert kind="error">{err}</Alert>}<div><Button variant="primary" size="sm" busy={busy} disabled={body.trim().length < 2} onClick={send}>Send feedback</Button></div></div>}
    </div>}
  </Dialog>;
}
