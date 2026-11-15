import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Link } from '../lib/nav';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime, label, relative } from '../lib/format';
import { Alert, Button, Card, CardHead, Field, Input, Pill, Select, Skeleton, Table, Textarea, useApi, useToast, errorText } from '../ui';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function Settings() {
  const { user, isPrivileged, refresh } = useAuth();
  return <div className="stack">
    <div className="pageHead"><div><h1>Settings</h1><p className="sub">{isPrivileged ? 'Your account and security, runtime settings, integrations and the metric catalogue.' : 'Your profile as members see it, your working hours, availability and security.'}</p></div></div>
    <div className="grid">
      <div className="span6"><Security user={user} onChange={refresh} /></div>
      <div className="span6"><Sessions /></div>
      {!isPrivileged && <><div className="span6"><CoachProfile /></div><div className="span6" id="availability" style={{ scrollMarginTop: 72 }}><Availability /></div></>}
      {isPrivileged && <><div className="span6"><Runtime /></div><div className="span6"><Features /></div><div className="span6"><Templates /></div><div className="span6"><Integrations /></div><div className="span12"><Metrics /></div></>}
    </div>
  </div>;
}

export function Security({ user, onChange }: { user: any; onChange: () => Promise<void> }) {
  const toast = useToast();
  const [cur, setCur] = useState(''); const [next, setNext] = useState('');
  const [mfa, setMfa] = useState<any>(null); const [code, setCode] = useState('');
  const change = async () => { try { await api.post('/auth/password/change', { currentPassword: cur, newPassword: next }); setCur(''); setNext(''); toast('Password changed; other sessions signed out'); } catch (e) { toast(errorText(e), 'error'); } };
  return <Card><CardHead eyebrow="Security" title="Password and MFA" right={user?.mfaEnabled ? <Pill status="active">MFA on</Pill> : <Pill status="pending">MFA off</Pill>} />
    <div className="form"><Field label="Current password"><Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field><Field label="New password" hint="At least 10 characters."><Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field><div className="row"><Button size="sm" disabled={!cur || next.length < 10} onClick={change}>Change password</Button></div></div>
    {(user?.role === 'admin' || user?.role === 'owner') && <div style={{ marginTop: 16 }}>{!user.mfaEnabled && !mfa && <Button size="sm" variant="primary" onClick={async () => { try { setMfa(await api.post('/auth/mfa/setup')); } catch (e) { toast(errorText(e), 'error'); } }}>Set up authenticator (MFA)</Button>}
      {mfa && <div className="form"><Alert kind="info" title="Add this secret to your authenticator app">Secret: <code>{mfa.secret}</code><div className="small" style={{ wordBreak: 'break-all' }}>{mfa.otpauth}</div></Alert><Field label="Code from the app"><Input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} /></Field><div className="row"><Button size="sm" variant="primary" onClick={async () => { try { await api.post('/auth/mfa/confirm', { code }); setMfa(null); toast('MFA enabled'); await onChange(); } catch (e) { toast(errorText(e), 'error'); } }}>Confirm</Button></div></div>}
      {/* two-factor authentication is mandatory for administrators and owners: it cannot be turned off here (the server
          refuses POST /auth/mfa/disable for them); another owner resets it under Users and permissions */}
      {user.mfaEnabled && <p className="muted small">Two-factor authentication is required for administrator accounts, so it cannot be turned off. If you lose your authenticator, another owner can reset it under Users and permissions; you then set it up again at your next sign-in.</p>}</div>}
  </Card>;
}

function Sessions() {
  const s = useApi(() => api.get('/auth/sessions'), []);
  const toast = useToast();
  const d = s.data as any;
  return <Card><CardHead eyebrow="Devices" title="Active sessions" />{!d ? <Skeleton /> : <Table head={<><th>Kind</th><th>Device</th><th>Last seen</th><th></th></>}>{d.items.map((x: any) => <tr key={x.id}><td>{x.kind}{x.id === d.current ? <div className="muted">this one</div> : null}</td><td className="small">{(x.user_agent ?? '').slice(0, 60)}<div className="muted">{x.ip}</div></td><td className="small">{relative(x.last_seen_at)}</td><td>{x.id !== d.current && <Button size="sm" variant="tertiary" onClick={async () => { await api.del(`/auth/sessions/${x.id}`); toast('Session signed out'); s.reload(); }}>Sign out</Button>}</td></tr>)}</Table>}</Card>;
}

