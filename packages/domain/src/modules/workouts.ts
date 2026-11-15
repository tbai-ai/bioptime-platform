/* M6 Workouts: the shared vocabulary and the request schemas of the workouts module (exercise library, workout
   templates, coach-authored programmes, sessions with set logs and effort ratings, coach feedback).

   Nothing here is content: the library ships empty apart from a few labelled sample exercises in the demo seed, and the
   lists below are the categories and levels a coach picks from, not claims about any exercise. No calorie figures, no
   injury-prevention or rehabilitation claims. Demonstration clips are served by the API itself (EXERCISE_MEDIA,
   api/domain/exerciseMedia.ts): an administrator maps an exercise to a clip of the media manifest (mediaRef). */
import { z } from 'zod';

/** How an exercise is filed in the library. */
export const EXERCISE_CATEGORIES = ['strength', 'core', 'mobility', 'conditioning', 'balance', 'recovery', 'other'] as const;
export type ExerciseCategory = (typeof EXERCISE_CATEGORIES)[number];

/** Library entries (exercises, templates) move draft → published → archived; an administrator holding library.manage
 *  publishes. A coach proposes exercises as drafts; the coach's own templates are usable from the start. */
export const LIBRARY_STATUSES = ['draft', 'published', 'archived'] as const;
export type LibraryStatus = (typeof LIBRARY_STATUSES)[number];

/** Who wrote a library entry: the Bioptime team (administrators) or a coach. */
export const LIBRARY_SOURCES = ['team', 'coach'] as const;

/** The level a template is written for, when its author says. */
export const WORKOUT_LEVELS = ['beginner', 'intermediate', 'advanced', 'all_levels'] as const;

export const WORKOUT_PROGRAM_STATUSES = ['draft', 'published', 'archived'] as const;
/** A session is generated when a programme version is published; the member completes it (all prescribed sets done,
 *  or nothing logged set by set), completes part of it, or skips it. */
export const WORKOUT_SESSION_STATUSES = ['scheduled', 'completed', 'partial', 'skipped'] as const;
export type WorkoutSessionStatus = (typeof WORKOUT_SESSION_STATUSES)[number];

/** Rating of perceived exertion: the member's own 1 to 10 rating of how hard the session felt. Self-reported. */
export const RPE_MIN = 1;
export const RPE_MAX = 10;

const shortList = z.array(z.string().trim().min(1).max(60)).max(20);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const exerciseInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).default(''),
  instructions: z.string().trim().max(4000).default(''),
  category: z.enum(EXERCISE_CATEGORIES),
  equipment: shortList.default([]),
  muscleGroups: shortList.default([]),
  /** Form and safety cues shown with the exercise (no injury-prevention or rehabilitation claims). */
  safetyNotes: z.string().trim().max(2000).default(''),
});
export const exercisePatchSchema = exerciseInputSchema.partial();
/** The key of a clip in the exercise media manifest (squats, box-jumps), or null for a text-only exercise. Set by an
 *  administrator only; the API checks the key against the manifest. */
export const exerciseMediaRefSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'A key of the exercise media manifest').max(80).nullable();
export const adminExerciseCreateSchema = exerciseInputSchema.extend({ status: z.enum(['draft', 'published']).optional(), mediaRef: exerciseMediaRefSchema.optional() });
export const adminExercisePatchSchema = exercisePatchSchema.extend({ mediaRef: exerciseMediaRefSchema.optional() });
/** GET /me/exercises: the published library for members, by category or words, a page at a time. */
export const memberExerciseQuerySchema = z.object({
  category: z.enum(EXERCISE_CATEGORIES).optional(),
  q: z.string().trim().max(80).optional(),
  cursor: z.string().max(400).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const libraryStatusSchema = z.object({ status: z.enum(LIBRARY_STATUSES), reason: z.string().trim().min(3).max(300) });

export const templateItemSchema = z.object({
  exerciseId: z.string().min(1).max(64),
  block: z.string().trim().max(40).default(''),
  sets: z.number().int().min(1).max(20),
  /** Text, so a range reads as written: "8", "8-10", "10 each side". */
  reps: z.string().trim().min(1).max(20).nullable().optional(),
  durationSeconds: z.number().int().min(1).max(7200).nullable().optional(),
  restSeconds: z.number().int().min(0).max(1800).nullable().optional(),
  loadNote: z.string().trim().max(200).default(''),
  note: z.string().trim().max(500).default(''),
}).refine((i) => !!i.reps || !!i.durationSeconds, { message: 'Give the reps or a duration for each exercise', path: ['reps'] });

export const templateInputSchema = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).default(''),
  level: z.enum(WORKOUT_LEVELS).nullable().optional(),
  estMinutes: z.number().int().min(1).max(600).nullable().optional(),
  items: z.array(templateItemSchema).max(40).default([]),
});
export const templatePatchSchema = templateInputSchema.partial();
/** A coach archives or restores their own template without a reason; team templates change status through the
 *  administrator's status route, with a reason. */
