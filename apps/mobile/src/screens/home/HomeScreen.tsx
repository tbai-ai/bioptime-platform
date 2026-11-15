/* Home (the earlier app's HomeTab with Bioptime's real data; BUILD_PLAN §6.2, PREMIUM §1.10, AMENDED §6).
   Top to bottom: the people-free hero for this part of the day with the greeting, first name, package line, bell and
   mark ring; the notices (confirm your email, choose a package, news); the Wellness Score card; Today's Activity;
   Today's brief; From your coach; Today's tasks; the next session; Next (appointment, blood test, balances); the metric
   tiles; the daily streak; live sessions; last night; this week's sessions; today's goals; hydration; the progress
   gallery. A section whose module is off is not drawn, and one with nothing real to show says so or stays away.
   A member in the first seven days of their account sees "Your first week" above the ring while something on it is
   still to do (FirstWeek: real actions only, each ticked once its record exists). The card and its rows are decided
   once, before the body mounts, from settled inputs (habits come with the prefetch; a new member's body waits for them
   at most the prefetch's cap), so it never appears or grows over the arriving score card; with no value in any metric
   tile the four empty tiles are one "Log your first values" row. The email notice stays until the address is confirmed
   (the session's own emailVerified: a demo member is made active by onboarding while the address may still wait).
   The News card opens the Inbox on its News tab; the bell on Notifications.
   Motion (motion v2 M63): the earlier app's first-mount timeline from the page-active edge, card first (the first card
   enters on the edge itself on the soft spring, then the greeting .2, ring .3, activity .3; the ring sweep and count
   start as the card reaches .6). While a mark handed to the header ring flies over the first cards or the greeting,
   they hold and fade in once it has passed (MarkClear; off at tier C and under reduced motion). A skeleton, once drawn,
   is never cut to an empty page: it stays over the arriving body and crossfades out from the frame the first card
   starts to enter (m52.cFadeMs; reduced motion: gone at once); on the first arrival out of a page skeleton (the
   sign-in, onboarding, the open preview) it is drawn from Home's first frame (the pager's page skeleton has just been
   there, and the first card waits for the page-active edge and for the mark), so the page goes from skeleton to content
   and is never empty between them; a Home first drawn under the launch sting (a restored session) holds none,
   everything below revealed once as it scrolls into view; a revisit in the same launch shows it at rest; reduced
   motion shows the rest state. The first frame draws from the answers Home already has (the prefetch during the
   splash or the sign-in, or Home's last answers for this member: data.peekHome); later in a launch a skeleton appears
   only when /me has not answered within 600 ms (the first arrival holds one as above). Today's brief mounts with Home (its lines rise as
   its card lands); everything below it (the coach's note, news, tasks, the next session, Next, the metric tiles, the
   streak, live sessions, last night, this week's shelf, goals, hydration and the gallery) mounts once the Wellness
   sweep has landed and then once the page has settled and the device is idle (Deferred), keeping its height on later
   visits, so no mount lands in the sweep's frames. The body itself mounts in the frame after the header (on the web a
   yielding render), and the above-the-fold delays count from the page-active edge, not from the body's own mount. A
   tab switch re-renders only what changes with the focus (the body, the header and the inbox are memoised
   on their data), so the frames of a switch carry no Home render. Data refreshes on focus, on return to the
   foreground, on pull, and when a coach update arrives (useUpdates). While a sheet is open over Home (the Inbox), Home's
   decorative loops (the orbs, the score halo, the live dot) rest under it (SheetGate), so the open sheet draws no frame
   of theirs. */
import { Redirect, router, useIsFocused } from 'expo-router';
import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { MarkClear, useMarkClear, type MarkClearState } from '@/flow/MarkClear';
import {
  DemotionProbe, ErrorState, fx, onUpdate, pollUpdates, Reveal, RevealScope, Skeleton, SkeletonRing, StaleBanner, TabScreen, toast,
  useFocusRefresh, useMotion, useStepCounter, useTabScroll, useUpdates, openWithMorph,
} from '@/fx';
import { whenSplashGone } from '@/fx/brand/SplashHost';
import { markInFlight } from '@/fx/motion/gestureState';
import { wasRevealed } from '@/fx/motion/seen';
import { useRevealLanding } from '@/fx/motion/Reveal';
import { ease, motionValues, timing } from '@/fx/motion/tokens';
import { Deferred } from '@/fx/nav/Deferred';
import { usePageActive } from '@/fx/nav/pageReady';
import { errorText, get, api, patch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFeatures } from '@/lib/features';
import { fmtDate, istDate } from '@/lib/format';
import { todaySteps } from '@/lib/today';
import { useLoad } from '@/lib/useLoad';
import { ActivityCard } from './ActivityCard';
import {
  activeMinutesToday, balancesOf, briefText, firstName, goalRows, habitWeek, istDayOf, metricView, nextAppointmentOf, num, openFocus, peekHome, PHONE_APP, rememberHome, upcomingSessions,
  type Announcement, type ApptRow, type BloodBooking, type Checkin, type Goal, type Habits, type LiveSession, type Me, type Note, type PhotosData, type Summary, type Task, type Workouts, type WorkoutSession,
} from './data';
import { Gallery } from './Gallery';
import { HomeCompactBar, HomeHeader, HomeHero } from './HomeHeader';
import { useDayPart } from './heroForHour';
import { HydrationCard } from './HydrationCard';
import { InboxSheet } from './Inbox';
import { FirstWeekCard, inFirstWeek, type FirstWeekRow } from './FirstWeek';
import { BriefCard, CoachNoteCard } from './InsightCards';
import { GoalsCard, LastNightCard, StreakCard } from './LifeCards';
import { MetricTiles, type TileSpec } from './MetricTiles';
import { NextRows, NextSessionBanner } from './NextCards';
import { ChoosePackageCard, ConfirmEmailNotice, NewsNotice } from './Notices';
import { GUTTER, SectionTitle } from './parts';
import { ScoreCard, type MiniMetric } from './ScoreCard';
import { SheetLoopGate } from './SheetGate';
import { LiveSessionsStrip, WeekShelf } from './Shelves';
import { TasksCard } from './TasksCard';
import { spreadSessionPhotos } from '@/fx/media/slots';
import { asCategory, workoutMorphKey } from '../train/shared';

