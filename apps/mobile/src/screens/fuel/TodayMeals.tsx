/* Today's meals (the earlier app's "Today's Meals" list, 57-fuel-today-meal-logged): one row per planned meal of today,
   then every other meal logged today. A row is the earlier app's meal row (TiltCard 3, 40 pt picture, name, portion
   line, red mono calories, delete), with Bioptime's planned-meal logging under it: the red segment As planned /
   Swapped / Skipped (As planned and Skipped log at once, Swapped asks what was eaten instead). A logged row shows a
   check pop and the outcome as a word, its calories only when the meal carries entered values, a photo button (a
   meal photo opens through a five-minute link) and delete. The header keeps the earlier app's two actions: Browse (the
   dish search) and + Add (the meal sheet). Empty: the dashed card with "Browse meals" and "Log a meal".
   A row with the member's own photo shows it as its 40 pt thumbnail (through the same five-minute link as the sheet;
   the icon tile until it has loaded), and a tap opens it. Without a meal plan there is no plan outcome to name, so a
   row carries no "Extra" chip, and the header counts the day instead ("2 meals · 456 kcal counted today", from the
   values entered only).
   Tilt (wave-2 fix r1): the rows tilt on the web only (RowTilt); on native the target card above holds the device tilt
   and a row is flat, so scrolling Today costs no per-frame commits for the rows.
   Motion (v2, M78): native moves the rows to their new places (300 ms expo) when one changes height or goes; the web
   takes no layout transition (it scale-stretches the rows' text) and snaps. A removed row fades out over 160 ms before
   its gap closes. Reduced motion: no layout motion. */
import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { FadeOut, LinearTransition } from 'react-native-reanimated';
import { AnimatedPressable, Button, CheckPop, FONTS, EmptyState, GlassCard, Icon, IconButton, Photo, Pill, RemotePhoto, Scrim, Segmented, T, ease, fx, usePress, useFx, type IconName } from '@/fx';
import { RowTilt } from '@/screens/tests/RowTilt';
import { motionValues } from '@/fx/motion/tokens';

const S = motionValues.screens.m78;
/** The meal's picture beside its words (the photo tile is the same size). */
const THUMB = 40;
/** A logged row's two icon buttons (Add a photo, Delete): 28 pt discs, each reaching 44 pt (48 dp on Android) to the
 *  finger, spaced so those touch boxes stay 8 pt apart and never overlap next to the destructive Delete (UX-07). */
const ROW_ICON = 28;
const ROW_ICON_GAP = (Platform.OS === 'android' ? motionValues.touch.minAndroid : motionValues.touch.min) - ROW_ICON + 8;
import { DishThumb } from './DishThumb';
import { OUTCOME_LABEL, SLOT_LABEL, dishIcon, has, kcal, logMeta, plural, slotValues } from './format';
import { mealPhotoUrl } from './photo';
import type { Dish, MealLog, Nutrition, Outcome, PlanSlot } from './types';
import { Beside } from '@/fx/wordFit';

type Quick = 'as_planned' | 'swapped' | 'skipped';

export type MealActions = {
  /** Logs a planned meal at once (As planned, Skipped) or opens the swap (Swapped); null when it was saved (or the swap
   *  opened), else what stopped it (the server not reached), for the row to say. */
  quick: (slot: PlanSlot, outcome: Quick) => Promise<string | null>;
  remove: (log: MealLog, title: string) => void;
  openPhoto: (log: MealLog) => void;
  addPhoto: (log: MealLog) => void;
  browse: () => void;
  add: () => void;
};

