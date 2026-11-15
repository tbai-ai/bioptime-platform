/* Coach AI and your data (M11): the member's ai_processing consent and what it covers. Coaches use Coach AI in the
   portal; members never see drafts, only what their coach writes and sends. The consent wording is a draft pending
   counsel and says so (its badge stays until counsel has reviewed it: owner decision, 5 Nov); outside the demo it
   cannot be given yet and the screen says so in member words. Withdrawing
   always works, even while the module is off: this file route (/coach-ai) is mounted whatever the flag, and the API
   leaves /me/ai/consent ungated. Entries: the Coach tab's coach sheet and Profile › Privacy (both follow the whileOff
   rule of lib/modules/ai.ts). The wording lists, line by line, exactly what a draft request can send; a consent under
   an earlier wording is shown as such. Every sentence is the one the screen had before the restyle (an overlay in the
   earlier app's look: notice cards, a glass consent card, the withdraw question as a sheet).
   Motion (v2, C06): the overlay's own enter and exit (the kit's Overlay); the cards arrive in four beats (60 ms apart);
   the withdraw question is a sheet whose answer runs once the sheet has left (onExited). */
import React, { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { errorText, get, post } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Button, ErrorState, GlassCard, Notice, Overlay, Pill, Reveal, Sheet, Skeleton, StaleBanner, T, fx, haptics, useFocusRefresh } from '@/fx';

type ConsentState = {
  granted: boolean; current?: boolean; earlierWording?: boolean; version: string | null; at: string | null;
  wording: { version: string; status: string; label: string; text: string; intro?: string; items?: string[]; outro?: string };
  moduleOn?: boolean; canGrant: boolean; missing: string | null; healthShared: boolean; inUse: boolean; note: string; demo: boolean;
};

