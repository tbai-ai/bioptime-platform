import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { Alert, Button, Card, CardHead, Field, Input, Select, Skeleton, Spark, Tabs, useApi, useToast, errorText } from '../../ui';
import { useFeatures } from '../../modules/runtime';

// M2 Progress (src/modules/progress): its tabs load only while the module is on for this member
const ClientTrends = React.lazy(() => import('../../modules/progress/ClientProgress').then((m) => ({ default: m.ClientTrends })));
const ClientGoals = React.lazy(() => import('../../modules/progress/ClientProgress').then((m) => ({ default: m.ClientGoals })));
const ClientCheckins = React.lazy(() => import('../../modules/progress/ClientProgress').then((m) => ({ default: m.ClientCheckins })));
const ClientPhotos = React.lazy(() => import('../../modules/progress/ClientProgress').then((m) => ({ default: m.ClientPhotos })));
type ProgressTab = 'overview' | 'trends' | 'goals' | 'checkins' | 'photos';

/** Progress: completion of due tasks, one trend per metric, and a form to log a value. With the Progress module on, tabs
 *  add trends over a chosen range with adherence, goals, check-ins and (with the photo switch) progress photos. */
export function Progress() {
  const s = useApi(() => api.get('/me/progress/summary'), []);
  const toast = useToast();
  const [metric, setMetric] = useState('');
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const features = useFeatures(true);
  const [params, setParams] = useSearchParams();
  const d = s.data as any;
  if (s.error) return <Alert kind="error">{s.error}</Alert>;
  if (!d) return <Skeleton rows={6} />;
  const m = (d.metrics ?? []).find((x: any) => x.metric === metric);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!metric || value.trim() === '' || Number.isNaN(Number(value))) return;
    setBusy(true);
    try { await api.post('/me/progress', { metric, value: Number(value), note: note.trim() || undefined }); toast(`Saved ${value} ${m?.unit ?? ''} for ${m?.label}`); setValue(''); setNote(''); s.reload(); }
    catch (ex) { toast(errorText(ex), 'error'); } finally { setBusy(false); }
  };
  const overview = <div className="grid">
      <div className="span4"><Card><CardHead eyebrow="Log" title="Add a value" />
        <form className="form" onSubmit={save}>
          <Field label="What"><Select value={metric} onChange={(e) => setMetric(e.target.value)}><option value="">Choose a metric</option>{(d.metrics ?? []).map((x: any) => <option key={x.metric} value={x.metric}>{x.label} ({x.unit})</option>)}</Select></Field>
          <Field label={m ? `Value (${m.unit})` : 'Value'} hint={m && m.min !== null && m.max !== null ? `Between ${m.min} and ${m.max}.` : undefined}><Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} disabled={!m} /></Field>
          <Field label="Note" optional><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></Field>
          <Button variant="primary" type="submit" busy={busy} disabled={!metric || value.trim() === '' || Number.isNaN(Number(value))}>Save</Button>
          <p className="muted small">Never a laboratory measurement. Blood test results live under Bloodwork.</p>
        </form>
      </Card></div>
      <div className="span8"><div className="grid">{(d.metrics ?? []).map((x: any) => <div key={x.metric} className="span6"><Card dense><CardHead eyebrow={x.unit} title={x.label} right={<span className="small">{x.latest ? `${x.latest.value} ${x.unit} · ${fmtDate(x.latest.at)}` : 'no entries'}</span>} />{(x.series ?? []).length >= 2 ? <Spark points={(x.series as any[]).map((p) => Number(p.value))} band={x.min !== null && x.max !== null ? [x.min, x.max] : undefined} /> : <p className="muted small">Log two or more values to see a trend.</p>}</Card></div>)}</div>
        <p className="muted small" style={{ marginTop: 10 }}>{d.note}</p></div>
    </div>;
  const moduleOn = !!features?.has('progress');
  const tabs: Array<{ id: ProgressTab; label: string }> = moduleOn ? [{ id: 'overview', label: 'Overview' }, { id: 'trends', label: 'Trends' }, { id: 'goals', label: 'Goals' }, { id: 'checkins', label: 'Check-ins' }, ...(features?.has('progressPhotos') ? [{ id: 'photos' as const, label: 'Photos' }] : [])] : [];
  const asked = params.get('tab') as ProgressTab | null;
  const tab: ProgressTab = asked && tabs.some((t) => t.id === asked) ? asked : 'overview';
  const metrics = (d.metrics ?? []).map((x: any) => ({ metric: x.metric, label: x.label, unit: x.unit, min: x.min, max: x.max }));
  return <div className="stack">
    <div className="pageHead"><div><h1>Progress</h1><p className="sub">{d.programmeCompletion === null ? 'No plan tasks yet.' : `${d.programmeCompletion}% of due tasks done.`} Self-reported values, shown as what you logged to you, and to your coach while health sharing is on.</p></div></div>
    {moduleOn ? <Tabs items={tabs} value={tab} onChange={(t) => setParams(t === 'overview' ? {} : { tab: t }, { replace: true })} label="Progress">
      {tab === 'overview' ? overview : <Suspense fallback={<Skeleton rows={6} />}>
        {tab === 'trends' && <ClientTrends metrics={metrics} />}
        {tab === 'goals' && <ClientGoals metrics={metrics} />}
        {tab === 'checkins' && <ClientCheckins metrics={metrics} />}
        {tab === 'photos' && <ClientPhotos />}
      </Suspense>}
    </Tabs> : overview}
  </div>;
}
