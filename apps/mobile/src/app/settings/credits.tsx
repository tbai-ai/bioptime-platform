/* Photo credits (Profile › Settings › About): every photograph bundled with the app, from assets/photos/CREDITS.json
   (its alt text, the photographer, where it came from and its licence; a tap opens the source page), then the exercise
   videos and the typefaces. The clip note keeps every fact of the rights statement on file (generated video, the rights
   confirmed on 30 Oct 2026, filmed clips to replace them) in a member's words: who confirmed them and where the clips
   came from are records for the team, not for this screen. */
import React from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import CREDITS from '@/assets/photos/CREDITS.json';
import { fx, GlassCard, Icon, Overlay, Photo, Reveal, RowDivider, SettingsRow, T } from '@/fx';

type Credit = { id: string; source: string; url: string; author: string; authorUrl?: string; licence: string; alt: string; edits?: string };
const SOURCE_NAME: Record<string, string> = { pexels: 'Pexels', unsplash: 'Unsplash' };
const LIST = (CREDITS as Credit[]).slice().sort((a, b) => a.author.localeCompare(b.author));
const openUrl = (url: string) => { void Linking.openURL(url).catch(() => undefined); };

export default function Credits() {
  return <Overlay kind="back" title="Photo credits" subtitle={`${LIST.length} photographs, the exercise videos and the typefaces`} fallback="/(tabs)/profile?tab=settings">
    <T v="bodySm" color={fx.ink.a70}>The photographs are licensed stock, graded and cropped for the app. The people in them are not Bioptime members, coaches or staff. Tap one to open its source page.</T>
    <GlassCard padding={0} clip>
      {LIST.map((c, i) => <Reveal key={c.id} index={Math.min(i, 8)} mount>
        {i ? <RowDivider inset={16} /> : null}
        <SettingsRow
          title={c.alt}
          sub={`Photo: ${c.author} · ${c.licence}`}
          label={`${c.alt}. Photo by ${c.author} on ${SOURCE_NAME[c.source] ?? c.source}, ${c.licence}. Opens the source page.`}
          right={<View style={styles.thumbWrap}>
            <Photo id={c.id} decorative style={styles.thumb} />
            <Icon name="external-link" size={14} color={fx.ink.a40} />
          </View>}
          onPress={() => openUrl(c.url)}
          style={styles.row} />
      </Reveal>)}
    </GlassCard>

    <GlassCard>
      <View style={styles.head}><Icon name="video" size={16} color={fx.red.label} /><T v="label" accessibilityRole="header" color={fx.red.label}>Exercise videos</T></View>
      <T v="bodySm" color={fx.ink.a80}>Computer-generated demonstration clips. The rights to use them were confirmed on 30 Oct 2026; filmed clips will replace them. An exercise without a clip is described in text only.</T>
    </GlassCard>

    <GlassCard>
      <View style={styles.head}><Icon name="file-text" size={16} color={fx.red.label} /><T v="label" accessibilityRole="header" color={fx.red.label}>Typefaces</T></View>
      <T v="bodySm" color={fx.ink.a80}>Bebas Neue (Dharma Type), Montserrat (the Montserrat Project Authors) and JetBrains Mono (the JetBrains Mono Project Authors), each under the SIL Open Font License 1.1.</T>
    </GlassCard>
  </Overlay>;
}

const styles = StyleSheet.create({
  row: { borderWidth: 0, borderRadius: 0, backgroundColor: fx.premium.transparent },
  thumbWrap: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  thumb: { width: 44, height: 44, borderRadius: fx.radius.lg, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
});
