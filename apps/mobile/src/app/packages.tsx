/* Package checkout (S9; BUILD §6.9, the earlier app's checkout chrome, shots 64-checkout*, 72, 73): an overlay opened from
   the Store's Buy (/packages?package=<slug>). Without a package it is the old Packages link and goes to the Store.
   1. Review: the package (its photo, what it includes), an optional promo code (checked by the server, never here), the
      price including GST, the simulated-payments notice, then "Place order", which creates the order
      (POST /me/checkout).
   2. Pay: the order as the server priced it (amount, GST, any discount, total) and the payment step. With the simulator
      this is the plain "Payment" panel whose two buttons tell the provider to capture or fail the payment
      (POST /payments/simulator/complete); with a real provider its page opens in the browser.
   3. Result: confirmed (the package is active, a coach is being matched) with the order reference to copy, or failed
      (nothing was charged) with "Try again". The confirmed footer leads to the package's next real step: the plan when
      a coach has already published one (GET /me/programme), else the package's included blood test (/book-test), else
      Home; "Go home" stays under the steps. A member who already has a coach (a second package) is not told that one is
      being matched (GET /me assignmentStatus). A confirmed order reloads 'me' and the catalogue, so the Store shows
      ENROLLED. Orders are listed under Profile › Orders.
   Motion (v2, M81): the steps slide by direction (x ±24 with their opacity, 220 ms expo; the Tests checkout's StepSlide)
   under the same segmented progress; the confirmation tells its four beats (the app's done moment, the SESSION DONE
   check and title with the success haptic, then the reference with its digits flashing, the steps); a failed payment
   shakes its notice with the error haptic. */
