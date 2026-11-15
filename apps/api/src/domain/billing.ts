/* M3 Billing documents and refund requests.

   Documents
   - A receipt for every payment whose provider event verified (payments.signature_verified = 1), issued when the
     OrderPaid event is processed. One per payment, whatever the provider replays (a partial unique index).
   - A numbered tax invoice (INV-1001 …) as well, only while the billing_entity setting holds the seller's legal name,
     GSTIN and address. Until then members get a receipt clearly labelled "not a tax invoice", and the administrator
     view names the missing fields.
   - A credit note (CRN-1001 …) when a refund completes (the OrderRefunded event) or when an administrator voids a tax
     invoice. It credits the issued tax invoice, or the receipt when the order never had one.
   - Totals are the order's own (amount, GST and total in paise, as checkout computed them with the GST rate of the
     day, from the setting gst_rate_bp); nothing is recomputed. Numbers are taken inside the issuing transaction.
   - Documents never change once issued; an issued tax invoice can only be voided (0011 triggers).

   Refund requests
   - A member asks for a refund of a paid order with a reason; one open request per order. Nothing changes until an
     administrator holding orders.manage decides: approving calls the existing refund path (orders.requestRefund),
     declining records a note for the member. The member may withdraw an open request. No refund policy, window or
     eligibility rule is decided here: those are owner decisions.

   Access
   - Members see their own documents and requests; administrators need orders.manage, and the buyer's address fields
     are removed for those without members.view_restricted. Coaches see no payment data at all.
   - The printable document opens through a 5-minute signed token (the report pattern); no URL points at a document. */
import type { Ctx } from '../context.js';
import type { PaymentProvider } from '../adapters/payments.js';
import type { Role } from '@bioptime/domain';
// first, so that the feature key exists before the billing route file reads it (see billingConstants.ts)
export { BILLING_FEATURE } from './billingConstants.js';
import { BILLING_FEATURE } from './billingConstants.js';
import { randomId } from '../lib/ids.js';
import { AppError, errors } from '../lib/errors.js';
import { signToken, verifyToken } from '../lib/crypto.js';
import { j } from '../db/db.js';
import { nextReference } from '../db/seq.js';
import { hasPermission, permissionsFor, requireActor, requirePermission, requireRole } from '../auth/permissions.js';
import { adminRestrictedKeys, stripRestricted } from '../auth/fieldPolicy.js';
import { audit } from './audit.js';
import { notify } from './notifications.js';
import { getSetting } from './settings.js';
import { requireFeature } from './features.js';
import { requestRefund, type OrderRow } from './orders.js';

export const DOCUMENT_TOKEN_SECONDS = 300;

export type DocumentKind = 'receipt' | 'tax_invoice' | 'credit_note';
export type DocumentStatus = 'issued' | 'void';
export type DocumentLine = { description: string; sac_code?: string; qty: number; unit_paise: number; taxable_paise: number; gst_rate_bp: number; gst_paise: number };
export type Seller = Record<string, string>;
export type Buyer = { name: string; email: string; address: string | null; city: string | null; state: string | null; pincode: string | null };

export type DocumentRow = {
  id: string; kind: DocumentKind; number: string; order_id: string; payment_id: string | null; refund_id: string | null; member_id: string;
  seller: string | null; buyer: string; lines: string; subtotal_paise: number; gst_paise: number; total_paise: number; currency: string;
  simulated: number; issued_at: string; status: DocumentStatus; void_reason: string | null; voided_by: string | null; voided_at: string | null;
  related_document_id: string | null; created_at: string;
};
export type RefundRequestStatus = 'requested' | 'approved' | 'declined' | 'withdrawn';
export type RefundRequestRow = {
  id: string; order_id: string; member_id: string; reason: string; status: RefundRequestStatus; decided_by: string | null; decided_at: string | null;
  decision_note: string | null; refund_id: string | null; created_at: string; updated_at: string;
};
type PaymentRow = { id: string; order_id: string; provider: string; provider_ref: string | null; status: string; amount_paise: number; signature_verified: number; created_at: string; updated_at: string };
type RefundRow = { id: string; payment_id: string; order_id: string; amount_paise: number; status: string; reason: string; created_at: string; completed_at: string | null };

export const KIND_TITLE: Record<DocumentKind, string> = { receipt: 'Payment receipt', tax_invoice: 'Tax invoice', credit_note: 'Credit note' };
/** The order states that follow a verified capture. */
const PAID_STATES = ['paid', 'activated', 'refund_pending', 'refunded'];
/** The order states a refund can start from (orders.requestRefund). */
const REFUNDABLE_STATES = ['paid', 'activated'];
/** What a tax invoice needs from the billing_entity setting. The values come from the owner and counsel. */
export const SELLER_REQUIRED = ['legalName', 'gstin', 'address'] as const;
const inr = (paise: number) => paise / 100;
const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

/* ---------- configuration ---------- */

/** The seller's details as stored in the billing_entity setting, or null while nothing is stored. */
export function sellerDetails(ctx: Ctx): Seller | null {
  const v = getSetting<unknown>(ctx, 'billing_entity');
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: Seller = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (typeof val === 'string' && val.trim()) out[k] = val.trim();
  return Object.keys(out).length ? out : null;
}

/** Whether tax invoices can be issued, and the exact settings that are missing when they cannot. */
export function taxInvoiceSetup(ctx: Ctx): { ready: boolean; missing: string[]; seller: Seller | null } {
  const seller = sellerDetails(ctx);
  const missing = SELLER_REQUIRED.filter((k) => !seller?.[k]).map((k) => `billing_entity.${k}`);
  return { ready: missing.length === 0, missing, seller };
}

/* ---------- reading ---------- */

function documentRow(ctx: Ctx, id: string): DocumentRow | undefined {
  if (!/^bdc_[a-z0-9]{6,40}$/.test(id)) return undefined;
  return ctx.db.get<DocumentRow>('SELECT * FROM billing_documents WHERE id = ?', [id]);
}

function verifiedPayment(ctx: Ctx, orderId: string): PaymentRow | undefined {
  return ctx.db.get<PaymentRow>("SELECT * FROM payments WHERE order_id = ? AND signature_verified = 1 AND status IN ('captured','refunded') ORDER BY created_at DESC LIMIT 1", [orderId]);
}

