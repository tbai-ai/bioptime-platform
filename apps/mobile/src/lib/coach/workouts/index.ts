/* M6 Workouts in the coach workspace: the exercise library (/coach/exercise-library), the workout template editor
   (/coach/templates/:id, the web's /coach/workout-templates/:id) and the programme editor (/coach/workout-programs/:id).
   The shapes of GET /coach/exercise-library, GET /coach/workout-templates[/:id] and GET /coach/workout-programs/:id, the
   labels the web uses (apps/dashboard/src/modules/workouts/shared.tsx), the bodies the schemas in
   packages/domain/src/modules/workouts.ts accept, and the small helpers the three screens share. Nothing here fetches. */
import { ApiError } from '@/lib/api';
import { fmtDate, label } from '@/lib/format';

/* ---------- shapes ---------- */

export type Exercise = {
  id: string; name: string; description: string; instructions: string; category: string; equipment: string[]; muscleGroups: string[];
  source: 'team' | 'coach'; status: string; authorName: string | null; createdBy?: string | null; createdAt?: string; updatedAt: string; media?: null;
};
/** The media status the library carries (no media until licensed demonstration media and a video host exist). */
export type MediaStatus = { status?: string; missing: string[]; note?: string };
export type ExerciseList = { items: Exercise[]; media: MediaStatus | null };
export type TemplateRow = { id: string; title: string; description: string; level: string | null; estMinutes: number | null; source: 'team' | 'coach'; status: string; authorName: string | null; itemCount: number };
export type TemplateItem = { id: string; exerciseId: string; exerciseName: string; block: string; sets: number; reps: string | null; durationSeconds: number | null; restSeconds: number | null; loadNote: string; note: string };
export type Template = TemplateRow & { items: TemplateItem[] };
export type Structure = { weeks: Array<{ week: number; focus?: string; days: Array<{ day: number; templateId: string }> }> };
export type ProgramVersion = { id: string; version: number; status: string; title: string | null; startDate: string | null; summary: string; structure: Structure };
export type Program = {
  id: string; memberId: string; memberName: string; title: string; status: 'draft' | 'published' | 'archived'; currentVersion: number; startDate: string | null;
  draft: ProgramVersion | null; published: ProgramVersion | null;
  versions: Array<{ id: string; version: number; status: string; summary: string; createdAt: string; publishedAt: string | null }>;
  sessions: { completed: number; partial: number; skipped: number; scheduled: number };
  loggedWeeks: number[]; loggedDays: Array<{ week: number; day: number; templateId: string | null }>; templates: Record<string, { title: string }>;
};
/** A coach's client as GET /coach/clients lists them (the field policy strips every contact detail). */
export type ClientOption = { id: string; name: string };

/* ---------- the web's vocabulary (modules/workouts/shared.tsx) ---------- */

export const CATEGORIES = ['strength', 'core', 'mobility', 'conditioning', 'balance', 'recovery', 'other'] as const;
export const LEVELS = ['beginner', 'intermediate', 'advanced', 'all_levels'] as const;
export const DAY_NAMES = ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7'];

export function seconds(s: number): string { return s >= 120 && s % 60 === 0 ? `${s / 60} min` : `${s} s`; }
/** "3 × 8-10 · rest 60 s" or "2 × 30 s". */
export function prescription(i: { sets: number; reps?: string | null; durationSeconds?: number | null; restSeconds?: number | null }): string {
  const what = i.reps ? i.reps : i.durationSeconds ? seconds(i.durationSeconds) : '';
  return `${i.sets} × ${what}${i.restSeconds ? ` · rest ${seconds(i.restSeconds)}` : ''}`;
}
export function sourceLabel(s: string): string { return s === 'team' ? 'Bioptime team' : 'Coach'; }
/** A YYYY-MM-DD date (IST) as 12 Oct 2026. */
export function fmtDay(date?: string | null): string { return date ? fmtDate(`${date}T06:30:00.000Z`) : '—'; }
/** "1 exercise" / "3 exercises". */
export function plural(n: number, one: string, many = `${one}s`): string { return `${n} ${n === 1 ? one : many}`; }

export type Tone = 'info' | 'success' | 'warning' | 'error';
/** The web's <Pill status> for the library and programme statuses: published reads as done, draft as waiting,
 *  archived as neutral (the app's info pill is its neutral). */
export function statusPill(status?: string | null): { label: string; tone: Tone } {
  const s = status ?? '';
  return { label: label(s), tone: s === 'published' ? 'success' : s === 'draft' ? 'warning' : 'info' };
}

/* ---------- form helpers ---------- */

/** A typed number from a form field, null when empty. */
export function num(s: string | undefined | null): number | null { const t = (s ?? '').trim(); return t === '' ? null : Number(t); }
/** Keep a whole number's digits as they are typed (the web's inputMode="numeric"). */
export function digits(v: string): string { return v.replace(/\D/g, ''); }
/** "a, b ,c" → ['a', 'b', 'c'] (the web's list()). */
export function commaList(s: string): string[] { return s.split(',').map((x) => x.trim()).filter(Boolean); }

