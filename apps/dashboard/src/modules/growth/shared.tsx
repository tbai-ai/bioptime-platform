/* Growth: what the module's portal pages share (types, status words, the status pill, the IST time helpers). */
import React from 'react';
import { Pill } from '../../ui';

export type Person = { id: string; name: string; role: string };
export type Slot = { id: string; startAt: string; endAt: string; label: string; withdrawn?: boolean };
export type Note = { id: string; body: string; author: Person | null; createdAt: string };

export type DiscoveryCall = {
  id: string; reference: string; name: string; email: string; phone?: string | null; goals: string; preferredSlots: Slot[]; preferredWindows: string | null;
  interests: string[]; source: string; consentVersion: string; consentText: string | null; consentAt: string; status: DiscoveryStatus; assignedTo: Person | null;
  bookedAt: string | null; createdAt: string; updatedAt: string; closedAt: string | null; noteCount: number; notes?: Note[];
};
export type DiscoveryStatus = 'new' | 'contacted' | 'booked' | 'closed';
export const DISCOVERY_STATUSES: Array<{ id: DiscoveryStatus; label: string }> = [{ id: 'new', label: 'New' }, { id: 'contacted', label: 'Contacted' }, { id: 'booked', label: 'Booked' }, { id: 'closed', label: 'Closed' }];

export type CorporateEnquiry = {
  id: string; reference: string; company: string; contactName: string; email: string; phone?: string | null; teamSize: string; interests: string[]; message: string | null;
  consentVersion: string; consentText: string | null; consentAt: string; status: CorporateStatus; assignedTo: Person | null; createdAt: string; updatedAt: string; closedAt: string | null; noteCount: number; notes?: Note[];
};
export type CorporateStatus = 'new' | 'contacted' | 'in_discussion' | 'closed';
export const CORPORATE_STATUSES: Array<{ id: CorporateStatus; label: string }> = [{ id: 'new', label: 'New' }, { id: 'contacted', label: 'Contacted' }, { id: 'in_discussion', label: 'In discussion' }, { id: 'closed', label: 'Closed' }];
export const CORPORATE_INTEREST_LABELS: Record<string, string> = { coaching: 'Coaching for team members', blood_tests: 'Blood tests for team members', live_sessions: 'Group sessions and webinars', courses: 'Courses in the app', other: 'Something else' };

export type Subscriber = { id: string; email: string; status: 'pending' | 'confirmed' | 'unsubscribed'; consentVersion: string; consentText: string | null; source: string; requestedAt: string; confirmedAt: string | null; unsubscribedAt: string | null; confirmExpiresAt: string | null };

export const SOURCE_LABELS: Record<string, string> = { website: 'Discovery call page', package_finder: 'Package finder', calculators: 'Health calculators', webinars: 'Webinars page', corporate: 'Corporate page', footer: 'Footer sign-up' };

/** One pill per status, in the colours the portal already uses for these states. */
const PILL_KIND: Record<string, string> = { new: 'new', contacted: 'in_progress', booked: 'scheduled', in_discussion: 'in_progress', closed: 'closed', pending: 'pending', confirmed: 'confirmed', unsubscribed: 'cancelled', published: 'published', withdrawn: 'cancelled' };
const PILL_WORD: Record<string, string> = { new: 'New', contacted: 'Contacted', booked: 'Booked', in_discussion: 'In discussion', closed: 'Closed', pending: 'Waiting to confirm', confirmed: 'Confirmed', unsubscribed: 'Unsubscribed', published: 'Offered', withdrawn: 'Withdrawn' };
export function GrowthPill({ status }: { status: string }) { return <Pill status={PILL_KIND[status] ?? status}>{PILL_WORD[status] ?? status}</Pill>; }

/** "Mon 27 Oct, 18:30" in India time, as the website shows offered times. */
export function istLabel(iso?: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}
/** A datetime-local value read as India time ("2026-10-27T18:30" → ISO), so the team's times never depend on the browser's zone. */
export function istInputToIso(v: string): string | null { if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null; const t = Date.parse(`${v}:00+05:30`); return Number.isNaN(t) ? null : new Date(t).toISOString(); }
/** ISO → a datetime-local value in India time. */
export function isoToIstInput(iso?: string | null): string { if (!iso) return ''; return new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 16); }

export function PreferredTimes({ slots, windows }: { slots: Slot[]; windows: string | null }) {
  if (!slots.length && !windows) return <span className="muted">None given</span>;
  return <ul className="timeline">{slots.map((s) => <li key={s.id}>{s.label}{s.withdrawn && <span className="muted small"> · no longer offered</span>}</li>)}{windows && <li>“{windows}”</li>}</ul>;
}
