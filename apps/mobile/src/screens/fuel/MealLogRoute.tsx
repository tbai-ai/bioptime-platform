/* The meal-log route's body: the sheet panel inside the route with the Fuel tab's meal form. It loads GET /me/nutrition
   (the plan's meals of the chosen day and today's logs), saves, shows the bottom toast and goes back; a swap that wants
   a dish from the library opens Fuel › Search instead. With the nutrition module off it says so and offers nothing to
   log. */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { EmptyState, ErrorState, RingSpinner, SheetScreen, toast } from '@/fx';
import { get } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { MealLogForm } from './MealLogForm';
import type { Nutrition, Outcome } from './types';

const OUTCOMES: Outcome[] = ['as_planned', 'swapped', 'skipped', 'extra'];

export default function MealLogRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ slotId?: string; outcome?: string }>();
  const n = useLoad<Nutrition>('nutrition', () => get<Nutrition>('/me/nutrition'), []);
  const back = () => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)/fuel'); };
  const outcome = OUTCOMES.includes(params.outcome as Outcome) ? (params.outcome as Outcome) : undefined;
  const off = n.error?.code === 'FEATURE_DISABLED';
  return <SheetScreen onClose={back}>
    {n.data ? <MealLogForm n={n.data} initial={{ slotId: params.slotId, outcome }}
      onSaved={(_l, label) => { toast.logged(`${label} logged`); back(); }}
      onPickDish={(slot) => router.replace({ pathname: '/(tabs)/fuel', params: { segment: 'search', swap: slot.id } })} />
      : off ? <EmptyState icon="leaf" title="Meal logging is not part of your programme right now" />
        : n.error ? <ErrorState error={n.error} onRetry={n.reload} />
          : <View style={styles.wait}><RingSpinner label="Loading" /></View>}
  </SheetScreen>;
}

const styles = StyleSheet.create({ wait: { paddingVertical: 48, alignItems: 'center' } });
