/* Who is signed in, for all three workspaces. One session at a time, whatever the role: a member in the tabs, a coach in
   the coach workspace, an administrator or owner in the administrative portal. The server decides every outcome: the
   workspace sent with the credentials (POST /auth/login) limits which roles may sign in through each screen
   (WRONG_WORKSPACE otherwise), administrators need their authenticator code (MFA_REQUIRED, MFA_INVALID), and the
   permissions an administrator holds come back with the session and from GET /auth/me (owners hold every permission:
   can(p) is true for them, as in the portal's lib/auth.ts).
   Members may also sign in with Google or Apple (POST /auth/social/login): a verified identity with no account yet comes
   back as 409 ACCOUNT_SETUP_NEEDED with a one-time pending token, and the finish step creates the account with the policy
   acceptances. The pending details stay in memory here (never in a route's parameters or the URL).
   The last chosen workspace is remembered on the device (AsyncStorage, no secret in it), so the next cold start opens
   that sign-in directly; the chooser stays one link away. Every sign-in clears the cached copies of the previous
   person's data.
   The client app (the default build, STAFF_APP off in lib/config): only clients sign in. Every signed-out route leads to
   the client sign-in (no chooser), the remembered workspace is neither read nor written, a coach or administrator who
   tries the client sign-in gets CLIENTS_ONLY, and a staff session found on the device (from a staff build) is ended.
   The open preview (GET /public/config → openPreview, only while the server's owner offers a preview account):
   - The client app (STAFF_APP off; BUILD §7.4, owner decision D4): no session opens by itself, on start, on sign-out or
     after a session ended. The member sign-in draws its form as always and, while the server offers the preview, a
     one-tap "Continue without signing in" card; only that tap asks the server for a session (POST /auth/open-preview
     with the member workspace; the server picks the account, nothing about it is in the app).
   - A staff build keeps the earlier behaviour: with no session, the app asks the server for one before its first
     screen; signing out opens a fresh one; when that fails the sign-in screens show the reason and one "Open Bioptime"
     button, never their forms (components/openPreview).
   When the server no longer offers it (404), its settings are read again and the card (or the staff door) goes away.
   The link relay (lib/config findServer, builds made with EXPO_PUBLIC_LINK_RELAY_TOPIC): when no Bioptime server answers
   at the address in use, the relay may know the shared link's new address; moving there ends the session on this
   device first, as the Server screen does, and the app then starts again from the new address. A sign-in whose answer
   arrives after the server in use changed (sent to the old address) keeps nothing: its token belongs to the old server
   and is never sent to the new one (start: the member stays at the sign-in, told to try again).
   A cold start waits for the server at most until the splash's cap (src/fx/brand SplashSting, 9 s): the first contact
   (GET /public/config) has PROBE_MS to answer instead of the usual 20 s, and the app is ready as soon as it fails (no
   answer, or an error page from a link that has gone), or at START_CAP_MS whatever is still running. The sign-in then
   opens with "Service not reached" (flow/auth ServerNoticeFx) while the check goes on in the background: the link
   relay is still asked, and while nothing answers and nobody is signed in the app looks again quietly (RETRY_MS) until
   the server answers; a session still stored on the device then comes back and the sign-in goes on to Home. */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, ApiError, errorText, forgetToken, get, loadToken, post, PREVIEW_GATE, probe, serverUnreachable, setToken, setUnauthorisedHandler, setUnreachableHandler } from './api';
import { apiBaseSync, findServer, findServerFirstStart, LINK_RELAY, loadApiBase, onServerChange, relayFirstStart, STAFF_APP } from './config';
import { clearCache } from './cache';

export type Role = 'member' | 'coach' | 'admin' | 'owner';
/** The three sign-ins. The portal calls the member one 'client'; the API accepts both names. */
export type Workspace = 'member' | 'coach' | 'admin';
export type SocialProvider = 'google' | 'apple' | 'standin';
export type User = { id: string; email: string; name: string; role: Role; state: string; mfaEnabled?: boolean; emailVerified?: boolean };
/** GET /public/config → signIn: which member sign-in providers this server offers. Client and services IDs are public
 *  identifiers (they travel in every ID token), never secrets. `standin` exists only in demo mode. */
