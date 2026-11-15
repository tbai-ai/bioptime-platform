/* M7 Lab follow-ups in the admin workspace: what the Lab follow-ups page, the member record's "Lab next steps" tab and
   the report page's "Next steps" section share (the web's modules/labFollowups/shared.tsx in team mode): the next-step
   line, the team's actions (mark done, cancel, reopen: every change by the team carries a reason,
   PATCH /admin/lab-follow-ups/:id), the link editor (a reason sheet with the linked record) and the form that adds a
   team next step to a report the team released itself (POST /admin/reports/:id/follow-ups with a reason). The team
   changes the words or due date only of its own steps; on a coach's step it can mark it done, cancel or reopen it, or
   change its link (the server enforces COACH_FOLLOW_UP). Tokens from theme.ts only. */
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ApiError, errorText, patch, post } from '@/lib/api';
import { fmtDate, fmtDateTime, label } from '@/lib/format';
import { Button, Field, Input, Notice, Pill, Row } from '@/components/ui';
import { DatePickerField, isIsoDate } from '@/components/workspace';
import { ReasonSheet } from '@/components/adminA/ReasonSheet';
import { PickerField, day } from '@/components/coachModules/shared';
import { colors, font, space } from '@/theme';

export type Kind = 'consultation' | 'retest' | 'plan_change' | 'note';
export type Status = 'open' | 'done' | 'cancelled';
export type FollowUp = {
  id: string; reportId: string; memberId: string; memberName?: string; kind: Kind; kindLabel: string; note: string; dueDate: string | null; status: Status; overdue: boolean;
  report: { id: string; bookingId: string; reference: string; testName: string | null; collectedAt: string; releasedAt: string | null } | null;
  appointment: { id: string; kind: string; startAt: string; status: string } | null;
  booking: { id: string; reference: string; testName: string | null; slotAt: string; status: string; reportId: string | null } | null;
  plan: { id: string; title: string; status: string } | null;
  setBy: { role: 'coach' | 'team'; name: string | null };
  createdAt: string; updatedAt?: string; completedAt: string | null; cancelledReason?: string | null;
};
export type LinkOptions = { appointments: Array<{ id: string; kind: string; startAt: string; status: string }>; bookings: Array<{ id: string; reference: string; testName: string | null; slotAt: string; status: string }>; plans: Array<{ id: string; title: string; status: string }> };
export type Summary = { open: number; done: number; cancelled: number; overdue: number };

export const KINDS: Array<{ id: Kind; label: string; hint: string }> = [
  { id: 'consultation', label: 'Consultation', hint: 'Talk the report through; link the appointment once it is booked.' },
  { id: 'retest', label: 'Retest', hint: 'Agreed with the member (and their doctor where it matters); link the booking once it is made.' },
  { id: 'plan_change', label: 'Plan change', hint: 'A change to the coaching plan; link the plan it changes.' },
  { id: 'note', label: 'Note', hint: 'Anything else the member should do or know.' },
];
/** Today in India as YYYY-MM-DD (due dates may not be earlier). */
export const todayIst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

export function StatusPill({ f }: { f: FollowUp }) {
  if (f.status === 'open' && f.overdue) return <Pill tone="warning">Past due</Pill>;
  return <Pill tone={f.status === 'done' ? 'success' : 'info'}>{f.status === 'open' ? 'Open' : f.status === 'done' ? 'Done' : 'Cancelled'}</Pill>;
}

function LinkText({ children, onPress }: { children: string; onPress: () => void }) {
  return <Pressable accessibilityRole="link" onPress={onPress} hitSlop={4}><Text style={st.link}>{children}</Text></Pressable>;
}

/** What the next step points at, one line each (the web's LinkLines). */
export function LinkLines({ f }: { f: FollowUp }) {
  const router = useRouter();
  return <>
    {f.appointment ? <Text style={st.meta}>{`${label(f.appointment.kind)} · ${fmtDateTime(f.appointment.startAt)} · ${label(f.appointment.status)}`}</Text> : null}
    {f.booking ? <View style={st.inline}>
      <Text style={st.meta}>{`${f.booking.testName ?? 'Booking'} · ${f.booking.reference} · ${fmtDateTime(f.booking.slotAt)} · ${label(f.booking.status)}`}</Text>
      {f.booking.reportId ? <LinkText onPress={() => { const rid = f.booking?.reportId; if (rid) router.push(`/admin/reports/${rid}` as never); }}>Its report</LinkText> : null}
    </View> : null}
    {f.plan ? <Text style={st.meta}>{`Plan: ${f.plan.title} · ${label(f.plan.status)}`}</Text> : null}
  </>;
}

/** One next step: the kind, the words, the member and report links, what it links to, the due date and who set it.
 *  `listPage` is the Lab follow-ups page's wording (its Due and Set by columns: "Due: None" when undated, "Team · {name}",
 *  and "Cancelled: {reason}" on a line of its own); the record tab and the report section keep the shared line's wording
 *  ("No due date", "The Bioptime team", "· cancelled: {reason}"). */
