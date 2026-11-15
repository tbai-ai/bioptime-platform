import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiRequestError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDate, fmtDateTime, label, relative } from '../../lib/format';
import { Alert, Button, Card, CardHead, ConfirmDialog, Field, Input, Pill, Select, Skeleton, Table, Tabs, Textarea, useApi, useToast, errorText } from '../../ui';
import { Link } from '../../lib/nav';
import { useFeatures } from '../../modules/runtime';
import { minuteToClock, quietHoursBody, savedQuietHours, zoneName } from './quietHours';

type Tab = 'profile' | 'privacy' | 'notifications' | 'security' | 'data';

/** Profile: details, privacy and sharing (consents), notifications, security (password, sessions) and data rights. */
export function Profile() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'profile';
  const setTab = (t: Tab) => { params.set('tab', t); setParams(params, { replace: true }); };
  return <div className="stack">
    <div className="pageHead"><div><h1>Profile</h1><p className="sub">Who you are, what you share and with whom, how we reach you, and your data rights.</p></div></div>
    <Tabs items={[{ id: 'profile', label: 'Details' }, { id: 'privacy', label: 'Privacy and sharing' }, { id: 'notifications', label: 'Notifications' }, { id: 'security', label: 'Security' }, { id: 'data', label: 'Your data' }]} value={tab} onChange={setTab}>
    {tab === 'profile' && <Details />}
    {tab === 'privacy' && <Consents />}
    {tab === 'notifications' && <Notifications />}
    {tab === 'security' && <Security />}
    {tab === 'data' && <DataRights />}
    </Tabs>
  </div>;
}

const GOALS = ['Energy and sleep', 'Strength', 'Fat loss', 'Endurance', 'Longevity', 'Stress', 'Mobility', 'Habits'];

function Details() {
  const { refresh } = useAuth();
  const p = useApi(() => api.get('/me/profile'), []);
  const toast = useToast();
  const [f, setF] = useState<any>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const features = useFeatures(true);
  const phoneSignIn = !!features?.has('phone_sign_in');
  const saved = p.data as { phone?: string | null; phoneVerified?: boolean } | null;
  useEffect(() => { const d = p.data as any; if (d && !f) setF({ name: d.name ?? '', phone: d.phone ?? '', gender: d.profile?.gender ?? '', city: d.profile?.city ?? '', state: d.profile?.state ?? '', pincode: d.profile?.pincode ?? '', address: d.profile?.address ?? '', dateOfBirth: d.profile?.dateOfBirth ?? '', goals: d.profile?.goals ?? [] }); }, [p.data, f]);
  if (p.error) return <Alert kind="error">{p.error}</Alert>;
  if (!f) return <Skeleton rows={6} />;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErrs({});
    const body: Record<string, unknown> = { goals: f.goals };
    for (const k of ['name', 'phone', 'gender', 'city', 'state', 'pincode', 'address', 'dateOfBirth']) if (String(f[k]).trim()) body[k] = String(f[k]).trim();
    try { await api.patch('/me/profile', body); await refresh(); toast('Saved'); p.reload(); }
    catch (ex) { if (ex instanceof ApiRequestError) { const d = ex.details as any; const issues: any[] = Array.isArray(d) ? d : Array.isArray(d?.issues) ? d.issues : []; const fe: Record<string, string> = {}; for (const i of issues) { const k = (Array.isArray(i.path) ? String(i.path[0] ?? '') : String(i.path ?? '')).split('.')[0]; if (k && !fe[k]) fe[k] = i.message; } if (issues.length) setErrs(fe); } toast(errorText(ex), 'error'); } finally { setBusy(false); }
  };
  return <div className="grid"><div className="span8"><Card><CardHead eyebrow="Details" title="About you" /><p className="small">Your coach sees your name, member ID, age, gender, goals, programme and plan, and your city and state unless Bioptime switches those off. Never your phone, email, address, PIN code or date of birth. Your address is used for home collections.</p>
    <form className="form" onSubmit={save} style={{ marginTop: 12 }}>
      <div className="row"><Field label="Name" error={errs.name}><Input value={f.name} onChange={set('name')} /></Field><Field label="Phone" hint="With the country code." error={errs.phone}><Input value={f.phone} onChange={set('phone')} inputMode="tel" /></Field></div>
      <div className="row"><Field label="Date of birth" hint="The laboratory needs it, with your gender, to book a collection." error={errs.dateOfBirth}><Input type="date" value={f.dateOfBirth} onChange={set('dateOfBirth')} /></Field><Field label="Gender" error={errs.gender}><Select value={f.gender} onChange={set('gender')}><option value="">Not set</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option><option value="prefer_not_to_say">Prefer not to say</option></Select></Field></div>
      <Field label="Address" error={errs.address}><Textarea value={f.address} onChange={set('address')} /></Field>
      <div className="row"><Field label="City" error={errs.city}><Input value={f.city} onChange={set('city')} /></Field><Field label="State" error={errs.state}><Input value={f.state} onChange={set('state')} /></Field><Field label="PIN code" error={errs.pincode}><Input inputMode="numeric" maxLength={6} value={f.pincode} onChange={set('pincode')} /></Field></div>
      <div><span className="bp-label">Goals</span><div className="pillRow" style={{ marginTop: 6 }}>{GOALS.map((g) => <button key={g} type="button" className="bp-chip" aria-pressed={f.goals.includes(g)} onClick={() => setF({ ...f, goals: f.goals.includes(g) ? f.goals.filter((x: string) => x !== g) : [...f.goals, g] })}>{g}</button>)}</div></div>
      <div><Button variant="primary" type="submit" busy={busy}>Save</Button></div>
    </form></Card></div>
    {phoneSignIn && saved?.phone && <div className="span4"><PhoneConfirm phone={saved.phone} verified={!!saved.phoneVerified} unsaved={f.phone.trim() !== saved.phone} onChange={p.reload} /></div>}</div>;
}

