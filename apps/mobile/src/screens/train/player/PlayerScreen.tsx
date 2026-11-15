/* workout/[id]: one session from the coach's programme, as the earlier app's full-screen workout player (shots 35–41)
   with Bioptime's logging under it (GAP_MAP §4.5):
   - the photo of the row or card that was tapped flies into the 16:9 area (PhotoMorph) and gives way to the exercise
     pager: each exercise's clip from the API (poster first, played on a tap), or its photo when it has none, with the
     sentence that it is described in text only;
   - the control strip (scrubber, replay, previous / play / next) and the prescription chips;
   - the Exercise Guide of the exercise on screen (Purpose, Muscles, Form, Safety from the session's own copy of the
     library text; Recs from the coach's prescription);
   - the coach's feedback, a card per exercise with its sets to tick (reps, seconds, load), the rest and work timer,
     effort (1–10), duration and a note; "Log session" in the sticky footer (POST /complete; logging again replaces the
     earlier log; with no set ticked it first asks, in one line, whether to log it as completed without sets), "Skip" with an optional reason (POST /skip);
     the sets of a session not logged yet (ticks, reps, seconds, loads) stay on this device as its draft when the player
     closes, with no question asked, and are there again when it reopens, in this run and after a restart (./draft);
     a log or a closed programme drops the draft, and one left alone is forgotten only once it is old (TC-01);
   - a closed programme or a skipped session says so in the words the app has always used.
   Coach updates: a new notification about this session or its programme reloads it.
   Motion v2:
   - M69 phases: the first commit draws the stage, the hero's cover (the picture the row showed, its recycling key
     the same), the header and the frames of the strip, the guide and the footer (plain views in their final layout,
     entering with the stage's content from morph.contentAt), so the photo never lands over an empty body; with a
     flight the strip, the clips and the footer replace their frames in place once the photo has landed (the screen
     is still then), the guide a frame later and the set cards, the form and the coach's feedback rise in under it a
     frame after the guide; without one, the strip, clips and footer are in the first frame and the rest follows
     S.m69.phase2After (the guide, then the rest a frame later). The clip's player is made once all of that has drawn
     and the opening has settled (t.settle later, in an idle moment: useClipHost), never before the photo flies and
     never in the commit that swaps the strip's frame (release UX-04: its 50-70 ms held that frame on Android); a Play
     before then makes it at once and plays. The session opens on
     the copy this device already has (the row's press-in starts loading it) and refreshes behind, so there is no
     spinner when it is known. Opened with a flight, the clips fade in over the landed photo; opened without one
     (History, a link, tier C, reduced motion) they are there from the first frame, over the same poster;
   - M70 the rest timer counts inside its card (only its text renders each second) and the cards are memoised; a rest
     that opens is brought into view above the footer once the member's ticking has paused (t.settle), never under a
     finger reaching for the next set;
   - M72 SESSION DONE: a successful log turns the button into a 56 pt red disc (its one background leaf shrinks; the
     label fades out), a white check draws and the success haptic fires; S.m72.swapAfter later a glass SESSION DONE card
     rises above the footer's button (FlowSwap) with a 64 pt check that pops (a ring bursts at tier A), the title
     rising and the session's own numbers counting from 0, while the disc gives way to the "Update log" ghost button.
     The panel is the one confirmation (no toast over it or the rest timer; a partial log says so in its sets cell,
     '3/6 · partly'), and the log ends a running rest (its block fades out over t.swapOut). Once the session is
     logged here, an effort chip, a duration or a set changed after it saves itself in the background (t.change after
     the last change, in an idle moment; at once when the player is left before then) and the panel's figure rolls to it. The member's tick that completes the
     session starts no rest and brings 'After the session' into view (t.reveal, ease.inOut). Tier B: no burst; tier C:
     crossfades and a static check; reduced motion: 150 ms fades;
   - M76 effort is an intensity ladder (EffortLadder); selecting a card's head keeps that card where it is on screen
     while the guide above it changes. */
