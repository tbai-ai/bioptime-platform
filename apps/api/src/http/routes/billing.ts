/* M3 Billing routes, registered by the billing module (api/modules/billing.ts) inside /api. Every route declares the
   billing feature flag except the document file link, which checks the flag itself as the person the token names (a
   phone's browser opens it without the session). Members act on their own records; administrators need orders.manage.
   Coaches have no billing route: they see no payment data. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, pageParams } from '../../lib/validate.js';
import { def, param, query } from '../route.js';
import { systemCtx } from '../../context.js';
import * as billing from '../../domain/billing.js';
import * as orders from '../../domain/orders.js';
import * as bloodwork from '../../domain/bloodwork.js';
import { openTask } from '../../domain/support.js';
import { processPending } from '../../domain/events.js';
import { billingDocument } from '../billing-document.js';
import { BILLING_FEATURE, DOCUMENT_FILE_ROUTE } from '../../domain/billingConstants.js';

const FEATURE = BILLING_FEATURE;
/** The document file link the billing module declares ungated (read from the leaf constants file, which imports nothing). */
export { DOCUMENT_FILE_ROUTE };

const refundRequestBody = z.object({ reason: z.string().trim().min(3, 'Tell us why, in a few words').max(1000) });
const reasonBody = z.object({ reason: z.string().trim().min(3).max(500) });
const voidBody = z.object({ reason: z.string().trim().min(3).max(500), reissue: z.boolean().optional() });
const decideBody = z.object({ decision: z.enum(['approve', 'decline']), note: z.string().trim().min(3).max(1000) });
const documentQuery = z.object({ kind: z.enum(['receipt', 'tax_invoice', 'credit_note']).optional(), status: z.enum(['issued', 'void']).optional(), memberId: z.string().max(64).optional(), orderId: z.string().max(64).optional(), q: z.string().max(80).optional(), cursor: z.string().max(128).optional(), limit: z.string().optional() });
const requestQuery = z.object({ status: z.enum(['requested', 'approved', 'declined', 'withdrawn']).optional(), memberId: z.string().max(64).optional(), cursor: z.string().max(128).optional(), limit: z.string().optional() });
const tokenQuery = z.object({ token: z.string().max(2000) });

