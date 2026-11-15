/* Three separate sign-in pages. Same identity system, one page per audience: a calm welcome for members, a
   professional workspace entry for coaches, a security-first entrance for administrators (MFA required). The server
   decides every outcome: the workspace sent with the credentials limits which roles may sign in through this page.
   Coaches sign in with their Coach ID (the code on their coach profile, BPC-…) or their email: a value without "@" is
   sent as coachId, anything else as email. An administrator or owner without two-factor authentication gets
   403 MFA_ENROLMENT_REQUIRED with a short-lived enrolment token; the page then sets it up (secret, otpauth link, a
   six-digit code) and the confirmation signs them in.
   Open preview (sign-in switched off for now, demo mode only; lib/auth.tsx): the page shows no form; it opens the
   workspace's preview account at once ("Opening…") and goes on into the workspace. If that fails, or the workspace guard
   already failed to open it (state.openError), the usual form is shown with the reason. A workspace the server's open
   preview does not open (GET /public/config openPreviewWorkspaces; the shared link opens member and coach only) shows
   its form as always. "Fill in the preview code" (demo mode) is offered only where the server names the helper in its
   answer (previewCodePath) and does not say demoStaffHelpers: false. */
import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiRequestError } from '../../lib/api';
import { ROLE_HOME, useAuth, WORKSPACE_TITLE, type User } from '../../lib/auth';
import { staffHelpersFrom } from '../../lib/openPreview';
import { Alert, Button, Field, Input, useApi } from '../../ui';
import { BrandMark3D, BrandScene } from '../../components/BrandMark3D';

type Variant = 'client' | 'coach' | 'admin';
/* leadOpen: the lead while an open preview opens the workspace without a sign-in (no second factor is asked for then) */
const COPY: Record<Variant, { eyebrow: string; title: string; lead: string; leadOpen?: string; workspace: string; roles: string[]; cta: string }> = {
  client: { eyebrow: 'Members', title: 'Welcome back.', lead: 'Your programme, your coach, your blood tests and your progress, in one place.', workspace: 'client', roles: ['member'], cta: 'Sign in' },
  coach: { eyebrow: 'Coaches', title: 'Coach workspace', lead: 'Your clients, their plans, reports to review and the consultations on your calendar.', workspace: 'coach', roles: ['coach'], cta: 'Sign in to the workspace' },
  admin: { eyebrow: 'Administration', title: 'Administrative portal', lead: 'Packages, assignments, content, integrations and the audit trail. A second factor is required.', leadOpen: 'Packages, assignments, content, integrations and the audit trail.', workspace: 'admin', roles: ['admin', 'owner'], cta: 'Continue' },
};

/** The shared frame: brand, a restrained animated backdrop (stilled under reduced motion), the card and the small print. */
function AuthFrame({ variant, opening = false, children }: { variant: Variant; opening?: boolean; children: React.ReactNode }) {
  const c = COPY[variant];
  return <div className={`auth auth-${variant}`}>
    <div className="authBg" aria-hidden="true"><span className="orb orbA" /><span className="orb orbB" /><span className="authGrid" /></div>
    <BrandScene variant="auth" tone={variant} />
    <div className="authLayout">
    <BrandMark3D className="authMark" hosted />
    <div className="authCard bp-card">
      <img className="authLogo" src="/portal/bioptime-lockup-horizontal-on-dark.svg" alt="Bioptime" />
      <span className="bp-eyebrow bp-eyebrow-accent">{c.eyebrow}</span>
      <h1>{c.title}</h1>
      <p className="small authLead">{opening ? c.leadOpen ?? c.lead : c.lead}</p>
      {children}
    </div>
    </div>
    <p className="authFoot small">Bioptime offers general wellbeing guidance and coaching, not medical advice. <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/contact">Support</a></p>
  </div>;
}

/** "next": same-site paths only. */
function safeNext(v: string | null): string | null { return v && /^\/(?![\/\\])[\w\-./?=&%]*$/.test(v) ? v : null; }

