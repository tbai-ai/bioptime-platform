/* The pieces of Train's "This week" (shots 32-train*, 33, 34; THEME §11.4):
   - StatsCard: the earlier app's stats card drawn as the row it was meant to be (CRITIQUE: the stacked strip was a
     bug): Completed (red, done of the sessions planned this week, as the plan's rows count them), Minutes (yellow, the minutes the member logged this week) and Upcoming (green),
     mono 20 values counting up when the card is first shown, 9 pt labels; no calories (Bioptime never estimates them).
     The week arrows sit on top.
   - CoachPlanRow: "Your Coach's Plan" rows: an 80 pt picture at .7 under a black/30 scrim with a play glyph (tap: the
     player, by PhotoMorph): the poster of the session's first clip when it has one (the picture the player opens on,
     so the photo that flies up is the one that stays), else the photo of the session's category; the title (struck through when done), "Wed · 6 exercises", and the
     right column MARK (opens the quick-log sheet) or DONE in green (opens the player). Nothing the member logged is
     printed on a row that carries a photo with people.
   - ProgrammeCard: "Version 2 · by Asha Menon", the title and the coach's summary, with a NEW pill when the coach
     published a version this device has not seen.
   - ExerciseCard: the library card of an exercise with a clip: the clip's poster in colour at .7 (its category's tile
     when the poster cannot be drawn: never a photo of someone else's exercise), the category pill in its colour, the
     name, two lines of description and the equipment; tap: the exercise, by PhotoMorph. An exercise without a clip is
     a compact row (T6-37: a 160 pt card with an empty picture header for each of them made the library a column of
     placeholders): its category's tile as a 16:9 thumbnail, the pill, the name and the equipment; the thumbnail is the
     PhotoMorph source, drawn as the exercise screen's hero tile is at its scale, so the flight grows it in proportion.
   Motion v2:
   - M74 a coach-plan row presses like a card (.98 over 90 ms on the frame the press is taken; inside the page's
     scroller after motionValues.press.scrollDelay) with its thumbnail's scrim deepening .30 → .45; the press-in starts
     the poster and the session loading, and the release measures the photo where the pressed card holds it, so the
     flight starts from the pressed frame. From the release that opens the player the card holds at the tile press
     (motionValues.press.tile, scrim .45) until the player covers it, so even a tap shorter than the scroller's press
     delay is answered on the next frame (M69 fix round). The MARK cell keeps its own plain press;
   - M72 back on Train after a log: what changed while the player covered the page is shown when the page is seen
     again (`visible`): the stats that changed roll from the old number to the new one, all three the same way (T4-19:
     Completed and Upcoming move by one, so a count from the old number was a jump beside Minutes counting; Roll,
     S.m73.digitRoll over S.m72.completedMs, up when it grew; tier C: opacity only; reduced motion: a crossfade), the
     logged row's DONE cell pops (spring.pop) and a week that is now complete (every planned session done, as Completed
     counts it) runs the 1 px red sweep across the stats card once. The week arrows roll them the same way. */
