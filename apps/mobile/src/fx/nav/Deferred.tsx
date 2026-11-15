/* A heavy section of a tab page that mounts after the pager has come to rest on the page and the device has an idle
   moment (requestIdleCallback, at most t.premount later; native adds no wait beyond its idle callback's own), so its
   first render never lands in the frames of a tab switch. Until then a plain view reserves the height the section had
   on its previous visit (kept per `id` for the session), or `placeholderHeight`, so nothing below it jumps when it
   arrives. Under reduced motion and in the web's pre-rendered HTML the children render at once.
   Never wrap a ScrollAnchor in it (a section scrolled to by name must exist when it is asked for): keep the anchor
   outside. BriefCard stays outside too.
   A section turns ready inside a React transition, so several that become ready in the same idle moment render
   time-sliced (yielding to frames) instead of in one long synchronous commit.
   Native: the section then arrives in parts, two frames apart, each in its own commit. The parts are its top-level
   children (or those of the one plain View it holds), and a part that is itself a plain View with several children
   (a titled list) arrives child by child. Android inserts a commit's views and records their first draw in a single
   frame, so a whole section at once (255-398 views on Bio, Fuel and Tests) made the frame after a tab settled
   80-140 ms on the 2 GB emulator (the wave-2 gate's re-attach frames). The reserved height holds until the last part
   is in; once every part has been shown, whatever the section holds later renders at once. */
import React, { startTransition, useEffect, useState } from 'react';
import { Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import { t, useFx } from '../effects';
import { usePageSettled } from './pageReady';

const heights = new Map<string, number>();
const NATIVE = Platform.OS !== 'web';

/** An idle moment, at most `timeout` ms away. */
function whenIdle(fn: () => void, timeout: number): () => void {
  const g = globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
  if (!g.requestIdleCallback) { const timer = setTimeout(fn, 0); return () => clearTimeout(timer); }
  const h = g.requestIdleCallback(fn, { timeout });
  return () => g.cancelIdleCallback?.(h);
}

type Kids = { children?: React.ReactNode };
/** A plain View holding several children: the children arrive one by one. */
function viewKids(node: React.ReactNode): React.ReactNode[] | null {
  if (!React.isValidElement<Kids>(node) || node.type !== View) return null;
  const kids = React.Children.toArray(node.props.children);
  return kids.length > 1 ? kids : null;
}

type Part = { el: React.ReactNode; kids: React.ReactNode[] | null };
/** The section's parts: its top-level children, or the children of the one plain View it holds (`wrap`, cloned around
 *  what is shown), each a plain View's children when it is one. Keys come from React.Children.toArray, so nothing
 *  mounts twice as more arrive. `units`: how many steps the whole section takes. */
function plan(children: React.ReactNode): { wrap: React.ReactElement<Kids> | null; parts: Part[]; units: number } {
  const top = React.Children.toArray(children);
  const inner = top.length === 1 ? viewKids(top[0]) : null;
  const wrap = inner ? (top[0] as React.ReactElement<Kids>) : null;
  const parts = (inner ?? top).map((el) => ({ el, kids: viewKids(el) }));
  return { wrap, parts, units: parts.reduce((n, p) => n + (p.kids ? p.kids.length : 1), 0) };
}

/** The first `n` units of a plan (all of it for Infinity), always in the same shape, so keys never change. */
function partial({ wrap, parts }: { wrap: React.ReactElement<Kids> | null; parts: Part[] }, n: number): React.ReactNode {
  const out: React.ReactNode[] = [];
  let left = n;
  for (const p of parts) {
    if (left <= 0) break;
    if (!p.kids) { out.push(p.el); left -= 1; continue; }
    const m = Math.min(left, p.kids.length);
    out.push(React.cloneElement(p.el as React.ReactElement<Kids>, undefined, m >= p.kids.length ? p.kids : p.kids.slice(0, m)));
    left -= m;
  }
  return wrap ? React.cloneElement(wrap, undefined, out) : out;
}

export function Deferred({ id, placeholderHeight, children, style }: { id: string; placeholderHeight?: number; children: React.ReactNode; style?: StyleProp<ViewStyle> }): React.JSX.Element {
  const settled = usePageSettled();
  const { calm, inHtml } = useFx();
  const now = calm || inHtml;
  const [ready, setReady] = useState(now);
  // native: the section arrives in parts (decided once, so its children keep their keys for as long as it is mounted),
  // and how many parts are shown (Infinity: all, now and whatever arrives later)
  const [inParts] = useState(NATIVE && !now);
  const [count, setCount] = useState(inParts ? 1 : Infinity);
  useEffect(() => {
    if (ready) return;
    if (now) { setReady(true); return; }
    if (!settled) return;
    return whenIdle(() => startTransition(() => setReady(true)), t.premount);
  }, [ready, now, settled]);
  const split = inParts ? plan(children) : null;
  const total = split ? split.units : 0;
  useEffect(() => {
    if (!ready || !split || count === Infinity) return;
    if (count >= total) { setCount(Infinity); return; }
    // the next part a frame after this one's commit has been drawn
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => startTransition(() => setCount((c) => c + 1))); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [ready, count, total]); // eslint-disable-line react-hooks/exhaustive-deps
  const reserved = heights.get(id) ?? placeholderHeight ?? 0;
  if (!ready && !now) return <View style={[style, { height: reserved }]} />;
  if (split && count < total) return <View style={[style, { minHeight: reserved }]}>{partial(split, count)}</View>;
  return <View style={style} onLayout={(e) => { const h = e.nativeEvent.layout.height; if (h > 0) heights.set(id, h); }}>{split ? partial(split, Infinity) : children}</View>;
}
