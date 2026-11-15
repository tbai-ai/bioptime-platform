/* M8 Live sessions in the coach workspace: what the list, the detail and the client tab share (the web's
   modules/sessions/shared.tsx and SessionForm.tsx): labels, the pills, the places line, the create/edit sheet (times
   entered in IST and sent as ISO instants; the join link optional and https only, since no video provider creates
   meetings), and the calendar file handed to the share sheet. */
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import React, { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { errorText, get, loadToken, patch, post } from '@/lib/api';
import { apiBaseSync, CLIENT_HEADER, gateHeaders } from '@/lib/config';
import { istDate } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Button, Check, Field, Input, Notice, P, Pill, Row } from '@/components/ui';
import { DatePickerField, Sheet, TimePickerField, isClockTime, isIsoDate } from '@/components/workspace';
import { PickerField, fieldErrorsOf, isoToIstDate, isoToIstTime, istToIso, minutesBetween } from './shared';

export const KINDS: Array<[string, string]> = [['group_class', 'Group class'], ['webinar', 'Webinar'], ['workshop', 'Workshop']];
export const AUDIENCES: Record<string, string> = { members: 'Members with a live programme', packages: 'Members of chosen packages', public: 'Public (anyone, on the public listing)' };
export const AUDIENCE_SHORT: Record<string, string> = { members: 'Members', packages: 'Chosen packages', public: 'Public' };
const LENGTHS = [30, 45, 60, 75, 90, 120, 180];
const lengthLabel = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`);

export type Session = {
  id: string; kind: string; kindLabel: string; title: string; description: string | null; startAt: string; endAt: string; capacity: number | null; audience: string; packages: Array<{ id: string; name: string }>; packageIds: string[];
  joinUrl: string | null; hostId: string; hostName: string; hostRole: string; status: 'draft' | 'published' | 'completed' | 'cancelled'; cancelledReason: string | null; counts: { registered: number; attended: number; noShow: number; waitlisted: number }; createdAt: string;
};

/** A registration's status as a pill: registered, waitlist place, attended, no-show or cancelled. */
export function RegistrationPill({ status, position }: { status: string; position?: number | null }) {
  if (status === 'waitlisted') return <Pill tone="warning">{position ? `Waitlist #${position}` : 'Waitlist'}</Pill>;
  if (status === 'registered') return <Pill tone="info">Registered</Pill>;
  if (status === 'attended') return <Pill tone="success">Attended</Pill>;
  if (status === 'no_show') return <Pill tone="error">No-show</Pill>;
  return <Pill tone="info">Cancelled</Pill>;
}
/** The session's own status. */
export function SessionStatusPill({ status }: { status: string }) {
  return <Pill tone={status === 'published' ? 'success' : status === 'draft' ? 'warning' : status === 'completed' ? 'success' : 'info'}>{status === 'published' ? 'Open' : status === 'draft' ? 'Draft' : status === 'completed' ? 'Completed' : 'Cancelled'}</Pill>;
}
/** "4 of 12 registered · 2 waiting" (host counts). */
export function placesText(s: { capacity: number | null; counts?: Session['counts'] }): string {
  if (s.counts) {
    const held = s.counts.registered + s.counts.attended + s.counts.noShow;
    return `${held}${s.capacity ? ` of ${s.capacity}` : ''} registered${s.counts.waitlisted ? ` · ${s.counts.waitlisted} waiting` : ''}`;
  }
  return s.capacity === null ? 'No limit on places' : `${s.capacity} places`;
}

/** The calendar file (.ics) of one of the coach's sessions or consultations, fetched with the session and handed to
 *  the share sheet (a download in the browser). */
