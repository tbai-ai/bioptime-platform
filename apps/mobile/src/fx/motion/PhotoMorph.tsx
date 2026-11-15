/* PhotoMorph, The Lift (PREMIUM §1.3C as amended by CRITIQUE §17; motion v2 M44, M47, M51): a photo expands from where
   it was tapped into the hero of the screen it opens, and can be pulled back. Used by the two route overlays
   `workout/[id]` and `exercise/[id]` (opened from the Train coach-plan row, the Train library card, the Home
   next-session banner and the Home week cards) and by host sheets with a hero (openSheetWithMorph, src/fx/Sheet).
   How it works:
   1. The source photo is wrapped in <MorphSource morphKey>. `openWithMorph(key, navigate)` measures it on the UI thread,
      keeps its frame and radius for a moment, then navigates. The tap is answered at once (C02): in the same UI-thread
      step the source's picture zooms inside its own frame to morph.liftZoom over morph.liftMs (ease.expo), so the photo
      moves within a frame or two of the release while the route mounts; the opening copy starts from that zoom and
      eases it back to 1 over its flight, and the source is let go (at rest again) once the stage's ground covers it
      (the landing, or a fade's end; at most morph.liftHoldMs). No zoom under reduced motion. The web routes a painted
      frame after the zoom starts (its one thread would otherwise draw the route first).
   2. The destination (presented with animation 'none' and a transparent background) wraps its screen in
      <MorphStage morphKey>. Its hero photo is wrapped in <MorphHero>; the content under it in <MorphContent>.
   3. The copy: one clip view (the only node that changes size, animated on the UI thread by width, height and corner
      radius, placed by translate) on an opaque ground; inside it the hero's picture, drawn at the hero's own size and
      uniformly scaled to cover the clip (translate and scale only), so the crop always matches a cover crop and the
      corners stay round. It shows at the source's place from the stage's first frame (the source is still drawn
      under it until then) with the source's black/30 scrim, which fades over the first morph.scrimFadeMs. Once the
      hero has laid out it travels to the hero's frame over t.morph expo; the backdrop fades in over t.overlay; the
      content enters (opacity, y 10, t.flow) from morph.contentAt. The hero then shows and the copy goes a frame later.
      Native (M69): the copy shows only once its pictures are drawn (a picture gate, src/fx/media/Photo, at most
      morph.pictureCapMs; until then the source is what shows, never the copy's black ground), and the flight starts
      once frames come quietly after that (morph.startFrames, at most morph.quietCapMs), the backdrop and the content
      with it: the route's mount and the picture's first upload happen while the screen beneath is unchanged and the
      copy still sits on the source, not in the first frames of an expo flight, which hold most of its travel. (The
      route mounts on the same thread as the flight's frames on Android, so a flight started ahead of the mount on the
      root layer would stall in it all the same.) The native flight then runs on a stepped clock (each frame moves it
      on by its own time, at most morph.maxStepMs), with the ground and the content read off it: work that still
      stalls a frame pauses the flight there instead of skipping its travel. A stage whose hero never lays out opens in
      place.
      MorphHero always hands the copy its latest picture (the exercise on screen, not the first one).
   4. `useMorphClose()` closes: when the source is still on screen the stage's content and ground fade out at once
      (morph.contentOutMs, ease.exit) over the screen beneath, the hero staying where it is, and the source tile is
      emptied under the still-opaque stage (its photo is the one coming back). A copy of the hero is mounted on the
      root MorphLayer (drawn by SheetHost above the navigator) hidden; once its pictures are drawn and the fade is
      morph.closeFlyAt of the way through (the flight overlaps the fade's second half, so the exit stays shorter than the
      entrance), in one UI frame the copy shows, the hero hides and the copy flies t.exitMorph ease.drawer to the source,
      the scrim back in over the last morph.scrimFadeMs, crossfading into the source (shown again) over the last
      morph.crossfadeLast. No frame shows neither the hero nor the copy, and the copy never flies over the opaque
      screen. The route goes back once the copy has landed (the stage is invisible from the copy's first frame and
      lets touches through), so its unmount, however late, is never seen and never stalls the flight. A pull's
      release flies at once (the content fades with it). A second close (Android back during the flight) is ignored.
      Otherwise a 200 ms fade (opacity, y 10), then back.
   5. `dismissible` (M47): a downward pull on the hero, or inside <DismissArea> while its scroll is at the top, follows
      the finger (y × dismiss.follow, scale, corner radius, the backdrop dims); let go past dismiss.distance or faster
      than dismiss.velocity and the photo flies back to its source from where it is (or the overlay slides down when
      the source is off screen); short of that it springs back.
   A source may say how the photo comes home to it (`home`, FU-m5: Home's next-session banner, whose photo is not the
      picture the player shows and whose title is drawn over its photo): `picture` is the source's own photo, which the
      flying copy crossfades into over the first morph.homeBlendBy of the flight, so it lands as that photo, never
      swapping photos at the landing; `over` is what the source draws above its photo (its words), drawn on the layer
      above the copy at the source's frame from the moment the copy reaches it (morph.homeWordsFrom … homeWordsTo of
      the flight), so the photo comes home under them. Every other source flies exactly as before.
   Without a morph (a deep link, a notification, History) the stage simply fades in, its hero with it. Tier C: a 200 ms
   fade (and a drag moves the hero without scaling it); calm: a 150 ms crossfade, no follow (a downward flick closes
   with it). While the hero is pulled the content dims to dismiss.contentMin.
   `useMorphStage()` tells what is inside a stage its mode ('morph' or 'fade'), `landed` (1 once the hero shows at home:
   the flight's landing, or from the first frame of a fade) and the content's entrance (0 → 1). */
import { router } from 'expo-router';
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Dimensions, Platform, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { ReduceMotion, cancelAnimation, useAnimatedReaction, useAnimatedRef, useAnimatedStyle, useDerivedValue, useFrameCallback, useSharedValue, withDelay, withSpring, withTiming, type AnimatedRef, type SharedValue } from 'react-native-reanimated';
import { measureView } from './measured';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import { fx } from '@/theme';
import { afterQuietFrames } from '../brand/MarkLayer';
import { haptics } from '../device/haptics';
import { PictureGateContext, type PictureGate } from '../media/Photo';
import { PageActiveContext } from '../nav/pageReady';
import { doneOnce } from './once';
import { calmFade, ease, motionValues, spring, t, timing } from './tokens';
import { useMotion } from './tier';

export type MorphFrame = { x: number; y: number; w: number; h: number };
type Frame = MorphFrame;
type Pending = { key: string; frame: Frame; radius: number; at: number; hide: SharedValue<number> | null; lift: SharedValue<number> | null };
type Box = { W: number; H: number };
/** z: the picture's zoom inside the clip (1 at rest; the opening copy starts at the source's lift). */
type Geom = { x: number; y: number; w: number; h: number; r: number; o: number; s: number; z?: number };
type EaseName = 'expo' | 'drawer';
type PanGesture = ReturnType<typeof Gesture.Pan>;

const mm = motionValues.morph;
const dm = motionValues.dismiss;
const WEB = Platform.OS === 'web';
const FRESH_MS = 1500;
const ZERO: Frame = { x: 0, y: 0, w: 0, h: 0 };
/** The close's own timings play regardless of what reanimated read at launch (G3-1). Reanimated reads the OS reduced-motion
 *  setting once, when the app starts (ReduceMotion.System keeps that value), while the kit's calm follows the setting as
 *  it changes (src/motion/useReduceMotion). An app started with animations off and turned back on closed with calm
 *  false, so it chose the flight, but every System timing landed on its first frame: the content cut out in one frame,
 *  the hero held, and the flight's clock ended at once (the copy at its end, transparent; the route back), with the row
 *  empty until then. The close follows the kit's own choice instead: the motion it chose plays (Never), and calm keeps
 *  its crossfade (calmFade, Never). */
const PLAYED = { reduceMotion: ReduceMotion.Never } as const;

