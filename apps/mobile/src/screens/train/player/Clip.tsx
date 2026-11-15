/* The player's media (the earlier app's player, shots 35–41, PREMIUM §1.10 "Workout player"):
   - useClip(media): one expo-video player for the clip on screen (muted, looping: the clips have no sound and last a
     few seconds), played only on a tap, paused when the screen loses focus or the app goes to the background;
   - <MediaPager>: the 16:9 area, one page per exercise, swiped or moved with the arrows. Every page keeps one poster
     layer for its whole life (RemoteVideo): the page on screen mounts its clip's video under that poster once the
     member asks for it, and the poster fades out on the video's first frame, so Play never shows a black frame (motion
     v2 M68). A poster that cannot be drawn (refused by the network) shows the category's tile in its place (T3-05),
     and a clip that cannot be loaded says so under the scrubber. Pages more than one away from the one on screen draw nothing (their box keeps the pager's geometry). An
     exercise without a clip shows its category's tile (ExerciseTile: colour and icon, never a photo, which would read
     as someone showing this exercise). The 80 pt play badge springs in from .5 when paused and grows to 1.3 over
     200 ms while it fades over 140 ms when the clip plays. No words are laid over a photo;
   - <ClipControls>: the #0A0A0A strip under it: the exercise name and its place, the red scrubber with mono times
     (or the text-only sentence), replay, previous, the 56 pt red play FAB and next, then the meta chips. Moving to
     another exercise crosses the name, its place and the chips out 8 pt the other way (120 ms) and in from 8 pt
     (180 ms expo), in step with the pager. The scrubber follows the clip on the UI thread: each time update glides it
     to the new place over 250 ms (linear), the fill moving by translateX inside its rounded track and the thumb by
     translateX, so it moves on every frame while the clip plays (reduced motion: stepped). Only the mono times
     re-render, once a second. */
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, Pressable, ScrollView, StyleSheet, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { Icon, IconButton, RemoteVideo, T, calmFade, ease, fx, motionValues, t, timing, useFx, useRemoteVideo, withAlpha, type IconName } from '@/fx';
import { ExerciseTile, PosterFallback } from '../ExerciseTile';
import { Swap } from '../motion';
import { hasClip, inkFor, mmss, serverUrl, type Media } from '../shared';

export const TEXT_ONLY = 'Exercises are described in text only; demonstration media is not available yet.';
/** The same, for one exercise among others that have clips (a page of the workout player). */
export const TEXT_ONLY_HERE = 'This exercise is described in text only; demonstration media is not available yet.';
/** Under the scrubber when the clip could not be loaded (the poster stays). */
export const CLIP_FAILED = 'The clip could not be loaded. Check your connection, then open this exercise again.';
/** Under a clip: what it is, and where its source is written down (the credit stays on the Photo credits screen, in
 *  words for the member rather than the team's note the API sends). */
export const CLIP_NOTE = 'Demonstration clip. Where the clips come from is listed under Profile › Settings › Photo credits.';

const S = motionValues.screens;
/** The paused badge's start scale as it springs back in (the earlier app's .5). */
const BADGE_IN_FROM = 0.5;

/** A page of the pager as the strip's title shows it. */
export type StripTitle = { name: string; position: string };

export type Clip = {
  uri: string | null;
  player: ReturnType<typeof useRemoteVideo> | null;
  /** The member asked for the clip: until then the poster shows (no first-frame flash). */
  started: boolean;
  playing: boolean;
  /** The clip could not be loaded (the player's status is 'error'): the poster stays and the strip says so. */
  failed: boolean;
  duration: number;
  toggle: () => void;
  pause: () => void;
  /** Pause and put the poster back (before the clip changes: the web player plays a new source at once). */
  stop: () => void;
  seek: (t: number) => void;
  replay: () => void;
};

