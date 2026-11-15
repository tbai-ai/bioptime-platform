/* Users and permissions: administrators and owners, their effective permissions, per-permission overrides with a
   reason, and role changes (owner only). The module permissions (GET /admin/users marks them module: true, with a
   short heading) have their own matrix below the workspace one, in the same table pattern. The server refuses the dangerous moves: removing your own permission to manage
   permissions, demoting the last owner, changing your own role. Public registration never reaches this list.
   Two-factor authentication is mandatory for administrators and owners and cannot be turned off by its holder; an owner
   resets another account's (POST /admin/users/:id/mfa/reset, with a reason), which makes them set it up again at their
   next sign-in. */
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDateTime, label } from '../../lib/format';
import { Alert, Button, Card, CardHead, Dialog, Field, Pill, Select, Skeleton, Table, Textarea, useApi, useToast, errorText } from '../../ui';

type Perm = { key: string; label: string; module?: boolean; heading?: string };
/** Short column headings for the workspace permissions (the rotated headers have room for about 17 characters); the full
    wording stays in each header's tooltip, each cell's label and the reference card below. A heading the API sends wins. */
const CORE_HEADINGS: Record<string, string> = {
  'members.view_restricted': 'Restricted fields', 'entitlements.adjust': 'Entitlements', 'custom_plans.approve': 'Approve bespoke', 'content.publish': 'Publish content',
  'labstack.manage': 'LabStack', 'members.manage': 'Members', 'coaches.manage': 'Coaches', 'assignments.manage': 'Assignments', 'packages.manage': 'Packages',
  'custom_plans.manage': 'Review bespoke', 'orders.manage': 'Orders', 'content.manage': 'Edit content', 'theme.manage': 'Theme', 'settings.manage': 'Settings',
  'integrations.manage': 'Integrations', 'reports.view': 'Reports', 'audit.view': 'Audit log', 'operations.manage': 'Operations', 'growth.manage': 'Growth',
  'permissions.manage': 'Permissions', 'admins.manage': 'Administrators',
};
type Admin = { id: string; email: string; name: string; role: 'admin' | 'owner'; state: string; mfaEnabled: boolean; permissions: string[]; overrides: Array<{ permission: string; granted: number | boolean; reason: string | null; updated_at: string }> };

/** One permission cell: held or not, outlined when it is an explicit override; owners cannot be narrowed. */
function PermCell({ u, p, onToggle }: { u: Admin; p: Perm; onToggle: (u: Admin, p: Perm, granted: boolean) => void }) {
  const has = u.role === 'owner' || u.permissions.includes(p.key);
  const ov = u.overrides.find((o) => o.permission === p.key);
  return <td className="permCell"><button type="button" className={`permBtn ${has ? 'on' : ''} ${ov ? 'ov' : ''}`} disabled={u.role === 'owner'} aria-pressed={has} aria-label={`${p.label}: ${has ? 'held' : 'not held'}`} title={ov ? `${ov.granted ? 'Granted' : 'Revoked'} explicitly: ${ov.reason ?? ''} (${fmtDateTime(ov.updated_at)})` : has ? 'From the default set' : 'Not held'} onClick={() => onToggle(u, p, !has)}>{has ? '✓' : '–'}</button></td>;
}