export function TodayMeals({ n, recipes, busy, actions }: { n: Nutrition; recipes: Map<string, Dish>; busy: string | null; actions: MealActions }) {
  const { calm } = useFx();
  const slotIds = new Set(n.todaySlots.map((s) => s.id));
  const extras = n.todayLogs.filter((l) => !l.slotId || !slotIds.has(l.slotId));
  const photos = !!n.photos?.available;
  const layout = calm || Platform.OS === 'web' ? undefined : LinearTransition.duration(S.layoutMs).easing(ease.expo);
  const empty = !n.todaySlots.length && !extras.length;
  return <View>
    {/* Browse and Add sit beside the title while its longest word fits whole beside them, else under it (measured:
        Beside; 'Tod/ay's / mea/ls' at 320 dp and text 2.0, SWA-13) */}
    <Beside words={[{ text: 'Today’s meals', v: 'heading', style: styles.title }]} gap={8} underGap={4} under="end" style={styles.head}
      side={<View style={styles.headActions}>
        <HeadAction icon="search" label="Browse" color={fx.ink.white} onPress={actions.browse} hint="Search the dishes" />
        <View style={styles.sep} />
        <HeadAction icon="plus" label="Add" color={fx.red.vivid} onPress={actions.add} hint="Log a meal in your own words" a11y="Add a meal" />
      </View>}>
      <T v="heading" accessibilityRole="header" style={styles.title}>Today’s meals</T>
    </Beside>
    {!n.plan && !empty ? <DayCount n={n} /> : null}
    {empty ? <EmptyMeals onBrowse={actions.browse} onAdd={actions.add} /> : <View style={styles.list}>
      {n.todaySlots.map((s) => {
        const log = n.todayLogs.find((l) => l.slotId === s.id) ?? null;
        return <Animated.View key={s.id} layout={layout}>
          <MealRow slot={s} log={log} recipes={recipes} busy={busy === s.id || (!!log && busy === log.id)} photos={photos} actions={actions} />
        </Animated.View>;
      })}
      {extras.map((l) => <Animated.View key={l.id} layout={layout} exiting={calm ? undefined : FadeOut.duration(S.removeMs)}>
        <MealRow slot={null} log={l} recipes={recipes} busy={busy === l.id} photos={photos} actions={actions} planned={!!n.plan} />
      </Animated.View>)}
    </View>}
  </View>;
}

function HeadAction({ icon, label, color, onPress, hint, a11y }: { icon: IconName; label: string; color: string; onPress: () => void; hint?: string; a11y?: string }) {
  const press = usePress('chip');
  return <AnimatedPressable accessibilityRole="button" accessibilityLabel={a11y ?? label} accessibilityHint={hint} onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut} style={[styles.headAction, press.style]}>
    <Icon name={icon} size={16} color={color} />
    <T v="section" color={color}>{label}</T>
  </AnimatedPressable>;
}

