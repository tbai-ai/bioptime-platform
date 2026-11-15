/* M3 Billing in the admin workspace: what the Billing page and the member record's Billing tab share (the web's
   modules/billing/shared.tsx and morePages.ts): the shapes, the document words (docLabel), the pills, the GST rate and
   exact rupees, the cursor pages behind "Load more" and every page of a list for the views that need it whole. Opening
   a document is a 5-minute token then the printable page (openBillingDocument in ./shared). Tokens from theme.ts only. */
import React, { useState } from 'react';
import { errorText } from '@/lib/api';
import { Pill } from '@/components/ui';

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
export type BillingSummary = {
  taxInvoices: { ready: boolean; missing: string[]; note: string | null }; pendingDecisions: string[]; gstRateBp: number; openRefundRequests: number;
  documents: { receipts: number; taxInvoices: number; creditNotes: number; void: number }; paidOrdersWithoutReceipt: number;
};
export type Page<T> = { items: T[]; nextCursor: string | null };

/** What the document is, in words: "Tax invoice", "Credit note against INV-1001", "Payment receipt · not a tax invoice". */
export function docLabel(d: BillingDoc): string {
  if (d.kind === 'receipt') return 'Payment receipt · not a tax invoice';
  if (d.kind === 'credit_note') return `Credit note${d.relatedDocument ? ` against ${d.relatedDocument.number}` : ''}${d.taxDocument ? '' : ' · refund record'}`;
  return d.relatedDocument ? `Tax invoice · replaces ${d.relatedDocument.number}` : 'Tax invoice';
}

/** Issued reads as active (success), void as cancelled. */
export function DocStatus({ status }: { status: BillingDoc['status'] }) {
  return status === 'void' ? <Pill tone="info">Void</Pill> : <Pill tone="success">Issued</Pill>;
}
const REQUEST_PILL: Record<RefundRequest['status'], [React.ComponentProps<typeof Pill>['tone'], string]> = { requested: ['warning', 'Waiting for a decision'], approved: ['success', 'Approved'], declined: ['error', 'Declined'], withdrawn: ['info', 'Withdrawn'] };
export function RequestStatusPill({ status }: { status: RefundRequest['status'] }) {
  const [tone, text] = REQUEST_PILL[status] ?? ['info', status];
  return <Pill tone={tone}>{text}</Pill>;
}

export function gstPct(bp: unknown): string {
  return typeof bp === 'number' ? `${(bp / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%` : '—';
}
/** Rupees with paise, as the documents print them. */
export function inrExact(n?: number | null): string {
  if (n === null || n === undefined) return '—';
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/** The first page (loaded by the screen) and the pages after it, loaded with "Load more". The later pages belong to the
 *  first page they followed, so a filter change or a reload starts the list again from the top (the web's useMorePages). */
export function useMorePages<T>(first: Page<T> | null, load: (cursor: string) => Promise<Page<T>>, onError: (text: string) => void) {
  const [extra, setExtra] = useState<{ base: Page<T>; items: T[]; nextCursor: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const current = extra && first && extra.base === first ? extra : null;
  const next = current ? current.nextCursor : first?.nextCursor ?? null;
  const more = async () => {
    if (!first || !next) return;
    setBusy(true);
    try {
      const r = await load(next);
      setExtra((e) => ({ base: first, items: [...(e && e.base === first ? e.items : []), ...r.items], nextCursor: r.nextCursor }));
    } catch (e) { onError(errorText(e)); } finally { setBusy(false); }
  };
  return { items: [...(first?.items ?? []), ...(current?.items ?? [])], next, busy, more };
}

/** Every page of a list, following nextCursor until there is none; stops after maxPages pages (complete false) and when a
 *  cursor does not move on (the web's allPages). */
export async function allPages<T>(load: (cursor?: string) => Promise<Page<T>>, maxPages: number): Promise<{ items: T[]; complete: boolean }> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const r = await load(cursor);
    items.push(...r.items);
    if (!r.nextCursor) return { items, complete: true };
    if (r.nextCursor === cursor) break;
    cursor = r.nextCursor;
  }
  return { items, complete: false };
}
