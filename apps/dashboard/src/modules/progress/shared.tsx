/* M2 Progress in the portal: the pieces the member, coach and admin views share. Everything is drawn with the existing
   components (src/ui) and the design system's classes (bp-chart, bp-seg, bp-chips, bp-legend, bp-progress, bp-tile,
   bp-provenance, bp-consent); no new CSS. Every chart point keeps its source label, and nothing here computes a score,
   a prediction or a recommended target: the chart draws logged values, and a goal shows its own start and target. */
import React, { useEffect, useMemo, useState } from 'react';
import { api, qs } from '../../lib/api';
import { addDaysIst, fmtDate, fmtDateTime, label, todayIst } from '../../lib/format';
import { Alert, Button, Card, CardHead, Empty, Field, Input, Pill, Select, Skeleton, Table, Textarea, errorText, useApi } from '../../ui';

/* ---------- shapes the API returns ---------- */
export type Metric = { metric: string; label: string; unit: string; min: number | null; max: number | null };
export type Point = { at: string; value: number; source: string; sourceLabel: string };
export type Series = { metric: string; label: string; unit: string; from: string; to: string; points: Point[]; truncated: boolean; note: string };
/** `reached` says whether a milestone is reached; achievedAt is null for a reached one whose date is withheld (a coach
 *  while the member does not share health records). */
export type Milestone = { id: string; title: string; targetValue?: number | null; dueDate: string | null; reached?: boolean; achievedAt: string | null };
export type Goal = {
  id: string; title: string; metric: string | null; metricLabel: string | null; unit: string | null; baselineValue?: number | null; targetValue?: number | null;
  latest?: { value: number; at: string; source: string; sourceLabel: string } | null; valuesWithheld: boolean; targetDate: string | null;
  status: 'active' | 'achieved' | 'paused' | 'dropped'; createdByRole: 'member' | 'coach'; achievedAt: string | null; achievedHow: 'target_reached' | 'marked' | null;
  /** True when the goal is achieved but how and when stay hidden with its values (a coach without health sharing). */
  achievementWithheld?: boolean;
  autoAchieve: boolean; milestones: Milestone[]; createdAt: string;
};
export type Question = { key: string; label: string; type: 'scale_1_5' | 'number' | 'text' | 'yes_no'; metric?: string };
export type Answer = number | string | boolean;
export type Checkin = {
  id: string; memberId: string; coachName: string; title: string; questions: Question[]; dueDate: string; status: 'requested' | 'submitted' | 'reviewed' | 'missed';
  answers?: Record<string, Answer> | null; answersWithheld: boolean; submittedAt: string | null; reviewedAt: string | null; reviewedByName: string | null; response: string | null; scheduleId: string | null;
  notes?: Array<{ id: string; body: string; authorName: string; createdAt: string }>;
};
export type Schedule = { id: string; coachName: string; templateId: string; templateTitle: string; weekday: number; weekdayLabel: string; active: boolean; createdAt: string; endedAt: string | null };
export type Template = { id: string; title: string; description: string; questions: Question[]; scope: 'library' | 'coach'; status: 'draft' | 'published' | 'archived'; createdByName: string; updatedAt: string; publishedAt: string | null };
export type AdherenceLine = { key: string; label: string; due: number; done: number; pct: number | null; note?: string };

export const QUESTION_TYPE_LABELS: Record<Question['type'], string> = { scale_1_5: '1 to 5', number: 'Number', text: 'Free text', yes_no: 'Yes or no' };
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/* ---------- status pills (existing pill colours, own words) ---------- */
const GOAL_PILL: Record<Goal['status'], [string, string]> = { active: ['active', 'Active'], achieved: ['completed', 'Achieved'], paused: ['paused', 'Paused'], dropped: ['cancelled', 'Dropped'] };
export function GoalPill({ status }: { status: Goal['status'] }) { const [s, text] = GOAL_PILL[status]; return <Pill status={s}>{text}</Pill>; }
const CHECKIN_PILL: Record<Checkin['status'], [string, string]> = { requested: ['requested', 'Waiting for answers'], submitted: ['in_progress', 'Sent, not reviewed'], reviewed: ['completed', 'Reviewed'], missed: ['expired', 'Missed'] };
export function CheckinPill({ status }: { status: Checkin['status'] }) { const [s, text] = CHECKIN_PILL[status]; return <Pill status={s}>{text}</Pill>; }

