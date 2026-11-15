/* The Store's sections under the package cards:
   - BespokeCard: the dashed glass card for a plan scoped with the member (→ /bespoke), with the state of their newest
     request when there is one ("Proposal ready" first). The coaching photo sits on the right, faded under the banner
     scrim; no name or value shares it.
   - LearnShelf (module `learning`): the courses as a 3D shelf (cover from the API, else learn.cover.fallback), each with
     its progress in lessons; a tap opens the course overlay. The education disclaimer stays verbatim. On Android (tiers A
     and B) each tile is drawn into a texture of its own, so the shelf's 3D turn costs no per-frame clip masks.
   - ReferStrip (module `referrals`): the earlier app's social-proof strip, here an honest invitation to share the
     member's own link (→ /refer). No counts, no avatars of strangers. */
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import {
  AnimatedPressable, EmptyState, Eyebrow, fx, H, Icon, Photo, Pill, ProgressBar, RemotePhoto, Scrim, ShelfCarousel, ShelfPhoto, T, useFx, useLayout, usePress,
} from '@/fx';
import { ACCESS, courseStatus, progressText, type CourseCard, type Courses, type CustomPlan } from './data';

/* ---------- Bespoke ---------- */

/** A request's state in a few words (the same meanings as the Bespoke screen). */
const REQUEST_STATE: Record<string, string> = {
  enquiry_received: 'Request received', under_review: 'Under review', scoping: 'Being scoped', awaiting_professional_input: 'Being scoped',
  awaiting_internal_approval: 'Awaiting approval', proposal_sent: 'Proposal ready', accepted: 'Accepted', payment_pending: 'Waiting for payment',
  activated: 'Active', completed: 'Completed', declined: 'Declined', expired: 'Expired',
};

export function BespokeCard({ plans }: { plans: CustomPlan[] | null }) {
  const press = usePress('card');
  const open = (plans ?? []).find((r) => r.status === 'proposal_sent' && !(r.expires_at && new Date(r.expires_at).getTime() < Date.now()));
  const latest = open ?? (plans ?? [])[0] ?? null;
  const state = latest ? (open ? 'Proposal ready' : REQUEST_STATE[latest.status] ?? null) : null;
  const cta = open ? 'Review your proposal' : latest ? 'Open your request' : 'Ask for a proposal';
  return <AnimatedPressable
    accessibilityRole="button"
    accessibilityLabel={`Bespoke. A plan scoped with you.${state ? ` ${state}.` : ''}`}
    accessibilityHint={cta}
    onPress={() => router.push('/bespoke')}
    onPressIn={press.onPressIn}
    onPressOut={press.onPressOut}
    testID="store-bespoke"
    style={[styles.bespoke, press.pressed ? styles.bespokePressed : null, press.style]}>
    <View style={styles.bespokePhoto} pointerEvents="none">
      <Photo slot="store.bespoke" opacity={0.55} decorative style={StyleSheet.absoluteFill} />
      <Scrim kind="edgeLeft" style={StyleSheet.absoluteFill} />
    </View>
    <View style={styles.bespokeBody}>
      <View style={styles.bespokeIcon}><Icon name="sliders-horizontal" size={20} color={fx.red.brand} /></View>
      <Eyebrow kind="store" style={styles.bespokeEyebrow}>Bespoke</Eyebrow>
      <T v="card24">A plan scoped with you</T>
      <T v="bodySm" color={fx.ink.a80} style={styles.bespokeText}>Priced per proposal. Nothing is charged until you accept one and pay.</T>
      <View style={styles.bespokeRow}>
        {state ? <Pill tone={open ? 'warning' : 'info'}>{state}</Pill> : null}
        <View style={styles.bespokeCta}>
          <T v="chip" color={fx.red.vivid}>{cta}</T>
          <Icon name="chevron-right" size={14} color={fx.red.vivid} />
        </View>
      </View>
    </View>
  </AnimatedPressable>;
}

/* ---------- Learn ---------- */

const CARD_W = 220;
const CARD_H = 176;
/** A tile's padding above its pill, below its words and the least gap between them. */
const TILE_PAD_TOP = 12, TILE_PAD_BOTTOM = 14, TILE_GAP = 8;

/** Android, tiers A and B: a course tile is drawn into a texture of its own. The shelf turns its tiles in 3D, and under a
 *  perspective transform Skia rasterises the tile's rounded clip as a mask on the CPU and uploads it on every frame the
 *  page scrolls; with the texture the turned tile is one image (re-drawn only while its photo's parallax moves). */
