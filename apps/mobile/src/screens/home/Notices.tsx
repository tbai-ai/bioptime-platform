/* The notices at the top of Home (GAP_MAP §4.4, §5):
   - ConfirmEmailNotice: while the email address is not confirmed (amber rail), Bioptime's own sentence word for word
     and "Confirm now".
   - ChoosePackageCard: without an active package, the earlier app's programme card in miniature (a people-free still
     life with its scrim, since it sits just below the greeting; no member value on it) and the red "See the packages" (Store).
   - NewsNotice: unread announcements from the team or the coach, which open the bell's News tab. Its title shrinks just
     enough for its longest word to fit whole at a large text size on a narrow phone (FitText). */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Button, Eyebrow, fx, GlassCard, Icon, Notice, NoticeText, Photo, Scrim, T, TiltCard, motionValues } from '@/fx';
import { FitText } from '../bio/wordFit';
import type { Announcement } from './data';

export function ConfirmEmailNotice({ demo, onConfirm }: { demo: boolean; onConfirm: () => void }) {
  return <Notice kind="warning" title="Confirm your email">
    <NoticeText>{demo ? 'Blood test bookings wait until your email address is confirmed.' : 'Setup and blood test bookings wait until your email address is confirmed.'} <T v="body" color={fx.red.label} accessibilityRole="link" onPress={onConfirm}>Confirm now</T></NoticeText>
  </Notice>;
}

export function ChoosePackageCard({ onOpen }: { onOpen: () => void }) {
  return <TiltCard intensity={motionValues.tilt.package} radius={fx.radius.three}>
    <GlassCard variant="three" clip padding={0}>
      <View style={styles.photo}>
        {/* people-free (the still life of dumbbells, a skipping rope and a towel): this card sits just below the greeting
            and the member's name, so the slot table's home.choosePackage photo (a man crouched at a start line) stays off it */}
        <Photo slot="profile.header.backdrop" opacity={0.55} style={StyleSheet.absoluteFill} decorative />
        <Scrim kind="programme" style={StyleSheet.absoluteFill} />
      </View>
      <View style={styles.body}>
        <Eyebrow kind="overline">Start</Eyebrow>
        <T v="card24" accessibilityRole="header" style={styles.title}>Choose a package</T>
        <T v="body" color={fx.ink.a80} style={styles.text}>A coach, blood tests at home and consultations, in one package.</T>
        <Button title="See the packages" shape="flow" onPress={onOpen} />
      </View>
    </GlassCard>
  </TiltCard>;
}

export function NewsNotice({ items, unread, onOpen }: { items: Announcement[]; unread: number; onOpen: () => void }) {
  const latest = items.find((a) => !a.read) ?? items[0];
  if (!latest || !unread) return null;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${unread} new announcement${unread === 1 ? '' : 's'}: ${latest.title}, from ${latest.from}`} onPress={onOpen}
    style={({ pressed }) => [styles.news, pressed ? styles.newsPressed : null]}>
    <View style={styles.newsTile}><Icon name="megaphone" size={16} color={fx.red.label} /></View>
    <View style={styles.flex}>
      <T v="micro" color={fx.ink.a60}>{unread === 1 ? 'News · 1 new' : `News · ${unread} new`}</T>
      <FitText v="sectionStrong" numberOfLines={2}>{latest.title}</FitText>
      <T v="caption" color={fx.ink.a55} numberOfLines={1}>{latest.from}</T>
    </View>
    <Icon name="chevron-right" size={16} color={fx.ink.a40} />
  </Pressable>;
}

const styles = StyleSheet.create({
  photo: { height: 120 },
  body: { padding: 20, paddingTop: 4, gap: 6 },
  title: { marginTop: 2 },
  text: { marginBottom: 10 },
  news: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: fx.radius.card, borderWidth: 1, borderColor: fx.line.a05, borderLeftWidth: 4, borderLeftColor: fx.red.brand, backgroundColor: fx.bg.panelSolid },
  newsPressed: { borderColor: fx.red.a30 },
  newsTile: { width: 36, height: 36, borderRadius: fx.radius.xl, alignItems: 'center', justifyContent: 'center', backgroundColor: fx.red.a10, borderWidth: 1, borderColor: fx.red.a20 },
  flex: { flex: 1, minWidth: 0 },
});
