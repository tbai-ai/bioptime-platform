/* M10 Learning, admin workspace (/admin/learning/:id, learning.manage): one course's editor. Its details and audience
   (every member, members with chosen packages, members a coach assigns, or coaches), its modules and lessons in order,
   each lesson a draft until published, and the course's own status: publish (needs a published lesson), back to draft,
   archive, each with a reason for the audit log. A video lesson stays a draft while video hosting is pending
   configuration. Lesson bodies keep only the CMS formatting tags. */
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { Link } from '../../lib/nav';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { Alert, Button, Card, CardHead, ConfirmDialog, Dialog, Empty, Field, Input, Pill, ReasonDialog, Select, Skeleton, Textarea, useApi, useToast, errorText } from '../../ui';
import { type CourseCoverImage, AUDIENCES, CourseCover, CourseStatusPill, KINDS, LessonBody, kindLabel } from './shared';
import { PackagePicker } from './AdminCourses';

type Lesson = { id: string; moduleId: string; title: string; kind: string; body: string; durationMinutes: number | null; status: string; completedBy: number; updatedAt: string };
type Mod = { id: string; title: string; lessons: Lesson[] };
type Course = {
  id: string; title: string; slug: string; summary: string; audience: string; status: string; sample: boolean; packageIds: string[]; coverAssetId: string | null; cover: CourseCoverImage | null;
  createdByName: string | null; createdAt: string; updatedAt: string; publishedAt: string | null; archivedAt: string | null;
  enrolments: { active: number; completed: number; withdrawn: number }; lessonCounts: { published: number; draft: number }; modules: Mod[];
  video: { status: string; missing: string[]; note: string };
};
type Options = { packages: Array<{ id: string; name: string; active: boolean }>; images: Array<{ id: string; filename: string; alt: string }> };

