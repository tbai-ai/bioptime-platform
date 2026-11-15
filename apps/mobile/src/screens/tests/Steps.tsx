/* The five steps of Book a test, in the earlier app's checkout layout (shots 64–72), with Bioptime's own content:
   1 the test (choose one, then its card, what the package covers and what is included: nothing to pay),
   2 your details (name and number from the profile, saved back to it when changed; the sign-in email; gender and date
     of birth, which the laboratory also receives; the laboratory-sharing sentence),
   3 the collection address (prefilled from the profile, used for this collection only),
   4 the appointment (SlotPicker), 5 the review (cards, the package line, the simulated note, the sharing and cancelling
   sentence). Each step only draws; BookTestScreen holds the state and the calls. */
import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { fmtDate, label } from '@/lib/format';
import { Button, Field, fx, IconInput, KVRow, Notice, OptionCard, T } from '@/fx';
import { FitText } from '@/fx/wordFit';
import { CheckLine, RedChip } from './parts';
import { DetailRow, Panel } from './Checkout';
import { fastingText, markersText, slotTimeIst, testChips, testLine, whenParts, type Balance, type LabTest, type Profile, type Slot } from './model';

/* ---------- 1. the test ---------- */

export function StepTest({ tests, test, picking, onPick, onChange, balance, blocked, coachReviews }: {
  tests: LabTest[]; test: LabTest | null; picking: boolean; onPick: (t: LabTest) => void; onChange: () => void;
  balance: Balance | null; blocked: string | null; coachReviews: boolean;
}) {
  return <>
    {blocked ? <Notice kind="warning" title="Booking is not open">{blocked}</Notice> : null}
    {picking || !test ? <View style={styles.group}>
      <T v="label" color={fx.ink.ink2} accessibilityRole="header">Choose a test</T>
      <View accessibilityRole="radiogroup" style={styles.options}>
        {tests.map((t) => <OptionCard key={t.id} title={t.name} icon={t.kind === 'package' ? 'layers' : 'test-tube'} selected={t.id === test?.id} onPress={() => onPick(t)}
          description={[markersText(t.markers), fastingText(t).toLowerCase(), `results in ${t.turnaround}`].filter(Boolean).join(' · ')} descriptionColor={fx.ink.ink2} />)}
      </View>
    </View> : <>
      <Panel>
        <View style={styles.chips}>{[...testChips(test), markersText(test.markers)].filter(Boolean).map((c) => <RedChip key={c!}>{c!}</RedChip>)}</View>
        {/* a long name keeps its words whole, or breaks one with a hyphen when it cannot (R1-04: 'Comprehe/nsive') */}
        <FitText v="heading" style={styles.testName}>{test.name}</FitText>
        {testLine(test) ? <T v="body" color={fx.ink.a60} style={styles.lead}>{testLine(test)}</T> : null}
        <View style={styles.change}><Button title="Choose another test" variant="link" onPress={onChange} /></View>
      </Panel>
      <Panel label="Your package">
        <View>
          <KVRow label="Blood tests left" value={balance ? `${balance.remaining}\u00a0of\u00a0${balance.total}` : '—'} />
          <KVRow label="This booking uses" value="1 home collection" divider={false} />
        </View>
        <View style={styles.total}><KVRow label="To pay" value="Included" total divider={false} /></View>
      </Panel>
      <Panel label="What’s included">
        <CheckLine>A home collection at your address by a phlebotomist from the partner laboratory</CheckLine>
        {test.markers ? <CheckLine>{`${markersText(test.markers)} measured by the laboratory`}</CheckLine> : null}
        <CheckLine>{`Laboratory turnaround: ${test.turnaround}`}</CheckLine>
        <CheckLine>{test.preparation ? `Preparation: ${test.preparation}` : test.fastingHours ? `Fast for ${test.fastingHours} hours before the visit` : 'No fasting needed'}</CheckLine>
        <CheckLine>{coachReviews ? 'Reviewed by your coach before the report reaches you' : 'Reviewed by the Bioptime team before the report reaches you'}</CheckLine>
      </Panel>
    </>}
  </>;
}

/* ---------- 2. your details ---------- */

export type Details = { name: string; phone: string };

