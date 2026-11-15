/* The chrome every pre-main screen shares (the earlier app’s sign-in, PREMIUM §1.10 "Sign in"): the flow black with the 2 px red
   hairline, the backdrop photo of AMENDED §6 in the top 45 % (a people-free empty training room at .14 under
   the login scrim, drifting ±6 pt with the device's tilt on tier A phones) with the two auth orbs, then the column: the 64 pt glass logo tile holding the Bioptime mark (the
   sign-in; the splash's mark flies into it, MarkHandoff) or a "Back" link (the other screens), the red BIOPTIME eyebrow,
   the Bebas title and its light subtitle. `overlay` (the Verified moment) is drawn above the whole screen.
   Motion v2:
   - Entrances come in at most four beats (src/flow/auth/beats; M57, C05): the tile (or Back), the eyebrow and the
     title; the subtitle; the form (`children`, unless the screen places its own beats: the sign-in); `trailing`. No
     column entrance carries them (nothing compounds). At rest with reduced motion.
   - Arriving from the splash (the mark is flying into the tile, M56, M60): the tile is in place at once; the title
     block under the mark's path (eyebrow, title and subtitle) holds back until the mark's box is above it and then
     rises (src/flow/MarkClear: nothing moves across text being read), and the rest of the column starts its beats from
     that same frame, so the screen writes itself top-down beneath the arriving mark (tier C: the marks crossfade in
     place; the eyebrow waits m56.eyebrowLag after the landing, the rest enters in its beats); the photo
     settles (opacity 0 → .14, scale 1.1 → 1.06 over m60.photoMs) and the orbs fade in (m60.orbsMs) while the
     splash's black fades; the hairline draws from the left as the mark lands (m60.hairlineMs). Tier C and reduced
     motion: at rest.
   - Leaving (`leave`, src/flow/auth/leave): every part fades and rises with the column except the tile's mark, which
     lifts and is handed to the root MarkLayer towards Home. `inert`: the screen takes no more touches (it is on its
     way Home and stays drawn, faded, until Home's first frame replaces it). */
import { router, useIsFocused } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, withDelay, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Button, Eyebrow, FlowScreen, MarkHandoff, MarkPaths, Orbs, P, Photo, Scrim, T, fx, hasMarkHandoff, useDeviceTilt, useMotion } from '@/fx';
import { expectedMarkTarget, markFlight, markFlightP, onMarkLanded, subscribeMarkHandoff } from '@/fx/brand/MarkLayer';
import { PageEnterContext, usePageActive } from '@/fx/nav/pageReady';
import { ease, motionValues, timing } from '@/fx/motion/tokens';
import { CLIENT_SIGN_IN } from '@/lib/auth';
import { MarkClear, useMarkClear } from '@/flow/MarkClear';
import { Beat, BeatBase, useBeatAt } from './beats';
import { useAuthLeave, type AuthLeave } from './leave';

export type AuthSlot = 'auth.signin.backdrop' | 'auth.register.backdrop' | 'auth.phone.backdrop' | 'auth.forgot.backdrop' | 'auth.verify.backdrop' | 'auth.socialFinish.backdrop';

const S = motionValues.screens;
/** The sign-in's first beat: two beats before the form's first-mount delay (m53.firstDelay), so the pinned preview
 *  card (240) and segment (280) Reveals sit in beats 1 and 2. */
const SIGN_IN_BASE = S.m53.firstDelay - 2 * S.m57.beatStep;

/** Whether the splash has started to leave (its black fades from the frame it hands its mark over, or it gave the
 *  hand-off up): while it still heads for the sign-in, nothing behind its black should move yet. */
function useSplashLeaving(on: boolean): boolean {
  const [leaving, setLeaving] = useState(() => !on || expectedMarkTarget() !== 'signin');
  useEffect(() => {
    if (leaving) return;
    const check = () => { if (expectedMarkTarget() !== 'signin') setLeaving(true); };
    const off = subscribeMarkHandoff(check);
    check();
    const cap = setTimeout(() => setLeaving(true), motionValues.mark.cap);
    return () => { off(); clearTimeout(cap); };
  }, [leaving]);
  return leaving;
}

/** The settle as the splash leaves: 0 → 1 over `ms` once the page is active and the splash's black starts to fade
 *  (tier A and B, not with reduced motion; otherwise at rest). */
