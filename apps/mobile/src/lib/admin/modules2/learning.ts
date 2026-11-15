/* M10 Learning in the administrative portal (/admin/learning and /admin/learning/:id, learning.manage): the shapes of
   GET /admin/courses, GET /admin/courses/:id and GET /admin/learning/options, and the web's labels
   (apps/dashboard/src/modules/learning/shared.tsx:27-56). Nothing here fetches. */
import { label } from '@/lib/format';

export type Cover = { assetId?: string; url: string; width?: number | null; height?: number | null };
export type VideoStatus = { status: string; missing: string[]; note: string; provider?: string };
export type CourseRow = {
  id: string; title: string; slug: string; audience: string; status: string; updatedAt: string;
  packages: Array<{ name: string }>; lessonCounts: { published: number; draft: number }; enrolments: { active: number; completed: number };
};
export type Lesson = { id: string; moduleId: string; title: string; kind: string; body: string; durationMinutes: number | null; status: string; completedBy: number; updatedAt: string };
export type CourseModule = { id: string; title: string; lessons: Lesson[] };
export type Course = {
  id: string; title: string; slug: string; summary: string; audience: string; status: string; packageIds: string[]; coverAssetId: string | null; cover: Cover | null;
  createdByName: string | null; createdAt: string; updatedAt: string; publishedAt: string | null; archivedAt: string | null;
  enrolments: { active: number; completed: number; withdrawn: number }; lessonCounts: { published: number; draft: number }; modules: CourseModule[];
  video: VideoStatus;
};
export type LearningOptions = { packages: Array<{ id: string; name: string; active: boolean }>; images: Array<{ id: string; filename: string; alt: string; url?: string }>; video: VideoStatus };

export const AUDIENCES: Array<{ id: string; label: string; hint: string }> = [
  { id: 'all_members', label: 'Every member', hint: 'Any member can start it.' },
  { id: 'packages', label: 'Members with a package', hint: 'Members with an active programme of one of the chosen packages.' },
  { id: 'assigned_only', label: 'Assigned by a coach', hint: 'Only members a coach assigns it to.' },
  { id: 'coaches', label: 'Coaches (training)', hint: 'Coach training; members never see it.' },
];
export const audienceLabel = (id?: string | null) => AUDIENCES.find((a) => a.id === id)?.label ?? label(id);
export const audienceHint = (id?: string | null) => AUDIENCES.find((a) => a.id === id)?.hint;
export const KINDS: Array<{ id: string; label: string }> = [{ id: 'written', label: 'Written' }, { id: 'checklist', label: 'Checklist' }, { id: 'video', label: 'Video' }];
export const kindLabel = (id?: string | null) => KINDS.find((k) => k.id === id)?.label ?? label(id);

/** The web's CourseStatusPill: label(status) in the portal's tone (archived reads as closed). */
export function coursePill(status: string): { label: string; tone: 'success' | 'warning' | 'info' } {
  return { label: label(status), tone: status === 'published' ? 'success' : status === 'draft' ? 'warning' : 'info' };
}

/** The body of POST /admin/courses/:id/reorder for the modules in this order. */
export function orderBody(mods: CourseModule[]) { return { modules: mods.map((m) => ({ id: m.id, lessonIds: m.lessons.map((l) => l.id) })) }; }
/** A list with two neighbours swapped. */
export function swap<T>(list: T[], i: number, j: number): T[] { const out = [...list]; [out[i], out[j]] = [out[j]!, out[i]!]; return out; }

/** "{published} published · {draft} draft". */
export const lessonCountText = (c: { published: number; draft: number }) => `${c.published} published · ${c.draft} draft`;
/** A lesson's "Minutes" field: empty, or a whole number from 1 to 600. */
export function minutesOf(s: string): { value: number | null; bad: boolean } {
  const t = s.trim();
  if (!t) return { value: null, bad: false };
  const n = Number(t);
  return { value: n, bad: !(Number.isInteger(n) && n >= 1 && n <= 600) };
}
