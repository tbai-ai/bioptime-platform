/* Fresh data when a coach screen comes back into view. The portal loads a page's data each time it is opened; in the
   app a tab or a record stays mounted under the screen pushed over it, so Today, the Clients list and a client's record
   reload when they are focused again (not on their first focus: useLoad has just loaded them). */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

export function useReloadOnFocus(reload: () => unknown): void {
  const latest = useRef(reload);
  useEffect(() => { latest.current = reload; }, [reload]);
  const seen = useRef(false);
  useFocusEffect(useCallback(() => {
    if (seen.current) void latest.current();
    seen.current = true;
  }, []));
}
