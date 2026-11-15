/* The Bioptime brand-mark scene: the extruded brand vector (lib/brandMark.ts, the website sprite's own paths) in a
   white satin loop, a red clearcoat loop and slate helix rungs, under a procedural studio environment, with light
   motes in depth around it, spring pointer parallax and a slow settle-in from the flat mark.

   One renderer per scene and one canvas behind the content it decorates. The mark is drawn exactly over the box the
   flat SVG mark occupies (the anchor): the camera's principal point is put on the anchor's centre (an off-axis view,
   so the mark is seen head-on wherever it sits) and its focal length makes the mark the flat mark's width, which lets
   the flat SVG fade out under it without a jump. Without a visible anchor the sign-in scene places the mark beside or
   above the card (a smaller mark on phones), or, where no mark fits (a phone whose card fills the screen), gathers the
   motes into the margins around the card: the strip above it and the gutters beside it (never by the small print
   below it), larger and brighter there, some sitting just behind the card's edge so their light shows around it, and
   they arrive from deep behind the card. On a sign-in page the motes also follow the page's scroll by depth (near ones
   faster, far ones slower), drawn once per scroll frame, never on their own.

   This module never imports three.js at runtime: the caller passes the namespace in after loading it, so three stays
   its own chunk. The render loop sleeps when the scene has settled, offscreen and in hidden tabs; idle drift ends
   within five seconds of the last input (WCAG 2.2.2); the device pixel ratio is capped and lowered if frames are
   slow, and a scene that stays slow, or loses its context, gives up and the static page stays. */
import type * as THREE from 'three';
import { MARK_PATHS, MARK_VIEWBOX } from '../../lib/brandMark';
import { localBox, markBox, measurePlacement } from './placement';

type Three = typeof THREE;
type Mesh = InstanceType<Three['Mesh']>;
type PhysicalMaterial = InstanceType<Three['MeshPhysicalMaterial']>;

export type SceneVariant = 'auth' | 'band' | 'mark';
export type SceneOptions = {
  variant: SceneVariant;
  canvas: HTMLCanvasElement;
  /** The element the canvas covers. */
  host: HTMLElement;
  /** The box the mark must occupy (the flat mark's box); when hidden, placement falls back (sign-in) or the mark is left out. */
  anchor?: HTMLElement | null;
  /** The content the mark must not sit behind when there is no anchor (the sign-in card); the motes fade out over it. */
  avoid?: HTMLElement | null;
  /** Where pointer parallax listens: the whole window, the host's parent (a header band), or nowhere. */
  pointer: 'window' | 'parent' | 'none';
  /** The key light follows the pointer. */
  keyLight: boolean;
  /** 0..1: parallax, lean and drift amplitude. */
  intensity: number;
  /** Mote density multiplier; 0 for none. */
  motes: number;
  /** The first frame has been drawn. */
  onLive: () => void;
  /** The mark is (or is no longer) drawn over the anchor, so the flat mark there may fade out (or must come back). */
  onAnchor: (drawn: boolean) => void;
  /** The scene gave up (context lost, persistently slow); the caller disposes it and shows the static page. */
  onFail: (reason: string) => void;
};
export type SceneHandle = { dispose: () => void; wake: () => void };

const MARK_WIDTH = 4; // world units across the mark
const DISTANCE = 11; // camera to mark plane: the lens the 26° portal mark always used (mark at 78% of its box)
const MAX_DPR = 1.5;
const MAX_PIXELS = 2_400_000; // drawing-buffer budget across the whole canvas
const IDLE_HOLD = 3.2; // seconds of idle drift after the last input
const IDLE_FADE = 4.6; // idle drift is gone by here (under five seconds)
const MAX_MOTES = 260;
/* The motes on their own around a card that fills a phone's screen ('rim'): how many (one per this much margin area,
   px²), how far behind the card's edge a mote's centre may sit (px; the card is opaque and above the canvas, so only
   the light outside its edge shows), and how much larger and brighter they are than across an open page. */
const RIM_AREA_PER = 420;
const RIM_MIN = 60;
const RIM_INSET = 9;
const RIM_SCALE = 1.9;
const RIM_GAIN = 1.9;
/** The rim motes' entrance: each starts this many times as deep and comes forward, out from behind the card. */
const RIM_DEPTH = 2.4;
/** How strongly the motes follow the page's scroll by depth: a mote at distance d is offset by scroll × (1 − D/d) × this
    (px), so motes in the mark's plane stay with the page, nearer ones run ahead of it and farther ones lag behind. */
const SCROLL_DEPTH = 0.32;
const FLAT = { white: '#FFFFFF', red: '#EE3324', slate: '#7A8293' }; // the mark's own fills (lib/brandMark.ts)

const SETTLE: Record<SceneVariant, number> = { auth: 2.6, band: 1.8, mark: 1.4 };

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const smoothstep = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

