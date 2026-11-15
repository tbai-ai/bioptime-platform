/* Food preferences (the Fuel header's settings sheet; PUT /me/nutrition/profile, which the app did not use before): the
   diet pattern, restrictions with how each is meant (allergy, intolerance, avoid, religious, other; the labels are the
   member's own words, there is no built-in medical list), foods disliked, cuisines liked, meals a day and a note for
   the coach. The coach sees it while the member shares health records with them. */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Field, FilterChip, IconButton, Input, Notice, T, fx, haptics } from '@/fx';
import { api, errorText } from '@/lib/api';
import type { NutritionProfile, Restriction } from './types';

const KINDS: Array<{ value: Restriction['kind']; label: string }> = [
  { value: 'allergy', label: 'Allergy' }, { value: 'intolerance', label: 'Intolerance' }, { value: 'avoid', label: 'Avoid' },
  { value: 'religious', label: 'Religious' }, { value: 'other', label: 'Other' },
];
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20);

export function ProfileForm({ profile, onSaved }: { profile: NutritionProfile | null; onSaved: () => void }) {
  const [diet, setDiet] = useState(profile?.dietPattern ?? '');
  const [restrictions, setRestrictions] = useState<Restriction[]>(profile?.restrictions ?? []);
  const [newLabel, setNewLabel] = useState('');
  const [newKind, setNewKind] = useState<Restriction['kind']>('avoid');
  const [dislikes, setDislikes] = useState((profile?.dislikes ?? []).join(', '));
  const [cuisines, setCuisines] = useState((profile?.cuisines ?? []).join(', '));
  const [meals, setMeals] = useState<number | null>(profile?.mealsPerDay ?? null);
  const [notes, setNotes] = useState(profile?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const label = newLabel.trim();
    if (!label) return;
    setRestrictions((r) => [...r.filter((x) => x.label.toLowerCase() !== label.toLowerCase()), { label, kind: newKind }].slice(0, 30));
    setNewLabel('');
    haptics.light();
  };
  const save = async () => {
    setBusy(true); setError(null);
    try {
      await api('PUT', '/me/nutrition/profile', {
        dietPattern: diet.trim() || null, restrictions, dislikes: list(dislikes), cuisines: list(cuisines), mealsPerDay: meals, notes: notes.trim(),
      });
      haptics.success();
      onSaved();
    } catch (e) { setError(errorText(e)); haptics.error(); } finally { setBusy(false); }
  };

  return <View style={styles.wrap}>
    <T v="bodySm" color={fx.ink.a70}>Your coach plans your meals around these. They see them while you share health records with them.</T>
    <Field label="Diet pattern"><Input size="sheet" value={diet} onChangeText={setDiet} placeholder="e.g. Vegetarian on weekdays" maxLength={80} /></Field>

    <View style={styles.group}>
      <T v="label">Restrictions</T>
      {restrictions.length ? restrictions.map((r, i) => <View key={`${r.label}-${i}`} style={styles.restriction}>
        <View style={styles.flex}>
          <T v="section">{r.label}</T>
          <T v="caption" color={fx.ink.a55}>{KINDS.find((k) => k.value === r.kind)?.label ?? r.kind}</T>
        </View>
        <IconButton icon="x" label={`Remove ${r.label}`} size={32} iconSize={14} onPress={() => setRestrictions((x) => x.filter((_, j) => j !== i))} />
      </View>) : <T v="caption" color={fx.ink.a55}>None added.</T>}
      <Input size="sheet" value={newLabel} onChangeText={setNewLabel} placeholder="Add one, in your own words" label="New restriction" maxLength={80} onSubmitEditing={add} returnKeyType="done" />
      <View style={styles.chips}>{KINDS.map((k) => <FilterChip key={k.value} label={k.label} selected={newKind === k.value} onPress={() => setNewKind(k.value)} />)}</View>
      <Button title="Add restriction" variant="soft" icon="plus" onPress={add} disabled={!newLabel.trim()} />
    </View>

    <Field label="Foods you do not eat" hint="Separate them with commas."><Input size="sheet" value={dislikes} onChangeText={setDislikes} placeholder="e.g. Brinjal, mushrooms" /></Field>
    <Field label="Cuisines you like" hint="Separate them with commas."><Input size="sheet" value={cuisines} onChangeText={setCuisines} placeholder="e.g. South Indian, Kerala" /></Field>

    <View style={styles.group}>
      <T v="label">Meals a day</T>
      <View style={styles.chips}>
        {[2, 3, 4, 5, 6].map((m) => <FilterChip key={m} label={String(m)} selected={meals === m} onPress={() => setMeals(m)} />)}
        <FilterChip label="Not set" selected={meals == null} onPress={() => setMeals(null)} />
      </View>
    </View>

    <Field label="Note for your coach (optional)"><Input size="sheet" value={notes} onChangeText={setNotes} multiline maxLength={2000} style={styles.note} /></Field>
    {error ? <Notice kind="error">{error}</Notice> : null}
    <Button title="Save preferences" variant="white" iconRight={null} commit busy={busy} onPress={save} full />
  </View>;
}

const styles = StyleSheet.create({
  wrap: { gap: 18 },
  flex: { flex: 1 },
  group: { gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  restriction: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderRadius: fx.radius.xl, borderWidth: 1, borderColor: fx.line.a05, backgroundColor: fx.fill.a03 },
  note: { minHeight: 72, textAlignVertical: 'top' },
});
