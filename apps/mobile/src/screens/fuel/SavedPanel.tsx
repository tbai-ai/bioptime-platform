/* Saved (the earlier app's 58-fuel-saved): the dishes the member saved with the heart (GET /me/nutrition/favourites,
   still-published ones only, latest first) as the same dish cards; unsaving takes the card away. Empty: the heart empty
   state with "Browse dishes". Saved dishes are member data on the server, not on the device.
   Motion (v2, M78): an unsaved card fades out over 160 ms; native then closes the gap (300 ms expo), the web snaps it
   (a web layout transition scale-stretches the cards). */
import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { FadeOut, LinearTransition } from 'react-native-reanimated';
import { EmptyState, ErrorState, Reveal, Skeleton, ease, useFx } from '@/fx';
import { motionValues } from '@/fx/motion/tokens';
import { get } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { DishCard } from './DishCard';
import { dishKey } from './format';
import type { DishHandlers } from './SearchPanel';
import type { Dish, Favourites } from './types';

const S = motionValues.screens.m78;

export function SavedPanel({ handlers, onBrowse }: { handlers: DishHandlers; onBrowse: () => void }) {
  const { calm } = useFx();
  const layout = calm || Platform.OS === 'web' ? undefined : LinearTransition.duration(S.layoutMs).easing(ease.expo);
  const fav = useLoad<Favourites>('fuel.saved', () => get<Favourites>('/me/nutrition/favourites'), []);
  const { data, error, reload } = fav;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <View style={styles.wrap}>{[0, 1].map((i) => <Skeleton key={i} height={250} radius={16} />)}</View>;
  const items: Dish[] = [...data.recipes, ...data.foods].filter((d) => handlers.isSaved(d));
  if (!items.length) return <EmptyState icon="heart" title="No saved dishes yet" body="Tap the heart on a dish to keep it here." action={{ title: 'Browse dishes', onPress: onBrowse }} />;
  return <View style={styles.wrap}>
    {items.map((d, i) => <Animated.View key={dishKey(d)} layout={layout} exiting={calm ? undefined : FadeOut.duration(S.removeMs)}>
      <Reveal index={Math.min(i, 6)}>
        <DishCard dish={d} saved onOpen={() => handlers.open(d)} onToggleSave={() => handlers.toggleSave(d)} onSource={() => handlers.source(d)} />
      </Reveal>
    </Animated.View>)}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
});
