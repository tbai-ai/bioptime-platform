/* The one place the app talks to the Bioptime API. Bearer token (kept in the device's secure store), the client header
   the server requires, JSON in and out, and one error type the screens can reason about. */
import * as SecureStore from 'expo-secure-store';
import { apiBaseSync, CLIENT_HEADER, gateHeaders, loadApiBase, SERVER_OVERRIDE_ALLOWED } from './config';
import { clearCache } from './cache';

const TOKEN_KEY = 'bp_token';
let token: string | null | undefined;
let tokenLoad: Promise<string | null> | null = null;
let onUnauthorised: (() => void) | null = null;

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;
  constructor(status: number, body: unknown) {
    const e = (body && typeof body === 'object' && 'error' in body ? (body as { error: { code?: string; message?: string; details?: unknown } }).error : null) ?? {};
    super(e.message ?? (status === 0 ? 'The Bioptime service could not be reached.' : `Something went wrong (${status}).`));
    this.status = status;
    this.code = e.code ?? (status === 0 ? 'NETWORK' : `HTTP_${status}`);
    this.details = e.details;
  }
  get offline(): boolean { return this.status === 0; }
  /** zod issues → { field: message } */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    const d = this.details as unknown;
    const issues: Array<{ path?: unknown[]; message?: string }> = Array.isArray(d) ? d : d && typeof d === 'object' && Array.isArray((d as { issues?: unknown }).issues) ? (d as { issues: Array<{ path?: unknown[]; message?: string }> }).issues : [];
    for (const i of issues) { const raw = i.path as unknown; const k = (Array.isArray(raw) ? String(raw[0] ?? '') : typeof raw === 'string' ? raw : '').split('.')[0]; if (k && !out[k]) out[k] = i.message ?? 'Check this field'; } // the API sends path as 'goals' or ['goals']
    return out;
  }
}

export async function loadToken(): Promise<string | null> {
  if (token !== undefined) return token;
  // one read of the secure store, shared by every caller; a token set meanwhile (a sign-in) wins over the stored one
  tokenLoad ??= (async () => {
    let stored: string | null = null;
    try { stored = await SecureStore.getItemAsync(TOKEN_KEY); } catch { stored = null; }
    if (token === undefined) token = stored;
    return token ?? null;
  })();
  return tokenLoad;
}
export async function setToken(value: string | null): Promise<void> {
  token = value;
  try { if (value) await SecureStore.setItemAsync(TOKEN_KEY, value); else await SecureStore.deleteItemAsync(TOKEN_KEY); } catch { /* memory only */ }
}
export function hasToken(): boolean { return !!token; }
/** Drops this device's session token, the stored one included, also when nothing has read it yet (the link relay moves
 *  the app at a cold start, before the first request): true when there was one. The token is gone from memory before
 *  this returns, so no request built afterwards carries it. */
export async function forgetToken(): Promise<boolean> {
  const had = !!(await loadToken());
  await setToken(null);
  return had;
}
export function setUnauthorisedHandler(fn: (() => void) | null): void { onUnauthorised = fn; }
let onUnreachable: (() => void) | null = null;
/** Called (without waiting) when a request finds no Bioptime server at the address in use: lib/auth asks the link relay
 *  for the shared link's new address in builds that read one (lib/config findServer). */
export function setUnreachableHandler(fn: (() => void) | null): void { onUnreachable = fn; }

/** How long a request may wait for an answer. Only lib/auth's reachability probe (GET /public/config at a cold start,
 *  and its quiet re-checks while nothing answers) asks for less, so the splash never waits out this limit. */
export const REQUEST_TIMEOUT_MS = 20000;

/** One request to the API: the stored server address and session first (a screen opened through a link at a cold
 *  start asks before the app has read them: wait for both, so the request goes to that server with the member's token
 *  instead of failing as signed out, and a token is never sent to the default server while a tester's own address is
 *  still loading), the client and gate headers, a 20 s limit (`timeoutMs` for the reachability probe). No answer at all
 *  is ApiError(0). */
async function send(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body: unknown, accept: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  await loadApiBase();
  if (token === undefined) await loadToken();
  const url = `${apiBaseSync()}/api${path}`;
  const headers: Record<string, string> = { Accept: accept, 'X-Bioptime-Client': CLIENT_HEADER, ...gateHeaders(url) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal });
  } catch {
    onUnreachable?.();
    throw new ApiError(0, null);
  } finally {
    clearTimeout(timer);
  }
}

/** A refusal: the gate's, something in front of the server, or the server's own (a dead session ends here). */
async function refused(res: Response, json: unknown, text = ''): Promise<ApiError> {
  const gateRefusal = previewGateRefusal(res, json);
  if (gateRefusal) return gateRefusal; // the server was never asked, so the session is not dead
  if (notFromServer(res, json, text)) return unreached(); // a gateway's or tunnel's page: the server was not reached
  if (res.status >= 500 && !isApiErrorBody(json)) onUnreachable?.(); // an error page from something in front of the server (a tunnel that has gone)
  const deadSession = res.status === 401 && (json as { error?: { code?: string } } | null)?.error?.code !== 'INVALID_CREDENTIALS'; // a wrong current password (password change) is a 401 on a live session
  if (deadSession && token) { await setToken(null); await clearCache(); onUnauthorised?.(); } // a dead session takes its cached health data with it
  return new ApiError(res.status, json);
}

