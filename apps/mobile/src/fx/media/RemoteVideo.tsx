/* Exercise video from the Bioptime server (AMENDED §7): one 720p H.264 rendition and a colour poster, both served by
   the API. Release 1.0.0 bundles the served files in the phone apps (./bundledMedia): a clip whose file is bundled
   plays from the app itself; any other streams. expo-video plays a streamed one with the preview gate's header
   (lib/config gateHeaders) and caching on iOS and Android. The web's <video> cannot send headers, so the web build
   plays these only where no gate is in front of the server (the web build is not used through the gate).
   - useRemoteVideo(uri, { muted, loop }) gives the player (the workout player drives play, pause and seek itself);
   - <RemoteVideo player poster active /> draws it: one poster layer, mounted for the box's whole life, over the video.
     The video view mounts beneath the poster while `active` (the member asked for the clip) and the poster fades out
     on its first frame (motion v2 M68: 300 ms expo; tier C 200 ms; reduced motion 150 ms), so pressing Play never
     shows a black frame: the picture stays until the video has one of its own. Stopped again, the poster is back at
     once. A failed video keeps the poster; a poster that is missing or fails shows the caller's `fallback` (Train: the
     exercise's category tile) in its place, under the video all the same (T3-05);
   - inside a photo copy (a morph flight, src/fx/motion/PhotoMorph useMorphCopy) only the poster is drawn, never a
     second view of the same player (on the web a second <video> of one player pauses the first when it goes);
   - only one video plays at a time in the app: starting one pauses the others;
   - videos never start by themselves under reduced motion (autoPlay is ignored then).
   Clips are from the owner's earlier app (generated); rights confirmed by the owner on 30 Oct 2026; to be replaced
   with filmed clips. Exercises whose clip failed review have no video: the screen shows its text-only guide. */
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView, type VideoPlayer, type VideoSource } from 'expo-video';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { gateHeaders } from '@/lib/config';
import { fx } from '@/theme';
import { useFx } from '../effects';
import { useMorphCopy } from '../motion/PhotoMorph';
import { calmFade, ease, motionValues, timing } from '../motion/tokens';
import { bundledMedia } from './bundledMedia';
import { RemotePhoto } from './RemotePhoto';

const players = new Set<VideoPlayer>();
const M68 = motionValues.screens.m68;

/** The kit's RemotePhoto, given what it draws when its picture is missing or fails (its `fallback`). */
type PosterProps = React.ComponentProps<typeof RemotePhoto> & { fallback?: React.ReactNode };
const Poster: React.ComponentType<PosterProps> = RemotePhoto;

/** The source for a server video: the bundled file when the app has it, else the gate header when one applies,
 *  cached on native. */
export function videoSource(uri: string | null | undefined): VideoSource {
  if (!uri) return null;
  const local = bundledMedia(uri);
  if (local != null) return local;
  const headers = gateHeaders(uri);
  return Object.keys(headers).length ? { uri, headers, useCaching: true } : { uri, useCaching: true };
}

export function useRemoteVideo(uri: string | null | undefined, opts: { muted?: boolean; loop?: boolean; autoPlay?: boolean } = {}): VideoPlayer {
  const { calm } = useFx();
  const player = useVideoPlayer(videoSource(uri), (p) => {
    p.muted = opts.muted ?? false;
    p.loop = opts.loop ?? false;
    if (opts.autoPlay && !calm) p.play();
  });
  useEffect(() => {
    players.add(player);
    const sub = player.addListener('playingChange', ({ isPlaying }) => {
      if (isPlaying) players.forEach((other) => { if (other !== player) { try { other.pause(); } catch { /* released */ } } });
    });
    return () => { sub.remove(); players.delete(player); };
  }, [player]);
  return player;
}

/** One video box: the poster always, the video under it while `active` (default true) and a player is given. */
export function RemoteVideo({ player, poster, alt, style, contentFit = 'cover', nativeControls = false, fallbackSlot, fallback, active = true, ground = true }: {
  player: VideoPlayer | null; poster?: string | null; alt?: string; style?: StyleProp<ViewStyle>; contentFit?: 'cover' | 'contain'; nativeControls?: boolean; fallbackSlot?: string;
  /** Drawn in the poster's place when the poster is missing or fails (before `fallbackSlot`). */
  fallback?: React.ReactNode;
  /** The member asked for the clip: the video view mounts (under the poster) and the poster leaves on its first frame. */
  active?: boolean;
  /** The box's dark ground (default). Off where the same picture already lies under the box (the player's cover under
   *  its first page): until the poster draws, that picture shows through instead of a dark frame. */
  ground?: boolean;
}) {
  const { calm, inHtml, tier } = useFx();
  const copy = useMorphCopy();
  const live = !!player && active && !copy && !inHtml;
  const shown = useSharedValue(1); // the poster's opacity
  const [failed, setFailed] = useState(false);
  // a new clip (or the clip stopped): the poster is back at once
  useEffect(() => { if (!live) { shown.value = 1; setFailed(false); } }, [live, player, shown]);
  useEffect(() => { if (failed) shown.value = 1; }, [failed, shown]);
  const firstFrame = () => {
    if (failed) return;
    shown.value = withTiming(0, calm ? calmFade() : tier === 'C' ? timing(M68.cFadeMs, ease.linear) : timing(M68.posterFadeMs));
  };
  const posterStyle = useAnimatedStyle(() => ({ opacity: shown.value }));
  return <View accessible={!!alt} accessibilityLabel={alt} accessibilityRole={alt ? 'image' : undefined} style={[styles.box, ground ? styles.ground : null, style]}>
    {live && player ? <VideoLayer player={player} nativeControls={nativeControls} contentFit={contentFit} onFirstFrame={firstFrame} onFailed={setFailed} /> : null}
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, posterStyle]}>
      <Poster uri={poster} fallbackSlot={fallbackSlot} fallback={fallback} decorative style={StyleSheet.absoluteFill} />
    </Animated.View>
  </View>;
}

/** The video view and its status (mounted only while the clip is asked for). */
function VideoLayer({ player, nativeControls, contentFit, onFirstFrame, onFailed }: {
  player: VideoPlayer; nativeControls: boolean; contentFit: 'cover' | 'contain'; onFirstFrame: () => void; onFailed: (f: boolean) => void;
}) {
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  const failed = status === 'error';
  useEffect(() => { onFailed(failed); }, [failed]); // eslint-disable-line react-hooks/exhaustive-deps
  if (failed) return null;
  // the box sized in full, not only pinned by its insets: on the web the style reaches a <video>, and a replaced element
  // pinned by insets alone keeps its own 1280x720 size (the frame then shows its top-left corner only). No picture in
  // picture: the app does not offer it (Android logged an error for every clip otherwise)
  return <VideoView player={player} nativeControls={nativeControls} contentFit={contentFit} onFirstFrameRender={onFirstFrame}
    allowsPictureInPicture={false} startsPictureInPictureAutomatically={false} style={styles.video} />;
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden' },
  ground: { backgroundColor: fx.bg.deep },
  video: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
});