import { router, useLocalSearchParams } from 'expo-router';
import React, { memo, startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState, Keyboard, Platform, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, { useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import {
  Button, CheckPop, CountUp, ErrorState, FONTS, Field, GlassCard, H, Icon, Input, MorphHero, Notice, P, Photo, Pill, RemotePhoto, RingSpinner, Sheet, StaleBanner, T,
  calmFade, doneOnce, ease, fx, haptics, invalidate, motionValues, onUpdate, t, timing, toast, useFx, useMotion, type IconName,
} from '@/fx';
import { FlowSwap } from '@/fx/FxScreen';
import { useMorphClose, useMorphCopy } from '@/fx/motion/PhotoMorph';
import { ApiError, errorText, post } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { EffortLadder } from '../EffortLadder';
import { ExercisePoster, ExerciseTile } from '../ExerciseTile';
import { Rise, Roll, ShiftHost, Shifted, useChangeDir } from '../motion';
import {
  categoryColor, categoryIcon, categoryLabel, dayMonth, hasClip, loadSession, prescription, rememberDetail, rememberedDetail, rememberedSession, secs, serverUrl,
  coveredNow, sessionKey, sessionPhoto, sessionState, skipReasonSentence, kgTo, toKg, fmtNumber, useWeightUnit, warmPicture, weekday, workoutMorphKey,
  type SessionDetail, type SessionItem, type WeightUnit,
} from '../shared';
import { CLIP_NOTE, ClipControls, ClipControlsFrame, MediaPager, MetaChip, NO_CLIP, useClipHost, type Clip, type ClipPage } from './Clip';
import { draftKey, flushDrafts, putDraft, readDraft, useDraftsReady, type Draft } from './draft';
import { ExerciseGuide, ExerciseGuideFrame, type GuideContent } from './ExerciseGuide';
import { MorphOverlay, useOverlayClose, useOverlayScroll } from './MorphOverlay';
import { SetCard, plannedReps, type SetRow, type Timer } from './SetLogger';

const S = motionValues.screens;
const toNum = (s: string): number | null => { const v = s.trim().replace(',', '.'); if (!v) return null; const n = Number(v); return Number.isFinite(n) ? n : NaN; };
/** What a session's rows are built from (its status, logs and the log's effort, duration and note): the rows are
 *  built again only when this changes. */
const logKeyOf = (x: SessionDetail) => JSON.stringify([x.id, x.status, x.rpe, x.durationMinutes, x.memberNote, (x.items ?? []).map((it) => [it.id, it.sets, it.reps, it.durationSeconds, it.logs])]);
type SetSent = { itemId: string; setNumber: number; repsDone: number | null; durationSeconds: number | null; loadKg: number | null; completed: boolean };
/** A save that failed: its values, how (see failedKey), when to try again, what to say, and whether it was said. */
type Failure = { key: string; kind: 'unreached' | 'busy' | 'refused'; wait: number; text: string; said: boolean };
/** The service's limits for a set and a log (packages/domain workouts setLogSchema, sessionCompleteSchema). */
const MAX_REPS = 1000, MAX_SECONDS = 86_400, MAX_LOAD_KG = 1000, MAX_MINUTES = 600, MAX_NOTE = 1000;
const whole = (v: number | null, max: number) => v == null || (Number.isInteger(v) && v >= 0 && v <= max);
/** The ticked sets a log sends (loads in kg), or the first ticked set whose numbers the service would not take, said
 *  in words. */
function sentSets(items: SessionDetail['items'], rows: Record<string, SetRow[]>, unit: WeightUnit): { sets: SetSent[]; problem: string } {
  const sets: SetSent[] = [];
  let problem = '';
  for (const it of items ?? []) (rows[it.id] ?? []).forEach((x, k) => {
    if (!x.done) return;
    const reps = toNum(x.reps), sec = toNum(x.seconds), load = toNum(x.load);
    const at = `${it.exerciseName}, set ${k + 1}`;
    if ([reps, sec, load].some((v) => Number.isNaN(v))) { problem ||= `${at}: numbers only`; return; }
    if (!whole(reps, MAX_REPS)) { problem ||= `${at}: reps, a whole number up to 1,000`; return; }
    if (!whole(sec, MAX_SECONDS)) { problem ||= `${at}: seconds, a whole number up to 86,400`; return; }
    const kg = load == null ? null : toKg(load, unit);
    if (kg != null && !(kg >= 0 && kg <= MAX_LOAD_KG)) { problem ||= `${at}: load, up to ${unit === 'kg' ? '1,000 kg' : '2,204 lb'}`; return; }
    sets.push({ itemId: it.id, setNumber: k + 1, repsDone: reps, durationSeconds: sec, loadKg: kg, completed: true });
  });
  return { sets, problem };
}
/** The duration or the note the service would not take, said in words, or ''. */
function formProblem(minutes: string, note: string): string {
  const m = minutes.trim();
  if (m && !(Number(m) >= 1 && Number(m) <= MAX_MINUTES && Number.isInteger(Number(m)))) return 'Duration: a whole number of minutes, up to 600';
  if (note.trim().length > MAX_NOTE) return 'Note: up to 1,000 characters';
  return '';
}
/** What a log sends, as one key: the same values give the same key (a set the service would not take counts too). */
const formKey = (rpe: number | null, minutes: string, note: string, sent: { sets: SetSent[]; problem: string }) => JSON.stringify([rpe, minutes.trim(), note.trim(), sent.sets, sent.problem]);
/** The session's rows with a kept draft over them (TC-01): each set the draft has, in the same exercise and place (an
 *  exercise or a set the coach has since removed is left out); its loads in the device's unit now. */
function withDraft(base: Record<string, SetRow[]>, draft: Draft, unit: WeightUnit): Record<string, SetRow[]> {
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  const load = (v: string) => { const n = toNum(v); return draft.unit === unit || n == null || Number.isNaN(n) ? v : fmtNumber(kgTo(toKg(n, draft.unit), unit)); };
  const out: Record<string, SetRow[]> = {};
  for (const [itemId, list] of Object.entries(base)) {
    const kept = Array.isArray(draft.rows[itemId]) ? draft.rows[itemId] : null;
    out[itemId] = kept ? list.map((r, k) => { const x = kept[k]; return x ? { done: !!x.done, reps: text(x.reps), seconds: text(x.seconds), load: load(text(x.load)) } : r; }) : list;
  }
  return out;
}
/** Whether two sets of rows hold the same ticks and numbers. */
function sameRows(a: Record<string, SetRow[]>, b: Record<string, SetRow[]>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => { const x = a[k], y = b[k]; return !!y && x.length === y.length && x.every((r, i) => r.done === y[i].done && r.reps === y[i].reps && r.seconds === y[i].seconds && r.load === y[i].load); });
}
const RELOAD_KEYS = ['workouts', 'programme', 'me', 'workouts.history', 'workouts.records'];
/** The cover's opacity under the clips (the row's thumbnail is drawn the same way). */
const COVER = 0.7;
/** Every set ticked after the player was open this long (minutes): an empty duration is filled in with that time (the
 *  member can change it; a shorter open is a log written after the session, so nothing is guessed then). */
const PREFILL_MINUTES = 5;
/** A background save the service could not be reached for is tried again this often (ms), quietly, until it goes
 *  through or the member changes something; one the service refused waits for the member's change. */
const RETRY_MS = 15_000;

type FooterPhase = 'form' | 'disc' | 'done';
type StripChip = { icon: IconName; text: string; color?: string };

/** Runs `job` in the next idle moment (a JS timer where there is no idle callback); returns its cancel. */
function whenIdle(job: () => void): () => void {
  const w = globalThis as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
  if (w.requestIdleCallback) {
    const h = w.requestIdleCallback(job, { timeout: t.premount });
    return () => w.cancelIdleCallback?.(h);
  }
  const timer = setTimeout(job, 0);
  return () => clearTimeout(timer);
}

export default function PlayerScreen() {
  const { id, cat, cover: coverKind } = useLocalSearchParams<{ id: string; cat?: string; cover?: string }>();
  const key = workoutMorphKey(id);
  const s = useLoad<SessionDetail>(sessionKey(id), () => loadSession(id), [id], { shared: true });
  const known = useMemo(() => rememberedDetail(id), [id]);
  const d = s.data ?? known;
  useEffect(() => { if (s.data) rememberDetail(s.data); }, [s.data]);
  const unit = useWeightUnit();
  const { calm } = useFx();
  const { width: winW, height: winH } = useWindowDimensions();
  const W = winW;
  const Hh = Math.min(Math.round((W * 9) / 16), Math.round(winH * 0.42));
  // the media keep 16:9 in a wide window (a tablet in landscape): centred in the hero, black either side, never
  // cover-cropped to a thin band that cut the exercise's head or weights off (TAB-02); a phone's is the window's width
  const MW = Math.min(W, Math.round((Hh * 16) / 9));

  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [rows, setRows] = useState<Record<string, SetRow[]>>({});
  const [rpe, setRpe] = useState<number | null>(null);
  const [minutes, setMinutes] = useState('');
  const [note, setNote] = useState('');
  const [skipOpen, setSkipOpen] = useState(false);
  const [askEmpty, setAskEmpty] = useState(false); // "Log session" with no set ticked: one line to confirm first
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [timer, setTimer] = useState<Timer | null>(null);
  const [footerPhase, setFooterPhase] = useState<FooterPhase>('form');
  const phaseRef = useRef<FooterPhase>('form');
  phaseRef.current = footerPhase;

  // coach updates about this session or its programme
  const programId = d?.programId;
  const reload = s.reload;
  useEffect(() => onUpdate((fresh) => {
    if (fresh.some((n) => { const x = n.data ?? {}; return x.workoutId === id || x.sessionId === id || (!!programId && (x.programId === programId || x.programmeId === programId)); })) void reload();
  }), [id, programId, reload]);

  // the member's own logs fill the rows; otherwise empty rows with the planned reps and time. Keyed by what the logs
  // hold, so the fresh copy arriving after the one this device had does not reset what the member is typing
  const logKey = d ? logKeyOf(d) : '';
  // TC-01: what the member ticked and typed in a session not logged yet is kept as its draft on this device (./draft)
  // and drawn in the rows when the session opens again, in this run and after a restart; a log drops it. `baseRows`:
  // the rows the session itself gives (the draft is the member's change from them); `drawn`: every rows object this
  // screen drew itself (the first, the session's, the session's with its draft), so any other rows on screen are the
  // member's change, each one saved however React batches the effects of fast edits (P1-A1: a flag the handler set
  // and the effect cleared lost the last key of a burst); `builtFor`: the logs the rows were built from
  const draftsReady = useDraftsReady();
  const baseRows = useRef<Record<string, SetRow[]>>({});
  const drawn = useRef<WeakSet<object> | null>(null);
  if (!drawn.current) { drawn.current = new WeakSet<object>(); drawn.current.add(rows); }
  const draw = (next: Record<string, SetRow[]>) => { drawn.current?.add(next); setRows(next); };
  const builtFor = useRef('');
  useEffect(() => {
    if (!d) return;
    const dk = draftKey(d.id, d.scheduledDate);
    const keeps = d.programStatus === 'published' && d.status !== 'completed' && d.status !== 'partial';
    if (!keeps) putDraft(dk, null);
    const kept = keeps ? readDraft(dk) : null;
    // the stored drafts answered after the rows were built: the draft is drawn over the same rows, nothing else changes
    if (builtFor.current === logKey) { if (kept) draw(withDraft(baseRows.current, kept, unit)); return; }
    builtFor.current = logKey;
    const next: Record<string, SetRow[]> = {};
    for (const it of d.items ?? []) {
      const logs = it.logs ?? [];
      next[it.id] = Array.from({ length: Math.max(it.sets, ...logs.map((l) => l.setNumber)) }, (_, k) => {
        const l = logs.find((x) => x.setNumber === k + 1);
        return l ? { done: !!l.completed, reps: l.repsDone != null ? String(l.repsDone) : '', seconds: l.durationSeconds != null ? String(l.durationSeconds) : '', load: l.loadKg != null ? fmtNumber(kgTo(l.loadKg, unit)) : '' }
          : { done: false, reps: plannedReps(it.reps), seconds: it.durationSeconds ? String(it.durationSeconds) : '', load: '' };
      });
    }
    baseRows.current = next;
    draw(kept ? withDraft(next, kept, unit) : next); setRpe(d.rpe ?? null); setMinutes(d.durationMinutes ? String(d.durationMinutes) : ''); setNote(d.memberNote ?? '');
    // built from a log that came another way (another device, a reload): what the form now shows is what the service
    // holds, so it is not sent back
    builtKey.current = formKey(d.rpe ?? null, d.durationMinutes ? String(d.durationMinutes) : '', d.memberNote ?? '', sentSets(d.items, next, unit));
    if (sentKey.current) { sentKey.current = builtKey.current; sentCount.current = sentSets(d.items, next, unit).sets.length; failedKey.current = null; }
    setIndex((i) => Math.min(i, Math.max(0, (d.items?.length ?? 1) - 1)));
  }, [logKey, draftsReady]); // eslint-disable-line react-hooks/exhaustive-deps
  // a change of the member's to a session not logged yet is kept as its draft (none once the rows are back to what the
  // session gives); written to storage later, in an idle moment, and at once when the player goes or the app leaves
  useEffect(() => {
    if (!d || drawn.current?.has(rows)) return;
    if (d.programStatus !== 'published' || d.status === 'completed' || d.status === 'partial') return;
    putDraft(draftKey(d.id, d.scheduledDate), sameRows(rows, baseRows.current) ? null : { unit, rows, at: Date.now() });
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // the app leaving the foreground also sends a change still waiting for its background save (the phone may end the
    // app before the save's own timer would)
    const sub = AppState.addEventListener('change', (st) => { if (st !== 'active') { flushDrafts(); flushRef.current(false); } });
    return () => { sub.remove(); flushDrafts(); };
  }, []);

  const items = useMemo(() => d?.items ?? [], [d]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const current = items[index] ?? null;
  const clipRef = useRef<Clip>(NO_CLIP); // the clip on screen (useClipHost, below the opening's phases)
  const indexRef = useRef(index);
  indexRef.current = index;
  const go = useCallback((i: number) => {
    if (i === indexRef.current) return;
    clipRef.current.stop();
    setDir(i > indexRef.current ? 1 : -1);
    setIndex(i);
  }, []);

  // the rest / work countdown (it counts inside its card: SetLogger's TimerBlock)
  const restLater = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelRest = () => { if (restLater.current) { clearTimeout(restLater.current); restLater.current = null; } };
  useEffect(() => cancelRest, []);
  const startTimer = useCallback((itemId: string, kind: 'rest' | 'work') => {
    cancelRest();
    const it = itemsRef.current.find((x) => x.id === itemId);
    const total = (kind === 'rest' ? it?.restSeconds : it?.durationSeconds) ?? 0;
    if (total > 0) setTimer({ itemId, kind, total, endAt: Date.now() + total * 1000 });
  }, []);
  const stopTimer = useCallback(() => { cancelRest(); setTimer(null); }, []);
  // every set ticked by hand: the Log button gives one glow pulse (nudge) and an empty duration is filled in with the
  // minutes the player has been open (PREFILL_MINUTES or more; marked as such until the member changes it)
  const openedAt = useRef(Date.now());
  const [nudge, setNudge] = useState(0);
  const [minutesGuessed, setMinutesGuessed] = useState(false);
  const minutesRef = useRef('');
  const loggedRef = useRef(false);
  const onAllDone = useCallback(() => {
    setNudge((n) => n + 1);
    const open = Math.round((Date.now() - openedAt.current) / 60_000);
    if (open >= PREFILL_MINUTES && !loggedRef.current && !minutesRef.current.trim()) { setMinutes(String(open)); setMinutesGuessed(true); }
  }, []);
  const editMinutes = useCallback((v: string) => { setMinutes(v); setMinutesGuessed(false); }, []);
  /** The timer leaves (it fades out in its card, then stopTimer): a log that commits ends the rest. */
  const closeTimer = useCallback(() => { cancelRest(); setTimer((tm) => (tm && !tm.closing ? { ...tm, closing: true } : tm)); }, []);
  // every set of the session ticked (as of the last render), and whether the last change of a tick was the member's
  const finished = useRef(false);
  const handTick = useRef(false);
  const onRow = useCallback((itemId: string, k: number, patch: Partial<SetRow>) => {
    // a new rows object, not one of `drawn`: kept as the session's draft while it is not logged (TC-01)
    setRows((r) => ({ ...r, [itemId]: (r[itemId] ?? []).map((x, i) => (i === k ? { ...x, ...patch } : x)) }));
    if (patch.done !== undefined) handTick.current = true;
    const it = itemsRef.current.find((x) => x.id === itemId);
    if (patch.done && it?.restSeconds) {
      // the rest counts from the tick; its block opens once the tick's sweep has played (its mount never stalls it).
      // The session's last set starts no rest: the screen brings 'After the session' into view instead
      const endAt = Date.now() + it.restSeconds * 1000;
      const total = it.restSeconds;
      cancelRest();
      // its mount is a transition: React renders it in slices, so the first ring of a session (the most work) never holds
      // a frame of the sweep or the page (one 165-425 ms frame on the web before)
      restLater.current = setTimeout(() => { restLater.current = null; if (!finished.current) startTransition(() => setTimer({ itemId, kind: 'rest', total, endAt })); }, S.m73.sweepMs);
    }
  }, []);

  /* ---------- the opening: two phases, and the clips over the landed photo ---------- */
  // level 0: the stage, the hero's cover and the header (nothing else delays the photo's lift-off); 1: the strip, the
  // pager and the footer; 2: the guide, then (`full`, a frame later) the sets, the form and the feedback; the clip's
  // player after them. With a flight they follow the landing (the screen is still then); without one, 1 is in the first
  // frame and 2 follows S.m69.phase2After.
  const mediaIn = useSharedValue(1); // the clips over the cover: 1 from the first frame without a flight
  const flight = useRef<'unknown' | 'flying' | 'landed'>('unknown');
  const [morphing, setMorphing] = useState<boolean | null>(null);
  const morphingRef = useRef(false);
  const [level, setLevel] = useState(0);
  // level 2 in two commits (UX-04): the guide (in its frame's place) first, the coach's feedback, the sets and the form
  // a frame later (`full`)
  const [full, setFull] = useState(false);
  const mediaWaits = useRef(false); // the clips fade in once their level has drawn
  // CRT-3: the strip's frame has been drawn with the session (its controls as the strip draws them), so the strip
  // replaces it as it is; only a frame still waiting for the session (plain discs) has the strip's controls fade in
  const framed = useRef(false);
  const [stripFades, setStripFades] = useState(true);
  const onCopy = useCallback(() => {
    if (flight.current !== 'unknown') return; // the closing flight's copy
    flight.current = 'flying';
    mediaIn.value = 0;
    mediaWaits.current = true;
    morphingRef.current = true;
    setMorphing(true);
  }, [mediaIn]);
  const onLanded = useCallback(() => {
    if (flight.current !== 'flying') return;
    flight.current = 'landed';
    coveredNow(); // the row that opened the player stops holding its press (it is covered)
    requestAnimationFrame(() => { if (framed.current) setStripFades(false); setLevel(1); }); // the frame after the hero shows
  }, []);
  useEffect(() => coveredNow, []);
  // the body follows the strip by one drawn frame (two shorter frames instead of one long one), and the rest of the
  // body follows the guide by another
  useEffect(() => {
    if (level !== 1 || flight.current !== 'landed' || !morphingRef.current) return;
    const raf = requestAnimationFrame(() => setLevel((l) => Math.max(l, 2)));
    return () => cancelAnimationFrame(raf);
  }, [level]);
  useEffect(() => {
    if (level < 2 || full) return;
    const raf = requestAnimationFrame(() => setFull(true));
    return () => cancelAnimationFrame(raf);
  }, [level, full]);
  // the strip's frame drawn with the session (a commit before level 1 with the exercise known)
  useEffect(() => { if (level === 0 && current) framed.current = true; }, [level, current]);
  // the clip's player is made once all of that has drawn and the opening has settled (t.settle: the clips' fade-in over
  // the landed photo is long over; UX-04: never in the commit that swaps the strip's frame, never under a fade); until
  // then the strip and the pager hold a stand-in whose Play makes it at once
  const { clip, host: clipHost } = useClipHost(current?.media, current?.id ?? null, level >= 2 && full, t.settle);
  clipRef.current = clip;
  // after the copy's own layout effect: no copy means no flight (this re-render is drawn before the first paint); the
  // picture then fades in with the stage (as the stage's own fade: t.fast, or the calm crossfade), not ahead of it
  const heroIn = useSharedValue(1);
  useLayoutEffect(() => {
    if (flight.current !== 'unknown') return;
    flight.current = 'landed';
    setMorphing(false);
    setLevel(1);
    heroIn.value = 0;
    heroIn.value = withTiming(1, calm ? calmFade() : timing(t.fast));
    // the held row, once the stage covers it (idempotent): on the web from the mount (never held unseen); on native
    // once the overlay shows (onShown, below)
    if (Platform.OS === 'web') setTimeout(coveredNow, calm ? t.calm : t.fast);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // SMA-1b: a stage without a flight is held unseen until the session's data and its pictures are in (MorphOverlay, at
  // most morph.pictureCapMs); the row that opened it keeps its press until the stage has faded in over it, counted
  // from the moment the overlay shows, not from the mount (on a slow first open the row sprang back up to 230 ms
  // before the player's first frame, on a Train screen where nothing else had happened yet)
  const onShown = useCallback(() => { setTimeout(coveredNow, calm ? t.calm : t.fast); }, [calm]);
  const heroStyle = useAnimatedStyle(() => ({ opacity: heroIn.value }));
  useEffect(() => {
    const cap = calm ? 0 : flight.current === 'flying' ? t.morph + S.m69.phase2After : S.m69.phase2After;
    const timerId = setTimeout(() => setLevel((l) => Math.max(l, 2)), cap);
    return () => clearTimeout(timerId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const mediaStyle = useAnimatedStyle(() => ({ opacity: mediaIn.value }));

  // the cover: the picture the row showed (the first clip's poster, or the photo of the session's category); without a
  // flight the clips are drawn over it from the first frame, so a poster cover is drawn as the clips draw it
  const remembered = rememberedSession(id);
  const posterUri = coverKind === 'clip' ? serverUrl(remembered?.coverPosterUrl) : null;
  // the session's photo: the cover without a poster, and the poster cover's fallback when it cannot be drawn (T3-05)
  const photo = useMemo(() => (cat ? sessionPhoto([cat], id) : null), [cat, id]);
  const stock = posterUri ? null : photo;
  // the clips fade in over the landed photo once they have drawn (over a stock cover, after their poster's dissolve)
  useEffect(() => {
    if (level < 1 || !mediaWaits.current) return;
    mediaWaits.current = false;
    const raf = requestAnimationFrame(() => {
      const fade = withTiming(1, timing(t.base));
      mediaIn.value = posterUri ? fade : withDelay(motionValues.media.dissolveMs, fade);
    });
    return () => cancelAnimationFrame(raf);
  }, [level]); // eslint-disable-line react-hooks/exhaustive-deps
  // the first clip's poster starts decoding as soon as it is known (it is the picture the clips open on)
  const firstPoster = items[0]?.media?.posterUrl;
  useEffect(() => { warmPicture(firstPoster); }, [firstPoster]);

  const pages: ClipPage[] = useMemo(() => items.map((it) => ({ key: it.id, media: it.media, category: it.exerciseCategory, name: it.exerciseName })), [items]);
  const hero = useMemo(() => <MorphHero style={{ width: W, height: Hh, backgroundColor: fx.bg.deep }}><Animated.View style={[styles.media, { width: MW, left: (W - MW) / 2 }, heroStyle]}>
    {posterUri ? <RemotePhoto uri={posterUri} opacity={morphing === false ? 1 : COVER} fallbackSlot={photo?.slot} fallbackPick={photo?.pick} decorative style={StyleSheet.absoluteFill} />
      : stock ? <Photo slot={stock.slot} pick={stock.pick} opacity={COVER} decorative style={StyleSheet.absoluteFill} /> : null}
    <CopyProbe onCopy={onCopy} onGone={onLanded} />
    <Animated.View style={[StyleSheet.absoluteFill, mediaStyle]}>
      {pages.length && level >= 1 ? <NotInCopy still={<PageStill page={pages[index]} />}>
        <MediaPager pages={pages} index={index} onIndex={go} clip={clip} width={MW} height={Hh} cover={posterUri} />
      </NotInCopy> : null}
    </Animated.View>
  </Animated.View></MorphHero>, [W, Hh, MW, posterUri, photo, stock, morphing, onCopy, onLanded, mediaStyle, heroStyle, pages, index, go, clip, level]);

  const open = d?.programStatus === 'published';
  const state = d ? sessionState(d, d.today) : null;

  // what the last log sent (effort, minutes, sets ticked): once the session is logged here, a change saves itself
  const sentKey = useRef('');
  const [autoBusy, setAutoBusy] = useState(false);
  // the values of the last save that failed, and how: not reached (no answer, a timeout, the tunnel's error page) and
  // busy (rate limited, or the service's own error) are tried again quietly after `wait`; refused (the values, or a
  // closed programme) wait for the member's change. `said`: the member has been told of it (once)
  const failedKey = useRef<Failure | null>(null);
  // the form as last built from the session (a logged session opened again: its changes need 'Update log')
  const builtKey = useRef('');
  // how many sets the last log the service holds has (a background save never turns it into a log with none)
  const sentCount = useRef(0);
  // one save on its way at a time, so an older one can never reach the service after a newer one: a save asked for
  // meanwhile waits (`queued`: manual over background) and then goes with the member's values of that moment (saveRef:
  // the newest save)
  const inFlight = useRef(false);
  const queued = useRef<{ auto: boolean; emptyOk: boolean } | null>(null);
  // the member confirmed a log with no set in the 'No sets ticked' sheet (this visit): a leave is not refused for it
  const emptyOkRef = useRef(false);
  // the problem (a value the service would not take) last said while the member stays
  const problemShown = useRef('');
  /* Leaving (Done, Tell <coach>, Close, back, the pull-down). A logged session keeps no draft, so what the member left
     with either reaches the service or is said, once. `leave`: the values they left with and their problem; once no save
     is on its way, settleLeave decides: saved, nothing to say; a problem, a refusal, or a failure of those values since
     they left, 'not saved'; otherwise one more try of them, and 'not saved' if it fails. After leaving every save is a
     quiet one: settleLeave speaks for them all. */
  const left = useRef(false);
  const leave = useRef<{ key: string; tried: boolean; done: boolean; failed: string; said: boolean } | null>(null);
  // the values the member was last told were not saved as they left (one message, however many ways they leave)
  const leftKey = useRef('');
  const notSaved = (k: string, tx: string, tail = 'Your change was not saved.') => { if (leftKey.current === k) return; leftKey.current = k; toast.error(`${tx.replace(/[.\s]+$/, '')}. ${tail}`); };
  // a failure the member has not been told of yet, while they stay: said in the panel and a toast
  const say = (f: Failure) => { if (f.said) return; f.said = true; setMsg({ kind: 'error', text: f.text }); toast.error(f.text); };
  // a background or leaving save never sends a log with no set ticked (the service would record the whole session as
  // done), unless the log the service holds is itself one with none (confirmed in the sheet): the buttons ask first
  const emptyProblem = (sent: { sets: SetSent[]; problem: string }) => (!sent.problem && sent.sets.length === 0 && !(sentKey.current && sentCount.current === 0)
    ? (sentKey.current ? 'No set ticked: tap Update log to log the session without sets' : 'No set ticked') : '');
  const settleRef = useRef<() => void>(() => undefined);
  /** Logs the session (POST /complete; again: replaces the log). `auto`: a background update after the session is
   *  done (an effort chip, a duration, the note, a set): no spinner on the button and no message unless it fails, once.
   *  `fromQueue`: a save that waited for the one before it. `emptyOk`: a log with no set the member confirmed in the
   *  'No sets ticked' sheet (a queued 'Update log' is checked again when it goes: its sets may have changed meanwhile,
   *  SAVE8b-1) */
  const save = async (manual = true, fromQueue = false, emptyOk = false) => {
    if (!d) return;
    const auto = !manual || left.current; // once the member has left, settleLeave speaks
    if (!auto) setMsg(null);
    const sent = sentSets(d.items, rows, unit);
    const { sets } = sent;
    // (a log with no set the member confirmed in the sheet in this visit goes as they asked, in the background or as
    // they leave)
    const empty = (!manual || (fromQueue && !emptyOk)) && !emptyOkRef.current ? emptyProblem(sent) : '';
    const problem = sent.problem || formProblem(minutes, note) || empty;
    const key = formKey(rpe, minutes, note, sent);
    if (problem) {
      if (auto) return;
      // a queued 'Update log' whose sets were all unticked while it waited: asked first, as the button asks
      if (problem === empty) { haptics.warning(); setAskEmpty(true); return; }
      setMsg({ kind: 'error', text: problem }); toast.error(problem); problemShown.current = problem;
      return;
    }
    if (inFlight.current) {
      const q = queued.current;
      queued.current = { auto: auto && (q ? q.auto : true), emptyOk: !auto ? emptyOk : !!q?.emptyOk };
      if (!auto) setBusy(true);
      return;
    }
    if (fromQueue && auto) {
      if (key === sentKey.current) return; // what the save before it sent: nothing new
      // the same values just failed: said now if they were not, and tried again as that failure's kind allows
      const f = failedKey.current;
      if (f?.key === key) { if (!left.current) say(f); return; }
    }
    inFlight.current = true;
    if (auto) setAutoBusy(true); else setBusy(true);
    try {
      const r = await post<SessionDetail>(`/me/workouts/${id}/complete`, { sets, rpe, durationMinutes: minutes.trim() ? Number(minutes) : null, note: note.trim() || undefined });
      sentKey.current = key;
      sentCount.current = sets.length;
      failedKey.current = null;
      putDraft(draftKey(d.id, d.scheduledDate), null); // logged: the kept sets are the log now
      // the answer holds what was sent: the form is not built again from it, so what the member typed while it was on
      // its way (a duration, the note, a load) stays, and saves itself in turn (the rows are built again only when the
      // session changes another way: a coach's update, another device's log)
      builtFor.current = logKeyOf(r);
      s.setData(r);
      // one confirmation, the SESSION DONE panel (the button becomes its disc), never a toast over it or the timer;
      // the log ends the rest (its block fades out)
      setMsg(null);
      if (!auto) closeTimer(); // the member's own log ends the rest; a background save after it does not
      if (phaseRef.current === 'form') setFooterPhase('disc'); else if (!auto) haptics.success();
      invalidate(RELOAD_KEYS);
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      const kind = status === 0 ? 'unreached' : status === 429 || status >= 500 ? 'busy' : 'refused';
      const was = failedKey.current;
      // said once: the same values failed the same way before, or the service is still out of reach or busy (a new
      // kind of failure, such as a refusal after the service was out of reach, is said)
      const again = auto && !!was && was.said && was.kind === kind && (was.key === key || kind !== 'refused');
      failedKey.current = { key, kind, wait: status === 429 ? 60_000 : RETRY_MS, text: errorText(e), said: again };
      if (left.current) { if (leave.current?.key === key) leave.current.failed = errorText(e); }
      // a save waiting behind this one goes next with the member's newest values and speaks for both
      else if (!queued.current) say(failedKey.current);
    } finally {
      inFlight.current = false;
      const q = queued.current;
      queued.current = null;
      if (auto) setAutoBusy(false); else setBusy(false);
      // a waiting 'Update log' showed busy at once: off now, and on again only if it sends
      if (q && !q.auto) setBusy(false);
      if (q) void saveRef.current(!q.auto, true, q.emptyOk);
      if (left.current) settleRef.current();
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  settleRef.current = () => {
    const lv = leave.current;
    if (!lv || lv.done || inFlight.current) return;
    if (lv.key === sentKey.current) { lv.done = true; return; } // saved
    // judged now, against the log the service holds now (the first log may have been answered since the member left);
    // the values the member left with are this last render's
    const sent = d ? sentSets(d.items, rows, unit) : null;
    const f = failedKey.current;
    // the session holds a log: one sent here, or a log it was opened with (a failed 'Update log' leaves it as it was)
    const hasLog = !!sentKey.current || loggedRef.current;
    // what happened to those values comes first (sent and failed, or refused); then why they cannot be sent: a set's
    // numbers, or no set ticked (unless the member confirmed that in the sheet), then the duration or the note, where
    // a session with no log names why its first log did not go before a value typed after it (SAVE8-3)
    const setsWhy = sent ? sent.problem || (emptyOkRef.current ? '' : emptyProblem(sent)) : '';
    const formWhy = formProblem(minutes, note);
    const firstFailed = !hasLog && f && f.kind !== 'refused' ? f.text : '';
    const why = lv.failed || (f && f.key === lv.key && f.kind === 'refused' ? f.text : '') || setsWhy || (formWhy ? firstFailed || formWhy : '');
    if (why || lv.tried) {
      lv.done = true;
      // tried: a failure of these very values is said; with none recorded nothing made up is said (SAVE8b-3). The
      // session itself has no log (its first log failed or was never sent): said so; its ticks stay in its draft
      const text = why || (f && f.key === lv.key ? f.text : '');
      if (text && !lv.said) { lv.said = true; notSaved(lv.key, text, hasLog ? undefined : 'The session was not logged.'); }
      return;
    }
    // tried on the values it sends (a keystroke that reached the screen after the tap is part of the leave)
    lv.key = formKey(rpe, minutes, note, sent ?? { sets: [], problem: '' });
    lv.tried = true;
    void saveRef.current(false);
  };
  const skip = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await post<SessionDetail>(`/me/workouts/${id}/skip`, { reason: reason.trim() || undefined });
      s.setData(r); setSkipOpen(false); setMsg({ kind: 'success', text: 'Session skipped.' }); toast.info('Session skipped.'); invalidate(RELOAD_KEYS);
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  };

  const ticked = Object.values(rows).reduce((n, r) => n + r.filter((x) => x.done).length, 0);
  const total = Object.values(rows).reduce((n, r) => n + r.length, 0);
  finished.current = total > 0 && ticked === total;
  const row = d ?? remembered;
  const subtitle = row ? [`${weekday(row.scheduledDate)} ${dayMonth(row.scheduledDate)}`, `${row.itemCount} exercise${row.itemCount === 1 ? '' : 's'}`, `Version ${row.version}`].join(' · ') : undefined;
  const logged = d && (d.status === 'completed' || d.status === 'partial');
  loggedRef.current = !!logged;
  if (ticked > 0) emptyOkRef.current = false; // a set ticked since: an empty log is asked again
  minutesRef.current = minutes;
  const logTitle = logged ? 'Update log' : 'Log session';
  // with no set ticked the API records the whole session as completed, so that is said once before it is sent
  const onLog = () => { if (total > 0 && ticked === 0) { haptics.warning(); setAskEmpty(true); } else void save(true); };
  const afterDisc = useCallback(() => setFooterPhase('done'), []);

  const done = footerPhase === 'done';
  const onLogRef = useRef(onLog);
  onLogRef.current = onLog;
  const logNow = useCallback(() => onLogRef.current(), []);
  const askSkip = useCallback(() => { haptics.warning(); setSkipOpen(true); }, []);
  const hasFooter = !!d && open;
  const scheduled = d?.status === 'scheduled';

  // once the session is logged here, what the member changes after it (an effort chip, a duration, the note, a set or
  // its numbers) saves itself in the background, t.change after the last change and in an idle moment; the panel shows
  // it at once. A set whose numbers are not numbers yet waits (save sends nothing then)
  const autoKey = formKey(rpe, minutes, note, d ? sentSets(d.items, rows, unit) : { sets: [], problem: '' });
  const autoRef = useRef<() => void>(() => undefined);
  autoRef.current = () => { void save(false); };
  useEffect(() => {
    if (footerPhase === 'form' || busy || autoBusy || !sentKey.current) return;
    if (autoKey === sentKey.current) {
      // back to what the service holds: an error about other values no longer applies
      if (failedKey.current || msg?.kind === 'error') { failedKey.current = null; setMsg(null); }
      problemShown.current = '';
      return;
    }
    // a set, a duration or a note the service would not take: nothing is sent until it is fixed, and it is said once the
    // member has paused (t.change: not while a number is still being typed): a toast, where the member is looking (the
    // panel's message may be under the footer or the keyboard), and the panel
    const sentNow = d ? sentSets(d.items, rows, unit) : null;
    const problemNow = formProblem(minutes, note) || (sentNow ? sentNow.problem || emptyProblem(sentNow) : '');
    // the 'No sets ticked' sheet is asking already (a queued 'Update log' whose sets were all unticked): not said twice
    if (problemNow && askEmpty && sentNow && problemNow === emptyProblem(sentNow)) return;
    if (problemNow) {
      const said = setTimeout(() => {
        setMsg({ kind: 'error', text: problemNow });
        if (problemShown.current !== problemNow) { problemShown.current = problemNow; toast.error(problemNow); }
      }, t.change);
      return () => clearTimeout(said);
    }
    // the problem is fixed: its message goes (the save that follows says how it went)
    // (a failure of the values before it, still not put right, keeps its own message, quietly)
    if (problemShown.current) {
      if (msg?.text === problemShown.current) setMsg(failedKey.current ? { kind: 'error', text: failedKey.current.text } : null);
      problemShown.current = '';
    }
    // these values failed: refused ones wait for the member's change; the others are tried again, quietly, later
    const failed = failedKey.current?.key === autoKey ? failedKey.current : null;
    if (failed && failed.kind === 'refused') return;
    let cancelIdle: (() => void) | null = null;
    const timer = setTimeout(() => { cancelIdle = whenIdle(() => autoRef.current()); }, failed ? failed.wait : t.change);
    return () => { clearTimeout(timer); cancelIdle?.(); };
  }, [autoKey, footerPhase, busy, autoBusy]); // eslint-disable-line react-hooks/exhaustive-deps
  // leaving the player ('Done', 'Tell <coach>', Close, back, the pull down) never drops a change without a word (see
  // `leave`): Done's flush and the unmount's both come here, and settle once. `leaving` false: the app went to the
  // background (the player stays): a change still waiting for its background save is sent now (the phone may end the
  // app before the save's own timer would)
  const flushRef = useRef<(leaving: boolean) => void>(() => undefined);
  flushRef.current = (leaving) => {
    // the first log on its way counts as a log: a change typed meanwhile is sent after its answer
    const logging = inFlight.current && !sentKey.current;
    if (!sentKey.current && !logging) {
      // a logged session opened again: its changes are kept only by 'Update log' (said as the member leaves without it)
      if (leaving && loggedRef.current && builtKey.current && autoKey !== builtKey.current && d?.programStatus === 'published'
        && leftKey.current !== autoKey) { leftKey.current = autoKey; toast.info('Your change was not saved. Open the session and tap Update log to keep it.'); }
      return;
    }
    if (!leaving) { if (!logging && autoKey !== sentKey.current) void save(false); return; }
    // the leave starts: the focused field lets go (nothing more is typed into a closing player, and no field is still
    // focused as it unmounts), SAVE8b-3
    if (!left.current) Keyboard.dismiss();
    left.current = true;
    const prev = leave.current;
    // one leave a visit: values that reached the screen after it began (a keystroke still on its way at the tap) are
    // the same leave's, judged and tried again on them, so one leave never says 'not saved' twice
    if (!prev) leave.current = { key: autoKey, tried: false, done: false, failed: '', said: false };
    else if (prev.key !== autoKey) Object.assign(prev, { key: autoKey, tried: false, done: false, failed: '' });
    settleRef.current();
  };
  const flush = useCallback(() => flushRef.current(true), []);
  useEffect(() => () => flushRef.current(true), []);
  const minutesNow = minutes.trim() && Number.isInteger(Number(minutes)) && Number(minutes) >= 1 && Number(minutes) <= MAX_MINUTES ? Number(minutes) : null;
  // the sets a log holds (a ticked set whose numbers cannot be sent is not counted)
  const doneSets = done ? (d ? sentSets(d.items, rows, unit).sets.length : ticked) : 0, doneTotal = done ? total : 0;
  const doneEffort = done ? rpe : null, doneMinutes = done ? minutesNow ?? d?.durationMinutes ?? null : null;
  const donePartial = d?.status === 'partial';
  const coachName = d?.coachName ?? null;
  // memoised: a tick re-renders the footer only when what it shows changes
  const footer = useMemo(() => (hasFooter ? <View>
    <FlowSwap id={done ? 'done' : 'none'} timing={S.m72.swap}>
      {done ? <SessionDone sets={doneSets} total={doneTotal} partial={donePartial} effort={doneEffort} minutes={doneMinutes} /> : <View />}
    </FlowSwap>
    <FlowSwap id={done ? 'again' : 'bar'} timing={S.m72.swap}>
      {done ? <DoneActions morphKey={key} coach={coachName} title={logTitle} busy={busy} onUpdate={logNow} onLeave={flush} />
        : <LogBar phase={footerPhase} title={logTitle} busy={busy} showSkip={scheduled} nudge={nudge} onLog={logNow} onSkip={askSkip} onDisc={afterDisc} />}
    </FlowSwap>
  </View> : undefined), [hasFooter, done, doneSets, doneTotal, donePartial, doneEffort, doneMinutes, logTitle, busy, logNow, footerPhase, scheduled, askSkip, afterDisc, nudge, key, coachName, flush]);

  // the chips under the strip (the frame draws their words in the same places)
  const chips = useMemo<StripChip[]>(() => (current ? [
    { icon: 'clock', text: prescription(current) },
    ...(current.restSeconds ? [{ icon: 'timer' as const, text: `Rest ${secs(current.restSeconds)}` }] : []),
    ...(current.exerciseCategory ? [{ icon: categoryIcon(current.exerciseCategory), text: categoryLabel(current.exerciseCategory), color: categoryColor(current.exerciseCategory) }] : []),
  ] : []), [current]);
  // some exercises with a clip and some without: the strip holds the taller of the scrubber and the sentence on every
  // page, so Previous and Next never move (T2-21)
  const mixed = useMemo(() => items.some((it) => hasClip(it.media)) && items.some((it) => !hasClip(it.media)), [items]);
  // every page's name and place: the title holds the tallest of them (a name may take two lines), for the same reason
  const titles = useMemo(() => items.map((it, i) => ({ name: it.exerciseName, position: `${i + 1} / ${items.length}` })), [items]);
  const strip = useMemo(() => (current ? <ClipControls clip={clip} media={hasClip(current.media)} name={current.exerciseName} position={`${index + 1} / ${items.length}`}
    swapKey={current.id} dir={dir} arrive={morphing === true && stripFades} mixed={mixed} titles={titles}
    onPrev={index > 0 ? () => go(index - 1) : undefined} onNext={index < items.length - 1 ? () => go(index + 1) : undefined}>
    {chips.map((c) => <MetaChip key={c.text} icon={c.icon} text={c.text} color={c.color} />)}
  </ClipControls> : null), [current, chips, clip, index, items.length, dir, go, morphing, stripFades, mixed, titles]);
  const guide = useMemo<GuideContent | null>(() => (current ? {
    description: current.description, equipment: current.equipment, muscleGroups: current.muscleGroups, instructions: current.instructions, safetyNotes: current.safetyNotes,
    recs: [`${prescription(current)}${current.restSeconds ? `, with ${secs(current.restSeconds)} rest between sets` : ''}.`, current.loadNote ? `Load: ${current.loadNote}` : '', current.note ? `From your coach: ${current.note}` : ''].filter(Boolean),
  } : null), [current]);
  // the first frames (M69 fix round): the strip's and the guide's frames, drawn with plain views in the commit that
  // draws the hero, enter with the stage's content (from morph.contentAt), so the photo never lands over an empty body;
  // the strip, the clips and the guide replace them in place once the photo has landed, the sets after them. With the
  // session known they look as the strip and the guide will (CRT-3), so nothing changes at the swap
  const stripFrame = <ClipControlsFrame name={current?.exerciseName ?? null} position={current ? `${index + 1} / ${items.length}` : undefined}
    media={!current || hasClip(current.media)} pager={items.length > 1 || !current} prev={index > 0} next={index < items.length - 1}
    mixed={mixed} titles={titles} duration={current?.media?.durationSeconds ?? 0} chips={chips} />;

  return <>
    {current && level >= 1 ? clipHost : null}
    <MorphOverlay morphKey={key} fallback="/(tabs)/train" title={row?.title ?? 'Workout'} subtitle={subtitle} hero={hero} waiting={!d && s.loading} onClosing={flush} onShown={onShown}
      footer={level >= 1 ? footer : hasFooter ? <LogBarFrame title={logTitle} showSkip={scheduled} /> : undefined}>
      {level >= 1 && strip ? strip : stripFrame}
      <View style={styles.body}>
        {level >= 1 ? <StaleBanner at={s.stale} /> : null}
        {level >= 1 ? <ErrorState error={s.error} onRetry={s.reload} /> : null}
        {d ? <>
          <View style={styles.statusRow}>
            {state ? <Pill tone={state.tone}>{state.text}</Pill> : null}
            <T v="caption" color={fx.ink.a60} style={styles.flex}>{`${d.programTitle} · week ${d.week}${d.completedAt && logged ? ` · logged ${fmtDateTime(d.completedAt)}` : ''}`}</T>
          </View>
          {!open ? <Notice kind="info" title="This programme was closed">Your coach closed it. What you logged stays in your history and cannot be changed.</Notice> : null}
          {d.status === 'skipped' && open ? <Notice kind="info">{`You skipped this session${skipReasonSentence(d.skipReason)} You can still log it if you did it after all.`}</Notice> : null}
        </> : null}
        {level >= 2 && d ? <Body full={full} d={d} items={items} current={current} guide={guide} index={index} rows={rows} open={!!open} unit={unit} timer={timer}
          ticked={ticked} total={total} handTick={handTick} rpe={rpe} minutes={minutes} minutesGuessed={minutesGuessed} note={note} msg={msg} onAllDone={onAllDone}
          onRow={onRow} go={go} startTimer={startTimer} stopTimer={stopTimer} closeTimer={closeTimer} setRpe={setRpe} setMinutes={editMinutes} setNote={setNote} />
          : level >= 2 && s.loading ? <View style={styles.loading}><RingSpinner label="Loading the session" /></View>
            : guide ? <ExerciseGuideFrame content={guide} /> : null}
      </View>
    </MorphOverlay>
    <Sheet visible={askEmpty} onClose={() => setAskEmpty(false)} title="No sets ticked">
      <View style={styles.gap16}>
        <T v="body" color={fx.ink.a70}>Log it as completed without any sets?</T>
        <Button title={logTitle} icon="check" commit busy={busy} onPress={() => { setAskEmpty(false); emptyOkRef.current = true; void save(true, false, true); }} />
        <Button title="Tick my sets first" variant="ghost" full onPress={() => setAskEmpty(false)} />
      </View>
    </Sheet>
    <Sheet visible={skipOpen} onClose={() => setSkipOpen(false)} title="Skip this session?">
      <View style={styles.gap16}>
        <T v="body" color={fx.ink.a70}>{d ? `${d.title}, ${weekday(d.scheduledDate)} ${dayMonth(d.scheduledDate)}.` : ''}</T>
        <Field label="Reason (optional)"><Input size="sheet" value={reason} onChangeText={setReason} /></Field>
        <Button title="Skip session" variant="redGlass" busy={busy} onPress={skip} />
        <Button title="Keep it" variant="ghost" full onPress={() => setSkipOpen(false)} />
      </View>
    </Sheet>
  </>;
}

/** Inside the hero: tells the screen whether a copy of the photo is flying (it mounts inside the copy) and when that
 *  copy goes (one frame after the photo lands). Draws nothing. */
function CopyProbe({ onCopy, onGone }: { onCopy: () => void; onGone: () => void }) {
  const copy = useMorphCopy();
  useLayoutEffect(() => {
    if (!copy) return;
    onCopy();
    return () => onGone();
  }, [copy]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** The clips are drawn in the hero only, never in a flying copy of it: a copy draws `still` instead (the exercise on
 *  screen as a picture: the photo that flies home on a close is the one the member was looking at). The opening copy
 *  is taken before the clips mount, so it is the cover alone. */
function NotInCopy({ still, children }: { still: React.ReactNode; children: React.ReactNode }) {
  return useMorphCopy() ? <>{still}</> : <>{children}</>;
}

/** A page of the clips as a still picture (its poster, or its category's tile). */
function PageStill({ page }: { page: ClipPage | undefined }) {
  const poster = serverUrl(page?.media?.posterUrl);
  if (!page) return null;
  return poster ? <ExercisePoster uri={poster} category={page.category} size="hero" glyph={!hasClip(page.media)} style={StyleSheet.absoluteFill} />
    : <ExerciseTile category={page.category} size="hero" style={StyleSheet.absoluteFill} />;
}

/* ---------- the second phase: the guide, the feedback, the sets and the form ---------- */

type BodyProps = {
  /** The second commit of the body (UX-04): the feedback, the sets and the form under the guide. */
  full: boolean;
  d: SessionDetail; items: SessionItem[]; current: SessionItem | null; guide: GuideContent | null; index: number; rows: Record<string, SetRow[]>; open: boolean; unit: WeightUnit;
  timer: Timer | null; ticked: number; total: number; rpe: number | null; minutes: string; note: string; msg: { kind: 'success' | 'error'; text: string } | null;
  /** The duration was filled in from the time the player was open (the field says so). */
  minutesGuessed: boolean;
  /** The member's tick completed the session. */
  onAllDone: () => void;
  /** Set by the screen when the member ticks or unticks (not when a log fills the rows). */
  handTick: React.MutableRefObject<boolean>;
  onRow: (itemId: string, k: number, patch: Partial<SetRow>) => void; go: (i: number) => void; startTimer: (itemId: string, kind: 'rest' | 'work') => void;
  stopTimer: () => void; closeTimer: () => void; setRpe: (v: number | null) => void; setMinutes: (v: string) => void; setNote: (v: string) => void;
};

function Body({ full, d, items, current, guide, index, rows, open, unit, timer, ticked, total, handTick, rpe, minutes, minutesGuessed, note, msg, onAllDone, onRow: onRowUp, go, startTimer, stopTimer, closeTimer, setRpe, setMinutes, setNote }: BodyProps) {
  const scroll = useOverlayScroll();
  // the member's last tick or untick (ms): a scroll waits until the ticking has paused
  const lastTick = useRef(0);
  const onRow = useCallback((itemId: string, k: number, patch: Partial<SetRow>) => {
    if (patch.done !== undefined) lastTick.current = Date.now();
    onRowUp(itemId, k, patch);
  }, [onRowUp]);
  // a rest that starts is brought into view above the footer (it opens under the card's sets, often under the footer),
  // once the member's ticking has paused for t.settle: a member ticking set after set (logging after the session)
  // never has the next set glide away from under the finger, and each new tick waits again (its rest replaces this
  // one). Dropped when the member scrolls meanwhile, and when the countdown goes (the returned cancel). Reduced
  // motion waits the same, then moves at once
  const revealTimer = useCallback((node: unknown) => {
    const drags = scroll.drags();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = () => {
      const wait = lastTick.current + t.settle - Date.now();
      if (wait > 0) { timer = setTimeout(run, wait); return; }
      timer = null;
      if (scroll.drags() === drags) scroll.reveal(node as never, t.reveal);
    };
    run();
    return () => { if (timer) clearTimeout(timer); };
  }, [scroll]);
  // a rest that ran out points to the next set to tick (in its card, else in the cards after it): one red glow
  const live = useRef({ items, rows });
  live.current = { items, rows };
  const [point, setPoint] = useState<{ itemId: string; k: number; n: number } | null>(null);
  const onRestDone = useCallback((itemId: string) => {
    const { items: list, rows: now } = live.current;
    for (let i = Math.max(0, list.findIndex((x) => x.id === itemId)); i < list.length; i++) {
      const k = (now[list[i].id] ?? []).findIndex((r) => !r.done);
      if (k >= 0) { const at = list[i].id; setPoint((p) => ({ itemId: at, k, n: (p?.n ?? 0) + 1 })); return; }
    }
  }, []);
  const cards = useRef<Array<React.ComponentRef<typeof View> | null>>([]);
  const after = useRef<React.ComponentRef<typeof View> | null>(null);
  // a card's head brings its exercise to the player; the guide above changes, the card stays where it is on screen
  const onSelect = useCallback((i: number) => scroll.keep(cards.current[i] as never, () => go(i)), [scroll, go]);
  const up = useChangeDir(ticked);
  // the cards (below the fold when the body arrives) mount one per idle moment, then the form: no single long frame
  const count = useChunks(full ? items.length + 1 : 0);
  // the member's tick that completes the session brings 'After the session' into view (t.reveal, ease.inOut), where
  // the effort and the log are
  const lastTicked = useRef(ticked);
  useEffect(() => {
    const was = lastTicked.current;
    lastTicked.current = ticked;
    const byHand = handTick.current;
    handTick.current = false;
    if (!byHand || !open || total === 0 || ticked !== total || was >= total) return;
    closeTimer(); // nothing is left to rest for
    onAllDone();
    const raf = requestAnimationFrame(() => scroll.reveal(after.current as never, t.reveal));
    return () => cancelAnimationFrame(raf);
  }, [ticked, total]); // eslint-disable-line react-hooks/exhaustive-deps
  return <>
    {current && guide ? <ExerciseGuide resetKey={current.id} content={guide} /> : null}
    {full ? <Rise style={styles.gap20}>
      {(d.feedback ?? []).map((f) => <GlassCard key={f.id} rule={{ color: fx.red.brand }} style={styles.gap8}>
        <View style={styles.row8}><Icon name="message-square" size={14} color={fx.red.label} /><T v="overline">From your coach</T></View>
        <T v="body" color={fx.ink.a90}>{f.body}</T>
        <T v="caption" color={fx.ink.a50}>{`${f.coachName} · ${fmtDateTime(f.createdAt)}`}</T>
      </GlassCard>)}
      <ShiftHost>
        {items.length ? <View style={styles.gap12}>
          <H strong icon={<Icon name="list-checks" size={15} color={fx.red.label} />} right={<Roll value={`${ticked}/${total}`} up={up} distance={S.m73.digitRoll} ms={S.m73.digitMs}>
            {total > 0 && ticked === total ? <T v="caption" color={fx.hue.green400}>All sets done</T> : <T v="caption" color={fx.ink.a50}>{`${ticked} of ${total} sets ticked`}</T>}
          </Roll>} style={styles.h}>Your sets</H>
          {items.slice(0, count).map((it, i) => <View key={it.id} ref={(r) => { cards.current[i] = r; }} collapsable={false}>
            <Shifted order={i} resizes>
              <SetCard item={it} index={i} current={i === index} rows={rows[it.id] ?? EMPTY_ROWS} open={open} unit={unit}
                timer={timer && timer.itemId === it.id ? timer : null} onRow={onRow} onSelect={onSelect} onTimer={startTimer} onStopTimer={stopTimer} onTimerShown={revealTimer}
                onRestDone={onRestDone} pulse={point && point.itemId === it.id ? point : null} />
            </Shifted>
          </View>)}
        </View> : null}
        {open && count > items.length ? <Shifted order={items.length}>
          <View ref={after} collapsable={false}>
            <AfterSession rpe={rpe} minutes={minutes} minutesGuessed={minutesGuessed} note={note} msg={msg} setRpe={setRpe} setMinutes={setMinutes} setNote={setNote} />
          </View>
        </Shifted> : null}
        <Shifted order={items.length + 1} style={styles.gap20}>
          {items.some((it) => hasClip(it.media)) ? <P muted small>{CLIP_NOTE}</P> : null}
          <P muted small>Effort ratings and logs are what you record, never a measurement.</P>
        </Shifted>
      </ShiftHost>
    </Rise> : null}
  </>;
}
const EMPTY_ROWS: SetRow[] = [];

/** How many of `total` pieces to draw: one more in each idle moment after the first (all at once under reduced motion,
 *  where nothing moves that a long frame could stall). */
function useChunks(total: number): number {
  const { still } = useMotion();
  const [n, setN] = useState(1);
  useEffect(() => {
    if (still || n >= total) return;
    const w = globalThis as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
    if (w.requestIdleCallback) {
      const h = w.requestIdleCallback(() => setN((k) => k + 1), { timeout: t.premount });
      return () => w.cancelIdleCallback?.(h);
    }
    const timer = setTimeout(() => setN((k) => k + 1), 0);
    return () => clearTimeout(timer);
  }, [n, total]);
  return still ? total : Math.min(n, total);
}

const AfterSession = memo(function AfterSession({ rpe, minutes, minutesGuessed, note, msg, setRpe, setMinutes, setNote }: {
  rpe: number | null; minutes: string; minutesGuessed: boolean; note: string; msg: { kind: 'success' | 'error'; text: string } | null;
  setRpe: (v: number | null) => void; setMinutes: (v: string) => void; setNote: (v: string) => void;
}) {
  const { follow } = useOverlayScroll(); // the keyboard keeps the field being typed in in view
  return <GlassCard style={styles.gap16}>
    <T v="label">After the session</T>
    <Field label="Effort, 1 very light to 10 maximal (optional)">
      <EffortLadder value={rpe} onChange={setRpe} />
    </Field>
    <Field label="Duration in minutes (optional)" hint={minutesGuessed ? 'Filled in from the time this player was open. Change it if it is not right.' : undefined}>
      <Input keyboardType="number-pad" size="sheet" mono value={minutes} onChangeText={setMinutes} onFocus={() => follow('number')} />
    </Field>
    <Field label="Note for your coach (optional)" hint="Your coach sees your logs and notes only while you share health data with them."><Input multiline size="sheet" value={note} onChangeText={setNote} maxLength={MAX_NOTE} onFocus={() => follow('text')} style={styles.note} /></Field>
    {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
  </GlassCard>;
});

/* ---------- the footer: Log session, the disc, SESSION DONE ---------- */

const CHECK = 'M6.5 12.5 L10.5 16.5 L18 8.5'; // CheckPop's check in its 24-unit box
const CHECK_LEN = 16.7;
const AnimatedPath = Animated.createAnimatedComponent(Path);
type Box = { x: number; y: number; w: number; h: number };
/** The primary button's corner radius (the kit's auth shape). */
const BUTTON_RADIUS = fx.radius.xl;

/** Skip and Log session; after a successful log its button becomes the disc: the label fades out over
 *  S.m72.labelOutMs while the one background leaf (the same red, place and radius) shrinks to a S.m72.disc disc
 *  (width, height and radius of that leaf, S.m72.discMs expo; placed by translate), then the white check draws over
 *  S.m72.checkMs and the success haptic fires. `onDisc` follows S.m72.swapAfter later. */
function LogBar({ phase, title, busy, showSkip, nudge, onLog, onSkip, onDisc }: {
  phase: FooterPhase; title: string; busy: boolean; showSkip: boolean;
  /** Changes when every set has been ticked: the Log button gives one glow pulse (the consent button's m60 pulse:
   *  scale m60.pulse over m60.pulseMs, its red glow fading over m60.glowMs; tier C: the glow only; reduced motion: none). */
  nudge: number;
  onLog: () => void; onSkip: () => void; onDisc: () => void;
}) {
  const { calm, tier, inHtml } = useFx();
  const pulse = useSharedValue(0);
  const nudged = useRef(nudge);
  useEffect(() => {
    if (nudge === nudged.current) return;
    nudged.current = nudge;
    if (calm || phase !== 'form') return;
    pulse.set(withSequence(withTiming(1, timing(S.m60.pulseMs / 2, ease.css)), withTiming(0, timing(S.m60.glowMs, ease.css))));
  }, [nudge]); // eslint-disable-line react-hooks/exhaustive-deps
  const grow = tier === 'C' ? 0 : S.m60.pulse - 1;
  const pulseBox = useAnimatedStyle(() => (pulse.get() === 0 ? { transform: [] } : { transform: [{ scale: 1 + grow * pulse.get() }] }), [grow]);
  const pulseGlow = useAnimatedStyle(() => ({ opacity: pulse.get() }));
  // while it becomes the disc, the bar keeps the look it had when the log was sent (its spinner, its title)
  const frozen = useRef({ title, busy, showSkip });
  if (phase === 'form') frozen.current = { title, busy, showSkip };
  const look = phase === 'form' ? { title, busy, showSkip } : frozen.current;
  const [btn, setBtn] = useState<Box | null>(null);
  const [barW, setBarW] = useState(0);
  const shrink = useSharedValue(0); // the leaf: 0 the button's box … 1 the disc
  const label = useSharedValue(1); // the button's opacity
  const draw = useSharedValue(0); // the check
  const disc = phase !== 'form';
  const fade = calm || inHtml || tier === 'C';
  useEffect(() => {
    if (phase !== 'disc') return;
    const m = S.m72;
    const next = doneOnce(() => {
      haptics.success();
      setTimeout(onDisc, fade ? 0 : m.swapAfter);
    }, (fade ? t.fast : m.labelOutMs + m.checkMs) + motionValues.overlay.fallbackExtra);
    const drawn = (f?: boolean) => { 'worklet'; if (f) scheduleOnRN(next.done); };
    if (fade) {
      // crossfades and a static check
      const cfg = calm ? calmFade() : timing(t.fast, ease.linear);
      shrink.value = 1;
      draw.value = 1;
      label.value = withTiming(0, cfg, drawn);
    } else {
      label.value = withTiming(0, timing(m.labelOutMs, ease.linear));
      shrink.value = withTiming(1, timing(m.discMs));
      // the check draws once the label has gone (the disc is nearly round by then)
      draw.value = withDelay(m.labelOutMs, withTiming(1, timing(m.checkMs), drawn));
    }
    return () => next.cancel();
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps
  const D = S.m72.disc;
  const R0 = BUTTON_RADIUS;
  const from = btn;
  const leaf = useAnimatedStyle(() => {
    if (!from) return { opacity: 0 };
    const k = shrink.value;
    const w = from.w + (D - from.w) * k;
    const h = from.h + (D - from.h) * k;
    const x = from.x + ((barW - D) / 2 - from.x) * k;
    const y = from.y + (from.h - h) / 2;
    const r = R0 + (D / 2 - R0) * k;
    if (fade) return { width: D, height: D, borderRadius: D / 2, opacity: 1 - label.value, transform: [{ translateX: (barW - D) / 2 }, { translateY: from.y + (from.h - D) / 2 }] };
    return { width: w, height: h, borderRadius: r, opacity: 1, transform: [{ translateX: x }, { translateY: y }] };
  }, [from, barW, fade]);
  const rowStyle = useAnimatedStyle(() => ({ opacity: label.value }));
  const checkProps = useAnimatedProps(() => ({ strokeDashoffset: CHECK_LEN * (1 - draw.value) }));
  const onBtn = (e: LayoutChangeEvent) => { const l = e.nativeEvent.layout; if (l.width > 0 && l.height > 0) setBtn({ x: l.x, y: l.y, w: l.width, h: l.height }); };
  return <View style={styles.barBox} onLayout={(e) => { const w = e.nativeEvent.layout.width; if (w > 0) setBarW(w); }}>
    {disc && btn ? <Animated.View pointerEvents="none" style={[styles.leaf, leaf]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={D / 2} height={D / 2} viewBox="0 0 24 24">
        <AnimatedPath d={CHECK} stroke={fx.ink.white} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={`${CHECK_LEN} ${CHECK_LEN}`} animatedProps={checkProps} />
      </Svg>
    </Animated.View> : null}
    <Animated.View style={[styles.barRow, rowStyle]} pointerEvents={disc ? 'none' : 'auto'}>
      {look.showSkip ? <Button title="Skip" variant="ghost" onPress={onSkip} /> : null}
      <Animated.View style={[styles.flex, pulseBox]} onLayout={onBtn}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.logGlow, pulseGlow]} />
        <Button title={look.title} icon="check" commit busy={look.busy} onPress={onLog} />
      </Animated.View>
    </Animated.View>
  </View>;
}

/** Under SESSION DONE: 'Done' closes the player (the photo flies back to its row), 'Tell <coach> how it felt' closes it
 *  into the Coach tab, and 'Update log' logs again (what changed after the log also saves itself). Rendered inside the
 *  overlay's stage, so closing flies as the Close button does. `onLeave` first sends a change not saved yet. */
function DoneActions({ morphKey, coach, title, busy, onUpdate, onLeave }: { morphKey: string; coach: string | null; title: string; busy: boolean; onUpdate: () => void; onLeave: () => void }) {
  const closeOverlay = useOverlayClose(morphKey, '/(tabs)/train');
  const morphClose = useMorphClose(morphKey);
  const close = () => { onLeave(); closeOverlay(); };
  const toCoach = () => { onLeave(); morphClose(() => { if (router.canDismiss()) router.dismissTo('/(tabs)/coach'); else router.replace('/(tabs)/coach'); }); };
  const first = coach?.trim().split(/\s+/)[0] ?? '';
  return <View style={styles.gap8}>
    <Button title="Done" icon="check" onPress={close} />
    <View style={styles.doneLinks}>
      {first ? <Button title={`Tell ${first} how it felt`} variant="link" onPress={toCoach} /> : <View />}
      <Button title={title} variant="link" iconRight={null} busy={busy} onPress={onUpdate} />
    </View>
  </View>;
}

/** The footer's frame for the first frames (M69 fix round): LogBar's layout and look drawn with plain views (its
 *  check icon too, so the label never shifts), so the photo never lands over an empty footer; the bar replaces it in
 *  place once the photo has landed. Not touchable, not announced (the bar that works is the one that is announced). */
function LogBarFrame({ title, showSkip }: { title: string; showSkip: boolean }) {
  return <View style={styles.barBox} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
    <View style={styles.barRow}>
      {showSkip ? <View style={styles.skipFrame}><T v="section" color={fx.ink.white}>Skip</T></View> : null}
      <View style={[styles.flex, styles.logFrame]}>
        <Icon name="check" size={18} color={fx.ink.white} />
        <T v="button" color={fx.ink.white}>{title}</T>
      </View>
    </View>
  </View>;
}

/** The SESSION DONE card: the 64 pt check pops (a ring bursts at tier A), the title rises, the session's numbers count
 *  from 0 one after another. Tier C: a static check; reduced motion: at rest. */
function SessionDone({ sets, total, partial, effort, minutes }: { sets: number; total: number; partial: boolean; effort: number | null; minutes: number | null }) {
  const { calm, tier, inHtml } = useFx();
  const still = calm || inHtml;
  const [checked, setChecked] = useState(still || tier === 'C');
  useEffect(() => {
    if (checked) return;
    const raf = requestAnimationFrame(() => setChecked(true)); // mounted empty, then popped
    return () => cancelAnimationFrame(raf);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const m = S.m72;
  const rise = useSharedValue(still ? 1 : 0);
  const p0 = useSharedValue(still ? 1 : 0);
  const p1 = useSharedValue(still ? 1 : 0);
  const p2 = useSharedValue(still ? 1 : 0);
  useEffect(() => {
    if (still) return;
    rise.value = withTiming(1, tier === 'C' ? timing(t.fast, ease.linear) : timing(m.titleMs));
    [p0, p1, p2].forEach((p, i) => { p.value = withDelay(i * m.statsStep, withTiming(1, timing(m.statsMs, ease.cubicOut))); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const y = tier === 'C' ? 0 : m.titleY;
  const title = useAnimatedStyle(() => (rise.value >= 1 ? { opacity: 1, transform: [] } : { opacity: rise.value, transform: [{ translateY: y * (1 - rise.value) }] }));
  return <View style={styles.doneCard} accessible accessibilityLabel={`Session done${partial ? ', partly' : ''}. ${sets} of ${total} sets${effort != null ? `, effort ${effort} of 10` : ''}${minutes != null ? `, ${minutes} minutes` : ''}.`}>
    <CheckPop checked={checked} size={m.badge} burst={tier === 'A'} />
    <Animated.View style={title}><T v="display36" center accessibilityRole="header">Session done</T></Animated.View>
    <View style={styles.doneStats}>
      <DoneStat label="Sets" value={sets} suffix={`/${total}${partial ? ' · partly' : ''}`} progress={p0} />
      <View style={styles.vline} />
      <DoneStat label="Effort" value={effort} suffix={effort != null ? '/10' : undefined} progress={p1} />
      <View style={styles.vline} />
      <DoneStat label="Minutes" value={minutes} progress={p2} />
    </View>
  </View>;
}

/** One of the panel's numbers: it counts from 0 on its clock when the panel lands; a later change (an effort chip
 *  picked after the log) rolls the figure to the new one (S.m73.digitRoll over t.base, in the direction of change). */
function DoneStat({ label, value, suffix, progress }: { label: string; value: number | null; suffix?: string; progress: SharedValue<number> }) {
  const [first] = useState(value);
  const up = useChangeDir(value ?? 0);
  const changed = value !== first;
  return <View style={styles.doneStat}>
    <Roll value={`${value ?? '—'}${suffix ?? ''}`} up={up} distance={S.m73.digitRoll} ms={t.base}>
      <View style={styles.doneValue}>
        {changed ? <T style={styles.doneNumber}>{value == null ? '—' : String(value)}</T> : <CountUp value={value} progress={progress} style={styles.doneNumber} />}
        {suffix ? <T v="mono12" color={fx.ink.a60}>{suffix}</T> : null}
      </View>
    </Roll>
    <T v="micro" color={fx.ink.a60} style={styles.doneLabel}>{label}</T>
  </View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // the hero's media box (16:9 at most, centred: TAB-02)
  media: { position: 'absolute', top: 0, bottom: 0 },
  body: { width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 20, gap: 20 },
  loading: { paddingVertical: 48, alignItems: 'center' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  gap8: { gap: 8 },
  gap12: { gap: 12 },
  gap16: { gap: 16 },
  gap20: { gap: 20 },
  row8: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  h: { marginBottom: 0 },
  note: { minHeight: 72, textAlignVertical: 'top' },
  barBox: { minHeight: S.m72.disc, justifyContent: 'center' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: S.m72.disc },
  leaf: { position: 'absolute', left: 0, top: 0, backgroundColor: fx.red.brand, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  logGlow: { borderRadius: BUTTON_RADIUS, boxShadow: fx.shadow.ctaPressed },
  doneLinks: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, paddingHorizontal: 4 },
  doneCard: { alignItems: 'center', gap: 12, paddingVertical: 20, paddingHorizontal: 16, marginBottom: 12, borderRadius: fx.radius.card, borderWidth: 1, borderColor: fx.line.a05, backgroundColor: fx.glass.card },
  doneStats: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  doneStat: { flex: 1, minWidth: 0, alignItems: 'center', gap: 4 },
  doneValue: { flexDirection: 'row', alignItems: 'baseline', gap: 1 },
  doneNumber: { fontFamily: FONTS.mono700, fontSize: 20, lineHeight: 26, color: fx.ink.white },
  doneLabel: { letterSpacing: 2 },
  vline: { width: 1, alignSelf: 'stretch', backgroundColor: fx.line.a05, marginVertical: 4 },
  // the footer frame: the ghost Skip and the primary's box (radius 12, py 16, an 18 pt icon before the title)
  skipFrame: { borderRadius: fx.radius.pill, paddingVertical: 16, paddingHorizontal: 24, borderWidth: 1, borderColor: fx.line.a10, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  logFrame: { flexDirection: 'row', gap: 10, borderRadius: BUTTON_RADIUS, paddingVertical: 16, paddingHorizontal: 20, minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: fx.red.brand },
});
