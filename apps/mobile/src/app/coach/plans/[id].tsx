/* Coach › the plan editor (the portal's /coach/plans/:id and /coach/plans/new?member=, pages/PlanEditor.tsx): a draft
   until the coach publishes it. Basics, the weekly structure as stacked tiles, Save draft and Publish, the version
   history, and, while the 'ai' flag is on and a client is chosen, the closed "Draft a plan outline" panel
   (components/coach/ai): an accepted outline is added to the summary field only; nothing is saved until the coach
   saves the draft or publishes, and the weekly tasks stay the coach's own to write. */
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { ApiError, errorText, get, patch, post } from '@/lib/api';
import { useFeatures } from '@/lib/features';
import { fmtDateTime } from '@/lib/format';
import { todayIst } from '@/lib/coach/core/format';
import { useLoad } from '@/lib/useLoad';
import { Button, Card, ErrorBox, Field, Input, Loading, Notice, Row, Screen, StaleBanner } from '@/components/ui';
import { DatePickerField, isIsoDate } from '@/components/workspace';
import { RoleGate, notifyBadges } from '@/components/workspaceShell';
import { Enter } from '@/motion';
import { AiDraftInline } from '@/components/coach/ai';
import { coachScreenOptions } from '@/components/coach/bell';
import { Bold, CardHead, IconButton, Muted, PageHead, PickerField, setPendingToast, StatusPill, TextArea, Tile, TimelineItem, ToastFloat, useToast } from '@/components/coach/shared';
import { space } from '@/theme';

type Task = { title: string; kind: string; day: number };
type Week = { week: number; focus: string; tasks: Task[] };
const KINDS = ['training', 'movement', 'nutrition', 'sleep', 'habit', 'recovery', 'reflection'].map((k) => ({ value: k, label: k }));
const DAYS = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: String(d), label: `Day ${d}` }));
const DEFAULT_WEEKS: Week[] = [{ week: 1, focus: 'Foundation', tasks: [{ title: 'Evening walk · 25 min', kind: 'movement', day: 1 }] }];

