import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Link } from '../lib/nav';
import { api } from '../lib/api';
import { actionLabel, fmtDate, fmtDateTime, label, relative } from '../lib/format';
import { Alert, Button, Card, CardHead, Dialog, Empty, Field, Input, Pill, ReasonDialog, Skeleton, Table, useApi, useToast, errorText } from '../ui';

export function Coaches() {
  const list = useApi(() => api.get('/admin/coaches'), []);
  const [invite, setInvite] = useState(false);
  const toast = useToast();
  const d = list.data as any;
  return <div className="stack">
    <div className="pageHead"><div><h1>Coaches</h1><p className="sub">Invite, scope and capacity. A coach account exists only through an invitation; the link works once and expires in 7 days.</p></div><div className="actions"><Button variant="primary" onClick={() => setInvite(true)}>Invite a coach</Button></div></div>
    {list.error && <Alert kind="error">{list.error}</Alert>}
    {!d ? <Skeleton rows={4} /> : <>
      <Card dense><Table head={<><th>Coach</th><th>Expertise</th><th>City</th><th className="num">Caseload</th><th>Availability</th><th>Account</th></>}>{d.items.map((c: any) => <tr key={c.id}><td><Link to={`/coaches/${c.id}`}>{c.displayName}</Link>{c.coachCode && <> <code className="idCode">{c.coachCode}</code></>}<div className="muted">{c.email}</div></td><td className="small">{c.expertise.join(', ')}</td><td>{c.city ?? '—'}</td><td className="num">{c.caseload}/{c.caseloadLimit}</td><td><Pill status={c.available ? 'available' : 'paused'}>{c.available ? 'Available' : `Away${c.unavailableUntil ? ' until ' + fmtDate(String(c.unavailableUntil).slice(0, 10)) : ''}`}</Pill></td><td><Pill status={c.state} /></td></tr>)}</Table></Card>
      {d.invitations?.length ? <Card><CardHead eyebrow="Pending" title="Invitations" /><Table head={<><th>Email</th><th>Status</th><th>Expires</th><th>Sent</th></>}>{d.invitations.map((i: any) => <tr key={i.id}><td>{i.email}</td><td><Pill status={i.status} /></td><td>{fmtDateTime(i.expires_at)}</td><td>{relative(i.created_at)}</td></tr>)}</Table></Card> : null}
    </>}
    <InviteDialog open={invite} onClose={() => setInvite(false)} onDone={(r) => { toast(r.token ? 'Invitation created; the activation link is shown' : 'Invitation queued'); list.reload(); }} />
  </div>;
}

function InviteDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (r: any) => void }) {
  const [email, setEmail] = useState(''); const [name, setName] = useState(''); const [expertise, setExpertise] = useState(''); const [city, setCity] = useState(''); const [limit, setLimit] = useState('20');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [result, setResult] = useState<any>(null);
  const go = async () => { setBusy(true); setErr(''); try { const r = await api.post('/admin/coaches/invite', { email, displayName: name, expertise: expertise.split(',').map((s) => s.trim()).filter(Boolean), city: city || undefined, caseloadLimit: Number(limit) }); setResult(r); onDone(r); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); } };
  return <Dialog open={open} onClose={() => { setResult(null); onClose(); }} title="Invite a coach" footer={result ? <Button variant="primary" onClick={() => { setResult(null); onClose(); }}>Done</Button> : <><Button variant="tertiary" onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={go}>Send invitation</Button></>}>
    {result ? <Alert kind="success" title="Invitation created">{result.note}{result.token && <div className="small" style={{ marginTop: 8 }}>Activation link: <code>/login/coach/activate?token={result.token}</code></div>}</Alert> : <div className="form"><Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field><Field label="Display name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field><Field label="Expertise (comma separated)"><Input value={expertise} onChange={(e) => setExpertise(e.target.value)} /></Field><div className="row"><Field label="City" optional><Input value={city} onChange={(e) => setCity(e.target.value)} /></Field><Field label="Caseload limit"><Input type="number" min={0} value={limit} onChange={(e) => setLimit(e.target.value)} /></Field></div>{err && <Alert kind="error">{err}</Alert>}<p className="muted">The coach sets their own password from the link; nobody is told it.</p></div>}
  </Dialog>;
}

