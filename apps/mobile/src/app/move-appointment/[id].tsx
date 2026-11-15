/* Move a consultation (a sheet route over the Coach tab): PATCH /me/appointments/:id { startAt } with the same day and
   time picker as Book. The server's rules: only a requested or scheduled consultation moves; a member can move it until
   the cut-off Bioptime sets before the start (409 CUTOFF: then the member messages the coach); the new time is at least
   30 minutes away and clashes with nothing (SLOT_TAKEN reloads the slots). The status, the consultation held from the
   package and the meeting details stay as they were; the coach is told. There is no single-appointment GET, so the
   consultation is found in the upcoming list. Reached from the Coach tab's consultation sheet. */
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ApiError, errorText, get, patch } from '@/lib/api';
import { fmtDate, fmtTime, label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Button, EmptyState, ErrorState, GlassCard, Icon, Notice, Pill, SheetScreen, Skeleton, T, closeOverlay, fx, haptics, invalidate, statusTone } from '@/fx';
import { DoneState } from '@/screens/coach/parts';
import { DateRow, SlotGrid, type Slot } from '@/screens/coach/SlotPicker';
import { istDay, istToday, whenLine } from '@/screens/coach/time';

type Appointment = { id: string; kind: string; status: string; startAt: string; coachName?: string | null; consumesEntitlement?: boolean };
/** Why the API said no: a state error (409) carries its reason in details.code (CUTOFF, NO_COACH), other errors in code. */
const reason = (e: unknown): string | null => (e instanceof ApiError ? (e.details as { code?: string } | null)?.code ?? e.code : null);

export default function MoveAppointment() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const upcoming = useLoad<{ items: Appointment[] }>(null, () => get('/me/appointments?range=upcoming'), []);
  const ap = (upcoming.data?.items ?? []).find((x) => x.id === id) ?? null;
  const days = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => istToday(n));
  const [picked, setPicked] = useState<string | null>(null); // the day the member chose; until then the booking's own day, when it is in the window
  const own = ap ? istDay(ap.startAt) : null;
  const date = picked ?? (own && days.includes(own) ? own : days[1]);
  const [slot, setSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string; cutoff?: boolean } | null>(null);
  const movable = !!ap && (ap.status === 'scheduled' || ap.status === 'requested');
  const slots = useLoad<{ slots: Slot[] }>(null, () => (movable ? get(`/me/appointments/slots?date=${date}`) : Promise.resolve({ slots: [] })), [date, movable]);
  const noCoach = reason(slots.error) === 'NO_COACH';
  const done = msg?.kind === 'success';
  const close = () => closeOverlay('/(tabs)/coach');

  const move = async () => {
    if (!slot || !ap) return;
    setBusy(true); setMsg(null);
    try {
      const r = await patch<{ startAt?: string; status?: string }>(`/me/appointments/${ap.id}`, { startAt: slot });
      const at = r.startAt ?? slot;
      setMsg({ kind: 'success', text: `Moved to ${fmtDate(at)} at ${fmtTime(at)} IST. Your coach is told.${r.status === 'requested' ? ' Your coach still confirms it.' : ''}` });
      haptics.success();
      setSlot(null);
      invalidate(['appointments', 'me']);
    } catch (e) {
      setMsg({ kind: 'error', text: errorText(e), cutoff: reason(e) === 'CUTOFF' });
      if (reason(e) === 'SLOT_TAKEN') void slots.reload();
    } finally { setBusy(false); }
  };

  const messageCoach = () => { closeOverlay('/(tabs)/coach'); router.navigate('/(tabs)/coach'); };
  const footer = done || msg?.cutoff || (ap && !movable) || (upcoming.data && !ap)
    ? <View style={styles.footer}>
      {msg?.cutoff ? <Button title="Message your coach" variant="soft" icon="message-square" onPress={messageCoach} /> : null}
      <Button title={done ? 'Done' : 'Back to Coach'} icon={done ? 'check' : undefined} onPress={close} />
    </View>
    : movable ? <Button title="Move to this slot" commit busy={busy} disabled={!slot || noCoach} onPress={move} /> : null;

  return <SheetScreen title="Move a consultation" onClose={close} footer={footer} padding={20}>
    {done ? <DoneState title="Moved" text={msg!.text} /> : <View style={styles.body}>
      <T v="body" color={fx.ink.a70}>Pick a new day, then one of your coach's free slots (IST). A consultation can be moved until a set time before it starts; after that, message your coach.</T>
      {upcoming.error ? <ErrorState error={upcoming.error} onRetry={upcoming.reload} /> : null}
      {upcoming.loading && !upcoming.data ? <Skeleton height={76} radius={fx.radius.card} /> : null}
      {upcoming.data && !ap ? <EmptyState icon="calendar" title="Not upcoming any more" body="This consultation has already taken place, was cancelled, or is no longer on your list." /> : null}
      {ap ? <GlassCard variant="tile" style={styles.now}>
        <View style={styles.nowIcon}><Icon name="calendar-check" size={18} color={fx.red.vivid} /></View>
        <View style={styles.flex}>
          <View style={styles.nowHead}><T v="label" color={fx.ink.a50}>Booked now</T><Pill tone={statusTone(ap.status)}>{label(ap.status)}</Pill></View>
          <T v="sectionStrong">{whenLine(ap.startAt)}</T>
          <T v="caption" color={fx.ink.a60}>{`${label(ap.kind)}${ap.coachName ? ` · ${ap.coachName}` : ''}${ap.consumesEntitlement ? ' · counts against your package' : ''}`}</T>
        </View>
      </GlassCard> : null}
      {ap && !movable ? <Notice kind="warning">{`A consultation that is ${label(ap.status).toLowerCase()} cannot be moved.`}</Notice> : null}
      {movable && !msg?.cutoff ? <>
        {noCoach ? <Notice kind="warning" title="No coach yet">Consultations open once a coach is assigned.</Notice> : <>
          <DateRow days={days} value={date} onChange={(d) => { setPicked(d); setSlot(null); }} />
          {slots.error ? <ErrorState error={slots.error} onRetry={slots.reload} />
            : <SlotGrid slots={slots.data?.slots ?? []} value={slot} onChange={setSlot} loading={slots.loading && !slots.data} empty="No free slots that day. Try another day." />}
        </>}
      </> : null}
      {msg?.kind === 'error' ? <Notice kind={msg.cutoff ? 'warning' : 'error'}>{msg.text}</Notice> : null}
    </View>}
  </SheetScreen>;
}

const styles = StyleSheet.create({
  body: { gap: 20 },
  now: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  nowIcon: { width: 40, height: 40, borderRadius: fx.radius.xl, backgroundColor: fx.red.a10, borderWidth: 1, borderColor: fx.red.a20, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, gap: 2 },
  nowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 2 },
  footer: { gap: 8 },
});
