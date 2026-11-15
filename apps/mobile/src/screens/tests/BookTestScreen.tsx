/* Book a test (the `book-test` overlay) in the earlier app's five-step checkout (BloodWorkCheckout, shots 64–73;
   tx-open-bloodwork-checkout-*, tx-checkout-step-next-*), on Bioptime's booking route:
   1 Book a blood test: choose the test (preselected by `?test=` from a catalogue card), what the package covers;
   2 Your details: GET /me/profile, PATCH /me/profile when the name or number changed;
   3 Collection address: the profile's address, editable for this collection;
   4 Appointment: the laboratory's slots for the day and PIN code (GET /me/bloodwork/slots);
   5 Review and book: POST /me/bloodwork/bookings (one idempotency key per attempt), no payment ("Included");
   6 Booking confirmed: the reference with Copy, what happens next, Profile › Orders.
   Booking is closed (with the reason) when the package has no test left, when the laboratory consent or the health
   consent is off: the same rules as the API. The simulated-laboratory note comes from the route file (word for word)
   and shows on the review while the laboratory is the stand-in. Android back goes one step back. */
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { errorText, get, patch, post, randomKey } from '@/lib/api';
import { useFeatures } from '@/lib/features';
import { FLAG as LAB_FOLLOWUPS } from '@/lib/modules/labFollowupsViews';
import { useLoad, invalidate } from '@/lib/useLoad';
import { closeOverlay, COLUMN, ErrorState, fx, haptics, Skeleton, useOwnChrome } from '@/fx';
import { CheckoutFooter, CheckoutHeader, StepSlide, STEP_NAMES } from './Checkout';
import { Confirmed } from './Confirmed';
import { orderTests, type Booking, type Profile, type Slot, type TestsPayload } from './model';
import { SlotPicker } from './SlotPicker';
import { StepAddress, StepDetails, StepReview, StepTest, type Address, type Details } from './Steps';

const PHONE = /^\+?[1-9]\d{7,14}$/;
const cleanPhone = (v: string) => v.replace(/[\s()-]/g, '');

