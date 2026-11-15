/* Search (the earlier app's 52-fuel-search / 53-fuel-search-query-chicken): the search field ("Search dishes,
   cuisines, tags…"), the "Can't find your meal?" row that opens the meal sheet (in your own words, with a photo), and the
   published foods and recipes (GET /me/foods and /me/recipes; words in the name or a tag) as dish cards. Opened for a
   swap, a banner says which planned meal the dish replaces.
   Motion (v2, M78/M82):
   - The panel's first commit is its frame (the field and the custom row); the count and the first six cards render
     right after it in a transition (in slices between frames) and the rest arrive six at a time in idle moments, so the switch
     never stalls. The cards come in with the panel's own slide (no reveal of their own); the
     unfiltered list is fetched ahead once Fuel has settled (prefetchSearch), so the switch draws cards at once.
   - A new query keeps the results on screen, dimmed to .45, while it loads; then the old results fade out (120 ms,
     drawn over the new ones and inert) while the new ones fade in (200 ms, 40 ms apart, at most four steps). The count
     line belongs to its results, so it always counts what is under it. Reduced motion: a short crossfade; tier C: the
     fades alone. */
import React, { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Button, EmptyState, ErrorState, GlassCard, Icon, SearchInput, Skeleton, T, ease, fx, t, timing, useFx } from '@/fx';
import { calmFade, motionValues } from '@/fx/motion/tokens';
import { doneOnce } from '@/fx/motion/once';
import { get, qs } from '@/lib/api';
import { prefetch, useLoad } from '@/lib/useLoad';
import { DishCard } from './DishCard';
import { SLOT_LABEL, dishKey, dishName } from './format';
import type { Dish, Page, PlanSlot } from './types';

export type DishHandlers = { open: (d: Dish) => void; toggleSave: (d: Dish) => void; source: (d: Dish) => void; isSaved: (d: Dish) => boolean };

/** The published foods and recipes for a query (words in the name or a tag), with the query they were found for. */
async function loadSearch(q: string): Promise<Result> {
  const query = qs({ q: q || undefined, limit: 100 });
  const [foods, recipes] = await Promise.all([get<Page<Dish>>(`/me/foods${query}`), get<Page<Dish>>(`/me/recipes${query}`)]);
  return { q, items: [...recipes.items, ...foods.items] };
}

/** Fetch the unfiltered list ahead (Fuel calls it once the page has settled): Search takes it on its first render. */
export function prefetchSearch(): void {
  void prefetch('fuel.search', () => loadSearch('')).catch(() => undefined);
}

const S = motionValues.screens.m78;
const S82 = motionValues.screens.m82;

type Result = { q: string; items: Dish[] };
/** The cards drawn with the panel's first commit: the ones a phone shows under the search field (layout, not motion). */
const FIRST_PAINT = 2;
type Layer = { q: string; items: Dish[]; uid: number; leaving: boolean; fresh: boolean };

/** An idle moment, at most `timeout` ms away (requestIdleCallback where there is one). */
function whenIdle(fn: () => void, timeout: number): () => void {
  const g = globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
  if (!g.requestIdleCallback) { const timer = setTimeout(fn, 0); return () => clearTimeout(timer); }
  const h = g.requestIdleCallback(fn, { timeout });
  return () => g.cancelIdleCallback?.(h);
}

function sortFor(list: Dish[], q: string): Dish[] {
  const lower = q.toLowerCase();
  return [...list].sort((a, b) => {
    const ra = lower && dishName(a).toLowerCase().startsWith(lower) ? 0 : 1;
    const rb = lower && dishName(b).toLowerCase().startsWith(lower) ? 0 : 1;
    return ra - rb || dishName(a).localeCompare(dishName(b));
  });
}

