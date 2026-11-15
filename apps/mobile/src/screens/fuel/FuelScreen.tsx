/* The Fuel tab (the earlier app's Nutrition tab, shots 51–59, with Bioptime's nutrition module kept whole).
   - Header "Nutrition" / "Your coach's plan and what you ate" over the Fuel photo band (fuel.header; the plate photo
     while searching), a settings button for food preferences (PUT /me/nutrition/profile), and the compact bar that
     takes over as the page scrolls.
   - The neutral segment Today · Search · Saved (pinned under the compact bar while scrolling; the panel enters from
     ±20 in the direction of the change; the last one is remembered on this device; `?segment=` opens one).
   - Today: target ring and macro bars from today's counted totals, the coach's meal plan and its week, today's meals
     (As planned / Swapped / Skipped, + Add, Browse, delete, photos), the coach's feedback and the 7-day adherence.
   - Search: the published foods and recipes; the dish sheet logs a portion (POST /me/meal-logs) and returns to Today
     with the bottom toast "{name} logged". Swapped on a planned meal can pick its replacement here.
   - Saved: the hearted dishes (GET/PUT /me/nutrition/favourites).
   Module off (nutrition): the empty state with the plan's nutrition tasks. Nothing is estimated anywhere. */
import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { runOnJS, useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CompactBar, ErrorState, IconButton, RevealScope, ScreenHeader, Segmented, Sheet, SkeletonRing, Skeleton, StaleBanner, StickyUnderBar, SwitchView,
  COLUMN, Photo, Scrim, StretchyHeader, TabScreen, fx, haptics, invalidate, motionValues, readKeyed, t, timing, useFx, toast, useFocusRefresh, useTabScroll, writeKeyed,
} from '@/fx';
import { Alert } from '@/lib/alert';
import { api, errorText, get, post } from '@/lib/api';
import { useFeatures } from '@/lib/features';
import { useLoad } from '@/lib/useLoad';
import { DishSheetBody } from './DishSheet';
import { FuelOff } from './FuelOff';
import { CountedInfo, PhotoView, SourceInfo } from './Info';
import { MealLogForm, type MealLogInitial } from './MealLogForm';
import { ProfileForm } from './ProfileForm';
import { SavedPanel } from './SavedPanel';
import { SearchPanel, prefetchSearch, type DishHandlers } from './SearchPanel';
import { usePageSettled } from '@/fx/nav/pageReady';
import { TodayPanel } from './TodayPanel';
import { SLOT_LABEL, dishKey, dishName } from './format';
import { forgetMealPhoto, pickMealPhoto, uploadMealPhoto } from './photo';
import type { Dish, MealLog, Nutrition, Page, PlanSlot } from './types';

type Seg = 'today' | 'search' | 'saved';
const ORDER: Seg[] = ['today', 'search', 'saved'];
const isSeg = (s: unknown): s is Seg => typeof s === 'string' && (ORDER as string[]).includes(s);

type SheetKind = 'dish' | 'log' | 'profile' | 'photo' | 'counted' | 'source';
type SheetData = { dish?: Dish; log?: MealLogInitial; photo?: MealLog; source?: Dish };

