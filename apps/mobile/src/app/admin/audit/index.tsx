/* Admin › Audit log (the web's /admin/audit, audit.view): the Operations page fixed on its Audit log tab, with the
   filters (action, target, since, until) and paging (components/adminB1/operations). The stack header (title and bell)
   and the permission gate sit outside the page, so a refusal keeps the title, the bell and the screen gutter. */
import { Stack } from 'expo-router';
import React from 'react';
import { AdminBell } from '@/components/adminB1/adminBell';
import { OperationsScreen } from '@/components/adminB1/operations';
import { PermissionScreen } from '@/components/adminB1/parts';
import { RoleGate } from '@/components/workspaceShell';

export default function AdminAudit() {
  return <>
    <Stack.Screen options={{ title: 'Audit log', headerRight: () => <AdminBell /> }} />
    <RoleGate workspace="admin"><PermissionScreen permission="audit.view"><OperationsScreen fixedTab="audit" plain /></PermissionScreen></RoleGate>
  </>;
}
