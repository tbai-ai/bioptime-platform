/* M3 Billing: small pieces the billing pages share. Existing components and classes only. */
import React from 'react';
import { api } from '../../lib/api';
import { openLater } from '../../lib/ids';
import { Pill } from '../../ui';

export type BillingDoc = {
  id: string; kind: 'receipt' | 'tax_invoice' | 'credit_note'; title: string; number: string; status: 'issued' | 'void'; taxDocument: boolean;
  orderId: string; orderReference: string | null; packageName: string | null; paymentId: string | null; refundId: string | null;
  relatedDocument: { id: string; kind: string; number: string } | null; creditedBy: { id: string; number: string } | null; replacedBy: { id: string; number: string } | null;
  subtotalInr: number; gstInr: number; totalInr: number; currency: string; simulated: boolean; issuedAt: string; paidAt: string | null; voidedAt: string | null;
  memberId?: string; memberName?: string | null; memberEmail?: string | null; voidReason?: string | null; voidedByName?: string | null; restricted?: boolean;
};
export type RefundRequest = {
  id: string; orderId: string; orderReference: string | null; packageName: string | null; totalInr: number | null; orderStatus: string | null; reason: string;
  status: 'requested' | 'approved' | 'declined' | 'withdrawn'; decisionNote: string | null; decidedAt: string | null; refund: { id: string; status: string; amountInr: number } | null;
  simulated: boolean; createdAt: string; updatedAt: string; memberId?: string; memberName?: string | null; memberEmail?: string | null; decidedByName?: string | null;
};

/** What the document is, in words: "Tax invoice", "Credit note against INV-1001", "Payment receipt · not a tax invoice". */
export function docLabel(d: BillingDoc): string {
  if (d.kind === 'receipt') return 'Payment receipt · not a tax invoice';
  if (d.kind === 'credit_note') return `Credit note${d.relatedDocument ? ` against ${d.relatedDocument.number}` : ''}${d.taxDocument ? '' : ' · refund record'}`;
  return d.relatedDocument ? `Tax invoice · replaces ${d.relatedDocument.number}` : 'Tax invoice';
}

/** The pill colours come from the shared status map (issued reads as active, void as cancelled). */
export function DocStatus({ status }: { status: BillingDoc['status'] }) {
  return status === 'void' ? <Pill status="cancelled">Void</Pill> : <Pill status="active">Issued</Pill>;
}
const REQUEST_PILL: Record<RefundRequest['status'], [string, string]> = { requested: ['requested', 'Waiting for a decision'], approved: ['accepted', 'Approved'], declined: ['declined', 'Declined'], withdrawn: ['cancelled', 'Withdrawn'] };
export function RequestStatus({ status }: { status: RefundRequest['status'] }) {
  const [tone, text] = REQUEST_PILL[status];
  return <Pill status={tone}>{text}</Pill>;
}

/** Opens the printable document in a new tab through a 5-minute token (the report pattern). */
export function openDocument(tokenPath: string, onError: (e: unknown) => void): void {
  openLater(() => api.post<{ token: string }>(tokenPath).then((t) => `/api/billing/documents/file?token=${encodeURIComponent(t.token)}`), onError);
}

export function gstPct(bp: unknown): string {
  return typeof bp === 'number' ? `${(bp / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%` : '—';
}

/** Rupees with paise, as the documents print them. */
export function inrExact(n?: number | null): string {
  if (n === null || n === undefined) return '—';
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
}
