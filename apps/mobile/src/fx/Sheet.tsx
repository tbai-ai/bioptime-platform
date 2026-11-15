/* Bottom sheets, The Physical Sheet (THEME §11.8, PREMIUM §1.3D, AMENDED §1 "Sheets"; motion v2 M41-M51): drawn in the
   app's own tree by the one SheetHost in the root layout, never in an RN Modal (a separate native window would sit
   above everything, the toasts included).
   - <Sheet visible onClose onExited title tall>…</Sheet> anywhere in a screen: the host draws it above the navigator.
     Its content is the element the screen renders (kept current on every render, so it uses the screen's state
     directly), and the last open content is kept until the sheet has left: a sheet showing a selected item keeps it
     all the way out. `onExited` runs once after the exit's last frame (or its fallback timer), for a screen that opens
     the next thing then. A hook that needs the screen's own route context must be read in the screen and passed in.
   - openSheetWithMorph(key, open): opens a host sheet from a card photo (<MorphSource morphKey={key}>): the photo flies
     into the sheet's `hero` on the root MorphLayer while the panel rises, and back on close when the card is on screen.
   - <SheetScreen title onClose> for a route presented as a sheet (transparentModal on native): the same panel inside
     the route; closing plays the exit and then goes back.
   Look: black/80 scrim (its 10 pt blur fades in once the panel has risen, where the device allows; else black/85);
   the panel radius 24 (tall: 28) on #0A0A0A/92 with a 50 pt blur (Android and lite: solid #0A0A0A; tall: #0D0D0D), a
   white/20 top border, the 40×4 grabber, padding 24 and 48 + the inset at the bottom, at most 85 % of the screen
   (tall 92 %) with its own scroll, and a 48 pt skirt of the same ground below the screen's edge, so neither the
   spring's overshoot nor an upward drag ever shows the page. On a wide screen (a tablet, the web) the panel is the
   520 pt column, centred, with hairlines at its sides.
   Motion: the scrim answers on the tap; the panel mounts parked just below the edge and, once laid out (and a frame
   later), rises from its own height + sheet.startOffset on the sheet spring (tall: the Store and report spring;
   tier C and calm never overshoot). While the panel is still parked the scrim stops at sheet.parkedScrim; it goes on to
   full over t.scrim as the rise starts (FU-m4: a sheet whose content takes a moment to lay out no longer dims the page
   to near black before it rises; a sheet that rises in time is never held). It follows the keyboard. Closing on a tap of the scrim, Android back, Escape on
   the web (a route sheet too) or the close button: the panel travels its own height + sheet.exitExtra in t.sheetExit
   (ease.exit) while the scrim fades over sheet.scrimExitMs from sheet.scrimExitAt. A drag down from the grabber, the
   title or (scrolled to its top) the content follows the finger 1:1, dims the scrim as it goes, gives
   asymptotically above the top, and on release past a quarter of its height or faster than sheet.dismissVelocity
   leaves on the throw spring with the finger's speed (decided on the UI thread; React only learns of it); haptics.soft
   marks the moment the drag crosses the dismiss line. A sheet opening within sheet.handoverWindow of another closing
   takes over its scrim (one scrim, kept up) while the old panel drops away. At tier A a tall host sheet makes the
   page behind recede (scale, a small drop, rounded corners; Android by transform alone) on the panel's own position. Calm: opacity only.
   While a sheet is open the page behind it is hidden from screen readers (and from E2E checks that skip aria-hidden):
   on the web every element outside the open sheet's layer is aria-hidden (once the browser is idle), the toasts
   excepted; on native the root layout's <SheetBackdrop> hides the navigator under a host sheet while a screen reader
   runs (otherwise the navigator is never touched by a sheet) and a route sheet is an accessibility modal. The tab
   pager does not swipe while a sheet is open (useSheetOpen). */
import { BlurView } from 'expo-blur';
import React, { startTransition, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, BackHandler, Keyboard, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation, makeMutable, useAnimatedKeyboard, useAnimatedReaction, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle,
  useDerivedValue, useSharedValue, withDelay, withSpring, withTiming, type SharedValue,
} from 'react-native-reanimated';
import { measureView } from './motion/measured';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { STAFF_APP } from '@/lib/config';
import { fx } from '@/theme';
import { IconButton } from './Button';
import { COLUMN } from './layout';

/** The opening scrim's first step, as a share of the parked scrim (sheet.parkedScrim): drawn in the tap's commit. */
const SCRIM_FIRST = 0.25;
import { haptics } from './device/haptics';
import { useFx } from './effects';
import { doneOnce } from './motion/once';
import { calmFade, ease, motionValues, spring, t, timing } from './motion/tokens';
import { flyOnLayer, measureMorphSource, MorphChromeContext, MorphLayer, prepareSheetMorph, takeSheetMorph, type MorphFrame } from './motion/PhotoMorph';
import { useOwnChrome } from './nav/chrome';
import { T } from './Text';
import { useToastClearance } from './Toast';

export type SheetKind = 'default' | 'tall' | 'lab';
export type SheetOptions = {
  title?: string;
  /** Store and report sheets: radius 28, 92 % high, the firmer spring. */
  tall?: boolean;
  kind?: SheetKind;
  /** A close button in the header (Store sheet). */
  closeButton?: boolean;
  /** Content without the panel's own scroll view (a list that scrolls itself). */
  noScroll?: boolean;
  /** Padding inside the panel (default 24). */
  padding?: number;
  /** Something to draw above the title, full-bleed inside the panel (a sheet hero photo). */
  hero?: React.ReactNode;
  /** A footer pinned under the scroll (a CTA). */
  footer?: React.ReactNode;
  /** Points the hero sits in from the panel's sides (its wrapper's horizontal margin), so the photo flight measures the
   *  photo's own box, not the full-width wrapper (M83). */
  heroInset?: number;
};
const OPTION_KEYS: (keyof SheetOptions)[] = ['title', 'tall', 'kind', 'closeButton', 'noScroll', 'padding', 'hero', 'footer', 'heroInset'];

const sv = motionValues.sheet;

/* The keyboard's height on native, for the panels to follow: one subscription for the whole app, started by the first
   panel and kept for the rest of the session (in SheetHost). Each subscription made and dropped around a single sheet
   re-applied the window's insets and laid the whole app out again as the sheet opened and once more as it left (every
   mounted page included). The web has no keyboard inset to follow (Reanimated warns there). */
