/* The progress gallery (the earlier app's 2fr / 1fr grid, THEME §10; progress + progressPhotos on): the member's own
   private photos, newest first, through five-minute links. Never a stock photo here. "Add" opens a small sheet to
   choose the pose and pick a photo (the photo consent first, on the Progress photos screen, when it is not given);
   "See all" opens that screen. With no photo yet: the dashed empty state "Add your first progress photo". */
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Button, EmptyState, FilterChip, fx, Scrim, Sheet, T, toast } from '@/fx';
import { errorText } from '@/lib/api';
import { fmtDate, label } from '@/lib/format';
import { PrivatePhoto } from './PrivatePhoto';
import { pickAndUploadPhoto, POSES, type Pose } from './photoUpload';
import type { PhotosData, ProgressPhoto } from './data';

function Tile({ p, big, refreshed, onPress }: { p: ProgressPhoto; big?: boolean; refreshed: unknown; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${label(p.pose)} photo, ${fmtDate(p.takenAt)}. Opens your progress photos`} onPress={onPress} style={[styles.tile, big ? styles.big : styles.small]}>
    <PrivatePhoto fileId={p.fileId} refreshed={refreshed} style={StyleSheet.absoluteFill} label={`${label(p.pose)} progress photo`} />
    {big ? <>
      <Scrim kind="gallery" style={styles.scrim} />
      <T v="eyebrowStore" style={styles.caption}>{`${label(p.pose)} · ${fmtDate(p.takenAt)}`}</T>
    </> : null}
  </Pressable>;
}

export function Gallery({ data, onChanged, onOpenAll }: { data: PhotosData; onChanged: () => void; onOpenAll: () => void }) {
  const [adding, setAdding] = useState(false);
  const [pose, setPose] = useState<Pose>('front');
  const [busy, setBusy] = useState(false);
  const items = data.items;
  const canAdd = data.photosEnabled && data.consent.granted;
  const add = () => { if (!canAdd) { onOpenAll(); return; } setAdding(true); };
  const pick = async () => {
    setBusy(true);
    try {
      const ok = await pickAndUploadPhoto(pose, data.maxBytes);
      if (ok) { toast.logged('Photo added'); setAdding(false); onChanged(); }
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  };
  return <View>
    {items.length ? <View style={styles.grid}>
      <Tile p={items[0]} big refreshed={data} onPress={onOpenAll} />
      {items.length > 1 ? <View style={styles.col}>
        <Tile p={items[1]} refreshed={data} onPress={onOpenAll} />
        {items[2] ? <Tile p={items[2]} refreshed={data} onPress={onOpenAll} /> : <Pressable accessibilityRole="button" accessibilityLabel="Add a progress photo" onPress={add} style={[styles.tile, styles.small, styles.addTile]}>
          <T v="chip" color={fx.ink.a60}>Add</T>
        </Pressable>}
      </View> : null}
    </View> : <EmptyState dashed icon="images" title="Add your first progress photo" body="Private by default. Your coach sees a photo only if you share it." action={{ title: canAdd ? 'Add a photo' : 'Set up photos', onPress: add, icon: 'plus' }} />}
    <Sheet visible={adding} onClose={() => setAdding(false)} title="Add a progress photo">
      <T v="body" color={fx.ink.a70} style={styles.sheetText}>Which pose is it? The photo stays private until you share it with your coach.</T>
      <View style={styles.poses}>{POSES.map((p) => <FilterChip key={p.value} label={p.label} selected={pose === p.value} onPress={() => setPose(p.value)} />)}</View>
      <Button title="Choose a photo" icon="images" busy={busy} commit onPress={() => { void pick(); }} />
    </Sheet>
  </View>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', gap: 12, height: 204 },
  col: { flex: 1, gap: 12 },
  tile: { borderRadius: fx.radius.card, overflow: 'hidden', backgroundColor: fx.bg.card },
  big: { flex: 2 },
  small: { flex: 1 },
  addTile: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: fx.line.a20 },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '50%' },
  caption: { position: 'absolute', left: 14, bottom: 12, right: 14 },
  sheetText: { marginBottom: 16 },
  poses: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
});
