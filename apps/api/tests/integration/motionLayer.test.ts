/* Round 6, the 3D and motion layer (portal and app). The portal's section wrapper keeps its element when the
   reduced-motion setting changes and is at rest from the first frame with it on; a dialog's close copy carries no typed
   value; the sign-in scene places a smaller mark above the card on phones, or, where no mark fits, gathers the motes in
   the margins around the card (kept off it), its motes follow a theme change and the page's scroll; the workspace layer
   tips rows in, glides tab underlines and lets a header band's 3D canvas (never the scene's host) trail the scroll; in
   the app, the motion primitives in the web build's pre-rendered HTML start at rest. These
   files belong to the dashboard and the app, so they are loaded as they are, through computed specifiers that keep
   them out of the API's typecheck. No server is needed. */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PLATFORM = fileURLToPath(new URL('../../../../', import.meta.url));
const load = (spec: string): Promise<any> => import(spec);
const dashboard = (rel: string): Promise<any> => load(pathToFileURL(path.join(PLATFORM, 'apps/dashboard/src', rel)).href);
const mobile = (rel: string): Promise<any> => load(pathToFileURL(path.join(PLATFORM, 'apps/mobile/src', rel)).href);
const g = globalThis as Record<string, unknown>;
after(() => { delete g.window; });

/* ---------- the portal's section wrapper ---------- */

test('section wrapper: the same elements with motion on and off, so a setting change never remounts the page', async () => {
  const React = await load('react');
  const { RouteFrame } = await dashboard('motion/RouteTransition.tsx');
  const { AnimatePresence, motion } = await load('framer-motion');
  const child = React.createElement('form', null, React.createElement('input', { name: 'note' }));
  const on = RouteFrame({ allowed: true, routeKey: '/coach/clients', children: child });
  const off = RouteFrame({ allowed: false, routeKey: '/coach/clients', children: child });
  for (const tree of [on, off]) {
    assert.equal(tree.type, AnimatePresence);
    const inner = tree.props.children;
    assert.equal(inner.type, motion.div);
    assert.equal(inner.key, '/coach/clients');
    assert.equal(inner.props.children, child);
  }
  // only the animation props differ, and the resting target is the same, so a change of setting never re-targets it
  assert.deepEqual({ opacity: on.props.children.props.animate.opacity, y: on.props.children.props.animate.y }, { opacity: 1, y: 0 });
  assert.deepEqual({ opacity: off.props.children.props.animate.opacity, y: off.props.children.props.animate.y }, { opacity: 1, y: 0 });
});

test('section wrapper: with motion off it is at rest from the first frame and has no exit; with it on it enters', async () => {
  const { routeMotion } = await dashboard('motion/RouteTransition.tsx');
  const off = routeMotion(false);
  assert.equal(off.initial, false);
  assert.equal(off.exit, undefined);
  assert.equal(off.animate.transition.duration, 0);
  const on = routeMotion(true);
  assert.deepEqual(on.initial, { opacity: 0, y: 10 });
  assert.equal(on.exit.opacity, 0);

  const React = await load('react');
  const { renderToStaticMarkup } = await load('react-dom/server');
  const { RouteFrame } = await dashboard('motion/RouteTransition.tsx');
  const html = (allowed: boolean) => renderToStaticMarkup(React.createElement(RouteFrame, { allowed, routeKey: '/client' }, React.createElement('p', null, 'Hello')));
  assert.equal(html(false), '<div style="opacity:1;transform:none"><p>Hello</p></div>');
  assert.match(html(true), /^<div style="opacity:0;transform:translateY\(10px\)"><p>Hello<\/p><\/div>$/);
});

/* ---------- the dialog close copy ---------- */

