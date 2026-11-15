/* Which tab routes this build has. The screen packages add the tab files one by one, so the bar, the pager and every
   "back to the owning tab" fallback ask here rather than assume all nine: a tab whose file is missing is left out, and
   a link that would land on it lands on Home instead. Read from expo-router's route tree (useSitemap), so it follows
   files as they appear in a development build. */
import { useSitemap, type Href, type SitemapType } from 'expo-router';
import { useMemo } from 'react';
import { TABS, type TabName } from './tabs';

const LAYOUT = /^\.\/\(tabs\)\/_layout\.[tj]sx?$/;

function findTabsLayout(n: SitemapType): SitemapType | null {
  if (LAYOUT.test(n.contextKey)) return n;
  for (const c of n.children) { const f = findTabsLayout(c); if (f) return f; }
  return null;
}

/** The route names under (tabs) in this build: 'index', 'train', …, and the hidden 'plan' and 'me'. Null while the
 *  route tree is not known (outside the router). */
export function useTabRoutes(): ReadonlySet<string> | null {
  const sitemap = useSitemap();
  return useMemo(() => {
    if (!sitemap) return null;
    const layout = findTabsLayout(sitemap);
    if (!layout) return null;
    return new Set(layout.children
      .map((c) => c.contextKey.replace(/^\.\/\(tabs\)\//, '').replace(/\.[tj]sx?$/, ''))
      .filter((name) => !name.includes('/') && !name.startsWith('_') && !name.startsWith('+')));
  }, [sitemap]);
}

/** The href of a tab when its file is in this build, else Home's. */
export function tabHrefIn(routes: ReadonlySet<string> | null, name: TabName): Href {
  const tab = TABS.find((t) => t.name === name);
  if (!tab || (routes && !routes.has(name))) return '/(tabs)';
  return tab.href as Href;
}