function MealRow({ slot, log, recipes, busy, photos, actions, planned: withPlan = true }: { slot: PlanSlot | null; log: MealLog | null; recipes: Map<string, Dish>; busy: boolean; photos: boolean; actions: MealActions; planned?: boolean }) {
  const [picked, setPicked] = useState<Quick | ''>('');
  // a quick log that did not reach the server (FU-M2): the segment is back at rest and the row says so until the next try
  const [notSaved, setNotSaved] = useState<string | null>(null);
  const logged = !!log;
  const eaten = !!log && log.outcome !== 'skipped';
  // what the row is called: what was eaten (a swap says what instead), else the planned meal
  const title = log ? (log.outcome === 'swapped' || !slot ? (log.dish?.name ?? log.description) : (slot.title)) : slot!.title;
  const meta = log ? logMeta(log, slot) : [SLOT_LABEL[slot!.slot], slot!.timeHint || null, slot!.portionNote || null].filter(Boolean).join(' · ');
  // calories: a logged meal's own entered values; a planned meal not yet logged shows the plan's value, quieter
  const planned = !log && slot ? slotValues(slot, recipes) : null;
  const shownKcal = log ? (log.values && has(log.values.kcal) ? log.values.kcal : null) : planned && has(planned.kcal) ? planned.kcal : null;
  const icon = dishIcon({ kind: log?.dish?.kind ?? (slot?.recipe ? 'recipe' : 'food'), slot: slot?.slot ?? log?.slot });
  const image = slot?.recipe?.imageUrl ?? null;
  const thumbSeed = log?.dish?.id ?? slot?.recipe?.id ?? slot?.food?.id ?? slot?.id ?? log!.id;
  // a plan outcome only where there is a plan (without one every meal would read "Extra")
  const outcome = log && (withPlan || log.outcome !== 'extra') ? OUTCOME_LABEL[log.outcome] : null;
  const spoken = [title, meta, log ? outcome : 'not logged yet', shownKcal != null ? `${kcal(shownKcal)} kilocalories${log ? '' : ' planned'}` : log && log.outcome !== 'skipped' ? 'no values entered' : null].filter(Boolean).join(', ');
  return <RowTilt intensity={3} radius={fx.radius.xl}>
    <GlassCard padding={12} style={styles.row}>
      {/* the kilocalories and the row's buttons move under the meal (at the row's end) when its name would need more
          than three lines beside them ('Kerala / fish / curry w…' at 320 dp and text 2.0: INV-04) */}
      <Beside words={[{ text: title, v: 'section' }]} lines={3} reserve={THUMB + 12} gap={12} align="flex-start" under="end" underGap={8} side={<View style={styles.right}>
          {shownKcal != null ? <T v="mono12" color={log ? fx.red.label : fx.ink.a60}>{`${kcal(shownKcal)} kcal`}</T> : null}
          {log ? <View style={styles.icons}>
            {photos && !log.hasPhoto ? <IconButton icon="image" label={`Add a photo to ${title}`} size={ROW_ICON} iconSize={14} onPress={() => actions.addPhoto(log)} disabled={busy} /> : null}
            <IconButton icon="trash" label={`Delete ${title}`} size={ROW_ICON} iconSize={14} onPress={() => actions.remove(log, title)} disabled={busy} />
          </View> : null}
        </View>}>
        <View accessible accessibilityLabel={spoken} style={styles.topText}>
          <View>
            {log?.hasPhoto
              ? <PhotoTile onPress={() => actions.openPhoto(log)} title={title} fileId={log.photoFileId ?? null} />
              : <DishThumb seed={thumbSeed} imageUrl={image} icon={icon} size={THUMB} />}
            <CheckPop checked={eaten} size={16} burst style={styles.check} />
          </View>
          <View style={styles.text}>
            <T v="section" numberOfLines={3}>{title}</T>
            <T v="caption" color={fx.ink.a55} numberOfLines={3}>{meta}</T>
            {log && (outcome || (log.outcome !== 'skipped' && !log.values)) ? <View style={styles.status}>
              {outcome ? <Pill tone={log.outcome === 'as_planned' ? 'success' : log.outcome === 'swapped' ? 'warning' : 'info'}>{OUTCOME_LABEL[log.outcome as Outcome]}</Pill> : null}
              {log.outcome !== 'skipped' && !log.values ? <T v="caption" color={fx.ink.a60}>No values entered</T> : null}
            </View> : null}
          </View>
        </View>
      </Beside>
      {!logged && slot ? <Segmented<Quick | ''>
        kind="red"
        value={picked}
        onChange={(v) => {
          if (!v || busy) return;
          setNotSaved(null);
          if (v !== 'swapped') setPicked(v);
          void actions.quick(slot, v).then((failure) => { if (failure) { setPicked(''); setNotSaved(failure); } });
        }}
        items={[
          { value: 'as_planned', label: 'As planned', a11y: `${slot.title}: eaten as planned` },
          { value: 'swapped', label: 'Swapped', a11y: `${slot.title}: swapped for something else` },
          { value: 'skipped', label: 'Skipped', a11y: `${slot.title}: skipped` },
        ]}
        style={[styles.segment, busy ? styles.busy : null]}
      /> : null}
      {!logged && slot && notSaved ? <T v="caption" color={fx.red.label} accessibilityLiveRegion="polite">{`Not saved. ${notSaved}`}</T> : null}
    </GlassCard>
  </RowTilt>;
}

/** A logged meal's own photo: its 40 pt thumbnail, a tap opens it (the file is private: the thumbnail and the sheet
 *  use one five-minute link, see mealPhotoUrl). The icon tile shows until the picture has come, and stays when the link
 *  cannot be had (offline). */