/** Just enough of an element for scrubFields: tags, attributes, value, text and the three selectors it uses. */
class FakeEl {
  attrs: Record<string, string>;
  children: FakeEl[];
  value: string;
  textContent: string;
  constructor(public tag: string, attrs: Record<string, string> = {}, children: FakeEl[] = [], text = '') {
    this.attrs = { ...attrs }; this.children = children; this.value = attrs.value ?? text; this.textContent = text;
  }
  get type() { return (this.attrs.type ?? 'text').toLowerCase(); }
  getAttribute(n: string) { return this.attrs[n] ?? null; }
  removeAttribute(n: string) { delete this.attrs[n]; }
  all(): FakeEl[] { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelectorAll(sel: string) {
    const match = sel === '[contenteditable]' ? (e: FakeEl) => 'contenteditable' in e.attrs : (e: FakeEl) => e.tag === sel;
    return this.all().filter(match);
  }
}

test('dialog close copy: no typed value survives, passwords and one-time codes included; labels stay', async () => {
  const { scrubFields } = await dashboard('motion/workspace.ts');
  const f = {
    password: new FakeEl('input', { type: 'password', value: 'Secr3t!pass' }),
    code: new FakeEl('input', { type: 'text', autocomplete: 'one-time-code', inputmode: 'numeric', value: '492817' }),
    email: new FakeEl('input', { type: 'email', value: 'priya@example.test', placeholder: 'you@example.com' }),
    hidden: new FakeEl('input', { type: 'hidden', value: 'csrf-token-value' }),
    untyped: new FakeEl('input', { value: 'free text' }),
    note: new FakeEl('textarea', {}, [], 'Feeling tired after the new dose'),
    editable: new FakeEl('div', { contenteditable: 'true' }, [], 'draft message'),
    fixed: new FakeEl('div', { contenteditable: 'false' }, [], 'page copy'),
    submit: new FakeEl('input', { type: 'submit', value: 'Save' }),
    check: new FakeEl('input', { type: 'checkbox', value: 'on' }),
  };
  const ghost = new FakeEl('div', {}, [new FakeEl('form', {}, Object.values(f))]);
  scrubFields(ghost);
  for (const k of ['password', 'code', 'email', 'hidden', 'untyped'] as const) {
    assert.equal(f[k].value, '', k);
    assert.equal(f[k].getAttribute('value'), null, `${k}: the value attribute (React mirrors typed text there) is gone`);
  }
  assert.equal(f.email.getAttribute('placeholder'), 'you@example.com');
  assert.equal(f.note.textContent, ''); assert.equal(f.note.value, '');
  assert.equal(f.editable.textContent, '');
  assert.equal(f.fixed.textContent, 'page copy');
  assert.equal(f.submit.getAttribute('value'), 'Save', 'a button label is page copy');
  assert.equal(f.check.getAttribute('value'), 'on');
});

test('dialog close copy: the closing code no longer copies anything from the live fields', async () => {
  const fs = await load('node:fs');
  const src: string = fs.readFileSync(path.join(PLATFORM, 'apps/dashboard/src/motion/workspace.ts'), 'utf8');
  const closed = src.slice(src.indexOf('function closed('), src.indexOf('const mo = new MutationObserver', src.indexOf('function closed(')));
  assert.match(closed, /scrubFields\(ghost\)/);
  assert.doesNotMatch(closed, /\.value\s*=\s*f\.|\.checked\s*=\s*f\./);
  assert.doesNotMatch(closed, /d\.querySelectorAll[^;]*input/);
});

/* ---------- where the sign-in scene draws the mark ---------- */

test('mark placement: over the flat mark on wide screens, beside or above the card when it fits, smaller on a phone, motes alone when nothing fits', async () => {
  const { placeMark, markBox, ABOVE_MIN } = await dashboard('motion/scene/placement.ts');
  // 1440 x 900: the flat mark's box (440 square) is shown left of the card
  const wide = placeMark('auth', { width: 1440, height: 900 }, { left: 250, top: 230, width: 440, height: 440 }, { left: 730, top: 200, width: 460, height: 500 });
  assert.equal(wide.anchored, true);
  assert.equal(Math.round(wide.cx), 470); assert.equal(Math.round(wide.cy), 450);
  assert.ok(Math.abs(wide.w - 0.78 * 440) < 0.01, 'the 3D mark is the flat mark\'s width');
  // the coach invitation page: no flat mark, room on the card's left
  const beside = placeMark('auth', { width: 1440, height: 900 }, null, { left: 440, top: 120, width: 560, height: 700 });
  assert.equal(beside.anchored, false); assert.equal(beside.cx, 220);
  // a tablet with a short card: room above it
  const above = placeMark('auth', { width: 768, height: 1024 }, null, { left: 154, top: 260, width: 460, height: 500 });
  assert.equal(above.anchored, false); assert.equal(above.cx, 384); assert.equal(above.mark, true);
  // a phone (390 x 844): the flat mark's box is hidden; a smaller mark sits in the middle of the 96 px above the card
  const phone = placeMark('auth', { width: 390, height: 844 }, null, { left: 16, top: 96, width: 358, height: 652 });
  assert.equal(phone.anchored, false); assert.equal(phone.mark, true);
  assert.equal(phone.cx, 195); assert.equal(phone.cy, 48);
  const box = markBox(phone);
  assert.ok(Math.abs(box.height - 0.6 * 96) < 0.01, 'the mark takes the middle 60% of the space above the card');
  assert.ok(box.top > 0 && box.top + box.height < 96, 'clear of the top edge and of the card');
  // a phone whose card fills the screen (no room beside or above): the motes alone, no mark
  const full = placeMark('auth', { width: 375, height: 667 }, null, { left: 16, top: 24, width: 343, height: 615 });
  assert.deepEqual(full, { cx: 187.5, cy: 333.5, w: 0, anchored: false, mark: false });
  assert.equal(markBox(full), null);
  // the room above that still holds a mark
  assert.equal(placeMark('auth', { width: 360, height: 640 }, null, { left: 16, top: ABOVE_MIN, width: 328, height: 500 }).mark, true);
  assert.equal(placeMark('auth', { width: 360, height: 640 }, null, { left: 16, top: ABOVE_MIN - 1, width: 328, height: 500 }).mark, false);
  // a header band always has its mark box; without one there is nothing to draw
  assert.equal(placeMark('band', { width: 900, height: 160 }, { left: 680, top: -20, width: 200, height: 200 }, null).anchored, true);
  assert.equal(placeMark('band', { width: 900, height: 160 }, null, null), null);
  // a box too small to hold a mark does not count (the card decides: here the motes alone)
  assert.equal(placeMark('auth', { width: 390, height: 844 }, { left: 0, top: 0, width: 4, height: 4 }, { left: 16, top: 24, width: 358, height: 780 }).anchored, false);
  assert.equal(placeMark('auth', { width: 390, height: 844 }, { left: 0, top: 0, width: 4, height: 4 }, { left: 16, top: 24, width: 358, height: 780 }).mark, false);
  // without the card laid out there is nothing to place around
  assert.equal(placeMark('auth', { width: 390, height: 844 }, null, null), null);
});

test('mark placement on the page: a phone-width sign-in page has a smaller mark above the card, or the motes alone', async () => {
  const { measurePlacement } = await dashboard('motion/scene/placement.ts');
  g.window = { innerHeight: 844 };
  const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height });
  const el = (r: ReturnType<typeof rect> | null, layout?: { w: number; h: number }) => ({
    isConnected: true,
    getClientRects: () => (r ? [r] : []),
    getBoundingClientRect: () => r ?? rect(0, 0, 0, 0),
    clientWidth: layout?.w ?? 0, clientHeight: layout?.h ?? 0,
  });
  const host = el(rect(0, 0, 390, 844), { w: 390, h: 844 });
  const hiddenMark = el(null); // .authMark is display: none below 980 px
  const card = el(rect(16, 96, 358, 652));
  const phone = measurePlacement(host, 'auth', hiddenMark, card);
  assert.equal(phone.anchored, false); assert.equal(phone.mark, true); assert.equal(phone.cy, 48);
  // a card that fills the screen: the motes alone
  g.window = { innerHeight: 667 };
  const small = measurePlacement(el(rect(0, 0, 375, 667), { w: 375, h: 667 }), 'auth', hiddenMark, el(rect(16, 24, 343, 615)));
  assert.equal(small.mark, false); assert.equal(small.w, 0);
  // the same page at 1440 px, the flat mark shown
  g.window = { innerHeight: 900 };
  const wideHost = el(rect(0, 0, 1440, 900), { w: 1440, h: 900 });
  const shown = measurePlacement(wideHost, 'auth', el(rect(250, 230, 440, 440)), el(rect(730, 200, 460, 500)));
  assert.equal(shown.anchored, true);
  // a host that is not laid out has nothing to draw either
  assert.equal(measurePlacement(el(null), 'auth', el(rect(250, 230, 440, 440)), null), null);
});