export default function CoachAi() {
  const s = useLoad<ConsentState>('coach-ai-consent', () => get('/me/ai/consent'), []);
  useFocusRefresh(s.reload);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const d = s.data;
  // an older API answers without these fields: then a granted consent is the current one and the module is on
  const current = !!d && (d.current ?? d.granted);
  const earlier = !!d && (d.earlierWording ?? false);
  const moduleOn = d?.moduleOn ?? true;
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setMsg(null); try { await fn(); haptics.success(); void s.reload(); } catch (e) { setMsg(errorText(e)); } finally { setBusy(false); } };
  const withdraw = () => { haptics.warning(); setAsking(true); };
  // the sheet's answer runs once the sheet has left
  const after = useRef<(() => void) | null>(null);
  const exited = () => { const next = after.current; after.current = null; next?.(); };

  return <Overlay title="Coach AI and your data" fallback="/(tabs)/coach">
    <T v="body" color={fx.ink.a80}>Your coach may use Coach AI to help write drafts for you, only if you agree. Your coach reads and edits every draft; nothing is sent to you automatically.</T>
    <StaleBanner at={s.stale} />
    <ErrorState error={s.error} onRetry={s.reload} />
    {s.loading && !d ? <View style={styles.gap}><Skeleton height={88} radius={fx.radius.card} /><Skeleton height={220} radius={fx.radius.card} /></View> : null}
    {d ? <>
      <Reveal mount index={0}><Notice kind="info" title={d.inUse ? 'Coach AI is in use' : moduleOn ? 'Coach AI is not in use yet' : 'Coach AI is switched off'}>{d.inUse || !moduleOn ? d.note : 'Coach AI is not switched on yet, so nothing about you is shared with it.'}</Notice></Reveal>
      <Reveal mount index={1}><GlassCard style={styles.gap}>
        <View style={styles.head}><T v="label" accessibilityRole="header">Consent</T><Pill tone="sample" style={styles.pill}>{d.wording.label}</Pill></View>
        {earlier ? <Notice kind="warning" title="The wording has changed">{`You agreed to an earlier wording on ${fmtDate(d.at)}. Your coach cannot use Coach AI for drafts about you until you agree to the wording below. You can also withdraw your earlier consent.`}</Notice> : null}
        {d.wording.items?.length ? <View style={styles.wording}>
          <T v="body">{d.wording.intro ?? ''}</T>
          {d.wording.items.map((t) => <View key={t} style={styles.item}><View style={styles.bullet} /><T v="body" color={fx.ink.a80} style={styles.flex}>{t}</T></View>)}
          <T v="body">{d.wording.outro ?? ''}</T>
        </View> : <T v="body">{d.wording.text}</T>}
        {current ? <View style={styles.row}>
          <Pill tone="success" icon="check">{`Agreed ${fmtDate(d.at)}`}</Pill>
          <Button title="Withdraw" variant="link" iconRight={null} busy={busy} onPress={withdraw} />
        </View> : <View style={styles.gap}>
          {d.canGrant ? <Button title={earlier ? 'I agree to this wording' : 'I agree'} commit busy={busy} onPress={() => run(() => post('/me/ai/consent', { granted: true, version: d.wording.version }))} /> : null}
          {d.granted ? <Button title="Withdraw" variant="ghost" busy={busy} onPress={withdraw} /> : null}
          {!d.canGrant ? (moduleOn
            ? <Notice kind="warning" title="Not available yet">You cannot agree to Coach AI yet. When you can, it is offered here.</Notice>
            : <Notice kind="info" title="Coach AI is switched off for your account">{d.granted ? 'You cannot agree to it now. You can withdraw the consent you gave.' : 'There is nothing to agree to now.'}</Notice>) : null}
        </View>}
      </GlassCard></Reveal>
      {msg ? <Notice kind="error">{msg}</Notice> : null}
      <Reveal mount index={2}><GlassCard style={styles.gap}>
        <T v="label">What is included</T>
        <Included label="Health records" text={d.healthShared ? 'Only while you share them with your coach (you do now)' : 'Not included: you do not share them with your coach'} />
        <Included label="Never taken from your profile" text="Your phone, email, address, PIN code and date of birth. Messages are sent as you wrote them." />
        <Included label="Drafts" text="Seen only by your coach, who reviews every draft; you receive only what your coach writes and sends" last />
      </GlassCard></Reveal>
      <Reveal mount index={3}><T v="bodySm" color={fx.ink.a60}>Health sharing with your coach is under Profile › Settings › Privacy and sharing.</T></Reveal>
    </> : null}
    <Sheet visible={asking} onClose={() => setAsking(false)} onExited={exited} title="Withdraw your Coach AI consent?">
      <T v="body" color={fx.ink.a80}>Your coach can no longer ask Coach AI for drafts about you, and any open drafts about you are discarded. You can agree again later.</T>
      <View style={styles.actions}>
        <Button title="Withdraw" variant="redGlass" busy={busy} onPress={() => { after.current = () => { void run(() => post('/me/ai/consent', { granted: false })); }; setAsking(false); }} />
        <Button title="Keep" variant="ghost" full onPress={() => setAsking(false)} />
      </View>
    </Sheet>
  </Overlay>;
}

function Included({ label, text, last }: { label: string; text: string; last?: boolean }) {
  return <View style={[styles.included, last ? null : styles.line]}>
    <T v="sectionStrong">{label}</T>
    <T v="bodySm" color={fx.ink.a70}>{text}</T>
  </View>;
}

const styles = StyleSheet.create({
  gap: { gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  head: { gap: 8, alignItems: 'flex-start' },
  pill: { maxWidth: '100%' },
  wording: { gap: 10 },
  item: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  bullet: { width: 5, height: 5, borderRadius: 3, backgroundColor: fx.red.vivid, marginTop: 9 },
  flex: { flex: 1 },
  included: { gap: 4, paddingVertical: 10 },
  line: { borderBottomWidth: 1, borderBottomColor: fx.line.a05 },
  actions: { gap: 10, marginTop: 20 },
});
