/* The workspace motion layer, attached once by <WorkspaceMotion/> in the shell and loaded only when motion is allowed.
   Everything here works on the portal's existing elements from the outside, with the Web Animations API and
   delegated listeners, so no page or component changes:

   - reveal: the cards of a section rise in, staggered, when the section arrives (or a tab changes), the rows of their
     lists and tables tip up into place behind them, and the charts inside them grow from their baseline (bars), rise
     into place (lines) and pop in (points);
   - depth: a mouse over a small card tilts it a degree or two toward the pointer and springs back on leave;
   - tabs: the selected tab's underline glides over from the tab that was selected, and the new tab settles forward;
   - band parallax: a header band's 3D canvas trails the page a few pixels as it scrolls, so the mark sits deeper than
     the text; at the top of the page, and once the band is off screen, it is exactly where the page drew it;
   - panels: dialogs scale and fade in and out (a still, inert copy plays the close), accordions ease open and closed,
     the phone navigation's scrim fades in.

   Only transform and opacity move, and only while moving: every animation leaves no inline style behind (no fill),
   card depth removes its transform once it has sprung back, so at rest every element is exactly as the page drew it.
   Nothing here changes focus, the accessibility tree or layout. Anything inside [data-motion-off] is left alone. */
import { EASE_IN, EASE_OUT, finePointer } from './env';

export type WorkspaceMotionHandle = { routeChanged: () => void; dispose: () => void };

const REVEAL_SEL = '.heroBand, .bp-card, .bp-tile, .tableWrap, .bp-acc, .bp-empty';
/** List and table rows that tip up into place when they arrive with a section. */
export const ROW_SEL = 'table.t > tbody > tr, ul.taskList > li, .notifList > .notif, .milestones > .milestone';
const MAX_ROWS = 14;
const CHART_SEL = 'svg.chart, svg.bp-chart, svg.bp-spark, .bp-ring';
const DEPTH_SEL = '.bp-card, .bp-tile';
const SKIP_SEL = '[data-motion-off], dialog, .popover';
const ROUTE_WINDOW = 4000; // cards that arrive within this long of a section change are revealed (data loads late)
const TAB_WINDOW = 1600;
const MAX_STAGGER = 9;

const live = (a: Animation) => a.playState !== 'finished' && a.playState !== 'idle';

export function attachWorkspaceMotion(main: HTMLElement, shell: HTMLElement): WorkspaceMotionHandle {
  const animations = new Set<Animation>();
  const track = (a: Animation, after?: () => void) => {
    animations.add(a);
    const done = () => { animations.delete(a); after?.(); };
    a.addEventListener('finish', done); a.addEventListener('cancel', done);
    return a;
  };
  const reveal = createReveal(main, track);
  const depth = createDepth(main);
  const panels = createPanels(shell, track);
  const tabs = createTabs(main, track);
  const parallax = createBandParallax(main);
  return {
    routeChanged() { depth.reset(); reveal.open(ROUTE_WINDOW); parallax.update(); },
    dispose() { reveal.dispose(); depth.dispose(); panels.dispose(); tabs.dispose(); parallax.dispose(); animations.forEach((a) => { if (live(a)) a.cancel(); }); animations.clear(); },
  };
}

/* ---------------------------------------------------------------- reveal ---------------------------------------- */

