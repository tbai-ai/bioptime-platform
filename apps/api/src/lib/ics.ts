/* Calendar files (RFC 5545) for a consultation or a live session, downloaded by the signed-in person
   (GET /me/appointments/:id/ics, GET /me/sessions/:id/ics). No calendar provider is involved: the file is built here and
   served once; nothing is subscribed or synced (CALENDAR_PROVIDER is "none").

   Times are written in the record's own zone. India has one fixed offset (+05:30, no daylight saving), so Asia/Kolkata
   events carry TZID=Asia/Kolkata local times with the matching VTIMEZONE; any other zone is written in UTC. Lines end in
   CRLF and are folded at 75 octets; text values are escaped. A file never carries an email address, a phone number or
   any health detail, and carries a join link only when a real one exists (and only one with no whitespace or control
   character in it, so a stored value can never add a calendar property). */
import { IST_OFFSET_MINUTES } from './time.js';

export type IcsEvent = {
  uid: string;
  title: string;
  description?: string;
  startAt: string;
  endAt: string;
  timezone?: string;
  url?: string | null;
  status?: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
  /** Bumped when the time changes, so calendars replace the earlier copy. */
  sequence?: number;
};

const CRLF = '\r\n';
/** Whitespace or a control character, never allowed in a URI value written to the file. */
const UNSAFE_URI = /[\s\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const IST_ZONE = 'Asia/Kolkata';

/** Escape a TEXT value: backslash, semicolon, comma and line breaks. */
export function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

/** Fold a content line at 75 octets (continuation lines start with one space), never inside a UTF-8 character. */
export function foldLine(line: string): string {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, 'utf8');
    const limit = out.length === 0 ? 75 : 74; // a continuation line's leading space counts
    if (bytes + size > limit) { out.push(current); current = ''; bytes = 0; }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join(`${CRLF} `);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 20261024T130000Z */
export function icsUtc(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** 20261024T183000, the wall-clock time in India. */
export function icsIstLocal(iso: string): string {
  const d = new Date(new Date(iso).getTime() + IST_OFFSET_MINUTES * 60_000);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

function when(name: 'DTSTART' | 'DTEND', iso: string, zone: string): string {
  return zone === IST_ZONE ? `${name};TZID=${IST_ZONE}:${icsIstLocal(iso)}` : `${name}:${icsUtc(iso)}`;
}

const VTIMEZONE_IST = [
  'BEGIN:VTIMEZONE', `TZID:${IST_ZONE}`,
  'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0530', 'TZOFFSETTO:+0530', 'TZNAME:IST', 'END:STANDARD',
  'END:VTIMEZONE',
];

/** One calendar with these events, as the text of an .ics file. `now` stamps DTSTAMP. */
export function icsCalendar(events: IcsEvent[], now: string): string {
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Bioptime//Platform//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  if (events.some((e) => (e.timezone ?? IST_ZONE) === IST_ZONE)) lines.push(...VTIMEZONE_IST);
  for (const e of events) {
    const zone = e.timezone ?? IST_ZONE;
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${icsUtc(now)}`, when('DTSTART', e.startAt, zone), when('DTEND', e.endAt, zone), `SUMMARY:${icsEscape(e.title)}`);
    if (e.description) lines.push(`DESCRIPTION:${icsEscape(e.description)}`);
    // A URI value is not escaped like TEXT, so a link with whitespace or a control character in it (a line break would
    // end this line and start new calendar properties) is left out rather than written.
    if (e.url && !UNSAFE_URI.test(e.url)) lines.push(`URL:${e.url}`);
    lines.push(`STATUS:${e.status ?? 'CONFIRMED'}`, `SEQUENCE:${e.sequence ?? 0}`, 'TRANSP:OPAQUE', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join(CRLF) + CRLF;
}

/** A download name such as bioptime-consultation-2026-10-24.ics (date in India). */
export function icsFilename(prefix: string, startAt: string): string {
  const safe = prefix.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'event';
  return `bioptime-${safe}-${icsIstLocal(startAt).slice(0, 4)}-${icsIstLocal(startAt).slice(4, 6)}-${icsIstLocal(startAt).slice(6, 8)}.ics`;
}
