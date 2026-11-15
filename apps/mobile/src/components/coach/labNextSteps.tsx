/* "Next steps" on the coach's report page (the portal's modules/labFollowups/ReportNextSteps.tsx and shared.tsx for a
   coach), shown while the 'labFollowups' flag is on: the steps on this report with Mark done, Cancel (a reason),
   Reopen (a reason) and the link select, and the form that adds one once the report is released. The server checks the
   assignment and the client's health sharing again. */
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { ApiError, errorText, get, patch, post } from '@/lib/api';
import { fmtDate, fmtDateTime, label } from '@/lib/format';
import { fmtDay, todayIst } from '@/lib/coach/core/format';
import { useLoad } from '@/lib/useLoad';
import { Button, Card, Field, Loading, Notice, Pill, Row } from '@/components/ui';
import { DatePickerField, ReasonDialog } from '@/components/workspace';
import { Bold, CardHead, LinkText, Muted, PickerField, Small, TextArea, Tile } from './shared';
import { space } from '@/theme';

export type Kind = 'consultation' | 'retest' | 'plan_change' | 'note';
export type Status = 'open' | 'done' | 'cancelled';
export const KINDS: Array<{ id: Kind; label: string; hint: string }> = [
  { id: 'consultation', label: 'Consultation', hint: 'Talk the report through; link the appointment once it is booked.' },
  { id: 'retest', label: 'Retest', hint: 'Agreed with the member (and their doctor where it matters); link the booking once it is made.' },
  { id: 'plan_change', label: 'Plan change', hint: 'A change to the coaching plan; link the plan it changes.' },
  { id: 'note', label: 'Note', hint: 'Anything else the member should do or know.' },
];
export type FollowUp = { id: string; reportId: string; memberId: string; memberName?: string; kind: Kind; kindLabel: string; note: string; dueDate: string | null; status: Status; overdue: boolean; report: { id: string; bookingId: string; reference: string; testName: string | null; collectedAt: string; releasedAt: string | null } | null; appointment: { id: string; kind: string; startAt: string; status: string } | null; booking: { id: string; reference: string; testName: string | null; slotAt: string; status: string; reportId: string | null } | null; plan: { id: string; title: string; status: string } | null; setBy: { role: 'coach' | 'team'; name: string | null }; createdAt: string; updatedAt: string; completedAt: string | null; cancelledReason?: string | null };
export type LinkOptions = { appointments: Array<{ id: string; kind: string; startAt: string; status: string }>; bookings: Array<{ id: string; reference: string; testName: string | null; slotAt: string; status: string }>; plans: Array<{ id: string; title: string; status: string }> };
type View_ = { items: FollowUp[]; options?: LinkOptions; canAdd?: boolean | null };

function StatusPillFU({ f }: { f: FollowUp }) {
  if (f.status === 'open' && f.overdue) return <Pill tone="warning">Past due</Pill>;
  return <Pill tone={f.status === 'open' ? 'info' : f.status === 'done' ? 'success' : 'info'}>{f.status === 'open' ? 'Open' : f.status === 'done' ? 'Done' : 'Cancelled'}</Pill>;
}

export function FollowUpLine({ f, showReport, actions }: { f: FollowUp; showReport?: boolean; actions?: React.ReactNode }) {
  const router = useRouter();
  return <View style={{ paddingVertical: space.sm, gap: 2 }}>
    <Bold style={f.status !== 'open' ? { textDecorationLine: 'line-through', opacity: 0.8 } : undefined}>{`${f.kindLabel} · ${f.note}`}</Bold>
    {showReport && f.report ? <LinkText small onPress={() => router.push(`/coach/reports/${f.report!.id}`)}>{`${f.report.testName ?? 'Report'} · ${f.report.reference}`}</LinkText> : null}
    {f.appointment ? <Muted>{`${label(f.appointment.kind)} · ${fmtDateTime(f.appointment.startAt)} · ${label(f.appointment.status)}`}</Muted> : null}
    {f.booking ? <Row><Muted>{`${f.booking.testName ?? 'Booking'} · ${f.booking.reference} · ${fmtDateTime(f.booking.slotAt)} · ${label(f.booking.status)}`}</Muted>{f.booking.reportId ? <LinkText small onPress={() => router.push(`/coach/reports/${f.booking!.reportId}`)}>Its report</LinkText> : null}</Row> : null}
    {f.plan ? <Muted>{`Plan: ${f.plan.title} · ${label(f.plan.status)}`}</Muted> : null}
    <Muted>{`${f.dueDate ? `Due ${fmtDay(f.dueDate)}` : 'No due date'} · ${f.setBy.role === 'coach' ? `Coach${f.setBy.name ? ` ${f.setBy.name}` : ''}` : 'The Bioptime team'} · ${fmtDate(f.createdAt)}${f.status === 'done' && f.completedAt ? ` · done ${fmtDate(f.completedAt)}` : ''}${f.status === 'cancelled' && f.cancelledReason ? ` · cancelled: ${f.cancelledReason}` : ''}`}</Muted>
    <Row style={{ marginTop: 4 }}><StatusPillFU f={f} />{actions}</Row>
  </View>;
}

