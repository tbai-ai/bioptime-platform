/* The web build of the gravity sensor: none. Desktop web tilts cards with the pointer only (CRITIQUE §18), and the guard
   test checks that useAnimatedSensor is never reachable on the web; phones use ./GravitySensor.native.tsx. */
import type { SharedValue } from 'react-native-reanimated';

export function GravitySensor(_: { roll: SharedValue<number>; pitch: SharedValue<number> }) {
  return null;
}
