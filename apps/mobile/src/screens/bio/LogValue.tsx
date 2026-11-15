/* The Log a value sheet (route /progress-entry, presented as a sheet; opened from Bio's "+", a metric sheet, a "Log"
   tile, Home and Profile; `?metric=` preselects one). Metric chips, a mono number field with the unit and its allowed
   range, the day (today or one of the six before), an optional note, Save. Water and steps are one total a day
   (PUT /me/progress/daily, source member): the field takes the day's total, and a phone's own count is kept apart.
   Every other measure is one self-reported value (POST /me/progress). After a save: a light success haptic, the
   bottom pill, the screens showing progress reload, and the sheet closes. A value that reaches a measured goal is a
   moment of its own: the goals are read before the write (when the sheet opens) and again after it, and a goal that
   turned achieved (target reached) gets the top "Goal reached: <title>" toast instead of the pill, the success
   haptic, and the done check on its card the next time it is seen (noteJustReached). */
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { api, errorText, get, post } from '@/lib/api';
import { istDate } from '@/lib/format';
import { invalidate, useLoad } from '@/lib/useLoad';
import { Button, DateChip, ErrorState, Field, FilterChip, fx, haptics, Input, NumberInput, Skeleton, T, toast } from '@/fx';
import { DAILY, dayOf, fmtValue, iconOf, isToday, noteJustReached, shortLabel, unitText, type Goal, type Summary } from './data';

const DAYS = Array.from({ length: 7 }, (_, i) => istDate(-i));

export function LogValueForm({ initial, onDone }: { initial?: string | null; onDone: () => void }) {
  const s = useLoad<Summary>('progress', () => get('/me/progress/summary'), []);
  // the open goals as the sheet opens: a goal this value reaches is told apart after the save
  const goalsBefore = useLoad<{ items: Goal[] }>('log.goals', () => get('/me/goals'), []);
  const metrics = useMemo(() => (s.data?.metrics ?? []).filter((m) => m.enabled !== false), [s.data]);
  const [metric, setMetric] = useState<string | null>(initial ?? null);
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(DAYS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const m = metrics.find((x) => x.metric === metric) ?? null;
  const daily = !!m && (m.daily || DAILY.has(m.metric));
  const n = Number(value.replace(',', '.'));
  const bad = value.trim() !== '' && (Number.isNaN(n) || (m?.min != null && n < m.min) || (m?.max != null && n > m.max));
  const unit = m ? unitText(m.unit) : '';
  const current = m?.latest && daily && (m.latest.day ? m.latest.day === date : isToday(m.latest) && date === DAYS[0]) ? m.latest : null;

  const save = async () => {
    if (!m || bad || value.trim() === '') return;
    setBusy(true); setError(null);
    try {
      if (daily) await api('PUT', '/me/progress/daily', { metric: m.metric, date, value: n, source: 'member' });
      else await post('/me/progress', { metric: m.metric, value: n, ...(date !== DAYS[0] ? { at: new Date(`${date}T12:00:00+05:30`).toISOString() } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
      haptics.success();
      const open = new Set((goalsBefore.data?.items ?? []).filter((g) => g.status === 'active' && g.metric === m.metric).map((g) => g.id));
      const reached = open.size ? await get<{ items: Goal[] }>('/me/goals').then((r) => r.items.filter((g) => open.has(g.id) && g.status === 'achieved'), () => [] as Goal[]) : [];
      if (reached.length) {
        noteJustReached(reached.map((g) => g.id));
        toast.success(reached.length === 1 ? `Goal reached: ${reached[0].title}` : `${reached.length} goals reached`);
      } else toast.logged(`${shortLabel(m.label)}: ${fmtValue(n)} ${unit} saved`);
      invalidate(['progress', 'progress-goals', 'me', 'home.goals']);
      onDone();
    } catch (e) { haptics.error(); setError(errorText(e)); } finally { setBusy(false); }
  };

  if (s.loading && !s.data) return <View style={styles.gap} accessibilityLabel="Loading"><Skeleton height={72} /><Skeleton height={56} /><Skeleton height={56} /></View>;
  return <View style={styles.gap}>
    <T v="bodySm" color={fx.ink.a70}>Self-reported, shown as what you logged to you, and to your coach while health sharing is on. Never a laboratory measurement.</T>
    <ErrorState error={s.error} onRetry={s.reload} />
    <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="What to log">
      {metrics.map((x) => <FilterChip key={x.metric} label={shortLabel(x.label)} icon={iconOf(x.metric)} selected={x.metric === metric} onPress={() => { haptics.select(); setMetric(x.metric); setValue(''); setError(null); }} />)}
    </View>
    {m ? <>
      <Field label={daily ? `${shortLabel(m.label)}: the day’s total` : shortLabel(m.label)} title={daily ? `${shortLabel(m.label)}, the day’s total (${unit})` : `${m.label} (${unit})`}
        error={bad ? (m.min != null && m.max != null ? `A number between ${m.min} and ${m.max}` : 'A number') : null}
        hint={daily ? `Replaces the total you entered for that day${current ? ` (now ${fmtValue(current.value)} ${unit}, ${current.sourceLabel ?? 'logged'})` : ''}. A phone’s own count is kept apart; the day shows the larger.`
          : m.min != null && m.max != null ? `Between ${m.min} and ${m.max}.` : undefined}>
        <NumberInput unit={unit.toUpperCase()} value={value} onChangeText={(t) => { setValue(t); setError(null); }} placeholder={m.latest ? fmtValue(m.latest.value) : '0'} label={`${m.label} in ${unit}`} autoFocus returnKeyType="done" onSubmitEditing={save} />
      </Field>
      <View style={styles.gapSm}>
        <T v="label">Day</T>
        <View style={styles.days}>
          {DAYS.map((d, i) => {
            const at = new Date(`${d}T06:30:00Z`);
            return <DateChip key={d} weekday={i === 0 ? 'Today' : at.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' })} day={at.getUTCDate()}
              month={at.toLocaleDateString('en-IN', { month: 'short', timeZone: 'Asia/Kolkata' })} selected={date === d} onPress={() => { haptics.select(); setDate(d); }}
              label={i === 0 ? 'Today' : dayOf({ at: at.toISOString(), value: 0, source: 'member', day: d })} />;
          })}
        </View>
      </View>
      {!daily ? <Field label="Note (optional)"><Input size="sheet" value={note} onChangeText={setNote} maxLength={300} placeholder="Anything worth remembering" /></Field> : null}
    </> : <T v="body" color={fx.ink.a60}>Pick what you want to log.</T>}
    {error ? <T v="bodySm" color={fx.red.error} accessibilityRole="alert">{error}</T> : null}
    <Button title="Save" shape="flow" commit busy={busy} disabled={!m || value.trim() === '' || bad} onPress={save} />
  </View>;
}

const styles = StyleSheet.create({
  gap: { gap: 18 },
  gapSm: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  days: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