function orderRow(ctx: Ctx, id: string): OrderRow | undefined {
  return ctx.db.get<OrderRow>('SELECT * FROM orders WHERE id = ? OR reference = ?', [id, id]);
}

function receiptForPayment(ctx: Ctx, paymentId: string): DocumentRow | undefined {
  return ctx.db.get<DocumentRow>("SELECT * FROM billing_documents WHERE kind = 'receipt' AND payment_id = ?", [paymentId]);
}

function creditFor(ctx: Ctx, documentId: string): DocumentRow | undefined {
  return ctx.db.get<DocumentRow>("SELECT * FROM billing_documents WHERE kind = 'credit_note' AND related_document_id = ?", [documentId]);
}

/** The order's metadata as an object ({} when it holds anything else, such as null). */
function orderMeta(o: OrderRow): Record<string, unknown> {
  const meta = j.out<unknown>(o.metadata, {});
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta as Record<string, unknown> : {};
}

function packageName(ctx: Ctx, o: OrderRow): string {
  const meta = orderMeta(o);
  if (typeof meta.packageName === 'string' && meta.packageName) return meta.packageName;
  if (o.package_version_id) return ctx.db.get<{ name: string }>('SELECT p.name FROM package_versions v JOIN packages p ON p.id = v.package_id WHERE v.id = ?', [o.package_version_id])?.name ?? 'Package';
  return o.custom_plan_id ? 'Bespoke plan' : 'Order';
}

/** Orders created without a stored gstRateBp (package checkout before M3, and bespoke orders until customPlans.accept
 *  stores one) had their GST computed with the constant 1.18, which is 1800 basis points. Kept apart from the setting's
 *  default, so that a change to the default never changes the rate printed for those orders. */
export const UNSTORED_GST_RATE_BP = 1800;

/** The GST rate an order was priced with, for package and bespoke orders alike: the gstRateBp stored in the order's
 *  metadata when the order was created (package checkout since M3; bespoke orders once customPlans.accept stores it),
 *  otherwise 1800, the constant every order without a stored rate was priced with. Never the current setting: a
 *  document keeps the rate its order was charged at. */
export function orderGstRateBp(o: OrderRow): number {
  const bp = orderMeta(o).gstRateBp;
  return typeof bp === 'number' && Number.isInteger(bp) && bp >= 0 && bp <= 10000 ? bp : UNSTORED_GST_RATE_BP;
}

/** The single line of an order, from its own amounts. */
function orderLines(ctx: Ctx, o: OrderRow, seller: Seller | null): DocumentLine[] {
  const coupon = o.coupon_id ? ctx.db.get<{ code: string }>('SELECT code FROM coupons WHERE id = ?', [o.coupon_id])?.code ?? null : null;
  const discount = o.discount_paise ?? 0;
  const description = `${packageName(ctx, o)}${discount > 0 ? ` (coupon ${coupon ?? 'applied'}: ${rupees(discount)} off the list price)` : ''}`;
  const taxable = o.total_paise - o.gst_paise;
  return [{ description, ...(seller?.sacCode ? { sac_code: seller.sacCode } : {}), qty: 1, unit_paise: taxable, taxable_paise: taxable, gst_rate_bp: orderGstRateBp(o), gst_paise: o.gst_paise }];
}

function buyerSnapshot(ctx: Ctx, memberId: string): Buyer {
  const u = ctx.db.get<{ name: string; email: string }>('SELECT name, email FROM users WHERE id = ?', [memberId]);
  const p = ctx.db.get<{ address: string | null; city: string | null; state: string | null; pincode: string | null }>('SELECT address, city, state, pincode FROM member_profiles WHERE user_id = ?', [memberId]);
  return { name: u?.name ?? '', email: u?.email ?? '', address: p?.address ?? null, city: p?.city ?? null, state: p?.state ?? null, pincode: p?.pincode ?? null };
}

/* ---------- issuing ---------- */

type NewDocument = {
  kind: DocumentKind; number: string; order: OrderRow; paymentId: string | null; refundId?: string | null; seller: Seller | null; buyer: Buyer;
  lines: DocumentLine[]; gstPaise: number; totalPaise: number; simulated: boolean; relatedDocumentId?: string | null;
};

function insertDocument(ctx: Ctx, d: NewDocument, reason: string | null): DocumentRow {
  const id = randomId('bdc');
  const now = ctx.now();
  const lineTotal = d.lines.reduce((s, l) => s + l.taxable_paise + l.gst_paise, 0);
  if (lineTotal !== d.totalPaise) throw new Error(`billing document ${d.number}: lines add up to ${lineTotal}, the total is ${d.totalPaise}`);
  ctx.db.insert('billing_documents', {
    id, kind: d.kind, number: d.number, order_id: d.order.id, payment_id: d.paymentId, refund_id: d.refundId ?? null, member_id: d.order.member_id,
    seller: d.seller ? j.in(d.seller) : null, buyer: j.in(d.buyer), lines: j.in(d.lines),
    subtotal_paise: d.totalPaise - d.gstPaise, gst_paise: d.gstPaise, total_paise: d.totalPaise, currency: d.order.currency || 'INR',
    simulated: d.simulated ? 1 : 0, issued_at: now, status: 'issued', related_document_id: d.relatedDocumentId ?? null, created_at: now,
  });
  audit(ctx, 'billing_document.issue', { type: 'billing_document', id }, reason, { kind: d.kind, number: d.number, orderId: d.order.id, memberId: d.order.member_id, totalPaise: d.totalPaise, relatedDocumentId: d.relatedDocumentId ?? null, refundId: d.refundId ?? null });
  return documentRow(ctx, id)!;
}

function newTaxInvoice(ctx: Ctx, o: OrderRow, paymentId: string, seller: Seller, simulated: boolean, reason: string | null, replaces: string | null): DocumentRow {
  return insertDocument(ctx, { kind: 'tax_invoice', number: nextReference(ctx.db, 'INV'), order: o, paymentId, seller, buyer: buyerSnapshot(ctx, o.member_id), lines: orderLines(ctx, o, seller), gstPaise: o.gst_paise, totalPaise: o.total_paise, simulated, relatedDocumentId: replaces }, reason);
}

/** The documents a verified payment earns: its receipt (once per payment) and, while the seller's details are set, a
 *  numbered tax invoice for an order that is paid or active. Safe to run again: it issues only what is missing.
 *  `replaceVoided` lets an administrator replace an invoice they voided earlier; the event path never does. */
