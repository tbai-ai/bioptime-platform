import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Link } from '../lib/nav';
import { api, qs } from '../lib/api';
import { fmtDateTime, fmtInr, label } from '../lib/format';
import { Alert, Button, Card, Empty, Pill, ReasonDialog, Select, Skeleton, Table, useApi, useToast } from '../ui';

export function Orders() {
  const [status, setStatus] = useState('');
  const [params] = useSearchParams();
  const ref = params.get('ref');
  const list = useApi(() => api.get(`/admin/orders${qs({ status, limit: 200 })}`), [status]);
  const toast = useToast();
  const [refund, setRefund] = useState<any>(null);
  const [activate, setActivate] = useState<any>(null);
  const items = (((list.data as any)?.items ?? []) as any[]).filter((o) => !ref || o.reference === ref);
  return <div className="stack">
    <div className="pageHead"><div><h1>Orders and payments</h1><p className="sub">Only a signature-verified provider event marks an order paid. Activation creates the programme and its entitlements exactly once. Refunds cancel unused entitlements and end the programme.</p></div><div className="actions"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{['pending_payment', 'paid', 'activated', 'failed', 'cancelled', 'refund_pending', 'refunded'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select></div></div>
    {list.error && <Alert kind="error">{list.error}</Alert>}
    {list.loading && !list.data ? <Skeleton rows={5} /> : items.length ? <Card dense><Table head={<><th>Reference</th><th>Member</th><th>Package</th><th className="num">Total</th><th>Status</th><th>Payment</th><th>When</th><th></th></>}>{items.map((o) => <tr key={o.id}><td>{o.reference}</td><td><Link to={`/clients/${o.memberId}`}>{o.memberName}</Link></td><td>{o.packageName}</td><td className="num">{fmtInr(o.totalInr)}<div className="muted">GST {fmtInr(o.gstInr)}</div></td><td><Pill status={o.status} />{o.refund && <div className="muted">refund {o.refund.status}</div>}</td><td className="small">{o.payment ? <>{o.payment.provider}{o.payment.simulated ? ' (simulated)' : ''} · {o.payment.status}{o.payment.signatureVerified ? ' · verified' : ''}</> : '—'}</td><td className="small">{fmtDateTime(o.activatedAt ?? o.paidAt ?? o.createdAt)}</td><td><div className="row">{(o.status === 'paid' || o.status === 'activated') && <Button size="sm" variant="destructive" onClick={() => setRefund(o)}>Refund</Button>}{o.status === 'paid' && <Button size="sm" onClick={() => setActivate(o)}>Activate</Button>}</div></td></tr>)}</Table></Card> : <Card><Empty title="No orders" /></Card>}
    <ReasonDialog open={!!refund} onClose={() => setRefund(null)} title={`Refund ${refund?.reference} (${fmtInr(refund?.totalInr)})?`} danger confirmLabel="Refund" body={`Unused entitlements are cancelled, the programme ends, the assignment ends, the member is notified.${refund?.payment?.simulated ? ' The provider refund is simulated; no money moves.' : ''}`} onConfirm={async (reason) => { await api.post(`/admin/orders/${refund.id}/refund`, { reason }); toast('Refund requested'); list.reload(); }} />
    <ReasonDialog open={!!activate} onClose={() => setActivate(null)} title={`Activate ${activate?.reference}?`} confirmLabel="Activate" body="For a paid order whose activation did not complete (reconciliation). Entitlements are created once." onConfirm={async (reason) => { await api.post(`/admin/orders/${activate.id}/activate`, { reason }); toast('Activated'); list.reload(); }} />
  </div>;
}
