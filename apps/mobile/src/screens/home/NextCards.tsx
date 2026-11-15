/* What comes next (GAP_MAP §4.4, CRITIQUE §33).
   - NextSessionBanner (the earlier app's challenge banner, THEME §11.4: TiltCard I 6, radius 24, 144 high): the next
     session of the coach's programme on a category mood photo (set.session.<category>, picked by the session id; the
     photo carries no logged value), "NEXT SESSION" or "TODAY'S SESSION", the title in Bebas 20, the day and the number
     of exercises, and the round red glass chevron. The photo flies into the player (PhotoMorph into workout/[id]) and
     back home (FU-m5): the card gives the flight its own photo (the closing copy crossfades into it on the way, so it
     lands as this card's photo, never swapping at the landing) and its words, drawn above the copy at the card, so the
     photo comes home under the title (MorphSource home).
   - NextRows: the next consultation (→ Coach) and the latest blood test (→ Tests) as compact glass rows labelled
     "Appointment" and "Blood test", then the package balances by kind ("4 of 6 left"). By the shared rule (lib/today):
     the appointment row shows only a consultation still to come ("None booked" otherwise), and the consultations'
     held count is split the same way ("1 booked", "1 awaiting update": one whose time has passed while it is still
     open), so the count never contradicts the row above it or the Coach tab. A blood test is judged by its slot the
     same way ("Awaiting update", "1 awaiting update"), and the blood-test balance is split over the member's bookings
     (the list the Tests tab reads), so it says what Tests says. A balance's label shrinks just enough for
     its longest word to fit the tile whole ("CONSULTATIONS" at a large text size on a narrow phone: FitText). */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { fx, Icon, MorphSource, motionValues, Photo, Scrim, T, TiltCard, type IconName } from '@/fx';
import { fmtDateTime, istDate, label } from '@/lib/format';
import { shownStatus } from '@/lib/today';
import { FitText } from '../bio/wordFit';
import { sessionPhoto, workoutMorphKey } from '../train/shared';
import { balanceSplit, nextAppointmentOf, num, plural, weekdayShort, type ApptRow, type Balance, type BloodBooking, type Me, type WorkoutSession } from './data';

