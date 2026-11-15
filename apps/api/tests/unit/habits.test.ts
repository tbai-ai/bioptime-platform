/* M1 Habits: the pure rules in @bioptime/domain/modules/habits (due dates, adherence, missed days, streaks, pauses,
   the payload schemas) and the timezone conversion the reminders use. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDaysToDate, adherence, closePause, datesBetween, dueDates, habitScheduleSchema, isActiveOn, isDueOn, isRealDate, isoWeekday,
  memberHabitCreateSchema, coachHabitUpdateSchema, missedDueDays, recentDays, reminderTimesSchema, scheduleLabel, streak, weekProgress, weekStart,
  type CheckinLite, type HabitSpan,
} from '@bioptime/domain/modules/habits';
import { localDate, localTimeToIso } from '../../src/domain/habits.js';

const span = (startDate: string, extra: Partial<HabitSpan> = {}): HabitSpan => ({ startDate, endDate: null, pausedRanges: [], pausedSince: null, archivedOn: null, ...extra });
const done = (...dates: string[]): CheckinLite[] => dates.map((date) => ({ date, status: 'done' as const }));

// 2026-10-19 is a Monday
test('dates: ISO weekdays, week starts, ranges and real dates', () => {
  assert.equal(isoWeekday('2026-10-19'), 1);
  assert.equal(isoWeekday('2026-10-25'), 7);
  assert.equal(weekStart('2026-10-25'), '2026-10-19');
  assert.equal(weekStart('2026-10-19'), '2026-10-19');
  assert.equal(addDaysToDate('2026-12-31', 1), '2027-01-01');
  assert.equal(addDaysToDate('2026-03-01', -1), '2026-02-28');
  assert.deepEqual(datesBetween('2026-10-30', '2026-11-02'), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  assert.deepEqual(datesBetween('2026-10-02', '2026-10-01'), []);
  assert.equal(isRealDate('2026-02-29'), false);
  assert.equal(isRealDate('2028-02-29'), true);
  assert.equal(isRealDate('2026-1-01'), false);
});

test('dueDates: every day, chosen weekdays, and none for a times-per-week habit', () => {
  assert.equal(dueDates({ type: 'daily' }, '2026-10-19', '2026-10-25').length, 7);
  assert.deepEqual(dueDates({ type: 'weekdays', weekdays: [1, 3, 5] }, '2026-10-19', '2026-10-25'), ['2026-10-19', '2026-10-21', '2026-10-23']);
  assert.deepEqual(dueDates({ type: 'weekdays', weekdays: [6, 7] }, '2026-10-19', '2026-10-23'), []);
  assert.deepEqual(dueDates({ type: 'times_per_week', timesPerWeek: 3 }, '2026-10-19', '2026-10-25'), []);
  assert.deepEqual(dueDates({ type: 'daily' }, '2026-10-25', '2026-10-19'), [], 'an empty range');
  assert.equal(isDueOn({ type: 'weekdays', weekdays: [2] }, '2026-10-20'), true);
  assert.equal(isDueOn({ type: 'weekdays', weekdays: [2] }, '2026-10-21'), false);
  assert.equal(isDueOn({ type: 'times_per_week', timesPerWeek: 2 }, '2026-10-21'), true, 'any day counts towards the week');
  assert.equal(scheduleLabel({ type: 'weekdays', weekdays: [1, 3] }), 'Mon, Wed');
  assert.equal(scheduleLabel({ type: 'times_per_week', timesPerWeek: 1 }), 'Once a week');
});

test('the active span: start, end, archive and pauses', () => {
  const s = span('2026-10-10', { endDate: '2026-10-30', pausedRanges: [{ from: '2026-10-15', to: '2026-10-16' }], archivedOn: null });
  assert.equal(isActiveOn(s, '2026-10-09'), false);
  assert.equal(isActiveOn(s, '2026-10-15'), false);
  assert.equal(isActiveOn(s, '2026-10-17'), true);
  assert.equal(isActiveOn(s, '2026-10-31'), false);
  assert.equal(isActiveOn({ ...s, pausedSince: '2026-10-20' }, '2026-10-21'), false);
  assert.equal(isActiveOn({ ...s, archivedOn: '2026-10-20' }, '2026-10-20'), false);
  assert.deepEqual(closePause('2026-10-15', '2026-10-17'), { from: '2026-10-15', to: '2026-10-16' });
  assert.equal(closePause('2026-10-15', '2026-10-15'), null, 'paused and resumed the same day: nothing to record');
});

test('adherence: fixed days count settled due days; today only once checked in; paused days never count', () => {
  const s = span('2026-10-19');
  // Mon to Thu due; done Mon and Wed; today is Thu with no check-in yet
  assert.deepEqual(adherence({ type: 'daily' }, s, done('2026-10-19', '2026-10-21'), '2026-10-19', '2026-10-25', '2026-10-22'), { due: 3, done: 2, pct: 67 });
  assert.deepEqual(adherence({ type: 'daily' }, s, done('2026-10-19', '2026-10-21', '2026-10-22'), '2026-10-19', '2026-10-25', '2026-10-22'), { due: 4, done: 3, pct: 75 });
  // a skipped day is due and not done
  assert.deepEqual(adherence({ type: 'daily' }, s, [{ date: '2026-10-19', status: 'skipped' }], '2026-10-19', '2026-10-19', '2026-10-20'), { due: 1, done: 0, pct: 0 });
  // paused Tuesday and Wednesday
  const paused = span('2026-10-19', { pausedRanges: [{ from: '2026-10-20', to: '2026-10-21' }] });
  assert.deepEqual(adherence({ type: 'daily' }, paused, done('2026-10-19'), '2026-10-19', '2026-10-21', '2026-10-25'), { due: 1, done: 1, pct: 100 });
  // before the start nothing is due
  assert.deepEqual(adherence({ type: 'daily' }, span('2026-10-30'), [], '2026-10-19', '2026-10-25', '2026-10-31'), { due: 0, done: 0, pct: null });
  // a check-in on a day that is not due is not counted
  assert.deepEqual(adherence({ type: 'weekdays', weekdays: [1] }, s, done('2026-10-20'), '2026-10-19', '2026-10-25', '2026-10-26'), { due: 1, done: 0, pct: 0 });
});

test('adherence: times per week counts finished weeks, and the current week only once its target is met', () => {
  const sched = { type: 'times_per_week' as const, timesPerWeek: 3 };
  const s = span('2026-10-12');
  // week of 12 Oct: 2 of 3; week of 19 Oct (current, today Wed 21): 1 so far → not settled
  const c = done('2026-10-12', '2026-10-14', '2026-10-20');
  assert.deepEqual(adherence(sched, s, c, '2026-10-12', '2026-10-25', '2026-10-21'), { due: 3, done: 2, pct: 67 });
  // the current week meets its target: it counts
  const c2 = [...c, ...done('2026-10-21', '2026-10-19')];
  assert.deepEqual(adherence(sched, s, c2, '2026-10-12', '2026-10-25', '2026-10-21'), { due: 6, done: 5, pct: 83 });
  // more check-ins than the target count as the target
  assert.deepEqual(adherence({ type: 'times_per_week', timesPerWeek: 1 }, s, done('2026-10-12', '2026-10-13'), '2026-10-12', '2026-10-18', '2026-10-21'), { due: 1, done: 1, pct: 100 });
  // a week that started mid-week asks for at most its active days
  assert.deepEqual(adherence(sched, span('2026-10-17'), done('2026-10-17'), '2026-10-12', '2026-10-18', '2026-10-21'), { due: 2, done: 1, pct: 50 });
  assert.deepEqual(weekProgress(sched, s, c, '2026-10-21'), { done: 1, target: 3 });
  assert.deepEqual(weekProgress({ type: 'weekdays', weekdays: [1, 3, 5] }, s, done('2026-10-19'), '2026-10-21'), { done: 1, target: 3 });
});

test('missed due days: back from yesterday to the last check-in; a check-in today resets; pauses are passed over', () => {
  const s = span('2026-10-10');
  assert.equal(missedDueDays({ type: 'daily' }, s, done('2026-10-18'), '2026-10-22'), 3, '19, 20 and 21; today is not over');
  assert.equal(missedDueDays({ type: 'daily' }, s, done('2026-10-18', '2026-10-22'), '2026-10-22'), 0, 'checked in today');
  assert.equal(missedDueDays({ type: 'daily' }, s, [{ date: '2026-10-21', status: 'skipped' }], '2026-10-22'), 0, 'a skipped check-in is a check-in');
  assert.equal(missedDueDays({ type: 'daily' }, span('2026-10-20'), [], '2026-10-22'), 2, 'not before the start');
  assert.equal(missedDueDays({ type: 'weekdays', weekdays: [1, 3, 5] }, s, done('2026-10-16'), '2026-10-24'), 3, 'Mon 19, Wed 21 and Fri 23');
  assert.equal(missedDueDays({ type: 'daily' }, span('2026-10-10', { pausedRanges: [{ from: '2026-10-19', to: '2026-10-21' }] }), done('2026-10-17'), '2026-10-22'), 1, 'only the 18th: the pause is passed over');
  // times per week: the slots of finished weeks with no check-in at all
  const tpw = { type: 'times_per_week' as const, timesPerWeek: 2 };
  assert.equal(missedDueDays(tpw, span('2026-09-28'), done('2026-10-01'), '2026-10-21'), 4, 'weeks of 5 and 12 October: 2 + 2');
  assert.equal(missedDueDays(tpw, span('2026-09-28'), done('2026-10-20'), '2026-10-21'), 0, 'a check-in this week');
});

test('streaks describe the record: done days in a row, or weeks that met their target', () => {
  const s = span('2026-10-10');
  assert.deepEqual(streak({ type: 'daily' }, s, done('2026-10-19', '2026-10-20', '2026-10-21'), '2026-10-22'), { count: 3, unit: 'days' }, 'today not over yet');
  assert.deepEqual(streak({ type: 'daily' }, s, done('2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'), '2026-10-22'), { count: 4, unit: 'days' });
  assert.deepEqual(streak({ type: 'daily' }, s, [...done('2026-10-20', '2026-10-21'), { date: '2026-10-22', status: 'skipped' }], '2026-10-22'), { count: 0, unit: 'days' }, 'a skipped day ends it');
  assert.deepEqual(streak({ type: 'weekdays', weekdays: [1, 3, 5] }, s, done('2026-10-16', '2026-10-19', '2026-10-21'), '2026-10-22'), { count: 3, unit: 'days' }, 'only due days count');
  assert.deepEqual(streak({ type: 'daily' }, span('2026-10-10', { pausedRanges: [{ from: '2026-10-20', to: '2026-10-20' }] }), done('2026-10-19', '2026-10-21'), '2026-10-22'), { count: 2, unit: 'days' }, 'a pause neither counts nor breaks');
  const tpw = { type: 'times_per_week' as const, timesPerWeek: 2 };
  assert.deepEqual(streak(tpw, span('2026-09-28'), done('2026-10-05', '2026-10-06', '2026-10-13', '2026-10-15', '2026-10-19', '2026-10-20'), '2026-10-21'), { count: 3, unit: 'weeks' });
  assert.deepEqual(streak(tpw, span('2026-09-28'), done('2026-10-13', '2026-10-15', '2026-10-19'), '2026-10-21'), { count: 1, unit: 'weeks' }, 'this week joins once met');
});

test('recent days: done, skipped, missed, open and off', () => {
  const cells = recentDays({ type: 'weekdays', weekdays: [1, 2, 3, 4, 5] }, span('2026-10-16'), [...done('2026-10-19'), { date: '2026-10-20', status: 'skipped' }], '2026-10-22', 7);
  assert.deepEqual(cells.map((c) => c.status), ['missed', 'off', 'off', 'done', 'skipped', 'missed', 'open'], 'Fri 16 (the start) missed, the weekend off … today the 22nd open');
  assert.equal(cells[0]!.date, '2026-10-16');
});

test('schemas: weekdays and reminder times are normalised; unknown fields and impossible values are refused', () => {
  assert.deepEqual(habitScheduleSchema.parse({ type: 'weekdays', weekdays: [5, 1, 1] }), { type: 'weekdays', weekdays: [1, 5] });
  assert.equal(habitScheduleSchema.safeParse({ type: 'daily', weekdays: [1] }).success, false, 'a daily schedule takes no weekdays');
  assert.equal(habitScheduleSchema.safeParse({ type: 'times_per_week', timesPerWeek: 0 }).success, false);
  assert.deepEqual(reminderTimesSchema.parse(['21:00', '07:05', '21:00']), ['07:05', '21:00']);
  assert.equal(reminderTimesSchema.safeParse(['7:05']).success, false);
  assert.equal(memberHabitCreateSchema.safeParse({ title: 'Walk', schedule: { type: 'daily' }, planId: 'pln_x' }).success, false, 'members do not link plans');
  assert.equal(memberHabitCreateSchema.safeParse({ title: 'Walk', schedule: { type: 'daily' }, startDate: '2026-10-10', endDate: '2026-10-01' }).success, false);
  assert.equal(memberHabitCreateSchema.parse({ title: '  Walk  ', schedule: { type: 'daily' } }).kind, 'habit');
  assert.equal(coachHabitUpdateSchema.safeParse({ reminderTimes: ['07:00'] }).success, false, 'a coach does not change reminders');
});

test('timezones: a local date and time become the right instant, across a clock change', () => {
  assert.equal(localTimeToIso('2026-10-22', '07:30', 'Asia/Kolkata'), '2026-10-22T02:00:00.000Z');
  assert.equal(localTimeToIso('2026-10-22', '00:15', 'Asia/Kolkata'), '2026-10-21T18:45:00.000Z');
  // New York leaves daylight time on 1 November 2026
  assert.equal(localTimeToIso('2026-10-31', '08:00', 'America/New_York'), '2026-10-31T12:00:00.000Z');
  assert.equal(localTimeToIso('2026-11-02', '08:00', 'America/New_York'), '2026-11-02T13:00:00.000Z');
  assert.equal(localTimeToIso('2026-10-22', '07:30', 'Not/AZone'), '2026-10-22T02:00:00.000Z', 'an unknown zone falls back to India');
  assert.equal(localDate('2026-10-21T19:00:00.000Z', 'Asia/Kolkata'), '2026-10-22');
  assert.equal(localDate('2026-10-21T19:00:00.000Z', 'Europe/London'), '2026-10-21');
});
