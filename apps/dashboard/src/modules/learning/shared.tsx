/* M10 Learning: what the module's pages share: labels as the API names them, the progress bar (the design system's
   bp-progress), a second, client-side pass over lesson HTML (the server already keeps it to the CMS allowlist), and
   where each workspace reads and writes. New CSS only under new class names (learning.css). */
import React, { useState } from 'react';
import { label } from '../../lib/format';
import { Pill } from '../../ui';
import './learning.css';

/** A course cover as the API returns it; width and height are the asset's, when the server knows them. */
export type CourseCoverImage = { assetId?: string; url: string; width?: number | null; height?: number | null };
/** The cover keeps its box while it loads, so the page does not jump: the image's own proportions when the API sends
    them, otherwise a 16:9 placeholder (learning.css) that gives way to the image's real proportions once it has loaded.
    A cover that cannot be loaded is hidden rather than left as an empty box; a new cover URL gets a fresh image element
    (keyed by URL), so a cover chosen after a failed one shows again. */
export function CourseCover({ cover }: { cover: CourseCoverImage }) {
  const [failed, setFailed] = useState<string | null>(null); // the URL that failed to load, so a new cover shows again
  if (failed === cover.url) return null;
  const ratio = cover.width && cover.height && cover.width > 0 && cover.height > 0 ? `auto ${cover.width} / ${cover.height}` : undefined;
  return <img key={cover.url} className="lrnCover" src={cover.url} alt="" width={cover.width ?? undefined} height={cover.height ?? undefined} style={ratio ? { aspectRatio: ratio } : undefined} onError={() => setFailed(cover.url)} />;
}
export type Progress = { completed: number; total: number; pct: number | null; lastActivityAt?: string | null };
export type Enrollment = { id: string; source: string; status: string; enrolledAt: string; completedAt: string | null; assignedByName: string | null; assignedNote: string | null; progress: Progress };
export type CourseCard = { id: string; slug: string; title: string; summary: string; audience: string; status: string; sample: boolean; cover: CourseCoverImage | null; modules: number; lessons: number; minutes: number | null; access: string | null; locked?: boolean; enrollment: Enrollment | null; nextLessonId: string | null };
export type OutlineModule = { id: string; title: string; lessons: Array<{ id: string; title: string; kind: string; durationMinutes: number | null; progress: string | null }> };
export type VideoStatus = { status: string; provider: string; missing: string[]; note: string };

export const AUDIENCES: Array<{ id: string; label: string; hint: string }> = [
  { id: 'all_members', label: 'Every member', hint: 'Any member can start it.' },
  { id: 'packages', label: 'Members with a package', hint: 'Members with an active programme of one of the chosen packages.' },
  { id: 'assigned_only', label: 'Assigned by a coach', hint: 'Only members a coach assigns it to.' },
  { id: 'coaches', label: 'Coaches (training)', hint: 'Coach training; members never see it.' },
];
export const audienceLabel = (id?: string | null) => AUDIENCES.find((a) => a.id === id)?.label ?? label(id);
export const KINDS: Array<{ id: string; label: string }> = [{ id: 'written', label: 'Written' }, { id: 'checklist', label: 'Checklist' }, { id: 'video', label: 'Video' }];
export const kindLabel = (id?: string | null) => KINDS.find((k) => k.id === id)?.label ?? label(id);
const SOURCES: Record<string, string> = { self: 'Chosen by the member', coach_assigned: 'Assigned by a coach', package: 'With their package' };
export const sourceLabel = (s?: string | null) => (s ? SOURCES[s] ?? label(s) : '—');
const ACCESS: Record<string, string> = { all_members: 'Open to every member', package: 'Comes with your package', coach_assigned: 'From your coach', coaches: 'Coach training' };
export const accessLabel = (a?: string | null) => (a ? ACCESS[a] ?? label(a) : 'Access ended');

