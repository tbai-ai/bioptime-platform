/* Growth in the administrative portal (growth.manage): the shapes of the discovery calls, the offered times, the
   corporate enquiries and the newsletter, and the web's words for them (apps/dashboard/src/modules/growth/shared.tsx).
   Times are India time (IST), whatever the phone's own zone. Nothing here fetches. */
export type Person = { id: string; name: string; role: string };
export type Slot = { id: string; startAt: string; endAt: string; label: string; withdrawn?: boolean };
export type Note = { id: string; body: string; author: Person | null; createdAt: string };

export type DiscoveryStatus = 'new' | 'contacted' | 'booked' | 'closed';
export type DiscoveryCall = {
  id: string; reference: string; name: string; email: string; phone?: string | null; goals: string; preferredSlots: Slot[]; preferredWindows: string | null;
  interests: string[]; source: string; consentVersion: string; consentText: string | null; consentAt: string; status: DiscoveryStatus; assignedTo: Person | null;
  bookedAt: string | null; createdAt: string; updatedAt: string; closedAt: string | null; noteCount: number; notes?: Note[];
};
export const DISCOVERY_STATUSES: Array<{ id: DiscoveryStatus; label: string }> = [{ id: 'new', label: 'New' }, { id: 'contacted', label: 'Contacted' }, { id: 'booked', label: 'Booked' }, { id: 'closed', label: 'Closed' }];

export type CorporateStatus = 'new' | 'contacted' | 'in_discussion' | 'closed';
export type CorporateEnquiry = {
  id: string; reference: string; company: string; contactName: string; email: string; phone?: string | null; teamSize: string; interests: string[]; message: string | null;
  consentVersion: string; consentText: string | null; consentAt: string; status: CorporateStatus; assignedTo: Person | null; createdAt: string; updatedAt: string; closedAt: string | null; noteCount: number; notes?: Note[];
};
export const CORPORATE_STATUSES: Array<{ id: CorporateStatus; label: string }> = [{ id: 'new', label: 'New' }, { id: 'contacted', label: 'Contacted' }, { id: 'in_discussion', label: 'In discussion' }, { id: 'closed', label: 'Closed' }];
export const CORPORATE_INTEREST_LABELS: Record<string, string> = { coaching: 'Coaching for team members', blood_tests: 'Blood tests for team members', live_sessions: 'Group sessions and webinars', courses: 'Courses in the app', other: 'Something else' };

export type Subscriber = { id: string; email: string; status: 'pending' | 'confirmed' | 'unsubscribed'; consentVersion: string; consentText: string | null; source: string; requestedAt: string; confirmedAt: string | null; unsubscribedAt: string | null; confirmExpiresAt: string | null };
export type SlotRow = { id: string; startAt: string; endAt: string; label: string; status: 'published' | 'withdrawn'; past: boolean; requests: number };

export const SOURCE_LABELS: Record<string, string> = { website: 'Discovery call page', package_finder: 'Package finder', calculators: 'Health calculators', webinars: 'Webinars page', corporate: 'Corporate page', footer: 'Footer sign-up' };

/** The web's GrowthPill: one word per status in the portal's tones. */
const PILL_WORD: Record<string, string> = { new: 'New', contacted: 'Contacted', booked: 'Booked', in_discussion: 'In discussion', closed: 'Closed', pending: 'Waiting to confirm', confirmed: 'Confirmed', unsubscribed: 'Unsubscribed', published: 'Offered', withdrawn: 'Withdrawn' };
const PILL_TONE: Record<string, 'success' | 'warning' | 'info' | 'error'> = { new: 'warning', contacted: 'warning', booked: 'info', in_discussion: 'warning', closed: 'info', pending: 'warning', confirmed: 'success', unsubscribed: 'info', published: 'success', withdrawn: 'info' };
export function growthPill(status: string): { label: string; tone: 'success' | 'warning' | 'info' | 'error' } { return { label: PILL_WORD[status] ?? status, tone: PILL_TONE[status] ?? 'info' }; }

/** An ISO instant as its IST date (YYYY-MM-DD) and time (HH:MM), for the date and time fields. */
export function isoToIstParts(iso?: string | null): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const s = new Date(Date.parse(iso) + 330 * 60_000).toISOString();
  return { date: s.slice(0, 10), time: s.slice(11, 16) };
}
/** A date and a time typed in IST as an ISO instant, or null when either is missing or not real. */
export function istPartsToIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const t = Date.parse(`${date}T${time}:00+05:30`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}
/** "120 characters, then …" as the web cuts the goals in its table. */
export const cut = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 3)}…` : s);
