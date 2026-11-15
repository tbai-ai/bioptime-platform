/* Admin › one course (the web's /admin/learning/:id, modules/learning/CourseEditor.tsx; learning.manage): its outline
   (modules and lessons in order: move up or down, rename, add, remove an empty module; per lesson edit, publish or
   unpublish, delete a draft), its details and audience with the cover image, its enrolments, and the course's status
   (publish needs a published lesson; back to draft; archive), each status change with a reason for the audit log. A
   video lesson stays a draft while video hosting is pending configuration. An archived course is read only until it is
   restored as a draft. GET /admin/courses/:id, GET /admin/learning/options; POST /admin/courses/:id/publish|unpublish|
   archive { reason }, …/reorder { modules }, …/modules { title }; PATCH /admin/course-modules/:id { title }, DELETE …;
   POST /admin/lessons/:id/publish|unpublish, DELETE /admin/lessons/:id; PATCH /admin/courses/:id (Details). */
import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { api, errorText, get, patch, post } from '@/lib/api';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { AUDIENCES, audienceHint, coursePill, kindLabel, lessonCountText, orderBody, swap, type Course, type CourseModule, type LearningOptions, type Lesson } from '@/lib/admin/modules2/learning';
import { ReasonSheet } from '@/components/adminA/ReasonSheet';
import { useToast } from '@/components/adminA/toast';
import { ConfirmSheet, PickerField, StatusPill } from '@/components/coachModules/shared';
import { Button, Empty, ErrorBox, Field, Input, Loading, Notice, P, Pill, Row, Screen, Title } from '@/components/ui';
import { KeyValue } from '@/components/workspace';
import { AdminModuleGate, BackLink, Hint, IconButton, SectionCard } from '@/components/adminModules2/frame';
import { CoverPicker, LessonSheet, ModuleTitle, PackagePicker } from '@/components/adminModules2/learning';
import { Enter } from '@/motion';
import { colors, font, radius, space } from '@/theme';

type StatusAction = 'publish' | 'unpublish' | 'archive';
const STATUS_DIALOG: Record<StatusAction, { title: string; body: string; confirm: string; toast: string; danger?: boolean }> = {
  publish: { title: 'Publish this course?', body: 'Learners its audience admits can start it, and its published lessons become readable.', confirm: 'Publish', toast: 'Course published' },
  archive: { title: 'Archive this course?', body: 'Nobody new can start it. Learners already enrolled keep reading it.', confirm: 'Archive', toast: 'Course archived', danger: true },
  unpublish: { title: 'Return this course to draft?', body: 'It disappears from learners’ lists until it is published again. Their progress is kept.', confirm: 'Return to draft', toast: 'Course is a draft' },
};

export default function AdminCourseScreen() {
  return <AdminModuleGate title="Course" module="learning" permission="learning.manage"><Body /></AdminModuleGate>;
}

