import React from 'react';
import { Route, Routes, Navigate, useLocation } from 'react-router-dom';
import { RequireRole, RequirePermission, ROLE_HOME, useAuth } from './lib/auth';
import { Shell } from './shell/Shell';
import { ClientLogin, CoachLogin, AdminLogin } from './pages/auth/Logins';
import { Invite } from './pages/Invite';
import { Home } from './pages/Home';
import { ClientDetail } from './pages/ClientDetail';
import { PlanEditor } from './pages/PlanEditor';
import { Appointments } from './pages/Appointments';
import { Messages } from './pages/Messages';
import { Bloodwork } from './pages/Bloodwork';
import { Report } from './pages/Report';
import { Settings } from './pages/Settings';
import { ClientHome } from './pages/client/ClientHome';
import { Program } from './pages/client/Program';
import { Progress } from './pages/client/Progress';
import { ClientAppointments } from './pages/client/ClientAppointments';
import { ClientBloodwork, ClientBooking } from './pages/client/ClientBloodwork';
import { ClientReport } from './pages/client/ClientReport';
import { Profile } from './pages/client/Profile';
import { CoachProfilePage } from './pages/coach/CoachProfile';
import { CoachClients } from './pages/coach/CoachClients';
import { MemberActivate } from './pages/auth/MemberActivate';
import { PhoneSignIn } from './pages/auth/PhoneSignIn';
import { Welcome } from './pages/client/Welcome';
import { Bespoke } from './pages/client/Bespoke';
import { AlertIcon, isChunkLoadError } from './ui';
import { Link } from './lib/nav';
import { moduleRoutes, ModuleRouteGate } from './modules/runtime';
import { coachRoutes as coachRoutesA } from './pages/coach/wz/routesA';
import { coachRoutes as coachRoutesB } from './pages/coach/wz/routesB';

/* Administrator-only pages arrive as one chunk (pages/admin/index.ts) the first time an administrator opens one;
   the Shell's Suspense shows a skeleton meanwhile. Members and coaches never fetch it.
   React.lazy keeps a failed import for good, so a chunk that cannot be fetched (a release replaced it) reloads the page
   once; the session flag stops a reload loop and is cleared after the chunk loads. A second failure reaches PageBoundary,
   which offers "Reload the portal". */
const CHUNK_RELOAD_FLAG = 'bp.adminChunkReload';
const adminChunk = () => import('./pages/admin').then((m) => {
  try { sessionStorage.removeItem(CHUNK_RELOAD_FLAG); } catch { /* storage unavailable */ }
  return m;
}, (e: unknown) => {
  if (isChunkLoadError(e)) {
    let first = false;
    try { first = !sessionStorage.getItem(CHUNK_RELOAD_FLAG); if (first) sessionStorage.setItem(CHUNK_RELOAD_FLAG, '1'); } catch { /* storage unavailable: no automatic reload, the boundary offers one */ }
    if (first) { window.location.reload(); return new Promise<never>(() => {}); }
  }
  throw e;
});
const lazyAdmin = <K extends keyof Awaited<ReturnType<typeof adminChunk>>>(k: K) => React.lazy(() => adminChunk().then((m) => ({ default: m[k] })));
const Clients = lazyAdmin('Clients'), Coaches = lazyAdmin('Coaches'), CoachDetail = lazyAdmin('CoachDetail'), Assignments = lazyAdmin('Assignments'), Packages = lazyAdmin('Packages'), CustomPlans = lazyAdmin('CustomPlans'), Orders = lazyAdmin('Orders'), Analytics = lazyAdmin('Analytics'), Operations = lazyAdmin('Operations');
const Content = lazyAdmin('Content'), Theme = lazyAdmin('Theme'), Users = lazyAdmin('Users'), Integrations = lazyAdmin('Integrations'), LabStack = lazyAdmin('LabStack'), Modules = lazyAdmin('Modules');

/** The pages registered modules add to a workspace (src/modules), each shown only while its flag is on. */
const modulePages = (workspace: 'client' | 'coach' | 'admin') => moduleRoutes(workspace).map((r) => <Route key={r.key} path={r.path} element={<ModuleRouteGate entry={r} />} />);

