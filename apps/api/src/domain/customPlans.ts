/* Bespoke programmes: enquiry → review → scoping → approvals → proposal → acceptance → payment → activation. Nothing
   creates entitlements or activates a programme until the order is paid through the same webhook as a package. */
import { canMoveCustomPlan, CUSTOM_PLAN_TRANSITIONS, type CustomPlanState } from '@bioptime/domain';
import type { Ctx } from '../context.js';
import type { PaymentProvider } from '../adapters/payments.js';
import { ids } from '../lib/ids.js';
import { errors } from '../lib/errors.js';
import { sha256 } from '../lib/crypto.js';
import { addDays } from '../lib/time.js';
import { j } from '../db/db.js';
import { nextReference } from '../db/seq.js';
import { audit, emit } from './audit.js';
import { notify } from './notifications.js';
import { openTask } from './support.js';
import { getUserByEmail } from '../auth/service.js';
import { presentOrder, cancelOrder, gstIncluded, gstRateBp, type OrderRow } from './orders.js';

export type Proposal = { durationMonths?: number; durationLabel?: string; consultations?: number; bloodworkEntitlements?: number; priceInr?: number; services?: string[]; deliverables?: string[]; conditions?: string; reviewSchedule?: string; coachId?: string | null; notes?: string };

type RequestRow = { id: string; reference: string; member_id: string | null; contact_name: string; contact_email: string; contact_phone: string | null; status: CustomPlanState; goals: string; duration: string | null; budget_paise: number | null; notes: string | null; scope: string; proposal: string; approvals: string; assigned_coach_id: string | null; order_id: string | null; programme_id: string | null; owner_id: string | null; proposal_sent_at: string | null; expires_at: string | null; decided_at: string | null; created_at: string; updated_at: string; member_name: string | null; owner_name: string | null; coach_name: string | null };

export function present(ctx: Ctx, id: string) {
  const r = ctx.db.get<RequestRow>('SELECT r.*, m.name AS member_name, o.name AS owner_name, c.name AS coach_name FROM custom_plan_requests r LEFT JOIN users m ON m.id = r.member_id LEFT JOIN users o ON o.id = r.owner_id LEFT JOIN users c ON c.id = r.assigned_coach_id WHERE r.id = ?', [id]);
  if (!r) throw errors.notFound('Custom plan request');
  const events = ctx.db.all('SELECT e.*, u.name AS actor_name FROM custom_plan_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.request_id = ? ORDER BY e.at', [id]);
  const order = r.order_id ? ctx.db.get<OrderRow>('SELECT * FROM orders WHERE id = ?', [r.order_id]) : undefined;
  return { ...r, scope: j.out<Record<string, unknown>>(r.scope, {}), proposal: j.out<Proposal>(r.proposal, {}), approvals: j.out<string[]>(r.approvals, []), budgetInr: r.budget_paise === null ? null : r.budget_paise / 100, events, order: order ? presentOrder(ctx, order) : null, allowedNext: CUSTOM_PLAN_TRANSITIONS[r.status].filter((x) => x !== 'activated' && (ctx.actor?.role === 'member' || (x !== 'accepted' && x !== 'payment_pending'))) };
}

export function createRequest(ctx: Ctx, input: { memberId?: string | null; contactName: string; contactEmail: string; contactPhone?: string; goals: string; duration?: string; budgetInr?: number; notes?: string }) {
  const id = ids.customPlan();
  const now = ctx.now();
  // an account is linked only when the signed-in member makes the request: an email typed on a public form never selects one
  const memberId = input.memberId ?? null;
  ctx.db.tx(() => {
    ctx.db.insert('custom_plan_requests', { id, reference: nextReference(ctx.db, 'CPL'), member_id: memberId, contact_name: input.contactName, contact_email: input.contactEmail.toLowerCase(), contact_phone: input.contactPhone ?? null, status: 'enquiry_received', goals: input.goals, duration: input.duration ?? null, budget_paise: input.budgetInr ? Math.round(input.budgetInr * 100) : null, notes: input.notes ?? null, created_at: now, updated_at: now });
    ctx.db.insert('custom_plan_events', { id: ids.customPlanEvent(), request_id: id, from_state: null, to_state: 'enquiry_received', actor_id: ctx.actor?.id ?? null, note: 'Enquiry received', at: now });
    openTask(ctx, { kind: 'custom_plan_approval', title: `Bespoke plan enquiry from ${input.contactName}`, detail: input.goals.slice(0, 200), refType: 'custom_plan', refId: id });
    emit(ctx, 'CustomPlanRequested', { type: 'custom_plan', id }, { memberId });
    audit(ctx, 'custom_plan.create', { type: 'custom_plan', id }, null, { memberId });
  });
  return present(ctx, id);
}

