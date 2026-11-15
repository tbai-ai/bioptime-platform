/* M10 Learning, admin workspace (/admin/learning, learning.manage): every course with its status, audience, lesson and
   enrolment counts, and a new course (a draft). Course and lesson text is what administrators write here; the editor
   never fills any in. */
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { Link, useNavigate } from '../../lib/nav';
import { fmtDate } from '../../lib/format';
import { Alert, Button, Card, Dialog, Empty, Field, Input, Select, Skeleton, Table, Textarea, useApi, errorText } from '../../ui';
import { AUDIENCES, CourseStatusPill, audienceLabel } from './shared';

type Item = { id: string; title: string; slug: string; audience: string; status: string; sample: boolean; updatedAt: string; packages: Array<{ name: string }>; lessonCounts: { published: number; draft: number }; enrolments: { active: number; completed: number } };
type Options = { packages: Array<{ id: string; name: string; active: boolean }>; video: { status: string; missing: string[]; note: string } };

export function AdminCourses() {
  const [status, setStatus] = useState('');
  const data = useApi(() => api.get(`/admin/courses${status ? `?status=${status}` : ''}`), [status]);
  const [creating, setCreating] = useState(false);
  const d = data.data as { items: Item[]; video: Options['video'] } | null;
  return <div className="stack">
    <div className="pageHead"><div><h1>Courses</h1><p className="sub">Courses, modules and lessons for members and coach training. A course is a draft until you publish it, and needs at least one published lesson. You write the text; nothing is filled in for you.</p></div>
      <div className="actions"><Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Every status</option><option value="draft">Drafts</option><option value="published">Published</option><option value="archived">Archived</option></Select><Button variant="primary" size="sm" onClick={() => setCreating(true)}>New course</Button></div></div>
    {d && d.video.status !== 'live' && <Alert kind="info" title="Video lessons: pending configuration">{d.video.note} Missing: {d.video.missing.join('; ')}.</Alert>}
    <Card>{data.error ? <Alert kind="error">{data.error}</Alert> : !d ? <Skeleton rows={6} /> : d.items.length ? <Table label="Courses" head={<><th>Course</th><th>Audience</th><th>Status</th><th className="num">Lessons</th><th className="num">Learners</th><th>Updated</th></>}>
      {d.items.map((c) => <tr key={c.id}><td><Link to={`/learning/${c.id}`}><b style={{ color: 'var(--bp-color-text-primary)' }}>{c.title}</b></Link><div className="muted"><code>{c.slug}</code></div></td>
        <td>{audienceLabel(c.audience)}{c.packages.length > 0 && <div className="small">{c.packages.map((p) => p.name).join(', ')}</div>}</td>
        <td><CourseStatusPill status={c.status} /></td>
        <td className="num">{c.lessonCounts.published}{c.lessonCounts.draft ? <span className="muted"> + {c.lessonCounts.draft} draft</span> : null}</td>
        <td className="num">{c.enrolments.active} <span className="muted">active</span> · {c.enrolments.completed} <span className="muted">done</span></td>
        <td>{fmtDate(c.updatedAt)}</td></tr>)}
    </Table> : <Empty title={status ? 'No courses with this status' : 'No courses yet'} body="Create a course, add modules and lessons, then publish it." action={<Button size="sm" onClick={() => setCreating(true)}>New course</Button>} />}</Card>
    {creating && <CreateDialog onClose={() => setCreating(false)} />}
  </div>;
}

function CreateDialog({ onClose }: { onClose: () => void }) {
  const opts = useApi(() => api.get('/admin/learning/options'), []);
  const o = opts.data as Options | null;
  const nav = useNavigate();
  const [f, setF] = useState({ title: '', summary: '', audience: 'all_members', packageIds: [] as string[] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const create = async () => {
    setBusy(true); setErr('');
    try { const c = await api.post('/admin/courses', { title: f.title.trim(), summary: f.summary.trim(), audience: f.audience, ...(f.audience === 'packages' ? { packageIds: f.packageIds } : {}) }); onClose(); nav(`/learning/${c.id}`); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <Dialog open onClose={onClose} title="New course" footer={<><Button variant="tertiary" onClick={onClose}>Not now</Button><Button variant="primary" busy={busy} disabled={f.title.trim().length < 2} onClick={create}>Create the draft</Button></>}>
    <div className="form">
      <Field label="Title"><Input value={f.title} maxLength={160} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <Field label="Summary" optional hint="One or two sentences learners read before starting."><Textarea value={f.summary} maxLength={600} onChange={(e) => setF({ ...f, summary: e.target.value })} /></Field>
      <Field label="Who can take it" hint={AUDIENCES.find((a) => a.id === f.audience)?.hint}><Select value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}>{AUDIENCES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</Select></Field>
      {f.audience === 'packages' && (!o ? <Skeleton rows={2} /> : <PackagePicker packages={o.packages} value={f.packageIds} onChange={(packageIds) => setF({ ...f, packageIds })} />)}
      {err && <Alert kind="error">{err}</Alert>}
    </div>
  </Dialog>;
}

/** The packages a package course comes with, as checkboxes. */
export function PackagePicker({ packages, value, onChange }: { packages: Array<{ id: string; name: string; active: boolean }>; value: string[]; onChange: (ids: string[]) => void }) {
  return <fieldset className="stack" style={{ gap: 6, border: 0, padding: 0, margin: 0 }}><legend className="bp-label">Packages</legend>
    {packages.map((p) => <label key={p.id} className="bp-check"><input type="checkbox" checked={value.includes(p.id)} onChange={(e) => onChange(e.target.checked ? [...value, p.id] : value.filter((x) => x !== p.id))} /> {p.name}{!p.active && <span className="muted"> (not active)</span>}</label>)}
  </fieldset>;
}