export function SearchPanel({ handlers, onCustom, swapFor, onCancelSwap }: {
  handlers: DishHandlers; onCustom: () => void; swapFor: PlanSlot | null; onCancelSwap: () => void;
}) {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const timer = setTimeout(() => setQ(text.trim()), 250); return () => clearTimeout(timer); }, [text]);
  // the answer carries its own query, so what is drawn is always counted for the words it was found for
  const res = useLoad<Result>('fuel.search', () => loadSearch(q), [q], { shared: true });
  const shown = useMemo(() => (res.data ? { q: res.data.q, items: sortFor(res.data.items, res.data.q) } : null), [res.data]);
  const pending = !!shown && shown.q !== q; // a new query is on its way: the results on screen dim

  // the result layers: the current one, and for a moment the previous one fading out over it (derived during render,
  // as SwitchView does: the new results and their count arrive in the same commit as the old ones start to leave)
  const seq = useRef(0);
  const [state, setState] = useState<{ key: string | null; layers: Layer[] }>({ key: null, layers: [] });
  let layers = state.layers;
  const key = shown ? `${shown.q}|${shown.items.map(dishKey).join(',')}` : null;
  if (shown && key !== state.key) {
    seq.current += 1;
    layers = [...state.layers.filter((l) => !l.leaving).map((l) => ({ ...l, leaving: true })),
      { q: shown.q, items: shown.items, uid: seq.current, leaving: false, fresh: state.key !== null }];
    setState({ key, layers });
  }
  const gone = (uid: number) => setState((st) => ({ ...st, layers: st.layers.filter((l) => l.uid !== uid) }));
  const current = layers.find((l) => !l.leaving) ?? null;

  return <View style={styles.wrap}>
    {swapFor ? <GlassCard rule={{ color: fx.red.brand }} padding={16}>
      <T v="overline">{`Swapping your ${(SLOT_LABEL[swapFor.slot] ?? swapFor.slot).toLowerCase()}`}</T>
      <T v="body" style={styles.swapText}>{`Pick what you ate instead of “${swapFor.title}”.`}</T>
      <Button title="Cancel the swap" variant="link" iconRight={null} onPress={onCancelSwap} style={styles.cancel} />
    </GlassCard> : null}
    <SearchInput value={text} onChangeText={setText} placeholder="Search dishes, cuisines, tags…" shortPlaceholder="Search dishes" label="Search dishes" />
    <GlassCard onPress={onCustom} label="Can’t find your meal? Log it in your own words" padding={16} style={styles.custom}>
      <View style={styles.customRow}>
        <View style={styles.customTile}><Icon name="chef-hat" size={20} color={fx.red.vivid} /></View>
        <View style={styles.flex}>
          <T v="cardTitle">Can’t find your meal?</T>
          <T v="caption" color={fx.ink.a70}>Log it in your own words, with a photo if you like</T>
        </View>
        <Icon name="chevron-right" size={18} color={fx.ink.a60} />
      </View>
    </GlassCard>
    {res.error && !res.data ? <ErrorState error={res.error} onRetry={res.reload} />
      : !current ? <SearchSkeleton />
        : <View>
          {layers.map((l) => <ResultLayer key={l.uid} layer={l} dim={!l.leaving && pending} handlers={handlers} onCustom={onCustom} onGone={() => gone(l.uid)} />)}
        </View>}
  </View>;
}

