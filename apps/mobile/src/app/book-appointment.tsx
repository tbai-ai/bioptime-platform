/* Book a consultation (a sheet route over the Coach tab, AMENDED §1 "Sheets"; THEME §11.8 sheet chrome). A calm photo
   band (slot coach.booking.sheet, no coach name inside it, CRITIQUE §52) sits above the title; then the earlier app's
   checkout step 4 picker: date chips for the next seven days and a two-column grid of the coach's free slots (GET
   /me/appointments/slots?date=, IST); an optional note; "x of y consultations left" from the member's package; the CTA
   "Request this slot" pinned at the bottom. POST /me/appointments { startAt, kind: 'consultation', note,
   idempotencyKey } books it (scheduled) or asks the coach (requested): the sentences that follow are Bioptime's, word for
   word. Bookings need at least 30 minutes' notice (the server's rule). No coach yet (409 NO_COACH): the notice says
   consultations open once a coach is assigned. How to join and the calendar file are on the Coach tab's consultation
   sheet. */
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ApiError, errorText, get, post, randomKey } from '@/lib/api';
import { fmtDate, fmtTime } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Button, ErrorState, Eyebrow, Field, Input, Notice, Photo, Scrim, SheetScreen, T, closeOverlay, fx, haptics, invalidate } from '@/fx';
import { DoneState } from '@/screens/coach/parts';
import { DateRow, SlotCta, SlotGrid, type Slot } from '@/screens/coach/SlotPicker';
import { istToday } from '@/screens/coach/time';

type Me = { entitlements?: { consultation?: { total: number; remaining: number } | null } | null };
/** Why the API said no: a state error (409) carries its reason in details.code (NO_COACH), other errors in code. */
const reason = (e: unknown): string | null => (e instanceof ApiError ? (e.details as { code?: string } | null)?.code ?? e.code : null);

export default function BookAppointment() {
  const days = [1, 2, 3, 4, 5, 6, 7].map((n) => istToday(n));
  const [date, setDate] = useState(days[0]);
  const [slot, setSlot] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string; title?: string } | null>(null);
  const slots = useLoad<{ slots: Slot[] }>(null, () => get(`/me/appointments/slots?date=${date}`), [date]);
  // until the member picks a day, the first of the seven with a free slot is shown (not an empty grid for a day off)
  const picked = useRef(false);
  const shown = slots.data?.slots;
  useEffect(() => {
    if (picked.current || slots.loading || slots.error || !shown || shown.length) return;
    const i = days.indexOf(date);
    if (i >= 0 && i < days.length - 1) setDate(days[i + 1]);
  }, [shown, slots.loading, slots.error]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickDate = (d: string) => { picked.current = true; setDate(d); };
  const me = useLoad<Me>('me', () => get('/me'), [], { shared: true });
  const left = me.data?.entitlements?.consultation ?? null;
  const noCoach = reason(slots.error) === 'NO_COACH';
  const done = msg?.kind === 'success';
  const close = () => closeOverlay('/(tabs)/coach');

  const book = async () => {
    if (!slot) return;
    setBusy(true); setMsg(null);
    try {
      const r = await post<{ startAt?: string; status?: string }>('/me/appointments', { startAt: slot, kind: 'consultation', note: note.trim() || undefined, idempotencyKey: randomKey() });
      const when = `${fmtDate(r.startAt ?? slot)} at ${fmtTime(r.startAt ?? slot)}`;
      setMsg(r.status === 'scheduled'
        ? { kind: 'success', title: 'Booked', text: `Booked for ${when}. One consultation is held from your package until it is completed; cancelling gives it back.` }
        : { kind: 'success', title: 'Requested', text: `Requested for ${when}. Your coach confirms it; one consultation is held from your package until then.` });
      haptics.success();
      setSlot(null);
      invalidate(['appointments', 'me']);
    } catch (e) {
      setMsg({ kind: 'error', text: errorText(e) });
      if (reason(e) === 'SLOT_TAKEN') void slots.reload();
    } finally { setBusy(false); }
  };

  const hero = <View style={styles.band}>
    <Photo slot="coach.booking.sheet" opacity={0.5} style={StyleSheet.absoluteFill} decorative />
    <Scrim kind="emptyBand" style={StyleSheet.absoluteFill} />
    <View style={styles.bandText}>
      <Eyebrow kind="brand">Consultation</Eyebrow>
      <T v="h1" accessibilityRole="header">Book a consultation</T>
    </View>
  </View>;

  const footer = done ? <Button title="Done" icon="check" onPress={close} />
    : <SlotCta slot={slot} busy={busy} disabled={noCoach} onPress={() => { void book(); }} />;

  return <SheetScreen onClose={close} hero={hero} footer={footer} padding={20}>
    {done ? <DoneState title={msg!.title ?? 'Booked'} text={msg!.text} /> : <View style={styles.body}>
      <T v="body" color={fx.ink.a70}>Pick a day, then one of your coach's free slots (IST). Bookings need at least 30 minutes' notice.</T>
      {noCoach ? <Notice kind="warning" title="No coach yet">Consultations open once a coach is assigned.</Notice> : null}
      {!noCoach ? <>
        <DateRow days={days} value={date} onChange={(d) => { pickDate(d); setSlot(null); }} />
        {slots.error ? <ErrorState error={slots.error} onRetry={slots.reload} />
          : <SlotGrid slots={slots.data?.slots ?? []} value={slot} onChange={setSlot} loading={slots.loading && !slots.data} empty="No free slots that day. Try another day." />}
        <Field label="Anything your coach should know (optional)">
          <Input size="sheet" value={note} onChangeText={setNote} multiline maxLength={500} style={styles.note} placeholder="For example, what you would like to talk about" />
        </Field>
        {left ? <T v="caption" color={fx.ink.a60}>{`${left.remaining} of ${left.total} consultations left in your package. One is held when you book; cancelling gives it back.`}</T> : null}
      </> : null}
      {msg?.kind === 'error' ? <Notice kind="error">{msg.text}</Notice> : null}
    </View>}
  </SheetScreen>;
}

const styles = StyleSheet.create({
  band: { height: 132, marginTop: -12, overflow: 'hidden', justifyContent: 'flex-end' },
  bandText: { paddingHorizontal: 20, paddingBottom: 12, gap: 2 },
  body: { gap: 20, paddingTop: 12 },
  note: { minHeight: 72, textAlignVertical: 'top', outlineStyle: 'solid', outlineWidth: 0 },
});