type ConfirmStart = { sentTo: string; expiresInMinutes: number; delivered: boolean; message: string };

/** Confirming the number saved on the profile, so it can be used to sign in with a phone code: offered while the switch
 *  phone_sign_in is on (GET /public/config features) and the saved number is not confirmed. POST /auth/phone/confirm/start
 *  sends a code to it and answers how it travels; while texts go to the outbox (delivered: false) no code arrives, so the
 *  card shows the server's message and asks for no code. With a delivered code, POST /auth/phone/confirm { code }.
 *  Changing the number on the profile clears the confirmation (api/domain/members.ts). RATE_LIMITED shows the server's own
 *  message: it tells apart the number's 15-minute and daily limits (api/auth/phoneSignIn.ts checkPhoneLimit) and the
 *  route's limit (api/http/app.ts). */
function PhoneConfirm({ phone, verified, unsaved, onChange }: { phone: string; verified: boolean; unsaved: boolean; onChange: () => void }) {
  const toast = useToast();
  const [sent, setSent] = useState<ConfirmStart | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<'start' | 'confirm' | null>(null);
  useEffect(() => { setSent(null); setCode(''); setErr(''); }, [phone, verified]);
  const failed = (ex: unknown) => {
    if (ex instanceof ApiRequestError && ex.code === 'INVALID_STATE' && (ex.details as { code?: string } | undefined)?.code === 'PHONE_ALREADY_CONFIRMED') { toast('This number is already confirmed'); onChange(); return; }
    if (ex instanceof ApiRequestError && ex.code === 'PHONE_CODE_INVALID') setCode('');
    if (ex instanceof ApiRequestError && (ex.code === 'PHONE_MISSING' || ex.code === 'PHONE_IN_USE')) setSent(null);
    setErr(ex instanceof ApiRequestError && ex.code === 'FEATURE_DISABLED' ? 'Confirming a number is switched off for now.' : errorText(ex));
  };
  const start = async () => {
    setBusy('start'); setErr('');
    try { setSent(await api.post<ConfirmStart>('/auth/phone/confirm/start', {})); setCode(''); }
    catch (ex) { failed(ex); } finally { setBusy(null); }
  };
  const confirm = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy('confirm'); setErr('');
    try { await api.post('/auth/phone/confirm', { code: code.trim() }); toast('Number confirmed'); onChange(); }
    catch (ex) { failed(ex); } finally { setBusy(null); }
  };
  return <Card><CardHead eyebrow="Phone sign-in" title="Your mobile number" right={<Pill status={verified ? 'active' : 'pending'}>{verified ? 'Confirmed' : 'Not confirmed'}</Pill>} />
    {verified ? <p className="small">{phone} is confirmed. You can sign in with a phone code for it on the member sign-in page.</p> : <>
      <p className="small">Confirm {phone} to sign in with a six-digit code for it instead of your password.</p>
      {unsaved && <p className="muted small">Save your details first: the number confirmed is the one saved on your profile.</p>}
      {sent && <div style={{ marginTop: 12 }}><Alert kind="info">{sent.message}</Alert></div>}
      {sent?.delivered && <form className="form" onSubmit={confirm} noValidate style={{ marginTop: 12 }}>
        <Field label="Six-digit code" hint={`Sent to ${sent.sentTo}. It works once, for ${sent.expiresInMinutes} minutes; five wrong tries end it.`}><Input inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} required /></Field>
        <div><Button variant="primary" size="sm" type="submit" busy={busy === 'confirm'} disabled={code.length !== 6 || busy !== null}>Confirm</Button></div>
      </form>}
      {err && <div style={{ marginTop: 12 }}><Alert kind="error">{err}</Alert></div>}
      {/* no second request while texts go to the outbox: the answer already says no code will arrive */}
      {(!sent || sent.delivered) && <div className="bp-card-foot"><Button size="sm" busy={busy === 'start'} disabled={unsaved || busy !== null} onClick={() => void start()}>{sent ? 'Send a new code' : 'Confirm this number'}</Button></div>}
    </>}
  </Card>;
}

