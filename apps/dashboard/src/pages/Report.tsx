import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Link, useNavigate } from '../lib/nav';
import { api } from '../lib/api';
import { openLater } from '../lib/ids';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtDateTime } from '../lib/format';
import { Alert, Button, Card, CardHead, Field, Pill, Skeleton, Table, Textarea, useApi, useToast, errorText } from '../ui';
import { ReportNextSteps } from '../modules/labFollowups';

export function Report() {
  const { id = '' } = useParams();
  const { isCoach } = useAuth();
  const nav = useNavigate();
  const report = useApi(() => api.get(`/reports/${id}`), [id]);
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const r = report.data as any;
  if (report.error) return <Alert kind="error">{report.error}</Alert>;
  if (!r) return <Skeleton rows={8} />;
  const review = async () => { setBusy(true); try { await api.post(`/coach/reports/${id}/review`, { coachNote: note, flagged: r.flagged }); toast('Report reviewed and released to the member'); report.reload(); } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); } };
  const openFile = () => openLater(() => api.post<{ token: string }>(`/reports/${id}/file-token`).then((t) => `/api/reports/file?token=${encodeURIComponent(t.token)}`), (e) => toast(errorText(e), 'error'));
  return <div className="stack">
    <div className="pageHead"><div><Link className="muted" to={`/clients/${r.memberId}?tab=bloodwork`}>← Client</Link><h1 style={{ marginTop: 4 }}>{r.test?.name}</h1><p className="sub">{r.reference} · collected {fmtDateTime(r.collectedAt)} · laboratory report {fmtDate(r.deliveredAt)} · {r.reviewed ? `reviewed by ${r.reviewerName} on ${fmtDate(r.reviewedAt)}` : 'awaiting review'}</p>{r.simulated && <p className="muted small">Practice laboratory: this result is simulated and no sample was collected.</p>}</div><div className="actions"><Pill status={r.released ? 'completed' : 'pending'}>{r.released ? 'Released to member' : 'Not released'}</Pill><Button size="sm" onClick={openFile}>Open report document</Button></div></div>
    <div className="grid">
      <div className="span8"><Card><CardHead eyebrow="Section 1" title="Results as reported by the laboratory" />{r.values?.length ? <Table head={<><th>Marker</th><th className="num">Result</th><th>Unit</th><th>Laboratory range</th><th>Flag</th></>}>{r.values.map((v: any, i: number) => <tr key={i}><td>{v.label}{v.unmapped ? <div className="muted">not mapped to a Bioptime marker; kept as sent</div> : null}</td><td className="num">{v.value}</td><td>{v.units ?? ''}</td><td>{v.matched_range ?? (v.range_low !== null && v.range_high !== null ? `${v.range_low}–${v.range_high}` : v.range_low !== null ? `≥ ${v.range_low}` : v.range_high !== null ? `≤ ${v.range_high}` : '—')}</td><td>{v.flag ? <Pill status="pending">▲ Outside range ({v.flag})</Pill> : <span className="small">In range</span>}</td></tr>)}</Table> : <p className="small">{r.valuesStatus === 'pending' ? 'Marker values have not arrived from the laboratory yet; the PDF is the record until they do.' : r.valuesStatus === 'failed' ? 'The laboratory could not extract values for this report; the PDF stays available and the team has been alerted.' : 'No values.'}</p>}<p className="muted" style={{ marginTop: 8 }}>{r.provenance}</p></Card></div>
      <div className="span4"><Card><CardHead eyebrow="Section 2" title={r.reviewerKind === 'team' ? 'Review notes · Bioptime team' : 'Coach commentary'} />{r.reviewed ? <><p>{r.coachNote}</p><p className="muted" style={{ marginTop: 8 }}>Released {fmtDateTime(r.releasedAt)}.</p></> : r.reviewerKind === 'team' ? <p className="small">{isCoach ? 'The Bioptime team reviews this report and releases it to the member: you are away, or the member keeps health sharing with their coach off. Coach review is not available for it.' : <>No coach can review this report, so it waits for a release by the Bioptime team from <Link to="/bloodwork">Bloodwork → Reports</Link>.</>}</p> : isCoach ? <div className="form"><Field label="Note for the member" hint="Plain language: what is in range, what is outside, what is urgent (usually nothing), what changes. Point to a doctor for decisions about medicines or tests."><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Seven of nine markers are inside the laboratory's ranges…" /></Field>{(r.flagged ?? []).length ? <div><span className="bp-label">Flags from the laboratory's ranges</span><div className="pillRow" style={{ marginTop: 6 }}>{r.flagged.map((f: string) => <span key={f} className="bp-pill bp-pill-warning">{f}</span>)}</div></div> : null}<Button variant="primary" busy={busy} disabled={note.trim().length < 5} onClick={review}>Mark reviewed and release</Button><p className="muted">Releasing completes the booking and notifies the member. It is recorded with your name.</p></div> : <p className="small">Awaiting the assigned coach's review.</p>}</Card>
        <ReportNextSteps report={r} />
        <Card style={{ marginTop: 14 }}><CardHead eyebrow="Section 3" title="Limits" /><p className="small">A single test is a snapshot. A result outside a range is not a diagnosis, and one inside does not rule a condition out. Bioptime is wellbeing guidance, not medical advice; medicines, supplements and further tests are a doctor's call.</p><Button variant="tertiary" size="sm" style={{ marginTop: 8 }} onClick={() => nav(-1)}>Back</Button></Card></div>
    </div>
  </div>;
}