function Body() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const data = useLoad<Course>(`admin-course-${id}`, () => get(`/admin/courses/${id}`), [id]);
  const opts = useLoad<LearningOptions>('admin-learning-options', () => get('/admin/learning/options'), []);
  const [course, setCourse] = useState<Course | null>(null);
  const [status, setStatus] = useState<StatusAction | null>(null);
  const [lessonFor, setLessonFor] = useState<{ moduleId: string; lesson?: Lesson } | null>(null);
  const [newModule, setNewModule] = useState('');
  const [busy, setBusy] = useState(false);
  const [remove, setRemove] = useState<{ kind: 'module' | 'lesson'; id: string; title: string } | null>(null);
  useEffect(() => { if (data.data) setCourse(data.data); }, [data.data]);
  const c = course;
  const locked = c?.status === 'archived';
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { const r = await fn(); if (r && typeof r === 'object' && 'modules' in (r as object)) setCourse(r as Course); else void data.reload(); toast.show(ok); }
    catch (e) { toast.show(errorText(e), 'error'); } finally { setBusy(false); }
  };
  const moveModule = (i: number, d: -1 | 1) => c && run(() => post(`/admin/courses/${c.id}/reorder`, orderBody(swap(c.modules, i, i + d))), 'Order saved');
  const moveLesson = (mi: number, li: number, d: -1 | 1) => c && run(() => post(`/admin/courses/${c.id}/reorder`, orderBody(c.modules.map((m, k) => (k === mi ? { ...m, lessons: swap(m.lessons, li, li + d) } : m)))), 'Order saved');
  const lessonStatus = (l: Lesson, to: 'publish' | 'unpublish') => c && run(async () => { await post(`/admin/lessons/${l.id}/${to}`); return get(`/admin/courses/${c.id}`); }, to === 'publish' ? 'Lesson published' : 'Lesson back to draft');
  const addModule = () => c && run(async () => { const r = await post(`/admin/courses/${c.id}/modules`, { title: newModule.trim() }); setNewModule(''); return r; }, 'Module added');

  return <View style={{ flex: 1 }}><Screen refreshing={data.loading} onRefresh={() => { void data.reload(); void opts.reload(); }}>
    <BackLink title="← Courses" href="/admin/learning" />
    <Enter><Title sub={c ? `${c.slug} · created ${fmtDate(c.createdAt)}${c.createdByName ? ` by ${c.createdByName}` : ''} · updated ${fmtDateTime(c.updatedAt)}${c.publishedAt ? ` · published ${fmtDate(c.publishedAt)}` : ''}` : undefined}>{c?.title ?? 'Course'}</Title></Enter>
    <ErrorBox error={data.error} onRetry={data.reload} />
    {!c ? (data.error ? null : <Loading />) : <>
      <Enter index={1}><Row>
        <Pill tone={coursePill(c.status).tone}>{coursePill(c.status).label}</Pill>
        {c.status === 'draft' ? <Button title="Publish" small onPress={() => setStatus('publish')} /> : null}
        {c.status !== 'draft' ? <Button title={c.status === 'archived' ? 'Restore as draft' : 'Back to draft'} variant="secondary" small onPress={() => setStatus('unpublish')} /> : null}
        {c.status !== 'archived' ? <Button title="Archive" variant="ghost" small onPress={() => setStatus('archive')} /> : null}
      </Row></Enter>
      {locked ? <Notice kind="info">This course is archived: learners already enrolled can still read it; nobody new can start it. Restore it as a draft to edit it.</Notice> : null}
      {c.status === 'draft' && !c.lessonCounts.published ? <Notice kind="info">Publish at least one lesson before publishing the course.</Notice> : null}

      <Enter index={2}><SectionCard eyebrow="Outline" title="Modules and lessons">
        <Hint>{lessonCountText(c.lessonCounts)}</Hint>
        {c.modules.length ? c.modules.map((m, mi) => <ModuleTile key={m.id} m={m} mi={mi} count={c.modules.length} locked={!!locked} busy={busy} videoLive={c.video.status === 'live'}
          onRename={(title) => run(() => patch(`/admin/course-modules/${m.id}`, { title }), 'Module renamed')}
          onMove={(d) => moveModule(mi, d)} onRemove={() => setRemove({ kind: 'module', id: m.id, title: m.title })}
          onMoveLesson={(li, d) => moveLesson(mi, li, d)} onEdit={(l) => setLessonFor({ moduleId: m.id, lesson: l })}
          onLessonStatus={lessonStatus} onDelete={(l) => setRemove({ kind: 'lesson', id: l.id, title: l.title })} onAdd={() => setLessonFor({ moduleId: m.id })} />)
          : <Empty title="No modules yet" body="A course is made of modules, each with its lessons. Add the first module below." />}
        {!locked ? <View style={{ gap: space.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.md }}>
          <Input value={newModule} maxLength={160} placeholder="New module title" onChangeText={setNewModule} accessibilityLabel="New module title" />
          <Button title="Add module" variant="secondary" small disabled={busy || newModule.trim().length < 2} onPress={() => void addModule()} style={{ alignSelf: 'flex-start' }} />
        </View> : null}
      </SectionCard></Enter>

      <Enter index={3}><Details c={c} o={opts.data} locked={!!locked} onSaved={(r) => { setCourse(r); toast.show('Course saved'); }} onLibraryChanged={() => void opts.reload()} /></Enter>
      <Enter index={4}><SectionCard eyebrow="Learners" title="Enrolments">
        <KeyValue rows={[['In progress', String(c.enrolments.active)], ['Completed', String(c.enrolments.completed)], ['Left', String(c.enrolments.withdrawn)]]} />
      </SectionCard></Enter>
      {c.video.status !== 'live' ? <Notice kind="info" title="Video lessons: pending configuration">{`${c.video.note} Missing: ${c.video.missing.join('; ')}.`}</Notice> : null}

      <ReasonSheet open={!!status} onClose={() => setStatus(null)} title={status ? STATUS_DIALOG[status].title : ''} body={status ? STATUS_DIALOG[status].body : undefined} confirmLabel={status ? STATUS_DIALOG[status].confirm : 'Confirm'} destructive={!!status && !!STATUS_DIALOG[status].danger}
        onConfirm={async (reason) => { const to = status; if (!to) return; const r = await post<Course>(`/admin/courses/${c.id}/${to}`, { reason }); setCourse(r); toast.show(STATUS_DIALOG[to].toast); }} />
      <ConfirmSheet open={!!remove} onClose={() => setRemove(null)} destructive title={remove?.kind === 'module' ? 'Remove this module?' : 'Delete this lesson?'} confirmLabel={remove?.kind === 'module' ? 'Remove' : 'Delete'} busy={busy}
        body={`“${remove?.title ?? ''}” is removed. ${remove?.kind === 'lesson' ? 'A lesson a learner has opened cannot be deleted; keep it as a draft instead.' : ''}`.trim()}
        onConfirm={async () => { const r = remove; if (!r) return; setRemove(null); await run(() => api('DELETE', r.kind === 'module' ? `/admin/course-modules/${r.id}` : `/admin/lessons/${r.id}`), r.kind === 'module' ? 'Module removed' : 'Lesson deleted'); }} />
      <LessonSheet target={lessonFor} video={c.video} onClose={() => setLessonFor(null)} onSaved={(msg) => { toast.show(msg); void data.reload(); }} />
    </>}
  </Screen>{toast.float}</View>;
}