/* ---------- a date range ---------- */
export const RANGES = [{ id: '30', label: '30 days', days: 30 }, { id: '90', label: '90 days', days: 90 }, { id: '182', label: '6 months', days: 182 }, { id: '365', label: '1 year', days: 365 }] as const;
export type Range = { from: string; to: string; preset: string | null };

export function useRange(initialDays = 90) {
  const [range, setRange] = useState<Range>({ from: addDaysIst(-(initialDays - 1)), to: todayIst(), preset: String(initialDays) });
  const choose = (days: number) => setRange({ from: addDaysIst(-(days - 1)), to: todayIst(), preset: String(days) });
  const custom = (from: string, to: string) => setRange({ from, to, preset: null });
  return { range, choose, custom };
}

export function RangePicker({ range, choose, custom }: ReturnType<typeof useRange>) {
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  useEffect(() => { setFrom(range.from); setTo(range.to); }, [range.from, range.to]);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
  return <div className="row">
    <div className="bp-seg" role="group" aria-label="Range">{RANGES.map((r) => <button key={r.id} type="button" aria-pressed={range.preset === r.id} onClick={() => choose(r.days)}>{r.label}</button>)}</div>
    <label className="sr" htmlFor="pg-from">From</label><Input id="pg-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} style={{ width: 'auto' }} />
    <label className="sr" htmlFor="pg-to">To</label><Input id="pg-to" type="date" value={to} min={from} max={todayIst()} onChange={(e) => setTo(e.target.value)} style={{ width: 'auto' }} />
    <Button size="sm" disabled={!valid || (from === range.from && to === range.to)} onClick={() => custom(from, to)}>Show</Button>
  </div>;
}

export function MetricPicker({ metrics, value, onChange }: { metrics: Metric[]; value: string; onChange: (m: string) => void }) {
  return <div className="bp-chips" role="group" aria-label="Metric">{metrics.map((m) => <button key={m.metric} type="button" className="bp-chip" aria-pressed={m.metric === value} onClick={() => onChange(m.metric)}>{m.label}</button>)}</div>;
}

/* ---------- the range chart ---------- */
/** Marks per source, so every point says where it came from; the legend and the table below repeat it in words. */
const SOURCE_MARK: Record<string, { cls: string; color: string; shape: 'circle' | 'square' | 'diamond' }> = {
  member: { cls: 'bar1', color: 'var(--bp-color-chart-series1)', shape: 'circle' },
  coach: { cls: 'bar2', color: 'var(--bp-color-chart-series2)', shape: 'square' },
  device: { cls: 'bar4', color: 'var(--bp-color-chart-series4)', shape: 'diamond' },
  import: { cls: 'pt', color: 'var(--bp-color-text-primary)', shape: 'circle' },
};
const markOf = (source: string) => SOURCE_MARK[source] ?? SOURCE_MARK.import!;
const round = (v: number) => Math.round(v * 10) / 10;

function Mark({ x, y, source, title }: { x: number; y: number; source: string; title: string }) {
  const m = markOf(source);
  if (m.shape === 'square') return <rect className={m.cls} x={x - 3.5} y={y - 3.5} width={7} height={7}><title>{title}</title></rect>;
  if (m.shape === 'diamond') return <polygon className={m.cls} points={`${x},${y - 4.5} ${x + 4.5},${y} ${x},${y + 4.5} ${x - 4.5},${y}`}><title>{title}</title></polygon>;
  return <circle className={m.cls} cx={x} cy={y} r={3.5}><title>{title}</title></circle>;
}