const keyboardHeight = makeMutable(0);
let keyboardWanted = false;
const keyboardListeners = new Set<() => void>();
function wantKeyboard() {
  if (keyboardWanted || Platform.OS === 'web') return;
  keyboardWanted = true;
  keyboardListeners.forEach((l) => l());
}
const subscribeKeyboard = (l: () => void) => { keyboardListeners.add(l); return () => { keyboardListeners.delete(l); }; };
const keyboardSnapshot = () => keyboardWanted;
function KeyboardWatch() {
  const kb = useAnimatedKeyboard();
  useAnimatedReaction(() => kb.height.get(), (h) => { keyboardHeight.set(h); });
  return null;
}

/* ---------- the keyboard's room on Android (edge to edge) ----------
   The app draws edge to edge (Android 15+, and Reanimated's keyboard watch above), so Android's adjustResize no longer
   shrinks the window for the keyboard, and every screen written for it (a KeyboardAvoidingView with no Android
   behaviour, a footer pinned at the bottom: the flows, the overlays, Book a blood test, the Coach composer) lost its
   bottom under the keyboard. KeyboardFit gives that room back where the root stack draws each screen: its bottom
   padding follows the keyboard's top edge (its whole height, the navigation bar included: the screen then ends where
   the keyboard starts, as with adjustResize, whatever the screen pads for the bar), so a footer rides on the keyboard
   and a scroll view shrinks above it (Android scrolls the focused field back into view when its scroll view
   shrinks). `snap` (the tab pages: nine pages are laid out again) takes the keyboard's final height once it has
   opened (keyboardDidShow) and gives it back when it closes, one layout each way, as adjustResize did. The sheets lift their own panel (they are not inside). iOS keeps its KeyboardAvoidingViews and the
   web has no keyboard inset: KeyboardFit is a plain pass-through there. */
/** A footer's bottom padding that gives way to the keyboard: `base` + the navigation bar's inset at rest; on Android
 *  (edge to edge, where KeyboardFit already ends the screen at the keyboard's top) the inset slides to 0 as the keyboard
 *  rises over the bar, on the UI thread, so the footer sits `base` above the keyboard instead of the bar's height more.
 *  Elsewhere it is simply base + inset. */
export function useKeyboardInsetPad(base: number, inset: number) {
  const android = Platform.OS === 'android';
  useEffect(() => { if (android) wantKeyboard(); }, [android]);
  return useAnimatedStyle(() => {
    if (!android || inset <= 0) return { paddingBottom: base + inset };
    const k = keyboardHeight.get();
    return { paddingBottom: base + inset * (1 - Math.min(1, Math.max(0, k / inset))) };
  }, [android, base, inset]);
}

export function KeyboardFit({ children, snap = false }: { children: React.ReactNode; snap?: boolean }): React.JSX.Element {
  if (Platform.OS !== 'android') return <>{children}</>;
  return snap ? <KeyboardSnap>{children}</KeyboardSnap> : <KeyboardGlide>{children}</KeyboardGlide>;
}

function KeyboardGlide({ children }: { children: React.ReactNode }) {
  useEffect(() => { wantKeyboard(); }, []);
  // edge to edge, Reanimated's height is the keyboard's whole inset (the navigation bar included)
  const room = useAnimatedStyle(() => ({ paddingBottom: Math.max(0, keyboardHeight.get()) }));
  return <Animated.View style={[styles.fit, room]}>{children}</Animated.View>;
}

function KeyboardSnap({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const nav = insets.bottom;
  const [room, setRoom] = useState(0);
  useEffect(() => {
    // React Native's height leaves out the navigation bar: the screen ends at the keyboard's top edge with it added
    const show = Keyboard.addListener('keyboardDidShow', (e) => setRoom(Math.max(0, Math.round((e.endCoordinates?.height ?? 0) + nav))));
    const hide = Keyboard.addListener('keyboardDidHide', () => setRoom(0));
    return () => { show.remove(); hide.remove(); };
  }, [nav]);
  return <View style={[styles.fit, room ? { paddingBottom: room } : null]}>{children}</View>;
}

/* ---------- the host's store ---------- */

type Entry = SheetOptions & { id: string; open: boolean; onClose: () => void; onExited?: () => void; children: React.ReactNode };
let entries: Entry[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
function sameEntry(a: Entry, b: Entry): boolean {
  if (a.open !== b.open || a.children !== b.children) return false;
  for (const k of OPTION_KEYS) if (a[k] !== b[k]) return false;
  return true;
}
function upsert(e: Entry) {
  const i = entries.findIndex((x) => x.id === e.id);
  if (i < 0) { if (e.open) { entries = [...entries, e]; emit(); } return; }
  const cur = entries[i];
  // nothing drawn changed: keep the callbacks current without a re-render of the host
  if (sameEntry(cur, e)) { cur.onClose = e.onClose; cur.onExited = e.onExited; return; }
  entries = entries.map((x) => (x.id === e.id ? e : x));
  emit();
}
function drop(id: string) { if (!entries.some((x) => x.id === id)) return; entries = entries.filter((x) => x.id !== id); emit(); }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => entries;
const anyOpen = () => entries.some((e) => e.open);

/** Whether any sheet is open (the pager and the Coach composer stand down while one is). A boolean subscription: a
 *  change inside an open sheet re-renders nothing that reads it. */
export function useSheetOpen(): boolean {
  return useSyncExternalStore(subscribe, anyOpen, anyOpen);
}

const SheetRiseContext = React.createContext<SharedValue<number> | null>(null);

/** Inside a sheet's content (or hero): how far its panel has risen, 0 parked … 1 at rest (1 − y / (height +
 *  sheet.startOffset), clamped), on the UI thread; it follows a drag and the exit too. Null outside a sheet. For
 *  something that starts when the rise passes a share of the way (M62: a count at 90 %). */
export function useSheetRise(): SharedValue<number> | null {
  return React.useContext(SheetRiseContext);
}

/* ---------- the page behind (tier A: it recedes under a tall host sheet) ---------- */

/** 0 … 1: how far the page behind recedes (the top tall host sheet's own position drives it). */
const recede = makeMutable(0);
/** Which panel drives `recede` (its token), 0 for none. */
const recedeOwner = makeMutable(0);
let panelSeq = 0;

/** Whether a screen reader (TalkBack, VoiceOver) is running; false on the web, which hides the page in SheetPanel. */
/** Whether assistive technology that walks the screen runs: a screen reader (TalkBack, VoiceOver) or, on Android, any
 *  accessibility service (Switch Access and Voice Access move through the same tree). Native only. */
export function useAssistiveTech(): boolean {
  const [reader, setReader] = useState(false);
  const [service, setService] = useState(false);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let live = true;
    AccessibilityInfo.isScreenReaderEnabled().then((v) => { if (live) setReader(v); }, () => undefined);
    const subs = [AccessibilityInfo.addEventListener('screenReaderChanged', (v: boolean) => { if (live) setReader(v); })];
    if (Platform.OS === 'android') {
      AccessibilityInfo.isAccessibilityServiceEnabled().then((v) => { if (live) setService(v); }, () => undefined);
      subs.push(AccessibilityInfo.addEventListener('accessibilityServiceChanged', (v: boolean) => { if (live) setService(v); }));
    }
    return () => { live = false; subs.forEach((x) => x.remove()); };
  }, []);
  return reader || service;
}

