/* Log a meal in your own words (the earlier app's "Add Custom Meal" sheet, 59-fuel-custom-meal-modal, without its AI
   estimate and without typed-in calories and macros: the API keeps no member-typed values and estimates nothing, AMENDED
   Q4). The chef's-hat header, then Bioptime's meal log: the day (today, yesterday, two days ago), the planned meal it was
   (or "Not planned" and which meal), what happened (as planned, swapped, skipped, extra), what was eaten, a note, and an
   optional photo from the library, sent after the meal is saved. A swap can also be picked from the dishes, which
   carries their entered values. Used by the Fuel tab's sheet and by the meal-log route. */
import { Image } from 'expo-image';
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Field, FilterChip, Icon, IconButton, Input, Notice, T, fx, haptics, toast } from '@/fx';
import { errorText, post } from '@/lib/api';
import { OUTCOME_LABEL, SLOTS, SLOT_LABEL, planDayOf, shiftDate, slotForNow } from './format';
import { pickMealPhoto, uploadMealPhoto, type PickedPhoto } from './photo';
import type { MealLog, MealSlotName, Nutrition, Outcome, PlanSlot } from './types';

export type MealLogInitial = { slotId?: string; outcome?: Outcome };

export function MealLogForm({ n, initial, onSaved, onPickDish }: {
  n: Nutrition; initial?: MealLogInitial;
  onSaved: (log: MealLog, label: string) => void;
  /** Swapped: pick what was eaten from the dishes instead (the Fuel tab's search in swap mode). */
  onPickDish?: (slot: PlanSlot) => void;
}) {
  const today = n.today;
  const [date, setDate] = useState(today);
  const [slotId, setSlotId] = useState(initial?.slotId ?? '');
  const [slot, setSlot] = useState<MealSlotName>(slotForNow());
  const [outcome, setOutcome] = useState<Outcome>(initial?.outcome ?? (initial?.slotId ? 'as_planned' : 'extra'));
  const [description, setDescription] = useState('');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const planned: PlanSlot[] = useMemo(() => (n.plan?.version?.slots ?? []).filter((s) => s.day === planDayOf(date)), [n.plan, date]);
  const logged = date === today ? new Set(n.todayLogs.map((l) => l.slotId).filter(Boolean)) : new Set<string>();
  useEffect(() => { if (slotId && !planned.some((s) => s.id === slotId)) { setSlotId(''); setOutcome('extra'); } }, [planned]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = planned.find((s) => s.id === slotId) ?? null;
  const outcomes: Outcome[] = slotId ? ['as_planned', 'swapped', 'skipped'] : ['extra', 'as_planned', 'swapped', 'skipped'];
  const needsDescription = !slotId || outcome === 'swapped';
  const valid = !needsDescription || description.trim().length >= 2;
  const photosOn = !!n.photos?.available;

  const choosePhoto = async () => {
    setError(null);
    try { const p = await pickMealPhoto(); if (p) { setPhoto(p); haptics.light(); } }
    catch (e) { setError(e instanceof Error ? e.message : 'That photo could not be used.'); }
  };

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const log = await post<MealLog>('/me/meal-logs', {
        date, outcome,
        ...(slotId ? { slotId } : { slot }),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      if (photo) {
        try { await uploadMealPhoto(log.id, photo); log.hasPhoto = true; }
        catch (e) { toast.error(`Meal saved. The photo was not added: ${errorText(e)}`); }
      }
      haptics.success();
      onSaved(log, chosen && outcome !== 'swapped' ? chosen.title : log.description);
    } catch (e) { setError(errorText(e)); haptics.error(); } finally { setBusy(false); }
  };

  const descLabel = outcome === 'swapped' ? 'What you ate instead' : outcome === 'skipped' ? 'Why you skipped (optional)' : needsDescription ? 'What you ate' : 'What you ate (optional)';
  return <View style={styles.wrap}>
    <View style={styles.head}>
      <View style={styles.tile}><Icon name="chef-hat" size={24} color={fx.red.vivid} /></View>
      <View style={styles.flex}>
        <T v="heading" accessibilityRole="header" style={styles.title}>Log a meal</T>
        <T v="bodySm" color={fx.ink.a70}>What you ate, as you remember it. Your coach reads it while you share health records with them.</T>
      </View>
    </View>

    <Group label="Day">
      {[0, -1, -2].map((k) => { const d = shiftDate(today, k); return <FilterChip key={k} label={k === 0 ? 'Today' : k === -1 ? 'Yesterday' : '2 days ago'} selected={date === d} onPress={() => setDate(d)} />; })}
    </Group>

    {planned.length ? <Group label="Planned meal">
      {planned.map((s) => <FilterChip key={s.id} label={`${SLOT_LABEL[s.slot] ?? s.slot} · ${s.title}${logged.has(s.id) ? ' (logged)' : ''}`} selected={slotId === s.id}
        onPress={() => { setSlotId(s.id); if (outcome === 'extra') setOutcome('as_planned'); }} />)}
      <FilterChip label="Not planned" selected={!slotId} onPress={() => { setSlotId(''); setOutcome('extra'); }} />
    </Group> : null}

    {!slotId ? <Group label="Meal">
      {SLOTS.map((s) => <FilterChip key={s} label={SLOT_LABEL[s]} selected={slot === s} onPress={() => setSlot(s)} />)}
    </Group> : null}

    <Group label="What happened">
      {outcomes.map((o) => <FilterChip key={o} label={OUTCOME_LABEL[o]} selected={outcome === o} onPress={() => setOutcome(o)} />)}
    </Group>

    {chosen && outcome === 'swapped' && onPickDish ? <Button variant="link" title="Pick what you ate from the dishes" onPress={() => onPickDish(chosen)} style={styles.pick} /> : null}

    <Field label={descLabel} hint={!needsDescription && chosen ? `Leave empty to use “${chosen.title}”.` : undefined}>
      <Input size="sheet" value={description} onChangeText={setDescription} multiline placeholder={outcome === 'skipped' ? 'Optional' : 'e.g. Two rotis with dal, a bowl of curd'} maxLength={500} style={styles.note} />
    </Field>
    <Field label="Note (optional)">
      <Input size="sheet" value={note} onChangeText={setNote} multiline placeholder="Anything your coach should know" maxLength={1000} style={styles.note} />
    </Field>

    {photosOn ? <View style={styles.group}>
      <T v="label">Photo (optional)</T>
      {photo ? <View style={styles.photoRow}>
        <Image source={{ uri: photo.uri }} contentFit="cover" style={styles.preview} accessible accessibilityLabel="The photo you picked" />
        <T v="caption" color={fx.ink.a60} style={styles.flex}>{`${photo.filename} · ${(photo.bytes / 1024 / 1024).toFixed(1)} MB. It is stored privately with this meal.`}</T>
        <IconButton icon="x" label="Remove the photo" size={32} iconSize={14} onPress={() => setPhoto(null)} />
      </View> : <Button title="Add a photo" variant="soft" icon="image" onPress={choosePhoto} />}
    </View> : null}

    <T v="caption" color={fx.ink.a50} center style={styles.disclaimer}>A meal in your own words carries no nutrient values: pick a dish from Search to count it. Nothing is calculated from your photos or what you write.</T>
    {error ? <Notice kind="error">{error}</Notice> : null}
    <Button title="Log meal" variant="white" icon="plus" iconRight={null} commit busy={busy} disabled={!valid} onPress={save} full />
  </View>;
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={styles.group}>
    <T v="label">{label}</T>
    <View style={styles.chips}>{children}</View>
  </View>;
}

const styles = StyleSheet.create({
  wrap: { gap: 18 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  tile: { width: 48, height: 48, borderRadius: fx.radius.xl, borderWidth: 1, borderColor: fx.red.a30, backgroundColor: fx.red.a10, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  title: { fontSize: 20, lineHeight: 28 },
  group: { gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pick: { alignSelf: 'flex-start', marginTop: -8 },
  note: { minHeight: 72, textAlignVertical: 'top' },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  preview: { width: 56, height: 56, borderRadius: fx.radius.lg, borderWidth: 1, borderColor: fx.line.a10 },
  disclaimer: { paddingHorizontal: 8 },
});