const KINDS: Array<{ kind: string; title: string; body: string; locked?: boolean }> = [
  { kind: 'health_data', title: 'Process my health information', body: 'Goals, measurements and blood test results, to run your programme. While it is withdrawn, new blood test bookings in the portal and app wait until you give it again; what your coach can see follows the separate "My coach may see my health information" choice; nothing already recorded is deleted.' },
  { kind: 'coach_sharing', title: 'My coach may see my health information', body: 'Off: your coach still sees your name, member ID, age, gender, goals, programme and plan (and city and state unless Bioptime switches those off), the tasks a coach set for you and whether you did them (such as any habits, workouts, check-ins or courses a coach assigned), any live sessions you sign up for, and what you send them in Messages, including any files. They can message you and arrange appointments. Private while it is off: your measurements, progress log, wellness score and blood tests, and, if you use them, your progress photos, goal values, check-in answers, next steps from blood tests, diet profile, meal logs and photos, workout logs, the habits you add yourself, habit notes, and courses a coach did not assign. A coach never sees your phone number, email, address, PIN code or date of birth.' },
  { kind: 'lab_consent', title: 'Share my details with the partner laboratory', body: 'Your name, phone, email, gender, date of birth and collection address, only for collections you book. Bookings already with the laboratory still complete.' },
  { kind: 'marketing', title: 'Bioptime news by email', body: 'Occasional, and never with health detail.' },
  { kind: 'terms', title: 'Terms of use', body: 'Accepted when the account was created.', locked: true },
  { kind: 'privacy', title: 'Privacy policy', body: 'Accepted when the account was created.', locked: true },
];