export function issueForPaidOrder(ctx: Ctx, orderId: string, opts: { reason?: string | null; replaceVoided?: boolean } = {}): DocumentRow[] {
  return ctx.db.tx(() => {
    const o = orderRow(ctx, orderId);
    if (!o || !o.paid_at || !PAID_STATES.includes(o.status)) return [];
    const payment = verifiedPayment(ctx, o.id);
    if (!payment) return []; // never for a payment whose provider event did not verify
    const simulated = payment.provider === 'simulator';
    const setup = taxInvoiceSetup(ctx);
    const issued: DocumentRow[] = [];
    if (!receiptForPayment(ctx, payment.id)) {
      issued.push(insertDocument(ctx, { kind: 'receipt', number: `${o.reference}/${payment.id}`, order: o, paymentId: payment.id, seller: setup.seller, buyer: buyerSnapshot(ctx, o.member_id), lines: orderLines(ctx, o, setup.seller), gstPaise: o.gst_paise, totalPaise: o.total_paise, simulated }, opts.reason ?? null));
    }
    if (setup.ready && REFUNDABLE_STATES.includes(o.status)) {
      const invoices = ctx.db.all<{ id: string; status: string }>("SELECT id, status FROM billing_documents WHERE order_id = ? AND kind = 'tax_invoice' ORDER BY created_at DESC", [o.id]);
      const issuedInvoice = invoices.some((i) => i.status === 'issued');
      if (!issuedInvoice && (invoices.length === 0 || opts.replaceVoided)) issued.push(newTaxInvoice(ctx, o, payment.id, setup.seller!, simulated, opts.reason ?? null, invoices[0]?.id ?? null));
    }
    if (issued.length) {
      const names = issued.map((d) => (d.kind === 'receipt' ? 'receipt' : `tax invoice ${d.number}`));
      notify(ctx, { userId: o.member_id, category: 'payment', title: issued.length > 1 ? 'Your receipt and tax invoice are ready' : `Your ${names[0]} is ready`, body: `For ${o.reference}: open Billing to view or print ${issued.length > 1 ? 'them' : 'it'}.`, data: { orderId: o.id, documentIds: issued.map((d) => d.id) }, channels: ['in_app', 'push'] });
    }
    return issued;
  });
}

/** The credit amounts for a refund of `amountPaise` on an order: the order's own split when the refund is in full,
 *  otherwise GST in proportion. */
function creditLines(o: OrderRow, credited: DocumentRow, amountPaise: number, description: string): { lines: DocumentLine[]; gst: number } {
  const full = amountPaise === credited.total_paise;
  const gst = full ? credited.gst_paise : Math.round((credited.gst_paise * amountPaise) / Math.max(1, credited.total_paise));
  const rate = j.out<DocumentLine[]>(credited.lines, [])[0]?.gst_rate_bp ?? orderGstRateBp(o);
  const sac = j.out<DocumentLine[]>(credited.lines, [])[0]?.sac_code;
  return { gst, lines: [{ description, ...(sac ? { sac_code: sac } : {}), qty: 1, unit_paise: amountPaise - gst, taxable_paise: amountPaise - gst, gst_rate_bp: rate, gst_paise: gst }] };
}

/** A credit note for a completed refund, against the issued tax invoice or, without one, the payment's receipt (issued
 *  first when the order never had one). Once per refund. */
export function issueCreditNoteForRefund(ctx: Ctx, orderId: string, refundId: string | null, reason: string | null = null): DocumentRow | null {
  return ctx.db.tx(() => {
    const o = orderRow(ctx, orderId);
    if (!o || o.status !== 'refunded') return null;
    const refund = refundId
      ? ctx.db.get<RefundRow>('SELECT * FROM refunds WHERE id = ? AND order_id = ?', [refundId, o.id])
      : ctx.db.get<RefundRow>("SELECT * FROM refunds WHERE order_id = ? AND status = 'completed' ORDER BY created_at DESC LIMIT 1", [o.id]);
    if (!refund || refund.status !== 'completed') return null;
    const existing = ctx.db.get<DocumentRow>("SELECT * FROM billing_documents WHERE kind = 'credit_note' AND refund_id = ?", [refund.id]);
    if (existing) return existing;
    let target = ctx.db.get<DocumentRow>("SELECT * FROM billing_documents WHERE order_id = ? AND kind = 'tax_invoice' AND status = 'issued'", [o.id]);
    if (!target) {
      issueForPaidOrder(ctx, o.id, { reason: reason ?? 'receipt issued before the refund credit note' });
      target = receiptForPayment(ctx, refund.payment_id);
    }
    if (!target) return null; // no verified payment behind this refund: nothing to credit
    const already = creditFor(ctx, target.id);
    if (already) return already;
    const amount = Math.min(refund.amount_paise, target.total_paise);
    const { lines, gst } = creditLines(o, target, amount, `Refund of ${o.reference}: ${packageName(ctx, o)}`);
    const credit = insertDocument(ctx, {
      kind: 'credit_note', number: nextReference(ctx.db, 'CRN'), order: o, paymentId: refund.payment_id, refundId: refund.id,
      seller: j.out<Seller | null>(target.seller, null), buyer: j.out<Buyer>(target.buyer, buyerSnapshot(ctx, o.member_id)), lines, gstPaise: gst, totalPaise: amount,
      simulated: !!target.simulated, relatedDocumentId: target.id,
    }, reason);
    notify(ctx, { userId: o.member_id, category: 'payment', title: 'Your credit note is ready', body: `Credit note ${credit.number} records the refund of ${o.reference}. Open Billing to view or print it.`, data: { orderId: o.id, documentIds: [credit.id] }, channels: ['in_app', 'push'] });
    return credit;
  });
}

/** Open refund requests on an order that was refunded another way (an administrator from Orders, or the provider) are
 *  closed as approved, linked to the refund. */