export function FollowUpLine({ f, showMember, showReport, listPage, children }: { f: FollowUp; showMember?: boolean; showReport?: boolean; listPage?: boolean; children?: React.ReactNode }) {
  const team = listPage ? `Team · ${f.setBy.name ?? ''}` : 'The Bioptime team';
  const due = listPage ? `Due: ${f.dueDate ? day(f.dueDate) : 'None'}` : f.dueDate ? `Due ${day(f.dueDate)}` : 'No due date';
  const cancelled = f.status === 'cancelled' && f.cancelledReason ? f.cancelledReason : null;
  const router = useRouter();
  return <View style={st.item}>
    <Text style={[st.body, f.status !== 'open' && { color: colors.muted }]}><Text style={{ fontWeight: '700' }}>{f.kindLabel}</Text>{` · ${f.note}`}</Text>
    {showMember && f.memberName ? <LinkText onPress={() => router.push(`/admin/clients/${f.memberId}?tab=lab-follow-ups` as never)}>{f.memberName}</LinkText> : null}
    {showReport && f.report ? <LinkText onPress={() => { const rid = f.report?.id; if (rid) router.push(`/admin/reports/${rid}` as never); }}>{`${f.report.testName ?? 'Report'} · ${f.report.reference}`}</LinkText> : null}
    <LinkLines f={f} />
    {listPage && cancelled ? <Text style={st.meta}>{`Cancelled: ${cancelled}`}</Text> : null}
    <Text style={st.meta}>{`${due} · ${f.setBy.role === 'coach' ? `Coach${f.setBy.name ? ` ${f.setBy.name}` : ''}` : team} · ${fmtDate(f.createdAt)}${f.status === 'done' && f.completedAt ? ` · done ${fmtDate(f.completedAt)}` : ''}${!listPage && cancelled ? ` · cancelled: ${cancelled}` : ''}`}</Text>
    <Row><StatusPill f={f} />{children}</Row>
  </View>;
}

const TITLES: Record<Status, string> = { done: 'Mark this next step done', cancelled: 'Cancel this next step', open: 'Reopen this next step' };
const BODIES: Record<Status, string> = { done: 'The member sees it as done.', cancelled: 'The member no longer sees a cancelled next step. The reason is kept with it.', open: 'It returns to the open list, for you and the member.' };
const CONFIRMS: Record<Status, string> = { done: 'Mark done', cancelled: 'Cancel it', open: 'Reopen' };
const TOASTS: Record<Status, string> = { done: 'Marked done', cancelled: 'Cancelled', open: 'Reopened' };

/** The team's status changes (integrations.manage): mark done, cancel or reopen, each with a reason. */
export function TeamActions({ f, onChanged, show }: { f: FollowUp; onChanged: () => void; show: (t: string, k?: 'success' | 'error') => void }) {
  const [ask, setAsk] = useState<Status | null>(null);
  return <>
    {f.status === 'open' ? <><Button title="Mark done" variant="secondary" small onPress={() => setAsk('done')} /><Button title="Cancel" variant="ghost" small onPress={() => setAsk('cancelled')} /></> : <Button title="Reopen" variant="ghost" small onPress={() => setAsk('open')} />}
    <ReasonSheet open={!!ask} onClose={() => setAsk(null)} title={ask ? TITLES[ask] : ''} body={ask ? BODIES[ask] : undefined} confirmLabel={ask ? CONFIRMS[ask] : 'Confirm'} destructive={ask === 'cancelled'}
      onConfirm={async (reason) => { const status = ask; if (!status) return; await patch(`/admin/lab-follow-ups/${f.id}`, { status, reason }); show(TOASTS[status]); onChanged(); }} />
  </>;
}

/** Link a retest booking, an appointment or a plan to an open next step (or change it), with a reason. Shows nothing
 *  when the step's kind takes no link, the step is closed, or there is nothing to link and nothing linked. */
