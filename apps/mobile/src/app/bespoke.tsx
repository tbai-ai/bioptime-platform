/* Bespoke (S9; opened from the Store's dashed Bespoke card and from notifications about a request): a plan scoped with
   the member and priced per proposal, in the overlay chrome. Every sentence of the earlier screen stays word for word.
   - The coaching photo band at the top fades out before the first card (no name or value shares it).
   - The member's requests, newest first: reference and date, the state in words (Pill), what it means, the goals and
     length they asked for, the proposal's terms once one is sent (price, duration, consultations, blood tests,
     services, deliverables, reviews, conditions, the date it is open until), the order and its payment.
   - A proposal can be accepted (a confirmation, then POST /me/custom-plans/:id/accept creates the order and the payment
     step) or declined with an optional note; nothing is charged until the payment is confirmed.
   - The payment step is the plain "Payment" panel: with the simulator, its two buttons tell the provider to capture or
     fail the payment; a real provider's page opens in the browser.
   - "Request a bespoke plan": goals in the member's own words and an optional length.
   An active bespoke plan opens Train › Plan. */
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React, { useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Alert } from '@/lib/alert';
import { ApiError, errorText, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtDateTime, inr, label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import {
  Button, EmptyState, ErrorState, Eyebrow, Field, FilterChip, fx, GlassCard, Input, invalidate, KVRow, Notice, Overlay, Photo, Pill, Reveal, Scrim,
  Skeleton, StaleBanner, statusTone, T, useFocusRefresh,
} from '@/fx';
import { largeText } from '@/fx/layout';

/* What each bespoke request state (packages/domain CUSTOM_PLAN_STATES) means for the member; the portal's Bespoke page says the same. */
const STATUS: Record<string, { label: string; text: string }> = {
  enquiry_received: { label: 'Received', text: 'Bioptime has your request and reviews it before anything is scoped.' },
  under_review: { label: 'Under review', text: 'Bioptime is reviewing your request.' },
  scoping: { label: 'Being scoped', text: 'Bioptime is working out the length, blood tests and consultations.' },
  awaiting_professional_input: { label: 'Being scoped', text: 'Bioptime is checking the scope with a professional before a proposal is drafted.' },
  awaiting_internal_approval: { label: 'Awaiting approval', text: 'A proposal is drafted. It needs Bioptime’s internal approval before it is sent to you.' },
  proposal_sent: { label: 'Proposal ready', text: 'Read the terms, then accept and pay, or decline.' },
  accepted: { label: 'Accepted', text: 'You accepted the proposal; the order to pay is being prepared.' },
  payment_pending: { label: 'Waiting for payment', text: 'You accepted the proposal. It starts once the payment is confirmed.' },
  activated: { label: 'Active', text: 'Paid and active. It shows under the Plan tab.' },
  completed: { label: 'Completed', text: 'This bespoke plan has ended.' },
  declined: { label: 'Declined', text: 'This request is closed. Nothing was charged.' },
  expired: { label: 'Expired', text: 'The proposal lapsed before it was accepted and paid for, so the request closed. Nothing was charged.' },
};
const DURATIONS = ['1 to 3 months', '3 to 6 months', '6 to 12 months', 'A year or more'];
const TERMS_SHOWN = ['proposal_sent', 'accepted', 'payment_pending', 'activated', 'completed'];

const isExpired = (r: any) => !!r.expires_at && new Date(r.expires_at).getTime() < Date.now();
const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s) => typeof s === 'string' && s.trim()) : []);

