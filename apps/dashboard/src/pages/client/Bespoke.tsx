import React, { useState } from 'react';
import { Link } from '../../lib/nav';
import { api, ApiRequestError } from '../../lib/api';
import { fmtDate, fmtDateTime, fmtInr, label } from '../../lib/format';
import { Alert, Button, Card, CardHead, ConfirmDialog, Empty, Field, Pill, Select, Skeleton, Textarea, useApi, errorText } from '../../ui';

/* What each bespoke request state (packages/domain CUSTOM_PLAN_STATES) means for the member. */
const STATUS: Record<string, { label: string; text: string }> = {
  enquiry_received: { label: 'Received', text: 'Bioptime has your request and reviews it before anything is scoped.' },
  under_review: { label: 'Under review', text: 'Bioptime is reviewing your request.' },
  scoping: { label: 'Being scoped', text: 'Bioptime is working out the length, blood tests and consultations.' },
  awaiting_professional_input: { label: 'Being scoped', text: 'Bioptime is checking the scope with a professional before a proposal is drafted.' },
  awaiting_internal_approval: { label: 'Awaiting approval', text: 'A proposal is drafted. It needs Bioptime’s internal approval before it is sent to you.' },
  proposal_sent: { label: 'Proposal ready', text: 'Read the terms, then accept and pay, or decline.' },
  accepted: { label: 'Accepted', text: 'You accepted the proposal; the order to pay is being prepared.' },
  payment_pending: { label: 'Waiting for payment', text: 'You accepted the proposal. It starts once the payment is confirmed.' },
  activated: { label: 'Active', text: 'Paid and active. It shows under My program.' },
  completed: { label: 'Completed', text: 'This bespoke plan has ended.' },
  declined: { label: 'Declined', text: 'This request is closed. Nothing was charged.' },
  expired: { label: 'Expired', text: 'The proposal lapsed before it was accepted and paid for, so the request closed. Nothing was charged.' },
};
const DURATIONS = ['1 to 3 months', '3 to 6 months', '6 to 12 months', 'A year or more'];
const TERMS_SHOWN = ['proposal_sent', 'accepted', 'payment_pending', 'activated', 'completed'];

const isExpired = (r: any) => !!r.expires_at && new Date(r.expires_at).getTime() < Date.now();
const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s) => typeof s === 'string' && s.trim()) : []);