/** One query's results: the count line and its cards (six now, the rest six at a time when the device is idle). */
function ResultLayer({ layer, dim, handlers, onCustom, onGone }: { layer: Layer; dim: boolean; handlers: DishHandlers; onCustom: () => void; onGone: () => void }) {
  const { calm, inHtml } = useFx();
  const { q, items, leaving, fresh } = layer;
  // the panel's first commit carries its frame (the input and the count); the first six cards follow at once in a
  // transition (rendered in slices), the rest six at a time in idle moments
  const [limit, setLimit] = useState<number>(fresh || inHtml ? S.firstBatch : FIRST_PAINT);
  useEffect(() => {
    if (limit < S.firstBatch) { startTransition(() => setLimit(S.firstBatch)); return; }
    if (leaving || limit >= items.length) return;
    // a transition: the batch renders in slices between frames, only its commit takes a frame
    return whenIdle(() => startTransition(() => setLimit((n) => n + S.batch)), t.premount);
  }, [leaving, limit, items.length]);

  // the layer's strength: .45 while a newer query loads, out over 120 ms when replaced (then gone)
  const o = useSharedValue(1);
  useEffect(() => {
    if (leaving) {
      const out = doneOnce(onGone, S82.oldOutMs + motionValues.overlay.fallbackExtra);
      o.value = withTiming(0, inHtml ? timing(0) : calm ? calmFade(S82.oldOutMs) : timing(S82.oldOutMs, ease.css), (f) => { 'worklet'; if (f) scheduleOnRN(out.done); });
      return () => out.cancel();
    }
    o.value = withTiming(dim ? S82.dimTo : 1, calm ? calmFade() : timing(S82.oldOutMs, ease.css));
    // the parent's onGone is a fresh closure each render; the layer leaves once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving, dim, calm, inHtml, o]);
  const a = useAnimatedStyle(() => ({ opacity: o.value }));

  const count = items.length;
  const line = <T v="caption" color={fx.ink.a55} style={styles.count}>{`${count} ${count === 1 ? 'dish' : 'dishes'}${q ? ` for “${q}”` : ''} · values per serving, as entered`}</T>;
  const body = count ? <>
    {fresh ? <FadeIn index={0}>{line}</FadeIn> : line}
    {items.slice(0, limit).map((d, i) => {
      const card = <DishCard dish={d} saved={handlers.isSaved(d)} onOpen={() => handlers.open(d)} onToggleSave={() => handlers.toggleSave(d)} onSource={() => handlers.source(d)} />;
      return fresh ? <FadeIn key={dishKey(d)} index={i}>{card}</FadeIn> : <View key={dishKey(d)}>{card}</View>;
    })}
  </>
    : <EmptyState icon="search" title={q ? `No dishes match “${q}”` : 'No dishes in the library yet'} body="Log it in your own words instead; your coach reads it." action={{ title: 'Log a meal', icon: 'chef-hat', onPress: onCustom }} />;
  return <Animated.View
    style={[styles.layer, leaving ? styles.leaving : null, a]}
    pointerEvents={leaving ? 'none' : 'auto'}
    {...(leaving ? { 'aria-hidden': true, accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const } : null)}>
    {body}
  </Animated.View>;
}

/** A new query's card fading in: 200 ms, 40 ms apart, at most four steps (later cards take the fourth). */
function FadeIn({ index, children }: { index: number; children: React.ReactNode }) {
  const { calm, inHtml } = useFx();
  const still = inHtml;
  const o = useSharedValue(still ? 1 : 0);
  useEffect(() => {
    if (still) return;
    const wait = Math.min(index, S82.newMax - 1) * S82.newStep;
    const show = withTiming(1, calm ? calmFade() : timing(S82.newInMs, ease.css));
    o.value = calm || wait === 0 ? show : withDelay(wait, show);
    // once, at mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const a = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={a}>{children}</Animated.View>;
}

function SearchSkeleton() {
  return <View style={styles.wrap} accessibilityLabel="Loading dishes">
    {[0, 1].map((i) => <View key={i} style={styles.skel}>
      <Skeleton height={120} radius={0} />
      <View style={styles.skelBody}><Skeleton height={16} width="60%" /><Skeleton height={12} width="40%" /><Skeleton height={12} width="85%" /></View>
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  layer: { gap: 16 },
  leaving: { position: 'absolute', left: 0, right: 0, top: 0 },
  flex: { flex: 1, gap: 2 },
  swapText: { marginTop: 4 },
  cancel: { alignSelf: 'flex-start', marginTop: 4 },
  custom: { borderRadius: fx.radius.card },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  customTile: { width: 44, height: 44, borderRadius: fx.radius.xl, borderWidth: 1, borderColor: fx.red.a30, backgroundColor: fx.red.a10, alignItems: 'center', justifyContent: 'center' },
  count: { marginTop: -4 },
  skel: { borderRadius: fx.radius.card, overflow: 'hidden', borderWidth: 1, borderColor: fx.line.a05, backgroundColor: fx.bg.panelSolid },
  skelBody: { padding: 16, gap: 10 },
});
