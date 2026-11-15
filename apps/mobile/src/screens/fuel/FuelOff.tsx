/* Fuel while the nutrition module is off for this member (BUILD §11.3): the earlier app's empty state with what can
   still be done, which is the plan's own nutrition tasks of this week (GET /me/tasks, kind nutrition), each marked done
   or back to pending with a tap (PATCH /me/tasks/:id). Nothing else from the meal plan or the meal log is drawn. */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CheckBox, EmptyState, GlassCard, Pill, T, fx, haptics, toast } from '@/fx';
import { api, errorText, get, qs } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { shiftDate } from './format';
import type { PlanTask } from './types';

export function FuelOff({ today }: { today: string }) {
  const tasks = useLoad<{ items: PlanTask[] }>('fuel.tasks', () => get(`/me/tasks${qs({ from: shiftDate(today, -6), to: shiftDate(today, 7) })}`), [today]);
  const [busy, setBusy] = useState<string | null>(null);
  const list = (tasks.data?.items ?? []).filter((t) => t.kind === 'nutrition');
  const toggle = async (t: PlanTask) => {
    setBusy(t.id);
    try { await api('PATCH', `/me/tasks/${t.id}`, { status: t.status === 'done' ? 'pending' : 'done' }); haptics.light(); await tasks.reload(); }
    catch (e) { toast.error(errorText(e)); } finally { setBusy(null); }
  };
  return <View style={styles.wrap}>
    <EmptyState icon="leaf" title="Meal plans are not in your programme now" body={list.length ? 'Your plan’s nutrition tasks for this week are below.' : 'When your coach adds meal plans, they appear here.'} />
    {list.map((t) => <GlassCard key={t.id} padding={16} onPress={() => toggle(t)} label={`${t.title}, due ${fmtDate(t.due_at)}, ${t.status}`} hint={t.status === 'done' ? 'Marks it as not done' : 'Marks it as done'}>
      <View style={styles.row}>
        <CheckBox checked={t.status === 'done'} />
        <View style={styles.flex}>
          <T v="section">{t.title}</T>
          <T v="caption" color={fx.ink.a55}>{`Due ${fmtDate(t.due_at)}`}</T>
        </View>
        {busy === t.id ? null : <Pill tone={t.status === 'done' ? 'success' : t.status === 'skipped' ? 'info' : 'warning'}>{t.status === 'done' ? 'Done' : t.status === 'skipped' ? 'Skipped' : 'To do'}</Pill>}
      </View>
    </GlassCard>)}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1, gap: 2 },
});