export function useClip(media: Media): Clip {
  const uri = serverUrl(media?.videoUrl);
  const player = useRemoteVideo(uri, { muted: true, loop: true });
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const want = useRef<'play' | 'replay' | null>(null);
  const pause = useCallback(() => { try { if (player.playing) player.pause(); } catch { /* released */ } }, [player]);
  useEffect(() => {
    setPlaying(false);
    setStarted(false);
    setFailed(false);
    try { player.timeUpdateEventInterval = S.m76.scrubMs / 1000; } catch { /* released */ }
    try { if (player.status === 'error') setFailed(true); } catch { /* released */ }
    const a = player.addListener('playingChange', ({ isPlaying }) => setPlaying(isPlaying));
    const b = player.addListener('statusChange', ({ status }) => setFailed(status === 'error'));
    return () => { a.remove(); b.remove(); };
  }, [player, uri]);
  // the video view mounts on the first request; play once it is there
  useEffect(() => {
    if (!started || !want.current) return;
    const what = want.current;
    want.current = null;
    // after the video view has registered with the player (its own effect runs in the same commit)
    const timer = setTimeout(() => { try { if (what === 'replay') player.currentTime = 0; player.play(); } catch { /* released */ } }, 30);
    return () => clearTimeout(timer);
  }, [started, player]);
  useFocusEffect(useCallback(() => pause, [pause]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => { if (st !== 'active') pause(); });
    return () => sub.remove();
  }, [pause]);
  const duration = media?.durationSeconds ?? 0;
  const request = (what: 'play' | 'replay') => { want.current = what; setStarted(true); };
  return {
    uri, player, started, playing: !!uri && playing, failed: !!uri && failed, duration, pause,
    stop: () => { pause(); want.current = null; setStarted(false); },
    toggle: () => { if (!uri) return; if (!started) { request('play'); return; } try { if (player.playing) player.pause(); else player.play(); } catch { /* released */ } },
    seek: (to) => { if (!uri) return; try { player.currentTime = Math.max(0, Math.min(duration || to, to)); } catch { /* released */ } },
    replay: () => { if (!uri) return; if (!started) { request('replay'); return; } try { player.currentTime = 0; player.play(); } catch { /* released */ } },
  };
}

const noop = () => undefined;
/** No clip (nothing loaded yet, or an exercise without one). */
export const NO_CLIP: Clip = { uri: null, player: null, started: false, playing: false, failed: false, duration: 0, toggle: noop, pause: noop, stop: noop, seek: noop, replay: noop };

/** One player per exercise: mount it keyed by the exercise, so a new clip gets a new player instead of a source swap
 *  (the web player starts a swapped source at once). It reports its state to the screen (never its time: the
 *  scrubber reads that itself, so the screen does not re-render while the clip plays). `start`: what the member asked
 *  for before this player was made (useClipHost), done once on its first commit. */