export function NextSessionBanner({ session, onOpen }: { session: WorkoutSession; onOpen: () => void }) {
  const today = session.scheduledDate === istDate();
  const cover = sessionPhoto(session.categories, session.id); // the player's cover for this session (the morph lands on it)
  const meta = [today ? 'Today' : weekdayShort(session.scheduledDate), plural(session.itemCount, 'exercise'), session.durationMinutesPlanned ? `${session.durationMinutesPlanned} min` : null].filter(Boolean) as string[];
  const words = <View style={styles.content}>
    <T v="overline" style={styles.over}>{today ? "Today's session" : 'Next session'}</T>
    <View style={styles.bottom}>
      <View style={styles.flex}>
        <T v="small20" numberOfLines={2}>{session.title}</T>
        <View style={styles.meta}>
          <Icon name="calendar" size={11} color={fx.red.label} />
          <T v="caption" color={fx.ink.a70}>{meta[0]}</T>
          <Icon name="dumbbell" size={11} color={fx.red.label} />
          <T v="caption" color={fx.ink.a70} numberOfLines={2} style={styles.flexShrink}>{meta.slice(1).join(' · ')}</T>
        </View>
      </View>
      <View style={styles.chev}><Icon name="chevron-right" size={20} color={fx.ink.white} /></View>
    </View>
  </View>;
  // how the photo comes home from the player (FU-m5): as this card's own photo (its ground, the photo and the banner
  // scrim, as drawn here), under this card's words
  const home = {
    picture: () => <View style={[StyleSheet.absoluteFill, styles.ground]}>
      <Photo slot={cover.slot} pick={cover.pick} opacity={0.5} style={StyleSheet.absoluteFill} decorative />
      <Scrim kind="banner" style={StyleSheet.absoluteFill} />
    </View>,
    over: () => words,
  };
  return <TiltCard intensity={motionValues.tilt.banner} radius={fx.radius.three}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${today ? "Today's session" : 'Next session'}: ${session.title}, ${meta.join(', ')}`} onPress={onOpen} style={styles.banner}>
      <MorphSource morphKey={workoutMorphKey(session.id)} radius={fx.radius.three} style={StyleSheet.absoluteFill} home={home}>
        <Photo slot={cover.slot} pick={cover.pick} opacity={0.5} style={StyleSheet.absoluteFill} decorative />
      </MorphSource>
      <Scrim kind="banner" style={StyleSheet.absoluteFill} />
      {words}
    </Pressable>
  </TiltCard>;
}

function NextRow({ icon, title, detail, onPress, a11y, tone }: { icon: IconName; title: string; detail: string; onPress?: () => void; a11y: string; tone?: string }) {
  return <Pressable accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={a11y} onPress={onPress} disabled={!onPress}
    style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}>
    <View style={styles.rowTile}><Icon name={icon} size={16} color={tone ?? fx.red.label} /></View>
    <View style={styles.flex}>
      <T v="sectionStrong">{title}</T>
      <T v="caption" color={fx.ink.a60} numberOfLines={4}>{detail}</T>
    </View>
    {onPress ? <Icon name="chevron-right" size={16} color={fx.ink.a40} /> : null}
  </Pressable>;
}

export function NextRows({ me, appts, bookings, balances, onAppointment, onBloodTest }: { me: Me; appts: ApptRow[] | null; bookings: BloodBooking[] | null; balances: Balance[]; onAppointment: () => void; onBloodTest: () => void }) {
  const a = nextAppointmentOf(me, appts);
  const b = me.bloodwork;
  const appt = a ? `${label(a.kind)} · ${fmtDateTime(a.startAt)} · ${label(a.status)}` : 'None booked';
  // the same order as the consultation line (and Life): what, when, then the status last; a collection whose slot has
  // passed while it is still open reads "Awaiting update" (lib/today shownStatus), as Tests and Life say
  const blood = b ? `${b.test_name}${b.slot_at && ['scheduled', 'confirmed'].includes(b.status) ? ` · ${fmtDateTime(b.slot_at)}` : ''} · ${label(shownStatus(b))}${b.flag ? ` · ${b.flag}` : ''}` : 'None booked';
  return <View style={styles.rows}>
    <NextRow icon="calendar-check" title="Appointment" detail={appt} onPress={onAppointment} a11y={`Appointment: ${appt}`} />
    <NextRow icon="test-tube" title="Blood test" detail={blood} onPress={onBloodTest} a11y={`Blood test: ${blood}`} />
    {balances.length ? <View style={styles.balances}>
      {balances.map((x) => {
        const split = balanceSplit(x, me, appts, bookings);
        const held = split.held ? `${split.held} booked and held`
          : [split.booked ? `${split.booked} booked` : null, split.awaiting ? `${split.awaiting} awaiting update` : null].filter(Boolean).join(' · ');
        return <View key={x.kind} style={styles.balance} accessible accessibilityLabel={`${x.label}: ${x.remaining} of ${x.total} left${held ? `, ${held}` : ''}`}>
          <FitText v="micro" color={fx.ink.a60}>{x.label}</FitText>
          <View style={styles.balanceRow}>
            <T v="metric24" style={styles.balanceValue}>{num(x.remaining)}</T>
            <T v="caption" color={fx.ink.a60}>{`of ${num(x.total)} left`}</T>
          </View>
          {held ? <T v="caption" color={fx.ink.a50}>{held}</T> : null}
        </View>;
      })}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  // 144 tall as in the earlier app; a large text size may make it taller rather than cut the title
  banner: { minHeight: 144, borderRadius: fx.radius.three, overflow: 'hidden', borderWidth: 1, borderColor: fx.red.a20, backgroundColor: fx.bg.card },
  ground: { backgroundColor: fx.bg.card },
  content: { flex: 1, padding: 20, justifyContent: 'space-between' },
  over: { fontSize: 10, lineHeight: 15 },
  bottom: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  flex: { flex: 1, minWidth: 0 },
  flexShrink: { flexShrink: 1 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  chev: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: fx.red.a20, borderWidth: 1, borderColor: fx.red.a40, marginBottom: 2 },
  rows: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderRadius: fx.radius.card, borderWidth: 1, borderColor: fx.line.a05, backgroundColor: fx.bg.panelSolid, boxShadow: fx.shadow.panel },
  rowPressed: { borderColor: fx.red.a30 },
  rowTile: { width: 36, height: 36, borderRadius: fx.radius.xl, backgroundColor: fx.red.a10, borderWidth: 1, borderColor: fx.red.a20, alignItems: 'center', justifyContent: 'center' },
  balances: { flexDirection: 'row', gap: 10 },
  balance: { flex: 1, padding: 16, borderRadius: fx.radius.card, borderWidth: 1, borderColor: fx.line.a05, borderLeftWidth: 2, borderLeftColor: fx.red.brand, backgroundColor: fx.bg.panelSolid, gap: 4 },
  balanceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' },
  balanceValue: { lineHeight: 28 },
});