export function CoachProfile() {
  const p = useApi(() => api.get('/coach/profile'), []);
  const toast = useToast();
  const [f, setF] = useState<any>(null);
  const d = p.data as any;
  // seeded from the profile when it arrives (and again after a reload), never during render
  React.useEffect(() => { if (d) setF({ displayName: d.displayName, bio: d.bio ?? '', expertise: (d.expertise ?? []).join(', '), languages: (d.languages ?? []).join(', '), city: d.city ?? '' }); }, [d]);
  if (!f) return <Card><Skeleton /></Card>;
  const save = async () => { try { await api.patch('/coach/profile', { displayName: f.displayName, bio: f.bio, expertise: f.expertise.split(',').map((s: string) => s.trim()).filter(Boolean), languages: f.languages.split(',').map((s: string) => s.trim()).filter(Boolean), city: f.city }); toast('Profile saved'); p.reload(); } catch (e) { toast(errorText(e), 'error'); } };
  return <Card><CardHead eyebrow="Profile" title="What members see" right={<span className="muted small">Designation, qualifications and scope are set by Bioptime</span>} /><div className="form"><Field label="Display name"><Input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></Field><Field label="Bio"><Textarea value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} /></Field><Field label="Expertise"><Input value={f.expertise} onChange={(e) => setF({ ...f, expertise: e.target.value })} /></Field><Field label="Languages"><Input value={f.languages} onChange={(e) => setF({ ...f, languages: e.target.value })} /></Field><Field label="City"><Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field><div className="row"><Button size="sm" variant="primary" onClick={save}>Save</Button></div><p className="muted">Qualifications and scope are set by an administrator and shown to members only once verified.</p></div></Card>;
}

export function Availability() {
  const a = useApi(() => api.get('/coach/availability'), []);
  const toast = useToast();
  const [rules, setRules] = useState<any[] | null>(null);
  const [until, setUntil] = useState(''); const [reason, setReason] = useState('');
  const [block, setBlock] = useState({ start: '', end: '', reason: '' });
  const d = a.data as any;
  React.useEffect(() => { if (d && !rules) setRules(d.rules.map((r: any) => ({ weekday: r.weekday, start: mm(r.start_minute), end: mm(r.end_minute), slot: r.slot_minutes }))); }, [d, rules]);
  // /settings#availability (the coach's "Set availability" button) lands on this card once it has loaded, below the
  // sticky top bar (the wrapper's scroll margin)
  const { hash } = useLocation();
  const loaded = !!(rules && d);
  React.useEffect(() => { if (loaded && hash === '#availability') document.getElementById('availability')?.scrollIntoView({ block: 'start' }); }, [loaded, hash]);
  if (!rules || !d) return <Card><Skeleton /></Card>;
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const save = async () => { try { await api.put('/coach/availability', { rules: rules.map((r) => ({ weekday: r.weekday, startMinute: toMin(r.start), endMinute: toMin(r.end), slotMinutes: Number(r.slot) })) }); toast('Working hours saved'); a.reload(); } catch (e) { toast(errorText(e), 'error'); } };
  const setStatus = async (available: boolean) => { if (reason.trim().length < 3) { toast('Say why first; the reason is recorded.', 'error'); return; } try { await api.post('/coach/availability/status', { available, unavailableUntil: until || undefined, reason: reason.trim() }); toast(available ? 'You are available' : 'Marked away; your assignments are paused'); a.reload(); } catch (e) { toast(errorText(e), 'error'); } };
  const addBlock = async () => { try { await api.post('/coach/availability/blocks', { startAt: new Date(block.start).toISOString(), endAt: new Date(block.end).toISOString(), reason: block.reason }); toast('Blocked'); a.reload(); } catch (e) { toast(errorText(e), 'error'); } };
  return <Card><CardHead eyebrow="Availability" title="Working hours, status, blocks" right={<Pill status={d.coach.available ? 'available' : 'paused'}>{d.coach.available ? 'Available' : 'Away'}</Pill>} />
    <div className="stack">{rules.map((r, i) => <div key={i} className="row"><Select style={{ maxWidth: 90 }} value={r.weekday} onChange={(e) => setRules(rules.map((x, k) => (k === i ? { ...x, weekday: Number(e.target.value) } : x)))}>{DAYS.map((dname, wd) => <option key={dname} value={wd}>{dname}</option>)}</Select><Input type="time" style={{ maxWidth: 120 }} value={r.start} onChange={(e) => setRules(rules.map((x, k) => (k === i ? { ...x, start: e.target.value } : x)))} /><Input type="time" style={{ maxWidth: 120 }} value={r.end} onChange={(e) => setRules(rules.map((x, k) => (k === i ? { ...x, end: e.target.value } : x)))} /><Select style={{ maxWidth: 100 }} value={r.slot} onChange={(e) => setRules(rules.map((x, k) => (k === i ? { ...x, slot: Number(e.target.value) } : x)))}>{[15, 30, 45, 60].map((m) => <option key={m} value={m}>{m} min</option>)}</Select><Button size="sm" variant="tertiary" onClick={() => setRules(rules.filter((_, k) => k !== i))}>✕</Button></div>)}<div className="row"><Button size="sm" variant="tertiary" onClick={() => setRules([...rules, { weekday: 1, start: '09:00', end: '12:00', slot: 30 }])}>Add window</Button><Button size="sm" variant="primary" onClick={save}>Save hours</Button></div></div>
    <hr className="bp-divider" />
    <div className="form"><div className="row"><Field label="Away until" optional><Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></Field><Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Leave, travel" /></Field></div><div className="row">{d.coach.available ? <Button size="sm" variant="destructive" disabled={reason.trim().length < 3} onClick={() => setStatus(false)}>Mark me away</Button> : <Button size="sm" variant="primary" disabled={reason.trim().length < 3} onClick={() => setStatus(true)}>Mark me available</Button>}</div><p className="muted">Away pauses your assignments; your members are told their plan and bookings stay and messages wait for you, and Bioptime can reassign them if needed.</p></div>
    <hr className="bp-divider" />
    <div className="form"><div className="row"><Field label="Block from"><Input type="datetime-local" value={block.start} onChange={(e) => setBlock({ ...block, start: e.target.value })} /></Field><Field label="to"><Input type="datetime-local" value={block.end} onChange={(e) => setBlock({ ...block, end: e.target.value })} /></Field><Field label="Reason" optional><Input value={block.reason} onChange={(e) => setBlock({ ...block, reason: e.target.value })} /></Field></div><div className="row"><Button size="sm" disabled={!block.start || !block.end} onClick={addBlock}>Add block</Button></div>{d.blocks.length ? <ul className="timeline">{d.blocks.map((b: any) => <li key={b.id}><b>Blocked</b> {fmtDateTime(b.start_at)} → {fmtDateTime(b.end_at)} {b.reason ? `· ${b.reason}` : ''} <Button size="sm" variant="tertiary" onClick={async () => { await api.del(`/coach/availability/blocks/${b.id}`); a.reload(); }}>Remove</Button></li>)}</ul> : null}</div>
  </Card>;
}

