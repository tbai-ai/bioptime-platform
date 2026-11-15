/* The package sheet (the earlier app's programme sheet, shots 82-store-program-detail*, r360-13, r820-13): a 208 pt photo
   inset 16 with radius 16 and the round close button on it, the level pill, the name in Bebas 30 and the price on the
   right, then the full description, "At a glance" (the trust-tile row, filled with the version's own duration,
   consultations and blood tests instead of the earlier app's refund and community promises), "Included" (rows sliding in
   from the left), the services the version lists, and how it starts and who may buy it. No stars, reviews, student
   counts or week breakdowns: the catalogue has none. The CTA is pinned under the scroll: "Buy · ₹…" (the card's own words) in the card
   colour, or "Enrolled · Open my plan". Rendered by the Store screen inside <Sheet tall>; the photo is the sheet's
   `hero` (PackageSheetHero), so View details can fly the card's photo into it (M83), and the glance tiles and the
   included rows cascade in from 160 ms. */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { COLUMN, Eyebrow, fx, Icon, IconButton, Reveal, Scrim, T, type IconName } from '@/fx';
import { motionValues } from '@/fx/motion/tokens';
import { FONTS } from '@/fx/type';
import { Beside, FitText, WordMeasure } from '@/fx/wordFit';
import { buyColours, colourFor, compareAt, ELIGIBILITY, metaFor, plural, rupees, spokenPrice, START_POLICY, tagline, type Package } from './data';
import { BuyButton, CardPhoto, EnrolledBadge, EnrolledCta, LevelPill } from './PackageCard';

const S = motionValues.screens.m83;

/** The sheet's photo (208 pt, 16 in from the panel's sides, radius 16) with the ENROLLED badge and the close button:
 *  the target of the card photo's flight. */
/** A glance tile's least width; how far its caption may shrink before the tiles go two over one; its side padding and
 *  border. */
const TILE_MIN = 64, TILE_FIT = 0.8, TILE_PAD = 8 + 8 + 2, TILE_GAP = 10;

export function PackageSheetHero({ p, index, enrolled, onClose }: { p: Package; index: number; enrolled: boolean; onClose: () => void }) {
  const col = colourFor(p, index);
  return <View style={styles.heroWrap}>
    <View style={styles.hero}>
      <CardPhoto p={p} index={index} slot={`store.package.sheet.${index}`} dim={col.dim} />
      <Scrim kind="programme" style={StyleSheet.absoluteFill} />
      <View style={styles.heroTop}>
        <View>{enrolled ? <EnrolledBadge /> : null}</View>
        <IconButton icon="x" label="Close" kind="glass" size={32} iconSize={16} onPress={onClose} />
      </View>
    </View>
  </View>;
}

