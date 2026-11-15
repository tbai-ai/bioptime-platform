/* The kit gallery's motion hub (/__fx, development builds only): the four motion v2 sections, each owned by the package
   that builds it, in this order: the motion core (CoreGallery), controls and feedback (ControlsGallery), navigation
   and overlays (NavGallery), sheets, morph, brand and media (SheetsGallery). The tier line says which motion tier this
   device runs (A, B or C) and whether reduced motion is on, in which case every part shows its rest state; "Replay"
   mounts the four again so their entrances run once more. Nothing here reads or writes member data. */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { fx } from '@/theme';
import { Button } from '../Button';
import { useMotion } from '../motion/tier';
import { Eyebrow, T } from '../Text';
import { ControlsGallery } from './ControlsGallery';
import { CoreGallery } from './CoreGallery';
import { NavGallery } from './NavGallery';
import { SheetsGallery } from './SheetsGallery';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={styles.section}>
    <Eyebrow kind="brand">{title}</Eyebrow>
    {children}
  </View>;
}

export function MotionGallery() {
  const m = useMotion();
  const [round, setRound] = useState(0);
  return <View style={styles.wrap}>
    <View style={styles.head}>
      <T v="micro" color={fx.ink.a60} style={styles.flex}>{`Tier ${m.tier}${m.calm ? ' · reduced motion' : ''}${m.lite ? ' · lite' : ''}`}</T>
      <Button title="Replay" variant="soft" icon="rotate-ccw" full={false} onPress={() => setRound((r) => r + 1)} />
    </View>
    <View key={round}>
      <Section title="Motion core"><CoreGallery /></Section>
      <Section title="Controls and feedback"><ControlsGallery /></Section>
      <Section title="Navigation and overlays"><NavGallery /></Section>
      <Section title="Sheets, morph, brand and media"><SheetsGallery /></Section>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 12 },
  section: { gap: 12, paddingTop: 12, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: fx.line.a05 },
  flex: { flex: 1 },
});
