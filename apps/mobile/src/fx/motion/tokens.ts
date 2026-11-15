/* The premium layer's motion tokens: PREMIUM §1.1 with the final values of AMENDED_PLAN_NOTES §3. Timings, easings,
   springs and distances only (easings are plain worklet functions, so a timeline can call them on the UI thread); every colour comes from `fx` / `fx.premium` in src/theme.ts. Every timing and spring
   carries `ReduceMotion.System`, so an animation started while the OS asks for reduced motion lands at once; the
   components also check `useMotion().calm` and draw their rest state instead. src/motion (the staff layer) is frozen:
   its tokens are imported, never changed. */
import { Platform } from 'react-native';
import { Easing, ReduceMotion, type EasingFunction } from 'react-native-reanimated';
import { createSerializable } from 'react-native-worklets';
import { springs as staffSprings } from '@/motion/tokens';
import { colors, fx } from '@/theme';

export const ease = {
  /** The signature curve: the earlier app's `--ease-out` and the brand animation's `--bpEaseOut`. Default for timed motion. */
  expo: Easing.bezierFn(0.16, 1, 0.3, 1),
  /** The brand loop sweep, sheen sweeps. */
  inOut: Easing.bezierFn(0.65, 0, 0.35, 1),
  /** Point pops (THEME `--ease-spring`). */
  pop: Easing.bezierFn(0.34, 1.56, 0.64, 1),
  /** Drag-to-dismiss settle. */
  drawer: Easing.bezierFn(0.32, 0.72, 0, 1),
  /** The 3D mark's turn-in (src/motion BrandMark3D's curve). */
  turn: Easing.bezierFn(0.3, 0.5, 0.25, 1),
  /** Count-ups (the earlier app's `1-(1-t)^3`), the nutrition ring. */
  cubicOut: Easing.out(Easing.cubic),
  /** The brand o-ping ring. */
  ping: Easing.bezierFn(0.22, 0.61, 0.36, 1),
  /** CSS `ease` (the brand rung cool-down) and `ease-in-out` (the helix heartbeat, breathing). */
  css: Easing.bezierFn(0.25, 0.1, 0.25, 1),
  cssInOut: Easing.bezierFn(0.42, 0, 0.58, 1),
  /** Tailwind `ease-out` (`duration-500 ease-out` bars). */
  tailOut: Easing.bezierFn(0, 0, 0.2, 1),
  linear: Easing.linear,
  /** Tap-started travel off screen accelerates away (v2). */
  exit: Easing.bezierFn(0.4, 0, 1, 1),
};

const sys = { reduceMotion: ReduceMotion.System } as const;

/** Springs (Reanimated 4 physics form; stiffness, damping and mass always explicit). */
export const spring = {
  tab: { stiffness: 300, damping: 30, mass: 1, ...sys },
  /** The nav halo when the pager is not driving it (Framer bounce .2, duration .6). */
  indicator: { duration: 600, dampingRatio: 0.8, ...sys },
  navIcon: { stiffness: 300, damping: 10, mass: 1, ...sys },
  navIn: { stiffness: 100, damping: 20, mass: 1, ...sys },
  sheet: { stiffness: 300, damping: 25, mass: 1, ...sys },
  sheetL: { stiffness: 320, damping: 28, mass: 1, ...sys },
  quiz: { stiffness: 280, damping: 28, mass: 0.8, ...sys },
  item: { stiffness: 420, damping: 28, mass: 1, ...sys },
  pop: { stiffness: 400, damping: 20, mass: 1, ...sys },
  knob: { stiffness: 400, damping: 30, mass: 1, ...sys },
  /** The Wellness Score card's rise, gentle overshoot kept. */
  soft: { stiffness: 100, damping: 10, mass: 1, ...sys },
  stagger: { stiffness: 200, damping: 22, mass: 1, ...sys },
  tilt: { stiffness: 300, damping: 20, mass: 0.5, ...sys },
  /** Segmented pill glide: critically damped (v2; was 260/22, which overshot). 500/44.7 (was 380/39) so a 165-229 pt
   *  move settles inside M17's 380 ms (wave-1 tokens addendum; 380/39 measured 383-450 ms). */
  segment: { stiffness: 500, damping: 44.7, mass: 1, ...sys },
  release: { stiffness: 420, damping: 26, mass: 1, ...sys },
  dismiss: { stiffness: 420, damping: 34, mass: 1, ...sys },
  /** A drop or a streak day filling (THEME hydration and streak). */
  drop: { stiffness: 400, damping: 18, mass: 1, ...sys },
  /** The Sending loader's flame (stiffness 200, damping 18). */
  flame: { stiffness: 200, damping: 18, mass: 1, ...sys },
  brandRelease: { ...staffSprings.brandRelease, ...sys },
  /** The mark's glide between two on-screen places (critically damped, 34.6 % at +100 ms). */
  mark: { stiffness: 150, damping: 24.5, mass: 1, ...sys },
  /** A gesture's release continuation: always started with the finger's velocity ({ ...spring.throw, velocity }). */
  throw: { stiffness: 380, damping: 40, mass: 1, overshootClamping: true, ...sys },
  /** The stepper's limit bump. */
  bump: { stiffness: 600, damping: 18, mass: 1, ...sys },
  /** The tab icon pop at tier C, without overshoot. */
  navIconC: { stiffness: 300, damping: 35, mass: 1, ...sys },
  /** The shelf's momentum lean returning. */
  lean: { stiffness: 260, damping: 22, mass: 1, ...sys },
} as const;

