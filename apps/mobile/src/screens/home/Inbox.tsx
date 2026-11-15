/* The Home bell's inbox (BUILD_PLAN §6.2 item 2) and the rows the Notifications and Announcements screens share.
   - NotificationRow: an unread red dot, the title (600 while unread), the body at white/70 (two lines in the sheet;
     without the server's directions to the web portal's places, lib/notificationRoute notificationBody), the category
     in the member's words (CATEGORY_WORD: "Check-in", "Blood test", "Your coach"; any other the API's name, spaced)
     and how long ago; a row that opens something (lib/notificationRoute) carries a chevron and names where it opens
     ("Opens Train › Plan"). Its meta lines stay at white/60 or more, as a read row is dimmed to .8.
   - InboxSheet: two pill tabs, "Notifications" (the latest 10, GET /notifications?limit=10) and "News" (the latest 10
     announcements, messaging on; Home's own answer until the sheet's refresh). It opens on the tab its caller names
     (`initialTab`: the bell on Notifications, Home's News card on News). Opening a notification marks it read and
     goes where it points; opening news marks it read and shows Announcements. "See all" opens the full screen.
   The lists load before the first open (once Home has come to rest and the device is idle, and again when the bell's
   count changes), so the sheet's first commit already holds its rows and nothing mounts while the panel rises. Each
   opening asks again; an answer that differs from what is drawn waits until the panel has risen (useSheetRise), and an
   answer that is the same draws nothing. Only the chosen tab's list is mounted.
   Motion (motion v2 M67): the first list of an opening rises in (y 8, 40 ms apart, at most 4 steps) from 120 ms into
   the sheet's rise, on one clock started on the UI thread when the rise starts; its rows are drawn from the panel's
   first frame, so they come into view one by one as the panel slides in and no frame of the rise draws the whole list
   for the first time (a list that comes after the rise fades and rises in from its arrival); a tab switch overlaps the
   lists (SwitchView: the new one enters from 20 pt on its side over 300 ms while the old one leaves 12 pt the other way
   in 160 ms, inert from its first exit frame). A row marked read
   fades its dot over 200 ms. Opening something closes the sheet first and navigates once its last exit frame has
   drawn (Sheet onExited). Tier C: the list fades in as one block (no row is drawn while the ones under it are still
   missing); reduced motion: at once. */
import { router } from 'expo-router';
import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, withDelay, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Button, ErrorState, fx, Icon, Pill, PillTabs, Sheet, Spinner, SwitchView, T, useMotion } from '@/fx';
import { useStateMix } from '@/fx/press';
import { useSheetRise } from '@/fx/Sheet';
import { doneOnce } from '@/fx/motion/once';
import { ease, motionValues, t, timing } from '@/fx/motion/tokens';
import { usePageSettledStore } from '@/fx/nav/pageReady';
import { ApiError, get, post } from '@/lib/api';
import { fmtDateTime, label, relative } from '@/lib/format';
import { notificationBody, notificationPlace, notificationRoute } from '@/lib/notificationRoute';
import { Beside } from '../bio/wordFit';
import { keepShort } from '@/fx/wordFit';
import type { Announcement, AppNotice } from './data';

const M = motionValues.screens.m67;

/** A notification's category in the member's words; any other is the API's name, spaced (lib/format label). */
const CATEGORY_WORD: Record<string, string> = {
  checkin: 'Check-in', bloodwork: 'Blood test', coach_assignment: 'Your coach', lab_followup: 'Next step from a report',
  custom_plan: 'Your plan', package_expiry: 'Your package', session: 'Live session', operations: 'Bioptime team', verification: 'Your email',
};
export const categoryWord = (c: string): string => CATEGORY_WORD[c] ?? label(c);
/** Module values a worklet reads (captured, never read in a parameter default). */
const expo = ease.expo;
const linear = ease.linear;

/** The unread dot: drawn always (the row never re-lays out), faded out over 200 ms when the row is read. */
function UnreadDot({ unread }: { unread: boolean }) {
  const on = useStateMix(unread, M.dotMs);
  const a = useAnimatedStyle(() => ({ opacity: on.get() }));
  return <Animated.View style={[styles.dot, a]} />;
}

/** The first list's rise inside an open sheet: one clock (ms, 0 … end) on the UI thread for every row. `fade`: the rows
 *  also fade in (a list that came after the panel had risen, and tier C); otherwise they are drawn from the panel's
 *  first frame and only rise. `step`: the ms between rows (0 at tier C: the list fades in as one block). */
