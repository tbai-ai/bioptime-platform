/* M3 Billing, a card on the admin Overview (orders.manage): refund requests waiting for a decision and whether tax
   invoices can be issued yet. */
import React from 'react';
import { api } from '../../lib/api';
import { Link } from '../../lib/nav';
import { Card, CardHead, Skeleton, useApi } from '../../ui';
import type { BillingSummary } from './AdminBilling';

export default function BillingCard() {
  const s = useApi(() => api.get<BillingSummary>('/admin/billing/summary'), []);
  const d = s.data;
  return <Card><CardHead eyebrow="Billing" title={d ? (d.openRefundRequests ? `${d.openRefundRequests} refund request${d.openRefundRequests === 1 ? '' : 's'} to decide` : 'No refund requests waiting') : 'Billing'} right={<Link className="bp-btn bp-btn-tertiary bp-btn-sm" to={d?.openRefundRequests ? '/billing?tab=requests' : '/billing'}>Open</Link>} />
    {s.error ? <p className="small">{s.error}</p> : !d ? <Skeleton rows={2} /> : <p className="small">{d.taxInvoices.ready ? `Tax invoices are issued. ${d.documents.taxInvoices} issued, ${d.documents.creditNotes} credit notes.` : `Receipts only: tax invoices are pending configuration (missing ${d.taxInvoices.missing.join(', ')}).`}{d.paidOrdersWithoutReceipt ? ` ${d.paidOrdersWithoutReceipt} verified paid order${d.paidOrdersWithoutReceipt === 1 ? '' : 's'} without a receipt.` : ''}</p>}
  </Card>;
}
