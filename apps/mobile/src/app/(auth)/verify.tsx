/* Confirm the email (POST /auth/verify-email), in the sign-in's look. The code is the token from the email link (not a
   six-digit code), so it stays one mono field; a demo server fills it in (no email leaves it). Every sentence is as
   before, including the email-unverified rules: an unconfirmed member may look around, but setup and blood test
   bookings wait. Confirmed: "Continue" leads to the first-run setup (onboarding sends a member who finished it Home).
   Motion v2: it enters in beats (src/flow/auth/beats); the code step gives way to the confirmed step in place
   (FlowSwap); every way on leaves in one flow exit (src/flow/auth/leave; C05).
   Confirmed here (release T6-11, T1-21): the kit's Verified moment plays over the screen ("Email confirmed": the check
   badge springs in and draws, then the veil lifts) while the code step gives way to the confirmed one beneath it,
   whose title says so; the subtitle is the one sentence that confirms it (no second notice). */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Field, Input, Notice, T, VerifiedOverlay, fx } from '@/fx';
import { FlowSwap } from '@/fx/FxScreen';
import { errorText, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { AuthScreen } from '@/flow/auth/AuthScreen';
import { useAuthLeave } from '@/flow/auth/leave';

export default function Verify() {
  const { demoToken } = useLocalSearchParams<{ demoToken?: string }>();
  const { user, refresh, config } = useAuth();
  const router = useRouter();
  const [token, setToken] = useState(demoToken ?? '');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false); // confirmed here, which a signed-out visitor's user state cannot show
  const [moment, setMoment] = useState(false); // the Verified moment over the screen, once, as it is confirmed
  const leave = useAuthLeave();
  useEffect(() => { if (demoToken) setToken(demoToken); }, [demoToken]);
  const confirm = async () => {
    setBusy(true); setMsg(null);
    try { await post('/auth/verify-email', { token: token.trim() }); setConfirmed(true); setMoment(true); await refresh(); }
    catch (e) { setMsg({ kind: 'error', text: errorText(e) + ' Links work once and expire after three days.' }); }
    finally { setBusy(false); }
  };
  const resend = async () => {
    if (!user) return;
    setBusy(true); setMsg(null);
    try { const r = await post<{ demoToken?: string }>('/auth/resend-verification', { email: user.email }); if (r?.demoToken) setToken(r.demoToken); setMsg({ kind: 'info', text: r?.demoToken ? 'No email is sent from this server; the new code is filled in below.' : config?.emailDelivered === false ? 'Email delivery is not configured on this server yet, so nothing was sent; the team can confirm your address for you.' : `A new link is on its way to ${user.email}.` }); }
    catch (e) { setMsg({ kind: 'error', text: errorText(e) }); }
    finally { setBusy(false); }
  };
  // confirmed only when we know it: with no one signed in (a deep link, or after the session ended) the code field stays,
  // and the way on is to sign in rather than into the tabs
  const done = confirmed || (!!user && user.state !== 'pending_verification');
  const sub = done ? 'Thanks, your address is confirmed.' : config?.emailDelivered ? `We sent a link to ${user?.email ?? 'your email'}. Open it on this phone, or paste the code from it here.` : token ? `The code to confirm ${user?.email ?? 'your email'} is filled in below.` : `Email is not sent from this server yet, so no link is on its way to ${user?.email ?? 'your email'}.`;
  return <AuthScreen slot="auth.verify.backdrop" back={!user} small title={confirmed ? 'Email confirmed' : 'Confirm your email'} subtitle={sub} leave={leave}
    overlay={<VerifiedOverlay visible={moment} title="Email confirmed" onDone={() => setMoment(false)} />}
    trailing={!done && user ? <T v="bodySm" color={fx.ink.a60}>{config?.demo ? 'You can use the app while unconfirmed, but blood test bookings wait until your email address is confirmed.' : 'You can look around the app while unconfirmed, but setup and blood test bookings wait until your email address is confirmed.'}</T> : null}>
    {config?.emailDelivered === false && !done ? <Notice kind="info" title="No email is sent">{token ? 'This server does not send email; the code below was filled in when the account was created.' : 'This server does not send email yet; the team can confirm your address for you.'}</Notice> : null}
    {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
    <FlowSwap id={done ? 'done' : 'code'}>
      <View style={{ gap: 24 }}>
        {!done ? <>
          <Field label={config?.emailDelivered ? 'Code from the email' : 'Code'}><Input value={token} onChangeText={setToken} autoCapitalize="none" autoCorrect={false} mono /></Field>
          <Button title="Confirm" iconRight="arrow-right" commit onPress={confirm} busy={busy} disabled={token.trim().length < 10} />
          {user ? <Button title={config?.emailDelivered ? 'Send the link again' : 'Make a new code'} variant="soft" onPress={resend} disabled={busy} /> : null}
        </> : null}
        {user ? <Button title={done ? 'Continue' : 'Skip for now'} variant={done ? 'primary' : 'ghost'} iconRight={done ? 'arrow-right' : undefined} full onPress={() => { const to = done && user.role === 'member' ? '/onboarding' : '/(tabs)'; leave.go(() => router.replace(to), { backdrop: true }); }} />
          : <Button title="Sign in" variant={done ? 'primary' : 'ghost'} full onPress={() => leave.go(() => router.replace('/(auth)/sign-in'))} />}
      </View>
    </FlowSwap>
  </AuthScreen>;
}
