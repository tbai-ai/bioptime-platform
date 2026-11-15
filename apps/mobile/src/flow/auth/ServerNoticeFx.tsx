/* The client sign-in screens' notice when the app cannot use its server yet (components/serverNotice's logic and words,
   in the kit's look), with a button straight to the Server screen where testers fix it:
   - "Service not reached": nothing answered at the address in use;
   - "Preview login needed": the address answered, but the preview password in front of it (the shared demo link's
     gate, PREVIEW_GATE) refused the app, so the tester enters the preview username and password there.
   The button exists only in builds where testers may change the server (SERVER_OVERRIDE_ALLOWED); a store build shows
   the notice alone. Nothing about the server or its password is built in here. `beat`: the notice enters with that
   beat of the screen's entrance (src/flow/auth/beats); nothing is drawn (no empty beat) while there is nothing to say. */
import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Notice, NoticeText } from '@/fx';
import { useAuth } from '@/lib/auth';
import { SERVER_OVERRIDE_ALLOWED } from '@/lib/config';
import { Beat } from './beats';

export function ServerNoticeFx({ beat }: { beat?: number }) {
  const notice = <Notices />;
  const { config, offline, previewLocked } = useAuth();
  if (config || (!offline && !previewLocked)) return null;
  return beat == null ? notice : <Beat n={beat}>{notice}</Beat>;
}

function Notices() {
  const { config, offline, previewLocked } = useAuth();
  const router = useRouter();
  if (config) return null;
  const open = () => router.push('/settings/server');
  if (offline) return <Notice kind="warning" title="Service not reached">
    <NoticeText>Nothing answered at the configured server. Sign-in will not work until it does.{SERVER_OVERRIDE_ALLOWED ? ' On a phone, enter the shared link and its preview login on the Server screen.' : ''}</NoticeText>
    {SERVER_OVERRIDE_ALLOWED ? <View style={styles.action}><Button title="Set the server address" variant="soft" small full={false} onPress={open} /></View> : null}
  </Notice>;
  if (previewLocked) return <Notice kind="warning" title="Preview login needed">
    <NoticeText>{previewLocked}</NoticeText>
    {SERVER_OVERRIDE_ALLOWED ? <View style={styles.action}><Button title="Enter the preview login" variant="soft" small full={false} onPress={open} /></View> : null}
  </Notice>;
  return null;
}

const styles = StyleSheet.create({ action: { marginTop: 8, alignItems: 'flex-start' } });