type RiseClock = { clock: SharedValue<number>; rowMs: number; lift: number; fade: boolean; step: number };
const RiseClockContext = React.createContext<RiseClock | null>(null);

/** A row (or, at the last step, the group of rows from there on) of a list in the inbox sheet: an 8 pt rise (and, with
 *  the clock's `fade`, its opacity) follows the sheet's row clock from its step (index × 40 ms, at most 3 steps), over
 *  300 ms expo. Without `fade` the row is drawn from its first frame, so the rows come into view with the panel one by
 *  one as it slides in, and no frame of the rise has to draw a whole list for the first time (photos, glyphs and dots
 *  uploaded at once). Outside the sheet: at rest. */
function RowRise({ index, style, children }: { index: number; style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const rise = useContext(RiseClockContext);
  const fallback = useSharedValue(Number.MAX_SAFE_INTEGER);
  const clock = rise?.clock ?? fallback;
  const rowMs = rise?.rowMs ?? 1;
  const lift = rise?.lift ?? 0;
  const fade = rise?.fade ?? false;
  const at = Math.min(index, M.rowMax - 1) * (rise?.step ?? M.rowStep);
  const a = useAnimatedStyle(() => {
    const k = (clock.get() - at) / rowMs;
    if (k >= 1) return { opacity: 1, transform: [] };
    const e = k <= 0 ? 0 : expo(k);
    return { opacity: fade ? e : 1, transform: [{ translateY: (1 - e) * lift }] };
  });
  return <Animated.View style={[style, a]}>{children}</Animated.View>;
}

/** A list in the sheet: the first rows each on their step, the rest together on the last one (one moving view). */
function RiseList<I>({ items, keyOf, render }: { items: I[]; keyOf: (item: I) => string; render: (item: I) => React.ReactNode }) {
  const head = items.slice(0, M.rowMax - 1);
  const rest = items.slice(M.rowMax - 1);
  return <View style={styles.list}>
    {head.map((it, i) => <RowRise key={keyOf(it)} index={i}>{render(it)}</RowRise>)}
    {rest.length ? <RowRise index={M.rowMax - 1} style={styles.list}>{rest.map((it) => <React.Fragment key={keyOf(it)}>{render(it)}</React.Fragment>)}</RowRise> : null}
  </View>;
}

/** Memoised: a list drawn again with the same rows (and callbacks) draws none of them again. */
export const NotificationRow = React.memo(function NotificationRow({ n, onOpen, lines = 2 }: { n: AppNotice; onOpen?: (n: AppNotice, route: string | null) => void; lines?: number }) {
  const route = notificationRoute(n);
  const place = notificationPlace(route);
  const text = notificationBody(n.body);
  const unread = !n.read_at;
  // the time sits beside the title while the title's longest word, and a short word with the word beside it, fit whole
  // beside it (a narrow phone, a large text size: measured as drawn), else under it, so a title never breaks in a word
  // (SWA-04, SWB-09) and never leaves a short word alone on a line; a title has four lines before it is cut short (a
  // long one at text 2.0 on a 320 dp phone needs them), and the time moves under a title that would likely need more
  // beside it ('New / announcement / from Asha …' cut at three: VWR1-2)
  const body = <>
    <View style={styles.dotCol}><UnreadDot unread={unread} /></View>
    <View style={styles.flex}>
      <Beside words={[{ text: keepShort(n.title), v: unread ? 'sectionStrong' : 'section', pairs: true }]} lines={4} gap={8} align="flex-start" underGap={0}
        side={<T v="caption" color={fx.ink.a60}>{relative(n.created_at)}</T>}>
        <T v={unread ? 'sectionStrong' : 'section'} color={unread ? fx.ink.white : fx.ink.a80} numberOfLines={4}>{keepShort(n.title)}</T>
      </Beside>
      {text ? <T v="bodySm" color={fx.ink.a70} numberOfLines={lines} style={styles.body}>{text}</T> : null}
      {n.category || (route && onOpen && place) ? <T v="micro" color={fx.ink.a60} style={styles.cat}>{[n.category ? categoryWord(n.category) : null, route && onOpen && place ? `Opens ${place}` : null].filter(Boolean).join(' · ')}</T> : null}
    </View>
    {route ? <Icon name="chevron-right" size={16} color={fx.ink.a40} /> : null}
  </>;
  if (!route || !onOpen) return <View style={[styles.row, unread ? null : styles.read]} accessible accessibilityLabel={`${unread ? 'Unread: ' : ''}${n.title}. ${text ?? ''}`}>{body}</View>;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${unread ? 'Unread: ' : ''}${n.title}. ${text ?? ''}`} accessibilityHint={place ? `Opens ${place}` : undefined} onPress={() => onOpen(n, route)}
    style={({ pressed }) => [styles.row, unread ? null : styles.read, pressed ? styles.pressed : null]}>{body}</Pressable>;
});

export const NewsRow = React.memo(function NewsRow({ a, onOpen, lines = 3 }: { a: Announcement; onOpen?: (a: Announcement) => void; lines?: number }) {
  const inner = <>
    <View style={styles.dotCol}><UnreadDot unread={!a.read} /></View>
    <View style={styles.flex}>
      <View style={styles.titleRow}>
        <T v="micro" color={fx.ink.a60} style={styles.flex} numberOfLines={1}>{a.from}</T>
        {a.read ? null : <Pill tone="warning">New</Pill>}
      </View>
      <T v={a.read ? 'section' : 'sectionStrong'} numberOfLines={2} style={styles.newsTitle}>{a.title}</T>
      <T v="bodySm" color={fx.ink.a70} numberOfLines={lines}>{a.body}</T>
      <T v="caption" color={fx.ink.a50} style={styles.cat}>{fmtDateTime(a.publishedAt)}</T>
    </View>
  </>;
  if (!onOpen) return <View style={styles.row}>{inner}</View>;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${a.read ? '' : 'New: '}${a.title}, from ${a.from}`} onPress={() => onOpen(a)} style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}>{inner}</Pressable>;
});

