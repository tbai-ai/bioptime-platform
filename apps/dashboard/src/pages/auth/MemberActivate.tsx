/* First-time activation for a member an administrator invited: the link's token is previewed, the member sets a
   password and accepts the policies, a session starts and setup continues in the member portal. The token travels
   only in request bodies (POST preview and accept), never in an API path. */
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useNavigate } from '../../lib/nav';
import { api, ApiRequestError } from '../../lib/api';
import { forgetLinkToken, scrubTokenFromUrl, takeLinkToken } from '../../lib/linkToken';
import { useAuth, type User } from '../../lib/auth';
import { Alert, Button, Field, Input, Skeleton, useApi, errorText } from '../../ui';
import { BrandMark3D, BrandScene } from '../../components/BrandMark3D';

const TOKEN_KEY = 'bp.activation.member';
/** Answers after which this token can never work again: it is dropped from the tab's storage. */
const FINAL = ['TOKEN_USED', 'TOKEN_EXPIRED', 'ACTIVATION_STATE'];
/** A state error (409) carries its reason in details.code (ACTIVATION_STATE when accepting), other errors in code. */
const codeOf = (e: unknown) => (e instanceof ApiRequestError ? (e.details as { code?: string } | null | undefined)?.code ?? e.code : '');

export function MemberActivate() {
  const [params] = useSearchParams();
  // the single-use token is read once and removed from the address bar and history at once; it stays in this tab's
  // sessionStorage so a reload still works (lib/linkToken), and it is never logged
  const [token] = useState(() => takeLinkToken(TOKEN_KEY, params.get('token')));
  useEffect(() => { scrubTokenFromUrl(); }, []);
  const [code, setCode] = useState('');
  const preview = useApi(() => (token ? api.post('/auth/invitations/member/preview', { token }).catch((e: unknown) => { const c = codeOf(e); setCode(c); if (FINAL.includes(c)) forgetLinkToken(TOKEN_KEY); throw e; }) : Promise.resolve(null)), [token]);
  const { setSession } = useAuth();
  const nav = useNavigate();
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [accept, setAccept] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const p = preview.data as any;
  useEffect(() => { if (p) setName(p.name ?? ''); }, [p]); // seeded once when the preview arrives; the member may then clear or change it freely
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accept) { setErr('Accept the terms and the privacy notice to continue.'); return; }
    setBusy(true); setErr('');
    try {
      const r = await api.post<{ user: User; permissions?: string[] }>('/auth/invitations/member/accept', { token, password, name, acceptTerms: true, acceptPrivacy: true, termsVersion: '2026-10-17', marketingConsent: marketing });
      forgetLinkToken(TOKEN_KEY);
      setSession(r.user, r.permissions ?? []);
      nav('/client/welcome', { replace: true });
    } catch (ex) { if (FINAL.includes(codeOf(ex))) forgetLinkToken(TOKEN_KEY); setErr(errorText(ex)); } finally { setBusy(false); }
  };
  return <div className="auth auth-client">
    <div className="authBg" aria-hidden="true"><span className="orb orbA" /><span className="orb orbB" /><span className="authGrid" /></div>
    <BrandScene variant="auth" tone="client" />
    <div className="authLayout">
      <BrandMark3D className="authMark" hosted />
      <div className="authCard bp-card">
        <img className="authLogo" src="/portal/bioptime-lockup-horizontal-on-dark.svg" alt="Bioptime" />
        <span className="bp-eyebrow bp-eyebrow-accent">Members</span>
        <h1>Activate your account</h1>
        {!token && <Alert kind="info" title="Activation link needed">Open the activation link from your email again; it keeps working until it expires.</Alert>}
        {token && preview.error && (code === 'TOKEN_USED' ? <Alert kind="error" title="This link was already used">{preview.error} <a href="/login/client">Sign in</a>.</Alert>
          : code === 'TOKEN_INVALID' || FINAL.includes(code) ? <Alert kind="error" title="This link cannot be used">{preview.error} <a href="/contact">Contact Bioptime</a>.</Alert>
          : <Alert kind="error" title="The invitation could not be checked">{preview.error} <Button size="sm" variant="tertiary" onClick={() => preview.reload()}>Try again</Button></Alert>)}
        {token && !preview.error && !p && <Skeleton rows={3} />}
        {p && <>
          <p className="small authLead">Invitation for <b>{p.email}</b>, valid until {new Date(p.expiresAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}. Set a password and accept the policies; setup continues inside.</p>
          <form className="form" onSubmit={submit} noValidate>
            <Field label="Your name"><Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required /></Field>
            <Field label="Password" hint="At least 10 characters."><Input type="password" autoComplete="new-password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
            <label className="bp-check"><input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} /> I accept the <a href="/terms" target="_blank" rel="noopener">terms of use</a> and the <a href="/privacy" target="_blank" rel="noopener">privacy notice</a> (version 2026-10-17)</label>
            <label className="bp-check"><input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} /> Bioptime news by email, occasionally and never with health detail</label>
            {err && <Alert kind="error">{err}</Alert>}
            <Button variant="primary" size="lg" busy={busy} type="submit">Activate and continue</Button>
          </form>
        </>}
      </div>
    </div>
    <p className="authFoot small">Bioptime offers general wellbeing guidance and coaching, not medical advice. <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/contact">Support</a></p>
  </div>;
}
