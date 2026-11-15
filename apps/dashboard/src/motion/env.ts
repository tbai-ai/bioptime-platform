/* When the motion layer may run. One gate for all of it (the 3D scenes, route transitions, reveals, card depth and
   panel motion): off under prefers-reduced-motion, with Save-Data or a slow connection, on low-memory or low-core
   devices, and where WebGL is unavailable. Off means the static portal exactly as it is without this layer. */
import { useEffect, useState } from 'react';

const REDUCED = '(prefers-reduced-motion: reduce)';

export function reducedMotion(): boolean {
  try { return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED).matches; } catch { return true; }
}

export function lowPower(): boolean {
  const n = navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string }; deviceMemory?: number };
  if (n.connection?.saveData === true) return true;
  if (n.connection?.effectiveType && /(^|-)2g$/.test(n.connection.effectiveType)) return true;
  if (typeof n.deviceMemory === 'number' && n.deviceMemory < 4) return true;
  if (typeof n.hardwareConcurrency === 'number' && n.hardwareConcurrency > 0 && n.hardwareConcurrency <= 2) return true;
  return false;
}

let webgl: boolean | null = null;
/** A throwaway context, released at once; the answer is kept for the session. */
export function webglAvailable(): boolean {
  if (webgl !== null) return webgl;
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    webgl = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { webgl = false; }
  return webgl;
}

/** A mouse or pen that hovers: the only pointers that drive parallax and card depth. */
export function finePointer(): boolean {
  try { return window.matchMedia('(hover: hover) and (pointer: fine)').matches; } catch { return false; }
}

/** The whole gate, cheapest checks first (reduced motion never creates a WebGL context). */
export function motionAllowed(): boolean {
  return !reducedMotion() && !lowPower() && webglAvailable();
}

/** Follows the reduced-motion setting while the page is open: turning it on stops the layer at once. */
export function onMotionPreferenceChange(fn: () => void): () => void {
  let mq: MediaQueryList | null = null;
  try { mq = window.matchMedia(REDUCED); } catch { return () => {}; }
  mq.addEventListener?.('change', fn);
  return () => mq?.removeEventListener?.('change', fn);
}

export function useMotionAllowed(): boolean {
  const [ok, setOk] = useState(motionAllowed);
  useEffect(() => onMotionPreferenceChange(() => setOk(motionAllowed())), []);
  return ok;
}

/** The brand's easing tokens (--bp-ease-out, --bp-ease-inOut), for the Web Animations API and framer-motion. */
export const EASE_OUT = 'cubic-bezier(.23, 1, .32, 1)';
export const EASE_IN = 'cubic-bezier(.4, 0, 1, 1)';
export const EASE_OUT_ARRAY: [number, number, number, number] = [0.23, 1, 0.32, 1];
