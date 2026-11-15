/* The chrome of the two photo overlays Train opens with a PhotoMorph (the workout player and a library exercise,
   AMENDED §1 "Overlay transition"): the route is presented transparent with no native animation, so this screen
   draws everything itself inside the motion kit's MorphStage. The 16:9 media is the MorphHero (the photo flies there
   from the card or row that was tapped); the header, the content and the sticky footer are MorphContent (they enter
   once the photo is on its way). The header is the kit Overlay's: pt = top inset + 12, px 20, pb 16, a white/10 rule,
   the title (Montserrat 18/600) with its meta line at white/60, and the 36 pt round close. Closing flies the photo back
   to its card when that is still on screen (else a short fade), then goes back, or to Train when nothing is behind.
   Android's back button closes the same way.
   Motion v2 (M74): the stage is dismissible: a downward pull on the photo, or on the content while it is scrolled to
   its top (DismissArea), follows the finger and sends the photo back into its row (short of the line it springs back).
   The header registers its bottom edge with the toast host (useTopToastClearance), so a top toast never covers Close,
   and the footer its height (useToastClearance), so a quick confirmation pill sits above it. The content keeps room
   for the footer whatever it holds (the player's SESSION DONE card is taller than its button). useOverlayScroll lets
   the screen keep a block where it is on screen while something above it changes height (a card head selected under
   the guide), or bring one into view between the header and the footer (reveal: the offset glides on the UI thread,
   ease.inOut; reduced motion: at once).
   The first frame (T2-12): a stage that opens without a flight (tier C, reduced motion, a link, a notification, or a
   tap whose photo could not be measured) fades in from its first frame, but a picture is drawn a frame or more after it
   mounts (expo-image decodes it for the hero's own size), so the stage's first frame showed the hero as an empty dark
   box. On native such a stage is held unseen (a touch on it does nothing) until the pictures it holds from its first
   commits are drawn and the screen has its data (`waiting`), at most motionValues.morph.pictureCapMs after it mounts:
   its first frame shows the poster. When the hold ends after the stage's own fade has begun (the data came late: a
   first open over a slow link), the overlay fades in, never cuts in (SMA-1); the screen hears when it starts to show
   (onShown: the row that opened it keeps its press until the stage covers it, SMA-1b). With a flight nothing is held
   (the kit's copy waits for its own pictures, and the screen's frames are drawn for the landing). The web draws at once.
   The footer's fade band (FADE, above its solid ground) is drawn over the scroll's end but takes no touch: a drag or a
   tap that starts in it reaches the content under it (N7); the solid ground and the footer take touches as before.
   Gone (closed, or replaced), the overlay has a small phone collect the memory it held at the next quiet moment
   (src/fx/device/collect, T2-05). */