export function PackageSheetBody({ p, index, enrolled }: { p: Package; index: number; enrolled: boolean; onClose?: () => void }) {
  const v = p.version;
  const col = colourFor(p, index);
  const was = compareAt(v);
  const price = v?.forSale ? v.priceInr : null;
  const includes = (v?.includes ?? []).filter((s) => s && s.trim());
  const services = (v?.services ?? []).filter((s) => s && s.name);
  const line = tagline(p.description);
  const rest = p.description && p.description.trim() !== line && p.description.trim() !== `${line}.` ? p.description.trim() : '';
  const glance = glanceTiles(p);
  // the tiles keep three in a row while each has the room its captions' longest word needs (as drawn now, shrunk by
  // FitText at most to TILE_FIT), else two a row (two over one: a 320 dp phone at a large text size), each row its own
  // (a wrapping row left the third tile over the section under it on Android): '3 consultati/ons', SWB-05
  const [word, setWord] = useState(0);
  const [tilesW, setTilesW] = useState(0);
  const tileMin = Math.max(TILE_MIN, Math.ceil(word * TILE_FIT) + TILE_PAD);
  const perRow = tilesW && glance.length * tileMin + (glance.length - 1) * TILE_GAP > tilesW ? 2 : glance.length;
  const rows = Array.from({ length: Math.ceil(glance.length / Math.max(1, perRow)) }, (_, r) => glance.slice(r * perRow, r * perRow + perRow));
  return <View testID="store-sheet" style={styles.column}>
    {/* the price sits beside the name and the line under it while their longest word fits whole beside it, else
        under them (measured: Beside; 'consult/ation' at text 2.0, SWB-17) */}
    <Beside words={[{ text: p.name, v: 'h1' }, line ? { text: line, v: 'body', style: styles.tagline } : null]} align="flex-start" underGap={12} style={styles.head}
      side={<View style={styles.priceBox} accessible accessibilityLabel={price != null ? `${spokenPrice(price)}${was ? `, was ${spokenPrice(was)}` : ''}, including GST` : 'Price on request'}>
        {was ? <T v="mono12" color={fx.ink.a50} style={styles.strike}>{rupees(was)}</T> : null}
        <T v="metric24" style={styles.price}>{price != null ? rupees(price) : 'On request'}</T>
        {price != null ? <T v="caption" color={fx.ink.a50}>incl. GST</T> : null}
      </View>}>
      {v?.level ? <View style={styles.level}><LevelPill level={v.level} colour={col} /></View> : null}
      <T v="h1">{p.name}</T>
      {line ? <T v="body" color={fx.ink.a80} style={styles.tagline}>{line}</T> : null}
    </Beside>

    <View style={styles.rule} />

    {rest ? <T v="body" color={fx.ink.a80} style={styles.description}>{rest}</T> : null}

    {glance.length ? <View style={styles.section}>
      <Eyebrow kind="label" style={styles.label}>At a glance</Eyebrow>
      <View style={styles.tileRows} onLayout={(e) => { const w = Math.floor(e.nativeEvent.layout.width); setTilesW((o) => (o === w ? o : w)); }}>
        <WordMeasure text={glance.map((g) => g.text).join(' ')} v="caption" style={styles.tileText} onWord={(w) => setWord((o) => (o === w.width ? o : w.width))} />
        {rows.map((row, r) => <View key={r} style={styles.tiles}>{row.map((g, j) => <Reveal key={g.text} mount index={r * perRow + j} delay={S.cascadeAt} from="scale" style={styles.tileWrap}>
          <View style={styles.tile} accessible accessibilityLabel={g.text}>
            <Icon name={g.icon} size={18} color={col.c} />
            {/* the caption's longest word shrinks just enough to stay whole in its tile ('3 consultati/ons', SWB-05) */}
            <FitText v="caption" color={fx.ink.a80} center style={styles.tileText}>{g.text}</FitText>
          </View>
        </Reveal>)}</View>)}
      </View>
    </View> : null}

    {includes.length ? <View style={styles.section}>
      <Eyebrow kind="label" style={styles.label}>Included</Eyebrow>
      <View style={styles.rows}>
        {includes.map((s, i) => <Reveal key={s} mount from="left" distance={10} index={i} delay={S.cascadeAt}>
          <View style={styles.row}>
            <View style={[styles.tick, { backgroundColor: col.dim }]}><Icon name="check" size={12} color={col.c} stroke={2.5} /></View>
            <T v="body" color={fx.ink.a90} style={styles.flex}>{s}</T>
          </View>
        </Reveal>)}
      </View>
    </View> : null}

    {services.length ? <View style={styles.section}>
      <Eyebrow kind="label" style={styles.label}>Services</Eyebrow>
      <View style={styles.rows}>
        {services.map((s) => <View key={s.name} style={styles.row}>
          <View style={[styles.tick, { backgroundColor: col.dim }]}><Icon name="sparkle" size={12} color={col.c} /></View>
          <View style={styles.flex}>
            <T v="body" color={fx.ink.a90}>{s.name}</T>
            {s.detail ? <T v="bodySm" color={fx.ink.a60}>{s.detail}</T> : null}
          </View>
        </View>)}
      </View>
    </View> : null}

    <View style={styles.section}>
      <Eyebrow kind="label" style={styles.label}>How it starts</Eyebrow>
      <View style={styles.rows}>
        <Fact icon="calendar-check" text={START_POLICY[v?.startPolicy ?? 'on_payment'] ?? START_POLICY.on_payment} />
        {v?.eligibility && ELIGIBILITY[v.eligibility] ? <Fact icon="users" text={ELIGIBILITY[v.eligibility]} /> : null}
        <Fact icon="messages-square" text="Bioptime matches you with a coach after the payment is confirmed and tells you here." />
      </View>
    </View>
  </View>;
}