export function RangeChart({ series, target }: { series: Series; target?: number | null }) {
  const pts = series.points;
  if (!pts.length) return <Empty title="No values in this range" body="Choose a longer range, or log a value." />;
  const w = 640, h = 220, padL = 46, padR = 14, padT = 14, padB = 26;
  const t0 = Date.parse(`${series.from}T00:00:00+05:30`), t1 = Date.parse(`${series.to}T23:59:59+05:30`);
  const vals = pts.map((p) => p.value).concat(target !== undefined && target !== null ? [target] : []);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
  const x = (iso: string) => padL + ((Date.parse(iso) - t0) / Math.max(1, t1 - t0)) * (w - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (h - padT - padB);
  const ticks = [0, 1 / 3, 2 / 3, 1].map((f) => lo + f * (hi - lo));
  const last = pts[pts.length - 1]!;
  const aria = `${series.label}: ${pts.length} value${pts.length === 1 ? '' : 's'} from ${fmtDate(pts[0]!.at)} to ${fmtDate(last.at)}; latest ${last.value} ${series.unit} (${last.sourceLabel})${target !== undefined && target !== null ? `; target ${target} ${series.unit}` : ''}.`;
  return <svg className="bp-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={aria}>
    {ticks.map((v) => <g key={v}><line className="grid" x1={padL} x2={w - padR} y1={y(v)} y2={y(v)} /><text className="axis" x={0} y={y(v) + 3}>{round(v)}</text></g>)}
    {target !== undefined && target !== null && <g><line className="ref" x1={padL} x2={w - padR} y1={y(target)} y2={y(target)} /><text className="axis" x={w - padR - 64} y={y(target) - 4}>Target {target}</text></g>}
    {pts.length > 1 && <polyline className="s1" points={pts.map((p) => `${x(p.at)},${y(p.value)}`).join(' ')} />}
    {pts.map((p, i) => <Mark key={`${p.at}-${i}`} x={x(p.at)} y={y(p.value)} source={p.source} title={`${fmtDateTime(p.at)} · ${p.value} ${series.unit} · ${p.sourceLabel}`} />)}
    <text className="axis" x={padL} y={h - 6}>{fmtDate(`${series.from}T06:30:00Z`)}</text>
    <text className="axis" x={w - padR - 70} y={h - 6}>{fmtDate(`${series.to}T06:30:00Z`)}</text>
  </svg>;
}

export function SourceLegend({ points }: { points: Point[] }) {
  const seen = [...new Map(points.map((p) => [p.source, p.sourceLabel])).entries()];
  if (!seen.length) return null;
  return <div className="bp-legend" aria-label="Where the values came from">{seen.map(([source, text]) => <span key={source}><i style={{ background: markOf(source).color }} />{text}</span>)}</div>;
}

/** One metric over the range: the chart, its legend, and every value with its source in a table on request. */
export function SeriesCard({ path, metric, range, target }: { path: string; metric: string; range: Range; target?: number | null }) {
  const s = useApi<Series>(() => api.get(`${path}${qs({ metric, from: range.from, to: range.to })}`), [path, metric, range.from, range.to]);
  const [table, setTable] = useState(false);
  if (s.error) return <Card><Alert kind="error">{s.error}</Alert></Card>;
  if (!s.data) return <Card><Skeleton rows={5} /></Card>;
  const d = s.data;
  return <Card>
    <CardHead eyebrow={`${fmtDate(`${d.from}T06:30:00Z`)} to ${fmtDate(`${d.to}T06:30:00Z`)}`} title={`${d.label}${d.unit ? ` (${d.unit})` : ''}`} right={<span className="small num">{d.points.length} value{d.points.length === 1 ? '' : 's'}</span>} />
    <RangeChart series={d} target={target} />
    <div className="row between" style={{ marginTop: 10 }}><SourceLegend points={d.points} />{d.points.length > 0 && <Button variant="tertiary" size="sm" aria-expanded={table} onClick={() => setTable((t) => !t)}>{table ? 'Hide the values' : 'Show every value'}</Button>}</div>
    {table && <div style={{ marginTop: 10 }}><Table dense label={`${d.label} values`} head={<><th>When</th><th className="num">Value</th><th>Source</th></>}>{d.points.slice().reverse().map((p, i) => <tr key={`${p.at}-${i}`}><td>{fmtDateTime(p.at)}</td><td className="num">{p.value} {d.unit}</td><td>{p.sourceLabel}</td></tr>)}</Table></div>}
    {d.truncated && <p className="muted" style={{ marginTop: 6 }}>Only the first 2,000 values in this range are drawn; choose a shorter range to see the rest.</p>}
    <p className="bp-provenance" style={{ marginTop: 8 }}>{d.note}</p>
  </Card>;
}

/** What was due and done in the range, one line per provider; never combined into a score. */
export function AdherenceCard({ path, range }: { path: string; range: Range }) {
  const a = useApi<{ items: AdherenceLine[]; note: string; from: string; to: string }>(() => api.get(`${path}${qs({ from: range.from, to: range.to })}`), [path, range.from, range.to]);
  if (a.error) return <Card><CardHead eyebrow="Adherence" title="Due and done" /><Alert kind={/RANGE_TOO_LONG|at most/.test(a.error) ? 'warning' : 'error'}>{a.error}</Alert></Card>;
  if (!a.data) return <Card><Skeleton rows={3} /></Card>;
  return <Card>
    <CardHead eyebrow="Adherence" title="Due and done" />
    {a.data.items.length ? <div className="stack">{a.data.items.map((i) => <div key={i.key}>
      <div className="row between"><b style={{ color: 'var(--bp-color-text-primary)' }}>{i.label}</b><span className="small num">{i.pct === null ? 'Nothing was due' : `${i.done} of ${i.due} · ${i.pct}%`}</span></div>
      {i.pct !== null && <div className="bp-progress" role="progressbar" aria-label={i.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={i.pct} style={{ marginTop: 6 }}><span style={{ width: `${i.pct}%` }} /></div>}
      {i.note && <span className="muted">{i.note}</span>}
    </div>)}</div> : <Empty title="Nothing to count yet" body="Plan actions, habits, meals and workouts appear here when they are part of the programme." />}
    <p className="muted" style={{ marginTop: 10 }}>{a.data.note}</p>
  </Card>;
}

/* ---------- private photos: a 5-minute token per opening ---------- */
export function PrivateImage({ fileId, alt, auto = true }: { fileId: string; alt: string; auto?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const open = async () => { setBusy(true); setErr(''); try { const t = await api.post<{ url: string }>(`/files/${fileId}/token`); setUrl(t.url); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); } };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setUrl(null); if (auto) void open(); }, [fileId, auto]);
  if (err) return <Alert kind="warning">{err}</Alert>;
  if (!url) return auto ? <span className="bp-skel" style={{ display: 'block', width: '100%', aspectRatio: '3 / 4' }} aria-label="Loading the photo" /> : <Button size="sm" busy={busy} onClick={open}>Open photo</Button>;
  return <img src={url} alt={alt} onError={() => setErr('The link expired. Open the photo again.')} style={{ display: 'block', width: '100%', aspectRatio: '3 / 4', objectFit: 'cover', borderRadius: 'var(--bp-radius-md)' }} />;
}

