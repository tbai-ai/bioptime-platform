/* The member's report page (pages/client/ClientReport.tsx), while the labFollowups flag is on:
   - "Next steps": what the coach or the Bioptime team set after reviewing this report (GET /me/lab-follow-ups);
   - "Marker trend": one marker across the member's released reports (GET /me/reports/markers/:key), the values and
     ranges exactly as the laboratory reported them, drawn with the existing Spark chart. No interpretation is added. */
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { Alert, Card, CardHead, Field, Select, Skeleton, Spark, Table, useApi } from '../../ui';
import { FollowUpLine, useLabFlag, type FollowUp } from './shared';

export function ClientReportNextSteps({ reportId }: { reportId: string }) {
  const on = useLabFlag();
  if (!on) return null;
  return <NextSteps reportId={reportId} />;
}

function NextSteps({ reportId }: { reportId: string }) {
  const list = useApi(() => api.get<{ items: FollowUp[] }>(`/me/lab-follow-ups?reportId=${encodeURIComponent(reportId)}`), [reportId]);
  const items = list.data?.items ?? [];
  return <Card>
    <CardHead eyebrow="Follow-up" title="Next steps" />
    {list.error ? <Alert kind="error">{list.error}</Alert> : !list.data ? <Skeleton rows={2} />
      : items.length ? <ul className="taskList">{items.map((f) => <FollowUpLine key={f.id} f={f} member />)}</ul>
        : <p className="small">No next steps on this report. If your coach or the Bioptime team sets one, it appears here and in your notifications.</p>}
  </Card>;
}

type ReportValue = { marker_key: string | null; label: string; value: string; units: string | null; range_low: number | null; range_high: number | null; flag: string | null };
type TrendPoint = { value: string; units: string | null; range_low: number | null; range_high: number | null; flag: string | null; at: string; report_id: string };

export function ClientMarkerTrends({ values }: { values: ReportValue[] | undefined }) {
  const on = useLabFlag();
  const markers = (values ?? []).filter((v) => v.marker_key);
  if (!on || !markers.length) return null;
  return <Trends markers={markers} />;
}

function Trends({ markers }: { markers: ReportValue[] }) {
  const first = markers.find((m) => m.flag) ?? markers[0]!;
  const [key, setKey] = useState(first.marker_key!);
  const trend = useApi(() => api.get<{ marker: string; items: TrendPoint[] }>(`/me/reports/markers/${encodeURIComponent(key)}`), [key]);
  const points = trend.data?.items ?? [];
  const numeric = points.map((p) => Number(p.value)).filter((n) => Number.isFinite(n));
  const last = points[points.length - 1];
  const band: [number, number] | undefined = last && last.range_low !== null && last.range_high !== null ? [last.range_low, last.range_high] : undefined;
  const name = markers.find((m) => m.marker_key === key)?.label ?? key;
  const chart = numeric.length === points.length && numeric.length > 1;
  const range = (p: TrendPoint) => (p.range_low !== null && p.range_high !== null ? `${p.range_low}–${p.range_high}` : p.range_low !== null ? `≥ ${p.range_low}` : p.range_high !== null ? `≤ ${p.range_high}` : '—');
  return <Card style={{ marginTop: 14 }}>
    <CardHead eyebrow="Over time" title="Marker trend" right={chart ? <Spark points={numeric} band={band} /> : undefined} />
    <div className="stack">
      <Field label="Marker"><Select value={key} onChange={(e) => setKey(e.target.value)}>{markers.map((m) => <option key={m.marker_key!} value={m.marker_key!}>{m.label}</option>)}</Select></Field>
      {trend.error ? <Alert kind="error">{trend.error}</Alert> : !trend.data ? <Skeleton rows={3} />
        : <Table dense label={`${name} across your released reports`} head={<><th>Collected</th><th className="num">Value</th><th>Laboratory range</th><th>Flag</th></>}>
          {points.map((p) => <tr key={p.report_id}><td>{fmtDate(p.at)}</td><td className="num">{p.value} <span className="muted">{p.units ?? ''}</span></td><td className="small">{range(p)}</td><td>{p.flag ? <span className="bp-pill bp-pill-warning">outside range ({p.flag})</span> : <span className="muted">in range</span>}</td></tr>)}
        </Table>}
      <p className="muted small">{points.length > 1 ? 'Each value and range as the laboratory reported it on that date; laboratories can change their ranges.' : 'One result so far. The trend fills in as later reports are released.'}{chart && band ? ' The shaded band on the chart is the latest laboratory range.' : ''}</p>
    </div>
  </Card>;
}
