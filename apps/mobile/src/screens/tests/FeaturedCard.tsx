/* The Clinic's featured card (the earlier app's "Full-Body Baseline" card, shot 63): a 24-radius glass card that tilts
   (intensity 5, the screen's hero), a 48 pt stethoscope tile with a red glow, the title and a red overline, then, in
   Bioptime's terms, the member's package balance: "{n} of {m} blood tests left" in Bebas with n counting up, what is
   booked (a held collection whose slot has passed while it is still open is "awaiting update", lib/today
   heldByBookings, as on Home) and used, one row per entitlement when there is more than one (rows are keyed by id: a package and an
   adjustment can both be blood tests), the sentence on what one included test is, the consent warning, and the white
   block "Book a test" (disabled with its reason). With no blood tests included: "No blood tests included yet" and the
   way to a package. On native its device tilt runs only while it is on screen (HeroTilt). */
import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { fmtDate } from '@/lib/format';
import { Button, CountUp, fx, GlassCard, motionValues, Notice, NoticeText, T, typeScale } from '@/fx';
import { Beside } from '@/fx/wordFit';
import { HeroTilt } from './RowTilt';
import { IconTile } from './parts';
import { rowName, type Balance, type EntitlementRow } from './model';

export function FeaturedCard({ balance, held, rows, consent, onBook }: {
  balance: Balance | null; held?: { booked: number; awaiting: number } | null; rows: EntitlementRow[]; consent: { lab: boolean; health: boolean } | null; onBook: () => void;
}) {
  const has = !!balance && balance.total > 0;
  const consentOk = !consent || (consent.lab && consent.health);
  const left = balance?.remaining ?? 0;
  const canBook = has && left > 0 && consentOk;
  const packages = [...new Set(rows.map((r) => r.packageName).filter(Boolean))] as string[];
  const split = held ?? { booked: balance?.reserved ?? 0, awaiting: 0 };
  // a row's own held count, worded by the split when every held one is on the same side of it (a row's bookings are
  // not known one by one): "booked", "awaiting update", else "held"
  const rowHeld = (n: number) => `${n} ${!split.awaiting ? 'booked' : !split.booked ? 'awaiting update' : 'held'}`;
  const summary = has ? [
    split.booked ? `${split.booked} booked and held` : null,
    split.awaiting ? `${split.awaiting} awaiting update` : null,
    balance!.used ? `${balance!.used} used` : null,
    balance!.expiresAt ? `until ${fmtDate(balance!.expiresAt)}` : null,
  ].filter(Boolean).join(' · ') : '';
  const headline = has ? `${left} of ${balance!.total} blood test${balance!.total === 1 ? '' : 's'} left` : 'No blood tests included yet';
  return <HeroTilt intensity={motionValues.tilt.featured} hero radius={fx.radius.three}>
    <GlassCard variant="three" padding={24} borderColor={fx.line.a08} style={styles.card}>
      <View style={styles.head}>
        <IconTile icon="stethoscope" size={48} radius={14} glow />
        <View style={styles.flex}>
          <T v="cardTitle" accessibilityRole="header" style={styles.title}>Your package’s tests</T>
          <T v="overline" numberOfLines={2}>{packages.length ? `Included · ${packages.join(', ')}` : has ? 'Included in your account' : 'Home collection'}</T>
        </View>
      </View>

      {has ? <View style={styles.count} accessible accessibilityRole="text" accessibilityLabel={headline}>
        <CountUp value={left} duration={900} style={styles.bebas} maxFontSizeMultiplier={1.2} />
        <T v="h1" accessibilityRole="text" style={[styles.bebasRest, styles.restShrink]}>{` of ${balance!.total} blood test${balance!.total === 1 ? '' : 's'} left`}</T>
      </View> : <T v="h1" accessibilityRole="text" style={styles.bebasRest}>{headline}</T>}
      {summary ? <T v="caption" color={fx.ink.a60}>{summary}</T> : null}

      {rows.length > 1 ? <View style={styles.rows}>
        {rows.map((r) => {
          const caption = [r.reserved ? rowHeld(r.reserved) : null, r.expiresAt ? `until ${fmtDate(r.expiresAt)}` : null].filter(Boolean).join(' · ') || (r.remaining > 0 ? 'Available' : 'Used');
          return <View key={r.id} style={styles.row}>
            <View style={[styles.dot, { backgroundColor: r.remaining > 0 ? fx.red.brand : fx.ink.a20 }]} />
            {/* the count sits beside the name while the longest word of the name and its line fits whole beside it, else
                under them (measured: Beside; 'Added to your a…' at 320 dp and text 1.3, SWB-11) */}
            <Beside words={[{ text: rowName(r), v: 'section' }, { text: caption, v: 'caption' }]} gap={10} underGap={2} lines={2} style={styles.rowBody}
              side={<T v="mono12" color={r.remaining > 0 ? fx.ink.white : fx.ink.a50}>{`${r.remaining} of ${r.quantity} left`}</T>}>
              <T v="section" numberOfLines={2}>{rowName(r)}</T>
              <T v="caption" color={fx.ink.a60}>{caption}</T>
            </Beside>
          </View>;
        })}
      </View> : null}

      <T v="body" color={fx.ink.a90}>{has
        ? 'One included test is one home collection: a phlebotomist from the partner laboratory comes to your address.'
        : 'Blood tests come with a Bioptime package: each included test is one home collection by the partner laboratory.'}</T>

      {consent && !consentOk ? <Notice kind="warning" title="Consent needed">
        <NoticeText>{[!consent.lab ? 'Booking shares your name, phone, email, gender, date of birth and collection address with the laboratory. Turn on "Share my details with the partner laboratory" under Privacy and sharing in your Profile settings.' : '', !consent.health ? 'Turn on "Process my health information" under Privacy and sharing in your Profile settings.' : ''].filter(Boolean).join(' ')}</NoticeText>
        <View style={styles.link}><Button title="Open Privacy and sharing" variant="link" onPress={() => router.push('/settings/consents')} /></View>
      </Notice> : null}

      {has ? <Button title="Book a test" variant="whiteBlock" icon="calendar-check" commit disabled={!canBook} onPress={onBook}
        hint={canBook ? 'Opens the booking steps' : undefined} />
        : <Button title="See packages" variant="whiteBlock" icon="shopping-bag" onPress={() => router.push('/(tabs)/store')} />}
      {has && left < 1 ? <T v="caption" color={fx.ink.a60} center>Your package’s tests are used up. Pay-per-test is not available yet; a new package includes more.</T> : null}
    </GlassCard>
  </HeroTilt>;
}

const styles = StyleSheet.create({
  card: { gap: 16 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  flex: { flex: 1, minWidth: 0 },
  title: { fontSize: 18, lineHeight: 24 },
  // the rest of the headline wraps beside the number rather than leaving it alone on a line (a lone '1' at text 2.0, SWB-11)
  count: { flexDirection: 'row', alignItems: 'baseline', marginBottom: -8 },
  bebas: { ...typeScale.h1, color: fx.red.brand },
  bebasRest: { lineHeight: 36 },
  restShrink: { flexShrink: 1, minWidth: 0 },
  rows: { gap: 10, paddingTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowBody: { flex: 1, minWidth: 0 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  link: { marginTop: 4, alignItems: 'flex-start' },
});

