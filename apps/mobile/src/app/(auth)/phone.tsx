/* Sign in with a phone code (switch 'phone_sign_in'): the same form as the sign-in's Phone segment
   (src/flow/auth/PhoneCodeForm, which keeps every guarded string: the delivery note comes from the server's answer, the
   number never goes in a URL), on its own screen for links and the tab-less flow. The Verified moment, then Home.
   Only a staff build (EXPO_PUBLIC_STAFF_APP=1) points coaches and the team to the chooser; the client app names no
   other sign-in. Opened with a session already on this device, it goes to that session's home (usePreviewAway); in the
   open preview it draws its form (the sign-in offers the one-tap preview).
   Motion v2: the screen enters in beats (src/flow/auth/beats); Home's first loads start during the Verified hold and
   the screen leaves with the Verified veil in one flow exit, handing nothing over (no tile here; M57). */
import { Link, Redirect, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Notice, P, RingSpinner, T, VerifiedOverlay, fx } from '@/fx';
import { motionValues } from '@/fx/motion/tokens';
import { STAFF_APP } from '@/lib/config';
import { useFeatures } from '@/lib/features';
import { usePreviewAway } from '@/components/openPreview';
import { AuthScreen } from '@/flow/auth/AuthScreen';
import { homeReady, useAuthLeave } from '@/flow/auth/leave';
import { PhoneCodeForm } from '@/flow/auth/PhoneCodeForm';

export default function PhoneSignIn() {
  const router = useRouter();
  const features = useFeatures(true);
  const away = usePreviewAway();
  const [verified, setVerified] = useState(false);
  const leave = useAuthLeave();
  useEffect(() => { if (verified) void homeReady(); }, [verified]); // Home's first loads, during the Verified hold
  if (away.to && !verified) return <Redirect href={away.to as never} />;
  return <AuthScreen
    slot="auth.phone.backdrop"
    back
    small
    title="Sign in with a code"
    subtitle="Sign in with a six-digit code for the mobile number you confirmed on your Bioptime account."
    leave={leave}
    overlay={<VerifiedOverlay visible={verified} onExitStart={() => leave.go(() => router.replace('/(tabs)'), { backdrop: true, underVeil: motionValues.verified.veilOutMs })} />}
    trailing={<View style={styles.note}>
      {STAFF_APP
        ? <P muted small>Codes are only for a mobile number confirmed on a member account. Coaches and the Bioptime team have their own sign-in: <Link href="/(auth)/choose" replace style={styles.link}>choose another sign-in</Link>.</P>
        : <T v="bodySm" color={fx.ink.a60}>Codes are only for a mobile number confirmed on a member account.</T>}
    </View>}>
    {!features || away.wait ? <View style={styles.wait}><RingSpinner size={24} label="Loading" /></View>
      : !features.has('phone_sign_in') ? <>
        <Notice kind="info" title="Not available here">Signing in with a phone code is not switched on. Sign in with your email and password instead.</Notice>
        <Button title="Sign in with email" variant="soft" onPress={() => leave.go(() => router.replace('/(auth)/sign-in'))} />
      </> : <PhoneCodeForm onSignedIn={() => setVerified(true)} />}
  </AuthScreen>;
}

const styles = StyleSheet.create({
  wait: { paddingVertical: 32, alignItems: 'center' },
  note: { marginTop: 8 },
  link: { color: fx.red.label },
});
