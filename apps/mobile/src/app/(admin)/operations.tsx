/* Admin › Operations (the web's /admin/operations, operations.manage): the exception queue with owners and resolution,
   the audit log, website enquiries, the outbox and the background jobs (components/adminB1/operations). A refusal
   sits inside a Screen, with the gutter (components/adminB1/parts PermissionScreen). */
import React from 'react';
import { OperationsScreen } from '@/components/adminB1/operations';
import { PermissionScreen } from '@/components/adminB1/parts';

export default function AdminOperations() {
  return <PermissionScreen permission="operations.manage"><OperationsScreen /></PermissionScreen>;
}
