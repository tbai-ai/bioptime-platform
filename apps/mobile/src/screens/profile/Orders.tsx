/* Profile › Orders (the earlier app's shot 78): filter chips and order cards with a status-coloured top bar, an icon
   tile, the reference in mono, a status pill and a footer with the dates and the amount. Bioptime's orders are of three
   kinds: package orders (GET /me/orders), blood test bookings (GET /me/bloodwork/bookings, each opening the booking)
   and billing documents (GET /me/billing with the billing module: receipts, tax invoices and credit notes opened
   through a five-minute link). Refund requests are made and withdrawn on Billing, one tap away. The simulated notes
   read as on the payment and booking screens. A card's status chip sits beside its name only while the longest word
   of the name and of its reference, as drawn now, fits whole beside it (measured: any phone width, any text size);
   otherwise it leads the tag row, so a name never breaks in the middle or shrinks beside its chip (a name that still
   does not fit its whole row shrinks just enough: FitText). A booking whose slot has passed while it is still open
   reads "Awaiting update" (lib/today), as on Tests. */
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { ApiError, errorText, get, post } from '@/lib/api';
import { apiBaseSync } from '@/lib/config';
import { fmtDate, fmtTime, inr, label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import {
  EmptyState, ErrorState, FilterChip, FONTS, fx, GlassCard, NoSwipeZone, Notice, NoticeText, Pill, Reveal, RowDivider, SettingsRow, Skeleton,
  StaleBanner, T, toast, type IconName,
} from '@/fx';
import { shownStatus } from '@/lib/today';
import { FitText, WordMeasure, type DrawnWord } from '../bio/wordFit';
import { keepShort } from '@/fx/wordFit';
import { markersText, statusColour, statusIcon } from '../tests/model';
import { docLabel, type Billing, type BillingDoc, type Booking, type Order } from './data';
import { IconTile, Meta, shared, StatusChip } from './parts';

type Filter = 'all' | 'packages' | 'tests' | 'documents';
/** A title longer than this leaves the top right to itself; its status pill leads the tag row instead. */
const LONG = 18;
/** The gap between the head row's tile, name and chip (styles.head). */
const HEAD_GAP = 12;
const offIsNull = <T,>(p: Promise<T>) => p.catch((e) => { if (e instanceof ApiError && e.code === 'FEATURE_DISABLED') return null; throw e; });

/** Package order statuses in the order colours (fx.map.order). */
function orderColour(s: string): string {
  if (s === 'activated' || s === 'paid') return fx.map.order.results_ready;
  if (s === 'pending_payment' || s === 'pending') return fx.map.order.scheduled;
  if (s === 'refunded' || s === 'expired') return fx.map.order.completed;
  if (s === 'cancelled' || s === 'failed') return fx.map.order.cancelled;
  return fx.map.order.confirmed;
}
const orderIcon = (s: string): IconName => (s === 'activated' || s === 'paid' ? 'circle-check' : s === 'cancelled' || s === 'failed' ? 'circle-x' : 'clock');
const bookingColour = (s: string) => (fx.map.order as Record<string, string>)[s] ?? fx.hue.grey;
function bookingIcon(s: string): IconName {
  switch (s) {
    case 'confirmed': return 'circle-check';
    case 'scheduled': return 'calendar-check';
    case 'sample_collected': return 'test-tube';
    case 'processing': return 'loader-circle';
    case 'results_ready': return 'file-text';
    case 'completed': return 'badge-check';
    case 'cancelled': return 'circle-x';
    default: return 'circle-dot';
  }
}


/** A receipt's number as the member reads it, as Billing shows it: the order's reference without the payment provider's
 *  own id after it ("PAY-1009/pay_…" → "PAY-1009"); the document itself still carries the full number. */
const shownNumber = (n: string): string => String(n ?? '').split('/')[0];

export function Orders({ features, register }: { features: Set<string> | null; register: (fn: (() => Promise<unknown>) | null) => void }) {
  const known = !!features;
  const billingOn = !!features?.has('billing');
  const orders = useLoad<{ items: Order[] }>('orders', () => get('/me/orders'), []);
  const bookings = useLoad<{ items: Booking[] }>('bookings', () => get('/me/bloodwork/bookings'), []);
  const billing = useLoad<Billing | null>(known && billingOn ? 'billing' : null, () => (known && billingOn ? offIsNull(get<Billing>('/me/billing')) : Promise.resolve(null)), [known, billingOn]);
  const reload = useCallback(() => Promise.all([orders.reload(), bookings.reload(), billing.reload()]), [orders.reload, bookings.reload, billing.reload]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { register(reload); return () => register(null); }, [register, reload]);
  const [filter, setFilter] = useState<Filter>('all');
  const [opening, setOpening] = useState<string | null>(null);

  const o = orders.data?.items ?? [];
  const b = bookings.data?.items ?? [];
  const docs = billing.data?.documents ?? [];
  const waiting = (billing.data?.requests ?? []).filter((r) => r.status === 'requested').length;
  const filters: Array<{ value: Filter; label: string }> = [
    { value: 'all', label: 'All' }, { value: 'packages', label: 'Packages' }, { value: 'tests', label: 'Blood tests' },
    ...(billingOn ? [{ value: 'documents' as Filter, label: 'Documents' }] : []),
  ];
  const shown = filters.some((f) => f.value === filter) ? filter : 'all';
  const cards = useMemo(() => {
    const list: Array<{ at: string; key: string; node: React.ReactNode }> = [];
    if (shown === 'all' || shown === 'packages') for (const x of o) list.push({ at: x.paidAt ?? x.createdAt, key: x.id, node: <OrderCard o={x} billingOn={billingOn} /> });
    if (shown === 'all' || shown === 'tests') for (const x of b) list.push({ at: x.createdAt, key: x.id, node: <BookingCard b={x} /> });
    return list.sort((p, q) => q.at.localeCompare(p.at));
  }, [o, b, shown, billingOn]);
  const total = (shown === 'all' ? o.length + b.length + docs.length : shown === 'packages' ? o.length : shown === 'tests' ? b.length : docs.length);
  const paySimulated = o.some((x) => x.payment?.simulated) || docs.some((d) => d.simulated);
  const labSimulated = b.some((x) => x.simulated);

  const open = async (d: BillingDoc) => {
    setOpening(d.id);
    try { const t = await post<{ token: string }>(`/me/billing/documents/${d.id}/file-token`); await WebBrowser.openBrowserAsync(`${apiBaseSync()}/api/billing/documents/file?token=${encodeURIComponent(t.token)}`); }
    catch (e) { toast.error(errorText(e)); } finally { setOpening(null); }
  };

  const loading = (orders.loading && !orders.data) || (bookings.loading && !bookings.data);
  return <View style={shared.gap16}>
    <NoSwipeZone>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityLabel="Order kinds">
        {filters.map((f) => <FilterChip key={f.value} label={f.label} selected={shown === f.value} onPress={() => setFilter(f.value)} />)}
        {!loading ? <T v="caption" color={fx.ink.a60} style={styles.total}>{`${total} total`}</T> : null}
      </ScrollView>
    </NoSwipeZone>
    <StaleBanner at={orders.stale ?? bookings.stale} />
    <ErrorState error={orders.error ?? bookings.error ?? billing.error} onRetry={reload} />
    {(paySimulated && shown !== 'tests') || (labSimulated && (shown === 'all' || shown === 'tests')) ? <Notice kind="sample">
      {paySimulated && shown !== 'tests' ? <NoticeText>Payments here are simulated; no money moved.</NoticeText> : null}
      {labSimulated && (shown === 'all' || shown === 'tests') ? <NoticeText>Bookings here are simulated; no laboratory is involved and no sample is collected.</NoticeText> : null}
    </Notice> : null}

    {loading ? <View style={shared.gap12}><Skeleton height={150} radius={fx.radius.card} /><Skeleton height={150} radius={fx.radius.card} /></View> : <>
      {cards.map((c, i) => <Reveal key={`${shown}-${c.key}`} index={Math.min(i, 6)} mount>{c.node}</Reveal>)}
      {(shown === 'all' || shown === 'documents') && docs.length ? <View style={shared.gap8}>
        <T v="label" accessibilityRole="header" color={fx.ink.a55} style={styles.docHead}>Billing documents</T>
        {docs.map((d, i) => <Reveal key={`${shown}-${d.id}`} index={Math.min(i, 6)} mount>
          <SettingsRow icon="receipt" title={shownNumber(d.number)} sub={`${docLabel(d)} · ${inr(d.totalInr)} · ${fmtDate(d.issuedAt)}`}
            label={`${shownNumber(d.number)}, ${docLabel(d)}, ${inr(d.totalInr)}, ${fmtDate(d.issuedAt)}${d.status === 'void' ? ', void' : ''}`}
            onPress={() => { if (!opening) void open(d); }}
            right={<Pill tone={d.status === 'void' ? 'error' : 'success'}>{opening === d.id ? 'Opening' : d.status === 'void' ? 'Void' : 'Open'}</Pill>} />
        </Reveal>)}
        <T v="caption" color={fx.ink.a60} style={styles.docHead}>Documents open in your browser through a link that expires in five minutes. A receipt is not a tax invoice.</T>
      </View> : null}
      {!cards.length && !(shown !== 'packages' && shown !== 'tests' && docs.length) ? <EmptyState icon={shown === 'tests' ? 'flask-conical' : shown === 'documents' ? 'receipt' : 'package'}
        title={shown === 'tests' ? 'No blood tests booked' : shown === 'documents' ? 'No documents yet' : 'No orders yet'}
        body={shown === 'tests' ? 'Tests you book appear here with their status.' : shown === 'documents' ? 'A receipt appears here once the payment provider confirms a payment.' : 'Packages you buy and tests you book appear here.'}
        action={shown === 'tests' ? { title: 'Book a blood test', onPress: () => router.push('/(tabs)/tests') } : { title: 'See the packages', onPress: () => router.push('/(tabs)/store') }} /> : null}
      <SettingsRow icon="shopping-bag" title="Packages and bespoke plans" sub="Buy a package or ask for a plan scoped with you, in Store" onPress={() => router.push('/(tabs)/store')} />
      {billingOn ? <SettingsRow icon="credit-card" title="Billing and refunds" sub={waiting ? `${waiting} refund request${waiting === 1 ? '' : 's'} waiting for a decision` : 'Receipts, tax invoices, credit notes and refund requests'} onPress={() => router.push('/billing')} /> : null}
    </>}
  </View>;
}

/** Where a card's status chip goes: beside the name while `short` (a name of LONG characters at most, a chip of the
 *  usual length) and the widest word of the name and of its reference, as drawn now (WordMeasure: any phone width, any
 *  text size), fits whole in the room the chip leaves them, and a short word of the name with the word beside it (never
 *  'Vitamin / D / (25-OH)': VA-5); else it leads the tag row and the name has the head row to itself. The room is the
 *  name column's width with the chip beside it (measured with the chip below: that width less the chip and its gap), so
 *  moving the chip never moves it back. */
function useChipPlace(short: boolean) {
  const [word, setWord] = useState({ name: 0, ref: 0 });
  const [col, setCol] = useState<{ width: number; beside: boolean } | null>(null);
  const [chip, setChip] = useState(0);
  const widest = Math.max(word.name, word.ref);
  const room = col ? (col.beside ? col.width : col.width - HEAD_GAP - chip) : null;
  const beside = short && (room == null || !chip || !widest || widest <= room - 1); // a pixel kept for rounding, as FitText
  return {
    beside,
    onCol: (e: LayoutChangeEvent) => { const width = Math.floor(e.nativeEvent.layout.width); setCol((c) => (c && c.width === width && c.beside === beside ? c : { width, beside })); },
    onChip: (e: LayoutChangeEvent) => { const width = Math.ceil(e.nativeEvent.layout.width); setChip((c) => (c === width ? c : width)); },
    onName: (w: DrawnWord) => setWord((o) => (o.name === w.width ? o : { ...o, name: w.width })),
    onRef: (w: DrawnWord) => setWord((o) => (o.ref === w.width ? o : { ...o, ref: w.width })),
  };
}

/** A card's head row: the icon tile, the name and reference, and the status chip while it fits beside them
 *  (useChipPlace; the card puts it at the front of the tag row otherwise). */
function CardHead({ icon, colour, name, reference, chip, place }: {
  icon: IconName; colour: string; name: string; reference: string; chip: React.ReactNode; place: ReturnType<typeof useChipPlace>;
}) {
  return <View style={styles.head}>
    <IconTile icon={icon} colour={colour} radius={12} />
    <View style={shared.flex} onLayout={place.onCol}>
      {/* its short words keep a neighbour on their line ('Vitamin / B12' never parts: RV2-1) */}
      <FitText v="cardTitle" numberOfLines={3}>{keepShort(name)}</FitText>
      <FitText v="mono12" color={fx.ink.a60}>{reference}</FitText>
      <WordMeasure text={keepShort(name)} v="cardTitle" pairs onWord={place.onName} />
      <WordMeasure text={reference} v="mono12" onWord={place.onRef} />
    </View>
    {place.beside ? <View onLayout={place.onChip}>{chip}</View> : null}
  </View>;
}

function OrderCard({ o, billingOn }: { o: Order; billingOn: boolean }) {
  const colour = orderColour(o.status);
  const place = useChipPlace(o.packageName.length <= LONG);
  const chip = <StatusChip text={label(o.status)} colour={colour} icon={orderIcon(o.status)} />;
  const body = <>
    <View style={[styles.bar, { backgroundColor: colour }]} />
    <View style={styles.body}>
      <CardHead icon="package" colour={colour} name={o.packageName} reference={o.reference} chip={chip} place={place} />
      <View style={styles.tags}>{!place.beside ? <View onLayout={place.onChip}>{chip}</View> : null}<Tag>Package</Tag>{o.refund ? <Tag>{`Refund ${label(o.refund.status).toLowerCase()} · ${inr(o.refund.amountInr)}`}</Tag> : null}</View>
      <RowDivider />
      <View style={styles.foot}>
        <View style={styles.metas}>
          <Meta icon="clock" text={o.paidAt ? `Paid ${fmtDate(o.paidAt)}` : `Ordered ${fmtDate(o.createdAt)}`} />
        </View>
        <T v="mono14" style={styles.amount}>{inr(o.totalInr)}</T>
      </View>
    </View>
  </>;
  const spoken = `${o.packageName}, ${o.reference}, ${label(o.status)}, ${inr(o.totalInr)}`;
  return billingOn
    ? <GlassCard clip padding={0} borderColor={fx.line.a08} onPress={() => router.push('/billing')} label={spoken} hint="Opens billing: receipts and refunds">{body}</GlassCard>
    : <GlassCard clip padding={0} borderColor={fx.line.a08}><View accessible accessibilityLabel={spoken}>{body}</View></GlassCard>;
}

function BookingCard({ b }: { b: Booking }) {
  // a collection whose slot has passed while it is still open reads "Awaiting update", as on Tests (lib/today)
  const status = b.slotAt ? shownStatus(b) : b.status;
  const colour = status === b.status ? bookingColour(status) : statusColour(status);
  const icon = status === b.status ? bookingIcon(status) : statusIcon(status);
  const name = b.test?.name ?? 'Blood test';
  // the longer "Awaiting update" chip leads the tag row, and any chip does once the name's longest word would not fit
  // whole beside it (a narrow phone, a large text size), so it never squeezes the name
  const place = useChipPlace(name.length <= LONG && status === b.status);
  const chip = <StatusChip text={label(status)} colour={colour} icon={icon} />;
  const tags = [markersText(b.test?.markers), b.test?.fastingHours ? `${b.test.fastingHours} h fasting` : null].filter(Boolean) as string[];
  return <GlassCard clip padding={0} borderColor={fx.line.a08} onPress={() => router.push(`/booking/${b.id}`)}
    label={`${b.test?.name ?? 'Blood test'}, ${b.reference}, ${label(status)}${b.slotAt ? `, collection ${fmtDate(b.slotAt)}` : ''}`} hint="Opens the booking">
    <View style={[styles.bar, { backgroundColor: colour }]} />
    <View style={styles.body}>
      <CardHead icon="flask-conical" colour={colour} name={name} reference={b.reference} chip={chip} place={place} />
      <View style={styles.tags}>{!place.beside ? <View onLayout={place.onChip}>{chip}</View> : null}<Tag>Blood test</Tag>{tags.map((t) => <Tag key={t}>{t}</Tag>)}</View>
      <RowDivider />
      <View style={styles.foot}>
        <View style={styles.metas}>
          <Meta icon="clock" text={`Booked ${fmtDate(b.createdAt)}`} />
          {b.slotAt ? <Meta icon="calendar" text={fmtDate(b.slotAt)} /> : null}
        </View>
        <T v="mono14" style={styles.amount}>{b.status === 'cancelled' ? 'Cancelled' : b.slotAt ? fmtTime(b.slotAt) : '—'}</T>
      </View>
    </View>
  </GlassCard>;
}

function Tag({ children }: { children: string }) {
  return <View style={styles.tag}><T v="micro" color={fx.ink.a60} style={styles.tagText}>{children}</T></View>;
}

const styles = StyleSheet.create({
  chips: { gap: 8, paddingRight: 8, alignItems: 'center' },
  total: { marginLeft: 6 },
  docHead: { paddingHorizontal: 4, marginTop: 4 },
  bar: { height: 2 },
  body: { padding: 16, gap: 12 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: HEAD_GAP },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: fx.radius.pill, borderWidth: 1, borderColor: fx.line.a20 },
  tagText: { fontSize: 9, letterSpacing: 1.2 },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  metas: { flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap', flex: 1 },
  amount: { fontFamily: FONTS.mono700, fontSize: 16 },
});
