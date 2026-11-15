import React, { useState } from 'react';
import { api, qs } from '../lib/api';
import { addDaysIst, fmtInr, label, todayIst } from '../lib/format';
import { Alert, Bars, Button, Card, CardHead, Field, Input, Readout, Select, Skeleton, Table, useApi, useToast, errorText } from '../ui';

export function Analytics() {
  const ov = useApi(() => api.get('/admin/overview'), []);
  const d = ov.data as any;
  if (ov.error) return <Alert kind="error">{ov.error}</Alert>;
  if (!d) return <Skeleton rows={6} />;
  const weeks = d.ordersByWeek as Array<{ week: string; n: number; inr: number }>;
  return <div className="stack">
    <div className="pageHead"><div><h1>Analytics</h1><p className="sub">Operational numbers from the live tables. Revenue counts signature-verified captures only. Self-reported progress is never presented as a health outcome.</p></div></div>
    <div className="grid">
      <div className="span3"><Card dense><Readout eyebrow="Members total" value={d.members.total} sub={`${d.members.active} active · ${d.members.onboarding} onboarding`} /></Card></div>
      <div className="span3"><Card dense><Readout eyebrow="New members · 30 d" value={d.members.new30d} /></Card></div>
      <div className="span3"><Card dense><Readout eyebrow="Verified revenue · all time" value={fmtInr(d.revenue.verifiedInrAll)} sub={`refunded ${fmtInr(d.revenue.refundedInr)}`} /></Card></div>
      <div className="span3"><Card dense><Readout eyebrow="Activated · 30 d" value={d.orders.activated30d} sub={`${d.orders.pendingPayment} pending payment`} /></Card></div>
      <div className="span8"><Card><CardHead eyebrow="12 weeks" title="Orders and verified revenue per week" /><Bars series={weeks.map((w) => Math.round(w.inr))} labels={weeks.map((w) => w.week.slice(5))} height={160} /><p className="muted">Bars: verified revenue (₹) per ISO week. Orders: {weeks.map((w) => `${w.week.slice(5)}:${w.n}`).join(' · ')}.{d.demo && d.revenue.note ? ` ${d.revenue.note}` : ''}</p></Card></div>
      <div className="span4"><Card><CardHead eyebrow="Programmes" title="Active and ending" /><dl className="kv"><dt>Active</dt><dd className="num">{d.programmes.active}</dd><dt>Ending in 7 days</dt><dd className="num">{d.programmes.endingIn7d}</dd><dt>Unassigned members</dt><dd className="num">{d.assignments.unassigned}</dd><dt>Coach utilisation</dt><dd className="num">{d.coaches.utilisationPct}%</dd><dt>Appointments · 7 d</dt><dd className="num">{d.appointments.upcoming7d}</dd><dt>Requested appointments</dt><dd className="num">{d.appointments.requested}</dd></dl></Card></div>
      <div className="span6"><Card><CardHead eyebrow="Bloodwork" title="Bookings by status" /><dl className="kv">{Object.entries(d.bloodwork).map(([k, v]) => <React.Fragment key={k}><dt>{label(k)}</dt><dd className="num">{v as number}</dd></React.Fragment>)}<dt>Reports awaiting review</dt><dd className="num">{d.reportsAwaitingReview}</dd></dl></Card></div>
      <div className="span6"><Card><CardHead eyebrow="Bespoke" title="Custom plans by status" /><dl className="kv">{Object.entries(d.customPlans).map(([k, v]) => <React.Fragment key={k}><dt>{label(k)}</dt><dd className="num">{v as number}</dd></React.Fragment>)}{!Object.keys(d.customPlans).length && <dd>None</dd>}<dt>New enquiries</dt><dd className="num">{d.enquiries.new}</dd></dl></Card></div>
    </div>
    <Reports />
    <p className="muted">Generated {d.generatedAt}. No health-outcome claims are derived from these numbers.</p>
  </div>;
}

/** Named reports over a date range, as a table here or a CSV download; every run is in the audit log. */
function Reports() {
  const names = useApi(() => api.get<{ items: string[] }>('/admin/analytics'), []);
  const toast = useToast();
  const [name, setName] = useState('');
  const [from, setFrom] = useState(addDaysIst(-90));
  const [to, setTo] = useState(todayIst());
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => { if (!name) return; setBusy(true); try { setData(await api.get(`/admin/analytics/${name}${qs({ from, to })}`)); } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); } };
  const csv = name ? `/api/admin/analytics/${name}.csv${qs({ from, to })}` : '';
  return <Card><CardHead eyebrow="Reports" title="Run a report" right={data ? <a className="bp-btn bp-btn-secondary bp-btn-sm" href={csv}>Download CSV</a> : undefined} />
    <div className="row" style={{ alignItems: 'flex-end' }}>
      <Field label="Report"><Select value={name} onChange={(e) => { setName(e.target.value); setData(null); }}><option value="">Choose</option>{(names.data?.items ?? []).map((n) => <option key={n} value={n}>{label(n)}</option>)}</Select></Field>
      <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
      <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      <Button variant="primary" busy={busy} disabled={!name} onClick={run} style={{ marginBottom: 2 }}>Run</Button>
    </div>
    {data && <div style={{ marginTop: 12 }}>
      <p className="small"><b>{data.title}</b> · {data.from} to {data.to} · {data.rows.length} row{data.rows.length === 1 ? '' : 's'}</p>
      <p className="muted small">{data.note}</p>
      {data.rows.length ? <div className="tableWrap"><Table head={<>{data.columns.map((c: string) => <th key={c}>{label(c)}</th>)}</>}>{data.rows.slice(0, 200).map((r: any, i: number) => <tr key={i}>{data.columns.map((c: string) => <td key={c} className={typeof r[c] === 'number' ? 'num' : 'small'}>{r[c] === null || r[c] === undefined ? '' : String(r[c])}</td>)}</tr>)}</Table></div> : <p className="small">No rows in that range.</p>}
      {data.rows.length > 200 && <p className="muted small">Showing the first 200 rows; the CSV has all {data.rows.length}.</p>}
    </div>}
  </Card>;
}
