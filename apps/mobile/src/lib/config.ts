/* Where the API lives. Order: a server the tester typed in the app (Me > Server), the address the link relay found
   (builds made with EXPO_PUBLIC_LINK_RELAY_TOPIC, below), the EXPO_PUBLIC_API_BASE baked into the build, then a sensible
   default for the simulator or emulator. Never a hardcoded production address, never a secret. */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { isQuickTunnel, readRelayLink, relaySettings } from './linkRelay';

const OVERRIDE_KEY = 'bp_api_base';
let override: string | null | undefined;
const RELAY_KEY = 'bp_relay_base';
let relayBase: string | null | undefined;
/** Set once the relay was asked and gave no address: the next cold start begins with the build's own address instead of
 *  waiting for the relay first (the relay is still read as soon as that address does not answer). */
const RELAY_ASKED_KEY = 'bp_relay_asked';
type GateCredentials = { origin: string; user: string; value: string }; // value: the X-Bioptime-Gate header (see below)
let gate: GateCredentials | null | undefined;

/** Testers may point the app at another server only in development builds or builds made with EXPO_PUBLIC_ALLOW_SERVER_OVERRIDE=1
 *  (the demo APK). A store build ignores any stored override, so a typed address can never redirect a real member's session. */
export const SERVER_OVERRIDE_ALLOWED: boolean = __DEV__ || process.env.EXPO_PUBLIC_ALLOW_SERVER_OVERRIDE === '1';

/** The app is for Bioptime clients. The coach and administrator doors (the "Three doors" chooser, the coach and
 *  administrator sign-ins, the coach workspace and the administrative portal) are kept in the code, but they open only
 *  in builds made with EXPO_PUBLIC_STAFF_APP=1. Off by default: the app opens on the client sign-in and no staff
 *  screen renders (components/staffGate); coaches use bioptime.com/coach and the Bioptime team bioptime.com/admin. */
export const STAFF_APP: boolean = process.env.EXPO_PUBLIC_STAFF_APP === '1';

export function defaultApiBase(): string {
  const env = process.env.EXPO_PUBLIC_API_BASE;
  if (env && env.trim()) return env.trim().replace(/\/+$/, '');
  // a development build's local server; a release build always carries its API base (its build sets it), so these
  // local addresses are left out of it (AUD-4)
  if (__DEV__) {
    if (Platform.OS === 'android') return 'http://10.0.2.2:3000'; // the emulator's alias for the host machine
    return 'http://localhost:3000';
  }
  return '';
}

export async function loadApiBase(): Promise<string> {
  if (LINK_RELAY && relayBase === undefined) {
    let stored: string | null = null;
    let asked: string | null = null;
    try { stored = await SecureStore.getItemAsync(RELAY_KEY); } catch { stored = null; }
    try { asked = await SecureStore.getItemAsync(RELAY_ASKED_KEY); } catch { asked = null; }
    if (asked === '1') relayAsked = true;
    if (relayBase === undefined) relayBase = isQuickTunnel(stored) ? stored : null; // a value found meanwhile wins
  }
  if (!SERVER_OVERRIDE_ALLOWED) { override = null; gate = null; return apiBaseSync(); }
  if (override === undefined) {
    try { override = await SecureStore.getItemAsync(OVERRIDE_KEY); } catch { override = null; }
  }
  if (gate === undefined) await loadGate();
  return apiBaseSync();
}

export function apiBaseSync(): string { return (SERVER_OVERRIDE_ALLOWED && override) || (LINK_RELAY && relayBase) || defaultApiBase(); }

/* The server in use changed (an address typed under Server, Reset, the link relay's new address, or a preview login
   saved for it): what the app learnt from the old one (its public settings, the feature flags) no longer applies, so
   lib/auth reads the settings again and lib/features the flags, without a restart. */
let serverEpochN = 0;
const serverListeners = new Set<() => void>();
/** Increases each time the server in use (or its preview login) changes. */
export function serverEpoch(): number { return serverEpochN; }
/** Calls `listener` after each change of the server in use; returns the unsubscribe. */
export function onServerChange(listener: () => void): () => void {
  serverListeners.add(listener);
  return () => { serverListeners.delete(listener); };
}
function serverChanged(): void {
  serverEpochN += 1;
  serverListeners.forEach((l) => { try { l(); } catch { /* one listener does not stop the others */ } });
}

