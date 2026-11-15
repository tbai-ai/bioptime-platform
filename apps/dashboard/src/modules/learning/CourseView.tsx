/* M10 Learning: one course's outline. Members (/client/learn/:courseId) and coaches in training
   (/coach/training/:courseId) see their progress lesson by lesson and can start or leave; coaches reading a member
   course before assigning it (/coach/courses/:courseId) see the outline only. Draft lessons never appear here. */
import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { Link, useNavigate } from '../../lib/nav';
import { fmtDate } from '../../lib/format';
import { Alert, Button, Card, CardHead, ConfirmDialog, Empty, Pill, Skeleton, useApi, useToast, errorText } from '../../ui';
import { type CourseCoverImage, type Enrollment, type Mode, type OutlineModule, type VideoStatus, CourseCover, EnrollmentPill, MODES, ProgressBar, accessLabel, lessonMeta } from './shared';

type Course = { id: string; title: string; summary: string; sample: boolean; cover: CourseCoverImage | null; lessons: number; minutes: number | null; access: string | null; archived?: boolean; enrollment: Enrollment | null; modules: OutlineModule[]; nextLessonId: string | null; packages?: Array<{ id: string; name: string }>; audience: string; video: VideoStatus };

export function CourseView({ mode }: { mode: Mode }) {
  const { courseId = '' } = useParams();
  const m = MODES[mode];
  const data = useApi(() => api.get(m.course(courseId)), [courseId, mode]);
  const toast = useToast();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const c = data.data as Course | null;
  if (data.error) return <div className="stack"><Link className="muted" to={m.base}>← {m.listLabel}</Link><Alert kind="error">{data.error}</Alert></div>;
  if (!c) return <Skeleton rows={8} />;
  const e = c.enrollment;
  const join = async () => { setBusy(true); try { const r = await api.post(m.enroll!(c.id)); toast('Enrolled'); data.reload(); if (r?.nextLessonId) nav(`${m.base}/${c.id}/${r.nextLessonId}`); } catch (ex) { toast(errorText(ex), 'error'); } finally { setBusy(false); } };
  const preview = mode === 'preview';
  return <div className="stack">
    <div className="pageHead"><div><Link className="muted" to={m.base}>← {m.listLabel}</Link><h1 style={{ marginTop: 4 }}>{c.title}</h1>{c.summary && <p className="sub">{c.summary}</p>}</div>
      <div className="actions">
        {!preview && e && c.nextLessonId && <Link className="bp-btn bp-btn-primary bp-btn-sm" to={`${m.base}/${c.id}/${c.nextLessonId}`}>{e.progress.completed ? 'Continue' : 'Start'}</Link>}
        {!preview && !e && !c.archived && <Button variant="primary" size="sm" busy={busy} onClick={join}>Start this course</Button>}
        {preview && c.nextLessonId && <Link className="bp-btn bp-btn-secondary bp-btn-sm" to={`${m.base}/${c.id}/${c.nextLessonId}`}>Read the first lesson</Link>}
        {!preview && e && m.leave && e.status !== 'withdrawn' && <Button variant="tertiary" size="sm" onClick={() => setLeaving(true)}>Leave the course</Button>}
      </div></div>
    {c.archived && <Alert kind="info">This course has been retired. You can still read it and finish it.</Alert>}
    {preview && <Alert kind="info">You are reading this course as its learners see it. Assign it from a client’s record, on the Learning tab.{c.packages?.length ? ` It comes with: ${c.packages.map((p) => p.name).join(', ')}.` : ''}</Alert>}
    <div className="grid">
      <div className="span8"><Card><CardHead eyebrow={`${c.lessons} ${c.lessons === 1 ? 'lesson' : 'lessons'}${c.minutes ? ` · about ${c.minutes} min` : ''}`} title="Lessons" />
        {c.modules.length ? <div className="stack">{c.modules.map((mod) => <div key={mod.id}>
          <span className="bp-eyebrow">{mod.title}</span>
          <ul className="lrnOutline">{mod.lessons.map((l) => <li key={l.id}><div><Link to={`${m.base}/${c.id}/${l.id}`}>{l.title}</Link><span className="muted">{lessonMeta(l)}</span></div>{!preview && (l.progress === 'completed' ? <Pill status="completed">Done</Pill> : l.progress === 'started' ? <Pill status="in_progress">Opened</Pill> : null)}</li>)}</ul>
        </div>)}</div> : <Empty title="No lessons yet" />}
      </Card></div>
      <div className="span4"><div className="stack">
        {c.cover && <CourseCover cover={c.cover} />}
        {!preview && <Card><CardHead eyebrow="Your progress" title={e ? 'In this course' : 'Not started'} right={e ? <EnrollmentPill status={e.status} /> : undefined} />
          {e ? <div className="stack" style={{ gap: 8 }}><ProgressBar p={e.progress} /><dl className="kv"><dt>Access</dt><dd>{accessLabel(c.access)}</dd>{e.assignedByName && <><dt>Assigned by</dt><dd>{e.assignedByName}</dd></>}{e.assignedNote && <><dt>Note</dt><dd>{e.assignedNote}</dd></>}<dt>Started</dt><dd>{fmtDate(e.enrolledAt)}</dd>{e.completedAt && <><dt>Completed</dt><dd>{fmtDate(e.completedAt)}</dd></>}</dl></div>
            : <p className="small">{accessLabel(c.access)}. Start the course to keep your progress.</p>}
        </Card>}
        {c.modules.some((mod) => mod.lessons.some((l) => l.kind === 'video')) && c.video.status !== 'live' && <Alert kind="info" title="Video">{c.video.note}</Alert>}
      </div></div>
    </div>
    {m.leave && <ConfirmDialog open={leaving} onClose={() => setLeaving(false)} title="Leave this course?" body="It leaves your list. Your progress is kept, and starting the course again picks it up." confirmLabel="Leave the course" onConfirm={async () => { await api.post(m.leave!(c.id)); toast('You left the course'); nav(m.base); }} />}
  </div>;
}