/** Runs a measuring job on the UI thread; on the web (one thread) at once, saving the frame a hop would cost. */
function onUI(job: () => void) {
  if (Platform.OS === 'web') job();
  else scheduleOnUI(job);
}

/* ---------- the source side ---------- */

/* One key can have several sources at once (Home's week shelf and Train's coach-plan row both show a session, on two
   pages the pager keeps mounted). Every one is kept; a measure takes the latest one on the page in front that is on
   screen, else the latest on screen (outside the pager a source counts as in front). */
type Source = { ref: AnimatedRef<View>; radius: number; active: SharedValue<number> | null; hide: SharedValue<number>; lift: SharedValue<number>; calm: boolean; home: { current: MorphHome | null } };
/** How the photo comes home to a source (see the header): its own picture, and what it draws above its photo. */
export type MorphHome = { picture?: () => React.ReactNode; over?: () => React.ReactNode };
type Actives = Array<SharedValue<number> | null>;
type Picked = { i: number; frame: Frame | null };
/** A measured source: its frame, its corner radius and its hide value (1: the photo is away, flying or in a sheet). */
export type MorphSourceFrame = { frame: Frame; radius: number; hide: SharedValue<number> | null; ref: AnimatedRef<View> | null };
const sources = new Map<string, Source[]>();
let pending: Pending | null = null;
let sheetPending: Pending | null = null;

export function MorphSource({ morphKey, radius = 0, children, style, home }: { morphKey: string; radius?: number; children: React.ReactNode; style?: StyleProp<ViewStyle>; home?: MorphHome }) {
  const ref = useAnimatedRef<View>();
  const homeRef = useRef<MorphHome | null>(home ?? null);
  homeRef.current = home ?? null;
  const active = useContext(PageActiveContext);
  const { calm } = useMotion();
  // 1 while its photo is away (a copy flying, a sheet's hero holding it): the tile shows its empty slot, never two photos
  const hide = useSharedValue(0);
  // 0 … 1: the tap's answer, the picture zooming inside the tile's frame (openWithMorph; let go by the stage)
  const lift = useSharedValue(0);
  useEffect(() => {
    const me: Source = { ref, radius, active, hide, lift, calm, home: homeRef };
    sources.set(morphKey, [...(sources.get(morphKey) ?? []), me]);
    return () => {
      const left = (sources.get(morphKey) ?? []).filter((s) => s !== me);
      if (left.length) sources.set(morphKey, left);
      else sources.delete(morphKey);
    };
  }, [morphKey, radius, ref, active, hide, lift, calm]);
  const shown = useAnimatedStyle(() => ({ opacity: 1 - hide.get() }));
  const zoom = useAnimatedStyle(() => {
    const l = lift.get();
    return l <= 0 ? { transform: [] } : { transform: [{ scale: 1 + (mm.liftZoom - 1) * l }] };
  });
  // the tile's frame clips the zoom (a plain rectangle: the card around it already rounds its corners), so the picture
  // grows inside the tile, never past the card's edge
  return <Animated.View ref={ref} testID="fx-morph-source" style={[style, styles.sourceClip, shown]} collapsable={false}>
    <Animated.View collapsable={false} style={[styles.sourceZoom, zoom]}>{children}</Animated.View>
  </Animated.View>;
}

/** The sources for `key`, latest first, as plain arrays a worklet can take. */
function sourceList(key: string): { refs: AnimatedRef<View>[]; actives: Actives; radii: number[]; hides: SharedValue<number>[]; lifts: SharedValue<number>[]; calms: boolean[]; homes: Array<{ current: MorphHome | null }> } {
  const list = [...(sources.get(key) ?? [])].reverse();
  return { refs: list.map((s) => s.ref), actives: list.map((s) => s.active), radii: list.map((s) => s.radius), hides: list.map((s) => s.hide),
    lifts: list.map((s) => s.lift), calms: list.map((s) => s.calm), homes: list.map((s) => s.home) };
}

/** On the UI thread: the index of the source to fly from or to (-1: none on screen) and its frame. */
function pickSource(refs: AnimatedRef<View>[], actives: Actives, width: number, height: number): Picked {
  'worklet';
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < refs.length; i++) {
      const a = actives[i];
      if (pass === 0 && a && a.get() < 1) continue;
      const m = measureView(refs[i]);
      if (m && m.width > 0 && m.height > 0 && m.pageY + m.height > 0 && m.pageY < height && m.pageX + m.width > 0 && m.pageX < width) {
        return { i, frame: { x: m.pageX, y: m.pageY, w: m.width, h: m.height } };
      }
    }
  }
  return { i: -1, frame: null };
}

function measureSource(key: string, done: (src: MorphSourceFrame | null, lift: SharedValue<number> | null) => void, liftIt = false) {
  const { refs, actives, radii, hides, lifts, calms } = sourceList(key);
  if (!refs.length) { done(null, null); return; }
  const { height, width } = Dimensions.get('window');
  const picked = (i: number, frame: Frame | null, lifted: boolean) => done(
    frame && i >= 0 ? { frame, radius: radii[i] ?? 0, hide: hides[i] ?? null, ref: refs[i] ?? null } : null,
    lifted ? lifts[i] ?? null : null);
  const liftMs = mm.liftMs;
  onUI(() => {
    'worklet';
    const p = pickSource(refs, actives, width, height);
    // the tap's answer, in the same UI step as the measure: the picture starts to zoom in its frame now
    const l = liftIt && p.i >= 0 && !calms[p.i] ? lifts[p.i] : null;
    if (l) l.set(withTiming(1, timing(liftMs, ease.expo)));
    scheduleOnRN(picked, p.i, p.frame, !!l);
  });
}

/** Lets a source's lift go (back to rest), at once or over morph.liftMs. */
function dropLift(lift: SharedValue<number> | null | undefined, now = true) {
  if (!lift) return;
  if (now) { cancelAnimation(lift); lift.set(0); } else lift.set(withTiming(0, timing(mm.liftMs, ease.css)));
}

/** Measures the source photo for `key` (its picture zooms in its frame at once: the tap's answer), then navigates;
 *  the web after a painted frame. Without a source (or off screen) it just navigates. */
export function openWithMorph(key: string, navigate: () => void) {
  measureSource(key, (src, lift) => {
    pending = src ? { key, frame: src.frame, radius: src.radius, at: Date.now(), hide: src.hide, lift } : null;
    // a lift no stage took (the route refused, a stage that never mounted) is let go after a while
    if (lift) setTimeout(() => dropLift(lift, false), mm.liftHoldMs);
    if (WEB && lift) requestAnimationFrame(() => { setTimeout(navigate, 0); });
    else navigate();
  }, true);
}

/** The pending morph for `key`, without taking it: a render may be thrown away (a route still loading suspends its
 *  first render), so the stage takes it once it has mounted. */
function peekPending(key: string): Pending | null {
  const p = pending;
  return !p || p.key !== key || Date.now() - p.at > FRESH_MS ? null : p;
}

/** For host sheets (src/fx/Sheet openSheetWithMorph): measures the source for `key`, then opens the sheet, whose hero
 *  takes the photo (takeSheetMorph). */
export function prepareSheetMorph(key: string, open: () => void): void {
  measureSource(key, (src) => {
    sheetPending = src ? { key, frame: src.frame, radius: src.radius, at: Date.now(), hide: src.hide, lift: null } : null;
    open();
  });
}

/** The photo a sheet opened with openSheetWithMorph flies from (taken once, fresh for a moment). */
export function takeSheetMorph(): { key: string; frame: Frame; radius: number; hide: SharedValue<number> | null } | null {
  const p = sheetPending;
  sheetPending = null;
  return p && Date.now() - p.at <= FRESH_MS ? p : null;
}

/** Measures the source for `key` on screen now (null when gone or off screen), with its corner radius. */
export function measureMorphSource(key: string, done: (src: MorphSourceFrame | null) => void): void {
  measureSource(key, (src) => done(src));
}

/* ---------- the copy: one clip node, a cover-scaled picture inside ---------- */

const MorphCopyContext = createContext(false);