const off = <T,>(): Promise<T | null> => Promise.resolve(null);
const NONE: never[] = [];
const S = motionValues.screens.m63;
/** How long Home waits for /me before it shows a skeleton (the prefetch's own cap). */
const SKELETON_AFTER = motionValues.screens.m52.prefetchCap;
/** A skeleton that was drawn gives way to the content over this long, from the frame the first card starts to enter. */
const SKELETON_OUT = motionValues.screens.m52.cFadeMs;
/** How long a new member's body waits for the first-week card's inputs (the same cap as the prefetch's). */
const WEEK_WAIT = motionValues.screens.m52.prefetchCap;
const css = ease.css;

/** Whether the launch sting is still on screen (running, or fading its black over the route it released): a Home that
 *  first draws then is under that black. Read once, without subscribing (a subscription would re-render Home in the
 *  hand-off's frames): whenSplashGone calls back at once when the sting has gone or never ran, else it is cancelled. */
function underSting(): boolean {
  let gone = false;
  whenSplashGone(() => { gone = true; })();
  return !gone;
}

const SCORE_METRICS: { key: string; short: string; label: string; unit: string }[] = [
  { key: 'resting_hr_bpm', short: 'Resting HR', label: 'Resting heart rate', unit: 'bpm' },
  { key: 'sleep_hours', short: 'Sleep', label: 'Sleep', unit: 'hours' },
  { key: 'steps', short: 'Steps', label: 'Steps', unit: 'steps' },
];
const TILE_METRICS: { key: string; short: string; label: string; unit: string }[] = [
  { key: 'resting_hr_bpm', short: 'Resting HR', label: 'Resting heart rate', unit: 'bpm' },
  { key: 'sleep_hours', short: 'Sleep', label: 'Sleep', unit: 'h' },
  { key: 'weight_kg', short: 'Weight', label: 'Weight', unit: 'kg' },
  { key: 'steps', short: 'Steps', label: 'Steps', unit: 'steps' },
];

