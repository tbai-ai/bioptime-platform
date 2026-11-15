/* A check-in (overlay from Bio, Home and notifications): the questions the coach asked, answered with the earlier
   app's quiz controls, and the coach's reply. Answers tied to a measure are also logged as self-reported values. A
   check-in closes (missed) when the next one falls due.
   - 1–5 scales: five option tiles (selected red with the option glow); yes/no: two option rows; numbers: a mono field
     with − and + (steps by the measure: half hours for sleep, tenths for kilograms); text: a free field (optional).
   - "Send to my coach" in the sticky footer, enabled once every required answer is there; the server's per-question
     errors show under each question. The page scrolls on its own scroll view (the overlay's look kept) so the footer
     never covers an answer for good: its content is padded by the footer's measured height (every question can be
     scrolled above it, at any text size), and a tapped answer brings the next unanswered question above the footer
     when it is not (the platform's smooth scroll; at once under reduced motion). Typing never scrolls.
   - Sent, reviewed and missed check-ins show the answers; a reviewed one shows the coach's reply on the red rule.
   - The title keeps at least its widest word's room beside the status pill; when that does not fit (a narrow phone at
     a large text size) the pill moves under the title. */
import { useLocalSearchParams } from 'expo-router';
import React, { useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, errorText, get, post } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { invalidate, useLoad } from '@/lib/useLoad';
import { CHECKIN_STATUS, dayLabel, type Answer, type Checkin, type Question } from '@/lib/modules/progress';
import {
  AnimatedPressable, Button, COLUMN, ErrorState, Field, fx, GlassCard, haptics, IconButton, Input, KVRow, NumberInput, OptionCard, Overlay, Pill, Reveal,
  Skeleton, StaleBanner, T, toast, useMotion, usePress, useFocusRefresh,
} from '@/fx';
import { RailCard } from './parts';
import { Beside } from './wordFit';
import { fmtValue, unitText, type Summary } from './data';

const STEP: Record<string, number> = { sleep_hours: 0.5, weight_kg: 0.1, waist_cm: 0.5 };
/** The overlay's footer around its content (src/fx/Overlay): the fade above it and its own padding under it. */
const FOOTER_FADE = 32;
const FOOTER_PAD = 16;
/** Room kept between a question brought into view and the footer's fade. */
const CLEAR = 12;

