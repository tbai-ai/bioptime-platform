/* Admin › Billing (the web's /admin/billing, modules/billing/AdminBilling.tsx; billing module, orders.manage): the
   billing documents (receipts, tax invoices, credit notes) with voiding, and the refund requests members send, decided
   here. GET /admin/billing/summary for the setup notice and the readouts; GET /admin/billing/documents and
   GET /admin/refund-requests 200 rows at a time with "Load more" (the API's cursor handed back as it came). Voiding
   (POST …/documents/:id/void) and deciding (POST /admin/refund-requests/:id/decide) each carry the web's reason or note.
   The seller's details and the GST rate are module settings on /admin/modules; nothing is filled in for the owner. */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { errorText, get, post, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtDateTime, inr, label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Readout } from '@/components/adminA/parts';
import { ReasonSheet } from '@/components/adminA/ReasonSheet';
import { useToast } from '@/components/adminA/toast';
import { DetailRow, LoadError } from '@/components/adminB1/parts';
import { Button, Card, Check, Empty, Field, Input, Loading, Notice, P } from '@/components/ui';
import { FilterChips, RecordList, SearchBar, SegmentTabs, Sheet } from '@/components/workspace';
import { notifyBadges } from '@/components/workspaceShell';
import { AdminModuleScreen, openBillingDocument, useScreenRefresh } from '@/components/adminModules/shared';
import { DocStatus, docLabel, gstPct, inrExact, RequestStatusPill, useMorePages, type BillingDoc, type BillingSummary, type Page, type RefundRequest } from '@/components/adminModules/billing';
import { Enter } from '@/motion';
import { colors, font, space } from '@/theme';

type Tab = 'documents' | 'requests';
const PAGE = 200;

export default function AdminBillingScreen() {
  return <AdminModuleScreen title="Billing" module="billing" permission="orders.manage"
    sub="Receipts for every payment the provider verified, tax invoices once the seller’s details are set, credit notes for refunds and voided invoices, and the refund requests members send. Documents never change once issued; a tax invoice is corrected by voiding it.">
    <BillingBody />
  </AdminModuleScreen>;
}

function BillingBody() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(params.tab === 'requests' ? 'requests' : 'documents');
  useEffect(() => { if (params.tab === 'requests' || params.tab === 'documents') setTab(params.tab); }, [params.tab]);
  const [summaryTick, setSummaryTick] = useState(0);
  const summary = useLoad<BillingSummary>('admin-billing-summary', () => get('/admin/billing/summary'), [summaryTick]);
  const tick = useScreenRefresh(summary.loading, summary.stale);
  useEffect(() => { if (tick) setSummaryTick((n) => n + 1); }, [tick]);
  const s = summary.data;
  const changed = () => { setSummaryTick((n) => n + 1); notifyBadges(); };
  return <View style={{ gap: space.md }}>
    <LoadError title="Billing could not be loaded" error={summary.error} onRetry={summary.reload} />
    {s ? <Enter index={1}><View style={{ gap: space.md }}>
      <SetupNotice s={s} />
      <View style={st.grid}>
        <Readout eyebrow="Receipts" value={s.documents.receipts} />
        <Readout eyebrow="Tax invoices" value={s.documents.taxInvoices} sub={s.taxInvoices.ready ? 'Issued' : 'Pending configuration'} />
        <Readout eyebrow="Credit notes" value={s.documents.creditNotes} />
        <Readout eyebrow="Refund requests" value={s.openRefundRequests} sub="Waiting for a decision" hot={s.openRefundRequests > 0} />
      </View>
    </View></Enter> : summary.loading ? <Loading /> : null}
    <SegmentTabs items={[{ id: 'documents', label: 'Documents' }, { id: 'requests', label: 'Refund requests', count: s?.openRefundRequests }]} value={tab} onChange={(t) => setTab(t as Tab)} />
    {tab === 'documents' ? <Documents tick={tick} onChange={changed} /> : <Requests tick={tick} onChange={changed} />}
  </View>;
}

