/* The chrome of a full-screen overlay route (report, booking, checkout, settings pages, notifications…): #080808; a
   header (pt = top inset + 12, px 20, pb 16, white/10 rule under it) with the 36 pt round close or back button, the
   title (Montserrat 18/600, or Bebas 20 with `display`) and an optional meta line at white/60; the content scrolls
   under it; `footer` is pinned at the bottom over a fade (the CTA). Close goes back, or, when the overlay was opened
   from a link with nothing behind it, replaces it with `fallback` (the owning tab). The stack's own header
   (src/fx/StackHeader) is not drawn over an Overlay.
   The stage (motion v2: overlays enter and leave on every platform):
   - Web: the screen beneath stays drawn (the root layout presents overlays as transparent modals there); the canvas
     fades in over it (120 ms) and the content rises 16 pt as it fades in (260 ms expo, from 60 ms).
   - Android: the screen itself fades (the stack's fade); the content waits at opacity 0 until that fade is done
     (150 ms), then rises in the same way, so no text ever sits over text.
   - iOS: the native fade from the bottom (260 ms) and its swipe back, unchanged.
   - Leaving, through the overlay's own close paths only (its Close or Back button, closeOverlay(), Android's back
     button): the content sinks 10 pt and fades (170 ms, ease.exit; on the web the canvas fades from 50 ms), then the
     route goes back. Nothing else is intercepted (links, browser back and resets navigate at once).
   - Reduced motion: a 150 ms crossfade both ways. In the web's pre-rendered HTML it is drawn at rest. */
import { router, useIsFocused, type Href } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Platform, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fx } from '@/theme';
import { IconButton } from './Button';
import { calmFade, ease, motionValues, t, timing, useFx } from './effects';
import { Scrim } from './Gradient';
import { COLUMN } from './layout';
import { doneOnce } from './motion/once';
import { useLoadingWasShown, useOwnChrome } from './nav/chrome';
import { useKeyboardInsetPad } from './Sheet';
import { T } from './Text';
import { FitText } from './wordFit';
import { useToastClearance } from './Toast';

const OV = motionValues.overlay;
const WEB = Platform.OS === 'web';

/** Back, or to `fallback` when nothing is behind (a deep link). */
function navigateBack(fallback: Href): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}

/** The focused Overlay's exit: plays it and navigates (true), or leaves the navigation to the caller (false: iOS). */
let focusedExit: ((fallback?: Href) => boolean) | null = null;

/** Close the overlay on screen: its exit plays first (web and Android), then it goes back or to `fallback`. Outside an
 *  Overlay (a sheet route, a morph screen) it navigates at once. */
export function closeOverlay(fallback: Href = '/(tabs)'): void {
  if (focusedExit && focusedExit(fallback)) return;
  navigateBack(fallback);
}

/** The overlay's header row (also drawn by the stack's header while an overlay route's code is still loading, so the
 *  header never changes under the person: src/fx/StackHeader). On a wide screen the row sits in the content's centred
 *  column, above the body it belongs to (TAB-04: a subtitle ran 122 characters on one line, the buttons at the
 *  window's edges), and clear of a side cutout (TAB-09); its rule stays the window's width. */
export function OverlayHeader({ title, subtitle, kind = 'close', onClose, display, right, inset }: {
  title: string; subtitle?: string; kind?: 'close' | 'back'; onClose: () => void; display?: boolean; right?: React.ReactNode; inset: number;
}) {
  const side = useSafeAreaInsets();
  return <View style={[styles.header, { paddingTop: inset + 12, paddingLeft: side.left, paddingRight: side.right }]}><View style={styles.headerRow}>
    {kind === 'back' ? <IconButton icon="chevron-left" label="Back" onPress={onClose} iconSize={18} /> : null}
    <View style={styles.titles}>
      {/* a one-word title shrinks just enough to stay whole ('Recommendation/s' at text 2.0, SWB-18) */}
      <FitText v={display ? 'small20' : 'heading'} accessibilityRole="header" numberOfLines={2}>{title}</FitText>
      {subtitle ? <T v="caption" color={fx.ink.a60} style={styles.meta}>{subtitle}</T> : null}
    </View>
    {right}
    {kind === 'close' ? <IconButton icon="x" label="Close" onPress={onClose} iconSize={18} /> : null}
  </View></View>;
}

