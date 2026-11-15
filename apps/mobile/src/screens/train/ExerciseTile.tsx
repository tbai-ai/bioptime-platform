/* What an exercise without a demonstration clip shows where the clip would be (PREMIUM §2.6: nothing implies a
   demonstration that is not there; AMENDED §6: the session photos are for session banners, week cards, plan thumbnails
   and the player's cover, never for one exercise). The earlier app's own fallback for a missing picture, as on Fuel's
   dishes: the category's colour as a radial wash on the card black with the category's icon. Never a photo: a person in
   it would read as this exercise being shown. Library cards (160) and rows (a 16:9 thumbnail), the exercise screen and
   the player's pages (16:9).
   ExercisePoster: an exercise's poster (a server picture; bundled in the phone apps) that shows this tile instead when
   the picture cannot be drawn (T3-05: a poster refused by the network left an empty dark box), on the ground the tile
   is drawn on there (the card's, or the hero's black), so nothing behind the poster (the player's cover) shows through.
   Where a clip's play badge sits in the middle, the tile leaves its icon out (`glyph` false). */
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon, RadialGlow, RemotePhoto, withAlpha } from '@/fx';
import { fx } from '@/theme';
import { categoryColor, categoryIcon } from './shared';

/** The icon's size on the 16:9 hero (the exercise screen and the player's pages). */
export const HERO_ICON = 56;

export function ExerciseTile({ category, size = 'card', icon, glyph = true, style }: {
  category?: string | null; size?: 'card' | 'hero'; style?: StyleProp<ViewStyle>;
  /** The icon's size, where the tile is drawn at a size of its own (a library row's thumbnail). */
  icon?: number;
  /** The category's icon in the middle (left out under a clip's play badge). */
  glyph?: boolean;
}) {
  const c = categoryColor(category);
  return <View accessible={false} importantForAccessibility="no-hide-descendants" aria-hidden style={[styles.box, { backgroundColor: withAlpha(c, 0.08) }, style]}>
    <RadialGlow color={c} opacity={0.42} cx={0.32} cy={0.3} fade={0.8} style={StyleSheet.absoluteFill} />
    <RadialGlow color={c} opacity={0.16} cx={0.78} cy={0.85} fade={0.6} style={StyleSheet.absoluteFill} />
    {glyph ? <View style={styles.centre}><Icon name={categoryIcon(category)} size={icon ?? (size === 'hero' ? HERO_ICON : 40)} color={withAlpha(c, 0.9)} stroke={1.5} /></View> : null}
  </View>;
}

/** The kit's RemotePhoto, given what it draws when its picture is missing or fails (its `fallback`). */
type PosterProps = React.ComponentProps<typeof RemotePhoto> & { fallback?: React.ReactNode };
const Poster: React.ComponentType<PosterProps> = RemotePhoto;

/** An exercise's poster; the category's tile (at full strength, on its ground) when the picture is missing or fails. */
export function ExercisePoster({ uri, category, size = 'card', glyph, opacity, style }: {
  uri: string | null | undefined; category?: string | null; size?: 'card' | 'hero'; glyph?: boolean; opacity?: number; style?: StyleProp<ViewStyle>;
}) {
  return <Poster uri={uri} opacity={opacity} decorative style={style} fallback={<PosterFallback category={category} size={size} glyph={glyph} />} />;
}

/** The tile a poster falls back to, on the ground it is drawn on there (hero pages: black; cards: the card's). */
export function PosterFallback({ category, size = 'card', glyph }: { category?: string | null; size?: 'card' | 'hero'; glyph?: boolean }) {
  return <View style={[StyleSheet.absoluteFill, size === 'hero' ? styles.heroGround : styles.cardGround]}>
    <ExerciseTile category={category} size={size} glyph={glyph} style={StyleSheet.absoluteFill} />
  </View>;
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden', backgroundColor: fx.bg.card },
  centre: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  heroGround: { backgroundColor: fx.bg.deep },
  cardGround: { backgroundColor: fx.bg.card },
});
