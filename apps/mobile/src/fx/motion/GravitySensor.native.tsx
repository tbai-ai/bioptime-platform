/* The one gravity sensor the app runs (tier A phones only), feeding TiltProvider. Roll and pitch are the share of
   gravity along the screen's x and y axes (-1..1) minus a slow baseline (low-pass, τ = 2 s), so whatever angle the
   phone is held at settles flat and only a change of angle tilts the cards. The baseline is the first reading that
   arrives after the sensor starts (never the value the shared sensor held before it). Native only: the web build resolves
   ./GravitySensor.tsx instead, so useAnimatedSensor is never reachable there. */
import { SensorType, useAnimatedReaction, useAnimatedSensor, useSharedValue, type SharedValue } from 'react-native-reanimated';

const INTERVAL = 33;
const TAU = 2000;
const G = 9.81;

export function GravitySensor({ roll, pitch }: { roll: SharedValue<number>; pitch: SharedValue<number> }) {
  const sensor = useAnimatedSensor(SensorType.GRAVITY, { interval: INTERVAL, adjustToInterfaceOrientation: true });
  const base = useSharedValue<{ roll: number; pitch: number } | null>(null);

  useAnimatedReaction(() => sensor.sensor.get(), (v, prev) => {
    // the value already there when this mounts is not a reading of now: Reanimated's placeholder {0, 0, 0} on the
    // launch's first start (taken as the baseline, the phone's real gravity then read as a full tilt, and every card
    // turned to its largest angle and drifted back over seconds, right as Home's cards arrived: release G2-3), or the
    // last reading of an earlier run. The baseline is the first reading that arrives after it, and a vector with no
    // gravity in it is never one.
    if (prev === null || Math.abs(v.x) + Math.abs(v.y) + Math.abs(v.z) < 1) return;
    const r = Math.max(-1, Math.min(1, v.x / G));
    const p = Math.max(-1, Math.min(1, v.y / G));
    const b = base.get();
    if (!b) { base.set({ roll: r, pitch: p }); return; } // the first reading is the holding angle: no jump
    const k = 1 - Math.exp(-INTERVAL / TAU);
    const next = { roll: b.roll + k * (r - b.roll), pitch: b.pitch + k * (p - b.pitch) };
    base.set(next);
    roll.set(r - next.roll);
    pitch.set(p - next.pitch);
  });

  return null;
}