export function CourseEditor() {
  const { id = '' } = useParams();
  const data = useApi(() => api.get(`/admin/courses/${id}`), [id]);
  const opts = useApi(() => api.get('/admin/learning/options'), []);
  const [course, setCourse] = useState<Course | null>(null);
  const [status, setStatus] = useState<null | 'publish' | 'unpublish' | 'archive'>(null);
  const [lessonFor, setLessonFor] = useState<{ moduleId: string; lesson?: Lesson } | null>(null);
  const [newModule, setNewModule] = useState('');
  const [busy, setBusy] = useState(false);
  const [remove, setRemove] = useState<{ kind: 'module' | 'lesson'; id: string; title: string } | null>(null);
  const toast = useToast();
  useEffect(() => { if (data.data) setCourse(data.data as Course); }, [data.data]);
  const c = course;
  if (data.error) return <div className="stack"><Link className="muted" to="/learning">← Courses</Link><Alert kind="error">{data.error}</Alert></div>;
  if (!c) return <Skeleton rows={10} />;
  const o = opts.data as Options | null;
  const locked = c.status === 'archived';
  const run = async (fn: () => Promise<Course | unknown>, ok: string) => { setBusy(true); try { const r = await fn(); if (r && typeof r === 'object' && 'modules' in (r as object)) setCourse(r as Course); else data.reload(); toast(ok); } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); } };

  // order: move a module, or a lesson within its module, one place up or down
  const order = (mods: Mod[]) => ({ modules: mods.map((m) => ({ id: m.id, lessonIds: m.lessons.map((l) => l.id) })) });
  const swap = <T,>(list: T[], i: number, j: number): T[] => { const out = [...list]; [out[i], out[j]] = [out[j]!, out[i]!]; return out; };
  const moveModule = (i: number, d: -1 | 1) => run(() => api.post(`/admin/courses/${c.id}/reorder`, order(swap(c.modules, i, i + d))), 'Order saved');
  const moveLesson = (mi: number, li: number, d: -1 | 1) => run(() => api.post(`/admin/courses/${c.id}/reorder`, order(c.modules.map((m, k) => (k === mi ? { ...m, lessons: swap(m.lessons, li, li + d) } : m)))), 'Order saved');
  const lessonStatus = (l: Lesson, to: 'publish' | 'unpublish') => run(async () => { await api.post(`/admin/lessons/${l.id}/${to}`); return api.get(`/admin/courses/${c.id}`); }, to === 'publish' ? 'Lesson published' : 'Lesson back to draft');
  const addModule = () => run(async () => { const r = await api.post(`/admin/courses/${c.id}/modules`, { title: newModule.trim() }); setNewModule(''); return r; }, 'Module added');

  return <div className="stack">
    <div className="pageHead"><div><Link className="muted" to="/learning">← Courses</Link><h1 style={{ marginTop: 4 }}>{c.title}</h1><p className="sub"><code>{c.slug}</code> · created {fmtDate(c.createdAt)}{c.createdByName ? ` by ${c.createdByName}` : ''} · updated {fmtDateTime(c.updatedAt)}{c.publishedAt ? ` · published ${fmtDate(c.publishedAt)}` : ''}</p></div>
      <div className="actions"><CourseStatusPill status={c.status} />
        {c.status === 'draft' && <Button variant="primary" size="sm" onClick={() => setStatus('publish')}>Publish</Button>}
        {c.status !== 'draft' && <Button size="sm" onClick={() => setStatus('unpublish')}>{c.status === 'archived' ? 'Restore as draft' : 'Back to draft'}</Button>}
        {c.status !== 'archived' && <Button variant="tertiary" size="sm" onClick={() => setStatus('archive')}>Archive</Button>}
      </div></div>
    {locked && <Alert kind="info">This course is archived: learners already enrolled can still read it; nobody new can start it. Restore it as a draft to edit it.</Alert>}
    {c.status === 'draft' && !c.lessonCounts.published && <Alert kind="info">Publish at least one lesson before publishing the course.</Alert>}
    <div className="grid">
      <div className="span8"><div className="stack">
        <Card><CardHead eyebrow="Outline" title="Modules and lessons" right={<span className="muted">{c.lessonCounts.published} published · {c.lessonCounts.draft} draft</span>} />
          {c.modules.length ? <div className="stack">{c.modules.map((m, mi) => <div key={m.id} className="bp-tile stack" style={{ gap: 8 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <ModuleTitle m={m} disabled={locked || busy} onSave={(title) => run(() => api.patch(`/admin/course-modules/${m.id}`, { title }), 'Module renamed')} />
              {!locked && <div className="row" style={{ gap: 4 }}>
                <Button size="sm" variant="tertiary" disabled={busy || mi === 0} onClick={() => moveModule(mi, -1)} aria-label={`Move ${m.title} up`}>↑</Button>
                <Button size="sm" variant="tertiary" disabled={busy || mi === c.modules.length - 1} onClick={() => moveModule(mi, 1)} aria-label={`Move ${m.title} down`}>↓</Button>
                <Button size="sm" variant="tertiary" disabled={busy || m.lessons.length > 0} title={m.lessons.length ? 'Move or delete its lessons first' : undefined} onClick={() => setRemove({ kind: 'module', id: m.id, title: m.title })}>Remove</Button>
              </div>}
            </div>
            {m.lessons.length ? <ul className="lrnOutline">{m.lessons.map((l, li) => <li key={l.id}>
              <div><b style={{ color: 'var(--bp-color-text-primary)' }}>{l.title}</b><span className="muted">{kindLabel(l.kind)}{l.durationMinutes ? ` · ${l.durationMinutes} min` : ''} · completed by {l.completedBy} · updated {fmtDate(l.updatedAt)}</span></div>
              <div className="row" style={{ gap: 4, flex: '0 0 auto' }}>
                <Pill status={l.status} />
                {!locked && <>
                  <Button size="sm" variant="tertiary" disabled={busy || li === 0} onClick={() => moveLesson(mi, li, -1)} aria-label={`Move ${l.title} up`}>↑</Button>
                  <Button size="sm" variant="tertiary" disabled={busy || li === m.lessons.length - 1} onClick={() => moveLesson(mi, li, 1)} aria-label={`Move ${l.title} down`}>↓</Button>
                  <Button size="sm" onClick={() => setLessonFor({ moduleId: m.id, lesson: l })}>Edit</Button>
                  {l.status === 'draft' ? <Button size="sm" variant="primary" disabled={busy} title={l.kind === 'video' && c.video.status !== 'live' ? 'Needs a video host' : undefined} onClick={() => lessonStatus(l, 'publish')}>Publish</Button> : <Button size="sm" variant="tertiary" disabled={busy} onClick={() => lessonStatus(l, 'unpublish')}>Unpublish</Button>}
                  {l.status === 'draft' && <Button size="sm" variant="tertiary" disabled={busy} onClick={() => setRemove({ kind: 'lesson', id: l.id, title: l.title })}>Delete</Button>}
                </>}
              </div>
            </li>)}</ul> : <p className="muted">No lessons in this module yet.</p>}
            {!locked && <div><Button size="sm" onClick={() => setLessonFor({ moduleId: m.id })}>Add a lesson</Button></div>}
          </div>)}</div> : <Empty title="No modules yet" body="A course is made of modules, each with its lessons. Add the first module below." />}
          {!locked && <div className="bp-card-foot row" style={{ gap: 8 }}><Input value={newModule} maxLength={160} placeholder="New module title" aria-label="New module title" onChange={(e) => setNewModule(e.target.value)} /><Button size="sm" disabled={busy || newModule.trim().length < 2} onClick={addModule}>Add module</Button></div>}
        </Card>
      </div></div>
      <div className="span4"><div className="stack">
        <Details c={c} o={o} locked={locked} onSaved={(r) => { setCourse(r); toast('Course saved'); }} />
        <Card><CardHead eyebrow="Learners" title="Enrolments" /><dl className="kv"><dt>In progress</dt><dd className="num">{c.enrolments.active}</dd><dt>Completed</dt><dd className="num">{c.enrolments.completed}</dd><dt>Left</dt><dd className="num">{c.enrolments.withdrawn}</dd></dl></Card>
        {c.video.status !== 'live' && <Alert kind="info" title="Video lessons: pending configuration">{c.video.note} Missing: {c.video.missing.join('; ')}.</Alert>}
      </div></div>
    </div>
    <ReasonDialog open={!!status} onClose={() => setStatus(null)} title={status === 'publish' ? 'Publish this course?' : status === 'archive' ? 'Archive this course?' : 'Return this course to draft?'}
      body={status === 'publish' ? 'Learners its audience admits can start it, and its published lessons become readable.' : status === 'archive' ? 'Nobody new can start it. Learners already enrolled keep reading it.' : 'It disappears from learners’ lists until it is published again. Their progress is kept.'}
      confirmLabel={status === 'publish' ? 'Publish' : status === 'archive' ? 'Archive' : 'Return to draft'} danger={status === 'archive'}
      onConfirm={async (reason) => { const r = await api.post(`/admin/courses/${c.id}/${status}`, { reason }); setCourse(r); toast(status === 'publish' ? 'Course published' : status === 'archive' ? 'Course archived' : 'Course is a draft'); }} />
    <ConfirmDialog open={!!remove} onClose={() => setRemove(null)} danger title={remove?.kind === 'module' ? 'Remove this module?' : 'Delete this lesson?'} body={`“${remove?.title ?? ''}” is removed. ${remove?.kind === 'lesson' ? 'A lesson a learner has opened cannot be deleted; keep it as a draft instead.' : ''}`} confirmLabel={remove?.kind === 'module' ? 'Remove' : 'Delete'}
      onConfirm={async () => { const r = await api.del(remove!.kind === 'module' ? `/admin/course-modules/${remove!.id}` : `/admin/lessons/${remove!.id}`); setCourse(r); toast(remove!.kind === 'module' ? 'Module removed' : 'Lesson deleted'); }} />
    {lessonFor && <LessonDialog target={lessonFor} video={c.video} onClose={() => setLessonFor(null)} onSaved={() => { data.reload(); }} />}
  </div>;
}

function ModuleTitle({ m, disabled, onSave }: { m: Mod; disabled: boolean; onSave: (title: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(m.title);
  useEffect(() => setTitle(m.title), [m.title]);
  if (!editing) return <div className="row" style={{ gap: 6 }}><span className="bp-eyebrow" style={{ margin: 0 }}>{m.title}</span>{!disabled && <Button size="sm" variant="tertiary" onClick={() => setEditing(true)}>Rename</Button>}</div>;
  return <div className="row" style={{ gap: 6 }}><Input value={title} maxLength={160} aria-label="Module title" onChange={(e) => setTitle(e.target.value)} /><Button size="sm" variant="primary" disabled={title.trim().length < 2} onClick={() => { onSave(title.trim()); setEditing(false); }}>Save</Button><Button size="sm" variant="tertiary" onClick={() => { setTitle(m.title); setEditing(false); }}>Cancel</Button></div>;
}

function Details({ c, o, locked, onSaved }: { c: Course; o: Options | null; locked: boolean; onSaved: (c: Course) => void }) {
  const initial = () => ({ title: c.title, slug: c.slug, summary: c.summary, audience: c.audience, packageIds: c.packageIds, coverAssetId: c.coverAssetId ?? '' });
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { setF(initial()); }, [c.id, c.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    setBusy(true); setErr('');
    try { onSaved(await api.patch(`/admin/courses/${c.id}`, { title: f.title.trim(), slug: f.slug.trim(), summary: f.summary.trim(), audience: f.audience, packageIds: f.audience === 'packages' ? f.packageIds : [], coverAssetId: f.coverAssetId || null })); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <Card><CardHead eyebrow="Details" title="Course" />
    <div className="form">
      <Field label="Title"><Input value={f.title} maxLength={160} disabled={locked} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <Field label="Slug" hint="Lower-case letters, digits and hyphens."><Input value={f.slug} maxLength={60} disabled={locked} onChange={(e) => setF({ ...f, slug: e.target.value })} /></Field>
      <Field label="Summary" optional><Textarea value={f.summary} maxLength={600} disabled={locked} onChange={(e) => setF({ ...f, summary: e.target.value })} /></Field>
      <Field label="Who can take it" hint={AUDIENCES.find((a) => a.id === f.audience)?.hint}><Select value={f.audience} disabled={locked} onChange={(e) => setF({ ...f, audience: e.target.value })}>{AUDIENCES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</Select></Field>
      {f.audience === 'packages' && (o ? <PackagePicker packages={o.packages} value={f.packageIds} onChange={(packageIds) => setF({ ...f, packageIds })} /> : <Skeleton rows={2} />)}
      <Field label="Cover image" optional hint="An image already in the website image library."><Select value={f.coverAssetId} disabled={locked || !o} onChange={(e) => setF({ ...f, coverAssetId: e.target.value })}><option value="">No cover</option>{o?.images.map((i) => <option key={i.id} value={i.id}>{i.alt || i.filename}</option>)}</Select></Field>
      {c.cover && <CourseCover cover={c.cover} />}
      {err && <Alert kind="error">{err}</Alert>}
      {!locked && <div><Button variant="primary" size="sm" busy={busy} onClick={save}>Save details</Button></div>}
    </div>
  </Card>;
}

function LessonDialog({ target, video, onClose, onSaved }: { target: { moduleId: string; lesson?: Lesson }; video: Course['video']; onClose: () => void; onSaved: () => void }) {
  const l = target.lesson;
  const [f, setF] = useState({ title: l?.title ?? '', kind: l?.kind ?? 'written', body: l?.body ?? '', minutes: l?.durationMinutes ? String(l.durationMinutes) : '' });
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toast = useToast();
  const minutes = f.minutes.trim() ? Number(f.minutes) : null;
  const badMinutes = minutes !== null && !(Number.isInteger(minutes) && minutes >= 1 && minutes <= 600);
  const save = async () => {
    setBusy(true); setErr('');
    const body = { title: f.title.trim(), kind: f.kind, body: f.body, durationMinutes: minutes };
    try { if (l) await api.patch(`/admin/lessons/${l.id}`, body); else await api.post(`/admin/course-modules/${target.moduleId}/lessons`, body); toast(l ? 'Lesson saved' : 'Lesson added as a draft'); onSaved(); onClose(); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <Dialog open onClose={onClose} title={l ? 'Edit lesson' : 'New lesson'} footer={<><Button variant="tertiary" onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={f.title.trim().length < 2 || badMinutes} onClick={save}>{l ? 'Save' : 'Add as a draft'}</Button></>}>
    <div className="form">
      <Field label="Title"><Input value={f.title} maxLength={160} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <Field label="Kind"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</Select></Field>
        <Field label="Minutes" optional hint="Only if the author gives one." error={badMinutes ? 'A whole number from 1 to 600' : undefined}><Input value={f.minutes} inputMode="numeric" onChange={(e) => setF({ ...f, minutes: e.target.value })} /></Field>
      </div>
      {f.kind === 'video' && video.status !== 'live' && <Alert kind="warning" title="Video hosting: pending configuration">A video lesson can be written as a draft but not published. Missing: {video.missing.join('; ')}.</Alert>}
      <Field label={f.kind === 'video' ? 'Text shown with the video' : f.kind === 'checklist' ? 'Lesson text and the checklist' : 'Lesson text'} hint={'Allowed: <p> <br> <strong> <em> <ul> <ol> <li> <h3> <a href="https://… or /…">. Everything else is removed when saved.'}>
        <Textarea className="bp-textarea lrnBody" value={f.body} maxLength={20000} onChange={(e) => setF({ ...f, body: e.target.value })} />
      </Field>
      <div><Button size="sm" variant="tertiary" onClick={() => setPreview((p) => !p)}>{preview ? 'Hide preview' : 'Preview'}</Button></div>
      {preview && <div className="bp-tile"><LessonBody html={f.body} /></div>}
      {err && <Alert kind="error">{err}</Alert>}
    </div>
  </Dialog>;
}
