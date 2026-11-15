/* The "Goals and check-ins" tab on the coach's client record (the web's modules/progress/CoachGoalsTab.tsx): the
   client's goals, their weekly check-in and the check-ins themselves (reply and private note), trends over a chosen
   range with adherence, and the photos the client chose to share. While the client does not share health records with
   the coach, values, answers, trends and photos are withheld (the server refuses them with NOT_SHARED; this view does
   not ask). */
import React, { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { api, errorText, get, patch, post, qs } from '@/lib/api';
import { useFeatures } from '@/lib/features';
import { fmtDate, fmtDateTime, istDate, label, relative } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import type { RecordTabContext } from '@/lib/coach/moduleTabs';
import { Button, Card, Chip, Empty, Eyebrow, Field, H2, Input, Loading, Notice, P, Pill, Row } from '@/components/ui';
import { DatePickerField, Sheet, isIsoDate } from '@/components/workspace';
import { Bar, ConfirmSheet, KvList, PickerField, TabState, Tile, day, fieldErrorsOf, openPrivateFile, useFlash, useRecordTick } from '@/components/coachModules/shared';
import { colors, font, radius, space } from '@/theme';

/* ---------- shapes the API returns ---------- */
type Metric = { metric: string; label: string; unit: string; min: number | null; max: number | null };
type Point = { at: string; value: number; source: string; sourceLabel: string };
type Series = { metric: string; label: string; unit: string; from: string; to: string; points: Point[]; truncated: boolean; note: string };
type Milestone = { id: string; title: string; targetValue?: number | null; dueDate: string | null; reached?: boolean; achievedAt: string | null };
type Goal = {
  id: string; title: string; metric: string | null; metricLabel: string | null; unit: string | null; baselineValue?: number | null; targetValue?: number | null;
  latest?: { value: number; at: string; source: string; sourceLabel: string } | null; valuesWithheld: boolean; targetDate: string | null;
  status: 'active' | 'achieved' | 'paused' | 'dropped'; createdByRole: 'member' | 'coach'; achievedAt: string | null; achievedHow: 'target_reached' | 'marked' | null;
  achievementWithheld?: boolean; autoAchieve: boolean; milestones: Milestone[]; createdAt: string;
};
type Question = { key: string; label: string; type: 'scale_1_5' | 'number' | 'text' | 'yes_no'; metric?: string };
type Answer = number | string | boolean;
type Checkin = {
  id: string; coachName: string; title: string; questions: Question[]; dueDate: string; status: 'requested' | 'submitted' | 'reviewed' | 'missed';
  answers?: Record<string, Answer> | null; answersWithheld: boolean; submittedAt: string | null; reviewedAt: string | null; reviewedByName: string | null; response: string | null;
  notes?: Array<{ id: string; body: string; authorName: string; createdAt: string }>;
};
type Schedule = { id: string; coachName: string; templateId: string; templateTitle: string; weekday: number; weekdayLabel: string; active: boolean; createdAt: string };
type Template = { id: string; title: string; description: string; questions: Question[]; scope: 'library' | 'coach'; status: string; createdByName: string };
type AdherenceLine = { key: string; label: string; due: number; done: number; pct: number | null; note?: string };

const QUESTION_TYPES: Array<[Question['type'], string]> = [['scale_1_5', '1 to 5'], ['number', 'Number'], ['text', 'Free text'], ['yes_no', 'Yes or no']];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const GOAL_PILL: Record<Goal['status'], [string, 'success' | 'warning' | 'info']> = { active: ['Active', 'success'], achieved: ['Achieved', 'success'], paused: ['Paused', 'info'], dropped: ['Dropped', 'info'] }; // the web's paused and cancelled pills are neutral: the app's nearest tone is info
const CHECKIN_PILL: Record<Checkin['status'], [string, 'success' | 'warning' | 'info']> = { requested: ['Waiting for answers', 'warning'], submitted: ['Sent, not reviewed', 'warning'], reviewed: ['Reviewed', 'success'], missed: ['Missed', 'info'] };
const RANGES = [[30, '30 days'], [90, '90 days'], [182, '6 months'], [365, '1 year']] as const;
const SOURCE_COLOR: Record<string, string> = { member: colors.brand, coach: colors.info, device: colors.success, import: colors.warning };
const calDay = (d: string) => fmtDate(`${d}T06:30:00Z`);

export function GoalsTab({ ctx }: { ctx: RecordTabContext }) {
  const id = ctx.memberId;
  const shared = ctx.sharing;
  const features = useFeatures(true);
  const { show, node: flash } = useFlash();
  const tick = useRecordTick(ctx.record); // the record screen's pull to refresh reloads this tab's data too
  const goals = useLoad<{ items: Goal[]; healthShared: boolean; metrics: Metric[] }>(`coach-goals-${id}`, () => get(`/coach/clients/${id}/goals`), [id, tick]);
  const checkins = useLoad<{ items: Checkin[]; schedules: Schedule[]; healthShared: boolean }>(`coach-checkins-${id}`, () => get(`/coach/clients/${id}/checkins`), [id, tick]);
  const templates = useLoad<{ items: Template[]; metrics: Metric[] }>('coach-checkin-templates', () => get('/coach/checkin-templates'), [tick]);
  const [reviewing, setReviewing] = useState<Checkin | null>(null);
  const metrics = goals.data?.metrics ?? [];
  const run = async (fn: () => Promise<unknown>, toast: string, after?: () => void) => { try { await fn(); show(toast); after?.(); } catch (e) { show(errorText(e), 'error'); } };
  return <View style={{ gap: space.md }}>
    {flash}
    {!shared ? <Notice kind="warning" title="Health records not shared">Goal titles and check-in dates show; values, answers, trends and photos stay hidden until the member turns on sharing with their coach.</Notice> : null}

    <Card><Eyebrow>New</Eyebrow><H2>Set a goal for the client</H2>
      <GoalForm metrics={metrics} allowValues={shared} onSave={async (input) => { await post(`/coach/clients/${id}/goals`, input); show('Goal set; the member was told'); goals.reload(); }} />
      <P muted small>A target is the member’s and yours to agree; Bioptime does not suggest one.</P>
    </Card>
    <TabState loading={goals.loading && !goals.data} error={goals.error} onRetry={goals.reload}>
      {goals.data?.items.length ? goals.data.items.map((g) => <GoalCard key={g.id} goal={g}
        onStatus={(status) => run(() => patch(`/coach/clients/${id}/goals/${g.id}`, { status }), `${g.title}: ${label(status)}`, goals.reload)}
        onAddMilestone={(input) => run(() => post(`/coach/clients/${id}/goals/${g.id}/milestones`, input), 'Milestone added', goals.reload)} />)
        : goals.data ? <Card><Empty title="No goals yet" body="Set one together with the member." /></Card> : null}
    </TabState>

    <ScheduleCard memberId={id} templates={templates.data?.items ?? []} metrics={templates.data?.metrics ?? []} schedules={checkins.data?.schedules ?? []} show={show} onChange={() => { checkins.reload(); templates.reload(); }} />
    <TabState loading={checkins.loading && !checkins.data} error={checkins.error} onRetry={checkins.reload}>
      {checkins.data?.items.length ? checkins.data.items.slice(0, 20).map((c) => <Card key={c.id}>
        <Eyebrow>{`Due ${calDay(c.dueDate)}${c.submittedAt ? ` · sent ${relative(c.submittedAt)}` : ''}`}</Eyebrow>
        <Row between><H2>{c.title}</H2><Pill tone={CHECKIN_PILL[c.status][1]}>{CHECKIN_PILL[c.status][0]}</Pill></Row>
        {c.answersWithheld ? <P muted>Answers are hidden while the member does not share health records.</P> : <AnswersView questions={c.questions} answers={c.answers} />}
        {c.response ? <Tile><Eyebrow>{`Reply to the member · ${c.reviewedByName} · ${fmtDate(c.reviewedAt)}`}</Eyebrow><P>{c.response}</P></Tile> : null}
        {(c.notes ?? []).map((n) => <Tile key={n.id}><Eyebrow>{`Private to the coaching team · ${n.authorName} · ${fmtDate(n.createdAt)}`}</Eyebrow><P>{n.body}</P></Tile>)}
        {c.status === 'submitted' && shared ? <Button title="Review" small onPress={() => setReviewing(c)} style={{ alignSelf: 'flex-start' }} /> : null}
      </Card>) : checkins.data ? <Card><Empty title="No check-ins yet" body="Set a weekly check-in or ask for one now." /></Card> : null}
    </TabState>

    {shared && metrics.length > 0 ? <CoachTrends memberId={id} metrics={metrics} goals={goals.data?.items ?? []} tick={tick} /> : null}
    {shared && features?.has('progressPhotos') ? <CoachPhotos memberId={id} tick={tick} /> : null}
    <ReviewSheet checkin={reviewing} onClose={() => setReviewing(null)} onDone={() => { show('Review saved; the member was told'); checkins.reload(); }} />
  </View>;
}

/* ---------- goals ---------- */
function movedPct(g: Goal): number | null {
  if (g.baselineValue === undefined || g.baselineValue === null || g.targetValue === undefined || g.targetValue === null || !g.latest || g.targetValue === g.baselineValue) return null;
  return Math.max(0, Math.min(100, Math.round(((g.latest.value - g.baselineValue) / (g.targetValue - g.baselineValue)) * 100)));
}
function achievedText(g: Goal): string {
  if (g.achievedHow === 'target_reached') return `Reached ${fmtDate(g.achievedAt)}: a logged value met the target.`;
  if (g.achievedHow === 'marked') return `Marked achieved ${fmtDate(g.achievedAt)}.`;
  if (g.achievementWithheld) return 'Achieved. How and when stay hidden with the values.';
  return g.achievedAt ? `Achieved ${fmtDate(g.achievedAt)}.` : 'Achieved.';
}

function GoalCard({ goal: g, onStatus, onAddMilestone }: { goal: Goal; onStatus: (s: Goal['status']) => Promise<void>; onAddMilestone: (input: { title: string; targetValue: number | null; dueDate: string | null }) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [msTitle, setMsTitle] = useState('');
  const [msValue, setMsValue] = useState('');
  const [msDate, setMsDate] = useState('');
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
  const pct = movedPct(g);
  const unit = g.unit ? ` ${g.unit}` : '';
  const measurable = g.metric !== null || g.unit !== null;
  const hasValues = g.baselineValue !== undefined && (g.baselineValue !== null || g.targetValue !== null);
  const buttons: Array<[Goal['status'], string]> = g.status === 'active' ? [['achieved', 'Mark achieved'], ['paused', 'Pause'], ['dropped', 'Drop']] : g.status === 'paused' ? [['active', 'Resume'], ['dropped', 'Drop']] : [['active', 'Set active again']];
  const [pillText, pillTone] = GOAL_PILL[g.status];
  return <Card>
    <Eyebrow>{g.metricLabel ?? (g.createdByRole === 'coach' ? 'Set by the coach' : 'Goal')}</Eyebrow>
    <Row between><H2>{g.title}</H2><Pill tone={pillTone}>{pillText}</Pill></Row>
    {g.valuesWithheld ? <P muted>Values are hidden while the member does not share health records with their coach.</P> : hasValues ? <KvList rows={[
      g.baselineValue !== null && g.baselineValue !== undefined ? ['Start', `${g.baselineValue}${unit}`] : null,
      g.latest ? ['Latest', `${g.latest.value}${unit} · ${g.latest.sourceLabel} · ${fmtDate(g.latest.at)}`] : null,
      g.targetValue !== null && g.targetValue !== undefined ? ['Target', `${g.targetValue}${unit}`] : null,
    ]} /> : null}
    {pct !== null && g.status !== 'achieved' ? <Bar pct={pct} tone="brand" /> : null}
    <P small>{g.targetDate ? `By ${calDay(g.targetDate)}. ` : ''}{g.status === 'achieved' ? achievedText(g) : g.autoAchieve ? 'Marked achieved automatically when a value logged after it was set reaches the target.' : 'Marked achieved by a person.'}</P>
    {g.milestones.length ? <View style={{ gap: space.xs }}>{g.milestones.map((m) => { const reached = m.reached ?? !!m.achievedAt; return <View key={m.id} style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 7, backgroundColor: reached ? colors.success : colors.borderStrong }} />
      <View style={{ flex: 1 }}><Text style={{ color: colors.text, fontSize: font.small, fontWeight: '600' }}>{m.title}{m.targetValue !== undefined && m.targetValue !== null ? ` · ${m.targetValue}${unit}` : ''}{m.dueDate ? ` · by ${calDay(m.dueDate)}` : ''}</Text><Text style={{ color: colors.muted, fontSize: font.tiny }}>{m.achievedAt ? `Reached ${fmtDate(m.achievedAt)}` : reached ? 'Reached' : 'Not reached yet'}</Text></View>
    </View>; })}</View> : null}
    <Row>
      {buttons.map(([s, text]) => <Button key={s} title={text} variant={s === 'dropped' ? 'ghost' : 'secondary'} small busy={busy} onPress={() => void run(() => onStatus(s))} />)}
      {g.createdByRole === 'coach' && g.status !== 'dropped' && !adding ? <Button title="Add a milestone" variant="ghost" small onPress={() => setAdding(true)} /> : null}
    </Row>
    {adding ? <View style={{ marginTop: space.sm }}>
      <Field label="Milestone"><Input value={msTitle} onChangeText={setMsTitle} maxLength={160} /></Field>
      {measurable && !g.valuesWithheld ? <Field label={`Value${unit ? ` (${unit.trim()})` : ''} (optional)`}><Input value={msValue} onChangeText={setMsValue} keyboardType="decimal-pad" /></Field> : null}
      <DatePickerField label="By (optional)" value={msDate} onChange={setMsDate} />
      <Row><Button title="Add" small busy={busy} disabled={msTitle.trim().length < 2 || (msValue.trim() !== '' && Number.isNaN(Number(msValue))) || (!!msDate && !isIsoDate(msDate))} onPress={() => void run(async () => { await onAddMilestone({ title: msTitle.trim(), targetValue: msValue.trim() === '' ? null : Number(msValue), dueDate: msDate || null }); setAdding(false); setMsTitle(''); setMsValue(''); setMsDate(''); })} /><Button title="Cancel" variant="ghost" small onPress={() => setAdding(false)} /></Row>
    </View> : null}
  </Card>;
}

