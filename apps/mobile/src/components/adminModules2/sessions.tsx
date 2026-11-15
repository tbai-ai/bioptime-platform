/* M8 Live sessions in the administrative portal: the create and edit sheet (the web's SessionForm in its admin mode,
   apps/dashboard/src/modules/sessions/SessionForm.tsx). Times are entered in IST and sent as ISO instants; an
   administrator chooses the host when creating ("Me" or a coach or team member from GET /admin/sessions/hosts) and may
   open a session to the public; who can join is fixed once published; the join link is optional and https only, since
   no video provider creates meetings. The labels, pills and places line are the coach screens' (coachModules/sessions). */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { errorText, get, patch, post } from '@/lib/api';
import { istDate } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Button, Field, Input, Notice, P, Row } from '@/components/ui';
import { DatePickerField, Sheet, TimePickerField, isClockTime, isIsoDate } from '@/components/workspace';
import { PickerField, fieldErrorsOf, isoToIstDate, isoToIstTime, istToIso, minutesBetween } from '@/components/coachModules/shared';
import { AUDIENCES, KINDS, type Session } from '@/components/coachModules/sessions';
import { CheckList } from './frame';

const LENGTHS = [30, 45, 60, 75, 90, 120, 180];
const lengthLabel = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`);

export type Host = { id: string; name: string; role: string };
type Draft = { kind: string; title: string; description: string; date: string; time: string; minutes: number; capacity: string; audience: string; packageIds: string[]; joinUrl: string; hostId: string; reason: string };
const blank = (): Draft => ({ kind: 'group_class', title: '', description: '', date: istDate(7), time: '18:00', minutes: 45, capacity: '', audience: 'members', packageIds: [], joinUrl: '', hostId: '', reason: '' });

export function AdminSessionForm({ open, session, onClose, onSaved }: { open: boolean; session?: Session | null; onClose: () => void; onSaved: (s: Session) => void }) {
  const [d, setD] = useState<Draft>(blank());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const packages = useLoad<{ items: Array<{ id: string; name: string; archived?: boolean; archivedAt?: string | null }> }>(open ? 'packages' : null, () => (open ? get('/packages') : Promise.resolve({ items: [] })), [open]);
  const hosts = useLoad<{ items: Host[] }>(null, () => (open && !session ? get('/admin/sessions/hosts') : Promise.resolve({ items: [] })), [open, session?.id]);
  useEffect(() => {
    if (!open) return;
    setErr(''); setErrs({});
    setD(session ? { kind: session.kind, title: session.title, description: session.description ?? '', date: isoToIstDate(session.startAt), time: isoToIstTime(session.startAt), minutes: minutesBetween(session.startAt, session.endAt), capacity: session.capacity ? String(session.capacity) : '', audience: session.audience, packageIds: session.packageIds ?? [], joinUrl: session.joinUrl ?? '', hostId: session.hostId, reason: '' } : blank());
  }, [open, session]);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const locked = !!session && session.status !== 'draft'; // who can join is fixed once published
  const timesOk = isIsoDate(d.date) && isClockTime(d.time);
  const save = async () => {
    setBusy(true); setErr(''); setErrs({});
    try {
      const startAt = istToIso(d.date, d.time);
      const endAt = new Date(Date.parse(startAt) + d.minutes * 60_000).toISOString();
      const body: Record<string, unknown> = { kind: d.kind, title: d.title, description: d.description, startAt, endAt, capacity: d.capacity.trim() ? Number(d.capacity) : null, joinUrl: d.joinUrl.trim() || null };
      if (!locked) { body.audience = d.audience; body.packageIds = d.audience === 'packages' ? d.packageIds : []; }
      const out = session ? await patch<Session>(`/admin/sessions/${session.id}`, { ...body, reason: d.reason.trim() || undefined }) : await post<Session>('/admin/sessions', { ...body, ...(d.hostId ? { hostId: d.hostId } : {}) });
      onSaved(out); onClose();
    } catch (e) { setErrs(fieldErrorsOf(e)); setErr(errorText(e)); } finally { setBusy(false); }
  };
  const pkgs = (packages.data?.items ?? []).filter((p) => !p.archived && !p.archivedAt);
  const lengths = LENGTHS.includes(d.minutes) ? LENGTHS : [...LENGTHS, d.minutes].sort((a, b) => a - b);
  return <Sheet open={open} onClose={onClose} title={session ? 'Edit the session' : 'New session'} footer={<Row><Button title="Cancel" variant="ghost" onPress={onClose} disabled={busy} /><Button title={session ? 'Save' : 'Save as draft'} busy={busy} disabled={!timesOk} onPress={save} style={{ flex: 1 }} /></Row>}>
    <PickerField label="Kind" value={d.kind} options={KINDS.map(([k, l]) => ({ value: k, label: l }))} onChange={(kind) => set({ kind })} error={errs.kind} />
    <Field label="Title" error={errs.title}><Input value={d.title} maxLength={160} onChangeText={(title) => set({ title })} accessibilityLabel="Title" /></Field>
    <Field label="Description (optional)" hint="What happens in the session and who it suits. No medical claims, prices or speaker credentials." error={errs.description}><Input value={d.description} maxLength={4000} onChangeText={(description) => set({ description })} multiline style={{ minHeight: 80, textAlignVertical: 'top' }} accessibilityLabel="Description" /></Field>
    <DatePickerField label="Date (IST)" value={d.date} onChange={(date) => set({ date })} error={errs.startAt} />
    <TimePickerField label="Starts (IST)" value={d.time} onChange={(time) => set({ time })} />
    <PickerField label="Length" value={String(d.minutes)} options={lengths.map((m) => ({ value: String(m), label: lengthLabel(m) }))} onChange={(m) => set({ minutes: Number(m) })} chipsUpTo={8} error={errs.endAt} />
    <Field label="Places (optional)" hint="Leave empty for no limit. When it is full, new sign-ups join the waitlist." error={errs.capacity}><Input value={d.capacity} keyboardType="number-pad" onChangeText={(capacity) => set({ capacity: capacity.replace(/[^\d]/g, '') })} maxLength={4} accessibilityLabel="Places" /></Field>
    {!session ? <PickerField label="Host" placeholder="Me" value={d.hostId} options={(hosts.data?.items ?? []).map((h) => ({ value: h.id, label: `${h.name}${h.role === 'coach' ? '' : ' (Bioptime team)'}` }))} onChange={(hostId) => set({ hostId })} chipsUpTo={4} error={errs.hostId} /> : null}
    <PickerField label="Who can join" hint={locked ? 'Fixed once the session is published.' : undefined} value={d.audience} options={Object.entries(AUDIENCES).map(([k, l]) => ({ value: k, label: l }))} onChange={(audience) => set({ audience })} disabled={locked} error={errs.audience} />
    {d.audience === 'packages' ? <View><CheckList label="Packages" error={errs.packageIds} disabled={locked} options={pkgs.map((p) => ({ value: p.id, label: p.name }))} value={d.packageIds} onChange={(packageIds) => set({ packageIds })} /></View> : null}
    <Field label="Join link (optional)" hint="The https link you will use. No video provider is connected, so nothing is created for you; without a link, members read that the host will share how to join." error={errs.joinUrl}><Input value={d.joinUrl} placeholder="https://" autoCapitalize="none" autoCorrect={false} keyboardType="url" onChangeText={(joinUrl) => set({ joinUrl })} accessibilityLabel="Join link" /></Field>
    {session && session.status === 'published' ? <><Field label="What changed, for the record (optional)" error={errs.reason}><Input value={d.reason} maxLength={300} onChangeText={(reason) => set({ reason })} accessibilityLabel="What changed, for the record" /></Field><P muted small>People who registered are told when the time or the join link changes.</P></> : null}
    {err ? <Notice kind="error">{err}</Notice> : null}
  </Sheet>;
}