function Consents() {
  const c = useApi(() => api.get('/me/consents'), []);
  const config = useApi(() => api.get('/public/config'), []);
  const toast = useToast();
  const [confirm, setConfirm] = useState<{ kind: string; title: string } | null>(null);
  const set = async (kind: string, granted: boolean) => { try { await api.post('/me/consents', { kind, version: `web-${(config.data as any)?.privacyVersion ?? '2026-10-17'}`, granted }); c.reload(); toast(granted ? 'Consent recorded' : 'Consent withdrawn'); } catch (e) { toast(errorText(e), 'error'); } };
  if (c.error) return <Alert kind="error">{c.error}</Alert>;
  if (!c.data) return <Skeleton rows={6} />;
  const d = c.data as any;
  // the Coach AI consent is given and withdrawn on its own page (it needs the current wording); while one is on record
  // it is named here with a link, which works even while Coach AI is switched off (modules/ai/module.tsx, whileOff)
  const ai = d.ai_processing as { granted: boolean; version: string; at: string } | undefined;
  return <div className="grid"><div className="span8"><Card><CardHead eyebrow="Privacy and sharing" title="Your choices" /><p className="small">Each choice is recorded with its date and the policy version. Change any of them here.</p>
    <div className="stack" style={{ marginTop: 12 }}>{KINDS.map((k) => { const cur = d[k.kind]; return <div key={k.kind} className="row between" style={{ alignItems: 'flex-start' }}><div style={{ flex: '1 1 320px' }}><b style={{ color: 'var(--bp-color-text-primary)' }}>{k.title}</b><div className="small">{k.body}</div><div className="muted small">{cur ? `${cur.granted ? 'Granted' : 'Withdrawn'} ${fmtDate(cur.at)} · version ${cur.version}` : 'Not set'}</div></div>
      <label className="bp-switch"><input type="checkbox" role="switch" checked={!!cur?.granted} disabled={k.locked} onChange={(e) => { if (!e.target.checked && (k.kind === 'health_data' || k.kind === 'lab_consent')) setConfirm({ kind: k.kind, title: k.title }); else void set(k.kind, e.target.checked); }} aria-label={k.title} /><span className="bp-switch-track" /></label></div>; })}
      {ai?.granted && <p className="small" style={{ margin: 0 }}>Coach AI drafts: given {fmtDate(ai.at)} (version {ai.version}). Review or withdraw it on <Link to="/coach-ai">Coach AI and your data</Link>.</p>}</div>
    <p className="muted small" style={{ marginTop: 14 }}>Under the Digital Personal Data Protection Act, 2023 you can see, correct, download and erase your data, and raise a grievance. Downloads and deletion are under Your data; anything else, write to privacy@bioptime.com.</p></Card></div>
    <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} title={`Withdraw "${confirm?.title}"?`} danger confirmLabel="Withdraw" body={confirm?.kind === 'health_data' ? 'New blood test bookings in the portal and app wait until you give it again. What your coach can see does not change with this; it follows the separate "My coach may see my health information" choice. Nothing already recorded is deleted.' : 'You cannot book new collections until it is granted again. Bookings already with the laboratory still complete.'} onConfirm={async () => { if (confirm) await set(confirm.kind, false); }} /></div>;
}

function Notifications() {
  const n = useApi(() => api.get('/notifications?limit=50'), []);
  const prefs = useApi(() => api.get('/notification-preferences'), []);
  const toast = useToast();
  const readAll = async () => { try { await api.post('/notifications/read', { all: true }); n.reload(); } catch (e) { toast(errorText(e), 'error'); } };
  const setPref = async (key: string, value: boolean) => { try { await api.patch('/notification-preferences', { [key]: value }); prefs.reload(); } catch (e) { toast(errorText(e), 'error'); } };
  const p = prefs.data as any;
  const items = ((n.data as any)?.items ?? []) as any[];
  return <div className="grid">
    <div className="span7"><Card><CardHead eyebrow="In the portal" title="Notifications" right={items.some((x) => !x.read_at) ? <Button size="sm" variant="tertiary" onClick={readAll}>Mark all read</Button> : undefined} />{n.error && <Alert kind="error">{n.error}</Alert>}{!n.data ? <Skeleton /> : items.length ? <div className="notifList">{items.map((x) => <div key={x.id} className={`notif ${x.read_at ? 'read' : ''}`}><span className="dot" /><div><b>{x.title}</b>{x.body}<div className="muted small">{label(x.category)}</div></div><time className="muted">{relative(x.created_at)}</time></div>)}</div> : <p className="small">Nothing yet.</p>}</Card></div>
    <div className="span5"><Card><CardHead eyebrow="Channels" title="How we reach you" /><p className="small">Security messages (password resets and changes) are always sent. Health details never appear in a notification; the portal shows them. Notifications reach you here and by email; push, SMS and lock-screen detail are not available yet.</p>
      {p && <div className="stack" style={{ marginTop: 12 }}>{(['email', 'reminders', 'marketing'] as const).map((k) => <div key={k} className="row between"><span>{label(k)}</span><label className="bp-switch"><input type="checkbox" role="switch" checked={!!p[k]} onChange={(e) => setPref(k, e.target.checked)} aria-label={label(k)} /><span className="bp-switch-track" /></label></div>)}</div>}</Card>
      {p && <QuietHours prefs={p} onSaved={prefs.reload} />}</div>
  </div>;
}

/** Quiet hours (PUT /notification-preferences/quiet-hours). They hold back only what the reminder queue sends
 *  (api/domain/reminders.ts dispatchDue): inside the window such a reminder is written as an in-portal notification and
 *  nothing else goes out for it, then or later. Notifications sent directly, consultation reminders included, are not
 *  affected. */
