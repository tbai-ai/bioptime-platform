/* One blood-test booking (overlay; from Tests, Profile › Orders, notifications and next steps): the abstract band with
   the status and the collection day, the laboratory's flag, the details (collection, address, fasting, results,
   whether it counts against the package), the preparation for this collection (labFollowups on), the report once it
   is released, moving to another slot and cancelling while the API allows them (it checks with the laboratory
   first), and the timeline of every status change. Data: GET /me/bloodwork/bookings/:id; PATCH (move) and
   POST …/cancel. */
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Alert } from '@/lib/alert';
import { errorText, get, patch, post } from '@/lib/api';
import { useFeatures } from '@/lib/features';
import { fmtDate, fmtDateTime, label } from '@/lib/format';
import { FLAG as LAB_FOLLOWUPS, type Preparation } from '@/lib/modules/labFollowupsViews';
import { shownStatus } from '@/lib/today';
import { invalidate, useLoad } from '@/lib/useLoad';
import { Button, ErrorState, fx, haptics, KVRow, Notice, Overlay, Pill, Sheet, Skeleton, StaleBanner, T, toast, useFocusRefresh } from '@/fx';
import { BookingHero, MoveSheetBody, Timeline } from '@/screens/tests/BookingParts';
import { Panel } from '@/screens/tests/Checkout';
import { statusColour, type Booking, type Slot } from '@/screens/tests/model';
import { largeText } from '@/fx/layout';

