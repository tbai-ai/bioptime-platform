/* A test in the catalogue, in the earlier app's "Specialized Tests" card (shots 63-s1, s2): a 160 pt photo at .6 under
   the test-card fade, dark tag chips on it, the name (16/600) with the marker count in mono on the right (under it
   when the name's words would not fit beside it), the catalogue's line, when results come and whether to fast, and
   the outlined "Book this test" while the package has a test left. The photo is the API's image when the test has one, else an abstract or people-free slot photo by
   position (no laboratory, syringe or medical-staff imagery). No price: tests are booked against the package.
   On native the card is flat (RowTilt: the page's featured card holds the device tilt). Fix r2: the photo band is drawn
   directly again on Android (one image, a gradient and the tags, all under a plain translation); its own texture
   (fix r1) was re-made each time the card scrolled back into view and pushed photos out of the GPU's cache. */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, fx, GlassCard, Icon, motionValues, PhotoTag, RemotePhoto, Scrim, T } from '@/fx';
import { Beside, FitText } from '../bio/wordFit';
import { keepShort } from '@/fx/wordFit';
import { RowTilt } from './RowTilt';

import { fastingText, markersText, testChips, testLine, type LabTest } from './model';

export function CatalogueCard({ test, index, canBook, onBook }: { test: LabTest; index: number; canBook: boolean; onBook: () => void }) {
  const chips = testChips(test);
  const markers = markersText(test.markers);
  const line = testLine(test);
  return <RowTilt intensity={motionValues.tilt.row} radius={fx.radius.three}><GlassCard variant="three" clip padding={0} borderColor={fx.line.a08}>
    <View style={styles.photo}>
      <RemotePhoto uri={test.imageUrl} fallbackSlot={`tests.catalogue.card.${index}`} opacity={0.6} decorative style={StyleSheet.absoluteFill} />
      <Scrim kind="diagnostics" opacity={0.9} style={StyleSheet.absoluteFill} />
      <View style={styles.tags}>{chips.map((c) => <PhotoTag key={c}>{c}</PhotoTag>)}</View>
    </View>
    <View style={styles.body}>
      {/* the marker count sits beside the name while the name's longest word, and a short word with the word beside
          it, fit whole beside it, else under it (measured: Beside; never 'Vitamin / D / (25-OH)' at 320 dp and text
          2.0: VA-5) */}
      <Beside words={[{ text: keepShort(test.name), v: 'cardTitle', style: styles.nameType, pairs: true }]} align="flex-start" underGap={2}
        side={markers ? <T v="mono14" color={fx.ink.a60} style={styles.markers}>{markers}</T> : null}>
        <FitText v="cardTitle" style={styles.nameType}>{keepShort(test.name)}</FitText>
      </Beside>
      {line ? <T v="body" color={fx.ink.a80}>{line}</T> : null}
      <View style={styles.meta}>
        <View style={styles.metaItem}><Icon name="clock" size={12} color={fx.ink.a50} /><T v="caption" color={fx.ink.a60}>{`Results in ${test.turnaround}`}</T></View>
        <View style={styles.metaItem}><Icon name="droplet" size={12} color={fx.ink.a50} /><T v="caption" color={fx.ink.a60}>{fastingText(test)}</T></View>
      </View>
      {canBook ? <Button title="Book this test" variant="soft" icon="file-text" iconRight={null} onPress={onBook} label={`Book ${test.name}`} style={styles.cta} /> : null}
    </View>
  </GlassCard></RowTilt>;
}

const styles = StyleSheet.create({
  photo: { height: 160, justifyContent: 'flex-end', backgroundColor: fx.bg.panel },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 16 },
  body: { paddingHorizontal: 20, paddingBottom: 20, paddingTop: 16, gap: 10 },
  // the name takes the row's free width beside the count; its type shrinks just enough for its longest word to fit
  // (FitText)
  nameType: { fontSize: 17, lineHeight: 24 },
  markers: { paddingTop: 2 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 4 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  cta: { marginTop: 6, minHeight: 48, borderRadius: fx.radius.card },
});
