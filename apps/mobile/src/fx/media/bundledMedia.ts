/* The exercise clips and their posters, bundled in the app (release 1.0.0; the owner's request of 4 Nov 2026: every
   clip shows and plays at once and smoothly, also on a slow link). Generated from the API's exercise manifest by the
   release round: the same files the server serves, under the same content-hashed names. A clip the server has
   changed (a new name) or one not listed here still streams from the server (fx/media videoSource and RemotePhoto).
   Phones only: the web build streams. */
import { Platform } from 'react-native';

const FILES: Record<string, number> = {
  'barbell-back-squat.34fd152c.jpg': require('@/assets/exercises/barbell-back-squat.34fd152c.jpg'),
  'barbell-back-squat.89a7aac7.mp4': require('@/assets/exercises/barbell-back-squat.89a7aac7.mp4'),
  'bodyweight-lunge.0eb0fd6f.mp4': require('@/assets/exercises/bodyweight-lunge.0eb0fd6f.mp4'),
  'bodyweight-lunge.17da791c.jpg': require('@/assets/exercises/bodyweight-lunge.17da791c.jpg'),
  'box-jump.2312b372.jpg': require('@/assets/exercises/box-jump.2312b372.jpg'),
  'box-jump.26e1e901.mp4': require('@/assets/exercises/box-jump.26e1e901.mp4'),
  'burpee.19487abe.jpg': require('@/assets/exercises/burpee.19487abe.jpg'),
  'burpee.62e42dc8.mp4': require('@/assets/exercises/burpee.62e42dc8.mp4'),
  'dumbbell-shoulder-press.968010b5.mp4': require('@/assets/exercises/dumbbell-shoulder-press.968010b5.mp4'),
  'dumbbell-shoulder-press.a9a6ca9e.jpg': require('@/assets/exercises/dumbbell-shoulder-press.a9a6ca9e.jpg'),
  'forearm-plank.6ca2d309.mp4': require('@/assets/exercises/forearm-plank.6ca2d309.mp4'),
  'forearm-plank.d707665b.jpg': require('@/assets/exercises/forearm-plank.d707665b.jpg'),
  'incline-dumbbell-press.285df0d5.mp4': require('@/assets/exercises/incline-dumbbell-press.285df0d5.mp4'),
  'incline-dumbbell-press.564ef43c.jpg': require('@/assets/exercises/incline-dumbbell-press.564ef43c.jpg'),
  'indoor-cycling.6541fa71.mp4': require('@/assets/exercises/indoor-cycling.6541fa71.mp4'),
  'indoor-cycling.6e34d99d.jpg': require('@/assets/exercises/indoor-cycling.6e34d99d.jpg'),
  'jump-rope.044c0090.jpg': require('@/assets/exercises/jump-rope.044c0090.jpg'),
  'jump-rope.3b8e2a34.mp4': require('@/assets/exercises/jump-rope.3b8e2a34.mp4'),
  'medicine-ball-slam.2cce3792.jpg': require('@/assets/exercises/medicine-ball-slam.2cce3792.jpg'),
  'medicine-ball-slam.edf260d3.mp4': require('@/assets/exercises/medicine-ball-slam.edf260d3.mp4'),
  'mountain-climber.b392cd1a.mp4': require('@/assets/exercises/mountain-climber.b392cd1a.mp4'),
  'mountain-climber.e2e88689.jpg': require('@/assets/exercises/mountain-climber.e2e88689.jpg'),
  'pull-up.132e6b3d.jpg': require('@/assets/exercises/pull-up.132e6b3d.jpg'),
  'pull-up.ca8c4c25.mp4': require('@/assets/exercises/pull-up.ca8c4c25.mp4'),
  'reformer-reverse-plank.30d1f529.mp4': require('@/assets/exercises/reformer-reverse-plank.30d1f529.mp4'),
  'reformer-reverse-plank.dccf89e3.jpg': require('@/assets/exercises/reformer-reverse-plank.dccf89e3.jpg'),
  'rowing-machine.08bfa28b.mp4': require('@/assets/exercises/rowing-machine.08bfa28b.mp4'),
  'rowing-machine.c27344c0.jpg': require('@/assets/exercises/rowing-machine.c27344c0.jpg'),
  'russian-twist.5524818c.mp4': require('@/assets/exercises/russian-twist.5524818c.mp4'),
  'russian-twist.e64f2bfc.jpg': require('@/assets/exercises/russian-twist.e64f2bfc.jpg'),
  'seated-forward-fold.00cae247.mp4': require('@/assets/exercises/seated-forward-fold.00cae247.mp4'),
  'seated-forward-fold.6de49f67.jpg': require('@/assets/exercises/seated-forward-fold.6de49f67.jpg'),
  'sled-push.221c6e70.mp4': require('@/assets/exercises/sled-push.221c6e70.mp4'),
  'sled-push.fbb719c4.jpg': require('@/assets/exercises/sled-push.fbb719c4.jpg'),
  'standing-yoga-flow.83acb419.mp4': require('@/assets/exercises/standing-yoga-flow.83acb419.mp4'),
  'standing-yoga-flow.dac1ce1b.jpg': require('@/assets/exercises/standing-yoga-flow.dac1ce1b.jpg'),
};

/** The bundled copy of a server exercise file (…/public/media/exercises/<file>), or null (the web; not bundled). */
export function bundledMedia(uri: string | null | undefined): number | null {
  if (!uri || Platform.OS === 'web') return null;
  const name = /\/public\/media\/exercises\/([^/?#]+)(?:[?#].*)?$/.exec(uri)?.[1];
  return (name && FILES[name]) || null;
}