export type SignInConfig = { google?: boolean; apple?: boolean; standin?: boolean; googleClientIds?: { web?: string; ios?: string; android?: string }; appleServicesId?: string };
/** openPreview: present (true) only while the server opens sessions without a sign-in (the open preview). */
export type PublicConfig = { available?: boolean; demo: boolean; mode: string; emailDelivered?: boolean; supportEmail: string; termsVersion: string; privacyVersion: string; labVendor: string; payments: string; features?: string[]; signIn?: SignInConfig; openPreview?: boolean };

/** The social sign-in the finish step completes: what the server verified, kept in memory only. */
export type PendingSocial = { provider: SocialProvider; pendingToken: string; email: string; name: string | null };
export type SocialSignInResult = { kind: 'signed_in'; user: User } | { kind: 'setup_needed'; pending: PendingSocial };
/** What the client sends with a provider sign-in: the ID token and the nonce it chose (Google, Apple), or the demo
 *  stand-in's email and name. `name` is only a hint for the finish screen (Apple gives it once, outside the token); it
 *  is not sent, since the server builds the account from what it verified. */
export type SocialPayload = { idToken?: string; nonce?: string; standinEmail?: string; standinName?: string; name?: string | null };
export type SocialConsents = { name: string; marketingConsent: boolean; referralCode?: string };

export const WORKSPACE_OF_ROLE: Record<Role, Workspace> = { member: 'member', coach: 'coach', admin: 'admin', owner: 'admin' };
export const WORKSPACE_HOME: Record<Workspace, string> = { member: '/(tabs)', coach: '/(coach)', admin: '/(admin)' };
export const WORKSPACE_SIGN_IN: Record<Workspace, string> = { member: '/(auth)/sign-in', coach: '/(auth)/coach-sign-in', admin: '/(auth)/admin-sign-in' };
export const CHOOSER = '/(auth)/choose';
export const WORKSPACE_LABEL: Record<Workspace, string> = { member: 'member sign-in', coach: 'coach workspace', admin: 'administrative portal' };
/** Where a signed-in person's workspace starts. */
export function homeFor(role: Role): string { return WORKSPACE_HOME[WORKSPACE_OF_ROLE[role]]; }
/** The client sign-in: where the client app (STAFF_APP off) sends every signed-out visitor. */
export const CLIENT_SIGN_IN = WORKSPACE_SIGN_IN.member;
/** Where a signed-out visitor goes: the sign-in they chose last time, else the chooser; in the client app, always the
 *  client sign-in. */
export function signInFor(workspace: Workspace | null): string {
  if (!STAFF_APP) return CLIENT_SIGN_IN;
  return workspace ? WORKSPACE_SIGN_IN[workspace] : CHOOSER;
}
/** What the client app says when a coach or administrator signs in on it (the server's WRONG_WORKSPACE). The addresses
 *  are plain text, not links. */
export const CLIENTS_ONLY = 'This app is for Bioptime clients. Coaches sign in at bioptime.com/coach and the Bioptime team at bioptime.com/admin.';

const WORKSPACE_KEY = 'bp.workspace';
const SOCIAL_LOGIN_PATH = '/auth/social/login';
/** The finish step posts the pending token and the acceptances to the same route (the API group's design). */
const SOCIAL_FINISH_PATH = '/auth/social/login';
const OPEN_PREVIEW_PATH = '/auth/open-preview';
const WORKSPACES: Workspace[] = ['member', 'coach', 'admin'];
/** At most one automatic retry after a request found no server, every so often (link relay builds only). */
const RECHECK_MS = 20000;
/** The cold start's first contact with the server (GET /public/config, and the quiet looks while nothing answers): how
 *  long it may wait for an answer before the server counts as not reached. Every other request keeps api.ts's 20 s. */
