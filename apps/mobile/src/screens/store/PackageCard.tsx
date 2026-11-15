/* A package card (the earlier app's programme card, shots 80-store-programs*, 81, 83; THEME §11.4 "Programme card"):
   TiltCard 5, radius 24, a 176 pt photo by display order (store.package.card.N, the API's imageUrl wins) in the card's
   colour as a duotone under the programme scrim, the level pill top left (only when the version has a level), the
   promo label, and a green ENROLLED badge top right on the member's own package. Body: the name in Bebas 24, the
   description's first sentence, the price in mono on the right (a struck compare-at price only when the API sends one),
   the meta line (duration, consultations, blood tests: never a rating or an enrolment count), up to three ticks from the
   version's includes that the meta line does not already state (each entitlement once: T5-26), then "Buy · ₹…" in the card colour (its label at least 4.5:1 against the fill: black on the gold and
   the light blue, the brand red's pressed shade under white) and "View details". On the member's package the CTA becomes
   "Enrolled · Open my plan" (Train › Plan). The photo carries no caption and no member value (AMENDED §6).
   The photo is a MorphSource (M83): View details flies it into the package sheet's hero and back.
   Tilt (wave-2 fix r1): the first card is the Store's hero and keeps the TiltCard on every platform (on native its device
   tilt runs while it is on screen: HeroTilt); on native the later
   cards are flat (src/screens/tests/RowTilt: a device-driven tilt per card was a UI-thread commit per layer per frame)
   and their photo answers a touch with the card press of the ladder instead (scale .98 after the scroll delay).
   On Android the photo and its duotone are drawn into a texture of their own (CACHED_PHOTO), and at tiers A and B the whole
   card too (CACHED_CARD), so the recede and the tilt move one image. */
import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { AnimatedPressable, Button, fx, haptics, Icon, MorphSource, motionValues, Photo, RemotePhoto, Reveal, Scrim, T, TiltLayer, useFx, usePress } from '@/fx';
import { HeroTilt, RowTilt, ROW_TILT } from '@/screens/tests/RowTilt';
import { FONTS } from '@/fx/type';
import { Beside } from '@/fx/wordFit';
import { buyColours, colourFor, compareAt, levelIcon, metaFor, rupees, spokenPrice, tagline, type Package } from './data';

/** The kit's Button with the primary's label colour (`labelColor`: the label, its icon and the busy ring in black on a
 *  light programme colour, so "Buy · ₹12,999" reads at 9.4:1 on the gold; T3-04). */
export const BuyButton = Button as React.ComponentType<React.ComponentProps<typeof Button> & { labelColor?: string }>;

export const PHOTO_H = 176;

/** Android draws the duotone (a mixBlendMode 'color' layer) through two offscreen passes each time the card is drawn,
 *  which is every frame of a scroll: the photo and its tint are rendered once into a texture of their own instead
 *  (re-drawn only when the photo itself changes; the tilt layer moves the texture). */
const CACHED_PHOTO = Platform.OS === 'android';

/** Android, tiers A and B: the whole card is drawn once into a texture of its own as well. The Store's stack recedes each
 *  card as it passes under the compact bar (StackRecede: scale and opacity, and at tier A a perspective tip), and the
 *  hero tilts in 3D; under such a transform Skia cannot draw the card's rounded clips and blurred shadow analytically and
 *  rasterises a mask for each on the CPU and uploads it, on every frame (about a sixth of the RenderThread's time while
 *  scrolling the Store). With the texture only one image is drawn under the transform. Its outset shadow (black on the
 *  black page) is clipped to the card's box. Tier C does not recede, so it keeps no texture. */
const CACHED_CARD = Platform.OS === 'android';

/** The morph key of a package's card photo (its sheet's hero is the target). */
export const morphKeyFor = (p: Package) => `store.package.${p.slug}`;

