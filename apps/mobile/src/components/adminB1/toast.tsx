/* The portal's toasts (apps/dashboard/src/ui/index.tsx:13-16: 2.4 s for a success, 5 s for an error) as a Notice near
   the top of a screen, in the app's own idiom (a `toast` state rendered as <Notice>). One at a time; a new one replaces
   the last. */
import React, { useCallback, useEffect, useState } from 'react';
import { Notice } from '../ui';

type Kind = 'success' | 'error';
const TTL: Record<Kind, number> = { success: 2400, error: 5000 };

export function useToast(): { toast: React.ReactNode; show: (text: string, kind?: Kind) => void; clear: () => void } {
  const [t, setT] = useState<{ text: string; kind: Kind; n: number } | null>(null);
  useEffect(() => {
    if (!t) return;
    const timer = setTimeout(() => setT((cur) => (cur && cur.n === t.n ? null : cur)), TTL[t.kind]);
    return () => clearTimeout(timer);
  }, [t]);
  const show = useCallback((text: string, kind: Kind = 'success') => setT({ text, kind, n: Date.now() }), []);
  const clear = useCallback(() => setT(null), []);
  return { toast: t ? <Notice kind={t.kind}>{t.text}</Notice> : null, show, clear };
}
