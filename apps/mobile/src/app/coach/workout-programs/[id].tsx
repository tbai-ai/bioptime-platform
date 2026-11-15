/* Coach › Workout programme editor (the web's /coach/workout-programs/:id and 'new' with ?member=; apps/dashboard/src/
   modules/workouts/ProgramEditor.tsx). A programme for an assigned client: weeks of training days, one template per day.
   A draft until published; publishing gives the client their sessions and tells them, and a revision keeps every session
   they already did. Once published, weeks keep their numbers (a session belongs to its week and day), so removing a week
   never renumbers the ones after it; the server refuses to drop a week the client logged in and keeps every logged or
   skipped day in its week and day with the same template (DAY_HAS_LOGS), so those rows are locked here ("Logged").
   GET /coach/workout-programs/:id, GET /coach/clients (the client choice, new only), GET /coach/workout-templates;
   POST /coach/workout-programs, PATCH /coach/workout-programs/:id, POST …/publish { startDate }, POST …/archive { reason }.
   The client's Workouts tab links here (lib/coach/modules/workouts.tsx); /coach/programs/:id redirects here.
   Flag: workouts. Coach endpoints only. */
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { errorText, get, patch, post } from '@/lib/api';
import { fmtDate, istDate } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { DAY_NAMES, fieldErrorsOf, fmtDay, newDay, newWeek, plural, statusPill, structureOf, weeksOf, type ClientOption, type DayDraft, type Program, type TemplateRow, type WeekDraft } from '@/lib/coach/workouts';
import { Button, Card, ErrorBox, Eyebrow, H2, Input, Loading, Notice, P, Pill, Row, Screen, StaleBanner, Title } from '@/components/ui';
import { DatePickerField, KeyValue } from '@/components/workspace';
import { NotificationBell, RoleGate, notifyBadges } from '@/components/workspaceShell';
import { ReasonSheet } from '@/components/adminA/ReasonSheet';
import { useToast } from '@/components/adminA/toast';
import { BackLink, IconButton, ModuleGate, OptField } from '@/components/coachWorkouts/parts';
import { SelectField, type SelectOption } from '@/components/coachWorkouts/SelectField';
import { Enter, MotionCard } from '@/motion';
import { colors, font, radius, space } from '@/theme';

export default function WorkoutProgramScreen() {
  const { id = 'new' } = useLocalSearchParams<{ id: string }>();
  return <>
    <Stack.Screen options={{ title: id === 'new' ? 'New workout programme' : 'Workout programme', headerRight: () => <NotificationBell /> }} />
    <RoleGate workspace="coach"><ModuleGate flag="workouts"><Editor key={id} id={id} /></ModuleGate></RoleGate>
  </>;
}

