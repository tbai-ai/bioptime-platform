/* Train's "Live classes" (Bioptime's live sessions, GAP_MAP §4.5; the old /sessions screen): the group classes,
   webinars and workshops the member holds a place in or can join, on the 3D shelf carousel, each on a people-free photo
   of its kind (the host's name is on the card), with its time in IST, the host and the place (Registered, Waitlist #2,
   Full, 4 left); tap: the session. The ones joined before are under "Earlier". Shown while the sessions module is on. */
import { useRouter } from 'expo-router';
import React, { memo, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Accordion, EmptyState, GlassCard, H, Icon, NoSwipeZone, P, Photo, Pill, Scrim, SettingsRow, ShelfCarousel, ShelfPhoto, T, fx, useLayout } from '@/fx';
import { fmtDateTime } from '@/lib/format';
import { placeLabel } from '@/lib/modules/sessions';
import { Beside } from '@/fx/wordFit';

export type LiveSession = {
  id: string; kind: string; kindLabel: string; title: string; hostName: string; startAt: string; endAt: string; status: string;
  capacity: number | null; spotsLeft: number | null; full: boolean; myRegistration: { status: string; waitlistPosition: number | null } | null;
};
export type LiveList = { items: LiveSession[]; history?: LiveSession[] };

/** The photo slot kind for an API session kind (group_class → class). */
export const liveKind = (kind: string) => (kind === 'webinar' ? 'webinar' : kind === 'workshop' ? 'workshop' : 'class');

export const LiveClasses = memo(function LiveClasses({ data }: { data: LiveList }) {
  const router = useRouter();
  const items = data.items ?? [];
  const mine = items.filter((x) => x.myRegistration).length;
  // open: a place can still be taken (a full one counts as full, not open); a cancelled one counts in neither
  const others = items.filter((x) => !x.myRegistration && x.status !== 'cancelled');
  const full = others.filter((x) => x.full).length;
  const open = others.length - full;
  const counts = [mine ? `${mine} booked` : '', open || (!mine && !full) ? `${open} open` : '', full ? `${full} full` : ''].filter(Boolean).join(' · ');
  const history = data.history ?? [];
  // the shelf is as tall as its tallest card's words need (as Home's shelves: VA-7, the pills ran over the title at
  // text 2.0 on a fixed card), never below 176; on a tablet it is clipped to the column (TAB-06)
  const { isTablet } = useLayout();
  const [words, setWords] = useState<Record<string, number>>({});
  const tallest = items.reduce((n, x) => Math.max(n, words[x.id] ?? 0), 0);
  const cardHeight = Math.max(LIVE_H, Math.ceil(tallest));
  return <View style={styles.wrap}>
    <View style={styles.pad}>
      {/* the counts sit beside the title while its longest word fits whole beside them, else under it (measured:
          Beside; 'Live / clas/ses' at 320 dp and text 2.0, SWA-13) */}
      <Beside words={[{ text: 'Live classes', v: 'sectionStrong' }]} gap={8} reserve={23} style={styles.head}
        side={items.length ? <T v="caption" color={fx.ink.a50}>{counts}</T> : null}>
        <H strong icon={<Icon name="video" size={15} color={fx.red.label} />} style={styles.headTitle}>Live classes</H>
      </Beside>
    </View>
    {items.length ? <NoSwipeZone>
      <ShelfCarousel accessibilityLabel="Live classes" data={items} keyExtractor={(x) => x.id} cardWidth={232} cardHeight={cardHeight} style={isTablet ? styles.clip : undefined}
        renderItem={(x) => <LiveCard s={x} onOpen={() => router.push(`/session/${x.id}`)} onWords={(h) => setWords((m) => (m[x.id] === h ? m : { ...m, [x.id]: h }))} />} />
    </NoSwipeZone> : <View style={styles.pad}><EmptyState icon="video" title="No sessions open right now" body="New group classes, webinars and workshops appear here when they are published." /></View>}
    <View style={[styles.pad, styles.gap]}>
      {history.length ? <Accordion title={`Earlier sessions (${history.length})`} icon="clock">
        <View style={styles.gap}>{history.map((x) => { const p = placeLabel(x); return <SettingsRow key={x.id} title={x.title} sub={`${x.kindLabel} · ${fmtDateTime(x.startAt)} · ${x.hostName}`} right={<Pill tone={p.tone}>{p.text}</Pill>} onPress={() => router.push(`/session/${x.id}`)} />; })}</View>
      </Accordion> : null}
      <P muted small>When a session is full you can join its waitlist; if a place opens up, you are told.</P>
    </View>
  </View>;
});

