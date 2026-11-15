/* What the administrative portal's module screens share (group admin-mod-a): the screen frame (the stack header with
   the bell, the admin RoleGate, the module's flag gate with the web's ModuleRouteGate wording, the permission gate with
   the web's RequirePermission wording, the pageHead title and sub-line) with one pull to refresh for every piece and
   one stale banner when any piece shows what the device saved, a
   toast handed to the next screen, the billing document opener (a 5-minute token, every opening audited) and a
   reading preview of the CMS-allowlisted HTML the help centre keeps. Tokens from theme.ts only; nothing here fetches on
   its own. */
import * as WebBrowser from 'expo-web-browser';
import { Stack } from 'expo-router';
import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { post } from '@/lib/api';
import { apiBaseSync } from '@/lib/config';
import { useFeatures } from '@/lib/features';
import { Screen, StaleBanner, Title } from '@/components/ui';
import { NotificationBell, RequirePermission, RoleGate } from '@/components/workspaceShell';
import { ModuleGate } from '@/components/coachModules/shared';
import { Enter } from '@/motion';
import { colors, font, space } from '@/theme';

/* Pull to refresh across the pieces of a module screen: the frame counts a tick on every pull; each body that loads
   something reads the tick (useScreenRefresh) as a dependency of its loads and reports while it is loading, so the
   spinner shows until every piece has its answer. A piece also reports when it is showing the device's saved copy
   (useLoad's `stale`, offline): the frame then shows one stale banner with the oldest saved time, so nothing saved
   reads as current. Bodies render only behind the flag and permission gates, so nothing is requested while the module
   is off or the permission is missing. */
type Piece = { loading: boolean; stale: string | null };
type RefreshCtx = { tick: number; report: (id: string, piece: Piece) => void; drop: (id: string) => void };
const Refresh = createContext<RefreshCtx>({ tick: 0, report: () => undefined, drop: () => undefined });

/** The pull-to-refresh tick of the enclosing AdminModuleScreen; pass `loading` so the spinner waits for this piece, and
 *  `stale` (useLoad's) so the frame's stale banner says when this piece shows the copy saved on the device. */
export function useScreenRefresh(loading: boolean, stale: string | null = null): number {
  const ctx = useContext(Refresh);
  const id = useId();
  const { report, drop } = ctx;
  useEffect(() => { report(id, { loading, stale }); }, [report, id, loading, stale]);
  useEffect(() => () => drop(id), [drop, id]);
  return ctx.tick;
}

/** The oldest of the saved times being shown (ISO strings sort as times), or null when everything is current. */
export function oldestStale(...at: Array<string | null | undefined>): string | null {
  const shown = at.filter((x): x is string => !!x).sort();
  return shown[0] ?? null;
}

/** The frame of an admin module screen: header (title + bell) + RoleGate + the module's flag gate (the web's
 *  ModuleRouteGate) + the permission gate (the web's RequirePermission) + the pageHead title and sub-line (`noTitle`
 *  when the body draws a record's own head). The body
 *  loads for itself; it reads the pull-to-refresh tick with useScreenRefresh. */
export function AdminModuleScreen({ title, header, sub, noTitle, module, feature, permission, any, children }: { title: string; header?: string; sub?: string; noTitle?: boolean; module: string; feature?: string; permission: string | string[]; any?: boolean; children: React.ReactNode }) {
  const features = useFeatures(true);
  const [tick, setTick] = useState(0);
  const [pieces, setPieces] = useState<Record<string, Piece>>({});
  const report = useCallback((id: string, piece: Piece) => setPieces((b) => { const cur = b[id]; return cur && cur.loading === piece.loading && cur.stale === piece.stale ? b : { ...b, [id]: piece }; }), []);
  const drop = useCallback((id: string) => setPieces((b) => { if (!(id in b)) return b; const next = { ...b }; delete next[id]; return next; }), []);
  const ctx = useMemo(() => ({ tick, report, drop }), [tick, report, drop]);
  const all = Object.values(pieces);
  const refreshing = all.some((p) => p.loading);
  const staleAt = oldestStale(...all.map((p) => p.stale));
  return <RoleGate workspace="admin">
    <Stack.Screen options={{ title: header ?? title, headerRight: () => <NotificationBell /> }} />
    <Screen refreshing={refreshing} onRefresh={() => setTick((t) => t + 1)}>
      {noTitle ? null : <Enter><Title sub={sub}>{title}</Title></Enter>}
      <ModuleGate features={features} module={module} feature={feature}>
        <RequirePermission permission={permission} any={any}>
          <StaleBanner at={staleAt} />
          <Refresh.Provider value={ctx}>{children}</Refresh.Provider>
        </RequirePermission>
      </ModuleGate>
    </Screen>
  </RoleGate>;
}