/** Wraps the navigator in the root layout: while a host sheet is open and a screen reader or another accessibility
 *  service runs (useAssistiveTech), the screens under it are hidden from it on native (the web does this in SheetPanel,
 *  for route sheets too), so focus never moves behind the sheet. Without one the
 *  navigator's views are left untouched when a sheet opens or closes (no props change on the subtree that holds every
 *  mounted page). A host view that never collapses, with a constant base style, so toggling its accessibility props
 *  never re-parents the navigator. */
export function SheetBackdrop({ children }: { children: React.ReactNode }) {
  const open = useSheetOpen();
  const assistive = useAssistiveTech();
  const hide = open && assistive && Platform.OS !== 'web';
  // Android recedes by transform only: a changing corner radius on the view that holds every page is a layout-side prop
  // (a commit per frame) and a rounded clip of the whole app on every frame of the rise
  const rounded = Platform.OS !== 'android';
  const style = useAnimatedStyle(() => {
    const p = recede.get();
    if (p <= 0.0005) return rounded ? { borderRadius: 0, transform: [] } : { transform: [] };
    const tf = [{ translateY: sv.recedeY * p }, { scale: 1 - (1 - sv.recedeScale) * p }];
    return rounded ? { borderRadius: sv.recedeRadius * p, transform: tf } : { transform: tf };
  });
  return <Animated.View collapsable={false} style={[styles.backdrop, style]} accessibilityElementsHidden={hide} importantForAccessibility={hide ? 'no-hide-descendants' : 'auto'}>{children}</Animated.View>;
}

/* ---------- the web: hide everything outside the open sheet from assistive technology ---------- */

/** The toasts' host carries this id (src/fx/Toast): it stays announced while a sheet is open. */
const TOAST_HOST_ID = 'fx-toast-host';
const hiddenBy = new WeakMap<Element, number>();

/** Marks every element outside `target` (its ancestors' other children, up to <body>) aria-hidden, the way a modal
 *  dialog does; returns the undo. Elements that already carry an aria-hidden of their own (React's, the pager's) are
 *  left alone, and a count per element lets stacked sheets undo in any order. */
function hideOutside(target: Element): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const mine: Element[] = [];
  let node: Element | null = target;
  while (node && node !== document.body && node.parentElement) {
    for (const sib of Array.from(node.parentElement.children)) {
      if (sib === node || sib.id === TOAST_HOST_ID || ['SCRIPT', 'STYLE', 'TEMPLATE'].includes(sib.tagName)) continue;
      const n = hiddenBy.get(sib) ?? 0;
      if (n === 0 && sib.hasAttribute('aria-hidden')) continue;
      hiddenBy.set(sib, n + 1);
      sib.setAttribute('aria-hidden', 'true');
      mine.push(sib);
    }
    node = node.parentElement;
  }
  return () => {
    for (const sib of mine) {
      const n = (hiddenBy.get(sib) ?? 1) - 1;
      hiddenBy.set(sib, n);
      if (n <= 0) { hiddenBy.delete(sib); sib.removeAttribute('aria-hidden'); }
    }
  };
}

type Idle = { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
/** Runs `fn` when the browser is idle (at most sheet.hideOutsideTimeout later); returns the cancel. */
function whenIdle(fn: () => void): () => void {
  const w = (typeof window !== 'undefined' ? window : {}) as Idle;
  if (w.requestIdleCallback) { const id = w.requestIdleCallback(fn, { timeout: sv.hideOutsideTimeout }); return () => w.cancelIdleCallback?.(id); }
  const id = setTimeout(fn, 0);
  return () => clearTimeout(id);
}

/* ---------- the declarative sheet ---------- */

export function Sheet({ visible, onClose, onExited, children, ...options }: SheetOptions & { visible: boolean; onClose: () => void; onExited?: () => void; children?: React.ReactNode }): React.JSX.Element | null {
  const id = useId();
  const mounted = useRef(false);
  // the last open content and options: a sheet whose item turns null as it closes keeps showing it all the way out
  const last = useRef<{ children: React.ReactNode; options: SheetOptions }>({ children, options });
  if (visible) last.current = { children, options };
  // keep the host's copy current on every render, so the content follows the screen's state
  useLayoutEffect(() => {
    if (visible || mounted.current) {
      const shown = visible ? { children, options } : last.current;
      upsert({ id, open: visible, onClose, onExited, children: shown.children, ...shown.options });
      mounted.current = visible || mounted.current;
    }
  });
  useEffect(() => () => drop(id), [id]);
  return null;
}

/** Opens a host sheet from a card photo: measures the `<MorphSource morphKey={key}>`, then calls `open()`; the opened
 *  sheet's `hero` becomes the photo's target (M51). Tier C and reduced motion open the plain sheet. */
export function openSheetWithMorph(key: string, open: () => void): void {
  prepareSheetMorph(key, open);
}

/* ---------- the hand-over between host sheets (one scrim, kept up) ---------- */

type PanelCtl = { open: boolean; closing: boolean; scrimNow: () => number; handed: () => boolean; handOut: () => void; handIn: (scrimFrom: number) => void; closeNow: () => void };
const panels = new Map<string, PanelCtl>();
let lastOpen: { id: string; at: number } | null = null;
let lastClose: { id: string; at: number } | null = null;
const recent = (e: { id: string; at: number } | null, id: string) => !!e && e.id !== id && Date.now() - e.at <= sv.handoverWindow;

/* ---------- the host ---------- */

/** Draws the open sheets above everything else, and the photo flights above them (MorphLayer). Mount once, in the
 *  root layout, after the navigator. */
export function SheetHost() {
  const list = useSyncExternalStore(subscribe, snapshot, snapshot);
  const watchKeyboard = useSyncExternalStore(subscribeKeyboard, keyboardSnapshot, keyboardSnapshot);
  // the client app subscribes at launch, while the tree is small (the staff build on its first sheet)
  useEffect(() => { if (!STAFF_APP) wantKeyboard(); }, []);
  const top = [...list].reverse().find((e) => e.open);
  useEffect(() => {
    if (!top) return;
    // the exit starts at once (before the screen re-renders); the screen's state follows
    const closeTop = () => { const c = panels.get(top.id); if (c && c.open) c.closeNow(); else top.onClose(); };
    const back = BackHandler.addEventListener('hardwareBackPress', () => { closeTop(); return true; });
    let onKey: ((e: KeyboardEvent) => void) | null = null;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      onKey = (e) => { if (e.key === 'Escape') closeTop(); };
      window.addEventListener('keydown', onKey);
    }
    return () => { back.remove(); if (onKey) window.removeEventListener('keydown', onKey); };
  }, [top]);
  return <>
    {watchKeyboard ? <KeyboardWatch /> : null}
    {list.length ? <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {list.map((e) => <SheetLayer key={e.id} entry={e} />)}
    </View> : null}
    <MorphLayer />
  </>;
}