const CACHED_TILE = Platform.OS === 'android';

export function LearnShelf({ data }: { data: Courses }) {
  const courses = [...data.enrolled, ...data.available];
  // the shelf is as tall as its tallest tile's words need (VA-7: the pill ran over the title at text 2.0 on a fixed
  // tile), never below CARD_H; on a tablet it is clipped to the column (TAB-06)
  const { isTablet } = useLayout();
  const [words, setWords] = useState<Record<string, number>>({});
  const tallest = courses.reduce((n, c) => Math.max(n, words[c.id] ?? 0), 0);
  const cardHeight = Math.max(CARD_H, Math.ceil(tallest));
  return <View testID="store-learn">
    <View style={styles.pad}>
      <H strong icon={<Icon name="graduation-cap" size={16} color={fx.red.brand} />}>Learn</H>
      <T v="bodySm" color={fx.ink.a60} style={styles.learnSub}>Courses from the Bioptime team and the ones your coach assigns you.</T>
    </View>
    {courses.length
      ? <ShelfCarousel
        data={courses}
        keyExtractor={(c) => c.id}
        cardWidth={CARD_W}
        cardHeight={cardHeight}
        style={isTablet ? styles.clip : undefined}
        accessibilityLabel="Courses"
        renderItem={(c) => <CourseTile c={c} onWords={(h) => setWords((m) => (m[c.id] === h ? m : { ...m, [c.id]: h }))} />} />
      : <View style={styles.pad}><EmptyState icon="book-open" title="No courses yet" body="Courses appear here when the Bioptime team publishes one for you or your coach assigns one." style={styles.learnEmpty} /></View>}
    <View style={styles.pad}>
      <T v="caption" color={fx.ink.a50} style={styles.disclaimer}>Courses are added by the Bioptime team. Courses are education, not medical advice; ask your doctor about anything specific to your health.</T>
    </View>
  </View>;
}

function CourseTile({ c, onWords }: { c: CourseCard; onWords: (height: number) => void }) {
  const { tier } = useFx();
  const cached = CACHED_TILE && tier !== 'C';
  const e = c.enrollment;
  const locked = !!c.locked;
  const sub = locked ? 'Access ended with your package. Your progress is kept.'
    : e ? progressText(e.progress)
      : `${c.lessons} ${c.lessons === 1 ? 'lesson' : 'lessons'}${c.minutes ? ` · about ${c.minutes} min` : ''}`;
  const tag = e ? courseStatus(e.status) : ACCESS[c.access ?? ''] ?? null;
  // the pill row and the words are laid out in turn; the tile hands the height they need up to the shelf
  const [top, setTop] = useState(0);
  const [bottom, setBottom] = useState(0);
  const need = top && bottom ? TILE_PAD_TOP + top + TILE_GAP + bottom + TILE_PAD_BOTTOM : 0;
  useEffect(() => { if (need) onWords(need); }, [need]); // eslint-disable-line react-hooks/exhaustive-deps
  const body = <>
    <ShelfPhoto>
      {c.cover?.url ? <RemotePhoto uri={c.cover.url} fallbackSlot="learn.cover.fallback" decorative style={StyleSheet.absoluteFill} />
        : <Photo slot="learn.cover.fallback" opacity={0.6} decorative style={StyleSheet.absoluteFill} />}
    </ShelfPhoto>
    <Scrim kind="cardBottom" style={StyleSheet.absoluteFill} />
    <View style={styles.tileInner} pointerEvents="none">
      <View style={styles.tileTop} onLayout={(ev) => setTop(Math.ceil(ev.nativeEvent.layout.height))}>
        {tag ? <Pill tone={e?.status === 'completed' ? 'success' : 'info'} color={e && e.status === 'active' ? fx.red.label : undefined} style={styles.tilePill}>{tag}</Pill> : <View />}
        {locked ? <Icon name="lock" size={14} color={fx.ink.a70} /> : null}
      </View>
      <View style={styles.tileBottom} onLayout={(ev) => setBottom(Math.ceil(ev.nativeEvent.layout.height))}>
        <T v="cardTitle" numberOfLines={3}>{c.title}</T>
        <T v="caption" color={fx.ink.a70} numberOfLines={3}>{sub}</T>
        {e && !locked && e.progress.pct !== null ? <ProgressBar value={e.progress.pct / 100} size="medium" glow={false} accessibilityLabel={progressText(e.progress)} style={styles.tileBar} /> : null}
      </View>
    </View>
  </>;
  if (locked) return <View collapsable={false} renderToHardwareTextureAndroid={cached} style={[styles.tile, styles.tileLocked]} accessible accessibilityLabel={`${c.title}. ${sub}`}>{body}</View>;
  return <Pressable
    collapsable={false}
    renderToHardwareTextureAndroid={cached}
    accessibilityRole="button"
    accessibilityLabel={`${c.title}. ${sub}`}
    accessibilityHint="Opens the course"
    onPress={() => router.push({ pathname: '/learn', params: { course: c.id } })}
    style={({ pressed }) => [styles.tile, pressed ? styles.tilePressed : null]}>
    {body}
  </Pressable>;
}

