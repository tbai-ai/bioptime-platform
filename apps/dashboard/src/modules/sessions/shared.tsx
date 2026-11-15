/* M8 Live sessions: what the module's pages share, built from the existing components and classes (no new CSS):
   labels, IST date and time fields, the join-link line, the calendar-file link and the "is the module on" check that
   the core Appointments pages use before calling a module route. */
import React from 'react';
import { useFeatures } from '../runtime';
import { fmtDate, fmtTime } from '../../lib/format';
import { Pill } from '../../ui';

export const KINDS = [['group_class', 'Group class'], ['webinar', 'Webinar'], ['workshop', 'Workshop']] as const;
export const AUDIENCES: Record<string, string> = { members: 'Members with a live programme', packages: 'Members of chosen packages', public: 'Public (anyone, on the public listing)' };
export const AUDIENCE_SHORT: Record<string, string> = { members: 'Members', packages: 'Chosen packages', public: 'Public' };
export const LENGTHS = [30, 45, 60, 75, 90, 120, 180] as const;
/** What members read while no join link exists (the wording the portal and the app already use). */
export const COACH_WILL_SHARE = 'Your coach will share how to join.';

/** Is the sessions module on for the signed-in person? null while the flags load. Core pages ask before calling a
 *  module route, so they make the same requests as before while the module is off. */
export function useSessionsOn(): boolean | null {
  const features = useFeatures(true);
  return features ? features.has('sessions') : null;
}

/** "Sat 24 Oct 2026, 18:30 to 19:15 IST" */
export function fmtSpan(startAt: string, endAt: string): string {
  const weekday = new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(startAt));
  return `${weekday} ${fmtDate(startAt)}, ${fmtTime(startAt)} to ${fmtTime(endAt)} IST`;
}

/** Date and time fields are entered in India's time: YYYY-MM-DD and HH:MM → an ISO instant. */
export function istToIso(date: string, time: string): string { return new Date(`${date}T${time}:00+05:30`).toISOString(); }
export function isoToIstDate(iso: string): string { return new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10); }
export function isoToIstTime(iso: string): string { return new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(11, 16); }
export function minutesBetween(a: string, b: string): number { return Math.round((Date.parse(b) - Date.parse(a)) / 60_000); }

/** Only an https link is ever rendered as a link (the server accepts nothing else; this is the second guard). */
export function safeLink(url?: string | null): string | null {
  if (!url || /[\s\u0000-\u001f\u007f-\u009f]/.test(url)) return null; // no spaces, line breaks or control characters
  try { return new URL(url).protocol === 'https:' ? url : null; } catch { return null; }
}

/** The join line: the link the coach or host typed, or how members learn it. */
export function JoinLine({ url, fallback = COACH_WILL_SHARE, by = 'your coach' }: { url?: string | null; fallback?: string | null; by?: string }) {
  const link = safeLink(url);
  if (link) return <span className="small"><a href={link} target="_blank" rel="noopener noreferrer">Join</a> <span className="muted">· link shared by {by}</span></span>;
  return fallback ? <span className="small muted">{fallback}</span> : null;
}

/** A calendar file (.ics) the signed-in person downloads; the cookie session carries the request. */
export function CalendarLink({ href, label = 'Add to calendar' }: { href: string; label?: string }) {
  return <a className="bp-btn bp-btn-tertiary bp-btn-sm" href={`/api${href}`} download>{label}</a>;
}

/** A registration's status as a pill: registered, waitlist place, attended, no-show or cancelled. */
export function RegistrationPill({ status, position }: { status: string; position?: number | null }) {
  if (status === 'waitlisted') return <Pill status="pending">{position ? `Waitlist #${position}` : 'Waitlist'}</Pill>;
  if (status === 'registered') return <Pill status="scheduled">Registered</Pill>;
  if (status === 'attended') return <Pill status="completed">Attended</Pill>;
  if (status === 'no_show') return <Pill status="no_show">No-show</Pill>;
  return <Pill status="cancelled">Cancelled</Pill>;
}

/** The session's own status. */
export function SessionStatusPill({ status }: { status: string }) {
  return <Pill status={status}>{status === 'published' ? 'Open' : status === 'draft' ? 'Draft' : status === 'completed' ? 'Completed' : 'Cancelled'}</Pill>;
}

/** Places: "4 of 12 places", "Full", or "No limit". */
export function placesText(s: { capacity: number | null; counts?: { registered: number; attended: number; noShow: number; waitlisted: number }; spotsLeft?: number | null }): string {
  if (s.counts) {
    const held = s.counts.registered + s.counts.attended + s.counts.noShow;
    return `${held}${s.capacity ? ` of ${s.capacity}` : ''} registered${s.counts.waitlisted ? ` · ${s.counts.waitlisted} waiting` : ''}`;
  }
  if (s.capacity === null) return 'No limit on places';
  return s.spotsLeft === 0 ? 'Full: join the waitlist' : `${s.spotsLeft} of ${s.capacity} places left`;
}

/** A session's title, as it is shown in lists and on its page. */
export function SessionTitle({ s }: { s: { title: string } }) {
  return <b style={{ color: 'var(--bp-color-text-primary)' }}>{s.title}</b>;
}