/* A toast that should greet the next screen (the web's toasts outlive a navigation; a phone screen's notice does not):
   the screen that navigates sets it, the screen that opens takes it once. */
let pending: string | null = null;
export function setPendingToast(text: string): void { pending = text; }
export function takePendingToast(): string | null { const t = pending; pending = null; return t; }

/** Open a billing document (the web's openDocument): POST the token path → { token }, then the printable page. */
export async function openBillingDocument(tokenPath: string): Promise<void> {
  const t = await post<{ token: string }>(tokenPath);
  await WebBrowser.openBrowserAsync(`${apiBaseSync()}/api/billing/documents/file?token=${encodeURIComponent(t.token)}`);
}

/** The CMS-allowlisted HTML (p, br, strong/b, em/i, ul, ol, li, h3, a) as blocks of styled runs, for a reading preview:
 *  paragraphs, small headings and list items, with bold, italic and links (https or same-site, as the server keeps them)
 *  kept inline. Anything else is dropped, as the server drops it when the body is saved. */
export type HtmlRun = { text: string; bold?: boolean; italic?: boolean; link?: boolean };
export type HtmlBlock = { kind: 'p' | 'h3' | 'li'; runs: HtmlRun[] };
const decode = (t: string) => t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '’');
function runsOf(html: string): HtmlRun[] {
  const out: HtmlRun[] = [];
  const st = { bold: 0, italic: 0, link: 0 };
  const re = /<(\/?)(strong|b|em|i|a|br)\b[^>]*>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  const push = (raw: string) => { const t = decode(raw.replace(/<[^>]+>/g, '')).replace(/[ \t\n]+/g, ' '); if (t) out.push({ text: t, bold: st.bold > 0, italic: st.italic > 0, link: st.link > 0 }); };
  while ((m = re.exec(html))) {
    push(html.slice(last, m.index));
    const tag = m[2]!.toLowerCase();
    const delta = m[1] ? -1 : 1;
    if (tag === 'br') out.push({ text: '\n' });
    else if (tag === 'strong' || tag === 'b') st.bold = Math.max(0, st.bold + delta);
    else if (tag === 'em' || tag === 'i') st.italic = Math.max(0, st.italic + delta);
    else st.link = Math.max(0, st.link + delta);
    last = m.index + m[0].length;
  }
  push(html.slice(last));
  if (out.length) { out[0] = { ...out[0]!, text: out[0]!.text.replace(/^\s+/, '') }; const z = out.length - 1; out[z] = { ...out[z]!, text: out[z]!.text.replace(/\s+$/, '') }; }
  return out.filter((r) => r.text);
}
export function htmlToBlocks(html: string): HtmlBlock[] {
  const out: HtmlBlock[] = [];
  const re = /<(h3|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  const add = (kind: HtmlBlock['kind'], raw: string) => { const runs = runsOf(raw.replace(/<\/?(ul|ol)\b[^>]*>/gi, '')); if (runs.length) out.push({ kind, runs }); };
  while ((m = re.exec(html))) {
    add('p', html.slice(last, m.index));
    add(m[1]!.toLowerCase() as HtmlBlock['kind'], m[2]!);
    last = m.index + m[0].length;
  }
  add('p', html.slice(last));
  return out;
}

export function HtmlPreview({ html }: { html: string }) {
  const blocks = htmlToBlocks(html);
  if (!blocks.length) return null;
  return <View style={{ gap: space.sm }}>
    {blocks.map((b, i) => <Text key={i} style={b.kind === 'h3' ? styles.h3 : styles.p}>
      {b.kind === 'li' ? '• ' : null}
      {b.runs.map((r, j) => <Text key={j} style={[r.bold && { fontWeight: '700' }, r.italic && { fontStyle: 'italic' }, r.link && { color: colors.accentText, textDecorationLine: 'underline' }]}>{r.text}</Text>)}
    </Text>)}
  </View>;
}

const styles = StyleSheet.create({
  p: { color: colors.text, fontSize: font.small, lineHeight: 19 },
  h3: { color: colors.text, fontSize: font.h3, fontWeight: '600' },
});