/** The coach workspace pages (pages/coach/wz/routesA.tsx and routesB.tsx, paths relative to /coach, ''
    for the index). Mounted before the existing coach routes: React Router ranks equal paths by order, so a registered
    path replaces the old page for that path and every other coach page keeps working. */
const wzCoachPages = () => [...coachRoutesA, ...coachRoutesB].map((r, i) => r.path === '' ? <Route key={`wz-${i}-index`} index element={r.element} /> : <Route key={`wz-${i}-${r.path}`} path={r.path} element={r.element} />);

/** "/" and the old "/dashboard" go to the signed-in role's workspace, or to the client sign-in. */
function RootRedirect() {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="content"><p className="muted">Checking your session…</p></div>;
  if (loc.pathname.startsWith('/dashboard/login')) return <Navigate to="/login/coach" replace />;
  if (!user) return <Navigate to={loc.pathname.startsWith('/dashboard') ? '/login/coach' : '/login/client'} replace />;
  const rest = loc.pathname.startsWith('/dashboard') ? loc.pathname.slice('/dashboard'.length) : '';
  return <Navigate to={`${ROLE_HOME[user.role]}${rest}${loc.search}`} replace />;
}

/** The admin overview needs reports.view; an administrator without it starts on the first section they hold. */
function AdminIndex() {
  const { can } = useAuth();
  if (can('reports.view')) return <Home />;
  const first = [['members.manage', 'clients'], ['coaches.manage', 'coaches'], ['assignments.manage', 'assignments'], ['packages.manage', 'packages'], ['custom_plans.manage', 'custom-plans'], ['orders.manage', 'orders'], ['content.manage', 'content'], ['theme.manage', 'theme'], ['operations.manage', 'operations'], ['integrations.manage', 'bloodwork'], ['permissions.manage', 'users'], ['settings.manage', 'settings'], ['audit.view', 'audit'], ['labstack.manage', 'integrations/labstack'], ['modules.manage', 'modules']].find(([p]) => can(p!));
  return first ? <Navigate to={`/admin/${first[1]}`} replace /> : <div className="content"><div className="bp-alert bp-alert-warning" role="alert"><AlertIcon kind="warning" /><div><b>No permissions yet</b>An owner grants them under Users and permissions.</div></div></div>;
}

function NotFound() { return <div className="content"><div className="bp-empty"><b>No such page</b><p>Use the sections on the left, or <Link to="/">start again</Link>.</p></div></div>; }

