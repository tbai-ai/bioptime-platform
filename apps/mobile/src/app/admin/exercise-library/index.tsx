/* Admin › Exercise library (the web's /admin/exercise-library, modules/workouts/ExerciseLibrary.tsx admin mode; workouts
   module, library.manage): every exercise and workout template coaches build programmes from. Coach proposals wait here
   for review. Exercises: add, edit, publish, return to draft and archive, each status change with a reason; templates:
   the team's and the coaches' own, a new team template (the editor at /admin/exercise-library/templates/[id], the web's
   /admin/workout-templates/:id), and publish or archive a team template with a reason. Exercises are text only:
   demonstration media stays pending configuration until it is licensed and a video host exists.
   GET /admin/exercises?q&category&status → { items, media }; POST /admin/exercises, PATCH …/:id, POST …/:id/status;
   GET /admin/workout-templates → { items }; POST /admin/workout-templates/:id/status { status, reason }. */
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { errorText, get, patch, post, qs } from '@/lib/api';
import { fmtDate, label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { CATEGORIES, plural, sourceLabel, statusPill, type ExerciseList, type Exercise, type TemplateRow } from '@/lib/coach/workouts';
import { commaList } from '@/lib/admin/modules2/libraries';
import { exerciseStatusDialog, templateStatusDialog } from '@/lib/admin/modules2/libraries';
import { ReasonSheet } from '@/components/adminA/ReasonSheet';
import { useToast, type ToastKind } from '@/components/adminA/toast';
import { PickerField, fieldErrorsOf } from '@/components/coachModules/shared';
import { Button, Card, ErrorBox, Field, Input, Loading, Notice, Row, Screen, StaleBanner, Title } from '@/components/ui';
import { EmptyState, FilterChips, RecordList, SearchBar, SegmentTabs, Sheet } from '@/components/workspace';
import { AdminModuleGate, ItemRow, SectionCard, useDebounced } from '@/components/adminModules2/frame';
import { Enter } from '@/motion';

const TITLE = 'Exercise library';
type Tab = 'exercises' | 'templates';
/** The screen's toast, shown floating over the page wherever the action was taken (both tabs share it). */
type Toaster = { show: (text: string, kind?: ToastKind) => void };

export default function AdminExerciseLibraryScreen() {
  return <AdminModuleGate title={TITLE} module="workouts" permission="library.manage"><Body /></AdminModuleGate>;
}

function Body() {
  const [tab, setTab] = useState<Tab>('exercises');
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(false);
  const toast = useToast();
  return <View style={{ flex: 1 }}><Screen refreshing={loading} onRefresh={() => setTick((n) => n + 1)}>
    <Enter><Title sub="The exercises and team templates coaches build programmes from. Coach proposals wait here for review.">{TITLE}</Title></Enter>
    <SegmentTabs items={[{ id: 'exercises', label: 'Exercises' }, { id: 'templates', label: 'Templates' }]} value={tab} onChange={(v) => setTab(v as Tab)} />
    {tab === 'exercises' ? <Exercises tick={tick} onLoading={setLoading} toast={toast} /> : <Templates tick={tick} onLoading={setLoading} toast={toast} />}
  </Screen>{toast.float}</View>;
}

type Draft = { name: string; description: string; instructions: string; category: string; equipment: string; muscleGroups: string };
const EMPTY: Draft = { name: '', description: '', instructions: '', category: 'strength', equipment: '', muscleGroups: '' };
const area = { minHeight: 80, textAlignVertical: 'top' as const };

function Exercises({ tick, onLoading, toast }: { tick: number; onLoading: (b: boolean) => void; toast: Toaster }) {
  const [q, setQ] = useState('');
  const search = useDebounced(q.trim());
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const query = qs({ q: search, category, status });
  const data = useLoad<ExerciseList>(`admin-exercises${query}`, () => get(`/admin/exercises${query}`), [query, tick]);
  useEffect(() => { onLoading(data.loading); }, [data.loading, onLoading]);
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [statusDlg, setStatusDlg] = useState<{ e: Exercise; to: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const d = data.data;
  const items = d?.items ?? [];
  const open = (e?: Exercise) => { setErr(''); setErrs({}); setEditing(e ? { id: e.id, draft: { name: e.name, description: e.description, instructions: e.instructions, category: e.category, equipment: (e.equipment ?? []).join(', '), muscleGroups: (e.muscleGroups ?? []).join(', ') } } : { id: null, draft: { ...EMPTY } }); };
  const setDraft = (p: Partial<Draft>) => setEditing((x) => (x ? { ...x, draft: { ...x.draft, ...p } } : x));
  const save = async () => {
    if (!editing) return;
    setBusy(true); setErr(''); setErrs({});
    const body = { name: editing.draft.name, description: editing.draft.description, instructions: editing.draft.instructions, category: editing.draft.category, equipment: commaList(editing.draft.equipment), muscleGroups: commaList(editing.draft.muscleGroups) };
    try {
      if (editing.id) { await patch(`/admin/exercises/${editing.id}`, body); toast.show('Exercise saved'); }
      else { await post('/admin/exercises', { ...body, status: 'draft' }); toast.show('Draft exercise added'); }
      setEditing(null); void data.reload();
    } catch (e) { setErrs(fieldErrorsOf(e)); setErr(errorText(e)); } finally { setBusy(false); }
  };
  const dlg = statusDlg ? exerciseStatusDialog(statusDlg.to, statusDlg.e.name) : null;
  return <>
    {d?.media ? <Notice kind="info" title="Demonstration media: pending configuration">{`Exercises are text only. Missing: ${(d.media.missing ?? []).join('; ')}.`}</Notice> : null}
    <SectionCard eyebrow="All entries" title={plural(items.length, 'exercise')} right={<Button title="Add exercise" small onPress={() => open()} />}>
      <SearchBar value={q} onChangeText={setQ} placeholder="Search by name" />
      <FilterChips options={[{ value: '', label: 'Every category' }, ...CATEGORIES.map((c) => ({ value: c, label: label(c) }))]} value={category} onChange={(v) => setCategory(String(v))} />
      <FilterChips options={[{ value: '', label: 'Every status' }, ...['draft', 'published', 'archived'].map((s) => ({ value: s, label: label(s) }))]} value={status} onChange={(v) => setStatus(String(v))} />
    </SectionCard>
    <StaleBanner at={data.stale} />
    <ErrorBox error={data.error} onRetry={data.reload} />
    {data.loading && !d ? <Loading /> : d ? (items.length ? <RecordList title="Exercises">
      {items.map((e) => <ItemRow key={e.id} title={e.name}
        lines={[e.description || null, e.muscleGroups?.length ? e.muscleGroups.join(', ') : null, `Category: ${label(e.category)}`, `Equipment: ${e.equipment?.length ? e.equipment.join(', ') : 'None'}`, `Source: ${sourceLabel(e.source)}${e.authorName ? ` · ${e.authorName}` : ''}`, `Updated ${fmtDate(e.updatedAt)}`]}
        pills={[statusPill(e.status)]}
        actions={<>
          <Button title="Edit" variant="ghost" small onPress={() => open(e)} />
          {e.status !== 'published' ? <Button title="Publish" variant="secondary" small onPress={() => setStatusDlg({ e, to: 'published' })} /> : null}
          {e.status === 'published' ? <Button title="To draft" variant="ghost" small onPress={() => setStatusDlg({ e, to: 'draft' })} /> : null}
          {e.status !== 'archived' ? <Button title="Archive" variant="ghost" small onPress={() => setStatusDlg({ e, to: 'archived' })} /> : null}
        </>} />)}
    </RecordList> : <Card><EmptyState title="No exercises match" body="Add the first one, or clear the filters." /></Card>) : null}
    <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit exercise' : 'Add an exercise'} footer={<Row><Button title="Cancel" variant="ghost" onPress={() => setEditing(null)} disabled={busy} /><Button title="Save" busy={busy} onPress={save} style={{ flex: 1 }} /></Row>}>
      {editing ? <>
        <Field label="Name" error={errs.name}><Input value={editing.draft.name} maxLength={120} onChangeText={(name) => setDraft({ name })} accessibilityLabel="Name" /></Field>
        <PickerField label="Category" value={editing.draft.category} options={CATEGORIES.map((c) => ({ value: c, label: label(c) }))} onChange={(category) => setDraft({ category })} error={errs.category} />
        <Field label="Description (optional)" error={errs.description}><Input value={editing.draft.description} onChangeText={(description) => setDraft({ description })} multiline style={area} accessibilityLabel="Description" /></Field>
        <Field label="Instructions (optional)" hint="How to perform it, in plain steps. No medical, rehabilitation or injury-prevention claims." error={errs.instructions}><Input value={editing.draft.instructions} onChangeText={(instructions) => setDraft({ instructions })} multiline style={area} accessibilityLabel="Instructions" /></Field>
        <Field label="Equipment (comma separated) (optional)" error={errs.equipment}><Input value={editing.draft.equipment} onChangeText={(equipment) => setDraft({ equipment })} accessibilityLabel="Equipment (comma separated)" /></Field>
        <Field label="Muscle groups (comma separated) (optional)" error={errs.muscleGroups}><Input value={editing.draft.muscleGroups} onChangeText={(muscleGroups) => setDraft({ muscleGroups })} accessibilityLabel="Muscle groups (comma separated)" /></Field>
        {err ? <Notice kind="error">{err}</Notice> : null}
      </> : null}
    </Sheet>
    <ReasonSheet open={!!statusDlg} onClose={() => setStatusDlg(null)} title={dlg?.title ?? ''} body={dlg?.body} confirmLabel="Confirm" destructive={!!dlg?.danger}
      onConfirm={async (reason) => { const s = statusDlg; if (!s) return; await post(`/admin/exercises/${s.e.id}/status`, { status: s.to, reason }); toast.show('Status changed'); void data.reload(); }} />
  </>;
}

function Templates({ tick, onLoading, toast }: { tick: number; onLoading: (b: boolean) => void; toast: Toaster }) {
  const router = useRouter();
  const data = useLoad<{ items: TemplateRow[] }>('admin-workout-templates', () => get('/admin/workout-templates'), [tick]);
  useEffect(() => { onLoading(data.loading); }, [data.loading, onLoading]);
  const first = useRef(true);
  useFocusEffect(useCallback(() => { if (first.current) { first.current = false; return; } void data.reload(); }, [data.reload])); // eslint-disable-line react-hooks/exhaustive-deps
  const [statusDlg, setStatusDlg] = useState<{ t: TemplateRow; to: string } | null>(null);
  const items = data.data?.items ?? [];
  const dlg = statusDlg ? templateStatusDialog(statusDlg.to, statusDlg.t.title) : null;
  return <>
    <SectionCard eyebrow="Team templates and coaches’ own" title={plural(items.length, 'template')} right={<Button title="New team template" small onPress={() => router.push('/admin/exercise-library/templates/new')} />} />
    <StaleBanner at={data.stale} />
    <ErrorBox error={data.error} onRetry={data.reload} />
    {data.loading && !data.data ? <Loading /> : data.data ? (items.length ? <RecordList title="Workout templates">
      {items.map((t) => <ItemRow key={t.id} title={t.title}
        lines={[t.description || null, `Source: ${sourceLabel(t.source)}${t.authorName ? ` · ${t.authorName}` : ''}`, `Level: ${t.level ? label(t.level) : '—'} · Exercises: ${t.itemCount}`]}
        pills={[statusPill(t.status)]}
        onPress={() => router.push(`/admin/exercise-library/templates/${t.id}`)}
        actions={<>
          <Button title={t.source === 'team' ? 'Edit' : 'View'} variant="ghost" small onPress={() => router.push(`/admin/exercise-library/templates/${t.id}`)} />
          {t.source === 'team' && t.status !== 'published' ? <Button title="Publish" variant="secondary" small onPress={() => setStatusDlg({ t, to: 'published' })} /> : null}
          {t.source === 'team' && t.status !== 'archived' ? <Button title="Archive" variant="ghost" small onPress={() => setStatusDlg({ t, to: 'archived' })} /> : null}
        </>} />)}
    </RecordList> : <Card><EmptyState title="No templates yet" body="Team templates are shared with every coach once published." /></Card>) : null}
    <ReasonSheet open={!!statusDlg} onClose={() => setStatusDlg(null)} title={dlg?.title ?? ''} body={dlg?.body} confirmLabel="Confirm" destructive={!!dlg?.danger}
      onConfirm={async (reason) => { const s = statusDlg; if (!s) return; await post(`/admin/workout-templates/${s.t.id}/status`, { status: s.to, reason }); toast.show('Status changed'); void data.reload(); }} />
  </>;
}