type Tab = 'notifications' | 'news';
type Notes = { items: AppNotice[]; unread: number };
type News = { items: Announcement[]; unread: number };
type Lists = { notes: Notes | null; news: News | null; error: ApiError | null };

/** The same JSON (a refetch that found nothing new): the sheet keeps what it draws. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

/** An idle moment, at most `timeout` ms away (as src/fx/nav/Deferred). */
function whenIdle(fn: () => void, timeout: number): () => void {
  const g = globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
  if (!g.requestIdleCallback) { const timer = setTimeout(fn, 0); return () => clearTimeout(timer); }
  const h = g.requestIdleCallback(fn, { timeout });
  return () => g.cancelIdleCallback?.(h);
}

const noteKey = (n: AppNotice) => n.id;
const newsKey = (a: Announcement) => a.id;

export const InboxSheet = React.memo(function InboxSheet({ visible, initialTab = 'notifications', onClose, newsOn, onChanged, news: newsSeed, unread }: {
  visible: boolean;
  /** The tab an opening starts on (the bell: Notifications; Home's News card: News). */
  initialTab?: Tab;
  onClose: () => void; newsOn: boolean; onChanged: () => void;
  /** Home's own answer of GET /me/announcements: the News tab (and its count) until the sheet's own refresh. */
  news?: News | null;
  /** The bell's unread count: a change while the sheet is closed loads the list again in the next idle moment. */
  unread?: number | null;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  // each opening starts on the tab its caller names, set in the render that opens it (never a tab switch on screen)
  const [shownFor, setShownFor] = useState(visible);
  if (shownFor !== visible) {
    setShownFor(visible);
    if (visible) setTab(initialTab === 'news' && newsOn ? 'news' : 'notifications');
  }
  const [lists, setLists] = useState<Lists>(() => ({ notes: null, news: newsSeed ?? null, error: null }));
  // what the lists are once a held answer has landed; answers are compared with it
  const latest = useRef(lists);
  // from an opening until its panel has risen, a changed answer is held (no commit lands in the rise's frames)
  const risen = useRef(true);
  const held = useRef(false);
  const landing = useRef<{ done: () => void; cancel: () => void } | null>(null);
  const offer = useCallback((next: Partial<Lists>) => {
    const cur = latest.current;
    const notes = next.notes !== undefined && !same(next.notes, cur.notes) ? next.notes : cur.notes;
    const news = next.news !== undefined && !same(next.news, cur.news) ? next.news : cur.news;
    const error = next.error !== undefined ? next.error : cur.error;
    if (notes === cur.notes && news === cur.news && error === cur.error) return;
    latest.current = { notes, news, error };
    if (risen.current) setLists(latest.current);
    else held.current = true;
  }, []);
  const land = useCallback(() => {
    risen.current = true;
    landing.current = null;
    if (!held.current) return;
    held.current = false;
    setLists(latest.current);
  }, []);
  const newsOnRef = useRef(newsOn);
  newsOnRef.current = newsOn;
  /** GET the lists; `shown` (the sheet is open): a failure shows, else it is left for the next opening. */
  const load = useCallback((shown: boolean) => {
    get<Notes>('/notifications?limit=10').then((d) => offer({ notes: d, error: null }),
      (e) => { if (shown) offer({ error: e instanceof ApiError ? e : new ApiError(0, null) }); });
    if (shown && newsOnRef.current) get<News>('/me/announcements').then((d) => offer({ news: d }), () => undefined);
  }, [offer]);

  // before the first open: once Home has come to rest and the device is idle
  const settledStore = usePageSettledStore();
  const loaded = useRef(false);
  useEffect(() => {
    let cancel: (() => void) | null = null;
    const check = () => {
      if (loaded.current || cancel || !settledStore.get()) return;
      cancel = whenIdle(() => { loaded.current = true; load(false); }, t.premount);
    };
    const unsubscribe = settledStore.subscribe(check);
    check();
    return () => { unsubscribe(); cancel?.(); };
  }, [settledStore, load]);
  // the bell's count changed while closed: the list again, when idle
  const lastUnread = useRef(unread);
  useEffect(() => {
    if (unread === lastUnread.current) return;
    lastUnread.current = unread;
    if (visible || !loaded.current) return;
    return whenIdle(() => load(false), t.premount);
  }, [unread, visible, load]);
  // Home's announcements (read state included) when they change
  useEffect(() => { if (newsSeed) offer({ news: newsSeed }); }, [newsSeed, offer]);

  // an opening: the lists again; a changed answer lands once the panel has risen (InboxBody), at the latest t.settle on
  useLayoutEffect(() => {
    if (!visible) return;
    risen.current = false;
    const l = doneOnce(land, t.settle);
    landing.current = l;
    loaded.current = true;
    load(true);
    return () => { l.cancel(); land(); };
  }, [visible, land, load]);
  const risenNow = useCallback(() => { landing.current?.done(); }, []);

  // opening something: the sheet goes first; the route opens after its last exit frame
  const pending = useRef<string | null>(null);
  const afterExit = useCallback(() => {
    const path = pending.current;
    pending.current = null;
    if (path) router.push(path);
  }, []);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const changedRef = useRef(onChanged);
  changedRef.current = onChanged;
  const go = useCallback((path: string) => { pending.current = path; closeRef.current(); }, []);
  const openNote = useCallback((n: AppNotice, route: string | null) => {
    const d = latest.current.notes;
    if (!n.read_at && d) {
      // read at once here (its dot fades as the sheet leaves), then on the server
      offer({ notes: { ...d, unread: Math.max(0, d.unread - 1), items: d.items.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)) } });
      void post('/notifications/read', { ids: [n.id] }).then(() => changedRef.current(), () => undefined);
    }
    if (route) go(route);
  }, [offer, go]);
  const openNews = useCallback((a: Announcement) => {
    const d = latest.current.news;
    if (!a.read && d) {
      offer({ news: { ...d, unread: Math.max(0, d.unread - 1), items: d.items.map((x) => (x.id === a.id ? { ...x, read: true } : x)) } });
      void post(`/me/announcements/${a.id}/read`).then(() => changedRef.current(), () => undefined);
    }
    go('/announcements');
  }, [offer, go]);
  const pick = useCallback((v: Tab) => setTab(v), []);
  const retry = useCallback(() => load(true), [load]);
  const nUnread = lists.notes?.unread ?? 0;
  const newsUnread = lists.news?.unread ?? 0;
  const tabs = useMemo(() => [{ value: 'notifications' as const, label: nUnread ? `Notifications · ${nUnread}` : 'Notifications' },
    ...(newsOn ? [{ value: 'news' as const, label: newsUnread ? `News · ${newsUnread}` : 'News' }] : [])], [nUnread, newsUnread, newsOn]);
  const seeAll = useCallback(() => go(tab === 'news' ? '/announcements' : '/notifications'), [go, tab]);
  return <Sheet visible={visible} onClose={onClose} onExited={afterExit} title="Inbox" footer={<Button title="See all" variant="soft" iconRight="chevron-right" onPress={seeAll} />}>
    <InboxBody tab={tab} tabs={tabs} lists={lists} newsOn={newsOn} onPick={pick} onRetry={retry} onOpenNote={openNote} onOpenNews={openNews} onRisen={risenNow} />
  </Sheet>;
});

