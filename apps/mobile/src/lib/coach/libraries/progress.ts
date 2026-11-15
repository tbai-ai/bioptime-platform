/* M2 Progress, the coach's check-in templates (/coach/checkin-templates): the shapes GET /coach/checkin-templates returns
   and the question rules the web's QuestionsEditor applies (apps/dashboard/src/modules/progress/shared.tsx). */

export type Metric = { metric: string; label: string; unit: string; min: number | null; max: number | null };
export type QuestionType = 'scale_1_5' | 'number' | 'text' | 'yes_no';
export type Question = { key: string; label: string; type: QuestionType; metric?: string };
export type Template = {
  id: string; title: string; description: string; questions: Question[]; scope: 'library' | 'coach';
  status: 'draft' | 'published' | 'archived'; createdBy: string; createdByName: string; createdAt: string; updatedAt: string; publishedAt: string | null;
};
export type TemplateList = { items: Template[]; metrics: Metric[]; questionTypes: QuestionType[] };

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = { scale_1_5: '1 to 5', number: 'Number', text: 'Free text', yes_no: 'Yes or no' };
export const QUESTION_TYPES: QuestionType[] = ['scale_1_5', 'number', 'text', 'yes_no'];
export const KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;
export const MAX_QUESTIONS = 20;

/** The web's question line: "{label} · {type}{ · logs {metric label}}". */
export function questionLine(q: Question, metrics: Metric[]): string {
  return `${q.label} · ${QUESTION_TYPE_LABELS[q.type]}${q.metric ? ` · logs ${metrics.find((m) => m.metric === q.metric)?.label ?? q.metric}` : ''}`;
}

/** A question of a type that logs nothing drops its metric (the web's cleanQuestion). */
export function cleanQuestion(q: Question): Question { return q.type === 'number' || q.type === 'scale_1_5' ? q : { key: q.key, label: q.label, type: q.type }; }

/** A key derived from the wording, unique among the template's questions (the web's keyFrom). */
export function keyFrom(text: string, all: Question[], self: number): string {
  const base = text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[^a-z]+/, '').slice(0, 30) || 'q';
  let key = base.length >= 2 ? base : `${base}_q`;
  let n = 2;
  while (all.some((q, k) => k !== self && q.key === key)) key = `${base}_${n++}`;
  return key;
}

/** What a typed key becomes: lower-case letters, digits and underscores, at most 40. */
export function cleanKey(v: string): string { return v.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40); }

/** The web's questionsReady: every question has a valid, unique key and at least three characters of wording. */
export function questionsReady(qs: Question[]): boolean {
  return qs.length > 0 && qs.every((q) => KEY_RE.test(q.key) && q.label.trim().length >= 3) && new Set(qs.map((q) => q.key)).size === qs.length;
}

/** The metrics a 1-to-5 question may log: the web limits them to metrics with a 1–5 range. */
export function scaleMetrics(metrics: Metric[]): Metric[] {
  return metrics.filter((m) => m.metric.endsWith('_1_5') || (m.min !== null && m.max !== null && m.min >= 1 && m.max <= 5));
}

export const EMPTY_QUESTION: Question = { key: '', label: '', type: 'scale_1_5' };

/** A client's weekly check-in (GET /coach/clients/:id/checkin-schedules → { items }). */
export type Schedule = { id: string; coachName: string; templateId: string; templateTitle: string; weekday: number; weekdayLabel: string; active: boolean; createdAt: string; endedAt: string | null };
/** The web's "Every" select: Sunday is 0, as the API counts (scheduleCreate weekday 0–6). */
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** The web's ScheduleLine: "Every {weekday}: “{template}”, set by {coach} on {date}." (date formatted by the caller). */
export function scheduleLine(s: Schedule, date: string): string { return `Every ${s.weekdayLabel}: “${s.templateTitle}”, set by ${s.coachName} on ${date}.`; }