/* ---------- Refer a friend ---------- */

export function ReferStrip() {
  const press = usePress('card');
  return <AnimatedPressable
    accessibilityRole="button"
    accessibilityLabel="Refer a friend"
    accessibilityHint="Opens your personal link to share"
    onPress={() => router.push('/refer')}
    onPressIn={press.onPressIn}
    onPressOut={press.onPressOut}
    testID="store-refer"
    style={[styles.refer, press.pressed ? styles.referPressed : null, press.style]}>
    <View style={styles.referThumb}>
      <Photo slot="store.refer" decorative style={StyleSheet.absoluteFill} radius={16} />
      <View style={styles.referBadge}><Icon name="gift" size={12} color={fx.ink.white} /></View>
    </View>
    <View style={styles.flex}>
      <T v="cardTitle">Refer a friend</T>
      <T v="bodySm" color={fx.ink.a70}>Share your personal link. Friends who join with it appear on your list by first name.</T>
    </View>
    <Icon name="chevron-right" size={18} color={fx.ink.a60} />
  </AnimatedPressable>;
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 4 },
  pad: { paddingHorizontal: fx.space.cardX },

  bespoke: { borderRadius: fx.radius.three, borderWidth: 1, borderStyle: 'dashed', borderColor: fx.line.a20, backgroundColor: fx.bg.deep, overflow: 'hidden', minHeight: 196 },
  bespokePressed: { borderColor: fx.red.a30 },
  bespokePhoto: { position: 'absolute', top: 0, bottom: 0, right: 0, width: '60%' },
  bespokeBody: { padding: 20, paddingRight: '38%', gap: 4 },
  bespokeIcon: { width: 40, height: 40, borderRadius: fx.radius.xl, backgroundColor: fx.red.a10, borderWidth: 1, borderColor: fx.red.a20, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  bespokeEyebrow: { marginBottom: 2 },
  bespokeText: { marginTop: 4 },
  bespokeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 14 },
  bespokeCta: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 24 },

  learnSub: { marginTop: -6, marginBottom: 14 },
  learnEmpty: { paddingVertical: 8 },
  disclaimer: { marginTop: 12 },
  tile: { flex: 1, borderRadius: fx.radius.card, borderWidth: 1, borderColor: fx.line.a05, backgroundColor: fx.bg.card, overflow: 'hidden' },
  tilePressed: { borderColor: fx.red.a30 },
  tileLocked: { opacity: 0.6 },
  clip: { overflow: 'hidden' },
  tileInner: { flex: 1, justifyContent: 'space-between', gap: TILE_GAP, paddingTop: TILE_PAD_TOP, paddingBottom: TILE_PAD_BOTTOM },
  tileTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  tilePill: { backgroundColor: fx.glass.onPhotoStrong, flexShrink: 1 },
  tileBottom: { gap: 4, paddingHorizontal: 14 },
  tileBar: { marginTop: 6 },

  refer: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 20, borderRadius: fx.radius.three, borderWidth: 1, borderColor: fx.line.a05, backgroundColor: fx.bg.panelSolid },
  referPressed: { borderColor: fx.red.a30, backgroundColor: fx.fill.a05 },
  referThumb: { width: 56, height: 56 },
  referBadge: { position: 'absolute', right: -6, bottom: -6, width: 24, height: 24, borderRadius: 12, backgroundColor: fx.red.brand, borderWidth: 2, borderColor: fx.bg.panelSolid, alignItems: 'center', justifyContent: 'center' },
});
