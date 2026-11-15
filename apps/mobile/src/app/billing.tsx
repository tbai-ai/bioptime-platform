/* M3 Billing in the app (opened from Profile › Orders and Settings): the receipts, tax invoices and credit notes for
   payments the provider verified, the paid orders with a way to ask for a refund, and the refund requests with their
   decisions. A document opens in the browser through a link that expires in five minutes. No refund policy is stated
   here: the terms decide, and the Bioptime team decides each request. */
import * as WebBrowser from 'expo-web-browser';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Alert } from '@/lib/alert';
import { errorText, get, post } from '@/lib/api';
import { apiBaseSync } from '@/lib/config';
import { fmtDate, fmtDateTime, inr, label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Beside } from '@/fx/wordFit';
import {
  Button, ErrorState, Field, fx, GlassCard, haptics, Icon, Input, KVRow, Notice, Overlay, Pill, Reveal, RingSpinner,
  RowDivider, StaleBanner, statusTone, T, type PillTone,
} from '@/fx';

const REQUEST_STATUS: Record<string, { text: string; tone: PillTone }> = {
  requested: { text: 'Waiting for a decision', tone: 'warning' },
  approved: { text: 'Approved', tone: 'success' },
  declined: { text: 'Declined', tone: 'info' },
  withdrawn: { text: 'Withdrawn', tone: 'info' },
};

function docLabel(d: any): string {
  if (d.kind === 'receipt') return 'Receipt · not a tax invoice';
  if (d.kind === 'credit_note') return `Credit note${d.relatedDocument ? ` against ${d.relatedDocument.number}` : ''}`;
  return d.relatedDocument ? `Tax invoice · replaces ${d.relatedDocument.number}` : 'Tax invoice';
}

/** A receipt's number as the member reads it: the order's reference, without the payment provider's own id after it
 *  ("PAY-1009/pay_…" → "PAY-1009"); the document itself still carries the full number. */
const shownNumber = (n: string): string => String(n ?? '').split('/')[0];

