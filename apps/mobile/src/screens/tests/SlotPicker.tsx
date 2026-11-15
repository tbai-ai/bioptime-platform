/* Choosing a home-collection slot (the earlier app's checkout step 4, shots 69–71), used by Book a test and by moving a
   booking: "PREFERRED DATE" with the next 14 days as date chips (weekday, day, month; the chosen one red), then, once a
   day is chosen, "PREFERRED TIME SLOT": the laboratory's real slots for that day and PIN code
   (GET /me/bloodwork/slots) in a two-column grid that pops in, with "Loading slots…" while they come. When slots come
   from more than one laboratory, each shows its laboratory. Nothing is invented: no "booked" slots are drawn, only the
   ones the laboratory offers. */
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { errorText, get } from '@/lib/api';
import { istDate } from '@/lib/format';
import { AnimatedPressable, DateChip, fontFor, fx, haptics, Icon, Notice, Reveal, RingSpinner, T, usePress } from '@/fx';
import { dayParts, slotTime, type Slot, type SlotsPayload } from './model';

export const SLOT_DAYS = Array.from({ length: 14 }, (_, i) => istDate(i + 1));

export function SlotPicker({ pincode, day, onDay, slot, onSlot }: {
  pincode: string; day: string | null; onDay: (d: string) => void; slot: Slot | null; onSlot: (s: Slot) => void;
}) {
  const [state, setState] = useState<{ loading: boolean; slots: Slot[] | null; error: string | null }>({ loading: false, slots: null, error: null });
  useEffect(() => {
    if (!day || !/^\d{6}$/.test(pincode)) { setState({ loading: false, slots: null, error: null }); return; }
    let alive = true;
    setState({ loading: true, slots: null, error: null });
    get<SlotsPayload>(`/me/bloodwork/slots?date=${day}&pincode=${encodeURIComponent(pincode)}`)
      .then((r) => { if (alive) setState({ loading: false, slots: [...(r.slots ?? [])].sort((a, b) => a.startAt.localeCompare(b.startAt) || (a.labName ?? '').localeCompare(b.labName ?? '')), error: null }); })
      .catch((e) => { if (alive) setState({ loading: false, slots: null, error: errorText(e) }); });
    return () => { alive = false; };
  }, [day, pincode]);
  const labs = new Set((state.slots ?? []).map((s) => s.labId));
  return <View style={styles.wrap}>
    <View style={styles.group}>
      <T v="label" color={fx.ink.ink2} accessibilityRole="header">Preferred date</T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days} style={styles.daysScroll}>
        {SLOT_DAYS.map((d) => { const p = dayParts(d); return <DateChip key={d} weekday={p.weekday} day={p.day} month={p.month} label={p.long} selected={d === day} onPress={() => onDay(d)} />; })}
      </ScrollView>
    </View>
    {day ? <View style={styles.group}>
      <T v="label" color={fx.ink.ink2} accessibilityRole="header">Preferred time slot (IST)</T>
      {state.loading ? <View style={styles.loading}><RingSpinner label="Loading slots" /><T v="body" color={fx.ink.a60}>Loading slots…</T></View>
        : state.error ? <Notice kind="error" title="Slots could not load">{state.error}</Notice>
          : state.slots && !state.slots.length ? <T v="body" color={fx.ink.a60}>No slots for that PIN code and day. Try another day.</T>
            : <View style={styles.grid}>
              {(state.slots ?? []).map((s, i) => <Reveal key={`${s.labId}-${s.startAt}`} mount from="scale" index={Math.min(i, 8)} style={styles.cell}>
                <SlotButton s={s} lab={labs.size > 1 ? s.labName ?? null : null} selected={!!slot && slot.startAt === s.startAt && slot.labId === s.labId} onPress={() => onSlot(s)} />
              </Reveal>)}
            </View>}
    </View> : <T v="bodySm" color={fx.ink.a60}>Choose a day to see the laboratory’s free slots for PIN code {pincode}.</T>}
  </View>;
}

function SlotButton({ s, lab, selected, onPress }: { s: Slot; lab: string | null; selected: boolean; onPress: () => void }) {
  const press = usePress('chip');
  const time = slotTime(s);
  const fg = selected ? fx.red.label : fx.ink.white;
  return <AnimatedPressable accessibilityRole="radio" accessibilityLabel={lab ? `${time} IST, ${lab}` : `${time} IST`} accessibilityState={{ checked: selected }} aria-checked={selected}
    onPress={() => { haptics.select(); onPress(); }} onPressIn={press.onPressIn} onPressOut={press.onPressOut}
    style={[styles.slot, selected ? styles.slotOn : styles.slotOff, press.style]}>
    <Icon name="clock" size={16} color={selected ? fx.red.label : fx.ink.a40} />
    <View style={styles.flex}>
      <T v="cardTitle" color={fg} style={styles.time}>{time}</T>
      {lab ? <T v="caption" color={fx.ink.a60} numberOfLines={2}>{lab}</T> : null}
    </View>
  </AnimatedPressable>;
}

const styles = StyleSheet.create({
  wrap: { gap: 28 },
  group: { gap: 12 },
  flex: { flex: 1, minWidth: 0 },
  daysScroll: { flexGrow: 0, marginHorizontal: -20 },
  days: { gap: 10, paddingHorizontal: 20 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cell: { width: '48%', flexGrow: 1 },
  slot: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderRadius: fx.radius.xl, borderWidth: 1, minHeight: 52 },
  slotOn: { backgroundColor: fx.red.a10, borderColor: fx.red.a50 },
  slotOff: { backgroundColor: fx.fill.a05, borderColor: fx.line.a10 },
  time: { fontFamily: fontFor('sans', 400), fontSize: 16 },
});
