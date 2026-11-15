/* The workspace's section transition: the wrapper around the shell's <Outlet/>. The leaving section fades up and out,
   the arriving one rises into place on the brand's ease-out; one section at a time, so nothing overlaps or shifts.
   At rest the wrapper is a plain block (opacity 1, no transform), the same box the shell always had. With the motion
   layer off it is the same element, at rest from its first frame, and nothing animates. The elements never change with
   the setting (only their animation props do), so turning reduced motion on or off while a page is open does not
   remount the section, and what someone has typed into its form stays. */
import React, { useRef } from 'react';
import { useOutlet } from 'react-router-dom';
import { AnimatePresence, motion, useIsPresent, type MotionProps } from 'framer-motion';
import { EASE_OUT_ARRAY, useMotionAllowed } from './env';

/** Where the wrapper rests. It is also the target while motion is off, so a change of setting never takes the target
    away (framer-motion sends a value whose target is removed back to its starting value). */
const REST = { opacity: 1, y: 0 } as const;

/** The wrapper's animation props: the arrival and the exit while motion is allowed; at rest from the first frame, with
    no exit, while it is not. */
export function routeMotion(allowed: boolean): Pick<MotionProps, 'initial' | 'animate' | 'exit'> {
  if (!allowed) return { initial: false, animate: { ...REST, transition: { duration: 0 } }, exit: undefined };
  return {
    initial: { opacity: 0, y: 10 },
    animate: { ...REST, transition: { duration: 0.34, ease: EASE_OUT_ARRAY } },
    exit: { opacity: 0, y: -6, transition: { duration: 0.14, ease: [0.4, 0, 1, 1] } },
  };
}

export function RouteTransition({ routeKey, children }: { routeKey: string; children: React.ReactNode }) {
  return <RouteFrame allowed={useMotionAllowed()} routeKey={routeKey}>{children}</RouteFrame>;
}

/** The same two elements whether motion is allowed or not (AnimatePresence around one keyed motion.div); only the
    animation props differ. */
export function RouteFrame({ allowed, routeKey, children }: { allowed: boolean; routeKey: string; children: React.ReactNode }) {
  return <AnimatePresence mode="wait">
    <motion.div key={routeKey} {...routeMotion(allowed)}>{children}</motion.div>
  </AnimatePresence>;
}

/** The shell's outlet, held still while its section is leaving: without this the leaving section would render the
    arriving route for the length of its exit. While present it is exactly <Outlet/>. */
export function RouteOutlet() {
  const outlet = useOutlet();
  const present = useIsPresent();
  const held = useRef(outlet);
  if (present) held.current = outlet;
  return <>{held.current}</>;
}
