/* Coach › one help article (the web's /coach/help/articles/:slug): the body in the server's formatting allowlist drawn
   natively, as the web's ArticleBody draws it (paragraphs, h3 headings, bulleted and numbered lists, bold, italic; an
   https link opens in the in-app browser; markup is never rendered), through the coach lesson renderer
   (components/coachLearning/parts LessonBody); the server's plain bodyText when the body has no block. Shown while
   the 'support' flag and its 'help_centre' part are on. */
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { get } from '@/lib/api';
import { useFeatures } from '@/lib/features';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Button, Card, ErrorBox, Loading, StaleBanner } from '@/components/ui';
import { LessonBody } from '@/components/coachLearning/parts';
import { NotificationBell, RoleGate, WorkspaceScreen } from '@/components/workspaceShell';
import { ModuleGate } from '@/components/coachModules/shared';
import { Enter } from '@/motion';
import { colors, font } from '@/theme';
import { Text } from 'react-native';

type Article = { id: string; slug: string; title: string; category: string; summary: string; updatedAt: string; body: string; bodyText?: string };

export default function CoachHelpArticle() {
  const { slug = '' } = useLocalSearchParams<{ slug: string }>();
  const features = useFeatures(true);
  const router = useRouter();
  const on = !!features?.has('support') && !!features?.has('help_centre');
  const a = useLoad<Article>(on ? `help-article-coach-${slug}` : null, () => (on ? get(`/help/articles/${encodeURIComponent(slug)}`) : Promise.resolve(null as unknown as Article)), [slug, on]);
  const d = a.data;
  return <RoleGate workspace="coach">
    <Stack.Screen options={{ title: d?.title ?? 'Help article', headerRight: () => <NotificationBell /> }} />
    <WorkspaceScreen workspace="coach" title={d?.title ?? 'Help article'} sub={d ? `${d.category} · updated ${fmtDate(d.updatedAt)}` : undefined} refreshing={on && a.loading} onRefresh={a.reload}>
      <ModuleGate features={features} module="support" feature="help_centre">
        <Button title="All articles" variant="ghost" small onPress={() => router.push('/coach/help?tab=articles')} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} />
        <StaleBanner at={a.stale} />
        <ErrorBox error={a.error} onRetry={a.reload} />
        {a.loading && !d ? <Loading /> : d ? <Enter><Card><LessonBody html={d.body ?? ''} fallback={d.bodyText} /></Card></Enter> : null}
        <Text style={{ color: colors.muted, fontSize: font.small }}>Not what you needed? <Text style={{ color: colors.accentText }} onPress={() => router.push('/coach/help?tab=requests')}>Ask the Bioptime team</Text>.</Text>
      </ModuleGate>
    </WorkspaceScreen>
  </RoleGate>;
}
