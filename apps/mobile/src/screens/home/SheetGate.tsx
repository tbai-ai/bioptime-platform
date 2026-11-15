/* Home's decorative loops rest while a sheet is open over it (the Inbox). They sit under the sheet's black scrim, and
   every frame of theirs redraws the whole page beneath the panel: at tier A the bell's tap woke them (the motion
   budget), and the Inbox kept drawing frames for as long as they drifted behind it. The loops' own gate is the page's
   loop flag (PageActiveContext, read by src/fx/motion/loop useLoopGate: the orbs, the score halo, the live dot,
   spinners); this one adds the open sheet to it, on the UI thread, from the commit that opens the sheet, and gives it
   back on the commit that closes it (the budget then starts afresh). Entrances and data sweeps read the page's enter
   flag (usePageActive), which this leaves alone. Outside the pager it changes nothing. */
import React, { useContext, useLayoutEffect } from 'react';
import { useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { useSheetOpen } from '@/fx/Sheet';
import { PageActiveContext } from '@/fx/nav/pageReady';

export function SheetLoopGate({ children }: { children: React.ReactNode }) {
  const page = useContext(PageActiveContext);
  const always = useSharedValue(1);
  const open = useSheetOpen();
  const cover = useSharedValue(open ? 1 : 0);
  useLayoutEffect(() => { cover.set(open ? 1 : 0); }, [open, cover]);
  const src = page ?? always;
  const gated = useDerivedValue(() => (src.get() === 1 && cover.get() === 0 ? 1 : 0));
  if (!page) return <>{children}</>;
  return <PageActiveContext.Provider value={gated as unknown as SharedValue<number>}>{children}</PageActiveContext.Provider>;
}
