/* Shared pieces of the coach's client pages in the coach workspace (group "dash"): how a client's status reads from
   Bioptime's real states (assignment, account, published plan), loading the coach's clients and counting them per
   status (the clients list and the dashboard use the same rule, so a number on the dashboard is the count of the list
   it opens), initials, the per-client ⋮ menu, opening the client's conversation, and two small dialogs that call the
   same endpoints the client record uses (a follow-up for me, a coach-entered progress value). Contact details never
   reach these pages: the API leaves them out. */
import React, { useEffect, useId, useRef, useState } from 'react';
import { api, qs } from '../../../../lib/api';
import { useNavigate } from '../../../../lib/nav';
import { Alert, Button, Dialog, Field, Input, Select, Textarea, errorText, useToast } from '../../../../ui';
import { Icon, StatusPill } from '../ui';
import '../dashboard/dash.css';

export function initials(name?: string | null): string {
  return String(name ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!).join('').toUpperCase() || '·';
}

/* ---------- status ---------- */

export type StatusKey = 'waiting' | 'active' | 'paused' | 'ended' | 'inactive';
/** The list's chips: All, Waiting, Active and Paused/Inactive cover the current clients (active and paused
 *  assignments); Ended (history) is the explicit choice that lists ended assignments. */
export type ChipKey = 'all' | 'waiting' | 'active' | 'inactive' | 'ended';

/** Account states that mean the member cannot use Bioptime now (packages/domain ACCOUNT_STATES). */
const INACTIVE_ACCOUNT = new Set(['suspended', 'deactivated', 'deletion_requested', 'closed']);
/** Account states of a member still setting up their account. */
const SETTING_UP = new Set(['invited', 'pending_verification', 'onboarding']);

/** A client's status (Ended, Paused, Inactive, Waiting or Active), read from Bioptime's own records:
 *  - Ended: the coach assignment ended (history only: the API no longer opens the record to this coach);
 *  - Paused: the coach assignment is paused;
 *  - Inactive: the member's account is suspended, deactivated, closed or awaiting deletion;
 *  - Waiting: assigned to me but still setting up their account, or with no published plan yet;
 *  - Active: assigned, active, with a published plan. */
export function clientStatus(s: { assignmentStatus?: string | null; accountState?: string | null; hasPlan: boolean }): { key: StatusKey; chip: Exclude<ChipKey, 'all'>; label: string; title: string } {
  const a = s.assignmentStatus ?? 'active', acc = s.accountState ?? 'active';
  if (a === 'ended') return { key: 'ended', chip: 'ended', label: 'Ended', title: 'The assignment to you has ended; the client record is no longer open to you.' };
  if (a === 'paused') return { key: 'paused', chip: 'inactive', label: 'Paused', title: 'The assignment to you is paused.' };
  if (INACTIVE_ACCOUNT.has(acc)) return { key: 'inactive', chip: 'inactive', label: 'Inactive', title: `Account ${acc.replace(/_/g, ' ')}.` };
  if (SETTING_UP.has(acc)) return { key: 'waiting', chip: 'waiting', label: 'Waiting', title: 'Still setting up their account.' };
  if (!s.hasPlan) return { key: 'waiting', chip: 'waiting', label: 'Waiting', title: 'No published plan yet.' };
  return { key: 'active', chip: 'active', label: 'Active', title: 'Assigned to you with a published plan.' };
}

/* ---------- loading the coach's clients ---------- */

/** One row of GET /coach/clients (members.listClientsForCoach): never a contact field. */
export type ClientItem = {
  id: string; name: string; memberCode: string | null; accountState: string; age: number | null; gender: string | null; city?: string | null; goals: string[];
  onboardingCompleted: boolean; assignment: { id: string; status: string; since: string } | null;
  programme: { id: string; status: string; packageName: string | null; startAt: string; endAt: string } | null;
  progress: { tasksDue: number; tasksDone: number; completionPct: number | null; tasksPending: number; tasksOverdue: number; hasPlan: boolean };
  nextAppointmentAt: string | null; lastCheckInAt: string | null; healthShared: boolean; bloodworkStatus: string | null; reportsToReview: number; engagement: 'active' | 'quiet' | 'new';
};
const API_PAGE = 100; // the API's largest page

/** Every one of my clients matching the search, in the server's sort order, all pages. Without `ended` it is the API's
 *  default, my current clients (active and paused assignments: the ones whose record the API opens to me); with it,
 *  only my ended assignments (history). */
export async function loadClients(q: string, sort: string, ended = false): Promise<{ items: ClientItem[]; total: number }> {
  const get = (page: number) => api.get<{ items: ClientItem[]; total: number }>(`/coach/clients${qs({ q, status: ended ? 'ended' : undefined, sort, page, limit: API_PAGE })}`);
  const first = await get(1);
  const pages = Math.ceil((first?.total ?? 0) / API_PAGE);
  const rest = pages > 1 ? await Promise.all(Array.from({ length: pages - 1 }, (_, i) => get(i + 2))) : [];
  return { items: [...(first?.items ?? []), ...rest.flatMap((r) => r?.items ?? [])], total: first?.total ?? 0 };
}

export const statusOf = (m: ClientItem) => clientStatus({ assignmentStatus: m.assignment?.status, accountState: m.accountState, hasPlan: m.progress.hasPlan });