/** The overlay's entrance and exit (see the header). `enter` 0 → 1 as it arrives, `leave` 0 → 1 as it goes. */
function useOverlayStage(fallback: Href | undefined, focused: boolean) {
  const { calm, inHtml } = useFx();
  const ios = Platform.OS === 'ios';
  // its loading state already entered (the stack's header drew it while the code loaded): start at rest
  const entered = useLoadingWasShown();
  const atRest = inHtml || ios || entered;
  const enter = useSharedValue(atRest ? 1 : 0);
  const backdrop = useSharedValue(atRest || !WEB ? 1 : 0);
  const leave = useSharedValue(0);
  const exiting = useRef(false);
  useEffect(() => {
    if (atRest) return;
    // the clock starts on the frame after the screen's first paint, so its own first render does not eat the entrance
    const go = () => {
      if (WEB) backdrop.value = calm ? withTiming(1, calmFade()) : withTiming(1, timing(OV.backdropMs, ease.css));
      const at = WEB ? OV.enterAt : OV.androidAt;
      enter.value = withDelay(at, calm ? withTiming(1, calmFade()) : withTiming(1, timing(t.overlay)));
    };
    const frame = requestAnimationFrame(go);
    return () => cancelAnimationFrame(frame);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const exit = useCallback((to?: Href): boolean => {
    if (exiting.current) return true; // a second press while it leaves
    if (ios) return false;
    exiting.current = true;
    const target = to ?? fallback ?? '/(tabs)';
    const ms = calm ? t.calm : t.overlayExit;
    const once = doneOnce(() => navigateBack(target), ms + OV.fallbackExtra);
    const finish = (finished?: boolean) => { 'worklet'; if (finished) scheduleOnRN(once.done); };
    leave.value = calm ? withTiming(1, calmFade(), finish) : withTiming(1, timing(t.overlayExit, ease.exit), finish);
    if (WEB) backdrop.value = calm ? withTiming(0, calmFade()) : withDelay(OV.backdropOutAt, withTiming(0, timing(OV.backdropMs, ease.css)));
    return true;
  }, [calm, ios, fallback, leave, backdrop]);
  // the focused overlay owns closeOverlay() and, on Android, the back button
  useEffect(() => {
    if (!focused) return;
    focusedExit = exit;
    const sub = Platform.OS === 'android' ? BackHandler.addEventListener('hardwareBackPress', () => exit()) : null;
    return () => { if (focusedExit === exit) focusedExit = null; sub?.remove(); };
  }, [focused, exit]);
  const still = calm || inHtml;
  const content = useAnimatedStyle(() => {
    const y = still ? 0 : OV.enterY * (1 - enter.value) + OV.exitY * leave.value;
    return { opacity: enter.value * (1 - leave.value), transform: [{ translateY: y }] };
  });
  const canvas = useAnimatedStyle(() => ({ opacity: backdrop.value }));
  return { exit, content, canvas };
}

export function Overlay({ title, subtitle, kind = 'close', onClose, fallback, right, footer, display, scroll = true, hero, children, contentStyle }: {
  title: string; subtitle?: string; kind?: 'close' | 'back'; onClose?: () => void; fallback?: Href; right?: React.ReactNode; footer?: React.ReactNode;
  display?: boolean; scroll?: boolean; hero?: React.ReactNode; children?: React.ReactNode; contentStyle?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  useOwnChrome(); // this header replaces the stack's (src/fx/StackHeader)
  const focused = useIsFocused();
  const [footerH, setFooterH] = useState(0);
  useToastClearance(footerH, !!footer && focused); // a quick toast sits above the pinned CTA
  const stage = useOverlayStage(fallback, focused);
  const footerPad = useKeyboardInsetPad(16, insets.bottom); // no navigation-bar inset under a footer on the keyboard
  const close = onClose ?? (() => { if (!stage.exit(fallback)) navigateBack(fallback ?? '/(tabs)'); });
  const body = <View style={[styles.body, { paddingBottom: (footer ? 120 : 32) + insets.bottom }, contentStyle]}>{children}</View>;
  return <View style={[styles.screen, WEB ? styles.clear : null]}>
    {WEB ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.canvas, stage.canvas]} /> : null}
    <Animated.View style={[styles.fill, stage.content]}>
      <OverlayHeader title={title} subtitle={subtitle} kind={kind} onClose={close} display={display} right={right} inset={insets.top} />
      {scroll ? <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>{hero}{body}</ScrollView> : <View style={styles.fill}>{hero}{body}</View>}
      {footer ? <View pointerEvents="box-none" style={styles.footerWrap}>
        <Scrim kind="overlayFooter" style={StyleSheet.absoluteFill} />
        <Animated.View onLayout={(e) => { const h = Math.round(e.nativeEvent.layout.height); if (h > 0) setFooterH(h); }} style={[styles.footer, footerPad]}>{footer}</Animated.View>
      </View> : null}
    </Animated.View>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: fx.bg.base },
  // the web draws the canvas as a layer of its own (it fades in over the screen beneath)
  clear: { backgroundColor: fx.premium.transparent },
  canvas: { backgroundColor: fx.bg.base },
  fill: { flex: 1 },
  // the back and close buttons stay level with the title when a long subtitle wraps (a short one still centres as before)
  header: { paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: fx.line.a10 },
  headerRow: { width: '100%', maxWidth: COLUMN, alignSelf: 'center', flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 20 },
  titles: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center' },
  meta: { marginTop: 2, fontSize: 12 },
  body: { width: '100%', maxWidth: COLUMN, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 20, gap: 16 },
  footerWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 32 },
  footer: { width: '100%', maxWidth: COLUMN, alignSelf: 'center', paddingHorizontal: 20 },
});