function useArrival(on: boolean, ms: number, go: boolean): SharedValue<number> {
  const active = usePageActive();
  const p = useSharedValue(on ? 0 : 1);
  useAnimatedReaction(() => (go && active.value === 1 ? 1 : 0), (now, prev) => {
    if (!on || now !== 1 || prev === 1 || p.value !== 0) return;
    p.value = withTiming(1, timing(ms, ease.css));
  }, [on, ms, go]);
  return p;
}

/** The photo band and the orbs behind an auth screen (decorative). */
export function AuthBackdrop({ slot = 'auth.signin.backdrop', arrive, leave }: { slot?: AuthSlot; arrive?: boolean; leave?: AuthLeave }) {
  const { height } = useWindowDimensions();
  // tier A phones: the photo drifts up to ±6 pt against the device's tilt (PREMIUM §1.10); still everywhere else
  const { tier, still } = useMotion();
  const { roll, pitch, want } = useDeviceTilt();
  const focused = useIsFocused();
  const tilt = tier === 'A' && !still && focused;
  useEffect(() => (tilt && want ? want() : undefined), [tilt, want]);
  const settle = !!arrive && tier !== 'C' && !still;
  const leaving = useSplashLeaving(settle);
  const photo = useArrival(settle, S.m60.photoMs, leaving);
  const orbs = useArrival(settle, S.m60.orbsMs, leaving);
  const gone = leave?.bg;
  const drift = useAnimatedStyle(() => {
    const k = photo.value;
    const scale = S.m60.photoScaleTo + (S.m60.photoScaleFrom - S.m60.photoScaleTo) * (1 - k);
    const x = Math.max(-6, Math.min(6, -roll.get() * 0.4));
    const y = Math.max(-6, Math.min(6, -pitch.get() * 0.4));
    const opacity = k * (1 - (gone ? gone.value : 0));
    return x === 0 && y === 0 ? { opacity, transform: [{ scale }] } : { opacity, transform: [{ translateX: x }, { translateY: y }, { scale }] };
  });
  const orbIn = useAnimatedStyle(() => ({ opacity: orbs.value * (1 - (gone ? gone.value : 0)) }));
  return <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
    <View style={[styles.band, { height: Math.round(height * 0.45) }]}>
      <Animated.View style={[StyleSheet.absoluteFill, drift]}><Photo slot={slot} opacity={S.m60.photoTo} decorative priority="high" style={StyleSheet.absoluteFill} /></Animated.View>
      <Scrim kind="login" style={StyleSheet.absoluteFill} />
    </View>
    <Animated.View style={[StyleSheet.absoluteFill, orbIn]}><Orbs preset="auth" /></Animated.View>
  </View>;
}

/** The 2 px red hairline at the very top. `draw`: it draws from the left once `go` is set (the mark has landed). */
function Hairline({ draw, go, leave }: { draw: boolean; go: boolean; leave: AuthLeave }) {
  const { width } = useWindowDimensions();
  const p = useSharedValue(draw ? 0 : 1);
  useEffect(() => { if (draw && go) p.value = withTiming(1, timing(S.m60.hairlineMs)); }, [draw, go, p]);
  const fill = useAnimatedStyle(() => (p.value === 1 ? { transform: [] } : { transform: [{ translateX: -width * (1 - p.value) }] }), [width]);
  const out = useAnimatedStyle(() => ({ opacity: 1 - leave.bg.value }));
  return <Animated.View pointerEvents="none" style={[styles.hairline, out]} accessible={false} aria-hidden>
    <Animated.View style={[styles.hairlineFill, fill]} />
  </Animated.View>;
}

/** Back to where the person came from, or to the sign-in when this screen was opened directly (a link). */
export function goBack(fallback: string = CLIENT_SIGN_IN) {
  if (router.canGoBack()) router.back();
  else router.replace(fallback as never);
}

/** The sign-in's 64 pt glass tile with the mark (40 pt: the brand's clear space holds). The glass leaves with the
 *  column; the mark lifts and is handed to Home (or fades with the column when nothing is handed over). */
