/* M3 Billing, admin workspace (/admin/billing, orders.manage): the billing documents (receipts, tax invoices, credit
   notes) with voiding, and the refund requests members send, decided here. Orders.tsx is left as it is. The seller's
   details and the GST rate are module settings on /admin/modules (settings.manage); nothing is filled in for the owner.
   Both lists show 200 rows at a time; "Load more" follows the API's cursor for the rows after them (useMorePages in
   ./morePages.ts hands the "<time>~<id>" cursor back as it came). */
import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Link } from '../../lib/nav';
import { api, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDate, fmtDateTime, fmtInr, label } from '../../lib/format';
import { Alert, Button, Card, Dialog, Empty, Field, Input, ReasonDialog, Readout, Select, Skeleton, Table, Tabs, Textarea, errorText, useApi, useToast } from '../../ui';
import { DocStatus, RequestStatus, docLabel, gstPct, inrExact, openDocument, type BillingDoc, type RefundRequest } from './shared';
import { useMorePages, type Page } from './morePages';

export type BillingSummary = {
  taxInvoices: { ready: boolean; missing: string[]; note: string | null }; pendingDecisions: string[]; gstRateBp: number; openRefundRequests: number;
  documents: { receipts: number; taxInvoices: number; creditNotes: number; void: number }; paidOrdersWithoutReceipt: number;
};

type Tab = 'documents' | 'requests';
/** Filter controls sized to their content in a row (the field classes fill their container by default). */
const FIT: React.CSSProperties = { width: 'auto' };
const PAGE = 200;

export default function AdminBilling() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') === 'requests' ? 'requests' : 'documents') as Tab;
  const summary = useApi(() => api.get<BillingSummary>('/admin/billing/summary'), []);
  const s = summary.data;
  return <div className="stack">
    <div className="pageHead"><div><h1>Billing</h1><p className="sub">Receipts for every payment the provider verified, tax invoices once the seller’s details are set, credit notes for refunds and voided invoices, and the refund requests members send. Documents never change once issued; a tax invoice is corrected by voiding it.</p></div><div className="actions"><Button size="sm" variant="tertiary" onClick={summary.reload}>Refresh</Button></div></div>
    {summary.error && <Alert kind="error">{summary.error}</Alert>}
    {s && <SetupNotice s={s} />}
    {s && <div className="grid">
      <div className="span3"><Readout eyebrow="Receipts" value={s.documents.receipts} /></div>
      <div className="span3"><Readout eyebrow="Tax invoices" value={s.documents.taxInvoices} sub={s.taxInvoices.ready ? 'Issued' : 'Pending configuration'} /></div>
      <div className="span3"><Readout eyebrow="Credit notes" value={s.documents.creditNotes} /></div>
      <div className="span3"><Readout eyebrow="Refund requests" value={s.openRefundRequests} sub="Waiting for a decision" hot={s.openRefundRequests > 0} /></div>
    </div>}
    <Tabs items={[{ id: 'documents', label: 'Documents' }, { id: 'requests', label: 'Refund requests', count: s?.openRefundRequests }]} value={tab} onChange={(t) => setParams(t === 'documents' ? {} : { tab: t }, { replace: true })} label="Billing">
      {tab === 'documents' ? <Documents onChange={summary.reload} /> : <Requests onChange={summary.reload} />}
    </Tabs>
  </div>;
}

/** Tax invoices pending configuration: the exact settings that are missing, and where they are set. */
export function SetupNotice({ s }: { s: BillingSummary }) {
  const { can } = useAuth();
  return <>
    {!s.taxInvoices.ready && <Alert kind="warning" title="Tax invoices are pending configuration">
      Missing: {s.taxInvoices.missing.join(', ')}. Until they are set, members get receipts labelled “not a tax invoice”. {can('settings.manage') || can('modules.manage') ? <>The seller’s details are a module setting on <Link to="/modules">Modules</Link>.</> : 'An administrator holding settings.manage sets them on Modules.'} The legal entity, GSTIN, SAC codes, place-of-supply rules and e-invoicing are owner and counsel decisions.
    </Alert>}
    {s.paidOrdersWithoutReceipt > 0 && <Alert kind="info" title={`${s.paidOrdersWithoutReceipt} verified paid order${s.paidOrdersWithoutReceipt === 1 ? '' : 's'} without a receipt`}>Paid while billing documents were switched off. Issue them from the client’s record, Billing tab.</Alert>}
    <p className="muted small">GST rate for new orders: {gstPct(s.gstRateBp)} (module setting; the rate is an owner decision). Documents keep the rate each order was priced with.</p>
  </>;
}

