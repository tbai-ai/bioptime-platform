/* The Coach tab (tab 6): the earlier app's AI-chat chrome turned into the chat with the member's real coach
   (owner decision D2; BUILD §6.7, THEME §11.15, PREMIUM §1.10 "Coach").
   - On the #0A0A0A → #111111 → #0A0A0A canvas: the sticky header (the coach's monogram medallion, the name on its own
     line, "Your coach · Active"), the consultations strip (next consultation, Book, "x of y left"), then the scroll:
     Bioptime's paused notice when the coach is away, the Box Breathing card (on this device only), the way to the coach's
     recommendations and past consultations, and the thread (messages and files: GET /conversations/:id/messages; marked
     read while the tab is in front: POST …/read). Under it the quick-message chips and the composer, above the floating
     tab bar (the bar hides with the keyboard; the strip folds away while typing).
   - Sending is optimistic: the bubble rises from the composer with the typing dots while the request is in flight, then
     becomes the server's message; a failure says so and goes back to the composer on a tap. The sent message stays in
     view (M77): the thread is pinned to its end first (no animation) and the bubble rises after that pin; a first
     message of the day brings its day separator in the same render, the quick chips keep their row's height and only
     fade (away while a message is on its way and for 600 ms after it lands), and the server's copy takes over the
     bubble in place, so a send moves the thread once. Whenever the thread's viewport changes size while it is at its
     end it is pinned again. A coach message that arrives mounts
     already playing (worked out during the render) and the thread follows it to the end with a 280 ms glide on the web
     (the native smooth scroll elsewhere). New coach messages arrive
     on focus, on pull to refresh, and when the in-app poll (src/fx/data/useUpdates) reports one (push is not configured).
   - Sheets: the coach's profile, the upcoming consultation(s) (join, move, cancel, calendar file), the cancel question,
     past consultations with the coach's summaries, and adding a file. Book and Move are sheet routes.
   - The assistant: only while GET /me/assistant offers it (src/lib/assistant.ts) a "Coach | Assistant" segment appears
     in the header; today the server keeps it off and nothing about it is drawn.
   - Before a coach is assigned: the waiting state (./NoCoach). Flags: 'messaging' off ⇒ no paperclip and files do not
     open (the thread itself is core); 'sessions' off ⇒ no summaries, join line or calendar file; 'ai' off ⇒ the Coach AI
     link only while a consent is on record, and no assistant. */
import { router, useIsFocused, useScrollToTop } from 'expo-router';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, TextInput, View, type LayoutChangeEvent } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  COLUMN, EmptyState, ErrorState, Notice, Scrim, ScreenHeader, Segmented, SettingsRow, Sheet, Skeleton, StaleBanner, T, TabScreen,
  fx, haptics, invalidate, navBottom, onUpdate, toast, useFx,
} from '@/fx';
import { errorText, get, post } from '@/lib/api';
import { useAssistantStatus } from '@/lib/assistant';
import { useAuth } from '@/lib/auth';
import { useFeatures } from '@/lib/features';
import { aiConsentOnRecord } from '@/lib/modules/ai';
import { awaitingHeld, isAwaitingUpdate, isUpcoming } from '@/lib/today';
import { useLoad } from '@/lib/useLoad';
import { usePageReady } from '@/fx/nav/pageReady';
import { ease, motionValues } from '@/fx/motion/tokens';
import { AssistantPane } from './AssistantPane';
import { BreathingCard } from './BreathingCard';
import { CoachHeader } from './CoachHeader';
import { CoachProfileSheet } from './CoachProfileSheet';
import { Composer, QuickChips, startersFor, type PendingFile } from './Composer';
import { CancelSheet, PastSheet, UpcomingSheet } from './ConsultSheets';
import { ConsultStrip } from './ConsultStrip';
import { ATTACH_MAX_PER_MESSAGE, discardAttachment, openAttachment, openConsultationIcs, pickDocuments, pickImages, refuseFile, uploadAttachment, type Attachment, type PickedFile } from './files';
import { NoCoach } from './NoCoach';
import { statusOf } from './parts';
import { Thread, threadRows, type Message, type Outgoing } from './Thread';
import { whenLine } from './time';
import type { Appointment, CoachAnswer, Conversation, Me, Note, Summary, ThreadAnswer } from './types';

