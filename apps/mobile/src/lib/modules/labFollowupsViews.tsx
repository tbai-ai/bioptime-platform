/* M7 Lab follow-ups in the client app's kit (src/fx): the pieces Life (src/screens/life) and the report overlay
   (src/app/report/[id].tsx, S8) share. Next steps and preparation show only while the 'labFollowups' flag is on for the
   member (the server refuses those routes otherwise); the marker trend reads GET /me/reports/markers/:key, which is
   part of reports (always on). Values and ranges exactly as the laboratory reported them, with no interpretation added.
   - FollowUpRow / NextStepsList / NextStepsCard: each next step on the red rule: its kind, the words, what it points
     at (a consultation, a booking, a plan), who set it and when, its state (open, past due, done) and its report.
     The consultation a step points at comes with its start only; once that start has passed while it is open, the
     list reads the upcoming appointments (GET /me/appointments?range=upcoming, the 'appointments' load Home and
     Coach read, which carries the end) and the row says "Awaiting update" only after its end (lib/today
     shownStatusWith): Life, the report and Coach never disagree about one under way. A retest's home collection whose
     slot has passed while it is still open reads "Awaiting update" too (lib/today shownStatus), as Tests and Home say.
   - MarkerTrendView / MarkerTrendCard: one marker across the member's released reports in the earlier app's
     "Projection Engine" chrome: the red line of the values, the gold dashed laboratory range, the legend, and the
     table of every value with its date, range and flag. No projection: only reported values.
   - PreparationCard: the next home collections with the laboratory's own preparation text and Bioptime's reminder.
     With none still to come it says only what the member's bookings say (GET /me/bloodwork/bookings, the Tests tab's
     list): a collection due now (its slot has come, within its visit window) or awaiting the laboratory's update (lib/
     today), as the next-step row above it says; else that no collection is coming up. */
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { get } from '@/lib/api';
import { useFeatures } from '@/lib/features';
import { fmtDate, fmtDateTime, label } from '@/lib/format';
import { isAwaitingUpdate, isCollectionDue, shownStatus, shownStatusWith, startedWithoutEnd, type ListedAppointment } from '@/lib/today';
import { useLoad } from '@/lib/useLoad';
import { Button, ErrorState, FilterChip, fx, GlassCard, Icon, NoSwipeZone, Pill, Reveal, RowDivider, Skeleton, T, TrendChart } from '@/fx';
import { FitText, HugText } from '@/fx/wordFit';

export const FLAG = 'labFollowups';

export type FollowUp = {
  id: string; reportId: string; kind: 'consultation' | 'retest' | 'plan_change' | 'note'; kindLabel: string; note: string; dueDate: string | null; status: 'open' | 'done' | 'cancelled'; overdue: boolean;
  report: { id: string; reference: string; testName: string | null; collectedAt: string } | null;
  appointment: { id: string; kind: string; startAt: string; endAt?: string | null; status: string } | null;
  booking: { id: string; reference: string; testName: string | null; slotAt: string; status: string; reportId: string | null } | null;
  plan: { id: string; title: string; status: string } | null;
  setBy: { role: 'coach' | 'team'; name: string | null };
  createdAt: string; completedAt: string | null;
};
export type Preparation = { bookingId: string; reference: string; testName: string | null; slotAt: string; fastingHours: number; preparation: string | null; rebookPending: boolean; reminder: { dueAt: string; status: string } | null };

/** Is the module on for this member? false while the flags load. */
export function useLabFlag(): boolean {
  const features = useFeatures(true);
  return !!features?.has(FLAG);
}

/** The next steps, on every released report or on one. */
export function useFollowUps(reportId?: string, on = true) {
  return useLoad<{ items: FollowUp[] } | null>(on ? `lab-follow-ups-${reportId ?? 'all'}` : null,
    () => (on ? get(`/me/lab-follow-ups${reportId ? `?reportId=${encodeURIComponent(reportId)}` : ''}`) : Promise.resolve(null)), [reportId, on]);
}