export default function CheckinScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useLoad<Checkin>(`progress-checkin-${id}`, () => get(`/me/checkins/${id}`), [id]);
  const summary = useLoad<Summary>('progress', () => get('/me/progress/summary'), []);
  useFocusRefresh(c.reload);
  const [values, setValues] = useState<Record<string, Answer | ''>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const d = c.data;
  const insets = useSafeAreaInsets();
  const { still } = useMotion();
  // the page's own scroll (the overlay's look): where each question sits, the viewport and the footer's real height
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const scrollY = useRef(0);
  const viewH = useRef(0);
  const blocks = useRef<Record<string, { y: number; h: number }>>({});
  const [footerH, setFooterH] = useState(0);
  const footerAll = FOOTER_FADE + (footerH || 80) + FOOTER_PAD + insets.bottom;
  const isAnswered = (q: Question, v: Answer | '' | undefined) => v !== undefined && v !== '' && !(q.type === 'number' && Number.isNaN(Number(v)));
  /** After a tapped answer: the next unanswered question (after this one, else the first), when it is not wholly above
   *  the footer, scrolls up until it is (its top stays in view when it is taller than the room). */
  const reveal = (k: string, next: Record<string, Answer | ''>) => {
    if (!d) return;
    const qs = d.questions.filter((q) => q.type !== 'text');
    const at = qs.findIndex((q) => q.key === k);
    const target = [...qs.slice(at + 1), ...qs.slice(0, Math.max(0, at))].find((q) => !isAnswered(q, next[q.key]));
    const b = target ? blocks.current[target.key] : null;
    if (!b || viewH.current <= 0) return;
    const room = viewH.current - footerAll - CLEAR;
    const top = scrollY.current;
    if (b.y >= top && b.y + b.h <= top + room) return;
    const to = Math.max(0, Math.min(b.y - CLEAR, b.y + b.h - room));
    scroll.current?.scrollTo({ y: to, animated: !still });
  };
  const set = (k: string, v: Answer | '', tapped = false) => {
    setValues((s) => ({ ...s, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
    if (tapped) { const next = { ...values, [k]: v }; requestAnimationFrame(() => reveal(k, next)); }
  };
  const required = d ? d.questions.filter((q) => q.type !== 'text') : [];
  const answered = required.filter((q) => isAnswered(q, values[q.key])).length;
  const missing = answered < required.length;

  const submit = async () => {
    if (!d) return;
    setBusy(true); setMsg(null); setErrors({});
    const answers: Record<string, Answer | null> = {};
    for (const q of d.questions) { const v = values[q.key]; answers[q.key] = v === undefined || v === '' ? null : q.type === 'number' ? Number(v) : v; }
    try {
      await post(`/me/checkins/${d.id}/submit`, { answers });
      haptics.success(); toast.success('Sent to your coach.');
      invalidate(['progress-checkins', 'progress']);
      void c.reload();
    } catch (e) {
      haptics.error();
      if (e instanceof ApiError && Array.isArray(e.details)) setErrors(Object.fromEntries((e.details as Array<{ path?: string; message?: string }>).map((x) => [String(x.path ?? '').replace(/^answers\./, ''), x.message ?? 'Check this answer'])));
      setMsg(errorText(e));
    } finally { setBusy(false); }
  };
  const shown = (v: Answer | undefined, type: string) => (v === undefined || v === null ? 'No answer' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : type === 'scale_1_5' ? `${v} of 5` : String(v));
  const asking = d?.status === 'requested';

  return <Overlay title="Check-in" subtitle={d ? `Due ${dayLabel(d.dueDate)} · from ${d.coachName}` : undefined} kind="back" fallback="/(tabs)/bio"
    scroll={false} contentStyle={styles.frame}
    footer={asking ? <View style={styles.footer} onLayout={(e: LayoutChangeEvent) => { const h = Math.round(e.nativeEvent.layout.height); if (h > 0 && h !== footerH) setFooterH(h); }}>
      {/* the count under the button, on the footer's solid part: above it, in the fade, the questions scrolling under
          it showed through its words (SWA-12). The button sits on an opaque base of its own shape: the disabled look's
          fill is see-through, and with the button raised into the fade the answers under it showed through ('✓ Yes'
          in the button: R1-01) */}
      <View style={styles.ctaBase}><Button title="Send to my coach" icon="send" shape="flow" commit busy={busy} disabled={missing} onPress={submit} /></View>
      <T v="caption" color={fx.ink.a60} center>{missing ? `${answered} of ${required.length} answered` : 'Ready to send'}</T>
    </View> : undefined}>
    <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} scrollEventThrottle={32}
      onScroll={(e) => { scrollY.current = e.nativeEvent.contentOffset.y; }} onLayout={(e) => { viewH.current = e.nativeEvent.layout.height; }}
      contentContainerStyle={[styles.content, { paddingBottom: asking ? footerAll + 16 : 32 + insets.bottom }]}>
    <StaleBanner at={c.stale} />
    <ErrorState error={c.error} onRetry={c.reload} />
    {c.loading && !d ? <View style={styles.gap}><Skeleton height={80} radius={fx.radius.card} /><Skeleton height={160} radius={fx.radius.card} /><Skeleton height={160} radius={fx.radius.card} /></View> : null}
    {d ? <>
      {/* the status pill sits beside the title while the title fits one line beside it, else under it: never squeezing
          it into letter pairs (A1W-m4), nor breaking it at its hyphen on the web ('WEEKLY / CHECK- / IN': F1W-1) */}
      <Beside words={[{ text: d.title, v: 'card24' }]} lines={1} underGap={8}
        side={<Pill tone={CHECKIN_STATUS[d.status][1]}>{CHECKIN_STATUS[d.status][0]}</Pill>}>
        <T v="card24">{d.title}</T>
      </Beside>
      {asking ? d.questions.map((q, i) => <View key={q.key} onLayout={(e) => { const l = e.nativeEvent.layout; blocks.current[q.key] = { y: l.y, h: l.height }; }}>
        <Reveal index={i}>
          <QuestionBlock q={q} n={i + 1} of={d.questions.length} value={values[q.key]} error={errors[q.key]} onChange={(v, tapped) => set(q.key, v, tapped)}
            summary={summary.data} />
        </Reveal>
      </View>) : d.status === 'missed' ? <GlassCard><T v="body" color={fx.ink.a70}>This check-in closed when the next one fell due.</T></GlassCard>
        : <GlassCard padding={8}>{d.questions.map((q, i) => <KVRow key={q.key} label={q.label} value={shown(d.answers?.[q.key], q.type)} divider={i < d.questions.length - 1} />)}</GlassCard>}
      {msg ? <T v="bodySm" color={fx.red.error} accessibilityRole="alert">{msg}</T> : null}
      {d.status === 'reviewed' ? <RailCard>
        <T v="overline" color={fx.red.brand}>From your coach</T>
        <T v="body" style={styles.reply}>{d.response ?? 'Your coach read your check-in.'}</T>
        <T v="caption" color={fx.ink.a50}>{`${d.reviewedByName ?? d.coachName} · ${fmtDate(d.reviewedAt)}`}</T>
      </RailCard> : d.status === 'submitted' ? <T v="bodySm" color={fx.ink.a60}>Your coach reads it and may reply here.</T> : null}
    </> : null}
    </ScrollView>
  </Overlay>;
}

/** `onChange(v, tapped)`: tapped is true for a tile, a Yes/No row or − / + (the page may then bring the next question
 *  into view), false while typing. */
function QuestionBlock({ q, n, of, value, error, onChange, summary }: { q: Question; n: number; of: number; value: Answer | '' | undefined; error?: string; onChange: (v: Answer | '', tapped?: boolean) => void; summary: Summary | null }) {
  const metric = q.metric ? summary?.metrics.find((m) => m.metric === q.metric) ?? null : null;
  return <GlassCard style={styles.question}>
    <T v="eyebrowBrand">{`Question ${n} of ${of}`}</T>
    <T v="cardTitle">{q.label}</T>
    {q.type === 'scale_1_5' ? <Scale value={typeof value === 'number' ? value : null} onChange={(v) => onChange(v, true)} label={q.label} />
      : q.type === 'yes_no' ? <View style={styles.gapSm}>
        <OptionCard title="Yes" icon="check" selected={value === true} onPress={() => { haptics.light(); onChange(true, true); }} />
        <OptionCard title="No" icon="x" selected={value === false} onPress={() => { haptics.light(); onChange(false, true); }} />
      </View>
      : q.type === 'number' ? <NumberStep value={value === undefined ? '' : String(value)} unit={metric ? unitText(metric.unit) : ''} step={STEP[q.metric ?? ''] ?? 1}
        start={metric?.latest?.value ?? metric?.min ?? 0} min={metric?.min ?? null} max={metric?.max ?? null} label={q.label} onChange={onChange} />
      : <Field label="Your answer" title="Your answer (optional)"><Input size="sheet" value={String(value ?? '')} onChangeText={(t) => onChange(t)} multiline maxLength={2000} style={styles.text} placeholder="Optional" /></Field>}
    {error ? <T v="caption" color={fx.red.label} accessibilityRole="alert">{error}</T>
      : q.metric ? <T v="caption" color={fx.ink.a50}>{`Also logged as a self-reported value${metric?.latest ? ` (last: ${`${fmtValue(metric.latest.value)} ${unitText(metric.unit)}`.replace(/ /g, '\u00a0')})` : ''}.`}</T> : null}
  </GlassCard>;
}

/** Five option tiles for a 1–5 answer, "Low" and "High" at the ends. */
function Scale({ value, onChange, label }: { value: number | null; onChange: (v: number) => void; label: string }) {
  return <View>
    <View style={styles.scale} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {[1, 2, 3, 4, 5].map((k) => <ScaleTile key={k} k={k} selected={value === k} onPress={() => { haptics.light(); onChange(k); }} />)}
    </View>
    <View style={styles.scaleEnds}><T v="caption" color={fx.ink.a50}>Low</T><T v="caption" color={fx.ink.a50}>High</T></View>
  </View>;
}

function ScaleTile({ k, selected, onPress }: { k: number; selected: boolean; onPress: () => void }) {
  const press = usePress('tile');
  return <AnimatedPressable accessibilityRole="radio" accessibilityLabel={`${k} of 5`} accessibilityState={{ checked: selected }} aria-checked={selected}
    onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut}
    style={[styles.tile, selected ? styles.tileOn : null, press.style]}>
    <T v="card24" color={selected ? fx.ink.white : fx.ink.a70}>{String(k)}</T>
  </AnimatedPressable>;
}

