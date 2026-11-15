/* Sign in with a phone code (switch 'phone_sign_in'), shared by the sign-in's Phone segment and the /(auth)/phone screen.
   Two steps, in the earlier app's look: the number (a 72 pt country code box, +91 by default, beside the digits; a number
   typed with a leading "+" is used as typed), then the six-digit code in six boxes with the resend countdown.
   The server's answer is the same for every number, so nothing here says whether a number has an account; codes work
   once, for 10 minutes; members only. Delivery copy comes from the server's answer: while SMS is the outbox
   (delivered: false) no text message is sent and the screen says so, never "we text". Where the server names a preview
   helper in its answer (demo mode only), "Fill in the preview code" asks it (a POST, the number in the body, never in
   the URL) for the sign-in code of one of the prepared members. A good code opens the session and calls onSignedIn
   (the screen shows the Verified moment, then goes Home).
   Motion v2: the number and the code are two steps of one FlowSwap (M57): the number leaves upward while the code
   card rises in, overlapped, the number inert from its first exit frame. A wrong code is cleared otp.clearAfter after
   its shake (the boxes fade their digits and take the focus again, M60). */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Button, Field, GlassCard, Input, Notice, OtpBoxes, Sheet, T, fx, haptics } from '@/fx';
import { FlowSwap } from '@/fx/FxScreen';
import type { OtpBoxesHandle } from '@/fx/OtpBoxes';
import { motionValues } from '@/fx/motion/tokens';
import { ApiError, errorText, post, setToken } from '@/lib/api';
import { keepSessionFrom, signInServer, useAuth, type User } from '@/lib/auth';
import { clearCache } from '@/lib/cache';
import { refreshFeatures } from '@/lib/features';

/** The earlier app's country list (+91 first). */
const COUNTRIES: Array<{ code: string; name: string }> = [
  { code: '+91', name: 'India' }, { code: '+1', name: 'United States and Canada' }, { code: '+44', name: 'United Kingdom' },
  { code: '+61', name: 'Australia' }, { code: '+971', name: 'United Arab Emirates' }, { code: '+65', name: 'Singapore' },
  { code: '+49', name: 'Germany' }, { code: '+33', name: 'France' }, { code: '+81', name: 'Japan' }, { code: '+86', name: 'China' },
  { code: '+966', name: 'Saudi Arabia' }, { code: '+60', name: 'Malaysia' },
];
const RESEND_S = 30;

function message(e: unknown): string {
  if (e instanceof ApiError && e.code === 'FEATURE_DISABLED') return 'Signing in with a phone code is switched off. Sign in with your email and password.';
  if (e instanceof ApiError && e.code === 'VALIDATION_FAILED') return Object.values(e.fieldErrors())[0] ?? e.message;
  return errorText(e);
}

