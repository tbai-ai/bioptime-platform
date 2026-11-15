/* Coach › a thread (the portal's /coach/messages/:id, pages/Messages.tsx right column): GET /conversations/:id/messages,
   bubbles with their files, "Open client", the composer with the portal's placeholder and note, and, while the
   'messaging' flag is on, files on the next message (picked with expo-image-picker or expo-document-picker, uploaded as
   base64 like the web: POST /conversations/:id/attachments; opened through a 5-minute token). The thread is marked read
   once it loads (POST /conversations/:id/read) and the tab badges reload. While the 'ai' flag is on, the closed
   "Draft a reply" panel (components/coach/ai) sits under the messages: an accepted draft goes into the reply box only;
   nothing is sent until the coach presses Send. The reply box belongs to this thread alone. Pull to refresh reloads
   the thread (and marks it read again, so the badges follow); the badges tick (GET /coach/home once a minute, or after
   any action) reloads it too when it reports unread messages in this conversation, so a reply that arrives while the
   thread is open shows without leaving it. The toast floats over the bottom of the messages, just above the composer
   (ToastFloat, outside the scroll view), so a refused file or a failed send is seen in a long thread. A file on a sent
   message is a plain label, not a button, while files are off (the portal's plain chip). */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, errorText, get, post } from '@/lib/api';
import { useFeatures } from '@/lib/features';
import { fmtDateTime } from '@/lib/format';
import { fmtBytes } from '@/lib/coach/core/format';
import { ATTACH_MAX_BYTES, ATTACH_MAX_PER_MESSAGE, openAttachment, pickDocuments, pickImages, type Attachment, type PickedFile } from '@/lib/coach/core/files';
import { useLoad } from '@/lib/useLoad';
import { Button, Chip, Loading, P, Row, StaleBanner } from '@/components/ui';
import { RecordRow, Sheet } from '@/components/workspace';
import { RoleGate, notifyBadges, useWorkspaceHome } from '@/components/workspaceShell';
import { AiDraftInline } from '@/components/coach/ai';
import { coachScreenOptions } from '@/components/coach/bell';
import { Bold, Muted, ToastFloat, useToast } from '@/components/coach/shared';
import { CoachRefusal } from '@/components/coach/b/refusal';
import { colors, font, radius, space } from '@/theme';

const chipText = (a: Attachment) => `${a.kind === 'pdf' ? 'PDF' : 'IMG'} · ${a.name} · ${fmtBytes(a.bytes)}`;

/** The files of a message or of the next one: a chip that opens the file (through its token) when `onOpen` is given,
 *  otherwise the same chip as plain text, not a button (the portal's span while files are off). */
