/* Finish creating an account after a Google or Apple sign-in whose identity has no account yet (ACCOUNT_SETUP_NEEDED):
   the name, the terms and privacy acceptance with the versions the server names (GET /public/config), the optional
   marketing consent and a friend's referral code. The verified identity waits on the server under a one-time pending
   token that lives only in memory here (lib/auth pendingSocial), never in the URL; a reload sends the person back to
   sign-in. The server builds the account from what it verified, not from anything typed here. In the sign-in's look.
   Motion v2 (C05): it enters in beats (eyebrow and title; the subtitle; the form; the note) and leaves in one flow
   exit (src/flow/auth/leave), fading the backdrop too on the way into the setup. */
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Button, Check, Field, Input, Notice, T, fx } from '@/fx';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { apiBaseSync } from '@/lib/config';
import { AuthScreen } from '@/flow/auth/AuthScreen';
import { useAuthLeave } from '@/flow/auth/leave';

const PROVIDER: Record<string, string> = { google: 'Google', apple: 'Apple', standin: 'the preview sign-in' };

export default function SocialFinish() {
  const { pendingSocial: pending, finishSocialSignUp, config } = useAuth();
  const router = useRouter();
  const [name, setName] = useState(pending?.name ?? '');
  const [referralCode, setReferralCode] = useState('');
  const [accept, setAccept] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = (path: string) => Linking.openURL(`${apiBaseSync()}/${path}`).catch(() => {});
  const leave = useAuthLeave();
  const toSignIn = () => leave.go(() => router.replace('/(auth)/sign-in'));

  if (!pending) {
    return <AuthScreen slot="auth.socialFinish.backdrop" small title="Start again" subtitle="The sign-in that was being completed is no longer here." leave={leave}>
      <Notice kind="info">Go back to sign-in and press Continue with Google or Apple again; it takes a moment.</Notice>
      <Button title="Back to sign-in" onPress={toSignIn} />
    </AuthScreen>;
  }

  const go = async () => {
    const e: Record<string, string> = {};
    if (name.trim().length < 2) e.name = 'Please tell us your name.';
    if (!accept) e.accept = 'Please accept the terms and the privacy policy.';
    setErrs(e); setErr(null);
    if (Object.keys(e).length) return;
    setBusy(true);
    try { await finishSocialSignUp(pending.pendingToken, { name: name.trim(), marketingConsent: marketing, referralCode: referralCode || undefined }); leave.go(() => router.replace('/onboarding'), { backdrop: true }); }
    catch (ex) {
      if (ex instanceof ApiError) {
        const fe = ex.fieldErrors();
        if (Object.keys(fe).length) setErrs(fe);
        else if (ex.status === 409) setErr('There is already an account with that email. Sign in with your password instead, or reset it.');
        else if (ex.status === 404 || ex.status === 410 || ex.code === 'SETUP_EXPIRED') setErr('That sign-in has expired. Go back and press the button again.');
        else setErr(ex.message);
      } else setErr('Could not create the account.');
    } finally { setBusy(false); }
  };

  return <AuthScreen slot="auth.socialFinish.backdrop" small title="Finish creating your account" subtitle={`Signing up with ${PROVIDER[pending.provider] ?? pending.provider} as ${pending.email}. One account for the app and the website. You must be 18 or over.`} leave={leave}
    trailing={<T v="bodySm" color={fx.ink.a60}>No password is set for an account created this way; you sign in with the same button next time. You can set one later from “Forgotten your password?”.</T>}>
    <Field label="Your name" error={errs.name}><Input value={name} onChangeText={setName} autoComplete="name" textContentType="name" /></Field>
    <Field label="Referral code (from a friend)" error={errs.referralCode} hint="Optional. Letters and digits, as your friend shared it."><Input value={referralCode} onChangeText={(v) => setReferralCode(v.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 16))} autoCapitalize="characters" autoCorrect={false} autoComplete="off" maxLength={16} mono /></Field>
    <View style={styles.checks}>
      <Check checked={accept} onChange={setAccept} label={`I have read and accept the terms of use and the privacy policy${config?.termsVersion ? ` (version ${config.termsVersion})` : ''}.`} />
      <T v="caption" color={fx.ink.a60} style={styles.read}>Read them: <T v="caption" color={fx.red.label} onPress={() => open('terms')} accessibilityRole="link">terms</T> · <T v="caption" color={fx.red.label} onPress={() => open('privacy')} accessibilityRole="link">privacy</T></T>
      {errs.accept ? <T v="caption" color={fx.red.label} style={styles.read} accessibilityRole="alert">{errs.accept}</T> : null}
      <Check checked={marketing} onChange={setMarketing} label="Email me occasional Bioptime news (optional)." />
    </View>
    {err ? <Notice kind="error">{err}</Notice> : null}
    <Button title="Create account" iconRight="arrow-right" commit onPress={go} busy={busy} />
    <Button title="Not now" variant="ghost" full onPress={toSignIn} disabled={busy} />
  </AuthScreen>;
}

const styles = StyleSheet.create({
  checks: { gap: 4 },
  read: { marginLeft: 32, marginBottom: 6 },
});