export default function PlanEditor() {
  const { id = 'new', member: memberParam } = useLocalSearchParams<{ id: string; member?: string }>();
  const router = useRouter();
  const features = useFeatures(true);
  const aiOn = !!features?.has('ai');
  const isNew = id === 'new';
  const existing = useLoad<any>(isNew ? null : `coach-plan-${id}`, () => (isNew ? Promise.resolve(null) : get(`/coach/plans/${id}`)), [id]);
  const clients = useLoad<any>(isNew ? 'coach-clients-picker' : null, () => (isNew ? get('/coach/clients?limit=100&sort=name') : Promise.resolve(null)), [isNew]);
  const { toast, show } = useToast(id);
  const [title, setTitle] = useState('');
  const [goals, setGoals] = useState('');
  const [summary, setSummary] = useState('');
  const [member, setMember] = useState(memberParam ?? '');
  const [weeks, setWeeks] = useState<Week[]>(DEFAULT_WEEKS);
  const [startDate, setStartDate] = useState(todayIst());
  const [err, setErr] = useState('');
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'save' | 'publish' | null>(null);
  const p = existing.data;
  useEffect(() => {
    if (!p) return;
    setTitle(p.title ?? ''); setGoals((p.goals ?? []).join(', ')); setMember(p.member_id ?? '');
    const v = p.currentVersion ?? p.versions?.[0];
    setSummary(v?.summary ?? '');
    const structure = (p.currentVersion?.structure ?? { weeks: [] }) as { weeks?: any[] };
    if (structure.weeks?.length) setWeeks(structure.weeks.map((w: any) => ({ week: w.week, focus: w.focus ?? '', tasks: (w.tasks ?? []).map((t: any) => ({ title: t.title, kind: t.kind ?? 'habit', day: t.day ?? 1 })) })));
  }, [p]);
  const save = async (publish: boolean) => {
    setErr(''); setFieldErr({});
    // the API checks only the YYYY-MM-DD shape (an impossible date fails there with a server error): stop before anything is saved
    if (publish && !isIsoDate(startDate)) { setFieldErr({ startDate: 'Write the date as YYYY-MM-DD, like 2026-11-05.' }); return; }
    setBusy(publish ? 'publish' : 'save');
    try {
      const body = { title: title.trim(), goals: goals.split(',').map((s) => s.trim()).filter(Boolean), summary, structure: { weeks: weeks.map((w) => ({ week: w.week, focus: w.focus, tasks: w.tasks.filter((t) => t.title.trim()).map((t) => ({ title: t.title.trim(), kind: t.kind, day: t.day })) })) } };
      let planId = id;
      if (isNew) { const r = await post<{ id: string }>('/coach/plans', { memberId: member, ...body }); planId = r.id; }
      else await patch(`/coach/plans/${id}`, body);
      if (publish) {
        try { await post(`/coach/plans/${planId}/publish`, { startDate }); }
        catch (e) {
          // the new plan was saved as a draft before publishing was refused: open it, so a second press does not create it twice
          if (isNew) { notifyBadges(); setPendingToast(errorText(e), 'error'); router.replace(`/coach/plans/${planId}`); return; }
          throw e;
        }
      }
      const msg = publish ? 'Plan published: the member has their tasks' : 'Draft saved';
      notifyBadges();
      if (isNew) { setPendingToast(msg); router.replace(`/coach/plans/${planId}`); } else { show(msg); void existing.reload(); }
    } catch (e) { setErr(errorText(e)); if (e instanceof ApiError && e.code === 'VALIDATION_FAILED') setFieldErr(e.fieldErrors()); } finally { setBusy(null); }
  };
  const setWeek = (i: number, patchWeek: Partial<Week>) => setWeeks((ws) => ws.map((w, k) => (k === i ? { ...w, ...patchWeek } : w)));
  const setTask = (wi: number, ti: number, patchTask: Partial<Task>) => setWeeks((ws) => ws.map((w, k) => (k === wi ? { ...w, tasks: w.tasks.map((t, j) => (j === ti ? { ...t, ...patchTask } : t)) } : w)));
  const hasDraft = isNew || (p?.versions ?? []).some((v: any) => v.status === 'draft') || p?.status === 'draft';
  const actions = p || isNew ? <Row>{!isNew && p ? <StatusPill status={p.status} /> : null}<Button title="Save draft" small variant="secondary" busy={busy === 'save'} disabled={busy !== null} onPress={() => { void save(false); }} /><Button title={hasDraft ? 'Publish' : 'Publish revision'} small busy={busy === 'publish'} disabled={busy !== null} onPress={() => { void save(true); }} /></Row> : null;
  return <RoleGate workspace="coach"><View style={{ flex: 1 }}><Screen refreshing={!isNew && existing.loading} onRefresh={isNew ? undefined : existing.reload}>
    <Stack.Screen options={coachScreenOptions(isNew ? 'New coaching plan' : p?.title ?? 'Plan')} />
    <Enter><PageHead back="Client" onBack={() => router.push(member ? `/coach/clients/${member}?tab=plan` : '/(coach)/clients')} title={isNew ? 'New coaching plan' : p?.title ?? 'Plan'} sub={isNew ? "A draft until you publish it. Publishing generates the member's tasks and tells them." : p ? `Version ${p.current_version} · ${p.status} · ${p.member_name}` : undefined}>{actions}</PageHead></Enter>
    <StaleBanner at={existing.stale} /><ErrorBox error={existing.error} onRetry={existing.reload} />
    {err ? <Notice kind="error">{err}</Notice> : null}
    {!isNew && !p && existing.loading ? <Loading /> : (isNew || p) ? <>
      <Card>
        <CardHead eyebrow="Plan" title="Basics" />
        {isNew ? <PickerField label="Client" value={member} onChange={setMember} placeholder="Choose a client" options={((clients.data?.items ?? []) as any[]).map((c) => ({ value: c.id, label: c.name, detail: c.memberCode ?? undefined }))} error={fieldErr.memberId} /> : null}
        <Field label="Title" error={fieldErr.title}><Input value={title} onChangeText={setTitle} placeholder="e.g. Block 2: strength and sleep" maxLength={160} accessibilityLabel="Title" /></Field>
        <Field label="Goals (comma separated)" error={fieldErr.goals}><Input value={goals} onChangeText={setGoals} accessibilityLabel="Goals (comma separated)" /></Field>
        <Field label="Summary for the member (optional)" error={fieldErr.summary}><TextArea rows={3} value={summary} onChangeText={setSummary} maxLength={2000} accessibilityLabel="Summary for the member" /></Field>
        <DatePickerField label="Start date (tasks are dated from it)" value={startDate} onChange={setStartDate} error={fieldErr.startDate} />
        <Muted>Only tasks within your professional scope. No supplement or medical advice in a plan.</Muted>
      </Card>
      <Card>
        <CardHead eyebrow="Weekly structure" title={`${weeks.length} weeks`} right={<Button title="Add week" small variant="secondary" onPress={() => setWeeks((ws) => [...ws, { week: ws.length + 1, focus: '', tasks: [{ title: '', kind: 'habit', day: 1 }] }])} />} />
        {weeks.map((w, wi) => <Tile key={wi}>
          <Bold>{`Week ${w.week}`}</Bold>
          <Input placeholder="Focus (e.g. Build)" value={w.focus} onChangeText={(v) => setWeek(wi, { focus: v })} accessibilityLabel={`Week ${w.week} focus`} />
          {w.tasks.map((t, ti) => <View key={ti} style={{ gap: space.xs, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: 'transparent' }}>
            <Input placeholder="Task, e.g. Full body session · 40 min" value={t.title} onChangeText={(v) => setTask(wi, ti, { title: v })} maxLength={200} accessibilityLabel={`Week ${w.week} task ${ti + 1}`} />
            <Row style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}><PickerField label="Kind" value={t.kind} options={KINDS} onChange={(v) => setTask(wi, ti, { kind: v })} accessibilityLabel={`Kind of task ${ti + 1}, week ${w.week}`} /></View>
              <View style={{ flex: 1 }}><PickerField label="Day" value={String(t.day)} options={DAYS} onChange={(v) => setTask(wi, ti, { day: Number(v) })} accessibilityLabel={`Day of task ${ti + 1}, week ${w.week}`} /></View>
              <View style={{ marginTop: 26 }}><IconButton icon="close" label="Remove task" onPress={() => setWeek(wi, { tasks: w.tasks.filter((_, j) => j !== ti) })} /></View>
            </Row>
          </View>)}
          <Row><Button title="Add task" small variant="ghost" onPress={() => setWeek(wi, { tasks: [...w.tasks, { title: '', kind: 'habit', day: 1 }] })} />{weeks.length > 1 ? <Button title="Remove week" small variant="ghost" onPress={() => setWeeks((ws) => ws.filter((_, k) => k !== wi).map((x, k) => ({ ...x, week: k + 1 })))} /> : null}</Row>
        </Tile>)}
      </Card>
      {aiOn && member ? <AiDraftInline key={member} memberId={member} purpose="plan_outline" title="Draft a plan outline" intro="Ask Coach AI for an outline for this client and edit it here. Accepting adds it to the summary; nothing is saved until you save the draft, and the weekly tasks stay yours to write." use={{ accept: 'Accept and add to the summary', again: 'Add to the summary', done: 'It is in the summary. Nothing is saved until you save the draft.', set: (update) => setSummary((cur) => update(cur)) }} show={show} /> : null}
      {!isNew && p ? <Card><CardHead eyebrow="Versions" title="History" />{(p.versions ?? []).map((v: any) => <TimelineItem key={v.id} done={v.status === 'published'} title={`Version ${v.version} · ${v.status}${v.summary ? ` · ${v.summary}` : ''}`} time={fmtDateTime(v.publishedAt ?? v.createdAt)} />)}</Card> : null}
      {actions}
    </> : null}
  </Screen><ToastFloat toast={toast} /></View></RoleGate>;
}