export function closeRequestsForRefund(ctx: Ctx, orderId: string, refundId: string | null): number {
  const open = ctx.db.all<RefundRequestRow>("SELECT * FROM refund_requests WHERE order_id = ? AND status = 'requested'", [orderId]);
  if (!open.length) return 0;
  const refund = refundId ? ctx.db.get<RefundRow & { requested_by: string }>('SELECT * FROM refunds WHERE id = ?', [refundId]) : undefined;
  const by = refund?.requested_by && ctx.db.get('SELECT 1 FROM users WHERE id = ?', [refund.requested_by]) ? refund.requested_by : null;
  const now = ctx.now();
  for (const r of open) {
    ctx.db.update('refund_requests', r.id, { status: 'approved', decided_by: by, decided_at: now, decision_note: 'The order was refunded.', refund_id: refund?.id ?? null, updated_at: now });
    audit(ctx, 'refund_request.decide', { type: 'refund_request', id: r.id }, 'order refunded', { decision: 'approve', orderId, refundId: refund?.id ?? null, automatic: true });
  }
  return open.length;
}

/** Administrator: void an issued tax invoice with a reason. A credit note cancels it in full; with `reissue`, a new
 *  invoice with the current seller details replaces it (only for an order that is still paid or active). */
export function voidDocument(ctx: Ctx, id: string, input: { reason: string; reissue?: boolean }) {
  const actor = requirePermission(ctx, 'orders.manage');
  const reason = (input.reason ?? '').trim();
  if (reason.length < 3) throw errors.badRequest('Say why: the reason is recorded in the audit log', 'REASON_REQUIRED');
  return ctx.db.tx(() => {
    const doc = documentRow(ctx, id);
    if (!doc) throw errors.notFound('Billing document');
    if (doc.kind !== 'tax_invoice') throw errors.state('Only a tax invoice can be voided. A receipt records a verified payment and a credit note records a credit; a refund corrects them.', { code: 'NOT_VOIDABLE' });
    if (doc.status !== 'issued') throw errors.state('This invoice is already void', { code: 'ALREADY_VOID' });
    const credited = creditFor(ctx, doc.id);
    if (credited) throw errors.state(`This invoice was already credited in full by ${credited.number}`, { code: 'ALREADY_CREDITED' });
    const o = orderRow(ctx, doc.order_id)!;
    const now = ctx.now();
    ctx.db.run("UPDATE billing_documents SET status = 'void', void_reason = ?, voided_by = ?, voided_at = ? WHERE id = ?", [reason, actor.id, now, doc.id]);
    audit(ctx, 'billing_document.void', { type: 'billing_document', id: doc.id }, reason, { number: doc.number, orderId: doc.order_id, memberId: doc.member_id });
    const { lines, gst } = creditLines(o, doc, doc.total_paise, `Cancels tax invoice ${doc.number} in full: ${packageName(ctx, o)}`);
    const credit = insertDocument(ctx, { kind: 'credit_note', number: nextReference(ctx.db, 'CRN'), order: o, paymentId: doc.payment_id, seller: j.out<Seller | null>(doc.seller, null), buyer: j.out<Buyer>(doc.buyer, buyerSnapshot(ctx, o.member_id)), lines, gstPaise: gst, totalPaise: doc.total_paise, simulated: !!doc.simulated, relatedDocumentId: doc.id }, reason);
    let replacement: DocumentRow | null = null;
    if (input.reissue) {
      if (!REFUNDABLE_STATES.includes(o.status)) throw errors.state(`A replacement invoice needs an order that is paid or active (this one is ${o.status})`, { code: 'NOT_PAID' });
      const setup = taxInvoiceSetup(ctx);
      if (!setup.ready) throw errors.state(`Tax invoices are pending configuration. Missing: ${setup.missing.join(', ')}`, { code: 'SELLER_NOT_CONFIGURED', missing: setup.missing });
      const payment = verifiedPayment(ctx, o.id);
      if (!payment) throw errors.state('This order has no verified payment', { code: 'NOT_VERIFIED' });
      replacement = newTaxInvoice(ctx, o, payment.id, setup.seller!, payment.provider === 'simulator', reason, doc.id);
    }
    notify(ctx, { userId: o.member_id, category: 'payment', title: 'A tax invoice was cancelled', body: `Tax invoice ${doc.number} for ${o.reference} was cancelled by credit note ${credit.number}${replacement ? `; tax invoice ${replacement.number} replaces it` : ''}. Open Billing to view them.`, data: { orderId: o.id, documentIds: [doc.id, credit.id, ...(replacement ? [replacement.id] : [])] }, channels: ['in_app', 'push'] });
    return { voided: presentDocument(ctx, documentRow(ctx, doc.id)!, 'admin'), creditNote: presentDocument(ctx, credit, 'admin'), replacement: replacement ? presentDocument(ctx, replacement, 'admin') : null };
  });
}

/** Administrator: issue what a verified paid order is missing (orders paid while billing documents were switched off,
 *  or an invoice voided earlier). A reason is required and recorded. */
export function issueMissing(ctx: Ctx, orderId: string, reason: string) {
  requirePermission(ctx, 'orders.manage');
  const why = (reason ?? '').trim();
  if (why.length < 3) throw errors.badRequest('Say why: the reason is recorded in the audit log', 'REASON_REQUIRED');
  const o = orderRow(ctx, orderId);
  if (!o) throw errors.notFound('Order');
  if (!o.paid_at || !PAID_STATES.includes(o.status) || !verifiedPayment(ctx, o.id)) throw errors.state('Documents are issued only for an order whose payment the provider verified', { code: 'NOT_VERIFIED' });
  const issued = issueForPaidOrder(ctx, o.id, { reason: why, replaceVoided: true });
  if (!issued.length) {
    const setup = taxInvoiceSetup(ctx);
    throw errors.state(setup.ready ? 'This order already has its documents' : `This order already has its receipt. Tax invoices are pending configuration. Missing: ${setup.missing.join(', ')}`, { code: 'NOTHING_TO_ISSUE', missing: setup.ready ? [] : setup.missing });
  }
  return { issued: issued.map((d) => presentDocument(ctx, d, 'admin')) };
}

/* ---------- presenting ---------- */

const RESTRICTED = adminRestrictedKeys();

/** A document for a member (their own) or an administrator. Administrators without members.view_restricted get the
 *  buyer without address fields; the void reason and who voided are for administrators only. */