/** The address typed under Server (testers), or null to go back to the build's own. Reset (null) also forgets the
 *  address the link relay found, so the app starts again from the build's address and asks the relay when that fails. */
export async function setApiBaseOverride(value: string | null): Promise<void> {
  if (!SERVER_OVERRIDE_ALLOWED) return;
  const v = value && value.trim() ? value.trim().replace(/\/+$/, '') : null;
  const before = apiBaseSync();
  override = v;
  try { if (v) await SecureStore.setItemAsync(OVERRIDE_KEY, v); else await SecureStore.deleteItemAsync(OVERRIDE_KEY); } catch { /* keep the in-memory value */ }
  if (!v) { await setRelayBase(null); await rememberRelayAsked(false); }
  if (apiBaseSync() !== before) serverChanged();
}

/* The link relay (lib/linkRelay). A build made with EXPO_PUBLIC_LINK_RELAY_TOPIC finds the shared link's current address
   itself: it keeps using the address that works; when that does not answer (no answer at all, or an error page such as
   Cloudflare's 530 for a tunnel that has gone), or on the first start, it reads the newest quick-tunnel address from the
   relay, checks that it answers, uses it and remembers it on the device. An address typed under Server stays the
   tester's choice: the relay replaces it only when it is itself a quick-tunnel address that stopped answering. Without
   the variable nothing here runs and the app behaves as before. EXPO_PUBLIC_LINK_RELAY_BASE (default https://ntfy.sh)
   points checks on this machine at a stand-in relay.
   Tester builds only: the relay is read only where testers may change the server (SERVER_OVERRIDE_ALLOWED: development
   builds and the demo APK built with EXPO_PUBLIC_ALLOW_SERVER_OVERRIDE=1). A store build ignores the topic even when it
   was set in the shell that built it, so no message on the relay can ever move a real member's app to another server.
   What the relay does not protect against: the topic is compiled into the build, so anyone holding the APK can read it
   and post a quick-tunnel address of their own; installs reading the relay at that moment (a first start, or a link that
   stopped answering) would then use that server. Share the APK privately; a new topic means a new APK. */
const RELAY = SERVER_OVERRIDE_ALLOWED ? relaySettings(process.env.EXPO_PUBLIC_LINK_RELAY_TOPIC, process.env.EXPO_PUBLIC_LINK_RELAY_BASE) : null;
/** true when this build reads the link relay (a tester build made with EXPO_PUBLIC_LINK_RELAY_TOPIC). */
export const LINK_RELAY: boolean = RELAY !== null;
/** Where the address in use came from, for the Server screen. */
export function apiBaseSource(): 'typed' | 'relay' | 'build' {
  if (SERVER_OVERRIDE_ALLOWED && override) return 'typed';
  if (LINK_RELAY && relayBase) return 'relay';
  return 'build';
}

async function setRelayBase(value: string | null): Promise<void> {
  const before = apiBaseSync();
  relayBase = value;
  if (apiBaseSync() !== before) serverChanged();
  try { if (value) await SecureStore.setItemAsync(RELAY_KEY, value); else await SecureStore.deleteItemAsync(RELAY_KEY); } catch { /* keep the in-memory value */ }
}

async function rememberRelayAsked(asked: boolean): Promise<void> {
  try { if (asked) await SecureStore.setItemAsync(RELAY_ASKED_KEY, '1'); else await SecureStore.deleteItemAsync(RELAY_ASKED_KEY); } catch { /* this run only */ }
}

/** Whether a Bioptime server answers at `base`: its public settings, or the refusal of a preview password in front of it
 *  (the server is there; the tester enters that password under Server). No session token is sent. */
