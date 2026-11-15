/* Shared layout pieces of the coach workspace pages: a page header with actions on the right,
   KPI tiles, segmented chips, a card grid, the card with the left accent bar and a status pill. Built from the --bp-*
   tokens and the src/ui primitives (Bioptime's own colours, fonts and wording); the rules are in styles/coach-wz.css,
   all under .wz* class names so nothing else in the portal changes.

   Owned by the shell group: the page groups import these and never edit this file (a page that needs something
   different adds a local variant next to itself). Icons: <Icon name="clients" /> (src/shell/coach/icons.tsx). */
import React, { useId, useRef } from 'react';
import { Card, CardHead, Skeleton } from '../../../ui';
import { STATUS_PILL, label as words } from '../../../lib/format';
import { Link } from '../../../lib/nav';
import { Icon, type IconName } from '../../../shell/coach/icons';
import '../../../styles/coach-wz.css';

export { Icon, ICON_NAMES, type IconName } from '../../../shell/coach/icons';

/** The colours a tile's bar, an accent card's bar or a pill can take: Bioptime's brand red and status colours. */
export type Tone = 'accent' | 'success' | 'warning' | 'info' | 'error' | 'neutral';

/* ---------- page header ---------- */

/** The page title (an h1) with an optional eyebrow, a line under it and a back link above it; `actions` (buttons,
 *  links, a menu) sit on the right and wrap under the title on a phone. `accent` draws the left accent bar, as on the
 *  dashboard greeting. */
export function PageHeader({ title, sub, eyebrow, back, actions, accent }: { title: React.ReactNode; sub?: React.ReactNode; eyebrow?: React.ReactNode; back?: { to: string; label: string }; actions?: React.ReactNode; accent?: boolean }) {
  return <header className={`pageHead wzPageHead ${accent ? 'wzAccentBar' : ''}`}>
    <div className="wzPageHeadMain">
      {back && <Link className="muted wzBack" to={back.to}>← {back.label}</Link>}
      {eyebrow && <span className="bp-eyebrow">{eyebrow}</span>}
      <h1>{title}</h1>
      {sub && <p className="sub">{sub}</p>}
    </div>
    {actions && <div className="actions wzPageActions">{actions}</div>}
  </header>;
}

/* ---------- KPI tile ---------- */

/** A small card with a coloured left border: the label, an icon top-right and a big number. With `to` the whole tile is
 *  a link: when `value` is plain text or a number its accessible name is "label: value" and the `sub` line is its
 *  description (any other value: the name is the tile's text). `value` null shows a dash, `loading` a skeleton line. */
export function KpiTile({ label, value, icon, tone = 'accent', sub, to, loading }: { label: string; value: React.ReactNode; icon?: IconName; tone?: Tone; sub?: React.ReactNode; to?: string; loading?: boolean }) {
  const subId = useId();
  const body = <>
    <span className="wzKpiHead"><span className="wzKpiLabel">{label}</span>{icon && <span className="wzKpiIcon"><Icon name={icon} size={18} /></span>}</span>
    {loading ? <span className="bp-skel bp-skel-text wzKpiSkel" aria-hidden="true" /> : <span className="wzKpiValue num">{value ?? '—'}</span>}
    {sub && <span className="wzKpiSub" id={subId}>{sub}</span>}
  </>;
  const cls = `bp-card wzKpi wzTone-${tone}`;
  if (!to) return <div className={cls} aria-busy={loading || undefined}>{body}</div>;
  const valueText = typeof value === 'string' || typeof value === 'number' ? String(value) : value == null ? '—' : null;
  const name = loading ? label : valueText === null ? undefined : `${label}: ${valueText}`;
  return <Link className={`${cls} wzKpiLink`} to={to} aria-busy={loading || undefined} aria-label={name} aria-describedby={name && sub ? subId : undefined}>{body}</Link>;
}

/* ---------- segmented chips ---------- */

export type ChipItem<T extends string> = { id: T; label: string; count?: number; disabled?: boolean };