export default function Billing() {
  const b = useLoad<any>('billing', () => get('/me/billing'), []);
  const [asking, setAsking] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [reasonErr, setReasonErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const d = b.data;
  const simulated = !!d && ((d.documents ?? []).some((x: any) => x.simulated) || (d.orders ?? []).some((o: any) => o.simulated));

  const open = async (doc: any) => {
    setMsg(null); setBusy(doc.id);
    try { const t = await post<{ token: string }>(`/me/billing/documents/${doc.id}/file-token`); await WebBrowser.openBrowserAsync(`${apiBaseSync()}/api/billing/documents/file?token=${encodeURIComponent(t.token)}`); }
    catch (e) { setMsg({ kind: 'error', text: errorText(e) }); } finally { setBusy(null); }
  };
  const send = async (o: any) => {
    if (reason.trim().length < 3) { setReasonErr('Tell us why, in a few words.'); return; }
    setBusy(o.id); setMsg(null);
    try { await post(`/me/orders/${o.id}/refund-request`, { reason: reason.trim() }); setAsking(null); setReason(''); setMsg({ kind: 'success', text: `Refund request for ${o.reference} sent. You are told here when it is decided.` }); haptics.success(); await b.reload(); }
    catch (e) { setReasonErr(errorText(e)); } finally { setBusy(null); }
  };
  const withdraw = (r: any) => Alert.alert(`Withdraw the request for ${r.orderReference}?`, 'Your order stays as it is. You can ask again later.', [{ text: 'Keep it', style: 'cancel' }, { text: 'Withdraw', style: 'destructive', onPress: async () => {
    setBusy(r.id); setMsg(null);
    try { await post(`/me/refund-requests/${r.id}/withdraw`); setMsg({ kind: 'success', text: 'Request withdrawn.' }); await b.reload(); }
    catch (e) { setMsg({ kind: 'error', text: errorText(e) }); } finally { setBusy(null); }
  } }]);

  return <Overlay kind="back" title="Billing" subtitle="Receipts, tax invoices and credit notes for the payments the provider confirmed, and your refund requests." fallback="/(tabs)/profile?tab=orders">
    <StaleBanner at={b.stale} /><ErrorState error={b.error} onRetry={b.reload} />
    {simulated ? <Notice kind="sample" title="Simulated payments">Payments here are simulated; no money moved.</Notice> : null}
    {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
    {b.loading && !d ? <View style={styles.loading}><RingSpinner label="Loading your billing" /></View> : d ? <>
      <Reveal index={0} mount>
        <GlassCard>
          <T v="label" accessibilityRole="header" style={styles.head}>Documents</T>
          {(d.documents ?? []).length ? d.documents.map((doc: any, i: number) => <View key={doc.id}>
            {i ? <RowDivider /> : null}
            <View style={styles.row}>
              <Icon name="receipt" size={16} color={fx.ink.a70} />
              {/* Open sits beside the document while its number's longest word fits whole beside it, else under it
                  (measured: Beside; 'PAY-100/9' at 320 dp and text 2.0, SWB-17) */}
              <Beside words={[{ text: shownNumber(doc.number), v: 'section' }]} align="flex-start" underGap={6} style={styles.fill} columnStyle={styles.gap2}
                side={<Button title={doc.status === 'void' ? 'View' : 'Open'} variant="soft" small full={false} busy={busy === doc.id} onPress={() => open(doc)} label={`Open ${shownNumber(doc.number)}`} />}>
                <T v="section" numberOfLines={2}>{shownNumber(doc.number)}</T>
                <T v="caption" color={fx.ink.a55}>{`${docLabel(doc)} · ${inr(doc.totalInr)} · ${fmtDate(doc.issuedAt)}${doc.status === 'void' ? ' · void' : ''}`}</T>
              </Beside>
            </View>
          </View>) : <T v="bodySm" color={fx.ink.a60}>No documents yet. A receipt appears here once the payment provider confirms a payment.</T>}
        </GlassCard>
      </Reveal>
      <Reveal index={1} mount>
        <GlassCard>
          <T v="label" accessibilityRole="header" style={styles.head}>Paid orders</T>
          {(d.orders ?? []).length ? d.orders.map((o: any, i: number) => <View key={o.id}>
            {i ? <RowDivider /> : null}
            <View style={styles.row}>
              <Icon name="package" size={16} color={fx.ink.a70} />
              {/* the status sits beside the order while its longest word fits whole beside it, else under it (measured:
                  Beside; 'PAY-100/9' at 320 dp and text 2.0, SWB-17) */}
              <Beside words={[{ text: `${o.reference} · ${o.packageName}`, v: 'section' }]} align="flex-start" underGap={6} style={styles.fill} columnStyle={styles.gap2}
                side={<Pill tone={statusTone(o.status)}>{label(o.status)}</Pill>}>
                <T v="section" numberOfLines={2}>{`${o.reference} · ${o.packageName}`}</T>
                <T v="caption" color={fx.ink.a55}>{`${inr(o.totalInr)} · paid ${fmtDateTime(o.paidAt)}`}</T>
              </Beside>
            </View>
            {o.canRequestRefund && asking !== o.id ? <Button title="Ask for a refund" variant="link" iconRight={null} onPress={() => { setAsking(o.id); setReason(''); setReasonErr(''); }} disabled={!!busy} style={styles.start} /> : null}
            {asking === o.id ? <View style={styles.form}>
              <T v="bodySm" color={fx.ink.a70}>The Bioptime team reads your request and decides it under the terms. Until then nothing changes: your package stays active.</T>
              <Field label="Why are you asking for a refund?" error={reasonErr}><Input value={reason} onChangeText={setReason} multiline maxLength={1000} style={styles.multi} /></Field>
              <View style={styles.buttons}>
                <Button title="Send request" small full={false} onPress={() => send(o)} busy={busy === o.id} commit />
                <Button title="Not now" variant="ghost" small full={false} onPress={() => setAsking(null)} disabled={busy === o.id} />
              </View>
            </View> : null}
          </View>) : <T v="bodySm" color={fx.ink.a60}>No paid orders.</T>}
        </GlassCard>
      </Reveal>
      <Reveal index={2} mount>
        <GlassCard>
          <T v="label" accessibilityRole="header" style={styles.head}>Refund requests</T>
          {(d.requests ?? []).length ? d.requests.map((r: any, i: number) => <View key={r.id} style={styles.request}>
            {i ? <RowDivider /> : null}
            <View style={styles.row}>
              <View style={styles.flex}>
                <T v="section" numberOfLines={2}>{`${r.orderReference} · ${r.packageName ?? ''}`}</T>
                <T v="caption" color={fx.ink.a55}>{`Asked ${fmtDateTime(r.createdAt)}${r.decidedAt ? ` · decided ${fmtDateTime(r.decidedAt)}` : ''}`}</T>
              </View>
              <Pill tone={REQUEST_STATUS[r.status]?.tone ?? 'info'}>{REQUEST_STATUS[r.status]?.text ?? label(r.status)}</Pill>
            </View>
            <KVRow label="You wrote" value={<T v="bodySm" color={fx.ink.white} style={styles.kv}>{r.reason}</T>} />
            {r.decisionNote ? <KVRow label="Bioptime" value={<T v="bodySm" color={fx.ink.white} style={styles.kv}>{r.decisionNote}</T>} /> : null}
            {r.refund ? <KVRow label="Refund" value={`${label(r.refund.status)} · ${inr(r.refund.amountInr)}`} divider={false} /> : null}
            {r.status === 'requested' ? <Button title="Withdraw" variant="ghost" small full={false} onPress={() => withdraw(r)} busy={busy === r.id} style={styles.start} /> : null}
          </View>) : <T v="bodySm" color={fx.ink.a60}>No refund requests.</T>}
        </GlassCard>
      </Reveal>
      <T v="caption" color={fx.ink.a55} style={styles.foot}>Documents open in your browser through a link that expires in five minutes. A receipt is not a tax invoice. A refund request changes nothing until the Bioptime team decides it under the terms.</T>
    </> : null}
  </Overlay>;
}

const styles = StyleSheet.create({
  loading: { paddingVertical: 48, alignItems: 'center' },
  head: { marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  fill: { flex: 1, minWidth: 0 },
  gap2: { gap: 2 },
  start: { alignSelf: 'flex-start' },
  form: { gap: 12, paddingBottom: 12 },
  multi: { minHeight: 80, textAlignVertical: 'top' },
  buttons: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  request: { gap: 4, paddingBottom: 8 },
  kv: { flexShrink: 1, textAlign: 'right' },
  foot: { paddingHorizontal: 4 },
});
