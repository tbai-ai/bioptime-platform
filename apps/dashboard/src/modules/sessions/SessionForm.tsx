/* M8 Live sessions: the create and edit dialog for hosts (coach workspace) and administrators (sessions.manage).
   Times are entered in IST. A coach hosts their own sessions for members; administrators choose the host and may set
   up public webinars. The join link is optional and https only: no video provider creates meetings yet. */
import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { addDaysIst } from '../../lib/format';
import { Alert, Button, Dialog, Field, Input, Select, Textarea, useApi, errorText } from '../../ui';
import { AUDIENCES, KINDS, LENGTHS, isoToIstDate, isoToIstTime, istToIso, minutesBetween } from './shared';

export type Mode = 'coach' | 'admin';
type Draft = { kind: string; title: string; description: string; date: string; time: string; minutes: number; capacity: string; audience: string; packageIds: string[]; joinUrl: string; hostId: string; reason: string };

const blank = (): Draft => ({ kind: 'group_class', title: '', description: '', date: addDaysIst(7), time: '18:00', minutes: 45, capacity: '', audience: 'members', packageIds: [], joinUrl: '', hostId: '', reason: '' });

export function SessionForm({ mode, open, session, onClose, onSaved }: { mode: Mode; open: boolean; session?: any; onClose: () => void; onSaved: (s: any) => void }) {
  const [d, setD] = useState<Draft>(blank());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const packages = useApi(() => (open ? api.get('/packages') : Promise.resolve(null)), [open]);
  const hosts = useApi(() => (open && mode === 'admin' && !session ? api.get('/admin/sessions/hosts') : Promise.resolve(null)), [open, mode, session?.id]);
  useEffect(() => {
    if (!open) return;
    setErr('');
    setD(session ? { kind: session.kind, title: session.title, description: session.description ?? '', date: isoToIstDate(session.startAt), time: isoToIstTime(session.startAt), minutes: minutesBetween(session.startAt, session.endAt), capacity: session.capacity ? String(session.capacity) : '', audience: session.audience, packageIds: session.packageIds ?? [], joinUrl: session.joinUrl ?? '', hostId: session.hostId, reason: '' } : blank());
  }, [open, session]);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const locked = !!session && session.status !== 'draft'; // who can join is fixed once published
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const startAt = istToIso(d.date, d.time);
      const endAt = new Date(Date.parse(startAt) + d.minutes * 60_000).toISOString();
      const body: Record<string, unknown> = { kind: d.kind, title: d.title, description: d.description, startAt, endAt, capacity: d.capacity.trim() ? Number(d.capacity) : null, joinUrl: d.joinUrl.trim() || null };
      if (!locked) { body.audience = d.audience; body.packageIds = d.audience === 'packages' ? d.packageIds : []; }
      const base = mode === 'admin' ? '/admin/sessions' : '/coach/sessions';
      const out = session ? await api.patch(`${base}/${session.id}`, { ...body, reason: d.reason.trim() || undefined }) : await api.post(base, { ...body, ...(mode === 'admin' && d.hostId ? { hostId: d.hostId } : {}) });
      onSaved(out); onClose();
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const pkgs = (((packages.data as any)?.items ?? []) as any[]).filter((p) => !p.archived);
  const hostList = (((hosts.data as any)?.items ?? []) as any[]);
  const lengths = LENGTHS.includes(d.minutes as (typeof LENGTHS)[number]) ? LENGTHS : [...LENGTHS, d.minutes].sort((a, b) => a - b);
  return <Dialog open={open} onClose={onClose} title={session ? 'Edit the session' : 'New session'} footer={<><Button variant="tertiary" onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>{session ? 'Save' : 'Save as draft'}</Button></>}>
    <div className="form">
      <Field label="Kind"><Select value={d.kind} onChange={(e) => set({ kind: e.target.value })}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
      <Field label="Title"><Input value={d.title} maxLength={160} onChange={(e) => set({ title: e.target.value })} /></Field>
      <Field label="Description" optional hint="What happens in the session and who it suits. No medical claims, prices or speaker credentials."><Textarea value={d.description} maxLength={4000} onChange={(e) => set({ description: e.target.value })} /></Field>
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <Field label="Date (IST)"><Input type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} /></Field>
        <Field label="Starts (IST)"><Input type="time" value={d.time} onChange={(e) => set({ time: e.target.value })} /></Field>
        <Field label="Length"><Select value={String(d.minutes)} onChange={(e) => set({ minutes: Number(e.target.value) })}>{lengths.map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`}</option>)}</Select></Field>
      </div>
      <Field label="Places" optional hint="Leave empty for no limit. When it is full, new sign-ups join the waitlist."><Input type="number" min={1} max={1000} value={d.capacity} onChange={(e) => set({ capacity: e.target.value })} /></Field>
      {mode === 'admin' && !session && <Field label="Host"><Select value={d.hostId} onChange={(e) => set({ hostId: e.target.value })}><option value="">Me</option>{hostList.map((h) => <option key={h.id} value={h.id}>{h.name}{h.role === 'coach' ? '' : ' (Bioptime team)'}</option>)}</Select></Field>}
      <Field label="Who can join" hint={locked ? 'Fixed once the session is published.' : undefined}><Select value={d.audience} disabled={locked} onChange={(e) => set({ audience: e.target.value })}>{Object.entries(AUDIENCES).filter(([k]) => mode === 'admin' || k !== 'public').map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
      {d.audience === 'packages' && <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}><legend className="bp-label">Packages</legend>
        {pkgs.map((p) => <label key={p.id} className="row" style={{ gap: 8 }}><input type="checkbox" disabled={locked} checked={d.packageIds.includes(p.id)} onChange={(e) => set({ packageIds: e.target.checked ? [...d.packageIds, p.id] : d.packageIds.filter((x) => x !== p.id) })} /> {p.name}</label>)}
      </fieldset>}
      <Field label="Join link" optional hint="The https link you will use. No video provider is connected, so nothing is created for you; without a link, members read that the host will share how to join."><Input type="url" inputMode="url" placeholder="https://" value={d.joinUrl} onChange={(e) => set({ joinUrl: e.target.value })} /></Field>
      {session && session.status === 'published' && <Field label="What changed, for the record" optional><Input value={d.reason} maxLength={300} onChange={(e) => set({ reason: e.target.value })} /></Field>}
      {session && session.status === 'published' && <p className="muted small">People who registered are told when the time or the join link changes.</p>}
      {err && <Alert kind="error">{err}</Alert>}
    </div>
  </Dialog>;
}
