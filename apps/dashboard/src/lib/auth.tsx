import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, ApiRequestError, sessionUserId, setAfterRefusal, setBeforeRequest, setMfaEnrolmentHandler, setUnauthorisedHandler } from './api';
import { workspaceOf, type Workspace } from './nav';
import { PREVIEW_WORKSPACE, PREVIEW_WORKSPACES, previewOpens, previewWorkspacesFrom, type PreviewWorkspace } from './openPreview';
import { AlertIcon, Button } from '../ui';

export type Role = 'member' | 'coach' | 'admin' | 'owner';
export type User = { id: string; email: string; name: string; role: Role; state: string; mfaEnabled: boolean; emailVerified?: boolean };
/** How an open-preview opening counts: 'fresh' (the tab has no account: the loop guard counts it), 'switch' (the tab holds
    another workspace's account, or another tab took the session: counted separately, generously), 'tap' (a person pressed
    "Open … here": not counted). */
type OpenKind = 'fresh' | 'switch' | 'tap';
type Auth = {
  user: User | null; permissions: string[]; loading: boolean; sessionExpired: boolean;
  /** An admin route refused this session because the account has no two-factor authentication yet (403 MFA_ENROLMENT_REQUIRED). */
  mfaEnrolmentRequired: boolean;
  refresh: () => Promise<void>; signOut: () => Promise<void>; setSession: (u: User | null, permissions?: string[]) => void;
  isPrivileged: boolean; isCoach: boolean; isMember: boolean; can: (permission: string) => boolean;
  /** Open preview: sign-in is switched off for now on this server (GET /public/config openPreview; demo mode only). */
  openPreview: boolean;
  /** Open preview: whether this workspace opens without signing in (GET /public/config openPreviewWorkspaces lists it, or
      the server sends no list); a workspace it does not open signs in as usual. False while the preview is off. */
  previewOpens: (ws: Workspace) => boolean;
  /** Open preview only: opens the workspace's fixed preview account (POST /auth/open-preview) and keeps its session. */
  openWorkspace: (ws: Workspace, kind?: OpenKind) => Promise<User>;
};

const Ctx = createContext<Auth>({ user: null, permissions: [], loading: true, sessionExpired: false, mfaEnrolmentRequired: false, refresh: async () => {}, signOut: async () => {}, setSession: () => {}, isPrivileged: false, isCoach: false, isMember: false, can: () => false, openPreview: false, previewOpens: () => false, openWorkspace: async () => { throw new Error('No session provider'); } });

/* Open preview (the owner's decision of 30 October 2026: no sign-in anywhere in the demo for now). The server turns it on
   only in demo mode with OPEN_PREVIEW=1 and then says openPreview: true in GET /public/config; otherwise the flag is
   absent and every page below behaves exactly as before. While it is on, each workspace opens its fixed preview account
   through POST /auth/open-preview, a route the server offers only in that mode: no password, code or secret is in this
   code, the server decides who the account is. The sign-in pages and the workspace guards open it on their own; sign-out
   leads to the website's home page, as the sign-in page would only open the workspace again. A server may open only
   some workspaces (GET /public/config openPreviewWorkspaces; lib/openPreview.ts): the others keep their sign-in form,
   their guard and their sign-out exactly as without the preview. */
const ROLE_WORKSPACE: Record<Role, Workspace> = { member: 'client', coach: 'coach', admin: 'admin', owner: 'admin' };
export const WORKSPACE_TITLE: Record<Workspace, string> = { client: 'member portal', coach: 'coach workspace', admin: 'administrative portal' };
type Opened = { user: User; permissions?: string[] };
const opening: Partial<Record<Workspace, Promise<Opened>>> = {};
/* A session that does not stay open (refused at once, ended at once) must not send a page round in circles: at most three
   openings of one workspace a minute from a tab without an account, remembered for the tab (session storage, else this
   page load); after that the sign-in page shows its form with the reason. Openings that replace another workspace's
   account (another tab took the session, or this tab moved to another workspace) are not failures and have their own,
   generous count; sign-out clears both, as the person ended those sessions on purpose. */
