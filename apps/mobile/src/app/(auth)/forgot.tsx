/* Reset a password (POST /auth/password/forgot, then /auth/password/reset), in the sign-in's look. Three stages: the
   email, then the code from the email with the new password, then "saved". Every sentence is as before: a demo server
   fills the reset code in (no email leaves it); a server that cannot send email says so. Opened with a session already
   on this device, it goes to that session's home (usePreviewAway); in the open preview it draws its form.
   Motion v2 (C05): it enters in beats; each stage gives way to the next in place (FlowSwap: the old stage leaves
   upward, inert, while the new one rises in); "Sign in" leaves in one flow exit (src/flow/auth/leave). */
import { Redirect, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Field, Input, Notice, RingSpinner } from '@/fx';
import { FlowSwap } from '@/fx/FxScreen';
import { errorText, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { usePreviewAway } from '@/components/openPreview';
import { AuthScreen } from '@/flow/auth/AuthScreen';
import { useAuthLeave } from '@/flow/auth/leave';

export default function Forgot() {
  const router = useRouter();
  const { config } = useAuth();
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [stage, setStage] = useState<'ask' | 'reset' | 'done'>('ask');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const away = usePreviewAway();
  const leave = useAuthLeave();
  const ask = async () => {
    setBusy(true); setMsg(null);
    try { const r = await post<{ demoToken?: string }>('/auth/password/forgot', { email: email.trim() }); if (r?.demoToken) setToken(r.demoToken); setStage('reset'); setMsg({ kind: 'info', text: r?.demoToken ? 'No email is sent from this server; the reset code is filled in below and works for one hour.' : config?.emailDelivered === false ? 'Email delivery is not configured on this server yet, so nothing was sent; contact support to reset your password.' : `If ${email.trim()} belongs to a member account, a reset link is on its way and works for one hour.` }); }
    catch (e) { setMsg({ kind: 'error', text: errorText(e) }); }
    finally { setBusy(false); }
  };
  const reset = async () => {
    setBusy(true); setMsg(null);
    try { await post('/auth/password/reset', { token: token.trim(), password }); setStage('done'); setMsg({ kind: 'success', text: 'Your password is saved. Other devices are signed out.' }); }
    catch (e) { setMsg({ kind: 'error', text: errorText(e) }); }
    finally { setBusy(false); }
  };
  if (away.to) return <Redirect href={away.to as never} />;
  return <AuthScreen slot="auth.forgot.backdrop" back small title="Reset your password" subtitle="We email a link with a code. Paste the code here with your new password." leave={leave}>
    {away.wait ? <View style={styles.wait}><RingSpinner size={24} label="Loading" /></View> : <>
      {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
      <FlowSwap id={stage}><View style={styles.stage}>{stage === 'ask' ? <>
        <Field label="Email on your account"><Input value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" onSubmitEditing={() => { if (email.includes('@')) void ask(); }} /></Field>
        <Button title="Send the link" iconRight="arrow-right" commit onPress={ask} busy={busy} disabled={!email.includes('@')} />
      </> : stage === 'reset' ? <>
        <Field label="Code from the email"><Input value={token} onChangeText={setToken} autoCapitalize="none" autoCorrect={false} mono /></Field>
        <Field label="New password" hint="At least 10 characters."><Input value={password} onChangeText={setPassword} secureToggle autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" /></Field>
        <Button title="Save the new password" commit onPress={reset} busy={busy} disabled={token.trim().length < 10 || password.length < 10} />
      </> : <Button title="Sign in" iconRight="arrow-right" onPress={() => leave.go(() => router.replace('/(auth)/sign-in'))} />}</View></FlowSwap>
    </>}
  </AuthScreen>;
}

const styles = StyleSheet.create({ wait: { paddingVertical: 32, alignItems: 'center' }, stage: { gap: 24 } });
