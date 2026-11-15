/* What a screen shows when its data did not come (the staff kit's ErrorBox and StaleBanner, in the Notice look). The
   titles and sentences stay word for word: "No connection" (amber rail) with "The Bioptime service could not be
   reached. Check your connection; nothing you did was lost.", "Signed out", "Something went wrong" (the server's own
   message), and "Offline" for a last-good copy. Signed out (a 401 once the app knows nobody is signed in): trying again
   would repeat it, so the button leads to the sign-in instead, which also offers "Continue without signing in" while
   the server runs the open preview (BUILD §7.4: no session opens by itself any more). A record that is not there (a 404:
   a report, a workout or a booking that was removed, or an old link) can never load by trying again, so it offers
   "Go back" (to the screen before, or Home). Otherwise "Try again" reloads. */
import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ApiError } from '@/lib/api';
import { signInFor, useAuth } from '@/lib/auth';
import { relative } from '@/lib/format';
import { fx } from '@/theme';
import { Button } from './Button';
import { Notice } from './Notice';
import { T } from './Text';

const NOT_SIGNED_OUT = ['INVALID_CREDENTIALS', 'MFA_REQUIRED', 'MFA_INVALID'];

export function ErrorState({ error, onRetry }: { error: ApiError | Error | null; onRetry?: () => void }) {
  const { ready, user, lastWorkspace } = useAuth();
  if (!error) return null;
  const offline = error instanceof ApiError && error.offline;
  const signedOut = error instanceof ApiError && error.status === 401 && ready && !user && !NOT_SIGNED_OUT.includes(error.code);
  const gone = error instanceof ApiError && error.status === 404;
  return <Notice kind={offline ? 'warning' : 'error'} title={offline ? 'No connection' : signedOut ? 'Signed out' : 'Something went wrong'}>
    <T v="body" color={offline ? fx.ink.a70 : fx.red.error} style={styles.body}>{offline ? 'The Bioptime service could not be reached. Check your connection; nothing you did was lost.' : error.message}</T>
    {signedOut ? <View style={styles.action}><Button title="Sign in" variant="soft" small full={false} onPress={() => router.replace(signInFor(lastWorkspace))} /></View>
      : gone ? <View style={styles.action}><Button title="Go back" variant="soft" small full={false} icon="arrow-left" onPress={goBack} /></View>
      : onRetry ? <View style={styles.action}><Button title="Try again" variant="soft" small full={false} icon="refresh-cw" onPress={onRetry} /></View> : null}
  </Notice>;
}

/** Back to where the person came from; a link opened on its own has nowhere to go back to, so it goes Home. */
function goBack() {
  if (router.canGoBack()) router.back(); else router.replace('/');
}

export function StaleBanner({ at }: { at: string | null }) {
  if (!at) return null;
  return <Notice kind="warning" title="Offline">{`Showing what was saved ${relative(at)}. Pull to refresh when you are back online.`}</Notice>;
}

const styles = StyleSheet.create({
  body: { fontSize: 13, lineHeight: 19 },
  action: { marginTop: 8, alignItems: 'flex-start' },
});