export function PhoneCodeForm({ onSignedIn }: { onSignedIn: (u: User) => void }) {
  const { setSession } = useAuth();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [country, setCountry] = useState('+91');
  const [picking, setPicking] = useState(false);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState('');
  const [delivered, setDelivered] = useState(false);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0); // seconds before "Send a new code"
  const otp = useRef<OtpBoxesHandle>(null);

  const typed = phone.trim();
  const asTyped = typed.startsWith('+');
  // the number the server gets: as typed with its "+", else the country code and the digits
  const full = asTyped ? typed : `${country}${typed.replace(/\D/g, '')}`;
  const enough = typed.replace(/\D/g, '').length >= 6;

  // a wrong code: cleared (and the focus back in the boxes) otp.clearAfter after the error's shake
  const wrong = !!err && step === 'code' && code.length === 6;
  useEffect(() => {
    if (!wrong) return;
    const timer = setTimeout(() => otp.current?.clear(), motionValues.otp.clearAfter);
    return () => clearTimeout(timer);
  }, [wrong]);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const ask = async () => {
    setErr(null); setBusy(true);
    try {
      const r = await post<{ message: string; delivered?: boolean; previewCodePath?: string }>('/auth/phone/start', { phone: full, workspace: 'client' });
      setSent(r.message); setDelivered(r.delivered === true); setCode(''); setStep('code'); setWait(RESEND_S);
      setPreviewPath(typeof r.previewCodePath === 'string' && /^\/auth\/[\w/-]+$/.test(r.previewCodePath) ? r.previewCodePath : null);
    }
    catch (e) { setErr(message(e)); } finally { setBusy(false); }
  };
  const signIn = async (value = code) => {
    if (busy || value.length !== 6) return;
    setErr(null); setBusy(true);
    try {
      const from = signInServer(); // a session minted by one server is never kept for another (lib/auth keepSessionFrom)
      const r = await post<{ user: User; session: { token?: string } }>('/auth/phone/verify', { phone: full, code: value.trim(), workspace: 'client' });
      await clearCache(); // never show one member the last-good copies of another
      keepSessionFrom(from);
      if (r.session?.token) await setToken(r.session.token);
      refreshFeatures();
      setSession(r.user);
      onSignedIn(r.user);
    } catch (e) { setErr(message(e)); } finally { setBusy(false); }
  };
  // only where the server names its preview helper (demo mode): the sign-in code of one of the prepared members, so the
  // flow can be tried without a real SMS; the number goes in the body, never in the URL
  const fillPreview = async () => {
    if (!previewPath) return;
    try { const r = await post<{ code: string }>(previewPath, { phone: full }); setCode(r.code); setErr(null); haptics.light(); }
    catch (e) { setErr(message(e)); }
  };

  const picker = <Sheet visible={picking} onClose={() => setPicking(false)} title="Country code">
    <View accessibilityRole="radiogroup">
      {COUNTRIES.map((c) => <Pressable key={c.code} accessibilityRole="radio" accessibilityState={{ checked: c.code === country }} aria-checked={c.code === country} accessibilityLabel={`${c.name} ${c.code}`}
        onPress={() => { haptics.select(); setCountry(c.code); setPicking(false); }}
        style={({ pressed }) => [styles.option, pressed ? styles.optionPressed : null]}>
        <T v="body" style={styles.flex}>{c.name}</T>
        <T v="mono14" color={c.code === country ? fx.red.label : fx.ink.a60}>{c.code}</T>
      </Pressable>)}
    </View>
  </Sheet>;

  return <>
    <FlowSwap id={step}>
      {step === 'phone' ? <View style={styles.stack}>
        <Field label="Mobile number" hint="The number confirmed on your Bioptime account. A number typed with + is used as typed.">
          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Country code ${country}`}
              accessibilityHint="Choose the country code"
              onPress={() => setPicking(true)}
              style={({ pressed }) => [styles.country, { opacity: asTyped ? 0.4 : 1, borderColor: pressed ? fx.line.a20 : fx.line.a10 }]}>
              <T v="mono14" style={styles.countryText}>{country}</T>
            </Pressable>
            <View style={styles.flex}><Input value={phone} onChangeText={setPhone} placeholder="000 000 0000" keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" maxLength={20} onSubmitEditing={() => { if (enough) void ask(); }} /></View>
          </View>
        </Field>
        {err ? <Notice kind="error">{err}</Notice> : null}
        <Button title="Send me a code" iconRight="arrow-right" commit onPress={ask} busy={busy} disabled={!enough} />
      </View> : <View style={styles.stack}>
        <GlassCard variant="card" padding={24} style={styles.card}>
          <T v="card24" center accessibilityRole="header">Enter your code</T>
          {sent ? <T v="body" center color={fx.ink.a80}>{sent}</T> : null}
          <Field label="Six-digit code" hint={delivered ? 'From the text message. It works once, for 10 minutes; five wrong tries end it.' : 'It works once, for 10 minutes; five wrong tries end it.'} style={styles.codeField}>
            <OtpBoxes ref={otp} value={code} onChange={(v) => { setCode(v); if (v) setErr(null); /* the clear after an error keeps its words */ }} onComplete={(v) => { void signIn(v); }} error={!!err} autoFocus />
          </Field>
          {previewPath ? <Button title="Fill in the preview code" variant="soft" small full={false} icon="sparkles" onPress={fillPreview} style={styles.centre} /> : null}
          <View style={styles.resend}>
            {wait > 0
              ? <T v="eyebrowStore" color={fx.ink.a60} accessibilityLiveRegion="none">{`Didn’t receive it?  ${wait}s`}</T>
              : <Button title="Send a new code" variant="link" iconRight={null} onPress={ask} disabled={busy} />}
          </View>
        </GlassCard>
        {err ? <Notice kind="error">{err}</Notice> : null}
        <Button title="Sign in" iconRight="arrow-right" commit onPress={() => { void signIn(); }} busy={busy} disabled={code.length !== 6} />
        <Button title="Use a different number" variant="back" onPress={() => { setStep('phone'); setCode(''); setErr(null); }} style={styles.centre} />
      </View>}
    </FlowSwap>
    {picker}
  </>;
}

const styles = StyleSheet.create({
  stack: { gap: 16 },
  row: { flexDirection: 'row', gap: 12 },
  flex: { flex: 1 },
  country: { width: 72, minHeight: 52, borderRadius: fx.radius.xl, borderWidth: 1, backgroundColor: fx.fill.a05, alignItems: 'center', justifyContent: 'center' },
  countryText: { fontSize: 16, lineHeight: 22 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 4, minHeight: 48, borderBottomWidth: 1, borderBottomColor: fx.line.a05 },
  optionPressed: { backgroundColor: fx.fill.a05 },
  card: { gap: 16 },
  codeField: { alignItems: 'stretch' },
  centre: { alignSelf: 'center' },
  resend: { alignItems: 'center', minHeight: 24, justifyContent: 'center' },
});
