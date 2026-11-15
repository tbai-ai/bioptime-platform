/* M3 Billing, the Billing tab on a client's record in the admin workspace (orders.manage; never in the coach
   workspace). The member's verified paid orders with their documents, the documents an order is missing (issued here
   with a reason), and the member's refund requests. Orders and refund requests come a page at a time with "Load more";
   the documents are loaded in full (every page of the cursor), because they are shown under their orders and decide
   which documents an order is missing. */
import React, { useState } from 'react';
import { api, qs } from '../../lib/api';
import { fmtDate, fmtDateTime, fmtInr, label } from '../../lib/format';
import { Alert, Button, Card, CardHead, Empty, Pill, ReasonDialog, Skeleton, Table, errorText, useApi, useToast } from '../../ui';
import { Link } from '../../lib/nav';
import { DocStatus, RequestStatus, docLabel, inrExact, openDocument, type BillingDoc, type RefundRequest } from './shared';
import type { BillingSummary } from './AdminBilling';
import { allPages, useMorePages, type Page } from './morePages';

type Order = { id: string; reference: string; packageName: string | null; status: string; totalInr: number; paidAt: string | null; payment: { signatureVerified: boolean; simulated: boolean } | null };
const PAID = ['paid', 'activated', 'refund_pending', 'refunded'];
const DOC_PAGE = 200, DOC_PAGES = 20;

export default function ClientRecordBilling({ memberId }: { memberId: string }) {
  const toast = useToast();
  const ordersPath = (cursor?: string) => `/admin/orders${qs({ memberId, limit: 100, cursor })}`;
  const requestsPath = (cursor?: string) => `/admin/refund-requests${qs({ memberId, limit: 100, cursor })}`;
  const orders = useApi(() => api.get<Page<Order>>(ordersPath()), [memberId]);
  const docs = useApi(() => allPages((cursor) => api.get<Page<BillingDoc>>(`/admin/billing/documents${qs({ memberId, limit: DOC_PAGE, cursor })}`), DOC_PAGES), [memberId]);
  const requests = useApi(() => api.get<Page<RefundRequest>>(requestsPath()), [memberId]);
  const orderPages = useMorePages(orders.data, (cursor) => api.get<Page<Order>>(ordersPath(cursor)));
  const requestPages = useMorePages(requests.data, (cursor) => api.get<Page<RefundRequest>>(requestsPath(cursor)));
  const summary = useApi(() => api.get<BillingSummary>('/admin/billing/summary'), []);
  const [issuing, setIssuing] = useState<Order | null>(null);
  const error = orders.error || docs.error || requests.error;
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!orders.data || !docs.data || !requests.data) return <Skeleton rows={5} />;
  const ready = !!summary.data?.taxInvoices.ready;
  const allDocs = docs.data.complete;
  const paid = orderPages.items.filter((o) => o.paidAt && PAID.includes(o.status) && o.payment?.signatureVerified);
  const docsFor = (o: Order) => docs.data!.items.filter((d) => d.orderId === o.id);
  // with documents left unloaded (more than DOC_PAGES pages) an order cannot be said to miss one
  const missing = (o: Order) => { const ds = docsFor(o); return allDocs && (!ds.some((d) => d.kind === 'receipt') || (ready && (o.status === 'paid' || o.status === 'activated') && !ds.some((d) => d.kind === 'tax_invoice' && d.status === 'issued'))); };
  const refundRequests = requestPages.items;
  const reload = () => { orders.reload(); docs.reload(); requests.reload(); summary.reload(); };
  return <div className="stack">
    <Card><CardHead eyebrow="Billing" title="Verified paid orders" right={<Link className="bp-btn bp-btn-tertiary bp-btn-sm" to="/billing">All billing</Link>} />
      {paid.length ? <div className="stack">{paid.map((o) => <div key={o.id} className="stack">
        <div className="row between"><div><b style={{ color: 'var(--bp-color-text-primary)' }}>{o.reference} · {o.packageName}</b><div className="small">{fmtInr(o.totalInr)} · paid {fmtDateTime(o.paidAt)}{o.payment?.simulated ? ' · simulated' : ''}</div></div>
          <div className="row"><Pill status={o.status} />{missing(o) && <Button size="sm" onClick={() => setIssuing(o)}>Issue missing documents</Button>}</div></div>
        {docsFor(o).length ? <Table dense label={`Documents for ${o.reference}`} head={<><th>Number</th><th>Document</th><th className="num">Total</th><th>Issued</th><th>Status</th><th /></>}>
          {docsFor(o).map((d) => <tr key={d.id}><td className="small">{d.number}</td><td>{docLabel(d)}</td><td className="num">{inrExact(d.totalInr)}</td><td className="small">{fmtDate(d.issuedAt)}</td><td><DocStatus status={d.status} /></td><td><Button size="sm" onClick={() => openDocument(`/admin/billing/documents/${d.id}/file-token`, (e) => toast(errorText(e), 'error'))}>Open</Button></td></tr>)}
        </Table> : allDocs ? <p className="muted small">No documents: paid while billing documents were switched off.</p> : <p className="muted small">No documents loaded here for this order. All billing lists every document.</p>}
      </div>)}</div> : <Empty title="No verified paid orders" body={orderPages.next ? 'None among the newest orders; load more to see older ones.' : undefined} />}
      {!allDocs && <p className="muted small" style={{ marginTop: 8 }}>Only the newest {docs.data.items.length} documents are shown, so no order is offered missing documents here. All billing lists every document.</p>}
      {orderPages.next && <div className="bp-card-foot"><Button size="sm" busy={orderPages.busy} onClick={orderPages.more}>Load more</Button></div>}
    </Card>
    <Card><CardHead eyebrow="Refunds" title="Refund requests" right={refundRequests.some((r) => r.status === 'requested') ? <Link className="bp-btn bp-btn-secondary bp-btn-sm" to="/billing?tab=requests">Decide</Link> : undefined} />
      {refundRequests.length ? <ul className="timeline">{refundRequests.map((r) => <li key={r.id} className={r.status === 'requested' ? '' : 'done'}>
        <div className="row between"><b>{r.orderReference}</b><RequestStatus status={r.status} /></div>
        <div className="small">{r.reason}</div>
        {r.decisionNote && <div className="small">{r.decidedByName ?? 'Bioptime'}: {r.decisionNote}</div>}
        {r.refund && <div className="small">Refund {label(r.refund.status)}</div>}
        <time>{fmtDateTime(r.createdAt)}</time>
      </li>)}</ul> : <Empty title="No refund requests" />}
      {requestPages.next && <div className="bp-card-foot"><Button size="sm" busy={requestPages.busy} onClick={requestPages.more}>Load more</Button></div>}
    </Card>
    <ReasonDialog open={!!issuing} onClose={() => setIssuing(null)} title={`Issue the missing documents for ${issuing?.reference ?? ''}?`} confirmLabel="Issue"
      body={ready ? 'Issues the receipt if there is none and, for a paid or active order, a tax invoice with the current seller details. Numbers are taken now.' : 'Issues the receipt. Tax invoices are pending configuration, so none is issued.'}
      onConfirm={async (reason) => { const r = await api.post<{ issued: BillingDoc[] }>(`/admin/billing/orders/${issuing!.id}/issue`, { reason }); toast(`Issued ${r.issued.map((d) => d.number).join(', ')}`); reload(); }} />
  </div>;
}
