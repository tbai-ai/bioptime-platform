/* LabStack operations: an empty stub registered by the foundation (M0). It renders nothing until the module's builder adds
   routes, nav, clientTabs, cards or settings here (pages as new files in this folder).
   Admin workspace only, behind the labstack.manage permission: never a coach or client route, nav item, tab or card,
   and never a link from the website. */
import type { PortalModule } from '../types';

export const labstackOps: PortalModule = { key: 'labstackOps', title: 'LabStack operations' };
