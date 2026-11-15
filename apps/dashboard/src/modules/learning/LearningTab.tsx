/* M10 Learning, client record (coach and admin workspaces): the client's courses and progress. A coach always sees the
   courses coaches assigned, and the client's own choices and package courses only while the client shares with their
   coach; without that sharing the server leaves those out (with no hint that any exist) and shows an assigned course
   only from its assignment on. A coach assigns published courses with an optional note. Administrators read. */
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { Link } from '../../lib/nav';
import { fmtDate, relative } from '../../lib/format';
import { Alert, Button, Card, CardHead, Dialog, Empty, Field, Select, Skeleton, Table, Textarea, useApi, useToast, errorText } from '../../ui';
import type { ClientRecordTabContext } from '../types';
import { type Progress, EnrollmentPill, ProgressBar, audienceLabel, sourceLabel } from './shared';

type Row = { id: string; courseId: string; courseTitle: string; courseStatus: string; audience: string; sample: boolean; source: string; status: string; assignedByName: string | null; assignedByMe: boolean; assignedNote: string | null; enrolledAt: string; completedAt: string | null; progress: Progress };

export function LearningTab({ memberId, isPrivileged }: ClientRecordTabContext) {
  const data = useApi(() => api.get(isPrivileged ? `/admin/members/${memberId}/learning` : `/coach/clients/${memberId}/learning`), [memberId, isPrivileged]);
  const [assigning, setAssigning] = useState(false);
  const d = data.data as { items: Row[]; sharing: boolean } | null;
  if (data.error) return <Alert kind="error">{data.error}</Alert>;
  if (!d) return <Skeleton rows={5} />;
  return <div className="stack">
    {!isPrivileged && !d.sharing && <Alert kind="warning" title="Only the courses coaches assigned">The client has not turned on sharing with their coach. You see the courses a coach assigned them, with the progress they made from the assignment on, and nothing about courses they chose themselves.</Alert>}
    <Card><CardHead eyebrow="Learning" title="Courses and progress" right={!isPrivileged ? <Button variant="primary" size="sm" onClick={() => setAssigning(true)}>Assign a course</Button> : undefined} />
      {d.items.length ? <Table label="Courses" head={<><th>Course</th><th>How</th><th>Status</th><th>Progress</th><th>Started</th><th>Last activity</th></>}>
        {d.items.map((e) => <tr key={e.id}>
          <td><b style={{ color: 'var(--bp-color-text-primary)' }}>{e.courseTitle}</b><div className="small">{audienceLabel(e.audience)}{e.courseStatus !== 'published' ? ` · course ${e.courseStatus}` : ''}</div>{e.assignedNote && <div className="small">Note: {e.assignedNote}</div>}</td>
          <td>{sourceLabel(e.source)}{e.assignedByName && <div className="small">{e.assignedByMe ? 'by you' : `by ${e.assignedByName}`}</div>}</td>
          <td><EnrollmentPill status={e.status} />{e.completedAt && <div className="small">{fmtDate(e.completedAt)}</div>}</td>
          <td style={{ minWidth: 140 }}><ProgressBar p={e.progress} /></td>
          <td>{fmtDate(e.enrolledAt)}</td>
          <td>{e.progress.lastActivityAt ? relative(e.progress.lastActivityAt) : '—'}</td>
        </tr>)}
      </Table> : <Empty title="No courses" body={isPrivileged ? 'The client has not started a course.' : d.sharing ? 'Assign a course from the Bioptime team; the client is told and finds it on their Learn page.' : 'No course from a coach yet. Assign one; the client is told and finds it on their Learn page.'} />}
    </Card>
    {assigning && <AssignDialog memberId={memberId} onClose={() => setAssigning(false)} onDone={data.reload} />}
  </div>;
}

type Option = { id: string; title: string; audience: string; lessons: number; sample: boolean; packages: Array<{ name: string }> };

function AssignDialog({ memberId, onClose, onDone }: { memberId: string; onClose: () => void; onDone: () => void }) {
  const list = useApi(() => api.get('/coach/courses'), []);
  const items = (list.data as { items: Option[] } | null)?.items;
  const [courseId, setCourseId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toast = useToast();
  const chosen = items?.find((c) => c.id === courseId);
  const send = async () => {
    setBusy(true); setErr('');
    try { await api.post(`/coach/clients/${memberId}/courses`, { courseId, note: note.trim() || null }); toast('Course assigned: the client is told'); onDone(); onClose(); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <Dialog open onClose={onClose} title="Assign a course" footer={<><Button variant="tertiary" onClick={onClose}>Not now</Button><Button variant="primary" busy={busy} disabled={!courseId} onClick={send}>Assign</Button></>}>
    {list.error ? <Alert kind="error">{list.error}</Alert> : !items ? <Skeleton rows={3} /> : items.length ? <div className="form">
      <Field label="Course" hint="Published courses from the Bioptime team."><Select value={courseId} onChange={(e) => setCourseId(e.target.value)}><option value="">Choose a course</option>{items.map((c) => <option key={c.id} value={c.id}>{c.title} ({c.lessons} {c.lessons === 1 ? 'lesson' : 'lessons'})</option>)}</Select></Field>
      {chosen && <p className="small">{audienceLabel(chosen.audience)}{chosen.packages.length ? `: ${chosen.packages.map((p) => p.name).join(', ')}. Only a client who holds one of these can be assigned it.` : '.'} <Link to={`/courses/${chosen.id}`}>Read it first</Link></p>}
      <Field label="Note for the client" optional hint="Shown with the course on their Learn page; not included in the notification."><Textarea value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></Field>
      {err && <Alert kind="error">{err}</Alert>}
    </div> : <Empty title="No courses to assign" body="Courses appear here when the Bioptime team publishes them." />}
  </Dialog>;
}
