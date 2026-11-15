/* exercise/[id]: one exercise of the Bioptime library (GET /me/exercises/:id), opened from Train's library card with a
   PhotoMorph: the card's poster flies into the 16:9 area, which then plays the clip on a tap (poster first). Without a
   clip it shows the category's tile (never a photo) and says the exercise is described in text only. Under it the control strip, the category
   and equipment, and the Exercise Guide (Purpose, Muscles, Form, Safety). No logging here: sessions are logged from
   the coach's programme. Opened from a link before the exercise is known, the screen is shown once it has come (and
   its poster is drawn), at most morph.pictureCapMs later (MorphOverlay's first-frame hold). */
import { useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { ErrorState, MorphHero, P, RingSpinner, StaleBanner, fx } from '@/fx';
import { get } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { CLIP_NOTE, ClipControls, ClipHost, MediaPager, MetaChip, NO_CLIP, type Clip } from './player/Clip';
import { ExerciseGuide } from './player/ExerciseGuide';
import { MorphOverlay } from './player/MorphOverlay';
import { cap, categoryColor, categoryIcon, categoryLabel, exerciseMorphKey, hasClip, rememberedExercise, type Exercise } from './shared';

export default function ExerciseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const e = useLoad<Exercise>(`exercise.${id}`, () => get<Exercise>(`/me/exercises/${id}`), [id]);
  const d = e.data ?? rememberedExercise(id);
  const { width, height } = useWindowDimensions();
  const h = Math.min(Math.round((width * 9) / 16), Math.round(height * 0.42));
  // 16:9 at most, centred in a wide window (the player's rule, TAB-02)
  const mw = Math.min(width, Math.round((h * 16) / 9));
  const [clip, setClip] = useState<Clip>(NO_CLIP);
  const page = d ? { key: d.id, media: d.media, category: d.category, name: d.name } : null;
  const hero = <MorphHero style={{ width, height: h, backgroundColor: fx.bg.deep }}>
    {page ? <View style={[styles.media, { width: mw, left: (width - mw) / 2 }]}><MediaPager pages={[page]} index={0} onIndex={() => undefined} clip={clip} width={mw} height={h} /></View> : null}
  </MorphHero>;
  const meta = d ? [categoryLabel(d.category), ...(d.equipment ?? []).map(cap)].join(' · ') : undefined;
  return <>
    {d ? <ClipHost key={d.id} media={d.media} onClip={setClip} /> : null}
    <MorphOverlay morphKey={exerciseMorphKey(id)} fallback="/(tabs)/train" title={d?.name ?? 'Exercise'} subtitle={meta} hero={hero} waiting={!d && e.loading}>
      {d ? <ClipControls clip={clip} media={hasClip(d.media)} name={d.name}>
        <MetaChip icon={categoryIcon(d.category)} text={categoryLabel(d.category)} color={categoryColor(d.category)} />
        {(d.muscleGroups ?? []).length ? <MetaChip icon="users" text={`${d.muscleGroups!.length} muscle group${d.muscleGroups!.length === 1 ? '' : 's'}`} /> : null}
      </ClipControls> : null}
      <View style={styles.body}>
        <StaleBanner at={e.stale} />
        <ErrorState error={e.error} onRetry={e.reload} />
        {!d && e.loading ? <View style={styles.loading}><RingSpinner label="Loading the exercise" /></View> : null}
        {d ? <>
          <ExerciseGuide resetKey={d.id} content={{ description: d.description, equipment: d.equipment, muscleGroups: d.muscleGroups, instructions: d.instructions, safetyNotes: d.safetyNotes }} />
          {hasClip(d.media) ? <P muted small>{CLIP_NOTE}</P> : null}
          <P muted small>Your coach chooses the exercises in your programme and how many sets and reps you do.</P>
        </> : null}
      </View>
    </MorphOverlay>
  </>;
}

const styles = StyleSheet.create({
  media: { position: 'absolute', top: 0, bottom: 0 },
  body: { width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 20, gap: 20 },
  loading: { paddingVertical: 48, alignItems: 'center' },
});
