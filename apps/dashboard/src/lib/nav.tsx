/* Links inside a workspace stay inside it. Pages write `to="/clients/123"` and this wrapper prefixes the current
   workspace (/client, /coach or /admin), so the same page works under more than one namespace. Paths that already
   name a namespace, the sign-in pages or the API are left alone. */
import React from 'react';
import { Link as RLink, NavLink as RNavLink, useLocation, useNavigate as rUseNavigate, type LinkProps, type NavLinkProps, type NavigateOptions, type To } from 'react-router-dom';

export const WORKSPACES = ['/client', '/coach', '/admin'] as const;
export type Workspace = 'client' | 'coach' | 'admin';

export function workspaceOf(pathname: string): Workspace | null {
  const ns = WORKSPACES.find((n) => pathname === n || pathname.startsWith(`${n}/`));
  return ns ? (ns.slice(1) as Workspace) : null;
}
export function useWorkspace(): Workspace | null { return workspaceOf(useLocation().pathname); }
export function useBase(): string { const w = useWorkspace(); return w ? `/${w}` : ''; }

export function resolveTo(base: string, to: To): To {
  if (typeof to !== 'string') return to;
  if (!to.startsWith('/')) return to;
  if (to.startsWith('/login') || to.startsWith('/dashboard') || to.startsWith('/api') || WORKSPACES.some((n) => to === n || to.startsWith(`${n}/`))) return to;
  return to === '/' ? base || '/' : `${base}${to}`;
}

export function Link(props: LinkProps & React.RefAttributes<HTMLAnchorElement>) { const base = useBase(); return <RLink {...props} to={resolveTo(base, props.to)} />; }
export function NavLink(props: NavLinkProps & React.RefAttributes<HTMLAnchorElement>) { const base = useBase(); return <RNavLink {...props} to={resolveTo(base, props.to)} />; }
export function useNavigate() {
  const base = useBase();
  const nav = rUseNavigate();
  return (to: To | number, opts?: NavigateOptions) => (typeof to === 'number' ? nav(to) : nav(resolveTo(base, to), opts));
}