/** Durations (ms). */
export const t = {
  pop: 120,
  press: 90,
  guide: 180,
  fast: 200,
  base: 300,
  scrim: 300,
  flow: 400,
  reveal: 420,
  morph: 520,
  /** Bio rings (PREMIUM sweepS) / wearable rings and count-ups (sweepM) / the Wellness Score ring (sweepL). */
  sweepS: 900,
  sweepM: 1200,
  sweepL: 1800,
  /** Bio metric ring sweep (AMENDED §3: 1000 ms, ease.expo). */
  metricRing: 1000,
  settle: 1500,
  /** A changed number counts from its old value. */
  change: 600,
  verifiedHold: 700,
  toastTop: 3200,
  toastBottom: 2400,
  /** Native overlay transition (iOS) and the web FlowEnter. */
  overlay: 260,
  /** Today's brief starts this long after its card lands. */
  typeDelay: 120,
  caret: 550,
  marquee: 18000,
  shimmer: 1400,
  halo: 3200,
  spinner: 1000,
  typing: 1100,
  liveDot: 2000,
  chevronNudge: 1600,
  /** An in-place swap's outgoing layer, a state colour mix, the reduced-motion crossfade. */
  swapOut: 160,
  stateMix: 180,
  calm: 150,
  /** A sheet leaving (with ease.exit). */
  sheetExit: 240,
  /** Exits at about 0.65 of their entrance (300 / 400 / 520). */
  exitBase: 200,
  exitFlow: 260,
  exitMorph: 340,
  overlayExit: 170,
  /** Neighbour pages mount this long after the pager settles; a parked page detaches after this long. */
  premount: 600,
  detach: 600,
} as const;

/** Timing options with the system reduce-motion rule attached. A worklet: entrances (Reveal, Toast, PhotoMorph,
 *  MarkHandoff, FlowEnter) build their options on the UI thread, where a plain function is a remote one and crashes a
 *  native build. The default easing is resolved in the body, never in the parameter list: on the UI thread the worklets
 *  plugin unpacks the captured values (`const [ease, sys] = this.__closure`) as the body's first statement, after the
 *  parameter defaults have run, so a default such as `easing = ease.expo` throws "Property 'ease' doesn't exist" (the
 *  wave-1 Android launch crash). Keep every worklet default a literal or resolve it in the body. */
export const timing = (duration: number, easing?: EasingFunction) => {
  'worklet';
  return { duration, easing: easing ?? ease.expo, ...sys };
};

/** The reduced-motion crossfade: a short linear opacity or colour change that plays even when the OS asks for reduced
 *  motion (every other timing keeps ReduceMotion.System). A worklet: calm paths build it on the UI thread, so the
 *  default duration (t.calm) is resolved in the body, not in the parameter list (see timing above). */
