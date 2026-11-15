import { Redirect, Stack, usePathname, useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { CLIENT_SIGN_IN, homeFor, useAuth } from '@/lib/auth';
import { STAFF_APP } from '@/lib/config';
import { Button as LegacyButton, Notice as LegacyNotice, Screen } from '@/components/ui';
import { fx } from '@/theme';
import { Button } from '@/fx/Button';
import { FlowScreen } from '@/fx/FxScreen';
import { MarkPaths } from '@/fx/brand/MarkPaths';
import { P, T } from '@/fx/Text';

/** The coach and admin screens' addresses (src/app/coach/…, src/app/admin/…, and the workspace tabs of the (coach) and
 *  (admin) groups: calendar, clients, members, operations, more): the client app leaves those screens out of its
 *  bundle (metro.config.js), so an old link to one lands here. */
const STAFF_ADDRESS = /^\/(coach|admin|calendar|clients|members|operations|more)(\/|$)/;

/** No screen at this address: a link to a screen the next phase has not built yet, or an old one. The client app shows
 *  it in its own look (the mark, "No such screen", "Start again"); the staff build keeps the screen it had. A staff
 *  address in the client app draws nothing and goes where the staff gate sends it (components/staffGate): a signed-in
 *  client to the tabs, anyone else to the client sign-in. */
export default function NotFound() {
  const router = useRouter();
  const pathname = usePathname();
  const { ready, user } = useAuth();
  if (!STAFF_APP && STAFF_ADDRESS.test(pathname ?? '')) {
    if (!ready) return null; // nothing until the session on this device is known
    return <Redirect href={user?.role === 'member' ? homeFor('member') : CLIENT_SIGN_IN} />;
  }
  if (STAFF_APP) return <Screen>
    <Stack.Screen options={{ title: 'Not found' }} />
    <LegacyNotice kind="warning" title="No such screen">There is nothing at this address in this build of the app. Use the tabs, or start again.</LegacyNotice>
    <LegacyButton title="Start again" variant="secondary" onPress={() => router.replace('/')} />
  </Screen>;
  return <FlowScreen center>
    <Stack.Screen options={{ title: 'Not found' }} />
    <View style={styles.body}>
      <View style={styles.tile}><MarkPaths width={40} /></View>
      <T v="quiz42">No such screen</T>
      <P>This page does not exist. Use the tabs, or start again.</P>
      <Button title="Start again" icon="rotate-ccw" onPress={() => router.replace('/')} style={styles.cta} />
    </View>
  </FlowScreen>;
}

const styles = StyleSheet.create({
  body: { gap: 16 },
  tile: { width: 64, height: 64, borderRadius: fx.radius.logo, borderWidth: 1, borderColor: fx.line.a10, backgroundColor: fx.bg.panelSolid, alignItems: 'center', justifyContent: 'center', boxShadow: fx.shadow.logo, marginBottom: 8 },
  cta: { marginTop: 8 },
});
