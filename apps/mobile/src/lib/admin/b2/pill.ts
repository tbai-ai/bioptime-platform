/* The portal's pill colours and the permission test the B2 screens share.
   pillTone(status) is the web's <Pill status=…> (apps/dashboard/src/ui/index.tsx): STATUS_PILL from
   apps/dashboard/src/lib/format.ts, and anything not in the table drawn 'neutral'. The app has no neutral tone and adds
   none, so neutral is drawn as the app's 'info' (lib/admin/a/format.ts does the same). Unlike that helper, an unknown
   status never falls back to the app's own statusTone: the web draws it neutral, so the app does too.
   useAllowed is RequirePermission's own test (lib/workspaceNav permitted), for screens whose loaders must not ask the
   API without the permission: the web's route guard never mounts the page, so it makes no call either. */
import { useAuth } from '../../auth';
import { permitted } from '../../workspaceNav';

export type PillTone = 'info' | 'success' | 'warning' | 'error';

const STATUS_PILL: Record<string, 'success' | 'info' | 'warning' | 'error' | 'neutral'> = {
  active: 'success', activated: 'success', paid: 'success', completed: 'success', results_ready: 'success', published: 'success', scheduled: 'info', confirmed: 'info', requested: 'warning', pending: 'warning', pending_payment: 'warning', open: 'warning', draft: 'warning', processing: 'warning', sample_collected: 'warning', in_progress: 'warning', exception: 'error', failed: 'error', cancelled: 'neutral', ended: 'neutral', paused: 'neutral', refunded: 'neutral', refund_pending: 'warning', resolved: 'success', dismissed: 'neutral', no_show: 'error', suspended: 'error', onboarding: 'info', pending_verification: 'warning', invited: 'info', assigned: 'success', proposal_sent: 'info', accepted: 'success', declined: 'neutral', expired: 'neutral', payment_pending: 'warning', enquiry_received: 'warning', under_review: 'info', scoping: 'info', awaiting_professional_input: 'warning', awaiting_internal_approval: 'warning', new: 'warning', closed: 'neutral', exhausted: 'neutral', available: 'success',
};

/** The tone the portal draws for `<Pill status={status}>`. */
export function pillTone(status?: string | null): PillTone {
  const kind = status ? STATUS_PILL[status] ?? 'neutral' : 'neutral';
  return kind === 'neutral' ? 'info' : kind;
}

/** Whether the signed-in person passes RequirePermission(permission, any). */
export function useAllowed(permission: string | string[], any = false): boolean {
  const { can } = useAuth();
  return permitted(can, permission, any);
}

/** A loader that asks the API only when `allowed`; without the permission it resolves to null and requests nothing. */
export function gated<T>(allowed: boolean, fn: () => Promise<T>): () => Promise<T | null> {
  return () => (allowed ? fn() : Promise.resolve(null));
}