export default function BookingRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const features = useFeatures(true);
  const followUps = !!features?.has(LAB_FOLLOWUPS);
  const b = useLoad<Booking>(`booking-${id}`, () => get(`/me/bloodwork/bookings/${id}`), [id]);
  const prep = useLoad<{ items: Preparation[] } | null>(followUps ? 'lab-preparation' : null, () => (followUps ? get('/me/lab-preparation') : Promise.resolve(null)), [followUps]);
  useFocusRefresh(() => Promise.all([b.reload(), prep.reload()]));
  const [moving, setMoving] = useState(false);
  const [busy, setBusy] = useState(false);
  // Move and Cancel booking side by side, or one over the other on a narrow phone or at a large text size, where half a
  // row broke and cut their labels ('Cancel booki…', SWB-06)
  const { width, fontScale } = useWindowDimensions();
  const stack = largeText(fontScale) || width < 360;
  const [moveError, setMoveError] = useState<string | null>(null);
  const d = b.data;
  const mine = d && followUps ? prep.data?.items.find((p) => p.bookingId === d.id) ?? null : null;
  const changed = () => { invalidate(['tests', 'bookings', 'entitlements', 'lab-preparation', 'me']); return b.reload(); };

  const cancel = () => {
    haptics.warning();
    Alert.alert('Cancel this booking?', 'The laboratory is told and the test goes back to your package.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel booking', style: 'destructive', onPress: async () => {
        try { await post(`/me/bloodwork/bookings/${id}/cancel`, { reason: 'cancelled in the app' }); await changed(); toast.success('Booking cancelled'); }
        catch (e) { toast.error(errorText(e)); }
      } },
    ]);
  };
  const move = async (s: Slot) => {
    setBusy(true); setMoveError(null);
    try { await patch(`/me/bloodwork/bookings/${id}`, { slotAt: s.startAt, labId: s.labId }); await changed(); setMoving(false); haptics.success(); toast.success('Collection moved'); }
    catch (e) { setMoveError(errorText(e)); haptics.error(); }
    finally { setBusy(false); }
  };

  // a collection whose slot has passed while it is still open reads "Awaiting update" here too (lib/today), as on Tests
  return <Overlay title={d?.test?.name ?? 'Booking'} subtitle={d ? `${d.reference} · ${label(shownStatus(d))}` : undefined} fallback="/(tabs)/tests"
    hero={d ? <BookingHero b={d} extra={<>{d.simulated ? <Pill tone="sample">Simulated</Pill> : null}</>} /> : null}>
    <StaleBanner at={b.stale} />
    <ErrorState error={b.error} onRetry={b.reload} />
    {b.loading && !d ? <View style={styles.gap}><Skeleton height={190} radius={fx.radius.three} /><Skeleton height={220} radius={fx.radius.three} /></View> : null}
    {d ? <>
      {d.flag ? <Notice kind="warning" title="From the laboratory">{label(d.flag)}</Notice> : null}
      {d.status === 'cancelled' && d.cancelledReason ? <Notice kind="info" title="Cancelled">{label(d.cancelledReason)}</Notice> : null}

      <View style={[styles.card, { borderTopColor: statusColour(shownStatus(d)) }]}>
        <T v="label" color={fx.ink.ink2} accessibilityRole="header">Details</T>
        <View>
          <KVRow label="Collection" value={fmtDateTime(d.slotAt)} />
          <KVRow label="Address" value={<T v="body" style={styles.value}>{[d.address?.line, [d.address?.city, d.address?.pincode].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '—'}</T>} />
          <KVRow label="Fasting" value={d.test?.fastingHours ? `${d.test.fastingHours} hours before` : 'Not needed'} />
          <KVRow label="Results" value={d.expectedReportBy ? `by ${fmtDate(d.expectedReportBy)}` : d.test?.turnaround ?? '—'} />
          <KVRow label="Counts" value={d.consumesEntitlement ? 'against your package' : 'not against your package'} divider={false} />
        </View>
      </View>

      {mine ? <Panel label="Before your collection" tint>
        <T v="body" color={fx.ink.a90}>{mine.preparation ? `The laboratory’s preparation: ${mine.preparation}` : mine.fastingHours ? `The laboratory asks for ${mine.fastingHours} hours of fasting before collection.` : 'The laboratory lists no preparation for this test.'}</T>
        {mine.rebookPending ? <T v="caption" color={fx.hue.amber400}>The Bioptime team is arranging a new visit.</T> : null}
        <T v="caption" color={fx.ink.a60}>{mine.reminder ? (mine.reminder.status === 'queued' ? `Reminder on ${fmtDateTime(mine.reminder.dueAt)}, in Notifications.` : mine.reminder.status === 'sent' ? `Reminder sent ${fmtDateTime(mine.reminder.dueAt)}.` : 'Reminders are off in your notification settings.') : 'A reminder is set shortly before the collection.'}</T>
      </Panel> : null}

      {d.report?.released ? <Button title="Open report" icon="file-text" shape="flow" onPress={() => router.push({ pathname: '/report/[id]', params: { id: d.report!.id } })} />
        : d.report ? <Notice kind="info" title="Report">{d.report.reviewerKind === 'team' ? 'Report with the Bioptime team for review.' : 'Report with your coach for review.'}</Notice> : null}
      {d.canReschedule || d.canCancel ? <View style={stack ? styles.stack : styles.actions}>
        {d.canReschedule ? <View style={stack ? null : styles.flex}><Button title="Move" variant="soft" icon="calendar" onPress={() => { setMoveError(null); setMoving(true); }} label="Move to another slot" /></View> : null}
        {d.canCancel ? <View style={stack ? null : styles.flex}><Button title="Cancel booking" variant="redGlass" icon="circle-x" onPress={cancel} /></View> : null}
      </View> : null}

      <Panel label="Timeline">
        <Timeline events={d.timeline ?? []} />
      </Panel>
      <T v="caption" color={fx.ink.a60}>Status changes come from the laboratory or the review of your report. A result outside a range is not a diagnosis.</T>
    </> : null}

    <Sheet visible={moving && !!d} onClose={() => setMoving(false)} title="Move the collection">
      {d ? <MoveSheetBody b={d} onMove={move} busy={busy} error={moveError} /> : null}
    </Sheet>
  </Overlay>;
}

const styles = StyleSheet.create({
  gap: { gap: 16 },
  flex: { flex: 1 },
  card: { backgroundColor: fx.bg.panelSolid, borderRadius: fx.radius.three, borderWidth: 1, borderColor: fx.line.a10, borderTopWidth: 2, padding: 20, gap: 8 },
  value: { flex: 1, textAlign: 'right' },
  actions: { flexDirection: 'row', gap: 12 },
  stack: { gap: 12 },
});