/** A row of pill chips, one selected. As filters (default) each chip is a toggle button (aria-pressed); with `tabs`
 *  they form a WAI-ARIA tab strip that controls `panelId` (Left/Right/Home/End move and select, as src/ui Tabs). A
 *  count shows as a badge when above zero. */
export function SegmentChips<T extends string>({ items, value, onChange, label: ariaLabel, tabs, panelId, size }: { items: Array<ChipItem<T>>; value: T; onChange: (v: T) => void; label?: string; tabs?: boolean; panelId?: string; size?: 'sm' }) {
  const base = useId();
  const box = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!tabs) return;
    const live = items.filter((t) => !t.disabled);
    const i = live.findIndex((t) => t.id === value), n = live.length;
    const next = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    const target = next >= 0 ? live[next] : undefined;
    if (!target) return;
    e.preventDefault();
    onChange(target.id);
    box.current?.querySelector<HTMLElement>(`[data-chip="${CSS.escape(target.id)}"]`)?.focus();
  };
  return <div ref={box} className={`wzChips ${size === 'sm' ? 'wzChipsSm' : ''}`} role={tabs ? 'tablist' : 'group'} aria-label={ariaLabel} onKeyDown={onKeyDown}>
    {items.map((t) => {
      const on = t.id === value;
      return <button key={t.id} type="button" className="wzChip" data-chip={t.id} disabled={t.disabled}
        {...(tabs ? { role: 'tab', id: `${base}-tab-${t.id}`, 'aria-selected': on, 'aria-controls': panelId, tabIndex: on ? 0 : -1 } : { 'aria-pressed': on })}
        onClick={() => onChange(t.id)}>
        {t.label}{t.count !== undefined && t.count > 0 && <span className="bp-badge">{t.count}</span>}
      </button>;
    })}
  </div>;
}

/* ---------- card grid ---------- */

/** A grid of equal columns (2 to 5) that steps down on narrower screens: at most 3 under 1280 px, 2 under 1100 px, and
 *  `phone` columns (default 1; 2 suits KPI tiles) under 720 px. */
export function CardGrid({ columns, phone = 1, children, className = '', label: ariaLabel, as = 'div' }: { columns: 2 | 3 | 4 | 5; phone?: 1 | 2; children: React.ReactNode; className?: string; label?: string; as?: 'div' | 'ul' | 'section' }) {
  const Tag = as as 'div';
  return <Tag className={`wzGrid ${className}`} data-cols={columns} data-phone={phone} aria-label={ariaLabel}>{children}</Tag>;
}

/* ---------- accent card ---------- */

/** A card with the left accent bar: it marks the page's primary card (the greeting, the Overview). `eyebrow` and
 *  `title` draw the usual card head with `right` (tools) beside it; `tone` picks the bar colour. */
export function AccentCard({ children, title, eyebrow, right, tone = 'accent', className = '', style, loading }: { children?: React.ReactNode; title?: React.ReactNode; eyebrow?: string; right?: React.ReactNode; tone?: Tone; className?: string; style?: React.CSSProperties; loading?: boolean }) {
  return <Card className={`wzAccentCard wzTone-${tone} ${className}`} style={style}>
    {title !== undefined && <CardHead eyebrow={eyebrow} title={title} right={right} />}
    {loading ? <Skeleton rows={3} /> : children}
  </Card>;
}

/* ---------- status pill ---------- */

/** The client and plan statuses in Bioptime's pill: Active filled green, Pending outlined in
 *  the accent colour, Inactive/ended plain; any other status uses the portal's usual status colours. */
const WZ_STATUS: Record<string, Tone | 'outline'> = { active: 'success', pending: 'outline', inactive: 'neutral', ended: 'neutral', paused: 'warning' };

export function StatusPill({ status, tone, children }: { status?: string | null; tone?: Tone; children?: React.ReactNode }) {
  const key = (status ?? '').toLowerCase();
  const kind = tone ?? WZ_STATUS[key] ?? ((STATUS_PILL[key] as Tone | undefined) ?? 'neutral');
  const cls = kind === 'outline' ? 'bp-pill wzPillOutline' : `bp-pill bp-pill-${kind}`;
  return <span className={cls}>{children ?? words(status)}</span>;
}
