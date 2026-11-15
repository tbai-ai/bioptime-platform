/* The pieces the coach's course and training screens share (the web's modules/learning/shared.tsx), from the existing
   primitives and tokens only:
   ProgressBar  { p, compact? }   "2 of 5 lessons" and the bar; nothing drawn for the bar when the course has no lesson
   CourseCover  { cover }         the course cover (a public asset), kept in its box while it loads; hidden if it fails
   LessonBody   { html }          the lesson as blocks of styled text: paragraphs, h3 headings, bulleted and numbered
                                  lists, bold, italic; an https link opens in the in-app browser. Markup is never rendered. */
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { apiBaseSync, remoteImage } from '@/lib/config';
import { lessonBlocks, progressText, type Cover, type Progress, type Run } from '@/lib/coach/learning';
import { P } from '@/components/ui';
import { colors, font, radius, space } from '@/theme';

export function ProgressBar({ p, compact }: { p: Progress; compact?: boolean }) {
  return <View style={{ gap: space.xs }}>
    {!compact ? <P small>{progressText(p)}</P> : null}
    {p.pct !== null && p.pct !== undefined ? <View accessibilityRole="progressbar" accessibilityLabel="Lessons completed" accessibilityValue={{ min: 0, max: p.total, now: p.completed }} style={styles.track}>
      <View style={[styles.fill, { width: `${Math.max(0, Math.min(100, p.pct))}%` }]} />
    </View> : null}
  </View>;
}

export function CourseCover({ cover }: { cover: Cover }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === cover.url) return null;
  const ratio = cover.width && cover.height && cover.width > 0 && cover.height > 0 ? cover.width / cover.height : 16 / 9;
  const uri = /^https?:\/\//i.test(cover.url) ? cover.url : `${apiBaseSync()}${cover.url.startsWith('/') ? '' : '/'}${cover.url}`;
  return <Image key={cover.url} source={remoteImage(uri)} accessibilityIgnoresInvertColors contentFit="cover" onError={() => setFailed(cover.url)} style={[styles.cover, { aspectRatio: ratio }]} />;
}

function Runs({ runs }: { runs: Run[] }) {
  return <>{runs.map((r, i) => <Text key={i} style={[r.bold && styles.bold, r.italic && styles.italic, r.href ? styles.link : null]}
    {...(r.href ? { accessibilityRole: 'link' as const, onPress: () => { void WebBrowser.openBrowserAsync(r.href!); } } : {})}>{r.text}</Text>)}</>;
}

export function LessonBody({ html, fallback }: { html: string; fallback?: string }) {
  const blocks = lessonBlocks(html ?? '');
  if (!blocks.length) return fallback ? <P>{fallback}</P> : null;
  return <View style={{ gap: space.sm }}>
    {blocks.map((b, i) => b.kind === 'li'
      ? <View key={i} style={styles.li}><Text style={styles.marker}>{b.ordered ? `${b.n}.` : '•'}</Text><Text style={[styles.text, { flex: 1 }]}><Runs runs={b.runs} /></Text></View>
      : <Text key={i} style={b.kind === 'h3' ? styles.h3 : styles.text} accessibilityRole={b.kind === 'h3' ? 'header' : undefined}><Runs runs={b.runs} /></Text>)}
  </View>;
}

const styles = StyleSheet.create({
  track: { height: 6, borderRadius: radius.pill, backgroundColor: colors.raised, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.success },
  cover: { width: '100%', borderRadius: radius.lg, backgroundColor: colors.raised },
  text: { color: colors.text, fontSize: font.body, lineHeight: 23 },
  h3: { color: colors.text, fontSize: font.h3, fontWeight: '700', marginTop: space.sm },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  link: { color: colors.accentText, textDecorationLine: 'underline' },
  li: { flexDirection: 'row', gap: space.sm, paddingLeft: space.xs },
  marker: { color: colors.muted, fontSize: font.body, lineHeight: 23, minWidth: 18 },
});
