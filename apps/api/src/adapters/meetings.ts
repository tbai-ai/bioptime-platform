/* The meeting-provider seam (MEETING_PROVIDER). No video provider is chosen yet (Zoom, Meet, Daily and others are an
   open owner decision), so the only implementation is `none`: it creates nothing and returns no link. A consultation's
   or a live session's join link is then whatever the coach or host typed (checked by checkJoinUrl), or nothing, and the
   member is told that their coach will share how to join. GET /admin/integrations shows the seam as
   "pending configuration" with the missing requirement named (api/adapters/registry.ts).

   createMeeting is synchronous because it runs inside the booking transaction. A networked provider added later should
   keep it that way: return { joinUrl: null } here and create the meeting from the outbox (a domain event), then store
   the link, so a slow provider never holds a booking open. */
import type { Config } from '../config.js';
import { errors } from '../lib/errors.js';

export type MeetingKind = 'appointment' | 'live_session';
export type MeetingRequest = { kind: MeetingKind; refId: string; title: string; startAt: string; endAt: string; timezone: string; hostId: string | null };
export type MeetingResult = { provider: string; joinUrl: string | null; meetingRef: string | null };

export type MeetingProvider = {
  name: string;
  configured: boolean;
  /** What is missing before meetings are created automatically, named exactly; empty when nothing is. */
  missing: string[];
  /** Create (or reserve) the meeting for a confirmed consultation or a published session. `none` creates nothing. */
  createMeeting(req: MeetingRequest): MeetingResult;
  /** Release a meeting the provider created. `none` has nothing to release. */
  cancelMeeting(ref: { provider: string; meetingRef: string | null }): void;
};

export const noneMeetingProvider: MeetingProvider = {
  name: 'none',
  configured: false,
  missing: ['A video meeting provider: MEETING_PROVIDER accepts only "none"'],
  createMeeting: () => ({ provider: 'none', joinUrl: null, meetingRef: null }),
  cancelMeeting: () => {},
};

export function meetingProvider(config: Pick<Config, 'MEETING_PROVIDER'>): MeetingProvider {
  switch (config.MEETING_PROVIDER) {
    case 'none':
    default:
      return noneMeetingProvider;
  }
}

/** The placeholder a confirmed consultation used to get. It never led to a meeting, so it is never shown. */
const PLACEHOLDER_HOST = 'meet.bioptime.example';
export function isPlaceholderLink(url: string | null | undefined): boolean {
  if (!url) return false;
  try { return new URL(url).hostname.toLowerCase() === PLACEHOLDER_HOST; } catch { return false; }
}

/** Whitespace or a control character (C0, DEL, C1, and the Unicode line and paragraph separators). new URL() silently
 *  drops tabs and line breaks, so a link is checked for these before it is parsed: a line break in a stored link would
 *  otherwise end the URL line of a calendar file and let the rest of the value become calendar properties. */
const UNSAFE_IN_LINK = /[\s\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
export function hasUnsafeLinkChars(url: string): boolean { return UNSAFE_IN_LINK.test(url); }

/** A link fit to show a member: https, not the placeholder, no whitespace or control character. Anything else (an old
 *  placeholder, a malformed value) is null. */
export function shownLink(url: string | null | undefined): string | null {
  if (!url || hasUnsafeLinkChars(url) || isPlaceholderLink(url)) return null;
  try { return new URL(url).protocol === 'https:' ? url : null; } catch { return null; }
}

/** A join link a coach or host typed: https only, at most 500 characters, no whitespace or control character, no user
 *  name or password in it, not the placeholder. Returns the parsed link (URL.href: the same link in its normal form)
 *  or fails with JOIN_URL_INVALID. */
export function checkJoinUrl(raw: string): string {
  const value = raw.trim();
  if (hasUnsafeLinkChars(value)) throw errors.badRequest('Meeting links cannot contain spaces or line breaks', 'JOIN_URL_INVALID');
  let u: URL;
  try { u = new URL(value); } catch { throw errors.badRequest('Paste the full meeting link, starting with https://', 'JOIN_URL_INVALID'); }
  if (u.protocol !== 'https:') throw errors.badRequest('Meeting links must start with https://', 'JOIN_URL_INVALID');
  if (u.username || u.password) throw errors.badRequest('Meeting links cannot carry a user name or password', 'JOIN_URL_INVALID');
  const link = u.href;
  if (value.length > 500 || link.length > 500) throw errors.badRequest('That link is too long (500 characters at most)', 'JOIN_URL_INVALID');
  if (isPlaceholderLink(link)) throw errors.badRequest('That is not a meeting link', 'JOIN_URL_INVALID');
  return link;
}

/** The host of a link, for the audit log (the link itself may carry a passcode, so it is not recorded). */
export function linkHost(url: string | null): string | null {
  if (!url) return null;
  try { return new URL(url).hostname; } catch { return null; }
}