import React, { memo, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import {
  CountUp, FONTS, GlassCard, Icon, IconButton, MorphSource, Photo, PhotoTag, RemotePhoto, Reveal, T, TiltCard, afterPaint, calmFade, ease, fx, motionValues, spring, t, timing, usePress, useFx, withAlpha,
} from '@/fx';
import { formatCount } from '@/fx/motion/CountUp';
import { markSeen } from '@/fx/motion/seen';
import { useStateMix } from '@/fx/press';
import { FitText, HugText } from '@/fx/wordFit';
import { fmtDate } from '@/lib/format';
import {
  cap, categoryColor, categoryIcon, categoryInk, categoryLabel, dayMonth, exerciseMorphKey, hasClip, holdUntilCovered, serverUrl, sessionMeta, sessionPhoto, sessionState,
  warmSession, workoutMorphKey, type Exercise, type Programme, type SessionRow, type Week,
} from './shared';
import { ExercisePoster, ExerciseTile, HERO_ICON } from './ExerciseTile';
import { Roll, useChangeDir } from './motion';

const S = motionValues.screens;

/** Whether Train is seen (focused). Leaving is not announced (nothing re-renders while the player opens over Train);
 *  coming back is, to the few parts that show what changed meanwhile. */
export type SeenStore = { get: () => boolean; subscribe: (l: () => void) => () => void; show: () => void; hide: () => void };
export function createSeenStore(): SeenStore {
  let seen = true;
  const listeners = new Set<() => void>();
  return {
    get: () => seen,
    subscribe: (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    show: () => { if (seen) return; seen = true; listeners.forEach((l) => l()); },
    hide: () => { seen = false; },
  };
}
const ALWAYS_SEEN: SeenStore = { get: () => true, subscribe: () => () => undefined, show: () => undefined, hide: () => undefined };
function useSeenFlag(store?: SeenStore): boolean {
  const s = store ?? ALWAYS_SEEN;
  return useSyncExternalStore(s.subscribe, s.get, s.get);
}

/** What the page showed last while it was seen: a value that changed while it was covered (the player over Train) is
 *  shown, and moves, once the page is seen again. */
function useSeen<T>(value: T, visible: boolean): T {
  const held = useRef(value);
  if (visible) held.current = value;
  return held.current;
}

/* ---------- stats ---------- */

export const StatsCard = memo(function StatsCard({ week: live, isThisWeek, seen: store, onEarlier, onLater, onThisWeek }: { week: Week; isThisWeek: boolean; seen?: SeenStore; onEarlier: () => void; onLater: () => void; onThisWeek: () => void }) {
  const visible = useSeenFlag(store);
  const week = useSeen(live, visible);
  const logged = week.items.filter((s) => (s.status === 'completed' || s.status === 'partial') && s.durationMinutes != null);
  const minutes = logged.length ? logged.reduce((n, s) => n + (s.durationMinutes ?? 0), 0) : null;
  const range = `${dayMonth(week.from)} – ${dayMonth(week.to)}`;
  // done of the sessions planned this week: the same count as "Your Coach's Plan" under it (done of due so far read as a
  // different number beside it), and it does not change when a session is logged, so only the done count moves
  const planned = week.items.length;
  // a week that became complete while it was seen (not one that was complete when it was first shown): one sweep.
  // Complete as the card counts it, every planned session done (the Completed figure beside it reads done/planned), so
  // the sweep never runs over '3/4 COMPLETED · 1 UPCOMING'
  const complete = planned > 0 && week.summary.done >= planned;
  const was = useRef<{ from: string; complete: boolean } | null>(null);
  const [sweeps, setSweeps] = useState(0);
  useEffect(() => {
    const prev = was.current;
    was.current = { from: week.from, complete };
    if (prev && prev.from === week.from && !prev.complete && complete) setSweeps((n) => n + 1);
  }, [week.from, complete]);
  const seen = `train.week.${week.from}`;
  return <TiltCard intensity={5} radius={fx.radius.card}>
    <GlassCard variant="card" padding={0} style={styles.statsCard}>
      {sweeps ? <Sweep key={sweeps} inset={fx.radius.card} /> : null}
      <View style={styles.weekRow}>
        <IconButton icon="chevron-left" label="Earlier week" size={32} iconSize={16} onPress={onEarlier} />
        <Pressable accessibilityRole={isThisWeek ? 'text' : 'button'} accessibilityLabel={isThisWeek ? `This week, ${range}` : `${range}. Back to this week`} disabled={isThisWeek} onPress={onThisWeek} style={styles.weekLabel}>
          <T v="eyebrowStore" color={isThisWeek ? fx.ink.a60 : fx.red.label} center>{isThisWeek ? 'This week' : 'Back to this week'}</T>
          <T v="mono11" color={fx.ink.a50} center>{range}</T>
        </Pressable>
        <IconButton icon="chevron-right" label="Later week" size={32} iconSize={16} onPress={onLater} />
      </View>
      <View style={styles.stats}>
        <Stat value={week.summary.done} suffix={planned ? `/${planned}` : undefined} label="Completed" color={fx.red.vivid}
          a11y={`${week.summary.done} of ${planned} planned sessions done`} seenKey={`${seen}.done`} pop />
        <View style={styles.vline} />
        <Stat value={minutes} label="Minutes" color={fx.hue.yellow} a11y={minutes == null ? 'No minutes logged' : `${minutes} minutes logged`} seenKey={`${seen}.minutes`} />
        <View style={styles.vline} />
        <Stat value={week.summary.upcoming} label="Upcoming" color={fx.hue.green500} a11y={`${week.summary.upcoming} still to come`} seenKey={`${seen}.upcoming`} />
      </View>
    </GlassCard>
  </TiltCard>;
});

function Stat({ value, suffix, label, color, a11y, seenKey, pop }: { value: number | null; suffix?: string; label: string; color: string; a11y: string; seenKey: string; pop?: boolean }) {
  return <View style={styles.stat} accessible accessibilityLabel={`${label}: ${a11y}`}>
    <StatValue value={value} suffix={suffix} seenKey={seenKey} pop={pop} style={[styles.statNumber, { color }]} />
    <T v="micro" style={styles.statLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{label}</T>
  </View>;
}

/** A stat's figure (see the header, M72): the first one counts up (CountUp: from 0 once a run, at rest on a revisit);
 *  every later one rolls in over the one before (its suffix with it), and is recorded as seen, so a revisit shows it at
 *  rest. */
function StatValue({ value, suffix, seenKey, pop, style }: { value: number | null; suffix?: string; seenKey: string; pop?: boolean; style: StyleProp<TextStyle> }) {
  const [first] = useState(value);
  const [rolled, setRolled] = useState(false);
  if (!rolled && value !== first) setRolled(true);
  const up = useChangeDir(value ?? 0);
  useEffect(() => { if (rolled && value != null) markSeen(`count:${seenKey}`, value); }, [rolled, value, seenKey]);
  const tail = suffix && value != null ? suffix : '';
  return <Roll value={`${value ?? '—'}${tail}`} up={up} distance={S.m73.digitRoll} ms={S.m72.completedMs}>
    <View style={styles.statValue}>
      {rolled ? <T style={style}>{value == null ? '—' : formatCount(value)}</T> : <CountUp value={value} seenKey={seenKey} pop={pop} style={style} />}
      {tail ? <T v="mono12" color={fx.ink.a60}>{tail}</T> : null}
    </View>
  </Roll>;
}

/* ---------- coach-plan rows ---------- */

/** One row; `onOpen` and `onMark` take the row's session (stable callbacks keep an unchanged row from rendering again). */
export const CoachPlanRow = memo(function CoachPlanRow({ s: live, today, fresh, seen: store, onOpen: openRow, onMark: markRow }: { s: SessionRow; today: string; fresh?: boolean; seen?: SeenStore; onOpen: (s: SessionRow) => void; onMark: (s: SessionRow) => void }) {
  const visible = useSeenFlag(store);
  const s = useSeen(live, visible);
  const st = sessionState(s, today);
  const logged = st.key === 'done' || st.key === 'partial';
  const photo = sessionPhoto(s.categories, s.id);
  const poster = serverUrl(s.coverPosterUrl);
  const column = st.key === 'done' ? { icon: 'circle-check' as const, text: 'Done', color: fx.hue.green400 }
    : st.key === 'partial' ? { icon: 'circle-dot' as const, text: 'Partly', color: fx.hue.amber400 }
      : st.key === 'skipped' ? { icon: 'circle-x' as const, text: 'Skipped', color: fx.ink.a50 }
        : { icon: 'circle' as const, text: 'Mark', color: fx.ink.a50 };
  // the press: the whole card .98 and the thumbnail's scrim .30 → .45, from the press progress on the UI thread
  const press = usePress('card', 0, { scroll: true });
  const { progress, to, calm } = press;
  const scrimFrom = S.m74.scrimFrom, scrimTo = S.m74.scrimTo;
  // the open: from the release the card holds at the tile press (.96, the scrim at .45) until the player covers it,
  // so a quick tap (released before the scroller's press delay) still answers on the next frame (M69 fix round)
  const hold = useSharedValue(0);
  const tile = motionValues.press.tile;
  const card = useAnimatedStyle(() => {
    const p = progress.value, h = hold.value;
    if (calm || (p === 0 && h === 0)) return { transform: [] };
    return { transform: [{ scale: Math.min(1 - (1 - to) * p, 1 - (1 - tile) * h) }] };
  }, [to, calm]);
  const scrim = useAnimatedStyle(() => ({ opacity: scrimFrom + (scrimTo - scrimFrom) * Math.max(0, Math.min(1, Math.max(progress.value, hold.value))) }));
  const pressIn = () => { press.onPressIn(); afterPaint(() => warmSession(s.id, s.coverPosterUrl)); };
  const onOpen = () => {
    hold.value = withTiming(1, calm ? calmFade(t.press) : timing(t.press));
    holdUntilCovered(() => { hold.value = 0; }); // covered by then: back at rest unseen
    warmSession(s.id, s.coverPosterUrl); // a tap shorter than the press delay never had a press-in
    openRow(live);
  };
  const onMark = () => markRow(live);
  return <Animated.View style={card}><GlassCard padding={0} clip borderColor={st.key === 'done' ? fx.tone.greenLine : undefined}>
    {fresh ? <Sweep /> : null}
    <View style={styles.planRow}>
      <Pressable {...press.scrollProps} accessibilityRole="button" accessibilityLabel={`Open ${s.title} in the player`} onPress={onOpen} onPressIn={pressIn} onPressOut={press.onPressOut} style={styles.thumb}>
        <MorphSource morphKey={workoutMorphKey(s.id)} style={StyleSheet.absoluteFill}>
          {poster ? <RemotePhoto uri={poster} opacity={0.7} fallbackSlot={photo.slot} fallbackPick={photo.pick} decorative style={StyleSheet.absoluteFill} />
            : <Photo slot={photo.slot} pick={photo.pick} opacity={0.7} decorative style={StyleSheet.absoluteFill} />}
          <Animated.View style={[StyleSheet.absoluteFill, styles.thumbScrim, scrim]} />
        </MorphSource>
        <View pointerEvents="none" style={styles.playGlyph}><Icon name="play" size={24} color={fx.ink.white} /></View>
      </Pressable>
      <Pressable {...press.scrollProps} accessibilityRole="button" accessibilityLabel={`${s.title}, ${sessionMeta(s)}${st.key === 'ahead' ? '' : `, ${st.text}`}`} onPress={onOpen} onPressIn={pressIn} onPressOut={press.onPressOut} style={styles.planText}>
        {/* the title keeps its words whole and the meta its last part (the minutes) at a large text size on a narrow
            phone: FitText, and a third line for the meta (SWA-10) */}
        <FitText v="sectionStrong" color={st.key === 'done' ? fx.ink.a50 : fx.ink.white} numberOfLines={3} style={st.key === 'done' ? styles.struck : null}>{s.title}</FitText>
        <View style={styles.metaLine}>
          {fresh ? <NewPill /> : null}
          {/* keeps its last part on a box that hugs it (TAB-01: 'Wed · 4 exercises' drawn 'Wed · 4' at 320 dpi) */}
          <HugText v="caption" color={fx.ink.a50} numberOfLines={3} style={styles.flexShrink}>{sessionMeta(s)}</HugText>
          {st.key === 'today' ? <T v="micro" color={fx.red.label}>Today</T> : null}
          {st.key === 'late' ? <T v="micro" color={fx.hue.amber400}>Not logged</T> : null}
          {s.feedbackCount ? <Icon name="message-square" size={12} color={fx.red.label} label="Feedback from your coach" /> : null}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={logged ? `${s.title}: ${st.text}. Open it` : `Mark ${s.title} as done`}
        onPress={logged ? onOpen : onMark}
        style={styles.mark}>
        <DoneCell id={s.id} state={st.key} done={st.key === 'done'} visible={visible}>
          <Icon name={column.icon} size={18} color={column.color} />
          <T v="micro" color={column.color} style={styles.markText}>{column.text}</T>
        </DoneCell>
      </Pressable>
    </View>
  </GlassCard></Animated.View>;
});

/** Each row's state as last seen on this device, so a row that became done while the player covered Train pops when
 *  Train is seen again (and only then). */
const SEEN_STATE = new Map<string, string>();

/** The MARK / DONE column's content: its green ground glides in (a state mix), and a session that became done or
 *  partly done since it was last seen pops (spring.pop) when the page is seen. Tier C and reduced motion: no pop. */
function DoneCell({ id, state, done, visible, children }: { id: string; state: string; done: boolean; visible: boolean; children: React.ReactNode }) {
  const { calm, tier } = useFx();
  const mix = useStateMix(done);
  const pop = useSharedValue(1);
  useLayoutEffect(() => {
    if (!visible) return;
    const was = SEEN_STATE.get(id);
    SEEN_STATE.set(id, state);
    if (was === undefined || was === state || calm || tier === 'C') return;
    if (state !== 'done' && state !== 'partial') return;
    pop.value = 0;
    pop.value = withSpring(1, spring.pop);
  }, [visible, state]); // eslint-disable-line react-hooks/exhaustive-deps
  const ground = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(mix.value, [0, 1], [CLEAR, GREEN_BG]),
    borderLeftColor: interpolateColor(mix.value, [0, 1], [LINE, GREEN_LINE]),
  }));
  const content = useAnimatedStyle(() => (pop.value === 1 ? { transform: [] } : { transform: [{ scale: pop.value }] }));
  return <Animated.View style={[StyleSheet.absoluteFill, styles.markFill, ground]}>
    <Animated.View style={[styles.markInner, content]}>{children}</Animated.View>
  </Animated.View>;
}
const CLEAR = fx.premium.transparent;
const GREEN_BG = fx.tone.greenBg;
const LINE = fx.line.a05;
const GREEN_LINE = fx.tone.greenLine;

