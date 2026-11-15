/* The motion layer's numbers (timings, distances, angles, camera distances), with no imports at all, so the pure depth
   maths in ./depthMath.ts, and the tests that check it in Node, can use them without React Native. ./tokens.ts
   re-exports them with the easing curves; import them from there in components. Timings, easing and depth only: no
   colour, font, size, spacing, radius or shadow lives here. */
export const motion = {
  /** Entrance with depth: the element rises a few points, grows from slightly smaller and leans back into place. */
  enter: { duration: 520, distance: 14, scaleFrom: 0.965, tiltFrom: 5 },
  /** Staggered reveals: each later sibling waits one step; long lists stop waiting after `maxSteps`. */
  stagger: { step: 55, maxSteps: 8 },
  /** Press depth on cards: a slight push away from the finger. `slop` is how far a finger may travel (points) before the
   *  touch counts as a scroll and the card lets go. */
  press: { scale: 0.985, tilt: 3.5, inMs: 110, outMs: 240, slop: 10 },
  /** The brand moment (the mark on the sign-in screen): turns in from an angle, then follows a finger and springs back. */
  brand: { duration: 1100, rotateYFrom: -26, rotateXFrom: 12, scaleFrom: 0.86, touchTilt: 16, touchScale: 0.03 },
  /** A progress fill grows from its start edge to its value. */
  progress: { duration: 760 },
  /** A milestone (a task done, a goal or milestone reached, a value saved): a short pop, or a flip like a split-flap card. */
  milestone: { popMs: 520, flipMs: 380, popFrom: 0.6, flipFrom: 90 },
  /** Screen entrance: a screen's content swings in about its vertical axis (rotateY under a perspective camera), slides
   *  a few points from the right and grows from slightly smaller. Short, and never blocks a touch. */
  screen: { duration: 440, rotateYFrom: 8, shiftFrom: 16, scaleFrom: 0.98 },
  /** The 3D brand mark (BrandMark3D): the unchanged mark in front, `layers` copies of the same image stacked behind it,
   *  the first `base` + `gap` (shares of the mark's size) behind the face, each next one `gap` further back and fainter
   *  (`opacity`, nearest first). The stack shows only
   *  while the mark is turned (fully from `revealDeg`). It turns in slowly from an angle, follows a finger (it tips
   *  towards the touch, and a drag turns it, `dragDeg` per point up to `dragMax`), then springs back flat. */
  mark: {
    layers: 6, base: 0.06, gap: 0.075, opacity: [0.55, 0.45, 0.36, 0.28, 0.2, 0.13], revealDeg: 9,
    introMs: 1900, rotateYFrom: -46, rotateXFrom: 14, scaleFrom: 0.88,
    touchTilt: 14, dragDeg: 0.55, dragMaxY: 52, dragMaxX: 34, touchScale: 0.03,
  },
  /** Light motes drifting in depth behind the brand mark: a drift of `driftCycles` loops over `driftMs` that slows to a
   *  stop (nothing runs once it has), woken again when the screen gains focus or the mark is touched. */
  motes: { driftMs: 26000, driftCycles: 1, fadeMs: 900, parallax: 16 },
  /** Scroll depth on the Home and Plan cards: while the list moves, cards trail the scroll by up to `shift` points (lower
   *  cards more) and bend into a shallow drum (up to `tilt` degrees at the top and bottom of the screen, `scale` smaller);
   *  when the scroll stops they ease back flat in `outMs`. A scroll of `velocityFull` points per millisecond is full
   *  strength. */
  scroll: { velocityFull: 2.2, inMs: 90, outMs: 560, shift: 10, tilt: 6, scale: 0.02 },
  /** Camera distance for the 3D transforms (smaller is a stronger perspective). */
  perspective: { card: 900, brand: 520, flip: 600, screen: 1200, mark: 420 },
} as const;