/** The page: the sign-in form, or, in open preview, the workspace opening on its own (the form only if that fails). */
function LoginPage({ variant }: { variant: Variant }) {
  const c = COPY[variant];
  const { user, loading, previewOpens, openWorkspace } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string; openError?: string } };
  const [params] = useSearchParams();
  // one place decides where a signed-in user of the right kind goes: the page they asked for inside their workspace, else its home
  const from = loc.state?.from;
  const next = safeNext(params.get('next'));
  useEffect(() => {
    if (!user || !c.roles.includes(user.role)) return;
    const home = ROLE_HOME[user.role];
    if (next && user.role === 'member') { if (next.startsWith('/client')) nav(next, { replace: true }); else window.location.assign(next); return; }
    nav(from && from.startsWith(home) ? from : home, { replace: true });
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  const signedInHere = !!user && c.roles.includes(user.role);
  // the guard of a workspace already tried and failed: the form, with its reason, and no second try from here
  const [openErr, setOpenErr] = useState<string>(() => loc.state?.openError ?? '');
  const tried = useRef(false);
  const opens = previewOpens(variant); // this workspace opens without signing in (the open preview is on and opens it)
  const opening = opens && !openErr && !signedInHere;
  useEffect(() => {
    if (loading || !opening || tried.current) return;
    tried.current = true;
    // a signed-in account of this workspace goes on in the effect above; this one only opens the preview account
    // a tab without an account counts towards the loop guard; one holding another workspace's account is a switch
    openWorkspace(variant, user ? 'switch' : 'fresh').then(
      (u) => { if (!c.roles.includes(u.role)) setOpenErr(`The ${WORKSPACE_TITLE[variant]} opened an account of another kind (${u.role}).`); },
      (e: unknown) => setOpenErr(e instanceof Error && e.message ? e.message : `The ${WORKSPACE_TITLE[variant]} could not be opened.`),
    );
  }, [loading, opening]); // eslint-disable-line react-hooks/exhaustive-deps
  // the page waits for the session and the server's settings (both asked at once) so that an open preview never shows
  // the form first; then the form as always, or the opening state
  const showOpening = !loading && (opening || (opens && !openErr && signedInHere));
  return <AuthFrame variant={variant} opening={showOpening}>
    {loading ? <div className="form" aria-busy="true"><p className="muted small" role="status">Checking your session…</p></div>
      : showOpening ? <div className="form" aria-busy="true"><p className="muted" role="status">Opening the {WORKSPACE_TITLE[variant]}…</p></div>
      : <LoginForm variant={variant} initialError={openErr} />}
  </AuthFrame>;
}

function LoginForm({ variant, initialError = '' }: { variant: Variant; initialError?: string }) {
  const c = COPY[variant];
  const { setSession } = useAuth();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [mfa, setMfa] = useState('');
  const [needMfa, setNeedMfa] = useState(false);
  const [enrol, setEnrol] = useState<{ token: string; minutes: number; preview: boolean } | null>(null);
  // the "code needed" answer named the preview helper (demo mode, and not withheld for this account by the server)
  const [mfaPreview, setMfaPreview] = useState(false);
  const [err, setErr] = useState<React.ReactNode>(initialError);
  const [busy, setBusy] = useState(false);
  const config = useApi(() => api.get('/public/config'), []);
  const demo = !!(config.data as any)?.demo;
  // the server's preview helpers for administrator and owner accounts (absent = on, as before)
  const staffHelpers = staffHelpersFrom(config.data);
  // members may also sign in with a one-time code sent by SMS once the server offers it (GET /public/config features)
  const phoneSignIn = variant === 'client' && ((config.data as any)?.features ?? []).includes('phone_sign_in');
  // demo mode only: the seeded admin and owner share a synthetic authenticator, so the page can fill its current code
  const fillDemoCode = async () => { try { const r = await api.get<{ code: string }>(`/auth/demo/totp?email=${encodeURIComponent(email.trim().toLowerCase())}`); setMfa(r.code); } catch (e) { setErr(e instanceof ApiRequestError ? e.message : 'The preview code could not be fetched'); } };
  const expired = params.get('expired') === '1';
  // an admin route refused the last session because two-factor authentication is not set up yet (lib/auth.tsx)
  const mfaRequired = variant === 'admin' && params.get('mfa') === 'required';
  const next = safeNext(params.get('next'));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      // the coach page takes a Coach ID or an email: without "@" it is the Coach ID
      const id = email.trim();
      const who = variant === 'coach' && id && !id.includes('@') ? { coachId: id } : { email: id };
      const r = await api.post<{ user: User; permissions?: string[] }>('/auth/login', { ...who, password, workspace: c.workspace, ...(needMfa && mfa ? { mfaCode: mfa.trim() } : {}) });
      setSession(r.user, r.permissions ?? []);
    } catch (ex) {
      if (ex instanceof ApiRequestError && ex.code === 'MFA_REQUIRED') { setMfaPreview(typeof (ex.details as any)?.previewCodePath === 'string'); setNeedMfa(true); setErr(''); }
      else if (ex instanceof ApiRequestError && ex.code === 'MFA_ENROLMENT_REQUIRED' && typeof (ex.details as any)?.enrolmentToken === 'string') { setEnrol({ token: (ex.details as any).enrolmentToken, minutes: Number((ex.details as any).expiresInMinutes) || 15, preview: !!(ex.details as any).previewCodePath }); setPassword(''); setErr(''); }
      else if (ex instanceof ApiRequestError && ex.code === 'WRONG_WORKSPACE') setErr(<>That account does not sign in here. {variant === 'client' ? <>Coaches use the <a href="/login/coach">coach workspace</a>; administrators the <a href="/login/admin">administrative portal</a>.</> : variant === 'coach' ? <>Members use the <a href="/login/client">member sign-in</a>; administrators the <a href="/login/admin">administrative portal</a>.</> : <>Members use the <a href="/login/client">member sign-in</a>; coaches the <a href="/login/coach">coach workspace</a>.</>}</>);
      else if (ex instanceof ApiRequestError && ex.code === 'RATE_LIMITED') setErr('Too many attempts. Wait a few minutes and try again; the account is protected, not lost.');
      else if (ex instanceof ApiRequestError && ex.code === 'ACCOUNT_SUSPENDED') setErr(<>This account is suspended. <a href="/contact">Contact support</a>.</>);
      else if (ex instanceof ApiRequestError && ex.code === 'ACCOUNT_CLOSED') setErr(<>This account is closed. <a href="/contact">Contact support</a>.</>);
      else if (ex instanceof ApiRequestError && ex.code === 'INVITATION_PENDING') setErr(<>Finish setting up from your invitation link first. If it expired, ask an administrator for a new one.</>);
      else setErr(ex instanceof Error ? ex.message : 'Sign-in failed');
    } finally { setBusy(false); }
  };

  // demo mode only, as for the sign-in code: the preview helper answers for the secret the set-up step just issued to a seeded account
  const previewEmail = enrol?.preview && demo && staffHelpers && email.trim().toLowerCase().endsWith('@demo.bioptime.test') ? email.trim().toLowerCase() : undefined;
  if (enrol) return <MfaEnrolment token={enrol.token} minutes={enrol.minutes} previewEmail={previewEmail} onSignedIn={(u, p) => setSession(u, p)} onRestart={(why) => { setEnrol(null); setNeedMfa(false); setMfa(''); setErr(why); }} />;

  return <form className="form" onSubmit={submit} noValidate>
    {mfaRequired && !err && <Alert kind="warning" title="Two-factor authentication is required">Administrator accounts now need an authenticator app as well as the password. You were signed out; sign in again and set it up in the next step.</Alert>}
    {expired && !err && !mfaRequired && <Alert kind="warning" title="Your session ended">Sign in again to continue. Sessions end a set time after sign-in, when you sign out elsewhere, or when the account is suspended.</Alert>}
    {/* the coach field takes a Coach ID too; it stays type="email" (the form is noValidate, so any text is accepted) so
        password managers and the portal's browser checks keep finding the sign-in field on every page */}
    <Field label={variant === 'coach' ? 'Coach ID or email' : 'Email'}><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
    <Field label="Password"><div className="row" style={{ flexWrap: 'nowrap' }}><Input type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required style={{ flex: 1 }} /><button type="button" className="bp-btn bp-btn-tertiary bp-btn-sm" onClick={() => setShow((s) => !s)} aria-pressed={show}>{show ? 'Hide' : 'Show'}</button></div></Field>
    {needMfa && <Field label="Authenticator code" hint="Six digits from your authenticator app. Wrong codes count toward the lockout."><Input inputMode="numeric" pattern="\d{6}" autoComplete="one-time-code" value={mfa} onChange={(e) => setMfa(e.target.value)} required autoFocus /></Field>}
    {needMfa && demo && staffHelpers && mfaPreview && email.trim().toLowerCase().endsWith('@demo.bioptime.test') && <p className="small"><button type="button" className="linkButton" onClick={fillDemoCode}>Fill in the preview code</button></p>}
    {err && <Alert kind="error">{err}</Alert>}
    <Button variant="primary" size="lg" busy={busy} type="submit">{needMfa ? 'Verify and sign in' : c.cta}</Button>
    {phoneSignIn && <div className="authLinks"><a href={`/login/client/phone${next ? `?next=${encodeURIComponent(next)}` : ''}`}>Sign in with a phone code</a></div>}
    <div className="row between authLinks">
      <a href="/reset-password">Forgotten your password?</a>
      {variant === 'client' ? <a href="/register">Create an account</a> : variant === 'coach' ? <span className="muted">Coach accounts are created by invitation.</span> : <span className="muted">Administrators are provisioned by an owner.</span>}
    </div>
    {variant === 'client' && <p className="muted small">New here? Your account is created on the website or by invitation; confirm your email, then set up in the app or here.</p>}
    {variant === 'coach' && <p className="muted small">Received an invitation? <a href="/login/coach/activate">Activate your workspace</a> with the link's code. Coaches sign in with their Coach ID or email and their password; two-factor sign-in is required for the Bioptime team.</p>}
    {variant === 'admin' && <p className="muted small">Administrator sessions end after 12 hours. Every sign-in and every change is in the audit log.</p>}
  </form>;
}