const OPEN_ATTEMPTS_KEY = 'bp.openPreviewAttempts';
const OPEN_ATTEMPTS_MAX = 3;
const OPEN_SWITCHES_KEY = 'bp.openPreviewSwitches';
const OPEN_SWITCHES_MAX = 20;
const OPEN_WINDOW_MS = 60_000;
const attemptsInMemory: Record<string, Record<string, number[]>> = {};
function takeAttempt(key: string, bucket: string, max: number): boolean {
  let all: Record<string, number[]> = attemptsInMemory[key] ?? {};
  try { all = JSON.parse(window.sessionStorage.getItem(key) || '{}') ?? {}; } catch { /* storage blocked: this page load only */ }
  const now = Date.now();
  const recent = (Array.isArray(all[bucket]) ? all[bucket]! : []).filter((t) => typeof t === 'number' && now - t < OPEN_WINDOW_MS);
  if (recent.length >= max) return false;
  all = { ...all, [bucket]: [...recent, now] };
  attemptsInMemory[key] = all;
  try { window.sessionStorage.setItem(key, JSON.stringify(all)); } catch { /* kept in memory */ }
  return true;
}
function clearAttempts(): void {
  for (const key of [OPEN_ATTEMPTS_KEY, OPEN_SWITCHES_KEY]) { delete attemptsInMemory[key]; try { window.sessionStorage.removeItem(key); } catch { /* memory only */ } }
}
/** One request per workspace at a time: the guard and the sign-in page (and React's development double effects) share it. */
function openPreviewSession(ws: Workspace, kind: OpenKind): Promise<Opened> {
  const busy = opening[ws];
  if (busy) return busy;
  if (kind === 'fresh' && !takeAttempt(OPEN_ATTEMPTS_KEY, ws, OPEN_ATTEMPTS_MAX)) return Promise.reject(new ApiRequestError(429, 'OPEN_PREVIEW_REPEATED', `The ${WORKSPACE_TITLE[ws]} was opened several times in a minute and did not stay open, so it is not opened again on its own. Sign in below, or reload the page in a minute to try again.`));
  if (kind === 'switch' && !takeAttempt(OPEN_SWITCHES_KEY, 'all', OPEN_SWITCHES_MAX)) return Promise.reject(new ApiRequestError(429, 'OPEN_PREVIEW_SWITCHED', `The workspaces of this browser were switched back and forth many times in a minute, so the ${WORKSPACE_TITLE[ws]} is not opened again on its own. Reload the page in a minute to try again.`));
  const p = api.post<Opened>('/auth/open-preview', { workspace: PREVIEW_WORKSPACE[ws] }).finally(() => { delete opening[ws]; });
  opening[ws] = p;
  return p;
}

/* One session for every tab. A browser keeps a single session cookie for this site, so opening a workspace in one tab
   replaces the account of every other tab of the browser; in open preview a visit to another workspace is enough. Each
   tab therefore keeps its own account: the tabs note in local storage (shared by them, unlike session storage) whose
   session the browser holds now, and before a tab sends anything it compares that with its own account. A change (a
   write) is also checked with the server first, for the case the note could not be written. If another account holds
   the session, the tab in use opens its own workspace's account again before the request goes; a tab in the background
   holds its requests until the person comes back to it (then it does the same), so two tabs never take the session from
   each other by themselves. If that reopening fails, the tab says so and offers "Open … here"; nothing is sent as the
   other account. Only while the server says openPreview; the note is never written otherwise. */
