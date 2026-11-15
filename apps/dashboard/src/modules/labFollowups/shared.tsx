/* M7 Lab follow-ups: the shapes the API returns, the flag check, one next step as every list shows it, the form that
   adds one, and the actions that complete, cancel or reopen it. Existing components and classes only. */
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { Link } from '../../lib/nav';
import { fmtDate, fmtDateTime, label } from '../../lib/format';
import { Alert, Button, Field, Input, Pill, ReasonDialog, Select, Textarea, useToast, errorText } from '../../ui';
import { useFeatures } from '../runtime';

export const FLAG = 'labFollowups';
export type Kind = 'consultation' | 'retest' | 'plan_change' | 'note';
export type Status = 'open' | 'done' | 'cancelled';
export const KINDS: Array<{ id: Kind; label: string; hint: string }> = [
  { id: 'consultation', label: 'Consultation', hint: 'Talk the report through; link the appointment once it is booked.' },
  { id: 'retest', label: 'Retest', hint: 'Agreed with the member (and their doctor where it matters); link the booking once it is made.' },
  { id: 'plan_change', label: 'Plan change', hint: 'A change to the coaching plan; link the plan it changes.' },
  { id: 'note', label: 'Note', hint: 'Anything else the member should do or know.' },
];

export type FollowUp = {
  id: string; reportId: string; memberId: string; memberName?: string; kind: Kind; kindLabel: string; note: string; dueDate: string | null; status: Status; overdue: boolean;
  report: { id: string; bookingId: string; reference: string; testName: string | null; collectedAt: string; releasedAt: string | null } | null;
  appointment: { id: string; kind: string; startAt: string; status: string } | null;
  booking: { id: string; reference: string; testName: string | null; slotAt: string; status: string; reportId: string | null } | null;
  plan: { id: string; title: string; status: string } | null;
  setBy: { role: 'coach' | 'team'; name: string | null };
  createdAt: string; updatedAt: string; completedAt: string | null; cancelledReason?: string | null;
};
export type LinkOptions = {
  appointments: Array<{ id: string; kind: string; startAt: string; status: string }>;
  bookings: Array<{ id: string; reference: string; testName: string | null; slotAt: string; status: string }>;
  plans: Array<{ id: string; title: string; status: string }>;
};

/** Is the module on for this person? null while the flags load. */
export function useLabFlag(): boolean | null {
  const features = useFeatures(true);
  return features ? features.has(FLAG) : null;
}

/** A calendar date (YYYY-MM-DD) in the brand's format. */
export const day = (d: string) => fmtDate(`${d}T12:00:00Z`);
export const todayLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

const STATUS_TEXT: Record<Status, string> = { open: 'Open', done: 'Done', cancelled: 'Cancelled' };
export function StatusPill({ f }: { f: FollowUp }) {
  if (f.status === 'open' && f.overdue) return <span className="bp-pill bp-pill-warning">Past due</span>;
  return <Pill status={f.status === 'open' ? 'scheduled' : f.status === 'done' ? 'completed' : 'cancelled'}>{STATUS_TEXT[f.status]}</Pill>;
}

/** What the next step points at, in one line each. */
export function LinkLines({ f, member }: { f: FollowUp; member?: boolean }) {
  const lines: React.ReactNode[] = [];
  if (f.appointment) lines.push(<span key="a">{label(f.appointment.kind)} · {fmtDateTime(f.appointment.startAt)} · {label(f.appointment.status)}</span>);
  if (f.booking) lines.push(<span key="b">{f.booking.testName ?? 'Booking'} · {f.booking.reference} · {fmtDateTime(f.booking.slotAt)} · <span className={`bp-labstatus bp-labstatus-${f.booking.status}`}>{label(f.booking.status)}</span>{f.booking.reportId ? <> · <Link to={`/reports/${f.booking.reportId}`}>{member ? 'Open its report' : 'Its report'}</Link></> : null}</span>);
  if (f.plan) lines.push(<span key="p">Plan: {f.plan.title} · {label(f.plan.status)}</span>);
  if (!lines.length) return null;
  return <>{lines.map((l, i) => <span key={i} className="muted small">{l}</span>)}</>;
}