/** PREMIUM §1.3F: a new or changed session gets a "NEW" pill that pops in. */
export function NewPill() {
  return <Reveal mount from="scale">
    <View style={styles.newPill}><T v="micro" color={fx.ink.white} style={styles.newText}>New</T></View>
  </Reveal>;
}

/** …and one 1 px red hairline sweeping across its top (S.m72.weekSweepMs), once; `inset` keeps it inside a rounded
 *  card's corners. Reduced motion: none. */
function Sweep({ inset = 0 }: { inset?: number }) {
  const { calm } = useFx();
  const x = useSharedValue(0);
  const o = useSharedValue(calm ? 0 : 1);
  useEffect(() => {
    if (calm) return;
    const ms = S.m72.weekSweepMs;
    x.value = withTiming(1, timing(ms, ease.inOut));
    o.value = withSequence(withTiming(1, { duration: 0 }), withDelay(ms, withTiming(0, timing(t.base))));
  }, [calm, x, o]);
  const a = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ scaleX: x.value }] }));
  return <Animated.View pointerEvents="none" style={[styles.sweep, inset ? { left: inset, right: inset } : null, a]} />;
}

/* ---------- programmes ---------- */

export function ProgrammeCard({ p, fresh }: { p: Programme; fresh?: boolean }) {
  return <GlassCard style={styles.gap6}>
    {fresh ? <Sweep /> : null}
    <View style={styles.titleLine}>
      <T v="eyebrowStore" color={fx.ink.a60} style={styles.flexShrink}>{`Version ${p.version} · by ${p.coachName}`}</T>
      {fresh ? <NewPill /> : null}
    </View>
    <T v="heading">{p.title}</T>
    {p.summary ? <T v="bodySm" color={fx.ink.a70}>{p.summary}</T> : null}
    {p.updatedAt ? <T v="caption" color={fx.ink.a50}>{`Updated ${fmtDate(p.updatedAt)}`}</T> : null}
  </GlassCard>;
}

