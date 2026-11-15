/* The thread with the coach in the earlier app's AI-chat look (THEME §11.15): day separators ("Today", "Wed 21 Oct");
   the coach's messages as glass bubbles (radius 16, top-left 4) beside the 28 pt monogram medallion; the member's as
   red/10 bubbles with a red/20 border (top-right 4) beside a neutral 28 pt avatar; the time under each, "Read" under the
   member's once the coach has read it; files as chips under their message (they open through a 5-minute link while
   the 'messaging' module is on); a "New" rule above the first message the member had not read when the screen opened.
   Motion (v2, M77/M82):
   - A message that arrives while the thread is open mounts already playing (the screen works out what is new during
     its render): y 8 → 0, scale .97 → 1, opacity 0 → 1 on the list spring, once the page can be seen.
   - The member's own message rises 44 pt from the composer (280 ms expo), after the screen has pinned the thread to
     its end (`pinned` counts those pins; a short fallback starts it if no pin comes).
   - When the server's copy arrives it takes over the bubble on its way in place (its rise carries on): "Sending"
     crossfades to the time (200 ms, the two lines are the same height) and the bubble comes to full strength; a moment
     later it joins the list at rest. The day separator of a message on its way is drawn with its bubble (one keyed
     list), so a send moves the thread once: nothing is inserted above the bubble when it lands.
   - Tier C: opacity only (160 ms). Reduced motion and the pre-rendered HTML: at rest. History never replays.
   While a message is on its way its bubble shows the typing dots and "Sending"; if it fails it says so, and a tap puts
   it back in the composer. Each bubble is announced with who wrote it and when. */
