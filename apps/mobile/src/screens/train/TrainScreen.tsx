/* The Train tab (the earlier app's TRAIN, shots 32-train*, 33, 34, r360-09, r820-09; BUILD §6.3; PREMIUM §1.10):
   - the header over the Train photo (the gym at night for All; a category's photo crossfading in when its chip is on;
     the programme photo on Plan), "Train" and how many sessions the coach planned this week (what the member logged
     is counted in the stats card, never on the photo);
   - This week · Plan · History (a segment row that pins under the compact bar as the page scrolls; ?view=plan|history
     opens a segment, the device remembers the last one);
   - This week: the category chips (the categories of this week's sessions and of the library), the stats row with the
     week arrows, "Your Coach's Plan" (MARK opens the quick-log sheet; the photo opens the player), the programme,
     Live classes (sessions module) and the Exercise library; ?section=live puts Live classes first;
   - Plan: the coach's weekly plan with Done / Skip / Undo; History: the log and the personal records.
   Coach updates: the page reloads when it comes back into view, when the app returns to the foreground, and when a new
   notification about a programme or a session arrives (useUpdates polls while the app is open); a programme version
   this device has not seen gets a NEW pill and the toast "New plan from your coach". Modules: with workouts off the
   Plan segment comes first, This week says there is no workout programme and History is not offered; with sessions
   off there are no Live classes.
   Motion v2:
   - M71 rows are keyed by their session (cards by their exercise), so a category chip keeps the rows that stay: they
     never fade and only move by layout (native glides them, 300 ms expo; the web snaps them under the faded exit);
     rows that appear rise 12 pt (300 ms expo, 50 ms apart, four steps at most) and rows that go fade out (160 ms).
     Library cards enter through the scroll reveal only, so none animates off screen. Tier C: opacity only (200 ms);
     reduced motion: at once;
   - M75 the segments swap through SwitchView (the old view leaves 12 pt the other way in 160 ms, inert, while the new
     one enters from 20 pt over 300 ms); the plan and the history are asked for when Train gains focus, and their
     cascades play once per launch;
   - M76 the week arrows slide the plan's rows: the old week leaves 24 pt the other way (160 ms) and the new one enters
     from 24 pt (260 ms expo) once its data is here, so the list is never blank;
   - M72 what the player changed (a session logged) is shown when Train is seen again: the stats count, the row's DONE
     cell pops. */
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { LinearTransition, useAnimatedStyle } from 'react-native-reanimated';
import {
  Button, CompactBar, EmptyState, ErrorState, FilterChip, H, Icon, NoSwipeZone, P, Reveal, RevealScope, RingSpinner, ScreenHeader, Segmented, StaleBanner,
  StickyUnderBar, SwitchView, T, TabScreen, ease, fx, motionValues, onUpdate, openWithMorph, prefetch, readKeyed, setSetting, toast, useFocusRefresh, useFx, useTabScroll, writeKeyed,
} from '@/fx';
import { CHIP_ROW_TOUCH } from '@/fx/Chip';
import { ApiError, get, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFeatures } from '@/lib/features';
import { useLoad } from '@/lib/useLoad';
import { HeaderBackdrop } from './HeaderBackdrop';
import { HistoryView } from './HistoryView';
import { LiveClasses, type LiveList } from './LiveClasses';
import { MarkSheet } from './MarkSheet';
import { Gone, ListIn, Swap, usePresence } from './motion';
import { PlanView, loadProgramme } from './PlanView';
import { HISTORY_KEY, RECORDS_KEY, loadHistory, loadRecords } from './HistoryView';
import { CoachPlanRow, ExerciseCard, ProgrammeCard, StatsCard, createSeenStore, type SeenStore } from './WeekParts';
import {
  asCategory, categoryLabel, dayMonth, exerciseMorphKey, hasClip, presentCategories, rememberExercise, rememberSession, shiftDate, useLiveSetting, weekday, workoutMorphKey,
  type Category, type Exercise, type SessionRow, type Week,
} from './shared';