export default function BookTestScreen({ simulatedNotice }: { simulatedNotice: React.ReactNode }) {
  useOwnChrome(); // the checkout header replaces the stack's
  const params = useLocalSearchParams<{ test?: string }>();
  const features = useFeatures(true);
  const tests = useLoad<TestsPayload>('tests', () => get('/me/bloodwork/tests'), []);
  const profile = useLoad<Profile>('profile', () => get('/me/profile'), []);
  const [step, setStep] = useState(1);
  const [dir, setDir] = useState(0);
  const [testId, setTestId] = useState<string | null>(params.test ?? null);
  const [picking, setPicking] = useState(!params.test);
  const [details, setDetails] = useState<Details>({ name: '', phone: '' });
  const [address, setAddress] = useState<Address>({ address: '', city: '', state: '', pincode: '' });
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [booked, setBooked] = useState<Booking | null>(null);
  const key = useRef(randomKey());
  const filled = useRef(false);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);

  const d = tests.data;
  const p = profile.data;
  useEffect(() => {
    if (!p || filled.current) return;
    filled.current = true;
    setDetails({ name: p.name ?? '', phone: p.phone ?? '' });
    setAddress({ address: p.profile?.address ?? '', city: p.profile?.city ?? '', state: p.profile?.state ?? '', pincode: p.profile?.pincode ?? '' });
  }, [p]);

  const list = useMemo(() => orderTests(d?.items ?? []), [d]);
  const test = list.find((t) => t.id === testId) ?? null;
  const balance = d?.entitlement ?? null;
  const labOk = !!d?.consents?.lab_consent?.granted, healthOk = !!d?.consents?.health_data?.granted;
  const blocked = !d ? null
    : !balance || balance.total < 1 ? 'No blood tests are included in your package yet. A Bioptime package includes them.'
      : balance.remaining < 1 ? 'Your package’s tests are used up. Pay-per-test is not available yet; a new package includes more.'
        : !labOk ? 'Booking shares your name, phone, email, gender, date of birth and collection address with the laboratory. Turn on "Share my details with the partner laboratory" under Privacy and sharing in your Profile settings.'
          : !healthOk ? 'Turn on "Process my health information" under Privacy and sharing in your Profile settings.' : null;
  const phoneChanged = !!p && cleanPhone(details.phone) !== (p.phone ?? '');

  const go = (n: number) => {
    setDir(n > step ? 1 : -1); setStep(n); setErrors({});
    scroll.current?.scrollTo({ y: 0, animated: false });
    haptics.step();
  };
  const back = () => { if (step > 1 && !booked) go(step - 1); };
  const close = () => closeOverlay('/(tabs)/tests');

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { if (step > 1 && !booked) { back(); return true; } return false; });
    return () => sub.remove();
  }); // re-registered each render so it sees the current step

  const saveDetails = async () => {
    const e: Record<string, string> = {};
    if (details.name.trim().length < 2) e.name = 'Enter your full name.';
    if (!PHONE.test(cleanPhone(details.phone))) e.phone = 'Enter the number with its country code, like +919812345678';
    setErrors(e);
    if (Object.keys(e).length) { haptics.error(); return; }
    const changes: Record<string, string> = {};
    if (p && details.name.trim() !== p.name) changes.name = details.name.trim();
    if (phoneChanged) changes.phone = cleanPhone(details.phone);
    if (Object.keys(changes).length) {
      setBusy(true);
      try { await patch('/me/profile', changes); invalidate(['profile', 'me']); }
      catch (err) { setErrors({ [changes.phone ? 'phone' : 'name']: errorText(err) }); setBusy(false); return; }
      setBusy(false);
    }
    go(3);
  };

  const checkAddress = () => {
    const e: Record<string, string> = {};
    if (address.address.trim().length < 5) e.address = 'Enter the house, street and area.';
    if (address.city.trim().length < 2) e.city = 'Enter the city.';
    if (address.state.trim().length < 2) e.state = 'Enter the state.';
    if (!/^\d{6}$/.test(address.pincode)) e.pincode = 'Enter a 6-digit PIN code';
    setErrors(e);
    if (Object.keys(e).length) { haptics.error(); return; }
    go(4);
  };

  const book = async () => {
    if (!test || !slot) return;
    setBusy(true); setFailure(null);
    try {
      const r = await post<Booking>('/me/bloodwork/bookings', {
        testId: test.id, slotAt: slot.startAt, labId: slot.labId, pincode: address.pincode,
        address: address.address.trim(), city: address.city.trim(), state: address.state.trim(), idempotencyKey: key.current,
      });
      key.current = randomKey();
      invalidate(['tests', 'bookings', 'entitlements', 'lab-preparation', 'me', 'programme']);
      if (r.status === 'cancelled') {
        haptics.error();
        setFailure(`The laboratory could not take this order${r.cancelledReason ? `: ${r.cancelledReason}` : ''}. Nothing is booked and your test is still available; try another slot or PIN code.`);
        setSlot(null);
        return;
      }
      setBooked(r); setDir(1); setStep(6);
      scroll.current?.scrollTo({ y: 0, animated: false });
    } catch (e) { haptics.error(); setFailure(errorText(e)); }
    finally { setBusy(false); }
  };

  const loading = (tests.loading && !d) || (profile.loading && !p);
  const footer = booked ? null : step === 1 ? { title: 'Continue', onNext: () => go(2), disabled: !test || !!blocked }
    : step === 2 ? { title: 'Continue', onNext: saveDetails, disabled: !p }
      : step === 3 ? { title: 'Continue', onNext: checkAddress }
        : step === 4 ? { title: 'Review booking', onNext: () => go(5), disabled: !slot }
          : { title: 'Book this collection', onNext: book, disabled: !test || !slot || !!blocked, icon: 'calendar-check' as const, caption: 'Included in your package: nothing to pay' };

  return <View style={styles.screen}>
    <CheckoutHeader step={booked ? STEP_NAMES.length : step} done={!!booked} onClose={close} />
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
      <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, { paddingBottom: booked ? 48 : 180 }]}>
        <ErrorState error={tests.error ?? profile.error} onRetry={() => { void tests.reload(); void profile.reload(); }} />
        {loading ? <View style={styles.gap}><Skeleton height={180} radius={fx.radius.three} /><Skeleton height={140} radius={fx.radius.three} /><Skeleton height={220} radius={fx.radius.three} /></View>
          : <StepSlide key={booked ? 'done' : step} dir={dir}>
            {booked ? <Confirmed b={booked} reminders={!!features?.has(LAB_FOLLOWUPS)}
              onOrders={() => router.replace({ pathname: '/(tabs)/profile', params: { tab: 'orders' } })}
              onBooking={() => router.replace({ pathname: '/booking/[id]', params: { id: booked.id } })}
              onDone={close} />
              : step === 1 ? <StepTest tests={list} test={test} picking={picking} balance={balance} blocked={blocked}
                coachReviews={!!d?.consents?.coach_sharing?.granted}
                onPick={(t) => { setTestId(t.id); setPicking(false); haptics.light(); }} onChange={() => setPicking(true)} />
                : step === 2 ? <StepDetails details={details} onChange={setDetails} errors={errors} profile={p} phoneChanged={phoneChanged} />
                  : step === 3 ? <StepAddress value={address} onChange={(a) => { if (a.pincode !== address.pincode) { setSlot(null); } setAddress(a); }} errors={errors} />
                    : step === 4 ? <SlotPicker pincode={address.pincode} day={day} onDay={(v) => { setDay(v); setSlot(null); }} slot={slot} onSlot={setSlot} />
                      : test && slot ? <StepReview test={test} details={details} email={p?.email ?? ''} address={address} slot={slot} balance={balance}
                        simulatedNotice={d?.vendor === 'standin' ? simulatedNotice : null} error={failure} /> : null}
          </StepSlide>}
      </ScrollView>
      {footer && !loading ? <CheckoutFooter step={step} onBack={back} title={footer.title} icon={'icon' in footer ? footer.icon : undefined}
        onNext={footer.onNext} disabled={footer.disabled} busy={busy} caption={'caption' in footer ? footer.caption : undefined} /> : null}
    </KeyboardAvoidingView>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: fx.bg.base },
  fill: { flex: 1 },
  content: { width: '100%', maxWidth: COLUMN, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 20 },
  gap: { gap: 16 },
});