export function Users() {
  const { user } = useAuth();
  const list = useApi(() => api.get<{ permissions: Perm[]; items: Admin[] }>('/admin/users'), []);
  const toast = useToast();
  const [pending, setPending] = useState<{ u: Admin; permission: Perm; granted: boolean } | null>(null);
  const [role, setRole] = useState<{ u: Admin; to: 'admin' | 'owner' } | null>(null);
  const [mfaReset, setMfaReset] = useState<Admin | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  if (list.error) return <Alert kind="error">{list.error}</Alert>;
  if (!list.data) return <Skeleton rows={8} />;
  const { permissions: all, items } = list.data;
  // the workspace permissions keep their matrix; the module permissions (libraries, courses, live sessions,
  // announcements, imports, Coach AI usage, module switches) get their own, with short headings
  const permissions = all.filter((p) => !p.module);
  const modulePerms = all.filter((p) => p.module);
  const toggle = (u: Admin, p: Perm, granted: boolean) => { setReason(''); setPending({ u, permission: p, granted }); };
  const apply = async () => {
    if (!pending) return;
    setBusy(true);
    try { await api.post(`/admin/users/${pending.u.id}/permissions`, { permission: pending.permission.key, granted: pending.granted, reason }); toast(`${pending.granted ? 'Granted' : 'Revoked'} ${pending.permission.label} for ${pending.u.name}`); setPending(null); setReason(''); list.reload(); }
    catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); }
  };
  const changeRole = async () => {
    if (!role) return;
    setBusy(true);
    try { await api.post(`/admin/users/${role.u.id}/role`, { role: role.to, reason }); toast(`${role.u.name} is now ${role.to}`); setRole(null); setReason(''); list.reload(); }
    catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); }
  };
  const resetMfa = async () => {
    if (!mfaReset) return;
    setBusy(true);
    try { await api.post(`/admin/users/${mfaReset.id}/mfa/reset`, { reason }); toast(`Two-factor reset for ${mfaReset.name}: they set it up again at their next sign-in`); setMfaReset(null); setReason(''); list.reload(); }
    catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); }
  };
  return <div className="stack">
    <div className="pageHead"><div><h1>Users and permissions</h1><p className="sub">Who can do what in this workspace. Owners hold every permission; administrators hold a default set that can be widened or narrowed one permission at a time, each change with a reason in the audit log.</p></div></div>
    <Alert kind="info" title="Safeguards">You cannot remove your own permission to manage permissions, demote the last owner, or change your own role. Members and coaches never appear here: public registration creates members only, coaches come from invitations.</Alert>
    <Card dense><div className="tableWrap"><Table head={<><th>Account</th><th>Role</th><th>MFA</th>{permissions.map((p) => <th key={p.key} className="permHead" title={`${p.label} (${p.key})`}><span>{p.heading ?? CORE_HEADINGS[p.key] ?? p.label}</span></th>)}<th /></>}>
      {items.map((u) => <tr key={u.id} className={u.id === user?.id ? 'me' : ''}>
        <td><b>{u.name}</b>{u.id === user?.id && <span className="muted"> (you)</span>}<div className="muted small">{u.email}</div></td>
        <td><Pill status={u.role === 'owner' ? 'active' : 'draft'}>{u.role}</Pill> <Pill status={u.state} /></td>
        <td>{u.mfaEnabled ? <Pill status="active">on</Pill> : <Pill status="pending">off</Pill>}</td>
        {permissions.map((p) => <PermCell key={p.key} u={u} p={p} onToggle={toggle} />)}
        <td className="num">{user?.role === 'owner' && u.id !== user.id && <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}><Button size="sm" variant="tertiary" onClick={() => { setReason(''); setRole({ u, to: u.role === 'owner' ? 'admin' : 'owner' }); }}>{u.role === 'owner' ? 'Make administrator' : 'Make owner'}</Button>{u.mfaEnabled && <Button size="sm" variant="tertiary" onClick={() => { setReason(''); setMfaReset(u); }}>Reset two-factor</Button>}</div>}</td>
      </tr>)}
    </Table></div><p className="muted small" style={{ marginTop: 10 }}>✓ held · – not held · an outlined cell is an explicit override. Owners cannot be narrowed; make them an administrator first.</p></Card>
    {modulePerms.length > 0 && <Card dense><CardHead eyebrow="Modules" title="Module permissions" />
      <p className="small">Permissions for the modules: libraries, courses, live sessions, announcements, bulk imports, Coach AI usage and the module switches. Administrators hold the first four by default; bulk imports, Coach AI usage and the module switches have to be granted to each administrator.</p>
      <div className="tableWrap" style={{ marginTop: 10 }}><Table head={<><th>Account</th>{modulePerms.map((p) => <th key={p.key} className="permHead" title={`${p.label} (${p.key})`}><span>{p.heading ?? p.label}</span></th>)}</>}>
        {items.map((u) => <tr key={u.id} className={u.id === user?.id ? 'me' : ''}>
          <td><b>{u.name}</b>{u.id === user?.id && <span className="muted"> (you)</span>}<div className="muted small">{u.role === 'owner' ? 'Owner' : 'Administrator'}</div></td>
          {modulePerms.map((p) => <PermCell key={p.key} u={u} p={p} onToggle={toggle} />)}
        </tr>)}
      </Table></div></Card>}
    <Card><CardHead eyebrow="Reference" title="What each permission allows" /><dl className="kv">{all.map((p) => <React.Fragment key={p.key}><dt><code>{p.key}</code></dt><dd>{p.label}{p.module && <span className="muted"> (module)</span>}</dd></React.Fragment>)}</dl></Card>
    <Dialog open={!!pending} onClose={() => setPending(null)} danger={!!pending && !pending.granted} title={pending ? `${pending.granted ? 'Grant' : 'Revoke'} "${pending.permission.label}" for ${pending.u.name}?` : ''} footer={<><Button variant="tertiary" onClick={() => setPending(null)}>Cancel</Button><Button variant={pending?.granted ? 'primary' : 'destructive'} busy={busy} disabled={reason.trim().length < 3} onClick={apply}>{pending?.granted ? 'Grant' : 'Revoke'}</Button></>}>
      <p className="small">Takes effect on their next request. {pending && !pending.granted && pending.u.id === user?.id && pending.permission.key === 'permissions.manage' ? 'The server refuses this one: you would lock yourself out.' : ''}</p>
      <div style={{ marginTop: 12 }}><Field label="Reason (recorded in the audit log)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>
    </Dialog>
    <Dialog open={!!role} onClose={() => setRole(null)} danger={role?.to === 'admin'} title={role ? `Make ${role.u.name} ${role.to === 'owner' ? 'an owner' : 'an administrator'}?` : ''} footer={<><Button variant="tertiary" onClick={() => setRole(null)}>Cancel</Button><Button variant={role?.to === 'admin' ? 'destructive' : 'primary'} busy={busy} disabled={reason.trim().length < 3} onClick={changeRole}>Change role</Button></>}>
      <p className="small">{role?.to === 'owner' ? 'Owners hold every permission, including managing other administrators, and cannot be narrowed.' : 'They keep the administrator default set plus any explicit overrides. The platform always keeps at least one owner.'}</p>
      <div style={{ marginTop: 12 }}><Field label="Reason (recorded in the audit log)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>
    </Dialog>
    <Dialog open={!!mfaReset} onClose={() => setMfaReset(null)} danger title={mfaReset ? `Reset two-factor authentication for ${mfaReset.name}?` : ''} footer={<><Button variant="tertiary" onClick={() => setMfaReset(null)}>Cancel</Button><Button variant="destructive" busy={busy} disabled={reason.trim().length < 3} onClick={resetMfa}>Reset two-factor</Button></>}>
      <p className="small">For a lost or replaced authenticator. Their current authenticator stops working for Bioptime, they are signed out everywhere and get an email saying so; at their next sign-in they enter the password and set up two-factor authentication again before they can do anything. Confirm who is asking before you do this.</p>
      <div style={{ marginTop: 12 }}><Field label="Reason (recorded in the audit log)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>
    </Dialog>
    <Card><CardHead eyebrow="Roles" title="The five kinds of account" /><Table head={<><th>Role</th><th>Signs in at</th><th>Can</th></>}>
      {[['member', '/login/client', 'Their own programme, bookings, reports, messages, profile and data rights'], ['coach', '/login/coach', 'Assigned clients only: plans, reviews, consultations, messages, their own availability'], ['admin', '/login/admin', 'The permissions above, MFA required'], ['owner', '/login/admin', 'Everything, including permissions and other administrators; MFA required']].map(([r, at, can]) => <tr key={r}><td><b>{label(r)}</b></td><td><code>{at}</code></td><td className="small">{can}</td></tr>)}
    </Table><p className="muted small" style={{ marginTop: 8 }}><Select style={{ display: 'none' }} /> Workspaces are separated at the server: a member's credentials are refused at the coach and admin sign-ins, and so on.</p></Card>
  </div>;
}