function GoalForm({ metrics, allowValues, onSave }: { metrics: Metric[]; allowValues: boolean; onSave: (input: Record<string, unknown>) => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [metric, setMetric] = useState('');
  const [start, setStart] = useState('');
  const [target, setTarget] = useState('');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const m = metrics.find((x) => x.metric === metric);
  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  const bad = (s: string) => s.trim() !== '' && Number.isNaN(Number(s));
  const save = async () => {
    setBusy(true); setErr(''); setErrs({});
    try {
      await onSave({ title: title.trim(), ...(metric ? { metric, baselineValue: num(start), targetValue: num(target) } : {}), ...(date ? { targetDate: date } : {}) });
      setTitle(''); setMetric(''); setStart(''); setTarget(''); setDate('');
    } catch (e) { setErrs(fieldErrorsOf(e)); setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <View>
    <Field label="Goal" error={errs.title}><Input value={title} onChangeText={setTitle} maxLength={160} placeholder="In your own words" /></Field>
    {allowValues ? <PickerField label="Measured by (optional)" hint="With a metric, a start and a target, the goal is marked achieved when a value logged later reaches the target." value={metric} placeholder="Not measured" options={metrics.map((x) => ({ value: x.metric, label: `${x.label} (${x.unit})` }))} onChange={setMetric} error={errs.metric} /> : null}
    {m ? <>
      <Field label={`Start (${m.unit}) (optional)`} hint="Empty: the latest value logged." error={errs.baselineValue}><Input value={start} onChangeText={setStart} keyboardType="decimal-pad" /></Field>
      <Field label={`Target (${m.unit})`} hint={m.min !== null && m.max !== null ? `Between ${m.min} and ${m.max}.` : undefined} error={errs.targetValue}><Input value={target} onChangeText={setTarget} keyboardType="decimal-pad" /></Field>
    </> : null}
    <DatePickerField label="By (optional)" value={date} onChange={setDate} min={istDate(0)} error={errs.targetDate} />
    <Button title="Set the goal" busy={busy} disabled={title.trim().length < 2 || bad(start) || bad(target) || (!!m && target.trim() === '') || (!!date && !isIsoDate(date))} onPress={save} />
    {err ? <Notice kind="error">{err}</Notice> : null}
  </View>;
}

/* ---------- check-ins ---------- */
function AnswersView({ questions, answers }: { questions: Question[]; answers: Record<string, Answer> | null | undefined }) {
  if (!answers) return null;
  return <KvList rows={questions.map((q) => { const v = answers[q.key]; return [q.label, v === undefined ? 'No answer' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : q.type === 'scale_1_5' ? `${v} of 5` : String(v)] as [string, string]; })} />;
}

function ScheduleCard({ memberId, templates, metrics, schedules, show, onChange }: { memberId: string; templates: Template[]; metrics: Metric[]; schedules: Schedule[]; show: (t: string, k?: 'success' | 'error') => void; onChange: () => void }) {
  const active = schedules.find((s) => s.active);
  const [templateId, setTemplateId] = useState('');
  const [weekday, setWeekday] = useState('1');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [stop, setStop] = useState(false);
  const [writing, setWriting] = useState(false);
  const chosen = templateId || templates[0]?.id || '';
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(''); try { await fn(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); } };
  return <Card>
    <Eyebrow>Check-ins</Eyebrow><H2>Weekly check-in</H2>
    {active ? <><P small>{`Every ${active.weekdayLabel}: “${active.templateTitle}”, set by ${active.coachName} on ${fmtDate(active.createdAt)}.`}</P><Button title="Stop the weekly check-in" variant="ghost" small onPress={() => setStop(true)} style={{ alignSelf: 'flex-start' }} /></> : <P small>No weekly check-in yet.</P>}
    {templates.length ? <View style={{ marginTop: space.sm }}>
      <PickerField label="Template" value={chosen} options={templates.map((t) => ({ value: t.id, label: `${t.title}${t.scope === 'coach' ? ' (yours)' : ''}` }))} onChange={setTemplateId} />
      <PickerField label="Every" value={weekday} options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))} onChange={setWeekday} />
      <Row>
        <Button title={active ? 'Replace weekly' : 'Set weekly'} small busy={busy} disabled={!chosen} onPress={() => void run(async () => { await post(`/coach/clients/${memberId}/checkin-schedules`, { templateId: chosen, weekday: Number(weekday) }); show(active ? 'Weekly check-in replaced' : 'Weekly check-in set'); onChange(); })} />
        <Button title="Ask for one now" variant="secondary" small busy={busy} disabled={!chosen} onPress={() => void run(async () => { await post(`/coach/clients/${memberId}/checkins`, { templateId: chosen }); show('Asked; the member was told'); onChange(); })} />
      </Row>
    </View> : <P muted>No published templates yet.</P>}
    <Button title="Write your own template" variant="ghost" small onPress={() => setWriting(true)} style={{ alignSelf: 'flex-start' }} />
    {err ? <Notice kind="error">{err}</Notice> : null}
    <ConfirmSheet open={stop} onClose={() => setStop(false)} title="Stop the weekly check-in?" body="No new check-ins are requested. Ones already waiting stay open for the member." confirmLabel="Stop" busy={busy}
      onConfirm={() => run(async () => { await api('DELETE', `/coach/clients/${memberId}/checkin-schedules/${active!.id}`); setStop(false); show('Weekly check-in stopped'); onChange(); })} />
    <TemplateSheet open={writing} onClose={() => setWriting(false)} metrics={metrics} onSaved={() => { show('Template saved; only you can use it'); onChange(); }} />
  </Card>;
}

