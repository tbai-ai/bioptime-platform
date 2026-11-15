/* The two horizontal strips (the earlier app's Quick Workouts cards, 150 × 128, on the premium 3D shelf).
   - LiveSessionsStrip (sessions on; it takes the place of the earlier app's community row, which showed invented
     people): upcoming live classes, webinars and workshops on people-free photos by kind (the host's name is shown),
     the title, day and time, and "Registered" or "Full". Opens session/[id].
   - WeekShelf: this week's sessions from the coach's programme on their category mood photo (no logged value on the
     card), the title, the day and the status. The photo flies into the player (PhotoMorph into workout/[id]). At a
     large text size the day and the status stay in view (A1W-m3): when they no longer fit one line the status takes
     the next line (the dot between them is then not drawn) and every card of the shelf grows to its tallest card's
     words, measured as drawn; at the usual size the cards keep the earlier app's 128. The live strip grows the same
     way (its status was cut off at text 1.3, SWA-05), and its titles keep their words whole (FitText).
   - Both cards answer a press as the app's other cards do (the kit's press, a tile's .96, CRT-2). */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AnimatedPressable, fx, Icon, MorphSource, motionValues, Scrim, ShelfCarousel, ShelfPhoto, T, Photo, useLayout, usePress, type IconName } from '@/fx';
import { fmtTime, istDate } from '@/lib/format';
import { FitText } from '../bio/wordFit';
import { asCategory, sessionPhoto, workoutMorphKey } from '../train/shared';
import { liveKind, STATUS_WORD, weekdayShort, dayMonth, type LiveSession, type WorkoutSession } from './data';

const LIVE_ICON: Record<string, IconName> = { class: 'users', webinar: 'video', workshop: 'graduation-cap' };
const CATEGORY_ICON: Record<string, IconName> = { strength: 'dumbbell', conditioning: 'flame', core: 'target', mobility: 'wind', balance: 'activity', recovery: 'heart', other: 'dumbbell' };

function Chip({ icon }: { icon: IconName }) {
  return <View style={styles.chip}><Icon name={icon} size={15} color={fx.red.brand} /></View>;
}

export function LiveSessionsStrip({ items, onOpen }: { items: LiveSession[]; onOpen: (s: LiveSession) => void }) {
  const { isTablet } = useLayout();
  // as WeekShelf: the strip is as tall as its tallest card's words need, never below 128
  const [words, setWords] = useState<Record<string, number>>({});
  const tallest = items.reduce((n, s) => Math.max(n, words[s.id] ?? 0), 0);
  const cardHeight = Math.max(CARD_H, Math.ceil(WORDS_FROM + tallest));
  return <ShelfCarousel
    style={isTablet ? styles.clip : undefined}
    data={items}
    keyExtractor={(s) => s.id}
    cardHeight={cardHeight}
    accessibilityLabel="Live sessions"
    renderItem={(s) => <LiveCard s={s} onOpen={onOpen} onWords={(h) => setWords((m) => (m[s.id] === h ? m : { ...m, [s.id]: h }))} />}
  />;
}

function LiveCard({ s, onOpen, onWords }: { s: LiveSession; onOpen: (s: LiveSession) => void; onWords: (height: number) => void }) {
  const press = usePress('tile', 0, { scroll: true });
  const kind = liveKind(s.kind);
  const when = `${weekdayShort(s.startAt)} ${dayMonth(s.startAt)} · ${fmtTime(s.startAt)}`;
  const reg = s.myRegistration && ['registered', 'attended', 'waitlisted'].includes(s.myRegistration.status) ? (s.myRegistration.status === 'waitlisted' ? 'Waitlist' : 'Registered') : s.full ? 'Full' : null;
  return <AnimatedPressable {...press.scrollProps} accessibilityRole="button" accessibilityLabel={`${s.kindLabel ?? 'Live session'}: ${s.title}, ${when}${reg ? `, ${reg}` : ''}`}
    onPress={() => onOpen(s)} onPressIn={press.onPressIn} onPressOut={press.onPressOut} style={[styles.card, press.style]}>
    <ShelfPhoto><Photo slot={`home.liveSessions.${kind}`} opacity={0.4} style={StyleSheet.absoluteFill} decorative /></ShelfPhoto>
    <Scrim kind="cardBottom" style={StyleSheet.absoluteFill} />
    <View style={styles.inner}>
      <Chip icon={LIVE_ICON[kind]} />
      <View onLayout={(e) => onWords(Math.ceil(e.nativeEvent.layout.height))}>
        {/* a third line for the title and a second for the time, as the strip grows with its words ('Evening /
            wind-down wo…' at the default size, the time cut at 320 dp and text 2.0: INV-01) */}
        <FitText v="sectionStrong" numberOfLines={3} style={styles.title}>{s.title}</FitText>
        <T v="caption" color={fx.ink.a80} numberOfLines={2} style={styles.meta}>{when}</T>
        {reg ? <T v="micro" color={reg === 'Full' ? fx.ink.a60 : fx.hue.green400} numberOfLines={1} style={styles.status}>{reg}</T> : null}
      </View>
    </View>
  </AnimatedPressable>;
}

