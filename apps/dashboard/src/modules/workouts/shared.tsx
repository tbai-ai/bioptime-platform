/* M6 Workouts: what the module's pages share: labels, the prescription line, dates and a rest timer built from the
   existing components (no new CSS). */
import React, { useEffect, useRef, useState } from 'react';
import { fmtDate, label } from '../../lib/format';
import { Button, Pill } from '../../ui';

export const CATEGORIES = ['strength', 'core', 'mobility', 'conditioning', 'balance', 'recovery', 'other'] as const;
export const LEVELS = ['beginner', 'intermediate', 'advanced', 'all_levels'] as const;
export const DAY_NAMES = ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7'];

/** "3 × 8-10 · rest 60 s" or "2 × 30 s". */
export function prescription(i: { sets: number; reps?: string | null; durationSeconds?: number | null; restSeconds?: number | null }): string {
  const what = i.reps ? i.reps : i.durationSeconds ? seconds(i.durationSeconds) : '';
  return `${i.sets} × ${what}${i.restSeconds ? ` · rest ${seconds(i.restSeconds)}` : ''}`;
}
export function seconds(s: number): string { return s >= 120 && s % 60 === 0 ? `${s / 60} min` : `${s} s`; }

/** A YYYY-MM-DD date (IST) as 12 Oct 2026. */
export function fmtDay(date?: string | null): string { return date ? fmtDate(`${date}T06:30:00.000Z`) : '—'; }
export function weekday(date: string): string { return new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`)); }
export function shiftDate(date: string, days: number): string { return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10); }

/** A session's status; a scheduled session whose date has passed reads "Not logged". */
export function SessionPill({ status, overdue }: { status: string; overdue?: boolean }) {
  if (status === 'scheduled' && overdue) return <Pill status="pending">Not logged</Pill>;
  return <Pill status={status === 'partial' ? 'in_progress' : status === 'skipped' ? 'cancelled' : status}>{status === 'partial' ? 'Partly done' : label(status)}</Pill>;
}

export function sourceLabel(s: string): string { return s === 'team' ? 'Bioptime team' : 'Coach'; }

/** A countdown for the rest between sets: starts at the prescribed rest, can be stopped. */
export function RestTimer({ secondsTotal }: { secondsTotal: number }) {
  const [left, setLeft] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => { if (timer.current) clearInterval(timer.current); timer.current = null; setLeft(null); };
  const start = () => {
    if (timer.current) clearInterval(timer.current);
    setLeft(secondsTotal);
    timer.current = setInterval(() => setLeft((s) => { if (s === null || s <= 1) { if (timer.current) clearInterval(timer.current); timer.current = null; return 0; } return s - 1; }), 1000);
  };
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);
  if (left === null) return <Button size="sm" variant="tertiary" onClick={start}>Rest {seconds(secondsTotal)}</Button>;
  return <span className="row" style={{ gap: 6 }} aria-live="polite"><span className="num small">{left > 0 ? `Rest ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Rest done'}</span><Button size="sm" variant="tertiary" onClick={stop}>{left > 0 ? 'Stop' : 'Close'}</Button></span>;
}
