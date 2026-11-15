/* The assistant side of the Coach tab: drawn only while GET /me/assistant offers the assistant (src/lib/assistant.ts);
   today the server keeps it off, and then nothing about it is shown anywhere. When offered:
   - without the member's consent under the current wording: the server's wording (its status label with it), "I agree"
     when the server allows recording it, or what is still missing in the server's words;
   - with it: the conversation in the earlier app's AI bubbles (glass, sparkles avatar, which is reserved for the
     assistant), each answer labelled as the server labels it ("Written by an AI assistant, not your coach."), the
     typing dots while an answer is awaited (no streaming effect: the server does not stream), and a way to withdraw
     (which deletes the conversation). Nothing is generated or filled in on this side: a refusal shows the server's
     message. The header carries the Bioptime mark at 24 pt in a 40 pt ring (CRITIQUE §28 clear space). */
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, GlassCard, Icon, MarkPaths, Notice, Pill, Sheet, T, TypingDots, fx, haptics, toast } from '@/fx';
import { errorText } from '@/lib/api';
import { loadAssistantMessages, sendAssistantMessage, setAssistantConsent, type AssistantMessage, type AssistantStatus } from '@/lib/assistant';
import { Composer } from './Composer';
import { istTime } from './time';

export function AssistantPane({ status, onStatus, bottom }: { status: AssistantStatus; onStatus: (s: AssistantStatus) => void; bottom: number }) {
  const [items, setItems] = useState<AssistantMessage[]>([]);
  const [body, setBody] = useState('');
  const [waiting, setWaiting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  useEffect(() => {
    if (!status.on) { setItems([]); return; }
    void loadAssistantMessages().then((r) => setItems(r.items ?? []), () => undefined);
  }, [status.on]);

  const agree = async () => {
    setBusy(true);
    try { onStatus(await setAssistantConsent(true, status.consent.wording.version)); haptics.success(); }
    catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  };
  const withdraw = async () => {
    setAsking(false); setBusy(true);
    try { onStatus(await setAssistantConsent(false)); setItems([]); }
    catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  };
  const send = async () => {
    const text = body.trim();
    if (!text || waiting) return;
    setBody(''); setWaiting(text);
    try { const r = await sendAssistantMessage(text); setItems((x) => [...x, ...r.items]); }
    catch (e) { setBody(text); toast.error(errorText(e)); } finally { setWaiting(null); }
  };

  return <View style={[styles.fill, { paddingBottom: bottom }]}>
    <ScrollView ref={scroll} style={styles.fill} contentContainerStyle={styles.content} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })} keyboardShouldPersistTaps="handled">
      <View style={styles.intro}>
        <View style={styles.mark}><MarkPaths width={24} /></View>
        <View style={styles.flex}>
          <T v="cardTitle">Bioptime assistant</T>
          <T v="caption" color={fx.ink.a60}>Not your coach. No medical advice.</T>
        </View>
        {status.on ? <Button title="Withdraw" variant="link" iconRight={null} onPress={() => { haptics.warning(); setAsking(true); }} /> : null}
      </View>
      {!status.on ? <GlassCard style={styles.gap}>
        <View style={styles.head}><T v="label" accessibilityRole="header">Before you start</T><Pill tone="sample" style={styles.pill}>{status.consent.wording.label}</Pill></View>
        {status.consent.earlierWording ? <Notice kind="warning" title="The wording has changed">You agreed to an earlier wording. Agree to the wording below to go on.</Notice> : null}
        <T v="body" color={fx.ink.a90}>{status.consent.wording.text}</T>
        {status.consent.canGrant ? <Button title="I agree" commit busy={busy} onPress={agree} />
          : <Notice kind="info" title="Not available yet">{status.missing.length ? status.missing.map((m) => m.label).join('; ') : status.reason ?? ''}</Notice>}
      </GlassCard> : <>
        {items.map((m) => <AssistantBubble key={m.id} m={m} />)}
        {waiting ? <>
          <AssistantBubble m={{ id: 'waiting', role: 'member', body: waiting, createdAt: new Date().toISOString(), model: null, label: null }} />
          <View style={styles.line}><Avatar /><View style={[styles.bubble, styles.bot]}><TypingDots /></View></View>
        </> : null}
      </>}
    </ScrollView>
    {status.on ? <Composer value={body} onChange={setBody} onSend={() => { void send(); }} canSend={!!body.trim() && !waiting} placeholder="Write to the assistant…" label="Message to the assistant" filesOn={false} pending={[]} maxLength={2000} /> : null}
    <Sheet visible={asking} onClose={() => setAsking(false)} title="Withdraw your consent?">
      <T v="body" color={fx.ink.a80}>Your conversation with the assistant is deleted. You can agree again later.</T>
      <View style={styles.actions}>
        <Button title="Withdraw" variant="redGlass" busy={busy} onPress={() => { void withdraw(); }} />
        <Button title="Keep" variant="ghost" full onPress={() => setAsking(false)} />
      </View>
    </Sheet>
  </View>;
}

function Avatar() {
  return <View style={styles.avatar} accessible={false}><Icon name="sparkles" size={14} color={fx.red.vivid} /></View>;
}

function AssistantBubble({ m }: { m: AssistantMessage }) {
  const bot = m.role === 'assistant';
  return <View style={[styles.line, bot ? null : styles.mine]}>
    {bot ? <Avatar /> : null}
    <View style={[styles.col, bot ? null : styles.colMine]}>
      <View accessible accessibilityLabel={`${bot ? 'Assistant' : 'You'}: ${m.body}`} style={[styles.bubble, bot ? styles.bot : styles.me]}>
        <T v="body" color={bot ? fx.ink.zinc200 : fx.ink.white}>{m.body}</T>
      </View>
      <T v="caption" color={fx.ink.a60} style={styles.meta}>{bot && m.label ? `${m.label} · ${istTime(m.createdAt)}` : istTime(m.createdAt)}</T>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: 20, gap: 12 },
  intro: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  mark: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: fx.line.a20, backgroundColor: fx.fill.a10, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, minWidth: 0 },
  gap: { gap: 12 },
  head: { gap: 8, alignItems: 'flex-start' },
  pill: { maxWidth: '100%' },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  mine: { justifyContent: 'flex-end' },
  col: { maxWidth: '82%', alignItems: 'flex-start' },
  colMine: { alignItems: 'flex-end' },
  bubble: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16, borderWidth: 1 },
  bot: { borderTopLeftRadius: 4, backgroundColor: fx.bg.panelSolid, borderColor: fx.line.a08 },
  me: { borderTopRightRadius: 4, backgroundColor: fx.red.a10, borderColor: fx.red.a20 },
  meta: { marginTop: 4, marginHorizontal: 4 },
  avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: fx.red.a10, borderWidth: 1, borderColor: fx.red.a25, alignItems: 'center', justifyContent: 'center' },
  actions: { gap: 10, marginTop: 20 },
});
