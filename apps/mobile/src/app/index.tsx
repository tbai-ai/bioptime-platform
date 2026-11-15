import { Redirect } from 'expo-router';
import React, { useLayoutEffect } from 'react';
import { View } from 'react-native';
import { homeFor, signInFor, useAuth } from '@/lib/auth';
import { STAFF_APP } from '@/lib/config';
import { Loading } from '@/components/ui';
import { colors, fx } from '@/theme';
import { startSplash, useSplashEarly, useSplashState } from '@/fx/brand/SplashHost';

/** The entry route: by role to the member tabs, the coach workspace or the administrative portal; signed out to the
 *  sign-in chosen last time on this device, else to the chooser. In the client app (STAFF_APP off) signed out always
 *  means the client sign-in (signInFor), and a cold start first plays the Bioptime sting (src/fx/brand SplashHost, an
 *  overlay above the navigator), which hides the native splash on its first frame; this route waits on black under it
 *  and redirects as its exit starts, so the sign-in or Home opens beneath the fading sting and takes its mark (the
 *  sign-in tile or the Home header). It moves on once the session is known (holding at most 9 s); once per launch:
 *  coming back to the entry route later goes straight on. Deep links do not pass here, so they never wait for it. A
 *  restored session goes to Home early, while the sting still runs (useSplashEarly, at motionValues.mark.earlyMountAt),
 *  so Home's first commit lands under the lockup and is ready when the sting releases; the sign-in never mounts early.
 *  The staff build keeps its entry as it was. */
export default function Index() {
  const { user, ready, lastWorkspace } = useAuth();
  const splash = useSplashState();
  const early = useSplashEarly();
  useLayoutEffect(() => { if (!STAFF_APP) startSplash(); }, []);
  if (STAFF_APP) {
    if (!ready) return <View style={{ flex: 1, backgroundColor: colors.canvas, justifyContent: 'center' }}><Loading /></View>;
    if (!user) return <Redirect href={signInFor(lastWorkspace)} />;
    return <Redirect href={homeFor(user.role)} />;
  }
  if ((splash === 'released' || splash === 'done') && ready) return <Redirect href={user ? homeFor(user.role) : signInFor(lastWorkspace)} />;
  if (early && splash === 'running' && ready && user) return <Redirect href={homeFor(user.role)} />;
  return <View style={{ flex: 1, backgroundColor: fx.bg.deep }} />;
}