/** One next step: the kind, the words, the due date, the link and who set it. */
export function FollowUpLine({ f, member, showMember, showReport, actions }: { f: FollowUp; member?: boolean; showMember?: boolean; showReport?: boolean; actions?: React.ReactNode }) {
  return <li>
    <div>
      <span className={f.status === 'open' ? '' : 'done'}><b>{f.kindLabel}</b> · {f.note}</span>
      {showMember && f.memberName ? <span className="muted small"><Link to={`/clients/${f.memberId}?tab=lab-follow-ups`}>{f.memberName}</Link></span> : null}
      {showReport && f.report ? <span className="muted small"><Link to={`/reports/${f.report.id}`}>{f.report.testName ?? 'Report'} · {f.report.reference}</Link></span> : null}
      <LinkLines f={f} member={member} />
      <span className="muted small">{f.dueDate ? `Due ${day(f.dueDate)}` : 'No due date'} · {f.setBy.role === 'coach' ? (member ? `Your coach${f.setBy.name ? `, ${f.setBy.name}` : ''}` : `Coach${f.setBy.name ? ` ${f.setBy.name}` : ''}`) : 'The Bioptime team'} · {fmtDate(f.createdAt)}{f.status === 'done' && f.completedAt ? ` · done ${fmtDate(f.completedAt)}` : ''}{!member && f.status === 'cancelled' && f.cancelledReason ? ` · cancelled: ${f.cancelledReason}` : ''}</span>
      <span className="row" style={{ gap: 6, marginTop: 4 }}><StatusPill f={f} />{actions}</span>
    </div>
  </li>;
}

/** Complete, cancel or reopen. A coach completes without a reason; cancelling and reopening always ask for one; the
 *  team gives a reason for every change (PATCH /admin/lab-follow-ups/:id). */
export function FollowUpActions({ f, team, onChanged }: { f: FollowUp; team: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<Status | null>(null);
  const path = team ? `/admin/lab-follow-ups/${f.id}` : `/coach/lab-follow-ups/${f.id}`;
  const send = async (status: Status, reason?: string) => { await api.patch(path, { status, ...(reason ? { reason } : {}) }); toast(status === 'done' ? 'Marked done' : status === 'open' ? 'Reopened' : 'Cancelled'); onChanged(); };
  const done = async () => { if (team) { setAsk('done'); return; } setBusy(true); try { await send('done'); } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); } };
  const titles: Record<Status, string> = { done: 'Mark this next step done', cancelled: 'Cancel this next step', open: 'Reopen this next step' };
  return <>
    {f.status === 'open' && <><Button size="sm" variant="secondary" busy={busy} onClick={done}>Mark done</Button><Button size="sm" variant="tertiary" onClick={() => setAsk('cancelled')}>Cancel</Button></>}
    {f.status !== 'open' && <Button size="sm" variant="tertiary" onClick={() => setAsk('open')}>Reopen</Button>}
    <ReasonDialog open={!!ask} onClose={() => setAsk(null)} title={ask ? titles[ask] : ''} danger={ask === 'cancelled'} confirmLabel={ask === 'cancelled' ? 'Cancel it' : ask === 'open' ? 'Reopen' : 'Mark done'}
      body={ask === 'cancelled' ? 'The member no longer sees a cancelled next step. The reason is kept with it.' : ask === 'open' ? 'It returns to the open list, for you and the member.' : 'The member sees it as done.'}
      onConfirm={(reason) => send(ask!, reason)} />
  </>;
}