export function PackageCard({ p, index, enrolled, onBuy, onDetails, onOpenPlan }: {
  p: Package; index: number; enrolled: boolean; onBuy: () => void; onDetails: () => void; onOpenPlan: () => void;
}) {
  const v = p.version;
  const col = colourFor(p, index);
  // the Buy label reads on every card colour (at least 4.5:1): see buyColours
  const buy = buyColours(col.c);
  const was = compareAt(v);
  const price = v?.forSale ? v.priceInr : null;
  const meta = metaFor(v);
  // each entitlement once: the meta line already counts the consultations and blood tests, so their include lines
  // ("1 coach consultation", "1 blood test with home collection") are left to the details sheet
  const highlights = (v?.includes ?? []).filter((s) => s && s.trim() && !statedInMeta(s, v)).slice(0, 3);
  const line = tagline(p.description);
  // the hero card tilts (and presses through its TiltCard); a later card on native presses through its photo
  const hero = index === 0;
  const flat = !hero && !ROW_TILT;
  const press = usePress('card', 0, { scroll: true });
  const Tilt = hero ? HeroTilt : RowTilt;
  // Android, tiers A and B: the card is drawn once into a texture of its own (see CACHED_CARD)
  const { tier } = useFx();
  const cached = CACHED_CARD && tier !== 'C';
  return <Tilt intensity={motionValues.tilt.package} radius={fx.radius.three} {...(hero ? { layer: !cached } : null)}>
    <Animated.View collapsable={false} renderToHardwareTextureAndroid={cached} style={[styles.card, flat ? press.style : null]} testID={`store-card-${p.slug}`}>
      <Pressable {...(flat ? press.scrollProps : null)} onPressIn={flat ? press.onPressIn : undefined} onPressOut={flat ? press.onPressOut : undefined}
        accessibilityRole="button" accessibilityLabel={`${p.name}: details`} accessibilityHint="Opens what the package includes" onPress={onDetails} style={styles.photoBox}>
        <MorphSource morphKey={morphKeyFor(p)} radius={fx.radius.three} style={StyleSheet.absoluteFill}>
          <TiltLayer depth={-1.2} overscan={1.08} style={StyleSheet.absoluteFill}>
            <View collapsable={false} renderToHardwareTextureAndroid={CACHED_PHOTO} style={StyleSheet.absoluteFill}>
              <CardPhoto p={p} index={index} slot={`store.package.card.${index}`} dim={col.dim} />
            </View>
          </TiltLayer>
        </MorphSource>
        <Scrim kind="programme" style={StyleSheet.absoluteFill} />
        <View style={styles.photoRow} pointerEvents="none">
          <View style={styles.badges}>
            {v?.level ? <LevelPill level={v.level} colour={col} /> : null}
            {p.promoLabel ? <View style={[styles.pill, styles.promo]}><T v="micro" color={fx.ink.white}>{p.promoLabel}</T></View> : null}
          </View>
          {enrolled ? <EnrolledBadge /> : null}
        </View>
      </Pressable>

      <View style={styles.body}>
        {/* the price sits beside the name and its line while their longest word fits whole beside it, else under them
            (measured: Beside; 'a con/sultation' at 320 dp and text 2.0, SWB-17) */}
        <Beside words={[{ text: p.name, v: 'card24' }, line ? { text: line, v: 'body', style: styles.tagline } : null]} align="flex-start" underGap={8}
          side={<View style={styles.priceBox} accessible accessibilityLabel={price != null ? `${spokenPrice(price)}${was ? `, was ${spokenPrice(was)}` : ''}, including GST` : 'Price on request'}>
            {was ? <T v="mono12" color={fx.ink.a60} style={styles.strike}>{rupees(was)}</T> : null}
            <T v="mono14" style={styles.price}>{price != null ? rupees(price) : 'On request'}</T>
          </View>}>
          <T v="card24" accessibilityRole="header">{p.name}</T>
          {line ? <T v="body" color={fx.ink.a80} style={styles.tagline}>{line}</T> : null}
        </Beside>

        {meta.length ? <View style={styles.meta}>
          {meta.map((m) => <View key={m.text} style={styles.metaItem}>
            <Icon name={m.icon} size={13} color={fx.ink.a70} />
            <T v="bodySm" color={fx.ink.a80}>{m.text}</T>
          </View>)}
        </View> : null}

        {highlights.length ? <View style={styles.list}>
          {highlights.map((h) => <View key={h} style={styles.tick}>
            <View style={styles.tickIcon}><Icon name="check" size={12} color={col.c} stroke={2.5} /></View>
            <T v="bodySm" color={fx.ink.a90} style={styles.flex}>{h}</T>
          </View>)}
        </View> : null}

        <View style={styles.actions}>
          {enrolled ? <EnrolledCta onPress={onOpenPlan} />
            : price != null ? <BuyButton title={`Buy · ${rupees(price)}`} label={`Buy ${p.name}, ${spokenPrice(price)}`} icon="shopping-bag" color={buy.fill} labelColor={buy.ink} shape="flow" commit onPress={onBuy} />
              : null}
          {!enrolled ? <Button variant="soft" title="View details" iconRight="arrow-right" label={`View details of ${p.name}`} onPress={onDetails} /> : null}
        </View>
      </View>
    </Animated.View>
  </Tilt>;
}

