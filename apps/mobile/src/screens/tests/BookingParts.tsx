/* Pieces of the booking overlay (booking/[id]):
   - BookingHero: the abstract photo band (ph-tests-abstract at .22 under the band fade) with the status ("Awaiting
     update" once the slot has passed while it is still open, lib/today shownStatus), the collection day in Bebas and
     the time; the route file adds the simulated pill beside the status. The place beside the time shrinks just enough
     for its longest word to fit whole at a large text size on a narrow phone (FitText), never breaking a word.
   - Timeline: every status change of the booking on a vertical line that draws down (600 ms) while its dots pop in
     turn; the latest step is red. Words come from the laboratory's status, the note, or the status itself; who made
     the change and when (IST) sit under each.
   - MoveSheetBody: moving a booking to another slot (SlotPicker for the booking's PIN code) and its confirm button. */
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { fmtDateTime } from '@/lib/format';
import { shownStatus } from '@/lib/today';
import { Button, fx, Notice, Photo, Reveal, Scrim, T, timing, useFx } from '@/fx';
import { FitText } from '../bio/wordFit';
import { slotTimeIst, sourceText, timelineText, whenParts, type Booking, type Slot, type TimelineEvent } from './model';
import { SlotPicker } from './SlotPicker';
import { StatusPill } from './parts';

export function BookingHero({ b, extra }: { b: Booking; extra?: React.ReactNode }) {
  const when = whenParts(b.slotAt);
  return <View style={styles.hero}>
    <Photo slot="booking.header" opacity={0.22} decorative style={StyleSheet.absoluteFill} />
    <Scrim kind="headerBand" style={StyleSheet.absoluteFill} />
    <View style={styles.heroBody}>
      <View style={styles.pills}><StatusPill status={shownStatus(b)} />{extra}</View>
      <T v="display36" accessibilityLabel={`Collection ${when.day} at ${when.time}`}>{when.day}</T>
      <View style={styles.heroLine}>
        <T v="metric24">{when.time}</T>
        <FitText v="caption" color={fx.ink.a60} boxStyle={styles.place}>{`Home collection${b.address?.city ? ` · ${b.address.city}` : ''}`}</FitText>
      </View>
    </View>
  </View>;
}

export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (!events.length) return <T v="bodySm" color={fx.ink.a60}>No status changes yet.</T>;
  return <View style={styles.timeline}>
    {events.map((e, i) => {
      const last = i === events.length - 1;
      return <View key={`${e.at}-${i}`} style={styles.event}>
        {last ? null : <Connector index={i} />}
        <Reveal mount from="scale" index={i} delay={80} style={styles.dotWrap}>
          <View style={[styles.dot, last ? styles.dotLast : null]} />
        </Reveal>
        <View style={styles.flex}>
          <T v="section" color={last ? fx.ink.white : fx.ink.a80}>{timelineText(e)}</T>
          <T v="caption" color={fx.ink.a60}>{`${fmtDateTime(e.at)} · ${sourceText(e.source)}`}</T>
        </View>
      </View>;
    })}
  </View>;
}

/** The line from one dot down to the next, drawing in turn (the whole line over about 600 ms). */
function Connector({ index }: { index: number }) {
  const { calm, inHtml } = useFx();
  const still = calm || inHtml;
  const p = useSharedValue(still ? 1 : 0);
  useEffect(() => { if (!still) p.value = withDelay(120 + index * 120, withTiming(1, timing(240))); }, [still, p, index]);
  const a = useAnimatedStyle(() => ({ transform: [{ scaleY: p.value }] }));
  return <Animated.View style={[styles.line, a]} />;
}

export function MoveSheetBody({ b, onMove, busy, error }: { b: Booking; onMove: (s: Slot) => void; busy: boolean; error: string | null }) {
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const pin = b.address?.pincode ?? '';
  return <View style={styles.sheet}>
    <T v="bodySm" color={fx.ink.a60}>{`Now ${whenParts(b.slotAt).day} at ${whenParts(b.slotAt).time}. The laboratory checks the new slot first; nothing changes if it cannot take it.`}</T>
    <SlotPicker pincode={pin} day={day} onDay={(d) => { setDay(d); setSlot(null); }} slot={slot} onSlot={setSlot} />
    {error ? <Notice kind="error" title="Not moved">{error}</Notice> : null}
    <Button title={slot ? `Move to ${whenParts(slot.startAt).day}, ${slotTimeIst(slot)}` : 'Choose a new slot'} shape="flow" commit disabled={!slot} busy={busy} onPress={() => slot && onMove(slot)} />
  </View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  // at least 190: a hero whose words need more (the status pill at 320 dp and text 2.0) grows instead of hiding them (VPOL2-1)
  hero: { minHeight: 190, justifyContent: 'flex-end', overflow: 'hidden' },
  heroBody: { paddingHorizontal: 20, paddingBottom: 18, gap: 6, width: '100%', maxWidth: 520, alignSelf: 'center' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  heroLine: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  // the rest of the line beside the time, centred on it as the text was (FitText's box would stretch to the row)
  place: { flex: 1, minWidth: 0, alignSelf: 'center' },
  timeline: { gap: 18 },
  line: { position: 'absolute', left: 5, top: 18, bottom: -20, width: 2, borderRadius: 1, backgroundColor: fx.line.a15, transformOrigin: 'top' },
  event: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  dotWrap: { paddingTop: 4 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: fx.bg.panelSolid, borderWidth: 2, borderColor: fx.ink.a30 },
  dotLast: { backgroundColor: fx.red.brand, borderColor: fx.red.brand, boxShadow: fx.shadow.dot },
  sheet: { gap: 20 },
});