export function ClipHost({ media, onClip, start }: { media: Media; onClip: (c: Clip) => void; start?: React.MutableRefObject<'play' | 'replay' | null> }) {
  const c = useClip(media);
  useEffect(() => { onClip(c); }, [c.uri, c.started, c.playing, c.failed, c.duration, c.player]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onClip(NO_CLIP), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const asked = start?.current;
    if (!asked || !start) return;
    start.current = null;
    if (asked === 'replay') c.replay(); else c.toggle();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Runs `job` in the next idle moment (a JS timer where there is no idle callback, as on the web); returns its cancel. */
function whenIdle(job: () => void): () => void {
  const w = globalThis as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
  if (w.requestIdleCallback) {
    const h = w.requestIdleCallback(job, { timeout: t.premount });
    return () => w.cancelIdleCallback?.(h);
  }
  const timer = setTimeout(job, 0);
  return () => clearTimeout(timer);
}

/** The workout player's clip, its player made late (release UX-04): making an expo-video player costs the JS thread
 *  50-70 ms on a small Android phone and then queues its preparation on the UI thread, which held the frame that swaps
 *  the strip's frame for its controls (115-200 ms with no new frame on the gate's films). So the player (ClipHost,
 *  returned as `host` for the screen to render) is made `afterMs` after the screen says it has drawn (`ready`; the
 *  player's t.settle: its opening motion is over by then, and the first player of a run costs the UI thread ~100 ms
 *  on the emulator), in the next idle moment; until then `clip` is a stand-in with the clip's address and length, whose Play and Replay make
 *  the player at once and are done as soon as it exists (a tap is never lost). `key` names the exercise: a new one
 *  gets a new player (ClipHost is keyed by it), at once once the first has been made. */
export function useClipHost(media: Media | undefined, key: string | null, ready: boolean, afterMs: number): { clip: Clip; host: React.ReactNode } {
  const [clip, setClip] = useState<Clip>(NO_CLIP);
  const [on, setOn] = useState(false);
  const start = useRef<'play' | 'replay' | null>(null);
  useEffect(() => {
    if (on || !ready) return;
    let cancelIdle: (() => void) | null = null;
    const timer = setTimeout(() => { cancelIdle = whenIdle(() => setOn(true)); }, afterMs);
    return () => { clearTimeout(timer); cancelIdle?.(); };
  }, [on, ready, afterMs]);
  useEffect(() => { start.current = null; }, [key]); // a request is for the exercise it was made on
  const uri = serverUrl(media?.videoUrl);
  const duration = media?.durationSeconds ?? 0;
  const standIn = useMemo<Clip>(() => {
    const ask = (what: 'play' | 'replay') => () => { if (!uri) return; start.current = what; setOn(true); };
    return { ...NO_CLIP, uri, duration, toggle: ask('play'), replay: ask('replay') };
  }, [uri, duration]);
  const host = on && key ? <ClipHost key={key} media={media ?? null} onClip={setClip} start={start} /> : null;
  return { clip: on && clip.player ? clip : standIn, host };
}

export type ClipPage = { key: string; media: Media; category: string | null; name: string };

/** The 16:9 pages. `index` is the page on screen; a swipe reports the new one through `onIndex`. */
export function MediaPager({ pages, index, onIndex, clip, width, height, cover }: { pages: ClipPage[]; index: number; onIndex: (i: number) => void; clip: Clip; width: number; height: number;
  /** The picture under the pager (the player's cover): a page showing the same poster keeps no dark ground, so the
   *  cover shows through until its poster draws (no dark frame as the clips fade in over the landed photo). */
  cover?: string | null }) {
  const { calm } = useFx();
  const ref = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shown = useRef(index);
  useEffect(() => {
    if (shown.current === index) return;
    shown.current = index;
    ref.current?.scrollTo({ x: index * width, animated: !calm });
  }, [index, width, calm]);
  useEffect(() => { ref.current?.scrollTo({ x: shown.current * width, animated: false }); }, [width]);
  useEffect(() => () => { if (settle.current) clearTimeout(settle.current); }, []);
  const onScroll = (x: number) => {
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      const i = Math.max(0, Math.min(pages.length - 1, Math.round(x / width)));
      if (i !== shown.current) { shown.current = i; onIndex(i); }
    }, 140);
  };
  const page = (p: ClipPage, i: number) => {
    const current = i === index;
    // the page on screen and its neighbours draw (a swipe reaches a drawn page); the rest keep their box only
    const near = Math.abs(i - index) <= 1;
    const poster = serverUrl(p.media?.posterUrl);
    const clipHere = current && hasClip(p.media);
    const live = clipHere && clip.started;
    // an opaque ground: nothing under the pager (the cover the photo flew in as) shows through a tile page; a page
    // whose poster is the cover itself lets the cover show until that poster draws
    const same = !!poster && poster === cover;
    return <View key={p.key} style={[same ? null : styles.page, { width, height }]}>
      {!near ? null : poster || clipHere
        ? <RemoteVideo player={clipHere ? clip.player : null} active={live} poster={poster} ground={!same} alt={live ? `${p.name}, demonstration video` : `${p.name}, video poster`} style={StyleSheet.absoluteFill}
          fallback={<PosterFallback category={p.category} size="hero" glyph={!hasClip(p.media)} />} />
        : <ExerciseTile category={p.category} size="hero" style={StyleSheet.absoluteFill} />}
      {clipHere ? <Pressable accessibilityRole="button" accessibilityLabel={clip.playing ? `Pause ${p.name} video` : `Play ${p.name} video`} onPress={clip.toggle} style={styles.tap}>
        <PlayBadge shown={!clip.playing} />
      </Pressable> : null}
    </View>;
  };
  if (pages.length <= 1) return <View style={{ width, height }}>{pages.map(page)}</View>;
  return <ScrollView
    ref={ref}
    horizontal
    pagingEnabled
    showsHorizontalScrollIndicator={false}
    scrollEventThrottle={32}
    onScroll={(e) => onScroll(e.nativeEvent.contentOffset.x)}
    contentOffset={{ x: index * width, y: 0 }}
    style={{ width, height }}>
    {pages.map(page)}
  </ScrollView>;
}