function PhotoTile({ onPress, title, fileId }: { onPress: () => void; title: string; fileId: string | null }) {
  const press = usePress('icon');
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUri(null);
    if (fileId) mealPhotoUrl(fileId).then((u) => { if (alive) setUri(u); }, () => undefined);
    return () => { alive = false; };
  }, [fileId]);
  return <AnimatedPressable accessibilityRole="button" accessibilityLabel={`Open the photo of ${title}`} onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut} style={[styles.photoTile, press.style]}>
    <Icon name="image" size={18} color={fx.red.label} />
    {uri ? <RemotePhoto uri={uri} decorative style={StyleSheet.absoluteFill} /> : null}
  </AnimatedPressable>;
}

/** Without a meal plan: how many meals today and the calories counted from their entered values (nothing estimated). */
function DayCount({ n }: { n: Nutrition }) {
  const eaten = n.todayLogs.filter((l) => l.outcome !== 'skipped').length;
  if (!eaten) return null;
  const t = n.todayTotals;
  const counted = t && has(t.kcal) && t.meals - t.missing > 0 ? `${kcal(t.kcal)} kcal counted today` : null;
  const missing = t?.missing ? `${plural(t.missing, 'meal')} without values` : null;
  const text = [plural(eaten, 'meal'), counted ?? 'today', missing].filter(Boolean).join(' · ');
  return <T v="caption" color={fx.ink.a70} style={styles.dayCount}>{text}</T>;
}

function EmptyMeals({ onBrowse, onAdd }: { onBrowse: () => void; onAdd: () => void }) {
  return <View style={styles.emptyWrap}>
    <View pointerEvents="none" style={styles.emptyBand}>
      <Photo slot="fuel.today.empty" opacity={0.22} style={StyleSheet.absoluteFill} decorative />
      <Scrim kind="emptyBand" style={StyleSheet.absoluteFill} />
    </View>
    <EmptyState
      dashed
      icon="salad"
      title="No meals logged yet"
      body="Pick a dish to log it with its values, or write what you ate in your own words."
      action={<View style={styles.emptyActions}>
        <Button title="Browse meals" variant="redTint" onPress={onBrowse} style={styles.pill} />
        <Button title="Log a meal" variant="ghost" icon="chef-hat" onPress={onAdd} style={styles.pill} />
      </View>}
      style={styles.empty}
    />
  </View>;
}

const styles = StyleSheet.create({
  head: { marginBottom: 12 },
  title: { fontFamily: FONTS.sans400, fontSize: 17, lineHeight: 24 },
  headActions: { flexDirection: 'row', alignItems: 'center' },
  headAction: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 8 },
  sep: { width: 1, height: 16, backgroundColor: fx.line.a15 },
  list: { gap: 10 },
  row: { borderRadius: fx.radius.xl, gap: 12 },
  topText: { flex: 1, flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  text: { flex: 1, gap: 2 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  right: { alignItems: 'flex-end', gap: 6 },
  icons: { flexDirection: 'row', gap: ROW_ICON_GAP },
  check: { position: 'absolute', right: -5, bottom: -5 },
  segment: { borderColor: fx.line.a10 }, // the red pill, on a quiet track (the bright hairline stays the sign-in's)
  busy: { opacity: 0.5 },
  photoTile: { width: THUMB, height: THUMB, borderRadius: fx.radius.lg, borderWidth: 1, borderColor: fx.red.a30, backgroundColor: fx.red.a10, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  dayCount: { marginTop: -6, marginBottom: 10, paddingHorizontal: 2 },
  emptyWrap: { },
  emptyBand: { height: 112, borderTopLeftRadius: fx.radius.card, borderTopRightRadius: fx.radius.card, overflow: 'hidden' },
  empty: { marginTop: -40 },
  emptyActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginTop: 4 },
  pill: { paddingVertical: 10, paddingHorizontal: 20 },
});