function Runtime() {
  const s = useApi(() => api.get('/admin/settings'), []);
  const toast = useToast();
  const [reason, setReason] = useState('');
  const d = s.data as any;
  if (!d) return <Card><Skeleton /></Card>;
  const set = async (key: string, value: unknown) => {
    if (String(value) === String(d.settings[key])) return; // nothing changed: no write, no audit row
    if (reason.trim().length < 3) { toast('Say why first: the reason is recorded with the change.', 'error'); s.reload(); return; }
    try { await api.patch('/admin/settings', { key, value, reason: reason.trim() }); toast('Setting saved'); setReason(''); s.reload(); } catch (e) { toast(errorText(e), 'error'); }
  };
  return <Card><CardHead eyebrow="Runtime" title="Policies" right={<Pill status={d.demo ? 'draft' : 'active'}>{d.demo ? 'simulated services' : d.mode}</Pill>} /><div className="form">
    <Field label="Reason for the next change (recorded, required)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this change" /></Field>
    <Field label="Assignment policy" hint="Auto assigns when one eligible coach leads clearly; manual always asks you."><Select value={d.settings.assignment_policy} onChange={(e) => set('assignment_policy', e.target.value)}><option value="manual">Manual</option><option value="auto">Auto</option></Select></Field>
    <Field label="One bloodwork entitlement means" hint="Configurable: a panel, a collection or a single test."><Select value={d.settings.entitlement_unit} onChange={(e) => set('entitlement_unit', e.target.value)}><option value="collection">One collection</option><option value="panel">One panel</option><option value="test">One test</option></Select></Field>
    <div className="row"><Field label="Cancellation cutoff (minutes before a collection)"><Input type="number" defaultValue={d.settings.cancellation_cutoff_minutes} onBlur={(e) => set('cancellation_cutoff_minutes', Number(e.target.value))} /></Field><Field label="Appointment move cutoff (minutes)"><Input type="number" defaultValue={d.settings.appointment_cutoff_minutes} onBlur={(e) => set('appointment_cutoff_minutes', Number(e.target.value))} /></Field></div>
    <Field label="Support email"><Input defaultValue={d.settings.support_email} onBlur={(e) => set('support_email', e.target.value)} /></Field>
  </div></Card>;
}

function Integrations() {
  const { can } = useAuth();
  return <Card><CardHead eyebrow="Integrations" title="Payments and messaging" /><p className="small">The Integrations page shows the payment provider and the email, SMS and push providers, and whether each is live or simulated. Secrets are never shown anywhere in the portal.</p><p className="small">The laboratory integration is managed in the LabStack section by administrators who hold the “Manage the LabStack integration” permission.{can('labstack.manage') && <> <Link to="/integrations/labstack">Open LabStack</Link>.</>}</p><div className="bp-card-foot"><Link className="bp-btn bp-btn-secondary bp-btn-sm" to="/integrations">Open Integrations</Link></div></Card>;
}