const day = (d: string) => fmtDate(`${d}T12:00:00Z`);
const KIND_ICON: Record<FollowUp['kind'], 'calendar-check' | 'test-tube' | 'clipboard-list' | 'message-square'> = { consultation: 'calendar-check', retest: 'test-tube', plan_change: 'clipboard-list', note: 'message-square' };

/** The upcoming appointments (with their ends), read only while `on`: a step's consultation has started and is open. */
function useUpcomingAppointments(on: boolean): ListedAppointment[] | null {
  const list = useLoad<{ items: ListedAppointment[] } | null>(on ? 'appointments' : null, () => (on ? get('/me/appointments?range=upcoming') : Promise.resolve(null)), [on]);
  return on ? list.data?.items ?? null : null;
}

/** One next step on the red rule (amber when past due, green when done). `upcoming`: the upcoming appointments, which
 *  say whether the consultation it points at is under way or awaiting its update (null while not known). */
export function FollowUpRow({ f, showReport, upcoming = null }: { f: FollowUp; showReport?: boolean; upcoming?: readonly ListedAppointment[] | null }) {
  const lines: string[] = [];
  if (f.appointment) lines.push(`${label(f.appointment.kind)} · ${fmtDateTime(f.appointment.startAt)} · ${label(shownStatusWith(f.appointment, upcoming))}`);
  if (f.booking) lines.push(`${f.booking.testName ?? 'Booking'} · ${f.booking.reference} · ${fmtDateTime(f.booking.slotAt)} · ${label(shownStatus(f.booking))}`);
  if (f.plan) lines.push(`Plan: ${f.plan.title}`);
  const who = f.setBy.role === 'coach' ? `Your coach${f.setBy.name ? `, ${f.setBy.name}` : ''}` : 'The Bioptime team';
  const done = f.status === 'done';
  const rail = done ? fx.status.optimal : f.overdue ? fx.status.caution : f.status === 'cancelled' ? fx.ink.a30 : fx.red.brand;
  return <GlassCard variant="three" rule={{ color: rail, width: 4 }} padding={18} style={styles.step}>
    <View style={styles.rowBetween}>
      <View style={styles.kind}>
        <Icon name={KIND_ICON[f.kind] ?? 'clipboard-list'} size={15} color={done ? fx.hue.green400 : fx.red.label} />
        {/* the kind keeps its word whole beside the status pill (shrinks rather than 'CONSULTATIO…' or a broken word) */}
        <FitText v="overline" color={done ? fx.hue.green400 : fx.red.label} numberOfLines={2} boxStyle={styles.flex}>{f.kindLabel}</FitText>
      </View>
      {done ? <Pill tone="success">Done</Pill> : f.overdue ? <Pill tone="warning">Past due</Pill> : f.status === 'cancelled' ? <Pill>Cancelled</Pill> : <Pill>Open</Pill>}
    </View>
    <T v="body" color={done ? fx.ink.a60 : fx.ink.white} style={styles.note}>{f.note}</T>
    {lines.map((l) => <View key={l} style={styles.line}><Icon name="arrow-right" size={12} color={fx.ink.a40} /><T v="caption" color={fx.ink.a70} style={styles.flex}>{l}</T></View>)}
    <T v="caption" color={fx.ink.a50}>{`${f.dueDate ? `Due ${day(f.dueDate)}` : 'No due date'} · ${who} · ${fmtDate(f.createdAt)}${done && f.completedAt ? ` · done ${fmtDate(f.completedAt)}` : ''}`}</T>
    {(showReport && f.report) || f.booking?.reportId ? <View style={styles.links}>
      {showReport && f.report ? <Button title={`${f.report.testName ?? 'Report'} · ${f.report.reference}`} variant="link" style={styles.link44} small onPress={() => router.push({ pathname: '/report/[id]', params: { id: f.report!.id } })} /> : null}
      {f.booking?.reportId ? <Button title="Open the retest’s report" variant="link" style={styles.link44} small onPress={() => router.push({ pathname: '/report/[id]', params: { id: f.booking!.reportId! } })} /> : null}
    </View> : null}
  </GlassCard>;
}