function AttachmentChips({ items, onOpen, onRemove, busy }: { items: Attachment[]; onOpen?: (a: Attachment) => void; onRemove?: (a: Attachment) => void; busy?: string | null }) {
  if (!items.length) return null;
  return <View style={styles.chips}>{items.map((a) => <Row key={a.id} style={{ flexWrap: 'nowrap', gap: 2 }}>
    {onOpen ? <Chip onPress={() => onOpen(a)}>{chipText(a)}</Chip> : <View style={styles.plainChip}><Text style={styles.plainChipText}>{chipText(a)}</Text></View>}
    {onRemove ? <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${a.name}`} disabled={busy === a.id} onPress={() => onRemove(a)} hitSlop={6} style={{ padding: 4 }}><Ionicons name="close-circle" size={18} color={colors.muted} /></Pressable> : null}
  </Row>)}</View>;
}

export default function CoachThread() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const convs = useLoad<any>('coach-conversations', () => get('/conversations'), []);
  const thread = useLoad<any>(`coach-thread-${id}`, () => get(`/conversations/${id}/messages?limit=100`), [id]);
  const features = useFeatures(true);
  const filesOn = !!features?.has('messaging');
  const aiOn = !!features?.has('ai');
  const { toast, show } = useToast(id);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [pulling, setPulling] = useState(false);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const open = ((convs.data?.items ?? []) as any[]).find((c) => c.id === id);
  const t = thread.data;
  const loadedId: string | undefined = t?.conversation?.id;
  useEffect(() => { setBody(''); setPending([]); }, [id]);
  useEffect(() => {
    if (!id || !filesOn) { setPending([]); return; }
    let alive = true;
    void get<{ pending?: Attachment[] }>(`/conversations/${id}/attachments`).then((r) => { if (alive) setPending(r.pending ?? []); }, () => {});
    return () => { alive = false; };
  }, [id, filesOn]);
  useEffect(() => {
    if (!id || loadedId !== id) return;
    let alive = true;
    post(`/conversations/${id}/read`).then(() => { if (alive) { notifyBadges(); void convs.reload(); } }, () => {});
    return () => { alive = false; };
  }, [id, loadedId, thread.data]); // eslint-disable-line react-hooks/exhaustive-deps
  // to the newest message when the thread opens and when a new one arrives (not on a reload that brings nothing new):
  // the end of the messages (the bottom of the block that holds them, the portal's endRef), not the end of the content,
  // so an open Coach AI panel under the messages does not hide a reply that has just come in. The block's own layout
  // (its size changes with every message) tells where that end is, on the web as on a phone.
  const items: any[] = t?.items ?? [];
  const lastId: string | undefined = items[items.length - 1]?.id;
  const viewH = useRef(0);
  const endY = useRef(0);
  const stick = useRef(false);
  const toEnd = () => { scroll.current?.scrollTo({ y: Math.max(0, endY.current + space.lg - viewH.current), animated: false }); };
  useEffect(() => { if (!lastId) return; stick.current = true; const timer = setTimeout(toEnd, 80); return () => clearTimeout(timer); }, [lastId]); // eslint-disable-line react-hooks/exhaustive-deps
  // the badges tick: GET /coach/home lists the conversations with unread messages; when this one appears there (or its
  // count or last time moves), the member has written since the thread loaded, so it is fetched again (and marked read)
  const home = useWorkspaceHome('coach') as { unreadConversations?: { conversation_id?: string; unread?: number; last_at?: string }[] } | null;
  const mine = home?.unreadConversations?.find((c) => c.conversation_id === id);
  const unreadKey = home ? (mine ? `${mine.unread ?? ''}|${mine.last_at ?? ''}` : '') : null;
  const seenUnread = useRef<string | null>(null);
  useEffect(() => {
    if (unreadKey === null) return;
    if (seenUnread.current !== null && unreadKey && unreadKey !== seenUnread.current) { void thread.reload(); void convs.reload(); }
    seenUnread.current = unreadKey;
  }, [unreadKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = async () => {
    setPulling(true);
    try { await Promise.all([thread.reload(), convs.reload()]); } finally { setPulling(false); }
  };
  const addFiles = async (files: PickedFile[]) => {
    if (!files.length) return;
    const room = ATTACH_MAX_PER_MESSAGE - pending.length;
    if (files.length > room) show(`At most ${ATTACH_MAX_PER_MESSAGE} files on one message`, 'error');
    setUploading(true);
    try {
      for (const f of files.slice(0, Math.max(0, room))) {
        if (f.bytes > ATTACH_MAX_BYTES) { show(`${f.name} is larger than ${fmtBytes(ATTACH_MAX_BYTES)}`, 'error'); continue; }
        try { const a = await post<Attachment>(`/conversations/${id}/attachments`, { dataBase64: f.dataBase64, filename: f.name }); setPending((p) => [...p, a]); }
        catch (e) { show(`${f.name}: ${errorText(e)}`, 'error'); }
      }
    } finally { setUploading(false); }
  };
  const pick = async (kind: 'image' | 'document') => {
    setPicker(false);
    try { await addFiles(kind === 'image' ? await pickImages() : await pickDocuments()); } catch (e) { show(errorText(e), 'error'); }
  };
  const removeFile = async (a: Attachment) => { setRemoving(a.id); try { await api('DELETE', `/conversations/${id}/attachments/${a.id}`); setPending((p) => p.filter((x) => x.id !== a.id)); } catch (e) { show(errorText(e), 'error'); } finally { setRemoving(null); } };
  const openFile = (a: Attachment) => { openAttachment(a).catch((e) => show(errorText(e), 'error')); };
  const send = async () => {
    if (!body.trim() && !pending.length) return;
    setBusy(true);
    try { await post(`/conversations/${id}/messages`, { body: body.trim(), ...(pending.length ? { attachmentIds: pending.map((a) => a.id) } : {}) }); setBody(''); setPending([]); await thread.reload(); void convs.reload(); }
    catch (e) { show(errorText(e), 'error'); } finally { setBusy(false); }
  };
  // the open thread, once it (not a previous one) has loaded without a refusal: only then the head, the composer and
  // the Coach AI panel, as the portal shows them only inside a loaded thread
  const ready = !thread.error && loadedId === id;
  const aiMember: string | null = aiOn && ready ? t.conversation.memberId : null;
  return <RoleGate workspace="coach"><SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['bottom']}>
    <Stack.Screen options={coachScreenOptions(open?.memberName ?? 'Messages')} />
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <View style={{ flex: 1 }}><ScrollView ref={scroll} contentContainerStyle={{ padding: space.lg, gap: space.sm }} keyboardShouldPersistTaps="handled" onLayout={(e) => { viewH.current = e.nativeEvent.layout.height; }} refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => { void refresh(); }} tintColor={colors.muted} />}>
        <View style={{ gap: space.sm }} onLayout={(e) => { endY.current = e.nativeEvent.layout.y + e.nativeEvent.layout.height; if (stick.current) toEnd(); }}>
        <StaleBanner at={thread.stale} /><CoachRefusal error={thread.error} onRetry={thread.reload} />
        {ready ? <Row between><Bold>{open?.memberName ?? 'Member'}</Bold><Button title="Open client" small variant="ghost" onPress={() => router.push(`/coach/clients/${t.conversation.memberId}`)} /></Row> : null}
        {thread.loading && !t ? <Loading /> : null}
        {items.map((m) => <View key={m.id} style={{ alignSelf: m.mine ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
          {m.body ? <View style={[styles.bubble, m.mine ? styles.mine : styles.theirs]}><Text style={styles.bubbleText}>{m.body}</Text></View> : null}
          {(m.attachments ?? []).length ? <View style={{ alignItems: m.mine ? 'flex-end' : 'flex-start', marginTop: space.xs }}><AttachmentChips items={m.attachments} onOpen={filesOn ? openFile : undefined} /></View> : null}
          <Text style={[styles.time, { textAlign: m.mine ? 'right' : 'left' }]}>{fmtDateTime(m.createdAt)}{m.mine && m.readAt ? ' · read' : ''}</Text>
        </View>)}
        {ready && !items.length ? <P muted>No messages yet. Say hello.</P> : null}
        </View>
        {aiMember ? <View style={{ marginTop: space.md }}><AiDraftInline key={aiMember} memberId={aiMember} purpose="message_reply" title="Draft a reply" intro="Ask Coach AI for a reply to this client’s latest messages and edit it here. Accepting puts it in your reply box; nothing is sent until you press Send." use={{ accept: 'Accept and put in your reply', again: 'Put in your reply', done: 'It is in your reply box below. Nothing is sent until you press Send.', set: (update) => setBody((cur) => update(cur)) }} /></View> : null}
      </ScrollView><ToastFloat toast={toast} /></View>
      {ready ? <View style={styles.composer}>
        {filesOn ? <View style={{ gap: space.xs }}>
          <AttachmentChips items={pending} onOpen={openFile} onRemove={removeFile} busy={removing} />
          <Row between><Button title="Add a file" small variant="ghost" busy={uploading} disabled={pending.length >= ATTACH_MAX_PER_MESSAGE} onPress={() => setPicker(true)} /><Muted>{`PNG, JPEG, WebP or PDF, up to ${fmtBytes(ATTACH_MAX_BYTES)} each.`}</Muted></Row>
        </View> : null}
        <Row style={{ flexWrap: 'nowrap', alignItems: 'flex-end' }}>
          <TextInput value={body} onChangeText={setBody} placeholder="Write to the member. Plain, warm, candid about limits." placeholderTextColor={colors.disabled} multiline maxLength={4000} style={styles.input} accessibilityLabel="Write to the member. Plain, warm, candid about limits." />
          <Button title="Send" small busy={busy} disabled={(!body.trim() && !pending.length) || uploading} onPress={send} />
        </Row>
        <Muted>Never diagnose; point to a doctor when a result needs one.</Muted>
      </View> : null}
    </KeyboardAvoidingView>
    <Sheet open={picker} onClose={() => setPicker(false)} title="Add a file">
      <RecordRow title="Photo or image" meta="From the photo library (PNG, JPEG or WebP)" onPress={() => { void pick('image'); }} />
      <RecordRow title="Document" meta="A PDF or image file" onPress={() => { void pick('document'); }} />
      <P muted small>{`Up to ${ATTACH_MAX_PER_MESSAGE} files on one message, ${fmtBytes(ATTACH_MAX_BYTES)} each. The server checks each file's content.`}</P>
    </Sheet>
  </SafeAreaView></RoleGate>;
}

const styles = StyleSheet.create({
  bubble: { padding: 12, borderRadius: radius.lg },
  mine: { backgroundColor: colors.brand, borderBottomRightRadius: 4 },
  theirs: { backgroundColor: colors.surface, borderBottomLeftRadius: 4 },
  bubbleText: { color: colors.text, fontSize: font.body, lineHeight: 21 },
  time: { color: colors.muted, fontSize: font.tiny, marginTop: 3 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  plainChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.raised },
  plainChipText: { color: colors.text, fontSize: font.small, fontWeight: '600' },
  composer: { gap: space.sm, padding: space.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.base },
  input: { flex: 1, color: colors.text, backgroundColor: colors.canvas, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: 12, paddingVertical: 10, maxHeight: 120, fontSize: font.body },
});