export async function shareIcs(path: string, filename: string): Promise<void> {
  const token = await loadToken();
  const address = `${apiBaseSync()}/api${path}`;
  const res = await fetch(address, { headers: { Accept: 'text/calendar', 'X-Bioptime-Client': CLIENT_HEADER, ...gateHeaders(address), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  if (!res.ok) throw new Error(`The calendar file could not be fetched (${res.status}).`);
  const text = await res.text();
  if (Platform.OS === 'web') {
    const doc = (globalThis as unknown as { document?: Document }).document;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar' }));
    if (doc) { const a = doc.createElement('a'); a.href = url; a.download = filename; doc.body.appendChild(a); a.click(); a.remove(); }
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return;
  }
  const file = new FileSystem.File(FileSystem.Paths.cache, filename);
  file.write(text);
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: 'text/calendar', dialogTitle: filename });
  else throw new Error('Sharing is not available on this device.');
}

type Draft = { kind: string; title: string; description: string; date: string; time: string; minutes: number; capacity: string; audience: string; packageIds: string[]; joinUrl: string; reason: string };
const blank = (): Draft => ({ kind: 'group_class', title: '', description: '', date: istDate(7), time: '18:00', minutes: 45, capacity: '', audience: 'members', packageIds: [], joinUrl: '', reason: '' });

/** The create and edit sheet for the coach's sessions (the portal's SessionForm, coach mode). */
export function SessionForm({ open, session, onClose, onSaved }: { open: boolean; session?: Session | null; onClose: () => void; onSaved: (s: Session) => void }) {
  const [d, setD] = useState<Draft>(blank());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const packages = useLoad<{ items: Array<{ id: string; name: string; archived?: boolean }> }>(open ? 'packages' : null, () => (open ? get('/packages') : Promise.resolve({ items: [] })), [open]);
  useEffect(() => {
    if (!open) return;
    setErr(''); setErrs({});
    setD(session ? { kind: session.kind, title: session.title, description: session.description ?? '', date: isoToIstDate(session.startAt), time: isoToIstTime(session.startAt), minutes: minutesBetween(session.startAt, session.endAt), capacity: session.capacity ? String(session.capacity) : '', audience: session.audience, packageIds: session.packageIds ?? [], joinUrl: session.joinUrl ?? '', reason: '' } : blank());
  }, [open, session]);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const locked = !!session && session.status !== 'draft'; // who can join is fixed once published
  const valid = isIsoDate(d.date) && isClockTime(d.time) && d.title.trim().length >= 3 && (!d.capacity.trim() || (/^\d+$/.test(d.capacity.trim()) && Number(d.capacity) >= 1 && Number(d.capacity) <= 1000));
  const save = async () => {
    setBusy(true); setErr(''); setErrs({});
    try {
      const startAt = istToIso(d.date, d.time);
      const endAt = new Date(Date.parse(startAt) + d.minutes * 60_000).toISOString();
      const body: Record<string, unknown> = { kind: d.kind, title: d.title.trim(), description: d.description, startAt, endAt, capacity: d.capacity.trim() ? Number(d.capacity) : null, joinUrl: d.joinUrl.trim() || null };
      if (!locked) { body.audience = d.audience; body.packageIds = d.audience === 'packages' ? d.packageIds : []; }
      const out = session ? await patch<Session>(`/coach/sessions/${session.id}`, { ...body, reason: d.reason.trim() || undefined }) : await post<Session>('/coach/sessions', body);
      onSaved(out); onClose();
    } catch (e) { setErrs(fieldErrorsOf(e)); setErr(errorText(e)); } finally { setBusy(false); }
  };
  const pkgs = (packages.data?.items ?? []).filter((p) => !p.archived);
  const lengths = LENGTHS.includes(d.minutes) ? LENGTHS : [...LENGTHS, d.minutes].sort((a, b) => a - b);
  return <Sheet open={open} onClose={onClose} title={session ? 'Edit the session' : 'New session'} footer={<Row><Button title="Cancel" variant="ghost" onPress={onClose} disabled={busy} /><Button title={session ? 'Save' : 'Save as draft'} busy={busy} disabled={!valid} onPress={save} style={{ flex: 1 }} /></Row>}>
    <PickerField label="Kind" value={d.kind} options={KINDS.map(([k, l]) => ({ value: k, label: l }))} onChange={(kind) => set({ kind })} error={errs.kind} />
    <Field label="Title" error={errs.title}><Input value={d.title} maxLength={160} onChangeText={(title) => set({ title })} /></Field>
    <Field label="Description (optional)" hint="What happens in the session and who it suits. No medical claims, prices or speaker credentials." error={errs.description}><Input value={d.description} maxLength={4000} onChangeText={(description) => set({ description })} multiline style={{ minHeight: 80, textAlignVertical: 'top' }} /></Field>
    <DatePickerField label="Date (IST)" value={d.date} onChange={(date) => set({ date })} error={errs.startAt} />
    <TimePickerField label="Starts (IST)" value={d.time} onChange={(time) => set({ time })} />
    <PickerField label="Length" value={String(d.minutes)} options={lengths.map((m) => ({ value: String(m), label: lengthLabel(m) }))} onChange={(m) => set({ minutes: Number(m) })} chipsUpTo={8} error={errs.endAt} />
    <Field label="Places (optional)" hint="Leave empty for no limit. When it is full, new sign-ups join the waitlist." error={errs.capacity}><Input value={d.capacity} keyboardType="number-pad" onChangeText={(capacity) => set({ capacity: capacity.replace(/[^\d]/g, '') })} maxLength={4} /></Field>
    <PickerField label="Who can join" hint={locked ? 'Fixed once the session is published.' : undefined} value={d.audience} options={Object.entries(AUDIENCES).filter(([k]) => k !== 'public').map(([k, l]) => ({ value: k, label: l }))} onChange={(audience) => set({ audience })} disabled={locked} error={errs.audience} />
    {d.audience === 'packages' ? <Field label="Packages" error={errs.packageIds}><View>{pkgs.map((p) => <Check key={p.id} label={p.name} checked={d.packageIds.includes(p.id)} onChange={(v) => { if (locked) return; set({ packageIds: v ? [...d.packageIds, p.id] : d.packageIds.filter((x) => x !== p.id) }); }} />)}</View></Field> : null}
    <Field label="Join link (optional)" hint="The https link you will use. No video provider is connected, so nothing is created for you; without a link, members read that the host will share how to join." error={errs.joinUrl}><Input value={d.joinUrl} placeholder="https://" autoCapitalize="none" autoCorrect={false} keyboardType="url" onChangeText={(joinUrl) => set({ joinUrl })} /></Field>
    {session && session.status === 'published' ? <><Field label="What changed, for the record (optional)" error={errs.reason}><Input value={d.reason} maxLength={300} onChangeText={(reason) => set({ reason })} /></Field><P muted small>People who registered are told when the time or the join link changes.</P></> : null}
    {err ? <Notice kind="error">{err}</Notice> : null}
  </Sheet>;
}
