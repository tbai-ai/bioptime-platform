/* M2 Progress, the "Goals and check-ins" tab of the client record in the coach workspace: the client's goals, their
   weekly check-in and the check-ins themselves (reply and private note), trends over a chosen range with adherence, and
   the photos the client chose to share. While the client does not share health records with the coach, values,
   answers, trends and photos are withheld (the server refuses them with NOT_SHARED; this view does not ask). */
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { fmtDate, label, relative } from '../../lib/format';
import { useFeatures } from '../runtime';
import type { ClientRecordTabContext } from '../types';
import { Alert, Button, Card, CardHead, ConfirmDialog, Dialog, Empty, Field, Input, Select, Skeleton, errorText, useApi, useToast } from '../../ui';
import { AdherenceCard, AnswersView, CheckinPill, GoalCard, GoalForm, MetricPicker, PrivateImage, QuestionsEditor, RangePicker, ScheduleLine, SeriesCard, WEEKDAYS, questionsReady, useRange, type Checkin, type Goal, type Metric, type Question, type Schedule, type Template } from './shared';
import { ReviewDialog } from './CheckinReview';

export function CoachGoalsTab({ ctx }: { ctx: ClientRecordTabContext }) {
  const id = ctx.memberId;
  const shared = ctx.healthShared;
  const toast = useToast();
  const features = useFeatures(true);
  const goals = useApi<{ items: Goal[]; healthShared: boolean; metrics: Metric[] }>(() => api.get(`/coach/clients/${id}/goals`), [id]);
  const checkins = useApi<{ items: Checkin[]; schedules: Schedule[]; healthShared: boolean }>(() => api.get(`/coach/clients/${id}/checkins`), [id]);
  const templates = useApi<{ items: Template[]; metrics: Metric[] }>(() => api.get('/coach/checkin-templates'), []);
  const [reviewing, setReviewing] = useState<Checkin | null>(null);
  const metrics = goals.data?.metrics ?? [];
  const goalActions = {
    role: 'coach' as const,
    onStatus: async (g: Goal, status: Goal['status']) => { await api.patch(`/coach/clients/${id}/goals/${g.id}`, { status }); toast(`${g.title}: ${label(status)}`); goals.reload(); },
    onAddMilestone: async (g: Goal, input: Record<string, unknown>) => { await api.post(`/coach/clients/${id}/goals/${g.id}/milestones`, input); toast('Milestone added'); goals.reload(); },
  };
  return <div className="stack">
    {!shared && <Alert kind="warning" title="Health records not shared">Goal titles and check-in dates show; values, answers, trends and photos stay hidden until the member turns on sharing with their coach.</Alert>}

    <div className="grid">
      <div className="span4"><Card><CardHead eyebrow="New" title="Set a goal for the client" /><GoalForm metrics={metrics} allowValues={shared} onSave={async (input) => { await api.post(`/coach/clients/${id}/goals`, input); toast('Goal set; the member was told'); goals.reload(); }} />
        <p className="muted" style={{ marginTop: 8 }}>A target is the member’s and yours to agree; Bioptime does not suggest one.</p></Card></div>
      <div className="span8"><div className="stack">
        {goals.error ? <Alert kind="error">{goals.error}</Alert> : !goals.data ? <Skeleton rows={4} /> : goals.data.items.length ? goals.data.items.map((g) => <GoalCard key={g.id} goal={g} actions={goalActions} />) : <Card><Empty title="No goals yet" body="Set one together with the member." /></Card>}
      </div></div>
    </div>

    <div className="grid">
      <div className="span4"><ScheduleCard memberId={id} templates={templates.data?.items ?? []} metrics={templates.data?.metrics ?? []} schedules={checkins.data?.schedules ?? []} onChange={() => { checkins.reload(); templates.reload(); }} /></div>
      <div className="span8"><div className="stack">
        {checkins.error ? <Alert kind="error">{checkins.error}</Alert> : !checkins.data ? <Skeleton rows={4} /> : checkins.data.items.length ? checkins.data.items.slice(0, 20).map((c) => <Card key={c.id} dense>
          <CardHead eyebrow={`Due ${fmtDate(`${c.dueDate}T06:30:00Z`)}${c.submittedAt ? ` · sent ${relative(c.submittedAt)}` : ''}`} title={c.title} right={<CheckinPill status={c.status} />} />
          {c.answersWithheld ? <p className="muted">Answers are hidden while the member does not share health records.</p> : <AnswersView questions={c.questions} answers={c.answers} />}
          {c.response && <div className="bp-tile" style={{ marginTop: 10 }}><span className="bp-eyebrow">Reply to the member · {c.reviewedByName} · {fmtDate(c.reviewedAt)}</span><p style={{ margin: '4px 0 0' }}>{c.response}</p></div>}
          {(c.notes ?? []).map((n) => <div key={n.id} className="bp-tile" style={{ marginTop: 8 }}><span className="bp-eyebrow">Private to the coaching team · {n.authorName} · {fmtDate(n.createdAt)}</span><p style={{ margin: '4px 0 0' }}>{n.body}</p></div>)}
          {c.status === 'submitted' && shared && <div className="row" style={{ marginTop: 10 }}><Button variant="primary" size="sm" onClick={() => setReviewing(c)}>Review</Button></div>}
        </Card>) : <Card><Empty title="No check-ins yet" body="Set a weekly check-in or ask for one now." /></Card>}
      </div></div>
    </div>

    {shared && metrics.length > 0 && <CoachTrends memberId={id} metrics={metrics} goals={goals.data?.items ?? []} />}
    {shared && features?.has('progressPhotos') && <CoachPhotos memberId={id} />}
    <ReviewDialog checkin={reviewing} onClose={() => setReviewing(null)} onDone={() => { toast('Review saved; the member was told'); checkins.reload(); }} />
  </div>;
}

