/* M2 Progress, the member's tabs on /client/progress (pages/client/Progress.tsx draws the Overview tab as before):
   Trends (one metric over a chosen range, every point labelled with its source, and adherence per provider), Goals,
   Check-ins and Photos (only while the photo switch is on). Health detail stays the member's own; the coach sees it only
   while health sharing is on, and photos only when shared one by one. */
import React, { useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { fmtDate, label, relative } from '../../lib/format';
import { Alert, Button, Card, CardHead, ConfirmDialog, Empty, Field, Input, Pill, Select, Skeleton, errorText, useApi, useToast } from '../../ui';
import { AdherenceCard, AnswerForm, AnswersView, CheckinPill, GoalCard, GoalForm, MetricPicker, PrivateImage, RangePicker, ScheduleLine, SeriesCard, useRange, type Checkin, type Goal, type Metric, type Schedule } from './shared';

/* ---------- Trends ---------- */
export function ClientTrends({ metrics }: { metrics: Metric[] }) {
  const r = useRange(90);
  const [metric, setMetric] = useState(metrics[0]?.metric ?? '');
  const goals = useApi<{ items: Goal[] }>(() => api.get('/me/goals'), []);
  // the member's own active goal on this metric draws its target as a reference line
  const target = (goals.data?.items ?? []).find((g) => g.metric === metric && g.status === 'active' && g.targetValue !== null && g.targetValue !== undefined)?.targetValue ?? null;
  if (!metrics.length) return <Empty title="Nothing to chart" body="No metrics are switched on for logging." />;
  return <div className="stack">
    <Card dense><div className="stack"><MetricPicker metrics={metrics} value={metric} onChange={setMetric} /><RangePicker {...r} /></div></Card>
    <div className="grid">
      <div className="span8">{metric && <SeriesCard path="/me/progress/series" metric={metric} range={r.range} target={target} />}</div>
      <div className="span4"><AdherenceCard path="/me/adherence" range={r.range} /></div>
    </div>
  </div>;
}

/* ---------- Goals ---------- */
export function ClientGoals({ metrics }: { metrics: Metric[] }) {
  const g = useApi<{ items: Goal[] }>(() => api.get('/me/goals'), []);
  const toast = useToast();
  if (g.error) return <Alert kind="error">{g.error}</Alert>;
  if (!g.data) return <Skeleton rows={6} />;
  const items = g.data.items;
  const open = items.filter((x) => x.status === 'active' || x.status === 'paused');
  const done = items.filter((x) => x.status === 'achieved' || x.status === 'dropped');
  const actions = {
    role: 'member' as const,
    onStatus: async (goal: Goal, status: Goal['status']) => { await api.patch(`/me/goals/${goal.id}`, { status }); toast(`${goal.title}: ${label(status)}`); g.reload(); },
    onMilestone: async (goal: Goal, m: { id: string }, achieved: boolean) => { await api.patch(`/me/goals/${goal.id}/milestones/${m.id}`, { achieved }); g.reload(); },
    onAddMilestone: async (goal: Goal, input: Record<string, unknown>) => { await api.post(`/me/goals/${goal.id}/milestones`, input); toast('Milestone added'); g.reload(); },
  };
  return <div className="grid">
    <div className="span4"><Card><CardHead eyebrow="New" title="Set a goal" /><GoalForm metrics={metrics} allowValues onSave={async (input) => { await api.post('/me/goals', input); toast('Goal set'); g.reload(); }} /></Card></div>
    <div className="span8"><div className="stack">
      {open.length ? open.map((x) => <GoalCard key={x.id} goal={x} actions={actions} />) : <Card><Empty title="No open goals" body="Set one in your own words. A measured goal marks itself achieved when a value you log reaches the target." /></Card>}
      {done.length > 0 && <><h3 style={{ marginTop: 6 }}>Achieved and dropped</h3>{done.map((x) => <GoalCard key={x.id} goal={x} actions={actions} />)}</>}
    </div></div>
  </div>;
}

/* ---------- Check-ins ---------- */
export function ClientCheckins({ metrics }: { metrics: Metric[] }) {
  const c = useApi<{ items: Checkin[]; schedules: Schedule[] }>(() => api.get('/me/checkins'), []);
  const [answering, setAnswering] = useState<string | null>(null);
  const toast = useToast();
  if (c.error) return <Alert kind="error">{c.error}</Alert>;
  if (!c.data) return <Skeleton rows={6} />;
  const waiting = c.data.items.filter((x) => x.status === 'requested');
  const past = c.data.items.filter((x) => x.status !== 'requested');
  return <div className="stack">
    {c.data.schedules.length ? c.data.schedules.map((s) => <Alert key={s.id} kind="info" title="Weekly check-in"><ScheduleLine s={s} /></Alert>) : null}
    {waiting.map((x) => <Card key={x.id} accent>
      <CardHead eyebrow={`Due ${fmtDate(`${x.dueDate}T06:30:00Z`)} · from ${x.coachName}`} title={x.title} right={<CheckinPill status={x.status} />} />
      {answering === x.id ? <AnswerForm questions={x.questions} metrics={metrics} onSubmit={async (answers) => { await api.post(`/me/checkins/${x.id}/submit`, { answers }); toast('Sent to your coach'); setAnswering(null); c.reload(); }} />
        : <div className="row"><span className="small">{x.questions.length} short question{x.questions.length === 1 ? '' : 's'}. Answers tied to a measure are also logged as self-reported values.</span><Button variant="primary" size="sm" onClick={() => setAnswering(x.id)}>Answer</Button></div>}
    </Card>)}
    {past.length ? past.map((x) => <Card key={x.id} dense>
      <CardHead eyebrow={`Due ${fmtDate(`${x.dueDate}T06:30:00Z`)}${x.submittedAt ? ` · sent ${relative(x.submittedAt)}` : ''}`} title={x.title} right={<CheckinPill status={x.status} />} />
      {x.status === 'missed' ? <p className="muted">Closed when the next check-in fell due.</p> : <AnswersView questions={x.questions} answers={x.answers} />}
      {x.status === 'reviewed' && <div className="bp-tile" style={{ marginTop: 10 }}><span className="bp-eyebrow">{x.reviewedByName ?? x.coachName} · {fmtDate(x.reviewedAt)}</span><p style={{ margin: '4px 0 0' }}>{x.response ?? 'Read by your coach.'}</p></div>}
    </Card>) : !waiting.length && <Card><Empty title="No check-ins yet" body="Your coach can ask for one, or set a weekly check-in." /></Card>}
  </div>;
}

/* ---------- Photos ---------- */
type PhotosData = {
  items: Array<{ id: string; fileId: string; pose: string; takenAt: string; sharedWithCoach: boolean }>;
  consent: { granted: boolean; version: string | null; at: string | null; wording: { version: string; status: string; label: string; text: string }; canGrant: boolean; missing: string | null };
  healthShared: boolean; retentionDays: number | null; maxBytes: number; types: string[]; photosEnabled: boolean;
};
const POSES = ['front', 'side', 'back', 'other'] as const;

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, '')); r.onerror = () => reject(new Error('The file could not be read')); r.readAsDataURL(file); });
}