/* ---------- goals ---------- */
/** How far a measurable goal has moved from its start towards its target, from the member's own latest value. */
function movedPct(g: Goal): number | null {
  if (g.baselineValue === undefined || g.baselineValue === null || g.targetValue === undefined || g.targetValue === null || !g.latest || g.targetValue === g.baselineValue) return null;
  return Math.max(0, Math.min(100, Math.round(((g.latest.value - g.baselineValue) / (g.targetValue - g.baselineValue)) * 100)));
}

export type GoalActions = {
  /** The person viewing: the member or the coach. Full edits (adding milestones included) only on goals they set;
   *  the goal's status and its milestones' status always (the server enforces the same). */
  role: 'member' | 'coach';
  readOnly?: boolean;
  onStatus?: (g: Goal, status: Goal['status']) => Promise<void>;
  onMilestone?: (g: Goal, m: Milestone, achieved: boolean) => Promise<void>;
  onAddMilestone?: (g: Goal, input: { title: string; targetValue: number | null; dueDate: string | null }) => Promise<void>;
};

/** How an achieved goal reads: reached by a logged value, marked by a person, or (a coach while the member does not
 *  share health records) simply achieved, with how and when hidden like the values. */
function achievedText(g: Goal): string {
  if (g.achievedHow === 'target_reached') return `Reached ${fmtDate(g.achievedAt)}: a logged value met the target.`;
  if (g.achievedHow === 'marked') return `Marked achieved ${fmtDate(g.achievedAt)}.`;
  if (g.achievementWithheld) return 'Achieved. How and when stay hidden with the values.';
  return g.achievedAt ? `Achieved ${fmtDate(g.achievedAt)}.` : 'Achieved.';
}

