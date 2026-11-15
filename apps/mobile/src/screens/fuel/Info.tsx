/* Small sheet bodies of the Fuel tab: how today's totals are counted (the API's own note and the sources of the values
   counted), where a dish's values come from, and a meal's own photo (a private file opened through a five-minute link,
   which can be removed). */
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Notice, RemotePhoto, RingSpinner, T, fx } from '@/fx';
import { errorText } from '@/lib/api';
import { mealPhotoUrl } from './photo';
import type { MealLog, Totals } from './types';

export function CountedInfo({ totals }: { totals: Totals | null | undefined }) {
  return <View style={styles.wrap}>
    <T v="body">{totals?.note ?? 'Only values entered with their source are added up: a planned meal logged as planned counts its planned food or recipe, and a dish picked from the library counts one serving times the portion. Nothing is estimated.'}</T>
    {totals?.sources.length ? <View style={styles.group}>
      <T v="label">Where today’s values come from</T>
      {totals.sources.map((s) => <T key={s} v="bodySm" color={fx.ink.a70}>{`• ${s}`}</T>)}
    </View> : null}
  </View>;
}

export function SourceInfo({ name, sources }: { name: string; sources: string[] }) {
  return <View style={styles.wrap}>
    <T v="bodySm" color={fx.ink.a70}>{`The values shown for ${name} are per serving, as the Bioptime team or a coach entered them. A value no one entered is left empty: nothing is estimated.`}</T>
    {/* each source in the paragraph's own style, as a sentence (SMA-4) */}
    {sources.map((s) => <T key={s} v="bodySm" color={fx.ink.a70}>{/[.!?]$/.test(s.trim()) ? s : `${s.trim()}.`}</T>)}
  </View>;
}

export function PhotoView({ log, onRemove, removing }: { log: MealLog; onRemove: () => void; removing: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!log.photoFileId) return;
    mealPhotoUrl(log.photoFileId).then((u) => { if (alive) setUrl(u); }, (e) => { if (alive) setError(errorText(e)); });
    return () => { alive = false; };
  }, [log.photoFileId]);
  return <View style={styles.wrap}>
    <View style={styles.frame}>
      {url ? <RemotePhoto uri={url} alt={`Your photo of ${log.description}`} contentFit="contain" style={StyleSheet.absoluteFill} />
        : error ? null : <View style={styles.centre}><RingSpinner label="Opening the photo" /></View>}
    </View>
    {error ? <Notice kind="error">{error}</Notice> : <T v="caption" color={fx.ink.a55}>Stored privately with this meal. This view uses a link that works for five minutes. Nothing is calculated from it.</T>}
    <Button title="Remove the photo" variant="redGlass" icon="trash" busy={removing} onPress={onRemove} />
  </View>;
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  group: { gap: 6, marginTop: 4 },
  frame: { height: 300, borderRadius: fx.radius.card, overflow: 'hidden', backgroundColor: fx.bg.card, borderWidth: 1, borderColor: fx.line.a10 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
