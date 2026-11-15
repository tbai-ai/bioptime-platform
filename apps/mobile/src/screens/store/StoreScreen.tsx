/* The Store tab (slot 8, "Programmes"; the earlier app's StoreTab, shots 80-store-programs*, 81, 82, 83, r360-12/13,
   r820-12/13; BUILD §6.9; PREMIUM §1.10 "Store"):
   1. The header: the BIOPTIME eyebrow, "Programmes" and its line, entering from 20 pt to the left; the compact bar takes
      over as the page scrolls.
   2. The marquee of the real names of the packages on sale (decorative: the cards carry the names for screen readers).
   3. The package cards in display order (programme-kind items stay hidden, owner question Q3), springing in 120 ms
      apart and receding as they pass under the compact bar (StackRecede, no overlap). Buy opens the checkout overlay
      (/packages?package=<slug>); View details opens the tall package sheet; the member's own package shows ENROLLED
      and "Enrolled · Open my plan" (Train › Plan).
   4. Bespoke (the dashed card, → /bespoke) with the state of the newest request.
   5. Learn (module `learning`): the course shelf; ?section=learn puts it first (old /learn links land here).
   6. Refer a friend (module `referrals`), in place of the earlier app's invented social proof.
   Data: GET /packages, GET /me (shared with the tabs layout), GET /me/custom-plans, GET /me/courses. Refreshes on focus,
   on return to the app and on pull; a purchase made in the checkout reloads 'me' and 'packages' through invalidate.
   Motion (v2, M80/M83): the first two cards rise 32 pt with their opacity on the stagger spring, 120 ms apart, once
   the page has come to rest (so the rise is seen, not spent during the tab slide), once per launch. What is below the
   fold (the later cards, Bespoke, Learn unless it was asked for first, Refer) mounts after the page has settled
   (Deferred). View details flies the card's photo into the sheet's hero (openSheetWithMorph) and back on close.
   First visit (T4-03): the loading cards stay until the first package card starts to arrive and then fade out over the
   same 200 ms as it fades in (SkeletonHandoff reads that card's Reveal), so the page is never empty between the
   skeleton and the cards while the pager settles. A package the member holds is ENROLLED whether it is GET /me's
   current programme or another one still running (GET /me lists every package held under `programmes`).
   Scroll cost (wave-2 fix r1, tier A): the marquee runs only while it is on screen (InViewLoops), and on Android each
   card's duotone photo is drawn once into its own texture (PackageCard), so a scroll frame re-blends nothing.
   Mounted ahead of its visit (release gate G2-5): the pager mounts the Store beside Tests and Profile before anyone
   opens it. There its loading cards are drawn still (the shimmer's dark ground, as at tier C): the hand-over cards wait
   for the first card's reveal, which waits for the page to come to rest in front, so their shimmer ran on a hidden page
   for as long as Tests or Profile stayed open (a transform per band on every frame, never drawn, the app's one shimmer
   clock held, and an accessibility content-changed event every 100 ms, so uiautomator never saw Tests idle at tier
   A). Cards that mount on a page already in front (a first visit by a tap) shimmer as before, until the page is left;
   loading cards still there start to shimmer once the page has come to rest in front. */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, withDelay, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { ApiError, get } from '@/lib/api';
import { useFeatures } from '@/lib/features';
import { useLoad } from '@/lib/useLoad';
import {
  calmFade, CompactBar, ease, EmptyState, ErrorState, fx, Marquee, Reveal, RevealScope, ScreenHeader, Sheet, SettingsRow, Skeleton, StackRecede, StaleBanner,
  T, t, TabScreen, timing, useFocusRefresh, useFx, useRevealLanding, useTabScroll, type SkeletonProps,
} from '@/fx';
import { openSheetWithMorph } from '@/fx/Sheet';
import { Deferred } from '@/fx/nav/Deferred';
import { usePageActive, usePageSettled } from '@/fx/nav/pageReady';
import { motionValues } from '@/fx/motion/tokens';
import { bespokeEntry, forSalePackages, isEnrolled, type Catalogue, type Courses, type CustomPlan, type Me, type Package } from './data';
import { morphKeyFor, PackageCard } from './PackageCard';
import { PackageSheetBody, PackageSheetFooter, PackageSheetHero } from './PackageSheet';
import { InViewLoops } from './InViewLoops';
import { BespokeCard, LearnShelf, ReferStrip } from './Sections';