function Templates() {
  const t = useApi(() => api.get('/admin/notification-templates'), []);
  const toast = useToast();
  const [cat, setCat] = useState('');
  const [subject, setSubject] = useState(''); const [body, setBody] = useState(''); const [reason, setReason] = useState('');
  const d = t.data as any;
  React.useEffect(() => { if (d && cat) { setSubject(d.templates?.[cat]?.subject ?? ''); setBody(d.templates?.[cat]?.body ?? ''); } }, [d, cat]);
  if (!d) return <Card><Skeleton /></Card>;
  const save = async () => { try { await api.put('/admin/notification-templates', { category: cat, subject, body, reason }); toast(subject || body ? 'Template saved' : 'Template cleared; the built-in wording applies'); setReason(''); t.reload(); } catch (e) { toast(errorText(e), 'error'); } };
  return <Card><CardHead eyebrow="Notifications" title="Email wording per category" /><p className="small">Plain text with the placeholders <code>{'{{name}}'}</code>, <code>{'{{title}}'}</code> and <code>{'{{body}}'}</code>. Empty subject and body return a category to the built-in wording. Health detail never goes into a notification whatever the template says: the app shows it.</p>
    <div className="form" style={{ marginTop: 10 }}>
      <Field label="Category"><Select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Choose</option>{(d.categories as string[]).map((c) => <option key={c} value={c}>{label(c)}{d.templates?.[c] ? ' (custom)' : ''}</option>)}</Select></Field>
      {cat && <><Field label="Subject"><Input value={subject} maxLength={120} onChange={(e) => setSubject(e.target.value)} /></Field><Field label="Body"><Textarea value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} /></Field><Field label="Reason (recorded)"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field><div><Button size="sm" variant="primary" disabled={reason.trim().length < 3} onClick={save}>Save</Button></div></>}
    </div></Card>;
}

function Features() {
  const s = useApi(() => api.get('/admin/settings'), []);
  const toast = useToast();
  const [reason, setReason] = useState('');
  const d = s.data as any;
  if (!d) return <Card><Skeleton /></Card>;
  const set = async (key: string, value: unknown) => { if (reason.trim().length < 3) { toast('Say why first: the reason is recorded with the change.', 'error'); return; } try { await api.patch('/admin/settings', { key, value, reason: reason.trim() }); toast('Saved'); setReason(''); s.reload(); } catch (e) { toast(errorText(e), 'error'); } };
  return <Card><CardHead eyebrow="App settings" title="Limits" /><div className="form">
    <Field label="Reason for the next change (recorded, required)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this change" /></Field>
    <div className="row"><Field label="Reminder before a consultation (hours)"><Input type="number" min={1} max={168} defaultValue={d.settings.reminder_hours_before} onBlur={(e) => { if (Number(e.target.value) !== d.settings.reminder_hours_before) void set('reminder_hours_before', Number(e.target.value)); }} /></Field><Field label="Open consultation requests per member"><Input type="number" min={1} max={10} defaultValue={d.settings.max_open_appointments} onBlur={(e) => { if (Number(e.target.value) !== d.settings.max_open_appointments) void set('max_open_appointments', Number(e.target.value)); }} /></Field></div>
    <div><span className="bp-label">Not used by the platform yet</span><p className="muted small" style={{ marginTop: 4 }}>These settings are stored, but nothing in the platform reads them, so they have no control here: the review SLA, the feature switches (in-app messaging, bespoke plan requests, members booking consultations and tests themselves) and the notice banner switch.</p></div>
  </div></Card>;
}

function Metrics() {
  const m = useApi(() => api.get('/admin/metrics-config'), []);
  const toast = useToast();
  const items = ((m.data as any)?.items ?? []) as any[];
  return <Card><CardHead eyebrow="Progress" title="Metrics members can log" /><Table head={<><th>Metric</th><th>Unit</th><th>Range</th><th>Enabled</th></>}>{items.map((x) => <tr key={x.metric}><td>{x.label}</td><td>{x.unit}</td><td className="small">{x.min ?? '—'} to {x.max ?? '—'}</td><td><label className="bp-switch"><input type="checkbox" checked={x.enabled} onChange={async (e) => { try { await api.patch(`/admin/metrics-config/${x.metric}`, { enabled: e.target.checked }); toast('Saved'); m.reload(); } catch (err) { toast(errorText(err), 'error'); } }} /><span className="bp-switch-track" /></label></td></tr>)}</Table><p className="muted" style={{ marginTop: 8 }}>Self-reported values are never shown as laboratory measurements.</p></Card>;
}

function mm(min: number): string { return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`; }
void label;