/** Mark done without a reason; cancel and reopen with one. */
export function FollowUpActions({ f, onChanged, show }: { f: FollowUp; onChanged: () => void; show: (t: string, k?: 'ok' | 'error') => void }) {
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const send = async (status: Status, reason?: string) => { await patch(`/coach/lab-follow-ups/${f.id}`, { status, ...(reason ? { reason } : {}) }); show(status === 'done' ? 'Marked done' : status === 'open' ? 'Reopened' : 'Cancelled'); onChanged(); };
  const done = async () => { setBusy(true); try { await send('done'); } catch (e) { show(errorText(e), 'error'); } finally { setBusy(false); } };
  const titles: Record<Status, string> = { done: 'Mark this next step done', cancelled: 'Cancel this next step', open: 'Reopen this next step' };
  return <>
    {f.status === 'open' ? <><Button title="Mark done" small variant="secondary" busy={busy} onPress={done} /><Button title="Cancel" small variant="ghost" onPress={() => { setErr(null); setAsk('cancelled'); }} /></> : <Button title="Reopen" small variant="ghost" onPress={() => { setErr(null); setAsk('open'); }} />}
    <ReasonDialog open={!!ask} onClose={() => setAsk(null)} title={ask ? titles[ask] : ''} destructive={ask === 'cancelled'} confirmLabel={ask === 'cancelled' ? 'Cancel it' : ask === 'open' ? 'Reopen' : 'Mark done'} error={err}
      body={ask === 'cancelled' ? 'The member no longer sees a cancelled next step. The reason is kept with it.' : ask === 'open' ? 'It returns to the open list, for you and the member.' : 'The member sees it as done.'}
      onConfirm={async (reason) => { try { await send(ask!, reason); setAsk(null); } catch (e) { setErr(errorText(e)); } }} />
  </>;
}

/** Link a retest booking, an appointment or a plan to an open next step (or change it). */
export function LinkEditor({ f, options, onChanged, show }: { f: FollowUp; options: LinkOptions | null; onChanged: () => void; show: (t: string, k?: 'ok' | 'error') => void }) {
  const field = f.kind === 'consultation' ? 'appointmentId' : f.kind === 'retest' ? 'bookingId' : f.kind === 'plan_change' ? 'planId' : null;
  if (!field || !options || f.status !== 'open') return null;
  const current = f.kind === 'consultation' ? f.appointment?.id : f.kind === 'retest' ? f.booking?.id : f.plan?.id;
  const later = options.bookings.filter((b) => !f.report || (b.id !== f.report.bookingId && b.slotAt > f.report.collectedAt));
  const choices = f.kind === 'consultation' ? options.appointments.map((a) => ({ value: a.id, label: `${label(a.kind)} · ${fmtDateTime(a.startAt)}` })) : f.kind === 'retest' ? later.map((b) => ({ value: b.id, label: `${b.testName ?? 'Booking'} · ${b.reference} · ${fmtDateTime(b.slotAt)}` })) : options.plans.map((p) => ({ value: p.id, label: p.title }));
  if (!choices.length && !current) return null;
  const placeholder = f.kind === 'retest' ? 'Link the retest booking' : f.kind === 'consultation' ? 'Link the appointment' : 'Link the plan';
  const save = async (value: string) => { try { await patch(`/coach/lab-follow-ups/${f.id}`, { [field]: value || null }); show('Link saved'); onChanged(); } catch (e) { show(errorText(e), 'error'); } };
  return <View style={{ flex: 1, minWidth: 160 }}><PickerField label="Link" value={current ?? ''} placeholder={placeholder} options={[{ value: '', label: placeholder }, ...choices]} onChange={(v) => { void save(v); }} /></View>;
}