/** True inside a copy of a photo (the opening copy and the root layer's flights). A live picture there (a playing
 *  video) draws its poster or still frame, never a second view of the same player: on the web a second <video> of one
 *  expo-video player pauses the first when it unmounts, and on native a player has only one surface. */
export function useMorphCopy(): boolean {
  return useContext(MorphCopyContext);
}

/** The opacity (0 … 1) of the controls drawn over a hero a photo flies into (a sheet hero's close button): 0 while the
 *  copy flies, faded in over morph.chromeInMs once it has landed. Null outside such a hero. The kit's IconButton reads
 *  it (and draws nothing inside a copy), so a control never travels with the photo or pops in before it lands. */
export const MorphChromeContext = createContext<SharedValue<number> | null>(null);
export function useMorphChrome(): SharedValue<number> | null {
  return useContext(MorphChromeContext);
}

/** The web: a copy shows once the browser has drawn its pictures (a remounted image takes a frame or two even from the
 *  cache), at most motionValues.media.dissolveMs later; until then the source under it is what shows. Native draws a
 *  cached image on its first frame. */
function useDrawn(wait: boolean, onDrawn?: () => void): { ref: React.RefObject<React.ComponentRef<typeof Animated.View> | null>; drawn: SharedValue<number> } {
  const ref = useRef<React.ComponentRef<typeof Animated.View> | null>(null);
  const drawn = useSharedValue(Platform.OS === 'web' && wait ? 0 : 1);
  const told = useRef(onDrawn);
  told.current = onDrawn;
  useLayoutEffect(() => {
    if (Platform.OS !== 'web' || !wait) return;
    const el = ref.current as unknown as HTMLElement | null;
    const ok = () => { drawn.set(1); told.current?.(); };
    if (!el || typeof el.querySelectorAll !== 'function') { ok(); return; }
    const done = () => Array.from(el.querySelectorAll('img')).every((i) => i.complete && i.naturalWidth > 0);
    if (done()) { ok(); return; }
    const check = () => { if (done()) { stop(); ok(); } };
    const timer = setTimeout(() => { stop(); ok(); }, motionValues.media.dissolveMs);
    const stop = () => { clearTimeout(timer); el.removeEventListener('load', check, true); };
    el.addEventListener('load', check, true);
    return stop;
  }, [drawn, wait]);
  return { ref, drawn };
}

function ClipCopy({ geom, box, scrim = true, wait = false, shown, onDrawn, children }: { geom: SharedValue<Geom>; box: SharedValue<Box>; scrim?: boolean; wait?: boolean;
  /** Native: 0 until the copy's pictures are drawn (the stage's picture gate). */
  shown?: SharedValue<number>;
  /** The web: called once the copy's pictures are drawn (with `wait`). */
  onDrawn?: () => void; children: React.ReactNode }) {
  const { ref, drawn } = useDrawn(wait, onDrawn); // a copy waits for its pictures (what it covers shows meanwhile)
  const always = useSharedValue(1);
  const vis = shown ?? always;
  const clip = useAnimatedStyle(() => {
    const g = geom.get();
    return { width: g.w, height: g.h, borderRadius: g.r, opacity: g.o * drawn.get() * vis.get(), transform: [{ translateX: g.x }, { translateY: g.y }] };
  });
  const inner = useAnimatedStyle(() => {
    const g = geom.get();
    const b = box.get();
    const s = Math.max(g.w / Math.max(1, b.W), g.h / Math.max(1, b.H)) * (g.z ?? 1);
    return { width: b.W, height: b.H, transform: [{ translateX: (g.w - b.W) / 2 }, { translateY: (g.h - b.H) / 2 }, { scale: s }] };
  });
  const shade = useAnimatedStyle(() => ({ opacity: geom.get().s }));
  return <Animated.View ref={ref} pointerEvents="none" testID="fx-morph-copy" style={[styles.clip, clip]}
    accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
    <Animated.View style={[styles.inner, inner]}><MorphCopyContext.Provider value>{children}</MorphCopyContext.Provider></Animated.View>
    {scrim ? <Animated.View style={[StyleSheet.absoluteFill, styles.shade, shade]} /> : null}
  </Animated.View>;
}

/* ---------- the root layer (SheetHost draws it above the navigator and the sheets) ---------- */

export type LayerFlight = {
  id: number;
  render: () => React.ReactNode;
  box: Box;
  from: Frame; fromRadius: number;
  to: Frame; toRadius: number;
  /** Added to the target's y on every frame (a sheet still rising). */
  follow?: SharedValue<number>;
  duration: number; easing: EaseName;
  /** The source's black/30 scrim: 'in' fades it out over the first morph.scrimFadeMs, 'out' back in over the last. */
  scrim: 'in' | 'out' | null;
  /** The copy crossfades into the source over the last `fadeLast` ms (0: it stays opaque and goes a frame after landing). */
  fadeLast: number;
  /** The closing overlay's ground, fading out (ease.css) over `backdropMs`. */
  backdrop: string | null; backdropMs: number;
  onLand?: () => void;
  /** The copy is mounted hidden and waits for its pictures (native: the picture gate, at most morph.pictureCapMs; the
   *  web: its images drawn, at most media.dissolveMs) and for `startWhen` to be 1; then, in one UI frame, it shows,
   *  `handOver` (what it replaces: a hero) goes to 0, the source hides and its clock starts. Without `hold` it shows
   *  and flies from its first frame. */
  hold?: boolean;
  startWhen?: SharedValue<number> | null;
  handOver?: SharedValue<number> | null;
  /** The source photo: hidden (1) from the start frame; `restore` shows it again (0) as the crossfade into it begins
   *  (or at the landing without one), and if the flight goes before that. */
  source?: { hide: SharedValue<number>; restore: boolean } | null;
  /** JS, once the copy has started (shown and flying). */
  onShown?: () => void;
  /** The destination measured again on every frame of the flight (the source under a closing sheet, whose page
   *  returns from its recede meanwhile; a tile whose page moved): the copy lands where it is, not where it was. */
  track?: AnimatedRef<View> | null;
  /** The source's own picture (MorphHome.picture): the copy crossfades into it over the first morph.homeBlendBy of the
   *  flight, so it lands as the source's photo. */
  blend?: (() => React.ReactNode) | null;
  /** What the source draws above its photo (MorphHome.over), drawn above the copy at the destination's frame from the
   *  copy's first frame to its last, so the photo lands under it. */
  over?: (() => React.ReactNode) | null;
};
let flights: LayerFlight[] = [];
let flightSeq = 0;
const flightListeners = new Set<() => void>();
const subscribeFlights = (l: () => void) => { flightListeners.add(l); return () => { flightListeners.delete(l); }; };
const flightSnapshot = () => flights;
function endFlight(id: number) { flights = flights.filter((f) => f.id !== id); flightListeners.forEach((l) => l()); }

/** Flies a copy of a photo on the root MorphLayer (above the navigator and the sheets). Returns its id. */
export function flyOnLayer(f: Omit<LayerFlight, 'id'>): number {
  const id = ++flightSeq;
  flights = [...flights, { ...f, id }];
  flightListeners.forEach((l) => l());
  return id;
}

/** The root layer of photo flights. Rendered by SheetHost, last, above the sheet layers (no separate mount). */
export function MorphLayer(): React.JSX.Element | null {
  const list = useSyncExternalStore(subscribeFlights, flightSnapshot, flightSnapshot);
  if (!list.length) return null;
  return <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
    {list.map((f) => <FlightView key={f.id} f={f} />)}
  </View>;
}

