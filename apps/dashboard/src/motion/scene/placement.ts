/* Where a brand scene draws the mark, worked out from the page's layout alone, without three.js. The scene engine
   (./brandScene.ts) places its camera with it on every layout, and the scene's host (components/BrandMark3D.tsx) asks
   it first, so a page with nothing to draw (a header band without its mark box) never downloads three.js or opens a
   WebGL context.

   The sign-in pages always have something: the mark over the flat mark's box on wide screens, beside or above the card
   where there is room, a smaller mark in the space above the card on most phones, and on the smallest phones (or a
   card that fills the screen) the light motes on their own, around the card and masked away from it. */
import { MARK_VIEWBOX } from '../../lib/brandMark';
import type { SceneVariant } from './brandScene';

/** A box in the host's layout pixels (the host's top-left corner is 0, 0). */
export type Box = { left: number; top: number; width: number; height: number };
/**
 * The mark's centre and width in the host's layout pixels; `anchored` when it sits over the flat mark's own box.
 * `mark` is false for the motes on their own (the sign-in pages where no mark fits): the centre is then the scene's
 * principal point and `w` is 0.
 */
export type Placement = { cx: number; cy: number; w: number; anchored: boolean; mark: boolean };

/** Room above the sign-in card (px) from which a mark is drawn there: a phone's mark is at least about 38 px tall. */
export const ABOVE_MIN = 64;

/**
 * The mark goes over its anchor (the flat mark's box) when that box is shown. Without one, the sign-in scene puts it
 * beside the card when there is room on its left, or above it when there is room on top (a smaller mark on phones),
 * and otherwise draws the motes alone; the other scenes draw nothing. `anchor` and `avoid` are null when not rendered.
 * `view` is the host's layout width and the part of its height on screen.
 */
export function placeMark(variant: SceneVariant, view: { width: number; height: number }, anchor: Box | null, avoid: Box | null): Placement | null {
  const vb = MARK_VIEWBOX;
  if (anchor && anchor.width >= 8 && anchor.height >= 8) {
    // the flat mark: an SVG of the brand viewBox filling 78% of the box, centred (preserveAspectRatio meet)
    const s = Math.min((0.78 * anchor.width) / vb.width, (0.78 * anchor.height) / vb.height);
    return { cx: anchor.left + anchor.width / 2, cy: anchor.top + anchor.height / 2, w: vb.width * s, anchored: true, mark: true };
  }
  if (variant !== 'auth' || !avoid || avoid.width < 2) return null;
  const c = avoid, vh = view.height;
  if (c.left >= 260) { // beside the card
    const w = Math.min(c.left * 0.66, 340); const h = (w * vb.height) / vb.width;
    const mid = c.top + Math.min(c.height, vh) / 2;
    return { cx: c.left / 2, cy: Math.max(h / 2 + 24, Math.min(vh - h / 2 - 24, mid)), w, anchored: false, mark: true };
  }
  if (c.top >= ABOVE_MIN) { // above it, in the middle 60% of the space, so it never touches the card or the top edge
    const h = Math.min(c.top * 0.6, 150); const w = (h * vb.width) / vb.height;
    return { cx: view.width / 2, cy: c.top / 2, w, anchored: false, mark: true };
  }
  // no room for a mark: the motes alone, centred on the screen and kept off the card (./brandScene.ts masks them)
  return { cx: view.width / 2, cy: vh / 2, w: 0, anchored: false, mark: false };
}

/** The mark's box (left, top, width, height in the host's layout pixels) for a placement that draws one. */
export function markBox(p: Placement | null): Box | null {
  if (!p || !p.mark || p.w <= 0) return null;
  const h = (p.w * MARK_VIEWBOX.height) / MARK_VIEWBOX.width;
  return { left: p.cx - p.w / 2, top: p.cy - h / 2, width: p.w, height: h };
}

/**
 * An element's box in the host's layout pixels, or null when it is not rendered. Measured in layout terms (client
 * rects divided by the host's on-screen scale), so a reveal or route transition moving the host while it is measured
 * cannot skew it.
 */
export function localBox(host: HTMLElement, el: HTMLElement | null | undefined): Box | null {
  if (!el || !el.isConnected || !el.getClientRects().length) return null;
  const hr = host.getBoundingClientRect();
  const W = host.clientWidth || hr.width, H = host.clientHeight || hr.height;
  if (W < 2 || H < 2 || hr.width < 1 || hr.height < 1) return null;
  const sx = hr.width / W, sy = hr.height / H;
  const r = el.getBoundingClientRect();
  return { left: (r.left - hr.left) / sx, top: (r.top - hr.top) / sy, width: r.width / sx, height: r.height / sy };
}

/** placeMark for elements on the page, or null when the host is not laid out. */
export function measurePlacement(host: HTMLElement, variant: SceneVariant, anchor: HTMLElement | null | undefined, avoid: HTMLElement | null | undefined): Placement | null {
  if (!host.getClientRects().length) return null;
  const hr = host.getBoundingClientRect();
  const W = host.clientWidth || hr.width, H = host.clientHeight || hr.height;
  if (W < 2 || H < 2 || hr.width < 1 || hr.height < 1) return null;
  return placeMark(variant, { width: W, height: Math.min(H, window.innerHeight) }, localBox(host, anchor), localBox(host, avoid));
}
