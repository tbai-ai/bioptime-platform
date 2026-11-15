/* A coach screen's load error, in plain words. The server's refusals that are not faults (a client who keeps health
   sharing off: NOT_SHARED; a record that is not the coach's: NO_ACCESS or FORBIDDEN; one that does not exist: NOT_FOUND;
   a module that is switched off: FEATURE_DISABLED) show the server's own sentence without the "Something went wrong"
   title, as the portal shows its error text alone (ui/index.tsx Alert); anything else is the app's usual ErrorBox. */
import React from 'react';
import { ApiError } from '@/lib/api';
import { ErrorBox, Notice } from '@/components/ui';

const PLAIN: Record<string, 'info' | 'warning'> = { NOT_SHARED: 'info', NO_ACCESS: 'warning', FORBIDDEN: 'warning', NOT_FOUND: 'warning', FEATURE_DISABLED: 'info' };

export function CoachRefusal({ error, onRetry }: { error: ApiError | Error | null; onRetry?: () => void }) {
  if (!error) return null;
  const kind = error instanceof ApiError ? PLAIN[error.code] : undefined;
  if (kind) return <Notice kind={kind}>{error.message}</Notice>;
  return <ErrorBox error={error} onRetry={onRetry} />;
}
