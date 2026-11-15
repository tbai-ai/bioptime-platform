/* Gesture state other components follow on the UI thread. pagerPanning is 1 from the tab pager pan's onStart to its
   onFinalize (written only by src/fx/nav/Pager.tsx); TiltCard and TiltLayer return to rest while it is 1, so a card
   never stays tilted under a finger that is moving the page.
   The launch hand-off's two flags (written only by src/fx/brand: SplashSting and MarkLayer), read by the entrances and
   the data motion (src/fx/motion/Reveal):
   - warmUnder is 1 while the launch sting's opaque lockup covers a screen that is already mounted beneath it (Home under
     a restored session, or the released route) and has not started to fade. Native only: an entrance waiting at its
     start state then draws at motionValues.reveal.warmOpacity instead of 0, so the GPU compiles its programs and uploads
     its pictures under the lockup instead of in the frames the mark flies (on the 2 GB emulator, 30-50 shader compiles
     of 4-8 ms each landed in the tier-A hand-off). Nothing of it can be seen through the black.
   - markInFlight is 1 from the moment a mark is handed over to Home until it has landed (or the hand-off is cancelled):
     the data motion inside Home's cards (a ring's sweep, a sparkline's draw) waits for the landing, so no SVG is drawn
     again on every frame of the flight. */
import { makeMutable, type SharedValue } from 'react-native-reanimated';

export const pagerPanning: SharedValue<number> = makeMutable(0);

/** 1 while the launch sting's lockup still covers a mounted screen (see above). */
export const warmUnder: SharedValue<number> = makeMutable(0);

/** 1 while a mark handed over to Home is on its way (see above). */
export const markInFlight: SharedValue<number> = makeMutable(0);

/** 1 while a tab page's scroll is moving and for motionValues.loop.scrollPauseMs after its last scroll frame (written
 *  only by src/fx/FxScreen TabScreen, on the UI thread): the decorative loops (useLoopClock's `decorative`, the score
 *  halo, the tier-B sway) hold where they are meanwhile and resume from there, so a scroll's frames carry no loop. */
export const pageScrollMoving: SharedValue<number> = makeMutable(0);