export function LogoTile({ leave, column }: { leave: AuthLeave; column: ReturnType<typeof useAnimatedStyle> }) {
  const mark = useAnimatedStyle(() => {
    const opacity = leave.flying.value === 1 ? 1 - leave.hide.value : 1 - leave.p.value;
    const s = 1 + (S.m56.liftScale - 1) * leave.lift.value;
    return s === 1 ? { opacity, transform: [] } : { opacity, transform: [{ scale: s }] };
  });
  return <View style={styles.tileBox}>
    <Animated.View style={[styles.glass, column]} />
    <View style={styles.tile} accessible accessibilityRole="image" accessibilityLabel="Bioptime">
      <Animated.View ref={leave.markRef} collapsable={false} style={mark}>
        <MarkHandoff target="signin"><MarkPaths width={40} /></MarkHandoff>
      </Animated.View>
    </View>
  </View>;
}

/** The eyebrow under the splash mark's path: it waits until the mark has passed (its flight is m56 landAt home, or it
 *  landed, or the hand-off is given up), then enters m56.eyebrowLag later. */
function EyebrowAfterMark({ children }: { children: React.ReactNode }) {
  const [go, setGo] = useState(false);
  useEffect(() => {
    if (go) return;
    const off = onMarkLanded(() => setGo(true));
    const cap = setTimeout(() => setGo(true), motionValues.mark.cap);
    return () => { off(); clearTimeout(cap); };
  }, [go]);
  useAnimatedReaction(() => (markFlight.value !== null && markFlightP.value >= motionValues.reveal.landAt ? 1 : 0), (on, was) => {
    if (on === 1 && was !== 1) scheduleOnRN(setGo, true);
  });
  const p = useSharedValue(0);
  useEffect(() => {
    if (go) p.value = withDelay(S.m56.eyebrowLag, withTiming(1, timing(S.m57.beatMs)));
  }, [go, p]);
  const a = useAnimatedStyle(() => (p.value === 1 ? { opacity: 1, transform: [] } : { opacity: p.value, transform: [{ translateY: S.m57.rise * (1 - p.value) }] }));
  return <Animated.View style={a}>{children}</Animated.View>;
}