function FlightView({ f }: { f: LayerFlight }) {
  const { from, to, fromRadius, toRadius, duration, easing, scrim, fadeLast, backdropMs, follow } = f;
  const hold = !!f.hold;
  const clock = useSharedValue(0);
  const box = useSharedValue(f.box);
  const shown = useSharedValue(hold ? 0 : 1);
  const pics = useSharedValue(hold ? 0 : 1); // the copy's pictures are drawn
  const started = useSharedValue(0);
  const startWhen = f.startWhen ?? null;
  const handOver = f.handOver ?? null;
  const hide = f.source?.hide ?? null;
  const restore = !!f.source?.restore;
  const land = useMemo(() => doneOnce(() => {
    f.onLand?.();
    if (fadeLast > 0) endFlight(f.id);
    else requestAnimationFrame(() => endFlight(f.id)); // the copy goes a frame after its destination shows
  }, duration + (hold ? mm.pictureCapMs + mm.contentOutMs : 0) + motionValues.overlay.fallbackExtra), [f, duration, fadeLast, hold]);
  const shownJs = useCallback(() => { f.onShown?.(); }, [f]);
  const landDone = land.done;
  // the clock follows the kit's calm as it is now, not reanimated's launch-time reading (G3-1, see PLAYED): a flight a
  // caller chose to start plays; under calm (no caller flies then) it lands at once, as before
  const { calm } = useMotion();
  const clockMotion = calm ? ReduceMotion.Always : PLAYED.reduceMotion;
  // the start, on the UI thread: the copy shows, what it replaces hides and the source empties in the same frame
  const go = () => {
    'worklet';
    if (started.get() === 1) return;
    started.set(1);
    shown.set(1);
    if (handOver) handOver.set(0);
    if (hide) hide.set(1);
    clock.set(withTiming(duration, { ...timing(duration, ease.linear), reduceMotion: clockMotion }, () => { 'worklet'; scheduleOnRN(landDone); }));
    scheduleOnRN(shownJs);
  };
  useAnimatedReaction(() => (started.get() === 0 && pics.get() === 1 && (!startWhen || startWhen.get() === 1) ? 1 : 0), (ready) => {
    if (ready === 1) go();
  });
  // the source shows again as the crossfade into it begins (at the landing without one)
  useAnimatedReaction(() => (restore && hide && started.get() === 1 && clock.get() >= duration - Math.max(fadeLast, 0) ? 1 : 0), (now) => {
    if (now === 1 && hide) hide.set(0);
  });
  useLayoutEffect(() => () => { land.cancel(); if (restore && hide) hide.set(0); }, [land, restore, hide]);
  const picturesIn = useCallback(() => { pics.set(1); }, [pics]);
  const gate = usePictureGateHost(!WEB && hold, mm.pictureCapMs, picturesIn, mm.settleFrames);
  // a tracked destination: measured again on each frame while the copy flies
  const track = f.track ?? null;
  const live = useSharedValue<Frame | null>(null);
  useFrameCallback(() => {
    'worklet';
    if (!track || started.get() === 0) return;
    const m = measureView(track);
    if (m && m.width > 0 && m.height > 0) live.set({ x: m.pageX, y: m.pageY, w: m.width, h: m.height });
  }, !!track);
  const geom = useDerivedValue<Geom>(() => {
    const c = clock.get();
    const u = Math.min(1, c / duration);
    const v = easing === 'drawer' ? ease.drawer(u) : ease.expo(u);
    const fy = follow ? follow.get() : 0;
    const dest = live.get() ?? to;
    const s = scrim === 'in' ? 1 - Math.min(1, c / mm.scrimFadeMs) : scrim === 'out' ? Math.max(0, Math.min(1, (c - (duration - mm.scrimFadeMs)) / mm.scrimFadeMs)) : 0;
    return {
      x: from.x + (dest.x - from.x) * v,
      y: from.y + (dest.y + fy - from.y) * v,
      w: from.w + (dest.w - from.w) * v,
      h: from.h + (dest.h - from.h) * v,
      r: fromRadius + (toRadius - fromRadius) * v,
      o: fadeLast > 0 ? Math.max(0, Math.min(1, (duration - c) / fadeLast)) : 1,
      s,
    };
  });
  const ground = useAnimatedStyle(() => ({ opacity: 1 - ease.css(Math.min(1, clock.get() / Math.max(1, backdropMs))) }));
  // a source's own picture (f.blend) and its words (f.over), only for a source that gave them (FU-m5)
  const copy = <ClipCopy geom={geom} box={box} scrim={!!scrim} wait={hold || (scrim !== 'out' && fadeLast === 0)} shown={shown}
    onDrawn={hold && WEB ? picturesIn : undefined}>
    {f.blend ? <FlightBlend clock={clock} duration={duration} under={f.render()}>{f.blend()}</FlightBlend> : f.render()}
  </ClipCopy>;
  return <>
    {f.backdrop ? <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: f.backdrop }, ground]} /> : null}
    {gate ? <PictureGateContext.Provider value={gate}>{copy}</PictureGateContext.Provider> : copy}
    {f.over ? <FlightOver to={to} live={live} follow={follow ?? null} shown={shown} pics={pics} clock={clock} duration={duration}>{f.over()}</FlightOver> : null}
  </>;
}

/** A source's own picture inside a closing copy (MorphHome.picture, FU-m5): over the hero's picture (`under`), faded in
 *  over the first morph.homeBlendBy of the flight (ease.css), so the copy lands as the source's photo. Once it is whole
 *  the hero's picture under it is hidden: the copy's own fade at the landing (an opacity Android applies to each layer
 *  in turn) then never lets the hero's picture show through. */
function FlightBlend({ clock, duration, under, children }: { clock: SharedValue<number>; duration: number; under: React.ReactNode; children: React.ReactNode }) {
  const by = Math.max(1, duration * mm.homeBlendBy);
  const style = useAnimatedStyle(() => ({ opacity: ease.css(Math.min(1, clock.get() / by)) }));
  const underStyle = useAnimatedStyle(() => ({ opacity: clock.get() >= by ? 0 : 1 }));
  return <>
    <Animated.View style={[StyleSheet.absoluteFill, underStyle]}>{under}</Animated.View>
    <Animated.View style={[StyleSheet.absoluteFill, style]}>{children}</Animated.View>
  </>;
}

/** A source's words above a closing copy (MorphHome.over, FU-m5): at the destination's frame (tracked, and following a
 *  rising sheet), faded in (ease.css) between morph.homeWordsFrom and homeWordsTo of the flight, as the copy reaches the
 *  source (the stage's content has faded by then), and kept to the landing, so the photo comes home under them. */
function FlightOver({ to, live, follow, shown, pics, clock, duration, children }: { to: Frame; live: SharedValue<Frame | null>; follow: SharedValue<number> | null; shown: SharedValue<number>; pics: SharedValue<number>; clock: SharedValue<number>; duration: number; children: React.ReactNode }) {
  const from = duration * mm.homeWordsFrom;
  const span = Math.max(1, duration * (mm.homeWordsTo - mm.homeWordsFrom));
  const style = useAnimatedStyle(() => {
    const d = live.get() ?? to;
    const fy = follow ? follow.get() : 0;
    const k = ease.css(Math.max(0, Math.min(1, (clock.get() - from) / span)));
    return { width: d.w, height: d.h, opacity: shown.get() * (pics.get() === 1 ? 1 : 0) * k, transform: [{ translateX: d.x }, { translateY: d.y + fy }] };
  });
  return <Animated.View pointerEvents="none" style={[styles.over, style]}>{children}</Animated.View>;
}

/* ---------- the destination side ---------- */

type Mode = 'morph' | 'fade';
type HeroReg = { ref: AnimatedRef<View>; radius: number; render: () => React.ReactNode; box: Box | null };
type Stage = {
  mode: Mode;
  morphKey: string;
  calm: boolean;
  tierC: boolean;
  backdrop: SharedValue<number>;
  content: SharedValue<number>;
  heroShown: SharedValue<number>;
  /** The pull (pt, ≥ 0) of a dismissible stage. */
  dismiss: SharedValue<number>;
  heroBox: SharedValue<Box>;
  /** 1 once the hero shows at home (morph: the landing; fade: from the first frame). */
  landed: SharedValue<number>;
  hero: React.MutableRefObject<HeroReg | null>;
  /** Native: the gate the hero's own pictures hold until each is on screen (T2-12, see heroPictures below). */
  heroGate: PictureGate | null;
  heroRendered: () => void;
  heroLaidOut: () => void;
  dismissPan: PanGesture | null;
  pullMove: (dy: number) => void;
  pullEnd: (dy: number, vy: number) => void;
  /** Closes back to the source (or fades), then calls `navigateBack`. */
  close: (navigateBack: () => void) => void;
};
const StageContext = createContext<Stage | null>(null);