/** The portal's ReviewDialog: reply to the member, a private note for the coaching team. */
function ReviewSheet({ checkin, onClose, onDone }: { checkin: Checkin | null; onClose: () => void; onDone: () => void }) {
  const [response, setResponse] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { setResponse(''); setNote(''); setErr(''); }, [checkin?.id]);
  const send = async () => {
    if (!checkin) return;
    setBusy(true); setErr('');
    try { await post(`/coach/checkins/${checkin.id}/review`, { response: response.trim() || undefined, privateNote: note.trim() || undefined }); onDone(); onClose(); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <Sheet open={!!checkin} onClose={onClose} title={checkin ? `Review: ${checkin.title}` : 'Review'} footer={<Row><Button title="Not now" variant="ghost" onPress={onClose} disabled={busy} /><Button title={response.trim() ? 'Send the reply' : 'Mark reviewed'} busy={busy} onPress={send} style={{ flex: 1 }} /></Row>}>
    {checkin ? <AnswersView questions={checkin.questions} answers={checkin.answers} /> : null}
    <View style={{ marginTop: space.md }}>
      <Field label="Reply to the member (optional)" hint="They read it under Progress, Check-ins."><Input value={response} onChangeText={setResponse} maxLength={2000} multiline style={{ minHeight: 80, textAlignVertical: 'top' }} /></Field>
      <Field label="Private note for the coaching team (optional)" hint="Never shown to the member."><Input value={note} onChangeText={setNote} maxLength={4000} multiline style={{ minHeight: 64, textAlignVertical: 'top' }} /></Field>
    </View>
    {err ? <Notice kind="error">{err}</Notice> : null}
  </Sheet>;
}

/** A coach's own template: usable at once, by that coach only (the portal's TemplateDialog). */
export function TemplateSheet({ open, onClose, metrics, onSaved }: { open: boolean; onClose: () => void; metrics: Metric[]; onSaved: () => void }) {
  const [title, setTitle] = useState('');
  const [questions, setQuestions] = useState<Question[]>([{ key: '', label: '', type: 'scale_1_5' }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ready = questions.length > 0 && questions.every((q) => /^[a-z][a-z0-9_]{1,39}$/.test(q.key) && q.label.trim().length >= 3) && new Set(questions.map((q) => q.key)).size === questions.length;
  const save = async () => {
    setBusy(true); setErr('');
    try { await post('/coach/checkin-templates', { title: title.trim(), questions }); onSaved(); onClose(); setTitle(''); setQuestions([{ key: '', label: '', type: 'scale_1_5' }]); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <Sheet open={open} onClose={onClose} title="Write a check-in template" footer={<Row><Button title="Cancel" variant="ghost" onPress={onClose} disabled={busy} /><Button title="Save" busy={busy} disabled={title.trim().length < 2 || !ready} onPress={save} style={{ flex: 1 }} /></Row>}>
    <Field label="Title"><Input value={title} onChangeText={setTitle} maxLength={120} /></Field>
    <QuestionsEditor value={questions} onChange={setQuestions} metrics={metrics} />
    <P muted small>Plain coaching questions. A licensed clinical questionnaire is never presented as a screening tool here.</P>
    {err ? <Notice kind="error">{err}</Notice> : null}
  </Sheet>;
}

function keyFrom(text: string, all: Question[], self: number): string {
  const base = text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[^a-z]+/, '').slice(0, 30) || 'q';
  let key = base.length >= 2 ? base : `${base}_q`, n = 2;
  while (all.some((q, k) => k !== self && q.key === key)) key = `${base}_${n++}`;
  return key;
}
function QuestionsEditor({ value, onChange, metrics }: { value: Question[]; onChange: (q: Question[]) => void; metrics: Metric[] }) {
  const update = (i: number, p: Partial<Question>) => onChange(value.map((q, k) => { if (k !== i) return q; const n = { ...q, ...p }; return n.type === 'number' || n.type === 'scale_1_5' ? n : { key: n.key, label: n.label, type: n.type }; }));
  const scaleMetrics = useMemo(() => metrics.filter((m) => m.metric.endsWith('_1_5') || (m.min !== null && m.max !== null && m.min >= 1 && m.max <= 5)), [metrics]);
  return <View style={{ gap: space.sm }}>
    {value.map((q, i) => <Tile key={i}>
      <Field label={`Question ${i + 1}`}><Input value={q.label} onChangeText={(t) => update(i, { label: t, key: q.key || keyFrom(t, value, i) })} maxLength={200} /></Field>
      <Field label="Key" hint="Lower-case, unique"><Input value={q.key} onChangeText={(t) => update(i, { key: t.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40) })} autoCapitalize="none" /></Field>
      <PickerField label="Answer" value={q.type} options={QUESTION_TYPES.map(([k, v]) => ({ value: k, label: v }))} onChange={(t) => update(i, { type: t as Question['type'] })} />
      {q.type === 'number' || q.type === 'scale_1_5' ? <PickerField label="Also logs (optional)" value={q.metric ?? ''} placeholder="Nothing" options={(q.type === 'scale_1_5' ? scaleMetrics : metrics).map((m) => ({ value: m.metric, label: `${m.label} (${m.unit})` }))} onChange={(m) => update(i, { metric: m || undefined })} /> : null}
      <Button title="Remove" variant="ghost" small disabled={value.length <= 1} onPress={() => onChange(value.filter((_, k) => k !== i))} style={{ alignSelf: 'flex-start' }} />
    </Tile>)}
    {value.length < 20 ? <Button title="Add a question" variant="secondary" small onPress={() => onChange([...value, { key: '', label: '', type: 'text' }])} style={{ alignSelf: 'flex-start' }} /> : null}
  </View>;
}

/* ---------- trends and adherence (shared only) ---------- */
function CoachTrends({ memberId, metrics, goals, tick }: { memberId: string; metrics: Metric[]; goals: Goal[]; tick: number }) {
  const [metric, setMetric] = useState(metrics[0]?.metric ?? '');
  const [days, setDays] = useState<number>(90);
  const [from, setFrom] = useState(istDate(-89));
  const [to, setTo] = useState(istDate(0));
  const [range, setRange] = useState({ from: istDate(-89), to: istDate(0) });
  const choose = (n: number) => { const f = istDate(-(n - 1)), t = istDate(0); setDays(n); setFrom(f); setTo(t); setRange({ from: f, to: t }); };
  const target = goals.find((g) => g.metric === metric && g.status === 'active' && g.targetValue !== null && g.targetValue !== undefined)?.targetValue ?? null;
  const valid = isIsoDate(from) && isIsoDate(to) && from <= to;
  const series = useLoad<Series>(metric ? `coach-series-${memberId}-${metric}-${range.from}-${range.to}` : null, () => get(`/coach/clients/${memberId}/progress/series${qs({ metric, from: range.from, to: range.to })}`), [metric, range.from, range.to, tick]);
  const adherence = useLoad<{ items: AdherenceLine[]; note: string }>(`coach-adherence-${memberId}-${range.from}-${range.to}`, () => get(`/coach/clients/${memberId}/adherence${qs({ from: range.from, to: range.to })}`), [range.from, range.to, tick]);
  return <View style={{ gap: space.md }}>
    <Card><Eyebrow>Trends</Eyebrow><H2>Over a chosen range</H2>
      <Row>{metrics.map((m) => <Chip key={m.metric} selected={m.metric === metric} onPress={() => setMetric(m.metric)}>{m.label}</Chip>)}</Row>
      <Row>{RANGES.map(([n, text]) => <Chip key={n} selected={days === n && range.from === istDate(-(n - 1))} onPress={() => choose(n)}>{text}</Chip>)}</Row>
      <Row><View style={{ flex: 1 }}><DatePickerField label="From" value={from} onChange={setFrom} max={to} /></View><View style={{ flex: 1 }}><DatePickerField label="To" value={to} onChange={setTo} min={from} max={istDate(0)} /></View></Row>
      <Button title="Show" variant="secondary" small disabled={!valid || (from === range.from && to === range.to)} onPress={() => { setDays(0); setRange({ from, to }); }} style={{ alignSelf: 'flex-start' }} />
    </Card>
    {metric ? <Card>
      {series.error ? <Notice kind="error">{series.error.message}</Notice> : !series.data ? <Loading /> : <SeriesView s={series.data} target={target} />}
    </Card> : null}
    <Card><Eyebrow>Adherence</Eyebrow><H2>Due and done</H2>
      {adherence.error ? <Notice kind={/RANGE_TOO_LONG|at most/.test(adherence.error.message) || adherence.error.code === 'RANGE_TOO_LONG' ? 'warning' : 'error'}>{adherence.error.message}</Notice> : !adherence.data ? <Loading /> : adherence.data.items.length ? adherence.data.items.map((i) => <View key={i.key} style={{ gap: space.xs }}>
        <Row between><Text style={{ color: colors.text, fontWeight: '600' }}>{i.label}</Text><Text style={{ color: colors.muted, fontSize: font.small }}>{i.pct === null ? 'Nothing was due' : `${i.done} of ${i.due} · ${i.pct}%`}</Text></Row>
        {i.pct !== null ? <Bar pct={i.pct} /> : null}
        {i.note ? <P muted small>{i.note}</P> : null}
      </View>) : <Empty title="Nothing to count yet" body="Plan actions, habits, meals and workouts appear here when they are part of the programme." />}
      {adherence.data ? <P muted small>{adherence.data.note}</P> : null}
    </Card>
  </View>;
}

function SeriesView({ s, target }: { s: Series; target: number | null }) {
  const pts = s.points;
  const [table, setTable] = useState(false);
  const geometry = useMemo(() => {
    if (!pts.length) return null;
    const t0 = Date.parse(`${s.from}T00:00:00+05:30`), t1 = Date.parse(`${s.to}T23:59:59+05:30`);
    const vals = pts.map((p) => p.value).concat(target !== null ? [target] : []);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (lo === hi) { lo -= 1; hi += 1; }
    return { x: (iso: string) => Math.max(0, Math.min(1, (Date.parse(iso) - t0) / Math.max(1, t1 - t0))), y: (v: number) => (v - lo) / (hi - lo), lo, hi };
  }, [pts, s.from, s.to, target]);
  const n = pts.length;
  return <View style={{ gap: space.sm }}>
    <Eyebrow>{`${calDay(s.from)} to ${calDay(s.to)}`}</Eyebrow>
    <Row between><H2>{`${s.label}${s.unit ? ` (${s.unit})` : ''}`}</H2><Text style={{ color: colors.muted, fontSize: font.small }}>{`${n} value${n === 1 ? '' : 's'}`}</Text></Row>
    {!n || !geometry ? <Empty title="No values in this range" body="Choose a longer range, or log a value." /> : <>
      <View accessible accessibilityLabel={`${s.label}: ${n} value${n === 1 ? '' : 's'}; latest ${pts[n - 1]!.value} ${s.unit} (${pts[n - 1]!.sourceLabel})${target !== null ? `; target ${target} ${s.unit}` : ''}.`} style={{ height: 150, borderRadius: radius.md, backgroundColor: colors.base, borderWidth: 1, borderColor: colors.border, padding: space.sm }}>
        <View style={{ flex: 1 }}>
          {target !== null ? <View style={{ position: 'absolute', left: 0, right: 0, bottom: `${geometry.y(target) * 92}%`, borderTopWidth: 1, borderStyle: 'dashed', borderColor: colors.borderStrong }}><Text style={{ color: colors.muted, fontSize: font.tiny, alignSelf: 'flex-end' }}>{`Target ${target}`}</Text></View> : null}
          {pts.map((p, i) => <View key={`${p.at}-${i}`} style={{ position: 'absolute', left: `${geometry.x(p.at) * 96}%`, bottom: `${geometry.y(p.value) * 92}%`, width: 8, height: 8, borderRadius: 4, backgroundColor: SOURCE_COLOR[p.source] ?? colors.text }} />)}
        </View>
      </View>
      <Row between><Text style={st.axis}>{calDay(s.from)}</Text><Text style={st.axis}>{`${Math.round(geometry.lo * 10) / 10} to ${Math.round(geometry.hi * 10) / 10} ${s.unit}`}</Text><Text style={st.axis}>{calDay(s.to)}</Text></Row>
      <Row>{[...new Map(pts.map((p) => [p.source, p.sourceLabel])).entries()].map(([source, text]) => <View key={source} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: SOURCE_COLOR[source] ?? colors.text }} /><Text style={{ color: colors.muted, fontSize: font.small }}>{text}</Text></View>)}</Row>
      <Button title={table ? 'Hide the values' : 'Show every value'} variant="ghost" small onPress={() => setTable((t) => !t)} style={{ alignSelf: 'flex-start' }} />
      {table ? pts.slice().reverse().map((p, i) => <Row key={`${p.at}-${i}`} between><Text style={{ color: colors.text, fontSize: font.small }}>{`${p.value} ${s.unit}`}</Text><Text style={{ color: colors.muted, fontSize: font.small }}>{`${p.sourceLabel} · ${fmtDateTime(p.at)}`}</Text></Row>) : null}
      {s.truncated ? <P muted small>Only the first 2,000 values in this range are drawn; choose a shorter range to see the rest.</P> : null}
    </>}
    <P muted small>{s.note}</P>
  </View>;
}

/* ---------- photos the member shares ---------- */
function CoachPhotos({ memberId, tick }: { memberId: string; tick: number }) {
  const p = useLoad<{ items: Array<{ id: string; fileId: string; pose: string; takenAt: string }>; withheld: string | null }>(`coach-photos-${memberId}`, () => get(`/coach/clients/${memberId}/progress/photos`), [memberId, tick]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const open = async (x: { id: string; fileId: string }) => { setBusy(x.id); setErr(''); try { await openPrivateFile(x.fileId); } catch (e) { setErr(errorText(e)); } finally { setBusy(null); } };
  return <Card><Eyebrow>Shared by the member</Eyebrow><H2>Progress photos</H2>
    {p.error ? <Notice kind="error">{p.error.message}</Notice> : !p.data ? <Loading /> : p.data.withheld ? <P muted>The member has not given (or has withdrawn) the progress photo consent.</P>
      : p.data.items.length ? p.data.items.map((x) => <Row key={x.id} between><Text style={{ color: colors.text, fontSize: font.small }}>{`${label(x.pose)} · ${fmtDate(x.takenAt)}`}</Text><Button title="Open photo" variant="secondary" small busy={busy === x.id} onPress={() => void open(x)} /></Row>)
        : <Empty title="No shared photos" body="The member chooses photo by photo what you see." />}
    {err ? <Notice kind="error">{err}</Notice> : null}
    <P muted small>Each opening is recorded, and each link expires after five minutes.</P>
  </Card>;
}

const st = { axis: { color: colors.muted, fontSize: font.tiny } };