function ModuleTile({ m, mi, count, locked, busy, videoLive, onRename, onMove, onRemove, onMoveLesson, onEdit, onLessonStatus, onDelete, onAdd }: {
  m: CourseModule; mi: number; count: number; locked: boolean; busy: boolean; videoLive: boolean; onRename: (t: string) => void; onMove: (d: -1 | 1) => void; onRemove: () => void;
  onMoveLesson: (li: number, d: -1 | 1) => void; onEdit: (l: Lesson) => void; onLessonStatus: (l: Lesson, to: 'publish' | 'unpublish') => void; onDelete: (l: Lesson) => void; onAdd: () => void;
}) {
  return <View style={st.tile}>
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
      <ModuleTitle title={m.title} disabled={locked || busy} onSave={onRename} />
      {!locked ? <Row>
        <IconButton icon="arrow-up" label={`Move ${m.title} up`} disabled={busy || mi === 0} onPress={() => onMove(-1)} />
        <IconButton icon="arrow-down" label={`Move ${m.title} down`} disabled={busy || mi === count - 1} onPress={() => onMove(1)} />
      </Row> : null}
    </View>
    {!locked ? <Row>
      <Button title="Remove" variant="ghost" small disabled={busy || m.lessons.length > 0} onPress={onRemove} />
      {m.lessons.length ? <Text style={st.meta}>Move or delete its lessons first</Text> : null}
    </Row> : null}
    {m.lessons.length ? m.lessons.map((l, li) => <View key={l.id} style={st.lesson}>
      <Row between style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}><Text style={st.lessonTitle}>{l.title}</Text><StatusPill status={l.status} /></Row>
      <Text style={st.meta}>{`${kindLabel(l.kind)}${l.durationMinutes ? ` · ${l.durationMinutes} min` : ''} · completed by ${l.completedBy} · updated ${fmtDate(l.updatedAt)}`}</Text>
      {!locked ? <Row>
        <IconButton icon="arrow-up" label={`Move ${l.title} up`} disabled={busy || li === 0} onPress={() => onMoveLesson(li, -1)} />
        <IconButton icon="arrow-down" label={`Move ${l.title} down`} disabled={busy || li === m.lessons.length - 1} onPress={() => onMoveLesson(li, 1)} />
        <Button title="Edit" variant="secondary" small onPress={() => onEdit(l)} />
        {l.status === 'draft' ? <Button title="Publish" small disabled={busy} onPress={() => onLessonStatus(l, 'publish')} /> : <Button title="Unpublish" variant="ghost" small disabled={busy} onPress={() => onLessonStatus(l, 'unpublish')} />}
        {l.status === 'draft' ? <Button title="Delete" variant="ghost" small disabled={busy} onPress={() => onDelete(l)} /> : null}
      </Row> : null}
      {!locked && l.status === 'draft' && l.kind === 'video' && !videoLive ? <Text style={st.meta}>Needs a video host</Text> : null}
    </View>) : <P muted small>No lessons in this module yet.</P>}
    {!locked ? <Button title="Add a lesson" variant="secondary" small onPress={onAdd} style={{ alignSelf: 'flex-start' }} /> : null}
  </View>;
}