/** Bespoke: the member's own requests for a plan scoped with them, the proposals Bioptime sends, and paying for an accepted one. */
export function Bespoke() {
  const plans = useApi(() => api.get('/me/custom-plans'), []);
  const config = useApi(() => api.get('/public/config'), []);
  const [accepting, setAccepting] = useState<any>(null);
  const [declining, setDeclining] = useState<any>(null);
  const [pending, setPending] = useState<{ order: any; checkoutId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  const support: string = (config.data as any)?.supportEmail ?? 'the support address';
  const items = ((plans.data as any)?.items ?? []) as any[];

  const accept = async (r: any) => {
    setMsg(null);
    try {
      const res = await api.post<any>(`/me/custom-plans/${r.id}/accept`);
      if (res.checkout?.simulated) { setPending({ order: res.order, checkoutId: res.checkout.checkoutId }); setMsg({ kind: 'info', text: `Order ${res.order.reference} created for ${fmtInr(res.order.totalInr)}. It is not paid yet.` }); }
      else if (res.checkout?.url) { setMsg({ kind: 'info', text: `Order ${res.order.reference} created. Taking you to the payment provider…` }); window.location.assign(res.checkout.url); }
      else setMsg({ kind: 'error', text: `Order ${res.order.reference} was created, but no payment page came back for this provider. Write to ${support} quoting it.` });
    } finally { plans.reload(); }
  };
  const simulate = async (outcome: 'captured' | 'failed') => {
    if (!pending) return;
    setBusy(true); setMsg(null);
    try { const r = await api.post<any>('/payments/simulator/complete', { checkoutId: pending.checkoutId, outcome }); const o = r.order; setPending(null); setMsg(o.status === 'activated' || o.status === 'paid' ? { kind: 'success', text: `Payment confirmed. Order ${o.reference} is ${label(o.status)}; your bespoke plan is active and shows under My program.` } : { kind: 'error', text: `The provider reported the payment as ${label(o.status)}. Nothing was charged.` }); plans.reload(); }
    catch (e) { setMsg({ kind: 'error', text: errorText(e) }); } finally { setBusy(false); }
  };

  return <div className="stack">
    <div className="pageHead"><div><h1>Bespoke</h1><p className="sub">A plan scoped with you and priced per proposal. Bioptime reviews each request, and every proposal is approved internally before it reaches you. Nothing is charged until you accept a proposal and pay for it.</p></div></div>
    {msg && <Alert kind={msg.kind === 'info' ? 'info' : msg.kind}>{msg.text}</Alert>}
    {pending && <Card accent><CardHead eyebrow="Payment" title={`Order ${pending.order.reference}`} /><p className="small">Choose how the payment provider should answer for {fmtInr(pending.order.totalInr)}.</p><div className="bp-card-foot"><Button variant="primary" size="sm" busy={busy} onClick={() => simulate('captured')}>Simulate success</Button><Button size="sm" disabled={busy} onClick={() => simulate('failed')}>Simulate failure</Button></div></Card>}
    <div className="grid">
      <div className="span8"><div className="stack">
        {plans.error ? <Alert kind="error">{plans.error}</Alert> : !plans.data ? <Skeleton rows={6} /> : items.length ? items.map((r) => <Request key={r.id} r={r} support={support} payingId={pending?.order?.id} onAccept={() => setAccepting(r)} onDecline={() => setDeclining(r)} onPay={(order) => { setMsg(null); setPending({ order, checkoutId: order.payment.checkoutId }); }} />)
          : <Card><Empty title="No bespoke requests yet" body="Ask for one with the form. A proposal appears here once Bioptime has scoped and approved it." /></Card>}
      </div></div>
      <div className="span4"><RequestForm onSent={() => plans.reload()} /></div>
    </div>
    <p className="muted small">{(config.data as any)?.payments === 'simulator' ? 'Payments here are simulated; no money moves.' : 'Payments are handled by the provider; Bioptime never sees your card or UPI details.'} Cancellations and refunds follow the terms.</p>
    <ConfirmDialog open={!!accepting} onClose={() => setAccepting(null)} title={accepting ? `Accept proposal ${accepting.reference}?` : ''} confirmLabel="Accept and continue to payment" body={accepting ? `${fmtInr(accepting.proposal?.priceInr)} including GST${accepting.proposal?.durationLabel ? ` for ${accepting.proposal.durationLabel}` : ''}. Accepting creates an order for this amount and takes you to the payment step. Nothing is charged until the payment is confirmed.` : undefined} onConfirm={async () => { if (accepting) await accept(accepting); }} />
    <ConfirmDialog open={!!declining} onClose={() => setDeclining(null)} title={declining ? `Decline proposal ${declining.reference}?` : ''} danger confirmLabel="Decline" note="Anything Bioptime should know" body="The request is closed and nothing is charged. You can send a new request at any time." onConfirm={async (note) => { if (!declining) return; try { await api.post(`/me/custom-plans/${declining.id}/decline`, note ? { note: String(note).slice(0, 500) } : {}); setMsg({ kind: 'success', text: `Proposal ${declining.reference} declined. Nothing was charged.` }); } finally { plans.reload(); } }} />
  </div>;
}

function Request({ r, support, payingId, onAccept, onDecline, onPay }: { r: any; support: string; payingId?: string; onAccept: () => void; onDecline: () => void; onPay: (order: any) => void }) {
  const busyPaying = !!payingId; // one payment at a time: no second order while a demo payment is open
  const s = STATUS[r.status] ?? { label: label(r.status), text: '' };
  const p = r.proposal ?? {};
  const open = r.status === 'proposal_sent' && !isExpired(r);
  const o = r.order;
  const services = strings(p.services), deliverables = strings(p.deliverables);
  const lapsed = r.status === 'expired' || (r.status === 'proposal_sent' && !open);
  const text = r.status === 'proposal_sent' && !open ? `This proposal could be accepted until ${fmtDateTime(r.expires_at)}. Nothing was charged.` : s.text;
  return <Card accent={open}>
    <CardHead eyebrow={`${r.reference} · requested ${fmtDate(r.created_at)}`} title={open ? 'Your proposal is ready' : r.status === 'activated' || r.status === 'completed' ? 'Your bespoke plan' : 'Your request'} right={<Pill status={lapsed ? 'expired' : r.status}>{lapsed ? 'Expired' : s.label}</Pill>} />
    <p className="small">{text}{lapsed ? ` Send a new request, or write to ${support} quoting ${r.reference} for a refreshed proposal.` : ''}</p>
    <dl className="kv" style={{ marginTop: 10 }}><dt>Your goals</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{r.goals}</dd>{r.duration ? <><dt>Length you asked for</dt><dd>{r.duration}</dd></> : null}</dl>
    {TERMS_SHOWN.includes(r.status) && p.priceInr ? <div style={{ marginTop: 12 }}><span className="bp-eyebrow">{r.status === 'proposal_sent' ? 'Proposal' : 'Accepted terms'}</span>
      <dl className="kv" style={{ marginTop: 6 }}>
        <dt>Price</dt><dd><b>{fmtInr(p.priceInr)}</b> including GST</dd>
        <dt>Duration</dt><dd>{p.durationLabel ?? (p.durationMonths ? `${p.durationMonths} months` : '—')}</dd>
        <dt>Consultations</dt><dd>{p.consultations ?? 0}</dd>
        <dt>Blood tests</dt><dd>{p.bloodworkEntitlements ?? 0}</dd>
        {services.length ? <><dt>Services</dt><dd>{services.join(', ')}</dd></> : null}
        {deliverables.length ? <><dt>Deliverables</dt><dd>{deliverables.join(', ')}</dd></> : null}
        {p.reviewSchedule ? <><dt>Reviews</dt><dd>{p.reviewSchedule}</dd></> : null}
        {p.conditions ? <><dt>Conditions</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{p.conditions}</dd></> : null}
        {r.status === 'proposal_sent' && r.expires_at ? <><dt>Open until</dt><dd>{fmtDateTime(r.expires_at)}</dd></> : null}
      </dl></div> : null}
    {o ? <div className="row between" style={{ marginTop: 12 }}><div><b style={{ color: 'var(--bp-color-text-primary)' }}>Order {o.reference}</b><div className="small">{fmtInr(o.totalInr)} · {fmtDateTime(o.activatedAt ?? o.paidAt ?? o.createdAt)}{o.payment?.simulated ? ' · simulated' : ''}</div></div><Pill status={o.status} /></div> : null}
    {r.status === 'payment_pending' && o?.status === 'pending_payment' ? (o.payment?.simulated && o.payment.checkoutId ? (payingId === o.id ? null : <div className="bp-card-foot"><Button variant="primary" size="sm" onClick={() => onPay(o)}>Continue to payment</Button></div>) : <p className="small" style={{ marginTop: 8 }}>Finish the payment on the provider’s page. If you closed it, write to {support} quoting order {o.reference}.</p>) : null}
    {r.status === 'payment_pending' && o?.status === 'failed' ? <p className="small" style={{ marginTop: 8 }}>The provider reported the payment as failed, so nothing was charged. Write to {support} quoting {r.reference} for a refreshed proposal.</p> : null}
    {r.status === 'payment_pending' && o && !['pending_payment', 'failed', 'paid', 'activated'].includes(o.status) ? <p className="small" style={{ marginTop: 8 }}>This order is {label(o.status)}. Write to {support} quoting {r.reference} and the Bioptime team will sort it out with you.</p> : null}
    {r.status === 'activated' ? <div className="bp-card-foot"><Link className="bp-btn bp-btn-secondary bp-btn-sm" to="/program">Open My program</Link></div> : null}
    {open ? <div className="bp-card-foot"><Button variant="primary" size="sm" onClick={onAccept} disabled={busyPaying}>Accept and pay {fmtInr(p.priceInr)}</Button><Button size="sm" variant="tertiary" onClick={onDecline}>Decline</Button></div> : null}
  </Card>;
}

function RequestForm({ onSent }: { onSent: () => void }) {
  const [goals, setGoals] = useState('');
  const [duration, setDuration] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(null);
    if (goals.trim().length < 5) { setErrs({ goals: 'A few words about your goals helps Bioptime scope the plan.' }); return; }
    setBusy(true); setErrs({});
    try {
      const r = await api.post<any>('/me/custom-plans', { goals: goals.trim(), ...(duration ? { duration } : {}) });
      setMsg({ kind: 'success', text: `Request ${r.reference} received and linked to your account. Bioptime reviews it; a proposal appears on this page once it has been approved internally. Nothing is charged until you accept one and pay.` });
      setGoals(''); setDuration(''); onSent();
    } catch (ex) {
      if (ex instanceof ApiRequestError) { const d = ex.details as any; const issues: any[] = Array.isArray(d) ? d : Array.isArray(d?.issues) ? d.issues : []; const fe: Record<string, string> = {}; for (const i of issues) { const k = (Array.isArray(i.path) ? String(i.path[0] ?? '') : String(i.path ?? '')).split('.')[0]; if (k && !fe[k]) fe[k] = i.message; } if (issues.length) setErrs(fe); }
      setMsg({ kind: 'error', text: errorText(ex) });
    } finally { setBusy(false); }
  };
  return <Card><CardHead eyebrow="Ask" title="Request a bespoke plan" />
    <form className="form" onSubmit={send}>
      <Field label="Your goals, in your own words" error={errs.goals} hint="What you want to change, what you have tried, what gets in the way."><Textarea value={goals} onChange={(e) => setGoals(e.target.value)} maxLength={2000} rows={5} /></Field>
      <Field label="How long are you thinking?" optional error={errs.duration}><Select value={duration} onChange={(e) => setDuration(e.target.value)}><option value="">Not sure yet</option>{DURATIONS.map((d) => <option key={d} value={d}>{d}</option>)}</Select></Field>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <div><Button variant="primary" type="submit" busy={busy}>Ask for a proposal</Button></div>
      <p className="muted small">Please don’t include medical records or test results here. Bioptime may write to you with questions before scoping.</p>
    </form>
  </Card>;
}
