/* One support request (M4): the thread with the Bioptime team and a reply box, in the chat look of the Coach tab
   (the member's bubbles on the right in red glass, the team's on the left in dark glass, a round composer with the red
   send button). The team's internal notes never reach this screen (the server leaves them out). A closed request takes
   no reply; a new request is opened from Help. */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { errorText, get, post } from '@/lib/api';
import { fmtDateTime, label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Button, ErrorState, FONTS, fx, haptics, IconButton, Notice, Overlay, Pill, RingSpinner, StaleBanner, T } from '@/fx';

const statusText = (s: string) => (s === 'waiting_on_requester' ? 'Waiting on you' : s === 'open' ? 'With the team' : label(s));
const statusTone = (s: string) => (s === 'waiting_on_requester' ? 'warning' : s === 'resolved' ? 'success' : 'info') as 'warning' | 'info' | 'success';

export default function SupportRequest() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const r = useLoad<any>(`support-request-${id}`, () => get(`/support-requests/${id}`), [id]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<React.ComponentRef<typeof ScrollView>>(null);
  useEffect(() => { setTimeout(() => ref.current?.scrollToEnd({ animated: false }), 50); }, [r.data]);
  const d = r.data;
  const send = async () => {
    if (!body.trim()) return;
    setBusy(true); setErr(null);
    try { await post(`/support-requests/${id}/messages`, { body: body.trim() }); setBody(''); haptics.commit(); await r.reload(); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const items: any[] = d?.messages ?? [];
  const open = !!d && d.status !== 'closed';
  const composer = open ? <View style={styles.composer}>
    <TextInput value={body} onChangeText={setBody} placeholder={d.status === 'resolved' ? 'Writing again reopens it' : 'Write to the Bioptime team'} placeholderTextColor={fx.ink.a50}
      multiline numberOfLines={Platform.OS === 'web' ? 1 : undefined} maxLength={5000} accessibilityLabel="Your reply" selectionColor={fx.red.brand} cursorColor={fx.red.brand} style={styles.input} />
    <IconButton icon="send" kind="send" label="Send" onPress={send} disabled={!body.trim() || busy} />
  </View> : undefined;
  return <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <Overlay kind="back" title={d?.subject ?? 'Support request'} subtitle={d ? `${d.reference} · ${d.categoryLabel}` : undefined} fallback="/help" scroll={false} footer={composer} contentStyle={styles.content}>
      <ScrollView ref={ref} style={styles.fill} contentContainerStyle={styles.thread} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <StaleBanner at={r.stale} /><ErrorState error={r.error} onRetry={r.reload} />
        {r.loading && !d ? <View style={styles.loading}><RingSpinner label="Loading the request" /></View> : null}
        {d ? <View style={styles.meta}>
          <Pill tone={statusTone(d.status)}>{statusText(d.status)}</Pill>
          <T v="caption" color={fx.ink.a55}>{`Opened ${fmtDateTime(d.createdAt)}`}</T>
        </View> : null}
        {items.map((m) => <View key={m.id} style={[styles.msg, m.mine ? styles.mine : styles.theirs]}>
          <View style={[styles.bubble, m.mine ? styles.bubbleMine : styles.bubbleTheirs]}><T v="body" color={fx.ink.white} style={styles.text}>{m.body}</T></View>
          <T v="caption" color={fx.ink.a50} style={m.mine ? styles.right : null}>{`${m.authorName} · ${fmtDateTime(m.createdAt)}`}</T>
        </View>)}
        {err ? <Notice kind="error">{err}</Notice> : null}
        {d?.status === 'closed' ? <Notice kind="info" title="This request is closed">{`Open a new request from Help and mention ${d.reference} if you need more help.`}</Notice> : null}
        {d?.status === 'closed' ? <Button title="Back to Help" variant="soft" onPress={() => router.back()} /> : null}
      </ScrollView>
    </Overlay>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 0, paddingTop: 0 },
  thread: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16, gap: 12 },
  loading: { paddingVertical: 48, alignItems: 'center' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 },
  msg: { maxWidth: '84%', gap: 4 },
  mine: { alignSelf: 'flex-end' },
  theirs: { alignSelf: 'flex-start' },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: fx.radius.card, borderWidth: 1 },
  bubbleMine: { backgroundColor: fx.red.a10, borderColor: fx.red.a20, borderTopRightRadius: 4 },
  bubbleTheirs: { backgroundColor: fx.bg.panelSolid, borderColor: fx.line.a08, borderTopLeftRadius: 4 },
  text: { fontSize: 15, lineHeight: 22 },
  right: { textAlign: 'right' },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 6, paddingLeft: 16, borderRadius: fx.radius.tall, borderWidth: 1, borderColor: fx.line.a10, backgroundColor: fx.glass.composer },
  input: { flex: 1, color: fx.ink.white, fontFamily: FONTS.sans400, fontSize: 15, lineHeight: 20, maxHeight: 120, paddingVertical: 12 },
});