test('sign-in scene: three.js and the engine are fetched only after the placement check, from separate dynamic imports', async () => {
  const fs = await load('node:fs');
  const src: string = fs.readFileSync(path.join(PLATFORM, 'apps/dashboard/src/components/BrandMark3D.tsx'), 'utf8');
  const loadFn = src.slice(src.indexOf('function load()'), src.indexOf('ro = typeof ResizeObserver'));
  assert.match(loadFn, /if \(loading \|\| cancelled \|\| !fontsIn \|\| !hasScene\(\)\) return;/);
  // the decision waits for the page to settle (fonts in, no change of size for a moment)
  assert.match(src, /const onResize = \(\) => \{ if \(loading \|\| cancelled\) return; window\.clearTimeout\(quiet\); quiet = window\.setTimeout\(load, SETTLED_MS\); \};/);
  assert.ok(loadFn.indexOf('!hasScene()') < loadFn.indexOf("import('three')"), 'the check comes before the import');
  assert.ok(loadFn.indexOf('!hasScene()') < loadFn.indexOf('webglAvailable()'), 'and before the WebGL probe, which opens a context of its own');
  const beforeLoad = src.slice(src.indexOf('function useBrandScene'), src.indexOf('function load()'));
  assert.doesNotMatch(beforeLoad, /webglAvailable\(\)/, 'no probe before the placement check');
  assert.doesNotMatch(src, /^import [^;]*from 'three'/m, 'no static three import');
  assert.doesNotMatch(src, /^import (?!type)[^;]*from '\.\.\/motion\/scene\/brandScene'/m, 'the engine stays its own chunk');
  const engine: string = fs.readFileSync(path.join(PLATFORM, 'apps/dashboard/src/motion/scene/brandScene.ts'), 'utf8');
  assert.doesNotMatch(engine, /^import (?!type)[^;]*from 'three'/m);
});

