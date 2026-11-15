/* The Bioptime mark in 3D for the portal: the same extruded brand vector the website hero uses (drive/js/hero3d.js),
   rendered by the scene engine in src/motion/scene/brandScene.ts (physically based white satin, red clearcoat and
   slate rungs under a procedural studio, light motes in depth, spring pointer parallax, a slow settle-in from the flat
   mark, a render loop that sleeps when settled or offscreen, idle drift that ends within five seconds of the last
   input for WCAG 2.2.2).

   Three ways to use it:
   - <BrandScene variant="auth" tone=… />: a full-bleed layer behind a sign-in page's content. It draws the mark over
     the page's <BrandMark3D hosted /> box (beside the card on wide screens), or beside or above the card when that
     box is hidden (a smaller mark in the space above the card on most phones), with motes across the page and kept
     off the card. Where no mark fits (the smallest phones) the motes come on their own, gathered in the margins around
     the card (the strip above it and the gutters beside it), arriving from deep behind it.
   - <BrandScene variant="band" />: a layer behind a workspace header band (components/HeroBand.tsx), behind its text
     and clear of it, drawing the mark over the band's <BrandMark3D hosted /> box.
   - <BrandMark3D /> on its own: the mark in its box, with its own small renderer.

   The flat SVG renders first and stays underneath; it is the whole experience under reduced motion, save-data, low
   memory or cores, no WebGL, a failed chunk load, an init error, a lost context or a persistently slow device, and it
   only fades out once the 3D mark has actually been drawn over it. three.js and the engine arrive as their own chunks,
   only when they will be used. The scene layers are aria-hidden and take no pointer events; data stays readable. */
import React, { useEffect, useRef, useState } from 'react';
import { MARK_PATHS, MARK_VIEWBOX } from '../lib/brandMark';
import { lowPower, onMotionPreferenceChange, reducedMotion, webglAvailable } from '../motion/env';
import type { SceneHandle, SceneOptions } from '../motion/scene/brandScene';
import { measurePlacement } from '../motion/scene/placement';
import '../motion';

type Mode = 'flat' | 'loading' | 'live' | 'reduced' | 'unsupported' | 'error';
type SceneConfig = Omit<SceneOptions, 'canvas' | 'host' | 'onLive' | 'onAnchor' | 'onFail'>;

/** The event a scene sends to a hosted mark's box when it starts (true) or stops (false) drawing the mark over it. */
const SCENE_EVENT = 'bp:scene';
/** How long the page must keep its size before a scene decides whether it has a mark to draw. */
const SETTLED_MS = 400;