export function StepDetails({ details, onChange, errors, profile, phoneChanged }: {
  details: Details; onChange: (d: Details) => void; errors: Partial<Record<keyof Details, string>>; profile: Profile | null; phoneChanged: boolean;
}) {
  const p = profile?.profile;
  return <>
    <Field label="Full name" error={errors.name}>
      <IconInput icon="user" value={details.name} onChangeText={(v) => onChange({ ...details, name: v })} autoComplete="name" textContentType="name" autoCapitalize="words" placeholder="Your full name" />
    </Field>
    <Field label="Contact number" error={errors.phone} hint={phoneChanged ? 'Saved to your profile when you continue; a new number needs verifying again.' : undefined}>
      <IconInput icon="smartphone" value={details.phone} onChangeText={(v) => onChange({ ...details, phone: v })} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" placeholder="+919812345678" />
    </Field>
    <Field label="Email address" hint="Your sign-in email">
      <IconInput icon="mail" value={profile?.email ?? ''} editable={false} selectTextOnFocus={false} />
    </Field>
    <Panel label="Also shared with the laboratory">
      <View>
        <KVRow label="Gender" value={p?.gender ? label(p.gender) : 'Not set'} />
        <KVRow label="Date of birth" value={p?.dateOfBirth ? fmtDate(`${p.dateOfBirth}T12:00:00Z`) : 'Not set'} divider={false} />
      </View>
      <View style={styles.change}><Button title="Change these in your profile" variant="link" onPress={() => router.push('/settings/profile')} /></View>
    </Panel>
    <T v="bodySm" color={fx.ink.a60}>Booking shares your name, phone, email, gender, date of birth and collection address with the laboratory for this collection only.</T>
  </>;
}

/* ---------- 3. the address ---------- */

export type Address = { address: string; city: string; state: string; pincode: string };

export function StepAddress({ value, onChange, errors }: { value: Address; onChange: (a: Address) => void; errors: Partial<Record<keyof Address, string>> }) {
  const set = (k: keyof Address) => (v: string) => onChange({ ...value, [k]: k === 'pincode' ? v.replace(/\D/g, '').slice(0, 6) : v });
  return <>
    <Field label="Full address" error={errors.address}>
      <IconInput icon="house" value={value.address} onChangeText={set('address')} multiline numberOfLines={3} textAlignVertical="top" autoComplete="street-address" placeholder="House, street and area" style={styles.multiline} />
    </Field>
    <Field label="City" error={errors.city}>
      <IconInput icon="map-pin" value={value.city} onChangeText={set('city')} autoComplete="postal-address-locality" placeholder="City" />
    </Field>
    <Field label="State" error={errors.state}>
      <IconInput icon="globe" value={value.state} onChangeText={set('state')} autoComplete="postal-address-region" placeholder="State" />
    </Field>
    <Field label="PIN code" error={errors.pincode}>
      <IconInput icon="target" value={value.pincode} onChangeText={set('pincode')} keyboardType="number-pad" maxLength={6} autoComplete="postal-code" placeholder="6 digits" />
    </Field>
    <T v="bodySm" color={fx.ink.a60}>This address is used for this collection only; your profile keeps its own. Slots depend on the PIN code.</T>
  </>;
}

/* ---------- 5. review ---------- */

export function StepReview({ test, details, email, address, slot, balance, simulatedNotice, error }: {
  test: LabTest; details: Details; email: string; address: Address; slot: Slot; balance: Balance | null; simulatedNotice: React.ReactNode; error: string | null;
}) {
  const when = whenParts(slot.startAt);
  return <>
    <Panel label="Test">
      <DetailRow icon="flask-conical" label={test.name} value="Included" />
    </Panel>
    <Panel label="Personal details">
      <DetailRow icon="user" label="Name" value={details.name.trim()} />
      <DetailRow icon="smartphone" label="Phone" value={details.phone.trim()} />
      <DetailRow icon="mail" label="Email" value={email} />
    </Panel>
    <Panel label="Collection address">
      <T v="body" color={fx.ink.white} style={styles.address}>{`${address.address.trim()}\n${address.city.trim()}, ${address.state.trim()} – ${address.pincode}`}</T>
    </Panel>
    <Panel label="Appointment">
      <DetailRow icon="calendar" label={when.day} value={slotTimeIst(slot)} strong />
      {slot.labName ? <T v="caption" color={fx.ink.a60}>{slot.labName}</T> : null}
    </Panel>
    <Panel tint>
      <View>
        <KVRow label="Blood tests left" value={balance ? String(balance.remaining) : '—'} />
        <KVRow label="After this booking" value={balance ? String(Math.max(0, balance.remaining - 1)) : '—'} divider={false} />
      </View>
      <View style={styles.total}><KVRow label="To pay" value="Included" total divider={false} /></View>
    </Panel>
    {simulatedNotice}
    {error ? <Notice kind="error" title="Not booked">{error}</Notice> : null}
    <T v="bodySm" color={fx.ink.a60}>Booking shares your name, phone, email, gender, date of birth and collection address with the laboratory for this collection only. You can cancel or move it from the booking screen while those buttons show: until shortly before the slot, and only before the sample is collected.</T>
  </>;
}

const styles = StyleSheet.create({
  group: { gap: 12 },
  options: { gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  testName: { fontSize: 20, lineHeight: 28 },
  lead: { fontSize: 15, lineHeight: 24 },
  change: { alignItems: 'flex-start', marginTop: -4 },
  total: { borderTopWidth: 1, borderTopColor: fx.line.a10, paddingTop: 6 },
  multiline: { alignItems: 'flex-start', minHeight: 96 },
  address: { fontSize: 15, lineHeight: 24 },
});
