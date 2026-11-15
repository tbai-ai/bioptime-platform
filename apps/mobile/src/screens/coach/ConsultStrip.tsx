/* The consultations strip under the Coach header (BUILD §6.7, CRITIQUE §33): the next consultation (when, what, its
   status) as one glass row that opens its sheet (how to join, move, cancel, add to calendar), with "Book" beside it and
   "x of y left" from the member's package. With nothing booked it says so and still offers Book. A consultation whose
   time has passed while it is still open is not next (lib/today, the rule Home and Life read): the strip counts it
   apart ("1 awaiting update") when it holds one of the package's consultations, as Home's balance does. */
import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { AnimatedPressable, Button, Icon, IconButton, T, fx, usePress } from '@/fx';
import { label } from '@/lib/format';
import { whenLine, whenSpoken } from './time';
import type { Appointment, Entitlement } from './types';
import { largeText } from '@/fx/layout';

export function ConsultStrip({ next, more, awaiting = 0, left, onOpen, onBook }: { next: Appointment | null; more: number; awaiting?: number; left: Entitlement | null; onOpen: () => void; onBook: () => void }) {
  const press = usePress('card');
  const { width, fontScale } = useWindowDimensions();
  const narrow = width < 380; // Book as a round + so the time keeps its whole line
  // a narrow phone at a large text size: one line each for the time and the status, no overline (its words are in the
  // row's label and in the sheet it opens), so the thread keeps room to read (SWB-15: 90 dp at 320 dp and text 2.0)
  const compact = narrow && largeText(fontScale);
  const leftLine = left ? `${left.remaining} of ${left.total} left` : null;
  const awaitLine = awaiting ? `${awaiting} awaiting update` : null;
  const title = next ? whenLine(next.startAt) : 'None booked';
  const sub = next ? [label(next.status), more ? `+${more} more` : null, leftLine, awaitLine].filter(Boolean).join(' · ') : [leftLine, awaitLine].filter(Boolean).join(' · ') || 'Book from your coach’s free slots';
  const heard = next ? `Next consultation: ${label(next.kind)}, ${whenSpoken(next.startAt)}, ${label(next.status)}${more ? `, and ${more} more` : ''}${leftLine ? `. ${leftLine}` : ''}${awaitLine ? `. ${awaitLine}` : ''}` : `No consultation booked${leftLine ? `. ${leftLine}` : ''}${awaitLine ? `. ${awaitLine}` : ''}`;
  return <View style={styles.wrap}>
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={heard}
      accessibilityHint={next ? 'Opens its details: how to join, move, cancel, add to calendar' : 'Opens your consultations'}
      onPress={onOpen}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[styles.card, press.pressed ? styles.cardPressed : null, press.style]}>
      <View style={styles.icon}><Icon name={next ? 'calendar-check' : 'calendar'} size={18} color={fx.red.vivid} /></View>
      <View style={styles.text}>
        {compact ? null : <T v="label" color={fx.ink.a50} numberOfLines={2}>{next ? `Next ${label(next.kind).toLowerCase()}` : 'Consultations'}</T>}
        {/* compact, each line shrinks to fit whole rather than lose the time to an ellipsis ('Thu 19 Nov · 1…') */}
        <T v="sectionStrong" numberOfLines={compact ? 1 : 2} adjustsFontSizeToFit={compact} minimumFontScale={compact ? 0.7 : undefined}>{title}</T>
        <T v="caption" color={fx.ink.a60} numberOfLines={compact ? 1 : 2} adjustsFontSizeToFit={compact} minimumFontScale={compact ? 0.7 : undefined}>{sub}</T>
      </View>
    </AnimatedPressable>
    {narrow ? <IconButton icon="plus" label="Book a consultation" onPress={onBook} size={44} iconSize={20} color={fx.red.vivid} style={styles.plus} />
      : <Button title="Book" icon="plus" variant="redTint" small onPress={onBook} label="Book a consultation" style={styles.book} />}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  card: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10, borderRadius: fx.radius.card, borderWidth: 1, borderColor: fx.line.a05, backgroundColor: fx.bg.panelSolid, boxShadow: fx.shadow.panel },
  cardPressed: { borderColor: fx.red.a30 },
  icon: { width: 36, height: 36, borderRadius: fx.radius.xl, backgroundColor: fx.red.a10, borderWidth: 1, borderColor: fx.red.a20, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0, gap: 1 },
  book: { minHeight: 44 },
  plus: { marginLeft: -2 },
});