const PROBE_MS = 6000;
/** The latest the app waits for the session check at a cold start, from its own start; the splash, which starts a
 *  moment later, holds at most 9 s (src/fx/brand SplashSting CAP_MS), so it always has its answer before its cap. */
const START_CAP_MS = 8500;
/** While nothing answers and nobody is signed in: look again after 3, 5 and 8 s, then every 15 s. */
const RETRY_MS = [3000, 5000, 8000, 15000];

/** A sign-in answered after the server in use had changed (the link relay's move, Server): nothing of it is kept. */
export const SERVER_MOVED = 'SERVER_MOVED';
/** The address a sign-in request goes to, taken before it is sent; checked again before its token is kept. */
export const signInServer = (): string => apiBaseSync();
/** Throws SERVER_MOVED when the server in use is no longer the one `from` names: a session minted by one server is never
 *  sent to another. */
export function keepSessionFrom(from: string): void {
  if (apiBaseSync() !== from) throw new ApiError(421, { error: { code: SERVER_MOVED, message: 'The Bioptime service moved to a new address while you were signing in, so nothing was kept. Try again.' } });
}

/** What the app says when the open preview could not open a session. */
export function openPreviewFailure(e: unknown): string {
  if (e instanceof ApiError && e.code === 'RATE_LIMITED') return 'Too many attempts. Wait a few minutes and try again.';
  if (e instanceof ApiError && e.offline) return 'The Bioptime service could not be reached. Check your connection and try again.';
  return errorText(e);
}

type Session = { user: User; permissions?: string[]; session?: { token?: string } };

type Auth = {
  user: User | null;
  /** The administrator's granted permissions (apps/api/src/auth/permissions.ts); empty for members and coaches. */
  permissions: string[];
  /** The portal's rule: owners hold everything, administrators what they were granted. Hiding is a courtesy; the server
   *  enforces every permission again. */
  can: (permission: string) => boolean;
  ready: boolean;
  /** true after the server ended this device's session (expired, revoked or signed out elsewhere: a 401 on a live token),
   *  until the person signs in again; the sign-in screens say so. A sign-out the person chose leaves it false. */
  sessionEnded: boolean;
  config: PublicConfig | null;
  offline: boolean;
  /** The server answered, but a preview password in front of it (the shared demo link's gate) refused the app: the
   *  message to show, until the tester enters the preview login under Server (testers). Null otherwise. */
  previewLocked: string | null;
  /** The sign-in chosen last time on this device, or null before any choice. */
  lastWorkspace: Workspace | null;
  /** true from a sign-out the person chose until the app reaches a public route: the screen that asked for it decides
   *  where to go (the chooser, the member sign-in), so the root guard stands back for that one step. */
  chosenSignOut: boolean;
  /** true when the session stored on this device came back after the app had opened without it (the server was not
   *  reached at the start and answered later): the sign-in goes on to Home by itself. False again once signed out. */
  resumed: boolean;
  rememberWorkspace: (workspace: Workspace) => Promise<void>;
  refresh: () => Promise<void>;
  signIn: (email: string, password: string, workspace: Workspace, mfaCode?: string) => Promise<User>;
  register: (input: { name: string; email: string; password: string; phone?: string; referralCode?: string; marketing: boolean }) => Promise<{ user: User; demoToken?: string }>;
  /** Sign in with a provider's proof (an ID token, or the demo stand-in's email). Signed in, or an account still to be
   *  created from the verified identity (the finish screen reads `pendingSocial`). Other failures throw ApiError. */
  socialSignIn: (provider: SocialProvider, payload: SocialPayload) => Promise<SocialSignInResult>;
  /** The social sign-in awaiting its account, for the finish screen; cleared once finished or on sign-out. */
  pendingSocial: PendingSocial | null;
  finishSocialSignUp: (pendingToken: string, consents: SocialConsents) => Promise<User>;
  /** The open preview: a session for the workspace, opened by the server without a sign-in. Throws ApiError (404 when
   *  the server does not offer it, after reading its settings again). */
  openPreview: (workspace: Workspace) => Promise<User>;
  /** Why the open preview could not open a session the last time the app tried by itself (on start or sign-out; a staff
   *  build only); the sign-in screens show it with a way to try again instead of trying again on their own. Null
   *  otherwise, and always null in the client app, which never tries by itself. */
  previewError: string | null;
  /** Ends the session. In a staff build's open preview a fresh session is opened at once and returned (the caller goes
   *  to its home); otherwise (always in the client app), or when that fails, null (the caller goes to a sign-in). */
  signOut: () => Promise<User | null>;
  setUser: (u: User | null) => void;
  /** A session that arrived through another route (the phone code): the user and the permissions it came with. */
  setSession: (u: User, permissions?: string[]) => void;
};