export const calmFade = (ms?: number) => {
  'worklet';
  return { duration: ms ?? t.calm, easing: ease.linear, reduceMotion: ReduceMotion.Never };
};

/** Timings only the kit core uses (moved from effects.ts, which re-exports them). */
export const tk = { toastIn: 400, toastOut: 200, accordion: 250, navFade: 220, stepper: 150 } as const;

/** The quiz stepper's range bar (stiffness 200, damping 25). */
export const springBar = { stiffness: 200, damping: 25, mass: 1 } as const;

/** Distances, thresholds and ladders the components and the kit core share. */
export const motionValues = {
  /** Camera distances: cards (TiltCard, shelf, stack) and the brand mark (splash, hand-off). */
  perspective: { card: 900, mark: 420 },
  /** Scroll reveal per tier (PREMIUM §1.4 and §1.9): `line` is the share of the viewport an item's top must cross. */
  reveal: {
    A: { y: 20, scale: 0.985, duration: 420, step: 60, maxSteps: 4 },
    B: { y: 12, scale: 1, duration: 320, step: 50, maxSteps: 4 },
    C: { y: 0, scale: 1, duration: 200, step: 30, maxSteps: 4 },
    line: 0.92,
    /** A fling faster than this (px/s) shows crossing items at rest. */
    fling: 2500,
    /** Items crossing the line in the same frame are spaced this far apart, at most scrollMaxSteps slots. */
    scrollStep: 50,
    scrollMaxSteps: 4,
    /** A null measure is retried on this many following frames before the item is shown at rest. */
    measureRetries: 2,
    /** Progress at which an entrance counts as landed (onLand, RevealContext.landed). */
    landAt: 0.95,
    /** Data inside a Reveal (rings, counts, lines) starts this long after the reveal begins, plus dataStep per index. */
    dataDelay: 120,
    dataStep: 60,
    dataMaxSteps: 4,
    /** from='scale' grows from this scale without the rise. */
    scaleFrom: 0.95,
    /** Native: an entrance waiting under the launch sting's lockup draws at this opacity (gestureState.warmUnder). */
    warmOpacity: 0.02,
  },
  /** Tab pager (PREMIUM §1.3A): finger-following swipe. */
  swipe: { activeOffsetX: 16, failOffsetY: 10, commitProduct: 10000, commitShare: 0.42,
           underShift: 0.3, underScale: 0.02, dim: 0.45, rubberC: 0.22, rubberK: 0.55 },
  /** Bottom sheets: drag rubber band and dismiss, the skirt, the exit and the hand-over between sheets. */
  sheet: { rubber: 0.25, dismissShare: 0.25, dismissVelocity: 900, skirt: 48, startOffset: 24, upC: 40, upK: 0.25, exitExtra: 40,
           scrimExitMs: 200, scrimExitAt: 40, dragScrim: 0.6, handoverWindow: 300, handoverY: 40, handoverExitMs: 160, handoverRiseFrom: 0.4,
           hideOutsideTimeout: 300, recedeScale: 0.97, recedeY: 8, recedeRadius: 12, pullActiveY: 12,
           // FU-m4: the scrim's most while the panel is still parked below the edge (a heavy sheet's content takes a
           // moment to lay out); it goes on to full with the rise, over t.scrim
           parkedScrim: 0.5,
           // with the keyboard up: the panel's top stays this far below the status bar, and keeps at least this height
           keyboardTopGap: 8, keyboardMinH: 160 },
  /** Drag to dismiss on overlays. */
  dismiss: { follow: 0.9, shrink: 0.12, radius: 24, radiusOver: 120, backdropMin: 0.3, distance: 120, velocity: 900,
             /** The overlay's content dims to this while its hero is pulled (M47). */
             contentMin: 0.6 },
  /** Quiz stepper numeral re-key and auto-repeat (AMENDED §3). */
  /** `repeat` 60 (was 80): M22's 1.4 s hold reaches 18 steps (80 capped it at 15; wave-1 tokens addendum). */
  stepper: { y: 10, scaleFrom: 0.95, duration: 150, firstRepeat: 350, repeat: 60, armMs: 60, armSlop: 6, rollbackWithin: 150,
             fastRepeat: 50, fastAfter: 1500, roll: 14, rollMs: 140, heldRoll: 6, heldRollMs: 70, heldBelow: 150, bump: 4 },
  /** Sign-in field crossfade (AMENDED §3). */
  fieldSwap: { y: 8, duration: 200 },
  /** Press scale ladder (THEME §12.5). */
  // scrollDelay: a card or row in a scroller shows its press this long after touch-down (a scroll that starts on it
  // takes the touch first); the web's browser cancels a touch that becomes a scroll sooner, so it waits less
  press: { card: 0.98, cta: 0.97, tile: 0.96, chip: 0.94, icon: 0.9, tilt: 3.5, inMs: 90, scrollDelay: 70, scrollDelayWeb: 40 },
  /** TiltCard maximum degrees by card (PREMIUM §1.5). */
  tilt: { score: 8, banner: 6, featured: 5, package: 5, activity: 4, meal: 3, row: 2, default: 4,
          /** Device tilt: a new aim within this many degrees of the last one keeps the springs going (sensor noise). */
          deadband: 0.05 },
  /** Large-title collapse and compact bar (PREMIUM §1.4). */
  header: { collapse: 56, barFrom: 48, barTo: 88, barHeight: 44, titleRise: 6, titleScale: 0.94, titleShift: 0.3, groundIn: 16 },
  /** Shelf carousel geometry (PREMIUM §1.4). */
  shelf: { cardW: 150, cardH: 128, gap: 12, gutter: 20, leanVx: 1800, leanDeg: 6, parallaxVx: 400,
           /** The lean follows each scroll event over this long and springs back once no event has come for as long. */
           leanIdleMs: 34 },
  /** The tab pager (v2): attached pages, the edge shadow, the header lag, pre-mounting and the first visit. */
  pager: { attached: 3, edgeShadow: 28, edgeShadowMax: 0.35, edgeShadowGain: 3, headerLag: 0.15, premountTierC: 1500,
           nativeIdleExtra: 400, contentFade: 200, mouseClickGuard: 50, limitAt: 0.1, firstVisitCap: 900,
           /** Native: the most recent pages kept mounted (the focused one included); Home and the neighbours always are. A
            *  page is unmounted only once it has not been in front or beside the page in front for dormantAfter ms. */
           mounted: 3, dormantAfter: 12000,
           /** Native, tier C: the pages laid out while Home is in front (Home and the neighbour a swipe reveals). Android
            *  pins the bitmaps of every laid-out page in the GPU cache on every frame; Home, Train and one more photo
            *  page (Store) held more than its 124 MB on the 2 GB emulator, and Home's scroll uploaded and dropped
            *  pictures on its frames (gate r5 R5-A1). */
           attachedHomeC: 2,
           /** Native: how long after a page's scroll comes to rest the pager's idle work (a neighbour's pre-mount, a
            *  dormant page's unmount) still waits. Scrolling comes in bursts a fraction of a second apart; a page mounted
            *  in such a gap drew 150-280 ms frames on the 2 GB emulator just as the next fling began (release G2-1). */
           scrollIdleHold: 1500 },
  /** An in-place flow step swap (FlowSwap). */
  flowSwap: { exitY: -10, exitMs: 240, enterY: 10, enterMs: 400, enterAt: 120 },
  /** Overlays (routes presented over the tabs). */
  overlay: { enterY: 16, enterAt: 60, androidAt: 150, backdropMs: 120, exitY: 10, backdropOutAt: 50, fallbackExtra: 80, preloadAfter: 4000 },
  /** Count-ups: the delta chip, the honest pop, the native fallback rate, the Wellness count at tier C. */
  count: { deltaRise: 6, deltaMs: 300, deltaHold: 2400, popOpacity: 0.6, popScale: 0.92, popMs: 120, fallbackHz: 20, wellnessC: 800 },
  /** The floating icon pill's edges and icon pop. */
  pill: { edgeWide: 56, clearWide: 32, edgeNarrow: 40, clearNarrow: 24, narrowBelow: 360, iconDip: 0.9, iconPop: 1.1, colourMs: 150 },
  /** Today's brief: a line rise with the caret. */
  brief: { lineRise: 6, lineMs: 420, lineStep: 60, maxLines: 4, caretW: 2, caretH: 14, cFadeMs: 200 },
  /** Loaders under reduced motion: the static caption's wait. */
  loader: { calmCaptionAfter: 1000 },
  /** The rest timer's end beat. */
  timer: { beat: 1.04 },
  /** TrendChart: the line and the latest point on separate clocks. */
  chart: { lineMs: 900, dotMs: 300, pointDelay: 900, pointMs: 500, lineMsC: 400 },
  /** StretchyHeader at tier C. */
  stretchy: { cFadeMs: 300 },
  /** SwitchView's sub-view slide. */
  switchView: { exitX: 12, enterX: 20, enterAt: 40, enterMs: 300, cMs: 200 },
  /** Segmented at tier C; `slop`: on the web a release that moved further than this from the press springs back. */
  segment: { cMs: 200, slop: 6 },
  /** The smallest touch target (WCAG 2.5.5 / Apple 44 pt; Android's 48 dp): a smaller control reaches it with slop. */
  touch: { min: 44, minAndroid: 48 },
  /** The toggle knob. */
  toggle: { calmMs: 120, from: 2, to: 22 },
  /** Inputs: focus, the error line and the shake. */
  field: { focusMs: 200, errorRise: 4, errorMs: 160, shake: [0, -6, 6, -4, 4, -2, 0], shakeMs: 300 },
  /** Accordion open and close. */
  accordion: { openMs: 250, closeMs: 170 },
  /** Toasts: the stack depth, the exit, the check, the swipe away and the calm crossfades. */
  toast: { depthMs: 200, depthY: 8, depthScale: 0.04, exitY: -20, blur: 12, checkMs: 180, checkAt: 60, errorShake: 3, swipeY: 24, swipeV: 600, calmIn: 150, calmOut: 120,
           /** A top toast enters from this far above; a bottom pill rises this far; the swipe-up pan activates past panY. */
           enterY: -80, pillRise: 20, panY: 8 },
  /** The verified overlay. */
  verified: { titleY: 6, titleMs: 200, titleAt: 120, checkMs: 180, checkAt: 60, burstFrom: 0.8, burstTo: 2, burstOpacity: 0.8, burstMs: 600, exitScale: 1.06, veilOutMs: 180,
              /** The reduced-motion fade out. */
              calmOut: 120 },
  /** Empty, error and success states. */
  states: { tileFrom: 0.92, tileMs: 320, rise: 8, step: 60, maxSteps: 3, railMs: 260, fadeMs: 200 },
  /** A check mark or an option's badge leaving (unchecked), and the check's ring burst. */
  check: { outMs: 140, burstMs: 600 },
  /** The code boxes. */
  otp: { pasteStep: 30, clearMs: 120, clearAfter: 600, calmBorderMs: 150,
         /** The error shake's keyframes (pt) over field.shakeMs. */
         shake: [-8, 8, -6, 6, -3, 0] },
  /** The photo morph and its pull-back. */
  morph: { scrimFadeMs: 160, badgeOutMs: 120, contentOutMs: 160, backdropOutMs: 220, crossfadeLast: 100, activeOffsetY: 12, failOffsetX: 16, slideOutMs: 240, contentAt: 120,
           /** Native opening (M69): the copy shows once its pictures are drawn (at most pictureCapMs after it mounts), and
            *  flies after startFrames quiet frames in a row (a frame ≤ mark.quietFrameMs after the one before; at most
            *  quietCapMs), so the route's mount and the picture's upload stay out of the flight's first frames. */
           pictureCapMs: 450, startFrames: 2, quietCapMs: 200,
           /** Native opening: the flight's clock moves on by each frame's time, at most maxStepMs (two 60 Hz frames), so a
            *  stalled frame pauses the flight instead of skipping its travel; firstStepMs is the first frame's step. */
           maxStepMs: 34, firstStepMs: 17,
           /** The controls over a hero a photo flew into (a sheet hero's close button) fade in after the landing (M83). */
           chromeInMs: 160,
           /** A closing copy also waits for a picture that mounts within its first settleFrames frames (a pager page). */
           settleFrames: 3,
           /** The tap's answer (C02): on the release the source photo zooms in its own frame to liftZoom over liftMs
            *  (ease.expo, on the UI thread, before the route mounts); the opening copy starts from that zoom and eases
            *  it back to 1 over the flight. liftHoldMs: a lift no stage took is let go after this long. */
           liftZoom: 1.06, liftMs: 140, liftHoldMs: 3000,
           /** A close's copy starts flying once its fade (contentOutMs) is this share of the way through (C12). */
           closeFlyAt: 0.5,
           /** A source that gives its own picture (MorphSource home, FU-m5): the closing copy crossfades into it over
            *  this share of its flight (ease.css), so it lands as the source's photo. */
           homeBlendBy: 0.6,
           /** Its words (MorphSource home.over) fade in above the copy between these shares of the flight, as the copy
            *  reaches the source (FU-m5); early enough that the card's title is back before the closing copy reaches
            *  its line (A1W-m1: from 0.3 it blinked out for two frames as the copy covered it). */
           homeWordsFrom: 0.1, homeWordsTo: 0.3 },
  /** The mark's hand-off between the splash, sign-in and Home. */
  mark: { cap: 2500, lateFadeMs: 300, lateScaleFrom: 0.9, waitC: 1400, arcMinDx: 24, arcPow: 1.6, startFrames: 2, earlyMountAt: 1500, fresh: 1500, crossfadeC: 200, layerFadeMs: 150,
          /** The sign-in's mark held over a Home still on its way (a slow network): after loaderAfter ms with no taker the
           *  splash's 48 pt ring loader fades in under it over loaderFadeMs (SB-5), and goes with the hand-off. */
          loaderAfter: 400, loaderFadeMs: 200,
          /** A frame counts as quiet when it comes at most quietFrameMs after the one before; a wait for quiet frames
           *  gives up after quietCapMs. */
          quietFrameMs: 50, quietCapMs: 600 },
  /** The splash's skip control. */
  splash: { skipPressOpacity: 0.7, skipPressScale: 0.96, skipPressMs: 100, skipFadeMs: 200 },
  /** A photo or video poster dissolving in. */
  media: { dissolveMs: 180 },
  /** The decorative loops (orbs, the score halo, the live dot, the marquee, the tier-B sway) pause while a tab page
   *  scrolls, on the UI thread, and resume from where they were scrollPauseMs after its last scroll frame (C01: a
   *  scroll redraws the whole page on every frame already; a loop then only added work to those frames). */
  loop: { scrollPauseMs: 150 },
  /** Every number the screen packages use, keyed by change id (screens add no literals). */
  screens: {
    m52: { holdScale: 0.98, prefetchCap: 600, cFadeMs: 200 },
    /** shiftMs: the web's measured glide of the block after the form runs on ease.cubicOut, not expo (expo moves a 103 pt
     *  shift 35 pt in its first frame, over M53's 20 pt per frame; cubicOut measured 14-16). */
    m53: { outY: -8, outMs: 140, inY: 8, inMs: 220, inAt: 60, heightMs: 300, firstDelay: 320, snapAt: 0.2, shiftMs: 300 },
    m54: { swapMs: 150 },
    m55: { photoFadeMs: 300, photoScaleFrom: 1.04, circleMs: 300, firstGrowFrom: 0.8, backX: -8, backMs: 200, nextMs: 300,
           /** The slides' words leave and enter ±textX over textMs, the new ones textAt in (M55, M59). */
           textX: 20, textMs: 500, textAt: 60 },
    // clearRise/clearMs: a block held under the mark's flight (MarkClear) rises this far and enters over this long once
    // the path is clear
    m56: { liftScale: 1.08, liftMs: 120, eyebrowLag: 80, clearRise: 16, clearMs: 320 },
    // minMs: the least time 'Sending your answers' shows; fillMs: its bar's fill to 100 % once the work is done;
    // exitMs: Sending's exit to Home (fadeMs stays for the other beats that read it)
    m57: { beats: 4, beatStep: 70, rise: 14, beatMs: 420, holdMax: 600, flamePeak: 1.15, flameEnd: 0.9, tileTurn: 12, fadeMs: 280, homeAt: 120, minMs: 700, fillMs: 200, exitMs: 240 },
    m58: { exitShare: 0.6, exitOpacityBy: 200, optionStep: 40, optionMax: 4, optionRise: 12, titleY: 8, titleMs: 250,
           shake: [0, -8, 8, -6, 6, 0], shakeMs: 360, flamePeak: 1.15, cMs: 200,
           /** An option's rise; a failed save's shake waits for the deck to land. */
           optionMs: 300, shakeAfter: 400 },
    m59: { textFollow: 1, photoFollow: 0.6, rubber: 0.3, commitShare: 0.25, commitV: 500, activeOffsetX: 12, failOffsetY: 10 },
    m60: { enableMs: 200, glowMs: 300, pulse: 1.02, pulseMs: 240, photoTo: 0.14, photoScaleFrom: 1.1, photoScaleTo: 1.06, photoMs: 1200, orbsMs: 900, hairlineMs: 500 },
    c05: { beats: 4, beatStep: 70, rise: 14, beatMs: 420 },
    /** sweepMs 1200 (was 1600) and landAt 0.6 (was 0.95): the score starts while the soft spring settles, so the number
     *  shows within 1.6 s of Home (the critics' 0.4-1.0 s of an empty dial); Reveal reads landAt for the soft spring. */
    m61: { tierFadeMs: 200, sweepMs: 1200, sweepMsC: 800, landAt: 0.6 },
    m62: { countMs: 600, startAt: 0.9, lifeMs: 900 },
    /** cardAt 250 and activityAt 300 (were 400 and 450): the score card follows the greeting within 300 ms. */
    m63: { heroMs: 1500, heroFrom: 1.1, heroOpacity: 0.4, greetingAt: 200, greetingX: -20, ringAt: 300, ringFrom: 0.8, cardAt: 250, cardY: 30, activityAt: 300,
           /** Home waits this long for /me before showing its skeleton; the choose-a-package card's delay. */
           skeletonAfter: 600, chooseAt: 350 },
    m64: { firstFrom: 0.97, firstOpacity: 0.4, firstMs: 420, step: 60, maxSteps: 4, arcC: 800, countC: 600 },
    m65: { washSolidTo: 0.55 },
    m66: { dropStep: 40, dropPeak: 1.18, fillMs: 120, barMs: 500, glintMs: 700, pctMs: 300,
           /** A drop's rise to dropPeak before spring.drop returns it. */
           dropUpMs: 90 },
    m67: { inboxInX: 20, inboxInMs: 300, inboxOutX: 12, inboxOutMs: 160, rowY: 8, rowStep: 40, rowMax: 4, rowAt: 120, dotMs: 200,
           bell: [0, 12, -10, 6, 0], bellMs: 500, streakRise: 4, sparkMs: 360,
           /** An inbox row's rise; the travelled line dissolving as the trend chart draws; the streak flame's rise. */
           rowMs: 300, handOffMs: 300, flameMs: 300 },
    m68: { posterFadeMs: 300, badgeOutScale: 1.3, badgeOutMs: 200, cFadeMs: 200,
           /** The play badge's start scale when it springs back in on pause. */
           badgeInFrom: 0.5 },
    m69: { phase2After: 520 },
    m70: { ringFrom: 0.92, ringMs: 300, digitRoll: 8, digitMs: 150, heightMs: 300 },
    m71: { rowY: 12, rowMs: 300, rowStep: 50, rowMax: 4, rowOutMs: 160, layoutMs: 300, photoMs: 450, cMs: 200 },
    m72: { labelOutMs: 120, disc: 56, discMs: 300, checkMs: 250, swapAfter: 400,
           swap: { exitY: -10, exitMs: 160, enterY: 12, enterMs: 300, enterAt: 40 },
           badge: 64, burstFrom: 0.8, burstTo: 2, burstMs: 600, titleY: 12, titleMs: 420, statsMs: 600, statsStep: 60, completedMs: 600, weekSweepMs: 700 },
    m73: { colourMs: 200, sweepMs: 240, hairlineMs: 300, digitRoll: 8, digitMs: 150, greenFlashMs: 300, untickMs: 140 },
    m74: { scrimFrom: 0.3, scrimTo: 0.45, headerH: 56 },
    m75: { outX: 12, outMs: 160, inX: 20, inMs: 300, spinnerAfter: 300 },
    m76: { guideMs: 180, guideY: 6, chipFrom: 0.85, chipMs: 160, chipStep: 40, cueX: -8, cueMs: 180, cueStep: 60, panelOutMs: 100,
           stripX: 8, stripOutMs: 120, stripInMs: 180, scrubMs: 250, weekX: 24, weekOutMs: 160, weekInMs: 260, effortStep: 25, effortMs: 160, playBadgeOutMs: 140 },
    c07: { heroFadeMs: 300 },
    /** webScrollMs 360 (was 280): a one-line message adds 98 px, and 280 ms peaked at 10 px a frame (target 8). */
    m77: { chipsHold: 600, chipsFadeMs: 200, pendingY: 44, pendingMs: 280, bubbleY: 8, bubbleScale: 0.97, webScrollMs: 360, cMs: 160 },
    m78: { firstBatch: 6, batch: 6, layoutMs: 300, adherenceMs: 600, removeMs: 160 },
    m79: { dotMinMs: 600, dotMaxMs: 900, dotStep: 60 },
    m80: { storeY: 32, storeStep: 120, profileMs: 1200, tilePopFrom: 0.92, tileStep: 50, fuelArcMs: 600, macroStep: 60,
           /** Fuel's first ring and count of the session; Profile's week bars' first grow and their step; the arc-head glow. */
           firstSweepMs: 1000, weekMs: 1000, weekStep: 50, glowOpacity: 0.6 },
    m81: { badgeFrom: 0.6, burstStroke: 1.5, burstFrom: 0.8, burstTo: 2, burstMs: 600, titleY: 10, titleAt: 80, refAt: 140, refFlashFrom: 0.6, refFlashMs: 120,
           stepsAt: [200, 260, 320, 380], stepY: 8, stepMs: 300, railMs: 400, slideX: 24, slideMs: 220, shake: [0, -8, 8, -6, 6, 0], shakeMs: 360,
           /** The segmented progress fill (the earlier app's 500 ms). */
           segmentMs: 500 },
    m82: { heartPeak: 1.22, heartInMs: 90, heartBurstTo: 1.8, heartBurstOpacity: 0.6, heartBurstMs: 400, unsaveFrom: 0.9, unsaveMs: 140,
           dimTo: 0.45, oldOutMs: 120, newInMs: 200, newStep: 40, newMax: 4, planeX: 6, planeY: -6, planeOutMs: 140, planeInY: 6, planeInMs: 160,
           sendingSwapMs: 200, slotFrom: 0.94, slotFillMs: 200, ctaY: 6, ctaMs: 200, ctaColourMs: 300, ctaPulse: 1.02, ctaPulseMs: 240 },
    m83: { flyMs: 520, cascadeAt: 160, backMs: 340 },
    c06: {},
  },
} as const;

/* Native: the token objects (and the theme) are serialized for the UI runtime once, retained there, before any worklet
   captures them. A worklet captures the whole object it reads from (`S.m63.ringAt` captures all of
   motionValues.screens, `spring.tab` every spring), and a plain object in a worklet's closure is rebuilt on the UI
   runtime each time a new worklet is unpacked there: a screen re-rendering after a tab switch or a mount under the
   splash flight rebuilt these trees (their arrays included) hundreds of times on the main thread, the 40-75 ms stalls
   of the warm swipe and the tier-A hand-off (simpleperf: SerializableObject/SerializableArray::toJSValue under
   AndroidUIScheduler.triggerUI). Retained, each is unpacked once per runtime and shared. Constants only: nothing
   writes to them. */
if (Platform.OS !== 'web') {
  // the native implementation's second parameter (shouldPersistRemote) retains the clone on every runtime
  const retain = createSerializable as unknown as (value: unknown, shouldPersistRemote: boolean) => unknown;
  for (const o of [motionValues, t, spring, ease, tk, springBar, fx, colors] as const) {
    try { retain(o, true); } catch { /* best effort: a worklet then captures it as before */ }
  }
}
