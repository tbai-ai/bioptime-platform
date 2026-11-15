/* The coach workspace frame, in Bioptime's own logo, colours and fonts:
   - a dark sidebar: the logo, a top-level Dashboard, the uppercase COACH WORK and BUSINESS groups with collapsible
     sections (./nav.ts), Coach AI and Settings, and a footer with the coach's initials, name, Coach ID and sign-out;
     at phone and tablet width it is the portal's existing drawer (the ☰ button, the scrim, Escape closes it);
   - a top bar: the global search that opens the command palette (⌘K / Ctrl+K), messages with the unread badge,
     the notifications bell, help and sign-out.
   Badges come from GET /coach/home (reloaded every minute and on BADGES_EVENT), as before. Module items show only while
   their module's flag is on (useModuleNav, useFeatures); a coach workspace page shows in the navigation once its
   route is registered (pages/coach/wz/routesA.tsx, routesB.tsx). */
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth, WORKSPACE_LOGIN } from '../../lib/auth';
import { Link, useNavigate } from '../../lib/nav';
import { api } from '../../lib/api';
import { PageBoundary, Skeleton, useApi } from '../../ui';
import { featureOf, useFeatures, useModuleNav } from '../../modules/runtime';
import { PORTAL_MODULES } from '../../modules';
import type { ModuleKey, ModuleNavItem } from '../../modules/types';
import { RouteOutlet, RouteTransition, WorkspaceMotion } from '../../motion';
import { coachRoutes as routesA } from '../../pages/coach/wz/routesA';
import { coachRoutes as routesB } from '../../pages/coach/wz/routesB';
import { BADGES_EVENT } from '../events';
import { NotificationBell } from '../NotificationBell';
import { CommandPalette, type PaletteEntry } from './CommandPalette';
import { Icon, type IconName } from './icons';
import { COACH_NAV, MORE_LABEL, type CoachHome, type CoachLeaf } from './nav';
import '../../styles/coach-shell.css';

const OPEN_KEY = 'bp.coachNav.open';
const DRAWER_QUERY = '(max-width: 1024px)';

type Leaf = { to: string; label: string; icon?: IconName; badge?: number; keywords?: string; also: string[] };
type Section = { id: string; icon: IconName; label: string; to: string; badge?: number; keywords?: string; also: string[]; items?: Leaf[] };
type Group = { id: string; label?: string; sections: Section[] };

function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => { try { return window.matchMedia(query).matches; } catch { return false; } });
  useEffect(() => {
    let mq: MediaQueryList;
    try { mq = window.matchMedia(query); } catch { return; }
    const h = () => setOn(mq.matches);
    h();
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [query]);
  return on;
}

function readOpen(): string[] { try { const v = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; } }
function saveOpen(ids: string[]) { try { localStorage.setItem(OPEN_KEY, JSON.stringify(ids)); } catch { /* storage unavailable: sections simply start closed */ } }

/** Does the workspace-relative path `p` belong to the item at `to` (or one of its `also` paths)? Returns the length of
 *  the longest match, so the most specific item wins (/workouts/sessions over /workouts). */
function matchLength(p: string, to: string, also: string[]): number {
  let best = -1;
  for (const t of [to, ...also]) {
    const hit = t === '/' ? p === '/' || p === '' : p === t || p.startsWith(`${t}/`);
    if (hit) best = Math.max(best, t.length);
  }
  return best;
}

function initials(name?: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toUpperCase() || '·';
}

/** The navigation tree with what this coach may see: module items while their flag is on, coach workspace pages once
 *  registered, badges from GET /coach/home, and the module links the tree does not place under "More". */
