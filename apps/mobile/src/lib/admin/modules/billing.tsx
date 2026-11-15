/* The Billing tab on the administrator's member record (the web's modules/billing/ClientRecordBilling.tsx,
   orders.manage): the member's verified paid orders with their documents, the documents an order is missing (issued
   here with a reason: POST /admin/billing/orders/:id/issue) and the member's refund requests. GET /admin/orders?memberId,
   GET /admin/billing/documents?memberId (every page, up to 20), GET /admin/refund-requests?memberId, and
   GET /admin/billing/summary for whether tax invoices are configured. Orders and requests page with "Load more". */
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { errorText, get, post, qs } from '@/lib/api';
import { fmtDate, fmtDateTime, inr, label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import type { RecordTabContext } from '@/lib/admin/moduleTabs';
import { ReasonSheet } from '@/components/adminA/ReasonSheet';
import { useToast } from '@/components/adminA/toast';
import { Button, Card, Empty, Eyebrow, H2, P, Row, StaleBanner } from '@/components/ui';
import { StatusPill, TabState, useRecordTick } from '@/components/coachModules/shared';
import { openBillingDocument } from '@/components/adminModules/shared';
import { allPages, DocStatus, docLabel, inrExact, RequestStatusPill, useMorePages, type BillingDoc, type BillingSummary, type Page, type RefundRequest } from '@/components/adminModules/billing';
import { colors, font, space } from '@/theme';

type Order = { id: string; reference: string; packageName: string | null; status: string; totalInr: number; paidAt: string | null; payment: { signatureVerified: boolean; simulated: boolean } | null };

const PAID = ['paid', 'activated', 'refund_pending', 'refunded'];
const DOC_PAGE = 200;
const DOC_PAGES = 20;

export function ClientRecordBilling({ ctx }: { ctx: RecordTabContext }) {
  const { memberId } = ctx;
  const router = useRouter();
  const toast = useToast();
  const [issuing, setIssuing] = useState<Order | null>(null);
  const ordersPath = (cursor?: string) => `/admin/orders${qs({ memberId, limit: 100, cursor })}`;
  const requestsPath = (cursor?: string) => `/admin/refund-requests${qs({ memberId, limit: 100, cursor })}`;
  const tick = useRecordTick(ctx.record); // the record screen's pull to refresh reloads this tab's data too
  const view = useLoad<{ orders: Page<Order>; docs: { items: BillingDoc[]; complete: boolean }; requests: Page<RefundRequest>; ready: boolean }>(`admin-billing-${memberId}`, async () => {
    const [orders, docs, requests, summary] = await Promise.all([
      get<Page<Order>>(ordersPath()),
      allPages((cursor) => get<Page<BillingDoc>>(`/admin/billing/documents${qs({ memberId, limit: DOC_PAGE, cursor })}`), DOC_PAGES),
      get<Page<RefundRequest>>(requestsPath()),
      get<BillingSummary>('/admin/billing/summary').catch(() => null),
    ]);
    return { orders, docs, requests, ready: !!summary?.taxInvoices.ready };
  }, [memberId, tick]);
  const d = view.data;
  const orderPages = useMorePages(d?.orders ?? null, (cursor) => get<Page<Order>>(ordersPath(cursor)), (t) => toast.show(t, 'error'));
  const requestPages = useMorePages(d?.requests ?? null, (cursor) => get<Page<RefundRequest>>(requestsPath(cursor)), (t) => toast.show(t, 'error'));
  const allDocs = !!d?.docs.complete;
  const paid = orderPages.items.filter((o) => !!o.paidAt && PAID.includes(o.status) && !!o.payment?.signatureVerified);
  const docsFor = (o: Order) => (d?.docs.items ?? []).filter((x) => x.orderId === o.id);
  // with documents left unloaded (more than DOC_PAGES pages) an order cannot be said to miss one
  const missing = (o: Order) => { const ds = docsFor(o); return allDocs && (!ds.some((x) => x.kind === 'receipt') || (!!d?.ready && (o.status === 'paid' || o.status === 'activated') && !ds.some((x) => x.kind === 'tax_invoice' && x.status === 'issued'))); };
  const open = async (doc: BillingDoc) => { try { await openBillingDocument(`/admin/billing/documents/${doc.id}/file-token`); } catch (e) { toast.show(errorText(e), 'error'); } };
  const requests = requestPages.items;
  return <TabState loading={view.loading && !d} error={view.error} onRetry={view.reload}>
    {d ? <View style={{ gap: space.md }}>
      {toast.node}
      <StaleBanner at={view.stale} />
      <Card>
        <Row between style={{ flexWrap: 'nowrap' }}><View style={{ flex: 1 }}><Eyebrow>Billing</Eyebrow><H2>Verified paid orders</H2></View><Button title="All billing" variant="ghost" small onPress={() => router.push('/admin/billing' as never)} /></Row>
        {paid.length ? paid.map((o) => <View key={o.id} style={st.item}>
          <Row between style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}><Text style={st.title}>{`${o.reference} · ${o.packageName ?? ''}`}</Text><Text style={st.meta}>{`${inr(o.totalInr)} · paid ${fmtDateTime(o.paidAt)}${o.payment?.simulated ? ' · simulated' : ''}`}</Text></View>
            <StatusPill status={o.status} />
          </Row>
          {missing(o) ? <Button title="Issue missing documents" variant="secondary" small onPress={() => setIssuing(o)} style={{ alignSelf: 'flex-start' }} /> : null}
          {docsFor(o).length ? docsFor(o).map((x) => <View key={x.id} style={st.doc}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={st.docTitle}>{x.number}</Text>
              <Text style={st.meta}>{`${docLabel(x)} · ${inrExact(x.totalInr)} · ${fmtDate(x.issuedAt)}`}</Text>
              <Row><DocStatus status={x.status} /></Row>
            </View>
            <Button title="Open" variant="secondary" small onPress={() => void open(x)} />
          </View>) : <Text style={st.meta}>{allDocs ? 'No documents: paid while billing documents were switched off.' : 'No documents loaded here for this order. All billing lists every document.'}</Text>}
        </View>) : <Empty title="No verified paid orders" body={orderPages.next ? 'None among the newest orders; load more to see older ones.' : undefined} />}
        {!allDocs ? <P muted small>{`Only the newest ${d.docs.items.length} documents are shown, so no order is offered missing documents here. All billing lists every document.`}</P> : null}
        {orderPages.next ? <Button title="Load more" variant="secondary" small busy={orderPages.busy} onPress={() => void orderPages.more()} style={{ alignSelf: 'flex-start' }} /> : null}
      </Card>
      <Card>
        <Row between style={{ flexWrap: 'nowrap' }}><View style={{ flex: 1 }}><Eyebrow>Refunds</Eyebrow><H2>Refund requests</H2></View>{requests.some((r) => r.status === 'requested') ? <Button title="Decide" variant="secondary" small onPress={() => router.push('/admin/billing?tab=requests' as never)} /> : null}</Row>
        {requests.length ? requests.map((r) => <View key={r.id} style={st.item}>
          <Row between style={{ flexWrap: 'nowrap' }}><Text style={[st.title, r.status !== 'requested' && { color: colors.muted }]}>{r.orderReference ?? '—'}</Text><RequestStatusPill status={r.status} /></Row>
          <Text style={st.body}>{r.reason}</Text>
          {r.decisionNote ? <Text style={st.body}>{`${r.decidedByName ?? 'Bioptime'}: ${r.decisionNote}`}</Text> : null}
          {r.refund ? <Text style={st.body}>{`Refund ${label(r.refund.status)}`}</Text> : null}
          <Text style={st.meta}>{fmtDateTime(r.createdAt)}</Text>
        </View>) : <Empty title="No refund requests" />}
        {requestPages.next ? <Button title="Load more" variant="secondary" small busy={requestPages.busy} onPress={() => void requestPages.more()} style={{ alignSelf: 'flex-start' }} /> : null}
      </Card>
      <ReasonSheet open={!!issuing} onClose={() => setIssuing(null)} title={`Issue the missing documents for ${issuing?.reference ?? ''}?`} confirmLabel="Issue"
        body={d.ready ? 'Issues the receipt if there is none and, for a paid or active order, a tax invoice with the current seller details. Numbers are taken now.' : 'Issues the receipt. Tax invoices are pending configuration, so none is issued.'}
        onConfirm={async (reason) => { if (!issuing) return; const r = await post<{ issued: BillingDoc[] }>(`/admin/billing/orders/${issuing.id}/issue`, { reason }); toast.show(`Issued ${r.issued.map((x) => x.number).join(', ')}`); void view.reload(); }} />
    </View> : null}
  </TabState>;
}

const st = StyleSheet.create({
  item: { paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: space.xs },
  title: { color: colors.text, fontSize: font.body, fontWeight: '600', flex: 1 },
  body: { color: colors.text, fontSize: font.small },
  meta: { color: colors.muted, fontSize: font.small },
  doc: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs, paddingLeft: space.md, borderLeftWidth: 2, borderLeftColor: colors.border },
  docTitle: { color: colors.text, fontSize: font.small, fontWeight: '600' },
});