export function presentDocument(ctx: Ctx, d: DocumentRow, view: 'member' | 'admin') {
  const o = ctx.db.get<OrderRow>('SELECT * FROM orders WHERE id = ?', [d.order_id]);
  const related = d.related_document_id ? ctx.db.get<{ id: string; kind: DocumentKind; number: string }>('SELECT id, kind, number FROM billing_documents WHERE id = ?', [d.related_document_id]) : undefined;
  const creditedBy = d.kind !== 'credit_note' ? ctx.db.get<{ id: string; number: string }>("SELECT id, number FROM billing_documents WHERE kind = 'credit_note' AND related_document_id = ?", [d.id]) : undefined;
  const replacedBy = d.kind === 'tax_invoice' ? ctx.db.get<{ id: string; number: string }>("SELECT id, number FROM billing_documents WHERE kind = 'tax_invoice' AND related_document_id = ?", [d.id]) : undefined;
  const restricted = view === 'admin' && !hasPermission(ctx, 'members.view_restricted');
  const buyer = j.out<Buyer>(d.buyer, buyerSnapshot(ctx, d.member_id));
  const lines = j.out<DocumentLine[]>(d.lines, []).map((l) => ({ description: l.description, sacCode: l.sac_code ?? null, qty: l.qty, unitInr: inr(l.unit_paise), taxableInr: inr(l.taxable_paise), gstRateBp: l.gst_rate_bp, gstRatePct: l.gst_rate_bp / 100, gstInr: inr(l.gst_paise), amountInr: inr(l.taxable_paise + l.gst_paise) }));
  const taxDocument = d.kind === 'tax_invoice' || (d.kind === 'credit_note' && related?.kind === 'tax_invoice');
  const base = {
    id: d.id, kind: d.kind, title: KIND_TITLE[d.kind], number: d.number, status: d.status, taxDocument,
    orderId: d.order_id, orderReference: o?.reference ?? null, packageName: o ? packageName(ctx, o) : null, paymentId: d.payment_id, refundId: d.refund_id,
    relatedDocument: related ? { id: related.id, kind: related.kind, number: related.number } : null,
    creditedBy: creditedBy ?? null, replacedBy: replacedBy ?? null,
    subtotalInr: inr(d.subtotal_paise), gstInr: inr(d.gst_paise), totalInr: inr(d.total_paise), currency: d.currency,
    simulated: !!d.simulated, issuedAt: d.issued_at, paidAt: o?.paid_at ?? null, voidedAt: d.voided_at,
    seller: j.out<Seller | null>(d.seller, null), buyer: restricted ? stripRestricted(buyer, RESTRICTED) : buyer, lines,
  };
  if (view === 'member') return base;
  const voidedBy = d.voided_by ? ctx.db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', [d.voided_by])?.name ?? null : null;
  const member = ctx.db.get<{ name: string; email: string }>('SELECT name, email FROM users WHERE id = ?', [d.member_id]);
  return { ...base, memberId: d.member_id, memberName: member?.name ?? null, memberEmail: member?.email ?? null, voidReason: d.void_reason, voidedByName: voidedBy, restricted };
}

