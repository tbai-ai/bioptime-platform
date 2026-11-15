/* The kit gallery's sheets, morph, brand and media part (/__fx, development builds only; motion v2 PK4): the physical
   sheet (an item sheet that keeps its content all the way out, the rise over the skirt, a long sheet to pull from its
   content, the hand-over from one sheet to the next, the tall sheet the page recedes under at tier A, onExited), a
   card photo flying into a sheet's hero (openSheetWithMorph), the pull-to-dismiss photo overlay (MorphStage
   dismissible), the mark hand-off on the spring, and a photo mounting again without a second dissolve. Nothing here
   reads or writes member data; the words and photos are illustrations. */
import React, { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { fx } from '@/theme';
import { recordMarkHandoff, MarkHandoff } from '../brand/MarkHandoff';
import { MarkPaths } from '../brand/MarkPaths';
import { Button } from '../Button';
import { Photo } from '../media/Photo';
import { DismissArea, MorphContent, MorphHero, MorphSource, MorphStage, openWithMorph, useMorphClose } from '../motion/PhotoMorph';
import { openSheetWithMorph, Sheet } from '../Sheet';
import { Eyebrow, T } from '../Text';

const ITEMS = [
  { id: 'a', name: 'Resting heart rate', value: '58 bpm', note: 'Lower over the last four weeks.' },
  { id: 'b', name: 'Sleep', value: '7.4 hours', note: 'Steady across the week.' },
  { id: 'c', name: 'Steps', value: '8 210', note: 'Above the daily goal on five days.' },
];

function Part({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return <View style={styles.part}>
    <Eyebrow kind="brand">{title}</Eyebrow>
    {note ? <T v="bodySm" color={fx.ink.a60}>{note}</T> : null}
    {children}
  </View>;
}

function Row({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

/** Sheets: item-driven (M41), default and tall (M42, M50), long (M49), A → B (M48), onExited (K15). */
function Sheets() {
  const [item, setItem] = useState<(typeof ITEMS)[number] | null>(null);
  const [which, setWhich] = useState<'plain' | 'tall' | 'long' | 'a' | 'b' | null>(null);
  const [exits, setExits] = useState(0);
  return <>
    <Row>
      {ITEMS.map((it) => <Button key={it.id} title={it.name} variant="soft" small full={false} onPress={() => setItem(it)} />)}
    </Row>
    <Row>
      <Button title="Default sheet" variant="soft" small full={false} onPress={() => setWhich('plain')} />
      <Button title="Tall sheet" variant="soft" small full={false} onPress={() => setWhich('tall')} />
      <Button title="Long sheet" variant="soft" small full={false} onPress={() => setWhich('long')} />
      <Button title="Sheet A" variant="soft" small full={false} onPress={() => setWhich('a')} />
    </Row>
    <T v="micro" color={fx.ink.a50}>{`Sheets that have finished leaving: ${exits}`}</T>
    {/* the selected item turns null as the sheet closes; the sheet keeps showing it all the way out */}
    <Sheet visible={!!item} onClose={() => setItem(null)} onExited={() => setExits((n) => n + 1)} title={item?.name}>
      {item ? <View style={styles.sheetBody}>
        <T v="h1">{item.value}</T>
        <T v="body" color={fx.ink.a70}>{item.note}</T>
        <Button title="Done" onPress={() => setItem(null)} />
      </View> : null}
    </Sheet>
    <Sheet visible={which === 'plain'} onClose={() => setWhich(null)} onExited={() => setExits((n) => n + 1)} title="Log water">
      <View style={styles.sheetBody}>
        <T v="body" color={fx.ink.a70}>It rises from its own height over a 48 pt skirt; drag it down from the grabber or the title.</T>
        <Button title="Add 250 ml" onPress={() => setWhich(null)} />
      </View>
    </Sheet>
    <Sheet visible={which === 'tall'} onClose={() => setWhich(null)} onExited={() => setExits((n) => n + 1)} tall closeButton title="Core programme"
      hero={<Photo slot="store.package.sheet.0" tint="programme" style={styles.sheetHero} radius={16} />}>
      <View style={styles.sheetBody}>
        <T v="body" color={fx.ink.a70}>At tier A the page behind recedes while this sheet is open, following its drag.</T>
        {Array.from({ length: 6 }, (_, i) => <T key={i} v="bodySm" color={fx.ink.a60}>{`Included ${i + 1}`}</T>)}
      </View>
    </Sheet>
    <Sheet visible={which === 'long'} onClose={() => setWhich(null)} onExited={() => setExits((n) => n + 1)} tall title="Everything included">
      <View style={styles.sheetBody}>
        <T v="body" color={fx.ink.a70}>Scrolled to its top, a pull down on the content drags the sheet.</T>
        {Array.from({ length: 40 }, (_, i) => <T key={i} v="bodySm" color={fx.ink.a60}>{`Line ${i + 1}`}</T>)}
      </View>
    </Sheet>
    <Sheet visible={which === 'a'} onClose={() => setWhich(null)} title="Sheet A">
      <View style={styles.sheetBody}>
        <T v="body" color={fx.ink.a70}>Opening the next sheet hands the scrim over: it stays up while the panels swap.</T>
        <Button title="See the trend" onPress={() => setWhich('b')} />
      </View>
    </Sheet>
    <Sheet visible={which === 'b'} onClose={() => setWhich(null)} onExited={() => setExits((n) => n + 1)} tall title="Sheet B">
      <View style={styles.sheetBody}>
        <T v="body" color={fx.ink.a70}>The second sheet rises on the tall spring from 40 % of its height.</T>
        {Array.from({ length: 8 }, (_, i) => <T key={i} v="bodySm" color={fx.ink.a60}>{`Week ${i + 1}`}</T>)}
      </View>
    </Sheet>
  </>;
}

/** A card photo into a sheet's hero and back (M51). */
function SheetMorph() {
  const [open, setOpen] = useState(false);
  return <>
    <View style={styles.cardRow}>
      <MorphSource morphKey="fx-sheet-card" radius={fx.radius.card} style={styles.card}>
        <Photo slot="store.package.sheet.0" style={StyleSheet.absoluteFill} decorative />
      </MorphSource>
      <View style={styles.flex}>
        <T v="cardTitle">Package card</T>
        <T v="bodySm" color={fx.ink.a60}>Its photo flies into the sheet.</T>
      </View>
      <Button title="Open" variant="soft" small full={false} onPress={() => openSheetWithMorph('fx-sheet-card', () => setOpen(true))} />
    </View>
    <Sheet visible={open} onClose={() => setOpen(false)} tall closeButton title="Core programme"
      hero={<Photo slot="store.package.sheet.0" style={styles.sheetHero} decorative />}>
      <View style={styles.sheetBody}>
        <T v="body" color={fx.ink.a70}>The content enters once the photo is on its way; closing flies it back to the card.</T>
      </View>
    </Sheet>
  </>;
}

function Dismissible({ onClosed }: { onClosed: () => void }) {
  const close = useMorphClose('fx-sheets-dismiss');
  return <View style={styles.flex}>
    <MorphHero style={styles.overlayHero}><Photo slot="set.session.strength" pick="fx" style={StyleSheet.absoluteFill} decorative /></MorphHero>
    <DismissArea style={styles.flex}>
      <MorphContent style={styles.overlayBody}>
        <T v="h1">Pull the photo down</T>
        <T v="body" color={fx.ink.a70}>Past 120 pt (or a quick flick) it flies back to its card; short of that it springs back.</T>
        <Button title="Close" variant="soft" small full={false} onPress={() => close(onClosed)} />
      </MorphContent>
    </DismissArea>
  </View>;
}

/** The pull-to-dismiss photo overlay (M47). */
function DismissDemo() {
  const [open, setOpen] = useState(false);
  return <View style={styles.overlayFrame}>
    <View style={styles.cardRow}>
      <MorphSource morphKey="fx-sheets-dismiss" radius={12} style={styles.thumb}>
        <Photo slot="set.session.strength" pick="fx" style={StyleSheet.absoluteFill} decorative />
      </MorphSource>
      <View style={styles.flex}><T v="cardTitle">Workout row</T><T v="bodySm" color={fx.ink.a60}>Opens a dismissible overlay.</T></View>
      <Button title="Open" variant="soft" small full={false} disabled={open} onPress={() => openWithMorph('fx-sheets-dismiss', () => setOpen(true))} />
    </View>
    {open ? <View style={StyleSheet.absoluteFill}>
      <MorphStage morphKey="fx-sheets-dismiss" dismissible onDismiss={() => setOpen(false)}><Dismissible onClosed={() => setOpen(false)} /></MorphStage>
    </View> : null}
  </View>;
}

/** The mark's flight on spring.mark: straight, and the arc when it travels sideways (M46). */
function MarkFlight() {
  const from = useRef<React.ComponentRef<typeof View>>(null);
  const [n, setN] = useState(0);
  const play = () => {
    from.current?.measureInWindow((x: number, y: number, w: number, h: number) => { recordMarkHandoff({ x, y, w, h }, 'home', 'splash'); setN((v) => v + 1); });
  };
  return <View style={styles.markRow}>
    <View ref={from} collapsable={false} style={styles.markFrom}><MarkPaths width={64} /></View>
    <View style={styles.markRing}>
      <MarkHandoff key={n} target="home"><MarkPaths width={24} /></MarkHandoff>
    </View>
    <Button title="Fly" variant="soft" small full={false} onPress={play} />
  </View>;
}

/** A photo unmounted and mounted again draws on its first frame (C09). */
function Remount() {
  const [on, setOn] = useState(true);
  return <View style={styles.cardRow}>
    <View style={styles.thumb} testID="fx-remount-thumb">{on ? <Photo slot="home.hero.morning" style={StyleSheet.absoluteFill} decorative /> : null}</View>
    <Button title={on ? 'Unmount' : 'Mount again'} variant="soft" small full={false} onPress={() => setOn((v) => !v)} />
  </View>;
}

export function SheetsGallery(): React.JSX.Element {
  return <View style={styles.root}>
    <Part title="Sheets" note="They keep their content all the way out, rise from their own height and leave with the finger's speed.">
      <Sheets />
    </Part>
    <Part title="Card photo into a sheet" note="openSheetWithMorph: the photo travels while the panel rises.">
      <SheetMorph />
    </Part>
    <Part title="Pull to dismiss" note="MorphStage dismissible with a DismissArea.">
      <DismissDemo />
    </Part>
    <Part title="The mark's flight" note="spring.mark, critically damped; it lifts first, then slides.">
      <MarkFlight />
    </Part>
    <Part title="Photos dissolve once" note="Mounted again, a decoded photo shows on its first frame.">
      <Remount />
    </Part>
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 24 },
  part: { gap: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  flex: { flex: 1 },
  sheetBody: { gap: 12, paddingTop: 4 },
  sheetHero: { height: 180 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  card: { width: 96, height: 72, borderRadius: fx.radius.card, overflow: 'hidden' },
  thumb: { width: 64, height: 64, borderRadius: 12, overflow: 'hidden', backgroundColor: fx.bg.card },
  overlayFrame: { height: 420, borderRadius: fx.radius.card, overflow: 'hidden', borderWidth: 1, borderColor: fx.line.a10, padding: 12 },
  overlayHero: { width: '100%', height: 200, backgroundColor: fx.bg.deep },
  overlayBody: { padding: 16, gap: 12 },
  markRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  markFrom: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center', borderRadius: 16, borderWidth: 1, borderColor: fx.line.a10 },
  markRing: { width: 38, height: 38, borderRadius: 19, backgroundColor: fx.bg.panelSolid, alignItems: 'center', justifyContent: 'center' },
});
