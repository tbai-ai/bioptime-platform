/* Admin › one workout template (the web's /admin/workout-templates/:id and 'new', modules/workouts/TemplateEditor.tsx admin
   mode; workouts module, library.manage): a template is the session a programme day points at: exercises in order, each
   with sets, reps or a time, rest and notes. An administrator edits the team's templates (published exercises only); a
   coach's own template opens read only. Publishing and archiving happen on the library's Templates tab, with a reason.
   GET /admin/workout-templates/:id, GET /admin/exercises?status=published (the choices); POST /admin/workout-templates
   (a team draft; the editor of the new template opens), PATCH …/:id. */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { errorText, get, patch, post } from '@/lib/api';
import { label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { LEVELS, blankItem, digits, itemDraftOf, keptIndex, plural, prescription, rowIssues, sourceLabel, statusPill, templateBody, type ExerciseList, type ItemDraft, type Template } from '@/lib/coach/workouts';
import { useToast } from '@/components/adminA/toast';
import { SelectField } from '@/components/coachLibraries/SelectField';
import { PickerField, fieldErrorsOf } from '@/components/coachModules/shared';
import { Button, ErrorBox, Field, Input, Loading, Notice, P, Pill, Row, Screen, Title } from '@/components/ui';
import { AdminModuleGate, BackLink, Hint, IconButton, SectionCard, setPendingToast, takePendingToast } from '@/components/adminModules2/frame';
import { Enter } from '@/motion';
import { colors, font, radius, space } from '@/theme';

export default function AdminWorkoutTemplateScreen() {
  return <AdminModuleGate title="Workout template" module="workouts" permission="library.manage"><Body /></AdminModuleGate>;
}

function Body() {
  const { id = 'new' } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const isNew = id === 'new';
  const existing = useLoad<Template | null>(isNew ? null : `admin-workout-template-${id}`, () => (isNew ? Promise.resolve(null) : get(`/admin/workout-templates/${id}`)), [id]);
  const library = useLoad<ExerciseList>('admin-exercises-published', () => get('/admin/exercises?status=published'), []);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [level, setLevel] = useState('');
  const [estMinutes, setEstMinutes] = useState('');
  const [items, setItems] = useState<ItemDraft[]>(() => [blankItem()]);
  const [err, setErr] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [rowErrs, setRowErrs] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const t = existing.data;
  useEffect(() => { const p = takePendingToast(); if (p) toast.show(p); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!t) return;
    setTitle(t.title); setDescription(t.description ?? ''); setLevel(t.level ?? ''); setEstMinutes(t.estMinutes ? String(t.estMinutes) : '');
    setItems((t.items ?? []).map(itemDraftOf));
  }, [t]);
  const editable = isNew || (!!t && t.source === 'team');
  const exercises = library.data?.items ?? [];
  const exName = (eid: string) => exercises.find((e) => e.id === eid)?.name ?? t?.items?.find((i) => i.exerciseId === eid)?.exerciseName ?? 'Exercise';
  const setItem = (k: number, p: Partial<ItemDraft>) => setItems((xs) => xs.map((x, i) => (i === k ? { ...x, ...p } : x)));
  const move = (k: number, by: number) => setItems((xs) => { const out = [...xs]; const j = k + by; if (j < 0 || j >= out.length) return xs; [out[k], out[j]] = [out[j]!, out[k]!]; return out; });
  const save = async () => {
    setBusy(true); setErr(''); setErrs({}); setRowErrs({});
    try {
      const body = templateBody({ title, description, level, estMinutes, items });
      if (isNew) { const r = await post<{ id: string }>('/admin/workout-templates', body); setPendingToast('Team template saved as a draft'); router.replace(`/admin/exercise-library/templates/${r.id}`); }
      else { await patch(`/admin/workout-templates/${id}`, body); toast.show('Template saved'); void existing.reload(); }
    } catch (e) {
      setErrs(fieldErrorsOf(e));
      const rows = rowIssues(e, 'items'); const map = keptIndex(items); const out: Record<number, string> = {};
      for (const [n, m] of Object.entries(rows)) { const k = map[Number(n)]; if (k !== undefined) out[k] = m; }
      setRowErrs(out); setErr(errorText(e));
    } finally { setBusy(false); }
  };
  const choices = (cur: string) => [
    ...(cur && !exercises.some((e) => e.id === cur) ? [{ value: cur, label: exName(cur) }] : []),
    ...exercises.map((e) => ({ value: e.id, label: `${e.name}${e.status === 'draft' ? ' (your draft)' : ''}`, detail: label(e.category) })),
  ];
  const sub = isNew ? 'Exercises in order, each with sets, reps or a time, and rest.' : t ? `${sourceLabel(t.source)}${t.authorName ? ` · ${t.authorName}` : ''} · ${plural(t.itemCount, 'exercise')}` : undefined;
  return <View style={{ flex: 1 }}><Screen refreshing={existing.loading && !isNew} onRefresh={() => { void existing.reload(); void library.reload(); }}>
    <BackLink title="← Exercise library" href="/admin/exercise-library" />
    <Enter><Title sub={sub}>{isNew ? 'New team template' : t?.title ?? 'Workout template'}</Title></Enter>
    <ErrorBox error={existing.error} onRetry={existing.reload} />
    {!isNew && !t ? (existing.error ? null : <Loading />) : <>
      <Row>{t ? <Pill tone={statusPill(t.status).tone}>{statusPill(t.status).label}</Pill> : null}{editable ? <Button title="Save" small busy={busy} onPress={save} /> : null}</Row>
      {err ? <Notice kind="error">{err}</Notice> : null}
      {editable ? <Notice kind="info">Team templates use published exercises only. Publish or archive from the library’s Templates tab; each change asks for a reason.</Notice> : null}
      {!editable && t ? <Enter index={1}><SectionCard eyebrow={label(t.level) || 'Template'} title="Exercises">
        {t.description ? <P small>{t.description}</P> : null}
        {t.items.map((i) => <View key={i.id} style={st.item}>
          <Text style={st.name}>{i.exerciseName}</Text>
          <Text style={st.meta}>{`Block: ${i.block || '—'} · ${prescription(i)}`}</Text>
          <Text style={st.meta}>{[i.loadNote, i.note].filter(Boolean).join(' · ') || '—'}</Text>
        </View>)}
      </SectionCard></Enter> : <>
        <Enter index={1}><SectionCard eyebrow="Template" title="Basics">
          <Field label="Title" error={errs.title}><Input value={title} onChangeText={setTitle} maxLength={160} placeholder="e.g. Full body, two blocks" accessibilityLabel="Title" /></Field>
          <Field label="Description (optional)" error={errs.description}><Input value={description} onChangeText={setDescription} multiline style={{ minHeight: 72, textAlignVertical: 'top' }} accessibilityLabel="Description" /></Field>
          <PickerField label="Level (optional)" placeholder="Not set" value={level} options={LEVELS.map((l) => ({ value: l, label: label(l) }))} onChange={setLevel} error={errs.level} />
          <Field label="Estimated minutes (optional)" hint="Your own estimate, shown to coaches only." error={errs.estMinutes}><Input value={estMinutes} keyboardType="number-pad" maxLength={3} onChangeText={(v) => setEstMinutes(digits(v))} accessibilityLabel="Estimated minutes" /></Field>
        </SectionCard></Enter>
        <Enter index={2}><SectionCard eyebrow="Exercises" title={`${items.filter((i) => i.exerciseId).length} in order`} right={<Button title="Add exercise" variant="secondary" small onPress={() => setItems((xs) => [...xs, blankItem()])} />}>
          {errs.items && !Object.keys(rowErrs).length ? <Notice kind="error">{errs.items}</Notice> : null}
          {items.map((it, k) => <View key={it.key} style={st.tile}>
            <Row style={{ flexWrap: 'nowrap' }}>
              <View style={{ flex: 1 }}><SelectField compact searchable label="Exercise" title="Exercise" placeholder="Choose an exercise" value={it.exerciseId} options={choices(it.exerciseId)} onChange={(v) => setItem(k, { exerciseId: v })} /></View>
              <IconButton icon="arrow-up" label="Move up" disabled={k === 0} onPress={() => move(k, -1)} />
              <IconButton icon="arrow-down" label="Move down" disabled={k === items.length - 1} onPress={() => move(k, 1)} />
              <IconButton icon="close" label="Remove exercise" onPress={() => setItems((xs) => xs.filter((_, i) => i !== k))} />
            </Row>
            <Input value={it.block} onChangeText={(v) => setItem(k, { block: v })} placeholder="Block (e.g. Main)" maxLength={60} accessibilityLabel="Block" />
            <View style={st.grid}>
              <View style={st.cell}><Field label="Sets"><Input value={it.sets} keyboardType="number-pad" maxLength={2} onChangeText={(v) => setItem(k, { sets: digits(v) })} accessibilityLabel="Sets" /></Field></View>
              <View style={st.cell}><Field label="Reps (optional)"><Input value={it.reps} placeholder="8-10" maxLength={20} onChangeText={(v) => setItem(k, { reps: v })} accessibilityLabel="Reps" /></Field></View>
              <View style={st.cell}><Field label="Time (s) (optional)"><Input value={it.durationSeconds} keyboardType="number-pad" maxLength={4} onChangeText={(v) => setItem(k, { durationSeconds: digits(v) })} accessibilityLabel="Time (s)" /></Field></View>
              <View style={st.cell}><Field label="Rest (s) (optional)"><Input value={it.restSeconds} keyboardType="number-pad" maxLength={4} onChangeText={(v) => setItem(k, { restSeconds: digits(v) })} accessibilityLabel="Rest (s)" /></Field></View>
            </View>
            <Input value={it.loadNote} onChangeText={(v) => setItem(k, { loadNote: v })} placeholder="Load note (e.g. bodyweight)" maxLength={200} accessibilityLabel="Load note" />
            <Input value={it.note} onChangeText={(v) => setItem(k, { note: v })} placeholder="Note for the client" maxLength={500} accessibilityLabel="Note" />
            {rowErrs[k] ? <Text style={{ color: colors.errorText, fontSize: font.small }}>{rowErrs[k]}</Text> : null}
          </View>)}
          <Hint>Give reps or a time for each exercise. Sessions already given to clients keep the version they were given.</Hint>
        </SectionCard></Enter>
        <Button title="Save" busy={busy} onPress={save} />
      </>}
    </>}
  </Screen>{toast.float}</View>;
}

const st = {
  item: { paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: colors.border, gap: 2 },
  name: { color: colors.text, fontSize: font.body, fontWeight: '600' as const },
  meta: { color: colors.muted, fontSize: font.small },
  tile: { backgroundColor: colors.base, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.md, gap: space.sm },
  grid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, columnGap: space.sm },
  cell: { width: '47%' as const },
};