/** The centre play badge: 80 pt, black/60 with a white/20 ring. In from .5 (200 ms); out to 1.3 over 200 ms while it
 *  fades over 140 ms. Tier C: a 200 ms fade; reduced motion: a 150 ms fade. */
function PlayBadge({ shown }: { shown: boolean }) {
  const { calm, tier } = useFx();
  const s = useSharedValue(shown ? 1 : S.m68.badgeOutScale);
  const o = useSharedValue(shown ? 1 : 0);
  useEffect(() => {
    if (calm || tier === 'C') { s.value = 1; o.value = withTiming(shown ? 1 : 0, calm ? calmFade() : timing(S.m68.cFadeMs, ease.linear)); return; }
    if (shown) { s.value = withSequence(withTiming(BADGE_IN_FROM, { duration: 0 }), withTiming(1, timing(t.fast))); o.value = withTiming(1, timing(t.fast)); }
    else { s.value = withTiming(S.m68.badgeOutScale, timing(S.m68.badgeOutMs)); o.value = withTiming(0, timing(S.m76.playBadgeOutMs)); }
  }, [shown, calm, tier, s, o]);
  const a = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ scale: s.value }] }));
  return <Animated.View pointerEvents="none" style={[styles.badge, a]}>
    <Icon name="play" size={32} color={fx.ink.white} fill={fx.ink.white} />
  </Animated.View>;
}

/** The control strip under the media. `swapKey` names the exercise shown (a change crosses the name and chips over in
 *  `dir`: +1 the next one, −1 the previous). In the pager (the player) Previous and Next keep their places on every
 *  page: a page without a clip keeps the play button's 56 pt place, and with `mixed` (the pager holds pages with a clip
 *  and pages without one) the place under the title is as tall as the taller of the scrubber and the text-only
 *  sentence, at any text size (Slot). `arrive`:
 *  the strip replaces a frame that was still waiting for the session (ClipControlsFrame without a name, whose round
 *  controls are plain discs) after the opening flight, so its controls fade in over t.fast (tier C linear; reduced
 *  motion: at once) instead of popping in; a frame drawn with the session already looks like the strip (CRT-3), which
 *  then replaces it as it is. A clip that could not be loaded says so under the scrubber. */