/** The next steps as separate rail cards (Life), or the empty sentence. */
export function NextStepsList({ items, showReport, reportId }: { items: FollowUp[]; showReport?: boolean; reportId?: string }) {
  const upcoming = useUpcomingAppointments(items.some((f) => !!f.appointment && startedWithoutEnd(f.appointment)));
  if (!items.length) return <T v="bodySm" color={fx.ink.a60}>{reportId ? 'No next steps on this report. If your coach or the Bioptime team sets one, it appears here and in your notifications.' : 'No next steps yet. They appear here once your coach or the Bioptime team sets one after reviewing a report.'}</T>;
  return <View style={styles.list}>{items.map((f, i) => <Reveal key={f.id} index={i} id={`next-step.${f.id}`}><FollowUpRow f={f} showReport={showReport} upcoming={upcoming} /></Reveal>)}</View>;
}

/** "Next steps" on one report (or on every released report when no id is given). */
export function NextStepsCard({ reportId }: { reportId?: string }) {
  const list = useFollowUps(reportId);
  return <View style={styles.card}>
    <T v="eyebrowBrand">Follow-up</T>
    <T v="heading" accessibilityRole="header">Next steps</T>
    <ErrorState error={list.error} onRetry={list.reload} />
    {list.loading && !list.data ? <Skeleton height={120} radius={fx.radius.three} /> : <NextStepsList items={list.data?.items ?? []} showReport={!reportId} reportId={reportId} />}
  </View>;
}

type ReportValue = { marker_key: string | null; label: string; value: string; units: string | null; flag: string | null };
type TrendPoint = { value: string; units: string | null; range_low: number | null; range_high: number | null; flag: string | null; at: string; report_id: string };

const LINE = fx.red.brand;
const RANGE = fx.gold.base;
const rangeOf = (p: TrendPoint) => (p.range_low != null && p.range_high != null ? `${p.range_low}–${p.range_high}` : p.range_low != null ? `≥ ${p.range_low}` : p.range_high != null ? `≤ ${p.range_high}` : '—');

/** One marker across the released reports: the chart (red values, gold dashed laboratory range of the latest report),
 *  its legend and, unless `compact`, the table of values. `onPoints` hands the loaded values to the caller. */