function SheetLayer({ entry }: { entry: Entry }) {
  const ref = useRef(entry);
  ref.current = entry;
  const { id, open, onClose: _close, onExited: _exited, children, ...options } = entry;
  const close = useCallback(() => ref.current.onClose(), []);
  const gone = useCallback(() => { const after = ref.current.onExited; drop(id); after?.(); }, [id]);
  return <SheetPanel hosted entryId={id} open={open} onClose={close} onExited={gone} {...options}>{children}</SheetPanel>;
}

/* ---------- the panel (host and route) ---------- */

type PanelProps = SheetOptions & {
  open: boolean; onClose: () => void; onExited?: () => void; children?: React.ReactNode; style?: StyleProp<ViewStyle>;
  /** Drawn by the SheetHost (which handles Escape and Android back for its top sheet). Otherwise the panel is a route's
   *  (SheetScreen, or a route drawing SheetPanel itself) and handles them while open, unless a host sheet is above it. */
  hosted?: boolean;
  /** The host's entry id (the hand-over between host sheets). */
  entryId?: string;
};

const clamp01 = (v: number) => { 'worklet'; return v < 0 ? 0 : v > 1 ? 1 : v; };
/** The upward give: asymptotic to sheet.upC. */
const upward = (dy: number) => { 'worklet'; return -sv.upC * (1 - 1 / (1 + (-dy * sv.upK) / sv.upC)); };