/** "2 of 5 lessons" with the bar; nothing drawn when the course has no published lesson. */
export function ProgressBar({ p, compact }: { p: Progress; compact?: boolean }) {
  return <div className="stack" style={{ gap: 4 }}>
    {!compact && <span className="small">{p.total ? `${p.completed} of ${p.total} lessons` : 'No lessons yet'}</span>}
    {p.pct !== null && <div className="bp-progress bp-progress-success" role="progressbar" aria-label="Lessons completed" aria-valuemin={0} aria-valuemax={p.total} aria-valuenow={p.completed}><span style={{ width: `${p.pct}%` }} /></div>}
  </div>;
}

/** An enrolment's status as a pill. */
export function EnrollmentPill({ status }: { status: string }) {
  if (status === 'active') return <Pill status="in_progress">In progress</Pill>;
  if (status === 'withdrawn') return <Pill status="cancelled">Left</Pill>;
  return <Pill status={status} />;
}

export function CourseStatusPill({ status }: { status: string }) { return <Pill status={status === 'archived' ? 'closed' : status}>{label(status)}</Pill>; }

/** "Written · 10 min" */
export function lessonMeta(l: { kind: string; durationMinutes: number | null }): string {
  return `${kindLabel(l.kind)}${l.durationMinutes ? ` · ${l.durationMinutes} min` : ''}`;
}

const ALLOWED = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'UL', 'OL', 'LI', 'H3', 'A']);
/** Keep only the formatting tags the server allows and https or same-site links; everything else becomes its text. */
export function safeHtml(html: string): string {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        walk(el);
        if (!ALLOWED.has(el.tagName)) { el.replaceWith(...Array.from(el.childNodes)); continue; }
        for (const attr of Array.from(el.attributes)) if (!(el.tagName === 'A' && attr.name === 'href')) el.removeAttribute(attr.name);
        if (el.tagName === 'A') {
          const href = el.getAttribute('href') ?? '';
          if (!/^(https:\/\/|\/(?!\/)|#)/i.test(href)) { el.replaceWith(...Array.from(el.childNodes)); continue; }
          if (/^https:/i.test(href)) { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener'); }
        }
      } else if (child.nodeType !== Node.TEXT_NODE) child.remove();
    }
  };
  walk(tpl.content);
  return tpl.innerHTML;
}

/** A lesson body, sanitised again in the browser. */
export function LessonBody({ html }: { html: string }) {
  return <div className="lrnArticle" dangerouslySetInnerHTML={{ __html: safeHtml(html) }} />;
}

/** Where a learner reads and writes, by workspace: members (/client/learn), coaches' own training (/coach/training),
 *  and coaches reading a member course before assigning it (/coach/courses, read-only). */
export type Mode = 'client' | 'training' | 'preview';
export const MODES: Record<Mode, { base: string; course: (id: string) => string; lesson: (id: string) => string; enroll?: (id: string) => string; leave?: (id: string) => string; start?: (id: string) => string; complete?: (id: string) => string; listLabel: string }> = {
  client: { base: '/learn', course: (id) => `/me/courses/${id}`, lesson: (id) => `/me/lessons/${id}`, enroll: (id) => `/me/courses/${id}/enroll`, leave: (id) => `/me/courses/${id}/leave`, start: (id) => `/me/lessons/${id}/start`, complete: (id) => `/me/lessons/${id}/complete`, listLabel: 'Learn' },
  training: { base: '/training', course: (id) => `/coach/training/${id}`, lesson: (id) => `/coach/lessons/${id}`, enroll: (id) => `/coach/training/${id}/enroll`, start: (id) => `/coach/lessons/${id}/start`, complete: (id) => `/coach/lessons/${id}/complete`, listLabel: 'Training' },
  preview: { base: '/courses', course: (id) => `/coach/courses/${id}`, lesson: (id) => `/coach/lessons/${id}`, listLabel: 'Courses' },
};
