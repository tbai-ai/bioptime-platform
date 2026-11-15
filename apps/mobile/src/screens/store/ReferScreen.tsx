/* Refer a friend (module `referrals`; /refer, from the Store strip and Profile › Settings): the member's personal link
   (GET /me/referrals; the code is made the first time) on a share card with depth (a TiltCard holding the gift
   DepthTile, the Medallion technique), the code spelled out for screen readers, the link, the device's share sheet
   (React Native's Share) and Copy link, stacked full width so both read on one line at the same height on every phone
   and text size; then who joined with it, by first name and the date they joined. Rewards are an owner decision: the
   screen promises none. */
import * as Clipboard from 'expo-clipboard';
import React from 'react';
import { Platform, Share, StyleSheet, View } from 'react-native';
import { get } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import {
  Avatar, Button, DepthTile, EmptyState, ErrorState, Eyebrow, fx, GlassCard, haptics, Icon, Overlay, Reveal, Scrim, Skeleton, StaleBanner, T, TiltCard,
  toast, useFocusRefresh,
} from '@/fx';
import { FitText } from '@/fx/wordFit';
import type { Referrals } from './data';

export function ReferScreen() {
  const r = useLoad<Referrals>('referrals.mine', () => get('/me/referrals'), []);
  useFocusRefresh(r.reload);
  const d = r.data;
  const share = () => { if (d) void Share.share({ message: `Here is my link to create a Bioptime account: ${d.link}`, title: 'Bioptime' }).catch(() => {}); };
  const copy = async () => { if (!d) return; try { await Clipboard.setStringAsync(d.link); haptics.light(); toast.logged('Link copied'); } catch { /* nothing to copy into */ } };

  return <Overlay title="Refer a friend" subtitle="Your personal link" fallback="/(tabs)/store">
    <StaleBanner at={r.stale} />
    <ErrorState error={r.error} onRetry={r.reload} />
    {r.loading && !d ? <View style={styles.gap}><Skeleton height={300} radius={fx.radius.hero} /><Skeleton height={120} radius={fx.radius.three} /></View> : null}
    {d ? <>
      <Reveal mount index={0}><T v="body" color={fx.ink.a80}>Share your personal link. When a friend creates a Bioptime account with it, they appear here by first name.</T></Reveal>

      <Reveal mount index={1} from="scale" spring="soft">
        <TiltCard intensity={6} hero radius={fx.radius.hero}>
          <View style={styles.card} testID="refer-card">
            <Scrim kind="coach" style={[StyleSheet.absoluteFill, styles.wash]} />
            <Scrim kind="cardBottom" style={StyleSheet.absoluteFill} />
            <View style={styles.cardTop}>
              <DepthTile size={56} radius={18} turnIn sheen follow accessibilityLabel="Gift">
                <Icon name="gift" size={26} color={fx.ink.white} />
              </DepthTile>
              <Eyebrow kind="store" style={styles.brand}>Bioptime</Eyebrow>
            </View>
            <Eyebrow kind="label" style={styles.codeLabel}>Your code</Eyebrow>
            {/* the code on one line, shrunk to fit the card at a large text size ('DADNU5/PQ', SWB-18); the web has no
                shrink-to-fit, so there it is measured against the card instead of cut (R1-05) */}
            {Platform.OS === 'web'
              ? <FitText v="metric30" style={styles.code} min={0.5} accessibilityLabel={`Your code ${d.code.split('').join(' ')}`}>{d.code}</FitText>
              : <T v="metric30" style={styles.code} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} accessibilityLabel={`Your code ${d.code.split('').join(' ')}`}>{d.code}</T>}
            {/* the whole link, however long the address (INV-02); kept exact for copying (no break characters added) */}
            <T v="mono12" color={fx.ink.a70} selectable style={styles.link}>{d.link}</T>
            <View style={styles.actions}>
              <Button title="Share my link" icon="share-2" shape="flow" commit onPress={share} />
              <Button title="Copy link" icon="copy" variant="soft" label="Copy my link" onPress={copy} />
            </View>
            <T v="caption" color={fx.ink.a60} style={styles.rewards}>Rewards are set by the Bioptime team.</T>
          </View>
        </TiltCard>
      </Reveal>

      <Reveal mount index={2}>
        <GlassCard variant="three">
          <Eyebrow kind="label">Who joined with your link</Eyebrow>
          {d.joined.length ? <View style={styles.list}>
            {d.joined.map((j) => <View key={j.id} style={styles.person}>
              <Avatar name={j.firstName} size={36} />
              <View style={styles.flex}>
                <T v="section">{j.firstName}</T>
                <T v="caption" color={fx.ink.a55}>{`Joined ${fmtDate(j.joinedAt)}`}</T>
              </View>
            </View>)}
          </View> : <EmptyState icon="users" title="No one yet" body="Friends who create an account with your link appear here." style={styles.empty} />}
        </GlassCard>
      </Reveal>
      <T v="caption" color={fx.ink.a50} center>You see only their first name and the date they joined.</T>
    </> : null}
  </Overlay>;
}

const styles = StyleSheet.create({
  gap: { gap: 16 },
  flex: { flex: 1 },
  card: { borderRadius: fx.radius.hero, borderWidth: 1, borderColor: fx.line.a10, backgroundColor: fx.bg.card, padding: 24, overflow: 'hidden', boxShadow: fx.shadow.deep },
  wash: { opacity: 0.35 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 },
  brand: { color: fx.ink.a70 },
  codeLabel: { color: fx.ink.a70 },
  code: { letterSpacing: 6, marginTop: 6 },
  link: { marginTop: 8 },
  // Share over Copy link, each the card's full width: side by side, Share my link wrapped to two lines on a 411 dp phone
  actions: { gap: 10, marginTop: 24 },
  rewards: { marginTop: 14 },
  list: { gap: 14, marginTop: 14 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  empty: { marginTop: -24, marginBottom: -32 },
});
