import React from 'react';
import { useParams } from 'react-router-dom';
import { Link } from '../../lib/nav';
import { api } from '../../lib/api';
import { openLater } from '../../lib/ids';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { Alert, Button, Card, CardHead, Skeleton, Table, useApi, useToast, errorText } from '../../ui';
import { ClientMarkerTrends, ClientReportNextSteps } from '../../modules/labFollowups';

/** A released report: the laboratory's values, the review notes (the coach's, or the Bioptime team's) and the limits, in that order. */
export function ClientReport() {
  const { id = '' } = useParams();
  const r = useApi(() => api.get(`/reports/${id}`), [id]);
  const toast = useToast();
  const d = r.data as any;
  if (r.error) return <Alert kind="error">{r.error}</Alert>;
  if (!d) return <Skeleton rows={8} />;
  const range = (v: any) => v.matched_range ?? (v.range_low !== null && v.range_high !== null ? `${v.range_low}–${v.range_high}` : v.range_low !== null ? `≥ ${v.range_low}` : v.range_high !== null ? `≤ ${v.range_high}` : '—');
  const openFile = () => openLater(() => api.post<{ token: string }>(`/reports/${id}/file-token`).then((t) => `/api/reports/file?token=${encodeURIComponent(t.token)}`), (e) => toast(errorText(e), 'error'));
  return <div className="stack">
    <div className="pageHead"><div><Link className="muted" to="/bloodwork">← Bloodwork</Link><h1 style={{ marginTop: 4 }}>{d.test?.name}</h1><p className="sub">{d.reference} · collected {fmtDateTime(d.collectedAt)} · laboratory report {fmtDate(d.deliveredAt)}</p>{d.simulated && <p className="muted small">Practice laboratory: this result is simulated and no sample was collected.</p>}</div>
      <div className="actions">{d.flagged?.length ? <span className="bp-pill bp-pill-warning">{d.flagged.length} outside range</span> : d.valuesStatus === 'ready' && d.values?.length ? <span className="bp-pill bp-pill-success">All in range</span> : <span className="bp-pill">{d.valuesStatus === 'pending' ? 'Values pending' : d.hasFile ? 'See the laboratory PDF' : 'No values'}</span>}{d.hasFile && <Button size="sm" onClick={openFile}>Open the laboratory document</Button>}</div></div>
    <div className="grid">
      <div className="span8"><Card><CardHead eyebrow="Section 1" title="Results as reported by the laboratory" />
        {d.values?.length ? <Table head={<><th>Marker</th><th className="num">Value</th><th>Laboratory range</th><th>Flag</th></>}>{d.values.map((v: any, i: number) => <tr key={i}><td><b>{v.label}</b></td><td className="num" style={{ color: v.flag ? 'var(--bp-color-status-warning-text, var(--bp-color-accent-text))' : undefined }}>{v.value} <span className="muted">{v.units ?? ''}</span></td><td className="small">{range(v)}</td><td>{v.flag ? <span className="bp-pill bp-pill-warning">outside range ({v.flag})</span> : <span className="muted">in range</span>}</td></tr>)}</Table>
          : <p className="small">{d.valuesStatus === 'pending' ? 'Marker values have not arrived from the laboratory yet; the document is the record until they do.' : d.valuesStatus === 'failed' ? 'The laboratory could not extract values for this report; the document is still available.' : 'No values.'}</p>}
        <p className="muted small" style={{ marginTop: 10 }}>{d.provenance}</p></Card>
        <ClientMarkerTrends values={d.values} /></div>
      <div className="span4"><div className="stack">
        <Card><CardHead eyebrow="Section 2" title={d.reviewerKind === 'team' ? 'Review notes from the Bioptime team' : "Your coach's notes"} />{d.coachNote ? <><p>{d.coachNote}</p><p className="muted small">{d.reviewerName} · {fmtDate(d.reviewedAt)}</p></> : <p className="small">{d.reviewerKind === 'team' ? 'Awaiting the Bioptime team’s review.' : 'Awaiting your coach’s review.'}</p>}</Card>
        <ClientReportNextSteps reportId={id} />
        <Card><CardHead eyebrow="Section 3" title="Limits" /><p className="small">A single test is a snapshot. A result outside a range is not a diagnosis, and one inside does not rule a condition out. Bioptime is wellbeing guidance, not medical advice; medicines, supplements and further tests are a doctor's call.</p></Card>
      </div></div>
    </div>
    <p className="muted small">Reports stay in the portal and are never emailed. Opening the document uses a link that expires in five minutes.</p>
  </div>;
}
