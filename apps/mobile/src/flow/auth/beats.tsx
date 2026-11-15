/* The four-beat entrances of the pre-main flows (motion v2 M57, C05). A screen enters in at most four beats, 70 ms
   apart, each part rising 14 pt over 420 ms on the expo curve (a Reveal: it starts on the page-active edge, follows the
   tier's rules and is at rest under reduced motion and in the pre-rendered HTML). The screen sets the first beat's
   time with <BeatBase> (the sign-in's beats sit around its pinned preview-card and segment delays) and each part
   enters with <Beat n={0..3}>. Nothing else wraps a beat, so no rise ever compounds with another. */
import React, { createContext, useContext } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Reveal } from '@/fx/motion/Reveal';
import { motionValues } from '@/fx/motion/tokens';

type BeatSet = { beats: number; beatStep: number; rise: number; beatMs: number };
type Base = { at: number; set: BeatSet };

const BeatContext = createContext<Base>({ at: 0, set: motionValues.screens.c05 });

/** The beats inside start `at` ms after the page turns active; `set` is the change's tokens (M57 or C05). */
export function BeatBase({ at, set = motionValues.screens.c05, children }: { at: number; set?: BeatSet; children: React.ReactNode }) {
  return <BeatContext.Provider value={{ at, set }}>{children}</BeatContext.Provider>;
}

/** When beat `n` starts (ms after the page-active edge). */
export function useBeatAt(n: number): number {
  const { at, set } = useContext(BeatContext);
  return at + Math.min(Math.max(0, n), set.beats - 1) * set.beatStep;
}

/** One part of a beat. `lag` delays this part inside its beat (the eyebrow under the mark's flight); `fade` enters
 *  with opacity only (a block that holds Reveals of its own). */
export function Beat({ n, lag = 0, fade, style, children }: { n: number; lag?: number; fade?: boolean; style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const { set } = useContext(BeatContext);
  const at = useBeatAt(n);
  return <Reveal delay={at + lag} distance={set.rise} duration={set.beatMs} from={fade ? 'fade' : 'up'} style={style}>{children}</Reveal>;
}