/** How many of my current clients sit under each chip (the rule of the clients list). */
export function chipCounts(items: ClientItem[]): Record<'all' | 'waiting' | 'active' | 'inactive', number> {
  const c = { all: 0, waiting: 0, active: 0, inactive: 0 };
  for (const m of items) { const k = statusOf(m).chip; if (k === 'ended') continue; c.all += 1; c[k] += 1; }
  return c;
}

export function ClientStatusPill({ status }: { status: ReturnType<typeof clientStatus> }) {
  const tone = status.key === 'waiting' ? 'pending' : status.key;
  return <span title={status.title}><StatusPill status={tone}>{status.label}</StatusPill></span>;
}

/* ---------- conversation ---------- */

/** Opens the coach's thread with this member (GET /conversations lists mine), else the Messages section. */
export function useOpenConversation() {
  const nav = useNavigate();
  const toast = useToast();
  return async (memberId: string) => {
    try {
      const r = await api.get<{ items: Array<{ id: string; memberId: string }> }>('/conversations');
      const c = (r?.items ?? []).find((x) => x.memberId === memberId);
      nav(c ? `/messages/${c.id}` : '/messages');
    } catch (e) { toast(errorText(e), 'error'); }
  };
}

/* ---------- the ⋮ menu ---------- */

export type MenuItem = { label: string; onSelect: () => void };

/** A menu button (WAI-ARIA menu pattern): Enter/Space/ArrowDown open it on the first item, Up/Down/Home/End move,
 *  Escape closes it and returns focus to the button, Tab or a click elsewhere closes it. */
export function ClientMenu({ name, items }: { name: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDoc = (e: MouseEvent) => { const t = e.target as Node; if (!menu.current?.contains(t) && !btn.current?.contains(t)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const list = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = list.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => { e.preventDefault(); list[(n + list.length) % list.length]?.focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(list.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); btn.current?.focus(); }
    else if (e.key === 'Tab') setOpen(false);
  };
  return <div className="wzdMenuWrap">
    <button ref={btn} type="button" className="bp-iconbtn wzdMenuBtn" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={`Actions for ${name}`}
      onClick={() => setOpen((o) => !o)} onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}><Icon name="more" size={20} /></button>
    {open && <div ref={menu} id={id} role="menu" aria-label={`Actions for ${name}`} className="wzdMenu" onKeyDown={onKeyDown}>
      {items.map((it) => <button key={it.label} type="button" role="menuitem" tabIndex={-1} onClick={() => { setOpen(false); it.onSelect(); }}>{it.label}</button>)}
    </div>}
  </div>;
}

/* ---------- dialogs ---------- */

/** A follow-up task for me about this client (POST /coach/clients/:id/follow-ups, as the Notes tab does); it shows on
 *  the dashboard until it is resolved. */
export function FollowUpDialog({ open, onClose, memberId, name, onDone }: { open: boolean; onClose: () => void; memberId: string; name: string; onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setTitle(''); setDetail(''); setErr(''); } }, [open]);
  const go = async () => {
    setBusy(true); setErr('');
    try { await api.post(`/coach/clients/${memberId}/follow-ups`, { title: title.trim(), ...(detail.trim() ? { detail: detail.trim() } : {}) }); onDone(); onClose(); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <Dialog open={open} onClose={onClose} title={`Add a follow-up · ${name}`} footer={<><Button variant="tertiary" onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={title.trim().length < 2} onClick={go}>Add follow-up</Button></>}>
    <div className="form">
      <Field label="Follow-up"><Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Check sleep log next week" /></Field>
      <Field label="Detail" optional><Textarea value={detail} maxLength={1000} onChange={(e) => setDetail(e.target.value)} /></Field>
      {err && <Alert kind="error">{err}</Alert>}
      <p className="muted">Follow-ups are for you only; they stay on your dashboard until you mark them done.</p>
    </div>
  </Dialog>;
}

/** A coach-entered progress value (POST /coach/clients/:id/progress), the same form as the Progress tab's "Record a
 *  value". Only offered while the member shares health information (the API refuses otherwise). */
export function RecordValueDialog({ open, onClose, memberId, metrics, onDone }: { open: boolean; onClose: () => void; memberId: string; metrics: Array<{ metric: string; label: string; unit: string }>; onDone: () => void }) {
  const [metric, setMetric] = useState('');
  const [value, setValue] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setMetric(''); setValue(''); setErr(''); } }, [open]);
  const go = async () => {
    setBusy(true); setErr('');
    try { await api.post(`/coach/clients/${memberId}/progress`, { metric, value: Number(value) }); onDone(); onClose(); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <Dialog open={open} onClose={onClose} title="Record a progress value" footer={<><Button variant="tertiary" onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!metric || value === '' || !Number.isFinite(Number(value))} onClick={go}>Save</Button></>}>
    <div className="form">
      <Field label="Metric"><Select value={metric} onChange={(e) => setMetric(e.target.value)}><option value="">Choose</option>{metrics.map((m) => <option key={m.metric} value={m.metric}>{m.label} ({m.unit})</option>)}</Select></Field>
      <Field label="Value"><Input type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
      {err && <Alert kind="error">{err}</Alert>}
    </div>
  </Dialog>;
}