export const coachTemplatePatchSchema = templatePatchSchema.extend({ status: z.enum(['published', 'archived']).optional() });
export const adminTemplateCreateSchema = templateInputSchema.extend({ status: z.enum(['draft', 'published']).optional() });

/** A programme version: weeks of days, one template per training day (day 1 to 7 of the week). */
export const programStructureSchema = z.object({
  weeks: z.array(z.object({
    week: z.number().int().min(1).max(52),
    focus: z.string().trim().max(80).optional(),
    days: z.array(z.object({ day: z.number().int().min(1).max(7), templateId: z.string().min(1).max(64) })).max(7),
  })).max(52),
}).superRefine((s, ctx) => {
  const weeks = new Set<number>();
  s.weeks.forEach((w, wi) => {
    if (weeks.has(w.week)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['weeks', wi, 'week'], message: `Week ${w.week} appears twice` });
    weeks.add(w.week);
    const days = new Set<number>();
    w.days.forEach((d, di) => {
      if (days.has(d.day)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['weeks', wi, 'days', di, 'day'], message: `Week ${w.week} has day ${d.day} twice` });
      days.add(d.day);
    });
  });
});
export type ProgramStructure = z.infer<typeof programStructureSchema>;

export const programCreateSchema = z.object({
  memberId: z.string().min(1).max(64),
  title: z.string().trim().min(2).max(160),
  summary: z.string().trim().max(2000).default(''),
  startDate: isoDate.optional(),
  structure: programStructureSchema,
});
export const programPatchSchema = z.object({
  title: z.string().trim().min(2).max(160).optional(),
  summary: z.string().trim().max(2000).optional(),
  startDate: isoDate.optional(),
  structure: programStructureSchema.optional(),
});
/** An administrator's draft programme for a member (POST /admin/members/:id/workout-programs; the member is in the
 *  path). From scratch: `structure` (weeks of days, one template per day), or nothing yet (an empty draft, filled in
 *  with PATCH before publishing). From a template: `templateId` with `weeks` (default 4) and the `days` of the week it
 *  falls on (1 Monday to 7 Sunday, default 1, 3 and 5). Give `structure` or `templateId`, not both. */
export const adminProgramCreateSchema = z.object({
  title: z.string().trim().min(2).max(160),
  summary: z.string().trim().max(2000).default(''),
  startDate: isoDate.optional(),
  structure: programStructureSchema.optional(),
  templateId: z.string().min(1).max(64).optional(),
  weeks: z.number().int().min(1).max(52).optional(),
  days: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
}).superRefine((v, ctx) => {
  if (v.structure && v.templateId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['templateId'], message: 'Give a structure or a template, not both' });
  if (!v.templateId && (v.weeks !== undefined || v.days !== undefined)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['templateId'], message: 'weeks and days go with a template' });
  if (v.days && new Set(v.days).size !== v.days.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['days'], message: 'A day appears twice' });
});
export type AdminProgramCreate = z.infer<typeof adminProgramCreateSchema>;
export const programPublishSchema = z.object({ startDate: isoDate.optional() });
export const programArchiveSchema = z.object({ reason: z.string().trim().min(3).max(300) });

export const setLogSchema = z.object({
  itemId: z.string().min(1).max(64),
  setNumber: z.number().int().min(1).max(50),
  repsDone: z.number().int().min(0).max(1000).nullable().optional(),
  durationSeconds: z.number().int().min(0).max(86400).nullable().optional(),
  loadKg: z.number().min(0).max(1000).nullable().optional(),
  completed: z.boolean().default(true),
});
export const sessionCompleteSchema = z.object({
  sets: z.array(setLogSchema).max(400).default([]),
  rpe: z.number().int().min(RPE_MIN).max(RPE_MAX).nullable().optional(),
  durationMinutes: z.number().int().min(1).max(600).nullable().optional(),
  note: z.string().trim().max(1000).optional(),
});
export const sessionSkipSchema = z.object({ reason: z.string().trim().max(300).optional() });
export const sessionFeedbackSchema = z.object({ body: z.string().trim().min(2).max(4000) });
export const workoutRangeQuerySchema = z.object({ from: isoDate.optional(), to: isoDate.optional() });
