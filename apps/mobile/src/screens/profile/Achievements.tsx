/* Profile › Achievements (the earlier app's shot 75): two-column tiles, reached ones on a red tint with a 3D medal (the
   motion kit's DepthTile: it turns in with one sheen sweep and, on tier A, tilts with the phone) and a green
   "REACHED"; the rest dim at half opacity with what is left to do. They are Bioptime's milestones (GET /me/milestones),
   each from a record: a payment, an assignment, a completed consultation, a released report, tasks ticked, days
   logged. Nothing is estimated. A counted milestone not reached yet ("Ten plan tasks done": 7 done so far) carries the
   kit's thin red ProgressBar at that count over its goal (7 of 10), growing when its row lands (calm: at its value).
   Also reached from /milestones (a redirect). */
import React, { useCallback, useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { get } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { DepthTile, EmptyState, ErrorState, fx, GlassCard, H, Icon, ProgressBar, Reveal, Skeleton, StaleBanner, T, type IconName } from '@/fx';
import { FitText } from '@/fx/wordFit';
import type { Milestone } from './data';
import { Pair, shared } from './parts';
import { largeText } from '@/fx/layout';

const ICON: Record<string, IconName> = {
  onboarding: 'flag', programme: 'package', assignment: 'users', coaching_plan: 'clipboard-list', appointment: 'video',
  bloodwork_booking: 'test-tube', report: 'file-text', plan_tasks: 'list-checks', progress_entries: 'chart-line',
};

export function Achievements({ register }: { register: (fn: (() => Promise<unknown>) | null) => void }) {
  const m = useLoad<{ items: Milestone[] }>('milestones', () => get('/me/milestones'), []);
  const reload = useCallback(() => m.reload(), [m.reload]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { register(reload); return () => register(null); }, [register, reload]);
  const items = m.data?.items ?? [];
  const reached = items.filter((x) => x.achievedAt).length;
  // two medals a row; one on a narrow phone or from text 1.3, where half the row is too narrow for a title's words
  // ('First consul/tation', a two-letter word alone on a line: VA-4)
  const { width, fontScale } = useWindowDimensions();
  const per = width < 360 || largeText(fontScale) ? 1 : 2;
  const rows: Milestone[][] = [];
  for (let i = 0; i < items.length; i += per) rows.push(items.slice(i, i + per));
  return <View style={shared.gap12}>
    <StaleBanner at={m.stale} />
    <ErrorState error={m.error} onRetry={m.reload} />
    <View>
      <H strong>Milestones</H>
      <T v="bodySm" color={fx.ink.a60} style={styles.sub}>{items.length ? `From your records · ${reached} of ${items.length} reached` : 'From your records'}</T>
    </View>
    {m.loading && !m.data ? <View style={shared.gap12}>
      {[0, 1].map((r) => <View key={r} style={shared.row}><Skeleton height={168} radius={fx.radius.card} style={shared.flex} /><Skeleton height={168} radius={fx.radius.card} style={shared.flex} /></View>)}
    </View> : m.data && !items.length ? <EmptyState icon="award" title="No milestones yet" body="They appear as your records grow: your package, your coach, your first plan, report and logs." />
      : rows.map((r, i) => <Reveal key={i} index={i} id={`profile.medals.${i}`}>
        {per === 1 ? <Medal ms={r[0]} delay={i * 80} /> : <Pair>{r.map((ms, j) => <Medal key={ms.key} ms={ms} delay={(i * 2 + j) * 80} />)}</Pair>}
      </Reveal>)}
    {items.length ? <T v="caption" color={fx.ink.a50} style={styles.foot}>Each milestone comes from a record: a payment, an assignment, a completed consultation, a released report, tasks you ticked, days you logged. Nothing here is estimated.</T> : null}
  </View>;
}

/** A counted milestone's count and goal, from the record count that opens its detail ("7 done so far") and the goal
 *  its key ends with (tasks10, logs7); null for any other milestone (a single event has nothing to count). */
function countOf(ms: Milestone): { done: number; of: number } | null {
  const of = /(\d+)$/.exec(ms.key);
  const done = /^(\d+)\b/.exec(ms.detail ?? '');
  if (!of || !done) return null;
  const n = { done: Number(done[1]), of: Number(of[1]) };
  return n.of > 1 && n.done >= 0 ? n : null;
}

function Medal({ ms, delay }: { ms: Milestone; delay: number }) {
  const on = !!ms.achievedAt;
  const icon = ICON[ms.source] ?? 'award';
  const count = on ? null : countOf(ms);
  // a narrow phone gives the words more of the tile, and the title and the line under it shrink just enough for their
  // longest word to stay whole ('Matche/d with a coach', 'First consulta/tion': SWB-07)
  const narrow = useWindowDimensions().width < 360;
  return <GlassCard variant="tile" padding={narrow ? 14 : 20} borderColor={on ? fx.red.a25 : fx.line.a05} style={[styles.fill, on ? styles.on : styles.off]}>
    <View accessible accessibilityLabel={`${ms.title}. ${on ? `Reached ${fmtDate(ms.achievedAt)}.` : 'Not reached yet.'} ${ms.detail}`} style={shared.gap8}>
      <DepthTile size={48} radius={14} color={on ? fx.red.avatarEnd : fx.bg.elevated} glow={on ? fx.shadow.option : undefined} turnIn={on} sheen={on} delay={delay} locked={!on} style={styles.medal}>
        <Icon name={icon} size={20} color={on ? fx.red.error : fx.ink.a50} />
      </DepthTile>
      <FitText v="cardTitle" color={on ? fx.ink.white : fx.ink.a70} numberOfLines={3} pairs>{ms.title}</FitText>
      <FitText v="bodySm" color={on ? fx.ink.a80 : fx.ink.a55}>{ms.detail}</FitText>
      {count ? <View style={styles.count}>
        <ProgressBar value={count.done / count.of} completeGreen={false} delay={delay} accessibilityLabel={`${ms.title}: ${Math.min(count.done, count.of)} of ${count.of}`} />
        <T v="mono10" color={fx.ink.a60}>{`${Math.min(count.done, count.of)} / ${count.of}`}</T>
      </View> : null}
      {on ? <View style={styles.reached}>
        <T v="micro" color={fx.hue.green400} style={styles.reachedText}>Reached</T>
        <T v="caption" color={fx.ink.a55}>{fmtDate(ms.achievedAt)}</T>
      </View> : null}
    </View>
  </GlassCard>;
}

const styles = StyleSheet.create({
  sub: { marginTop: -8 },
  fill: { flexGrow: 1 },
  on: { backgroundColor: fx.red.a05 },
  off: {},
  medal: { marginBottom: 8 },
  reached: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 },
  reachedText: { fontSize: 11, letterSpacing: 1.5 },
  count: { gap: 6, marginTop: 4 },
  foot: { marginTop: 4, paddingHorizontal: 4 },
});
