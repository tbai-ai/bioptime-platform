/* M3 Billing, member portal (/client/billing): the documents for payments the provider verified, the paid orders with
   a way to ask for a refund, and the refund requests with their decisions. No refund policy is stated here: the terms
   decide, and the Bioptime team decides each request. */
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { fmtDate, fmtDateTime, fmtInr, label } from '../../lib/format';
import { Alert, Button, Card, CardHead, ConfirmDialog, Dialog, Empty, Field, Pill, Skeleton, Table, Textarea, errorText, useApi, useToast } from '../../ui';
import { DocStatus, RequestStatus, docLabel, inrExact, openDocument, type BillingDoc, type RefundRequest } from './shared';

type BillingOrder = { id: string; reference: string; packageName: string; status: string; totalInr: number; gstInr: number; paidAt: string | null; simulated: boolean; documentIds: string[]; openRequestId: string | null; canRequestRefund: boolean };
type MyBilling = { orders: BillingOrder[]; documents: BillingDoc[]; requests: RefundRequest[] };

export default function ClientBilling() {
  const data = useApi(() => api.get<MyBilling>('/me/billing'), []);
  const toast = useToast();
  const [ask, setAsk] = useState<BillingOrder | null>(null);
  const [withdraw, setWithdraw] = useState<RefundRequest | null>(null);
  const d = data.data;
  const simulated = !!d && (d.documents.some((x) => x.simulated) || d.orders.some((o) => o.simulated));
  const open = (doc: BillingDoc) => openDocument(`/me/billing/documents/${doc.id}/file-token`, (e) => toast(errorText(e), 'error'));
  return <div className="stack">
    <div className="pageHead"><div><h1>Billing</h1><p className="sub">Receipts, tax invoices and credit notes for the payments the provider confirmed, and your refund requests.</p></div><div className="actions"><Button size="sm" variant="tertiary" onClick={data.reload}>Refresh</Button></div></div>
    {data.error && <Alert kind="error">{data.error}</Alert>}
    {!d ? (data.error ? null : <Skeleton rows={6} />) : <>
      {simulated && <p className="muted small">Payments here are simulated; no money moves.</p>}
      <Card dense><CardHead eyebrow="Documents" title="Receipts, invoices and credit notes" />
        {d.documents.length ? <Table label="Billing documents" head={<><th>Number</th><th>Document</th><th>Order</th><th className="num">Total</th><th>Issued</th><th>Status</th><th /></>}>
          {d.documents.map((doc) => <tr key={doc.id}>
            {/* the number opens the document too, so on a phone the action is in the first column, not off-screen in the last */}
            <td className="small"><button type="button" className="linkButton" aria-label={`Open ${doc.number}`} onClick={() => open(doc)}>{doc.number}</button></td>
            <td>{docLabel(doc)}{doc.simulated && <div className="muted">Simulated payment</div>}</td>
            <td className="small">{doc.orderReference}<div className="muted">{doc.packageName}</div></td>
            <td className="num">{inrExact(doc.totalInr)}<div className="muted">GST {inrExact(doc.gstInr)}</div></td>
            <td className="small">{fmtDate(doc.issuedAt)}</td>
            <td><DocStatus status={doc.status} />{doc.status === 'void' && doc.creditedBy && <div className="muted">by {doc.creditedBy.number}</div>}</td>
            <td><Button size="sm" onClick={() => open(doc)}>Open</Button></td>
          </tr>)}
        </Table> : <Empty title="No documents yet" body="A receipt appears here once the payment provider confirms a payment." />}
      </Card>
      <div className="grid">
        <div className="span6"><Card><CardHead eyebrow="Orders" title="Paid orders" />
          {d.orders.length ? <div className="stack">{d.orders.map((o) => <div key={o.id} className="row between">
            <div><b style={{ color: 'var(--bp-color-text-primary)' }}>{o.reference} · {o.packageName}</b><div className="small">{fmtInr(o.totalInr)} · paid {fmtDateTime(o.paidAt)}{o.simulated ? ' · simulated' : ''}</div></div>
            <div className="row"><Pill status={o.status} />{o.canRequestRefund && <Button size="sm" variant="tertiary" onClick={() => setAsk(o)}>Ask for a refund</Button>}</div>
          </div>)}</div> : <Empty title="No paid orders" />}
        </Card></div>
        <div className="span6"><Card><CardHead eyebrow="Refunds" title="Your refund requests" />
          {d.requests.length ? <ul className="timeline">{d.requests.map((r) => <li key={r.id} className={r.status === 'requested' ? '' : 'done'}>
            <div className="row between"><b>{r.orderReference} · {r.packageName}</b><RequestStatus status={r.status} /></div>
            <div className="small">You wrote: {r.reason}</div>
            {r.decisionNote && <div className="small">Bioptime: {r.decisionNote}</div>}
            {r.refund && <div className="small">Refund {label(r.refund.status)} · {fmtInr(r.refund.amountInr)}</div>}
            <time>Asked {fmtDateTime(r.createdAt)}{r.decidedAt ? ` · decided ${fmtDateTime(r.decidedAt)}` : ''}</time>
            {r.status === 'requested' && <div style={{ marginTop: 6 }}><Button size="sm" variant="tertiary" onClick={() => setWithdraw(r)}>Withdraw</Button></div>}
          </li>)}</ul> : <Empty title="No refund requests" />}
        </Card></div>
      </div>
      <p className="muted small">Documents open through a link that expires in five minutes. A receipt is not a tax invoice. A refund request changes nothing until the Bioptime team decides it under the terms; you are told here and in your notifications.</p>
    </>}
    <AskRefund order={ask} onClose={() => setAsk(null)} onDone={() => { toast('Refund request sent'); data.reload(); }} />
    <ConfirmDialog open={!!withdraw} onClose={() => setWithdraw(null)} title={`Withdraw the request for ${withdraw?.orderReference ?? ''}?`} body="Your order stays as it is. You can ask again later." confirmLabel="Withdraw request" onConfirm={async () => { await api.post(`/me/refund-requests/${withdraw!.id}/withdraw`); toast('Request withdrawn'); data.reload(); }} />
  </div>;
}

function AskRefund({ order, onClose, onDone }: { order: BillingOrder | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  React.useEffect(() => { if (order) { setReason(''); setErr(''); } }, [order]);
  const send = async () => {
    if (reason.trim().length < 3) { setErr('Tell us why, in a few words.'); return; }
    setBusy(true);
    try { await api.post(`/me/orders/${order!.id}/refund-request`, { reason: reason.trim() }); onClose(); onDone(); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <Dialog open={!!order} onClose={onClose} title={order ? `Ask for a refund of ${order.reference}?` : ''} footer={<><Button variant="tertiary" onClick={onClose}>Not now</Button><Button variant="primary" busy={busy} onClick={send}>Send request</Button></>}>
    {order && <div className="form">
      <p className="small">{order.packageName} · {fmtInr(order.totalInr)}. The Bioptime team reads your request and decides it under the terms. Until then nothing changes: your package stays active.</p>
      <Field label="Why are you asking for a refund?" error={err}><Textarea value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} /></Field>
    </div>}
  </Dialog>;
}
