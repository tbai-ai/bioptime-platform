import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useNavigate } from '../lib/nav';
import { api, ApiRequestError } from '../lib/api';
import { forgetLinkToken, scrubTokenFromUrl, takeLinkToken } from '../lib/linkToken';
import { useAuth, type User } from '../lib/auth';
import { Alert, Button, Field, Input, Textarea, useApi, errorText } from '../ui';
import { BrandScene } from '../components/BrandMark3D';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TOKEN_KEY = 'bp.activation.coach';
/** Answers after which this invitation can never work again: the token is dropped from the tab's storage. */
const FINAL = ['INVITATION_INVALID', 'INVITATION_EXPIRED'];
const codeOf = (e: unknown) => (e instanceof ApiRequestError ? e.code : '');

/** Coach invitation. The token is read from the address bar once, removed from it at once and kept for this tab only
    (lib/linkToken); it travels only in request bodies (POST preview and accept) and is never logged. */
export function Invite() {
  const [params] = useSearchParams();
  const [token] = useState(() => takeLinkToken(TOKEN_KEY, params.get('token')));
  useEffect(() => { scrubTokenFromUrl(); }, []);
  const [code, setCode] = useState('');
  const preview = useApi(() => (token ? api.post('/auth/invitations/preview', { token }).catch((e: unknown) => { const c = codeOf(e); setCode(c); if (FINAL.includes(c)) forgetLinkToken(TOKEN_KEY); throw e; }) : Promise.resolve(null)), [token]);
  const { setSession } = useAuth();
  const nav = useNavigate();
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [expertise, setExpertise] = useState('');
  const [languages, setLanguages] = useState('English');
  const [city, setCity] = useState('');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [accept, setAccept] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const p = preview.data as any;
  // The invitation's seeded values fill the fields once per loaded preview (the preview object changes only when a
  // new one arrives), so a coach who clears a field is not fighting a re-seed on every render.
  useEffect(() => {
    if (!p) return;
    setName(p.displayName ?? '');
    if (p.expertise?.length) setExpertise(p.expertise.join(', '));
    if (p.languages?.length) setLanguages(p.languages.join(', '));
    if (p.city) setCity(p.city);
  }, [p]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accept) { setErr('Accept the coaching policies to continue.'); return; }
    setBusy(true); setErr('');
    const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    try {
      // blank fields are left out so the administrator's seeded values stay; scope is never set from here
      const list = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean);
      const profile: Record<string, unknown> = { displayName: name, timezone: 'Asia/Kolkata' };
      if (bio.trim()) profile.bio = bio.trim();
      if (list(expertise).length) profile.expertise = list(expertise);
      if (list(languages).length) profile.languages = list(languages);
      if (city.trim()) profile.city = city.trim();
      const r = await api.post<{ user: User }>('/auth/invitations/accept', { token, password, acceptPolicies: true, policiesVersion: '2026-10-17', profile, availability: days.map((weekday) => ({ weekday, startMinute: toMin(start), endMinute: toMin(end), slotMinutes: 30 })) });
      forgetLinkToken(TOKEN_KEY);
      setSession(r.user);
      nav('/coach', { replace: true });
    } catch (ex) { if (FINAL.includes(codeOf(ex))) forgetLinkToken(TOKEN_KEY); setErr(errorText(ex)); } finally { setBusy(false); }
  };

  return <div className="auth auth-coach"><BrandScene variant="auth" tone="coach" /><div className="bp-card card" style={{ width: 'min(560px, 100%)' }}>
    <img src="/portal/bioptime-lockup-horizontal-on-dark.svg" alt="Bioptime" />
    <h1 style={{ fontSize: 22, marginBottom: 6 }}>Activate your coach workspace</h1>
    {!token && <Alert kind="info" title="Invitation link needed">Open the invitation link from your email again; it keeps working until it expires.</Alert>}
    {token && preview.error && (FINAL.includes(code) ? <Alert kind="error" title="This invitation cannot be used">{preview.error}</Alert>
      : <Alert kind="error" title="The invitation could not be checked">{preview.error} <Button size="sm" variant="tertiary" onClick={() => preview.reload()}>Try again</Button></Alert>)}
    {p && <>
      <p className="small" style={{ marginBottom: 16 }}>Invitation for <b>{p.email}</b>, valid until {new Date(p.expiresAt).toLocaleDateString('en-IN')}. Set a password, confirm your profile and your working hours.</p>
      <form className="form" onSubmit={submit}>
        <Field label="Password" hint="At least 10 characters."><Input type="password" autoComplete="new-password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        <Field label="Display name"><Input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
        <Field label="Short bio (members see this)" optional><Textarea value={bio} onChange={(e) => setBio(e.target.value)} /></Field>
        <Field label="Expertise (comma separated)" hint="e.g. strength, sleep, bloodwork, longevity"><Input value={expertise} onChange={(e) => setExpertise(e.target.value)} /></Field>
        <Field label="Languages (comma separated)"><Input value={languages} onChange={(e) => setLanguages(e.target.value)} /></Field>
        <Field label="City" optional><Input value={city} onChange={(e) => setCity(e.target.value)} /></Field>
        <div><span className="bp-label">Working days</span><div className="pillRow" style={{ marginTop: 6 }}>{DAYS.map((d, i) => <button key={d} type="button" className="bp-chip" aria-pressed={days.includes(i)} onClick={() => setDays((s) => s.includes(i) ? s.filter((x) => x !== i) : [...s, i].sort())}>{d}</button>)}</div></div>
        <div className="row"><Field label="From"><Input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field><Field label="To"><Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Field></div>
        <label className="bp-check"><input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} /> I accept the coaching policies, the terms and the privacy notice (version 2026-10-17)</label>
        {err && <Alert kind="error">{err}</Alert>}
        <Button variant="primary" size="lg" busy={busy} type="submit">Activate and open my workspace</Button>
      </form>
    </>}
  </div></div>;
}