import * as Clipboard from 'expo-clipboard';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { ApiError, errorText, get, post, randomKey } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { inr, label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import {
  Button, ease, ErrorState, Eyebrow, Field, fx, GlassCard, haptics, Icon, Input, invalidate, KVRow, Notice, Overlay, Reveal, Scrim, Skeleton, T, timing, toast, useFx,
} from '@/fx';
import { CardPhoto } from '@/screens/store/PackageCard';
import { colourFor, forSalePackages, metaFor, spokenPrice, type Catalogue, type Package } from '@/screens/store/data';
import { StepBars, Steps, SuccessMark } from '@/screens/store/checkout';
import { BEATS, Beat, Flash } from '@/screens/tests/Beats';
import { StepSlide } from '@/screens/tests/Checkout';
import { largeText } from '@/fx/layout';

type Order = { id: string; reference: string; status: string; packageName: string; amountInr: number; gstInr: number; totalInr: number; discountInr: number; couponCode: string | null };
type Checkout = { checkoutId: string; url: string | null; simulated: boolean };

export default function Packages() {
  const { package: slug } = useLocalSearchParams<{ package?: string }>();
  if (!slug) return <Redirect href="/(tabs)/store" />;
  return <PackageCheckout slug={String(slug)} />;
}

function PackageCheckout({ slug }: { slug: string }) {
  const router = useRouter();
  // the two simulated outcomes side by side, or one over the other on a narrow phone or at a large text size, where
  // half a row broke and cut their labels ('Simula/te suc…', SWB-06)
  const { width, fontScale } = useWindowDimensions();
  const stack = largeText(fontScale) || width < 360;
  const { config } = useAuth();
  const pk = useLoad<Package>(`package.${slug}`, () => get(`/packages/${encodeURIComponent(slug)}`), [slug]);
  const list = useLoad<Catalogue>('packages', () => get('/packages'), []);
  const [coupon, setCoupon] = useState('');
  const [couponError, setCouponError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ order: Order; checkout: Checkout } | null>(null);
  const [result, setResult] = useState<Order | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  const attempt = useRef(randomKey());
  const p = pk.data;
  const v = p?.version ?? null;
  const index = Math.max(0, forSalePackages(list.data).findIndex((x) => x.slug === slug));
  const price = v?.forSale ? v.priceInr : null;
  const simulator = config?.payments === 'simulator' || !!list.data?.demo;
  const paid = !!result && (result.status === 'activated' || result.status === 'paid');
  const step = result ? 3 : pending ? 2 : 1;
  // the slide's direction: forward through the steps, back on Try again
  const lastStep = useRef(step);
  const dir = useRef(0);
  if (step !== lastStep.current) { dir.current = step > lastStep.current ? 1 : -1; lastStep.current = step; }

  const place = async () => {
    if (!p) return;
    setBusy('order'); setMsg(null); setCouponError(null);
    try {
      const code = coupon.trim();
      const r = await post<{ order: Order; checkout: Checkout | null }>('/me/checkout', { packageId: p.id, idempotencyKey: attempt.current, ...(code ? { couponCode: code } : {}) });
      if (r.checkout?.simulated) { setPending({ order: r.order, checkout: r.checkout }); setMsg({ kind: 'info', text: `Order ${r.order.reference} created for ${inr(r.order.totalInr)}. It is not paid yet.` }); }
      else if (r.checkout?.url) { await WebBrowser.openBrowserAsync(r.checkout.url); setMsg({ kind: 'info', text: `Order ${r.order.reference} was created. Finish the payment on the provider's page; the order then shows under Profile › Orders.` }); invalidate(['me', 'orders']); }
      else setMsg({ kind: 'error', text: 'No payment page came back for this provider.' });
    } catch (e) {
      attempt.current = randomKey();
      if (e instanceof ApiError && /COUPON/i.test(e.code ?? '')) setCouponError(e.message);
      else setMsg({ kind: 'error', text: errorText(e) });
    } finally { setBusy(null); }
  };

  const simulate = async (outcome: 'captured' | 'failed') => {
    if (!pending) return;
    setBusy('sim'); setMsg(null);
    try {
      const r = await post<{ order: Order }>('/payments/simulator/complete', { checkoutId: pending.checkout.checkoutId, outcome });
      const o = r.order;
      setPending(null); setResult(o);
      if (o.status === 'activated' || o.status === 'paid') {
        // the success haptic comes with the confirmation's badge; the words are made at render (they name the coach state)
        setMsg({ kind: 'success', text: '' });
      } else { haptics.error(); setMsg({ kind: 'error', text: `The provider reported the payment as ${label(o.status).toLowerCase()}. Nothing was charged.` }); }
      invalidate(['me', 'packages', 'programme', 'orders']);
    } catch (e) { setMsg({ kind: 'error', text: errorText(e) }); } finally { setBusy(null); }
  };

  const again = () => { attempt.current = randomKey(); setResult(null); setPending(null); setMsg(null); };
  const copy = async (ref: string) => { try { await Clipboard.setStringAsync(ref); haptics.light(); toast.logged('Reference copied'); } catch { /* nothing to copy into */ } };

  // after the payment: the plan only once a coach has published one; a new member is still being matched, so the
  // package's own next step leads (its included blood test), else Home
  const programme = useLoad<{ plan: unknown | null } | null>(null, () => (paid ? get('/me/programme') : Promise.resolve(null)), [paid]);
  const planReady = !!programme.data?.plan;
  // whether a coach is already assigned (a second package): then nobody is being matched. Read with the page (a payment
  // does not change it), so the confirmation's words are right from its first frame
  const meNow = useLoad<{ assignmentStatus?: string }>('me', () => get('/me'), [], { shared: true });
  const coachStatus = meNow.data?.assignmentStatus;
  const matching = !meNow.data || !coachStatus || ['pending', 'needs_attention', 'none'].includes(coachStatus);
  const paidText = result && paid ? `Payment confirmed. Order ${result.reference} is ${label(result.status).toLowerCase()}; your package is active${matching ? ' and a coach is being matched' : ''}.` : '';
  const testIncluded = (v?.bloodworkEntitlements ?? 0) > 0;
  const next = planReady ? { title: 'Open my plan', go: () => router.replace('/(tabs)/train?view=plan') }
    : testIncluded ? { title: 'Book your included blood test', go: () => router.replace('/book-test') }
      : { title: 'Go home', go: () => router.replace('/(tabs)') };
  const footer = step === 1 && p && price != null
    ? <Button title={`Place order · ${inr(price)}`} label={`Place order, ${spokenPrice(price)}`} icon="credit-card" shape="flow" commit busy={busy === 'order'} disabled={!!busy} onPress={place} />
    : step === 3 && paid ? <Button title={next.title} icon="arrow-right" shape="flow" busy={programme.loading && !programme.data} onPress={next.go} />
      : step === 3 ? <Button title="Try again" icon="refresh-cw" shape="flow" onPress={again} /> : undefined;

  return <Overlay title="Checkout" subtitle={`Step ${step} of 3 · ${step === 1 ? 'Review' : step === 2 ? 'Pay' : paid ? 'Confirmed' : 'Not paid'}`} fallback="/(tabs)/store" footer={footer}>
    <StepBars step={step} of={3} />
    <ErrorState error={pk.error} onRetry={pk.reload} />
    {pk.loading && !p ? <View style={styles.gap}><Skeleton height={200} radius={fx.radius.three} /><Skeleton height={120} radius={fx.radius.three} /></View> : null}

    <StepSlide key={step} dir={dir.current}>
    {p && step === 1 ? <>
      <Reveal mount index={0}>
        <GlassCard variant="three" padding={0} clip>
          <View style={styles.band}>
            <CardPhoto p={p} index={index} slot={`store.package.card.${index}`} dim={colourFor(p, index).dim} />
            <Scrim kind="programme" style={StyleSheet.absoluteFill} />
            <View style={styles.bandText}>
              <Eyebrow kind="label">Package</Eyebrow>
              <T v="card24">{p.name}</T>
            </View>
          </View>
          <View style={styles.cardBody}>
            {metaFor(v).map((m) => <View key={m.text} style={styles.metaRow}><Icon name={m.icon} size={14} color={fx.ink.a60} /><T v="body" color={fx.ink.a80}>{m.text}</T></View>)}
            {(v?.includes ?? []).length ? <View style={styles.includes}>
              {(v?.includes ?? []).map((s) => <View key={s} style={styles.metaRow}><Icon name="check" size={12} color={colourFor(p, index).c} stroke={2.5} /><T v="bodySm" color={fx.ink.a80} style={styles.flex}>{s}</T></View>)}
            </View> : null}
          </View>
        </GlassCard>
      </Reveal>

      {price != null ? <Reveal mount index={1}>
        <Field label="Promo code" title="Promo code (optional)" error={couponError} hint="Checked when you place the order.">
          <Input value={coupon} onChangeText={(t) => { setCoupon(t.toUpperCase()); setCouponError(null); }} autoCapitalize="characters" autoCorrect={false} maxLength={24} />
        </Field>
      </Reveal> : null}

      <Reveal mount index={2}>
        <View style={styles.total}>
          <KVRow label="Price" value={price != null ? inr(price) : 'On request'} />
          <KVRow label="GST" value="Included" />
          <KVRow label="Total" value={price != null ? inr(price) : '—'} total divider={false} />
        </View>
      </Reveal>
      {price != null ? <T v="bodySm" color={fx.ink.a70}>{`${inr(price)} including GST. Bioptime matches you with a coach after the payment is confirmed and tells you here.`}</T>
        : <Notice kind="info">This package has no price yet. Pricing is on request.</Notice>}
    </> : null}

    {result && paid ? <SuccessMark title={`${result.packageName} is active`} /> : null}
    {simulator && step < 3 ? <Notice kind="sample" title="Simulated payments">Checkout here is simulated; no money moves.</Notice> : null}
    {msg ? (result ? <Beat at={BEATS.titleAt}><Shake on={msg.kind === 'error'}><Notice kind={msg.kind}>{msg.kind === 'success' && paid ? paidText : msg.text}</Notice></Shake></Beat>
      : <Notice kind={msg.kind}>{msg.text}</Notice>) : null}

    {pending ? <>
      <OrderTotals o={pending.order} />
      <GlassCard variant="three" borderColor={fx.red.a20}>
        <Eyebrow>Payment</Eyebrow>
        <T v="body" color={fx.ink.a70} style={styles.payText}>{`Choose how the payment provider should answer for order ${pending.order.reference}.`}</T>
        <View style={stack ? styles.payStack : styles.payRow}>
          <Button title="Simulate success" small shape="flow" commit onPress={() => simulate('captured')} busy={busy === 'sim'} style={stack ? undefined : styles.flex} />
          <Button title="Simulate failure" small variant="soft" onPress={() => simulate('failed')} disabled={busy === 'sim'} style={stack ? undefined : styles.flex} />
        </View>
      </GlassCard>
    </> : null}

    {result ? <>
      <Beat at={BEATS.refAt}>
        <GlassCard variant="three">
          <Eyebrow kind="label">Order reference</Eyebrow>
          <View style={styles.refRow}>
            <Flash at={BEATS.refAt} style={styles.refBox}>
              <T v="metric24" style={styles.ref} accessibilityLabel={`Order reference ${result.reference.split('').join(' ')}`}>{result.reference}</T>
            </Flash>
            <Button title="Copy" variant="soft" small full={false} icon="copy" label="Copy the order reference" onPress={() => copy(result.reference)} />
          </View>
          <T v="caption" color={fx.ink.a50}>Quote it for any question about this order. It is listed under Profile › Orders.</T>
        </GlassCard>
      </Beat>
      {paid ? <Steps items={matching
        ? ['Bioptime matches you with a coach and tells you here when they are assigned.', 'The consultations and blood tests of the package are added to your balance until it ends.', 'Book blood tests from Tests, and consultations from Coach once your coach is assigned.']
        : ['The consultations and blood tests of the package are added to your balance until it ends.', 'Book blood tests from Tests, and consultations with your coach from Coach.']} /> : null}
      {paid && next.title !== 'Go home' ? <Beat at={BEATS.stepsAt[BEATS.stepsAt.length - 1]} rise={0}><Button title="Go home" variant="soft" onPress={() => router.replace('/(tabs)')} /></Beat> : null}
    </> : null}
    </StepSlide>

    <T v="caption" color={fx.ink.a50} center style={styles.note}>{config?.payments === 'simulator' ? '' : 'Payments are handled by the provider; Bioptime never sees your card or UPI details. '}Cancellations and refunds follow the terms.</T>
    <Button title="Your orders" variant="link" label="Your orders, in Profile" onPress={() => router.push('/(tabs)/profile?tab=orders')} style={styles.center} />
  </Overlay>;
}

/** A failed payment's notice shakes once as it arrives (the field shake of the Store checkout, M81); reduced motion:
 *  still (the error haptic is given by the caller either way). */
function Shake({ on, children }: { on: boolean; children: React.ReactNode }) {
  const { calm, inHtml } = useFx();
  const x = useSharedValue(0);
  useEffect(() => {
    if (!on || calm || inHtml) return;
    const keys = BEATS.shake;
    const step = BEATS.shakeMs / (keys.length - 1);
    x.value = withSequence(...keys.slice(1).map((k) => withTiming(k, timing(step, ease.cssInOut))));
  }, [on, calm, inHtml, x]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return <Animated.View style={a}>{children}</Animated.View>;
}

/** The order as the server priced it. */
function OrderTotals({ o }: { o: Order }) {
  return <View style={styles.total}>
    <KVRow label={o.packageName} value={inr(o.amountInr + o.gstInr + o.discountInr)} />
    {o.discountInr ? <KVRow label={o.couponCode ? `Promo ${o.couponCode}` : 'Discount'} value={`−${inr(o.discountInr)}`} valueColor={fx.hue.green400} /> : null}
    <KVRow label="GST included" value={inr(o.gstInr)} />
    <KVRow label="Total" value={inr(o.totalInr)} total divider={false} />
  </View>;
}

const styles = StyleSheet.create({
  gap: { gap: 16 },
  flex: { flex: 1 },
  band: { height: 132, justifyContent: 'flex-end' },
  bandText: { padding: 20, paddingBottom: 14, gap: 2 },
  cardBody: { paddingHorizontal: 20, paddingBottom: 20, paddingTop: 6, gap: 10 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  includes: { gap: 8, marginTop: 6, paddingTop: 14, borderTopWidth: 1, borderTopColor: fx.line.a05 },
  total: { borderRadius: fx.radius.three, borderWidth: 1, borderColor: fx.red.a20, backgroundColor: fx.red.a05, paddingHorizontal: 20, paddingVertical: 10 },
  payText: { marginTop: 6, marginBottom: 16 },
  payRow: { flexDirection: 'row', gap: 10 },
  payStack: { gap: 10 },
  refRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 10, marginBottom: 10, paddingHorizontal: 16, paddingVertical: 12, borderRadius: fx.radius.card, borderWidth: 1, borderColor: fx.line.a10, backgroundColor: fx.fill.a03 },
  ref: { letterSpacing: 2, flexShrink: 1 },
  refBox: { flexShrink: 1 },
  note: { marginTop: 8 },
  center: { alignSelf: 'center' },
});
