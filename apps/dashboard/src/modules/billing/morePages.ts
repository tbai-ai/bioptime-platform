/* M3 Billing: following the administrator lists' cursor (GET /admin/billing/documents, /admin/refund-requests and
   /admin/orders answer { items, nextCursor }). The cursor is opaque here: the billing lists send "<time>~<id>", the
   orders list a bare time, and either is handed back as it came. Used by AdminBilling.tsx and ClientRecordBilling.tsx. */
import { useState } from 'react';
import { errorText, useToast } from '../../ui';

export type Page<T> = { items: T[]; nextCursor: string | null };

/** The first page (loaded by useApi) and the pages after it, loaded with "Load more". The later pages belong to the
 *  first page they followed, so a filter change or a reload starts the list again from the top. */
export function useMorePages<T>(first: Page<T> | null, load: (cursor: string) => Promise<Page<T>>) {
  const toast = useToast();
  const [extra, setExtra] = useState<{ base: Page<T>; items: T[]; nextCursor: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const current = extra && first && extra.base === first ? extra : null;
  const next = current ? current.nextCursor : first?.nextCursor ?? null;
  const more = async () => {
    if (!first || !next) return;
    setBusy(true);
    try {
      const r = await load(next);
      setExtra((e) => ({ base: first, items: [...(e && e.base === first ? e.items : []), ...r.items], nextCursor: r.nextCursor }));
    } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); }
  };
  return { items: [...(first?.items ?? []), ...(current?.items ?? [])], next, busy, more };
}

/** Every page of a list, following nextCursor until there is none, for a view that needs the whole list at once. Stops
 *  after maxPages pages (complete false) and when a cursor does not move on. */
export async function allPages<T>(load: (cursor?: string) => Promise<Page<T>>, maxPages: number): Promise<{ items: T[]; complete: boolean }> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const r = await load(cursor);
    items.push(...r.items);
    if (!r.nextCursor) return { items, complete: true };
    if (r.nextCursor === cursor) break;
    cursor = r.nextCursor;
  }
  return { items, complete: false };
}
