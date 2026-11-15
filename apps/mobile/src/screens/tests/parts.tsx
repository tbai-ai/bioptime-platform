/* Small pieces the Tests screens share, in the earlier app's Clinic and Orders look:
   - SectionTitle: "Specialized Tests · 10 available" (Montserrat 18/500 white, a count on the right).
   - IconTile: the rounded tile with an icon (stethoscope 48 on the featured card, flask 40 on order cards, 32 in the
     checkout header), tinted in a colour.
   - StatusPill: a laboratory status in its order colour, with its icon (the word carries the meaning).
   - OutlineChip: the outlined tag chip of the order cards; RedChip: the red tag chip of the checkout's test card.
   - CheckLine: a green circle-check and a line (the checkout's "What's included").
   - BookingCard: the earlier app's order card for a blood-test booking (2 pt status bar on top, flask tile, name,
     reference in mono, status pill, chips, the booked and collection dates), opening the booking overlay. The
     upcoming one can carry the laboratory's preparation (`prep`). A collection whose slot has passed while it is still
     open shows "Awaiting update" in amber (lib/today shownStatus, the word Home, Life and Coach use). Its status pill
     sits beside the name only while the widest word of the name and of the reference, as drawn now, fits whole beside
     it, and a short word of the name with the word beside it (never 'Vitamin / D / (25-OH)': VA-5); otherwise it
     leads the chips row (or, with no chips row, takes the line under the reference), as Profile › Orders places its
     chip (useBeside: SB-1, SWB-01). A section's count moves under its title the same way (SWB-12). */
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { fmtDate, fmtDateTime, label } from '@/lib/format';
import type { Preparation } from '@/lib/modules/labFollowupsViews';
import { shownStatus } from '@/lib/today';
import { fontFor, fx, GlassCard, Icon, motionValues, RowDivider, T, withAlpha, type IconName } from '@/fx';
import { Beside, FitText, HugText, keepShort, useBeside } from '@/fx/wordFit';
import { RowTilt } from './RowTilt';
import { fastingText, markersText, statusColour, statusIcon, whenParts, type Booking } from './model';

export function SectionTitle({ title, count, style }: { title: string; count?: string; style?: StyleProp<ViewStyle> }) {
  return <Beside words={[{ text: title, v: 'cardTitle', style: styles.sectionTitle }]} underGap={0} style={[styles.section, style]}
    side={count ? <T v="body" color={fx.ink.a70}>{count}</T> : null}>
    <T v="cardTitle" accessibilityRole="header" style={styles.sectionTitle}>{title}</T>
  </Beside>;
}

export function IconTile({ icon, size = 40, colour = fx.red.brand, radius, glow }: { icon: IconName; size?: number; colour?: string; radius?: number; glow?: boolean }) {
  return <View style={[styles.tile, {
    width: size, height: size, borderRadius: radius ?? Math.round(size / 4), backgroundColor: withAlpha(colour, 0.1), borderColor: withAlpha(colour, 0.25),
    boxShadow: glow ? `0px 0px 20px ${withAlpha(colour, 0.15)}` : undefined,
  }]}>
    <Icon name={icon} size={Math.round(size * 0.46)} color={colour} />
  </View>;
}

export function StatusPill({ status }: { status: string }) {
  const c = statusColour(status);
  // the grey of a finished booking keeps its tint and icon; its word is drawn in the lighter zinc to read (7:1)
  const ink = c === fx.hue.grey ? fx.ink.ink2 : c;
  return <View style={[styles.pill, { backgroundColor: withAlpha(c, 0.1), borderColor: withAlpha(c, 0.3) }]}>
    <Icon name={statusIcon(status)} size={12} color={c} />
    <HugText v="micro" color={ink} style={styles.pillText}>{label(status)}</HugText>
  </View>;
}

export function OutlineChip({ children }: { children: string }) {
  return <View style={styles.outline}><T v="micro" color={fx.ink.a60} style={styles.outlineText}>{children}</T></View>;
}

export function RedChip({ children }: { children: string }) {
  return <View style={styles.red}><T v="micro" color={fx.red.label} style={styles.redText}>{children}</T></View>;
}

export function CheckLine({ children, colour = fx.hue.green400 }: { children: React.ReactNode; colour?: string }) {
  return <View style={styles.check}>
    <Icon name="circle-check" size={16} color={colour} />
    {typeof children === 'string' ? <T v="body" color={fx.ink.a80} style={styles.flex}>{children}</T> : <View style={styles.flex}>{children}</View>}
  </View>;
}

/** The meta line of an order card: an icon and a date. */
function Meta({ icon, text }: { icon: IconName; text: string }) {
  // at a large text size a date wraps inside its column instead of running under the collection time beside it; its
  // date comes glued (a day and its month never part), and a caption whose box hugs its text keeps its last word
  // (HugText: 'Tue, 10' with the month lost at 360 dp and text 2.0, VA-8)
  return <View style={[styles.meta, styles.metaShrink]}><Icon name={icon} size={12} color={fx.ink.a50} /><HugText v="caption" color={fx.ink.a60} style={styles.flexShrink}>{text}</HugText></View>;
}

