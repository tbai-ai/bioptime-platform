/* The link relay: how a tester's build finds the current address of the shared link when it moves. The shared link is a
   temporary Cloudflare quick tunnel (https://<words>.trycloudflare.com) whose address changes when the tunnel is
   reopened; the Mac that serves it publishes each new address to a topic on a public relay (ntfy), and a build made
   with EXPO_PUBLIC_LINK_RELAY_TOPIC reads the newest one from there (lib/config findServer).
   Strict on purpose: only a message whose whole text is a quick-tunnel address (QUICK_TUNNEL below, nothing before or
   after it, lower case, https) is ever used; every other message is ignored. The topic is a build-time value, never in
   the repository or an .env file, and is never logged or shown.
   What that strictness does not do: it limits what the app may be sent to, not who may send it. The topic is compiled
   into the build, so anyone holding the APK can read it and post a quick-tunnel address of their own (anyone can open
   one); an install reading the relay then (a first start, or a link that stopped answering) would use that server.
   Only tester builds read the relay (lib/config LINK_RELAY), and moving drops the session first, so no token goes
   along. Share the APK privately; a new topic needs a new APK. Signed messages (a key pair: the private key on the Mac
   that publishes, the public key in the app) would close this, as a later change of the contract.
   No React Native import here, so this file also loads in Node for checks. */

/** The only addresses the relay may hand the app. */
export const QUICK_TUNNEL = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;
/** ntfy's topic names: letters, digits, '-' and '_', at most 64. */
const TOPIC = /^[A-Za-z0-9_-]{1,64}$/;
/** The relay used when the build does not name another one (EXPO_PUBLIC_LINK_RELAY_BASE is for checks on this machine). */
export const DEFAULT_RELAY_BASE = 'https://ntfy.sh';
/** The relay keeps messages for 12 hours; the Mac publishes the address again every hour. */
export const RELAY_SINCE = '12h';
const MAX_BODY = 256 * 1024;

export type RelaySettings = { base: string; topic: string };

/** The relay this build reads, or null when it reads none (no topic, or a value that is not a topic or not a relay
 *  address). The base is https, or http on this machine or the Android emulator's host alias (local checks). */
export function relaySettings(topic: string | undefined | null, base: string | undefined | null): RelaySettings | null {
  const t = (topic ?? '').trim();
  if (!t || !TOPIC.test(t)) return null;
  const b = ((base ?? '').trim() || DEFAULT_RELAY_BASE).replace(/\/+$/, '');
  const ok = /^https:\/\/[a-z0-9.-]+(:\d{1,5})?$/i.test(b) || /^http:\/\/(127\.0\.0\.1|localhost|10\.0\.2\.2)(:\d{1,5})?$/i.test(b);
  return ok ? { base: b, topic: t } : null;
}

/** The poll address: the messages of the last 12 hours, as one JSON object per line, without waiting for new ones. */
export function relayPollUrl(s: RelaySettings): string {
  return `${s.base}/${encodeURIComponent(s.topic)}/json?poll=1&since=${RELAY_SINCE}`;
}

/** True for an address the relay may hand the app (a whole quick-tunnel origin, nothing else). */
export function isQuickTunnel(url: string | null | undefined): boolean {
  return typeof url === 'string' && QUICK_TUNNEL.test(url);
}

/** The newest message whose whole text is a quick-tunnel address, from a poll answer (one JSON object per line); null
 *  when there is none. Lines that are not JSON, events that are not messages and every other text are ignored. Newest
 *  means the latest `time`; between equal times, the later line. */
export function newestRelayLink(body: string): string | null {
  let best: { url: string; time: number; at: number } | null = null;
  const lines = body.slice(0, MAX_BODY).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let m: unknown;
    try { m = JSON.parse(line); } catch { continue; }
    if (!m || typeof m !== 'object' || Array.isArray(m)) continue;
    const { event, message, time } = m as { event?: unknown; message?: unknown; time?: unknown };
    if (event !== undefined && event !== 'message') continue;
    if (typeof message !== 'string' || !QUICK_TUNNEL.test(message)) continue;
    const t = typeof time === 'number' && Number.isFinite(time) ? time : 0;
    if (!best || t > best.time || (t === best.time && i > best.at)) best = { url: message, time: t, at: i };
  }
  return best ? best.url : null;
}

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/** Reads the relay once: the newest quick-tunnel address on the topic, or null (nothing there, the relay did not
 *  answer, or it answered with an error). Never throws. */
export async function readRelayLink(s: RelaySettings, fetchImpl: FetchLike = fetch as unknown as FetchLike, timeoutMs = 8000): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(relayPollUrl(s), { method: 'GET', headers: { Accept: 'application/x-ndjson, application/json' }, signal: ctrl.signal });
    if (!res.ok) return null;
    return newestRelayLink(await res.text());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