function Documents({ onChange }: { onChange: () => void }) {
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const path = (cursor?: string) => `/admin/billing/documents${qs({ kind, status, q: search, limit: PAGE, cursor })}`;
  const list = useApi(() => api.get<Page<BillingDoc>>(path()), [kind, status, search]);
  const pages = useMorePages(list.data, (cursor) => api.get<Page<BillingDoc>>(path(cursor)));
  const toast = useToast();
  const [voiding, setVoiding] = useState<BillingDoc | null>(null);
  const [reissue, setReissue] = useState(false);
  const items = pages.items;
  return <div className="stack">
    <p className="small">Open a document to view or print it. Only an issued tax invoice can be voided; a credit note then cancels it.</p>
    <form className="row" role="search" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }}>
      <Input type="search" style={FIT} aria-label="Search documents" placeholder="Search documents" value={q} onChange={(e) => setQ(e.target.value)} />
      <Select style={FIT} aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Every kind</option><option value="receipt">Receipts</option><option value="tax_invoice">Tax invoices</option><option value="credit_note">Credit notes</option></Select>
      <Select style={FIT} aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Issued or void</option><option value="issued">Issued</option><option value="void">Void</option></Select>
      <Button size="sm" type="submit">Search</Button>
    </form>
    {list.error && <Alert kind="error">{list.error}</Alert>}
    {list.loading && !list.data ? <Skeleton rows={5} /> : items.length ? <Card dense><Table label="Billing documents" head={<><th>Number</th><th>Document</th><th>Member</th><th>Order</th><th className="num">Total</th><th>Issued</th><th>Status</th><th /></>}>
      {items.map((d) => <tr key={d.id}>
        <td className="small">{d.number}</td>
        <td>{docLabel(d)}{d.simulated && <div className="muted">Simulated payment</div>}</td>
        <td>{d.memberId ? <Link to={`/clients/${d.memberId}?tab=billing`}>{d.memberName}</Link> : d.memberName}</td>
        <td className="small">{d.orderReference}<div className="muted">{d.packageName}</div></td>
        <td className="num">{inrExact(d.totalInr)}<div className="muted">GST {inrExact(d.gstInr)}</div></td>
        <td className="small">{fmtDate(d.issuedAt)}</td>
        <td><DocStatus status={d.status} />{d.status === 'void' && <div className="muted small">{d.voidedByName ? `${d.voidedByName} · ` : ''}{fmtDate(d.voidedAt)}{d.voidReason ? ` · ${d.voidReason}` : ''}</div>}</td>
        <td><div className="row"><Button size="sm" onClick={() => openDocument(`/admin/billing/documents/${d.id}/file-token`, (e) => toast(errorText(e), 'error'))}>Open</Button>{d.kind === 'tax_invoice' && d.status === 'issued' && !d.creditedBy && <Button size="sm" variant="destructive" onClick={() => { setReissue(false); setVoiding(d); }}>Void</Button>}</div></td>
      </tr>)}
    </Table>{pages.next && <div className="bp-card-foot"><Button size="sm" busy={pages.busy} onClick={pages.more}>Load more</Button></div>}</Card> : <Card><Empty title="No documents" body={search || kind || status ? 'Nothing matches these filters.' : 'A receipt is issued when the payment provider verifies a payment.'} /></Card>}
    <ReasonDialog open={!!voiding} onClose={() => setVoiding(null)} danger title={`Void tax invoice ${voiding?.number ?? ''}?`} confirmLabel="Void invoice"
      body={`A credit note cancels it in full (${inrExact(voiding?.totalInr)}). The invoice is kept, marked void; the member is told and sees both documents. Payments and the order do not change.`}
      extra={<label className="bp-check" style={{ marginTop: 12 }}><input type="checkbox" checked={reissue} onChange={(e) => setReissue(e.target.checked)} /> Issue a replacement invoice with the current seller details</label>}
      onConfirm={async (reason) => { const r = await api.post<{ creditNote: BillingDoc; replacement: BillingDoc | null }>(`/admin/billing/documents/${voiding!.id}/void`, { reason, reissue }); toast(`Voided; credit note ${r.creditNote.number}${r.replacement ? `, replacement ${r.replacement.number}` : ''}`); list.reload(); onChange(); }} />
  </div>;
}

