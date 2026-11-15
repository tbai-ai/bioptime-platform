/* Shared pointer plumbing for the depth primitives: where a finger (or, on the web, a pointer) is over a wrapper, as -1..1
   on each axis from the centre, without claiming the touch. The handlers are passive (touch events on iOS and Android,
   pointer events on the web), so buttons inside keep working and a scroll that starts on the wrapper still scrolls: once
   the finger travels more than `slop` points the press is released. With `follow`, the press lasts for the whole touch
   instead and `dx` / `dy` say how far the finger has travelled since it went down (a drag); on the web the pointer is
   captured, so a drag that leaves the wrapper keeps going until the button is released. */
import { useRef } from 'react';
import { Platform } from 'react-native';
import { measure, useAnimatedRef, useSharedValue, type AnimatedRef, type SharedValue } from 'react-native-reanimated';
import { scheduleOnUI } from 'react-native-worklets';
import { motion } from './tokens';

type PointLike = { nativeEvent: { pageX: number; pageY: number; pointerId?: number }; currentTarget?: unknown };

export type PointerTilt = {
  ref: AnimatedRef;
  /** -1 (left edge) .. 1 (right edge) */
  nx: SharedValue<number>;
  /** -1 (top edge) .. 1 (bottom edge) */
  ny: SharedValue<number>;
  /** With `follow`: points travelled right (positive) or left since the touch began; 0 otherwise. */
  dx: SharedValue<number>;
  /** With `follow`: points travelled down (positive) or up since the touch began; 0 otherwise. */
  dy: SharedValue<number>;
  handlers: Record<string, (e: PointLike) => void>;
};

/** Web only: keep receiving the pointer's moves after it leaves the element (released on pointer up by the browser). */
function capture(e: PointLike) {
  const el = e.currentTarget as { setPointerCapture?: (id: number) => void } | undefined;
  const id = e.nativeEvent.pointerId;
  if (!el || typeof el.setPointerCapture !== 'function' || typeof id !== 'number') return;
  try { el.setPointerCapture(id); } catch { /* capture is a nicety; the drag still works inside the element */ }
}

export function usePointerTilt({ enabled, follow, onBegin, onEnd }: { enabled: boolean; follow?: boolean; onBegin: () => void; onEnd: () => void }): PointerTilt {
  const ref = useAnimatedRef();
  const nx = useSharedValue(0);
  const ny = useSharedValue(0);
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const origin = useRef<{ x: number; y: number } | null>(null);

  const locate = (pageX: number, pageY: number) => {
    scheduleOnUI((px: number, py: number) => {
      'worklet';
      const m = measure(ref);
      if (!m || m.width <= 0 || m.height <= 0) return;
      nx.set(Math.max(-1, Math.min(1, ((px - m.pageX) / m.width) * 2 - 1)));
      ny.set(Math.max(-1, Math.min(1, ((py - m.pageY) / m.height) * 2 - 1)));
    }, pageX, pageY);
  };

  const begin = (e: PointLike) => {
    if (!enabled) return;
    const { pageX, pageY } = e.nativeEvent;
    origin.current = { x: pageX, y: pageY };
    nx.set(0); ny.set(0); dx.set(0); dy.set(0);
    if (follow && Platform.OS === 'web') capture(e);
    locate(pageX, pageY);
    onBegin();
  };
  const end = () => {
    if (!origin.current) return;
    origin.current = null;
    onEnd();
  };
  const move = (e: PointLike) => {
    const o = origin.current;
    if (!o) return;
    const { pageX, pageY } = e.nativeEvent;
    if (follow) { locate(pageX, pageY); dx.set(pageX - o.x); dy.set(pageY - o.y); return; }
    if (Math.hypot(pageX - o.x, pageY - o.y) > motion.press.slop) end(); // a scroll, not a press
  };

  const handlers: Record<string, (e: PointLike) => void> = Platform.OS === 'web'
    ? { onPointerDown: begin, onPointerMove: move, onPointerUp: end, onPointerCancel: end, onPointerLeave: end }
    : { onTouchStart: begin, onTouchMove: move, onTouchEnd: end, onTouchCancel: end };

  return { ref, nx, ny, dx, dy, handlers };
}