export function GoalCard({ goal: g, actions }: { goal: Goal; actions: GoalActions }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);
  const [msTitle, setMsTitle] = useState('');
  const [msValue, setMsValue] = useState('');
  const [msDate, setMsDate] = useState('');
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(''); try { await fn(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); } };
  const pct = movedPct(g);
  const unit = g.unit ? ` ${g.unit}` : '';
  const measurable = g.metric !== null || g.unit !== null;
  const statusButtons: Array<[Goal['status'], string]> = g.status === 'active' ? [['achieved', 'Mark achieved'], ['paused', 'Pause'], ['dropped', 'Drop']] : g.status === 'paused' ? [['active', 'Resume'], ['dropped', 'Drop']] : [['active', 'Set active again']];
  return <Card dense>
    <CardHead eyebrow={g.metricLabel ?? (g.createdByRole === 'coach' ? 'Set by the coach' : 'Goal')} title={g.title} right={<GoalPill status={g.status} />} />
    {g.valuesWithheld ? <p className="muted">Values are hidden while the member does not share health records with their coach.</p> : (g.baselineValue !== undefined && (g.baselineValue !== null || g.targetValue !== null)) && <dl className="bp-kv">
      {g.baselineValue !== null && g.baselineValue !== undefined && <><dt>Start</dt><dd className="num">{g.baselineValue}{unit}</dd></>}
      {g.latest && <><dt>Latest</dt><dd className="num">{g.latest.value}{unit} <span className="small">· {g.latest.sourceLabel} · {fmtDate(g.latest.at)}</span></dd></>}
      {g.targetValue !== null && g.targetValue !== undefined && <><dt>Target</dt><dd className="num">{g.targetValue}{unit}</dd></>}
    </dl>}
    {pct !== null && g.status !== 'achieved' && <div className="bp-progress bp-progress-accent" role="progressbar" aria-label="From start to target" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} style={{ marginTop: 8 }}><span style={{ width: `${pct}%` }} /></div>}
    <p className="small" style={{ marginTop: 8 }}>
      {g.targetDate ? `By ${fmtDate(`${g.targetDate}T06:30:00Z`)}. ` : ''}
      {g.status === 'achieved' ? achievedText(g) : g.autoAchieve ? 'Marked achieved automatically when a value logged after it was set reaches the target.' : 'Marked achieved by a person.'}
    </p>
    {g.milestones.length > 0 && <ul className="timeline" style={{ marginTop: 10 }}>{g.milestones.map((m) => { const reached = m.reached ?? !!m.achievedAt; return <li key={m.id} className={reached ? 'done' : ''}>
      <b>{m.title}</b>{m.targetValue !== undefined && m.targetValue !== null ? ` · ${m.targetValue}${unit}` : ''}{m.dueDate ? ` · by ${fmtDate(`${m.dueDate}T06:30:00Z`)}` : ''}
      {!actions.readOnly && actions.onMilestone && (m.targetValue === null || m.targetValue === undefined || !g.autoAchieve) && <> <Button size="sm" variant="tertiary" busy={busy} onClick={() => run(() => actions.onMilestone!(g, m, !reached))}>{reached ? 'Not yet' : 'Mark reached'}</Button></>}
      <time>{m.achievedAt ? `Reached ${fmtDate(m.achievedAt)}` : reached ? 'Reached' : 'Not reached yet'}</time>
    </li>; })}</ul>}
    {!actions.readOnly && <div className="row" style={{ marginTop: 10 }}>
      {actions.onStatus && statusButtons.map(([s, text]) => <Button key={s} size="sm" variant={s === 'dropped' ? 'tertiary' : 'secondary'} busy={busy} onClick={() => run(() => actions.onStatus!(g, s))}>{text}</Button>)}
      {actions.onAddMilestone && g.createdByRole === actions.role && g.status !== 'dropped' && !adding && <Button size="sm" variant="tertiary" onClick={() => setAdding(true)}>Add a milestone</Button>}
    </div>}
    {adding && actions.onAddMilestone && <form className="form" style={{ marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); void run(async () => { await actions.onAddMilestone!(g, { title: msTitle.trim(), targetValue: msValue.trim() === '' ? null : Number(msValue), dueDate: msDate || null }); setAdding(false); setMsTitle(''); setMsValue(''); setMsDate(''); }); }}>
      <Field label="Milestone"><Input value={msTitle} onChange={(e) => setMsTitle(e.target.value)} maxLength={160} required /></Field>
      <div className="row">
        {measurable && !g.valuesWithheld && <Field label={`Value${unit ? ` (${unit.trim()})` : ''}`} optional><Input inputMode="decimal" value={msValue} onChange={(e) => setMsValue(e.target.value)} /></Field>}
        <Field label="By" optional><Input type="date" value={msDate} onChange={(e) => setMsDate(e.target.value)} /></Field>
      </div>
      <div className="row"><Button variant="primary" size="sm" type="submit" busy={busy} disabled={msTitle.trim().length < 2 || (msValue.trim() !== '' && Number.isNaN(Number(msValue)))}>Add</Button><Button size="sm" variant="tertiary" onClick={() => setAdding(false)}>Cancel</Button></div>
    </form>}
    {err && <Alert kind="error">{err}</Alert>}
  </Card>;
}