const S = motionValues.screens.m80;
/** The cards that rise when the page lands (the ones in view); later ones mount after it has settled. */
const RISING = 2;

/** A module's route answers FEATURE_DISABLED while its flag is off: that is "nothing", not an error. */
function offIsNull<T>(p: Promise<T>): Promise<T | null> {
  return p.catch((e) => { if (e instanceof ApiError && e.code === 'FEATURE_DISABLED') return null; throw e; });
}

export default function StoreScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ section?: string }>();
  const features = useFeatures(true);
  const learningOn = !!features?.has('learning');
  const referralsOn = !!features?.has('referrals');
  const catalogue = useLoad<Catalogue>('packages', () => get('/packages'), []);
  const me = useLoad<Me>('me', () => get('/me'), [], { shared: true });
  const plans = useLoad<{ items: CustomPlan[] } | null>('custom-plans', () => offIsNull(get('/me/custom-plans')), []);
  const courses = useLoad<Courses | null>(learningOn ? 'learn.courses' : null, () => (learningOn ? offIsNull(get<Courses>('/me/courses')) : Promise.resolve(null)), [learningOn]);
  const reload = () => Promise.all([catalogue.reload(), me.reload(), plans.reload(), courses.reload()]);
  const { refreshing, onRefresh } = useFocusRefresh(reload);
  const [open, setOpen] = useState<string | null>(null);

  const packages = forSalePackages(catalogue.data);
  const bespoke = bespokeEntry(catalogue.data);
  const myPlans = plans.data?.items ?? null;
  // the bespoke switch is stored on the server but no route reads it yet: hide the card only when it is off and the
  // member has nothing in flight (a request or proposal is never hidden)
  const showBespoke = (!!bespoke && (!features || features.has('bespoke'))) || !!myPlans?.length;
  const learnFirst = params.section === 'learn';
  const sheetIndex = open ? packages.findIndex((p) => p.slug === open) : -1;
  const sheetPkg: Package | null = sheetIndex >= 0 ? packages[sheetIndex] : null;
  const loading = catalogue.loading && !catalogue.data;
  const enrolled = (p: Package) => isEnrolled(me.data, p);
  // the loading cards are handed over to the first package card (SkeletonHandoff) once they have been shown
  const hadSkeleton = useRef(false);
  if (loading) hadSkeleton.current = true;
  const [skeletonGone, setSkeletonGone] = useState(false);
  const lift = useSharedValue(0);
  const handoff = hadSkeleton.current && !skeletonGone && !loading && packages.length > 0;
  const skeletonStyle = useAnimatedStyle(() => ({ opacity: 1 - lift.get() }));

  const buy = (p: Package) => { setOpen(null); router.push({ pathname: '/packages', params: { package: p.slug } }); };
  const openPlan = () => { setOpen(null); router.push('/(tabs)/train?view=plan'); };
  const names = packages.filter((p) => p.version?.forSale).map((p) => p.name);

  const learn = learningOn && courses.data ? <Reveal index={0} id="store.learn" style={learnFirst ? styles.learnFirst : null}><LearnShelf data={courses.data} /></Reveal> : null;
  const details = (p: Package) => openSheetWithMorph(morphKeyFor(p), () => setOpen(p.slug));
  const card = (p: Package, i: number) => <PackageCard p={p} index={i} enrolled={enrolled(p)} onBuy={() => buy(p)} onDetails={() => details(p)} onOpenPlan={openPlan} />;

  return <TabScreen refreshing={refreshing} onRefresh={onRefresh} sticky={<StoreBar />} testID="store">
    <ScreenHeader eyebrow="Bioptime" eyebrowKind="store" title="Programmes" subtitle="Packages with a coach, blood tests and consultations" from="left" />
    <Body>
      {names.length ? <Reveal mount delay={200} from="fade" style={styles.marquee}>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
          <InViewLoops><Marquee items={fill(names)} /></InViewLoops>
        </View>
      </Reveal> : null}

      {learnFirst ? learn : null}

      {catalogue.stale || catalogue.error || me.error ? <View style={[styles.pad, styles.notes]}>
        <StaleBanner at={catalogue.stale} />
        <ErrorState error={catalogue.error} onRetry={catalogue.reload} />
        {me.error && !catalogue.error ? <ErrorState error={me.error} onRetry={me.reload} /> : null}
      </View> : null}

      {loading ? <Placeholder /> : catalogue.data ? <View>
      <View style={[styles.pad, styles.cards]}>
        {packages.length ? <>
          {packages.slice(0, RISING).map((p, i) => <StackRecede key={p.id}>
            <Reveal spring="stagger" distance={S.storeY} delay={i * S.storeStep} mount when="settled" id={`store.card.${p.id}`}>
              {card(p, i)}
              {i === 0 && handoff ? <SkeletonHandoff lift={lift} onGone={() => setSkeletonGone(true)} /> : null}
            </Reveal>
          </StackRecede>)}
          {packages.length > RISING ? <Deferred id="store.cards.later" style={styles.cards}>
            {packages.slice(RISING).map((p, j) => <StackRecede key={p.id}>
              <Reveal spring="stagger" distance={S.storeY} index={0} id={`store.card.${p.id}`}>{card(p, RISING + j)}</Reveal>
            </StackRecede>)}
          </Deferred> : null}
        </>
          : <EmptyState icon="package" title="No packages on sale right now" body="Packages appear here when Bioptime publishes them." />}
      </View>
      {handoff ? <Animated.View pointerEvents="none" style={[styles.skeletonOver, skeletonStyle]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
        <Placeholder handover />
      </Animated.View> : null}
      </View> : null}

      <Deferred id="store.below">
        <View style={styles.below}>
          {showBespoke && catalogue.data ? <Reveal index={0} id="store.bespoke" style={styles.pad}><BespokeCard plans={myPlans} /></Reveal> : null}

          {!learnFirst ? learn : null}
          {learningOn && courses.error ? <View style={styles.pad}><ErrorState error={courses.error} onRetry={courses.reload} /></View> : null}

          {referralsOn ? <Reveal index={0} id="store.refer" style={styles.pad}><ReferStrip /></Reveal> : null}
        </View>
      </Deferred>

      {catalogue.data ? <View style={[styles.pad, styles.footer]}>
        <SettingsRow icon="receipt" title="Your orders" sub="What you bought and paid" onPress={() => router.push('/(tabs)/profile?tab=orders')} />
        <T v="caption" color={fx.ink.a50} center style={styles.note}>Prices include GST. Cancellations and refunds follow the terms.</T>
      </View> : null}
    </Body>

    <Sheet visible={!!sheetPkg} onClose={() => setOpen(null)} tall
      hero={sheetPkg ? <PackageSheetHero p={sheetPkg} index={sheetIndex} enrolled={enrolled(sheetPkg)} onClose={() => setOpen(null)} /> : null}
      footer={sheetPkg ? <PackageSheetFooter p={sheetPkg} index={sheetIndex} enrolled={enrolled(sheetPkg)} onBuy={() => buy(sheetPkg)} onOpenPlan={openPlan} /> : null}>
      {sheetPkg ? <PackageSheetBody p={sheetPkg} index={sheetIndex} enrolled={enrolled(sheetPkg)} onClose={() => setOpen(null)} /> : null}
    </Sheet>
  </TabScreen>;
}

