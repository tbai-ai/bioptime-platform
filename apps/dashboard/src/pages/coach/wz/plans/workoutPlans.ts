/* Coach workspace: the workout plans the Workouts page lists, from what Bioptime's workouts module
   really holds (GET /coach/workout-templates, GET /coach/workout-programs).
   - A workout template is one session (exercises in order with sets, reps or time, rest): a "Daily" plan. Its source is
     the Bioptime team (published team templates) or the coach (their own). Its categories are those of its exercises,
     as the template list sends them (`categories`: the distinct exercise-library categories).
   - A workout programme is weeks of days, one template per training day, written for one client: "Weekly" when it runs
     under four weeks, "Monthly" from four weeks on. Programmes are the coach's own (they belong to the coach's clients). */

export type Frequency = 'daily' | 'weekly' | 'monthly';
export const FREQUENCY_LABEL: Record<Frequency, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };

type Structure = { weeks: Array<{ week: number; focus?: string; days: Array<{ day: number; templateId: string }> }> };

export type TemplatePlan = {
  kind: 'template'; id: string; title: string; description: string; frequency: 'daily'; source: 'team' | 'coach';
  level: string | null; estMinutes: number | null; exercises: number; categories: string[]; updatedAt: string;
};
export type ProgrammePlan = {
  kind: 'programme'; id: string; title: string; frequency: 'weekly' | 'monthly'; source: 'coach'; status: string; draftRevision: boolean;
  memberId: string; memberName: string; weeks: number; sessions: number; structure: Structure; categories: string[]; updatedAt: string;
};
export type WorkoutPlan = TemplatePlan | ProgrammePlan;

export function templatePlan(t: any): TemplatePlan {
  const cats = [...new Set(((Array.isArray(t.categories) ? t.categories : []) as unknown[]).filter((c): c is string => typeof c === 'string' && !!c))];
  return { kind: 'template', id: t.id, title: t.title, description: t.description ?? '', frequency: 'daily', source: t.source === 'team' ? 'team' : 'coach', level: t.level ?? null, estMinutes: t.estMinutes ?? null, exercises: Number(t.itemCount ?? 0), categories: cats, updatedAt: t.updatedAt ?? '' };
}

/** A programme as a plan: its draft revision when one is open (what the coach is shaping), else the published version. */
export function programmePlan(p: any, categoriesOf: (templateId: string) => string[]): ProgrammePlan | null {
  const v = p.draft ?? p.published;
  const structure: Structure = { weeks: ((v?.structure?.weeks ?? []) as any[]).map((w) => ({ week: w.week, ...(w.focus ? { focus: w.focus } : {}), days: ((w.days ?? []) as any[]).map((d) => ({ day: d.day, templateId: d.templateId })) })) };
  const weeks = structure.weeks.length;
  if (!weeks) return null;
  const sessions = structure.weeks.reduce((n, w) => n + w.days.length, 0);
  const tids = new Set(structure.weeks.flatMap((w) => w.days.map((d) => d.templateId)));
  const categories = [...new Set([...tids].flatMap((id) => categoriesOf(id)))];
  return { kind: 'programme', id: p.id, title: (p.draft?.title as string | undefined) ?? p.title, frequency: weeks >= 4 ? 'monthly' : 'weekly', source: 'coach', status: p.status, draftRevision: !!p.draft && p.status === 'published', memberId: p.memberId, memberName: p.memberName, weeks, sessions, structure, categories, updatedAt: p.updatedAt ?? '' };
}
