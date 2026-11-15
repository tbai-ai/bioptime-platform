/* The booking's confirmation (the earlier app's step 6, shots 73): the app's done moment (SuccessMark, the player's
   SESSION DONE: the red check disc popping in, the Bebas title rising; C15), "Booking confirmed" and when the visit is
   (or that the laboratory is still confirming the slot), the booking
   reference in mono with Copy (a light haptic and "Copied"), what happens next from the booking itself (the visit, the
   preparation, the laboratory's turnaround and expected date, the review), and the ways on: Profile › Orders, the
   booking, or back to Tests.
   Motion (v2, M81): a four-beat story: the done moment (the check with the success haptic and the title), the
   reference at +140 ms with its digits flashing once, the steps at +200/+260/+320/+380 while their rail draws (./Beats);
   the ways on follow the last step. The fasting line names the clock time to stop eating (the slot minus the
   laboratory's fasting hours, India time), next to the laboratory's own preparation text. */
import * as Clipboard from 'expo-clipboard';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { fmtDate } from '@/lib/format';
import { AnimatedPressable, Button, fx, haptics, Icon, T, toast, usePress } from '@/fx';
import { SuccessMark } from '@/screens/store/checkout';
import { BEATS, Beat, Flash, StepsRail } from './Beats';
import { Panel } from './Checkout';
import { fastFrom, whenParts, type Booking } from './model';

export function Confirmed({ b, reminders, onOrders, onBooking, onDone }: { b: Booking; reminders: boolean; onOrders: () => void; onBooking: () => void; onDone: () => void }) {
  const when = whenParts(b.slotAt);
  const t = b.test;
  // the clock time to stop eating, from the slot and the laboratory's fasting hours (once the slot is the laboratory's)
  const stopBy = b.vendorPending ? null : fastFrom(b.slotAt, t?.fastingHours);
  const steps = [
    b.vendorPending ? `A phlebotomist from the partner laboratory comes to ${b.address?.line ?? 'your address'} once the laboratory confirms ${when.day} at ${when.time}.`
      : `A phlebotomist from the partner laboratory comes to ${b.address?.line ?? 'your address'} on ${when.day} at ${when.time}.`,
    `${t?.preparation ? `Before the visit: ${t.preparation}` : t?.fastingHours ? `Fast for ${t.fastingHours} hours before the visit.` : 'No fasting is needed for this test.'}${stopBy ? ` Stop eating by ${stopBy}.` : ''}${reminders ? ' Bioptime sends one reminder before it, in Notifications.' : ''}`,
    `The laboratory reports within ${t?.turnaround ?? 'its usual time'}${b.expectedReportBy ? `, expected by ${fmtDate(b.expectedReportBy)}` : ''}.`,
    'A report reaches you after it has been reviewed: by your coach while health sharing is on, otherwise by the Bioptime team.',
  ];
  const last = BEATS.stepsAt[BEATS.stepsAt.length - 1];
  return <View style={styles.wrap}>
    <SuccessMark title="Booking confirmed" sub={b.vendorPending ? 'The laboratory is confirming the slot; you are told when it does.' : `Collection on ${when.day} at ${when.time}.`} />

    <Beat at={BEATS.refAt}>
      <Panel label="Your booking reference">
        <Reference value={b.reference} />
        <T v="caption" color={fx.ink.a50}>{`Quote this reference for any question about this collection. ${t?.name ?? 'Your test'} · counts ${b.consumesEntitlement ? 'against your package' : 'outside your package'}.`}</T>
      </Panel>
    </Beat>

    <Beat at={BEATS.stepsAt[0]} rise={0}>
      <Panel label="What happens next">
        <StepsRail railLeft={11} gap={14} steps={steps.map((s, i) => <View key={i} style={styles.step}>
          <View style={styles.num}><T v="micro" color={fx.red.label} style={styles.numText}>{String(i + 1)}</T></View>
          <T v="body" color={fx.ink.a80} style={styles.flex}>{s}</T>
        </View>)} />
      </Panel>
    </Beat>

    <Beat at={last} rise={0} style={styles.ways}>
      <Button title="View in Orders" variant="soft" iconRight="arrow-right" onPress={onOrders} style={styles.outline} />
      <View style={styles.links}>
        <Button title="Open the booking" variant="link" onPress={onBooking} />
        <Button title="Back to Tests" variant="link" iconRight={null} onPress={onDone} />
      </View>
    </Beat>
  </View>;
}

function Reference({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const press = usePress('chip');
  const copy = async () => {
    try { await Clipboard.setStringAsync(value); setCopied(true); haptics.light(); toast.logged('Copied'); setTimeout(() => setCopied(false), 2000); }
    catch { toast.error('Could not copy the reference.'); }
  };
  return <View style={styles.ref}>
    <Flash at={BEATS.refAt} style={styles.refBox}>
      <T v="metric24" style={styles.refText} selectable accessibilityLabel={`Booking reference ${value.split('').join(' ')}`}>{value}</T>
    </Flash>
    <AnimatedPressable accessibilityRole="button" accessibilityLabel={copied ? 'Copied' : 'Copy the booking reference'} onPress={copy} onPressIn={press.onPressIn} onPressOut={press.onPressOut} style={[styles.copy, press.style]}>
      <Icon name={copied ? 'check' : 'copy'} size={15} color={copied ? fx.hue.green400 : fx.ink.a60} />
      <T v="section" color={copied ? fx.hue.green400 : fx.ink.a60}>{copied ? 'Copied' : 'Copy'}</T>
    </AnimatedPressable>
  </View>;
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  flex: { flex: 1, minWidth: 0 },
  ways: { gap: 16 },
  refBox: { flex: 1 },
  ref: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 14, borderRadius: fx.radius.card, borderWidth: 1, borderColor: fx.line.a10, backgroundColor: fx.fill.a03 },
  refText: { letterSpacing: 2.4 },
  copy: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 6 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  num: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: fx.red.a10, borderWidth: 1, borderColor: fx.red.a30, marginTop: 1 },
  numText: { fontSize: 10 },
  outline: { minHeight: 52, borderRadius: fx.radius.card, borderColor: fx.line.a20, backgroundColor: fx.premium.transparent },
  links: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
});
