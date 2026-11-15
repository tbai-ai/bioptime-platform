/* M9 shared pieces: message files (a chip per file that opens through a 5-minute token) and announcement text.
   New class names only (messaging.css); everything else is the portal's existing components. */
import React from 'react';
import { api } from '../../lib/api';
import { openLater } from '../../lib/ids';
import { fmtDateTime } from '../../lib/format';
import { Pill } from '../../ui';
import './messaging.css';

export type Attachment = { id: string; messageId: string | null; conversationId: string; name: string; mime: string; bytes: number; kind: 'image' | 'pdf'; sent: boolean; mine: boolean; uploadedBy: string; createdAt: string };

export type MemberAnnouncement = { id: string; title: string; body: string; origin: 'team' | 'coach'; from: string; publishedAt: string; read: boolean; readAt: string | null };

export type ManagedAnnouncement = {
  id: string; title: string; body: string; origin: 'team' | 'coach'; status: 'draft' | 'scheduled' | 'published' | 'withdrawn';
  audience: { roles: string[]; packageIds: string[]; packages: Array<{ id: string; name: string }>; coachId: string | null; coachName: string | null };
  reach: { members: number | null; reads: number };
  publishAt: string | null; publishedAt: string | null; withdrawnAt: string | null; withdrawReason: string | null;
  createdBy: { id: string; name: string | null }; publishedBy: { id: string; name: string | null } | null; withdrawnBy: { id: string; name: string | null } | null;
  createdAt: string; updatedAt: string;
};

/** What the server accepts (it checks again, by content). */
export const ATTACH_ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf';
export const ATTACH_MAX_BYTES = 5 * 1024 * 1024;
export const ATTACH_MAX_PER_MESSAGE = 5;

export function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toLocaleString('en-IN', { maximumFractionDigits: 1 })} MB`;
  return `${Math.max(1, Math.ceil(n / 1024))} KB`;
}

/** A picked file as base64 for the JSON upload. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('The file could not be read'));
    r.onload = () => { const s = String(r.result ?? ''); resolve(s.slice(s.indexOf(',') + 1)); };
    r.readAsDataURL(file);
  });
}

/** Opens a file in a new tab through a 5-minute token (no permanent link exists). The tab is opened during the click
 *  (so no popup blocker stops it) and cut off from this page (opener cleared) before the token's URL loads in it.
 *  window.open with 'noopener' would return null and leave an empty tab behind, so it is not used here. */
export function openAttachment(id: string, onError: (e: unknown) => void): void {
  const w = window.open('', '_blank');
  if (!w) { openLater(() => api.post<{ url: string }>(`/attachments/${id}/file-token`).then((t) => t.url), onError); return; }
  w.opener = null;
  api.post<{ url: string }>(`/attachments/${id}/file-token`).then((t) => { w.location.href = t.url; }, (e) => { w.close(); onError(e); });
}

/** The files on a message (or waiting in the composer): name, type and size; a click opens one. */
export function AttachmentChips({ items, onOpen, onRemove, busy }: { items: Attachment[]; onOpen?: (a: Attachment) => void; onRemove?: (a: Attachment) => void; busy?: string | null }) {
  if (!items.length) return null;
  return <ul className="msgFiles" aria-label="Files">
    {items.map((a) => <li key={a.id} className="msgFile">
      {onOpen ? <button type="button" className="msgFileOpen" onClick={() => onOpen(a)} title={`Open ${a.name}`}><span className="msgFileKind">{a.kind === 'pdf' ? 'PDF' : 'IMG'}</span><span className="msgFileName">{a.name}</span><span className="msgFileSize">{fmtBytes(a.bytes)}</span></button>
        : <span className="msgFileOpen"><span className="msgFileKind">{a.kind === 'pdf' ? 'PDF' : 'IMG'}</span><span className="msgFileName">{a.name}</span><span className="msgFileSize">{fmtBytes(a.bytes)}</span></span>}
      {onRemove && <button type="button" className="msgFileRemove" disabled={busy === a.id} onClick={() => onRemove(a)} aria-label={`Remove ${a.name}`}>×</button>}
    </li>)}
  </ul>;
}

/** Plain text with its line breaks (the server removed any markup). */
export function AnnouncementBody({ text }: { text: string }) { return <p className="annBody">{text}</p>; }

const STATUS_TONE: Record<ManagedAnnouncement['status'], string> = { draft: 'draft', scheduled: 'scheduled', published: 'published', withdrawn: 'cancelled' };
const STATUS_TEXT: Record<ManagedAnnouncement['status'], string> = { draft: 'Draft', scheduled: 'Scheduled', published: 'Published', withdrawn: 'Withdrawn' };
export function AnnouncementStatus({ a }: { a: ManagedAnnouncement }) { return <Pill status={STATUS_TONE[a.status]}>{STATUS_TEXT[a.status]}</Pill>; }

/** When it went or goes out, in words. */
export function whenText(a: ManagedAnnouncement): string {
  if (a.status === 'published') return `Published ${fmtDateTime(a.publishedAt)}`;
  if (a.status === 'scheduled') return `Goes out ${fmtDateTime(a.publishAt)}`;
  if (a.status === 'withdrawn') return `Withdrawn ${fmtDateTime(a.withdrawnAt)}`;
  return `Draft, last changed ${fmtDateTime(a.updatedAt)}`;
}

/** Who it reaches, in words. */
export function audienceText(a: ManagedAnnouncement): string {
  if (a.origin === 'coach') return `${a.audience.coachName ?? 'The coach'}’s own clients`;
  const parts: string[] = [];
  if (a.audience.packages.length) parts.push(`members on ${a.audience.packages.map((p) => p.name).join(', ')}`);
  if (a.audience.coachName) parts.push(`${a.audience.coachName}’s clients`);
  return parts.length ? parts.join(' who are ').replace(/^./, (c) => c.toUpperCase()) : 'Every member';
}

/** A local date-time input value (yyyy-mm-ddThh:mm) as an ISO instant, or null. */
export function localToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