/** The marquee needs enough names to fill a wide screen: the real names, repeated in order (it is decorative). */
function fill(names: string[]): string[] {
  const out: string[] = [];
  while (out.length < 8) out.push(...names);
  return out;
}

function StoreBar() {
  const y = useTabScroll();
  return y ? <CompactBar scrollY={y} title="Programmes" /> : null;
}

/** The page's sections, revealed as they scroll in (and the scroll offset StackRecede follows). */
function Body({ children }: { children: React.ReactNode }) {
  const scrollY = useTabScroll();
  const inner = <View style={styles.body}>{children}</View>;
  return scrollY ? <RevealScope scrollY={scrollY}>{inner}</RevealScope> : inner;
}

/** Hands the loading cards over to the first package card: on the UI thread it waits for that card's Reveal to start
 *  (RevealContext.startedAt; the card waits for the pager to settle) and fades `lift` 0 → 1 over t.fast, the length of a
 *  tier-C card fade, so the skeleton leaves as the card arrives (reduced motion: calmFade; a card already at rest: at
 *  once), then tells the screen to drop the skeleton. */
function SkeletonHandoff({ lift, onGone }: { lift: SharedValue<number>; onGone: () => void }) {
  const landing = useRevealLanding();
  const { calm } = useFx();
  const cfg = calm ? calmFade() : timing(t.fast, ease.css);
  const gone = useRef(onGone);
  gone.current = onGone;
  const done = () => gone.current();
  useAnimatedReaction(() => (landing ? landing.startedAt.get() : 0), (at, prev) => {
    if (at < 0 || (prev != null && prev >= 0)) return;
    const finish = (f?: boolean) => { 'worklet'; if (f) scheduleOnRN(done); };
    if (at === 0) { lift.set(1); scheduleOnRN(done); return; } // the card is at rest: nothing to hand over
    const wait = Math.max(0, at - Date.now());
    lift.set(withDelay(wait, withTiming(1, cfg, finish)));
  });
  return null;
}