/* ---------- the motes follow the theme ---------- */

/** The mote colours as the scene drew them before the theme could change (the earlier code, kept here as the reference). */
function referenceColors(three: any, count: number, variant: string, light: boolean): number[] {
  let a = (variant === 'band' ? 0xb10b : 0xb10a) >>> 0;
  const rand = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const palette = light
    ? [new three.Color('#7A8293'), new three.Color('#7A8293'), new three.Color('#EE3324')]
    : [new three.Color('#DCE3F0'), new three.Color('#FFFFFF'), new three.Color('#FFFFFF'), new three.Color('#EE3324'), new three.Color('#7A8293')];
  palette.forEach((c: any) => c.convertLinearToSRGB());
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const big = rand() < 0.08;
    if (variant === 'band') rand(); else rand();
    rand(); rand(); rand();
    rand(); rand(); if (!big) rand();
    const c = palette[Math.floor(rand() * palette.length)];
    out.set([c.r, c.g, c.b], i * 3);
  }
  return Array.from(out);
}

test('motes: unchanged on first paint, and a theme change repaints the same motes with the other palette and blending', async () => {
  const three = await load('three');
  const { buildMotes } = await dashboard('motion/scene/brandScene.ts');
  for (const variant of ['auth', 'band']) {
    for (const light of [false, true]) {
      const m = buildMotes(three, 260, variant, light);
      assert.deepEqual(Array.from(m.geo.getAttribute('aColor').array), referenceColors(three, 260, variant, light), `${variant} ${light ? 'light' : 'dark'}: first paint as before`);
    }
    const dark = buildMotes(three, 260, variant, false);
    const seeds = Array.from(dark.geo.getAttribute('aSeed').array);
    const version = dark.geo.getAttribute('aColor').version;
    dark.setTheme(true);
    assert.deepEqual(Array.from(dark.geo.getAttribute('aColor').array), referenceColors(three, 260, variant, true));
    assert.ok(dark.geo.getAttribute('aColor').version > version, 'the new colours are uploaded');
    assert.deepEqual(Array.from(dark.geo.getAttribute('aSeed').array), seeds, 'the same motes in the same places');
    assert.equal(dark.uniforms.uLight.value, 1);
    assert.equal(dark.mat.blendDst, three.OneMinusSrcAlphaFactor);
    dark.setTheme(false);
    assert.deepEqual(Array.from(dark.geo.getAttribute('aColor').array), referenceColors(three, 260, variant, false));
    assert.equal(dark.uniforms.uLight.value, 0);
    assert.equal(dark.mat.blendDst, three.OneFactor);
    dark.geo.dispose(); dark.mat.dispose();
  }
});