type Spring = { x: number; v: number; k: number; c: number; target: number };
const spring = (value: number, k: number, c: number): Spring => ({ x: value, v: 0, k, c, target: value });
function step(s: Spring, target: number, dt: number): number {
  s.target = target;
  const n = Math.max(1, Math.ceil(dt / (1 / 120))); const h = dt / n;
  for (let i = 0; i < n; i++) { const a = s.k * (target - s.x) - s.c * s.v; s.v += a * h; s.x += s.v * h; }
  return s.x;
}
const atRest = (s: Spring, eps: number) => Math.abs(s.v) < eps && Math.abs(s.target - s.x) < eps;

/** A small deterministic generator, so the motes fall the same way on every visit. */
function prng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* ---------- the brand vector to geometry ---------- */

/** SVG path (absolute M, L, C, Z, as the brand vector uses) to shapes; the largest subpath is the outline, the rest are holes. */
function pathToShapes(three: Three, d: string, map: (x: number, y: number) => { x: number; y: number }) {
  if (/[^MLCZe\d\s.,+-]/.test(d)) throw new Error('unsupported path command');
  const tokens = d.match(/[MLCZ]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
  const subpaths: InstanceType<Three['Shape']>[] = [];
  let path: InstanceType<Three['Shape']> | null = null; let cmd = ''; let i = 0;
  const num = () => parseFloat(tokens[i++]!); const pt = () => map(num(), num());
  while (i < tokens.length) {
    const tk = tokens[i]!;
    if (tk === 'M' || tk === 'L' || tk === 'C' || tk === 'Z') { cmd = tk; i++; if (cmd === 'Z' && path) path.closePath(); continue; }
    if (cmd === 'M') { const p = pt(); path = new three.Shape(); path.moveTo(p.x, p.y); subpaths.push(path); cmd = 'L'; }
    else if (cmd === 'L' && path) { const p = pt(); path.lineTo(p.x, p.y); }
    else if (cmd === 'C' && path) { const a = pt(), b = pt(), c = pt(); path.bezierCurveTo(a.x, a.y, b.x, b.y, c.x, c.y); }
    else i++;
  }
  if (!subpaths.length) return [];
  const areas = subpaths.map((s) => Math.abs(three.ShapeUtils.area(s.getPoints(4))));
  let outer = 0; areas.forEach((a, k) => { if (a > areas[outer]!) outer = k; });
  const shape = subpaths[outer]!; subpaths.forEach((s, k) => { if (k !== outer) shape.holes.push(s); });
  return [shape];
}

function extrude(three: Three, shapes: InstanceType<Three['Shape']>[], o: { depth: number; bevelThickness: number; bevelSize: number; bevelSegments: number; curveSegments: number }) {
  const g = new three.ExtrudeGeometry(shapes, { depth: o.depth, steps: 1, curveSegments: o.curveSegments, bevelEnabled: true, bevelThickness: o.bevelThickness, bevelSize: o.bevelSize, bevelOffset: -o.bevelSize, bevelSegments: o.bevelSegments });
  g.translate(0, 0, -o.depth / 2); g.deleteAttribute('uv'); g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

/* ---------- the procedural studio ---------- */

/** A gradient dome and soft boxes baked into a prefiltered environment map: the reflections and fill of a studio
    without an image file. The low red box is the brand red the mark already carries, bounced into its bevels. */
function buildEnvironment(three: Three, renderer: InstanceType<Three['WebGLRenderer']>) {
  const env = new three.Scene();
  const disposables: Array<{ dispose: () => void }> = [];
  const domeGeo = new three.SphereGeometry(20, 48, 24);
  const domeMat = new three.ShaderMaterial({ side: three.BackSide, depthWrite: false,
    uniforms: { top: { value: new three.Color(0x5a6782) }, horizon: { value: new three.Color(0x1a2338) }, bottom: { value: new three.Color(0x04070d) } },
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vDir; void main() { float h = vDir.y; vec3 c = h > 0.0 ? mix(horizon, top, smoothstep(0.0, 0.85, h)) : mix(horizon, bottom, smoothstep(0.0, 0.6, -h)); gl_FragColor = vec4(c, 1.0); }' });
  env.add(new three.Mesh(domeGeo, domeMat)); disposables.push(domeGeo, domeMat);
  const softbox = (w: number, h: number, hex: number, k: number, x: number, y: number, z: number) => {
    const geo = new three.PlaneGeometry(w, h); const mat = new three.MeshBasicMaterial({ color: new three.Color(hex).multiplyScalar(k), side: three.DoubleSide });
    const m = new three.Mesh(geo, mat); m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m); disposables.push(geo, mat);
  };
  softbox(9, 5, 0xffffff, 5.4, -5, 6.5, 7); // key: high front left
  softbox(1.6, 9, 0xdce3f0, 2.6, 8.5, 1, 3); // strip: right edge highlight
  softbox(12, 1.2, 0xc9d2e3, 1.4, 0, -1.2, -9); // horizon line behind
  softbox(7, 2.2, 0xee3324, 1.15, 2, -7, 2); // brand red bounce from below
  softbox(6, 6, 0x9aa6be, 0.9, -2, 2, -9); // cool back fill
  const pmrem = new three.PMREMGenerator(renderer); const target = pmrem.fromScene(env, 0.035); pmrem.dispose(); disposables.forEach((d) => d.dispose());
  return target;
}

/* ---------- light motes ---------- */

const MOTE_VERTEX = /* glsl */`
  uniform vec4 uView;    // canvas width, height and the principal point (px)
  uniform float uF;      // focal length (px)
  uniform float uD;      // camera to mark plane
  uniform float uDrift;  // accumulated drift time (stops when the scene settles)
  uniform float uPR;     // pixel ratio
  uniform float uOpacity;
  uniform float uNear; uniform float uFar;
  uniform vec4 uAvoid;   // a box the motes keep off (the sign-in card): left, top, right, bottom (px); empty for none
  uniform float uFeather; // how far outside that box they fade in (px)
  uniform float uScale;  // mote size multiplier: larger when they come alone, in the narrow space around a phone's card
  uniform float uGain;   // brightness multiplier (the same case)
  uniform float uRim;    // 1: the motes gather in the margins around the card (uAvoid), by region
  uniform vec4 uRimW;    // cumulative region shares: above the card, then the left gutter (the rest: the right gutter)
  uniform float uInset;  // how far behind the card's edge a mote's centre may sit (px), so its halo shows at the edge
  uniform float uScroll; // the page's scroll (px): motes follow it by depth
  uniform float uIntro;  // 0..1 through the rim motes' entrance: each comes forward from deep behind the card to its place
  attribute vec4 aSeed;  // u, v (canvas fraction), depth fraction, phase
  attribute vec3 aProps; // size (px at the mark plane), speed, softness
  attribute vec3 aColor;
  varying vec3 vColor; varying float vAlpha; varying float vSoft;
  void main() {
    float dist = mix(uNear, uFar, aSeed.z);
    float near = uD / dist;
    float v = fract(aSeed.y - uDrift * aProps.y * 0.010 * near);
    float sway = sin(uDrift * 0.35 * aProps.y + aSeed.w * 6.2832) * 0.006 * near;
    vec2 px = vec2((aSeed.x + sway) * uView.x, v * uView.y);
    if (uRim > 0.5) {
      // a region by a second draw from the seed, weighted by its area; the mote rises through that region only
      float pick = fract(aSeed.w * 13.37 + aSeed.x * 0.618);
      float foot = min(uView.y, uAvoid.w + uInset); // the gutters end at the card's foot, clear of the small print below
      vec4 r = pick < uRimW.x ? vec4(0.0, 0.0, uView.x, uAvoid.y + uInset)
             : pick < uRimW.y ? vec4(0.0, 0.0, uAvoid.x + uInset, foot)
             : vec4(uAvoid.z - uInset, 0.0, uView.x, foot);
      px = vec2(mix(r.x, r.z, aSeed.x) + sway * 360.0, mix(r.y, r.w, v));
    }
    px.y += uScroll * (1.0 - near) * ${SCROLL_DEPTH.toFixed(2)};
    // the entrance (rim): a mote starts RIM_DEPTH times as deep on the same line of sight, so it is drawn smaller and
    // nearer the middle of the screen, behind the card, and comes forward and out into the margin; staggered by its phase
    float e = clamp((uIntro - aSeed.w * 0.4) / 0.6, 0.0, 1.0);
    float deep = uRim > 0.5 ? mix(${RIM_DEPTH.toFixed(1)}, 1.0, 1.0 - pow(1.0 - e, 3.0)) : 1.0;
    vec3 world = vec3((px.x - uView.z) * dist / uF, -(px.y - uView.w) * dist / uF, uD - dist * deep);
    vec4 mv = modelViewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = max(1.0, aProps.x * uScale * uPR * (uD / -mv.z));
    float twinkle = 0.62 + 0.38 * sin(uDrift * (0.7 + aProps.y) + aSeed.w * 6.2832);
    float edge = uRim > 0.5 ? smoothstep(0.0, 0.1, v) * smoothstep(1.0, 0.9, v) : smoothstep(0.0, 0.07, v) * smoothstep(1.0, 0.93, v);
    float bokeh = mix(uRim > 0.5 ? 0.62 : 0.38, 1.0, smoothstep(0.35, 1.0, dist / uD)); // near motes are big and faint
    vec2 out2 = max(vec2(uAvoid.x - px.x, uAvoid.y - px.y), vec2(px.x - uAvoid.z, px.y - uAvoid.w));
    float sd = length(max(out2, 0.0)) + min(max(out2.x, out2.y), 0.0); // signed distance from the box's edge (inside < 0)
    float offCard = uAvoid.z > uAvoid.x ? smoothstep(-uInset, uFeather, sd) : 1.0; // 0 over the box, past the inset
    vAlpha = min(1.0, uOpacity * twinkle * edge * bokeh * offCard * uGain);
    vColor = aColor; vSoft = aProps.z;
  }`;
const MOTE_FRAGMENT = /* glsl */`
  uniform float uLight;
  varying vec3 vColor; varying float vAlpha; varying float vSoft;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    float halo = smoothstep(0.5, 0.0, r); halo *= halo;
    float core = smoothstep(mix(0.2, 0.08, vSoft), 0.0, r);
    float a = (halo * 0.6 + core * 0.4 * (1.0 - vSoft)) * vAlpha;
    if (a < 0.002) discard;
    gl_FragColor = uLight > 0.5 ? vec4(vColor * a, a) : vec4(vColor * a, a * 0.55);
  }`;

/** The portal's theme as the page has it now (index.html sets data-theme; the design system also has a light theme). */
export function lightTheme(): boolean {
  return document.documentElement.dataset.theme === 'light';
}

function motePalette(three: Three, light: boolean) {
  const palette = light
    ? [new three.Color(FLAT.slate), new three.Color(FLAT.slate), new three.Color(FLAT.red)]
    : [new three.Color('#DCE3F0'), new three.Color(FLAT.white), new three.Color(FLAT.white), new three.Color(FLAT.red), new three.Color(FLAT.slate)];
  palette.forEach((c) => c.convertLinearToSRGB()); // three's colours are linear; the mote shader writes display values
  return palette;
}

/** The motes, and `setTheme` to repaint the same motes for the other theme (colours, blending) while the scene runs. */
export function buildMotes(three: Three, count: number, variant: SceneVariant, light: boolean) {
  const rand = prng(variant === 'band' ? 0xb10b : 0xb10a);
  const seeds = new Float32Array(count * 4), props = new Float32Array(count * 3), colors = new Float32Array(count * 3);
  const picks = new Float64Array(count); // each mote's colour draw (full precision, so the first paint is unchanged), kept so a theme change repaints the same motes
  for (let i = 0; i < count; i++) {
    const big = rand() < 0.08;
    // the header band keeps its motes toward the mark side, away from the title
    const u = variant === 'band' ? 1 - Math.pow(rand(), 1.7) * 0.95 : rand();
    seeds.set([u, rand(), big ? rand() * 0.25 : rand(), rand()], i * 4);
    props.set([big ? 9 + rand() * 9 : 1.6 + Math.pow(rand(), 2) * 3.4, 0.6 + rand() * 0.9, big ? 1 : rand() * 0.35], i * 3);
    picks[i] = rand();
  }
  const paint = (isLight: boolean) => {
    const palette = motePalette(three, isLight);
    for (let i = 0; i < count; i++) { const c = palette[Math.floor(picks[i]! * palette.length)]!; colors.set([c.r, c.g, c.b], i * 3); }
  };
  paint(light);
  const geo = new three.BufferGeometry();
  geo.setAttribute('position', new three.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('aSeed', new three.BufferAttribute(seeds, 4));
  geo.setAttribute('aProps', new three.BufferAttribute(props, 3));
  const colorAttr = new three.BufferAttribute(colors, 3);
  geo.setAttribute('aColor', colorAttr);
  const uniforms = {
    uView: { value: new three.Vector4(1, 1, 0.5, 0.5) }, uF: { value: 1000 }, uD: { value: DISTANCE }, uDrift: { value: 0 }, uPR: { value: 1 },
    uOpacity: { value: 0 }, uNear: { value: DISTANCE * 0.35 }, uFar: { value: DISTANCE * 2.8 }, uLight: { value: light ? 1 : 0 },
    uAvoid: { value: new three.Vector4(0, 0, 0, 0) }, uFeather: { value: 3 }, uScale: { value: 1 }, uGain: { value: 1 },
    uRim: { value: 0 }, uRimW: { value: new three.Vector4(0, 0, 0, 1) }, uInset: { value: 0 }, uScroll: { value: 0 }, uIntro: { value: 1 },
  };
  const mat = new three.ShaderMaterial({
    uniforms, vertexShader: MOTE_VERTEX, fragmentShader: MOTE_FRAGMENT, transparent: true, depthWrite: false, depthTest: true, toneMapped: false,
    // premultiplied output: additive light on the dark theme, ordinary premultiplied blending on the light one
    blending: three.CustomBlending, blendEquation: three.AddEquation, blendSrc: three.OneFactor, blendDst: light ? three.OneMinusSrcAlphaFactor : three.OneFactor,
    blendSrcAlpha: three.OneFactor, blendDstAlpha: three.OneMinusSrcAlphaFactor,
  });
  const points = new three.Points(geo, mat); points.frustumCulled = false; points.renderOrder = 2;
  const setTheme = (isLight: boolean) => {
    paint(isLight); colorAttr.needsUpdate = true;
    uniforms.uLight.value = isLight ? 1 : 0;
    mat.blendDst = isLight ? three.OneMinusSrcAlphaFactor : three.OneFactor;
  };
  return { points, geo, mat, uniforms, setTheme };
}

/* ---------- the motes around a card that fills the screen ---------- */

/** The page's vertical scroll (px, never negative: an overscroll bounce is not followed). */
function pageScroll(): number {
  return Math.max(0, window.scrollY || document.documentElement.scrollTop || 0);
}

/**
 * Where the motes go when they come alone around a sign-in card that fills a phone's screen: three regions in the
 * canvas's pixels (the strip above the card, and the gutters left and right of it down to the card's foot, so none sit
 * by the small print below), each reaching RIM_INSET px behind the card's edge, and each region's share of the motes by
 * its area. `shares` are cumulative (above, + left, + right = 1); `area` is the total (px²).
 */
export function rimRegions(W: number, H: number, card: { left: number; top: number; width: number; height: number }) {
  const foot = Math.min(H, card.top + card.height + RIM_INSET);
  const above = W * Math.max(0, card.top + RIM_INSET);
  const left = Math.max(0, card.left + RIM_INSET) * foot;
  const right = Math.max(0, W - card.left - card.width + RIM_INSET) * foot;
  const area = above + left + right;
  if (area <= 0) return { area: 0, shares: [0, 0, 1] as [number, number, number] };
  return { area, shares: [above / area, (above + left) / area, 1] as [number, number, number] };
}

/* ---------- the scene ---------- */

export function createBrandScene(three: Three, o: SceneOptions): SceneHandle {
  const { canvas, host, variant } = o;
  const vb = MARK_VIEWBOX;
  let light = lightTheme(); // followed below while the scene lives
  const unit = MARK_WIDTH / vb.width; const cx0 = vb.x + vb.width / 2; const cy0 = vb.y + vb.height / 2;
  const map = (x: number, y: number) => ({ x: (x - cx0) * unit, y: -(y - cy0) * unit });
  const markHeight = vb.height * unit;

  const scene = new three.Scene();
  const camera = new three.PerspectiveCamera(26, 1, 0.5, 100);
  const disposables: Array<{ dispose: () => void }> = [];

  // physically based materials in the mark's own colours: satin white, clearcoated red, brushed slate
  const whiteMat = new three.MeshPhysicalMaterial({ color: FLAT.white, roughness: 0.3, metalness: 0, sheen: 0.45, sheenRoughness: 0.42, sheenColor: new three.Color(0xd5dce8), clearcoat: 0.28, clearcoatRoughness: 0.32, specularIntensity: 0.7, envMapIntensity: 0.85 });
  const redMat = new three.MeshPhysicalMaterial({ color: FLAT.red, roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, specularIntensity: 0.8, envMapIntensity: 0.85 });
  const rungBase = new three.MeshPhysicalMaterial({ color: FLAT.slate, roughness: 0.36, metalness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.24, envMapIntensity: 1, emissive: new three.Color(FLAT.red), emissiveIntensity: 0 });
  disposables.push(whiteMat, redMat, rungBase);

  const root = new three.Group(); const pivot = new three.Group(); root.add(pivot); scene.add(root);
  const loopOpts = { depth: 0.13, bevelThickness: 0.08, bevelSize: 0.044, bevelSegments: 6, curveSegments: 10 };
  const rungOpts = { depth: 0.035, bevelThickness: 0.026, bevelSize: 0.011, bevelSegments: 3, curveSegments: 6 };
  const loops: Mesh[] = []; const rungs: Array<Mesh & { material: PhysicalMaterial }> = [];
  for (const p of MARK_PATHS) {
    const shapes = pathToShapes(three, p.d, map); if (!shapes.length) continue;
    if (p.fill === FLAT.slate) {
      const geo = extrude(three, shapes, rungOpts); const c = new three.Vector3(); geo.boundingBox!.getCenter(c); geo.translate(-c.x, -c.y, 0); disposables.push(geo);
      const mat = rungBase.clone(); disposables.push(mat);
      const mesh = new three.Mesh(geo, mat) as typeof rungs[number]; mesh.position.set(c.x, c.y, -0.035); pivot.add(mesh); rungs.push(mesh);
    } else {
      const geo = extrude(three, shapes, loopOpts); disposables.push(geo);
      const mesh = new three.Mesh(geo, p.fill === FLAT.red ? redMat : whiteMat); pivot.add(mesh); loops.push(mesh);
    }
  }
  if (!loops.length) { disposables.forEach((d) => d.dispose()); throw new Error('no loops built'); }
  rungs.sort((a, b) => b.position.y - a.position.y);

  // a soft shadow behind the mark, where the flat mark's drop shadow falls
  const shadowGeo = new three.PlaneGeometry(MARK_WIDTH * 1.3, markHeight * 1.4);
  const shadowMat = new three.ShaderMaterial({
    uniforms: { uAlpha: { value: 0 } }, transparent: true, depthWrite: false, toneMapped: false,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float uAlpha; varying vec2 vUv; void main() { vec2 p = vUv * 2.0 - 1.0; float d = length(p * vec2(1.0, 1.15)); float a = smoothstep(1.0, 0.05, d); gl_FragColor = vec4(0.0, 0.0, 0.0, a * a * uAlpha); }',
  });
  disposables.push(shadowGeo, shadowMat);
  const shadow = new three.Mesh(shadowGeo, shadowMat); shadow.position.set(0, -markHeight * 0.1, -0.7); shadow.renderOrder = -1; root.add(shadow);
  const shadowAlpha = () => (light ? 0.14 : 0.42);

  const moteCount = o.motes > 0 ? MAX_MOTES : 0;
  const motes = moteCount ? buildMotes(three, moteCount, variant, light) : null;
  if (motes) { scene.add(motes.points); disposables.push(motes.geo, motes.mat); }

  const renderer = new three.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'default' }); // decoration: never wake a discrete GPU for it
  let envTarget: ReturnType<typeof buildEnvironment>;
  try {
    renderer.setClearColor(0x000000, 0); renderer.outputColorSpace = three.SRGBColorSpace; renderer.toneMapping = three.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2;
    envTarget = buildEnvironment(three, renderer); scene.environment = envTarget.texture;
  } catch (e) { disposables.forEach((d) => d.dispose()); renderer.dispose(); renderer.forceContextLoss(); throw e; }

  // the key light trails the pointer; a cool rim separates the mark from the dark page
  const keyHome = { x: -2.2, y: 2.4, z: 2.6 };
  const key = new three.PointLight(0xffffff, 42, 0, 2); key.position.set(keyHome.x, keyHome.y, keyHome.z); scene.add(key);
  const rim = new three.DirectionalLight(0xb8c2d6, 0.9); rim.position.set(4, 2.5, -5); scene.add(rim);

  /* ----- layout: canvas size, the mark's box and the off-axis camera ----- */
  const view = { w: 1, h: 1, f: 1000, cx: 0.5, cy: 0.5, anchored: false, hasScene: false };
  let dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  let lowFps = false;

  function layout(): boolean {
    const hr = host.getBoundingClientRect();
    const W = host.clientWidth || hr.width, H = host.clientHeight || hr.height;
    if (W < 2 || H < 2 || hr.width < 1 || hr.height < 1) return false;
    // where the mark goes (./placement.ts, which the scene's host also asks before loading any of this)
    const m = measurePlacement(host, variant, o.anchor, o.avoid);
    let ratio = Math.min(window.devicePixelRatio || 1, lowFps ? 1 : MAX_DPR);
    if (W * H * ratio * ratio > MAX_PIXELS) ratio = Math.max(0.75, Math.sqrt(MAX_PIXELS / (W * H)));
    dpr = ratio;
    renderer.setPixelRatio(dpr); renderer.setSize(W, H, false);
    // the card the motes keep off, in the canvas's pixels; around a card that fills the screen the motes come alone and
    // gather in its margins (see rimRegions)
    const card = variant === 'auth' ? localBox(host, o.avoid) : null;
    const rim = motes && m && !m.mark && card ? rimRegions(W, H, card) : null;
    const f = m?.mark ? (m.w * DISTANCE) / MARK_WIDTH : Math.max(W, H) * 1.1;
    const cx = m ? m.cx : W / 2, cy = m ? m.cy : H / 2;
    const fullW = 2 * Math.max(cx, W - cx, 1), fullH = 2 * Math.max(cy, H - cy, 1);
    camera.aspect = fullW / fullH;
    camera.fov = three.MathUtils.radToDeg(2 * Math.atan(fullH / 2 / f));
    camera.near = DISTANCE * 0.15; camera.far = DISTANCE * (rim ? 4 * RIM_DEPTH : 4); // the rim motes' entrance starts deeper
    camera.setViewOffset(fullW, fullH, fullW / 2 - cx, fullH / 2 - cy, W, H); // also updates the projection
    Object.assign(view, { w: W, h: H, f, cx, cy, anchored: !!m?.anchored, hasScene: !!m });
    // no placement, nothing; a placement without a mark (a sign-in page on a small phone) draws the motes alone
    root.visible = !!m?.mark; if (motes) motes.points.visible = !!m;
    if (motes) {
      const area = W * H;
      const per = variant === 'band' ? 2600 : 6200;
      // where the card covers much of the page (phones), more motes, so the space around it holds as many as before
      const covered = card ? Math.max(0, Math.min(W, card.left + card.width) - Math.max(0, card.left)) * Math.max(0, Math.min(H, card.top + card.height) - Math.max(0, card.top)) / area : 0;
      const spread = m && !m.anchored ? 1 / Math.max(0.3, 1 - covered) : 1;
      const count = rim ? Math.max(RIM_MIN, rim.area / RIM_AREA_PER) : Math.max(variant === 'band' ? 24 : 70, area / per) * spread;
      const n = Math.round(Math.min(MAX_MOTES, count) * o.motes * (lowFps ? 0.5 : 1));
      motes.geo.setDrawRange(0, Math.min(MAX_MOTES, n));
      motes.uniforms.uView.value.set(W, H, cx, cy); motes.uniforms.uF.value = f; motes.uniforms.uPR.value = dpr;
      motes.uniforms.uScale.value = rim ? RIM_SCALE : 1; motes.uniforms.uGain.value = rim ? RIM_GAIN : 1;
      motes.uniforms.uRim.value = rim ? 1 : 0; motes.uniforms.uInset.value = rim ? RIM_INSET : 0;
      if (rim) motes.uniforms.uRimW.value.set(rim.shares[0], rim.shares[1], rim.shares[2], 1);
      if (card) motes.uniforms.uAvoid.value.set(card.left, card.top, card.left + card.width, card.top + card.height); else motes.uniforms.uAvoid.value.set(0, 0, 0, 0);
      motes.uniforms.uScroll.value = variant === 'auth' ? pageScroll() : 0;
    }
    // for tests and inspection: what the scene draws, and where its mark is (host pixels)
    const box = markBox(m);
    host.dataset.scene = !m ? 'none' : m.anchored ? 'anchored' : m.mark ? 'mark' : card ? 'rim' : 'motes';
    host.dataset.markBox = box ? [box.left, box.top, box.width, box.height].map((v) => Math.round(v)).join(',') : '';
    return true;
  }

  /* ----- pointer ----- */
  const fine = o.pointer !== 'none' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const pointer = { x: 0, y: 0, active: false };
  const pointerHost = o.pointer === 'parent' ? host.parentElement : null;
  let lastInput = -1;
  const onMove = (e: PointerEvent) => {
    if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    if (pointerHost) { const r = pointerHost.getBoundingClientRect(); pointer.x = clamp01((e.clientX - r.left) / r.width) * 2 - 1; pointer.y = clamp01((e.clientY - r.top) / r.height) * 2 - 1; }
    else { pointer.x = clamp01(e.clientX / window.innerWidth) * 2 - 1; pointer.y = clamp01(e.clientY / window.innerHeight) * 2 - 1; }
    pointer.active = true; lastInput = performance.now(); wake();
  };
  const onLeave = () => { pointer.active = false; wake(); };
  const moveTarget: EventTarget | null = !fine ? null : pointerHost ?? window;
  const leaveTarget: EventTarget | null = !fine ? null : pointerHost ?? document.documentElement;
  moveTarget?.addEventListener('pointermove', onMove as EventListener, { passive: true });
  leaveTarget?.addEventListener(pointerHost ? 'pointerleave' : 'mouseleave', onLeave);

  // springs: soft for the camera (parallax), firmer for the mark's lean, the existing values for the key light
  const camX = spring(0, 16, 7.5), camY = spring(0, 16, 7.5), leanX = spring(0, 38, 11), leanY = spring(0, 38, 11), lightX = spring(keyHome.x, 26, 9), lightY = spring(keyHome.y, 26, 9);
  const springs = [camX, camY, leanX, leanY, lightX, lightY];
  const k = Math.max(0, Math.min(1, o.intensity));
  const settle = SETTLE[variant];

  /* ----- the loop ----- */
  let raf = 0, running = false, start = -1, last = 0, frameAvg = 16, slowSince = -1, inView = true, sleeping = false, disposed = false, fitted = false, shown = false, anchorShown = false;
  let idleGain = 1, drift = 0;
  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    if (start < 0) { start = now; last = now - 16; }
    if (lastInput < 0) lastInput = now;
    const t = (now - start) / 1000;
    if (now - last < (lowFps && t > settle ? 30 : 14)) return;
    const dtMs = Math.min(100, now - last); last = now; const dt = Math.min(0.05, dtMs / 1000);
    // frame budget: after the first second (shader compilation), slow frames drop the resolution, then the scene
    if (t > 1) frameAvg = frameAvg * 0.92 + dtMs * 0.08;
    if (!lowFps && t > 2 && frameAvg > 34) { lowFps = true; layout(); }
    if (lowFps && frameAvg > 55) { if (slowSince < 0) slowSince = now; else if (now - slowSince > 1500) { o.onFail('slow'); return; } } else slowSince = -1;

    // settle-in: from the flat mark (head-on, unextruded) to its three-quarter pose
    const extrudeT = easeOutQuart(clamp01((t - 0.05) / (settle * 0.42)));
    const poseT = easeInOutCubic(clamp01((t - 0.1) / (settle * 0.86)));
    loops.forEach((m) => { m.scale.z = 0.02 + 0.98 * extrudeT; });

    const since = (now - lastInput) / 1000; const idleTarget = 1 - smoothstep(IDLE_HOLD, IDLE_FADE, since);
    idleGain += (idleTarget - idleGain) * (idleTarget > idleGain ? 1 - Math.exp(-dt / 0.8) : 1);
    const idle = poseT * idleGain * k;
    drift += dt * Math.max(idleGain, 1 - poseT) * (0.35 + 0.65 * k);

    const px = fine && pointer.active ? pointer.x : 0; const py = fine && pointer.active ? pointer.y : 0;
    const lean = step(leanY, px * 0.16 * k, dt); const tilt = step(leanX, py * 0.09 * k, dt);
    pivot.rotation.y = -0.24 * poseT + Math.sin(drift * 0.34) * 0.06 * idle + lean * poseT;
    pivot.rotation.x = 0.1 * poseT + Math.sin(drift * 0.27 + 1.3) * 0.028 * idle + tilt * poseT;
    pivot.rotation.z = Math.sin(drift * 0.21) * 0.012 * idle;
    pivot.position.y = Math.sin(drift * 0.8) * 0.045 * idle;
    rungs.forEach((r, i) => {
      const local = clamp01((t - settle * 0.2 - i * 0.07) / 0.5);
      r.scale.z = 0.02 + 0.98 * easeOutCubic(clamp01((t - 0.05) / (settle * 0.42)));
      r.material.emissiveIntensity = local <= 0 ? 0 : (local < 0.3 ? local / 0.3 : 1 - easeOutCubic((local - 0.3) / 0.7)) * 0.9;
      r.rotation.y = Math.sin(drift * 0.9 - i * 0.62) * 0.2 * idle;
    });
    shadowMat.uniforms.uAlpha.value = shadowAlpha() * (0.45 + 0.55 * easeOutCubic(clamp01(t / settle)));

    // parallax: the camera slides a few pixels' worth at the mark plane; near motes move more, far ones less
    const pxWorld = DISTANCE / view.f;
    const reach = (variant === 'band' ? 6 : 12) * k * pxWorld;
    camera.position.set(step(camX, px * reach, dt), step(camY, -py * reach, dt), DISTANCE);
    const lx = o.keyLight && fine && pointer.active ? px * 3 : keyHome.x + Math.sin(drift * 0.3) * 1.4 * idleGain * k;
    const ly = o.keyLight && fine && pointer.active ? keyHome.y - py * 2.2 : keyHome.y + Math.cos(drift * 0.23) * 0.7 * idleGain * k;
    key.position.set(step(lightX, lx, dt), step(lightY, ly, dt), keyHome.z);

    if (motes) {
      motes.uniforms.uDrift.value = drift; motes.uniforms.uOpacity.value = easeOutCubic(clamp01((t - 0.25) / (settle * 0.7)));
      motes.uniforms.uIntro.value = clamp01((t - 0.15) / (settle * 0.9)); // only the rim motes use it; done well inside the settle
    }

    renderer.render(scene, camera);
    if (!shown) { shown = true; o.onLive(); }
    if (view.anchored !== anchorShown) { anchorShown = view.anchored; o.onAnchor(anchorShown); }

    const settled = !view.hasScene || (t > settle + 0.6 && idleGain < 0.002 && springs.every((s) => atRest(s, 1e-4)));
    if (settled) { sleeping = true; stop(); }
  }
  function begin() { if (running || disposed) return; if (!fitted) fitted = layout(); if (!fitted) return; running = true; last = performance.now() - 16; raf = requestAnimationFrame(frame); }
  function stop() { if (!running) return; running = false; cancelAnimationFrame(raf); }
  function sync() { if (!disposed && !sleeping && inView && !document.hidden) begin(); else stop(); }
  function wake() { if (sleeping) { sleeping = false; } sync(); }

  const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => { inView = es[es.length - 1]!.isIntersecting; if (inView) sleeping = false; sync(); }, { threshold: 0 }) : null;
  io?.observe(host);
  // the mark follows its box: the host, the anchor and the card can each change size (fonts, alerts, breakpoints)
  let queued = false;
  const queueFit = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; if (disposed) return; fitted = layout(); sleeping = false; if (fitted) { if (!running) { sync(); } } }); };
  const ro = 'ResizeObserver' in window ? new ResizeObserver(queueFit) : null;
  [host, o.anchor, o.avoid].forEach((el) => { if (el) ro?.observe(el); });
  window.addEventListener('resize', queueFit);
  // the motes follow the page's scroll by depth (sign-in pages): the running loop reads the uniform, a sleeping scene
  // draws once per scroll frame and goes on sleeping (no idle drift is started, nothing moves on its own)
  let scrollDraw = 0;
  const onScroll = () => {
    if (!motes || disposed) return;
    motes.uniforms.uScroll.value = pageScroll();
    if (running || scrollDraw || !fitted || !view.hasScene || !inView || document.hidden) return;
    scrollDraw = requestAnimationFrame(() => { scrollDraw = 0; if (!running && !disposed) renderer.render(scene, camera); });
  };
  if (variant === 'auth') window.addEventListener('scroll', onScroll, { passive: true });
  const onVis = () => { if (!document.hidden) last = performance.now() - 16; sync(); };
  document.addEventListener('visibilitychange', onVis);
  const onLost = (e: Event) => { e.preventDefault(); stop(); o.onFail('context lost'); };
  canvas.addEventListener('webglcontextlost', onLost);
  // the theme can change while the scene is alive: the motes' colours and blending and the shadow's strength follow it,
  // and a sleeping scene draws once more to show it
  const onTheme = () => { const next = lightTheme(); if (next === light) return; light = next; motes?.setTheme(light); wake(); };
  const themeWatch = typeof MutationObserver === 'function' ? new MutationObserver(onTheme) : null;
  themeWatch?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  function dispose() {
    if (disposed) return; disposed = true; stop(); io?.disconnect(); ro?.disconnect(); themeWatch?.disconnect();
    moveTarget?.removeEventListener('pointermove', onMove as EventListener); leaveTarget?.removeEventListener(pointerHost ? 'pointerleave' : 'mouseleave', onLeave);
    window.removeEventListener('resize', queueFit); window.removeEventListener('scroll', onScroll); cancelAnimationFrame(scrollDraw);
    document.removeEventListener('visibilitychange', onVis); canvas.removeEventListener('webglcontextlost', onLost);
    disposables.forEach((d) => d.dispose()); envTarget.dispose(); renderer.dispose();
    renderer.forceContextLoss(); // dispose() keeps the GL context alive; releasing it stops contexts piling up across pages
  }

  fitted = layout();
  sync();
  return { dispose, wake };
}
