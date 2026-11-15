/* Web onboarding, the same five steps the app and the old account page send: profile, goals, programme info,
   how it works, consents. The last step activates the account. Health-data consent is required: Bioptime cannot run
   a programme without it; the other consents are the member's choice and can be changed later under Profile. */
import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useNavigate } from '../../lib/nav';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { todayIst } from '../../lib/format';
import { Alert, Button, Card, CardHead, Field, Input, Skeleton, useApi, errorText } from '../../ui';

const GOALS = ['Energy and sleep', 'Strength', 'Fat loss', 'Endurance', 'Longevity', 'Stress', 'Mobility', 'Habits'];

export function Welcome() {
  const { user, refresh } = useAuth();
  const nav = useNavigate();
  const me = useApi(() => api.get('/me'), []);
  const config = useApi(() => api.get('/public/config'), []);
  const [city, setCity] = useState('');
  const [dob, setDob] = useState('');
  const [goals, setGoals] = useState<string[]>([]);
  const [health, setHealth] = useState(false);
  const [coach, setCoach] = useState(true);
  const [lab, setLab] = useState(true);
  const [marketing, setMarketing] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const d = me.data as any;
  useEffect(() => { if (d?.member?.city && !city) setCity(d.member.city); }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  if (me.error) return <Alert kind="error">{me.error}</Alert>;
  if (!d) return <Skeleton rows={6} />;
  if (d.member?.onboardingCompleted) return <Navigate to="/client" replace />;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!health) { setErr('Bioptime cannot run a programme without processing health information.'); return; }
    if (dob) { const [y, m, d] = dob.split('-').map(Number); const [ty, tm, td] = todayIst().split('-').map(Number); const age = ty! - y! - (tm! < m! || (tm === m && td! < d!) ? 1 : 0); if (!(age >= 18)) { setErr('You must be 18 or over to use Bioptime.'); return; } }
    setBusy(true);
    const profile: Record<string, string> = {}; if (city.trim()) profile.city = city.trim(); if (dob) profile.dateOfBirth = dob;
    const version = `web-${(config.data as any)?.privacyVersion ?? '2026-10-17'}`;
    const steps: Array<[string, Record<string, unknown>]> = [['profile', profile], ['goals', { goals }], ['programme_info', { seen: true }], ['how_it_works', { seen: true }], ['consents', { healthData: true, coachSharing: coach, labConsent: lab, marketing, version }], ['done', {}]];
    try { for (const [step, data] of steps) await api.post('/me/onboarding', { step, data }); await refresh(); nav('/', { replace: true }); }
    catch (ex) { setErr(errorText(ex)); } finally { setBusy(false); }
  };
  return <div className="stack">
    <div className="pageHead"><div><h1>Welcome, {(d.member?.name || user?.name || '').split(' ')[0]}.</h1><p className="sub">A few details, your goals and your choices about health data. It takes a minute, and everything here can be changed later under Profile.</p></div></div>
    {d.member?.state === 'pending_verification' && <Alert kind="warning" title="Confirm your email first">Use the link in the email we sent. Setup continues once the address is confirmed.</Alert>}
    <form onSubmit={submit} className="grid">
      <div className="span6"><Card><CardHead eyebrow="1" title="About you" /><div className="form">
        <Field label="City" optional hint="Your coach sees it unless Bioptime switches it off; the laboratory uses your full address only when you book."><Input value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" maxLength={80} /></Field>
        <Field label="Date of birth" optional hint="Needed before a blood test can be booked. You must be 18 or over."><Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} autoComplete="bday" /></Field>
        <div><span className="bp-label">Goals <span className="muted">pick any</span></span><div className="pillRow" style={{ marginTop: 6 }}>{GOALS.map((g) => <button key={g} type="button" className="bp-chip" aria-pressed={goals.includes(g)} onClick={() => setGoals((s) => (s.includes(g) ? s.filter((x) => x !== g) : [...s, g]))}>{g}</button>)}</div></div>
      </div></Card></div>
      <div className="span6"><Card><CardHead eyebrow="2" title="How Bioptime works" /><ul className="small" style={{ paddingLeft: 18, display: 'grid', gap: 6 }}>
        <li>A package pairs you with a coach for a set number of months and includes blood tests at home and consultations.</li>
        <li>Your coach publishes a plan; you tick tasks off here or in the app and log what you measure.</li>
        <li>Blood test reports are reviewed with plain-language notes before they reach you: by your coach while health sharing is on, otherwise by the Bioptime team.</li>
        <li>Bioptime is wellbeing guidance and coaching, not medical advice. A result outside a range is not a diagnosis.</li>
      </ul></Card></div>
      <div className="span12"><Card><CardHead eyebrow="3" title="Your choices about health data" /><div className="form">
        <label className="bp-check"><input type="checkbox" checked={health} onChange={(e) => setHealth(e.target.checked)} required /> I agree to Bioptime processing my health information (goals, measurements, blood test results) to run my programme. <b>Required.</b></label>
        <label className="bp-check"><input type="checkbox" checked={coach} onChange={(e) => setCoach(e.target.checked)} /> My coach may see my health information and blood test reports.</label>
        <label className="bp-check"><input type="checkbox" checked={lab} onChange={(e) => setLab(e.target.checked)} /> Bioptime may share my name, phone, email, gender, date of birth and collection address with the partner laboratory to collect samples I book.</label>
        <label className="bp-check"><input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} /> Bioptime news by email, occasionally and never with health detail.</label>
        <p className="muted small">Each choice is recorded with its date and the policy version. Terms and the privacy notice were accepted when the account was created.</p>
        {err && <Alert kind="error">{err}</Alert>}
        <div><Button variant="primary" size="lg" type="submit" busy={busy} disabled={d.member?.state === 'pending_verification' && !d.demo}>Save and finish setup</Button></div>
      </div></Card></div>
    </form>
  </div>;
}
