/* Create an account (POST /auth/register), in the sign-in's look: name, email, password (with the show/hide eye), an
   optional phone and a friend's referral code, the terms and privacy acceptance (links to the server's /terms and
   /privacy) and the optional news consent. Every check and sentence of the form is as before (E2E reads them). The
   next screen confirms the email; a demo server fills its code in (no email leaves it). Opened with a session already
   on this device, it goes to that session's home (usePreviewAway); in the open preview it draws its form, with the
   sign-in's one-tap "Continue without signing in" card above it (release 1.0.0, the owner's testing build).
   Motion v2 (C05): it enters in beats (Back, eyebrow and title; the subtitle; the form; the sign-in line) and leaves
   for the email step in one flow exit (src/flow/auth/leave); its fields keep the kit's error motion.
   After a refused submit each field's message goes as soon as that field passes its own check (release T6-10). The
   terms and privacy links and "Sign in" are 44 pt touch boxes (release T5-17). */
import { Redirect, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Button, Check, Field, Input, Notice, RingSpinner, T, fx } from '@/fx';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { apiBaseSync } from '@/lib/config';
import { usePreviewAway, usePreviewOffer } from '@/components/openPreview';
import { AuthScreen } from '@/flow/auth/AuthScreen';
import { useAuthLeave } from '@/flow/auth/leave';
import { PreviewCard, useHeldOffer, useHomeExit } from '@/flow/auth/PreviewCard';