export function presentRequest(ctx: Ctx, r: RefundRequestRow, view: 'member' | 'admin') {
  const o = ctx.db.get<OrderRow>('SELECT * FROM orders WHERE id = ?', [r.order_id]);
  const refund = r.refund_id ? ctx.db.get<{ id: string; status: string; amount_paise: number }>('SELECT id, status, amount_paise FROM refunds WHERE id = ?', [r.refund_id]) : undefined;
  const base = {
    id: r.id, orderId: r.order_id, orderReference: o?.reference ?? null, packageName: o ? packageName(ctx, o) : null, totalInr: o ? inr(o.total_paise) : null, orderStatus: o?.status ?? null,
    reason: r.reason, status: r.status, decisionNote: r.decision_note, decidedAt: r.decided_at, refund: refund ? { id: refund.id, status: refund.status, amountInr: inr(refund.amount_paise) } : null,
    simulated: !!(o && ctx.db.get("SELECT 1 FROM payments WHERE order_id = ? AND provider = 'simulator' LIMIT 1", [o.id])),
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
  if (view === 'member') return base;
  const member = ctx.db.get<{ name: string; email: string }>('SELECT name, email FROM users WHERE id = ?', [r.member_id]);
  const decidedBy = r.decided_by ? ctx.db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', [r.decided_by])?.name ?? null : null;
  return { ...base, memberId: r.member_id, memberName: member?.name ?? null, memberEmail: member?.email ?? null, decidedByName: decidedBy };
}

/* ---------- member ---------- */

/** GET /me/billing: the member's verified paid orders, their documents and their refund requests. */
export function memberBilling(ctx: Ctx, memberId: string) {
  const actor = requireRole(ctx, 'member');
  if (actor.id !== memberId) throw errors.forbidden();
  const orders = ctx.db.all<OrderRow>('SELECT * FROM orders WHERE member_id = ? AND paid_at IS NOT NULL ORDER BY created_at DESC LIMIT 200', [memberId]).filter((o) => PAID_STATES.includes(o.status) && !!verifiedPayment(ctx, o.id));
  const docs = ctx.db.all<DocumentRow>('SELECT * FROM billing_documents WHERE member_id = ? ORDER BY issued_at DESC, created_at DESC LIMIT 500', [memberId]);
  const requests = ctx.db.all<RefundRequestRow>('SELECT * FROM refund_requests WHERE member_id = ? ORDER BY created_at DESC LIMIT 200', [memberId]);
  return {
    orders: orders.map((o) => {
      const open = requests.find((r) => r.order_id === o.id && r.status === 'requested');
      const payment = verifiedPayment(ctx, o.id)!;
      return {
        id: o.id, reference: o.reference, packageName: packageName(ctx, o), status: o.status, totalInr: inr(o.total_paise), gstInr: inr(o.gst_paise), paidAt: o.paid_at,
        simulated: payment.provider === 'simulator', documentIds: docs.filter((d) => d.order_id === o.id).map((d) => d.id),
        openRequestId: open?.id ?? null, canRequestRefund: REFUNDABLE_STATES.includes(o.status) && !open,
      };
    }),
    documents: docs.map((d) => presentDocument(ctx, d, 'member')),
    requests: requests.map((r) => presentRequest(ctx, r, 'member')),
  };
}

/* ---------- the member's data export (ApiModule.exportSections, read by dataExport.buildArchive) ---------- */

/** The seller fields an exported document carries: the identity printed on a tax document. Contact fields the setting
 *  may hold (email, phone, website), the PAN and anything else stay out. */
const EXPORT_SELLER_KEYS = ['legalName', 'tradeName', 'gstin', 'address', 'state', 'stateCode'] as const;

/** The member's billing documents as their Billing screen and the printable document show them: number, kind, status,
 *  dates, amounts (in paise, like the rest of the archive), the lines, the seller identity and their own billed-to
 *  details. Never the void reason or who voided (administrators only), internal ids, or anything from the payment
 *  provider. Void documents are listed with their status, as the member sees them. */
export function exportDocuments(ctx: Ctx, memberId: string) {
  const rows = ctx.db.all<DocumentRow>('SELECT * FROM billing_documents WHERE member_id = ? ORDER BY issued_at, id', [memberId]);
  const byId = new Map(rows.map((d) => [d.id, d]));
  return rows.map((d) => {
    const o = ctx.db.get<OrderRow>('SELECT * FROM orders WHERE id = ?', [d.order_id]);
    const related = d.related_document_id ? byId.get(d.related_document_id) : undefined;
    const creditedBy = d.kind !== 'credit_note' ? rows.find((x) => x.kind === 'credit_note' && x.related_document_id === d.id) : undefined;
    const replacedBy = d.kind === 'tax_invoice' ? rows.find((x) => x.kind === 'tax_invoice' && x.related_document_id === d.id) : undefined;
    const seller = j.out<Seller | null>(d.seller, null);
    const buyer = j.out<Partial<Buyer> | null>(d.buyer, null) ?? {};
    return {
      number: d.number, kind: d.kind, title: KIND_TITLE[d.kind], status: d.status,
      tax_document: d.kind === 'tax_invoice' || (d.kind === 'credit_note' && related?.kind === 'tax_invoice'),
      order_reference: o?.reference ?? null, package_name: o ? packageName(ctx, o) : null,
      issued_at: d.issued_at, paid_at: o?.paid_at ?? null, voided_at: d.voided_at,
      related_document: related ? { kind: related.kind, number: related.number } : null,
      credited_by: creditedBy?.number ?? null, replaced_by: replacedBy?.number ?? null,
      subtotal_paise: d.subtotal_paise, gst_paise: d.gst_paise, total_paise: d.total_paise, currency: d.currency,
      simulated_payment: !!d.simulated,
      lines: j.out<DocumentLine[]>(d.lines, []).map((l) => ({ description: l.description, sac_code: l.sac_code ?? null, qty: l.qty, taxable_paise: l.taxable_paise, gst_rate_bp: l.gst_rate_bp, gst_paise: l.gst_paise, amount_paise: l.taxable_paise + l.gst_paise })),
      seller: seller ? Object.fromEntries(EXPORT_SELLER_KEYS.filter((k) => seller[k]).map((k) => [k, seller[k]])) : null,
      billed_to: { name: buyer.name ?? null, email: buyer.email ?? null, address: buyer.address ?? null, city: buyer.city ?? null, state: buyer.state ?? null, pincode: buyer.pincode ?? null },
    };
  });
}

/** The member's refund requests as their Billing screen shows them: the order, what they wrote, the status, the note
 *  the Bioptime team wrote to them and the refund it started. Never who decided (administrators only). */
export function exportRefundRequests(ctx: Ctx, memberId: string) {
  return ctx.db.all<RefundRequestRow>('SELECT * FROM refund_requests WHERE member_id = ? ORDER BY created_at, id', [memberId]).map((r) => {
    const o = ctx.db.get<OrderRow>('SELECT * FROM orders WHERE id = ?', [r.order_id]);
    const refund = r.refund_id ? ctx.db.get<{ status: string; amount_paise: number }>('SELECT status, amount_paise FROM refunds WHERE id = ?', [r.refund_id]) : undefined;
    return {
      order_reference: o?.reference ?? null, package_name: o ? packageName(ctx, o) : null, order_total_paise: o?.total_paise ?? null,
      your_reason: r.reason, status: r.status, decision_note: r.decision_note, decided_at: r.decided_at,
      refund: refund ? { status: refund.status, amount_paise: refund.amount_paise } : null,
      created_at: r.created_at,
    };
  });
}

/** One of the member's own documents (404 for anyone else's). */
export function memberDocument(ctx: Ctx, id: string) {
  const actor = requireRole(ctx, 'member');
  const d = documentRow(ctx, id);
  if (!d || d.member_id !== actor.id) throw errors.notFound('Billing document');
  return presentDocument(ctx, d, 'member');
}

/** A member asks for a refund of their own paid order. Nothing changes until an administrator decides. */
export function createRefundRequest(ctx: Ctx, orderId: string, reason: string) {
  const actor = requireRole(ctx, 'member');
  const text = (reason ?? '').trim();
  if (text.length < 3) throw errors.badRequest('Tell us why you are asking for a refund', 'REASON_REQUIRED');
  return ctx.db.tx(() => {
    const o = orderRow(ctx, orderId);
    if (!o || o.member_id !== actor.id) throw errors.notFound('Order');
    if (!REFUNDABLE_STATES.includes(o.status)) throw errors.state(`Only a paid order can be refunded (this one is ${o.status.replace(/_/g, ' ')})`, { code: 'NOT_REFUNDABLE' });
    if (!verifiedPayment(ctx, o.id)) throw errors.state('This order has no verified payment', { code: 'NOT_VERIFIED' });
    const open = ctx.db.get<{ id: string }>("SELECT id FROM refund_requests WHERE order_id = ? AND status = 'requested'", [o.id]);
    if (open) throw errors.conflict('You already asked for a refund of this order; it is waiting for a decision', 'REQUEST_OPEN', { requestId: open.id });
    const id = randomId('rrq');
    const now = ctx.now();
    ctx.db.insert('refund_requests', { id, order_id: o.id, member_id: actor.id, reason: text, status: 'requested', created_at: now, updated_at: now });
    audit(ctx, 'refund_request.create', { type: 'refund_request', id }, text, { orderId: o.id, reference: o.reference, totalPaise: o.total_paise });
    // the administrators who can decide it (orders.manage), in the app only
    const deciders = ctx.db.all<{ id: string; role: Role }>("SELECT id, role FROM users WHERE role IN ('admin','owner') AND state = 'active'").filter((u) => permissionsFor(ctx, u).includes('orders.manage'));
    for (const a of deciders) notify(ctx, { userId: a.id, category: 'refund', title: 'Refund request', body: `${actor.name || 'A member'} asked for a refund of ${o.reference}. Decide it under Billing › Refund requests.`, data: { refundRequestId: id, orderId: o.id }, channels: ['in_app'] });
    return presentRequest(ctx, ctx.db.get<RefundRequestRow>('SELECT * FROM refund_requests WHERE id = ?', [id])!, 'member');
  });
}

/** The member withdraws their own open request. */
export function withdrawRefundRequest(ctx: Ctx, id: string) {
  const actor = requireRole(ctx, 'member');
  return ctx.db.tx(() => {
    const r = ctx.db.get<RefundRequestRow>('SELECT * FROM refund_requests WHERE id = ?', [id]);
    if (!r || r.member_id !== actor.id) throw errors.notFound('Refund request');
    if (r.status !== 'requested') throw errors.state(`This request is already ${r.status}`, { code: 'NOT_OPEN' });
    const now = ctx.now();
    ctx.db.update('refund_requests', r.id, { status: 'withdrawn', updated_at: now });
    audit(ctx, 'refund_request.withdraw', { type: 'refund_request', id: r.id }, 'withdrawn by the member', { orderId: r.order_id });
    return presentRequest(ctx, ctx.db.get<RefundRequestRow>('SELECT * FROM refund_requests WHERE id = ?', [id])!, 'member');
  });
}

/* ---------- administrators ---------- */

/** The administrator lists page newest first by (time, id). A cursor names the last row of the page before it as
 *  "<time>~<id>", so rows that share a time (documents issued in one transaction, or by the demo seed) are neither
 *  skipped nor repeated. A bare time, the earlier format, still pages strictly before that time. */
const CURSOR_SEP = '~';
export function pageCursor(at: string, id: string): string { return `${at}${CURSOR_SEP}${id}`; }
function readCursor(cursor: string | null | undefined, idPattern: RegExp): { at: string; id: string } | null {
  if (!cursor) return null;
  const i = cursor.lastIndexOf(CURSOR_SEP);
  const at = i >= 0 ? cursor.slice(0, i) : cursor;
  const id = i >= 0 ? cursor.slice(i + 1) : '';
  if (!at || at.length > 40 || at.includes(CURSOR_SEP) || (id && !idPattern.test(id))) throw errors.badRequest('This page link is not valid. Load the list again.', 'INVALID_CURSOR');
  return { at, id };
}
/** `col < at`, or the same time and a smaller id (an empty id, from a bare-time cursor, matches no id). */
function afterCursor(timeCol: string, idCol: string, c: { at: string; id: string }, where: string[], params: string[]): void {
  where.push(`(${timeCol} < ? OR (${timeCol} = ? AND ${idCol} < ?))`);
  params.push(c.at, c.at, c.id);
}

export function adminDocuments(ctx: Ctx, f: { kind?: string; status?: string; memberId?: string; orderId?: string; q?: string; cursor?: string | null; limit: number }) {
  requirePermission(ctx, 'orders.manage');
  const where: string[] = [];
  const params: string[] = [];
  const cursor = readCursor(f.cursor, /^bdc_[a-z0-9]{6,40}$/);
  if (f.kind) { where.push('d.kind = ?'); params.push(f.kind); }
  if (f.status) { where.push('d.status = ?'); params.push(f.status); }
  if (f.memberId) { where.push('d.member_id = ?'); params.push(f.memberId); }
  if (f.orderId) { where.push('d.order_id = ?'); params.push(f.orderId); }
  if (f.q) { where.push('(d.number LIKE ? OR o.reference LIKE ? OR u.name LIKE ?)'); const like = `%${f.q.replace(/[%_]/g, '')}%`; params.push(like, like, like); }
  if (cursor) afterCursor('d.issued_at', 'd.id', cursor, where, params);
  const rows = ctx.db.all<DocumentRow>(`SELECT d.* FROM billing_documents d JOIN orders o ON o.id = d.order_id JOIN users u ON u.id = d.member_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY d.issued_at DESC, d.id DESC LIMIT ?`, [...params, f.limit + 1]);
  const items = rows.slice(0, f.limit).map((d) => presentDocument(ctx, d, 'admin'));
  const last = rows.length > f.limit ? rows[f.limit - 1]! : null;
  return { items, nextCursor: last ? pageCursor(last.issued_at, last.id) : null };
}

export function adminDocument(ctx: Ctx, id: string) {
  requirePermission(ctx, 'orders.manage');
  const d = documentRow(ctx, id);
  if (!d) throw errors.notFound('Billing document');
  return presentDocument(ctx, d, 'admin');
}

export function adminRequests(ctx: Ctx, f: { status?: string; memberId?: string; cursor?: string | null; limit: number }) {
  requirePermission(ctx, 'orders.manage');
  const where: string[] = [];
  const params: string[] = [];
  const cursor = readCursor(f.cursor, /^rrq_[a-z0-9]{6,40}$/);
  if (f.status) { where.push('status = ?'); params.push(f.status); }
  if (f.memberId) { where.push('member_id = ?'); params.push(f.memberId); }
  if (cursor) afterCursor('created_at', 'id', cursor, where, params);
  const rows = ctx.db.all<RefundRequestRow>(`SELECT * FROM refund_requests ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC, id DESC LIMIT ?`, [...params, f.limit + 1]);
  const last = rows.length > f.limit ? rows[f.limit - 1]! : null;
  return { items: rows.slice(0, f.limit).map((r) => presentRequest(ctx, r, 'admin')), nextCursor: last ? pageCursor(last.created_at, last.id) : null };
}

/** Administrator: approve (the refund starts through the existing refund path) or decline, with a note the member reads. */
export function decideRefundRequest(ctx: Ctx, provider: PaymentProvider, id: string, input: { decision: 'approve' | 'decline'; note: string }) {
  const actor = requirePermission(ctx, 'orders.manage');
  const note = (input.note ?? '').trim();
  if (note.length < 3) throw errors.badRequest('Write a note for the member: it is recorded in the audit log', 'REASON_REQUIRED');
  return ctx.db.tx(() => {
    const r = ctx.db.get<RefundRequestRow>('SELECT * FROM refund_requests WHERE id = ?', [id]);
    if (!r) throw errors.notFound('Refund request');
    if (r.status !== 'requested') throw errors.state(`This request is already ${r.status}`, { code: 'ALREADY_DECIDED' });
    const o = orderRow(ctx, r.order_id)!;
    let refundId: string | null = null;
    if (input.decision === 'approve') {
      requestRefund(ctx, provider, o.id, note); // the existing path: entitlements cancelled, programme and assignment ended, provider asked
      refundId = ctx.db.get<{ id: string }>('SELECT id FROM refunds WHERE order_id = ? ORDER BY created_at DESC LIMIT 1', [o.id])?.id ?? null;
    }
    const now = ctx.now();
    ctx.db.update('refund_requests', r.id, { status: input.decision === 'approve' ? 'approved' : 'declined', decided_by: actor.id, decided_at: now, decision_note: note, refund_id: refundId, updated_at: now });
    audit(ctx, 'refund_request.decide', { type: 'refund_request', id: r.id }, note, { decision: input.decision, orderId: o.id, reference: o.reference, refundId });
    notify(ctx, { userId: r.member_id, category: 'refund', title: input.decision === 'approve' ? 'Refund request approved' : 'Refund request declined', body: `${o.reference}: ${note}`, data: { refundRequestId: r.id, orderId: o.id }, channels: ['in_app', 'push'] });
    return presentRequest(ctx, ctx.db.get<RefundRequestRow>('SELECT * FROM refund_requests WHERE id = ?', [r.id])!, 'admin');
  });
}

/** The administrator summary: whether tax invoices can be issued (and what is missing), the GST rate, the open
 *  requests and the verified paid orders that still have no receipt. */
export function adminSummary(ctx: Ctx) {
  requirePermission(ctx, 'orders.manage');
  const setup = taxInvoiceSetup(ctx);
  const count = (sql: string) => ctx.db.get<{ n: number }>(sql)?.n ?? 0;
  return {
    taxInvoices: { ready: setup.ready, missing: setup.missing, note: setup.ready ? null : 'Receipts only, labelled "not a tax invoice", until the seller details are set on Modules (settings.manage).' },
    pendingDecisions: ['GSTIN, legal entity and registered address', 'SAC codes', 'place-of-supply rules and the CGST, SGST or IGST split', 'whether e-invoicing applies', 'refund policy'],
    gstRateBp: getSetting<number>(ctx, 'gst_rate_bp'),
    openRefundRequests: count("SELECT COUNT(*) n FROM refund_requests WHERE status = 'requested'"),
    documents: {
      receipts: count("SELECT COUNT(*) n FROM billing_documents WHERE kind = 'receipt'"),
      taxInvoices: count("SELECT COUNT(*) n FROM billing_documents WHERE kind = 'tax_invoice' AND status = 'issued'"),
      creditNotes: count("SELECT COUNT(*) n FROM billing_documents WHERE kind = 'credit_note'"),
      void: count("SELECT COUNT(*) n FROM billing_documents WHERE status = 'void'"),
    },
    paidOrdersWithoutReceipt: count("SELECT COUNT(*) n FROM orders o WHERE o.paid_at IS NOT NULL AND o.status IN ('paid','activated','refund_pending','refunded') AND EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.signature_verified = 1 AND p.status IN ('captured','refunded')) AND NOT EXISTS (SELECT 1 FROM billing_documents d WHERE d.order_id = o.id AND d.kind = 'receipt')"),
  };
}

/* ---------- the printable document: a 5-minute token ---------- */

/** Who may open a document: the member it belongs to, or an administrator holding orders.manage. Anyone else gets 404. */
export function assertDocumentAccess(ctx: Ctx, id: string): DocumentRow {
  const actor = requireActor(ctx);
  const d = documentRow(ctx, id);
  if (actor.role === 'member') { if (!d || d.member_id !== actor.id) throw errors.notFound('Billing document'); return d; }
  if (actor.role === 'admin' || actor.role === 'owner') { requirePermission(ctx, 'orders.manage'); if (!d) throw errors.notFound('Billing document'); return d; }
  throw errors.forbidden('Billing documents are for the member and the Bioptime team', 'NO_ACCESS');
}

export function documentFileToken(ctx: Ctx, id: string): { token: string; expiresInSeconds: number; url: string } {
  const d = assertDocumentAccess(ctx, id);
  const actor = ctx.actor!;
  audit(ctx, 'billing_document.file_access', { type: 'billing_document', id: d.id }, null, { number: d.number, memberId: d.member_id, byRole: actor.role });
  const token = signToken(ctx.config.TOKEN_SECRET, { k: 'billing', d: d.id, u: actor.id }, DOCUMENT_TOKEN_SECONDS);
  return { token, expiresInSeconds: DOCUMENT_TOKEN_SECONDS, url: `/api/billing/documents/file?token=${encodeURIComponent(token)}` };
}

const expired = () => errors.forbidden('This link has expired. Open the document again to get a new one.', 'LINK_EXPIRED');

/** Redeems a token: signature and expiry, an account that is still open, the module switched on for that person, and
 *  the access check again as that person. Returns the document presented for them. */
export function resolveDocumentToken(ctx: Ctx, token: string) {
  if (!token || token.length > 2000) throw expired();
  const p = verifyToken<{ k?: unknown; d?: unknown; u?: unknown }>(ctx.config.TOKEN_SECRET, token);
  if (!p || p.k !== 'billing' || typeof p.d !== 'string' || typeof p.u !== 'string') throw expired();
  const u = ctx.db.get<{ id: string; role: Role; email: string; name: string; state: string }>('SELECT id, role, email, name, state FROM users WHERE id = ?', [p.u]);
  if (!u || ['suspended', 'deactivated', 'closed'].includes(u.state)) throw expired();
  const as: Ctx = { ...ctx, actor: { id: u.id, role: u.role, email: u.email, name: u.name } };
  try { requireFeature(as, BILLING_FEATURE); } catch (e) { if (e instanceof AppError) throw e; throw expired(); }
  const d = assertDocumentAccess(as, p.d);
  return presentDocument(as, d, u.role === 'member' ? 'member' : 'admin');
}

/* ---------- domain-event handlers ---------- */

/** OrderPaid: the receipt (and the tax invoice when the seller's details are set). */
export function onOrderPaid(ctx: Ctx, orderId: string): void { issueForPaidOrder(ctx, orderId); }

/** OrderRefunded: the credit note, and any open request on the order closed as approved. */
export function onOrderRefunded(ctx: Ctx, orderId: string, refundId: string | null): void {
  ctx.db.tx(() => {
    issueCreditNoteForRefund(ctx, orderId, refundId);
    closeRequestsForRefund(ctx, orderId, refundId);
  });
}