type SheetName = null | 'profile' | 'upcoming' | 'past' | 'attach';

const S = motionValues.screens.m77;
const S82 = motionValues.screens.m82;
const NONE: ReadonlySet<string> = new Set();

/** The web: the thread's end by layout. The browser's scroll height also counts a transformed bubble that has not
 *  risen yet (it sits 44 pt below its place), so pinning to it would scroll past the end and then drift back down as
 *  the bubble rises; the content's own laid-out height leaves transforms out. */
function webEnd(node: HTMLElement): number {
  const content = node.firstElementChild as HTMLElement | null;
  return Math.max(0, (content ? content.offsetHeight : node.scrollHeight) - node.clientHeight);
}

export function CoachScreen() {
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { config } = useAuth();
  const features = useFeatures(true);
  const filesOn = !!features?.has('messaging');
  const sessionsOn = !!features?.has('sessions');
  const aiOn = !!features?.has('ai');

  const me = useLoad<Me>('me', () => get('/me'), [], { shared: true });
  const coachQ = useLoad<CoachAnswer>('coach', () => get('/me/coach'), []);
  const convs = useLoad<{ items: Conversation[] }>('conversations', () => get('/conversations'), []);
  const conv = convs.data?.items?.[0] ?? null;
  const thread = useLoad<ThreadAnswer | null>(conv ? `thread-${conv.id}` : null, () => (conv ? get(`/conversations/${conv.id}/messages?limit=100`) : Promise.resolve(null)), [conv?.id]);
  const upcoming = useLoad<{ items: Appointment[] }>('appointments', () => get('/me/appointments?range=upcoming'), []);
  const past = useLoad<{ items: Appointment[] }>('appointments-past', () => get('/me/appointments?range=past'), []);
  const summaries = useLoad<{ items: Summary[] }>(sessionsOn ? 'consultation-summaries' : null, () => (sessionsOn ? get('/me/consultation-summaries') : Promise.resolve({ items: [] })), [sessionsOn]);
  const notes = useLoad<{ items: Note[] }>('notes', () => get('/me/notes'), []);
  // whether a report has been released (the quick messages ask about one only then); the same list Tests and Home read
  const reports = useLoad<{ items: unknown[] }>('reports', () => get('/me/reports'), []);
  const assistant = useAssistantStatus(aiOn);
  const [aiRecord, setAiRecord] = useState(false);
  useEffect(() => { if (features && !aiOn) void aiConsentOnRecord().then(setAiRecord); }, [features, aiOn]);

  const coach = coachQ.data?.coach ?? null;
  const assignment = coachQ.data?.assignment ?? null;
  const status = statusOf(assignment?.status);
  const name = coach?.displayName ?? assignment?.displayName ?? conv?.coachName ?? 'Your coach';
  const first = name.split(/\s+/)[0] || name;
  const items: Message[] = useMemo(() => (thread.data?.items ?? []).map((m) => ({ ...m, attachments: m.attachments ?? [] })), [thread.data]);
  // the shared rule (lib/today, the same as Home and Life): upcoming only while open and its end (or start) is after
  // now; one whose time has passed while still open is awaiting its update, listed with the past ones and counted apart.
  // The count beside "x of y left" is of the consultations that hold one of the package's (lib/today awaitingHeld, the
  // figure Home's balance shows): a check-in, a review or a coach's courtesy consultation is listed, never counted there
  const upcomingAll = upcoming.data?.items;
  const pastAll = past.data?.items;
  const upcomingItems = useMemo(() => (upcomingAll ?? []).filter((a) => isUpcoming(a)), [upcomingAll]);
  const pastItems = useMemo(() => {
    const lapsed = (upcomingAll ?? []).filter((a) => isAwaitingUpdate(a) && !(pastAll ?? []).some((x) => x.id === a.id));
    return lapsed.length ? [...lapsed, ...(pastAll ?? [])].sort((a, b) => b.startAt.localeCompare(a.startAt)) : pastAll ?? [];
  }, [upcomingAll, pastAll]);
  const awaiting = awaitingHeld(pastItems);
  const next = upcomingItems[0] ?? null;
  const left = me.data?.entitlements?.consultation ?? null;
  const noteCount = notes.data?.items?.length ?? 0;
  const pastCount = pastItems.length;
  const summaryCount = summaries.data?.items?.length ?? 0;
  const workoutsOn = !!features?.has('workouts');
  const starters = useMemo(() => startersFor({
    newHere: !!thread.data && !(thread.data.items ?? []).some((m) => m.mine), session: !!next,
    plan: !!(me.data as { plan?: unknown } | null)?.plan, workouts: workoutsOn, report: !!reports.data?.items?.length,
  }), [thread.data, next, me.data, workoutsOn, reports.data]);

  const [body, setBody] = useState('');
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [outbox, setOutbox] = useState<Array<Outgoing & { sentId?: string }>>([]);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [cancelling, setCancelling] = useState<Appointment | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pane, setPane] = useState<'coach' | 'assistant'>('coach');
  const [keyboard, setKeyboard] = useState(false);
  const [typing, setTyping] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [firstUnread, setFirstUnread] = useState<string | null | undefined>(undefined);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const nearBottom = useRef(true);
  const placed = useRef(false);
  const known = useRef<Set<string> | null>(null);
  const freshIds = useRef<Set<string>>(new Set()); // every message that arrived while the thread was open (kept, so a bubble's entrance never changes)
  const pinned = useSharedValue(0); // raised after each pin of the thread to its end (the sent bubble rises after it)
  const jumpNext = useRef(false); // the next content change pins without animation (a send)
  const glideFrame = useRef<number | null>(null);
  useScrollToTop(scroll as unknown as Parameters<typeof useScrollToTop>[0]);

  /* ---------- loading and refreshing ---------- */
  const loads = useRef({ coachQ, convs, thread, upcoming, past, summaries, notes, me, assistant });
  loads.current = { coachQ, convs, thread, upcoming, past, summaries, notes, me, assistant };
  const light = useCallback(() => { const l = loads.current; return Promise.all([l.coachQ.reload(), l.convs.reload(), l.thread.reload(), l.upcoming.reload()]); }, []);
  const all = useCallback(() => { const l = loads.current; return Promise.all([light(), l.past.reload(), l.summaries.reload(), l.notes.reload(), l.me.reload(), l.assistant.reload()]); }, [light]);
  const wasFocused = useRef(focused);
  useEffect(() => {
    if (focused && !wasFocused.current) void light();
    if (!focused) setFirstUnread(undefined);
    wasFocused.current = focused;
  }, [focused, light]);
  useEffect(() => onUpdate((news) => {
    const data = news.map((n) => n.data ?? {});
    if (data.some((d) => 'conversationId' in d || 'messageId' in d)) { void loads.current.convs.reload(); void loads.current.thread.reload(); }
    if (data.some((d) => 'appointmentId' in d)) { void loads.current.upcoming.reload(); void loads.current.past.reload(); }
    // "Meet your coach" (an assignment), "Your coach is away / back": the coach, the member's state and the conversation
    // are read again, so the waiting state turns into the coach while the tab is open (the poll's 30 s at most)
    if (data.some((d) => 'assignmentId' in d || 'coachId' in d)) { void loads.current.me.reload(); void loads.current.coachQ.reload(); void loads.current.convs.reload(); }
  }), []);
  const pull = () => { setPulling(true); haptics.refresh(); void all().finally(() => setPulling(false)); };
  // an assignment that lands while the tab is open (GET /me changes): the coach and the conversation are asked for
  // again at once, so the waiting state turns into the coach without leaving the tab
  // (the first answer of GET /me is where the comparison starts, not a change: the coach and the conversation are
  // already on their way then, and asking again would send both twice on every visit)
  const meKnown = !!me.data;
  const assignmentNow = me.data?.assignmentStatus;
  const assignmentSeen = useRef<{ status: typeof assignmentNow } | null>(null);
  useEffect(() => {
    if (!meKnown) return;
    if (!assignmentSeen.current) { assignmentSeen.current = { status: assignmentNow }; return; }
    if (assignmentNow === assignmentSeen.current.status) return;
    assignmentSeen.current = { status: assignmentNow };
    void loads.current.coachQ.reload();
    void loads.current.convs.reload();
  }, [meKnown, assignmentNow]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboard(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboard(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  /* ---------- the thread: what is new, what is unread, reading ---------- */
  useEffect(() => { known.current = null; placed.current = false; freshIds.current = new Set(); }, [conv?.id]);
  // what is new is worked out during the render, so a new bubble mounts already playing its entrance; the known ids
  // are brought up to date after the commit
  const fresh = useMemo(() => {
    if (!thread.data || !known.current) return NONE;
    const k = known.current;
    const added = items.filter((m) => !k.has(m.id)).map((m) => m.id);
    if (!added.length) return freshIds.current;
    freshIds.current = new Set([...freshIds.current, ...added]);
    return freshIds.current;
  }, [thread.data, items]);
  useEffect(() => {
    if (!thread.data) return;
    const k = known.current ?? new Set<string>();
    items.forEach((m) => k.add(m.id));
    known.current = k;
  }, [thread.data, items]);
  useEffect(() => {
    if (!thread.data || firstUnread !== undefined || !focused) return;
    setFirstUnread(items.find((m) => !m.mine && !m.readAt)?.id ?? null);
  }, [thread.data, items, firstUnread, focused]);
  const unread = items.filter((m) => !m.mine && !m.readAt).length;
  useEffect(() => {
    if (!focused || !conv?.id || !unread) return;
    const id = conv.id;
    const timer = setTimeout(() => {
      post(`/conversations/${id}/read`).then(() => {
        const at = new Date().toISOString();
        thread.setData((d) => (d ? { ...d, items: d.items.map((m) => (m.mine || m.readAt ? m : { ...m, readAt: at })) } : d));
        convs.setData((c) => (c ? { ...c, items: c.items.map((x) => (x.id === id ? { ...x, unread: 0 } : x)) } : c));
        invalidate(['me']);
      }, () => undefined);
    }, 700);
    return () => clearTimeout(timer);
  }, [focused, conv?.id, unread]); // eslint-disable-line react-hooks/exhaustive-deps

  // a sent message stays in its outbox place (with its rise) until it has settled; the list leaves it out meanwhile.
  // The outbox is laid out with the list (threadRows): a first message of the day gets its day separator in the same
  // render as its bubble, so nothing is inserted above it when it lands
  const shownOutbox = useMemo(() => outbox.map((o) => ({ ...o, m: o.sentId ? items.find((x) => x.id === o.sentId) : undefined })), [outbox, items]);
  const rows = useMemo(() => {
    const out = new Set(outbox.map((o) => o.sentId).filter((x): x is string => !!x));
    return threadRows(out.size ? items.filter((m) => !out.has(m.id)) : items, firstUnread ?? null, shownOutbox);
  }, [items, firstUnread, outbox, shownOutbox]);

  // the quick chips stay away while a message is on its way and for a moment after it lands, then fade back; their row
  // keeps its height throughout (QuickChips), so the thread never moves for them
  const sendingNow = shownOutbox.some((o) => o.state === 'sending' && !o.m);
  const [chipsHeld, setChipsHeld] = useState(false);
  useEffect(() => {
    if (sendingNow) { setChipsHeld(true); return; }
    const timer = setTimeout(() => setChipsHeld(false), S.chipsHold);
    return () => clearTimeout(timer);
  }, [sendingNow]);
  const showChips = !body && !pending.length && !sendingNow && !chipsHeld;

  /* ---------- keeping the end in view ---------- */
  const stopGlide = () => { if (glideFrame.current != null) { cancelAnimationFrame(glideFrame.current); glideFrame.current = null; } };
  const webNode = () => (Platform.OS === 'web' ? (scroll.current as unknown as { getScrollableNode?: () => HTMLElement | null } | null)?.getScrollableNode?.() ?? null : null);
  const pinNow = () => {
    stopGlide();
    const node = webNode();
    if (node) node.scrollTop = webEnd(node); else scroll.current?.scrollToEnd({ animated: false });
    pinned.value += 1;
  };
  // the web: a 280 ms glide to the end (an in-out curve, so no frame moves far); native: its own smooth scroll
  const { calm, tier } = useFx();
  const glide = () => {
    if (calm || tier === 'C') { pinNow(); return; } // reduced motion and tier C: at the end at once
    const node = webNode();
    if (!node || typeof requestAnimationFrame !== 'function') { scroll.current?.scrollToEnd({ animated: true }); return; }
    stopGlide();
    const from = node.scrollTop;
    const to = webEnd(node);
    if (Math.abs(to - from) < 1) return;
    let t0 = -1;
    const step = (now: number) => {
      if (t0 < 0) t0 = now;
      const u = Math.min(1, (now - t0) / S.webScrollMs);
      node.scrollTop = from + (to - from) * ease.cssInOut(u);
      glideFrame.current = u < 1 ? requestAnimationFrame(step) : null;
    };
    glideFrame.current = requestAnimationFrame(step);
  };
  useEffect(() => stopGlide, []);
  // the web: a send pins the thread to its end in the commit that draws the new bubble (a layout effect runs before the
  // paint, and reading the content's height lays the new rows and the reset composer out), so the old messages and the
  // bubble move together in the first frame and the rise starts at once (the bubble's own layout effect has read the
  // pin count before this one runs); native pins from onContentSizeChange as before
  const outboxSize = useRef(0);
  useLayoutEffect(() => {
    const grew = outbox.length > outboxSize.current;
    outboxSize.current = outbox.length;
    if (!grew || !placed.current || !webNode()) return;
    pinNow();
  }, [outbox.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const onThreadLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!width && !height) return; // a detached page reports 0 × 0
    if (Platform.OS === 'web') {
      // the thread keeps its end in view itself: the browser's scroll anchoring would shift it on its own when a
      // message arrives (a one-frame jump before the glide)
      const node = webNode();
      if (node && node.style.overflowAnchor !== 'none') node.style.overflowAnchor = 'none';
    }
    if (placed.current && nearBottom.current) pinNow();
  };

  /* ---------- sending ---------- */
  const uploading = pending.some((p) => p.uploading);
  const canSend = !!conv && !uploading && (!!body.trim() || pending.length > 0);
  const send = async (again?: Outgoing) => {
    if (!conv) return;
    const text = again ? again.body : body.trim();
    const files = again ? again.attachments : pending.filter((p) => !p.uploading);
    if (!text && !files.length) return;
    const id = again?.id ?? `out-${Date.now()}`;
    haptics.commit();
    nearBottom.current = true;
    jumpNext.current = true;
    setOutbox((x) => (again ? x.map((y) => (y.id === id ? { ...y, state: 'sending', error: undefined } : y)) : [...x, { id, body: text, attachments: files, createdAt: new Date().toISOString(), state: 'sending' }]));
    if (!again) { setBody(''); setPending([]); }
    try {
      const r = await post<{ id?: string }>(`/conversations/${conv.id}/messages`, { body: text, attachmentIds: files.length ? files.map((f) => f.id) : undefined });
      if (r?.id) known.current?.add(r.id);
      setOutbox((x) => x.map((y) => (y.id === id ? { ...y, sentId: r?.id ?? id } : y)));
      await thread.reload();
      // the server's copy takes over the bubble in place (its rise carries on), then joins the list at rest
      setTimeout(() => setOutbox((x) => x.filter((y) => y.id !== id)), S.pendingMs + S82.sendingSwapMs);
      void convs.reload();
    } catch (e) {
      haptics.error();
      setOutbox((x) => x.map((y) => (y.id === id ? { ...y, state: 'failed', error: errorText(e) } : y)));
    }
  };
  const editFailed = (o: Outgoing) => {
    setOutbox((x) => x.filter((y) => y.id !== o.id));
    setBody((b) => (b.trim() ? `${b}\n${o.body}` : o.body));
    setPending((p) => [...p, ...o.attachments]);
    input.current?.focus();
  };

  /* ---------- files ---------- */
  const addFiles = async (picker: () => Promise<PickedFile[]>) => {
    setSheet(null);
    if (!conv) return;
    let picked: PickedFile[] = [];
    try { picked = await picker(); } catch (e) { toast.error(errorText(e)); return; }
    const room = ATTACH_MAX_PER_MESSAGE - pending.length;
    if (picked.length > room) toast.error(`Up to ${ATTACH_MAX_PER_MESSAGE} files on one message.`);
    for (const f of picked.slice(0, Math.max(0, room))) {
      const why = refuseFile(f);
      if (why) { toast.error(why); continue; }
      const temp = `up-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      setPending((p) => [...p, { id: temp, name: f.name, mime: f.mime, bytes: f.bytes, kind: f.mime === 'application/pdf' ? 'pdf' : 'image', uploading: true }]);
      try {
        const a = await uploadAttachment(conv.id, f);
        setPending((p) => p.map((x) => (x.id === temp ? a : x)));
      } catch (e) {
        setPending((p) => p.filter((x) => x.id !== temp));
        toast.error(errorText(e));
      }
    }
  };
  const removeFile = (a: PendingFile) => {
    setPending((p) => p.filter((x) => x.id !== a.id));
    if (conv) void discardAttachment(conv.id, a.id).catch(() => undefined);
  };
  const openFile = (a: Attachment) => { void openAttachment(a).catch((e) => toast.error(errorText(e))); };

  /* ---------- consultations ---------- */
  const book = () => { setSheet(null); router.push('/book-appointment'); };
  const move = (a: Appointment) => { setSheet(null); router.push({ pathname: '/move-appointment/[id]', params: { id: a.id } }); };
  const askCancel = (a: Appointment) => { haptics.warning(); setCancelling(a); };
  const cancel = async () => {
    if (!cancelling) return;
    setBusy('cancel');
    try {
      await post(`/me/appointments/${cancelling.id}/cancel`, { reason: 'cancelled in the app' });
      setCancelling(null);
      toast.success('Consultation cancelled');
      invalidate(['appointments', 'appointments-past', 'me']);
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(null); }
  };
  const ics = async (a: Appointment) => {
    setBusy(`ics-${a.id}`);
    try { await openConsultationIcs(a.id); } catch (e) { toast.error(errorText(e)); } finally { setBusy(null); }
  };

  /* ---------- drawing ---------- */
  const bottom = keyboard ? 0 : navBottom(insets.bottom) + fx.space.navHeight + 8;
  // the tab pager slides a first-visited page in once it has drawn, and drops its placeholder (src/fx/nav/pageReady);
  // the thread does not sit in a TabScreen, so it says so itself
  const pageReady = usePageReady();
  const drawn = pageReady ? () => pageReady() : undefined;

  if (coachQ.loading && !coachQ.data) return <CoachSkeleton />;
  if (!coachQ.data) return <CoachUnavailable error={coachQ.error} onRetry={() => { void coachQ.reload(); }} />;
  if (!coach) {
    return <NoCoach me={me.data} refreshing={pulling} onRefresh={pull}>
      {coachQ.stale ? <View style={styles.pad}><StaleBanner at={coachQ.stale} /></View> : null}
    </NoCoach>;
  }

  return <View style={styles.screen} onLayout={drawn}>
    <Scrim kind="aiScreen" style={StyleSheet.absoluteFill} />
    <CoachHeader name={name} status={status} unread={conv?.unread ?? 0} onOpen={() => setSheet('profile')}>
      {assistant.offer ? <View style={styles.segment}>
        <Segmented items={[{ value: 'coach', label: 'Coach', icon: 'messages-square' }, { value: 'assistant', label: 'Assistant', icon: 'sparkles' }]} value={pane} onChange={setPane} />
      </View> : null}
    </CoachHeader>
    {pane === 'assistant' && assistant.offer ? <AssistantPane status={assistant.status} onStatus={assistant.setStatus} bottom={bottom} /> : <View style={[styles.fill, { paddingBottom: bottom }]}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {!keyboard || !typing ? <View style={styles.col}>
          <ConsultStrip next={next} more={Math.max(0, upcomingItems.length - 1)} awaiting={awaiting} left={left} onOpen={() => setSheet('upcoming')} onBook={book} />
        </View> : null}
        {/* the thread scrolls under the strip with a fade, not a hard edge (CRT-N6) */}
        <View style={styles.fill}>
        <ScrollView
          ref={scroll}
          style={styles.fill}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={64}
          onScroll={(e) => { const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent; nearBottom.current = contentSize.height - (contentOffset.y + layoutMeasurement.height) < 140; }}
          onLayout={onThreadLayout}
          onContentSizeChange={() => {
            if (!thread.data) return;
            if (!placed.current) { placed.current = true; requestAnimationFrame(() => scroll.current?.scrollToEnd({ animated: false })); return; }
            if (jumpNext.current) { jumpNext.current = false; pinNow(); return; }
            if (nearBottom.current) glide();
          }}
          refreshControl={<RefreshControl refreshing={pulling} onRefresh={pull} tintColor={fx.red.brand} colors={[fx.red.brand]} progressBackgroundColor={fx.bg.card} />}>
          <StaleBanner at={coachQ.stale ?? thread.stale} />
          <ErrorState error={convs.error ?? thread.error} onRetry={() => { void light(); }} />
          {status === 'paused' ? <Notice kind="warning" title="Away for now">Your coach is away. Your plan and bookings stay as they are, messages wait for your coach, and Bioptime can reassign you if needed.</Notice> : null}
          <BreathingCard />
          <View style={styles.tiles}>
            {noteCount ? <SettingsRow icon="clipboard-list" title="Recommendations" sub={`${noteCount} note${noteCount === 1 ? '' : 's'} from ${first}`} onPress={() => router.push('/recommendations')} /> : null}
            <SettingsRow icon="calendar-check" title="Past consultations" sub={pastCount ? `${pastCount} consultation${pastCount === 1 ? '' : 's'}${sessionsOn && summaryCount ? ` · ${summaryCount} ${summaryCount === 1 ? 'summary' : 'summaries'} from ${first}` : ''}` : 'None yet'} onPress={() => { setSheet('past'); void past.reload(); void summaries.reload(); }} />
          </View>
          {conv ? <T v="caption" color={fx.ink.a50} center style={styles.note}>{`With ${name}. Messages stay in the app; nothing here is medical advice.`}</T> : null}
          {thread.loading && !thread.data && conv ? <BubbleSkeleton />
            : items.length || shownOutbox.length ? <Thread rows={rows} coachName={name} fresh={fresh} pinned={pinned} filesOn={filesOn} onOpenFile={openFile} onRetry={editFailed} />
              : conv ? <EmptyState icon="message-square" title={`Say hello to ${first}`} body="Your coach reads messages during working hours." />
                : convs.data ? <EmptyState icon="message-square" title="No conversation yet" body="It opens when a coach is assigned to you." /> : null}
        </ScrollView>
        <Scrim kind="threadTop" style={styles.threadTop} />
        </View>
        {conv ? <View style={styles.col}>
          <QuickChips items={starters} shown={showChips} onPick={(s) => { setBody(s); input.current?.focus(); }} />
          <Composer
            value={body}
            onChange={setBody}
            onSend={() => { void send(); }}
            canSend={canSend}
            placeholder={`Write to ${first}…`}
            label={`Message to ${name}`}
            filesOn={filesOn}
            onAttach={() => setSheet('attach')}
            pending={pending}
            onRemove={removeFile}
            inputRef={input}
            onFocusChange={setTyping}
          />
        </View> : null}
      </KeyboardAvoidingView>
    </View>}

    {coach ? <CoachProfileSheet visible={sheet === 'profile'} onClose={() => setSheet(null)} coach={coach} status={status} notes={noteCount} showCoachAi={aiOn || aiRecord} supportEmail={config?.supportEmail ?? null} /> : null}
    <UpcomingSheet visible={sheet === 'upcoming'} onClose={() => setSheet(null)} items={upcomingItems} sessionsOn={sessionsOn} left={left} busy={busy} onMove={move} onCancel={askCancel} onIcs={(a) => { void ics(a); }} onBook={book} />
    <CancelSheet visible={!!cancelling} onClose={() => setCancelling(null)} onConfirm={() => { void cancel(); }} busy={busy === 'cancel'} when={cancelling ? whenLine(cancelling.startAt) : null} />
    <PastSheet visible={sheet === 'past'} onClose={() => setSheet(null)} items={pastItems} summaries={summaries.data?.items ?? []} sessionsOn={sessionsOn} loading={past.loading} notes={noteCount} onNotes={() => { setSheet(null); router.push('/recommendations'); }} />
    <Sheet visible={sheet === 'attach'} onClose={() => setSheet(null)} title="Add a file">
      <View style={styles.attach}>
        <SettingsRow icon="image" title="Photo" sub="From your photo library" onPress={() => { void addFiles(pickImages); }} />
        <SettingsRow icon="file-text" title="Document" sub="PDF, PNG, JPEG or WebP, up to 5 MB" onPress={() => { void addFiles(pickDocuments); }} />
        <T v="bodySm" color={fx.ink.a60}>{`Up to ${ATTACH_MAX_PER_MESSAGE} files on one message. Files you send go to your coach, who can open them even while health sharing is off.`}</T>
      </View>
    </Sheet>
  </View>;
}

function BubbleSkeleton() {
  return <View style={styles.skeletonThread} accessibilityLabel="Loading messages">
    {[0.62, 0.48, 0.7].map((w, i) => <View key={i} style={[styles.skeletonLine, i % 2 ? styles.skeletonMine : null]}>
      {i % 2 ? null : <Skeleton width={28} height={28} radius={14} />}
      <Skeleton width={`${w * 100}%` as `${number}%`} height={i === 2 ? 64 : 44} radius={16} />
    </View>)}
  </View>;
}

function CoachSkeleton() {
  const insets = useSafeAreaInsets();
  return <View style={styles.screen} accessibilityLabel="Loading your coach">
    <Scrim kind="aiScreen" style={StyleSheet.absoluteFill} />
    <View style={[styles.skeletonHead, { paddingTop: insets.top + 12 }]}>
      <Skeleton width={40} height={40} radius={20} />
      <View style={styles.skeletonText}><Skeleton width={140} height={16} /><Skeleton width={100} height={11} /></View>
    </View>
    <View style={[styles.col, styles.skeletonBody]}>
      <Skeleton height={64} radius={fx.radius.card} />
      <Skeleton height={220} radius={fx.radius.three} />
      <BubbleSkeleton />
    </View>
  </View>;
}

/** The coach's details did not come (offline with nothing saved, or an error): the reason and Try again; box
 *  breathing still works. */
function CoachUnavailable({ error, onRetry }: { error: Error | null; onRetry: () => void }) {
  return <TabScreen onRefresh={onRetry}>
    <ScreenHeader title="Coach" subtitle="Your coach, consultations and messages." />
    <View style={styles.pad}><ErrorState error={error} onRetry={onRetry} /><BreathingCard /></View>
  </TabScreen>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  fill: { flex: 1 },
  col: { width: '100%', maxWidth: COLUMN, alignSelf: 'center' },
  segment: { paddingHorizontal: 20, paddingTop: 12, width: '100%', maxWidth: COLUMN + 40, alignSelf: 'center' },
  scroll: { width: '100%', maxWidth: COLUMN, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16, gap: 14 },
  threadTop: { position: 'absolute', left: 0, right: 0, top: 0, height: 20 },
  tiles: { gap: 8 },
  note: { marginTop: 4, paddingHorizontal: 12 },
  pad: { paddingHorizontal: 20, gap: 12 },
  attach: { gap: 10 },
  skeletonThread: { gap: 14, marginTop: 8 },
  skeletonLine: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  skeletonMine: { justifyContent: 'flex-end' },
  skeletonHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: fx.line.a05 },
  skeletonText: { gap: 6 },
  skeletonBody: { padding: 16, gap: 14 },
});