test('scene: the theme is watched for as long as the scene lives', async () => {
  const fs = await load('node:fs');
  const engine: string = fs.readFileSync(path.join(PLATFORM, 'apps/dashboard/src/motion/scene/brandScene.ts'), 'utf8');
  assert.match(engine, /themeWatch\?\.observe\(document\.documentElement, \{ attributes: true, attributeFilter: \['data-theme'\] \}\)/);
  assert.match(engine, /motes\?\.setTheme\(light\); wake\(\);/);
  assert.match(engine.slice(engine.indexOf('function dispose()')), /themeWatch\?\.disconnect\(\)/);
  assert.match(engine, /shadowMat\.uniforms\.uAlpha\.value = shadowAlpha\(\) \*/);
});

test('scene: without a placement it draws nothing and sleeps at once; without a mark the motes come alone, kept off the card', async () => {
  const fs = await load('node:fs');
  const engine: string = fs.readFileSync(path.join(PLATFORM, 'apps/dashboard/src/motion/scene/brandScene.ts'), 'utf8');
  assert.match(engine, /root\.visible = !!m\?\.mark; if \(motes\) motes\.points\.visible = !!m;/);
  assert.match(engine, /const settled = !view\.hasScene \|\| \(/, 'no placement: it goes to sleep at once; otherwise it settles as before');
  // the motes fade out over the card's box (the sign-in card), so none sit behind the form
  assert.match(engine, /uniform vec4 uAvoid;/);
  assert.match(engine, /vAlpha = min\(1\.0, uOpacity \* twinkle \* edge \* bokeh \* offCard \* uGain\);/);
  assert.match(engine, /if \(card\) motes\.uniforms\.uAvoid\.value\.set\(card\.left, card\.top, card\.left \+ card\.width, card\.top \+ card\.height\);/);
});

test('scene: around a card that fills a phone\'s screen the motes gather in its margins, larger and brighter, and arrive from depth', async () => {
  const { rimRegions } = await dashboard('motion/scene/brandScene.ts');
  // 375 x 667 with the page 740 tall: the strip above the card and the two gutters down to the card's foot (+ 9 px
  // behind each edge), shared by area; nothing below the card, by the small print
  const r = rimRegions(375, 740, { left: 16, top: 24, width: 343, height: 613 });
  const above = 375 * 33, side = 25 * 646;
  assert.equal(r.area, above + 2 * side);
  assert.ok(Math.abs(r.shares[0] - above / r.area) < 1e-9 && Math.abs(r.shares[1] - (above + side) / r.area) < 1e-9);
  assert.equal(r.shares[2], 1);
  // a card taller than the page: the gutters stop at the page's foot
  assert.equal(rimRegions(360, 700, { left: 16, top: 24, width: 328, height: 900 }).area, 360 * 33 + 2 * 25 * 700);
  // a card wider than the canvas with no room above: nothing to share
  assert.equal(rimRegions(300, 600, { left: -20, top: -20, width: 340, height: 640 }).area, 0);
  const fs = await load('node:fs');
  const engine: string = fs.readFileSync(path.join(PLATFORM, 'apps/dashboard/src/motion/scene/brandScene.ts'), 'utf8');
  // only the sign-in scene with no mark and a card does this, and it says so (data-scene="rim")
  assert.match(engine, /const rim = motes && m && !m\.mark && card \? rimRegions\(W, H, card\) : null;/);
  assert.match(engine, /host\.dataset\.scene = !m \? 'none' : m\.anchored \? 'anchored' : m\.mark \? 'mark' : card \? 'rim' : 'motes';/);
  assert.match(engine, /motes\.uniforms\.uScale\.value = rim \? RIM_SCALE : 1; motes\.uniforms\.uGain\.value = rim \? RIM_GAIN : 1;/);
  // the entrance from depth needs a deeper far plane, only then
  assert.match(engine, /camera\.far = DISTANCE \* \(rim \? 4 \* RIM_DEPTH : 4\);/);
});

test('scene: on a sign-in page the motes follow the scroll by depth, one draw per scroll, never waking the loop', async () => {
  const fs = await load('node:fs');
  const engine: string = fs.readFileSync(path.join(PLATFORM, 'apps/dashboard/src/motion/scene/brandScene.ts'), 'utf8');
  assert.match(engine, /if \(variant === 'auth'\) window\.addEventListener\('scroll', onScroll, \{ passive: true \}\);/);
  const onScroll = engine.slice(engine.indexOf('const onScroll = () => {'), engine.indexOf("if (variant === 'auth') window.addEventListener('scroll'"));
  assert.match(onScroll, /scrollDraw = requestAnimationFrame\(\(\) => \{ scrollDraw = 0; if \(!running && !disposed\) renderer\.render\(scene, camera\); \}\);/);
  assert.doesNotMatch(onScroll, /wake\(\)|sync\(\)|begin\(\)|lastInput/, 'a scroll starts no loop and no idle drift');
  const dispose = engine.slice(engine.indexOf('function dispose()'));
  assert.match(dispose, /window\.removeEventListener\('scroll', onScroll\); cancelAnimationFrame\(scrollDraw\);/);
});

/* ---------- the workspace layer: rows, tabs, band parallax ---------- */

test('workspace motion: rows tip in, tab underlines glide, the band canvas trails the scroll and rests at the top', async () => {
  const fs = await load('node:fs');
  const src: string = fs.readFileSync(path.join(PLATFORM, 'apps/dashboard/src/motion/workspace.ts'), 'utf8');
  // every row animation is transform and opacity, kept for its duration only (no fill that would outlast it)
  const rows = src.slice(src.indexOf('function revealRows('), src.indexOf('/** Opens the reveal window.'));
  assert.match(rows, /fill: 'backwards'/);
  assert.doesNotMatch(rows, /fill: '(forwards|both)'/);
  assert.match(rows, /if \(k >= MAX_ROWS\) continue;/, 'long lists: only the first rows move');
  // the underline glide runs on the tab's ::after, which the browser may refuse: that must not throw
  assert.match(src, /try \{ track\(to\.animate\([^;]*pseudoElement: '::after' \}\)\); \} catch/);
  // the band canvas: no inline transform at the top of the page or off screen, and none left after dispose
  const band = src.slice(src.indexOf('function createBandParallax('), src.indexOf('/* ------', src.indexOf('function createBandParallax(')));
  assert.match(band, /if \(!off \|\| band\.bottom <= 0 \|\| band\.top >= vh\) \{ if \(moved\.delete\(el\)\) el\.style\.removeProperty\('transform'\); continue; \}/);
  assert.match(band, /const off = bandOffset\(y, band\.height\);/);
  assert.match(band.slice(band.indexOf('dispose()')), /for \(const el of moved\) el\.style\.removeProperty\('transform'\);/);
  const { ROW_SEL, BAND_LAYER_SEL, bandOffset } = await dashboard('motion/workspace.ts');
  assert.match(ROW_SEL, /table\.t > tbody > tr/);
  // what moves is the canvas inside the scene layer, never the layer: the layer is the scene's host, which the mark is
  // placed against on every resize, so moving it would bake the scroll offset into where the mark is drawn
  assert.equal(BAND_LAYER_SEL, '.heroBand > .bpScene-band > .bpSceneCanvas');
  // a tenth of the scroll, at most 6% of the band and 14 px; under half a pixel (and above the top) is none
  assert.equal(bandOffset(0, 300), 0);
  assert.equal(bandOffset(4, 300), 0);
  assert.equal(bandOffset(-80, 300), 0);
  assert.equal(bandOffset(100, 300), 10);
  assert.equal(bandOffset(1000, 300), 14);
  assert.equal(bandOffset(1000, 160), 9.6);
});

