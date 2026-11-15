import React, { useState } from 'react';
import { Link } from '../lib/nav';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtDateTime, fmtInr, label, relative } from '../lib/format';
import { Alert, Button, Card, CardHead, Dialog, Empty, Field, Input, Pill, ReasonDialog, Select, Skeleton, Table, Tabs, Textarea, useApi, useToast, errorText } from '../ui';

/** Releases a report no coach can review (POST /admin/reports/:id/release, integrations.manage): a note for the member and a reason. */
function ReleaseDialog({ r, onClose, onDone }: { r: any; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [errs, setErrs] = useState<{ note?: string; reason?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  React.useEffect(() => { if (r) { setNote(''); setReason(''); setErrs({}); setBusy(false); } }, [r]);
  const go = async () => {
    const n = note.trim(), why = reason.trim();
    const e: { note?: string; reason?: string } = {};
    if (n.length < 5) e.note = 'Write a note for the member (at least 5 characters).';
    if (why.length < 3 || why.length > 300) e.reason = 'Say why, in 3 to 300 characters.';
    setErrs(e); if (e.note || e.reason) return;
    setBusy(true);
    try { await api.post(`/admin/reports/${r.id}/release`, { note: n, reason: why }); onDone(); onClose(); } catch (err) { setErrs({ form: errorText(err) }); setBusy(false); }
  };
  return <Dialog open={!!r} onClose={onClose} title={`Release ${r?.reference ?? 'report'}`} footer={<><Button variant="tertiary" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={go} disabled={busy}>Release to the member</Button></>}><div className="form"><p className="small">No coach can review this report: the member has no active coach or keeps coach sharing off. Releasing it opens the report in the member’s app with your note; the reason goes to the audit log.</p><Field label="Note for the member" error={errs.note}><Textarea value={note} maxLength={4000} onChange={(e) => setNote(e.target.value)} /></Field><Field label="Reason (recorded in the audit log)" error={errs.reason}><Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></Field>{errs.form && <Alert kind="error">{errs.form}</Alert>}</div></Dialog>;
}

const LAB = ['confirmed', 'scheduled', 'sample_collected', 'processing', 'results_ready', 'completed', 'cancelled'];

export function Bloodwork() {
  const { isPrivileged, user, can } = useAuth();
  // /admin/reports needs reports.view; /admin/bloodwork/bookings and /admin/bloodwork/tests need integrations.manage (apps/api/src/http/routes/admin.ts).
  // Each tab shows for its own permission and each list is fetched only when it is held; a coach sees reports and bookings for their clients.
  const canReports = !isPrivileged || can('reports.view');
  const canBookings = !isPrivileged || can('integrations.manage');
  const [tab, setTab] = useState<'reports' | 'bookings' | 'catalogue'>(canReports ? 'reports' : 'bookings');
  const [releasing, setReleasing] = useState<any>(null);
  const [status, setStatus] = useState('');
  const reports = useApi(() => (!canReports ? Promise.resolve(null) : api.get(isPrivileged ? '/admin/reports' : '/coach/reports')), [isPrivileged, canReports]);
  const bookings = useApi(() => (!canBookings ? Promise.resolve(null) : api.get(isPrivileged ? `/admin/bloodwork/bookings${qs({ status })}` : '/coach/bookings')), [isPrivileged, status, canBookings]);
  const tests = useApi(() => (isPrivileged && canBookings ? api.get('/admin/bloodwork/tests') : Promise.resolve(null)), [isPrivileged, canBookings]);
  const toast = useToast();
  const [override, setOverride] = useState<any>(null);
  const [price, setPrice] = useState<any>(null);
  if (!canReports && !canBookings) return <Alert kind="warning" title="Permission needed">Bloodwork shows the laboratory reports (the “reports.view” permission) and every member's bookings and the catalogue (the “integrations.manage” permission). Your administrator account holds neither; an owner can grant them under Users and permissions.</Alert>;
  // a tab whose permission is not held is never shown, even if it was the one last chosen
  const shown: 'reports' | 'bookings' | 'catalogue' = (tab === 'reports' && !canReports) || (tab !== 'reports' && !canBookings) ? (canReports ? 'reports' : 'bookings') : tab;
  const rep = ((reports.data as any)?.items ?? []) as any[];
  const bk = ((bookings.data as any)?.items ?? []) as any[];
  return <div className="stack">
    <div className="pageHead"><div><h1>Bloodwork</h1><p className="sub">{isPrivileged ? `${canReports && canBookings ? 'Laboratory reports, bookings across members and the catalogue.' : canReports ? 'Laboratory reports across members. Bookings and the catalogue need the “integrations.manage” permission.' : 'Bookings across members and the catalogue. Laboratory reports need the “reports.view” permission.'} Statuses move only on laboratory events or a review (the coach's, or a release by the Bioptime team); anything else is an owner override with a reason.` : 'Reports to review for your clients, and their bookings. Reviewing a report releases it to the member and completes the booking.'}</p></div>
      {isPrivileged && can('labstack.manage') && <div className="actions"><Link className="bp-btn bp-btn-secondary bp-btn-sm" to="/integrations/labstack">Laboratory integration</Link></div>}</div>
    <Tabs items={[...(canReports ? [{ id: 'reports' as const, label: 'Reports', count: rep.filter((r) => !r.reviewed).length }] : []), ...(canBookings ? [{ id: 'bookings' as const, label: 'Bookings' }] : []), ...(isPrivileged && canBookings ? [{ id: 'catalogue' as const, label: 'Catalogue' }] : [])]} value={shown} onChange={setTab}>
    {shown === 'reports' && canReports && (reports.error ? <Alert kind="error" title="Reports could not be loaded">{reports.error}</Alert> : reports.loading && !reports.data ? <Skeleton rows={4} /> : rep.length ? <Card dense><Table head={<><th>Member</th><th>Test</th><th>Delivered</th><th>Flags</th><th>Review</th><th></th></>}>{rep.map((r) => <tr key={r.id}><td><Link to={`/clients/${r.memberId}`}>{r.memberName ?? r.memberId}</Link><div className="muted">{r.reference}</div></td><td>{r.test?.name}</td><td>{relative(r.deliveredAt)}</td><td className="pillRow">{(r.flagged ?? []).map((f: string) => <span key={f} className="bp-pill bp-pill-warning">{f}</span>)}</td><td>{r.reviewed ? <span className="small">{r.reviewerName} · {fmtDate(r.reviewedAt)}</span> : <><Pill status="pending">Awaiting review</Pill>{isPrivileged && r.coachCanReview === false && <div className="muted small">No coach can review it (no active coach, or coach sharing off)</div>}</>}</td><td className="pillRow"><Link className={`bp-btn ${r.reviewed || (isPrivileged && r.coachCanReview === false && canBookings) ? 'bp-btn-secondary' : 'bp-btn-primary'} bp-btn-sm`} to={`/reports/${r.id}`}>{r.reviewed || isPrivileged ? 'Open' : 'Review'}</Link>{isPrivileged && !r.reviewed && r.coachCanReview === false && canBookings && <Button size="sm" variant="primary" onClick={() => setReleasing(r)}>Release</Button>}</td></tr>)}</Table></Card> : <Card><Empty title="No reports" body="Laboratory reports appear here when the vendor delivers them." /></Card>)}
    {shown === 'bookings' && canBookings && <>{isPrivileged && <div className="row"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{LAB.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select></div>}{bookings.error ? <Alert kind="error" title="Bookings could not be loaded">{bookings.error}</Alert> : bookings.loading && !bookings.data ? <Skeleton rows={4} /> : bk.length ? <Card dense><Table head={<><th>Booking</th><th>Member</th><th>Test</th><th>Slot</th><th>Status</th><th>Laboratory</th>{user?.role === 'owner' && <th></th>}</>}>{bk.map((b) => <tr key={b.id}><td>{b.reference}</td><td><Link to={`/clients/${b.memberId}`}>{b.memberName}</Link></td><td>{b.test?.name}</td><td>{fmtDateTime(b.slotAt)}</td><td><span className={`bp-labstatus bp-labstatus-${b.status}`}>{label(b.status)}</span>{b.flag && <div className="muted">{b.flag}</div>}</td><td className="small">{b.vendorOrderId ?? '—'}{b.vendorStatus ? <div className="muted">{b.vendorStatus}</div> : null}{b.simulated && <div className="muted">stand-in</div>}</td>{user?.role === 'owner' && <td><Button size="sm" variant="tertiary" onClick={() => setOverride(b)}>Override</Button></td>}</tr>)}</Table></Card> : <Card><Empty title="No bookings" /></Card>}</>}
    {shown === 'catalogue' && isPrivileged && canBookings && (tests.error ? <Alert kind="error" title="The catalogue could not be loaded">{tests.error}</Alert> : <Card dense><Table head={<><th>Test</th><th>Vendor id</th><th className="num">Price</th><th>Fasting</th><th>Turnaround</th><th>Visible</th><th></th></>}>{(((tests.data as any)?.items ?? []) as any[]).map((t) => <tr key={t.id}><td>{t.name}<div className="muted">{t.kind}</div></td><td className="small">{t.vendorTestId}</td><td className="num">{fmtInr(t.priceInr)}</td><td>{t.fastingHours ? `${t.fastingHours} h` : 'no'}</td><td>{t.turnaround}</td><td><Pill status={t.hidden ? 'paused' : 'active'}>{t.hidden ? 'Hidden' : 'Shown'}</Pill></td><td><Button size="sm" variant="tertiary" onClick={() => setPrice(t)}>Set price</Button></td></tr>)}</Table><p className="muted" style={{ marginTop: 8 }}>A new test from the vendor stays hidden until Bioptime sets its price; withdrawn tests are hidden, never deleted.</p></Card>)}
    </Tabs>
    <OverrideDialog b={override} onClose={() => setOverride(null)} onDone={() => { toast('Status overridden and audited'); bookings.reload(); }} />
    <PriceDialog t={price} onClose={() => setPrice(null)} onDone={() => { toast('Catalogue updated'); tests.reload(); }} />
    <ReleaseDialog r={releasing} onClose={() => setReleasing(null)} onDone={() => { toast('Report released to the member'); reports.reload(); }} />
  </div>;
}


function OverrideDialog({ b, onClose, onDone }: { b: any; onClose: () => void; onDone: () => void }) {
  const [status, setStatus] = useState('cancelled');
  return <ReasonDialog open={!!b} onClose={onClose} title={`Override ${b?.reference}?`} danger confirmLabel="Override status" body={`Moves the booking from ${label(b?.status)} without a laboratory event. The member is notified and the change is audited with your name.`} extra={<Field label="New status"><Select value={status} onChange={(e) => setStatus(e.target.value)}>{LAB.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select></Field>} onConfirm={async (reason) => { await api.patch(`/admin/bookings/${b.id}`, { status, reason }); onDone(); }} />;
}

/** Price or visibility of one catalogue test. The reason is typed by the administrator and recorded verbatim in the
    audit log (3 to 300 characters, the server's limit); nothing is sent until it passes. */
function PriceDialog({ t, onClose, onDone }: { t: any; onClose: () => void; onDone: () => void }) {
  const [price, setPrice] = useState('');
  const [hidden, setHidden] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonErr, setReasonErr] = useState('');
  const [err, setErr] = useState('');
  React.useEffect(() => { if (t) { setPrice(t.priceInr ?? ''); setHidden(!!t.hidden); setReason(''); setReasonErr(''); setErr(''); } }, [t]);
  const go = async () => {
    const r = reason.trim();
    if (r.length < 3 || r.length > 300) { setReasonErr('Say why, in 3 to 300 characters.'); return; }
    setReasonErr('');
    try { await api.patch(`/admin/bloodwork/tests/${t.id}`, { priceInr: price === '' ? null : Number(price), hidden, reason: r }); onDone(); onClose(); } catch (e) { setErr(errorText(e)); }
  };
  return <Dialog open={!!t} onClose={onClose} title={t?.name ?? ''} footer={<><Button variant="tertiary" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={go}>Save</Button></>}><div className="form"><Field label="Price (₹, including GST)" hint="Leave empty to keep the test unpriced and hidden."><Input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} /></Field><label className="bp-check"><input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> Hidden from members</label><Field label="Reason (recorded in the audit log)" error={reasonErr}><Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. vendor price revised on 1 November" /></Field>{err && <Alert kind="error">{err}</Alert>}</div></Dialog>;
}
