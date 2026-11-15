import { Stack } from 'expo-router';
import { Platform } from 'react-native';
import { clientAppAuthLayout, STAFF_ROUTES_BUNDLED } from '@/components/staffGate';
import { fx } from '@/fx';
import { colors } from '@/theme';

/** The sign-in screens. In the client app (STAFF_APP off) the chooser and the coach and administrator sign-ins never
 *  draw: screenLayout (components/staffGate) sends them to the client sign-in. The member screens draw their own chrome
 *  (src/flow/auth AuthScreen) on the flow black and cross-fade (iOS 280 ms) as the earlier app's flows did; the titles stay for
 *  the web document title and screen readers. The three staff screens keep their options and canvas (staff build).
 *  Motion v2 (C05): iOS keeps the native 280 ms fade between them; on Android (and the web, where the stack does not
 *  animate) the incoming screen's own entrance carries the motion (its beats start on the page-active edge) after the
 *  outgoing one has left in its flow exit, so nothing plays twice. */
const MEMBER_ANIMATION = Platform.OS === 'ios' ? 'fade' : 'none';
const STAFF = { headerShown: false, contentStyle: { backgroundColor: colors.canvas }, animation: 'default' } as const;

export default function AuthLayout() {
  return <Stack screenLayout={clientAppAuthLayout} screenOptions={{ headerShown: false, contentStyle: { backgroundColor: fx.bg.base }, animation: MEMBER_ANIMATION, animationDuration: 280 }}>
    {STAFF_ROUTES_BUNDLED ? [<Stack.Screen key="choose" name="choose" options={STAFF} />, <Stack.Screen key="coach-sign-in" name="coach-sign-in" options={STAFF} />, <Stack.Screen key="admin-sign-in" name="admin-sign-in" options={STAFF} />] : []}
    <Stack.Screen name="sign-in" options={{ title: 'Sign in' }} />
    <Stack.Screen name="social-finish" options={{ title: 'Finish creating your account', gestureEnabled: false }} />
    <Stack.Screen name="register" options={{ title: 'Create your account' }} />
    <Stack.Screen name="verify" options={{ title: 'Confirm your email' }} />
    <Stack.Screen name="forgot" options={{ title: 'Reset your password' }} />
    <Stack.Screen name="phone" options={{ title: 'Sign in with a code' }} />
  </Stack>;
}
