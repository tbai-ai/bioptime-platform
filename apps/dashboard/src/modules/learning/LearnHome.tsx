/* M10 Learning: the learner's home. Members (/client/learn): the courses they are taking, with progress, and the
   published courses their audience admits (every member, their package, their coach's assignment). Coaches
   (/coach/training): training courses for coaches, the same way. */
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { Link, useNavigate } from '../../lib/nav';
import { fmtDate } from '../../lib/format';
import { Alert, Button, Card, CardHead, Empty, Skeleton, useApi, useToast, errorText } from '../../ui';
import { type CourseCard, type Mode, type VideoStatus, EnrollmentPill, MODES, ProgressBar, accessLabel } from './shared';

export function LearnHome({ mode }: { mode: Extract<Mode, 'client' | 'training'> }) {
  const data = useApi(() => api.get(mode === 'client' ? '/me/courses' : '/coach/training'), [mode]);
  const d = data.data as { enrolled: CourseCard[]; available: CourseCard[]; video: VideoStatus } | null;
  const coach = mode === 'training';
  return <div className="stack">
    <div className="pageHead"><div><h1>{coach ? 'Training' : 'Learn'}</h1><p className="sub">{coach ? 'Courses for coaches from the Bioptime team. Your progress is saved as you mark each lesson complete.' : 'Courses from the Bioptime team and the ones your coach assigns you. Your progress is saved in the portal and the app alike.'}</p></div></div>
    {data.error ? <Alert kind="error">{data.error}</Alert> : !d ? <Skeleton rows={6} /> : <>
      <Card><CardHead eyebrow={coach ? 'Your training' : 'Your courses'} title={coach ? 'In progress and done' : 'Courses you are taking'} />
        {d.enrolled.length ? <div className="grid">{d.enrolled.map((c) => <div key={c.id} className="span6"><Enrolled c={c} mode={mode} /></div>)}</div>
          : <Empty title={coach ? 'No training started' : 'No courses yet'} body={d.available.length ? 'Start one of the courses below.' : coach ? 'Training courses appear here when the Bioptime team publishes them.' : 'Courses appear here when the Bioptime team publishes one for you or your coach assigns one.'} />}
      </Card>
      {d.available.length > 0 && <Card><CardHead eyebrow="Available to you" title={coach ? 'Training you can start' : 'Courses you can start'} />
        <div className="grid">{d.available.map((c) => <div key={c.id} className="span6"><Available c={c} mode={mode} onJoined={data.reload} /></div>)}</div>
      </Card>}
      {!coach && <p className="muted small">Courses are added by the Bioptime team. Courses are education, not medical advice; ask your doctor about anything specific to your health.</p>}
    </>}
  </div>;
}

function Enrolled({ c, mode }: { c: CourseCard; mode: Mode }) {
  const m = MODES[mode];
  const e = c.enrollment!;
  return <div className="bp-tile stack" style={{ gap: 8 }}>
    <div className="row" style={{ justifyContent: 'space-between' }}><Link to={`${m.base}/${c.id}`}><b style={{ color: 'var(--bp-color-text-primary)' }}>{c.title}</b></Link><EnrollmentPill status={e.status} /></div>
    {c.locked ? <Alert kind="warning">Your access ended with your package. Your progress is kept.</Alert> : <ProgressBar p={e.progress} />}
    <span className="muted">{accessLabel(c.access)}{e.assignedByName ? ` · assigned by ${e.assignedByName}` : ''}{e.completedAt ? ` · completed ${fmtDate(e.completedAt)}` : ` · started ${fmtDate(e.enrolledAt)}`}</span>
    {e.assignedNote && <p className="small">“{e.assignedNote}”</p>}
    {!c.locked && <div className="row" style={{ gap: 6 }}>
      {c.nextLessonId && <Link className="bp-btn bp-btn-primary bp-btn-sm" to={`${m.base}/${c.id}/${c.nextLessonId}`}>{e.progress.completed ? 'Continue' : 'Start'}</Link>}
      <Link className="bp-btn bp-btn-secondary bp-btn-sm" to={`${m.base}/${c.id}`}>Lessons</Link>
    </div>}
  </div>;
}

function Available({ c, mode, onJoined }: { c: CourseCard; mode: Mode; onJoined: () => void }) {
  const m = MODES[mode];
  const toast = useToast();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const join = async () => {
    setBusy(true);
    try { const r = await api.post(m.enroll!(c.id)); toast('Enrolled'); onJoined(); if (r?.nextLessonId) nav(`${m.base}/${c.id}/${r.nextLessonId}`); }
    catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); }
  };
  return <div className="bp-tile stack" style={{ gap: 8 }}>
    <Link to={`${m.base}/${c.id}`}><b style={{ color: 'var(--bp-color-text-primary)' }}>{c.title}</b></Link>
    {c.summary && <p className="small">{c.summary}</p>}
    <span className="muted">{c.lessons} {c.lessons === 1 ? 'lesson' : 'lessons'}{c.minutes ? ` · about ${c.minutes} min` : ''} · {accessLabel(c.access)}</span>
    <div className="row" style={{ gap: 6 }}><Button size="sm" variant="primary" busy={busy} onClick={join}>Start this course</Button><Link className="bp-btn bp-btn-secondary bp-btn-sm" to={`${m.base}/${c.id}`}>See the lessons</Link></div>
  </div>;
}