export function ClipControls({ clip, media, name, position, onPrev, onNext, swapKey, dir = 1, arrive, mixed, titles, children }: {
  clip: Clip; media: boolean; name: string; position?: string; onPrev?: () => void; onNext?: () => void; swapKey?: string; dir?: 1 | -1; arrive?: boolean; mixed?: boolean;
  /** Every page's name and place (the pager): the title's place is as tall as the tallest of them. */
  titles?: StripTitle[]; children?: React.ReactNode;
}) {
  const { calm, tier } = useFx();
  const pager = onPrev || onNext;
  const key = swapKey ?? name;
  const strip = { outD: S.m76.stripX, outMs: S.m76.stripOutMs, inD: S.m76.stripX, inMs: S.m76.stripInMs };
  const [fade] = useState(!!arrive && !calm);
  const shown = useSharedValue(fade ? 0 : 1);
  useEffect(() => {
    if (!fade) return;
    shown.set(withTiming(1, tier === 'C' ? timing(t.fast, ease.linear) : timing(t.fast)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const controls = useAnimatedStyle(() => (shown.get() >= 1 ? { opacity: 1 } : { opacity: shown.get() }));
  return <View style={styles.strip}>
    <View style={styles.column}>
      <Slot others={otherTitles(titles, position)}>
        <Swap id={key} dir={dir} timing={strip}>
          <TitleRow name={name} position={position} />
        </Swap>
      </Slot>
      {media ? <Slot reach others={mixed ? [<TextOnlyShape key="t" />] : null}><Scrubber key={clip.uri ?? 'none'} clip={clip} /></Slot>
        : <Slot reach others={mixed ? [<ScrubberShape key="s" duration={0} />] : null}><View style={styles.textOnly}>
          <Icon name="info" size={14} color={fx.ink.a50} />
          {pager ? <T v="bodySm" color={fx.ink.a60} style={styles.flex}>{TEXT_ONLY_HERE}</T>
            : <T v="bodySm" color={fx.ink.a60} style={styles.flex}>{TEXT_ONLY}</T>}
        </View></Slot>}
      {media && clip.failed && clip.started ? <View style={styles.textOnly} accessibilityLiveRegion="polite">
        <Icon name="info" size={14} color={fx.red.label} />
        <T v="bodySm" color={fx.ink.a80} style={styles.flex}>{CLIP_FAILED}</T>
      </View> : null}
      {media || pager ? <Animated.View style={[styles.buttons, controls]}>
        <View style={styles.side}>{media ? <IconButton icon="rotate-ccw" label="Play from the start" onPress={clip.replay} iconSize={18} /> : null}</View>
        <View style={styles.centre}>
          {pager ? <IconButton icon="chevron-left" label="Previous exercise" onPress={onPrev} disabled={!onPrev} iconSize={20} /> : null}
          {media ? <IconButton kind="fab" icon={clip.playing ? 'pause' : 'play'} label={clip.playing ? `Pause ${name} video` : `Play ${name} video`} onPress={clip.toggle} />
            : pager ? <View style={styles.disc56} /> : null}
          {pager ? <IconButton icon="chevron-right" label="Next exercise" onPress={onNext} disabled={!onNext} iconSize={20} /> : null}
        </View>
        <View style={styles.side} />
      </Animated.View> : null}
      {children ? <Swap id={key} dir={dir} timing={strip}><View style={styles.meta}>{children}</View></Swap> : null}
    </View>
  </View>;
}

/** The strip's frame for the player's first frames (M69 fix round): ClipControls' layout drawn with plain views, so the
 *  strip replaces it in place once the photo has landed. Nothing in it takes a touch or is announced. With the session
 *  known it is drawn as the strip draws itself then (CRT-3: grey discs held the controls' place for about 450 ms of
 *  every tier-A open): the exercise's name and place, the track with its thumb at the start and its times, the round
 *  controls with their glyphs (Play: nothing plays before the strip is there; Previous and Next dimmed as the strip
 *  dims a disabled one, `prev` and `next`), the chips with their icons, so the swap is unseen. Without the session yet
 *  (`name` null) it is a plain stand-in: the title a bar, the track without its thumb, the round controls fx.fill.a05
 *  discs (the strip's controls fade in over them: ClipControls' `arrive`). */
export function ClipControlsFrame({ name, position, media, pager, prev, next, mixed, titles, duration, chips }: {
  name: string | null; position?: string; media: boolean; pager: boolean;
  /** The page has one before it (Previous enabled), one after it (Next enabled). */
  prev?: boolean; next?: boolean;
  mixed?: boolean; titles?: StripTitle[]; duration: number; chips: Array<{ icon?: IconName; text: string; color?: string }>;
}) {
  return <View style={styles.strip} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
    <View style={styles.column}>
      {name ? <Slot others={otherTitles(titles, position)}><TitleRow name={name} position={position} /></Slot> : <View style={styles.titleRow}>
        <View style={[styles.flex, styles.titleBar]} />
        {position ? <T v="mono12" color={fx.ink.a50}>{position}</T> : null}
      </View>}
      {media ? <Slot reach others={mixed ? [<TextOnlyShape key="t" />] : null}><ScrubberShape duration={duration} thumb={!!name} /></Slot>
        : <Slot reach others={mixed ? [<ScrubberShape key="s" duration={0} />] : null}><View style={styles.textOnly}>
          <Icon name="info" size={14} color={fx.ink.a50} />
          <T v="bodySm" color={fx.ink.a60} style={styles.flex}>{pager ? TEXT_ONLY_HERE : TEXT_ONLY}</T>
        </View></Slot>}
      {(media || pager) && name ? <View style={styles.buttons}>
        <View style={styles.side}>{media ? <StillButton icon="rotate-ccw" iconSize={18} /> : null}</View>
        <View style={styles.centre}>
          {pager ? <StillButton icon="chevron-left" iconSize={20} disabled={!prev} /> : null}
          {media ? <StillButton icon="play" fab /> : pager ? <View style={styles.disc56} /> : null}
          {pager ? <StillButton icon="chevron-right" iconSize={20} disabled={!next} /> : null}
        </View>
        <View style={styles.side} />
      </View> : media || pager ? <View style={styles.buttons}>
        <View style={styles.side}>{media ? <View style={[styles.disc, styles.disc36]} /> : null}</View>
        <View style={styles.centre}>
          {pager ? <View style={[styles.disc, styles.disc36]} /> : null}
          {media ? <View style={[styles.disc, styles.disc56]} /> : pager ? <View style={styles.disc56} /> : null}
          {pager ? <View style={[styles.disc, styles.disc36]} /> : null}
        </View>
        <View style={styles.side} />
      </View> : null}
      {chips.length ? <View style={styles.meta}>
        {chips.map((c) => <MetaChip key={c.text} icon={c.icon} text={c.text} color={c.color} />)}
      </View> : null}
    </View>
  </View>;
}

/** A round control as the kit's IconButton draws it at rest, without its press (the strip's frame): 'round' (36 pt,
 *  fx.fill.a05 with a fx.line.a10 ring, a white glyph) or the 56 pt red FAB with its glow and a filled white glyph;
 *  `disabled` at IconButton's .3. */
function StillButton({ icon, fab, iconSize, disabled }: { icon: IconName; fab?: boolean; iconSize?: number; disabled?: boolean }) {
  return <View style={disabled ? styles.dim : null}>
    <View style={fab ? styles.still56 : styles.still36}>
      <Icon name={icon} size={fab ? 26 : iconSize ?? 18} color={fx.ink.white} fill={fab ? fx.ink.white : undefined} />
    </View>
  </View>;
}

/** A place in the strip that keeps one height from page to page (T2-21): `children` is what the page shows, and each
 *  of `others` (what other pages show there) is laid out in the same place, never seen, touched or announced: a row
 *  of full-width cells, each after the first pulled back over it by its own width, so the place is as tall as the
 *  tallest of them at any text size and Previous and Next under it stay put. Used in the pager for the title (every
 *  page's name: one may take two lines) and, with pages with a clip and pages without one, for the scrubber and the
 *  text-only sentence (a font scale of 1.3 makes the sentence three lines, taller than the scrubber). `reach`: each
 *  cell keeps the scrubber's 8 pt touch reach inside its own box (Android delivers no touch outside a parent's
 *  bounds). */
function Slot({ others, reach, children }: { others: React.ReactNode[] | null; reach?: boolean; children: React.ReactNode }) {
  if (!others?.length) return <>{children}</>;
  const cell = [styles.slotCell, reach ? styles.slotReach : null];
  return <View style={[styles.slot, reach ? styles.slotReach : null]}>
    <View style={cell}>{children}</View>
    {others.map((o, i) => <View key={i} style={[cell, styles.slotOther]} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>{o}</View>)}
  </View>;
}

/** The strip's title row: the exercise's name (two lines at most) and its place in the session. */
function TitleRow({ name, position }: { name: string; position?: string }) {
  return <View style={styles.titleRow}>
    <T v="cardTitle" style={styles.flex} numberOfLines={2}>{name}</T>
    {position ? <T v="mono12" color={fx.ink.a50}>{position}</T> : null}
  </View>;
}
/** The other pages' title rows (every page but the one at `position`), for the title's Slot (null outside a pager). */
const otherTitles = (titles: StripTitle[] | undefined, position: string | undefined) => (titles && titles.length > 1 ? titles.filter((x) => x.position !== position).map((x) => <TitleRow key={x.position} name={x.name} position={x.position} />) : null);

/** The scrubber's and its times' shape, drawn with plain views: the strip's frame (with the scrubber's thumb at the
 *  start, `thumb`, where the scrubber draws it before the clip plays), and the place a page without a clip holds in a
 *  mixed pager. */
function ScrubberShape({ duration, thumb }: { duration: number; thumb?: boolean }) {
  return <>
    <View style={styles.scrub}><View style={styles.track} />{thumb ? <View style={styles.thumb} /> : null}</View>
    <View style={styles.times}>
      <T v="mono12" color={fx.ink.a80}>{mmss(0)}</T>
      <T v="mono12" color={fx.ink.a80}>{mmss(duration)}</T>
    </View>
  </>;
}

/** The pager's text-only sentence (the place a page with a clip holds in a mixed pager). */
function TextOnlyShape() {
  return <View style={styles.textOnly}>
    <View style={styles.icon14} />
    <T v="bodySm" color={fx.ink.a60} style={styles.flex}>{TEXT_ONLY_HERE}</T>
  </View>;
}

/** The scrubber and its mono times, following the clip's own time updates (see the header). The track and its fill
 *  take no touch (the press is the scrubber's own, so a tap seeks where it lands on the track, the played part as the
 *  rest); its touch band is 44 pt tall around the 28 pt it lays out (a negative margin keeps the strip's spacing). The
 *  fill is hidden until the track has a width (it would draw full for a frame) and a new clip mounts a new scrubber
 *  (keyed), so it starts empty. Screen readers get the position as the scrubber's value, updated when the clip is
 *  paused or sought, never while it plays (the mono times are not announced): nothing is spoken during playback. (The
 *  moving thumb and fill and the mono times still change the window's content as they move; Android's uiautomator,
 *  which waits for a whole second without any change, cannot dump the screen while a clip plays.) Shared values are read with get() outside worklets (the React Compiler would read
 *  `.value` during render to memoise a handler). */
function Scrubber({ clip }: { clip: Clip }) {
  const { calm } = useFx();
  const player = clip.player;
  const duration = clip.duration;
  const width = useSharedValue(0);
  const share = useSharedValue(0);
  const now = useRef(0);
  const [sec, setSec] = useState(0);
  // the value spoken: the position when the clip stops or the member seeks, never while it plays (not on a loop either:
  // the clips restart every few seconds, so a member resting on the scrubber heard '00:00 of 00:04' again and again)
  const [spoken, setSpoken] = useState(0);
  const playing = clip.playing;
  useEffect(() => { if (!playing) setSpoken(Math.floor(now.current)); }, [playing, sec]);
  useEffect(() => {
    now.current = 0;
    setSec(0);
    setSpoken(0);
    share.set(0);
    if (!player) return;
    const sub = player.addListener('timeUpdate', ({ currentTime }) => {
      const at = duration > 0 ? Math.min(currentTime, duration) : currentTime;
      const back = at < now.current; // a loop or a seek backwards: jump, never glide back
      now.current = at;
      const p = duration > 0 ? Math.max(0, Math.min(1, at / duration)) : 0;
      share.set(calm || back ? p : withTiming(p, timing(S.m76.scrubMs, ease.linear)));
      const whole = Math.floor(at);
      setSec((v) => (v === whole ? v : whole));
    });
    return () => sub.remove();
  }, [player, duration, calm, share]);
  const seekAt = (x: number | null) => {
    const w = width.get();
    if (x == null || w <= 0 || duration <= 0) return;
    const to = Math.max(0, Math.min(1, x / w)) * duration;
    clip.seek(to);
    setSpoken(Math.floor(to));
  };
  const fill = useAnimatedStyle(() => {
    const w = width.get();
    return w > 0 ? { opacity: 1, transform: [{ translateX: -(1 - share.get()) * w }] } : { opacity: 0, transform: [] };
  });
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: Math.max(0, share.get() * width.get() - THUMB / 2) }] }));
  const onLayout = (e: LayoutChangeEvent) => { const w = e.nativeEvent.layout.width; if (w > 0) width.set(w); };
  const value = useMemo(() => ({ min: 0, max: Math.round(duration), now: spoken, text: `${mmss(spoken)} of ${mmss(duration)}` }), [spoken, duration]);
  return <>
    <Pressable
      accessibilityRole="adjustable"
      accessibilityLabel="Video position"
      accessibilityValue={value}
      accessibilityActions={ADJUST}
      onAccessibilityAction={(e) => { const to = Math.max(0, now.current + (e.nativeEvent.actionName === 'increment' ? 1 : -1)); clip.seek(to); setSpoken(Math.floor(to)); }}
      onLayout={onLayout}
      onPress={(e) => seekAt(pressX(e))}
      style={styles.scrub}>
      <View pointerEvents="none" style={styles.track}><Animated.View style={[styles.fill, fill]} /></View>
      <Animated.View pointerEvents="none" style={[styles.thumb, thumb]} />
    </Pressable>
    <View style={styles.times} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
      <T v="mono12" color={fx.ink.a80}>{mmss(sec)}</T>
      <T v="mono12" color={fx.ink.a80}>{mmss(duration)}</T>
    </View>
  </>;
}
const ADJUST = [{ name: 'increment' }, { name: 'decrement' }];