export function ClientPhotos() {
  const p = useApi<PhotosData>(() => api.get('/me/progress/photos'), []);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [withdraw, setWithdraw] = useState(false);
  const [remove, setRemove] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pose, setPose] = useState<(typeof POSES)[number]>('front');
  const [taken, setTaken] = useState('');
  const [share, setShare] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const d = p.data;
  const grouped = useMemo(() => d?.items ?? [], [d]);
  if (p.error) return <Alert kind="error">{p.error}</Alert>;
  if (!d) return <Skeleton rows={6} />;
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(''); try { await fn(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); } };
  const agree = () => run(async () => { await api.post('/me/progress/photos/consent', { granted: true, version: d.consent.wording.version }); toast('Consent recorded'); p.reload(); });
  const upload = () => run(async () => {
    if (!file) return;
    if (file.size > d.maxBytes) throw new Error(`Photos are limited to ${Math.round(d.maxBytes / (1024 * 1024))} MB`);
    await api.post('/me/progress/photos', { dataBase64: await readBase64(file), filename: file.name, pose, shareWithCoach: share, ...(taken ? { takenAt: new Date(`${taken}T12:00:00+05:30`).toISOString() } : {}) });
    toast('Photo added'); setFile(null); setTaken(''); setShare(false); if (input.current) input.current.value = ''; p.reload();
  });
  return <div className="stack">
    {!d.photosEnabled && <Alert kind="info" title="Progress photos are switched off">Your existing photos stay listed below; you can delete any of them.</Alert>}
    <div className="bp-consent">
      <h4>Progress photo consent</h4>
      <span className="bp-pill bp-pill-warning pillWrap">{d.consent.wording.label}</span>
      <p style={{ marginTop: 8 }}>{d.consent.wording.text}</p>
      {d.consent.granted ? <div className="bp-btngroup"><Pill status="active">Agreed {fmtDate(d.consent.at)}</Pill><Button size="sm" variant="tertiary" onClick={() => setWithdraw(true)}>Withdraw</Button></div>
        : d.consent.canGrant ? <div className="bp-btngroup"><Button variant="primary" size="sm" busy={busy} disabled={!d.photosEnabled} onClick={agree}>I agree</Button></div>
        : <Alert kind="warning" title="Not available yet">Pending configuration. Missing: {d.consent.missing}</Alert>}
    </div>
    {d.consent.granted && d.photosEnabled && <Card>
      <CardHead eyebrow="Add" title="A progress photo" />
      <div className="grid">
        <div className="span6"><label className="bp-upload" style={{ position: 'relative' }}>
          <b>{file ? file.name : 'Choose a photo'}</b><small>{d.types.join(', ')} · up to {Math.round(d.maxBytes / (1024 * 1024))} MB · checked by content</small>
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label></div>
        <div className="span6"><div className="form">
          <Field label="Pose"><Select value={pose} onChange={(e) => setPose(e.target.value as (typeof POSES)[number])}>{POSES.map((x) => <option key={x} value={x}>{label(x)}</option>)}</Select></Field>
          <Field label="Taken on" optional hint="Empty: today."><Input type="date" value={taken} onChange={(e) => setTaken(e.target.value)} /></Field>
          <label className="bp-check"><input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} /> Share this photo with my coach</label>
          <Button variant="primary" busy={busy} disabled={!file} onClick={upload}>Add the photo</Button>
        </div></div>
      </div>
    </Card>}
    {err && <Alert kind="error">{err}</Alert>}
    {grouped.length ? <div className="weekGrid">{grouped.map((x) => <div key={x.id} className="bp-tile stack" style={{ gap: 8 }}>
      <PrivateImage fileId={x.fileId} alt={`${label(x.pose)} progress photo, ${fmtDate(x.takenAt)}`} />
      <div className="row between"><span className="small">{label(x.pose)} · {fmtDate(x.takenAt)}</span><Pill status={x.sharedWithCoach ? 'active' : 'paused'}>{x.sharedWithCoach ? 'Shared' : 'Private'}</Pill></div>
      <div className="row between">
        <label className="bp-switch"><input type="checkbox" role="switch" checked={x.sharedWithCoach} disabled={busy || (!x.sharedWithCoach && (!d.consent.granted || !d.photosEnabled))} onChange={() => run(async () => { await api.patch(`/me/progress/photos/${x.id}`, { shareWithCoach: !x.sharedWithCoach }); p.reload(); })} aria-label={`Share the ${x.pose} photo of ${fmtDate(x.takenAt)} with my coach`} /><span className="bp-switch-track" /> <span className="small">Coach</span></label>
        <Button size="sm" variant="tertiary" onClick={() => setRemove(x.id)}>Delete</Button>
      </div>
    </div>)}</div> : <Card><Empty title="No photos" body={d.consent.granted ? 'Add one above. Photos stay private unless you share one.' : 'Agree to the consent above to add photos.'} /></Card>}
    <p className="muted">Photos are stored privately and open through links that expire after five minutes. Administrators never see them. Your coach sees a photo only if you share it, and only while you share health records with your coach ({d.healthShared ? 'on' : 'off'} now). {d.retentionDays ? `Photos are deleted ${d.retentionDays} days after you add them.` : 'Photos stay until you delete them.'}</p>
    <ConfirmDialog open={withdraw} onClose={() => setWithdraw(false)} title="Withdraw the photo consent?" body="Your coach loses access to every photo at once and each photo stops being shared. Your photos stay with you until you delete them." confirmLabel="Withdraw" danger onConfirm={async () => { await api.post('/me/progress/photos/consent', { granted: false }); toast('Consent withdrawn'); p.reload(); }} />
    <ConfirmDialog open={!!remove} onClose={() => setRemove(null)} title="Delete this photo?" body="It is removed from storage at once and cannot be recovered." confirmLabel="Delete" danger onConfirm={async () => { await api.del(`/me/progress/photos/${remove}`); toast('Photo deleted'); p.reload(); }} />
  </div>;
}