/** The form that adds a next step to a released report. The team gives a reason as well. */
export function FollowUpForm({ reportId, options, team, onAdded }: { reportId: string; options: LinkOptions | null; team: boolean; onAdded: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<Kind>('consultation');
  const [note, setNote] = useState('');
  const [due, setDue] = useState('');
  const [link, setLink] = useState('');
  const [reason, setReason] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const today = todayLocal();
  const linkField = kind === 'consultation' ? 'appointmentId' : kind === 'retest' ? 'bookingId' : kind === 'plan_change' ? 'planId' : null;
  const linkChoices = !options ? [] : kind === 'consultation' ? options.appointments.map((a) => ({ id: a.id, text: `${label(a.kind)} · ${fmtDateTime(a.startAt)} · ${label(a.status)}` }))
    : kind === 'retest' ? options.bookings.map((b) => ({ id: b.id, text: `${b.testName ?? 'Booking'} · ${b.reference} · ${fmtDateTime(b.slotAt)} · ${label(b.status)}` }))
      : kind === 'plan_change' ? options.plans.map((p) => ({ id: p.id, text: `${p.title} · ${label(p.status)}` })) : [];
  const submit = async () => {
    const e: Record<string, string> = {};
    if (note.trim().length < 3) e.note = 'Write the next step in a few words.';
    if (due && due < today) e.dueDate = 'Pick today or a later date.';
    if (team && reason.trim().length < 3) e.reason = 'Say why, in a few words.';
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await api.post(team ? `/admin/reports/${reportId}/follow-ups` : `/coach/reports/${reportId}/follow-ups`, { kind, note: note.trim(), ...(due ? { dueDate: due } : {}), ...(linkField && link ? { [linkField]: link } : {}), ...(team ? { reason: reason.trim() } : {}) });
      toast('Next step added; the member is notified without the detail');
      setNote(''); setDue(''); setLink(''); setReason('');
      onAdded();
    } catch (err) {
      const details = (err as { details?: Array<{ path: string; message: string }> }).details;
      if (Array.isArray(details) && details.length) setErrs(Object.fromEntries(details.map((d) => [d.path || 'form', d.message])));
      else setErrs({ form: errorText(err) });
    } finally { setBusy(false); }
  };
  const hint = KINDS.find((k) => k.id === kind)!.hint;
  return <div className="form">
    <Field label="Kind" hint={hint} error={errs.kind}><Select value={kind} onChange={(e) => { setKind(e.target.value as Kind); setLink(''); }}>{KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</Select></Field>
    <Field label="Next step" hint="In the member’s words: what happens next and who does it. No new interpretation of the results." error={errs.note}><Textarea value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} /></Field>
    <Field label="Due date" optional hint="Only a date you have agreed; leave it empty otherwise." error={errs.dueDate}><Input type="date" value={due} min={today} onChange={(e) => setDue(e.target.value)} /></Field>
    {linkField && <Field label={kind === 'consultation' ? 'Appointment' : kind === 'retest' ? 'Booking' : 'Plan'} optional error={errs[linkField]} hint={linkChoices.length ? undefined : kind === 'consultation' ? 'No appointment to link yet; you can link one later.' : kind === 'retest' ? 'No other booking to link yet; link the retest once the member books it.' : 'No current plan to link.'}>
      <Select value={link} disabled={!linkChoices.length} onChange={(e) => setLink(e.target.value)}><option value="">Not linked</option>{linkChoices.map((c) => <option key={c.id} value={c.id}>{c.text}</option>)}</Select>
    </Field>}
    {team && <Field label="Reason (recorded in the audit log)" error={errs.reason}><Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></Field>}
    {errs.form && <Alert kind="error">{errs.form}</Alert>}
    <Button variant="primary" busy={busy} onClick={submit}>Add next step</Button>
  </div>;
}

/** Link a retest booking, an appointment or a plan to an open next step (or change it). */
export function LinkEditor({ f, options, team, onChanged }: { f: FollowUp; options: LinkOptions | null; team: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const field = f.kind === 'consultation' ? 'appointmentId' : f.kind === 'retest' ? 'bookingId' : f.kind === 'plan_change' ? 'planId' : null;
  if (!field || !options || f.status !== 'open') return null;
  const current = f.kind === 'consultation' ? f.appointment?.id : f.kind === 'retest' ? f.booking?.id : f.plan?.id;
  // a retest is a later booking than the one the report came from (the server checks the same)
  const later = options.bookings.filter((b) => !f.report || (b.id !== f.report.bookingId && b.slotAt > f.report.collectedAt));
  const choices = f.kind === 'consultation' ? options.appointments.map((a) => ({ id: a.id, text: `${label(a.kind)} · ${fmtDateTime(a.startAt)}` })) : f.kind === 'retest' ? later.map((b) => ({ id: b.id, text: `${b.testName ?? 'Booking'} · ${b.reference} · ${fmtDateTime(b.slotAt)}` })) : options.plans.map((p) => ({ id: p.id, text: p.title }));
  if (!choices.length && !current) return null;
  const save = async (value: string, reason?: string) => { try { await api.patch(team ? `/admin/lab-follow-ups/${f.id}` : `/coach/lab-follow-ups/${f.id}`, { [field]: value || null, ...(reason ? { reason } : {}) }); toast('Link saved'); onChanged(); } catch (e) { toast(errorText(e), 'error'); } };
  if (team) return <><Button size="sm" variant="tertiary" onClick={() => setOpen(true)}>Link</Button><LinkReasonDialog open={open} onClose={() => setOpen(false)} choices={choices} current={current ?? ''} onConfirm={save} /></>;
  return <Select aria-label="Link" value={current ?? ''} onChange={(e) => { void save(e.target.value); }}><option value="">{f.kind === 'retest' ? 'Link the retest booking' : f.kind === 'consultation' ? 'Link the appointment' : 'Link the plan'}</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.text}</option>)}</Select>;
}

function LinkReasonDialog({ open, onClose, choices, current, onConfirm }: { open: boolean; onClose: () => void; choices: Array<{ id: string; text: string }>; current: string; onConfirm: (value: string, reason: string) => Promise<void> }) {
  const [value, setValue] = useState(current);
  return <ReasonDialog open={open} onClose={onClose} title="Link this next step" confirmLabel="Save the link" onConfirm={(reason) => onConfirm(value, reason)}
    extra={<Field label="Linked record"><Select value={value} onChange={(e) => setValue(e.target.value)}><option value="">Not linked</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.text}</option>)}</Select></Field>} />;
}
