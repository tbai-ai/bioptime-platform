/* What the Coach screens read from the API (only the fields they use). */
import type { Attachment } from './files';

export type Coach = {
  id: string; displayName: string; bio?: string | null; designation?: string | null; city?: string | null;
  expertise?: string[]; languages?: string[]; qualifications?: string[]; scope?: string[];
};
export type Assignment = { coachId: string; status: string; displayName?: string; name?: string };
export type CoachAnswer = { assignment: Assignment | null; coach: Coach | null };

export type Conversation = { id: string; coachName?: string | null; lastMessageAt?: string | null; lastBody?: string | null; unread?: number };
export type ThreadAnswer = { items: Array<{ id: string; mine: boolean; body: string; createdAt: string; readAt: string | null; attachments?: Attachment[] }> };

export type Appointment = {
  id: string; kind: string; status: string; startAt: string; endAt?: string; coachName?: string | null;
  meetingLink?: string | null; note?: string | null; memberNote?: string | null; consumesEntitlement?: boolean; cancelledReason?: string | null;
};
export type Summary = { id: string; appointmentId: string | null; kind: string; startAt: string | null; coachName: string | null; body: string; createdAt: string };
export type Note = { id: string; kind: string; body: string; created_at: string; coach_name: string | null };

export type Entitlement = { total: number; used?: number; reserved?: number; remaining: number; unit?: string };
export type Me = {
  member?: { name?: string };
  programme?: unknown;
  assignmentStatus?: string;
  entitlements?: { consultation?: Entitlement | null } | null;
  unread?: { messages?: number };
};

/** Only an https link the coach shared is offered (no spaces, line breaks or control characters); otherwise the member
 *  reads who will share how to join (M8). */
export function httpsLink(url?: string | null): string | null {
  return url && /^https:\/\//i.test(url) && !/[\s\u0000-\u001f\u007f-\u009f]/.test(url) ? url : null;
}

export const OPEN_STATES = ['scheduled', 'requested'];
