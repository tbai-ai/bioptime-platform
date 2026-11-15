import React, { Suspense, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, WORKSPACE_LOGIN } from '../lib/auth';
import { NavLink, useNavigate, type Workspace } from '../lib/nav';
import { api } from '../lib/api';
import { PageBoundary, Skeleton, useApi } from '../ui';
import { hasModuleUi, useModuleNav } from '../modules/runtime';
import { RouteOutlet, RouteTransition, WorkspaceMotion } from '../motion';
import { BADGES_EVENT } from './events';
import { NotificationBell } from './NotificationBell';
import { CoachShell } from './coach/CoachShell';

/** `permission` names what the section's API endpoints require; several means all of them, or any one of them when `any` is set. */
type Item = { to: string; label: string; badge?: number; permission?: string | string[]; any?: boolean; sub?: boolean };

const TITLES: Record<Workspace, string> = { client: 'Member portal', coach: 'Coach workspace', admin: 'Admin workspace' };
export { BADGES_EVENT };
/** What a member still in setup can open: Welcome (Home leads there), Profile and Help and support. Every other
    section waits until setup is finished, so the navigation lists only these. */
const ONBOARDING_PATHS = /^\/client\/(welcome|profile|help)(\/|$)/;
const ONBOARDING_NAV = new Set(['/', '/profile', '/help']);

/** The workspace frame. The coach workspace has its own shell (./coach/CoachShell.tsx: the coach sidebar,
    top bar and command palette); the member and admin workspaces keep this one. */
export function Shell({ workspace }: { workspace: Workspace }) {
  return workspace === 'coach' ? <CoachShell /> : <WorkspaceShell workspace={workspace} />;
}

