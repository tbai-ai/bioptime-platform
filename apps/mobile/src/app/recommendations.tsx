/* Recommendations from the coach (GET /me/notes): only the notes a coach marked for the member to see, newest first,
   the same list as the portal's My program card "From your coach · Recommendations". A coach's private notes never reach
   this route. An overlay (reached from the Coach tab and its coach sheet): each note is the earlier app's "from your
   coach" card, a glass card with the red rail, the kind (note, review, consultation), the text, and who wrote it when.
   The notes rise in one after another (at rest with reduced motion). */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { get } from '@/lib/api';
import { fmtDate, label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { EmptyState, ErrorState, GlassCard, Overlay, Pill, Reveal, Skeleton, StaleBanner, T, fx, useFocusRefresh } from '@/fx';

type Note = { id: string; kind: string; body: string; created_at: string; coach_name: string | null };

const KIND: Record<string, string> = { note: 'Note', review: 'Review', consultation: 'Consultation' };

export default function Recommendations() {
  const n = useLoad<{ items: Note[] }>('notes', () => get('/me/notes'), []);
  useFocusRefresh(n.reload);
  const items = n.data?.items ?? [];
  return <Overlay title="Recommendations" subtitle="From your coach, newest first. Only the notes your coach shares with you appear here." fallback="/(tabs)/coach">
    <StaleBanner at={n.stale} />
    <ErrorState error={n.error} onRetry={n.reload} />
    {n.loading && !n.data ? <View style={styles.list}>{[0, 1, 2].map((i) => <Skeleton key={i} height={104} radius={fx.radius.card} />)}</View>
      : n.data && !items.length ? <EmptyState icon="clipboard-list" title="No recommendations yet" body="When your coach shares a note with you, it appears here." />
        : <View style={styles.list}>
          {items.map((x, i) => <Reveal key={x.id} index={i} mount>
            <GlassCard rule={{ color: fx.red.brand, width: 3 }} style={styles.card}>
              <Pill tone="info">{KIND[x.kind] ?? label(x.kind)}</Pill>
              <T v="body" color={fx.ink.a90} style={styles.text}>{x.body}</T>
              <T v="caption" color={fx.ink.a50}>{`${x.coach_name ?? 'Your coach'} · ${fmtDate(x.created_at)}`}</T>
            </GlassCard>
          </Reveal>)}
        </View>}
  </Overlay>;
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  card: { gap: 10 },
  text: { fontSize: 15, lineHeight: 23 },
});