/* ---------- the library ---------- */

export const ExerciseCard = memo(function ExerciseCard({ e, onOpen: openCard }: { e: Exercise; onOpen: (e: Exercise) => void }) {
  const onOpen = () => openCard(e);
  const poster = serverUrl(e.media?.posterUrl);
  if (!poster && !hasClip(e.media)) return <ExerciseRow e={e} onOpen={onOpen} />;
  return <GlassCard padding={0} clip onPress={onOpen} label={`${e.name}, ${categoryLabel(e.category)}${hasClip(e.media) ? ', with a video' : ''}`}>
    <MorphSource morphKey={exerciseMorphKey(e.id)} style={styles.media}>
      {poster ? <ExercisePoster uri={poster} category={e.category} opacity={0.7} style={StyleSheet.absoluteFill} />
        : <ExerciseTile category={e.category} style={StyleSheet.absoluteFill} />}
    </MorphSource>
    <TypePill category={e.category} style={styles.typePillOver} />
    {hasClip(e.media) ? <View style={styles.badge}><PhotoTag mono>Video</PhotoTag></View> : null}
    <View style={styles.cardBody}>
      <T v="sectionStrong" numberOfLines={2}>{e.name}</T>
      {e.description ? <T v="bodySm" color={fx.ink.a70} numberOfLines={2}>{e.description}</T> : null}
      <Equipment list={e.equipment} />
    </View>
  </GlassCard>;
});