export function App() {
  return <Routes>
    <Route path="/" element={<RootRedirect />} />
    <Route path="/dashboard/*" element={<RootRedirect />} />
    <Route path="/login" element={<Navigate to="/login/client" replace />} />
    <Route path="/login/client" element={<ClientLogin />} />
    <Route path="/login/client/activate" element={<MemberActivate />} />
    <Route path="/login/client/phone" element={<PhoneSignIn />} />
    <Route path="/login/coach" element={<CoachLogin />} />
    <Route path="/login/coach/activate" element={<Invite />} />
    <Route path="/login/admin" element={<AdminLogin />} />

    <Route path="/client" element={<RequireRole roles={['member']}><Shell workspace="client" /></RequireRole>}>
      <Route index element={<ClientHome />} />
      <Route path="welcome" element={<Welcome />} />
      <Route path="program" element={<Program />} />
      <Route path="bespoke" element={<Bespoke />} />
      <Route path="progress" element={<Progress />} />
      <Route path="appointments" element={<ClientAppointments />} />
      <Route path="bloodwork" element={<ClientBloodwork />} />
      <Route path="bloodwork/:id" element={<ClientBooking />} />
      <Route path="reports/:id" element={<ClientReport />} />
      <Route path="messages" element={<Messages />} />
      <Route path="messages/:id" element={<Messages />} />
      <Route path="profile" element={<Profile />} />
      {modulePages('client')}
      <Route path="*" element={<NotFound />} />
    </Route>

    <Route path="/coach" element={<RequireRole roles={['coach']}><Shell workspace="coach" /></RequireRole>}>
      {wzCoachPages()}
      <Route index element={<Home />} />
      <Route path="clients" element={<CoachClients />} />
      <Route path="clients/:id" element={<ClientDetail />} />
      <Route path="plans/:id" element={<PlanEditor />} />
      <Route path="appointments" element={<Appointments />} />
      <Route path="calendar" element={<Appointments />} />
      <Route path="profile" element={<CoachProfilePage />} />
      <Route path="messages" element={<Messages />} />
      <Route path="messages/:id" element={<Messages />} />
      <Route path="bloodwork" element={<Bloodwork />} />
      <Route path="reports/:id" element={<Report />} />
      <Route path="settings" element={<Settings />} />
      {modulePages('coach')}
      <Route path="*" element={<NotFound />} />
    </Route>

    {/* Each guard names the permission the page's API endpoints require (apps/api/src/http/routes); the Shell's nav uses the same names. */}
    <Route path="/admin" element={<RequireRole roles={['admin', 'owner']}><Shell workspace="admin" /></RequireRole>}>
      <Route index element={<AdminIndex />} />
      <Route path="clients" element={<RequirePermission permission="members.manage"><Clients /></RequirePermission>} />
      <Route path="clients/:id" element={<RequirePermission permission="members.manage"><ClientDetail /></RequirePermission>} />
      <Route path="coaches" element={<RequirePermission permission="coaches.manage"><Coaches /></RequirePermission>} />
      <Route path="coaches/:id" element={<RequirePermission permission="coaches.manage"><CoachDetail /></RequirePermission>} />
      <Route path="assignments" element={<RequirePermission permission="assignments.manage"><Assignments /></RequirePermission>} />
      <Route path="packages" element={<RequirePermission permission="packages.manage"><Packages /></RequirePermission>} />
      <Route path="custom-plans" element={<RequirePermission permission="custom_plans.manage"><CustomPlans /></RequirePermission>} />
      <Route path="approvals" element={<RequirePermission permission="custom_plans.manage"><CustomPlans /></RequirePermission>} />
      <Route path="audit" element={<RequirePermission permission="audit.view"><Operations fixedTab="audit" /></RequirePermission>} />
      <Route path="integrations/labstack" element={<RequirePermission permission="labstack.manage"><LabStack /></RequirePermission>} />
      <Route path="orders" element={<RequirePermission permission="orders.manage"><Orders /></RequirePermission>} />
      <Route path="appointments" element={<RequirePermission permission="members.manage"><Appointments /></RequirePermission>} />
      <Route path="messages" element={<RequirePermission permission="members.manage"><Messages /></RequirePermission>} />
      <Route path="messages/:id" element={<RequirePermission permission="members.manage"><Messages /></RequirePermission>} />
      {/* Bloodwork shows each tab for its own permission (Reports: reports.view; Bookings and Catalogue: integrations.manage), so either one opens it. */}
      <Route path="bloodwork" element={<RequirePermission permission={['reports.view', 'integrations.manage']} any><Bloodwork /></RequirePermission>} />
      {/* GET /reports/:id admits any administrator (assertReportAccess), so the report page carries no permission guard. */}
      <Route path="reports/:id" element={<Report />} />
      <Route path="analytics" element={<RequirePermission permission="reports.view"><Analytics /></RequirePermission>} />
      <Route path="operations" element={<RequirePermission permission="operations.manage"><Operations /></RequirePermission>} />
      <Route path="content" element={<RequirePermission permission="content.manage"><Content /></RequirePermission>} />
      <Route path="theme" element={<RequirePermission permission="theme.manage"><Theme /></RequirePermission>} />
      <Route path="users" element={<RequirePermission permission="permissions.manage"><Users /></RequirePermission>} />
      {/* The Integrations page reads only GET /admin/settings (settings.manage); LabStack has its own route above. */}
      <Route path="integrations" element={<RequirePermission permission="settings.manage"><Integrations /></RequirePermission>} />
      <Route path="settings" element={<RequirePermission permission="settings.manage"><Settings /></RequirePermission>} />
      {/* Feature flags need modules.manage, module settings settings.manage; the page shows each part to whoever holds it. */}
      <Route path="modules" element={<RequirePermission permission={['modules.manage', 'settings.manage']} any><Modules /></RequirePermission>} />
      {modulePages('admin')}
      <Route path="*" element={<NotFound />} />
    </Route>

    <Route path="*" element={<NotFound />} />
  </Routes>;
}