/** The form that adds a next step to a released report. */
export function FollowUpForm({ reportId, options, onAdded, show }: { reportId: string; options: LinkOptions | null; onAdded: () => void; show: (t: string, k?: 'ok' | 'error') => void }) {
  const [kind, setKind] = useState<Kind>('consultation');
  const [note, setNote] = useState('');
  const [due, setDue] = useState('');
  const [link, setLink] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const today = todayIst();
  const linkField = kind === 'consultation' ? 'appointmentId' : kind === 'retest' ? 'bookingId' : kind === 'plan_change' ? 'planId' : null;
  const linkChoices = !options ? [] : kind === 'consultation' ? options.appointments.map((a) => ({ value: a.id, label: `${label(a.kind)} · ${fmtDateTime(a.startAt)} · ${label(a.status)}` })) : kind === 'retest' ? options.bookings.map((b) => ({ value: b.id, label: `${b.testName ?? 'Booking'} · ${b.reference} · ${fmtDateTime(b.slotAt)} · ${label(b.status)}` })) : kind === 'plan_change' ? options.plans.map((p) => ({ value: p.id, label: `${p.title} · ${label(p.status)}` })) : [];
  const submit = async () => {
    const e: Record<string, string> = {};
    if (note.trim().length < 3) e.note = 'Write the next step in a few words.';
    if (due && due < today) e.dueDate = 'Pick today or a later date.';
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await post(`/coach/reports/${reportId}/follow-ups`, { kind, note: note.trim(), ...(due ? { dueDate: due } : {}), ...(linkField && link ? { [linkField]: link } : {}) });
      show('Next step added; the member is notified without the detail');
      setNote(''); setDue(''); setLink('');
      onAdded();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors()).length) setErrs(err.fieldErrors()); else setErrs({ form: errorText(err) });
    } finally { setBusy(false); }
  };
  const hint = KINDS.find((k) => k.id === kind)!.hint;
  return <Tile>
    <PickerField label="Kind" value={kind} options={KINDS.map((k) => ({ value: k.id, label: k.label }))} onChange={(v) => { setKind(v as Kind); setLink(''); }} hint={hint} error={errs.kind} />
    <Field label="Next step" hint="In the member’s words: what happens next and who does it. No new interpretation of the results." error={errs.note}><TextArea rows={3} value={note} maxLength={2000} onChangeText={setNote} accessibilityLabel="Next step" /></Field>
    <DatePickerField label="Due date (optional)" value={due} onChange={setDue} hint="Only a date you have agreed; leave it empty otherwise." error={errs.dueDate} min={today} />
    {linkField ? <PickerField label={`${kind === 'consultation' ? 'Appointment' : kind === 'retest' ? 'Booking' : 'Plan'} (optional)`} value={link} placeholder="Not linked" options={[{ value: '', label: 'Not linked' }, ...linkChoices]} onChange={setLink} disabled={!linkChoices.length} error={errs[linkField]} hint={linkChoices.length ? undefined : kind === 'consultation' ? 'No appointment to link yet; you can link one later.' : kind === 'retest' ? 'No other booking to link yet; link the retest once the member books it.' : 'No current plan to link.'} /> : null}
    {errs.form ? <Notice kind="error">{errs.form}</Notice> : null}
    <Button title="Add next step" busy={busy} onPress={submit} />
  </Tile>;
}

export function ReportNextSteps({ report, show }: { report: { id: string; memberId: string; released: boolean }; show: (t: string, k?: 'ok' | 'error') => void }) {
  const view = useLoad<View_>(null, () => get(`/coach/clients/${report.memberId}/lab-follow-ups?reportId=${encodeURIComponent(report.id)}`), [report.id, report.memberId, report.released]);
  const d = view.data;
  const items = d?.items ?? [];
  const reload = () => { void view.reload(); };
  return <Card>
    <CardHead eyebrow="Follow-up" title="Next steps" />
    {view.error ? <Notice kind="error">{view.error.message}</Notice> : !d ? <Loading /> : <View style={{ gap: space.sm }}>
      {items.length ? items.map((f) => <FollowUpLine key={f.id} f={f} actions={f.setBy.role === 'coach' ? <><LinkEditor f={f} options={d.options ?? null} onChanged={reload} show={show} /><FollowUpActions f={f} onChanged={reload} show={show} /></> : undefined} />) : <Small>{report.released ? 'No next steps on this report yet.' : 'Next steps are added once the report is reviewed and released.'}</Small>}
      {report.released ? <FollowUpForm reportId={report.id} options={d.options ?? null} onAdded={reload} show={show} /> : null}
      <Muted>The member sees open and done next steps with the report. When one is added they are notified: the notice says only that a next step was added, and any email or push copy carries just its title. They read the step itself when they sign in.</Muted>
    </View>}
  </Card>;
}