export function billingRoutes(app: FastifyInstance): void {
  const me = (req: { ctx: { actor: { id: string } | null } }) => req.ctx.actor!.id;

  /* ---------- member ---------- */
  def(app, { method: 'GET', path: '/me/billing', summary: 'My billing: verified paid orders, receipts, tax invoices, credit notes and refund requests', tag: 'billing', auth: 'member', feature: FEATURE }, async (req) => billing.memberBilling(req.ctx, me(req)));
  def(app, { method: 'GET', path: '/me/billing/documents/:id', summary: 'One of my billing documents', tag: 'billing', auth: 'member', feature: FEATURE }, async (req) => billing.memberDocument(req.ctx, param(req, 'id')));
  def(app, { method: 'POST', path: '/me/billing/documents/:id/file-token', summary: 'A 5-minute token to open my billing document (audited)', tag: 'billing', auth: 'member', feature: FEATURE, rateLimit: { max: 60, timeWindow: '1 minute' } }, async (req) => billing.documentFileToken(req.ctx, param(req, 'id')));
  def(app, { method: 'POST', path: '/me/orders/:id/refund-request', summary: 'Ask for a refund of my paid order, with a reason (an administrator decides)', tag: 'billing', auth: 'member', feature: FEATURE, body: refundRequestBody, rateLimit: { max: 10, timeWindow: '10 minutes' } }, async (req, reply) => {
    const i = parse(refundRequestBody, req.body);
    reply.code(201);
    return billing.createRefundRequest(req.ctx, param(req, 'id'), i.reason);
  });
  def(app, { method: 'POST', path: '/me/refund-requests/:id/withdraw', summary: 'Withdraw my open refund request', tag: 'billing', auth: 'member', feature: FEATURE }, async (req) => billing.withdrawRefundRequest(req.ctx, param(req, 'id')));

  /* ---------- administrators (orders.manage) ---------- */
  def(app, { method: 'GET', path: '/admin/billing/summary', summary: 'Billing set-up (tax invoices ready or the missing seller details), GST rate, open refund requests, document counts', tag: 'billing', auth: 'admin', permission: 'orders.manage', feature: FEATURE }, async (req) => billing.adminSummary(req.ctx));
  def(app, { method: 'GET', path: '/admin/billing/documents', summary: 'Billing documents, newest first (kind, status, memberId, orderId, q; cursor is the nextCursor of the page before); buyer address only with members.view_restricted', tag: 'billing', auth: 'admin', permission: 'orders.manage', feature: FEATURE, query: documentQuery }, async (req) => {
    const f = parse(documentQuery, query(req));
    return billing.adminDocuments(req.ctx, { kind: f.kind, status: f.status, memberId: f.memberId, orderId: f.orderId, q: f.q, ...pageParams(query(req), 100) });
  });
  def(app, { method: 'GET', path: '/admin/billing/documents/:id', summary: 'One billing document', tag: 'billing', auth: 'admin', permission: 'orders.manage', feature: FEATURE }, async (req) => billing.adminDocument(req.ctx, param(req, 'id')));
  def(app, { method: 'POST', path: '/admin/billing/documents/:id/file-token', summary: 'A 5-minute token to open a billing document (audited)', tag: 'billing', auth: 'admin', permission: 'orders.manage', feature: FEATURE }, async (req) => billing.documentFileToken(req.ctx, param(req, 'id')));
  def(app, { method: 'POST', path: '/admin/billing/documents/:id/void', summary: 'Void a tax invoice with a reason: a credit note cancels it; reissue replaces it with the current seller details', tag: 'billing', auth: 'admin', permission: 'orders.manage', feature: FEATURE, body: voidBody }, async (req) => {
    const i = parse(voidBody, req.body);
    return billing.voidDocument(req.ctx, param(req, 'id'), { reason: i.reason, reissue: i.reissue });
  });
  def(app, { method: 'POST', path: '/admin/billing/orders/:id/issue', summary: 'Issue the documents a verified paid order is missing (paid while billing was off, or an invoice voided earlier)', tag: 'billing', auth: 'admin', permission: 'orders.manage', feature: FEATURE, body: reasonBody }, async (req) => {
    const i = parse(reasonBody, req.body);
    return billing.issueMissing(req.ctx, param(req, 'id'), i.reason);
  });
  def(app, { method: 'GET', path: '/admin/refund-requests', summary: 'Refund requests, newest first (status, memberId; cursor is the nextCursor of the page before)', tag: 'billing', auth: 'admin', permission: 'orders.manage', feature: FEATURE, query: requestQuery }, async (req) => {
    const f = parse(requestQuery, query(req));
    return billing.adminRequests(req.ctx, { status: f.status, memberId: f.memberId, ...pageParams(query(req), 100) });
  });
  def(app, { method: 'POST', path: '/admin/refund-requests/:id/decide', summary: 'Approve (starts the refund: entitlements cancelled, programme ended) or decline a refund request, with a note for the member', tag: 'billing', auth: 'admin', permission: 'orders.manage', feature: FEATURE, body: decideBody }, async (req) => {
    const i = parse(decideBody, req.body);
    const id = param(req, 'id');
    const orderId = req.ctx.db.get<{ order_id: string }>("SELECT order_id FROM refund_requests WHERE id = ? AND status = 'requested'", [id])?.order_id;
    // laboratory bookings still open on the order need the vendor, so they are listed before and cancelled after (as /admin/orders/:id/refund does)
    const openBookings = i.decision === 'approve' && orderId ? orders.openBookingsForOrder(req.ctx, orderId) : [];
    const result = billing.decideRefundRequest(req.ctx, app.services.payments, id, { decision: i.decision, note: i.note });
    for (const bookingId of openBookings) {
      try { await bloodwork.cancel(req.ctx, app.services.vendor, bookingId, `order refunded: ${i.note}`); }
      catch (e) { openTask(req.ctx, { kind: 'failed_booking', title: `Booking ${bookingId} could not be cancelled after the refund`, detail: (e as Error).message, refType: 'booking', refId: bookingId }); }
    }
    if (i.decision === 'approve') await processPending(systemCtx(app.db, app.config)); // the credit note follows the completed refund
    return result;
  });

  /* ---------- the printable document (token only; no public URL points at a document) ---------- */
  def(app, { method: 'GET', path: '/billing/documents/file', summary: 'The printable billing document for a 5-minute token (checks the billing flag and access again as the token holder)', tag: 'billing', auth: 'none', query: tokenQuery, rateLimit: { max: 120, timeWindow: '1 minute' } }, async (req, reply) => {
    const { token } = parse(tokenQuery, query(req));
    const doc = billing.resolveDocumentToken(req.ctx, token);
    reply
      .header('cache-control', 'no-store')
      .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
      .header('content-disposition', `inline; filename="bioptime-${doc.kind.replace('_', '-')}-${doc.number.replace(/[^\w.-]+/g, '-')}.html"`)
      .type('text/html; charset=utf-8');
    return billingDocument(req.ctx, doc);
  });
}