/** The pinned CTA under the sheet's scroll. */
export function PackageSheetFooter({ p, index, enrolled, onBuy, onOpenPlan }: { p: Package; index: number; enrolled: boolean; onBuy: () => void; onOpenPlan: () => void }) {
  const v = p.version;
  const price = v?.forSale ? v.priceInr : null;
  const buy = buyColours(colourFor(p, index).c);
  return <View style={styles.column}>
    {enrolled ? <EnrolledCta onPress={onOpenPlan} />
      : price == null ? <T v="bodySm" color={fx.ink.a60} center>This package has no price yet. Pricing is on request.</T>
        : <BuyButton title={`Buy · ${rupees(price)}`} label={`Buy ${p.name}, ${spokenPrice(price)}`} icon="shopping-bag" color={buy.fill} labelColor={buy.ink} shape="flow" commit onPress={onBuy} />}
  </View>;
}

function glanceTiles(p: Package): Array<{ icon: IconName; text: string }> {
  const v = p.version;
  if (!v) return [];
  const tiles = metaFor(v);
  if (v.bloodworkEntitlements && v.entitlementUnit === 'collection') {
    const last = tiles.find((t) => t.icon === 'test-tube');
    if (last) last.text = `${plural(v.bloodworkEntitlements, 'blood test', 'blood tests')} at home`;
  }
  return tiles;
}

function Fact({ icon, text }: { icon: IconName; text: string }) {
  return <View style={styles.row}>
    <View style={styles.factIcon}><Icon name={icon} size={14} color={fx.ink.a70} /></View>
    <T v="bodySm" color={fx.ink.a80} style={styles.flex}>{text}</T>
  </View>;
}

const styles = StyleSheet.create({
  column: { width: '100%', maxWidth: COLUMN, alignSelf: 'center' },
  heroWrap: { width: '100%', maxWidth: COLUMN, alignSelf: 'center', paddingHorizontal: 16 },
  hero: { height: 208, borderRadius: fx.radius.card, overflow: 'hidden', backgroundColor: fx.bg.panel },
  heroTop: { position: 'absolute', top: 12, left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  head: { marginTop: 20 },
  level: { marginBottom: 10 },
  tagline: { marginTop: 6 },
  priceBox: { alignItems: 'flex-end', paddingTop: 2 },
  strike: { textDecorationLine: 'line-through' },
  price: { fontFamily: FONTS.mono500, fontSize: 26, lineHeight: 32 },
  rule: { height: 1, backgroundColor: fx.line.a05, marginTop: 20 },
  description: { fontSize: 15, lineHeight: 24, marginTop: 20 },
  section: { marginTop: 24 },
  label: { marginBottom: 12, color: fx.ink.a50 },
  tileRows: { gap: TILE_GAP },
  tiles: { flexDirection: 'row', gap: TILE_GAP },
  tileWrap: { flex: 1 },
  tile: { flex: 1, alignItems: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 8, borderRadius: fx.radius.xl, borderWidth: 1, borderColor: fx.line.a10, backgroundColor: fx.fill.a03 },
  tileText: { fontSize: 12 },
  rows: { gap: 12 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  tick: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: -1 },
  factIcon: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: fx.fill.a05, marginTop: -2 },
  flex: { flex: 1 },
});
