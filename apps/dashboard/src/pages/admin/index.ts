/* The administrator-only pages, re-exported from one module so App.tsx can load them as a single chunk with React.lazy:
   members and coaches never download them. Pages both workspaces use (Home, ClientDetail, Bloodwork, Report, Messages,
   Appointments, PlanEditor, Settings) stay in the main bundle. */
export { Clients } from '../Clients';
export { Coaches, CoachDetail } from '../Coaches';
export { Assignments } from '../Assignments';
export { Packages } from '../Packages';
export { CustomPlans } from '../CustomPlans';
export { Orders } from '../Orders';
export { Analytics } from '../Analytics';
export { Operations } from '../Operations';
export { Content } from './Content';
export { Theme } from './Theme';
export { Users } from './Users';
export { Integrations } from './Integrations';
export { LabStack } from './LabStack';
export { Modules } from './Modules';
