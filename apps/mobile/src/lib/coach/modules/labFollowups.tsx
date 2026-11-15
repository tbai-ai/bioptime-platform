/* The "Lab next steps" tab on the coach's client record (the web's modules/labFollowups/ClientRecordTab.tsx): the
   client's next steps from their reports, with complete, cancel, reopen and link; nothing is requested while the
   client does not share health information (the server answers NOT_SHARED). New next steps are added on the report.
   A retest linked to a booking that has its report carries the web's "Its report" link (LinkLines). Cancelling and
   reopening ask for a reason in the portal's ReasonDialog wording (adminA ReasonSheet). */
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText, get, patch } from '@/lib/api';
import { fmtDate, fmtDateTime, label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import type { RecordTabContext } from '@/lib/coach/moduleTabs';
import { Button, Card, Empty, Eyebrow, H2, Notice, P, Pill, Row } from '@/components/ui';
import { ReasonSheet } from '@/components/adminA/ReasonSheet';
import { PickerField, TabState, day, useFlash, useRecordTick } from '@/components/coachModules/shared';
import { colors, font, space } from '@/theme';

type Kind = 'consultation' | 'retest' | 'plan_change' | 'note';
type Status = 'open' | 'done' | 'cancelled';
export type FollowUp = {
  id: string; reportId: string; memberId: string; kind: Kind; kindLabel: string; note: string; dueDate: string | null; status: Status; overdue: boolean;
  report: { id: string; bookingId: string; reference: string; testName: string | null; collectedAt: string; releasedAt: string | null } | null;
  appointment: { id: string; kind: string; startAt: string; status: string } | null;
  booking: { id: string; reference: string; testName: string | null; slotAt: string; status: string; reportId: string | null } | null;
  plan: { id: string; title: string; status: string } | null;
  setBy: { role: 'coach' | 'team'; name: string | null };
  createdAt: string; completedAt: string | null; cancelledReason?: string | null;
};
type LinkOptions = { appointments: Array<{ id: string; kind: string; startAt: string; status: string }>; bookings: Array<{ id: string; reference: string; testName: string | null; slotAt: string; status: string }>; plans: Array<{ id: string; title: string; status: string }> };
type Payload = { items: FollowUp[]; options?: LinkOptions };
type ReportRow = { id: string; reference: string; released: boolean; test?: { name: string } | null; releasedAt?: string | null };

export function LabFollowupsTab({ ctx }: { ctx: RecordTabContext }) {
  if (!ctx.sharing) return <Notice kind="info" title="Not shared">Next steps come from the client’s reports, which stay private until they share health information with you.</Notice>;
  return <Tab ctx={ctx} />;
}

function Tab({ ctx }: { ctx: RecordTabContext }) {
  const { memberId, record } = ctx;
  const router = useRouter();
  const tick = useRecordTick(record); // the record screen's pull to refresh reloads this tab's data too
  const view = useLoad<Payload>(`coach-lab-follow-ups-${memberId}`, () => get(`/coach/clients/${memberId}/lab-follow-ups`), [memberId, tick]);
  const { show, node: flash } = useFlash();
  const reports = (((record as { reports?: ReportRow[] } | null)?.reports) ?? []).filter((r) => r.released);
  const d = view.data;
  const open = d?.items.filter((f) => f.status === 'open') ?? [];
  const closed = d?.items.filter((f) => f.status !== 'open') ?? [];
  const line = (f: FollowUp) => <FollowUpLine key={f.id} f={f} options={d?.options ?? null} show={show} onChanged={view.reload} />;
  return <TabState loading={view.loading && !d} error={view.error} onRetry={view.reload}>
    {d ? <View style={{ gap: space.md }}>
      {flash}
      <Card><Eyebrow>Lab next steps</Eyebrow><H2>{open.length ? `${open.length} open` : 'Nothing open'}</H2>
        {open.length ? open.map(line) : <Empty title="No open next steps" body={reports.length ? 'Add one from a released report.' : 'Next steps are added to a report once it is reviewed and released.'} />}
      </Card>
      {closed.length ? <Card><Eyebrow>History</Eyebrow><H2>Done and cancelled</H2>{closed.map(line)}</Card> : null}
      <Card><Eyebrow>Reports</Eyebrow><H2>Add a next step</H2>
        {reports.length ? reports.map((r) => <View key={r.id} style={st.item}>
          <Button title={r.test?.name ?? 'Report'} variant="ghost" small onPress={() => router.push(`/coach/reports/${r.id}`)} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} />
          <Text style={st.meta}>{`${r.reference}${r.releasedAt ? ` · released ${fmtDate(r.releasedAt)}` : ''}`}</Text>
        </View>) : <P small>No released report yet.</P>}
        <P muted small>Open a report to add a next step to it. The client sees open and done next steps with the report.</P>
      </Card>
    </View> : null}
  </TabState>;
}

