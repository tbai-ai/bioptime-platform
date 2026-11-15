/* Tests (tab 7, "Clinic"; the earlier app's DiagnosticsTab, shots 63-tests-diagnostics*): the member's blood tests at
   home, from Bioptime's laboratory flow.
   1. Header "Clinic" / "Your blood tests at home" over the abstract header band (ph-tests-abstract, .22).
   2. The "Simulated laboratory" notice first, word for word, while the laboratory is the stand-in (the route file holds
      the notice; it only fades in).
   3. The featured card: the package's balance ("{n} of {m} blood tests left", rows by id), the consent warning and the
      white "Book a test" (FeaturedCard).
   4. Bookings: the open ones as the earlier app's order cards; the next collection carries the laboratory's preparation
      and Bioptime's reminder (labFollowups on). By the shared rule (lib/today, A1W-m5) a collection is upcoming only
      while its slot is still to come; one whose slot has passed while the laboratory still has it open is counted and
      shown as awaiting its update, and one the laboratory already has (collected, processing, results ready) as in
      progress: "1 upcoming · 1 awaiting update".
   5. Reports: every released report with what the laboratory put outside its range.
   6. The catalogue ("{n} available"): test cards with abstract photos and the "Book this test" button while a test is
      left. 7. Past bookings.
   Data: GET /me/bloodwork/tests (catalogue, balance, consents, vendor), /me/entitlements (rows), /me/bloodwork/bookings,
   /me/reports, and /me/lab-preparation while labFollowups is on. Refreshes on focus and on return to the app (a
   laboratory status change or a released report arrives this way), and after a booking.
   Motion (v2, M80): the reports, the catalogue and the past bookings are below the fold: they mount after the page has settled
   (Deferred, holding the height of the last visit). */
import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { get } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { FLAG as LAB_FOLLOWUPS, type Preparation } from '@/lib/modules/labFollowupsViews';
import { useFeatures } from '@/lib/features';
import { heldByBookings, isAwaitingUpdate, isUpcoming } from '@/lib/today';
import { EmptyState, ErrorState, fx, Reveal, RevealScope, ScreenHeader, Skeleton, StaleBanner, T, TabScreen, TabTitleBar, useFocusRefresh, useTabScroll } from '@/fx';
import { Deferred } from '@/fx/nav/Deferred';
import { CatalogueCard } from './CatalogueCard';
import { FeaturedCard } from './FeaturedCard';
import { bloodworkRows, isOpenBooking, orderTests, type Booking, type EntitlementsPayload, type Report, type TestsPayload } from './model';
import { BookingCard, SectionTitle } from './parts';
import { ReportCard } from './ReportCard';

