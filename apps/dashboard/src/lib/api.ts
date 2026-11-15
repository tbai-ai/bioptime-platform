/* The API client: same origin, cookie session, the client header every state-changing call carries, one error shape. */
export type ApiError = { status: number; code: string; message: string; details?: unknown };

export class ApiRequestError extends Error implements ApiError {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) { super(message); }
}

let onUnauthorised: (() => void) | null = null;
export function setUnauthorisedHandler(fn: () => void): void { onUnauthorised = fn; }

/* Two-factor authentication is mandatory for administrators and owners. A session of a privileged account without it
   is refused by every admin route with 403 MFA_ENROLMENT_REQUIRED (no enrolment token): the portal then signs out and
   sends the person to the admin sign-in, where the password and the set-up step follow. The sign-in itself answers
   the same code with an enrolment token in its details; that one belongs to the sign-in page, not to this handler. */
let onMfaEnrolmentRequired: (() => void) | null = null;
export function setMfaEnrolmentHandler(fn: () => void): void { onMfaEnrolmentRequired = fn; }
const SIGN_IN_PATHS = ['/auth/login', '/auth/mfa/enrol/'];

/* A shared link may have a preview gate in front of the portal, with a sign-in of its own. When the gate's own
   sign-in has ended it answers API calls with 401 GATE_EXPIRED (the API never sends that code). That is not the end of
   the portal session, so the portal does not show its "session ended" page: it reloads, and the reload reaches the
   gate's sign-in page. At most once a minute (remembered in session storage), so a tab does not fall into a reload
   loop; within that minute the call fails with the gate's own message instead. */
const GATE_RELOAD_KEY = 'bp.gateReloadAt';
function reloadForGate(): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(GATE_RELOAD_KEY) ?? 0);
    if (Date.now() - last < 60_000) return false;
    window.sessionStorage.setItem(GATE_RELOAD_KEY, String(Date.now()));
  } catch { /* storage blocked: reload anyway; the gate answers the reloaded page with its sign-in page */ }
  window.location.reload();
  return true;
}

/* Open preview (lib/auth.tsx): every tab of this browser shares one session cookie, so a tab whose account another tab
   replaced first takes its own workspace's account back. The provider installs this check only while the server says
   openPreview; it answers null (send now) or a promise to wait for. Never installed otherwise: nothing changes then. */
type BeforeRequest = (method: string, path: string) => Promise<void> | null;
let beforeRequest: BeforeRequest | null = null;
export function setBeforeRequest(fn: BeforeRequest | null): void { beforeRequest = fn; }
/* ... and when a call is refused anyway (401/403: the session changed hands after the check), the provider may find that
   another tab's account holds the session, take this tab's back and answer true: the call is then sent once more (a
   refused call did nothing on the server). Installed only while the server says openPreview. */
type AfterRefusal = (method: string, path: string) => Promise<boolean> | null;
let afterRefusal: AfterRefusal | null = null;
export function setAfterRefusal(fn: AfterRefusal | null): void { afterRefusal = fn; }

/** Who the session cookie belongs to right now, asked without the handlers above: a user id, null when there is no
    session (401), undefined when it cannot be told (network, gate, any other answer). */
export async function sessionUserId(): Promise<string | null | undefined> {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include', headers: { 'x-bioptime-client': 'web' } });
    const json = await res.json().catch(() => null) as { user?: { id?: string }; error?: { code?: string } } | null;
    if (res.status === 401) return json?.error?.code === 'GATE_EXPIRED' ? undefined : null;
    return res.ok && typeof json?.user?.id === 'string' ? json.user.id : undefined;
  } catch { return undefined; }
}

async function call<T>(method: string, path: string, body?: unknown, again = false): Promise<T> {
  const wait = beforeRequest ? beforeRequest(method, path) : null;
  if (wait) await wait;
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-bioptime-client': 'web' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) {
    const err = (json as { error?: { code: string; message: string; details?: unknown } } | null)?.error;
    if (!again && afterRefusal && (res.status === 401 || res.status === 403) && err?.code !== 'GATE_EXPIRED' && err?.code !== 'MFA_ENROLMENT_REQUIRED') {
      const retry = afterRefusal(method, path);
      if (retry && await retry) return call<T>(method, path, body, true);
    }
    if (res.status === 401 && err?.code === 'GATE_EXPIRED' && reloadForGate()) throw new ApiRequestError(res.status, err.code, err.message ?? 'Reloading the page', err.details);
    if (res.status === 401 && err?.code !== 'GATE_EXPIRED' && err?.code !== 'MFA_REQUIRED' && err?.code !== 'INVALID_CREDENTIALS' && err?.code !== 'MFA_INVALID' && onUnauthorised) onUnauthorised();
    if (res.status === 403 && err?.code === 'MFA_ENROLMENT_REQUIRED' && !SIGN_IN_PATHS.some((p) => path.startsWith(p)) && onMfaEnrolmentRequired) onMfaEnrolmentRequired();
    throw new ApiRequestError(res.status, err?.code ?? 'HTTP_' + res.status, err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return json as T;
}

export const api = {
  get: <T = any>(path: string) => call<T>('GET', path),
  post: <T = any>(path: string, body?: unknown) => call<T>('POST', path, body ?? {}),
  patch: <T = any>(path: string, body?: unknown) => call<T>('PATCH', path, body ?? {}),
  put: <T = any>(path: string, body?: unknown) => call<T>('PUT', path, body ?? {}),
  del: <T = any>(path: string) => call<T>('DELETE', path),
};

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}
