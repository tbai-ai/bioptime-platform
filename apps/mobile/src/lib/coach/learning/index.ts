/* M10 Learning in the coach workspace: the member courses a coach reads before assigning (/coach/courses) and the coach's
   own training (/coach/training). The shapes of GET /coach/courses, GET /coach/courses/:id, GET /coach/training,
   GET /coach/training/:id and GET /coach/lessons/:id, the labels and the per-mode endpoints the web uses
   (apps/dashboard/src/modules/learning/shared.tsx), and a reader for lesson bodies: the server keeps a lesson to the CMS
   formatting allowlist (p, br, strong/b, em/i, ul, ol, li, h3, a); the app turns that into blocks of styled text and never
   renders markup. Nothing here fetches. */
import { label } from '@/lib/format';

/* ---------- shapes ---------- */

export type Progress = { completed: number; total: number; pct: number | null; lastActivityAt?: string | null };
export type Enrollment = { id: string; source: string; status: string; enrolledAt: string; completedAt: string | null; assignedByName: string | null; assignedNote: string | null; progress: Progress };
export type Cover = { assetId?: string; url: string; width?: number | null; height?: number | null };
export type OutlineLesson = { id: string; title: string; kind: string; durationMinutes: number | null; progress: string | null };
export type OutlineModule = { id: string; title: string; lessons: OutlineLesson[] };
export type VideoStatus = { status: string; provider?: string; missing?: string[]; note: string };
export type Package = { id: string; name: string };
/** GET /coach/training lists these. */
export type CourseCard = { id: string; slug: string; title: string; summary: string; audience: string; status: string; cover: Cover | null; modules: number; lessons: number; minutes: number | null; access: string | null; locked?: boolean; enrollment: Enrollment | null; nextLessonId: string | null };
export type TrainingHome = { enrolled: CourseCard[]; available: CourseCard[]; video: VideoStatus };
/** GET /coach/courses: the published member courses a coach may assign, each with its outline. */
export type CatalogueCourse = { id: string; title: string; summary: string; audience: string; lessons: number; minutes: number | null; packages: Package[]; modules: OutlineModule[] };
/** GET /coach/courses/:id (preview) and GET /coach/training/:id. */
export type Course = {
  id: string; title: string; summary: string; cover: Cover | null; lessons: number; minutes: number | null; access?: string | null; archived?: boolean;
  enrollment?: Enrollment | null; modules: OutlineModule[]; nextLessonId: string | null; packages?: Package[]; audience: string; video: VideoStatus;
};
export type Lesson = {
  id: string; title: string; kind: string; body: string; bodyText?: string; durationMinutes: number | null; video: (VideoStatus & { ref: null }) | null;
  course: { id: string; title: string; status: string }; module: { id: string; title: string };
  position: { index: number; of: number }; prevLessonId: string | null; nextLessonId: string | null;
  enrolled: boolean; progress: { status: string; completedAt: string | null } | null; courseProgress: Progress | null; enrollmentStatus: string | null; preview?: boolean;
};

/* ---------- the web's labels ---------- */

const AUDIENCE: Record<string, string> = { all_members: 'Every member', packages: 'Members with a package', assigned_only: 'Assigned by a coach', coaches: 'Coaches (training)' };
export const audienceLabel = (id?: string | null) => AUDIENCE[id ?? ''] ?? label(id);
const KIND: Record<string, string> = { written: 'Written', checklist: 'Checklist', video: 'Video' };
export const kindLabel = (id?: string | null) => KIND[id ?? ''] ?? label(id);
const ACCESS: Record<string, string> = { all_members: 'Open to every member', package: 'Comes with your package', coach_assigned: 'From your coach', coaches: 'Coach training' };
export const accessLabel = (a?: string | null) => (a ? ACCESS[a] ?? label(a) : 'Access ended');
/** "Written · 10 min" */
export const lessonMeta = (l: { kind: string; durationMinutes: number | null }) => `${kindLabel(l.kind)}${l.durationMinutes ? ` · ${l.durationMinutes} min` : ''}`;
/** "3 lessons · about 20 min" */
export const lessonsText = (c: { lessons: number; minutes: number | null }) => `${c.lessons} ${c.lessons === 1 ? 'lesson' : 'lessons'}${c.minutes ? ` · about ${c.minutes} min` : ''}`;
/** "2 of 5 lessons", or "No lessons yet". */
export const progressText = (p: Progress) => (p.total ? `${p.completed} of ${p.total} lessons` : 'No lessons yet');
/** The web's EnrollmentPill: active reads "In progress", withdrawn "Left", else the status. */
export function enrollmentPill(status: string): { label: string; tone: 'info' | 'success' | 'warning' } {
  if (status === 'active') return { label: 'In progress', tone: 'warning' };
  if (status === 'withdrawn') return { label: 'Left', tone: 'info' };
  return { label: label(status), tone: status === 'completed' ? 'success' : 'info' };
}