export default function Register() {
  const { register, config } = useAuth();
  // a confirmation link is promised only where email is delivered (GET /public/config emailDelivered); otherwise it goes to
  // the outbox, and on a demo server the next screen fills in the code
  const emailSent = config?.emailDelivered === true;
  const emailHint = emailSent ? 'We send a confirmation link to it.' : config?.demo ? 'You confirm it with a code on the next screen.' : 'You sign in with it.';
  const router = useRouter();
  const [f, setF] = useState({ name: '', email: '', password: '', phone: '', referralCode: '' });
  const [accept, setAccept] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const away = usePreviewAway();
  const preview = useHeldOffer(usePreviewOffer()); // the one-tap card, as on the sign-in
  const leave = useAuthLeave();
  // the preview card's way Home: the column leaves while Home renders behind it; the backdrop stays until Home's
  // first frame replaces the screen (useHomeExit, release T4-02)
  const toHome = useHomeExit(leave);
  const [leaving, setLeaving] = useState(false); // on the way Home: the faded screen takes no touches
  const home = () => { setLeaving(true); toHome(); };
  // a message shown after a refused submit goes once its field passes the same check (the others stay)
  const passes: Partial<Record<keyof typeof f, (v: string) => boolean>> = {
    name: (v) => v.trim().length >= 2,
    email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()),
    password: (v) => v.length >= 10,
  };
  const clearIf = (k: string, ok: boolean) => { if (ok) setErrs((x) => (x[k] ? Object.fromEntries(Object.entries(x).filter(([key]) => key !== k)) : x)); };
  const set = (k: keyof typeof f) => (v: string) => { setF((s) => ({ ...s, [k]: v })); const check = passes[k]; clearIf(k, check ? check(v) : true); };
  const onAccept = (v: boolean) => { setAccept(v); clearIf('accept', v); };
  const go = async () => {
    const e: Record<string, string> = {};
    if (!passes.name!(f.name)) e.name = 'Please tell us your name.';
    if (!passes.email!(f.email)) e.email = emailSent ? 'Enter a working email; we send a link to it.' : 'Enter a valid email address.';
    if (!passes.password!(f.password)) e.password = 'At least 10 characters.';
    if (!accept) e.accept = 'Please accept the terms and the privacy policy.';
    setErrs(e); setErr(null);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const r = await register({ name: f.name.trim(), email: f.email.trim(), password: f.password, phone: f.phone.trim() || undefined, referralCode: f.referralCode || undefined, marketing });
      leave.go(() => router.replace({ pathname: '/(auth)/verify', params: r.demoToken ? { demoToken: r.demoToken } : {} }));
    } catch (ex) {
      if (ex instanceof ApiError) { const fe = ex.fieldErrors(); if (Object.keys(fe).length) setErrs(fe); else if (ex.status === 409) setErr('There is already an account with that email. Sign in instead.'); else setErr(ex.message); }
      else setErr('Could not create the account.');
    } finally { setBusy(false); }
  };
  const open = (path: string) => Linking.openURL(`${apiBaseSync()}/${path}`).catch(() => {});
  if (away.to) return <Redirect href={away.to as never} />;
  return <AuthScreen slot="auth.register.backdrop" back small title="Create your account" subtitle="One account for the app and the website. You must be 18 or over." leave={leave} inert={leaving}
    trailing={away.wait ? null : <Pressable accessibilityRole="link" onPress={() => router.replace('/(auth)/sign-in')} style={styles.lineLink}>
      <T v="body" color={fx.ink.a60} center>Already have an account? <T v="body" style={styles.link}>Sign in</T></T>
    </Pressable>}>
    {away.wait ? <View style={styles.wait}><RingSpinner size={24} label="Loading" /></View> : <>
      {preview.offer ? <PreviewCard preview={preview} onOpened={home} /> : null}
      <Field label="Your name" error={errs.name}><Input value={f.name} onChangeText={set('name')} autoComplete="name" textContentType="name" /></Field>
      <Field label="Email" title="Email address" error={errs.email} hint={emailHint}><Input value={f.email} onChangeText={set('email')} placeholder="you@example.com" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" /></Field>
      <Field label="Password" error={errs.password} hint="At least 10 characters. A phrase you can remember works well."><Input value={f.password} onChangeText={set('password')} secureToggle autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" /></Field>
      <Field label="Phone (optional)" error={errs.phone} hint="With the country code, like +919812345678."><Input value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" autoComplete="tel" /></Field>
      {/* optional: letters and digits only, up to 16, in capitals; the server records the referral only when the code qualifies and ignores it otherwise */}
      <Field label="Referral code (from a friend)" error={errs.referralCode} hint="Optional. Letters and digits, as your friend shared it."><Input value={f.referralCode} onChangeText={(v) => set('referralCode')(v.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 16))} autoCapitalize="characters" autoCorrect={false} autoComplete="off" maxLength={16} mono /></Field>
      <View style={styles.checks}>
        <Check checked={accept} onChange={onAccept} label="I have read and accept the terms of use and the privacy policy." />
        <View style={styles.readRow}>
          <T v="caption" color={fx.ink.a60} style={styles.readWord}>Read them:</T>
          <Pressable accessibilityRole="link" onPress={() => open('terms')} style={styles.readLink}><T v="caption" color={fx.red.label}>terms</T></Pressable>
          <T v="caption" color={fx.ink.a60} style={styles.readWord}>·</T>
          <Pressable accessibilityRole="link" onPress={() => open('privacy')} style={styles.readLink}><T v="caption" color={fx.red.label}>privacy</T></Pressable>
        </View>
        {errs.accept ? <T v="caption" color={fx.red.label} style={styles.read} accessibilityRole="alert">{errs.accept}</T> : null}
        <Check checked={marketing} onChange={setMarketing} label="Email me occasional Bioptime news (optional)." />
      </View>
      {err ? <Notice kind="error">{err}</Notice> : null}
      <Button title="Create account" iconRight="arrow-right" commit onPress={go} busy={busy} />
    </>}
  </AuthScreen>;
}

const styles = StyleSheet.create({
  wait: { paddingVertical: 32, alignItems: 'center' },
  checks: { gap: 4 },
  read: { marginLeft: 32, marginBottom: 6 },
  // the caption's line keeps its place under the acceptance check; each link's touch box is 44 pt tall, reaching only
  // the 4 pt gap above (up to the check's own box, so a tap on the check never opens a page) and 24 pt below, where
  // the row keeps that much room before the next line (release review PK5-R2). The row itself is the boxes' height
  // and takes back the column's 4 pt gaps (no negative margin across a row: Android and the web place those
  // differently); every word sits 4 pt down, so they stay on one line
  readRow: { flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap', marginLeft: 32, marginTop: -4, marginBottom: -4 },
  readWord: { paddingTop: 4 },
  readLink: { paddingTop: 4, paddingBottom: 24, paddingHorizontal: 8, marginHorizontal: -2 },
  lineLink: { minHeight: 44, justifyContent: 'center', alignSelf: 'stretch' },
  link: { color: fx.red.label },
});