function Editor({ id }: { id: string }) {
  const { member: memberParam, saved } = useLocalSearchParams<{ member?: string; saved?: string }>();
  const router = useRouter();
  const toast = useToast();
  const isNew = id === 'new';
  const existing = useLoad<Program | null>(isNew ? null : `coach.workout-program.${id}`, () => (isNew ? Promise.resolve(null) : get(`/coach/workout-programs/${id}`)), [id]);
  const clients = useLoad<{ items: ClientOption[] } | null>(isNew ? 'coach.clients.choices' : null, () => (isNew ? get('/coach/clients?limit=100&sort=name') : Promise.resolve(null)), [isNew]);
  const templates = useLoad<{ items: TemplateRow[] }>('coach.workout-templates.choices', () => get('/coach/workout-templates'), []);
  const [member, setMember] = useState(memberParam ?? '');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [startDate, setStartDate] = useState(istDate());
  const [weeks, setWeeks] = useState<WeekDraft[]>(() => [newWeek(1)]);
  const [err, setErr] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const p = existing.data;
  // a programme just created opens here (router.replace), with the toast its first screen could not show
  useEffect(() => { if (saved === 'published') toast.show('Published: the client has their sessions'); else if (saved === 'draft') toast.show('Draft saved'); }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!p) return;
    // a draft revision keeps its own title and start date until it is published
    setMember(p.memberId); setTitle(p.draft?.title ?? p.title);
    const start = p.draft?.startDate ?? p.startDate; if (start) setStartDate(start);
    setSummary((p.draft ?? p.published)?.summary ?? '');
    const ws = weeksOf(p);
    if (ws.length) setWeeks(ws);
  }, [p]);
  const tplList = templates.data?.items ?? [];
  const templateOptions = useMemo<SelectOption[]>(() => {
    const out: SelectOption[] = [{ value: '', label: 'Choose a template' }, ...tplList.map((t) => ({ value: t.id, label: `${t.title}${t.source === 'team' ? ' · team' : ' · mine'}` }))];
    for (const w of weeks) for (const d of w.days) if (d.templateId && !out.some((o) => o.value === d.templateId)) out.push({ value: d.templateId, label: p?.templates?.[d.templateId]?.title ?? 'Template' });
    return out;
  }, [tplList, weeks, p]);
  const dayOptions: SelectOption[] = DAY_NAMES.map((n, k) => ({ value: String(k + 1), label: n }));

  const save = async (publish: boolean) => {
    setBusy(true); setErr(''); setErrs({});
    try {
      const structure = structureOf(weeks);
      let programId = id;
      if (isNew) { const r = await post<{ id: string }>('/coach/workout-programs', { memberId: member, title, summary, startDate, structure }); programId = r.id; }
      else if (p?.status !== 'archived') await patch(`/coach/workout-programs/${id}`, { title, summary, startDate, structure });
      if (publish) await post(`/coach/workout-programs/${programId}/publish`, { startDate });
      notifyBadges();
      if (isNew) router.replace(`/coach/workout-programs/${programId}?saved=${publish ? 'published' : 'draft'}`);
      else { toast.show(publish ? 'Published: the client has their sessions' : 'Draft saved'); void existing.reload(); }
    } catch (e) { setErr(errorText(e)); setErrs(fieldErrorsOf(e)); } finally { setBusy(false); }
  };
  const setWeek = (i: number, change: Partial<WeekDraft>) => setWeeks((ws) => ws.map((w, k) => (k === i ? { ...w, ...change } : w)));
  const setDay = (wi: number, di: number, change: Partial<DayDraft>) => setWeeks((ws) => ws.map((w, k) => (k === wi ? { ...w, days: w.days.map((d, j) => (j === di ? { ...d, ...change } : d)) } : w)));
  const nextFreeDay = (w: WeekDraft) => [1, 2, 3, 4, 5, 6, 7].find((n) => !w.days.some((d) => d.day === n)) ?? 7;

  const back = member ? `/coach/clients/${member}?tab=workouts` : '/(coach)/clients';
  if (!isNew && !p) {
    return <Screen refreshing={existing.loading} onRefresh={existing.reload}>
      <BackLink title="← Client" onPress={() => router.push(back)} />
      {existing.error ? <ErrorBox error={existing.error} onRetry={existing.reload} /> : <Loading />}
    </Screen>;
  }
  const archived = !isNew && p?.status === 'archived';
  const hasDraft = isNew || !!p?.draft;
  const fixedWeeks = !isNew && p?.status !== 'draft'; // published once: week numbers are what the client's sessions hang on
  const logged = new Set<number>(isNew ? [] : p?.loggedWeeks ?? []);
  const canRemoveWeek = (w: WeekDraft, wi: number) => weeks.length > 1 && (!fixedWeeks || (wi === weeks.length - 1 && !logged.has(w.week)));
  const removeWeek = (wi: number) => setWeeks((ws) => { const rest = ws.filter((_, k) => k !== wi); return fixedWeeks ? rest : rest.map((x, k) => ({ ...x, week: k + 1 })); });
  const addWeek = () => setWeeks((ws) => [...ws, newWeek(Math.max(0, ...ws.map((x) => x.week)) + 1, (ws[ws.length - 1]?.days ?? []).map((d) => newDay(d.day, d.templateId)))]);
  const pill = p ? statusPill(p.status) : null;
  return <Screen refreshing={existing.loading || templates.loading} onRefresh={() => { void existing.reload(); void templates.reload(); }}>
    <Enter><View>
      <BackLink title="← Client" onPress={() => router.push(back)} />
      <Title sub={isNew ? 'A draft until you publish it. Publishing gives the client their sessions and tells them.' : `Version ${p!.currentVersion} · ${p!.memberName}${p!.draft && p!.status === 'published' ? ' · draft revision not yet published' : ''}`}>{isNew ? 'New workout programme' : p!.title}</Title>
    </View></Enter>
    <Enter index={1}><Row>
      {pill ? <Pill tone={pill.tone}>{pill.label}</Pill> : null}
      {!archived ? <Button title="Save draft" variant="secondary" small busy={busy} onPress={() => save(false)} /> : null}
      {!archived ? <Button title={isNew || p?.status === 'draft' ? 'Publish' : 'Publish revision'} small busy={busy} onPress={() => save(true)} /> : null}
      {!isNew && !archived ? <Button title="Archive" variant="ghost" small onPress={() => setArchiving(true)} /> : null}
    </Row></Enter>
    <StaleBanner at={existing.stale} />
    {toast.node}
    {err ? <Notice kind="error">{err}</Notice> : null}
    {archived ? <Notice kind="info" title="Archived">This programme is closed. Sessions the client logged stay in their history.</Notice> : null}
    {!isNew && !hasDraft && !archived ? <Notice kind="info">Editing creates a draft revision; the published version stays with the client until you publish it. Sessions the client already did are kept.</Notice> : null}
    <MotionCard index={2} pressable={false}><Card>
      <Eyebrow>Programme</Eyebrow><H2>Basics</H2>
      {isNew ? <SelectField label="Client" value={member} placeholder="Choose a client" searchable error={errs.memberId}
        options={[{ value: '', label: 'Choose a client' }, ...(clients.data?.items ?? []).map((c) => ({ value: c.id, label: c.name }))]} onChange={setMember} /> : null}
      {isNew && clients.error ? <Notice kind="error">{clients.error.message}</Notice> : null}
      <OptField label="Title" error={errs.title}><Input value={title} onChangeText={setTitle} editable={!archived} placeholder="e.g. Block 1: full body twice a week" accessibilityLabel="Title" /></OptField>
      <OptField label="Summary for the client" optional error={errs.summary}><Input value={summary} onChangeText={setSummary} editable={!archived} multiline numberOfLines={3} style={{ minHeight: 76, textAlignVertical: 'top' }} accessibilityLabel="Summary for the client" /></OptField>
      {archived ? <OptField label="Start date (sessions are dated from it)"><Input value={startDate} editable={false} accessibilityLabel="Start date (sessions are dated from it)" /></OptField>
        : <DatePickerField label="Start date (sessions are dated from it)" value={startDate} onChange={setStartDate} error={errs.startDate} />}
      <P muted>Only training within your professional scope. No medical, rehabilitation or injury-prevention claims; no calorie figures.</P>
    </Card></MotionCard>
    {p ? <MotionCard index={3} pressable={false}><Card>
      <Eyebrow>Sessions</Eyebrow><H2>So far</H2>
      <KeyValue rows={[['Done', `${p.sessions.completed} completed, ${p.sessions.partial} partly`], ['Skipped', String(p.sessions.skipped)], ['To come', String(p.sessions.scheduled)], ['Started', fmtDay(p.startDate)]]} />
    </Card></MotionCard> : null}
    <MotionCard index={4} pressable={false}><Card>
      <Row between><View style={{ flex: 1, minWidth: 140 }}><Eyebrow>Weekly structure</Eyebrow><H2>{plural(weeks.length, 'week')}</H2></View>{!archived ? <Button title="Add week" variant="secondary" small onPress={addWeek} /> : null}</Row>
      {fixedWeeks && !archived ? <P small muted>Weeks keep their numbers once published, and a day your client logged or skipped stays in its week and day with the same template (those rows are locked). To take out a week in the middle, remove its days still to come. Only the last week can be removed, and only while nothing in it is logged.</P> : null}
      {!tplList.length && templates.data ? <Notice kind="info"><Text style={styles.noticeText}>No templates yet. Create one in the <Text accessibilityRole="link" onPress={() => router.push('/coach/exercise-library')} style={styles.link}>exercise library</Text> first.</Text></Notice> : null}
      {templates.error ? <Notice kind="error">{templates.error.message}</Notice> : null}
      {errs.structure ? <Notice kind="error">{errs.structure}</Notice> : null}
      {weeks.map((w, wi) => <View key={w.key} style={styles.week}>
        <Text style={styles.weekName}>{`Week ${w.week}`}</Text>
        <Input value={w.focus} onChangeText={(v) => setWeek(wi, { focus: v })} editable={!archived} placeholder="Focus (optional)" accessibilityLabel={`Week ${w.week} focus`} />
        {!archived ? <Row>
          <Button title="Add day" variant="ghost" small disabled={w.days.length >= 7} onPress={() => setWeek(wi, { days: [...w.days, newDay(nextFreeDay(w))] })} />
          {canRemoveWeek(w, wi) ? <Button title="Remove week" variant="ghost" small onPress={() => removeWeek(wi)} /> : null}
        </Row> : null}
        {w.days.length ? w.days.map((d, di) => <View key={d.key} style={[styles.day, d.locked && styles.locked]}>
          <View style={styles.dayRow}>
            <View style={{ width: 120 }}><SelectField compact label="Day of the week" title="Day of the week" value={String(d.day)} options={dayOptions} onChange={(v) => setDay(wi, di, { day: Number(v) })} disabled={archived || d.locked} /></View>
            <View style={{ flex: 1 }} />
            {!archived ? (d.locked ? <Text style={styles.loggedText}>Logged</Text> : <IconButton icon="close" label="Remove day" onPress={() => setWeek(wi, { days: w.days.filter((_, j) => j !== di) })} />) : null}
          </View>
          <SelectField compact label="Template" title="Template" value={d.templateId} options={templateOptions} searchable placeholder="Choose a template" onChange={(v) => setDay(wi, di, { templateId: v })} disabled={archived || d.locked} />
        </View>) : <P small muted>A rest week. Add a day to plan a session.</P>}
      </View>)}
    </Card></MotionCard>
    {p ? <MotionCard index={5} pressable={false}><Card>
      <Eyebrow>Versions</Eyebrow><H2>History</H2>
      {(p.versions ?? []).map((v) => <View key={v.id} style={styles.version}>
        <View style={[styles.dot, v.status === 'published' && { backgroundColor: colors.success }]} />
        <View style={{ flex: 1 }}><Text style={styles.versionText}><Text style={{ fontWeight: '700' }}>{`Version ${v.version}`}</Text>{` · ${v.status}${v.summary ? ` · ${v.summary}` : ''}`}</Text><Text style={styles.versionTime}>{fmtDate(v.publishedAt ?? v.createdAt)}</Text></View>
      </View>)}
    </Card></MotionCard> : null}
    {!isNew ? <ReasonSheet open={archiving} onClose={() => setArchiving(false)} title="Archive this programme?" body="Sessions still to come are removed; what the client logged stays in their history." confirmLabel="Archive" destructive
      onConfirm={async (reason) => { await post(`/coach/workout-programs/${id}/archive`, { reason }); toast.show('Programme archived'); notifyBadges(); void existing.reload(); }} /> : null}
  </Screen>;
}

const styles = StyleSheet.create({
  week: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.md, gap: space.sm, backgroundColor: colors.base },
  weekName: { color: colors.text, fontSize: font.body, fontWeight: '700' },
  day: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.sm, gap: space.sm, backgroundColor: colors.surface },
  locked: { borderStyle: 'dashed' },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  loggedText: { color: colors.muted, fontSize: font.small, paddingHorizontal: space.sm },
  version: { flexDirection: 'row', gap: space.sm, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.borderStrong, marginTop: 6 },
  versionText: { color: colors.text, fontSize: font.small },
  versionTime: { color: colors.muted, fontSize: font.tiny, marginTop: 2 },
  noticeText: { color: colors.muted, fontSize: font.small, lineHeight: 19 },
  link: { color: colors.accentText, textDecorationLine: 'underline' },
});
