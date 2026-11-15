/* The administrative portal: Overview, Members, Operations, Messages and More (the web's /admin sections;
   lib/workspaceNav). Only an administrator or owner may be here: anyone else sees the same refusal as on the web
   (components/workspaceShell RoleGate); each section also needs its permission (RequirePermission), as on the web.
   The bell in every header opens the admin notifications screen (/admin/notifications): components/adminB1 AdminTabs
   draws the same tab bar as the shared WorkspaceTabs with that bell. */
import React from 'react';
import { AdminTabs } from '@/components/adminB1/adminBell';
import { RoleGate } from '@/components/workspaceShell';
import { BrandStage } from '@/motion';

export default function AdminLayout() {
  return <RoleGate workspace="admin"><BrandStage><AdminTabs /></BrandStage></RoleGate>;
}