/** Tax invoices pending configuration: the exact settings that are missing, and where they are set. */
function SetupNotice({ s }: { s: BillingSummary }) {
  const { can } = useAuth();
  const router = useRouter();
  const where = can('settings.manage') || can('modules.manage');
  return <>
    {!s.taxInvoices.ready ? <Notice kind="warning" title="Tax invoices are pending configuration">
      {`Missing: ${s.taxInvoices.missing.join(', ')}. Until they are set, members get receipts labelled “not a tax invoice”. ${where ? 'The seller’s details are a module setting on Modules.' : 'An administrator holding settings.manage sets them on Modules.'} The legal entity, GSTIN, SAC codes, place-of-supply rules and e-invoicing are owner and counsel decisions.`}
    </Notice> : null}
    {!s.taxInvoices.ready && where ? <Button title="Open Modules" variant="ghost" small onPress={() => router.push('/admin/modules' as never)} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} /> : null}
    {s.paidOrdersWithoutReceipt > 0 ? <Notice kind="info" title={`${s.paidOrdersWithoutReceipt} verified paid order${s.paidOrdersWithoutReceipt === 1 ? '' : 's'} without a receipt`}>Paid while billing documents were switched off. Issue them from the client’s record, Billing tab.</Notice> : null}
    <P muted small>{`GST rate for new orders: ${gstPct(s.gstRateBp)} (module setting; the rate is an owner decision). Documents keep the rate each order was priced with.`}</P>
  </>;
}

const KIND_OPTIONS = [{ value: '', label: 'Every kind' }, { value: 'receipt', label: 'Receipts' }, { value: 'tax_invoice', label: 'Tax invoices' }, { value: 'credit_note', label: 'Credit notes' }];
const DOC_STATUS_OPTIONS = [{ value: '', label: 'Issued or void' }, { value: 'issued', label: 'Issued' }, { value: 'void', label: 'Void' }];

