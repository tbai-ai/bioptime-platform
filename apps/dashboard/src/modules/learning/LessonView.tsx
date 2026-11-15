/* M10 Learning: one lesson. Members (/client/learn/:courseId/:lessonId) and coaches in training
   (/coach/training/:courseId/:lessonId) read it, mark it complete and move to the next one; opening it while enrolled
   is noted once. Coaches reading a member course (/coach/courses/:courseId/:lessonId) read it only. A video lesson
   says plainly that video hosting is pending configuration. */
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { Link } from '../../lib/nav';
import { fmtDate } from '../../lib/format';
import { Alert, Button, Card, Pill, Skeleton, useApi, useToast, errorText } from '../../ui';
import { type Mode, type Progress, type VideoStatus, LessonBody, MODES, ProgressBar, lessonMeta } from './shared';

type Lesson = {
  id: string; title: string; kind: string; body: string; durationMinutes: number | null; video: (VideoStatus & { ref: null }) | null;
  course: { id: string; title: string; sample: boolean; status: string }; module: { id: string; title: string };
  position: { index: number; of: number }; prevLessonId: string | null; nextLessonId: string | null;
  enrolled: boolean; progress: { status: string; completedAt: string | null } | null; courseProgress: Progress | null; enrollmentStatus: string | null; preview?: boolean;
};

export function LessonView({ mode }: { mode: Mode }) {
  const { courseId = '', lessonId = '' } = useParams();
  const m = MODES[mode];
  const data = useApi(() => api.get(m.lesson(lessonId)), [lessonId, mode]);
  const [override, setOverride] = useState<Lesson | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => { setOverride(null); }, [lessonId]);
  const l = (override ?? data.data) as Lesson | null;
  // opening a lesson while enrolled is noted once (the server ignores repeats and records nothing when not enrolled)
  useEffect(() => { if (l && l.id === lessonId && l.enrolled && !l.progress && m.start) void api.post(m.start(l.id)).catch(() => undefined); }, [l?.id, l?.enrolled]); // eslint-disable-line react-hooks/exhaustive-deps
  if (data.error) return <div className="stack"><Link className="muted" to={`${m.base}/${courseId}`}>← The course</Link><Alert kind="error">{data.error}</Alert></div>;
  if (!l) return <Skeleton rows={10} />;
  const done = l.progress?.status === 'completed';
  const complete = async () => {
    setBusy(true);
    try { const r = await api.post<Lesson>(m.complete!(l.id)); setOverride(r); toast(r.enrollmentStatus === 'completed' && l.enrollmentStatus !== 'completed' ? 'Lesson complete: you have finished the course' : 'Lesson complete'); }
    catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); }
  };
  const canComplete = !!m.complete && !l.preview;
  return <div className="stack">
    <div className="pageHead"><div><Link className="muted" to={`${m.base}/${l.course.id}`}>← {l.course.title}</Link><h1 style={{ marginTop: 4 }}>{l.title}</h1><p className="sub">{l.module.title} · lesson {l.position.index} of {l.position.of} · {lessonMeta(l)}</p></div>
      <div className="actions">{done && <Pill status="completed">Done{l.progress?.completedAt ? ` ${fmtDate(l.progress.completedAt)}` : ''}</Pill>}</div></div>
    <div className="grid">
      <div className="span8"><Card>
        {l.video && <Alert kind="info" title="Video not available yet">{l.video.note}</Alert>}
        <LessonBody html={l.body} />
        <div className="bp-card-foot row" style={{ justifyContent: 'space-between' }}>
          <div className="row" style={{ gap: 6 }}>
            {l.prevLessonId && <Link className="bp-btn bp-btn-tertiary bp-btn-sm" to={`${m.base}/${l.course.id}/${l.prevLessonId}`}>← Previous</Link>}
            {l.nextLessonId && <Link className={`bp-btn ${done ? 'bp-btn-primary' : 'bp-btn-secondary'} bp-btn-sm`} to={`${m.base}/${l.course.id}/${l.nextLessonId}`}>Next lesson →</Link>}
          </div>
          {canComplete && !done && <Button variant="primary" size="sm" busy={busy} onClick={complete}>Mark as complete</Button>}
        </div>
      </Card></div>
      <div className="span4"><div className="stack">
        {l.preview ? <Alert kind="info">You are reading a member course before assigning it. Progress is recorded only for its learners.</Alert>
          : l.courseProgress ? <Card><span className="bp-eyebrow">Your progress</span><div style={{ marginTop: 8 }}><ProgressBar p={l.courseProgress} /></div>{l.enrollmentStatus === 'completed' && <p className="small" style={{ marginTop: 8 }}>You have completed this course.</p>}</Card>
          : <Card><span className="bp-eyebrow">Your progress</span><p className="small" style={{ marginTop: 8 }}>Marking this lesson complete starts the course and keeps your progress.</p></Card>}
      </div></div>
    </div>
  </div>;
}