/** The library row of an exercise without a clip (see the header, T6-37). */
function ExerciseRow({ e, onOpen }: { e: Exercise; onOpen: () => void }) {
  const { width } = useWindowDimensions();
  // the text column's width: the category pill's word shrinks just enough to stay whole in it ('CONDITIONI/NG' at 320 dp
  // and text 1.3, SWA-06), and so does the name
  const [room, setRoom] = useState(0);
  // the exercise screen's hero is the same tile across the window: its icon at the thumbnail's scale
  const icon = Math.max(ROW_ICON_MIN, Math.round((HERO_ICON * ROW_THUMB_W) / Math.max(1, width)));
  return <GlassCard padding={0} clip onPress={onOpen} label={`${e.name}, ${categoryLabel(e.category)}`}>
    <View style={styles.libRow}>
      <MorphSource morphKey={exerciseMorphKey(e.id)} style={styles.libThumb}>
        <ExerciseTile category={e.category} icon={icon} style={StyleSheet.absoluteFill} />
      </MorphSource>
      <View style={styles.libText} onLayout={(ev) => { const w = Math.floor(ev.nativeEvent.layout.width); if (w !== room) setRoom(w); }}>
        <TypePill category={e.category} room={room} />
        <FitText v="sectionStrong" numberOfLines={2}>{e.name}</FitText>
        <Equipment list={e.equipment} />
      </View>
    </View>
  </GlassCard>;
}
/** The library row's thumbnail (16:9, pt) and the smallest icon drawn on it. */
const ROW_THUMB_W = 112;
const ROW_ICON_MIN = 12;