function Documents({ tick, onChange }: { tick: number; onChange: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [voiding, setVoiding] = useState<BillingDoc | null>(null);
  const [reissue, setReissue] = useState(false);
  const path = (cursor?: string) => `/admin/billing/documents${qs({ kind, status, q: search, limit: PAGE, cursor })}`;
  const list = useLoad<Page<BillingDoc>>(`admin-billing-docs-${kind}-${status}-${search}`, () => get(path()), [kind, status, search, tick]);
  useScreenRefresh(list.loading, list.stale);
  const pages = useMorePages(list.data, (cursor) => get<Page<BillingDoc>>(path(cursor)), (t) => toast.show(t, 'error'));
  // the web searches on submit; on a phone the clear button and an emptied field search again too
  useEffect(() => { if (!q.trim() && search) setSearch(''); }, [q, search]);
  const items = pages.items;
  const open = async (d: BillingDoc) => { try { await openBillingDocument(`/admin/billing/documents/${d.id}/file-token`); } catch (e) { toast.show(errorText(e), 'error'); } };
  return <View style={{ gap: space.md }}>
    {toast.node}
    <P small>Open a document to view or print it. Only an issued tax invoice can be voided; a credit note then cancels it.</P>
    <SearchBar value={q} onChangeText={setQ} placeholder="Search documents" onSubmit={() => setSearch(q.trim())} />
    <FilterChips options={KIND_OPTIONS} value={kind} onChange={(v) => setKind(String(v))} />
    <FilterChips options={DOC_STATUS_OPTIONS} value={status} onChange={(v) => setStatus(String(v))} />
    <Button title="Search" small variant="secondary" onPress={() => setSearch(q.trim())} style={{ alignSelf: 'flex-start' }} />
    <LoadError title="Documents could not be loaded" error={list.error} onRetry={list.reload} />
    {list.loading && !list.data ? <Loading /> : items.length ? <RecordList title="Billing documents">
      {items.map((d, i) => <DetailRow key={d.id} last={i === items.length - 1 && !pages.next} title={d.number}
        lines={[
          `${docLabel(d)}${d.simulated ? ' · Simulated payment' : ''}`,
          `${d.memberName ?? '—'} · ${d.orderReference ?? '—'}${d.packageName ? ` · ${d.packageName}` : ''}`,
          `${inrExact(d.totalInr)} · GST ${inrExact(d.gstInr)} · issued ${fmtDate(d.issuedAt)}`,
          d.status === 'void' ? `${d.voidedByName ? `${d.voidedByName} · ` : ''}${fmtDate(d.voidedAt)}${d.voidReason ? ` · ${d.voidReason}` : ''}` : null,
        ]}
        right={<DocStatus status={d.status} />}
        actions={<>
          <Button title="Open" small variant="secondary" onPress={() => void open(d)} />
          {d.kind === 'tax_invoice' && d.status === 'issued' && !d.creditedBy ? <Button title="Void" small variant="danger" onPress={() => { setReissue(false); setVoiding(d); }} /> : null}
          {d.memberId ? <Button title="Client" small variant="ghost" onPress={() => router.push(`/admin/clients/${d.memberId}?tab=billing` as never)} /> : null}
        </>} />)}
      {pages.next ? <View style={st.more}><Button title="Load more" small variant="secondary" busy={pages.busy} onPress={() => void pages.more()} /></View> : null}
    </RecordList> : list.data ? <Card><Empty title="No documents" body={search || kind || status ? 'Nothing matches these filters.' : 'A receipt is issued when the payment provider verifies a payment.'} /></Card> : null}
    <ReasonSheet open={!!voiding} onClose={() => setVoiding(null)} destructive title={`Void tax invoice ${voiding?.number ?? ''}?`} confirmLabel="Void invoice"
      body={`A credit note cancels it in full (${inrExact(voiding?.totalInr)}). The invoice is kept, marked void; the member is told and sees both documents. Payments and the order do not change.`}
      extra={<Check checked={reissue} onChange={setReissue} label="Issue a replacement invoice with the current seller details" />}
      onConfirm={async (reason) => {
        const doc = voiding;
        if (!doc) return;
        const r = await post<{ creditNote: BillingDoc; replacement: BillingDoc | null }>(`/admin/billing/documents/${doc.id}/void`, { reason, reissue });
        toast.show(`Voided; credit note ${r.creditNote.number}${r.replacement ? `, replacement ${r.replacement.number}` : ''}`);
        void list.reload(); onChange();
      }} />
  </View>;
}

const REQUEST_STATUS_OPTIONS = [{ value: 'requested', label: 'Waiting for a decision' }, { value: 'approved', label: 'Approved' }, { value: 'declined', label: 'Declined' }, { value: 'withdrawn', label: 'Withdrawn' }, { value: '', label: 'Every request' }];

function Requests({ tick, onChange }: { tick: number; onChange: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [status, setStatus] = useState('requested');
  const [deciding, setDeciding] = useState<{ r: RefundRequest; decision: 'approve' | 'decline' } | null>(null);
  const path = (cursor?: string) => `/admin/refund-requests${qs({ status, limit: PAGE, cursor })}`;
  const list = useLoad<Page<RefundRequest>>(`admin-refund-requests-${status}`, () => get(path()), [status, tick]);
  useScreenRefresh(list.loading, list.stale);
  const pages = useMorePages(list.data, (cursor) => get<Page<RefundRequest>>(path(cursor)), (t) => toast.show(t, 'error'));
  const items = pages.items;
  return <View style={{ gap: space.md }}>
    {toast.node}
    <P small>Approving refunds the order in full through the payment provider; declining changes nothing. The member reads your note either way.</P>
    <FilterChips options={REQUEST_STATUS_OPTIONS} value={status} onChange={(v) => setStatus(String(v))} />
    <LoadError title="Refund requests could not be loaded" error={list.error} onRetry={list.reload} />
    {list.loading && !list.data ? <Loading /> : items.length ? <RecordList title="Refund requests">
      {items.map((r, i) => <DetailRow key={r.id} last={i === items.length - 1 && !pages.next} title={r.orderReference ?? '—'}
        lines={[
          `${r.packageName ?? ''}${r.orderStatus ? ` · ${label(r.orderStatus)}` : ''}`,
          `${r.memberName ?? '—'}${r.memberEmail ? ` · ${r.memberEmail}` : ''}`,
          `${inr(r.totalInr)}${r.simulated ? ' · simulated' : ''} · asked ${fmtDateTime(r.createdAt)}`,
          r.reason,
          r.decisionNote ? `${r.decidedByName ? `${r.decidedByName}: ` : ''}${r.decisionNote}` : null,
          r.refund ? `Refund ${label(r.refund.status)}` : null,
        ]}
        right={<RequestStatusPill status={r.status} />}
        actions={<>
          {r.status === 'requested' ? <><Button title="Approve" small variant="danger" onPress={() => setDeciding({ r, decision: 'approve' })} /><Button title="Decline" small variant="secondary" onPress={() => setDeciding({ r, decision: 'decline' })} /></> : null}
          {r.memberId ? <Button title="Client" small variant="ghost" onPress={() => router.push(`/admin/clients/${r.memberId}?tab=billing` as never)} /> : null}
        </>} />)}
      {pages.next ? <View style={st.more}><Button title="Load more" small variant="secondary" busy={pages.busy} onPress={() => void pages.more()} /></View> : null}
    </RecordList> : list.data ? <Card><Empty title={status === 'requested' ? 'Nothing to decide' : 'No requests'} body={status === 'requested' ? 'Members ask for refunds from Billing in the portal or the app.' : undefined} /></Card> : null}
    <DecideSheet value={deciding} onClose={() => setDeciding(null)} onDone={(text) => { toast.show(text); void list.reload(); onChange(); }} />
  </View>;
}

function DecideSheet({ value, onClose, onDone }: { value: { r: RefundRequest; decision: 'approve' | 'decline' } | null; onClose: () => void; onDone: (toast: string) => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (value) { setNote(''); setErr(''); setBusy(false); } }, [value]);
  const approve = value?.decision === 'approve';
  const go = async () => {
    if (!value) return;
    if (note.trim().length < 3) { setErr('Write a note for the member, in a few words.'); return; }
    setBusy(true);
    try { await post(`/admin/refund-requests/${value.r.id}/decide`, { decision: value.decision, note: note.trim() }); onClose(); onDone(approve ? 'Approved; the refund has started' : 'Declined'); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <Sheet open={!!value} onClose={onClose} title={value ? `${approve ? 'Approve' : 'Decline'} the refund of ${value.r.orderReference ?? ''}?` : ''}
    footer={<View style={{ flexDirection: 'row', gap: space.sm }}><Button title="Keep as is" variant="secondary" onPress={onClose} disabled={busy} style={{ flex: 1 }} /><Button title={approve ? 'Approve and refund' : 'Decline'} variant={approve ? 'danger' : 'primary'} busy={busy} onPress={() => void go()} style={{ flex: 1 }} /></View>}>
    {value ? <View>
      <P small>{approve ? `The order is refunded in full (${inr(value.r.totalInr)}) through the payment provider${value.r.simulated ? ' (simulated; no money moves)' : ''}: unused entitlements are cancelled, the programme and the coach assignment end, open bookings are cancelled, and a credit note is issued.` : 'Nothing changes on the order. The member reads your note.'}</P>
      <Text style={[st.body, { marginVertical: space.md }]}><Text style={{ fontWeight: '700' }}>The member wrote:</Text>{` ${value.r.reason}`}</Text>
      <Field label="Note to the member (recorded in the audit log)" error={err || undefined}><Input value={note} onChangeText={(v) => { setNote(v); if (err) setErr(''); }} maxLength={1000} multiline numberOfLines={3} style={{ minHeight: 80, textAlignVertical: 'top' }} accessibilityLabel="Note to the member (recorded in the audit log)" /></Field>
    </View> : null}
  </Sheet>;
}

const st = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  more: { padding: space.md, alignItems: 'flex-start' },
  body: { color: colors.text, fontSize: font.small, lineHeight: 19 },
});

