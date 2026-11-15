/* Single-use tokens from emailed links (member activation, coach invitation). The token is read from the address bar
   once, removed from the address bar and history at once, and kept for this tab only in sessionStorage so a reload
   still works; it is dropped after a successful accept or a final answer (used, expired, no longer applicable).
   It is never logged and never put back into a URL. */

/** The token for this link: from the address bar (stored for the tab) or, after a reload, from the tab's storage. */
export function takeLinkToken(key: string, fromUrl: string | null): string {
  if (fromUrl) {
    try { sessionStorage.setItem(key, fromUrl); } catch { /* storage unavailable: the token lives in memory only */ }
    return fromUrl;
  }
  try { return sessionStorage.getItem(key) ?? ''; } catch { return ''; }
}

export function forgetLinkToken(key: string): void {
  try { sessionStorage.removeItem(key); } catch { /* storage unavailable */ }
}

/** Remove ?token= from the address bar and the current history entry. */
export function scrubTokenFromUrl(): void {
  const u = new URL(window.location.href);
  if (!u.searchParams.has('token')) return;
  u.searchParams.delete('token');
  window.history.replaceState(window.history.state, '', `${u.pathname}${u.search}${u.hash}`);
}