const SESSION_MARK_KEY = 'bp.previewSession';
type SessionMark = { uid: string | null; ws: Workspace | null; at: number };
function readMark(): SessionMark | undefined {
  try {
    const m = JSON.parse(window.localStorage.getItem(SESSION_MARK_KEY) || 'null') as SessionMark | null;
    return m && typeof m === 'object' && (typeof m.uid === 'string' || m.uid === null) ? m : undefined;
  } catch { return undefined; }
}
function writeMark(u: User | null): void {
  try { window.localStorage.setItem(SESSION_MARK_KEY, JSON.stringify({ uid: u?.id ?? null, ws: u ? ROLE_WORKSPACE[u.role] ?? null : null, at: Date.now() })); } catch { /* storage blocked: the server is asked instead */ }
}
/** Calls that never wait: the openings and sign-in/out themselves, and the server's settings. */
const UNGATED = ['/auth/open-preview', '/auth/logout', '/auth/login', '/auth/mfa/', '/public/config'];
/** At most this many reads wait in a background tab (see hold). */
const HELD_READS_MAX = 8;
function tabInUse(): boolean { return document.visibilityState === 'visible' && (typeof document.hasFocus !== 'function' || document.hasFocus()); }
function reasonOf(e: unknown, fallback: string): string { return e instanceof Error && e.message ? e.message : fallback; }

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [mfaEnrolmentRequired, setMfaEnrolmentRequired] = useState(false);
  const [openPreview, setOpenPreview] = useState(false);
  const [previewWorkspaces, setPreviewWorkspaces] = useState<readonly PreviewWorkspace[]>(PREVIEW_WORKSPACES);
  const [configChecked, setConfigChecked] = useState(false);
  /** Open preview: this tab could not take its account back from another tab by itself (see "One session for every tab"). */
  const [paused, setPaused] = useState<{ ws: Workspace; reason: string } | null>(null);
  const openPreviewRef = useRef(false);
  const previewWorkspacesRef = useRef<readonly PreviewWorkspace[]>(PREVIEW_WORKSPACES);
  /** whether the open preview opens this workspace (the refs: also right inside callbacks made before the settings came) */
  const opensRef = useCallback((ws: Workspace) => previewOpens(openPreviewRef.current, previewWorkspacesRef.current, ws), []);
  const had = useRef(false);
  const mfaRefused = useRef(false);
  const userRef = useRef<User | null>(null);
  userRef.current = user;
  /** the account the server last reported for the session (GET /auth/me), noted for the other tabs once openPreview is known */
  const serverUser = useRef<User | null>(null);
  const refresh = useCallback(async () => {
    try {
      const r = await api.get<{ user: User; permissions?: string[] }>('/auth/me');
      setUser(r.user); setPermissions(r.permissions ?? []); had.current = true;
      userRef.current = r.user; serverUser.current = r.user;
      if (openPreviewRef.current) writeMark(r.user);
    }
    catch { setUser(null); setPermissions([]); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    // a 401 after a working session means it ended (expiry, sign-out elsewhere, suspension): the sign-in page says so
    setUnauthorisedHandler(() => { if (had.current) setSessionExpired(true); had.current = false; setUser(null); setPermissions([]); });
    // an administrator or owner without two-factor authentication: every route but sign-out refuses the session (GET
    // /auth/me included, so this can happen on the first load), so sign out and send them to the admin sign-in, which
    // explains it; several refused calls arrive at once and the first one ends the session
    setMfaEnrolmentHandler(() => {
      if (mfaRefused.current) return;
      mfaRefused.current = true;
      had.current = false;
      setMfaEnrolmentRequired(true); setSessionExpired(false); setUser(null); setPermissions([]);
      void api.post('/auth/logout').catch(() => { /* the session is refused anyway */ });
    });
    void refresh();
    // asked alongside the session: the pages wait for both, so an open preview never shows a sign-in form first
    let live = true;
    api.get<{ openPreview?: boolean; openPreviewWorkspaces?: unknown }>('/public/config')
      .then((c) => {
        if (!live) return;
        openPreviewRef.current = c?.openPreview === true;
        previewWorkspacesRef.current = previewWorkspacesFrom(c);
        if (openPreviewRef.current && serverUser.current) writeMark(serverUser.current);
        setPreviewWorkspaces(previewWorkspacesRef.current);
        setOpenPreview(openPreviewRef.current);
      }, () => { /* unknown: sign-in as usual */ })
      .finally(() => { if (live) setConfigChecked(true); });
    return () => { live = false; };
  }, [refresh]);
  const signOut = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch { /* already gone */ }
    // open preview: the sign-in page would open the workspace again at once, so sign-out leaves for the website's home page
    // (a full page load, it is not part of the portal). The promise does not settle: the page is being replaced, and
    // neither the workspace guard (which would open the workspace again) nor the caller's next step should run. The
    // sessions ended here were ended on purpose, so they do not count as openings that failed to stay open. A workspace
    // the preview does not open signs out as usual (its sign-in page shows the form), noting it for the other tabs.
    const here = workspaceOf(window.location.pathname);
    if (openPreviewRef.current && (!here || opensRef(here))) { writeMark(null); clearAttempts(); window.location.assign('/'); return new Promise<void>(() => {}); }
    if (openPreviewRef.current) writeMark(null);
    had.current = false; setSessionExpired(false); setMfaEnrolmentRequired(false); setUser(null); setPermissions([]);
  }, [opensRef]);
  const setSession = useCallback((u: User | null, p: string[] = []) => {
    setUser(u); setPermissions(p); had.current = !!u; setSessionExpired(false); if (u) { mfaRefused.current = false; setMfaEnrolmentRequired(false); }
    userRef.current = u;
    if (u && openPreviewRef.current) writeMark(u);
  }, []);
  const openWorkspace = useCallback(async (ws: Workspace, kind: OpenKind = 'fresh') => { const r = await openPreviewSession(ws, kind); setSession(r.user, r.permissions ?? []); return r.user; }, [setSession]);

  /* Open preview: keep this tab's own account (see "One session for every tab" above). */
  const syncing = useRef<Promise<void> | null>(null);
  /** requests held while another tab's account holds the session and this tab is in the background (or paused) */
  const waiting = useRef<Array<{ go: () => void; drop: (e: unknown) => void; read: boolean }>>([]);
  const pausedRef = useRef(false);
  /** opens this tab's workspace again; on failure the tab is paused with the reason (the bar below) and the error goes on */
  const takeBack = useCallback(async (ws: Workspace, kind: OpenKind) => {
    if (!opensRef(ws)) {
      // a workspace the preview does not open was signed in with a password: another tab's account replaced that session
      // in this browser and nothing can open it again from here, so this tab is signed out (its sign-in page says so)
      // and the request is not sent as the other account
      const ended = new ApiRequestError(401, 'SESSION_REPLACED', `Another tab of this browser opened a different workspace, which signed this tab out of the ${WORKSPACE_TITLE[ws]}. Sign in again to continue.`);
      had.current = false; userRef.current = null;
      setSessionExpired(true); setUser(null); setPermissions([]);
      const held = waiting.current; waiting.current = []; held.forEach((x) => x.drop(ended)); // never sent
      throw ended;
    }
    try {
      await openWorkspace(ws, kind);
      pausedRef.current = false; setPaused(null);
    } catch (e) {
      const why = reasonOf(e, 'It could not be opened.');
      pausedRef.current = true;
      setPaused({ ws, reason: `Another tab of this browser opened a different workspace, and this tab could not open the ${WORKSPACE_TITLE[ws]} again by itself. ${why}` });
      throw e;
    }
  }, [openWorkspace, opensRef]);
  const runSync = useCallback((fn: () => Promise<void>): Promise<void> => {
    const p: Promise<void> = fn().finally(() => { if (syncing.current === p) syncing.current = null; });
    syncing.current = p;
    p.catch(() => { /* the waiting requests and the bar report it */ });
    return p;
  }, []);
  const release = useCallback(() => { const w = waiting.current; waiting.current = []; w.forEach((x) => x.go()); }, []);
  const openHere = useCallback((ws: Workspace) => { if (!syncing.current) void runSync(() => takeBack(ws, 'tap')).then(release, () => {}); }, [runSync, takeBack, release]);
  useEffect(() => {
    if (!openPreview) return;
    // the shells ask again every minute, so a tab left in the background keeps only its latest reads waiting; older ones
    // (whose pages have asked again since) are dropped, never sent
    const hold = (read: boolean) => new Promise<void>((go, drop) => {
      waiting.current.push({ go, drop, read });
      const reads = waiting.current.filter((x) => x.read);
      if (reads.length > HELD_READS_MAX) {
        const old = reads[0]!;
        waiting.current = waiting.current.filter((x) => x !== old);
        old.drop(new ApiRequestError(409, 'OPEN_PREVIEW_HELD', 'Not sent: another tab of this browser holds a different workspace, and this tab has asked again since.'));
      }
    });
    /** whether another account than this tab's holds the session: the note first (a sign-out in another tab counts), for a
        change also the server. A session that simply ended is not "taken": that request meets its 401 and the workspace
        guard reopens the workspace under the loop guard, as on any page. */
    const takenFrom = async (me: User, ask: boolean): Promise<boolean> => {
      const mark = readMark();
      if (mark && mark.uid !== me.id) return true;
      if (!ask) return false;
      const id = await sessionUserId();
      return typeof id === 'string' && id !== me.id;
    };
    const ensure = async (method: string): Promise<void> => {
      for (let round = 0; round < 12; round++) {
        if (syncing.current) { await syncing.current.catch(() => {}); continue; }
        const me = userRef.current; const ws = workspaceOf(window.location.pathname);
        if (!me || !ws) return;
        if (pausedRef.current) { await hold(method === 'GET'); continue; }
        if (!(await takenFrom(me, method !== 'GET'))) return;
        if (syncing.current) continue;
        if (!tabInUse()) { await hold(method === 'GET'); continue; }
        await runSync(() => takeBack(ws, 'switch'));   // a failure fails this request: it is never sent as the other account
        return;
      }
      throw new ApiRequestError(409, 'OPEN_PREVIEW_SWITCHED', 'Another tab of this browser holds a different workspace, so this tab did not send that. Reload the page to continue.');
    };
    setBeforeRequest((method, path) => {
      if (UNGATED.some((p) => path.startsWith(p))) return null;
      const me = userRef.current;
      if (!me || !workspaceOf(window.location.pathname)) return null;   // the sign-in pages have no account to keep
      if (method === 'GET' && !syncing.current && !pausedRef.current) { const mark = readMark(); if (!mark || mark.uid === me.id) return null; }
      return ensure(method);
    });
    // a call refused all the same (401/403): if another account holds the session now, take this tab's back and send
    // the call once more; a session that simply ended goes the usual 401 way (the guard, under the loop guard)
    const recover = async (method: string): Promise<boolean> => {
      const waited = !!syncing.current;
      if (syncing.current) await syncing.current.catch(() => {});
      const me = userRef.current; const ws = workspaceOf(window.location.pathname);
      if (!me || !ws || pausedRef.current) return false;
      const id = await sessionUserId();
      if (typeof id !== 'string') return false;
      if (id === me.id) return waited;   // this tab's session (again): worth one more try only if it was just taken back
      if (syncing.current) await syncing.current;
      else if (!tabInUse()) await hold(method === 'GET');
      else await runSync(() => takeBack(ws, 'switch'));
      return !pausedRef.current;
    };
    setAfterRefusal((method, path) => {
      if (UNGATED.some((p) => path.startsWith(p)) || !userRef.current || !workspaceOf(window.location.pathname)) return null;
      return recover(method).catch(() => false);
    });
    // the person comes back to this tab: take its account back now, before anything is clicked
    const onBack = () => {
      if (document.visibilityState !== 'visible' || syncing.current || pausedRef.current) return;
      const me = userRef.current; const ws = workspaceOf(window.location.pathname);
      if (!me || !ws) { release(); return; }
      void runSync(async () => { if (await takenFrom(me, true)) await takeBack(ws, 'switch'); }).then(release, () => {});
    };
    // another tab noted that this tab's account holds the session again: requests held here may go
    const onStorage = (e: StorageEvent) => { if (e.key !== SESSION_MARK_KEY) return; const m = readMark(); if (m && userRef.current && m.uid === userRef.current.id && !pausedRef.current) release(); };
    window.addEventListener('focus', onBack);
    document.addEventListener('visibilitychange', onBack);
    window.addEventListener('storage', onStorage);
    return () => {
      setBeforeRequest(null); setAfterRefusal(null);
      window.removeEventListener('focus', onBack);
      document.removeEventListener('visibilitychange', onBack);
      window.removeEventListener('storage', onStorage);
      release();
    };
  }, [openPreview, runSync, takeBack, release]);

  const ready = !loading && configChecked;
  const value = useMemo<Auth>(() => ({
    user, permissions, loading: !ready, sessionExpired, mfaEnrolmentRequired, refresh, signOut, setSession,
    isPrivileged: user?.role === 'admin' || user?.role === 'owner', isCoach: user?.role === 'coach', isMember: user?.role === 'member',
    can: (p) => user?.role === 'owner' || permissions.includes(p),
    openPreview, previewOpens: (ws: Workspace) => previewOpens(openPreview, previewWorkspaces, ws), openWorkspace,
  }), [user, permissions, ready, sessionExpired, mfaEnrolmentRequired, refresh, signOut, setSession, openPreview, previewWorkspaces, openWorkspace]);
  return <Ctx.Provider value={value}>
    {children}
    {paused && <div data-open-preview="paused" style={{ position: 'fixed', left: '50%', bottom: 20, transform: 'translateX(-50%)', width: 'min(720px, calc(100% - 32px))', zIndex: 'var(--bp-z-toast)', background: 'var(--bp-color-surface-raised)', borderRadius: 'var(--bp-radius-md)', boxShadow: 'var(--bp-shadow-raised)' }}>
      <div className="bp-alert bp-alert-warning" role="alert">
        <AlertIcon kind="warning" />
        <div><b>This tab is paused</b>{paused.reason}<div className="bp-alert-actions"><Button variant="primary" size="sm" onClick={() => openHere(paused.ws)}>Open the {WORKSPACE_TITLE[paused.ws]} here</Button></div></div>
      </div>
    </div>}
  </Ctx.Provider>;
}

