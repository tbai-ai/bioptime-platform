/* "Continue with Google" and "Continue with Apple" for members (the member sign-in screen). Which buttons show is the
   server's call (GET /public/config → signIn): Google while a client ID is set, Apple natively on iOS (expo-apple-
   authentication) and elsewhere through Apple's web flow while a Services ID is set. The app only ever sends the
   provider's proof (an ID token) to POST /auth/social/login; the server verifies it against the provider's published
   keys and decides whether that identity signs in or still needs an account (ACCOUNT_SETUP_NEEDED → the finish screen).
   In demo mode (signIn.standin) the same buttons open a small "Preview sign-in" sheet instead; it says plainly that no
   Google or Apple account is contacted and asks which email to use. Seeded members sign in; a new email creates an
   account through the finish step. Nothing in this file is a secret: client and services IDs are public identifiers.
   Apple on Android: Apple's web flow with the Services ID, whose form post lands on the API (POST
   /auth/social/apple/return) and comes back to the app as bioptime://social/apple?id_token=…&state=…; the token is only
   carried there and verified by /auth/social/login like every other. On the web build Apple shows only as the demo
   stand-in (Apple's return goes to the app scheme or the portal, not to this page).
   Each flow carries a nonce the server checks against the token (Apple's native flow hashes it).
   Not exercised in this build: the live Google and Apple flows need a Google Cloud OAuth client and an Apple Services
   ID, which the demo server does not have; the stand-in path is what the demo runs.
   Look (the client kit, src/fx): the earlier app's "Continue with Google" button (white/5 block, radius 12, the
   four-colour G) under an "Or continue with" rule, Apple the same with its glyph; the stand-in sheet is the kit's sheet. */
import * as AppleAuthentication from 'expo-apple-authentication';
import * as AuthSession from 'expo-auth-session';
import * as Google from 'expo-auth-session/providers/google';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { ApiError, errorText } from '../lib/api';
import { CLIENTS_ONLY, useAuth, type SignInConfig, type SocialPayload, type SocialProvider, type SocialSignInResult } from '../lib/auth';
import { apiBaseSync, STAFF_APP } from '../lib/config';
import { AnimatedPressable, Button, Field, Input, Notice, Sheet, T, TitledDivider, fx, usePress } from '@/fx';

// the web: the popup that carried the provider's redirect hands its result back to this page and closes
WebBrowser.maybeCompleteAuthSession();

const APPLE_DISCOVERY: AuthSession.DiscoveryDocument = { authorizationEndpoint: 'https://appleid.apple.com/auth/authorize' };
const PROVIDER_LABEL: Record<Exclude<SocialProvider, 'standin'>, string> = { google: 'Google', apple: 'Apple' };

/** Google's four-colour G and Apple's glyph, as the providers ask their buttons to show them. */
const GOOGLE_G = [
  { d: 'M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z', fill: '#FFC107' },
  { d: 'M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z', fill: '#FF3D00' },
  { d: 'M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z', fill: '#4CAF50' },
  { d: 'M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z', fill: '#1976D2' },
];
const APPLE = 'M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.377 0-2.332-1.26-3.428-2.8-1.287-1.82-2.323-4.63-2.323-7.28 0-4.28 2.797-6.55 5.552-6.55 1.448 0 2.675.95 3.6.95.865 0 2.222-1.01 3.902-1.01.613 0 2.886.06 4.374 2.19-.13.09-2.383 1.37-2.383 4.19 0 3.26 2.854 4.42 2.955 4.45z';

function Glyph({ provider }: { provider: 'google' | 'apple' }) {
  if (provider === 'google') return <Svg width={20} height={20} viewBox="0 0 48 48">{GOOGLE_G.map((p) => <Path key={p.fill} d={p.d} fill={p.fill} />)}</Svg>;
  return <Svg width={18} height={18} viewBox="0 0 24 24"><Path d={APPLE} fill={fx.ink.white} /></Svg>;
}

/** The earlier app's provider button: a white/5 block with a white/10 hairline, radius 12, the provider's glyph and a
 *  zinc-300 600 label; presses to .97. */
