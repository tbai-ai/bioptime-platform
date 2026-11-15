/* The coach's appointment and progress dialogs as bottom sheets, with the portal's titles, fields, footers and notes
   (pages/ClientDetail.tsx ScheduleDialog and ProgressDialog, pages/Appointments.tsx CompleteDialog and MoveDialog). */
import React, { useEffect, useState } from 'react';
import { errorText, get, patch, post } from '@/lib/api';
import { fmtTime } from '@/lib/format';
import { addDaysIst } from '@/lib/coach/core/format';
import { useLoad } from '@/lib/useLoad';
import { Button, Field, Input, Notice, Row } from '@/components/ui';
import { DatePickerField, isIsoDate, Sheet } from '@/components/workspace';
import { Muted, PickerField, TextArea } from './shared';

type Slot = { startAt: string; endAt: string };

function useSlots(date: string, active: boolean) {
  return useLoad<{ date: string; slots: Slot[] }>(null, () => (active && isIsoDate(date) ? get(`/coach/appointments/slots?date=${date}`) : Promise.resolve({ date, slots: [] })), [date, active]);
}

const KINDS = [{ value: 'consultation', label: 'Consultation (uses an entitlement)' }, { value: 'check_in', label: 'Check-in (courtesy)' }, { value: 'review', label: 'Review' }];

export function ScheduleDialog({ open, onClose, memberId, onDone }: { open: boolean; onClose: () => void; memberId: string; onDone: () => void }) {
  const [date, setDate] = useState(addDaysIst(2));
  const [slot, setSlot] = useState('');
  const [kind, setKind] = useState('consultation');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const slots = useSlots(date, open);
  useEffect(() => { if (open) { setErr(''); setSlot(''); } }, [open]);
  const list = slots.data?.slots ?? [];
  const go = async () => {
    setBusy(true); setErr('');
    try { await post('/coach/appointments', { memberId, startAt: slot, kind, ...(note.trim() ? { note: note.trim() } : {}) }); setNote(''); setSlot(''); onDone(); onClose(); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <Sheet open={open} onClose={onClose} title="Schedule a consultation" footer={<Row><Button title="Cancel" variant="secondary" onPress={onClose} style={{ flex: 1 }} /><Button title="Schedule" busy={busy} disabled={!slot} onPress={go} style={{ flex: 1 }} /></Row>}>
    <DatePickerField label="Date" value={date} onChange={(v) => { setDate(v); setSlot(''); }} />
    <PickerField label="Slot (IST)" value={slot} onChange={setSlot} placeholder="Choose a time" options={list.map((s) => ({ value: s.startAt, label: fmtTime(s.startAt) }))} hint={slots.loading && !slots.data ? 'Looking for free slots…' : list.length ? `${list.length} free slots in your working hours` : 'No free slots that day'} />
    <PickerField label="Kind" value={kind} onChange={setKind} options={KINDS} />
    <Field label="Note for the member (optional)"><Input value={note} onChangeText={setNote} maxLength={500} /></Field>
    {err ? <Notice kind="error">{err}</Notice> : null}
    <Muted>The coach's slot and the member's calendar are checked on the server; a taken slot is refused.</Muted>
  </Sheet>;
}

export function ProgressDialog({ open, onClose, memberId, metrics, onDone }: { open: boolean; onClose: () => void; memberId: string; metrics: Array<{ metric: string; label: string; unit: string }>; onDone: () => void }) {
  const [metric, setMetric] = useState('');
  const [value, setValue] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setErr(''); }, [open]);
  const n = Number(value.replace(',', '.'));
  const ok = !!metric && value.trim() !== '' && Number.isFinite(n);
  const go = async () => {
    setBusy(true); setErr('');
    try { await post(`/coach/clients/${memberId}/progress`, { metric, value: n }); setValue(''); setMetric(''); onDone(); onClose(); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <Sheet open={open} onClose={onClose} title="Record a progress value" footer={<Row><Button title="Cancel" variant="secondary" onPress={onClose} style={{ flex: 1 }} /><Button title="Save" busy={busy} disabled={!ok} onPress={go} style={{ flex: 1 }} /></Row>}>
    <PickerField label="Metric" value={metric} onChange={setMetric} placeholder="Choose" options={metrics.map((m) => ({ value: m.metric, label: `${m.label} (${m.unit})` }))} />
    <Field label="Value"><Input value={value} onChangeText={setValue} keyboardType="decimal-pad" accessibilityLabel="Value" /></Field>
    {err ? <Notice kind="error">{err}</Notice> : null}
    <Muted>Recorded as coach-entered, never as a laboratory measurement.</Muted>
  </Sheet>;
}

export function CompleteDialog({ a, onClose, onDone }: { a: { id: string } | null; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (a) { setNote(''); setErr(''); } }, [a]);
  const go = async () => {
    if (!a) return;
    setBusy(true); setErr('');
    try { await post(`/coach/appointments/${a.id}/complete`, { note }); onDone(); onClose(); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <Sheet open={!!a} onClose={onClose} title="Mark the consultation completed" footer={<Row><Button title="Not yet" variant="secondary" onPress={onClose} style={{ flex: 1 }} /><Button title="Complete" busy={busy} onPress={go} style={{ flex: 1 }} /></Row>}>
    <Field label="What was covered (internal, optional)"><TextArea rows={3} value={note} onChangeText={setNote} maxLength={2000} /></Field>
    {err ? <Notice kind="error">{err}</Notice> : null}
    <Muted>Completing a consultation consumes one of the member's consultations.</Muted>
  </Sheet>;
}

export function MoveDialog({ a, onClose, onDone }: { a: { id: string } | null; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(addDaysIst(1));
  const [slot, setSlot] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const slots = useSlots(date, !!a);
  useEffect(() => { if (a) { setSlot(''); setErr(''); } }, [a]);
  const list = slots.data?.slots ?? [];
  const go = async () => {
    if (!a) return;
    setBusy(true); setErr('');
    try { await patch(`/coach/appointments/${a.id}`, { startAt: slot, reason: 'moved by the coach' }); onDone(); onClose(); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <Sheet open={!!a} onClose={onClose} title="Move the appointment" footer={<Row><Button title="Keep" variant="secondary" onPress={onClose} style={{ flex: 1 }} /><Button title="Move" busy={busy} disabled={!slot} onPress={go} style={{ flex: 1 }} /></Row>}>
    <DatePickerField label="Date" value={date} onChange={(v) => { setDate(v); setSlot(''); }} />
    <PickerField label="Slot" value={slot} onChange={setSlot} placeholder="Choose" options={list.map((s) => ({ value: s.startAt, label: fmtTime(s.startAt) }))} hint={slots.loading && !slots.data ? 'Looking for free slots…' : list.length ? `${list.length} free slots in your working hours` : 'No free slots that day'} />
    {err ? <Notice kind="error">{err}</Notice> : null}
  </Sheet>;
}