export function FuelScreen() {
  const params = useLocalSearchParams<{ segment?: string; swap?: string }>();
  const features = useFeatures(true);
  // nothing is asked of the nutrition routes until the flags say the module is on (a module that is off answers 403)
  const nutritionOn = !!features?.has('nutrition');
  const n = useLoad<Nutrition>(nutritionOn ? 'nutrition' : null, () => (nutritionOn ? get<Nutrition>('/me/nutrition') : Promise.resolve(null as unknown as Nutrition)), [nutritionOn], { shared: true });
  const off = (features ? !nutritionOn : false) || n.error?.code === 'FEATURE_DISABLED';
  const hasPlan = !!n.data?.plan;
  // the plan's recipe values, kept under their key only while there is a plan: "no plan yet" (the first render, or
  // offline before the saved nutrition is read) answers nothing at all, never an empty list, so it can neither replace
  // the last-good copy nor pass for the recipes while GET /me/recipes is still on its way once the plan is known (the
  // meal plan would say "No values entered" for dishes that have values, offline or on a slow network)
  const lib = useLoad<Page<Dish> | null>(hasPlan ? 'fuel.recipes' : null, () => (hasPlan ? get<Page<Dish>>('/me/recipes?limit=100') : Promise.resolve(null)), [hasPlan]);
  const recipesKnown = hasPlan && !!lib.data && !lib.error;
  const recipes = useMemo(() => new Map((lib.data?.items ?? []).map((r) => [r.id, r] as const)), [lib.data]);

  // the segment: a link's ?segment= first, else the one last used on this device
  const [seg, setSeg] = useState<Seg>(isSeg(params.segment) ? params.segment : 'today');
  const [dir, setDir] = useState<1 | -1>(1);
  const [swapFor, setSwapFor] = useState<PlanSlot | null>(null);
  const go = useCallback((s: Seg) => {
    setSeg((cur) => { if (cur !== s) setDir(ORDER.indexOf(s) > ORDER.indexOf(cur) ? 1 : -1); return s; });
    void writeKeyed('segment', 'fuel', s);
  }, []);
  useEffect(() => { if (isSeg(params.segment)) return; void readKeyed('segment', 'fuel').then((s) => { if (isSeg(s)) setSeg(s); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (isSeg(params.segment)) go(params.segment); }, [params.segment, go]);

  // ?swap=<planned meal id> (the meal-log route's "Pick what you ate from the dishes"): search in swap mode
  useEffect(() => {
    const s = params.swap && n.data ? n.data.todaySlots.find((x) => x.id === params.swap) : null;
    if (s) { setSwapFor(s); go('search'); }
  }, [params.swap, n.data?.today]); // eslint-disable-line react-hooks/exhaustive-deps
  const [savedOverride, setSavedOverride] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<SheetKind | null>(null);
  const [data, setData] = useState<SheetData>({});
  const [removing, setRemoving] = useState(false);
  const [seq, setSeq] = useState(0); // a new form each time a sheet opens
  const show = (k: SheetKind, d: SheetData = {}) => { setData((x) => ({ ...x, ...d })); setSeq((i) => i + 1); setOpen(k); };
  const close = () => setOpen(null);

  // the unfiltered dish list is fetched ahead once the page has settled on Today, so Search draws its cards at once
  const settled = usePageSettled();
  const searchAhead = React.useRef(false);
  useEffect(() => {
    if (!settled || !nutritionOn || off || searchAhead.current || seg === 'search') return;
    searchAhead.current = true;
    const g = globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
    if (!g.requestIdleCallback) { const timer = setTimeout(prefetchSearch, t.premount); return () => clearTimeout(timer); }
    const h = g.requestIdleCallback(prefetchSearch, { timeout: t.premount * 2 });
    return () => g.cancelIdleCallback?.(h);
  }, [settled, seg, nutritionOn, off]);

  // pull to refresh and refocus: today's nutrition, the recipe values of the plan, and the open panel's own list
  const reload = useCallback(async () => { invalidate(['fuel.saved', 'fuel.search']); await Promise.all([n.reload(), lib.reload()]); }, [n.reload, lib.reload]); // eslint-disable-line react-hooks/exhaustive-deps
  const { refreshing, onRefresh } = useFocusRefresh(reload);

  /* ---------- dishes ---------- */
  const isSaved = (d: Dish) => savedOverride[dishKey(d)] ?? d.saved;
  const toggleSave = async (d: Dish) => {
    const k = dishKey(d);
    const next = !isSaved(d);
    setSavedOverride((m) => ({ ...m, [k]: next }));
    try {
      await api('PUT', '/me/nutrition/favourites', { kind: d.kind, id: d.id, saved: next });
      toast.logged(next ? 'Added to saved dishes' : 'Removed from saved dishes', next ? 'success' : 'info');
    } catch (e) {
      setSavedOverride((m) => ({ ...m, [k]: !next }));
      toast.error(errorText(e));
    }
  };
  const handlers: DishHandlers = {
    open: (d) => show('dish', { dish: d }),
    toggleSave: (d) => { void toggleSave(d); },
    source: (d) => show('source', { source: d }),
    isSaved,
  };
  const onDishLogged = (_log: MealLog, name: string) => {
    close();
    setSwapFor(null);
    toast.logged(`${name} logged`);
    go('today');
    void n.reload();
  };

  /* ---------- today's meals ---------- */
  // As planned and Skipped log at once; a log that does not reach the server answers with the reason (the row puts its
  // segment back and says it was not saved, FU-M2), with the app's error toast
  const quick = async (slot: PlanSlot, outcome: 'as_planned' | 'swapped' | 'skipped'): Promise<string | null> => {
    if (!n.data) return null;
    if (outcome === 'swapped') { show('log', { log: { slotId: slot.id, outcome: 'swapped' } }); return null; }
    setBusy(slot.id);
    try {
      await post('/me/meal-logs', { date: n.data.today, slotId: slot.id, outcome });
    } catch (e) {
      const text = errorText(e);
      toast.error(text);
      setBusy(null);
      return text;
    }
    if (outcome === 'as_planned') haptics.success(); else haptics.light();
    toast.logged(`${SLOT_LABEL[slot.slot] ?? 'Meal'} logged: ${outcome === 'as_planned' ? 'as planned' : 'skipped'}`, outcome === 'as_planned' ? 'success' : 'info');
    try { await n.reload(); } finally { setBusy(null); }
    return null;
  };
  // a destructive confirm: the warning haptic as it opens, a light one once it is done
  const remove = (log: MealLog, title: string) => {
    haptics.warning();
    Alert.alert('Delete this meal?', `“${title}” is taken off today’s log${log.hasPhoto ? ', with its photo' : ''}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { void (async () => {
        setBusy(log.id);
        try { await api('DELETE', `/me/meal-logs/${log.id}`); haptics.light(); toast.logged('Meal removed', 'info'); await n.reload(); }
        catch (e) { toast.error(errorText(e)); } finally { setBusy(null); }
      })(); } },
    ]);
  };
  const addPhoto = async (log: MealLog) => {
    try {
      const p = await pickMealPhoto();
      if (!p) return;
      setBusy(log.id);
      await uploadMealPhoto(log.id, p);
      haptics.success();
      toast.logged('Photo added');
      await n.reload();
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(null); }
  };
  const removePhoto = (log: MealLog) => {
    haptics.warning();
    Alert.alert('Remove this photo?', 'It is deleted from Bioptime. The meal stays logged.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => { void (async () => {
        setRemoving(true);
        try { await api('DELETE', `/me/meal-logs/${log.id}/photo`); forgetMealPhoto(log.photoFileId); haptics.light(); close(); toast.logged('Photo removed', 'info'); await n.reload(); }
        catch (e) { toast.error(errorText(e)); } finally { setRemoving(false); }
      })(); } },
    ]);
  };
  const actions = {
    quick: (s: PlanSlot, o: 'as_planned' | 'swapped' | 'skipped') => quick(s, o),
    remove,
    openPhoto: (l: MealLog) => show('photo', { photo: l }),
    addPhoto: (l: MealLog) => { void addPhoto(l); },
    browse: () => go('search'),
    add: () => show('log', { log: {} }),
  };
  const pickDish = (slot: PlanSlot) => { close(); setSwapFor(slot); go('search'); };

  /* ---------- page ---------- */
  const d = n.data;
  const header = <ScreenHeader
    title="Nutrition"
    subtitle="Your coach’s plan and what you ate"
    right={d && !off ? <IconButton icon="sliders-horizontal" label="Food preferences" onPress={() => show('profile')} /> : null}
  />;

  let body: React.ReactNode;
  if (off) body = <FuelOff today={d?.today ?? new Date().toISOString().slice(0, 10)} />;
  else if (n.error && !d) body = <ErrorState error={n.error} onRetry={n.reload} />;
  else if (!d) body = <TodaySkeleton />;
  else body = <>
    <StaleBanner at={n.stale} />
    <Body>
      <SwitchView id={seg} direction={dir}>
        {seg === 'today' ? <TodayPanel n={d} recipes={recipes} recipesKnown={recipesKnown} busy={busy} actions={actions} onExplain={() => show('counted')} />
          : seg === 'search' ? <SearchPanel handlers={handlers} onCustom={() => show('log', { log: swapFor ? { slotId: swapFor.id, outcome: 'swapped' } : {} })} swapFor={swapFor} onCancelSwap={() => setSwapFor(null)} />
            : <SavedPanel handlers={handlers} onBrowse={() => go('search')} />}
      </SwitchView>
    </Body>
  </>;

  return <TabScreen refreshing={refreshing} onRefresh={onRefresh} sticky={<Bar />} bleedTop={<HeaderBand search={seg === 'search'} />} testID="fuel">
    {header}
    <Sticky>
      {off ? null : <Segmented<Seg> value={seg} onChange={go} items={[{ value: 'today', label: 'Today' }, { value: 'search', label: 'Search' }, { value: 'saved', label: 'Saved' }]} />}
    </Sticky>
    <View style={styles.content}>{body}</View>

    {d ? <>
      <Sheet visible={open === 'dish'} onClose={close}>
        {data.dish ? <Column><DishSheetBody key={`${dishKey(data.dish)}-${seq}`} dish={data.dish} today={d.today} mode={{ swapFor }} saved={isSaved(data.dish)} onToggleSave={() => { void toggleSave(data.dish!); }} onLogged={onDishLogged} /></Column> : null}
      </Sheet>
      <Sheet visible={open === 'log'} onClose={close}>
        {open === 'log' || data.log ? <Column><MealLogForm key={seq} n={d} initial={data.log} onPickDish={pickDish}
          onSaved={(_l, label) => { close(); setSwapFor(null); toast.logged(`${label} logged`); go('today'); void n.reload(); }} /></Column> : null}
      </Sheet>
      <Sheet visible={open === 'profile'} onClose={close} title="Food preferences">
        <Column><ProfileForm key={`${d.profile?.updatedAt ?? 'none'}-${seq}`} profile={d.profile} onSaved={() => { close(); toast.success('Food preferences saved'); void n.reload(); }} /></Column>
      </Sheet>
      <Sheet visible={open === 'photo'} onClose={close} title="Your meal photo">
        {data.photo ? <Column><PhotoView key={data.photo.id} log={data.photo} removing={removing} onRemove={() => removePhoto(data.photo!)} /></Column> : null}
      </Sheet>
      <Sheet visible={open === 'counted'} onClose={close} title="How today is counted">
        <Column><CountedInfo totals={d.todayTotals} /></Column>
      </Sheet>
      <Sheet visible={open === 'source'} onClose={close} title="Where the values come from">
        {data.source ? <Column><SourceInfo name={dishName(data.source)} sources={data.source.sources} /></Column> : null}
      </Sheet>
    </> : null}
  </TabScreen>;
}

/** The Fuel header photo band (PREMIUM §2.4: .22 under the band scrim), full width on every screen and moving with the
 *  page's scroll (parallax 0.4×, stretch on pull): home cooking on Today and Saved, the plate while searching (a
 *  450 ms crossfade). Hands only and a still life: nothing here shows a person beside the member's own numbers. */
function HeaderBand({ search }: { search: boolean }) {
  const y = useTabScroll();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { calm } = useFx();
  const p = useSharedValue(search ? 1 : 0);
  useEffect(() => { p.value = calm ? (search ? 1 : 0) : withTiming(search ? 1 : 0, timing(450)); }, [search, calm, p]);
  // the plate photo is drawn once Search has been opened (not on the page's first render)
  const [plateOn, setPlateOn] = useState(search);
  useEffect(() => { if (search) setPlateOn(true); }, [search]);
  const home = useAnimatedStyle(() => ({ opacity: 1 - p.value }));
  const plate = useAnimatedStyle(() => ({ opacity: p.value }));
  if (!y) return null;
  return <StretchyHeader scrollY={y} height={insets.top + (width >= 768 ? 240 : 200)} base={0.22}
    photo={<>
      <Animated.View style={[StyleSheet.absoluteFill, home]}><Photo slot="fuel.header" style={StyleSheet.absoluteFill} decorative /></Animated.View>
      {plateOn ? <Animated.View style={[StyleSheet.absoluteFill, plate]}><Photo slot="fuel.search.header" style={StyleSheet.absoluteFill} decorative /></Animated.View> : null}
    </>}>
    <Scrim kind="headerBand" style={StyleSheet.absoluteFill} />
  </StretchyHeader>;
}

/** Sheet content in the content column on wide screens (the panel itself spans the screen). */
function Column({ children }: { children: React.ReactNode }) {
  return <View style={styles.sheetColumn}>{children}</View>;
}

/** The reveals inside the page follow its scroll. */
function Body({ children }: { children: React.ReactNode }) {
  const y = useTabScroll();
  return y ? <RevealScope scrollY={y}>{children}</RevealScope> : <>{children}</>;
}

/** The compact bar that replaces the big title as the page scrolls. It is mounted only once the page has scrolled to
 *  where it starts to show: its background layer takes touches even while transparent, and would otherwise sit over
 *  the header's settings button. */
function Bar() {
  const y = useTabScroll();
  const [shown, setShown] = useState(false);
  useAnimatedReaction(() => (y ? y.get() > motionValues.header.barFrom - 4 : false), (v, prev) => { if (v !== prev) runOnJS(setShown)(v); }, [y]);
  return y && shown ? <CompactBar scrollY={y} title="Nutrition" /> : null;
}

/** The segment row, pinned under the compact bar while the page scrolls. */
function Sticky({ children }: { children: React.ReactNode }) {
  const y = useTabScroll();
  if (!children) return null;
  const row = <View style={styles.segment}>{children}</View>;
  return y ? <StickyUnderBar scrollY={y}>{row}</StickyUnderBar> : row;
}

function TodaySkeleton() {
  return <View style={styles.skeleton} accessibilityLabel="Loading your nutrition">
    <View style={styles.skelCard}>
      <SkeletonRing size={180} stroke={14} />
      <View style={styles.skelBars}>{[0, 1, 2].map((i) => <View key={i} style={styles.skelBar}><Skeleton height={14} width="45%" /><Skeleton height={6} radius={3} /></View>)}</View>
    </View>
    <Skeleton height={220} radius={24} />
    <Skeleton height={96} radius={12} />
  </View>;
}

const styles = StyleSheet.create({
  segment: { paddingHorizontal: 24, paddingVertical: 8 },
  sheetColumn: { width: '100%', maxWidth: COLUMN - 48, alignSelf: 'center' },
  content: { paddingHorizontal: 20, paddingTop: 12, gap: 16 },
  skeleton: { gap: 20 },
  skelCard: { borderRadius: 24, borderWidth: 1, borderColor: fx.line.a05, backgroundColor: fx.bg.panelSolid, padding: 24, alignItems: 'center', gap: 24 },
  skelBars: { alignSelf: 'stretch', gap: 16 },
  skelBar: { gap: 8 },
});
