/* The administrator's member list. The coach's list is pages/coach/CoachClients.tsx (no contact details); this page is
   routed only under /admin behind members.manage and shows email because administrators hold it. */
import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Link, useNavigate } from '../lib/nav';
import { api, qs } from '../lib/api';
import { fmtDate } from '../lib/format';
import { Alert, Button, Card, Dialog, Empty, Field, Input, Pill, Select, Skeleton, Table, useApi, useToast, errorText } from '../ui';

export function Clients() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [state, setState] = useState('');
  const nav = useNavigate();
  const [invite, setInvite] = useState(false);
  const toast = useToast();
  const list = useApi(() => api.get(`/admin/members${qs({ q, state })}`), [q, state]);
  const items = ((list.data as any)?.items ?? []) as any[];
  return <div className="stack">
    <div className="pageHead"><div><h1>Members</h1><p className="sub">Everyone with a member account; open one for orders, entitlements, assignments and history.</p></div>
      <div className="actions"><Input type="search" placeholder="Search name or email" aria-label="Search members" defaultValue={q} onKeyDown={(e) => { if (e.key === 'Enter') setParams({ q: (e.target as HTMLInputElement).value }); }} />
        <Button variant="primary" size="sm" onClick={() => setInvite(true)}>Invite a member</Button>
        <Select value={state} aria-label="Account state" onChange={(e) => setState(e.target.value)}><option value="">Any state</option>{['pending_verification', 'onboarding', 'active', 'suspended', 'deactivated', 'deletion_requested'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</Select></div></div>
    {list.error && <Alert kind="error">{list.error}</Alert>}
    <InviteMemberDialog open={invite} onClose={() => setInvite(false)} onDone={() => { toast('Invitation created'); list.reload(); }} />
    {list.loading && !list.data ? <Skeleton rows={5} /> : items.length ? <Card dense><Table label="Members" head={<><th>Member</th><th>Package</th><th>Coach</th><th>State</th><th>Joined</th><th>Goals</th></>}>
      {items.map((m) => <tr key={m.id} className="link" onClick={() => nav(`/clients/${m.id}`)}><td><Link to={`/clients/${m.id}`} onClick={(e) => e.stopPropagation()}>{m.name}</Link><div className="muted">{m.email}</div></td><td>{m.package_name ?? '—'}{m.programme_end_at ? <div className="muted">ends {fmtDate(m.programme_end_at)}</div> : null}</td><td>{m.coach_name ?? <span className="muted">Unassigned</span>}{m.assignment_status === 'paused' ? <div className="muted">paused</div> : null}</td><td><Pill status={m.state ?? m.assignment_status} /></td><td>{fmtDate(m.created_at ?? m.effective_at)}</td><td className="small">{(m.goals ?? []).join(', ')}</td></tr>)}
    </Table></Card> : <Card><Empty title="No members match" body={q || state ? 'Try another name, email or state.' : 'Members appear here once they register or accept an invitation.'} /></Card>}
  </div>;
}

function InviteMemberDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState(''); const [name, setName] = useState(''); const [reason, setReason] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [result, setResult] = useState<any>(null);
  const go = async () => { setBusy(true); setErr(''); try { const r = await api.post('/admin/members/invite', { email, name, reason: reason || undefined }); setResult(r); onDone(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); } };
  const close = () => { setResult(null); setEmail(''); setName(''); setReason(''); onClose(); };
  return <Dialog open={open} onClose={close} title="Invite a member" footer={result ? <Button variant="primary" onClick={close}>Done</Button> : <><Button variant="tertiary" onClick={close}>Cancel</Button><Button variant="primary" busy={busy} disabled={!email || name.trim().length < 2} onClick={go}>Send the invitation</Button></>}>
    {result ? <Alert kind="success" title="Invitation created">{result.note}{result.token && <div className="small" style={{ marginTop: 8 }}>Activation link: <code>/login/client/activate?token={result.token}</code></div>}</Alert>
      : <div className="form"><Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field><Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field><Field label="Reason" optional hint="Recorded in the audit log."><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>{err && <Alert kind="error">{err}</Alert>}<p className="muted">The member sets their own password from the link (72 hours, one use) and accepts the policies; nobody is told it. Public registration on the website still works for everyone else.</p></div>}
  </Dialog>;
}