function parseJson(text: string): unknown {
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

/** The answers of a gateway or a tunnel in front of the server, never of the Bioptime API (which answers every error
 *  with its own JSON body): 502, 503 and 504 from a proxy, and Cloudflare's 520-530 (530: a quick tunnel that has gone). */
const GATEWAY_STATUS = new Set([502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530]);

/** True for an answer that did not come from the Bioptime API (FU-m1): a gateway's error page without the API's own
 *  error body, or an HTML page where JSON was expected (a proxy's or a captive portal's page, whatever its status).
 *  The app treats it as no answer at all: "could not be reached", the saved copy kept and the Offline banner shown. */
function notFromServer(res: Response, json: unknown, text: string): boolean {
  if (isApiErrorBody(json)) return false;
  if (GATEWAY_STATUS.has(res.status)) return true;
  if (json !== null) return false; // JSON: the API's own answer
  return /\btext\/html\b/i.test(res.headers.get('content-type') ?? '') || /^\s*</.test(text);
}

/** No Bioptime server answered: ApiError(0), as for no answer at all, after telling lib/auth (the link relay). */
function unreached(): ApiError {
  onUnreachable?.();
  return new ApiError(0, null);
}

export async function api<T = any>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown, opts?: { timeoutMs?: number }): Promise<T> {
  const res = await send(method, path, body, 'application/json', opts?.timeoutMs);
  const text = await res.text();
  const json = parseJson(text);
  if (res.ok) {
    if (notFromServer(res, json, text)) throw unreached();
    return json as T;
  }
  throw await refused(res, json, text);
}

export type ApiFile = {
  /** The server's content type (text/calendar, application/pdf). */
  contentType: string;
  /** From Content-Disposition, when the server names the file. */
  filename: string | null;
  /** `as: 'text'`: the file as text (a calendar file). */
  text?: string;
  /** `as: 'base64'`: the bytes, to write to a file on the phone (expo-file-system) and share. */
  base64?: string;
  /** `as: 'blob'`: the web's blob, to download through an object URL. */
  blob?: Blob;
};

/** A file from the API that is not JSON (a calendar .ics, a PDF), sent with the member's token and the same headers
 *  and refusals as api(): a refusal arrives as JSON and throws the same ApiError. */
export async function apiFile(path: string, as: 'text' | 'base64' | 'blob' = 'text', accept = '*/*'): Promise<ApiFile> {
  const res = await send('GET', path, undefined, accept);
  if (!res.ok) { const text = await res.text(); throw await refused(res, parseJson(text), text); }
  const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
  const filename = filenameOf(res.headers.get('content-disposition'));
  if (as === 'text') return { contentType, filename, text: await res.text() };
  if (as === 'blob') return { contentType, filename, blob: await res.blob() };
  return { contentType, filename, base64: toBase64(new Uint8Array(await res.arrayBuffer())) };
}

function filenameOf(disposition: string | null): string | null {
  if (!disposition) return null;
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(disposition);
  if (star) { try { return decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')); } catch { /* fall through */ } }
  const plain = /filename\s*=\s*("?)([^";]+)\1/i.exec(disposition);
  return plain ? plain[2].trim() : null;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    out += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)] + (b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]) + (c === undefined ? '=' : B64[c & 63]);
  }
  return out;
}

/** The Bioptime API answers every error with { error: { code, message } }; anything else came from something in front of
 *  it (Cloudflare's 530 page for a tunnel that has gone, a proxy's 502). */
function isApiErrorBody(json: unknown): boolean {
  return !!json && typeof json === 'object' && typeof (json as { error?: { code?: unknown } }).error?.code === 'string';
}

/** True when an error means no Bioptime server answered at the address in use: no answer at all, or a 5xx page that is
 *  not the API's own (Cloudflare's 530 for a tunnel that has gone, a proxy's 502). A preview password's refusal is not
 *  one: that server is there. */
export function serverUnreachable(e: unknown): boolean {
  return e instanceof ApiError && e.code !== PREVIEW_GATE && (e.offline || (e.status >= 500 && e.code === `HTTP_${e.status}`));
}

/** A refusal by a preview password in front of the server (the shared demo link's gate), not by the server itself:
 *  wrong preview credentials (GATE_CREDENTIALS), or none sent where a Basic password is asked for. */
export const PREVIEW_GATE = 'PREVIEW_GATE';
export function previewGateRefusal(res: Response, json: unknown): ApiError | null {
  if (res.status !== 401) return null;
  const wrong = (json as { error?: { code?: string } } | null)?.error?.code === 'GATE_CREDENTIALS';
  if (!wrong && !/^basic\b/i.test(res.headers.get('www-authenticate') ?? '')) return null;
  const where = SERVER_OVERRIDE_ALLOWED ? ' under Server (testers)' : '';
  return new ApiError(401, { error: { code: PREVIEW_GATE, message: wrong
    ? `The preview username or password is not right. Check them${where}.`
    : `This server is behind a preview password. Enter the preview username and password${where}.` } });
}

export const get = <T = any>(path: string) => api<T>('GET', path);
/** A GET that gives up after `timeoutMs` (the reachability probe); everything else uses get() and its 20 s. */
export const probe = <T = any>(path: string, timeoutMs: number) => api<T>('GET', path, undefined, { timeoutMs });
export const post = <T = any>(path: string, body?: unknown) => api<T>('POST', path, body ?? {});
export const patch = <T = any>(path: string, body?: unknown) => api<T>('PATCH', path, body ?? {});

export function qs(params: Record<string, string | number | undefined | null>): string {
  const parts = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

export function randomKey(): string {
  let s = '';
  for (let i = 0; i < 24; i++) s += Math.floor(Math.random() * 16).toString(16);
  return `app-${s}`;
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong.';
}