/** One next step: the kind, the words, the due date, the link and who set it; the coach's actions on steps a coach set. */
function FollowUpLine({ f, options, show, onChanged }: { f: FollowUp; options: LinkOptions | null; show: (t: string, k?: 'success' | 'error') => void; onChanged: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<Status | null>(null);
  const mine = f.setBy.role === 'coach';
  // what the next step points at, one line each (the web's LinkLines); a linked retest booking with its report links to it
  const reportOfBooking = f.booking?.reportId ?? null;
  const lines: Array<{ key: string; text: string; reportId?: string | null }> = [];
  if (f.appointment) lines.push({ key: 'a', text: `${label(f.appointment.kind)} · ${fmtDateTime(f.appointment.startAt)} · ${label(f.appointment.status)}` });
  if (f.booking) lines.push({ key: 'b', text: `${f.booking.testName ?? 'Booking'} · ${f.booking.reference} · ${fmtDateTime(f.booking.slotAt)} · ${label(f.booking.status)}`, reportId: reportOfBooking });
  if (f.plan) lines.push({ key: 'p', text: `Plan: ${f.plan.title} · ${label(f.plan.status)}` });
  // Mark done needs no reason from a coach (an error is a toast, as on the web); cancel and reopen go through the
  // reason sheet, which keeps a refusal inside it and closes only on success
  const change = async (status: Status, reason?: string) => { await patch(`/coach/lab-follow-ups/${f.id}`, { status, ...(reason ? { reason } : {}) }); show(status === 'done' ? 'Marked done' : status === 'open' ? 'Reopened' : 'Cancelled'); onChanged(); };
  const done = async () => { setBusy(true); try { await change('done'); } catch (e) { show(errorText(e), 'error'); } finally { setBusy(false); } };
  const linkField = f.kind === 'consultation' ? 'appointmentId' : f.kind === 'retest' ? 'bookingId' : f.kind === 'plan_change' ? 'planId' : null;
  const current = f.kind === 'consultation' ? f.appointment?.id : f.kind === 'retest' ? f.booking?.id : f.plan?.id;
  // a retest is a later booking than the one the report came from (the server checks the same)
  const later = options?.bookings.filter((b) => !f.report || (b.id !== f.report.bookingId && b.slotAt > f.report.collectedAt)) ?? [];
  const choices = !options ? [] : f.kind === 'consultation' ? options.appointments.map((a) => ({ value: a.id, label: `${label(a.kind)} · ${fmtDateTime(a.startAt)}` })) : f.kind === 'retest' ? later.map((b) => ({ value: b.id, label: `${b.testName ?? 'Booking'} · ${b.reference} · ${fmtDateTime(b.slotAt)}` })) : f.kind === 'plan_change' ? options.plans.map((p) => ({ value: p.id, label: p.title })) : [];
  const saveLink = async (value: string) => { try { await patch(`/coach/lab-follow-ups/${f.id}`, { [linkField!]: value || null }); show('Link saved'); onChanged(); } catch (e) { show(errorText(e), 'error'); } };
  return <View style={st.item}>
    <Text style={{ color: f.status === 'open' ? colors.text : colors.muted, fontSize: font.body }}><Text style={{ fontWeight: '700' }}>{f.kindLabel}</Text>{` · ${f.note}`}</Text>
    {f.report ? <Button title={`${f.report.testName ?? 'Report'} · ${f.report.reference}`} variant="ghost" small onPress={() => router.push(`/coach/reports/${f.report!.id}`)} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} /> : null}
    {lines.map((l) => <Text key={l.key} style={st.meta}>{l.text}{l.reportId ? <>{' · '}<Text style={st.link} accessibilityRole="link" onPress={() => router.push(`/coach/reports/${l.reportId}`)}>Its report</Text></> : null}</Text>)}
    <Text style={st.meta}>{`${f.dueDate ? `Due ${day(f.dueDate)}` : 'No due date'} · ${mine ? `Coach${f.setBy.name ? ` ${f.setBy.name}` : ''}` : 'The Bioptime team'} · ${fmtDate(f.createdAt)}${f.status === 'done' && f.completedAt ? ` · done ${fmtDate(f.completedAt)}` : ''}${f.status === 'cancelled' && f.cancelledReason ? ` · cancelled: ${f.cancelledReason}` : ''}`}</Text>
    <Row>
      {/* the web's StatusPill: open reads as 'scheduled' (info), done as 'completed' (success), cancelled as neutral (the app's nearest, info) */}
      {f.status === 'open' && f.overdue ? <Pill tone="warning">Past due</Pill> : <Pill tone={f.status === 'done' ? 'success' : 'info'}>{f.status === 'open' ? 'Open' : f.status === 'done' ? 'Done' : 'Cancelled'}</Pill>}
      {mine && f.status === 'open' ? <><Button title="Mark done" variant="secondary" small busy={busy} onPress={() => void done()} /><Button title="Cancel" variant="ghost" small onPress={() => setAsk('cancelled')} /></> : null}
      {mine && f.status !== 'open' ? <Button title="Reopen" variant="ghost" small onPress={() => setAsk('open')} /> : null}
    </Row>
    {mine && linkField && f.status === 'open' && (choices.length || current) ? <PickerField label="Link" value={current ?? ''} placeholder={f.kind === 'retest' ? 'Link the retest booking' : f.kind === 'consultation' ? 'Link the appointment' : 'Link the plan'} options={choices} onChange={(v) => void saveLink(v)} /> : null}
    <ReasonSheet open={!!ask} onClose={() => setAsk(null)} title={ask === 'cancelled' ? 'Cancel this next step' : ask === 'open' ? 'Reopen this next step' : ''} destructive={ask === 'cancelled'} confirmLabel={ask === 'cancelled' ? 'Cancel it' : 'Reopen'}
      body={ask === 'cancelled' ? 'The member no longer sees a cancelled next step. The reason is kept with it.' : 'It returns to the open list, for you and the member.'}
      onConfirm={async (reason) => { if (ask) await change(ask, reason); }} />
  </View>;
}

const st = {
  item: { paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: space.xs },
  meta: { color: colors.muted, fontSize: font.small },
  link: { color: colors.accentText, fontWeight: '600' as const },
};