export function SheetPanel({ open, onClose, onExited, title, tall, kind, closeButton, noScroll, padding = 24, hero, footer, heroInset, children, style, hosted, entryId }: PanelProps) {
  const { calm, blur, tier } = useFx();
  useOwnChrome(); // a sheet route draws no stack header (src/fx/StackHeader)
  const insets = useSafeAreaInsets();
  const { height: winH, width: winW } = useWindowDimensions();
  const panelW = Math.min(winW, COLUMN);
  const capped = winW > COLUMN;
  const layer = useRef<React.ComponentRef<typeof View>>(null);
  const [footerH, setFooterH] = useState(0);
  useToastClearance(footerH, open && !!footer); // a quick toast sits above the sheet's pinned CTA
  const isTall = tall || kind === 'tall';
  const maxH = winH * (isTall ? 0.92 : 0.85);
  const tierC = tier === 'C';
  const rise = useMemo(() => {
    const base = isTall ? spring.sheetL : spring.sheet;
    return tierC || calm ? { ...base, overshootClamping: true } : base;
  }, [isTall, tierC, calm]);
  const token = useRef(0);
  if (!token.current) token.current = ++panelSeq;
  const myToken = token.current; // a number the worklets capture
  const recedes = !!hosted && isTall && tier === 'A' && !calm;

  // the web: once open (and the browser idle), nothing outside this layer is read by assistive technology
  useEffect(() => {
    if (!open || Platform.OS !== 'web') return;
    let undo: (() => void) | null = null;
    const cancel = whenIdle(() => {
      const el = layer.current as unknown as Element | null;
      if (el && typeof el.getAttribute === 'function') undo = hideOutside(el);
    });
    return () => { cancel(); undo?.(); };
  }, [open]);

  const [h, setH] = useState(0); // the panel's visible height (without the skirt); 0 until laid out
  const hv = useSharedValue(0);
  const y = useSharedValue(calm ? 0 : maxH + sv.startOffset); // parked below the edge until laid out
  const drag = useSharedValue(0);
  // a host sheet opening as another closes takes its scrim over from its first frame (no dip between the two)
  const [scrimFrom] = useState(() => {
    if (!hosted || calm) return 0;
    let v = 0;
    panels.forEach((c) => { if (c.closing && !c.handed()) v = 1; }); // (no shared value is read while rendering)
    return v;
  });
  const scrim = useSharedValue(scrimFrom);
  const parkCap = useSharedValue(1); // the scrim's most while the panel is parked (sheet.parkedScrim), 1 once it rises
  const fade = useSharedValue(calm ? 0 : 1); // the panel's opacity (calm, the hand-over)
  const leaving = useSharedValue(0); // 1 while an exit runs (a drag or flick starts it on the UI thread)
  const exitH = useSharedValue(0);
  const crossed = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const blurIn = useSharedValue(0);
  const bodyIn = useSharedValue(1); // the content under a morphing hero enters from morph.contentAt
  const heroShown = useSharedValue(1);
  const heroChrome = useSharedValue(1); // the hero's own controls (its close button): 0 while the photo flies in
  const [blurOn, setBlurOn] = useState(false);
  useEffect(() => { wantKeyboard(); }, []);
  const heroRef = useAnimatedRef<Animated.View>();

  // a host sheet commits its scrim first and fills the panel two frames later, so the scrim answers the tap at once
  const [filled, setFilled] = useState(!hosted || calm);
  useEffect(() => {
    if (filled || !open) return;
    let r2 = 0;
    // a transition: the content's render yields to the frames the scrim is drawing
    const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => startTransition(() => setFilled(true))); });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
  }, [open, filled]);
  const rising = useRef(false); // the rise's spring is running (a content that grows meanwhile keeps the top in place)
  const riseCfg = useRef<{ stiffness: number; damping: number; mass: number; overshootClamping?: boolean }>(spring.sheet);
  const risen = useRef(false); // the rise has started for this opening
  const riseFrom = useRef<number | null>(null); // a hand-over: rise from this share of the height
  const morph = useRef<{ key: string; frame: MorphFrame; radius: number; hide: SharedValue<number> | null } | null>(null);
  // the card whose photo is in the hero: its tile stays empty while the sheet is open (shown again by the flight home)
  const awaySource = useRef<SharedValue<number> | null>(null);
  const sourceBack = useCallback(() => { const hd = awaySource.current; awaySource.current = null; if (hd) hd.set(0); }, []);
  useEffect(() => sourceBack, [sourceBack]); // a sheet gone mid-flight never leaves a card without its photo
  const exit = useRef<{ done: () => void; cancel: () => void } | null>(null);
  const exitedEarly = useRef(false);
  const exited = useRef(false);
  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;
  const finish = useCallback(() => {
    if (exited.current) return;
    exited.current = true;
    sourceBack(); // a card still waiting for its photo gets it back (a flight home has already taken it over)
    if (recedeOwner.get() === token.current) { recedeOwner.set(0); recede.set(0); }
    onExitedRef.current?.();
  }, []);
  // the UI thread saw the exit end (the panel gone and the scrim out)
  const exitDone = useCallback(() => { if (exit.current) exit.current.done(); else exitedEarly.current = true; }, []);
  const arm = useCallback((ms: number) => {
    exit.current?.cancel();
    exit.current = doneOnce(() => { exit.current = null; finish(); }, ms + motionValues.overlay.fallbackExtra);
    if (exitedEarly.current) { exitedEarly.current = false; exit.current.done(); }
  }, [finish]);
  useEffect(() => () => { exit.current?.cancel(); if (recedeOwner.get() === token.current) { recedeOwner.set(0); recede.set(0); } }, []);

  useAnimatedReaction(() => {
    if (leaving.get() !== 1) return false;
    const panelGone = fade.get() <= 0.001 || y.get() >= exitH.get() - 0.5;
    return panelGone && scrim.get() <= 0.001;
  }, (gone, was) => { if (gone && !was) scheduleOnRN(exitDone); });

  // tier A: the page behind recedes on this panel's own position (a drag included)
  useAnimatedReaction(() => {
    if (recedeOwner.get() !== myToken) return -1;
    const H = hv.get();
    if (H <= 0) return 0;
    return 1 - clamp01((y.get() + Math.max(0, drag.get())) / H);
  }, (p) => { if (p >= 0) recede.set(p); });

  const settled = useCallback(() => { rising.current = false; if (blur) setBlurOn(true); }, [blur]);
  useEffect(() => { if (blurOn) blurIn.set(withTiming(1, timing(t.fast, ease.css))); }, [blurOn, blurIn]);

  // the photo from a card flies into the hero on the root layer while the panel rises (M51)
  const panelOffset = useDerivedValue(() => y.get() + (drag.get() >= 0 ? drag.get() : upward(drag.get())) - keyboardHeight.get());
  // how far the panel has risen, for its content (useSheetRise)
  const riseShare = useDerivedValue(() => {
    const H = hv.get();
    if (H <= 0) return calm ? 1 : 0;
    return 1 - clamp01((y.get() + Math.max(0, drag.get())) / (H + sv.startOffset));
  });
  // M83: one straight path to the hero's resting frame (the panel at rest, not where it is parked now: following the
  // rising panel pulled the copy down below its card first), shown and flown once its pictures are drawn, the card's
  // tile emptied on that frame; the hero's close button fades in only after the landing
  const flyHero = useCallback(() => {
    const m = morph.current;
    if (!m) return;
    const from = m.frame;
    const radius = m.radius;
    const content = hero;
    const hide = m.hide;
    const land = () => {
      heroShown.set(1);
      heroChrome.set(withTiming(1, timing(motionValues.morph.chromeInMs, ease.css)));
    };
    const send = (to: MorphFrame | null) => {
      if (!to) { land(); bodyIn.set(1); return; }
      if (hide) awaySource.current = hide;
      flyOnLayer({
        render: () => content, box: { W: to.w, H: to.h }, from, fromRadius: radius, to, toRadius: 0,
        duration: t.morph, easing: 'expo', scrim: null, fadeLast: 0, backdrop: null, backdropMs: 0, onLand: land,
        hold: true, source: hide ? { hide, restore: false } : null,
      });
    };
    scheduleOnUI(() => {
      'worklet';
      const r = measureView(heroRef);
      if (!r || r.width <= 0) { scheduleOnRN(send, null); return; }
      scheduleOnRN(send, { x: r.pageX, y: r.pageY - panelOffset.get(), w: r.width, h: r.height });
    });
  }, [hero, heroShown, heroChrome, bodyIn, panelOffset, heroRef]);

  const startRise = useCallback((H: number, fromHere = false) => {
    if (risen.current || calm) return;
    risen.current = true;
    const share = riseFrom.current;
    riseFrom.current = null;
    if (share != null) y.set(H * share); // the hand-over: the last 40 %
    else if (!fromHere || y.get() > H + sv.startOffset) y.set(H + sv.startOffset); // parked just below the edge
    const cfg = share != null ? (tierC ? { ...spring.sheetL, overshootClamping: true } : spring.sheetL) : rise;
    riseCfg.current = cfg;
    rising.current = true;
    // the scrim's cap goes with the rise: at once when the scrim has not reached it (nothing changes), else it goes on
    // from the cap to full over t.scrim
    if (parkCap.get() < 1) {
      if (scrim.get() < parkCap.get()) parkCap.set(1);
      else parkCap.set(withTiming(1, timing(t.scrim, ease.css)));
    }
    if (morph.current) flyHero();
    requestAnimationFrame(() => {
      if (!risen.current || !rising.current) return;
      y.set(withSpring(0, cfg, (f) => { 'worklet'; if (f) scheduleOnRN(settled); }));
    });
  }, [calm, tierC, rise, y, settled, flyHero, parkCap, scrim]);

  // open and close; a layout effect, so the scrim answers in the same frame as the tap's commit
  useLayoutEffect(() => {
    const me = entryId ?? '';
    if (open) {
      exit.current?.cancel();
      exit.current = null;
      exited.current = false;
      exitedEarly.current = false;
      cancelAnimation(fade);
      leaving.set(0);
      crossed.set(0);
      if (recedes) recedeOwner.set(token.current);
      morph.current = hosted && hero && !calm && !tierC ? takeSheetMorph() : null;
      if (morph.current) { heroShown.set(0); heroChrome.set(0); bodyIn.set(0); bodyIn.set(withDelay(motionValues.morph.contentAt, withTiming(1, timing(t.flow)))); }
      // a host sheet opening as another closes takes its scrim over (the other one drops away under it)
      const prev = hosted && recent(lastClose, me) ? panels.get(lastClose!.id) : null;
      if (hosted) lastOpen = { id: me, at: Date.now() };
      if (prev && prev.closing && !prev.handed()) {
        const s = prev.scrimNow();
        prev.handOut();
        if (calm) fade.set(withTiming(1, calmFade()));
        else { fade.set(1); risen.current = false; }
        ctl.current.handIn(s);
        return;
      }
      if (calm) {
        y.set(0);
        cancelAnimation(parkCap);
        parkCap.set(1);
        fade.set(withTiming(1, calmFade()));
        scrim.set(withTiming(1, calmFade()));
      } else {
        fade.set(1);
        cancelAnimation(parkCap);
        parkCap.set(h > 0 ? 1 : sv.parkedScrim); // parked until laid out: the scrim stops at the cap until the rise
        // its first step is drawn in the tap's own commit (ease.css barely moves in its first frame, so the scrim
        // showed ~50 ms after the tap: A1W-m6, M42 asks ≤ 34 ms); the curve goes on from there
        scrim.set(Math.max(scrim.get(), sv.parkedScrim * SCRIM_FIRST));
        scrim.set(withTiming(1, timing(t.scrim, ease.css)));
        risen.current = false;
        if (h > 0) startRise(h, true); // laid out already (opened again during its exit): rises from where it is
      }
      return;
    }
    // closing
    exitH.set(h > 0 ? h : maxH); // the panel keeps its height all the way out
    handed.current = false;
    if (hosted) {
      lastClose = { id: me, at: Date.now() };
      const next = recent(lastOpen, me) ? panels.get(lastOpen!.id) : null;
      if (next && next.open) { const s = scrim.get(); ctl.current.handOut(); next.handIn(s); return; }
    }
    if (morph.current && hero) flyHeroBack();
    if (leaving.get() === 1) { arm(tapExit.current ? exitMs() : t.sheetExit * 2); tapExit.current = false; return; } // already on its way out
    if (!hosted) { arm(startExit()); return; }
    // a host sheet: a sheet opening in this same commit may take the scrim over; the plain exit starts after it had
    // the chance (its layout effect runs before this microtask)
    queueMicrotask(() => { if (!handed.current && !openRef.current) arm(startExit()); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // the tap exit: the panel travels its own height + exitExtra (ease.exit) while the scrim fades from scrimExitAt
  const exitMs = () => (calm ? t.calm : Math.max(t.sheetExit, sv.scrimExitAt + sv.scrimExitMs));
  const startExit = (): number => {
    leaving.set(1);
    exitH.set(h > 0 ? h : maxH);
    rising.current = false;
    if (calm) {
      fade.set(withTiming(0, calmFade()));
      scrim.set(withTiming(0, calmFade()));
      return exitMs();
    }
    risen.current = true;
    cancelAnimation(y);
    y.set(withTiming((h > 0 ? h : maxH) + sv.exitExtra, timing(t.sheetExit, ease.exit)));
    scrim.set(withDelay(sv.scrimExitAt, withTiming(0, timing(sv.scrimExitMs, ease.css))));
    return exitMs();
  };
  // the scrim, the close button, Escape and Android back: the exit starts now, before the screen re-renders (on native
  // the UI thread runs it while React works); if the screen keeps the sheet open, it comes back up
  const tapExit = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;

  // the photo flies back to its card when the card is still on screen; else the plain exit (and the card's photo is
  // shown again). The copy takes over from the hero on its first drawn frame (no frame shows neither), the card shows
  // its photo again as the copy crossfades into it.
  const flyHeroBack = () => {
    const m = morph.current;
    const content = hero;
    morph.current = null;
    if (!m) { sourceBack(); return; }
    measureMorphSource(m.key, (src) => {
      if (!src) { sourceBack(); return; }
      scheduleOnUI(() => {
        'worklet';
        const r = measureView(heroRef);
        if (!r || r.width <= 0) { scheduleOnRN(sourceBack); return; }
        scheduleOnRN(backTo, { x: r.pageX, y: r.pageY, w: r.width, h: r.height });
      });
      function backTo(from: MorphFrame) {
        if (!src) return;
        const hide = src.hide ?? awaySource.current;
        if (awaySource.current && awaySource.current !== hide) sourceBack();
        awaySource.current = null;
        flyOnLayer({
          render: () => content, box: { W: from.w, H: from.h }, from, fromRadius: 0, to: src.frame, toRadius: src.radius,
          duration: t.exitMorph, easing: 'drawer', scrim: null, fadeLast: motionValues.morph.crossfadeLast, backdrop: null, backdropMs: 0,
          hold: true, handOver: heroShown, source: hide ? { hide, restore: true } : null, track: src.ref,
        });
      }
    });
  };

  // the hand-over controls (host sheets)
  const ctl = useRef<PanelCtl>({ open, closing: false, scrimNow: () => 0, handed: () => false, handOut: () => undefined, handIn: () => undefined, closeNow: () => undefined });
  const handed = useRef(false);
  ctl.current.open = open;
  ctl.current.closing = !open;
  ctl.current.scrimNow = () => Math.min(scrim.get(), parkCap.get());
  ctl.current.handed = () => handed.current;
  ctl.current.handOut = () => {
    handed.current = true;
    leaving.set(1);
    exitH.set(h > 0 ? h : maxH);
    const ms = sv.handoverExitMs;
    cancelAnimation(scrim);
    // the next sheet's scrim is above this one, at least as dark: this one goes under it
    scrim.set(withTiming(0, calm ? calmFade() : timing(ms, ease.css)));
    if (calm) { fade.set(withTiming(0, calmFade())); arm(t.calm); return; }
    cancelAnimation(y);
    y.set(withTiming(y.get() + sv.handoverY, timing(ms, ease.exit)));
    fade.set(withTiming(0, timing(ms, ease.exit)));
    arm(ms);
  };
  ctl.current.handIn = (scrimFrom: number) => {
    const s = Math.max(scrimFrom, scrim.get());
    cancelAnimation(parkCap);
    parkCap.set(1); // the scrim is up already (the sheet before held it): nothing to cap
    cancelAnimation(scrim);
    if (s >= 0.999) scrim.set(1);
    else { scrim.set(s); scrim.set(withTiming(1, calm ? calmFade() : timing(t.fast, ease.css))); }
    if (calm) return;
    riseFrom.current = sv.handoverRiseFrom;
    if (h > 0) { risen.current = false; startRise(h); }
  };
  useEffect(() => {
    if (!hosted || !entryId) return;
    const c = ctl.current;
    panels.set(entryId, c);
    return () => { if (panels.get(entryId) === c) panels.delete(entryId); };
  }, [hosted, entryId]);

  const close = useCallback(() => { onClose(); }, [onClose]);
  const closeNow = () => {
    if (!open || leaving.get() === 1) { onClose(); return; }
    tapExit.current = true;
    startExit();
    onClose();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!openRef.current || !tapExit.current) return;
      tapExit.current = false; // still open: back up
      leaving.set(0);
      cancelAnimation(scrim);
      scrim.set(withTiming(1, timing(t.fast, ease.css)));
      risen.current = false;
      if (h > 0) startRise(h, true);
    }));
  };
  ctl.current.closeNow = closeNow;
  // a route's sheet: Escape on the web and Android back close it with its exit (a host sheet above it closes first)
  useEffect(() => {
    if (!open || hosted) return;
    const back = BackHandler.addEventListener('hardwareBackPress', () => { if (anyOpen()) return false; close(); return true; });
    let onKey: ((e: KeyboardEvent) => void) | null = null;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      onKey = (e) => { if (e.key === 'Escape' && !anyOpen()) close(); };
      window.addEventListener('keydown', onKey);
    }
    return () => { back.remove(); if (onKey) window.removeEventListener('keydown', onKey); };
  }, [open, hosted, close]);

  const soft = useCallback(() => haptics.soft(), []);
  // the drag, from the grabber and title or from the content at its top; the release is decided here, on the UI thread
  const follow = (dy: number) => {
    'worklet';
    if (leaving.get() === 1) return;
    const d = dy >= 0 ? dy : upward(dy);
    drag.set(d);
    const H = hv.get();
    if (crossed.get() === 0 && H > 0 && d > H * sv.dismissShare) { crossed.set(1); scheduleOnRN(soft); }
    else if (crossed.get() === 1 && H > 0 && d <= H * sv.dismissShare) crossed.set(0);
  };
  const release = (vy: number) => {
    'worklet';
    if (leaving.get() === 1) return;
    const d = drag.get();
    const H = hv.get();
    if (d > H * sv.dismissShare || vy > sv.dismissVelocity) {
      leaving.set(1);
      exitH.set(H);
      const s = scrim.get() * (1 - sv.dragScrim * clamp01(H > 0 ? d / H : 0));
      cancelAnimation(y);
      y.set(y.get() + d);
      drag.set(0);
      cancelAnimation(scrim);
      scrim.set(s);
      if (calm) {
        fade.set(withTiming(0, calmFade()));
        scrim.set(withTiming(0, calmFade()));
      } else {
        scrim.set(withTiming(0, timing(sv.scrimExitMs, ease.css)));
        y.set(withSpring(H + sv.exitExtra, { ...spring.throw, velocity: Math.max(0, vy) }));
      }
      scheduleOnRN(close); // React only learns of it
      return;
    }
    drag.set(withSpring(0, spring.dismiss));
  };
  const pan = Gesture.Pan()
    .activeOffsetY([-6, 6])
    .onStart(() => { crossed.set(0); })
    .onUpdate((e) => { follow(e.translationY); })
    .onEnd((e) => { release(e.velocityY); });
  // the content: only a downward pull while it is scrolled to its top; activated by hand, so a scroll is never taken over
  const pullX = useSharedValue(0);
  const pullY = useSharedValue(0);
  const pull = Gesture.Pan()
    .manualActivation(true)
    .onTouchesDown((e) => {
      const p = e.allTouches[0];
      if (!p) return;
      pullX.set(p.absoluteX);
      pullY.set(p.absoluteY);
    })
    .onTouchesMove((e, state) => {
      const p = e.allTouches[0];
      if (!p) return;
      const dy = p.absoluteY - pullY.get();
      const dx = p.absoluteX - pullX.get();
      if (leaving.get() === 1 || scrollY.get() > 0 || dy < -sv.pullActiveY || Math.abs(dx) > sv.pullActiveY) { state.fail(); return; }
      if (dy > sv.pullActiveY) state.activate();
    })
    .onStart(() => { crossed.set(0); })
    .onUpdate((e) => { follow(e.translationY); })
    .onEnd((e) => { release(e.velocityY); });
  // the web: at its top the scroll leaves a finger moving down to the pull (the browser would take it for an overscroll)
  const scrollRef = useRef<{ getScrollableNode?: () => HTMLElement | null } | null>(null);
  const webTop = useCallback((top: boolean) => {
    const el = scrollRef.current?.getScrollableNode?.();
    if (el && el.style) el.style.touchAction = top ? 'pan-down' : 'pan-y';
  }, []);
  useEffect(() => { if (Platform.OS === 'web' && filled) webTop(true); }, [filled, webTop]);
  const web = Platform.OS === 'web';
  const onScroll = useAnimatedScrollHandler({ onScroll: (e) => {
    const was = scrollY.get() <= 0;
    scrollY.set(e.contentOffset.y);
    const top = e.contentOffset.y <= 0;
    if (web && top !== was) scheduleOnRN(webTop, top);
  } });

  const shellH = useRef(0); // the empty shell's height, reported before the content filled the panel
  const shellWait = useRef(false);
  const lastVis = useRef(0);
  const onPanelLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!width || !height) return; // a detached page reports 0×0
    if (!filled) { shellH.current = height; return; } // the empty shell's height is not the sheet's
    const vis = Math.max(1, Math.round(height - sv.skirt));
    lastVis.current = vis;
    if (open && !risen.current && height === shellH.current) {
      // the web reports the empty shell's size once more after the content has filled it: rising from it put the panel
      // a frame at the wrong place before the real size came (a hand-over showed its resting top for a frame). Wait for
      // the filled size, two frames at most.
      if (!shellWait.current) {
        shellWait.current = true;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          shellWait.current = false;
          const v = lastVis.current;
          if (!openRef.current || risen.current || v <= 0) return;
          setH(v);
          hv.set(v);
          startRise(v);
        }));
      }
      return;
    }
    if (vis === h) return;
    const dh = h > 0 ? vis - h : 0;
    setH(vis);
    hv.set(vis);
    if (open && !risen.current) { startRise(vis); return; }
    if (open && rising.current && dh && leaving.get() !== 1) {
      // the content grew (or shrank) while rising: the top stays where it is and the spring goes on from there
      cancelAnimation(y);
      y.set(Math.max(0, y.get() + dh));
      y.set(withSpring(0, riseCfg.current, (f) => { 'worklet'; if (f) scheduleOnRN(settled); }));
      return;
    }
    if (open && risen.current && !rising.current && dh && !calm && leaving.get() !== 1) {
      // a settled panel whose content changed height (it grew to tall, a section opened): its top stays where it was and
      // glides to the new place on spring.sheetL, instead of the bottom-anchored panel jumping (M67)
      cancelAnimation(y);
      y.set(Math.max(0, y.get() + dh));
      y.set(withSpring(0, tierC ? { ...spring.sheetL, overshootClamping: true } : spring.sheetL));
    }
  };

  const scrimStyle = useAnimatedStyle(() => {
    const H = hv.get();
    const d = drag.get();
    const dim = d > 0 && H > 0 ? 1 - sv.dragScrim * clamp01(d / H) : 1;
    return { opacity: Math.min(scrim.get(), parkCap.get()) * dim };
  });
  const blurStyle = useAnimatedStyle(() => ({ opacity: blurIn.get() }));
  // the keyboard lifts the panel; a panel taller than the room above the keyboard is shortened (its own scroll takes the
  // rest) so its top stops below the status bar: never the grabber and title under the clock (Android, edge to edge)
  const topRoom = insets.top + sv.keyboardTopGap;
  const footerPad = useKeyboardInsetPad(16, insets.bottom);
  const panelStyle = useAnimatedStyle(() => {
    const k = keyboardHeight.get();
    const cap = k > 0 ? Math.max(sv.keyboardMinH, Math.min(maxH, winH - k - topRoom)) : maxH;
    return { opacity: fade.get(), maxHeight: cap + sv.skirt, transform: [{ translateY: panelOffset.get() }] };
  }, [maxH, winH, topRoom]);
  const heroStyle = useAnimatedStyle(() => ({ opacity: heroShown.get() }));
  const bodyStyle = useAnimatedStyle(() => ({ opacity: bodyIn.get() }));
  const bg = blur ? fx.glass.sheet : isTall ? fx.bg.sheetTall : kind === 'lab' ? fx.bg.sheetLab : fx.bg.panel;
  const body = <Animated.View style={[{ paddingHorizontal: padding, paddingBottom: 48 + insets.bottom }, bodyStyle]}>{children}</Animated.View>;
  const radius = isTall ? fx.radius.tall : fx.radius.three;

  return <View ref={layer} pointerEvents={open ? 'box-none' : 'none'} style={StyleSheet.absoluteFill} {...(open ? null : { 'aria-hidden': true, accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const })}>
    <Animated.View style={[StyleSheet.absoluteFill, scrimStyle]}>
      {blurOn ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, blurStyle]}><BlurView intensity={10} tint="dark" style={StyleSheet.absoluteFill} /></Animated.View> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={closeNow} style={[StyleSheet.absoluteFill, { backgroundColor: blur ? fx.scrim.sheet : fx.scrim.sheetDeep }]} />
    </Animated.View>
    <Animated.View
      accessibilityViewIsModal
      aria-modal
      onLayout={onPanelLayout}
      style={[styles.panel, { left: (winW - panelW) / 2, width: panelW, paddingBottom: sv.skirt, backgroundColor: bg, borderTopLeftRadius: radius, borderTopRightRadius: radius, borderTopColor: isTall ? fx.line.a10 : fx.line.a20 }, capped ? [styles.sides, { borderColor: isTall ? fx.line.a10 : fx.line.a20 }] : null, style, panelStyle]}>
      {blur ? <BlurView intensity={50} tint="dark" style={[StyleSheet.absoluteFill, styles.round]} /> : null}
      <SheetRiseContext.Provider value={riseShare}>
      <GestureDetector gesture={pan}>
        <View style={[styles.head, { paddingHorizontal: padding }]}>
          <View style={styles.grabber} accessible={false} />
          {title || closeButton ? <View style={styles.titleRow}>
            {title ? <T v="heading" style={styles.title}>{title}</T> : <View style={styles.title} />}
            {closeButton ? <IconButton icon="x" label="Close" size={32} iconSize={16} kind="glass" onPress={closeNow} /> : null}
          </View> : null}
        </View>
      </GestureDetector>
      {filled && hero ? <Animated.View ref={heroRef} collapsable={false} testID="fx-sheet-hero" style={[heroInset ? { marginHorizontal: heroInset } : null, heroStyle]}>
        <MorphChromeContext.Provider value={heroChrome}>{hero}</MorphChromeContext.Provider>
      </Animated.View> : null}
      {!filled ? null : noScroll ? body : <GestureDetector gesture={pull}>
        <View style={styles.scrollWrap} collapsable={false}>
          <Animated.ScrollView ref={scrollRef as never} bounces={false} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={styles.scroll} onScroll={onScroll} scrollEventThrottle={16}>{body}</Animated.ScrollView>
        </View>
      </GestureDetector>}
      {filled && footer ? <Animated.View onLayout={(e) => setFooterH(Math.round(e.nativeEvent.layout.height))} style={[styles.footer, { paddingHorizontal: padding }, footerPad]}>{footer}</Animated.View> : null}
      </SheetRiseContext.Provider>
    </Animated.View>
  </View>;
}

/** A route presented as a sheet (meal-log, book-appointment, move-appointment): the panel inside the route; `onClose`
 *  runs after the exit (usually router.back()). Escape on the web and Android back play the exit too (SheetPanel),
 *  unless a host sheet is open above it (that one closes first). */
export function SheetScreen({ onClose, children, ...options }: SheetOptions & { onClose: () => void; children?: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
    <SheetPanel open={open} onClose={() => setOpen(false)} onExited={onClose} {...options}>{children}</SheetPanel>
  </View>;
}

const styles = StyleSheet.create({
  fit: { flex: 1 },
  backdrop: { flex: 1, overflow: 'hidden' },
  panel: { position: 'absolute', bottom: -sv.skirt, borderTopWidth: 1, overflow: 'hidden' },
  sides: { borderLeftWidth: 1, borderRightWidth: 1 },
  round: { borderTopLeftRadius: fx.radius.three, borderTopRightRadius: fx.radius.three },
  head: { paddingTop: 12 },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: fx.line.a20, marginBottom: 24 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  title: { flex: 1 },
  scrollWrap: { flexShrink: 1 },
  scroll: { flexGrow: 0 },
  footer: { paddingTop: 12, borderTopWidth: 1, borderTopColor: fx.line.a05 },
});
