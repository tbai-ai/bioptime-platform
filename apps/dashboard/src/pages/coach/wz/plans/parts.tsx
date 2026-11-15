/* Coach workspace: what the plan pages (Workouts, Sessions, Meal plans, Appointments overview) share.
   Built from src/ui and the --bp-* tokens (plans.css); the layout pieces both page groups use come from ../ui. */
import React from 'react';
import { api } from '../../../../lib/api';
import { useFeatures } from '../../../../modules/runtime';
import { Button, Empty, Select, Skeleton, useApi } from '../../../../ui';
import './plans.css';

/** A page of a module: the same answer as the module route gate (ModuleRouteGate) while the module's flag is off, so a
 *  coach never reaches a page whose API refuses them. */
export function FeatureGate({ feature, children }: { feature: string; children: React.ReactNode }) {
  const features = useFeatures(true);
  if (!features) return <Skeleton rows={6} />;
  if (!features.has(feature)) return <Empty title="No such page" body="Use the sections on the left." />;
  return <>{children}</>;
}

/** The page wrapper: a size container, so the grids follow the width the page has beside the sidebar. */
export function PlansPage({ children, label }: { children: React.ReactNode; label?: string }) {
  return <div className="wzp stack" aria-label={label}>{children}</div>;
}

/** A small uppercase badge (source, frequency, type). */
export function Badge({ children, accent, at }: { children: React.ReactNode; accent?: boolean; at?: 'start' | 'end' }) {
  return <span className={`wzp-badge ${accent ? 'wzp-badge-accent' : ''} ${at ? `wzp-badge-${at}` : ''}`}>{children}</span>;
}
export function Tag({ children }: { children: React.ReactNode }) { return <span className="wzp-tag">{children}</span>; }

/** The neutral cover of a plan card: no pictures (Bioptime has no licensed media for plans), a stroked icon. */
export function Cover({ icon, start, end }: { icon: 'workout' | 'meal' | 'session'; start?: React.ReactNode; end?: React.ReactNode }) {
  return <div className="wzp-cover" aria-hidden={start || end ? undefined : true}>
    {start}{end}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {icon === 'workout' ? <><path d="M6 8v8M3.5 10v4M18 8v8M20.5 10v4" /><path d="M6 12h12" /></>
        : icon === 'meal' ? <><path d="M5 3v8a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V3M7 3v18" /><path d="M17 21V3c-2 1-3 3.5-3 7s1 4 3 4" /></>
        : <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m10 9 5 3-5 3z" /></>}
    </svg>
  </div>;
}

/** Pages of a list shown as a grid. */
export const PAGE_SIZE = 12;
export function pageOf<T>(items: T[], page: number, size = PAGE_SIZE): { shown: T[]; pages: number; page: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const p = Math.min(Math.max(1, page), pages);
  return { shown: items.slice((p - 1) * size, p * size), pages, page: p };
}
export function Pager({ page, pages, onPage, label }: { page: number; pages: number; onPage: (p: number) => void; label: string }) {
  if (pages <= 1) return null;
  return <nav className="wzp-pager" aria-label={label}>
    <Button size="sm" variant="tertiary" disabled={page <= 1} onClick={() => onPage(page - 1)}>← Previous</Button>
    <span>Page <span className="num">{page}</span> of <span className="num">{pages}</span></span>
    <Button size="sm" variant="tertiary" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next →</Button>
  </nav>;
}

/** The coach's assigned clients (active and paused), as GET /coach/clients sends them: never a restricted field. */
export type CoachClient = { id: string; name: string; memberCode: string | null; healthShared: boolean; assignment: { status: string } };
export function useCoachClients(active = true) {
  const r = useApi(() => (active ? api.get('/coach/clients?limit=100&sort=name') : Promise.resolve(null)), [active]);
  return { ...r, items: (((r.data as any)?.items ?? []) as CoachClient[]) };
}
export function ClientSelect({ clients, value, onChange, id }: { clients: CoachClient[]; value: string; onChange: (id: string) => void; id?: string }) {
  return <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
    <option value="">Choose a client</option>
    {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.memberCode ? ` · ${c.memberCode}` : ''}{c.assignment?.status === 'paused' ? ' (paused)' : ''}</option>)}
  </Select>;
}
