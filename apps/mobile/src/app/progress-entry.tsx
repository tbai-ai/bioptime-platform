/* Log a value, presented as a sheet over the screen that opened it (Bio, a metric sheet, Home, Profile); `?metric=`
   preselects the measure, and without one (bioptime://progress-entry) the sheet opens on the measures for the member
   to choose. The form is src/screens/bio/LogValue; this route draws the sheet chrome and closes it after a save (or
   with the grabber, the scrim, Escape or Android back), returning to where it was opened, or to Bio when it was opened
   from a link with nothing behind it.
   No invisible layer (FU-m2): the route's own layer passes every touch through from the moment its sheet starts to
   close, and once the exit is over the route goes; should it still be the screen in front a moment later (another
   link took the navigation over meanwhile), it gives its place to Bio, so nothing transparent is ever left on top. */
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { closeOverlay, motionValues, SheetPanel, t } from '@/fx';
import { LogValueForm } from '@/screens/bio/LogValue';

const BIO = '/(tabs)/bio';
/** How long after its exit the route may still be in front before it gives way to Bio. */
const LEFT_BEHIND_MS = t.sheetExit + motionValues.overlay.fallbackExtra;

export default function ProgressEntry() {
  const { metric } = useLocalSearchParams<{ metric?: string }>();
  const [open, setOpen] = useState(true);
  const focused = useIsFocused();
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const exited = useCallback(() => {
    closeOverlay(BIO);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; if (focusedRef.current) router.replace(BIO); }, LEFT_BEHIND_MS);
  }, []);
  return <View pointerEvents={open ? 'box-none' : 'none'} style={StyleSheet.absoluteFill}>
    <SheetPanel open={open} onClose={() => setOpen(false)} onExited={exited} title="Log a value">
      <LogValueForm initial={typeof metric === 'string' && metric ? metric : null} onDone={() => setOpen(false)} />
    </SheetPanel>
  </View>;
}