/** The category pill in its colour (over the card's picture, or in a row's text). `room`: the width the pill may take
 *  (a row's text column); its word shrinks just enough to stay whole in what the pill's icon and padding leave. */
function TypePill({ category, style, room }: { category: string; style?: StyleProp<ViewStyle>; room?: number }) {
  const c = categoryColor(category);
  return <View style={[styles.typePill, { borderColor: withAlpha(c, 0.38) }, style]}>
    <View style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha(c, 0.19) }]} />
    <Icon name={categoryIcon(category)} size={12} color={categoryInk(category)} />
    {room ? <FitText v="micro" color={categoryInk(category)} style={styles.typeText} width={Math.max(1, room - PILL_CHROME)}>{categoryLabel(category)}</FitText>
      : <T v="micro" color={categoryInk(category)} style={styles.typeText}>{categoryLabel(category)}</T>}
  </View>;
}
/** What a category pill takes besides its word: the padding (10 + 10), the icon and its gap (12 + 6) and the border. */
const PILL_CHROME = 10 + 10 + 12 + 6 + 2;

/** The first three pieces of equipment as small tags. */
function Equipment({ list }: { list: string[] | null }) {
  if (!list?.length) return null;
  return <View style={styles.tags}>
    {list.slice(0, 3).map((q) => <View key={q} style={styles.tag}><T v="caption" color={fx.ink.a80}>{cap(q)}</T></View>)}
  </View>;
}