export function WeekShelf({ items, onOpen }: { items: WorkoutSession[]; onOpen: (s: WorkoutSession) => void }) {
  const today = istDate();
  const { isTablet } = useLayout();
  // each card's words as drawn (title and meta): the shelf is as tall as its tallest card needs, never below 128
  const [words, setWords] = useState<Record<string, number>>({});
  const tallest = items.reduce((n, s) => Math.max(n, words[s.id] ?? 0), 0);
  const cardHeight = Math.max(CARD_H, Math.ceil(WORDS_FROM + tallest));
  return <ShelfCarousel
    style={isTablet ? styles.clip : undefined}
    data={items}
    keyExtractor={(s) => s.id}
    cardHeight={cardHeight}
    accessibilityLabel="This week's sessions"
    renderItem={(s) => <WeekCard s={s} today={today} onOpen={onOpen}
      onWords={(h) => setWords((m) => (m[s.id] === h ? m : { ...m, [s.id]: h }))} />}
  />;
}

/** The shelf's card height at the usual text size, and what a card needs above and below its words: the padding, the
 *  category chip and the least gap between the chip and the title. */
const CARD_H = motionValues.shelf.cardH;
const WORDS_FROM = 12 + 32 + 6 + 12;

function WeekCard({ s, today, onOpen, onWords }: { s: WorkoutSession; today: string; onOpen: (s: WorkoutSession) => void; onWords: (height: number) => void }) {
  const cat = asCategory(s.categories?.find(Boolean));
  const cover = sessionPhoto(s.categories, s.id); // the player's cover for this session (the morph lands on it)
  const day = s.scheduledDate === today ? 'Today' : weekdayShort(s.scheduledDate);
  // a session still planned after its day says "Not logged", as Train's row says (train/shared sessionState; CG-09:
  // never "Planned" for a day that has passed)
  const late = s.status === 'scheduled' && s.scheduledDate < today;
  const status = late ? 'Not logged' : STATUS_WORD[s.status] ?? s.status;
  const done = s.status === 'completed' || s.status === 'partial';
  // the meta row wraps when the day and the status no longer fit one line (a large text size): the status starts the
  // next line and the dot that joined them is not drawn (it keeps its place, so the row never moves back)
  const [rowH, setRowH] = useState(0);
  const [dayH, setDayH] = useState(0);
  const wrapped = dayH > 0 && rowH > dayH * 1.5;
  const press = usePress('tile', 0, { scroll: true });
  return <AnimatedPressable {...press.scrollProps} accessibilityRole="button" accessibilityLabel={`${s.title}, ${day}, ${status}`}
    onPress={() => onOpen(s)} onPressIn={press.onPressIn} onPressOut={press.onPressOut} style={[styles.card, press.style]}>
    <MorphSource morphKey={workoutMorphKey(s.id)} radius={fx.radius.card} style={StyleSheet.absoluteFill}>
      <ShelfPhoto><Photo slot={cover.slot} pick={cover.pick} opacity={0.4} style={StyleSheet.absoluteFill} decorative /></ShelfPhoto>
    </MorphSource>
    <Scrim kind="cardBottom" style={StyleSheet.absoluteFill} />
    <View style={styles.inner}>
      <Chip icon={CATEGORY_ICON[cat]} />
      <View onLayout={(e) => onWords(Math.ceil(e.nativeEvent.layout.height))}>
        <T v="sectionStrong" numberOfLines={2} style={styles.title}>{s.title}</T>
        <View style={styles.metaRow} onLayout={(e) => setRowH(Math.round(e.nativeEvent.layout.height))}>
          <Icon name="calendar" size={10} color={fx.red.label} />
          <T v="caption" color={fx.ink.a80} numberOfLines={1} onLayout={(e) => setDayH(Math.round(e.nativeEvent.layout.height))}>{day}</T>
          <T v="caption" color={fx.ink.a50} style={wrapped ? styles.hidden : null}>·</T>
          <T v="caption" color={done ? fx.hue.green400 : late || s.status === 'skipped' || s.status === 'missed' ? fx.hue.amber400 : fx.ink.a80} numberOfLines={1} style={styles.shrink}>{status}</T>
        </View>
      </View>
    </View>
  </AnimatedPressable>;
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  card: { flex: 1, borderRadius: fx.radius.card, overflow: 'hidden', borderWidth: 1, borderColor: fx.line.a10, backgroundColor: fx.bg.card },
  inner: { flex: 1, padding: 12, justifyContent: 'space-between' },
  chip: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: fx.red.a20, borderWidth: 1, borderColor: fx.red.a30, boxShadow: fx.shadow.cardHover },
  title: { textShadowColor: fx.premium.fog, textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  meta: { marginTop: 2, fontSize: 10 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginTop: 2 },
  status: { marginTop: 3, letterSpacing: 0.8 },
  shrink: { flexShrink: 1 },
  hidden: { opacity: 0 },
});