export default function TestsScreen({ simulatedNotice }: { simulatedNotice: React.ReactNode }) {
  const features = useFeatures(true);
  const followUps = !!features?.has(LAB_FOLLOWUPS);
  const tests = useLoad<TestsPayload>('tests', () => get('/me/bloodwork/tests'), []);
  const ents = useLoad<EntitlementsPayload>('entitlements', () => get('/me/entitlements'), []);
  const bookings = useLoad<{ items: Booking[] }>('bookings', () => get('/me/bloodwork/bookings'), []);
  const reports = useLoad<{ items: Report[] }>('reports', () => get('/me/reports'), []);
  const prep = useLoad<{ items: Preparation[]; timing: string } | null>(followUps ? 'lab-preparation' : null, () => (followUps ? get('/me/lab-preparation') : Promise.resolve(null)), [followUps]);
  const reload = () => Promise.all([tests.reload(), ents.reload(), bookings.reload(), reports.reload(), prep.reload()]);
  const { refreshing, onRefresh } = useFocusRefresh(reload);

  const d = tests.data;
  const rows = useMemo(() => bloodworkRows(ents.data?.items), [ents.data]);
  const balance = d?.entitlement ?? ents.data?.bloodwork ?? rows.sum;
  const consent = d ? { lab: !!d.consents?.lab_consent?.granted, health: !!d.consents?.health_data?.granted } : null;
  const canBook = !!balance && balance.remaining > 0 && !!consent && consent.lab && consent.health;
  const all = bookings.data?.items ?? [];
  const open = all.filter(isOpenBooking).sort((a, b) => a.slotAt.localeCompare(b.slotAt));
  const past = all.filter((b) => !isOpenBooking(b));
  const upcoming = open.filter((b) => isUpcoming(b)).length;
  const awaiting = open.filter((b) => isAwaitingUpdate(b)).length;
  const inProgress = open.length - upcoming - awaiting; // collected: the laboratory has it
  // each part's words stay together on a line (only the ' · ' between them may break: POL2R-6)
  const openCount = [upcoming ? `${upcoming}\u00a0upcoming` : null, awaiting ? `${awaiting}\u00a0awaiting\u00a0update` : null, inProgress ? `${inProgress}\u00a0in\u00a0progress` : null].filter(Boolean).join(' · ');
  // the balance's held count by the same rule (a held collection past its slot is awaiting its update, not booked)
  const held = balance ? heldByBookings(balance.reserved, bookings.data ? all.filter((b) => b.consumesEntitlement) : []) : null;
  const prepFor = (b: Booking) => (followUps ? prep.data?.items.find((p) => p.bookingId === b.id) ?? null : null);
  const nextPrep = open.find((b) => prepFor(b))?.id ?? null; // the laboratory's preparation sits on the next collection
  const catalogue = orderTests(d?.items ?? []);
  const openBooking = (b: Booking) => router.push({ pathname: '/booking/[id]', params: { id: b.id } });
  const book = (testId?: string) => router.push(testId ? { pathname: '/book-test', params: { test: testId } } : '/book-test');
  const loading = tests.loading && !d;

  return <TabScreen refreshing={refreshing} onRefresh={onRefresh} sticky={<TabTitleBar title="Clinic" />}>
    <ScreenHeader title="Clinic" subtitle="Your blood tests at home" photo={{ slot: 'tests.header', look: 'band' }} />
    <Body>
      {d?.vendor === 'standin' ? <Reveal mount from="fade" id="tests.notice">{simulatedNotice}</Reveal> : null}
      <StaleBanner at={tests.stale} />
      <ErrorState error={tests.error} onRetry={reload} />
      {loading ? <Placeholder /> : <>
        {d ? <Reveal mount index={0} id="tests.featured">
          <FeaturedCard balance={balance} held={held} rows={rows.rows} consent={consent} onBook={() => book()} />
        </Reveal> : null}

        <View style={styles.section}>
          <SectionTitle title="Bookings" count={openCount || undefined} />
          <ErrorState error={tests.error ? null : bookings.error} onRetry={bookings.reload} />
          {bookings.loading && !bookings.data ? <Skeleton height={150} radius={fx.radius.card} />
            : open.length ? open.map((b, i) => <Reveal key={b.id} index={i} id={`tests.booking.${b.id}`}>
              <BookingCard b={b} prep={b.id === nextPrep ? prepFor(b) : null} onPress={() => openBooking(b)} />
            </Reveal>)
            : <EmptyState icon="calendar" title="No upcoming bookings" body={canBook ? 'Book a home collection and it shows here with its status.' : 'A booked home collection shows here with its status.'} />}
          {followUps && prep.data?.timing && upcoming ? <T v="caption" color={fx.ink.a60}>{`${prep.data.timing} Reminders arrive in Notifications.`}</T> : null}
        </View>

        <Deferred id="tests.below" style={styles.below}>
          <View style={styles.section}>
            <SectionTitle title="Reports" count={reports.data?.items.length ? `${reports.data.items.length} released` : undefined} />
            <ErrorState error={tests.error ? null : reports.error} onRetry={reports.reload} />
            {reports.loading && !reports.data ? <Skeleton height={110} radius={fx.radius.three} />
              : reports.data?.items.length ? reports.data.items.map((r, i) => <Reveal key={r.id} index={i} id={`tests.report.${r.id}`}>
                <ReportCard r={r} onPress={() => router.push({ pathname: '/report/[id]', params: { id: r.id } })} />
              </Reveal>)
              : <EmptyState icon="file-text" photo="report" title="No released reports" body="A report reaches you after it has been reviewed: by your coach while health sharing is on, otherwise by the Bioptime team." />}
          </View>

          {catalogue.length ? <View style={styles.section}>
            <SectionTitle title="Tests you can book" count={`${catalogue.length} available`} />
            {catalogue.map((t, i) => <Reveal key={t.id} index={i % 3} id={`tests.catalogue.${t.id}`}>
              <CatalogueCard test={t} index={i} canBook={canBook} onBook={() => book(t.id)} />
            </Reveal>)}
            <T v="caption" color={fx.ink.a60} center>Tests are booked against your package’s included collections.</T>
          </View> : null}

          {past.length ? <View style={styles.section}>
            <SectionTitle title="Past bookings" count={`${past.length}`} />
            {past.map((b, i) => <Reveal key={b.id} index={i} id={`tests.past.${b.id}`}>
              <BookingCard b={b} compact onPress={() => openBooking(b)} />
            </Reveal>)}
          </View> : null}
        </Deferred>
      </>}
    </Body>
  </TabScreen>;
}

/** The page's sections, revealed as they scroll in. */
function Body({ children }: { children: React.ReactNode }) {
  const scrollY = useTabScroll();
  const inner = <View style={styles.body}>{children}</View>;
  return scrollY ? <RevealScope scrollY={scrollY}>{inner}</RevealScope> : inner;
}

function Placeholder() {
  return <View style={styles.section} accessibilityLabel="Loading">
    <Skeleton height={300} radius={fx.radius.three} />
    <Skeleton height={150} radius={fx.radius.card} />
    <Skeleton height={110} radius={fx.radius.three} />
  </View>;
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: fx.space.cardX, paddingTop: 8, gap: 32 },
  section: { gap: 14 },
  below: { gap: 32 },
});