/** The sheet's content, drawn inside the panel (one per opening): the tabs, an error, and the chosen tab's list. Its
 *  first rows rise on one clock that the panel's rise starts (useSheetRise); it tells the sheet when the panel has
 *  risen (onRisen), so a changed answer is drawn only then. */
function InboxBody({ tab, tabs, lists, newsOn, onPick, onRetry, onOpenNote, onOpenNews, onRisen }: {
  tab: Tab; tabs: { value: Tab; label: string }[]; lists: Lists; newsOn: boolean; onPick: (v: Tab) => void; onRetry: () => void;
  onOpenNote: (n: AppNotice, route: string | null) => void; onOpenNews: (a: Announcement) => void; onRisen: () => void;
}) {
  const { tier, still } = useMotion();
  const rise = useSheetRise();
  const rowMs = tier === 'C' ? motionValues.reveal.C.duration : M.rowMs;
  const end = (M.rowMax - 1) * M.rowStep + rowMs;
  const clock = useSharedValue(still ? end : 0);
  const news = tab === 'news' && newsOn;
  const list = news ? lists.news?.items.slice(0, 10) : lists.notes?.items.slice(0, 10);
  const rows = !!list && list.length > 0;
  // rows in the opening's first commit come into view with the panel (drawn from its first frame, rising 8 pt); a list
  // that arrives later, and tier C, fade in
  const [onTime] = useState(rows);
  const ctx = useMemo<RiseClock>(() => ({ clock, rowMs, lift: tier === 'C' ? 0 : M.rowY, fade: tier === 'C' || !onTime, step: tier === 'C' ? 0 : M.rowStep }), [clock, rowMs, tier, onTime]);
  const armed = useSharedValue(0);
  useEffect(() => { if (rows) armed.set(1); }, [rows, armed]);
  // the panel's rise starts the rows' clock (rowAt into it); rows that come after the rise start it at once
  useAnimatedReaction(() => armed.get() === 1 && (rise ? rise.get() : 1) > 0.001, (go, was) => {
    if (!go || was || clock.get() !== 0) return;
    const after = !rise || rise.get() >= 0.999;
    clock.set(withDelay(after ? 0 : M.rowAt, withTiming(end, timing(end, linear))));
  });
  // the panel at its place: answers held during the rise may be drawn
  useAnimatedReaction(() => (rise ? rise.get() : 1) >= 0.999, (up, was) => { if (up && !was) scheduleOnRN(onRisen); });
  return <RiseClockContext.Provider value={ctx}>
    {tabs.length > 1 ? <PillTabs items={tabs} value={tab} onChange={onPick} style={styles.tabs} /> : null}
    <ErrorState error={lists.error} onRetry={onRetry} />
    <SwitchView id={tab} direction={tab === 'news' ? 1 : -1}>
      {!list && !lists.error ? <View style={styles.loading}><Spinner /></View> : null}
      {list && !list.length ? <View style={styles.empty}>
        <Icon name={tab === 'news' ? 'megaphone' : 'bell'} size={22} color={fx.ink.a25} />
        <T v="section" color={fx.ink.a60} center>{tab === 'news' ? 'No announcements' : 'Nothing yet'}</T>
        {tab === 'news' ? <T v="bodySm" color={fx.ink.a50} center>When the Bioptime team or your coach announces something, it appears here and you get a notification.</T> : null}
      </View> : null}
      {rows ? news
        ? <RiseList items={list as Announcement[]} keyOf={newsKey} render={(a) => <NewsRow a={a} onOpen={onOpenNews} lines={2} />} />
        : <RiseList items={list as AppNotice[]} keyOf={noteKey} render={(n) => <NotificationRow n={n} onOpen={onOpenNote} />} /> : null}
    </SwitchView>
  </RiseClockContext.Provider>;
}

const styles = StyleSheet.create({
  tabs: { marginBottom: 16 },
  list: { gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingRight: 4, borderBottomWidth: 1, borderBottomColor: fx.line.a05, minHeight: 44 },
  read: { opacity: 0.8 },
  pressed: { backgroundColor: fx.fill.a05 },
  dotCol: { width: 8, alignSelf: 'flex-start', paddingTop: 7 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: fx.red.brand, boxShadow: fx.shadow.dot },
  flex: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', columnGap: 8 },
  body: { marginTop: 2 },
  cat: { marginTop: 4 },
  newsTitle: { marginTop: 2, marginBottom: 2 },
  loading: { alignItems: 'center', paddingVertical: 32 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 32 },
});