const PROPOSAL_TERMS: Array<keyof Proposal> = ['priceInr', 'durationMonths', 'durationLabel', 'consultations', 'bloodworkEntitlements', 'services', 'deliverables', 'conditions', 'reviewSchedule'];
/** What an approval binds to: the commercial terms of the proposal, hashed in a fixed key order. */
export function proposalHash(p: Proposal): string { return sha256(JSON.stringify(PROPOSAL_TERMS.map((k) => [k, p[k] ?? null]))); }

export function transition(ctx: Ctx, id: string, to: CustomPlanState, input: { note?: string; proposal?: Proposal; scope?: Record<string, unknown>; approval?: string; ownerId?: string | null; coachId?: string | null } = {}) {
  return ctx.db.tx(() => {
    const r = ctx.db.get<{ id: string; status: CustomPlanState; member_id: string | null; contact_email: string; contact_name: string; proposal: string; approvals: string; reference: string; approved_hash: string | null; order_id: string | null }>('SELECT * FROM custom_plan_requests WHERE id = ?', [id]);
    if (!r) throw errors.notFound('Custom plan request');
    if (!canMoveCustomPlan(r.status, to)) throw errors.state(`A request that is ${r.status} cannot become ${to}`, { from: r.status, allowed: CUSTOM_PLAN_TRANSITIONS[r.status] });
    // 'activated' is written only by orders.activateOrder once the member's payment is verified; never by hand, from any state
    if (to === 'activated') throw errors.state('Activation happens through payment, not by hand', { code: 'ACTIVATION_VIA_PAYMENT' });
    // acceptance and the payment that follows are the member's own steps (accept()); nobody records them on the member's behalf
    if ((to === 'accepted' || to === 'payment_pending') && ctx.actor?.role !== 'member') throw errors.state('Acceptance is the member’s own step', { code: 'MEMBER_STEP' });
    const now = ctx.now();
    const proposal = { ...j.out<Proposal>(r.proposal, {}), ...(input.proposal ?? {}) };
    const approvals = j.out<string[]>(r.approvals, []);
    const hash = proposalHash(proposal);
    if (input.approval) approvals.push(`${input.approval} · ${ctx.actor?.name ?? 'system'} · ${now}`);
    const approvedHash = input.approval ? hash : r.approved_hash; // an approval binds to the proposal as it stands in this call
    // once a proposal has been sent, its terms change only by going back to scoping (and a fresh approval)
    const LOCKED: CustomPlanState[] = ['proposal_sent', 'accepted', 'payment_pending', 'activated', 'completed', 'declined'];
    if (input.proposal && LOCKED.includes(r.status) && proposalHash(proposal) !== proposalHash(j.out<Proposal>(r.proposal, {}))) throw errors.state('A sent proposal’s terms cannot change; move the request back to scoping first', { code: 'PROPOSAL_LOCKED' });
    if (to === 'proposal_sent') {
      if (!r.member_id) throw errors.state('This request was made without signing in, so no member account can accept it. Ask the person to sign in (or create an account) and send the request again from Bespoke in their Bioptime account.', { code: 'NOT_LINKED' });
      if (!proposal.priceInr || Math.round(proposal.priceInr * 100) < 100 || !proposal.durationLabel) throw errors.badRequest('A proposal needs a price of at least ₹1 and a duration before it is sent', 'PROPOSAL_INCOMPLETE');
      if (!approvals.length) throw errors.state('An internal approval must be recorded before a proposal is sent', { code: 'APPROVAL_REQUIRED' });
      if (approvedHash !== hash) throw errors.state('The proposal changed after it was approved; record a fresh approval for these terms', { code: 'APPROVAL_STALE' });
    }
    if (to === 'accepted' && ctx.actor?.role === 'member' && r.member_id !== ctx.actor.id) throw errors.forbidden();
    ctx.db.update('custom_plan_requests', id, { status: to, proposal: j.in(proposal), approvals: j.in(approvals), approved_hash: input.approval ? hash : undefined, scope: input.scope ? j.in(input.scope) : undefined, owner_id: input.ownerId === undefined ? undefined : input.ownerId, assigned_coach_id: input.coachId === undefined ? (proposal.coachId ?? undefined) : input.coachId, proposal_sent_at: to === 'proposal_sent' ? now : undefined, expires_at: to === 'proposal_sent' ? addDays(now, 14) : undefined, decided_at: to === 'accepted' || to === 'declined' ? now : undefined, updated_at: now });
    // a declined or expired request that was waiting for payment cannot be paid any more
    if (r.status === 'payment_pending' && (to === 'declined' || to === 'expired') && r.order_id) { const o = ctx.db.get<{ status: string }>('SELECT status FROM orders WHERE id = ?', [r.order_id]); if (o?.status === 'pending_payment') cancelOrder(ctx, r.order_id, `Bespoke request ${to}`); }
    ctx.db.insert('custom_plan_events', { id: ids.customPlanEvent(), request_id: id, from_state: r.status, to_state: to, actor_id: ctx.actor?.id ?? null, note: input.note ?? null, at: now });
    audit(ctx, `custom_plan.${to}`, { type: 'custom_plan', id }, input.note ?? null, { from: r.status });
    if (to === 'proposal_sent' && r.member_id) notify(ctx, { userId: r.member_id, category: 'custom_plan', title: 'Your bespoke proposal is ready', body: `${proposal.durationLabel}, ${proposal.consultations ?? 0} consultations, ${proposal.bloodworkEntitlements ?? 0} blood tests, ₹${proposal.priceInr}. Review it under Bespoke in your Bioptime account and accept it within 14 days.`, data: { customPlanId: id } });
    if (to === 'awaiting_internal_approval') openTask(ctx, { kind: 'custom_plan_approval', title: `Bespoke proposal ${r.reference} awaits approval`, detail: `₹${proposal.priceInr ?? '—'}, ${proposal.durationLabel ?? '—'}`, refType: 'custom_plan', refId: id });
    return present(ctx, id);
  });
}