/** Where each coach learning screen reads and writes (the web's MODES.training and MODES.preview). Training declares no
 *  "leave" (only members have it); preview declares no enrol, start or complete. */
export type LearnMode = 'training' | 'preview';
export const MODES: Record<LearnMode, { base: string; course: (id: string) => string; lesson: (id: string) => string; enroll?: (id: string) => string; start?: (id: string) => string; complete?: (id: string) => string; listLabel: string }> = {
  training: { base: '/coach/training', course: (id) => `/coach/training/${id}`, lesson: (id) => `/coach/lessons/${id}`, enroll: (id) => `/coach/training/${id}/enroll`, start: (id) => `/coach/lessons/${id}/start`, complete: (id) => `/coach/lessons/${id}/complete`, listLabel: 'Training' },
  preview: { base: '/coach/courses', course: (id) => `/coach/courses/${id}`, lesson: (id) => `/coach/lessons/${id}`, listLabel: 'Courses' },
};

/* ---------- a lesson body as blocks of styled text ---------- */

export type Run = { text: string; bold?: boolean; italic?: boolean; href?: string };
export type Block = { kind: 'p' | 'h3'; runs: Run[] } | { kind: 'li'; runs: Run[]; ordered: boolean; n: number };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…', middot: '·', times: '×' };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
/** Only an https link opens (in the in-app browser), as the web's safeHtml keeps it; a link inside the portal ('/…', '#…')
 *  has no page in the app, so it stays its text, like every other link. */
export function safeHref(href: string): string | undefined { return /^https:\/\/[^\s]+$/i.test(href) ? href : undefined; }

/** The allowlisted HTML of a lesson as blocks: paragraphs and h3 headings of runs (bold, italic, links), list items with
 *  their number; text outside any block becomes a paragraph; every other tag is dropped and its text kept. */
export function lessonBlocks(html: string): Block[] {
  const out: Block[] = [];
  let runs: Run[] = [];
  let kind: 'p' | 'h3' | 'li' | null = null;
  const lists: Array<{ ordered: boolean; n: number }> = [];
  let bold = 0; let italic = 0; let href: string | undefined;
  const flush = () => {
    const trimmed = trimRuns(runs);
    if (trimmed.length) {
      const list = lists[lists.length - 1];
      if (kind === 'li') out.push({ kind: 'li', runs: trimmed, ordered: !!list?.ordered, n: list ? list.n : 1 });
      else out.push({ kind: kind === 'h3' ? 'h3' : 'p', runs: trimmed });
    }
    runs = [];
  };
  const push = (text: string) => {
    if (!text) return;
    const t = decodeEntities(text).replace(/[ \t\r\n]+/g, ' ');
    if (!t) return;
    const last = runs[runs.length - 1];
    const run: Run = { text: t, ...(bold ? { bold: true } : {}), ...(italic ? { italic: true } : {}), ...(href ? { href } : {}) };
    if (last && !!last.bold === !!run.bold && !!last.italic === !!run.italic && last.href === run.href) last.text += t; else runs.push(run);
  };
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
  let at = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    push(html.slice(at, m.index));
    at = m.index + m[0].length;
    const closing = m[1] === '/'; const tag = m[2]!.toLowerCase();
    if (tag === 'p' || tag === 'h3') { flush(); kind = closing ? null : tag; }
    else if (tag === 'li') { flush(); if (closing) kind = null; else { kind = 'li'; const l = lists[lists.length - 1]; if (l) l.n += 1; } }
    else if (tag === 'ul' || tag === 'ol') { flush(); kind = null; if (closing) lists.pop(); else lists.push({ ordered: tag === 'ol', n: 0 }); }
    else if (tag === 'br') { const last = runs[runs.length - 1]; if (last) last.text += '\n'; }
    else if (tag === 'strong' || tag === 'b') bold = Math.max(0, bold + (closing ? -1 : 1));
    else if (tag === 'em' || tag === 'i') italic = Math.max(0, italic + (closing ? -1 : 1));
    else if (tag === 'a') { if (closing) href = undefined; else { const h = /href\s*=\s*("([^"]*)"|'([^']*)')/i.exec(m[3] ?? ''); href = h ? safeHref(decodeEntities(h[2] ?? h[3] ?? '')) : undefined; } }
  }
  push(html.slice(at));
  flush();
  return out;
}
function trimRuns(runs: Run[]): Run[] {
  const out = runs.map((r) => ({ ...r }));
  while (out.length && !out[0]!.text.replace(/^[ \n]+/, '')) out.shift();
  while (out.length && !out[out.length - 1]!.text.replace(/[ \n]+$/, '')) out.pop();
  if (out.length) { out[0]!.text = out[0]!.text.replace(/^[ \n]+/, ''); const l = out[out.length - 1]!; l.text = l.text.replace(/[ \n]+$/, ''); }
  return out;
}