export function MarkerTrendView({ markerKey, name, compact, height = 140, onPoints }: { markerKey: string; name: string; compact?: boolean; height?: number; onPoints?: (p: TrendPoint[]) => void }) {
  const trend = useLoad<{ items: TrendPoint[] }>(`marker-${markerKey}`, () => get(`/me/reports/markers/${encodeURIComponent(markerKey)}`), [markerKey]);
  const points = trend.data?.items ?? [];
  useEffect(() => { if (trend.data) onPoints?.(trend.data.items); }, [trend.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const values = points.map((p) => Number(p.value)).filter((n) => Number.isFinite(n));
  const last = points[points.length - 1];
  const range = last && (last.range_low != null || last.range_high != null)
    ? { low: last.range_low ?? (last.range_high as number), high: last.range_high ?? (last.range_low as number) } : null;
  const unit = last?.units ?? '';
  if (trend.loading && !trend.data) return <Skeleton height={height} radius={fx.radius.lg} />;
  return <View style={styles.trend}>
    <ErrorState error={trend.error} onRetry={trend.reload} />
    {values.length >= 2 ? <TrendChart values={values} range={range} height={height} color={LINE} grid={4}
      accessibilityLabel={`${name}: ${values.length} values from ${points[0].value} to ${last.value} ${unit}${range ? `; laboratory range ${rangeOf(last)}` : ''}`} />
      : null}
    {values.length >= 2 ? <View style={styles.axis}><T v="mono10" color={fx.ink.a50}>{fmtDate(points[0].at)}</T><T v="mono10" color={fx.ink.a50}>{fmtDate(last.at)}</T></View>
      : values.length === 1 ? <View style={[styles.single, { height }]}>
        <T v="metric30">{last.value}</T><T v="mono12" color={fx.ink.a60}>{unit}</T>
      </View> : null}
    {points.length ? <View style={styles.legend}>
      <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: LINE }]} /><T v="section" numberOfLines={1}>{name}</T></View>
      {range ? <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: RANGE }]} /><T v="section">Laboratory range</T></View> : null}
    </View> : null}
    {!compact && points.length ? <View>
      {[...points].reverse().map((p, i) => <View key={p.report_id}>
        {i ? <RowDivider /> : null}
        <View style={styles.tableRow}>
          <View style={styles.flex}>
            <T v="section">{fmtDate(p.at)}</T>
            <T v="caption" color={fx.ink.a50}>{`Laboratory range ${rangeOf(p)}`}</T>
          </View>
          <View style={styles.right}>
            <T v="mono14" color={p.flag ? fx.map.marker[p.flag === 'low' ? 'low' : 'high'] : fx.ink.white}>{`${p.value} ${p.units ?? ''}`}</T>
            {/* a status word in a box that hugs it keeps its last word (TAB-01: 'ABOVE RANGE' drawn 'ABOVE' at 320 dpi) */}
            <HugText v="micro" color={p.flag ? fx.map.marker[p.flag === 'low' ? 'low' : 'high'] : fx.map.marker.in_range}>{p.flag ? (p.flag === 'low' ? 'Below range' : 'Above range') : 'In range'}</HugText>
          </View>
        </View>
      </View>)}
    </View> : null}
    <T v="caption" color={fx.ink.a50}>{points.length > 1 ? 'Each value and range as the laboratory reported it on that date; laboratories can change their ranges.' : 'One result so far. The trend fills in as later reports are released.'}</T>
  </View>;
}

/** One marker across the member's released reports, as the laboratory reported each value and range (with chips to
 *  choose the marker; flagged markers first). */
export function MarkerTrendCard({ values }: { values: ReportValue[] | undefined }) {
  const markers = (values ?? []).filter((v) => v.marker_key);
  const first = markers.find((m) => m.flag) ?? markers[0];
  const [key, setKey] = useState<string | null>(first?.marker_key ?? null);
  if (!markers.length || !key) return null;
  const chosen = markers.find((m) => m.marker_key === key) ?? markers[0];
  const ordered = [...markers.filter((m) => m.flag), ...markers.filter((m) => !m.flag)];
  return <GlassCard variant="three" padding={22} style={styles.card}>
    <T v="eyebrowBrand">Over time</T>
    <T v="heading" accessibilityRole="header">Marker trend</T>
    <NoSwipeZone>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipScroll}>
        {ordered.map((m) => <FilterChip key={m.marker_key!} label={m.label} selected={m.marker_key === key} onPress={() => setKey(m.marker_key)} />)}
      </ScrollView>
    </NoSwipeZone>
    <MarkerTrendView key={key} markerKey={key} name={chosen.label} />
  </GlassCard>;
}

/** A booking as GET /me/bloodwork/bookings lists it (the fields the preparation card reads). */
type SlotBooking = { id: string; status: string; slotAt: string };

/** What the preparation card says when no collection is still to come, from the member's bookings: the ones due now
 *  (their slot has come, within the visit window) and the ones awaiting the laboratory's update (open, past it), as
 *  their next-step rows and Tests say; else that none is coming up. */
