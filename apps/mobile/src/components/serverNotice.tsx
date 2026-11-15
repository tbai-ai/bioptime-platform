/* The notice the sign-in screens (the chooser, the member sign-in, the coach and administrator sign-ins) show when the
   app cannot use its server yet, with a button straight to the Server screen where testers fix it:
   - "Service not reached": nothing answered at the address in use (a phone on a build whose address it cannot reach);
   - "Preview login needed": the address answered, but the preview password in front of it (the shared demo link's
     gate) refused the app, so the tester enters the preview username and password there.
   The button exists only in builds where testers may change the server (SERVER_OVERRIDE_ALLOWED); a store build shows
   the notice alone. Nothing about the server or its password is built in here. */
import { useRouter } from 'expo-router';
import React from 'react';
import { Text, View } from 'react-native';
import { Button, Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { SERVER_OVERRIDE_ALLOWED } from '@/lib/config';
import { colors, font, space } from '@/theme';

const body = { color: colors.muted, fontSize: font.small, lineHeight: 19 } as const; // ui.tsx noticeBody

export function ServerNotice() {
  const { config, offline, previewLocked } = useAuth();
  const router = useRouter();
  if (config) return null;
  const open = () => router.push('/settings/server');
  if (offline) return <Notice kind="warning" title="Service not reached">
    <View style={{ gap: space.sm }}>
      <Text style={body}>Nothing answered at the configured server. Sign-in will not work until it does.{SERVER_OVERRIDE_ALLOWED ? ' On a phone, enter the shared link and its preview login on the Server screen.' : ''}</Text>
      {SERVER_OVERRIDE_ALLOWED ? <Button title="Set the server address" variant="secondary" small onPress={open} style={{ alignSelf: 'flex-start' }} /> : null}
    </View>
  </Notice>;
  if (previewLocked) return <Notice kind="warning" title="Preview login needed">
    <View style={{ gap: space.sm }}>
      <Text style={body}>{previewLocked}</Text>
      {SERVER_OVERRIDE_ALLOWED ? <Button title="Enter the preview login" variant="secondary" small onPress={open} style={{ alignSelf: 'flex-start' }} /> : null}
    </View>
  </Notice>;
  return null;
}
