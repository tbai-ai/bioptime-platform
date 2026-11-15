/* /admin/operations as a plain screen (a link from a record or the overview), the same page as the Operations tab. The
   stack header (title and bell) and the permission gate sit outside the page, so a refusal keeps the title, the bell
   and the screen gutter (components/adminB1/parts PermissionScreen). */
import { Stack } from 'expo-router';
import React from 'react';
import { AdminBell } from '@/components/adminB1/adminBell';
import { OperationsScreen } from '@/components/adminB1/operations';
import { PermissionScreen } from '@/components/adminB1/parts';
import { RoleGate } from '@/components/workspaceShell';

export default function AdminOperationsScreen() {
  return <>
    <Stack.Screen options={{ title: 'Operations', headerRight: () => <AdminBell /> }} />
    <RoleGate workspace="admin"><PermissionScreen permission="operations.manage"><OperationsScreen plain /></PermissionScreen></RoleGate>
  </>;
}
