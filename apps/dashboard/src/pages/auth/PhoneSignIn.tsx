/* /login/client/phone: a member signs in with a six-digit code for the phone number they confirmed. The same frame and
   look as the member sign-in page (pages/auth/Logins.tsx: the classes, the brand mark and the backdrop scene, which
   stands down under reduced motion), two steps (the number, then the code). The server decides everything: its answer
   is the same for every number, so this page never says whether a number has an account; codes work once, for 10
   minutes; members only. Delivery copy comes from the server's answer: while SMS is the outbox (delivered: false) no text
   message is sent and the page says so, never "we text". Shown while the switch phone_sign_in is on (GET /public/config
   features). Where the server names a preview helper in its answer (demo mode only: POST /auth/demo/phone-code, the
   number in the body, never in the URL), "Fill in the preview code" fetches the sign-in code of one of the prepared
   members, like the authenticator helper on the administrators' sign-in. */
import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiRequestError } from '../../lib/api';
import { ROLE_HOME, useAuth, type User } from '../../lib/auth';
import { Alert, Button, Field, Input, Skeleton, useApi } from '../../ui';
import { BrandMark3D, BrandScene } from '../../components/BrandMark3D';

type Step = 'phone' | 'code';

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="auth auth-client">
    <div className="authBg" aria-hidden="true"><span className="orb orbA" /><span className="orb orbB" /><span className="authGrid" /></div>
    <BrandScene variant="auth" tone="client" />
    <div className="authLayout">
      <BrandMark3D className="authMark" hosted />
      <div className="authCard bp-card">
        <img className="authLogo" src="/portal/bioptime-lockup-horizontal-on-dark.svg" alt="Bioptime" />
        <span className="bp-eyebrow bp-eyebrow-accent">Members</span>
        <h1>Sign in with your phone</h1>
        <p className="small authLead">Sign in with a six-digit code for the mobile number you confirmed on your Bioptime account.</p>
        {children}
      </div>
    </div>
    <p className="authFoot small">Bioptime offers general wellbeing guidance and coaching, not medical advice. <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/contact">Support</a></p>
  </div>;
}

/** The message for an error from the phone routes: the server's own words, or a plain one for the cases it names. */
function errorFor(e: unknown): string {
  if (!(e instanceof ApiRequestError)) return e instanceof Error ? e.message : 'Something went wrong. Try again.';
  if (e.code === 'FEATURE_DISABLED') return 'Signing in with a phone code is switched off. Sign in with your email and password.';
  if (e.code === 'VALIDATION_FAILED') {
    const first = Array.isArray(e.details) ? (e.details as Array<{ message?: string }>)[0]?.message : undefined;
    return first ?? e.message;
  }
  return e.message;
}

export function PhoneSignIn() {
  const { setSession, user } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const config = useApi(() => api.get('/public/config'), []);
  const features: string[] = (config.data as any)?.features ?? [];
  const on = features.includes('phone_sign_in');
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState('');
  const [delivered, setDelivered] = useState(false);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [err, setErr] = useState<React.ReactNode>('');
  const [busy, setBusy] = useState(false);
  const nextParam = params.get('next');
  const next = nextParam && /^\/(?![\/\\])[\w\-./?=&%]*$/.test(nextParam) ? nextParam : null; // same-site paths only
  const back = `/login/client${next ? `?next=${encodeURIComponent(next)}` : ''}`;

  useEffect(() => {
    if (!user || user.role !== 'member') return;
    if (next) { if (next.startsWith('/client')) nav(next, { replace: true }); else window.location.assign(next); return; }
    nav(ROLE_HOME.member, { replace: true });
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const ask = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await api.post<{ message: string; delivered?: boolean; previewCodePath?: string }>('/auth/phone/start', { phone: phone.trim(), workspace: 'client' });
      setSent(r.message); setDelivered(r.delivered === true); setCode(''); setStep('code');
      setPreviewPath(typeof r.previewCodePath === 'string' && /^\/auth\/[\w/-]+$/.test(r.previewCodePath) ? r.previewCodePath : null);
    } catch (ex) { setErr(errorFor(ex)); } finally { setBusy(false); }
  };

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await api.post<{ user: User; permissions?: string[] }>('/auth/phone/verify', { phone: phone.trim(), code: code.trim(), workspace: 'client' });
      setSession(r.user, r.permissions ?? []);
    } catch (ex) {
      if (ex instanceof ApiRequestError && ex.code === 'ACCOUNT_SUSPENDED') setErr(<>This account is suspended. <a href="/contact">Contact support</a>.</>);
      else setErr(errorFor(ex));
    } finally { setBusy(false); }
  };

  // only where the server names its preview helper (demo mode): the sign-in code of one of the prepared members, so the
  // flow can be tried without a real SMS; the number goes in the body, never in the URL
  const fillPreview = async () => {
    if (!previewPath) return;
    try { const r = await api.post<{ code: string }>(previewPath, { phone: phone.trim() }); setCode(r.code); setErr(''); }
    catch (ex) { setErr(errorFor(ex)); }
  };

  if (!config.data && !config.error) return <Frame><Skeleton rows={3} /></Frame>;
  if (!on) return <Frame>
    <Alert kind="info" title="Not available here">Signing in with a phone code is not switched on. Sign in with your email and password instead.</Alert>
    <div className="authLinks"><a href={back}>Sign in with email and password</a></div>
  </Frame>;

  return <Frame>
    {step === 'phone' ? <form className="form" onSubmit={ask} noValidate>
      <Field label="Mobile number" hint="With the country code, like +91 98123 45678. It must be the number you confirmed on your account."><Input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required autoFocus /></Field>
      {err && <Alert kind="error">{err}</Alert>}
      <Button variant="primary" size="lg" busy={busy} type="submit" disabled={phone.trim().length < 6}>Send me a code</Button>
    </form> : <form className="form" onSubmit={signIn} noValidate>
      <Alert kind="info">{sent}</Alert>
      <Field label="Six-digit code" hint={delivered ? 'From the text message. It works once, for 10 minutes; five wrong tries end it.' : 'It works once, for 10 minutes; five wrong tries end it.'}><Input inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required autoFocus /></Field>
      {previewPath && <p className="small"><button type="button" className="linkButton" onClick={fillPreview}>Fill in the preview code</button></p>}
      {err && <Alert kind="error">{err}</Alert>}
      <Button variant="primary" size="lg" busy={busy} type="submit" disabled={code.trim().length !== 6}>Sign in</Button>
      <div className="row between authLinks">
        <button type="button" className="linkButton" onClick={() => void ask()} disabled={busy}>Send a new code</button>
        <button type="button" className="linkButton" onClick={() => { setStep('phone'); setCode(''); setErr(''); }}>Use a different number</button>
      </div>
    </form>}
    <div className="row between authLinks">
      <a href={back}>Sign in with email and password</a>
      <a href="/register">Create an account</a>
    </div>
    <p className="muted small">Codes are only for a mobile number confirmed on a member account. Coaches and administrators sign in with their email and password.</p>
  </Frame>;
}