function noneComing(list: readonly SlotBooking[] | null | undefined): string {
  const sorted = [...(list ?? [])].sort((a, b) => a.slotAt.localeCompare(b.slotAt));
  const sentence = (xs: SlotBooking[], what: string) => (xs.length
    ? `Your collection${xs.length === 1 ? '' : 's'} on ${xs.map((b) => fmtDateTime(b.slotAt)).join(' and ')} ${xs.length === 1 ? 'is' : 'are'} ${what}.` : null);
  const out = [sentence(sorted.filter((b) => isCollectionDue(b)), 'due now'), sentence(sorted.filter((b) => isAwaitingUpdate(b)), 'awaiting the laboratory’s update')].filter(Boolean);
  return out.length ? out.join(' ') : 'No collection coming up.';
}

/** The next home collections: the laboratory's own preparation text and when Bioptime's reminder goes out. */
export function PreparationCard() {
  const prep = useLoad<{ items: Preparation[]; timing: string }>('lab-preparation', () => get('/me/lab-preparation'), []);
  const items = prep.data?.items ?? [];
  // none still to come: the member's bookings say whether one is due now or awaiting its update (asked only then)
  const none = !!prep.data && !items.length;
  const bookings = useLoad<{ items: SlotBooking[] } | null>(none ? 'bookings' : null, () => (none ? get('/me/bloodwork/bookings') : Promise.resolve(null)), [none]);
  return <GlassCard variant="three" padding={20} style={styles.card}>
    <View style={styles.kind}><Icon name="flask-conical" size={15} color={fx.red.label} /><T v="overline">Before a collection</T></View>
    <T v="cardTitle" accessibilityRole="header">Preparation</T>
    <ErrorState error={prep.error} onRetry={prep.reload} />
    {(prep.loading && !prep.data) || (none && !bookings.data && !bookings.error) ? <Skeleton height={64} /> : items.length ? items.map((b, i) => <View key={b.bookingId}>
      {i ? <RowDivider /> : null}
      <View style={styles.prep}>
        <T v="section">{`${b.testName ?? 'Blood test'} · ${fmtDateTime(b.slotAt)}`}</T>
        <T v="body" color={fx.ink.a90}>{b.preparation ? `The laboratory’s preparation: ${b.preparation}` : b.fastingHours ? `The laboratory asks for ${b.fastingHours} hours of fasting before collection.` : 'The laboratory lists no preparation for this test.'}</T>
        {b.rebookPending ? <T v="caption" color={fx.hue.amber400}>The Bioptime team is arranging a new visit.</T> : null}
        <View style={styles.line}><Icon name="bell" size={12} color={fx.ink.a50} /><T v="caption" color={fx.ink.a60} style={styles.flex}>{b.reminder ? (b.reminder.status === 'queued' ? `Reminder on ${fmtDateTime(b.reminder.dueAt)}, in Notifications.` : b.reminder.status === 'sent' ? `Reminder sent ${fmtDateTime(b.reminder.dueAt)}.` : 'Reminders are off in your notification settings.') : 'A reminder is set shortly before the collection.'}</T></View>
      </View>
    </View>) : <T v="bodySm" color={fx.ink.a60}>{noneComing(bookings.data?.items)}</T>}
    {prep.data?.timing ? <T v="caption" color={fx.ink.a50}>{`${prep.data.timing} The reminder arrives in Notifications.`}</T> : null}
  </GlassCard>;
}

const styles = StyleSheet.create({
  link44: { minHeight: 44, minWidth: 44, maxWidth: '100%', paddingHorizontal: 4 },
  card: { gap: 12 },
  list: { gap: 12 },
  step: { gap: 10 },
  flex: { flex: 1, minWidth: 0 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  kind: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  note: { fontSize: 15, lineHeight: 24 },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  trend: { gap: 14 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -6 },
  single: { alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 20 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  tableRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  right: { alignItems: 'flex-end', gap: 2 },
  chips: { gap: 8, paddingRight: 4 },
  chipScroll: { flexGrow: 0 },
  prep: { gap: 6, paddingVertical: 6 },
});