export function HomeScreen() {
  const { user } = useAuth();
  const focused = useIsFocused();
  const features = useFeatures(true);
  const on = (f: string) => !!features?.has(f);
  const fk = features ? [...features].sort().join(',') : '';

  // the first-frame keys are taken from the prefetch (shared) and drawn from Home's last answers until they arrive
  const me = useLoad<Me>('me', () => get<Me>('/me'), [], { shared: true });
  const summary = useLoad<Summary>('home.summary', () => get<Summary>('/me/progress/summary'), [], { shared: true });
  const notes = useLoad<{ items: Note[] }>('home.notes', () => get<{ items: Note[] }>('/me/notes'));
  // keyed from the first render (the module list arrives later): the prefetched answer is taken at once, and asked
  // again once the modules are known; it is shown only while the module is on
  const workouts = useLoad<Workouts | null>('workouts', () => (on('workouts') ? get<Workouts>('/me/workouts') : off<Workouts>()), [fk], { shared: true });
  // the same for the habits (prefetchHome asks for them beside the workouts): a new member's first-week card needs them
  // before the arrival starts
  const habits = useLoad<Habits | null>('home.habits', () => (on('habits') ? get<Habits>('/me/habits') : off<Habits>()), [fk], { shared: true });
  const goals = useLoad<{ items: Goal[] } | null>(on('progress') ? 'home.goals' : null, () => (on('progress') ? get<{ items: Goal[] }>('/me/goals') : off()), [fk]);
  const checkins = useLoad<{ items: Checkin[] } | null>(on('progress') ? 'home.checkins' : null, () => (on('progress') ? get<{ items: Checkin[] }>('/me/checkins') : off()), [fk]);
  const sessions = useLoad<{ items: LiveSession[] } | null>(on('sessions') ? 'home.sessions' : null, () => (on('sessions') ? get<{ items: LiveSession[] }>('/me/sessions') : off()), [fk]);
  const news = useLoad<{ items: Announcement[]; unread: number } | null>(on('messaging') ? 'home.news' : null, () => (on('messaging') ? get<{ items: Announcement[]; unread: number }>('/me/announcements') : off()), [fk]);
  const photos = useLoad<PhotosData | null>(on('progress') ? 'home.photos' : null, () => (on('progress') ? get<PhotosData>('/me/progress/photos') : off<PhotosData>()), [fk]);
  // the upcoming consultations (the Coach tab's own list and key, refreshed with it after a booking, a move or a
  // cancel): the appointment row and the "booked" count read the same upcoming rule as Coach (lib/today)
  const appts = useLoad<{ items: ApptRow[] }>('appointments', () => get<{ items: ApptRow[] }>('/me/appointments?range=upcoming'), []);
  // the member's blood-test bookings (the Tests tab's and Orders' own list and key, refreshed with them after a booking,
  // a move or a cancel), asked only while the package holds a collection: the blood-test balance splits its held ones
  // over this list, as Tests does (lib/today heldByBookings)
  const bloodHeld = balancesOf((me.data ?? peekHome<Me>('me'))?.entitlements ?? null).some((x) => x.kind === 'bloodwork' && x.reserved > 0);
  const bookings = useLoad<{ items: BloodBooking[] } | null>(bloodHeld ? 'bookings' : null, () => (bloodHeld ? get<{ items: BloodBooking[] }>('/me/bloodwork/bookings') : off()), [bloodHeld]);
  // the focus picked in the quiz (the profile's goals), asked only while there is no measurable goal to show instead
  const measurable = (goals.data?.items ?? []).some((g) => g.status === 'active' && !!g.metric && typeof g.targetValue === 'number');
  const askFocus = on('progress') && !!goals.data && !measurable;
  const profile = useLoad<{ profile?: { goals?: unknown } } | null>(askFocus ? 'me.profile' : null, () => (askFocus ? get<{ profile?: { goals?: unknown } }>('/me/profile') : off()), [askFocus]);

  const reloadAll = useCallback(() => Promise.all([me.reload(), summary.reload(), notes.reload(), workouts.reload(), habits.reload(), goals.reload(), checkins.reload(), sessions.reload(), news.reload(), photos.reload(), appts.reload(), bookings.reload(), pollUpdates()]),
    // the reloads are stable per key
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [me.reload, summary.reload, notes.reload, workouts.reload, habits.reload, goals.reload, checkins.reload, sessions.reload, news.reload, photos.reload, appts.reload, bookings.reload]);
  const refresh = useFocusRefresh(reloadAll);
  useEffect(() => onUpdate(() => { void news.reload(); void notes.reload(); }), [news.reload, notes.reload]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (me.data) rememberHome('me', me.data); }, [me.data]);
  useEffect(() => { if (summary.data) rememberHome('home.summary', summary.data); }, [summary.data]);
  useEffect(() => { if (workouts.data) rememberHome('workouts', workouts.data); }, [workouts.data]);
  useEffect(() => { if (habits.data) rememberHome('home.habits', habits.data); }, [habits.data]);
  const summaryData = summary.data ?? peekHome<Summary>('home.summary');
  const workoutsData = workouts.data ?? peekHome<Workouts>('workouts');
  const workoutsOn = on('workouts') || (!features && !!workoutsData); // the module list is on its way: what Home had
  const habitsData = habits.data ?? peekHome<Habits>('home.habits');
  const habitsOn = on('habits') || (!features && !!habitsData);

  // "Your first week" sits above the Wellness card, so what it holds is decided before the body mounts, from settled
  // inputs (the module list, and the habits, the workouts and the summary its rows read), never grown or added over the
  // arriving score card. A new member's body waits for them at most WEEK_WAIT from Home's mount (they are prefetched
  // with /me, so usually there at once); then the card is decided from what has arrived. Anyone else never waits.
  const newMember = inFirstWeek((user as { createdAt?: string } | null)?.createdAt);
  const weekInputs = !newMember || (!!features
    && (!on('habits') || !!habitsData || !!habits.error)
    && (!on('workouts') || !!workoutsData || !!workouts.error)
    && (!!summaryData || !!summary.error));
  const [weekGo, setWeekGo] = useState(weekInputs);
  useEffect(() => { if (weekInputs) setWeekGo(true); }, [weekInputs]);
  useEffect(() => {
    if (weekGo) return;
    const timer = setTimeout(() => setWeekGo(true), WEEK_WAIT);
    return () => clearTimeout(timer);
  }, [weekGo]);

  const greeting = useDayPart();
  const updates = useUpdates();
  // the counter, kept as one object while what it says is the same (a focus change alone re-renders nothing below)
  const rawCounter = useStepCounter(focused);
  const counter = useMemo(() => rawCounter, [rawCounter.status, rawCounter.steps, rawCounter.approxKm, rawCounter.history, rawCounter.enable, rawCounter.disable]); // eslint-disable-line react-hooks/exhaustive-deps
  const [inbox, setInbox] = useState(false);
  // the tab the Inbox opens on: the bell opens Notifications, the News card opens News
  const [inboxTab, setInboxTab] = useState<'notifications' | 'news'>('notifications');
  const [water, setWater] = useState<number | null>(null); // the member's tap, shown before the server answers
  const openInbox = useCallback(() => { setInboxTab('notifications'); setInbox(true); }, []);
  const openNews = useCallback(() => { setInboxTab('news'); setInbox(true); }, []);
  const closeInbox = useCallback(() => setInbox(false), []);
  const newsReload = news.reload;
  const inboxChanged = useCallback(() => { void pollUpdates(); void newsReload(); }, [newsReload]);
  // what the body draws, kept as the same objects while the data is the same (HomeBody is memoised)
  const progressOn = on('progress');
  const sessionsOn = on('sessions');
  const notesItems = notes.data?.items ?? NONE;
  const apptItems = appts.data?.items ?? null;
  const bookingItems = bloodHeld ? bookings.data?.items ?? null : null;
  const goalItems = progressOn ? goals.data?.items ?? NONE : null;
  const openCheckins = useMemo(() => (progressOn ? (checkins.data?.items ?? NONE).filter((c) => c.status === 'requested') : NONE), [progressOn, checkins.data]);
  const upcoming = useMemo(() => (sessionsOn ? upcomingSessions(sessions.data?.items) : NONE), [sessionsOn, sessions.data]);
  // a focus already written as an open goal (active or paused) is not offered again: the same rule as /goals (openFocus)
  const focus = useMemo<string[]>(() => {
    const list = askFocus ? openFocus(profile.data?.profile?.goals, goals.data?.items) : [];
    return list.length ? list : NONE;
  }, [askFocus, profile.data, goals.data]);

  // the body mounts in the frame after the header (its own render): the tabs, the header and the body never land in
  // one long task; its cards enter from opacity 0 on the timeline anyway (reduced motion and the pre-rendered HTML: at once)
  const { still } = useMotion();
  const [bodyOn, setBodyOn] = useState(still);
  // the page-active edge is the named timeline's 0 ms (the header's greeting and ring count from it): a body that mounts
  // after it (a busy frame after the sign-in or the splash) still brings the score card in at 400 ms from the edge, not
  // 400 ms from its own mount
  const pageActive = usePageActive();
  const activeAt = useRef<number | null>(null);
  const markActive = useCallback((at: number) => { if (activeAt.current == null) activeAt.current = at; }, []);
  useAnimatedReaction(() => pageActive.get(), (a, was) => { if (a === 1 && was !== 1) scheduleOnRN(markActive, Date.now()); });
  useEffect(() => {
    if (bodyOn) return;
    // the web yields (a transition: the header's entrance runs on the same thread); native renders it in one go, so the
    // hand-off's own updates (the mark's flight) cannot keep restarting it and the score card keeps its 400 ms (the
    // flight waits for quiet frames, so it starts after this render, not inside it)
    const raf = requestAnimationFrame(() => (Platform.OS === 'web' ? startTransition(() => setBodyOn(true)) : setBodyOn(true)));
    return () => cancelAnimationFrame(raf);
  }, [bodyOn]);

  const d = me.data ?? peekHome<Me>('me');
  // a skeleton only when /me has not answered within the prefetch's cap (never a frame of it for a quick answer)
  const [late, setLate] = useState(false);
  const waiting = !d;
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setLate(true), SKELETON_AFTER);
    return () => clearTimeout(timer);
  }, [waiting]);
  // a skeleton that was drawn is never cut to an empty page (M52, M63): when /me answers it stays over the body and
  // gives way only from the frame the first card starts to enter (its Reveal started and no mark holding it), so the
  // content crossfades in under it; `exit` is 'held' from the skeleton's first frame until it has gone.
  // The first arrival out of a page skeleton (the sign-in, the sign-up's onboarding, the open preview: the score card
  // not yet revealed; not under reduced motion) holds it from Home's own first frame: the pager's page skeleton has just
  // been on screen, and the first card waits for the page-active edge and for a mark flying into the header
  // (MarkClear), so without it the body would be empty for those frames (skeleton, black, content); with it the page
  // goes skeleton to content, crossfading. A Home that first draws under the launch sting (a restored session's cold
  // start) holds none: nothing but the sting's black was on screen before it, so with /me cached (the splash's
  // prefetch) it draws no skeleton frame at all (M63)
  const [arriving] = useState(() => !still && !wasRevealed('home.score') && !underSting());
  const skeletonOn = !d && (late || arriving) && !me.error;
  const [exit, setExit] = useState<'none' | 'held' | 'gone'>(() => (arriving ? 'held' : 'none'));
  useEffect(() => { if (skeletonOn) setExit((x) => (x === 'none' ? 'held' : x)); }, [skeletonOn]);
  const cardIn = useSharedValue(0); // 1 from the frame the first card starts to enter
  const skeletonGone = useCallback(() => setExit('gone'), []);
  // the address is confirmed or not (the session's own account; a demo member is made active by onboarding while the
  // address may still wait): the notice stays until it is confirmed
  const unconfirmed = !!d && (d.member.state === 'pending_verification' || (user?.role === 'member' && user.emailVerified === false));
  if (d?.member && !d.member.onboardingCompleted && d.member.state !== 'pending_verification') return <Redirect href="/onboarding" />;

  const name = firstName(d?.member?.name || user?.name);
  const packageLine = d ? (d.programme ? `${d.programme.packageName} · ends ${fmtDate(d.programme.endAt)}` : 'No active package yet.') : '';
  const unreadNotes = d ? updates.unread ?? d.unread?.notifications ?? 0 : null;
  const unreadNews = d ? news.data?.unread ?? 0 : null;

  // keyed, so the header (and the mark flying into its ring) stays the same element when the page swaps its skeleton for content
  const header = <HomeHeader key="header" greeting={greeting} name={name} packageLine={packageLine} unreadNotes={unreadNotes} unreadNews={unreadNews} onBell={openInbox} />;
  const sheet = <InboxSheet visible={inbox} initialTab={inboxTab} onClose={closeInbox} newsOn={on('messaging')} onChanged={inboxChanged} news={on('messaging') ? news.data : null} unread={unreadNotes} />;

  if (!d) {
    return <TabScreen bleedTop={<SheetLoopGate><HomeHero greeting={greeting} /></SheetLoopGate>} refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} testID="home">
      <SheetLoopGate>
        {header}
        <View style={styles.stack}>
          <ErrorState error={me.error} onRetry={me.reload} />
          {skeletonOn ? <HomeSkeleton /> : null}
        </View>
        {sheet}
      </SheetLoopGate>
    </TabScreen>;
  }

  return <TabScreen bleedTop={<SheetLoopGate><HomeHero greeting={greeting} /></SheetLoopGate>} sticky={<HomeCompactBar title={name} />} refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} testID="home">
    <SheetLoopGate>
      <DemotionProbe active={focused} />
      {header}
      <View style={exit === 'held' ? styles.held : null}>
        {bodyOn && weekGo ? <HomeBody
          me={d} setMe={me.setData} meStale={me.stale} meError={me.error} reloadMe={me.reload}
          summary={summaryData} notes={notesItems} workouts={workoutsOn ? workoutsData ?? null : null}
          habits={habitsOn ? habitsData ?? null : null} goals={goalItems}
          goalsPending={progressOn && !goals.data && !goals.error}
          checkins={openCheckins} appts={apptItems} bookings={bookingItems}
          sessions={upcoming}
          news={on('messaging') ? news.data : null} photos={progressOn ? photos.data : null}
          reloadPhotos={photos.reload} counter={counter} water={water} setWater={setWater}
          openNews={openNews} workoutsOn={workoutsOn} since={activeAt} unconfirmed={unconfirmed} cardIn={cardIn} focus={focus}
          newMember={newMember}
        /> : null}
        {exit === 'held' ? <SkeletonExit cardIn={cardIn} onGone={skeletonGone} /> : null}
      </View>
      {sheet}
    </SheetLoopGate>
  </TabScreen>;
}

