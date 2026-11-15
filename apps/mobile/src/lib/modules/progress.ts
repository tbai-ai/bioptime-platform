/* M2 Progress: goals, check-ins, photos, range charts and adherence: the app entries of this module, and the shapes its
   screens share. Screens (each sets its own title with <Stack.Screen options>):
   - src/app/progress.tsx: check-ins waiting, one metric over a chosen range with every value's source, adherence;
   - src/app/goals.tsx: goals and milestones;
   - src/app/checkin/[id].tsx: answer a check-in, read the coach's reply;
   - src/app/photos.tsx: the photo consent, the member's photos and what is shared (adding a photo from the app needs
     expo-image-picker, which is not installed: pending, the member portal adds photos for now).
   Shown while the 'progress' flag is on; the photos entry also needs 'progressPhotos'. */
import type { ModuleEntry } from '../modules';

export const entries: ModuleEntry[] = [
  { key: 'progress', title: 'Progress and check-ins', sub: 'Trends over a range, check-ins from your coach, what you did', route: '/progress', icon: 'stats-chart-outline', placement: 'plan' },
  { key: 'progress', title: 'Goals', sub: 'Your goals and milestones', route: '/goals', icon: 'flag-outline', placement: 'plan' },
  { key: 'progress', feature: 'progressPhotos', title: 'Progress photos', sub: 'Private; your coach sees only the ones you share', route: '/photos', icon: 'images-outline', placement: 'me' },
];

export type Metric = { metric: string; label: string; unit: string; min: number | null; max: number | null };
export type Point = { at: string; value: number; source: string; sourceLabel: string };
export type Series = { metric: string; label: string; unit: string; from: string; to: string; points: Point[]; truncated: boolean; note: string };
export type Milestone = { id: string; title: string; targetValue?: number | null; dueDate: string | null; achievedAt: string | null };
export type Goal = {
  id: string; title: string; metric: string | null; metricLabel: string | null; unit: string | null; baselineValue?: number | null; targetValue?: number | null;
  latest?: { value: number; at: string; source: string; sourceLabel: string } | null; targetDate: string | null; status: 'active' | 'achieved' | 'paused' | 'dropped';
  createdByRole: 'member' | 'coach'; achievedAt: string | null; achievedHow: 'target_reached' | 'marked' | null; autoAchieve: boolean; milestones: Milestone[];
};
export type Question = { key: string; label: string; type: 'scale_1_5' | 'number' | 'text' | 'yes_no'; metric?: string };
export type Answer = number | string | boolean;
export type Checkin = {
  id: string; coachName: string; title: string; questions: Question[]; dueDate: string; status: 'requested' | 'submitted' | 'reviewed' | 'missed';
  answers?: Record<string, Answer> | null; submittedAt: string | null; reviewedAt: string | null; reviewedByName: string | null; response: string | null;
};
export type AdherenceLine = { key: string; label: string; due: number; done: number; pct: number | null; note?: string };

export const CHECKIN_STATUS: Record<Checkin['status'], [string, 'info' | 'success' | 'warning' | 'error']> = {
  requested: ['Waiting for your answers', 'warning'], submitted: ['Sent to your coach', 'info'], reviewed: ['Reviewed', 'success'], missed: ['Missed', 'info'],
};
export const GOAL_STATUS: Record<Goal['status'], [string, 'info' | 'success' | 'warning' | 'error']> = {
  active: ['Active', 'success'], achieved: ['Achieved', 'success'], paused: ['Paused', 'warning'], dropped: ['Dropped', 'info'],
};

/** A local date (India) as 12 Oct 2026, from YYYY-MM-DD. */
export const dayLabel = (date: string) => new Date(`${date}T06:30:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