/** Where a press landed along the scrubber (pt from its left edge), or null (a key press). Native: locationX, relative
 *  to the scrubber itself (its track and thumb take no touch). The web's press event has no locationX: the pointer's
 *  clientX less the scrubber's own left edge. */
function pressX(e: GestureResponderEvent): number | null {
  const n = e.nativeEvent as unknown as { locationX?: number; clientX?: number };
  if (Platform.OS === 'web') {
    const box = e.currentTarget as unknown as { getBoundingClientRect?: () => { left: number } };
    return typeof n.clientX === 'number' && box?.getBoundingClientRect ? n.clientX - box.getBoundingClientRect().left : null;
  }
  return typeof n.locationX === 'number' && Number.isFinite(n.locationX) ? n.locationX : null;
}

/** A meta chip of the strip: icon and words, or a coloured pill. */
export function MetaChip({ icon, text, color }: { icon?: React.ComponentProps<typeof Icon>['name']; text: string; color?: string }) {
  if (color) return <View style={[styles.pill, { backgroundColor: withAlpha(color, 0.15), borderColor: withAlpha(color, 0.3) }]}>
    {icon ? <Icon name={icon} size={12} color={inkFor(color)} /> : null}
    <T v="micro" color={inkFor(color)} style={styles.pillText}>{text}</T>
  </View>;
  return <View style={styles.metaChip}>
    {icon ? <Icon name={icon} size={14} color={fx.ink.white} /> : null}
    <T v="bodySm" color={fx.ink.white}>{text}</T>
  </View>;
}