/** The API's validation issues ({ path: 'items.0.reps', message }) of a failed write, [] when it carries none. */
export function issuesOf(e: unknown): Array<{ path: string; message: string }> {
  if (!(e instanceof ApiError)) return [];
  const d = e.details as unknown;
  const list: unknown[] = Array.isArray(d) ? d : d && typeof d === 'object' && Array.isArray((d as { issues?: unknown[] }).issues) ? (d as { issues: unknown[] }).issues : [];
  return list.map((i) => {
    const x = i as { path?: unknown; message?: unknown };
    return { path: Array.isArray(x.path) ? x.path.map(String).join('.') : String(x.path ?? ''), message: String(x.message ?? '') };
  }).filter((i) => i.message);
}
/** Field errors by the first path segment ('title', 'items', 'structure'), as the web's pages map them. */
export function fieldErrorsOf(e: unknown): Record<string, string> { return e instanceof ApiError ? e.fieldErrors() : {}; }
/** The issue of one row of a list ('items.2.reps' → row 2), so the tile it belongs to can show it. */
export function rowIssues(e: unknown, list: string): Record<number, string> {
  const out: Record<number, string> = {};
  for (const i of issuesOf(e)) {
    const m = new RegExp(`^${list}\\.(\\d+)(?:\\.|$)`).exec(i.path);
    if (m && out[Number(m[1])] === undefined) out[Number(m[1])] = i.message;
  }
  return out;
}

/* ---------- the template editor's rows ---------- */

/** One exercise row of the template editor, as typed (the web's Item). */
export type ItemDraft = { key: string; exerciseId: string; block: string; sets: string; reps: string; durationSeconds: string; restSeconds: string; loadNote: string; note: string };
let seq = 0;
const nextKey = () => `row-${Date.now().toString(36)}-${(seq += 1)}`;
/** A new row: 3 sets, 60 s rest, as the web's blankItem. */
export const blankItem = (): ItemDraft => ({ key: nextKey(), exerciseId: '', block: '', sets: '3', reps: '', durationSeconds: '', restSeconds: '60', loadNote: '', note: '' });
export function itemDraftOf(i: TemplateItem): ItemDraft {
  return { key: nextKey(), exerciseId: i.exerciseId, block: i.block ?? '', sets: String(i.sets), reps: i.reps ?? '', durationSeconds: i.durationSeconds ? String(i.durationSeconds) : '', restSeconds: i.restSeconds != null ? String(i.restSeconds) : '', loadNote: i.loadNote ?? '', note: i.note ?? '' };
}
/** The body of POST/PATCH /coach/workout-templates, built as the web builds it: rows without an exercise are left out. */
export function templateBody(f: { title: string; description: string; level: string; estMinutes: string; items: ItemDraft[] }): Record<string, unknown> {
  return {
    title: f.title, description: f.description, level: f.level || null, estMinutes: num(f.estMinutes),
    items: f.items.filter((i) => i.exerciseId).map((i) => ({ exerciseId: i.exerciseId, block: i.block, sets: Number(i.sets), reps: i.reps.trim() || null, durationSeconds: num(i.durationSeconds), restSeconds: num(i.restSeconds), loadNote: i.loadNote, note: i.note })),
  };
}
/** The kept rows' positions: the API's 'items.N' counts only rows with an exercise. */
export function keptIndex(items: ItemDraft[]): Record<number, number> {
  const out: Record<number, number> = {};
  let n = 0;
  items.forEach((i, k) => { if (i.exerciseId) { out[n] = k; n += 1; } });
  return out;
}

/* ---------- the programme editor's weeks ---------- */

/** One week of the programme editor, as typed; a locked day is one the client already logged or skipped. */
export type DayDraft = { key: string; day: number; templateId: string; locked?: boolean };
export type WeekDraft = { key: string; week: number; focus: string; days: DayDraft[] };
export const newDay = (day: number, templateId = '', locked = false): DayDraft => ({ key: nextKey(), day, templateId, locked });
export const newWeek = (week: number, days: DayDraft[] = [], focus = ''): WeekDraft => ({ key: nextKey(), week, focus, days });
/** The structure the API keeps: focus only when written, days only with a template. */
export function structureOf(weeks: WeekDraft[]): Structure {
  return { weeks: weeks.map((w) => ({ week: w.week, ...(w.focus.trim() ? { focus: w.focus.trim() } : {}), days: w.days.filter((d) => d.templateId).map((d) => ({ day: d.day, templateId: d.templateId })) })) };
}
/** The weeks of a programme as the editor shows them: the draft revision when there is one, else the published one;
 *  a day the client logged or skipped stays in its week and day with the same template (locked). */
export function weeksOf(p: Program): WeekDraft[] {
  const v = p.draft ?? p.published;
  const ws = v?.structure?.weeks ?? [];
  const isLogged = (week: number, d: { day: number; templateId: string }) => (p.loggedDays ?? []).some((x) => x.week === week && x.day === d.day && x.templateId === d.templateId);
  return ws.map((w) => newWeek(w.week, (w.days ?? []).map((d) => newDay(d.day, d.templateId, isLogged(w.week, d))), w.focus ?? ''));
}
