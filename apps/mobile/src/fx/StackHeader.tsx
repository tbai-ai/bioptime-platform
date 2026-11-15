/* The root stack's header for a client screen that draws no chrome of its own, in the earlier app's look: no bar and
   no rule, just the #080808 canvas carried up under the status bar, the 36 pt round glass back button (white/5, a white/10 ring, 44 pt to
   touch) and the title in Bebas Neue (30/36, up to two lines). Back pops the stack; a screen opened from a link with
   nothing behind it goes to the tab that owns it instead (Home when that tab is not in this build). On the web the row
   rises in with the overlay's 260 ms entrance (the native stack animates the whole screen); with reduced motion it is
   there at once.
   An overlay route (one whose screen is the kit's Overlay) gets the overlay's own header instead while its code is
   still loading on the web, over a skeleton of the overlay's first blocks, entering as the overlay enters: the header
   the person sees first is the one that stays (never a Bebas header that a different one then replaces).
   A screen that draws its own chrome hides it. The kit's Overlay, FlowScreen and SheetScreen do this for their screens,
   and the root layout leaves it off for the tabs, the flows, the sheet and morph routes and the redirects; any other
   screen with a header of its own calls useOwnChrome() (src/fx/nav/chrome) once. That is decided in the same frame
   the screen first draws (a layout effect), so the header never flashes over a restyled screen. */
import { router, type Href, type NativeStackHeaderProps } from 'expo-router';
import React, { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fx } from '@/theme';
import { IconButton } from './Button';
import { calmFade, ease, motionValues, t, timing, useFx } from './effects';
import { FlowEnter } from './FxScreen';
import { COLUMN } from './layout';
import { Skeleton } from './motion/Skeleton';
import { markLoadingShown, useHasOwnChrome, useOwnChrome } from './nav/chrome';
import { OverlayHeader } from './Overlay';
import { tabHrefIn, useTabRoutes } from './nav/routes';
import type { TabName } from './nav/tabs';
import { T } from './Text';