function HomeSkeleton() {
  return <View style={styles.skeleton} accessibilityLabel="Loading">
    <View style={styles.skelCard}><SkeletonRing size={210} stroke={13} /><View style={styles.skelRow}><Skeleton width={72} height={44} /><Skeleton width={72} height={44} /><Skeleton width={72} height={44} /></View></View>
    <Skeleton height={190} radius={fx.radius.card} />
    <Skeleton height={120} radius={fx.radius.card} />
  </View>;
}

/** The skeleton that was drawn, kept in its place over the arriving body until the first card starts to enter
 *  (`cardIn`), then faded out over SKELETON_OUT while the card fades in under it (a crossfade, never an empty frame);
 *  reduced motion: gone at once when the card is there. It takes no touch. */
function SkeletonExit({ cardIn, onGone }: { cardIn: SharedValue<number>; onGone: () => void }) {
  const { still } = useMotion();
  const o = useSharedValue(1);
  const ms = SKELETON_OUT;
  useAnimatedReaction(() => cardIn.get(), (k, was) => {
    if (k !== 1 || was === 1) return;
    if (still) { o.set(0); scheduleOnRN(onGone); return; }
    o.set(withTiming(0, timing(ms, css), (f) => { 'worklet'; if (f) scheduleOnRN(onGone); }));
  }, [still]);
  const a = useAnimatedStyle(() => ({ opacity: o.get() }));
  return <Animated.View pointerEvents="none" style={[styles.over, a]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <View style={styles.stack}><HomeSkeleton /></View>
  </Animated.View>;
}

/** Inside the first card's Reveal: sets `cardIn` on the UI thread from the frame that card starts to enter (its Reveal
 *  started; one already at rest at once) and no flying mark holds it (MarkClear). */
function EntranceProbe({ cardIn, clear }: { cardIn: SharedValue<number>; clear: SharedValue<number> }) {
  const landing = useRevealLanding();
  const startedAt = landing?.startedAt;
  useAnimatedReaction(() => ((!startedAt || startedAt.get() >= 0) && clear.get() === 1 ? 1 : 0), (go) => {
    if (go === 1 && cardIn.get() !== 1) cardIn.set(1);
  });
  return null;
}

type BodyProps = {
  me: Me; setMe: (m: Me) => void; meStale: string | null; meError: Error | null; reloadMe: () => Promise<void>;
  summary: Summary | null; notes: Note[]; workouts: Workouts | null; habits: Habits | null; goals: Goal[] | null;
  /** The goals are still on their way: no "Set a goal" yet (a goal may well be there). */
  goalsPending: boolean; checkins: Checkin[];
  /** The upcoming appointments (GET /me/appointments?range=upcoming), null until they have arrived. */
  appts: ApptRow[] | null;
  /** The member's blood-test bookings (GET /me/bloodwork/bookings), null until they have arrived or while none is held. */
  bookings: BloodBooking[] | null;
  sessions: LiveSession[]; news: { items: Announcement[]; unread: number } | null; photos: PhotosData | null; reloadPhotos: () => Promise<void>;
  counter: ReturnType<typeof useStepCounter>; water: number | null; setWater: (ml: number | null) => void;
  /** Opens the Inbox on its News tab (the News card). */
  openNews: () => void; workoutsOn: boolean;
  /** When the page turned active (epoch ms), or null before: the timeline's delays count from it. */
  since: React.RefObject<number | null>;
  /** The member's email address is not confirmed yet (the Confirm your email notice). */
  unconfirmed: boolean;
  /** Set to 1 from the frame the first card starts to enter (a skeleton that was drawn gives way then). */
  cardIn: SharedValue<number>;
  /** The focus picked in the quiz, while there is no measurable goal (the goals card offers to make one measurable). */
  focus: string[];
  /** The account is in its first seven days: "Your first week" while something on it is still to do. */
  newMember: boolean;
};

/** Everything under the header; memoised, so a re-render of the screen that changes none of its data (a focus change,
 *  the bell's count) draws nothing here. */
const HomeBody = React.memo(function HomeBody(p: BodyProps) {
  const { me } = p;
  const scrollY = useTabScroll();
  // how far into the timeline this body mounts (decided once): each above-the-fold delay keeps its time from the edge
  const [lead] = useState(() => (p.since.current == null ? 0 : Math.max(0, Date.now() - p.since.current)));
  const at = (ms: number) => Math.max(0, ms - lead);
  const today = istDate();

  /* tasks: the tick shows at once; the open count follows it */
  const tasks = me.todaysActions ?? [];
  const open = typeof me.todaysActionsTotal === 'number' ? me.todaysActionsTotal : tasks.filter((t) => t.status === 'pending').length;
  const setTask = async (t: Task, status: Task['status']) => {
    const before = me;
    const delta = (t.status === 'pending' ? 1 : 0) - (status === 'pending' ? 1 : 0);
    p.setMe({ ...me, todaysActions: tasks.map((x) => (x.id === t.id ? { ...x, status } : x)), ...(typeof me.todaysActionsTotal === 'number' ? { todaysActionsTotal: Math.max(0, me.todaysActionsTotal - delta) } : null) });
    try { await patch(`/me/tasks/${t.id}`, { status }); }
    catch (e) { p.setMe(before); toast.error(errorText(e)); }
  };

  /* water: n × 250 ml for today, sent as the member's own daily total */
  const serverWater = me.today?.waterMl ?? 0;
  const waterShown = p.water ?? serverWater;
  const setWater = async (ml: number) => {
    p.setWater(ml);
    try {
      await api('PUT', '/me/progress/daily', { metric: 'water_ml', date: today, value: ml, source: 'member' });
      p.setMe({ ...me, today: { ...(me.today ?? { date: today, steps: null, waterMl: null }), waterMl: ml } });
      p.setWater(null);
      // the day's total, as the card says it ("2,000 ml today"), on the top toast (M66): the bottom pill would sit over
      // the drops and the full-day line; HomeHeader's clearance keeps the top one off the bell and the ring
      toast.success(`${num(ml)} ml today`);
    } catch (e) { p.setWater(null); toast.error(errorText(e)); }
  };

  /* the first week: real actions only, each ticked once its record exists (FirstWeek) */
  const weekRows: FirstWeekRow[] = [];
  if (p.newMember) {
    const waterLogged = waterShown > 0 || (p.summary?.metrics ?? []).some((m) => m.metric === 'water_ml' && m.latest != null);
    if (me.today && (p.summary?.metrics ?? []).some((m) => m.metric === 'water_ml' && m.enabled !== false)) {
      weekRows.push({ key: 'water', title: 'Log a glass of water', icon: 'droplets', done: waterLogged, onPress: () => router.push('/progress-entry?metric=water_ml') });
    }
    if (p.habits) {
      const active = p.habits.items.filter((h) => h.status === 'active');
      weekRows.push({ key: 'habit', title: active.length ? 'Tick a habit' : 'Add a habit and tick it', icon: 'list-checks',
        done: active.some((h) => (h.recent ?? []).some((r) => r.status === 'done')), onPress: () => router.push('/(tabs)/life?section=habits') });
    }
    if (p.workouts && p.workouts.items.length) {
      const wk = p.workouts;
      weekRows.push({ key: 'session', title: 'Finish your first session', icon: 'dumbbell', done: wk.items.some((x) => x.status === 'completed' || x.status === 'partial'),
        onPress: () => (wk.next ? openWithMorph(workoutMorphKey(wk.next.id), () => router.push(`/workout/${wk.next!.id}?cat=${asCategory(wk.next!.categories?.find(Boolean))}`)) : router.push('/(tabs)/train')) });
    }
    if (balancesOf(me.entitlements).some((b) => b.kind === 'bloodwork')) {
      weekRows.push({ key: 'blood', title: 'Book your included blood test', icon: 'flask-conical', done: !!me.bloodwork, onPress: () => router.push('/(tabs)/tests') });
    }
  }
  // decided once, at this body's first render (Home mounts it once the card's inputs have settled, or stopped waiting
  // for them): whether the card shows and which rows it has. Nothing arriving later adds it, grows it or takes it away
  // above the arriving score card; the rows' ticks and words follow the data (the last tick pops on a card that stays
  // for the rest of the launch, "4/4"). A row whose data has gone is left out.
  const [weekPlan] = useState(() => ({ show: weekRows.some((r) => !r.done), keys: new Set(weekRows.map((r) => r.key)) }));
  const weekShown = weekRows.filter((r) => weekPlan.keys.has(r.key));
  const showFirstWeek = weekPlan.show && weekShown.length > 0;
  const weekClear = useMarkClear('home', true);

  const goalFor = (metric: string) => (p.goals ?? []).find((g) => g.status === 'active' && g.metric === metric && typeof g.targetValue === 'number')?.targetValue ?? null;
  const metrics = useMemo(() => {
    const out: Record<string, ReturnType<typeof metricView>> = {};
    for (const k of ['resting_hr_bpm', 'sleep_hours', 'weight_kg', 'steps', 'water_ml']) out[k] = metricView(p.summary, k);
    return out;
  }, [p.summary]);
  const minis: MiniMetric[] = SCORE_METRICS.map((m) => metrics[m.key] ? { ...metrics[m.key]!, short: m.short, label: m.label, unit: m.unit } : { ...m, latest: null, at: null, values: [], decimals: 0, trend: null });
  const tiles: TileSpec[] = TILE_METRICS.map((m) => ({ ...m, view: metrics[m.key] ?? null }));
  const sleep = metrics.sleep_hours;
  const stepsMetric = metrics.steps;
  // the latest steps count only when logged on today's India day (lib/today), never yesterday's total
  const stepsFromToday = !!stepsMetric?.at && istDayOf(stepsMetric.at) === today;
  const stepsToday = me.today?.steps ?? (stepsFromToday ? stepsMetric!.latest : null);
  // Today's goals: a day's total shows the same value as the card beside it (the phone's live count, never below the
  // server's total for today: lib/today todaySteps, as Bio and /goals; the water the member just set), never
  // yesterday's total
  const liveSteps = p.counter.status === 'counting' ? p.counter.steps : null;
  const goals = goalRows(p.goals, {
    ...(liveSteps != null || me.today ? { steps: todaySteps(liveSteps, stepsToday) } : null),
    ...(p.water != null || me.today ? { water_ml: waterShown } : null),
  });
  const waterOn = !!me.today && (p.summary?.metrics ?? []).some((m) => m.metric === 'water_ml' && m.enabled !== false);
  const week = habitWeek(p.habits, today);
  const hasHabits = (p.habits?.items ?? []).some((h) => h.status === 'active');
  const balances = balancesOf(me.entitlements);
  const nextAppt = nextAppointmentOf(me, p.appts);
  const brief = briefText(me, p.workouts, open, nextAppt);
  const note = p.notes[0] ?? null;
  const w = p.workouts;
  // this week's sessions side by side get photos that differ (L-09), before the banner and the shelf draw them: the
  // player's cover reads the same photo for each (src/fx/media/slots spreadSessionPhotos)
  // (idempotent: the same week gives the same photos, so a repeated call changes nothing)
  if (w?.items.length) spreadSessionPhotos(w.items.map((x) => ({ id: x.id, category: asCategory(x.categories?.find(Boolean)) })));
  const openWorkout = (s: WorkoutSession) => openWithMorph(workoutMorphKey(s.id), () => router.push(`/workout/${s.id}?cat=${asCategory(s.categories?.find(Boolean))}`));
  const toBio = (key: string) => router.push(`/(tabs)/bio?metric=${encodeURIComponent(key)}`);
  const emptyTasks = me.plan ? 'Your plan has nothing due today. Rest counts.' : me.coach ? 'Your coach is writing your plan.' : 'Tasks appear once your coach publishes a plan.';
  const pad = styles.pad;
  // the first cards hold while a mark handed to the header flies over them (MarkClear; off at tier C, under reduced
  // motion and when no mark is on its way), then fade in; the score card's measured box is its untransformed wrapper
  const scoreClear = useMarkClear('home', true);
  const chooseClear = useMarkClear('home', true);
  const first: MarkClearState = me.programme ? scoreClear : chooseClear;
  let n = 0; // reveal order below the fold
  // below the brief: mounted once the Wellness sweep has landed (never in its frames) and a mark handed to the header
  // has landed too (on the web the sweep does not wait for it, so the mounts must: none lands in the flight's frames), then once
  // the page has settled and the device is idle (each keeps its height for later visits); at rest (a revisit, reduced
  // motion) at once
  const [tailOn, setTailOn] = useState(false);
  const swept = useSharedValue(0);
  const onSwept = useCallback(() => swept.set(1), [swept]);
  useAnimatedReaction(() => (swept.get() === 1 && markInFlight.get() === 0 ? 1 : 0), (ok, was) => { if (ok === 1 && was !== 1) scheduleOnRN(setTailOn, true); });
  const later = (id: string, node: React.ReactNode) => (node && tailOn ? <Deferred key={id} id={id}>{node}</Deferred> : null);

  const body = <View style={styles.stack}>
    {p.meStale || p.meError ? <View style={pad}><StaleBanner at={p.meStale} /><ErrorState error={p.meError} onRetry={p.reloadMe} /></View> : null}
    {p.unconfirmed ? <View style={pad}><ConfirmEmailNotice demo={!!me.demo} onConfirm={() => router.push('/(auth)/verify')} /></View> : null}
    {/* card first (M63 wave-2 fix): the first card enters on the page-active edge, ahead of the greeting; the
        choose-a-package card, above the score card for a member with no package, is that first card then */}
    {!me.programme ? <MarkClear state={chooseClear} rise={false} style={pad}>
      <Reveal mount id="home.choose"><EntranceProbe cardIn={p.cardIn} clear={first.clear} /><ChoosePackageCard onOpen={() => router.push('/(tabs)/store')} /></Reveal>
    </MarkClear> : null}
    {showFirstWeek ? <MarkClear state={weekClear} rise={false} style={pad}>
      <Reveal mount index={me.programme ? 0 : 1} id="home.firstWeek"><FirstWeekCard rows={weekShown} /></Reveal>
    </MarkClear> : null}
    <MarkClear state={scoreClear} rise={false} style={pad}>
      <Reveal mount spring="soft" distance={S.cardY} index={(me.programme ? 0 : 1) + (showFirstWeek ? 1 : 0)} id="home.score">
        {me.programme ? <EntranceProbe cardIn={p.cardIn} clear={first.clear} /> : null}
        <ScoreCard score={me.member.wellnessScore ?? null} label={me.member.wellnessScoreLabel} metrics={minis} onMetric={toBio} onSwept={onSwept} />
      </Reveal>
    </MarkClear>

    <Reveal mount delay={at(S.activityAt)} id="home.activity" style={pad}>
      <ActivityCard counter={p.counter} serverSteps={stepsToday} serverSource={stepsFromToday ? stepsMetric!.source : stepsToday != null ? PHONE_APP : null}
        goal={goalFor('steps')} sessions={w ? { done: w.summary.done, planned: w.summary.due + w.summary.upcoming } : null} activeMinutes={activeMinutesToday(w)} openTasks={me.plan || tasks.length ? open : null}
        workoutsOn={p.workoutsOn} onSetGoal={p.goals && !p.goalsPending ? () => router.push('/goals') : null} />
    </Reveal>

    {brief ? <Reveal index={n++} from="scale" id="home.brief" style={pad}><BriefCard text={brief} /></Reveal> : null}
    {later('home.note', note ? <Reveal index={n++} id="home.note" style={pad}><CoachNoteCard note={note} onPress={() => router.push('/recommendations')} /></Reveal> : null)}
    {later('home.news', p.news && p.news.unread ? <Reveal index={n++} id="home.news" style={pad}><NewsNotice items={p.news.items} unread={p.news.unread} onOpen={p.openNews} /></Reveal> : null)}

    {later('home.tasks', <Reveal index={n++} id="home.tasks" style={pad}>
      <TasksCard tasks={tasks} open={open} emptyText={emptyTasks} hasPlan={!!me.plan} checkins={p.checkins}
        onSet={(t, s) => { void setTask(t, s); }} onOpenPlan={() => router.push('/(tabs)/train?view=plan')} onCheckin={(c) => router.push(`/checkin/${c.id}`)} />
    </Reveal>)}

    {later('home.next', w?.next ? <Reveal index={n++} id="home.next" style={pad}><NextSessionBanner session={w.next} onOpen={() => openWorkout(w.next!)} /></Reveal> : null)}

    {later('home.nextRows', <Reveal index={n++} id="home.nextRows" style={pad}>
      <SectionTitle title="Next" style={styles.flushTitle} />
      <NextRows me={me} appts={p.appts} bookings={p.bookings} balances={balances} onAppointment={() => router.push('/(tabs)/coach')} onBloodTest={() => router.push('/(tabs)/tests')} />
    </Reveal>)}

    {later('home.tiles', <Reveal index={n++} id="home.tiles" style={pad}>
      <MetricTiles tiles={tiles} onOpen={toBio} onLog={(key) => router.push(key ? `/progress-entry?metric=${encodeURIComponent(key)}` : '/progress-entry')} />
    </Reveal>)}

    {later('home.streak', hasHabits ? <Reveal index={n++} id="home.streak" style={pad}><StreakCard days={week.days} best={week.best} unit={week.unit} bestTitle={week.bestTitle} onPress={() => router.push('/(tabs)/life?section=habits')} /></Reveal> : null)}

    {/* the shelves own their no-swipe zone (ShelfCarousel) */}
    {later('home.live', p.sessions.length ? <Reveal index={n++} id="home.live">
      <SectionTitle title="Live sessions" action="See all" actionLabel="See all live sessions" onAction={() => router.push('/(tabs)/train?section=live')} />
      <LiveSessionsStrip items={p.sessions} onOpen={(s) => router.push(`/session/${s.id}`)} />
    </Reveal> : null)}

    {later('home.sleep', sleep?.latest != null && sleep.at ? <Reveal index={n++} id="home.sleep" style={pad}>
      <LastNightCard hours={sleep.latest} at={sleep.at} source={sleep.source} target={goalFor('sleep_hours')} onPress={() => toBio('sleep_hours')} />
    </Reveal> : null)}

    {later('home.week', w && w.items.length ? <Reveal index={n++} id="home.week">
      <SectionTitle title="This week" action="See all" actionLabel="See all sessions in Train" onAction={() => router.push('/(tabs)/train')} />
      <WeekShelf items={w.items} onOpen={openWorkout} />
    </Reveal> : null)}

    {later('home.goals', p.goals && !p.goalsPending ? <Reveal index={n++} id="home.goals" style={pad}><GoalsCard rows={goals} focus={p.focus} onOpen={() => router.push('/goals')} onSet={() => router.push('/goals')} onFocus={(f) => router.push(`/goals?focus=${encodeURIComponent(f)}`)} /></Reveal> : null)}

    {later('home.water', waterOn ? <Reveal index={n++} id="home.water" style={pad}><HydrationCard ml={waterShown} goal={goalFor('water_ml')} onSet={(ml) => { void setWater(ml); }} /></Reveal> : null)}

    {later('home.gallery', p.photos && (p.photos.photosEnabled || p.photos.items.length) ? <Reveal index={n++} from="fade" id="home.gallery" style={pad}>
      <SectionTitle title="Progress gallery" action="See all" actionLabel="Open your progress photos" onAction={() => router.push('/photos')} style={styles.flushTitle} />
      <Gallery data={p.photos} onChanged={() => { void p.reloadPhotos(); }} onOpenAll={() => router.push('/photos')} />
    </Reveal> : null)}
  </View>;
  return scrollY ? <RevealScope scrollY={scrollY}>{body}</RevealScope> : body;
});

const styles = StyleSheet.create({
  stack: { gap: 16, paddingTop: 8 },
  pad: { paddingHorizontal: GUTTER },
  flushTitle: { paddingHorizontal: 0 },
  skeleton: { paddingHorizontal: GUTTER, gap: 16 },
  skelCard: { alignItems: 'center', gap: 24, padding: 24, borderRadius: fx.radius.hero, borderWidth: 1, borderColor: fx.line.a10, backgroundColor: fx.bg.panelSolid },
  skelRow: { flexDirection: 'row', gap: 16 },
  over: { position: 'absolute', left: 0, right: 0, top: 0 },
  // while the skeleton is held over a body that has not drawn yet, the column keeps the skeleton's height
  held: { minHeight: 640 },
});