export function useAuth(): Auth { return useContext(Ctx); }

export const ROLE_HOME: Record<Role, string> = { member: '/client', coach: '/coach', admin: '/admin', owner: '/admin' };
export const WORKSPACE_LOGIN: Record<Workspace, string> = { client: '/login/client', coach: '/login/coach', admin: '/login/admin' };

/** Route guard for a workspace: no session → that workspace's sign-in page; the wrong role → a clear refusal, never a silent redirect.
    Open preview: no session, or another workspace's account → the workspace's preview account is opened in place. */
export function RequireRole({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const { user, loading, sessionExpired, mfaEnrolmentRequired, openPreview, previewOpens: opens } = useAuth();
  const loc = useLocation();
  const ws = workspaceOf(loc.pathname) ?? 'client';
  if (loading) return <div className="content"><p className="muted">Checking your session…</p></div>;
  // only a workspace the open preview opens (a server may open some only): the others guard as without the preview,
  // except that another workspace's preview account (the browser holds one session for every tab) leads to this
  // workspace's sign-in form rather than to a refusal
  if (opens(ws) && (!user || !roles.includes(user.role))) return <OpenWorkspace ws={ws} roles={roles} />;
  if (openPreview && user && !roles.includes(user.role)) return <Navigate to={WORKSPACE_LOGIN[ws]} state={{ from: loc.pathname + loc.search }} replace />;
  // a session refused for missing two-factor authentication goes to the admin sign-in, which explains it and sets it up;
  // only the admin workspace sends it there, the coach and member guards go to their own sign-in pages as usual
  if (!user && mfaEnrolmentRequired && ws === 'admin') return <Navigate to="/login/admin?mfa=required" state={{ from: loc.pathname + loc.search }} replace />;
  if (!user) return <Navigate to={`${WORKSPACE_LOGIN[ws]}${sessionExpired ? '?expired=1' : ''}`} state={{ from: loc.pathname + loc.search }} replace />;
  if (!roles.includes(user.role)) return <div className="content"><div className="bp-alert bp-alert-warning" role="alert"><AlertIcon kind="warning" /><div><b>Not available for your account</b>This area is for {roles.join(' or ')} accounts. You are signed in as {user.role}. <a href={ROLE_HOME[user.role]}>Go to your workspace</a>.</div></div></div>;
  return <>{children}</>;
}

/** Open preview: opens the workspace's preview account and stays on the page asked for; when that fails, the workspace's
    sign-in page shows its form with the reason (and does not try again by itself). */
function OpenWorkspace({ ws, roles }: { ws: Workspace; roles: Role[] }) {
  const { user, openWorkspace } = useAuth();
  const loc = useLocation();
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    // a tab without an account counts towards the loop guard; one holding another workspace's account is a switch
    openWorkspace(ws, user ? 'switch' : 'fresh').then(
      (u) => { if (live && !roles.includes(u.role)) setFailed(`The ${WORKSPACE_TITLE[ws]} opened an account of another kind (${u.role}).`); },
      (e: unknown) => { if (live) setFailed(e instanceof Error && e.message ? e.message : `The ${WORKSPACE_TITLE[ws]} could not be opened.`); },
    );
    return () => { live = false; };
  }, [ws, openWorkspace]); // eslint-disable-line react-hooks/exhaustive-deps
  if (failed !== null) return <Navigate to={WORKSPACE_LOGIN[ws]} state={{ from: loc.pathname + loc.search, openError: failed }} replace />;
  return <div className="content"><p className="muted" role="status">Opening the {WORKSPACE_TITLE[ws]}…</p></div>;
}

/** Hide (not secure, the server enforces) a part of the admin UI the signed-in administrator has no permission for.
    Several permissions mean all of them are needed (a page whose endpoints are gated differently), unless `any` is set:
    then one of them is enough (a page whose parts each have their own permission and show only what is held). */
export function RequirePermission({ permission, any = false, children }: { permission: string | string[]; any?: boolean; children: React.ReactNode }) {
  const { can } = useAuth();
  const list = ([] as string[]).concat(permission);
  const missing = list.filter((p) => !can(p));
  const refused = any ? missing.length === list.length : missing.length > 0;
  if (refused) return <div className="stack"><div className="bp-alert bp-alert-warning" role="alert"><AlertIcon kind="warning" /><div><b>Permission needed</b>Your administrator account does not hold “{missing.join(any ? '” or “' : '” and “')}”. An owner can grant {any && missing.length > 1 ? 'one of them' : 'it'} under Users and permissions.</div></div></div>;
  return <>{children}</>;
}
