/* Admin › Users and permissions (the web's /admin/users, pages/admin/Users.tsx; permissions.manage). The web's matrix
   as a phone list: one row per administrator or owner (role, state, MFA, how many permissions held) opening their
   permissions (src/app/admin/users/[id].tsx, where each one is granted or revoked with a reason, and where an owner
   changes another account's role: the web's "Make owner" / "Make administrator" at the end of the row); then the web's
   reference cards. The server refuses the dangerous moves (SELF_LOCKOUT, LAST_OWNER, SELF_ROLE) in its own words.
   Pills take the portal's colours (an owner 'active', an administrator 'draft', the state as its status, MFA on 'active'
   and off 'pending'); nothing is requested without permissions.manage. */
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useRef } from 'react';
import { View } from 'react-native';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { gated, pillTone, useAllowed } from '@/lib/admin/b2/pill';
import { heading, holds, MODULE_PERMISSIONS_TEXT, ROLE_ROWS, SAFEGUARDS, WORKSPACES_NOTE, type UsersPayload } from '@/lib/admin/b2/users';
import { MonoText } from '@/components/adminB2/parts';
import { Card, ErrorBox, Eyebrow, H2, Loading, Notice, P, StaleBanner } from '@/components/ui';
import { KeyValue, RecordList, RecordRow } from '@/components/workspace';
import { NotificationBell, RequirePermission, RoleGate, WorkspaceScreen } from '@/components/workspaceShell';
import { Enter, MotionCard } from '@/motion';
import { space } from '@/theme';

/* Administrators and owners only: anyone else sees the workspace notice, and nothing here asks the API. */
export default function AdminUsers() {
  return <RoleGate workspace="admin"><AdminUsersScreen /></RoleGate>;
}

function AdminUsersScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const allowed = useAllowed('permissions.manage');
  const list = useLoad<UsersPayload | null>(allowed ? 'admin-users' : null, gated(allowed, () => get<UsersPayload>('/admin/users')), [allowed]);
  const first = useRef(true);
  useFocusEffect(useCallback(() => { if (first.current) { first.current = false; return; } if (allowed) void list.reload(); }, [list.reload, allowed])); // eslint-disable-line react-hooks/exhaustive-deps
  const d = list.data;
  const all = d?.permissions ?? [];
  const modulePerms = all.filter((p) => p.module);
  return <WorkspaceScreen workspace="admin" title="Users and permissions" sub="Who can do what in this workspace. Owners hold every permission; administrators hold a default set that can be widened or narrowed one permission at a time, each change with a reason in the audit log." refreshing={list.loading} onRefresh={list.reload}>
    <Stack.Screen options={{ title: 'Users and permissions', headerRight: () => <NotificationBell /> }} />
    <RequirePermission permission="permissions.manage">
      <Enter index={1}><Notice kind="info" title="Safeguards">{SAFEGUARDS}</Notice></Enter>
      <StaleBanner at={list.stale} /><ErrorBox error={list.error} onRetry={list.reload} />
      {list.loading && !d ? <Loading /> : d ? <>
        <Enter index={2}><RecordList>
          {d.items.map((u) => {
            const held = u.role === 'owner' ? all.length : u.permissions.length;
            return <RecordRow key={u.id} title={`${u.name}${u.id === user?.id ? ' (you)' : ''}`} meta={`${u.email} · ${held} of ${all.length} permissions · ${u.overrides.length ? `${u.overrides.length} explicit ${u.overrides.length === 1 ? 'override' : 'overrides'}` : 'no overrides'}`}
              pills={[{ label: u.role, tone: pillTone(u.role === 'owner' ? 'active' : 'draft') }, { label: label(u.state), tone: pillTone(u.state) }, { label: u.mfaEnabled ? 'MFA on' : 'MFA off', tone: pillTone(u.mfaEnabled ? 'active' : 'pending') }]}
              onPress={() => router.push(`/admin/users/${u.id}` as never)} />;
          })}
        </RecordList></Enter>
        {modulePerms.length > 0 ? <MotionCard index={5} pressable={false}><Card>
          <Eyebrow>Modules</Eyebrow><H2>Module permissions</H2>
          <P small>{MODULE_PERMISSIONS_TEXT}</P>
          {/* the web's module matrix, one line per account: the module permissions it holds (– for none) */}
          <KeyValue rows={d.items.map((u) => { const held = modulePerms.filter((p) => holds(u, p)); return { label: `${u.name}${u.id === user?.id ? ' (you)' : ''}`, value: held.map(heading).join(', ') || '–' }; })} />
        </Card></MotionCard> : null}
        <MotionCard index={6} pressable={false}><Card>
          <Eyebrow>Reference</Eyebrow><H2>What each permission allows</H2>
          {all.map((p) => <View key={p.key} style={{ paddingVertical: space.xs }}><MonoText small>{p.key}</MonoText><P small>{`${p.label}${p.module ? ' (module)' : ''}`}</P></View>)}
        </Card></MotionCard>
        <MotionCard index={7} pressable={false}><Card>
          <Eyebrow>Roles</Eyebrow><H2>The five kinds of account</H2>
          <KeyValue rows={ROLE_ROWS.map(([r, at, can]) => ({ label: label(r), value: <View style={{ alignItems: 'flex-end' }}><MonoText small>{at}</MonoText><P small style={{ textAlign: 'right' }}>{can}</P></View> }))} />
          <P muted small>{WORKSPACES_NOTE}</P>
        </Card></MotionCard>
      </> : null}
    </RequirePermission>
  </WorkspaceScreen>;
}