type Segment = 'week' | 'plan' | 'history';
const LABELS: Record<Segment, string> = { week: 'This week', plan: 'Plan', history: 'History' };
const isSegment = (v: unknown): v is Segment => v === 'week' || v === 'plan' || v === 'history';
type Library = { items: Exercise[]; nextCursor: string | null };
/** Library cards drawn at first, and per "Show more" (each is a photo card): the list stays short however large the
 *  library grows; the count above it is the whole library's. */
const LIB_PAGE = 12;
/** With the workouts module off: no promise of a programme the coach cannot publish while it is off. */
const WORKOUTS_OFF = 'Workouts are not available right now';
const S = motionValues.screens;
/** The week arrows' slide (M76). */
const WEEK_SLIDE = { outD: S.m76.weekX, outMs: S.m76.weekOutMs, inD: S.m76.weekX, inMs: S.m76.weekInMs };

/** A module's route answers FEATURE_DISABLED while its flag is off: that is "nothing", not an error. */
function offIsEmpty<T>(p: Promise<T>): Promise<T | null> {
  return p.catch((e) => { if (e instanceof ApiError && e.code === 'FEATURE_DISABLED') return null; throw e; });
}

export default function TrainScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ view?: string; section?: string }>();
  const features = useFeatures(true);
  const workoutsOn = !features || features.has('workouts');
  const sessionsOn = !features || features.has('sessions');
  const segments: Segment[] = workoutsOn ? ['week', 'plan', 'history'] : ['plan', 'week'];

  // the segment: a link's ?view= wins, else the one last used on this device
  const asked = isSegment(params.view) ? params.view : params.section === 'live' ? 'week' : null;
  const [chosen, setChosen] = useState<Segment | null>(asked);
  // ?section=live puts Live classes first for that visit (kept here: the parameter itself is consumed at once)
  const [liveFirst, setLiveFirst] = useState(params.section === 'live');
  // a link's ?view= / ?section= is applied once, when the tab gains focus with it, and consumed there and then (cleared
  // from the route while Train is the focused screen: a clear sent on blur reached the next screen instead), so the
  // segment the member then chooses stays when Train is seen again (after the player, or another tab); a second "Open
  // the plan" brings the parameter back and opens Plan again
  useFocusEffect(useCallback(() => {
    if (!asked) return;
    setChosen(asked);
    setLiveFirst(params.section === 'live');
    router.setParams({ view: undefined, section: undefined });
  }, [asked])); // eslint-disable-line react-hooks/exhaustive-deps
  // the visit that put Live classes first ends when the member leaves Train for another tab (or chooses a segment,
  // below); a screen pushed over the tabs (a live class, the player, an exercise) blurs Train too but leaves the tabs
  // on Train, so the shelf is still first when the member comes back from it
  const navigation = useNavigation();
  useFocusEffect(useCallback(() => {
    const at = (s: ReturnType<typeof navigation.getState>) => (s ? s.routes[s.index]?.key : undefined);
    const mine = at(navigation.getState());
    return () => { if (at(navigation.getState()) !== mine) setLiveFirst(false); };
  }, [navigation]));
  useEffect(() => {
    if (asked) return;
    void readKeyed('segment', 'train').then((v) => { if (isSegment(v)) setChosen((c) => c ?? v); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const view: Segment = chosen && segments.includes(chosen) ? chosen : segments[0];
  const [dir, setDir] = useState<1 | -1>(1);
  const choose = (v: Segment) => {
    if (v !== view) setLiveFirst(false); // another segment ends the visit that put Live classes first
    setDir(segments.indexOf(v) >= segments.indexOf(view) ? 1 : -1); setChosen(v); void writeKeyed('segment', 'train', v);
  };
  const openWeek = () => choose('week');
  // the plan and the history are asked for when Train gains focus, so their segments open on data (M75); whether Train
  // is seen is a store, so the player opening over it re-renders nothing here
  const [seen] = useState(createSeenStore);
  useFocusEffect(useCallback(() => {
    seen.show();
    prefetch('programme', loadProgramme).catch(() => undefined);
    // history and records only once the module list says workouts is on (`workoutsOn` is true while it is unknown)
    if (features?.has('workouts')) {
      prefetch(HISTORY_KEY, loadHistory).catch(() => undefined);
      prefetch(RECORDS_KEY, loadRecords).catch(() => undefined);
    }
    return () => seen.hide();
  }, [seen, features]));

  // this week (or another week) and the library
  const [from, setFrom] = useState<string | null>(null);
  const [thisWeekFrom, setThisWeekFrom] = useState<string | null>(null);
  // the week arrows' direction: earlier weeks come in from the left, later ones from the right
  const [weekDir, setWeekDir] = useState<1 | -1>(1);
  // nothing is asked until the flags are known (a module that is off answers FEATURE_DISABLED); until then the loads run
  // under no key, so their placeholder null is never written over the copy saved for offline use (offline, a Train
  // mounted afresh showed the Offline notice over an empty week: the saved week had been replaced by that null)
  const known = !!features;
  const week = useLoad<Week | null>(from || !known ? null : 'workouts', () => (known && workoutsOn ? offIsEmpty(get<Week>(`/me/workouts${qs({ from: from ?? undefined })}`)) : Promise.resolve(null)), [from, known, workoutsOn]);
  const lib = useLoad<Library | null>(known ? 'exercises' : null, () => (known && workoutsOn ? offIsEmpty(get<Library>('/me/exercises?limit=100')) : Promise.resolve(null)), [known, workoutsOn]);
  const live = useLoad<LiveList | null>(known ? 'sessions.list' : null, () => (known && sessionsOn ? offIsEmpty(get<LiveList>('/me/sessions')) : Promise.resolve(null)), [known, sessionsOn]);
  const [moreLib, setMoreLib] = useState<{ items: Exercise[]; cursor: string | null } | null>(null);
  const [libBusy, setLibBusy] = useState(false);
  const w = week.data;
  useEffect(() => { if (!from && w) setThisWeekFrom(w.from); }, [from, w]);
  // the week arrows (stable, so the stats card renders again only when its week does)
  const wFrom = w?.from ?? null;
  const onEarlier = useCallback(() => { if (!wFrom) return; const n = shiftDate(wFrom, -7); setWeekDir(-1); setFrom(n === thisWeekFrom ? null : n); }, [wFrom, thisWeekFrom]);
  const onLater = useCallback(() => { if (!wFrom) return; const n = shiftDate(wFrom, 7); setWeekDir(1); setFrom(n === thisWeekFrom ? null : n); }, [wFrom, thisWeekFrom]);
  const onThisWeek = useCallback(() => { setWeekDir(wFrom && wFrom > (thisWeekFrom ?? wFrom) ? -1 : 1); setFrom(null); }, [wFrom, thisWeekFrom]);


  // refresh: on focus, foreground, pull, and coach updates (useUpdates invalidates 'workouts' and 'programme')
  const extra = useRef<(() => Promise<unknown>) | null>(null);
  const register = useCallback((fn: (() => Promise<unknown>) | null) => { extra.current = fn; }, []);
  const reloadWeek = week.reload, reloadLib = lib.reload, reloadLive = live.reload;
  const reloadAll = useCallback(() => { setMoreLib(null); return Promise.all([reloadWeek(), reloadLib(), reloadLive(), extra.current?.()]); }, [reloadWeek, reloadLib, reloadLive]);
  const { refreshing, onRefresh } = useFocusRefresh(reloadAll);
  useEffect(() => onUpdate((fresh) => {
    const about = (k: string) => fresh.some((n) => !!n.data && k in n.data);
    if (about('sessionId')) void reloadLive();
    if (from && (about('programId') || about('programmeId') || about('workoutId'))) void reloadWeek();
  }), [from, reloadLive, reloadWeek]);

  // a programme (or a version of one) this member has not seen on this device yet: NEW pills and one toast. Kept per
  // member and per programme: another member on this phone, or a new programme at version 1, is judged on its own
  const { user } = useAuth();
  const memberId = user?.id ?? null;
  const { value: seenAll, loaded } = useLiveSetting('seenProgrammes');
  const programmes = !from ? w?.programs ?? null : null;
  const programmesKey = programmes ? programmes.map((p) => `${p.id}:${p.version}`).join(',') : null;
  const [freshId, setFreshId] = useState<string | null>(null);
  useEffect(() => {
    if (!programmes || !loaded || !memberId) return;
    const mine = seenAll?.[memberId];
    const now = Object.fromEntries(programmes.map((p) => [p.id, p.version]));
    if (!mine) { void setSetting('seenProgrammes', { ...seenAll, [memberId]: now }); return; } // the first look is not "new"
    const fresh = programmes.find((p) => mine[p.id] !== p.version);
    if (fresh) {
      setFreshId(fresh.id);
      toast.info('New plan from your coach');
      void setSetting('seenProgrammes', { ...seenAll, [memberId]: { ...mine, ...now } });
    }
  }, [programmesKey, memberId, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // chips: the categories present in this week's sessions and the library
  const libItems = useMemo(() => [...(lib.data?.items ?? []), ...(moreLib?.items ?? [])], [lib.data, moreLib]);
  const cats = useMemo(() => presentCategories([...(w?.items ?? []).map((s) => s.categories), ...libItems.map((e) => [e.category])]), [w, libItems]);
  const [chip, setChip] = useState<Category | 'all'>('all');
  const active: Category | 'all' = chip !== 'all' && cats.includes(chip) ? chip : 'all';
  const slot = view === 'plan' ? 'train.plan.header' : active === 'all' ? 'train.header.all' : `train.header.${active}`;

  // the header line, from this week
  const [subtitle, setSubtitle] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!workoutsOn) { setSubtitle(WORKOUTS_OFF); return; }
    if (from || !w) return;
    const n = w.items.length;
    // what the coach planned, never what the member logged: the line sits on a photo that may show a person (AMENDED §6
    // rule b), and the stats card under it counts what was done
    setSubtitle(!w.programs.length && !n ? 'No workout programme yet' : n ? `${n} session${n === 1 ? '' : 's'} planned this week` : 'No sessions this week');
  }, [w, from, workoutsOn]);

  const [headerH, setHeaderH] = useState(140);
  const [marking, setMarking] = useState<SessionRow | null>(null);
  // the plan row shows the first clip's poster when there is one: the player opens on the same picture (?cover=clip)
  // the route is pushed on the frame after the measure, so the row's held press draws before the route's mount (M69)
  const openSession = useCallback((s: SessionRow) => { rememberSession(s); openWithMorph(workoutMorphKey(s.id), () => requestAnimationFrame(() => router.push(`/workout/${s.id}?cat=${asCategory(s.categories?.find(Boolean))}${s.coverPosterUrl ? '&cover=clip' : ''}`))); }, [router]);
  const openExercise = useCallback((e: Exercise) => { rememberExercise(e); openWithMorph(exerciseMorphKey(e.id), () => router.push(`/exercise/${e.id}`)); }, [router]);
  const showMoreLib = async () => {
    const cursor = moreLib ? moreLib.cursor : lib.data?.nextCursor;
    if (!cursor) return;
    setLibBusy(true);
    try { const r = await get<Library>(`/me/exercises${qs({ limit: 100, cursor })}`); setMoreLib((m) => ({ items: [...(m?.items ?? []), ...r.items], cursor: r.nextCursor })); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Something went wrong.'); } finally { setLibBusy(false); }
  };
  const libCursor = moreLib ? moreLib.cursor : lib.data?.nextCursor ?? null;

  const rows = (w?.items ?? []).filter((s) => active === 'all' || (s.categories ?? []).includes(active));
  const rowsDone = rows.filter((s) => s.status === 'completed' || s.status === 'partial').length;
  // the exercises with a demonstration clip first (the library opens on its photo cards), each group in the API's order
  const libShown = useMemo(() => {
    const inCat = libItems.filter((e) => active === 'all' || asCategory(e.category) === active);
    return [...inCat.filter((e) => hasClip(e.media)), ...inCat.filter((e) => !hasClip(e.media))];
  }, [libItems, active]);
  const [libLimit, setLibLimit] = useState<{ cat: string; n: number }>({ cat: active, n: LIB_PAGE });
  const libN = libLimit.cat === active ? libLimit.n : LIB_PAGE; // a new category starts from the first page again
  const showMore = () => { if (libShown.length > libN) setLibLimit({ cat: active, n: libN + LIB_PAGE }); else void showMoreLib(); };
  const liveSection = sessionsOn && live.data ? <LiveClasses data={live.data} /> : sessionsOn && live.error ? <View style={styles.pad}><ErrorState error={live.error} onRetry={live.reload} /></View> : null;

  const weekBody = <View style={styles.sections}>
    {cats.length > 1 ? <NoSwipeZone>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={CHIP_ROW_TOUCH.scroller} contentContainerStyle={[styles.chips, CHIP_ROW_TOUCH.content]} accessibilityLabel="Categories">
        {(['all', ...cats] as Array<Category | 'all'>).map((c) => <FilterChip key={c} label={c === 'all' ? 'All' : categoryLabel(c)} selected={active === c} onPress={() => setChip(c)} />)}
      </ScrollView>
    </NoSwipeZone> : null}
    {liveFirst ? liveSection : null}
    {!workoutsOn ? <View style={styles.pad}><EmptyState icon="dumbbell" title={WORKOUTS_OFF} body="Your coaching plan is under Plan." /></View>
      : <View style={[styles.pad, styles.gap16]}>
        <StaleBanner at={week.stale} />
        <ErrorState error={week.error} onRetry={week.reload} />
        {(week.loading || !known) && !w ? <View style={styles.loading}><RingSpinner label="Loading this week" /></View> : null}
        {w ? <>
          {w.programs.length || w.items.length || from ? <StatsCard week={w} isThisWeek={w.today >= w.from && w.today <= w.to} seen={seen}
            onEarlier={onEarlier} onLater={onLater} onThisWeek={onThisWeek} /> : null}
          <Swap id={w.from} dir={weekDir} timing={WEEK_SLIDE}>
            {w.items.length ? <View style={styles.gap12}>
              <H strong icon={<Icon name="clipboard-list" size={15} color={fx.red.label} />} right={<T v="caption" color={fx.ink.a50}>{`${rowsDone}/${rows.length} done`}</T>} style={styles.h}>{"Your Coach's Plan"}</H>
              {rows.length ? <PlanRows rows={rows} today={w.today} cascade={!from} seen={seen}
                fresh={(r) => !!freshId && r.programId === freshId && r.status === 'scheduled'} onOpen={openSession} onMark={setMarking} />
                : <T v="bodySm" color={fx.ink.a60}>{`No ${categoryLabel(active).toLowerCase()} sessions this week.`}</T>}
              {!from && w.next ? <T v="caption" color={fx.ink.a50}>{`Next: ${w.next.title}, ${weekday(w.next.scheduledDate)} ${dayMonth(w.next.scheduledDate)}`}</T> : null}
            </View> : w.programs.length || from
              ? <EmptyState icon="calendar" title="No sessions this week" body="Rest weeks count too. Look ahead with Later." />
              : <EmptyState photo="workouts" icon="dumbbell" title="No workout programme yet" body="Your coach writes one after reading your goals; you are told here when it is ready." />}
          </Swap>
          {w.programs.map((p) => <ProgrammeCard key={p.id} p={p} fresh={p.id === freshId} />)}
        </> : null}
      </View>}
    {!liveFirst ? liveSection : null}
    {workoutsOn && libItems.length ? <View style={[styles.pad, styles.gap16]}>
      <H strong icon={<Icon name="book-open" size={15} color={fx.red.label} />} right={<T v="caption" color={fx.ink.a50}>{`${libShown.length} exercise${libShown.length === 1 ? '' : 's'}`}</T>} style={styles.h}>Exercise library</H>
      {libShown.length ? <Library items={libShown.slice(0, libN)} onOpen={openExercise} />
        : <T v="bodySm" color={fx.ink.a60}>{`No ${categoryLabel(active).toLowerCase()} exercises in the library yet.`}</T>}
      {libShown.length > libN || libCursor ? <Button title="Show more exercises" variant="soft" busy={libBusy} onPress={showMore} /> : null}
    </View> : lib.error ? <View style={styles.pad}><ErrorState error={lib.error} onRetry={lib.reload} /></View> : null}
    {workoutsOn ? <View style={styles.pad}><P muted small>Effort ratings and logs are what you record, never a measurement.</P></View> : null}
  </View>;

  return <>
    <TabScreen refreshing={refreshing} onRefresh={onRefresh} sticky={<TrainBar />} testID="train"
      bleedTop={<View style={styles.zero}><HeaderBackdrop slot={slot} height={headerH + 40} /></View>}>
      <View onLayout={(e) => setHeaderH(Math.round(e.nativeEvent.layout.height))}>
        <ScreenHeader title="Train" subtitle={subtitle ?? ' '} />
      </View>
      <SegmentRow top={headerH}>
        <Segmented items={segments.map((v) => ({ value: v, label: LABELS[v] }))} value={view} onChange={choose} />
      </SegmentRow>
      <SwitchView id={view} direction={dir} style={styles.segBody}>
        {view === 'week' ? weekBody : view === 'plan' ? <PlanView register={register} onWeek={workoutsOn ? openWeek : undefined} /> : <HistoryView register={register} />}
      </SwitchView>
    </TabScreen>
    <MarkSheet session={marking} onClose={() => setMarking(null)} onOpenPlayer={openSession} />
  </>;
}

/** The compact bar that replaces the big title once the page scrolls. */
function TrainBar() {
  const y = useTabScroll();
  return y ? <CompactBar scrollY={y} title="Train" /> : null;
}

/** The segment row, pinned under the compact bar while the page scrolls; once pinned it is opaque, so the page
 *  passing under it does not show through the translucent segment track. */
function SegmentRow({ top, children }: { top: number; children: React.ReactNode }) {
  const y = useTabScroll();
  const insets = useSafeAreaInsets();
  const from = top - (insets.top + motionValues.header.barHeight);
  const back = useAnimatedStyle(() => ({ opacity: y ? Math.max(0, Math.min(1, (y.value - from) / 24)) : 0 }));
  const row = <View style={styles.segRow}>
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.segBack, back]} />
    {children}
  </View>;
  // keyed by the header's height: the kit's bar measures where the row sits once, when it is laid out, and on the web a
  // row that only moves (the header above it grew when the member's data arrived) is not laid out again, so it would
  // pin too low; a new header height measures it afresh
  return y ? <StickyUnderBar key={top} scrollY={y}>{row}</StickyUnderBar> : row;
}

/** How the rows that stay move when others leave (M71): native glides them; the web takes no layout transition (it
 *  would scale every child), so its rows snap once the faded row has gone; reduced motion changes at once. Rows that
 *  leave fade in place (Gone). */
function useListMotion() {
  const { calm } = useFx();
  return useMemo(() => ({
    calm,
    layout: calm || Platform.OS === 'web' ? undefined : LinearTransition.duration(S.m71.layoutMs).easing(ease.expo),
  }), [calm]);
}

/** "Your Coach's Plan" rows of one week. This week's rows enter with their cascade once per launch (Reveal ids, cleared
 *  when the member changes); a chip then keeps the rows that stay and brings in only the ones that appear; another
 *  week's list is drawn at rest (it slides in whole). */
function PlanRows({ rows, today, cascade, seen, fresh, onOpen, onMark }: {
  rows: SessionRow[]; today: string; cascade: boolean; seen: SeenStore; fresh: (s: SessionRow) => boolean; onOpen: (s: SessionRow) => void; onMark: (s: SessionRow) => void;
}) {
  const motion = useListMotion();
  const shown = useRef<Set<string> | null>(null);
  const before = shown.current;
  useEffect(() => { shown.current = new Set(rows.map((r) => r.id)); });
  const { list, done } = usePresence(rows, motion.calm);
  let k = 0;
  return <>{list.map(({ item: r, leaving }, i) => {
    const row = <CoachPlanRow s={r} today={today} fresh={fresh(r)} seen={seen} onOpen={onOpen} onMark={onMark} />;
    if (leaving) return <Glide key={r.id} layout={motion.layout}><Gone onGone={() => done(r.id)}>{row}</Gone></Glide>;
    const appeared = !!before && !before.has(r.id);
    const n = appeared ? k++ : 0;
    return <Glide key={r.id} layout={motion.layout}>
      <RowIn id={r.id} first={!before && cascade} appeared={appeared} index={before ? n : i}>{row}</RowIn>
    </Glide>;
  })}</>;
}

/** A list item's layout glide where there is one (native); elsewhere the item itself is the list's child. */
function Glide({ layout, children }: { layout: ReturnType<typeof useListMotion>['layout']; children: React.ReactNode }) {
  return layout ? <Animated.View layout={layout}>{children}</Animated.View> : <>{children}</>;
}

/** A row's entrance, decided when it mounts: the first list's cascade (Reveal), a row a chip brought in (ListIn), or at
 *  rest. */
function RowIn({ id, first, appeared, index, children }: { id: string; first: boolean; appeared: boolean; index: number; children: React.ReactNode }) {
  const [mode] = useState(first ? 'cascade' : appeared ? 'in' : 'rest');
  if (mode === 'cascade') return <Reveal mount id={`train.week.${id}`} index={index}>{children}</Reveal>;
  return <ListIn enter={mode === 'in'} index={index}>{children}</ListIn>;
}

/** The exercise library's cards, keyed by exercise: each enters through the page's scroll reveal (one below the fold
 *  waits until it is scrolled to). */
function Library({ items: now, onOpen }: { items: Exercise[]; onOpen: (e: Exercise) => void }) {
  // a chip's own frame draws the plan's rows and the header; the library (mostly below the fold) follows in a render
  // of its own, so the tap never waits on a dozen cards
  const items = useDeferredValue(now);
  const y = useTabScroll();
  const motion = useListMotion();
  // cards a chip removes go at once (most are below the fold, where nothing may animate)
  const { list: shown } = usePresence(items, true);
  const list = <>{shown.map(({ item: e }, i) => <Glide key={e.id} layout={motion.layout}>
    <Reveal index={i % LIB_PAGE}><ExerciseCard e={e} onOpen={onOpen} /></Reveal>
  </Glide>)}</>;
  return y ? <RevealScope scrollY={y}>{list}</RevealScope> : list;
}

const styles = StyleSheet.create({
  zero: { height: 0 },
  segRow: { paddingHorizontal: fx.space.cardX, paddingTop: 4, paddingBottom: 12 },
  segBack: { backgroundColor: fx.bg.panel },
  segBody: { paddingTop: 8 },
  sections: { gap: 28 },
  pad: { paddingHorizontal: fx.space.cardX },
  gap12: { gap: 12 },
  gap16: { gap: 16 },
  h: { marginBottom: 0 },
  chips: { paddingHorizontal: fx.space.titleX, gap: 12 },
  loading: { paddingVertical: 48, alignItems: 'center' },
});