export function AuthScreen({ slot, logo, back, eyebrow = 'Bioptime', title, small, subtitle, children, trailing, footer, overlay, leave, ownBeats, inert }: {
  slot?: AuthSlot;
  /** The sign-in's logo tile in place of the back link. */
  logo?: boolean;
  /** Draw "Back"; true goes back (or to the sign-in), a function does its own thing. */
  back?: boolean | (() => void);
  eyebrow?: string;
  title: string;
  /** Bebas 42 instead of 56 (longer titles). */
  small?: boolean;
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
  /** Drawn after the form, in the last beat (a link line, a note). */
  trailing?: React.ReactNode;
  footer?: React.ReactNode;
  overlay?: React.ReactNode;
  /** The screen's exit (useAuthLeave): the column leaves with it, the mark is handed over. */
  leave?: AuthLeave;
  /** The children place their own beats (the sign-in): they are drawn without a beat of their own. */
  ownBeats?: boolean;
  /** Leaving for Home: nothing on the screen takes a touch any more. */
  inert?: boolean;
}) {
  // the splash's mark is flying into the tile: the tile is in place at once and the eyebrow waits for the mark
  const [flight] = useState(() => !!logo && hasMarkHandoff('signin'));
  const { tier, still } = useMotion();
  const own = useAuthLeave();
  const lv = leave ?? own;
  const move = tier !== 'C' && !still;
  const column = useAnimatedStyle(() => {
    const p = lv.p.value;
    if (p === 0) return { opacity: 1, transform: [] };
    return { opacity: 1 - p, transform: move ? [{ translateY: motionValues.flowSwap.exitY * p }] : [] };
  }, [move]);
  const [landed, setLanded] = useState(false);
  useEffect(() => {
    if (!flight || landed) return;
    const off = onMarkLanded(() => setLanded(true));
    const cap = setTimeout(() => setLanded(true), motionValues.mark.cap);
    return () => { off(); clearTimeout(cap); };
  }, [flight, landed]);
  const drawLine = flight && tier !== 'C' && !still;
  // the splash's mark flies over the title block: it holds until the mark has passed, and the column's beats start then
  const gate = useMarkClear('signin', !!logo && flight);
  const pageActive = usePageActive();
  const edge = useSharedValue(gate.on ? 0 : 1);
  useAnimatedReaction(() => (gate.clear.get() === 1 && pageActive.get() === 1 ? 1 : 0), (v) => { if (gate.on && v === 1) edge.set(1); }, [gate.on]);
  const set = logo ? S.m57 : S.c05;
  const body = <Animated.View style={[styles.body, ownBeats ? styles.bodyOwn : null, column]}>{children}</Animated.View>;
  const eyebrowEl = <Animated.View style={column}><Eyebrow kind="brand">{eyebrow}</Eyebrow></Animated.View>;
  const titleEl = <Animated.View style={column}><T v={small ? 'quiz42' : 'auth56'}>{title}</T></Animated.View>;
  const subtitleEl = subtitle ? <Animated.View style={column}>{typeof subtitle === 'string' ? <P>{subtitle}</P> : subtitle}</Animated.View> : null;
  const head = gate.on
    ? <MarkClear state={gate}>
      {eyebrowEl}
      <View style={styles.title}>{titleEl}</View>
      {subtitleEl ? <View style={styles.subtitle}>{subtitleEl}</View> : null}
    </MarkClear>
    : <>
      {flight ? <EyebrowAfterMark>{eyebrowEl}</EyebrowAfterMark> : <Beat n={0}>{eyebrowEl}</Beat>}
      <Beat n={0} style={styles.title}>{titleEl}</Beat>
      {subtitleEl ? <Beat n={1} style={styles.subtitle}>{subtitleEl}</Beat> : null}
    </>;
  const columnBeats = (node: React.ReactNode) => (gate.on ? <PageEnterContext.Provider value={edge}>{node}</PageEnterContext.Provider> : node);
  return <View style={styles.fill} pointerEvents={inert ? 'none' : 'auto'}>
    <FlowScreen backdrop={<AuthBackdrop slot={slot} arrive={flight} leave={lv} />} hairline={false} enter={false}
      footer={footer ? columnBeats(<Beat n={3}><Animated.View style={column}>{footer}</Animated.View></Beat>) : undefined}>
      <BeatBase at={logo ? SIGN_IN_BASE : 0} set={set}>
        {logo ? (flight
          ? <View style={styles.top}><LogoTile leave={lv} column={column} /></View>
          : <Beat n={0} style={styles.top}><LogoTile leave={lv} column={column} /></Beat>) : null}
        {back ? <Beat n={0} style={styles.back}><Animated.View style={column}><Button variant="back" title="Back" onPress={typeof back === 'function' ? back : () => goBack()} /></Animated.View></Beat> : null}
        {head}
        {columnBeats(<>
          {ownBeats ? body : <Beat n={2} style={styles.bodyBeat}>{body}</Beat>}
          {trailing ? <Beat n={3} style={styles.trailing}><Animated.View style={column}>{trailing}</Animated.View></Beat> : null}
        </>)}
      </BeatBase>
    </FlowScreen>
    <Hairline draw={drawLine} go={landed} leave={lv} />
    {overlay}
  </View>;
}

/** When beat `n` of the screen around starts (ms after the page-active edge): for a screen's own parts. */
export { useBeatAt };

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: fx.bg.base },
  band: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  hairline: { position: 'absolute', top: 0, left: 0, right: 0, height: 2, overflow: 'hidden', zIndex: 5 },
  hairlineFill: { width: '100%', height: 2, backgroundColor: fx.red.brand },
  top: { marginTop: 8, marginBottom: 40, alignSelf: 'flex-start' },
  back: { marginTop: -4, marginBottom: 36, alignSelf: 'flex-start', marginLeft: -2 },
  tileBox: { width: 64, height: 64 },
  glass: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: fx.radius.logo, backgroundColor: fx.glass.cardLite, borderWidth: 1, borderColor: fx.line.a10, boxShadow: fx.shadow.logo },
  tile: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
  title: { marginTop: 12 },
  subtitle: { marginTop: 12 },
  bodyBeat: { marginTop: 32 },
  body: { gap: 24 },
  // the sign-in's column fills the screen so its spacer can hold the social buttons and the footer at the bottom
  bodyOwn: { flexGrow: 1, marginTop: 32 },
  trailing: { marginTop: 24 },
});