/** Inside a MorphStage: its mode, whether the hero has landed (0 | 1) and the content's entrance (0 → 1); null outside
 *  one. A screen starts what belongs to the landed hero (a clip's playback) from `landed`, not from the copy's insides. */
export function useMorphStage(): { mode: Mode; landed: SharedValue<number>; content: SharedValue<number> } | null {
  const stage = useContext(StageContext);
  return useMemo(() => (stage ? { mode: stage.mode, landed: stage.landed, content: stage.content } : null), [stage?.mode, stage?.landed, stage?.content]); // eslint-disable-line react-hooks/exhaustive-deps
}

export type MorphStageProps = {
  morphKey: string;
  children: React.ReactNode;
  /** The screen's background, faded in behind the hero (default #080808). */
  background?: string;
  style?: StyleProp<ViewStyle>;
  /** A downward pull on the hero (or inside a DismissArea at its top) sends the photo back to its source (M47). */
  dismissible?: boolean;
  /** How a pull-to-dismiss goes back (default: the router's back, else Home). */
  onDismiss?: () => void;
  /** Called as a pull's release starts the close (before its flight or fade): the member is leaving (SAVE8-2; the
   *  screen's own Close and back say so themselves). */
  onLeaving?: () => void;
};

const routerBack = () => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)'); };