function QuietHours({ prefs, onSaved }: { prefs: any; onSaved: () => void }) {
  const profile = useApi(() => api.get('/me/profile'), []);
  const toast = useToast();
  const saved = savedQuietHours(prefs);
  const [start, setStart] = useState(minuteToClock(saved?.start));
  const [end, setEnd] = useState(minuteToClock(saved?.end));
  const [busy, setBusy] = useState<'save' | 'clear' | null>(null);
  useEffect(() => { setStart(minuteToClock(saved?.start)); setEnd(minuteToClock(saved?.end)); }, [saved?.start, saved?.end]);
  const body = quietHoursBody(start, end);
  const same = !!start && start === end;
  const put = async (which: 'save' | 'clear', b: { startMinute: number | null; endMinute: number | null }) => {
    setBusy(which);
    try { await api.put('/notification-preferences/quiet-hours', b); toast(which === 'save' ? 'Quiet hours saved' : 'Quiet hours cleared'); onSaved(); }
    catch (e) { toast(errorText(e), 'error'); } finally { setBusy(null); }
  };
  const zone = zoneName((profile.data as any)?.profile?.timezone);
  return <Card style={{ marginTop: 14 }}><CardHead eyebrow="Reminders" title="Quiet hours" right={<Pill status={saved ? 'active' : null}>{saved ? `${minuteToClock(saved.start)} to ${minuteToClock(saved.end)}` : 'Off'}</Pill>} />
    <p className="small">Habit, check-in, blood test preparation and live session reminders that fall due inside your quiet hours appear only here in the portal and in the app, with no email, and are not sent again afterwards. Everything else arrives as usual, including consultation reminders, messages from your coach, results and security messages.</p>
    {!prefs.reminders && <p className="muted small" style={{ marginTop: 8 }}>Reminders is switched off above, so those reminders are not sent at all for now.</p>}
    <div className="form" style={{ marginTop: 12 }}>
      <div className="row"><Field label="From" error={same ? 'Choose an end that differs from the start.' : undefined}><Input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field><Field label="Until"><Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Field></div>
      <p className="muted small" style={{ margin: 0 }}>Times are {zone}. A window can run past midnight, for example 22:00 until 07:00.</p>
      <div className="row"><Button variant="primary" size="sm" busy={busy === 'save'} disabled={!body || busy !== null} onClick={() => { if (body) void put('save', body); }}>Save quiet hours</Button>{saved && <Button variant="tertiary" size="sm" busy={busy === 'clear'} disabled={busy !== null} onClick={() => void put('clear', { startMinute: null, endMinute: null })}>Turn off</Button>}</div>
    </div>
  </Card>;
}

function Security() {
  const { user } = useAuth();
  const toast = useToast();
  const [cur, setCur] = useState(''); const [next, setNext] = useState(''); const [busy, setBusy] = useState(false);
  const sessions = useApi(() => api.get('/auth/sessions'), []);
  const change = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); try { await api.post('/auth/password/change', { currentPassword: cur, newPassword: next }); setCur(''); setNext(''); toast('Password changed; other sessions signed out'); sessions.reload(); } catch (ex) { toast(errorText(ex), 'error'); } finally { setBusy(false); } };
  const end = async (id: string) => { try { await api.del(`/auth/sessions/${id}`); toast('Session ended'); sessions.reload(); } catch (ex) { toast(errorText(ex), 'error'); } };
  const currentId = (sessions.data as any)?.current; const items = (((sessions.data as any)?.items ?? []) as any[]).map((s) => ({ ...s, current: s.id === currentId }));
  return <div className="grid">
    <div className="span5"><Card><CardHead eyebrow="Security" title="Password" right={<Pill status={user?.emailVerified === false ? 'pending' : 'active'}>{user?.emailVerified === false ? 'Email unconfirmed' : 'Email confirmed'}</Pill>} />
      <form className="form" onSubmit={change}><Field label="Current password"><Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required /></Field><Field label="New password" hint="At least 10 characters. Other sessions are signed out."><Input type="password" autoComplete="new-password" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} required /></Field><div><Button variant="primary" type="submit" busy={busy}>Change password</Button></div></form></Card></div>
    <div className="span7"><Card><CardHead eyebrow="Devices" title="Active sessions" />{!sessions.data ? <Skeleton /> : <Table head={<><th>Device</th><th>Signed in</th><th>Last seen</th><th /></>}>{items.map((s) => <tr key={s.id}><td>{label(s.kind)} · {(s.user_agent ?? 'unknown device').slice(0, 60)}{s.current ? <span className="bp-pill bp-pill-success" style={{ marginLeft: 6 }}>this one</span> : null}</td><td>{fmtDateTime(s.createdAt ?? s.created_at)}</td><td>{relative(s.lastSeenAt ?? s.last_seen_at)}</td><td className="num">{!s.current && <Button size="sm" variant="tertiary" onClick={() => end(s.id)}>Sign out</Button>}</td></tr>)}</Table>}<p className="muted small" style={{ marginTop: 10 }}>Each session ends by itself a set time after sign-in. If you see a device you do not recognise, sign it out and change your password.</p></Card></div>
  </div>;
}