export function TeamLinkEditor({ f, options, onChanged, show }: { f: FollowUp; options: LinkOptions | null; onChanged: () => void; show: (t: string, k?: 'success' | 'error') => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const field = f.kind === 'consultation' ? 'appointmentId' : f.kind === 'retest' ? 'bookingId' : f.kind === 'plan_change' ? 'planId' : null;
  if (!field || !options || f.status !== 'open') return null;
  const current = (f.kind === 'consultation' ? f.appointment?.id : f.kind === 'retest' ? f.booking?.id : f.plan?.id) ?? '';
  // a retest is a later booking than the one the report came from (the server checks the same)
  const later = options.bookings.filter((b) => !f.report || (b.id !== f.report.bookingId && b.slotAt > f.report.collectedAt));
  const choices = f.kind === 'consultation' ? options.appointments.map((a) => ({ value: a.id, label: `${label(a.kind)} · ${fmtDateTime(a.startAt)}` }))
    : f.kind === 'retest' ? later.map((b) => ({ value: b.id, label: `${b.testName ?? 'Booking'} · ${b.reference} · ${fmtDateTime(b.slotAt)}` }))
      : options.plans.map((p) => ({ value: p.id, label: p.title }));
  if (!choices.length && !current) return null;
  return <>
    <Button title="Link" variant="ghost" small onPress={() => { setValue(current); setOpen(true); }} />
    <ReasonSheet open={open} onClose={() => setOpen(false)} title="Link this next step" confirmLabel="Save the link"
      extra={<PickerField label="Linked record" value={value} placeholder="Not linked" options={choices} onChange={setValue} />}
      onConfirm={async (reason) => { try { await patch(`/admin/lab-follow-ups/${f.id}`, { [field]: value || null, reason }); show('Link saved'); onChanged(); } catch (e) { show(errorText(e), 'error'); throw e; } }} />
  </>;
}

/** The form that adds a team next step to a report the team released (POST /admin/reports/:id/follow-ups). */
export function TeamFollowUpForm({ reportId, options, onAdded, show }: { reportId: string; options: LinkOptions | null; onAdded: () => void; show: (t: string, k?: 'success' | 'error') => void }) {
  const [kind, setKind] = useState<Kind>('consultation');
  const [note, setNote] = useState('');
  const [due, setDue] = useState('');
  const [link, setLink] = useState('');
  const [reason, setReason] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const today = todayIst();
  const linkField = kind === 'consultation' ? 'appointmentId' : kind === 'retest' ? 'bookingId' : kind === 'plan_change' ? 'planId' : null;
  const linkChoices = !options ? [] : kind === 'consultation' ? options.appointments.map((a) => ({ value: a.id, label: `${label(a.kind)} · ${fmtDateTime(a.startAt)} · ${label(a.status)}` }))
    : kind === 'retest' ? options.bookings.map((b) => ({ value: b.id, label: `${b.testName ?? 'Booking'} · ${b.reference} · ${fmtDateTime(b.slotAt)} · ${label(b.status)}` }))
      : kind === 'plan_change' ? options.plans.map((p) => ({ value: p.id, label: `${p.title} · ${label(p.status)}` })) : [];
  const submit = async () => {
    const e: Record<string, string> = {};
    if (note.trim().length < 3) e.note = 'Write the next step in a few words.';
    if (due && !isIsoDate(due)) e.dueDate = 'Write the date as YYYY-MM-DD, like 2026-11-05.';
    else if (due && due < today) e.dueDate = 'Pick today or a later date.';
    if (reason.trim().length < 3) e.reason = 'Say why, in a few words.';
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await post(`/admin/reports/${reportId}/follow-ups`, { kind, note: note.trim(), ...(due ? { dueDate: due } : {}), ...(linkField && link ? { [linkField]: link } : {}), reason: reason.trim() });
      show('Next step added; the member is notified without the detail');
      setNote(''); setDue(''); setLink(''); setReason('');
      onAdded();
    } catch (err) {
      const fe = err instanceof ApiError ? err.fieldErrors() : {};
      setErrs(Object.keys(fe).length ? fe : { form: errorText(err) });
    } finally { setBusy(false); }
  };
  const hint = KINDS.find((k) => k.id === kind)?.hint;
  return <View>
    <PickerField label="Kind" hint={hint} error={errs.kind} value={kind} options={KINDS.map((k) => ({ value: k.id, label: k.label }))} onChange={(v) => { setKind(v as Kind); setLink(''); }} />
    <Field label="Next step" hint="In the member’s words: what happens next and who does it. No new interpretation of the results." error={errs.note}>
      <Input value={note} onChangeText={setNote} maxLength={2000} multiline numberOfLines={3} style={{ minHeight: 80, textAlignVertical: 'top' }} accessibilityLabel="Next step" />
    </Field>
    <DatePickerField label="Due date (optional)" value={due} onChange={setDue} min={today} hint="Only a date you have agreed; leave it empty otherwise." error={errs.dueDate} />
    {linkField ? <PickerField label={`${kind === 'consultation' ? 'Appointment' : kind === 'retest' ? 'Booking' : 'Plan'} (optional)`} value={link} placeholder="Not linked" options={linkChoices} onChange={setLink} disabled={!linkChoices.length} error={errs[linkField]}
      hint={linkChoices.length ? undefined : kind === 'consultation' ? 'No appointment to link yet; you can link one later.' : kind === 'retest' ? 'No other booking to link yet; link the retest once the member books it.' : 'No current plan to link.'} /> : null}
    <Field label="Reason (recorded in the audit log)" error={errs.reason}><Input value={reason} onChangeText={setReason} maxLength={300} accessibilityLabel="Reason (recorded in the audit log)" /></Field>
    {errs.form ? <Notice kind="error">{errs.form}</Notice> : null}
    <Button title="Add next step" busy={busy} onPress={() => void submit()} style={{ alignSelf: 'flex-start' }} />
  </View>;
}

const st = {
  item: { paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: space.xs },
  body: { color: colors.text, fontSize: font.body, lineHeight: 21 },
  meta: { color: colors.muted, fontSize: font.small },
  link: { color: colors.accentText, fontSize: font.small, fontWeight: '600' as const },
  inline: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, alignItems: 'center' as const, gap: space.sm },
};
