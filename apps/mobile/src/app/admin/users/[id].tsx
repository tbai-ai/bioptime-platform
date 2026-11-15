/* Admin › Users and permissions › one administrator (the web's matrix row, pages/admin/Users.tsx; permissions.manage).
   Every permission as a row: held or not, with how it came to be (from the default set, granted or revoked explicitly
   with the reason and time). Toggling one asks for a reason (POST /admin/users/:id/permissions); owners cannot be
   narrowed (their rows are read-only, as the web disables their cells). Role changes are owner-only
   (POST /admin/users/:id/role, admins.manage); the server refuses SELF_ROLE, LAST_OWNER, SELF_LOCKOUT in its own words.
   Pills take the portal's colours (lib/admin/b2/pill); nothing is requested without permissions.manage. */
import { Stack, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { errorText, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { gated, pillTone, useAllowed } from '@/lib/admin/b2/pill';
import { heading, holds, LEGEND, MODULE_PERMISSIONS_TEXT, overrideOf, permissionOrigin, type Admin, type Perm, type UsersPayload } from '@/lib/admin/b2/users';
import { ReasonSheet, useToast } from '@/components/adminB2/parts';
import { Button, Card, Check, ErrorBox, Eyebrow, H2, Loading, Notice, P, Pill, Row, StaleBanner } from '@/components/ui';
import { NotificationBell, RequirePermission, RoleGate, WorkspaceScreen } from '@/components/workspaceShell';
import { Enter, MotionCard } from '@/motion';
import { space } from '@/theme';

function PermissionRow({ u, p, onToggle }: { u: Admin; p: Perm; onToggle: (p: Perm, granted: boolean) => void }) {
  const has = holds(u, p);
  const ov = overrideOf(u, p);
  const hint = `${permissionOrigin(u, p)}${ov ? ' · explicit override' : ''}`;
  if (u.role === 'owner') return <Row between style={{ paddingVertical: space.sm }}><View style={{ flex: 1 }}><P>{p.label}</P><P muted small>{heading(p)}</P></View><Pill tone={pillTone('active')}>✓ held</Pill></Row>;
  return <Check checked={has} onChange={(v) => onToggle(p, v)} label={`${p.label}`} hint={hint} />;
}

/* Administrators and owners only: anyone else sees the workspace notice, and nothing here asks the API. */
export default function AdminUserPermissions() {
  return <RoleGate workspace="admin"><AdminUserPermissionsScreen /></RoleGate>;
}

function AdminUserPermissionsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const allowed = useAllowed('permissions.manage');
  const list = useLoad<UsersPayload | null>(allowed ? `admin-users-${id}` : null, gated(allowed, () => get<UsersPayload>('/admin/users')), [id, allowed]);
  const [toast, showToast] = useToast();
  const [pending, setPending] = useState<{ permission: Perm; granted: boolean } | null>(null);
  const [role, setRole] = useState<'admin' | 'owner' | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const d = list.data;
  const u = d?.items.find((x) => x.id === id) ?? null;
  const all = d?.permissions ?? [];
  const core = all.filter((p) => !p.module);
  const modulePerms = all.filter((p) => p.module);
  const toggle = (p: Perm, granted: boolean) => { setErr(null); setPending({ permission: p, granted }); };
  const apply = async (reason: string) => {
    if (!pending || !u) return;
    setBusy(true); setErr(null);
    try { await post(`/admin/users/${u.id}/permissions`, { permission: pending.permission.key, granted: pending.granted, reason }); showToast(`${pending.granted ? 'Granted' : 'Revoked'} ${pending.permission.label} for ${u.name}`); setPending(null); void list.reload(); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const changeRole = async (reason: string) => {
    if (!role || !u) return;
    setBusy(true); setErr(null);
    try { await post(`/admin/users/${u.id}/role`, { role, reason }); showToast(`${u.name} is now ${role}`); setRole(null); void list.reload(); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const selfLockout = !!pending && !pending.granted && u?.id === user?.id && pending.permission.key === 'permissions.manage';
  return <WorkspaceScreen workspace="admin" title={u ? `${u.name}${u.id === user?.id ? ' (you)' : ''}` : 'Permissions'} sub={u ? `${u.email} · ${u.role === 'owner' ? 'Owner' : 'Administrator'}` : undefined} refreshing={list.loading} onRefresh={list.reload}>
    <Stack.Screen options={{ title: 'Permissions', headerRight: () => <NotificationBell /> }} />
    <RequirePermission permission="permissions.manage">
      {toast}
      <StaleBanner at={list.stale} /><ErrorBox error={list.error} onRetry={list.reload} />
      {list.loading && !d ? <Loading /> : d && !u ? <Notice kind="warning" title="Administrator was not found">This account is not an administrator or owner, or it no longer exists.</Notice> : u ? <>
        <Enter index={1}><View style={{ gap: space.sm }}>
          <Row><Pill tone={pillTone(u.role === 'owner' ? 'active' : 'draft')}>{u.role}</Pill><Pill tone={pillTone(u.state)}>{label(u.state)}</Pill><Pill tone={pillTone(u.mfaEnabled ? 'active' : 'pending')}>{u.mfaEnabled ? 'MFA on' : 'MFA off'}</Pill></Row>
          {user?.role === 'owner' && u.id !== user.id ? <Button title={u.role === 'owner' ? 'Make administrator' : 'Make owner'} variant="secondary" small onPress={() => { setErr(null); setRole(u.role === 'owner' ? 'admin' : 'owner'); }} style={{ alignSelf: 'flex-start' }} /> : null}
          {u.role === 'owner' ? <P muted small>Owners hold every permission and cannot be narrowed; make them an administrator first.</P> : null}
        </View></Enter>
        <MotionCard index={2} pressable={false}><Card>
          <Eyebrow>Workspace</Eyebrow><H2>Permissions</H2>
          {core.map((p) => <PermissionRow key={p.key} u={u} p={p} onToggle={toggle} />)}
          <P muted small>{LEGEND}</P>
        </Card></MotionCard>
        {modulePerms.length > 0 ? <MotionCard index={3} pressable={false}><Card>
          <Eyebrow>Modules</Eyebrow><H2>Module permissions</H2>
          <P small>{MODULE_PERMISSIONS_TEXT}</P>
          {modulePerms.map((p) => <PermissionRow key={p.key} u={u} p={p} onToggle={toggle} />)}
        </Card></MotionCard> : null}
      </> : null}
      <ReasonSheet open={!!pending} onClose={() => setPending(null)} destructive={!!pending && !pending.granted} title={pending && u ? `${pending.granted ? 'Grant' : 'Revoke'} "${pending.permission.label}" for ${u.name}?` : ''} confirmLabel={pending?.granted ? 'Grant' : 'Revoke'} busy={busy} error={err} cancelLabel="Cancel" placeholder="" gate="disabled"
        body={`Takes effect on their next request.${selfLockout ? ' The server refuses this one: you would lock yourself out.' : ''}`} onConfirm={apply} />
      <ReasonSheet open={!!role} onClose={() => setRole(null)} destructive={role === 'admin'} title={role && u ? `Make ${u.name} ${role === 'owner' ? 'an owner' : 'an administrator'}?` : ''} confirmLabel="Change role" busy={busy} error={err} cancelLabel="Cancel" placeholder="" gate="disabled"
        body={role === 'owner' ? 'Owners hold every permission, including managing other administrators, and cannot be narrowed.' : 'They keep the administrator default set plus any explicit overrides. The platform always keeps at least one owner.'} onConfirm={changeRole} />
    </RequirePermission>
  </WorkspaceScreen>;
}