export default function Bespoke() {
  const router = useRouter();
  // a pair of buttons side by side, or one over the other on a narrow phone or at a large text size, where half a row
  // broke and cut their labels ('Simula/te suc…', SWB-06)
  const { width, fontScale } = useWindowDimensions();
  const stack = largeText(fontScale) || width < 360;
  const { config } = useAuth();
  const plans = useLoad<any>('custom-plans', () => get('/me/custom-plans'), []);
  useFocusRefresh(plans.reload);
  const [goals, setGoals] = useState('');
  const [duration, setDuration] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [pending, setPending] = useState<{ order: any; checkoutId: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const support = config?.supportEmail ?? 'the support address';
  const items: any[] = plans.data?.items ?? [];

  const accept = (r: any) => Alert.alert(`Accept proposal ${r.reference}?`, `${inr(r.proposal?.priceInr)} including GST${r.proposal?.durationLabel ? ` for ${r.proposal.durationLabel}` : ''}. Accepting creates an order for this amount and takes you to the payment step. Nothing is charged until the payment is confirmed.`, [{ text: 'Not now', style: 'cancel' }, { text: 'Accept', onPress: async () => {
    setBusy(r.id); setMsg(null);
    try {
      const res = await post<any>(`/me/custom-plans/${r.id}/accept`);
      if (res.checkout?.simulated) { setPending({ order: res.order, checkoutId: res.checkout.checkoutId }); setMsg({ kind: 'info', text: `Order ${res.order.reference} created for ${inr(res.order.totalInr)}. It is not paid yet.` }); }
      else if (res.checkout?.url) await WebBrowser.openBrowserAsync(res.checkout.url);
      else setMsg({ kind: 'error', text: `Order ${res.order.reference} was created, but no payment page came back for this provider. Write to ${support} quoting it.` });
    } catch (e) { setMsg({ kind: 'error', text: errorText(e) }); } finally { setBusy(null); await plans.reload(); }
  } }]);
  const simulate = async (outcome: 'captured' | 'failed') => {
    if (!pending) return;
    setBusy('sim'); setMsg(null);
    try { const r = await post<any>('/payments/simulator/complete', { checkoutId: pending.checkoutId, outcome }); const o = r.order; setPending(null); setMsg(o.status === 'activated' || o.status === 'paid' ? { kind: 'success', text: `Payment confirmed. Order ${o.reference} is ${label(o.status).toLowerCase()}; your bespoke plan is active and shows under the Plan tab.` } : { kind: 'error', text: `The provider reported the payment as ${label(o.status).toLowerCase()}. Nothing was charged.` }); await plans.reload(); invalidate(['me', 'programme', 'orders']); }
    catch (e) { setMsg({ kind: 'error', text: errorText(e) }); } finally { setBusy(null); }
  };
  const decline = async (r: any) => {
    setBusy(r.id); setMsg(null);
    try { await post(`/me/custom-plans/${r.id}/decline`, note.trim() ? { note: note.trim() } : {}); setDeclining(null); setNote(''); setMsg({ kind: 'success', text: `Proposal ${r.reference} declined. Nothing was charged.` }); }
    catch (e) { setMsg({ kind: 'error', text: errorText(e) }); } finally { setBusy(null); await plans.reload(); }
  };
  const send = async () => {
    setSent(null);
    if (goals.trim().length < 5) { setErrs({ goals: 'A few words about your goals helps Bioptime scope the plan.' }); return; }
    setSending(true); setErrs({});
    try {
      const r = await post<any>('/me/custom-plans', { goals: goals.trim(), ...(duration ? { duration } : {}) });
      setSent({ kind: 'success', text: `Request ${r.reference} received and linked to your account. Bioptime reviews it; a proposal appears on this screen once it has been approved internally. Nothing is charged until you accept one and pay.` });
      setGoals(''); setDuration(''); await plans.reload();
    } catch (e) { if (e instanceof ApiError) setErrs(e.fieldErrors()); setSent({ kind: 'error', text: errorText(e) }); } finally { setSending(false); }
  };

  const hero = <View style={styles.band} pointerEvents="none">
    <Photo slot="store.bespoke" opacity={0.45} decorative style={StyleSheet.absoluteFill} />
    <Scrim kind="stickyCta" style={StyleSheet.absoluteFill} />
  </View>;

  return <Overlay title="Bespoke" subtitle="A plan scoped with you" fallback="/(tabs)/store" hero={hero}>
    <T v="body" color={fx.ink.a80} style={styles.intro}>A plan scoped with you and priced per proposal. Bioptime reviews each request, and every proposal is approved internally before it reaches you. Nothing is charged until you accept a proposal and pay for it.</T>
    <StaleBanner at={plans.stale} />
    <ErrorState error={plans.error} onRetry={plans.reload} />
    {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
    {pending ? <GlassCard variant="three" borderColor={fx.red.a20}>
      <Eyebrow>Payment</Eyebrow>
      <T v="body" color={fx.ink.a70} style={styles.payText}>{`Choose how the payment provider should answer for order ${pending.order.reference} (${inr(pending.order.totalInr)}).`}</T>
      <View style={stack ? styles.stack : styles.row}>
        <Button title="Simulate success" small shape="flow" commit onPress={() => simulate('captured')} busy={busy === 'sim'} style={stack ? undefined : styles.flex} />
        <Button title="Simulate failure" small variant="soft" onPress={() => simulate('failed')} disabled={busy === 'sim'} style={stack ? undefined : styles.flex} />
      </View>
    </GlassCard> : null}

    {plans.loading && !plans.data ? <Skeleton height={220} radius={fx.radius.three} /> : null}
    {plans.data ? (items.length ? items.map((r, i) => {
      const s = STATUS[r.status] ?? { label: label(r.status), text: '' };
      const p = r.proposal ?? {};
      const open = r.status === 'proposal_sent' && !isExpired(r);
      const lapsed = r.status === 'expired' || (r.status === 'proposal_sent' && !open);
      const o = r.order;
      const services = strings(p.services), deliverables = strings(p.deliverables);
      const text = r.status === 'proposal_sent' && !open ? `This proposal could be accepted until ${fmtDateTime(r.expires_at)}. Nothing was charged.` : s.text;
      return <Reveal key={r.id} mount index={i}>
        <GlassCard variant="three" borderColor={open ? fx.red.a30 : undefined} testID={`bespoke-${r.reference}`}>
          <View style={styles.head}>
            <Eyebrow kind="label" style={styles.flex}>{r.reference}</Eyebrow>
            <Pill tone={statusTone(lapsed ? 'expired' : r.status === 'proposal_sent' ? 'pending' : r.status === 'payment_pending' ? 'pending_payment' : r.status)}>{lapsed ? 'Expired' : s.label}</Pill>
          </View>
          <T v="card24" style={styles.title}>{open ? 'Your proposal is ready' : r.status === 'activated' || r.status === 'completed' ? 'Your bespoke plan' : 'Your request'}</T>
          <T v="caption" color={fx.ink.a50} style={styles.when}>{`Requested ${fmtDate(r.created_at)}`}</T>
          <T v="body" color={fx.ink.a70}>{text}{lapsed ? ` Send a new request, or write to ${support} quoting ${r.reference} for a refreshed proposal.` : ''}</T>
          <View style={styles.terms}>
            <Term label="Your goals" value={r.goals} />
            {r.duration ? <Term label="Length you asked for" value={r.duration} /> : null}
          </View>
          {TERMS_SHOWN.includes(r.status) && p.priceInr ? <View style={styles.proposal}>
            <Eyebrow kind="label" style={styles.proposalTitle}>{r.status === 'proposal_sent' ? 'Proposal' : 'Accepted terms'}</Eyebrow>
            <KVRow label="Price" value={`${inr(p.priceInr)} including GST`} />
            <KVRow label="Duration" value={p.durationLabel ?? (p.durationMonths ? `${p.durationMonths} months` : '—')} />
            <KVRow label="Consultations" value={String(p.consultations ?? 0)} />
            <KVRow label="Blood tests" value={String(p.bloodworkEntitlements ?? 0)} divider={!!(services.length || deliverables.length || p.reviewSchedule || p.conditions || (r.status === 'proposal_sent' && r.expires_at))} />
            {services.length ? <Term label="Services" value={services.join(', ')} /> : null}
            {deliverables.length ? <Term label="Deliverables" value={deliverables.join(', ')} /> : null}
            {p.reviewSchedule ? <Term label="Reviews" value={String(p.reviewSchedule)} /> : null}
            {p.conditions ? <Term label="Conditions" value={String(p.conditions)} /> : null}
            {r.status === 'proposal_sent' && r.expires_at ? <Term label="Open until" value={fmtDateTime(r.expires_at)} /> : null}
          </View> : null}
          {o ? <View style={styles.proposal}>
            <KVRow label="Order" value={`${o.reference} · ${inr(o.totalInr)}`} />
            <KVRow label="Payment" value={label(o.status)} divider={false} />
          </View> : null}
          {r.status === 'payment_pending' && o?.status === 'pending_payment' ? (o.payment?.simulated && o.payment.checkoutId ? (pending?.order?.id === o.id ? null : <Button title="Continue to the payment" small shape="flow" style={styles.action} onPress={() => { setMsg(null); setPending({ order: o, checkoutId: o.payment.checkoutId }); }} />) : <T v="bodySm" color={fx.ink.a60} style={styles.action}>{`Finish the payment on the provider's page. If you closed it, write to ${support} quoting order ${o.reference}.`}</T>) : null}
          {r.status === 'payment_pending' && o?.status === 'failed' ? <T v="bodySm" color={fx.ink.a60} style={styles.action}>{`The provider reported the payment as failed, so nothing was charged. Write to ${support} quoting ${r.reference} for a refreshed proposal.`}</T> : null}
          {r.status === 'activated' ? <Button title="Open the plan" small variant="soft" style={styles.action} onPress={() => router.push('/(tabs)/train?view=plan')} /> : null}
          {open && declining !== r.id ? <View style={[styles.row, styles.action]}>
            <Button title={`Accept and pay ${inr(p.priceInr)}`} small shape="flow" commit onPress={() => accept(r)} busy={busy === r.id} disabled={!!busy || !!pending} style={styles.grow} />
            <Button title="Decline" small variant="soft" full={false} onPress={() => { setDeclining(r.id); setNote(''); }} disabled={!!busy} />
          </View> : null}
          {open && declining === r.id ? <View style={styles.decline}>
            <T v="bodySm" color={fx.ink.a80}>The request is closed and nothing is charged. You can send a new request at any time.</T>
            <Field label="Anything Bioptime should know (optional)"><Input value={note} onChangeText={setNote} multiline maxLength={500} style={styles.noteInput} /></Field>
            <View style={stack ? styles.stack : styles.row}>
              <Button title="Decline proposal" small variant="redGlass" onPress={() => decline(r)} busy={busy === r.id} style={stack ? undefined : styles.flex} />
              <Button title="Keep it" small variant="soft" onPress={() => setDeclining(null)} disabled={busy === r.id} style={stack ? undefined : styles.flex} />
            </View>
          </View> : null}
        </GlassCard>
      </Reveal>;
    }) : <EmptyState icon="sliders-horizontal" title="No bespoke requests yet" body="Ask for one below. A proposal appears here once Bioptime has scoped and approved it." />) : null}

    <Reveal mount index={items.length + 1}>
      <GlassCard variant="three">
        <Eyebrow kind="label">Ask</Eyebrow>
        <T v="card24" style={styles.title}>Request a bespoke plan</T>
        <View style={styles.form}>
          <Field label="Your goals, in your own words" error={errs.goals} hint="What you want to change, what you have tried, what gets in the way."><Input value={goals} onChangeText={setGoals} multiline maxLength={2000} style={styles.goalsInput} /></Field>
          <Field label="How long are you thinking? (optional)" error={errs.duration}>
            <View style={styles.chips}>
              <FilterChip label="Not sure yet" selected={!duration} onPress={() => setDuration('')} />
              {DURATIONS.map((d) => <FilterChip key={d} label={d} selected={duration === d} onPress={() => setDuration(d)} />)}
            </View>
          </Field>
          {sent ? <Notice kind={sent.kind}>{sent.text}</Notice> : null}
          <Button title="Ask for a proposal" shape="flow" commit onPress={send} busy={sending} />
          <T v="caption" color={fx.ink.a50}>Please don’t include medical records or test results here. Bioptime may write to you with questions before scoping.</T>
        </View>
      </GlassCard>
    </Reveal>
    <T v="caption" color={fx.ink.a50} center>{config?.payments === 'simulator' ? 'Payments here are simulated; no money moves.' : 'Payments are handled by the provider; Bioptime never sees your card or UPI details.'} Cancellations and refunds follow the terms.</T>
  </Overlay>;
}

/** A term with a long value (goals, services): the label above, the value in body text. */
function Term({ label: name, value }: { label: string; value: string }) {
  return <View style={styles.term}>
    <T v="caption" color={fx.ink.a50}>{name}</T>
    <T v="body" color={fx.ink.white}>{value}</T>
  </View>;
}

const styles = StyleSheet.create({
  band: { height: 140, marginBottom: -36 },
  intro: { marginTop: -8 },
  payText: { marginTop: 6, marginBottom: 16 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  stack: { gap: 10 },
  flex: { flex: 1 },
  grow: { flexGrow: 1, flexShrink: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { marginTop: 10 },
  when: { marginTop: 2, marginBottom: 8 },
  terms: { marginTop: 14, gap: 12 },
  term: { gap: 2, paddingVertical: 4 },
  proposal: { marginTop: 14, paddingTop: 6, borderTopWidth: 1, borderTopColor: fx.line.a05 },
  proposalTitle: { marginTop: 8, marginBottom: 2 },
  action: { marginTop: 16 },
  decline: { marginTop: 16, gap: 12 },
  noteInput: { minHeight: 80, textAlignVertical: 'top' },
  goalsInput: { minHeight: 110, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  form: { gap: 16, marginTop: 4 },
});