import { useIsFocused, type Href } from 'expo-router';
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Dimensions, Keyboard, Platform, StyleSheet, TextInput, View, type LayoutChangeEvent } from 'react-native';
import Animated, { scrollTo, useAnimatedReaction, useAnimatedRef, useAnimatedStyle, useScrollOffset, useSharedValue, withSequence, withTiming, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import { COLUMN, IconButton, MorphContent, MorphStage, Scrim, T, calmFade, closeOverlay, ease, fx, motionValues, t, timing, useMorphClose, useMotion } from '@/fx';
import { afterQuietFrames } from '@/fx/brand/MarkLayer';
import { collectWhenQuiet } from '@/fx/device/collect';
import { PictureGateContext, type PictureGate } from '@/fx/media/Photo';
import { DismissArea, useMorphStage } from '@/fx/motion/PhotoMorph';
import { useToastClearance, useTopToastClearance } from '@/fx/Toast';

const S = motionValues.screens;
/** The fade above the footer (pt). */
const FADE = 32;

export function useOverlayClose(morphKey: string, fallback: Href): () => void {
  const morphClose = useMorphClose(morphKey);
  return useCallback(() => morphClose(() => closeOverlay(fallback)), [morphClose, fallback]);
}

type Measurable = { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null;
type OverlayScroll = {
  /** Runs `change` and keeps `target` where it is on screen once the layout has followed (the content above it may grow
   *  or shrink). */
  keep: (target: Measurable, change: () => void) => void;
  /** Scrolls just enough to bring `target` into the band between the header and the footer, over `ms` (ease.inOut, on
   *  the UI thread); reduced motion: at once. */
  reveal: (target: Measurable, ms: number) => void;
  /** How many times the member has started to drag the content (a reveal waiting on the member's pause is dropped when
   *  the member scrolls in the meantime: the scroll is theirs then). */
  drags: () => number;
  /** A field of the overlay's own took focus (its onFocus), with the kind of keyboard it opens: it is the field the
   *  keyboard keeps in view, brought above the keyboard now when it is already up (a move from one field to another
   *  with the same keyboard sends no new keyboard event). A field in a sheet over the overlay never calls it, so the
   *  overlay never scrolls for one. */
  follow: (kind: 'number' | 'text') => void;
};
const OverlayScrollContext = createContext<OverlayScroll | null>(null);

/** The overlay's scroll anchoring (see the header); outside a MorphOverlay it just runs the change. */
export function useOverlayScroll(): OverlayScroll {
  return useContext(OverlayScrollContext) ?? NO_SCROLL;
}
const NO_SCROLL: OverlayScroll = { keep: (_t, change) => change(), reveal: () => undefined, drags: () => 0, follow: () => undefined };
/** The text field that has focus now, anywhere in the app (React Native's own record), or null. */
const focusedInput = (): Measurable => (TextInput.State as unknown as { currentlyFocusedInput?: () => Measurable } | undefined)?.currentlyFocusedInput?.() ?? null;

export function MorphOverlay({ morphKey, fallback, title, subtitle, hero, footer, waiting, onClosing, onShown, children }: {
  morphKey: string; fallback: Href; title: string; subtitle?: string; hero: React.ReactNode; footer?: React.ReactNode;
  /** The screen's data is still on its way (nothing known yet): a stage without a flight waits for it (see the header). */
  waiting?: boolean;
  /** Called as Close, Android's back or a pull's release starts the close (before its flight): the member is leaving. */
  onClosing?: () => void;
  /** Native, a stage without a flight: called once as the held overlay starts to show (its fade, when it fades in,
   *  starts then). Never called with a flight or on the web (nothing is held there). */
  onShown?: () => void;
  children?: React.ReactNode;
}) {
  const hold = useFirstFrameHold(!!waiting, onShown);
  // gone (closed, or replaced): its memory is collected at the next quiet moment on a small phone (T2-05)
  useEffect(() => () => collectWhenQuiet(), []);
  return <Animated.View collapsable={false} pointerEvents={hold.held ? 'box-only' : 'auto'} style={[StyleSheet.absoluteFill, hold.style]}>
    <PictureGateContext.Provider value={hold.gate}>
      <MorphStage morphKey={morphKey} dismissible onLeaving={onClosing}>
        <StageMode onMode={hold.onMode} />
        <Inner morphKey={morphKey} fallback={fallback} title={title} subtitle={subtitle} hero={hero} footer={footer} onClosing={onClosing}>{children}</Inner>
      </MorphStage>
    </PictureGateContext.Provider>
  </Animated.View>;
}

/** The stage's first-frame hold (see the header): `held` until every picture the screen holds the gate with has been
 *  drawn (or has failed, or gone) and `waiting` is over, at most morph.pictureCapMs from the mount; at once with a flight
 *  (`onMode('morph')`) and on the web. A picture that mounts once the hold is over holds nothing. `onShown`: a stage
 *  without a flight starts to show (at the release, or once frames come quietly for the calm crossfade). */
function useFirstFrameHold(waiting: boolean, onShown?: () => void): { held: boolean; style: ReturnType<typeof useAnimatedStyle>; gate: PictureGate | null; onMode: (mode: 'morph' | 'fade', entered: SharedValue<number> | null) => void } {
  const native = Platform.OS !== 'web';
  const { calm } = useMotion();
  const calmRef = useRef(calm);
  calmRef.current = calm;
  const [held, setHeld] = useState(native);
  // SMA-1: the overlay's opacity, 0 while held. The stage's own fade (tier C, calm, a link) starts once the hero's
  // pictures are drawn, which can be well before the hold ends (the session's data still on its way: a first open over
  // a slow link); shown whole at the release, that fade had played unseen and the player cut in. A release after the
  // stage's fade has begun (`entered`, the stage's content entrance, above 0) fades the overlay in instead, as the stage
  // fades (t.fast); a release before it, or with a flight, shows it at once, as before. Calm: the player builds its
  // whole body at once, so the release comes with that body's mount, which held the UI thread for 250-350 ms on a small
  // phone, and a calm crossfade started in it was drawn as one frame: it starts once frames come quietly
  // (morph.startFrames in a row, at most morph.pictureCapMs, as a flight starts), the overlay held until then.
  const shown = useSharedValue(native ? 0 : 1);
  const entered = useRef<SharedValue<number> | null>(null);
  const style = useAnimatedStyle(() => ({ opacity: shown.value }));
  const done = useRef(!native);
  const pending = useRef(0);
  const waitingRef = useRef(waiting);
  waitingRef.current = waiting;
  const quiet = useRef<(() => void) | null>(null);
  useEffect(() => () => { quiet.current?.(); quiet.current = null; }, []);
  const showNow = useCallback(() => { setHeld(false); onShown?.(); }, [onShown]);
  const calmIn = useCallback(() => {
    if (quiet.current) return;
    quiet.current = afterQuietFrames(motionValues.morph.startFrames, motionValues.morph.pictureCapMs, () => {
      quiet.current = null;
      scheduleOnUI(() => {
        'worklet';
        shown.value = withTiming(1, calmFade());
      });
      setHeld(false);
      onShown?.();
    });
  }, [shown, onShown]);
  const release = useCallback((flight: boolean) => {
    if (done.current) return;
    done.current = true;
    const e = entered.current;
    if (flight || !calmRef.current) {
      const ms = t.fast;
      scheduleOnUI(() => {
        'worklet';
        shown.value = e && e.value > 0 ? withTiming(1, timing(ms)) : 1;
      });
      setHeld(false);
      if (!flight) onShown?.();
      return;
    }
    scheduleOnUI(() => {
      'worklet';
      if (e && e.value > 0) { scheduleOnRN(calmIn); return; }
      shown.value = 1;
      scheduleOnRN(showNow);
    });
  }, [shown, calmIn, showNow, onShown]);
  const check = useCallback(() => { if (pending.current <= 0 && !waitingRef.current) release(false); }, [release]);
  const gate = useMemo<PictureGate | null>(() => (native ? {
    hold: () => {
      if (done.current) return () => undefined;
      pending.current += 1;
      let open = true;
      return () => { if (!open) return; open = false; pending.current -= 1; check(); };
    },
  } : null), [native, check]);
  const onMode = useCallback((mode: 'morph' | 'fade', stageIn: SharedValue<number> | null) => { entered.current = stageIn; if (mode === 'morph') release(true); }, [release]);
  // after the first commits (the pictures hold the gate in their layout effects, including those a screen's own layout
  // effect mounts before the first paint: the player's pager), so with nothing to wait for it goes a frame later
  useEffect(() => {
    if (done.current) return;
    check();
    if (done.current) return;
    const cap = setTimeout(() => release(false), motionValues.morph.pictureCapMs);
    return () => clearTimeout(cap);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // the data has come: the pictures it brings have held the gate in that commit
  useEffect(() => { if (!waiting) check(); }, [waiting, check]);
  return { held, style, gate, onMode };
}

/** Tells the hold how the stage opens (with a flight, 'morph', or a fade) and hands it the stage's content entrance. */
function StageMode({ onMode }: { onMode: (mode: 'morph' | 'fade', entered: SharedValue<number> | null) => void }) {
  const stage = useMorphStage();
  const mode = stage?.mode ?? 'fade';
  const entered = stage?.content ?? null;
  useLayoutEffect(() => { onMode(mode, entered); }, [mode, entered, onMode]);
  return null;
}

/** Inside the stage, so closing can fly the photo back. */
function Inner({ morphKey, fallback, title, subtitle, hero, footer, onClosing, children }: {
  morphKey: string; fallback: Href; title: string; subtitle?: string; hero: React.ReactNode; footer?: React.ReactNode; onClosing?: () => void; children?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const closeStage = useOverlayClose(morphKey, fallback);
  const closingRef = useRef(onClosing);
  closingRef.current = onClosing;
  const close = useCallback(() => { closingRef.current?.(); closeStage(); }, [closeStage]);
  const focused = useIsFocused();
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; });
    return () => sub.remove();
  }, [close]);
  // the web: the browser's own back leaves without Close; the member is leaving from that moment too, so a save that
  // fails on the way out is said as a leave's, once (as Close, Android's back and the pull do)
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onPop = () => { closingRef.current?.(); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  // the header's bottom edge (measured; the token until it has laid out) keeps the top toast lane below Close
  const [headerBottom, setHeaderBottom] = useState(0);
  useTopToastClearance(Math.max(headerBottom, insets.top + S.m74.headerH), focused);
  const [footerH, setFooterH] = useState(0);
  useToastClearance(footerH, !!footer && focused);
  // the keyboard: the photo routes keep the window's whole height (no KeyboardFit in the root stack: the stage, its
  // backdrop and its flights are drawn for the full screen), so on Android (edge to edge) and iOS the keyboard covered
  // the player's lower fields (a set's reps or load, the session's minutes and note) while the member typed in them.
  // While it is up the content keeps the keyboard's room at its end and the focused field is brought into view above
  // its top edge (reveal, below); the room goes when the keyboard does. The footer stays where it is, under the keyboard
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    // React Native's height leaves out Android's navigation bar, which the keyboard covers too (edge to edge)
    const nav = Platform.OS === 'android' ? insets.bottom : 0;
    const show = Keyboard.addListener('keyboardDidShow', (e) => setKeyboard(Math.max(0, Math.round((e.endCoordinates?.height ?? 0) + nav))));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(0));
    return () => { show.remove(); hide.remove(); };
  }, [insets.bottom]);
  // T4-21 and the close: while the stage's content is not at rest (its entrance, any close, every tier and calm) the
  // scroll ends where the footer's solid ground begins. The content and the footer fade as two layers, so the text
  // under the half-faded ground showed through it (the guide's last lines over 'Log session' and below it, frame after
  // frame of the fade); that strip is covered by the ground at rest, so cutting it while they fade shows nothing new.
  // On the UI thread with the stage's own value: the first frame of a close is already cut
  const stageNow = useMorphStage();
  const atRest = useSharedValue(1);
  const stageContent = stageNow?.content ?? atRest;
  const solidH = useSharedValue(0);
  useEffect(() => { if (!footer) solidH.value = 0; }, [footer, solidH]);
  const scrollClip = useAnimatedStyle(() => ({ marginBottom: stageContent.value < 1 ? solidH.value : 0 }));
  const onHeader = (e: LayoutChangeEvent) => { const l = e.nativeEvent.layout; if (l.height > 0) setHeaderBottom(Math.round(l.y + l.height)); };
  // the footer's ground: when the footer grows (the player's SESSION DONE card), its height snaps and the ground rises
  // to it from the old edge (t.base expo), behind the card fading in, so no black band jumps up the screen
  const { still } = useMotion();
  const rise = useSharedValue(0);
  const lastFooter = useRef(0);
  const onFooter = (e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height);
    if (!h) return; // a detached page reports 0
    const was = lastFooter.current;
    lastFooter.current = h;
    setFooterH(h);
    solidH.value = h;
    // the ground keeps its own height (anchored at the bottom) until the commit that grows it, which also lowers it
    // by the growth (a layout effect), so no frame shows it grown or lowered alone
    if (was && h > was && !still) pendingRise.current = h - was;
  };
  const pendingRise = useRef(0);
  useLayoutEffect(() => {
    const d = pendingRise.current;
    if (!d) return;
    pendingRise.current = 0;
    rise.value = withSequence(withTiming(d, { duration: 0 }), withTiming(0, timing(t.base)));
  }, [footerH, rise]);
  const groundH = footerH ? footerH + FADE : undefined;
  const ground = useAnimatedStyle(() => (rise.value === 0 ? { transform: [] } : { transform: [{ translateY: rise.value }] }));

  // the scroll: its offset for the pull-to-dismiss (only at the top) and for keeping a block in place
  const scroller = useAnimatedRef<Animated.ScrollView>();
  const scrollY = useScrollOffset(scroller);
  // a revealing scroll: the offset glides on the UI thread (the scroll follows it frame by frame)
  const auto = useSharedValue(0);
  const autoOn = useSharedValue(0);
  useAnimatedReaction(() => (autoOn.value === 1 ? auto.value : -1), (y) => { if (y >= 0) scrollTo(scroller, 0, y, false); });
  const dragCount = useRef(0);
  const onDrag = useCallback(() => { dragCount.current += 1; }, []);
  const edges = useRef({ top: 0, footer: 0, keyboard: 0 });
  edges.current = { top: Math.max(headerBottom, insets.top + S.m74.headerH), footer: footerH, keyboard };
  // the overlay's own frame in the window (the keyboard's top edge is measured from its bottom)
  const frame = useRef<React.ComponentRef<typeof View>>(null);
  const room = (footer ? Math.max(footerH + 16, 120) : 40) + insets.bottom;
  // while the keyboard is up the content ends with its room, so the last fields can be scrolled above it
  const endRoom = keyboard ? Math.max(room, keyboard + 24) : room;
  const endRoomRef = useRef(endRoom);
  endRoomRef.current = endRoom;
  // the overlay's own field the member is typing in (follow), while it still has focus
  const own = useRef<Measurable>(null);
  const typing = (): Measurable => { const f = focusedInput(); return f && f === own.current ? f : null; };
  /* Scrolls just enough to bring `target` into the band (see reveal). While the keyboard is up the band ends at
     whichever is higher, the keyboard's top edge or the footer's ground (the SESSION DONE card is taller than the
     keyboard); the field being typed in is never pushed out of the band by a reveal of something else (a rest that
     starts on a tick: it comes up only as far as the field allows), and `down` only scrolls the content up (a field
     that grew under the keyboard), never back to a field the member scrolled away from. */
  const move = (target: Measurable, ms: number, down: boolean) => {
    if (!target?.measureInWindow) return;
    const kb = edges.current.keyboard;
    const field = kb > 0 ? typing() : null;
    const guard = field && field !== target ? field : null;
    const go = (kbEnd: number | null, guardTop: number | null, guardH: number) => target.measureInWindow?.((_x, y, _w, h) => {
      if (!h) return;
      const winH = Dimensions.get('window').height;
      const top = edges.current.top + 8;
      const footerEnd = winH - (edges.current.footer ? edges.current.footer + FADE : insets.bottom + 40) - 8;
      const bottom = kbEnd == null ? footerEnd : Math.min(kbEnd, footerEnd);
      let d = y + h > bottom ? y + h - bottom : 0;
      if (y - d < top) d = y - top; // taller than the band: its top in view
      if (down && d <= 0) return;
      // only while any of that field shows below the header: one the member scrolled away (hidden above it) is not held
      if (guardTop != null && guardTop + guardH > edges.current.top) {
        if (d > 0) d = Math.min(d, Math.max(0, guardTop - top));
        else if (d < 0) d = Math.max(d, Math.min(0, guardTop + guardH - bottom)); // nor pushed under the keyboard
      }
      if (Math.abs(d) < 1) return;
      const to = Math.max(0, scrollY.value + d);
      if (still) {
        const sv = scroller.current as unknown as { scrollTo?: (o: { y: number; animated: boolean }) => void } | null;
        sv?.scrollTo?.({ y: to, animated: false });
        return;
      }
      auto.value = scrollY.value;
      autoOn.value = 1;
      // the last step lands the scroll itself (the reaction does not see the step that also clears the flag: under load
      // the glide would stop a frame short)
      auto.value = withTiming(to, { duration: ms, easing: ease.inOut }, (finished) => { 'worklet'; if (finished) scrollTo(scroller, 0, to, false); autoOn.value = 0; });
    });
    const guarded = (kbEnd: number | null) => {
      if (!guard?.measureInWindow) { go(kbEnd, null, 0); return; }
      guard.measureInWindow((_x, gy, _w, gh) => go(kbEnd, gh ? gy : null, gh));
    };
    if (kb > 0 && frame.current) frame.current.measureInWindow((_fx: number, fy: number, _fw: number, fh: number) => guarded(fh > 0 ? fy + fh - kb - 16 : null));
    else guarded(null);
  };
  const moveRef = useRef(move);
  moveRef.current = move;
  // the field being typed in, brought into view once what changed has been laid out (the commit, then its layout),
  // after `wait` ms when it waits for a keyboard event; a new job replaces the one waiting
  const soon = useRef<{ raf: number; timer: ReturnType<typeof setTimeout> | null }>({ raf: 0, timer: null });
  const stopSoon = () => {
    if (soon.current.raf) cancelAnimationFrame(soon.current.raf);
    if (soon.current.timer) clearTimeout(soon.current.timer);
    soon.current = { raf: 0, timer: null };
  };
  const later = (job: () => void, wait = 0) => {
    stopSoon();
    const frames = () => { soon.current.raf = requestAnimationFrame(() => { soon.current.raf = requestAnimationFrame(() => { soon.current.raf = 0; job(); }); }); };
    if (wait > 0) soon.current.timer = setTimeout(() => { soon.current.timer = null; frames(); }, wait);
    else frames();
  };
  useEffect(() => stopSoon, []);
  // the kind of keyboard the last field of the overlay's own opened; `keeping`: keep() is holding a block in place
  const ownKind = useRef<'number' | 'text' | null>(null);
  const keeping = useRef(0);
  const scroll = useMemo<OverlayScroll>(() => ({
    drags: () => dragCount.current,
    reveal: (target, ms) => moveRef.current(target, ms, false),
    follow: (kind) => {
      own.current = focusedInput();
      const was = ownKind.current;
      ownKind.current = kind;
      if (edges.current.keyboard <= 0) return; // the keyboard's own event brings it into view
      // the same keyboard: at once (two frames on). Another kind (the number pad to letters): its new height comes with
      // a keyboard event whose reveal replaces this one, so the field glides once, to its final place; this one runs
      // only when that height stays the same
      later(() => {
        const f = typing();
        if (f && edges.current.keyboard > 0) moveRef.current(f, t.base, false);
      }, was === kind ? 0 : t.morph);
    },
    keep: (target, change) => {
      if (!target?.measureInWindow) { change(); return; }
      keeping.current += 1;
      let held = true;
      const done = () => { if (held) { held = false; keeping.current -= 1; } };
      setTimeout(done, t.flow); // a target that went meanwhile never answers its measure
      target.measureInWindow((_x, before) => {
        change();
        // after the change has been laid out (two frames: the commit, then the layout it caused)
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (!target.measureInWindow) { done(); return; }
          target.measureInWindow((_x2, after) => {
            done();
            const d = after - before;
            if (Math.abs(d) < 1) return;
            const sv = scroller.current as unknown as { scrollTo?: (o: { y: number; animated: boolean }) => void } | null;
            sv?.scrollTo?.({ y: Math.max(0, scrollY.value + d), animated: false });
          });
        }));
      });
    },
  }), [scroller, scrollY]); // eslint-disable-line react-hooks/exhaustive-deps

  // the keyboard is up (or changed height): once its room is laid out, the field the member is typing in comes into
  // view above it (only the screen in front, only the overlay's own field; a field already in view does not move)
  useEffect(() => {
    if (!keyboard || !focused) return;
    later(() => { const f = typing(); if (f) moveRef.current(f, t.base, false); });
  }, [keyboard]); // eslint-disable-line react-hooks/exhaustive-deps
  // while the keyboard is up, the content grew or shrank (the note gains a line as the member types, a rest opens
  // above the field): the field being typed in is brought back above the keyboard when it went under it (t.fast).
  // The keyboard's own room is left out, so its coming and going does not count
  const inner = useRef(0);
  const onContentSize = useCallback((_w: number, h: number) => {
    const was = inner.current;
    inner.current = h - endRoomRef.current;
    // keep() is holding a block in place for this change (a card head selected): its own scroll follows
    if (!edges.current.keyboard || !focused || keeping.current > 0 || Math.abs(inner.current - was) < 1) return;
    later(() => { const f = typing(); if (f) moveRef.current(f, t.fast, true); });
  }, [focused]); // eslint-disable-line react-hooks/exhaustive-deps

  // the header renders again only when it changes (the screen re-renders on every tick of a set). On a wide screen its
  // row sits in the content's column (as the kit's OverlayHeader: TAB-04) and clear of a side cutout (TAB-09)
  const header = useMemo(() => <MorphContent>
    <View onLayout={onHeader} style={[styles.header, { paddingTop: insets.top + 12, paddingLeft: insets.left, paddingRight: insets.right }]}>
      <View style={styles.headerRow}>
        <View style={styles.titles}>
          {/* a third line before an ellipsis: 'Incline / Dumbbell Pre…' at 320 dp and text 2.0 */}
          <T v="heading" accessibilityRole="header" numberOfLines={3}>{title}</T>
          {subtitle ? <T v="caption" color={fx.ink.a60} style={styles.meta}>{subtitle}</T> : null}
        </View>
        <IconButton icon="x" label="Close" onPress={close} iconSize={18} />
      </View>
    </View>
  </MorphContent>, [title, subtitle, close, insets.top, insets.left, insets.right]); // eslint-disable-line react-hooks/exhaustive-deps
  return <OverlayScrollContext.Provider value={scroll}>
    <View ref={frame} collapsable={false} style={styles.fill}>
      {header}
      <DismissArea style={styles.fill} scrollY={scrollY}>
        <Animated.View style={[styles.fill, styles.clip, scrollClip]}>
          <Animated.ScrollView ref={scroller} style={styles.fill} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
            scrollEventThrottle={16} onScrollBeginDrag={onDrag} onContentSizeChange={onContentSize} contentContainerStyle={{ paddingBottom: endRoom }}>
            {hero}
            <MorphContent>{children}</MorphContent>
          </Animated.ScrollView>
        </Animated.View>
      </DismissArea>
      {footer ? <MorphContent pointerEvents="box-none" style={styles.footerWrap}>
        {/* the fade band passes touches to the scroll under it (N7); the solid ground keeps them, over its whole width
            (the footer's column is narrower on a wide screen), so nothing it covers can be touched */}
        <Animated.View pointerEvents="box-none" style={[groundH ? [styles.groundAt, { height: groundH }] : styles.ground, ground]}>
          <View pointerEvents="none" style={styles.fade}><Scrim kind="stickyCta" style={StyleSheet.absoluteFill} /></View>
          <View style={[styles.solid, styles.fill]} />
        </Animated.View>
        <View onLayout={onFooter} style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>{footer}</View>
      </MorphContent> : null}
    </View>
  </OverlayScrollContext.Provider>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  clip: { overflow: 'hidden' },
  header: { paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: fx.line.a10, backgroundColor: fx.bg.base },
  headerRow: { width: '100%', maxWidth: COLUMN, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20 },
  titles: { flex: 1, minWidth: 0 },
  meta: { marginTop: 2, fontSize: 12 },
  footerWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: FADE },
  ground: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  groundAt: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  fade: { height: FADE },
  solid: { backgroundColor: fx.bg.base },
  footer: { width: '100%', maxWidth: COLUMN, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 4 },
});
