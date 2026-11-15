/* Coach › Libraries › Exercise library (the web's /coach/exercise-library, apps/dashboard/src/modules/workouts/
   ExerciseLibrary.tsx in coach mode). Two tabs:
   - Exercises: the published exercises and the coach's own proposals (GET /coach/exercise-library?q&category), searched
     by name and filtered by category; the demonstration-media notice (exercises are text only until licensed media and a
     video host exist); "Propose an exercise" (POST /coach/exercises: a draft the Bioptime team reviews, usable in the
     coach's own templates at once). A coach cannot edit or publish an exercise; the team does that from the admin library.
   - Templates: the published team templates and the coach's own (GET /coach/workout-templates[?includeArchived=1]), each
     opening the template editor (/coach/templates/:id; "New template" → /coach/templates/new).
   The web's tables become lists: one row per record, the other columns as a line under the name, a row opening its
   details. Flag: workouts. Coach endpoints only. */
import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { errorText, get, post, qs } from '@/lib/api';
import { fmtDate, label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { CATEGORIES, commaList, fieldErrorsOf, plural, sourceLabel, statusPill, type Exercise, type ExerciseList, type TemplateRow } from '@/lib/coach/workouts';
import { Button, Card, ErrorBox, Eyebrow, H2, Input, Loading, Notice, P, Row, Screen, StaleBanner, Title } from '@/components/ui';
import { EmptyState, FilterChips, KeyValue, RecordList, SearchBar, SegmentTabs, Sheet } from '@/components/workspace';
import { NotificationBell, RoleGate } from '@/components/workspaceShell';
import { useToast } from '@/components/adminA/toast';
import { InfoRow, ModuleGate, OptField, useRefreshOnFocus } from '@/components/coachWorkouts/parts';
import { SelectField } from '@/components/coachWorkouts/SelectField';
import { Enter, MotionCard } from '@/motion';
import { space } from '@/theme';

const TITLE = 'Exercise library';
type Tab = 'exercises' | 'templates';

export default function ExerciseLibraryScreen() {
  return <>
    <Stack.Screen options={{ title: TITLE, headerRight: () => <NotificationBell /> }} />
    <RoleGate workspace="coach"><ModuleGate flag="workouts"><Library /></ModuleGate></RoleGate>
  </>;
}

function Library() {
  const [tab, setTab] = useState<Tab>('exercises');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [archived, setArchived] = useState(false);
  const query = useDebounced(q.trim());
  const exercises = useLoad<ExerciseList>(`coach.exercise-library.${category}.${query}`, () => get(`/coach/exercise-library${qs({ q: query || undefined, category: category || undefined })}`), [query, category]);
  const templates = useLoad<{ items: TemplateRow[] }>(`coach.workout-templates.${archived ? 'all' : 'live'}`, () => get(`/coach/workout-templates${qs({ includeArchived: archived ? '1' : undefined })}`), [archived]);
  useRefreshOnFocus(() => { void templates.reload(); void exercises.reload(); }); // back from the template editor: what was saved, archived or restored
  const toast = useToast();
  const current = tab === 'exercises' ? exercises : templates;
  return <Screen refreshing={current.loading} onRefresh={current.reload}>
    <Enter><Title sub="Exercises and templates to build your clients’ workout programmes from. Propose an exercise and the Bioptime team reviews it.">{TITLE}</Title></Enter>
    <SegmentTabs items={[{ id: 'exercises', label: 'Exercises' }, { id: 'templates', label: 'Templates' }]} value={tab} onChange={(id) => setTab(id as Tab)} style={{ marginHorizontal: -space.lg }} />
    {toast.node}
    {tab === 'exercises'
      ? <Exercises data={exercises} q={q} setQ={setQ} category={category} setCategory={setCategory} onProposed={() => { toast.show('Proposed: the Bioptime team reviews it'); void exercises.reload(); }} />
      : <Templates data={templates} archived={archived} setArchived={setArchived} />}
  </Screen>;
}

function useDebounced(value: string, ms = 300): string {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

type Loaded<T> = ReturnType<typeof useLoad<T>>;

/* ---------- exercises ---------- */

function Exercises({ data, q, setQ, category, setCategory, onProposed }: { data: Loaded<ExerciseList>; q: string; setQ: (v: string) => void; category: string; setCategory: (v: string) => void; onProposed: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [proposing, setProposing] = useState(false);
  const d = data.data;
  const items = d?.items ?? [];
  return <View style={{ gap: space.md }}>
    {d?.media ? <Notice kind="info" title="Demonstration media: not available yet">Exercises are text only until licensed demonstration media and a video host are in place.</Notice> : null}
    <MotionCard index={1} pressable={false}><Card>
      <Row between><View style={{ flex: 1, minWidth: 160 }}><Eyebrow>Published and your drafts</Eyebrow><H2>{plural(items.length, 'exercise')}</H2></View><Button title="Propose an exercise" small onPress={() => setProposing(true)} /></Row>
      <SearchBar value={q} onChangeText={setQ} placeholder="Search by name" />
      <FilterChips options={[{ value: '', label: 'Every category' }, ...CATEGORIES.map((c) => ({ value: c, label: label(c) }))]} value={category} onChange={(v) => setCategory(String(v))} />
      <StaleBanner at={data.stale} />
      <ErrorBox error={data.error} onRetry={data.reload} />
      {!d && !data.error ? <Loading /> : d ? (items.length ? <RecordList title="Exercises">
        {items.map((e, i) => <ExerciseRow key={e.id} e={e} last={i === items.length - 1} open={open === e.id} onToggle={() => setOpen(open === e.id ? null : e.id)} />)}
      </RecordList> : <EmptyState title="No exercises match" body="Clear the filters, or propose one." icon="barbell-outline" />) : null}
    </Card></MotionCard>
    <ProposeSheet open={proposing} onClose={() => setProposing(false)} onSaved={() => { setProposing(false); onProposed(); }} />
  </View>;
}

function ExerciseRow({ e, open, onToggle, last }: { e: Exercise; open: boolean; onToggle: () => void; last: boolean }) {
  const pill = statusPill(e.status);
  const author = e.source === 'coach' && e.authorName ? ` · ${e.authorName}` : '';
  return <View>
    <InfoRow title={e.name} sub={e.description || null} extra={e.muscleGroups?.length ? e.muscleGroups.join(', ') : null}
      meta={`${label(e.category)} · ${e.equipment?.length ? e.equipment.join(', ') : 'None'} · ${sourceLabel(e.source)}${author}`}
      pills={[{ label: pill.label, tone: pill.tone }]} pillNote={fmtDate(e.updatedAt)} selected={open} onPress={onToggle} last={last && !open} />
    {open ? <View style={{ paddingBottom: space.md, gap: space.sm }}>
      <KeyValue rows={[
        ['Category', label(e.category)],
        ['Equipment', e.equipment?.length ? e.equipment.join(', ') : 'None'],
        ['Muscle groups', e.muscleGroups?.length ? e.muscleGroups.join(', ') : '—'],
        ['Source', `${sourceLabel(e.source)}${author}`],
        ['Status', `${pill.label} · ${fmtDate(e.updatedAt)}`],
      ]} />
      {e.instructions ? <View><Eyebrow>Instructions</Eyebrow><P small>{e.instructions}</P></View> : null}
    </View> : null}
  </View>;
}

type Draft = { name: string; description: string; instructions: string; category: string; equipment: string; muscleGroups: string };
const EMPTY: Draft = { name: '', description: '', instructions: '', category: 'strength', equipment: '', muscleGroups: '' };

/** The web's dialog in coach mode: every field it has, sent as it sends them; the server's schema decides (exerciseInputSchema). */
function ProposeSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setD({ ...EMPTY }); setErr(''); setErrs({}); } }, [open]);
  const set = (k: keyof Draft) => (v: string) => setD((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setBusy(true); setErr(''); setErrs({});
    try {
      await post('/coach/exercises', { name: d.name, description: d.description, instructions: d.instructions, category: d.category, equipment: commaList(d.equipment), muscleGroups: commaList(d.muscleGroups) });
      onSaved();
    } catch (e) { setErrs(fieldErrorsOf(e)); setErr(errorText(e)); } finally { setBusy(false); }
  };
  const multi = { multiline: true, numberOfLines: 3, style: { minHeight: 76, textAlignVertical: 'top' as const } };
  return <Sheet open={open} onClose={onClose} title="Propose an exercise" footer={<View style={{ flexDirection: 'row', gap: space.sm }}><Button title="Cancel" variant="secondary" onPress={onClose} disabled={busy} style={{ flex: 1 }} /><Button title="Propose" busy={busy} onPress={save} style={{ flex: 1 }} /></View>}>
    <OptField label="Name" error={errs.name}><Input value={d.name} onChangeText={set('name')} accessibilityLabel="Name" /></OptField>
    <SelectField label="Category" value={d.category} options={CATEGORIES.map((c) => ({ value: c, label: label(c) }))} onChange={set('category')} error={errs.category} />
    <OptField label="Description" optional error={errs.description}><Input value={d.description} onChangeText={set('description')} accessibilityLabel="Description" {...multi} /></OptField>
    <OptField label="Instructions" optional hint="How to perform it, in plain steps. No medical, rehabilitation or injury-prevention claims." error={errs.instructions}><Input value={d.instructions} onChangeText={set('instructions')} accessibilityLabel="Instructions" {...multi} /></OptField>
    <OptField label="Equipment (comma separated)" optional error={errs.equipment}><Input value={d.equipment} onChangeText={set('equipment')} accessibilityLabel="Equipment (comma separated)" /></OptField>
    <OptField label="Muscle groups (comma separated)" optional error={errs.muscleGroups}><Input value={d.muscleGroups} onChangeText={set('muscleGroups')} accessibilityLabel="Muscle groups (comma separated)" /></OptField>
    <P muted small>A proposal is a draft: you can use it in your own templates now, and every coach sees it once the Bioptime team publishes it.</P>
    {err ? <Notice kind="error">{err}</Notice> : null}
  </Sheet>;
}