const styles = StyleSheet.create({
  statsCard: { paddingTop: 10, paddingBottom: 18, paddingHorizontal: 12, boxShadow: fx.shadow.card },
  weekRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  weekLabel: { flex: 1, alignItems: 'center', gap: 2, minHeight: 44, justifyContent: 'center' },
  stats: { flexDirection: 'row', alignItems: 'center' },
  stat: { flex: 1, minWidth: 0, alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  statValue: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 1 },
  statNumber: { fontFamily: FONTS.mono700, fontSize: 20, lineHeight: 26 },
  statLabel: { color: fx.ink.white, letterSpacing: 2, textAlign: 'center' },
  vline: { width: 1, alignSelf: 'stretch', backgroundColor: fx.line.a05, marginVertical: 4 },
  planRow: { flexDirection: 'row', alignItems: 'stretch', minHeight: 80 },
  thumb: { width: 80, height: 80, alignItems: 'center', justifyContent: 'center', backgroundColor: fx.bg.card, overflow: 'hidden' },
  thumbScrim: { backgroundColor: fx.bg.deep },
  playGlyph: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  planText: { flex: 1, minWidth: 0, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 4 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metaLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  flexShrink: { flexShrink: 1 },
  struck: { textDecorationLine: 'line-through' },
  mark: { width: 76 },
  markFill: { borderLeftWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  markInner: { alignItems: 'center', justifyContent: 'center', gap: 4 },
  markText: { fontSize: 9, letterSpacing: 1 },
  newPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: fx.radius.pill, backgroundColor: fx.red.brand, boxShadow: fx.shadow.segment },
  newText: { fontSize: 9 },
  sweep: { position: 'absolute', top: 0, left: 0, right: 0, height: 1, backgroundColor: fx.red.brand, transformOrigin: 'left', zIndex: 2 },
  gap6: { gap: 6 },
  media: { height: 160, backgroundColor: fx.bg.card, overflow: 'hidden' },
  typePill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: fx.radius.pill, borderWidth: 1, backgroundColor: fx.glass.onPhotoStrong, overflow: 'hidden' },
  typePillOver: { position: 'absolute', top: 12, left: 12 },
  typeText: { fontSize: 10, letterSpacing: 1.4 },
  badge: { position: 'absolute', top: 160 - 12 - 24, right: 12 },
  cardBody: { padding: 16, gap: 6 },
  libRow: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12 },
  libThumb: { width: ROW_THUMB_W, aspectRatio: 16 / 9, backgroundColor: fx.bg.card, overflow: 'hidden' },
  libText: { flex: 1, minWidth: 0, gap: 6 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: fx.radius.sm, backgroundColor: fx.fill.a05, borderWidth: 1, borderColor: fx.line.a05 },
});