/** The package photo: the API's image when it sends one, else the bundled photo of this display slot, in the card colour. */
export function CardPhoto({ p, index, slot, dim }: { p: Package; index: number; slot: string; dim: string }) {
  const url = p.version?.imageUrl;
  if (url) return <RemotePhoto uri={url} fallbackSlot={slot} fallbackPick={index} decorative style={StyleSheet.absoluteFill} />;
  return <Photo slot={slot} tint="programme" tintColor={dim} decorative style={StyleSheet.absoluteFill} />;
}

export function LevelPill({ level, colour }: { level: string; colour: { c: string; dim: string } }) {
  return <View style={[styles.pill, { backgroundColor: colour.dim, borderColor: `${colour.c}4D` }]}>
    <Icon name={levelIcon(level)} size={14} color={colour.c} />
    <T v="micro" color={colour.c} style={styles.pillText}>{level}</T>
  </View>;
}

/** An include line the card's meta line already states (its consultations or its blood tests). */
function statedInMeta(line: string, v: Package['version']): boolean {
  return (!!v?.consultations && /consultation/i.test(line)) || (!!v?.bloodworkEntitlements && /blood ?tests?/i.test(line));
}

/** The green ENROLLED badge; it springs in once (no confetti). It sits on the photo, so its ground is solid (the
 *  panel black under the green tint): the green label reads at about 10:1 over any part of the picture. */
export function EnrolledBadge() {
  return <Reveal mount from="scale" delay={400} spring="stagger" id="store.enrolled">
    <View style={[styles.pill, styles.enrolled]} accessible accessibilityLabel="Enrolled: your current package">
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.enrolledTint]} />
      <Icon name="check" size={12} color={fx.hue.green400} stroke={2.5} />
      <T v="micro" color={fx.hue.green400} style={styles.pillText}>Enrolled</T>
    </View>
  </Reveal>;
}

/** "Enrolled · Open my plan": the earlier app's green "Enrolled · Access Program" outline button. */
export function EnrolledCta({ onPress }: { onPress: () => void }) {
  const press = usePress('cta');
  return <AnimatedPressable
    accessibilityRole="button"
    accessibilityLabel="Enrolled. Open my plan"
    accessibilityHint="Opens your plan in Train"
    onPress={() => { haptics.select(); onPress(); }}
    onPressIn={press.onPressIn}
    onPressOut={press.onPressOut}
    style={[styles.enrolledCta, press.pressed ? styles.enrolledPressed : null, press.style]}>
    <Icon name="check" size={18} color={fx.hue.green400} />
    <T v="section" color={fx.hue.green400} numberOfLines={2} center style={styles.shrinkText}>Enrolled · Open my plan</T>
  </AnimatedPressable>;
}

const styles = StyleSheet.create({
  shrinkText: { flexShrink: 1 },
  card: { borderRadius: fx.radius.three, borderWidth: 1, borderColor: fx.line.a05, backgroundColor: fx.bg.panelSolid, overflow: 'hidden', boxShadow: fx.shadow.card },
  photoBox: { height: PHOTO_H, overflow: 'hidden', backgroundColor: fx.bg.panel },
  photoRow: { position: 'absolute', left: 16, right: 16, top: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  badges: { flexShrink: 1, gap: 6, alignItems: 'flex-start' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 5, borderRadius: fx.radius.pill, borderWidth: 1 },
  pillText: { fontSize: 10, lineHeight: 14, letterSpacing: 1.2 },
  promo: { backgroundColor: fx.glass.onPhoto, borderColor: fx.line.a20 },
  enrolled: { backgroundColor: fx.bg.panel, borderColor: fx.tone.greenLine, overflow: 'hidden' },
  enrolledTint: { backgroundColor: fx.tone.greenBg },
  body: { padding: 20, gap: 14 },
  tagline: { marginTop: 6 },
  priceBox: { alignItems: 'flex-end', paddingTop: 2 },
  strike: { textDecorationLine: 'line-through' },
  price: { fontFamily: FONTS.mono500, fontSize: 18, lineHeight: 24, letterSpacing: 0.5 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 6 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  list: { gap: 8 },
  tick: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  tickIcon: { height: 19.5, justifyContent: 'center' },
  flex: { flex: 1 },
  actions: { gap: 10, marginTop: 4 },
  enrolledCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 48, paddingVertical: 12, paddingHorizontal: 20, borderRadius: fx.radius.card, borderWidth: 1, borderColor: fx.line.a10, backgroundColor: fx.fill.a05 },
  enrolledPressed: { backgroundColor: fx.fill.a10, borderColor: fx.tone.greenLine },
});