function Details({ c, o, locked, onSaved, onLibraryChanged }: { c: Course; o: LearningOptions | null; locked: boolean; onSaved: (c: Course) => void; onLibraryChanged: () => void }) {
  const initial = () => ({ title: c.title, slug: c.slug, summary: c.summary, audience: c.audience, packageIds: c.packageIds, coverAssetId: c.coverAssetId ?? '' });
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { setF(initial()); }, [c.id, c.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    setBusy(true); setErr('');
    try { onSaved(await patch<Course>(`/admin/courses/${c.id}`, { title: f.title.trim(), slug: f.slug.trim(), summary: f.summary.trim(), audience: f.audience, packageIds: f.audience === 'packages' ? f.packageIds : [], coverAssetId: f.coverAssetId || null })); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <SectionCard eyebrow="Details" title="Course">
    <Field label="Title"><Input value={f.title} maxLength={160} editable={!locked} onChangeText={(title) => setF({ ...f, title })} accessibilityLabel="Course title" /></Field>
    <Field label="Slug" hint="Lower-case letters, digits and hyphens."><Input value={f.slug} maxLength={60} editable={!locked} autoCapitalize="none" autoCorrect={false} onChangeText={(slug) => setF({ ...f, slug })} accessibilityLabel="Slug" /></Field>
    <Field label="Summary (optional)"><Input value={f.summary} maxLength={600} editable={!locked} multiline style={{ minHeight: 80, textAlignVertical: 'top' }} onChangeText={(summary) => setF({ ...f, summary })} accessibilityLabel="Summary" /></Field>
    <PickerField label="Who can take it" hint={audienceHint(f.audience)} value={f.audience} disabled={locked} options={AUDIENCES.map((a) => ({ value: a.id, label: a.label }))} onChange={(audience) => setF({ ...f, audience })} />
    {f.audience === 'packages' ? (o ? <PackagePicker packages={o.packages} value={f.packageIds} disabled={locked} onChange={(packageIds) => setF({ ...f, packageIds })} /> : <Loading />) : null}
    <CoverPicker value={f.coverAssetId} onChange={(coverAssetId) => setF({ ...f, coverAssetId })} images={o?.images ?? null} current={c.cover} disabled={locked || !o} onLibraryChanged={onLibraryChanged} />
    {err ? <Notice kind="error">{err}</Notice> : null}
    {!locked ? <Button title="Save details" small busy={busy} onPress={save} style={{ alignSelf: 'flex-start' }} /> : null}
  </SectionCard>;
}

const st = {
  tile: { backgroundColor: colors.base, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.md, gap: space.sm },
  lesson: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.sm, gap: space.xs },
  lessonTitle: { color: colors.text, fontSize: font.body, fontWeight: '700' as const, flex: 1 },
  meta: { color: colors.muted, fontSize: font.small },
};