/** What a member sees of their own request: the request, the terms once a proposal was sent, and the order. Never the
    internal approvals, events, notes, scope, owner or the draft terms still being scoped. */
export function memberView(ctx: Ctx, id: string) {
  const r = present(ctx, id) as Record<string, unknown> & { proposal: Proposal };
  const p = r.proposal;
  const sent = !!r.proposal_sent_at;
  return {
    id: r.id, reference: r.reference, status: r.status, goals: r.goals, duration: r.duration, budgetInr: r.budgetInr, created_at: r.created_at, updated_at: r.updated_at,
    expires_at: r.expires_at, proposal_sent_at: r.proposal_sent_at ?? null, order: r.order,
    proposal: sent ? { durationMonths: p.durationMonths, durationLabel: p.durationLabel, consultations: p.consultations, bloodworkEntitlements: p.bloodworkEntitlements, priceInr: p.priceInr, services: p.services, deliverables: p.deliverables, conditions: p.conditions, reviewSchedule: p.reviewSchedule } : {},
  };
}

/** The member accepts: an order is created for the proposal; paying it activates the plan through the usual webhook. */
export function accept(ctx: Ctx, provider: PaymentProvider, id: string) {
  // an expired proposal is recorded as expired before refusing (inside the transaction below the refusal would roll it back)
  const pre = ctx.db.get<{ status: CustomPlanState; expires_at: string | null }>('SELECT status, expires_at FROM custom_plan_requests WHERE id = ?', [id]);
  if (pre && pre.status === 'proposal_sent' && pre.expires_at && pre.expires_at < ctx.now()) { transition(ctx, id, 'expired', { note: 'Proposal expired before acceptance' }); throw errors.state('This proposal has expired; ask for a refreshed one', { code: 'EXPIRED' }); }
  return ctx.db.tx(() => {
    const r = ctx.db.get<{ id: string; status: CustomPlanState; member_id: string | null; proposal: string; expires_at: string | null; reference: string }>('SELECT * FROM custom_plan_requests WHERE id = ?', [id]);
    if (!r) throw errors.notFound('Custom plan request');
    if (!r.member_id) throw errors.state('This request is not linked to your account; send it again from Bespoke in your Bioptime account while signed in', { code: 'NOT_LINKED' });
    if (r.expires_at && r.expires_at < ctx.now()) { transition(ctx, id, 'expired', { note: 'Proposal expired before acceptance' }); throw errors.state('This proposal has expired; ask for a refreshed one'); }
    transition(ctx, id, 'accepted', { note: 'Accepted by the member' });
    const proposal = j.out<Proposal>(r.proposal, {});
    const total = Math.round((proposal.priceInr ?? 0) * 100);
    if (total < 100) throw errors.state('This proposal has no price; ask Bioptime for a refreshed one', { code: 'NO_PRICE' });
    const now = ctx.now();
    const orderId = ids.order();
    // GST included in the proposal's price, at the configured rate (setting gst_rate_bp), recorded on the order as
    // package orders record it (orders.ts createCheckout), so its receipt and invoice use the rate the order was made at
    const rateBp = gstRateBp(ctx);
    const gst = gstIncluded(total, rateBp);
    ctx.db.insert('orders', { id: orderId, reference: nextReference(ctx.db, 'PAY'), member_id: r.member_id, package_version_id: null, custom_plan_id: id, status: 'pending_payment', amount_paise: total - gst, gst_paise: gst, total_paise: total, currency: 'INR', metadata: j.in({ packageName: `Bespoke plan ${r.reference}`, customPlanId: id, gstRateBp: rateBp, terms: { durationMonths: proposal.durationMonths ?? null, consultations: proposal.consultations ?? 0, bloodworkEntitlements: proposal.bloodworkEntitlements ?? 0 } }), created_at: now, updated_at: now });
    const order = ctx.db.get<OrderRow>('SELECT * FROM orders WHERE id = ?', [orderId])!;
    const checkout = provider.createCheckout({ id: orderId, reference: order.reference, totalPaise: total, currency: 'INR' }, ctx.config.PUBLIC_ORIGIN);
    ctx.db.insert('payments', { id: ids.payment(), order_id: orderId, provider: provider.name, provider_ref: checkout.providerRef, checkout_id: checkout.checkoutId, status: 'created', amount_paise: total, currency: 'INR', signature_verified: 0, raw: j.in({ checkout }), created_at: now, updated_at: now });
    transition(ctx, id, 'payment_pending', { note: `Order ${order.reference} created` });
    ctx.db.update('custom_plan_requests', id, { order_id: orderId });
    return { request: memberView(ctx, id), order: presentOrder(ctx, order), checkout: { checkoutId: checkout.checkoutId, url: checkout.url, simulated: checkout.simulated } };
  });
}

export function list(ctx: Ctx, opts: { status?: string; memberId?: string; limit: number }) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.status) { where.push('status = ?'); params.push(opts.status); }
  if (opts.memberId) { where.push('member_id = ?'); params.push(opts.memberId); }
  return ctx.db.all<{ id: string }>(`SELECT id FROM custom_plan_requests ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY updated_at DESC LIMIT ?`, [...params, opts.limit]).map((r) => present(ctx, r.id));
}

export function expireProposals(ctx: Ctx): number {
  const rows = ctx.db.all<{ id: string }>("SELECT id FROM custom_plan_requests WHERE status IN ('proposal_sent','accepted') AND expires_at IS NOT NULL AND expires_at < ?", [ctx.now()]);
  for (const r of rows) transition(ctx, r.id, 'expired', { note: 'Proposal expired' });
  return rows.length;
}