/** The scrubber thumb's diameter (pt). */
const THUMB = 16;
/** The scrubber's touch reach above and below its 28 pt (44 pt in all). */
const SCRUB_REACH = 8;

const styles = StyleSheet.create({
  page: { backgroundColor: fx.bg.deep },
  tap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  badge: { width: 80, height: 80, borderRadius: 40, backgroundColor: fx.glass.onPhoto, borderWidth: 1, borderColor: fx.line.a20, alignItems: 'center', justifyContent: 'center', paddingLeft: 4 },
  strip: { backgroundColor: fx.bg.panel, borderBottomWidth: 1, borderBottomColor: fx.line.a05, paddingTop: 16, paddingBottom: 20 },
  column: { width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: 20, gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
  // the 28 pt scrubber takes a touch 44 pt tall: SCRUB_REACH above and below inside a matching negative margin
  scrub: { height: 28 + 2 * SCRUB_REACH, marginVertical: -SCRUB_REACH, justifyContent: 'center' },
  track: { height: 3, borderRadius: 2, backgroundColor: fx.ink.zinc300, overflow: 'hidden' },
  fill: { ...StyleSheet.absoluteFill, backgroundColor: fx.red.brand },
  thumb: { position: 'absolute', left: 0, top: 6 + SCRUB_REACH, width: THUMB, height: THUMB, borderRadius: THUMB / 2, backgroundColor: fx.red.brand, boxShadow: fx.shadow.dot },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -6 },
  textOnly: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  // Slot: cells in one place (the row is as tall as the tallest); each cell lays out as the strip's column does (gap 12
  // between the scrubber and its times); slotReach: the row and its cells reach SCRUB_REACH above their content, where
  // the scrubber's touch band starts
  slot: { flexDirection: 'row', alignItems: 'flex-start' },
  slotCell: { width: '100%', gap: 12 },
  slotReach: { marginTop: -SCRUB_REACH, paddingTop: SCRUB_REACH },
  slotOther: { marginLeft: '-100%', opacity: 0 },
  buttons: { flexDirection: 'row', alignItems: 'center' },
  side: { width: 52, alignItems: 'flex-start' },
  centre: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 28 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 16, rowGap: 8 },
  metaChip: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 5, borderRadius: fx.radius.pill, borderWidth: 1 },
  pillText: { fontSize: 11, letterSpacing: 1.6 },
  // the frame's stand-ins (the sizes of the controls and glyphs they hold the place of)
  titleBar: { height: 14, maxWidth: 180, borderRadius: 7, backgroundColor: fx.fill.a05 },
  disc: { backgroundColor: fx.fill.a05 },
  disc36: { width: 36, height: 36, borderRadius: 18 },
  disc56: { width: 56, height: 56, borderRadius: 28 },
  icon14: { width: 14, height: 14 },
  // StillButton: the kit IconButton's 'round' and 'fab' looks at rest
  still36: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: fx.fill.a05, borderWidth: 1, borderColor: fx.line.a10 },
  still56: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: fx.red.fill, boxShadow: fx.shadow.fab },
  dim: { opacity: 0.3 },
});