function ProviderButton({ provider, title, onPress, disabled }: { provider: 'google' | 'apple'; title: string; onPress: () => void; disabled?: boolean }) {
  const press = usePress('cta');
  return <AnimatedPressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut}
    style={[styles.provider, { opacity: disabled ? 0.5 : 1, backgroundColor: press.pressed ? fx.fill.a10 : fx.fill.a05 }, press.style]}>
    <Glyph provider={provider} />
    <T v="cardTitle" color={fx.ink.zinc300}>{title}</T>
  </AnimatedPressable>;
}

/** Google through expo-auth-session's provider: the ID token comes back in the response. (The provider hook is marked
 *  deprecated in SDK 58 in favour of native sign-in libraries; it still works and needs no native module.) */
function GoogleButton({ ids, busy, onToken, onError }: { ids: NonNullable<SignInConfig['googleClientIds']>; busy: boolean; onToken: (p: SocialPayload) => void; onError: (m: string) => void }) {
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({ webClientId: ids.web || undefined, iosClientId: ids.ios || undefined, androidClientId: ids.android || undefined });
  useEffect(() => {
    if (!response) return;
    if (response.type === 'success') { const t = response.params?.id_token; if (t) onToken({ idToken: t, nonce: request?.nonce }); else onError('Google did not return an ID token.'); }
    else if (response.type === 'error') onError(response.error?.message ?? 'Google sign-in did not complete.');
  }, [response]); // eslint-disable-line react-hooks/exhaustive-deps
  return <ProviderButton provider="google" title="Continue with Google" onPress={() => { void promptAsync(); }} disabled={!request || busy} />;
}

/** Apple natively (iOS): the system sheet; the name and email arrive only on the first sign-in, so they go along. */
function AppleNativeButton({ busy, onCredential, onError }: { busy: boolean; onCredential: (p: SocialPayload) => void; onError: (m: string) => void }) {
  const [available, setAvailable] = useState(false);
  useEffect(() => { let alive = true; void AppleAuthentication.isAvailableAsync().then((a) => { if (alive) setAvailable(a); }, () => {}); return () => { alive = false; }; }, []);
  if (!available) return null;
  const press = async () => {
    try {
      // Apple signs the SHA-256 of the nonce into the token; the server gets the nonce itself and checks both forms
      const nonce = Crypto.randomUUID();
      const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
      const c = await AppleAuthentication.signInAsync({ requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL], nonce: hashed });
      if (!c.identityToken) { onError('Apple did not return an identity token.'); return; }
      const name = c.fullName ? [c.fullName.givenName, c.fullName.familyName].filter(Boolean).join(' ') : '';
      onCredential({ idToken: c.identityToken, nonce, name: name || null });
    } catch (e) {
      if ((e as { code?: string })?.code === 'ERR_REQUEST_CANCELED') return; // the person closed the sheet
      onError(errorText(e));
    }
  };
  return <ProviderButton provider="apple" title="Continue with Apple" onPress={() => { void press(); }} disabled={busy} />;
}

/** Apple on Android: Apple's authorize endpoint with the Services ID. Apple requires a form post when the name and
 *  email scopes are asked for, so the redirect is the API's return route, which sends the browser on to
 *  bioptime://social/apple?id_token=…&state=…&user=…; expo-auth-session reads that link and checks the state. */
function AppleWebButton({ servicesId, busy, onToken, onError }: { servicesId: string; busy: boolean; onToken: (p: SocialPayload) => void; onError: (m: string) => void }) {
  const [request, response, promptAsync] = AuthSession.useAuthRequest({ clientId: servicesId, redirectUri: `${apiBaseSync()}/api/auth/social/apple/return`, responseType: 'code id_token', scopes: ['name', 'email'], usePKCE: false, extraParams: { response_mode: 'form_post' } }, APPLE_DISCOVERY);
  useEffect(() => {
    if (!response) return;
    if (response.type === 'success') {
      const t = response.params?.id_token;
      if (!t) { onError(response.params?.error ? `Apple sign-in did not complete (${response.params.error}).` : 'Apple did not return an identity token.'); return; }
      let name: string | null = null; // Apple sends the name once, as JSON in `user`, on the first sign-in only
      try { const u = JSON.parse(response.params?.user ?? '') as { name?: { firstName?: string; lastName?: string } }; name = [u?.name?.firstName, u?.name?.lastName].filter(Boolean).join(' ') || null; } catch { name = null; }
      onToken({ idToken: t, name });
    }
    else if (response.type === 'error') onError(response.error?.message ?? 'Apple sign-in did not complete.');
  }, [response]); // eslint-disable-line react-hooks/exhaustive-deps
  return <ProviderButton provider="apple" title="Continue with Apple" onPress={() => { void promptAsync(); }} disabled={!request || busy} />;
}