function createReveal(root: HTMLElement, track: (a: Animation, after?: () => void) => Animation) {
  const seen = new WeakSet<Element>();
  const seenCharts = new WeakSet<Element>();
  let windowUntil = 0;
  let pending: Element[] = [];
  let pendingCharts: Element[] = [];
  let pendingRows: Element[] = [];
  const seenRows = new WeakSet<Element>();
  let raf = 0;

  const inWindow = () => performance.now() < windowUntil;
  const skipped = (el: Element) => !!el.closest(SKIP_SEL);
  const schedule = () => { if (!raf) raf = requestAnimationFrame(flush); };

  function collect(node: Element) {
    if (inWindow()) {
      if (node.matches(REVEAL_SEL)) pending.push(node);
      node.querySelectorAll(REVEAL_SEL).forEach((el) => pending.push(el));
      if (node.matches(ROW_SEL)) pendingRows.push(node);
      node.querySelectorAll(ROW_SEL).forEach((el) => pendingRows.push(el));
    }
    if (node.matches(CHART_SEL)) pendingCharts.push(node);
    node.querySelectorAll(CHART_SEL).forEach((el) => pendingCharts.push(el));
  }

  function flush() {
    raf = 0;
    const vh = window.innerHeight;
    const batch = pending.filter((el) => el.isConnected && !seen.has(el) && !skipped(el));
    pending = [];
    batch.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    const moving = new Set<Element>();
    let i = 0;
    for (const el of batch) {
      seen.add(el);
      // a card inside a card that is already rising moves with it
      let up = el.parentElement, nested = false;
      while (up && up !== root) { if (moving.has(up)) { nested = true; break; } up = up.parentElement; }
      if (nested) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.bottom < 0 || r.top > vh) continue; // off screen: it is simply there when scrolled to
      const delay = Math.min(i, MAX_STAGGER) * 55; i++;
      moving.add(el);
      track(el.animate([{ opacity: 0, transform: 'translate3d(0, 14px, 0) scale(.985)' }, { opacity: 1, transform: 'none' }], { duration: 560, delay, easing: EASE_OUT, fill: 'backwards' }));
      el.querySelectorAll(CHART_SEL).forEach((c) => { if (!seenCharts.has(c)) { seenCharts.add(c); revealChart(c, delay + 140, track); } });
      revealRows(Array.from(el.querySelectorAll(ROW_SEL)), delay + 120, vh);
    }
    // rows that arrive on their own inside a card already on the page (its data came after it) tip in from where they are
    const rows = pendingRows.filter((r) => r.isConnected && !seenRows.has(r) && !skipped(r));
    pendingRows = [];
    if (rows.length) revealRows(rows, 40, vh);
    // charts that arrive on their own (a new range, a reloaded series) grow in wherever they appear
    const charts = pendingCharts.filter((c) => c.isConnected && !seenCharts.has(c) && !skipped(c));
    pendingCharts = [];
    for (const c of charts) {
      seenCharts.add(c);
      const r = c.getBoundingClientRect();
      if (r.width === 0 || r.bottom < 0 || r.top > vh) continue;
      revealChart(c, 60, track);
    }
  }

  const mo = new MutationObserver((records) => {
    for (const rec of records) rec.addedNodes.forEach((n) => { if (n.nodeType === 1) collect(n as Element); });
    if (pending.length || pendingCharts.length || pendingRows.length) schedule();
  });
  mo.observe(root, { childList: true, subtree: true });

  // a tab strip changes the section in place: its new panel is revealed like a new section
  const onTab = (e: Event) => { const t = e.target as Element | null; if (t?.closest?.('[role="tab"], .bp-seg button')) windowUntil = Math.max(windowUntil, performance.now() + TAB_WINDOW); };
  root.addEventListener('click', onTab, true);
  root.addEventListener('keydown', onTab, true);

  /** The rows of a list or table tip up into place, a few at a time (the first MAX_ROWS of each list on screen; the
      rest are simply there). A slight turn about the row's top edge in perspective: transform and opacity only. */
  function revealRows(rows: Element[], delay: number, vh: number) {
    const perList = new Map<Element | null, number>();
    for (const row of rows) {
      if (seenRows.has(row)) continue;
      seenRows.add(row);
      const list = row.parentElement;
      const k = perList.get(list) ?? 0; perList.set(list, k + 1);
      if (k >= MAX_ROWS) continue;
      const r = row.getBoundingClientRect();
      if (r.width === 0 || r.bottom < 0 || r.top > vh) continue;
      track(row.animate([{ opacity: 0, transform: 'perspective(700px) translate3d(0, 6px, 0) rotateX(-14deg)', transformOrigin: '50% 0' }, { opacity: 1, transform: 'none', transformOrigin: '50% 0' }], { duration: 440, delay: delay + k * 30, easing: EASE_OUT, fill: 'backwards' }));
    }
  }

  /** Opens the reveal window. What is already on the page has been painted (or is the section that is leaving), so it
      is marked as seen rather than animated; what arrives from now on rises in. */
  function open(ms: number) {
    windowUntil = performance.now() + ms;
    root.querySelectorAll(REVEAL_SEL).forEach((el) => seen.add(el));
    root.querySelectorAll(CHART_SEL).forEach((el) => seenCharts.add(el));
    root.querySelectorAll(ROW_SEL).forEach((el) => seenRows.add(el));
  }
  open(ROUTE_WINDOW);
  return {
    open,
    dispose() { mo.disconnect(); cancelAnimationFrame(raf); root.removeEventListener('click', onTab, true); root.removeEventListener('keydown', onTab, true); },
  };
}