/* ---------- the app on the web: pre-rendered HTML is at rest ---------- */

test('app motion: in the web build\'s pre-rendered HTML a primitive starts at rest; on native it plays', async () => {
  // the app's own React and server renderer (the hook must run under the React that renders it)
  const req = createRequire(path.join(PLATFORM, 'apps/mobile/package.json'));
  const React = req('react');
  const { renderToString } = req('react-dom/server');
  const { useInStaticHtml } = await mobile('motion/staticHtml.ts');
  const Probe = ({ web }: { web: boolean }) => React.createElement('span', null, useInStaticHtml(web) ? 'at rest' : 'enters');
  assert.equal(renderToString(React.createElement(Probe, { web: true })), '<span>at rest</span>');
  assert.equal(renderToString(React.createElement(Probe, { web: false })), '<span>enters</span>');
});

test('app motion: every primitive with a hidden starting state starts at rest in pre-rendered HTML', async () => {
  const fs = await load('node:fs');
  const read = (f: string): string => fs.readFileSync(path.join(PLATFORM, 'apps/mobile/src/motion', f), 'utf8');
  for (const f of ['Enter.tsx', 'BrandTilt.tsx', 'MilestoneReveal.tsx', 'ProgressReveal.tsx']) {
    const src = read(f);
    assert.match(src, /const inHtml = useInStaticHtml\(Platform\.OS === 'web'\);/, f);
    assert.doesNotMatch(src, /\|\| useInStaticHtml/, `${f}: the hook is called on every render`);
  }
  assert.match(read('Enter.tsx'), /const atRest = reduce \|\| inHtml;\n\s+const progress = useSharedValue\(atRest \? 1 : 0\);\n\s+const settled = useSharedValue\(atRest \? 1 : 0\);/);
  assert.match(read('BrandTilt.tsx'), /const intro = useSharedValue\(reduce \|\| inHtml \? 1 : 0\);\n\s+const introDone = useSharedValue\(reduce \|\| inHtml \? 1 : 0\);/);
  assert.match(read('MilestoneReveal.tsx'), /const onMount = playOnMount && !inHtml;/);
  assert.match(read('ProgressReveal.tsx'), /const fill = useSharedValue\(reduce \|\| inHtml \? 1 : 0\);/);
});