/** In demo mode only: the stand-in. Which email to use, said plainly; no provider is contacted. */
function PreviewSheet({ provider, open, onClose, busy, onContinue }: { provider: Exclude<SocialProvider, 'standin'> | null; open: boolean; onClose: () => void; busy: boolean; onContinue: (email: string, name: string) => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  return <Sheet visible={open} onClose={onClose} title="Preview sign-in" footer={<Button title="Continue" onPress={() => onContinue(email.trim(), name.trim())} disabled={!ok} busy={busy} commit />}>
    <View style={styles.sheet}>
      <Notice kind="sample" title="Simulated sign-in">{`No ${provider ? PROVIDER_LABEL[provider] : 'Google or Apple'} account is contacted in this preview; this server stands in for it. Enter the email to use: a prepared member signs in straight away, and a new email creates an account on the next step.`}</Notice>
      <Field label="Email to sign in with"><Input value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" autoFocus /></Field>
      <Field label="Name (for a new account)" hint="Optional. Used only if this email has no account yet."><Input value={name} onChangeText={setName} autoComplete="name" /></Field>
    </View>
  </Sheet>;
}

/** The provider buttons the server offers, under `divider` ("Or continue with"); nothing at all when it offers none. */
export function SocialSignInButtons({ onResult, divider }: { onResult: (r: SocialSignInResult) => void; divider?: string }) {
  const { config, socialSignIn } = useAuth();
  const s = config?.signIn;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<Exclude<SocialProvider, 'standin'> | null>(null);
  const standin = !!s?.standin;
  const ids = s?.googleClientIds ?? {};
  const googleOn = standin || (!!s?.google && !!(ids.web || ids.ios || ids.android));
  const appleOn = standin || (!!s?.apple && (Platform.OS === 'ios' || (Platform.OS === 'android' && !!s?.appleServicesId)));
  if (!googleOn && !appleOn) return null;

  const run = async (provider: SocialProvider, payload: SocialPayload) => {
    setBusy(true); setErr(null);
    try { const r = await socialSignIn(provider, payload); setPreview(null); onResult(r); }
    catch (e) {
      if (e instanceof ApiError && e.code === 'WRONG_WORKSPACE') setErr(STAFF_APP ? 'That account is a coach or team account. Use the coach workspace or the administrative portal sign-in.' : CLIENTS_ONLY);
      else if (e instanceof ApiError && e.code === 'RATE_LIMITED') setErr('Too many attempts. Wait a few minutes and try again.');
      else if (e instanceof ApiError && e.code === 'FEATURE_DISABLED') setErr('Signing in this way is switched off on this server. Use your email and password.');
      else setErr(errorText(e));
    } finally { setBusy(false); }
  };

  return <View style={styles.stack}>
    {divider ? <TitledDivider text={divider} strong style={styles.divider} /> : null}
    {googleOn ? (standin ? <ProviderButton provider="google" title="Continue with Google" onPress={() => setPreview('google')} disabled={busy} /> : <GoogleButton ids={ids} busy={busy} onToken={(p) => { void run('google', p); }} onError={setErr} />) : null}
    {appleOn ? (standin ? <ProviderButton provider="apple" title="Continue with Apple" onPress={() => setPreview('apple')} disabled={busy} />
      : Platform.OS === 'ios' ? <AppleNativeButton busy={busy} onCredential={(p) => { void run('apple', p); }} onError={setErr} />
      : s?.appleServicesId ? <AppleWebButton servicesId={s.appleServicesId} busy={busy} onToken={(p) => { void run('apple', p); }} onError={setErr} /> : null) : null}
    {err ? <Notice kind="error">{err}</Notice> : null}
    {standin ? <PreviewSheet provider={preview} open={preview !== null} onClose={() => { if (!busy) setPreview(null); }} busy={busy} onContinue={(standinEmail, standinName) => { void run('standin', standinName ? { standinEmail, standinName } : { standinEmail }); }} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  divider: { marginBottom: 8 },
  provider: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 14, borderRadius: fx.radius.xl, borderWidth: 1, borderColor: fx.line.a10 },
  sheet: { gap: 16 },
});