/** A number with − and +: the first press starts from the last logged value of the measure. */
function NumberStep({ value, unit, step, start, min, max, label, onChange }: { value: string; unit: string; step: number; start: number; min: number | null; max: number | null; label: string; onChange: (v: string, tapped?: boolean) => void }) {
  const clamp = (x: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, x));
  const round = (x: number) => Math.round(x * 100) / 100;
  const bump = (dir: 1 | -1) => {
    haptics.select();
    const base = value.trim() === '' || Number.isNaN(Number(value)) ? start : Number(value) + dir * step;
    onChange(String(round(clamp(base))), true);
  };
  return <View style={styles.number}>
    <IconButton icon="minus" label={`Less (${label})`} kind="glass" size={44} iconSize={18} onPress={() => bump(-1)} />
    <View style={styles.flex}><NumberInput unit={unit.toUpperCase()} value={value} onChangeText={(t) => onChange(t)} label={label} placeholder={fmtValue(start)} /></View>
    <IconButton icon="plus" label={`More (${label})`} kind="glass" size={44} iconSize={18} onPress={() => bump(1)} />
  </View>;
}

const styles = StyleSheet.create({
  // the overlay's body becomes a plain frame; the scroll's content takes its look (src/fx/Overlay styles.body)
  frame: { flex: 1, width: '100%', maxWidth: '100%', paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0, gap: 0 },
  content: { width: '100%', maxWidth: COLUMN, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 20, gap: 16 },
  gap: { gap: 16 },
  gapSm: { gap: 10 },
  flex: { flex: 1, minWidth: 0 },
  question: { gap: 14 },
  scale: { flexDirection: 'row', gap: 8 },
  scaleEnds: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  tile: { flex: 1, height: 56, borderRadius: fx.radius.card, borderWidth: 1, borderColor: fx.line.a10, backgroundColor: fx.fill.a04, alignItems: 'center', justifyContent: 'center' },
  tileOn: { borderColor: fx.red.brand, backgroundColor: fx.red.a10, boxShadow: fx.shadow.option },
  number: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  text: { minHeight: 88, textAlignVertical: 'top' },
  reply: { fontSize: 16, lineHeight: 26 },
  footer: { gap: 8 },
  ctaBase: { borderRadius: fx.radius.card, backgroundColor: fx.bg.base },
});
