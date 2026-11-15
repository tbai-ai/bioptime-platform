/* M5 Nutrition: what the portal pages share. Labels, the week view of a plan, the totals table (only entered values,
   incomplete days flagged), the nutrient line of a food and the private-photo helpers. Existing components and classes
   only (src/ui, dashboard.css, the design-system components). */
import React from 'react';
import { api } from '../../lib/api';
import { openLater } from '../../lib/ids';
import { label } from '../../lib/format';
import { Eyebrow, Table } from '../../ui';

export const SLOTS = ['breakfast', 'mid_morning', 'lunch', 'evening', 'dinner', 'other'] as const;
export const SLOT_LABEL: Record<string, string> = { breakfast: 'Breakfast', mid_morning: 'Mid-morning', lunch: 'Lunch', evening: 'Evening', dinner: 'Dinner', other: 'Other' };
export const OUTCOMES = ['as_planned', 'swapped', 'skipped', 'extra'] as const;
export const OUTCOME_LABEL: Record<string, string> = { as_planned: 'As planned', swapped: 'Swapped', skipped: 'Skipped', extra: 'Extra' };
export const OUTCOME_PILL: Record<string, string> = { as_planned: 'completed', swapped: 'in_progress', skipped: 'cancelled', extra: 'scheduled' };
export const DAY_LABEL = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const RESTRICTION_KINDS = ['allergy', 'intolerance', 'avoid', 'religious', 'other'] as const;
export const NUTRIENTS: Array<{ key: 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fibre_g'; label: string; unit: string }> = [
  { key: 'kcal', label: 'Energy', unit: 'kcal' }, { key: 'protein_g', label: 'Protein', unit: 'g' }, { key: 'carbs_g', label: 'Carbohydrate', unit: 'g' }, { key: 'fat_g', label: 'Fat', unit: 'g' }, { key: 'fibre_g', label: 'Fibre', unit: 'g' },
];
export const TARGETS: Array<{ key: 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g'; label: string; unit: string }> = NUTRIENTS.filter((n) => n.key !== 'fibre_g') as Array<{ key: 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g'; label: string; unit: string }>;

/** Plan day of a YYYY-MM-DD local date: 1 is Monday, 7 is Sunday (as the API counts). */
export function planDayOf(date: string): number { const d = new Date(`${date}T00:00:00Z`).getUTCDay(); return d === 0 ? 7 : d; }
export function shiftDate(date: string, days: number): string { return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10); }
export function fmtLocalDate(date: string): string { return new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`)); }

/** The values someone entered for a food, or a plain statement that there are none. */
export function nutrientLine(item: Record<string, unknown> | null | undefined): string {
  if (!item) return '';
  const parts = NUTRIENTS.filter((n) => typeof item[n.key] === 'number').map((n) => `${n.label.toLowerCase()} ${item[n.key]} ${n.unit}`);
  return parts.length ? parts.join(' · ') : 'Nutrient values not entered';
}

/** What a slot points at, when it says more than the slot's own title: the food (with its serving) or the recipe. */
export function slotSource(s: any): string {
  if (s.food) return s.food.name === s.title && !s.food.servingLabel ? '' : `${s.food.name}${s.food.servingLabel ? ` · ${s.food.servingLabel}` : ''}`;
  if (s.recipe) return s.recipe.title === s.title ? 'Recipe' : `Recipe: ${s.recipe.title}`;
  return '';
}

/** Buttons and pills at the end of a list row stay on one line (the list's own rule stacks its inner blocks). */
export const ROW_ACTIONS: React.CSSProperties = { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 };

/** The week of a plan version: one tile per day with its meals in order. */
export function WeekView({ slots, today }: { slots: any[]; today?: number }) {
  const days = [1, 2, 3, 4, 5, 6, 7].filter((d) => slots.some((s) => s.day === d));
  if (!days.length) return <p className="muted">No meals in this plan yet.</p>;
  return <div className="weekGrid">{days.map((d) => <div key={d} className="bp-tile" aria-current={today === d ? 'date' : undefined}>
    <Eyebrow accent={today === d}>{DAY_LABEL[d]}{today === d ? ' · today' : ''}</Eyebrow>
    <ul className="taskList" style={{ marginTop: 6 }}>{slots.filter((s) => s.day === d).map((s) => <li key={s.id}><div><span>{s.title}</span><span className="muted">{SLOT_LABEL[s.slot]}{s.timeHint ? ` · ${s.timeHint}` : ''}{s.portionNote ? ` · ${s.portionNote}` : ''}</span>{slotSource(s) && <span className="muted">{slotSource(s)}</span>}</div></li>)}</ul>
  </div>)}</div>;
}

/** Totals per day of the entered values; a day with any slot lacking values is marked incomplete, never filled in. */
export function TotalsTable({ totals, targets }: { totals: any; targets?: Record<string, number> }) {
  const days: any[] = totals?.days ?? [];
  if (!days.length) return <p className="muted">No totals: the plan has no meals yet.</p>;
  const fmt = (v: number | null | undefined) => (typeof v === 'number' ? v : '—');
  const hasTargets = targets && Object.keys(targets).length > 0;
  return <>
    <Table dense label="Totals of the entered values per day" head={<><th>Day</th>{NUTRIENTS.map((n) => <th key={n.key} className="num">{n.label} ({n.unit})</th>)}<th>Values</th></>}>
      {days.map((d) => <tr key={d.day}><td>{DAY_LABEL[d.day]}</td>{NUTRIENTS.map((n) => <td key={n.key} className="num">{fmt(d[n.key])}</td>)}<td>{d.complete ? 'All entered' : `${d.slotsMissingValues} of ${d.slots} meals without values`}</td></tr>)}
      {hasTargets && <tr><td><b>Target</b></td>{NUTRIENTS.map((n) => <td key={n.key} className="num">{fmt(targets![n.key])}</td>)}<td className="muted">Set by your coach</td></tr>}
    </Table>
    <p className="muted small" style={{ marginTop: 6 }}>{totals.note}</p>
  </>;
}

export function targetsLine(targets: Record<string, number> | undefined): string {
  const t = targets ?? {};
  const parts = TARGETS.filter((x) => typeof t[x.key] === 'number').map((x) => `${x.label} ${t[x.key]} ${x.unit}`);
  return parts.join(' · ');
}

/** Opens a private file through a 5-minute token (no permanent link exists). The tab opens during the click (openLater),
 *  so a popup blocker does not stop it; if the browser blocks it anyway, the file opens in this tab. Call it from the
 *  click handler before any await. The promise rejects when the token is refused, for the caller's error toast. */
export function openPrivateFile(fileId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    openLater(() => api.post<{ url: string }>(`/files/${fileId}/token`).then((t) => { resolve(); return t.url; }), reject);
  });
}

/** A picked file as base64 for the JSON upload. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('The file could not be read'));
    r.onload = () => { const s = String(r.result ?? ''); resolve(s.slice(s.indexOf(',') + 1)); };
    r.readAsDataURL(file);
  });
}

export function restrictionText(r: { label: string; kind: string }): string { return `${r.label} (${label(r.kind).toLowerCase()})`; }