/** Set a goal: a title, and optionally a metric with a start, a target and a date. */
export function GoalForm({ metrics, allowValues, onSave }: { metrics: Metric[]; allowValues: boolean; onSave: (input: Record<string, unknown>) => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [metric, setMetric] = useState('');
  const [start, setStart] = useState('');
  const [target, setTarget] = useState('');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const m = metrics.find((x) => x.metric === metric);
  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  const bad = (s: string) => s.trim() !== '' && Number.isNaN(Number(s));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await onSave({ title: title.trim(), ...(metric ? { metric, baselineValue: num(start), targetValue: num(target) } : {}), ...(date ? { targetDate: date } : {}) });
      setTitle(''); setMetric(''); setStart(''); setTarget(''); setDate('');
    } catch (ex) { setErr(errorText(ex)); } finally { setBusy(false); }
  };
  return <form className="form" onSubmit={save}>
    <Field label="Goal"><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="In your own words" required /></Field>
    {allowValues && <Field label="Measured by" optional hint="With a metric, a start and a target, the goal is marked achieved when a value logged later reaches the target."><Select value={metric} onChange={(e) => setMetric(e.target.value)}><option value="">Not measured</option>{metrics.map((x) => <option key={x.metric} value={x.metric}>{x.label} ({x.unit})</option>)}</Select></Field>}
    {m && <div className="row">
      <Field label={`Start (${m.unit})`} optional hint="Empty: the latest value logged."><Input inputMode="decimal" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
      <Field label={`Target (${m.unit})`} hint={m.min !== null && m.max !== null ? `Between ${m.min} and ${m.max}.` : undefined}><Input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
    </div>}
    <Field label="By" optional><Input type="date" value={date} min={todayIst()} onChange={(e) => setDate(e.target.value)} /></Field>
    <Button variant="primary" type="submit" busy={busy} disabled={title.trim().length < 2 || bad(start) || bad(target) || (!!m && target.trim() === '')}>Set the goal</Button>
    {err && <Alert kind="error">{err}</Alert>}
  </form>;
}

/* ---------- check-ins ---------- */
export function AnswersView({ questions, answers }: { questions: Question[]; answers: Record<string, Answer> | null | undefined }) {
  if (!answers) return null;
  return <dl className="answerList">{questions.map((q) => {
    const v = answers[q.key];
    return <React.Fragment key={q.key}><dt>{q.label}</dt><dd>{v === undefined ? <span className="muted">No answer</span> : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : q.type === 'scale_1_5' ? `${v} of 5` : String(v)}</dd></React.Fragment>;
  })}</dl>;
}

export function AnswerForm({ questions, metrics, onSubmit }: { questions: Question[]; metrics?: Metric[]; onSubmit: (answers: Record<string, Answer | null>) => Promise<void> }) {
  const [values, setValues] = useState<Record<string, Answer | ''>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const set = (k: string, v: Answer | '') => setValues((s) => ({ ...s, [k]: v }));
  const unitOf = (q: Question) => metrics?.find((m) => m.metric === q.metric)?.unit;
  const missing = questions.some((q) => q.type !== 'text' && (values[q.key] === undefined || values[q.key] === '' || (q.type === 'number' && Number.isNaN(Number(values[q.key])))));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(''); setFieldErr({});
    const answers: Record<string, Answer | null> = {};
    for (const q of questions) { const v = values[q.key]; answers[q.key] = v === undefined || v === '' ? null : q.type === 'number' ? Number(v) : v; }
    try { await onSubmit(answers); }
    catch (ex) {
      const details = (ex as { details?: unknown }).details;
      if (Array.isArray(details)) setFieldErr(Object.fromEntries(details.map((d: { path?: string; message?: string }) => [String(d.path ?? '').replace(/^answers\./, ''), d.message ?? 'Check this answer'])));
      setErr(errorText(ex));
    } finally { setBusy(false); }
  };
  return <form className="form" onSubmit={submit}>
    {questions.map((q) => <Field key={q.key} label={q.label} optional={q.type === 'text'} error={fieldErr[q.key]} hint={q.metric ? 'Also logged as a self-reported value.' : undefined}>
      {q.type === 'scale_1_5' ? <div className="bp-seg" role="group" aria-label={q.label} style={{ alignSelf: 'flex-start' }}>{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" aria-pressed={values[q.key] === n} onClick={() => set(q.key, n)}>{n}</button>)}</div>
        : q.type === 'yes_no' ? <div className="bp-seg" role="group" aria-label={q.label} style={{ alignSelf: 'flex-start' }}>{[[true, 'Yes'], [false, 'No']].map(([v, t]) => <button key={String(t)} type="button" aria-pressed={values[q.key] === v} onClick={() => set(q.key, v as boolean)}>{t as string}</button>)}</div>
        : q.type === 'number' ? <Input inputMode="decimal" value={String(values[q.key] ?? '')} onChange={(e) => set(q.key, e.target.value)} placeholder={unitOf(q) ?? ''} />
        : <Textarea value={String(values[q.key] ?? '')} onChange={(e) => set(q.key, e.target.value)} maxLength={2000} />}
    </Field>)}
    <Button variant="primary" type="submit" busy={busy} disabled={missing}>Send to my coach</Button>
    {err && <Alert kind="error">{err}</Alert>}
  </form>;
}