function useCoachTree(home: CoachHome): Group[] {
  const moduleNav = useModuleNav('coach');
  const features = useFeatures(true);
  return useMemo(() => {
    const listed = new Map(moduleNav.map((n) => [n.to, n] as [string, ModuleNavItem]));
    const registered = new Set([...routesA, ...routesB].map((r) => r.path));
    const flagOn = (key: ModuleKey) => { const m = PORTAL_MODULES.find((x) => x.key === key); return !!features && !!m && features.has(featureOf(m)); };
    const shown = (l: Omit<CoachLeaf, 'icon'>) => (!l.moduleNav || listed.has(l.to)) && (!l.module || flagOn(l.module)) && (!l.route || registered.has(l.route));
    const badgeOf = (l: Omit<CoachLeaf, 'icon'>) => (l.moduleNav ? listed.get(l.to)?.badge?.(home) : l.badge?.(home)) || undefined;
    const placed = new Set<string>();
    const groups: Group[] = COACH_NAV.map((g) => ({
      id: g.id, label: g.label,
      sections: g.sections.flatMap((s): Section[] => {
        if (s.items) {
          const items = s.items.filter(shown).map((l): Leaf => { placed.add(l.to); return { to: l.to, label: l.label, icon: l.icon, badge: badgeOf(l), keywords: l.keywords, also: l.also ?? [] }; });
          s.items.forEach((l) => placed.add(l.to));
          return items.length ? [{ id: s.id, icon: s.icon, label: s.label, to: items[0]!.to, also: [], items }] : [];
        }
        placed.add(s.to);
        return shown(s) ? [{ id: s.id, icon: s.icon, label: s.label, to: s.to, badge: badgeOf(s), keywords: s.keywords, also: s.also ?? [] }] : [];
      }),
    }));
    // every coach page stays reachable: module links this tree does not place are listed under "More"
    const extra = moduleNav.filter((n) => !placed.has(n.to)).map((n): Section => ({ id: `more:${n.to}`, icon: 'more', label: n.label, to: n.to, badge: n.badge?.(home) || undefined, also: [] }));
    if (extra.length) groups.push({ id: 'extra', label: MORE_LABEL, sections: extra });
    return groups.filter((g) => g.sections.length);
  }, [moduleNav, features, home]);
}

