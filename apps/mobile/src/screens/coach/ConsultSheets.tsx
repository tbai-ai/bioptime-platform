/* The Coach tab's consultation sheets (drawn by the root SheetHost, spring.sheet):
   - Upcoming: each requested or scheduled consultation with its status, what the coach noted, whether it counts
     against the package, how to join (module 'sessions': a scheduled one with an https link the coach shared gets
     "Join"; otherwise "Your coach will share how to join." or, while requested, "Your coach confirms it first."), and
     Move (the move sheet route), Cancel (asks first) and Add to calendar (the .ics, module 'sessions').
   - Cancel: Bioptime's question, word for word: "Cancel this consultation?" "The slot is given back to your package."
   - Past: the consultations that took place or were cancelled, newest first, each with the summary the coach wrote
     after it (module 'sessions'), and the way to the coach's recommendations. One whose time has passed while it is
     still open says "Awaiting update" (lib/today), never "Scheduled". */
import React from 'react';
import { Linking, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Button, EmptyState, GlassCard, Icon, Pill, Sheet, Skeleton, T, fx, statusTone } from '@/fx';
import { fmtDate, label } from '@/lib/format';
import { shownStatus } from '@/lib/today';
import { whenLine } from './time';
import { OPEN_STATES, httpsLink, type Appointment, type Entitlement, type Summary } from './types';
import { largeText } from '@/fx/layout';

export function UpcomingSheet({ visible, onClose, items, sessionsOn, left, busy, onMove, onCancel, onIcs, onBook }: {
  visible: boolean; onClose: () => void; items: Appointment[]; sessionsOn: boolean; left: Entitlement | null; busy: string | null;
  onMove: (a: Appointment) => void; onCancel: (a: Appointment) => void; onIcs: (a: Appointment) => void; onBook: () => void;
}) {
  return <Sheet visible={visible} onClose={onClose} title={items.length > 1 ? 'Upcoming consultations' : 'Your next consultation'}
    footer={<View style={styles.footer}>
      <Button title="Book a consultation" icon="plus" onPress={onBook} />
      {left ? <T v="caption" color={fx.ink.a60} center>{`${left.remaining} of ${left.total} consultations left in your package`}</T> : null}
    </View>}>
    {items.length ? <View style={styles.list}>{items.map((a) => <UpcomingCard key={a.id} a={a} sessionsOn={sessionsOn} busy={busy} onMove={onMove} onCancel={onCancel} onIcs={onIcs} />)}</View>
      : <EmptyState icon="calendar" title="Nothing booked" body="Book from your coach's free slots." />}
  </Sheet>;
}

function UpcomingCard({ a, sessionsOn, busy, onMove, onCancel, onIcs }: { a: Appointment; sessionsOn: boolean; busy: string | null; onMove: (a: Appointment) => void; onCancel: (a: Appointment) => void; onIcs: (a: Appointment) => void }) {
  const open = OPEN_STATES.includes(a.status);
  const link = a.status === 'scheduled' ? httpsLink(a.meetingLink) : null;
  // from text 1.3 the actions stack (as Packages, Bespoke and the booking page do: SWB-06): side by side in a wide sheet
  // 'Add to calendar' wrapped inside its button (TAB-07)
  const stack = largeText(useWindowDimensions().fontScale);
  return <GlassCard style={styles.card}>
    <View style={styles.cardHead}>
      <View style={styles.icon}><Icon name="calendar-check" size={18} color={fx.red.vivid} /></View>
      <View style={styles.flex}>
        <Pill tone={statusTone(a.status)} style={styles.pill}>{label(a.status)}</Pill>
        <T v="cardTitle">{whenLine(a.startAt)}</T>
        <T v="caption" color={fx.ink.a60}>{`${label(a.kind)}${a.coachName ? ` · ${a.coachName}` : ''}${a.consumesEntitlement ? ' · counts against your package' : ''}`}</T>
      </View>
    </View>
    {a.note ? <T v="bodySm" color={fx.ink.a70}>{a.note}</T> : null}
    {sessionsOn ? <View style={styles.join}>
      <Icon name="video" size={14} color={fx.ink.a60} />
      {link ? <T v="bodySm" color={fx.ink.a80} style={styles.flex}>Your coach shared a link to join.</T>
        : <T v="bodySm" color={fx.ink.a60} style={styles.flex}>{a.status === 'scheduled' ? 'Your coach will share how to join.' : 'Your coach confirms it first.'}</T>}
      {link ? <Button title="Join" variant="solidSm" icon="video" onPress={() => { Linking.openURL(link).catch(() => undefined); }} /> : null}
    </View> : null}
    {open ? <View style={stack ? styles.stacked : styles.actions}>
      <Button title="Move" label={`Move the consultation on ${whenLine(a.startAt)}`} icon="calendar" variant="soft" full={false} small onPress={() => onMove(a)} style={stack ? styles.actionStacked : styles.action} />
      {sessionsOn ? <Button title="Add to calendar" label={`Add to calendar: the consultation on ${whenLine(a.startAt)}`} icon="calendar-days" variant="soft" full={false} small busy={busy === `ics-${a.id}`} onPress={() => onIcs(a)} style={stack ? styles.actionStacked : styles.action} /> : null}
      <Button title="Cancel" label={`Cancel the consultation on ${whenLine(a.startAt)}`} variant="redGlass" full={false} small onPress={() => onCancel(a)} style={[stack ? styles.actionStacked : styles.action, styles.cancel]} />
    </View> : null}
  </GlassCard>;
}

