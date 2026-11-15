/* The portal's toasts (apps/dashboard/src/ui useToast: 2.4 s for an ok, 5 s for an error). The portal's float over the
   page, so they are seen wherever the action was taken; the app does the same with `float`, the coach workspace's
   ToastFloat (components/coach/shared): render it once next to the screen's scroll view, not inside it, and call
   `show(text, kind?)`. `node` is the same toast as an inline Notice, kept for the screens of other groups that place it
   in their content. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Notice } from '@/components/ui';
import { ToastFloat } from '@/components/coach/shared';

export type ToastKind = 'success' | 'error';

export function useToast(): { node: React.ReactNode; float: React.ReactNode; show: (text: string, kind?: ToastKind) => void } {
  const [toast, setToast] = useState<{ text: string; kind: ToastKind } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const show = useCallback((text: string, kind: ToastKind = 'success') => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ text, kind });
    timer.current = setTimeout(() => { timer.current = null; setToast(null); }, kind === 'error' ? 5000 : 2400);
  }, []);
  const node = toast ? <Notice kind={toast.kind}>{toast.text}</Notice> : null;
  const float = <ToastFloat toast={toast ? { kind: toast.kind === 'error' ? 'error' : 'ok', text: toast.text } : null} />;
  return { node, float, show };
}