async function answers(base: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(`${base}/api/public/config`, { headers: { Accept: 'application/json', 'X-Bioptime-Client': CLIENT_HEADER }, signal: ctrl.signal });
    if (res.status === 401 && /^basic\b/i.test(res.headers.get('www-authenticate') ?? '')) return true;
    const body = await res.text();
    let json: unknown = null;
    try { json = body ? JSON.parse(body) : null; } catch { json = null; }
    if (res.status === 401) return (json as { error?: { code?: string } } | null)?.error?.code === 'GATE_CREDENTIALS';
    return res.ok && !!json && typeof json === 'object' && typeof (json as { mode?: unknown }).mode === 'string';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

let finding: Promise<boolean> | null = null;
let lastRelayRead = 0;
let relayAsked = false;
const RELAY_PAUSE_MS = 20000;

/** True before the relay was ever asked on this device (or since Reset) and while nothing is remembered: the first
 *  start of a relay build. */
export function relayFirstStart(): boolean {
  return LINK_RELAY && !relayAsked && !relayBase && !(SERVER_OVERRIDE_ALLOWED && override);
}

/** Asks the link relay for the shared link's current address and moves the app there when it is new and answers.
 *  Resolves true when the address in use changed and false otherwise (no relay in this build, an address typed under
 *  Server that is not a quick tunnel, nothing new on the relay, the new address does not answer either, or the address
 *  in use changed while the relay was read: a server typed under Server, Reset). `leave` runs after the new address
 *  answered and before the app switches to it: the caller drops the session there, so a session token is never sent to
 *  a new address (as on the Server screen). `stay`, asked once the new address answered: true when the app went on at
 *  the address in use meanwhile (findServerFirstStart), so a session may have opened there; nothing moves then while
 *  that address still answers (the relay is read again once it stops: lib/auth's unreachable path). One read at a
 *  time, and at most one every 20 seconds unless `now`. */
export function findServer(now = false, leave?: () => Promise<void>, stay?: () => boolean): Promise<boolean> {
  if (!RELAY) return Promise.resolve(false);
  if (finding) return finding;
  if (!now && Date.now() - lastRelayRead < RELAY_PAUSE_MS) return Promise.resolve(false);
  const relay = RELAY;
  finding = (async () => {
    try {
      await loadApiBase();
      const typed = SERVER_OVERRIDE_ALLOWED && override ? override : null;
      if (typed && !isQuickTunnel(typed)) return false; // the tester's own server (a Mac on the Wi-Fi): theirs to change
      const from = apiBaseSync(); // the address in use as the read begins
      relayAsked = true;
      lastRelayRead = Date.now();
      const found = await readRelayLink(relay);
      if (!found) { await rememberRelayAsked(true); return false; } // nothing there: next time the build's address first
      if (found === apiBaseSync()) { if (apiBaseSource() === 'build') await setRelayBase(found); return false; } // the same address: remembered, nothing moves
      if (!(await answers(found))) return false;
      // the app went on at the address in use (a first start whose built-in address answered first): a session opened
      // there meanwhile is not dropped for a move while that address still answers; the next cold start begins there too
      if (stay?.() && (await answers(from))) { await rememberRelayAsked(true); return false; }
      // the address in use changed while the relay was read (typed under Server, Reset): that choice stands
      if (apiBaseSync() !== from || (SERVER_OVERRIDE_ALLOWED && override ? override : null) !== typed) return false;
      if (leave) await leave();
      if (typed) { override = null; try { await SecureStore.deleteItemAsync(OVERRIDE_KEY); } catch { /* memory only */ } }
      await setRelayBase(found);
      return true;
    } finally {
      finding = null;
    }
  })();
  return finding;
}

/** The first start of a relay build (relayFirstStart), FU-m3: the relay's newest address is read while the address the
 *  app would use without it is asked whether it answers. Resolves as soon as that address answers, or once the relay
 *  read is done, whichever comes first. When that address answered first, the start goes on there for this run: the
 *  relay read carries on in the background but no longer moves the app while that address answers (a session the
 *  member opens meanwhile, with the preview card or a sign-in, is never ended by the relay's late answer, and no token
 *  minted there is sent to the relay's address; the relay is read again if that address stops answering). When the
 *  relay's new address answered first, the start waits for the move. An address that does not answer never ends the
 *  wait by itself, so a dead tunnel built into the APK still waits for the relay's new address (the move off a dead
 *  tunnel is unchanged); a relay that never answers no longer holds the splash when the built-in address works. */
export async function findServerFirstStart(leave?: () => Promise<void>): Promise<void> {
  // which answer came first: 'moving' (the relay's address answered: the start waits for the move) or 'staying'
  let first: 'none' | 'moving' | 'staying' = 'none';
  const relay = findServer(true, leave, () => { if (first === 'none') first = 'moving'; return first === 'staying'; }).then(() => undefined);
  const here = apiBaseSync();
  const answered = answers(here).then((ok) => {
    if (!ok || first === 'moving') return relay;
    first = 'staying';
    return undefined;
  });
  await Promise.race([relay, answered]);
}

/* A preview password in front of a tester's server (the shared demo link's gate). Only where testers may change the
   server: the tester types the gate's username and password under Server, they are kept in the device's secure store
   (never in the app), bound to the exact origin (scheme, host and port) of the address they were saved with, and sent
   as X-Bioptime-Gate only to that origin, so the app's own Authorization (the session token) passes the gate. */
const GATE_KEY = 'bp_gate';
export const GATE_HEADER = 'X-Bioptime-Gate';

/** 'https://host:port' of an address, lower case; null for anything that is not http(s). */
export function originOf(url: string): string | null {
  const m = /^(https?:\/\/[^/?#\s]+)/i.exec(url.trim());
  return m ? m[1].toLowerCase() : null;
}

function base64Utf8(s: string): string {
  const bin = encodeURIComponent(s).replace(/%([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bin.length; i += 3) {
    const a = bin.charCodeAt(i), b = bin.charCodeAt(i + 1), c = bin.charCodeAt(i + 2);
    const n = (a << 16) | ((b || 0) << 8) | (c || 0);
    out += abc[(n >> 18) & 63] + abc[(n >> 12) & 63] + (i + 1 < bin.length ? abc[(n >> 6) & 63] : '=') + (i + 2 < bin.length ? abc[n & 63] : '=');
  }
  return out;
}

async function loadGate(): Promise<void> {
  let stored: string | null = null;
  try { stored = await SecureStore.getItemAsync(GATE_KEY); } catch { stored = null; }
  try {
    const g = stored ? (JSON.parse(stored) as Partial<GateCredentials>) : null;
    gate = g && typeof g.origin === 'string' && typeof g.user === 'string' && typeof g.value === 'string' ? { origin: g.origin, user: g.user, value: g.value } : null;
  } catch { gate = null; }
}

/** What the Server screen shows: the saved username and the origin it belongs to (never the password). */
export function gateSummary(): { user: string; origin: string } | null {
  return SERVER_OVERRIDE_ALLOWED && gate ? { user: gate.user, origin: gate.origin } : null;
}

/** Saves the preview username and password for the origin of `address`. An empty username removes them. An empty
 *  password with the saved username keeps the saved password (for a new address of the same link). */
export async function setGateCredentials(address: string | null, user: string, password: string): Promise<void> {
  if (!SERVER_OVERRIDE_ALLOWED) return;
  const origin = address ? originOf(address) : null;
  const u = user.trim();
  let next: GateCredentials | null = null;
  if (origin && u) {
    if (password) next = { origin, user: u, value: `Basic ${base64Utf8(`${u}:${password}`)}` };
    else if (gate && gate.user === u) next = { ...gate, origin };
  }
  const changed = JSON.stringify(gate) !== JSON.stringify(next);
  gate = next;
  try { if (next) await SecureStore.setItemAsync(GATE_KEY, JSON.stringify(next)); else await SecureStore.deleteItemAsync(GATE_KEY); } catch { /* keep the in-memory value */ }
  if (changed) serverChanged(); // a server that refused the app may let it in now
}

/** The preview-password header for a request to `url`: only for the exact origin it was saved with. */
export function gateHeaders(url: string): Record<string, string> {
  if (!SERVER_OVERRIDE_ALLOWED || !gate || originOf(url) !== gate.origin) return {};
  return { [GATE_HEADER]: gate.value };
}

/** An image on the Bioptime server, with the preview-password header when one applies. */
export function remoteImage(uri: string): { uri: string; headers?: Record<string, string> } {
  const headers = gateHeaders(uri);
  return Object.keys(headers).length ? { uri, headers } : { uri };
}

/** The app's version as the build carries it: the app config's `version` (app.json, embedded in the native build and the
 *  web bundle), plus the build number when the build has one (Android versionCode, iOS buildNumber), e.g. "1.0.0 (2)".
 *  Read, never typed here, so the footer always matches the release. */
function readAppVersion(): string {
  const cfg = Constants.expoConfig;
  const version = (cfg?.version ?? '').trim() || '1.0.0';
  const build = Platform.OS === 'android' ? cfg?.android?.versionCode : Platform.OS === 'ios' ? cfg?.ios?.buildNumber : undefined;
  return build != null && String(build).trim() ? `${version} (${String(build).trim()})` : version;
}

export const APP_VERSION = readAppVersion();
export const CLIENT_HEADER = 'mobile';