/** Your data. With the support module on, an export request is generated as a file once the team approves it and is
 *  downloaded under Help and support › Your data export (modules/support/HelpCentre.tsx; api/domain/dataExport.ts).
 *  With it off, the request only reaches the team's queue: nothing generates or delivers a file in the portal.
 *  A deletion request (api/domain/members.ts requestData) opens a task in the team's queue and marks the account
 *  deletion_requested, which blocks purchases. Nothing is removed automatically and no email is sent about it. The portal
 *  shows neither the request nor the account state (the app shows the state on its Me tab). */
function DataRights() {
  const { refresh } = useAuth();
  const toast = useToast();
  const features = useFeatures(true);
  const exportsHere = !!features?.has('support');
  const [confirm, setConfirm] = useState<'export' | 'deletion' | null>(null);
  const done = (kind: 'export' | 'deletion') => (kind === 'deletion' ? 'Request recorded. It is in the Bioptime team’s queue.' : exportsHere ? 'Request recorded. A notification tells you when your copy is ready.' : 'Request recorded. It is in the Bioptime team’s queue.');
  const request = async (kind: 'export' | 'deletion', note?: string) => { try { await api.post('/me/data-requests', { kind, note: note || undefined }); await refresh(); toast(done(kind)); } catch (e) { toast(errorText(e), 'error'); } };
  const exportBody = !features ? null : exportsHere
    ? <>Once the Bioptime team approves your request, they are prepared as one file and a notification tells you it is ready. You download it under <Link to="/help?tab=export">Help and support › Your data export</Link>, where only you can open it.</>
    : <>Asking records your request and puts it in the Bioptime team’s queue; the team prepares the copy. There is no download for it in the portal yet. Questions about your request: privacy@bioptime.com.</>;
  return <div className="grid">
    <div className="span6"><Card><CardHead eyebrow="Download" title="A copy of your data" /><p className="small">Your profile, goals, bookings, reports, progress and messages.{exportBody && <> {exportBody}</>}</p><div className="bp-card-foot"><Button onClick={() => setConfirm('export')}>Request my data</Button></div></Card></div>
    <div className="span6"><Card><CardHead eyebrow="Delete" title="Close your account" /><p className="small">Asking puts your request in the Bioptime team’s queue. Nothing is removed until the team acts on it, and the portal does not show its progress: questions to privacy@bioptime.com. Deletion takes effect after any bookings in progress complete. Payment and order records are kept for the period the law requires, without your name. You cannot make purchases while the request is open.</p><div className="bp-card-foot"><Button variant="destructive" onClick={() => setConfirm('deletion')}>Request deletion</Button></div></Card></div>
    <p className="muted small">Questions about privacy: privacy@bioptime.com. We acknowledge grievances within 48 hours.</p>
    <ConfirmDialog note="Anything the team should know" open={!!confirm} onClose={() => setConfirm(null)} title={confirm === 'export' ? 'Request a copy of your data?' : 'Request account deletion?'} danger={confirm === 'deletion'} confirmLabel={confirm === 'export' ? 'Request' : 'Request deletion'} body={confirm === 'export' ? (exportsHere ? 'Once the Bioptime team approves it, the file is prepared and a notification tells you it is ready to download under Help and support › Your data export.' : 'Your request goes to the Bioptime team’s queue, and the team prepares the copy. There is no download for it in the portal yet.') : 'Your request goes to the Bioptime team’s queue, and nothing is removed until the team acts on it. You cannot make purchases while it is open. Records we must keep by law stay, without your name.'} onConfirm={async (reason) => { if (confirm) await request(confirm, reason); }} />
  </div>;
}