/** The questions of a template: key, wording, answer type and, for number and 1–5 questions, the metric it logs. */
export function QuestionsEditor({ value, onChange, metrics }: { value: Question[]; onChange: (q: Question[]) => void; metrics: Metric[] }) {
  const update = (i: number, patch: Partial<Question>) => onChange(value.map((q, k) => (k === i ? cleanQuestion({ ...q, ...patch }) : q)));
  const scaleMetrics = useMemo(() => metrics.filter((m) => m.metric.endsWith('_1_5') || (m.min !== null && m.max !== null && m.min >= 1 && m.max <= 5)), [metrics]);
  return <div className="stack">
    {value.map((q, i) => <div key={i} className="bp-tile">
      <div className="row">
        <Field label={`Question ${i + 1}`}><Input value={q.label} onChange={(e) => update(i, { label: e.target.value, key: q.key || keyFrom(e.target.value, value, i) })} maxLength={200} /></Field>
        <Field label="Key" hint="Lower-case, unique"><Input value={q.key} onChange={(e) => update(i, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40) })} style={{ maxWidth: 160 }} /></Field>
      </div>
      <div className="row">
        <Field label="Answer"><Select value={q.type} onChange={(e) => update(i, { type: e.target.value as Question['type'] })}>{Object.entries(QUESTION_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        {(q.type === 'number' || q.type === 'scale_1_5') && <Field label="Also logs" optional><Select value={q.metric ?? ''} onChange={(e) => update(i, { metric: e.target.value || undefined })}><option value="">Nothing</option>{(q.type === 'scale_1_5' ? scaleMetrics : metrics).map((m) => <option key={m.metric} value={m.metric}>{m.label} ({m.unit})</option>)}</Select></Field>}
        <Button size="sm" variant="tertiary" onClick={() => onChange(value.filter((_, k) => k !== i))} disabled={value.length <= 1}>Remove</Button>
      </div>
    </div>)}
    {value.length < 20 && <div><Button size="sm" onClick={() => onChange([...value, { key: '', label: '', type: 'text' }])}>Add a question</Button></div>}
  </div>;
}
function cleanQuestion(q: Question): Question { return q.type === 'number' || q.type === 'scale_1_5' ? q : { key: q.key, label: q.label, type: q.type }; }
function keyFrom(text: string, all: Question[], self: number): string {
  const base = text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[^a-z]+/, '').slice(0, 30) || 'q';
  let key = base.length >= 2 ? base : `${base}_q`, n = 2;
  while (all.some((q, k) => k !== self && q.key === key)) key = `${base}_${n++}`;
  return key;
}
export const questionsReady = (qs: Question[]) => qs.length > 0 && qs.every((q) => /^[a-z][a-z0-9_]{1,39}$/.test(q.key) && q.label.trim().length >= 3) && new Set(qs.map((q) => q.key)).size === qs.length;

export function ScheduleLine({ s }: { s: Schedule }) {
  return <span className="small">Every {s.weekdayLabel}: “{s.templateTitle}”, set by {s.coachName} on {fmtDate(s.createdAt)}.</span>;
}

export { label };
