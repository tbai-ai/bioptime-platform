/* Idempotency keys for bookings and checkouts. crypto.randomUUID exists only in secure contexts (https, localhost);
   a portal opened over plain http on a LAN address still needs a key, so fall back to a v4 built from getRandomValues. */
export function uuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40; b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Opens a URL that is only known after an await without losing the click's popup permission: the tab opens during the
 *  click, is cut off from this page (opener cleared) and is pointed at the URL once it is known. window.open with
 *  'noopener' always returns null, which left an empty tab behind and loaded the URL here, so it is not used. Only when
 *  the browser blocks the popup does the URL open in this tab instead. If loading fails, the empty tab is closed. */
export function openLater(load: () => Promise<string>, onError: (e: unknown) => void): void {
  const w = window.open('', '_blank');
  if (w) w.opener = null;
  load().then(
    (url) => {
      const href = new URL(url, window.location.href).href; // a path such as /api/reports/file?… is this site's
      if (!w) window.location.assign(href);
      else if (!w.closed) w.location.href = href; // a tab the person already closed stays closed
    },
    (e) => { if (w && !w.closed) w.close(); onError(e); },
  );
}