/** The tab a client overlay belongs to, for "back" when it was opened from a link with nothing behind it. */
const OWNER: [RegExp, TabName][] = [
  [/^(workout|exercise|session)\//, 'train'],
  [/^(goals|checkin\/|progress-entry)/, 'bio'],
  [/^habits$/, 'life'],
  [/^meal-log$/, 'fuel'],
  [/^(recommendations|coach-ai|book-appointment|move-appointment\/)/, 'coach'],
  [/^(book-test|booking\/|report\/)/, 'tests'],
  [/^(packages|bespoke|refer|learn\/)/, 'store'],
  [/^(help|support\/|billing|milestones|settings\/(profile|security|consents|data|credits))/, 'profile'],
];

export function ownerTab(routeName: string): TabName {
  return OWNER.find(([re]) => re.test(routeName))?.[1] ?? 'index';
}

/** A readable title from a route name when the screen gives none ('settings/data' → 'Data', 'learn/index' →
 *  'Learn'). */
export function titleFromRoute(name: string): string {
  const parts = name.split('/').filter((p) => p && p !== 'index' && !p.startsWith('['));
  const last = parts[parts.length - 1] ?? '';
  const words = last.replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Bioptime';
}

/** Back from a stack screen: pop it, or replace it with `fallback` when nothing is behind it (a deep link). */
export function goBackOr(navigation: { canGoBack: () => boolean; goBack: () => void }, fallback: Href): void {
  if (navigation.canGoBack()) navigation.goBack();
  else router.replace(fallback);
}

/** The header row itself, for a screen that wants this look inside its own body (with a `right` action, say). Drawn
 *  in a screen body it also hides the stack's header for that screen, unless `ownChrome` is false (the stack's
 *  header itself, an illustration). `inset` adds the status bar height above it. */
export function BackHeader({ title, onBack, right, inset = true, style, ownChrome = true }: {
  title: string; onBack: () => void; right?: React.ReactNode; inset?: boolean; style?: StyleProp<ViewStyle>; ownChrome?: boolean;
}) {
  const insets = useSafeAreaInsets();
  useOwnChrome(ownChrome);
  return <View style={[styles.wrap, { paddingTop: (inset ? insets.top : 0) + 12 }, style]}>
    <FlowEnter webOnly duration={t.overlay} style={styles.enter}>
      <View style={styles.row}>
        <IconButton icon="chevron-left" label="Back" onPress={onBack} iconSize={18} />
        <T v="h1" accessibilityRole="header" numberOfLines={2} style={styles.title}>{title}</T>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
    </FlowEnter>
  </View>;
}

/** The stack's header for one screen (the root layout passes it as `header`): nothing while the screen draws its own
 *  chrome, else the back row with the screen's title (its `title` option, or one made from the route's name). */
export function StackHeader({ route, options, navigation }: NativeStackHeaderProps) {
  const hidden = useHasOwnChrome(route.key);
  const routes = useTabRoutes();
  if (hidden) return null;
  const title = typeof options.title === 'string' && options.title.trim() ? options.title : titleFromRoute(route.name);
  const right = options.headerRight?.({ canGoBack: navigation.canGoBack(), tintColor: fx.ink.white });
  return <BackHeader ownChrome={false} title={title} right={right} onBack={() => goBackOr(navigation, tabHrefIn(routes, ownerTab(route.name)))} />;
}

/** The root stack's `header` option for client screens. */
export const renderStackHeader = (props: NativeStackHeaderProps) => <StackHeader {...props} />;

/** An overlay route's header while its screen has not drawn yet: the overlay's own header over its skeleton (80, 160
 *  and 160 pt blocks), on the overlay's canvas, entering as the overlay enters. Nothing once the screen draws its own. */
function OverlayLoading({ route, options, navigation, kind }: NativeStackHeaderProps & { kind: 'close' | 'back' }) {
  const hidden = useHasOwnChrome(route.key);
  const routes = useTabRoutes();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { calm, inHtml } = useFx();
  const ov = motionValues.overlay;
  const canvas = useSharedValue(inHtml ? 1 : 0);
  const enter = useSharedValue(inHtml ? 1 : 0);
  // after a paint, and only if the screen has not drawn its own header by then (it usually has, in the same frame)
  useEffect(() => { if (!hidden) markLoadingShown(route.key); }, [hidden, route.key]);
  useEffect(() => {
    if (inHtml) return;
    canvas.value = calm ? withTiming(1, calmFade()) : withTiming(1, timing(ov.backdropMs, ease.css));
    enter.value = withDelay(ov.enterAt, calm ? withTiming(1, calmFade()) : withTiming(1, timing(t.overlay)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const a = useAnimatedStyle(() => ({ opacity: canvas.value }));
  const c = useAnimatedStyle(() => ({ opacity: enter.value, transform: [{ translateY: calm ? 0 : ov.enterY * (1 - enter.value) }] }));
  if (hidden) return null;
  const title = typeof options.title === 'string' && options.title.trim() ? options.title : titleFromRoute(route.name);
  return <View style={[styles.loading, { height }]}>
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.canvas, a]} />
    <Animated.View style={c}>
      <OverlayHeader title={title} kind={kind} inset={insets.top} onClose={() => goBackOr(navigation, tabHrefIn(routes, ownerTab(route.name)))} />
      <View accessibilityLabel="Loading" style={styles.loadingBody}>
        <Skeleton height={80} radius={fx.radius.card} />
        <Skeleton height={160} radius={fx.radius.card} />
        <Skeleton height={160} radius={fx.radius.card} />
      </View>
    </Animated.View>
  </View>;
}

/** The root stack's `header` option for an overlay route on the web (`kind`: the overlay's close or back button). */
export const overlayHeader = (kind: 'close' | 'back') => (props: NativeStackHeaderProps) => <OverlayLoading {...props} kind={kind} />;

const styles = StyleSheet.create({
  // painted with the canvas colour: the stack's own header container is the navigation theme's (light) card
  wrap: { backgroundColor: fx.bg.base, paddingHorizontal: 20, paddingBottom: 12 },
  enter: { flex: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 44 },
  title: { flex: 1, minWidth: 0 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  loading: { position: 'absolute', left: 0, right: 0, top: 0 },
  canvas: { backgroundColor: fx.bg.base },
  loadingBody: { width: '100%', maxWidth: COLUMN, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 20, gap: 16 },
});
