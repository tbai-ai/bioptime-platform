/* The two insight cards (THEME §11.4: black/40 glass, a 4 pt red left rail, the red label with its glow, 14 light body
   at white/90).
   - Today's brief: one sentence the phone builds from the member's own plan, sessions and bookings (data.briefText),
     rising in line by line with the red caret (Typewriter) once its card's entrance lands (t.typeDelay after the
     landing of its Reveal), once a day (bp.fx.briefSeen.<date>); later showings, reduced motion and the pre-rendered
     page show it complete. It mounts with Home at every tier, never deferred (E2E reads it 300 ms after Home draws).
     Static clipboard icon (CRITIQUE §35: the sparkles and the pulse are the assistant's). The label is a sibling of
     the text, so E2E reads them as lines.
   - From your coach: the latest client-visible note, its coach and date; opens Recommendations. */
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { FONTS, fx, GlassCard, readKeyed, T, Typewriter, writeKeyed } from '@/fx';
import { istDate } from '@/lib/format';
import { InsightLabel } from './parts';
import { dayMonth, type Note } from './data';

function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

/** Whether today's brief has been typed already: once a day; later showings (and a sentence that changes after a tick)
 *  appear complete. The stored value is a hash of the sentence typed, never the sentence. */
function useBriefSeen(text: string): [boolean | null, () => void] {
  const [seen, setSeen] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    readKeyed('briefSeen', istDate()).then((v) => { if (alive) setSeen(v != null); }, () => { if (alive) setSeen(false); });
    return () => { alive = false; };
  }, []);
  const mark = () => { setSeen(true); void writeKeyed('briefSeen', istDate(), hash(text)); };
  return [text ? seen : null, mark];
}

export function BriefCard({ text }: { text: string }) {
  const [seen, markSeen] = useBriefSeen(text);
  return <GlassCard rule={{ color: fx.red.brand }}>
    <InsightLabel icon="clipboard-list">{"Today's brief"}</InsightLabel>
    <View style={styles.body}>
      {seen === null ? <T v="body" color={fx.premium.transparent} style={styles.text}>{text}</T>
        : <Typewriter text={text} play={!seen} style={styles.textStyle} maxFontSizeMultiplier={1.6} onDone={markSeen} />}
    </View>
  </GlassCard>;
}

export function CoachNoteCard({ note, onPress }: { note: Note; onPress: () => void }) {
  return <GlassCard rule={{ color: fx.red.brand }} onPress={onPress} label={`From your coach: ${note.body}`} hint="Opens your coach's recommendations">
    <InsightLabel icon="message-square">From your coach</InsightLabel>
    <T v="body" color={fx.ink.a90} style={styles.text} numberOfLines={5}>{note.body}</T>
    <T v="caption" color={fx.ink.a50} style={styles.meta}>{[note.coach_name, dayMonth(note.created_at)].filter(Boolean).join(' · ')}</T>
  </GlassCard>;
}

const styles = StyleSheet.create({
  body: { minHeight: 60 },
  text: { fontSize: 15, lineHeight: 24 },
  textStyle: { fontFamily: FONTS.sans300, fontSize: 15, lineHeight: 24, color: fx.ink.a90 },
  meta: { marginTop: 10 },
});