/** Runs a scene on `layer` (the element the canvas covers) once it is laid out with a mark to draw, and reports its mode. */
function useBrandScene(layer: React.RefObject<HTMLElement | null>, canvas: React.RefObject<HTMLCanvasElement | null>, config: (layer: HTMLElement) => SceneConfig, deps: unknown[], enabled: boolean): Mode {
  const [mode, setMode] = useState<Mode>('flat');
  useEffect(() => {
    if (!enabled) return;
    const el = layer.current, c = canvas.current; if (!el || !c) return;
    if (reducedMotion()) { setMode('reduced'); return; }
    if (lowPower()) { setMode('unsupported'); return; }
    const opts = config(el);
    let scene: SceneHandle | null = null; let cancelled = false; let loading = false; let ro: ResizeObserver | null = null;
    const notify = (drawn: boolean) => { if (opts.anchor && opts.anchor !== el) opts.anchor.dispatchEvent(new CustomEvent<boolean>(SCENE_EVENT, { detail: drawn })); };
    const fail = () => { scene?.dispose(); scene = null; notify(false); if (!cancelled) setMode('error'); };
    // three.js is fetched only once the layer is laid out and has something to draw (motion/scene/placement.ts): a
    // header band without its mark box never pays for the chunks, a GL context and the environment bake. A sign-in
    // page always has something (a mark beside or above the card, or the motes around it on the smallest phones).
    // The page must have settled first (web fonts in, then no change of size for a moment), because a card that is
    // still filling in (an alert arriving, a font swapping) changes the room around it. The mode stays 'flat' until
    // then, and the layer, its box, the anchor and the card are watched in case something fits later.
    const hasScene = () => measurePlacement(el, opts.variant, opts.anchor, opts.avoid) !== null;
    let fontsIn = !document.fonts; let quiet = 0;
    const onResize = () => { if (loading || cancelled) return; window.clearTimeout(quiet); quiet = window.setTimeout(load, SETTLED_MS); };
    document.fonts?.ready.then(() => { fontsIn = true; onResize(); }, () => { fontsIn = true; onResize(); });
    function load() {
      if (loading || cancelled || !fontsIn || !hasScene()) return;
      loading = true; ro?.disconnect(); window.removeEventListener('resize', onResize);
      // the WebGL probe opens (and at once releases) a context of its own, so it too waits for something to draw
      if (!webglAvailable()) { setMode('unsupported'); return; }
      setMode('loading');
      Promise.all([import('three'), import('../motion/scene/brandScene')]).then(([three, engine]) => {
        if (cancelled || reducedMotion()) return;
        try { scene = engine.createBrandScene(three, { ...opts, canvas: c!, host: el!, onLive: () => { if (!cancelled) setMode('live'); }, onAnchor: notify, onFail: fail }); }
        catch { fail(); }
      }).catch(() => { if (!cancelled) setMode('error'); });
    }
    ro = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;
    if (ro) [el, opts.anchor, opts.avoid].forEach((n) => { if (n) ro!.observe(n); }); else window.addEventListener('resize', onResize);
    onResize();
    const stopWatching = onMotionPreferenceChange(() => { if (reducedMotion()) { scene?.dispose(); scene = null; notify(false); setMode('reduced'); } });
    return () => { cancelled = true; window.clearTimeout(quiet); ro?.disconnect(); window.removeEventListener('resize', onResize); stopWatching(); scene?.dispose(); scene = null; notify(false); };
  }, [enabled, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return mode;
}

/** The flat mark: first paint and every fallback. */
export function BrandMarkFlat({ className }: { className?: string }) {
  const vb = MARK_VIEWBOX;
  return <svg className={className} viewBox={`${vb.x} ${vb.y} ${vb.width} ${vb.height}`} aria-hidden="true" focusable="false">{MARK_PATHS.map((p, i) => <path key={i} fill={p.fill} d={p.d} />)}</svg>;
}

/**
 * The mark in its box. `hosted` leaves the drawing to a <BrandScene> in the same parent (the box then only holds the
 * flat mark, which fades out while the scene draws over it); otherwise the box runs its own small scene, and
 * `interactive` lets its key light follow a fine pointer. `data-mode` reports flat | loading | live | reduced |
 * unsupported | error for styling and tests.
 */
export function BrandMark3D({ className = '', interactive = true, label, hosted = false }: { className?: string; interactive?: boolean; label?: string; hosted?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    if (!hosted) return;
    const el = host.current; if (!el) return;
    const on = (e: Event) => setDrawn((e as CustomEvent<boolean>).detail === true);
    el.addEventListener(SCENE_EVENT, on);
    return () => el.removeEventListener(SCENE_EVENT, on);
  }, [hosted]);
  const own = useBrandScene(host, canvas, (el) => ({ variant: 'mark', anchor: el, avoid: null, pointer: interactive ? 'window' : 'none', keyLight: interactive, intensity: 1, motes: 0 }), [interactive], !hosted);
  return <div ref={host} className={`brandMark3d ${className}`} data-mode={hosted ? (drawn ? 'live' : 'flat') : own} data-bp-scene-anchor={hosted ? '' : undefined} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    <BrandMarkFlat className="brandMark3dFlat" />
    {!hosted && <canvas ref={canvas} className="brandMark3dCanvas" />}
  </div>;
}

type Tone = 'client' | 'coach' | 'admin';
/** Per audience, as the sign-in backdrops already differ: members get the liveliest scene and a key light that follows
    the pointer, coaches a calmer one, administrators (a security-first entrance) the stillest. */
const TONE: Record<Tone, { intensity: number; motes: number; keyLight: boolean }> = {
  client: { intensity: 1, motes: 1, keyLight: true },
  coach: { intensity: 0.7, motes: 0.8, keyLight: false },
  admin: { intensity: 0.45, motes: 0.55, keyLight: false },
};

/**
 * A scene layer behind existing content: `auth` covers its sign-in page (the parent must be the page's `.auth` frame),
 * `band` covers a header band (the parent is the band). It renders nothing at all where the motion layer is off, so
 * the page is exactly the static page.
 */
export function BrandScene({ variant, tone = 'client' }: { variant: 'auth' | 'band'; tone?: Tone }) {
  const [allowed] = useState(() => !reducedMotion() && !lowPower());
  const layer = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const mode = useBrandScene(layer, canvas, (el) => {
    const parent = el.parentElement;
    const anchor = parent?.querySelector<HTMLElement>('[data-bp-scene-anchor]') ?? null;
    if (variant === 'band') return { variant, anchor, avoid: null, pointer: 'parent', keyLight: false, intensity: 0.6, motes: 1 };
    const t = TONE[tone];
    return { variant, anchor, avoid: parent?.querySelector<HTMLElement>('.authCard, .bp-card') ?? null, pointer: 'window', keyLight: t.keyLight, intensity: t.intensity, motes: t.motes };
  }, [variant, tone], allowed);
  if (!allowed || mode === 'reduced' || mode === 'unsupported' || mode === 'error') return null;
  return <div ref={layer} className={`bpScene bpScene-${variant}`} data-mode={mode} aria-hidden="true"><canvas ref={canvas} className="bpSceneCanvas" /></div>;
}
