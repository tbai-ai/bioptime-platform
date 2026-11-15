/* M9 Announcements in the administrative portal (/admin/announcements, announcements.manage): the shapes of
   GET /admin/announcements and GET /admin/announcements/options, and the web's wording helpers
   (apps/dashboard/src/modules/messaging/shared.tsx:14-21, :66-87). Nothing here fetches. */
import { fmtDateTime } from '@/lib/format';

export type AnnouncementStatus = 'draft' | 'scheduled' | 'published' | 'withdrawn';
export type ManagedAnnouncement = {
  id: string; title: string; body: string; origin: 'team' | 'coach'; status: AnnouncementStatus;
  audience: { roles: string[]; packageIds: string[]; packages: Array<{ id: string; name: string }>; coachId: string | null; coachName: string | null };
  reach: { members: number | null; reads: number };
  publishAt: string | null; publishedAt: string | null; withdrawnAt: string | null; withdrawReason: string | null;
  createdBy: { id: string; name: string | null }; publishedBy: { id: string; name: string | null } | null; withdrawnBy: { id: string; name: string | null } | null;
  createdAt: string; updatedAt: string;
};
export type AnnouncementOptions = { packages: Array<{ id: string; name: string; kind: string; active: boolean }>; coaches: Array<{ id: string; name: string }>; allMembers: number };

/** The web's AnnouncementStatus pill: Draft / Scheduled / Published / Withdrawn, in the portal's tones. */
export const STATUS_PILL: Record<AnnouncementStatus, { label: string; tone: 'warning' | 'info' | 'success' }> = {
  draft: { label: 'Draft', tone: 'warning' }, scheduled: { label: 'Scheduled', tone: 'info' }, published: { label: 'Published', tone: 'success' }, withdrawn: { label: 'Withdrawn', tone: 'info' },
};
export const STATUS_WORD: Record<AnnouncementStatus, string> = { draft: 'Draft', scheduled: 'Scheduled', published: 'Published', withdrawn: 'Withdrawn' };

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

/** The team may rewrite a draft or a scheduled announcement of its own; anything else opens read only. */
export function isEditable(a: ManagedAnnouncement | null): boolean {
  return !a || (a.origin === 'team' && (a.status === 'draft' || a.status === 'scheduled'));
}