function WorkspaceShell({ workspace }: { workspace: 'client' | 'admin' }) {
  const { user, signOut, can } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 60_000); return () => clearInterval(t); }, []);
  // GET /admin/overview needs reports.view; an administrator without it gets no badges rather than a 403 every minute
  const canOverview = workspace !== 'admin' || can('reports.view');
  const home = useApi(() => (workspace === 'admin' ? (canOverview ? api.get('/admin/overview') : Promise.resolve(null)) : api.get('/me')), [workspace, tick, canOverview]);
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  useEffect(() => { const h = () => home.reload(); window.addEventListener(BADGES_EVENT, h); return () => window.removeEventListener(BADGES_EVENT, h); });
  // navigation the registered modules add (src/modules): only items whose module flag is on and whose permission is held
  const moduleNav = useModuleNav(workspace);

  const d = home.data as any;
  // the account state comes from the session (refreshed when onboarding completes), so this never lags behind the member's own actions
  const onboarding = workspace === 'client' && user?.state === 'onboarding';
  if (onboarding && !ONBOARDING_PATHS.test(loc.pathname)) return <Navigate to="/client/welcome" replace />;
  const items: Item[] = workspace === 'client' ? [
    { to: '/', label: 'Home' },
    { to: '/program', label: 'My program' },
    { to: '/bespoke', label: 'Bespoke' },
    { to: '/progress', label: 'Progress' },
    { to: '/appointments', label: 'Appointments' },
    { to: '/bloodwork', label: 'Bloodwork' },
    { to: '/messages', label: 'Messages', badge: d?.unread?.messages },
    { to: '/profile', label: 'Profile' },
  ] : [
    { to: '/', label: 'Overview', permission: 'reports.view' },
    { to: '/clients', label: 'Clients', permission: 'members.manage' },
    { to: '/coaches', label: 'Coaches', permission: 'coaches.manage' },
    { to: '/assignments', label: 'Assignments', permission: 'assignments.manage', badge: d?.assignments?.unassigned },
    { to: '/packages', label: 'Packages', permission: 'packages.manage' },
    { to: '/approvals', label: 'Approvals', permission: 'custom_plans.manage', badge: d?.exceptions?.byKind?.custom_plan_approval },
    { to: '/bloodwork', label: 'Bloodwork', permission: ['reports.view', 'integrations.manage'], any: true, badge: d?.reportsAwaitingReview },
    { to: '/orders', label: 'Orders', permission: 'orders.manage', badge: d?.orders?.pendingPayment },
    { to: '/appointments', label: 'Appointments', permission: 'members.manage' },
    { to: '/messages', label: 'Messages', permission: 'members.manage' },
    { to: '/content', label: 'Website content', permission: 'content.manage' },
    { to: '/theme', label: 'Theme', permission: 'theme.manage' },
    { to: '/analytics', label: 'Analytics', permission: 'reports.view' },
    { to: '/operations', label: 'Operations', permission: 'operations.manage', badge: d?.exceptions?.open },
    { to: '/integrations', label: 'Integrations', permission: 'settings.manage' },
    { to: '/integrations/labstack', label: 'LabStack', permission: 'labstack.manage', sub: true },
    { to: '/audit', label: 'Audit log', permission: 'audit.view' },
    { to: '/users', label: 'Users and permissions', permission: 'permissions.manage' },
    { to: '/settings', label: 'Settings', permission: 'settings.manage' },
  ];
  // module items join the main list (before the core item they name, or at the end), or sit under their group's heading
  // after it, which keeps the client navigation short; the Modules page is listed once a module adds anything
  if (workspace === 'admin' && hasModuleUi()) items.splice(items.findIndex((i) => i.to === '/integrations'), 0, { to: '/modules', label: 'Modules', permission: ['modules.manage', 'settings.manage'], any: true });
  const groups = new Map<string, Item[]>();
  for (const n of moduleNav) {
    const item: Item = { to: n.to, label: n.label, badge: n.badge?.(d), permission: n.permission, any: n.any };
    if (n.group) { groups.set(n.group, [...(groups.get(n.group) ?? []), item]); continue; }
    const at = n.before ? items.findIndex((i) => i.to === n.before) : -1;
    if (at >= 0) items.splice(at, 0, item); else items.push(item);
  }
  const visible = items.filter((it) => { if (onboarding && !ONBOARDING_NAV.has(it.to)) return false; if (!it.permission) return true; const list = ([] as string[]).concat(it.permission); return it.any ? list.some((p) => can(p)) : list.every((p) => can(p)); });
  if (onboarding) groups.clear();
  // a tap on the section already open changes no path, so the phone menu closes here as well as on navigation
  const link = (it: Item) => <NavLink key={it.to} to={it.to} end={it.to === '/'} onClick={() => setOpen(false)} className={({ isActive }) => `bp-sideitem ${isActive ? 'active' : ''} ${it.sub ? 'sub' : ''}`}>{it.label}{it.badge ? <span className="bp-badge">{it.badge}</span> : null}</NavLink>;

  const search = (e: React.FormEvent) => { e.preventDefault(); if (q.trim()) nav(`/clients?q=${encodeURIComponent(q.trim())}`); };

  return <>
    <div className={`shell ws-${workspace}`}>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <nav className={`side ${open ? 'open' : ''}`} aria-label="Sections">
        <div className="brand"><img src="/portal/bioptime-lockup-horizontal-on-dark.svg" alt="Bioptime" /><span className="bp-eyebrow">{workspace === 'admin' && user?.role === 'owner' ? 'Owner workspace' : TITLES[workspace]}</span></div>
        {visible.map(link)}
        {[...groups].map(([group, list]) => <React.Fragment key={group}><div className="section">{group}</div>{list.map(link)}</React.Fragment>)}
        <div className="who"><b>{user?.name}</b><span className="bp-eyebrow">{user?.role}{user?.mfaEnabled ? ' · MFA on' : ''}</span><br /><button onClick={() => { void signOut().then(() => nav(WORKSPACE_LOGIN[workspace])); }}>Sign out</button></div>
      </nav>
      <div className="main">
        <header className="topbar">
          <button className="menuBtn" aria-label="Open sections" aria-expanded={open} onClick={() => setOpen((o) => !o)}>☰</button>
          {workspace !== 'client' ? <form className="search" role="search" onSubmit={search}><label className="sr" htmlFor="q">Search clients</label><input id="q" className="bp-input bp-input-dense" type="search" placeholder="Search clients (name, email)" value={q} onChange={(e) => setQ(e.target.value)} /></form> : <span className="topbarTitle">{TITLES[workspace]}</span>}
          <span className="spacer" />
          <NotificationBell workspace={workspace} tick={tick} icon="🔔" />
        </header>
        <main className="content" id="main">
          {/* the section transition (src/motion): a plain block at rest and where the motion layer is off */}
          <RouteTransition routeKey={loc.pathname}><PageBoundary resetKey={loc.pathname}><Suspense fallback={<Skeleton rows={6} />}><RouteOutlet /></Suspense></PageBoundary></RouteTransition>
        </main>
      </div>
      {/* card reveals, card depth, dialog and accordion motion: delegated, transform and opacity only, renders nothing */}
      <WorkspaceMotion routeKey={loc.pathname} />
    </div>
  </>;
}