function ScheduleCard({ memberId, templates, metrics, schedules, onChange }: { memberId: string; templates: Template[]; metrics: Metric[]; schedules: Schedule[]; onChange: () => void }) {
  const toast = useToast();
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
    <CardHead eyebrow="Check-ins" title="Weekly check-in" />
    {active ? <div className="stack" style={{ gap: 8 }}><ScheduleLine s={active} /><div><Button size="sm" variant="tertiary" onClick={() => setStop(true)}>Stop the weekly check-in</Button></div></div> : <p className="small">No weekly check-in yet.</p>}
    {templates.length ? <div className="form" style={{ marginTop: 12 }}>
      <Field label="Template"><Select value={chosen} onChange={(e) => setTemplateId(e.target.value)}>{templates.map((t) => <option key={t.id} value={t.id}>{t.title}{t.scope === 'coach' ? ' (yours)' : ''}</option>)}</Select></Field>
      <Field label="Every"><Select value={weekday} onChange={(e) => setWeekday(e.target.value)}>{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</Select></Field>
      <div className="row">
        <Button variant="primary" size="sm" busy={busy} disabled={!chosen} onClick={() => run(async () => { await api.post(`/coach/clients/${memberId}/checkin-schedules`, { templateId: chosen, weekday: Number(weekday) }); toast(active ? 'Weekly check-in replaced' : 'Weekly check-in set'); onChange(); })}>{active ? 'Replace weekly' : 'Set weekly'}</Button>
        <Button size="sm" busy={busy} disabled={!chosen} onClick={() => run(async () => { await api.post(`/coach/clients/${memberId}/checkins`, { templateId: chosen }); toast('Asked; the member was told'); onChange(); })}>Ask for one now</Button>
      </div>
    </div> : <p className="muted" style={{ marginTop: 8 }}>No published templates yet.</p>}
    <div style={{ marginTop: 10 }}><Button size="sm" variant="tertiary" onClick={() => setWriting(true)}>Write your own template</Button></div>
    {err && <Alert kind="error">{err}</Alert>}
    <ConfirmDialog open={stop} onClose={() => setStop(false)} title="Stop the weekly check-in?" body="No new check-ins are requested. Ones already waiting stay open for the member." confirmLabel="Stop" onConfirm={async () => { await api.del(`/coach/clients/${memberId}/checkin-schedules/${active!.id}`); toast('Weekly check-in stopped'); onChange(); }} />
    <TemplateDialog open={writing} onClose={() => setWriting(false)} metrics={metrics} onSaved={() => { toast('Template saved; only you can use it'); onChange(); }} />
  </Card>;
}

/** A coach's own template: usable at once, by that coach only. */
export function TemplateDialog({ open, onClose, metrics, onSaved }: { open: boolean; onClose: () => void; metrics: Metric[]; onSaved: () => void }) {
  const [title, setTitle] = useState('');
  const [questions, setQuestions] = useState<Question[]>([{ key: '', label: '', type: 'scale_1_5' }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    setBusy(true); setErr('');
    try { await api.post('/coach/checkin-templates', { title: title.trim(), questions }); onSaved(); onClose(); setTitle(''); setQuestions([{ key: '', label: '', type: 'scale_1_5' }]); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <Dialog open={open} onClose={onClose} title="Write a check-in template" footer={<><Button variant="tertiary" onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={title.trim().length < 2 || !questionsReady(questions)} onClick={save}>Save</Button></>}>
    <div className="form">
      <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} /></Field>
      <QuestionsEditor value={questions} onChange={setQuestions} metrics={metrics} />
      <p className="muted">Plain coaching questions. A licensed clinical questionnaire is never presented as a screening tool here.</p>
    </div>
    {err && <Alert kind="error">{err}</Alert>}
  </Dialog>;
}

function CoachTrends({ memberId, metrics, goals }: { memberId: string; metrics: Metric[]; goals: Goal[] }) {
  const r = useRange(90);
  const [metric, setMetric] = useState(metrics[0]?.metric ?? '');
  const target = goals.find((g) => g.metric === metric && g.status === 'active' && g.targetValue !== null && g.targetValue !== undefined)?.targetValue ?? null;
  return <div className="stack">
    <Card dense><CardHead eyebrow="Trends" title="Over a chosen range" /><div className="stack"><MetricPicker metrics={metrics} value={metric} onChange={setMetric} /><RangePicker {...r} /></div></Card>
    <div className="grid">
      <div className="span8">{metric && <SeriesCard path={`/coach/clients/${memberId}/progress/series`} metric={metric} range={r.range} target={target} />}</div>
      <div className="span4"><AdherenceCard path={`/coach/clients/${memberId}/adherence`} range={r.range} /></div>
    </div>
  </div>;
}

function CoachPhotos({ memberId }: { memberId: string }) {
  const p = useApi<{ items: Array<{ id: string; fileId: string; pose: string; takenAt: string }>; withheld: string | null }>(() => api.get(`/coach/clients/${memberId}/progress/photos`), [memberId]);
  return <Card>
    <CardHead eyebrow="Shared by the member" title="Progress photos" />
    {p.error ? <Alert kind="error">{p.error}</Alert> : !p.data ? <Skeleton rows={2} /> : p.data.withheld ? <p className="muted">The member has not given (or has withdrawn) the progress photo consent.</p>
      : p.data.items.length ? <div className="weekGrid">{p.data.items.map((x) => <div key={x.id} className="bp-tile stack" style={{ gap: 8 }}><PrivateImage fileId={x.fileId} alt={`${label(x.pose)} progress photo, ${fmtDate(x.takenAt)}`} auto={false} /><span className="small">{label(x.pose)} · {fmtDate(x.takenAt)}</span></div>)}</div>
      : <Empty title="No shared photos" body="The member chooses photo by photo what you see." />}
    <p className="muted" style={{ marginTop: 8 }}>Each opening is recorded, and each link expires after five minutes.</p>
  </Card>;
}