function LiveCard({ s, onOpen, onWords }: { s: LiveSession; onOpen: () => void; onWords: (height: number) => void }) {
  const p = placeLabel(s);
  // the pills and the words are laid out in turn (the pills at the top, the words at the bottom): the card hands the
  // height they need up to the shelf, and the kind's pill takes a line of its own when it does not fit beside the place
  const [top, setTop] = useState(0);
  const [bottom, setBottom] = useState(0);
  const need = top && bottom ? CARD_PAD_TOP + top + CARD_GAP + bottom + CARD_PAD_BOTTOM : 0;
  useEffect(() => { if (need) onWords(need); }, [need]); // eslint-disable-line react-hooks/exhaustive-deps
  return <GlassCard padding={0} clip onPress={onOpen} label={`${s.title}, ${s.kindLabel}, ${fmtDateTime(s.startAt)}, ${s.hostName}, ${p.text}`} style={styles.card}>
    <ShelfPhoto style={StyleSheet.absoluteFill}>
      <Photo slot={`train.live.${liveKind(s.kind)}`} opacity={0.45} decorative style={StyleSheet.absoluteFill} />
    </ShelfPhoto>
    <Scrim kind="cardBottom" style={StyleSheet.absoluteFill} />
    <View style={styles.inner}>
      <View style={styles.top} onLayout={(e) => setTop(Math.ceil(e.nativeEvent.layout.height))}>
        <View style={styles.kind}><T v="micro" color={fx.red.label} numberOfLines={1}>{s.kindLabel}</T></View>
        <Pill tone={p.tone}>{p.text}</Pill>
      </View>
      <View style={styles.bottom} onLayout={(e) => setBottom(Math.ceil(e.nativeEvent.layout.height))}>
        <T v="sectionStrong" numberOfLines={3}>{s.title}</T>
        <T v="caption" color={fx.ink.a80} numberOfLines={2}>{fmtDateTime(s.startAt)}</T>
        <T v="caption" color={fx.ink.a60} numberOfLines={2}>{`with ${s.hostName.replace(/^The /, 'the ')}`}</T>
      </View>
    </View>
  </GlassCard>;
}

/** The shelf's card height at the usual text size, and the card's padding above its pills, below its words and the
 *  least gap between them. */
const LIVE_H = 176;
const CARD_PAD_TOP = 12, CARD_PAD_BOTTOM = 14, CARD_GAP = 8;

const styles = StyleSheet.create({
  wrap: { gap: 0 },
  pad: { paddingHorizontal: fx.space.cardX },
  head: { marginBottom: 12 },
  headTitle: { marginBottom: 0 },
  gap: { gap: 12, marginTop: 12 },
  card: { flex: 1 },
  clip: { overflow: 'hidden' },
  inner: { flex: 1, justifyContent: 'space-between', gap: CARD_GAP, paddingTop: CARD_PAD_TOP, paddingBottom: CARD_PAD_BOTTOM },
  // the kind and place pills share one line while they fit; else the place's pill takes the next
  top: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  kind: { flexShrink: 0, maxWidth: '100%', paddingHorizontal: 8, paddingVertical: 3, borderRadius: fx.radius.pill, backgroundColor: fx.glass.onPhoto, borderWidth: 1, borderColor: fx.red.a25 },
  bottom: { gap: 2, paddingHorizontal: 14 },
});
