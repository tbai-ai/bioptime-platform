/* Admin › Orders and payments (the web's /admin/orders, pages/Orders.tsx, orders.manage): GET /admin/orders?status=&limit=200,
   filtered by status and, when opened from a member's record, by `ref` (client-side, as the web does); Refund (paid or
   activated) and Activate (paid: reconciliation), each with a recorded reason. Only a signature-verified provider event
   marks an order paid; the screen shows what the API returns and says "simulated" only when the payment record does. */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { get, post, qs } from '@/lib/api';
import { fmtDateTime, inr, label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { labelOr, tone } from '@/lib/admin/a/format';
import { AdminHeader } from '@/components/adminA/parts';
import { ReasonSheet } from '@/components/adminA/ReasonSheet';
import { useToast } from '@/components/adminA/toast';
import { Button, Card, Empty, ErrorBox, Loading, Row, Screen, StaleBanner, Title } from '@/components/ui';
import { FilterChips, RecordList, RecordRow } from '@/components/workspace';
import { notifyBadges, RequirePermission, RoleGate } from '@/components/workspaceShell';
import { Enter } from '@/motion';
import { colors, space } from '@/theme';

/** A row with actions under it keeps one bottom line after the actions, so the buttons read as that order's. */
const styles = StyleSheet.create({
  rowNoLine: { borderBottomWidth: 0 },
  actions: { paddingBottom: space.md, borderBottomWidth: 1, borderBottomColor: colors.border, marginHorizontal: -space.lg, paddingHorizontal: space.lg },
});

type Order = { id: string; reference: string; memberId: string; memberName: string; packageName?: string | null; status: string; totalInr?: number | null; gstInr?: number | null; payment?: { provider: string; status: string; signatureVerified?: boolean; simulated?: boolean } | null; refund?: { status: string } | null; paidAt?: string | null; activatedAt?: string | null; createdAt: string };

const STATUSES = ['pending_payment', 'paid', 'activated', 'failed', 'cancelled', 'refund_pending', 'refunded'];

export default function AdminOrders() {
  const { ref } = useLocalSearchParams<{ ref?: string }>();
  const router = useRouter();
  const [status, setStatus] = useState('');
  const list = useLoad<{ items: Order[] }>(status ? null : 'admin-orders', () => get(`/admin/orders${qs({ status, limit: 200 })}`), [status]);
  const toast = useToast();
  const [refund, setRefund] = useState<Order | null>(null);
  const [activate, setActivate] = useState<Order | null>(null);
  const wanted = typeof ref === 'string' && ref ? ref : '';
  const items = (list.data?.items ?? []).filter((o) => !wanted || o.reference === wanted);
  const done = (text: string) => { toast.show(text); void list.reload(); notifyBadges(); };
  return <RoleGate workspace="admin"><View style={{ flex: 1 }}><Screen refreshing={list.loading} onRefresh={list.reload} depth>
    <AdminHeader title="Orders" />
    <Title sub="Only a signature-verified provider event marks an order paid. Activation creates the programme and its entitlements exactly once. Refunds cancel unused entitlements and end the programme.">Orders and payments</Title>
    <RequirePermission permission="orders.manage">
      <StaleBanner at={list.stale} /><ErrorBox error={list.error} onRetry={list.reload} />
      <Enter index={1}><FilterChips options={[{ value: '', label: 'Any status' }, ...STATUSES.map((s) => ({ value: s, label: label(s) }))]} value={status} onChange={(v) => setStatus(String(v))} /></Enter>
      <Enter index={2}>{list.loading && !list.data ? <Loading /> : items.length ? <RecordList title="Orders">{items.map((o) => { const actions = o.status === 'paid' || o.status === 'activated'; return <View key={o.id}>
        <RecordRow title={`${o.reference} · ${o.memberName}`} onPress={() => router.push(`/admin/clients/${o.memberId}` as never)} style={actions ? styles.rowNoLine : undefined}
          meta={`${o.packageName ?? '—'} · ${inr(o.totalInr)} (GST ${inr(o.gstInr ?? 0)})\n${fmtDateTime(o.activatedAt ?? o.paidAt ?? o.createdAt)}${o.payment ? ` · ${o.payment.provider}${o.payment.simulated ? ' (simulated)' : ''}` : ' · —'}`}
          pills={[{ label: labelOr(o.status), tone: tone(o.status) }, ...(o.payment ? [{ label: `payment ${o.payment.status}${o.payment.signatureVerified ? ' · verified' : ''}`, tone: 'info' as const }] : []), ...(o.refund ? [{ label: `refund ${o.refund.status}`, tone: tone(o.refund.status) }] : [])]} />
        {actions ? <Row style={styles.actions}>
          <Button title="Refund" small variant="danger" onPress={() => setRefund(o)} />
          {o.status === 'paid' ? <Button title="Activate" small variant="secondary" onPress={() => setActivate(o)} /> : null}
        </Row> : null}
      </View>; })}</RecordList> : list.data ? <Card><Empty title="No orders" /></Card> : null}</Enter>
      <ReasonSheet open={!!refund} onClose={() => setRefund(null)} title={`Refund ${refund?.reference ?? ''} (${inr(refund?.totalInr)})?`} destructive confirmLabel="Refund" body={`Unused entitlements are cancelled, the programme ends, the assignment ends, the member is notified.${refund?.payment?.simulated ? ' The provider refund is simulated; no money moves.' : ''}`}
        onConfirm={async (reason) => { if (!refund) return; await post(`/admin/orders/${refund.id}/refund`, { reason }); done('Refund requested'); }} />
      <ReasonSheet open={!!activate} onClose={() => setActivate(null)} title={`Activate ${activate?.reference ?? ''}?`} confirmLabel="Activate" body="For a paid order whose activation did not complete (reconciliation). Entitlements are created once."
        onConfirm={async (reason) => { if (!activate) return; await post(`/admin/orders/${activate.id}/activate`, { reason }); done('Activated'); }} />
    </RequirePermission>
  </Screen>{toast.float}</View></RoleGate>;
}