/** Bars grow from the baseline, lines rise into place, points pop in, rings settle. Transform and opacity only, with
    the SVG transform box set inline for the length of the animation and removed after it. */
function revealChart(chart: Element, delay: number, track: (a: Animation, after?: () => void) => Animation) {
  if (chart.matches('.bp-ring')) {
    track(chart.animate([{ opacity: 0, transform: 'scale(.92)' }, { opacity: 1, transform: 'none' }], { duration: 620, delay, easing: EASE_OUT, fill: 'backwards' }));
    return;
  }
  const svgPart = (el: SVGElement, origin: string, keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
    const s = el.style; const prevBox = s.transformBox, prevOrigin = s.transformOrigin;
    s.transformBox = 'fill-box'; s.transformOrigin = origin;
    track(el.animate(keyframes, { ...options, fill: 'backwards' }), () => { s.transformBox = prevBox; s.transformOrigin = prevOrigin; });
  };
  const bars = Array.from(chart.querySelectorAll<SVGElement>('rect.bar1, rect.bar2, rect.bar3, rect.bar4'));
  bars.forEach((b, i) => svgPart(b, '50% 100%', [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration: 640, delay: delay + Math.min(i, 16) * 32, easing: EASE_OUT }));
  const lines = Array.from(chart.querySelectorAll<SVGElement>('polyline, path.s1, path.s2, path.s3, path.s4'));
  lines.forEach((l) => svgPart(l, '50% 100%', [{ opacity: 0, transform: 'scaleY(0.2)' }, { opacity: 1, transform: 'scaleY(1)' }], { duration: 760, delay, easing: EASE_OUT }));
  const points = Array.from(chart.querySelectorAll<SVGElement>('circle, polygon, .pt, rect')).filter((p) => !bars.includes(p) && !p.matches('.band, .bp-spark-band') && (p.tagName.toLowerCase() !== 'rect' || Number(p.getAttribute('width')) <= 10));
  const pointDelay = delay + (lines.length ? 320 : 120);
  points.forEach((p, i) => svgPart(p, '50% 50%', [{ opacity: 0, transform: 'scale(.3)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 420, delay: pointDelay + Math.min(i, 24) * 18, easing: EASE_OUT }));
}

/* ---------------------------------------------------------------- card depth ------------------------------------ */

type Tilt = { rx: number; ry: number; vx: number; vy: number; tx: number; ty: number };
const MAX_TILT = 2.2; // degrees
const PERSPECTIVE = 900; // px

function createDepth(root: HTMLElement) {
  if (!finePointer()) return { reset() {}, dispose() {} };
  const tilts = new Map<HTMLElement, Tilt>();
  const ok = new WeakMap<HTMLElement, { yes: boolean; at: number }>();
  let current: HTMLElement | null = null;
  let raf = 0; let last = 0;

  function eligible(el: HTMLElement): boolean {
    if (tilts.has(el)) return true; // ours, mid-spring
    if (el.closest(SKIP_SEL) || el.matches('a, button, .bp-card-link, .heroBand, .authCard')) return false;
    if (el.style.transform) return false; // someone else's inline transform
    if (getComputedStyle(el).transform !== 'none') return false; // a hover lift of its own
    const r = el.getBoundingClientRect();
    if (r.width < 60 || r.width > 560 || r.height > 440) return false; // large panels of data stay flat
    return !el.querySelector('table, input, select, textarea, [contenteditable], .tableWrap, .thread, dialog');
  }
  function pick(target: EventTarget | null): HTMLElement | null {
    let el = (target as Element | null)?.closest?.(DEPTH_SEL) as HTMLElement | null;
    const now = performance.now();
    while (el && root.contains(el)) {
      let c = ok.get(el);
      if (!c || now - c.at > 1000) { c = { yes: eligible(el), at: now }; ok.set(el, c); }
      if (c.yes) return el;
      el = el.parentElement?.closest(DEPTH_SEL) as HTMLElement | null;
    }
    return null;
  }
  function tiltOf(el: HTMLElement): Tilt { let t = tilts.get(el); if (!t) { t = { rx: 0, ry: 0, vx: 0, vy: 0, tx: 0, ty: 0 }; tilts.set(el, t); } return t; }
  function frame(now: number) {
    raf = 0;
    const dt = Math.min(0.05, Math.max(0.001, (now - (last || now - 16)) / 1000)); last = now;
    for (const [el, t] of tilts) {
      if (el !== current) { t.tx = 0; t.ty = 0; }
      // a soft spring (stiffness 170, damping 22): no overshoot to speak of
      const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
      for (let i = 0; i < n; i++) { t.vx += (170 * (t.tx - t.rx) - 22 * t.vx) * h; t.rx += t.vx * h; t.vy += (170 * (t.ty - t.ry) - 22 * t.vy) * h; t.ry += t.vy * h; }
      const rest = el !== current && Math.abs(t.rx) < 0.01 && Math.abs(t.ry) < 0.01 && Math.abs(t.vx) < 0.05 && Math.abs(t.vy) < 0.05;
      if (rest || !el.isConnected) { el.style.removeProperty('transform'); tilts.delete(el); continue; }
      el.style.transform = `perspective(${PERSPECTIVE}px) rotateX(${t.rx.toFixed(3)}deg) rotateY(${t.ry.toFixed(3)}deg)`;
    }
    if (tilts.size) raf = requestAnimationFrame(frame); else last = 0;
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    const el = pick(e.target);
    current = el;
    if (el) {
      const r = el.getBoundingClientRect();
      const x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
      const y = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
      const t = tiltOf(el); t.tx = -y * MAX_TILT; t.ty = x * MAX_TILT;
    }
    if (tilts.size) kick();
  };
  const release = () => { current = null; if (tilts.size) kick(); };
  root.addEventListener('pointermove', onMove, { passive: true });
  root.addEventListener('pointerleave', release);
  root.addEventListener('pointerdown', release); // a press is not the moment for a moving target
  window.addEventListener('scroll', release, { passive: true, capture: true });
  return {
    reset() { current = null; for (const el of tilts.keys()) el.style.removeProperty('transform'); tilts.clear(); },
    dispose() {
      root.removeEventListener('pointermove', onMove); root.removeEventListener('pointerleave', release); root.removeEventListener('pointerdown', release);
      window.removeEventListener('scroll', release, { capture: true } as EventListenerOptions);
      cancelAnimationFrame(raf); for (const el of tilts.keys()) el.style.removeProperty('transform'); tilts.clear();
    },
  };
}

/* ---------------------------------------------------------------- tabs ------------------------------------------ */

/** A tab strip's selection moving: the new tab's underline (its ::after) glides over from the tab that was selected,
    and the new tab settles forward from a hair deeper. The tabs never move or resize, so both boxes are read after
    the change. */
function createTabs(root: HTMLElement, track: (a: Animation, after?: () => void) => Animation) {
  const mo = new MutationObserver((records) => {
    const lost = new Map<Element, HTMLElement>(); const won = new Map<Element, HTMLElement>();
    for (const rec of records) {
      const t = rec.target as HTMLElement;
      if (rec.type !== 'attributes' || t.getAttribute('role') !== 'tab' || t.closest(SKIP_SEL)) continue;
      const list = t.closest('[role="tablist"]'); if (!list) continue;
      const now = t.getAttribute('aria-selected') === 'true';
      if (now && rec.oldValue !== 'true') won.set(list, t);
      else if (!now && rec.oldValue === 'true') lost.set(list, t);
    }
    for (const [list, to] of won) {
      const from = lost.get(list); if (!from || !from.isConnected) continue;
      const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
      if (a.width < 2 || b.width < 2) continue;
      // the underline is inset 10px each side of its tab
      const s = Math.max(0.05, (a.width - 20) / Math.max(1, b.width - 20));
      const dx = a.left + a.width / 2 - (b.left + b.width / 2);
      try { track(to.animate([{ transform: `translateX(${dx.toFixed(1)}px) scaleX(${s.toFixed(3)})` }, { transform: 'none' }], { duration: 380, easing: EASE_OUT, pseudoElement: '::after' })); } catch { /* no pseudo-element animation here */ }
      track(to.animate([{ transform: 'perspective(400px) translate3d(0, 0, -16px)' }, { transform: 'none' }], { duration: 300, easing: EASE_OUT }));
    }
  });
  mo.observe(root, { subtree: true, attributes: true, attributeFilter: ['aria-selected'], attributeOldValue: true });
  return { dispose() { mo.disconnect(); } };
}

/* ---------------------------------------------------------------- header band parallax -------------------------- */

/** What moves: the canvas inside a header band's scene layer, never the layer itself. The layer is the scene's host,
    and the scene measures where to draw the mark against the host's box (scene/placement.ts) whenever the page
    resizes (a phone's address bar showing or hiding resizes it mid-scroll); a host moved by the parallax would bake the
    offset into the mark's position. The canvas is only what the host shows, so moving it changes nothing measured. */
export const BAND_LAYER_SEL = '.heroBand > .bpScene-band > .bpSceneCanvas';
const BAND_RATE = 0.1; // the canvas trails the page by a tenth of the scroll
const BAND_MAX = 0.06; // and by at most 6% of the band's height
const BAND_MAX_PX = 14; // and never more than 14 px

/** The offset (px) a header band's canvas trails the page by, at scroll position `scrollY`, for a band `bandHeight`
    tall: a tenth of the scroll, at most 6% of the band and 14 px; under half a pixel is none. */
export function bandOffset(scrollY: number, bandHeight: number): number {
  const off = Math.min(BAND_MAX_PX, bandHeight * BAND_MAX, Math.max(0, scrollY) * BAND_RATE);
  return off < 0.5 ? 0 : Math.round(off * 100) / 100;
}

/** A header band's 3D canvas (behind its text) trails the page as it scrolls. Scroll-linked, so it is still whenever
    the page is: at the top of the page, and with the band off screen, its inline transform is removed and the band is
    exactly as drawn. */
function createBandParallax(root: HTMLElement) {
  let raf = 0;
  const moved = new Set<HTMLElement>();
  function frame() {
    raf = 0;
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    const vh = window.innerHeight;
    const canvases = new Set(Array.from(root.querySelectorAll<HTMLElement>(BAND_LAYER_SEL)).filter((el) => !el.closest(SKIP_SEL)));
    for (const el of moved) if (!canvases.has(el)) { el.style.removeProperty('transform'); moved.delete(el); }
    for (const el of canvases) {
      const band = el.closest('.heroBand')!.getBoundingClientRect();
      const off = bandOffset(y, band.height);
      if (!off || band.bottom <= 0 || band.top >= vh) { if (moved.delete(el)) el.style.removeProperty('transform'); continue; }
      el.style.transform = `translate3d(0, ${off.toFixed(2)}px, 0)`;
      moved.add(el);
    }
  }
  const update = () => { if (!raf) raf = requestAnimationFrame(frame); };
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  return {
    update,
    dispose() {
      window.removeEventListener('scroll', update); window.removeEventListener('resize', update); cancelAnimationFrame(raf);
      for (const el of moved) el.style.removeProperty('transform'); moved.clear();
    },
  };
}

/* ---------------------------------------------------------------- dialogs, accordions, scrim -------------------- */

/** Input types whose value attribute is page copy (a button's label) or a fixed form value (a checkbox's "on"), never
    something a person typed. */
const FIXED_VALUE_TYPES = new Set(['button', 'submit', 'reset', 'image', 'checkbox', 'radio']);

/** Empties every place in a copied subtree where typed text can sit, so a dialog's close copy never holds a password,
    a one-time code or any other entry, not even for the moment it is on screen. A deep clone brings the value
    attribute along, and React mirrors every controlled input's value into it (passwords included), so the attribute
    goes as well as the value; a textarea's text and editable regions are emptied too. Fields in the copy show their
    placeholders, and choice controls their markup defaults: no state is copied from the live dialog. */
export function scrubFields(root: ParentNode) {
  root.querySelectorAll('input').forEach((el) => { if (FIXED_VALUE_TYPES.has(el.type)) return; el.removeAttribute('value'); el.value = ''; });
  root.querySelectorAll('textarea').forEach((el) => { el.textContent = ''; el.value = ''; });
  root.querySelectorAll('[contenteditable]').forEach((el) => { if (el.getAttribute('contenteditable') !== 'false') el.textContent = ''; });
}

type DialogState = { rect: DOMRect; scrollTop: number; onScroll: () => void };

function createPanels(scope: HTMLElement, track: (a: Animation, after?: () => void) => Animation) {
  const dialogs = new Map<HTMLDialogElement, DialogState>();
  const closing = new WeakSet<HTMLDetailsElement>();
  const opening = new WeakSet<HTMLDetailsElement>();
  // the close copy needs the dialog's resting box: measured on open, on resize, and never while an animation moves it
  const measure = (d: HTMLDialogElement) => { const s = dialogs.get(d); if (s && d.open && !d.getAnimations().some(live)) s.rect = d.getBoundingClientRect(); };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => { for (const e of entries) measure(e.target as HTMLDialogElement); }) : null;

  function opened(d: HTMLDialogElement) {
    if (d.closest('[data-motion-off]')) return;
    const prev = dialogs.get(d); if (prev) d.removeEventListener('scroll', prev.onScroll);
    const state: DialogState = { rect: d.getBoundingClientRect(), scrollTop: d.scrollTop, onScroll: () => { state.scrollTop = d.scrollTop; } };
    dialogs.set(d, state);
    d.addEventListener('scroll', state.onScroll, { passive: true });
    ro?.observe(d);
    track(d.animate([{ opacity: 0, transform: 'translate3d(0, 12px, 0) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: EASE_OUT }), () => measure(d));
    try { track(d.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'linear', pseudoElement: '::backdrop' })); } catch { /* no pseudo-element animation here */ }
  }

  /** The dialog has already left the top layer: a still, inert, hidden-from-assistive-technology copy of its last
      frame plays the close in its place and removes itself. Ids and names are stripped so it cannot join a radio
      group, satisfy a label or answer getElementById. */
  function closed(d: HTMLDialogElement) {
    const state = dialogs.get(d); if (!state) return;
    dialogs.delete(d); d.removeEventListener('scroll', state.onScroll); ro?.unobserve(d);
    const r = state.rect; if (r.width < 2 || r.height < 2) return;
    const ghost = document.createElement('div');
    ghost.className = `${d.className} bpmGhost`;
    ghost.setAttribute('aria-hidden', 'true'); ghost.setAttribute('inert', '');
    d.childNodes.forEach((n) => ghost.appendChild(n.cloneNode(true)));
    // still and silent: no media, no identity, no handlers (all before the copy joins the document)
    ghost.querySelectorAll('video, audio, iframe, object, embed, script').forEach((n) => n.remove());
    ghost.querySelectorAll('*').forEach((n) => { for (const a of Array.from(n.attributes)) if (/^(id|name|for|form|autofocus|on.*)$/i.test(a.name)) n.removeAttribute(a.name); });
    // and no form state: nothing is read from the live fields, and the copy is emptied of what it brought along
    scrubFields(ghost);
    ghost.style.left = `${r.left}px`; ghost.style.top = `${r.top}px`; ghost.style.width = `${r.width}px`; ghost.style.height = `${r.height}px`;
    const scrim = document.createElement('div');
    scrim.className = 'bpmGhostScrim'; scrim.setAttribute('aria-hidden', 'true');
    document.body.append(scrim, ghost);
    ghost.scrollTop = state.scrollTop;
    const cleanup = () => { ghost.remove(); scrim.remove(); };
    const timer = window.setTimeout(cleanup, 600);
    track(scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'linear', fill: 'forwards' }));
    track(ghost.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translate3d(0, 8px, 0) scale(.98)' }], { duration: 180, easing: EASE_IN, fill: 'forwards' }), () => { window.clearTimeout(timer); cleanup(); });
  }

  const mo = new MutationObserver((records) => {
    for (const rec of records) {
      if (rec.type === 'attributes' && rec.target instanceof HTMLDialogElement) {
        const d = rec.target;
        if (d.open && rec.oldValue === null) opened(d);
        else if (!d.open && rec.oldValue !== null) closed(d);
      } else if (rec.type === 'childList') {
        rec.removedNodes.forEach((n) => { if (n instanceof HTMLDialogElement && dialogs.has(n)) closed(n); else if (n instanceof Element) n.querySelectorAll('dialog').forEach((d) => { if (dialogs.has(d)) closed(d); }); });
        rec.addedNodes.forEach((n) => {
          if (n instanceof HTMLElement && n.classList.contains('scrim') && !n.closest('[data-motion-off]')) track(n.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'linear' }));
        });
      }
    }
  });
  mo.observe(scope, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'], attributeOldValue: true });

  // accordions (<details>): the body eases in on open; a click on the summary of an open one plays the close first
  const parts = (d: HTMLDetailsElement) => Array.from(d.children).filter((c) => c.tagName !== 'SUMMARY');
  const easeIn = (d: HTMLDetailsElement) => parts(d).forEach((c) => track(c.animate([{ opacity: 0, transform: 'translate3d(0, -6px, 0)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: EASE_OUT })));
  const onToggle = (e: Event) => {
    const d = e.target;
    if (!(d instanceof HTMLDetailsElement)) return;
    if (opening.has(d)) { opening.delete(d); return; }
    if (!d.open || closing.has(d) || d.closest('[data-motion-off]')) return;
    easeIn(d);
  };
  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0) return;
    const target = e.target as Element | null;
    const summary = target?.closest?.('summary');
    const d = summary?.parentElement;
    if (!summary || !(d instanceof HTMLDetailsElement) || d.querySelector(':scope > summary') !== summary || d.closest('[data-motion-off]')) return;
    const inner = target?.closest('a, button, input, select, textarea, label');
    if (inner && inner !== summary && summary.contains(inner)) return; // a control inside the summary does its own thing
    if (!d.open) { if (!closing.has(d)) { opening.add(d); easeIn(d); } return; } // the default action opens it right after this
    e.preventDefault();
    if (closing.has(d)) return;
    closing.add(d);
    const anims = parts(d).map((c) => track(c.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translate3d(0, -4px, 0)' }], { duration: 150, easing: EASE_IN, fill: 'forwards' })));
    const finish = () => { if (!closing.has(d)) return; closing.delete(d); d.open = false; anims.forEach((a) => a.cancel()); };
    Promise.all(anims.map((a) => a.finished.catch(() => undefined))).then(finish);
    window.setTimeout(finish, 400);
  };
  scope.addEventListener('toggle', onToggle, true);
  scope.addEventListener('click', onClick, true);

  return {
    dispose() {
      mo.disconnect(); ro?.disconnect();
      scope.removeEventListener('toggle', onToggle, true); scope.removeEventListener('click', onClick, true);
      for (const [d, s] of dialogs) d.removeEventListener('scroll', s.onScroll);
      dialogs.clear();
    },
  };
}