export function BookingCard({ b, onPress, prep, compact }: { b: Booking; onPress: () => void; prep?: Preparation | null; compact?: boolean }) {
  const status = shownStatus(b);
  const colour = statusColour(status);
  const when = whenParts(b.slotAt);
  const chips = [b.test?.markers ? markersText(b.test.markers) : null, b.test ? fastingText(b.test) : null, b.test?.turnaround ? `Results in ${b.test.turnaround}` : null].filter(Boolean) as string[];
  const chipRow = !compact && chips.length > 0;
  // the name's short words keep a neighbour ('Count (CBC)': RV2-1); the pill leads the chips row when the name would
  // need more than two lines beside it (VWR2-1: 'Complete / Blood Count / (CBC)' at 320-390 and text 1.0)
  const name = keepShort(b.test?.name ?? 'Blood test');
  const place = useBeside(HEAD_GAP, true, 0, 2);
  const pill = <View style={styles.pillBox} onLayout={place.onSide}><StatusPill status={status} /></View>;
  return <RowTilt intensity={motionValues.tilt.row} radius={fx.radius.card} pressScale={1}><GlassCard variant="card" clip onPress={onPress} padding={0} borderColor={fx.line.a08}
    label={`${b.test?.name ?? 'Blood test'}, ${b.reference}, ${label(status)}, collection ${when.day} at ${when.time}`} hint="Opens the booking">
    <View style={[styles.bar, { backgroundColor: colour }]} />
    <View style={styles.body}>
      <View style={styles.head}>
        <IconTile icon="flask-conical" size={40} colour={colour} radius={12} />
        <View style={styles.headText} onLayout={place.onCol}>
          <FitText v="cardTitle">{name}</FitText>
          <FitText v="mono12" color={fx.ink.a60}>{b.reference}</FitText>
          {place.measure([{ text: name, v: 'cardTitle', pairs: true }, { text: b.reference, v: 'mono12' }])}
          {!place.beside && !chipRow ? <View style={styles.pillUnder}>{pill}</View> : null}
        </View>
        {place.beside ? pill : null}
      </View>
      {chipRow ? <View style={styles.chips}>{!place.beside ? pill : null}{chips.map((c) => <OutlineChip key={c}>{c}</OutlineChip>)}</View> : null}
      {b.flag ? <View style={styles.flag}><Icon name="triangle-alert" size={13} color={fx.hue.amber400} /><T v="caption" color={fx.hue.amber400} style={styles.flex}>{label(b.flag)}</T></View> : null}
      {prep ? <View style={styles.prep}>
        <View style={styles.prepHead}><Icon name="clipboard-list" size={13} color={fx.red.label} /><T v="overline">Before your collection</T></View>
        <T v="bodySm" color={fx.ink.a90}>{prep.preparation ? `The laboratory’s preparation: ${prep.preparation}` : prep.fastingHours ? `The laboratory asks for ${prep.fastingHours} hours of fasting before collection.` : 'The laboratory lists no preparation for this test.'}</T>
        {prep.rebookPending ? <T v="caption" color={fx.hue.amber400}>The Bioptime team is arranging a new visit.</T> : null}
        <View style={styles.meta}><Icon name="bell" size={12} color={fx.ink.a50} /><T v="caption" color={fx.ink.a60} style={styles.flex}>{prep.reminder ? (prep.reminder.status === 'queued' ? `Reminder on ${fmtDateTime(prep.reminder.dueAt)}, in Notifications.` : prep.reminder.status === 'sent' ? `Reminder sent ${fmtDateTime(prep.reminder.dueAt)}.` : 'Reminders are off in your notification settings.') : 'A reminder is set shortly before the collection.'}</T></View>
      </View> : null}
      <RowDivider />
      <View style={styles.foot}>
        <View style={styles.metas}>
          <Meta icon="clock" text={`Booked ${glued(fmtDate(b.createdAt))}`} />
          <Meta icon="calendar" text={glued(when.day)} />
        </View>
        <T v="mono14" style={styles.time}>{b.status === 'cancelled' ? 'Cancelled' : when.time}</T>
      </View>
    </View>
  </GlassCard></RowTilt>;
}

/** The gap between a booking card's icon tile, its name and its status pill. */
const HEAD_GAP = 12;

/** A date whose day and month never part across lines ('Tue, 10 Nov' breaks only after 'Tue,'; glued whole it broke
 *  inside the month in a narrow column at text 2.0). */
const glued = (d: string) => d.replace(/(\d+) (\S+)/g, '$1\u00a0$2');

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  section: { marginBottom: 2 },
  sectionTitle: { fontSize: 18, lineHeight: 26, fontFamily: fontFor('sans', 500) },
  tile: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: fx.radius.pill, borderWidth: 1, alignSelf: 'flex-start' },
  pillText: { fontSize: 10, lineHeight: 13 },
  outline: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: fx.radius.pill, borderWidth: 1, borderColor: fx.line.a20 },
  outlineText: { fontSize: 9, letterSpacing: 9 * 0.12 },
  red: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: fx.radius.pill, borderWidth: 1, borderColor: fx.red.a30, backgroundColor: fx.red.a10 },
  redText: { fontSize: 10, letterSpacing: 10 * 0.15 },
  check: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  bar: { height: 2 },
  body: { padding: 16, gap: 12 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: HEAD_GAP },
  headText: { flex: 1, minWidth: 0 },
  pillBox: { alignSelf: 'flex-start' },
  pillUnder: { marginTop: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  flag: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  prep: { gap: 6, padding: 12, borderRadius: fx.radius.xl, backgroundColor: fx.red.a05, borderWidth: 1, borderColor: fx.red.a15 },
  prepHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  metas: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 14, rowGap: 4, flex: 1 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaShrink: { flexShrink: 1, minWidth: 0 },
  flexShrink: { flexShrink: 1 },
  time: { fontFamily: fontFor('mono', 700) },
});