import React, { useEffect, useLayoutEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { FONTS, Icon, Medallion, T, TitledDivider, TypingDots, ease, fx, spring, timing, useFx } from '@/fx';
import { usePageActive } from '@/fx/nav/pageReady';
import { calmFade, motionValues } from '@/fx/motion/tokens';
import { fileLine, type Attachment } from './files';
import { dayLabel, istDay, istTime, whenSpoken } from './time';

const S = motionValues.screens.m77;
const S82 = motionValues.screens.m82;

export type Message = { id: string; mine: boolean; body: string; createdAt: string; readAt: string | null; attachments: Attachment[] };
export type Outgoing = { id: string; body: string; attachments: Attachment[]; createdAt: string; state: 'sending' | 'failed'; error?: string };

/** A message on its way (with the server's copy once it has come back). */
export type OutRow = Outgoing & { m?: Message };

type Row =
  | { kind: 'day'; key: string; label: string; fresh?: boolean }
  | { kind: 'new'; key: string }
  | { kind: 'msg'; key: string; m: Message; avatar: boolean }
  | { kind: 'out'; key: string; o: OutRow; avatar: boolean };

/** Day separators, the "New" rule and which bubbles carry an avatar (the last of a run from one sender). Messages on
 *  their way (`outbox`) are laid out in the same pass, after the list: the first message of a new day gets its day
 *  separator in the same render as its bubble, and when it joins the list the separator (same key) stays where it is,
 *  so the thread moves once on a send, not again when the server's copy lands. */
export function threadRows(items: Message[], firstUnread: string | null, outbox: OutRow[] = []): Row[] {
  type Entry = { id: string; mine: boolean; createdAt: string; m?: Message; o?: OutRow };
  const all: Entry[] = [
    ...items.map((m) => ({ id: m.id, mine: m.mine, createdAt: m.createdAt, m })),
    ...outbox.map((o) => ({ id: o.id, mine: true, createdAt: o.m?.createdAt ?? o.createdAt, o })),
  ];
  const rows: Row[] = [];
  let day = '';
  all.forEach((e, i) => {
    const d = istDay(e.createdAt);
    const opensDay = d !== day;
    if (opensDay) { day = d; rows.push({ kind: 'day', key: `day-${d}`, label: dayLabel(d), fresh: e.id === firstUnread }); }
    else if (e.id === firstUnread) rows.push({ kind: 'new', key: 'new' });
    const next = all[i + 1];
    const avatar = !next || next.mine !== e.mine || istDay(next.createdAt) !== d || next.id === firstUnread;
    if (e.o) rows.push({ kind: 'out', key: e.o.id, o: e.o, avatar });
    else if (e.m) rows.push({ kind: 'msg', key: e.id, m: e.m, avatar });
  });
  return rows;
}

export function Thread({ rows, coachName, fresh, pinned, filesOn, onOpenFile, onRetry }: {
  rows: Row[]; coachName: string; fresh: ReadonlySet<string>; pinned?: SharedValue<number>; filesOn: boolean;
  onOpenFile: (a: Attachment) => void; onRetry: (o: Outgoing) => void;
}) {
  // one keyed list (separators, messages and the ones on their way), so a separator never remounts when the message
  // under it moves from the outbox into the list
  return <View accessibilityRole="list" style={styles.list}>
    {rows.map((r) => r.kind === 'day' ? (r.fresh ? <NewRule key={r.key} text={`${r.label} · New`} /> : <TitledDivider key={r.key} text={r.label} strong style={styles.day} />)
      : r.kind === 'new' ? <NewRule key={r.key} text="New" />
        : r.kind === 'out' ? <PendingBubble key={r.key} o={r.o} m={r.o.m} avatar={r.avatar} coachName={coachName} filesOn={filesOn} onOpenFile={onOpenFile} pinned={pinned} onRetry={() => onRetry(r.o)} />
          : <Bubble key={r.key} m={r.m} coachName={coachName} avatar={r.avatar} enter={fresh.has(r.m.id) ? (r.m.mine ? 'composer' : 'item') : null} pinned={pinned} filesOn={filesOn} onOpenFile={onOpenFile} />)}
  </View>;
}

function NewRule({ text }: { text: string }) {
  return <View style={styles.newRow} accessibilityRole="text" accessibilityLabel={`${text}: messages you have not read`}>
    <View style={styles.newLine} />
    <T v="micro" color={fx.red.label} style={styles.newText}>{text}</T>
    <View style={styles.newLine} />
  </View>;
}

type EnterFrom = 'item' | 'composer' | null;

/** The entrance of a bubble that just arrived: from the list (spring) or from the composer (its own message, after the
 *  screen has pinned the thread to its end). History draws a plain view (no animated hooks per old message). */
function Enter({ from, pinned, children }: { from: EnterFrom; pinned?: SharedValue<number>; children: React.ReactNode }) {
  const { calm, inHtml } = useFx();
  if ((from !== 'item' && from !== 'composer') || calm || inHtml) return <View>{children}</View>;
  return <Entering from={from} pinned={pinned}>{children}</Entering>;
}

/** It holds at its start while the page cannot be seen, and starts on the UI thread. */
function Entering({ from, pinned, children }: { from: 'item' | 'composer'; pinned?: SharedValue<number>; children: React.ReactNode }) {
  const { tier } = useFx();
  const lift = from === 'composer';
  const tierC = tier === 'C';
  const active = usePageActive();
  const p = useSharedValue(0);
  const done = useSharedValue(0);
  const armed = useSharedValue(0);
  const base = useSharedValue(-1); // the pin count at mount (the rise waits for the next pin)
  const released = useSharedValue(0); // the fallback: no pin came
  useLayoutEffect(() => {
    if (!lift) return;
    base.value = pinned ? pinned.value : 0;
    const timer = setTimeout(() => { released.value = 1; }, motionValues.overlay.fallbackExtra);
    return () => clearTimeout(timer);
    // decided once, at mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useAnimatedReaction(() => {
    if (armed.get() === 1 || active.get() !== 1) return 0;
    if (!lift) return 1;
    return released.get() === 1 || (!!pinned && base.get() >= 0 && pinned.get() > base.get()) ? 1 : 0;
  }, (go) => {
    if (go !== 1 || armed.get() === 1) return;
    armed.set(1);
    const end = (f?: boolean) => { 'worklet'; if (f) done.set(1); };
    if (tierC) p.set(withTiming(1, timing(S.cMs, ease.css), end));
    else if (lift) p.set(withTiming(1, timing(S.pendingMs, ease.expo), end));
    else p.set(withSpring(1, spring.item, end));
  });
  const a = useAnimatedStyle(() => {
    if (done.get() === 1) return { opacity: 1, transform: [] };
    const v = p.get();
    const o = Math.max(0, Math.min(1, lift ? v * 1.5 : v));
    if (tierC) return { opacity: o, transform: [] };
    return lift
      ? { opacity: o, transform: [{ translateY: S.pendingY * (1 - v) }] }
      : { opacity: o, transform: [{ translateY: S.bubbleY * (1 - v) }, { scale: S.bubbleScale + (1 - S.bubbleScale) * v }] };
  });
  return <Animated.View style={a}>{children}</Animated.View>;
}

/** The server's copy taking over from the bubble on its way: "Sending" crossfades to the time and the bubble comes to
 *  full strength (M82, 200 ms), from the moment `on` turns true. */
function useLanded(on: boolean) {
  const { calm, inHtml } = useFx();
  const v = useSharedValue(inHtml ? 1 : 0);
  useEffect(() => {
    if (!on || inHtml) return;
    v.value = withTiming(1, calm ? calmFade() : timing(S82.sendingSwapMs, ease.css));
  }, [on, inHtml, calm, v]);
  const bubble = useAnimatedStyle(() => ({ opacity: PENDING_OPACITY + (1 - PENDING_OPACITY) * v.get() }));
  const meta = useAnimatedStyle(() => ({ opacity: v.get() }));
  const ghost = useAnimatedStyle(() => ({ opacity: 1 - v.get() }));
  return { bubble, meta, ghost };
}

function MemberAvatar() {
  return <View style={styles.me} accessible={false} importantForAccessibility="no-hide-descendants"><Icon name="user" size={14} color={fx.ink.a70} /></View>;
}

function Bubble({ m, coachName, avatar, enter, pinned, filesOn, onOpenFile }: { m: Message; coachName: string; avatar: boolean; enter: EnterFrom; pinned?: SharedValue<number>; filesOn: boolean; onOpenFile: (a: Attachment) => void }) {
  return <Enter from={enter} pinned={pinned}>
    <View accessibilityRole={'listitem' as never} style={[styles.line, m.mine ? styles.lineMine : null]}>
      {!m.mine ? <View style={styles.avatarSlot}>{avatar ? <Medallion name={coachName} size={28} /> : null}</View> : null}
      <Column m={m} coachName={coachName} filesOn={filesOn} onOpenFile={onOpenFile} />
      {m.mine ? <View style={styles.avatarSlot}>{avatar ? <MemberAvatar /> : null}</View> : null}
    </View>
  </Enter>;
}

type ColumnProps = { m: Message; coachName: string; filesOn: boolean; onOpenFile: (a: Attachment) => void };

function Column({ m, coachName, filesOn, onOpenFile, swap }: ColumnProps & { swap?: ReturnType<typeof useLanded> }) {
  const who = m.mine ? 'You' : coachName;
  const said = m.body ? `: ${m.body}` : m.attachments.length ? `: ${m.attachments.length === 1 ? 'a file' : `${m.attachments.length} files`}` : '';
  const meta = <T v="caption" color={fx.ink.a60} style={[styles.meta, m.mine ? styles.metaMine : null]} importantForAccessibility="no" accessibilityElementsHidden>
    {`${istTime(m.createdAt)}${m.mine && m.readAt ? ' · Read' : ''}`}
  </T>;
  return <View style={[styles.col, m.mine ? styles.colMine : null]}>
    {m.body ? <Animated.View accessible accessibilityLabel={m.mine && m.readAt ? `${closed(`${who}, ${whenSpoken(m.createdAt)}${said}`)} Read` : `${who}, ${whenSpoken(m.createdAt)}${said}`} style={[styles.bubble, m.mine ? styles.bubbleMine : styles.bubbleCoach, swap ? swap.bubble : null]}>
      <T style={styles.text} color={m.mine ? fx.ink.white : fx.ink.zinc200} selectable>{m.body}</T>
    </Animated.View> : null}
    {m.attachments.length ? <View style={[styles.files, m.mine ? styles.filesMine : null]}>
      {m.attachments.map((a) => <FileChip key={a.id} a={a} onPress={filesOn ? () => onOpenFile(a) : undefined} />)}
    </View> : null}
    {swap ? <View>
      <Animated.View style={swap.meta}>{meta}</Animated.View>
      <Animated.View pointerEvents="none" style={[styles.ghost, swap.ghost]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
        <T v="caption" color={fx.ink.a60}>Sending</T>
      </Animated.View>
    </View> : meta}
  </View>;
}

export function FileChip({ a, onPress, onRemove, busy }: { a: Pick<Attachment, 'id' | 'name' | 'kind' | 'bytes' | 'mime'>; onPress?: () => void; onRemove?: () => void; busy?: boolean }) {
  const inner = <>
    <Icon name={a.kind === 'pdf' || a.mime === 'application/pdf' ? 'file-text' : 'image'} size={14} color={fx.red.label} />
    <View style={styles.fileText}>
      <T v="chip" numberOfLines={1}>{a.name}</T>
      <T v="micro" color={fx.ink.a60} style={styles.fileMeta}>{busy ? 'Adding…' : fileLine(a)}</T>
    </View>
  </>;
  return <View style={styles.file}>
    {onPress ? <Pressable accessibilityRole="button" accessibilityLabel={`Open ${a.name}, ${fileLine(a)}`} onPress={onPress} style={({ pressed }) => [styles.fileMain, pressed ? styles.pressed : null]}>{inner}</Pressable>
      : <View style={styles.fileMain} accessible accessibilityLabel={`${a.name}, ${fileLine(a)}`}>{inner}</View>}
    {onRemove ? <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${a.name}`} onPress={onRemove} hitSlop={10} style={styles.fileX}><Icon name="x" size={14} color={fx.ink.a60} /></Pressable> : null}
  </View>;
}

/** `text` closed by one mark: its own closing full stop, question or exclamation mark is kept and never doubled
 *  ("could not be reached..", "all right?."), else a full stop is added, so a sentence can follow it (FU-n1). */
const closed = (text: string): string => { const t = text.trim(); return /[.!?…]["”’)]?$/.test(t) ? t : `${t}.`; };

function PendingBubble({ o, m, avatar, coachName, filesOn, onOpenFile, pinned, onRetry }: {
  o: Outgoing; m?: Message; avatar: boolean; coachName: string; filesOn: boolean; onOpenFile: (a: Attachment) => void; pinned?: SharedValue<number>; onRetry: () => void;
}) {
  const failed = o.state === 'failed';
  const swap = useLanded(!!m);
  // laid out exactly as the list's bubble (the column beside the avatar slot), so the hand-over changes nothing
  const inner = <>
    {o.body ? <View style={[styles.bubble, styles.bubbleMine, styles.pending, failed ? styles.failed : null]}>
      <T style={styles.text} color={fx.ink.white}>{o.body}</T>
    </View> : null}
    {o.attachments.length ? <View style={[styles.files, styles.filesMine]}>{o.attachments.map((a) => <FileChip key={a.id} a={a} />)}</View> : null}
    {failed ? <View style={styles.status}><Icon name="circle-alert" size={12} color={fx.red.label} /><T v="caption" color={fx.red.label}>{`${closed(`Not sent${o.error ? `: ${o.error}` : ''}`)} Tap to edit and send again.`}</T></View>
      : <View style={styles.status} accessibilityLiveRegion="polite"><TypingDots /><T v="caption" color={fx.ink.a60}>Sending</T></View>}
  </>;
  return <Enter from="composer" pinned={pinned}>
    <View style={[styles.line, styles.lineMine]}>
      {m ? <Column m={m} coachName={coachName} filesOn={filesOn} onOpenFile={onOpenFile} swap={swap} />
        : failed ? <Pressable accessibilityRole="button" accessibilityLabel={`Not sent: ${closed(o.body)} Edit and send again`} onPress={onRetry} style={[styles.col, styles.colMine]}>{inner}</Pressable>
          : <View style={[styles.col, styles.colMine]}>{inner}</View>}
      <View style={styles.avatarSlot}>{avatar ? <MemberAvatar /> : null}</View>
    </View>
  </Enter>;
}

/** The bubble on its way is drawn at this strength (styles.pending); the server's copy comes up from it. */
const PENDING_OPACITY = 0.75;

const styles = StyleSheet.create({
  list: { gap: 6 },
  day: { marginVertical: 14 },
  newRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 14 },
  newLine: { flex: 1, height: 1, backgroundColor: fx.red.a30 },
  newText: { fontSize: 10, letterSpacing: 2 },
  line: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  lineMine: { justifyContent: 'flex-end' },
  avatarSlot: { width: 28, marginBottom: 22 },
  col: { maxWidth: '82%', alignItems: 'flex-start', flexShrink: 1 },
  colMine: { alignItems: 'flex-end' },
  bubble: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16, borderWidth: 1 },
  bubbleCoach: { borderTopLeftRadius: 4, backgroundColor: fx.bg.panelSolid, borderColor: fx.line.a08, boxShadow: fx.shadow.panel },
  bubbleMine: { borderTopRightRadius: 4, backgroundColor: fx.red.a10, borderColor: fx.red.a20 },
  pending: { opacity: PENDING_OPACITY },
  failed: { borderColor: fx.red.a50, opacity: 1 },
  text: { fontFamily: FONTS.sans400, fontSize: 14, lineHeight: 22.75 },
  meta: { marginTop: 4, marginHorizontal: 4 },
  metaMine: { textAlign: 'right' },
  ghost: { position: 'absolute', right: 4, top: 4 },
  files: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  filesMine: { justifyContent: 'flex-end' },
  file: { flexDirection: 'row', alignItems: 'center', borderRadius: fx.radius.xl, borderWidth: 1, borderColor: fx.line.a10, backgroundColor: fx.fill.a05, maxWidth: 260 },
  fileMain: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, flexShrink: 1, minHeight: 44 },
  fileText: { flexShrink: 1 },
  fileMeta: { letterSpacing: 0.4 },
  fileX: { paddingHorizontal: 10, paddingVertical: 8, minHeight: 44, justifyContent: 'center', borderLeftWidth: 1, borderLeftColor: fx.line.a05 },
  pressed: { backgroundColor: fx.fill.a05 },
  // the "Sending" line takes exactly the time line's box (meta: 4 above, one caption line), so the swap to the time
  // changes no height
  status: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, marginHorizontal: 4 },
  me: { width: 28, height: 28, borderRadius: 14, backgroundColor: fx.fill.a10, borderWidth: 1, borderColor: fx.line.a10, alignItems: 'center', justifyContent: 'center' },
});