/** Whether the loading cards shimmer (G2-5, see the header): from their mount when the page is in front then; for the
 *  loading cards (not the hand-over ones, which leave as the page settles), from when the page comes to rest in front;
 *  and no longer once the page has been left (its pages have landed elsewhere). Nothing changes while the pages move. */
function useCardsShimmer(handover: boolean): boolean {
  const active = usePageActive();
  const settled = usePageSettled();
  const [moving, setMoving] = useState(() => active.get() === 1);
  useAnimatedReaction(() => active.get(), (now, was) => {
    if (was === 1 && now !== 1) scheduleOnRN(setMoving, false);
  });
  useEffect(() => { if (settled && !handover) setMoving(true); }, [settled, handover]);
  return moving;
}

/** A loading block drawn still: the Skeleton's ground, size and corners, without its band. */
function StillBlock({ width = '100%', height, radius = fx.radius.lg }: SkeletonProps) {
  return <View style={{ width, height, borderRadius: radius, backgroundColor: fx.premium.shimmer[0] }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
}

function Placeholder({ handover = false }: { handover?: boolean }) {
  const Block = useCardsShimmer(handover) ? Skeleton : StillBlock;
  return <View style={[styles.pad, styles.cards]} accessibilityLabel="Loading">
    {[0, 1].map((i) => <View key={i} style={styles.skeletonCard}>
      <Block height={176} radius={0} />
      <View style={styles.skeletonBody}>
        <Block height={24} width="45%" />
        <Block height={14} width="75%" />
        <Block height={14} width="60%" />
        <Block height={52} radius={fx.radius.card} />
      </View>
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  body: { paddingTop: 4, gap: 28 },
  below: { gap: 28 },
  pad: { paddingHorizontal: fx.space.cardX },
  marquee: { marginTop: -4 },
  learnFirst: { marginTop: 0 },
  cards: { gap: 20 },
  notes: { gap: 12 },
  footer: { gap: 16 },
  note: { paddingHorizontal: 12 },
  skeletonOver: { position: 'absolute', left: 0, right: 0, top: 0 },
  skeletonCard: { borderRadius: fx.radius.three, borderWidth: 1, borderColor: fx.line.a05, overflow: 'hidden', backgroundColor: fx.bg.panelSolid },
  skeletonBody: { padding: 20, gap: 12 },
});
