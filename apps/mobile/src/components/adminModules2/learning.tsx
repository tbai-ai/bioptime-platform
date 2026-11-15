/* M10 Learning in the administrative portal: the pieces of the course list and the course editor (the web's
   modules/learning/AdminCourses.tsx and CourseEditor.tsx), from the existing primitives and tokens only.
   CreateCourseSheet { open, onClose, onCreated }   "New course": Title, Summary, Who can take it, packages → POST /admin/courses
   CoverPicker       { value, onChange, images, current, disabled, onLibraryChanged }   "Cover image": the website images
                     GET /admin/learning/options offers, as tiles, and "No cover"; an administrator who also holds
                     content.manage can open the website image library (components/adminB2/ImageLibrary) to upload a new
                     image and choose it. The course stores only the image's id (alternative text stays the library's).
   LessonSheet       { target, video, onClose, onSaved }   "New lesson" / "Edit lesson": Title, Kind, Minutes, the text with
                     a preview of what learners read → POST /admin/course-modules/:id/lessons or PATCH /admin/lessons/:id
   ModuleTitle       { title, disabled, onSave }   the module's eyebrow with "Rename" → an inline field, "Save" / "Cancel" */
import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { errorText, patch, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { apiBaseSync, remoteImage } from '@/lib/config';
import { AUDIENCES, KINDS, audienceHint, minutesOf, type Course, type Lesson, type LearningOptions, type VideoStatus } from '@/lib/admin/modules2/learning';
import { ImageLibrary } from '@/components/adminB2/ImageLibrary';
import { LessonBody } from '@/components/coachLearning/parts';
import { PickerField } from '@/components/coachModules/shared';
import { Button, Eyebrow, Field, Input, Loading, Notice, P, Row } from '@/components/ui';
import { Sheet } from '@/components/workspace';
import { CheckList } from './frame';
import { colors, font, radius, space } from '@/theme';

const uri = (url: string) => (/^https?:\/\//i.test(url) ? url : `${apiBaseSync()}${url.startsWith('/') ? '' : '/'}${url}`);
const multiline = { minHeight: 90, textAlignVertical: 'top' as const };

/** The packages a package course comes with, as checkboxes (" (not active)" for an inactive one). */
export function PackagePicker({ packages, value, onChange, disabled, error }: { packages: LearningOptions['packages']; value: string[]; onChange: (ids: string[]) => void; disabled?: boolean; error?: string }) {
  return <CheckList label="Packages" error={error} disabled={disabled} options={packages.map((p) => ({ value: p.id, label: `${p.name}${p.active ? '' : ' (not active)'}` }))} value={value} onChange={onChange} />;
}

export function CreateCourseSheet({ open, options, onClose, onCreated }: { open: boolean; options: LearningOptions | null; onClose: () => void; onCreated: (c: Course) => void }) {
  const [f, setF] = useState({ title: '', summary: '', audience: 'all_members', packageIds: [] as string[] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (open) { setF({ title: '', summary: '', audience: 'all_members', packageIds: [] }); setErr(''); } }, [open]);
  const create = async () => {
    setBusy(true); setErr('');
    try { const c = await post<Course>('/admin/courses', { title: f.title.trim(), summary: f.summary.trim(), audience: f.audience, ...(f.audience === 'packages' ? { packageIds: f.packageIds } : {}) }); onClose(); onCreated(c); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <Sheet open={open} onClose={onClose} title="New course" footer={<Row><Button title="Not now" variant="ghost" onPress={onClose} disabled={busy} /><Button title="Create the draft" busy={busy} disabled={f.title.trim().length < 2} onPress={create} style={{ flex: 1 }} /></Row>}>
    <Field label="Title"><Input value={f.title} maxLength={160} onChangeText={(title) => setF({ ...f, title })} accessibilityLabel="Title" /></Field>
    <Field label="Summary (optional)" hint="One or two sentences learners read before starting."><Input value={f.summary} maxLength={600} onChangeText={(summary) => setF({ ...f, summary })} multiline style={multiline} accessibilityLabel="Summary" /></Field>
    <PickerField label="Who can take it" hint={audienceHint(f.audience)} value={f.audience} options={AUDIENCES.map((a) => ({ value: a.id, label: a.label }))} onChange={(audience) => setF({ ...f, audience })} />
    {f.audience === 'packages' ? (options ? <PackagePicker packages={options.packages} value={f.packageIds} onChange={(packageIds) => setF({ ...f, packageIds })} /> : <Loading />) : null}
    {err ? <Notice kind="error">{err}</Notice> : null}
  </Sheet>;
}

export function CoverPicker({ value, onChange, images, current, disabled, onLibraryChanged }: { value: string; onChange: (id: string) => void; images: LearningOptions['images'] | null; current: Course['cover']; disabled?: boolean; onLibraryChanged: () => void }) {
  const { can } = useAuth();
  const [library, setLibrary] = useState(false);
  const chosen = value ? images?.find((i) => i.id === value) : undefined;
  const shownUrl = value ? (current && (current.assetId ?? '') === value ? current.url : chosen?.url ?? `/api/public/assets/${value}`) : null;
  return <Field label="Cover image (optional)" hint="An image already in the website image library.">
    <View style={{ gap: space.sm }}>
      {shownUrl ? <Image source={remoteImage(uri(shownUrl))} accessibilityLabel="The chosen cover" contentFit="cover" style={styles.cover} /> : null}
      {!images ? <Loading /> : <View style={styles.grid}>
        <Tile label="No cover" selected={!value} disabled={disabled} onPress={() => onChange('')} />
        {images.map((i) => <Tile key={i.id} label={i.alt || i.filename} url={i.url} selected={value === i.id} disabled={disabled} onPress={() => onChange(i.id)} />)}
      </View>}
      {can('content.manage') && !disabled ? <Button title="Open the image library" variant="secondary" small onPress={() => setLibrary(true)} style={{ alignSelf: 'flex-start' }} /> : null}
    </View>
    <Sheet open={library} onClose={() => setLibrary(false)} title="Image library">
      <P muted small>Choose an image, or upload one to the website image library and use it as the cover. Its alternative text stays with the image in the library.</P>
      <ImageLibrary value={null} onChange={(v) => { if (v) { onChange(v.assetId); onLibraryChanged(); setLibrary(false); } }} />
    </Sheet>
  </Field>;
}

function Tile({ label, url, selected, disabled, onPress }: { label: string; url?: string; selected: boolean; disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected, disabled: !!disabled }} accessibilityLabel={`Cover: ${label}`} disabled={disabled} onPress={onPress} style={[styles.tile, selected && { borderColor: colors.brand }, disabled && { opacity: 0.6 }]}>
    {url ? <Image source={remoteImage(uri(url))} accessibilityLabel={label} contentFit="cover" style={styles.thumb} /> : <View style={[styles.thumb, { alignItems: 'center', justifyContent: 'center' }]}><Text style={styles.tileText}>—</Text></View>}
    <Text style={styles.tileText} numberOfLines={2}>{label}</Text>
  </Pressable>;
}

export function LessonSheet({ target, video, onClose, onSaved }: { target: { moduleId: string; lesson?: Lesson } | null; video: VideoStatus; onClose: () => void; onSaved: (msg: string) => void }) {
  const l = target?.lesson;
  const [f, setF] = useState({ title: '', kind: 'written', body: '', minutes: '' });
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!target) return;
    setF({ title: l?.title ?? '', kind: l?.kind ?? 'written', body: l?.body ?? '', minutes: l?.durationMinutes ? String(l.durationMinutes) : '' });
    setPreview(false); setErr('');
  }, [target, l]);
  const minutes = minutesOf(f.minutes);
  const save = async () => {
    if (!target) return;
    setBusy(true); setErr('');
    const body = { title: f.title.trim(), kind: f.kind, body: f.body, durationMinutes: minutes.value };
    try {
      if (l) await patch(`/admin/lessons/${l.id}`, body); else await post(`/admin/course-modules/${target.moduleId}/lessons`, body);
      onSaved(l ? 'Lesson saved' : 'Lesson added as a draft'); onClose();
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const bodyLabel = f.kind === 'video' ? 'Text shown with the video' : f.kind === 'checklist' ? 'Lesson text and the checklist' : 'Lesson text';
  return <Sheet open={!!target} onClose={onClose} title={l ? 'Edit lesson' : 'New lesson'} footer={<Row><Button title="Cancel" variant="ghost" onPress={onClose} disabled={busy} /><Button title={l ? 'Save' : 'Add as a draft'} busy={busy} disabled={f.title.trim().length < 2 || minutes.bad} onPress={save} style={{ flex: 1 }} /></Row>}>
    <Field label="Title"><Input value={f.title} maxLength={160} onChangeText={(title) => setF({ ...f, title })} accessibilityLabel="Title" /></Field>
    <PickerField label="Kind" value={f.kind} options={KINDS.map((k) => ({ value: k.id, label: k.label }))} onChange={(kind) => setF({ ...f, kind })} />
    <Field label="Minutes (optional)" hint="Only if the author gives one." error={minutes.bad ? 'A whole number from 1 to 600' : undefined}><Input value={f.minutes} keyboardType="number-pad" maxLength={4} onChangeText={(m) => setF({ ...f, minutes: m.replace(/[^\d]/g, '') })} accessibilityLabel="Minutes" /></Field>
    {f.kind === 'video' && video.status !== 'live' ? <Notice kind="warning" title="Video hosting: pending configuration">{`A video lesson can be written as a draft but not published. Missing: ${video.missing.join('; ')}.`}</Notice> : null}
    <Field label={bodyLabel} hint={'Allowed: <p> <br> <strong> <em> <ul> <ol> <li> <h3> <a href="https://… or /…">. Everything else is removed when saved.'}>
      <Input value={f.body} maxLength={20000} onChangeText={(body) => setF({ ...f, body })} multiline autoCapitalize="none" style={{ minHeight: 160, textAlignVertical: 'top' }} accessibilityLabel={bodyLabel} />
    </Field>
    <Button title={preview ? 'Hide preview' : 'Preview'} variant="ghost" small onPress={() => setPreview((p) => !p)} style={{ alignSelf: 'flex-start' }} />
    {preview ? <View style={styles.preview}><LessonBody html={f.body} fallback="Nothing to show yet." /></View> : null}
    {err ? <Notice kind="error">{err}</Notice> : null}
  </Sheet>;
}

export function ModuleTitle({ title, disabled, onSave }: { title: string; disabled: boolean; onSave: (title: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  useEffect(() => setValue(title), [title]);
  if (!editing) return <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flex: 1, minWidth: 0, flexWrap: 'wrap' }}><Eyebrow>{title}</Eyebrow>{!disabled ? <Button title="Rename" variant="ghost" small onPress={() => setEditing(true)} /> : null}</View>;
  return <View style={{ flex: 1, gap: space.xs }}>
    <Input value={value} maxLength={160} onChangeText={setValue} accessibilityLabel="Module title" />
    <Row><Button title="Save" small disabled={value.trim().length < 2} onPress={() => { onSave(value.trim()); setEditing(false); }} /><Button title="Cancel" variant="ghost" small onPress={() => { setValue(title); setEditing(false); }} /></Row>
  </View>;
}

const styles = StyleSheet.create({
  cover: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius.md, backgroundColor: colors.raised },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: { width: '31%', flexGrow: 1, maxWidth: '48%', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.base, overflow: 'hidden' },
  thumb: { width: '100%', height: 64, backgroundColor: colors.raised },
  tileText: { color: colors.muted, fontSize: font.tiny, padding: space.xs },
  preview: { backgroundColor: colors.base, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.md },
});