export function CoachDetail() {
  const { id = '' } = useParams();
  const d = useApi(() => api.get(`/admin/coaches/${id}`), [id]);
  const toast = useToast();
  const [away, setAway] = useState(false);
  const [until, setUntil] = useState('');
  const [limitDlg, setLimitDlg] = useState(false);
  const [limit, setLimit] = useState('');
  const [suspend, setSuspend] = useState(false);
  const [back, setBack] = useState(false);
  const [reinstate, setReinstate] = useState(false);
  const [deactivate, setDeactivate] = useState(false);
  const c = (d.data as any)?.coach;
  if (d.error) return <Alert kind="error">{d.error}</Alert>;
  if (!c) return <Skeleton rows={6} />;
  const dd = d.data as any;
  return <div className="stack">
    <div className="pageHead"><div><Link className="muted" to="/coaches">← Coaches</Link><h1 style={{ marginTop: 4 }}>{c.displayName} {c.coachCode && <code className="idCode" title="Coach ID: the coach signs in with it or with their email">{c.coachCode}</code>}</h1><p className="sub">{c.expertise.join(', ')} · {c.languages.join(', ')} · {c.city ?? ''} · caseload {c.caseload}/{c.caseloadLimit}</p></div><div className="actions"><Pill status={c.state} /><Pill status={c.available ? 'available' : 'paused'}>{c.available ? 'Available' : 'Away'}</Pill>{c.available ? <Button size="sm" onClick={() => setAway(true)}>Mark away</Button> : <Button size="sm" onClick={() => setBack(true)}>Mark available</Button>}<Button size="sm" onClick={() => { setLimit(String(c.caseloadLimit)); setLimitDlg(true); }}>Capacity</Button>{c.state === 'active' ? <Button size="sm" variant="destructive" onClick={() => setSuspend(true)}>Suspend</Button> : <Button size="sm" onClick={() => setReinstate(true)}>Reinstate</Button>}{(c.state === 'active' || c.state === 'suspended') && <Button size="sm" variant="destructive" onClick={() => setDeactivate(true)}>Deactivate</Button>}</div></div>
    <ReasonDialog open={back} onClose={() => setBack(false)} title={`Mark ${c.displayName} as available?`} confirmLabel="Mark available" body="The assignments the away mark paused resume and those members are told their coach is back. Assignments paused under Assignments, or by a suspended or deactivated account, stay paused." onConfirm={async (reason) => { await api.post(`/admin/coaches/${id}/availability`, { available: true, reason }); toast('Coach available; assignments paused by the away mark resumed'); d.reload(); }} />
    <ReasonDialog open={reinstate} onClose={() => setReinstate(false)} title={`Reinstate ${c.displayName}?`} confirmLabel="Reinstate" body="The coach can sign in again with their Coach ID or email and finds their records as they were. Assignments paused when the account was suspended or deactivated resume and those members are told their coach is back; if the coach is marked away, they resume when the coach is marked available. Assignments paused under Assignments stay paused." onConfirm={async (reason) => { const r: any = await api.patch(`/admin/coaches/${id}/state`, { state: 'active', reason }); const n = r?.assignments; toast(n?.resumed ? `Coach reinstated; ${n.resumed} assignment${n.resumed === 1 ? '' : 's'} resumed` : n?.waitingForReturn ? `Coach reinstated; ${n.waitingForReturn} assignment${n.waitingForReturn === 1 ? '' : 's'} resume when the coach is marked available` : 'Coach reinstated'); d.reload(); }} />
    <ReasonDialog open={deactivate} onClose={() => setDeactivate(false)} title={`Deactivate ${c.displayName}?`} danger confirmLabel="Deactivate coach" body="This is how a coach is removed. They are signed out everywhere and can no longer sign in. Nothing is deleted: their profile, notes, plans, programmes and history are kept, and their members pause until you reassign them under Assignments or reinstate the coach. You can reinstate the coach later; the change and your reason go in the audit log." onConfirm={async (reason) => { await api.patch(`/admin/coaches/${id}/state`, { state: 'deactivated', reason }); toast('Coach deactivated; their records are kept'); d.reload(); }} />
    <div className="grid">
      <div className="span6"><Card><CardHead eyebrow="Assignments" title={`${dd.assignments.filter((a: any) => a.status === 'active').length} active`} />{dd.assignments.length ? <Table head={<><th>Member</th><th>Status</th><th>Method</th><th>Since</th><th>Reason</th></>}>{dd.assignments.map((a: any) => <tr key={a.id}><td><Link to={`/clients/${a.member_id}`}>{a.member_name}</Link></td><td><Pill status={a.status} /></td><td>{a.method}</td><td>{fmtDate(a.effective_at)}</td><td className="small">{a.reason}</td></tr>)}</Table> : <Empty title="No assignments" />}</Card></div>
      <div className="span6"><Card><CardHead eyebrow="Availability" title="Working hours and blocks" />{dd.rules.length ? <Table head={<><th>Day</th><th>Window (IST)</th><th>Slot</th></>}>{dd.rules.map((r: any) => <tr key={r.id}><td>{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][r.weekday]}</td><td>{mm(r.start_minute)}–{mm(r.end_minute)}</td><td>{r.slot_minutes} min</td></tr>)}</Table> : <p className="small">No working hours set; the coach sets them in Settings.</p>}{dd.blocks.length ? <ul className="timeline" style={{ marginTop: 12 }}>{dd.blocks.map((b: any) => <li key={b.id}><b>Blocked</b> {fmtDateTime(b.start_at)} → {fmtDateTime(b.end_at)} {b.reason ? `· ${b.reason}` : ''}</li>)}</ul> : null}<p className="small" style={{ marginTop: 10 }}>{c.bio}</p></Card></div>
      <div className="span12"><Card><CardHead eyebrow="Audit" title="History" /><ul className="timeline">{dd.audit.map((a: any) => <li key={a.id} className="done"><b>{actionLabel(a.action)}</b>{a.reason ? ` · ${a.reason}` : ''}<time>{a.actor_name ?? a.actor_role} · {relative(a.at)}</time></li>)}</ul></Card></div>
    </div>
    <ReasonDialog open={away} onClose={() => setAway(false)} title={`Mark ${c.displayName} as away?`} confirmLabel="Mark away" body="Their active assignments pause; members are told their plan and bookings stay and messages wait for the coach. Reassign members who need someone sooner. New assignments skip them." extra={<Field label="Until (optional)"><Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></Field>} onConfirm={async (reason) => { await api.post(`/admin/coaches/${id}/availability`, { available: false, unavailableUntil: until || undefined, reason }); toast('Coach marked away'); d.reload(); }} />
    <ReasonDialog open={limitDlg} onClose={() => setLimitDlg(false)} title="Change the caseload limit" confirmLabel="Save" extra={<Field label="Maximum active clients"><Input type="number" min={0} value={limit} onChange={(e) => setLimit(e.target.value)} /></Field>} onConfirm={async (reason) => { await api.patch(`/admin/coaches/${id}`, { caseloadLimit: Number(limit), reason }); toast('Capacity updated'); d.reload(); }} />
    <ReasonDialog open={suspend} onClose={() => setSuspend(false)} title={`Suspend ${c.displayName}?`} danger confirmLabel="Suspend coach" body="The coach is signed out, loses access to the workspace, and their members pause until you reinstate the coach (which resumes them, unless the coach is away) or reassign them under Assignments." onConfirm={async (reason) => { await api.patch(`/admin/coaches/${id}/state`, { state: 'suspended', reason }); toast('Coach suspended'); d.reload(); }} />
  </div>;
}
function mm(m: number): string { return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