export function CoachShell() {
  const { user, signOut } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const drawer = useMedia(DRAWER_QUERY);
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [tick, setTick] = useState(0);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const sideRef = useRef<HTMLElement>(null);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 60_000); return () => clearInterval(t); }, []);
  const home = useApi(() => api.get('/coach/home'), [tick]);
  useEffect(() => { const h = () => home.reload(); window.addEventListener(BADGES_EVENT, h); return () => window.removeEventListener(BADGES_EVENT, h); });
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  const d = (home.data ?? null) as CoachHome & { coach?: { displayName?: string | null; coachCode?: string | null } };
  const groups = useCoachTree(d);
  const features = useFeatures(true);

  // where we are, workspace-relative, and the most specific item it belongs to
  const path = loc.pathname.replace(/^\/coach(?=\/|$)/, '') || '/';
  const allLeaves = useMemo(() => groups.flatMap((g) => g.sections.flatMap((s) => (s.items ? s.items.map((l) => ({ section: s.id, leaf: l })) : [{ section: s.id, leaf: s as Leaf }]))), [groups]);
  const current = useMemo(() => {
    let best: { section: string; to: string } | null = null, len = -1;
    for (const { section, leaf } of allLeaves) { const m = matchLength(path, leaf.to, leaf.also); if (m > len) { len = m; best = { section, to: leaf.to }; } }
    return best;
  }, [allLeaves, path]);

  // the open accordion sections: remembered per browser, and the current section always opens
  const [openIds, setOpenIds] = useState<string[]>(readOpen);
  const currentIsAccordion = !!current && groups.some((g) => g.sections.some((s) => s.id === current.section && !!s.items));
  useEffect(() => { if (current && currentIsAccordion) setOpenIds((ids) => (ids.includes(current.section) ? ids : [...ids, current.section])); }, [current?.section, currentIsAccordion]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { saveOpen(openIds); }, [openIds]);
  const toggle = (id: string) => setOpenIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  // the drawer (phone and tablet width): out of the tab order while closed, focus moves in when it opens and back to
  // the ☰ button when Escape closes it
  useEffect(() => {
    if (!drawer || !open) return;
    sideRef.current?.querySelector<HTMLElement>('a[href], button:not([disabled])')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) { setOpen(false); menuBtn.current?.focus(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawer, open]);
  useEffect(() => { if (!drawer) setOpen(false); }, [drawer]);

  // ⌘K / Ctrl+K anywhere in the workspace opens the palette (not over another dialog)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'k') return;
      const other = document.querySelector('dialog[open]:not(.wzPalette)');
      if (other) return;
      e.preventDefault();
      setOpen(false);
      setPalette(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const closePalette = useCallback(() => setPalette(false), []);
  const mac = useMemo(() => { try { const p = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? ''; return /mac|iphone|ipad/i.test(p); } catch { return false; } }, []);

  const pages: PaletteEntry[] = useMemo(() => groups.flatMap((g) => g.sections.flatMap((s) => (s.items
    ? s.items.map((l) => ({ id: `page:${l.to}`, label: l.label === 'Overview' ? 'Appointments overview' : l.label, hint: s.label, to: l.to, icon: l.icon ?? s.icon, keywords: `${s.label} ${l.keywords ?? ''}` }))
    : [{ id: `page:${s.to}`, label: s.label, hint: g.label ? (g.id === 'extra' ? MORE_LABEL : g.label.replace(/^\w/, (c) => c.toUpperCase())) : undefined, to: s.to, icon: s.icon, keywords: s.keywords }]))), [groups]);
  const sources = useMemo(() => {
    const on = (key: ModuleKey) => { const m = PORTAL_MODULES.find((x) => x.key === key); return !!features && !!m && features.has(featureOf(m)); };
    return { workouts: on('workouts'), progress: on('progress'), nutrition: on('nutrition') };
  }, [features]);

  const unreadThreads = d?.unreadConversations?.length ?? 0;
  const helpOn = allLeaves.some(({ leaf }) => leaf.to === '/help');
  const name = d?.coach?.displayName || user?.name || '';
  const coachCode = d?.coach?.coachCode ?? null;
  const leave = () => { void signOut().then(() => nav(WORKSPACE_LOGIN.coach)); };

  const leafLink = (l: Leaf, sub: boolean) => {
    const on = current?.to === l.to;
    return <li key={l.to}><Link to={l.to} className={`bp-sideitem wzItem ${sub ? 'wzSubItem' : ''} ${on ? 'active' : ''}`} aria-current={on ? 'page' : undefined} onClick={() => setOpen(false)}>
      {l.icon && <Icon name={l.icon} size={15} className="wzSubIcon" />}<span className="wzItemLabel">{l.label}</span>{l.badge ? <span className="bp-badge" aria-label={`${l.badge} waiting`}>{l.badge}</span> : null}
    </Link></li>;
  };

  return <div className={`shell ws-coach wz ${drawer ? 'wzDrawer' : ''}`}>
    <a className="wzSkip" href="#main" onClick={(e) => { e.preventDefault(); const m = document.getElementById('main'); m?.focus(); m?.scrollIntoView(); }}>Skip to content</a>
    {open && <div className="scrim" onClick={() => setOpen(false)} />}
    <nav ref={sideRef} id="coach-sections" className={`side wzSide ${open ? 'open' : ''}`} aria-label="Sections" inert={drawer && !open ? true : undefined}>
      <div className="brand wzBrand">
        <Link to="/" className="wzLogo" aria-label="Bioptime, coach dashboard" onClick={() => setOpen(false)}><img src="/portal/bioptime-lockup-horizontal-on-dark.svg" alt="" /></Link>
        <span className="bp-eyebrow">Coach workspace</span>
        {drawer && <button type="button" className="bp-iconbtn wzDrawerClose" aria-label="Close sections" onClick={() => { setOpen(false); menuBtn.current?.focus(); }}><Icon name="close" /></button>}
      </div>
      <div className="wzNav">
        {groups.map((g) => <div key={g.id} className="wzGroup" role="group" aria-labelledby={g.label ? `wzg-${g.id}` : undefined}>
          {g.label && <div id={`wzg-${g.id}`} className="section wzGroupLabel">{g.label}</div>}
          <ul className="wzList">
            {g.sections.map((s) => {
              if (!s.items) {
                const on = current?.to === s.to;
                return <li key={s.id}><Link to={s.to} className={`bp-sideitem wzItem wzTop ${on ? 'active' : ''}`} aria-current={on ? 'page' : undefined} onClick={() => setOpen(false)}>
                  <Icon name={s.icon} /><span className="wzItemLabel">{s.label}</span>{s.badge ? <span className="bp-badge">{s.badge}</span> : null}
                </Link></li>;
              }
              const expanded = openIds.includes(s.id);
              const here = current?.section === s.id;
              const waiting = s.items.reduce((n, l) => n + (l.badge ?? 0), 0);
              return <li key={s.id} className={`wzSection ${expanded ? 'open' : ''} ${here ? 'here' : ''}`}>
                <button type="button" className="bp-sideitem wzItem wzTop wzSecBtn" aria-expanded={expanded} aria-controls={`wzs-${s.id}`} onClick={() => toggle(s.id)}>
                  <Icon name={s.icon} /><span className="wzItemLabel">{s.label}</span>
                  {!expanded && waiting > 0 && <span className="bp-badge" aria-label={`${waiting} waiting`}>{waiting}</span>}
                  <Icon name="chevron" size={16} className="wzChevron" />
                </button>
                <div id={`wzs-${s.id}`} className="wzSub" data-open={expanded || undefined}>
                  <ul className="wzSubList">{s.items.map((l) => leafLink(l, true))}</ul>
                </div>
              </li>;
            })}
          </ul>
        </div>)}
      </div>
      <div className="who wzWho">
        <span className="avatar avatarSm wzAvatar" aria-hidden="true">{initials(name)}</span>
        <span className="wzWhoText"><b title={name}>{name}</b><span className="wzWhoId">{coachCode ? <>Coach ID <span className="num">{coachCode}</span></> : 'Coach'}</span></span>
        <button type="button" className="bp-iconbtn wzWhoOut" onClick={leave} title="Sign out"><Icon name="power" size={18} /><span className="sr">Sign out</span></button>
      </div>
    </nav>
    <div className="main">
      <header className="topbar wzTopbar">
        <button ref={menuBtn} type="button" className="menuBtn" aria-label="Open sections" aria-expanded={open} aria-controls="coach-sections" onClick={() => setOpen((o) => !o)}><Icon name="menu" size={22} /></button>
        <button type="button" className="wzSearch" onClick={() => setPalette(true)} aria-haspopup="dialog" aria-keyshortcuts="Meta+K Control+K" aria-label="Search clients, plans and pages">
          <Icon name="search" size={18} /><span className="wzSearchText">Search clients, plans and pages…</span><kbd className="wzKbd" aria-hidden="true">{mac ? '⌘K' : 'Ctrl K'}</kbd>
        </button>
        <span className="spacer" />
        <div className="wzTopIcons">
          <Link to="/messages" className="bp-iconbtn wzTopBtn" aria-label={`Messages${unreadThreads ? `, ${unreadThreads} unread conversation${unreadThreads === 1 ? '' : 's'}` : ''}`} title="Messages">
            <Icon name="messages" size={20} />{unreadThreads > 0 && <span className="bp-badge wzTopBadge">{unreadThreads}</span>}
          </Link>
          <NotificationBell workspace="coach" tick={tick} icon={<Icon name="bell" size={20} />} className="wzBell" dismissible />
          {helpOn && <Link to="/help" className="bp-iconbtn wzTopBtn" aria-label="Help" title="Help"><Icon name="help" size={20} /></Link>}
          <span className="wzTopSep" aria-hidden="true" />
          <button type="button" className="bp-iconbtn wzTopBtn wzPower" onClick={leave} aria-label="Sign out" title="Sign out"><Icon name="power" size={20} /></button>
        </div>
      </header>
      <main className="content" id="main" tabIndex={-1}>
        {/* the section transition (src/motion): a plain block at rest and where the motion layer is off */}
        <RouteTransition routeKey={loc.pathname}><PageBoundary resetKey={loc.pathname}><Suspense fallback={<Skeleton rows={6} />}><RouteOutlet /></Suspense></PageBoundary></RouteTransition>
      </main>
    </div>
    <CommandPalette open={palette} onClose={closePalette} pages={pages} sources={sources} />
    {/* card reveals, card depth, dialog and accordion motion: delegated, transform and opacity only, renders nothing */}
    <WorkspaceMotion routeKey={loc.pathname} />
  </div>;
}