export function MorphStage({ morphKey, children, background = fx.bg.base, style, dismissible, onDismiss, onLeaving }: MorphStageProps) {
  const { tier, still, calm } = useMotion();
  const { height: winH } = useWindowDimensions();
  const [from] = useState(() => (still || tier === 'C' ? null : peekPending(morphKey)));
  useEffect(() => { if (from && pending === from) pending = null; }, [from]);
  const mode: Mode = from ? 'morph' : 'fade';
  const clock = useSharedValue(0); // the opening flight's clock (ms)
  const backdrop = useSharedValue(0);
  const content = useSharedValue(0);
  // the hero: hidden while the copy flies (morph), or fading in with the stage (fade)
  const heroShown = useSharedValue(0);
  const landed = useSharedValue(mode === 'fade' ? 1 : 0);
  const dismiss = useSharedValue(0);
  const slide = useSharedValue(0);
  const crossed = useSharedValue(0);
  const stageRef = useAnimatedRef<View>();
  const hero = useRef<HeroReg | null>(null);
  const [cloneOn, setCloneOn] = useState(mode === 'morph');
  const faded = useSharedValue(0); // a close's fade is far enough along (morph.closeFlyAt of it) for the copy to fly
  const [leaving, setLeaving] = useState(false); // closing: the stage lets touches through to the screen beneath
  const origin = useSharedValue<Frame>(from ? from.frame : ZERO);
  const target = useSharedValue<Frame | null>(null);
  const heroBox = useSharedValue<Box>(from ? { W: from.frame.w, H: from.frame.h } : { W: 1, H: 1 });
  const toRadius = useSharedValue(0);
  const flying = useRef(false);
  const cloneBump = useRef<(() => void) | null>(null);
  // native (T2-12): the hero's own pictures (the poster, the session's photo) hold heroGate from their first commit
  // until each is on screen; whenHeroPictures runs `fn` once none is held (at most morph.pictureCapMs later). The landing
  // keeps the copy over the hero until then, and a fade starts then, so the hero is never shown as its empty box
  const heroGate = useHeroGate(!WEB);
  const whenHeroPictures = heroGate.whenFree;
  const fromRadius = from?.radius ?? 0;
  // the tap's answer (the source's picture zoomed in its frame): the copy starts from it and the source is let go once
  // the stage's ground covers it; a fade (tier C, or a stage that took no morph) lets it go when its fade ends
  const lift = from?.lift ?? null;
  const [fadeLift] = useState(() => (from ? null : peekPending(morphKey)?.lift ?? null));
  const noLift = useSharedValue(0);
  const liftSV = lift ?? noLift;
  const zoom0 = useSharedValue(1); // the picture's zoom the flight starts from
  const liftZoom = mm.liftZoom;
  useEffect(() => () => { dropLift(lift); dropLift(fadeLift); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // the ground and the content of a morph: with the stage on the web; on native with the flight (M69: until the copy
  // flies, the screen beneath stays as it was, its photo in place, so no frame shows the photo gone)
  const opened = useRef(false);
  const openStage = useCallback(() => {
    if (opened.current) return;
    opened.current = true;
    backdrop.set(withTiming(1, timing(t.overlay)));
    content.set(withDelay(mm.contentAt, withTiming(1, timing(t.flow))));
  }, [backdrop, content]);

  // native (M69): the opening flight runs on a stepped clock. Each frame moves it on by that frame's time, at most
  // morph.maxStepMs, so a frame the route's own work stalls pauses the flight where it is (the next frame moves on one
  // step) instead of jumping past most of its travel: an expo flight covers 75% of its way in its first fifth, so one
  // 200 ms stall there drew the copy at the hero at once (the wave-2 gate's 3-4 flight frames). The ground and the
  // content entrance are read off the same clock (their own expo timings, t.overlay and contentAt + t.flow), so the
  // three stay in step through a stall too. The web keeps its timed flight.
  const stepping = useSharedValue(0);
  const landRef = useRef<() => void>(() => undefined);
  const landFromUI = useCallback(() => landRef.current(), []);
  const flightFrame = useFrameCallback((f) => {
    'worklet';
    if (!stepping.get()) return;
    const dt = f.timeSincePreviousFrame;
    const c = Math.min(t.morph, clock.get() + Math.min(dt == null ? mm.firstStepMs : dt, mm.maxStepMs));
    clock.set(c);
    backdrop.set(ease.expo(Math.min(1, c / t.overlay)));
    content.set(c <= mm.contentAt ? 0 : ease.expo(Math.min(1, (c - mm.contentAt) / t.flow)));
    if (c >= t.morph) { stepping.set(0); scheduleOnRN(landFromUI); }
  }, false);

  const land = useCallback(() => {
    if (!WEB) flightFrame.setActive(false);
    openStage();
    heroShown.set(1);
    landed.set(1);
    dropLift(lift); // the ground covers the screen beneath now: the source is at rest again, unseen
    // the copy goes one frame after the hero shows, and not before the hero's own pictures are on screen (T2-12: a
    // poster still decoding under the copy showed as an empty dark box for a frame when the copy went)
    whenHeroPictures(() => requestAnimationFrame(() => setCloneOn(false)), mm.pictureCapMs);
  }, [openStage, heroShown, landed, flightFrame, lift, whenHeroPictures]);
  landRef.current = land;

  useEffect(() => {
    if (mode === 'fade') {
      const cfg = calm ? calmFade() : timing(t.fast);
      const fl = fadeLift;
      const fadeIn = () => {
        backdrop.set(withTiming(1, cfg, () => { 'worklet'; if (fl) fl.set(0); }));
        content.set(withTiming(1, cfg));
        heroShown.set(withTiming(1, cfg)); // the hero fades in with the stage (never at full opacity over the screen below)
      };
      // native (T2-12): the fade starts once the hero's pictures are on screen (at most morph.pictureCapMs; the screen
      // beneath stays as it is meanwhile), so the hero never fades in as its empty box with the poster landing later
      whenHeroPictures(fadeIn, mm.pictureCapMs);
      return;
    }
    if (WEB) { openStage(); return; }
    // native: a stage whose flight never starts (its hero never laid out) still opens, the hero in place
    const timer = setTimeout(() => { if (flying.current) return; flying.current = true; land(); }, t.morph + mm.pictureCapMs + mm.quietCapMs);
    return () => clearTimeout(timer);
    // the stage opens once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // measure the hero and fly the copy there (native: the ground and the content follow the flight's stepped clock)
  const launch = useCallback(() => {
    if (WEB) openStage();
    const h = hero.current;
    if (!h) { land(); return; }
    const heroRef = h.ref;
    const known = h.box;
    toRadius.set(h.radius);
    if (!WEB) flightFrame.setActive(true);
    const web = WEB;
    scheduleOnUI(() => {
      'worklet';
      const s = measureView(stageRef);
      const m = measureView(heroRef);
      if (!s || !m || m.width <= 0) { scheduleOnRN(land); return; }
      const o = origin.get();
      origin.set({ x: o.x - s.pageX, y: o.y - s.pageY, w: o.w, h: o.h });
      zoom0.set(1 + (liftZoom - 1) * liftSV.get()); // the flight eases the source's zoom back to 1
      target.set({ x: m.pageX - s.pageX, y: m.pageY - s.pageY, w: m.width, h: m.height });
      if (!known) heroBox.set({ W: m.width, H: m.height });
      if (web) clock.set(withTiming(t.morph, timing(t.morph, ease.linear), () => { 'worklet'; scheduleOnRN(land); }));
      else stepping.set(1);
    });
  }, [openStage, land, stageRef, origin, target, heroBox, clock, toRadius, flightFrame, stepping, zoom0, liftSV, liftZoom]);

  // the flight starts once the hero has laid out and (native) the copy's pictures are drawn: the web a frame later;
  // native once frames come quietly again (see the header, M69)
  const heroReady = useRef(false);
  const pictureReady = useRef(WEB); // the web copy waits for its own pictures (useDrawn)
  const cancelQuiet = useRef<(() => void) | null>(null);
  useEffect(() => () => { flying.current = true; cancelQuiet.current?.(); cancelQuiet.current = null; }, []); // gone: no late flight
  const maybeFly = useCallback(() => {
    if (mode !== 'morph' || flying.current || !heroReady.current || !pictureReady.current) return;
    flying.current = true;
    if (WEB) { requestAnimationFrame(launch); return; }
    cancelQuiet.current = afterQuietFrames(mm.startFrames, mm.quietCapMs, () => { cancelQuiet.current = null; launch(); });
  }, [mode, launch]);
  const heroLaidOut = useCallback(() => { heroReady.current = true; maybeFly(); }, [maybeFly]);
  const pictureIn = useCallback(() => { pictureReady.current = true; maybeFly(); }, [maybeFly]);

  const heroRendered = useCallback(() => { if (mode === 'morph' && !flying.current) cloneBump.current?.(); }, [mode]);

  const fadeOut = useCallback((navigateBack: () => void) => {
    dropLift(lift, false);
    const cfg = calm ? calmFade() : { ...timing(t.fast), ...PLAYED }; // G3-1: tier C's fade plays (see PLAYED)
    const back = doneOnce(navigateBack, (calm ? t.calm : t.fast) + motionValues.overlay.fallbackExtra);
    content.set(withTiming(0, cfg));
    heroShown.set(withTiming(0, cfg));
    backdrop.set(withTiming(0, cfg, () => { 'worklet'; scheduleOnRN(back.done); }));
    setLeaving(true); // as flyHome: a fading stage takes no more touches (SAVE8b-3)
  }, [calm, content, heroShown, backdrop, lift]);

  // back to the source on the root layer (see the header, 4): the content and the ground fade out at once while the
  // hero stays; the source empties under the still-opaque stage; the copy, mounted hidden on the layer, takes over from
  // the hero once its pictures are drawn and the fade has ended (a pull's release: at once), then the route goes back
  const flyHome = useCallback((navigateBack: () => void, pull: number) => {
    const h = hero.current;
    const { refs, actives, radii, hides, homes } = sourceList(morphKey);
    if (!h || !refs.length) { fadeOut(navigateBack); return; }
    const heroRef = h.ref;
    const radius = h.radius;
    const render = h.render;
    const box = h.box;
    const tierC = tier === 'C';
    const { width: W, height: H } = Dimensions.get('window');
    const pulled = pull > 0;
    dropLift(lift); // a close before the landing: the tile is back at rest for the photo coming home
    // the fade starts with the tap, before the UI thread has measured anything
    const fadeCfg = { ...timing(mm.contentOutMs, ease.exit), ...PLAYED }; // G3-1: never a one-frame cut (see PLAYED)
    faded.set(0);
    content.set(withTiming(0, fadeCfg));
    backdrop.set(withTiming(0, fadeCfg));
    // the flight overlaps the fade's second half (C12: the exit stays shorter than the entrance), so the copy never
    // leaves over the player while it is still mostly opaque, and never waits for the whole fade either
    faded.set(withDelay(Math.round(mm.contentOutMs * mm.closeFlyAt), withTiming(1, { duration: 0 }), PLAYED.reduceMotion));
    setLeaving(true);
    const back = doneOnce(navigateBack, mm.contentOutMs + mm.pictureCapMs + t.exitMorph + motionValues.overlay.fallbackExtra);
    // one trip to the UI thread: the source (still on screen?) and the hero's pose (pulled or not)
    const handOff = (to: Frame | null, pose: Frame | null, r: number, srcRadius: number, src: number) => {
      if (!to || !pose) {
        back.cancel();
        if (!to && pulled) { // pulled, but the source is off screen: the overlay slides down
          const done = doneOnce(navigateBack, mm.slideOutMs + motionValues.overlay.fallbackExtra);
          slide.set(withTiming(winH, { ...timing(mm.slideOutMs, ease.exit), ...PLAYED }, () => { 'worklet'; scheduleOnRN(done.done); }));
          return;
        }
        fadeOut(navigateBack);
        return;
      }
      const hide = hides[src] ?? null;
      const own = homes[src]?.current ?? null; // the source's own picture and words, when it gave them (FU-m5)
      flyOnLayer({
        render, box: box ?? { W: pose.w, H: pose.h },
        from: pose, fromRadius: r, to, toRadius: srcRadius,
        duration: t.exitMorph, easing: 'drawer', scrim: 'out', fadeLast: mm.crossfadeLast,
        backdrop: null, backdropMs: 0,
        hold: true, startWhen: pulled ? null : faded, handOver: heroShown,
        source: hide ? { hide, restore: true } : null, track: refs[src] ?? null,
        onLand: back.done, // the stage has been invisible since the copy's first frame: its unmount is never seen
        blend: own?.picture ?? null, over: own?.over ?? null,
      });
    };
    onUI(() => {
      'worklet';
      const p = pickSource(refs, actives, W, H);
      const to = p.frame;
      const srcRadius = p.i >= 0 ? radii[p.i] ?? 0 : 0;
      const m = measureView(heroRef);
      if (!m || m.width <= 0) { scheduleOnRN(handOff, to, null, radius, srcRadius, p.i); return; }
      // the tile empties under the stage, still opaque (its photo is the one coming back)
      if (to && p.i >= 0) { const hd = hides[p.i]; if (hd) hd.set(1); }
      const d = dismiss.get();
      const k = tierC ? 1 : 1 - dm.shrink * Math.min(1, d / Math.max(1, m.height));
      const r = tierC ? radius : radius + (dm.radius - radius) * Math.min(1, d / dm.radiusOver);
      scheduleOnRN(handOff, to, { x: m.pageX + (m.width * (1 - k)) / 2, y: m.pageY + dm.follow * d + (m.height * (1 - k)) / 2, w: m.width * k, h: m.height * k }, r, srcRadius, p.i);
    });
  }, [hero, fadeOut, tier, morphKey, slide, winH, dismiss, heroShown, content, backdrop, faded, lift]);

  const closing = useRef(false); // a close is on its way (Android back pressed again during it is ignored)
  const close = useCallback((navigateBack: () => void) => {
    if (closing.current) return;
    closing.current = true;
    if (mode !== 'morph' || still) { fadeOut(navigateBack); return; }
    flyHome(navigateBack, 0);
  }, [mode, still, fadeOut, flyHome]);

  // M47: the pull
  const dismissTo = onDismiss ?? routerBack;
  const leavingRef = useRef(onLeaving);
  leavingRef.current = onLeaving;
  const pulled = useCallback((d: number) => {
    if (closing.current) return;
    closing.current = true;
    leavingRef.current?.(); // the screen hears of a pull's close as of Close's (SAVE8-2)
    if (calm) { fadeOut(dismissTo); return; }
    if (mode !== 'morph') { fadeOut(dismissTo); return; }
    flyHome(dismissTo, d);
  }, [calm, mode, fadeOut, flyHome, dismissTo]);
  const softHaptic = useCallback(() => haptics.soft(), []);
  // the pull's two halves, shared by the hero's pan and DismissArea's (worklets: they run on the UI thread)
  const pullMove = (dy: number) => {
    'worklet';
    if (calm) return;
    const d = Math.max(0, dy);
    dismiss.set(d);
    if (crossed.get() === 0 && d > dm.distance) { crossed.set(1); scheduleOnRN(softHaptic); }
  };
  const pullEnd = (dy: number, vy: number) => {
    'worklet';
    const d = Math.max(0, dy);
    crossed.set(0);
    if (calm) { if (vy > dm.velocity) scheduleOnRN(pulled, 0); return; }
    if (d > dm.distance || vy > dm.velocity) { scheduleOnRN(pulled, d); return; }
    dismiss.set(withSpring(0, spring.dismiss));
  };
  const dismissPan = useMemo(() => {
    if (!dismissible) return null;
    return Gesture.Pan()
      .activeOffsetY(mm.activeOffsetY)
      .failOffsetX([-mm.failOffsetX, mm.failOffsetX])
      .onUpdate((e) => { pullMove(e.translationY); })
      .onEnd((e) => { pullEnd(e.translationY, e.velocityY); });
    // the worklets read shared values only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dismissible, calm, softHaptic, pulled]);

  const stage: Stage = { mode, morphKey, calm, tierC: tier === 'C', backdrop, content, heroShown, dismiss, heroBox, landed, hero, heroGate: heroGate.gate, heroRendered, heroLaidOut, dismissPan, pullMove, pullEnd, close };
  const back = useAnimatedStyle(() => {
    const k = Math.min(1, dismiss.get() / dm.distance);
    return { opacity: backdrop.get() * (1 - (1 - dm.backdropMin) * k) };
  });
  const slideStyle = useAnimatedStyle(() => (slide.get() > 0 ? { transform: [{ translateY: slide.get() }] } : { transform: [] }));
  const geom = useDerivedValue<Geom>(() => {
    const o = origin.get();
    const to = target.get();
    const c = clock.get();
    const sc = 1 - Math.min(1, c / mm.scrimFadeMs);
    // before the flight the copy sits on the source, its picture at the source's zoom; the flight eases it to 1
    if (!to) return { x: o.x, y: o.y, w: o.w, h: o.h, r: fromRadius, o: 1, s: 1, z: 1 + (liftZoom - 1) * liftSV.get() };
    const v = ease.expo(Math.min(1, c / t.morph));
    const z0 = zoom0.get();
    return { x: o.x + (to.x - o.x) * v, y: o.y + (to.y - o.y) * v, w: o.w + (to.w - o.w) * v, h: o.h + (to.h - o.h) * v, r: fromRadius + (toRadius.get() - fromRadius) * v, o: 1, s: sc, z: z0 + (1 - z0) * v };
  });

  return <StageContext.Provider value={stage}>
    <Animated.View ref={stageRef} pointerEvents={leaving ? 'none' : 'auto'} style={[StyleSheet.absoluteFill, style, slideStyle]} collapsable={false}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: background }, back]} />
      {children}
      {cloneOn ? <StageClone hero={hero} geom={geom} box={heroBox} bump={cloneBump} onPicture={pictureIn} /> : null}
    </Animated.View>
  </StageContext.Provider>;
}

/** The opening copy, rendered after the stage's children so the hero's latest picture is known on the first frame.
 *  Its picture is taken when it mounts and on each hero render before the flight starts (bump), then kept: a later
 *  render of the screen (Play pressed while the copy still flies) never reaches the copy, so it never draws a second
 *  view of a live video (the web's second <video> paused the clip when the copy went: the V1 flake). */
function StageClone({ hero, geom, box, bump, onPicture }: { hero: React.MutableRefObject<HeroReg | null>; geom: SharedValue<Geom>; box: SharedValue<Box>; bump: React.MutableRefObject<(() => void) | null>;
  /** The copy's pictures are drawn (native; at once on the web). */
  onPicture: () => void }) {
  const [n, setN] = useState(0);
  useEffect(() => { bump.current = () => setN((k) => k + 1); return () => { bump.current = null; }; }, [bump]);
  const h = hero.current;
  const b = h?.box;
  useLayoutEffect(() => { if (b) box.set(b); }, [b?.W, b?.H]); // eslint-disable-line react-hooks/exhaustive-deps
  const known = !!h;
  const picture = useMemo(() => (h ? h.render() : null), [n, known]); // eslint-disable-line react-hooks/exhaustive-deps
  // native: the copy is drawn only once its pictures are (the source shows until then, never the copy's black ground)
  const shown = useSharedValue(WEB ? 1 : 0);
  const gate = usePictureGateHost(!WEB && known, mm.pictureCapMs, () => { shown.set(1); onPicture(); });
  if (!h) return null;
  return <PictureGateContext.Provider value={gate}><ClipCopy geom={geom} box={box} wait shown={shown}>{picture}</ClipCopy></PictureGateContext.Provider>;
}

/** The stage's gate for the hero's own pictures (T2-12): every picture in the hero holds it until it is on screen (or has
 *  failed); whenFree(fn, capMs) runs fn once none is held, at once when none is (checked after the commit's layout
 *  effects, so pictures of the first commit count), and at most capMs later. Off (the web): fn runs at once. */
function useHeroGate(on: boolean): { gate: PictureGate | null; whenFree: (fn: () => void, capMs: number) => void } {
  const pending = useRef(0);
  const waiters = useRef<Array<() => void>>([]);
  const flush = useCallback(() => { const w = waiters.current; waiters.current = []; w.forEach((f) => f()); }, []);
  const gate = useMemo<PictureGate | null>(() => (on ? {
    hold: () => {
      pending.current += 1;
      let open = true;
      return () => { if (!open) return; open = false; pending.current -= 1; if (pending.current <= 0) flush(); };
    },
  } : null), [on, flush]);
  const whenFree = useCallback((fn: () => void, capMs: number) => {
    if (!on || pending.current <= 0) { fn(); return; }
    let done = false;
    const once = () => { if (done) return; done = true; clearTimeout(timer); fn(); };
    const timer = setTimeout(once, capMs);
    waiters.current.push(once);
  }, [on]);
  useEffect(() => () => { waiters.current = []; }, []);
  return useMemo(() => ({ gate, whenFree }), [gate, whenFree]);
}

/** The gate a copy's pictures hold (src/fx/media/Photo): `ready` runs once every picture held from the first
 *  commit has been drawn, at once when none is held, and at most `capMs` after the copy mounted. Off: no gate.
 *  `settleFrames` (a closing copy): a picture that mounts in the copy's next few frames (a pager page drawn after its
 *  first layout) is waited for too; with none held by then, ready. */
function usePictureGateHost(on: boolean, capMs: number, ready: () => void, settleFrames = 0): PictureGate | null {
  const pending = useRef(0);
  const done = useRef(false);
  const settled = useRef(settleFrames <= 0);
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const finish = useCallback(() => { if (done.current) return; done.current = true; readyRef.current(); }, []);
  const gate = useMemo<PictureGate | null>(() => (on ? {
    hold: () => {
      if (done.current) return () => undefined;
      pending.current += 1;
      let open = true;
      return () => { if (!open) return; open = false; pending.current -= 1; if (pending.current <= 0 && settled.current) finish(); };
    },
  } : null), [on, finish]);
  // after the pictures' own layout effects (children first): they have held the gate by now
  useLayoutEffect(() => {
    if (!on) return;
    const timer = setTimeout(finish, capMs);
    let raf = 0;
    if (settleFrames <= 0) {
      if (pending.current <= 0) finish();
    } else {
      let n = 0;
      const tick = () => { n += 1; if (n < settleFrames) { raf = requestAnimationFrame(tick); return; } settled.current = true; if (pending.current <= 0) finish(); };
      raf = requestAnimationFrame(tick);
    }
    return () => { clearTimeout(timer); cancelAnimationFrame(raf); };
  }, [on, capMs, finish, settleFrames]);
  return gate;
}

/** The destination's hero: hidden while the copy flies, shown when it lands. Its children are the photo (and scrim). */
export function MorphHero({ radius = 0, children, style }: { radius?: number; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const stage = useContext(StageContext);
  const ref = useAnimatedRef<View>();
  const one = useSharedValue(1);
  const zero = useSharedValue(0);
  const unit = useSharedValue<Box>({ W: 1, H: 1 });
  const flat = (StyleSheet.flatten(style) ?? {}) as ViewStyle;
  const W = typeof flat.width === 'number' ? flat.width : 0;
  const H = typeof flat.height === 'number' ? flat.height : 0;
  // always the latest picture: a close flies the exercise on screen, not the first one
  if (stage) stage.hero.current = { ref, radius, render: () => children, box: W && H ? { W, H } : null };
  useLayoutEffect(() => { stage?.heroRendered(); });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!width || !height) return; // a detached page reports 0×0
    stage?.heroLaidOut();
  };
  const shown = stage?.heroShown ?? one;
  const pull = stage?.dismiss ?? zero;
  const box = stage?.heroBox ?? unit;
  const tierC = !!stage?.tierC;
  const outer = useAnimatedStyle(() => ({ opacity: shown.get() }));
  // the pull moves the picture inside the hero's (unmoved) frame, so the frame measured for the flight home is its rest place
  const inner = useAnimatedStyle(() => {
    const d = pull.get();
    if (d <= 0) return { borderRadius: radius, transform: [] };
    if (tierC) return { borderRadius: radius, transform: [{ translateY: dm.follow * d }] };
    return {
      borderRadius: radius + (dm.radius - radius) * Math.min(1, d / dm.radiusOver),
      transform: [{ translateY: dm.follow * d }, { scale: 1 - dm.shrink * Math.min(1, d / Math.max(1, box.get().H)) }],
    };
  });
  // the hero's own pictures hold the stage's hero gate until each is on screen (the copy's are held by the copy's gate)
  const pictures = stage?.heroGate ? <PictureGateContext.Provider value={stage.heroGate}>{children}</PictureGateContext.Provider> : children;
  const body = <Animated.View ref={ref} onLayout={onLayout} collapsable={false} testID="fx-morph-hero" style={[style, styles.heroFrame, outer]}>
    <Animated.View style={[StyleSheet.absoluteFill, styles.heroClip, { backgroundColor: flat.backgroundColor }, inner]}>{pictures}</Animated.View>
  </Animated.View>;
  return stage?.dismissPan ? <GestureDetector gesture={stage.dismissPan}>{body}</GestureDetector> : body;
}

/** The content under the hero: enters (opacity, y 10, 400 ms) from morph.contentAt into a morph; with the stage's
 *  fade otherwise; under reduced motion it only fades. `pointerEvents` as a View's ('box-none': a sticky footer whose
 *  padding draws over the scroll lets touches there through to it). */
export function MorphContent({ children, style, pointerEvents }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only' }) {
  const stage = useContext(StageContext);
  const one = useSharedValue(1);
  const zero = useSharedValue(0);
  const v = stage?.content ?? one;
  const pull = stage?.dismiss ?? zero;
  const calm = !!stage?.calm;
  const animated = useAnimatedStyle(() => {
    const p = v.get();
    // M47: while the hero is pulled the content dims towards dismiss.contentMin
    const d = pull.get();
    const dim = d > 0 ? 1 - (1 - dm.contentMin) * Math.min(1, d / dm.distance) : 1;
    if (p >= 1) return { opacity: dim, transform: [] };
    if (calm) return { opacity: p * dim, transform: [] };
    return { opacity: p * dim, transform: [{ translateY: 10 * (1 - p) }] };
  });
  return <Animated.View pointerEvents={pointerEvents} style={[style, animated]}>{children}</Animated.View>;
}

/** A region of a dismissible stage (the overlay's scroll) where a downward pull sends the photo back, while the region
 *  is scrolled to its top. Pass the scroll's offset as `scrollY` on native; the web reads it from the page. */
export function DismissArea({ children, style, scrollY }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; scrollY?: SharedValue<number> }): React.JSX.Element {
  const stage = useContext(StageContext);
  const own = useSharedValue(0);
  const offset = scrollY ?? own;
  const wrap = useRef<React.ComponentRef<typeof View>>(null);
  // the web: a scroll inside the area (scroll events do not bubble, but they can be captured)
  useEffect(() => {
    if (Platform.OS !== 'web' || scrollY) return;
    const el = wrap.current as unknown as HTMLElement | null;
    if (!el || typeof el.addEventListener !== 'function') return;
    const onScroll = (e: Event) => { const tg = e.target as HTMLElement | null; own.set(tg && typeof tg.scrollTop === 'number' ? tg.scrollTop : 0); };
    el.addEventListener('scroll', onScroll, true);
    return () => el.removeEventListener('scroll', onScroll, true);
  }, [scrollY, own]);
  const startY = useSharedValue(0);
  const startX = useSharedValue(0);
  const pullMove = stage?.pullMove;
  const pullEnd = stage?.pullEnd;
  const on = !!stage?.dismissPan;
  // activates by hand: only a downward pull while the content is at its top, so a scroll is never taken over
  const pan = useMemo(() => {
    if (!on || !pullMove || !pullEnd) return null;
    return Gesture.Pan()
      .manualActivation(true)
      .onTouchesDown((e) => {
        const p = e.allTouches[0];
        if (!p) return;
        startY.set(p.absoluteY);
        startX.set(p.absoluteX);
      })
      .onTouchesMove((e, state) => {
        const p = e.allTouches[0];
        if (!p) return;
        const dy = p.absoluteY - startY.get();
        const dx = p.absoluteX - startX.get();
        if (offset.get() > 0 || dy < -mm.activeOffsetY || Math.abs(dx) > mm.failOffsetX) { state.fail(); return; }
        if (dy > mm.activeOffsetY) state.activate();
      })
      .onUpdate((e) => { pullMove(e.translationY); })
      .onEnd((e) => { pullEnd(e.translationY, e.velocityY); });
    // the worklets read shared values only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, pullMove, pullEnd]);
  const body = <View ref={wrap} style={style} collapsable={false}>{children}</View>;
  return pan ? <GestureDetector gesture={pan}>{body}</GestureDetector> : body;
}

/** Closes a morphed screen: back along the same path to the source when it is still on screen (on the root layer,
 *  going back at once), else a 200 ms fade; then `navigateBack()` runs. Outside a MorphStage it navigates back at once. */
export function useMorphClose(morphKey: string): (navigateBack: () => void) => void {
  const stage = useContext(StageContext);
  return (navigateBack) => {
    if (!stage) { navigateBack(); return; }
    void morphKey;
    stage.close(navigateBack);
  };
}

const styles = StyleSheet.create({
  clip: { position: 'absolute', left: 0, top: 0, overflow: 'hidden', backgroundColor: fx.bg.deep },
  inner: { position: 'absolute', left: 0, top: 0 },
  shade: { backgroundColor: fx.scrim.photo },
  heroFrame: { backgroundColor: fx.premium.transparent },
  // a source's frame clips its picture's zoom (the tap's answer); the picture fills it as before
  sourceClip: { overflow: 'hidden' },
  sourceZoom: { flexGrow: 1 },
  heroClip: { overflow: 'hidden' },
  // a source's words above a closing copy, placed at the destination's frame (FU-m5)
  over: { position: 'absolute', left: 0, top: 0, overflow: 'hidden' },
});