/** Groups a base32 secret in fours so it can be typed into an authenticator app without losing one's place. */
function grouped(secret: string): string { return (secret.replace(/\s+/g, '').match(/.{1,4}/g) ?? []).join(' '); }

/** The set-up step for an administrator or owner who signs in without two-factor authentication. The enrolment token
    from the refused sign-in is good only for these two calls and expires; nothing else is reachable until it is done. */
function MfaEnrolment({ token, minutes, previewEmail, onSignedIn, onRestart }: { token: string; minutes: number; previewEmail?: string; onSignedIn: (u: User, p: string[]) => void; onRestart: (why: string) => void }) {
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; // one secret per enrolment token
    started.current = true;
    api.post<{ secret: string; otpauthUri?: string; otpauth?: string }>('/auth/mfa/enrol/start', { enrolmentToken: token })
      .then((r) => setSetup({ secret: r.secret, otpauthUri: r.otpauthUri ?? r.otpauth ?? '' }))
      .catch((e) => setLoadErr(e instanceof Error ? e.message : 'The set-up could not start'));
  }, [token]);
  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await api.post<{ user: User; permissions?: string[] }>('/auth/mfa/enrol/confirm', { enrolmentToken: token, code: code.trim() });
      onSignedIn(r.user, r.permissions ?? []);
    } catch (ex) {
      // the set-up step is used up (expired, already used, five wrong codes) or done elsewhere: back to the password
      if (ex instanceof ApiRequestError && (/^TOKEN_/.test(ex.code) || ex.code === 'MFA_ALREADY_ENABLED' || ex.status === 409)) onRestart(`${ex.message} Sign in again to continue.`);
      else if (ex instanceof ApiRequestError && ex.code === 'RATE_LIMITED') setErr('Too many attempts. Wait a few minutes and try again; the account is protected, not lost.');
      else if (ex instanceof ApiRequestError && ex.code === 'MFA_INVALID' && typeof (ex.details as any)?.attemptsLeft === 'number' && !/attempt/i.test(ex.message)) setErr(`${ex.message} ${(ex.details as any).attemptsLeft} attempt${(ex.details as any).attemptsLeft === 1 ? '' : 's'} left.`);
      else setErr(ex instanceof Error ? ex.message : 'The code could not be checked');
    } finally { setBusy(false); }
  };
  const fillPreview = async () => { if (!previewEmail) return; try { const r = await api.get<{ code: string }>(`/auth/demo/totp?email=${encodeURIComponent(previewEmail)}`); setCode(r.code); } catch (e) { setErr(e instanceof ApiRequestError ? e.message : 'The preview code could not be fetched'); } };
  const restart = () => onRestart('');
  if (loadErr) return <div className="form">
    <Alert kind="error" title="Two-factor set-up could not start">{loadErr} The set-up step lasts {minutes} minutes and works once; sign in again to start over.</Alert>
    <Button variant="primary" size="lg" onClick={restart}>Sign in again</Button>
  </div>;
  return <form className="form" onSubmit={confirm} noValidate>
    <Alert kind="info" title="Set up two-factor authentication">Required for every administrator account, once. Add Bioptime to an authenticator app on your phone and enter the six-digit code it shows; after that, each sign-in asks for the password and a current code.</Alert>
    {!setup ? <p className="muted small">Preparing your secret…</p> : <>
      <Field label="Secret key" hint="Type it into the authenticator app as a time-based key for Bioptime; the spaces do not matter."><code className="idCode" style={{ fontSize: 14, letterSpacing: '0.04em', alignSelf: 'flex-start' }} aria-label="Secret key">{grouped(setup.secret)}</code></Field>
      {setup.otpauthUri && <p className="small">On the phone with the authenticator app: <a href={setup.otpauthUri}>open the set-up link</a> to add the account in one step.</p>}
      <Field label="Six-digit code from the app" hint={`The code changes every 30 seconds. This step expires ${minutes} minutes after your sign-in.`}><Input inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required autoFocus /></Field>
      {previewEmail && <p className="small"><button type="button" className="linkButton" onClick={fillPreview}>Fill in the preview code</button></p>}
    </>}
    {err && <Alert kind="error">{err}</Alert>}
    <Button variant="primary" size="lg" busy={busy} disabled={!setup || !/^\d{6}$/.test(code.trim())} type="submit">Turn on two-factor and sign in</Button>
    <div className="row between authLinks"><button type="button" className="linkButton" onClick={restart}>Start again</button><span className="muted">A lost authenticator is reset by another owner.</span></div>
  </form>;
}

export function ClientLogin() { return <LoginPage variant="client" />; }
export function CoachLogin() { return <LoginPage variant="coach" />; }
export function AdminLogin() { return <LoginPage variant="admin" />; }
