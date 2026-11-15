/* Coach › Workout template editor (the web's /coach/workout-templates/:id and 'new'; apps/dashboard/src/modules/workouts/
   TemplateEditor.tsx in coach mode). A template is the session a programme day points at: exercises in order, each with
   sets, reps or a time, rest and notes. A coach edits their own templates (and archives or restores them); a team
   template opens read-only.
   GET /coach/workout-templates/:id; GET /coach/exercise-library (the exercise choices: published ones and the coach's own
   drafts); POST /coach/workout-templates (→ the new template's editor); PATCH /coach/workout-templates/:id, with
   status 'archived' (Archive) or 'published' (Restore). The server's schema decides (templateInputSchema: sets 1–20,
   reps or a time for every exercise, rest 0–1800 s, at most 40 exercises); its messages show on the fields and rows.
   The web's ↑ ↓ ✕ are icon buttons with the same names (Move up, Move down, Remove exercise). Flag: workouts. */
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { errorText, get, patch, post } from '@/lib/api';
import { label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { blankItem, digits, fieldErrorsOf, itemDraftOf, keptIndex, LEVELS, plural, prescription, rowIssues, sourceLabel, statusPill, templateBody, type ExerciseList, type ItemDraft, type Template } from '@/lib/coach/workouts';
import { Button, Card, ErrorBox, Eyebrow, H2, Input, Loading, Notice, P, Pill, Row, Screen, StaleBanner, Title } from '@/components/ui';
import { RecordList } from '@/components/workspace';
import { NotificationBell, RoleGate } from '@/components/workspaceShell';
import { useToast } from '@/components/adminA/toast';
import { BackLink, IconButton, InfoRow, ModuleGate, OptField } from '@/components/coachWorkouts/parts';
import { SelectField, type SelectOption } from '@/components/coachWorkouts/SelectField';
import { Enter, MotionCard } from '@/motion';
import { colors, font, radius, space } from '@/theme';

export default function TemplateScreen() {
  const { id = 'new' } = useLocalSearchParams<{ id: string }>();
  return <>
    <Stack.Screen options={{ title: id === 'new' ? 'New template' : 'Workout template', headerRight: () => <NotificationBell /> }} />
    <RoleGate workspace="coach"><ModuleGate flag="workouts"><Editor key={id} id={id} /></ModuleGate></RoleGate>
  </>;
}

function Editor({ id }: { id: string }) {
  const { saved } = useLocalSearchParams<{ saved?: string }>();
  const router = useRouter();
  const toast = useToast();
  const isNew = id === 'new';
  const existing = useLoad<Template | null>(isNew ? null : `coach.workout-template.${id}`, () => (isNew ? Promise.resolve(null) : get(`/coach/workout-templates/${id}`)), [id]);
  const library = useLoad<ExerciseList>('coach.exercise-library.choices', () => get('/coach/exercise-library'), []);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [level, setLevel] = useState('');
  const [estMinutes, setEstMinutes] = useState('');
  const [items, setItems] = useState<ItemDraft[]>(() => [blankItem()]);
  const [err, setErr] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [rowErrs, setRowErrs] = useState<Record<string, string>>({}); // by row key, so an error follows its row when rows move
  const [busy, setBusy] = useState(false);
  const t = existing.data;
  // a template just created opens here (router.replace), with the toast its first screen could not show
  useEffect(() => { if (saved === '1') toast.show('Template saved'); }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!t) return;
    setTitle(t.title); setDescription(t.description ?? ''); setLevel(t.level ?? ''); setEstMinutes(t.estMinutes ? String(t.estMinutes) : '');
    setItems((t.items ?? []).map(itemDraftOf));
  }, [t]);
  const exercises = library.data?.items ?? [];
  const options = useMemo<SelectOption[]>(() => {
    const out: SelectOption[] = [{ value: '', label: 'Choose an exercise' }, ...exercises.map((e) => ({ value: e.id, label: `${e.name}${e.status === 'draft' ? ' (your draft)' : ''}`, detail: label(e.category) }))];
    for (const i of t?.items ?? []) if (!out.some((o) => o.value === i.exerciseId)) out.push({ value: i.exerciseId, label: i.exerciseName });
    return out;
  }, [exercises, t]);
  const setItem = (k: number, change: Partial<ItemDraft>) => {
    const key = items[k]?.key;
    if (key && rowErrs[key]) setRowErrs((r) => { const { [key]: _gone, ...rest } = r; return rest; });
    setItems((xs) => xs.map((x, i) => (i === k ? { ...x, ...change } : x)));
  };
  const move = (k: number, by: number) => setItems((xs) => { const out = [...xs]; const j = k + by; if (j < 0 || j >= out.length) return xs; [out[k], out[j]] = [out[j]!, out[k]!]; return out; });

  const save = async (status?: 'published' | 'archived') => {
    setBusy(true); setErr(''); setErrs({}); setRowErrs({});
    try {
      const body = templateBody({ title, description, level, estMinutes, items });
      if (status) body.status = status;
      if (isNew) { const r = await post<{ id: string }>('/coach/workout-templates', body); router.replace(`/coach/templates/${r.id}?saved=1`); }
      else { await patch(`/coach/workout-templates/${id}`, body); toast.show(status === 'archived' ? 'Template archived' : status === 'published' ? 'Template restored' : 'Template saved'); void existing.reload(); }
    } catch (e) {
      const byKept = rowIssues(e, 'items'); const at = keptIndex(items); const mine: Record<string, string> = {};
      for (const [n, msg] of Object.entries(byKept)) { const k = at[Number(n)]; const row = k !== undefined ? items[k] : undefined; if (row) mine[row.key] = msg; }
      // an exercise's issue shows on its own row; the list-level line is for what belongs to no row (more than 40)
      const fields = fieldErrorsOf(e); if (Object.keys(mine).length) delete fields.items;
      setErr(errorText(e)); setErrs(fields); setRowErrs(mine);
    } finally { setBusy(false); }
  };

  if (!isNew && !t) {
    return <Screen refreshing={existing.loading} onRefresh={existing.reload}>
      <BackLink title="← Exercise library" onPress={() => router.push('/coach/exercise-library')} />
      {existing.error ? <ErrorBox error={existing.error} onRetry={existing.reload} /> : <Loading />}
    </Screen>;
  }
  const editable = isNew || t?.source === 'coach';
  const pill = t ? statusPill(t.status) : null;
  const count = items.filter((i) => i.exerciseId).length;
  return <Screen refreshing={existing.loading || library.loading} onRefresh={() => { void existing.reload(); void library.reload(); }}>
    <Enter><View>
      <BackLink title="← Exercise library" onPress={() => router.push('/coach/exercise-library')} />
      <Title sub={isNew ? 'Exercises in order, each with sets, reps or a time, and rest.' : `${sourceLabel(t!.source)}${t!.authorName ? ` · ${t!.authorName}` : ''} · ${plural(t!.itemCount, 'exercise')}`}>{isNew ? 'New template' : t!.title}</Title>
    </View></Enter>
    <Enter index={1}><Row>
      {pill ? <Pill tone={pill.tone}>{pill.label}</Pill> : null}
      {editable ? <Button title="Save" small busy={busy} onPress={() => save()} /> : null}
      {editable && !isNew ? (t!.status === 'archived' ? <Button title="Restore" variant="secondary" small busy={busy} onPress={() => save('published')} /> : <Button title="Archive" variant="ghost" small busy={busy} onPress={() => save('archived')} />) : null}
    </Row></Enter>
    <StaleBanner at={existing.stale} />
    {toast.node}
    {err ? <Notice kind="error">{err}</Notice> : null}
    {!editable && t ? <MotionCard index={2} pressable={false}><Card>
      <Eyebrow>{label(t.level) || 'Template'}</Eyebrow><H2>Exercises</H2>
      {t.description ? <P small>{t.description}</P> : null}
      <RecordList title="Template exercises">{t.items.map((i, k) => <InfoRow key={i.id} title={i.exerciseName} last={k === t.items.length - 1}
        meta={`${i.block || '—'} · ${prescription(i)}`} sub={[i.loadNote, i.note].filter(Boolean).join(' · ') || null} />)}</RecordList>
    </Card></MotionCard> : <>
      <MotionCard index={2} pressable={false}><Card>
        <Eyebrow>Template</Eyebrow><H2>Basics</H2>
        <OptField label="Title" error={errs.title}><Input value={title} onChangeText={setTitle} placeholder="e.g. Full body, two blocks" accessibilityLabel="Title" /></OptField>
        <OptField label="Description" optional error={errs.description}><Input value={description} onChangeText={setDescription} multiline numberOfLines={3} style={{ minHeight: 76, textAlignVertical: 'top' }} accessibilityLabel="Description" /></OptField>
        <SelectField label="Level" value={level} placeholder="Not set" options={[{ value: '', label: 'Not set' }, ...LEVELS.map((l) => ({ value: l, label: label(l) }))]} onChange={setLevel} error={errs.level} optional />
        <OptField label="Estimated minutes" optional hint="Your own estimate, shown to coaches only." error={errs.estMinutes}><Input value={estMinutes} onChangeText={(v) => setEstMinutes(digits(v))} keyboardType="number-pad" inputMode="numeric" accessibilityLabel="Estimated minutes" /></OptField>
      </Card></MotionCard>
      <MotionCard index={3} pressable={false}><Card>
        <Row between><View style={{ flex: 1, minWidth: 140 }}><Eyebrow>Exercises</Eyebrow><H2>{`${count} in order`}</H2></View><Button title="Add exercise" variant="secondary" small onPress={() => setItems((xs) => [...xs, blankItem()])} /></Row>
        {library.error ? <ErrorBox error={library.error} onRetry={library.reload} /> : null}
        {errs.items ? <Notice kind="error">{errs.items}</Notice> : null}
        {items.map((it, k) => <View key={it.key} style={[styles.tile, rowErrs[it.key] ? { borderColor: colors.error } : null]}>
          <Text style={styles.tileHead}>{`Exercise ${k + 1}`}</Text>
          <SelectField compact label="Exercise" title="Exercise" value={it.exerciseId} options={options} searchable placeholder="Choose an exercise" onChange={(v) => setItem(k, { exerciseId: v })} />
          <Input value={it.block} onChangeText={(v) => setItem(k, { block: v })} placeholder="Block (e.g. Main)" accessibilityLabel="Block" />
          <View style={styles.grid}>
            <View style={styles.cell}><OptField label="Sets"><Input value={it.sets} onChangeText={(v) => setItem(k, { sets: digits(v) })} keyboardType="number-pad" inputMode="numeric" accessibilityLabel="Sets" /></OptField></View>
            <View style={styles.cell}><OptField label="Reps" optional><Input value={it.reps} onChangeText={(v) => setItem(k, { reps: v })} placeholder="8-10" accessibilityLabel="Reps" /></OptField></View>
            <View style={styles.cell}><OptField label="Time (s)" optional><Input value={it.durationSeconds} onChangeText={(v) => setItem(k, { durationSeconds: digits(v) })} keyboardType="number-pad" inputMode="numeric" accessibilityLabel="Time (s)" /></OptField></View>
            <View style={styles.cell}><OptField label="Rest (s)" optional><Input value={it.restSeconds} onChangeText={(v) => setItem(k, { restSeconds: digits(v) })} keyboardType="number-pad" inputMode="numeric" accessibilityLabel="Rest (s)" /></OptField></View>
          </View>
          <Input value={it.loadNote} onChangeText={(v) => setItem(k, { loadNote: v })} placeholder="Load note (e.g. bodyweight)" accessibilityLabel="Load note" />
          <Input value={it.note} onChangeText={(v) => setItem(k, { note: v })} placeholder="Note for the client" accessibilityLabel="Note" />
          {rowErrs[it.key] ? <Text style={styles.rowError}>{rowErrs[it.key]}</Text> : null}
          <Row>
            <IconButton icon="arrow-up" label="Move up" disabled={k === 0} onPress={() => move(k, -1)} />
            <IconButton icon="arrow-down" label="Move down" disabled={k === items.length - 1} onPress={() => move(k, 1)} />
            <IconButton icon="close" label="Remove exercise" onPress={() => setItems((xs) => xs.filter((_, i) => i !== k))} />
          </Row>
        </View>)}
        <P muted small>Give reps or a time for each exercise. Sessions already given to clients keep the version they were given.</P>
      </Card></MotionCard>
    </>}
  </Screen>;
}

const styles = StyleSheet.create({
  tile: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.md, gap: space.sm, backgroundColor: colors.base },
  tileHead: { color: colors.muted, fontSize: font.tiny, fontWeight: '600', letterSpacing: 1.2, textTransform: 'uppercase' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.sm },
  cell: { flexGrow: 1, flexBasis: '45%', minWidth: 120 },
  rowError: { color: colors.errorText, fontSize: font.small },
});