function Requests({ onChange }: { onChange: () => void }) {
  const [status, setStatus] = useState('requested');
  const path = (cursor?: string) => `/admin/refund-requests${qs({ status, limit: PAGE, cursor })}`;
  const list = useApi(() => api.get<Page<RefundRequest>>(path()), [status]);
  const pages = useMorePages(list.data, (cursor) => api.get<Page<RefundRequest>>(path(cursor)));
  const [deciding, setDeciding] = useState<{ r: RefundRequest; decision: 'approve' | 'decline' } | null>(null);
  const items = pages.items;
  return <div className="stack">
    <p className="small">Approving refunds the order in full through the payment provider; declining changes nothing. The member reads your note either way.</p>
    <div className="row"><Select style={FIT} aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="requested">Waiting for a decision</option><option value="approved">Approved</option><option value="declined">Declined</option><option value="withdrawn">Withdrawn</option><option value="">Every request</option></Select></div>
    {list.error && <Alert kind="error">{list.error}</Alert>}
    {list.loading && !list.data ? <Skeleton rows={4} /> : items.length ? <Card dense><Table label="Refund requests" head={<><th>Order</th><th>Member</th><th className="num">Total</th><th>Reason</th><th>Asked</th><th>Status</th><th /></>}>
      {items.map((r) => <tr key={r.id}>
        <td className="small">{r.orderReference}<div className="muted">{r.packageName}{r.orderStatus ? ` · ${label(r.orderStatus)}` : ''}</div></td>
        <td>{r.memberId ? <Link to={`/clients/${r.memberId}?tab=billing`}>{r.memberName}</Link> : r.memberName}<div className="muted small">{r.memberEmail}</div></td>
        <td className="num">{fmtInr(r.totalInr)}{r.simulated && <div className="muted">simulated</div>}</td>
        <td className="small">{r.reason}</td>
        <td className="small">{fmtDateTime(r.createdAt)}</td>
        <td><RequestStatus status={r.status} />{r.decisionNote && <div className="muted small">{r.decidedByName ? `${r.decidedByName}: ` : ''}{r.decisionNote}</div>}{r.refund && <div className="muted small">Refund {label(r.refund.status)}</div>}</td>
        <td>{r.status === 'requested' && <div className="row"><Button size="sm" variant="destructive" onClick={() => setDeciding({ r, decision: 'approve' })}>Approve</Button><Button size="sm" onClick={() => setDeciding({ r, decision: 'decline' })}>Decline</Button></div>}</td>
      </tr>)}
    </Table>{pages.next && <div className="bp-card-foot"><Button size="sm" busy={pages.busy} onClick={pages.more}>Load more</Button></div>}</Card> : <Card><Empty title={status === 'requested' ? 'Nothing to decide' : 'No requests'} body={status === 'requested' ? 'Members ask for refunds from Billing in the portal or the app.' : undefined} /></Card>}
    <DecideDialog value={deciding} onClose={() => setDeciding(null)} onDone={() => { list.reload(); onChange(); }} />
  </div>;
}

function DecideDialog({ value, onClose, onDone }: { value: { r: RefundRequest; decision: 'approve' | 'decline' } | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  React.useEffect(() => { if (value) { setNote(''); setErr(''); } }, [value]);
  const approve = value?.decision === 'approve';
  const go = async () => {
    if (note.trim().length < 3) { setErr('Write a note for the member, in a few words.'); return; }
    setBusy(true);
    try { await api.post(`/admin/refund-requests/${value!.r.id}/decide`, { decision: value!.decision, note: note.trim() }); toast(approve ? 'Approved; the refund has started' : 'Declined'); onClose(); onDone(); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <Dialog open={!!value} onClose={onClose} danger={approve} title={value ? `${approve ? 'Approve' : 'Decline'} the refund of ${value.r.orderReference}?` : ''} footer={<><Button variant="tertiary" onClick={onClose}>Keep as is</Button><Button variant={approve ? 'destructive' : 'primary'} busy={busy} onClick={go}>{approve ? 'Approve and refund' : 'Decline'}</Button></>}>
    {value && <div className="form">
      <p className="small">{approve ? `The order is refunded in full (${fmtInr(value.r.totalInr)}) through the payment provider${value.r.simulated ? ' (simulated; no money moves)' : ''}: unused entitlements are cancelled, the programme and the coach assignment end, open bookings are cancelled, and a credit note is issued.` : 'Nothing changes on the order. The member reads your note.'}</p>
      <p className="small"><b>The member wrote:</b> {value.r.reason}</p>
      <Field label="Note to the member (recorded in the audit log)" error={err}><Textarea value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} /></Field>
    </div>}
  </Dialog>;
}