const notReady = async () => { throw new Error('not ready'); };
const Ctx = createContext<Auth>({ user: null, permissions: [], can: () => false, ready: false, sessionEnded: false, config: null, offline: false, previewLocked: null, lastWorkspace: null, chosenSignOut: false, resumed: false, rememberWorkspace: async () => {}, refresh: async () => {}, signIn: notReady, register: notReady, socialSignIn: notReady, pendingSocial: null, finishSocialSignUp: notReady, openPreview: notReady, previewError: null, signOut: async () => null, setUser: () => {}, setSession: () => {} });

function isWorkspace(v: unknown): v is Workspace { return typeof v === 'string' && (WORKSPACES as string[]).includes(v); }

/** The mounted provider's handler for a request that found no server (api.ts holds one). Android's activity swap mounts
 *  the next provider before this one goes (src/fx/nav/rootRouter), so a provider that goes clears it only while it is
 *  still its own. Plain functions out here, outside what the React Compiler rewrites. */
let liveUnreachable: (() => void) | null = null;
function holdUnreachable(fn: () => void): void { setUnreachableHandler(fn); liveUnreachable = fn; }
function releaseUnreachable(fn: () => void): void { if (liveUnreachable === fn) { setUnreachableHandler(null); liveUnreachable = null; } }

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [offline, setOffline] = useState(false);
  const [previewLocked, setPreviewLocked] = useState<string | null>(null);
  const [lastWorkspace, setLastWorkspace] = useState<Workspace | null>(null);
  const [chosenSignOut, setChosenSignOut] = useState(false);
  const [pendingSocial, setPendingSocial] = useState<PendingSocial | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [resumed, setResumed] = useState(false);
  const readyRef = useRef(false);
  readyRef.current = ready;
  const configRef = useRef<PublicConfig | null>(null);
  configRef.current = config;
  const pendingRef = useRef<PendingSocial | null>(null);
  pendingRef.current = pendingSocial;
  const userRef = useRef<User | null>(null);
  userRef.current = user;
  const lastWorkspaceRef = useRef<Workspace | null>(null);
  lastWorkspaceRef.current = lastWorkspace;
  const opening = useRef<Promise<User> | null>(null);   // one open-preview request at a time
  const refreshing = useRef(0);
  const refreshStarted = useRef(0);
  const lastRecheck = useRef(0);
  const refreshRef = useRef<(probeMs?: number) => Promise<void>>(async () => {});
  const configReads = useRef(0);
  /** What the newest settings read found: nothing yet, an answer, the preview password's refusal, or no server. */
  const lastRead = useRef<'none' | 'answered' | 'gate' | 'unreached'>('none');
  /** At a cold start: told as soon as a settings read finds no server, so the splash need not wait any longer. */
  const onUnreached = useRef<(() => void) | null>(null);

  const setUser = useCallback((u: User | null) => { if (u) setSessionEnded(false); else setPermissions([]); setUserState(u); }, []);
  const setSession = useCallback((u: User, p: string[] = []) => { setSessionEnded(false); setChosenSignOut(false); setPermissions(p); setUserState(u); setPendingSocial(null); }, []);

  /** A new session: never show one person the last-good copies of another. `from`: the server the request went to
   *  (signInServer); when the server in use changed since, nothing is kept (keepSessionFrom). */
  const start = useCallback(async (r: Session, from: string) => {
    await clearCache();
    keepSessionFrom(from); // checked after the last wait, just before the token is kept
    if (r.session?.token) await setToken(r.session.token);
    setSession(r.user, r.permissions ?? []);
    return r.user;
  }, [setSession]);

  const rememberWorkspace = useCallback(async (workspace: Workspace) => {
    if (!STAFF_APP) return; // the client app has one sign-in: nothing to remember
    setLastWorkspace(workspace);
    try { await AsyncStorage.setItem(WORKSPACE_KEY, workspace); } catch { /* remembered for this run only */ }
  }, []);

  /** GET /public/config. Throws what stopped it, after noting it: the preview password in front of the server refused
   *  the app; anything else (no answer, or an error page from a link whose tunnel or server is down, or a lockout)
   *  means the server cannot be used from here: "not reached". `probeMs`: the reachability probe's shorter wait. */
  const readConfig = useCallback(async (probeMs?: number): Promise<PublicConfig> => {
    const n = ++configReads.current; // the newest read wins (a server change starts one while another may be running)
    try {
      const c = probeMs ? await probe<PublicConfig>('/public/config', probeMs) : await get<PublicConfig>('/public/config');
      if (n === configReads.current) { setConfig(c); setOffline(false); setPreviewLocked(null); lastRead.current = 'answered'; }
      return c;
    } catch (e) {
      if (n === configReads.current) {
        if (e instanceof ApiError && e.code === PREVIEW_GATE) { setOffline(false); setPreviewLocked(e.message); lastRead.current = 'gate'; }
        else { setOffline(true); setPreviewLocked(null); lastRead.current = 'unreached'; onUnreached.current?.(); }
      }
      throw e;
    }
  }, []);

  // another server (typed under Server, Reset, the link relay's new address, a preview login saved): the old server's
  // settings (sign-in providers, the open preview, the phone sign-in switch through lib/features) no longer apply.
  // Forget them and read the new server's at once, so the sign-in shows what it offers without a restart.
  useEffect(() => onServerChange(() => {
    setConfig(null); setOffline(false); setPreviewLocked(null);
    void readConfig().catch(() => { /* noted by readConfig */ });
  }), [readConfig]);

  const openPreview = useCallback((workspace: Workspace): Promise<User> => {
    opening.current ??= (async () => {
      setPreviewError(null); // a new attempt: the reason shown for the last one no longer applies
      try {
        const from = signInServer();
        const r = await post<Session>(OPEN_PREVIEW_PATH, { workspace });
        const u = await start(r, from);
        void rememberWorkspace(workspace);
        setPreviewError(null);
        return u;
      } catch (e) {
        // the server no longer opens sessions without a sign-in: its settings again, so the sign-in forms come back
        if (e instanceof ApiError && e.status === 404) { try { await readConfig(); } catch { /* noted by readConfig */ } }
        throw e;
      } finally {
        opening.current = null;
      }
    })();
    return opening.current;
  }, [start, rememberWorkspace, readConfig]);

  /** Nobody is signed in on this device: the sign-in screens take over. In the client app that is all (its sign-in
   *  offers the open preview as a one-tap card); a staff build's open preview has the server open a session of the
   *  workspace chosen last time instead. */
  const nobodySignedIn = useCallback(async (c: PublicConfig | null) => {
    if (STAFF_APP && c?.openPreview) {
      try { await openPreview(lastWorkspaceRef.current ?? 'member'); return; }
      catch (e) { if (!(e instanceof ApiError && e.status === 404)) setPreviewError(openPreviewFailure(e)); }
    }
    setUser(null);
  }, [openPreview, setUser]);

  /** The link relay moved the app to a new address: the session token stays behind (it is never sent to another
   *  address), with the saved copies of the data. At a cold start nothing has read the stored token yet, so forgetToken
   *  reads it before it decides and always deletes it: a token stored by an earlier run never reaches the new address. */
  const leaveOldServer = useCallback(async () => {
    const had = await forgetToken();
    if (!had && !userRef.current) return;
    await clearCache();
    setSessionEnded(true); setPermissions([]); setPendingSocial(null); setUserState(null);
  }, []);

  /** The server's settings, then the session stored on this device. `probeMs`: the reachability probe (the cold start,
   *  the quiet looks while nothing answers) waits that long for the settings instead of the usual 20 s. */
  const checkSession = useCallback(async (probeMs?: number) => {
    refreshing.current++;
    refreshStarted.current = Date.now();
    try {
      let c: PublicConfig | null = null;
      let failure: unknown = null;
      try { c = await readConfig(probeMs); } catch (e) { failure = e; }
      // no Bioptime server at the address in use: a build that reads the link relay asks it for the link's new address
      if (failure && LINK_RELAY && serverUnreachable(failure) && await findServer(false, leaveOldServer)) {
        await leaveOldServer(); // already done when this refresh's own read moved the app; not when another caller's did
        failure = null;
        try { c = await readConfig(probeMs); } catch (e) { failure = e; }
      }
      const t = await loadToken();
      if (!t) { await nobodySignedIn(c); return; }
      // nothing answers at the address in use: the stored session waits for it (asking for it would wait on the same
      // silence); the person stays as they were (signed in, or at the sign-in, which says the server was not reached)
      if (!c && serverUnreachable(failure)) return;
      try {
        const r = await get<{ user: User; permissions?: string[] }>('/auth/me');
        if (!STAFF_APP && r.user.role !== 'member') {
          // the client app never continues a coach's or an administrator's session (one left on the device by a staff build)
          try { await api('POST', '/auth/logout', {}); } catch { /* already gone */ }
          await setToken(null); await clearCache(); setOffline(false);
          await nobodySignedIn(c);
          return;
        }
        // the app opened without it (the server was not reached in time) and it answered since: the sign-in goes Home
        if (readyRef.current && !userRef.current) setResumed(true);
        setSession(r.user, r.permissions ?? []); setOffline(false);
      }
      catch (e) { if (e instanceof ApiError && e.status === 401) await nobodySignedIn(c); else if (e instanceof ApiError && e.offline) setOffline(true); }
    } finally {
      refreshing.current--;
    }
  }, [setSession, readConfig, leaveOldServer, nobodySignedIn]);
  refreshRef.current = checkSession;
  const refresh = useCallback(() => checkSession(), [checkSession]);

  useEffect(() => {
    // a dead session (api.ts has already dropped the token and the saved copies): the root layout's guard takes the
    // person to their sign-in, which explains what happened (and offers the preview card in the client app; in a staff
    // build's open preview, that screen opens a new session)
    setUnauthorisedHandler(() => { setSessionEnded(true); setPermissions([]); setUserState(null); });
    // a request found no server at the address in use: in a build that reads the link relay, look again a moment later,
    // unless a refresh has started meanwhile (it looks for itself), and not more than once every 20 seconds
    const unreachable = () => {
      if (!LINK_RELAY || refreshing.current) return; // a refresh that is running looks for itself
      const at = Date.now();
      setTimeout(() => {
        if (refreshing.current || refreshStarted.current >= at || Date.now() - lastRecheck.current < RECHECK_MS) return;
        lastRecheck.current = Date.now();
        void refreshRef.current();
      }, 1500);
    };
    holdUnreachable(unreachable);
    let capTimer: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      const started = Date.now();
      await loadApiBase();
      if (STAFF_APP) { try { const w = await AsyncStorage.getItem(WORKSPACE_KEY); if (isWorkspace(w)) { setLastWorkspace(w); lastWorkspaceRef.current = w; } } catch { /* no memory of a choice */ } }
      const boot = (async () => {
        // the first start of a build that reads the link relay: the link's newest address before the built-in one,
        // unless the built-in one answers first (a relay that is slow or silent no longer holds the splash, FU-m3)
        if (relayFirstStart()) await findServerFirstStart(leaveOldServer);
        await checkSession(PROBE_MS);
      })().catch(() => { /* each step notes its own failure */ });
      // ready once the check is done, as soon as the server is found missing, or at the cap, whichever comes first; the
      // check goes on in the background (the link relay, then the stored session) and the sign-in follows what it finds
      const unreached = new Promise<void>((resolve) => { onUnreached.current = resolve; });
      const cap = new Promise<void>((resolve) => { capTimer = setTimeout(resolve, Math.max(0, START_CAP_MS - (Date.now() - started))); });
      await Promise.race([boot, unreached, cap]);
      onUnreached.current = null;
      if (capTimer) clearTimeout(capTimer);
      // nothing has answered yet: the sign-in says the server was not reached (until it answers)
      if (lastRead.current === 'none') setOffline(true);
      setReady(true);
    })();
    return () => { releaseUnreachable(unreachable); onUnreached.current = null; if (capTimer) clearTimeout(capTimer); };
  }, [checkSession, leaveOldServer]);

  // the app opened without its server (nothing answered in time, or it stopped answering while nobody is signed in):
  // look again quietly, after 3, 5 and 8 s and then every 15 s, until it answers. Each look is a whole check: the
  // server's settings (the sign-in's notice goes once they come), the link relay's newest address in a build that reads
  // one (lib/config findServer moves the app there), and the session still stored on this device.
  useEffect(() => {
    if (!ready || user || !offline) return;
    let live = true;
    let n = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const look = () => {
      timer = setTimeout(async () => {
        if (!live) return;
        if (!refreshing.current) { try { await refreshRef.current(PROBE_MS); } catch { /* the next look */ } }
        n += 1;
        if (live) look();
      }, RETRY_MS[Math.min(n, RETRY_MS.length - 1)]);
    };
    look();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [ready, user, offline]);

  // signed out again: a later session is not one that came back by itself
  useEffect(() => { if (!user) setResumed(false); }, [user]);

  const signIn = useCallback(async (email: string, password: string, workspace: Workspace, mfaCode?: string) => {
    const body: Record<string, unknown> = { email, password, workspace };
    if (mfaCode) body.mfaCode = mfaCode;
    const from = signInServer();
    const r = await post<Session>('/auth/login', body);
    const u = await start(r, from);
    void rememberWorkspace(workspace);
    return u;
  }, [start, rememberWorkspace]);

  const register = useCallback(async (input: { name: string; email: string; password: string; phone?: string; referralCode?: string; marketing: boolean }) => {
    const body: Record<string, unknown> = { name: input.name, email: input.email, password: input.password, acceptTerms: true, acceptPrivacy: true, termsVersion: configRef.current?.termsVersion ?? '2026-10-17', marketingConsent: input.marketing };
    if (input.phone) body.phone = input.phone;
    // a friend's referral code, if one was typed: the server ignores a code that does not qualify, so it never stops a registration
    if (input.referralCode?.trim()) body.referralCode = input.referralCode.trim();
    const from = signInServer();
    const r = await post<Session & { verification?: { demoToken?: string } }>('/auth/register', body);
    const user = await start(r, from);
    void rememberWorkspace('member');
    return { user, demoToken: r.verification?.demoToken };
  }, [start, rememberWorkspace]);

  const socialSignIn = useCallback(async (provider: SocialProvider, payload: SocialPayload): Promise<SocialSignInResult> => {
    const { name: nameHint, ...proof } = payload;
    try {
      const from = signInServer();
      const r = await post<Session>(SOCIAL_LOGIN_PATH, { provider, ...proof });
      const u = await start(r, from);
      void rememberWorkspace('member');
      return { kind: 'signed_in', user: u };
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.code === 'ACCOUNT_SETUP_NEEDED') {
        const d = (e.details ?? {}) as { pendingToken?: unknown; email?: unknown; name?: unknown };
        if (typeof d.pendingToken === 'string' && typeof d.email === 'string') {
          const pending: PendingSocial = { provider, pendingToken: d.pendingToken, email: d.email, name: typeof d.name === 'string' && d.name.trim() ? d.name.trim() : nameHint?.trim() || null };
          setPendingSocial(pending);
          return { kind: 'setup_needed', pending };
        }
      }
      throw e;
    }
  }, [start, rememberWorkspace]);

  const finishSocialSignUp = useCallback(async (pendingToken: string, consents: SocialConsents) => {
    const body: Record<string, unknown> = { provider: pendingRef.current?.provider ?? 'standin', pendingToken, name: consents.name, acceptTerms: true, acceptPrivacy: true, termsVersion: configRef.current?.termsVersion ?? '2026-10-17', marketingConsent: consents.marketingConsent };
    if (consents.referralCode?.trim()) body.referralCode = consents.referralCode.trim();
    const from = signInServer();
    const r = await post<Session>(SOCIAL_FINISH_PATH, body);
    const u = await start(r, from);
    void rememberWorkspace('member');
    return u;
  }, [start, rememberWorkspace]);

  const signOut = useCallback(async (): Promise<User | null> => {
    const was = userRef.current;
    try { await api('POST', '/auth/logout', {}); } catch { /* already gone */ }
    await setToken(null);
    await clearCache();
    setSessionEnded(false); // the person chose to leave: nothing to explain on the sign-in screen
    setPendingSocial(null);
    // a staff build's open preview: a fresh session of the same workspace replaces the one that ended and the caller
    // goes to its home; when that fails, a plain sign-out (the sign-in screen says why, with one button to try again
    // and no form). The client app always signs out plainly: its sign-in offers the preview as a one-tap card.
    if (STAFF_APP && configRef.current?.openPreview) {
      try { return await openPreview(was ? WORKSPACE_OF_ROLE[was.role] : 'member'); }
      catch (e) { if (!(e instanceof ApiError && e.status === 404)) setPreviewError(openPreviewFailure(e)); }
    }
    setChosenSignOut(true); // the caller picks the next screen; the guard lets it (and resets this on the public route)
    setUser(null);
    return null;
  }, [setUser, openPreview]);

  // the step after a chosen sign-out has been taken (a public route is showing): the guard is back on duty
  useEffect(() => { if (chosenSignOut && !user) { const t = setTimeout(() => setChosenSignOut(false), 1500); return () => clearTimeout(t); } }, [chosenSignOut, user]);

  const can = useCallback((p: string) => user?.role === 'owner' || permissions.includes(p), [user, permissions]);

  const value = useMemo<Auth>(() => ({ user, permissions, can, ready, sessionEnded, config, offline, previewLocked, lastWorkspace, chosenSignOut, resumed, rememberWorkspace, refresh, signIn, register, socialSignIn, pendingSocial, finishSocialSignUp, openPreview, previewError, signOut, setUser, setSession }), [user, permissions, can, ready, sessionEnded, config, offline, previewLocked, lastWorkspace, chosenSignOut, resumed, rememberWorkspace, refresh, signIn, register, socialSignIn, pendingSocial, finishSocialSignUp, openPreview, previewError, signOut, setUser, setSession]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The sign-in screens' check before anything is sent: the Email field holds an email address. A phone's password manager
 *  can offer the shared link's preview login (saved from the Server screen) here, which is not an account. */
export const NOT_AN_EMAIL = 'That is not an email address. Sign in with the email of your Bioptime account; the preview username from the Server screen is not an account.';
export function looksLikeEmail(v: string): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()); }
/** The server's own refusal of the Email field (VALIDATION_FAILED on email) reads the same. */
export function isEmailRefusal(e: unknown): boolean { return e instanceof ApiError && e.code === 'VALIDATION_FAILED' && 'email' in e.fieldErrors(); }

export function useAuth(): Auth { return useContext(Ctx); }
