/* The coach workspace: Today, Clients, Calendar, Messages and More (the web's /coach sections; lib/workspaceNav). Only a
   coach may be here: anyone else sees the same refusal as on the web (components/workspaceShell RoleGate). Every
   screen uses coach endpoints only (apps/api/src/http/routes/coach.ts), whose field policy strips members' phone,
   email, address, PIN code, date of birth and government IDs; the app never renders those fields. */
import React from 'react';
import { RoleGate, WorkspaceTabs } from '@/components/workspaceShell';
import { BrandStage } from '@/motion';

export default function CoachLayout() {
  return <RoleGate workspace="coach"><BrandStage><WorkspaceTabs workspace="coach" /></BrandStage></RoleGate>;
}