/* ---------- templates ---------- */

function Templates({ data, archived, setArchived }: { data: Loaded<{ items: TemplateRow[] }>; archived: boolean; setArchived: (f: (a: boolean) => boolean) => void }) {
  const router = useRouter();
  const d = data.data;
  const items = d?.items ?? [];
  return <MotionCard index={1} pressable={false}><Card>
    <Row between><View style={{ flex: 1, minWidth: 160 }}><Eyebrow>Team templates and yours</Eyebrow><H2>{plural(items.length, 'template')}</H2></View>
      <Row><Button title={archived ? 'Hide archived' : 'Show archived'} variant="ghost" small onPress={() => setArchived((a) => !a)} /><Button title="New template" small onPress={() => router.push('/coach/templates/new')} /></Row></Row>
    <StaleBanner at={data.stale} />
    <ErrorBox error={data.error} onRetry={data.reload} />
    {!d && !data.error ? <Loading /> : d ? (items.length ? <RecordList title="Workout templates">
      {items.map((t, i) => {
        const pill = statusPill(t.status);
        const own = t.source === 'coach';
        return <InfoRow key={t.id} title={t.title} sub={t.description || null} last={i === items.length - 1}
          meta={`${sourceLabel(t.source)}${t.authorName ? ` · ${t.authorName}` : ''} · ${t.level ? label(t.level) : '—'} · ${plural(t.itemCount, 'exercise')}`}
          pills={[{ label: pill.label, tone: pill.tone }]}
          right={<Button title={own ? 'Edit' : 'View'} variant="secondary" small onPress={() => router.push(`/coach/templates/${t.id}`)} />} />;
      })}
    </RecordList> : <EmptyState title="No templates yet" body="A template is a session: exercises with sets, reps or time, and rest." icon="list-outline" />) : null}
  </Card></MotionCard>;
}