export function CancelSheet({ visible, onClose, onConfirm, busy, when }: { visible: boolean; onClose: () => void; onConfirm: () => void; busy: boolean; when: string | null }) {
  return <Sheet visible={visible} onClose={onClose} title="Cancel this consultation?">
    {when ? <T v="sectionStrong" style={styles.when}>{when}</T> : null}
    <T v="body" color={fx.ink.a80}>The slot is given back to your package.</T>
    <View style={styles.confirm}>
      <Button title="Cancel it" variant="redGlass" busy={busy} onPress={onConfirm} />
      <Button title="Keep it" variant="ghost" full onPress={onClose} />
    </View>
  </Sheet>;
}

export function PastSheet({ visible, onClose, items, summaries, sessionsOn, loading, notes, onNotes }: {
  visible: boolean; onClose: () => void; items: Appointment[]; summaries: Summary[]; sessionsOn: boolean; loading: boolean; notes: number; onNotes: () => void;
}) {
  const byAppointment = new Map(summaries.filter((s) => s.appointmentId).map((s) => [s.appointmentId as string, s]));
  const loose = summaries.filter((s) => !s.appointmentId || !items.some((a) => a.id === s.appointmentId));
  return <Sheet visible={visible} onClose={onClose} title="Past consultations">
    {loading && !items.length ? <View style={styles.list}><Skeleton height={88} radius={fx.radius.card} /><Skeleton height={88} radius={fx.radius.card} /></View>
      : items.length || loose.length ? <View style={styles.list}>
        {items.map((a) => <PastCard key={a.id} a={a} summary={sessionsOn ? byAppointment.get(a.id) ?? null : null} />)}
        {sessionsOn ? loose.map((s) => <SummaryCard key={s.id} s={s} standalone />) : null}
      </View>
        : <EmptyState icon="calendar" title="No past consultations yet" body={sessionsOn ? 'After each consultation, the summary your coach writes appears here.' : 'Consultations you have had appear here.'} />}
    {notes ? <Button title={`Recommendations from your coach (${notes})`} icon="clipboard-list" variant="soft" onPress={onNotes} style={styles.notes} /> : null}
  </Sheet>;
}

function PastCard({ a, summary }: { a: Appointment; summary: Summary | null }) {
  const status = shownStatus(a); // a past one still open: "Awaiting update" (amber), never "Scheduled"
  return <GlassCard style={styles.card}>
    <View style={styles.cardHead}>
      <View style={[styles.icon, styles.iconQuiet]}><Icon name="calendar" size={18} color={fx.ink.a60} /></View>
      <View style={styles.flex}>
        <Pill tone={status === a.status ? statusTone(a.status) : statusTone('pending')} style={styles.pill}>{label(status)}</Pill>
        <T v="cardTitle">{whenLine(a.startAt)}</T>
        <T v="caption" color={fx.ink.a60}>{`${label(a.kind)}${a.coachName ? ` · ${a.coachName}` : ''}`}</T>
      </View>
    </View>
    {a.note ? <T v="bodySm" color={fx.ink.a70}>{a.note}</T> : null}
    {summary ? <SummaryCard s={summary} /> : null}
  </GlassCard>;
}

function SummaryCard({ s, standalone }: { s: Summary; standalone?: boolean }) {
  const body = <>
    <View style={styles.summaryHead}><Icon name="file-text" size={13} color={fx.red.label} /><T v="label" color={fx.red.label}>Summary from your coach</T></View>
    {standalone && s.startAt ? <T v="sectionStrong">{whenLine(s.startAt)}</T> : null}
    <T v="body" color={fx.ink.a90}>{s.body}</T>
    <T v="caption" color={fx.ink.a50}>{`${s.coachName ?? 'Your coach'} · ${fmtDate(s.createdAt)}`}</T>
  </>;
  return standalone ? <GlassCard style={styles.card} rule={{ color: fx.red.brand, width: 3 }}>{body}</GlassCard> : <View style={styles.summary}>{body}</View>;
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  footer: { gap: 8 },
  card: { gap: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  pill: { marginBottom: 6 },
  icon: { width: 40, height: 40, borderRadius: fx.radius.xl, backgroundColor: fx.red.a10, borderWidth: 1, borderColor: fx.red.a20, alignItems: 'center', justifyContent: 'center' },
  iconQuiet: { backgroundColor: fx.fill.a05, borderColor: fx.line.a10 },
  flex: { flex: 1, minWidth: 0 },
  join: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: fx.line.a05 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stacked: { gap: 8 },
  actionStacked: { alignSelf: 'stretch' },
  action: { flexGrow: 1, flexBasis: 160 },
  cancel: { paddingVertical: 12 },
  when: { marginBottom: 8 },
  confirm: { gap: 10, marginTop: 20 },
  summary: { gap: 6, padding: 14, borderRadius: fx.radius.xl, backgroundColor: fx.red.a05, borderWidth: 1, borderColor: fx.red.a15 },
  summaryHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  notes: { marginTop: 16 },
});
